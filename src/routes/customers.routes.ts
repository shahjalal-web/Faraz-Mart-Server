import { Router } from "express";
import mongoose from "mongoose";
import { connectToDatabase } from "../db";
import { Customer } from "../models/customer";
import { CustomerGroup } from "../models/customer-group";
import { Order } from "../models/order";
import { Review } from "../models/review";
import { requireAdmin } from "../middleware/require-admin";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

/**
 * Admin view of registered storefront customers. (The customer-facing
 * register/login/me endpoints live in customer-auth.routes.ts, under
 * /api/customers/auth — this router owns the rest of /api/customers.)
 */
const router = Router();

const COUNTED_STATUSES = { $nin: ["cancelled", "returned", "refunded"] };

interface OrderStats {
  orderCount: number;
  totalSpent: number;
  lastOrderAt?: string;
}

/** Orders belong to a customer by account id, or — for orders placed before they signed up/in — by email. */
async function loadOrderStats(customers: { id: string; email?: string | null }[]): Promise<Map<string, OrderStats>> {
  const stats = new Map<string, OrderStats>();
  if (customers.length === 0) return stats;

  const ids = customers.map((customer) => customer.id);
  const emails = customers.map((customer) => customer.email).filter((email): email is string => Boolean(email));

  const orders = await Order.find({
    status: COUNTED_STATUSES,
    $or: [{ customerId: { $in: ids } }, { customerEmail: { $in: emails } }],
  }).select("customerId customerEmail total createdAt");

  const idByEmail = new Map(customers.filter((c) => c.email).map((c) => [c.email as string, c.id]));
  for (const order of orders) {
    const owner = (order.customerId as string | undefined) ?? idByEmail.get(order.customerEmail as string);
    if (!owner) continue;
    const current = stats.get(owner) ?? { orderCount: 0, totalSpent: 0 };
    current.orderCount += 1;
    current.totalSpent += order.total as number;
    const createdAt = (order.createdAt as Date).toISOString();
    if (!current.lastOrderAt || createdAt > current.lastOrderAt) current.lastOrderAt = createdAt;
    stats.set(owner, current);
  }

  for (const value of stats.values()) value.totalSpent = Math.round(value.totalSpent * 100) / 100;
  return stats;
}

function toCustomerJson(doc: InstanceType<typeof Customer>, groupName: string | null, stats?: OrderStats) {
  const json = doc.toJSON() as Record<string, unknown>;
  const { googleId, ...rest } = json;
  return {
    ...rest,
    hasPassword: Boolean(doc.passwordHash),
    hasGoogle: Boolean(googleId),
    groupId: doc.groupId ? String(doc.groupId) : null,
    groupName,
    orderCount: stats?.orderCount ?? 0,
    totalSpent: stats?.totalSpent ?? 0,
    lastOrderAt: stats?.lastOrderAt ?? null,
  };
}

router.get("/", requireAdmin("customers.view"), async (_req, res) => {
  try {
    await connectToDatabase();
    const [customers, groups] = await Promise.all([Customer.find().sort({ createdAt: -1 }), CustomerGroup.find()]);
    const groupNames = new Map(groups.map((group) => [String(group._id), group.name as string]));
    const stats = await loadOrderStats(customers.map((customer) => ({ id: customer.id as string, email: customer.email })));

    res.json(
      customers.map((customer) =>
        toCustomerJson(customer, customer.groupId ? (groupNames.get(String(customer.groupId)) ?? null) : null, stats.get(customer.id as string))
      )
    );
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/:id", requireAdmin("customers.view"), async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await Customer.findById(req.params.id).catch(() => null);
    if (!customer) return res.status(404).json({ error: "Customer not found." });

    const group = customer.groupId ? await CustomerGroup.findById(customer.groupId) : null;
    const stats = (await loadOrderStats([{ id: customer.id as string, email: customer.email }])).get(customer.id as string);

    const orders = await Order.find({
      $or: [{ customerId: customer.id }, ...(customer.email ? [{ customerEmail: customer.email }] : [])],
    })
      .sort({ createdAt: -1 })
      .limit(25);
    const reviewCount = await Review.countDocuments({ customerId: customer.id });

    res.json({ ...toCustomerJson(customer, group?.name ?? null, stats), reviewCount, orders });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.put("/:id", requireAdmin("customers.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await Customer.findById(req.params.id).catch(() => null);
    if (!customer) return res.status(404).json({ error: "Customer not found." });

    const body = req.body ?? {};
    if (typeof body.name === "string") {
      if (!body.name.trim()) throw new HttpError(400, "Name can't be empty.");
      customer.name = body.name.trim();
    }
    if (typeof body.isActive === "boolean") customer.isActive = body.isActive;
    if (typeof body.notes === "string") customer.notes = body.notes;
    if ("groupId" in body) {
      if (body.groupId === null || body.groupId === "") customer.groupId = null;
      else if (typeof body.groupId === "string" && mongoose.isValidObjectId(body.groupId) && (await CustomerGroup.exists({ _id: body.groupId }))) {
        customer.groupId = body.groupId;
      } else throw new HttpError(400, "That customer group doesn't exist.");
    }

    await customer.save();
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

// Removes the account only — their past orders and reviews stay (orders keep the name/email they were placed with).
router.delete("/:id", requireAdmin("customers.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const customer = await Customer.findByIdAndDelete(req.params.id).catch(() => null);
    if (!customer) return res.status(404).json({ error: "Customer not found." });
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
