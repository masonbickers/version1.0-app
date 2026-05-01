import express from "express";
import admin from "../admin.js";
// Fixed path: removing the /garmin/ subfolder to match your explorer
// This goes up two levels to leave 'routes' and 'server', then into 'src'
import { stripUndefinedDeep } from "../utils/firestoreSafe.js";
const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const getServerTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

function normaliseIncomingBody(reqBody) {
  const raw = reqBody || {};
  if (raw && typeof raw === "object" && raw.body && typeof raw.body === "object") return raw.body;
  if (raw && typeof raw === "object" && raw.payload && typeof raw.payload === "object") return raw.payload;
  return raw;
}

function extractDailiesArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.dailies)) return payload.dailies;
  if (Array.isArray(payload.dailySummaries)) return payload.dailySummaries;
  if (payload.calendarDate) return [payload]; 
  return [];
}

function extractActivitiesArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.activities)) return payload.activities;
  if (Array.isArray(payload.activityDetails)) return payload.activityDetails;
  if (Array.isArray(payload.activitySummaries)) return payload.activitySummaries;
  if (Array.isArray(payload.activityFiles)) return payload.activityFiles;
  if (payload.activityId || payload.summaryId || payload.activitySummaryId) return [payload];
  return [];
}

function pickGarminUserId(payload, item) {
  return item?.userId || item?.userAccessToken || payload?.userId || null;
}

function pickCalendarDate(payload, item) {
  const raw = item?.calendarDate || payload?.calendarDate || null;
  if (!raw) return null;
  return typeof raw === "string" && raw.includes("T") ? raw.split("T")[0] : raw;
}

function isTestPayload(payload) {
  return payload?.test === true || payload?.type === "test";
}

async function findUidByGarminUserId(garminUserId) {
  if (!garminUserId) return null;
  const snap = await admin
    .firestore()
    .collection("users")
    .where("integrations.garmin.garminUserId", "==", garminUserId)
    .limit(1)
    .get();

  return snap.empty ? null : snap.docs[0].id;
}

function pickUsefulHeaders(req) {
  const keep = ["content-type", "user-agent", "garmin-client-id"];
  const out = {};
  for (const k of keep) if (req.headers[k]) out[k] = req.headers[k];
  return out;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseActivityType(value) {
  if (!value) return "Garmin activity";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return (
      value.typeKey ||
      value.typeName ||
      value.name ||
      value.displayName ||
      "Garmin activity"
    );
  }
  return String(value);
}

function toIsoStartTime(item) {
  const seconds = toFiniteNumber(
    firstDefined(
      item?.startTimeInSeconds,
      item?.summaryStartTimeInSeconds,
      item?.startTimestampGMT
    )
  );

  if (seconds !== null) return new Date(seconds * 1000).toISOString();

  return (
    item?.startTime ||
    item?.startDate ||
    item?.startDateLocal ||
    item?.startDateGMT ||
    item?.beginTimestamp ||
    null
  );
}

function calculatePaceSecPerKm({ item, distanceMeters, durationSeconds }) {
  const explicitSeconds = toFiniteNumber(item?.averagePaceSecPerKm);
  if (explicitSeconds !== null) return explicitSeconds;

  const minutesPerKm = toFiniteNumber(item?.averagePaceInMinutesPerKilometer);
  if (minutesPerKm !== null) return minutesPerKm * 60;

  if (distanceMeters > 0 && durationSeconds > 0) {
    return durationSeconds / (distanceMeters / 1000);
  }

  return null;
}

function activityDocId(activityId, index) {
  const base = activityId || `activity_${Date.now()}_${index}`;
  return String(base).replace(/[\/#?\[\]]/g, "_").slice(0, 140);
}

function mapGarminActivity(item, { garminUserId, rawWebhookDocId, index }) {
  const activityId = String(
    firstDefined(item?.activityId, item?.summaryId, item?.activitySummaryId, item?.id, "")
  ).trim();

  const activityType = normaliseActivityType(
    firstDefined(item?.activityType, item?.sport, item?.sportType, item?.type)
  );

  const distanceMeters =
    toFiniteNumber(
      firstDefined(
        item?.distanceMeters,
        item?.distanceInMeters,
        item?.distance,
        item?.summary?.distanceInMeters
      )
    ) || null;

  const durationSeconds =
    toFiniteNumber(
      firstDefined(
        item?.durationSeconds,
        item?.durationInSeconds,
        item?.elapsedDurationInSeconds,
        item?.movingDurationInSeconds,
        item?.summary?.durationInSeconds
      )
    ) || null;

  const averagePaceSecPerKm = calculatePaceSecPerKm({
    item,
    distanceMeters,
    durationSeconds,
  });

  const mapped = {
    source: "garmin",
    activityId: activityId || activityDocId(null, index),
    type: activityType,
    name: firstDefined(item?.activityName, item?.name, activityType, "Garmin activity"),
    startTime: toIsoStartTime(item),
    distanceMeters,
    durationSeconds,
    averagePaceSecPerKm,
    averageHeartRate: toFiniteNumber(
      firstDefined(
        item?.averageHeartRate,
        item?.averageHeartRateInBeatsPerMinute,
        item?.avgHr,
        item?.summary?.averageHeartRateInBeatsPerMinute
      )
    ),
    calories: toFiniteNumber(
      firstDefined(
        item?.calories,
        item?.activeKilocalories,
        item?.kilocalories,
        item?.summary?.activeKilocalories
      )
    ),
    createdAtMs: Date.now(),
    garminUserId,
    rawWebhookDocId,
    updatedAt: getServerTimestamp(),
  };

  return {
    docId: activityDocId(mapped.activityId, index),
    data: stripUndefinedDeep(mapped),
  };
}

/* -------------------------------------------------------------------------- */
/* Main Mapping Logic                                                         */
/* -------------------------------------------------------------------------- */

async function mapToUserHealth({ payload, rawWebhookDocId, allowUserWrite }) {
  const items = extractDailiesArray(payload);
  
  let garminUserId = null;
  for (const item of items) {
    garminUserId = pickGarminUserId(payload, item);
    if (garminUserId) break;
  }

  const uid = garminUserId ? await findUidByGarminUserId(garminUserId) : null;
  const results = [];

  if (!uid || !allowUserWrite) {
    return { uid, garminUserId, results: [{ mapped: false, reason: "no_uid_match_or_test" }] };
  }

  const batch = admin.firestore().batch();

  for (const item of items) {
    const calendarDate = pickCalendarDate(payload, item);
    if (!calendarDate) continue;

    const docId = `garmin_dailies_${calendarDate}`; 
    const userHealthRef = admin.firestore()
      .collection("users")
      .doc(uid)
      .collection("garmin_health")
      .doc(docId);

    const cleanPayload = stripUndefinedDeep(item);

    batch.set(userHealthRef, {
      kind: "dailies",
      date: calendarDate,
      updatedAt: getServerTimestamp(),
      garminUserId,
      rawWebhookDocId,
      data: cleanPayload 
    }, { merge: true });

    results.push({ calendarDate, mapped: true });
  }

  await batch.commit();
  return { uid, garminUserId, results };
}

async function mapToUserActivities({ payload, rawWebhookDocId, allowUserWrite }) {
  const items = extractActivitiesArray(payload);

  let garminUserId = null;
  for (const item of items) {
    garminUserId = pickGarminUserId(payload, item);
    if (garminUserId) break;
  }

  const uid = garminUserId ? await findUidByGarminUserId(garminUserId) : null;
  const results = [];

  if (!uid || !allowUserWrite) {
    return {
      uid,
      garminUserId,
      results: [{ mapped: false, reason: "no_uid_match_or_test", count: items.length }],
    };
  }

  if (!items.length) {
    return {
      uid,
      garminUserId,
      results: [{ mapped: false, reason: "no_activities_in_payload" }],
    };
  }

  const batch = admin.firestore().batch();

  items.forEach((item, index) => {
    const { docId, data } = mapGarminActivity(item, {
      garminUserId,
      rawWebhookDocId,
      index,
    });

    const activityRef = admin
      .firestore()
      .collection("users")
      .doc(uid)
      .collection("garmin_activities")
      .doc(docId);

    batch.set(activityRef, data, { merge: true });
    results.push({ activityId: data.activityId, docId, mapped: true });
  });

  await batch.commit();
  return { uid, garminUserId, results };
}

async function handleActivitiesWebhook(req, res) {
  res.status(200).json({ ok: true });

  try {
    const payload = normaliseIncomingBody(req.body);
    const test = isTestPayload(payload);

    const rawRef = await admin.firestore().collection("garmin_webhooks").add({
      receivedAt: getServerTimestamp(),
      kind: "activities",
      payload: stripUndefinedDeep(payload),
      headers: pickUsefulHeaders(req),
      test,
    });

    const outcome = await mapToUserActivities({
      payload,
      rawWebhookDocId: rawRef.id,
      allowUserWrite: !test,
    });

    await rawRef.update({
      processed: true,
      uid: outcome.uid,
      garminUserId: outcome.garminUserId,
      results: outcome.results,
    });
  } catch (e) {
    console.error("Garmin Activities Webhook Processing Error:", e);
    await admin.firestore().collection("garmin_errors").add({
      error: e.message,
      at: getServerTimestamp(),
      context: "webhook_activities",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Webhook Endpoint                                                           */
/* -------------------------------------------------------------------------- */

router.post("/dailies", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const payload = normaliseIncomingBody(req.body);
    const test = isTestPayload(payload);

    const rawRef = await admin.firestore().collection("garmin_webhooks").add({
      receivedAt: getServerTimestamp(),
      payload: stripUndefinedDeep(payload),
      headers: pickUsefulHeaders(req),
      test
    });

    const outcome = await mapToUserHealth({
      payload,
      rawWebhookDocId: rawRef.id,
      allowUserWrite: !test
    });

    await rawRef.update({
      processed: true,
      uid: outcome.uid,
      results: outcome.results
    });

  } catch (e) {
    console.error("Webhook Processing Error:", e);
    await admin.firestore().collection("garmin_errors").add({
      error: e.message,
      at: getServerTimestamp(),
      context: "webhook_dailies"
    });
  }
});

router.post("/activities", handleActivitiesWebhook);
router.post("/activity-details", handleActivitiesWebhook);
router.post("/activityDetails", handleActivitiesWebhook);

export default router;
