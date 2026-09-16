import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { connectToDatabase } from "../db";
import { Customer } from "../models/customer";
import { hashPassword, verifyPassword } from "../utils/password";
import { CUSTOMER_SESSION_COOKIE, signCustomerToken } from "../utils/customer-jwt";
import { requireCustomer } from "../middleware/require-customer";
import { errorMessage } from "../utils/errors";

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
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  await connectToDatabase();

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

  const token = await signCustomerToken({ sub: customer.id, name: customer.name, email: customer.email, phone: customer.phone });
  setSessionCookie(res, token);
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
