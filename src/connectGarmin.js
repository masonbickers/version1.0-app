import axios from "axios";
import crypto from "crypto";
import express from "express";
import OAuth from "oauth-1.0a";
import admin from "../admin.js";

const router = express.Router();

const oauth = OAuth({
  consumer: {
    key: process.env.GARMIN_CONSUMER_KEY,
    secret: process.env.GARMIN_CONSUMER_SECRET,
  },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

// --- Helpers ---
const getCallbackUrl = () => process.env.GARMIN_REDIRECT_URI; 

async function saveState(token, data) {
  await admin.firestore().collection("garmin_oauth_states").doc(token).set({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
}

/** * GET /auth/garmin/start 
 */
router.get("/start", async (req, res) => {
  try {
    const { uid, redirectToApp } = req.query;
    if (!uid) return res.status(400).send("Missing uid");

    const requestData = {
      url: "https://connectapi.garmin.com/oauth-service/oauth/request_token",
      method: "POST",
      data: { oauth_callback: getCallbackUrl() },
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData));
    const resp = await axios.post(requestData.url, null, { headers: authHeader });
    
    const params = new URLSearchParams(resp.data);
    const token = params.get("oauth_token");
    const secret = params.get("oauth_token_secret");

    await saveState(token, { uid, secret, redirectToApp });

    res.redirect(`https://connect.garmin.com/oauth-confirm?oauth_token=${token}`);
  } catch (e) {
    console.error("Garmin Start Error:", e.response?.data || e.message);
    res.status(500).send("Failed to initiate Garmin connection.");
  }
});

/** * GET /auth/garmin/callback 
 */
router.get("/callback", async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query;
  
  const stateRef = admin.firestore().collection("garmin_oauth_states").doc(oauth_token);
  const stateSnap = await stateRef.get();
  
  if (!stateSnap.exists) return res.status(400).send("Invalid session");
  const { uid, secret, redirectToApp } = stateSnap.data();

  try {
    const exchangeData = {
      url: "https://connectapi.garmin.com/oauth-service/oauth/access_token",
      method: "POST",
      data: { oauth_verifier },
    };

    const authHeader = oauth.toHeader(oauth.authorize(exchangeData, { key: oauth_token, secret }));
    const resp = await axios.post(exchangeData.url, null, { headers: authHeader });

    const params = new URLSearchParams(resp.data);
    const accessToken = params.get("oauth_token");
    const accessSecret = params.get("oauth_token_secret");

    // Save permanent credentials to User doc
    await admin.firestore().collection("users").doc(uid).set({
      integrations: {
        garmin: {
          connected: true,
          accessToken,
          accessSecret,
          linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        }
      }
    }, { merge: true });

    await stateRef.delete();
    
    // Redirect back to App
    const finalRedirect = redirectToApp || "version10app://garmin-linked";
    res.redirect(`${finalRedirect}?success=1`);
  } catch (e) {
    console.error("Callback Error:", e.response?.data || e.message);
    res.redirect("version10app://garmin-linked?success=0&error=exchange_failed");
  }
});

export default router;