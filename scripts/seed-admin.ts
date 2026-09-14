/**
 * One-time script to create the first Super Admin account.
 * Run with: npm run seed:admin (from inside backend/)
 * Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from backend/.env — remove
 * those lines once you've run this and logged in.
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectToDatabase } from "../src/db";
import { AdminUser } from "../src/models/admin-user";
import { hashPassword } from "../src/utils/password";
import mongoose from "mongoose";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env first.");
    process.exit(1);
  }

  await connectToDatabase();

  const passwordHash = await hashPassword(password);
  const existing = await AdminUser.findOne({ email });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    if (process.env.SEED_ADMIN_NAME?.trim()) existing.name = process.env.SEED_ADMIN_NAME.trim();
    await existing.save();
    console.log(`Existing admin ${email} updated with the password from backend/.env (role: ${existing.role}).`);
  } else {
    const admin = await AdminUser.create({
      name: process.env.SEED_ADMIN_NAME?.trim() || "Admin",
      email,
      passwordHash,
      role: "super-admin",
      isActive: true,
    });
    console.log(`Super Admin created: ${admin.email}`);
  }

  console.log("You can now log in at /admin/login with the SEED_ADMIN_PASSWORD you set.");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
