import { Router } from "express";
import { connectToDatabase } from "../db";
import { Role } from "../models/role";
import { AdminUser } from "../models/admin-user";
import { requireAdmin } from "../middleware/require-admin";
import { clearRoleCache } from "../services/rbac";
import {
  ALL_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLES,
  PERMISSION_RESOURCES,
  SUPER_ADMIN_ROLE_KEY,
} from "../permissions";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";
import { slugify } from "../utils/slug";

const router = Router();

/** Makes sure the built-in roles exist in the database (idempotent). Called on startup and by the seed script. */
export async function ensureDefaultRoles() {
  await connectToDatabase();
  for (const role of DEFAULT_ROLES) {
    await Role.updateOne(
      { key: role.key },
      { $setOnInsert: { key: role.key, name: role.name, description: role.description, permissions: role.permissions, isSystem: true } },
      { upsert: true }
    );
  }
}

function cleanPermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "Permissions must be a list.");
  const unique = [...new Set(raw.filter((p): p is string => typeof p === "string"))];
  const unknown = unique.filter((p) => !ALL_PERMISSION_KEYS.includes(p));
  if (unknown.length > 0) throw new HttpError(400, `Unknown permission: ${unknown[0]}`);
  return unique;
}

// Needed by more than the Roles screens: the admin-user form lists roles too.
router.get("/", requireAdmin(["roles.view", "admin-users.view"]), async (_req, res) => {
  try {
    await connectToDatabase();
    const [roles, members] = await Promise.all([Role.find().sort({ isSystem: -1, createdAt: 1 }), AdminUser.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])]);
    const counts = new Map<string, number>(members.map((row) => [row._id as string, row.count as number]));
    res.json(roles.map((role) => ({ ...role.toJSON(), memberCount: counts.get(role.key as string) ?? 0 })));
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.get("/permissions", requireAdmin(["roles.view", "admin-users.view"]), (_req, res) => {
  res.json({ resources: PERMISSION_RESOURCES, permissions: ALL_PERMISSIONS });
});

router.post("/", requireAdmin("roles.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) throw new HttpError(400, "Give the role a name.");

    const key = slugify(name);
    if (!key) throw new HttpError(400, "Role names need at least one letter or number.");
    if (await Role.exists({ key })) throw new HttpError(409, "A role with that name already exists.");

    const role = await Role.create({
      key,
      name,
      description: typeof req.body?.description === "string" ? req.body.description.trim() : "",
      permissions: cleanPermissions(req.body?.permissions ?? []),
      isSystem: false,
    });
    clearRoleCache();
    res.status(201).json(role);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.put("/:id", requireAdmin("roles.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const role = await Role.findById(req.params.id).catch(() => null);
    if (!role) return res.status(404).json({ error: "Role not found." });
    if (role.key === SUPER_ADMIN_ROLE_KEY) throw new HttpError(400, "Super Admin always has full access and can't be edited.");

    if (typeof req.body?.name === "string") {
      if (!req.body.name.trim()) throw new HttpError(400, "Give the role a name.");
      role.name = req.body.name.trim();
    }
    if (typeof req.body?.description === "string") role.description = req.body.description.trim();
    if ("permissions" in (req.body ?? {})) role.permissions = cleanPermissions(req.body.permissions);

    await role.save();
    clearRoleCache();
    res.json(role);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", requireAdmin("roles.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const role = await Role.findById(req.params.id).catch(() => null);
    if (!role) return res.status(404).json({ error: "Role not found." });
    if (role.isSystem) throw new HttpError(400, "Built-in roles can't be deleted.");

    const members = await AdminUser.countDocuments({ role: role.key });
    if (members > 0) throw new HttpError(400, `${members} admin user${members === 1 ? " is" : "s are"} still assigned this role — reassign them first.`);

    await role.deleteOne();
    clearRoleCache();
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
