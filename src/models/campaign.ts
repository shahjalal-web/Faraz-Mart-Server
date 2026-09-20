import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const CAMPAIGN_CHANNELS = ["email", "social", "search", "display", "influencer", "other"] as const;
export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    channel: { type: String, enum: CAMPAIGN_CHANNELS, default: "other", required: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft", required: true },
    startsAt: { type: Date },
    endsAt: { type: Date },
    budget: { type: Number, min: 0 },
    // Coupon code used to attribute orders to this campaign — powers the performance columns.
    couponCode: { type: String, uppercase: true, trim: true, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

applyIdTransform(campaignSchema);

export const Campaign = mongoose.models.Campaign ?? mongoose.model("Campaign", campaignSchema);
