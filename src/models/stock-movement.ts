import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

/** Audit trail for every change to a product's stock — manual adjustments, orders, cancellations. */
const stockMovementSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    productName: { type: String, required: true },
    sku: { type: String, default: "" },
    delta: { type: Number, required: true },
    before: { type: Number, required: true },
    after: { type: Number, required: true },
    reason: { type: String, default: "" },
    // Who made the change: an admin's name, or "Order FM-123456" for automatic ones.
    actor: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

applyIdTransform(stockMovementSchema);

export const StockMovement = mongoose.models.StockMovement ?? mongoose.model("StockMovement", stockMovementSchema);
