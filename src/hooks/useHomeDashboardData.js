import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOME_DASHBOARD_CACHE = new Map();

function startOfISOWeek(input) {
  const d = new Date(input);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(input, n) {
  const d = new Date(input);
  d.setDate(d.getDate() + n);
  return d;
}

function toISODateLocal(input) {
  const d = new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayOfMonth(iso) {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "--";
  return String(parsed.getDate()).padStart(2, "0");
}

function toNumOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
  const ymdMatch = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const out = new Date(
      Number(ymdMatch[1]),
      Number(ymdMatch[2]) - 1,
      Number(ymdMatch[3])
    );
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  const out = new Date(raw);
  if (Number.isNaN(out.getTime())) return null;
  out.setHours(0, 0, 0, 0);
  return out;
}

function inferPlanKindFromDoc(planDoc) {
  const kind = String(planDoc?.kind || "").toLowerCase();
  const source = String(planDoc?.source || "").toLowerCase();
  const primary = String(
    planDoc?.primaryActivity || planDoc?.meta?.primaryActivity || ""
  ).toLowerCase();

  if (
    kind === "run" ||
    primary.includes("run") ||
    source.includes("generate-run") ||
    source.includes("run")
  ) {
    return "run";
  }

  if (
    kind === "strength" ||
    primary.includes("strength") ||
    primary.includes("gym") ||
    source.includes("generate-strength") ||
    source.includes("strength")
  ) {
    return "strength";
  }

  return kind || "training";
}

function normaliseSessionForPlan(session) {
  const value = session && typeof session === "object" ? session : {};
  return {
    ...value,
    title:
      value.title ||
      value.name ||
      value.sessionName ||
      value.sessionType ||
      value.type ||
      "Session",
  };
}

function normaliseWeeksForClient(weeks) {
  return (weeks || []).map((w, wi) => {
    const rawDays = Array.isArray(w?.days) ? w.days : [];
    const dayMap = new Map(rawDays.map((d) => [d?.day, d]));

    const days = DAY_ORDER.map((dayLabel, dayIdx) => {
      const d = dayMap.get(dayLabel) || { day: dayLabel, sessions: [] };
      const sessions = (Array.isArray(d?.sessions) ? d.sessions : [])
        .map(normaliseSessionForPlan)
        .filter(Boolean);

      return {
        day: dayLabel,
        sessions,
        date: rawDays?.[dayIdx]?.date || dayMap.get(dayLabel)?.date || null,
      };
    });

    return {
      title: w?.title || `Week ${wi + 1}`,
      weekIndex0: typeof w?.weekIndex0 === "number" ? w.weekIndex0 : wi,
      weekNumber: typeof w?.weekNumber === "number" ? w.weekNumber : wi + 1,
      weekStartDate: w?.weekStartDate || w?.startDate || null,
      weekEndDate: w?.weekEndDate || w?.endDate || null,
      days,
    };
  });
}

function normalisePlanDoc(snapDoc) {
  const data = snapDoc?.data?.() || {};
  const rawPlan = data.plan || {};
  const weeksRaw = rawPlan.weeks || data.weeks || [];
  const kind = data?.kind || rawPlan?.kind || "training";
  const nameFromMeta = data?.meta?.name;
  const nameFromPlan = rawPlan?.name;
  const nameFromData = data?.name;
  const primaryActivity =
    data?.meta?.primaryActivity ||
    data?.primaryActivity ||
    rawPlan?.primaryActivity ||
    (kind === "run" ? "Run" : kind === "strength" ? "Strength" : "Training");

  return {
    id: snapDoc.id,
    ...data,
    kind,
    name: nameFromMeta || nameFromPlan || nameFromData || "Training Plan",
    primaryActivity,
    weeks: normaliseWeeksForClient(weeksRaw),
  };
}

function resolvePlanWeekZeroStart(planDoc, sessionLogMap = null) {
  if (!planDoc) return null;

  const planId = String(planDoc?.id || "").trim();
  if (planId && sessionLogMap && typeof sessionLogMap === "object") {
    const anchorVotes = new Map();
    Object.values(sessionLogMap).forEach((log) => {
      if (String(log?.planId || "").trim() !== planId) return;
      const weekIndex = Number(log?.weekIndex);
      const dayIndex = Number(log?.dayIndex);
      if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return;

      const logDate =
        parseDateLike(log?.date) ||
        parseDateLike(log?.statusAt) ||
        parseDateLike(log?.completedAt) ||
        parseDateLike(log?.updatedAt) ||
        parseDateLike(log?.createdAt);
      if (!logDate) return;

      const anchor = addDays(
        logDate,
        -(Math.round(weekIndex) * 7 + Math.round(dayIndex))
      );
      anchor.setHours(0, 0, 0, 0);
      const key = toISODateLocal(anchor);
      anchorVotes.set(key, (anchorVotes.get(key) || 0) + 1);
    });

    if (anchorVotes.size) {
      const sorted = [...anchorVotes.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]));
      });
      const parsed = parseDateLike(sorted[0]?.[0]);
      if (parsed) return startOfISOWeek(parsed);
    }
  }

  const weeks = Array.isArray(planDoc?.weeks) ? planDoc.weeks : [];
  for (let idx = 0; idx < weeks.length; idx += 1) {
    const week = weeks[idx];
    const weekIndex0 = Number.isFinite(Number(week?.weekIndex0))
      ? Number(week.weekIndex0)
      : idx;
    const explicitWeekStart = parseDateLike(week?.weekStartDate || week?.startDate);
    if (explicitWeekStart) {
      return startOfISOWeek(addDays(explicitWeekStart, -(weekIndex0 * 7)));
    }

    const days = Array.isArray(week?.days) ? week.days : [];
    for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
      const explicitDayDate = parseDateLike(days[dayIdx]?.date || days[dayIdx]?.isoDate);
      if (explicitDayDate) {
        return startOfISOWeek(addDays(explicitDayDate, -(weekIndex0 * 7 + dayIdx)));
      }
    }
  }

  const fallbackStart = parseDateLike(
    planDoc?.startDate ||
      planDoc?.plan?.startDate ||
      planDoc?.meta?.startDate ||
      planDoc?.weekStartDate ||
      planDoc?.plan?.weekStartDate ||
      planDoc?.createdAt ||
      planDoc?.updatedAt
  );
  return fallbackStart ? startOfISOWeek(fallbackStart) : null;
}

function deriveCurrentPlanWeekIndex(
  plans,
  today = new Date(),
  totalWeeks = 0,
  sessionLogMap = null
) {
  const anchors = (Array.isArray(plans) ? plans : [])
    .map((planDoc) => resolvePlanWeekZeroStart(planDoc, sessionLogMap))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!anchors.length) return 0;

  const baseWeekStart = anchors[0];
  const todayWeekStart = startOfISOWeek(today);
  const diffDays = Math.floor(
    (todayWeekStart.getTime() - baseWeekStart.getTime()) / 86400000
  );
  const rawWeekIndex = Math.floor(diffDays / 7);
  const clamped = Math.max(0, rawWeekIndex);

  if (totalWeeks > 0) return Math.min(clamped, totalWeeks - 1);
  return clamped;
}

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function resolveSessionLogStatus(log) {
  const raw = String(log?.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "skipped") return raw;
  if (log?.skippedAt) return "skipped";
  if (log?.completedAt || log?.lastTrainSessionId) return "completed";
  return "";
}

function sumSessionMeta(sess) {
  const durationMin =
    sess?.workout?.totalDurationSec != null
      ? Math.round(sess.workout.totalDurationSec / 60)
      : sess?.targetDurationMin ?? sess?.durationMin ?? null;

  const distanceKm =
    sess?.workout?.totalDistanceKm != null
      ? sess.workout.totalDistanceKm
      : sess?.targetDistanceKm ?? sess?.distanceKm ?? sess?.plannedDistanceKm ?? null;

  const parts = [];
  if (durationMin) parts.push(`${durationMin}m`);
  if (distanceKm) parts.push(`${Number(distanceKm).toFixed(1)}k`);
  return parts.join(" · ");
}

function sessionTypeLabel(sess) {
  const t = String(sess?.sessionType || sess?.type || "training").toLowerCase();
  if (t === "run") return "Run";
  if (t === "gym" || t.includes("strength")) return "Strength";
  if (t.includes("hyrox")) return "Hyrox";
  if (t.includes("mob")) return "Mobility";
  if (t.includes("rest")) return "Rest";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function isResolvedSessionStatus(status) {
  return status === "completed" || status === "skipped";
}

function pickPriorityCard(cards) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return { card: null, index: -1 };
  const pendingIndex = list.findIndex((card) => !isResolvedSessionStatus(card?.status));
  const resolvedIndex = pendingIndex >= 0 ? pendingIndex : 0;
  return {
    card: list[resolvedIndex] || null,
    index: resolvedIndex,
  };
}

function sessionDistanceKm(session) {
  return (
    toNumOrNull(session?.workout?.totalDistanceKm) ??
    toNumOrNull(session?.targetDistanceKm) ??
    toNumOrNull(session?.distanceKm) ??
    toNumOrNull(session?.plannedDistanceKm)
  );
}

function sessionDurationMin(session) {
  const fromWorkoutSec = toNumOrNull(session?.workout?.totalDurationSec);
  if (fromWorkoutSec != null) return Math.round(fromWorkoutSec / 60);
  return toNumOrNull(session?.targetDurationMin) ?? toNumOrNull(session?.durationMin);
}

function isQualitySession(session) {
  const text = `${session?.title || ""} ${session?.sessionType || ""} ${session?.type || ""}`.toLowerCase();
  return /(tempo|interval|threshold|speed|hill|fartlek|quality)/.test(text);
}

function isStrengthSession(session) {
  const text = `${session?.title || ""} ${session?.sessionType || ""} ${session?.type || ""}`.toLowerCase();
  return /(strength|gym|hyrox|bodyweight)/.test(text);
}

function sessionEffortLabel(session) {
  if (isQualitySession(session)) return "Controlled hard";
  if (isStrengthSession(session)) return "Strength focus";
  return "Easy / aerobic";
}

function sessionSecondaryText(session) {
  if (!session) return "No session planned";
  if (isStrengthSession(session)) return "Strength";
  if (isQualitySession(session)) return "Quality";
  return "Aerobic";
}

function buildTodayHero(todayData, weekLabel) {
  const session = todayData?.session || null;
  const status = String(todayData?.status || "").toLowerCase();
  const completed = status === "completed";

  if (!session) {
    return {
      eyebrow: weekLabel || "This week",
      title: "Recovery / reset day",
      subtitle: "No structured workout is planned for today.",
      meta: ["Recovery", "Optional mobility"],
      ctaLabel: "Open calendar",
      secondaryLabel: null,
      completed: false,
      key: null,
      savedTrainSessionId: null,
      status: "",
    };
  }

  const duration = sessionDurationMin(session);
  const distance = sessionDistanceKm(session);
  const meta = [];
  if (duration != null && duration > 0) meta.push(`${Math.round(duration)} min`);
  if (distance != null && distance > 0) meta.push(`${distance.toFixed(1)} km`);
  meta.push(sessionEffortLabel(session));

  return {
    eyebrow: todayData?.dayLabel || weekLabel || "Today",
    title: todayData?.title || session?.title || "Today's session",
    subtitle:
      completed
        ? "Today's workout is already logged."
        : todayData?.subtitle || sessionSecondaryText(session),
    meta,
    ctaLabel: completed ? "View session" : "Start session",
    secondaryLabel: "Calendar",
    completed,
    key: todayData?.key || null,
    savedTrainSessionId: todayData?.savedTrainSessionId || null,
    status,
  };
}

function buildInsight(todayData) {
  const session = todayData?.session || null;
  const status = String(todayData?.status || "").toLowerCase();
  const completed = status === "completed";
  const duration = sessionDurationMin(session);
  const distance = sessionDistanceKm(session);

  if (completed) {
    return {
      type: "coach",
      eyebrow: "Coach note",
      title: "Recovery now sets up the next session",
      body: "Today's work is done. Log how it felt, refuel, and protect tonight's recovery so tomorrow starts fresh.",
    };
  }

  if ((duration != null && duration >= 75) || (distance != null && distance >= 12)) {
    return {
      type: "fuel",
      eyebrow: "Fuel",
      title: "Support the longer session",
      body: "Take in carbs before you head out, start controlled, and bring fluids if the run stretches beyond the first hour.",
    };
  }

  if (isQualitySession(session)) {
    return {
      type: "readiness",
      eyebrow: "Execution",
      title: "Hit targets, not hero pace",
      body: "Treat the quality as controlled work. Good reps and repeatable form matter more than forcing the session.",
    };
  }

  return {
    type: "coach",
    eyebrow: "Coach note",
    title: "Keep today disciplined",
    body: session
      ? "Stay honest on the prescribed effort. The value comes from consistency and leaving the session feeling composed."
      : "Use the lighter day to stay mobile and protect consistency across the week.",
  };
}

function buildGreeting(now) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatLongDate(now) {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function buildInitialState() {
  const now = new Date();
  return {
    loading: true,
    refreshing: false,
    loadError: "",
    hasPlan: false,
    greeting: buildGreeting(now),
    dateLabel: formatLongDate(now),
    statusLabel: "Loading",
    weekLabel: "This week",
    metrics: [
      { label: "Week total", value: "—" },
      { label: "Sessions", value: "—" },
      { label: "Weight", value: "—" },
    ],
    timeline: [],
    todayHero: {
      eyebrow: "Today",
      title: "Loading your next session",
      subtitle: "Checking your active plan and session status.",
      meta: [],
      ctaLabel: "Open today",
      secondaryLabel: "Calendar",
      completed: false,
      key: null,
      savedTrainSessionId: null,
      status: "",
    },
    insight: null,
    calendarDays: [],
  };
}

export function useHomeDashboardData(options = {}) {
  const currentUid = String(auth.currentUser?.uid || "");
  const requestedWeekOffset = Number.isFinite(Number(options?.weekOffset))
    ? Math.round(Number(options.weekOffset))
    : 0;
  const cacheKey = `${currentUid}::${requestedWeekOffset}`;
  const hasWarmCache =
    !!currentUid && HOME_DASHBOARD_CACHE.has(cacheKey);
  const [state, setState] = useState(() =>
    hasWarmCache ? HOME_DASHBOARD_CACHE.get(cacheKey) : buildInitialState()
  );

  const load = useCallback(async ({ silent = false } = {}) => {
    setState((prev) => ({
      ...prev,
      loading: silent ? prev.loading : true,
      refreshing: silent,
    }));

    const uid = auth.currentUser?.uid;
    const now = new Date();

    if (!uid) {
      const nextState = {
        ...buildInitialState(),
        loading: false,
        refreshing: false,
        loadError: "Sign in to load your training dashboard.",
        hasPlan: false,
        greeting: buildGreeting(now),
        dateLabel: formatLongDate(now),
        statusLabel: "Signed out",
      };
      HOME_DASHBOARD_CACHE.set(cacheKey, nextState);
      setState(nextState);
      return;
    }

    try {
      const partialErrors = [];

      const plansRef = collection(db, "users", uid, "plans");
      const plansSnap = await getDocs(query(plansRef, orderBy("updatedAt", "desc"), limit(30)));
      const docs = plansSnap.docs.map(normalisePlanDoc).filter((d) => d?.id);

      if (!docs.length) {
        const nextState = {
          ...buildInitialState(),
          loading: false,
          refreshing: false,
          hasPlan: false,
          greeting: buildGreeting(now),
          dateLabel: formatLongDate(now),
          statusLabel: "No plan",
          loadError: "",
          timeline: [],
          calendarDays: [],
        };
        HOME_DASHBOARD_CACHE.set(cacheKey, nextState);
        setState(nextState);
        return;
      }

      const run = docs.find((d) => inferPlanKindFromDoc(d) === "run") || null;
      const strength = docs.find((d) => inferPlanKindFromDoc(d) === "strength") || null;

      let primary = null;
      let companion = null;
      if (run) {
        primary = run;
        companion = strength && strength.id !== run.id ? strength : null;
      } else if (strength) {
        primary = strength;
        companion =
          docs.find(
            (d) =>
              d.id !== strength.id &&
              inferPlanKindFromDoc(d) !== inferPlanKindFromDoc(strength)
          ) || null;
      } else {
        primary = docs[0] || null;
        companion = docs[1] || null;
      }

      const resolvedCompanion =
        companion && primary && companion.id !== primary.id ? companion : null;
      const activePlanIds = [primary?.id, resolvedCompanion?.id].filter(Boolean);

      const sessionLogMap = {};
      if (activePlanIds.length) {
        try {
          const ref = collection(db, "users", uid, "sessionLogs");
          for (let idx = 0; idx < activePlanIds.length; idx += 10) {
            const ids = activePlanIds.slice(idx, idx + 10);
            const snap = await getDocs(query(ref, where("planId", "in", ids)));
            snap.forEach((docSnap) => {
              sessionLogMap[docSnap.id] = docSnap.data() || {};
            });
          }
        } catch {
          partialErrors.push("session_logs");
        }
      }

      let weightKg = null;
      try {
        const weightsRef = collection(db, "users", uid, "weights");
        let latestWeightSnap = await getDocs(
          query(weightsRef, orderBy("date", "desc"), limit(1))
        );
        if (latestWeightSnap.empty) {
          latestWeightSnap = await getDocs(
            query(weightsRef, orderBy("createdAt", "desc"), limit(1))
          );
        }
        if (!latestWeightSnap.empty) {
          const d = latestWeightSnap.docs[0].data() || {};
          weightKg =
            toNumOrNull(d.weight) ??
            toNumOrNull(d.value) ??
            toNumOrNull(d.weightKg);
        }
      } catch {
        partialErrors.push("weight");
      }

      if (weightKg == null) {
        try {
          const profileSnap = await getDoc(doc(db, "users", uid, "nutrition", "profile"));
          if (profileSnap.exists()) {
            weightKg = toNumOrNull(profileSnap.data()?.weightKg);
          }
        } catch {}
      }

      const visibleWeeksCount = Math.max(
        primary?.weeks?.length || 0,
        resolvedCompanion?.weeks?.length || 0,
        1
      );
      const currentWeekIndex = deriveCurrentPlanWeekIndex(
        [primary, resolvedCompanion],
        now,
        visibleWeeksCount,
        sessionLogMap
      );
      const displayWeekIndex = Math.max(
        0,
        Math.min(currentWeekIndex + requestedWeekOffset, visibleWeeksCount - 1)
      );

      const mergedWeek = {
        title:
          primary?.weeks?.[displayWeekIndex]?.title ||
          resolvedCompanion?.weeks?.[displayWeekIndex]?.title ||
          `Week ${displayWeekIndex + 1}`,
        days: DAY_ORDER.map((day) => ({ day, sessions: [] })),
      };

      const appendFromPlan = (srcPlan) => {
        if (!srcPlan?.id) return;
        const srcWeek = srcPlan?.weeks?.[displayWeekIndex];
        if (!srcWeek?.days?.length) return;
        srcWeek.days.forEach((day, dayIdx) => {
          const resolvedDayIndex = DAY_ORDER.indexOf(String(day?.day || ""));
          const safeDayIndex = resolvedDayIndex >= 0 ? resolvedDayIndex : dayIdx;
          const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
          sessions.forEach((sess, sessIdx) => {
            mergedWeek.days[safeDayIndex].sessions.push({
              ...sess,
              __sourcePlanId: srcPlan.id,
              __sourceWeekIndex: displayWeekIndex,
              __sourceDayIndex: safeDayIndex,
              __sourceSessionIndex: sessIdx,
            });
          });
        });
      };

      appendFromPlan(primary);
      appendFromPlan(resolvedCompanion);

      const planWeekZeroStart =
        [primary, resolvedCompanion]
          .map((planDoc) => resolvePlanWeekZeroStart(planDoc, sessionLogMap))
          .filter(Boolean)
          .sort((a, b) => a.getTime() - b.getTime())[0] || startOfISOWeek(now);

      const todayIso = toISODateLocal(now);
      const todayDayLabel = JS_DAY_LABELS[now.getDay()];
      const todayDayIndex = Math.max(0, DAY_ORDER.indexOf(todayDayLabel));

      const calendarDays = mergedWeek.days.map((d, dayIdx) => {
        const date = addDays(planWeekZeroStart, displayWeekIndex * 7 + dayIdx);
        const isoDate = toISODateLocal(date);
        const cards = (Array.isArray(d.sessions) ? d.sessions : []).map((sess, sessIdx) => {
          const keyPlanId = sess?.__sourcePlanId || primary?.id || null;
          const keyWeekIndex = Number.isFinite(Number(sess?.__sourceWeekIndex))
            ? Number(sess.__sourceWeekIndex)
            : displayWeekIndex;
          const keyDayIndex = Number.isFinite(Number(sess?.__sourceDayIndex))
            ? Number(sess.__sourceDayIndex)
            : dayIdx;
          const keySessionIndex = Number.isFinite(Number(sess?.__sourceSessionIndex))
            ? Number(sess.__sourceSessionIndex)
            : sessIdx;
          const key = keyPlanId
            ? buildSessionKey(keyPlanId, keyWeekIndex, keyDayIndex, keySessionIndex)
            : null;
          const log = key ? sessionLogMap[key] || null : null;
          const status = resolveSessionLogStatus(log);
          const savedTrainSessionId =
            String(log?.lastTrainSessionId || "").trim() || null;

          return {
            sess,
            title:
              sess?.title ||
              sess?.name ||
              sess?.sessionType ||
              sess?.type ||
              "Session",
            meta: sumSessionMeta(sess),
            key,
            log,
            status,
            savedTrainSessionId,
          };
        });

        const firstCard = pickPriorityCard(cards).card;
        return {
          day: d.day,
          date: formatDayOfMonth(isoDate),
          isoDate,
          isToday: isoDate === todayIso,
          sessions: d.sessions,
          cards,
          state:
            isoDate === todayIso
              ? "today"
              : cards.some((card) => card.status === "completed")
                ? "completed"
                : cards.length
                  ? "upcoming"
                  : "rest",
          label:
            firstCard?.meta ||
            firstCard?.title ||
            (cards.some((card) => card.status === "completed")
              ? "Completed"
              : cards.length
                ? sessionTypeLabel(cards[0]?.sess)
                : "Rest"),
        };
      });

      const todayDay = calendarDays[todayDayIndex] || null;
      const todayCard = pickPriorityCard(todayDay?.cards || []).card;
      const todayData = {
        dayLabel: todayDay?.day || "Today",
        key: todayCard?.key || null,
        title: todayCard?.title || "Rest / optional movement",
        subtitle:
          todayCard?.meta ||
          (todayCard ? "" : "No structured session planned"),
        status: String(todayCard?.status || "").toLowerCase(),
        savedTrainSessionId: todayCard?.savedTrainSessionId || null,
        session: todayCard?.sess || null,
      };

      const sessionsPlanned = calendarDays.reduce(
        (sum, day) => sum + (Array.isArray(day.cards) ? day.cards.length : 0),
        0
      );
      const sessionsCompleted = calendarDays.reduce(
        (sum, day) => sum + day.cards.filter((card) => card.status === "completed").length,
        0
      );
      const plannedKm = calendarDays.reduce(
        (sum, day) =>
          sum +
          day.cards.reduce(
            (inner, card) => inner + (sessionDistanceKm(card?.sess) || 0),
            0
          ),
        0
      );

      const todayHero = buildTodayHero(todayData, mergedWeek.title);
      const insight = buildInsight(todayData);
      const statusLabel = !todayData.session
        ? "Recovery day"
        : todayHero.completed
          ? "Completed today"
          : "Today's session";

      const nextState = {
        loading: false,
        refreshing: false,
        loadError: partialErrors.length
          ? "Some live data could not be loaded. Showing what is available."
          : "",
        hasPlan: true,
        greeting: buildGreeting(now),
        dateLabel: formatLongDate(now),
        statusLabel,
        weekLabel: mergedWeek.title,
        metrics: [
          {
            label: "Week total",
            value: plannedKm > 0 ? `${plannedKm.toFixed(1)} km` : "—",
          },
          {
            label: "Sessions",
            value: sessionsPlanned > 0
              ? `${sessionsCompleted} / ${sessionsPlanned}`
              : "0 / 0",
          },
          {
            label: "Weight",
            value: weightKg != null ? `${weightKg.toFixed(1)} kg` : "—",
          },
        ],
        timeline: calendarDays.map((day) => ({
          day: day.day,
          date: day.date,
          isoDate: day.isoDate,
          state: day.state,
          label: day.label,
        })),
        todayHero,
        insight,
        calendarDays,
        currentWeekIndex,
        displayWeekIndex,
        visibleWeeksCount,
      };
      HOME_DASHBOARD_CACHE.set(cacheKey, nextState);
      setState(nextState);
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        greeting: buildGreeting(now),
        dateLabel: formatLongDate(now),
        loadError: "Could not load your home dashboard right now.",
      }));
    }
  }, [cacheKey, requestedWeekOffset]);

  useEffect(() => {
    if (!currentUid) {
      setState(buildInitialState());
      return;
    }

    if (HOME_DASHBOARD_CACHE.has(cacheKey)) {
      setState(HOME_DASHBOARD_CACHE.get(cacheKey));
      return;
    }

    load({ silent: false });
  }, [cacheKey, currentUid, load]);

  const actions = useMemo(
    () => [
      { key: "calendar", label: "Calendar", path: "/home/calendar" },
      { key: "coach", label: "Coach", path: "/chat" },
      { key: "fuel", label: "Fuel", path: "/nutrition/fuelmatch" },
    ],
    []
  );

  return {
    ...state,
    quickActions: actions,
    canGoPrevWeek:
      Number.isFinite(Number(state.displayWeekIndex)) && Number(state.displayWeekIndex) > 0,
    canGoNextWeek:
      Number.isFinite(Number(state.displayWeekIndex)) &&
      Number.isFinite(Number(state.visibleWeeksCount)) &&
      Number(state.displayWeekIndex) < Number(state.visibleWeeksCount) - 1,
    refresh: () => load({ silent: true }),
    reload: () => load({ silent: false }),
  };
}

export default useHomeDashboardData;
