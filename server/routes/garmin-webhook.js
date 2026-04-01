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

export default router;