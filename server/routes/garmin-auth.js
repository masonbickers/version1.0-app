// server/routes/garmin-auth.js
import axios from "axios";
import crypto from "crypto";
import express from "express";
import OAuth from "oauth-1.0a";
import admin from "../admin.js"; // Using our fixed admin.js

const router = express.Router();

// 1. Initialize OAuth 1.0a
const oauth = OAuth({
  consumer: {
    key: process.env.GARMIN_CONSUMER_KEY,
    secret: process.env.GARMIN_CONSUMER_SECRET,
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto.createHmac('sha1', key).update(base_string).digest('base64');
  },
});

// 2. START: Get Request Token & Redirect User
router.get("/start", async (req, res) => {
  try {
    const { uid, redirectToApp } = req.query;
    
    const request_data = {
      url: 'https://connectapi.garmin.com/oauth-service/oauth/request_token',
      method: 'POST',
    };

    // Sign the request
    const authHeader = oauth.toHeader(oauth.authorize(request_data));

    const response = await axios.post(request_data.url, null, {
      headers: { ...authHeader }
    });

    // Garmin returns a string: oauth_token=xxx&oauth_token_secret=yyy
    const params = new URLSearchParams(response.data);
    const oauthToken = params.get('oauth_token');
    const oauthTokenSecret = params.get('oauth_token_secret');

    // CRITICAL: Store the Secret temporarily so we can use it in the callback
    await admin.firestore().collection("temp_garmin_tokens").doc(oauthToken).set({
      uid,
      oauthTokenSecret,
      redirectToApp,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Send user to Garmin to log in
    const authorizeUrl = `https://connect.garmin.com/oauth-confirm?oauth_token=${oauthToken}`;
    res.redirect(authorizeUrl);
    
  } catch (e) {
    console.error("Garmin Start Error:", e);
    res.status(500).send("Failed to start Garmin auth");
  }
});

export default router;