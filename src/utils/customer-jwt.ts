import { jwtVerify, SignJWT } from "jose";

export const CUSTOMER_SESSION_COOKIE = "faraz_customer_session";
const JWT_ALG = "HS256";
const SESSION_DURATION = "30d";

export interface CustomerTokenPayload {
  sub: string;
  name: string;
  email?: string;
  phone?: string;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Add it to backend/.env before using customer auth.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Same JWT_SECRET as admin tokens (one secret to manage), but a distinct
 * cookie name and payload shape (no `role` field) — requireAdmin() and
 * verifyAdminToken() both require `role` to be a string, so a customer
 * token can never be mistaken for an admin one even if someone tried
 * swapping cookie values.
 */
export async function signCustomerToken(payload: CustomerTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecretKey());
}

export async function verifyCustomerToken(token: string): Promise<CustomerTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.sub === "string" && typeof payload.name === "string") {
      return {
        sub: payload.sub,
        name: payload.name,
        email: typeof payload.email === "string" ? payload.email : undefined,
        phone: typeof payload.phone === "string" ? payload.phone : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}
