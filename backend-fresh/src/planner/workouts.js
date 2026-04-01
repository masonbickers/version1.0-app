import { makeSessionId, round1, roundInt } from "./utils.js";

const INTERVAL_LIBRARY = {
  base: [
    { id: "10x200m", kind: "repeat_distance", reps: 10, workM: 200, recoverSec: 45, label: "10x200m (rec 45s)", tags: ["speed", "economy"] },
    { id: "8x300m", kind: "repeat_distance", reps: 8, workM: 300, recoverSec: 60, label: "8x300m (rec 60s)", tags: ["speed", "economy"] },
    { id: "8x400m", kind: "repeat_distance", reps: 8, workM: 400, recoverSec: 75, label: "8x400m (rec 75s)", tags: ["speed", "vo2"] },
    { id: "6x600m", kind: "repeat_distance", reps: 6, workM: 600, recoverSec: 90, label: "6x600m (rec 90s)", tags: ["vo2", "10k_support"] },
    { id: "10x1min", kind: "repeat_time", reps: 10, workSec: 60, recoverSec: 60, label: "10x1 min (rec 1 min)", tags: ["speed", "economy"] }
  ],
  build: [
    { id: "12x400m", kind: "repeat_distance", reps: 12, workM: 400, recoverSec: 75, label: "12x400m (rec 75s)", tags: ["speed", "vo2"] },
    { id: "10x500m", kind: "repeat_distance", reps: 10, workM: 500, recoverSec: 75, label: "10x500m (rec 75s)", tags: ["vo2"] },
    { id: "6x800m", kind: "repeat_distance", reps: 6, workM: 800, recoverSec: 120, label: "6x800m (rec 2 min)", tags: ["vo2", "10k_support"] },
    { id: "5x1000m", kind: "repeat_distance", reps: 5, workM: 1000, recoverSec: 150, label: "5x1000m (rec 150s)", tags: ["10k_support", "vo2"] },
    { id: "4x1200m", kind: "repeat_distance", reps: 4, workM: 1200, recoverSec: 150, label: "4x1200m (rec 150s)", tags: ["10k_support"] },
    { id: "3x1600m", kind: "repeat_distance", reps: 3, workM: 1600, recoverSec: 180, label: "3x1600m (rec 3 min)", tags: ["10k_support"] },
    {
      id: "ladder_400_800_1200_800_400",
      kind: "ladder_distance",
      label: "400-800-1200-800-400m ladder",
      tags: ["speed", "vo2", "economy"],
      steps: [
        { workM: 400, recoverSec: 60 },
        { workM: 800, recoverSec: 90 },
        { workM: 1200, recoverSec: 120 },
        { workM: 800, recoverSec: 90 },
        { workM: 400, recoverSec: 60 }
      ]
    },
    {
      id: "ladder_200_400_600_800_600_400_200",
      kind: "ladder_distance",
      label: "200-400-600-800-600-400-200m ladder",
      tags: ["speed", "economy"],
      steps: [
        { workM: 200, recoverSec: 45 },
        { workM: 400, recoverSec: 60 },
        { workM: 600, recoverSec: 75 },
        { workM: 800, recoverSec: 90 },
        { workM: 600, recoverSec: 75 },
        { workM: 400, recoverSec: 60 },
        { workM: 200, recoverSec: 45 }
      ]
    },
    { id: "8x90s", kind: "repeat_time", reps: 8, workSec: 90, recoverSec: 75, label: "8x90s (rec 75s)", tags: ["vo2", "economy"] },
    { id: "6x2min", kind: "repeat_time", reps: 6, workSec: 120, recoverSec: 90, label: "6x2 min (rec 90s)", tags: ["vo2", "10k_support"] }
  ],
  deload: [
    { id: "6x200m", kind: "repeat_distance", reps: 6, workM: 200, recoverSec: 60, label: "6x200m (rec 60s)", tags: ["light", "speed", "economy"] },
    { id: "4x400m", kind: "repeat_distance", reps: 4, workM: 400, recoverSec: 75, label: "4x400m (rec 75s)", tags: ["light", "speed"] },
    { id: "3x800m", kind: "repeat_distance", reps: 3, workM: 800, recoverSec: 160, label: "3x800m (rec 160s)", tags: ["light", "vo2"] }
  ],
  taper: [
    { id: "4x200m", kind: "repeat_distance", reps: 4, workM: 200, recoverSec: 60, label: "4x200m (rec 60s)", tags: ["sharpen", "speed", "economy"] },
    { id: "3x400m", kind: "repeat_distance", reps: 3, workM: 400, recoverSec: 75, label: "3x400m (rec 75s)", tags: ["sharpen", "speed"] },
    { id: "3x900m", kind: "repeat_distance", reps: 3, workM: 900, recoverSec: 160, label: "3x900m (rec 160s)", tags: ["sharpen", "10k_support"] },
    { id: "4x60s", kind: "repeat_time", reps: 4, workSec: 60, recoverSec: 75, label: "4x60s (rec 75s)", tags: ["sharpen", "economy"] }
  ]
};

const THRESHOLD_LIBRARY = {
  base: [
    { id: "16min_tempo", kind: "continuous", sec: 960, label: "16 min tempo", tags: ["tempo", "controlled"] },
    { id: "20min_tempo", kind: "continuous", sec: 1200, label: "20 min tempo", tags: ["tempo", "controlled"] },
    { id: "3x8min", kind: "repeat", reps: 3, workSec: 480, recoverSec: 90, label: "3x8 min (rec 90s)", tags: ["cruise", "steady_threshold"] },
    { id: "4x5min", kind: "repeat", reps: 4, workSec: 300, recoverSec: 60, label: "4x5 min (rec 60s)", tags: ["tempo", "light"] },
    { id: "20min_progression", kind: "progression", sec: 1200, label: "20 min progression", tags: ["progression", "controlled"] }
  ],
  build: [
    { id: "25min_tempo", kind: "continuous", sec: 1500, label: "25 min tempo", tags: ["tempo", "steady_threshold"] },
    { id: "30min_tempo", kind: "continuous", sec: 1800, label: "30 min tempo", tags: ["tempo", "steady_threshold"] },
    { id: "3x10min", kind: "repeat", reps: 3, workSec: 600, recoverSec: 90, label: "3x10 min (rec 90s)", tags: ["cruise", "steady_threshold"] },
    { id: "2x15min", kind: "repeat", reps: 2, workSec: 900, recoverSec: 90, label: "2x15 min (rec 90s)", tags: ["steady_threshold", "tempo"] },
    { id: "4x2k_cruise", kind: "cruise_distance", reps: 4, workM: 2000, recoverSec: 75, label: "4x2km cruise (rec 75s)", tags: ["cruise", "steady_threshold"] },
    { id: "5x1k_cruise", kind: "cruise_distance", reps: 5, workM: 1000, recoverSec: 60, label: "5x1km cruise (rec 60s)", tags: ["cruise", "tempo"] },
    { id: "25min_progression", kind: "progression", sec: 1500, label: "25 min progression", tags: ["progression"] },
    { id: "30min_progression", kind: "progression", sec: 1800, label: "30 min progression", tags: ["progression"] },
    { id: "3x12min", kind: "repeat", reps: 3, workSec: 720, recoverSec: 90, label: "3x12 min (rec 90s)", tags: ["steady_threshold"] },
    { id: "35min_tempo", kind: "continuous", sec: 2100, label: "35 min tempo", tags: ["steady_threshold"] }
  ],
  deload: [
    { id: "12min_tempo", kind: "continuous", sec: 720, label: "12 min tempo", tags: ["light", "controlled"] },
    { id: "2x6min", kind: "repeat", reps: 2, workSec: 360, recoverSec: 60, label: "2x6 min (rec 60s)", tags: ["light", "tempo"] },
    { id: "2x3min", kind: "repeat", reps: 2, workSec: 180, recoverSec: 60, label: "2x3 min (rec 1 min)", tags: ["light"] }
  ],
  taper: [
    { id: "10min_tempo", kind: "continuous", sec: 600, label: "10 min tempo", tags: ["controlled", "tempo"] },
    { id: "12min_tempo", kind: "continuous", sec: 720, label: "12 min tempo", tags: ["controlled", "tempo"] },
    { id: "2x5min", kind: "repeat", reps: 2, workSec: 300, recoverSec: 75, label: "2x5 min (rec 75s)", tags: ["controlled", "light"] }
  ]
};

const EASY_SUBTYPES = new Set([
  "recovery",
  "aerobic_easy",
  "steady_easy",
  "shakeout"
]);

const LONG_SUBTYPES = new Set([
  "long_easy",
  "long_progressive",
  "long_fast_finish",
  "long_marathon_blocks",
  "long_steady"
]);

const FIT_POLICY = {
  goodFitMinRatio: 0.82,
  goodFitMaxRatio: 1.08,
  acceptableFitMinRatio: 0.74,
  acceptableFitMaxRatio: 1.15
};

function midpointPaceSecPerKm(range, fallback) {
  if (!range || typeof range !== "object") return fallback;
  const min = Number(range.minSecPerKm);
  const max = Number(range.maxSecPerKm);
  if (Number.isFinite(min) && Number.isFinite(max)) return (min + max) / 2;
  if (Number.isFinite(min)) return min;
  if (Number.isFinite(max)) return max;
  return fallback;
}

function metersFromTime(sec, secPerKm) {
  if (!Number.isFinite(sec) || sec <= 0 || !Number.isFinite(secPerKm) || secPerKm <= 0) return 0;
  return roundInt((sec / secPerKm) * 1000);
}

function distanceMeters(km) {
  return roundInt((Number(km) || 0) * 1000);
}

function splitDistanceKm(totalKm, weights) {
  const total = round1(Math.max(0, Number(totalKm) || 0));
  const source = Array.isArray(weights) && weights.length ? weights : [1];
  const clean = source.map((w) => Math.max(0, Number(w) || 0));
  const denom = clean.reduce((sum, x) => sum + x, 0);

  if (total <= 0) return clean.map(() => 0);
  if (denom <= 0) return [total];

  const parts = clean.map((w) => round1((total * w) / denom));
  const sum = round1(parts.reduce((acc, x) => acc + x, 0));
  const drift = round1(total - sum);

  if (parts.length) {
    parts[parts.length - 1] = round1(parts[parts.length - 1] + drift);
  }

  return parts;
}

function compactSteps(steps) {
  return (Array.isArray(steps) ? steps : []).filter((step) => {
    if (!step) return false;
    if (step.durationType === "distance") return Number(step.durationValue) > 0;
    if (step.durationType === "time") return Number(step.durationValue) > 0;
    return true;
  });
}

function distanceStep(km, targetType, targetValue, stepType = "steady") {
  const meters = distanceMeters(km);
  return {
    stepType,
    durationType: "distance",
    durationValue: meters,
    targetType,
    targetValue
  };
}

function formatRecoveryLabel(recoverSec) {
  return recoverSec >= 120
    ? `rec ${Math.round(recoverSec / 60)} min`
    : `rec ${recoverSec}s`;
}

function formatIntervalLabel(variant) {
  if (variant.kind === "repeat_distance") {
    return `${variant.reps}x${variant.workM}m (${formatRecoveryLabel(variant.recoverSec)})`;
  }
  if (variant.kind === "repeat_time") {
    const workText =
      variant.workSec % 60 === 0
        ? `${Math.round(variant.workSec / 60)} min`
        : `${variant.workSec}s`;
    return `${variant.reps}x${workText} (${formatRecoveryLabel(variant.recoverSec)})`;
  }
  if (variant.kind === "ladder_distance") {
    const main = variant.steps.map((s) => `${s.workM}m`).join("-");
    return `${main} ladder`;
  }
  return variant.label || "Intervals";
}

function formatThresholdLabel(variant) {
  if (variant.kind === "continuous") {
    return `${Math.round(variant.sec / 60)} min tempo`;
  }
  if (variant.kind === "progression") {
    return `${Math.round(variant.sec / 60)} min progression`;
  }
  if (variant.kind === "repeat") {
    const workText =
      variant.workSec % 60 === 0
        ? `${Math.round(variant.workSec / 60)} min`
        : `${variant.workSec}s`;
    return `${variant.reps}x${workText} (${formatRecoveryLabel(variant.recoverSec)})`;
  }
  if (variant.kind === "cruise_distance") {
    return `${variant.reps}x${round1(variant.workM / 1000)}km cruise (${formatRecoveryLabel(variant.recoverSec)})`;
  }
  return variant.label || "Threshold";
}

function estimateIntervalSessionMeters(variant, paces, warmupMin, cooldownMin) {
  const easyPace = midpointPaceSecPerKm(paces?.easy, 450);
  const intervalPace = midpointPaceSecPerKm(paces?.interval, 315);

  const warmupM = metersFromTime((warmupMin || 0) * 60, easyPace);
  const cooldownM = metersFromTime((cooldownMin || 0) * 60, easyPace);

  let mainM = 0;
  let recoveryM = 0;

  if (variant.kind === "repeat_distance") {
    mainM = roundInt((variant.reps || 0) * (variant.workM || 0));
    recoveryM = metersFromTime((variant.reps || 0) * (variant.recoverSec || 0), easyPace);
  } else if (variant.kind === "repeat_time") {
    mainM = metersFromTime((variant.reps || 0) * (variant.workSec || 0), intervalPace);
    recoveryM = metersFromTime((variant.reps || 0) * (variant.recoverSec || 0), easyPace);
  } else if (variant.kind === "ladder_distance") {
    mainM = roundInt((variant.steps || []).reduce((sum, s) => sum + (s.workM || 0), 0));
    recoveryM = metersFromTime(
      (variant.steps || []).reduce((sum, s) => sum + (s.recoverSec || 0), 0),
      easyPace
    );
  }

  return roundInt(warmupM + mainM + recoveryM + cooldownM);
}

function estimateThresholdSessionMeters(variant, paces, warmupMin, cooldownMin) {
  const easyPace = midpointPaceSecPerKm(paces?.easy, 450);
  const tempoPace = midpointPaceSecPerKm(paces?.tempo, 345);

  const warmupM = metersFromTime((warmupMin || 0) * 60, easyPace);
  const cooldownM = metersFromTime((cooldownMin || 0) * 60, easyPace);

  let mainM = 0;
  let recoveryM = 0;

  if (variant.kind === "continuous" || variant.kind === "progression") {
    mainM = metersFromTime(variant.sec || 0, tempoPace);
  } else if (variant.kind === "repeat") {
    mainM = metersFromTime((variant.reps || 0) * (variant.workSec || 0), tempoPace);
    recoveryM = metersFromTime((variant.reps || 0) * (variant.recoverSec || 0), easyPace);
  } else if (variant.kind === "cruise_distance") {
    mainM = roundInt((variant.reps || 0) * (variant.workM || 0));
    recoveryM = metersFromTime((variant.reps || 0) * (variant.recoverSec || 0), easyPace);
  }

  return roundInt(warmupM + mainM + recoveryM + cooldownM);
}

function scoreVariantToBudget(estimatedMeters, budgetMeters) {
  if (!Number.isFinite(estimatedMeters) || estimatedMeters <= 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(budgetMeters) || budgetMeters <= 0) return estimatedMeters;

  const ratio = estimatedMeters / budgetMeters;
  const distancePenalty = Math.abs(1 - ratio) * 1000;
  const overshootPenalty = ratio > 1.15 ? (ratio - 1.15) * 2500 : 0;
  const undershootPenalty = ratio < 0.6 ? (0.6 - ratio) * 1600 : 0;

  return distancePenalty + overshootPenalty + undershootPenalty;
}

function estimateRatio(variant, estimateFn, budgetMeters) {
  if (!Number.isFinite(budgetMeters) || budgetMeters <= 0) return 1;
  const estimate = estimateFn(variant);
  if (!Number.isFinite(estimate) || estimate <= 0) return 99;
  return estimate / budgetMeters;
}

function chooseClosestVariant(candidates, weekNumber, estimateFn, budgetMeters) {
  const scored = candidates
    .map((variant) => {
      const estimate = estimateFn(variant);
      const ratio = budgetMeters > 0 ? estimate / budgetMeters : 1;
      return {
        variant,
        estimate,
        ratio,
        score: scoreVariantToBudget(estimate, budgetMeters)
      };
    })
    .sort((a, b) => a.score - b.score);

  const goodFits = scored.filter(
    ({ ratio }) => ratio >= FIT_POLICY.goodFitMinRatio && ratio <= FIT_POLICY.goodFitMaxRatio
  );
  if (goodFits.length) {
    return goodFits[(Math.max(1, weekNumber) - 1) % Math.min(3, goodFits.length)].variant;
  }

  const acceptableFits = scored.filter(
    ({ ratio }) => ratio >= FIT_POLICY.acceptableFitMinRatio && ratio <= FIT_POLICY.acceptableFitMaxRatio
  );
  if (acceptableFits.length) {
    return acceptableFits[(Math.max(1, weekNumber) - 1) % Math.min(3, acceptableFits.length)].variant;
  }

  return scored[0]?.variant || candidates[0];
}

function minIntervalRepsAllowed(variant) {
  if (variant.kind === "repeat_distance") {
    if (variant.workM >= 1000) return 3;
    if (variant.workM >= 600) return 4;
    return 5;
  }
  if (variant.kind === "repeat_time") {
    if ((variant.workSec || 0) >= 120) return 4;
    return 5;
  }
  return 1;
}

function minThresholdRepsAllowed(variant) {
  if (variant.kind === "repeat") return 2;
  if (variant.kind === "cruise_distance") return 2;
  return 1;
}

function minThresholdContinuousSec(variant) {
  if (variant.kind === "progression") return 12 * 60;
  return 14 * 60;
}

function intervalTrimWouldBeUgly(next) {
  if (next.kind === "repeat_distance" || next.kind === "repeat_time") {
    return (next.reps || 0) < minIntervalRepsAllowed(next);
  }
  if (next.kind === "ladder_distance") {
    return (next.steps || []).length < 5;
  }
  return false;
}

function thresholdTrimWouldBeUgly(next) {
  if (next.kind === "continuous" || next.kind === "progression") {
    return (next.sec || 0) < minThresholdContinuousSec(next);
  }
  if (next.kind === "repeat" || next.kind === "cruise_distance") {
    return (next.reps || 0) < minThresholdRepsAllowed(next);
  }
  return false;
}

function fitIntervalVariantToDistance(variant, distanceKm, paces, warmupMin, cooldownMin) {
  const budgetM = roundInt((distanceKm || 0) * 1000);
  if (!Number.isFinite(budgetM) || budgetM <= 0) return variant;

  const easyPace = midpointPaceSecPerKm(paces?.easy, 450);
  const intervalPace = midpointPaceSecPerKm(paces?.interval, 315);

  const warmupM = metersFromTime((warmupMin || 0) * 60, easyPace);
  const cooldownM = metersFromTime((cooldownMin || 0) * 60, easyPace);
  const fixedM = warmupM + cooldownM;

  if (variant.kind === "repeat_distance") {
    const recoveryPerRepM = metersFromTime(variant.recoverSec || 0, easyPace);
    const perRepM = (variant.workM || 0) + recoveryPerRepM;
    if (perRepM <= 0) return variant;

    const maxReps = Math.max(1, Math.floor((budgetM - fixedM) / perRepM));
    if (maxReps >= variant.reps) return variant;

    const next = {
      ...variant,
      reps: Math.max(1, maxReps)
    };

    if (intervalTrimWouldBeUgly(next)) return variant;

    return {
      ...next,
      id: `${next.reps}x${variant.workM}m`,
      label: formatIntervalLabel(next)
    };
  }

  if (variant.kind === "repeat_time") {
    const workPerRepM = metersFromTime(variant.workSec || 0, intervalPace);
    const recoveryPerRepM = metersFromTime(variant.recoverSec || 0, easyPace);
    const perRepM = workPerRepM + recoveryPerRepM;
    if (perRepM <= 0) return variant;

    const maxReps = Math.max(1, Math.floor((budgetM - fixedM) / perRepM));
    if (maxReps >= variant.reps) return variant;

    const next = {
      ...variant,
      reps: Math.max(1, maxReps)
    };

    if (intervalTrimWouldBeUgly(next)) return variant;

    return {
      ...next,
      id: `${next.reps}x${variant.workSec}s`,
      label: formatIntervalLabel(next)
    };
  }

  if (variant.kind === "ladder_distance") {
    const trimmed = [];
    let totalM = fixedM;

    for (const step of variant.steps || []) {
      const stepM = (step.workM || 0) + metersFromTime(step.recoverSec || 0, easyPace);
      if (trimmed.length >= 5 && totalM + stepM > budgetM) break;
      trimmed.push(step);
      totalM += stepM;
    }

    const next = { ...variant, steps: trimmed };
    if ((trimmed.length === (variant.steps || []).length) || intervalTrimWouldBeUgly(next)) {
      return variant;
    }

    return {
      ...next,
      id: `${trimmed.map((s) => s.workM).join("_")}_ladder`,
      label: formatIntervalLabel(next)
    };
  }

  return variant;
}

function fitThresholdVariantToDistance(variant, distanceKm, paces, warmupMin, cooldownMin) {
  const budgetM = roundInt((distanceKm || 0) * 1000);
  if (!Number.isFinite(budgetM) || budgetM <= 0) return variant;

  const easyPace = midpointPaceSecPerKm(paces?.easy, 450);
  const tempoPace = midpointPaceSecPerKm(paces?.tempo, 345);

  const warmupM = metersFromTime((warmupMin || 0) * 60, easyPace);
  const cooldownM = metersFromTime((cooldownMin || 0) * 60, easyPace);
  const fixedM = warmupM + cooldownM;

  if (variant.kind === "continuous" || variant.kind === "progression") {
    const maxMainM = Math.max(0, budgetM - fixedM);
    const rawMaxSec = Math.floor((maxMainM / 1000) * tempoPace / 60) * 60;

    if (rawMaxSec >= variant.sec) return variant;

    const allowedMinutes =
      variant.kind === "progression"
        ? [12, 15, 20, 25, 30]
        : [14, 16, 20, 25, 30, 35];

    const allowedSec = allowedMinutes
      .map((min) => min * 60)
      .filter((sec) => sec <= rawMaxSec);

    if (!allowedSec.length) return variant;

    const nextSec = allowedSec[allowedSec.length - 1];
    const next = { ...variant, sec: nextSec };

    if (thresholdTrimWouldBeUgly(next)) return variant;
    if (next.sec === variant.sec) return variant;

    return {
      ...next,
      id: `${Math.round(next.sec / 60)}min_${variant.kind === "progression" ? "progression" : "tempo"}`,
      label: formatThresholdLabel(next)
    };
  }

  if (variant.kind === "repeat") {
    const workPerRepM = metersFromTime(variant.workSec || 0, tempoPace);
    const recoveryPerRepM = metersFromTime(variant.recoverSec || 0, easyPace);
    const perRepM = workPerRepM + recoveryPerRepM;
    if (perRepM <= 0) return variant;

    const reps = Math.max(1, Math.min(Math.floor((budgetM - fixedM) / perRepM), variant.reps));
    if (reps >= variant.reps) return variant;

    const next = {
      ...variant,
      reps
    };

    if (thresholdTrimWouldBeUgly(next)) return variant;

    return {
      ...next,
      id: `${next.reps}x${Math.round(next.workSec / 60)}min`,
      label: formatThresholdLabel(next)
    };
  }

  if (variant.kind === "cruise_distance") {
    const recoveryPerRepM = metersFromTime(variant.recoverSec || 0, easyPace);
    const perRepM = (variant.workM || 0) + recoveryPerRepM;
    if (perRepM <= 0) return variant;

    const reps = Math.max(1, Math.min(Math.floor((budgetM - fixedM) / perRepM), variant.reps));
    if (reps >= variant.reps) return variant;

    const next = {
      ...variant,
      reps
    };

    if (thresholdTrimWouldBeUgly(next)) return variant;

    return {
      ...next,
      id: `${next.reps}x${round1(next.workM / 1000)}k_cruise`,
      label: formatThresholdLabel(next)
    };
  }

  return variant;
}

function normalizeSubtype(subtype, qType, phase) {
  const raw = String(subtype || "").toLowerCase();

  if (qType === "INTERVALS") {
    if (raw) return raw;
    if (phase === "taper") return "sharpen";
    if (phase === "deload") return "light";
    return "vo2";
  }

  if (raw) return raw;
  if (phase === "taper") return "controlled";
  if (phase === "deload") return "light";
  return "tempo";
}

function normalizeEasySubtype(subtype, phase, distanceKm) {
  const raw = String(subtype || "").toLowerCase();
  if (EASY_SUBTYPES.has(raw)) {
    if (raw === "steady_easy" && Number(distanceKm) < 5) return "aerobic_easy";
    if (raw === "shakeout" && Number(distanceKm) > 5) return "aerobic_easy";
    return raw;
  }

  if (phase === "taper" && Number(distanceKm) <= 4) return "shakeout";
  if (phase === "deload") return "recovery";
  return "aerobic_easy";
}

function longVariantDistanceGuard(subtype, distanceKm, goalDistance, phase) {
  const km = Number(distanceKm) || 0;
  const goal = String(goalDistance || "").toUpperCase();

  if (phase === "taper" || phase === "deload") return "long_easy";

  if (subtype === "long_progressive" && km < 14) return "long_easy";
  if (subtype === "long_fast_finish" && km < 16) return "long_easy";
  if (subtype === "long_marathon_blocks" && km < 24) return "long_easy";
  if (subtype === "long_steady" && km < 12) return "long_easy";

  if (subtype === "long_marathon_blocks" && goal !== "MARATHON") {
    return km >= 16 ? "long_progressive" : "long_easy";
  }

  return subtype;
}

function normalizeLongSubtype(subtype, phase, goalDistance, distanceKm) {
  const raw = String(subtype || "").toLowerCase();

  let resolved;
  if (LONG_SUBTYPES.has(raw)) {
    resolved = raw;
  } else if (phase === "taper" || phase === "deload") {
    resolved = "long_easy";
  } else if (String(goalDistance || "").toUpperCase() === "MARATHON") {
    resolved = "long_progressive";
  } else {
    resolved = "long_easy";
  }

  return longVariantDistanceGuard(resolved, distanceKm, goalDistance, phase);
}

function intervalCandidatesForPhase(phase) {
  if (phase === "deload") return INTERVAL_LIBRARY.deload;
  if (phase === "taper") return INTERVAL_LIBRARY.taper;
  if (phase === "base") return INTERVAL_LIBRARY.base;
  return INTERVAL_LIBRARY.build;
}

function thresholdCandidatesForPhase(phase) {
  if (phase === "deload") return THRESHOLD_LIBRARY.deload;
  if (phase === "taper") return THRESHOLD_LIBRARY.taper;
  if (phase === "base") return THRESHOLD_LIBRARY.base;
  return THRESHOLD_LIBRARY.build;
}

function filterIntervalCandidates(candidates, subtype, goalDistance, trainingFocus) {
  const subtypeKey = normalizeSubtype(subtype, "INTERVALS");
  let filtered = candidates.filter((v) => Array.isArray(v.tags) && v.tags.includes(subtypeKey));

  if (!filtered.length) {
    if (subtypeKey === "economy" || subtypeKey === "sharpen") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("speed") || v.tags.includes("economy")));
    } else if (subtypeKey === "10k_support") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("10k_support") || v.tags.includes("vo2")));
    } else if (subtypeKey === "light") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("light") || v.tags.includes("speed")));
    } else {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("vo2") || v.tags.includes("speed")));
    }
  }

  if (!filtered.length) filtered = candidates.slice();

  const goal = String(goalDistance || "").toUpperCase();
  const focus = String(trainingFocus || "").toLowerCase();

  if (goal === "MARATHON" || goal === "ULTRA") {
    const longer = filtered.filter((v) => {
      if (v.kind === "repeat_distance") return v.workM >= 600;
      if (v.kind === "repeat_time") return v.workSec >= 90;
      return false;
    });
    if (longer.length && subtypeKey !== "sharpen" && subtypeKey !== "economy") filtered = longer;
  }

  if ((goal === "5K" || focus === "speed") && subtypeKey === "speed") {
    const shorter = filtered.filter((v) => {
      if (v.kind === "repeat_distance") return v.workM <= 400;
      if (v.kind === "repeat_time") return v.workSec <= 75;
      return v.kind === "ladder_distance";
    });
    if (shorter.length) filtered = shorter;
  }

  return filtered;
}

function filterThresholdCandidates(candidates, subtype, goalDistance, trainingFocus) {
  const subtypeKey = normalizeSubtype(subtype, "THRESHOLD");
  let filtered = candidates.filter((v) => Array.isArray(v.tags) && v.tags.includes(subtypeKey));

  if (!filtered.length) {
    if (subtypeKey === "steady_threshold") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("steady_threshold") || v.tags.includes("cruise")));
    } else if (subtypeKey === "cruise") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("cruise") || v.tags.includes("tempo")));
    } else if (subtypeKey === "progression") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("progression") || v.tags.includes("tempo")));
    } else if (subtypeKey === "controlled" || subtypeKey === "light") {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && (v.tags.includes("controlled") || v.tags.includes("light") || v.tags.includes("tempo")));
    } else {
      filtered = candidates.filter((v) => Array.isArray(v.tags) && v.tags.includes("tempo"));
    }
  }

  if (!filtered.length) filtered = candidates.slice();

  const goal = String(goalDistance || "").toUpperCase();
  const focus = String(trainingFocus || "").toLowerCase();

  if ((goal === "MARATHON" || goal === "ULTRA" || focus === "endurance") && subtypeKey === "steady_threshold") {
    const longer = filtered.filter((v) => {
      if (v.kind === "continuous" || v.kind === "progression") return (v.sec || 0) >= 1500;
      if (v.kind === "repeat") return (v.workSec || 0) >= 600;
      if (v.kind === "cruise_distance") return (v.workM || 0) >= 1600;
      return false;
    });
    if (longer.length) filtered = longer;
  }

  if ((goal === "5K" || focus === "speed") && subtypeKey === "tempo") {
    const shorter = filtered.filter((v) => {
      if (v.kind === "continuous" || v.kind === "progression") return (v.sec || 0) <= 1500;
      if (v.kind === "repeat") return (v.workSec || 0) <= 600;
      if (v.kind === "cruise_distance") return (v.workM || 0) <= 1000;
      return false;
    });
    if (shorter.length) filtered = shorter;
  }

  return filtered;
}

function chooseBestIntervalVariant(params) {
  const {
    weekNumber,
    phase,
    distanceKm,
    paces,
    warmupMin,
    cooldownMin,
    workoutSubtype,
    goalDistance,
    trainingFocus
  } = params;

  const candidates = filterIntervalCandidates(
    intervalCandidatesForPhase(phase),
    workoutSubtype,
    goalDistance,
    trainingFocus
  );

  const budgetM = roundInt((distanceKm || 0) * 1000);
  const estimateFn = (variant) => estimateIntervalSessionMeters(variant, paces, warmupMin, cooldownMin);

  const naturalFits = candidates.filter((variant) => {
    const ratio = estimateRatio(variant, estimateFn, budgetM);
    return ratio >= FIT_POLICY.goodFitMinRatio && ratio <= FIT_POLICY.goodFitMaxRatio;
  });

  const basePool = naturalFits.length ? naturalFits : candidates;
  const chosen = chooseClosestVariant(basePool, weekNumber, estimateFn, budgetM);
  const fitted = fitIntervalVariantToDistance(chosen, distanceKm, paces, warmupMin, cooldownMin);

  if (fitted !== chosen) return fitted;

  const alternatePool = candidates.filter((variant) => {
    const ratio = estimateRatio(variant, estimateFn, budgetM);
    return ratio >= FIT_POLICY.acceptableFitMinRatio && ratio <= FIT_POLICY.acceptableFitMaxRatio;
  });

  if (alternatePool.length) {
    return chooseClosestVariant(alternatePool, weekNumber, estimateFn, budgetM);
  }

  return chosen;
}

function chooseBestThresholdVariant(params) {
  const {
    weekNumber,
    phase,
    distanceKm,
    paces,
    warmupMin,
    cooldownMin,
    workoutSubtype,
    goalDistance,
    trainingFocus
  } = params;

  const candidates = filterThresholdCandidates(
    thresholdCandidatesForPhase(phase),
    workoutSubtype,
    goalDistance,
    trainingFocus
  );

  const budgetM = roundInt((distanceKm || 0) * 1000);
  const estimateFn = (variant) => estimateThresholdSessionMeters(variant, paces, warmupMin, cooldownMin);

  const naturalFits = candidates.filter((variant) => {
    const ratio = estimateRatio(variant, estimateFn, budgetM);
    return ratio >= FIT_POLICY.goodFitMinRatio && ratio <= FIT_POLICY.goodFitMaxRatio;
  });

  const basePool = naturalFits.length ? naturalFits : candidates;
  const chosen = chooseClosestVariant(basePool, weekNumber, estimateFn, budgetM);
  const fitted = fitThresholdVariantToDistance(chosen, distanceKm, paces, warmupMin, cooldownMin);

  if (fitted !== chosen) return fitted;

  const alternatePool = candidates.filter((variant) => {
    const ratio = estimateRatio(variant, estimateFn, budgetM);
    return ratio >= FIT_POLICY.acceptableFitMinRatio && ratio <= FIT_POLICY.acceptableFitMaxRatio;
  });

  if (alternatePool.length) {
    return chooseClosestVariant(alternatePool, weekNumber, estimateFn, budgetM);
  }

  return chosen;
}

function qualityNameFromVariant(qType, variant, subtype) {
  if (qType === "INTERVALS") {
    if (subtype === "economy") return "Economy reps";
    if (subtype === "sharpen") return "Sharpening reps";
    if (subtype === "speed") return "Speed session";
    if (subtype === "10k_support") return "Race-pace intervals";
    return "Intervals";
  }

  if (variant.kind === "progression" || subtype === "progression") return "Progression tempo";
  if (variant.kind === "cruise_distance" || subtype === "cruise") return "Cruise intervals";
  if (subtype === "steady_threshold") return "Threshold";
  return "Threshold";
}

function easyNameFromSubtype(subtype) {
  if (subtype === "recovery") return "Recovery run";
  if (subtype === "steady_easy") return "Steady easy run";
  if (subtype === "shakeout") return "Shakeout run";
  return "Easy run";
}

function longNameFromSubtype(subtype) {
  if (subtype === "long_progressive") return "Progressive long run";
  if (subtype === "long_fast_finish") return "Fast-finish long run";
  if (subtype === "long_marathon_blocks") return "Marathon-block long run";
  if (subtype === "long_steady") return "Steady long run";
  return "Long run";
}

function easyNotesFromSubtype(subtype) {
  if (subtype === "recovery") return "Very relaxed aerobic running. Keep the effort low and controlled.";
  if (subtype === "steady_easy") return "Start relaxed, then finish with a controlled steady segment without pushing.";
  if (subtype === "shakeout") return "Very light run to loosen up. Keep it short and relaxed.";
  return "Easy effort. Keep it relaxed.";
}

function longNotesFromSubtype(subtype, phase) {
  if (phase === "deload") return "Keep this long run comfortable and easy.";
  if (phase === "taper") return "Keep this long run comfortable and easy. No heroics.";
  if (subtype === "long_progressive") return "Start easy and gradually build through the run, finishing controlled.";
  if (subtype === "long_fast_finish") return "Run easy early, then finish the final section at a strong but controlled steady effort.";
  if (subtype === "long_marathon_blocks") return "Mostly easy, with controlled marathon-style steady blocks inside the run.";
  if (subtype === "long_steady") return "Keep the run smooth and controlled, spending meaningful time at steady aerobic effort.";
  return "Easy effort throughout. Keep it relaxed and comfortable.";
}

function easyKeyTargetFromSubtype(subtype) {
  if (subtype === "recovery") return "Very easy aerobic";
  if (subtype === "steady_easy") return "Easy + steady finish";
  if (subtype === "shakeout") return "Short easy loosen-up";
  return "Easy pace range";
}

function longKeyTargetFromSubtype(subtype) {
  if (subtype === "long_progressive") return "Progress through the run";
  if (subtype === "long_fast_finish") return "Fast finish";
  if (subtype === "long_marathon_blocks") return "Steady marathon-style blocks";
  if (subtype === "long_steady") return "Easy to steady";
  return "Easy all the way";
}

function baseSession({
  weekNumber,
  ordinal,
  day,
  type,
  name,
  distanceKm,
  notes,
  keyTargets,
  targetPace,
  targetHr,
  workout
}) {
  const finalMeters =
    Number.isFinite(workout?.estimatedDistanceMeters)
      ? roundInt(workout.estimatedDistanceMeters)
      : roundInt((distanceKm || 0) * 1000);

  const finalKm = round1(finalMeters / 1000);

  return {
    sessionId: makeSessionId(weekNumber, day, type, ordinal),
    day,
    type,
    sessionType: type,
    workoutKind: type,
    name,
    distanceKm: finalKm,
    plannedDistanceKm: finalKm,
    distanceMeters: finalMeters,
    notes,
    purpose:
      type === "LONG"
        ? "Aerobic endurance"
        : type === "EASY"
          ? "Aerobic base + recovery"
          : type === "INTERVALS"
            ? "Speed / VO2 / economy"
            : type === "RACE"
              ? "Goal event"
              : "Controlled hard / aerobic power",
    keyTargets,
    targetPace,
    targetHr,
    workout
  };
}

function easyWorkout(distanceKm, paces, hrZones, subtype) {
  const totalKm = round1(Math.max(0, Number(distanceKm) || 0));
  const estimatedDistanceMeters = distanceMeters(totalKm);

  if (subtype === "recovery") {
    return {
      sport: "running",
      kind: "EASY",
      variant: "recovery",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z1 || hrZones?.zones?.z2 || null,
      steps: [
        distanceStep(totalKm, "hr_range", hrZones?.zones?.z1 || hrZones?.zones?.z2 || null)
      ]
    };
  }

  if (subtype === "steady_easy" && totalKm >= 5) {
    const [easyKm, steadyKm] = splitDistanceKm(totalKm, [0.7, 0.3]);
    return {
      sport: "running",
      kind: "EASY",
      variant: "steady_easy",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z2 || null,
      steps: compactSteps([
        distanceStep(easyKm, "hr_range", hrZones?.zones?.z2 || null),
        distanceStep(steadyKm, "pace_range", paces.steady || paces.easy)
      ])
    };
  }

  if (subtype === "shakeout") {
    const easyKm = totalKm >= 4 ? round1(Math.max(1.2, totalKm - 0.4)) : totalKm;
    const steps = [
      distanceStep(easyKm, "hr_range", hrZones?.zones?.z1 || hrZones?.zones?.z2 || null)
    ];

    if (totalKm >= 4) {
      steps.push({
        stepType: "repeat",
        repeatCount: 4,
        steps: [
          {
            stepType: "steady",
            durationType: "time",
            durationValue: 20,
            targetType: "pace_range",
            targetValue: paces.interval || paces.steady || paces.easy
          },
          {
            stepType: "recovery",
            durationType: "time",
            durationValue: 40,
            targetType: "hr_range",
            targetValue: hrZones?.zones?.z1 || null
          }
        ]
      });
    }

    return {
      sport: "running",
      kind: "EASY",
      variant: "shakeout",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z1 || hrZones?.zones?.z2 || null,
      steps: compactSteps(steps)
    };
  }

  return {
    sport: "running",
    kind: "EASY",
    variant: "aerobic_easy",
    estimatedDistanceMeters,
    paceTarget: paces.easy,
    hrTarget: hrZones?.zones?.z2 || null,
    steps: [
      distanceStep(totalKm, "hr_range", hrZones?.zones?.z2 || null)
    ]
  };
}

function longWorkout(distanceKm, paces, hrZones, subtype) {
  const totalKm = round1(Math.max(0, Number(distanceKm) || 0));
  const estimatedDistanceMeters = distanceMeters(totalKm);

  if (subtype === "long_progressive" && totalKm >= 14) {
    const [easy1, steady1, steady2] = splitDistanceKm(totalKm, [0.58, 0.25, 0.17]);
    return {
      sport: "running",
      kind: "LONG",
      variant: "long_progressive",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z2 || null,
      steps: compactSteps([
        distanceStep(easy1, "hr_range", hrZones?.zones?.z2 || null),
        distanceStep(steady1, "pace_range", paces.steady || paces.easy),
        distanceStep(steady2, "pace_range", paces.steady || paces.easy)
      ])
    };
  }

  if (subtype === "long_fast_finish" && totalKm >= 16) {
    const [easyKm, finishKm] = splitDistanceKm(totalKm, [0.78, 0.22]);
    return {
      sport: "running",
      kind: "LONG",
      variant: "long_fast_finish",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z2 || null,
      steps: compactSteps([
        distanceStep(easyKm, "hr_range", hrZones?.zones?.z2 || null),
        distanceStep(finishKm, "pace_range", paces.steady || paces.easy)
      ])
    };
  }

  if (subtype === "long_marathon_blocks" && totalKm >= 24) {
    const [easy1, block1, floatKm, block2, easy2] = splitDistanceKm(totalKm, [0.24, 0.2, 0.12, 0.2, 0.24]);
    return {
      sport: "running",
      kind: "LONG",
      variant: "long_marathon_blocks",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z2 || null,
      steps: compactSteps([
        distanceStep(easy1, "hr_range", hrZones?.zones?.z2 || null),
        distanceStep(block1, "pace_range", paces.steady || paces.easy),
        distanceStep(floatKm, "hr_range", hrZones?.zones?.z2 || null),
        distanceStep(block2, "pace_range", paces.steady || paces.easy),
        distanceStep(easy2, "hr_range", hrZones?.zones?.z2 || null)
      ])
    };
  }

  if (subtype === "long_steady" && totalKm >= 12) {
    const [easyKm, steadyKm] = splitDistanceKm(totalKm, [0.55, 0.45]);
    return {
      sport: "running",
      kind: "LONG",
      variant: "long_steady",
      estimatedDistanceMeters,
      paceTarget: paces.easy,
      hrTarget: hrZones?.zones?.z2 || null,
      steps: compactSteps([
        distanceStep(easyKm, "hr_range", hrZones?.zones?.z2 || null),
        distanceStep(steadyKm, "pace_range", paces.steady || paces.easy)
      ])
    };
  }

  return {
    sport: "running",
    kind: "LONG",
    variant: "long_easy",
    estimatedDistanceMeters,
    paceTarget: paces.easy,
    hrTarget: hrZones?.zones?.z2 || null,
    steps: [
      distanceStep(totalKm, "hr_range", hrZones?.zones?.z2 || null)
    ]
  };
}

function intervalsWorkout(variant, paces, hrZones, warmupMin, cooldownMin) {
  const estimatedDistanceMeters = estimateIntervalSessionMeters(
    variant,
    paces,
    warmupMin,
    cooldownMin
  );

  let mainBlock = null;

  if (variant.kind === "repeat_distance") {
    mainBlock = {
      stepType: "repeat",
      repeatCount: variant.reps,
      steps: [
        {
          stepType: "steady",
          durationType: "distance",
          durationValue: variant.workM,
          targetType: "pace_range",
          targetValue: paces.interval
        },
        {
          stepType: "recovery",
          durationType: "time",
          durationValue: variant.recoverSec,
          targetType: "hr_range",
          targetValue: hrZones?.zones?.z1 || null
        }
      ]
    };
  } else if (variant.kind === "repeat_time") {
    mainBlock = {
      stepType: "repeat",
      repeatCount: variant.reps,
      steps: [
        {
          stepType: "steady",
          durationType: "time",
          durationValue: variant.workSec,
          targetType: "pace_range",
          targetValue: paces.interval
        },
        {
          stepType: "recovery",
          durationType: "time",
          durationValue: variant.recoverSec,
          targetType: "hr_range",
          targetValue: hrZones?.zones?.z1 || null
        }
      ]
    };
  } else {
    mainBlock = {
      stepType: "set",
      steps: (variant.steps || []).flatMap((step) => [
        {
          stepType: "steady",
          durationType: "distance",
          durationValue: step.workM,
          targetType: "pace_range",
          targetValue: paces.interval
        },
        {
          stepType: "recovery",
          durationType: "time",
          durationValue: step.recoverSec,
          targetType: "hr_range",
          targetValue: hrZones?.zones?.z1 || null
        }
      ])
    };
  }

  return {
    sport: "running",
    kind: "INTERVALS",
    variant: variant.id,
    estimatedDistanceMeters,
    paceTarget: paces.interval,
    hrTarget: hrZones?.zones?.z4 || null,
    steps: [
      {
        stepType: "warmup",
        durationType: "time",
        durationValue: warmupMin * 60,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null
      },
      mainBlock,
      {
        stepType: "cooldown",
        durationType: "time",
        durationValue: cooldownMin * 60,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null
      }
    ]
  };
}

function thresholdWorkout(variant, paces, hrZones, warmupMin, cooldownMin) {
  let mainBlock = null;

  if (variant.kind === "continuous" || variant.kind === "progression") {
    mainBlock = {
      stepType: "steady",
      durationType: "time",
      durationValue: variant.sec,
      targetType: "pace_range",
      targetValue: paces.tempo
    };
  } else if (variant.kind === "repeat") {
    mainBlock = {
      stepType: "repeat",
      repeatCount: variant.reps,
      steps: [
        {
          stepType: "steady",
          durationType: "time",
          durationValue: variant.workSec,
          targetType: "pace_range",
          targetValue: paces.tempo
        },
        {
          stepType: "recovery",
          durationType: "time",
          durationValue: variant.recoverSec,
          targetType: "hr_range",
          targetValue: hrZones?.zones?.z1 || null
        }
      ]
    };
  } else {
    mainBlock = {
      stepType: "repeat",
      repeatCount: variant.reps,
      steps: [
        {
          stepType: "steady",
          durationType: "distance",
          durationValue: variant.workM,
          targetType: "pace_range",
          targetValue: paces.tempo
        },
        {
          stepType: "recovery",
          durationType: "time",
          durationValue: variant.recoverSec,
          targetType: "hr_range",
          targetValue: hrZones?.zones?.z1 || null
        }
      ]
    };
  }

  const estimatedDistanceMeters = estimateThresholdSessionMeters(
    variant,
    paces,
    warmupMin,
    cooldownMin
  );

  return {
    sport: "running",
    kind: "THRESHOLD",
    variant: variant.id,
    estimatedDistanceMeters,
    paceTarget: paces.tempo,
    hrTarget: hrZones?.zones?.z3 || null,
    steps: [
      {
        stepType: "warmup",
        durationType: "time",
        durationValue: warmupMin * 60,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null
      },
      mainBlock,
      {
        stepType: "cooldown",
        durationType: "time",
        durationValue: cooldownMin * 60,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null
      }
    ]
  };
}

export function makeEasySession(params) {
  const subtype = normalizeEasySubtype(
    params.easySubtype || params.workoutSubtype,
    params.phase,
    params.distanceKm
  );

  const workout = easyWorkout(params.distanceKm, params.paces, params.hrZones, subtype);

  return baseSession({
    ...params,
    type: "EASY",
    name: easyNameFromSubtype(subtype),
    notes: easyNotesFromSubtype(subtype),
    keyTargets: easyKeyTargetFromSubtype(subtype),
    targetPace:
      subtype === "steady_easy"
        ? (params.paces.steady || params.paces.easy)
        : params.paces.easy,
    targetHr:
      subtype === "recovery" || subtype === "shakeout"
        ? (params.hrZones?.zones?.z1 || params.hrZones?.zones?.z2 || null)
        : params.hrZones?.zones?.z2 || null,
    workout
  });
}

export function makeLongSession(params) {
  const subtype = normalizeLongSubtype(
    params.longSubtype || params.workoutSubtype,
    params.phase,
    params.goalDistance,
    params.distanceKm
  );

  const workout = longWorkout(params.distanceKm, params.paces, params.hrZones, subtype);

  return baseSession({
    ...params,
    type: "LONG",
    name: longNameFromSubtype(subtype),
    notes: longNotesFromSubtype(subtype, params.phase),
    keyTargets: longKeyTargetFromSubtype(subtype),
    targetPace:
      subtype === "long_steady"
        ? (params.paces.steady || params.paces.easy)
        : params.paces.easy,
    targetHr: params.hrZones?.zones?.z2 || null,
    workout
  });
}

export function makeQualitySession(params) {
  const qType = params.qType;
  const subtype = normalizeSubtype(params.workoutSubtype, qType, params.phase);

  if (qType === "INTERVALS") {
    const fitted = chooseBestIntervalVariant({
      weekNumber: params.weekNumber,
      phase: params.phase,
      distanceKm: params.distanceKm,
      paces: params.paces,
      warmupMin: params.warmupMin,
      cooldownMin: params.cooldownMin,
      workoutSubtype: subtype,
      goalDistance: params.goalDistance,
      trainingFocus: params.trainingFocus
    });

    const workout = intervalsWorkout(
      fitted,
      params.paces,
      params.hrZones,
      params.warmupMin,
      params.cooldownMin
    );

    return baseSession({
      ...params,
      type: "INTERVALS",
      name: qualityNameFromVariant("INTERVALS", fitted, subtype),
      notes: `Warm up ${params.warmupMin} min easy. Main set: ${fitted.label}. Cool down ${params.cooldownMin} min easy.`,
      keyTargets: fitted.label,
      targetPace: params.paces.interval,
      targetHr: params.hrZones?.zones?.z4 || null,
      workout
    });
  }

  const fitted = chooseBestThresholdVariant({
    weekNumber: params.weekNumber,
    phase: params.phase,
    distanceKm: params.distanceKm,
    paces: params.paces,
    warmupMin: params.warmupMin,
    cooldownMin: params.cooldownMin,
    workoutSubtype: subtype,
    goalDistance: params.goalDistance,
    trainingFocus: params.trainingFocus
  });

  const workout = thresholdWorkout(
    fitted,
    params.paces,
    params.hrZones,
    params.warmupMin,
    params.cooldownMin
  );

  return baseSession({
    ...params,
    type: "THRESHOLD",
    name: qualityNameFromVariant("THRESHOLD", fitted, subtype),
    notes: `Warm up ${params.warmupMin} min easy. Main set: ${fitted.label}. Cool down ${params.cooldownMin} min easy.`,
    keyTargets: fitted.label,
    targetPace: params.paces.tempo,
    targetHr: params.hrZones?.zones?.z3 || null,
    workout
  });
}

export function makeRaceSession(params) {
  const distanceKm = params.distanceKm;
  const warmupMin = params.warmupMin || 0;
  const cooldownMin = params.cooldownMin || 0;

  const easyPace = midpointPaceSecPerKm(params.paces?.easy, 450);
  const warmupM = metersFromTime(warmupMin * 60, easyPace);
  const cooldownM = metersFromTime(cooldownMin * 60, easyPace);
  const raceM = roundInt((distanceKm || 0) * 1000);

  const workout = {
    sport: "running",
    kind: "RACE",
    estimatedDistanceMeters: roundInt(warmupM + raceM + cooldownM),
    paceTarget: {
      minSecPerKm: params.paces.raceSecPerKm,
      maxSecPerKm: params.paces.raceSecPerKm
    },
    hrTarget: params.hrZones?.zones?.z4 || params.hrZones?.zones?.z5 || null,
    steps: [
      {
        stepType: "warmup",
        durationType: "time",
        durationValue: warmupMin * 60,
        targetType: "hr_range",
        targetValue: params.hrZones?.zones?.z1 || null
      },
      {
        stepType: "race",
        durationType: "distance",
        durationValue: raceM,
        targetType: "pace_range",
        targetValue: {
          minSecPerKm: params.paces.raceSecPerKm,
          maxSecPerKm: params.paces.raceSecPerKm
        }
      },
      {
        stepType: "cooldown",
        durationType: "time",
        durationValue: cooldownMin * 60,
        targetType: "hr_range",
        targetValue: params.hrZones?.zones?.z1 || null
      }
    ]
  };

  return baseSession({
    ...params,
    type: "RACE",
    name: `${params.goalDistance} Race`,
    notes: "Race day. Run by feel and execute your pacing plan.",
    keyTargets: `${params.goalDistance} effort`,
    targetPace: {
      minSecPerKm: params.paces.raceSecPerKm,
      maxSecPerKm: params.paces.raceSecPerKm
    },
    targetHr: params.hrZones?.zones?.z4 || params.hrZones?.zones?.z5 || null,
    workout
  });
}