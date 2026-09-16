import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App | null = null;

/**
 * Lazy singleton, mirroring the same pattern as db.ts and jwt.ts's
 * getSecretKey() — reads env vars inside the function body (not at module
 * load) so this works regardless of when dotenv.config() ran relative to
 * this module being imported (ESM import hoisting bit us on this exact
 * mistake earlier with MONGODB_URI, see WORK-HISTORY.md).
 */
export function getFirebaseAuth(): Auth {
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firebase service account env vars are not set. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to backend/.env."
      );
    }

    app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }

  return getAuth(app);
}
