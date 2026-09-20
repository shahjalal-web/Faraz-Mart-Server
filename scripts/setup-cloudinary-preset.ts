/**
 * One-time setup: creates the unsigned upload preset the admin product form
 * uses to upload images directly from the browser to Cloudinary (the API
 * secret never has to reach the browser — only this preset name, which is
 * safe to expose, does). Run with: npm run setup:cloudinary (from backend/)
 *
 * Safe to re-run — updates the preset in place if it already exists.
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { getCloudinary } from "../src/cloudinary";

export const UPLOAD_PRESET_NAME = "faraz_mart_products";

async function main() {
  const cloudinary = getCloudinary();

  const presetConfig = {
    unsigned: true,
    folder: "faraz-mart/products",
    allowed_formats: "jpg,png,webp,avif",
    tags: "faraz-mart",
  };

  try {
    await cloudinary.api.update_upload_preset(UPLOAD_PRESET_NAME, presetConfig);
    console.log(`Upload preset "${UPLOAD_PRESET_NAME}" updated.`);
  } catch (error) {
    const isNotFound = (error as { error?: { message?: string } })?.error?.message?.includes("Can't find upload preset");
    if (!isNotFound) throw error;
    await cloudinary.api.create_upload_preset({ name: UPLOAD_PRESET_NAME, ...presetConfig });
    console.log(`Upload preset "${UPLOAD_PRESET_NAME}" created.`);
  }

  console.log(`Set NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=${UPLOAD_PRESET_NAME} in fazar-mart/.env.local.`);
}

main().catch((error) => {
  console.error("Cloudinary preset setup failed:", error);
  process.exit(1);
});
