// app/(protected)/train/view-plan.jsx

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ------------------------------------------------------------
   Constants
------------------------------------------------------------ */

const PRIMARY = "#E6FF3B";
const SILVER_LIGHT = "#F3F4F6";
const SILVER_MEDIUM = "#E1E3E8";
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ------------------------------------------------------------
   Generic helpers
------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, "0");

function secToMinSec(sec) {
  if (sec == null || Number.isNaN(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${pad2(s)}`;
}

function secondsToHMM(sec) {
  if (sec == null || Number.isNaN(sec)) return "";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function metresToKm(m) {
  if (m == null || Number.isNaN(m)) return "";
  return (m / 1000).toFixed(1).replace(/\.0$/, "") + " km";
}

function titleCaseWords(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(list) ? list : []) {
    const s = String(value || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function normaliseDayLabel(day, fallback = null) {
  const v = String(day || "").trim();
  if (!v) return fallback && DAY_ORDER.includes(fallback) ? fallback : null;
  if (DAY_ORDER.includes(v)) return v;

  const map = {
    monday: "Mon",
    mon: "Mon",
    tuesday: "Tue",
    tue: "Tue",
    tues: "Tue",
    wednesday: "Wed",
    wed: "Wed",
    thursday: "Thu",
    thu: "Thu",
    thur: "Thu",
    thurs: "Thu",
    friday: "Fri",
    fri: "Fri",
    saturday: "Sat",
    sat: "Sat",
    sunday: "Sun",
    sun: "Sun",
  };

  const key = v.toLowerCase();
  if (map[key]) return map[key];
  return fallback && DAY_ORDER.includes(fallback) ? fallback : null;
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getDocSortMs(docData) {
  return Math.max(
    getTimestampMs(docData?.updatedAt),
    getTimestampMs(docData?.createdAt)
  );
}

function makeDocKey(docData) {
  if (Array.isArray(docData?.__path) && docData.__path.length) {
    return docData.__path.join("/");
  }
  return String(docData?.id || Math.random());
}

/* ------------------------------------------------------------
   Plan type detection
------------------------------------------------------------ */

function isStrengthPlanDoc(data) {
  const kind = String(data?.kind || data?.plan?.kind || "").toLowerCase();
  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  const primaryActivity = String(
    data?.meta?.primaryActivity ||
      data?.primaryActivity ||
      data?.plan?.primaryActivity ||
      ""
  ).toLowerCase();
  const goalType = String(data?.goalType || data?.plan?.goalType || "").toLowerCase();

  if (kind === "strength") return true;
  if (source.includes("strength")) return true;
  if (primaryActivity.includes("strength") || primaryActivity.includes("gym")) return true;
  if (goalType.includes("strength")) return true;

  const weeks = Array.isArray(data?.weeks)
    ? data.weeks
    : Array.isArray(data?.plan?.weeks)
    ? data.plan.weeks
    : [];

  return weeks.some((w) =>
    Array.isArray(w?.days) &&
    w.days.some((d) =>
      Array.isArray(d?.sessions) &&
      d.sessions.some((s) =>
        String(s?.type || s?.sessionType || "")
          .toLowerCase()
          .includes("strength")
      )
    )
  );
}

function isRunPlanDoc(data) {
  const kind = String(data?.kind || data?.plan?.kind || "").toLowerCase();
  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  const primaryActivity = String(
    data?.meta?.primaryActivity ||
      data?.primaryActivity ||
      data?.plan?.primaryActivity ||
      ""
  ).toLowerCase();

  if (kind === "run") return true;
  if (source.includes("run")) return true;
  if (primaryActivity.includes("run")) return true;

  const athleteProfile = data?.athleteProfile || data?.plan?.athleteProfile || {};
  if (athleteProfile?.goal?.distance) return true;
  if (athleteProfile?.availability?.runDays?.length) return true;

  const weeks = Array.isArray(data?.weeks)
    ? data.weeks
    : Array.isArray(data?.plan?.weeks)
    ? data.plan.weeks
    : [];

  return weeks.some((w) => {
    const sessions = Array.isArray(w?.sessions)
      ? w.sessions
      : Array.isArray(w?.days)
      ? w.days.flatMap((d) => (Array.isArray(d?.sessions) ? d.sessions : []))
      : [];

    return sessions.some((s) => {
      const hasDistance =
        typeof s?.distanceKm === "number" ||
        typeof s?.distance === "number" ||
        typeof s?.plannedDistanceKm === "number" ||
        typeof s?.distanceMeters === "number";

      const hasRunStepTarget =
        Array.isArray(s?.steps) &&
        s.steps.some((st) => st?.targetType || st?.durationType);

      return hasDistance || hasRunStepTarget;
    });
  });
}

function classifyPlanType(data) {
  if (isStrengthPlanDoc(data)) return "strength";
  if (isRunPlanDoc(data)) return "run";
  return null;
}

/* ------------------------------------------------------------
   Run helpers
------------------------------------------------------------ */

function formatRunStep(step) {
  if (!step) return "";

  const durationValue = Number(step.durationValue || 0);
  const timeUnit = String(step?._durationUnit || "").toLowerCase();
  const distanceUnit = String(step?._distanceUnit || "").toLowerCase();

  let dur = "";
  if (step.durationType === "time" && Number.isFinite(durationValue) && durationValue > 0) {
    if (timeUnit === "seconds") dur = durationValue < 180 ? `${Math.round(durationValue)} sec` : `${Math.round(durationValue / 60)} min`;
    else if (timeUnit === "minutes") dur = `${Math.round(durationValue)} min`;
    else dur = durationValue > 180 ? secondsToHMM(durationValue) : `${Math.round(durationValue)} min`;
  }
  if (step.durationType === "distance" && Number.isFinite(durationValue) && durationValue > 0) {
    if (distanceUnit === "meters") dur = metresToKm(durationValue);
    else if (distanceUnit === "km") dur = `${Number(durationValue).toFixed(1).replace(/\.0$/, "")} km`;
    else dur = durationValue > 50 ? metresToKm(durationValue) : `${Number(durationValue).toFixed(1).replace(/\.0$/, "")} km`;
  }

  let target = "";
  if (step.targetType === "pace_range" && step.targetValue) {
    const { minSecPerKm, maxSecPerKm } = step.targetValue;
    const fast = secToMinSec(minSecPerKm);
    const slow = secToMinSec(maxSecPerKm);
    if (fast && slow) {
      target = fast === slow ? ` @ ${fast}/km` : ` @ ${fast}–${slow}/km`;
    }
  }
  if (step.targetType === "hr_range" && step.targetValue) {
    const minBpm = Number(step?.targetValue?.minBpm);
    const maxBpm = Number(step?.targetValue?.maxBpm);
    if (Number.isFinite(minBpm) && Number.isFinite(maxBpm)) {
      target = ` @ ${Math.round(minBpm)}-${Math.round(maxBpm)} bpm`;
    }
  }
  if (!target && step?.target?.paceKey) {
    target = ` @ ${String(step.target.paceKey).toUpperCase()}`;
  }

  const labelRaw =
    step?.name ||
    step?.title ||
    step?.label ||
    step?.stepType ||
    step?.type ||
    "step";
  const label = String(labelRaw).replace(/_/g, " ");
  return `${label}${dur ? ` • ${dur}` : ""}${target}`;
}

function normaliseRunStepForView(rawStep) {
  if (!rawStep || typeof rawStep !== "object") return rawStep;

  const out = { ...rawStep };
  if (!out.title && out.name) out.title = out.name;

  const typeRaw = String(out.type || out.stepType || "").toUpperCase();
  if (typeRaw === "REPEAT") {
    out.stepType = "repeat";
    const repeatCount = Number(out.repeatCount ?? out.repeat ?? out.reps);
    if (Number.isFinite(repeatCount) && repeatCount > 0) out.repeatCount = Math.round(repeatCount);
    out.steps = Array.isArray(out.steps) ? out.steps.map((s) => normaliseRunStepForView(s)) : [];
    return out;
  }

  const durationObj = out.duration && typeof out.duration === "object" ? out.duration : null;
  if (durationObj) {
    const durationTypeRaw = String(durationObj.type || "").toUpperCase();
    if (durationTypeRaw === "TIME" && Number.isFinite(Number(durationObj.seconds))) {
      out.durationType = "time";
      out.durationValue = Number(durationObj.seconds);
      out._durationUnit = "seconds";
    } else if (durationTypeRaw === "DISTANCE" && Number.isFinite(Number(durationObj.meters))) {
      out.durationType = "distance";
      out.durationValue = Number(durationObj.meters);
      out._distanceUnit = "meters";
    }
  } else {
    const dt = String(out.durationType || "").toLowerCase();
    const dv = Number(out.durationValue);
    if (dt === "time" && Number.isFinite(dv) && dv > 0) {
      out._durationUnit = dv > 180 ? "seconds" : "minutes";
    } else if (dt === "distance" && Number.isFinite(dv) && dv > 0) {
      out._distanceUnit = dv > 50 ? "meters" : "km";
    } else if (String(out.durationType || "").toLowerCase() === "time (min)" && Number.isFinite(dv)) {
      out.durationType = "time";
      out.durationValue = dv;
      out._durationUnit = "minutes";
    } else if (String(out.durationType || "").toLowerCase() === "distance (km)" && Number.isFinite(dv)) {
      out.durationType = "distance";
      out.durationValue = dv;
      out._distanceUnit = "km";
    }
  }

  const targetObj = out.target && typeof out.target === "object" ? out.target : null;
  if (!out.targetType && targetObj) {
    const paceSec = Number(targetObj.paceSecPerKm);
    if (Number.isFinite(paceSec) && paceSec > 0) {
      out.targetType = "pace_range";
      out.targetValue = {
        minSecPerKm: Math.round(paceSec),
        maxSecPerKm: Math.round(paceSec),
      };
    }
  }

  return out;
}

function normaliseRunStepsForView(steps) {
  return (Array.isArray(steps) ? steps : []).map((s) => normaliseRunStepForView(s));
}

function stepDistanceKm(step) {
  if (!step || typeof step !== "object") return 0;

  const typeRaw = String(step.type || step.stepType || "").toUpperCase();
  if (typeRaw === "REPEAT" || step?.stepType === "repeat") {
    const reps = Number(step.repeatCount ?? step.repeat ?? step.reps ?? 1);
    const mult = Number.isFinite(reps) && reps > 0 ? reps : 1;
    const inner = Array.isArray(step.steps) ? step.steps : [];
    const innerKm = inner.reduce((sum, st) => sum + stepDistanceKm(st), 0);
    return innerKm * mult;
  }

  const distanceKmDirect = Number(
    step.distanceKm ?? step.distance ?? step.plannedDistanceKm ?? step.targetDistanceKm
  );
  if (Number.isFinite(distanceKmDirect) && distanceKmDirect > 0) return distanceKmDirect;

  const metersDirect = Number(step.distanceMeters);
  if (Number.isFinite(metersDirect) && metersDirect > 0) return metersDirect / 1000;

  const durationObj = step.duration && typeof step.duration === "object" ? step.duration : null;
  if (durationObj && String(durationObj.type || "").toUpperCase() === "DISTANCE") {
    const meters = Number(durationObj.meters);
    if (Number.isFinite(meters) && meters > 0) return meters / 1000;
  }

  if (String(step.durationType || "").toLowerCase() === "distance") {
    const v = Number(step.durationValue);
    if (Number.isFinite(v) && v > 0) {
      const unit = String(step._distanceUnit || "").toLowerCase();
      if (unit === "meters") return v / 1000;
      if (unit === "km") return v;
      return v > 50 ? v / 1000 : v;
    }
  }

  return 0;
}

function estimateDistanceKmFromSessionSteps(session) {
  const steps = Array.isArray(session?.steps)
    ? session.steps
    : Array.isArray(session?.workout?.steps)
    ? session.workout.steps
    : [];

  const total = steps.reduce((sum, st) => sum + stepDistanceKm(st), 0);
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

function isWarmCooldownRunStep(step) {
  const text = String(
    step?.name || step?.title || step?.label || step?.stepType || step?.type || ""
  ).toLowerCase();

  return (
    text.includes("warm up") ||
    text.includes("warmup") ||
    text.includes("cool down") ||
    text.includes("cooldown")
  );
}

function safeKm(session) {
  const km =
    typeof session?.distanceKm === "number"
      ? session.distanceKm
      : typeof session?.distance === "number"
      ? session.distance
      : typeof session?.plannedDistanceKm === "number"
      ? session.plannedDistanceKm
      : typeof session?.targetDistanceKm === "number"
      ? session.targetDistanceKm
      : typeof session?.totalDistanceKm === "number"
      ? session.totalDistanceKm
      : typeof session?.workout?.totalDistanceKm === "number"
      ? session.workout.totalDistanceKm
      : typeof session?.distanceMeters === "number"
      ? session.distanceMeters / 1000
      : null;

  if (typeof km === "number" && Number.isFinite(km) && km > 0) return km;
  return estimateDistanceKmFromSessionSteps(session);
}

function normaliseRunSessionForView(raw, dayFallback) {
  const km = safeKm(raw);
  const distanceKm =
    typeof km === "number" ? Math.round(km * 10) / 10 : undefined;

  const day =
    normaliseDayLabel(raw?.day, null) ||
    normaliseDayLabel(raw?.dow, null) ||
    normaliseDayLabel(dayFallback, "Mon");

  const name =
    raw?.name ||
    raw?.title ||
    raw?.workoutName ||
    raw?.sessionName ||
    raw?.sessionType ||
    raw?.type ||
    "Run";

  const type = raw?.type || raw?.sessionType || "EASY";

  const steps = Array.isArray(raw?.steps)
    ? raw.steps
    : Array.isArray(raw?.workout?.steps)
    ? raw.workout.steps
    : [];

  return {
    ...raw,
    day,
    name,
    type,
    sessionType: raw?.sessionType || type,
    notes: typeof raw?.notes === "string" ? raw.notes : raw?.description || "",
    warmupMin:
      Number.isFinite(Number(raw?.warmupMin)) ? Number(raw.warmupMin) : null,
    cooldownMin:
      Number.isFinite(Number(raw?.cooldownMin)) ? Number(raw.cooldownMin) : null,
    targetHr: raw?.targetHr || raw?.workout?.hrTarget || null,
    targetPace: raw?.targetPace || raw?.workout?.paceTarget || null,
    ...(distanceKm != null
      ? {
          distanceKm,
          distance: distanceKm,
          plannedDistanceKm: distanceKm,
          distanceMeters: Math.round(distanceKm * 1000),
        }
      : {}),
    steps: normaliseRunStepsForView(steps),
  };
}

function mapStockSessionsToDays(stockSessions, runDays, longRunDay) {
  const days = DAY_ORDER.map((d) => ({ day: d, sessions: [] }));
  const bySlot = new Map();
  for (const s of Array.isArray(stockSessions) ? stockSessions : []) {
    bySlot.set(String(s?.slot || ""), s);
  }

  const configuredRunDays =
    Array.isArray(runDays) && runDays.length
      ? runDays.map((d) => normaliseDayLabel(d)).filter((d) => DAY_ORDER.includes(d))
      : ["Mon", "Tue", "Thu", "Sun"];
  const longDay = normaliseDayLabel(
    longRunDay,
    configuredRunDays[configuredRunDays.length - 1] || "Sun"
  );

  const pickDay = (d) => days.find((x) => x.day === d);
  const q1 = bySlot.get("QUALITY_1");
  const q2 = bySlot.get("QUALITY_2");
  const easy = bySlot.get("EASY");
  const long = bySlot.get("LONG");

  if (long) pickDay(longDay)?.sessions.push(normaliseRunSessionForView(long, longDay));

  const remaining = configuredRunDays.filter((d) => d !== longDay);
  if (q1) pickDay(remaining[0] || configuredRunDays[0])?.sessions.push(normaliseRunSessionForView(q1, remaining[0] || configuredRunDays[0]));
  if (q2) pickDay(remaining[1] || configuredRunDays[1] || configuredRunDays[0])?.sessions.push(normaliseRunSessionForView(q2, remaining[1] || configuredRunDays[1] || configuredRunDays[0]));
  if (easy) pickDay(remaining[2] || configuredRunDays[2] || configuredRunDays[0])?.sessions.push(normaliseRunSessionForView(easy, remaining[2] || configuredRunDays[2] || configuredRunDays[0]));

  return days;
}

function deriveRunDaysFromSessions(sessions) {
  const byDay = new Map();

  for (const sRaw of sessions) {
    const s = normaliseRunSessionForView(sRaw, sRaw?.day);
    const d = s?.day;
    if (!d || !DAY_ORDER.includes(d)) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  return DAY_ORDER.map((day) => ({
    day,
    sessions: byDay.get(day) || [],
  }));
}

function normaliseRunWeek(week, fallbackWeekNumber, runDays, longRunDay) {
  const weekNumber =
    typeof week?.weekNumber === "number"
      ? week.weekNumber
      : typeof week?.weekIndex === "number"
      ? week.weekIndex + 1
      : fallbackWeekNumber;

  const sessionsRaw = Array.isArray(week?.sessions) ? week.sessions : [];
  const daysRaw = Array.isArray(week?.days) ? week.days : [];

  const hasMeaningfulDays =
    daysRaw.length > 0 &&
    daysRaw.some((d) => Array.isArray(d?.sessions) && d.sessions.length);

  const hasSlotsWithoutDay =
    sessionsRaw.length > 0 &&
    sessionsRaw.every((s) => !normaliseDayLabel(s?.day, null)) &&
    sessionsRaw.some((s) => String(s?.slot || "").length > 0);

  const daysBase = hasMeaningfulDays
    ? daysRaw.map((d) => ({
        ...d,
        day: normaliseDayLabel(d?.day, "Mon"),
        sessions: Array.isArray(d?.sessions)
          ? d.sessions.map((s) => normaliseRunSessionForView(s, d?.day))
          : [],
      }))
    : hasSlotsWithoutDay
    ? mapStockSessionsToDays(sessionsRaw, runDays, longRunDay)
    : deriveRunDaysFromSessions(sessionsRaw);

  const byDay = new Map();
  for (const d of daysBase) {
    const key = d?.day;
    if (!key || !DAY_ORDER.includes(key)) continue;
    const existing = byDay.get(key) || { day: key, sessions: [] };
    const incoming = Array.isArray(d?.sessions) ? d.sessions : [];
    byDay.set(key, {
      ...existing,
      ...d,
      day: key,
      sessions: [...existing.sessions, ...incoming],
    });
  }

  const days = DAY_ORDER.map((day) => byDay.get(day) || { day, sessions: [] });
  const sessions =
    sessionsRaw.length
      ? sessionsRaw.map((s) => normaliseRunSessionForView(s, s?.day))
      : days.flatMap((d) => d.sessions);

  return {
    ...week,
    weekNumber,
    sessions,
    days,
  };
}

function sumRunWeekKm(week) {
  const days = Array.isArray(week?.days) ? week.days : [];
  let total = 0;
  for (const d of days) {
    const sessions = Array.isArray(d?.sessions) ? d.sessions : [];
    for (const s of sessions) {
      const km = safeKm(s);
      if (typeof km === "number") total += km;
    }
  }
  return Math.round(total * 10) / 10;
}

function sumRunDayKm(dayObj) {
  const sessions = Array.isArray(dayObj?.sessions) ? dayObj.sessions : [];
  let total = 0;
  for (const s of sessions) {
    const km = safeKm(s);
    if (typeof km === "number") total += km;
  }
  return Math.round(total * 10) / 10;
}

/* ------------------------------------------------------------
   Strength helpers
------------------------------------------------------------ */

function formatStrengthItem(item) {
  if (!item) return "";

  const title = String(item?.title || item?.name || "Exercise").trim();

  if (Number(item?.timeSec) > 0) {
    return `${title} • ${secondsToHMM(Number(item.timeSec))}`;
  }

  const parts = [title];

  if (Number(item?.sets) > 0 && Number(item?.reps) > 0) {
    parts.push(`${Math.round(Number(item.sets))}x${Math.round(Number(item.reps))}`);
  }

  if (Number(item?.rpe) > 0) {
    parts.push(`RPE ${Math.round(Number(item.rpe) * 10) / 10}`);
  }

  if (Number(item?.restSec) > 0) {
    parts.push(`${Math.round(Number(item.restSec))}s rest`);
  }

  if (item?.load) {
    parts.push(String(item.load));
  }

  return parts.join(" • ");
}

function normaliseStrengthSession(raw, dayFallback) {
  const day =
    normaliseDayLabel(raw?.day, null) ||
    normaliseDayLabel(dayFallback, "Mon");

  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : [];
  const steps = Array.isArray(raw?.steps)
    ? raw.steps
    : Array.isArray(raw?.workout?.steps)
    ? raw.workout.steps
    : [];

  return {
    ...raw,
    day,
    type: raw?.type || "Strength",
    sessionType: raw?.sessionType || "gym",
    title: raw?.title || raw?.name || "Strength session",
    emphasis: raw?.emphasis || "",
    focus: raw?.focus || "",
    notes: typeof raw?.notes === "string" ? raw.notes : "",
    durationMin:
      Number.isFinite(Number(raw?.durationMin)) ? Number(raw.durationMin) : null,
    targetDurationMin:
      Number.isFinite(Number(raw?.targetDurationMin))
        ? Number(raw.targetDurationMin)
        : null,
    coaching: raw?.coaching || {},
    blocks,
    steps,
  };
}

function deriveStrengthDaysFromSessions(sessions) {
  const byDay = new Map();

  for (const sRaw of sessions) {
    const s = normaliseStrengthSession(sRaw, sRaw?.day);
    const d = s?.day;
    if (!d || !DAY_ORDER.includes(d)) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  return DAY_ORDER.map((day) => ({
    day,
    sessions: byDay.get(day) || [],
  }));
}

function normaliseStrengthWeek(week, fallbackWeekNumber) {
  const weekNumber =
    typeof week?.weekNumber === "number"
      ? week.weekNumber
      : typeof week?.weekIndex === "number"
      ? week.weekIndex + 1
      : fallbackWeekNumber;

  const sessionsRaw = Array.isArray(week?.sessions) ? week.sessions : [];
  const daysRaw = Array.isArray(week?.days) ? week.days : [];

  const daysBase =
    daysRaw.length > 0
      ? daysRaw.map((d) => ({
          ...d,
          day: normaliseDayLabel(d?.day, "Mon"),
          recoveryGuidance: d?.recoveryGuidance || "",
          sessions: Array.isArray(d?.sessions)
            ? d.sessions.map((s) => normaliseStrengthSession(s, d?.day))
            : [],
        }))
      : deriveStrengthDaysFromSessions(sessionsRaw);

  const byDay = new Map();
  for (const d of daysBase) {
    const key = d?.day;
    if (!key || !DAY_ORDER.includes(key)) continue;
    const existing = byDay.get(key) || { day: key, sessions: [], recoveryGuidance: "" };
    const incoming = Array.isArray(d?.sessions) ? d.sessions : [];
    byDay.set(key, {
      ...existing,
      ...d,
      day: key,
      sessions: [...existing.sessions, ...incoming],
    });
  }

  const days = DAY_ORDER.map(
    (day) => byDay.get(day) || { day, sessions: [], recoveryGuidance: "" }
  );

  return {
    ...week,
    weekNumber,
    phase: week?.phase || {},
    days,
  };
}

function countStrengthWeekSessions(week) {
  return (Array.isArray(week?.days) ? week.days : []).reduce(
    (sum, d) => sum + (Array.isArray(d?.sessions) ? d.sessions.length : 0),
    0
  );
}

function countStrengthDaySessions(dayObj) {
  return Array.isArray(dayObj?.sessions) ? dayObj.sessions.length : 0;
}

/* ------------------------------------------------------------
   Compatibility layer
------------------------------------------------------------ */

function normalisePlanDoc(planDoc) {
  if (!planDoc) return { plan: null, athleteProfile: null, metaName: "" };

  const plan = planDoc?.plan
    ? planDoc.plan
    : planDoc?.weeks
    ? { ...planDoc, weeks: planDoc.weeks }
    : planDoc;

  const athleteProfile = planDoc?.athleteProfile || plan?.athleteProfile || null;

  const metaName =
    planDoc?.meta?.name ||
    plan?.meta?.name ||
    plan?.name ||
    planDoc?.name ||
    "Plan";

  return { plan, athleteProfile, metaName };
}

/* ------------------------------------------------------------
   Firestore fetch
------------------------------------------------------------ */

async function tryGetDoc(pathSegments) {
  const ref = doc(db, ...pathSegments);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, __path: pathSegments, ...snap.data() };
}

async function fetchPlanById(uid, planId) {
  if (!planId) return null;

  const candidates = [
    ["users", uid, "plans", planId],
    ["users", uid, "runPlans", planId],
    ["plans", planId],
    ["runPlans", planId],
  ];

  for (const segs of candidates) {
    try {
      const found = await tryGetDoc(segs);
      if (found) return found;
    } catch {}
  }

  return null;
}

async function fetchRecentFromSubcollection(uid, sub, maxResults = 25) {
  const col = collection(db, "users", uid, sub);

  try {
    const q1 = query(col, orderBy("updatedAt", "desc"), limit(maxResults));
    const s1 = await getDocs(q1);
    if (!s1.empty) {
      return s1.docs.map((d) => ({
        id: d.id,
        __path: ["users", uid, sub, d.id],
        ...d.data(),
      }));
    }
  } catch {}

  try {
    const q2 = query(col, orderBy("createdAt", "desc"), limit(maxResults));
    const s2 = await getDocs(q2);
    if (!s2.empty) {
      return s2.docs.map((d) => ({
        id: d.id,
        __path: ["users", uid, sub, d.id],
        ...d.data(),
      }));
    }
  } catch {}

  try {
    const q3 = query(col, limit(maxResults));
    const s3 = await getDocs(q3);
    if (!s3.empty) {
      return s3.docs.map((d) => ({
        id: d.id,
        __path: ["users", uid, sub, d.id],
        ...d.data(),
      }));
    }
  } catch {}

  return [];
}

async function fetchRecentTopLevel(colName, uidField, uid, maxResults = 25) {
  try {
    const q1 = query(
      collection(db, colName),
      where(uidField, "==", uid),
      orderBy("updatedAt", "desc"),
      limit(maxResults)
    );
    const s1 = await getDocs(q1);
    if (!s1.empty) {
      return s1.docs.map((d) => ({
        id: d.id,
        __path: [colName, d.id],
        ...d.data(),
      }));
    }
  } catch {}

  try {
    const q2 = query(
      collection(db, colName),
      where(uidField, "==", uid),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );
    const s2 = await getDocs(q2);
    if (!s2.empty) {
      return s2.docs.map((d) => ({
        id: d.id,
        __path: [colName, d.id],
        ...d.data(),
      }));
    }
  } catch {}

  return [];
}

async function fetchAllPlanCandidates(uid) {
  const lists = await Promise.all([
    fetchRecentFromSubcollection(uid, "plans", 25),
    fetchRecentFromSubcollection(uid, "runPlans", 25),
    fetchRecentTopLevel("plans", "uid", uid, 25),
    fetchRecentTopLevel("plans", "userId", uid, 25),
    fetchRecentTopLevel("runPlans", "uid", uid, 25),
    fetchRecentTopLevel("runPlans", "userId", uid, 25),
  ]);

  const merged = lists.flat();
  const deduped = [];
  const seen = new Set();

  for (const item of merged) {
    const key = makeDocKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => getDocSortMs(b) - getDocSortMs(a));
  return deduped;
}

function pickLatestByType(docs) {
  const byType = {
    run: null,
    strength: null,
  };

  for (const docData of docs) {
    const type = classifyPlanType(docData);
    if (!type) continue;

    if (!byType[type]) {
      byType[type] = docData;
      continue;
    }

    if (getDocSortMs(docData) > getDocSortMs(byType[type])) {
      byType[type] = docData;
    }
  }

  return byType;
}

/* ------------------------------------------------------------
   Theme
------------------------------------------------------------ */

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: colors?.bg ?? (isDark ? "#050506" : "#F5F5F7"),
    card: colors?.card ?? (isDark ? "#10131A" : "#FFFFFF"),
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: isDark ? "rgba(255,255,255,0.10)" : SILVER_MEDIUM,
    muted: colors?.muted ?? (isDark ? "#141821" : "#E5E7EB"),
    pillBg: isDark ? "#151923" : SILVER_LIGHT,
    surfaceAlt: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC",
    primaryBg: PRIMARY,
    primaryText: "#111111",
    danger: "#ef4444",
    topFadeStart: isDark ? "rgba(230,255,59,0.10)" : "rgba(15,23,42,0.06)",
  };
}

/* ------------------------------------------------------------
   Screen
------------------------------------------------------------ */

export default function ViewPlanPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const theme = useScreenTheme();
  const insets = useSafeAreaInsets();

  const planId =
    typeof params?.planId === "string"
      ? params.planId
      : Array.isArray(params?.planId)
      ? params.planId[0]
      : null;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [plansByType, setPlansByType] = useState({ run: null, strength: null });
  const [selectedType, setSelectedType] = useState(null);
  const [error, setError] = useState("");
  const [expandedWeek, setExpandedWeek] = useState(0);
  const didInitialSelect = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
    });
    return () => unsub();
  }, [router]);

  const loadPlans = useCallback(async () => {
    if (!user?.uid) return;

    setError("");

    try {
      const byId = planId ? await fetchPlanById(user.uid, planId) : null;
      const candidates = await fetchAllPlanCandidates(user.uid);

      const merged = [];
      const seen = new Set();

      if (byId) {
        const key = makeDocKey(byId);
        seen.add(key);
        merged.push(byId);
      }

      for (const item of candidates) {
        const key = makeDocKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }

      const picked = pickLatestByType(merged);

      const byIdType = byId ? classifyPlanType(byId) : null;
      if (byId && byIdType) {
        picked[byIdType] = byId;
      }

      setPlansByType(picked);

      const availableTypes = ["run", "strength"].filter((t) => !!picked[t]);

      if (!availableTypes.length) {
        setSelectedType(null);
        setError("No plan found yet. Generate one first, then come back here.");
        return;
      }

      if (!didInitialSelect.current) {
        didInitialSelect.current = true;

        if (byIdType && picked[byIdType]) {
          setSelectedType(byIdType);
        } else if (picked.run && picked.strength) {
          const runMs = getDocSortMs(picked.run);
          const strengthMs = getDocSortMs(picked.strength);
          setSelectedType(runMs >= strengthMs ? "run" : "strength");
        } else {
          setSelectedType(availableTypes[0]);
        }
      } else {
        setSelectedType((prev) => {
          if (prev && picked[prev]) return prev;
          return availableTypes[0];
        });
      }

      setExpandedWeek(0);
    } catch (e) {
      setPlansByType({ run: null, strength: null });
      setSelectedType(null);
      setError(e?.message || "Failed to load plans.");
    }
  }, [user?.uid, planId]);

  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      setLoading(true);
      await loadPlans();
      setLoading(false);
    })();
  }, [user?.uid, loadPlans]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPlans();
    setRefreshing(false);
  }, [loadPlans]);

  const selectedPlanDoc = selectedType ? plansByType[selectedType] : null;
  const availableTypes = useMemo(
    () => ["run", "strength"].filter((t) => !!plansByType[t]),
    [plansByType]
  );

  const handleDeletePlan = useCallback(async () => {
    if (!user?.uid || !selectedPlanDoc?.id || !selectedType) return;

    const label = selectedType === "strength" ? "strength" : "run";

    const confirmed = await new Promise((resolve) => {
      Alert.alert(
        `Delete this ${label} plan?`,
        `This will permanently remove the current ${label} plan.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Delete", style: "destructive", onPress: () => resolve(true) },
        ]
      );
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const attempts = [];
      if (Array.isArray(selectedPlanDoc?.__path) && selectedPlanDoc.__path.length) {
        attempts.push(selectedPlanDoc.__path);
      }

      attempts.push(
        ["users", user.uid, "plans", selectedPlanDoc.id],
        ["users", user.uid, "runPlans", selectedPlanDoc.id],
        ["plans", selectedPlanDoc.id],
        ["runPlans", selectedPlanDoc.id]
      );

      const seen = new Set();
      const uniq = attempts.filter((p) => {
        const key = JSON.stringify(p);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let deleted = false;
      for (const path of uniq) {
        try {
          await deleteDoc(doc(db, ...path));
          deleted = true;
          break;
        } catch {}
      }

      if (!deleted) throw new Error("Could not delete this plan.");

      Alert.alert("Deleted", `Your ${label} plan has been removed.`);
      await loadPlans();
    } catch (e) {
      Alert.alert("Delete failed", e?.message || "Could not delete this plan.");
    } finally {
      setDeleting(false);
    }
  }, [user?.uid, selectedPlanDoc, selectedType, loadPlans]);

  const { plan, athleteProfile, metaName } = useMemo(
    () => normalisePlanDoc(selectedPlanDoc),
    [selectedPlanDoc]
  );

  const styles = useMemo(() => makeStyles(theme, insets.top), [theme, insets.top]);

  const isStrength = selectedType === "strength";
  const isRun = selectedType === "run";

  const runAvailability = athleteProfile?.availability || {};
  const runDays = Array.isArray(runAvailability?.runDays) ? runAvailability.runDays : [];
  const longRunDay = runAvailability?.longRunDay || "Sun";

  const weeks = useMemo(() => {
    const raw =
      (plan && Array.isArray(plan?.weeks) ? plan.weeks : null) ||
      (selectedPlanDoc && Array.isArray(selectedPlanDoc?.weeks) ? selectedPlanDoc.weeks : []) ||
      [];

    const arr = Array.isArray(raw) ? raw : [];

    if (isStrength) {
      return arr.map((w, idx) => normaliseStrengthWeek(w, idx + 1));
    }

    return arr.map((w, idx) => normaliseRunWeek(w, idx + 1, runDays, longRunDay));
  }, [plan, selectedPlanDoc, isStrength, runDays, longRunDay]);

  const runDerived = useMemo(() => {
    if (!isRun) return null;

    const runDaySet = new Set();
    const weekSessionCounts = [];
    const weeklyKm = [];
    let maxSingleRunKm = 0;
    let inferredLongRunDay = "";

    for (const week of Array.isArray(weeks) ? weeks : []) {
      const days = Array.isArray(week?.days) ? week.days : [];
      let weekCount = 0;
      let weekKm = 0;

      for (const dayObj of days) {
        const dayLabel = String(dayObj?.day || "");
        const sessions = Array.isArray(dayObj?.sessions) ? dayObj.sessions : [];
        if (sessions.length && dayLabel) runDaySet.add(dayLabel);
        weekCount += sessions.length;

        for (const sess of sessions) {
          const km = safeKm(sess);
          if (Number.isFinite(km) && km > 0) {
            weekKm += km;
            if (km > maxSingleRunKm) {
              maxSingleRunKm = km;
              inferredLongRunDay = dayLabel || inferredLongRunDay;
            }
          }
        }
      }

      weekSessionCounts.push(weekCount);
      weeklyKm.push(Math.round(weekKm * 10) / 10);
    }

    const sessionsPerWeek =
      weekSessionCounts.length > 0
        ? Math.round(
            weekSessionCounts.reduce((sum, n) => sum + Number(n || 0), 0) / weekSessionCounts.length
          )
        : null;

    const sortedRunDays = DAY_ORDER.filter((d) => runDaySet.has(d));
    const fallbackLongRunDay = sortedRunDays.length
      ? sortedRunDays[sortedRunDays.length - 1]
      : "";

    const weeklyKmNow = weeklyKm.length ? weeklyKm[0] : null;
    const maxWeeklyKm = weeklyKm.length ? Math.max(...weeklyKm) : null;

    return {
      runDays: sortedRunDays,
      sessionsPerWeek,
      longRunDay: inferredLongRunDay || fallbackLongRunDay,
      weeklyKmNow,
      longestRunNow: maxSingleRunKm > 0 ? Math.round(maxSingleRunKm * 10) / 10 : null,
      maxWeeklyKm: Number.isFinite(maxWeeklyKm) ? Math.round(maxWeeklyKm * 10) / 10 : null,
      maxLongKm: maxSingleRunKm > 0 ? Math.round(maxSingleRunKm * 10) / 10 : null,
    };
  }, [isRun, weeks]);

  const runSummary = useMemo(() => {
    if (!isRun) return null;

    const goal = athleteProfile?.goal || {};
    const current = athleteProfile?.current || {};
    const availability = athleteProfile?.availability || {};
    const targets = plan?.targets || selectedPlanDoc?.targets;

    const targetArr = Array.isArray(targets) ? targets : [];
    const maxWeeklyKm = targetArr.length
      ? Math.max(...targetArr.map((t) => Number(t?.weeklyKm || 0)))
      : null;

    const maxLongKm = targetArr.length
      ? Math.max(...targetArr.map((t) => Number(t?.longRunKm || 0)))
      : null;

    const runDaysArr = Array.isArray(availability?.runDays) && availability.runDays.length
      ? availability.runDays
      : runDerived?.runDays || [];

    const fallbackGoalDistance =
      selectedPlanDoc?.goalType ||
      plan?.goalType ||
      plan?.meta?.primaryFocus ||
      selectedPlanDoc?.meta?.primaryFocus ||
      "";

    const fallbackPlanLength =
      Number(plan?.planLengthWeeks || selectedPlanDoc?.planLengthWeeks) || weeks.length;

    const fallbackSessionsPerWeek =
      Number(
        availability?.sessionsPerWeek ||
          plan?.sessionsPerWeek ||
          selectedPlanDoc?.sessionsPerWeek ||
          runDerived?.sessionsPerWeek
      ) || "";

    const fallbackDifficulty =
      availability?.difficulty ||
      plan?.meta?.profile ||
      selectedPlanDoc?.meta?.profile ||
      "";

    return {
      name: metaName,
      distance: goal?.distance || fallbackGoalDistance || "",
      targetTime: goal?.targetTime || "",
      planLengthWeeks: goal?.planLengthWeeks ?? fallbackPlanLength,
      sessionsPerWeek: fallbackSessionsPerWeek,
      runDays: runDaysArr,
      longRunDay: availability?.longRunDay || runDerived?.longRunDay || "",
      difficulty: fallbackDifficulty,
      weeklyKmNow: current?.weeklyKm ?? runDerived?.weeklyKmNow ?? "",
      longestRunNow: current?.longestRunKm ?? runDerived?.longestRunNow ?? "",
      maxWeeklyKm: maxWeeklyKm || runDerived?.maxWeeklyKm,
      maxLongKm: maxLongKm || runDerived?.maxLongKm,
    };
  }, [isRun, athleteProfile, plan, selectedPlanDoc, weeks.length, metaName, runDerived]);

  const strengthSummary = useMemo(() => {
    if (!isStrength) return null;

    const profile = athleteProfile || {};
    const root = selectedPlanDoc || {};
    const planGuidelines = plan?.planGuidelines || root?.planGuidelines || {};

    return {
      name: metaName,
      goalType: profile?.goalType || root?.goalType || "Strength",
      primaryFocus: profile?.primaryFocus || root?.primaryFocus || "General strength",
      planLengthWeeks: profile?.planLengthWeeks || root?.planLengthWeeks || weeks.length,
      daysPerWeek: profile?.daysPerWeek || root?.sessionsPerWeek || "",
      preferredSplit: profile?.preferredSplit || root?.preferredSplit || "",
      sessionLength: profile?.sessionLength || root?.sessionLength || "",
      preferredDays: Array.isArray(profile?.preferredDays) ? profile.preferredDays : root?.preferredDays || [],
      progressionStyle:
        profile?.progressionStyle ||
        root?.progressionStyle ||
        plan?.meta?.progressionStyle ||
        "—",
      fixedMainLifts:
        typeof profile?.fixedMainLifts === "boolean"
          ? profile.fixedMainLifts
          : typeof root?.fixedMainLifts === "boolean"
          ? root.fixedMainLifts
          : typeof plan?.meta?.fixedMainLifts === "boolean"
          ? plan.meta.fixedMainLifts
          : null,
      weakAreas: Array.isArray(profile?.weakAreas) ? profile.weakAreas : [],
      equipment: Array.isArray(profile?.equipment) ? profile.equipment : [],
      planGuidelines,
    };
  }, [isStrength, athleteProfile, selectedPlanDoc, plan, weeks.length, metaName]);

  const heroStats = useMemo(() => {
    if (isRun && runSummary) {
      return [
        { label: "Weeks", value: String(runSummary.planLengthWeeks || weeks.length) },
        { label: "Runs / week", value: String(runSummary.sessionsPerWeek || "—") },
        { label: "Long run", value: runSummary.longRunDay || "—" },
      ];
    }
    if (isStrength && strengthSummary) {
      return [
        { label: "Weeks", value: String(strengthSummary.planLengthWeeks || weeks.length) },
        { label: "Days / week", value: String(strengthSummary.daysPerWeek || "—") },
        { label: "Split", value: strengthSummary.preferredSplit || "—" },
      ];
    }
    return [];
  }, [isRun, isStrength, runSummary, strengthSummary, weeks.length]);

  const showAddStrength = !!plansByType.run && !plansByType.strength;
  const showAddRun = !!plansByType.strength && !plansByType.run;

  if (loading) {
    return (
      <View style={styles.page}>
        <LinearGradient
          colors={[theme.topFadeStart, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topFade}
          pointerEvents="none"
        />
        <TopBar title="View plan" onBack={() => router.back()} styles={styles} typeLabel={selectedType} />
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.mutedText}>Loading plans…</Text>
        </View>
      </View>
    );
  }

  if (!availableTypes.length || !selectedPlanDoc || !weeks.length) {
    return (
      <View style={styles.page}>
        <LinearGradient
          colors={[theme.topFadeStart, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topFade}
          pointerEvents="none"
        />
        <TopBar title="View plan" onBack={() => router.back()} styles={styles} typeLabel={selectedType} />
        <View style={[styles.card, { margin: 16 }]}>
          <Text style={styles.cardTitle}>No plan to show</Text>
          <Text style={styles.mutedText}>{error || "Generate a plan first."}</Text>

          <Pressable
            onPress={() => router.push("/train/create-home")}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.primaryBtnText}>Create a plan</Text>
          </Pressable>

          <Pressable
            onPress={onRefresh}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <LinearGradient
        colors={[theme.topFadeStart, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.topFade}
        pointerEvents="none"
      />
      <TopBar title="View plan" onBack={() => router.back()} styles={styles} typeLabel={selectedType} />

      <ScrollView
        contentContainerStyle={styles.scrollPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {availableTypes.length > 1 && (
          <View style={styles.switcherWrap}>
            <Text style={styles.switcherTitle}>Plan type</Text>
            <View style={styles.planTypeToggle}>
              <Pressable
                onPress={() => {
                  setSelectedType("run");
                  setExpandedWeek(0);
                }}
                style={[
                  styles.planTypeBtn,
                  selectedType === "run" && styles.planTypeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.planTypeBtnText,
                    selectedType === "run" && styles.planTypeBtnTextActive,
                  ]}
                >
                  Run
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setSelectedType("strength");
                  setExpandedWeek(0);
                }}
                style={[
                  styles.planTypeBtn,
                  selectedType === "strength" && styles.planTypeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.planTypeBtnText,
                    selectedType === "strength" && styles.planTypeBtnTextActive,
                  ]}
                >
                  Strength
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.headerCard}>
          <Text style={styles.hKicker}>Active training block</Text>
          <Text style={styles.hTitle}>
            {isStrength ? strengthSummary?.name : runSummary?.name}
          </Text>
          <Text style={styles.hSub}>
            {isStrength
              ? `${strengthSummary?.goalType || "Strength"} • ${weeks.length} weeks`
              : `${runSummary?.distance || "Run"} • ${weeks.length} weeks`}
          </Text>

          {!!heroStats.length && (
            <View style={styles.heroStatRow}>
              {heroStats.map((item) => (
                <View key={`hero-stat-${item.label}`} style={styles.heroStatCard}>
                  <Text style={styles.heroStatLabel}>{item.label}</Text>
                  <Text style={styles.heroStatValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.headerActions}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/train/edit-plan",
                  params: {
                    id: selectedPlanDoc?.id,
                    edit: "1",
                  },
                })
              }
              style={({ pressed }) => [
                styles.headerPrimaryBtn,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.headerPrimaryBtnText}>Edit plan</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/train")}
              style={({ pressed }) => [
                styles.headerSecondaryBtn,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.headerSecondaryBtnText}>Back to Train</Text>
            </Pressable>
          </View>
        </View>

        {showAddStrength ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add companion plan</Text>
            <Text style={styles.mutedText}>
              You already have a run plan. Add a strength plan around it to complete the training setup.
            </Text>
            <Pressable
              onPress={() => router.push("/train/create/create-strength")}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.primaryBtnText}>Add strength plan</Text>
            </Pressable>
          </View>
        ) : null}

        {showAddRun ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add companion plan</Text>
            <Text style={styles.mutedText}>
              You already have a strength plan. Add a run plan around it to complete the training setup.
            </Text>
            <Pressable
              onPress={() => router.push("/train/create/create-run")}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.primaryBtnText}>Add run plan</Text>
            </Pressable>
          </View>
        ) : null}

        {isRun && runSummary ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Summary</Text>

            <View style={styles.rowWrap}>
              <InfoPill styles={styles} label="Goal" value={runSummary.distance || "—"} />
              <InfoPill styles={styles} label="Target" value={runSummary.targetTime || "—"} />
              <InfoPill styles={styles} label="Weeks" value={String(runSummary.planLengthWeeks || weeks.length)} />
              <InfoPill styles={styles} label="Runs/wk" value={String(runSummary.sessionsPerWeek || "—")} />
              <InfoPill styles={styles} label="Long run" value={runSummary.longRunDay || "—"} />
              <InfoPill styles={styles} label="Difficulty" value={runSummary.difficulty || "—"} />
            </View>

            {!!runSummary.runDays?.length && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.mutedText}>
                  Run days: <Text style={styles.boldText}>{runSummary.runDays.join(", ")}</Text>
                </Text>
              </View>
            )}

            <View style={styles.divider} />

            <Text style={styles.mutedText}>
              Current volume:{" "}
              <Text style={styles.boldText}>
                {runSummary.weeklyKmNow ? `${runSummary.weeklyKmNow} km/wk` : "—"}
              </Text>{" "}
              • Longest run:{" "}
              <Text style={styles.boldText}>
                {runSummary.longestRunNow ? `${runSummary.longestRunNow} km` : "—"}
              </Text>
            </Text>

            {!!runSummary.maxWeeklyKm && (
              <Text style={[styles.mutedText, { marginTop: 6 }]}>
                Peak target: <Text style={styles.boldText}>{runSummary.maxWeeklyKm} km/wk</Text>
                {!!runSummary.maxLongKm ? (
                  <>
                    {" "}
                    • Peak long run: <Text style={styles.boldText}>{runSummary.maxLongKm} km</Text>
                  </>
                ) : null}
              </Text>
            )}
          </View>
        ) : null}

        {isStrength && strengthSummary ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Summary</Text>

              <View style={styles.rowWrap}>
                <InfoPill styles={styles} label="Goal" value={strengthSummary.goalType || "—"} />
                <InfoPill styles={styles} label="Focus" value={strengthSummary.primaryFocus || "—"} />
                <InfoPill styles={styles} label="Weeks" value={String(strengthSummary.planLengthWeeks || weeks.length)} />
                <InfoPill styles={styles} label="Days/wk" value={String(strengthSummary.daysPerWeek || "—")} />
                <InfoPill styles={styles} label="Split" value={strengthSummary.preferredSplit || "—"} />
                <InfoPill styles={styles} label="Length" value={strengthSummary.sessionLength || "—"} />
                <InfoPill styles={styles} label="Progression" value={strengthSummary.progressionStyle || "—"} />
                <InfoPill
                  styles={styles}
                  label="Main lifts"
                  value={
                    strengthSummary.fixedMainLifts == null
                      ? "—"
                      : strengthSummary.fixedMainLifts
                      ? "Stable"
                      : "Rotating"
                  }
                />
              </View>

              {!!strengthSummary.preferredDays?.length && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.mutedText}>
                    Preferred days:{" "}
                    <Text style={styles.boldText}>
                      {strengthSummary.preferredDays.join(", ")}
                    </Text>
                  </Text>
                </View>
              )}

              {!!strengthSummary.weakAreas?.length && (
                <Text style={[styles.mutedText, { marginTop: 6 }]}>
                  Weak areas:{" "}
                  <Text style={styles.boldText}>
                    {strengthSummary.weakAreas.join(", ")}
                  </Text>
                </Text>
              )}

              {!!strengthSummary.equipment?.length && (
                <Text style={[styles.mutedText, { marginTop: 6 }]}>
                  Equipment:{" "}
                  <Text style={styles.boldText}>
                    {strengthSummary.equipment.join(", ")}
                  </Text>
                </Text>
              )}
            </View>

            {!!(
              Array.isArray(strengthSummary.planGuidelines?.progression) ||
              Array.isArray(strengthSummary.planGuidelines?.execution)
            ) && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Guidelines</Text>

                {Array.isArray(strengthSummary.planGuidelines?.progression) &&
                  strengthSummary.planGuidelines.progression.length > 0 && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.subSectionLabel}>Progression</Text>
                      {strengthSummary.planGuidelines.progression.map((line, idx) => (
                        <Text key={`prog-${idx}`} style={styles.bulletText}>
                          • {line}
                        </Text>
                      ))}
                    </View>
                  )}

                {Array.isArray(strengthSummary.planGuidelines?.execution) &&
                  strengthSummary.planGuidelines.execution.length > 0 && (
                    <View>
                      <Text style={styles.subSectionLabel}>Execution</Text>
                      {strengthSummary.planGuidelines.execution.map((line, idx) => (
                        <Text key={`exec-${idx}`} style={styles.bulletText}>
                          • {line}
                        </Text>
                      ))}
                    </View>
                  )}
              </View>
            )}
          </>
        ) : null}

        <View style={{ marginBottom: 10 }}>
          <Text style={styles.sectionTitle}>Weeks</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.weekTabs}
          >
            {weeks.map((w, idx) => {
              const isActive = expandedWeek === idx;
              const tabSub = isStrength
                ? `${countStrengthWeekSessions(w)} sess`
                : `${sumRunWeekKm(w)}k`;

              return (
                <Pressable
                  key={`tab-${idx}`}
                  onPress={() => setExpandedWeek(idx)}
                  style={({ pressed }) => [
                    styles.weekTab,
                    isActive && styles.weekTabActive,
                    pressed && { opacity: 0.9 },
                  ]}
                >
                  <Text style={[styles.weekTabText, isActive && styles.weekTabTextActive]}>
                    W{w.weekNumber}
                  </Text>
                  <Text style={[styles.weekTabSub, isActive && styles.weekTabSubActive]}>
                    {tabSub}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {weeks.map((week, wIdx) => {
          const isOpen = expandedWeek === wIdx;

          const weekMeta = isStrength
            ? `${countStrengthWeekSessions(week)} sessions • ${
                week?.phase?.label || "Training"
              }`
            : `${sumRunWeekKm(week)} km planned • ${
                !!week?.targets?.isDeload || /deload/i.test(String(week?.phase || ""))
                  ? "Deload"
                  : "Build"
              }`;

          return (
            <View key={`week-${wIdx}`} style={styles.weekCard}>
              <Pressable
                onPress={() => setExpandedWeek(isOpen ? -1 : wIdx)}
                style={({ pressed }) => [styles.weekHeader, pressed && { opacity: 0.92 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.weekTitle}>Week {week.weekNumber}</Text>
                  <Text style={styles.weekMeta}>{weekMeta}</Text>
                  {isStrength && week?.focus ? (
                    <Text style={styles.weekFocus}>{week.focus}</Text>
                  ) : null}
                </View>

                <Text style={styles.chevron}>{isOpen ? "▾" : "▸"}</Text>
              </Pressable>

              {isOpen && (
                <View style={styles.weekBody}>
                  {(week?.days || []).map((dayObj, dIdx) => (
                    <DayBlock
                      key={`day-${wIdx}-${dIdx}`}
                      dayObj={dayObj}
                      styles={styles}
                      type={selectedType}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <Pressable
          onPress={handleDeletePlan}
          disabled={deleting}
          style={({ pressed }) => [
            styles.dangerBtn,
            deleting && { opacity: 0.65 },
            pressed && !deleting && { opacity: 0.9 },
          ]}
        >
          <Text style={styles.dangerBtnText}>
            {deleting
              ? "Deleting…"
              : `Delete ${selectedType === "strength" ? "strength" : "run"} plan`}
          </Text>
        </Pressable>

        <View style={{ height: 22 }} />
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------
   Components
------------------------------------------------------------ */

function TopBar({ title, onBack, styles, typeLabel }) {
  const typeText =
    typeLabel === "strength" ? "Strength" : typeLabel === "run" ? "Run" : null;

  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.9 }]}>
        <Text style={styles.backBtnText}>←</Text>
      </Pressable>
      <View style={styles.topTitleWrap}>
        <Text style={styles.topTitle}>{title}</Text>
        <Text style={styles.topSubtitle}>Your current plan overview</Text>
      </View>
      {typeText ? (
        <View style={styles.topTypeChip}>
          <Text style={styles.topTypeChipText}>{typeText}</Text>
        </View>
      ) : (
        <View style={{ width: 58 }} />
      )}
    </View>
  );
}

function InfoPill({ label, value, styles }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillValue}>{value}</Text>
    </View>
  );
}

function DayBlock({ dayObj, styles, type }) {
  const day = dayObj?.day || "";
  const sessions = Array.isArray(dayObj?.sessions) ? dayObj.sessions : [];
  const dayTitle = day || "Day";

  const dayMetric =
    type === "strength"
      ? `${countStrengthDaySessions(dayObj)} session${countStrengthDaySessions(dayObj) === 1 ? "" : "s"}`
      : `${sumRunDayKm(dayObj)} km`;

  const badgeText = sessions.length > 0 ? (type === "strength" ? "LIFT" : "RUN") : "REST";

  return (
    <View style={styles.dayCard}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{dayTitle}</Text>
        <View style={styles.dayRight}>
          {sessions.length > 0 && <Text style={styles.dayMeta}>{dayMetric}</Text>}
          <Text
            style={[
              styles.dayBadge,
              sessions.length > 0 ? styles.badgeRun : styles.badgeRest,
            ]}
          >
            {badgeText}
          </Text>
        </View>
      </View>

      {sessions.length === 0 ? (
        <Text style={styles.mutedText}>
          {type === "strength"
            ? dayObj?.recoveryGuidance || "Recovery / no structured lifting session"
            : "Rest / no structured session"}
        </Text>
      ) : type === "strength" ? (
        sessions.map((s, idx) => (
          <StrengthSessionBlock
            key={`${dayTitle}-strength-${idx}`}
            session={s}
            styles={styles}
          />
        ))
      ) : (
        sessions.map((s, idx) => (
          <RunSessionBlock key={`${dayTitle}-run-${idx}`} session={s} styles={styles} />
        ))
      )}
    </View>
  );
}

function RunSessionBlock({ session, styles }) {
  const name = session?.name || session?.title || session?.sessionType || session?.type || "Session";
  const typeLabel = titleCaseWords(session?.type || session?.sessionType || "Easy");
  const km = safeKm(session);
  const notes = String(session?.notes || "").trim();
  const targetPace = session?.targetPace;
  const targetHr = session?.targetHr;
  const warmupMin = Number.isFinite(Number(session?.warmupMin)) ? Number(session.warmupMin) : null;
  const cooldownMin = Number.isFinite(Number(session?.cooldownMin)) ? Number(session.cooldownMin) : null;

  const paceText =
    Number.isFinite(Number(targetPace?.minSecPerKm)) && Number.isFinite(Number(targetPace?.maxSecPerKm))
      ? `${secToMinSec(Number(targetPace.minSecPerKm))}-${secToMinSec(Number(targetPace.maxSecPerKm))}/km`
      : null;

  const hrText =
    Number.isFinite(Number(targetHr?.minBpm)) && Number.isFinite(Number(targetHr?.maxBpm))
      ? `${Math.round(Number(targetHr.minBpm))}-${Math.round(Number(targetHr.maxBpm))} bpm`
      : null;

  const rawSteps = Array.isArray(session?.steps)
    ? session.steps
    : Array.isArray(session?.workout?.steps)
    ? session.workout.steps
    : [];
  const isEasySession = /easy/i.test(String(session?.sessionType || session?.type || ""));
  const steps = isEasySession
    ? rawSteps.filter((st) => !isWarmCooldownRunStep(st))
    : rawSteps;
  const showWarmupMin = isEasySession ? null : warmupMin;
  const showCooldownMin = isEasySession ? null : cooldownMin;

  const metricChips = [
    { label: typeLabel },
    { label: typeof km === "number" ? `${Math.round(km * 10) / 10} km` : null },
    { label: showWarmupMin ? `WU ${showWarmupMin}m` : null },
    { label: showCooldownMin ? `CD ${showCooldownMin}m` : null },
    { label: paceText ? `Pace ${paceText}` : null },
    { label: hrText ? `HR ${hrText}` : null },
    { label: steps.length ? `${steps.length} steps` : null },
  ].filter((x) => !!x.label);

  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionTitle}>{name}</Text>
        <Text style={styles.sessionMeta}>{typeLabel}</Text>
      </View>

      {!!metricChips.length && (
        <View style={styles.sessionChipRow}>
          {metricChips.map((chip, idx) => (
            <View key={`run-chip-${idx}`} style={styles.sessionChip}>
              <Text style={styles.sessionChipText}>{chip.label}</Text>
            </View>
          ))}
        </View>
      )}

      {!!notes && <Text style={styles.sessionNotes}>{notes}</Text>}

      {!!steps.length && (
        <View style={styles.stepsWrap}>
          <Text style={styles.stepsLabel}>Workout steps</Text>
          {steps.map((st, i) => {
            if (st?.stepType === "repeat" && Array.isArray(st?.steps)) {
              return (
                <View key={`repeat-${i}`} style={styles.repeatBlock}>
                  <Text style={styles.stepText}>Repeat ×{st.repeatCount || 1}</Text>
                  {st.steps.map((inner, j) => (
                    <Text key={`repeat-${i}-${j}`} style={styles.stepSubText}>
                      • {formatRunStep(inner)}
                    </Text>
                  ))}
                </View>
              );
            }

            return (
              <Text key={`step-${i}`} style={styles.stepText}>
                • {formatRunStep(st)}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

function StrengthSessionBlock({ session, styles }) {
  const title = session?.title || "Strength session";
  const emphasis = String(session?.emphasis || "").trim();
  const focus = String(session?.focus || "").trim();
  const notes = String(session?.notes || "").trim();
  const durationMin = Number.isFinite(Number(session?.durationMin)) ? Number(session.durationMin) : null;
  const targetDurationMin = Number.isFinite(Number(session?.targetDurationMin))
    ? Number(session.targetDurationMin)
    : null;

  const coaching = session?.coaching || {};
  const blocks = Array.isArray(session?.blocks) ? session.blocks : [];

  const metricChips = [
    { label: emphasis || null },
    { label: focus ? `Focus ${focus}` : null },
    { label: durationMin ? `${durationMin} min` : null },
    { label: targetDurationMin ? `Target ${targetDurationMin} min` : null },
    { label: coaching?.weekPhase ? coaching.weekPhase : null },
    { label: blocks.length ? `${blocks.length} blocks` : null },
  ].filter((x) => !!x.label);

  return (
    <View style={styles.sessionCard}>
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionTitle}>{title}</Text>
        <Text style={styles.sessionMeta}>Strength</Text>
      </View>

      {!!metricChips.length && (
        <View style={styles.sessionChipRow}>
          {metricChips.map((chip, idx) => (
            <View key={`strength-chip-${idx}`} style={styles.sessionChip}>
              <Text style={styles.sessionChipText}>{chip.label}</Text>
            </View>
          ))}
        </View>
      )}

      {!!notes && <Text style={styles.sessionNotes}>{notes}</Text>}

      {!!coaching?.progressionNote && (
        <Text style={styles.sessionNotes}>
          <Text style={styles.boldText}>Progression: </Text>
          {coaching.progressionNote}
        </Text>
      )}

      {!!coaching?.recoveryTarget && (
        <Text style={styles.sessionNotes}>
          <Text style={styles.boldText}>Recovery target: </Text>
          {coaching.recoveryTarget}
        </Text>
      )}

      {!!blocks.length && (
        <View style={styles.stepsWrap}>
          <Text style={styles.stepsLabel}>Session blocks</Text>

          {blocks.map((block, idx) => {
            const items = Array.isArray(block?.items) ? block.items : [];
            return (
              <View key={`block-${idx}`} style={styles.repeatBlock}>
                <Text style={styles.stepText}>
                  {block?.title || block?.kind || `Block ${idx + 1}`}
                </Text>

                {items.length ? (
                  items.map((item, itemIdx) => (
                    <Text key={`block-${idx}-item-${itemIdx}`} style={styles.stepSubText}>
                      • {formatStrengthItem(item)}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.stepSubText}>• No items listed</Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------
   Styles
------------------------------------------------------------ */

function makeStyles(t, topInset = 0) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: t.bg,
    },
    topFade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 260,
    },
    scrollPad: {
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 34,
    },

    topBar: {
      paddingTop: Math.max((Number(topInset) || 0) + 6, 12),
      paddingBottom: 10,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    topTitleWrap: {
      flex: 1,
      minHeight: 38,
      justifyContent: "center",
    },
    topTitle: {
      color: t.text,
      fontSize: 17,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
    topSubtitle: {
      marginTop: 2,
      color: t.subtext,
      fontSize: 12,
      fontWeight: "500",
    },
    backBtn: {
      width: 38,
      height: 34,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.surfaceAlt,
    },
    backBtnText: {
      color: t.text,
      fontSize: 17,
      fontWeight: "800",
    },
    topTypeChip: {
      minHeight: 30,
      minWidth: 58,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
      paddingHorizontal: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    topTypeChipText: {
      color: t.text,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.2,
    },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      padding: 16,
    },

    switcherWrap: {
      marginBottom: 12,
    },
    switcherTitle: {
      color: t.subtext,
      fontSize: 12,
      fontWeight: "600",
      marginBottom: 8,
    },
    planTypeToggle: {
      flexDirection: "row",
      backgroundColor: t.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 16,
      padding: 4,
      gap: 6,
    },
    planTypeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    planTypeBtnActive: {
      backgroundColor: "rgba(230,255,59,0.18)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(230,255,59,0.5)",
    },
    planTypeBtnText: {
      color: t.subtext,
      fontSize: 13,
      fontWeight: "900",
    },
    planTypeBtnTextActive: {
      color: t.text,
    },

    headerCard: {
      marginBottom: 14,
      paddingHorizontal: 16,
      paddingVertical: 15,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
    },
    hKicker: {
      color: t.subtext,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    hTitle: {
      color: t.text,
      fontSize: 23,
      fontWeight: "800",
      letterSpacing: 0.2,
      marginTop: 4,
    },
    hSub: {
      marginTop: 4,
      color: t.subtext,
      fontSize: 13,
      fontWeight: "500",
      lineHeight: 18,
    },
    heroStatRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 12,
    },
    heroStatCard: {
      flex: 1,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.card,
      paddingVertical: 8,
      paddingHorizontal: 9,
    },
    heroStatLabel: {
      color: t.subtext,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.2,
    },
    heroStatValue: {
      color: t.text,
      fontSize: 13,
      fontWeight: "700",
      marginTop: 3,
    },
    headerActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 13,
    },
    headerPrimaryBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.primaryBg,
      paddingHorizontal: 12,
    },
    headerPrimaryBtnText: {
      color: t.primaryText,
      fontWeight: "700",
      fontSize: 13,
      letterSpacing: 0.1,
    },
    headerSecondaryBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: t.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      paddingHorizontal: 12,
    },
    headerSecondaryBtnText: {
      color: t.text,
      fontWeight: "700",
      fontSize: 13,
      letterSpacing: 0.1,
    },

    card: {
      backgroundColor: t.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 16,
      marginBottom: 14,
    },
    cardTitle: {
      color: t.text,
      fontSize: 17,
      fontWeight: "700",
      marginBottom: 10,
    },
    subSectionLabel: {
      color: t.text,
      fontSize: 12,
      fontWeight: "700",
      marginBottom: 8,
      letterSpacing: 0.2,
    },
    mutedText: {
      color: t.subtext,
      fontSize: 13,
      lineHeight: 20,
    },
    boldText: {
      color: t.text,
      fontWeight: "700",
    },
    bulletText: {
      color: t.subtext,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 4,
    },

    rowWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    pill: {
      backgroundColor: t.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 12,
      paddingVertical: 9,
      paddingHorizontal: 11,
      minWidth: 96,
    },
    pillLabel: {
      color: t.subtext,
      fontSize: 10,
      marginBottom: 2,
      fontWeight: "600",
      letterSpacing: 0.2,
    },
    pillValue: {
      color: t.text,
      fontSize: 13,
      fontWeight: "700",
    },

    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.border,
      marginVertical: 12,
    },

    sectionTitle: {
      color: t.text,
      fontSize: 18,
      fontWeight: "700",
      marginTop: 4,
      marginBottom: 10,
      letterSpacing: 0.1,
    },

    weekTabs: {
      paddingRight: 16,
      gap: 8,
    },
    weekTab: {
      minWidth: 64,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceAlt,
      alignItems: "center",
    },
    weekTabActive: {
      borderColor: "rgba(230,255,59,0.5)",
      backgroundColor: "rgba(230,255,59,0.18)",
    },
    weekTabText: {
      color: t.text,
      fontWeight: "900",
      fontSize: 12,
    },
    weekTabTextActive: {
      color: t.text,
    },
    weekTabSub: {
      marginTop: 2,
      color: t.subtext,
      fontSize: 11,
      fontWeight: "600",
    },
    weekTabSubActive: {
      color: t.text,
      opacity: 0.85,
    },

    weekCard: {
      backgroundColor: t.surfaceAlt,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      marginBottom: 12,
      overflow: "hidden",
    },
    weekHeader: {
      flexDirection: "row",
      alignItems: "center",
      padding: 14,
    },
    weekTitle: {
      color: t.text,
      fontSize: 16,
      fontWeight: "700",
    },
    weekMeta: {
      color: t.subtext,
      fontSize: 12,
      fontWeight: "600",
      marginTop: 3,
    },
    weekFocus: {
      color: t.text,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 4,
      opacity: 0.9,
    },
    chevron: {
      color: t.subtext,
      fontSize: 18,
      fontWeight: "900",
      marginLeft: 10,
    },
    weekBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      gap: 10,
    },

    dayCard: {
      backgroundColor: t.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 14,
      padding: 12,
      gap: 10,
    },
    dayHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    dayRight: {
      alignItems: "flex-end",
      gap: 6,
    },
    dayMeta: {
      color: t.subtext,
      fontSize: 11,
      fontWeight: "600",
    },
    dayTitle: {
      color: t.text,
      fontSize: 14,
      fontWeight: "700",
    },
    dayBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: "900",
      overflow: "hidden",
    },
    badgeRun: {
      backgroundColor: "rgba(230,255,59,0.22)",
      color: t.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(230,255,59,0.4)",
    },
    badgeRest: {
      backgroundColor: "rgba(148,163,184,0.12)",
      color: t.subtext,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },

    sessionCard: {
      backgroundColor: t.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 14,
      padding: 12,
      gap: 8,
    },
    sessionHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 10,
    },
    sessionTitle: {
      flex: 1,
      color: t.text,
      fontSize: 14,
      fontWeight: "700",
    },
    sessionMeta: {
      color: t.subtext,
      fontSize: 12,
      fontWeight: "600",
    },
    sessionNotes: {
      color: t.subtext,
      fontSize: 12,
      lineHeight: 17,
    },
    sessionChipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    sessionChip: {
      backgroundColor: t.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    sessionChipText: {
      color: t.text,
      fontSize: 10,
      fontWeight: "600",
    },
    stepsWrap: {
      gap: 4,
      marginTop: 2,
    },
    stepsLabel: {
      color: t.subtext,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
    stepText: {
      color: t.text,
      fontSize: 12,
      lineHeight: 18,
      opacity: 0.95,
      fontWeight: "600",
    },
    stepSubText: {
      color: t.subtext,
      fontSize: 12,
      lineHeight: 18,
      marginLeft: 10,
      fontWeight: "600",
    },
    repeatBlock: {
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.card,
      gap: 4,
    },

    primaryBtn: {
      marginTop: 12,
      backgroundColor: t.primaryBg,
      paddingVertical: 12,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnText: {
      color: t.primaryText,
      fontWeight: "700",
      letterSpacing: 0.1,
    },

    secondaryBtn: {
      marginTop: 10,
      backgroundColor: t.surfaceAlt,
      paddingVertical: 12,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
    },
    secondaryBtnText: {
      color: t.text,
      fontWeight: "700",
      letterSpacing: 0.1,
    },
    dangerBtn: {
      marginTop: 8,
      marginBottom: 4,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(239,68,68,0.55)",
      backgroundColor: "rgba(239,68,68,0.12)",
    },
    dangerBtnText: {
      color: "#ef4444",
      fontWeight: "700",
      letterSpacing: 0.1,
    },
  });
}
