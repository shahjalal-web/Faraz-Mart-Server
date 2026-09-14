import mongoose from "mongoose";

let connected = false;

/**
 * Backend runs as one long-lived Node process (unlike the Next.js frontend,
 * which can hot-reload modules in dev), so a simple boolean flag is enough —
 * no need for the global-cache pattern Next.js + Mongoose setups usually need.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (connected) return mongoose;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to backend/.env before using the database.");
  }

  await mongoose.connect(uri);
  connected = true;
  return mongoose;
}
