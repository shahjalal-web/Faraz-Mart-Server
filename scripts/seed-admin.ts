/**
 * One-time script to create the first Super Admin account.
 * Run with: npm run seed:admin (from inside backend/)
 * Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME from
 * backend/.env — remove those lines once you've run this and logged in.
 *
 * Creates (or updates) the real credential in Firebase Authentication, then
 * upserts the matching role/profile record in MongoDB, linked by UID.
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectToDatabase } from "../src/db";
import { AdminUser } from "../src/models/admin-user";
import { getFirebaseAuth } from "../src/firebase-admin";
import mongoose from "mongoose";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Admin";

  if (!email || !password) {
    console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env first.");
    process.exit(1);
  }

  const auth = getFirebaseAuth();

  let firebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(email);
    // Re-runnable on purpose: if the password in backend/.env changes, this
    // resets it in Firebase instead of silently leaving the old one active.
    firebaseUser = await auth.updateUser(firebaseUser.uid, { password, displayName: name, disabled: false });
    console.log(`Existing Firebase user ${email} updated with the password from backend/.env.`);
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") {
      firebaseUser = await auth.createUser({ email, password, displayName: name });
      console.log(`Firebase user created: ${email}`);
    } else {
      throw error;
    }
  }

  await connectToDatabase();

  const existing = await AdminUser.findOne({ email });
  if (existing) {
    existing.firebaseUid = firebaseUser.uid;
    existing.isActive = true;
    existing.name = name;
    await existing.save();
    console.log(`Mongo profile for ${email} updated (role: ${existing.role}).`);
  } else {
    const admin = await AdminUser.create({
      name,
      email,
      firebaseUid: firebaseUser.uid,
      role: "super-admin",
      isActive: true,
    });
    console.log(`Mongo Super Admin profile created: ${admin.email}`);
  }

  console.log("You can now log in at /admin/login with the SEED_ADMIN_PASSWORD you set.");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
