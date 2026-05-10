export default {
  id: "GENERAL",
  name: "General running fitness",
  phases: ["BASE", "BASE", "BUILD", "DELOAD", "BUILD", "BUILD", "DELOAD", "BUILD"],
  longRun: {
    minKm: 2.5,
    minOfCurrentLongest: 0.75,
    targetWeeklyFraction: 0.24,
    maxKm: 12,
    deloadMult: 0.8,
    taperMult: 0.8,
    allowFastFinish: false,
  },
  intensity: {
    deloadQualityMult: 0.7,
    taperQualityMult: 0.6,
    minEasyDaysBetweenHard: 1,
  },
  workouts: {
    easy: {
      stridesPolicy: {
        defaultStrides: { reps: 4, seconds: 20 },
        maxPerWeek: 1,
      },
    },
  },
};
