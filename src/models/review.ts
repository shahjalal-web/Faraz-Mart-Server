import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

const reviewSchema = new Schema(
  {
    // Absent for store-level testimonials that aren't about one product.
    productId: { type: Schema.Types.ObjectId, ref: "Product", index: true },
    customerId: { type: String },
    customerName: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: "", trim: true },
    comment: { type: String, required: true, trim: true },
    isVerifiedPurchase: { type: Boolean, default: false },
    status: { type: String, enum: REVIEW_STATUSES, default: "pending", index: true },
    // Approved + featured reviews are what the homepage "What Our Customers Say" section shows.
    isFeatured: { type: Boolean, default: false },
    // Filled in by moderators — never shown publicly.
    moderationNote: { type: String, default: "" },
  },
  { timestamps: true }
);

// One review per customer per product (guests/testimonials have no customerId, so they're exempt).
reviewSchema.index(
  { productId: 1, customerId: 1 },
  { unique: true, partialFilterExpression: { customerId: { $type: "string" }, productId: { $type: "objectId" } } }
);

applyIdTransform(reviewSchema);

export const Review = mongoose.models.Review ?? mongoose.model("Review", reviewSchema);
