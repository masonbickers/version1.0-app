import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "../../firebaseConfig";
import {
  clearTrainingWidgetSnapshot,
  writeTrainingWidgetSnapshot,
} from "../native/TrainingWidgetSnapshotNative";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  const n = toNumber(value);
  return n == null ? null : Math.round(n * 10) / 10;
}

function parseDateLike(raw) {
  if (!raw) return null;
  if (typeof raw?.toDate === "function") {
    const d = raw.toDate();
    d.setHours(0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (raw instanceof Date) {
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const match = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    d.setHours(0, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayIndexFromLabel(value, fallback = 0) {
  const raw = String(value || "").trim().toLowerCase();
  const idx = DAY_ORDER.findIndex((day) => day.toLowerCase() === raw.slice(0, 3));
  return idx >= 0 ? idx : fallback;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return n;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function planSortMs(planDoc = {}) {
  return Math.max(timestampMs(planDoc.updatedAt), timestampMs(planDoc.createdAt));
}

function isRunPlan(planDoc = {}) {
  const kind = String(planDoc.kind || planDoc.plan?.kind || "").toLowerCase();
  const source = String(planDoc.source || planDoc.plan?.source || "").toLowerCase();
  const primary = String(
    planDoc.meta?.primaryActivity ||
      planDoc.primaryActivity ||
      planDoc.plan?.primaryActivity ||
      ""
  ).toLowerCase();

  if (kind === "run" || source.includes("run") || primary.includes("run")) return true;
  const plan = extractPlan(planDoc);
  return normaliseList(plan?.weeks).some((week) =>
    normaliseList(week?.sessions)
      .concat(normaliseList(week?.days).flatMap((day) => normaliseList(day?.sessions)))
      .some((session) => resolveDistanceKm(session) != null || isRunSession(session))
  );
}

function planName(planDoc = {}) {
  return (
    planDoc.meta?.name ||
    planDoc.plan?.meta?.name ||
    planDoc.plan?.name ||
    planDoc.name ||
    "Training plan"
  );
}

function extractPlan(planDoc = {}) {
  if (planDoc.plan?.weeks) return { ...planDoc.plan, id: planDoc.id || planDoc.plan.id };
  if (planDoc.weeks) return { ...planDoc, id: planDoc.id };
  return planDoc.plan || planDoc;
}

function resolvePlanStart(planDoc = {}) {
  const plan = extractPlan(planDoc);
  return (
    parseDateLike(planDoc.startDate) ||
    parseDateLike(planDoc.weekStartDate) ||
    parseDateLike(planDoc.meta?.startDate) ||
    parseDateLike(plan?.startDate) ||
    parseDateLike(plan?.weekStartDate) ||
    parseDateLike(plan?.meta?.startDate) ||
    parseDateLike(planDoc.athleteProfile?.goal?.startDate) ||
    startOfWeek(new Date())
  );
}

function resolveDistanceKm(session = {}) {
  const candidates = [
    session.targetDistanceKm,
    session.plannedDistanceKm,
    session.renderedDistanceKm,
    session.executableDistanceKm,
    session.computedTotalKm,
    session.distanceKm,
    session.totalDistanceKm,
    session.workout?.estimatedDistanceMeters != null
      ? Number(session.workout.estimatedDistanceMeters) / 1000
      : null,
  ];
  for (const candidate of candidates) {
    const n = toNumber(candidate);
    if (n != null && n > 0) return round1(n);
  }
  return null;
}

function resolveDurationMin(session = {}) {
  const candidates = [
    session.targetDurationMin,
    session.durationMin,
    session.totalDurationMin,
    session.workout?.totalDurationSec != null
      ? Number(session.workout.totalDurationSec) / 60
      : null,
  ];
  for (const candidate of candidates) {
    const n = toNumber(candidate);
    if (n != null && n > 0) return Math.round(n);
  }
  return null;
}

function sessionTitle(session = {}) {
  return (
    session.title ||
    session.name ||
    session.summary ||
    session.type ||
    session.sessionType ||
    "Run"
  );
}

function runType(session = {}) {
  const raw = String(
    session.role ||
      session.type ||
      session.sessionType ||
      session.workoutKind ||
      session.workout?.variant ||
      ""
  )
    .replace(/[_-]+/g, " ")
    .trim();
  if (!raw) return "Run";
  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function sessionSummary(session = {}) {
  return (
    session.keyTargets ||
    session.structure ||
    session.summary ||
    session.workout?.summary ||
    session.description ||
    session.purpose ||
    "Open the session for details."
  );
}

function isRunSession(session = {}) {
  const text = [
    session.role,
    session.type,
    session.sessionType,
    session.workoutKind,
    session.title,
    session.name,
    session.summary,
    session.structure,
    session.workout?.sport,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(run|running|easy|long|tempo|threshold|interval|race|strides|jog|steady)\b/.test(text);
}

function isRestSession(session = {}) {
  const text = [session.type, session.sessionType, session.title, session.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(rest|off|recovery only)\b/.test(text);
}

function deepLink(path) {
  return `version10app://${path.replace(/^\/+/, "")}`;
}

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function listRunSessions(planDoc = {}, sessionLogMap = {}) {
  const plan = extractPlan(planDoc);
  const weeks = normaliseList(plan?.weeks);
  const id = String(planDoc.id || plan.id || "").trim();
  const name = planName(planDoc);
  const start = resolvePlanStart(planDoc);
  const items = [];

  weeks.forEach((week, weekIndex) => {
    const weekStart =
      parseDateLike(week.weekStartDate || week.startDate) || addDays(start, weekIndex * 7);
    const days = normaliseList(week.days);

    if (days.length) {
      days.forEach((day, dayIndex) => {
        const dayDate =
          parseDateLike(day.date || day.isoDate) ||
          addDays(weekStart, dayIndexFromLabel(day.day || day.label || day.name, dayIndex));
        normaliseList(day.sessions).forEach((session, sessionIndex) => {
          if (isRestSession(session) || !isRunSession(session)) return;
          const sessionKey = session.sessionKey || buildSessionKey(id, weekIndex, dayIndex, sessionIndex);
          items.push({
            planId: id,
            planName: name,
            weekIndex,
            dayIndex,
            sessionIndex,
            sessionKey,
            date: toISODate(dayDate),
            dateMs: dayDate.getTime(),
            dayLabel: day.day || day.label || day.name || DAY_ORDER[dayDate.getDay() === 0 ? 6 : dayDate.getDay() - 1],
            session,
            log: sessionLogMap[sessionKey] || null,
          });
        });
      });
      return;
    }

    normaliseList(week.sessions).forEach((session, sessionIndex) => {
      if (isRestSession(session) || !isRunSession(session)) return;
      const dayIdx = dayIndexFromLabel(session.day || session.dayLabel, sessionIndex);
      const dayDate = parseDateLike(session.date || session.isoDate) || addDays(weekStart, dayIdx);
      const sessionKey = session.sessionKey || buildSessionKey(id, weekIndex, 0, sessionIndex);
      items.push({
        planId: id,
        planName: name,
        weekIndex,
        dayIndex: 0,
        sessionIndex,
        sessionKey,
        date: toISODate(dayDate),
        dateMs: dayDate.getTime(),
        dayLabel: session.day || session.dayLabel || DAY_ORDER[dayIdx] || `Week ${weekIndex + 1}`,
        session,
        log: sessionLogMap[sessionKey] || null,
      });
    });
  });

  return items.sort((a, b) => a.dateMs - b.dateMs);
}

function completionStatus(item) {
  const status = String(item?.log?.status || "").toLowerCase();
  if (status === "completed") return "completed";
  if (status === "skipped") return "skipped";
  return "";
}

function compactSession(item) {
  if (!item) return null;
  const distanceKm = resolveDistanceKm(item.session);
  const durationMin = resolveDurationMin(item.session);
  const status = completionStatus(item);
  const sessionPath = `train/session/${encodeURIComponent(item.sessionKey)}`;
  const completePath = `train/session/${encodeURIComponent(item.sessionKey)}/complete`;

  return {
    sessionKey: item.sessionKey,
    planId: item.planId,
    planName: item.planName,
    date: item.date,
    day: item.dayLabel,
    title: String(sessionTitle(item.session)).slice(0, 80),
    runType: runType(item.session),
    distanceKm,
    distanceText: distanceKm != null ? `${distanceKm} km` : null,
    durationMin,
    durationText: durationMin != null ? `${durationMin} min` : null,
    keyTarget: String(sessionSummary(item.session)).slice(0, 140),
    completed: status === "completed",
    status: status || "planned",
    nextAction: status === "completed" ? "View session" : "Log run",
    deepLinks: {
      session: deepLink(sessionPath),
      complete: deepLink(completePath),
      plan: deepLink(`train/view-plan?planId=${encodeURIComponent(item.planId)}`),
    },
  };
}

function buildWeeklyProgress({ sessions, today }) {
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const inWeek = sessions.filter((item) => item.dateMs >= weekStart.getTime() && item.dateMs <= weekEnd.getTime());
  const completed = inWeek.filter((item) => completionStatus(item) === "completed");

  return {
    weekStart: toISODate(weekStart),
    weekEnd: toISODate(weekEnd),
    plannedRuns: inWeek.length,
    completedRuns: completed.length,
    plannedKm: round1(inWeek.reduce((sum, item) => sum + (resolveDistanceKm(item.session) || 0), 0)) || 0,
    completedKm: round1(completed.reduce((sum, item) => sum + (resolveDistanceKm(item.session) || 0), 0)) || 0,
  };
}

export function buildTrainingWidgetSnapshot({
  userId,
  planDoc,
  sessionLogMap = {},
  now = new Date(),
} = {}) {
  const today = parseDateLike(now) || new Date();
  if (!userId) return null;

  if (!planDoc) {
    const weekStart = startOfWeek(today);
    const weekEnd = addDays(weekStart, 6);
    return {
      schemaVersion: 1,
      state: "no_active_plan",
      updatedAt: new Date().toISOString(),
      userId,
      activePlanId: null,
      activePlanName: null,
      todaySession: null,
      nextSession: null,
      weeklyProgress: {
        weekStart: toISODate(weekStart),
        weekEnd: toISODate(weekEnd),
        plannedRuns: 0,
        completedRuns: 0,
        plannedKm: 0,
        completedKm: 0,
      },
    };
  }

  const todayIso = toISODate(today);
  const sessions = listRunSessions(planDoc, sessionLogMap);
  const todaySession = sessions.find((item) => item.date === todayIso) || null;
  const nextSession =
    sessions.find(
      (item) =>
        item.dateMs > today.getTime() &&
        item.date !== todayIso &&
        completionStatus(item) !== "completed"
    ) || null;

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    userId,
    activePlanId: String(planDoc.id || extractPlan(planDoc)?.id || "").trim() || null,
    activePlanName: planName(planDoc),
    todaySession: compactSession(todaySession),
    nextSession: compactSession(nextSession),
    weeklyProgress: buildWeeklyProgress({ sessions, today }),
  };
}

async function fetchDocsWithFallback(colRef, maxResults = 80) {
  try {
    const snap = await getDocs(query(colRef, orderBy("updatedAt", "desc"), limit(maxResults)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}

  try {
    const snap = await getDocs(query(colRef, orderBy("createdAt", "desc"), limit(maxResults)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {}

  const snap = await getDocs(query(colRef, limit(maxResults)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchTrainingWidgetInputs(userId) {
  if (!userId) return { planDoc: null, sessionLogMap: {} };

  const planDocs = await fetchDocsWithFallback(collection(db, "users", userId, "plans"), 25);
  const planDoc = planDocs
    .filter(isRunPlan)
    .sort((a, b) => planSortMs(b) - planSortMs(a))[0] || null;

  const sessionLogs = await fetchDocsWithFallback(collection(db, "users", userId, "sessionLogs"), 150).catch(() => []);
  const sessionLogMap = {};
  sessionLogs.forEach((log) => {
    const key = String(log.sessionKey || log.id || "").trim();
    if (key) sessionLogMap[key] = log;
  });

  return { planDoc, sessionLogMap };
}

export async function publishTrainingWidgetSnapshotFromPlan({
  userId,
  planDoc,
  sessionLogMap = {},
  reason = "plan_update",
} = {}) {
  if (!userId) return null;
  const snapshot = buildTrainingWidgetSnapshot({ userId, planDoc, sessionLogMap });
  if (!snapshot) return null;
  snapshot.reason = reason;
  await writeTrainingWidgetSnapshot(snapshot);
  return snapshot;
}

export async function refreshTrainingWidgetSnapshotForUser({
  userId,
  reason = "refresh",
} = {}) {
  if (!userId) {
    await clearTrainingWidgetSnapshot();
    return null;
  }

  const { planDoc, sessionLogMap } = await fetchTrainingWidgetInputs(userId);
  return publishTrainingWidgetSnapshotFromPlan({
    userId,
    planDoc,
    sessionLogMap,
    reason,
  });
}
