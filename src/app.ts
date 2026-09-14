import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import adminAuthRoutes from "./routes/admin-auth.routes";

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

  return app;
}
