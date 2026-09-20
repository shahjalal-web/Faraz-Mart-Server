import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const COUPON_TYPES = ["percentage", "fixed", "free-shipping"] as const;

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: "" },
    type: { type: String, enum: COUPON_TYPES, required: true },
    value: { type: Number, default: 0, min: 0 },
    minOrderAmount: { type: Number, min: 0 },
    // Caps a percentage coupon (e.g. "10% off, up to $20").
    maxDiscountAmount: { type: Number, min: 0 },
    // 0 / unset = unlimited.
    usageLimit: { type: Number, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(couponSchema);

export const Coupon = mongoose.models.Coupon ?? mongoose.model("Coupon", couponSchema);
