export const DEFAULT_GENERATOR_CONFIG = {
  planName: "Run plan (fresh)",
  phaseModel: {
    baseWeeks: 2,
    deloadEvery: 4,
    taperWeeks: 1,
  },
  progression: {
    weeklyIncreasePct: 0.08,
    maxWeeklyIncreasePct: 0.12,
    deloadDropPct: 0.22,
    taperDropPct: 0.35,
    minWeeklyKm: 12,
    maxWeeklyKm: 140,
    maxLongRunIncreaseKm: 1.6,
    longRunMinKm: 6,
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
    qualityDaysPerWeek: 2,
    minQualitySessionKm: 3,
    maxQualitySessionKm: 12,
    minEasySessionKm: 4,
  },
  workouts: {
    qualityOrder: ["INTERVALS", "THRESHOLD"],
    warmupMin: 15,
    cooldownMin: 10,
  },
  output: {
    includeSessionDates: true,
    includeDayViews: true,
    includeDecisionTrace: true,
  },
};

export const ALLOWED_DIFFICULTY = ["easy", "balanced", "hard"];
export const ALLOWED_GOAL_DISTANCES = ["5K", "10K", "HALF", "MARATHON", "ULTRA"];
