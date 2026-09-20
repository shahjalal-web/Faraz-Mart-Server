import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export const DISCOUNT_SCOPES = ["all", "categories", "products", "brands"] as const;

/** Automatic, time-boxed sale price applied to matching products — no code needed. */
const discountSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    type: { type: String, enum: DISCOUNT_TYPES, required: true },
    // Percent (0–100) for "percentage", amount taken off each unit for "fixed".
    value: { type: Number, required: true, min: 0 },
    scope: { type: String, enum: DISCOUNT_SCOPES, default: "all", required: true },
    // Category ids, product ids or brand names depending on `scope`.
    targetIds: { type: [String], default: [] },
    startsAt: { type: Date },
    endsAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(discountSchema);

export const Discount = mongoose.models.Discount ?? mongoose.model("Discount", discountSchema);
