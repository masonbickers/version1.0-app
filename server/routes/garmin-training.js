import express from "express";

import admin from "../admin.js";
import { generateFitWorkout } from "../garmin/fitGenerator.js";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNonEmptyString(values, fallback = "") {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return fallback;
}

function mapDuration(step = {}) {
  const rawType = String(
    step?.durationType || step?.garmin?.durationType || ""
  ).toLowerCase();
  const unit = String(step?.durationUnit || step?.garmin?.durationUnit || "").toLowerCase();
  const rawValue =
    toNum(step?.durationValue) ??
    toNum(step?.garmin?.durationValue) ??
    toNum(step?.durationSec) ??
    0;

  const isDistance =
    rawType.includes("distance") ||
    rawType.includes("km") ||
    rawType.includes("meter") ||
    unit.includes("km") ||
    unit === "m";

  if (isDistance) {
    let km = rawValue;
    if (unit === "m" || rawType === "distance" || rawType.includes("meter")) {
      km = rawValue / 1000;
    }
    if (!Number.isFinite(km) || km <= 0) km = 1;
    return { durationType: "Distance (km)", durationValue: Number(km.toFixed(3)) };
  }

  let min = rawValue;
  if (unit.includes("sec") || rawType === "time") {
    min = rawValue / 60;
  }
  if (!Number.isFinite(min) || min <= 0) min = 1;
  return { durationType: "Time (min)", durationValue: Number(min.toFixed(2)) };
}

function mapIntensity(step = {}) {
  const stepType = String(step?.stepType || "").toLowerCase();
  if (stepType.includes("warm")) return "warmup";
  if (stepType.includes("cool")) return "cooldown";
  if (stepType.includes("recover") || stepType.includes("rest")) return "none";

  const intensity = String(step?.intensityType || step?.intensity || "").toLowerCase();
  if (intensity.includes("warm")) return "warmup";
  if (intensity.includes("cool")) return "cooldown";
  return "active";
}

function normaliseStep(step = {}) {
  const { durationType, durationValue } = mapDuration(step);
  return {
    type: firstNonEmptyString([step?.type, step?.title, step?.label], "Run"),
    notes: firstNonEmptyString([step?.notes, step?.description], ""),
    durationType,
    durationValue,
    intensityType: mapIntensity(step),
  };
}

function normaliseSteps(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return [];

  return steps
    .map((step) => {
      if (!step || typeof step !== "object") return null;

      const repeatCount =
        toNum(step?.repeatReps) ??
        toNum(step?.repeatCount) ??
        toNum(step?.garmin?.repeatCount) ??
        0;
      const inner = Array.isArray(step?.steps) ? step.steps : [];
      const isRepeat =
        Boolean(step?.isRepeat) ||
        String(step?.stepType || "").toLowerCase() === "repeat" ||
        (inner.length > 0 && repeatCount > 1);

      if (isRepeat && inner.length > 0) {
        return {
          isRepeat: true,
          repeatReps: Math.max(2, Math.round(repeatCount || 2)),
          steps: normaliseSteps(inner),
        };
      }

      return normaliseStep(step);
    })
    .filter(Boolean);
}

function buildFitSession(workout = {}) {
  const steps = normaliseSteps(workout?.steps);
  if (steps.length) {
    return { segments: steps };
  }

  const totalDurationSec = toNum(workout?.totalDurationSec) ?? 0;
  const totalDistanceKm = toNum(workout?.totalDistanceKm) ?? 0;

  if (totalDistanceKm > 0) {
    return {
      segments: [
        {
          type: "Run",
          notes: "",
          durationType: "Distance (km)",
          durationValue: Number(totalDistanceKm.toFixed(3)),
          intensityType: "active",
        },
      ],
    };
  }

  const min = Math.max(1, Math.round(totalDurationSec / 60));
  return {
    segments: [
      {
        type: "Run",
        notes: "",
        durationType: "Time (min)",
        durationValue: min,
        intensityType: "active",
      },
    ],
  };
}

async function loadGarminIntegration(uid) {
  const snap = await admin.firestore().collection("users").doc(String(uid)).get();
  if (!snap.exists) return null;
  return snap.data()?.integrations?.garmin || null;
}

function safeSnippet(text, max = 400) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  return raw.slice(0, max);
}

router.post("/send-workout", requireUser, async (req, res) => {
  try {
    const requesterUid = String(req.user?.uid || "").trim();
    const bodyUserId = String(req.body?.userId || "").trim();
    const uid = bodyUserId || requesterUid;

    if (!uid) {
      return res.status(400).json({ ok: false, error: "Missing userId" });
    }

    if (requesterUid && uid !== requesterUid) {
      return res.status(403).json({ ok: false, error: "Cannot send workout for another user" });
    }

    const workout = req.body?.workout;
    if (!workout || typeof workout !== "object") {
      return res.status(400).json({ ok: false, error: "Missing workout payload" });
    }

    const title = firstNonEmptyString(
      [req.body?.title, req.body?.workout?.name, req.body?.sessionKey],
      "Workout"
    );
    const sessionKey = firstNonEmptyString([req.body?.sessionKey], "");

    const garmin = await loadGarminIntegration(uid);
    if (!garmin?.connected || !garmin?.accessToken) {
      return res.status(409).json({
        ok: false,
        error: "Garmin is not connected for this account",
      });
    }

    const fitSession = buildFitSession(workout);
    const rawFit = generateFitWorkout(fitSession, title);
    const fitBuffer = Buffer.isBuffer(rawFit) ? rawFit : Buffer.from(rawFit);

    const uploadUrl = String(process.env.GARMIN_WORKOUT_UPLOAD_URL || "").trim();
    if (!uploadUrl) {
      return res.json({
        ok: true,
        synced: false,
        reason: "upload_not_configured",
        message:
          "Workout FIT generated, but GARMIN_WORKOUT_UPLOAD_URL is not configured on the server.",
      });
    }

    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${garmin.accessToken}`,
        "Content-Type": "application/x-garmin-fit",
        "X-Workout-Name": title,
      },
      body: fitBuffer,
    });

    const uploadText = await uploadResp.text().catch(() => "");
    if (!uploadResp.ok) {
      return res.status(502).json({
        ok: false,
        error: "Garmin workout upload failed",
        status: uploadResp.status,
        details: safeSnippet(uploadText),
      });
    }

    await admin
      .firestore()
      .collection("users")
      .doc(uid)
      .collection("garmin_workout_syncs")
      .add({
        sessionKey: sessionKey || null,
        title,
        uploadedAtMs: Date.now(),
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadUrl,
        responseStatus: uploadResp.status,
        responseSnippet: safeSnippet(uploadText),
      });

    return res.json({ ok: true, synced: true });
  } catch (error) {
    console.error("[garmin/send-workout] error:", error?.message || error);
    return res.status(500).json({
      ok: false,
      error: "Failed to send workout to Garmin",
    });
  }
});

router.post("/export-fit", requireUser, async (req, res) => {
  try {
    const requesterUid = String(req.user?.uid || "").trim();
    const bodyUserId = String(req.body?.userId || "").trim();
    const uid = bodyUserId || requesterUid;
    if (requesterUid && uid !== requesterUid) {
      return res.status(403).json({ ok: false, error: "Cannot export workout for another user" });
    }

    const workout = req.body?.workout;
    if (!workout || typeof workout !== "object") {
      return res.status(400).json({ ok: false, error: "Missing workout payload" });
    }

    const title = firstNonEmptyString(
      [req.body?.title, req.body?.workout?.name, req.body?.sessionKey],
      "Workout"
    );
    const fitSession = buildFitSession(workout);
    const rawFit = generateFitWorkout(fitSession, title);
    const fitBuffer = Buffer.isBuffer(rawFit) ? rawFit : Buffer.from(rawFit);

    const safeName = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "workout";

    res.setHeader("Content-Type", "application/x-garmin-fit");
    res.setHeader("Content-Disposition", `attachment; filename=\"${safeName}.fit\"`);
    res.setHeader("Content-Length", String(fitBuffer.length));
    return res.end(fitBuffer, "binary");
  } catch (error) {
    console.error("[garmin/export-fit] error:", error?.message || error);
    return res.status(500).json({
      ok: false,
      error: "Failed to export FIT workout",
    });
  }
});

export default router;
