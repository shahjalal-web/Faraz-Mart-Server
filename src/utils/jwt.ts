import { jwtVerify, SignJWT } from "jose";
import type { AdminRole } from "../models/admin-user";

export const ADMIN_SESSION_COOKIE = "faraz_admin_session";
const JWT_ALG = "HS256";

export interface AdminTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: AdminRole;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Add it to backend/.env before using admin auth.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Only the backend signs tokens now — the frontend keeps its own read-only
 * copy of `verifyAdminToken` (see fazar-mart/lib/auth/jwt.ts) so it can check
 * the JWT once at the page-navigation layer without calling this service.
 * Both sides MUST share the same JWT_SECRET for that shared check to work.
 *
 * `sessionDays` comes from Settings > Security so an owner can shorten how
 * long a stolen/forgotten login stays valid.
 */
export async function signAdminToken(payload: AdminTokenPayload, sessionDays = 7): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(`${sessionDays}d`)
    .sign(getSecretKey());
}

export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.sub === "string" &&
      typeof payload.email === "string" &&
      typeof payload.name === "string" &&
      typeof payload.role === "string"
    ) {
      return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
      };
    }
    return null;
  } catch {
    return null;
  }
}
