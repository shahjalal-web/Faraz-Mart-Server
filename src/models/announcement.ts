import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const announcementSchema = new Schema(
  {
    message: { type: String, required: true, trim: true },
    linkLabel: { type: String, default: "" },
    linkHref: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(announcementSchema);

export const Announcement = mongoose.models.Announcement ?? mongoose.model("Announcement", announcementSchema);
