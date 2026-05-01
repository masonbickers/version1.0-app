import express from "express";
import admin from "../admin.js";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

const ACTIVITY_COLLECTIONS = ["garmin_activities", "garminActivities"];

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
    const garmin = userSnap.data()?.integrations?.garmin || null;

    return res.json({
      ok: true,
      connected: garmin?.connected === true,
      garminUserId: garmin?.garminUserId || null,
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

export default router;
