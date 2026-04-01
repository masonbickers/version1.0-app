import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../../../../firebaseConfig";
import { useTheme } from "../../../../../providers/ThemeProvider";
import { decodeSessionKey } from "../../../../../src/train/utils/sessionHelpers";

const EMPTY_EXERCISE_DRAFT = {
  title: "",
  sets: "",
  reps: "",
  restSec: "",
  rpe: "",
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractFirstNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;

  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function parsePositiveInt(value) {
  const n = extractFirstNumber(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parsePositiveNumber(value, precision = 2) {
  const n = extractFirstNumber(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(n.toFixed(precision));
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWeightLabel(value) {
  const n = toNumber(value);
  if (n == null) return "";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function extractRestSecFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const match =
    raw.match(
      /(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\s*(?:rest|recover(?:y)?)\b/i
    ) ||
    raw.match(
      /\b(?:rest|recover(?:y)?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i
    );

  if (!match) return null;

  const valueRaw = Number(match[1]);
  if (!Number.isFinite(valueRaw) || valueRaw <= 0) return null;

  const unit = String(match[2] || "").toLowerCase();
  return unit.startsWith("m") ? Math.round(valueRaw * 60) : Math.round(valueRaw);
}

function extractRpeFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const explicit = raw.match(/\bRPE\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (!explicit) return null;

  const n = Number(explicit[1]);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(1)) : null;
}

function withAlpha(color, alphaHex) {
  const raw = String(color || "").trim();
  const alpha = String(alphaHex || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(alpha)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${alpha}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${alpha}`;
  }
  return raw;
}

function normaliseExerciseKey(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || "exercise";
}

function normalizeTextKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXERCISE_SUGGESTIONS = [
  "Bench Press",
  "Incline Dumbbell Press",
  "Overhead Press",
  "Push Press",
  "Weighted Pull Ups",
  "Pull Ups",
  "Lat Pulldown",
  "Barbell Row",
  "Seated Cable Row",
  "Chest Supported Row",
  "Back Squat",
  "Front Squat",
  "Hack Squat",
  "Goblet Squat",
  "Deadlift",
  "Trap Bar Deadlift",
  "Romanian Deadlift",
  "Hip Thrust",
  "Walking Lunges",
  "Bulgarian Split Squat",
  "Leg Press",
  "Leg Extension",
  "Hamstring Curl",
  "Calf Raises",
  "Lateral Raises",
  "Face Pull",
  "Cable Fly",
  "Biceps Curl",
  "Hammer Curl",
  "Triceps Pressdown",
  "Dips",
  "Core Circuit",
  "Plank",
  "Ab Wheel",
  "Farmer Carry",
  "Sled Push",
];

const MASON_STRENGTH_FALLBACKS = {
  "upper strength": {
    "bench press": { restSec: 150, rpe: 8 },
    "weighted pull ups": { restSec: 120, rpe: 8 },
    "overhead press": { restSec: 120, rpe: 7.5 },
    "barbell row": { restSec: 105, rpe: 7.5 },
    biceps: { restSec: 75, rpe: 8 },
    "biceps curl": { restSec: 75, rpe: 8 },
    triceps: { restSec: 75, rpe: 8 },
    "triceps pressdown": { restSec: 75, rpe: 8 },
  },
  "lower strength": {
    "back squat": { restSec: 180, rpe: 8 },
    "romanian deadlift": { restSec: 150, rpe: 8 },
    "walking lunges": { restSec: 90, rpe: 7.5 },
    "hamstring curl": { restSec: 75, rpe: 8 },
    "standing calf raises": { restSec: 60, rpe: 8 },
    "core circuit": { restSec: 60, rpe: 7 },
  },
  "upper volume": {
    "incline db press": { restSec: 90, rpe: 8 },
    "lat pulldown": { restSec: 90, rpe: 8 },
    "lateral raises": { restSec: 60, rpe: 8.5 },
    "cable fly": { restSec: 60, rpe: 8 },
    "cable curl": { restSec: 60, rpe: 8 },
    "triceps pushdown": { restSec: 60, rpe: 8 },
  },
  "lower hypertrophy": {
    "front squat or hack squat": { restSec: 120, rpe: 8 },
    "hip thrust": { restSec: 120, rpe: 8 },
    "single leg rdl": { restSec: 90, rpe: 8 },
    "leg extension": { restSec: 75, rpe: 8 },
    "hamstring curl": { restSec: 75, rpe: 8 },
    "walking lunges": { restSec: 75, rpe: 8 },
    "calf raises": { restSec: 60, rpe: 8 },
    "core carries": { restSec: 75, rpe: 7.5 },
    "sled push": { restSec: 90, rpe: 8.5 },
    "wall balls": { restSec: 75, rpe: 8.5 },
  },
};

function summariseStrengthSetLogs(setLogs) {
  const enteredRows = Array.isArray(setLogs)
    ? setLogs.filter(
        (row) => row?.completed || row?.loadKg != null || row?.reps != null
      )
    : [];

  const completedRows = enteredRows.filter((row) => !!row?.completed);
  const trackedRows = completedRows.length ? completedRows : enteredRows;

  const loadValues = trackedRows.map((row) => row?.loadKg).filter((value) => value != null);
  const repValues = trackedRows.map((row) => row?.reps).filter((value) => value != null);
  const volumeValues = trackedRows
    .map((row) => (row?.loadKg != null && row?.reps != null ? row.loadKg * row.reps : null))
    .filter((value) => value != null);

  return {
    hasData: trackedRows.length > 0,
    enteredSetCount: enteredRows.length,
    trackedSetCount: trackedRows.length,
    completedSetCount: completedRows.length,
    totalReps: repValues.length ? repValues.reduce((sum, value) => sum + value, 0) : null,
    avgReps: repValues.length
      ? Number((repValues.reduce((sum, value) => sum + value, 0) / repValues.length).toFixed(1))
      : null,
    avgLoadKg: loadValues.length
      ? Number((loadValues.reduce((sum, value) => sum + value, 0) / loadValues.length).toFixed(1))
      : null,
    topLoadKg: loadValues.length ? Math.max(...loadValues) : null,
    volumeKg: volumeValues.length
      ? Number(volumeValues.reduce((sum, value) => sum + value, 0).toFixed(1))
      : null,
    bestSetVolumeKg: volumeValues.length ? Number(Math.max(...volumeValues).toFixed(1)) : null,
  };
}

function getMasonFallbackPrescription(seg, options = {}) {
  const planName = normalizeTextKey(options?.planName);
  const coachName = normalizeTextKey(
    options?.coachName || options?.planCoachName || options?.authorName
  );
  const sessionTitle = normalizeTextKey(
    options?.sessionTitle || options?.stationName || seg?.stationName || ""
  );
  const masonTagged =
    planName.includes("mason bickers") ||
    coachName.includes("mason bickers") ||
    coachName === "mason";
  const knownMasonBlock = Object.keys(MASON_STRENGTH_FALLBACKS).some((key) =>
    sessionTitle.includes(key)
  );
  if (!masonTagged && !knownMasonBlock) return null;

  const blockKey = Object.keys(MASON_STRENGTH_FALLBACKS).find((key) =>
    sessionTitle.includes(key)
  );
  if (!blockKey) return null;

  const exerciseName = normalizeTextKey(seg?.title || seg?.name || seg?.type || "");
  if (!exerciseName) return null;

  const defaults = MASON_STRENGTH_FALLBACKS[blockKey] || {};
  if (defaults[exerciseName]) return defaults[exerciseName];
  const looseKey = Object.keys(defaults).find(
    (key) => exerciseName.includes(key) || key.includes(exerciseName)
  );
  return looseKey ? defaults[looseKey] : null;
}

function resolveStrengthPrescription(source, options = {}) {
  const textBlob = [
    source?.rest,
    source?.recovery,
    source?.notes,
    source?.cues,
    source?.title,
    source?.name,
    source?.type,
    source?.effort,
  ]
    .filter(Boolean)
    .join(" ");

  const restSecRaw = Number(
    source?.restSec ?? source?.restSeconds ?? source?.recoverySec ?? source?.recoverSec ?? 0
  );
  const restFromText = extractRestSecFromText(textBlob);
  const rpeFromText = extractRpeFromText(textBlob);
  const explicitRpe = extractFirstNumber(source?.rpe ?? source?.targetRpe);
  const fallback = getMasonFallbackPrescription(source, options);

  const restSec =
    Number.isFinite(restSecRaw) && restSecRaw > 0
      ? Math.round(restSecRaw)
      : Number.isFinite(restFromText) && restFromText > 0
      ? Math.round(restFromText)
      : Number.isFinite(Number(fallback?.restSec)) && Number(fallback.restSec) > 0
      ? Math.round(Number(fallback.restSec))
      : null;

  const rpe =
    explicitRpe != null && explicitRpe > 0
      ? Number(Number(explicitRpe).toFixed(1))
      : rpeFromText != null
      ? Number(Number(rpeFromText).toFixed(1))
      : Number.isFinite(Number(fallback?.rpe)) && Number(fallback.rpe) > 0
      ? Number(Number(fallback.rpe).toFixed(1))
      : null;

  return {
    restSec,
    rpe,
  };
}

function secondsToClock(sec) {
  const total = Math.max(0, Math.floor(Number(sec || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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

function getSessionFromPlan(data, weekIndex, dayIndex, sessionIndex) {
  const weeks = extractWeeks(data);
  const week = weeks?.[weekIndex];

  if (!week) return { sess: null, dayLabel: "" };

  const days = normaliseList(week?.days);
  const day = days?.[dayIndex];

  const daySessions = normaliseList(day?.sessions);
  let sess = daySessions?.[sessionIndex] || null;

  if (!sess) {
    const weekSessions = normaliseList(week?.sessions);
    sess = weekSessions?.[sessionIndex] || null;
  }

  if (!sess) {
    const workouts = normaliseList(week?.workouts);
    sess = workouts?.[sessionIndex] || null;
  }

  const dayLabel =
    day?.day ||
    day?.label ||
    day?.name ||
    (week?.weekNumber != null ? `Week ${week.weekNumber}` : "");

  return { sess, dayLabel };
}

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

  for (const candidate of candidates) {
    try {
      const found = await tryGetDoc(candidate);
      if (found) return found;
    } catch {}
  }

  return null;
}

function buildStrengthExercises(session, options = {}) {
  const out = [];
  const blocks = Array.isArray(session?.blocks) ? session.blocks : [];

  blocks.forEach((block, blockIdx) => {
    const blockTitle = String(block?.title || block?.name || block?.kind || "Block").trim();
    const items = Array.isArray(block?.items) ? block.items : [];

    items.forEach((item, itemIdx) => {
      const title = String(item?.title || item?.name || blockTitle || "Exercise").trim();

      const sets = parsePositiveInt(item?.sets);
      const reps = parsePositiveInt(item?.reps);
      const loadKg = parsePositiveNumber(item?.loadKg);
      const { restSec, rpe } = resolveStrengthPrescription(
        {
          ...item,
          title,
          type: title,
          stationName: blockTitle,
        },
        {
          ...options,
          sessionTitle: blockTitle || options?.sessionTitle,
          stationName: blockTitle,
        }
      );

      out.push({
        id: `blk_${blockIdx}_${itemIdx}_${title}`.replace(/\s+/g, "_"),
        title,
        blockTitle,
        isLoggable: true,
        prescribedSets: sets,
        prescribedReps: reps,
        prescribedLoadKg: loadKg,
        prescribedRestSec: restSec,
        prescribedRpe: Number.isFinite(rpe) ? Number(Number(rpe).toFixed(1)) : null,
      });
    });
  });
  const seen = new Set(
    out.map((item) => `${String(item.blockTitle || "").toLowerCase()}::${String(item.title || "").toLowerCase()}`)
  );

  const steps = Array.isArray(session?.steps)
    ? session.steps
    : Array.isArray(session?.segments)
    ? session.segments
    : [];

  steps.forEach((step, idx) => {
    const title = String(step?.title || step?.name || step?.type || "Exercise").trim();
    const blockTitle = String(step?.label || step?.stationName || "Main block").trim();
    const dedupeKey = `${blockTitle.toLowerCase()}::${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const sets = parsePositiveInt(step?.sets);
    const reps = parsePositiveInt(step?.reps);
    const loadKg = parsePositiveNumber(step?.loadKg);
    const { restSec, rpe } = resolveStrengthPrescription(
      {
        ...step,
        title,
        type: title,
        stationName: blockTitle || step?.stationName,
      },
      {
        ...options,
        sessionTitle: blockTitle || options?.sessionTitle,
        stationName: blockTitle || step?.stationName,
      }
    );

    out.push({
      id: `stp_${idx}_${title}`.replace(/\s+/g, "_"),
      title,
      blockTitle,
      isLoggable: true,
      prescribedSets: sets,
      prescribedReps: reps,
      prescribedLoadKg: loadKg,
      prescribedRestSec: restSec,
      prescribedRpe: Number.isFinite(rpe) ? Number(Number(rpe).toFixed(1)) : null,
    });
  });

  if (!out.length) {
    const notesRaw = String(
      session?.notes || session?.description || session?.summary || session?.workout?.description || ""
    ).trim();

    if (notesRaw) {
      const tokens = notesRaw
        .split(/[\n;]+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);

      tokens.forEach((token, idx) => {
        const optional = /^optional\s*:/i.test(token);
        const cleaned = token.replace(/^optional\s*:\s*/i, "").replace(/[.;:,]+$/g, "").trim();
        if (!cleaned) return;

        const repMatch = cleaned.match(
          /^(.*?)(?:\s*-\s*)?(\d+)\s*x\s*(\d+)(\s*\/\s*leg)?(?:\s+(.*))?$/i
        );
        const setMatch = cleaned.match(/^(.*?)(?:\s*-\s*)?(\d+)\s*sets?(?:\s+(.*))?$/i);
        const roundMatch = cleaned.match(/^(.*?)(?:\s*-\s*)?(\d+)\s*rounds?(?:\s+(.*))?$/i);

        const detailTail = String(repMatch?.[5] || setMatch?.[3] || roundMatch?.[3] || cleaned).trim();

        let title = cleaned;
        let sets = null;
        let reps = null;

        if (repMatch) {
          const name = String(repMatch[1] || "").trim();
          if (name) title = name;
          sets = parsePositiveInt(repMatch[2]);
          reps = parsePositiveInt(repMatch[3]);
        } else if (setMatch) {
          const name = String(setMatch[1] || "").trim();
          if (name) title = name;
          sets = parsePositiveInt(setMatch[2]);
        } else if (roundMatch) {
          const name = String(roundMatch[1] || "").trim();
          if (name) title = name;
          sets = parsePositiveInt(roundMatch[2]);
          reps = 1;
        }

        const blockTitle = optional ? "Optional" : String(session?.title || "Main block");
        const { restSec, rpe } = resolveStrengthPrescription(
          {
            title,
            type: title,
            stationName: blockTitle,
            notes: detailTail,
          },
          {
            ...options,
            sessionTitle: blockTitle || options?.sessionTitle,
            stationName: blockTitle,
          }
        );

        out.push({
          id: `nts_${idx}_${title}`.replace(/\s+/g, "_"),
          title,
          blockTitle,
          isLoggable: true,
          prescribedSets: sets,
          prescribedReps: reps,
          prescribedLoadKg: null,
          prescribedRestSec: restSec,
          prescribedRpe: rpe,
        });
      });
    }
  }

  return out;
}

function normaliseCustomExercise(raw, idx = 0) {
  const title = String(raw?.title || raw?.name || "").trim();
  if (!title) return null;

  const rpeRaw =
    raw?.prescribedRpe != null
      ? Number(raw.prescribedRpe)
      : raw?.rpe != null
      ? Number(raw.rpe)
      : null;

  return {
    id:
      String(raw?.id || "").trim() ||
      `custom_${Date.now()}_${idx}_${normaliseExerciseKey(title)}`,
    title,
    blockTitle: String(raw?.blockTitle || "Added exercises").trim() || "Added exercises",
    isLoggable: true,
    isCustom: true,
    prescribedSets: parsePositiveInt(raw?.prescribedSets ?? raw?.sets),
    prescribedReps: parsePositiveInt(raw?.prescribedReps ?? raw?.reps),
    prescribedLoadKg: parsePositiveNumber(raw?.prescribedLoadKg ?? raw?.loadKg),
    prescribedRestSec: parsePositiveInt(raw?.prescribedRestSec ?? raw?.restSec),
    prescribedRpe:
      Number.isFinite(rpeRaw) && rpeRaw > 0 ? Number(rpeRaw.toFixed(1)) : null,
  };
}

export default function StrengthLogSessionScreen() {
  const router = useRouter();
  const { sessionKey, status: statusParam } = useLocalSearchParams();
  const { colors, isDark } = useTheme();

  const encodedKey = useMemo(
    () => (Array.isArray(sessionKey) ? sessionKey[0] : String(sessionKey || "")),
    [sessionKey]
  );

  const decodedKey = useMemo(() => decodeSessionKey(encodedKey), [encodedKey]);

  const initialStatus = String(Array.isArray(statusParam) ? statusParam[0] : statusParam || "").toLowerCase();
  const defaultStatus = initialStatus === "skipped" ? "skipped" : "completed";
  const [status, setStatus] = useState(defaultStatus);
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [dayLabel, setDayLabel] = useState("");
  const [hasExistingSessionLog, setHasExistingSessionLog] = useState(false);
  const [customExercises, setCustomExercises] = useState([]);
  const [addExerciseOpen, setAddExerciseOpen] = useState(false);
  const [exerciseDraft, setExerciseDraft] = useState(EMPTY_EXERCISE_DRAFT);

  const [entryById, setEntryById] = useState({});
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [restSecLeft, setRestSecLeft] = useState(0);
  const [restExerciseId, setRestExerciseId] = useState(null);

  const [existingTrainSessionId, setExistingTrainSessionId] = useState(null);
  const elapsedBaseSecRef = useRef(0);
  const timerStartedAtRef = useRef(null);
  const restEndsAtRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const draftSaveTimeoutRef = useRef(null);
  const draftHydratedRef = useRef(false);
  const lastDraftSignatureRef = useRef("");
  const persistDraftRef = useRef(null);
  const hasPersistedDraftRef = useRef(false);
  const cardSoft = colors?.surfaceAlt ?? "#111317";
  const accent = colors?.primary ?? "#E6FF3B";
  const accentSoft = String(accent).startsWith("#") ? withAlpha(accent, "20") : "rgba(230,255,59,0.16)";
  const accentBorder = String(accent).startsWith("#") ? withAlpha(accent, "52") : "rgba(230,255,59,0.32)";
  const accentMuted = String(accent).startsWith("#") ? withAlpha(accent, "C8") : "rgba(230,255,59,0.78)";
  const success = "#16A34A";
  const keyboardAppearance = isDark ? "dark" : "light";
  const timeOfDayLabel = useMemo(
    () =>
      new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [elapsedSec]
  );

  const clearRestTimer = useCallback(() => {
    restEndsAtRef.current = null;
    setRestSecLeft(0);
    setRestExerciseId(null);
  }, []);

  const getElapsedNow = useCallback(() => {
    const base = Math.max(0, Math.floor(elapsedBaseSecRef.current || 0));
    if (status === "skipped" || !timerStartedAtRef.current) return base;
    const delta = Math.max(0, Math.floor((Date.now() - timerStartedAtRef.current) / 1000));
    return base + delta;
  }, [status]);

  const syncElapsedTimer = useCallback(() => {
    const next = getElapsedNow();
    setElapsedSec((prev) => (prev === next ? prev : next));
    return next;
  }, [getElapsedNow]);

  const startSessionTimer = useCallback((force = false) => {
    if (!force && status === "skipped") return;
    if (!timerStartedAtRef.current) {
      timerStartedAtRef.current = Date.now();
    }
    setIsTimerRunning(true);
    syncElapsedTimer();
  }, [status, syncElapsedTimer]);

  const pauseSessionTimer = useCallback(() => {
    const next = getElapsedNow();
    elapsedBaseSecRef.current = next;
    timerStartedAtRef.current = null;
    setElapsedSec(next);
    setIsTimerRunning(false);
  }, [getElapsedNow]);

  const startRestTimer = useCallback(
    (exerciseId, restSec = 0) => {
      const safeRest = Math.max(0, Number(restSec || 0));
      if (!exerciseId || !safeRest || status === "skipped") return;
      restEndsAtRef.current = Date.now() + safeRest * 1000;
      setRestExerciseId(exerciseId);
      setRestSecLeft(Math.round(safeRest));
    },
    [status]
  );

  const resetSessionState = useCallback(() => {
    setNotes("");
    setStatus(defaultStatus);
    setEntryById({});
    setElapsedSec(0);
    setIsTimerRunning(false);
    setExistingTrainSessionId(null);
    setHasExistingSessionLog(false);
    setPlan(null);
    setSession(null);
    setDayLabel("");
    setCustomExercises([]);
    setAddExerciseOpen(false);
    setExerciseDraft(EMPTY_EXERCISE_DRAFT);
    elapsedBaseSecRef.current = 0;
    timerStartedAtRef.current = null;
    draftHydratedRef.current = false;
    lastDraftSignatureRef.current = "";
    hasPersistedDraftRef.current = false;
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
      draftSaveTimeoutRef.current = null;
    }
    clearRestTimer();
  }, [clearRestTimer, defaultStatus]);

  useEffect(() => {
    if (!isTimerRunning || saving || status === "skipped") return;
    syncElapsedTimer();
    const timer = setInterval(() => {
      syncElapsedTimer();
    }, 1000);
    return () => clearInterval(timer);
  }, [isTimerRunning, saving, status, syncElapsedTimer]);

  useEffect(() => {
    if (!restExerciseId || status === "skipped") return;

    const syncRestTimer = () => {
      const endAt = restEndsAtRef.current;
      if (!endAt) {
        setRestSecLeft(0);
        setRestExerciseId(null);
        return;
      }

      const next = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      if (next <= 0) {
        clearRestTimer();
        return;
      }

      setRestSecLeft((prev) => (prev === next ? prev : next));
    };

    syncRestTimer();
    const timer = setInterval(syncRestTimer, 300);
    return () => clearInterval(timer);
  }, [clearRestTimer, restExerciseId, status]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (prevState !== nextState) {
        syncElapsedTimer();
        if (restEndsAtRef.current) {
          const nextRest = Math.max(0, Math.ceil((restEndsAtRef.current - Date.now()) / 1000));
          if (nextRest <= 0) {
            clearRestTimer();
          } else {
            setRestSecLeft(nextRest);
          }
        }
        if (nextState !== "active" && persistDraftRef.current) {
          void persistDraftRef.current(true);
        }
      }
    });

    return () => subscription.remove();
  }, [clearRestTimer, syncElapsedTimer]);

  useEffect(() => {
    return () => {
      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }
      if (persistDraftRef.current) {
        void persistDraftRef.current(true);
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        resetSessionState();

        if (!encodedKey) {
          setError("Invalid session key.");
          setLoading(false);
          return;
        }

        const uid = auth.currentUser?.uid;
        if (!uid) {
          setError("Not signed in.");
          setLoading(false);
          return;
        }

        const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);

        if (!planId) {
          setError("Invalid session link.");
          setLoading(false);
          return;
        }

        const [planDoc, sessionLogSnap] = await Promise.all([
          fetchPlanById(uid, planId),
          getDoc(doc(db, "users", uid, "sessionLogs", encodedKey)),
        ]);

        if (!planDoc) {
          setError("Plan not found.");
          setLoading(false);
          return;
        }

        const { sess, dayLabel: dayName } = getSessionFromPlan(planDoc, weekIndex, dayIndex, sessionIndex);

        if (!sess) {
          setError("Session not found.");
          setLoading(false);
          return;
        }

        setPlan(planDoc);
        setSession(sess);
        setDayLabel(dayName || "");
        let nextStatus = defaultStatus;
        let nextElapsedSec = 0;

        if (sessionLogSnap.exists()) {
          const log = sessionLogSnap.data() || {};
          const draft =
            log?.draft && typeof log.draft === "object" && !Array.isArray(log.draft)
              ? log.draft
              : null;
          hasPersistedDraftRef.current = !!draft;
          const hasFinalSavedLog =
            String(log?.source || "").trim() === "strength_log" ||
            !!log?.lastTrainSessionId ||
            !!log?.completedAt ||
            !!log?.skippedAt;
          setHasExistingSessionLog(hasFinalSavedLog);

          setNotes(String(draft?.notes ?? log?.notes ?? ""));
          nextStatus =
            String(log?.status || defaultStatus || "completed").toLowerCase() === "skipped"
              ? "skipped"
              : "completed";
          setStatus(nextStatus);

          const loggedDuration =
            Number(draft?.durationSec) ||
            Number(log?.strengthLog?.durationSec) ||
            Number(log?.live?.durationSec) ||
            Number(log?.durationSec) ||
            0;
          if (Number.isFinite(loggedDuration) && loggedDuration > 0) {
            nextElapsedSec = Math.round(loggedDuration);
          }

          const existingEntries =
            draft?.strengthEntryById && typeof draft.strengthEntryById === "object"
              ? draft.strengthEntryById
              : log?.strengthEntryById && typeof log.strengthEntryById === "object"
              ? log.strengthEntryById
              : null;
          if (existingEntries) {
            setEntryById(existingEntries);
          }

          const storedCustomExercises = Array.isArray(draft?.customExercises)
            ? draft.customExercises
            : Array.isArray(log?.strengthLog?.customExercises)
            ? log.strengthLog.customExercises
            : Array.isArray(log?.customExercises)
            ? log.customExercises
            : [];
          const plannedKeys = new Set(
            buildStrengthExercises(sess, {
              planName: planDoc?.name || planDoc?.title || "",
              coachName:
                planDoc?.coachName ||
                planDoc?.coach?.name ||
                planDoc?.authorName ||
                planDoc?.createdByName ||
                "",
              authorName: planDoc?.authorName || planDoc?.createdByName || "",
              sessionTitle: sess?.title || sess?.name || sess?.type || "",
            }).map((item) => normaliseExerciseKey(item?.title))
          );
          const seenCustomKeys = new Set();

          setCustomExercises(
            storedCustomExercises
              .map((item, idx) => normaliseCustomExercise(item, idx))
              .filter((item) => {
                if (!item) return false;
                const key = normaliseExerciseKey(item.title);
                if (plannedKeys.has(key) || seenCustomKeys.has(key)) return false;
                seenCustomKeys.add(key);
                return true;
              })
              .filter(Boolean)
          );

          const existingSessionId = String(log?.lastTrainSessionId || "").trim();
          setExistingTrainSessionId(existingSessionId || null);
        }

        elapsedBaseSecRef.current = nextElapsedSec;
        timerStartedAtRef.current = null;
        setElapsedSec(nextElapsedSec);
        setIsTimerRunning(false);
        if (!sessionLogSnap.exists() && nextStatus !== "skipped") {
          timerStartedAtRef.current = Date.now();
          setIsTimerRunning(true);
          setElapsedSec(0);
        }
      } catch (e) {
        setError(e?.message || "Could not load strength session.");
      } finally {
        setLoading(false);
      }
    })();
  }, [defaultStatus, encodedKey, resetSessionState]);

  const strengthBuildOptions = useMemo(
    () => ({
      planName: plan?.name || plan?.title || "",
      coachName:
        plan?.coachName || plan?.coach?.name || plan?.authorName || plan?.createdByName || "",
      authorName: plan?.authorName || plan?.createdByName || "",
      sessionTitle: session?.title || session?.name || session?.type || session?.sessionType || "",
    }),
    [plan, session]
  );

  const plannedStrengthExercises = useMemo(
    () => buildStrengthExercises(session, strengthBuildOptions),
    [session, strengthBuildOptions]
  );
  const strengthExercises = useMemo(
    () => [...plannedStrengthExercises, ...customExercises],
    [customExercises, plannedStrengthExercises]
  );

  useEffect(() => {
    if (!strengthExercises.length) return;

    setEntryById((prev) => {
      const next = {};

      strengthExercises.forEach((ex) => {
        const existing = prev?.[ex.id] || {};
        const isLoggable = ex?.isLoggable !== false;

        const existingRows = Array.isArray(existing?.setLogs) ? existing.setLogs : [];
        const prescribedRows = Math.max(1, Number(ex?.prescribedSets || 0) || 1);
        const rowCount = Math.max(existingRows.length || 0, prescribedRows);

        const setLogs = isLoggable
          ? Array.from({ length: rowCount }, (_, idx) => {
              const row = existingRows[idx] || {};
              return {
                weightKg:
                  row?.weightKg != null && row?.weightKg !== ""
                    ? String(row.weightKg)
                    : ex?.prescribedLoadKg != null
                    ? formatWeightLabel(ex.prescribedLoadKg)
                    : "",
                reps:
                  row?.reps != null && row?.reps !== ""
                    ? String(row.reps)
                    : ex?.prescribedReps != null
                    ? String(ex.prescribedReps)
                    : "",
                completed: !!row?.completed,
              };
            })
          : [];

        next[ex.id] = {
          setLogs,
          completed: !!existing?.completed,
          rpe:
            existing?.rpe != null && existing?.rpe !== ""
              ? String(existing.rpe)
              : "",
          notes: String(existing?.notes || ""),
        };
      });

      return next;
    });
  }, [strengthExercises]);

  const liveSummary = useMemo(() => {
    let exercisesLogged = 0;
    let completedSets = 0;
    let totalReps = 0;
    let totalVolumeKg = 0;
    let rpeSum = 0;
    let rpeCount = 0;

    strengthExercises.forEach((exercise) => {
      const entry = entryById?.[exercise.id] || {};
      const setLogsRaw = Array.isArray(entry?.setLogs) ? entry.setLogs : [];
      const setLogs = setLogsRaw.map((setRow) => ({
        loadKg: toNumber(setRow?.weightKg),
        reps: toNumber(setRow?.reps),
        completed: !!setRow?.completed,
      }));

      const metrics = summariseStrengthSetLogs(setLogs);
      const exerciseRpe = toNumber(String(entry?.rpe || "").trim());

      if (metrics.hasData || entry?.completed || String(entry?.notes || "").trim()) {
        exercisesLogged += 1;
      }
      completedSets += metrics.completedSetCount || 0;
      totalReps += metrics.totalReps || 0;
      totalVolumeKg += metrics.volumeKg || 0;
      if (exerciseRpe != null && exerciseRpe >= 1 && exerciseRpe <= 10) {
        rpeSum += exerciseRpe;
        rpeCount += 1;
      }
    });

    return {
      exercisesLogged,
      completedSets,
      totalReps,
      totalVolumeKg: totalVolumeKg ? Number(totalVolumeKg.toFixed(1)) : 0,
      avgRpe: rpeCount ? Number((rpeSum / rpeCount).toFixed(1)) : null,
      hasLoggedWork:
        exercisesLogged > 0 || completedSets > 0 || totalReps > 0 || totalVolumeKg > 0,
    };
  }, [entryById, strengthExercises]);

  const draftSignature = useMemo(
    () =>
      JSON.stringify({
        notes: String(notes || "").trim(),
        status,
        entryById,
        customExercises,
        durationCheckpoint: Math.floor(Math.max(0, Number(elapsedSec || 0)) / 15),
      }),
    [customExercises, elapsedSec, entryById, notes, status]
  );

  const sections = useMemo(() => {
    if (!strengthExercises.length) return [];

    const out = [];
    const byKey = new Map();

    strengthExercises.forEach((item) => {
      const title = String(item?.blockTitle || "").trim() || "Main block";
      const key = title.toLowerCase();

      let section = byKey.get(key);
      if (!section) {
        section = { title, items: [] };
        byKey.set(key, section);
        out.push(section);
      }

      section.items.push(item);
    });

    return out;
  }, [strengthExercises]);

  const sessionTitle = useMemo(
    () =>
      String(
        session?.title || session?.name || session?.type || session?.sessionType || "Strength Session"
      ),
    [session]
  );

  const topMeta = useMemo(() => {
    const bits = [];

    if (dayLabel) bits.push(dayLabel);
    const durationMin = toNumber(session?.targetDurationMin);
    if (durationMin && durationMin > 0) bits.push(`${Math.round(durationMin)} min target`);

    return bits.join(" · ");
  }, [dayLabel, session?.targetDurationMin]);
  const restExerciseTitle = useMemo(() => {
    if (!restExerciseId) return "";
    const match = strengthExercises.find((item) => item?.id === restExerciseId);
    return String(match?.title || "");
  }, [restExerciseId, strengthExercises]);

  const exerciseSuggestions = useMemo(() => {
    const query = normaliseExerciseKey(exerciseDraft.title);
    const existingTitles = new Set(
      [...plannedStrengthExercises, ...customExercises].map((item) =>
        normaliseExerciseKey(item?.title)
      )
    );

    const pool = EXERCISE_SUGGESTIONS.filter((title) => !existingTitles.has(normaliseExerciseKey(title)));

    if (!query) return pool.slice(0, 8);

    return pool
      .filter((title) => normaliseExerciseKey(title).includes(query))
      .slice(0, 8);
  }, [customExercises, exerciseDraft.title]);

  const updateEntry = useCallback((id, patch) => {
    if (!id) return;
    setEntryById((prev) => ({
      ...prev,
      [id]: {
        ...(prev?.[id] || {}),
        ...patch,
      },
    }));
  }, []);

  const updateSetRow = useCallback((exerciseId, setIdx, patch) => {
    if (!exerciseId || setIdx < 0) return;
    setEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      const row = rows[setIdx] || { weightKg: "", reps: "", completed: false };
      rows[setIdx] = { ...row, ...patch };

      const allDone = rows.length > 0 && rows.every((x) => !!x?.completed);

      return {
        ...prev,
        [exerciseId]: {
          ...current,
          setLogs: rows,
          completed: allDone,
        },
      };
    });
  }, []);

  const toggleSetDone = useCallback((exerciseId, setIdx, restSec = 0) => {
    if (!exerciseId || setIdx < 0) return;

    let becameDone = false;

    setEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      const row = rows[setIdx] || { weightKg: "", reps: "", completed: false };
      const completed = !row.completed;
      becameDone = completed;

      rows[setIdx] = {
        ...row,
        completed,
      };

      const allDone = rows.length > 0 && rows.every((x) => !!x?.completed);

      return {
        ...prev,
        [exerciseId]: {
          ...current,
          setLogs: rows,
          completed: allDone,
        },
      };
    });

    const safeRest = Math.max(0, Number(restSec || 0));
    if (becameDone && safeRest > 0 && status !== "skipped") {
      startRestTimer(exerciseId, safeRest);
    }
  }, [startRestTimer, status]);

  const addSetRow = useCallback((exerciseId) => {
    if (!exerciseId) return;

    setEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      const last = rows.length ? rows[rows.length - 1] : null;
      rows.push({
        weightKg: last?.weightKg != null ? String(last.weightKg) : "",
        reps: last?.reps != null ? String(last.reps) : "",
        completed: false,
      });

      return {
        ...prev,
        [exerciseId]: {
          ...current,
          setLogs: rows,
          completed: false,
        },
      };
    });
  }, []);

  const removeSetRow = useCallback((exerciseId, setIdx) => {
    if (!exerciseId) return;

    setEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      if (!rows.length) return prev;

      const safeIndex = Number.isFinite(Number(setIdx)) ? Number(setIdx) : rows.length - 1;
      if (safeIndex < 0 || safeIndex >= rows.length) return prev;

      rows.splice(safeIndex, 1);
      if (!rows.length) rows.push({ weightKg: "", reps: "", completed: false });

      const allDone = rows.length > 0 && rows.every((x) => !!x?.completed);

      return {
        ...prev,
        [exerciseId]: {
          ...current,
          setLogs: rows,
          completed: allDone,
        },
      };
    });
  }, []);

  const removeCustomExercise = useCallback(
    (exerciseId) => {
      setCustomExercises((prev) => prev.filter((item) => item.id !== exerciseId));
      setEntryById((prev) => {
        const next = { ...prev };
        delete next[exerciseId];
        return next;
      });
      if (restExerciseId === exerciseId) {
        clearRestTimer();
      }
    },
    [clearRestTimer, restExerciseId]
  );

  const persistDraft = useCallback(
    async (force = false) => {
      if (!encodedKey || !session || loading || saving) return false;

      const uid = auth.currentUser?.uid;
      if (!uid) return false;

      const durationSecNow = Math.max(0, Math.round(getElapsedNow()));
      const trimmedNotes = String(notes || "").trim();
      const hasDraftContent =
        liveSummary.hasLoggedWork ||
        !!trimmedNotes ||
        customExercises.length > 0 ||
        durationSecNow >= 15;

      const { planId, weekIndex, dayIndex, sessionIndex } = decodedKey;

      if (!hasDraftContent) {
        if (!hasPersistedDraftRef.current) return false;

        await setDoc(
          doc(db, "users", uid, "sessionLogs", encodedKey),
          {
            sessionKey: encodedKey,
            planId: planId || null,
            weekIndex,
            dayIndex,
            sessionIndex,
            updatedAt: serverTimestamp(),
            draft: deleteField(),
          },
          { merge: true }
        );

        hasPersistedDraftRef.current = false;
        lastDraftSignatureRef.current = draftSignature;
        return true;
      }

      if (!force && draftSignature === lastDraftSignatureRef.current) return false;

      await setDoc(
        doc(db, "users", uid, "sessionLogs", encodedKey),
        {
          sessionKey: encodedKey,
          planId: planId || null,
          weekIndex,
          dayIndex,
          sessionIndex,
          updatedAt: serverTimestamp(),
          draft: {
            source: "strength_log_draft",
            status: status === "skipped" ? "skipped" : "in_progress",
            durationSec: durationSecNow,
            notes: trimmedNotes,
            strengthEntryById: entryById || {},
            customExercises,
            savedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );

      hasPersistedDraftRef.current = true;
      lastDraftSignatureRef.current = draftSignature;
      return true;
    },
    [
      customExercises,
      decodedKey,
      draftSignature,
      encodedKey,
      entryById,
      getElapsedNow,
      liveSummary.hasLoggedWork,
      loading,
      notes,
      saving,
      session,
      status,
    ]
  );

  useEffect(() => {
    persistDraftRef.current = persistDraft;
  }, [persistDraft]);

  useEffect(() => {
    if (loading || !session || saving || !encodedKey) return;

    if (!draftHydratedRef.current) {
      draftHydratedRef.current = true;
      lastDraftSignatureRef.current = draftSignature;
      return;
    }

    if (draftSignature === lastDraftSignatureRef.current) return;

    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
    }

    draftSaveTimeoutRef.current = setTimeout(() => {
      draftSaveTimeoutRef.current = null;
      void persistDraft();
    }, 1200);

    return () => {
      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }
    };
  }, [draftSignature, encodedKey, loading, persistDraft, saving, session]);

  const addCustomExercise = useCallback(() => {
    const title = String(exerciseDraft.title || "").trim();
    if (!title) {
      Alert.alert("Add exercise", "Enter an exercise name.");
      return;
    }

    const titleKey = normaliseExerciseKey(title);
    const existingTitles = new Set(
      [...plannedStrengthExercises, ...customExercises].map((item) =>
        normaliseExerciseKey(item?.title)
      )
    );

    if (existingTitles.has(titleKey)) {
      Alert.alert("Add exercise", "That exercise is already on this session.");
      return;
    }

    const nextExercise = normaliseCustomExercise({
      id: `custom_${Date.now()}_${normaliseExerciseKey(title)}`,
      title,
      blockTitle: "Added exercises",
      prescribedSets: exerciseDraft.sets,
      prescribedReps: exerciseDraft.reps,
      prescribedRestSec: exerciseDraft.restSec,
      prescribedRpe: exerciseDraft.rpe,
    });

    if (!nextExercise) return;

    setCustomExercises((prev) => [...prev, nextExercise]);
    setExerciseDraft(EMPTY_EXERCISE_DRAFT);
    setAddExerciseOpen(false);
  }, [customExercises, exerciseDraft, plannedStrengthExercises]);

  const save = useCallback(async (forceEmptySave = false) => {
    const trimmedNotes = String(notes || "").trim();

    if (
      !forceEmptySave &&
      status === "completed" &&
      !liveSummary.hasLoggedWork &&
      !trimmedNotes
    ) {
      Alert.alert(
        "Save completed session?",
        "No sets or notes have been logged yet.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save anyway",
            onPress: () => {
              void save(true);
            },
          },
        ]
      );
      return;
    }

    try {
      if (!encodedKey) {
        Alert.alert("Invalid session", "Missing session key.");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      if (draftSaveTimeoutRef.current) {
        clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }

      setSaving(true);

      const today = formatLocalDate();
      const { planId, weekIndex, dayIndex, sessionIndex } = decodedKey;
      const durationSecNow = Math.max(0, Math.round(getElapsedNow()));
      elapsedBaseSecRef.current = durationSecNow;
      if (timerStartedAtRef.current && isTimerRunning && status !== "skipped") {
        timerStartedAtRef.current = Date.now();
      }
      setElapsedSec(durationSecNow);

      const strengthLogEntries = strengthExercises.map((ex) => {
        const log = entryById?.[ex.id] || {};
        const isLoggable = ex?.isLoggable !== false;
        const setLogsRaw = Array.isArray(log?.setLogs) ? log.setLogs : [];
        const exerciseRpeRaw = Number(String(log?.rpe || "").trim());
        const exerciseRpe =
          Number.isFinite(exerciseRpeRaw) && exerciseRpeRaw >= 1 && exerciseRpeRaw <= 10
            ? Number(exerciseRpeRaw.toFixed(1))
            : null;

        const setLogs = isLoggable
          ? setLogsRaw.map((setRow, idx) => {
              const loadKg = toNumber(setRow?.weightKg);
              const reps = toNumber(setRow?.reps);

              return {
                set: idx + 1,
                loadKg: loadKg != null ? Number(loadKg) : null,
                reps: reps != null ? Number(reps) : null,
                completed: !!setRow?.completed,
              };
            })
          : [];

        const metrics = summariseStrengthSetLogs(setLogs);
        const repsValues = setLogs.map((x) => x.reps).filter((x) => x != null);
        const loadValues = setLogs.map((x) => x.loadKg).filter((x) => x != null);
        const uniformReps =
          repsValues.length && repsValues.every((x) => x === repsValues[0]) ? repsValues[0] : null;
        const uniformLoad =
          loadValues.length && loadValues.every((x) => x === loadValues[0]) ? loadValues[0] : null;
        const completedSetCount = setLogs.filter((x) => x.completed).length;

        return {
          id: ex.id,
          exerciseKey: normaliseExerciseKey(ex.title),
          title: ex.title,
          blockTitle: ex.blockTitle || "",
          isLoggable,
          prescribed: {
            sets: ex.prescribedSets ?? null,
            reps: ex.prescribedReps ?? null,
            loadKg: ex.prescribedLoadKg ?? null,
            restSec: ex.prescribedRestSec ?? null,
            rpe: ex.prescribedRpe ?? null,
          },
          performed: {
            sets: isLoggable && metrics.trackedSetCount ? metrics.trackedSetCount : null,
            reps: isLoggable ? uniformReps : null,
            loadKg: isLoggable ? uniformLoad : null,
            completedSets: isLoggable ? completedSetCount : null,
            setLogs: isLoggable ? setLogs : null,
            completed: !!log?.completed,
            actualRpe: exerciseRpe,
            metrics,
            notes: String(log?.notes || ""),
          },
        };
      });

      const exerciseRpeValues = strengthLogEntries
        .map((entry) => entry?.performed?.actualRpe)
        .filter((value) => value != null);

      const derivedSessionRpe = exerciseRpeValues.length
        ? Number(
            (
              exerciseRpeValues.reduce((sum, value) => sum + value, 0) / exerciseRpeValues.length
            ).toFixed(1)
          )
        : null;

      const loggedExercises = strengthLogEntries.filter((x) => {
        if (!x?.isLoggable) return false;
        return !!x?.performed?.metrics?.hasData || !!x?.performed?.completed;
      }).length;

      const sessionTitleValue =
        session?.title ||
        session?.name ||
        session?.type ||
        session?.sessionType ||
        "Strength Session";

      const basePayload = {
        sessionKey: encodedKey,
        planId: planId || null,
        planName: plan?.name || "Training Plan",
        primaryActivity: plan?.primaryActivity || "strength",
        weekIndex,
        dayIndex,
        sessionIndex,
        dayLabel: dayLabel || null,
        title: sessionTitleValue,
        date: today,
        targetDurationMin:
          toNumber(session?.targetDurationMin) ??
          (toNumber(session?.workout?.totalDurationSec)
            ? Number((toNumber(session?.workout?.totalDurationSec) / 60).toFixed(1))
            : null),
        targetDistanceKm: toNumber(session?.targetDistanceKm),
        actualDurationMin: Number((durationSecNow / 60).toFixed(1)),
        actualDistanceKm: null,
        avgRPE: derivedSessionRpe,
        notes: trimmedNotes,
        live: {
          mode: "strength",
          durationSec: durationSecNow,
          status: status === "skipped" ? "skipped" : "logged",
          strengthEntryById: entryById || {},
        },
        strengthLog: {
          durationSec: durationSecNow,
          loggedExercises,
          notes: trimmedNotes,
          customExercises,
          entries: strengthLogEntries,
        },
        segments: Array.isArray(session?.segments)
          ? session.segments
          : Array.isArray(session?.steps)
          ? session.steps
          : [],
        workout: session?.workout || null,
        status,
        source: "strength_log",
      };

      let trainSessionRef =
        existingTrainSessionId
          ? doc(db, "users", uid, "trainSessions", existingTrainSessionId)
          : doc(collection(db, "users", uid, "trainSessions"));
      let hasExistingTrainSession = false;

      if (existingTrainSessionId) {
        const existingTrainSessionSnap = await getDoc(trainSessionRef);
        hasExistingTrainSession = existingTrainSessionSnap.exists();
        if (!hasExistingTrainSession) {
          trainSessionRef = doc(collection(db, "users", uid, "trainSessions"));
        }
      }

      const statusFieldsForTrainSession =
        status === "completed"
          ? hasExistingTrainSession
            ? {
                updatedAt: serverTimestamp(),
                completedAt: serverTimestamp(),
                skippedAt: deleteField(),
              }
            : {
                createdAt: serverTimestamp(),
                completedAt: serverTimestamp(),
              }
          : hasExistingTrainSession
          ? {
              updatedAt: serverTimestamp(),
              skippedAt: serverTimestamp(),
              completedAt: deleteField(),
            }
          : {
              createdAt: serverTimestamp(),
              skippedAt: serverTimestamp(),
            };

      const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
      const sessionLogPayload = {
        sessionKey: encodedKey,
        planId: planId || null,
        weekIndex,
        dayIndex,
        sessionIndex,
        date: today,
        status,
        source: "strength_log",
        notes: trimmedNotes || null,
        ...(derivedSessionRpe != null ? { avgRPE: derivedSessionRpe } : {}),
        live: basePayload.live,
        strengthLog: basePayload.strengthLog,
        customExercises,
        strengthEntryById: entryById || {},
        lastTrainSessionId: trainSessionRef.id,
        draft: deleteField(),
        updatedAt: serverTimestamp(),
        statusAt: serverTimestamp(),
        ...(status === "completed"
          ? hasExistingSessionLog
            ? { completedAt: serverTimestamp(), skippedAt: deleteField() }
            : { completedAt: serverTimestamp() }
          : hasExistingSessionLog
          ? { skippedAt: serverTimestamp(), completedAt: deleteField() }
          : { skippedAt: serverTimestamp() }),
      };

      if (!hasExistingSessionLog) {
        sessionLogPayload.createdAt = serverTimestamp();
      }

      const criticalBatch = writeBatch(db);
      if (hasExistingTrainSession) {
        criticalBatch.set(
          trainSessionRef,
          {
            ...basePayload,
            ...statusFieldsForTrainSession,
          },
          { merge: true }
        );
      } else {
        criticalBatch.set(trainSessionRef, {
          ...basePayload,
          ...statusFieldsForTrainSession,
        });
      }
      criticalBatch.set(sessionLogRef, sessionLogPayload, { merge: true });
      await criticalBatch.commit();

      setExistingTrainSessionId(trainSessionRef.id);
      setHasExistingSessionLog(true);
      hasPersistedDraftRef.current = false;
      lastDraftSignatureRef.current = draftSignature;

      let progressFailureCount = 0;
      if (status !== "skipped") {
        const progressWrites = strengthLogEntries.flatMap((entry) => {
          if (!entry?.isLoggable || !entry?.performed?.metrics?.hasData) return [];

          const exerciseKey = entry.exerciseKey || normaliseExerciseKey(entry.title);
          const entryDocId = `${encodedKey}__${normaliseExerciseKey(entry.id)}`;
          const latestSnapshot = {
            date: today,
            planId: planId || null,
            planName: plan?.name || null,
            sessionKey: encodedKey,
            trainSessionId: trainSessionRef.id,
            sessionTitle: sessionTitleValue,
            blockTitle: entry.blockTitle || null,
            durationMin: basePayload.actualDurationMin,
            prescribed: entry.prescribed,
            performed: entry.performed,
          };

          return [
            setDoc(
              doc(db, "users", uid, "strengthExerciseProgress", exerciseKey),
              {
                exerciseKey,
                title: entry.title,
                updatedAt: serverTimestamp(),
                lastDate: today,
                lastSessionKey: encodedKey,
                lastTrainSessionId: trainSessionRef.id,
                latest: latestSnapshot,
              },
              { merge: true }
            ),
            setDoc(
              doc(
                db,
                "users",
                uid,
                "strengthExerciseProgress",
                exerciseKey,
                "entries",
                entryDocId
              ),
              {
                exerciseKey,
                title: entry.title,
                sourceExerciseId: entry.id,
                date: today,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                planId: planId || null,
                planName: plan?.name || null,
                sessionKey: encodedKey,
                trainSessionId: trainSessionRef.id,
                weekIndex,
                dayIndex,
                sessionIndex,
                sessionTitle: sessionTitleValue,
                blockTitle: entry.blockTitle || null,
                prescribed: entry.prescribed,
                performed: entry.performed,
              },
              { merge: true }
            ),
          ];
        });

        if (progressWrites.length) {
          const results = await Promise.allSettled(progressWrites);
          progressFailureCount = results.filter((result) => result.status === "rejected").length;
        }
      }

      Alert.alert(
        progressFailureCount ? "Saved with note" : "Saved",
        progressFailureCount
          ? "Strength session saved. Exercise progress details will retry on the next save."
          : status === "skipped"
          ? "Strength session saved as skipped."
          : "Strength session log updated.",
        [
          {
            text: "OK",
            onPress: () => router.replace(`/train/history/${trainSessionRef.id}`),
          },
        ]
      );
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    customExercises,
    dayLabel,
    decodedKey,
    draftSignature,
    encodedKey,
    entryById,
    existingTrainSessionId,
    getElapsedNow,
    hasExistingSessionLog,
    isTimerRunning,
    liveSummary.hasLoggedWork,
    notes,
    plan?.name,
    plan?.primaryActivity,
    router,
    session,
    status,
    strengthExercises,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}> 
        <View style={styles.centerWrap}>
          <Text style={[styles.loadingText, { color: colors.subtext }]}>Loading strength session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !session) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}> 
        <View style={styles.centerWrap}>
          <Text style={[styles.errorText, { color: colors.text }]}>{error || "Session not found."}</Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.primaryBtn, { marginTop: 14, backgroundColor: colors.primary }]}
            activeOpacity={0.9}
          >
            <Text style={{ color: "#111111", fontWeight: "800" }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}> 
      <View style={styles.flex}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.contentWrap}
        >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: "transparent", backgroundColor: cardSoft }]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {sessionTitle}
            </Text>
            {!!topMeta && (
              <Text style={[styles.subtitle, { color: colors.subtext }]} numberOfLines={1}>
                {topMeta}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={() => {
              if (status === "skipped") return;
              if (isTimerRunning) {
                pauseSessionTimer();
              } else {
                startSessionTimer();
              }
            }}
            disabled={status === "skipped"}
            style={[
              styles.iconBtn,
              {
                borderColor: isTimerRunning ? accentBorder : colors.border,
                backgroundColor: status !== "skipped" && isTimerRunning ? accent : colors.card,
                opacity: status === "skipped" ? 0.5 : 1,
              },
            ]}
            activeOpacity={0.85}
          >
            <Feather
              name={isTimerRunning && status !== "skipped" ? "pause" : "play"}
              size={16}
              color={status !== "skipped" && isTimerRunning ? "#111111" : colors.text}
            />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 12, gap: 8 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, styles.cardFlush, { backgroundColor: "transparent", borderColor: "transparent" }]}>
            <View style={styles.elapsedTopRow}>
              <Text style={{ color: colors.subtext, fontWeight: "800", fontSize: 12 }}>Strength log</Text>
              {status === "skipped" ? (
                <View style={[styles.sessionModePill, { backgroundColor: "rgba(239,68,68,0.18)" }]}>
                  <Text style={[styles.sessionModePillText, { color: colors.text }]}>Skipped</Text>
                </View>
              ) : null}
            </View>

            <Text style={[styles.bigTime, { marginTop: 2, fontSize: 52, color: colors.text }]}>
              {secondsToClock(elapsedSec)}
            </Text>
            <View style={styles.elapsedMetaRow}>
              <Text style={{ color: colors.subtext, fontSize: 12 }}>Time of day · {timeOfDayLabel}</Text>
              {!!topMeta && (
                <Text style={{ color: colors.subtext, fontSize: 12 }} numberOfLines={1}>
                  {topMeta}
                </Text>
              )}
            </View>

            <View style={[styles.timerAccentBar, { backgroundColor: accent }]} />

            <View style={styles.summaryGrid}>
              <View style={[styles.summaryTile, { backgroundColor: cardSoft }]}>
                <Text style={[styles.summaryTileLabel, { color: colors.subtext }]}>Exercises</Text>
                <Text style={[styles.summaryTileValue, { color: colors.text }]}>
                  {liveSummary.exercisesLogged}
                </Text>
              </View>
              <View style={[styles.summaryTile, { backgroundColor: cardSoft }]}>
                <Text style={[styles.summaryTileLabel, { color: colors.subtext }]}>Sets</Text>
                <Text style={[styles.summaryTileValue, { color: colors.text }]}>
                  {liveSummary.completedSets}
                </Text>
              </View>
              <View style={[styles.summaryTile, { backgroundColor: cardSoft }]}>
                <Text style={[styles.summaryTileLabel, { color: colors.subtext }]}>Reps</Text>
                <Text style={[styles.summaryTileValue, { color: colors.text }]}>
                  {liveSummary.totalReps || 0}
                </Text>
              </View>
            </View>

            {status !== "skipped" && restSecLeft > 0 ? (
              <View
                style={[
                  styles.strengthRestBanner,
                  {
                    backgroundColor: accent,
                    borderColor: "transparent",
                  },
                ]}
              >
                <View>
                  <Text style={{ color: "#111111", fontWeight: "800", fontSize: 11 }}>
                    {restExerciseTitle ? `${restExerciseTitle} rest` : "Rest timer"}
                  </Text>
                  <Text style={{ color: "#111111", fontWeight: "900", fontSize: 18, marginTop: 2 }}>
                    {secondsToClock(restSecLeft)}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={clearRestTimer}
                  style={[styles.strengthRestSkipBtn, { backgroundColor: "rgba(17,17,17,0.12)" }]}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: "#111111", fontWeight: "800" }}>Skip</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View style={[styles.card, styles.cardFlush, { backgroundColor: "transparent", borderColor: "transparent" }]}>
            <View style={styles.stepsHeaderRow}>
              <Text style={[styles.weekTitle, { color: colors.text }]}>Strength Session Builder</Text>
              <View style={[styles.strengthLayoutBadge, { borderColor: "transparent", backgroundColor: accentSoft }]}>
                <Text style={[styles.strengthLayoutBadgeText, { color: accent }]}>STRENGTH LOG</Text>
              </View>
            </View>

            <View style={{ marginTop: 8, gap: 8 }}>
              {sections.map((section, sectionIdx) => (
                <View key={`section-${section.title}-${sectionIdx}`} style={styles.strengthSectionWrap}>
                  <View
                    style={[
                      styles.strengthBlockHeader,
                      {
                        backgroundColor: "transparent",
                        borderColor: "transparent",
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.strengthBlockOverline, { color: colors.subtext }]}>
                        Block {sectionIdx + 1}
                      </Text>
                      <Text style={[styles.strengthBlockTitle, { color: colors.text }]}>{section.title}</Text>
                    </View>
                  </View>

                  {section.items.map((item, itemIdx) => {
                    const entry = entryById?.[item.id] || {};
                    const setLogs = Array.isArray(entry?.setLogs) ? entry.setLogs : [];
                    const completedSets = setLogs.filter((row) => !!row?.completed).length;
                    const allSetsComplete = !!setLogs.length && completedSets === setLogs.length;
                    const exerciseDone = allSetsComplete;
                    const prescriptionLabel = [
                      item.prescribedSets && item.prescribedReps
                        ? `${item.prescribedSets} x ${item.prescribedReps}`
                        : item.prescribedSets
                        ? `${item.prescribedSets} sets`
                        : item.prescribedReps
                        ? `${item.prescribedReps} reps`
                        : null,
                      item.prescribedLoadKg ? `${formatWeightLabel(item.prescribedLoadKg)} kg` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <View
                        key={`strength-preview-${item.id}`}
                        style={[
                          styles.exerciseCard,
                          {
                            backgroundColor: cardSoft,
                            borderColor:
                              restExerciseId === item.id && restSecLeft > 0 ? accentBorder : "transparent",
                          },
                        ]}
                      >
                        <View style={styles.exerciseTopRow}>
                          <View style={styles.exerciseTitleRow}>
                            <Text style={[styles.exerciseNumber, { color: colors.subtext }]}>
                              {itemIdx + 1}
                            </Text>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.exerciseTitle, { color: colors.text }]}>
                                {item.title || "Exercise"}
                              </Text>
                              {!!prescriptionLabel && (
                                <Text style={[styles.exercisePrescription, { color: colors.subtext }]}>
                                  {prescriptionLabel}
                                </Text>
                              )}
                            </View>
                          </View>
                          <View style={styles.exerciseTopActions}>
                            {exerciseDone ? (
                              <View
                                style={[
                                  styles.strengthSetProgressPill,
                                  {
                                    borderColor: "transparent",
                                    backgroundColor: "rgba(22,163,74,0.16)",
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.strengthSetProgressText,
                                    {
                                      color: success,
                                    },
                                  ]}
                                >
                                  Done
                                </Text>
                              </View>
                            ) : null}

                            {item.isCustom ? (
                              <TouchableOpacity
                                onPress={() => removeCustomExercise(item.id)}
                                style={[
                                  styles.exerciseRemoveBtn,
                                  { backgroundColor: "rgba(255,255,255,0.05)" },
                                ]}
                                activeOpacity={0.85}
                              >
                                <Feather name="x" size={12} color={colors.subtext} />
                                <Text style={[styles.exerciseRemoveBtnText, { color: colors.subtext }]}>
                                  Remove
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>

                        <View style={styles.exerciseMetaRow}>
                          {item.prescribedRestSec ? (
                            <View
                              style={[
                                styles.exerciseMetaPill,
                                { backgroundColor: accent, borderColor: "transparent" },
                              ]}
                            >
                              <Text style={[styles.exerciseMetaPillText, { color: "#111111" }]}>
                                Rest {item.prescribedRestSec}s
                              </Text>
                            </View>
                          ) : null}

                          {item.prescribedRpe ? (
                            <View
                              style={[
                                styles.exerciseMetaPill,
                                { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "transparent" },
                              ]}
                            >
                              <Text style={[styles.exerciseMetaPillText, { color: colors.text }]}>
                                Target RPE {item.prescribedRpe}
                              </Text>
                            </View>
                          ) : null}

                          {restExerciseId === item.id && restSecLeft > 0 ? (
                            <View
                              style={[
                                styles.exerciseMetaPill,
                                { backgroundColor: accent, borderColor: "transparent" },
                              ]}
                            >
                              <Text style={[styles.exerciseMetaPillText, { color: "#111111" }]}>
                                {secondsToClock(restSecLeft)} left
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.strengthSetGrid}>
                          <View style={styles.strengthSetHeaderRow}>
                            <Text style={[styles.strengthSetHeaderText, { color: colors.subtext, width: 44 }]}>
                              Set
                            </Text>
                            <Text
                              style={[
                                styles.strengthSetHeaderText,
                                { color: colors.subtext, width: 76, textAlign: "center" },
                              ]}
                            >
                              Kg
                            </Text>
                            <Text
                              style={[
                                styles.strengthSetHeaderText,
                                { color: colors.subtext, width: 76, textAlign: "center" },
                              ]}
                            >
                              Reps
                            </Text>
                            <Text
                              style={[
                                styles.strengthSetHeaderText,
                                { color: colors.subtext, width: 52, textAlign: "center" },
                              ]}
                            >
                              Done
                            </Text>
                          </View>

                          {setLogs.map((setRow, setIdx) => (
                            <View key={`${item.id}-set-${setIdx}`} style={styles.strengthSetRow}>
                              <View
                                style={[
                                  styles.strengthSetIndex,
                                  { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "transparent" },
                                ]}
                              >
                                <Text style={[styles.strengthSetIndexText, { color: colors.text }]}>
                                  {setIdx + 1}
                                </Text>
                              </View>

                              <View
                                style={[
                                  styles.strengthSetInputWrap,
                                  { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "transparent" },
                                ]}
                              >
                                <TextInput
                                  value={String(setRow?.weightKg || "")}
                                  onChangeText={(value) =>
                                    updateSetRow(item.id, setIdx, {
                                      weightKg: value.replace(/[^0-9.]/g, ""),
                                    })
                                  }
                                  keyboardAppearance={keyboardAppearance}
                                  keyboardType="decimal-pad"
                                  placeholder="0"
                                  placeholderTextColor={colors.subtext}
                                  style={[styles.strengthSetInput, { color: colors.text }]}
                                />
                              </View>

                              <View
                                style={[
                                  styles.strengthSetInputWrap,
                                  { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "transparent" },
                                ]}
                              >
                                <TextInput
                                  value={String(setRow?.reps || "")}
                                  onChangeText={(value) =>
                                    updateSetRow(item.id, setIdx, {
                                      reps: value.replace(/[^0-9]/g, ""),
                                    })
                                  }
                                  keyboardAppearance={keyboardAppearance}
                                  keyboardType="number-pad"
                                  placeholder="0"
                                  placeholderTextColor={colors.subtext}
                                  style={[styles.strengthSetInput, { color: colors.text }]}
                                />
                              </View>

                              <TouchableOpacity
                                onPress={() => toggleSetDone(item.id, setIdx, item?.prescribedRestSec || 0)}
                                style={[
                                  styles.strengthSetDoneBtn,
                                  {
                                    backgroundColor: setRow?.completed
                                      ? "rgba(22,163,74,0.16)"
                                      : "rgba(255,255,255,0.05)",
                                    borderColor: "transparent",
                                  },
                                ]}
                                activeOpacity={0.85}
                              >
                                <Feather
                                  name={setRow?.completed ? "check" : "circle"}
                                  size={14}
                                  color={setRow?.completed ? success : colors.subtext}
                                />
                              </TouchableOpacity>
                            </View>
                          ))}

                          <View style={styles.strengthSetActionRow}>
                            <TouchableOpacity
                              onPress={() => addSetRow(item.id)}
                              style={[
                                styles.strengthSetActionBtn,
                                { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "transparent" },
                              ]}
                              activeOpacity={0.85}
                            >
                              <Feather name="plus" size={14} color={colors.text} />
                              <Text style={[styles.strengthSetActionText, { color: colors.text }]}>Add set</Text>
                            </TouchableOpacity>

                            {setLogs.length > 1 ? (
                              <TouchableOpacity
                                onPress={() => removeSetRow(item.id, setLogs.length - 1)}
                                style={[
                                  styles.strengthSetActionBtn,
                                  { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "transparent" },
                                ]}
                                activeOpacity={0.85}
                              >
                                <Feather name="minus" size={14} color={colors.subtext} />
                                <Text style={[styles.strengthSetActionText, { color: colors.subtext }]}>
                                  Remove last
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>

                        <View style={styles.exerciseFooterRow}>
                          <View
                            style={[
                              styles.exerciseRpeField,
                              {
                                backgroundColor: "rgba(255,255,255,0.05)",
                                borderColor: "transparent",
                              },
                            ]}
                          >
                            <Text style={[styles.exerciseRpeLabel, { color: colors.subtext }]}>RPE</Text>
                            <TextInput
                              value={String(entry.rpe || "")}
                              onChangeText={(value) =>
                                updateEntry(item.id, { rpe: value.replace(/[^0-9.]/g, "") })
                              }
                              keyboardAppearance={keyboardAppearance}
                              keyboardType="decimal-pad"
                              placeholder={item.prescribedRpe ? String(item.prescribedRpe) : "7.5"}
                              placeholderTextColor={colors.subtext}
                              style={[styles.exerciseRpeInput, { color: colors.text }]}
                            />
                          </View>

                          <TextInput
                            value={String(entry.notes || "")}
                            onChangeText={(value) => updateEntry(item.id, { notes: value })}
                            keyboardAppearance={keyboardAppearance}
                            placeholder="Exercise notes"
                            placeholderTextColor={colors.subtext}
                            style={[
                              styles.strengthExerciseNotes,
                              {
                                color: colors.text,
                                backgroundColor: "rgba(255,255,255,0.05)",
                                borderColor: "transparent",
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.card, styles.cardFlush, { backgroundColor: "transparent", borderColor: "transparent" }]}>
            <TouchableOpacity
              onPress={() => setAddExerciseOpen((prev) => !prev)}
              style={[styles.addExerciseToggle, { backgroundColor: cardSoft }]}
              activeOpacity={0.85}
            >
              <View style={styles.addExerciseToggleTextWrap}>
                <Text style={[styles.label, { color: colors.subtext }]}>Add Exercise</Text>
                {!!customExercises.length && (
                  <Text style={[styles.addExerciseCountText, { color: colors.subtext }]}>
                    {customExercises.length} added
                  </Text>
                )}
              </View>

              <Feather
                name={addExerciseOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.text}
              />
            </TouchableOpacity>

            {addExerciseOpen ? (
              <View style={[styles.addExerciseCard, { backgroundColor: cardSoft }]}>
                <TextInput
                  value={exerciseDraft.title}
                  onChangeText={(value) => setExerciseDraft((prev) => ({ ...prev, title: value }))}
                  keyboardAppearance={keyboardAppearance}
                  placeholder="Exercise name"
                  placeholderTextColor={colors.subtext}
                  style={[styles.addExerciseTitleInput, { color: colors.text, backgroundColor: "rgba(255,255,255,0.05)" }]}
                />

                {exerciseSuggestions.length ? (
                  <View style={styles.exerciseSuggestionWrap}>
                    <Text style={[styles.exerciseSuggestionLabel, { color: colors.subtext }]}>
                      Suggestions
                    </Text>
                    <View style={styles.exerciseSuggestionRow}>
                      {exerciseSuggestions.map((title) => (
                        <TouchableOpacity
                          key={title}
                          onPress={() =>
                            setExerciseDraft((prev) => ({
                              ...prev,
                              title,
                            }))
                          }
                          style={[styles.exerciseSuggestionChip, { backgroundColor: "rgba(255,255,255,0.05)" }]}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.exerciseSuggestionText, { color: colors.text }]}>{title}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View style={styles.addExerciseFieldRow}>
                  <View style={[styles.addExerciseMiniField, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
                    <Text style={[styles.addExerciseMiniLabel, { color: colors.subtext }]}>Sets</Text>
                    <TextInput
                      value={exerciseDraft.sets}
                      onChangeText={(value) =>
                        setExerciseDraft((prev) => ({ ...prev, sets: value.replace(/[^0-9]/g, "") }))
                      }
                      keyboardAppearance={keyboardAppearance}
                      keyboardType="number-pad"
                      placeholder="3"
                      placeholderTextColor={colors.subtext}
                      style={[styles.addExerciseMiniInput, { color: colors.text }]}
                    />
                  </View>

                  <View style={[styles.addExerciseMiniField, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
                    <Text style={[styles.addExerciseMiniLabel, { color: colors.subtext }]}>Reps</Text>
                    <TextInput
                      value={exerciseDraft.reps}
                      onChangeText={(value) =>
                        setExerciseDraft((prev) => ({ ...prev, reps: value.replace(/[^0-9]/g, "") }))
                      }
                      keyboardAppearance={keyboardAppearance}
                      keyboardType="number-pad"
                      placeholder="8"
                      placeholderTextColor={colors.subtext}
                      style={[styles.addExerciseMiniInput, { color: colors.text }]}
                    />
                  </View>

                  <View style={[styles.addExerciseMiniField, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
                    <Text style={[styles.addExerciseMiniLabel, { color: colors.subtext }]}>Rest</Text>
                    <TextInput
                      value={exerciseDraft.restSec}
                      onChangeText={(value) =>
                        setExerciseDraft((prev) => ({ ...prev, restSec: value.replace(/[^0-9]/g, "") }))
                      }
                      keyboardAppearance={keyboardAppearance}
                      keyboardType="number-pad"
                      placeholder="90"
                      placeholderTextColor={colors.subtext}
                      style={[styles.addExerciseMiniInput, { color: colors.text }]}
                    />
                  </View>

                  <View style={[styles.addExerciseMiniField, { backgroundColor: "rgba(255,255,255,0.05)" }]}>
                    <Text style={[styles.addExerciseMiniLabel, { color: colors.subtext }]}>RPE</Text>
                    <TextInput
                      value={exerciseDraft.rpe}
                      onChangeText={(value) =>
                        setExerciseDraft((prev) => ({ ...prev, rpe: value.replace(/[^0-9.]/g, "") }))
                      }
                      keyboardAppearance={keyboardAppearance}
                      keyboardType="decimal-pad"
                      placeholder="8"
                      placeholderTextColor={colors.subtext}
                      style={[styles.addExerciseMiniInput, { color: colors.text }]}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  onPress={addCustomExercise}
                  style={[styles.addExerciseBtn, { backgroundColor: accentSoft }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus" size={15} color={accent} />
                  <Text style={[styles.addExerciseBtnText, { color: accent }]}>Add exercise</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View style={[styles.card, styles.cardFlush, { backgroundColor: "transparent", borderColor: "transparent" }]}>
            <Text style={[styles.label, { color: colors.subtext }]}>Session Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              keyboardAppearance={keyboardAppearance}
              placeholder="How did this session feel?"
              placeholderTextColor={colors.subtext}
              multiline
              style={[styles.strengthSessionNotes, { color: colors.text, backgroundColor: cardSoft }]}
            />
          </View>
        </ScrollView>
        </KeyboardAvoidingView>

        <View style={[styles.footer, { borderTopColor: "transparent", backgroundColor: colors.bg }]}> 
          <TouchableOpacity
            onPress={() => {
              void save();
            }}
            disabled={saving}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: saving ? accentMuted : accent,
                borderColor: saving ? "transparent" : accentBorder,
                shadowColor: accent,
                shadowOpacity: saving ? 0 : 0.32,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 10 },
                elevation: saving ? 0 : 8,
              },
            ]}
            activeOpacity={0.9}
          >
            <Feather
              name={status === "skipped" ? "skip-forward" : "check-circle"}
              size={18}
              color="#111111"
            />
            <Text style={{ color: "#111111", fontWeight: "800", marginLeft: 8 }}>
              {saving ? "Saving..." : status === "skipped" ? "Save as skipped" : "Save strength log"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: 16, paddingTop: 6 },
  contentWrap: { flex: 1 },
  centerWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  loadingText: { fontSize: 14, fontWeight: "600" },
  errorText: { fontSize: 15, textAlign: "center", fontWeight: "700" },

  card: {
    borderWidth: 0,
    borderRadius: 14,
    padding: 10,
    gap: 6,
  },
  cardFlush: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  weekTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  bigTime: {
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  elapsedTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sessionModePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sessionModePillText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  elapsedMetaRow: {
    marginTop: 2,
    gap: 2,
  },
  timerAccentBar: {
    width: 72,
    height: 4,
    borderRadius: 999,
    marginTop: 2,
  },
  summaryGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  summaryTile: {
    width: "31%",
    flexGrow: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  summaryTileLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryTileValue: {
    fontSize: 15,
    fontWeight: "900",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    gap: 10,
  },
  headerCenter: { flex: 1, minWidth: 0 },
  iconBtn: {
    width: 40,
    height: 34,
    borderRadius: 999,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "900" },
  subtitle: { marginTop: 1, fontSize: 11, fontWeight: "600" },

  strengthRestBanner: {
    marginTop: 6,
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  strengthRestSkipBtn: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },

  stepsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  strengthLayoutBadge: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  strengthLayoutBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  strengthSectionWrap: {
    gap: 6,
    marginTop: 0,
  },
  strengthBlockHeader: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 2,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  strengthBlockOverline: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  strengthBlockTitle: {
    marginTop: 1,
    fontSize: 14,
    fontWeight: "800",
  },

  exerciseCard: {
    borderWidth: 0,
    borderRadius: 12,
    padding: 9,
    gap: 6,
  },
  exerciseTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  exerciseTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  exerciseTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  exerciseNumber: {
    fontSize: 14,
    fontWeight: "900",
    width: 18,
    textAlign: "left",
  },
  exerciseTitle: {
    fontSize: 17,
    fontWeight: "800",
    flex: 1,
  },
  exercisePrescription: {
    marginTop: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  exerciseMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  exerciseMetaPill: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  exerciseMetaPillText: {
    fontSize: 10,
    fontWeight: "800",
  },
  strengthSetProgressPill: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  strengthSetProgressText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  exerciseRemoveBtn: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  exerciseRemoveBtnText: {
    fontSize: 10,
    fontWeight: "800",
  },
  strengthSetGrid: {
    marginTop: 2,
    gap: 4,
  },
  strengthSetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  strengthSetHeaderText: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  strengthSetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  strengthSetIndex: {
    width: 44,
    height: 34,
    borderWidth: 0,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  strengthSetIndexText: { fontSize: 12, fontWeight: "900" },

  strengthSetInputWrap: {
    width: 76,
    height: 34,
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  strengthSetInput: {
    textAlign: "center",
    paddingVertical: 0,
    fontSize: 14,
    fontWeight: "900",
  },

  strengthSetDoneBtn: {
    width: 52,
    height: 34,
    borderWidth: 0,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  strengthSetActionRow: {
    marginTop: 1,
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  strengthSetActionBtn: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  strengthSetActionText: {
    fontSize: 10,
    fontWeight: "800",
  },
  exerciseFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 1,
  },
  exerciseRpeField: {
    width: 82,
    height: 40,
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  exerciseRpeLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  exerciseRpeInput: {
    marginTop: 1,
    paddingVertical: 0,
    fontSize: 14,
    fontWeight: "800",
  },

  strengthExerciseNotes: {
    flex: 1,
    height: 40,
    marginTop: 0,
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 11,
    fontWeight: "600",
  },
  addExerciseCard: {
    borderRadius: 12,
    padding: 10,
    gap: 8,
    marginTop: 6,
  },
  addExerciseToggle: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  addExerciseToggleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  addExerciseCountText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
  },
  addExerciseTitleInput: {
    height: 42,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: "700",
  },
  exerciseSuggestionWrap: {
    gap: 6,
  },
  exerciseSuggestionLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  exerciseSuggestionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  exerciseSuggestionChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  exerciseSuggestionText: {
    fontSize: 11,
    fontWeight: "700",
  },
  addExerciseFieldRow: {
    flexDirection: "row",
    gap: 6,
  },
  addExerciseMiniField: {
    flex: 1,
    minWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addExerciseMiniLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  addExerciseMiniInput: {
    marginTop: 2,
    paddingVertical: 0,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  addExerciseBtn: {
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  addExerciseBtnText: {
    fontSize: 12,
    fontWeight: "800",
  },
  strengthSessionNotes: {
    marginTop: 6,
    minHeight: 92,
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlignVertical: "top",
    fontSize: 13,
    fontWeight: "600",
  },
  footer: {
    borderTopWidth: 0,
    paddingVertical: 8,
  },
  primaryBtn: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
});
