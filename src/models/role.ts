import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const roleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    permissions: { type: [String], default: [] },
    // System roles ship with the store; their key can't change and they can't be deleted.
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

applyIdTransform(roleSchema);

export const Role = mongoose.models.Role ?? mongoose.model("Role", roleSchema);
