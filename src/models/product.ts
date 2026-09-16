import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const variantOptionSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    value: { type: String, required: true },
    hex: { type: String },
  },
  { _id: false }
);

export const STOCK_STATUSES = ["in-stock", "low-stock", "out-of-stock"] as const;

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    brand: { type: String, required: true, trim: true },
    shortDescription: { type: String, required: true },
    description: { type: String, required: true },
    images: { type: [String], default: [] },
    thumbnail: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    salePrice: { type: Number, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    stockStatus: { type: String, enum: STOCK_STATUSES, default: "in-stock" },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    soldCount: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
    colors: { type: [variantOptionSchema], default: undefined },
    sizes: { type: [variantOptionSchema], default: undefined },
    isFeatured: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },
    isFlashSale: { type: Boolean, default: false },
    flashSaleEndsAt: { type: Date },
    seoTitle: { type: String },
    seoDescription: { type: String },
  },
  { timestamps: true }
);

applyIdTransform(productSchema);

export type ProductDocument = InferSchemaType<typeof productSchema>;

export const Product = mongoose.models.Product ?? mongoose.model("Product", productSchema);
