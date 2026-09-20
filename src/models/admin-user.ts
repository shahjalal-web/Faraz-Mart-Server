import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

/** A Role's `key` (see models/role.ts) — a string now, since admins can define custom roles. */
export type AdminRole = string;

const adminUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Firebase Authentication owns the actual password now — this just links
    // the Mongo profile/role record to the Firebase Auth user.
    firebaseUid: { type: String, required: true, unique: true },
    role: { type: String, default: "admin", required: true, lowercase: true, trim: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

applyIdTransform(adminUserSchema);

export type AdminUserDocument = InferSchemaType<typeof adminUserSchema>;

export const AdminUser = mongoose.models.AdminUser ?? mongoose.model("AdminUser", adminUserSchema);
