import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

const faqSchema = new Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true },
    category: { type: String, default: "General", trim: true },
    sortOrder: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);

applyIdTransform(faqSchema);

export const Faq = mongoose.models.Faq ?? mongoose.model("Faq", faqSchema);
