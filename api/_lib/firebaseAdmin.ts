// api/_lib/firebaseAdmin.ts
import { getApps, getApp, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function getAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawKey) {
    throw new Error(
      "Missing Firebase Admin env vars. Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  }

  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

  if (!getApps().length) {
    const app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    const db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true } as any);
  } else {
    getApp();
  }

  return {
    adminAuth: getAuth(),
    adminDb: getFirestore(),
  };
}