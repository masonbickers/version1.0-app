function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function kmFromMeters(value) {
  const meters = toFiniteNumber(value);
  return meters != null && meters > 0 ? meters / 1000 : null;
}

export function plannedSessionTargetDistanceKm(session = {}) {
  const value =
    session?.workout?.totalDistanceKm ??
    session?.targetDistanceKm ??
    session?.plannedDistanceKm ??
    session?.distanceKm ??
    session?.totalDistanceKm ??
    (toFiniteNumber(session?.workout?.totalDistanceMeters) > 0
      ? toFiniteNumber(session.workout.totalDistanceMeters) / 1000
      : null);
  const numeric = toFiniteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

export function plannedSessionTargetDurationMin(session = {}) {
  const value =
    session?.workout?.totalDurationSec != null
      ? toFiniteNumber(session.workout.totalDurationSec) / 60
      : session?.targetDurationMin ?? session?.durationMin ?? session?.totalDurationMin;
  const numeric = toFiniteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

export function sessionSportKind(session = {}) {
  const raw = String(
    session?.workout?.sport || session?.sessionType || session?.type || ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym")) return "strength";
  if (raw.includes("run")) return "run";

  const runTypes = new Set([
    "easy",
    "recovery",
    "interval",
    "intervals",
    "threshold",
    "tempo",
    "long",
    "race",
    "strides",
    "fartlek",
  ]);
  if (runTypes.has(raw)) return "run";

  const text = [
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|press|row|lift)\b/.test(text)) {
    return "strength";
  }
  if (/\b(run|running|easy|tempo|interval|threshold|long|race pace|fartlek|strides)\b/.test(text)) {
    return "run";
  }

  return "other";
}

export function activitySportKind(activity = {}) {
  const text = `${activity?.type || ""} ${activity?.title || ""} ${activity?.name || ""}`.toLowerCase();
  if (/\b(run|running|trail|treadmill|walk|walking)\b/.test(text)) return "run";
  if (/\b(strength|weight|weights|gym|cardio|fitness|training|workout)\b/.test(text)) return "strength";
  if (toFiniteNumber(activity?.distanceMeters) > 1000) return "run";
  return "other";
}

function activityDateMatches(activity, plannedIsoDate) {
  const planned = String(plannedIsoDate || "").trim();
  const actual = String(activity?.isoDate || activity?.date || "").trim();
  return !planned || !actual || planned === actual;
}

export function activityMatchIdentity(activity = {}) {
  return {
    activityId: String(
      activity?.activityId ||
        activity?.id ||
        activity?.sourceDocId ||
        activity?.reference ||
        activity?.upstreamId ||
        ""
    ).trim(),
    activitySource: String(activity?.activitySource || activity?.source || activity?.collection || "").trim(),
  };
}

export function ignoredActivityMatchKey(activity = {}, sessionKey = "") {
  const { activityId, activitySource } = activityMatchIdentity(activity);
  const key = String(sessionKey || "").trim();
  if (!activityId || !activitySource || !key) return "";
  return `${activitySource}:${activityId}:${key}`;
}

function normaliseIgnoredActivityMatches(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function isActivitySessionMatchIgnored({ activity, sessionKey, sessionLog } = {}) {
  const expectedSessionKey = String(sessionKey || "").trim();
  const { activityId, activitySource } = activityMatchIdentity(activity);
  if (!expectedSessionKey || !activityId || !activitySource) return false;

  const ignoredSessionKeys = Array.isArray(activity?.ignoredSessionKeys) ? activity.ignoredSessionKeys : [];
  if (ignoredSessionKeys.map((key) => String(key || "").trim()).includes(expectedSessionKey)) {
    return true;
  }

  return normaliseIgnoredActivityMatches(sessionLog?.ignoredActivityMatches).some((item) => {
    const itemSessionKey = String(item?.sessionKey || expectedSessionKey).trim();
    const itemActivityId = String(item?.activityId || item?.id || item?.reference || "").trim();
    const itemActivitySource = String(item?.activitySource || item?.source || item?.collection || "").trim();
    return (
      itemSessionKey === expectedSessionKey &&
      itemActivityId === activityId &&
      itemActivitySource === activitySource
    );
  });
}

export function validateExternalActivityPlannedSessionMatch({
  activity,
  session,
  plannedIsoDate = "",
} = {}) {
  if (!activity || !session) {
    return { matches: false, score: 0, reason: "Missing activity or planned session." };
  }

  if (!activityDateMatches(activity, plannedIsoDate)) {
    return {
      matches: false,
      score: 0,
      reason: "Activity date does not match the planned session date.",
    };
  }

  const plannedSport = sessionSportKind(session);
  const actualSport = activitySportKind(activity);
  const plannedDistanceKm = plannedSessionTargetDistanceKm(session);
  const actualDistanceKm =
    kmFromMeters(activity?.distanceMeters) ??
    toFiniteNumber(activity?.distanceKm) ??
    kmFromMeters(activity?.distance);
  const plannedDurationMin = plannedSessionTargetDurationMin(session);
  const actualDurationMin =
    toFiniteNumber(activity?.durationSeconds) != null
      ? toFiniteNumber(activity.durationSeconds) / 60
      : toFiniteNumber(activity?.movingTimeMin) ??
        toFiniteNumber(activity?.elapsedTimeMin) ??
        toFiniteNumber(activity?.durationMin);

  let score = plannedIsoDate && activity?.isoDate ? 8 : 0;

  if (plannedSport === "run") {
    if (actualSport !== "run" && !(actualDistanceKm > 0.5)) {
      return { matches: false, score, reason: "Activity is not a run." };
    }
    score += actualSport === "run" ? 38 : 18;

    const hasPlannedMetric = plannedDistanceKm || plannedDurationMin;
    let matchedMetric = false;

    if (!hasPlannedMetric) {
      return {
        matches: false,
        score,
        reason: "Planned run has no distance or duration target to verify against.",
      };
    }

    if (plannedDistanceKm) {
      if (!(actualDistanceKm > 0)) {
        return { matches: false, score, reason: "Run is missing distance, so it cannot be checked." };
      }
      const diffRatio = Math.abs(actualDistanceKm - plannedDistanceKm) / Math.max(plannedDistanceKm, 0.1);
      if (diffRatio <= 0.08) {
        score += 32;
        matchedMetric = true;
      } else if (diffRatio <= 0.18) {
        score += 24;
        matchedMetric = true;
      } else if (diffRatio <= 0.30) {
        score += 10;
        matchedMetric = true;
      } else {
        return { matches: false, score, reason: "Run distance is too different from the planned session." };
      }
    }

    if (plannedDurationMin) {
      if (!(actualDurationMin > 0)) {
        return { matches: false, score, reason: "Run is missing duration, so it cannot be checked." };
      }
      const diffRatio = Math.abs(actualDurationMin - plannedDurationMin) / Math.max(plannedDurationMin, 1);
      if (diffRatio <= 0.12) {
        score += 24;
        matchedMetric = true;
      } else if (diffRatio <= 0.25) {
        score += 16;
        matchedMetric = true;
      } else if (diffRatio <= 0.40) {
        score += 6;
        matchedMetric = true;
      } else if (!plannedDistanceKm) {
        return { matches: false, score, reason: "Run duration is too different from the planned session." };
      } else {
        score -= 10;
      }
    }

    if (hasPlannedMetric && !matchedMetric) {
      return { matches: false, score, reason: "Activity does not match the planned run targets." };
    }
  } else if (plannedSport === "strength") {
    if (actualSport === "run" || actualDistanceKm > 0.5) {
      return { matches: false, score, reason: "Activity is not a strength session." };
    }
    score += actualSport === "strength" ? 48 : 24;

    if (plannedDurationMin && actualDurationMin > 0) {
      const diffRatio = Math.abs(actualDurationMin - plannedDurationMin) / Math.max(plannedDurationMin, 1);
      if (diffRatio <= 0.30) score += 18;
      else if (diffRatio <= 0.60) score += 8;
      else return { matches: false, score, reason: "Strength duration is too different from the plan." };
    }
  } else {
    if (plannedSport !== actualSport) {
      return { matches: false, score, reason: "Activity type does not match the planned session." };
    }
    score += 32;
  }

  if (activity?.provider === "Garmin" || activity?.provider === "Strava") score += 8;

  if (score < 54) {
    return { matches: false, score, reason: "Activity match confidence is too low." };
  }

  return {
    matches: true,
    score,
    reason: "Activity matches the planned session.",
    plannedSport,
    actualSport,
    plannedDistanceKm,
    actualDistanceKm,
    plannedDurationMin,
    actualDurationMin,
  };
}

export function matchImportedActivityToPlannedSession(activity, plannedSession) {
  if (!activity || !plannedSession?.key || !plannedSession?.sess) return null;
  if (activity?.linkedSessionKey || activity?.linkedTrainSessionId) return null;
  if (String(activity?.linkStatus || "").toLowerCase() === "ignored") return null;
  if (
    isActivitySessionMatchIgnored({
      activity,
      sessionKey: plannedSession.key,
      sessionLog: plannedSession.log,
    })
  ) {
    return null;
  }
  if (plannedSession?.status === "completed") return null;

  const result = validateExternalActivityPlannedSessionMatch({
    activity,
    session: plannedSession.sess,
    plannedIsoDate: plannedSession.isoDate,
  });

  if (!result.matches) return null;
  return {
    score: result.score,
    activity,
    sessionCard: plannedSession,
    provider: activity.provider || "Imported",
    match: result,
  };
}

export function buildLinkedActivityPayload(activity = {}) {
  return {
    provider: activity.provider || "Imported",
    reference: String(activity.id || activity.reference || activity.sourceDocId || ""),
    source: activity.source || activity.collection || null,
    sourceDocId: String(activity.sourceDocId || activity.id || activity.reference || ""),
    type: String(activity.type || ""),
    title: String(activity.title || activity.name || "Workout"),
    startDate: activity.startMs ? new Date(activity.startMs).toISOString() : activity.startDate || null,
    startDateLocal: activity.startMs
      ? new Date(activity.startMs).toISOString()
      : activity.startDateLocal || activity.startDate || null,
    deviceName: activity.device || activity.deviceName || null,
    distanceKm:
      Number(activity.distanceMeters) > 0
        ? Number((Number(activity.distanceMeters) / 1000).toFixed(3))
        : Number(activity.distanceKm) > 0
        ? Number(Number(activity.distanceKm).toFixed(3))
        : null,
    movingTimeMin:
      Number(activity.durationSeconds) > 0
        ? Number((Number(activity.durationSeconds) / 60).toFixed(1))
        : Number(activity.movingTimeMin) > 0
        ? Number(Number(activity.movingTimeMin).toFixed(1))
        : null,
    elapsedTimeMin:
      Number(activity.durationSeconds) > 0
        ? Number((Number(activity.durationSeconds) / 60).toFixed(1))
        : Number(activity.elapsedTimeMin) > 0
        ? Number(Number(activity.elapsedTimeMin).toFixed(1))
        : null,
    averageHeartrate:
      Number(activity.averageHeartRate) > 0
        ? Math.round(Number(activity.averageHeartRate))
        : Number(activity.averageHeartrate) > 0
        ? Math.round(Number(activity.averageHeartrate))
        : null,
  };
}
