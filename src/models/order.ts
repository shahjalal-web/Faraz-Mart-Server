import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "out-for-delivery",
  "delivered",
  "cancelled",
  "returned",
  "refunded",
] as const;

const orderItemSchema = new Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true },
    thumbnail: { type: String, required: true },
    categoryId: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    color: { type: String },
    size: { type: String },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
  },
  { _id: false }
);

/**
 * Orders keep a human-friendly id (e.g. "FM-482913") as their real Mongo
 * `_id` — unlike Product/Category, this id is customer-facing (order
 * confirmation, tracking pages), so it stays in the same format the mock
 * data already used instead of switching to an ObjectId.
 */
const orderSchema = new Schema(
  {
    _id: { type: String },
    items: { type: [orderItemSchema], required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true },
    shippingAddress: { type: shippingAddressSchema, required: true },
    deliveryMethod: { type: String, enum: ["standard", "express"], required: true },
    paymentMethod: { type: String, enum: ["card", "cod", "mobile-banking"], required: true },
    couponCode: { type: String },
    subtotal: { type: Number, required: true },
    discount: { type: Number, required: true },
    shipping: { type: Number, required: true },
    tax: { type: Number, required: true },
    total: { type: Number, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: "pending" },
  },
  { timestamps: true }
);

applyIdTransform(orderSchema);

export type OrderDocument = InferSchemaType<typeof orderSchema>;

export const Order = mongoose.models.Order ?? mongoose.model("Order", orderSchema);
