// ultra.js
export default {
  id: "ULTRA",
  name: "Ultra",
  phases: ["BASE", "BASE", "BUILD", "DELOAD", "BUILD", "BUILD", "SPECIFIC", "TAPER"],
  longRun: {
    minOfCurrentLongest: 0.95,
    targetWeeklyFraction: 0.34,
    maxKm: 45,
    deloadMult: 0.82,
    taperMult: 0.72,
    allowFastFinish: false,
  },
  intensity: {
    deloadQualityMult: 0.85,
    taperQualityMult: 0.7,
    minEasyDaysBetweenHard: 2,
  },
  workouts: {
    intervals: {
      BASE: [
        { id: "w_ultra_hills_10x90s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_ultra_6x1k", kind: "INTERVALS", flavour: "AEROBIC_POWER" },
        { id: "w_ultra_5x1200", kind: "INTERVALS", flavour: "AEROBIC_POWER" },
      ],
      BUILD: [
        { id: "w_ultra_hills_12x90s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_ultra_5x2k", kind: "INTERVALS", flavour: "STEADY_STRENGTH" },
        { id: "w_ultra_4x3k", kind: "INTERVALS", flavour: "STEADY_STRENGTH" },
      ],
      SPECIFIC: [
        { id: "w_ultra_hills_10x120s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_ultra_4x4k", kind: "INTERVALS", flavour: "ULTRA_SPECIFIC" },
        { id: "w_ultra_3x5k", kind: "INTERVALS", flavour: "ULTRA_SPECIFIC" },
      ],
      TAPER: [
        { id: "w_ultra_hills_8x60s", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_ultra_3x1k", kind: "INTERVALS", flavour: "SHARPEN" },
      ],
    },
    tempo: {
      BASE: [
        { id: "t_ultra_40min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_ultra_3x15min", kind: "TEMPO", flavour: "CRUISE" },
      ],
      BUILD: [
        { id: "t_ultra_50min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_ultra_3x20min", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_ultra_60min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
      ],
      SPECIFIC: [
        { id: "t_ultra_2x30min_tempo", kind: "TEMPO", flavour: "ULTRA_SPECIFIC" },
        { id: "t_ultra_70min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
        { id: "t_ultra_3x25min", kind: "TEMPO", flavour: "ULTRA_SPECIFIC" },
      ],
      TAPER: [
        { id: "t_ultra_20min_tempo", kind: "TEMPO", flavour: "LIGHT" },
        { id: "t_ultra_2x10min", kind: "TEMPO", flavour: "LIGHT" },
      ],
    },
    easy: {
      stridesPolicy: {
        defaultStrides: { reps: 4, seconds: 20 },
        maxPerWeek: 1,
      },
    },
  },
};
