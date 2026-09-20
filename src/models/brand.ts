import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    logo: { type: String, default: "" },
    // Cloudinary public_id of `logo`, kept so replacing/deleting the brand also deletes the image.
    logoPublicId: { type: String },
    description: { type: String, default: "" },
    website: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(brandSchema);

export const Brand = mongoose.models.Brand ?? mongoose.model("Brand", brandSchema);
