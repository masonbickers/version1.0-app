// server/routes/workout.js
// ESM + matches your server pattern: export default (openai) => router
// Mounted as: app.use("/workouts", workoutRoutes(openai))
// Endpoints:
//   GET  /workouts/health
//   POST /workouts/ai  { prompt, meta? }

import express from "express";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

/* ---------------- helpers ---------------- */

function safeStr(v) {
  return String(v ?? "").trim();
}
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function isValidBlockKind(k) {
  return ["warmup", "strength", "conditioning", "hyrox", "accessory", "cooldown"].includes(k);
}
function isValidItemKind(k) {
  return ["exercise", "interval", "emom", "amrap", "for_time"].includes(k);
}

function isValidWatchStepType(k) {
  return [
    "run",
    "warmup",
    "recovery",
    "cooldown",
    "strength",
    "conditioning",
    "repeat",
  ].includes(k);
}

function isValidWatchDurationType(k) {
  return ["time", "distance", "open"].includes(k);
}

function isValidWatchTargetType(k) {
  return ["open", "pace_range", "hr_range"].includes(k);
}

function normaliseWorkoutResponse(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];

  const normalisedBlocks = blocks.map((b) => {
    const kind = isValidBlockKind(b?.kind) ? b.kind : "strength";
    const title = safeStr(b?.title) || kind.toUpperCase();

    const items = Array.isArray(b?.items) ? b.items : [];
    const normalisedItems = items
      .map((it) => {
        const k = isValidItemKind(it?.kind) ? it.kind : "exercise";
        const base = {
          id: it?.id || uid(),
          kind: k,
          name: safeStr(it?.name) || (k === "exercise" ? "Exercise" : "Item"),
          notes: safeStr(it?.notes) || "",
        };

        if (k === "exercise") {
          return {
            ...base,
            sets: it?.sets != null ? clamp(toNum(it.sets, 0), 0, 50) : undefined,
            reps: it?.reps != null ? clamp(toNum(it.reps, 0), 0, 200) : undefined,
            weight: it?.weight != null ? toNum(it.weight, 0) : undefined,
            rpe: it?.rpe != null ? toNum(it.rpe, 0) : undefined,
            restSec: it?.restSec != null ? clamp(toNum(it.restSec, 0), 0, 3600) : undefined,
          };
        }

        if (k === "interval") {
          return {
            ...base,
            workSec: it?.workSec != null ? clamp(toNum(it.workSec, 0), 0, 3600) : undefined,
            restSec: it?.restSec != null ? clamp(toNum(it.restSec, 0), 0, 3600) : undefined,
            rounds: it?.rounds != null ? clamp(toNum(it.rounds, 0), 1, 200) : undefined,
          };
        }

        // emom / amrap / for_time
        return {
          ...base,
          minutes: it?.minutes != null ? clamp(toNum(it.minutes, 0), 1, 240) : undefined,
          task: safeStr(it?.task) || "",
        };
      })
      .filter(Boolean);

    return {
      id: b?.id || uid(),
      title,
      kind,
      items: normalisedItems,
    };
  });

  return {
    name: safeStr(data.name),
    type: safeStr(data.type),
    goal: safeStr(data.goal),
    durationMin:
      data.durationMin != null && Number.isFinite(Number(data.durationMin))
        ? clamp(toNum(data.durationMin, 0), 0, 600)
        : undefined,
    notes: safeStr(data.notes),
    blocks: normalisedBlocks,
  };
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normaliseWatchTargetValue(raw, targetType) {
  const data = raw && typeof raw === "object" ? raw : {};
  if (targetType === "pace_range") {
    const minSecPerKm = toPositiveNumber(data.minSecPerKm ?? data.min);
    const maxSecPerKm = toPositiveNumber(data.maxSecPerKm ?? data.max);
    if (!minSecPerKm || !maxSecPerKm) return undefined;
    return {
      minSecPerKm: Math.round(minSecPerKm),
      maxSecPerKm: Math.round(maxSecPerKm),
    };
  }

  if (targetType === "hr_range") {
    const minBpm = toPositiveNumber(data.minBpm ?? data.min);
    const maxBpm = toPositiveNumber(data.maxBpm ?? data.max);
    if (!minBpm || !maxBpm) return undefined;
    return {
      minBpm: Math.round(minBpm),
      maxBpm: Math.round(maxBpm),
    };
  }

  return undefined;
}

function normaliseWatchStep(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const nested = Array.isArray(data.steps)
    ? data.steps.map((step) => normaliseWatchStep(step)).filter(Boolean)
    : [];

  const stepType = isValidWatchStepType(String(data.stepType || data.type || "").toLowerCase())
    ? String(data.stepType || data.type || "").toLowerCase()
    : "run";
  const durationType = isValidWatchDurationType(
    String(data.durationType || data.duration?.type || "").toLowerCase()
  )
    ? String(data.durationType || data.duration?.type || "").toLowerCase()
    : "open";
  const targetType = isValidWatchTargetType(String(data.targetType || "").toLowerCase())
    ? String(data.targetType || "").toLowerCase()
    : "open";

  const durationValue =
    toPositiveNumber(data.durationValue ?? data.duration?.value) ??
    (durationType === "time"
      ? toPositiveNumber(data.durationSec) ??
        (toPositiveNumber(data.durationMin) != null ? Number(data.durationMin) * 60 : null)
      : durationType === "distance"
      ? toPositiveNumber(data.distanceMeters) ??
        (toPositiveNumber(data.distanceKm) != null ? Number(data.distanceKm) * 1000 : null)
      : null);

  const durationUnit =
    durationType === "time"
      ? String(data.durationUnit || data.duration?.unit || "sec").toLowerCase().includes("min")
        ? "min"
        : "sec"
      : durationType === "distance"
      ? String(data.durationUnit || data.duration?.unit || "m").toLowerCase().includes("km")
        ? "km"
        : "m"
      : undefined;

  if (stepType === "repeat" && nested.length) {
    const repeatCount = Math.max(
      2,
      Math.round(toPositiveNumber(data.repeatCount ?? data.reps ?? data.repeat) || 2)
    );
    return {
      stepType: "repeat",
      repeatCount,
      notes: safeStr(data.notes || data.description),
      steps: nested,
    };
  }

  const step = {
    type: safeStr(data.type || data.title || data.label || "Step"),
    stepType,
    notes: safeStr(data.notes || data.description),
    targetType,
  };

  if (durationType !== "open") {
    step.durationType = durationType;
    step.durationValue =
      durationType === "time" && durationUnit === "min" && durationValue != null
        ? Number((durationValue / 60).toFixed(2))
        : durationType === "distance" && durationUnit === "km" && durationValue != null
        ? Number((durationValue / 1000).toFixed(3))
        : durationValue;
    step.durationUnit = durationUnit;
  }

  const targetValue = normaliseWatchTargetValue(data.targetValue, targetType);
  if (targetValue) step.targetValue = targetValue;

  return step;
}

function normaliseWatchWorkoutResponse(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const steps = Array.isArray(data.steps)
    ? data.steps.map((step) => normaliseWatchStep(step)).filter(Boolean)
    : [];

  const totalDurationSec =
    toPositiveNumber(data.totalDurationSec) ??
    (toPositiveNumber(data.totalDurationMin) != null ? Math.round(Number(data.totalDurationMin) * 60) : null);
  const totalDistanceKm =
    toPositiveNumber(data.totalDistanceKm) ??
    (toPositiveNumber(data.totalDistanceMeters) != null
      ? Number((Number(data.totalDistanceMeters) / 1000).toFixed(3))
      : null);

  return {
    title: safeStr(data.title || data.name || "Custom workout"),
    sport: safeStr(data.sport || data.type || "running").toLowerCase() || "running",
    description: safeStr(data.description || data.notes),
    totalDurationSec,
    totalDistanceKm,
    steps,
  };
}

function buildSystemPrompt() {
  return `
You generate a SINGLE workout session in structured JSON.

Rules:
- Output MUST be valid JSON (no markdown).
- Include: { name, type, goal, durationMin, notes, blocks: [...] }
- blocks: array of { title, kind, items }
- kind must be one of: warmup | strength | conditioning | hyrox | accessory | cooldown
- items must be array of:
  1) Exercise:
     { kind:"exercise", name, notes?, sets?, reps?, weight?, rpe?, restSec? }
  2) Interval:
     { kind:"interval", name, notes?, workSec, restSec, rounds }
  3) EMOM/AMRAP/FOR_TIME:
     { kind:"emom"|"amrap"|"for_time", name?, notes?, minutes, task? }

Guidelines:
- Keep it realistic and coach-like.
- If user provides duration, fit it (roughly).
- Add a warmup and cooldown when possible.
- If user mentions Hyrox, include Hyrox-style conditioning (sled push/pull, burpees, row, run etc) if appropriate.
- Use sensible defaults:
  - strength sets 3-5, reps 3-12, rest 60-180 sec
  - intervals rounds 4-10 with work/rest 30-120 sec
- Don't include medical claims or injury rehab advice.
`.trim();
}

function buildUserPrompt(prompt, meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  return `
User request:
${safeStr(prompt)}

Existing meta (may be empty; you may refine it):
- name: ${safeStr(m.name)}
- type: ${safeStr(m.type)}
- goal: ${safeStr(m.goal)}
- durationMin: ${m.durationMin != null ? String(m.durationMin) : ""}
- notes: ${safeStr(m.notes)}

Return JSON only.
`.trim();
}

function buildWatchWorkoutSystemPrompt() {
  return `
You generate a SINGLE Garmin-ready workout in structured JSON.

Output MUST be valid JSON only. No markdown.

Return this shape:
{
  "title": "Workout name",
  "sport": "running" | "strength" | "walking" | "cycling",
  "description": "short summary",
  "totalDurationSec": 0,
  "totalDistanceKm": 0,
  "steps": [
    {
      "type": "Warm up",
      "stepType": "warmup" | "run" | "recovery" | "cooldown" | "strength" | "conditioning",
      "durationType": "time" | "distance" | "open",
      "durationValue": 600,
      "durationUnit": "sec" | "min" | "m" | "km",
      "targetType": "open" | "pace_range" | "hr_range",
      "targetValue": {
        "minSecPerKm": 300,
        "maxSecPerKm": 330,
        "minBpm": 145,
        "maxBpm": 160
      },
      "notes": "optional cue"
    }
  ]
}

Rules:
- For running workouts, use simple Garmin-friendly steps.
- Prefer 3-8 steps total.
- Use "pace_range" only when pace guidance is useful.
- Use "hr_range" only when heart-rate guidance is useful.
- If a step has no concrete duration, use durationType "open".
- Do not return empty steps.
- Keep descriptions concise and coach-like.
- Include a warmup and cooldown when appropriate.
- If strength or hybrid is requested, still return a usable structured workout, but keep it simple and realistic.
`.trim();
}

function buildWatchWorkoutUserPrompt(prompt, meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  return `
User request:
${safeStr(prompt)}

Useful context:
- preferred sport: ${safeStr(m.sport)}
- title hint: ${safeStr(m.title)}
- duration minutes: ${m.durationMin != null ? String(m.durationMin) : ""}
- distance km: ${m.distanceKm != null ? String(m.distanceKm) : ""}
- notes: ${safeStr(m.notes)}

Return JSON only.
`.trim();
}

/* ---------------- routes factory ---------------- */

export default function workoutRoutes(openai) {
  // quick health check
  router.get("/health", (_req, res) => {
    res.json({ ok: true, route: "workout" });
  });

  // POST /workouts/ai
  router.post("/ai", requireUser, async (req, res) => {
    try {
      const prompt = safeStr(req.body?.prompt);
      const meta = req.body?.meta && typeof req.body.meta === "object" ? req.body.meta : {};

      if (!prompt) return res.status(400).json({ error: "Missing prompt." });
      if (!openai) return res.status(500).json({ error: "OpenAI client not configured on server." });

      const model = process.env.OPENAI_MODEL_WORKOUT || "gpt-4o-mini";
      const system = buildSystemPrompt();
      const user = buildUserPrompt(prompt, meta);

      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.6,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // openai v4 supports this; if your installed version doesn't, remove this line
        response_format: { type: "json_object" },
      });

      const content = completion?.choices?.[0]?.message?.content || "";
      let parsed = null;

      try {
        parsed = JSON.parse(content);
      } catch {
        return res.status(502).json({
          error: "AI did not return valid JSON.",
          raw: content?.slice(0, 2000),
        });
      }

      const normalised = normaliseWorkoutResponse(parsed);

      if (!Array.isArray(normalised.blocks) || normalised.blocks.length === 0) {
        return res.status(502).json({
          error: "AI returned no blocks. Try a more specific prompt.",
          raw: parsed,
        });
      }

      return res.json(normalised);
    } catch (err) {
      return res.status(500).json({ error: safeStr(err?.message) || "Unknown error" });
    }
  });

  router.post("/ai-watch", requireUser, async (req, res) => {
    try {
      const prompt = safeStr(req.body?.prompt);
      const meta = req.body?.meta && typeof req.body.meta === "object" ? req.body.meta : {};

      if (!prompt) return res.status(400).json({ error: "Missing prompt." });
      if (!openai) return res.status(500).json({ error: "OpenAI client not configured on server." });

      const model = process.env.OPENAI_MODEL_WORKOUT || "gpt-4o-mini";
      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.5,
        messages: [
          { role: "system", content: buildWatchWorkoutSystemPrompt() },
          { role: "user", content: buildWatchWorkoutUserPrompt(prompt, meta) },
        ],
        response_format: { type: "json_object" },
      });

      const content = completion?.choices?.[0]?.message?.content || "";
      let parsed = null;

      try {
        parsed = JSON.parse(content);
      } catch {
        return res.status(502).json({
          error: "AI did not return valid JSON.",
          raw: content?.slice(0, 2000),
        });
      }

      const workout = normaliseWatchWorkoutResponse(parsed);
      if (!Array.isArray(workout.steps) || !workout.steps.length) {
        return res.status(502).json({
          error: "AI returned no workout steps. Try a more specific prompt.",
          raw: parsed,
        });
      }

      return res.json(workout);
    } catch (err) {
      return res.status(500).json({ error: safeStr(err?.message) || "Unknown error" });
    }
  });

  return router;
}
