import type { NextFunction, Request, Response } from "express";
import { connectToDatabase } from "../db";
import { AdminUser } from "../models/admin-user";
import { ADMIN_SESSION_COOKIE, verifyAdminToken, type AdminTokenPayload } from "../utils/jwt";
import { getRolePermissions } from "../services/rbac";
import { hasPermission } from "../permissions";

export interface AuthenticatedAdmin extends AdminTokenPayload {
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdmin;
    }
  }
}

/**
 * Resolves the admin behind a request — or null. This deliberately re-reads
 * the admin's account and role from the database instead of trusting what
 * the JWT claims, so deactivating an admin or changing their role takes
 * effect on their very next request rather than whenever their token expires.
 */
export async function resolveAdmin(req: Request): Promise<AuthenticatedAdmin | null> {
  const token = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (!token) return null;

  const payload = await verifyAdminToken(token);
  if (!payload) return null;

  await connectToDatabase();
  const account = await AdminUser.findById(payload.sub).catch(() => null);
  if (!account || !account.isActive) return null;

  const permissions = await getRolePermissions(account.role);
  return { sub: payload.sub, email: account.email, name: account.name, role: account.role, permissions };
}

/**
 * The data-layer verification gate: every admin API route calls this so it
 * independently re-checks the session before touching the database, instead
 * of trusting that the request only got here because the frontend's own page
 * gate (proxy.ts, in the Next.js app) already approved it.
 *
 * Pass a permission key ("orders.manage") — or several, any of which is
 * enough — to also require that the admin's role grants it.
 */
export function requireAdmin(permission?: string | string[]) {
  const needed = permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.cookies?.[ADMIN_SESSION_COOKIE]) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    const admin = await resolveAdmin(req);
    if (!admin) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    if (needed.length > 0 && !needed.some((key) => hasPermission(admin.permissions, key))) {
      return res.status(403).json({ error: "You don't have permission to do this." });
    }

    req.admin = admin;
    next();
  };
}

/** True when the request comes from a signed-in admin whose role grants `permission` — never rejects anonymous visitors. */
export async function adminCan(req: Request, permission: string): Promise<boolean> {
  const admin = await resolveAdmin(req);
  return admin !== null && hasPermission(admin.permissions, permission);
}
