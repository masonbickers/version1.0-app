import express from "express";
import admin from "../admin.js";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

const ACTIVITY_COLLECTIONS = ["garmin_activities", "garminActivities"];
const ACTIVITY_BASE =
  process.env.GARMIN_ACTIVITY_BASE ||
  process.env.GARMIN_APIS_BASE ||
  "https://apis.garmin.com/wellness-api/rest";
const TOKEN_ENDPOINT =
  process.env.GARMIN_TOKEN_ENDPOINT ||
  "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const SYNC_COOLDOWN_MS = 75 * 1000;

function pickGarminActivityIntegrationEntry(userData = {}) {
  const integrations = userData.integrations || {};
  if (integrations.garminActivity) {
    return { key: "garminActivity", integration: integrations.garminActivity };
  }
  if (integrations.garmin) {
    return { key: "garmin", integration: integrations.garmin };
  }
  return { key: null, integration: null };
}

function pickGarminActivityIntegration(userData = {}) {
  return pickGarminActivityIntegrationEntry(userData).integration;
}

function getRefreshCredentials(integrationKey, garmin = {}) {
  const useActivity =
    integrationKey === "garminActivity" || garmin.credentialProfile === "activity";

  return useActivity
    ? {
        clientId: process.env.GARMIN_ACTIVITY_CLIENT_ID || process.env.GARMIN_CLIENT_ID,
        clientSecret:
          process.env.GARMIN_ACTIVITY_CLIENT_SECRET || process.env.GARMIN_CLIENT_SECRET,
        label: "GARMIN_ACTIVITY_CLIENT_ID/GARMIN_ACTIVITY_CLIENT_SECRET",
      }
    : {
        clientId: process.env.GARMIN_CLIENT_ID,
        clientSecret: process.env.GARMIN_CLIENT_SECRET,
        label: "GARMIN_CLIENT_ID/GARMIN_CLIENT_SECRET",
      };
}

async function saveGarminIntegration(uid, integrationKey, integration) {
  await admin
    .firestore()
    .collection("users")
    .doc(uid)
    .set(
      {
        integrations: { [integrationKey]: integration },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function refreshAccessTokenIfNeeded(uid, integrationKey, garmin) {
  if (!garmin) return { ok: false, error: "No Garmin integration" };

  const accessToken = String(garmin.accessToken || "").trim();
  const refreshToken = String(garmin.refreshToken || "").trim();
  const expiresAtMs = Number(garmin.expiresAtMs || 0);

  if (!accessToken) return { ok: false, error: "Missing Garmin access token" };

  const now = Date.now();
  const isExpired = expiresAtMs && now > expiresAtMs;
  if (!isExpired) return { ok: true, accessToken, refreshed: false };

  if (!refreshToken) {
    return {
      ok: false,
      error: "Garmin access token expired and no refresh token is stored",
    };
  }

  const { clientId, clientSecret, label } = getRefreshCredentials(integrationKey, garmin);
  if (!clientId || !clientSecret) {
    return { ok: false, error: `Missing ${label}` };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }).toString();

  const resp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const tokenJson = await resp.json().catch(() => ({}));
  if (!resp.ok || !tokenJson?.access_token) {
    return {
      ok: false,
      error: "Garmin token refresh failed",
      status: resp.status,
      details: tokenJson,
    };
  }

  const expiresInSec = Number(tokenJson.expires_in || 0);
  const updated = {
    ...garmin,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token || refreshToken,
    tokenType: tokenJson.token_type || garmin.tokenType || "bearer",
    scope: tokenJson.scope || garmin.scope || null,
    expiresAtMs: now + Math.max(0, expiresInSec - 600) * 1000,
    refreshedAtMs: now,
    tokenEndpoint: TOKEN_ENDPOINT,
  };

  await saveGarminIntegration(uid, integrationKey, updated);
  return { ok: true, accessToken: updated.accessToken, refreshed: true };
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function endOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function boundedBackfillWindow(body = {}) {
  const maxDays = Math.max(
    1,
    Math.min(730, Number(process.env.GARMIN_ACTIVITY_BACKFILL_MAX_DAYS || 30))
  );
  const requestedDays = Number(body.days || process.env.GARMIN_ACTIVITY_BACKFILL_DAYS || 30);
  const days = Math.max(1, Math.min(maxDays, Number.isFinite(requestedDays) ? requestedDays : 30));
  const start = body.from ? new Date(`${body.from}T00:00:00.000Z`) : dateDaysAgo(days);
  const end = body.to ? new Date(`${body.to}T23:59:59.999Z`) : endOfTodayUtc();

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, error: "Invalid backfill date range" };
  }
  if (end.getTime() < start.getTime()) {
    return { ok: false, error: "Backfill end date must be after start date" };
  }

  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  const boundedStart =
    end.getTime() - start.getTime() > maxMs ? new Date(end.getTime() - maxMs) : start;

  return {
    ok: true,
    start: boundedStart,
    end,
    startSec: toUnixSeconds(boundedStart),
    endSec: toUnixSeconds(end),
    days,
  };
}

async function requestActivitiesBackfill({ accessToken, startSec, endSec }) {
  const url = `${ACTIVITY_BASE}/backfill/activities?summaryStartTimeInSeconds=${startSec}&summaryEndTimeInSeconds=${endSec}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await resp.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text || {};
  }

  return {
    ok: resp.status >= 200 && resp.status < 300,
    pending: resp.status === 202,
    status: resp.status,
    retryAfter: resp.headers.get("retry-after") || null,
    url,
    body,
  };
}

async function getRecentSyncRequest(userRef) {
  const snap = await userRef
    .collection("garmin_sync_requests")
    .orderBy("requestedAtMs", "desc")
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data() || null;
}

function rateLimitMessage(retryAfter) {
  const retryText = retryAfter ? ` Wait ${retryAfter} seconds and try again.` : " Wait a minute and try again.";
  return `Garmin rate limit reached.${retryText}`;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function activitySortMs(activity = {}) {
  return toMillis(
    activity.startTimeMs ||
      activity.startDateMs ||
      activity.startTime ||
      activity.startDate ||
      activity.startedAt ||
      activity.summaryStartTimeInSeconds * 1000 ||
      activity.startTimeInSeconds * 1000 ||
      activity.when
  );
}

async function loadStoredGarminActivities(uid, max = 100) {
  const db = admin.firestore();
  const items = [];
  const sources = [];

  for (const collectionName of ACTIVITY_COLLECTIONS) {
    try {
      const snap = await db
        .collection("users")
        .doc(uid)
        .collection(collectionName)
        .limit(max)
        .get();

      if (!snap.empty) sources.push(collectionName);
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        items.push({
          id: docSnap.id,
          source: collectionName,
          ...data,
          sortMs: activitySortMs(data),
        });
      });
    } catch (e) {
      console.warn(`Garmin activities read failed for ${collectionName}:`, e?.message || e);
    }
  }

  return {
    sources,
    items: items
      .sort((a, b) => Number(b.sortMs || 0) - Number(a.sortMs || 0))
      .slice(0, max),
  };
}

router.get("/status", requireUser, async (req, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();

    if (!uid) {
      return res.status(401).json({ ok: false, error: "Unauthenticated user" });
    }

    const userSnap = await admin.firestore().collection("users").doc(uid).get();
    const garmin = pickGarminActivityIntegration(userSnap.data());

    return res.json({
      ok: true,
      connected: garmin?.connected === true,
      garminUserId: garmin?.garminUserId || null,
      credentialProfile: garmin?.credentialProfile || null,
    });
  } catch (e) {
    console.error("Garmin activities status error:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to check Garmin status",
    });
  }
});

router.get("/", requireUser, async (req, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();
    if (!uid) {
      return res.status(401).json({ ok: false, error: "Unauthenticated user" });
    }

    const max = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    const { sources, items } = await loadStoredGarminActivities(uid, max);

    return res.json({
      ok: true,
      count: items.length,
      sources,
      activities: items,
    });
  } catch (e) {
    console.error("Garmin activities list error:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to load Garmin activities",
    });
  }
});

router.post("/sync", requireUser, async (req, res) => {
  try {
    const uid = String(req.user?.uid || "").trim();

    if (!uid) {
      return res.status(401).json({
        ok: false,
        error: "Unauthenticated user",
      });
    }

    const userRef = admin.firestore().collection("users").doc(uid);
    const userSnap = await userRef.get();
    const { key: integrationKey, integration: garmin } =
      pickGarminActivityIntegrationEntry(userSnap.data());

    if (garmin?.connected !== true) {
      return res.status(400).json({
        ok: false,
        error: "Garmin is not connected",
      });
    }

    const recentRequest = await getRecentSyncRequest(userRef);
    const recentRequestedAtMs = Number(recentRequest?.requestedAtMs || 0);
    const msSinceRecent = Date.now() - recentRequestedAtMs;
    if (recentRequestedAtMs && msSinceRecent >= 0 && msSinceRecent < SYNC_COOLDOWN_MS) {
      return res.status(429).json({
        ok: false,
        error: `Garmin sync was just requested. Wait ${Math.ceil(
          (SYNC_COOLDOWN_MS - msSinceRecent) / 1000
        )} seconds and try again.`,
        cooldownSeconds: Math.ceil((SYNC_COOLDOWN_MS - msSinceRecent) / 1000),
        lastStatus: recentRequest?.httpStatus || null,
      });
    }

    const tokenResult = await refreshAccessTokenIfNeeded(uid, integrationKey, garmin);
    if (!tokenResult.ok) {
      return res.status(tokenResult.status || 401).json({
        ok: false,
        error: tokenResult.error,
        details: tokenResult.details || null,
      });
    }

    const window = boundedBackfillWindow(req.body || {});
    if (!window.ok) {
      return res.status(400).json({
        ok: false,
        error: window.error,
      });
    }

    const backfillResult = await requestActivitiesBackfill({
      accessToken: tokenResult.accessToken,
      startSec: window.startSec,
      endSec: window.endSec,
    });

    await userRef.collection("garmin_sync_requests").add({
      type: "manual_activity_sync",
      mode: "activity_backfill",
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      requestedAtMs: Date.now(),
      status: backfillResult.ok ? "requested" : "failed",
      httpStatus: backfillResult.status,
      retryAfter: backfillResult.retryAfter,
      garminResponse: backfillResult.body ?? null,
      garminUserId: garmin?.garminUserId || null,
      credentialProfile: garmin?.credentialProfile || null,
      integrationKey,
      refreshedToken: !!tokenResult.refreshed,
      summaryStartTimeInSeconds: window.startSec,
      summaryEndTimeInSeconds: window.endSec,
      from: window.start.toISOString().slice(0, 10),
      to: window.end.toISOString().slice(0, 10),
    });

    if (!backfillResult.ok) {
      const isRateLimited = backfillResult.status === 429;
      return res.status(backfillResult.status || 502).json({
        ok: false,
        error: isRateLimited
          ? rateLimitMessage(backfillResult.retryAfter)
          : "Garmin activity backfill request failed",
        status: backfillResult.status,
        retryAfter: backfillResult.retryAfter,
        details: backfillResult.body,
      });
    }

    return res.json({
      ok: true,
      message:
        "Garmin activity backfill requested. Old activities will appear after Garmin sends them to the activity webhook.",
      garminUserId: garmin?.garminUserId || null,
      from: window.start.toISOString().slice(0, 10),
      to: window.end.toISOString().slice(0, 10),
      status: backfillResult.status,
    });
  } catch (e) {
    console.error("Garmin manual sync error:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to request Garmin sync",
    });
  }
});

export default router;
