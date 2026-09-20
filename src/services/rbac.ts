import { connectToDatabase } from "../db";
import { Role } from "../models/role";
import { DEFAULT_ROLES, SUPER_ADMIN_ROLE_KEY, WILDCARD_PERMISSION } from "../permissions";

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { at: number; permissions: string[] }>();

export function clearRoleCache() {
  cache.clear();
}

/**
 * Permissions for a role key: the database role wins (so edits on the Roles
 * page take effect), falling back to the built-in default of the same key
 * (so an un-seeded database still works), and finally to "nothing".
 * super-admin is always the wildcard, whatever the database says, so nobody
 * can lock themselves out of the whole admin by editing it.
 */
export async function getRolePermissions(roleKey: string): Promise<string[]> {
  if (roleKey === SUPER_ADMIN_ROLE_KEY) return [WILDCARD_PERMISSION];

  const cached = cache.get(roleKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.permissions;

  await connectToDatabase();
  const role = await Role.findOne({ key: roleKey });
  const permissions = role ? (role.permissions as string[]) : (DEFAULT_ROLES.find((r) => r.key === roleKey)?.permissions ?? []);

  cache.set(roleKey, { at: Date.now(), permissions });
  return permissions;
}
