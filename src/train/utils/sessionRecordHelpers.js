import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../../firebaseConfig";
import { analyseRunSessionCompletion } from "../../../server/lib/train/sessionCompletion/sessionCompletionAnalysis";
import { activityMatchIdentity } from "./activitySessionMatch";
import { decodeSessionKey } from "./sessionHelpers";
import { refreshTrainingWidgetSnapshotForUser } from "../../widgets/trainingWidgetSnapshot";

function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function extractWeeks(data) {
  const candidates = [
    data?.weeks,
    data?.plan?.weeks,
    data?.planData?.weeks,
    data?.generatedPlan?.weeks,
    data?.activePlan?.weeks,
    data?.output?.weeks,
    data?.result?.weeks,
    data?.template?.weeks,
    data?.program?.weeks,
    data?.schedule?.weeks,
    data?.payload?.weeks,
  ];

  for (const candidate of candidates) {
    const weeks = normaliseList(candidate);
    if (weeks.length) return weeks;
  }

  return [];
}

export function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

export async function ignoreExternalActivityForPlannedSession({
  uid,
  encodedKey,
  activity,
  reason = "not_this_session",
}) {
  if (!uid) throw new Error("Please sign in again.");
  if (!encodedKey) throw new Error("This session ignore is missing its key.");

  const { activityId, activitySource } = activityMatchIdentity(activity);
  if (!activityId || !activitySource) throw new Error("This activity is missing its source reference.");

  const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
  await setDoc(
    doc(db, "users", uid, "sessionLogs", encodedKey),
    {
      planId: planId || null,
      weekIndex,
      dayIndex,
      sessionIndex,
      ignoredActivityMatches: arrayUnion({
        sessionKey: encodedKey,
        activityId,
        activitySource,
        ignoredAt: new Date().toISOString(),
        reason,
      }),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function getSessionFromPlan(data, weekIndex, dayIndex, sessionIndex) {
  const weeks = extractWeeks(data);
  const week = weeks?.[weekIndex];

  if (!week) return { session: null, dayLabel: "" };

  const days = normaliseList(week?.days);
  const day = days?.[dayIndex];

  const daySessions = normaliseList(day?.sessions);
  let session = daySessions?.[sessionIndex] || null;

  if (!session) {
    const weekSessions = normaliseList(week?.sessions);
    session = weekSessions?.[sessionIndex] || null;
  }

  if (!session) {
    const workouts = normaliseList(week?.workouts);
    session = workouts?.[sessionIndex] || null;
  }

  const dayLabel =
    day?.day ||
    day?.label ||
    day?.name ||
    (week?.weekNumber != null ? `Week ${week.weekNumber}` : "");
  const dayDate = day?.date || day?.isoDate || null;

  return { session, dayLabel, dayDate };
}

export function isStrengthLikeSession(session) {
  const sport = String(
    session?.workout?.sport || session?.sessionType || session?.type || ""
  ).toLowerCase();
  if (sport.includes("strength") || sport.includes("gym") || Array.isArray(session?.blocks)) {
    return true;
  }
  if (
    sport.includes("run") ||
    sport.includes("interval") ||
    sport.includes("tempo") ||
    sport.includes("easy") ||
    sport.includes("long")
  ) {
    return false;
  }

  const titleBlob = [
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|row|lunge|press)\b/.test(
    titleBlob
  );
}

export function listPlanSessions(planDoc) {
  const weeks = extractWeeks(planDoc);
  const planId = String(planDoc?.id || "").trim();
  const planName = resolvePlanName(planDoc);
  const items = [];

  weeks.forEach((week, weekIndex) => {
    const weekLabel =
      week?.title ||
      (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);

    const days = normaliseList(week?.days);
    if (days.length) {
      days.forEach((day, dayIndex) => {
        const dayLabel =
          day?.day || day?.label || day?.name || `Day ${dayIndex + 1}`;
        const sessions = normaliseList(day?.sessions);

        sessions.forEach((session, sessionIndex) => {
          items.push({
            planId,
            planName,
            weekIndex,
            dayIndex,
            sessionIndex,
            weekLabel,
            dayLabel,
            sessionKey: buildSessionKey(planId, weekIndex, dayIndex, sessionIndex),
            session,
          });
        });
      });
      return;
    }

    const sessions = [
      ...normaliseList(week?.sessions),
      ...normaliseList(week?.workouts),
    ];

    sessions.forEach((session, sessionIndex) => {
      items.push({
        planId,
        planName,
        weekIndex,
        dayIndex: 0,
        sessionIndex,
        weekLabel,
        dayLabel: weekLabel,
        sessionKey: buildSessionKey(planId, weekIndex, 0, sessionIndex),
        session,
      });
    });
  });

  return items;
}

async function tryGetDoc(pathSegments) {
  const ref = doc(db, ...pathSegments);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, __path: pathSegments, ...snap.data() };
}

export async function fetchTrainPlanById(uid, planId) {
  if (!uid || !planId) return null;

  const candidates = [
    ["users", uid, "plans", planId],
    ["users", uid, "runPlans", planId],
    ["users", uid, "trainingPlans", planId],
    ["plans", planId],
    ["runPlans", planId],
    ["trainingPlans", planId],
  ];

  for (const candidate of candidates) {
    try {
      const found = await tryGetDoc(candidate);
      if (found) return found;
    } catch {}
  }

  return null;
}

export async function loadPlannedSessionRecord(uid, encodedKey) {
  const decoded = decodeSessionKey(encodedKey);
  if (!decoded?.planId) {
    return {
      ...decoded,
      planDoc: null,
      session: null,
      dayLabel: "",
    };
  }

  const planDoc = await fetchTrainPlanById(uid, decoded.planId);
  const { session, dayLabel, dayDate } = getSessionFromPlan(
    planDoc,
    decoded.weekIndex,
    decoded.dayIndex,
    decoded.sessionIndex
  );

  return {
    ...decoded,
    planDoc,
    session,
    dayLabel,
    dayDate:
      dayDate ||
      derivePlannedSessionDate(planDoc, decoded.weekIndex, decoded.dayIndex),
  };
}

function derivePlannedSessionDate(planDoc, weekIndex, dayIndex) {
  const weekIdx = Number.isFinite(Number(weekIndex)) ? Math.round(Number(weekIndex)) : 0;
  const dayIdx = Number.isFinite(Number(dayIndex)) ? Math.round(Number(dayIndex)) : 0;
  const weeks = extractWeeks(planDoc);
  const week = weeks?.[weekIdx] || {};

  const weekStart = parseDateLike(week?.weekStartDate || week?.startDate);
  if (weekStart) return toISODate(addDays(weekStart, dayIdx));

  const planStart =
    parseDateLike(planDoc?.startDate) ||
    parseDateLike(planDoc?.plan?.startDate) ||
    parseDateLike(planDoc?.meta?.startDate);
  if (planStart) return toISODate(addDays(planStart, weekIdx * 7 + dayIdx));

  return null;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metersToKm(value) {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? Number((n / 1000).toFixed(3)) : null;
}

function resolveTitle(session) {
  return (
    session?.title ||
    session?.name ||
    session?.type ||
    session?.sessionType ||
    "Session"
  );
}

function resolvePlanName(planDoc) {
  return (
    planDoc?.name ||
    planDoc?.title ||
    planDoc?.meta?.name ||
    planDoc?.plan?.name ||
    "Training Plan"
  );
}

function resolvePrimaryActivity(planDoc, session) {
  return (
    planDoc?.primaryActivity ||
    planDoc?.meta?.primaryActivity ||
    session?.primaryActivity ||
    session?.workout?.sport ||
    session?.sessionType ||
    session?.type ||
    ""
  );
}

function resolvePaceModel(planDoc) {
  const candidates = [
    planDoc?.paceModel,
    planDoc?.plan?.paceModel,
    planDoc?.planData?.paceModel,
    planDoc?.generatedPlan?.paceModel,
    planDoc?.output?.paceModel,
    planDoc?.result?.paceModel,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function isRunLikeSession(session = {}) {
  if (isStrengthLikeSession(session)) return false;
  const raw = String(
    session?.workout?.sport ||
      session?.sessionType ||
      session?.type ||
      session?.workoutKind ||
      session?.role ||
      ""
  ).toLowerCase();
  if (/\b(run|running|easy|long|tempo|threshold|interval|race|strides|fartlek)\b/.test(raw)) {
    return true;
  }
  const text = [
    session?.title,
    session?.name,
    session?.structure,
    session?.summary,
    session?.description,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(run|running|jog|easy|long|tempo|threshold|interval|race pace|strides|fartlek)\b/.test(text);
}

function minutesToSeconds(value) {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? n * 60 : null;
}

function kmFromMeters(value) {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? Number((n / 1000).toFixed(3)) : null;
}

function buildCompletedActivityForAnalysis(activity = {}) {
  if (!activity || typeof activity !== "object") return null;
  const live = activity.live && typeof activity.live === "object" ? activity.live : {};
  const linked = activity.linkedActivity && typeof activity.linkedActivity === "object" ? activity.linkedActivity : {};
  const runReviewActual = activity.runReview?.actual && typeof activity.runReview.actual === "object"
    ? activity.runReview.actual
    : {};

  const distanceKm =
    toFiniteNumber(activity.actualDistanceKm) ??
    toFiniteNumber(activity.distanceKm) ??
    toFiniteNumber(live.distanceKm) ??
    toFiniteNumber(linked.distanceKm) ??
    kmFromMeters(activity.distanceMeters) ??
    kmFromMeters(linked.distanceMeters);
  const durationSec =
    toFiniteNumber(activity.actualDurationSec) ??
    toFiniteNumber(activity.durationSec) ??
    toFiniteNumber(live.durationSec) ??
    toFiniteNumber(live.movingDurationSec) ??
    minutesToSeconds(activity.actualDurationMin) ??
    minutesToSeconds(activity.durationMin) ??
    minutesToSeconds(linked.movingTimeMin) ??
    minutesToSeconds(linked.elapsedTimeMin);

  const qualityWorkSec =
    toFiniteNumber(activity.qualityWorkSec) ??
    toFiniteNumber(runReviewActual.qualityWorkSec) ??
    (toFiniteNumber(runReviewActual.actualWorkDistanceKm) != null &&
    toFiniteNumber(runReviewActual.avgWorkPaceSec) != null
      ? toFiniteNumber(runReviewActual.actualWorkDistanceKm) * toFiniteNumber(runReviewActual.avgWorkPaceSec)
      : null);

  if (!(distanceKm > 0) && !(durationSec > 0)) return null;

  return {
    type: activity.type || activity.sessionType || linked.type || "running",
    distanceKm,
    actualDistanceKm: distanceKm,
    movingTimeSec: durationSec,
    durationSec,
    avgPaceSecPerKm:
      distanceKm > 0 && durationSec > 0
        ? durationSec / distanceKm
        : toFiniteNumber(activity.avgPaceSecPerKm) ?? toFiniteNumber(live.avgPaceSecPerKm),
    avgHr:
      toFiniteNumber(activity.avgHr) ??
      toFiniteNumber(activity.averageHeartRate) ??
      toFiniteNumber(activity.averageHeartrate) ??
      toFiniteNumber(live.avgHr) ??
      toFiniteNumber(live.avgHeartrate) ??
      toFiniteNumber(live.averageHeartRate) ??
      toFiniteNumber(linked.averageHeartrate),
    maxHr:
      toFiniteNumber(activity.maxHr) ??
      toFiniteNumber(activity.maxHeartRate) ??
      toFiniteNumber(live.maxHr) ??
      toFiniteNumber(live.maxHeartrate) ??
      toFiniteNumber(linked.maxHeartrate),
    qualityWorkSec,
  };
}

export function buildRunCompletionAnalysisForRecord({
  planDoc,
  plannedSession,
  completedActivity,
} = {}) {
  if (!plannedSession || !isRunLikeSession(plannedSession)) return null;
  const activity = buildCompletedActivityForAnalysis(completedActivity);
  if (!activity) return null;
  return analyseRunSessionCompletion({
    plannedSession,
    completedActivity: activity,
    paceModel: resolvePaceModel(planDoc),
  });
}

function resolveTargetDurationMin(session) {
  const direct =
    toFiniteNumber(session?.targetDurationMin) ??
    toFiniteNumber(session?.durationMin) ??
    toFiniteNumber(session?.totalDurationMin);

  if (direct != null && direct > 0) return Number(direct.toFixed(1));

  const workoutSec = toFiniteNumber(session?.workout?.totalDurationSec);
  if (workoutSec != null && workoutSec > 0) {
    return Number((workoutSec / 60).toFixed(1));
  }

  return null;
}

function resolveTargetDistanceKm(session) {
  const candidates = [
    session?.targetDistanceKm,
    session?.plannedDistanceKm,
    session?.computedTotalKm,
    session?.distanceKm,
    session?.totalDistanceKm,
    session?.renderedDistanceKm,
    session?.executableDistanceKm,
    session?.workout?.totalDistanceKm,
    metersToKm(session?.workout?.estimatedDistanceMeters),
    metersToKm(session?.workout?.budgetedEstimatedDistanceMeters),
  ];

  for (const candidate of candidates) {
    const km = toFiniteNumber(candidate);
    if (km != null && km > 0) return Number(km.toFixed(3));
  }

  return null;
}

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MISSED_POLICY_VERSION = 1;

function parseDateLike(raw) {
  if (!raw) return null;
  if (typeof raw?.toDate === "function") {
    const out = raw.toDate();
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  if (raw instanceof Date) {
    const out = new Date(raw);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  const match = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const out = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  const out = new Date(raw);
  out.setHours(0, 0, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

function startOfISOWeek(input) {
  const d = new Date(input);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(input, amount) {
  const d = new Date(input);
  d.setDate(d.getDate() + amount);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(input) {
  const d = new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolvePlanStart(planDoc, sessionLogMap = {}) {
  const explicitStart =
    parseDateLike(planDoc?.startDate) ||
    parseDateLike(planDoc?.plan?.startDate) ||
    parseDateLike(planDoc?.meta?.startDate) ||
    parseDateLike(planDoc?.athleteProfile?.goal?.startDate) ||
    parseDateLike(planDoc?.goal?.startDate);
  if (explicitStart) return startOfISOWeek(explicitStart);

  const weeksForTarget = Array.isArray(planDoc?.weeks) ? planDoc.weeks.length : 0;
  const requestedWeeks = Number(
    planDoc?.planLengthWeeks ||
      planDoc?.plan?.goal?.planLengthWeeks ||
      planDoc?.athleteProfile?.goal?.planLengthWeeks ||
      planDoc?.goal?.planLengthWeeks ||
      weeksForTarget
  );
  const explicitTargetDate =
    parseDateLike(planDoc?.targetDate) ||
    parseDateLike(planDoc?.eventDate) ||
    parseDateLike(planDoc?.plan?.goal?.targetDate) ||
    parseDateLike(planDoc?.athleteProfile?.goal?.targetDate) ||
    parseDateLike(planDoc?.goal?.targetDate);
  if (explicitTargetDate && Number.isFinite(requestedWeeks) && requestedWeeks > 0) {
    return startOfISOWeek(addDays(explicitTargetDate, -((Math.round(requestedWeeks) - 1) * 7)));
  }

  const planId = String(planDoc?.id || "").trim();
  const anchors = new Map();

  if (planId) {
    Object.values(sessionLogMap || {}).forEach((log) => {
      if (String(log?.planId || "").trim() !== planId) return;
      const weekIndex = Number(log?.weekIndex);
      const dayIndex = Number(log?.dayIndex);
      if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return;
      const date =
        parseDateLike(log?.date) ||
        parseDateLike(log?.statusAt) ||
        parseDateLike(log?.completedAt) ||
        parseDateLike(log?.createdAt);
      if (!date) return;
      const anchor = addDays(date, -(Math.round(weekIndex) * 7 + Math.round(dayIndex)));
      const key = toISODate(startOfISOWeek(anchor));
      anchors.set(key, (anchors.get(key) || 0) + 1);
    });
  }

  if (anchors.size) {
    const [key] = [...anchors.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    const parsed = parseDateLike(key);
    if (parsed) return startOfISOWeek(parsed);
  }

  const weeks = Array.isArray(planDoc?.weeks) ? planDoc.weeks : [];
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const week = weeks[weekIndex] || {};
    const explicitWeekStart = parseDateLike(week?.weekStartDate || week?.startDate);
    if (explicitWeekStart) return startOfISOWeek(addDays(explicitWeekStart, -weekIndex * 7));

    const days = Array.isArray(week?.days) ? week.days : [];
    for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
      const explicitDay = parseDateLike(days[dayIndex]?.date || days[dayIndex]?.isoDate);
      if (explicitDay) return startOfISOWeek(addDays(explicitDay, -(weekIndex * 7 + dayIndex)));
    }
  }

  const fallback =
    parseDateLike(planDoc?.createdAt) ||
    new Date();
  return startOfISOWeek(fallback);
}

function demandForMissedPolicy(session = {}) {
  const text = [
    session?.title,
    session?.name,
    session?.type,
    session?.sessionType,
    session?.focus,
    session?.emphasis,
    session?.notes,
    session?.workout?.sport,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(long run|long)\b/.test(text)) return "long";
  if (/\b(interval|tempo|threshold|track|hill|vo2|max|speed|fartlek|race pace|progression)\b/.test(text)) {
    return "quality";
  }
  if (/\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|press|row|lift)\b/.test(text)) {
    return "strength";
  }
  if (/\b(recovery|easy|shakeout|mobility|rest)\b/.test(text)) return "easy";
  return "aerobic";
}

function shouldRescheduleMissedSession(session) {
  return ["long", "quality", "strength"].includes(demandForMissedPolicy(session));
}

function cloneWeeks(weeks) {
  return JSON.parse(JSON.stringify(Array.isArray(weeks) ? weeks : []));
}

function ensureDaySlots(week) {
  const existing = new Map((Array.isArray(week?.days) ? week.days : []).map((day) => [day?.day, day]));
  week.days = DAY_ORDER.map((label) => {
    const found = existing.get(label) || {};
    return {
      ...found,
      day: label,
      sessions: Array.isArray(found?.sessions) ? found.sessions : [],
    };
  });
  return week.days;
}

function prependMissedNote(session, text) {
  const current = String(session?.notes || "").trim();
  return current.toLowerCase().includes(text.toLowerCase())
    ? current
    : current
    ? `${text}\n${current}`
    : text;
}

function scaleSessionLoad(session, factor) {
  const next = { ...session };
  const scaleField = (field, digits = 1, min = null) => {
    const value = Number(next[field]);
    if (!Number.isFinite(value) || value <= 0) return;
    const scaled = Number((value * factor).toFixed(digits));
    next[field] = min == null ? scaled : Math.max(min, scaled);
  };

  scaleField("durationMin", 0, 15);
  scaleField("targetDurationMin", 0, 15);
  scaleField("distanceKm", 1, 1);
  scaleField("targetDistanceKm", 1, 1);
  scaleField("plannedDistanceKm", 1, 1);
  scaleField("computedTotalKm", 1, 1);

  if (next?.workout && typeof next.workout === "object") {
    next.workout = { ...next.workout };
    const workoutKm = Number(next.workout.totalDistanceKm);
    if (Number.isFinite(workoutKm) && workoutKm > 0) {
      next.workout.totalDistanceKm = Math.max(1, Number((workoutKm * factor).toFixed(1)));
    }
    const workoutSec = Number(next.workout.totalDurationSec);
    if (Number.isFinite(workoutSec) && workoutSec > 0) {
      next.workout.totalDurationSec = Math.max(15 * 60, Math.round(workoutSec * factor));
    }
  }

  next.notes = prependMissedNote(
    next,
    "Consistency edit: reduced slightly because recent missed sessions put the plan behind target."
  );
  next.consistencyAdjustment = {
    kind: "missed_session_load_reduction",
    version: MISSED_POLICY_VERSION,
    factor,
    appliedAtMs: Date.now(),
  };
  return next;
}

function findRescheduleSlot(weeks, startAbsoluteDay, sourceKey, maxLookaheadDays = 7) {
  const end = Math.min(startAbsoluteDay + maxLookaheadDays, weeks.length * 7 - 1);
  let fallback = null;

  for (let absoluteDay = startAbsoluteDay; absoluteDay <= end; absoluteDay += 1) {
    const weekIndex = Math.floor(absoluteDay / 7);
    const dayIndex = absoluteDay % 7;
    const week = weeks[weekIndex];
    if (!week) continue;
    const days = ensureDaySlots(week);
    const day = days[dayIndex];
    const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
    if (sessions.some((session) => session?.missedReschedule?.sourceSessionKey === sourceKey)) {
      return null;
    }

    if (sessions.length === 0) return { weekIndex, dayIndex };

    const allEasy = sessions.every((session) => demandForMissedPolicy(session) === "easy");
    if (allEasy && !fallback) fallback = { weekIndex, dayIndex };
  }

  return fallback;
}

function recentMissCount(logs, today, days) {
  const cutoff = addDays(today, -days).getTime();
  return Object.values(logs || {}).filter((log) => {
    const status = String(log?.status || "").toLowerCase();
    if (status !== "skipped") return false;
    const date = parseDateLike(log?.date) || parseDateLike(log?.statusAt) || parseDateLike(log?.skippedAt);
    return date && date.getTime() >= cutoff && date.getTime() < today.getTime();
  }).length;
}

function applyRepeatedMissAdjustments(weeks, todayAbsoluteDay, totalMisses) {
  if (totalMisses < 2) return { weeks, touched: 0, goalStatus: "on_track" };
  const factor = totalMisses >= 4 ? 0.75 : 0.85;
  const goalStatus = totalMisses >= 4 ? "revise_goal" : "at_risk";
  let touched = 0;

  for (let absoluteDay = todayAbsoluteDay; absoluteDay < weeks.length * 7 && touched < 6; absoluteDay += 1) {
    const weekIndex = Math.floor(absoluteDay / 7);
    const dayIndex = absoluteDay % 7;
    const week = weeks[weekIndex];
    if (!week) continue;
    const day = ensureDaySlots(week)[dayIndex];
    day.sessions = (Array.isArray(day?.sessions) ? day.sessions : []).map((session) => {
      if (touched >= 6) return session;
      if (session?.consistencyAdjustment?.version === MISSED_POLICY_VERSION) return session;
      if (demandForMissedPolicy(session) === "easy") return session;
      touched += 1;
      return scaleSessionLoad(session, factor);
    });
  }

  return { weeks, touched, goalStatus };
}

export async function reconcileMissedPlanSessions({
  uid,
  plans = [],
  sessionLogMap = {},
  today = new Date(),
  source = "auto_missed_reconcile",
} = {}) {
  if (!uid) return { changed: false, sessionLogMap };
  const activePlans = (Array.isArray(plans) ? plans : []).filter((plan) => plan?.id && Array.isArray(plan?.weeks));
  if (!activePlans.length) return { changed: false, sessionLogMap };

  const todayDate = parseDateLike(today) || new Date();
  todayDate.setHours(0, 0, 0, 0);
  const nextSessionLogMap = { ...(sessionLogMap || {}) };
  const batch = writeBatch(db);
  let writeCount = 0;
  let planWriteCount = 0;

  activePlans.forEach((planDoc) => {
    const planId = String(planDoc.id);
    const planStart = resolvePlanStart(planDoc, nextSessionLogMap);
    const todayAbsoluteDay = Math.floor((todayDate.getTime() - planStart.getTime()) / DAY_MS);
    if (todayAbsoluteDay <= 0) return;

    const weeks = cloneWeeks(planDoc.weeks);
    const missed = [];

    for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
      const week = weeks[weekIndex];
      const days = ensureDaySlots(week);
      for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
        const absoluteDay = weekIndex * 7 + dayIndex;
        if (absoluteDay >= todayAbsoluteDay) continue;
        const iso = toISODate(addDays(planStart, absoluteDay));
        const sessions = Array.isArray(days[dayIndex]?.sessions) ? days[dayIndex].sessions : [];
        sessions.forEach((session, sessionIndex) => {
          if (session?.missedReschedule?.sourceSessionKey) return;
          const key = buildSessionKey(planId, weekIndex, dayIndex, sessionIndex);
          if (resolveSessionStatusForReconcile(nextSessionLogMap[key])) return;
          missed.push({ key, weekIndex, dayIndex, sessionIndex, absoluteDay, iso, session });
        });
      }
    }

    if (!missed.length) return;

    missed.forEach((item) => {
      const missedLog = stripNilValues({
        sessionKey: item.key,
        planId,
        planName: resolvePlanName(planDoc),
        primaryActivity: resolvePrimaryActivity(planDoc, item.session),
        sessionType: item.session?.sessionType || item.session?.type || null,
        weekIndex: item.weekIndex,
        dayIndex: item.dayIndex,
        sessionIndex: item.sessionIndex,
        dayLabel: DAY_ORDER[item.dayIndex] || null,
        title: resolveTitle(item.session),
        date: item.iso,
        status: "skipped",
        source,
        missed: true,
        autoMissed: true,
        autoMissedPolicyVersion: MISSED_POLICY_VERSION,
        missedDemand: demandForMissedPolicy(item.session),
        targetDurationMin: resolveTargetDurationMin(item.session),
        targetDistanceKm: resolveTargetDistanceKm(item.session),
        statusAt: serverTimestamp(),
        skippedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      batch.set(doc(db, "users", uid, "sessionLogs", item.key), missedLog, { merge: true });
      nextSessionLogMap[item.key] = {
        ...missedLog,
        statusAt: new Date().toISOString(),
        skippedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeCount += 1;
    });

    missed
      .filter((item) => shouldRescheduleMissedSession(item.session))
      .slice(0, 2)
      .forEach((item) => {
        const slot = findRescheduleSlot(
          weeks,
          Math.max(todayAbsoluteDay, item.absoluteDay + 1),
          item.key
        );
        if (!slot) return;

        const targetDay = ensureDaySlots(weeks[slot.weekIndex])[slot.dayIndex];
        targetDay.sessions.push({
          ...item.session,
          title: `${resolveTitle(item.session)} (rescheduled)`,
          notes: prependMissedNote(
            item.session,
            `Rescheduled after missed ${DAY_ORDER[item.dayIndex] || "day"} session. Keep it controlled and do not chase extra volume.`
          ),
          missedReschedule: {
            sourceSessionKey: item.key,
            sourceDate: item.iso,
            policyVersion: MISSED_POLICY_VERSION,
            reason: "important_missed_session",
            createdAtMs: Date.now(),
          },
        });
      });

    const totalMisses14d = recentMissCount(nextSessionLogMap, todayDate, 14);
    const adjustment = applyRepeatedMissAdjustments(weeks, todayAbsoluteDay, totalMisses14d);
    const goalStatus = adjustment.goalStatus;

    if (
      JSON.stringify(weeks) !== JSON.stringify(planDoc.weeks) ||
      goalStatus !== "on_track"
    ) {
      const adaptation = {
        ...(planDoc?.adaptation || {}),
        missedSessionPolicy: {
          version: MISSED_POLICY_VERSION,
          lastEvaluatedAtMs: Date.now(),
          last14dMissedSessions: totalMisses14d,
          goalStatus,
          recommendation:
            goalStatus === "revise_goal"
              ? "Goal should be revised because repeated missed sessions mean the current target is no longer on track."
              : goalStatus === "at_risk"
              ? "Goal is at risk. Upcoming sessions were reduced to rebuild consistency."
              : "Plan is on track.",
        },
      };
      batch.set(
        doc(db, "users", uid, "plans", planId),
        {
          weeks,
          plan: {
            ...(planDoc?.plan && typeof planDoc.plan === "object" ? planDoc.plan : {}),
            weeks,
          },
          adaptation,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      planWriteCount += 1;
    }
  });

  if (writeCount || planWriteCount) {
    await batch.commit();
  }

  return {
    changed: writeCount > 0 || planWriteCount > 0,
    missedCount: writeCount,
    planWriteCount,
    sessionLogMap: nextSessionLogMap,
  };
}

function resolveSessionStatusForReconcile(log) {
  const raw = String(log?.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "skipped") return raw;
  if (log?.skippedAt) return "skipped";
  if (log?.completedAt || log?.lastTrainSessionId) return "completed";
  return "";
}

export function stripNilValues(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function buildPlannedTrainSessionPayload({
  encodedKey,
  planDoc,
  session,
  dayLabel,
  status = "completed",
  notes = "",
  source = "manual_log",
  linkedActivity,
  overrides = {},
}) {
  const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
  const trimmedNotes = String(notes || "").trim();

  const payload = {
    sessionKey: encodedKey,
    planId: planId || null,
    planName: resolvePlanName(planDoc),
    primaryActivity: resolvePrimaryActivity(planDoc, session),
    sessionType: session?.sessionType || session?.type || null,
    weekIndex,
    dayIndex,
    sessionIndex,
    dayLabel: dayLabel || null,
    title: resolveTitle(session),
    date: new Date().toISOString().split("T")[0],
    targetDurationMin: resolveTargetDurationMin(session),
    targetDistanceKm: resolveTargetDistanceKm(session),
    actualDurationMin: null,
    actualDistanceKm: null,
    avgRPE: null,
    notes: trimmedNotes || null,
    segments: Array.isArray(session?.segments)
      ? session.segments
      : Array.isArray(session?.steps)
      ? session.steps
      : [],
    workout: session?.workout || null,
    status,
    source,
  };

  if (linkedActivity) {
    payload.linkedActivity = linkedActivity;
  }

  const completionAnalysis =
    status === "completed"
      ? buildRunCompletionAnalysisForRecord({
          planDoc,
          plannedSession: session,
          completedActivity: {
            ...payload,
            ...overrides,
            ...(linkedActivity ? { linkedActivity } : {}),
          },
        })
      : null;
  if (completionAnalysis) {
    payload.completionAnalysis = completionAnalysis;
  }

  return {
    ...payload,
    ...overrides,
  };
}

export async function linkExternalActivityToPlannedSession({
  uid,
  encodedKey,
  notes = "",
  linkedActivity,
  payloadOverrides = {},
  sessionLogOverrides = {},
}) {
  if (!uid) throw new Error("Please sign in again.");
  if (!encodedKey) throw new Error("This session link is missing its key.");
  if (!linkedActivity?.reference) throw new Error("Missing linked activity reference.");

  const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
  const trimmedNotes = String(notes || "").trim();
  const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
  const existingLogSnap = await getDoc(sessionLogRef);
  const existingLog = existingLogSnap.exists() ? existingLogSnap.data() || {} : null;
  const resolvedTrainSessionId =
    String(existingLog?.lastTrainSessionId || "").trim() || null;

  let trainSessionRef = resolvedTrainSessionId
    ? doc(db, "users", uid, "trainSessions", resolvedTrainSessionId)
    : doc(collection(db, "users", uid, "trainSessions"));

  let hasExistingTrainSession = false;
  if (resolvedTrainSessionId) {
    const trainSessionSnap = await getDoc(trainSessionRef);
    hasExistingTrainSession = trainSessionSnap.exists();
    if (!hasExistingTrainSession) {
      trainSessionRef = doc(collection(db, "users", uid, "trainSessions"));
    }
  }

  const plannedRecord = await loadPlannedSessionRecord(uid, encodedKey);
  if (!plannedRecord?.planDoc || !plannedRecord?.session) {
    throw new Error("Could not find the planned session to link.");
  }

  const plannedPayload = buildPlannedTrainSessionPayload({
    encodedKey,
    planDoc: plannedRecord.planDoc,
    session: plannedRecord.session,
    dayLabel: plannedRecord.dayLabel,
    status: "completed",
    notes: trimmedNotes,
    source: "linked_activity",
    linkedActivity,
    overrides: payloadOverrides,
  });

  const trainSessionPayload = {
    ...stripNilValues(plannedPayload),
    notes: trimmedNotes || null,
    linkedActivity,
  };

  if (hasExistingTrainSession) {
    delete trainSessionPayload.source;
  }

  const statusFieldsForTrainSession = hasExistingTrainSession
    ? {
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        skippedAt: deleteField(),
      }
    : {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      };

  const batch = writeBatch(db);
  batch.set(
    trainSessionRef,
    {
      ...trainSessionPayload,
      ...statusFieldsForTrainSession,
    },
    { merge: hasExistingTrainSession }
  );

  batch.set(
    sessionLogRef,
    {
      sessionKey: encodedKey,
      planId: planId || null,
      weekIndex,
      dayIndex,
      sessionIndex,
      date: plannedPayload.date,
      status: "completed",
      source: "linked_activity",
      notes: trimmedNotes || null,
      linkedActivity,
      ...(plannedPayload.completionAnalysis ? { completionAnalysis: plannedPayload.completionAnalysis } : {}),
      lastTrainSessionId: trainSessionRef.id,
      updatedAt: serverTimestamp(),
      statusAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      skippedAt: deleteField(),
      ...(existingLogSnap.exists() ? {} : { createdAt: serverTimestamp() }),
      ...sessionLogOverrides,
    },
    { merge: true }
  );

  const activitySource = String(linkedActivity?.source || linkedActivity?.collection || "").trim();
  const activityDocId = String(
    linkedActivity?.sourceDocId ||
      linkedActivity?.id ||
      linkedActivity?.activityId ||
      linkedActivity?.reference ||
      ""
  ).trim();
  if (activitySource && activityDocId) {
    batch.set(
      doc(db, "users", uid, activitySource, activityDocId),
      {
        linkedSessionKey: encodedKey,
        linkedTrainSessionId: trainSessionRef.id,
        linkStatus: "linked",
        ...(plannedPayload.completionAnalysis ? { completionAnalysis: plannedPayload.completionAnalysis } : {}),
        linkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  await refreshTrainingWidgetSnapshotForUser({
    userId: uid,
    reason: "activity_linked",
  }).catch((error) => {
    console.warn("[widgets] linked activity snapshot failed:", error?.message || error);
  });

  return {
    trainSessionId: trainSessionRef.id,
    sessionLogRef,
    completionAnalysis: plannedPayload.completionAnalysis || null,
  };
}

export async function attachExternalActivityToTrainSession({
  uid,
  trainSessionId,
  linkedActivity,
  notes = "",
  payloadOverrides = {},
  sessionLogOverrides = {},
}) {
  if (!uid) throw new Error("Please sign in again.");
  if (!trainSessionId) throw new Error("Missing training session.");
  if (!linkedActivity?.reference) throw new Error("Missing linked activity reference.");

  const trainSessionRef = doc(db, "users", uid, "trainSessions", String(trainSessionId));
  const trainSessionSnap = await getDoc(trainSessionRef);
  if (!trainSessionSnap.exists()) {
    throw new Error("Training session not found.");
  }

  const existingSession = trainSessionSnap.data() || {};
  const trimmedNotes = String(notes || "").trim();
  const encodedKey = String(existingSession?.sessionKey || "").trim();
  let completionAnalysis = null;
  if (encodedKey) {
    try {
      const plannedRecord = await loadPlannedSessionRecord(uid, encodedKey);
      completionAnalysis = buildRunCompletionAnalysisForRecord({
        planDoc: plannedRecord?.planDoc,
        plannedSession: plannedRecord?.session,
        completedActivity: {
          ...existingSession,
          ...payloadOverrides,
          linkedActivity,
        },
      });
    } catch {}
  }

  const batch = writeBatch(db);
  batch.set(
    trainSessionRef,
    {
      linkedActivity,
      status: "completed",
      ...(completionAnalysis ? { completionAnalysis } : {}),
      completedAt: serverTimestamp(),
      skippedAt: deleteField(),
      updatedAt: serverTimestamp(),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      ...payloadOverrides,
    },
    { merge: true }
  );

  if (encodedKey) {
    const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
    const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
    batch.set(
      sessionLogRef,
      {
        sessionKey: encodedKey,
        planId: existingSession?.planId || planId || null,
        weekIndex:
          existingSession?.weekIndex != null ? existingSession.weekIndex : weekIndex,
        dayIndex:
          existingSession?.dayIndex != null ? existingSession.dayIndex : dayIndex,
        sessionIndex:
          existingSession?.sessionIndex != null
            ? existingSession.sessionIndex
            : sessionIndex,
        date: existingSession?.date || null,
        linkedActivity,
        status: "completed",
        ...(completionAnalysis ? { completionAnalysis } : {}),
        lastTrainSessionId: trainSessionRef.id,
        updatedAt: serverTimestamp(),
        statusAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        skippedAt: deleteField(),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        ...sessionLogOverrides,
      },
      { merge: true }
    );
  }

  const activitySource = String(linkedActivity?.source || linkedActivity?.collection || "").trim();
  const activityDocId = String(
    linkedActivity?.sourceDocId ||
      linkedActivity?.id ||
      linkedActivity?.activityId ||
      linkedActivity?.reference ||
      ""
  ).trim();
  if (activitySource && activityDocId) {
    batch.set(
      doc(db, "users", uid, activitySource, activityDocId),
      {
        linkedSessionKey: encodedKey || existingSession?.sessionKey || null,
        linkedTrainSessionId: trainSessionRef.id,
        linkStatus: "linked",
        ...(completionAnalysis ? { completionAnalysis } : {}),
        linkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  await refreshTrainingWidgetSnapshotForUser({
    userId: uid,
    reason: "activity_attached",
  }).catch((error) => {
    console.warn("[widgets] attached activity snapshot failed:", error?.message || error);
  });

  return {
    trainSessionId: trainSessionRef.id,
    sessionKey: encodedKey || null,
    completionAnalysis,
  };
}
