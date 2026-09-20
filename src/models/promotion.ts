import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const PROMOTION_TYPES = ["percentage", "fixed", "free-shipping"] as const;

/** Automatic order-level offer ("spend $100, get 10% off", "VIPs ship free") — applied at checkout without a code. */
const promotionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    type: { type: String, enum: PROMOTION_TYPES, required: true },
    value: { type: Number, default: 0, min: 0 },
    minSubtotal: { type: Number, default: 0, min: 0 },
    // Empty = everyone, including guests. Otherwise only signed-in customers in one of these groups.
    customerGroupIds: { type: [String], default: [] },
    startsAt: { type: Date },
    endsAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(promotionSchema);

export const Promotion = mongoose.models.Promotion ?? mongoose.model("Promotion", promotionSchema);
