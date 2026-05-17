const QUALITY_TYPES = new Set(["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "VO2", "RACE"]);

function toNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function firstNumber(...values) {
  for (const value of values) {
    const n = toNumber(value, null);
    if (n != null) return n;
  }
  return null;
}

function normalizeKind(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!raw) return "";
  if (["EASY_RUN", "RECOVERY", "AEROBIC", "BASE"].includes(raw)) return "EASY";
  if (["LONG_RUN", "LONGRUN"].includes(raw)) return "LONG";
  if (["INTERVAL", "REPEATS", "SPEED"].includes(raw)) return "INTERVALS";
  if (["TEMPO_RUN", "STEADY"].includes(raw)) return "TEMPO";
  if (["THRESH", "THRESHOLD_RUN"].includes(raw)) return "THRESHOLD";
  if (["RACE_DAY", "TIME_TRIAL", "TIMED_EFFORT"].includes(raw)) return "RACE";
  return raw;
}

function plannedKind(session = {}) {
  return normalizeKind(
    session.workoutKind ||
      session.type ||
      session.sessionType ||
      session.role ||
      session.workout?.kind ||
      session.kind
  ) || "EASY";
}

function activityKind(activity = {}) {
  return normalizeKind(
    activity.completedWorkoutType ||
      activity.workoutType ||
      activity.sessionType ||
      activity.plannedType ||
      activity.type ||
      activity.kind
  );
}

function distanceKmFrom(value = {}) {
  const meters = firstNumber(value.distanceMeters, value.actualDistanceMeters, value.movingDistanceMeters);
  if (meters != null) return meters / 1000;
  return firstNumber(
    value.distanceKm,
    value.actualDistanceKm,
    value.movingDistanceKm,
    value.completedDistanceKm,
    value.totalDistanceKm
  );
}

function plannedDistanceKm(session = {}) {
  const meters = firstNumber(session.distanceMeters, session.plannedDistanceMeters, session.workout?.estimatedDistanceMeters);
  if (meters != null) return meters / 1000;
  return firstNumber(
    session.plannedDistanceKm,
    session.distanceKm,
    session.distance,
    session.targetDistanceKm,
    session.budgetedDistanceKm
  );
}

function secondsFromMinutes(value) {
  const n = toNumber(value, null);
  return n == null ? null : n * 60;
}

function sumStepTime(steps = [], multiplier = 1) {
  if (!Array.isArray(steps)) return 0;
  return steps.reduce((sum, step) => {
    if (!step || typeof step !== "object") return sum;
    if (String(step.stepType || "").toLowerCase() === "repeat") {
      const repeats = Math.max(1, Number(step.repeatCount) || 1);
      return sum + sumStepTime(step.steps, multiplier * repeats);
    }
    if (String(step.durationType || "").toLowerCase() !== "time") return sum;
    const seconds = toNumber(step.durationValue, 0) || 0;
    return sum + seconds * multiplier;
  }, 0);
}

function plannedDurationSec(session = {}, paceModel = null) {
  const explicit = firstNumber(
    session.plannedDurationSec,
    session.targetDurationSec,
    session.expectedDurationSec,
    session.durationSec,
    session.workout?.estimatedDurationSec,
    session.workout?.durationSec
  );
  if (explicit != null) return explicit;

  const fromMinutes = firstNumber(
    secondsFromMinutes(session.plannedDurationMin),
    secondsFromMinutes(session.durationMin),
    secondsFromMinutes(session.durationMinutes),
    secondsFromMinutes(session.targetDurationMin)
  );
  if (fromMinutes != null) return fromMinutes;

  const stepSeconds = sumStepTime(session.workout?.steps || session.workoutSteps);
  if (stepSeconds > 0) return stepSeconds;

  const km = plannedDistanceKm(session);
  const paces = paceRangeForKind(plannedKind(session), paceModel);
  if (km != null && paces?.avgSecPerKm) return km * paces.avgSecPerKm;
  return null;
}

function activityDurationSec(activity = {}) {
  return firstNumber(
    activity.actualDurationSec,
    activity.movingTimeSec,
    activity.durationSec,
    activity.elapsedTimeSec,
    activity.elapsedSec,
    activity.timeSec,
    secondsFromMinutes(activity.durationMin),
    secondsFromMinutes(activity.durationMinutes)
  );
}

function paceSecPerKm(activity = {}) {
  const explicit = firstNumber(
    activity.avgPaceSecPerKm,
    activity.averagePaceSecPerKm,
    activity.paceSecPerKm,
    activity.movingPaceSecPerKm
  );
  if (explicit != null) return explicit;
  const km = distanceKmFrom(activity);
  const seconds = activityDurationSec(activity);
  return km != null && km > 0 && seconds != null && seconds > 0 ? seconds / km : null;
}

function paceKeyForKind(kind) {
  const k = normalizeKind(kind);
  if (k === "INTERVALS" || k === "VO2" || k === "HILLS") return "interval";
  if (k === "TEMPO" || k === "THRESHOLD") return "threshold";
  if (k === "RACE") return "racePace";
  if (k === "LONG") return "easy";
  return "easy";
}

function paceRangeForKind(kind, paceModel = null) {
  const paces = paceModel?.trainingPaces || {};
  const target = paces[paceKeyForKind(kind)] || null;
  if (!target || typeof target !== "object") return null;
  const exact = firstNumber(target.valueSecPerKm, target.secPerKm, target.paceSecPerKm);
  const min = firstNumber(target.minSecPerKm, target.min);
  const max = firstNumber(target.maxSecPerKm, target.max);
  if (exact != null) return { minSecPerKm: exact, maxSecPerKm: exact, avgSecPerKm: exact };
  if (min != null && max != null) return { minSecPerKm: min, maxSecPerKm: max, avgSecPerKm: (min + max) / 2 };
  return null;
}

function hrRangeForKind(kind, paceModel = null) {
  const zones = paceModel?.hrZones?.zones || paceModel?.hrZones || {};
  const k = normalizeKind(kind);
  const zone =
    k === "INTERVALS" || k === "VO2" || k === "RACE"
      ? zones.z5 || zones.Z5 || zones.interval
      : k === "TEMPO" || k === "THRESHOLD"
        ? zones.z4 || zones.Z4 || zones.threshold
        : zones.z2 || zones.Z2 || zones.easy;
  if (!zone || typeof zone !== "object") return null;
  const min = firstNumber(zone.min, zone.minBpm, zone.from);
  const max = firstNumber(zone.max, zone.maxBpm, zone.to);
  return min != null || max != null ? { minBpm: min, maxBpm: max } : null;
}

function matchByRatio({ planned, actual, goodLow = 0.9, goodHigh = 1.1, excessive = 1.2 } = {}) {
  if (planned == null || planned <= 0) {
    return { status: "unknown", planned: planned ?? null, actual: actual ?? null, ratio: null, score: 100 };
  }
  const ratio = actual != null ? actual / planned : 0;
  let status = "matched";
  let score = 100;
  if (ratio <= 0.01) {
    status = "missed";
    score = 0;
  } else if (ratio < 0.75) {
    status = "under";
    score = clamp(Math.round((ratio / goodLow) * 100), 0, 74);
  } else if (ratio < goodLow) {
    status = "slightly_under";
    score = 82;
  } else if (ratio <= goodHigh) {
    status = "matched";
    score = 100;
  } else if (ratio <= excessive) {
    status = "over";
    score = 82;
  } else {
    status = "excessive";
    score = 55;
  }
  return {
    status,
    planned: round(planned),
    actual: actual != null ? round(actual) : null,
    ratio: round(ratio),
    score,
  };
}

function qualityWorkSeconds(activity = {}) {
  const direct = firstNumber(
    activity.qualityWorkSec,
    activity.intensityWorkSec,
    activity.thresholdWorkSec,
    activity.tempoWorkSec,
    activity.intervalWorkSec,
    activity.racePaceWorkSec
  );
  if (direct != null) return direct;
  if (Array.isArray(activity.intervals)) {
    return activity.intervals.reduce((sum, rep) => sum + (toNumber(rep?.durationSec, 0) || 0), 0);
  }
  return 0;
}

function avgHeartRate(activity = {}) {
  return firstNumber(
    activity.avgHr,
    activity.averageHr,
    activity.averageHeartRate,
    activity.heartRateAvg,
    activity.hr?.avg,
    activity.heartRate?.avg
  );
}

function hasNoActivity(activity) {
  if (!activity) return true;
  const status = String(activity.status || activity.completionStatus || "").toLowerCase();
  if (["missed", "skipped", "not_completed", "not-completed"].includes(status)) return true;
  const km = distanceKmFrom(activity);
  const seconds = activityDurationSec(activity);
  return (km == null || km <= 0.01) && (seconds == null || seconds <= 0);
}

function buildIntensityMatch({ kind, activity, paceModel, notes, recommendations }) {
  const plannedType = normalizeKind(kind);
  const actualType = activityKind(activity);
  const actualPace = paceSecPerKm(activity);
  const targetPace = paceRangeForKind(plannedType, paceModel);
  const actualHr = avgHeartRate(activity);
  const targetHr = hrRangeForKind(plannedType, paceModel);
  const isQuality = QUALITY_TYPES.has(plannedType);
  const qualitySec = qualityWorkSeconds(activity);
  const typeMismatch = actualType && actualType !== "RUN" && actualType !== "RUNNING" && actualType !== plannedType;

  let status = "unknown";
  let score = 100;

  if (typeMismatch) {
    status = "mismatched";
    score = 55;
    notes.push(`Completed workout type ${actualType} did not match planned ${plannedType}.`);
  }

  if (isQuality) {
    if (qualitySec < 120 && !["RACE"].includes(plannedType)) {
      status = "missing_quality";
      score = Math.min(score, 45);
      notes.push("The session was planned as quality work, but the completed activity shows little or no intensity work.");
      recommendations.push("Treat this as a partial quality session and avoid stacking the missed intensity into the next run.");
    } else if (status === "unknown") {
      status = "matched";
    }
  } else if (status === "unknown") {
    status = "matched";
  }

  if (targetPace && actualPace != null) {
    const tooFast = actualPace < targetPace.minSecPerKm * 0.95;
    const tooSlow = actualPace > targetPace.maxSecPerKm * 1.15;
    if (!isQuality && tooFast) {
      status = "too_fast";
      score = Math.min(score, 62);
      notes.push("Easy effort was faster than the planned easy range.");
      recommendations.push("Keep the next easy run genuinely easy to protect recovery.");
    } else if (tooSlow && isQuality) {
      status = status === "missing_quality" ? status : "under_effort";
      score = Math.min(score, 70);
      notes.push("Average pace was slower than the planned quality range.");
    }
  }

  if (targetHr?.maxBpm != null && actualHr != null && actualHr > targetHr.maxBpm + 8) {
    score = Math.min(score, 72);
    notes.push("Average heart rate was much higher than expected for this session.");
    recommendations.push("Watch fatigue, heat, illness, or accumulated load before the next hard run.");
  }

  return {
    status,
    score,
    plannedType,
    actualType: actualType || null,
    qualityWorkSec: qualitySec,
    actualPaceSecPerKm: actualPace != null ? Math.round(actualPace) : null,
    targetPaceRangeSecPerKm: targetPace
      ? { min: Math.round(targetPace.minSecPerKm), max: Math.round(targetPace.maxSecPerKm) }
      : null,
    avgHr: actualHr,
    targetHrRange: targetHr,
  };
}

export function analyseRunSessionCompletion({ plannedSession, completedActivity, paceModel } = {}) {
  const notes = [];
  const recommendations = [];
  const kind = plannedKind(plannedSession);
  const plannedKm = plannedDistanceKm(plannedSession);
  const plannedSec = plannedDurationSec(plannedSession, paceModel);

  if (hasNoActivity(completedActivity)) {
    return {
      status: "missed",
      completionScore: 0,
      volumeMatch: { status: "missed", planned: round(plannedKm), actual: 0, ratio: 0, score: 0 },
      intensityMatch: { status: "missed", score: 0, plannedType: kind, actualType: null },
      durationMatch: { status: "missed", planned: plannedSec != null ? Math.round(plannedSec) : null, actual: 0, ratio: 0, score: 0 },
      notes: ["No completed run activity was available for this planned session."],
      recommendations: ["Leave the session missed rather than trying to catch up the full workload."],
    };
  }

  const actualKm = distanceKmFrom(completedActivity);
  const actualSec = activityDurationSec(completedActivity);
  const volumeMatch = matchByRatio({ planned: plannedKm, actual: actualKm });
  const durationMatch = matchByRatio({ planned: plannedSec, actual: actualSec });
  const intensityMatch = buildIntensityMatch({ kind, activity: completedActivity, paceModel, notes, recommendations });

  if (volumeMatch.status === "excessive") {
    notes.push("Completed distance was more than 120% of the planned distance.");
    recommendations.push("Do not add extra volume to the next run to compensate for this over-completion.");
  }
  if (kind === "LONG" && ["under", "slightly_under"].includes(volumeMatch.status)) {
    notes.push("Long run was shorter than planned.");
    recommendations.push("Keep the next long run controlled rather than forcing a full catch-up.");
  }

  let status = "completed";
  if (volumeMatch.status === "excessive") {
    status = "overdone";
  } else if (intensityMatch.status === "too_fast") {
    status = "overdone";
  } else if (intensityMatch.status === "mismatched" || intensityMatch.status === "missing_quality") {
    status = volumeMatch.score < 75 ? "partial" : "mismatched";
  } else if (["under", "slightly_under"].includes(volumeMatch.status) || ["under", "slightly_under"].includes(durationMatch.status)) {
    status = "partial";
  }

  const score = Math.round(
    clamp(
      volumeMatch.score * 0.45 +
        durationMatch.score * 0.2 +
        intensityMatch.score * 0.35,
      0,
      100
    )
  );

  return {
    status,
    completionScore: score,
    volumeMatch,
    intensityMatch,
    durationMatch,
    notes,
    recommendations,
  };
}

export default analyseRunSessionCompletion;
