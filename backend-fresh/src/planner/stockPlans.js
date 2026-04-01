import { clamp, deepMerge, round1 } from "./utils.js";

const BASE_PHASE_PATTERN = [
  "base",
  "base",
  "build",
  "deload",
  "build",
  "build",
  "build",
  "deload",
  "build",
  "taper",
];

function phaseBias(base, build, deload, taper) {
  return { base, build, deload, taper };
}

const STOCK_TEMPLATES = {
  "5K": {
    id: "stock_5k_v1",
    name: "5K Stock Plan",
    goalDistance: "5K",
    phasePattern: BASE_PHASE_PATTERN,
    weeklyMultipliers: [1.0, 1.05, 1.1, 0.9, 1.13, 1.17, 1.2, 0.94, 1.08, 0.72],
    configPatch: {
      progression: {
        minWeeklyKm: 10,
        maxWeeklyKm: 120,
        maxLongRunIncreaseKm: 1.2,
        longRunMinKm: 4,
        longRunMaxKm: 24,
      },
      distribution: {
        longRunPctByPhase: {
          base: 0.23,
          build: 0.25,
          deload: 0.22,
          taper: 0.19,
        },
        qualityPctByPhase: {
          base: 0.26,
          build: 0.28,
          deload: 0.2,
          taper: 0.16,
        },
        qualityDaysPerWeek: 2,
        qualityDaysByPhase: {
          base: 1,
          build: 2,
          deload: 1,
          taper: 1,
        },
        minQualitySessionKm: 3,
        maxQualitySessionKm: 10,
        singleQualityDayPctScale: 0.8,
        maxEasyToLongRatio: 0.8,
        longRunMinLeadKm: 0.4,
        maxLongRunShareForOverflow: 0.32,
      },
      workouts: {
        qualityOrder: ["INTERVALS", "THRESHOLD", "INTERVALS"],
        qualitySubtypeBiasByPhase: {
          intervals: phaseBias(
            ["speed", "economy", "short_hills"],
            ["speed", "vo2", "mile_pace"],
            ["economy", "light_speed"],
            ["sharpen", "economy"]
          ),
          threshold: phaseBias(
            ["tempo", "progression"],
            ["tempo", "cruise"],
            ["light_tempo"],
            ["priming_tempo"]
          ),
        },
        longRunSubtypeBiasByPhase: phaseBias(
          ["aerobic"],
          ["aerobic", "steady_finish"],
          ["aerobic"],
          ["short_easy"]
        ),
        easyRunSubtypeBiasByPhase: phaseBias(
          ["recovery", "easy", "easy_strides"],
          ["easy", "easy_strides", "steady_easy"],
          ["recovery", "easy"],
          ["recovery", "easy_strides"]
        ),
      },
    },
    raceWeek: {
      postRaceEasyCapKm: 4,
      preRaceEasyCapKm: 6.5,
      preRaceDayCapKm: 3.5,
      support: {
        maxPreRaceSupportRuns: 2,
        allowShakeout: true,
        maxPostRaceSupportRuns: 0,
      },
    },
  },

  "10K": {
    id: "stock_10k_v1",
    name: "10K Stock Plan",
    goalDistance: "10K",
    phasePattern: BASE_PHASE_PATTERN,
    weeklyMultipliers: [1.0, 1.08, 1.16, 0.92, 1.2, 1.26, 1.3, 0.95, 1.12, 0.72],
    configPatch: {
      progression: {
        minWeeklyKm: 12,
        maxWeeklyKm: 140,
        maxLongRunIncreaseKm: 1.6,
        longRunMinKm: 6,
        longRunMaxKm: 32,
      },
      distribution: {
        longRunPctByPhase: {
          base: 0.29,
          build: 0.32,
          deload: 0.28,
          taper: 0.24,
        },
        qualityPctByPhase: {
          base: 0.23,
          build: 0.25,
          deload: 0.19,
          taper: 0.17,
        },
        qualityDaysPerWeek: 2,
        qualityDaysByPhase: {
          base: 1,
          build: 2,
          deload: 1,
          taper: 1,
        },
        minQualitySessionKm: 3,
        maxQualitySessionKm: 12,
        singleQualityDayPctScale: 0.78,
        maxEasyToLongRatio: 0.85,
        longRunMinLeadKm: 0.4,
        maxLongRunShareForOverflow: 0.35,
      },
      workouts: {
        qualityOrder: ["INTERVALS", "THRESHOLD"],
        qualitySubtypeBiasByPhase: {
          intervals: phaseBias(
            ["economy", "speed", "short_hills"],
            ["vo2", "10k_specific", "speed_endurance"],
            ["economy", "light_speed"],
            ["sharpen", "10k_specific_light"]
          ),
          threshold: phaseBias(
            ["tempo", "progression"],
            ["tempo", "cruise", "progression"],
            ["light_tempo"],
            ["priming_tempo"]
          ),
        },
        longRunSubtypeBiasByPhase: phaseBias(
          ["aerobic"],
          ["aerobic", "steady_finish"],
          ["aerobic"],
          ["short_easy"]
        ),
        easyRunSubtypeBiasByPhase: phaseBias(
          ["recovery", "easy", "easy_strides"],
          ["easy", "steady_easy", "easy_strides"],
          ["recovery", "easy"],
          ["recovery", "easy_strides"]
        ),
      },
    },
    raceWeek: {
      postRaceEasyCapKm: 4.5,
      preRaceEasyCapKm: 7,
      preRaceDayCapKm: 4,
      support: {
        maxPreRaceSupportRuns: 2,
        allowShakeout: true,
        maxPostRaceSupportRuns: 0,
      },
    },
  },

  HALF: {
    id: "stock_half_v1",
    name: "Half Marathon Stock Plan",
    goalDistance: "HALF",
    phasePattern: BASE_PHASE_PATTERN,
    weeklyMultipliers: [1.0, 1.07, 1.14, 0.9, 1.2, 1.28, 1.34, 0.95, 1.1, 0.68],
    configPatch: {
      progression: {
        minWeeklyKm: 16,
        maxWeeklyKm: 160,
        maxLongRunIncreaseKm: 1.9,
        longRunMinKm: 8,
        longRunMaxKm: 36,
      },
      distribution: {
        longRunPctByPhase: {
          base: 0.31,
          build: 0.34,
          deload: 0.29,
          taper: 0.23,
        },
        qualityPctByPhase: {
          base: 0.22,
          build: 0.24,
          deload: 0.17,
          taper: 0.15,
        },
        qualityDaysPerWeek: 2,
        qualityDaysByPhase: {
          base: 1,
          build: 2,
          deload: 1,
          taper: 1,
        },
        minQualitySessionKm: 4,
        maxQualitySessionKm: 14,
        singleQualityDayPctScale: 0.82,
        maxEasyToLongRatio: 0.88,
        longRunMinLeadKm: 0.5,
        maxLongRunShareForOverflow: 0.39,
      },
      workouts: {
        qualityOrder: ["THRESHOLD", "INTERVALS"],
        qualitySubtypeBiasByPhase: {
          intervals: phaseBias(
            ["economy", "10k_support"],
            ["10k_support", "vo2", "speed_endurance"],
            ["economy", "light_speed"],
            ["sharpen"]
          ),
          threshold: phaseBias(
            ["tempo", "progression", "steady_threshold"],
            ["tempo", "cruise", "progression", "steady_threshold"],
            ["light_tempo", "short_cruise"],
            ["priming_tempo"]
          ),
        },
        longRunSubtypeBiasByPhase: phaseBias(
          ["aerobic", "steady_finish"],
          ["aerobic", "steady_finish", "fast_finish"],
          ["aerobic"],
          ["short_easy"]
        ),
        easyRunSubtypeBiasByPhase: phaseBias(
          ["recovery", "easy", "easy_strides"],
          ["easy", "steady_easy", "easy_strides"],
          ["recovery", "easy"],
          ["recovery", "easy_strides"]
        ),
      },
    },
    raceWeek: {
      postRaceEasyCapKm: 5,
      preRaceEasyCapKm: 7.5,
      preRaceDayCapKm: 4.5,
      support: {
        maxPreRaceSupportRuns: 2,
        allowShakeout: true,
        maxPostRaceSupportRuns: 0,
      },
    },
  },

  MARATHON: {
    id: "stock_marathon_v1",
    name: "Marathon Stock Plan",
    goalDistance: "MARATHON",
    phasePattern: BASE_PHASE_PATTERN,
    weeklyMultipliers: [1.0, 1.06, 1.12, 0.9, 1.18, 1.24, 1.3, 0.94, 1.06, 0.65],
    configPatch: {
      progression: {
        minWeeklyKm: 20,
        maxWeeklyKm: 180,
        maxLongRunIncreaseKm: 2.2,
        longRunMinKm: 10,
        longRunMaxKm: 42,
      },
      distribution: {
        longRunPctByPhase: {
          base: 0.35,
          build: 0.37,
          deload: 0.31,
          taper: 0.25,
        },
        qualityPctByPhase: {
          base: 0.18,
          build: 0.2,
          deload: 0.15,
          taper: 0.13,
        },
        qualityDaysPerWeek: 2,
        qualityDaysByPhase: {
          base: 1,
          build: 2,
          deload: 1,
          taper: 1,
        },
        minQualitySessionKm: 4,
        maxQualitySessionKm: 16,
        singleQualityDayPctScale: 0.85,
        maxEasyToLongRatio: 0.92,
        longRunMinLeadKm: 0.6,
        maxLongRunShareForOverflow: 0.42,
      },
      workouts: {
        qualityOrder: ["THRESHOLD", "THRESHOLD", "INTERVALS"],
        qualitySubtypeBiasByPhase: {
          intervals: phaseBias(
            ["economy", "10k_support"],
            ["10k_support", "marathon_support"],
            ["light_speed"],
            ["sharpen"]
          ),
          threshold: phaseBias(
            ["tempo", "steady_threshold", "progression"],
            ["tempo", "cruise", "steady_threshold", "marathon_tempo"],
            ["light_tempo", "short_cruise"],
            ["priming_tempo", "marathon_tempo_light"]
          ),
        },
        longRunSubtypeBiasByPhase: phaseBias(
          ["aerobic", "steady_finish"],
          ["aerobic", "fast_finish", "mp_block", "progressive_long"],
          ["aerobic"],
          ["short_easy", "light_mp_touch"]
        ),
        easyRunSubtypeBiasByPhase: phaseBias(
          ["recovery", "easy"],
          ["easy", "steady_easy", "easy_strides"],
          ["recovery", "easy"],
          ["recovery", "easy"]
        ),
      },
    },
    raceWeek: {
      postRaceEasyCapKm: 5.5,
      preRaceEasyCapKm: 8,
      preRaceDayCapKm: 5,
      support: {
        maxPreRaceSupportRuns: 2,
        allowShakeout: true,
        maxPostRaceSupportRuns: 0,
      },
    },
  },

  ULTRA: {
    id: "stock_ultra_v1",
    name: "Ultra Stock Plan",
    goalDistance: "ULTRA",
    phasePattern: BASE_PHASE_PATTERN,
    weeklyMultipliers: [1.0, 1.05, 1.1, 0.9, 1.16, 1.22, 1.28, 0.93, 1.04, 0.62],
    configPatch: {
      progression: {
        minWeeklyKm: 24,
        maxWeeklyKm: 220,
        maxLongRunIncreaseKm: 2.8,
        longRunMinKm: 14,
        longRunMaxKm: 55,
      },
      distribution: {
        longRunPctByPhase: {
          base: 0.38,
          build: 0.41,
          deload: 0.34,
          taper: 0.28,
        },
        qualityPctByPhase: {
          base: 0.15,
          build: 0.16,
          deload: 0.12,
          taper: 0.08,
        },
        qualityDaysPerWeek: 1,
        qualityDaysByPhase: {
          base: 1,
          build: 1,
          deload: 1,
          taper: 0,
        },
        minQualitySessionKm: 4,
        maxQualitySessionKm: 14,
        singleQualityDayPctScale: 0.9,
        maxEasyToLongRatio: 0.95,
        longRunMinLeadKm: 0.8,
        maxLongRunShareForOverflow: 0.46,
      },
      workouts: {
        qualityOrder: ["THRESHOLD"],
        qualitySubtypeBiasByPhase: {
          intervals: phaseBias(
            ["economy"],
            ["economy", "hill_power"],
            ["light_speed"],
            []
          ),
          threshold: phaseBias(
            ["steady_threshold", "progression"],
            ["steady_threshold", "progression", "cruise"],
            ["light_tempo"],
            []
          ),
        },
        longRunSubtypeBiasByPhase: phaseBias(
          ["aerobic", "hilly_long"],
          ["aerobic", "hilly_long", "back_to_back_style", "progressive_long"],
          ["aerobic"],
          ["short_easy"]
        ),
        easyRunSubtypeBiasByPhase: phaseBias(
          ["recovery", "easy"],
          ["easy", "steady_easy"],
          ["recovery", "easy"],
          ["recovery"]
        ),
      },
    },
    raceWeek: {
      postRaceEasyCapKm: 6,
      preRaceEasyCapKm: 9,
      preRaceDayCapKm: 5.5,
      support: {
        maxPreRaceSupportRuns: 1,
        allowShakeout: true,
        maxPostRaceSupportRuns: 0,
      },
    },
  },
};

function inferGoalDistanceFromTemplateId(templateId) {
  const raw = String(templateId || "").trim().toLowerCase();
  if (!raw) return null;

  if (/\b5k\b|(^5k)|(_5k_)|(-5k-)/.test(raw)) return "5K";
  if (/\b10k\b|(^10k)|(_10k_)|(-10k-)/.test(raw)) return "10K";
  if (/\bhm\b|(^half)|(_half_)|half-marathon/.test(raw)) return "HALF";
  if (/\bmar\b|marathon/.test(raw)) return "MARATHON";
  if (/ultra/.test(raw)) return "ULTRA";

  return null;
}

function stretchNumericSeries(values, targetLen, fallback = 1) {
  const src = Array.isArray(values) ? values : [];
  if (!targetLen || targetLen < 1) return [];
  if (!src.length) return Array.from({ length: targetLen }, () => fallback);
  if (src.length === targetLen) return src.slice();
  if (src.length === 1) return Array.from({ length: targetLen }, () => src[0]);

  const out = [];
  for (let i = 0; i < targetLen; i += 1) {
    const pos = targetLen === 1 ? 0 : (i * (src.length - 1)) / (targetLen - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(src.length - 1, Math.ceil(pos));
    if (lo === hi) {
      out.push(src[lo]);
      continue;
    }
    const ratio = pos - lo;
    const v = src[lo] + (src[hi] - src[lo]) * ratio;
    out.push(v);
  }
  return out;
}

function buildAdaptivePhasePattern(basePattern, totalWeeks) {
  const src = Array.isArray(basePattern) && basePattern.length ? basePattern : BASE_PHASE_PATTERN;
  if (totalWeeks <= 2) return ["build", "taper"];
  if (totalWeeks === 3) return ["base", "build", "taper"];
  if (totalWeeks === 4) return ["base", "build", "deload", "taper"];
  if (totalWeeks === 5) return ["base", "base", "build", "deload", "taper"];

  const stretched = [];

  for (let i = 0; i < totalWeeks - 1; i += 1) {
    const pos = (i * (src.length - 2)) / Math.max(1, totalWeeks - 2);
    const phase = src[Math.round(pos)] || "build";
    stretched.push(phase);
  }

  stretched.push("taper");

  if (totalWeeks >= 7 && !stretched.includes("deload")) {
    const idx = Math.max(2, totalWeeks - 3);
    stretched[idx] = "deload";
  }

  if (stretched[0] === "deload") stretched[0] = "base";
  if (stretched[1] === "taper") stretched[1] = "build";
  stretched[stretched.length - 1] = "taper";

  return stretched;
}

function difficultyPolicy(goalDistance, difficulty) {
  const isEndurance = goalDistance === "MARATHON" || goalDistance === "ULTRA";

  if (difficulty === "easy") {
    return {
      volumeDeltaScale: isEndurance ? 0.86 : 0.82,
      qualityPctScale: 0.9,
      longRunPctShift: isEndurance ? -0.01 : -0.02,
      qualityDaysDelta: -1,
      qualityDensityScale: 0.94,
      label: "easy",
    };
  }

  if (difficulty === "hard") {
    return {
      volumeDeltaScale: isEndurance ? 1.08 : 1.12,
      qualityPctScale: isEndurance ? 1.04 : 1.08,
      longRunPctShift: isEndurance ? 0.015 : 0.01,
      qualityDaysDelta: isEndurance ? 0 : 1,
      qualityDensityScale: 1.06,
      label: "hard",
    };
  }

  return {
    volumeDeltaScale: 1,
    qualityPctScale: 1,
    longRunPctShift: 0,
    qualityDaysDelta: 0,
    qualityDensityScale: 1,
    label: "balanced",
  };
}

function adjustLongRunPctByDifficulty(base, policy) {
  return {
    base: clamp((base?.base ?? 0.3) + policy.longRunPctShift, 0.18, 0.48),
    build: clamp((base?.build ?? 0.33) + policy.longRunPctShift, 0.2, 0.5),
    deload: clamp((base?.deload ?? 0.28) + policy.longRunPctShift, 0.16, 0.44),
    taper: clamp((base?.taper ?? 0.26) + policy.longRunPctShift, 0.15, 0.4),
  };
}

function adjustQualityPctByDifficulty(base, policy, qualityBoost = 1) {
  const apply = (value, fallback) =>
    clamp(
      (value ?? fallback) * policy.qualityPctScale * policy.qualityDensityScale * qualityBoost,
      0.1,
      0.36
    );

  return {
    base: apply(base?.base, 0.25),
    build: apply(base?.build, 0.27),
    deload: apply(base?.deload, 0.2),
    taper: apply(base?.taper, 0.18),
  };
}

function resolvePlanQuality(preferences) {
  const raw = String(preferences?.planQuality || "").trim().toLowerCase();
  if (raw === "high" || raw === "hq" || raw === "high_quality") return "high";
  return "standard";
}

function applyTrainingFocusToQualityOrder(goalDistance, qualityOrder, trainingFocus) {
  const fallback = Array.isArray(qualityOrder) && qualityOrder.length
    ? qualityOrder.slice()
    : ["INTERVALS", "THRESHOLD"];

  const focus = String(trainingFocus || "").toLowerCase();
  const isEndurance = goalDistance === "MARATHON" || goalDistance === "ULTRA";

  if (focus === "speed") {
    return isEndurance
      ? ["THRESHOLD", "INTERVALS", "THRESHOLD"]
      : ["INTERVALS", "INTERVALS", "THRESHOLD"];
  }

  if (focus === "endurance") {
    return isEndurance
      ? ["THRESHOLD", "THRESHOLD", "INTERVALS"]
      : ["THRESHOLD", "INTERVALS", "THRESHOLD"];
  }

  return fallback;
}

function mergePhaseBias(baseBias, patchBias) {
  return {
    base: patchBias?.base ?? baseBias?.base ?? [],
    build: patchBias?.build ?? baseBias?.build ?? [],
    deload: patchBias?.deload ?? baseBias?.deload ?? [],
    taper: patchBias?.taper ?? baseBias?.taper ?? [],
  };
}

function mergeWorkoutBiases(workouts) {
  const base = workouts || {};
  return {
    ...base,
    qualitySubtypeBiasByPhase: {
      intervals: mergePhaseBias(
        base?.qualitySubtypeBiasByPhase?.intervals,
        base?.qualitySubtypeBiasByPhase?.intervals
      ),
      threshold: mergePhaseBias(
        base?.qualitySubtypeBiasByPhase?.threshold,
        base?.qualitySubtypeBiasByPhase?.threshold
      ),
    },
    longRunSubtypeBiasByPhase: mergePhaseBias(
      base?.longRunSubtypeBiasByPhase,
      base?.longRunSubtypeBiasByPhase
    ),
    easyRunSubtypeBiasByPhase: mergePhaseBias(
      base?.easyRunSubtypeBiasByPhase,
      base?.easyRunSubtypeBiasByPhase
    ),
  };
}

function applyTrainingFocusToSubtypeBias(goalDistance, workouts, trainingFocus) {
  const focus = String(trainingFocus || "").toLowerCase();
  if (!focus) return workouts;

  const next = { ...workouts };
  const intervals = { ...(workouts?.qualitySubtypeBiasByPhase?.intervals || {}) };
  const threshold = { ...(workouts?.qualitySubtypeBiasByPhase?.threshold || {}) };
  const longRun = { ...(workouts?.longRunSubtypeBiasByPhase || {}) };

  const prepend = (arr, items) => Array.from(new Set([...(items || []), ...(arr || [])]));

  if (focus === "speed") {
    intervals.base = prepend(intervals.base, ["speed", "economy"]);
    intervals.build = prepend(intervals.build, ["vo2", "speed_endurance"]);
    threshold.build = prepend(threshold.build, ["tempo"]);
  }

  if (focus === "endurance") {
    threshold.base = prepend(threshold.base, ["steady_threshold", "progression"]);
    threshold.build = prepend(threshold.build, ["cruise", "progression"]);
    longRun.build = prepend(longRun.build, goalDistance === "MARATHON" || goalDistance === "ULTRA"
      ? ["mp_block", "progressive_long"]
      : ["steady_finish", "fast_finish"]);
  }

  next.qualitySubtypeBiasByPhase = {
    intervals,
    threshold,
  };
  next.longRunSubtypeBiasByPhase = longRun;

  return next;
}

function resolveTemplate(profile) {
  const fromTemplateId = inferGoalDistanceFromTemplateId(profile?.templateId);
  const fromGoal = profile?.goal?.distance || null;
  const key = fromTemplateId || fromGoal;
  return STOCK_TEMPLATES[key] || STOCK_TEMPLATES["10K"];
}

export function applyStockTemplate(profile, incomingConfig) {
  const selected = resolveTemplate(profile);
  const templateConfig = deepMerge(incomingConfig, selected.configPatch);
  const policy = difficultyPolicy(selected.goalDistance, profile?.preferences?.difficulty);
  const planQuality = resolvePlanQuality(profile?.preferences);
  const isHighQualityPlan = planQuality === "high";

  const sessionsPerWeek = Math.max(2, Number(profile?.availability?.sessionsPerWeek) || 4);
  const totalWeeks = Math.max(2, Number(profile?.goal?.planLengthWeeks) || 10);
  const trainingFocus = profile?.preferences?.trainingFocus || null;
  const isEnduranceDistance = selected.goalDistance === "MARATHON" || selected.goalDistance === "ULTRA";

  const rawMultipliers = stretchNumericSeries(selected.weeklyMultipliers, totalWeeks, 1);
  const weeklyMultipliers = rawMultipliers.map((m, idx) => {
    if (idx === 0) return 1;
    const next = 1 + (m - 1) * policy.volumeDeltaScale;
    return clamp(round1(next), 0.55, 2.4);
  });

  const phasePattern = buildAdaptivePhasePattern(selected.phasePattern, totalWeeks);

  const templateQualityDays = Number(templateConfig?.distribution?.qualityDaysPerWeek) || 2;
  const templateQualityDaysByPhase = {
    base: Number(templateConfig?.distribution?.qualityDaysByPhase?.base ?? templateQualityDays),
    build: Number(templateConfig?.distribution?.qualityDaysByPhase?.build ?? templateQualityDays),
    deload: Number(
      templateConfig?.distribution?.qualityDaysByPhase?.deload ?? Math.max(1, templateQualityDays - 1)
    ),
    taper: Number(
      templateConfig?.distribution?.qualityDaysByPhase?.taper ?? Math.max(0, templateQualityDays - 1)
    ),
  };

  const maxQualityDays = Math.max(1, sessionsPerWeek - 1);
  let qualityDaysPerWeek = Math.round(
    clamp(templateQualityDays + policy.qualityDaysDelta, 1, maxQualityDays)
  );

  if (sessionsPerWeek <= 3) qualityDaysPerWeek = 1;
  if (selected.goalDistance === "ULTRA") qualityDaysPerWeek = Math.min(qualityDaysPerWeek, 1);

  const qualityDaysByPhase = {
    base: Math.round(clamp(templateQualityDaysByPhase.base + policy.qualityDaysDelta, 0, maxQualityDays)),
    build: Math.round(clamp(templateQualityDaysByPhase.build + policy.qualityDaysDelta, 0, maxQualityDays)),
    deload: Math.round(
      clamp(templateQualityDaysByPhase.deload + Math.min(0, policy.qualityDaysDelta), 0, maxQualityDays)
    ),
    taper: Math.round(
      clamp(templateQualityDaysByPhase.taper + Math.min(0, policy.qualityDaysDelta), 0, maxQualityDays)
    ),
  };

  const isSpeedPlan =
    selected.goalDistance === "5K" ||
    selected.goalDistance === "10K" ||
    selected.goalDistance === "HALF";

  if (isSpeedPlan && sessionsPerWeek === 4) {
    qualityDaysPerWeek = Math.min(qualityDaysPerWeek, 2);
    qualityDaysByPhase.base = Math.min(qualityDaysByPhase.base, 2);
    qualityDaysByPhase.build = Math.min(qualityDaysByPhase.build, 2);
    qualityDaysByPhase.deload = Math.min(qualityDaysByPhase.deload, 2);
    qualityDaysByPhase.taper = Math.min(qualityDaysByPhase.taper, 1);
  }

  if (isSpeedPlan && sessionsPerWeek >= 4 && policy.label !== "easy") {
    qualityDaysPerWeek = Math.max(qualityDaysPerWeek, 2);
    qualityDaysByPhase.base = Math.max(qualityDaysByPhase.base, 1);
    qualityDaysByPhase.build = Math.max(qualityDaysByPhase.build, 2);
    qualityDaysByPhase.deload = Math.max(qualityDaysByPhase.deload, 1);
    qualityDaysByPhase.taper = Math.max(qualityDaysByPhase.taper, 1);
  }

  if (sessionsPerWeek <= 3) {
    qualityDaysByPhase.base = Math.min(qualityDaysByPhase.base, 1);
    qualityDaysByPhase.build = Math.min(qualityDaysByPhase.build, 1);
    qualityDaysByPhase.deload = Math.min(qualityDaysByPhase.deload, 1);
    qualityDaysByPhase.taper = Math.min(qualityDaysByPhase.taper, 1);
  }

  if (selected.goalDistance === "ULTRA") {
    qualityDaysByPhase.base = Math.min(qualityDaysByPhase.base, 1);
    qualityDaysByPhase.build = Math.min(qualityDaysByPhase.build, 1);
    qualityDaysByPhase.deload = Math.min(qualityDaysByPhase.deload, 1);
    qualityDaysByPhase.taper = 0;
  }

  if (isHighQualityPlan && sessionsPerWeek >= 4 && selected.goalDistance !== "ULTRA") {
    qualityDaysPerWeek = Math.max(qualityDaysPerWeek, 2);
    qualityDaysByPhase.base = Math.max(qualityDaysByPhase.base, isEnduranceDistance ? 1 : 2);
    qualityDaysByPhase.build = Math.max(qualityDaysByPhase.build, 2);
    qualityDaysByPhase.deload = Math.max(qualityDaysByPhase.deload, 1);
    qualityDaysByPhase.taper = Math.max(qualityDaysByPhase.taper, 1);
  }

  const planQualityPctBoost = isHighQualityPlan
    ? isEnduranceDistance
      ? sessionsPerWeek >= 4
        ? 1.06
        : 1.03
      : sessionsPerWeek >= 4
        ? 1.1
        : 1.05
    : 1;

  const distribution = {
    ...templateConfig.distribution,
    longRunPctByPhase: adjustLongRunPctByDifficulty(
      templateConfig?.distribution?.longRunPctByPhase,
      policy
    ),
    qualityPctByPhase: adjustQualityPctByDifficulty(
      templateConfig?.distribution?.qualityPctByPhase,
      policy,
      planQualityPctBoost
    ),
    qualityDaysPerWeek,
    qualityDaysByPhase,
  };

  let workouts = {
    ...templateConfig.workouts,
    qualityOrder: applyTrainingFocusToQualityOrder(
      selected.goalDistance,
      templateConfig?.workouts?.qualityOrder,
      trainingFocus
    ),
  };

  workouts = mergeWorkoutBiases(workouts);
  workouts = applyTrainingFocusToSubtypeBias(selected.goalDistance, workouts, trainingFocus);

  const config = {
    ...templateConfig,
    planName: `${selected.name} (Adapted)`,
    distribution,
    workouts,
    raceWeek: {
      postRaceEasyCapKm: Number(selected?.raceWeek?.postRaceEasyCapKm ?? 6),
      preRaceEasyCapKm: Number(selected?.raceWeek?.preRaceEasyCapKm ?? 8),
      preRaceDayCapKm: Number(selected?.raceWeek?.preRaceDayCapKm ?? 4.5),
      support: {
        maxPreRaceSupportRuns: Number(selected?.raceWeek?.support?.maxPreRaceSupportRuns ?? 2),
        allowShakeout: Boolean(selected?.raceWeek?.support?.allowShakeout ?? true),
        maxPostRaceSupportRuns: Number(selected?.raceWeek?.support?.maxPostRaceSupportRuns ?? 0),
      },
    },
    stockTemplate: {
      mode: "stock_adapted",
      id: selected.id,
      name: selected.name,
      goalDistance: selected.goalDistance,
      sourceTemplateId: profile?.templateId || null,
      weeklyMultipliers,
      phasePattern,
    },
  };

  const adaptationsApplied = [
    `template:${selected.id}`,
    `difficulty:${policy.label}`,
    `sessions_per_week:${sessionsPerWeek}`,
    `quality_days_per_week:${qualityDaysPerWeek}`,
    `quality_days_by_phase:${qualityDaysByPhase.base}/${qualityDaysByPhase.build}/${qualityDaysByPhase.deload}/${qualityDaysByPhase.taper}`,
    `weekly_km_baseline:${round1(profile?.current?.weeklyKm || 0)}`,
  ];

  if (profile?.templateId) adaptationsApplied.push(`input_template_id:${profile.templateId}`);
  if (trainingFocus) adaptationsApplied.push(`training_focus:${String(trainingFocus).toLowerCase()}`);
  if (isHighQualityPlan) adaptationsApplied.push("plan_quality:high");

  return {
    config,
    template: {
      id: selected.id,
      name: selected.name,
      goalDistance: selected.goalDistance,
    },
    adaptationsApplied,
  };
}
