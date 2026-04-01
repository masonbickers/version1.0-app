import {
  clamp,
  formatPace,
  goalDistanceToKm,
  normaliseGoalDistance,
  parseTimeToSeconds,
  roundInt,
  toNumberOrNull,
} from "./utils.js";

function parseRecentRace(recentRace = {}) {
  const distance = normaliseGoalDistance(recentRace.distance);
  const distanceKm = toNumberOrNull(recentRace.distanceKm) ?? goalDistanceToKm(distance);
  const timeSec =
    toNumberOrNull(recentRace.timeSec) ?? parseTimeToSeconds(recentRace.time ?? recentRace.result);

  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  if (!Number.isFinite(timeSec) || timeSec <= 0) return null;

  return { distance, distanceKm, timeSec };
}

function fallbackRacePace(goalDistanceKey) {
  const defaults = {
    "5K": 300,
    "10K": 330,
    HALF: 360,
    MARATHON: 390,
    ULTRA: 420,
  };
  return defaults[goalDistanceKey] || 330;
}

export function derivePaces(athleteProfile) {
  const goalDistance = athleteProfile?.goal?.distance || "10K";
  const rr = parseRecentRace(athleteProfile?.pacing?.recentRace || {});

  const threshold = toNumberOrNull(athleteProfile?.pacing?.thresholdPaceSecPerKm);
  const raceSecPerKm = rr ? rr.timeSec / rr.distanceKm : threshold ? threshold / 1.04 : fallbackRacePace(goalDistance);

  const thresholdSecPerKm = threshold || raceSecPerKm * 1.04;
  const easy = {
    minSecPerKm: roundInt(raceSecPerKm * 1.25),
    maxSecPerKm: roundInt(raceSecPerKm * 1.5),
  };
  const steady = {
    minSecPerKm: roundInt(raceSecPerKm * 1.12),
    maxSecPerKm: roundInt(raceSecPerKm * 1.2),
  };
  const tempo = {
    minSecPerKm: roundInt(raceSecPerKm * 1.02),
    maxSecPerKm: roundInt(raceSecPerKm * 1.08),
  };
  const interval = {
    minSecPerKm: roundInt(raceSecPerKm * 0.9),
    maxSecPerKm: roundInt(raceSecPerKm * 0.97),
  };

  return {
    source: rr ? "recent_race" : threshold ? "threshold_pace" : "default_policy",
    recentRace: rr
      ? {
          distance: rr.distance,
          distanceKm: rr.distanceKm,
          timeSec: rr.timeSec,
        }
      : null,
    raceSecPerKm: roundInt(raceSecPerKm),
    thresholdSecPerKm: roundInt(thresholdSecPerKm),
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
  };
}

export function deriveHrZones(athleteProfile) {
  const resting = toNumberOrNull(athleteProfile?.hr?.resting);
  const explicitMax = toNumberOrNull(athleteProfile?.hr?.max);
  const age = toNumberOrNull(athleteProfile?.current?.age);
  const ageMax = Number.isFinite(age) ? roundInt(220 - age) : null;
  const max = Number.isFinite(ageMax) ? ageMax : explicitMax;

  if (!Number.isFinite(max) || max <= 0) return null;

  if (Number.isFinite(resting) && resting > 0 && max > resting) {
    const reserve = max - resting;
    const mk = (minPct, maxPct) => ({
      min: roundInt(clamp(resting + reserve * minPct, resting, max)),
      max: roundInt(clamp(resting + reserve * maxPct, resting, max)),
    });
    return {
      method: "HRR",
      source: Number.isFinite(ageMax) ? "age_derived_max_plus_resting" : "provided_max_plus_resting",
      max,
      resting,
      zones: {
        z1: mk(0.5, 0.6),
        z2: mk(0.6, 0.7),
        z3: mk(0.7, 0.8),
        z4: mk(0.8, 0.9),
        z5: mk(0.9, 1),
      },
    };
  }

  const mk = (minPct, maxPct) => ({
    min: roundInt(max * minPct),
    max: roundInt(max * maxPct),
  });
  return {
    method: "MAX_HR",
    source: Number.isFinite(ageMax) ? "age_derived_max_only" : "provided_max_only",
    max,
    resting: Number.isFinite(resting) ? resting : null,
    zones: {
      z1: mk(0.6, 0.7),
      z2: mk(0.7, 0.78),
      z3: mk(0.78, 0.85),
      z4: mk(0.85, 0.92),
      z5: mk(0.92, 1),
    },
  };
}

