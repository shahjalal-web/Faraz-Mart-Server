import { createApp } from "../src/app";
import { ensureDefaultRoles } from "../src/routes/roles.routes";

/**
 * Vercel serverless entry point. Unlike src/server.ts (used for local dev via
 * `npm run dev`, which calls app.listen()), a serverless function must export
 * a request handler instead of binding a port — Express's `app` already is one
 * ((req, res) => void), so Vercel's Node runtime can call it directly per request.
 *
 * Env vars (MONGODB_URI, JWT_SECRET, CORS_ORIGIN, FIREBASE_*, CLOUDINARY_*,
 * GOOGLE_OAUTH_CLIENT_ID) are read from process.env exactly as in dev — on
 * Vercel these must be set in Project Settings → Environment Variables, since
 * the gitignored .env file is never deployed.
 */
const app = createApp();

// Idempotent — safe to run on every cold start, keeps the built-in roles
// self-healing without depending on someone re-running the seed script.
ensureDefaultRoles().catch((error) => console.error("Couldn't ensure default roles:", error));

export default app;
