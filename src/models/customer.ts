import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

/**
 * Deliberately NOT routed through Firebase (unlike admin auth) — a customer
 * can sign up with email+password, phone+password, or Google, and at least
 * one identifier plus a way to authenticate is required (enforced in
 * customer-auth.routes.ts, the only two places that create a Customer).
 * Keeping this on
 * our own MongoDB + bcrypt + JWT means it has no dependency on the Firebase
 * project's health (which just got suspended by Google and took admin login
 * down with it — see WORK-HISTORY.md). Google sign-in here verifies the
 * Google ID token directly via google-auth-library, not via Firebase.
 */
const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    avatarUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(customerSchema);

export type CustomerDocument = InferSchemaType<typeof customerSchema>;

export const Customer = mongoose.models.Customer ?? mongoose.model("Customer", customerSchema);
