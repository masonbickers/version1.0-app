// server/lib/train/planRules/rulesConfig.js

export const RULES = {
  version: 1,

  // Your engine uses UPPERCASE session.type/workoutKind
  normaliseCase: "UPPER",

  // Strict contract mode for simplified planning.
  // When enabled, deriveInputs.js should read only the listed input families.
  simplePlannerMode: {
    enabled: false,
    strictInputContract: true,
    contract: {
      goal: ["distance", "planLengthWeeks", "eventDate", "targetDate", "targetTime"],
      current: ["experience", "weeklyKm", "longestRunKm", "recentRace"],
      availability: [
        "sessionsPerWeek",
        "runDays",
        "availableDays",
        "daysAvailable",
        "selectedDays",
        "longRunDay",
        "difficulty",
        "timePerSessionMin",
        "longRunMaxMin",
      ],
      preferences: ["metric", "treadmill", "difficulty"],
      topLevelFallbacks: [
        "goalDistance",
        "weeks",
        "sessionsPerWeek",
        "runDays",
        "availableDays",
        "difficulty",
        "eventDate",
        "targetDate",
      ],
      pacing: ["recentRace", "estimatedRaceTime", "estimatedRaceTimeSec"],
    },
    paceAnchors: {
      // In simple mode: use estimated race/PB style anchors only.
      allowThresholdPace: false,
      allowRecentTimesFallback: false,
      allowEstimatedRaceFromGoalTargetTime: true,
    },
    hrZones: {
      autoDeriveFromProfile: false,
    },
  },

  normalization: {
    sessionsPerWeek: {
      min: 1,
      max: 7,
      default: 4,
    },
    planLengthWeeks: {
      min: 1,
      max: 52,
      default: 12,
    },
    fallbackRunDaysBySessions: {
      1: ["Sun"],
      2: ["Tue", "Sun"],
      3: ["Tue", "Thu", "Sun"],
      4: ["Tue", "Thu", "Sat", "Sun"],
      5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
      6: ["Mon", "Tue", "Wed", "Thu", "Sat", "Sun"],
      7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    defaultLongRunDay: "Sun",
  },

  // Canonical product-level planner dimensions.
  // Keep this aligned with planSpecs/* and normalization/derive inputs.
  productSpec: {
    goalDistances: ["5K", "10K", "HALF", "MARATHON", "ULTRA"],
    experienceLevels: [
      "New to running",
      "Some experience",
      "Regular runner",
      "Advanced/competitive",
    ],
    difficultyModes: ["easy", "balanced", "hard"],
  },

  // Rename: this is NOT "days per week" — it's "max hard sessions"
  maxHardSessionsByExperience: {
    "New to running": 1,
    "Some experience": 1,
    "Regular runner": 2,
    "Advanced/competitive": 2,
  },

  // Keep aligned with session.type / session.workoutKind values
  hardSessionTypes: ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE"],

  // Only true if long runs can contain MP/tempo blocks
  longRunCountsAsHard: false,

  weeklyGrowth: {
    // Applied on NON-deload weeks
    maxPct: 0.1, // +10% max
    maxKm: 6, // or +6km max (use whichever is smaller)
    minKm: 8, // weekly km floor (also used for deload floor)
    startFromUserWeeklyKm: true,
  },

  deload: {
    everyNWeeks: 4,
    reducePct: 0.2, // -20%
    deloadAffectsLongRun: true,
  },

  taper: {
    enabled: true,
    // Default last week only, but override per distance below if you want
    lastNWeeksDefault: 1,
    reduceQualityPct: 0.25,
    reduceLongRunPct: 0.15,
  },

  // Distance-specific guardrails (lets you go beyond Runna)
  byDistance: {
    "5k": { taperLastNWeeks: 1, longRunMaxKm: 14 },
    "10k": { taperLastNWeeks: 1, longRunMaxKm: 18 },
    "half": { taperLastNWeeks: 2, longRunMaxKm: 24 },
    "mara": { taperLastNWeeks: 2, longRunMaxKm: 32 },
  },

  longRun: {
    startPctOfWeekly: 0.3,
    maxPctOfWeekly: 0.4,
    maxIncreaseKm: 2.5,

    // Absolute bounds
    minKm: 6,
    maxKmDefault: 32, // will be clamped by byDistance.*.longRunMaxKm

    // Phase-aware long-run share limits (% of weekly volume)
    longRunSharePctByPhase: {
      BASE: { target: 30, max: 33 },
      BUILD: { target: 30, max: 33 },
      SPECIFIC: { target: 31, max: 34 },
      DELOAD: { target: 28, max: 31 },
      TAPER: { target: 26, max: 29 },
    },
    // Optional goal+phase overrides (%). Used for finer premium tuning.
    longRunSharePctByGoalPhase: {
      "5k": { SPECIFIC: { max: 33 } },
      "10k": { SPECIFIC: { max: 33 } },
      half: { SPECIFIC: { max: 33.5 } },
      marathon: { SPECIFIC: { max: 34 } },
      ultra: { SPECIFIC: { max: 35 } },
    },
  },

  spacing: {
    // 1 means never adjacent hard days
    minGapDaysBetweenHard: 1,
  },

  intensityTargets: {
    easyPct: 0.7,
    qualityPct: 0.3,

    maxQualitySessionsPerWeekAt3Runs: 1,
    maxQualitySessionsPerWeek: 2,

    minQualitySessionKm: 5.0,
    maxQualitySessionKm: 11.0,

    // Phase-aware quality distribution (closer to premium coaching apps):
    // - "target" drives first-pass allocation
    // - "max" is enforced in validator guardrails
    qualitySharePctByPhase: {
      BASE: { target: 26, max: 30 },
      BUILD: { target: 27, max: 30 },
      SPECIFIC: { target: 29, max: 31 },
      DELOAD: { target: 22, max: 26 },
      TAPER: { target: 22, max: 28 },
    },
  },

  renderedGuardrails: {
    weeklyQuality: {
      maxDeltaVsBudgetSharePct: 7.5,
      unresolvedReportMinKm: 0.1,
    },
  },

  fillSessionsPolicy: {
    easy: {
      minKmPerRunWhenWeeklyAtLeast18: 4.5,
      minKmPerRunWhenWeeklyBelow18: 3.5,
    },
    qualityShareShiftPct: {
      byGoal: {
        "5k": 2.0,
        "10k": 1.0,
        half: -0.5,
        marathon: -1.0,
        ultra: -2.0,
      },
      byExperience: {
        new: -3.0,
        some: -1.5,
        regular: 0.0,
        advanced: 1.0,
      },
      byDifficulty: {
        easy: -2.0,
        balanced: 0.0,
        hard: 1.5,
      },
      weekWavePatternPct: [0.0, 0.6, -0.4, 0.3],
    },
    qualitySessionKmBounds: {
      minClamp: { min: 3.5, max: 7.0 },
      maxClamp: { minFloorDelta: 0.5, minFloor: 7.5, max: 16.0 },
      adjustByGoal: {
        "5k": { min: 0.3, max: 0.8 },
        "10k": { min: 0.2, max: 0.5 },
        half: { min: 0.1, max: 1.2 },
        marathon: { min: -0.2, max: 2.0 },
        ultra: { min: -0.4, max: 2.5 },
      },
      adjustByExperience: {
        new: { min: -0.5, max: -1.2 },
        some: { min: -0.2, max: -0.6 },
        regular: { min: 0.0, max: 0.0 },
        advanced: { min: 0.3, max: 0.8 },
      },
      adjustByDifficulty: {
        easy: { min: 0.0, max: -0.6 },
        balanced: { min: 0.0, max: 0.0 },
        hard: { min: 0.0, max: 0.6 },
      },
      adjustByWeeklyKm: {
        lowThreshold: 30,
        highThreshold: 65,
        lowMaxDelta: -0.4,
        highMaxDelta: 0.7,
      },
      adjustBySessionsPerWeek: {
        whenAtMost: 3,
        maxDelta: 0.3,
      },
    },
    thresholdPreferredGoals: ["half", "marathon", "ultra"],
  },

  progressionPolicy: {
    weeklyCapMultiplierByDifficulty: {
      conservative: 1.15,
      standard: 1.25,
      aggressive: 1.35,
      elite: 1.45,
    },
    weeklyCapMultiplierBySessionsPerWeek: {
      "2": 1.18,
      "3": 1.18,
      "4": 1.3,
    },
    weeklyCapMultiplierByGoalMax: {
      "5K": 1.25,
      "10K": 1.3,
    },
    longRunAbsMaxByGoal: {
      "5K": 16,
      "10K": 20,
      HALF: 28,
      MARATHON: 35,
      ULTRA: 45,
    },
    longRunMaxPctByGoalMax: {
      "5K": 0.36,
      "10K": 0.38,
    },
    longRunMaxIncreaseKmByGoalMax: {
      "5K": 2.0,
      "10K": 2.0,
    },
    taperReducePctDefaultByGoal: {
      "5K": 0.35,
      "10K": 0.35,
      default: 0.25,
    },
  },

  // Workout-template fidelity policy controls.
  // Keep these explicit so product can sign-off on taper aggressiveness.
  fidelity: {
    intervals: {
      floorRatioNonTaper: 0.85,
      floorRatioDeload: 0.7,
      floorRatioTaper: 0.0, // taper_relaxed
      taperMinKeepRatio: 0.75,
      phaseWorkCapMult: {
        deload: 1.1,
        taper: 1.05,
      },
    },
    tempo: {
      floorRatioNonTaper: 0.75,
      floorRatioDeload: 0.6,
      floorRatioTaper: 0.0, // taper_relaxed
      taperMinKeepRatio: 0.0, // optional; set >0 to enforce minimum taper keep on spec IDs
    },
  },

  timeCaps: {
    // If you support "timePerSessionMin", these prevent silly prescriptions.
    weekdayMaxMinDefault: 60,
    longRunMaxMinDefault: 120,
  },
};
