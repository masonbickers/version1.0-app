function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function activityProvider(activity = {}) {
  const source = String(activity.source || activity.provider || "").toLowerCase();
  if (source.includes("garmin")) return "garmin";
  if (source.includes("strava")) return "strava";
  return source || "activity";
}

export function activityExternalId(activity = {}) {
  return String(
    activity.activityId ||
      activity.upstreamId ||
      activity.stravaId ||
      activity.garminActivityId ||
      activity.id ||
      activity.rawGarminActivity?.activityId ||
      activity.raw?.activityId ||
      ""
  ).trim();
}

export function activityStartMs(activity = {}) {
  const raw = activity.rawGarminActivity || activity.raw || {};
  return toMillis(
    activity.activityStartTimeMs ||
      activity.startTimeMs ||
      activity.startDateMs ||
      activity.startTime ||
      activity.startDate ||
      activity.startedAt ||
      activity.startDateLocal ||
      activity.startDateGMT ||
      activity.beginTimestamp ||
      activity.beginTimestampGMT ||
      activity.summary?.startTimeInSeconds * 1000 ||
      activity.summary?.summaryStartTimeInSeconds * 1000 ||
      activity.activitySummary?.startTimeInSeconds * 1000 ||
      activity.activitySummary?.summaryStartTimeInSeconds * 1000 ||
      activity.summaryStartTimeInSeconds * 1000 ||
      activity.startTimeInSeconds * 1000 ||
      raw.activityStartTimeMs ||
      raw.startTimeMs ||
      raw.startDateMs ||
      raw.startTime ||
      raw.startDate ||
      raw.startedAt ||
      raw.startDateLocal ||
      raw.startDateGMT ||
      raw.beginTimestamp ||
      raw.beginTimestampGMT ||
      raw.summary?.startTimeInSeconds * 1000 ||
      raw.summary?.summaryStartTimeInSeconds * 1000 ||
      raw.activitySummary?.startTimeInSeconds * 1000 ||
      raw.activitySummary?.summaryStartTimeInSeconds * 1000 ||
      raw.summaryStartTimeInSeconds * 1000 ||
      raw.startTimeInSeconds * 1000
  );
}

export function activityDistanceMeters(activity = {}) {
  const raw = activity.rawGarminActivity || activity.raw || {};
  const direct =
    toNumber(activity.distanceMeters) ||
    toNumber(activity.distanceInMeters) ||
    toNumber(activity.distanceM) ||
    toNumber(activity.distance) ||
    toNumber(raw.distanceMeters) ||
    toNumber(raw.distanceInMeters) ||
    toNumber(raw.distance);
  if (direct > 0) return direct;

  const km = toNumber(activity.distanceKm);
  return km > 0 ? km * 1000 : 0;
}

export function activityDurationSeconds(activity = {}) {
  const raw = activity.rawGarminActivity || activity.raw || {};
  return (
    toNumber(activity.durationSeconds) ||
    toNumber(activity.durationInSeconds) ||
    toNumber(activity.durationSec) ||
    toNumber(activity.movingTimeSec) ||
    toNumber(activity.moving_time) ||
    toNumber(activity.movingTime) ||
    toNumber(activity.elapsedTime) ||
    toNumber(activity.elapsedDurationInSeconds) ||
    toNumber(activity.movingDurationInSeconds) ||
    toNumber(raw.durationSeconds) ||
    toNumber(raw.durationInSeconds) ||
    toNumber(raw.elapsedDurationInSeconds) ||
    toNumber(raw.movingDurationInSeconds)
  );
}

export function activityDedupeKey(activity = {}) {
  const provider = activityProvider(activity);
  const externalId = activityExternalId(activity);
  if (provider && externalId) return `${provider}:${externalId}`;

  const start = activityStartMs(activity);
  const distance = Math.round(activityDistanceMeters(activity) / 50) * 50;
  const duration = Math.round(activityDurationSeconds(activity) / 30) * 30;
  const type = String(activity.type || activity.activityType || activity.sport || "").toLowerCase();

  return [type, start ? Math.round(start / 60000) : "", distance || "", duration || ""]
    .filter(Boolean)
    .join(":");
}

export function likelySameActivity(a = {}, b = {}) {
  const aProvider = activityProvider(a);
  const bProvider = activityProvider(b);
  const aId = activityExternalId(a);
  const bId = activityExternalId(b);

  if (aProvider && bProvider && aProvider === bProvider && aId && bId) {
    return aId === bId;
  }

  const aStart = activityStartMs(a);
  const bStart = activityStartMs(b);
  if (!aStart || !bStart) return false;

  const startDiffMs = Math.abs(aStart - bStart);
  if (startDiffMs > 10 * 60 * 1000) return false;

  const aDistance = activityDistanceMeters(a);
  const bDistance = activityDistanceMeters(b);
  if (aDistance > 0 && bDistance > 0) {
    const distanceDiff = Math.abs(aDistance - bDistance);
    const tolerance = Math.max(200, Math.min(aDistance, bDistance) * 0.04);
    if (distanceDiff > tolerance) return false;
  }

  const aDuration = activityDurationSeconds(a);
  const bDuration = activityDurationSeconds(b);
  if (aDuration > 0 && bDuration > 0) {
    const durationDiff = Math.abs(aDuration - bDuration);
    const tolerance = Math.max(120, Math.min(aDuration, bDuration) * 0.08);
    if (durationDiff > tolerance) return false;
  }

  return aDistance > 0 || bDistance > 0 || aDuration > 0 || bDuration > 0;
}

function activityCompletenessScore(activity = {}) {
  return [
    activityStartMs(activity),
    activityDistanceMeters(activity),
    activityDurationSeconds(activity),
    activity.averageHeartRate || activity.averageHeartrate || activity.average_heartrate,
    activity.calories || activity.activeKilocalories,
    activity.summaryPolyline || activity.polyline,
    activity.routeCoordinates?.length,
  ].filter(Boolean).length;
}

function sourceRank(activity = {}) {
  if (activity.hiddenDuplicate === true) return 99;
  const source = String(activity.source || activity.provider || "").toLowerCase();
  if (source === "garmin_activities" || source === "garmin") return 0;
  if (source === "stravaactivities" || source === "strava") return 1;
  if (source === "garminactivities") return 2;
  return 5;
}

export function choosePreferredActivity(existing, incoming) {
  if (!existing) return incoming;

  const existingRank = sourceRank(existing);
  const incomingRank = sourceRank(incoming);
  if (incomingRank < existingRank) return incoming;
  if (incomingRank > existingRank) return existing;

  return activityCompletenessScore(incoming) > activityCompletenessScore(existing)
    ? incoming
    : existing;
}

export function dedupeActivities(activities = []) {
  const visible = (Array.isArray(activities) ? activities : []).filter(
    (activity) => activity?.hiddenDuplicate !== true
  );
  const deduped = [];

  visible.forEach((activity) => {
    const matchIndex = deduped.findIndex((existing) => likelySameActivity(existing, activity));
    if (matchIndex === -1) {
      deduped.push(activity);
      return;
    }
    deduped[matchIndex] = choosePreferredActivity(deduped[matchIndex], activity);
  });

  return deduped;
}
