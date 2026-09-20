import { Router } from "express";
import { connectToDatabase } from "../db";
import { Customer } from "../models/customer";
import { Order } from "../models/order";
import { Promotion } from "../models/promotion";
import { requireCustomer } from "../middleware/require-customer";
import { hashPassword, verifyPassword } from "../utils/password";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";
import { getSettings } from "../services/settings";
import { activeWindowFilter } from "../utils/active-window";

const router = Router();
router.use(requireCustomer());

function publicCustomer(customer: InstanceType<typeof Customer>) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    avatarUrl: customer.avatarUrl,
  };
}

async function loadCustomer(customerId: string) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new HttpError(401, "Not authenticated.");
  return customer;
}

router.put("/profile", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : customer.name;
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : customer.phone;
    const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl.trim() : customer.avatarUrl;

    if (!name) throw new HttpError(400, "Name is required.");
    if (phone && phone !== customer.phone && (await Customer.exists({ phone, _id: { $ne: customer.id } }))) {
      throw new HttpError(409, "Another account already uses this phone number.");
    }

    customer.name = name;
    customer.phone = phone || undefined;
    customer.avatarUrl = avatarUrl || undefined;
    await customer.save();

    res.json({ customer: publicCustomer(customer) });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.post("/change-password", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);

    const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

    if (!newPassword) throw new HttpError(400, "Enter a new password.");
    if (customer.passwordHash) {
      if (!currentPassword) throw new HttpError(400, "Enter your current password.");
      const isValid = await verifyPassword(currentPassword, customer.passwordHash);
      if (!isValid) throw new HttpError(401, "Your current password is incorrect.");
    }

    const { security } = await getSettings();
    if (newPassword.length < security.minPasswordLength) {
      throw new HttpError(400, `Password must be at least ${security.minPasswordLength} characters.`);
    }

    customer.passwordHash = await hashPassword(newPassword);
    await customer.save();
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/addresses", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    res.json({ addresses: customer.toJSON().addresses ?? [] });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

const ADDRESS_FIELDS = ["label", "fullName", "phone", "address", "city", "state", "postalCode", "country"] as const;

function readAddressPayload(body: unknown) {
  const source = (body ?? {}) as Record<string, unknown>;
  const payload: Record<string, string> = {};
  for (const field of ADDRESS_FIELDS) {
    payload[field] = typeof source[field] === "string" ? (source[field] as string).trim() : "";
  }
  return payload;
}

function assertAddressComplete(payload: Record<string, string>) {
  const required = ADDRESS_FIELDS.filter((field) => field !== "label");
  const missing = required.find((field) => !payload[field]);
  if (missing) throw new HttpError(400, "Fill in every address field.");
}

router.post("/addresses", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    const payload = readAddressPayload(req.body);
    assertAddressComplete(payload);

    const makeDefault = Boolean(req.body?.isDefault) || customer.addresses.length === 0;
    if (makeDefault) customer.addresses.forEach((entry: { isDefault: boolean }) => (entry.isDefault = false));
    customer.addresses.push({ ...payload, isDefault: makeDefault });
    await customer.save();

    res.status(201).json({ addresses: customer.toJSON().addresses });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.put("/addresses/:addressId", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    const entry = customer.addresses.id(req.params.addressId);
    if (!entry) throw new HttpError(404, "Address not found.");

    const payload = readAddressPayload(req.body);
    assertAddressComplete(payload);
    Object.assign(entry, payload);

    if (req.body?.isDefault) {
      customer.addresses.forEach((addr: { isDefault: boolean }) => (addr.isDefault = false));
      entry.isDefault = true;
    }

    await customer.save();
    res.json({ addresses: customer.toJSON().addresses });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/addresses/:addressId", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    const entry = customer.addresses.id(req.params.addressId);
    if (!entry) throw new HttpError(404, "Address not found.");

    const wasDefault = entry.isDefault;
    entry.deleteOne();
    if (wasDefault && customer.addresses.length > 0) customer.addresses[0].isDefault = true;

    await customer.save();
    res.json({ addresses: customer.toJSON().addresses });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.post("/addresses/:addressId/default", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    const entry = customer.addresses.id(req.params.addressId);
    if (!entry) throw new HttpError(404, "Address not found.");

    customer.addresses.forEach((addr: { isDefault: boolean }) => (addr.isDefault = false));
    entry.isDefault = true;
    await customer.save();

    res.json({ addresses: customer.toJSON().addresses });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/wishlist", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    res.json({ productIds: customer.wishlistProductIds });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/** Replaces the whole list in one call — simplest way to merge a guest's local wishlist in on login. */
router.put("/wishlist", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds.filter((id: unknown) => typeof id === "string") : [];
    customer.wishlistProductIds = [...new Set(productIds)];
    await customer.save();
    res.json({ productIds: customer.wishlistProductIds });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.post("/wishlist/:productId", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    if (!customer.wishlistProductIds.includes(req.params.productId)) {
      customer.wishlistProductIds.push(req.params.productId);
      await customer.save();
    }
    res.json({ productIds: customer.wishlistProductIds });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/wishlist/:productId", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);
    customer.wishlistProductIds = customer.wishlistProductIds.filter((id: string) => id !== req.params.productId);
    await customer.save();
    res.json({ productIds: customer.wishlistProductIds });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/**
 * There's no stored Notification collection — that would be a second source of
 * truth to keep in sync with orders/promotions for no real benefit here. Instead
 * this derives a feed from data that already exists: the customer's own recent
 * order status, plus promotions currently running. Mirrors the admin bell's
 * approach in notifications.routes.ts.
 */
router.get("/notifications", async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await loadCustomer(req.customer!.sub);

    const orders = await Order.find({ customerId: customer.id }).sort({ updatedAt: -1 }).limit(10).lean();
    const orderItems = orders
      .filter((order) => order.status !== "pending")
      .map((order) => ({
        id: `order-${order._id}`,
        type: "order" as const,
        message:
          order.status === "cancelled"
            ? `Order #${order._id} was cancelled.`
            : `Order #${order._id} is now ${String(order.status).replace(/-/g, " ")}.`,
        date: (order.updatedAt as Date).toISOString(),
        href: `/account/orders/${order._id}`,
      }));

    const promotions = await Promotion.find(activeWindowFilter()).sort({ createdAt: -1 }).limit(5).lean();
    const promotionItems = promotions
      .filter((promo) => promo.customerGroupIds.length === 0 || (customer.groupId && promo.customerGroupIds.includes(String(customer.groupId))))
      .map((promo) => ({
        id: `promotion-${promo._id}`,
        type: "promotion" as const,
        message: `${promo.name} is running now.`,
        date: (promo.createdAt as Date).toISOString(),
        href: "/deals",
      }));

    const items = [...orderItems, ...promotionItems].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json({ notifications: items });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
