import axios from "axios";
import crypto from "crypto";
import express from "express";

import admin from "../admin.js";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

function randomState() {
  return crypto.randomBytes(24).toString("base64url");
}

function defaultDeepLink() {
  const explicit = process.env.STRAVA_APP_DEEPLINK;
  if (explicit) return explicit;

  const generic = process.env.APP_DEEPLINK_SUCCESS;
  if (typeof generic === "string" && generic.trim()) {
    return generic.includes("garmin-linked")
      ? generic.replace("garmin-linked", "strava-linked")
      : generic;
  }

  return "version10app://strava-linked";
}

function withQuery(url, paramsObj) {
  const hasQ = String(url).includes("?");
  const qs = new URLSearchParams(paramsObj).toString();
  return String(url) + (hasQ ? "&" : "?") + qs;
}

function isAllowedAppReturn(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("version10app://") || url.startsWith("exp://"))
  );
}

function pickBestReturnUrl(preferred) {
  if (isAllowedAppReturn(preferred)) return preferred;
  return defaultDeepLink();
}

function resolveRedirectUri(req) {
  const derived = `${req.protocol}://${req.get("host")}/strava/callback`;
  const explicit = process.env.STRAVA_REDIRECT_URI;
  if (!explicit) return derived;

  const explicitValue = String(explicit).trim();
  if (!explicitValue) return derived;

  try {
    const reqHost = String(req.get("host") || "").split(":")[0];
    const explicitHost = new URL(explicitValue).hostname;
    if (reqHost && explicitHost && reqHost !== explicitHost) {
      console.warn(
        "[strava] STRAVA_REDIRECT_URI host mismatch, using derived host:",
        explicitHost,
        "->",
        reqHost
      );
      return derived;
    }
  } catch {
    return derived;
  }

  return explicitValue;
}

async function putState(state, payload) {
  const db = admin.firestore();
  await db.collection("strava_oauth_states").doc(state).set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAtMs: Date.now() + 15 * 60 * 1000,
  });
}

async function getState(state) {
  const db = admin.firestore();
  const ref = db.collection("strava_oauth_states").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.expiresAtMs && Date.now() > Number(data.expiresAtMs)) return null;
  return { ref, data };
}

async function deleteState(ref) {
  try {
    await ref.delete();
  } catch {}
}

async function putOauthResult(resultKey, payload) {
  const db = admin.firestore();
  await db.collection("strava_oauth_results").doc(resultKey).set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAtMs: Date.now() + 5 * 60 * 1000,
  });
}

async function getOauthResult(resultKey) {
  const db = admin.firestore();
  const ref = db.collection("strava_oauth_results").doc(resultKey);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.expiresAtMs && Date.now() > Number(data.expiresAtMs)) {
    try {
      await ref.delete();
    } catch {}
    return null;
  }
  return { ref, data };
}

async function saveStravaIntegration(uid, tokenData) {
  const db = admin.firestore();

  await db.collection("users").doc(String(uid)).set(
    {
      integrations: {
        strava: {
          connected: true,
          accessToken: tokenData.access_token || "",
          refreshToken: tokenData.refresh_token || "",
          expiresAt: tokenData.expires_at || null,
          scope: tokenData.scope || "",
          athlete: tokenData.athlete || null,
          linkedAtMs: Date.now(),
          updatedAtMs: Date.now(),
          provider: "strava",
        },
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function exchangeCodeForToken({
  code,
  redirectUri,
  clientId,
  clientSecret,
}) {
  const response = await axios.post(
    "https://www.strava.com/api/v3/oauth/token",
    null,
    {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      },
    }
  );

  return response.data || {};
}

// GET /strava/start?uid=...&returnUrl=...
router.get("/start", async (req, res) => {
  try {
    const uid = String(req.query?.uid || "").trim();
    const requestedReturn = String(req.query?.returnUrl || "").trim();

    if (!uid) {
      return res.status(400).send("Missing uid");
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      return res.status(500).send("Missing STRAVA_CLIENT_ID");
    }

    const redirectUri = resolveRedirectUri(req);
    const state = randomState();
    const returnUrl = pickBestReturnUrl(requestedReturn);

    console.log("[strava/start] redirectUri =", redirectUri);
    console.log("[strava/start] returnUrl =", returnUrl);

    await putState(state, {
      uid,
      returnUrl,
      redirectUri,
    });

    const params = new URLSearchParams({
      client_id: String(clientId),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      approval_prompt: "auto",
      scope: "read,activity:read_all",
    });

    const authUrl = `https://www.strava.com/oauth/authorize?${params.toString()}`;
    if (String(req.query?.debug || "").trim() === "1") {
      return res.json({
        ok: true,
        clientId: String(clientId),
        redirectUri,
        returnUrl,
        authUrl,
      });
    }
    return res.redirect(authUrl);
  } catch (error) {
    console.error("Strava start error:", error?.message || error);
    return res.status(500).send("Failed to start Strava OAuth");
  }
});

// GET /strava/callback?code=...&state=...
router.get("/callback", async (req, res) => {
  try {
    const code = String(req.query?.code || "");
    const state = String(req.query?.state || "");
    const oauthError = String(req.query?.error || "");

    if (!state) {
      return res.redirect(
        withQuery(defaultDeepLink(), {
          success: "0",
          reason: "missing_state",
        })
      );
    }

    const stateRecord = await getState(state);
    const stateData = stateRecord?.data || null;
    const stateRef = stateRecord?.ref || null;
    const appReturnUrl = pickBestReturnUrl(stateData?.returnUrl);

    if (!stateData?.uid) {
      if (stateRef) await deleteState(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "invalid_state",
        })
      );
    }

    if (oauthError) {
      if (stateRef) await deleteState(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "oauth_error",
          error: oauthError,
        })
      );
    }

    if (!code) {
      if (stateRef) await deleteState(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "missing_code",
        })
      );
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    const redirectUri = stateData.redirectUri || resolveRedirectUri(req);

    if (!clientId || !clientSecret) {
      if (stateRef) await deleteState(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "server_misconfig",
        })
      );
    }

    const tokenData = await exchangeCodeForToken({
      code,
      redirectUri,
      clientId,
      clientSecret,
    });

    await saveStravaIntegration(stateData.uid, tokenData);
    if (stateRef) await deleteState(stateRef);

    // Create short-lived one-time exchange record so tokens never appear in URL.
    const resultKey = randomState();
    await putOauthResult(resultKey, {
      uid: String(stateData.uid),
      accessToken: String(tokenData.access_token || ""),
      refreshToken: String(tokenData.refresh_token || ""),
      expiresAt: tokenData.expires_at || null,
    });

    return res.redirect(
      withQuery(appReturnUrl, {
        success: "1",
        resultKey,
      })
    );
  } catch (error) {
    console.error("Strava callback error:", error?.response?.data || error?.message || error);
    return res.redirect(
      withQuery(defaultDeepLink(), {
        success: "0",
        reason: "callback_failed",
      })
    );
  }
});

// POST /strava/oauth-result { resultKey: "..." }
// Returns one-time tokens for the authenticated user after OAuth callback.
router.post("/oauth-result", requireUser, async (req, res) => {
  try {
    const resultKey = String(req.body?.resultKey || "").trim();
    const uid = String(req.user?.uid || "").trim();
    if (!resultKey) {
      return res.status(400).json({ error: "resultKey is required" });
    }
    if (!uid) {
      return res.status(401).json({ error: "Unauthenticated user" });
    }

    const record = await getOauthResult(resultKey);
    const data = record?.data || null;
    if (!record || !data) {
      return res.status(404).json({ error: "OAuth result not found or expired" });
    }

    if (String(data.uid || "") !== uid) {
      return res.status(403).json({ error: "OAuth result does not belong to this user" });
    }

    try {
      await record.ref.delete();
    } catch {}

    return res.json({
      ok: true,
      accessToken: String(data.accessToken || ""),
      refreshToken: String(data.refreshToken || ""),
      expiresAt: data.expiresAt || null,
    });
  } catch (error) {
    console.error("Strava oauth-result error:", error?.message || error);
    return res.status(500).json({ error: "Failed to resolve OAuth result" });
  }
});

// POST /strava/exchange  { code: "..." }
router.post("/exchange", async (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    return res.status(400).json({ error: "code is required" });
  }

  try {
    const response = await axios.post(
      "https://www.strava.com/api/v3/oauth/token",
      null,
      {
        params: {
          client_id: process.env.STRAVA_CLIENT_ID,
          client_secret: process.env.STRAVA_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error(
      "Strava token exchange error:",
      error?.response?.data || error.message || error
    );
    return res.status(500).json({ error: "Failed to exchange Strava token" });
  }
});

export default router;
