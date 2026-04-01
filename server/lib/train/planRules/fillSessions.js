// server/lib/train/planRules/fillSessions.js
// ✅ UPDATED to match:
// - garminSteps OPTION A distance contract (plannedDistanceKm is the budget truth)
// - intervalWorkouts.js blueprint-first (blocks + variant; totalKm is session budget)
// - easyWorkouts.js add-ons (notes/keyTargets + optional STRIDES session with 0km budget)
// - longRunWorkouts.js details selection (variant/keyTargets/notes), but LONG distance budget stays longTarget
// - tempoWorkouts.js via getTempoWorkout() for TEMPO/THRESHOLD
// - ✅ NEW: Plan spec interval pools now drive interval selection via getIntervalsWorkout(id)
//
// Key design choices (to match garminSteps.js):
// - EASY and LONG sessions keep plannedDistanceKm as the full run distance (no warm/cool inflation).
// - EASY and LONG workout objects are “light” blueprints (no required steps); Garmin steps are rendered later.
// - If easy add-on includes strides, we create a separate STRIDES session on the same day with 0km budget.
//   (So weekly km budgets do not change, but Garmin can still render a strides workout if needed.)

import { RULES } from "./rulesConfig.js";
import {
  chooseLongRunDay,
  normaliseDifficultyKey,
  normaliseExperienceKey,
  normaliseGoalPolicyKey,
  normaliseSessionsPerWeek,
} from "./normalization.js";
import { buildEasyAddOn } from "./workouts/easyWorkouts.js";
import { getIntervalsWorkout } from "./workouts/intervalWorkouts.js"; // ✅ spec-driven intervals via id
import { buildLongRunDetails } from "./workouts/longRunWorkouts.js";
import { getTempoWorkout } from "./workouts/tempoWorkouts.js";

const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------- helpers ----------------
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}
function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function unwrapWeeks(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && Array.isArray(maybe.weeks)) return maybe.weeks;
  return [];
}
function getPlannedKm(s) {
  return toNum(s?.plannedDistanceKm) ?? toNum(s?.distanceKm) ?? toNum(s?.distance) ?? 0;
}
function ensureMeta(s) {
  if (!s || typeof s !== "object") return s;
  if (!s.meta || typeof s.meta !== "object") s.meta = {};
  return s;
}

// ----------------- floors/caps ----------------
function getMinEasyKmPerRun(weeklyKm) {
  const rule = toNum(RULES?.easy?.minKmPerRun);
  if (rule != null) return Math.max(0, rule);
  const easyCfg = RULES?.fillSessionsPolicy?.easy || {};
  const at18 = toNum(easyCfg?.minKmPerRunWhenWeeklyAtLeast18) ?? 4.5;
  const below18 = toNum(easyCfg?.minKmPerRunWhenWeeklyBelow18) ?? 3.5;
  return weeklyKm >= 18 ? at18 : below18;
}
function getMinQualityKm() {
  return toNum(RULES?.intensityTargets?.minQualitySessionKm) ?? 5.0;
}
function getMaxQualityKm() {
  return toNum(RULES?.intensityTargets?.maxQualitySessionKm) ?? 11.0;
}
function getQualityShareTargetPctByPhase(phase) {
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const map = RULES?.intensityTargets?.qualitySharePctByPhase || {};
  const target = toNum(map?.[p]?.target);
  if (target != null) return clamp(target, 15, 45);
  return 30;
}
function getQualityShareMaxPctByPhase(phase) {
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const map = RULES?.intensityTargets?.qualitySharePctByPhase || {};
  const max = toNum(map?.[p]?.max);
  if (max != null) return clamp(max, 15, 45);
  return 35;
}
function normaliseDiffKey(v) {
  return normaliseDifficultyKey(v);
}
function goalQualityShiftPct(goalKey) {
  const map = RULES?.fillSessionsPolicy?.qualityShareShiftPct?.byGoal || {};
  const fromCfg = toNum(map?.[goalKey]);
  if (fromCfg != null) return fromCfg;
  if (goalKey === "5k") return 2.0;
  if (goalKey === "10k") return 1.0;
  if (goalKey === "half") return -0.5;
  if (goalKey === "marathon") return -1.0;
  if (goalKey === "ultra") return -2.0;
  return 0;
}
function experienceQualityShiftPct(expKey) {
  const map = RULES?.fillSessionsPolicy?.qualityShareShiftPct?.byExperience || {};
  const fromCfg = toNum(map?.[expKey]);
  if (fromCfg != null) return fromCfg;
  if (expKey === "new") return -3.0;
  if (expKey === "some") return -1.5;
  if (expKey === "regular") return 0;
  if (expKey === "advanced") return 1.0;
  return 0;
}
function difficultyQualityShiftPct(diffKey) {
  const map = RULES?.fillSessionsPolicy?.qualityShareShiftPct?.byDifficulty || {};
  const fromCfg = toNum(map?.[diffKey]);
  if (fromCfg != null) return fromCfg;
  if (diffKey === "easy") return -2.0;
  if (diffKey === "hard") return 1.5;
  return 0;
}
function weekWaveShiftPct(weekIndex, phase) {
  const i = Number(weekIndex || 1);
  const p = String(phase || "").toUpperCase().trim();
  if (p === "DELOAD" || p === "TAPER") return 0;
  const waveCfg = RULES?.fillSessionsPolicy?.qualityShareShiftPct?.weekWavePatternPct;
  const wave =
    Array.isArray(waveCfg) && waveCfg.length
      ? waveCfg.map((x) => toNum(x) ?? 0)
      : [0.0, 0.6, -0.4, 0.3];
  return wave[(Math.max(1, i) - 1) % wave.length];
}
function getQualityKmBounds({ goalKey, expKey, difficultyKey, weeklyKm, sessionsPerWeek }) {
  const cfg = RULES?.fillSessionsPolicy?.qualitySessionKmBounds || {};
  let minQ = getMinQualityKm();
  let maxQ = getMaxQualityKm();

  const goalAdj = cfg?.adjustByGoal?.[goalKey] || {};
  minQ += toNum(goalAdj?.min) ?? (goalKey === "5k"
    ? 0.3
    : goalKey === "10k"
    ? 0.2
    : goalKey === "half"
    ? 0.1
    : goalKey === "marathon"
    ? -0.2
    : goalKey === "ultra"
    ? -0.4
    : 0);
  maxQ += toNum(goalAdj?.max) ?? (goalKey === "5k"
    ? 0.8
    : goalKey === "10k"
    ? 0.5
    : goalKey === "half"
    ? 1.2
    : goalKey === "marathon"
    ? 2.0
    : goalKey === "ultra"
    ? 2.5
    : 0);

  const expAdj = cfg?.adjustByExperience?.[expKey] || {};
  minQ += toNum(expAdj?.min) ?? (expKey === "new" ? -0.5 : expKey === "some" ? -0.2 : expKey === "advanced" ? 0.3 : 0);
  maxQ += toNum(expAdj?.max) ?? (expKey === "new" ? -1.2 : expKey === "some" ? -0.6 : expKey === "advanced" ? 0.8 : 0);

  const diffAdj = cfg?.adjustByDifficulty?.[difficultyKey] || {};
  minQ += toNum(diffAdj?.min) ?? 0;
  maxQ += toNum(diffAdj?.max) ?? (difficultyKey === "easy" ? -0.6 : difficultyKey === "hard" ? 0.6 : 0);

  const wkCfg = cfg?.adjustByWeeklyKm || {};
  const lowThreshold = toNum(wkCfg?.lowThreshold) ?? 30;
  const highThreshold = toNum(wkCfg?.highThreshold) ?? 65;
  const lowMaxDelta = toNum(wkCfg?.lowMaxDelta) ?? -0.4;
  const highMaxDelta = toNum(wkCfg?.highMaxDelta) ?? 0.7;
  if ((weeklyKm || 0) < lowThreshold) {
    maxQ += lowMaxDelta;
  } else if ((weeklyKm || 0) > highThreshold) {
    maxQ += highMaxDelta;
  }

  const spwCfg = cfg?.adjustBySessionsPerWeek || {};
  const atMost = toNum(spwCfg?.whenAtMost) ?? 3;
  const spwMaxDelta = toNum(spwCfg?.maxDelta) ?? 0.3;
  if ((sessionsPerWeek || 0) <= atMost) {
    maxQ += spwMaxDelta; // single quality day can be a touch bigger
  }

  const minClampCfg = cfg?.minClamp || {};
  const maxClampCfg = cfg?.maxClamp || {};
  const minClampLo = toNum(minClampCfg?.min) ?? 3.5;
  const minClampHi = toNum(minClampCfg?.max) ?? 7.0;
  const maxFloorDelta = toNum(maxClampCfg?.minFloorDelta) ?? 0.5;
  const maxFloor = toNum(maxClampCfg?.minFloor) ?? 7.5;
  const maxClamp = toNum(maxClampCfg?.max) ?? 16.0;

  minQ = round1(clamp(minQ, minClampLo, minClampHi));
  maxQ = round1(clamp(maxQ, Math.max(minQ + maxFloorDelta, maxFloor), maxClamp));
  return { minQ, maxQ };
}
function prefersThresholdByGoal(goalKey) {
  const configured = RULES?.fillSessionsPolicy?.thresholdPreferredGoals;
  if (Array.isArray(configured) && configured.length) {
    return configured.map((x) => String(x).toLowerCase().trim()).includes(goalKey);
  }
  return goalKey === "half" || goalKey === "marathon" || goalKey === "ultra";
}
function getLongAbsMin() {
  return toNum(RULES?.longRun?.minKm) ?? 6;
}
function getLongAbsMax() {
  return toNum(RULES?.longRun?.maxKmDefault ?? RULES?.longRun?.maxKm) ?? 32;
}
function getLongMaxPctOfWeekly() {
  return toNum(RULES?.longRun?.maxPctOfWeekly) ?? 0.4;
}
function getLongShareTargetPctByPhase(phase) {
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const map = RULES?.longRun?.longRunSharePctByPhase || {};
  const target = toNum(map?.[p]?.target);
  if (target != null) return clamp(target, 18, 45);
  return 30;
}
function getLongShareMaxPctByPhase(phase) {
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const map = RULES?.longRun?.longRunSharePctByPhase || {};
  const maxPct = toNum(map?.[p]?.max);
  if (maxPct != null) return clamp(maxPct, 18, 45) / 100;
  return getLongMaxPctOfWeekly();
}
function getLongShareMaxPctByGoalPhase(goalKey, phase) {
  const g = String(goalKey || "").toLowerCase().trim();
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const map = RULES?.longRun?.longRunSharePctByGoalPhase || {};
  const maxPct = toNum(map?.[g]?.[p]?.max);
  if (maxPct != null) return clamp(maxPct, 18, 45) / 100;
  return null;
}

// ---------------- workout step builders (very small fallback only) ----------------
// NOTE: With garminSteps OPTION A, EASY/LONG are rendered later as single steady distance.
// These fallback builders are only used if something upstream fails badly.

function workoutEasyBlueprint({ km, includeStrides = false }) {
  return {
    kind: "EASY",
    sport: "running",
    variant: includeStrides ? "EASY_PLUS_STRIDES" : "STANDARD_EASY",
    estimatedDistanceMeters: Math.round(Math.max(0, Number(km) || 0) * 1000),
    // Steps are optional; Garmin steps renderer will replace/ignore for EASY kind.
    steps: [
      {
        stepType: "steady",
        durationType: "distance",
        durationValue: Math.round(Math.max(0, km) * 1000),
        targetType: "none",
      },
    ],
  };
}

function workoutLongBlueprint({ km, variant = "EASY" }) {
  return {
    kind: "LONG",
    sport: "running",
    variant,
    estimatedDistanceMeters: Math.round(Math.max(0, Number(km) || 0) * 1000),
    steps: [
      {
        stepType: "steady",
        durationType: "distance",
        durationValue: Math.round(Math.max(0, km) * 1000),
        targetType: "none",
      },
    ],
  };
}

function workoutStridesBlueprint({ reps = 6, repDistanceM = 80, recoverySec = 75 } = {}) {
  return {
    kind: "STRIDES",
    sport: "running",
    reps: Math.max(2, Math.min(12, Number(reps || 6))),
    repDistanceM: Math.max(40, Math.min(200, Number(repDistanceM || 80))),
    recovery: { type: "JOG_TIME", valueSec: Math.max(30, Math.min(180, Number(recoverySec || 75))) },
  };
}

// ---------------- spec pool picking ----------------
function phaseKey(phase) {
  const p = String(phase || "").toUpperCase().trim();
  return p || "BUILD";
}

/**
 * Deterministic pick:
 * - Prefer unused ids; otherwise reuse pool[0]
 * - If pool items are strings, treat as {id: string}
 */
function pickFromPool({ pool = [], used = new Set() }) {
  const arr0 = Array.isArray(pool) ? pool : [];
  const arr = arr0
    .map((x) => (typeof x === "string" ? { id: x } : x))
    .filter((x) => x && typeof x === "object");

  if (!arr.length) return null;

  const fresh = arr.filter((x) => x?.id && !used.has(x.id));
  const choice = (fresh.length ? fresh : arr)[0]; // deterministic
  if (choice?.id) used.add(choice.id);
  return choice || null;
}

function pickIntervalFromPoolForBudget({
  pool = [],
  used = new Set(),
  weekIndex,
  profile,
  isDeload = false,
  totalWeeks = 12,
  totalKm,
  weekWeeklyKm,
  phaseOverride,
} = {}) {
  const rawPool = Array.isArray(pool) ? pool : [];
  const normalized = rawPool
    .map((x) => (typeof x === "string" ? { id: x } : x))
    .filter((x) => x && typeof x === "object");
  if (!normalized.length) return { picked: null, workout: null };

  const fresh = normalized.filter((x) => x?.id && !used.has(x.id));
  const candidates = fresh.length ? fresh : normalized;

  let best = null;
  const phaseLc = String(phaseOverride || "").toLowerCase();
  const isTaper = phaseLc === "taper";
  const enforceFidelity = !isDeload && !isTaper;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const w = getIntervalsWorkout({
      id: c?.id || null,
      weekIndex,
      profile,
      isDeload,
      totalWeeks,
      totalKm,
      weekWeeklyKm,
      phaseOverride,
      goalKeyOverride: null,
    });
    const planningTargetWorkM = toNum(w?.meta?.planningTargetWorkM);
    const targetWorkM = planningTargetWorkM ?? (toNum(w?.meta?.targetWorkM) ?? 0);
    const achievedWorkM = toNum(w?.meta?.achievedWorkM) ?? 0;
    const ratio = targetWorkM > 0 ? achievedWorkM / targetWorkM : 1;
    const fidelityKeep = toNum(w?.meta?.fidelityKeepRatio);
    const underPenalty = ratio < 0.7 ? (0.7 - ratio) * 1000 : 0;
    const overPenalty = ratio > 1.1 ? (ratio - 1.1) * 1200 : 0;
    let fidelityPenalty = 0;
    if (enforceFidelity && fidelityKeep != null) {
      const desiredKeep = 0.85;
      if (fidelityKeep < desiredKeep) fidelityPenalty += (desiredKeep - fidelityKeep) * 1800;
      fidelityPenalty += Math.max(0, 1 - Math.min(1, fidelityKeep)) * 180;
    }
    const score = underPenalty + overPenalty + Math.abs(1 - ratio) * 100 + fidelityPenalty + i * 0.01;

    const candidate = { picked: c, workout: w, score };
    if (!best || candidate.score < best.score) best = candidate;
  }

  if (best?.picked?.id) used.add(best.picked.id);
  return best || { picked: candidates[0], workout: null };
}

function tempoWorkMin(workout) {
  const sec = toNum(workout?.tempo?.valueSec);
  if (sec != null) return sec / 60;
  const fromMeta = toNum(workout?.meta?.workMin);
  return fromMeta != null ? fromMeta : 0;
}

function pickTempoFromPoolForProgression({
  pool = [],
  used = new Set(),
  weekIndex,
  profile,
  isDeload = false,
  isTaper = false,
  totalWeeks = 12,
  weekWeeklyKm,
  phaseOverride,
  totalKm,
  prevProgressWorkMin = null,
} = {}) {
  const arr0 = Array.isArray(pool) ? pool : [];
  const arr = arr0
    .map((x) => (typeof x === "string" ? { id: x } : x))
    .filter((x) => x && typeof x === "object");
  if (!arr.length) return { picked: null, workout: null };

  const fresh = arr.filter((x) => x?.id && !used.has(x.id));
  let candidates = fresh.length ? fresh : arr;
  if (!isDeload && !isTaper && prevProgressWorkMin != null && fresh.length) {
    const progressionFloor = Math.max(0, prevProgressWorkMin - 0.5);
    const freshCanHold = fresh.some((c) => {
      const w = getTempoWorkout({
        id: c?.id || null,
        weekIndex,
        profile,
        isDeload,
        totalWeeks,
        weekWeeklyKm,
        phaseOverride,
        goalKeyOverride: null,
        totalKm,
      });
      return tempoWorkMin(w) >= progressionFloor;
    });
    if (!freshCanHold) candidates = arr;
  }

  let best = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const w = getTempoWorkout({
      id: c?.id || null,
      weekIndex,
      profile,
      isDeload,
      totalWeeks,
      weekWeeklyKm,
      phaseOverride,
      goalKeyOverride: null,
      totalKm,
    });

    const workMin = tempoWorkMin(w);
    const desired = toNum(w?.meta?.desiredWorkMin) ?? workMin;
    const progressionFloor = prevProgressWorkMin != null ? prevProgressWorkMin - 0.5 : null;
    const progressionCeiling = prevProgressWorkMin != null ? prevProgressWorkMin + 3.0 : null;

    let score = Math.abs(desired - workMin) * 15 + i * 0.01;
    if (!isDeload && !isTaper && progressionFloor != null && workMin < progressionFloor) {
      score += (progressionFloor - workMin) * 300;
    }
    if (!isDeload && !isTaper && progressionCeiling != null && workMin > progressionCeiling) {
      score += (workMin - progressionCeiling) * 140;
    }
    if (!isDeload && !isTaper) score -= workMin * 0.2;
    if (isDeload || isTaper) score += Math.max(0, workMin - desired) * 10;

    const candidate = { picked: c, workout: w, score };
    if (!best || candidate.score < best.score) best = candidate;
  }

  if (best?.picked?.id) used.add(best.picked.id);
  return best || { picked: candidates[0], workout: null };
}

// ---------------- session factory ----------------
function makeSessionBase({ day, type, name, km, notes = "", purpose = "", keyTargets = "" }) {
  const fixed = round1(Math.max(0, km));
  return {
    day,
    type,
    sessionType: type,
    workoutKind: type,
    name,
    distanceKm: fixed,
    plannedDistanceKm: fixed,
    distance: fixed,
    distanceMeters: Math.round(fixed * 1000),
    notes,
    purpose,
    keyTargets,
    meta: { budgetReason: "initial", budgetDeltaKm: 0 },
  };
}

// ---------------- easy distribution ----------------
function distributeEasyKmExact(totalRemaining, daysCount, { minPer = 0 } = {}) {
  if (daysCount <= 0) return [];
  const total = Math.max(0, Number(totalRemaining) || 0);
  if (total <= 0) return Array.from({ length: daysCount }, () => 0);

  const min = Math.max(0, Number(minPer) || 0);
  let arr = Array.from({ length: daysCount }, () => total / daysCount);

  if (min > 0 && total >= min * daysCount) {
    arr = arr.map((v) => Math.max(v, min));
    const sum = arr.reduce((a, b) => a + b, 0);
    const scale = sum > 0 ? total / sum : 1;
    arr = arr.map((v) => v * scale);
  }

  arr = arr.map((v) => round1(Math.max(0, v)));
  const sumR = round1(arr.reduce((a, b) => a + b, 0));
  const drift = round1(total - sumR);
  if (Math.abs(drift) >= 0.1) arr[arr.length - 1] = round1(Math.max(0, arr[arr.length - 1] + drift));
  return arr;
}

function allocateWeekKmDeterministic({
  weeklyKm,
  sessionsPerWeek,
  phase,
  tgt,
  goalKey,
  expKey,
  difficultyKey,
  weekIndex,
  qualityCount,
  easyDaysCount,
  minEasy,
  minQ,
  maxQ,
}) {
  const totalWeeklyKm = round1(Math.max(0, Number(weeklyKm) || 0));
  const qualitySessionCount = Math.max(0, Number(qualityCount) || 0);
  const easyRunCount = Math.max(0, Number(easyDaysCount) || 0);
  const phaseLc = String(phase || "").toLowerCase() || null;

  let longTarget;
  let longReason = null;
  if (sessionsPerWeek === 1) {
    // One-run plans spend the full weekly budget on the long run.
    longTarget = totalWeeklyKm;
    longReason = {
      mode: "single_run_full_budget",
      targetKm: longTarget,
    };
  } else {
    const longTargetPct = getLongShareTargetPctByPhase(phase);
    const longMaxPctBase = Math.min(
      getLongMaxPctOfWeekly(),
      getLongShareMaxPctByPhase(phase),
      getLongShareMaxPctByGoalPhase(goalKey, phase) ?? 1
    );
    const targetLongKm = toNum(tgt?.longRunKm);
    const longMaxPctFromTarget =
      Number.isFinite(totalWeeklyKm) && totalWeeklyKm > 0 && targetLongKm != null
        ? clamp(targetLongKm / totalWeeklyKm + 0.02, 0.26, 0.52)
        : null;
    const longMaxPct =
      longMaxPctFromTarget != null ? Math.max(longMaxPctBase, longMaxPctFromTarget) : longMaxPctBase;
    const longTargetRaw = toNum(tgt?.longRunKm) ?? (totalWeeklyKm * longTargetPct) / 100;
    const longCapByPct = totalWeeklyKm * longMaxPct;

    longTarget = round1(
      Math.min(
        totalWeeklyKm,
        clamp(longTargetRaw, getLongAbsMin(), Math.min(getLongAbsMax(), longCapByPct))
      )
    );

    longReason = {
      mode: "phase_target_capped",
      phaseTargetPct: round1(longTargetPct),
      maxPct: round1(longMaxPct * 100),
      targetFromProgressionKm: toNum(tgt?.longRunKm),
      targetRawKm: round1(longTargetRaw),
      capByPctKm: round1(longCapByPct),
      targetKm: longTarget,
    };
  }

  const remainingAfterLong = round1(Math.max(0, totalWeeklyKm - longTarget));
  const minEasyTotal = round1(easyRunCount * Math.max(0, Number(minEasy) || 0));

  let qualityTotal = 0;
  let qualityReason = {
    mode: "no_quality_slots",
    targetSharePct: 0,
    maxSharePct: 0,
    targetQualityKm: 0,
    capQualityKm: 0,
    floorQualityKm: 0,
  };
  if (qualitySessionCount > 0) {
    const phaseTargetPct =
      getQualityShareTargetPctByPhase(phase) +
      goalQualityShiftPct(goalKey) +
      experienceQualityShiftPct(expKey) +
      difficultyQualityShiftPct(difficultyKey) +
      weekWaveShiftPct(weekIndex, phase);
    const phaseMaxPct = getQualityShareMaxPctByPhase(phase);
    const maxQualityKmByPhase = round1((totalWeeklyKm * phaseMaxPct) / 100);
    const targetQualityKm = round1((totalWeeklyKm * phaseTargetPct) / 100);
    const maxQualityKmBySessions = round1(Math.max(0, Number(maxQ) || 0) * qualitySessionCount);
    const maxQualityKmByBudget = round1(Math.max(0, remainingAfterLong - minEasyTotal));
    const qualityCap = round1(Math.max(0, Math.min(maxQualityKmByPhase, maxQualityKmBySessions, maxQualityKmByBudget)));

    const minQualityKmBySessions = round1(Math.max(0, Number(minQ) || 0) * qualitySessionCount);
    const qualityFloor = qualityCap >= minQualityKmBySessions ? minQualityKmBySessions : 0;
    qualityTotal = round1(clamp(targetQualityKm, qualityFloor, qualityCap));

    qualityReason = {
      mode: "phase_target_capped",
      targetSharePct: round1(phaseTargetPct),
      maxSharePct: round1(phaseMaxPct),
      targetQualityKm,
      capQualityKm: qualityCap,
      floorQualityKm: qualityFloor,
      count: qualitySessionCount,
      minPerSessionKm: round1(minQ),
      maxPerSessionKm: round1(maxQ),
    };
  }

  const minQualityPerSession =
    qualitySessionCount > 0 && qualityTotal >= round1((Number(minQ) || 0) * qualitySessionCount)
      ? Math.max(0, Number(minQ) || 0)
      : 0;
  const qualityAlloc = distributeEasyKmExact(qualityTotal, qualitySessionCount, {
    minPer: minQualityPerSession,
  });
  const resolvedQualityTotal = round1(qualityAlloc.reduce((a, b) => a + b, 0));

  const easyTotal = round1(Math.max(0, totalWeeklyKm - longTarget - resolvedQualityTotal));
  const easyAlloc = distributeEasyKmExact(easyTotal, easyRunCount, {
    minPer: easyRunCount ? Math.max(0, Number(minEasy) || 0) : 0,
  });

  const allocationReason = {
    allocator: "deterministic_long_quality_easy",
    order: ["long", "quality", "easy"],
    phase: phaseLc,
    weekIndex: Number(weekIndex || 0) || null,
    inputs: {
      weeklyKm: totalWeeklyKm,
      sessionsPerWeek: Number(sessionsPerWeek) || 0,
      qualityCount: qualitySessionCount,
      easyDaysCount: easyRunCount,
    },
    long: longReason,
    quality: {
      ...qualityReason,
      allocatedTotalKm: resolvedQualityTotal,
    },
    easy: {
      mode: "remaining_budget_distribution",
      minPerSessionKm: round1(minEasy),
      allocatedTotalKm: easyTotal,
      count: easyRunCount,
    },
  };

  return {
    longTarget,
    qualityAlloc,
    qualityTotal: resolvedQualityTotal,
    easyAlloc,
    easyTotal,
    allocationReason,
  };
}

// ---------------- reconciliation (planned km budget) ----------------
function reconcileWeekPlannedKm({ sessions, weeklyKm }) {
  const target = round1(Math.max(0, weeklyKm));
  const sumPlanned = () => round1(sessions.reduce((a, s) => a + (toNum(s?.plannedDistanceKm) ?? 0), 0));
  const plannedWeeklyKm = sumPlanned();
  return {
    targetWeeklyKm: target,
    plannedWeeklyKm,
    computedWeeklyKm: plannedWeeklyKm,
    driftKm: round1(target - plannedWeeklyKm),
    computedDriftKm: round1(target - plannedWeeklyKm),
  };
}

// ---------------- main ----------------
export function fillSessionsFromSkeleton({ skeleton, targets, profile }) {
  const skWeeks = unwrapWeeks(skeleton);
  const tgtWeeks = unwrapWeeks(targets);
  const spec = skeleton?.spec || null;

  const used = { tempo: new Set(), intervals: new Set() };
  let prevPrimaryQualityFamily = null; // "INTERVALS" | "THRESHOLD"
  let prevThresholdProgressWorkMin = null;

  const weeks = skWeeks.map((sk, idx0) => {
    const weekIndex = Number(sk?.weekIndex || sk?.week || idx0 + 1) || idx0 + 1;
    const tgt = tgtWeeks[idx0] || null;

    const runDays = Array.isArray(sk?.runDays) ? sk.runDays.filter((d) => ORDER.includes(d)) : [];
    const sessionsPerWeek = normaliseSessionsPerWeek(profile?.sessionsPerWeek, runDays.length);

    const weeklyKmTarget = toNum(tgt?.weeklyKm) ?? toNum(profile?.weeklyKm) ?? 0;
    const weeklyKm = Math.max(0, weeklyKmTarget);

    // IMPORTANT: use week.phase from targets/skeleton (phaseOverride contract)
    const phase = String(phaseKey(tgt?.phase || sk?.phase)).toLowerCase();
    const goalKey = normaliseGoalPolicyKey(
      profile?.goalPolicyKey
    );
    const expKey = normaliseExperienceKey(
      profile?.experienceKey
    );
    const difficultyKey = normaliseDiffKey(
      profile?.difficultyKey
    );

    const longRunDayFromSk =
      sk?.days?.find((d) => Array.isArray(d?.tags) && d.tags.includes("longRunDay"))?.day || null;

    const longRunDayRaw = profile?.longRunDay || longRunDayFromSk || "Sun";
    const longRunDay = chooseLongRunDay(longRunDayRaw, runDays);

    const dayMeta = new Map();
    if (Array.isArray(sk?.days)) {
      for (const d of sk.days) {
        if (!d?.day) continue;
        dayMeta.set(String(d.day), {
          intent: String(d.intent || "").toUpperCase(),
          tags: Array.isArray(d.tags) ? d.tags : [],
        });
      }
    }

    // Determine quality days from skeleton intents
    const qualityIntents = new Set(["INTERVALS_PRIMARY", "THRESHOLD_PRIMARY", "TEMPO_PRIMARY", "HILLS_PRIMARY"]);

    // Simplified session composition:
    // - <=3 runs: 1 quality session
    // - >=4 runs: up to 2 quality sessions
    // - always 1 long run (handled below)
    const requestedQualitySessions = sessionsPerWeek >= 4 ? 2 : 1;
    const maxQualitySlots = Math.max(0, runDays.length - 1); // reserve one slot for LONG
    let desiredHard = Math.min(requestedQualitySessions, maxQualitySlots);
    let qualityCandidates = runDays
      .filter((d) => qualityIntents.has(dayMeta.get(d)?.intent))
      .map((day) => ({ day, intent: dayMeta.get(day)?.intent || "" }));

    const familyFromIntent = (intentRaw) => {
      const intent = String(intentRaw || "").toUpperCase();
      if (intent.includes("INTERVALS") || intent.includes("HILLS")) return "INTERVALS";
      if (intent.includes("THRESHOLD") || intent.includes("TEMPO")) return "THRESHOLD";
      return null;
    };
    const minHardGap = clampInt(RULES?.spacing?.minGapDaysBetweenHard ?? 1, 1, 6);
    const dayGap = (a, b) => {
      const ia = ORDER.indexOf(String(a || "").trim());
      const ib = ORDER.indexOf(String(b || "").trim());
      if (ia < 0 || ib < 0) return 99;
      return Math.abs(ia - ib);
    };
    const isSpacedQualityCandidate = (day, picked = []) => {
      if (!day) return false;
      if (longRunDay && dayGap(day, longRunDay) <= minHardGap) return false;
      const chosen = Array.isArray(picked) ? picked : [];
      for (const p of chosen) {
        const d = typeof p === "string" ? p : p?.day;
        if (!d) continue;
        if (dayGap(day, d) <= minHardGap) return false;
      }
      return true;
    };

    // If skeleton exposes fewer quality-intent days than requested, promote additional
    // non-long run days deterministically so composition still follows the simplified rule.
    if (desiredHard > 0 && qualityCandidates.length < desiredHard) {
      const pickedDays = new Set(qualityCandidates.map((c) => c.day));
      const fallbackDays = runDays.filter((d) => d !== longRunDay && !pickedDays.has(d));
      for (const day of fallbackDays) {
        if (qualityCandidates.length >= desiredHard) break;
        if (!isSpacedQualityCandidate(day, qualityCandidates)) continue;
        const nextIntent =
          qualityCandidates.length % 2 === 0 ? "INTERVALS_PRIMARY" : "THRESHOLD_PRIMARY";
        qualityCandidates.push({ day, intent: nextIntent });
      }
    }

    const pickPrimaryFamily = () => {
      const families = new Set(qualityCandidates.map((c) => familyFromIntent(c.intent)).filter(Boolean));
      const hasIntervals = families.has("INTERVALS");
      const hasThreshold = families.has("THRESHOLD");
      const opposite = prevPrimaryQualityFamily === "INTERVALS" ? "THRESHOLD" : "INTERVALS";
      const thresholdBias = prefersThresholdByGoal(goalKey);

      if (phase === "deload") {
        if (hasThreshold) return "THRESHOLD";
        if (hasIntervals) return "INTERVALS";
      }

      if (phase === "taper") {
        if (hasIntervals) return "INTERVALS";
        if (hasThreshold) return "THRESHOLD";
      }

      if (phase === "specific") {
        // Specific should still avoid interval-only streaks when threshold is available.
        if (prevPrimaryQualityFamily === "INTERVALS" && hasThreshold) return "THRESHOLD";
        if (thresholdBias && hasThreshold && weekIndex % 2 === 1) return "THRESHOLD";
        if (weekIndex % 3 === 0 && hasThreshold) return "THRESHOLD";
        if (hasIntervals) return "INTERVALS";
        if (hasThreshold) return "THRESHOLD";
      }

      // Base/build: prefer alternating stimulus where possible.
      if (prevPrimaryQualityFamily && families.has(opposite)) return opposite;
      if (thresholdBias) {
        if (hasThreshold) return "THRESHOLD";
        if (hasIntervals) return "INTERVALS";
      }
      if (hasIntervals) return "INTERVALS";
      if (hasThreshold) return "THRESHOLD";
      return null;
    };

    const pickQualityCandidates = (count) => {
      if (!qualityCandidates.length || count <= 0) return [];

      const remaining = [...qualityCandidates];
      const picked = [];
      const takeByFamily = (family) => {
        if (!family) return null;
        const idx = remaining.findIndex(
          (c) =>
            familyFromIntent(c.intent) === family &&
            isSpacedQualityCandidate(c.day, picked)
        );
        if (idx < 0) return null;
        const [it] = remaining.splice(idx, 1);
        picked.push(it);
        return it;
      };

      const primaryFamily = pickPrimaryFamily();
      const secondaryFamily = primaryFamily === "INTERVALS" ? "THRESHOLD" : "INTERVALS";

      // First slot = phase-aware primary family.
      takeByFamily(primaryFamily);
      // Second slot (for 4-day plans) = complementary family when available.
      if (count >= 2) takeByFamily(secondaryFamily);

      // Fill any remaining required slots deterministically.
      while (picked.length < count && remaining.length) {
        const nextIdx = remaining.findIndex((c) => isSpacedQualityCandidate(c.day, picked));
        if (nextIdx < 0) break;
        const [it] = remaining.splice(nextIdx, 1);
        picked.push(it);
      }

      const firstFamily = familyFromIntent(picked[0]?.intent);
      if (firstFamily) prevPrimaryQualityFamily = firstFamily;
      return picked;
    };

    let qualitySlots = [];
    if (desiredHard > 0 && qualityCandidates.length) {
      qualitySlots = pickQualityCandidates(desiredHard);
    }
    const qualityDays = qualitySlots.map((x) => x.day);

    const easyDays = runDays.filter((d) => d !== longRunDay && !qualityDays.includes(d));

    const { minQ, maxQ } = getQualityKmBounds({
      goalKey,
      expKey,
      difficultyKey,
      weeklyKm,
      sessionsPerWeek,
    });

    const minEasy = getMinEasyKmPerRun(weeklyKm);
    const qualityCount = qualitySlots.length;
    const {
      longTarget,
      qualityAlloc,
      easyAlloc,
      allocationReason,
    } = allocateWeekKmDeterministic({
      weeklyKm,
      sessionsPerWeek,
      phase,
      tgt,
      goalKey,
      expKey,
      difficultyKey,
      weekIndex,
      qualityCount,
      easyDaysCount: easyDays.length,
      minEasy,
      minQ,
      maxQ,
    });

    const sessions = [];

    // LONG (details from longRunWorkouts.js, but km budget stays longTarget)
    {
      const tags = dayMeta.get(longRunDay)?.tags || [];
      const qualityOptionalByTag = tags.includes("quality_optional");

      const progression = tgt?.progression && typeof tgt.progression === "object" ? tgt.progression : {};
      const qualityOnLongRun = !!progression.qualityOnLongRun || !!qualityOptionalByTag;
      const longQualityLevel = toNum(progression.longQualityLevel) ?? 0;

      const s = makeSessionBase({
        day: longRunDay,
        type: "LONG",
        name: "Long run",
        km: longTarget,
        purpose: "Aerobic endurance",
        keyTargets: "Easy effort",
      });

      const details = buildLongRunDetails({
        weekIndex,
        totalWeeks: skWeeks.length,
        isDeload: !!tgt?.isDeload,
        profile,
        longKm: getPlannedKm(s),
        weeklyKm,
        phase,
        qualityOnLongRun,
        longQualityLevel,
        taperByRules: !!tgt?.taperByRules,
      });

      s.keyTargets = details?.keyTargets || s.keyTargets;
      s.notes = details?.notes || "Easy effort throughout. Keep it relaxed and comfortable.";
      s.meta.longVariant = details?.variant || "EASY";

      const isEasyLongVariant = String(details?.variant || "EASY")
        .toUpperCase()
        .startsWith("EASY");

      s.workout =
        details?.workout && typeof details.workout === "object"
          ? { ...details.workout, kind: "LONG", estimatedDistanceMeters: Math.round(getPlannedKm(s) * 1000) }
          : workoutLongBlueprint({ km: getPlannedKm(s), variant: details?.variant || "EASY" });
      if (!s.workout.meta || typeof s.workout.meta !== "object") s.workout.meta = {};
      s.workout.meta.sessionKm = getPlannedKm(s);
      // EASY long-run variants should be rendered flat later (single distance step).
      if (isEasyLongVariant) {
        delete s.workout.steps;
      }

      sessions.push(s);
    }

    // QUALITY sessions
    for (let qi = 0; qi < qualitySlots.length; qi++) {
      const day = qualitySlots[qi]?.day;
      const intent = String(
        qualitySlots[qi]?.intent ||
          dayMeta.get(day)?.intent ||
          "INTERVALS_PRIMARY"
      ).toUpperCase();

      // Session distance budget is kmBudget (do not add warm/cool here)
      const kmBudget = round1(Math.max(0, Math.min(maxQ, qualityAlloc[qi] ?? 0)));

      // TEMPO/THRESHOLD via getTempoWorkout()
      if (intent.includes("THRESHOLD") || intent.includes("TEMPO")) {
        const isTempo = intent.includes("TEMPO");

        const s = makeSessionBase({
          day,
          type: isTempo ? "TEMPO" : "THRESHOLD",
          name: isTempo ? "Tempo" : "Threshold",
          km: kmBudget,
          purpose: "Controlled hard / aerobic power",
          keyTargets: "Hold pace range",
        });

        const pool = spec?.workouts?.tempo?.[phaseKey(phase)] || spec?.workouts?.tempo?.[phase] || [];
        const chosen = pickTempoFromPoolForProgression({
          pool,
          used: used.tempo,
          weekIndex,
          profile,
          isDeload: !!tgt?.isDeload,
          isTaper: !!tgt?.isTaper,
          totalWeeks: skWeeks.length,
          weekWeeklyKm: weeklyKm,
          phaseOverride: phase,
          totalKm: getPlannedKm(s),
          prevProgressWorkMin: prevThresholdProgressWorkMin,
        });
        const picked = chosen?.picked || null;

        s.workout =
          chosen?.workout ||
          getTempoWorkout({
            id: picked?.id || null,
            weekIndex,
            profile,
            isDeload: !!tgt?.isDeload,
            totalWeeks: skWeeks.length,
            weekWeeklyKm: weeklyKm,
            phaseOverride: phase,
            totalKm: getPlannedKm(s),
          });

        if (s.workout?.keyTargets) s.keyTargets = s.workout.keyTargets;
        if (s.workout?.notes) s.notes = s.workout.notes;

        ensureMeta(s);
        const requestedSpecId = picked?.id || null;
        const deliveredSpecId =
          s.workout?.variant || s.workout?.meta?.specPickId || s.workout?.meta?.pickedId || requestedSpecId || null;
        s.meta.requestedSpecId = requestedSpecId;
        s.meta.specPickId = deliveredSpecId;
        if (s.workout?.meta && typeof s.workout.meta === "object") {
          s.workout.meta.requestedSpecId = requestedSpecId;
          s.workout.meta.templatePickId = requestedSpecId;
          s.workout.meta.specPickId = deliveredSpecId;
        }

        if (!tgt?.isDeload && !tgt?.isTaper) {
          const currentWorkMin = tempoWorkMin(s.workout);
          if (currentWorkMin > 0) {
            prevThresholdProgressWorkMin =
              prevThresholdProgressWorkMin != null
                ? Math.max(prevThresholdProgressWorkMin, currentWorkMin)
                : currentWorkMin;
          }
        }

        sessions.push(s);
        continue;
      }

      // INTERVALS / HILLS → intervalWorkouts.js (✅ now spec-driven)
      if (intent.includes("INTERVALS") || intent.includes("HILLS")) {
        const s = makeSessionBase({
          day,
          type: "INTERVALS",
          name: intent.includes("HILLS") ? "Hills / intervals" : "Intervals",
          km: kmBudget,
          purpose: "Speed / VO₂ / economy",
          keyTargets: "Intervals set",
        });

        const pool = spec?.workouts?.intervals?.[phaseKey(phase)] || spec?.workouts?.intervals?.[phase] || [];
        const chosen = pickIntervalFromPoolForBudget({
          pool,
          used: used.intervals,
          weekIndex,
          profile,
          isDeload: !!tgt?.isDeload,
          totalWeeks: skWeeks.length,
          totalKm: getPlannedKm(s),
          weekWeeklyKm: weeklyKm,
          phaseOverride: phase,
        });
        const picked = chosen?.picked || null;

        // NOTE: totalKm is the MAIN-SET budget for intervals builder.
        s.workout =
          chosen?.workout ||
          getIntervalsWorkout({
            id: picked?.id || null,
            weekIndex,
            profile,
            isDeload: !!tgt?.isDeload,
            totalWeeks: skWeeks.length,
            totalKm: getPlannedKm(s),
            weekWeeklyKm: weeklyKm,
            phaseOverride: phase,
            goalKeyOverride: null,
          });

        if (s.workout?.keyTargets) s.keyTargets = s.workout.keyTargets;
        if (s.workout?.notes) s.notes = s.workout.notes;

        ensureMeta(s);
        const requestedSpecId = picked?.id || null;
        const deliveredSpecId =
          s.workout?.variant || s.workout?.meta?.specPickId || s.workout?.meta?.pickedId || requestedSpecId || null;
        s.meta.requestedSpecId = requestedSpecId;
        s.meta.specPickId = deliveredSpecId;
        if (s.workout?.meta && typeof s.workout.meta === "object") {
          s.workout.meta.requestedSpecId = requestedSpecId;
          s.workout.meta.templatePickId = requestedSpecId;
          s.workout.meta.specPickId = deliveredSpecId;
        }

        sessions.push(s);
        continue;
      }
    }

    // EASY (add-ons from easyWorkouts.js)
    let stridesCountSoFar = 0;
    for (let ei = 0; ei < easyDays.length; ei++) {
      const day = easyDays[ei];
      const km = easyAlloc[ei] ?? 0;

      const s = makeSessionBase({
        day,
        type: "EASY",
        name: "Easy run",
        km,
        purpose: "Aerobic base + recovery",
        keyTargets: "Comfortable pace",
      });

      const addOn = buildEasyAddOn({
        weekIndex,
        totalWeeks: skWeeks.length,
        isDeload: !!tgt?.isDeload,
        profile,
        day,
        runDays,
        longRunDay,
        spec,
        stridesCountSoFar,
      });

      if (addOn?.keyTargets) s.keyTargets = addOn.keyTargets;
      if (addOn?.notes) s.notes = addOn.notes;
      if (addOn?.variant) s.name = String(addOn.variant).includes("STRIDES") ? "Easy + strides" : s.name;

      s.workout = workoutEasyBlueprint({ km: getPlannedKm(s), includeStrides: !!addOn?.includeStrides });

      ensureMeta(s);
      s.meta.easyVariant = addOn?.variant || null;
      s.meta.includeStrides = !!addOn?.includeStrides;
      s.meta.steadyFinish = addOn?.steadyFinish || null;
      s.meta.drills = addOn?.drills || null;
      s.meta.recommendedMinutes = addOn?.recommendedMinutes || null;
      s.meta.terrainHint = addOn?.terrainHint || null;
      s.meta.effortHint = addOn?.effortHint || null;

      sessions.push(s);

      if (addOn?.includeStrides) {
        stridesCountSoFar += 1;
      }

      // Keep strides as an EASY add-on only; do not create a separate zero-distance STRIDES session.
    }

    sessions.sort((a, b) => ORDER.indexOf(a.day) - ORDER.indexOf(b.day));
    const metrics = reconcileWeekPlannedKm({ sessions, weeklyKm });

    const dayMap = new Map();
    for (const d of ORDER) {
      dayMap.set(d, {
        day: d,
        intent: runDays.includes(d) ? "RUN" : "REST",
        title: runDays.includes(d) ? d : "Rest / no structured session",
        sessions: [],
      });
    }
    for (const s of sessions) if (dayMap.has(s.day)) dayMap.get(s.day).sessions.push(s);
    const days = ORDER.map((d) => dayMap.get(d));

    return {
      weekIndex,
      weekNumber: weekIndex,
      weekIndex0: idx0,
      runDays,
      phase,
      sessions,
      days,
      metrics,
      targets: tgt || undefined,
      allocationReason,
    };
  });

  return { name: "Run plan", weeks };
}
