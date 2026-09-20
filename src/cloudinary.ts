import { v2 as cloudinary } from "cloudinary";

let configured = false;

/**
 * Lazy singleton (same pattern as db.ts, firebase-admin.ts) — reads env vars
 * inside the function body so it works regardless of when dotenv.config()
 * ran relative to this module being imported.
 */
function getCloudinary() {
  if (!configured) {
    const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
    const api_key = process.env.CLOUDINARY_API_KEY;
    const api_secret = process.env.CLOUDINARY_API_SECRET;

    if (!cloud_name || !api_key || !api_secret) {
      throw new Error(
        "Cloudinary env vars are not set. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to backend/.env."
      );
    }

    cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
    configured = true;
  }

  return cloudinary;
}

/**
 * Deletes one image from Cloudinary by its public_id. Only ever called
 * server-side (the API secret required for this never reaches the browser)
 * — used when an admin deletes/replaces a product image.
 */
export async function deleteCloudinaryImage(publicId: string): Promise<void> {
  await getCloudinary().uploader.destroy(publicId);
}

export { getCloudinary };
