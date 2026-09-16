import { Router } from "express";
import { connectToDatabase } from "../db";
import { Order, ORDER_STATUSES } from "../models/order";
import { Product } from "../models/product";
import { requireAdmin } from "../middleware/require-admin";
import { calculateOrderTotals, type OrderCoupon } from "../utils/pricing";
import { errorMessage } from "../utils/errors";

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

// Orders are created without customer auth (there's no account system yet),
// so this is intentionally the one write endpoint in the whole API that
// isn't behind requireAdmin() — anyone can place an order, same trust model
// checkout already had. What IS enforced here: prices come from the
// database, not from the request body, so a tampered price can't go through.
router.post("/", async (req, res) => {
  const body = req.body ?? {};

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      return res.status(400).json({ error: `${field} is required.` });
    }
  }
  const address = body.shippingAddress ?? {};
  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (typeof address[field] !== "string" || !address[field].trim()) {
      return res.status(400).json({ error: `shippingAddress.${field} is required.` });
    }
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: "Order must include at least one item." });
  }

  await connectToDatabase();

  const resolvedItems = [];
  for (const raw of body.items) {
    const product = await Product.findById(raw?.productId).catch(() => null);
    if (!product) {
      return res.status(400).json({ error: `Product ${raw?.productId ?? ""} is no longer available.` });
    }
    const quantity = Number(raw.quantity);
    resolvedItems.push({
      productId: String(product._id),
      name: product.name,
      slug: product.slug,
      thumbnail: product.thumbnail,
      categoryId: String(product.categoryId),
      price: product.salePrice ?? product.price,
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
      color: typeof raw.color === "string" ? raw.color : undefined,
      size: typeof raw.size === "string" ? raw.size : undefined,
    });
  }

  const subtotal = resolvedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryMethod = body.deliveryMethod === "express" ? "express" : "standard";
  const coupon: OrderCoupon | null =
    body.coupon && typeof body.coupon.type === "string" && typeof body.coupon.value === "number"
      ? { type: body.coupon.type, value: body.coupon.value }
      : null;
  const totals = calculateOrderTotals(subtotal, deliveryMethod, coupon);

  try {
    const order = await createWithUniqueId({
      items: resolvedItems,
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
      deliveryMethod,
      paymentMethod: body.paymentMethod,
      couponCode: body.coupon?.code,
      ...totals,
      status: "pending",
    });
    res.status(201).json(order);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// Public on purpose — order confirmation/tracking pages have no customer
// login to check against yet, so knowing the order id is what grants access
// (same trust model the mock localStorage version had).
router.get("/:id", async (req, res) => {
  await connectToDatabase();
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json(order);
});

router.get("/", requireAdmin(), async (_req, res) => {
  await connectToDatabase();
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

router.patch("/:id/status", requireAdmin(), async (req, res) => {
  await connectToDatabase();
  const status = req.body?.status;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid order status." });
  }

  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  order.status = status;
  await order.save();
  res.json(order);
});

export default router;
