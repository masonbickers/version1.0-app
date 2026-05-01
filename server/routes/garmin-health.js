// server/routes/garmin-health.js
import axios from "axios";
import express from "express";
import admin from "../admin.js";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

/**
 * IMPORTANT
 * - Your OAuth linking flow stores OAuth2 Bearer tokens at:
 *   users/{uid}.integrations.garmin.{accessToken, refreshToken, expiresAtMs, ...}
 * - Garmin Health API tends to use Ping/Pull + Backfill patterns.
 * - The "InvalidPullTokenException" you saw means /dailies with uploadStart/uploadEnd
 *   can't be called with arbitrary windows (it expects pull tokens/windows from Garmin ping),
 *   so we provide:
 *     1) /backfill/dailies (request history)
 *     2) /dailies (kept, but returns clear error if pull-token invalid)
 * - Base host is configurable via env; default matches your existing debug output.
 */

const HEALTH_BASE =
  process.env.GARMIN_HEALTH_BASE || "https://healthapi.garmin.com/wellness-api/rest";

const APIS_BASE =
  process.env.GARMIN_APIS_BASE || "https://apis.garmin.com/wellness-api/rest";

const TOKEN_ENDPOINT =
  process.env.GARMIN_TOKEN_ENDPOINT ||
  "https://diauth.garmin.com/di-oauth2-service/oauth/token";

router.use(requireUser);

/* ───────────────────────── HELPERS ───────────────────────── */

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dayWindowUTC(date) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const startSec = Math.floor(start.getTime() / 1000);
  const endSec = startSec + 86400 - 1;
  return { startSec, endSec };
}

function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function addDaysISO(date, delta) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const days = [];
  for (let current = from; current <= to; current = addDaysISO(current, 1)) {
    days.push(current);
  }
  return days;
}

function uidFromRequest(req) {
  return String(req.user?.uid || "").trim();
}

async function getUserGarminData(uid) {
  const snap = await admin.firestore().collection("users").doc(String(uid)).get();
  if (!snap.exists) return null;
  return snap.data()?.integrations?.garmin || null;
}

async function saveGarminIntegration(uid, integration) {
  await admin.firestore().collection("users").doc(String(uid)).set(
    {
      integrations: { garmin: integration },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function refreshAccessTokenIfNeeded(uid, garmin) {
  if (!garmin) return { ok: false, error: "No garmin integration" };

  const accessToken = garmin.accessToken;
  const refreshToken = garmin.refreshToken;
  const expiresAtMs = Number(garmin.expiresAtMs || 0);

  if (!accessToken) return { ok: false, error: "Missing accessToken" };

  const now = Date.now();
  const isExpired = expiresAtMs && now > expiresAtMs;

  if (!isExpired) return { ok: true, accessToken };

  if (!refreshToken) {
    return { ok: false, error: "Access token expired and no refreshToken present" };
  }

  const clientId = process.env.GARMIN_CLIENT_ID;
  const clientSecret = process.env.GARMIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { ok: false, error: "Missing GARMIN_CLIENT_ID or GARMIN_CLIENT_SECRET" };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }).toString();

  const resp = await axios.post(TOKEN_ENDPOINT, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (resp.status < 200 || resp.status >= 300) {
    return {
      ok: false,
      error: "Refresh failed",
      status: resp.status,
      details: resp.data || null,
    };
  }

  const tokenJson = resp.data || {};
  if (!tokenJson.access_token) {
    return { ok: false, error: "Refresh failed (no access_token)", details: tokenJson };
  }

  const newAccessToken = tokenJson.access_token;
  const newRefreshToken = tokenJson.refresh_token || refreshToken;

  const expiresInSec = Number(tokenJson.expires_in || 0);
  const newExpiresAtMs = now + Math.max(0, expiresInSec - 600) * 1000;

  const updated = {
    ...garmin,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAtMs: newExpiresAtMs,
    tokenType: tokenJson.token_type || garmin.tokenType || "bearer",
    scope: tokenJson.scope || garmin.scope || null,
    refreshedAtMs: now,
    tokenEndpoint: TOKEN_ENDPOINT,
  };

  await saveGarminIntegration(uid, updated);

  return { ok: true, accessToken: newAccessToken, refreshed: true };
}

async function bearerGet(url, accessToken) {
  try {
    const resp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      timeout: 20000,
      validateStatus: () => true,
    });

    const ok = resp.status >= 200 && resp.status < 300;
    return { ok, status: resp.status, body: resp.data };
  } catch (error) {
    return {
      ok: false,
      status: error.response?.status || 500,
      body: error.response?.data || error.message,
    };
  }
}

async function requestDailiesBackfill({ uid, date, accessToken, refreshed }) {
  const { startSec, endSec } = dayWindowUTC(date);
  const url = `${HEALTH_BASE}/backfill/dailies?summaryStartTimeInSeconds=${startSec}&summaryEndTimeInSeconds=${endSec}`;
  const result = await bearerGet(url, accessToken);

  await saveHealth(String(uid), "backfill_dailies_request", date, result.body, {
    url,
    status: result.status,
    refreshed: !!refreshed,
    summaryStartTimeInSeconds: startSec,
    summaryEndTimeInSeconds: endSec,
  });

  return {
    ok: result.ok,
    status: result.status,
    pending: result.status === 202,
    date,
    data: result.body,
  };
}

async function saveHealth(uid, kind, date, payload, meta = {}) {
  const ref = admin
    .firestore()
    .collection("users")
    .doc(String(uid))
    .collection("garmin_health")
    .doc(`${kind}_${date}`);

  await ref.set(
    {
      uid: String(uid),
      kind,
      date,
      payload: payload ?? null,
      meta,
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/* ───────────────────────── ROUTES ───────────────────────── */

/**
 * GET /garmin/health/debug
 */
router.get("/debug", async (req, res) => {
  const uid = uidFromRequest(req);
  if (!uid) return res.status(401).json({ ok: false, error: "Unauthenticated user" });
  const garmin = await getUserGarminData(uid);

  res.json({
    ok: true,
    uid,
    connected: !!garmin?.connected,
    hasAccessToken: !!garmin?.accessToken,
    hasRefreshToken: !!garmin?.refreshToken,
    expiresAtMs: garmin?.expiresAtMs || null,
    garminUserId: garmin?.garminUserId || null,
    scope: garmin?.scope || null,
    healthBase: HEALTH_BASE,
    apisBase: APIS_BASE,
    tokenEndpoint: TOKEN_ENDPOINT,
  });
});

/**
 * GET /garmin/health/user-id
 * Useful sanity check: calls /user/id on apis.garmin.com
 */
router.get("/user-id", async (req, res) => {
  try {
    const uid = uidFromRequest(req);
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthenticated user" });

    const garmin = await getUserGarminData(uid);
    if (!garmin?.accessToken) {
      return res.status(401).json({ ok: false, error: "Garmin not linked (no accessToken)" });
    }

    const tokenResult = await refreshAccessTokenIfNeeded(String(uid), garmin);
    if (!tokenResult.ok) return res.status(401).json({ ok: false, error: tokenResult.error });

    const url = `${APIS_BASE}/user/id`;
    const result = await bearerGet(url, tokenResult.accessToken);

    await saveHealth(String(uid), "user_id", todayISO(), result.body, {
      url,
      status: result.status,
      refreshed: !!tokenResult.refreshed,
    });

    return res.json({
      ok: result.ok,
      status: result.status,
      data: result.body,
    });
  } catch (e) {
    console.error("[garmin-health] user-id error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

/**
 * GET /garmin/health/backfill/dailies?date=YYYY-MM-DD
 * Requests historical data generation for the day window. Garmin will deliver via webhook/ping.
 */
router.get("/backfill/dailies", async (req, res) => {
  try {
    const uid = uidFromRequest(req);
    const date = String(req.query.date || todayISO());
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthenticated user" });

    const garmin = await getUserGarminData(uid);
    if (!garmin?.accessToken) {
      return res.status(401).json({ ok: false, error: "Garmin not linked (no accessToken)" });
    }

    const tokenResult = await refreshAccessTokenIfNeeded(String(uid), garmin);
    if (!tokenResult.ok) return res.status(401).json({ ok: false, error: tokenResult.error });

    const result = await requestDailiesBackfill({
      uid: String(uid),
      date,
      accessToken: tokenResult.accessToken,
      refreshed: tokenResult.refreshed,
    });

    return res.json({
      ok: result.ok,
      status: result.status,
      pending: result.status === 202,
      date,
      message:
        result.status === 202
          ? "Backfill requested. Garmin will deliver data via webhook/ping."
          : "Backfill request complete.",
      data: result.data,
    });
  } catch (e) {
    console.error("[garmin-health] backfill dailies error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

/**
 * GET /garmin/health/backfill/dailies-range?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Requests Garmin daily summary backfill for each date in a bounded range.
 */
router.get("/backfill/dailies-range", async (req, res) => {
  try {
    const uid = uidFromRequest(req);
    const to = String(req.query.to || todayISO());
    const from = String(req.query.from || addDaysISO(to, -29));
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthenticated user" });
    if (!isISODate(from) || !isISODate(to)) {
      return res.status(400).json({ ok: false, error: "from and to must use YYYY-MM-DD" });
    }

    const dates = daysBetweenInclusive(from, to);
    if (!dates.length) {
      return res.status(400).json({ ok: false, error: "Invalid date range" });
    }
    if (dates.length > 90) {
      return res.status(400).json({ ok: false, error: "Date range cannot exceed 90 days" });
    }

    const garmin = await getUserGarminData(uid);
    if (!garmin?.accessToken) {
      return res.status(401).json({ ok: false, error: "Garmin not linked (no accessToken)" });
    }

    const tokenResult = await refreshAccessTokenIfNeeded(String(uid), garmin);
    if (!tokenResult.ok) return res.status(401).json({ ok: false, error: tokenResult.error });

    const results = [];
    for (const date of dates) {
      const result = await requestDailiesBackfill({
        uid: String(uid),
        date,
        accessToken: tokenResult.accessToken,
        refreshed: tokenResult.refreshed,
      });
      results.push({
        date,
        ok: result.ok,
        status: result.status,
        pending: result.pending,
      });
    }

    const accepted = results.filter((row) => row.status === 202).length;
    const failed = results.filter((row) => !row.ok).length;

    return res.json({
      ok: failed === 0,
      from,
      to,
      requested: results.length,
      accepted,
      failed,
      message:
        accepted > 0
          ? "Backfill requested. Garmin will deliver available data via webhook."
          : "Backfill requests completed.",
      results,
    });
  } catch (e) {
    console.error("[garmin-health] backfill dailies range error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

/**
 * GET /garmin/health/dailies?date=YYYY-MM-DD
 *
 * NOTE:
 * - Many setups require Garmin-issued pull token windows (ping payload).
 * - If you pass arbitrary uploadStart/uploadEnd you may get InvalidPullTokenException.
 * - Keep this route for when you DO have valid ping windows later.
 */
router.get("/dailies", async (req, res) => {
  try {
    const uid = uidFromRequest(req);
    const date = String(req.query.date || todayISO());
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthenticated user" });

    const garmin = await getUserGarminData(uid);
    if (!garmin?.accessToken) {
      return res.status(401).json({ ok: false, error: "Garmin not linked (no accessToken)" });
    }

    const tokenResult = await refreshAccessTokenIfNeeded(String(uid), garmin);
    if (!tokenResult.ok) return res.status(401).json({ ok: false, error: tokenResult.error });

    const { startSec, endSec } = dayWindowUTC(date);

    const url = `${HEALTH_BASE}/dailies?uploadStartTimeInSeconds=${startSec}&uploadEndTimeInSeconds=${endSec}`;
    const result = await bearerGet(url, tokenResult.accessToken);

    await saveHealth(String(uid), "dailies_pull", date, result.body, {
      url,
      status: result.status,
      refreshed: !!tokenResult.refreshed,
      uploadStartTimeInSeconds: startSec,
      uploadEndTimeInSeconds: endSec,
    });

    // Surface Garmin's error message cleanly to speed debugging
    const errMsg =
      result?.body?.errorMessage ||
      (typeof result.body === "string" ? result.body : null) ||
      null;

    return res.json({
      ok: result.ok,
      status: result.status,
      date,
      errorMessage: !result.ok ? errMsg : null,
      data: result.body,
    });
  } catch (e) {
    console.error("[garmin-health] dailies error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

/**
 * GET /garmin/health/read?kind=...&date=YYYY-MM-DD
 * Reads stored payload from Firestore (what your app should use after webhooks store data).
 */
router.get("/read", async (req, res) => {
  try {
    const uid = uidFromRequest(req);
    const { kind, date } = req.query;
    if (!uid) return res.status(401).json({ ok: false, error: "Unauthenticated user" });
    if (!kind) return res.status(400).json({ ok: false, error: "Missing kind" });
    const d = String(date || todayISO());
    const baseRef = admin
      .firestore()
      .collection("users")
      .doc(String(uid))
      .collection("garmin_health");

    const kindStr = String(kind);
    // Backward/side-by-side compatibility:
    // - health route saves docs as `${kind}_${date}`
    // - webhook route saves dailies as `garmin_dailies_${date}`
    const candidateIds = [ `${kindStr}_${d}` ];
    if (kindStr === "dailies") candidateIds.push(`garmin_dailies_${d}`);

    for (const id of candidateIds) {
      const snap = await baseRef.doc(id).get();
      if (snap.exists) {
        return res.json({
          ok: true,
          found: true,
          uid: String(uid),
          kind: kindStr,
          date: d,
          docId: id,
          doc: snap.data(),
        });
      }
    }

    return res.json({
      ok: true,
      found: false,
      uid: String(uid),
      kind: kindStr,
      date: d,
      triedDocIds: candidateIds,
    });
  } catch (e) {
    console.error("[garmin-health] read error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

export default router;
