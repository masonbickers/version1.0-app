import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../../firebaseConfig";
import { decodeSessionKey } from "./sessionHelpers";

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

  return { session, dayLabel };
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
  const { session, dayLabel } = getSessionFromPlan(
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
  };
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

  await batch.commit();

  return {
    trainSessionId: trainSessionRef.id,
    sessionLogRef,
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

  const batch = writeBatch(db);
  batch.set(
    trainSessionRef,
    {
      linkedActivity,
      status: "completed",
      completedAt: serverTimestamp(),
      skippedAt: deleteField(),
      updatedAt: serverTimestamp(),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      ...payloadOverrides,
    },
    { merge: true }
  );

  const encodedKey = String(existingSession?.sessionKey || "").trim();
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

  await batch.commit();

  return {
    trainSessionId: trainSessionRef.id,
    sessionKey: encodedKey || null,
  };
}
