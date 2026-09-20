import mongoose, { Schema } from "mongoose";
import { applyIdTransform } from "../utils/to-json";

export const FOOTER_GROUPS = ["customer-service", "company"] as const;

const pageSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Light markdown: # headings, - lists, **bold**, [links](url). Rendered without raw HTML.
    content: { type: String, default: "" },
    isPublished: { type: Boolean, default: true },
    showInFooter: { type: Boolean, default: false },
    footerGroup: { type: String, enum: FOOTER_GROUPS, default: "company" },
    seoTitle: { type: String, default: "" },
    seoDescription: { type: String, default: "" },
  },
  { timestamps: true }
);

applyIdTransform(pageSchema);

export const Page = mongoose.models.Page ?? mongoose.model("Page", pageSchema);
