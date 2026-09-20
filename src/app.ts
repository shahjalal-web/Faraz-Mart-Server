import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import adminAuthRoutes from "./routes/admin-auth.routes";
import adminUsersRoutes from "./routes/admin-users.routes";
import rolesRoutes from "./routes/roles.routes";
import settingsRoutes from "./routes/settings.routes";
import notificationsRoutes from "./routes/notifications.routes";
import customerAuthRoutes from "./routes/customer-auth.routes";
import customerAccountRoutes from "./routes/customer-account.routes";
import customersRoutes from "./routes/customers.routes";
import customerGroupsRoutes from "./routes/customer-groups.routes";
import productsRoutes from "./routes/products.routes";
import categoriesRoutes from "./routes/categories.routes";
import brandsRoutes from "./routes/brands.routes";
import attributesRoutes from "./routes/attributes.routes";
import inventoryRoutes from "./routes/inventory.routes";
import ordersRoutes from "./routes/orders.routes";
import checkoutRoutes from "./routes/checkout.routes";
import reviewsRoutes from "./routes/reviews.routes";
import analyticsRoutes from "./routes/analytics.routes";
import { announcementsRouter, faqRouter, homepageRouter, pagesRouter } from "./routes/content.routes";
import { bannersRouter, campaignsRouter, couponsRouter, discountsRouter, promotionsRouter } from "./routes/marketing.routes";

export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim());

  // credentials: true + an explicit origin (never "*") is required so the
  // browser will actually attach/accept the httpOnly session cookie across
  // the frontend (localhost:3000) <-> backend (localhost:4000) origins.
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Auth
  app.use("/api/admin/auth", adminAuthRoutes);
  app.use("/api/admin/notifications", notificationsRoutes);
  app.use("/api/customers/auth", customerAuthRoutes);
  app.use("/api/account", customerAccountRoutes);

  // Administration
  app.use("/api/admin-users", adminUsersRoutes);
  app.use("/api/roles", rolesRoutes);
  app.use("/api/settings", settingsRoutes);

  // Every resource below is either public-read + admin-write (storefront
  // content) or fully admin-only (private data) — each router says which, and
  // every write is gated by requireAdmin("<resource>.manage") per route.
  app.use("/api/products", productsRoutes);
  app.use("/api/categories", categoriesRoutes);
  app.use("/api/brands", brandsRoutes);
  app.use("/api/attributes", attributesRoutes);
  app.use("/api/inventory", inventoryRoutes);

  app.use("/api/customers", customersRoutes);
  app.use("/api/customer-groups", customerGroupsRoutes);
  app.use("/api/reviews", reviewsRoutes);

  // Orders: POST is public (guest checkout is allowed); list/status-update
  // require admin. /api/checkout/quote is the shared price calculation.
  app.use("/api/orders", ordersRoutes);
  app.use("/api/checkout", checkoutRoutes);

  app.use("/api/coupons", couponsRouter);
  app.use("/api/discounts", discountsRouter);
  app.use("/api/promotions", promotionsRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/banners", bannersRouter);

  app.use("/api/homepage-config", homepageRouter);
  app.use("/api/pages", pagesRouter);
  app.use("/api/faq", faqRouter);
  app.use("/api/announcements", announcementsRouter);

  app.use("/api/analytics", analyticsRoutes);

  // Last-resort JSON error handler (Express 5 forwards rejected async handlers here).
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    console.error("Unhandled error:", error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}
