import {
  clamp,
  deepMerge,
  isPlainObject,
  normaliseDay,
  normaliseGoalDistance,
  toNumberOrNull,
  uniqOrderedDays,
} from "./utils.js";

export const DEFAULT_GENERATOR_CONFIG = {
  name: "Run plan v2",
  phaseModel: {
    baseWeeks: 2,
    deloadEvery: 4,
    taperWeeks: 1,
  },
  progression: {
    weeklyIncreasePct: 0.08,
    deloadDropPct: 0.22,
    taperDropPct: 0.35,
    maxWeeklyIncreasePct: 0.12,
    minWeeklyKm: 12,
    maxWeeklyKm: 140,
    maxLongRunIncreaseKm: 1.6,
    longRunMaxKm: 35,
  },
  distribution: {
    longRunPctByPhase: {
      base: 0.3,
      build: 0.33,
      deload: 0.28,
      taper: 0.26,
    },
    qualityPctByPhase: {
      base: 0.25,
      build: 0.27,
      deload: 0.2,
      taper: 0.21,
    },
    minQualitySessionKm: 3,
    maxQualitySessionKm: 12,
    minEasySessionKm: 4,
    qualityDaysPerWeek: 2,
  },
  workouts: {
    qualityOrder: ["INTERVALS", "THRESHOLD"],
    includeWorkoutSteps: true,
  },
  output: {
    includeDayViews: true,
    includeDecisionTrace: true,
    includeSessionDates: true,
  },
};

function normalisePct(value, fallback) {
  const n = toNumberOrNull(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return clamp(n / 100, 0, 1);
  return clamp(n, 0, 1);
}

function normaliseGoal(goal = {}) {
  const distance = normaliseGoalDistance(goal.distance);
  const planLengthWeeks = toNumberOrNull(goal.planLengthWeeks);
  const targetDateRaw = goal.targetDate || goal.eventDate || null;
  let targetDate = null;
  if (targetDateRaw && typeof targetDateRaw === "string") {
    const d = new Date(`${targetDateRaw}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) targetDate = d.toISOString().slice(0, 10);
  }
  return {
    distance,
    planLengthWeeks: Number.isInteger(planLengthWeeks) ? planLengthWeeks : null,
    targetDate,
  };
}

function normaliseCurrent(current = {}) {
  return {
    experience: String(current.experience || "").trim() || null,
    weeklyKm: toNumberOrNull(current.weeklyKm),
    longestRunKm: toNumberOrNull(current.longestRunKm),
    age: toNumberOrNull(current.age),
  };
}

function normaliseAvailability(availability = {}) {
  const sessionsPerWeek = toNumberOrNull(availability.sessionsPerWeek);
  const runDays = uniqOrderedDays(availability.runDays || []);
  const longRunDay = normaliseDay(availability.longRunDay);
  return {
    sessionsPerWeek: Number.isInteger(sessionsPerWeek) ? sessionsPerWeek : null,
    runDays,
    longRunDay,
  };
}

function normalisePacing(pacing = {}) {
  const rr = isPlainObject(pacing.recentRace) ? pacing.recentRace : {};
  return {
    recentRace: {
      distance: rr.distance || rr.distanceKey || null,
      distanceKm: toNumberOrNull(rr.distanceKm),
      time: rr.time || rr.result || null,
      timeSec: toNumberOrNull(rr.timeSec),
    },
    thresholdPaceSecPerKm: toNumberOrNull(pacing.thresholdPaceSecPerKm),
  };
}

function normaliseHr(hr = {}) {
  return {
    resting: toNumberOrNull(hr.resting),
    max: toNumberOrNull(hr.max),
    lthr: toNumberOrNull(hr.lthr),
  };
}

function normalisePreferences(preferences = {}) {
  const difficulty = String(preferences.difficulty || "balanced").trim().toLowerCase();
  return {
    difficulty: ["easy", "balanced", "hard"].includes(difficulty) ? difficulty : "balanced",
    metric: String(preferences.metric || "distance").trim().toLowerCase(),
    treadmill: Boolean(preferences.treadmill),
  };
}

function buildConfig(userConfig = {}) {
  const merged = deepMerge(DEFAULT_GENERATOR_CONFIG, isPlainObject(userConfig) ? userConfig : {});

  merged.phaseModel.baseWeeks = Math.max(0, Math.floor(toNumberOrNull(merged.phaseModel.baseWeeks) ?? 0));
  merged.phaseModel.deloadEvery = Math.max(0, Math.floor(toNumberOrNull(merged.phaseModel.deloadEvery) ?? 0));
  merged.phaseModel.taperWeeks = Math.max(0, Math.floor(toNumberOrNull(merged.phaseModel.taperWeeks) ?? 0));

  merged.progression.weeklyIncreasePct = normalisePct(merged.progression.weeklyIncreasePct, 0.08);
  merged.progression.deloadDropPct = normalisePct(merged.progression.deloadDropPct, 0.22);
  merged.progression.taperDropPct = normalisePct(merged.progression.taperDropPct, 0.35);
  merged.progression.maxWeeklyIncreasePct = normalisePct(merged.progression.maxWeeklyIncreasePct, 0.12);
  merged.progression.minWeeklyKm = Math.max(5, toNumberOrNull(merged.progression.minWeeklyKm) ?? 12);
  merged.progression.maxWeeklyKm = Math.max(
    merged.progression.minWeeklyKm,
    toNumberOrNull(merged.progression.maxWeeklyKm) ?? 140
  );
  merged.progression.maxLongRunIncreaseKm = Math.max(
    0.2,
    toNumberOrNull(merged.progression.maxLongRunIncreaseKm) ?? 1.6
  );
  merged.progression.longRunMaxKm = Math.max(8, toNumberOrNull(merged.progression.longRunMaxKm) ?? 35);

  for (const phase of ["base", "build", "deload", "taper"]) {
    merged.distribution.longRunPctByPhase[phase] = normalisePct(
      merged.distribution.longRunPctByPhase?.[phase],
      DEFAULT_GENERATOR_CONFIG.distribution.longRunPctByPhase[phase]
    );
    merged.distribution.qualityPctByPhase[phase] = normalisePct(
      merged.distribution.qualityPctByPhase?.[phase],
      DEFAULT_GENERATOR_CONFIG.distribution.qualityPctByPhase[phase]
    );
  }

  merged.distribution.minQualitySessionKm = Math.max(
    1,
    toNumberOrNull(merged.distribution.minQualitySessionKm) ?? 3
  );
  merged.distribution.maxQualitySessionKm = Math.max(
    merged.distribution.minQualitySessionKm,
    toNumberOrNull(merged.distribution.maxQualitySessionKm) ?? 12
  );
  merged.distribution.minEasySessionKm = Math.max(1, toNumberOrNull(merged.distribution.minEasySessionKm) ?? 4);
  merged.distribution.qualityDaysPerWeek = Math.max(
    1,
    Math.floor(toNumberOrNull(merged.distribution.qualityDaysPerWeek) ?? 2)
  );

  const order = Array.isArray(merged.workouts.qualityOrder) ? merged.workouts.qualityOrder : [];
  const validOrder = order
    .map((x) => String(x || "").trim().toUpperCase())
    .filter((x) => ["INTERVALS", "THRESHOLD", "TEMPO"].includes(x));
  merged.workouts.qualityOrder = validOrder.length ? validOrder : ["INTERVALS", "THRESHOLD"];

  return merged;
}

export function normalizeAndValidateRequest(body = {}) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(body)) {
    return {
      athleteProfile: null,
      generatorConfig: DEFAULT_GENERATOR_CONFIG,
      errors: ["Request body must be a JSON object."],
      warnings,
    };
  }

  const rawProfile = isPlainObject(body.athleteProfile) ? body.athleteProfile : body.profile;
  if (!isPlainObject(rawProfile)) {
    return {
      athleteProfile: null,
      generatorConfig: buildConfig(body.generatorConfig),
      errors: ["Missing athleteProfile object."],
      warnings,
    };
  }

  const athleteProfile = {
    goal: normaliseGoal(rawProfile.goal),
    current: normaliseCurrent(rawProfile.current),
    availability: normaliseAvailability(rawProfile.availability),
    pacing: normalisePacing(rawProfile.pacing),
    hr: normaliseHr(rawProfile.hr),
    preferences: normalisePreferences(rawProfile.preferences),
  };

  const generatorConfig = buildConfig(body.generatorConfig);

  if (!athleteProfile.goal.distance) {
    errors.push("athleteProfile.goal.distance is required (5K, 10K, HALF, MARATHON, ULTRA).");
  }
  if (!Number.isInteger(athleteProfile.goal.planLengthWeeks) || athleteProfile.goal.planLengthWeeks < 2) {
    errors.push("athleteProfile.goal.planLengthWeeks is required and must be an integer >= 2.");
  }

  if (!Number.isFinite(athleteProfile.current.weeklyKm) || athleteProfile.current.weeklyKm <= 0) {
    errors.push("athleteProfile.current.weeklyKm is required and must be > 0.");
  }
  if (!Number.isFinite(athleteProfile.current.longestRunKm) || athleteProfile.current.longestRunKm <= 0) {
    errors.push("athleteProfile.current.longestRunKm is required and must be > 0.");
  }

  const sessionsPerWeek = athleteProfile.availability.sessionsPerWeek;
  const runDays = athleteProfile.availability.runDays;

  if (!Number.isInteger(sessionsPerWeek) || sessionsPerWeek < 2 || sessionsPerWeek > 7) {
    errors.push("athleteProfile.availability.sessionsPerWeek is required (2-7).");
  }
  if (!runDays.length) {
    errors.push("athleteProfile.availability.runDays must include at least one day.");
  }
  if (Number.isInteger(sessionsPerWeek) && runDays.length !== sessionsPerWeek) {
    errors.push("availability.runDays count must match availability.sessionsPerWeek.");
  }
  if (!athleteProfile.availability.longRunDay) {
    errors.push("athleteProfile.availability.longRunDay is required (Mon..Sun).");
  } else if (!runDays.includes(athleteProfile.availability.longRunDay)) {
    errors.push("availability.longRunDay must be included in availability.runDays.");
  }

  if (!athleteProfile.goal.targetDate) {
    warnings.push("No goal.targetDate provided. Plan will be week-indexed only (no calendar dates).");
  }

  if (
    generatorConfig.phaseModel.baseWeeks + generatorConfig.phaseModel.taperWeeks >=
    athleteProfile.goal.planLengthWeeks
  ) {
    warnings.push("phaseModel baseWeeks+taperWeeks leaves no build period; using compressed progression.");
  }

  return {
    athleteProfile,
    generatorConfig,
    errors,
    warnings,
  };
}
