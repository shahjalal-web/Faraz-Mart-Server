import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import adminAuthRoutes from "./routes/admin-auth.routes";
import customerAuthRoutes from "./routes/customer-auth.routes";
import productsRoutes from "./routes/products.routes";
import categoriesRoutes from "./routes/categories.routes";
import ordersRoutes from "./routes/orders.routes";

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
  app.use("/api/admin/auth", adminAuthRoutes);
  app.use("/api/customers/auth", customerAuthRoutes);
  // Products/Categories: GET is public (storefront), write routes inside
  // each file are individually gated by requireAdmin(). Orders: POST is
  // public (checkout, no customer accounts yet), list/status-update require
  // admin — see the comments in orders.routes.ts for why.
  app.use("/api/products", productsRoutes);
  app.use("/api/categories", categoriesRoutes);
  app.use("/api/orders", ordersRoutes);

  return app;
}
