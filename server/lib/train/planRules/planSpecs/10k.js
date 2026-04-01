const spec10k = {
  id: "10K",
  name: "10K",
  // phases can be overridden by plan length, but this is a strong default
  phases: ["BASE", "BASE", "BUILD", "DELOAD", "BUILD", "BUILD", "SPECIFIC", "TAPER"],

  // long run rules: stop the generator doing 10km long runs when user can do 15km already
  longRun: {
    // never prescribe below this fraction of current longest run (unless planLength=1 or rehab mode)
    minOfCurrentLongest: 0.85,
    // typical long run as fraction of weekly volume for 10K plans
    targetWeeklyFraction: 0.28,
    // hard caps (10K plans rarely need monster long runs)
    maxKm: 18,
    // deload/taper multipliers
    deloadMult: 0.78,
    taperMult: 0.70,
    // allow a fast-finish sometimes in specific phase
    allowFastFinish: true,
  },

  intensity: {
    // how much to reduce “quality volume” on deload/taper weeks
    deloadQualityMult: 0.75,
    taperQualityMult: 0.55,
    // spacing rules (so you don’t stack hard sessions)
    minEasyDaysBetweenHard: 1,
  },

  // workout pools by phase with anti-repeat priority
  workouts: {
    intervals: {
      BASE: [
        { id: "w_10k_hills_10x45s", kind: "INTERVALS", flavour: "HILLS" },
        { id: "w_10k_12x400", kind: "INTERVALS", flavour: "ECONOMY" },
        { id: "w_10k_6x800", kind: "INTERVALS", flavour: "VO2" },
      ],
      BUILD: [
        { id: "w_10k_5x1k", kind: "INTERVALS", flavour: "VO2" },
        { id: "w_10k_3x2k", kind: "INTERVALS", flavour: "10K_SPECIFIC" },
        { id: "w_10k_4x1200", kind: "INTERVALS", flavour: "10K_SPECIFIC" },
      ],
      SPECIFIC: [
        { id: "w_10k_2x3k", kind: "INTERVALS", flavour: "10K_SPECIFIC" },
        { id: "w_10k_3x2k_racepace", kind: "INTERVALS", flavour: "RACE_PACE" },
        { id: "w_10k_16x400_fast", kind: "INTERVALS", flavour: "SHARPEN" },
      ],
      TAPER: [
        { id: "w_10k_8x400_sharp", kind: "INTERVALS", flavour: "SHARPEN" },
        { id: "w_10k_3x1k_racepace", kind: "INTERVALS", flavour: "RACE_PACE" },
      ],
    },

    tempo: {
      BASE: [
        { id: "t_10k_20min_tempo", kind: "TEMPO", flavour: "CONTINUOUS" },
        { id: "t_10k_6x3min", kind: "TEMPO", flavour: "CRUISE" },
      ],
      BUILD: [
        { id: "t_10k_3x10min", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_10k_2x15min", kind: "TEMPO", flavour: "THRESHOLD" },
        { id: "t_10k_25min_progression", kind: "TEMPO", flavour: "PROGRESSION" },
      ],
      SPECIFIC: [
        { id: "t_10k_3x8min_raceeffort", kind: "TEMPO", flavour: "SPECIFIC" },
        { id: "t_10k_2x12min_threshold", kind: "TEMPO", flavour: "THRESHOLD" },
      ],
      TAPER: [
        { id: "t_10k_12min_tempo", kind: "TEMPO", flavour: "LIGHT" },
        { id: "t_10k_4x3min", kind: "TEMPO", flavour: "SHARP" },
      ],
    },

    easy: {
      stridesPolicy: {
        // don’t do both 8x20s + 8x80m (that’s your current weirdness)
        defaultStrides: { reps: 6, seconds: 20 },
        maxPerWeek: 2,
      },
    },
  },
};

export default spec10k;
