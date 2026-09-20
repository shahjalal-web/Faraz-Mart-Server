import { Router } from "express";
import { connectToDatabase } from "../db";
import { Order } from "../models/order";
import { Product } from "../models/product";
import { Review } from "../models/review";
import { Customer } from "../models/customer";
import { requireAdmin } from "../middleware/require-admin";
import { getSettings } from "../services/settings";
import { hasPermission } from "../permissions";
import { errorMessage, errorStatus } from "../utils/errors";

const router = Router();

/**
 * In-app admin alerts (the header bell). Which ones appear depends on both
 * Settings > Notifications (what the store cares about) and the admin's own
 * permissions (nobody gets an alert linking to a page they can't open).
 */
router.get("/", requireAdmin(), async (req, res) => {
  try {
    await connectToDatabase();
    const admin = req.admin!;
    const { notifications } = await getSettings();
    const can = (permission: string) => hasPermission(admin.permissions, permission);

    const items: { key: string; label: string; count: number; href: string }[] = [];

    if (notifications.newOrder && can("orders.view")) {
      const count = await Order.countDocuments({ status: "pending" });
      items.push({ key: "pending-orders", label: count === 1 ? "order waiting to be confirmed" : "orders waiting to be confirmed", count, href: "/admin/orders?status=pending" });
    }
    if (notifications.lowStock && can("inventory.view")) {
      const count = await Product.countDocuments({ stockStatus: { $in: ["low-stock", "out-of-stock"] } });
      items.push({ key: "low-stock", label: count === 1 ? "product low or out of stock" : "products low or out of stock", count, href: "/admin/inventory" });
    }
    if (notifications.newReview && can("reviews.view")) {
      const count = await Review.countDocuments({ status: "pending" });
      items.push({ key: "pending-reviews", label: count === 1 ? "review awaiting moderation" : "reviews awaiting moderation", count, href: "/admin/reviews" });
    }
    if (notifications.newCustomer && can("customers.view")) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const count = await Customer.countDocuments({ createdAt: { $gte: since } });
      items.push({ key: "new-customers", label: count === 1 ? "new customer this week" : "new customers this week", count, href: "/admin/customers" });
    }

    const visible = items.filter((item) => item.count > 0);
    res.json({ total: visible.reduce((sum, item) => sum + item.count, 0), items: visible });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
