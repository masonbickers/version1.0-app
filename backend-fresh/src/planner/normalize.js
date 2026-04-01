import { ALLOWED_DIFFICULTY, DEFAULT_GENERATOR_CONFIG } from "./defaults.js";
import {
  clamp,
  deepMerge,
  isPlainObject,
  normaliseDay,
  normaliseGoalDistance,
  parseTimeToSeconds,
  toNumberOrNull,
  uniqOrderedDays,
} from "./utils.js";

function normalisePct(input, fallback) {
  const n = toNumberOrNull(input);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return clamp(n / 100, 0, 1);
  return clamp(n, 0, 1);
}

function normalizeConfig(inputConfig) {
  const merged = deepMerge(DEFAULT_GENERATOR_CONFIG, isPlainObject(inputConfig) ? inputConfig : {});
  const cfg = { ...merged };

  cfg.phaseModel = {
    baseWeeks: Math.max(0, Math.floor(toNumberOrNull(merged.phaseModel?.baseWeeks) ?? 0)),
    deloadEvery: Math.max(0, Math.floor(toNumberOrNull(merged.phaseModel?.deloadEvery) ?? 0)),
    taperWeeks: Math.max(0, Math.floor(toNumberOrNull(merged.phaseModel?.taperWeeks) ?? 0)),
  };

  cfg.progression = {
    weeklyIncreasePct: normalisePct(merged.progression?.weeklyIncreasePct, 0.08),
    maxWeeklyIncreasePct: normalisePct(merged.progression?.maxWeeklyIncreasePct, 0.12),
    deloadDropPct: normalisePct(merged.progression?.deloadDropPct, 0.22),
    taperDropPct: normalisePct(merged.progression?.taperDropPct, 0.35),
    minWeeklyKm: Math.max(5, toNumberOrNull(merged.progression?.minWeeklyKm) ?? 12),
    maxWeeklyKm: Math.max(5, toNumberOrNull(merged.progression?.maxWeeklyKm) ?? 140),
    maxLongRunIncreaseKm: Math.max(0.2, toNumberOrNull(merged.progression?.maxLongRunIncreaseKm) ?? 1.6),
    longRunMinKm: Math.max(2, toNumberOrNull(merged.progression?.longRunMinKm) ?? 6),
    longRunMaxKm: Math.max(5, toNumberOrNull(merged.progression?.longRunMaxKm) ?? 35),
  };

  cfg.distribution = {
    longRunPctByPhase: {
      base: normalisePct(merged.distribution?.longRunPctByPhase?.base, 0.3),
      build: normalisePct(merged.distribution?.longRunPctByPhase?.build, 0.33),
      deload: normalisePct(merged.distribution?.longRunPctByPhase?.deload, 0.28),
      taper: normalisePct(merged.distribution?.longRunPctByPhase?.taper, 0.26),
    },
    qualityPctByPhase: {
      base: normalisePct(merged.distribution?.qualityPctByPhase?.base, 0.25),
      build: normalisePct(merged.distribution?.qualityPctByPhase?.build, 0.27),
      deload: normalisePct(merged.distribution?.qualityPctByPhase?.deload, 0.2),
      taper: normalisePct(merged.distribution?.qualityPctByPhase?.taper, 0.21),
    },
    qualityDaysPerWeek: Math.max(1, Math.floor(toNumberOrNull(merged.distribution?.qualityDaysPerWeek) ?? 2)),
    minQualitySessionKm: Math.max(1, toNumberOrNull(merged.distribution?.minQualitySessionKm) ?? 3),
    maxQualitySessionKm: Math.max(1, toNumberOrNull(merged.distribution?.maxQualitySessionKm) ?? 12),
    minEasySessionKm: Math.max(1, toNumberOrNull(merged.distribution?.minEasySessionKm) ?? 4),
  };

  cfg.workouts = {
    qualityOrder: Array.isArray(merged.workouts?.qualityOrder)
      ? merged.workouts.qualityOrder
          .map((x) => String(x || "").trim().toUpperCase())
          .filter((x) => x === "INTERVALS" || x === "THRESHOLD")
      : ["INTERVALS", "THRESHOLD"],
    warmupMin: Math.max(0, Math.floor(toNumberOrNull(merged.workouts?.warmupMin) ?? 15)),
    cooldownMin: Math.max(0, Math.floor(toNumberOrNull(merged.workouts?.cooldownMin) ?? 10)),
  };
  if (!cfg.workouts.qualityOrder.length) cfg.workouts.qualityOrder = ["INTERVALS", "THRESHOLD"];

  cfg.output = {
    includeSessionDates: merged.output?.includeSessionDates !== false,
    includeDayViews: merged.output?.includeDayViews !== false,
    includeDecisionTrace: merged.output?.includeDecisionTrace !== false,
  };

  cfg.planName = String(merged.planName || DEFAULT_GENERATOR_CONFIG.planName);
  return cfg;
}

function parseTargetDate(goal) {
  const raw = goal?.targetDate || goal?.eventDate || null;
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseOptionalDateIso(raw) {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseAnchorDateMode(raw) {
  const mode = String(raw || "").trim().toLowerCase();
  if (mode === "start") return "start";
  return "race";
}

function parseTrainingFocus(preferences) {
  const direct = String(preferences?.trainingFocus || "").trim().toLowerCase();
  if (direct === "speed" || direct === "endurance" || direct === "balanced") return direct;

  const focusAreas = Array.isArray(preferences?.focusAreas)
    ? preferences.focusAreas.map((x) => String(x || "").trim().toLowerCase())
    : [];

  if (focusAreas.includes("speed")) return "speed";
  if (focusAreas.includes("endurance")) return "endurance";
  return "balanced";
}

function parsePlanQuality(preferences) {
  const raw = String(preferences?.planQuality || "").trim().toLowerCase();
  if (raw === "high" || raw === "hq" || raw === "high_quality") return "high";
  return "standard";
}

function normalizeProfile(rawProfile) {
  const goal = isPlainObject(rawProfile.goal) ? rawProfile.goal : {};
  const current = isPlainObject(rawProfile.current) ? rawProfile.current : {};
  const availability = isPlainObject(rawProfile.availability) ? rawProfile.availability : {};
  const preferences = isPlainObject(rawProfile.preferences) ? rawProfile.preferences : {};
  const pacing = isPlainObject(rawProfile.pacing) ? rawProfile.pacing : {};
  const hr = isPlainObject(rawProfile.hr) ? rawProfile.hr : {};

  const difficultyRaw = String(preferences.difficulty || "balanced").trim().toLowerCase();
  const difficulty = ALLOWED_DIFFICULTY.includes(difficultyRaw) ? difficultyRaw : "balanced";

  return {
    goal: {
      distance: normaliseGoalDistance(goal.distance),
      planLengthWeeks: Number.isInteger(toNumberOrNull(goal.planLengthWeeks))
        ? Number(goal.planLengthWeeks)
        : null,
      targetDate: parseTargetDate(goal),
      startDate: parseOptionalDateIso(goal.startDate),
      anchorDateMode: parseAnchorDateMode(goal.anchorDateMode),
    },
    current: {
      experience: String(current.experience || "").trim() || null,
      weeklyKm: toNumberOrNull(current.weeklyKm),
      longestRunKm: toNumberOrNull(current.longestRunKm),
      age: toNumberOrNull(current.age),
    },
    availability: {
      sessionsPerWeek: Number.isInteger(toNumberOrNull(availability.sessionsPerWeek))
        ? Number(availability.sessionsPerWeek)
        : null,
      runDays: uniqOrderedDays(availability.runDays),
      longRunDay: normaliseDay(availability.longRunDay),
    },
    preferences: {
      difficulty,
      metric: String(preferences.metric || "distance").trim().toLowerCase(),
      treadmill: Boolean(preferences.treadmill),
      trainingFocus: parseTrainingFocus(preferences),
      planQuality: parsePlanQuality(preferences),
    },
    pacing: {
      thresholdPaceSecPerKm: toNumberOrNull(pacing.thresholdPaceSecPerKm),
      recentRace: {
        distance: normaliseGoalDistance(pacing?.recentRace?.distance),
        distanceKm: toNumberOrNull(pacing?.recentRace?.distanceKm),
        timeSec:
          toNumberOrNull(pacing?.recentRace?.timeSec) ??
          parseTimeToSeconds(pacing?.recentRace?.time ?? pacing?.recentRace?.result),
      },
    },
    hr: {
      resting: toNumberOrNull(hr.resting),
      max: toNumberOrNull(hr.max),
    },
    templateId:
      typeof rawProfile.templateId === "string" && rawProfile.templateId.trim()
        ? rawProfile.templateId.trim()
        : null,
    templateMeta: isPlainObject(rawProfile.templateMeta)
      ? {
          distance: normaliseGoalDistance(rawProfile.templateMeta.distance),
          weeks: Number.isInteger(toNumberOrNull(rawProfile.templateMeta.weeks))
            ? Number(rawProfile.templateMeta.weeks)
            : null,
          runs: Number.isInteger(toNumberOrNull(rawProfile.templateMeta.runs))
            ? Number(rawProfile.templateMeta.runs)
            : null,
          requestedWeeks: Number.isInteger(toNumberOrNull(rawProfile.templateMeta.requestedWeeks))
            ? Number(rawProfile.templateMeta.requestedWeeks)
            : null,
        }
      : null,
  };
}

export function normalizeIncomingRequest(body) {
  const root = isPlainObject(body) ? body : {};
  const rawProfile = isPlainObject(root.athleteProfile) ? root.athleteProfile : root.profile;
  const profile = normalizeProfile(isPlainObject(rawProfile) ? rawProfile : {});
  const config = normalizeConfig(root.generatorConfig);
  return { profile, config };
}
