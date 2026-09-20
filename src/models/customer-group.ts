import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const customerGroupSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(customerGroupSchema);

export const CustomerGroup = mongoose.models.CustomerGroup ?? mongoose.model("CustomerGroup", customerGroupSchema);
