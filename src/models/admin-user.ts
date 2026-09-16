import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const ADMIN_ROLES = [
  "super-admin",
  "admin",
  "manager",
  "order-manager",
  "product-manager",
  "support-agent",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

const adminUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Firebase Authentication owns the actual password now — this just links
    // the Mongo profile/role record to the Firebase Auth user.
    firebaseUid: { type: String, required: true, unique: true },
    role: { type: String, enum: ADMIN_ROLES, default: "admin", required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

export type AdminUserDocument = InferSchemaType<typeof adminUserSchema>;

export const AdminUser = mongoose.models.AdminUser ?? mongoose.model("AdminUser", adminUserSchema);
