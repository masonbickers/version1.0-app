// server/lib/train/planRules/workouts/tempoWorkouts.js
//
// Tempo / Threshold builder (EXPANDED to cover your full menu):
// ✅ Universal tempo types (continuous, broken, cruise intervals, alternations, progression, fast-finish, over/under)
// ✅ Distance-specific menus for 5K / 10K / Half / Marathon / Ultra
// ✅ Candidate bank + scoring + deterministic pick
// ✅ Uses blueprint.blocks schema that garminSteps.js can render:
//    - CONTINUOUS, REPEAT, PROGRESSION, ALTERNATIONS, OVER_UNDER, LADDER_TIME
//
// IMPORTANT FIXES IN THIS VERSION:
// ✅ Uses WEEK target weeklyKm if provided (prevents “same tempo every week”)
// ✅ Uses phaseOverride (trust week.phase from skeleton)
// ✅ Optional totalKm budgeting: shrinks time-based blocks to fit plannedDistanceKm
// ✅ Title/targets always derived from FINAL blocks (post-fit)
//
// ✅ FIX: budgeting totals for REPEAT/OVER_UNDER recoveries use (reps-1), not reps
// ✅ FIX: deterministic rotation among top “close” candidates (seeded), not always #1
//
// ✅ NEW IN THIS DROP:
// ✅ Spec-pool support: buildTempoWorkoutById({id,...}) parses ids like t_10k_3x10min etc.
// ✅ Unified API: getTempoWorkout({id? ...}) → byId if possible else generator

import { RULES } from "../rulesConfig.js";
import {
  normaliseExperienceKey,
  normaliseGoalDistanceKey,
} from "../normalization.js";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tempoFidelityPolicy() {
  const cfg = RULES?.fidelity?.tempo || {};
  return {
    floorNonTaper: toNum(cfg?.floorRatioNonTaper) ?? 0.75,
    floorDeload: toNum(cfg?.floorRatioDeload) ?? 0.6,
    floorTaper: toNum(cfg?.floorRatioTaper) ?? 0,
    taperMinKeepRatio: toNum(cfg?.taperMinKeepRatio) ?? 0,
  };
}

function normExperience(profile = {}) {
  return normaliseExperienceKey(profile?.experienceKey);
}

function getWeeklyKm(profile = {}) {
  return toNum(profile?.weeklyKm) ?? 0;
}

function getTotalWeeks(profile = {}, fallback = 12) {
  return toNum(profile?.planLengthWeeks) ?? fallback;
}

/**
 * Phase split based on proportions so it works for short and long plans.
 * base <= 0.35, build <= 0.75, specific <= 0.9, else taper
 */
function getPhase(weekIndex, totalWeeks) {
  const w = Number(weekIndex || 1);
  const tw = Math.max(1, Number(totalWeeks || 12));
  const p = w / tw;

  if (p <= 0.35) return "base";
  if (p <= 0.75) return "build";
  if (p <= 0.9) return "specific";
  return "taper";
}

function normaliseGoalDistance(profile = {}) {
  const raw = profile?.goalDistanceKey || "";
  const key = normaliseGoalDistanceKey(raw, {
    fallback: "GENERAL",
    allowGeneral: true,
    allowReturn: true,
  });
  return key === "RETURN" ? "GENERAL" : key;
}

/**
 * Keep labels stable across the system.
 */
function paceTargetsForTempo(profile = {}) {
  return {
    tempo: { label: "tempo", targetType: "pace_range" },
    threshold: { label: "threshold", targetType: "pace_range" },
    easy: { label: "easy", targetType: "none" },
    steady: { label: "steady", targetType: "pace_range" },
    racepace: { label: "racepace", targetType: "pace_range" },
  };
}

// -------------------- block helpers (blueprint schema) --------------------

function withIntensity(intensity) {
  const key = String(intensity || "tempo").toLowerCase();
  if (key === "threshold") return { intensity: "threshold", intensityKey: "threshold" };
  if (key === "steady") return { intensity: "steady", intensityKey: "steady" };
  if (key === "easy") return { intensity: "easy", intensityKey: "easy" };
  if (key === "racepace") return { intensity: "racepace", intensityKey: "racepace" };
  return { intensity: "tempo", intensityKey: "tempo" };
}

const makeContinuous = (workSec, intensity = "tempo") => ({
  type: "CONTINUOUS",
  work: { type: "TIME", valueSec: workSec, ...withIntensity(intensity) },
});

const makeCruise = (repeatCount, workSec, recoverSec, intensity = "tempo") => ({
  type: "REPEAT",
  repeatCount,
  work: { type: "TIME", valueSec: workSec, ...withIntensity(intensity) },
  recover: { type: "TIME", valueSec: recoverSec, ...withIntensity("easy") },
});

const makeLadderTime = (repsSecArr, recoverSec, intensitiesArr, fallbackIntensity = "tempo") => ({
  type: "LADDER_TIME",
  reps: Array.isArray(repsSecArr) ? repsSecArr : [],
  recoverSec: Number(recoverSec || 0) || 0,
  intensities: Array.isArray(intensitiesArr) ? intensitiesArr : [],
  intensity: fallbackIntensity,
});

const makeProgression = (segments) => ({
  type: "PROGRESSION",
  segments: (Array.isArray(segments) ? segments : []).map((s) => {
    const segIntensity = s?.intensity || "tempo";
    return {
      work: { type: "TIME", valueSec: Number(s?.sec || 0), ...withIntensity(segIntensity) },
      recover: s?.recoverSec
        ? { type: "TIME", valueSec: Number(s.recoverSec), ...withIntensity("easy") }
        : null,
    };
  }),
});

const makeAlternations = (repeatCount, onSec, offSec, intensityOn = "tempo", intensityOff = "steady") => ({
  type: "ALTERNATIONS",
  repeatCount,
  on: { type: "TIME", valueSec: onSec, ...withIntensity(intensityOn) },
  off: { type: "TIME", valueSec: offSec, ...withIntensity(intensityOff) },
});

const makeOverUnder = (repeatCount, overSec, underSec, recoverSec, intensityOver = "threshold") => ({
  type: "OVER_UNDER",
  repeatCount,
  over: { type: "TIME", valueSec: overSec, ...withIntensity(intensityOver) },
  under: { type: "TIME", valueSec: underSec, ...withIntensity("tempo") },
  recover: recoverSec
    ? { type: "TIME", valueSec: recoverSec, ...withIntensity("easy") }
    : null,
});

// Deterministic small hash to rotate menus by goal distance
function goalOffset(goalKey) {
  const s = String(goalKey || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 11;
}

/**
 * Target “work minutes” for the session (tempo+threshold work, not warm/cool).
 */
function computeTargetWorkMin({ wkKm, phase, goalKey, expKey, isDeload }) {
  const baseByVolume =
    wkKm >= 80 ? 40 :
    wkKm >= 65 ? 36 :
    wkKm >= 55 ? 32 :
    wkKm >= 45 ? 28 :
    wkKm >= 35 ? 24 :
    wkKm >= 25 ? 20 :
    wkKm >= 18 ? 16 :
    12;

  const advanced = expKey === "advanced";
  const regular = expKey === "regular";
  const newer = expKey === "new";

  const cap = advanced ? 50 : regular ? 42 : newer ? 26 : 34;

  let goalShift = 0;
  if (goalKey === "5K") goalShift = -4;
  else if (goalKey === "10K") goalShift = -2;
  else if (goalKey === "HALF") goalShift = +2;
  else if (goalKey === "MARATHON") goalShift = +5;
  else if (goalKey === "ULTRA") goalShift = +7;

  let phaseShift = 0;
  if (phase === "base") phaseShift = -1;
  if (phase === "build") phaseShift = +1;
  if (phase === "specific") phaseShift = +2;
  if (phase === "taper") phaseShift = -7;

  let workMin = baseByVolume + goalShift + phaseShift;
  workMin = clamp(workMin, 10, cap);

  if (isDeload) workMin = Math.max(10, Math.round(workMin * 0.7));
  return workMin;
}

// -------------------- summarise work + classification --------------------

function sumWorkSecFromBlocks(blocks = []) {
  let sum = 0;

  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;

    if (b.type === "CONTINUOUS") {
      sum += Number(b?.work?.valueSec || 0);
      continue;
    }

    if (b.type === "REPEAT") {
      const reps = Number(b?.repeatCount || 0);
      const sec = Number(b?.work?.valueSec || 0);
      sum += reps * sec;
      continue;
    }

    if (b.type === "PROGRESSION") {
      const segs = Array.isArray(b?.segments) ? b.segments : [];
      for (const s of segs) sum += Number(s?.work?.valueSec || 0);
      continue;
    }

    if (b.type === "ALTERNATIONS") {
      const reps = Number(b?.repeatCount || 0);
      sum += reps * Number(b?.on?.valueSec || 0);
      continue;
    }

    if (b.type === "OVER_UNDER") {
      const reps = Number(b?.repeatCount || 0);
      sum += reps * (Number(b?.over?.valueSec || 0) + Number(b?.under?.valueSec || 0));
      continue;
    }

    if (b.type === "LADDER_TIME") {
      const arr = Array.isArray(b?.reps) ? b.reps : [];
      sum += arr.reduce((a, x) => a + Number(x || 0), 0);
      continue;
    }
  }

  return Math.max(0, Math.round(sum));
}

function sumWorkByIntensity(blocks = []) {
  const out = { tempo: 0, threshold: 0, steady: 0, easy: 0, racepace: 0, other: 0 };

  const add = (intensity, sec) => {
    const key = String(intensity || "").toLowerCase();
    const s = Number(sec || 0);
    if (!Number.isFinite(s) || s <= 0) return;

    if (key === "tempo") out.tempo += s;
    else if (key === "threshold") out.threshold += s;
    else if (key === "steady") out.steady += s;
    else if (key === "easy") out.easy += s;
    else if (key === "racepace") out.racepace += s;
    else out.other += s;
  };

  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;

    if (b.type === "CONTINUOUS") {
      add(b?.work?.intensity, b?.work?.valueSec);
      continue;
    }

    if (b.type === "REPEAT") {
      const reps = Number(b?.repeatCount || 0);
      add(b?.work?.intensity, reps * Number(b?.work?.valueSec || 0));
      continue;
    }

    if (b.type === "PROGRESSION") {
      const segs = Array.isArray(b?.segments) ? b.segments : [];
      for (const s of segs) add(s?.work?.intensity, s?.work?.valueSec);
      continue;
    }

    if (b.type === "ALTERNATIONS") {
      const reps = Number(b?.repeatCount || 0);
      add(b?.on?.intensity, reps * Number(b?.on?.valueSec || 0));
      add(b?.off?.intensity, reps * Number(b?.off?.valueSec || 0));
      continue;
    }

    if (b.type === "OVER_UNDER") {
      const reps = Number(b?.repeatCount || 0);
      add(b?.over?.intensity, reps * Number(b?.over?.valueSec || 0));
      add(b?.under?.intensity, reps * Number(b?.under?.valueSec || 0));
      continue;
    }

    if (b.type === "LADDER_TIME") {
      const repsArr = Array.isArray(b?.reps) ? b.reps : [];
      const intens = Array.isArray(b?.intensities) ? b.intensities : [];
      repsArr.forEach((sec, i) => add(intens[i] ?? b?.intensity ?? "tempo", sec));
      continue;
    }
  }

  return out;
}

/**
 * If threshold work >= 50% of (tempo+threshold) work, call it THRESHOLD.
 */
function classifyTempoKindFromBlocks(blocks = []) {
  const sums = sumWorkByIntensity(blocks);
  const hard = sums.tempo + sums.threshold;
  if (hard <= 0) return "TEMPO";

  const share = sums.threshold / hard;
  return share >= 0.5 ? "THRESHOLD" : "TEMPO";
}

function humaniseKind(kind) {
  const k = String(kind || "").toUpperCase();
  if (k === "THRESHOLD") return "Threshold";
  return "Tempo";
}

// -------------------- fitting + candidate generation --------------------

function roundToWholeMinute(sec) {
  return Math.max(0, Math.round(Number(sec || 0) / 60) * 60);
}

function fmtRec(sec) {
  const s = Math.max(0, Number(sec || 0));
  if (!s) return "";
  if (s < 90) return `${Math.round(s)}s`;
  const m = s / 60;
  const rounded = Math.round(m * 2) / 2;
  return `${rounded} min`;
}

function buildGoalMenus({ goalKey, phase, expKey, wkKm, isDeload }) {
  const advanced = expKey === "advanced";
  const newer = expKey === "new";

  const veryLowVol = wkKm < 18;
  const keepSimple = isDeload || veryLowVol || (newer && wkKm < 28);

  const recShort = phase === "taper" ? 90 : 75;
  const recMed = phase === "taper" ? 120 : 90;
  const recLong = phase === "taper" ? 150 : 120;

  const universal = {
    continuous: [
      { min: 15, intensity: "tempo" },
      { min: 20, intensity: "tempo" },
      { min: 25, intensity: "tempo" },
      ...(advanced ? [{ min: 30, intensity: "tempo" }] : []),
    ],
    broken: [
      { reps: 2, repMin: 10, rec: recLong, intensity: "tempo" },
      { reps: 3, repMin: 8, rec: recMed, intensity: "tempo" },
      { reps: 4, repMin: 6, rec: recMed, intensity: "tempo" },
    ],
    cruise: [
      { reps: 6, repMin: 3, rec: recShort, intensity: "tempo" },
      { reps: 5, repMin: 4, rec: recShort, intensity: "tempo" },
      { reps: 4, repMin: 5, rec: recMed, intensity: "tempo" },
    ],
    alternations: keepSimple
      ? []
      : [
          { reps: 6, onMin: 3, offMin: 1, on: "tempo", off: "steady" },
          { reps: 5, onMin: 3, offMin: 1, on: "tempo", off: "steady" },
          { reps: 8, onMin: 2, offMin: 1, on: "tempo", off: "steady" },
        ],
    progression: keepSimple
      ? []
      : [
          { segMin: [10, 10, 5], intens: ["steady", "tempo", "threshold"] },
          { segMin: [12, 10, 5], intens: ["steady", "tempo", "threshold"] },
        ],
    fastFinish: keepSimple
      ? []
      : [
          { segMin: [10, 10, 5], intens: ["steady", "tempo", "threshold"] },
          { segMin: [15, 10, 5], intens: ["steady", "tempo", "threshold"] },
        ],
    overUnder: keepSimple || isDeload
      ? []
      : [
          { reps: 5, overMin: 1, underMin: 3, recMin: 1 },
          { reps: 4, overMin: 2, underMin: 3, recMin: 1 },
        ],
  };

  const menusByGoal = {
    "5K": {
      continuous: [
        { min: 15, intensity: "tempo" },
        { min: 18, intensity: "tempo" },
        { min: 20, intensity: "tempo" },
      ],
      broken: [
        { reps: 2, repMin: 10, rec: recLong, intensity: "tempo" },
        { reps: 3, repMin: 8, rec: recMed, intensity: "tempo" },
        { reps: 4, repMin: 6, rec: recMed, intensity: "tempo" },
      ],
      alternations: keepSimple ? [] : [
        { reps: 6, onMin: 3, offMin: 1, on: "tempo", off: "steady" },
        { reps: 5, onMin: 3, offMin: 1, on: "tempo", off: "steady" },
      ],
      progression: keepSimple ? [] : [
        { segMin: [10, 10, 5], intens: ["steady", "tempo", "threshold"] },
      ],
    },

    "10K": {
      continuous: [
        { min: 20, intensity: "tempo" },
        { min: 22, intensity: "tempo" },
        { min: 25, intensity: "tempo" },
      ],
      broken: [
        { reps: 2, repMin: 15, rec: recLong, intensity: "tempo" },
        { reps: 3, repMin: 10, rec: recMed, intensity: "tempo" },
        { reps: 4, repMin: 8, rec: recMed, intensity: "tempo" },
      ],
      alternations: keepSimple ? [] : [
        { reps: 4, onMin: 4, offMin: 4, on: "tempo", off: "steady" },
        { reps: 5, onMin: 4, offMin: 4, on: "tempo", off: "steady" },
      ],
      progression: keepSimple ? [] : [
        { segMin: [15, 10, 5], intens: ["tempo", "threshold", "threshold"] },
      ],
      ladder: keepSimple ? [] : [
        { repsMin: [2, 3, 4, 5, 4, 3, 2], rec: 60, intens: ["tempo","tempo","threshold","threshold","threshold","tempo","tempo"] },
      ],
    },

    "HALF": {
      continuous: [
        { min: 25, intensity: "tempo" },
        { min: 30, intensity: "tempo" },
        { min: 35, intensity: "tempo" },
      ],
      broken: [
        { reps: 2, repMin: 20, rec: recLong, intensity: "tempo" },
        { reps: 3, repMin: 15, rec: recMed, intensity: "tempo" },
        { reps: 4, repMin: 10, rec: recMed, intensity: "tempo" },
      ],
      alternations: keepSimple ? [] : [
        { reps: 4, onMin: 8, offMin: 4, on: "tempo", off: "steady" },
      ],
      progression: keepSimple ? [] : [
        { segMin: [20, 10, 5], intens: ["tempo", "racepace", "threshold"] },
      ],
    },

    "MARATHON": {
      continuous: [
        { min: 30, intensity: "tempo" },
        { min: 35, intensity: "tempo" },
        { min: 40, intensity: "tempo" },
        ...(advanced ? [{ min: 45, intensity: "tempo" }] : []),
      ],
      broken: [
        { reps: 2, repMin: 25, rec: recLong, intensity: "tempo" },
        { reps: 3, repMin: 20, rec: recMed, intensity: "tempo" },
        { reps: 4, repMin: 15, rec: recMed, intensity: "tempo" },
      ],
      alternations: keepSimple ? [] : [
        { reps: 3, onMin: 12, offMin: 8, on: "tempo", off: "steady" },
        { reps: 4, onMin: 12, offMin: 8, on: "tempo", off: "steady" },
      ],
      fastFinish: keepSimple ? [] : [
        { segMin: [30, 20, 10], intens: ["steady", "tempo", "racepace"] },
      ],
      overUnder: [],
    },

    "ULTRA": {
      continuous: [
        { min: 40, intensity: "tempo" },
        { min: 50, intensity: "tempo" },
        { min: 60, intensity: "tempo" },
      ],
      broken: [
        { reps: 2, repMin: 30, rec: recLong, intensity: "tempo" },
        ...(advanced ? [{ reps: 2, repMin: 40, rec: recLong, intensity: "tempo" }] : []),
        { reps: 3, repMin: 20, rec: recMed, intensity: "tempo" },
        ...(advanced ? [{ reps: 3, repMin: 30, rec: recMed, intensity: "tempo" }] : []),
      ],
      alternations: keepSimple ? [] : [
        { reps: 4, onMin: 10, offMin: 5, on: "tempo", off: "easy" },
        { reps: 5, onMin: 10, offMin: 5, on: "tempo", off: "easy" },
        { reps: 6, onMin: 10, offMin: 5, on: "tempo", off: "easy" },
      ],
      progression: keepSimple ? [] : [
        { segMin: [20, 20, 15], intens: ["steady", "tempo", "tempo"] },
      ],
      overUnder: (!keepSimple && advanced && wkKm >= 55)
        ? [{ reps: 4, overMin: 2, underMin: 6, recMin: 1 }]
        : [],
    },
  };

  const specific = menusByGoal[goalKey] || {};
  return {
    recShort,
    recMed,
    recLong,
    keepSimple,
    ...universal,
    ...specific,
  };
}

function buildCandidateBank({ goalKey, phase, isDeload, wkKm, expKey }) {
  const menus = buildGoalMenus({ goalKey, phase, expKey, wkKm, isDeload });

  const candidates = [];
  const push = (pattern, blocks, meta = {}) => {
    candidates.push({ pattern, blocks, meta });
  };

  for (const c of Array.isArray(menus.continuous) ? menus.continuous : []) {
    push("continuous", [makeContinuous(c.min * 60, c.intensity || "tempo")]);
  }

  for (const b of Array.isArray(menus.broken) ? menus.broken : []) {
    push("broken", [makeCruise(b.reps, b.repMin * 60, b.rec, b.intensity || "tempo")]);
  }
  for (const c of Array.isArray(menus.cruise) ? menus.cruise : []) {
    push("cruise", [makeCruise(c.reps, c.repMin * 60, c.rec, c.intensity || "tempo")]);
  }

  for (const a of Array.isArray(menus.alternations) ? menus.alternations : []) {
    push("alternations", [makeAlternations(a.reps, a.onMin * 60, a.offMin * 60, a.on || "tempo", a.off || "steady")]);
  }

  for (const p of Array.isArray(menus.progression) ? menus.progression : []) {
    const segs = (Array.isArray(p.segMin) ? p.segMin : []).map((m, i) => ({
      sec: m * 60,
      intensity: (Array.isArray(p.intens) ? p.intens[i] : null) || "tempo",
      recoverSec: i === (p.segMin.length - 1) ? 0 : menus.recMed,
    }));
    push("progression", [makeProgression(segs)]);
  }

  for (const f of Array.isArray(menus.fastFinish) ? menus.fastFinish : []) {
    const segs = (Array.isArray(f.segMin) ? f.segMin : []).map((m, i) => ({
      sec: m * 60,
      intensity: (Array.isArray(f.intens) ? f.intens[i] : null) || "tempo",
      recoverSec: i === (f.segMin.length - 1) ? 0 : menus.recMed,
    }));
    push("fast_finish", [makeProgression(segs)]);
  }

  for (const ou of Array.isArray(menus.overUnder) ? menus.overUnder : []) {
    push("over_under", [makeOverUnder(ou.reps, ou.overMin * 60, ou.underMin * 60, ou.recMin * 60, "threshold")]);
  }

  if (!menus.keepSimple) {
    const ladders = Array.isArray(menus.ladder) ? menus.ladder : [];
    for (const l of ladders) {
      const repsMin = Array.isArray(l.repsMin) ? l.repsMin : [];
      const repsSec = repsMin.map((m) => m * 60);
      const intens = Array.isArray(l.intens) ? l.intens : [];
      push("ladder", [makeLadderTime(repsSec, l.rec || 60, intens, "tempo")]);
    }
  }

  if (isDeload) {
    return candidates.filter((c) => c.pattern === "continuous" || c.pattern === "broken" || c.pattern === "cruise");
  }

  if (phase === "taper") {
    return candidates.filter((c) => c.pattern !== "over_under");
  }

  return candidates;
}

function scoreCandidate({ blocks, desiredWorkSec, goalKey, phase, expKey }) {
  const workSec = sumWorkSecFromBlocks(blocks);
  const desired = roundToWholeMinute(desiredWorkSec);
  const diff = Math.abs(workSec - desired);

  const newer = expKey === "new";
  const advanced = expKey === "advanced";

  let complexity = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b) continue;
    if (b.type === "CONTINUOUS") complexity += 0.5;
    else if (b.type === "REPEAT") complexity += 1.0;
    else if (b.type === "ALTERNATIONS") complexity += 1.4;
    else if (b.type === "PROGRESSION") complexity += 1.6;
    else if (b.type === "LADDER_TIME") complexity += 1.6;
    else if (b.type === "OVER_UNDER") complexity += 2.0;
    else complexity += 1.0;
  }

  let penalty = 0;

  if (newer) penalty += complexity * 220;
  if (phase === "taper") penalty += complexity * 240;
  if (phase === "base" && complexity > 1.4) penalty += 180;

  if (goalKey === "MARATHON" || goalKey === "ULTRA") {
    const hasOU = blocks.some((b) => b?.type === "OVER_UNDER");
    if (hasOU) penalty += 900;
  }

  if (advanced) penalty *= 0.8;

  return diff + penalty;
}

/**
 * ✅ Rotation logic:
 * - Score + sort
 * - Take top K within margin of best
 * - Choose deterministically with seed
 * - On deload/taper, K collapses to 1 (conservative)
 */
function pickBestCandidate({ candidates, desiredWorkSec, goalKey, phase, expKey, seed, isDeload }) {
  const safe = Array.isArray(candidates) ? candidates : [];
  if (!safe.length) return null;

  const scored = safe.map((c, idx) => {
    const s = scoreCandidate({ blocks: c.blocks, desiredWorkSec, goalKey, phase, expKey });
    const tie = ((seed + idx) % 11) * 7;
    return { ...c, _score: s + tie };
  });

  scored.sort((a, b) => a._score - b._score);

  const best = scored[0];
  if (!best) return null;

  const conservative = !!isDeload || phase === "taper";
  const Kmax = conservative ? 1 : 3;
  const margin = conservative ? 0 : 240;

  const pool = [best];
  for (let i = 1; i < scored.length && pool.length < Kmax; i++) {
    if (scored[i]._score <= best._score + margin) pool.push(scored[i]);
  }

  const pickIdx = pool.length ? (seed % pool.length) : 0;
  return pool[pickIdx] || best;
}

// -------------------- keyTargets formatting --------------------

function tempoKeyTargetsFromBlocks(blocks = []) {
  const parts = [];

  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b.type === "CONTINUOUS") {
      const m = Math.round((b.work?.valueSec || 0) / 60);
      parts.push(`${m} min @ ${b.work?.intensity || "tempo"}`);
      continue;
    }

    if (b.type === "REPEAT") {
      const wm = Math.round((b.work?.valueSec || 0) / 60);
      const rec = fmtRec(Number(b.recover?.valueSec || 0));
      parts.push(`${b.repeatCount}×${wm} min @ ${b.work?.intensity || "tempo"}${rec ? ` (rec ${rec})` : ""}`);
      continue;
    }

    if (b.type === "PROGRESSION") {
      const segs = Array.isArray(b.segments) ? b.segments : [];
      const segTxt = segs
        .map((s) => `${Math.round((s?.work?.valueSec || 0) / 60)} min @ ${s?.work?.intensity || "tempo"}`)
        .join(" + ");
      if (segTxt) parts.push(segTxt);
      continue;
    }

    if (b.type === "ALTERNATIONS") {
      const onM = Math.round((b.on?.valueSec || 0) / 60);
      const offM = Math.round((b.off?.valueSec || 0) / 60);
      const offInt = b.off?.intensity || "steady";
      parts.push(`${b.repeatCount}×(${onM} min @ ${b.on?.intensity || "tempo"} / ${offM} min ${offInt})`);
      continue;
    }

    if (b.type === "OVER_UNDER") {
      const overM = Math.round((b.over?.valueSec || 0) / 60);
      const underM = Math.round((b.under?.valueSec || 0) / 60);
      const rec = fmtRec(Number(b.recover?.valueSec || 0));
      parts.push(`${b.repeatCount}×(${overM} min over / ${underM} min under)${rec ? ` (rec ${rec})` : ""}`);
      continue;
    }

    if (b.type === "LADDER_TIME") {
      const reps = Array.isArray(b.reps) ? b.reps : [];
      const mins = reps.map((s) => Math.round(Number(s || 0) / 60)).filter((x) => x > 0);
      const rec = fmtRec(Number(b.recoverSec || 0));
      parts.push(`Ladder ${mins.join("-")} min${rec ? ` (rec ${rec})` : ""}`);
      continue;
    }
  }

  return parts.join(" + ") || "Tempo";
}

// -------------------- budgeting helpers (distance fit) --------------------

function estimateEasySecPerKm(profile = {}) {
  const min = toNum(profile?.paces?.easy?.minSecPerKm);
  const max = toNum(profile?.paces?.easy?.maxSecPerKm);
  if (min != null && max != null && min > 0 && max > 0) return (min + max) / 2;
  return 270 + 85;
}

function metersFromTimeAtEasyPace(sec, profile) {
  const pace = Math.max(1, Number(estimateEasySecPerKm(profile) || 300));
  const s = Math.max(0, Number(sec || 0));
  return Math.round((s / pace) * 1000);
}

function adjustWarmCoolForDistanceBudget({ warmupSec, cooldownSec, totalM, profile, minMainSec = 0 }) {
  const totalMeters = Number(totalM);
  if (!Number.isFinite(totalMeters) || totalMeters <= 0) return { warmupSec, cooldownSec };

  const easySecPerKm = estimateEasySecPerKm(profile);
  const totalSecBudget = Math.round((totalMeters / 1000) * easySecPerKm);
  const minWarm = 8 * 60;
  const minCool = 6 * 60;
  const minMain = Math.max(6 * 60, Math.round(Number(minMainSec) || 0));
  const reserve = 60; // leave small slack for rounding and transition steps

  const currentWarm = Math.max(0, Number(warmupSec || 0));
  const currentCool = Math.max(0, Number(cooldownSec || 0));
  const currentAncillary = currentWarm + currentCool;
  const maxAncillary = Math.max(minWarm + minCool, totalSecBudget - minMain - reserve);

  if (currentAncillary <= maxAncillary) return { warmupSec: currentWarm, cooldownSec: currentCool };

  const scale = maxAncillary / Math.max(1, currentAncillary);
  let nextWarm = roundToWholeMinute(Math.max(minWarm, currentWarm * scale));
  let nextCool = roundToWholeMinute(Math.max(minCool, currentCool * scale));

  while (nextWarm + nextCool > maxAncillary + 10) {
    if (nextWarm >= nextCool && nextWarm > minWarm) nextWarm = Math.max(minWarm, nextWarm - 60);
    else if (nextCool > minCool) nextCool = Math.max(minCool, nextCool - 60);
    else break;
  }

  return { warmupSec: nextWarm, cooldownSec: nextCool };
}

// total session seconds approximation
function sumTotalSecFromBlocks(blocks = []) {
  let sum = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;

    if (b.type === "CONTINUOUS") {
      sum += Number(b?.work?.valueSec || 0);
      continue;
    }

    if (b.type === "REPEAT") {
      const reps = Math.max(0, Number(b?.repeatCount || 0));
      const gaps = Math.max(0, reps - 1); // ✅ no recovery after last rep
      sum += reps * Number(b?.work?.valueSec || 0);
      sum += gaps * Number(b?.recover?.valueSec || 0);
      continue;
    }

    if (b.type === "PROGRESSION") {
      const segs = Array.isArray(b?.segments) ? b.segments : [];
      for (const s of segs) {
        sum += Number(s?.work?.valueSec || 0);
        sum += Number(s?.recover?.valueSec || 0);
      }
      continue;
    }

    if (b.type === "ALTERNATIONS") {
      const reps = Number(b?.repeatCount || 0);
      sum += reps * (Number(b?.on?.valueSec || 0) + Number(b?.off?.valueSec || 0));
      continue;
    }

    if (b.type === "OVER_UNDER") {
      const reps = Math.max(0, Number(b?.repeatCount || 0));
      const gaps = Math.max(0, reps - 1); // ✅ no recovery after last rep
      sum += reps * (Number(b?.over?.valueSec || 0) + Number(b?.under?.valueSec || 0));
      sum += gaps * Number(b?.recover?.valueSec || 0);
      continue;
    }

    if (b.type === "LADDER_TIME") {
      const arr = Array.isArray(b?.reps) ? b.reps : [];
      sum += arr.reduce((a, x) => a + Number(x || 0), 0);
      const rec = Number(b?.recoverSec || 0);
      sum += Math.max(0, arr.length - 1) * rec;
      continue;
    }
  }
  return Math.max(0, Math.round(sum));
}

function fitTempoBlocksToBudget(blocks = [], budgetM, profile) {
  const bM = Number(budgetM);
  if (!Array.isArray(blocks) || !blocks.length) return blocks;
  if (!Number.isFinite(bM) || bM <= 0) return blocks;

  const easySecPerKm = estimateEasySecPerKm(profile);
  const budgetSec = Math.round((bM / 1000) * easySecPerKm);

  const out = blocks.map((b) => (b && typeof b === "object" ? JSON.parse(JSON.stringify(b)) : b));

  const total = () => sumTotalSecFromBlocks(out);
  if (total() <= budgetSec) return out;

  const b0 = out[0];
  if (!b0 || typeof b0 !== "object") return out;

  const decByMinute = (sec) => Math.max(60, roundToWholeMinute(sec) - 60);

  if (b0.type === "REPEAT") {
    const minReps = 2;
    while (b0.repeatCount > minReps && total() > budgetSec) b0.repeatCount -= 1;
    while (total() > budgetSec && (b0.work?.valueSec || 0) > 6 * 60) b0.work.valueSec = decByMinute(b0.work.valueSec);
    return out;
  }

  if (b0.type === "CONTINUOUS") {
    while (total() > budgetSec && (b0.work?.valueSec || 0) > 12 * 60) b0.work.valueSec = decByMinute(b0.work.valueSec);
    return out;
  }

  if (b0.type === "ALTERNATIONS") {
    const minReps = 3;
    while (b0.repeatCount > minReps && total() > budgetSec) b0.repeatCount -= 1;
    while (total() > budgetSec && (b0.on?.valueSec || 0) > 2 * 60) b0.on.valueSec = decByMinute(b0.on.valueSec);
    while (total() > budgetSec && (b0.off?.valueSec || 0) > 60) b0.off.valueSec = decByMinute(b0.off.valueSec);
    return out;
  }

  if (b0.type === "OVER_UNDER") {
    const minReps = 3;
    while (b0.repeatCount > minReps && total() > budgetSec) b0.repeatCount -= 1;
    while (total() > budgetSec && (b0.under?.valueSec || 0) > 3 * 60) b0.under.valueSec = decByMinute(b0.under.valueSec);
    while (total() > budgetSec && (b0.over?.valueSec || 0) > 60) b0.over.valueSec = decByMinute(b0.over.valueSec);
    return out;
  }

  if (b0.type === "PROGRESSION") {
    const segs = Array.isArray(b0.segments) ? b0.segments : [];
    for (let i = segs.length - 1; i >= 0 && total() > budgetSec; i--) {
      const w = segs[i]?.work;
      if (w?.valueSec > 5 * 60) w.valueSec = decByMinute(w.valueSec);
    }
    while (segs.length > 2 && total() > budgetSec) segs.pop();
    b0.segments = segs;
    return out;
  }

  if (b0.type === "LADDER_TIME") {
    let reps = Array.isArray(b0.reps) ? b0.reps : [];
    const minLen = 3;
    while (reps.length > minLen && total() > budgetSec) {
      reps = reps.slice(1, -1);
      b0.reps = reps;
    }
    return out;
  }

  return out;
}

function tempoSpecFidelityFloorRatio(phase, isDeload) {
  const policy = tempoFidelityPolicy();
  const p = String(phase || "").toLowerCase();
  if (p === "taper") return policy.floorTaper;
  if (isDeload || p === "deload") return policy.floorDeload;
  return policy.floorNonTaper;
}

// -------------------- public API --------------------

export function buildTempoWorkout({
  weekIndex,
  profile,
  isDeload = false,
  totalWeeks,
  weekWeeklyKm,
  phaseOverride,
  goalKeyOverride,
  totalKm,
} = {}) {
  const wkKm =
    Number.isFinite(Number(weekWeeklyKm)) && Number(weekWeeklyKm) > 0
      ? Number(weekWeeklyKm)
      : getWeeklyKm(profile);

  const tw = totalWeeks || getTotalWeeks(profile, 12);

  const phaseRaw = phaseOverride ? String(phaseOverride).toLowerCase() : getPhase(weekIndex, tw);
  const phase = ["base","build","specific","taper","deload"].includes(phaseRaw) ? phaseRaw : getPhase(weekIndex, tw);

  const expKey = normExperience(profile);
  const goalKey = goalKeyOverride || normaliseGoalDistance(profile);

  const workMin = computeTargetWorkMin({ wkKm, phase, goalKey, expKey, isDeload });
  const desiredWorkSec = roundToWholeMinute(workMin * 60);
  const targets = paceTargetsForTempo(profile);

  const bank = buildCandidateBank({ goalKey, phase, isDeload, wkKm, expKey });

  const seed = (Math.max(0, Number(weekIndex || 1) - 1) + goalOffset(goalKey)) >>> 0;

  const best = pickBestCandidate({
    candidates: bank,
    desiredWorkSec,
    goalKey,
    phase,
    expKey,
    seed,
    isDeload,
  });

  const picked =
    best || {
      pattern: "continuous",
      blocks: [makeContinuous(clamp(desiredWorkSec, 12 * 60, 40 * 60), "tempo")],
    };

  let fittedBlocks = (Array.isArray(picked.blocks) ? picked.blocks : []).map((b) => {
    if (!b || typeof b !== "object") return b;

    if (b.type === "CONTINUOUS") {
      return { ...b, work: { ...b.work, valueSec: roundToWholeMinute(b?.work?.valueSec || 0) } };
    }

    if (b.type === "REPEAT") {
      return {
        ...b,
        work: { ...b.work, valueSec: roundToWholeMinute(b?.work?.valueSec || 0) },
        recover: { ...b.recover, valueSec: roundToWholeMinute(b?.recover?.valueSec || 0) },
      };
    }

    if (b.type === "PROGRESSION") {
      const segs = Array.isArray(b.segments) ? b.segments : [];
      return {
        ...b,
        segments: segs.map((s) => ({
          ...s,
          work: { ...s.work, valueSec: roundToWholeMinute(s?.work?.valueSec || 0) },
          recover: s?.recover
            ? { ...s.recover, valueSec: roundToWholeMinute(s?.recover?.valueSec || 0) }
            : null,
        })),
      };
    }

    if (b.type === "ALTERNATIONS") {
      return {
        ...b,
        on: { ...b.on, valueSec: roundToWholeMinute(b?.on?.valueSec || 0) },
        off: { ...b.off, valueSec: roundToWholeMinute(b?.off?.valueSec || 0) },
      };
    }

    if (b.type === "OVER_UNDER") {
      return {
        ...b,
        over: { ...b.over, valueSec: roundToWholeMinute(b?.over?.valueSec || 0) },
        under: { ...b.under, valueSec: roundToWholeMinute(b?.under?.valueSec || 0) },
        recover: b?.recover ? { ...b.recover, valueSec: roundToWholeMinute(b?.recover?.valueSec || 0) } : null,
      };
    }

    if (b.type === "LADDER_TIME") {
      const reps = Array.isArray(b.reps) ? b.reps : [];
      return {
        ...b,
        reps: reps.map((sec) => roundToWholeMinute(sec)),
        recoverSec: roundToWholeMinute(b.recoverSec || 0),
      };
    }

    return b;
  });

  // Warmup/cooldown scale with volume/phase/deload
  const isLongGoal = goalKey === "MARATHON" || goalKey === "ULTRA";
  const baseWarm = isLongGoal ? 16 : 14;
  const baseCool = isLongGoal ? 12 : 10;

  const volBump = wkKm >= 70 ? 3 : wkKm >= 55 ? 2 : wkKm >= 40 ? 1 : 0;
  const phaseBump = phase === "specific" ? 1 : 0;
  const deloadCut = isDeload ? -2 : 0;

  const warmupMin = clamp(baseWarm + volBump + phaseBump + deloadCut, 10, 24);
  const cooldownMin = clamp(baseCool + volBump + deloadCut, 8, 20);

  let warmupSec = warmupMin * 60;
  let cooldownSec = cooldownMin * 60;

  // ✅ distance budgeting (optional)
  const totalM =
    Number.isFinite(Number(totalKm)) && Number(totalKm) > 0
      ? Math.round(Number(totalKm) * 1000)
      : null;

  if (totalM != null) {
    const tuned = adjustWarmCoolForDistanceBudget({
      warmupSec,
      cooldownSec,
      totalM,
      profile,
      minMainSec: Math.round(desiredWorkSec * 0.65),
    });
    warmupSec = tuned.warmupSec;
    cooldownSec = tuned.cooldownSec;

    const warmM = metersFromTimeAtEasyPace(warmupSec, profile);
    const coolM = metersFromTimeAtEasyPace(cooldownSec, profile);
    const bufferM = Math.round(Math.max(150, totalM * 0.03));
    const mainBudgetM = Math.max(300, totalM - warmM - coolM - bufferM);
    fittedBlocks = fitTempoBlocksToBudget(fittedBlocks, mainBudgetM, profile);
  }

  const finalWorkSec = roundToWholeMinute(sumWorkSecFromBlocks(fittedBlocks));
  const workoutKind = classifyTempoKindFromBlocks(fittedBlocks);

  const blueprint = {
    kind: workoutKind,
    pattern: picked.pattern,
    tempo: { type: "TIME", valueSec: finalWorkSec },
    blocks: fittedBlocks,
    targets,
    warmupSec,
    cooldownSec,
    meta: {
      phase,
      goalKey,
      wkKm,
      workMin: Math.round(finalWorkSec / 60),
      desiredWorkMin: Math.round(desiredWorkSec / 60),
      isDeload: !!isDeload,
      pickedPattern: picked.pattern,
      seed,
      candidates: bank.length,
      budgeted: totalM != null,
    },
  };

  const keyTargets = tempoKeyTargets(blueprint);
  const title = `${humaniseKind(workoutKind)}: ${keyTargets}`;
  const notes = `Warm up ${Math.round(warmupSec / 60)} min easy, then ${keyTargets}. Cool down ${Math.round(
    cooldownSec / 60
  )} min easy.`;

  return { ...blueprint, title, keyTargets, notes };
}

export function tempoKeyTargets(blueprint) {
  if (!blueprint) return "Tempo";
  const blocks = Array.isArray(blueprint.blocks) ? blueprint.blocks : [];
  if (!blocks.length) {
    const mins = Math.round((blueprint.tempo?.valueSec || 0) / 60);
    const k = String(blueprint?.kind || "TEMPO").toUpperCase();
    return `${humaniseKind(k)} ${mins} min`;
  }
  return tempoKeyTargetsFromBlocks(blocks);
}

// -------------------- Spec pool ID support --------------------

function parseTempoId(id) {
  const s = String(id || "").toLowerCase().trim();

  // t_10k_6x3min, t_10k_3x10min, etc.
  const mRepeat = s.match(/(\d+)\s*x\s*(\d+)\s*min/);
  if (mRepeat) {
    const reps = Number(mRepeat[1]);
    const repMin = Number(mRepeat[2]);
    const intensity = s.includes("threshold") || s.includes("race") ? "threshold" : "tempo";
    return { kind: "REPEAT_MIN", reps, repMin, intensity };
  }

  // t_10k_20min_tempo, t_10k_12min_tempo, t_10k_12min_threshold
  const mCont = s.match(/(\d+)\s*min/);
  if (mCont && (s.includes("tempo") || s.includes("threshold"))) {
    const min = Number(mCont[1]);
    const intensity = s.includes("threshold") ? "threshold" : "tempo";
    return { kind: "CONTINUOUS_MIN", min, intensity };
  }

  // t_10k_25min_progression
  const mProg = s.match(/(\d+)\s*min_progression/);
  if (mProg) {
    const totalMin = Number(mProg[1]);
    const a = Math.max(5, Math.round(totalMin * 0.4));
    const b = Math.max(5, Math.round(totalMin * 0.4));
    const c = Math.max(5, totalMin - a - b);
    return {
      kind: "PROGRESSION_3",
      segMin: [a, b, c],
      intens: ["steady", "tempo", "threshold"],
    };
  }

  return null;
}

function inferTempoVariantFromBlocks(blocks = [], goalKey = "GENERAL") {
  const g = String(goalKey || "GENERAL").toUpperCase();
  const b0 = Array.isArray(blocks) && blocks.length ? blocks[0] : null;
  if (!b0 || typeof b0 !== "object") return `${g}_TEMPO`;

  const t = String(b0.type || "").toUpperCase();
  if (t === "CONTINUOUS") {
    const min = Math.max(1, Math.round((Number(b0?.work?.valueSec || 0) || 0) / 60));
    return `${g}_CONTINUOUS_${min}MIN`;
  }
  if (t === "REPEAT") {
    const reps = Math.max(1, Number(b0.repeatCount || 0) || 1);
    const min = Math.max(1, Math.round((Number(b0?.work?.valueSec || 0) || 0) / 60));
    return `${g}_REPEAT_${reps}X${min}MIN`;
  }
  if (t === "PROGRESSION") {
    const segs = Array.isArray(b0.segments) ? b0.segments : [];
    const totalMin = Math.max(
      1,
      Math.round(segs.reduce((sum, s) => sum + (Number(s?.work?.valueSec || 0) || 0), 0) / 60)
    );
    return `${g}_PROGRESSION_${totalMin}MIN`;
  }
  if (t === "ALTERNATIONS") {
    const reps = Math.max(1, Number(b0.repeatCount || 0) || 1);
    const onMin = Math.max(1, Math.round((Number(b0?.on?.valueSec || 0) || 0) / 60));
    return `${g}_ALTERNATIONS_${reps}X${onMin}MIN`;
  }
  if (t === "OVER_UNDER") {
    const reps = Math.max(1, Number(b0.repeatCount || 0) || 1);
    const overMin = Math.max(1, Math.round((Number(b0?.over?.valueSec || 0) || 0) / 60));
    const underMin = Math.max(1, Math.round((Number(b0?.under?.valueSec || 0) || 0) / 60));
    return `${g}_OVER_UNDER_${reps}X${overMin}_${underMin}MIN`;
  }
  if (t === "LADDER_TIME") {
    const reps = Array.isArray(b0.reps) ? b0.reps.map((sec) => Math.max(1, Math.round((Number(sec) || 0) / 60))) : [];
    return reps.length ? `${g}_LADDER_${reps.join("-")}MIN` : `${g}_LADDER`;
  }

  return `${g}_${t || "TEMPO"}`;
}

function blocksFromParsed(parsed, { phase }) {
  const recShort = phase === "taper" ? 90 : 75;
  const recMed = phase === "taper" ? 120 : 90;

  if (!parsed) return null;

  if (parsed.kind === "CONTINUOUS_MIN") {
    return [makeContinuous(parsed.min * 60, parsed.intensity || "tempo")];
  }

  if (parsed.kind === "REPEAT_MIN") {
    const reps = clamp(Number(parsed.reps || 3), 2, 12);
    const repMin = clamp(Number(parsed.repMin || 8), 2, 40);
    const intensity = parsed.intensity || "tempo";
    const recoverSec = repMin >= 10 ? recMed : recShort;
    return [makeCruise(reps, repMin * 60, recoverSec, intensity)];
  }

  if (parsed.kind === "PROGRESSION_3") {
    const segs = (parsed.segMin || []).map((m, i) => ({
      sec: m * 60,
      intensity: (parsed.intens || [])[i] || "tempo",
      recoverSec: i === (parsed.segMin.length - 1) ? 0 : recMed,
    }));
    return [makeProgression(segs)];
  }

  return null;
}

export function buildTempoWorkoutById({
  id,
  weekIndex,
  profile,
  isDeload = false,
  totalWeeks,
  weekWeeklyKm,
  phaseOverride,
  goalKeyOverride,
  totalKm,
} = {}) {
  const tw = totalWeeks || getTotalWeeks(profile, 12);

  const phaseRaw = phaseOverride ? String(phaseOverride).toLowerCase() : getPhase(weekIndex, tw);
  const phase = ["base","build","specific","taper","deload"].includes(phaseRaw) ? phaseRaw : getPhase(weekIndex, tw);

  const parsed = parseTempoId(id);
  const blocks = blocksFromParsed(parsed, { phase });
  if (!blocks) return null;
  const requestedBlocks = JSON.parse(JSON.stringify(blocks));
  const requestedWorkSec = roundToWholeMinute(sumWorkSecFromBlocks(requestedBlocks));

  const wkKm =
    Number.isFinite(Number(weekWeeklyKm)) && Number(weekWeeklyKm) > 0
      ? Number(weekWeeklyKm)
      : getWeeklyKm(profile);

  const goalKey = goalKeyOverride || normaliseGoalDistance(profile);
  const seed = (Math.max(0, Number(weekIndex || 1) - 1) + goalOffset(goalKey)) >>> 0;

  // build base to reuse warm/cool + meta style
  const base = buildTempoWorkout({
    weekIndex,
    profile,
    isDeload,
    totalWeeks: tw,
    weekWeeklyKm: wkKm,
    phaseOverride: phase,
    goalKeyOverride: goalKey,
    totalKm,
  });

  // Optional budgeting
  const totalM =
    Number.isFinite(Number(totalKm)) && Number(totalKm) > 0
      ? Math.round(Number(totalKm) * 1000)
      : null;

  let fittedBlocks = blocks;
  let warmupSec = Number(base.warmupSec || 0);
  let cooldownSec = Number(base.cooldownSec || 0);
  if (totalM != null) {
    const parsedWorkSec = roundToWholeMinute(sumWorkSecFromBlocks(fittedBlocks));
    const tuned = adjustWarmCoolForDistanceBudget({
      warmupSec,
      cooldownSec,
      totalM,
      profile,
      minMainSec: Math.round(parsedWorkSec * 0.65),
    });
    warmupSec = tuned.warmupSec;
    cooldownSec = tuned.cooldownSec;

    const warmM = metersFromTimeAtEasyPace(warmupSec, profile);
    const coolM = metersFromTimeAtEasyPace(cooldownSec, profile);
    const bufferM = Math.round(Math.max(150, totalM * 0.03));
    const mainBudgetM = Math.max(300, totalM - warmM - coolM - bufferM);
    fittedBlocks = fitTempoBlocksToBudget(fittedBlocks, mainBudgetM, profile);
  }

  // Enforce hard fidelity floor for requested specs (except taper).
  const fittedWorkSec = roundToWholeMinute(sumWorkSecFromBlocks(fittedBlocks));
  const floorRatio = tempoSpecFidelityFloorRatio(phase, isDeload);
  const preFloorKeepRatio = requestedWorkSec > 0 ? fittedWorkSec / requestedWorkSec : 1;
  const fidelityPolicy = floorRatio > 0 ? "hard_floor" : "taper_relaxed";
  const fidelityFloorBypassedReason = floorRatio > 0 ? null : "taper_phase_policy";
  let fidelityFloorApplied = false; // true only when we actually clamp to requested blocks
  if (floorRatio > 0 && preFloorKeepRatio < floorRatio) {
    fittedBlocks = requestedBlocks;
    fidelityFloorApplied = true;
  }

  const tempoPolicyCfg = tempoFidelityPolicy();
  const taperMinKeepRatio = phase === "taper" ? Math.max(0, tempoPolicyCfg.taperMinKeepRatio) : null;
  const workAfterFloorSec = roundToWholeMinute(sumWorkSecFromBlocks(fittedBlocks));
  let fidelityTaperMinKeepApplied = false;
  if (
    taperMinKeepRatio != null &&
    taperMinKeepRatio > 0 &&
    requestedWorkSec > 0 &&
    (workAfterFloorSec / requestedWorkSec) < taperMinKeepRatio
  ) {
    fittedBlocks = requestedBlocks;
    fidelityTaperMinKeepApplied = true;
  }

  const finalWorkSec = roundToWholeMinute(sumWorkSecFromBlocks(fittedBlocks));
  const workoutKind = classifyTempoKindFromBlocks(fittedBlocks);
  const deliveredVariant = inferTempoVariantFromBlocks(fittedBlocks, goalKey);

  const blueprint = {
    ...base,
    id,
    kind: workoutKind,
    variant: deliveredVariant,
    blocks: fittedBlocks,
    warmupSec,
    cooldownSec,
    tempo: { type: "TIME", valueSec: finalWorkSec },
    meta: {
      ...(base.meta || {}),
      source: "spec_id",
      seed,
      requestedSpecId: id,
      templatePickId: id,
      pickedId: deliveredVariant,
      specPickId: deliveredVariant,
      fidelityPolicy,
      fidelityFloorRatio: floorRatio > 0 ? floorRatio : null,
      fidelityFloorBypassedReason,
      fidelityKeepRatioPreFloor: requestedWorkSec > 0 ? Number(preFloorKeepRatio.toFixed(3)) : 1,
      selectedKeepAfterFloorPolicy: requestedWorkSec > 0 ? Number((finalWorkSec / requestedWorkSec).toFixed(3)) : 1,
      fidelityKeepRatio: requestedWorkSec > 0 ? Number((finalWorkSec / requestedWorkSec).toFixed(3)) : 1,
      finalKeepAfterPhaseCaps: requestedWorkSec > 0 ? Number((finalWorkSec / requestedWorkSec).toFixed(3)) : 1,
      fidelityFloorApplied,
      fidelityTaperMinKeepRatio: taperMinKeepRatio,
      fidelityTaperMinKeepApplied,
      fidelityConfigRef: "RULES.fidelity.tempo",
    },
  };

  const keyTargets = tempoKeyTargets(blueprint);
  const title = `${humaniseKind(workoutKind)}: ${keyTargets}`;
  const notes = `Warm up ${Math.round((blueprint.warmupSec || 0) / 60)} min easy, then ${keyTargets}. Cool down ${Math.round(
    (blueprint.cooldownSec || 0) / 60
  )} min easy.`;

  return { ...blueprint, title, keyTargets, notes };
}

export function getTempoWorkout(args = {}) {
  const byId = args?.id ? buildTempoWorkoutById(args) : null;
  return byId || buildTempoWorkout(args);
}
