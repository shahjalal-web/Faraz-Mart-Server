import crypto from "node:crypto";
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { connectToDatabase } from "../db";
import { Customer } from "../models/customer";
import { hashPassword, verifyPassword } from "../utils/password";
import { CUSTOMER_SESSION_COOKIE, signCustomerToken } from "../utils/customer-jwt";
import { requireCustomer } from "../middleware/require-customer";
import { errorMessage } from "../utils/errors";
import { getSettings } from "../services/settings";
import { sendMail } from "../utils/mailer";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
// Always the same wording whether or not the account exists — otherwise this endpoint
// becomes a way to check which emails/phones have an account (user enumeration).
const FORGOT_PASSWORD_GENERIC_MESSAGE = "If an account exists for that email or phone number, we've sent a password reset link.";

const router = Router();

const GENERIC_LOGIN_ERROR = "Invalid email/phone or password.";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days, matches the JWT's own expiry

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
}

function publicCustomer(customer: InstanceType<typeof Customer>) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    avatarUrl: customer.avatarUrl,
  };
}

router.post("/register", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!name || !password || (!email && !phone)) {
    return res.status(400).json({ error: "Name, password and an email or phone number are required." });
  }

  await connectToDatabase();

  const { security } = await getSettings();
  if (!security.allowCustomerRegistration) {
    return res.status(403).json({ error: "New account registration is currently closed." });
  }
  if (password.length < security.minPasswordLength) {
    return res.status(400).json({ error: `Password must be at least ${security.minPasswordLength} characters.` });
  }

  if (email && (await Customer.exists({ email }))) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  if (phone && (await Customer.exists({ phone }))) {
    return res.status(409).json({ error: "An account with this phone number already exists." });
  }

  try {
    const passwordHash = await hashPassword(password);
    const customer = await Customer.create({
      name,
      email: email || undefined,
      phone: phone || undefined,
      passwordHash,
    });

    const token = await signCustomerToken({ sub: customer.id, name: customer.name, email: customer.email, phone: customer.phone });
    setSessionCookie(res, token);
    res.status(201).json({ customer: publicCustomer(customer) });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/login", async (req, res) => {
  const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!identifier || !password) {
    return res.status(400).json({ error: GENERIC_LOGIN_ERROR });
  }

  await connectToDatabase();

  const normalized = identifier.toLowerCase();
  const customer = await Customer.findOne({ $or: [{ email: normalized }, { phone: identifier }] });
  if (!customer || !customer.isActive || !customer.passwordHash) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  const isValidPassword = await verifyPassword(password, customer.passwordHash);
  if (!isValidPassword) {
    return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
  }

  customer.lastLoginAt = new Date();
  await customer.save();

  const token = await signCustomerToken({ sub: customer.id, name: customer.name, email: customer.email, phone: customer.phone });
  setSessionCookie(res, token);
  res.json({ customer: publicCustomer(customer) });
});

router.post("/google", async (req, res) => {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (!clientId) {
    return res.status(501).json({ error: "Google sign-in isn't configured on the server yet." });
  }
  if (!idToken) {
    return res.status(400).json({ error: "Missing Google credential." });
  }

  let payload;
  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "Couldn't verify your Google account." });
  }

  if (!payload?.sub || !payload.email) {
    return res.status(401).json({ error: "Couldn't verify your Google account." });
  }

  await connectToDatabase();

  let customer = await Customer.findOne({ googleId: payload.sub });
  if (!customer) {
    // Link to an existing password account with the same email, if any,
    // instead of creating a duplicate — otherwise create a fresh one.
    customer = await Customer.findOne({ email: payload.email.toLowerCase() });
    if (customer) {
      customer.googleId = payload.sub;
      if (payload.picture) customer.avatarUrl = payload.picture;
      await customer.save();
    } else {
      const { security } = await getSettings();
      if (!security.allowCustomerRegistration) {
        return res.status(403).json({ error: "New account registration is currently closed." });
      }
      customer = await Customer.create({
        name: payload.name ?? payload.email.split("@")[0],
        email: payload.email.toLowerCase(),
        googleId: payload.sub,
        avatarUrl: payload.picture,
      });
    }
  }

  if (!customer.isActive) {
    return res.status(401).json({ error: "This account has been disabled." });
  }

  customer.lastLoginAt = new Date();
  await customer.save();

  const token = await signCustomerToken({ sub: customer.id, name: customer.name, email: customer.email, phone: customer.phone });
  setSessionCookie(res, token);
  res.json({ customer: publicCustomer(customer) });
});

router.post("/forgot-password", async (req, res) => {
  const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
  if (!identifier) {
    return res.status(400).json({ error: "Enter your email or phone number." });
  }

  await connectToDatabase();

  const normalized = identifier.toLowerCase();
  const customer = await Customer.findOne({ $or: [{ email: normalized }, { phone: identifier }] });
  let devResetLink: string | undefined;

  if (customer && customer.isActive) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    customer.resetPasswordTokenHash = await hashPassword(rawToken);
    customer.resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await customer.save();

    const frontendUrl = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",")[0].trim();
    const resetLink = `${frontendUrl}/reset-password?id=${customer.id}&token=${rawToken}`;
    const to = customer.email || customer.phone || "";
    await sendMail({
      to,
      subject: "Reset your Faraz Mart password",
      text: `We received a request to reset your Faraz Mart password. This link expires in 1 hour:\n\n${resetLink}\n\nIf you didn't request this, you can safely ignore this message.`,
    }).catch(() => {
      // A failed/unconfigured mail provider must never leak into the (generic) API response.
    });
    // No real mail provider is wired up yet (see utils/mailer.ts) — outside production,
    // hand the link back directly so the reset flow is actually testable end to end.
    if (process.env.NODE_ENV !== "production") devResetLink = resetLink;
  }

  res.json({ message: FORGOT_PASSWORD_GENERIC_MESSAGE, ...(devResetLink ? { devResetLink } : {}) });
});

router.post("/reset-password", async (req, res) => {
  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!id || !token || !password) {
    return res.status(400).json({ error: "This reset link is invalid." });
  }

  await connectToDatabase();

  const { security } = await getSettings();
  if (password.length < security.minPasswordLength) {
    return res.status(400).json({ error: `Password must be at least ${security.minPasswordLength} characters.` });
  }

  const customer = await Customer.findById(id);
  if (!customer || !customer.resetPasswordTokenHash || !customer.resetPasswordExpiresAt || customer.resetPasswordExpiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
  }

  const isValidToken = await verifyPassword(token, customer.resetPasswordTokenHash);
  if (!isValidToken) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
  }

  customer.passwordHash = await hashPassword(password);
  customer.resetPasswordTokenHash = undefined;
  customer.resetPasswordExpiresAt = undefined;
  await customer.save();

  const sessionToken = await signCustomerToken({ sub: customer.id, name: customer.name, email: customer.email, phone: customer.phone });
  setSessionCookie(res, sessionToken);
  res.json({ customer: publicCustomer(customer) });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(CUSTOMER_SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

router.get("/me", requireCustomer(), async (req, res) => {
  await connectToDatabase();
  const customer = await Customer.findById(req.customer?.sub);
  if (!customer) return res.status(401).json({ error: "Not authenticated." });
  res.json({ customer: publicCustomer(customer) });
});

export default router;
