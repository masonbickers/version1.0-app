// server/routes/garmin.js
import crypto from "crypto";
import express from "express";
import admin from "../admin.js";

const router = express.Router();

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest();
}

function randomString(len = 64) {
  return base64url(crypto.randomBytes(len)).slice(0, 96);
}

// --- Redirect helpers ---
function defaultDeepLinkOk() {
  return process.env.APP_DEEPLINK_SUCCESS || "version10app://garmin-linked";
}

function defaultDeepLinkFail() {
  return process.env.APP_DEEPLINK_FAIL || "version10app://garmin-linked";
}

function withQuery(url, paramsObj) {
  const hasQ = url.includes("?");
  const qs = new URLSearchParams(paramsObj).toString();
  return url + (hasQ ? "&" : "?") + qs;
}

function isAllowedAppReturn(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("version10app://") || url.startsWith("exp://"))
  );
}

function pickBestReturnUrl(preferred, fallback) {
  if (isAllowedAppReturn(preferred)) return preferred;
  if (isAllowedAppReturn(fallback)) return fallback;
  return defaultDeepLinkOk();
}

/**
 * Store PKCE verifier by state so callback can complete exchange.
 */
async function putState(state, payload) {
  const db = admin.firestore();
  await db.collection("garmin_oauth_states").doc(state).set({
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAtMs: Date.now() + 15 * 60 * 1000,
  });
}

async function getState(state) {
  const db = admin.firestore();
  const ref = db.collection("garmin_oauth_states").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (data?.expiresAtMs && Date.now() > Number(data.expiresAtMs)) return null;

  return { ref, data };
}

async function deleteStateByRef(ref) {
  try {
    await ref.delete();
  } catch (e) {
    console.warn("Garmin state delete failed:", e?.message || e);
  }
}

/** Save tokens under user */
async function saveGarminIntegration(uid, integration) {
  const db = admin.firestore();
  await db.collection("users").doc(uid).set(
    {
      integrations: { garmin: integration },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return {};
  }
}

/**
 * GET /auth/garmin/start?uid=...&redirectToApp=...
 */
router.get("/start", async (req, res) => {
  try {
    const { uid, redirectToApp, returnUrl } = req.query;
    if (!uid) return res.status(400).send("Missing uid");

    const clientId = process.env.GARMIN_CLIENT_ID;
    const redirectUri = process.env.GARMIN_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      console.error("Garmin start misconfig:", {
        hasClientId: !!clientId,
        hasRedirectUri: !!redirectUri,
      });
      return res
        .status(500)
        .send("Missing GARMIN_CLIENT_ID or GARMIN_REDIRECT_URI");
    }

    const requestedReturnUrl =
      typeof redirectToApp === "string"
        ? redirectToApp
        : typeof returnUrl === "string"
        ? returnUrl
        : "";

    const safeRedirectToApp = pickBestReturnUrl(
      requestedReturnUrl,
      defaultDeepLinkOk()
    );

    const state = base64url(crypto.randomBytes(24));
    const codeVerifier = randomString(64);
    const codeChallenge = base64url(sha256(codeVerifier));

    await putState(state, {
      uid: String(uid),
      codeVerifier,
      redirectToApp: safeRedirectToApp,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      state,
    });

    const authUrl = `https://connect.garmin.com/oauth2Confirm?${params.toString()}`;

    console.log("Garmin start:", {
      uid: String(uid),
      redirectUri,
      requestedReturnUrl,
      safeRedirectToApp,
      authUrl,
    });

    return res.redirect(authUrl);
  } catch (e) {
    console.error("Garmin start error:", e);
    return res.status(500).send("Failed to start Garmin OAuth");
  }
});

/**
 * GET /auth/garmin/callback?code=...&state=...
 */
router.get("/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    console.log("Garmin callback query:", req.query);

    // If Garmin returns an oauth error before we can look up state,
    // use the configured fallback deep link.
    if (error && !state) {
      const failUrl = defaultDeepLinkFail();
      return res.redirect(
        withQuery(failUrl, {
          success: "0",
          reason: "oauth_error",
          error: String(error),
        })
      );
    }

    if (!state) {
      const failUrl = defaultDeepLinkFail();
      return res.redirect(
        withQuery(failUrl, {
          success: "0",
          reason: "missing_state",
        })
      );
    }

    const stateRecord = await getState(String(state));
    const stateData = stateRecord?.data || null;
    const stateRef = stateRecord?.ref || null;

    const appReturnUrl = pickBestReturnUrl(
      stateData?.redirectToApp,
      defaultDeepLinkFail()
    );

    if (error) {
      console.warn("Garmin oauth returned error:", error);
      if (stateRef) await deleteStateByRef(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "oauth_error",
          error: String(error),
        })
      );
    }

    if (!code) {
      if (stateRef) await deleteStateByRef(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "missing_code",
        })
      );
    }

    if (!stateData?.uid || !stateData?.codeVerifier) {
      if (stateRef) await deleteStateByRef(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "invalid_or_expired_state",
        })
      );
    }

    const clientId = process.env.GARMIN_CLIENT_ID;
    const clientSecret = process.env.GARMIN_CLIENT_SECRET;
    const redirectUri = process.env.GARMIN_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      console.error("Garmin callback misconfig:", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRedirectUri: !!redirectUri,
      });
      if (stateRef) await deleteStateByRef(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "server_misconfig",
        })
      );
    }

    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      code_verifier: String(stateData.codeVerifier),
      redirect_uri: redirectUri,
    });

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);

    const tokenResp = await fetch(
      "https://diauth.garmin.com/di-oauth2-service/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams.toString(),
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(t));

    const tokenJson = await safeJson(tokenResp);

    console.log("Garmin token exchange:", {
      status: tokenResp.status,
      ok: tokenResp.ok,
      hasAccessToken: !!tokenJson?.access_token,
    });

    if (!tokenResp.ok || !tokenJson?.access_token) {
      console.error("Garmin token error:", tokenResp.status, tokenJson);
      if (stateRef) await deleteStateByRef(stateRef);
      return res.redirect(
        withQuery(appReturnUrl, {
          success: "0",
          reason: "token_exchange_failed",
          status: String(tokenResp.status),
        })
      );
    }

    // Try to fetch Garmin userId
    let garminUserId = null;
    try {
      const idCtrl = new AbortController();
      const idT = setTimeout(() => idCtrl.abort(), 10000);

      const idResp = await fetch(
        "https://apis.garmin.com/wellness-api/rest/user/id",
        {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
          signal: idCtrl.signal,
        }
      ).finally(() => clearTimeout(idT));

      const idJson = await safeJson(idResp);

      if (idResp.ok) {
        garminUserId = idJson?.userId || null;
      } else {
        console.warn("Garmin user id fetch failed:", idResp.status, idJson);
      }
    } catch (e) {
      console.warn("Garmin user id fetch threw:", e?.message || e);
    }

    const now = Date.now();
    const expiresInSec = Number(tokenJson.expires_in || 0);
    const expiresAtMs = now + Math.max(0, expiresInSec - 600) * 1000;

    await saveGarminIntegration(stateData.uid, {
      connected: true,
      garminUserId,
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      scope: tokenJson.scope || null,
      tokenType: tokenJson.token_type || "bearer",
      expiresAtMs,
      refreshTokenExpiresIn: tokenJson.refresh_token_expires_in || null,
      linkedAtMs: now,
      tokenEndpoint: "https://diauth.garmin.com/di-oauth2-service/oauth/token",
      userIdEndpointAttempted:
        "https://apis.garmin.com/wellness-api/rest/user/id",
    });

    if (stateRef) await deleteStateByRef(stateRef);

    console.log("Garmin success redirect:", {
      appReturnUrl,
      garminUserId,
      uid: stateData.uid,
    });

    return res.redirect(withQuery(appReturnUrl, { success: "1" }));
  } catch (e) {
    console.error("Garmin callback error:", e);
    return res.redirect(
      withQuery(defaultDeepLinkFail(), {
        success: "0",
        reason: "server_error",
      })
    );
  }
});

export default router;