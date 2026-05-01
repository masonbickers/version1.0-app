// app/(protected)/chat/page.jsx
"use client";

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import {
  createEmptyRecentTrainingSummary,
  summariseRecentTraining,
} from "../../../src/lib/train/adaptationModel";
import { useTheme } from "../../../providers/ThemeProvider";

import { onAuthStateChanged } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";

/* ---------------- palette ---------------- */
const BG = "#000000";
const TEXT = "#FFFFFF";
const SUBTEXT = "#8A8A8D";
const USER_BUBBLE_BG = "#1A1A1D";
const COACH_BUBBLE_BG = "#000000";
const PRIMARY = "#E6FF3B";

const FOOTER_OFFSET = 90;

// storage keys
const VISIBLE_CHAT_STORAGE_KEY = "trainr_coach_chat_visible_v1";
const MEMORY_CHAT_STORAGE_KEY = "trainr_coach_chat_memory_v1";

const INITIAL_SYSTEM_MESSAGE = [
  "I'm your AI coach.",
  "",
  "I can help with:",
  "- training",
  "- nutrition",
  "- recovery",
  "- plan changes",
  "",
  "I use your plan, recent training, and nutrition data when it's available.",
  "",
  "Ask me things like:",
  "- What should I focus on this week?",
  "- How should I fuel today's session?",
  "- Adjust my plan if my legs feel heavy.",
].join("\n");

const QUICK_PROMPTS = [
  "What should I focus on this week?",
  "How should I fuel today's training?",
  "Review my recent training and tell me what stands out.",
  "Adjust my plan if my legs feel heavy this week.",
];

const PLAN_DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PLAN_COLLECTIONS = ["plans", "runPlans", "trainingPlans"];

function startOfISOWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toISODate(d) {
  const value = new Date(d);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayDate(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatFullDate(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimeOfDay(d) {
  return new Date(d).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildClockContext(d = new Date()) {
  const value = new Date(d);
  const timeZone =
    Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || null;

  return {
    timezone: timeZone,
    todayIso: toISODate(value),
    todayLabel: formatFullDate(value),
    weekday: value.toLocaleDateString("en-GB", { weekday: "long" }),
    localTime: formatTimeOfDay(value),
    generatedAtIso: value.toISOString(),
  };
}

function createWelcomeMessage() {
  return {
    id: "welcome",
    role: "assistant",
    content: INITIAL_SYSTEM_MESSAGE,
    createdAt: Date.now(),
  };
}

function getMessageTimestamp(message) {
  const explicit = Number(message?.createdAt || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const idMatch = String(message?.id || "").match(/-(\d{10,})$/);
  if (!idMatch) return null;

  const inferred = Number(idMatch[1]);
  return Number.isFinite(inferred) && inferred > 0 ? inferred : null;
}

function formatMessageTime(message) {
  const timestamp = getMessageTimestamp(message);
  if (!timestamp) return "";

  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitReplyForTypewriter(text) {
  // Return words only (no whitespace tokens) for true "word-by-word" typing.
  // Preserve existing spacing by joining with a single space during rendering.
  return String(text || "").trim().match(/\S+/g) || [];
}

// ------------------------------------------------------
function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefinedDeep(v))
      .filter((v) => v !== undefined);
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = removeUndefinedDeep(val);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  if (value === undefined) return undefined;
  return value;
}

// date helpers
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}
function safeToDate(tsLike) {
  const d =
    tsLike?.toDate?.() ||
    (tsLike instanceof Date ? tsLike : new Date(tsLike));
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

function parseDateLike(value) {
  if (!value) return null;

  try {
    if (typeof value?.toDate === "function") {
      const fromTimestamp = value.toDate();
      if (fromTimestamp instanceof Date && !Number.isNaN(fromTimestamp.getTime())) {
        fromTimestamp.setHours(0, 0, 0, 0);
        return fromTimestamp;
      }
    }
  } catch {}

  const raw =
    typeof value === "string" || typeof value === "number" || value instanceof Date
      ? value
      : null;

  if (!raw) return null;

  if (raw instanceof Date) {
    const out = new Date(raw);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }

  const ymdMatch = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const yyyy = Number(ymdMatch[1]);
    const mm = Number(ymdMatch[2]);
    const dd = Number(ymdMatch[3]);
    const out = new Date(yyyy, mm - 1, dd);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }

  const out = new Date(raw);
  if (Number.isNaN(out.getTime())) return null;
  out.setHours(0, 0, 0, 0);
  return out;
}

// keep system message small (LLMs hate massive blobs)
function buildNutritionContextText(nutritionSummary) {
  if (!nutritionSummary) return "Nutrition context: none available.";

  const goal = nutritionSummary.goal;
  const today = nutritionSummary.today;
  const week = nutritionSummary.week;

  const goalLine = goal
    ? `Goal: ${Math.round(goal.dailyCalories || 0)} kcal • P ${Math.round(
        goal.proteinTarget || 0
      )}g • C ${Math.round(goal.carbTarget || 0)}g • F ${Math.round(
        goal.fatTarget || 0
      )}g`
    : "Goal: not set.";

  const todayLine = today?.totals
    ? `Today (${today.date}): ${Math.round(today.totals.calories || 0)} kcal • P ${Math.round(
        today.totals.protein || 0
      )}g • C ${Math.round(today.totals.carbs || 0)}g • F ${Math.round(
        today.totals.fat || 0
      )}g`
    : "Today: no totals.";

  const remainLine =
    today?.remaining && goal
      ? `Remaining today: ${Math.round(today.remaining.calories || 0)} kcal • P ${Math.round(
          today.remaining.protein || 0
        )}g • C ${Math.round(today.remaining.carbs || 0)}g • F ${Math.round(
          today.remaining.fat || 0
        )}g`
      : "";

  const weekLine = week?.avg
    ? `7-day avg: ${Math.round(week.avg.calories || 0)} kcal • P ${Math.round(
        week.avg.protein || 0
      )}g • C ${Math.round(week.avg.carbs || 0)}g • F ${Math.round(
        week.avg.fat || 0
      )}g (days logged: ${week.totalDays || 0})`
    : "7-day avg: none.";

  const scoreLine = week?.nutritionScore
    ? `Nutrition score: ${week.nutritionScore.grade} (${week.nutritionScore.desc})`
    : "";

  // last 8 meals only (compact)
  const meals = Array.isArray(nutritionSummary.recentMeals)
    ? nutritionSummary.recentMeals.slice(0, 8)
    : [];

  const mealsLines =
    meals.length > 0
      ? meals
          .map((m) => {
            const when = m.date ? m.date.slice(0, 16).replace("T", " ") : "";
            const type = m.mealType ? `${m.mealType} · ` : "";
            return `- ${when} | ${type}${m.title} (${Math.round(m.calories || 0)} kcal, P ${Math.round(
              m.protein || 0
            )}g C ${Math.round(m.carbs || 0)}g F ${Math.round(m.fat || 0)}g)`;
          })
          .join("\n")
      : "- No meals logged in last 7 days.";

  return [
    "Nutrition context (use this as truth):",
    goalLine,
    todayLine,
    remainLine,
    weekLine,
    scoreLine,
    "Recent meals:",
    mealsLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlanContextText(plan) {
  if (!plan) return "Plan context: none available.";
  const meta = plan?.meta || {};
  return [
    "Training plan context:",
    `Name: ${meta.name || plan.name || ""}`,
    `Primary: ${meta.primaryActivity || plan.primaryActivity || ""}`,
    `Event: ${meta.targetEventName || plan.targetEventName || ""} ${meta.targetEventDate || plan.targetEventDate || ""}`,
    `Focus: ${meta.goalPrimaryFocus || plan.goalPrimaryFocus || ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function extractPlanWeeks(plan) {
  const candidates = [
    plan?.weeks,
    plan?.plan?.weeks,
    plan?.planData?.weeks,
    plan?.generatedPlan?.weeks,
    plan?.activePlan?.weeks,
    plan?.output?.weeks,
    plan?.result?.weeks,
    plan?.template?.weeks,
    plan?.program?.weeks,
    plan?.schedule?.weeks,
    plan?.payload?.weeks,
  ];

  for (const candidate of candidates) {
    const weeks = normaliseList(candidate);
    if (weeks.length) return weeks;
  }

  return [];
}

function extractPlanSessionPreviews(plan, maxCount = 10) {
  const weeks = extractPlanWeeks(plan);
  const previews = [];

  weeks.forEach((week, weekIndex) => {
    const weekLabel =
      week?.title ||
      (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);
    const days = normaliseList(week?.days);

    if (days.length) {
      days.forEach((day, dayIndex) => {
        const dayLabel = day?.day || day?.label || day?.name || `Day ${dayIndex + 1}`;
        const sessions = normaliseList(day?.sessions);

        sessions.forEach((session, sessionIndex) => {
          if (previews.length >= maxCount) return;
          previews.push({
            key: `${weekIndex}-${dayIndex}-${sessionIndex}`,
            weekLabel,
            dayLabel,
            title:
              session?.title || session?.name || session?.type || session?.sessionType || "Session",
            durationMin:
              Number(session?.targetDurationMin ?? session?.durationMin ?? 0) || null,
            distanceKm:
              Number(session?.targetDistanceKm ?? session?.distanceKm ?? 0) || null,
            type: session?.workout?.sport || session?.sessionType || session?.type || "",
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
      if (previews.length >= maxCount) return;
      previews.push({
        key: `${weekIndex}-0-${sessionIndex}`,
        weekLabel,
        dayLabel: weekLabel,
        title:
          session?.title || session?.name || session?.type || session?.sessionType || "Session",
        durationMin:
          Number(session?.targetDurationMin ?? session?.durationMin ?? 0) || null,
        distanceKm:
          Number(session?.targetDistanceKm ?? session?.distanceKm ?? 0) || null,
        type: session?.workout?.sport || session?.sessionType || session?.type || "",
      });
    });
  });

  return previews.slice(0, maxCount);
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

function summariseSessionForContext(session) {
  if (!session) return null;

  const durationMinRaw =
    session?.targetDurationMin ??
    session?.durationMin ??
    (Number(session?.workout?.totalDurationSec || 0)
      ? Number(session.workout.totalDurationSec) / 60
      : null);

  const distanceKmRaw =
    session?.targetDistanceKm ??
    session?.distanceKm ??
    session?.plannedDistanceKm ??
    session?.workout?.totalDistanceKm ??
    null;

  return removeUndefinedDeep({
    title:
      session?.title ||
      session?.name ||
      session?.type ||
      session?.sessionType ||
      "Session",
    sessionType: session?.sessionType || session?.type || session?.workout?.sport || null,
    durationMin: roundOrNull(durationMinRaw, 1),
    distanceKm: roundOrNull(distanceKmRaw, 2),
    notes: String(session?.notes || session?.description || "").trim() || null,
  });
}

function normalisePlanWeeksForContext(weeks) {
  return normaliseList(weeks)
    .slice(0, 24)
    .map((week, weekIndex) => {
      const weekLabel =
        week?.title ||
        (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);

      const rawDays = normaliseList(week?.days);
      if (rawDays.length) {
        const dayMap = new Map(
          rawDays.map((day) => [String(day?.day || "").trim(), day])
        );
        const orderedLabels = [
          ...PLAN_DAY_ORDER,
          ...rawDays
            .map((day) => String(day?.day || "").trim())
            .filter((label) => label && !PLAN_DAY_ORDER.includes(label)),
        ];

        const days = orderedLabels.map((label, dayIndex) => {
          const rawDay = dayMap.get(label) || { day: label || `Day ${dayIndex + 1}` };
          const fallbackDay = rawDays?.[dayIndex] || null;
          const sessions = normaliseList(rawDay?.sessions)
            .map(summariseSessionForContext)
            .filter(Boolean);

          return {
            day: label || rawDay?.day || `Day ${dayIndex + 1}`,
            date: rawDay?.date || rawDay?.isoDate || fallbackDay?.date || fallbackDay?.isoDate || null,
            sessions,
          };
        });

        return {
          title: weekLabel,
          weekIndex0:
            typeof week?.weekIndex0 === "number" ? week.weekIndex0 : weekIndex,
          weekNumber:
            typeof week?.weekNumber === "number" ? week.weekNumber : weekIndex + 1,
          weekStartDate: week?.weekStartDate || week?.startDate || null,
          weekEndDate: week?.weekEndDate || week?.endDate || null,
          days,
        };
      }

      const sessions = [
        ...normaliseList(week?.sessions),
        ...normaliseList(week?.workouts),
      ]
        .map(summariseSessionForContext)
        .filter(Boolean);

      return {
        title: weekLabel,
        weekIndex0:
          typeof week?.weekIndex0 === "number" ? week.weekIndex0 : weekIndex,
        weekNumber:
          typeof week?.weekNumber === "number" ? week.weekNumber : weekIndex + 1,
        weekStartDate: week?.weekStartDate || week?.startDate || null,
        weekEndDate: week?.weekEndDate || week?.endDate || null,
        days: [{ day: weekLabel, sessions }],
      };
    });
}

function normalisePlanDocShape(source, idOverride = "") {
  const data = source?.data ? source.data() : source || {};
  const rawPlan = data?.plan || {};
  const weeksRaw = rawPlan?.weeks || data?.weeks || [];
  const kind = data?.kind || rawPlan?.kind || inferPlanKindFromDoc(data);
  const nameFromMeta = data?.meta?.name;
  const nameFromPlan = rawPlan?.name;
  const nameFromData = data?.name;

  const primaryActivity =
    data?.meta?.primaryActivity ||
    data?.primaryActivity ||
    rawPlan?.primaryActivity ||
    (kind === "run" ? "Run" : kind === "strength" ? "Strength" : "Training");

  return {
    id: idOverride || source?.id || data?.id || "",
    sourceCollection:
      source?.sourceCollection || data?.sourceCollection || "plans",
    ...data,
    rawDoc: data,
    kind,
    name: nameFromMeta || nameFromPlan || nameFromData || "Training Plan",
    primaryActivity,
    weeks: normalisePlanWeeksForContext(weeksRaw),
  };
}

function sortPlansForContext(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const aDate =
      safeToDate(a?.updatedAt) ||
      safeToDate(a?.createdAt) ||
      safeToDate(a?.rawDoc?.updatedAt) ||
      safeToDate(a?.rawDoc?.createdAt) ||
      new Date(0);
    const bDate =
      safeToDate(b?.updatedAt) ||
      safeToDate(b?.createdAt) ||
      safeToDate(b?.rawDoc?.updatedAt) ||
      safeToDate(b?.rawDoc?.createdAt) ||
      new Date(0);
    return bDate - aDate;
  });
}

function selectActivePlans(docs) {
  const list = Array.isArray(docs) ? docs.filter((item) => item?.id) : [];
  const run = list.find((item) => inferPlanKindFromDoc(item) === "run") || null;
  const strength =
    list.find((item) => inferPlanKindFromDoc(item) === "strength") || null;

  let primary = null;
  let companion = null;

  if (run) {
    primary = run;
    companion = strength && strength.id !== run.id ? strength : null;
  } else if (strength) {
    primary = strength;
    companion =
      list.find(
        (item) =>
          item.id !== strength.id &&
          inferPlanKindFromDoc(item) !== inferPlanKindFromDoc(strength)
      ) || null;
  } else {
    primary = list[0] || null;
    companion = list[1] || null;
  }

  const activePlans = [primary, companion].filter(
    (item, index, arr) => item?.id && arr.findIndex((p) => p?.id === item.id) === index
  );

  return {
    primary,
    companion: companion && companion?.id !== primary?.id ? companion : null,
    activePlans,
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

      const anchor = addDays(logDate, -(Math.round(weekIndex) * 7 + Math.round(dayIndex)));
      anchor.setHours(0, 0, 0, 0);
      const key = toISODate(anchor);
      const prev = anchorVotes.get(key) || 0;
      anchorVotes.set(key, prev + 1);
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
      planDoc?.rawDoc?.startDate ||
      planDoc?.rawDoc?.plan?.startDate ||
      planDoc?.rawDoc?.meta?.startDate ||
      planDoc?.createdAt ||
      planDoc?.updatedAt ||
      planDoc?.rawDoc?.createdAt ||
      planDoc?.rawDoc?.updatedAt
  );

  return fallbackStart ? startOfISOWeek(fallbackStart) : null;
}

function buildMergedExactSchedule(plans, maxItems = 24, sessionLogMap = null) {
  const items = [];
  const now = new Date();
  const todayIso = toISODate(now);
  const currentWeekStart = startOfISOWeek(now);
  const currentWeekStartIso = toISODate(currentWeekStart);

  (Array.isArray(plans) ? plans : []).forEach((plan) => {
    const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
    const planWeekZeroStart = resolvePlanWeekZeroStart(plan, sessionLogMap) || currentWeekStart;

    weeks.forEach((week, weekIndex) => {
      const weekLabel =
        week?.title ||
        (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);
      const days = Array.isArray(week?.days) ? week.days : [];

      days.forEach((day, dayIndex) => {
        const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
        sessions.forEach((session, sessionIndex) => {
          const summary = summariseSessionForContext(session);
          if (!summary) return;
          const date = addDays(planWeekZeroStart, weekIndex * 7 + dayIndex);
          const isoDate = toISODate(date);

          items.push({
            planId: plan?.id || null,
            planName: plan?.name || null,
            planKind: inferPlanKindFromDoc(plan),
            weekIndex,
            weekLabel,
            dayIndex,
            dayLabel: day?.day || `Day ${dayIndex + 1}`,
            isoDate,
            dateLabel: formatDayDate(date),
            isToday: isoDate === todayIso,
            sessionIndex,
            ...summary,
          });
        });
      });
    });
  });

  return items
    .sort((a, b) => {
      if (a.isoDate !== b.isoDate) return String(a.isoDate).localeCompare(String(b.isoDate));
      if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      if (a.planKind !== b.planKind) return String(a.planKind).localeCompare(String(b.planKind));
      return a.sessionIndex - b.sessionIndex;
    })
    .filter((item) => String(item?.isoDate || "") >= currentWeekStartIso)
    .slice(0, maxItems);
}

function roundOrNull(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function summariseWeights(rows) {
  const ordered = [...(Array.isArray(rows) ? rows : [])]
    .map((row) => ({
      ...row,
      _date: safeToDate(row?.date || row?.createdAt),
      _weight: Number(row?.weight || row?.value || 0),
    }))
    .filter((row) => row._date && Number.isFinite(row._weight) && row._weight > 0)
    .sort((a, b) => a._date - b._date);

  if (!ordered.length) return null;

  const latest = ordered[ordered.length - 1];
  const latestDate = latest._date;

  const nearestFromDaysAgo = (days) => {
    const target = new Date(latestDate);
    target.setDate(target.getDate() - days);
    let candidate = ordered[0];

    ordered.forEach((row) => {
      if (row._date <= latestDate && row._date >= target) {
        candidate = row;
      }
    });

    return candidate;
  };

  const from7d = nearestFromDaysAgo(7);
  const from30d = nearestFromDaysAgo(30);

  return {
    latestKg: roundOrNull(latest._weight, 1),
    latestDate: latestDate.toISOString(),
    change7dKg:
      from7d && from7d !== latest ? roundOrNull(latest._weight - from7d._weight, 1) : null,
    change30dKg:
      from30d && from30d !== latest ? roundOrNull(latest._weight - from30d._weight, 1) : null,
    entriesCount: ordered.length,
  };
}

export default function CoachChatPage() {
  const { isDark } = useTheme();

  const [input, setInput] = useState("");

  const [messages, setMessages] = useState([createWelcomeMessage()]);

  const [memoryMessages, setMemoryMessages] = useState([]);
  const memoryMessagesRef = useRef([]);
  const [isSending, setIsSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());

  const [allPlans, setAllPlans] = useState([]);

  const [nutritionSummary, setNutritionSummary] = useState(null);
  const [planPrefs, setPlanPrefs] = useState(null);
  const [recentTrainSummary, setRecentTrainSummary] = useState(() =>
    createEmptyRecentTrainingSummary()
  );
  const [weightSummary, setWeightSummary] = useState(null);
  const [sessionLogMap, setSessionLogMap] = useState({});

  const [user, setUser] = useState(null);

  const scrollViewRef = useRef(null);
  const s = makeStyles();
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  const devLog = useCallback(
    (...args) => {
      if (isDev) console.log(...args);
    },
    [isDev]
  );

  const scrollToEnd = () =>
    scrollViewRef.current?.scrollToEnd?.({ animated: true });

  useEffect(() => {
    memoryMessagesRef.current = Array.isArray(memoryMessages) ? memoryMessages : [];
  }, [memoryMessages]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, isSending]);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // keyboard listeners
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // auth subscription
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // load chat from storage
  useEffect(() => {
    const loadChat = async () => {
      try {
        const [visibleRaw, memoryRaw] = await Promise.all([
          AsyncStorage.getItem(VISIBLE_CHAT_STORAGE_KEY),
          AsyncStorage.getItem(MEMORY_CHAT_STORAGE_KEY),
        ]);

        if (visibleRaw) {
          const parsedVisible = JSON.parse(visibleRaw);
          if (Array.isArray(parsedVisible) && parsedVisible.length > 0) {
            setMessages(parsedVisible);
          }
        }

        if (memoryRaw) {
          const parsedMemory = JSON.parse(memoryRaw);
          if (Array.isArray(parsedMemory)) setMemoryMessages(parsedMemory);
        }
      } catch (err) {
        console.log("[coach-chat] failed to load chat:", err);
      } finally {
        setHydrated(true);
      }
    };

    loadChat();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      VISIBLE_CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-80))
    ).catch((err) => console.log("[coach-chat] save visible err:", err));
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      MEMORY_CHAT_STORAGE_KEY,
      JSON.stringify(memoryMessages.slice(-200))
    ).catch((err) => console.log("[coach-chat] save memory err:", err));
  }, [memoryMessages, hydrated]);

  useEffect(() => {
    if (!user) {
      setAllPlans([]);
      return;
    }

    const latestByCollection = Object.create(null);

    const syncPlans = () => {
      const primaryPlans = latestByCollection.plans || [];
      const merged = primaryPlans.length
        ? primaryPlans
        : PLAN_COLLECTIONS.flatMap((colName) => latestByCollection[colName] || []);

      const deduped = [];
      const seen = new Set();

      sortPlansForContext(merged).forEach((doc) => {
        const key = `${doc?.sourceCollection || "plans"}:${doc?.id || ""}`;
        if (!doc?.id || seen.has(key)) return;
        seen.add(key);
        deduped.push(doc);
      });

      setAllPlans(deduped);
    };

    const unsubs = PLAN_COLLECTIONS.map((colName) =>
      onSnapshot(
        query(collection(db, "users", user.uid, colName), limit(40)),
        (snap) => {
          latestByCollection[colName] = snap.docs
            .map((docSnap) =>
              normalisePlanDocShape(
                {
                  id: docSnap.id,
                  data: () => docSnap.data(),
                  sourceCollection: colName,
                },
                docSnap.id
              )
            )
            .filter((doc) => doc?.id);
          syncPlans();
        },
        (err) => {
          console.log(`[coach-chat] failed to load ${colName}:`, err);
          latestByCollection[colName] = [];
          syncPlans();
        }
      )
    );

    return () => unsubs.forEach((unsub) => unsub?.());
  }, [user]);

  useEffect(() => {
    if (!user) {
      setPlanPrefs(null);
      return;
    }

    const ref = doc(db, "users", user.uid, "planPrefs", "current");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setPlanPrefs(snap.exists() ? snap.data() : null);
      },
      (err) => {
        console.log("[coach-chat] failed to load plan prefs:", err);
        setPlanPrefs(null);
      }
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setRecentTrainSummary(createEmptyRecentTrainingSummary());
      return;
    }

    const ref = collection(db, "users", user.uid, "trainSessions");
    const q = query(ref, orderBy("updatedAt", "desc"), limit(12));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRecentTrainSummary(summariseRecentTraining(rows));
      },
      (err) => {
        console.log("[coach-chat] recent train snapshot error:", err);
        setRecentTrainSummary(createEmptyRecentTrainingSummary());
      }
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setWeightSummary(null);
      return;
    }

    const ref = collection(db, "users", user.uid, "weights");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setWeightSummary(summariseWeights(rows));
      },
      (err) => {
        console.log("[coach-chat] weights snapshot error:", err);
        setWeightSummary(null);
      }
    );

    return () => unsub();
  }, [user]);

  // LIVE nutrition (same schema as Nutrition page: meals.date Timestamp)
  useEffect(() => {
    if (!user) {
      setNutritionSummary(null);
      return;
    }

    let unsubGoal = null;
    let unsubMeals = null;

    const goalRef = doc(db, "users", user.uid, "nutrition", "profile");
    const mealsRef = collection(db, "users", user.uid, "meals");

    const since = startOfDay(daysAgo(6));
    const qMeals7d = query(
      mealsRef,
      where("date", ">=", Timestamp.fromDate(since)),
      orderBy("date", "desc")
    );

    let latestGoal = null;
    let latestMeals = [];

    const recompute = () => {
      const goal = latestGoal
        ? {
            dailyCalories: Number(latestGoal.dailyCalories || 0),
            proteinTarget: Number(latestGoal.proteinTarget || 0),
            carbTarget: Number(latestGoal.carbTarget || 0),
            fatTarget: Number(latestGoal.fatTarget || 0),
            raw: latestGoal,
          }
        : null;

      const goalCals = goal?.dailyCalories || 0;

      const today = startOfDay();
      const todayKey = today.toISOString().slice(0, 10);

      const todayTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      const byDay = {};

      latestMeals.forEach((m) => {
        const d = safeToDate(m.date);
        if (!d) return;
        const key = d.toISOString().slice(0, 10);

        if (!byDay[key]) {
          byDay[key] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
        }

        byDay[key].calories += Number(m.calories || 0);
        byDay[key].protein += Number(m.protein || 0);
        byDay[key].carbs += Number(m.carbs || 0);
        byDay[key].fat += Number(m.fat || 0);
        byDay[key].meals += 1;

        if (key === todayKey) {
          todayTotals.calories += Number(m.calories || 0);
          todayTotals.protein += Number(m.protein || 0);
          todayTotals.carbs += Number(m.carbs || 0);
          todayTotals.fat += Number(m.fat || 0);
        }
      });

      const dayKeys = Object.keys(byDay);
      const total = dayKeys.reduce(
        (acc, k) => ({
          calories: acc.calories + byDay[k].calories,
          protein: acc.protein + byDay[k].protein,
          carbs: acc.carbs + byDay[k].carbs,
          fat: acc.fat + byDay[k].fat,
          days: acc.days + 1,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
      );

      const weekAvg =
        total.days > 0
          ? {
              calories: Math.round(total.calories / total.days),
              protein: Math.round(total.protein / total.days),
              carbs: Math.round(total.carbs / total.days),
              fat: Math.round(total.fat / total.days),
            }
          : { calories: 0, protein: 0, carbs: 0, fat: 0 };

      let nutritionScore = null;
      if (goalCals && weekAvg.calories) {
        const diffRatio = Math.abs(weekAvg.calories - goalCals) / goalCals;
        let grade = "C";
        let desc = "Big swings vs your calorie target.";
        if (diffRatio <= 0.08) {
          grade = "A";
          desc = "Dialled in — very close to your target on average.";
        } else if (diffRatio <= 0.15) {
          grade = "B";
          desc = "Pretty close to your target, with some day-to-day variation.";
        }
        nutritionScore = { grade, desc, diffPercent: Math.round(diffRatio * 100) };
      }

      const remaining =
        goal && goalCals
          ? {
              calories: Math.max(0, Math.round(goalCals - todayTotals.calories)),
              protein: Math.max(
                0,
                Math.round((goal.proteinTarget || 0) - todayTotals.protein)
              ),
              carbs: Math.max(
                0,
                Math.round((goal.carbTarget || 0) - todayTotals.carbs)
              ),
              fat: Math.max(
                0,
                Math.round((goal.fatTarget || 0) - todayTotals.fat)
              ),
            }
          : null;

      const recentMeals = latestMeals.slice(0, 25).map((m) => {
        const d = safeToDate(m.date);
        return {
          id: m.id,
          title: m.title || "",
          mealType: m.mealType || "",
          calories: Number(m.calories || 0),
          protein: Number(m.protein || 0),
          carbs: Number(m.carbs || 0),
          fat: Number(m.fat || 0),
          notes: m.notes || "",
          source: m.source || "",
          date: d ? d.toISOString() : null,
        };
      });

      const summary = {
        goal,
        today: { date: todayKey, totals: todayTotals, remaining },
        week: { avg: weekAvg, totalDays: total.days, nutritionScore },
        recentMeals,
      };

      const hasAnything =
        !!goal ||
        recentMeals.length > 0 ||
        todayTotals.calories ||
        todayTotals.protein ||
        todayTotals.carbs ||
        todayTotals.fat;

      setNutritionSummary(hasAnything ? summary : null);

      devLog(
        "[coach-chat] nutrition linked:",
        hasAnything,
        "meals7d:",
        latestMeals.length,
        "goal:",
        !!goal
      );
    };

    unsubGoal = onSnapshot(
      goalRef,
      (snap) => {
        latestGoal = snap.exists() ? snap.data() : null;
        recompute();
      },
      (err) => {
        console.log("[coach-chat] goal snapshot error:", err);
        latestGoal = null;
        recompute();
      }
    );

    unsubMeals = onSnapshot(
      qMeals7d,
      (snap) => {
        latestMeals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        recompute();
      },
      (err) => {
        console.log("[coach-chat] meals snapshot error:", err);
        latestMeals = [];
        recompute();
      }
    );

    return () => {
      if (unsubGoal) unsubGoal();
      if (unsubMeals) unsubMeals();
    };
  }, [user]);

  const nutritionLinkedText = useMemo(() => {
    if (!nutritionSummary) return "not linked";
    const n = nutritionSummary.recentMeals?.length || 0;
    const goal = nutritionSummary.goal ? "goal" : "no goal";
    return `linked • ${n} meals (7d) • ${goal}`;
  }, [nutritionSummary]);

  const { primary: plan, companion: companionPlan, activePlans } = useMemo(
    () => selectActivePlans(allPlans),
    [allPlans]
  );

  const planDocId = plan?.id || null;
  const activePlanIds = useMemo(
    () =>
      activePlans
        .map((item) => String(item?.id || "").trim())
        .filter(Boolean),
    [activePlans]
  );

  useEffect(() => {
    if (!user || !activePlanIds.length) {
      setSessionLogMap({});
      return;
    }

    const ref = collection(db, "users", user.uid, "sessionLogs");
    const chunks = [];
    for (let idx = 0; idx < activePlanIds.length; idx += 10) {
      chunks.push(activePlanIds.slice(idx, idx + 10));
    }

    const partialMaps = {};
    let closed = false;

    const syncMergedMap = () => {
      if (closed) return;
      const merged = {};
      Object.values(partialMaps).forEach((chunkMap) => {
        Object.assign(merged, chunkMap || {});
      });
      setSessionLogMap(merged);
    };

    const unsubs = chunks.map((ids, chunkIdx) =>
      onSnapshot(
        query(ref, where("planId", "in", ids)),
        (snap) => {
          const nextMap = {};
          snap.forEach((docSnap) => {
            nextMap[docSnap.id] = docSnap.data() || {};
          });
          partialMaps[chunkIdx] = nextMap;
          syncMergedMap();
        },
        (err) => {
          console.log("[coach-chat] session logs snapshot error:", err);
          partialMaps[chunkIdx] = {};
          syncMergedMap();
        }
      )
    );

    return () => {
      closed = true;
      unsubs.forEach((unsub) => unsub?.());
    };
  }, [activePlanIds, user]);

  const exactSchedule = useMemo(
    () => buildMergedExactSchedule(activePlans, 28, sessionLogMap),
    [activePlans, sessionLogMap]
  );

  const currentWeekSchedule = useMemo(
    () => {
      const weekStartIso = toISODate(startOfISOWeek(new Date()));
      const nextWeekStartIso = toISODate(addDays(startOfISOWeek(new Date()), 7));
      return exactSchedule.filter(
        (item) =>
          String(item?.isoDate || "") >= weekStartIso &&
          String(item?.isoDate || "") < nextWeekStartIso
      );
    },
    [exactSchedule]
  );

  const todaySchedule = useMemo(
    () => exactSchedule.filter((item) => !!item?.isToday),
    [exactSchedule]
  );

  const activePlansDetailed = useMemo(
    () =>
      activePlans.map((activePlan) => ({
        id: activePlan?.id || null,
        name: activePlan?.name || null,
        kind: inferPlanKindFromDoc(activePlan),
        primaryActivity: activePlan?.primaryActivity || null,
        goalPrimaryFocus: activePlan?.goalPrimaryFocus || null,
        targetEventName: activePlan?.targetEventName || null,
        targetEventDate: activePlan?.targetEventDate || null,
        weeksCount: Array.isArray(activePlan?.weeks) ? activePlan.weeks.length : 0,
        weeks: Array.isArray(activePlan?.weeks) ? activePlan.weeks : [],
      })),
    [activePlans]
  );

  const clockContext = useMemo(
    () => buildClockContext(new Date(clockTick)),
    [clockTick]
  );

  const chatContext = useMemo(() => {
    const profileFromNutrition = nutritionSummary?.goal
      ? {
          sex: nutritionSummary.goal.raw?.sex || null,
          age: nutritionSummary.goal.raw?.age || null,
          heightCm: nutritionSummary.goal.raw?.heightCm || null,
          weightKg: nutritionSummary.goal.raw?.weightKg || null,
        }
      : null;

    return {
      athleteProfile: removeUndefinedDeep({
        age: planPrefs?.age ?? profileFromNutrition?.age ?? null,
        sex: planPrefs?.sex ?? profileFromNutrition?.sex ?? null,
        heightCm: planPrefs?.heightCm ?? profileFromNutrition?.heightCm ?? null,
        weightKg: planPrefs?.weightKg ?? profileFromNutrition?.weightKg ?? null,
        goalDistance: planPrefs?.goalDistance ?? null,
        goalPrimaryFocus: planPrefs?.goalPrimaryFocus ?? plan?.goalPrimaryFocus ?? null,
        targetEventName: planPrefs?.targetEventName ?? plan?.targetEventName ?? null,
        targetEventDate: planPrefs?.targetEventDate ?? plan?.targetEventDate ?? null,
        injuries: planPrefs?.injuries ?? null,
        constraints: planPrefs?.constraints ?? null,
        notesForCoach: planPrefs?.notesForCoach ?? null,
        bodyweightTrend: weightSummary,
      }),
      training: removeUndefinedDeep({
        activePlan: plan
          ? {
              id: plan.id || null,
              name: plan.name || null,
              primaryActivity: plan.primaryActivity || null,
              goalPrimaryFocus: plan.goalPrimaryFocus || null,
              targetEventName: plan.targetEventName || null,
              targetEventDate: plan.targetEventDate || null,
              weeksCount: Array.isArray(plan?.weeks) ? plan.weeks.length : 0,
              nextSessions: exactSchedule
                .filter((item) => item?.planId === plan.id)
                .slice(0, 12),
            }
          : null,
        companionPlan: companionPlan
          ? {
              id: companionPlan.id || null,
              name: companionPlan.name || null,
              primaryActivity: companionPlan.primaryActivity || null,
              goalPrimaryFocus: companionPlan.goalPrimaryFocus || null,
              targetEventName: companionPlan.targetEventName || null,
              targetEventDate: companionPlan.targetEventDate || null,
              weeksCount: Array.isArray(companionPlan?.weeks)
                ? companionPlan.weeks.length
                : 0,
              nextSessions: exactSchedule
                .filter((item) => item?.planId === companionPlan.id)
                .slice(0, 12),
            }
          : null,
        activePlans: activePlansDetailed,
        exactSchedule,
        currentWeekSchedule,
        todaySchedule,
        weekDateAnchor: {
          model: "week_0_is_current_iso_week",
          currentWeekStartIso: toISODate(startOfISOWeek(new Date())),
          todayIso: toISODate(new Date()),
          todayLabel: formatDayDate(new Date()),
        },
        recentTraining: recentTrainSummary,
      }),
      nutrition: nutritionSummary
        ? {
            ...nutritionSummary,
            recentMeals: Array.isArray(nutritionSummary.recentMeals)
              ? nutritionSummary.recentMeals.slice(0, 10)
              : [],
          }
        : null,
      clock: clockContext,
    };
  }, [
    activePlansDetailed,
    clockContext,
    companionPlan,
    currentWeekSchedule,
    exactSchedule,
    nutritionSummary,
    plan,
    planPrefs,
    recentTrainSummary,
    todaySchedule,
    weightSummary,
  ]);

  const contextBadges = useMemo(() => {
    const badges = [];

    if (activePlans.length > 1) {
      badges.push(
        `Plans: ${activePlans
          .map((item) => item?.name)
          .filter(Boolean)
          .join(" + ")}`
      );
    } else if (plan?.name) {
      badges.push(`Plan: ${plan.name}`);
    }
    if (exactSchedule.length) {
      badges.push(`${exactSchedule.length} scheduled sessions loaded`);
    }
    if (recentTrainSummary?.last7d?.sessions) {
      badges.push(`${recentTrainSummary.last7d.sessions} sessions in 7d`);
    }
    if (nutritionSummary?.goal) badges.push("Nutrition target linked");
    if (nutritionSummary?.recentMeals?.length) {
      badges.push(`${nutritionSummary.recentMeals.length} recent meals`);
    }
    if (weightSummary?.latestKg != null) {
      badges.push(`${weightSummary.latestKg.toFixed(1)} kg`);
    }
    if (planPrefs?.injuries) badges.push("Injury notes loaded");

    return badges.slice(0, 6);
  }, [activePlans, exactSchedule.length, nutritionSummary, plan, planPrefs?.injuries, recentTrainSummary, weightSummary]);

  const contextHighlights = useMemo(() => {
    const highlights = [];

    if (activePlans.length > 1) {
      highlights.push({
        icon: "calendar",
        label: `${activePlans.length} active plans`,
      });
    } else if (plan?.name) {
      highlights.push({ icon: "calendar", label: plan.name });
    }
    if (exactSchedule.length) {
      highlights.push({
        icon: "list",
        label: `${exactSchedule.length} sessions loaded`,
      });
    }
    if (recentTrainSummary?.last7d?.sessions) {
      highlights.push({
        icon: "activity",
        label: `${recentTrainSummary.last7d.sessions} sessions in 7d`,
      });
    }
    if (nutritionSummary?.goal) {
      highlights.push({ icon: "coffee", label: "Nutrition linked" });
    }
    if (weightSummary?.latestKg != null) {
      highlights.push({
        icon: "bar-chart-2",
        label: `${weightSummary.latestKg.toFixed(1)} kg`,
      });
    }

    return highlights.slice(0, 4);
  }, [activePlans.length, exactSchedule.length, nutritionSummary?.goal, plan?.name, recentTrainSummary?.last7d?.sessions, weightSummary?.latestKg]);

  const handleClearChat = async () => {
    const reset = [createWelcomeMessage()];
    setMessages(reset);
    setMemoryMessages([]);
    try {
      await Promise.all([
        AsyncStorage.setItem(VISIBLE_CHAT_STORAGE_KEY, JSON.stringify(reset)),
        AsyncStorage.setItem(MEMORY_CHAT_STORAGE_KEY, JSON.stringify([])),
      ]);
    } catch (err) {
      console.log("[coach-chat] failed to clear visible chat:", err);
    }
  };

  const submitMessage = useCallback(async (rawText) => {
    const trimmed = String(rawText || "").trim();
    if (!trimmed || isSending) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setMemoryMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      if (!API_URL) throw new Error("API_URL missing (check EXPO_PUBLIC_API_URL).");

      // Use a ref to avoid stale state when messages are sent quickly.
      const mem = [...(memoryMessagesRef.current || []), userMessage]
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-40);

      const requestContext = {
        ...chatContext,
        clock: buildClockContext(new Date()),
      };

      const payload = {
        // Send both user + assistant roles for coherent conversation state.
        messages: mem.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        nutrition: nutritionSummary || null,
        plan: plan?.rawDoc ? { id: plan.id, ...plan.rawDoc } : plan || null,
        context: requestContext,
      };

      devLog(
        "[coach-chat] sending payload context:",
        !!requestContext,
        "nutrition:",
        !!nutritionSummary,
        "plan:",
        !!plan,
        "activePlans:",
        activePlans.length,
        "exactSchedule:",
        exactSchedule.length,
        "todayIso:",
        requestContext?.clock?.todayIso
      );

      const res = await fetch(`${API_URL}/coach-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      devLog("[coach-chat] status:", res.status);
      // Avoid logging raw responses in production (may contain user data).
      devLog("[coach-chat] raw response:", rawText);

      if (!res.ok) {
        throw new Error(`coach-chat failed (${res.status}): ${rawText.slice(0, 200)}`);
      }

      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server did not return valid JSON.");
      }

      const replyText =
        data.reply ||
        data.message ||
        data.answer ||
        data.text ||
        data.content ||
        data.output ||
        data.response ||
        data.result ||
        "Got it — let’s keep going.";

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const parts = splitReplyForTypewriter(replyText);
      let visibleReply = "";
      for (const part of parts) {
        visibleReply = visibleReply ? `${visibleReply} ${part}` : part;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessage.id
              ? { ...msg, content: visibleReply }
              : msg
          )
        );
        await wait(55);
      }

      const completedAssistantMessage = {
        ...assistantMessage,
        content: replyText,
      };

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id ? completedAssistantMessage : msg
        )
      );
      setMemoryMessages((prev) => [...prev, completedAssistantMessage]);

      // plan update
      if (data.updatedPlan && planDocId && user) {
        try {
          const planCollection =
            String(plan?.sourceCollection || "").trim() || "plans";
          const planRef = doc(db, "users", user.uid, planCollection, planDocId);
          const cleanedUpdates = removeUndefinedDeep({
            ...data.updatedPlan,
            updatedAt: serverTimestamp(),
          });
          await updateDoc(planRef, cleanedUpdates);
          setAllPlans((prev) =>
            prev.map((item) => {
              if (item?.id !== planDocId) return item;
              return normalisePlanDocShape(
                {
                  ...(item?.rawDoc || item || {}),
                  ...data.updatedPlan,
                },
                item.id
              );
            })
          );
        } catch (err) {
          devLog("[coach-chat] Failed to update plan:", err);
        }
      }
    } catch (err) {
      devLog("[coach-chat] error:", err);

      const errorMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: err?.message || "I couldn't reach the server. Try again in a moment.",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, errorMessage]);
      setMemoryMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [
    chatContext,
    isSending,
    nutritionSummary,
    activePlans.length,
    exactSchedule.length,
    plan,
    planDocId,
    user,
    devLog,
  ]);

  const handleSend = useCallback(() => {
    submitMessage(input);
  }, [input, submitMessage]);

  const renderBubble = (msg) => {
    const isUserBubble = msg.role === "user";
    const messageTime = formatMessageTime(msg);

    return (
      <View
        key={msg.id}
        style={[
          s.messageRow,
          { justifyContent: isUserBubble ? "flex-end" : "flex-start" },
        ]}
      >
        {!isUserBubble ? (
          <View style={s.coachAvatar}>
            <Feather name="message-circle" size={13} color="#111111" />
          </View>
        ) : null}

        <View style={[s.bubble, isUserBubble ? s.bubbleUser : s.bubbleCoach]}>
          <Text style={[s.bubbleText, isUserBubble && s.bubbleTextUser]}>{msg.content}</Text>
          {!!messageTime && (
            <View style={s.bubbleMetaRow}>
              <Text style={[s.bubbleTime, isUserBubble && s.bubbleTimeUser]}>{messageTime}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const showQuickPrompts = messages.length <= 1;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <LinearGradient
        colors={[
          "rgba(230,255,59,0.18)",
          "rgba(230,255,59,0.10)",
          "rgba(230,255,59,0.05)",
          "rgba(0,0,0,1)",
        ]}
        style={s.fullBackground}
      />
      <View style={s.fullOverlay} />

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={s.page}>
          <View style={s.header}>
            <View style={s.headerMainRow}>
              <View style={s.headerIdentity}>
                <View style={s.headerAvatar}>
                  <Feather name="message-circle" size={16} color="#111111" />
                </View>
                <View style={s.headerTextBlock}>
                  <Text style={s.headerTitle}>Coach</Text>
                  <Text style={s.headerSubtitle}>
                    Knows your training, nutrition and current plan
                  </Text>
                </View>
              </View>

              <View style={s.headerActions}>
                <TouchableOpacity
                  onPress={handleClearChat}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={s.clearBtn}
                >
                  <Feather name="trash-2" size={16} color={SUBTEXT} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.contextBadgeRow}>
              {contextHighlights.map((item) => (
                <View key={item.label} style={s.contextBadge}>
                  <Feather name={item.icon} size={12} color="#CFCFD4" />
                  <Text style={s.contextBadgeText}>{item.label}</Text>
                </View>
              ))}
              {!contextHighlights.length ? (
                <View style={s.contextBadge}>
                  <Feather name="loader" size={12} color="#CFCFD4" />
                  <Text style={s.contextBadgeText}>Loading context</Text>
                </View>
              ) : null}
            </View>
            {!!contextBadges.length ? (
              <Text style={s.contextSubline}>
                {contextBadges.slice(0, 2).join(" • ")}
              </Text>
            ) : null}
          </View>

          <View style={s.chatDayRow}>
            <View style={s.chatDayPill}>
              <Text style={s.chatDayText}>Today</Text>
            </View>
          </View>

          <ScrollView
            ref={scrollViewRef}
            style={s.messagesScroll}
            contentContainerStyle={[
              s.messagesContent,
              keyboardVisible && { paddingBottom: 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            onContentSizeChange={scrollToEnd}
          >
            {showQuickPrompts ? (
              <View style={s.quickPromptWrap}>
                <Text style={s.quickPromptLabel}>Suggested questions</Text>
                <View style={s.quickPromptRow}>
                  {QUICK_PROMPTS.map((prompt) => (
                    <TouchableOpacity
                      key={prompt}
                      onPress={() => submitMessage(prompt)}
                      style={s.quickPromptChip}
                      activeOpacity={0.85}
                    >
                      <Text style={s.quickPromptText}>{prompt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {messages.map(renderBubble)}

            {isSending && (
              <View style={s.messageRow}>
                <View style={s.coachAvatar}>
                  <Feather name="message-circle" size={13} color="#111111" />
                </View>
                <View style={[s.bubble, s.bubbleCoach, s.typingBubble]}>
                  <View style={s.typingRow}>
                    <ActivityIndicator size="small" color={PRIMARY} />
                    <Text style={s.typingText}>Thinking…</Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          <View style={[s.inputWrapper, keyboardVisible && { bottom: 8 }]}>
            <View style={s.inputShell}>
              <View style={s.inputContainer}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Message Coach"
                  placeholderTextColor={SUBTEXT}
                  multiline
                  style={s.input}
                  keyboardAppearance={isDark ? "dark" : "light"}
                />

                <TouchableOpacity
                  disabled={!input.trim() || isSending}
                  onPress={handleSend}
                  style={[
                    s.sendButton,
                    (!input.trim() || isSending) && s.sendDisabled,
                  ]}
                  activeOpacity={0.85}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color="#111" />
                  ) : (
                    <Feather name="arrow-up" size={17} color="#111" />
                  )}
                </TouchableOpacity>
              </View>
              <Text style={s.inputHint}>Uses your live plan and nutrition context</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
function makeStyles() {
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: BG },

    fullBackground: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 0,
    },
    fullOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.62)",
      zIndex: 0,
    },

    page: {
      flex: 1,
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: FOOTER_OFFSET + 18,
      zIndex: 1,
      backgroundColor: "transparent",
    },

    header: {
      paddingTop: 4,
      paddingBottom: 6,
      gap: 8,
    },
    headerMainRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    headerIdentity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flex: 1,
      minWidth: 0,
    },
    headerAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PRIMARY,
    },
    headerTextBlock: { flex: 1, minWidth: 0 },
    headerTitle: {
      fontSize: 22,
      fontWeight: "800",
      color: TEXT,
      marginBottom: 1,
    },
    headerSubtitle: { color: SUBTEXT, fontSize: 12, lineHeight: 16 },
    contextBadgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    contextBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.05)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#232327",
    },
    contextBadgeText: {
      color: "#C7C7CC",
      fontSize: 11,
      fontWeight: "600",
    },
    contextSubline: {
      color: "#838389",
      fontSize: 11,
      lineHeight: 15,
    },

    headerActions: { flexDirection: "row", alignItems: "center" },
    clearBtn: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#29292D",
      backgroundColor: "#0F1012",
    },

    chatDayRow: {
      alignItems: "center",
      marginTop: 4,
      marginBottom: 6,
    },
    chatDayPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.06)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#25252A",
    },
    chatDayText: {
      color: "#B1B1B7",
      fontSize: 11,
      fontWeight: "700",
    },

    messagesScroll: { flex: 1, zIndex: 1, backgroundColor: "transparent" },
    messagesContent: { paddingBottom: FOOTER_OFFSET + 62, paddingTop: 2 },

    messageRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      marginVertical: 4,
      gap: 8,
    },
    coachAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PRIMARY,
      marginBottom: 2,
    },

    bubble: {
      maxWidth: "82%",
      borderRadius: 18,
      paddingHorizontal: 13,
      paddingVertical: 10,
    },
    bubbleCoach: {
      backgroundColor: "rgba(16,17,20,0.96)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#26272D",
      borderBottomLeftRadius: 6,
    },
    bubbleUser: {
      backgroundColor: "#1A210F",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(230,255,59,0.20)",
      borderBottomRightRadius: 6,
    },

    bubbleText: { color: TEXT, fontSize: 15, lineHeight: 21 },
    bubbleTextUser: { color: "#F5F7EA" },
    bubbleMetaRow: {
      marginTop: 6,
      alignItems: "flex-end",
    },
    bubbleTime: {
      fontSize: 10,
      color: "#76767D",
      fontWeight: "600",
    },
    bubbleTimeUser: {
      color: "#A7B08A",
    },

    typingBubble: {
      minWidth: 112,
    },
    typingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    typingText: { fontSize: 13, color: SUBTEXT },

    quickPromptWrap: {
      marginBottom: 10,
      paddingTop: 2,
    },
    quickPromptLabel: {
      fontSize: 11,
      color: SUBTEXT,
      fontWeight: "700",
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    quickPromptRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    quickPromptChip: {
      maxWidth: "100%",
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 16,
      backgroundColor: "rgba(255,255,255,0.04)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#23242A",
    },
    quickPromptText: {
      color: TEXT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },

    inputWrapper: {
      position: "absolute",
      left: 14,
      right: 14,
      bottom: FOOTER_OFFSET - 12,
      zIndex: 2,
    },
    inputShell: {
      gap: 6,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "flex-end",
      backgroundColor: "#101114",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#28292E",
      paddingLeft: 14,
      paddingRight: 8,
      paddingTop: 10,
      paddingBottom: 9,
      borderRadius: 24,
    },
    input: {
      flex: 1,
      color: TEXT,
      fontSize: 15,
      lineHeight: 20,
      padding: 0,
      minHeight: 26,
      maxHeight: 120,
    },
    inputHint: {
      fontSize: 11,
      color: "#7D7E84",
      textAlign: "center",
    },
    sendButton: {
      width: 38,
      height: 38,
      backgroundColor: PRIMARY,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 8,
      marginBottom: 1,
    },
    sendDisabled: { backgroundColor: "#5E624C" },
  });
}
