import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const addressSchema = new Schema(
  {
    label: { type: String, trim: true, default: "" },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);
applyIdTransform(addressSchema);

/**
 * Deliberately NOT routed through Firebase (unlike admin auth) — a customer
 * can sign up with email+password, phone+password, or Google, and at least
 * one identifier plus a way to authenticate is required (enforced in
 * customer-auth.routes.ts, the only two places that create a Customer).
 * Keeping this on our own MongoDB + bcrypt + JWT means it has no dependency
 * on the Firebase project's health (which once got suspended by Google and
 * took admin login down with it — see WORK-HISTORY.md). Google sign-in here
 * verifies the Google ID token directly via google-auth-library, not via Firebase.
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
    // Customer Groups (admin-defined) — Promotions can target a group.
    groupId: { type: Schema.Types.ObjectId, ref: "CustomerGroup", default: null },
    // Private staff notes; never sent to the storefront.
    notes: { type: String, default: "" },
    lastLoginAt: { type: Date },
    addresses: { type: [addressSchema], default: [] },
    // Just product ids — display details (name/price/thumbnail) are always
    // re-read live from Product, never cached here, so they can't go stale.
    wishlistProductIds: { type: [String], default: [] },
    // Forgot-password flow: a bcrypt hash of the one-time token (never the raw token) plus its expiry.
    resetPasswordTokenHash: { type: String },
    resetPasswordExpiresAt: { type: Date },
  },
  { timestamps: true }
);

applyIdTransform(customerSchema, ["passwordHash", "resetPasswordTokenHash", "resetPasswordExpiresAt"]);

export type CustomerDocument = InferSchemaType<typeof customerSchema>;

export const Customer = mongoose.models.Customer ?? mongoose.model("Customer", customerSchema);
