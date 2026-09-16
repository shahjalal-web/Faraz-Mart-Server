import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    parentId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    productCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    seoTitle: { type: String },
    seoDescription: { type: String },
  },
  { timestamps: true }
);

applyIdTransform(categorySchema);

export type CategoryDocument = InferSchemaType<typeof categorySchema>;

export const Category = mongoose.models.Category ?? mongoose.model("Category", categorySchema);
