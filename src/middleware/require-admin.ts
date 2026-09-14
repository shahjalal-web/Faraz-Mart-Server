import type { NextFunction, Request, Response } from "express";
import { ADMIN_SESSION_COOKIE, verifyAdminToken, type AdminTokenPayload } from "../utils/jwt";
import type { AdminRole } from "../models/admin-user";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

/**
 * The data-layer verification gate: every admin API route calls this so it
 * independently re-checks the JWT before touching the database, instead of
 * trusting that the request only got here because the frontend's own page
 * gate (proxy.ts, in the Next.js app) already approved it.
 */
export function requireAdmin(allowedRoles?: AdminRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (!token) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    const payload = await verifyAdminToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
      return res.status(403).json({ error: "You don't have permission to do this." });
    }

    req.admin = payload;
    next();
  };
}
