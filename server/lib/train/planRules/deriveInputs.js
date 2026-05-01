// server/lib/train/planRules/deriveInputs.js
import { RULES } from "./rulesConfig.js";
import {
  chooseLongRunDay,
  ensureRunDaysCount,
  goalKeyToByDistanceKey,
  goalKeyToPolicyKey,
  normaliseExperienceKey,
  normaliseExperienceLabel,
  normaliseGoalDistanceKey,
  normaliseMetricMode,
  normalisePlanLengthWeeks,
  normaliseDifficultyKey,
  normaliseSessionsPerWeek,
  normalisePublicDifficulty,
  uniqOrderedDays,
} from "./normalization.js";

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function simplePlannerModeConfig() {
  const cfg = RULES?.simplePlannerMode;
  return cfg && typeof cfg === "object" ? cfg : {};
}

function isSimplePlannerModeStrict() {
  const cfg = simplePlannerModeConfig();
  return cfg.enabled === true && cfg.strictInputContract !== false;
}

/* ─────────────────────────────────────────────────────────────
   Pace anchor precedence (default):
   threshold pace > recent race/PB > recentTimes fallback > default policy
   In strict simple mode this is controlled by RULES.simplePlannerMode.paceAnchors.
────────────────────────────────────────────────────────────── */

function parseTimeToSeconds(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const parts = s.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  if (nums.length === 2) {
    const [mm, ss] = nums;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }

  const [hh, mm, ss] = nums;
  if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
  return hh * 3600 + mm * 60 + ss;
}

function distanceToKm(label) {
  const d = String(label || "").toLowerCase().trim();
  if (d === "5k") return 5;
  if (d === "10k") return 10;
  if (d.includes("half")) return 21.0975;
  if (d.includes("mara")) return 42.195;
  if (d.includes("marathon")) return 42.195;
  return null;
}

function clampPace(secPerKm, minSecPerKm, maxSecPerKm) {
  return Math.min(Math.max(secPerKm, minSecPerKm), maxSecPerKm);
}

function predictTimeSec(timeSec, fromKm, toKm) {
  const EXP = 1.06;
  return timeSec * Math.pow(toKm / fromKm, EXP);
}

function makeRaceCandidate({ source, sourceField = null, distance, distanceKm, timeSec }) {
  const km = toNumberOrNull(distanceKm) ?? distanceToKm(distance);
  const sec = toNumberOrNull(timeSec);
  if (!Number.isFinite(km) || km <= 0) return null;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return {
    source,
    sourceField,
    distance: distance || `${km}K`,
    distanceKm: km,
    timeSec: sec,
  };
}

export function parseRecentRaceAnchor(recentRace = null) {
  const rr = recentRace;
  if (!rr || typeof rr !== "object") return null;

  return makeRaceCandidate({
    source: "recent_race_or_pb",
    sourceField: "pacing.recentRace",
    distance: rr?.distance,
    distanceKm: rr?.distanceKm,
    timeSec:
      toNumberOrNull(rr?.timeSec) ??
      parseTimeToSeconds(rr?.time) ??
      parseTimeToSeconds(rr?.result),
  });
}

function parseEstimatedRaceFromGoalTargetTime(profile = {}, { sourceField = "goal.targetTime" } = {}) {
  const goalDistance = profile?.goal?.distance ?? profile?.goalDistance ?? "10K";
  const sec =
    toNumberOrNull(profile?.pacing?.estimatedRaceTimeSec) ??
    parseTimeToSeconds(profile?.goal?.targetTime) ??
    parseTimeToSeconds(profile?.goal?.estimatedRaceTime) ??
    parseTimeToSeconds(profile?.pacing?.estimatedRaceTime);

  if (!Number.isFinite(sec) || sec <= 0) return null;

  return makeRaceCandidate({
    source: "estimated_race_time",
    sourceField,
    distance: goalDistance,
    distanceKm: null,
    timeSec: sec,
  });
}

function buildSimpleModeInputProfile(athleteProfile = {}) {
  const src = athleteProfile && typeof athleteProfile === "object" ? athleteProfile : {};
  const availability =
    src?.availability && typeof src.availability === "object" ? src.availability : {};
  const preferences =
    src?.preferences && typeof src.preferences === "object" ? src.preferences : {};
  const goal = src?.goal && typeof src.goal === "object" ? src.goal : {};
  const current = src?.current && typeof src.current === "object" ? src.current : {};
  const pacing = src?.pacing && typeof src.pacing === "object" ? src.pacing : {};

  let raceAnchor = parseRecentRaceAnchor(pacing?.recentRace || current?.recentRace);

  const allowEstimatedRaceFromGoalTargetTime =
    simplePlannerModeConfig()?.paceAnchors?.allowEstimatedRaceFromGoalTargetTime !== false;
  if (!raceAnchor && allowEstimatedRaceFromGoalTargetTime) {
    raceAnchor = parseEstimatedRaceFromGoalTargetTime(src);
  }

  const compactRaceAnchor = raceAnchor
    ? {
        distance: raceAnchor.distance,
        distanceKm: raceAnchor.distanceKm,
        timeSec: raceAnchor.timeSec,
      }
    : null;

  const canonicalDate = pickFirstDefined(
    goal?.eventDate,
    goal?.targetDate,
    src?.eventDate,
    src?.targetDate
  );

  return {
    goal: {
      distance: pickFirstDefined(goal?.distance, src?.goalDistance),
      planLengthWeeks: pickFirstDefined(goal?.planLengthWeeks, src?.weeks),
      eventDate: canonicalDate,
      targetDate: canonicalDate,
      targetTime: pickFirstDefined(goal?.targetTime, goal?.estimatedRaceTime),
    },
    current: {
      experience: current?.experience,
      weeklyKm: current?.weeklyKm,
      longestRunKm: current?.longestRunKm,
      recentRace: compactRaceAnchor,
    },
    availability: {
      sessionsPerWeek: pickFirstDefined(availability?.sessionsPerWeek, src?.sessionsPerWeek),
      runDays: availability?.runDays,
      availableDays: availability?.availableDays,
      daysAvailable: availability?.daysAvailable,
      selectedDays: availability?.selectedDays,
      longRunDay: availability?.longRunDay,
      difficulty: pickFirstDefined(availability?.difficulty, src?.difficulty),
      timePerSessionMin: availability?.timePerSessionMin,
      longRunMaxMin: availability?.longRunMaxMin,
    },
    preferences: {
      metric: preferences?.metric,
      treadmill: preferences?.treadmill,
      difficulty: preferences?.difficulty,
    },
    goalDistance: src?.goalDistance,
    weeks: src?.weeks,
    sessionsPerWeek: src?.sessionsPerWeek,
    runDays: src?.runDays,
    availableDays: src?.availableDays,
    difficulty: src?.difficulty,
    eventDate: src?.eventDate,
    targetDate: src?.targetDate,
    pacing: compactRaceAnchor
      ? {
          recentRace: compactRaceAnchor,
          estimatedRaceTimeSec: compactRaceAnchor.timeSec,
        }
      : {},
  };
}

function pickExplicitRecentRace(profile) {
  const rr = profile?.pacing?.recentRace || profile?.current?.recentRace || null;
  const candidate = parseRecentRaceAnchor(rr);
  return candidate || null;
}

function collectRecentTimesCandidates(profile) {
  const t = profile?.current?.recentTimes || {};
  const list = [];

  const add = (distance, distanceKm, raw, sourceField) => {
    const sec = parseTimeToSeconds(raw);
    if (!Number.isFinite(sec) || sec <= 0) return;
    const c = makeRaceCandidate({
      source: "recent_times_fallback",
      sourceField,
      distance,
      distanceKm,
      timeSec: sec,
    });
    if (c) list.push(c);
  };

  add("5K", 5, t.fiveK, "current.recentTimes.fiveK");
  add("10K", 10, t.tenK, "current.recentTimes.tenK");
  add("Half marathon", 21.0975, t.half, "current.recentTimes.half");
  add("Marathon", 42.195, t.marathon, "current.recentTimes.marathon");
  return list;
}

function pickRecentTimesRace(profile, goalDistanceKey) {
  const candidates = collectRecentTimesCandidates(profile);
  if (!candidates.length) return { race: null, debug: { reason: "recent_times_missing" } };

  const goalKm = distanceToKm(goalDistanceKey);
  if (Number.isFinite(goalKm)) {
    const exact = candidates.find((c) => Math.abs(c.distanceKm - goalKm) < 0.2);
    if (exact) return { race: exact, debug: { reason: "recent_times_exact_goal_distance" } };
  }

  const five = candidates.find((c) => Math.abs(c.distanceKm - 5) < 0.2);
  const ten = candidates.find((c) => Math.abs(c.distanceKm - 10) < 0.2);

  if (five && ten) {
    const tenPredFrom5 = predictTimeSec(five.timeSec, 5, 10);
    const diff = (ten.timeSec - tenPredFrom5) / tenPredFrom5;
    if (diff > 0.06) {
      return { race: five, debug: { reason: "recent_times_conflict_use_5k", diffRatio: diff } };
    }
    return { race: ten, debug: { reason: "recent_times_consistent_use_10k", diffRatio: diff } };
  }

  const withEq = candidates.map((c) => ({
    ...c,
    eq10kSec: c.distanceKm === 10 ? c.timeSec : predictTimeSec(c.timeSec, c.distanceKm, 10),
  }));
  withEq.sort((a, b) => a.eq10kSec - b.eq10kSec);
  const best = withEq[0];
  return {
    race: best
      ? {
          source: best.source,
          sourceField: best.sourceField,
          distance: best.distance,
          distanceKm: best.distanceKm,
          timeSec: best.timeSec,
        }
      : null,
    debug: best
      ? { reason: "recent_times_best_eq10k", eq10kSec: best.eq10kSec }
      : { reason: "recent_times_missing" },
  };
}

/* ─────────────────────────────────────────────────────────────
   Paces (engine shape)
   Engine expects: thresholdSecPerKm, raceSecPerKm, easy/steady/tempo/interval ranges
────────────────────────────────────────────────────────────── */

function deriveTrainingPacesFromRace({ recentRace, difficulty }) {
  if (!recentRace) return null;
  if (!Number.isFinite(recentRace.timeSec) || recentRace.timeSec <= 0) return null;
  if (!Number.isFinite(recentRace.distanceKm) || recentRace.distanceKm <= 0) return null;

  const racePace = recentRace.timeSec / recentRace.distanceKm;

  const MIN = 150;
  const MAX = 600;

  if (!Number.isFinite(racePace) || racePace < MIN * 0.75 || racePace > MAX * 1.25) return null;

  let thresholdFactor = 1.04;
  if (recentRace.distanceKm <= 5.01) thresholdFactor = 1.10;
  else if (recentRace.distanceKm <= 10.01) thresholdFactor = 1.04;
  else if (recentRace.distanceKm <= 21.2) thresholdFactor = 1.01;
  else thresholdFactor = 0.99;

  let thr = racePace * thresholdFactor;
  if (difficulty === "easy") thr *= 1.01;
  if (difficulty === "hard") thr *= 0.99;

  const range = (a, b) => ({
    minSecPerKm: clampPace(a, MIN, MAX),
    maxSecPerKm: clampPace(b, MIN, MAX),
  });

  const out = {
    source: recentRace.source || "recentRace",
    recentRace,
    raceSecPerKm: clampPace(racePace, MIN, MAX),
    thresholdSecPerKm: clampPace(thr, MIN, MAX),
    easy: range(thr * 1.20, thr * 1.45),
    steady: range(thr * 1.08, thr * 1.16),
    tempo: range(thr * 0.98, thr * 1.04),
    interval: range(
      recentRace.distanceKm <= 10.01 ? racePace * 0.90 : racePace * 0.92,
      recentRace.distanceKm <= 10.01 ? racePace * 0.97 : racePace * 0.99
    ),
  };

  return out;
}

function deriveTrainingPacesFromThreshold({ thresholdPaceSecPerKm, difficulty }) {
  const t = toNumberOrNull(thresholdPaceSecPerKm);
  if (!Number.isFinite(t) || t <= 0) return null;

  const MIN = 150;
  const MAX = 600;

  let thr = clampPace(t, MIN, MAX);
  if (difficulty === "easy") thr *= 1.01;
  if (difficulty === "hard") thr *= 0.99;

  const range = (minMult, maxMult) => ({
    minSecPerKm: clampPace(thr * minMult, MIN, MAX),
    maxSecPerKm: clampPace(thr * maxMult, MIN, MAX),
  });

  // Approximate race pace (10k-ish) from threshold.
  // (This keeps garminSteps sensible when it needs raceSecPerKm.)
  const approxRace = clampPace(thr / 1.04, MIN, MAX);

  return {
    source: "threshold_anchor",
    thresholdSecPerKm: Math.round(thr),
    raceSecPerKm: Math.round(approxRace),
    easy: range(1.20, 1.45),
    steady: range(1.08, 1.16),
    tempo: range(0.98, 1.04),
    interval: range(0.90, 0.97),
  };
}

function pickThresholdAnchor(profile) {
  const fromPacing =
    profile?.pacing?.thresholdPaceSecPerKm ??
    profile?.pacing?.thresholdSecPerKm ??
    null;
  const fromPersonalization = profile?.personalization?.paces?.anchor?.thresholdPaceSecPerKm;

  const pacingValue = toNumberOrNull(fromPacing);
  if (Number.isFinite(pacingValue) && pacingValue > 0) {
    return { value: pacingValue, sourceField: "pacing.thresholdPaceSecPerKm" };
  }

  const personalValue = toNumberOrNull(fromPersonalization);
  if (Number.isFinite(personalValue) && personalValue > 0) {
    return { value: personalValue, sourceField: "personalization.paces.anchor.thresholdPaceSecPerKm" };
  }

  return null;
}

function deriveDefaultThresholdSecPerKm({ experienceKey, goalDistanceKey }) {
  const byExperience = {
    new: 335,
    some: 305,
    regular: 285,
    advanced: 265,
  };
  const base = byExperience[experienceKey] ?? byExperience.some;

  const byGoal = {
    "5K": -6,
    "10K": 0,
    HALF: 6,
    MARATHON: 12,
    ULTRA: 18,
  };
  const goalAdj = byGoal[goalDistanceKey] ?? 0;
  return Math.max(180, Math.min(480, base + goalAdj));
}

function derivePacesWithPrecedence(
  profile,
  {
    difficulty,
    experienceKey,
    goalDistanceKey,
    allowThresholdPace = true,
    allowRecentTimesFallback = true,
  }
) {
  const precedence = [
    ...(allowThresholdPace ? ["threshold_pace"] : []),
    "recent_race_or_pb",
    ...(allowRecentTimesFallback ? ["recent_times_fallback"] : []),
    "default_policy",
  ];

  if (allowThresholdPace) {
    const threshold = pickThresholdAnchor(profile);
    if (threshold?.value) {
      const paces = deriveTrainingPacesFromThreshold({
        thresholdPaceSecPerKm: threshold.value,
        difficulty,
      });
      if (paces) {
        return {
          paces: { ...paces, source: "threshold_anchor" },
          recentRace: null,
          trace: {
            precedence,
            selectedPath: "threshold_pace",
            sourceField: threshold.sourceField,
            thresholdPaceSecPerKm: Math.round(threshold.value),
          },
        };
      }
    }
  }

  const explicitRace = pickExplicitRecentRace(profile);
  if (explicitRace) {
    const paces = deriveTrainingPacesFromRace({ recentRace: explicitRace, difficulty });
    if (paces) {
      return {
        paces: { ...paces, source: "recent_race_or_pb" },
        recentRace: explicitRace,
        trace: {
          precedence,
          selectedPath: "recent_race_or_pb",
          sourceField: explicitRace.sourceField,
          distanceKm: explicitRace.distanceKm,
          timeSec: explicitRace.timeSec,
        },
      };
    }
  }

  if (allowRecentTimesFallback) {
    const recentTimesPick = pickRecentTimesRace(profile, goalDistanceKey);
    if (recentTimesPick?.race) {
      const paces = deriveTrainingPacesFromRace({
        recentRace: recentTimesPick.race,
        difficulty,
      });
      if (paces) {
        return {
          paces: { ...paces, source: "recent_times_fallback" },
          recentRace: recentTimesPick.race,
          trace: {
            precedence,
            selectedPath: "recent_times_fallback",
            sourceField: recentTimesPick.race.sourceField,
            distanceKm: recentTimesPick.race.distanceKm,
            timeSec: recentTimesPick.race.timeSec,
            decision: recentTimesPick.debug?.reason || null,
          },
        };
      }
    }
  }

  const defaultThreshold = deriveDefaultThresholdSecPerKm({
    experienceKey,
    goalDistanceKey,
  });
  const defaultPaces = deriveTrainingPacesFromThreshold({
    thresholdPaceSecPerKm: defaultThreshold,
    difficulty,
  });

  return {
    paces: defaultPaces ? { ...defaultPaces, source: "default_policy" } : null,
    recentRace: null,
    trace: {
      precedence,
      selectedPath: "default_policy",
      thresholdPaceSecPerKm: Math.round(defaultThreshold),
      reason:
        !allowThresholdPace && !allowRecentTimesFallback
          ? "no_race_anchor_in_simple_mode"
          : "no_threshold_or_race_anchors",
    },
  };
}

function toExplicitPaceSec(value) {
  const n = toNumberOrNull(value);
  if (!Number.isFinite(n)) return null;
  if (n < 120 || n > 900) return null;
  return Math.round(n);
}

function narrowRangeFromPace(secPerKm, spreadSec = 5) {
  const base = toExplicitPaceSec(secPerKm);
  if (!base) return null;
  return {
    minSecPerKm: clampPace(base - spreadSec, 120, 900),
    maxSecPerKm: clampPace(base + spreadSec, 120, 900),
  };
}

function applyExplicitPaceOverrides(paces, sourceProfile) {
  if (!paces || typeof paces !== "object") {
    return { paces: paces || null, appliedKeys: [] };
  }

  const pacing = sourceProfile?.pacing || {};
  const next = {
    ...paces,
    easy: paces?.easy ? { ...paces.easy } : paces?.easy,
    steady: paces?.steady ? { ...paces.steady } : paces?.steady,
    tempo: paces?.tempo ? { ...paces.tempo } : paces?.tempo,
    interval: paces?.interval ? { ...paces.interval } : paces?.interval,
  };

  const appliedKeys = [];

  const threshold =
    toExplicitPaceSec(pacing?.thresholdPaceSecPerKm) ??
    toExplicitPaceSec(pacing?.thresholdSecPerKm);
  if (threshold) {
    next.thresholdSecPerKm = threshold;
    appliedKeys.push("thresholdPaceSecPerKm");
  }

  const race = toExplicitPaceSec(pacing?.racePaceSecPerKm);
  if (race) {
    next.raceSecPerKm = race;
    appliedKeys.push("racePaceSecPerKm");
  }

  const easy = narrowRangeFromPace(pacing?.easyPaceSecPerKm);
  if (easy) {
    next.easy = easy;
    appliedKeys.push("easyPaceSecPerKm");
  }

  const tempo = narrowRangeFromPace(pacing?.tempoPaceSecPerKm);
  if (tempo) {
    next.tempo = tempo;
    appliedKeys.push("tempoPaceSecPerKm");
  }

  const interval = narrowRangeFromPace(pacing?.intervalPaceSecPerKm);
  if (interval) {
    next.interval = interval;
    appliedKeys.push("intervalPaceSecPerKm");
  }

  return { paces: next, appliedKeys };
}

function deriveMaxHrFromAge(profile) {
  const age = toNumberOrNull(profile?.current?.age ?? profile?.age);
  if (!Number.isFinite(age) || age < 12 || age > 100) return null;

  const maxHr = Math.round(220 - age);
  if (!Number.isFinite(maxHr) || maxHr < 120 || maxHr > 220) return null;
  return maxHr;
}

/* ─────────────────────────────────────────────────────────────
   HR zones
────────────────────────────────────────────────────────────── */

function deriveHrZonesFromProfile(profile) {
  const hr = profile?.hr || profile?.current?.hr || {};
  const age = toNumberOrNull(profile?.current?.age ?? profile?.age);
  const explicitMax = toNumberOrNull(hr.max);
  const derivedMax = deriveMaxHrFromAge(profile);
  const baselineMax = derivedMax ?? explicitMax;
  const baselineSource = Number.isFinite(derivedMax)
    ? "age_220_minus_age"
    : Number.isFinite(explicitMax)
    ? "hr.max"
    : null;
  const resting = toNumberOrNull(hr.resting);
  const lthr = toNumberOrNull(hr.lthr);

  const precedence = [
    "age_220_minus_age_baseline_max",
    "resting_override_to_hrr",
    "lthr_override",
    "max_only_default",
  ];

  if (Number.isFinite(baselineMax) && Number.isFinite(resting) && baselineMax > resting) {
    const hrr = baselineMax - resting;
    const zone = (lo, hi) => ({
      min: Math.round(resting + hrr * lo),
      max: Math.round(resting + hrr * hi),
    });

    return {
      hrZones: {
        method: "HRR",
        source: "hrr_from_baseline_max_and_resting",
        max: baselineMax,
        resting,
        zones: {
          z1: zone(0.50, 0.60),
          z2: zone(0.60, 0.70),
          z3: zone(0.70, 0.80),
          z4: zone(0.80, 0.90),
          z5: zone(0.90, 1.00),
        },
      },
      trace: {
        precedence,
        selectedPath: "resting_override_to_hrr",
        baselineSource,
        age: Number.isFinite(age) ? age : null,
        baselineMax: Math.round(baselineMax),
        resting: Math.round(resting),
      },
    };
  }

  if (Number.isFinite(lthr) && lthr > 0) {
    const zone = (lo, hi) => ({
      min: Math.round(lthr * lo),
      max: Math.round(lthr * hi),
    });

    return {
      hrZones: {
        method: "LTHR",
        source: "lthr_override",
        lthr,
        zones: {
          z1: zone(0.70, 0.80),
          z2: zone(0.80, 0.89),
          z3: zone(0.90, 0.94),
          z4: zone(0.95, 0.99),
          z5: zone(1.00, 1.06),
        },
      },
      trace: {
        precedence,
        selectedPath: "lthr_override",
        baselineSource,
        age: Number.isFinite(age) ? age : null,
        baselineMax: Number.isFinite(baselineMax) ? Math.round(baselineMax) : null,
        lthr: Math.round(lthr),
      },
    };
  }

  if (Number.isFinite(baselineMax)) {
    const zone = (lo, hi) => ({
      min: Math.round(baselineMax * lo),
      max: Math.round(baselineMax * hi),
    });
    return {
      hrZones: {
        method: "MAX",
        source: "max_only_default",
        max: baselineMax,
        zones: {
          z1: zone(0.60, 0.70),
          z2: zone(0.70, 0.80),
          z3: zone(0.80, 0.87),
          z4: zone(0.87, 0.93),
          z5: zone(0.93, 1.00),
        },
      },
      trace: {
        precedence,
        selectedPath: "max_only_default",
        baselineSource,
        age: Number.isFinite(age) ? age : null,
        baselineMax: Math.round(baselineMax),
      },
    };
  }

  return {
    hrZones: null,
    trace: {
      precedence,
      selectedPath: "none",
      baselineSource: null,
      age: Number.isFinite(age) ? age : null,
      baselineMax: null,
      reason: "no_hr_inputs",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   Misc
────────────────────────────────────────────────────────────── */

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v || "").trim().toLowerCase();
  return ["true", "yes", "y", "1"].includes(s);
}

export function normaliseAthleteProfile(athleteProfile = {}) {
  const simpleCfg = simplePlannerModeConfig();
  const simpleModeEnabled = simpleCfg?.enabled === true;
  const strictSimpleMode = isSimplePlannerModeStrict();
  const sourceProfile = strictSimpleMode
    ? buildSimpleModeInputProfile(athleteProfile)
    : athleteProfile;

  const experience = normaliseExperienceLabel(sourceProfile?.current?.experience);
  const experienceKey = normaliseExperienceKey(experience);

  const weeklyKmRaw = toNumberOrNull(sourceProfile?.current?.weeklyKm);
  const weeklyKm = weeklyKmRaw && weeklyKmRaw > 0 ? weeklyKmRaw : 15;

  const longestRunRaw = toNumberOrNull(sourceProfile?.current?.longestRunKm);
  const longestRunDefault = Math.max(RULES.longRun.minKm, weeklyKm * RULES.longRun.startPctOfWeekly);
  const longestRunKm = longestRunRaw && longestRunRaw > 0 ? longestRunRaw : longestRunDefault;

  const sessionsRaw =
    toNumberOrNull(sourceProfile?.availability?.sessionsPerWeek) ??
    toNumberOrNull(sourceProfile?.sessionsPerWeek);

  const sessionsPerWeek = normaliseSessionsPerWeek(sessionsRaw && sessionsRaw > 0 ? sessionsRaw : null);

  const availability = sourceProfile?.availability || {};
  const runDaysRaw =
    availability.runDays ??
    availability.availableDays ??
    availability.daysAvailable ??
    availability.selectedDays ??
    sourceProfile?.runDays ??
    sourceProfile?.availableDays ??
    [];

  const runDaysClean = ensureRunDaysCount(uniqOrderedDays(runDaysRaw), sessionsPerWeek);
  const longRunDay = chooseLongRunDay(availability?.longRunDay, runDaysClean);

  const goalDistanceInput =
    sourceProfile?.goal?.distance || sourceProfile?.goalDistance || "10K";
  const goalDistanceKey = normaliseGoalDistanceKey(goalDistanceInput, {
    fallback: "10K",
  });
  const goalPolicyKey = goalKeyToPolicyKey(goalDistanceKey, "other");
  const byDistanceKey = goalKeyToByDistanceKey(goalDistanceKey, "10k");

  const planLengthRaw =
    toNumberOrNull(sourceProfile?.goal?.planLengthWeeks) ??
    toNumberOrNull(sourceProfile?.weeks);

  const planLengthWeeks =
    planLengthRaw && planLengthRaw > 0
      ? normalisePlanLengthWeeks(planLengthRaw)
      : null;

  const canonicalGoalDate =
    sourceProfile?.goal?.eventDate ||
    sourceProfile?.goal?.targetDate ||
    sourceProfile?.eventDate ||
    sourceProfile?.targetDate ||
    null;
  const eventDate = canonicalGoalDate;
  const targetDate = canonicalGoalDate;

  const difficulty = normalisePublicDifficulty(
    availability?.difficulty ??
      sourceProfile?.difficulty ??
      sourceProfile?.preferences?.difficulty
  );
  const difficultyKey = normaliseDifficultyKey(difficulty);

  const metric = normaliseMetricMode(sourceProfile?.preferences?.metric, "time");
  const treadmill = toBool(sourceProfile?.preferences?.treadmill);

  const timePerSessionMinRaw =
    toNumberOrNull(availability?.timePerSessionMin) ??
    toNumberOrNull(sourceProfile?.preferences?.timePerSessionMin);

  const timePerSessionMin =
    timePerSessionMinRaw && timePerSessionMinRaw > 0
      ? clamp(timePerSessionMinRaw, 20, 180)
      : RULES.timeCaps.weekdayMaxMinDefault;

  const longRunMaxMinRaw =
    toNumberOrNull(availability?.longRunMaxMin) ??
    toNumberOrNull(sourceProfile?.preferences?.longRunMaxMin);

  const longRunMaxMin =
    longRunMaxMinRaw && longRunMaxMinRaw > 0
      ? clamp(longRunMaxMinRaw, 30, 240)
      : RULES.timeCaps.longRunMaxMinDefault;

  // Step 3 contract:
  // In strict simple mode, only use estimated race time / recent PB anchors,
  // then fall back to default policy.
  const allowThresholdPace = strictSimpleMode ? false : true;
  const allowRecentTimesFallback = strictSimpleMode ? false : true;

  const paceResult = derivePacesWithPrecedence(sourceProfile, {
    difficulty,
    experienceKey,
    goalDistanceKey,
    allowThresholdPace,
    allowRecentTimesFallback,
  });
  const explicitPaceOverride = applyExplicitPaceOverrides(
    paceResult?.paces || null,
    sourceProfile
  );
  const paces = explicitPaceOverride?.paces || null;
  const recentRace = paceResult?.recentRace || null;

  // Step 4 contract:
  // In simple mode, auto HR derivation is optional and off by default.
  const allowAutoHrZones =
    !simpleModeEnabled || simpleCfg?.hrZones?.autoDeriveFromProfile === true;
  const hrResult = allowAutoHrZones
    ? deriveHrZonesFromProfile(sourceProfile)
    : {
        hrZones: null,
        trace: {
          precedence: ["manual_hr_only"],
          selectedPath: "disabled",
          reason: "simple_mode_auto_hr_disabled",
        },
      };
  const hrZones = hrResult?.hrZones || null;
  const anchorTrace = {
    pace: paceResult?.trace
      ? {
          ...paceResult.trace,
          explicitOverrides: explicitPaceOverride?.appliedKeys || [],
        }
      : null,
    hr: hrResult?.trace || null,
  };

  // distance-specific rules
  const byD = RULES.byDistance?.[byDistanceKey] || {};
  const taperLastNWeeks = byD.taperLastNWeeks ?? RULES.taper.lastNWeeksDefault;
  const longRunMaxKm = byD.longRunMaxKm ?? RULES.longRun.maxKmDefault;

  return {
    experience,
    experienceKey,
    weeklyKm,
    longestRunKm: clamp(longestRunKm, RULES.longRun.minKm, longRunMaxKm),

    sessionsPerWeek,
    runDays: runDaysClean,
    longRunDay,

    goalDistance: goalDistanceKey,
    goalDistanceKey,
    goalPolicyKey,
    byDistanceKey,
    planLengthWeeks,
    eventDate,
    targetDate,

    difficulty,
    difficultyKey,
    metric,
    treadmill,

    timePerSessionMin,
    longRunMaxMin,

    taperLastNWeeks,
    longRunMaxKm,

    recentRace,
    paces,
    hrZones,
    anchorTrace,
    phaseOverrides: Array.isArray(sourceProfile?.phaseOverrides) ? sourceProfile.phaseOverrides : null,
    recentTrainingSummary: sourceProfile?.recentTrainingSummary || null,
    recentReadinessSummary: sourceProfile?.recentReadinessSummary || null,
    adaptationTrace: sourceProfile?.adaptationTrace || null,

    maxHardSessions: RULES.maxHardSessionsByExperience?.[experience] ?? 1,
    inputContract: {
      mode: strictSimpleMode ? "simple_strict" : "legacy_full",
      simplePlannerModeEnabled: simpleModeEnabled,
      strictInputContract: strictSimpleMode,
    },
  };
}
