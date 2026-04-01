// server/routes/plans-ai.js
import crypto from "crypto";
import express from "express";
import admin from "firebase-admin";
import OpenAI from "openai";

/**
 * Assumptions:
 * - Firebase Admin initialised elsewhere (do NOT initializeApp here)
 * - This router is mounted under /plans
 *
 * Endpoints:
 * - POST /plans/ai/start   (creates job + begins processing best-effort)
 * - POST /plans/ai/kick    (forces processing for queued/stale jobs; serverless-safe)
 */

const router = express.Router();

const adb = admin.apps.length ? admin.firestore() : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ─────────────────────────────────────────────
   Tiny utils
───────────────────────────────────────────── */
function safeObj(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}
function safeArr(x) {
  return Array.isArray(x) ? x : [];
}
function safeStr(v) {
  return String(v ?? "").trim();
}
function toNum(v, fallback = undefined) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function nowMs() {
  return Date.now();
}
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id_${nowMs()}_${Math.floor(Math.random() * 1e9)}`;
}

function extractFirstJsonObject(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}
function jsonParseBestEffort(text) {
  try {
    return JSON.parse(text);
  } catch {
    const candidate = extractFirstJsonObject(text);
    if (!candidate) return null;
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

/* ─────────────────────────────────────────────
   Firestore-safe cleaner
───────────────────────────────────────────── */
function stripUndefinedDeep(obj) {
  if (Array.isArray(obj)) return obj.map(stripUndefinedDeep).filter((x) => x !== undefined);
  if (obj && typeof obj === "object") {
    const out = {};
    Object.keys(obj).forEach((k) => {
      const v = stripUndefinedDeep(obj[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  return obj === undefined ? undefined : obj;
}

/* ─────────────────────────────────────────────
   Auth guard
   Client sends: Authorization: Bearer <Firebase ID token>
───────────────────────────────────────────── */
async function requireUser(req) {
  const header = safeStr(req.headers.authorization);
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded || null;
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   Basic per-uid rate limit (in-memory)
───────────────────────────────────────────── */
const RATE = {
  WINDOW_MS: 60 * 60 * 1000, // 1 hour
  MAX_PER_WINDOW: 6,
};
const rateMap = new Map(); // uid -> { resetAt, count }

function rateLimitOrThrow(uid) {
  const t = nowMs();
  const cur = rateMap.get(uid);

  if (!cur || t > cur.resetAt) {
    rateMap.set(uid, { resetAt: t + RATE.WINDOW_MS, count: 1 });
    return;
  }

  if (cur.count >= RATE.MAX_PER_WINDOW) {
    const mins = Math.ceil((cur.resetAt - t) / 60000);
    const err = new Error(`Rate limit: try again in ~${mins} min`);
    err.status = 429;
    throw err;
  }

  cur.count += 1;
  rateMap.set(uid, cur);
}

/* ─────────────────────────────────────────────
   Pace parsing + training pace derivation (user-specific)
   Accepts:
   - "18:21"  (mm:ss)
   - "00:18:21" (hh:mm:ss)
   - "18m21s"
───────────────────────────────────────────── */
function parseTimeToSeconds(s) {
  const x = safeStr(s).toLowerCase();
  if (!x) return undefined;

  // "18m21s"
  const m1 = x.match(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:s)?)?\s*(\d+)\s*s(?:ec(?:s)?)?/);
  if (m1) {
    const hh = Number(m1[1] || 0);
    const mm = Number(m1[2] || 0);
    const ss = Number(m1[3] || 0);
    const out = hh * 3600 + mm * 60 + ss;
    return Number.isFinite(out) && out > 0 ? out : undefined;
  }
  const m2 = x.match(/(\d+)\s*m(?:in(?:s)?)?\s*(\d+)\s*s(?:ec(?:s)?)?/);
  if (m2) {
    const mm = Number(m2[1] || 0);
    const ss = Number(m2[2] || 0);
    const out = mm * 60 + ss;
    return Number.isFinite(out) && out > 0 ? out : undefined;
  }

  // "hh:mm:ss" or "mm:ss"
  const parts = x.split(":").map((p) => Number(p));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    const out = parts[0] * 60 + parts[1];
    return out > 0 ? out : undefined;
  }
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const out = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return out > 0 ? out : undefined;
  }

  return undefined;
}

function formatPaceSecPerKm(secPerKm) {
  const s = Math.round(secPerKm);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}/km`;
}

function deriveTrainingPacesFromBenchmarks(profile) {
  // Uses very simple, practical bands (not “perfect science”, but solid defaults).
  const p = safeObj(profile);
  const running = safeObj(p.running);

  const fiveKSec = parseTimeToSeconds(running.fiveK);
  const tenKSec = parseTimeToSeconds(running.tenK);

  // If we have both, prefer 10K for threshold-ish guidance; else 5K.
  const basis = tenKSec
    ? { sec: tenKSec, km: 10 }
    : fiveKSec
    ? { sec: fiveKSec, km: 5 }
    : null;

  if (!basis) return null;

  const racePace = basis.sec / basis.km; // sec/km

  // Bands relative to race pace.
  // (These are intentionally conservative to keep plans achievable.)
  const paces = {
    easy: racePace * 1.22,       // slower
    steady: racePace * 1.14,
    tempo: racePace * 1.08,
    threshold: racePace * 1.04,
    vo2: racePace * 0.98,        // faster
  };

  return {
    basis: tenKSec ? "10K" : "5K",
    racePace: formatPaceSecPerKm(racePace),
    easy: formatPaceSecPerKm(paces.easy),
    steady: formatPaceSecPerKm(paces.steady),
    tempo: formatPaceSecPerKm(paces.tempo),
    threshold: formatPaceSecPerKm(paces.threshold),
    vo2: formatPaceSecPerKm(paces.vo2),
  };
}

/* ─────────────────────────────────────────────
   Garmin runSteps normaliser + enforcer
───────────────────────────────────────────── */
function normaliseRunSteps(steps) {
  const arr = safeArr(steps);

  const allowedStepTypes = new Set(["warmup", "work", "rest", "cooldown"]);
  const allowedDurTypes = new Set(["time", "distance", "open"]);
  const allowedTargetTypes = new Set(["pace", "hr", "effort", "open"]);

  const toPositiveNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return arr
    .map((st, i) => {
      const s = safeObj(st);
      const duration = safeObj(s.duration);
      const target = safeObj(s.target);

      const stepTypeRaw = safeStr(s.type).toLowerCase();
      const stepType = allowedStepTypes.has(stepTypeRaw) ? stepTypeRaw : "work";

      const durTypeRaw = safeStr(duration.type).toLowerCase();
      const durType = allowedDurTypes.has(durTypeRaw) ? durTypeRaw : "open";

      const tgtTypeRaw = safeStr(target.type).toLowerCase();
      const tgtType = allowedTargetTypes.has(tgtTypeRaw) ? tgtTypeRaw : "open";

      // Garmin rule: if time => seconds; distance => metres
      // We enforce only positive numbers and allow "open" with undefined.
      const durVal = durType === "open" ? undefined : toPositiveNum(duration.value);

      return stripUndefinedDeep({
        id: safeStr(s.id) || `step_${nowMs()}_${i}`,
        type: stepType,
        duration: stripUndefinedDeep({ type: durType, value: durVal }),
        target: stripUndefinedDeep({
          type: tgtType,
          value: safeStr(target.value) || "",
          low: safeStr(target.low) || "",
          high: safeStr(target.high) || "",
        }),
        notes: safeStr(s.notes) || "",
      });
    })
    .filter(Boolean);
}

function enforceGarminRunSteps(runSteps) {
  let steps = normaliseRunSteps(runSteps);
  if (!steps.length) return [];

  // warmup first
  if (steps[0]?.type !== "warmup") {
    steps.unshift(
      stripUndefinedDeep({
        id: `step_${nowMs()}_warmup`,
        type: "warmup",
        duration: { type: "time", value: 600 },
        target: { type: "effort", value: "easy" },
        notes: "Warm-up",
      })
    );
  }

  // cooldown last
  if (steps[steps.length - 1]?.type !== "cooldown") {
    steps.push(
      stripUndefinedDeep({
        id: `step_${nowMs()}_cooldown`,
        type: "cooldown",
        duration: { type: "time", value: 600 },
        target: { type: "effort", value: "easy" },
        notes: "Cool-down",
      })
    );
  }

  // avoid work-work (insert default rest)
  const fixed = [];
  for (let i = 0; i < steps.length; i++) {
    const cur = steps[i];
    const prev = fixed[fixed.length - 1];
    if (prev && prev.type === "work" && cur.type === "work") {
      fixed.push(
        stripUndefinedDeep({
          id: `step_${nowMs()}_auto_rest_${i}`,
          type: "rest",
          duration: { type: "time", value: 60 },
          target: { type: "open" },
          notes: "Recovery",
        })
      );
    }
    fixed.push(cur);
  }

  return normaliseRunSteps(fixed);
}

/* ─────────────────────────────────────────────
   Warmup/Cooldown blocks enforcement (ALL sessions)
───────────────────────────────────────────── */
function ensureWarmCoolBlocks(session) {
  const s = safeObj(session);
  const blocks = safeArr(s.blocks);

  const hasWarm = blocks.some((b) => safeStr(b?.kind) === "warmup");
  const hasCool = blocks.some((b) => safeStr(b?.kind) === "cooldown");

  const out = [...blocks];

  if (!hasWarm) {
    out.unshift({
      id: `warm_${nowMs()}`,
      title: "Warm-up",
      kind: "warmup",
      collapsed: false,
      items: [
        {
          kind: s.type === "run" ? "run" : "cardio",
          title: "Easy warm-up",
          timeSec: 600,
          effort: "easy",
          rpe: 4,
        },
      ],
    });
  }

  if (!hasCool) {
    out.push({
      id: `cool_${nowMs()}`,
      title: "Cool-down",
      kind: "cooldown",
      collapsed: false,
      items: [
        {
          kind: s.type === "run" ? "run" : "cardio",
          title: "Easy cool-down",
          timeSec: 600,
          effort: "easy",
          rpe: 3,
        },
      ],
    });
  }

  return out;
}

/* ─────────────────────────────────────────────
   Strength structure enforcement (primary + accessory)
   (Works with your builder fields: sets/reps/load/restSec/rpe|rir)
───────────────────────────────────────────── */
function ensureStrengthStructure(session, profile = {}) {
  const s = safeObj(session);
  if (safeStr(s.type) !== "strength") return safeArr(s.blocks);

  const blocks = safeArr(s.blocks);

  const hasPrimary = blocks.some((b) => safeStr(b?.kind) === "primary");
  const hasAccessory = blocks.some((b) => safeStr(b?.kind) === "accessory");

  const out = [...blocks];

  const strength = safeObj(safeObj(profile).strength);
  const squatKg = toNum(strength.squatKg);
  const benchKg = toNum(strength.benchKg);
  const deadliftKg = toNum(strength.deadliftKg);

  // crude “pick a lift” logic (still better than random)
  const primaryLift =
    benchKg && (!squatKg || benchKg >= squatKg)
      ? "Bench Press"
      : deadliftKg && (!squatKg || deadliftKg >= squatKg)
      ? "Deadlift"
      : "Back Squat";

  const primaryLoadHint =
    primaryLift === "Bench Press" && benchKg
      ? `~70–82% of ${benchKg}kg 1RM`
      : primaryLift === "Deadlift" && deadliftKg
      ? `~70–82% of ${deadliftKg}kg 1RM`
      : primaryLift === "Back Squat" && squatKg
      ? `~70–82% of ${squatKg}kg 1RM`
      : "Moderate-Heavy";

  if (!hasPrimary) {
    out.push({
      id: `prim_${nowMs()}`,
      title: "Primary Lift",
      kind: "primary",
      collapsed: false,
      items: [
        {
          kind: "exercise",
          title: primaryLift,
          sets: 5,
          reps: 5,
          restSec: 150,
          load: primaryLoadHint,
          rpe: 8,
          cues: "Controlled reps, full range, stop 1–2 reps shy of failure.",
        },
      ],
    });
  }

  if (!hasAccessory) {
    out.push({
      id: `acc_${nowMs()}`,
      title: "Accessory Work",
      kind: "accessory",
      collapsed: false,
      items: [
        {
          kind: "exercise",
          title: "Romanian Deadlift",
          sets: 3,
          reps: 8,
          restSec: 120,
          load: "Moderate",
          rir: 2,
        },
        {
          kind: "exercise",
          title: "Split Squat",
          sets: 3,
          reps: 10,
          restSec: 90,
          load: "Moderate",
          rir: 2,
        },
        {
          kind: "exercise",
          title: "Row Variation",
          sets: 3,
          reps: 10,
          restSec: 75,
          load: "Moderate",
          rir: 2,
        },
      ],
    });
  }

  return out;
}

/* ─────────────────────────────────────────────
   Derive runSteps from blocks/items if missing
───────────────────────────────────────────── */
function deriveRunStepsFromBlocks(session, paceGuide = null) {
  const s = safeObj(session);
  const blocks = safeArr(s.blocks);
  const steps = [];

  const pushStep = (partial) => {
    if (!partial) return;
    steps.push(
      stripUndefinedDeep({
        id: `step_${nowMs()}_${steps.length}`,
        type: safeStr(partial.type) || "work",
        duration: stripUndefinedDeep({
          type: safeStr(partial?.duration?.type) || "open",
          value: toNum(partial?.duration?.value, undefined),
        }),
        target: stripUndefinedDeep({
          type: safeStr(partial?.target?.type) || "open",
          value: safeStr(partial?.target?.value) || "",
          low: safeStr(partial?.target?.low) || "",
          high: safeStr(partial?.target?.high) || "",
        }),
        notes: safeStr(partial.notes) || "",
      })
    );
  };

  const defaultEasy = paceGuide?.easy || "easy";
  const defaultSteady = paceGuide?.steady || "steady";

  // Warmup
  const warm = blocks.find((b) => safeStr(b?.kind) === "warmup");
  if (warm) {
    const items = safeArr(warm.items);
    const t = items.find((it) => toNum(it?.timeSec) || toNum(it?.distanceM));
    pushStep({
      type: "warmup",
      duration: t?.timeSec
        ? { type: "time", value: toNum(t.timeSec) }
        : t?.distanceM
        ? { type: "distance", value: toNum(t.distanceM) }
        : { type: "time", value: 600 },
      target: { type: paceGuide ? "pace" : "effort", value: paceGuide ? defaultEasy : safeStr(t?.effort || "easy") },
      notes: "Warm-up",
    });
  }

  // Main from items
  blocks.forEach((b) => {
    safeArr(b?.items).forEach((it) => {
      const kind = safeStr(it?.kind);
      if (!["run", "interval", "cardio", "rest"].includes(kind)) return;

      const isRest = kind === "rest";
      const duration =
        toNum(it?.timeSec)
          ? { type: "time", value: toNum(it?.timeSec) }
          : toNum(it?.distanceM)
          ? { type: "distance", value: toNum(it?.distanceM) }
          : { type: "open" };

      const target = safeStr(it?.pace)
        ? { type: "pace", value: safeStr(it?.pace) }
        : safeStr(it?.effort)
        ? { type: "effort", value: safeStr(it?.effort) }
        : paceGuide && !isRest
        ? { type: "pace", value: defaultSteady }
        : { type: "open" };

      pushStep({
        type: isRest ? "rest" : "work",
        duration,
        target,
        notes: safeStr(it?.title) || "",
      });

      // Auto rest if restSec exists
      if (!isRest && Number.isFinite(toNum(it?.restSec))) {
        pushStep({
          type: "rest",
          duration: { type: "time", value: toNum(it.restSec) },
          target: { type: "open" },
          notes: "Recovery",
        });
      }
    });
  });

  // Cooldown
  const cool = blocks.find((b) => safeStr(b?.kind) === "cooldown");
  if (cool) {
    const items = safeArr(cool.items);
    const t = items.find((it) => toNum(it?.timeSec) || toNum(it?.distanceM));
    pushStep({
      type: "cooldown",
      duration: t?.timeSec
        ? { type: "time", value: toNum(t.timeSec) }
        : t?.distanceM
        ? { type: "distance", value: toNum(t.distanceM) }
        : { type: "time", value: 600 },
      target: { type: paceGuide ? "pace" : "effort", value: paceGuide ? defaultEasy : safeStr(t?.effort || "easy") },
      notes: "Cool-down",
    });
  }

  const cleaned = enforceGarminRunSteps(steps);
  return cleaned.length >= 2 ? cleaned : [];
}

/* ─────────────────────────────────────────────
   Plan normaliser + validation/autofix
   Aligns with builder’s expected shape.
───────────────────────────────────────────── */
function normaliseAiPlan(raw, meta = {}) {
  const data = safeObj(raw);
  const weeksCount = clamp(toNum(data.weeks ?? meta.weeks, 6) ?? 6, 1, 52);

  const out = {
    name: safeStr(data.name || meta.name || "Hybrid Plan"),
    goal: safeStr(data.goal || meta.goal || "Hybrid training"),
    weeks: weeksCount,
    startDate: safeStr(data.startDate || meta.startDate || ""),
    profile: safeObj(data.profile || meta.profile || {}),
    plan: [],
  };

  const planWeeks = safeArr(data.plan);
  const byWeek = new Map();

  for (const w of planWeeks) {
    const ww = safeObj(w);
    const weekNum = clamp(toNum(ww.week, undefined) ?? undefined, 1, 52);
    if (!weekNum) continue;
    byWeek.set(weekNum, ww);
  }

  const maxWeek = byWeek.size ? Math.max(...Array.from(byWeek.keys())) : 0;
  const targetWeeks = Math.max(weeksCount, maxWeek);

  for (let week = 1; week <= targetWeeks; week++) {
    const ww = safeObj(byWeek.get(week) || { week, days: [] });
    const daysRaw = safeArr(ww.days);

    const dayMap = new Map();
    for (const d of daysRaw) {
      const dd = safeObj(d);
      const day = DAYS.includes(dd.day) ? dd.day : null;
      if (!day) continue;
      dayMap.set(day, dd);
    }

    const days = DAYS.map((day) => {
      const dd = safeObj(dayMap.get(day) || { day, sessions: [] });
      const sessionsRaw = safeArr(dd.sessions);

      const sessions = sessionsRaw
        .map((s, idx) => {
          const ss = safeObj(s);
          const durationMin = clamp(toNum(ss.durationMin, 60) ?? 60, 10, 240);

          return stripUndefinedDeep({
            id: safeStr(ss.id) || `${week}_${day}_${idx}_${nowMs()}`,
            name: safeStr(ss.name || "Session"),
            type: safeStr(ss.type || "hybrid"),
            timeOfDay: safeStr(ss.timeOfDay || "") || undefined,
            priority: safeStr(ss.priority || "secondary"),
            durationMin,
            notes: safeStr(ss.notes || ""),
            runSteps: safeArr(ss.runSteps),
            blocks: safeArr(ss.blocks),
          });
        })
        .filter(Boolean);

      return { day, sessions };
    });

    out.plan.push({ week, days });
  }

  return out;
}

function validateAndFixPlan(plan, meta = {}) {
  const warnings = [];
  const fixed = safeObj(plan);

  fixed.name = safeStr(fixed.name) || safeStr(meta?.name) || "Hybrid Plan";
  fixed.goal = safeStr(fixed.goal) || safeStr(meta?.goal) || "Hybrid training";
  fixed.weeks = clamp(toNum(fixed.weeks, 6) ?? 6, 1, 52);
  fixed.startDate = safeStr(fixed.startDate || safeStr(meta?.startDate) || "");
  fixed.profile = safeObj(fixed.profile || meta?.profile || {});
  fixed.plan = safeArr(fixed.plan);

  const paceGuide = deriveTrainingPacesFromBenchmarks(fixed.profile);

  fixed.plan = fixed.plan.map((wk) => {
    const weekNum = clamp(toNum(wk?.week, 1) ?? 1, 1, 52);

    const rawDays = safeArr(wk?.days);
    const map = new Map();
    rawDays.forEach((d) => {
      const day = DAYS.includes(d?.day) ? d.day : null;
      if (!day) return;
      map.set(day, d);
    });

    const days = DAYS.map((day) => {
      const base = safeObj(map.get(day) || { day, sessions: [] });
      const daySessionsCount = safeArr(base.sessions).length;

      const sessions = safeArr(base.sessions).map((sess, idx) => {
        const s = safeObj(sess);

        s.id = safeStr(s.id) || `${weekNum}_${day}_${idx}_${nowMs()}`;
        s.name = safeStr(s.name) || "Session";
        s.type = safeStr(s.type) || "hybrid";
        s.priority = safeStr(s.priority) || "secondary";
        s.durationMin = clamp(toNum(s.durationMin, 60) ?? 60, 10, 240);
        s.notes = safeStr(s.notes) || "";

        // Ensure warm/cool blocks for ALL sessions
        s.blocks = ensureWarmCoolBlocks(s);

        // Strength needs primary + accessory blocks (coach-level structure)
        if (s.type === "strength") {
          s.blocks = ensureStrengthStructure(s, fixed.profile);
        }

        // timeOfDay required if 2+ sessions/day
        if (daySessionsCount >= 2 && !safeStr(s.timeOfDay)) {
          s.timeOfDay = idx === 0 ? "AM" : idx === 1 ? "PM" : "MID";
          warnings.push(`Added timeOfDay for Week ${weekNum} ${day} "${s.name}".`);
        }

        // Strength strictness: all exercise items must have sets/reps/load/restSec + (rpe or rir)
        if (s.type === "strength") {
          safeArr(s.blocks).forEach((b) => {
            safeArr(b?.items).forEach((it) => {
              if (safeStr(it?.kind) !== "exercise") return;

              const sets = toNum(it.sets);
              const reps = toNum(it.reps);
              const restSec = toNum(it.restSec);
              const hasRpe = Number.isFinite(toNum(it.rpe));
              const hasRir = Number.isFinite(toNum(it.rir));

              if (!sets || sets < 1) {
                it.sets = 4;
                warnings.push(`Strength missing sets in "${s.name}". Auto-filled 4.`);
              }
              if (!reps || reps < 1) {
                it.reps = 8;
                warnings.push(`Strength missing reps in "${s.name}". Auto-filled 8.`);
              }
              if (!safeStr(it.load)) {
                it.load = "Moderate-Heavy";
                warnings.push(`Strength missing load in "${s.name}". Auto-filled.`);
              }
              if (!restSec || restSec < 30) it.restSec = 120;
              if (!hasRpe && !hasRir) {
                it.rpe = 8;
                warnings.push(`Strength missing RPE/RIR in "${s.name}". Auto-filled RPE 8.`);
              }
            });
          });
        }

        // Run strictness (Garmin compatible + user-specific pace guidance)
        if (s.type === "run") {
          let steps = safeArr(s.runSteps);

          if (!steps.length) {
            const derived = deriveRunStepsFromBlocks(s, paceGuide);
            if (derived.length) {
              steps = derived;
              warnings.push(`Derived runSteps for "${s.name}".`);
            } else {
              // Simple fallback that’s always valid Garmin structure
              steps = [
                {
                  type: "warmup",
                  duration: { type: "time", value: 600 },
                  target: paceGuide ? { type: "pace", value: paceGuide.easy } : { type: "effort", value: "easy" },
                  notes: "Warm-up",
                },
                {
                  type: "work",
                  duration: { type: "time", value: 1800 },
                  target: paceGuide ? { type: "pace", value: paceGuide.steady } : { type: "effort", value: "steady" },
                  notes: "Main set",
                },
                {
                  type: "cooldown",
                  duration: { type: "time", value: 600 },
                  target: paceGuide ? { type: "pace", value: paceGuide.easy } : { type: "effort", value: "easy" },
                  notes: "Cool-down",
                },
              ];
              warnings.push(`Run "${s.name}" missing runSteps. Auto-added a simple Garmin structure.`);
            }
          }

          s.runSteps = enforceGarminRunSteps(steps);
        }

        return stripUndefinedDeep(s);
      });

      return { day, sessions };
    });

    return { week: weekNum, days };
  });

  // Attach pace guide to profile so the client can show it later if you want
  if (paceGuide) {
    fixed.profile = stripUndefinedDeep({
      ...fixed.profile,
      derivedPaces: paceGuide,
    });
  }

  return { fixed: stripUndefinedDeep(fixed), warnings };
}

/* ─────────────────────────────────────────────
   AI contract
   We inject derived paces into the system message to force specific pacing.
───────────────────────────────────────────── */
function buildSystemMessage({ meta }) {
  const profile = safeObj(meta?.profile);
  const paceGuide = deriveTrainingPacesFromBenchmarks(profile);

  const paceText = paceGuide
    ? `
USER PACE GUIDE (use these for target.type="pace" in runSteps, format "mm:ss/km"):
- Basis: ${paceGuide.basis} race pace ≈ ${paceGuide.racePace}
- Easy: ${paceGuide.easy}
- Steady: ${paceGuide.steady}
- Tempo: ${paceGuide.tempo}
- Threshold: ${paceGuide.threshold}
- VO2: ${paceGuide.vo2}

Rules for using paces:
- Easy runs: Easy pace
- Steady runs: Steady pace
- Tempo blocks: Tempo pace
- Threshold intervals: Threshold pace
- VO2 intervals: VO2 pace
`.trim()
    : `
No reliable 5K/10K provided. Use target.type="effort" with "easy/steady/tempo/threshold/vo2".
`.trim();

  return `
You are an elite hybrid coach (running + strength + HYROX/conditioning).
Return ONLY valid JSON. No markdown. No extra text.

CRITICAL OUTPUT SHAPE (top-level):
{
  "name": string,
  "goal": string,
  "weeks": number,
  "startDate": "YYYY-MM-DD",
  "profile": object,
  "plan": [
    { "week": number, "days": [ { "day": "Mon|Tue|Wed|Thu|Fri|Sat|Sun", "sessions": [ ... ] } ] }
  ]
}

CRITICAL RULES:
- Every week must include ALL 7 days Mon..Sun (rest day => sessions: []).
- Put main sessions on daysAvailable if provided in meta.profile.daysAvailable.
- Every session must include warmup and cooldown blocks in session.blocks.
- Strength sessions:
  - MUST have a Primary Lift + Accessory work (as blocks).
  - Every item with kind="exercise" MUST include: sets, reps, load, restSec, and (rpe OR rir).
  - Prioritise compounds (squat/bench/deadlift/press/row) + sensible accessories.
- Run sessions:
  - MUST include session.runSteps (Garmin style).
  - runSteps must:
    - start with type="warmup"
    - end with type="cooldown"
    - duration.type="time" => seconds, duration.type="distance" => metres
    - intervals must alternate work/rest (no work-work back-to-back)
  - Prefer target.type="pace" when paces are available; otherwise use target.type="effort".

PROGRESSION:
- Be coherent and progressive.
- Include a deload week if weeks >= 6 (reduce volume ~25–40%).
- Respect fatigue: avoid max-effort lower-body strength within 24h of hard run intervals where possible.

${paceText}
`.trim();
}

async function callModelJson({ model, system, userContent }) {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.25,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  });

  return completion.choices?.[0]?.message?.content || "";
}

/* ─────────────────────────────────────────────
   Job helpers
───────────────────────────────────────────── */
function jobRefFor(uid, jobId) {
  return adb.doc(`users/${uid}/planBuildJobs/${jobId}`);
}

async function jobUpdate(jobRef, patch) {
  await jobRef.set(
    {
      ...stripUndefinedDeep(patch),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function isStale(job) {
  const updatedAtMs =
    job?.updatedAt?.toMillis?.() ||
    job?.updatedAtMs ||
    job?.createdAt?.toMillis?.() ||
    0;
  if (!updatedAtMs) return false;
  return nowMs() - updatedAtMs > 90_000; // 90s stale threshold
}

/**
 * Core worker: processes a job doc.
 * Safe to call multiple times (idempotent-ish).
 */
async function processJob({ uid, jobId, prompt, meta }) {
  const jobRef = jobRefFor(uid, jobId);
  const snap = await jobRef.get();
  const job = snap.data() || {};

  // idempotency: if done, do nothing
  if (job.status === "done") return { ok: true, status: "done" };
  if (job.status === "running" && !isStale(job)) return { ok: true, status: "running" };

  await jobUpdate(jobRef, { status: "running", progress: 8, message: "Preparing prompt…" });

  const startedAt = nowMs();
  const HARD_TIMEOUT_MS = 120_000;

  try {
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const system = buildSystemMessage({ meta: safeObj(meta) });

    // Builder already sends prompt + meta; keep both for traceability
    const userContent =
      String(prompt || "") + "\n\nMeta:\n" + JSON.stringify(safeObj(meta || {}), null, 2);

    await jobUpdate(jobRef, { progress: 15, message: "Generating plan…" });

    const text = await callModelJson({ model, system, userContent });

    if (nowMs() - startedAt > HARD_TIMEOUT_MS) {
      await jobUpdate(jobRef, {
        status: "error",
        progress: 100,
        message: "Failed",
        error: "Job timed out",
      });
      return { ok: false, status: "error" };
    }

    await jobUpdate(jobRef, { progress: 70, message: "Parsing & validating…" });

    const json = jsonParseBestEffort(text);
    if (!json) {
      await jobUpdate(jobRef, {
        status: "error",
        progress: 100,
        message: "Failed",
        error: "Model did not return valid JSON",
        raw: String(text).slice(0, 2000),
      });
      return { ok: false, status: "error" };
    }

    const normalised = normaliseAiPlan(json, safeObj(meta) || {});
    const { fixed, warnings } = validateAndFixPlan(normalised, safeObj(meta) || {});

    await jobUpdate(jobRef, { progress: 92, message: "Finalising…" });

    await jobUpdate(jobRef, {
      status: "done",
      progress: 100,
      message: "Complete",
      result: fixed,
      warnings: (warnings || []).slice(0, 75),
    });

    return { ok: true, status: "done" };
  } catch (err) {
    await jobUpdate(jobRef, {
      status: "error",
      progress: 100,
      message: "Failed",
      error: err?.message || "Server error",
    });
    return { ok: false, status: "error" };
  }
}

/* ─────────────────────────────────────────────
   POST /plans/ai/start
   Body: { prompt: string, meta?: object }
───────────────────────────────────────────── */
router.post("/ai/start", express.json({ limit: "2mb" }), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    if (!admin.apps.length || !adb) {
      return res.status(500).json({
        error: "Firebase Admin not initialised. Ensure admin.initializeApp() runs before mounting routes.",
      });
    }

    const authed = await requireUser(req);
    if (!authed?.uid) return res.status(401).json({ error: "Missing/invalid Authorization Bearer token" });

    // rate limit (protect spend)
    rateLimitOrThrow(authed.uid);

    const { prompt, meta } = req.body || {};
    if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Missing prompt" });

    const uid = authed.uid;
    const jobId = uuid();
    const jobRef = jobRefFor(uid, jobId);

    await jobUpdate(jobRef, {
      status: "queued",
      progress: 1,
      message: "Queued…",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      input: stripUndefinedDeep({
        prompt: String(prompt).slice(0, 200_000),
        meta: safeObj(meta),
      }),
    });

    // respond immediately
    res.status(202).json({ ok: true, jobId });

    // best-effort start (works on normal servers)
    setTimeout(() => {
      processJob({ uid, jobId, prompt, meta }).catch(() => {});
    }, 10);
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Server error" });
  }
});

/* ─────────────────────────────────────────────
   POST /plans/ai/kick
   Body: { jobId: string }
───────────────────────────────────────────── */
router.post("/ai/kick", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    if (!admin.apps.length || !adb) return res.status(500).json({ error: "Firebase Admin not initialised." });

    const authed = await requireUser(req);
    if (!authed?.uid) return res.status(401).json({ error: "Missing/invalid Authorization Bearer token" });

    const { jobId } = req.body || {};
    if (!safeStr(jobId)) return res.status(400).json({ error: "Missing jobId" });

    const uid = authed.uid;
    const jobRef = jobRefFor(uid, jobId);
    const snap = await jobRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Job not found" });

    const job = snap.data() || {};
    const input = safeObj(job.input);
    const prompt = safeStr(input.prompt);
    const meta = safeObj(input.meta);

    if (!prompt) return res.status(400).json({ error: "Job has no stored input.prompt" });

    const result = await processJob({ uid, jobId, prompt, meta });
    return res.json({ ok: true, status: result.status });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Server error" });
  }
});

export default router;
