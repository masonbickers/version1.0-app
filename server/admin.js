import admin from "firebase-admin";
import fs from "fs";

/**
 * Initializes the Firebase Admin SDK.
 * Supports both a file path and a direct JSON string for flexibility.
 * In local/dev environments without credentials, it still initialises the
 * default app with a project id so non-Firebase routes and health checks can
 * start. Firebase operations will then fail at request time instead of server
 * import time.
 */
export function initAdmin() {
  // 1. Prevent double initialization
  if (admin.apps.length > 0) {
    return admin;
  }

  try {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let serviceAccount;

    if (!saPath) {
      // Fallback: Check if the whole JSON is in an env var (useful for CI/CD)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      } else {
        const projectId =
          process.env.FIREBASE_PROJECT_ID ||
          process.env.GCLOUD_PROJECT ||
          process.env.GOOGLE_CLOUD_PROJECT ||
          "local-dev";

        admin.initializeApp({ projectId });
        admin.firestore().settings({ ignoreUndefinedProperties: true });
        console.warn(
          "[firebase-admin] Credentials not configured; started in local-safe mode."
        );
        return admin;
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
