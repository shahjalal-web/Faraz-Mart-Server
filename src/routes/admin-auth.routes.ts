import { Router } from "express";
import { connectToDatabase } from "../db";
import { AdminUser } from "../models/admin-user";
import { getFirebaseAuth } from "../firebase-admin";
import { ADMIN_SESSION_COOKIE, signAdminToken } from "../utils/jwt";
import { requireAdmin } from "../middleware/require-admin";

const router = Router();

const GENERIC_ERROR = "Invalid email or password.";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days, matches the JWT's own expiry

router.post("/login", async (req, res) => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";

  if (!idToken) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  // Firebase already confirmed the password when it issued this ID token on
  // the client — this call just verifies the token is genuine and unexpired.
  let decoded;
  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  if (!decoded.email) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  await connectToDatabase();

  // Being a valid Firebase user is not enough on its own — only an email
  // that's also registered here (with a role) counts as an admin.
  const admin = await AdminUser.findOne({ email: decoded.email.toLowerCase() });
  if (!admin || !admin.isActive) {
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
