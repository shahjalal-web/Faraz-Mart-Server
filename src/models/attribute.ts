import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const ATTRIBUTE_TYPES = ["color", "size", "text"] as const;

const attributeValueSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    // Stable machine value (e.g. "midnight-black"); defaults to a slug of the label.
    value: { type: String, required: true, trim: true },
    // Only meaningful for colour attributes — the swatch shown on the storefront.
    hex: { type: String },
  },
  { _id: false }
);

const attributeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, enum: ATTRIBUTE_TYPES, default: "text", required: true },
    values: { type: [attributeValueSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(attributeSchema);

export const Attribute = mongoose.models.Attribute ?? mongoose.model("Attribute", attributeSchema);
