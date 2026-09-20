import { Router } from "express";
import { connectToDatabase } from "../db";
import { Order, ORDER_STATUSES } from "../models/order";
import { Coupon } from "../models/coupon";
import { requireAdmin } from "../middleware/require-admin";
import { resolveCustomer } from "../middleware/require-customer";
import { priceCart } from "../services/pricing-engine";
import { adjustStock } from "../services/inventory";
import { getSettings } from "../services/settings";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

const router = Router();

function generateOrderId(): string {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `FM-${suffix}`;
}

async function createWithUniqueId(doc: Record<string, unknown>, attemptsLeft = 5): Promise<InstanceType<typeof Order>> {
  try {
    return await Order.create({ ...doc, _id: generateOrderId() });
  } catch (error) {
    const isDuplicate = typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
    if (isDuplicate && attemptsLeft > 0) return createWithUniqueId(doc, attemptsLeft - 1);
    throw error;
  }
}

const REQUIRED_STRING_FIELDS = ["customerName", "customerEmail", "deliveryMethod", "paymentMethod"] as const;
const REQUIRED_ADDRESS_FIELDS = ["fullName", "phone", "address", "city", "state", "postalCode", "country"] as const;

/** Statuses that hand the goods back to stock. */
const RESTOCK_STATUSES: string[] = ["cancelled", "returned", "refunded"];

function unitsByProduct(items: { productId: string; quantity: number }[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const item of items) units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
  return units;
}

// Orders are created without requiring a customer login (guest checkout is
// allowed), so this is intentionally the one write endpoint that isn't behind
// requireAdmin() — anyone can place an order. What IS enforced here: every
// price, discount, shipping and tax figure is computed on the server from the
// database (products, active discounts, promotions, the coupon table and
// Settings), never taken from the request body, so a tampered request can't
// produce a cheaper order. If a customer happens to be signed in the order is
// linked to their account, which is what makes group-targeted promotions work.
router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};

    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        throw new HttpError(400, `${field} is required.`);
      }
    }
    const address = body.shippingAddress ?? {};
    for (const field of REQUIRED_ADDRESS_FIELDS) {
      if (typeof address[field] !== "string" || !address[field].trim()) {
        throw new HttpError(400, `shippingAddress.${field} is required.`);
      }
    }

    await connectToDatabase();

    const settings = await getSettings();
    const paymentEnabled: Record<string, boolean> = {
      card: settings.payment.cardEnabled,
      cod: settings.payment.codEnabled,
      "mobile-banking": settings.payment.mobileBankingEnabled,
    };
    if (!paymentEnabled[body.paymentMethod]) {
      throw new HttpError(400, "That payment method isn't available.");
    }

    const customer = await resolveCustomer(req);
    const couponCode = typeof body.coupon?.code === "string" ? body.coupon.code : typeof body.couponCode === "string" ? body.couponCode : "";

    const quote = await priceCart({
      items: body.items,
      deliveryMethod: body.deliveryMethod,
      couponCode,
      customerId: customer?.sub,
    });

    if (quote.stockIssues.length > 0) throw new HttpError(400, quote.stockIssues[0]);
    if (couponCode && quote.couponError) throw new HttpError(400, quote.couponError);

    const order = await createWithUniqueId({
      items: quote.lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        slug: line.slug,
        thumbnail: line.thumbnail,
        categoryId: line.categoryId,
        price: line.price,
        quantity: line.quantity,
        color: line.color,
        size: line.size,
      })),
      customerId: customer?.sub,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      shippingAddress: {
        fullName: address.fullName,
        phone: address.phone,
        address: address.address,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
      },
      deliveryMethod: quote.deliveryMethod,
      paymentMethod: body.paymentMethod,
      couponCode: quote.appliedCoupon?.code,
      subtotal: quote.subtotal,
      discount: quote.discount,
      couponDiscount: quote.couponDiscount,
      promotionDiscount: quote.promotionDiscount,
      promotionNames: quote.appliedPromotions.map((promotion) => promotion.name),
      shipping: quote.shipping,
      tax: quote.tax,
      total: quote.total,
      status: "pending",
    });

    // Take the stock. Each decrement is atomic; if a concurrent order grabbed
    // the last units first, undo what we took, drop the order and say so.
    const taken: [string, number][] = [];
    for (const [productId, units] of unitsByProduct(order.items as { productId: string; quantity: number }[])) {
      const result = await adjustStock(productId, -units, { reason: "Order placed", actor: `Order ${order.id}`, soldDelta: units });
      if (!result) {
        await Promise.all(taken.map(([id, qty]) => adjustStock(id, qty, { reason: "Order failed — stock returned", actor: `Order ${order.id}`, soldDelta: -qty })));
        await order.deleteOne();
        throw new HttpError(400, "Some items just sold out. Please review your cart and try again.");
      }
      taken.push([productId, units]);
    }
    order.stockDeducted = true;
    await order.save();

    if (quote.appliedCoupon) {
      await Coupon.updateOne({ code: quote.appliedCoupon.code }, { $inc: { usedCount: 1 } });
    }

    res.status(201).json(order);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

// Public on purpose — order confirmation/tracking pages work for guests too,
// so knowing the (hard-to-guess) order id is what grants access.
router.get("/:id", async (req, res) => {
  await connectToDatabase();
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json(order);
});

router.get("/", requireAdmin("orders.view"), async (_req, res) => {
  await connectToDatabase();
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

router.patch("/:id/status", requireAdmin("orders.manage"), async (req, res) => {
  await connectToDatabase();
  const status = req.body?.status;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid order status." });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  // Cancelling/returning/refunding gives the units back to stock (once);
  // moving an order back out of those states takes them again.
  if (order.stockDeducted) {
    const items = order.items as { productId: string; quantity: number }[];

    if (RESTOCK_STATUSES.includes(status) && !order.restocked) {
      for (const [productId, units] of unitsByProduct(items)) {
        await adjustStock(productId, units, { reason: `Order ${status}`, actor: `Order ${order.id}`, soldDelta: -units });
      }
      order.restocked = true;
    } else if (!RESTOCK_STATUSES.includes(status) && order.restocked) {
      for (const [productId, units] of unitsByProduct(items)) {
        await adjustStock(productId, -units, { reason: `Order reopened (${status})`, actor: `Order ${order.id}`, soldDelta: units });
      }
      order.restocked = false;
    }
  }

  order.status = status;
  await order.save();
  res.json(order);
});

export default router;
