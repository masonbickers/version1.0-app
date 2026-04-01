// half.js
export default {
  id: "HALF",
  name: "Half Marathon",
  phases: ["BASE", "BASE", "BUILD", "DELOAD", "BUILD", "SPECIFIC", "SPECIFIC", "TAPER"],
  longRun: {
    minOfCurrentLongest: 0.9,
    targetWeeklyFraction: 0.3,
    maxKm: 26,
    deloadMult: 0.8,
    taperMult: 0.72,
    allowFastFinish: true,
  },
  intensity: {
    deloadQualityMult: 0.78,
    taperQualityMult: 0.6,
    minEasyDaysBetweenHard: 1,
  },
  workouts: {
    intervals: {
      BASE: [
        { id: "w_half_hills_10x60s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_half_6x1k", kind: "INTERVALS", flavour: "AEROBIC_POWER" },
        { id: "w_half_5x1200", kind: "INTERVALS", flavour: "AEROBIC_POWER" },
      ],
      BUILD: [
        { id: "w_half_5x1600", kind: "INTERVALS", flavour: "THRESHOLD_POWER" },
        { id: "w_half_6x2k", kind: "INTERVALS", flavour: "HM_SPECIFIC" },
        { id: "w_half_4x2k", kind: "INTERVALS", flavour: "HM_SPECIFIC" },
      ],
      SPECIFIC: [
        { id: "w_half_3x3k", kind: "INTERVALS", flavour: "HM_SPECIFIC" },
        { id: "w_half_2x5k", kind: "INTERVALS", flavour: "RACE_PACE" },
        { id: "w_half_5x2k", kind: "INTERVALS", flavour: "RACE_PACE" },
      ],
      TAPER: [
        { id: "w_half_4x1k", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_half_3x1200", kind: "INTERVALS", flavour: "SHARPEN" },
      ],
    },
    tempo: {
      BASE: [
        { id: "t_half_25min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_half_3x10min", kind: "TEMPO", flavour: "CRUISE" },
      ],
      BUILD: [
        { id: "t_half_3x12min", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_half_30min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_half_35min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
      ],
      SPECIFIC: [
        { id: "t_half_2x20min_tempo", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_half_40min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
        { id: "t_half_3x15min_threshold", kind: "TEMPO", flavour: "RACE_EFFORT" },
      ],
      TAPER: [
        { id: "t_half_15min_tempo", kind: "TEMPO", flavour: "LIGHT" },
        { id: "t_half_3x6min_threshold", kind: "TEMPO", flavour: "SHARP" },
      ],
    },
    easy: {
      stridesPolicy: {
        defaultStrides: { reps: 6, seconds: 20 },
        maxPerWeek: 1,
      },
    },
  },
};
