// server/lib/train/planRules/workouts/easyWorkouts.js
//
// Goal + plan-length aware “easy add-ons” (deterministic, not random)
//
// ✅ Covers Universal Easy Run Types (all distances):
// - Standard easy run
// - Recovery run (very easy)
// - Aerobic base run (steady easy)
// - Long easy run / long easy aerobic run
// - Easy run with strides (6–8 strides)
// - Easy run with drills (cadence/form pick-ups)
// - Easy progression (easy → steady finish)
// - Ultra: easy trail/terrain-based, hike–run sessions, back-to-back easy long runs
// - Recovery-specific: 20–40 min very easy, shakeout, day-after-race recovery jog
//
// ✅ Still backwards compatible return shape:
// { variant, keyTargets, notes, includeStrides, strides, steadyFinish, drills }
// Optional extra fields (safe): { recommendedMinutes, terrainHint, effortHint }
//
// IMPORTANT:
// This module does NOT decide distance (km). It only adds “flavour” + safe add-ons.
// Long-run structure is handled in longRunWorkouts.js.
//
// ✅ NEW IN THIS DROP:
// - Spec-aware strides policy support (optional): pass `spec` and it will cap/max strides per week.
//   If you don't pass spec, it behaves exactly like before.
import {
  normaliseExperienceKey,
  normaliseGoalDistanceKey,
} from "../normalization.js";

const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normExperience(profile = {}) {
  return normaliseExperienceKey(profile?.experienceKey);
}

function normGoalDistance(profile = {}) {
  const raw = profile?.goalDistanceKey || "";
  return normaliseGoalDistanceKey(raw, {
    fallback: "GENERAL",
    allowGeneral: true,
    allowReturn: true,
  });
}

function getWeeklyKm(profile = {}) {
  return toNum(profile?.weeklyKm) ?? 0;
}

function getTotalWeeks(profile = {}, fallback = 12) {
  return toNum(profile?.planLengthWeeks) ?? fallback;
}

function getPhase(weekIndex, totalWeeks) {
  const w = Number(weekIndex || 1);
  const tw = Math.max(1, Number(totalWeeks || 12));
  const p = w / tw;
  if (p <= 0.35) return "base";
  if (p <= 0.75) return "build";
  if (p <= 0.9) return "specific";
  return "taper";
}

function dayIndex(day) {
  const i = ORDER.indexOf(day);
  return i >= 0 ? i : 0;
}

function isPreferredAddOnDay({ day, longRunDay, runDays = [] } = {}) {
  const d = String(day || "");
  const lr = String(longRunDay || "");

  if (lr && ORDER.includes(lr)) {
    const beforeLong = ORDER[(dayIndex(lr) - 1 + 7) % 7];
    if (d === beforeLong) return true;
  }

  if (["Fri", "Sat"].includes(d)) return true;

  if (Array.isArray(runDays) && runDays.length) {
    const filtered = runDays.filter((x) => x !== lr && ORDER.includes(x));
    const last = filtered[filtered.length - 1];
    if (last && d === last) return true;
  }

  return ["Mon", "Wed"].includes(d);
}

function stablePickSeed(weekIndex, day, salt = 0) {
  const w = Math.max(1, Number(weekIndex || 1));
  const d = dayIndex(day);
  return (w * 17 + d * 5 + salt) >>> 0;
}

// -----------------------------
// Preset ranges (minutes) by goal
// -----------------------------

function easyMinuteRangesByGoal(goal) {
  if (goal === "5K") {
    return { easy: [30, 50], base: [40, 60], recovery: [20, 35], longEasy: [45, 70] };
  }
  if (goal === "10K") {
    return { easy: [35, 60], base: [45, 70], recovery: [20, 40], longEasy: [50, 80] };
  }
  if (goal === "HALF") {
    return { easy: [45, 75], base: [60, 90], recovery: [25, 45], longEasy: [75, 105] };
  }
  if (goal === "MARATHON") {
    return { easy: [50, 90], base: [75, 120], recovery: [25, 45], longEasy: [90, 140] };
  }
  if (goal === "ULTRA") {
    return { easy: [60, 120], base: [75, 150], recovery: [25, 50], longEasy: [120, 240] };
  }
  return { easy: [30, 60], base: [40, 75], recovery: [20, 40], longEasy: [60, 120] };
}

function minutesObj(min, max) {
  return { min: Math.round(min), max: Math.round(max) };
}

// -----------------------------
// Spec helpers (optional)
// -----------------------------

function getStridesPolicy(spec) {
  const p = spec?.workouts?.easy?.stridesPolicy;
  if (!p || typeof p !== "object") return null;

  const maxPerWeek = Number(p.maxPerWeek);
  const reps = Number(p?.defaultStrides?.reps);
  const seconds = Number(p?.defaultStrides?.seconds);

  return {
    maxPerWeek: Number.isFinite(maxPerWeek) ? clamp(maxPerWeek, 0, 7) : null,
    defaultStrides: {
      reps: Number.isFinite(reps) ? clamp(reps, 2, 12) : 6,
      seconds: Number.isFinite(seconds) ? clamp(seconds, 10, 40) : 20,
    },
  };
}

// -----------------------------
// Candidate bank + scoring
// -----------------------------

function baseEasyOnly(goal) {
  const ranges = easyMinuteRangesByGoal(goal);
  return {
    variant: "STANDARD_EASY",
    keyTargets: "Easy pace range",
    notes: `Easy effort. Keep it relaxed. (Typical ${ranges.easy[0]}–${ranges.easy[1]} min)`,
    includeStrides: false,
    strides: null,
    steadyFinish: null,
    drills: null,
    recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
  };
}

function buildCandidates({
  w,
  phase,
  goal,
  wkKm,
  advanced,
  regular,
  newer,
  isDeload,
  day,
  runDays,
  longRunDay,
  spec,
  stridesCountSoFar = 0,
} = {}) {
  const speedGoal = goal === "5K" || goal === "10K";
  const enduranceGoal = goal === "HALF" || goal === "MARATHON" || goal === "ULTRA";
  const ultraGoal = goal === "ULTRA";

  const addonDay = isPreferredAddOnDay({ day, longRunDay, runDays });
  const ranges = easyMinuteRangesByGoal(goal);

  const policy = getStridesPolicy(spec);
  const maxStridesThisWeek =
    policy?.maxPerWeek != null ? Math.max(0, policy.maxPerWeek) : null;

  const canAddStridesByPolicy =
    maxStridesThisWeek == null ? true : stridesCountSoFar < maxStridesThisWeek;

  const out = [];
  const add = (c) => c && c.variant && out.push(c);

  add({ ...baseEasyOnly(goal), _meta: { stress: 1, complexity: 0, needsPreferredDay: false } });

  if (goal === "RETURN" || wkKm < 14) {
    add({
      variant: "RECOVERY_VERY_EASY",
      keyTargets: "Very easy (recovery)",
      notes: `Very easy jog. Keep it conversational. (Typical ${ranges.recovery[0]}–${ranges.recovery[1]} min)`,
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(ranges.recovery[0], ranges.recovery[1]),
      _meta: { stress: 1, complexity: 0, needsPreferredDay: false },
    });

    if (!isDeload && w >= 4 && !newer && addonDay && speedGoal && canAddStridesByPolicy) {
      add({
        variant: "EASY_PLUS_STRIDES_LIGHT",
        keyTargets: "Easy + 4×20s strides",
        notes: "Easy effort. If feeling good: 4×20s relaxed strides after (full recovery).",
        includeStrides: true,
        strides: { reps: 4, durSec: 20, recoverySec: 75 },
        steadyFinish: null,
        drills: null,
        recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
        _meta: { stress: 2, complexity: 1, needsPreferredDay: true },
      });
    }

    return out;
  }

  if (isDeload) {
    add({
      variant: "RECOVERY_RUN",
      keyTargets: "Recovery run (very easy)",
      notes: `Very easy recovery run. Keep it short + relaxed. (Typical ${ranges.recovery[0]}–${ranges.recovery[1]} min)`,
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(ranges.recovery[0], ranges.recovery[1]),
      _meta: { stress: 1, complexity: 0, needsPreferredDay: false, deload: true },
    });

    if (addonDay && speedGoal && wkKm >= 20 && !newer && (w % 4 === 0) && canAddStridesByPolicy) {
      add({
        variant: "EASY_PLUS_STRIDES_LIGHT",
        keyTargets: "Easy + 4×20s strides",
        notes: "Easy effort. Add 4×20s relaxed strides after (full recovery).",
        includeStrides: true,
        strides: { reps: 4, durSec: 20, recoverySec: 75 },
        steadyFinish: null,
        drills: null,
        recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
        _meta: { stress: 2, complexity: 1, needsPreferredDay: true, deload: true },
      });
    }

    return out;
  }

  if (phase === "taper") {
    add({
      variant: "SHAKEOUT_RUN",
      keyTargets: "Shakeout run (light + relaxed)",
      notes: "Short easy shakeout. Keep it light, relaxed, no forcing.",
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(clamp(ranges.recovery[0], 15, 30), clamp(ranges.recovery[1], 25, 45)),
      _meta: { stress: 1, complexity: 0, needsPreferredDay: false, taper: true },
    });

    if (addonDay && wkKm >= 18 && !newer && canAddStridesByPolicy) {
      const reps = advanced ? 6 : 4;
      add({
        variant: "EASY_PLUS_STRIDES",
        keyTargets: `Easy + ${reps}×20s strides`,
        notes: `Easy effort. Add ${reps}×20s relaxed strides after (full recovery).`,
        includeStrides: true,
        strides: { reps, durSec: 20, recoverySec: 75 },
        steadyFinish: null,
        drills: null,
        recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
        _meta: { stress: 2, complexity: 1, needsPreferredDay: true, taper: true },
      });
    }

    if (addonDay && enduranceGoal && advanced && wkKm >= 45) {
      add({
        variant: "EASY_PROGRESSIVE_FINISH",
        keyTargets: "Easy → steady finish (8 min)",
        notes: "Easy effort. Finish with 8 min steady (controlled, not hard).",
        includeStrides: false,
        strides: null,
        steadyFinish: { minutes: 8, intensity: "steady" },
        drills: null,
        recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
        _meta: { stress: 2, complexity: 1, needsPreferredDay: true, taper: true },
      });
    }

    return out;
  }

  if (!addonDay) {
    add({
      variant: "AEROBIC_BASE_RUN",
      keyTargets: "Aerobic base (easy but steady)",
      notes: `Easy aerobic base run — keep it smooth and controlled. (Typical ${ranges.base[0]}–${ranges.base[1]} min)`,
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(ranges.base[0], ranges.base[1]),
      _meta: { stress: 1, complexity: 0, needsPreferredDay: false },
    });

    return out;
  }

  add({
    variant: "RECOVERY_RUN",
    keyTargets: "Recovery run (very easy)",
    notes: `Very easy recovery run. Keep it conversational. (Typical ${ranges.recovery[0]}–${ranges.recovery[1]} min)`,
    includeStrides: false,
    strides: null,
    steadyFinish: null,
    drills: null,
    recommendedMinutes: minutesObj(ranges.recovery[0], ranges.recovery[1]),
    _meta: { stress: 1, complexity: 0, needsPreferredDay: true },
  });

  add({
    variant: "DAY_AFTER_RACE_JOG",
    keyTargets: "Day-after-race recovery jog",
    notes: "If you raced recently: 20–30 min very easy jog or walk-jog. Keep it super gentle.",
    includeStrides: false,
    strides: null,
    steadyFinish: null,
    drills: null,
    recommendedMinutes: minutesObj(20, 30),
    _meta: { stress: 1, complexity: 0, needsPreferredDay: true, recovery: true },
  });

  if (wkKm >= 18) {
    add({
      variant: "AEROBIC_BASE_RUN",
      keyTargets: "Aerobic base (easy but steady)",
      notes: `Easy aerobic base run — smooth, steady, controlled. (Typical ${ranges.base[0]}–${ranges.base[1]} min)`,
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(ranges.base[0], ranges.base[1]),
      _meta: { stress: 1, complexity: 0, needsPreferredDay: true },
    });
  }

  const stridesEvery = speedGoal ? 2 : enduranceGoal ? 3 : 2;
  const stridesOk = wkKm >= 18 && !newer && (w % stridesEvery === 1) && canAddStridesByPolicy;

  if (stridesOk) {
    const repsFromPolicy = policy?.defaultStrides?.reps;
    const secFromPolicy = policy?.defaultStrides?.seconds;

    const reps =
      Number.isFinite(repsFromPolicy)
        ? clamp(repsFromPolicy, 2, 12)
        : speedGoal
          ? (advanced ? 8 : regular ? 6 : 6)
          : 6;

    const durSec =
      Number.isFinite(secFromPolicy)
        ? clamp(secFromPolicy, 10, 40)
        : 20;

    add({
      variant: "EASY_PLUS_STRIDES",
      keyTargets: `Easy + ${reps}×${durSec}s strides`,
      notes: `Easy effort. Add ${reps}×${durSec}s relaxed strides after (full recovery).`,
      includeStrides: true,
      strides: { reps, durSec, recoverySec: 75 },
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
      _meta: { stress: 2, complexity: 1, needsPreferredDay: true },
    });
  }

  const drillsOk = wkKm >= 16 && (phase === "base" || phase === "build") && !newer && (w % 3 === 2);
  if (drillsOk) {
    const reps = advanced ? 6 : 4;
    add({
      variant: "EASY_PLUS_DRILLS",
      keyTargets: `Easy + ${reps}×20s drills`,
      notes: `Easy effort. During the run add ${reps}×20s cadence/form pick-ups (smooth, not sprinting) with 60–90s easy between.`,
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: { reps, durSec: 20, recoverySec: 75, cue: "Cadence/form pick-ups" },
      recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
      _meta: { stress: 1, complexity: 2, needsPreferredDay: true },
    });
  }

  const progressionOk = wkKm >= 20 && !newer && (phase === "build" || phase === "specific") && (w % 3 === 0);
  if (progressionOk) {
    const finishMin =
      ultraGoal ? (advanced ? 25 : 18) :
      goal === "MARATHON" ? (advanced ? 20 : 15) :
      goal === "HALF" ? (advanced ? 16 : 12) :
      speedGoal ? (advanced ? 12 : 8) :
      10;

    add({
      variant: "EASY_PROGRESSIVE_FINISH",
      keyTargets: `Easy → steady finish (${finishMin} min)`,
      notes: `Easy effort. Finish with last ${finishMin} min steady (controlled).`,
      includeStrides: false,
      strides: null,
      steadyFinish: { minutes: finishMin, intensity: "steady" },
      drills: null,
      recommendedMinutes: minutesObj(ranges.easy[0], ranges.easy[1]),
      _meta: { stress: 2, complexity: 1, needsPreferredDay: true },
    });
  }

  const longEasyOk = wkKm >= 28 && enduranceGoal && (phase === "base" || phase === "build") && (w % 4 === 1);
  if (longEasyOk) {
    add({
      variant: "LONG_EASY_AEROBIC",
      keyTargets: "Long easy aerobic",
      notes: `Long easy aerobic run — relaxed and patient. (Typical ${ranges.longEasy[0]}–${ranges.longEasy[1]} min)`,
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(ranges.longEasy[0], ranges.longEasy[1]),
      _meta: { stress: 1, complexity: 0, needsPreferredDay: true },
    });
  }

  if (ultraGoal && wkKm >= 30 && (phase === "base" || phase === "build")) {
    add({
      variant: "EASY_TRAIL_TERRAIN",
      keyTargets: "Easy trail / terrain-based (effort-based)",
      notes: "Easy trail run by effort (not pace). Keep it comfortable; focus on rhythm + footing.",
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      terrainHint: "Trail/uneven terrain",
      effortHint: "Effort-based (conversational)",
      recommendedMinutes: minutesObj(ranges.easy[0], clamp(ranges.easy[1] + 30, ranges.easy[1], 180)),
      _meta: { stress: 1, complexity: 1, needsPreferredDay: true },
    });

    add({
      variant: "EASY_HIKE_RUN",
      keyTargets: "Easy hike–run session (effort-based)",
      notes: "Easy hike–run: alternate 5–10 min easy jog with 2–5 min brisk hike (or on climbs). Keep HR under control.",
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      terrainHint: "Hills/trails encouraged",
      effortHint: "Effort-based (HR/feel)",
      recommendedMinutes: minutesObj(60, clamp(120 + (advanced ? 30 : 0), 90, 180)),
      _meta: { stress: 1, complexity: 2, needsPreferredDay: true },
    });
  }

  const isDayBeforeLong =
    String(day || "") &&
    String(longRunDay || "") &&
    ORDER.includes(String(day)) &&
    ORDER.includes(String(longRunDay)) &&
    ORDER[(dayIndex(longRunDay) - 1 + 7) % 7] === String(day);

  const backToBackOk = ultraGoal && wkKm >= 45 && advanced && isDayBeforeLong && (phase === "base" || phase === "build");
  if (backToBackOk) {
    add({
      variant: "BACK_TO_BACK_EASY_LONG",
      keyTargets: "Back-to-back easy long (keep it EASY)",
      notes: "Back-to-back weekend: keep this run easy and controlled so you’re fresh for tomorrow. If tired, shorten it.",
      includeStrides: false,
      strides: null,
      steadyFinish: null,
      drills: null,
      recommendedMinutes: minutesObj(60, 120),
      _meta: { stress: 1, complexity: 1, needsPreferredDay: true },
    });
  }

  return out;
}

function scoreCandidate({ c, phase, goal, wkKm, advanced, newer, isDeload, addonDay }) {
  const meta = c?._meta || {};
  const stress = Number(meta.stress || 1);
  const complexity = Number(meta.complexity || 0);
  const needsPreferredDay = !!meta.needsPreferredDay;

  let score = 0;

  if (needsPreferredDay && !addonDay) score += 5000;

  if (newer) score += complexity * 260 + stress * 140;
  else if (!advanced) score += complexity * 80;
  else score -= complexity * 15;

  const speedGoal = goal === "5K" || goal === "10K";
  const enduranceGoal = goal === "HALF" || goal === "MARATHON" || goal === "ULTRA";
  const ultraGoal = goal === "ULTRA";

  if (c.variant === "EASY_PROGRESSIVE_FINISH" && wkKm < 20) score += 240;
  if (c.variant === "EASY_PLUS_STRIDES" && newer) score += 300;

  if (speedGoal) {
    if (c.variant === "EASY_PLUS_STRIDES") score -= 70;
    if (c.variant === "EASY_PLUS_DRILLS") score -= 30;
    if (c.variant === "LONG_EASY_AEROBIC") score += 80;
    if (c.variant === "EASY_HIKE_RUN" || c.variant === "EASY_TRAIL_TERRAIN") score += 120;
  }

  if (enduranceGoal) {
    if (c.variant === "EASY_PROGRESSIVE_FINISH") score -= 35;
    if (c.variant === "AEROBIC_BASE_RUN") score -= 30;
    if (c.variant === "EASY_PLUS_STRIDES") score -= 10;
    if (c.variant === "EASY_PLUS_DRILLS") score += 20;
  }

  if (ultraGoal) {
    if (c.variant === "EASY_TRAIL_TERRAIN" || c.variant === "EASY_HIKE_RUN") score -= 40;
    if (c.variant === "BACK_TO_BACK_EASY_LONG") score -= 35;
  }

  if (phase === "base") {
    if (c.variant === "EASY_PLUS_DRILLS") score -= 20;
    if (c.variant === "EASY_PROGRESSIVE_FINISH") score += 40;
  }
  if (phase === "build") {
    if (c.variant === "EASY_PROGRESSIVE_FINISH") score -= 25;
  }
  if (phase === "specific") {
    if (c.variant === "AEROBIC_BASE_RUN") score -= 20;
    if (c.variant === "EASY_PLUS_DRILLS") score += 20;
  }

  if (wkKm < 18) {
    if (c.variant === "EASY_PROGRESSIVE_FINISH" || c.variant === "EASY_HIKE_RUN") score += 500;
    if (c.variant === "STANDARD_EASY") score -= 40;
  }

  if (
    isDeload &&
    c.variant !== "STANDARD_EASY" &&
    c.variant !== "RECOVERY_RUN" &&
    c.variant !== "EASY_PLUS_STRIDES_LIGHT"
  ) {
    score += 5000;
  }

  return score + stress * 10;
}

function pickBestCandidate({ candidates, seed, ...ctx }) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return baseEasyOnly(ctx.goal);

  const scored = list.map((c, idx) => {
    const s = scoreCandidate({ c, ...ctx });
    const tie = ((seed + idx) % 11) * 9;
    return { c, s: s + tie };
  });

  scored.sort((a, b) => a.s - b.s);
  return scored[0]?.c || baseEasyOnly(ctx.goal);
}

export function buildEasyAddOn({
  weekIndex,
  totalWeeks,
  isDeload = false,
  profile,
  day,
  runDays,
  longRunDay,
  spec, // optional
  stridesCountSoFar = 0, // optional
} = {}) {
  const exp = normExperience(profile);
  const advanced = exp === "advanced";
  const regular = exp === "regular";
  const newer = exp === "new";

  const wkKm = getWeeklyKm(profile);
  const goal = normGoalDistance(profile);

  const tw = totalWeeks || getTotalWeeks(profile, 12);
  const phase = getPhase(weekIndex, tw);
  const w = Math.max(1, Number(weekIndex || 1));

  const addonDay = isPreferredAddOnDay({ day, longRunDay, runDays });

  const candidates = buildCandidates({
    w,
    phase,
    goal,
    wkKm,
    advanced,
    regular,
    newer,
    isDeload: !!isDeload,
    day,
    runDays,
    longRunDay,
    spec,
    stridesCountSoFar,
  });

  const salt =
    goal === "5K" || goal === "10K" ? 7 :
    goal === "HALF" || goal === "MARATHON" || goal === "ULTRA" ? 13 :
    11;

  const seed = stablePickSeed(w, day, salt);

  const best = pickBestCandidate({
    candidates,
    seed,
    phase,
    goal,
    wkKm,
    advanced,
    regular,
    newer,
    isDeload: !!isDeload,
    addonDay,
  });

  const { _meta, ...publicPick } = best || baseEasyOnly(goal);

  return {
    variant: publicPick.variant || "STANDARD_EASY",
    keyTargets: publicPick.keyTargets || "Easy pace range",
    notes: publicPick.notes || "Easy effort. Keep it relaxed.",
    includeStrides: !!publicPick.includeStrides,
    strides: publicPick.strides || null,
    steadyFinish: publicPick.steadyFinish || null,
    drills: publicPick.drills || null,
    recommendedMinutes: publicPick.recommendedMinutes || null,
    terrainHint: publicPick.terrainHint || null,
    effortHint: publicPick.effortHint || null,
  };
}
