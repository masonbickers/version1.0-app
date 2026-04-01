import admin from "firebase-admin";
import fs from "fs";

/**
 * Initializes the Firebase Admin SDK.
 * Supports both a file path and a direct JSON string for flexibility.
 */
export function initAdmin() {
  // 1. Prevent double initialization
  if (admin.apps.length > 0) {
    return admin.app();
  }

  try {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let serviceAccount;

    if (!saPath) {
      // Fallback: Check if the whole JSON is in an env var (useful for CI/CD)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      } else {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_PATH or JSON string.");
      }
    } else {
      // Load from File Path
      if (!fs.existsSync(saPath)) {
        throw new Error(`Service account file not found at: ${saPath}`);
      }
      serviceAccount = JSON.parse(fs.readFileSync(saPath, "utf8"));
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // No need to manually set projectId if it's in the cert, but it doesn't hurt
      projectId: serviceAccount.project_id,
    });

    console.log(
      "[firebase-admin] Initialized project:",
      serviceAccount.project_id
    );

    // Optional: Set Firestore settings for better handling of dates
    admin.firestore().settings({ ignoreUndefinedProperties: true });

  } catch (error) {
    console.error("[firebase-admin] Initialization failed:", error.message);
    throw error;
  }

  return admin;
}

// ✅ Initialize once and export the instance
const firebaseAdmin = initAdmin();

export { firebaseAdmin as admin };
export default firebaseAdmin;