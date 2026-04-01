export default {
  id: "5K",
  name: "5K",
  phases: ["BASE", "BUILD", "BUILD", "DELOAD", "SPECIFIC", "SPECIFIC", "TAPER", "TAPER"],
  longRun: {
    minOfCurrentLongest: 0.8,
    targetWeeklyFraction: 0.22,
    maxKm: 16,
    deloadMult: 0.78,
    taperMult: 0.65,
    allowFastFinish: true,
  },
  intensity: {
    deloadQualityMult: 0.75,
    taperQualityMult: 0.55,
    minEasyDaysBetweenHard: 1,
  },
  workouts: {
    intervals: {
      BASE: [
        { id: "w_5k_hills_10x45s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_5k_12x400", kind: "INTERVALS", flavour: "ECONOMY" },
        { id: "w_5k_10x500", kind: "INTERVALS", flavour: "VO2" },
      ],
      BUILD: [
        { id: "w_5k_8x600", kind: "INTERVALS", flavour: "VO2" },
        { id: "w_5k_6x800", kind: "INTERVALS", flavour: "VO2" },
        { id: "w_5k_6x1k", kind: "INTERVALS", flavour: "5K_SPECIFIC" },
      ],
      SPECIFIC: [
        { id: "w_5k_16x400", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_5k_12x300", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_5k_10x400", kind: "INTERVALS", flavour: "RACE_PACE" },
      ],
      TAPER: [
        { id: "w_5k_8x400_sharp", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_5k_6x300_sharp", kind: "INTERVALS", flavour: "SHARPEN" },
      ],
    },
    tempo: {
      BASE: [
        { id: "t_5k_18min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_5k_5x3min", kind: "TEMPO", flavour: "CRUISE" },
      ],
      BUILD: [
        { id: "t_5k_3x8min_threshold", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_5k_20min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_5k_25min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
      ],
      SPECIFIC: [
        { id: "t_5k_4x5min_threshold", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_5k_18min_threshold", kind: "TEMPO", flavour: "RACE_EFFORT" },
      ],
      TAPER: [
        { id: "t_5k_10min_tempo", kind: "TEMPO", flavour: "LIGHT" },
        { id: "t_5k_4x3min", kind: "TEMPO", flavour: "SHARP" },
      ],
    },
    easy: {
      stridesPolicy: {
        defaultStrides: { reps: 8, seconds: 20 },
        maxPerWeek: 2,
      },
    },
  },
};
