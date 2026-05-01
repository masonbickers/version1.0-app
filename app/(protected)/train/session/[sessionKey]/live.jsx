// app/(protected)/train/session/[sessionKey]/live.jsx

import { Feather } from "@expo/vector-icons";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import MapView, { Polyline } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../../../../../config/api";
import { auth, db } from "../../../../../firebaseConfig";
import { useLiveActivity } from "../../../../../providers/LiveActivityProvider";
import { useTheme } from "../../../../../providers/ThemeProvider";
import {
  hasLiveActivitySnapshot,
  isLiveActivityStale,
  normaliseLiveActivityStatus,
  shouldPauseStaleLiveActivity,
} from "../../../../../src/train/utils/liveActivityHelpers";
import { decodeSessionKey, isAuxStrengthStep } from "../../../../../src/train/utils/sessionHelpers";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_REGION = {
  latitude: 51.5072,
  longitude: -0.1276,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const WATCH_OPTIONS = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1000,
  distanceInterval: 5,
};

const MAX_SPIKE_M = 120;
const MAX_ACC_M = 50;
const STATIONARY_SPEED_MPS = 0.35;
const AUTO_PAUSE_GRACE_SEC = 4;
const AUTO_RESUME_GRACE_SEC = 2;
const GPS_STALE_MS = 6000;
const MAX_COORD_HISTORY = 5000;

/* ------------------------------------------------------------------ */
/* Theme                                                              */
/* ------------------------------------------------------------------ */

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const accent = colors?.accentBg ?? colors?.sapPrimary ?? colors?.primary ?? "#E6FF3B";
  return {
    bg: colors?.bg ?? (isDark ? "#050506" : "#F5F5F7"),
    card: colors?.card ?? (isDark ? "#101219" : "#F3F4F6"),
    card2: isDark ? "#0E0F12" : "#FFFFFF",
    cardSoft: colors?.surfaceAlt ?? (isDark ? "#0B0C10" : "#FFFFFF"),
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: colors?.border ?? (isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)"),
    primaryBg: accent,
    primaryText: colors?.sapOnPrimary ?? "#111111",
    primaryBorder: colors?.accentBorder ?? (isDark ? accent : "#BFD82A"),
    danger: "#DC2626",
    success: "#16A34A",
    warning: "#F59E0B",
    muted: isDark ? "#18181B" : "#EEF2F7",
    isDark,
  };
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                    */
/* ------------------------------------------------------------------ */

function uidOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in.");
  return u.uid;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normaliseList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

function secondsToMMSS(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function secondsToHMMSS(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function paceFrom(distanceKm, durationSec) {
  if (!distanceKm || !durationSec) return null;
  const secPerKm = durationSec / distanceKm;
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return null;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normaliseRunState(state) {
  return normaliseLiveActivityStatus(state);
}

/* ------------------------------------------------------------------ */
/* Plan extraction helpers                                            */
/* ------------------------------------------------------------------ */

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

  for (const c of candidates) {
    const w = normaliseList(c);
    if (w.length) return w;
  }
  return [];
}

function getSessionFromPlan(data, weekIndex, dayIndex, sessionIndex) {
  const weeks = extractWeeks(data);
  const week = weeks?.[weekIndex];

  if (!week) return { week: null, day: null, sess: null, dayLabel: "" };

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

  return { week, day, sess, dayLabel };
}

/* ------------------------------------------------------------------ */
/* Plan fetching                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Session / run helpers                                              */
/* ------------------------------------------------------------------ */

function isRunStep(step) {
  const t = String(step?.type || "").toUpperCase();
  return t === "RUN";
}

function summariseDuration(duration) {
  if (!duration) return "";
  const type = String(duration.type || "").toUpperCase();

  if (type === "TIME") {
    const s = Number(duration.seconds || 0);
    return s ? `${Math.round(s / 60)} min` : "";
  }

  if (type === "DISTANCE") {
    const m = Number(duration.meters || 0);
    if (!m) return "";
    if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 2)} km`;
    return `${m} m`;
  }

  return "";
}

function flattenSteps(steps, depth = 0) {
  const out = [];

  for (const st of Array.isArray(steps) ? steps : []) {
    const type = String(st?.type || "").toUpperCase();

    if (type === "REPEAT") {
      const rep = Number(st?.repeat || 0) || 0;
      out.push({
        kind: "repeat",
        depth,
        title: st?.name || "Repeat",
        subtitle: rep ? `${rep}×` : "",
      });
      out.push(...flattenSteps(st?.steps || [], depth + 1));
    } else {
      out.push({
        kind: "step",
        depth,
        title: st?.name || type || "Step",
        subtitle: summariseDuration(st?.duration),
        step: st,
      });
    }
  }

  return out;
}

function expandStepsToSequence(steps, depth = 0, parentRepeatKey = "") {
  const seq = [];
  const arr = Array.isArray(steps) ? steps : [];

  for (let i = 0; i < arr.length; i += 1) {
    const st = arr[i];
    const type = String(st?.type || "").toUpperCase();

    if (type === "REPEAT") {
      const repRaw = Number(st?.repeat || 0) || 0;
      const rep = Math.max(1, repRaw || 1);
      const repeatName = st?.name || "Repeat";
      const keyBase = `${parentRepeatKey}R${depth}_${i}_${repeatName}`.replace(/\s+/g, "_");

      for (let r = 0; r < rep; r += 1) {
        const childSeq = expandStepsToSequence(
          st?.steps || [],
          depth + 1,
          `${keyBase}_${r + 1}of${rep}_`
        );

        seq.push(
          ...childSeq.map((x) => ({
            ...x,
            repeatContext: {
              ...(x.repeatContext || {}),
              top: repeatName,
              repIndex: r + 1,
              repTotal: rep,
            },
          }))
        );
      }
    } else {
      const dur = st?.duration || null;
      const durType = String(dur?.type || "").toUpperCase();
      const timeSec = durType === "TIME" ? Number(dur?.seconds || 0) || 0 : 0;
      const distM = durType === "DISTANCE" ? Number(dur?.meters || 0) || 0 : 0;

      seq.push({
        kind: "exec",
        depth,
        key: `${parentRepeatKey}S${depth}_${i}_${st?.name || type || "Step"}`,
        title: st?.name || type || "Step",
        type,
        target: st?.target || null,
        notes: st?.notes || "",
        duration: dur || null,
        durationLabel: summariseDuration(dur),
        timeSec: timeSec > 0 ? timeSec : null,
        distanceM: distM > 0 ? distM : null,
        raw: st,
      });
    }
  }

  return seq;
}

function deriveTotalsFromSteps(steps) {
  let totalSeconds = 0;
  let totalMeters = 0;

  function walk(arr, multiplier = 1) {
    for (const st of Array.isArray(arr) ? arr : []) {
      const type = String(st?.type || "").toUpperCase();

      if (type === "REPEAT") {
        const rep = Number(st?.repeat || 0) || 0;
        walk(st?.steps || [], multiplier * Math.max(1, rep));
      } else {
        const dur = st?.duration || {};
        const dType = String(dur?.type || "").toUpperCase();

        if (dType === "TIME") {
          totalSeconds += (Number(dur.seconds || 0) || 0) * multiplier;
        }

        if (dType === "DISTANCE") {
          totalMeters += (Number(dur.meters || 0) || 0) * multiplier;
        }
      }
    }
  }

  walk(steps);

  return {
    totalDurationSec: totalSeconds || null,
    totalDistanceKm: totalMeters ? totalMeters / 1000 : null,
  };
}

function formatClockHHMM(value) {
  const d = value ? new Date(value) : new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function strengthBlocksToPreview(blocks) {
  const out = [];
  const list = Array.isArray(blocks) ? blocks : [];

  for (const block of list) {
    const blockTitle = String(block?.title || block?.name || block?.kind || "Block").trim();
    const items = Array.isArray(block?.items) ? block.items : [];

    if (!items.length) {
      out.push({ title: blockTitle, subtitle: "" });
      continue;
    }

    for (const item of items) {
      const title = String(item?.title || item?.name || blockTitle || "Exercise").trim();
      const bits = [];

      const sets = Number(item?.sets || 0);
      const reps = Number(item?.reps || 0);
      const timeSec = Number(item?.timeSec ?? item?.durationSec ?? 0);
      const restSec = Number(item?.restSec || 0);
      const loadKg = Number(item?.loadKg || 0);
      const load = String(item?.load || "").trim();

      if (sets > 0 && reps > 0) bits.push(`${sets}x${reps}`);
      else if (reps > 0) bits.push(`${reps} reps`);
      if (timeSec > 0) bits.push(`${Math.round(timeSec)}s`);
      if (restSec > 0) bits.push(`rest ${Math.round(restSec)}s`);
      if (loadKg > 0) bits.push(`${loadKg} kg`);
      if (load) bits.push(load);

      out.push({
        title,
        subtitle: bits.join(" · "),
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

export default function LiveTrainSession() {
  const theme = useScreenTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sessionKey } = useLocalSearchParams();
  const { hydrated: liveHydrated, liveActivity, setLiveActivity, clearLiveActivity } =
    useLiveActivity();

  const ScreenHeader = useMemo(
    () => <Stack.Screen options={{ headerShown: false }} />,
    []
  );

  const [keepAwakeOn, setKeepAwakeOn] = useState(false);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [dayLabel, setDayLabel] = useState("");
  const [error, setError] = useState("");

  const [actualDuration] = useState("");
  const [actualDistance] = useState("");
  const [rpe] = useState("");
  const [notes, setNotes] = useState("");
  const [strengthEntryById, setStrengthEntryById] = useState({});

  const [hasLocPerm, setHasLocPerm] = useState(false);
  const [coords, setCoords] = useState([]);
  const [liveDistanceM, setLiveDistanceM] = useState(0);
  const [liveDurationSec, setLiveDurationSec] = useState(0);
  const [movingDurationSec, setMovingDurationSec] = useState(0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [beaconEnabled, setBeaconEnabled] = useState(true);
  const [followUser, setFollowUser] = useState(true);
  const [cueFeedbackEnabled, setCueFeedbackEnabled] = useState(true);

  const [beaconLink, setBeaconLink] = useState(null);

  const [runState, setRunState] = useState("idle"); // idle | acquiring | running | paused
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());

  const [gpsAcquired, setGpsAcquired] = useState(false);
  const [splits, setSplits] = useState([]);
  const [strengthRestSecLeft, setStrengthRestSecLeft] = useState(0);
  const [strengthRestExerciseId, setStrengthRestExerciseId] = useState(null);

  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const [bootRegion, setBootRegion] = useState(DEFAULT_REGION);

  const encodedKey = useMemo(
    () => (Array.isArray(sessionKey) ? sessionKey[0] : sessionKey),
    [sessionKey]
  );
  const liveRoute = useMemo(
    () =>
      encodedKey
        ? `/train/session/${encodeURIComponent(encodedKey)}/live`
        : null,
    [encodedKey]
  );
  const matchesPersistedLiveSession = useMemo(
    () =>
      (liveRoute && String(liveActivity?.route || "") === String(liveRoute)) ||
      (encodedKey && String(liveActivity?.sessionKey || "") === String(encodedKey)),
    [encodedKey, liveActivity?.route, liveActivity?.sessionKey, liveRoute]
  );

  const watchRef = useRef(null);
  const timerRef = useRef(null);
  const mapRef = useRef(null);
  const lastFixAtRef = useRef(0);
  const lastCoordRef = useRef(null);
  const nextSplitKmRef = useRef(1);
  const lastSplitTimeRef = useRef(0);
  const lastSplitDistanceMRef = useRef(0);
  const stationarySecRef = useRef(0);
  const movingSecRef = useRef(0);
  const stepStartTimeRef = useRef(0);
  const stepStartDistRef = useRef(0);
  const lastAutoAdvanceAtRef = useRef(0);
  const beaconSessionIdRef = useRef(null);
  const lastLiveUpdateAtRef = useRef(0);
  const restoredFromLiveRef = useRef(false);
  const latestLiveDraftRef = useRef(null);
  const suppressLivePersistRef = useRef(false);

  /* -------------------------------------------------------------- */
  /* Keep awake                                                     */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    (async () => {
      try {
        if (keepAwakeOn) await activateKeepAwakeAsync();
        else await deactivateKeepAwake();
      } catch (e) {
        console.log("KeepAwake error:", e?.message || e);
      }
    })();

    return () => {
      deactivateKeepAwake().catch?.(() => {});
    };
  }, [keepAwakeOn]);

  useEffect(() => {
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fireCue = useCallback(
    (mode = "short") => {
      if (!cueFeedbackEnabled) return;
      if (mode === "long") {
        Vibration.vibrate([0, 60, 70, 120]);
        return;
      }
      Vibration.vibrate(45);
    },
    [cueFeedbackEnabled]
  );

  useEffect(() => {
    if (strengthRestSecLeft <= 0) return;
    const t = setTimeout(() => {
      setStrengthRestSecLeft((p) => Math.max(0, Number(p || 0) - 1));
    }, 1000);
    return () => clearTimeout(t);
  }, [strengthRestSecLeft]);

  useEffect(() => {
    if (strengthRestSecLeft !== 0) return;
    if (!strengthRestExerciseId) return;
    setStrengthRestExerciseId(null);
    fireCue("long");
  }, [fireCue, strengthRestExerciseId, strengthRestSecLeft]);

  /* -------------------------------------------------------------- */
  /* Load session                                                   */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");

        if (!sessionKey) {
          setError("Invalid session link.");
          setLoading(false);
          return;
        }

        const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(sessionKey);

        if (!planId) {
          setError("Invalid session link.");
          setLoading(false);
          return;
        }

        const uid = uidOrThrow();
        const found = await fetchPlanById(uid, planId);

        if (!found) {
          setError("Plan not found.");
          setLoading(false);
          return;
        }

        const { sess, dayLabel: dl } = getSessionFromPlan(
          found,
          weekIndex,
          dayIndex,
          sessionIndex
        );

        if (!sess) {
          setError("Session not found.");
          setLoading(false);
          return;
        }

        setPlan(found);
        setSession(sess);
        setDayLabel(dl || "");
        setLoading(false);
      } catch (e) {
        setError(e?.message || "Could not load session.");
        setLoading(false);
      }
    })();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      watchRef.current?.remove?.();
    };
  }, [sessionKey]);

  /* -------------------------------------------------------------- */
  /* Derived session info                                           */
  /* -------------------------------------------------------------- */

  const segments = useMemo(() => {
    if (Array.isArray(session?.segments)) return session.segments;
    if (Array.isArray(session?.steps)) return session.steps;
    return [];
  }, [session]);

  const isRun = useMemo(() => {
    const planKind = String(plan?.kind || "").toLowerCase();
    if (planKind === "run") return true;

    const sessKind = String(session?.kind || "").toLowerCase();
    if (sessKind === "run") return true;

    const workoutSport = String(session?.workout?.sport || "").toLowerCase();
    if (workoutSport.includes("run")) return true;

    const st = String(session?.sessionType || session?.type || "").toLowerCase();
    const runSessionTypes = new Set([
      "interval",
      "intervals",
      "threshold",
      "easy",
      "recovery",
      "long",
      "race",
      "strides",
      "tempo",
      "fartlek",
      "run",
    ]);
    if (runSessionTypes.has(st)) return true;

    const hasRunSteps = Array.isArray(session?.steps) && session.steps.some(isRunStep);
    return !!hasRunSteps;
  }, [
    plan?.kind,
    session?.kind,
    session?.workout?.sport,
    session?.sessionType,
    session?.type,
    session?.steps,
  ]);

  const meta = useMemo(() => {
    if (!session) return { durationMin: null, distanceKm: null };

    const workout = session.workout || {};
    const fromWorkout = {
      durationMin:
        workout.totalDurationSec != null
          ? Math.round(workout.totalDurationSec / 60)
          : null,
      distanceKm:
        workout.totalDistanceKm != null
          ? Number(Number(workout.totalDistanceKm).toFixed(1))
          : null,
    };

    const fromTemplateSteps = Array.isArray(session?.steps)
      ? deriveTotalsFromSteps(session.steps)
      : { totalDurationSec: null, totalDistanceKm: null };

    const durationMin =
      fromWorkout.durationMin ??
      (fromTemplateSteps.totalDurationSec != null
        ? Math.round(fromTemplateSteps.totalDurationSec / 60)
        : null) ??
      session.targetDurationMin ??
      session.durationMin ??
      null;

    const rawDistance =
      fromWorkout.distanceKm ??
      (fromTemplateSteps.totalDistanceKm != null
        ? fromTemplateSteps.totalDistanceKm
        : null) ??
      session.targetDistanceKm ??
      session.distanceKm ??
      null;

    const distanceKm =
      rawDistance != null && Number.isFinite(Number(rawDistance))
        ? Number(Number(rawDistance).toFixed(1))
        : null;

    return { durationMin, distanceKm };
  }, [session]);

  const stepList = useMemo(() => flattenSteps(session?.steps || [], 0), [session?.steps]);
  const execSteps = useMemo(() => expandStepsToSequence(session?.steps || [], 0, ""), [session?.steps]);
  const activeStep = useMemo(() => execSteps?.[activeStepIndex] || null, [execSteps, activeStepIndex]);

  const liveDistanceKm = useMemo(() => (liveDistanceM > 0 ? liveDistanceM / 1000 : 0), [liveDistanceM]);

  const derivedDurationSec = useMemo(() => {
    if (isRun) return liveDurationSec || 0;
    const manualMin = toNum(actualDuration);
    if (manualMin != null && manualMin > 0) return Math.round(manualMin * 60);
    const targetMin = toNum(meta.durationMin);
    if (targetMin != null && targetMin > 0) return Math.round(targetMin * 60);
    return 0;
  }, [isRun, liveDurationSec, actualDuration, meta.durationMin]);

  const derivedDistanceKm = useMemo(() => {
    if (isRun) return liveDistanceKm || 0;
    const manual = toNum(actualDistance);
    if (manual != null && manual > 0) return manual;
    const target = toNum(meta.distanceKm);
    if (target != null && target > 0) return target;
    return 0;
  }, [isRun, liveDistanceKm, actualDistance, meta.distanceKm]);

  const avgPace = useMemo(() => {
    if (isRun) return paceFrom(liveDistanceKm, liveDurationSec);
    return paceFrom(derivedDistanceKm, derivedDurationSec);
  }, [isRun, liveDistanceKm, liveDurationSec, derivedDistanceKm, derivedDurationSec]);

  const movingPace = useMemo(() => {
    if (!isRun) return null;
    if (movingDurationSec <= 0) return null;
    return paceFrom(liveDistanceKm, movingDurationSec);
  }, [isRun, liveDistanceKm, movingDurationSec]);

  const primaryPace = movingPace || avgPace || "--:--";

  const stepElapsedSec = useMemo(() => {
    const start = Number(stepStartTimeRef.current || 0);
    return Math.max(0, (liveDurationSec || 0) - start);
  }, [liveDurationSec, activeStepIndex]);

  const stepDeltaDistM = useMemo(() => {
    const start = Number(stepStartDistRef.current || 0);
    return Math.max(0, (liveDistanceM || 0) - start);
  }, [liveDistanceM, activeStepIndex]);

  const stepProgress = useMemo(() => {
    if (!activeStep) return 0;
    if (activeStep.timeSec != null && activeStep.timeSec > 0) {
      return clamp01(stepElapsedSec / activeStep.timeSec);
    }
    if (activeStep.distanceM != null && activeStep.distanceM > 0) {
      return clamp01(stepDeltaDistM / activeStep.distanceM);
    }
    return 0;
  }, [activeStep, stepElapsedSec, stepDeltaDistM]);

  const stepRemainingLabel = useMemo(() => {
    if (!activeStep) return "";
    if (activeStep.timeSec != null && activeStep.timeSec > 0) {
      const rem = Math.max(0, activeStep.timeSec - stepElapsedSec);
      return `Remaining: ${secondsToMMSS(rem)}`;
    }
    if (activeStep.distanceM != null && activeStep.distanceM > 0) {
      const rem = Math.max(0, activeStep.distanceM - stepDeltaDistM);
      if (rem >= 1000) return `Remaining: ${(rem / 1000).toFixed(2)} km`;
      return `Remaining: ${Math.round(rem)} m`;
    }
    return "Tap lap to advance";
  }, [activeStep, stepElapsedSec, stepDeltaDistM]);

  const gpsLabel = useMemo(() => {
    if (runState === "idle") return "";
    const stale = Date.now() - (lastFixAtRef.current || 0) > GPS_STALE_MS;
    if (runState === "acquiring") return "Acquiring GPS";
    if (gpsAcquired && !stale) return "GPS acquired";
    if (gpsAcquired && stale) return "GPS weak";
    return "Acquiring GPS";
  }, [runState, gpsAcquired]);

  const initialRegion = useMemo(() => {
    const first = coords?.[0];
    if (first) return { ...first, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    return bootRegion;
  }, [coords, bootRegion]);

  const plannedRoute = useMemo(() => {
    const a = Array.isArray(session?.routeCoords) ? session.routeCoords : null;
    const b = Array.isArray(session?.route?.coords) ? session.route.coords : null;
    const c = Array.isArray(session?.route?.polylineCoords) ? session.route.polylineCoords : null;
    return a || b || c || [];
  }, [session]);
  const timeOfDayLabel = useMemo(() => formatClockHHMM(clockNow), [clockNow]);

  const runPreviewItems = useMemo(
    () =>
      execSteps.map((st) => ({
        title: st.title || "Step",
        subtitle: st.durationLabel || st.notes || "",
      })),
    [execSteps]
  );

  const strengthPreviewItems = useMemo(() => {
    const fromBlocks = strengthBlocksToPreview(session?.blocks);
    if (fromBlocks.length) return fromBlocks;

    if (stepList.length) {
      return stepList.map((st) => ({
        title: st.title || "Exercise",
        subtitle: st.subtitle || "",
      }));
    }

    const segs = Array.isArray(session?.segments) ? session.segments : [];
    return segs.map((seg) => ({
      title: String(seg?.title || seg?.name || seg?.type || "Block"),
      subtitle: summariseDuration(seg?.duration || null),
    }));
  }, [session?.blocks, session?.segments, stepList]);

  const playerPreviewItems = isRun ? runPreviewItems : strengthPreviewItems;

  const strengthExercises = useMemo(() => {
    const out = [];
    const blocks = Array.isArray(session?.blocks) ? session.blocks : [];

    blocks.forEach((block, blockIdx) => {
      const blockTitle = String(block?.title || block?.name || block?.kind || "Block").trim();
      const items = Array.isArray(block?.items) ? block.items : [];

      items.forEach((item, itemIdx) => {
        const title = String(item?.title || item?.name || blockTitle || "Exercise").trim();
        const rawType = String(item?.type || item?.kind || block?.type || block?.kind || "").trim();
        const isLoggable = !isAuxStrengthStep({ title, blockTitle, rawType });
        const prescribedSets = Number(item?.sets || 0) || null;
        const prescribedReps = Number(item?.reps || 0) || null;
        const prescribedLoadKg = Number(item?.loadKg || 0) || null;
        const prescribedRestSec = Number(item?.restSec || 0) || null;

        out.push({
          id: `blk_${blockIdx}_${itemIdx}_${title}`.replace(/\s+/g, "_"),
          title,
          blockTitle,
          prescribedSets: isLoggable ? prescribedSets : null,
          prescribedReps: isLoggable ? prescribedReps : null,
          prescribedLoadKg: isLoggable ? prescribedLoadKg : null,
          prescribedRestSec: isLoggable ? prescribedRestSec : null,
          isLoggable,
        });
      });
    });

    if (out.length) return out;

    if (stepList.length) {
      return stepList.map((st, idx) => {
        const title = st?.title || "Exercise";
        const blockTitle = "";
        const rawType = String(st?.step?.type || st?.step?.stepType || "").trim();
        const isLoggable = !isAuxStrengthStep({ title, blockTitle, rawType });

        return {
          id: `step_${idx}_${String(title).replace(/\s+/g, "_")}`,
          title,
          blockTitle,
          prescribedSets: null,
          prescribedReps: null,
          prescribedLoadKg: null,
          prescribedRestSec: null,
          isLoggable,
        };
      });
    }

    return strengthPreviewItems.map((it, idx) => ({
      id: `sv_${idx}_${String(it?.title || "Exercise").replace(/\s+/g, "_")}`,
      title: it?.title || "Exercise",
      blockTitle: "",
      prescribedSets: null,
      prescribedReps: null,
      prescribedLoadKg: null,
      prescribedRestSec: null,
      isLoggable: !isAuxStrengthStep({
        title: it?.title || "Exercise",
        blockTitle: "",
        rawType: "",
      }),
    }));
  }, [session?.blocks, stepList, strengthPreviewItems]);

  useEffect(() => {
    if (!strengthExercises.length) return;

    setStrengthEntryById((prev) => {
      const next = {};

      strengthExercises.forEach((ex) => {
        const existing = prev?.[ex.id] || {};
        const isLoggable = ex?.isLoggable !== false;
        const prescribedCount = Math.max(0, Number(ex?.prescribedSets || 0));
        const legacySetsRaw = Math.max(0, Number(existing?.sets || 0));
        const existingSetLogs = Array.isArray(existing?.setLogs) ? existing.setLogs : [];
        const fallbackRowCount = Math.max(1, prescribedCount || legacySetsRaw || existingSetLogs.length || 1);
        const hasLegacyStrengthValues =
          String(existing?.weightKg || "").trim() ||
          String(existing?.reps || "").trim() ||
          legacySetsRaw > 0;

        let setLogs = [];

        if (isLoggable) {
          if (existingSetLogs.length) {
            const rowCount = Math.max(existingSetLogs.length, prescribedCount || 1);
            setLogs = Array.from({ length: rowCount }, (_, idx) => {
              const row = existingSetLogs[idx] || {};
              return {
                weightKg:
                  row?.weightKg != null && row?.weightKg !== ""
                    ? String(row.weightKg)
                    : ex?.prescribedLoadKg != null && idx >= existingSetLogs.length
                    ? String(ex.prescribedLoadKg)
                    : "",
                reps:
                  row?.reps != null && row?.reps !== ""
                    ? String(row.reps)
                    : ex?.prescribedReps != null && idx >= existingSetLogs.length
                    ? String(ex.prescribedReps)
                    : "",
                completed: !!row?.completed,
              };
            });
          } else {
            setLogs = Array.from({ length: fallbackRowCount }, () => ({
              weightKg: hasLegacyStrengthValues
                ? String(existing?.weightKg || "")
                : ex?.prescribedLoadKg != null
                ? String(ex.prescribedLoadKg)
                : "",
              reps: hasLegacyStrengthValues
                ? String(existing?.reps || "")
                : ex?.prescribedReps != null
                ? String(ex.prescribedReps)
                : "",
              completed: false,
            }));
          }
        }

        next[ex.id] = {
          setLogs,
          completed: !!existing.completed,
          notes: String(existing.notes || ""),
        };
      });

      return next;
    });
  }, [strengthExercises]);

  const strengthLoggableCount = useMemo(
    () => strengthExercises.filter((ex) => ex?.isLoggable !== false).length,
    [strengthExercises]
  );

  const strengthLoggedCount = useMemo(
    () =>
      strengthExercises.filter((ex) => {
        if (ex?.isLoggable === false) return false;
        const entry = strengthEntryById?.[ex.id] || {};
        const setLogs = Array.isArray(entry?.setLogs) ? entry.setLogs : [];
        return (
          setLogs.some(
            (setRow) =>
              !!String(setRow?.weightKg || "").trim() ||
              !!String(setRow?.reps || "").trim() ||
              !!setRow?.completed
          ) ||
          !!entry.completed
        );
      }).length,
    [strengthEntryById, strengthExercises]
  );

  const strengthSections = useMemo(() => {
    if (!strengthExercises.length) return [];

    const sections = [];
    const sectionIndexByKey = new Map();

    strengthExercises.forEach((ex, idx) => {
      const rawTitle = String(ex?.blockTitle || "").trim();
      const sectionTitle = rawTitle || "Main block";
      const sectionKey = sectionTitle.toLowerCase();

      let sectionIdx = sectionIndexByKey.get(sectionKey);
      if (sectionIdx == null) {
        sectionIdx = sections.length;
        sectionIndexByKey.set(sectionKey, sectionIdx);
        sections.push({
          id: `sec_${idx}_${sectionTitle}`.replace(/\s+/g, "_"),
          title: sectionTitle,
          items: [],
          loggableCount: 0,
          loggedCount: 0,
        });
      }

      const section = sections[sectionIdx];
      section.items.push(ex);

      if (ex?.isLoggable === false) return;

      section.loggableCount += 1;
      const entry = strengthEntryById?.[ex.id] || {};
      const setLogs = Array.isArray(entry?.setLogs) ? entry.setLogs : [];
      const hasData =
        setLogs.some(
          (setRow) =>
            !!String(setRow?.weightKg || "").trim() ||
            !!String(setRow?.reps || "").trim() ||
            !!setRow?.completed
        ) || !!entry.completed;

      if (hasData) section.loggedCount += 1;
    });

    return sections;
  }, [strengthEntryById, strengthExercises]);

  const buildLiveActivityDraft = useCallback(
    (statusOverride) => {
      if (!liveRoute || !encodedKey) return null;

      const rawStatus = normaliseRunState(statusOverride ?? runState);
      const baseStatus = !isRun && rawStatus === "acquiring" ? "running" : rawStatus;
      if (baseStatus === "idle") return null;

      const snapCoords = Array.isArray(coords) ? coords.slice(-500) : [];
      const nextSplitRaw = Number(nextSplitKmRef.current || 0);
      const nextSplitKm =
        nextSplitRaw > 0
          ? nextSplitRaw
          : Math.max(1, Math.floor((liveDistanceM || 0) / 1000) + 1);
      const safeStepIndex = execSteps.length
        ? Math.max(0, Math.min(Number(activeStepIndex || 0), execSteps.length - 1))
        : 0;

      return {
        isActive: true,
        route: liveRoute,
        sessionKey: encodedKey,
        status: baseStatus,
        mode: isRun ? "run" : "strength",
        title: session?.name || session?.title || "Live session",
        updatedAt: Date.now(),
        startedAt:
          Number(liveActivity?.startedAt || 0) > 0
            ? Number(liveActivity.startedAt)
            : Date.now(),
        snapshot: {
          runState: baseStatus,
          liveDurationSec: Number(liveDurationSec || 0),
          movingDurationSec: Number(movingDurationSec || 0),
          liveDistanceM: Number(liveDistanceM || 0),
          gpsAcquired: !!gpsAcquired,
          coords: snapCoords,
          splits: Array.isArray(splits) ? splits : [],
          activeStepIndex: safeStepIndex,
          stepStartDurationSec: Number(stepStartTimeRef.current || 0),
          stepStartDistanceM: Number(stepStartDistRef.current || 0),
          nextSplitKm,
          lastSplitTimeSec: Number(lastSplitTimeRef.current || 0),
          lastSplitDistanceM: Number(lastSplitDistanceMRef.current || 0),
          lastFixAt: Number(lastFixAtRef.current || 0),
          autoPauseEnabled: !!autoPauseEnabled,
          beaconEnabled: !!beaconEnabled,
          followUser: !!followUser,
          cueFeedbackEnabled: !!cueFeedbackEnabled,
          beaconLink: beaconLink || null,
          beaconSessionId: beaconSessionIdRef.current || null,
          strengthEntryById: !isRun ? strengthEntryById : null,
          strengthNotes: !isRun ? notes || "" : "",
          strengthRestSecLeft: !isRun ? Number(strengthRestSecLeft || 0) : 0,
          strengthRestExerciseId: !isRun ? strengthRestExerciseId || null : null,
        },
      };
    },
    [
      activeStepIndex,
      autoPauseEnabled,
      beaconEnabled,
      beaconLink,
      cueFeedbackEnabled,
      coords,
      encodedKey,
      execSteps.length,
      followUser,
      gpsAcquired,
      isRun,
      liveActivity?.startedAt,
      liveDistanceM,
      liveDurationSec,
      liveRoute,
      movingDurationSec,
      notes,
      runState,
      session?.name,
      session?.title,
      splits,
      strengthEntryById,
      strengthRestExerciseId,
      strengthRestSecLeft,
    ]
  );

  useEffect(() => {
    if (!liveHydrated) return;
    if (restoredFromLiveRef.current) return;
    if (!matchesPersistedLiveSession || !liveActivity?.isActive) return;

    const snap = hasLiveActivitySnapshot(liveActivity) ? liveActivity.snapshot : null;
    const persistedState = normaliseRunState(liveActivity?.status || snap?.runState);
    if (persistedState === "idle") return;

    restoredFromLiveRef.current = true;

    const shouldForcePaused = shouldPauseStaleLiveActivity(liveActivity);
    const restoredStateRaw = shouldForcePaused ? "paused" : persistedState;
    const restoredState =
      !isRun && restoredStateRaw === "acquiring" ? "running" : restoredStateRaw;
    const shouldKeepRunning =
      !shouldForcePaused &&
      (restoredState === "running" || restoredState === "acquiring");
    const lastUpdatedAt = Number(liveActivity?.updatedAt || 0);
    const offscreenGapSec =
      snap && shouldKeepRunning && lastUpdatedAt > 0
        ? Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000))
        : 0;

    const baseLiveSec = Math.max(0, Number(snap?.liveDurationSec || 0));
    const baseMovingSec = Math.max(0, Number(snap?.movingDurationSec || 0));
    const baseDistanceM = Math.max(0, Number(snap?.liveDistanceM || 0));
    const restoredCoords = Array.isArray(snap?.coords)
      ? snap.coords.slice(-MAX_COORD_HISTORY)
      : [];
    const restoredSplits = Array.isArray(snap?.splits) ? snap.splits : [];
    const incomingStep = Math.max(0, Number(snap?.activeStepIndex || 0));
    const safeActiveStepIndex = execSteps.length
      ? Math.min(incomingStep, execSteps.length - 1)
      : 0;
    const fallbackSnapshot = {
      runState: restoredState,
      liveDurationSec: baseLiveSec,
      movingDurationSec: baseMovingSec,
      liveDistanceM: baseDistanceM,
      gpsAcquired: !!snap?.gpsAcquired,
      coords: restoredCoords,
      splits: restoredSplits,
      activeStepIndex: safeActiveStepIndex,
      stepStartDurationSec: Math.max(0, Number(snap?.stepStartDurationSec || 0)),
      stepStartDistanceM: Math.max(0, Number(snap?.stepStartDistanceM || 0)),
      nextSplitKm: Math.max(1, Number(snap?.nextSplitKm || 1)),
      lastSplitTimeSec: Math.max(0, Number(snap?.lastSplitTimeSec || 0)),
      lastSplitDistanceM: Math.max(0, Number(snap?.lastSplitDistanceM || 0)),
      lastFixAt: Math.max(0, Number(snap?.lastFixAt || 0)),
      autoPauseEnabled:
        typeof snap?.autoPauseEnabled === "boolean" ? snap.autoPauseEnabled : true,
      beaconEnabled: typeof snap?.beaconEnabled === "boolean" ? snap.beaconEnabled : true,
      followUser: typeof snap?.followUser === "boolean" ? snap.followUser : true,
      cueFeedbackEnabled:
        typeof snap?.cueFeedbackEnabled === "boolean" ? snap.cueFeedbackEnabled : true,
      beaconLink: snap?.beaconLink || null,
      beaconSessionId: snap?.beaconSessionId || null,
      strengthEntryById:
        snap?.strengthEntryById && typeof snap.strengthEntryById === "object"
          ? snap.strengthEntryById
          : null,
      strengthNotes: typeof snap?.strengthNotes === "string" ? snap.strengthNotes : "",
      strengthRestSecLeft:
        typeof snap?.strengthRestSecLeft === "number"
          ? Math.max(0, Math.round(snap.strengthRestSecLeft))
          : 0,
      strengthRestExerciseId: snap?.strengthRestExerciseId || null,
    };

    setRunState(restoredState);
    setLiveDurationSec(baseLiveSec + offscreenGapSec);
    setMovingDurationSec(baseMovingSec + offscreenGapSec);
    setLiveDistanceM(baseDistanceM);
    setGpsAcquired(!!snap?.gpsAcquired);
    setCoords(restoredCoords);
    setSplits(restoredSplits);
    setBeaconLink(snap?.beaconLink || null);

    if (typeof snap?.autoPauseEnabled === "boolean") setAutoPauseEnabled(snap.autoPauseEnabled);
    if (typeof snap?.beaconEnabled === "boolean") setBeaconEnabled(snap.beaconEnabled);
    if (typeof snap?.followUser === "boolean") setFollowUser(snap.followUser);
    if (typeof snap?.cueFeedbackEnabled === "boolean") setCueFeedbackEnabled(snap.cueFeedbackEnabled);
    if (snap?.strengthEntryById && typeof snap.strengthEntryById === "object") {
      setStrengthEntryById(snap.strengthEntryById);
    }
    if (typeof snap?.strengthNotes === "string") {
      setNotes(snap.strengthNotes);
    }
    if (typeof snap?.strengthRestSecLeft === "number" && snap.strengthRestSecLeft > 0) {
      setStrengthRestSecLeft(Math.max(0, Math.round(snap.strengthRestSecLeft)));
      setStrengthRestExerciseId(snap?.strengthRestExerciseId || null);
    } else {
      setStrengthRestSecLeft(0);
      setStrengthRestExerciseId(null);
    }

    beaconSessionIdRef.current = snap?.beaconSessionId || null;
    lastCoordRef.current = restoredCoords.length ? restoredCoords[restoredCoords.length - 1] : null;
    lastFixAtRef.current = Math.max(0, Number(snap?.lastFixAt || 0));
    lastSplitTimeRef.current = Math.max(0, Number(snap?.lastSplitTimeSec || 0));
    lastSplitDistanceMRef.current = Math.max(0, Number(snap?.lastSplitDistanceM || 0));
    nextSplitKmRef.current = Math.max(1, Number(snap?.nextSplitKm || 1));
    stepStartTimeRef.current = Math.max(0, Number(snap?.stepStartDurationSec || 0));
    stepStartDistRef.current = Math.max(0, Number(snap?.stepStartDistanceM || 0));
    setActiveStepIndex(safeActiveStepIndex);

    if (shouldForcePaused || !snap || isLiveActivityStale(liveActivity)) {
      setLiveActivity((prev) => {
        if (!prev?.isActive) return prev;
        return {
          ...prev,
          status: restoredState,
          updatedAt: Date.now(),
          snapshot: hasLiveActivitySnapshot(prev) ? prev.snapshot : fallbackSnapshot,
        };
      });
    }
  }, [
    encodedKey,
    execSteps.length,
    liveActivity,
    liveHydrated,
    liveRoute,
    matchesPersistedLiveSession,
    setLiveActivity,
  ]);

  useEffect(() => {
    if (!liveRoute || !encodedKey) return;
    if (runState === "idle") return;
    const status = normaliseRunState(runState);

    setLiveActivity((prev) => ({
      isActive: true,
      route: liveRoute,
      sessionKey: encodedKey,
      status,
      mode: isRun ? "run" : "strength",
      title: session?.name || session?.title || prev?.title || "Live session",
      updatedAt: Date.now(),
      startedAt: Number(prev?.startedAt || liveActivity?.startedAt || Date.now()),
      snapshot: prev?.snapshot || null,
    }));
  }, [
    encodedKey,
    liveActivity?.startedAt,
    liveRoute,
    runState,
    isRun,
    session?.name,
    session?.title,
    setLiveActivity,
  ]);

  useEffect(() => {
    latestLiveDraftRef.current = buildLiveActivityDraft(runState);
  }, [buildLiveActivityDraft, runState]);

  useEffect(
    () => () => {
      if (suppressLivePersistRef.current) return;
      if (latestLiveDraftRef.current) {
        setLiveActivity(latestLiveDraftRef.current);
      }
    },
    [setLiveActivity]
  );

  /* -------------------------------------------------------------- */
  /* Keep map local before tracking starts                          */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!isRun) return;

        const perm = await Location.getForegroundPermissionsAsync();
        if (!alive) return;

        if (perm?.status === "granted") {
          setHasLocPerm(true);

          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          if (!alive) return;

          const c = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };

          setBootRegion({
            ...c,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });

          mapRef.current?.animateToRegion?.(
            { ...c, latitudeDelta: 0.01, longitudeDelta: 0.01 },
            450
          );
        }
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, [isRun]);

  /* -------------------------------------------------------------- */
  /* Keep awake helpers                                             */
  /* -------------------------------------------------------------- */

  const startTimer = useCallback(() => {
    if (timerRef.current) return;

    timerRef.current = setInterval(() => {
      setLiveDurationSec((p) => p + 1);
      setMovingDurationSec((p) => p + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopLocation = useCallback(() => {
    if (!watchRef.current) return;
    watchRef.current.remove?.();
    watchRef.current = null;
  }, []);

  const setStepStartAnchors = useCallback(() => {
    stepStartTimeRef.current = Number(liveDurationSec || 0);
    stepStartDistRef.current = Number(liveDistanceM || 0);
  }, [liveDurationSec, liveDistanceM]);

  const onCloseLive = useCallback(() => {
    const draft = buildLiveActivityDraft(runState);
    if (draft) setLiveActivity(draft);
    else if (matchesPersistedLiveSession) clearLiveActivity();
    router.back();
  }, [
    buildLiveActivityDraft,
    clearLiveActivity,
    matchesPersistedLiveSession,
    router,
    runState,
    setLiveActivity,
  ]);

  /* -------------------------------------------------------------- */
  /* GPS / live tracking                                             */
  /* -------------------------------------------------------------- */

  const applyFix = useCallback(
    (pos) => {
      const c = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      const acc = Number(pos.coords.accuracy || 0);
      const previousCoord = lastCoordRef.current;

      if (acc && acc > MAX_ACC_M) return;

      lastFixAtRef.current = Date.now();
      setGpsAcquired(true);

      setCoords((prev) => {
        const last = prev.length ? prev[prev.length - 1] : null;
        const next = prev.length ? [...prev, c] : [c];

        if (last) {
          const d = haversineMeters(last, c);
          if (d > 0 && d < MAX_SPIKE_M) {
            setLiveDistanceM((m) => m + d);
          }
        }

        if (next.length > MAX_COORD_HISTORY) {
          next.splice(0, next.length - MAX_COORD_HISTORY);
        }

        return next;
      });

      if (
        followUser &&
        mapRef.current &&
        (runState === "running" || runState === "acquiring")
      ) {
        mapRef.current.animateToRegion(
          { ...c, latitudeDelta: 0.01, longitudeDelta: 0.01 },
          350
        );
      }

      if (autoPauseEnabled && runState === "running") {
        const speed = Number(pos.coords.speed ?? 0);
        const hasSpeed = Number.isFinite(speed) && speed >= 0;

        let stationary = false;
        if (hasSpeed) {
          stationary = speed < STATIONARY_SPEED_MPS;
        } else {
          const last = previousCoord;
          const d = last ? haversineMeters(last, c) : 0;
          stationary = d < 1;
        }

        if (stationary) {
          stationarySecRef.current += 1;
          movingSecRef.current = 0;
        } else {
          movingSecRef.current += 1;
          stationarySecRef.current = 0;
        }

        if (stationarySecRef.current >= AUTO_PAUSE_GRACE_SEC) {
          setRunState("paused");
          stopTimer();
          setKeepAwakeOn(false);
          fireCue("long");
        }
      }

      if (autoPauseEnabled && runState === "paused") {
        const speed = Number(pos.coords.speed ?? 0);
        const hasSpeed = Number.isFinite(speed) && speed >= 0;
        const moving = hasSpeed ? speed >= STATIONARY_SPEED_MPS : true;

        if (moving) movingSecRef.current += 1;
        else movingSecRef.current = 0;

        if (movingSecRef.current >= AUTO_RESUME_GRACE_SEC) {
          setRunState("running");
          startTimer();
          setKeepAwakeOn(true);
          fireCue("short");
        }
      }

      lastCoordRef.current = c;
    },
    [autoPauseEnabled, fireCue, followUser, runState, startTimer, stopTimer]
  );

  const forceInitialFix = useCallback(async () => {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      applyFix(pos);

      if (runState === "acquiring") {
        setRunState("running");
        startTimer();
        setKeepAwakeOn(true);
        if (execSteps.length) setStepStartAnchors();
      }
    } catch (e) {
      console.log("Initial GPS fix failed:", e?.message || e);
    }
  }, [applyFix, execSteps.length, runState, startTimer, setStepStartAnchors]);

  const startLocationWatch = useCallback(async () => {
    if (watchRef.current) return;

    watchRef.current = await Location.watchPositionAsync(WATCH_OPTIONS, (pos) => {
      applyFix(pos);

      if (runState === "acquiring") {
        setRunState("running");
        startTimer();
        setKeepAwakeOn(true);
        if (execSteps.length) setStepStartAnchors();
      }
    });

    forceInitialFix();
  }, [applyFix, execSteps.length, forceInitialFix, runState, startTimer, setStepStartAnchors]);

  const ensureLocationPermission = useCallback(async () => {
    if (hasLocPerm) return true;
    const { status } = await Location.requestForegroundPermissionsAsync();
    const ok = status === "granted";
    setHasLocPerm(ok);
    return ok;
  }, [hasLocPerm]);

  useEffect(() => {
    if (!isRun) return;
    if (runState !== "running" && runState !== "acquiring") return;

    let cancelled = false;

    (async () => {
      try {
        const ok = await ensureLocationPermission();
        if (!ok || cancelled) return;
        await startLocationWatch();
        if (runState === "running") startTimer();
        if (!cancelled) setKeepAwakeOn(true);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [
    ensureLocationPermission,
    isRun,
    runState,
    startLocationWatch,
    startTimer,
  ]);

  useEffect(() => {
    const shouldResumeTimer =
      runState === "running" ||
      (isRun && runState === "acquiring" && Number(liveDurationSec || 0) > 0);
    if (!shouldResumeTimer) return;

    startTimer();
    setKeepAwakeOn(true);
  }, [isRun, runState, liveDurationSec, startTimer]);

  /* -------------------------------------------------------------- */
  /* Beacon                                                          */
  /* -------------------------------------------------------------- */

  const ensureBeaconSession = useCallback(async () => {
    if (beaconSessionIdRef.current) return beaconSessionIdRef.current;

    const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(sessionKey);
    const uid = uidOrThrow();

    const liveDoc = {
      uid,
      planId,
      weekIndex,
      dayIndex,
      sessionIndex,
      title: session?.title || session?.name || "Live Session",
      createdAt: serverTimestamp(),
      status: "live",
    };

    const ref = await addDoc(collection(db, "users", uid, "liveSessions"), liveDoc);
    beaconSessionIdRef.current = ref.id;

    const shareUrl = `${API_URL}/live/${ref.id}`;
    setBeaconLink(shareUrl);

    await setDoc(
      doc(db, "users", uid, "liveSessions", ref.id),
      { shareUrl },
      { merge: true }
    );

    return ref.id;
  }, [sessionKey, session?.title, session?.name]);

  const shareBeacon = useCallback(async () => {
    try {
      const id = await ensureBeaconSession();
      const url = beaconLink || `${API_URL}/live/${id}`;
      await Share.share({ message: `Live tracking link: ${url}` });
    } catch (e) {
      Alert.alert("Couldn’t share", e?.message || "Try again.");
    }
  }, [beaconLink, ensureBeaconSession]);

  const maybeUpdateLiveSession = useCallback(async () => {
    if (!beaconEnabled) return;
    if (!beaconSessionIdRef.current) return;

    const now = Date.now();
    if (now - lastLiveUpdateAtRef.current < 8000) return;
    lastLiveUpdateAtRef.current = now;

    try {
      const uid = uidOrThrow();
      const liveId = beaconSessionIdRef.current;
      const last = coords?.[coords.length - 1] || null;

      await updateDoc(doc(db, "users", uid, "liveSessions", liveId), {
        updatedAt: serverTimestamp(),
        last: last ? { ...last } : null,
        durationSec: liveDurationSec || 0,
        distanceM: liveDistanceM || 0,
        status: runState === "paused" ? "paused" : "live",
      });
    } catch (e) {
      console.log("Live update failed:", e?.message || e);
    }
  }, [beaconEnabled, coords, liveDistanceM, liveDurationSec, runState]);

  useEffect(() => {
    if (!isRun) return;
    if (!beaconEnabled) return;
    if (runState !== "running" && runState !== "paused" && runState !== "acquiring") return;
    maybeUpdateLiveSession();
  }, [isRun, beaconEnabled, runState, coords, liveDistanceM, liveDurationSec, maybeUpdateLiveSession]);

  /* -------------------------------------------------------------- */
  /* Splits                                                          */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    if (!isRun) return;
    if (runState !== "running") return;

    const km = liveDistanceM / 1000;
    const nextKm = Number(nextSplitKmRef.current || 1);

    if (km >= nextKm) {
      const nowSec = Number(liveDurationSec || 0);
      const lastSplitAt = Number(lastSplitTimeRef.current || 0);
      const splitDistKm = Math.max(
        0.01,
        (Number(liveDistanceM || 0) - Number(lastSplitDistanceMRef.current || 0)) / 1000
      );
      const splitSec = Math.max(1, nowSec - lastSplitAt);
      const splitPace = paceFrom(splitDistKm, splitSec);

      setSplits((prev) => [
        ...prev,
        { km: nextKm, splitSec, pace: splitPace || "--:--", manual: false },
      ]);

      lastSplitTimeRef.current = nowSec;
      lastSplitDistanceMRef.current = Number(liveDistanceM || 0);
      nextSplitKmRef.current = nextKm + 1;
      fireCue("short");
    }
  }, [fireCue, isRun, runState, liveDistanceM, liveDurationSec]);

  /* -------------------------------------------------------------- */
  /* Step engine                                                     */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    if (!isRun) return;
    if (!execSteps.length) return;
    setActiveStepIndex((idx) => Math.max(0, Math.min(idx, execSteps.length - 1)));
    setStepStartAnchors();
  }, [isRun, execSteps.length, setStepStartAnchors]);

  useEffect(() => {
    if (!isRun) return;
    if (!execSteps.length) return;
    setStepStartAnchors();
  }, [activeStepIndex, isRun, execSteps.length, setStepStartAnchors]);

  useEffect(() => {
    if (!isRun) return;
    if (runState !== "running") return;
    if (!activeStep) return;

    const now = Date.now();
    const last = Number(lastAutoAdvanceAtRef.current || 0);
    if (now - last < 900) return;

    const isTime = activeStep.timeSec != null && activeStep.timeSec > 0;
    const isDist = activeStep.distanceM != null && activeStep.distanceM > 0;

    let done = false;
    if (isTime && stepElapsedSec >= activeStep.timeSec) done = true;
    if (isDist && stepDeltaDistM >= activeStep.distanceM) done = true;
    if (!done) return;

    lastAutoAdvanceAtRef.current = now;

    if (activeStepIndex >= execSteps.length - 1) {
      return;
    }

    fireCue("short");
    setActiveStepIndex((idx) => Math.min(idx + 1, execSteps.length - 1));
  }, [
    fireCue,
    isRun,
    runState,
    activeStep,
    activeStepIndex,
    execSteps.length,
    stepElapsedSec,
    stepDeltaDistM,
  ]);

  const goPrevStep = useCallback(() => {
    setActiveStepIndex((idx) => Math.max(0, idx - 1));
  }, []);

  const goNextStep = useCallback(() => {
    setActiveStepIndex((idx) => Math.min(execSteps.length - 1, idx + 1));
  }, [execSteps.length]);

  const onLapPress = useCallback(() => {
    if (!isRun) return;
    if (runState !== "running") return;

    const nowSec = Number(liveDurationSec || 0);
    const lastSplitAt = Number(lastSplitTimeRef.current || 0);
    const splitSec = Math.max(1, nowSec - lastSplitAt);
    const splitDistKm = Math.max(
      0.01,
      (Number(liveDistanceM || 0) - Number(lastSplitDistanceMRef.current || 0)) / 1000
    );
    const splitPace = paceFrom(splitDistKm, splitSec);
    const currentKm = Number((Number(liveDistanceM || 0) / 1000).toFixed(2));

    setSplits((prev) => [
      ...prev,
      { km: currentKm, splitSec, pace: splitPace || "--:--", manual: true },
    ]);

    lastSplitTimeRef.current = nowSec;
    lastSplitDistanceMRef.current = Number(liveDistanceM || 0);

    if (execSteps.length) {
      goNextStep();
    }

    fireCue("short");
  }, [execSteps.length, fireCue, goNextStep, isRun, liveDistanceM, liveDurationSec, runState]);

  /* -------------------------------------------------------------- */
  /* Controls                                                        */
  /* -------------------------------------------------------------- */

  const onStart = useCallback(async () => {
    suppressLivePersistRef.current = false;

    const ok = await ensureLocationPermission();
    if (!ok) {
      Alert.alert("Location needed", "Please allow location to track your run.");
      return;
    }

    if (beaconEnabled) {
      try {
        await ensureBeaconSession();
      } catch {}
    }

    if (runState === "idle") {
      setGpsAcquired(false);
      lastFixAtRef.current = 0;

      setSplits([]);
      nextSplitKmRef.current = 1;
      lastSplitTimeRef.current = 0;
      lastSplitDistanceMRef.current = 0;

      setActiveStepIndex(0);
      stepStartTimeRef.current = 0;
      stepStartDistRef.current = 0;
      lastAutoAdvanceAtRef.current = 0;

      stationarySecRef.current = 0;
      movingSecRef.current = 0;

      setCoords([]);
      setLiveDistanceM(0);
      setLiveDurationSec(0);
      setMovingDurationSec(0);

      setRunState("acquiring");
      setKeepAwakeOn(true);
      await startLocationWatch();
      return;
    }

    if (runState === "paused") {
      setRunState("acquiring");
      setKeepAwakeOn(true);
      await startLocationWatch();
    }
  }, [beaconEnabled, ensureBeaconSession, ensureLocationPermission, runState, startLocationWatch]);

  const onPause = useCallback(() => {
    if (runState !== "running") return;
    setRunState("paused");
    stopTimer();
    stopLocation();
    setKeepAwakeOn(false);
  }, [runState, stopLocation, stopTimer]);

  const onResume = useCallback(async () => {
    if (runState !== "paused") return;
    await onStart();
  }, [onStart, runState]);

  const onStrengthStart = useCallback(() => {
    suppressLivePersistRef.current = false;
    setStrengthRestSecLeft(0);
    setStrengthRestExerciseId(null);

    if (runState === "idle") {
      setRunState("running");
      startTimer();
      setKeepAwakeOn(true);
      return;
    }

    if (runState === "paused") {
      setRunState("running");
      startTimer();
      setKeepAwakeOn(true);
    }
  }, [runState, startTimer]);

  const onStrengthPause = useCallback(() => {
    if (runState !== "running") return;
    setRunState("paused");
    stopTimer();
    setKeepAwakeOn(false);
  }, [runState, stopTimer]);

  const onStrengthResume = useCallback(() => {
    if (runState !== "paused") return;
    setRunState("running");
    startTimer();
    setKeepAwakeOn(true);
  }, [runState, startTimer]);

  const updateStrengthEntry = useCallback((id, patch) => {
    if (!id) return;
    setStrengthEntryById((prev) => ({
      ...prev,
      [id]: {
        ...(prev?.[id] || {}),
        ...patch,
      },
    }));
  }, []);

  const updateStrengthSetRow = useCallback((exerciseId, setIndex, patch) => {
    if (!exerciseId || setIndex < 0) return;

    setStrengthEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      const row = rows[setIndex] || { weightKg: "", reps: "", completed: false };

      rows[setIndex] = {
        ...row,
        ...patch,
      };

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

  const toggleStrengthSetCompleted = useCallback(
    (exerciseId, setIndex, prescribedRestSec = 0) => {
      if (!exerciseId || setIndex < 0) return;
      let becameCompleted = false;

      setStrengthEntryById((prev) => {
        const current = prev?.[exerciseId] || {};
        const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
        const row = rows[setIndex] || { weightKg: "", reps: "", completed: false };
        const completed = !row.completed;
        becameCompleted = completed;

        rows[setIndex] = {
          ...row,
          completed,
        };

        const allCompleted = rows.length > 0 && rows.every((r) => !!r?.completed);

        return {
          ...prev,
          [exerciseId]: {
            ...current,
            setLogs: rows,
            completed: allCompleted,
          },
        };
      });

      const restSec = Math.max(0, Number(prescribedRestSec || 0));
      if (becameCompleted && restSec > 0) {
        setStrengthRestExerciseId(exerciseId);
        setStrengthRestSecLeft(Math.round(restSec));
        fireCue("short");
      }
    },
    [fireCue]
  );

  const addStrengthSetRow = useCallback((exerciseId) => {
    if (!exerciseId) return;

    setStrengthEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      const lastRow = rows.length ? rows[rows.length - 1] : null;
      rows.push({
        weightKg: lastRow?.weightKg != null ? String(lastRow.weightKg) : "",
        reps: lastRow?.reps != null ? String(lastRow.reps) : "",
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

  const removeStrengthSetRow = useCallback((exerciseId, setIndex) => {
    if (!exerciseId) return;

    setStrengthEntryById((prev) => {
      const current = prev?.[exerciseId] || {};
      const rows = Array.isArray(current?.setLogs) ? [...current.setLogs] : [];
      if (!rows.length) return prev;

      const idx = Number(setIndex);
      const safeIdx = Number.isFinite(idx) ? idx : rows.length - 1;
      if (safeIdx < 0 || safeIdx >= rows.length) return prev;

      rows.splice(safeIdx, 1);

      if (!rows.length) {
        rows.push({ weightKg: "", reps: "", completed: false });
      }

      const allCompleted = rows.length > 0 && rows.every((r) => !!r?.completed);

      return {
        ...prev,
        [exerciseId]: {
          ...current,
          setLogs: rows,
          completed: allCompleted,
        },
      };
    });
  }, []);

  const onReset = useCallback(() => {
    stopTimer();
    stopLocation();

    setRunState("idle");
    setGpsAcquired(false);
    lastFixAtRef.current = 0;

    setCoords([]);
    setLiveDistanceM(0);
    setLiveDurationSec(0);
    setMovingDurationSec(0);

    setSplits([]);
    nextSplitKmRef.current = 1;
    lastSplitTimeRef.current = 0;
    lastSplitDistanceMRef.current = 0;

    setActiveStepIndex(0);
    stepStartTimeRef.current = 0;
    stepStartDistRef.current = 0;
    lastAutoAdvanceAtRef.current = 0;

    stationarySecRef.current = 0;
    movingSecRef.current = 0;

    setKeepAwakeOn(false);
    setBeaconLink(null);
    beaconSessionIdRef.current = null;
    setNotes("");
    setStrengthEntryById({});
    setStrengthRestSecLeft(0);
    setStrengthRestExerciseId(null);
    suppressLivePersistRef.current = true;
    clearLiveActivity();
  }, [clearLiveActivity, stopLocation, stopTimer]);

  /* -------------------------------------------------------------- */
  /* Save                                                            */
  /* -------------------------------------------------------------- */

  const buildSessionSaveDraft = useCallback(() => {
    const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(sessionKey);
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];

    const payload = {
      planId,
      planName: plan?.name || "Training Plan",
      primaryActivity: plan?.primaryActivity || "",
      weekIndex,
      dayIndex,
      sessionIndex,
      dayLabel,
      title:
        session?.title ||
        session?.name ||
        session?.type ||
        session?.sessionType ||
        "Session",
      date: dateStr,

      targetDurationMin: meta.durationMin,
      targetDistanceKm: meta.distanceKm,

      actualDurationMin: null,
      actualDistanceKm: null,
      avgRPE: null,
      notes: notes || "",

      live: isRun
        ? {
            durationSec: liveDurationSec || 0,
            movingDurationSec: movingDurationSec || 0,
            distanceKm: liveDistanceKm ? Number(liveDistanceKm.toFixed(3)) : 0,
            avgPaceMinPerKm: avgPace || null,
            movingPaceMinPerKm: movingPace || null,
            coords: coords.length ? coords : null,
            gpsAcquired: !!gpsAcquired,
            splits: splits.length ? splits : null,
            settings: {
              autoPauseEnabled: !!autoPauseEnabled,
              beaconEnabled: !!beaconEnabled,
              cueFeedbackEnabled: !!cueFeedbackEnabled,
            },
            steps: execSteps?.length
              ? {
                  activeStepIndex,
                  activeStepTitle: activeStep?.title || null,
                  activeStepType: activeStep?.type || null,
                  activeStepElapsedSec: stepElapsedSec || 0,
                  startedAtDurationSec: stepStartTimeRef.current || 0,
                  startedAtDistanceM: stepStartDistRef.current || 0,
                  sequence: execSteps.map((s) => ({
                    title: s.title,
                    type: s.type,
                    timeSec: s.timeSec ?? null,
                    distanceM: s.distanceM ?? null,
                    durationLabel: s.durationLabel || "",
                    target: s.target || null,
                    notes: s.notes || "",
                    depth: s.depth || 0,
                    repeatContext: s.repeatContext || null,
                  })),
                }
              : null,
            beacon: beaconSessionIdRef.current
              ? {
                  liveSessionId: beaconSessionIdRef.current,
                  shareUrl: beaconLink || `${API_URL}/live/${beaconSessionIdRef.current}`,
                }
              : null,
            plannedRoute: plannedRoute?.length ? plannedRoute : null,
          }
        : null,

      segments,
      workout: session?.workout || null,
      status: "completed",
    };

    if (!isRun) {
      const liveDurationMin =
        liveDurationSec > 0 ? Number((liveDurationSec / 60).toFixed(1)) : null;
      payload.actualDurationMin = toNum(actualDuration) ?? liveDurationMin ?? null;
      payload.actualDistanceKm = toNum(actualDistance) ?? null;
      payload.avgRPE = toNum(rpe) ?? null;
      payload.notes = notes || "";

      const strengthLogEntries = strengthExercises.map((ex) => {
        const log = strengthEntryById?.[ex.id] || {};
        const isLoggable = ex?.isLoggable !== false;
        const setLogsRaw = Array.isArray(log?.setLogs) ? log.setLogs : [];
        const setLogs = isLoggable
          ? setLogsRaw.map((setRow, idx) => {
              const loadKg = toNum(setRow?.weightKg);
              const reps = toNum(setRow?.reps);
              return {
                set: idx + 1,
                loadKg: loadKg != null ? Number(loadKg) : null,
                reps: reps != null ? Number(reps) : null,
                completed: !!setRow?.completed,
              };
            })
          : [];
        const repsValues = setLogs.map((x) => x.reps).filter((x) => x != null);
        const loadValues = setLogs.map((x) => x.loadKg).filter((x) => x != null);
        const uniformReps =
          repsValues.length && repsValues.every((x) => x === repsValues[0])
            ? repsValues[0]
            : null;
        const uniformLoad =
          loadValues.length && loadValues.every((x) => x === loadValues[0])
            ? loadValues[0]
            : null;
        const completedSetCount = setLogs.filter((x) => x.completed).length;

        return {
          id: ex.id,
          title: ex.title,
          blockTitle: ex.blockTitle || "",
          isLoggable,
          prescribed: {
            sets: ex.prescribedSets,
            reps: ex.prescribedReps,
            loadKg: ex.prescribedLoadKg,
            restSec: ex.prescribedRestSec ?? null,
          },
          performed: {
            sets: isLoggable && setLogs.length ? setLogs.length : null,
            reps: isLoggable ? uniformReps : null,
            loadKg: isLoggable ? uniformLoad : null,
            completedSets: isLoggable ? completedSetCount : null,
            setLogs: isLoggable ? setLogs : null,
            completed: !!log.completed,
            notes: String(log.notes || ""),
          },
        };
      });

      payload.strengthLog = {
        durationSec: liveDurationSec || 0,
        loggedExercises: strengthLogEntries.filter((x) => {
          if (!x?.isLoggable) return false;
          const setLogs = Array.isArray(x?.performed?.setLogs) ? x.performed.setLogs : [];
          const hasSetData = setLogs.some(
            (setLog) =>
              setLog?.loadKg != null ||
              setLog?.reps != null ||
              !!setLog?.completed
          );
          return hasSetData || !!x?.performed?.completed;
        }).length,
        notes: notes || "",
        entries: strengthLogEntries,
      };

      payload.live = {
        mode: "strength",
        durationSec: liveDurationSec || 0,
        status: runState === "paused" ? "paused" : "live",
        strengthEntryById: strengthEntryById || {},
      };
    }

    return {
      sessionKey: encodedKey || null,
      mode: isRun ? "run" : "strength",
      beaconSessionId: beaconSessionIdRef.current || null,
      payload,
    };
  }, [
    actualDistance,
    actualDuration,
    activeStep,
    activeStepIndex,
    autoPauseEnabled,
    avgPace,
    beaconEnabled,
    beaconLink,
    cueFeedbackEnabled,
    coords,
    dayLabel,
    encodedKey,
    execSteps,
    gpsAcquired,
    isRun,
    liveDistanceKm,
    liveDurationSec,
    meta.distanceKm,
    meta.durationMin,
    movingDurationSec,
    movingPace,
    notes,
    plan?.name,
    plan?.primaryActivity,
    plannedRoute,
    rpe,
    runState,
    segments,
    session,
    sessionKey,
    splits,
    stepElapsedSec,
    strengthEntryById,
    strengthExercises,
  ]);

  const routeToSaveActivity = useCallback(async () => {
    try {
      if (!encodedKey) {
        Alert.alert("Save failed", "Missing session key.");
        return;
      }

      setSaving(true);

      const draft = buildSessionSaveDraft();
      const pausedLiveDraft = buildLiveActivityDraft("paused");
      const nextLiveState = (prev) => ({
        ...(pausedLiveDraft || prev || {}),
        isActive: pausedLiveDraft?.isActive ?? prev?.isActive ?? true,
        route: pausedLiveDraft?.route || liveRoute || prev?.route || null,
        sessionKey: encodedKey,
        status: "paused",
        mode: pausedLiveDraft?.mode || (isRun ? "run" : "strength"),
        title: pausedLiveDraft?.title || session?.name || session?.title || "Live session",
        updatedAt: Date.now(),
        startedAt: Number(prev?.startedAt || liveActivity?.startedAt || Date.now()),
        snapshot: pausedLiveDraft?.snapshot || prev?.snapshot || null,
        pendingSaveDraft: draft,
      });

      setLiveActivity((prev) => {
        const resolved = nextLiveState(prev);
        latestLiveDraftRef.current = resolved;
        return resolved;
      });

      setKeepAwakeOn(false);
      setStrengthRestSecLeft(0);
      setStrengthRestExerciseId(null);

      router.push(`/train/session/${encodeURIComponent(encodedKey)}/complete`);
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not open save activity screen.");
    } finally {
      setSaving(false);
    }
  }, [
    buildLiveActivityDraft,
    buildSessionSaveDraft,
    encodedKey,
    isRun,
    liveActivity?.startedAt,
    liveRoute,
    router,
    session?.name,
    session?.title,
    setLiveActivity,
  ]);

  const confirmFinishRun = useCallback(() => {
    Alert.alert(
      "Finish workout?",
      "This will pause recording and open the save activity screen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish",
          style: "default",
          onPress: async () => {
            stopTimer();
            stopLocation();
            setRunState("paused");
            await routeToSaveActivity();
          },
        },
      ]
    );
  }, [routeToSaveActivity, stopLocation, stopTimer]);

  const confirmFinishStrength = useCallback(() => {
    Alert.alert(
      "Finish workout?",
      "This will pause recording and open the save activity screen.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finish",
          style: "default",
          onPress: async () => {
            stopTimer();
            setRunState("paused");
            setKeepAwakeOn(false);
            await routeToSaveActivity();
          },
        },
      ]
    );
  }, [routeToSaveActivity, stopTimer]);

  const confirmDiscardSession = useCallback(() => {
    Alert.alert(
      "Discard live session?",
      "This will remove the in-progress session and any unsaved data.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            onReset();
            router.back();
          },
        },
      ]
    );
  }, [onReset, router]);

  /* -------------------------------------------------------------- */
  /* Loading / error                                                 */
  /* -------------------------------------------------------------- */

  if (loading) {
    return (
      <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}>
        {ScreenHeader}
        <View style={sx.center}>
          <ActivityIndicator />
          <Text style={{ color: theme.subtext, marginTop: 8 }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}>
        {ScreenHeader}
        <View style={{ padding: 16 }}>
          <View style={sx.headerRow}>
            <View style={sx.headerGhost}>
              <TouchableOpacity
                onPress={onCloseLive}
                style={[
                  sx.headerCollapseBtn,
                  { backgroundColor: theme.card2 },
                ]}
                activeOpacity={0.85}
              >
                <Feather name="x" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>

            <Text style={[sx.headerTitle, { color: theme.text }]}>Live session</Text>
            <View style={sx.headerGhost} />
          </View>

          <View style={[sx.card, { backgroundColor: theme.card }]}>
            <Text style={{ color: theme.danger, fontWeight: "900" }}>{error}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (runState === "idle") {
    const startAction = isRun ? onStart : onStrengthStart;
    const previewTitle = isRun ? "Steps" : "Workout";
    const modeLabel = isRun ? "Run workout" : "Weight training";
    const modeIcon = isRun ? "activity" : "shield";
    const playerAccent = theme.primaryBg;
    const playerAccentText = theme.primaryText;
    const modeCircleBg = theme.isDark
      ? "rgba(230,255,59,0.16)"
      : "rgba(230,255,59,0.22)";

    return (
      <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}>
        {ScreenHeader}
        <View style={{ flex: 1 }}>
          <View style={[sx.playerTopBar, { paddingTop: Math.max(6, insets.top + 2) }]}>
            <TouchableOpacity
              onPress={onCloseLive}
              style={[sx.playerCollapseBtn, { backgroundColor: theme.card2 }]}
              activeOpacity={0.85}
            >
              <Feather name="x" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

            <Text style={[sx.playerElapsed, { color: theme.text }]}>{secondsToHMMSS(liveDurationSec)}</Text>

            <View style={sx.playerClockWrap}>
              <Text style={[sx.playerClockText, { color: theme.text }]}>
                {timeOfDayLabel}
              </Text>
              <Text style={[sx.playerClockSub, { color: theme.subtext }]}>Time of day</Text>
            </View>

          {playerPreviewItems.length ? (
            <View style={[sx.playerPreviewWrap, { backgroundColor: theme.card }]}>
              <Text style={[sx.playerPreviewTitle, { color: theme.subtext }]}>{previewTitle}</Text>
              <ScrollView
                style={{ maxHeight: 210 }}
                contentContainerStyle={{ gap: 8, paddingBottom: 10 }}
                showsVerticalScrollIndicator={false}
              >
                {playerPreviewItems.slice(0, 10).map((item, idx) => (
                  <View
                    key={`player-preview-${idx}`}
                    style={[sx.playerPreviewRow, { backgroundColor: theme.cardSoft }]}
                  >
                    <Text style={[sx.playerPreviewRowTitle, { color: theme.text }]} numberOfLines={1}>
                      {item.title || "Step"}
                    </Text>
                    {!!item.subtitle && (
                      <Text style={[sx.playerPreviewRowSub, { color: theme.subtext }]} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

            <View
              style={[
                sx.playerDock,
                { backgroundColor: theme.card2 },
                { paddingBottom: Math.max(12, insets.bottom + 8) },
              ]}
            >
              <View style={[sx.playerDockHandle, { backgroundColor: theme.border }]} />

            <View style={sx.playerDockRow}>
              <View style={sx.playerDockItem}>
                <View style={[sx.playerDockCircle, { backgroundColor: modeCircleBg }]}>
                  <Feather name={modeIcon} size={26} color={playerAccent} />
                  <View style={[sx.playerModeBadge, { backgroundColor: playerAccent }]}>
                    <Feather name="check" size={12} color={playerAccentText} />
                  </View>
                </View>
                <Text style={[sx.playerDockLabel, { color: theme.text }]}>{modeLabel}</Text>
              </View>

              <TouchableOpacity
                onPress={startAction}
                style={[
                  sx.playerStartBtnWrap,
                ]}
                activeOpacity={0.9}
              >
                <View style={[sx.playerStartBtn, { backgroundColor: playerAccent }]}>
                  <Feather name="play" size={34} color={playerAccentText} style={{ marginLeft: 3 }} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => Alert.alert("Sensors", "Sensor support is coming soon.")}
                style={sx.playerDockItem}
                activeOpacity={0.88}
              >
                <View style={[sx.playerDockCircle, { backgroundColor: theme.cardSoft }]}>
                  <Feather name="heart" size={26} color={theme.text} />
                </View>
                <Text style={[sx.playerDockLabel, { color: theme.text }]}>Add a sensor</Text>
              </TouchableOpacity>
            </View>
            </View>
        </View>
      </SafeAreaView>
    );
  }

  /* -------------------------------------------------------------- */
  /* RUN MODE                                                        */
  /* -------------------------------------------------------------- */

  if (isRun) {
    const isAcquiring = runState === "acquiring";
    const isRunning = runState === "running";
    const isPaused = runState === "paused";
    const topOffset = Math.max(8, insets.top + 8);
    const runStatusLabel = isAcquiring ? "Acquiring GPS" : isPaused ? "Paused" : "Recording";
    const runStatusDot = isPaused || isAcquiring ? theme.warning : theme.success;

    const topText = expanded ? theme.text : "#FFFFFF";
    const topBorder = expanded ? theme.border : "rgba(255,255,255,0.20)";

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        {ScreenHeader}
        <View style={{ flex: 1 }}>
          <StatusBar
            translucent
            backgroundColor="transparent"
            barStyle={!expanded ? "light-content" : theme.isDark ? "light-content" : "dark-content"}
          />

        {!expanded ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={initialRegion}
            showsUserLocation
            followsUserLocation={followUser && isRunning}
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
          >
            {plannedRoute.length >= 2 ? (
              <Polyline
                coordinates={plannedRoute}
                strokeWidth={4}
                strokeColor={theme.isDark ? "rgba(255,255,255,0.4)" : "rgba(15,23,42,0.3)"}
              />
            ) : null}
            {coords.length >= 2 ? (
              <Polyline
                coordinates={coords}
                strokeWidth={6}
                strokeColor={theme.primaryBg}
              />
            ) : null}
          </MapView>
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.bg }]} />
        )}

        {!expanded ? (
          <>
            <LinearGradient
              colors={["rgba(0,0,0,0.28)", "rgba(0,0,0,0.10)", "rgba(0,0,0,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { height: 220 }]}
              pointerEvents="none"
            />
            <LinearGradient
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.14)", "rgba(0,0,0,0.28)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[StyleSheet.absoluteFillObject, { top: undefined, height: 260, bottom: 0 }]}
              pointerEvents="none"
            />
          </>
        ) : null}

              <View style={[sx.runTopBar, { top: topOffset, left: 12, right: 12 }]} pointerEvents="box-none">
              <View style={sx.headerRow}>
                <View style={sx.runHeaderLeftSlot}>
                  <TouchableOpacity
                    onPress={onCloseLive}
                    style={[
                    sx.iconBtn,
                    {
                      backgroundColor: expanded ? "transparent" : "rgba(0,0,0,0.18)",
                    },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Feather name="x" size={18} color={topText} />
                  </TouchableOpacity>
                </View>

            <Text style={[sx.headerTitle, { color: topText }]} numberOfLines={1}>
              {session?.name || session?.title || "Run"}
            </Text>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => setSettingsOpen((p) => !p)}
                style={[
                  sx.iconBtn,
                  {
                    backgroundColor: expanded ? "transparent" : "rgba(0,0,0,0.18)",
                  },
                ]}
                activeOpacity={0.85}
              >
                <Feather name="settings" size={18} color={topText} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setExpanded((p) => !p)}
                style={[
                  sx.iconBtn,
                  {
                    backgroundColor: expanded ? "transparent" : "rgba(0,0,0,0.18)",
                  },
                ]}
                activeOpacity={0.85}
              >
                <Feather name="maximize-2" size={18} color={topText} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

          {settingsOpen ? (
          <View
            style={[
              sx.settingsCard,
              {
                top: topOffset + 52,
                backgroundColor: theme.card2,
              },
            ]}
          >
            <Text style={[sx.sectionTitle, { color: theme.text }]}>Recording settings</Text>

            <View style={sx.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>Auto-pause</Text>
                <Text style={{ color: theme.subtext, marginTop: 2 }}>
                  Pause timer when you stop moving.
                </Text>
              </View>
              <Switch value={autoPauseEnabled} onValueChange={setAutoPauseEnabled} />
            </View>

            <View style={sx.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>Beacon link</Text>
                <Text style={{ color: theme.subtext, marginTop: 2 }}>
                  Share a live tracking link.
                </Text>
              </View>
              <Switch value={beaconEnabled} onValueChange={setBeaconEnabled} />
            </View>

            <View style={sx.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>Follow me on map</Text>
                <Text style={{ color: theme.subtext, marginTop: 2 }}>
                  Keep the map centred on you.
                </Text>
              </View>
              <Switch value={followUser} onValueChange={setFollowUser} />
            </View>

            <View style={sx.settingRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>Cue feedback</Text>
                <Text style={{ color: theme.subtext, marginTop: 2 }}>
                  Vibrate on splits, auto-pause, and step changes.
                </Text>
              </View>
              <Switch value={cueFeedbackEnabled} onValueChange={setCueFeedbackEnabled} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity
                onPress={shareBeacon}
                disabled={!beaconEnabled}
                style={[
                  sx.secondaryBtn,
                  {
                    backgroundColor: theme.cardSoft,
                    opacity: beaconEnabled ? 1 : 0.5,
                  },
                ]}
                activeOpacity={0.9}
              >
                <Feather name="share-2" size={16} color={theme.text} />
                <Text style={{ color: theme.text, fontWeight: "900" }}>Share link</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setSettingsOpen(false)}
                style={[sx.secondaryBtn, { backgroundColor: theme.cardSoft }]}
                activeOpacity={0.9}
              >
                <Feather name="x" size={16} color={theme.text} />
                <Text style={{ color: theme.text, fontWeight: "900" }}>Close</Text>
              </TouchableOpacity>
            </View>

            {beaconLink ? (
              <Text style={{ marginTop: 10, color: theme.subtext }} numberOfLines={2}>
                {beaconLink}
              </Text>
            ) : null}
          </View>
        ) : null}

          {expanded ? (
          <View style={[sx.expandedWrap, { top: topOffset + 52, backgroundColor: theme.bg }]}>
            <Text style={[sx.gpsLabel, { color: theme.subtext }]}>{gpsLabel || ""}</Text>

            <Text style={[sx.bigTime, { color: theme.text }]}>{secondsToHMMSS(liveDurationSec)}</Text>

            <View style={{ height: 10 }} />

            <Text style={[sx.bigPaceValue, { color: theme.text }]}>{primaryPace}</Text>
            <Text style={[sx.bigMetricLabel, { color: theme.subtext }]}>
              {movingPace ? "Moving pace (/km)" : "Avg. pace (/km)"}
            </Text>

            <View style={{ height: 18 }} />

            <Text style={[sx.bigDistValue, { color: theme.text }]}>{liveDistanceKm.toFixed(2)}</Text>
            <Text style={[sx.bigMetricLabel, { color: theme.subtext }]}>Distance (km)</Text>

            <View style={[sx.miniRow, { backgroundColor: theme.cardSoft }]}>
              <View style={sx.miniCol}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>
                  {secondsToMMSS(movingDurationSec)}
                </Text>
                <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2 }}>Moving</Text>
              </View>
              <View style={sx.miniCol}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>{splits.length}</Text>
                <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2 }}>Splits</Text>
              </View>
              <View style={sx.miniCol}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>
                  {autoPauseEnabled ? "On" : "Off"}
                </Text>
                <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2 }}>
                  Auto-pause
                </Text>
              </View>
            </View>

            {execSteps.length ? (
              <View style={[sx.expandedStepPill, { backgroundColor: theme.cardSoft }]}>
                <Text style={{ color: theme.subtext, fontWeight: "900", fontSize: 12 }}>
                  Step {activeStepIndex + 1}/{execSteps.length}
                </Text>
                <Text style={{ color: theme.text, fontWeight: "900", marginTop: 2 }} numberOfLines={1}>
                  {activeStep?.title || "Step"}
                </Text>
                <Text style={{ color: theme.subtext, marginTop: 2, fontWeight: "800" }}>
                  {activeStep?.durationLabel
                    ? `${activeStep.durationLabel} · ${stepRemainingLabel}`
                    : stepRemainingLabel}
                </Text>
              </View>
            ) : null}

            <View style={[sx.expandedBottomControls, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
              {(isRunning || isAcquiring) ? (
                <TouchableOpacity
                  onPress={onPause}
                  disabled={!isRunning}
                  style={[
                    sx.bigPrimaryBtn,
                    { backgroundColor: theme.primaryBg, opacity: isRunning ? 1 : 0.75 },
                  ]}
                  activeOpacity={0.9}
                >
                  {isAcquiring ? (
                    <ActivityIndicator color={theme.primaryText} />
                  ) : (
                    <Feather name="pause" size={22} color={theme.primaryText} />
                  )}
                  <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 16 }}>
                    {isAcquiring ? "Acquiring…" : "Pause"}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {isPaused ? (
                <>
                  <View
                    style={[
                      sx.pauseSummaryCard,
                      { backgroundColor: theme.cardSoft, marginBottom: 12 },
                    ]}
                  >
                    <Text style={{ color: theme.subtext, fontWeight: "900", fontSize: 12 }}>
                      Paused summary
                    </Text>
                    <Text style={{ color: theme.text, fontWeight: "900", marginTop: 3 }}>
                      {secondsToMMSS(liveDurationSec)} · {liveDistanceKm.toFixed(2)} km · {primaryPace}/km
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <TouchableOpacity
                    onPress={onResume}
                    style={[sx.bigHalfBtn, { backgroundColor: theme.primaryBg }]}
                    activeOpacity={0.9}
                  >
                    <Feather name="play" size={22} color={theme.primaryText} />
                    <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 16 }}>
                      Resume
                    </Text>
                  </TouchableOpacity>

                    <TouchableOpacity
                      onPress={confirmFinishRun}
                      disabled={saving}
                      style={[
                        sx.bigHalfBtn,
                        { backgroundColor: theme.text, opacity: saving ? 0.7 : 1 },
                      ]}
                      activeOpacity={0.9}
                    >
                      <Feather name="flag" size={20} color={theme.bg} />
                      <Text style={{ color: theme.bg, fontWeight: "900", fontSize: 16 }}>
                        {saving ? "Saving…" : "End & Save"}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    onPress={confirmDiscardSession}
                    style={sx.pauseDiscardBtn}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: theme.subtext, fontWeight: "800" }}>Discard session</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </View>
          ) : (
          <View
            style={[
              sx.runSheet,
              {
                backgroundColor: theme.card2,
                paddingBottom: Math.max(14, insets.bottom + 10),
              },
            ]}
          >
            {gpsLabel ? (
              <View style={[sx.gpsBar, { backgroundColor: "transparent" }]}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>{gpsLabel}</Text>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  {beaconEnabled ? (
                    <TouchableOpacity
                      onPress={shareBeacon}
                      style={sx.gpsExpandBtn}
                      activeOpacity={0.85}
                    >
                      <Feather name="share-2" size={18} color={theme.text} />
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    onPress={() => setExpanded(true)}
                    style={sx.gpsExpandBtn}
                    activeOpacity={0.85}
                  >
                    <Feather name="maximize-2" size={18} color={theme.text} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View
              style={[
                sx.liveStatePill,
                { backgroundColor: "transparent" },
              ]}
            >
              <View style={[sx.liveStateDot, { backgroundColor: runStatusDot }]} />
              <Text style={{ color: theme.text, fontWeight: "800", fontSize: 12 }}>
                {runStatusLabel}
              </Text>
            </View>

            <View style={sx.sheetStatsRow}>
              <View
                style={[
                  sx.statCol,
                  sx.metricCard,
                  {
                    backgroundColor: "transparent",
                  },
                ]}
              >
                <Text style={[sx.statValue, { color: theme.text }]}>{secondsToMMSS(liveDurationSec)}</Text>
                <Text style={[sx.statLabel, { color: theme.subtext }]}>Time</Text>
              </View>

              <View
                style={[
                  sx.statCol,
                  sx.metricCard,
                  {
                    backgroundColor: "transparent",
                  },
                ]}
              >
                <Text style={[sx.statValue, { color: theme.text }]}>{primaryPace}</Text>
                <Text style={[sx.statLabel, { color: theme.subtext }]}>
                  {movingPace ? "Moving pace (/km)" : "Avg. pace (/km)"}
                </Text>
              </View>

              <View
                style={[
                  sx.statCol,
                  sx.metricCard,
                  {
                    backgroundColor: "transparent",
                  },
                ]}
              >
                <Text style={[sx.statValue, { color: theme.text }]}>{liveDistanceKm.toFixed(2)}</Text>
                <Text style={[sx.statLabel, { color: theme.subtext }]}>Distance (km)</Text>
              </View>
            </View>

            {execSteps.length ? (
              <View style={[sx.activeStepCard, { backgroundColor: "transparent" }]}>
                <TouchableOpacity
                  onPress={goPrevStep}
                  disabled={activeStepIndex === 0}
                  style={[
                    sx.stepNavBtn,
                    { opacity: activeStepIndex === 0 ? 0.45 : 1 },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-left" size={18} color={theme.text} />
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.subtext, fontWeight: "900", fontSize: 12 }}>
                    Step {activeStepIndex + 1}/{execSteps.length}
                  </Text>
                  <Text style={{ color: theme.text, fontWeight: "900", fontSize: 15, marginTop: 2 }}>
                    {activeStep?.title || "Step"}
                  </Text>
                  {activeStep?.durationLabel ? (
                    <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2 }}>
                      {activeStep.durationLabel}
                    </Text>
                  ) : null}
                  <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 4 }}>
                    {stepRemainingLabel}
                  </Text>

                  <View
                    style={[
                      sx.progressBarOuter,
                      { backgroundColor: theme.cardSoft },
                    ]}
                  >
                    <View
                      style={[
                        sx.progressBarInner,
                        { width: `${Math.round(stepProgress * 100)}%`, backgroundColor: theme.primaryBg },
                      ]}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  onPress={goNextStep}
                  disabled={activeStepIndex >= execSteps.length - 1}
                  style={[
                    sx.stepNavBtn,
                    {
                      opacity: activeStepIndex >= execSteps.length - 1 ? 0.45 : 1,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-right" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>
            ) : null}

            {splits.length ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[sx.sectionTitle, { color: theme.text }]}>Splits</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingTop: 8 }}
                >
                  {splits.map((sp, idx) => (
                    <View
                      key={`split-${idx}-${sp.km}`}
                      style={[sx.splitPill, { backgroundColor: theme.cardSoft }]}
                    >
                      <Text style={{ color: theme.text, fontWeight: "900" }}>
                        {sp?.manual ? `Lap ${sp.km} km` : `${sp.km} km`}
                      </Text>
                      <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2 }}>
                        {sp.pace}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {stepList.length ? (
              <View style={{ marginTop: 12 }}>
                <Text style={[sx.sectionTitle, { color: theme.text }]}>Workout steps</Text>

                {stepList.slice(0, 6).map((stp, idx) => (
                  <View
                    key={`step-row-${idx}`}
                    style={[sx.stepRow, { backgroundColor: "transparent" }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontWeight: "900" }}>
                        {stp.title}
                      </Text>
                      {stp.subtitle ? (
                        <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2 }}>
                          {stp.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ color: theme.subtext, fontWeight: "800" }}>
                      {stp.kind === "repeat" ? "Repeat" : "Step"}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {isPaused ? (
              <View
                style={[
                  sx.pauseSummaryCard,
                  { marginTop: 12, backgroundColor: "transparent" },
                ]}
              >
                <Text style={{ color: theme.subtext, fontWeight: "900", fontSize: 12 }}>
                  Paused summary
                </Text>
                <Text style={{ color: theme.text, fontWeight: "900", marginTop: 3 }}>
                  {secondsToMMSS(liveDurationSec)} · {liveDistanceKm.toFixed(2)} km · {primaryPace}/km
                </Text>
              </View>
            ) : null}

            <View style={sx.sheetButtonsRow}>
              {(isRunning || isAcquiring) ? (
                <>
                  <TouchableOpacity
                    onPress={onPause}
                    disabled={!isRunning}
                  style={[
                    sx.sheetMainBtn,
                    { backgroundColor: theme.primaryBg, opacity: isRunning ? 1 : 0.75 },
                  ]}
                  activeOpacity={0.9}
                >
                  {isAcquiring ? (
                    <ActivityIndicator color={theme.primaryText} />
                  ) : (
                    <Feather name="pause" size={20} color={theme.primaryText} />
                  )}
                  <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 15 }}>
                    {isAcquiring ? "Acquiring…" : "Pause"}
                  </Text>
                </TouchableOpacity>

                  <TouchableOpacity
                    onPress={onLapPress}
                    disabled={!isRunning}
                    style={[sx.sheetLapBtn, { backgroundColor: theme.cardSoft }]}
                    activeOpacity={0.85}
                  >
                    <Feather
                      name="flag"
                      size={18}
                      color={isRunning ? theme.text : theme.subtext}
                    />
                    <Text style={{ color: isRunning ? theme.text : theme.subtext, fontWeight: "800", fontSize: 11 }}>
                      Lap
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {isPaused ? (
                <>
                  <TouchableOpacity
                    onPress={onResume}
                    style={[sx.sheetHalfBtn, { backgroundColor: theme.primaryBg }]}
                    activeOpacity={0.9}
                  >
                    <Feather name="play" size={20} color={theme.primaryText} />
                    <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 15 }}>
                      Resume
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={confirmFinishRun}
                    disabled={saving}
                    style={[
                      sx.sheetHalfBtn,
                      { backgroundColor: theme.text, opacity: saving ? 0.7 : 1 },
                    ]}
                    activeOpacity={0.9}
                  >
                    <Feather name="flag" size={18} color={theme.bg} />
                    <Text style={{ color: theme.bg, fontWeight: "900", fontSize: 15 }}>
                      {saving ? "Saving…" : "End & Save"}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>

            {isPaused ? (
              <TouchableOpacity
                onPress={confirmDiscardSession}
                style={sx.pauseDiscardBtn}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.subtext, fontWeight: "800" }}>Discard session</Text>
              </TouchableOpacity>
            ) : null}

            {runState !== "idle" && !isPaused ? (
              <TouchableOpacity
                onPress={onReset}
                style={{ marginTop: 12, alignItems: "center", paddingVertical: 6 }}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.subtext, fontWeight: "800" }}>Reset session</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  /* -------------------------------------------------------------- */
  /* NON-RUN MODE                                                    */
  /* -------------------------------------------------------------- */

  const strengthRunning = runState !== "idle" && runState !== "paused";
  const strengthPaused = runState === "paused";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      {ScreenHeader}
      <View style={{ flex: 1, padding: 16, paddingBottom: Math.max(14, insets.bottom + 10) }}>
          <View style={sx.headerRow}>
            <View style={sx.headerGhost}>
              <TouchableOpacity
                onPress={onCloseLive}
                style={[
                  sx.headerCollapseBtn,
                  { backgroundColor: theme.card2 },
                ]}
                activeOpacity={0.85}
              >
                <Feather name="x" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>

          <Text style={[sx.headerTitle, { color: theme.text }]}>Strength live</Text>
          <View style={sx.headerGhost} />
        </View>

        <View
          style={[
            sx.card,
            {
              marginTop: 14,
              backgroundColor: theme.card2,
            },
          ]}
        >
          <Text style={{ color: theme.subtext, fontWeight: "800" }}>Elapsed</Text>
          <Text style={[sx.bigTime, { marginTop: 2, fontSize: 56, color: theme.text }]}>
            {secondsToHMMSS(liveDurationSec)}
          </Text>
          <Text style={{ color: theme.subtext, marginTop: 4 }}>Time of day · {timeOfDayLabel}</Text>
          <View style={sx.strengthMetaRow}>
            <View
              style={[
                sx.strengthMetaPill,
                {
                  backgroundColor: theme.isDark
                    ? "rgba(16,185,129,0.18)"
                    : "rgba(16,185,129,0.12)",
                },
              ]}
            >
              <Text style={[sx.strengthMetaPillText, { color: theme.text }]}>
                {strengthLoggedCount}/{strengthLoggableCount || strengthExercises.length} logged
              </Text>
            </View>
            <View
              style={[
                sx.strengthMetaPill,
                {
                  backgroundColor: theme.isDark
                    ? "rgba(230,255,59,0.18)"
                    : "rgba(230,255,59,0.22)",
                },
              ]}
            >
              <Text style={[sx.strengthMetaPillText, { color: theme.text }]}>
                {strengthPaused ? "Paused" : "Live"}
              </Text>
            </View>
          </View>

          {strengthRestSecLeft > 0 ? (
            <View
              style={[
                sx.strengthRestBanner,
                { backgroundColor: "transparent" },
              ]}
            >
              <View>
                <Text style={{ color: theme.subtext, fontWeight: "800", fontSize: 11 }}>
                  Rest timer
                </Text>
                <Text style={{ color: theme.text, fontWeight: "900", marginTop: 2 }}>
                  {secondsToMMSS(strengthRestSecLeft)}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => {
                  setStrengthRestSecLeft(0);
                  setStrengthRestExerciseId(null);
                }}
                style={[sx.strengthRestSkipBtn, { backgroundColor: theme.cardSoft }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "800" }}>Skip</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={sx.strengthHeroActions}>
            {strengthRunning ? (
              <View style={[sx.sheetButtonsRow, { marginTop: 0 }]}>
                <TouchableOpacity
                  onPress={onStrengthPause}
                  style={[sx.sheetHalfBtn, { backgroundColor: theme.primaryBg }]}
                  activeOpacity={0.9}
                >
                  <Feather name="pause" size={20} color={theme.primaryText} />
                  <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 15 }}>
                    Pause
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={confirmFinishStrength}
                  disabled={saving}
                  style={[
                    sx.sheetHalfBtn,
                    { backgroundColor: theme.text, opacity: saving ? 0.7 : 1 },
                  ]}
                  activeOpacity={0.9}
                >
                  <Feather name="flag" size={18} color={theme.bg} />
                  <Text style={{ color: theme.bg, fontWeight: "900", fontSize: 15 }}>
                    {saving ? "Saving…" : "End & Save"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {strengthPaused ? (
              <>
                <View style={[sx.pauseSummaryCard, { marginTop: 0, backgroundColor: "transparent" }]}>
                  <Text style={{ color: theme.subtext, fontWeight: "900", fontSize: 12 }}>
                    Paused summary
                  </Text>
                  <Text style={{ color: theme.text, fontWeight: "900", marginTop: 3 }}>
                    {secondsToMMSS(liveDurationSec)} elapsed · {strengthLoggedCount}/{strengthLoggableCount || strengthExercises.length} logged
                  </Text>
                </View>

                <View style={sx.sheetButtonsRow}>
                  <TouchableOpacity
                    onPress={onStrengthResume}
                    style={[sx.sheetHalfBtn, { backgroundColor: theme.primaryBg }]}
                    activeOpacity={0.9}
                  >
                    <Feather name="play" size={20} color={theme.primaryText} />
                    <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 15 }}>
                      Resume
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={confirmFinishStrength}
                    disabled={saving}
                    style={[
                      sx.sheetHalfBtn,
                      { backgroundColor: theme.text, opacity: saving ? 0.7 : 1 },
                    ]}
                    activeOpacity={0.9}
                  >
                    <Feather name="flag" size={18} color={theme.bg} />
                    <Text style={{ color: theme.bg, fontWeight: "900", fontSize: 15 }}>
                      {saving ? "Saving…" : "End & Save"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {(strengthRunning || strengthPaused) ? (
              <TouchableOpacity
                onPress={confirmDiscardSession}
                style={sx.pauseDiscardBtn}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.subtext, fontWeight: "800" }}>Discard session</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View
          style={[
            sx.card,
            {
              flex: 1,
              minHeight: 0,
              marginTop: 12,
              backgroundColor: theme.card2,
            },
          ]}
        >
          <Text style={[sx.weekTitle, { color: theme.text }]}>Workout</Text>

          <ScrollView
            style={{ marginTop: 10, flex: 1 }}
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {strengthSections.length ? (
              strengthSections.map((section, sectionIdx) => (
                <View key={`strength-section-${section.id}`} style={sx.strengthSectionWrap}>
                  <View
                    style={[
                      sx.strengthBlockHeader,
                      { backgroundColor: "transparent" },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[sx.strengthBlockOverline, { color: theme.subtext }]}>
                        Block {sectionIdx + 1}
                      </Text>
                      <Text style={[sx.strengthBlockTitle, { color: theme.text }]}>
                        {section.title}
                      </Text>
                    </View>

                    {section.loggableCount ? (
                      <View
                        style={[
                          sx.strengthBlockMetaPill,
                          { backgroundColor: "transparent" },
                        ]}
                      >
                        <Text style={[sx.strengthBlockMetaPillText, { color: theme.text }]}>
                          {section.loggedCount}/{section.loggableCount} logged
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {section.items.map((item) => {
                    const entry = strengthEntryById?.[item.id] || {};
                    const isLoggable = item?.isLoggable !== false;
                    const setLogs = Array.isArray(entry?.setLogs) ? entry.setLogs : [];
                    const completedSets = setLogs.filter((row) => !!row?.completed).length;
                    const setProgressLabel = setLogs.length
                      ? `${completedSets}/${setLogs.length} sets`
                      : "No sets";
                    const allSetsComplete = !!setLogs.length && completedSets === setLogs.length;
                    const exerciseDone = isLoggable ? allSetsComplete : !!entry.completed;

                    const prescribedBits = [
                      isLoggable && item.prescribedSets ? `${item.prescribedSets} sets` : null,
                      isLoggable && item.prescribedReps ? `${item.prescribedReps} reps` : null,
                      isLoggable && item.prescribedLoadKg ? `${item.prescribedLoadKg} kg` : null,
                      isLoggable && item.prescribedRestSec ? `rest ${item.prescribedRestSec}s` : null,
                    ].filter(Boolean);

                    return (
                      <View
                        key={`strength-preview-${item.id}`}
                        style={[
                          sx.stepRow,
                          sx.strengthExerciseCard,
                          { marginTop: 0, backgroundColor: "transparent" },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.text, fontWeight: "900" }}>
                            {item.title || "Exercise"}
                          </Text>

                          <View style={sx.strengthExerciseMetaRow}>
                            {prescribedBits.length ? (
                              <Text style={{ color: theme.subtext, fontWeight: "800", marginTop: 2, flex: 1 }}>
                                Prescribed: {prescribedBits.join(" · ")}
                              </Text>
                            ) : (
                              <View style={{ flex: 1 }} />
                            )}

                            {isLoggable ? (
                              <View
                                style={[
                                  sx.strengthSetProgressPill,
                                  { backgroundColor: "transparent" },
                                ]}
                              >
                                <Text style={[sx.strengthSetProgressText, { color: theme.text }]}>
                                  {setProgressLabel}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          {isLoggable ? (
                            <>
                              <View style={sx.strengthSetGrid}>
                                <View style={sx.strengthSetHeaderRow}>
                                  <Text
                                    style={[
                                      sx.strengthSetHeaderText,
                                      { color: theme.subtext, width: 52 },
                                    ]}
                                  >
                                    Set
                                  </Text>
                                  <Text
                                    style={[
                                      sx.strengthSetHeaderText,
                                      { color: theme.subtext, flex: 1, textAlign: "center" },
                                    ]}
                                  >
                                    kg
                                  </Text>
                                  <Text
                                    style={[
                                      sx.strengthSetHeaderText,
                                      { color: theme.subtext, flex: 1, textAlign: "center" },
                                    ]}
                                  >
                                    Reps
                                  </Text>
                                  <Text
                                    style={[
                                      sx.strengthSetHeaderText,
                                      { color: theme.subtext, width: 42, textAlign: "center" },
                                    ]}
                                  >
                                    Done
                                  </Text>
                                </View>

                                {setLogs.map((setRow, setIdx) => (
                                  <View key={`${item.id}-set-${setIdx}`} style={sx.strengthSetRow}>
                                    <View
                                      style={[
                                        sx.strengthSetIndex,
                                        { backgroundColor: theme.cardSoft },
                                      ]}
                                    >
                                      <Text style={[sx.strengthSetIndexText, { color: theme.text }]}>
                                        {setIdx + 1}
                                      </Text>
                                    </View>

                                    <View
                                      style={[
                                        sx.strengthSetInputWrap,
                                        { backgroundColor: theme.cardSoft },
                                      ]}
                                    >
                                      <TextInput
                                        value={String(setRow?.weightKg || "")}
                                        onChangeText={(v) =>
                                          updateStrengthSetRow(item.id, setIdx, {
                                            weightKg: v.replace(/[^0-9.]/g, ""),
                                          })
                                        }
                                        keyboardType="decimal-pad"
                                        placeholder="0"
                                        placeholderTextColor={theme.subtext}
                                        style={[sx.strengthSetInput, { color: theme.text }]}
                                      />
                                    </View>

                                    <View
                                      style={[
                                        sx.strengthSetInputWrap,
                                        { backgroundColor: theme.cardSoft },
                                      ]}
                                    >
                                      <TextInput
                                        value={String(setRow?.reps || "")}
                                        onChangeText={(v) =>
                                          updateStrengthSetRow(item.id, setIdx, {
                                            reps: v.replace(/[^0-9]/g, ""),
                                          })
                                        }
                                        keyboardType="number-pad"
                                        placeholder="0"
                                        placeholderTextColor={theme.subtext}
                                        style={[sx.strengthSetInput, { color: theme.text }]}
                                      />
                                    </View>

                                    <TouchableOpacity
                                      onPress={() =>
                                        toggleStrengthSetCompleted(
                                          item.id,
                                          setIdx,
                                          item?.prescribedRestSec || 0
                                        )
                                      }
                                      style={[
                                        sx.strengthSetDoneBtn,
                                        {
                                          backgroundColor: setRow?.completed
                                            ? "rgba(22,163,74,0.16)"
                                            : theme.cardSoft,
                                        },
                                      ]}
                                      activeOpacity={0.85}
                                    >
                                      <Feather
                                        name={setRow?.completed ? "check" : "circle"}
                                        size={14}
                                        color={setRow?.completed ? theme.success : theme.subtext}
                                      />
                                    </TouchableOpacity>
                                  </View>
                                ))}

                                <View style={sx.strengthSetActionRow}>
                                  <TouchableOpacity
                                    onPress={() => addStrengthSetRow(item.id)}
                                    style={[
                                      sx.strengthSetActionBtn,
                                      { backgroundColor: "transparent" },
                                    ]}
                                    activeOpacity={0.85}
                                  >
                                    <Feather name="plus" size={14} color={theme.text} />
                                    <Text style={[sx.strengthSetActionText, { color: theme.text }]}>
                                      Add set
                                    </Text>
                                  </TouchableOpacity>

                                  {setLogs.length > 1 ? (
                                    <TouchableOpacity
                                      onPress={() => removeStrengthSetRow(item.id, setLogs.length - 1)}
                                      style={[
                                        sx.strengthSetActionBtn,
                                        { backgroundColor: "transparent" },
                                      ]}
                                      activeOpacity={0.85}
                                    >
                                      <Feather name="minus" size={14} color={theme.subtext} />
                                      <Text
                                        style={[
                                          sx.strengthSetActionText,
                                          { color: theme.subtext },
                                        ]}
                                      >
                                        Remove last
                                      </Text>
                                    </TouchableOpacity>
                                  ) : null}
                                </View>
                              </View>

                              <TextInput
                                value={String(entry.notes || "")}
                                onChangeText={(v) => updateStrengthEntry(item.id, { notes: v })}
                                placeholder="Exercise notes (optional)"
                                placeholderTextColor={theme.subtext}
                                style={[
                                  sx.strengthExerciseNotes,
                                  {
                                    color: theme.text,
                                    backgroundColor: theme.cardSoft,
                                  },
                                ]}
                              />
                            </>
                          ) : (
                            <View
                              style={[
                                sx.strengthAuxRow,
                                { backgroundColor: "transparent" },
                              ]}
                            >
                              <Feather name="minus-circle" size={14} color={theme.subtext} />
                              <Text style={[sx.strengthAuxText, { color: theme.subtext }]}>
                                Warm-up/cool-down step. No load entry needed.
                              </Text>
                            </View>
                          )}
                        </View>

                        {isLoggable ? (
                          <View
                            style={[
                              sx.strengthCompleteStatic,
                              {
                                backgroundColor: exerciseDone ? "rgba(22,163,74,0.16)" : theme.card,
                              },
                            ]}
                          >
                            <Feather
                              name={exerciseDone ? "check-circle" : "circle"}
                              size={18}
                              color={exerciseDone ? theme.success : theme.subtext}
                            />
                            <Text
                              style={{
                                color: exerciseDone ? theme.success : theme.subtext,
                                fontWeight: "800",
                                marginTop: 4,
                                fontSize: 11,
                              }}
                            >
                              {exerciseDone ? "Done" : "Sets"}
                            </Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() =>
                              updateStrengthEntry(item.id, {
                                completed: !entry.completed,
                              })
                            }
                            style={[
                              sx.strengthCompleteBtn,
                              {
                                backgroundColor: entry.completed ? "rgba(22,163,74,0.16)" : theme.card,
                              },
                            ]}
                            activeOpacity={0.85}
                          >
                            <Feather
                              name={entry.completed ? "check-circle" : "circle"}
                              size={18}
                              color={entry.completed ? theme.success : theme.subtext}
                            />
                            <Text
                              style={{
                                color: entry.completed ? theme.success : theme.subtext,
                                fontWeight: "800",
                                marginTop: 4,
                                fontSize: 11,
                              }}
                            >
                              Done
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))
            ) : (
              <Text style={{ color: theme.subtext }}>
                No structured exercises found for this session.
              </Text>
            )}

            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Session notes"
              placeholderTextColor={theme.subtext}
              multiline
              style={[
                sx.strengthSessionNotes,
                {
                  color: theme.text,
                  backgroundColor: theme.cardSoft,
                },
              ]}
            />
          </ScrollView>
        </View>

      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

const sx = StyleSheet.create({
  safe: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  playerTopBar: {
    paddingHorizontal: 10,
    alignItems: "flex-start",
  },
  playerCollapseBtn: {
    width: 44,
    height: 36,
    borderRadius: 999,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  playerElapsed: {
    marginTop: 6,
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: "#111111",
    textAlign: "center",
  },
  playerClockWrap: {
    marginTop: 28,
    alignItems: "center",
  },
  playerClockText: {
    fontSize: 72,
    lineHeight: 78,
    fontWeight: "900",
    color: "#111111",
  },
  playerClockSub: {
    marginTop: 2,
    color: "#5B5B5B",
    fontSize: 16,
    fontWeight: "700",
  },
  playerPreviewWrap: {
    marginTop: 18,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 0,
  },
  playerPreviewTitle: {
    color: "#141414",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  playerPreviewRow: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 0,
  },
  playerPreviewRowTitle: {
    color: "#121212",
    fontSize: 14,
    fontWeight: "900",
  },
  playerPreviewRowSub: {
    marginTop: 2,
    color: "#595959",
    fontSize: 12,
    fontWeight: "700",
  },
  playerDock: {
    marginTop: "auto",
    backgroundColor: "#F7F7F7",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 0,
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  playerDockHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#D2D2D2",
    alignSelf: "center",
  },
  playerDockRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  playerDockItem: {
    width: 106,
    alignItems: "center",
    gap: 8,
  },
  playerDockCircle: {
    width: 86,
    height: 86,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  playerModeBadge: {
    position: "absolute",
    top: -4,
    right: -2,
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  playerDockLabel: {
    color: "#141414",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
  playerStartBtn: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  playerStartBtnWrap: {
    width: 98,
    height: 98,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  card: {
    borderWidth: 0,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "900",
  },
  weekTitle: {
    fontSize: 16,
    fontWeight: "900",
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerGhost: {
    width: 70,
  },
  runHeaderLeftSlot: {
    width: 90,
    alignItems: "flex-start",
  },
  headerCollapseBtn: {
    width: 40,
    height: 34,
    borderRadius: 999,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtn: {
    width: 40,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    flex: 1,
    textAlign: "center",
  },

  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    fontSize: 14,
  },
  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 12,
  },
  pauseSummaryCard: {
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pauseDiscardBtn: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 6,
  },
  strengthSectionWrap: {
    gap: 8,
    marginTop: 2,
  },
  strengthBlockHeader: {
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  strengthBlockOverline: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  strengthBlockTitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "800",
  },
  strengthBlockMetaPill: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  strengthBlockMetaPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  strengthSetGrid: {
    marginTop: 8,
    gap: 6,
  },
  strengthExerciseMetaRow: {
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  strengthSetHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 2,
  },
  strengthSetHeaderText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  strengthSetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  strengthSetIndex: {
    width: 52,
    height: 40,
    borderWidth: 0,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  strengthSetIndexText: {
    fontSize: 13,
    fontWeight: "900",
  },
  strengthSetInputWrap: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 8,
    height: 40,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  strengthSetInput: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    paddingVertical: 0,
  },
  strengthSetDoneBtn: {
    width: 42,
    height: 40,
    borderWidth: 0,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  strengthSetActionRow: {
    marginTop: 2,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  strengthSetActionBtn: {
    borderWidth: 0,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  strengthSetActionText: {
    fontSize: 11,
    fontWeight: "800",
  },
  strengthExerciseNotes: {
    marginTop: 8,
    borderWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontWeight: "600",
  },
  strengthAuxRow: {
    marginTop: 8,
    borderWidth: 0,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  strengthAuxText: {
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  strengthSessionNotes: {
    marginTop: 6,
    borderWidth: 0,
    borderRadius: 12,
    minHeight: 90,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "600",
    textAlignVertical: "top",
  },
  strengthCompleteBtn: {
    width: 64,
    minHeight: 74,
    borderWidth: 0,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  strengthCompleteStatic: {
    width: 64,
    minHeight: 74,
    borderWidth: 0,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  strengthMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  strengthRestBanner: {
    marginTop: 10,
    borderWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
  strengthMetaPill: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  strengthMetaPillText: {
    fontSize: 12,
    fontWeight: "800",
  },
  strengthHeroActions: {
    marginTop: 12,
    gap: 10,
  },
  strengthExerciseCard: {
    borderRadius: 14,
    paddingVertical: 12,
  },

  runTopBar: {
    position: "absolute",
    zIndex: 5,
  },

  settingsCard: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 10,
    borderWidth: 0,
    borderRadius: 16,
    padding: 12,
  },
  settingRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },

  runSheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderWidth: 0,
    borderRadius: 18,
    padding: 14,
    shadowColor: "transparent",
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },

  gpsBar: {
    borderWidth: 0,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  gpsExpandBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  liveStatePill: {
    borderWidth: 0,
    borderRadius: 999,
    minHeight: 32,
    paddingHorizontal: 11,
    marginBottom: 10,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveStateDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },

  sheetStatsRow: {
    marginTop: 2,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statCol: {
    flex: 1,
    alignItems: "center",
  },
  metricCard: {
    borderRadius: 14,
    paddingVertical: 10,
    marginHorizontal: 3,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 0,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "900",
  },
  statLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },

  sheetButtonsRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    justifyContent: "space-between",
  },
  sheetMainBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  sheetLapBtn: {
    width: 64,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0,
    gap: 2,
  },
  sheetHalfBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },

  sectionTitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "900",
  },

  stepRow: {
    marginTop: 10,
    borderWidth: 0,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },

  activeStepCard: {
    marginTop: 12,
    borderWidth: 0,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  stepNavBtn: {
    width: 40,
    height: 38,
    borderRadius: 12,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  progressBarOuter: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 0,
    marginTop: 8,
  },
  progressBarInner: {
    height: "100%",
    borderRadius: 999,
  },

  expandedWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  gpsLabel: {
    fontSize: 16,
    fontWeight: "800",
    marginTop: 8,
  },
  bigTime: {
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 10,
  },
  bigPaceValue: {
    fontSize: 44,
    fontWeight: "900",
    marginTop: 10,
  },
  bigDistValue: {
    fontSize: 74,
    fontWeight: "900",
    marginTop: 2,
  },
  bigMetricLabel: {
    fontSize: 16,
    fontWeight: "800",
    marginTop: 6,
  },

  expandedStepPill: {
    marginTop: 18,
    width: "100%",
    borderWidth: 0,
    borderRadius: 16,
    padding: 12,
  },
  expandedBottomControls: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 0,
  },
  bigPrimaryBtn: {
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
  },
  bigHalfBtn: {
    flex: 1,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
  },

  miniRow: {
    width: "100%",
    borderWidth: 0,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  miniCol: {
    flex: 1,
    alignItems: "center",
  },

  splitPill: {
    borderWidth: 0,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 90,
    alignItems: "center",
    justifyContent: "center",
  },
});
