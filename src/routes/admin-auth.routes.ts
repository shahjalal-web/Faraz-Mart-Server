import { Router } from "express";
import { connectToDatabase } from "../db";
import { AdminUser } from "../models/admin-user";
import { verifyPassword } from "../utils/password";
import { ADMIN_SESSION_COOKIE, signAdminToken } from "../utils/jwt";
import { requireAdmin } from "../middleware/require-admin";

const router = Router();

const GENERIC_ERROR = "Invalid email or password.";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, matches the JWT's own expiry

router.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  await connectToDatabase();

  const admin = await AdminUser.findOne({ email });
  if (!admin || !admin.isActive) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  const isValidPassword = await verifyPassword(password, admin.passwordHash);
  if (!isValidPassword) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  const token = await signAdminToken({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  admin.lastLoginAt = new Date();
  await admin.save();

  res.cookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });

  res.json({ admin: { name: admin.name, email: admin.email, role: admin.role } });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

// Protected by requireAdmin() itself, so this endpoint also doubles as a
// live example of the data-layer gate: no valid session, no response body.
router.get("/me", requireAdmin(), (req, res) => {
  res.json({ admin: req.admin });
});

export default router;
