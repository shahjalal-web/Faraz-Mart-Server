import { Router } from "express";
import { connectToDatabase } from "../db";
import { AdminUser } from "../models/admin-user";
import { Role } from "../models/role";
import { getFirebaseAuth } from "../firebase-admin";
import { requireAdmin } from "../middleware/require-admin";
import { getSettings } from "../services/settings";
import { SUPER_ADMIN_ROLE_KEY } from "../permissions";
import { errorMessage, errorStatus, HttpError } from "../utils/errors";

const router = Router();

function isFirebaseError(error: unknown, code: string) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === code;
}

async function assertRoleExists(key: string) {
  if (!(await Role.exists({ key }))) throw new HttpError(400, "That role doesn't exist.");
}

async function activeSuperAdminCount(excludingId?: string) {
  return AdminUser.countDocuments({
    role: SUPER_ADMIN_ROLE_KEY,
    isActive: true,
    ...(excludingId ? { _id: { $ne: excludingId } } : {}),
  });
}

// Only a Super Admin may create, change, demote or remove another Super Admin.
function assertMayTouchSuperAdmins(actorRole: string, ...involvedRoles: (string | undefined)[]) {
  if (actorRole !== SUPER_ADMIN_ROLE_KEY && involvedRoles.includes(SUPER_ADMIN_ROLE_KEY)) {
    throw new HttpError(403, "Only a Super Admin can do that with a Super Admin account.");
  }
}

router.get("/", requireAdmin("admin-users.view"), async (_req, res) => {
  try {
    await connectToDatabase();
    const [admins, roles] = await Promise.all([AdminUser.find().sort({ createdAt: 1 }), Role.find().select("key name")]);
    const roleNames = new Map(roles.map((role) => [role.key as string, role.name as string]));

    res.json(
      admins.map((admin) => {
        const { firebaseUid: _firebaseUid, ...rest } = admin.toJSON() as Record<string, unknown>;
        void _firebaseUid;
        return { ...rest, roleName: roleNames.get(admin.role as string) ?? admin.role };
      })
    );
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/** Body: { name, email, password, role } — creates the Firebase login and the role/profile record together. */
router.post("/", requireAdmin("admin-users.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const actor = req.admin!;

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const role = typeof req.body?.role === "string" ? req.body.role : "";

    if (!name || !email || !password || !role) throw new HttpError(400, "Name, email, password and role are all required.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");

    const { security } = await getSettings();
    if (password.length < security.minPasswordLength) {
      throw new HttpError(400, `Password must be at least ${security.minPasswordLength} characters.`);
    }

    await assertRoleExists(role);
    assertMayTouchSuperAdmins(actor.role, role);
    if (await AdminUser.exists({ email })) throw new HttpError(409, "An admin with that email already exists.");

    const auth = getFirebaseAuth();
    let firebaseUser;
    try {
      firebaseUser = await auth.createUser({ email, password, displayName: name });
    } catch (error) {
      if (!isFirebaseError(error, "auth/email-already-exists")) throw error;
      // A leftover Firebase login for this email (e.g. from a removed admin): take it over with the new password.
      const existing = await auth.getUserByEmail(email);
      firebaseUser = await auth.updateUser(existing.uid, { password, displayName: name, disabled: false });
    }

    const admin = await AdminUser.create({ name, email, firebaseUid: firebaseUser.uid, role, isActive: true });
    res.status(201).json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role, isActive: admin.isActive });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

/** Body (all optional): { name, role, isActive, password } */
router.put("/:id", requireAdmin("admin-users.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const actor = req.admin!;
    const admin = await AdminUser.findById(req.params.id).catch(() => null);
    if (!admin) return res.status(404).json({ error: "Admin user not found." });

    const isSelf = admin.id === actor.sub;
    const body = req.body ?? {};
    const nextRole = typeof body.role === "string" ? body.role : (admin.role as string);
    const nextActive = typeof body.isActive === "boolean" ? body.isActive : (admin.isActive as boolean);

    assertMayTouchSuperAdmins(actor.role, admin.role as string, nextRole);

    if (isSelf && (nextRole !== admin.role || nextActive === false)) {
      throw new HttpError(400, "You can't change your own role or deactivate yourself — ask another admin.");
    }
    if (typeof body.role === "string" && body.role !== admin.role) await assertRoleExists(body.role);

    const losesSuperAdmin = admin.role === SUPER_ADMIN_ROLE_KEY && admin.isActive && (nextRole !== SUPER_ADMIN_ROLE_KEY || !nextActive);
    if (losesSuperAdmin && (await activeSuperAdminCount(admin.id)) === 0) {
      throw new HttpError(400, "That would leave the store with no active Super Admin.");
    }

    const auth = getFirebaseAuth();
    const firebaseChanges: Record<string, unknown> = {};

    if (typeof body.name === "string") {
      if (!body.name.trim()) throw new HttpError(400, "Name can't be empty.");
      admin.name = body.name.trim();
      firebaseChanges.displayName = admin.name;
    }
    if (typeof body.password === "string" && body.password !== "") {
      const { security } = await getSettings();
      if (body.password.length < security.minPasswordLength) {
        throw new HttpError(400, `Password must be at least ${security.minPasswordLength} characters.`);
      }
      firebaseChanges.password = body.password;
    }
    admin.role = nextRole;
    if (nextActive !== admin.isActive) firebaseChanges.disabled = !nextActive;
    admin.isActive = nextActive;

    if (Object.keys(firebaseChanges).length > 0) {
      await auth.updateUser(admin.firebaseUid as string, firebaseChanges);
    }
    await admin.save();

    res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role, isActive: admin.isActive });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

router.delete("/:id", requireAdmin("admin-users.manage"), async (req, res) => {
  try {
    await connectToDatabase();
    const actor = req.admin!;
    const admin = await AdminUser.findById(req.params.id).catch(() => null);
    if (!admin) return res.status(404).json({ error: "Admin user not found." });

    if (admin.id === actor.sub) throw new HttpError(400, "You can't delete your own account.");
    assertMayTouchSuperAdmins(actor.role, admin.role as string);
    if (admin.role === SUPER_ADMIN_ROLE_KEY && admin.isActive && (await activeSuperAdminCount(admin.id)) === 0) {
      throw new HttpError(400, "That would leave the store with no active Super Admin.");
    }

    try {
      await getFirebaseAuth().deleteUser(admin.firebaseUid as string);
    } catch (error) {
      if (!isFirebaseError(error, "auth/user-not-found")) throw error;
    }
    await admin.deleteOne();
    res.json({ success: true });
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;
