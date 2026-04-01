import { clamp, formatPace, goalDistanceKm, roundInt } from "./utils.js";

function defaultRacePaceSecPerKm(goalDistanceKey) {
  const byGoal = {
    "5K": 300,       // 5:00/km
    "10K": 330,      // 5:30/km
    HALF: 360,       // 6:00/km
    MARATHON: 390,   // 6:30/km
    ULTRA: 420,      // 7:00/km
  };
  return byGoal[goalDistanceKey] || 330;
}

function parsePositiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : null;
}

function parseDurationToSec(value) {
  if (Number.isFinite(value) && value > 0) return Number(value);
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    return sec > 0 ? sec : null;
  }

  const parts = trimmed.split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (parts.length === 2) {
    const [mm, ss] = parts;
    return mm * 60 + ss;
  }

  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    return hh * 3600 + mm * 60 + ss;
  }

  return null;
}

function parseRaceDistanceKm(recentRace, fallbackGoalDistanceKm) {
  if (!recentRace || typeof recentRace !== "object") return fallbackGoalDistanceKm;

  const directKm = parsePositiveNumber(recentRace.distanceKm);
  if (directKm) return directKm;

  const mapped = goalDistanceKm(recentRace.distance);
  if (Number.isFinite(mapped) && mapped > 0) return mapped;

  return fallbackGoalDistanceKm;
}

function distanceConversionExponent(fromDistanceKm, toDistanceKm) {
  if (
    !Number.isFinite(fromDistanceKm) ||
    !Number.isFinite(toDistanceKm) ||
    fromDistanceKm <= 0 ||
    toDistanceKm <= 0
  ) {
    return 1.06;
  }

  const ratio = toDistanceKm / fromDistanceKm;

  if (ratio <= 0.9) return 1.04;     // longer recent race -> shorter target
  if (ratio <= 1.1) return 1.06;     // similar distance
  if (ratio <= 2.2) return 1.065;    // moderate jump
  return 1.07;                       // bigger jump, more conservative
}

function riegelEquivalentTimeSec(fromTimeSec, fromDistanceKm, toDistanceKm) {
  if (
    !Number.isFinite(fromTimeSec) || fromTimeSec <= 0 ||
    !Number.isFinite(fromDistanceKm) || fromDistanceKm <= 0 ||
    !Number.isFinite(toDistanceKm) || toDistanceKm <= 0
  ) {
    return null;
  }

  const exponent = distanceConversionExponent(fromDistanceKm, toDistanceKm);
  return fromTimeSec * Math.pow(toDistanceKm / fromDistanceKm, exponent);
}

function deriveAdvancedPaceBands(raceSecPerKm, thresholdSecPerKm, goalKm) {
  const isShort = goalKm <= 5;
  const is10k = goalKm > 5 && goalKm <= 10;
  const isHalf = goalKm > 10 && goalKm <= 21.2;
  const isMarathonPlus = goalKm > 21.2;

  let easyLoMul = 1.20;
  let easyHiMul = 1.38;
  let steadyLoMul = 1.08;
  let steadyHiMul = 1.16;
  let intervalLoMul = 0.89;
  let intervalHiMul = 0.95;

  if (isShort) {
    easyLoMul = 1.22;
    easyHiMul = 1.42;
    steadyLoMul = 1.10;
    steadyHiMul = 1.18;
    intervalLoMul = 0.87;
    intervalHiMul = 0.94;
  } else if (is10k) {
    easyLoMul = 1.21;
    easyHiMul = 1.40;
    steadyLoMul = 1.09;
    steadyHiMul = 1.17;
    intervalLoMul = 0.88;
    intervalHiMul = 0.95;
  } else if (isHalf) {
    easyLoMul = 1.18;
    easyHiMul = 1.34;
    steadyLoMul = 1.06;
    steadyHiMul = 1.13;
    intervalLoMul = 0.90;
    intervalHiMul = 0.96;
  } else if (isMarathonPlus) {
    easyLoMul = 1.16;
    easyHiMul = 1.30;
    steadyLoMul = 1.04;
    steadyHiMul = 1.10;
    intervalLoMul = 0.91;
    intervalHiMul = 0.97;
  }

  const easy = {
    minSecPerKm: roundInt(raceSecPerKm * easyLoMul),
    maxSecPerKm: roundInt(raceSecPerKm * easyHiMul),
  };

  const steady = {
    minSecPerKm: roundInt(raceSecPerKm * steadyLoMul),
    maxSecPerKm: roundInt(raceSecPerKm * steadyHiMul),
  };

  const tempo = {
    minSecPerKm: roundInt(thresholdSecPerKm * 0.99),
    maxSecPerKm: roundInt(thresholdSecPerKm * 1.03),
  };

  const interval = {
    minSecPerKm: roundInt(raceSecPerKm * intervalLoMul),
    maxSecPerKm: roundInt(raceSecPerKm * intervalHiMul),
  };

  return { easy, steady, tempo, interval };
}

function deriveRacePaceFromThreshold(thresholdSecPerKm) {
  return thresholdSecPerKm / 1.035;
}

function maybeApplyCurrentFitnessGuardrails(raceSecPerKm, profile, source) {
  const current = profile?.current ?? {};
  const weeklyKm = parsePositiveNumber(current.weeklyKm);
  const experience = String(current.experience || "").toLowerCase();

  let adjusted = raceSecPerKm;

  // Be more conservative only when using weaker anchors.
  const weakAnchor = source === "default_policy";

  if (weakAnchor && weeklyKm && weeklyKm < 20) adjusted *= 1.02;
  else if (weeklyKm && weeklyKm < 20) adjusted *= 1.01;

  if (weakAnchor && experience.includes("beginner")) adjusted *= 1.02;
  else if (experience.includes("beginner")) adjusted *= 1.01;

  return adjusted;
}

function applyPaceSanityClamp(secPerKm, goalKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return secPerKm;

  // Broad but useful guardrails.
  let min = 150; // 2:30/km
  let max = 540; // 9:00/km

  if (goalKm >= 42) {
    min = 165;
    max = 600;
  } else if (goalKm >= 21.1) {
    min = 155;
    max = 570;
  }

  return clamp(secPerKm, min, max);
}

export function derivePaces(profile) {
  const pacing = profile?.pacing ?? {};
  const recentRace = pacing?.recentRace ?? null;

  const goalDistanceKey = profile?.goal?.distance;
  const goalKm = goalDistanceKm(goalDistanceKey) || 10;

  const rrKm = parseRaceDistanceKm(recentRace, goalKm);
  const recentRaceTimeSec =
    parsePositiveNumber(recentRace?.timeSec) ??
    parseDurationToSec(recentRace?.time);

  const providedThresholdPace = parsePositiveNumber(pacing?.thresholdPaceSecPerKm);

  let raceSecPerKm = null;
  let thresholdSecPerKm = null;
  let source = "default_policy";
  let thresholdDerivedFromRace = false;

  if (providedThresholdPace) {
    thresholdSecPerKm = providedThresholdPace;
    raceSecPerKm = deriveRacePaceFromThreshold(providedThresholdPace);
    source = "threshold_pace";
  } else if (recentRaceTimeSec && rrKm) {
    const equivalentGoalTimeSec = riegelEquivalentTimeSec(recentRaceTimeSec, rrKm, goalKm);
    raceSecPerKm = equivalentGoalTimeSec / goalKm;
    thresholdSecPerKm = raceSecPerKm * 1.03;
    thresholdDerivedFromRace = true;
    source = "recent_race";
  } else {
    raceSecPerKm = defaultRacePaceSecPerKm(goalDistanceKey);
    thresholdSecPerKm = raceSecPerKm * 1.03;
    thresholdDerivedFromRace = true;
    source = "default_policy";
  }

  raceSecPerKm = maybeApplyCurrentFitnessGuardrails(raceSecPerKm, profile, source);
  raceSecPerKm = applyPaceSanityClamp(raceSecPerKm, goalKm);

  if (thresholdDerivedFromRace) {
    thresholdSecPerKm = raceSecPerKm * 1.03;
  }

  raceSecPerKm = roundInt(raceSecPerKm);
  thresholdSecPerKm = roundInt(thresholdSecPerKm);

  const { easy, steady, tempo, interval } = deriveAdvancedPaceBands(
    raceSecPerKm,
    thresholdSecPerKm,
    goalKm
  );

  const recentRaceInfo =
    recentRaceTimeSec && rrKm
      ? {
          distanceKm: rrKm,
          timeSec: roundInt(recentRaceTimeSec),
          paceSecPerKm: roundInt(recentRaceTimeSec / rrKm),
        }
      : null;

  return {
    source,
    recentRace: recentRaceInfo,
    raceSecPerKm,
    thresholdSecPerKm,
    easy,
    steady,
    tempo,
    interval,
    formatted: {
      race: formatPace(raceSecPerKm),
      threshold: formatPace(thresholdSecPerKm),
      easy: `${formatPace(easy.minSecPerKm)}-${formatPace(easy.maxSecPerKm)}`,
      steady: `${formatPace(steady.minSecPerKm)}-${formatPace(steady.maxSecPerKm)}`,
      tempo: `${formatPace(tempo.minSecPerKm)}-${formatPace(tempo.maxSecPerKm)}`,
      interval: `${formatPace(interval.minSecPerKm)}-${formatPace(interval.maxSecPerKm)}`,
    },
    debug: {
      goalKm,
      recentRaceDistanceKm: recentRaceInfo?.distanceKm ?? null,
      recentRacePaceSecPerKm: recentRaceInfo?.paceSecPerKm ?? null,
      conversionExponent:
        recentRaceInfo?.distanceKm && goalKm
          ? distanceConversionExponent(recentRaceInfo.distanceKm, goalKm)
          : null,
      thresholdDerivedFromRace,
    },
  };
}

export function deriveHrZones(profile) {
  const resting = parsePositiveNumber(profile?.hr?.resting);
  const providedMax = parsePositiveNumber(profile?.hr?.max);
  const age = parsePositiveNumber(profile?.current?.age);
  const derivedMax = age ? roundInt(220 - age) : null;

  // Prefer provided max HR over age formula.
  const max = providedMax || derivedMax;
  if (!Number.isFinite(max) || max <= 0) return null;

  if (resting && max > resting) {
    const reserve = max - resting;
    const zone = (lo, hi) => ({
      min: roundInt(clamp(resting + reserve * lo, resting, max)),
      max: roundInt(clamp(resting + reserve * hi, resting, max)),
    });

    return {
      method: "HRR",
      source: providedMax
        ? "provided_max_plus_resting"
        : "age_derived_max_plus_resting",
      max,
      resting,
      zones: {
        z1: zone(0.50, 0.60),
        z2: zone(0.60, 0.70),
        z3: zone(0.70, 0.80),
        z4: zone(0.80, 0.90),
        z5: zone(0.90, 1.00),
      },
    };
  }

  const zone = (lo, hi) => ({
    min: roundInt(max * lo),
    max: roundInt(max * hi),
  });

  return {
    method: "MAX_HR",
    source: providedMax ? "provided_max_only" : "age_derived_max_only",
    max,
    resting: resting || null,
    zones: {
      z1: zone(0.60, 0.70),
      z2: zone(0.70, 0.78),
      z3: zone(0.78, 0.85),
      z4: zone(0.85, 0.92),
      z5: zone(0.92, 1.00),
    },
  };
}