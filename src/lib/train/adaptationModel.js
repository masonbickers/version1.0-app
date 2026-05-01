export const ADAPTATION_MODEL_VERSION = 1;

export const ADAPTATION_EVENT_COLLECTION = "adaptationEvents";

const DEFAULT_WINDOW_DAYS = [7, 14, 28];
const ADAPTATION_SCOPE_LEVELS = new Set(["athlete", "plan", "week", "session"]);
const ADAPTATION_EVENT_STATUSES = new Set(["proposed", "applied", "dismissed", "reverted"]);
const ADAPTATION_EVENT_SOURCES = new Set(["system", "coach", "athlete", "migration"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value, maxLen = 280) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trim()}…` : text;
}

function toFiniteNumber(value, digits = null) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!Number.isFinite(digits)) return num;
  return Number(num.toFixed(digits));
}

function toNonNegativeNumber(value, digits = null) {
  const num = toFiniteNumber(value, digits);
  return num != null && num >= 0 ? num : null;
}

function toIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function safeToDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === "function") {
    try {
      const next = value.toDate();
      if (next instanceof Date && !Number.isNaN(next.getTime())) return next;
    } catch {}
  }
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function toIsoDateTime(value) {
  const date = safeToDate(value);
  return date ? date.toISOString() : null;
}

function toIsoDateOnly(value) {
  const date = safeToDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    const next = value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined);
    return next;
  }

  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, inner]) => {
      const cleaned = stripUndefinedDeep(inner);
      if (cleaned !== undefined) next[key] = cleaned;
    });
    return next;
  }

  return value === undefined ? undefined : value;
}

function mean(values, digits = 1) {
  const nums = (Array.isArray(values) ? values : []).filter(
    (value) => Number.isFinite(Number(value))
  );
  if (!nums.length) return null;
  const total = nums.reduce((sum, value) => sum + Number(value), 0);
  return toFiniteNumber(total / nums.length, digits);
}

function normaliseStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "logged") return "completed";
  if (raw === "missed") return "skipped";
  if (raw === "canceled") return "discarded";
  return raw;
}

function classifyActivity(session) {
  const blob = [
    session?.primaryActivity,
    session?.sessionType,
    session?.type,
    session?.workout?.sport,
    session?.title,
    session?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bhyrox\b/.test(blob)) return "hyrox";
  if (
    /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|press|row|pull|lift)\b/.test(
      blob
    )
  ) {
    return "strength";
  }
  if (
    /\b(run|tempo|interval|easy|long|race|track|fartlek|threshold|jog|hill|marathon|5k|10k)\b/.test(
      blob
    )
  ) {
    return "run";
  }

  return "other";
}

function classifyEffort(session, activity) {
  const blob = [
    session?.sessionType,
    session?.type,
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (activity === "strength") return "strength";
  if (/\b(long run|long)\b/.test(blob)) return "long";
  if (
    /\b(interval|tempo|threshold|track|vo2|max|speed|hill|fartlek|race pace|sharpener|sharpening|progression)\b/.test(
      blob
    )
  ) {
    return "quality";
  }
  if (/\b(recovery|easy|rest|mobility)\b/.test(blob)) return "easy";
  if (activity === "run") return "aerobic";
  return activity || "other";
}

function emptyWindowSummary(days) {
  return {
    days,
    sessions: 0,
    plannedSessions: 0,
    completedSessions: 0,
    skippedSessions: 0,
    complianceRate: null,
    durationMin: 0,
    distanceKm: 0,
    avgRPE: null,
    loadScore: 0,
    qualitySessions: 0,
    longRuns: 0,
    avgTargetDurationRatio: null,
    avgTargetDistanceRatio: null,
  };
}

function summariseWindow(records, days) {
  const rows = Array.isArray(records) ? records : [];
  if (!rows.length) return emptyWindowSummary(days);

  const completed = rows.filter((row) => row.isCompleted);
  const planned = rows.filter((row) => row.countsTowardsCompliance);
  const skipped = rows.filter((row) => row.isSkipped);

  const durationRatios = completed
    .map((row) => row.targetHitDurationRatio)
    .filter((value) => value != null);
  const distanceRatios = completed
    .map((row) => row.targetHitDistanceRatio)
    .filter((value) => value != null);

  return {
    days,
    sessions: completed.length,
    plannedSessions: planned.length,
    completedSessions: completed.length,
    skippedSessions: skipped.length,
    complianceRate:
      planned.length > 0 ? toFiniteNumber(completed.length / planned.length, 3) : null,
    durationMin: Math.round(
      completed.reduce((sum, row) => sum + (Number(row.actualDurationMin) || 0), 0)
    ),
    distanceKm: toFiniteNumber(
      completed.reduce((sum, row) => sum + (Number(row.actualDistanceKm) || 0), 0),
      1
    ) || 0,
    avgRPE: mean(completed.map((row) => row.avgRPE), 1),
    loadScore: toFiniteNumber(
      completed.reduce((sum, row) => sum + (Number(row.loadScore) || 0), 0),
      1
    ) || 0,
    qualitySessions: completed.filter((row) => row.effortClass === "quality").length,
    longRuns: completed.filter((row) => row.effortClass === "long").length,
    avgTargetDurationRatio: mean(durationRatios, 2),
    avgTargetDistanceRatio: mean(distanceRatios, 2),
  };
}

function summariseByActivity(records) {
  return (Array.isArray(records) ? records : []).reduce((acc, row) => {
    const key = row.activity || "other";
    const current = acc[key] || {
      sessions: 0,
      completedSessions: 0,
      skippedSessions: 0,
      durationMin: 0,
      distanceKm: 0,
    };

    current.sessions += 1;
    if (row.isCompleted) {
      current.completedSessions += 1;
      current.durationMin += Number(row.actualDurationMin || 0) || 0;
      current.distanceKm += Number(row.actualDistanceKm || 0) || 0;
    }
    if (row.isSkipped) current.skippedSessions += 1;

    acc[key] = {
      ...current,
      durationMin: Math.round(current.durationMin),
      distanceKm: toFiniteNumber(current.distanceKm, 1) || 0,
    };
    return acc;
  }, {});
}

function buildStreaks(records) {
  let consecutiveCompleted = 0;
  let consecutiveMissed = 0;

  for (const row of Array.isArray(records) ? records : []) {
    if (row.countsTowardsCompliance) {
      if (row.isCompleted) consecutiveCompleted += 1;
      else break;
    }
  }

  for (const row of Array.isArray(records) ? records : []) {
    if (row.countsTowardsCompliance) {
      if (row.isSkipped) consecutiveMissed += 1;
      else break;
    }
  }

  return {
    consecutiveCompleted,
    consecutiveMissed,
  };
}

export function normaliseRecentTrainingRecord(session, fallbackId = "") {
  const date =
    safeToDate(session?.completedAt) ||
    safeToDate(session?.updatedAt) ||
    safeToDate(session?.createdAt) ||
    safeToDate(session?.date);

  const status = normaliseStatus(session?.status);
  const isCompleted = status === "completed" || status === "saved";
  const isSkipped = status === "skipped";
  const isLive = status === "live" || status === "running" || status === "paused";
  const countsTowardsCompliance = isCompleted || isSkipped;

  const actualDurationMin = toNonNegativeNumber(
    session?.actualDurationMin ??
      (Number(session?.live?.durationSec || 0)
        ? Number(session.live.durationSec) / 60
        : null),
    1
  );
  const actualDistanceKm = toNonNegativeNumber(
    session?.actualDistanceKm ?? session?.live?.distanceKm ?? null,
    2
  );
  const targetDurationMin = toNonNegativeNumber(session?.targetDurationMin, 1);
  const targetDistanceKm = toNonNegativeNumber(session?.targetDistanceKm, 2);
  const avgRPE = toNonNegativeNumber(session?.avgRPE ?? session?.live?.avgRPE ?? null, 1);

  const activity = classifyActivity(session);
  const effortClass = classifyEffort(session, activity);

  return {
    id: String(session?.id || fallbackId || ""),
    sessionKey: cleanText(session?.sessionKey || null, 120),
    planId: cleanText(session?.planId || null, 120),
    title: cleanText(session?.title || session?.name || "Session", 140) || "Session",
    type:
      cleanText(
        session?.primaryActivity || session?.sessionType || session?.workout?.sport || null,
        80
      ) || "",
    activity,
    effortClass,
    status,
    source: cleanText(session?.source || null, 80),
    date: toIsoDateTime(date),
    dateMs: date ? date.getTime() : 0,
    actualDurationMin,
    actualDistanceKm,
    targetDurationMin,
    targetDistanceKm,
    avgRPE,
    loadScore:
      actualDurationMin != null && avgRPE != null
        ? toFiniteNumber(actualDurationMin * avgRPE, 1)
        : null,
    targetHitDurationRatio:
      actualDurationMin != null && targetDurationMin != null && targetDurationMin > 0
        ? toFiniteNumber(actualDurationMin / targetDurationMin, 2)
        : null,
    targetHitDistanceRatio:
      actualDistanceKm != null && targetDistanceKm != null && targetDistanceKm > 0
        ? toFiniteNumber(actualDistanceKm / targetDistanceKm, 2)
        : null,
    notes: cleanText(session?.notes || null, 240),
    isCompleted,
    isSkipped,
    isLive,
    countsTowardsCompliance,
  };
}

export function createEmptyRecentTrainingSummary(windows = DEFAULT_WINDOW_DAYS) {
  const keys = {};
  (Array.isArray(windows) ? windows : DEFAULT_WINDOW_DAYS).forEach((days) => {
    const numericDays = Math.max(1, toIntegerOrNull(days) || 0);
    keys[`last${numericDays}d`] = emptyWindowSummary(numericDays);
  });

  return {
    version: ADAPTATION_MODEL_VERSION,
    generatedAt: null,
    recordCount: 0,
    recent: [],
    windows: keys,
    last7d: keys.last7d || emptyWindowSummary(7),
    last14d: keys.last14d || emptyWindowSummary(14),
    last28d: keys.last28d || emptyWindowSummary(28),
    streaks: {
      consecutiveCompleted: 0,
      consecutiveMissed: 0,
    },
    byActivity: {},
    latestCompletedAt: null,
  };
}

export function summariseRecentTraining(rows, options = {}) {
  const windowDays = Array.isArray(options?.windows) && options.windows.length
    ? options.windows
    : DEFAULT_WINDOW_DAYS;
  const recentLimit = Math.max(1, Math.min(20, toIntegerOrNull(options?.recentLimit) || 8));
  const now = safeToDate(options?.now) || new Date();

  const ordered = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normaliseRecentTrainingRecord(row, `row_${index}`))
    .sort((a, b) => b.dateMs - a.dateMs);

  if (!ordered.length) return createEmptyRecentTrainingSummary(windowDays);

  const windows = {};
  windowDays.forEach((days) => {
    const numericDays = Math.max(1, toIntegerOrNull(days) || 0);
    const cutoffMs = now.getTime() - numericDays * DAY_MS;
    const withinWindow = ordered.filter((row) => row.dateMs >= cutoffMs);
    windows[`last${numericDays}d`] = summariseWindow(withinWindow, numericDays);
  });

  const latestCompleted = ordered.find((row) => row.isCompleted);

  return {
    version: ADAPTATION_MODEL_VERSION,
    generatedAt: now.toISOString(),
    recordCount: ordered.length,
    recent: ordered.slice(0, recentLimit).map(({ dateMs, ...row }) => row),
    windows,
    last7d: windows.last7d || emptyWindowSummary(7),
    last14d: windows.last14d || emptyWindowSummary(14),
    last28d: windows.last28d || emptyWindowSummary(28),
    streaks: buildStreaks(ordered),
    byActivity: summariseByActivity(ordered),
    latestCompletedAt: latestCompleted?.date || null,
  };
}

export function compactRecentTrainingSummary(summary) {
  if (!summary || typeof summary !== "object") return null;

  return stripUndefinedDeep({
    version: toIntegerOrNull(summary?.version) || ADAPTATION_MODEL_VERSION,
    generatedAt: toIsoDateTime(summary?.generatedAt),
    recordCount: toIntegerOrNull(summary?.recordCount) || 0,
    last7d: summary?.last7d || emptyWindowSummary(7),
    last14d: summary?.last14d || emptyWindowSummary(14),
    last28d: summary?.last28d || emptyWindowSummary(28),
    streaks: {
      consecutiveCompleted: toIntegerOrNull(summary?.streaks?.consecutiveCompleted) || 0,
      consecutiveMissed: toIntegerOrNull(summary?.streaks?.consecutiveMissed) || 0,
    },
    byActivity: summary?.byActivity || {},
    latestCompletedAt: toIsoDateTime(summary?.latestCompletedAt),
  });
}

function normaliseScope(scope = {}) {
  const levelRaw = String(scope?.level || "plan").trim().toLowerCase();
  const level = ADAPTATION_SCOPE_LEVELS.has(levelRaw) ? levelRaw : "plan";

  return stripUndefinedDeep({
    level,
    planId: cleanText(scope?.planId || null, 120),
    weekIndex: toIntegerOrNull(scope?.weekIndex),
    dayIndex: toIntegerOrNull(scope?.dayIndex),
    sessionKey: cleanText(scope?.sessionKey || null, 140),
    effectiveFrom: toIsoDateOnly(scope?.effectiveFrom || scope?.effectiveFromIso),
    effectiveTo: toIsoDateOnly(scope?.effectiveTo || scope?.effectiveToIso),
  });
}

export function normaliseAdaptationEvent(event = {}) {
  const statusRaw = String(event?.status || "proposed").trim().toLowerCase();
  const sourceRaw = String(event?.source || "system").trim().toLowerCase();

  return stripUndefinedDeep({
    version: ADAPTATION_MODEL_VERSION,
    id: cleanText(event?.id || null, 120),
    type: cleanText(event?.type || event?.kind || "manual_adjustment", 80),
    status: ADAPTATION_EVENT_STATUSES.has(statusRaw) ? statusRaw : "proposed",
    source: ADAPTATION_EVENT_SOURCES.has(sourceRaw) ? sourceRaw : "system",
    actor: cleanText(event?.actor || null, 80),
    planId: cleanText(event?.planId || event?.scope?.planId || null, 120),
    scope: normaliseScope(event?.scope || {}),
    trigger: stripUndefinedDeep({
      code: cleanText(event?.trigger?.code || null, 80),
      label: cleanText(event?.trigger?.label || null, 140),
      windowDays: toIntegerOrNull(event?.trigger?.windowDays),
      metrics:
        event?.trigger?.metrics && typeof event.trigger.metrics === "object"
          ? stripUndefinedDeep(event.trigger.metrics)
          : undefined,
    }),
    summarySnapshot: compactRecentTrainingSummary(
      event?.summarySnapshot || event?.summary || null
    ),
    changes: stripUndefinedDeep({
      before:
        event?.changes?.before && typeof event.changes.before === "object"
          ? stripUndefinedDeep(event.changes.before)
          : undefined,
      after:
        event?.changes?.after && typeof event.changes.after === "object"
          ? stripUndefinedDeep(event.changes.after)
          : undefined,
      patch:
        event?.changes?.patch && typeof event.changes.patch === "object"
          ? stripUndefinedDeep(event.changes.patch)
          : undefined,
    }),
    reason: stripUndefinedDeep({
      headline: cleanText(event?.reason?.headline || event?.headline || null, 140),
      detail: cleanText(event?.reason?.detail || event?.detail || null, 320),
    }),
    notes: cleanText(event?.notes || null, 320),
    tags: Array.isArray(event?.tags)
      ? event.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12)
      : [],
    createdAtMs: toIntegerOrNull(event?.createdAtMs) || Date.now(),
    updatedAtMs: toIntegerOrNull(event?.updatedAtMs) || Date.now(),
    appliedAtMs: toIntegerOrNull(event?.appliedAtMs),
  });
}

export function buildAdaptationEvent(input = {}) {
  return normaliseAdaptationEvent(input);
}

export function normaliseAdaptationState(state = {}) {
  const eventCounts = state?.eventCounts || {};

  return stripUndefinedDeep({
    version: ADAPTATION_MODEL_VERSION,
    enabled: state?.enabled !== false,
    lastEvaluatedAtMs: toIntegerOrNull(state?.lastEvaluatedAtMs),
    latestSummary: compactRecentTrainingSummary(state?.latestSummary || null),
    latestEventId: cleanText(state?.latestEventId || null, 120),
    eventCounts: {
      total: toIntegerOrNull(eventCounts?.total) || 0,
      proposed: toIntegerOrNull(eventCounts?.proposed) || 0,
      applied: toIntegerOrNull(eventCounts?.applied) || 0,
      dismissed: toIntegerOrNull(eventCounts?.dismissed) || 0,
      reverted: toIntegerOrNull(eventCounts?.reverted) || 0,
    },
  });
}

export function createEmptyAdaptationState() {
  return normaliseAdaptationState({});
}

export function applyRecentTrainingSummaryToAdaptationState(
  state,
  summary,
  overrides = {}
) {
  const next = normaliseAdaptationState(state);

  return normaliseAdaptationState({
    ...next,
    latestSummary: compactRecentTrainingSummary(summary),
    lastEvaluatedAtMs:
      toIntegerOrNull(overrides?.lastEvaluatedAtMs) ||
      toIntegerOrNull(overrides?.evaluatedAtMs) ||
      Date.now(),
    latestEventId: cleanText(overrides?.latestEventId || next.latestEventId || null, 120),
  });
}

export function registerAdaptationEvent(state, event) {
  const current = normaliseAdaptationState(state);
  const nextEvent = normaliseAdaptationEvent(event);
  const statusKey = nextEvent.status;

  return normaliseAdaptationState({
    ...current,
    latestEventId: nextEvent.id || current.latestEventId,
    eventCounts: {
      ...current.eventCounts,
      total: (current.eventCounts?.total || 0) + 1,
      [statusKey]: (current.eventCounts?.[statusKey] || 0) + 1,
    },
  });
}

export function withPlanAdaptationDefaults(planDoc = {}, overrides = {}) {
  return {
    ...planDoc,
    adaptation: normaliseAdaptationState({
      ...(planDoc?.adaptation || {}),
      ...(overrides || {}),
    }),
  };
}
