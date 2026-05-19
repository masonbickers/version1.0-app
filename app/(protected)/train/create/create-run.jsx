// app/(protected)/train/create/create-run.jsx
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { API_URL } from "../../../../config/api";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";
import { getJsonAuthHeaders } from "../../../../src/lib/api/authHeaders";
import { withPlanAdaptationDefaults } from "../../../../src/lib/train/adaptationModel";
import { publishTrainingWidgetSnapshotFromPlan } from "../../../../src/widgets/trainingWidgetSnapshot";

/* ------------------------------------------------------------------ */
/* CONFIG                                                             */
/* ------------------------------------------------------------------ */

const GOAL_DISTANCE_OPTIONS = [
  "5K",
  "10K",
  "Half marathon",
  "Marathon",
  "Ultra",
  "General fitness",
  "Return from injury",
  "Other",
];

const GOAL_TYPE_OPTIONS = [
  { key: "race", title: "Race", blurb: "Booked a race and want a personalised plan?", icon: "flag" },
  { key: "distance", title: "Run a specific distance", blurb: "Choose your distance from 5K up to marathon+.", icon: "map" },
  { key: "start", title: "Start running", blurb: "Build consistency and confidence from your current level.", icon: "sunrise" },
  { key: "return", title: "Get back into running", blurb: "Rebuild fitness safely after time away.", icon: "refresh-cw" },
  { key: "improve5k", title: "5K improvement", blurb: "Sharpen your 5K and target a faster PB.", icon: "zap" },
  { key: "general", title: "General training", blurb: "Improve overall running fitness and endurance.", icon: "heart" },
];

const ABILITY_OPTIONS = [
  { key: "beginner", title: "Beginner", value: "New to running", blurb: "You are building consistency from a low base." },
  { key: "intermediate", title: "Intermediate", value: "Some experience", blurb: "You run regularly but want more structure." },
  { key: "advanced", title: "Advanced", value: "Regular runner", blurb: "You train weekly and can handle quality sessions." },
  { key: "elite", title: "Elite", value: "Advanced/competitive", blurb: "You train consistently and handle high load." },
];

const GENDER_OPTIONS = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "non_binary", label: "Non-binary" },
  { key: "not_say", label: "Prefer not to say" },
];

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];
const PLAN_LENGTH_OPTIONS = [6, 8, 10, 12, 16, 20];
const GOAL_TIME_HOUR_OPTIONS = Array.from({ length: 7 }, (_, i) => i);
const GOAL_TIME_MIN_SEC_OPTIONS = Array.from({ length: 60 }, (_, i) => i);
const TIME_WHEEL_ITEM_HEIGHT = 46;
const TIME_WHEEL_VISIBLE_ITEMS = 5;

const PRIMARY = "#E6FF3B";
const SILVER_LIGHT = "#F3F4F6";
const SILVER_MEDIUM = "#E1E3E8";
const RUN_PLAN_VERSION = "run-plan-v1";
const RULES_ENGINE_VERSION = "rules-engine-v1";
const TEMPLATE_VERSION = "gold-template-v1";
const RAW_DEBUG_PLAN_FIELDS = new Set([
  "debug",
  "paceTrace",
  "validationTrace",
  "missedSessionRepairTrace",
  "readinessAdjustmentTrace",
  "strengthAdjustmentTrace",
  "weeklyRecalculationTrace",
  "workoutSelectionTrace",
  "decisionTrace",
]);

const STEPS = [
  "Goal",
  "Timeline",
  "Goal time",
  "Running ability",
  "Birthday",
  "Gender",
  "Weekly volume",
  "Longest run",
  "Runs per week",
  "Available days",
  "Long run day",
  "Difficulty",
];

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DIFFICULTY_OPTIONS = [
  { key: "Conservative", title: "Conservative", blurb: "More recovery. Gentler progression." },
  { key: "Balanced", title: "Balanced", blurb: "Standard progression plus sensible recovery." },
  { key: "Aggressive", title: "Aggressive", blurb: "Faster progression. Only if you are resilient and consistent." },
];

const DEFAULT_RUN_DAYS_BY_N = {
  2: ["Tue", "Sun"],
  3: ["Tue", "Thu", "Sun"],
  4: ["Mon", "Tue", "Thu", "Sun"],
  5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
  6: ["Mon", "Tue", "Wed", "Thu", "Sat", "Sun"],
  7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

/* ------------------------------------------------------------------ */
/* STOCK TEMPLATE MAP                                                 */
/* ------------------------------------------------------------------ */

const STOCK_TEMPLATE_INDEX = [
  { id: "10k_6w_3", distance: "10K", weeks: 6, runs: 3 },
  { id: "10k_8w_3", distance: "10K", weeks: 8, runs: 3 },
  { id: "10k_8w_4", distance: "10K", weeks: 8, runs: 4 },
  { id: "10k_12w_4", distance: "10K", weeks: 12, runs: 4 },
  { id: "10k_12w_5", distance: "10K", weeks: 12, runs: 5 },

  { id: "5k_6w_3", distance: "5K", weeks: 6, runs: 3 },
  { id: "5k_8w_4", distance: "5K", weeks: 8, runs: 4 },
  { id: "5k_12w_5", distance: "5K", weeks: 12, runs: 5 },

  { id: "hm_10w_3", distance: "Half marathon", weeks: 10, runs: 3 },
  { id: "hm_12w_4", distance: "Half marathon", weeks: 12, runs: 4 },
  { id: "hm_16w_4", distance: "Half marathon", weeks: 16, runs: 4 },
  { id: "hm_16w_5", distance: "Half marathon", weeks: 16, runs: 5 },

  { id: "mar_12w_3", distance: "Marathon", weeks: 12, runs: 3 },
  { id: "mar_16w_4", distance: "Marathon", weeks: 16, runs: 4 },
  { id: "mar_20w_4", distance: "Marathon", weeks: 20, runs: 4 },
  { id: "mar_20w_5", distance: "Marathon", weeks: 20, runs: 5 },
];

function weeksBetweenDates(fromDate, toDate) {
  if (!(fromDate instanceof Date) || !(toDate instanceof Date)) return null;
  const ms = toDate.getTime() - fromDate.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24 * 7)));
}

function pickStockTemplateId({ distance, weeks, runs }) {
  if (!distance || !weeks || !runs) return null;

  const sameDistance = STOCK_TEMPLATE_INDEX.filter((t) => t.distance === distance);
  if (!sameDistance.length) return null;

  const exact = sameDistance.find((t) => t.weeks === weeks && t.runs === runs);
  if (exact) return exact.id;

  const sameRuns = sameDistance.filter((t) => t.runs === runs);
  if (sameRuns.length) {
    return sameRuns
      .slice()
      .sort((a, b) => Math.abs(a.weeks - weeks) - Math.abs(b.weeks - weeks))[0]?.id || null;
  }

  const sameWeeks = sameDistance.filter((t) => t.weeks === weeks);
  if (sameWeeks.length) {
    return sameWeeks
      .slice()
      .sort((a, b) => Math.abs(a.runs - runs) - Math.abs(b.runs - runs))[0]?.id || null;
  }

  const nearest = sameDistance
    .slice()
    .sort((a, b) => {
      const da = Math.abs(a.weeks - weeks) * 10 + Math.abs(a.runs - runs);
      const db = Math.abs(b.weeks - weeks) * 10 + Math.abs(b.runs - runs);
      return da - db;
    })[0];

  return nearest?.id || null;
}

function getLowFrequencyGoalWarning(distance, sessionsPerWeek) {
  const distanceKey = String(distance || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  const runs = Math.round(Number(sessionsPerWeek) || 0);
  if (!runs) return null;

  const isHalf = distanceKey.includes("half");
  const isMarathon = distanceKey.includes("marathon") && !isHalf;
  const isUltra = distanceKey.includes("ultra");

  if (isHalf && runs === 1) {
    return {
      code: "LOW_FREQUENCY_FOR_GOAL",
      severity: "warning",
      recommendedSessionsPerWeek: 3,
      message: "A half marathon plan is ambitious with 1 run per week. Add more run days or choose a shorter goal.",
    };
  }

  if (isMarathon && runs <= 2) {
    return {
      code: "LOW_FREQUENCY_FOR_GOAL",
      severity: "warning",
      recommendedSessionsPerWeek: 3,
      message: "A marathon plan is ambitious with fewer than 3 runs per week. Add more run days or choose a shorter goal.",
    };
  }

  if (isUltra && runs < 4) {
    return {
      code: "LOW_FREQUENCY_FOR_GOAL",
      severity: "warning",
      recommendedSessionsPerWeek: 4,
      message: "An ultra plan is ambitious with fewer than 4 runs per week. Add more run days or choose a shorter goal.",
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                            */
/* ------------------------------------------------------------------ */

function formatDatePretty(date) {
  if (!date) return "";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateYYYYMMDD(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clampInt(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function parseDurationToSeconds(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const parts = raw.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  if (parts.length === 2) {
    const [mm, ss] = nums;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }

  const [hh, mm, ss] = nums;
  if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
  return hh * 3600 + mm * 60 + ss;
}

function parsePaceSecPerKm(input) {
  const sec = parseDurationToSeconds(input);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 120 || sec > 900) return null;
  return Math.round(sec);
}

function goalDistanceToKm(distanceLabel) {
  const raw = String(distanceLabel || "").trim().toLowerCase();
  if (raw === "5k") return 5;
  if (raw === "10k") return 10;
  if (raw.includes("half")) return 21.0975;
  if (raw.includes("marathon")) return 42.195;
  const kmMatch = raw.match(/^(\d+(?:\.\d+)?)\s*k(?:m)?$/);
  if (kmMatch) {
    const km = Number(kmMatch[1]);
    return Number.isFinite(km) && km > 0 ? km : null;
  }
  return null;
}

function clampPaceSec(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(120, Math.min(900, Math.round(n)));
}

function formatGoalTimeString(totalSeconds) {
  const sec = Number(totalSeconds);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPacePerKm(totalSeconds) {
  const sec = Math.round(Number(totalSeconds));
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

function derivePaceTargetsFromGoalTime({ goalDistance, goalTargetTimeSec, difficulty }) {
  const distanceKm = goalDistanceToKm(goalDistance);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  if (!Number.isFinite(goalTargetTimeSec) || goalTargetTimeSec <= 0) return null;

  const racePace = goalTargetTimeSec / distanceKm;
  if (!Number.isFinite(racePace) || racePace <= 0) return null;

  let thresholdFactor = 1.04;
  if (distanceKm <= 5.01) thresholdFactor = 1.10;
  else if (distanceKm <= 10.01) thresholdFactor = 1.04;
  else if (distanceKm <= 21.2) thresholdFactor = 1.01;
  else thresholdFactor = 0.99;

  let threshold = racePace * thresholdFactor;
  if (difficulty === "easy") threshold *= 1.01;
  if (difficulty === "hard") threshold *= 0.99;

  const out = {
    distanceKm,
    racePaceSecPerKm: clampPaceSec(racePace),
    thresholdPaceSecPerKm: clampPaceSec(threshold),
    easyPaceSecPerKm: clampPaceSec(threshold * 1.32),
    tempoPaceSecPerKm: clampPaceSec(threshold * 1.01),
    intervalPaceSecPerKm: clampPaceSec(distanceKm <= 10.01 ? racePace * 0.94 : racePace * 0.96),
  };

  if (
    !out.racePaceSecPerKm ||
    !out.thresholdPaceSecPerKm ||
    !out.easyPaceSecPerKm ||
    !out.tempoPaceSecPerKm ||
    !out.intervalPaceSecPerKm
  ) {
    return null;
  }

  return out;
}

function uniqueInOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function cleanFirestoreValue(value, { inArray = false } = {}) {
  if (value === undefined) return inArray ? null : undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => cleanFirestoreValue(item, { inArray: true }));
  }
  if (Object.prototype.toString.call(value) === "[object Object]") {
    return Object.entries(value).reduce((acc, [key, child]) => {
      const cleaned = cleanFirestoreValue(child);
      if (cleaned !== undefined) acc[key] = cleaned;
      return acc;
    }, {});
  }
  return value;
}

function ageFromDate(birthDate) {
  if (!(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) years -= 1;
  return years;
}

function pickRunDaysFromAvailability({ availableDays, sessionsPerWeek, longRunDay }) {
  const n = clampInt(sessionsPerWeek, 2, 7);
  const available = uniqueInOrder((availableDays || []).filter((d) => DAY_ORDER.includes(d))).sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)
  );
  const defaults = DEFAULT_RUN_DAYS_BY_N[n] || DAY_ORDER.slice(0, n);

  const out = [];
  if (longRunDay && longRunDay !== "Any" && available.includes(longRunDay)) out.push(longRunDay);

  for (const d of defaults) {
    if (available.includes(d) && !out.includes(d)) out.push(d);
    if (out.length >= n) break;
  }

  if (out.length < n) {
    for (const d of available) {
      if (!out.includes(d)) out.push(d);
      if (out.length >= n) break;
    }
  }

  if (out.length < n) {
    for (const d of defaults) {
      if (!out.includes(d)) out.push(d);
      if (out.length >= n) break;
    }
  }

  if (out.length < n) {
    for (const d of DAY_ORDER) {
      if (!out.includes(d)) out.push(d);
      if (out.length >= n) break;
    }
  }

  return out.slice(0, n).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function normaliseDifficultyForApi(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "conservative" || raw === "easy") return "easy";
  if (raw === "aggressive" || raw === "hard") return "hard";
  return "balanced";
}

function isRunPlanDoc(data) {
  const kind = String(data?.kind || data?.plan?.kind || "").toLowerCase();
  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  const primaryActivity = String(
    data?.meta?.primaryActivity || data?.primaryActivity || data?.plan?.primaryActivity || ""
  ).toLowerCase();
  return kind === "run" || source.includes("run") || primaryActivity.includes("run");
}

/* ------------------------------------------------------------------ */
/* PLAN NORMALISER                                                    */
/* ------------------------------------------------------------------ */

function normaliseSessionForUI(s) {
  const sourceType = String(s?.type || s?.sessionType || "").trim();
  const sourceTypeLower = sourceType.toLowerCase();
  const workoutSportRaw = String(s?.workout?.sport || "").toLowerCase();

  const isStrengthLike =
    workoutSportRaw.includes("strength") ||
    workoutSportRaw.includes("gym") ||
    sourceTypeLower.includes("strength") ||
    sourceTypeLower.includes("gym");

  const isRunLike =
    !isStrengthLike &&
    (workoutSportRaw.includes("run") ||
      sourceTypeLower.includes("run") ||
      [
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
      ].includes(sourceTypeLower));

  const km =
    typeof s?.distanceKm === "number"
      ? s.distanceKm
      : typeof s?.distance === "number"
      ? s.distance
      : typeof s?.plannedDistanceKm === "number"
      ? s.plannedDistanceKm
      : typeof s?.distanceMeters === "number"
      ? s.distanceMeters / 1000
      : null;

  const distanceKm = km != null && Number.isFinite(km) ? Math.round(km * 10) / 10 : undefined;
  const displaySteps = Array.isArray(s?.workoutSteps)
    ? s.workoutSteps
    : Array.isArray(s?.workout?.workoutSteps)
    ? s.workout.workoutSteps
    : [];
  const rootSteps = Array.isArray(s?.steps) ? s.steps : [];
  const workoutSteps = Array.isArray(s?.workout?.steps) ? s.workout.steps : [];
  const steps = displaySteps.length ? displaySteps : rootSteps.length ? rootSteps : workoutSteps;

  const workout = {
    ...(s?.workout || {}),
    sport: s?.workout?.sport || (isRunLike ? "run" : isStrengthLike ? "strength" : "training"),
    steps,
  };

  const title =
    s?.title ||
    s?.name ||
    (sourceType
      ? sourceType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      : "Session");

  return {
    ...s,
    title,
    name: s?.name || title,
    type: sourceType || (isRunLike ? "RUN" : isStrengthLike ? "STRENGTH" : "TRAINING"),
    sessionType: isRunLike ? "run" : isStrengthLike ? "gym" : (s?.sessionType || "training"),
    notes: s?.notes || "",
    day: s?.day || undefined,
    steps,
    workout,
    targetDurationMin:
      s?.targetDurationMin ??
      (Number.isFinite(Number(workout?.totalDurationSec))
        ? Math.round(Number(workout.totalDurationSec) / 60)
        : undefined),
    targetDistanceKm:
      s?.targetDistanceKm ??
      (distanceKm != null
        ? distanceKm
        : Number.isFinite(Number(workout?.totalDistanceKm))
        ? Number(Number(workout.totalDistanceKm).toFixed(1))
        : undefined),
    ...(distanceKm != null
      ? {
          distanceKm,
          distance: distanceKm,
          plannedDistanceKm: distanceKm,
          distanceMeters: Math.round(distanceKm * 1000),
        }
      : {}),
  };
}

function weekToDays(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const byDay = new Map();

  for (const raw of sessions) {
    const s = normaliseSessionForUI(raw);
    const d = s?.day;
    if (!d) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }

  return DAY_ORDER.map((day) => {
    const daySessions = byDay.get(day) || [];
    return {
      day,
      sessions: daySessions,
      title: daySessions[0]?.name || "Rest / no structured session",
    };
  });
}

function normaliseGeneratedPlanForApp(generatedPlan) {
  const plan = generatedPlan || {};
  const weeksRaw = Array.isArray(plan?.weeks) ? plan.weeks : [];

  const flattenSessionsFromDays = (daysArr) => {
    const days = Array.isArray(daysArr) ? daysArr : [];
    const all = [];
    for (const d of days) {
      const dayKey = d?.day;
      const ds = Array.isArray(d?.sessions) ? d.sessions : [];
      for (const s of ds) {
        const norm = normaliseSessionForUI(s);
        all.push({ ...norm, day: norm.day || dayKey || "Mon" });
      }
    }
    return all;
  };

  const weeks = weeksRaw.map((w, idx) => {
    const weekIndex0 =
      typeof w?.weekIndex0 === "number"
        ? w.weekIndex0
        : typeof w?.weekIndex === "number"
        ? w.weekIndex
        : idx;

    const sessionsRaw = Array.isArray(w?.sessions) ? w.sessions : [];
    const derivedFromDays =
      !sessionsRaw.length && Array.isArray(w?.days) && w.days.length
        ? flattenSessionsFromDays(w.days)
        : [];

    const sessions = (sessionsRaw.length ? sessionsRaw : derivedFromDays).map(normaliseSessionForUI);
    const hasPreservedTemplateSessions = sessions.some((s) =>
      Boolean(
        s?.preserveTemplateStructure ||
          s?.meta?.preserveTemplateStructure ||
          s?.workout?.preserveTemplateStructure ||
          s?.workout?.meta?.preserveTemplateStructure
      )
    );

    const days =
      hasPreservedTemplateSessions
        ? weekToDays({ ...w, sessions })
        : Array.isArray(w?.days) && w.days.length
        ? w.days.map((d) => ({
            ...d,
            day: d?.day,
            sessions: Array.isArray(d?.sessions)
              ? d.sessions.map((s) => normaliseSessionForUI({ ...s, day: s?.day || d?.day }))
              : [],
          }))
        : weekToDays({ ...w, sessions });

    const { weekIndex, weekNumber, ...restW } = w || {};

    return {
      ...restW,
      weekIndex0,
      weekNumber: weekIndex0 + 1,
      sessions,
      days,
    };
  });

  const { debug, ...restPlan } = plan || {};

  return {
    ...restPlan,
    name: restPlan?.name || "Run plan",
    weeks,
  };
}

function stripRawDebugFields(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripRawDebugFields);

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (RAW_DEBUG_PLAN_FIELDS.has(key)) continue;
    out[key] = stripRawDebugFields(child);
  }
  return out;
}

function buildGeneratedPlanVersionFields(generatedPlan, athleteProfile) {
  const generatedAt =
    typeof generatedPlan?.generatedAt === "string" && generatedPlan.generatedAt.trim()
      ? generatedPlan.generatedAt
      : new Date().toISOString();

  return {
    planSource: generatedPlan?.planSource || "rules_engine",
    templateId: generatedPlan?.templateId || null,
    templateVersion: generatedPlan?.templateVersion || (generatedPlan?.templateId ? TEMPLATE_VERSION : null),
    planVersion: generatedPlan?.planVersion || RUN_PLAN_VERSION,
    rulesEngineVersion: generatedPlan?.rulesEngineVersion || RULES_ENGINE_VERSION,
    generatedAt,
    inputProfileSnapshot: generatedPlan?.inputProfileSnapshot || athleteProfile || null,
    generatorFeatures: generatedPlan?.generatorFeatures || null,
    validationSummary: generatedPlan?.validationSummary || null,
    goalRealism: generatedPlan?.goalRealism || null,
    paceModel: generatedPlan?.paceModel || null,
    planExplanation: generatedPlan?.planExplanation || null,
    weeklyRecalculation: generatedPlan?.weeklyRecalculation || null,
    readinessAdjustment: generatedPlan?.readinessAdjustment || null,
    strengthAdjustment: generatedPlan?.strengthAdjustment || null,
    missedSessionRepair: generatedPlan?.missedSessionRepair || null,
  };
}

/* ------------------------------------------------------------------ */
/* THEME + UI                                                         */
/* ------------------------------------------------------------------ */

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    isDark,
    bg: isDark ? "#050506" : "#F5F5F7",
    card: isDark ? "#111217" : "#FFFFFF",
    cardSoft: isDark ? "#0B0C10" : SILVER_LIGHT,
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: colors?.border ?? (isDark ? "rgba(255,255,255,0.10)" : SILVER_MEDIUM),
    muted: colors?.muted || (isDark ? "#18181B" : "#E5E7EB"),
    primaryBg: PRIMARY,
    primaryText: "#111111",
    pillBg: isDark ? "#111217" : "#FFFFFF",
    danger: "#ef4444",
    warnBg: isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.07)",
    ok: "#22c55e",
    accent: PRIMARY,
    accentSoft: isDark ? "rgba(230,255,59,0.15)" : "rgba(230,255,59,0.12)",
    progressTrack: isDark ? "rgba(230,255,59,0.22)" : "rgba(230,255,59,0.30)",
  };
}

function Chip({ label, active, onPress, style, disabled, theme, compact }) {
  const bg = active ? theme.primaryBg : theme.pillBg;
  const fg = active ? theme.primaryText : theme.text;

  return (
    <TouchableOpacity
      onPress={disabled ? undefined : onPress}
      activeOpacity={0.85}
      style={[
        styles.chip,
        compact && styles.chipCompact,
        {
          backgroundColor: bg,
          borderColor: active ? "rgba(0,0,0,0.12)" : theme.border,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          compact && { fontSize: 12 },
          { color: fg, fontWeight: active ? "800" : "700" },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title, subtitle, right, theme }) {
  return (
    <View style={{ marginBottom: 16, alignItems: "center" }}>
      <View style={{ width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
        <Text style={[styles.sectionTitle, { color: theme.subtext, textAlign: "center" }]}>{title}</Text>
        {right ? <View style={{ position: "absolute", right: 0 }}>{right}</View> : null}
      </View>
      {subtitle ? (
        <Text style={[styles.sectionPrompt, { color: theme.text, textAlign: "center" }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

function Divider({ theme }) {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.border,
        opacity: theme.isDark ? 0.8 : 1,
        marginVertical: 10,
      }}
    />
  );
}

function TimeWheelColumn({ values, selectedValue, onChange, suffix, theme }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const index = Math.max(0, values.findIndex((value) => value === selectedValue));
    scrollRef.current?.scrollTo({ y: index * TIME_WHEEL_ITEM_HEIGHT, animated: false });
  }, [selectedValue, values]);

  const settleSelection = (event) => {
    const y = event?.nativeEvent?.contentOffset?.y || 0;
    const rawIndex = Math.round(y / TIME_WHEEL_ITEM_HEIGHT);
    const index = Math.max(0, Math.min(values.length - 1, rawIndex));
    const nextValue = values[index];
    if (nextValue !== selectedValue) onChange(nextValue);
    scrollRef.current?.scrollTo({ y: index * TIME_WHEEL_ITEM_HEIGHT, animated: true });
  };

  return (
    <View
      style={[
        styles.timeWheelColumn,
        { height: TIME_WHEEL_ITEM_HEIGHT * TIME_WHEEL_VISIBLE_ITEMS },
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.timeWheelHighlight,
          {
            top: TIME_WHEEL_ITEM_HEIGHT * 2,
            height: TIME_WHEEL_ITEM_HEIGHT,
            backgroundColor: theme.isDark ? "#242424" : "#E5E7EB",
          },
        ]}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={TIME_WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        onMomentumScrollEnd={settleSelection}
        onScrollEndDrag={settleSelection}
        contentContainerStyle={{
          paddingVertical: TIME_WHEEL_ITEM_HEIGHT * 2,
        }}
      >
        {values.map((value) => {
          const active = value === selectedValue;
          const distance = Math.abs(value - selectedValue);
          return (
            <TouchableOpacity
              key={`${suffix}-${value}`}
              activeOpacity={0.85}
              onPress={() => onChange(value)}
              style={styles.timeWheelItem}
            >
              <Text
                style={[
                  styles.timeWheelText,
                  {
                    color: active ? theme.text : theme.subtext,
                    opacity: active ? 1 : distance === 1 ? 0.48 : 0.22,
                    fontWeight: active ? "900" : "800",
                  },
                ]}
              >
                {value}
                {suffix}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function OptionRow({
  title,
  subtitle,
  active,
  onPress,
  theme,
  disabled = false,
  right,
  leftIcon,
}) {
  return (
    <TouchableOpacity
      onPress={disabled ? undefined : onPress}
      activeOpacity={0.9}
      style={[
        styles.optionRow,
        {
          borderColor: active ? theme.accent : theme.border,
          backgroundColor: theme.cardSoft,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {leftIcon ? (
        <View style={[styles.optionIconWrap, { borderColor: active ? theme.accent : theme.border }]}>
          <Feather name={leftIcon} size={16} color={active ? theme.accent : theme.subtext} />
        </View>
      ) : null}
      <View style={styles.optionTextBlock}>
        <Text style={[styles.optionTitle, { color: theme.text }]}>{title}</Text>
        {!!subtitle ? <Text style={[styles.optionSubtitle, { color: theme.subtext }]}>{subtitle}</Text> : null}
      </View>
      {right ? (
        <View style={styles.optionRightSlot}>{right}</View>
      ) : (
        <View
          style={[
            styles.optionTick,
            styles.optionRightSlot,
            {
              borderColor: active ? theme.accent : theme.border,
              backgroundColor: active ? theme.accent : "transparent",
            },
          ]}
        >
          {active ? <Feather name="check" size={14} color="#0B1215" /> : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* MAIN                                                               */
/* ------------------------------------------------------------------ */

export default function CreateRunPlan() {
  const theme = useScreenTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;

  const initialStep = useMemo(() => {
    const raw = params?.step;
    if (!raw) return 0;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n < STEPS.length ? n : 0;
  }, [params?.step]);

  const [step, setStep] = useState(initialStep);

  const [goalType, setGoalType] = useState("race");
  const [goalDistance, setGoalDistance] = useState("10K");
  const [goalCustomDistance, setGoalCustomDistance] = useState("");
  const [targetEventName, setTargetEventName] = useState("");

  const [planStartDate, setPlanStartDate] = useState(new Date());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [raceDate, setRaceDate] = useState(null);
  const [showRaceDatePicker, setShowRaceDatePicker] = useState(false);
  const [planLengthWeeks, setPlanLengthWeeks] = useState(12);

  const [goalTimeEnabled, setGoalTimeEnabled] = useState(false);
  const [goalTimeInput, setGoalTimeInput] = useState("50:00");

  const [experienceLevel, setExperienceLevel] = useState("Some experience");
  const [birthDate, setBirthDate] = useState(null);
  const [showBirthDatePicker, setShowBirthDatePicker] = useState(false);
  const [gender, setGender] = useState(null);
  const [currentWeeklyDistance, setCurrentWeeklyDistance] = useState("");
  const [currentLongestRunDistance, setCurrentLongestRunDistance] = useState("");
  const [showPaceDetails, setShowPaceDetails] = useState(false);
  const [thresholdPacePerKm, setThresholdPacePerKm] = useState("");
  const [fiveKTime, setFiveKTime] = useState("");
  const [tenKTime, setTenKTime] = useState("");

  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [runDays, setRunDays] = useState(DEFAULT_RUN_DAYS_BY_N[4]);
  const [longRunDay, setLongRunDay] = useState("Sun");
  const [difficulty, setDifficulty] = useState("Balanced");

  const [loading, setLoading] = useState(false);

  const goalPrimaryFocus = useMemo(() => {
    switch (goalType) {
      case "start":
        return "Build consistency";
      case "return":
        return "Return safely";
      case "improve5k":
        return "PB / time goal";
      case "general":
        return "General fitness";
      default:
        return "PB / time goal";
    }
  }, [goalType]);

  const normalisedGoalDistance = useMemo(() => {
    if (goalType === "start") return "General fitness";
    if (goalType === "return") return "Return from injury";
    if (goalType === "improve5k") return "5K";
    if (goalType === "general") return "General fitness";
    if (goalDistance === "Other") return goalCustomDistance.trim() || null;
    return goalDistance;
  }, [goalType, goalDistance, goalCustomDistance]);

  const effectiveStartDate = formatDateYYYYMMDD(planStartDate);
  const effectiveTargetDate = raceDate ? formatDateYYYYMMDD(raceDate) : null;
  const hasTargetDate = !!raceDate;
  const goalTargetTimeSec = goalTimeEnabled ? parseDurationToSeconds(goalTimeInput) || 0 : 0;
  const goalTargetTimeValue = goalTimeEnabled ? formatGoalTimeString(goalTargetTimeSec) : "";
  const goalTimeParts = useMemo(() => {
    const total = Math.max(0, goalTargetTimeSec || parseDurationToSeconds(goalTimeInput) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return { hours, minutes, seconds };
  }, [goalTargetTimeSec, goalTimeInput]);

  const goalAveragePace = useMemo(() => {
    const km = goalDistanceToKm(normalisedGoalDistance);
    if (!Number.isFinite(km) || km <= 0 || !goalTargetTimeSec) return "";
    return formatPacePerKm(goalTargetTimeSec / km);
  }, [normalisedGoalDistance, goalTargetTimeSec]);

  const setGoalTimePart = (part, value) => {
    const next = {
      hours: goalTimeParts.hours,
      minutes: goalTimeParts.minutes,
      seconds: goalTimeParts.seconds,
      [part]: value,
    };
    const total = next.hours * 3600 + next.minutes * 60 + next.seconds;
    setGoalTimeInput(formatGoalTimeString(total));
  };
  const timelineDatesValid =
    !hasTargetDate ||
    !raceDate ||
    !planStartDate ||
    planStartDate.getTime() <= raceDate.getTime();

  const computedWeeks = useMemo(() => {
    if (hasTargetDate && raceDate instanceof Date) {
      return weeksBetweenDates(planStartDate || new Date(), raceDate) || 12;
    }
    return Number(planLengthWeeks) || 12;
  }, [hasTargetDate, raceDate, planStartDate, planLengthWeeks]);

  const weeklyDistanceInput = String(currentWeeklyDistance || "").trim();
  const weeklyDistanceValue = Number(weeklyDistanceInput);
  const allowsZeroWeeklyDistance = goalType === "start" || goalType === "return" || goalType === "general";
  const hasValidWeeklyDistance =
    weeklyDistanceInput.length > 0 &&
    Number.isFinite(weeklyDistanceValue) &&
    (weeklyDistanceValue > 0 || (allowsZeroWeeklyDistance && weeklyDistanceValue >= 0));
  const longestRunInput = String(currentLongestRunDistance || "").trim();
  const longestRunValue = Number(longestRunInput);
  const hasValidLongestRunDistance =
    longestRunInput.length > 0 &&
    Number.isFinite(longestRunValue) &&
    (longestRunValue > 0 || (allowsZeroWeeklyDistance && longestRunValue >= 0));

  const birthAgeYears = useMemo(() => ageFromDate(birthDate), [birthDate]);

  useEffect(() => {
    const n = clampInt(daysPerWeek, 2, 7);
    const defaultDays = DEFAULT_RUN_DAYS_BY_N[n] || DEFAULT_RUN_DAYS_BY_N[4];

    setRunDays((prev) => {
      const prevUniq = uniqueInOrder((prev || []).filter((d) => DAY_ORDER.includes(d)));
      let next = [...prevUniq];

      if (next.length < n) {
        const fill = defaultDays.filter((d) => !next.includes(d));
        next = [...next, ...fill];
      }

      next.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
      return next;
    });
  }, [daysPerWeek]);

  useEffect(() => {
    if (goalType === "improve5k") setGoalDistance("5K");
    if (goalType === "start") setGoalDistance("General fitness");
    if (goalType === "return") setGoalDistance("Return from injury");
    if (goalType === "general") setGoalDistance("General fitness");
  }, [goalType]);

  useEffect(() => {
    setLongRunDay((prev) => {
      if (runDays.includes(prev)) return prev;
      if (runDays.includes("Sun")) return "Sun";
      if (runDays.length) return runDays[runDays.length - 1];
      return "Sun";
    });
  }, [runDays]);

  const orderedRunDays = useMemo(() => {
    const uniq = uniqueInOrder((runDays || []).filter((d) => DAY_ORDER.includes(d)));
    return uniq.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  }, [runDays]);

  const canSubmit = useMemo(() => {
    const hasEnoughAvailableDays = orderedRunDays.length >= clampInt(daysPerWeek, 2, 7);
    const longDayOk = orderedRunDays.includes(longRunDay);
    const goalOk = Boolean(goalType && normalisedGoalDistance && experienceLevel && daysPerWeek);
    const lengthOk = !hasTargetDate ? !!planLengthWeeks : true;
    const goalTimeOk = !goalTimeEnabled || goalTargetTimeSec > 0;
    const difficultyOk = Boolean(difficulty);
    const birthdayOk = Boolean(birthAgeYears != null && birthAgeYears >= 18);

    return Boolean(
      goalOk &&
        hasValidWeeklyDistance &&
        hasValidLongestRunDistance &&
        hasEnoughAvailableDays &&
        longDayOk &&
        birthdayOk &&
        lengthOk &&
        timelineDatesValid &&
        goalTimeOk &&
        difficultyOk
    );
  }, [
    goalType,
    normalisedGoalDistance,
    experienceLevel,
    daysPerWeek,
    orderedRunDays,
    longRunDay,
    hasValidWeeklyDistance,
    hasValidLongestRunDistance,
    birthAgeYears,
    hasTargetDate,
    planLengthWeeks,
    timelineDatesValid,
    goalTimeEnabled,
    goalTargetTimeSec,
    difficulty,
  ]);

  const lowFrequencyGoalWarning = useMemo(
    () => getLowFrequencyGoalWarning(normalisedGoalDistance, daysPerWeek),
    [normalisedGoalDistance, daysPerWeek]
  );

  useEffect(() => {
    const selectedRaceNameRaw = params?.selectedRaceName;
    const selectedRaceDateRaw = params?.selectedRaceDate;
    const selectedRaceDistanceRaw = params?.selectedRaceDistance;

    const selectedRaceName = Array.isArray(selectedRaceNameRaw) ? selectedRaceNameRaw[0] : selectedRaceNameRaw;
    const selectedRaceDate = Array.isArray(selectedRaceDateRaw) ? selectedRaceDateRaw[0] : selectedRaceDateRaw;
    const selectedRaceDistance = Array.isArray(selectedRaceDistanceRaw)
      ? selectedRaceDistanceRaw[0]
      : selectedRaceDistanceRaw;

    if (!selectedRaceName && !selectedRaceDate && !selectedRaceDistance) return;

    setGoalType("race");

    if (selectedRaceName && typeof selectedRaceName === "string") {
      setTargetEventName(selectedRaceName);
    }

    if (selectedRaceDate && typeof selectedRaceDate === "string" && selectedRaceDate.length >= 8) {
      const parts = selectedRaceDate.split("-");
      if (parts.length >= 3) {
        const y = Number(parts[0]);
        const m = Number(parts[1]) - 1;
        const d = Number(parts[2]);
        const parsed = new Date(y, m, d);
        if (!Number.isNaN(parsed.getTime())) setRaceDate(parsed);
      }
    }

    if (selectedRaceDistance && typeof selectedRaceDistance === "string") {
      if (GOAL_DISTANCE_OPTIONS.includes(selectedRaceDistance)) {
        setGoalDistance(selectedRaceDistance);
      } else {
        setGoalDistance("Other");
        setGoalCustomDistance(selectedRaceDistance);
      }
    }
  }, [params?.selectedRaceName, params?.selectedRaceDate, params?.selectedRaceDistance]);

  const isStepValid = (s) => {
    switch (s) {
      case 0:
        return Boolean(goalType);
      case 1: {
        const needsLength = !hasTargetDate;
        const lengthOk = needsLength ? !!planLengthWeeks : true;
        const distanceOk = Boolean(normalisedGoalDistance);
        return Boolean(lengthOk && timelineDatesValid && distanceOk);
      }
      case 2:
        return !goalTimeEnabled || (Number.isFinite(goalTargetTimeSec) && goalTargetTimeSec > 0);
      case 3:
        return Boolean(experienceLevel);
      case 4:
        return Boolean(birthAgeYears != null && birthAgeYears >= 18);
      case 5:
        return true;
      case 6:
        return hasValidWeeklyDistance;
      case 7:
        return hasValidLongestRunDistance;
      case 8:
        return Boolean(daysPerWeek);
      case 9:
        return orderedRunDays.length >= clampInt(daysPerWeek, 2, 7);
      case 10:
        return orderedRunDays.includes(longRunDay);
      case 11:
        return Boolean(difficulty);
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!isStepValid(step)) {
      Alert.alert("More info needed", "Please complete this section before continuing.");
      return;
    }
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handleBack = () => setStep((prev) => Math.max(prev - 1, 0));

  const confirmReplaceActivePlan = async (uid) => {
    try {
      const plansRef = collection(db, "users", uid, "plans");
      const snap = await getDocs(query(plansRef, orderBy("updatedAt", "desc"), limit(25)));
      if (snap.empty) return true;

      const hasExistingRunPlan = snap.docs.some((d) => isRunPlanDoc(d.data() || {}));
      if (!hasExistingRunPlan) return true;

      return await new Promise((resolve) => {
        Alert.alert(
          "Replace existing run plan?",
          "You already have a run plan. Creating another run plan may replace the currently shown run block, but your strength plan will stay available.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Replace", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      });
    } catch (e) {
      console.log("[create-run] failed to check existing plans:", e);
      return true;
    }
  };

  const confirmLowFrequencyGoal = async (warning) => {
    if (!warning?.message) return true;
    return await new Promise((resolve) => {
      Alert.alert(
        "Check run frequency",
        warning.message,
        [
          { text: "Go back", style: "cancel", onPress: () => resolve(false) },
          { text: "Continue anyway", onPress: () => resolve(true) },
        ]
      );
    });
  };

  async function generateRunPlanOnServer(athleteProfile, options = {}) {
    const query = new URLSearchParams({ allowDefaults: "1" });
    if (options.allowGoalRisk) query.set("allowGoalRisk", "1");
    const path = `/generate-run?${query.toString()}`;
    const baseApiUrl = String(API_URL || "").replace(/\/$/, "");
    const authHeaders = await getJsonAuthHeaders();

    const candidates = [];
    const pushUrl = (u) => {
      if (!u) return;
      if (!candidates.includes(u)) candidates.push(u);
    };

    try {
      const parsed = new URL(baseApiUrl);

      if ((parsed.port || "") === "3001") {
        const preferred = new URL(baseApiUrl);
        preferred.port = "3101";
        pushUrl(`${String(preferred).replace(/\/$/, "")}${path}`);
      }

      pushUrl(`${baseApiUrl}${path}`);

      for (const port of ["3101", "3001"]) {
        if ((parsed.port || "") === port) continue;
        const alt = new URL(baseApiUrl);
        alt.port = port;
        pushUrl(`${String(alt).replace(/\/$/, "")}${path}`);
      }
    } catch {
      pushUrl(`${baseApiUrl}${path}`);
    }

    let lastError = null;

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ athleteProfile }),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          let details = txt;

          try {
            const parsed = JSON.parse(txt || "{}");
            const msg = parsed?.error || "";
            const list = Array.isArray(parsed?.details) ? parsed.details.join(" ") : "";
            details = `${msg}${list ? ` ${list}` : ""}`.trim() || txt;
          } catch {}

          lastError = new Error(
            `Plan generation failed (HTTP ${res.status})${details ? `: ${details}` : ""}`
          );
          continue;
        }

        const data = await res.json();
        if (!data?.plan) {
          lastError = new Error("Plan generation returned no plan.");
          continue;
        }

        return data.plan;
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError || new Error("Plan generation failed.");
  }

  const handleGenerate = async () => {
    if (!canSubmit) {
      Alert.alert("More info needed", "Please complete all essential questions before generating.");
      return;
    }

    const uid = user?.uid;
    if (!uid) {
      Alert.alert("Not signed in", "You need to be logged in to save a training plan.");
      return;
    }

    const okToReplace = await confirmReplaceActivePlan(uid);
    if (!okToReplace) return;

    const okWithFrequency = await confirmLowFrequencyGoal(lowFrequencyGoalWarning);
    if (!okWithFrequency) return;

    if (!timelineDatesValid) {
      Alert.alert("Invalid timeline", "Your plan start date must be on or before your race date.");
      return;
    }

    if (goalTimeEnabled && goalTargetTimeSec <= 0) {
      Alert.alert("Invalid goal time", "Goal time must be in mm:ss or hh:mm:ss.");
      return;
    }

    if (birthAgeYears == null || birthAgeYears < 18) {
      Alert.alert("Age requirement", "You must be 18 or older to generate this plan.");
      return;
    }

    const thresholdPaceSecPerKm = thresholdPacePerKm.trim()
      ? parsePaceSecPerKm(thresholdPacePerKm)
      : null;

    if (thresholdPacePerKm.trim() && !thresholdPaceSecPerKm) {
      Alert.alert("Invalid pace", "Threshold pace must be in mm:ss per km, for example 4:45.");
      return;
    }

    const fiveKTimeSec = fiveKTime.trim() ? parseDurationToSeconds(fiveKTime) : null;
    if (fiveKTime.trim() && !fiveKTimeSec) {
      Alert.alert("Invalid 5K time", "Use mm:ss or hh:mm:ss, for example 24:30.");
      return;
    }

    const tenKTimeSec = tenKTime.trim() ? parseDurationToSeconds(tenKTime) : null;
    if (tenKTime.trim() && !tenKTimeSec) {
      Alert.alert("Invalid 10K time", "Use mm:ss or hh:mm:ss, for example 52:10.");
      return;
    }

    const runsPerWeekNum = clampInt(daysPerWeek, 2, 7);
    const selectedAvailability = uniqueInOrder((runDays || []).filter((d) => DAY_ORDER.includes(d)));

    if (selectedAvailability.length < runsPerWeekNum) {
      Alert.alert(
        "Select more available days",
        `Choose at least ${runsPerWeekNum} available day${runsPerWeekNum === 1 ? "" : "s"} to continue.`
      );
      return;
    }

    const filledRunDays = pickRunDaysFromAvailability({
      availableDays: selectedAvailability,
      sessionsPerWeek: runsPerWeekNum,
      longRunDay,
    });

    const resolvedLongRunDay =
      filledRunDays.includes(longRunDay)
        ? longRunDay
        : filledRunDays.includes("Sun")
        ? "Sun"
        : filledRunDays[filledRunDays.length - 1] || "Sun";

    const pickedTemplateId = pickStockTemplateId({
      distance: normalisedGoalDistance,
      weeks: computedWeeks,
      runs: runsPerWeekNum,
    });

    const pickedTemplate = pickedTemplateId
      ? STOCK_TEMPLATE_INDEX.find((t) => t.id === pickedTemplateId) || null
      : null;

    const targetEventDate = hasTargetDate && effectiveTargetDate ? effectiveTargetDate : null;
    const difficultyApi = normaliseDifficultyForApi(difficulty);

    const goalTimePaces = goalTimeEnabled
      ? derivePaceTargetsFromGoalTime({
          goalDistance: normalisedGoalDistance,
          goalTargetTimeSec,
          difficulty: difficultyApi,
        })
      : null;

    const resolvedThresholdPaceSecPerKm =
      thresholdPaceSecPerKm || goalTimePaces?.thresholdPaceSecPerKm || null;

    const planQuality = difficultyApi === "easy" ? "standard" : "high";
    const weeklyBaselineKm =
      goalType === "return" ? 4 : goalType === "start" ? 6 : goalType === "general" ? 8 : 0;
    const weeklyKmRaw = hasValidWeeklyDistance ? weeklyDistanceValue : 0;
    const weeklyKmNum = Math.round(Math.max(weeklyKmRaw, weeklyBaselineKm) * 10) / 10;
    const longestRunKmNum = Math.round(Math.max(0, longestRunValue || 0) * 10) / 10;

    const athleteProfile = {
      goal: {
        type: goalType,
        distance: normalisedGoalDistance,
        primaryFocus: goalPrimaryFocus,
        eventName: targetEventName || "",
        startDate: effectiveStartDate,
        anchorDateMode: "start",
        targetDate: targetEventDate,
        eventDate: targetEventDate,
        targetTime: goalTargetTimeValue || null,
        planLengthWeeks: Number(computedWeeks) || Number(planLengthWeeks) || 12,
      },
      availability: {
        sessionsPerWeek: runsPerWeekNum,
        runDays: filledRunDays,
        longRunDay: resolvedLongRunDay,
        difficulty: difficultyApi,
        notes: "",
      },
      current: {
        weeklyKm: weeklyKmNum,
        longestRunKm: longestRunKmNum,
        experience: experienceLevel,
        age: birthAgeYears,
        recentTimes: {
          fiveK: fiveKTimeSec ? String(fiveKTime.trim()) : "",
          tenK: tenKTimeSec ? String(tenKTime.trim()) : "",
          half: "",
          marathon: "",
        },
        recentRace: null,
      },
      preferences: {
        difficulty: difficultyApi,
        trainingFocus:
          goalType === "improve5k"
            ? "speed"
            : goalType === "start"
            ? "consistency"
            : goalType === "return"
            ? "durability"
            : "balanced",
        planQuality,
        metric: "time",
        surfaces: ["Road"],
        focusAreas: [],
        profile: {
          gender: gender || null,
          birthDate: birthDate ? formatDateYYYYMMDD(birthDate) : null,
        },
        injuries: "",
        constraints: "",
        treadmill: "No",
        gymAccess: "Yes",
        crossTrainingPreference: "Some",
      },
      pacing: resolvedThresholdPaceSecPerKm
        ? {
            thresholdPaceSecPerKm: resolvedThresholdPaceSecPerKm,
            easyPaceSecPerKm: goalTimePaces?.easyPaceSecPerKm || null,
            tempoPaceSecPerKm: goalTimePaces?.tempoPaceSecPerKm || null,
            intervalPaceSecPerKm: goalTimePaces?.intervalPaceSecPerKm || null,
            racePaceSecPerKm: goalTimePaces?.racePaceSecPerKm || null,
            recentRace:
              goalTimeEnabled && goalTimePaces?.distanceKm
                ? {
                    distance: normalisedGoalDistance,
                    distanceKm: goalTimePaces.distanceKm,
                    timeSec: goalTargetTimeSec,
                  }
                : null,
          }
        : goalTimeEnabled && goalTimePaces?.distanceKm
        ? {
            thresholdPaceSecPerKm: resolvedThresholdPaceSecPerKm,
            easyPaceSecPerKm: goalTimePaces.easyPaceSecPerKm,
            tempoPaceSecPerKm: goalTimePaces.tempoPaceSecPerKm,
            intervalPaceSecPerKm: goalTimePaces.intervalPaceSecPerKm,
            racePaceSecPerKm: goalTimePaces.racePaceSecPerKm,
            recentRace: {
              distance: normalisedGoalDistance,
              distanceKm: goalTimePaces.distanceKm,
              timeSec: goalTargetTimeSec,
            },
          }
        : {},
      hr: {},
      templateId: pickedTemplateId || null,
      templateMeta: pickedTemplateId
        ? {
            distance: pickedTemplate?.distance || normalisedGoalDistance,
            weeks: pickedTemplate?.weeks || computedWeeks,
            runs: pickedTemplate?.runs || runsPerWeekNum,
            requestedWeeks: computedWeeks,
          }
        : null,
    };

    setLoading(true);
    try {
      const generatedPlanRaw = await generateRunPlanOnServer(athleteProfile, {
        allowGoalRisk: Boolean(lowFrequencyGoalWarning),
      });
      const generatedPlan = normaliseGeneratedPlanForApp(generatedPlanRaw);
      const planVersionFields = buildGeneratedPlanVersionFields(generatedPlan, athleteProfile);
      const planForSave = stripRawDebugFields({
        ...generatedPlan,
        ...planVersionFields,
      });

      const weeksCount = planForSave?.weeks?.length || 0;
      const week0 = planForSave?.weeks?.[0];

      const week0Sessions =
        (week0?.sessions?.length || 0) +
        (Array.isArray(week0?.days)
          ? week0.days.reduce((sum, d) => sum + (d?.sessions?.length || 0), 0)
          : 0);

      if (!weeksCount || !week0Sessions) {
        console.log("[create-run] EMPTY PLAN RETURNED", { weeksCount, week0Sessions, generatedPlan: planForSave });
        throw new Error("Your plan generator returned an empty schedule. The plan was not saved.");
      }

      const professionalReview = planForSave?.professionalReview || planForSave?.meta?.professionalReview || null;
      if (professionalReview?.status === "not_approved") {
        const firstIssue = Array.isArray(professionalReview.issues) ? professionalReview.issues[0] : null;
        throw new Error(
          firstIssue?.recommendation ||
            firstIssue?.message ||
            "This plan failed professional training guardrails. Adjust the goal, weekly volume, or run frequency and try again."
        );
      }

      const metaName = targetEventName
        ? `${targetEventName} – ${normalisedGoalDistance}`
        : `${normalisedGoalDistance} plan`;

      const planDoc = withPlanAdaptationDefaults({
        kind: "run",
        source: "generate-run",
        status: "generated",
        startDate: effectiveStartDate,
        weekStartDate: effectiveStartDate,
        targetDate: targetEventDate,
        eventDate: targetEventDate,
        planLengthWeeks: Number(computedWeeks) || Number(planLengthWeeks) || 12,
        ...planVersionFields,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        meta: {
          name: planForSave?.name || metaName,
          primaryActivity: "Run",
          planMetricPreference: "time",
          startDate: effectiveStartDate,
          targetDate: targetEventDate,
          templateId: pickedTemplateId || null,
          planSource: planVersionFields.planSource,
          generatedTemplateId: planVersionFields.templateId,
          planVersion: planVersionFields.planVersion,
          rulesEngineVersion: planVersionFields.rulesEngineVersion,
          templateVersion: planVersionFields.templateVersion,
          generatedAt: planVersionFields.generatedAt,
          generatorFeatures: planVersionFields.generatorFeatures,
          qualityWarnings: planForSave?.qualityWarnings || (lowFrequencyGoalWarning ? [lowFrequencyGoalWarning] : []),
          professionalReview,
        },
        athleteProfile,
        plan: planForSave,
        qualityWarnings: planForSave?.qualityWarnings || (lowFrequencyGoalWarning ? [lowFrequencyGoalWarning] : []),
        professionalReview,
        debug: { weeks: weeksCount, week0Sessions },
      });

      const planDocForSave = cleanFirestoreValue(planDoc);
      const planRef = await addDoc(collection(db, "users", uid, "plans"), planDocForSave);
      await publishTrainingWidgetSnapshotFromPlan({
        userId: uid,
        planDoc: { id: planRef.id, ...planDocForSave },
        reason: "plan_saved",
      }).catch((error) => {
        console.warn("[widgets] plan save snapshot failed:", error?.message || error);
      });

      Alert.alert(
        "Plan created",
        "Your run plan has been saved with coach notes and safety guidance."
      );
      router.replace({ pathname: "/train/view-plan", params: { planId: planRef.id } });
    } catch (e) {
      console.log("[create-run] generate/save error:", e);
      Alert.alert("Error", e?.message || "Something went wrong generating or saving your plan.");
    } finally {
      setLoading(false);
    }
  };

  const isLastStep = step === STEPS.length - 1;
  const stepReady = isStepValid(step);

  const stepFeedback = useMemo(() => {
    if (stepReady) {
      if (isLastStep) return canSubmit ? "Ready to generate your plan." : "Finish the required details to generate.";
      return "One question per page for a fast setup.";
    }

    switch (step) {
      case 1:
        return hasTargetDate && !timelineDatesValid
          ? "Race date must be after the plan start date."
          : "Choose a distance and plan length.";
      case 2:
        return "Enter a valid goal time or skip this step.";
      case 4:
        return "Select your birth date. You must be 18 or older.";
      case 6:
        return "Add your current weekly running distance.";
      case 7:
        return "Add your longest recent run distance.";
      case 9:
        return `Select at least ${daysPerWeek} available day${daysPerWeek === 1 ? "" : "s"}.`;
      case 10:
        return "Choose a long-run day from your available days.";
      default:
        return "Complete this question to continue.";
    }
  }, [canSubmit, daysPerWeek, hasTargetDate, isLastStep, step, stepReady, timelineDatesValid]);

  const summaryText = useMemo(() => {
    const goalLabel = GOAL_TYPE_OPTIONS.find((g) => g.key === goalType)?.title || "Goal";
    const dist = normalisedGoalDistance || "—";
    const runs = `${daysPerWeek}x/wk`;
    const weeks = `${computedWeeks}w`;
    const dateStr = hasTargetDate && raceDate ? formatDatePretty(raceDate) : null;
    const goalTime = goalTargetTimeValue;
    const base = dateStr
      ? `${goalLabel} · ${dist} · ${runs} · race ${dateStr}`
      : `${goalLabel} · ${dist} · ${runs} · ${weeks}`;
    return goalTime ? `${base} · goal ${goalTime}` : base;
  }, [goalType, normalisedGoalDistance, daysPerWeek, computedWeeks, hasTargetDate, raceDate, goalTargetTimeValue]);

  const renderGoalTypeStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 1" subtitle="What is your goal?" theme={theme} />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Pick the goal that best matches what you want to achieve.
      </Text>
      <View style={{ gap: 10 }}>
        {GOAL_TYPE_OPTIONS.map((opt) => (
          <OptionRow
            key={opt.key}
            title={opt.title}
            subtitle={opt.blurb}
            leftIcon={opt.icon}
            theme={theme}
            active={goalType === opt.key}
            onPress={() => setGoalType(opt.key)}
          />
        ))}
      </View>
    </View>
  );

  const renderTimelineStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 2"
        subtitle={goalType === "race" ? "Find and set your race" : "Set your timeline"}
        theme={theme}
      />

      {(goalType === "race" || goalType === "distance") && (
        <View style={{ marginBottom: 10 }}>
          <Text style={[styles.label, { color: theme.subtext }]}>
            {goalType === "race" ? "Race distance" : "Target distance"}
          </Text>
          <View style={styles.chipRow}>
            {["5K", "10K", "Half marathon", "Marathon", "Ultra"].map((opt) => (
              <Chip
                key={opt}
                label={opt}
                theme={theme}
                compact
                active={goalDistance === opt}
                onPress={() => setGoalDistance(opt)}
              />
            ))}
            <Chip
              label="Other"
              theme={theme}
              compact
              active={goalDistance === "Other"}
              onPress={() => setGoalDistance("Other")}
            />
          </View>

          {goalDistance === "Other" ? (
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                  marginTop: 10,
                },
              ]}
              selectionColor={theme.primaryBg}
              cursorColor={theme.primaryBg}
              placeholder="e.g. 15K, trail race, ultra"
              placeholderTextColor={theme.subtext}
              value={goalCustomDistance}
              onChangeText={setGoalCustomDistance}
            />
          ) : null}
        </View>
      )}

      {goalType === "race" ? (
        <View style={{ marginBottom: 12, gap: 8 }}>
          <Text style={[styles.label, { color: theme.subtext }]}>Race details</Text>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() =>
              router.push({
                pathname: "/train/find-race",
                params: {
                  step: String(step),
                  goalDistance: normalisedGoalDistance || goalDistance || "",
                  targetDate: effectiveTargetDate || "",
                  returnTo: "/train/create/create-run",
                },
              })
            }
            style={[
              styles.findRaceBtn,
              { borderColor: theme.accent, backgroundColor: theme.cardSoft },
            ]}
          >
            <Feather name="search" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontWeight: "800" }}>Find race</Text>
          </TouchableOpacity>

          <TextInput
            style={[
              styles.input,
              { borderColor: theme.border, backgroundColor: theme.cardSoft, color: theme.text },
            ]}
            selectionColor={theme.primaryBg}
            cursorColor={theme.primaryBg}
            placeholder="Race name (optional)"
            placeholderTextColor={theme.subtext}
            value={targetEventName}
            onChangeText={setTargetEventName}
          />
          <Text style={[styles.helperText, { color: theme.subtext, textAlign: "left", marginTop: 0 }]}>
            Leave this blank if you want a general {normalisedGoalDistance || "race-distance"} plan.
          </Text>
        </View>
      ) : null}

      <View style={{ marginBottom: 12 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>When do you want to start this plan?</Text>
        <OptionRow
          title={planStartDate ? formatDatePretty(planStartDate) : "Pick start date"}
          subtitle="Used as week 1 start"
          theme={theme}
          active
          onPress={() => setShowStartDatePicker(true)}
          right={
            <View style={[styles.optionRightSlot, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
              <Feather name="calendar" size={14} color={theme.text} />
              <Feather name="chevron-right" size={16} color={theme.subtext} />
            </View>
          }
        />
      </View>

      <View style={{ gap: 8 }}>
        <OptionRow
          title="I have an event date"
          subtitle={raceDate ? formatDatePretty(raceDate) : "Choose your event date"}
          leftIcon="calendar"
          theme={theme}
          active={hasTargetDate}
          onPress={() => setShowRaceDatePicker(true)}
        />
        <OptionRow
          title="I don't have an event date yet"
          subtitle="Build a fixed-length plan instead"
          leftIcon="clock"
          theme={theme}
          active={!hasTargetDate}
          onPress={() => setRaceDate(null)}
        />
      </View>

      {!hasTargetDate ? (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.label, { color: theme.subtext }]}>Plan length</Text>
          <View style={styles.chipRow}>
            {PLAN_LENGTH_OPTIONS.map((w) => (
              <Chip
                key={w}
                label={`${w}w`}
                theme={theme}
                compact
                active={planLengthWeeks === w}
                onPress={() => setPlanLengthWeeks(w)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {!timelineDatesValid ? (
        <View style={[styles.inlineWarn, { borderColor: theme.danger, backgroundColor: theme.warnBg }]}>
          <Feather name="alert-triangle" size={14} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 12, fontWeight: "700" }}>
            Start date must be on or before race date.
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderGoalTimeStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 3" subtitle="What goal time are you targeting?" theme={theme} />
      <View style={{ gap: 8 }}>
        <OptionRow
          title="Set a goal time"
          subtitle="Use pace targets for this plan"
          leftIcon="target"
          theme={theme}
          active={goalTimeEnabled}
          onPress={() => setGoalTimeEnabled(true)}
        />
        <OptionRow
          title="Skip goal time"
          subtitle="Build with effort-based defaults"
          leftIcon="minus-circle"
          theme={theme}
          active={!goalTimeEnabled}
          onPress={() => setGoalTimeEnabled(false)}
        />
      </View>

      {goalTimeEnabled ? (
        <View style={{ marginTop: 10, gap: 10 }}>
          <View style={[styles.timeSelectorCard, { borderColor: theme.border }]}>
            <View style={styles.timeSelectorHeader}>
              <Text style={[styles.timeSelectorSentence, { color: theme.subtext }]}>
                I want to run a{" "}
                <Text style={{ color: theme.accent }}>{normalisedGoalDistance || "race"}</Text>
                {" "}in <Text style={{ color: theme.text }}>{goalTargetTimeValue || "00:00"}</Text>
              </Text>
              {goalAveragePace ? (
                <View style={[styles.timePacePill, { borderColor: theme.border, backgroundColor: theme.isDark ? "#242424" : "#E5E7EB" }]}>
                  <Feather name="activity" size={13} color={theme.accent} />
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: "900" }}>
                    {goalAveragePace}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.timePickerColumns}>
              <TimeWheelColumn
                values={GOAL_TIME_HOUR_OPTIONS}
                selectedValue={goalTimeParts.hours}
                onChange={(value) => setGoalTimePart("hours", value)}
                suffix="h"
                theme={theme}
              />
              <Text style={[styles.timeSeparator, { color: theme.subtext }]}>:</Text>
              <TimeWheelColumn
                values={GOAL_TIME_MIN_SEC_OPTIONS}
                selectedValue={goalTimeParts.minutes}
                onChange={(value) => setGoalTimePart("minutes", value)}
                suffix="m"
                theme={theme}
              />
              <Text style={[styles.timeSeparator, { color: theme.subtext }]}>:</Text>
              <TimeWheelColumn
                values={GOAL_TIME_MIN_SEC_OPTIONS}
                selectedValue={goalTimeParts.seconds}
                onChange={(value) => setGoalTimePart("seconds", value)}
                suffix="s"
                theme={theme}
              />
            </View>
          </View>
        </View>
      ) : null}

      <Text style={[styles.helperText, { color: theme.subtext }]}>
        This helps personalise threshold, easy, tempo and interval pace targets.
      </Text>
    </View>
  );

  const renderExperienceStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 4" subtitle="How would you rate your running ability?" theme={theme} />
      <View style={{ gap: 8 }}>
        {ABILITY_OPTIONS.map((opt) => (
          <OptionRow
            key={opt.key}
            title={opt.title}
            subtitle={opt.blurb}
            theme={theme}
            active={experienceLevel === opt.value}
            onPress={() => setExperienceLevel(opt.value)}
          />
        ))}
      </View>
    </View>
  );

  const renderBirthdayStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 5" subtitle="When is your birthday?" theme={theme} />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Your age helps personalise training intensity and reduce injury risk.
      </Text>
      <OptionRow
        title={birthDate ? formatDatePretty(birthDate) : "Select birth date"}
        subtitle={birthAgeYears != null ? `Age ${birthAgeYears}` : "You must be at least 18 to continue"}
        leftIcon="calendar"
        theme={theme}
        active={Boolean(birthDate)}
        onPress={() => setShowBirthDatePicker(true)}
        right={
          <View style={[styles.optionRightSlot, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
            <Feather name="chevron-right" size={16} color={theme.subtext} />
          </View>
        }
      />

      {birthDate && birthAgeYears != null && birthAgeYears < 18 ? (
        <View style={[styles.inlineWarn, { borderColor: theme.danger, backgroundColor: theme.warnBg }]}>
          <Feather name="alert-triangle" size={14} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 12, fontWeight: "700" }}>
            You must be at least 18 years old.
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderGenderStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 6" subtitle="What is your gender?" theme={theme} />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Optional. Helps tailor guidance and is not shown publicly.
      </Text>
      <View style={{ gap: 8 }}>
        {GENDER_OPTIONS.map((opt) => (
          <OptionRow
            key={opt.key}
            title={opt.label}
            theme={theme}
            active={gender === opt.key}
            onPress={() => setGender(opt.key)}
          />
        ))}
      </View>

      {!gender ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setGender("not_say")}
          style={styles.laterBtn}
        >
          <Text style={{ color: theme.subtext, fontWeight: "700" }}>Maybe later</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderWeeklyDistanceStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 7" subtitle="How many km do you currently run per week?" theme={theme} />

      <TextInput
        testID="create-run-weekly-distance-input"
        accessibilityLabel="Current weekly running distance"
        style={[
          styles.input,
          { borderColor: theme.border, backgroundColor: theme.cardSoft, color: theme.text },
        ]}
        selectionColor={theme.primaryBg}
        cursorColor={theme.primaryBg}
        placeholder="e.g. 25"
        placeholderTextColor={theme.subtext}
        keyboardType="numeric"
        value={currentWeeklyDistance}
        onChangeText={setCurrentWeeklyDistance}
      />

      <View style={[styles.chipRow, { marginTop: 10 }]}>
        {[5, 10, 20, 30, 40, 50].map((km) => (
          <Chip
            key={km}
            label={`${km} km`}
            theme={theme}
            compact
            active={String(currentWeeklyDistance) === String(km)}
            onPress={() => setCurrentWeeklyDistance(String(km))}
          />
        ))}
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setShowPaceDetails((prev) => !prev)}
        style={[styles.secondaryAction, { borderColor: theme.border, backgroundColor: theme.cardSoft }]}
      >
        <Feather name={showPaceDetails ? "chevron-up" : "plus-circle"} size={15} color={theme.text} />
        <Text style={{ color: theme.text, fontWeight: "800" }}>
          {showPaceDetails ? "Hide pace details" : "Add pace details"}
        </Text>
      </TouchableOpacity>

      {showPaceDetails ? (
        <>
          <Divider theme={theme} />

          <Text style={[styles.label, { color: theme.subtext }]}>Pace anchor (optional)</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: theme.border, backgroundColor: theme.cardSoft, color: theme.text },
            ]}
            selectionColor={theme.primaryBg}
            cursorColor={theme.primaryBg}
            placeholder="Threshold pace /km (e.g. 4:45)"
            placeholderTextColor={theme.subtext}
            value={thresholdPacePerKm}
            onChangeText={setThresholdPacePerKm}
          />

          <View style={{ marginTop: 8, gap: 8 }}>
            <TextInput
              style={[
                styles.input,
                { borderColor: theme.border, backgroundColor: theme.cardSoft, color: theme.text },
              ]}
              selectionColor={theme.primaryBg}
              cursorColor={theme.primaryBg}
              placeholder="Recent 5K time (e.g. 24:30)"
              placeholderTextColor={theme.subtext}
              value={fiveKTime}
              onChangeText={setFiveKTime}
            />
            <TextInput
              style={[
                styles.input,
                { borderColor: theme.border, backgroundColor: theme.cardSoft, color: theme.text },
              ]}
              selectionColor={theme.primaryBg}
              cursorColor={theme.primaryBg}
              placeholder="Recent 10K time (e.g. 52:10)"
              placeholderTextColor={theme.subtext}
              value={tenKTime}
              onChangeText={setTenKTime}
            />
          </View>

          <Text style={[styles.helperText, { color: theme.subtext }]}>
            Optional. These help tighten pace zones if you already know them.
          </Text>
        </>
      ) : null}
    </View>
  );

  const renderLongestRunStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 8" subtitle="What is your longest run in the last 4 weeks?" theme={theme} />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        This anchors the long-run progression so the plan does not jump too far too soon.
      </Text>

      <TextInput
        testID="create-run-longest-run-input"
        accessibilityLabel="Longest recent run distance"
        style={[
          styles.input,
          { borderColor: theme.border, backgroundColor: theme.cardSoft, color: theme.text },
        ]}
        selectionColor={theme.primaryBg}
        cursorColor={theme.primaryBg}
        placeholder="e.g. 9"
        placeholderTextColor={theme.subtext}
        keyboardType="numeric"
        value={currentLongestRunDistance}
        onChangeText={setCurrentLongestRunDistance}
      />

      <View style={[styles.chipRow, { marginTop: 10 }]}>
        {[0, 3, 5, 8, 12, 16, 20, 25].map((km) => (
          <Chip
            key={km}
            label={`${km} km`}
            theme={theme}
            compact
            active={String(currentLongestRunDistance) === String(km)}
            onPress={() => setCurrentLongestRunDistance(String(km))}
          />
        ))}
      </View>

      <Text style={[styles.helperText, { color: theme.subtext }]}>
        Use your longest comfortable run from recent training, not your all-time best.
      </Text>
    </View>
  );

  const renderRunsPerWeekStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 9" subtitle="How many days per week would you like to run?" theme={theme} />
      <View style={{ gap: 8 }}>
        {DAYS_PER_WEEK_OPTIONS.map((x) => (
          <OptionRow
            key={x}
            title={`${x} days`}
            subtitle={x <= 3 ? "Build consistency safely" : x <= 5 ? "Balanced progression" : "High frequency"}
            theme={theme}
            active={daysPerWeek === x}
            onPress={() => setDaysPerWeek(x)}
          />
        ))}
      </View>

      <View style={[styles.inlineInfo, { borderColor: theme.border, backgroundColor: theme.cardSoft }]}>
        <Feather name="calendar" size={14} color={theme.text} />
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: "800" }}>
          Suggested days: {orderedRunDays.join(" · ")}
        </Text>
      </View>

      {lowFrequencyGoalWarning ? (
        <View style={[styles.inlineWarn, { borderColor: theme.danger, backgroundColor: theme.warnBg }]}>
          <Feather name="alert-triangle" size={14} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 12, fontWeight: "700", flex: 1 }}>
            {lowFrequencyGoalWarning.message}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderAvailableDaysStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 10" subtitle="Which days are you free to run?" theme={theme} />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Select every day available to you. Choose at least {daysPerWeek} day{daysPerWeek === 1 ? "" : "s"}.
      </Text>

      <View style={{ gap: 8 }}>
        {DAY_ORDER.map((d) => {
          const active = orderedRunDays.includes(d);
          return (
            <OptionRow
              key={d}
              title={d}
              theme={theme}
              active={active}
              onPress={() =>
                setRunDays((prev) => {
                  const curr = uniqueInOrder((prev || []).filter((x) => DAY_ORDER.includes(x)));
                  if (curr.includes(d)) return curr.filter((x) => x !== d);
                  return [...curr, d];
                })
              }
            />
          );
        })}
      </View>

      {orderedRunDays.length < daysPerWeek ? (
        <Text style={[styles.helperText, { color: theme.danger }]}>
          Select {daysPerWeek - orderedRunDays.length} more day(s) to continue.
        </Text>
      ) : (
        <Text style={[styles.helperText, { color: theme.ok }]}>
          Great. We will choose the best {daysPerWeek} day schedule from your availability.
        </Text>
      )}
    </View>
  );

  const renderLongRunDayStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 11" subtitle="Which day should be your long run?" theme={theme} />
      <View style={styles.chipRow}>
        {orderedRunDays.map((d) => (
          <Chip
            key={d}
            label={d}
            theme={theme}
            compact
            active={longRunDay === d}
            onPress={() => setLongRunDay(d)}
          />
        ))}
      </View>
    </View>
  );

  const renderDifficultyStep = () => (
    <View style={styles.card}>
      <SectionHeader title="Question 12" subtitle="How hard should this block feel?" theme={theme} />
      <View style={{ gap: 8 }}>
        {DIFFICULTY_OPTIONS.map((opt) => (
          <OptionRow
            key={opt.key}
            title={opt.title}
            subtitle={opt.blurb}
            theme={theme}
            active={difficulty === opt.key}
            onPress={() => setDifficulty(opt.key)}
          />
        ))}
      </View>

      {lowFrequencyGoalWarning ? (
        <View style={[styles.inlineWarn, { borderColor: theme.danger, backgroundColor: theme.warnBg }]}>
          <Feather name="alert-triangle" size={14} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 12, fontWeight: "700", flex: 1 }}>
            {lowFrequencyGoalWarning.message}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const nextDisabled = loading || (!stepReady && !isLastStep);
  const generateDisabled = loading || (isLastStep && !canSubmit);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={() => (step === 0 ? router.back() : handleBack())}
              style={[styles.iconCircle, { borderColor: theme.border, backgroundColor: theme.pillBg }]}
              activeOpacity={0.85}
            >
              <Feather name="arrow-left" size={20} color={theme.text} />
            </TouchableOpacity>

            <View style={{ flex: 1, alignItems: "center" }}>
              <View style={[styles.progressTrack, { backgroundColor: theme.progressTrack, width: "75%" }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${((step + 1) / STEPS.length) * 100}%`,
                      backgroundColor: theme.primaryBg,
                    },
                  ]}
                />
              </View>
              <Text style={{ fontSize: 12, color: theme.subtext, marginTop: 8, textAlign: "center", width: "100%" }}>
                {step + 1}/{STEPS.length} · {STEPS[step]}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.iconCircle, { borderColor: theme.border, backgroundColor: theme.pillBg }]}
              activeOpacity={0.85}
            >
              <Feather name="x" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.summaryStrip}>
            <Text style={{ color: theme.text, fontWeight: "900", textAlign: "center" }}>{summaryText}</Text>
            <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 4, textAlign: "center" }}>
              Stock template is selected automatically.
            </Text>
          </View>

          <View style={styles.stepStage}>
            <View style={styles.stepInner}>
              {step === 0 && renderGoalTypeStep()}
              {step === 1 && renderTimelineStep()}
              {step === 2 && renderGoalTimeStep()}
              {step === 3 && renderExperienceStep()}
              {step === 4 && renderBirthdayStep()}
              {step === 5 && renderGenderStep()}
              {step === 6 && renderWeeklyDistanceStep()}
              {step === 7 && renderLongestRunStep()}
              {step === 8 && renderRunsPerWeekStep()}
              {step === 9 && renderAvailableDaysStep()}
              {step === 10 && renderLongRunDayStep()}
              {step === 11 && renderDifficultyStep()}
            </View>
          </View>
        </ScrollView>

        <View style={[styles.stickyBar, { borderTopColor: theme.border, backgroundColor: theme.bg }]}>
          <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
            {!isLastStep ? (
              <TouchableOpacity
                onPress={handleNext}
                disabled={nextDisabled}
                activeOpacity={0.9}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: nextDisabled
                      ? theme.muted
                      : theme.isDark
                      ? "#ECEFF3"
                      : theme.primaryBg,
                  },
                ]}
              >
                <Feather name="arrow-right" size={18} color={nextDisabled ? "#6B7280" : "#1A1D22"} />
                <Text style={{ color: nextDisabled ? "#6B7280" : "#1A1D22", fontWeight: "900" }}>
                  {stepReady ? "Next" : "Complete this step"}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleGenerate}
                disabled={generateDisabled}
                activeOpacity={0.9}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: generateDisabled
                      ? theme.muted
                      : theme.isDark
                      ? "#ECEFF3"
                      : theme.primaryBg,
                  },
                ]}
              >
                <Feather name="zap" size={18} color={generateDisabled ? "#6B7280" : "#1A1D22"} />
                <Text style={{ color: generateDisabled ? "#6B7280" : "#1A1D22", fontWeight: "900" }}>
                  {loading ? "Building your plan…" : "Generate plan"}
                </Text>
              </TouchableOpacity>
            )}

            <View style={{ marginTop: 8, flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: theme.subtext, fontSize: 11 }}>
                {stepFeedback}
              </Text>
            </View>
          </View>
        </View>

        <Modal
          transparent
          visible={showStartDatePicker}
          animationType="fade"
          onRequestClose={() => setShowStartDatePicker(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View style={[styles.pickerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <DateTimePicker
                mode="date"
                value={planStartDate || new Date()}
                display={Platform.OS === "ios" ? "inline" : "spinner"}
                accentColor={theme.primaryBg}
                themeVariant={theme.isDark ? "dark" : "light"}
                onChange={(event, selectedDate) => {
                  if (event.type === "dismissed") return setShowStartDatePicker(false);
                  if (selectedDate) setPlanStartDate(selectedDate);
                  setShowStartDatePicker(false);
                }}
                style={{ alignSelf: "stretch" }}
              />
            </View>
          </View>
        </Modal>

        <Modal
          transparent
          visible={showRaceDatePicker}
          animationType="fade"
          onRequestClose={() => setShowRaceDatePicker(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View style={[styles.pickerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <DateTimePicker
                mode="date"
                value={raceDate || new Date()}
                display={Platform.OS === "ios" ? "inline" : "spinner"}
                accentColor={theme.primaryBg}
                themeVariant={theme.isDark ? "dark" : "light"}
                onChange={(event, selectedDate) => {
                  if (event.type === "dismissed") return setShowRaceDatePicker(false);
                  if (selectedDate) setRaceDate(selectedDate);
                  setShowRaceDatePicker(false);
                }}
                style={{ alignSelf: "stretch" }}
              />
            </View>
          </View>
        </Modal>

        <Modal
          transparent
          visible={showBirthDatePicker}
          animationType="fade"
          onRequestClose={() => setShowBirthDatePicker(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View style={[styles.pickerCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <DateTimePicker
                mode="date"
                value={birthDate || new Date(1995, 0, 1)}
                display={Platform.OS === "ios" ? "inline" : "spinner"}
                maximumDate={new Date()}
                accentColor={theme.primaryBg}
                themeVariant={theme.isDark ? "dark" : "light"}
                onChange={(event, selectedDate) => {
                  if (event.type === "dismissed") return setShowBirthDatePicker(false);
                  if (selectedDate) setBirthDate(selectedDate);
                  setShowBirthDatePicker(false);
                }}
                style={{ alignSelf: "stretch" }}
              />
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* STYLES                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingBottom: 140,
    paddingTop: 6,
  },

  topBar: {
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },

  progressTrack: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    borderRadius: 999,
  },

  summaryStrip: {
    marginTop: 8,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },

  stepStage: {
    flex: 1,
    justifyContent: "center",
    paddingTop: 10,
  },

  stepInner: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },

  card: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    gap: 8,
  },

  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  sectionPrompt: {
    marginTop: 6,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },

  label: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },

  helperText: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
    textAlign: "center",
  },

  stepIntro: {
    marginTop: -2,
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },

  miniLabel: {
    fontSize: 11,
    fontWeight: "800",
  },

  timeSelectorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 0,
    gap: 18,
  },

  timeSelectorHeader: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 8,
  },

  timeSelectorSentence: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    textAlign: "center",
  },

  timePacePill: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  timePickerColumns: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
  },

  timeWheelColumn: {
    flex: 1,
    maxWidth: 116,
    overflow: "hidden",
  },

  timeWheelHighlight: {
    position: "absolute",
    left: 0,
    right: 0,
    borderRadius: 12,
  },

  timeWheelItem: {
    height: TIME_WHEEL_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },

  timeWheelText: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: "center",
  },

  timeSeparator: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },

  timePickerRow: {
    gap: 6,
  },

  timePickerLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  timePickerScroll: {
    gap: 8,
    paddingRight: 8,
  },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },

  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  chipCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  chipLabel: {
    fontSize: 13,
    textAlign: "center",
  },

  optionRow: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
  },

  optionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  optionTextBlock: {
    flex: 1,
    minWidth: 0,
  },

  optionTitle: {
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 2,
  },

  optionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },

  optionTick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  optionRightSlot: {
    marginLeft: 8,
    justifyContent: "center",
    alignItems: "center",
  },

  findRaceBtn: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  laterBtn: {
    marginTop: 8,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
  },

  secondaryAction: {
    marginTop: 10,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  primaryBtn: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 14,
  },

  inlineWarn: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },

  inlineInfo: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },

  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.40)",
    justifyContent: "center",
    alignItems: "center",
  },

  pickerCard: {
    width: "92%",
    maxWidth: 420,
    borderRadius: 20,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
