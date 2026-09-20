import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const BANNER_PLACEMENTS = ["hero", "promo"] as const;

const bannerSchema = new Schema(
  {
    placement: { type: String, enum: BANNER_PLACEMENTS, default: "hero", required: true },
    eyebrow: { type: String, default: "" },
    title: { type: String, required: true, trim: true },
    // Second, emphasised line of a hero headline.
    highlight: { type: String, default: "" },
    description: { type: String, default: "" },
    ctaLabel: { type: String, default: "" },
    ctaHref: { type: String, default: "" },
    secondaryCtaLabel: { type: String, default: "" },
    secondaryCtaHref: { type: String, default: "" },
    // Key into the storefront's gradient presets (Tailwind can only compile classes it can see in source).
    gradient: { type: String, default: "sunrise" },
    image: { type: String, default: "" },
    imagePublicId: { type: String },
    sortOrder: { type: Number, default: 0 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(bannerSchema);

export const Banner = mongoose.models.Banner ?? mongoose.model("Banner", bannerSchema);
