// marathon.js
export default {
  id: "MARATHON",
  name: "Marathon",
  phases: ["BASE", "BASE", "BUILD", "DELOAD", "BUILD", "BUILD", "SPECIFIC", "TAPER"],
  longRun: {
    minOfCurrentLongest: 0.92,
    targetWeeklyFraction: 0.32,
    maxKm: 35,
    deloadMult: 0.8,
    taperMult: 0.7,
    allowFastFinish: true,
  },
  intensity: {
    deloadQualityMult: 0.8,
    taperQualityMult: 0.6,
    minEasyDaysBetweenHard: 2,
  },
  workouts: {
    intervals: {
      BASE: [
        { id: "w_marathon_hills_10x60s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_marathon_5x1k", kind: "INTERVALS", flavour: "AEROBIC_POWER" },
        { id: "w_marathon_4x1600", kind: "INTERVALS", flavour: "AEROBIC_POWER" },
      ],
      BUILD: [
        { id: "w_marathon_5x2k", kind: "INTERVALS", flavour: "MP_SUPPORT" },
        { id: "w_marathon_4x3k", kind: "INTERVALS", flavour: "MP_SUPPORT" },
        { id: "w_marathon_3x4k", kind: "INTERVALS", flavour: "MP_SUPPORT" },
      ],
      SPECIFIC: [
        { id: "w_marathon_4x5k_mp", kind: "INTERVALS", flavour: "MARATHON_SPECIFIC" },
        { id: "w_marathon_3x3k", kind: "INTERVALS", flavour: "MARATHON_SPECIFIC" },
        { id: "w_marathon_2x8k_mp", kind: "INTERVALS", flavour: "MARATHON_SPECIFIC" },
      ],
      TAPER: [
        { id: "w_marathon_4x1k_mp", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_marathon_3x1600", kind: "INTERVALS", flavour: "SHARPEN" },
      ],
    },
    tempo: {
      BASE: [
        { id: "t_marathon_30min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_marathon_3x12min", kind: "TEMPO", flavour: "CRUISE" },
      ],
      BUILD: [
        { id: "t_marathon_35min_tempo", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_marathon_3x15min", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_marathon_40min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
      ],
      SPECIFIC: [
        { id: "t_marathon_2x25min_tempo", kind: "TEMPO", flavour: "MARATHON_SPECIFIC" },
        { id: "t_marathon_45min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
        { id: "t_marathon_3x20min", kind: "TEMPO", flavour: "MARATHON_SPECIFIC" },
      ],
      TAPER: [
        { id: "t_marathon_20min_tempo", kind: "TEMPO", flavour: "LIGHT" },
        { id: "t_marathon_2x10min_threshold", kind: "TEMPO", flavour: "SHARP" },
      ],
    },
    easy: {
      stridesPolicy: {
        defaultStrides: { reps: 6, seconds: 15 },
        maxPerWeek: 1,
      },
    },
  },
};
