export default {
  id: "RETURN",
  name: "Return to running",
  phases: ["BASE", "BASE", "BASE", "DELOAD", "BUILD", "BUILD", "DELOAD", "BUILD"],
  longRun: {
    minKm: 1.5,
    minOfCurrentLongest: 0.7,
    targetWeeklyFraction: 0.22,
    maxKm: 8,
    deloadMult: 0.75,
    taperMult: 0.75,
    allowFastFinish: false,
  },
  intensity: {
    deloadQualityMult: 0.6,
    taperQualityMult: 0.5,
    minEasyDaysBetweenHard: 2,
  },
  workouts: {
    easy: {
      stridesPolicy: {
        defaultStrides: { reps: 0, seconds: 20 },
        maxPerWeek: 0,
      },
    },
  },
};
