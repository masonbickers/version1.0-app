// server/lib/train/planRules/progression.js
import {
  goalKeyToByDistanceKey,
  normaliseGoalDistanceKey,
  normaliseSessionsPerWeek,
  normaliseProgressionDifficulty,
  progressionDifficultyToPublic,
} from "./normalization.js";
import { RULES } from "./rulesConfig.js";

// ----------------- helpers -----------------
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toPosNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

// Heuristic: ramp specificity as you approach race.
function computeRaceSpecificity(w, W, diff) {
  if (W <= 1) return 0.4;
  const t = (w - 1) / (W - 1); // 0..1
  let spec = 0.35 + 0.55 * t;
  if (diff === "conservative") spec -= 0.08;
  if (diff === "aggressive") spec += 0.06;
  if (diff === "elite") spec += 0.1;
  return clamp01(spec);
}

function computeLevel({ w, W, diff, kind }) {
  if (W <= 1) return 1;
  const t = (w - 1) / (W - 1); // 0..1
  let base = 1;

  if (kind === "intervals") base = 1 + 3.2 * t;
  if (kind === "threshold") base = 1 + 3.0 * t;
  if (kind === "longQuality") base = 0.8 + 3.0 * t;

  if (diff === "conservative") base -= 0.35;
  if (diff === "aggressive") base += 0.35;
  if (diff === "elite") base += 0.6;

  return clampInt(Math.round(base), 0, 6);
}

function computeLongRunQualityFlag({ w, W, diff, isDeload, inTaper, sessionsPerWeek }) {
  const spw = normaliseSessionsPerWeek(sessionsPerWeek);
  if (spw <= 1) return { qualityOnLongRun: false, longQualityLevel: 0 };

  if (diff === "conservative") return { qualityOnLongRun: false, longQualityLevel: 0 };
  if (inTaper) return { qualityOnLongRun: false, longQualityLevel: 0 };
  if (isDeload) return { qualityOnLongRun: false, longQualityLevel: 0 };

  const everyOther = w % 2 === 0;

  if (diff === "standard") {
    const on = spw >= 4 ? everyOther : false;
    return { qualityOnLongRun: on, longQualityLevel: on ? 1 : 0 };
  }
  if (diff === "aggressive") {
    const late = w >= Math.max(3, Math.floor(W * 0.5));
    const on = spw >= 4 ? (everyOther || (late && w % 3 === 0)) : everyOther;
    return { qualityOnLongRun: on, longQualityLevel: on ? 2 : 0 };
  }
  if (diff === "elite") {
    const late = w >= Math.max(3, Math.floor(W * 0.4));
    const on = spw >= 4 ? (everyOther || (late && w % 3 === 0)) : everyOther;
    return { qualityOnLongRun: on, longQualityLevel: on ? 3 : 0 };
  }

  return { qualityOnLongRun: false, longQualityLevel: 0 };
}

function computeIntensityPriority({ inTaper, diff }) {
  if (!inTaper) return "normal";
  if (diff === "conservative") return "moderate";
  return "high";
}

// -----------------------------
// Caps by goal + frequency
// -----------------------------
function getWeeklyCapMultiplier({ diff, sessionsPerWeek, goal }) {
  const cfg = RULES?.progressionPolicy || {};
  const spw = normaliseSessionsPerWeek(sessionsPerWeek);

  const byDiff = cfg?.weeklyCapMultiplierByDifficulty || {};
  let m =
    toNum(byDiff?.[diff]) ??
    (diff === "conservative"
      ? 1.15
      : diff === "aggressive"
      ? 1.35
      : diff === "elite"
      ? 1.45
      : 1.25);

  const bySpw = cfg?.weeklyCapMultiplierBySessionsPerWeek || {};
  const spwCap = toNum(bySpw?.[String(spw)]);
  if (spwCap != null) {
    m = Math.min(m, spwCap);
  } else {
    if (spw <= 3) m = Math.min(m, 1.18);
    if (spw === 4) m = Math.min(m, 1.3);
  }

  const byGoal = cfg?.weeklyCapMultiplierByGoalMax || {};
  const goalCap = toNum(byGoal?.[goal]);
  if (goalCap != null) {
    m = Math.min(m, goalCap);
  } else {
    if (goal === "10K") m = Math.min(m, 1.3);
    if (goal === "5K") m = Math.min(m, 1.25);
  }

  return m;
}

function getLongRunAbsMax({ goal }) {
  const map = RULES?.progressionPolicy?.longRunAbsMaxByGoal || {};
  const cfg = toNum(map?.[goal]);
  if (cfg != null) return cfg;
  if (goal === "5K") return 16;
  if (goal === "10K") return 20;
  if (goal === "HALF") return 28;
  if (goal === "MARATHON") return 35;
  if (goal === "ULTRA") return 45;
  return null;
}
function getLongRunMaxPct({ goal, basePct }) {
  const map = RULES?.progressionPolicy?.longRunMaxPctByGoalMax || {};
  const cfg = toNum(map?.[goal]);
  if (cfg != null) return Math.min(basePct, cfg);
  if (goal === "5K") return Math.min(basePct, 0.36);
  if (goal === "10K") return Math.min(basePct, 0.38);
  return basePct;
}
function getLongRunMaxIncrease({ goal, baseInc }) {
  const map = RULES?.progressionPolicy?.longRunMaxIncreaseKmByGoalMax || {};
  const cfg = toNum(map?.[goal]);
  if (cfg != null) return Math.min(baseInc, cfg);
  if (goal === "5K") return Math.min(baseInc, 2.0);
  if (goal === "10K") return Math.min(baseInc, 2.0);
  return baseInc;
}

// -----------------------------
// PlanSpec long-run policy
// -----------------------------
function getSpecLongRunPolicy(spec) {
  const lr = spec?.longRun || {};
  return {
    minOfCurrentLongest: toNum(lr.minOfCurrentLongest) ?? null,
    targetWeeklyFraction: toNum(lr.targetWeeklyFraction) ?? null,
    maxKm: toNum(lr.maxKm) ?? null,
    deloadMult: toNum(lr.deloadMult) ?? null,
    taperMult: toNum(lr.taperMult) ?? null,
  };
}

function deriveLongRunFloor({ userLongest, specPolicy, longAbsMin, longAbsMax }) {
  if (userLongest == null) return longAbsMin;
  const frac = specPolicy?.minOfCurrentLongest;
  if (frac == null) return clamp(userLongest, longAbsMin, longAbsMax);
  const floor = userLongest * frac;
  return clamp(floor, longAbsMin, longAbsMax);
}

function deriveLongRunTargetBand({ weeklyTarget, startPct, longMaxPct, specPolicy }) {
  const minByWeekly = weeklyTarget * startPct;
  const maxByWeekly = weeklyTarget * longMaxPct;

  const preferredFrac = specPolicy?.targetWeeklyFraction;
  const preferred = preferredFrac != null ? weeklyTarget * preferredFrac : null;

  return { minByWeekly, maxByWeekly, preferred };
}

function applyWeeklyPctCap({
  longTarget,
  weeklyTarget,
  longMaxPct,
  longAbsMin,
  buildFloor,
  prevBuildLongTarget,
  isBuildWeek,
}) {
  const capByWeekly =
    Number.isFinite(weeklyTarget) && weeklyTarget > 0 ? weeklyTarget * longMaxPct : null;

  let out = longTarget;

  if (capByWeekly != null && Number.isFinite(capByWeekly) && capByWeekly > 0) {
    out = Math.min(out, capByWeekly);
  }

  out = Math.max(longAbsMin, out);

  if (isBuildWeek) {
    const minAllowed = Math.max(buildFloor, prevBuildLongTarget ?? buildFloor);
    out = Math.max(minAllowed, out);
  }

  return out;
}

function normaliseDeterministicPhase(value) {
  const p = String(value || "").toUpperCase().trim();
  if (p === "BASE" || p === "BUILD" || p === "DELOAD" || p === "TAPER") return p;
  // Collapse legacy/alternate naming into BUILD for deterministic modeling.
  if (p === "SPECIFIC") return "BUILD";
  return null;
}

function deriveDeterministicPhaseForWeek({ weekIndex, weeks, taperWeeks, deloadEvery }) {
  const W = Math.max(1, Number(weeks) || 1);
  const i = clampInt(weekIndex, 1, W);
  const taper = clampInt(taperWeeks, 0, 6);
  const deloadN = clampInt(deloadEvery, 2, 8);

  if (taper > 0 && i > W - taper) return "TAPER";
  if (deloadN > 0 && i % deloadN === 0) return "DELOAD";

  const nonTaperWeeks = Math.max(1, W - taper);
  const baseEnd = Math.max(1, Math.round(nonTaperWeeks * 0.25));
  if (i <= baseEnd) return "BASE";
  return "BUILD";
}

export function buildProgressionTargets({
  weeks,
  weeklyKmStart,
  longestRunKmStart,

  difficulty,
  sessionsPerWeek,

  goalDistance,

  // If phases are passed, they are normalized to deterministic model:
  // BASE/BUILD/DELOAD/TAPER (SPECIFIC collapses to BUILD).
  phases, // array like ["BASE","BUILD","DELOAD","TAPER",...], 1-indexed ok too
  taperLastNWeeks, // from deriveInputs (distance-specific)
  longRunMaxKm, // from deriveInputs / RULES.byDistance

  planSpec,
}) {
  const W = Math.max(1, Number(weeks) || 1);
  const targets = [];

  const diff = normaliseProgressionDifficulty(difficulty);
  const goal = normaliseGoalDistanceKey(goalDistance, { fallback: "10K" });
  const distanceKey = goalKeyToByDistanceKey(goal, "10k");

  const specPolicy = getSpecLongRunPolicy(planSpec);

  const weeklyMinKm = toNum(RULES?.weeklyGrowth?.minKm) ?? 8;
  const weeklyMaxPctGrow = toNum(RULES?.weeklyGrowth?.maxPct) ?? 0.1;
  const weeklyMaxKmGrow = toNum(RULES?.weeklyGrowth?.maxKm) ?? 6;
  const startFromUserWeeklyKm = RULES?.weeklyGrowth?.startFromUserWeeklyKm !== false;

  const startPct = toNum(RULES?.longRun?.startPctOfWeekly) ?? 0.3;
  const longMaxPctRule = toNum(RULES?.longRun?.maxPctOfWeekly) ?? 0.4;
  const longMaxPct = getLongRunMaxPct({ goal, basePct: longMaxPctRule });

  const longAbsMin = toNum(RULES?.longRun?.minKm) ?? 6;

  // ✅ unify max long run from: RULES.byDistance -> deriveInputs -> goal caps -> RULES.longRun.maxKm
  const byD = RULES?.byDistance?.[distanceKey] || {};
  const longMaxFromDistance = toNum(byD.longRunMaxKm);
  const longAbsMaxRule = toNum(RULES?.longRun?.maxKmDefault ?? RULES?.longRun?.maxKm) ?? 32;

  const longAbsMaxByGoal = getLongRunAbsMax({ goal });
  let longAbsMax =
    longAbsMaxByGoal != null ? Math.min(longAbsMaxRule, longAbsMaxByGoal) : longAbsMaxRule;

  if (longMaxFromDistance != null) longAbsMax = Math.min(longAbsMax, longMaxFromDistance);
  if (toNum(longRunMaxKm) != null) longAbsMax = Math.min(longAbsMax, toNum(longRunMaxKm));
  if (specPolicy?.maxKm != null) longAbsMax = Math.min(longAbsMax, specPolicy.maxKm);

  const longMaxIncreaseKmRule = toNum(RULES?.longRun?.maxIncreaseKm) ?? 2.5;
  const longMaxIncreaseKm = getLongRunMaxIncrease({ goal, baseInc: longMaxIncreaseKmRule });

  const deloadEvery = clampInt(RULES?.deload?.everyNWeeks ?? 4, 2, 8);
  const deloadReducePct = clamp01(toNum(RULES?.deload?.reducePct) ?? 0.2);
  const deloadAffectsLong = !!RULES?.deload?.deloadAffectsLongRun;

  // ✅ taper length: distance-specific -> deriveInputs -> RULES default
  let taperWeeks =
    clampInt(
      toNum(taperLastNWeeks) ??
        toNum(byD.taperLastNWeeks) ??
        toNum(RULES?.taper?.lastNWeeksDefault ?? RULES?.taper?.lastNWeeks) ??
        1,
      0,
      6
    ) || 0;

  if (taperWeeks > 0 && W <= taperWeeks) taperWeeks = 0;

  const taperReducePctRule = toNum(RULES?.taper?.reducePct);
  const taperByGoal = RULES?.progressionPolicy?.taperReducePctDefaultByGoal || {};
  const taperReducePctDefault =
    toNum(taperByGoal?.[goal]) ??
    toNum(taperByGoal?.default) ??
    (goal === "10K" || goal === "5K" ? 0.35 : 0.25);
  const taperReducePct = clamp01(taperReducePctRule ?? taperReducePctDefault);

  const spw = normaliseSessionsPerWeek(sessionsPerWeek);

  // -----------------------------
  // Baselines
  // -----------------------------
  const userWeekly = toPosNum(weeklyKmStart);
  const userLongest = toPosNum(longestRunKmStart);

  let weeklyStart = startFromUserWeeklyKm
    ? Math.max(weeklyMinKm, userWeekly ?? weeklyMinKm)
    : Math.max(weeklyMinKm, weeklyMinKm);

  weeklyStart = round1(weeklyStart);

  const weeklyCapMultiplier = getWeeklyCapMultiplier({ diff, sessionsPerWeek: spw, goal });
  const weeklyAbsCap = userWeekly != null ? round1(userWeekly * weeklyCapMultiplier) : null;

  const longFloor = deriveLongRunFloor({
    userLongest,
    specPolicy,
    longAbsMin,
    longAbsMax,
  });

  const startBand = deriveLongRunTargetBand({
    weeklyTarget: weeklyStart,
    startPct,
    longMaxPct,
    specPolicy,
  });

  let baseLong = Math.max(longFloor, startBand.minByWeekly, longAbsMin);
  baseLong = clamp(baseLong, longAbsMin, longAbsMax);
  baseLong = round1(baseLong);

  let prevLongTarget = baseLong;
  let prevBuildWeeklyTarget = null;
  let prevBuildLongTarget = baseLong;

  const normalizedPhases = Array.isArray(phases)
    ? phases.map((p) => normaliseDeterministicPhase(p))
    : null;
  const phaseAt = (w) => {
    if (!Array.isArray(normalizedPhases)) return null;
    return normalizedPhases[w - 1] || normalizedPhases[w] || null;
  };
  const explicitTaperWeeks = Array.isArray(normalizedPhases)
    ? normalizedPhases.filter((p) => p === "TAPER").length
    : 0;
  const explicitTaperOrdinalAt = (w) => {
    if (!Array.isArray(normalizedPhases) || w < 1) return 0;
    let k = 0;
    for (let i = 0; i < Math.min(w, normalizedPhases.length); i++) {
      if (normalizedPhases[i] === "TAPER") k += 1;
    }
    return k;
  };

  for (let w = 1; w <= W; w++) {
    const explicitPhase = phaseAt(w);
    const phase =
      explicitPhase ||
      deriveDeterministicPhaseForWeek({
        weekIndex: w,
        weeks: W,
        taperWeeks,
        deloadEvery,
      });
    const hasExplicitPhase = !!explicitPhase;
    const isTaper = phase === "TAPER";
    const isDeload = phase === "DELOAD";

    const isBuildWeek = !isDeload && !isTaper;

    // -----------------------------
    // Weekly target (simplified):
    // 1) growth rule on BASE/BUILD
    // 2) deload rule on DELOAD
    // 3) taper rule on TAPER
    // -----------------------------
    const prevWeekly = targets.length > 0 ? toNum(targets[targets.length - 1]?.weeklyKm) : null;
    const growthBase = prevWeekly != null ? prevWeekly : weeklyStart;
    const maxGrow = Math.min(growthBase * weeklyMaxPctGrow, weeklyMaxKmGrow);

    let weeklyTarget;
    if (isBuildWeek) {
      // Growth rule.
      weeklyTarget = w === 1 ? weeklyStart : growthBase + maxGrow;
    } else if (isDeload) {
      // Deload rule.
      const deloadBase = prevBuildWeeklyTarget ?? growthBase;
      weeklyTarget = deloadBase * (1 - deloadReducePct);
    } else {
      // Taper rule.
      const taperBase = prevBuildWeeklyTarget ?? growthBase;
      const taperSpan = explicitTaperWeeks > 0 ? explicitTaperWeeks : taperWeeks;
      const taperWeekIndex =
        hasExplicitPhase && phase === "TAPER"
          ? explicitTaperOrdinalAt(w)
          : (w - (W - taperWeeks));
      const taperProgress = taperSpan > 0 ? clamp01(taperWeekIndex / taperSpan) : 1;
      weeklyTarget = taperBase * (1 - taperReducePct * taperProgress);
    }

    weeklyTarget = round1(Math.max(weeklyMinKm, weeklyTarget));
    if (weeklyAbsCap != null) weeklyTarget = round1(Math.min(weeklyTarget, weeklyAbsCap));

    // -----------------------------
    // Long run target
    // -----------------------------
    let longTarget = 0;
    if (spw === 1) {
      // Single-run weeks: the only run carries the whole weekly budget.
      longTarget = round1(Math.max(0, weeklyTarget));
    } else {
      const band = deriveLongRunTargetBand({
        weeklyTarget,
        startPct,
        longMaxPct,
        specPolicy,
      });

      const specDeloadMult = specPolicy?.deloadMult;
      const specTaperMult = specPolicy?.taperMult;

      let longCandidate;

      if (w === 1) {
        if (isDeload && deloadAffectsLong) {
          longCandidate =
            prevLongTarget * (specDeloadMult != null ? specDeloadMult : (1 - deloadReducePct));
        } else if (isTaper) {
          const specCeil = specTaperMult != null ? specTaperMult : 1;
          longCandidate = prevLongTarget * specCeil;
        } else {
          longCandidate = prevLongTarget;
        }
      } else if (isDeload && deloadAffectsLong) {
        const base = prevBuildLongTarget != null ? prevBuildLongTarget : prevLongTarget;
        longCandidate = base * (specDeloadMult != null ? specDeloadMult : (1 - deloadReducePct));
      } else if (isTaper) {
        const base = prevBuildLongTarget != null ? prevBuildLongTarget : prevLongTarget;
        const taperSpan = explicitTaperWeeks > 0 ? explicitTaperWeeks : taperWeeks;
        const taperWeekIndex =
          hasExplicitPhase && phase === "TAPER"
            ? explicitTaperOrdinalAt(w)
            : (w - (W - taperWeeks));
        const taperProgress = taperSpan > 0 ? clamp01(taperWeekIndex / taperSpan) : 1;
        const taperFactor = 1 - taperReducePct * taperProgress;

        const specCeil = specTaperMult != null ? specTaperMult : 1;
        longCandidate = base * Math.min(specCeil, taperFactor);
      } else {
        const base = prevBuildLongTarget != null ? prevBuildLongTarget : prevLongTarget;
        longCandidate = base + longMaxIncreaseKm;
      }

      const buildFloor = isBuildWeek ? longFloor : longAbsMin;

      longTarget = longCandidate;

      if (isBuildWeek && band.preferred != null) {
        longTarget = 0.7 * longCandidate + 0.3 * band.preferred;
      }

      longTarget = clamp(longTarget, longAbsMin, longAbsMax);

      longTarget = applyWeeklyPctCap({
        longTarget,
        weeklyTarget,
        longMaxPct,
        longAbsMin,
        buildFloor,
        prevBuildLongTarget,
        isBuildWeek,
      });

      if (w > 1 && isBuildWeek && prevBuildLongTarget != null) {
        const maxAllowed = prevBuildLongTarget + longMaxIncreaseKm;
        longTarget = Math.min(longTarget, maxAllowed);
        longTarget = clamp(longTarget, longAbsMin, longAbsMax);

        longTarget = applyWeeklyPctCap({
          longTarget,
          weeklyTarget,
          longMaxPct,
          longAbsMin,
          buildFloor,
          prevBuildLongTarget,
          isBuildWeek,
        });
      }

      longTarget = round1(longTarget);
    }

    // -----------------------------
    // Signals
    // -----------------------------
    const raceSpecificity = computeRaceSpecificity(w, W, diff);
    const intervalLevel = computeLevel({ w, W, diff, kind: "intervals" });
    const thresholdLevel = computeLevel({ w, W, diff, kind: "threshold" });

    const { qualityOnLongRun, longQualityLevel } = computeLongRunQualityFlag({
      w,
      W,
      diff,
      isDeload,
      inTaper: isTaper,
      sessionsPerWeek: spw,
    });

    const intensityPriority = computeIntensityPriority({ inTaper: isTaper, diff });

    const isPeakWindow =
      !isTaper && !isDeload && W >= 4 && w >= Math.max(3, Math.floor(W * 0.6));

    targets.push({
      weekIndex: w,
      weeklyKm: weeklyTarget,
      longRunKm: longTarget,
      isDeload,
      isTaper: !!isTaper,
      phase,

      difficulty: progressionDifficultyToPublic(diff),
      progression: {
        raceSpecificity,
        intervalLevel,
        thresholdLevel,
        qualityOnLongRun,
        longQualityLevel,
        intensityPriority,
        isPeakWindow,
      },
    });

    prevLongTarget = longTarget;

    if (isBuildWeek) {
      prevBuildWeeklyTarget = weeklyTarget;
      prevBuildLongTarget = longTarget;
    }
  }

  return targets;
}
