/**
 * TRAIN-R — Onboarding: Race Date (Premium, Train-R original flow)
 * Route: /(protected)/train/onboarding/race-date
 *
 * Flow (12 steps):
 * 0) Race goal for THIS event
 * 1) Event details (name + distance + date) + optional "Find a race"
 * 2) Running ability
 * 3) Current best time (optional)
 * 4) Date of birth (recommended, optional)
 * 5) Gender (optional)
 * 6) Runs per week
 * 7) Days you can run (must meet runs/week)
 * 8) Long run day (from chosen days)
 * 9) Start date + plan length (auto-suggested based on race date)
 * 10) Training preferences (volume, intensity, surfaces, strength)
 * 11) Summary + Generate → then Welcome/Guide
 *
 * Saves:
 *  - users/{uid}/planPrefs/current (merge)
 *  - users/{uid}/plans (new doc)
 */

import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
    doc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
} from "firebase/firestore";

import { API_URL } from "../../../../config/api";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

import { useAiPlan } from "../../../../src/hooks/useAiPlan";
import { createPlanDocument, normalisePlanForSave } from "../../../../src/lib/train/planModel";
import { convertAiPlanToApp } from "../../../../src/lib/train/planTransformers";

/* ---------------- tokens ---------------- */
const PRIMARY = "#E6FF3B";
const INK = "#050506";
const CARD = "#111317";
const CARD_2 = "#0E1013";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.72)";
const MUTED_2 = "rgba(255,255,255,0.45)";
const DANGER = "#EF4444";

/* ---------------- options ---------------- */
const DISTANCE_OPTIONS = ["5K", "10K", "Half marathon", "Marathon", "Ultra", "Other"];
const RACE_GOALS = [
  { key: "pb", title: "Chase a PB", desc: "Structured intensity, sharper sessions, clear pacing." },
  { key: "strong_finish", title: "Finish strong", desc: "Build confidence, consistency and race-day execution." },
  { key: "first_time", title: "First time at this distance", desc: "Safe progression and smart long-run build." },
  { key: "enjoy", title: "Enjoy the build", desc: "Balanced training, good habits, lower stress." },
];

const ABILITY_LEVELS = [
  { key: "beginner", title: "Beginner", desc: "You can run ~5K (or close) but want structure." },
  { key: "intermediate", title: "Intermediate", desc: "You run most weeks but don’t follow a plan." },
  { key: "advanced", title: "Advanced", desc: "Regular 10K+ runs and some structured workouts." },
  { key: "performance", title: "Performance", desc: "Consistent training, quality sessions, higher volume." },
];

const GENDER_OPTIONS = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "nonbinary", label: "Non-binary" },
  { key: "nosay", label: "Prefer not to say" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LABELS = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];

const SURFACE_OPTIONS = ["Road", "Trail", "Treadmill", "Mix"];
const VOLUME_OPTIONS = [
  { key: "steady", title: "Steady", desc: "Smooth build, lower injury risk." },
  { key: "progressive", title: "Progressive", desc: "Push a bit more week to week." },
  { key: "ambitious", title: "Ambitious", desc: "More aggressive ramp (only if you’re robust)." },
];

const INTENSITY_OPTIONS = [
  { key: "balanced", title: "Balanced", desc: "A sensible mix of easy + quality." },
  { key: "performance", title: "Performance", desc: "A bit more intensity, still recoverable." },
  { key: "low_stress", title: "Low stress", desc: "Less intensity, more consistency." },
];

const STRENGTH_OPTIONS = [
  { key: "none", title: "No strength work", desc: "Running only." },
  { key: "light", title: "Light strength", desc: "Short, simple sessions to stay resilient." },
  { key: "full", title: "Full strength", desc: "Structured strength alongside running." },
];

const PB_DISTANCE_OPTIONS = ["5K", "10K", "Half marathon", "Marathon", "Other"];
const PB_RECENCY_OPTIONS = [
  { key: "recent", title: "Recent", desc: "Within the last 3 months" },
  { key: "this_year", title: "This year", desc: "3–12 months ago" },
  { key: "older", title: "Older", desc: "More than a year ago" },
];
const PB_SOURCE_OPTIONS = [
  { key: "race", title: "Official race", desc: "Chip time / official result" },
  { key: "parkrun", title: "Parkrun", desc: "Measured 5K (or similar)" },
  { key: "training", title: "Training effort", desc: "Hard session / solo attempt" },
  { key: "treadmill", title: "Treadmill", desc: "Indoor / gym time" },
];

/* ---------------- helpers ---------------- */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function fmtShort(date) {
  try {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(date);
  }
}
function formatDateYYYYMMDD(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysBetween(a, b) {
  const A = startOfDay(a).getTime();
  const B = startOfDay(b).getTime();
  return Math.round((B - A) / (1000 * 60 * 60 * 24));
}
function safeInt(s) {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function deriveGoalTypeFromDistance(distanceLabel) {
  const g = String(distanceLabel || "").toLowerCase();
  if (g.includes("5k")) return "5k";
  if (g.includes("10k")) return "10k";
  if (g.includes("half")) return "Half";
  if (g.includes("marathon") && !g.includes("half")) return "Marathon";
  if (g.includes("ultra")) return "Ultra";
  return "10k";
}
function normaliseTimeInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Keep only digits and colons
  return s.replace(/[^\d:]/g, "");
}
function parseTimeToSeconds(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const cleaned = s.replace(/[^\d:]/g, "");
  if (!cleaned) return null;

  const parts = cleaned.split(":").filter(Boolean).map((p) => safeInt(p));
  if (!parts.length) return null;

  // Accept:
  // mm:ss  (2 parts)
  // hh:mm:ss (3 parts)
  // ss (1 part) - treat as seconds (not recommended, but allow)
  let hh = 0;
  let mm = 0;
  let ss = 0;

  if (parts.length === 3) {
    [hh, mm, ss] = parts;
  } else if (parts.length === 2) {
    [mm, ss] = parts;
  } else {
    ss = parts[0];
  }

  // Basic sanity
  if (mm >= 60 || ss >= 60) return null;
  const total = hh * 3600 + mm * 60 + ss;
  if (!Number.isFinite(total) || total <= 0) return null;
  // Guard crazy values
  if (total > 24 * 3600) return null;
  return total;
}
function formatSecondsToTime(totalSeconds) {
  const t = Number(totalSeconds);
  if (!Number.isFinite(t) || t <= 0) return "";
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = Math.floor(t % 60);
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
function prettyPbRecency(k) {
  switch (k) {
    case "recent":
      return "Recent (<3 months)";
    case "this_year":
      return "This year (3–12 months)";
    case "older":
      return "Older (1y+)";
    default:
      return k;
  }
}
function prettyPbSource(k) {
  switch (k) {
    case "race":
      return "Official race";
    case "parkrun":
      return "Parkrun";
    case "training":
      return "Training effort";
    case "treadmill":
      return "Treadmill";
    default:
      return k;
  }
}

/* ---------------- reusable UI ---------------- */
function TopBar({ progress, onBack, onClose }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn} hitSlop={12}>
        <Feather name="arrow-left" size={22} color="white" />
      </TouchableOpacity>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={12}>
        <Feather name="x" size={22} color="white" />
      </TouchableOpacity>
    </View>
  );
}

function SectionTitle({ title, subtitle, right }) {
  return (
    <View style={{ marginTop: 12, marginBottom: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={styles.h1}>{title}</Text>
        {right ? <View style={{ marginLeft: 10 }}>{right}</View> : null}
      </View>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function SelectCircle({ selected }) {
  return (
    <View style={[styles.selectCircle, selected ? styles.selectCircleOn : null]}>
      {selected ? <Feather name="check" size={16} color={INK} /> : null}
    </View>
  );
}

function OptionRow({ title, desc, selected, onPress, leftIcon, rightNode }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={[styles.optionCard, selected ? styles.optionCardSelected : null]}
    >
      <View style={styles.optionRow}>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center", flex: 1 }}>
          {leftIcon ? <View style={styles.leftIconWrap}>{leftIcon}</View> : null}

          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>{title}</Text>
            {desc ? <Text style={styles.optionDesc}>{desc}</Text> : null}
          </View>
        </View>

        {rightNode ? rightNode : <SelectCircle selected={selected} />}
      </View>
    </TouchableOpacity>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.pill, active ? styles.pillSelected : null]}
    >
      <Text style={[styles.pillText, active ? styles.pillTextSelected : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function StickyFooter({ label, disabled, onPress, hint, secondaryLabel, onSecondary }) {
  return (
    <View style={styles.footerWrap}>
      {hint ? <Text style={styles.footerHint}>{hint}</Text> : null}

      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.92}
        disabled={disabled}
        style={[styles.primaryBtn, disabled ? styles.primaryBtnDisabled : null]}
      >
        <Text style={[styles.primaryBtnText, disabled ? { opacity: 0.55 } : null]}>{label}</Text>
      </TouchableOpacity>

      {secondaryLabel ? (
        <TouchableOpacity onPress={onSecondary} activeOpacity={0.85} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SummaryLine({ icon, label, value }) {
  return (
    <View style={styles.summaryLine}>
      <View style={styles.summaryLeft}>
        <Feather name={icon} size={16} color={PRIMARY} />
        <Text style={styles.summaryLabel}>{label}</Text>
      </View>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* ---------------- screen ---------------- */
export default function RaceDateOnboarding() {
  const router = useRouter();
  const params = useLocalSearchParams();
  useTheme();
  const { createPlan: createAiPlan } = useAiPlan();

  const bg = INK;

  const STEPS = useMemo(
    () => [
      { key: "goal", title: "What’s the goal for this race?", subtitle: "This shapes the structure, intensity and long-run progression." },
      { key: "event", title: "Tell us about the event", subtitle: "Event, distance and date — we build everything around this." },
      { key: "ability", title: "How would you rate your running right now?", subtitle: "Pick the level that fits you best — you can change it later." },
      { key: "pb", title: "Do you have a current best time?", subtitle: "Optional, but it helps calibrate paces and make the plan feel spot-on." },
      { key: "dob", title: "When is your birthday?", subtitle: "Recommended — helps personalise intensity and reduce injury risk." },
      { key: "gender", title: "What’s your gender?", subtitle: "Optional — helps tailor guidance. Not shown publicly." },
      { key: "freq", title: "How many days per week would you like to run?", subtitle: "Choose a sustainable frequency. Consistency wins." },
      { key: "days", title: "Which days are you free to run?", subtitle: "Select every day you could run so we can place sessions smartly." },
      { key: "longrun", title: "Which day suits your long run?", subtitle: "We’ll anchor the week around your long run." },
      { key: "start", title: "When should your plan start?", subtitle: "Pick a start date and a plan length that fits your timeline." },
      { key: "prefs", title: "Training preferences", subtitle: "This is where it becomes your plan — not a generic plan." },
      { key: "summary", title: "Review & build your plan", subtitle: "Check everything looks right, then we’ll generate your plan." },
    ],
    []
  );

  const initialStep = useMemo(() => {
    const raw = params?.step;
    if (!raw) return 0;
    const v = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < STEPS.length ? n : 0;
  }, [params?.step, STEPS.length]);

  const [step, setStep] = useState(initialStep);

  // Step 0: goal for the event
  const [raceGoal, setRaceGoal] = useState("strong_finish"); // pb | strong_finish | first_time | enjoy

  // Step 1: event
  const [eventName, setEventName] = useState("");
  const [distance, setDistance] = useState("10K");
  const [customDistance, setCustomDistance] = useState("");
  const [raceDate, setRaceDate] = useState(null);
  const [showRaceDatePicker, setShowRaceDatePicker] = useState(false);

  // Step 2: ability
  const [ability, setAbility] = useState("intermediate"); // beginner | intermediate | advanced | performance

  // Step 3: PB (optional)
  const [pbDistance, setPbDistance] = useState("10K");
  const [pbCustomDistance, setPbCustomDistance] = useState("");
  const [pbTimeText, setPbTimeText] = useState(""); // "mm:ss" or "hh:mm:ss"
  const [pbRecency, setPbRecency] = useState("recent"); // recent | this_year | older
  const [pbSource, setPbSource] = useState("race"); // race | parkrun | training | treadmill

  // Step 4: dob
  const [dob, setDob] = useState(null);
  const [showDobPicker, setShowDobPicker] = useState(false);

  // Step 5: gender
  const [gender, setGender] = useState(null);

  // Step 6: frequency
  const [runsPerWeek, setRunsPerWeek] = useState(4);

  // Step 7: days free
  const [availableDays, setAvailableDays] = useState(["Tue", "Thu", "Sat", "Sun"]);

  // Step 8: long run day
  const [longRunDay, setLongRunDay] = useState("Sun");

  // Step 9: start date + plan length
  const [startDate, setStartDate] = useState(startOfDay(new Date()));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [planLengthWeeks, setPlanLengthWeeks] = useState(null); // 8 | 10 | 12 | null (auto to race)

  // Step 10: prefs
  const [surfaces, setSurfaces] = useState(["Road"]);
  const [volume, setVolume] = useState("progressive"); // steady/progressive/ambitious
  const [intensity, setIntensity] = useState("balanced"); // balanced/performance/low_stress
  const [strength, setStrength] = useState("light"); // none/light/full
  const [constraints, setConstraints] = useState("");
  const [injuries, setInjuries] = useState("");

  // AI generation
  const [loading, setLoading] = useState(false);
  const [generatedMeta, setGeneratedMeta] = useState(null); // used to show welcome/guide
  const [welcomeReady, setWelcomeReady] = useState(false);

  const normalisedDistance = useMemo(() => {
    if (distance === "Other" && customDistance.trim()) return customDistance.trim();
    return distance;
  }, [distance, customDistance]);

  const normalisedPbDistance = useMemo(() => {
    if (pbDistance === "Other" && pbCustomDistance.trim()) return pbCustomDistance.trim();
    return pbDistance;
  }, [pbDistance, pbCustomDistance]);

  const pbSeconds = useMemo(() => parseTimeToSeconds(pbTimeText), [pbTimeText]);
  const hasPb = useMemo(() => Boolean(pbSeconds && normalisedPbDistance), [pbSeconds, normalisedPbDistance]);

  const progress = useMemo(() => clamp((step + 1) / STEPS.length, 0.06, 1), [step, STEPS.length]);

  // Auto suggest plan length based on time to race
  const suggestedWeeks = useMemo(() => {
    if (!raceDate) return null;
    const days = daysBetween(new Date(), raceDate);
    const w = Math.floor(days / 7);
    if (w >= 12) return 12;
    if (w >= 10) return 10;
    if (w >= 8) return 8;
    return Math.max(4, w);
  }, [raceDate]);

  useEffect(() => {
    if (!planLengthWeeks && suggestedWeeks && suggestedWeeks >= 8) {
      setPlanLengthWeeks(suggestedWeeks === 10 ? 10 : suggestedWeeks >= 12 ? 12 : 8);
    }
  }, [suggestedWeeks, planLengthWeeks]);

  // Keep long run day valid if availableDays changes
  useEffect(() => {
    if (!availableDays.includes(longRunDay)) {
      if (availableDays.includes("Sun")) setLongRunDay("Sun");
      else if (availableDays.includes("Sat")) setLongRunDay("Sat");
      else if (availableDays.length) setLongRunDay(availableDays[availableDays.length - 1]);
      else setLongRunDay(null);
    }
  }, [availableDays, longRunDay]);

  const toggleDay = (d) => {
    setAvailableDays((prev) => {
      const has = prev.includes(d);
      if (has) return prev.filter((x) => x !== d);
      return [...prev, d];
    });
  };

  const toggleArrayValue = (arr, value, setFn) => {
    if (arr.includes(value)) setFn(arr.filter((v) => v !== value));
    else setFn([...arr, value]);
  };

  const handleClose = () => {
    Alert.alert("Leave setup?", "You can finish this later from Train setup.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const handleBack = () => {
    if (welcomeReady) {
      setWelcomeReady(false);
      return;
    }
    if (step === 0) return router.back();
    setStep((s) => Math.max(0, s - 1));
  };

  const isStepValid = (s) => {
    switch (s) {
      case 0:
        return !!raceGoal;
      case 1:
        return Boolean(eventName.trim() && raceDate && normalisedDistance);
      case 2:
        return !!ability;
      case 3: {
        // PB is optional. If they typed something, it must be valid.
        const typed = Boolean(String(pbTimeText || "").trim());
        if (!typed) return true;
        return Boolean(pbSeconds);
      }
      case 4:
        return true; // dob optional
      case 5:
        return true; // gender optional
      case 6:
        return !!runsPerWeek;
      case 7:
        return availableDays.length >= runsPerWeek;
      case 8:
        return !!longRunDay;
      case 9:
        return !!startDate;
      case 10:
        return true;
      case 11:
        return true;
      default:
        return true;
    }
  };

  const canContinue = useMemo(() => isStepValid(step), [
    step,
    raceGoal,
    eventName,
    raceDate,
    normalisedDistance,
    ability,
    pbTimeText,
    pbSeconds,
    runsPerWeek,
    availableDays,
    longRunDay,
    startDate,
  ]);

  const footerHint = useMemo(() => {
    if (loading) return "Building your plan…";
    if (welcomeReady) return "";
    if (step === 1 && !eventName.trim()) return "Add your event name to continue.";
    if (step === 1 && !raceDate) return "Select the event date to continue.";
    if (step === 3 && String(pbTimeText || "").trim() && !pbSeconds) return "Enter a valid time (mm:ss or hh:mm:ss).";
    if (step === 7 && availableDays.length < runsPerWeek) {
      const need = runsPerWeek - availableDays.length;
      return `Select at least ${need} more day${need === 1 ? "" : "s"} to continue.`;
    }
    return "";
  }, [loading, welcomeReady, step, eventName, raceDate, availableDays.length, runsPerWeek, pbTimeText, pbSeconds]);

  const handleNext = () => {
    if (!isStepValid(step)) {
      Alert.alert("Almost there", "Please complete this step before continuing.");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  // Optional: accept race from /find-race
  useEffect(() => {
    const nameRaw = params?.selectedRaceName;
    const dateRaw = params?.selectedRaceDate;
    const distRaw = params?.selectedRaceDistance;

    const name = Array.isArray(nameRaw) ? nameRaw[0] : nameRaw;
    const dateStr = Array.isArray(dateRaw) ? dateRaw[0] : dateRaw;
    const dist = Array.isArray(distRaw) ? distRaw[0] : distRaw;

    if (!name && !dateStr && !dist) return;

    if (name && typeof name === "string") setEventName(name);

    if (dateStr && typeof dateStr === "string") {
      const parts = dateStr.split("-");
      if (parts.length >= 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (!isNaN(d.getTime())) setRaceDate(d);
      }
    }

    if (dist && typeof dist === "string") {
      if (DISTANCE_OPTIONS.includes(dist)) {
        setDistance(dist);
        setCustomDistance("");
      } else {
        setDistance("Other");
        setCustomDistance(dist);
      }
    }
  }, [params?.selectedRaceName, params?.selectedRaceDate, params?.selectedRaceDistance]);

  const confirmReplaceActivePlan = async (uid) => {
    try {
      const plansRef = collection(db, "users", uid, "plans");
      const snap = await getDocs(query(plansRef, orderBy("updatedAt", "desc"), limit(1)));
      if (snap.empty) return true;

      return await new Promise((resolve) => {
        Alert.alert(
          "Replace current plan?",
          "You already have a training plan. Creating a new one will replace what you see as ‘current’. Continue?",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Replace", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      });
    } catch {
      return true;
    }
  };

  const canGenerate = useMemo(() => {
    return Boolean(eventName.trim() && raceDate && normalisedDistance && runsPerWeek && availableDays.length >= runsPerWeek);
  }, [eventName, raceDate, normalisedDistance, runsPerWeek, availableDays.length]);

  const handleGenerate = async () => {
    if (!canGenerate) {
      Alert.alert("More info needed", "Please complete the event and weekly schedule.");
      return;
    }

    const user = auth.currentUser;
    const uid = user?.uid;
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    if (!API_URL) {
      Alert.alert("Missing API URL", "EXPO_PUBLIC_API_URL isn’t set, so plan generation can’t run.");
      return;
    }

    const okToReplace = await confirmReplaceActivePlan(uid);
    if (!okToReplace) return;

    setLoading(true);

    try {
      const goalDistance = normalisedDistance;
      const goalType = deriveGoalTypeFromDistance(goalDistance);

      const targetEventDate = formatDateYYYYMMDD(raceDate);

      const planStartISO = startDate ? startOfDay(startDate).toISOString() : null;

      const weeksAvailable = raceDate && startDate ? Math.max(4, Math.floor(daysBetween(startDate, raceDate) / 7)) : null;
      const finalWeeks =
        planLengthWeeks && Number.isFinite(planLengthWeeks)
          ? planLengthWeeks
          : weeksAvailable
          ? clamp(weeksAvailable, 4, 24)
          : undefined;

      const pbPayload = hasPb
        ? {
            distance: normalisedPbDistance,
            timeSeconds: pbSeconds,
            timeLabel: formatSecondsToTime(pbSeconds),
            recency: pbRecency,
            source: pbSource,
            updatedAt: serverTimestamp(),
          }
        : {
            distance: null,
            timeSeconds: null,
            timeLabel: null,
            recency: null,
            source: null,
            updatedAt: serverTimestamp(),
          };

      // Save prefs first
      const prefsPayload = {
        goalPath: "raceDate",
        raceGoal,
        eventName: eventName || "",
        goalDistance,
        raceDateISO: raceDate ? startOfDay(raceDate).toISOString() : null,
        ability,

        // PB
        pb: pbPayload,

        dobISO: dob ? startOfDay(dob).toISOString() : null,
        gender: gender || null,

        runsPerWeek,
        availableDays,
        longRunDay,

        startDateISO: planStartISO,
        planLengthWeeks: finalWeeks || null,

        training: {
          surfaces,
          volume,
          intensity,
          strength,
          injuries: injuries || "",
          constraints: constraints || "",
        },

        updatedAt: serverTimestamp(),
        platform: Platform.OS,
      };

      await setDoc(doc(db, "users", uid, "planPrefs", "current"), prefsPayload, { merge: true });

      const pbNote = hasPb
        ? `PB: ${normalisedPbDistance} ${formatSecondsToTime(pbSeconds)} (${prettyPbRecency(pbRecency)}, ${prettyPbSource(pbSource)})`
        : `PB: not provided`;

      const extraNotes = [
        `Onboarding path: Race Date`,
        `Race goal: ${raceGoal}`,
        `Event: ${eventName} (${goalDistance}) on ${targetEventDate}`,
        `Ability: ${ability}`,
        pbNote,
        dob ? `DOB provided (age-aware guidance)` : `DOB not provided`,
        gender ? `Gender: ${gender}` : `Gender: not provided`,
        `Runs/week: ${runsPerWeek}`,
        `Available days: ${availableDays.join(", ")}`,
        `Long run day: ${longRunDay}`,
        `Start: ${planStartISO ? fmtShort(startOfDay(new Date(planStartISO))) : "—"}`,
        finalWeeks ? `Plan length: ${finalWeeks} weeks` : `Plan length: auto`,
        `Surfaces: ${surfaces.join(", ")}`,
        `Volume: ${volume}`,
        `Intensity: ${intensity}`,
        `Strength: ${strength}`,
        injuries ? `Injuries: ${injuries}` : null,
        constraints ? `Constraints: ${constraints}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      // If the PB distance is 10K, we can pass it directly to a "current10kTime" field
      // (kept backwards-compatible with your existing AI schema).
      const current10kTime =
        hasPb && String(normalisedPbDistance).toLowerCase().includes("10k")
          ? formatSecondsToTime(pbSeconds)
          : "";

      const aiPlan = await createAiPlan({
        userId: uid,
        goalType,
        targetEventDate,
        targetTime: "", // optional: add later if you want a time goal field
        current10kTime, // now populated when they provide a 10K PB
        sessionsPerWeek: Number(runsPerWeek),
        weeks: finalWeeks || undefined,
        goal: `${goalDistance} – ${eventName}`,
        primaryActivity: "Run",
        extraNotes,
        athleteProfile: {
          goal: {
            path: "raceDate",
            raceGoal,
            distance: goalDistance,
            eventName,
            eventDate: targetEventDate,
            planLengthWeeks: finalWeeks || null,
          },
          schedule: { runsPerWeek, availableDays, longRunDay },
          athlete: { ability, dobISO: dob ? startOfDay(dob).toISOString() : null, gender: gender || null },
          pb: hasPb
            ? {
                distance: normalisedPbDistance,
                timeSeconds: pbSeconds,
                timeLabel: formatSecondsToTime(pbSeconds),
                recency: pbRecency,
                source: pbSource,
              }
            : null,
          preferences: { surfaces, volume, intensity, strength, injuries: injuries || "", constraints: constraints || "" },
        },
      });

      const appPlan = convertAiPlanToApp(aiPlan) || {};

      const meta = {
        name: appPlan.name || `${eventName} – ${goalDistance}`,
        primaryActivity: "Run",
        goalPath: "raceDate",
        goalDistance,
        targetEventName: eventName,
        targetEventDate,
        source: "ai-run",
        aiContext: extraNotes,
      };

      const config = {
        goalPath: "raceDate",
        goalType,
        goalDistance,
        eventName,
        targetEventDate,
        weeksCount: finalWeeks || undefined,
        sessionsPerWeek: Number(runsPerWeek),
        availableDays,
        longRunDay,
        startDateISO: planStartISO,
        raceGoal,
        ability,
        pb: hasPb
          ? {
              distance: normalisedPbDistance,
              timeSeconds: pbSeconds,
              timeLabel: formatSecondsToTime(pbSeconds),
              recency: pbRecency,
              source: pbSource,
            }
          : null,
        surfaces,
        volume,
        intensity,
        strength,
        injuries,
        constraints,
      };

      const planDoc = createPlanDocument({ appPlan, aiPlan, meta, config });
      const cleanedPlanDoc = normalisePlanForSave(planDoc);

      const docRef = await addDoc(collection(db, "users", uid, "plans"), cleanedPlanDoc);

      setGeneratedMeta({
        planId: docRef.id,
        planName: meta.name,
        eventName,
        date: targetEventDate,
        distance: goalDistance,
        runsPerWeek,
        longRunDay,
        weeks: finalWeeks || null,
      });

      setWelcomeReady(true);
    } catch (e) {
      console.log("[race-date-onboarding] error:", e);
      Alert.alert("Couldn’t build your plan", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- step renderers ---------------- */
  const StepGoal = () => (
    <>
      <SectionTitle
        title="What’s the goal for this race?"
        subtitle="Pick what matters most. We’ll shape your weekly rhythm around it."
      />

      {RACE_GOALS.map((g) => (
        <OptionRow
          key={g.key}
          title={g.title}
          desc={g.desc}
          selected={raceGoal === g.key}
          onPress={() => setRaceGoal(g.key)}
          leftIcon={<Feather name="target" size={18} color={PRIMARY} />}
        />
      ))}

      <Card style={{ marginTop: 12, backgroundColor: CARD_2 }}>
        <Text style={styles.cardTitle}>Train-R note</Text>
        <Text style={styles.cardDesc}>
          You’re not locked into this. You can adjust the goal later and we’ll re-balance the plan.
        </Text>
      </Card>
    </>
  );

  const StepEvent = () => (
    <>
      <SectionTitle
        title="Tell us about the event"
        subtitle="Once we know the event and the date, we can build a proper runway."
      />

      <Card>
        <Text style={styles.smallLabel}>Event name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Brighton 10K"
          placeholderTextColor={MUTED_2}
          value={eventName}
          onChangeText={setEventName}
        />

        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: "/(protected)/train/find-race",
              params: {
                step: String(step),
                goalDistance: normalisedDistance || "",
                targetDate: raceDate ? formatDateYYYYMMDD(raceDate) : "",
                returnTo: "/(protected)/train/onboarding/race-date",
              },
            })
          }
          activeOpacity={0.9}
          style={[styles.rowBtn, { marginTop: 12 }]}
        >
          <Feather name="search" size={16} color={PRIMARY} />
          <Text style={styles.rowBtnText}>Find a race</Text>
        </TouchableOpacity>

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>Distance *</Text>
        <View style={styles.chipRow}>
          {DISTANCE_OPTIONS.map((opt) => (
            <Chip key={opt} label={opt} active={distance === opt} onPress={() => setDistance(opt)} />
          ))}
        </View>

        {distance === "Other" ? (
          <TextInput
            style={styles.input}
            placeholder="e.g. 15K, 10-mile, trail half…"
            placeholderTextColor={MUTED_2}
            value={customDistance}
            onChangeText={setCustomDistance}
          />
        ) : null}

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>Event date *</Text>
        <TouchableOpacity
          onPress={() => setShowRaceDatePicker(true)}
          activeOpacity={0.9}
          style={[styles.rowBtn, { marginTop: 10 }]}
        >
          <Feather name="calendar" size={16} color={PRIMARY} />
          <Text style={styles.rowBtnText}>{raceDate ? fmtShort(startOfDay(raceDate)) : "Select date"}</Text>
        </TouchableOpacity>

        {!API_URL ? (
          <Text style={[styles.hint, { marginTop: 10, color: DANGER }]}>AI generation needs EXPO_PUBLIC_API_URL.</Text>
        ) : null}
      </Card>

      {raceDate ? (
        <Card style={{ marginTop: 12, backgroundColor: CARD_2 }}>
          <Text style={styles.cardTitle}>Timeline check</Text>
          <Text style={styles.cardDesc}>
            Your race is in roughly{" "}
            <Text style={{ color: "white", fontWeight: "900" }}>{Math.max(0, Math.floor(daysBetween(new Date(), raceDate) / 7))}</Text>{" "}
            weeks. We’ll recommend a plan length on the next steps.
          </Text>
        </Card>
      ) : null}
    </>
  );

  const StepAbility = () => (
    <>
      <SectionTitle
        title="How would you rate your running right now?"
        subtitle="We’ll use this to set intensity and how quickly we progress."
        right={
          <View style={styles.helpBubble}>
            <Feather name="help-circle" size={18} color="white" />
          </View>
        }
      />

      {ABILITY_LEVELS.map((lvl) => (
        <OptionRow
          key={lvl.key}
          title={lvl.title}
          desc={lvl.desc}
          selected={ability === lvl.key}
          onPress={() => setAbility(lvl.key)}
          leftIcon={<Feather name="activity" size={18} color={PRIMARY} />}
        />
      ))}
    </>
  );

  const StepPB = () => {
    const typed = Boolean(String(pbTimeText || "").trim());
    const valid = Boolean(pbSeconds);

    return (
      <>
        <SectionTitle
          title="Do you have a current best time?"
          subtitle="Optional, but it helps us set paces properly. Enter a recent best effort or PB."
        />

        <Card>
          <Text style={styles.smallLabel}>PB distance</Text>
          <View style={styles.chipRow}>
            {PB_DISTANCE_OPTIONS.map((opt) => (
              <Chip key={opt} label={opt} active={pbDistance === opt} onPress={() => setPbDistance(opt)} />
            ))}
          </View>

          {pbDistance === "Other" ? (
            <TextInput
              style={styles.input}
              placeholder="e.g. 15K, 10-mile…"
              placeholderTextColor={MUTED_2}
              value={pbCustomDistance}
              onChangeText={setPbCustomDistance}
            />
          ) : null}

          <View style={{ height: 14 }} />

          <Text style={styles.smallLabel}>Best time</Text>
          <TextInput
            style={styles.input}
            placeholder="mm:ss or hh:mm:ss  (e.g. 22:45 or 1:38:20)"
            placeholderTextColor={MUTED_2}
            value={pbTimeText}
            onChangeText={(t) => setPbTimeText(normaliseTimeInput(t))}
            keyboardType="numbers-and-punctuation"
          />

          {typed && !valid ? <Text style={[styles.hint, { color: DANGER }]}>That time format doesn’t look right.</Text> : null}

          {valid ? (
            <Text style={[styles.hint, { marginTop: 10 }]}>
              Saved as{" "}
              <Text style={{ color: "white", fontWeight: "900" }}>{formatSecondsToTime(pbSeconds)}</Text>
              {"  "}for{" "}
              <Text style={{ color: "white", fontWeight: "900" }}>{normalisedPbDistance}</Text>.
            </Text>
          ) : (
            <Text style={[styles.hint, { marginTop: 10 }]}>If you’re not sure, just skip — we can still build a great plan.</Text>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <Text style={styles.smallLabel}>How recent was it?</Text>
          {PB_RECENCY_OPTIONS.map((r) => (
            <OptionRow
              key={r.key}
              title={r.title}
              desc={r.desc}
              selected={pbRecency === r.key}
              onPress={() => setPbRecency(r.key)}
              leftIcon={<Feather name="clock" size={18} color={PRIMARY} />}
            />
          ))}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <Text style={styles.smallLabel}>Where did it come from?</Text>
          {PB_SOURCE_OPTIONS.map((s) => (
            <OptionRow
              key={s.key}
              title={s.title}
              desc={s.desc}
              selected={pbSource === s.key}
              onPress={() => setPbSource(s.key)}
              leftIcon={<Feather name="map-pin" size={18} color={PRIMARY} />}
            />
          ))}
        </Card>

        <Card style={{ marginTop: 12, backgroundColor: CARD_2 }}>
          <Text style={styles.cardTitle}>Train-R note</Text>
          <Text style={styles.cardDesc}>
            This is just for calibration. If it’s old, we’ll treat it as a rough anchor and keep things sensible.
          </Text>
        </Card>
      </>
    );
  };

  const StepDob = () => (
    <>
      <SectionTitle title="When is your birthday?" subtitle="Recommended. This helps us personalise intensity and reduce injury risk." />

      <Card>
        <TouchableOpacity onPress={() => setShowDobPicker(true)} activeOpacity={0.9} style={styles.rowBtn}>
          <Feather name="calendar" size={16} color={PRIMARY} />
          <Text style={styles.rowBtnText}>{dob ? fmtShort(startOfDay(dob)) : "Select your date of birth"}</Text>
        </TouchableOpacity>

        <Text style={[styles.hint, { marginTop: 10 }]}>
          We use this to keep training age-appropriate. You can skip if you’d rather.
        </Text>
      </Card>
    </>
  );

  const StepGender = () => (
    <>
      <SectionTitle title="What’s your gender?" subtitle="Optional. Helps tailor guidance and language. Not shown publicly." />

      {GENDER_OPTIONS.map((g) => (
        <OptionRow
          key={g.key}
          title={g.label}
          selected={gender === g.key}
          onPress={() => setGender(g.key)}
          leftIcon={<Feather name="user" size={18} color={PRIMARY} />}
        />
      ))}
    </>
  );

  const StepFrequency = () => (
    <>
      <SectionTitle
        title="How many days per week would you like to run?"
        subtitle="Pick something you can sustain. If you’re unsure, 3–4 is a great start."
      />

      {DAYS_PER_WEEK_OPTIONS.map((n) => (
        <OptionRow
          key={n}
          title={`${n} days per week`}
          desc={
            n <= 3
              ? "Build consistency without feeling rushed."
              : n === 4
              ? "Great balance of progress + recovery."
              : n === 5
              ? "Stronger routine with more quality."
              : n === 6
              ? "High frequency — easy days must stay easy."
              : "Daily running — only if you’re already robust."
          }
          selected={runsPerWeek === n}
          onPress={() => {
            setRunsPerWeek(n);
            setAvailableDays((prev) => (prev.length > n ? prev.slice(0, n) : prev));
          }}
          leftIcon={<Feather name="calendar" size={18} color={PRIMARY} />}
        />
      ))}
    </>
  );

  const StepDaysFree = () => (
    <>
      <SectionTitle title="Which days are you free to run?" subtitle="Select all the days you could run. We’ll choose the best pattern." />

      <Text style={[styles.hint, { marginTop: 2 }]}>
        You need at least <Text style={{ color: "white", fontWeight: "900" }}>{runsPerWeek}</Text> day
        {runsPerWeek === 1 ? "" : "s"} selected.
      </Text>

      {DAYS.map((d) => {
        const selected = availableDays.includes(d);
        return (
          <OptionRow
            key={d}
            title={DAY_LABELS[d]}
            desc={selected ? "Selected" : ""}
            selected={selected}
            onPress={() => toggleDay(d)}
            leftIcon={<Feather name="check-circle" size={18} color={PRIMARY} />}
            rightNode={<SelectCircle selected={selected} />}
          />
        );
      })}
    </>
  );

  const StepLongRun = () => (
    <>
      <SectionTitle title="Which day suits your long run?" subtitle="Your long run anchors the plan. Pick the day that best fits your life." />

      {availableDays.length === 0 ? (
        <Text style={styles.hint}>Select your available days first.</Text>
      ) : (
        availableDays
          .slice()
          .sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b))
          .map((d) => (
            <OptionRow
              key={d}
              title={DAY_LABELS[d]}
              desc="Long run anchor"
              selected={longRunDay === d}
              onPress={() => setLongRunDay(d)}
              leftIcon={<Feather name="trending-up" size={18} color={PRIMARY} />}
            />
          ))
      )}
    </>
  );

  const StepStart = () => {
    const weeksAvail = raceDate ? Math.max(4, Math.floor(daysBetween(startDate, raceDate) / 7)) : null;

    return (
      <>
        <SectionTitle title="When should your plan start?" subtitle="Choose a start date, then decide how long you want the plan to run for." />

        <Card>
          <Text style={styles.smallLabel}>Start date *</Text>

          <TouchableOpacity
            onPress={() => setShowStartPicker(true)}
            activeOpacity={0.9}
            style={[styles.rowBtn, { marginTop: 10 }]}
          >
            <Feather name="play" size={16} color={PRIMARY} />
            <Text style={styles.rowBtnText}>{startDate ? fmtShort(startOfDay(startDate)) : "Select start date"}</Text>
          </TouchableOpacity>

          <View style={{ height: 14 }} />

          <Text style={styles.smallLabel}>Plan length</Text>
          <Text style={styles.microHint}>If you’re not sure, pick the suggested length. We’ll fit the build to your race date.</Text>

          <View style={styles.chipRow}>
            <Chip label="Auto" active={!planLengthWeeks} onPress={() => setPlanLengthWeeks(null)} />
            <Chip label="8 weeks" active={planLengthWeeks === 8} onPress={() => setPlanLengthWeeks(8)} />
            <Chip label="10 weeks" active={planLengthWeeks === 10} onPress={() => setPlanLengthWeeks(10)} />
            <Chip label="12 weeks" active={planLengthWeeks === 12} onPress={() => setPlanLengthWeeks(12)} />
          </View>

          {raceDate ? (
            <Text style={[styles.hint, { marginTop: 10 }]}>
              Timeline: about{" "}
              <Text style={{ color: "white", fontWeight: "900" }}>{Math.max(0, Math.floor(daysBetween(new Date(), raceDate) / 7))}</Text>{" "}
              weeks until race.
              {"\n"}
              From your start date: <Text style={{ color: "white", fontWeight: "900" }}>{weeksAvail ?? "—"}</Text> weeks available.
              {suggestedWeeks ? (
                <>
                  {"\n"}Suggested:{" "}
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {suggestedWeeks >= 8 ? `${suggestedWeeks} weeks` : `${suggestedWeeks} weeks (race is close)`}
                  </Text>
                </>
              ) : null}
            </Text>
          ) : null}
        </Card>
      </>
    );
  };

  const StepPrefs = () => (
    <>
      <SectionTitle title="Training preferences" subtitle="Fine-tune how your plan feels — volume, intensity, surfaces and strength." />

      <Card>
        <Text style={styles.smallLabel}>Surfaces</Text>
        <View style={styles.chipRow}>
          {SURFACE_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={surfaces.includes(opt)}
              onPress={() => toggleArrayValue(surfaces, opt, setSurfaces)}
            />
          ))}
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Volume build</Text>
        {VOLUME_OPTIONS.map((v) => (
          <OptionRow
            key={v.key}
            title={v.title}
            desc={v.desc}
            selected={volume === v.key}
            onPress={() => setVolume(v.key)}
            leftIcon={<Feather name="bar-chart-2" size={18} color={PRIMARY} />}
          />
        ))}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Intensity style</Text>
        {INTENSITY_OPTIONS.map((i) => (
          <OptionRow
            key={i.key}
            title={i.title}
            desc={i.desc}
            selected={intensity === i.key}
            onPress={() => setIntensity(i.key)}
            leftIcon={<Feather name="zap" size={18} color={PRIMARY} />}
          />
        ))}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Strength alongside running</Text>
        {STRENGTH_OPTIONS.map((s) => (
          <OptionRow
            key={s.key}
            title={s.title}
            desc={s.desc}
            selected={strength === s.key}
            onPress={() => setStrength(s.key)}
            leftIcon={<Feather name="shield" size={18} color={PRIMARY} />}
          />
        ))}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Injuries / niggles (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. Achilles tightness, knee pain, calf strain…"
          placeholderTextColor={MUTED_2}
          value={injuries}
          onChangeText={setInjuries}
          multiline
        />

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Constraints (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. avoid intervals on Tuesdays, no treadmill, prefer mornings…"
          placeholderTextColor={MUTED_2}
          value={constraints}
          onChangeText={setConstraints}
          multiline
        />
      </Card>
    </>
  );

  const StepSummary = () => {
    const targetEventDate = raceDate ? formatDateYYYYMMDD(raceDate) : "—";
    const weeksAvailable = raceDate && startDate ? Math.max(4, Math.floor(daysBetween(startDate, raceDate) / 7)) : null;
    const finalWeeks = planLengthWeeks ? planLengthWeeks : weeksAvailable;

    if (welcomeReady && generatedMeta) {
      return (
        <>
          <SectionTitle title="You’re set." subtitle="Your plan is built. Here’s how to use it and what to expect." />

          <Card style={{ backgroundColor: CARD_2 }}>
            <Text style={styles.cardTitle}>{generatedMeta.planName}</Text>
            <Text style={styles.cardDesc}>
              {generatedMeta.distance} · {generatedMeta.eventName} · {generatedMeta.date}
            </Text>

            <View style={{ height: 12 }} />

            <SummaryLine icon="calendar" label="Runs / week" value={`${generatedMeta.runsPerWeek}`} />
            <SummaryLine icon="trending-up" label="Long run day" value={DAY_LABELS[generatedMeta.longRunDay] || generatedMeta.longRunDay} />
            <SummaryLine icon="clock" label="Plan length" value={generatedMeta.weeks ? `${generatedMeta.weeks} weeks` : "Auto"} />
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={styles.cardTitle}>How to win the plan</Text>
            <Text style={styles.cardDesc}>
              • Keep easy runs genuinely easy — that’s how you absorb the work.
              {"\n"}• If you miss a session, don’t “make up” everything. Just get back on track.
              {"\n"}• Long run day is the anchor. Protect it.
              {"\n"}• If anything hurts (sharp pain), reduce load and swap intensity for easy running.
            </Text>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Text style={styles.cardTitle}>Next</Text>
            <Text style={styles.cardDesc}>Head to Train to see your week-by-week plan and start your first session.</Text>
          </Card>
        </>
      );
    }

    return (
      <>
        <SectionTitle title="Review & build your plan" subtitle="Quick check. If it looks right, we’ll generate it and save it." />

        <Card style={{ backgroundColor: CARD_2 }}>
          <SummaryLine icon="target" label="Race goal" value={prettyRaceGoal(raceGoal)} />
          <SummaryLine icon="flag" label="Event" value={eventName || "—"} />
          <SummaryLine icon="map" label="Distance" value={normalisedDistance || "—"} />
          <SummaryLine icon="calendar" label="Date" value={raceDate ? fmtShort(startOfDay(raceDate)) : "—"} />
          <SummaryLine icon="activity" label="Ability" value={prettyAbility(ability)} />

          <SummaryLine
            icon="award"
            label="Current best"
            value={
              hasPb
                ? `${normalisedPbDistance} ${formatSecondsToTime(pbSeconds)} · ${prettyPbRecency(pbRecency)}`
                : "Not provided"
            }
          />

          <SummaryLine icon="calendar" label="Runs / week" value={`${runsPerWeek}`} />
          <SummaryLine icon="check-circle" label="Free days" value={availableDays.length ? availableDays.join(", ") : "—"} />
          <SummaryLine icon="trending-up" label="Long run" value={longRunDay ? DAY_LABELS[longRunDay] : "—"} />
          <SummaryLine icon="play" label="Start" value={startDate ? fmtShort(startOfDay(startDate)) : "—"} />
          <SummaryLine icon="clock" label="Plan length" value={finalWeeks ? `${finalWeeks} weeks` : "Auto"} />
          <SummaryLine icon="map-pin" label="Surfaces" value={surfaces.length ? surfaces.join(", ") : "—"} />
          <SummaryLine icon="bar-chart-2" label="Volume" value={prettyVolume(volume)} />
          <SummaryLine icon="zap" label="Intensity" value={prettyIntensity(intensity)} />
          <SummaryLine icon="shield" label="Strength" value={prettyStrength(strength)} />

          {!canGenerate ? (
            <Text style={[styles.hint, { marginTop: 12, color: DANGER }]}>
              Missing required: event name, date, and enough free days for your weekly frequency.
            </Text>
          ) : null}

          {!API_URL ? <Text style={[styles.hint, { marginTop: 10, color: DANGER }]}>AI generation needs EXPO_PUBLIC_API_URL.</Text> : null}

          <Text style={[styles.hint, { marginTop: 12 }]}>We’ll generate a plan that fits your schedule and preferences — and save it to Train.</Text>
        </Card>
      </>
    );
  };

  const renderStep = () => {
    if (step === 11) return <StepSummary />;
    switch (step) {
      case 0:
        return <StepGoal />;
      case 1:
        return <StepEvent />;
      case 2:
        return <StepAbility />;
      case 3:
        return <StepPB />;
      case 4:
        return <StepDob />;
      case 5:
        return <StepGender />;
      case 6:
        return <StepFrequency />;
      case 7:
        return <StepDaysFree />;
      case 8:
        return <StepLongRun />;
      case 9:
        return <StepStart />;
      case 10:
        return <StepPrefs />;
      default:
        return null;
    }
  };

  const footerLabel = useMemo(() => {
    if (loading) return "Building…";
    if (step === 11) return welcomeReady ? "Go to Train" : "Generate plan";
    return "Continue";
  }, [loading, step, welcomeReady]);

  const footerDisabled = useMemo(() => {
    if (loading) return true;
    if (step === 11) return welcomeReady ? false : !canGenerate;
    return !canContinue;
  }, [loading, step, welcomeReady, canGenerate, canContinue]);

  const onFooterPress = () => {
    if (step === 11) {
      if (welcomeReady) {
        router.replace("/(protected)/train");
        return;
      }
      handleGenerate();
      return;
    }
    handleNext();
  };

  const skipableStep = useMemo(() => step === 3 || step === 4 || step === 5, [step]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <TopBar progress={progress} onBack={handleBack} onClose={handleClose} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.stepMeta}>
            <Text style={styles.stepKicker}>RACE DATE SETUP</Text>
            <Text style={styles.stepMini}>{welcomeReady ? "Complete" : `Step ${step + 1} of ${STEPS.length}`} · {STEPS[step]?.key}</Text>
          </View>

          {renderStep()}

          <View style={{ height: 140 }} />
        </ScrollView>

        <StickyFooter
          label={footerLabel}
          disabled={footerDisabled}
          onPress={onFooterPress}
          hint={footerHint}
          secondaryLabel={!welcomeReady && skipableStep ? "Skip for now" : null}
          onSecondary={() => {
            // PB skip
            if (step === 3) {
              setPbTimeText("");
              // keep defaults for distance/recency/source so if they come back it’s ready
            }
            // DOB skip
            if (step === 4) setDob(null);
            // Gender skip
            if (step === 5) setGender(null);
            handleNext();
          }}
        />
      </KeyboardAvoidingView>

      {/* Race date picker */}
      <Modal transparent visible={showRaceDatePicker} animationType="fade" onRequestClose={() => setShowRaceDatePicker(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <DateTimePicker
              mode="date"
              value={raceDate || new Date()}
              display={Platform.OS === "ios" ? "inline" : "calendar"}
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

      {/* DOB picker */}
      <Modal transparent visible={showDobPicker} animationType="fade" onRequestClose={() => setShowDobPicker(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <DateTimePicker
              mode="date"
              value={dob || new Date(1998, 0, 1)}
              display={Platform.OS === "ios" ? "spinner" : "calendar"}
              onChange={(event, selectedDate) => {
                if (event.type === "dismissed") return setShowDobPicker(false);
                if (selectedDate) setDob(selectedDate);
                setShowDobPicker(false);
              }}
              style={{ alignSelf: "stretch" }}
            />
          </View>
        </View>
      </Modal>

      {/* Start date picker */}
      <Modal transparent visible={showStartPicker} animationType="fade" onRequestClose={() => setShowStartPicker(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <DateTimePicker
              mode="date"
              value={startDate || new Date()}
              display={Platform.OS === "ios" ? "inline" : "calendar"}
              onChange={(event, selectedDate) => {
                if (event.type === "dismissed") return setShowStartPicker(false);
                if (selectedDate) setStartDate(selectedDate);
                setShowStartPicker(false);
              }}
              style={{ alignSelf: "stretch" }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------------- copy helpers ---------------- */
function prettyRaceGoal(k) {
  switch (k) {
    case "pb":
      return "Chase a PB";
    case "strong_finish":
      return "Finish strong";
    case "first_time":
      return "First time at distance";
    case "enjoy":
      return "Enjoy the build";
    default:
      return k;
  }
}
function prettyAbility(a) {
  switch (a) {
    case "beginner":
      return "Beginner";
    case "intermediate":
      return "Intermediate";
    case "advanced":
      return "Advanced";
    case "performance":
      return "Performance";
    default:
      return a;
  }
}
function prettyVolume(v) {
  switch (v) {
    case "steady":
      return "Steady";
    case "progressive":
      return "Progressive";
    case "ambitious":
      return "Ambitious";
    default:
      return v;
  }
}
function prettyIntensity(i) {
  switch (i) {
    case "balanced":
      return "Balanced";
    case "performance":
      return "Performance";
    case "low_stress":
      return "Low stress";
    default:
      return i;
  }
}
function prettyStrength(s) {
  switch (s) {
    case "none":
      return "None";
    case "light":
      return "Light";
    case "full":
      return "Full";
    default:
      return s;
  }
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },

  topBar: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: "rgba(230,255,59,0.85)",
  },

  stepMeta: { marginTop: 6, marginBottom: 6 },
  stepKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  stepMini: { marginTop: 4, color: MUTED_2, fontSize: 12, fontWeight: "700" },

  h1: {
    color: "white",
    fontSize: 32,
    letterSpacing: -0.3,
    fontWeight: "900",
    flex: 1,
  },
  sub: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },

  helpBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },

  cardTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.1,
  },
  cardDesc: {
    marginTop: 6,
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
  },

  optionCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },
  optionCardSelected: {
    borderColor: "rgba(230,255,59,0.75)",
    shadowColor: PRIMARY,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  leftIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(230,255,59,0.06)",
    borderWidth: 1,
    borderColor: "rgba(230,255,59,0.12)",
  },
  optionTitle: { color: "white", fontSize: 16, fontWeight: "900", letterSpacing: -0.1 },
  optionDesc: { marginTop: 4, color: MUTED_2, fontSize: 13, lineHeight: 18 },

  selectCircle: {
    width: 28,
    height: 28,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  selectCircleOn: {
    borderColor: "rgba(230,255,59,0.85)",
    backgroundColor: "rgba(230,255,59,0.85)",
  },

  smallLabel: {
    color: MUTED_2,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  microHint: {
    marginTop: 6,
    color: MUTED_2,
    fontSize: 12,
    lineHeight: 16,
  },

  chipRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  pillSelected: {
    backgroundColor: "rgba(230,255,59,0.90)",
    borderColor: "rgba(230,255,59,0.90)",
  },
  pillText: { color: "white", fontSize: 13, fontWeight: "900" },
  pillTextSelected: { color: INK },

  input: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  textArea: { minHeight: 70, textAlignVertical: "top" },

  rowBtn: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rowBtnText: { color: "white", fontSize: 13, fontWeight: "900" },

  hint: { color: MUTED_2, fontSize: 13, lineHeight: 18, marginTop: 8 },

  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
  },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryLabel: { color: MUTED, fontSize: 13, fontWeight: "800" },
  summaryValue: { color: "white", fontSize: 13, fontWeight: "900", maxWidth: "55%" },

  footerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 10,
    backgroundColor: "rgba(5,5,6,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  footerHint: { color: MUTED_2, fontSize: 12, fontWeight: "800", marginBottom: 10 },

  primaryBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  primaryBtnDisabled: { backgroundColor: "rgba(255,255,255,0.55)" },
  primaryBtnText: { color: INK, fontSize: 16, fontWeight: "900", letterSpacing: -0.1 },

  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  secondaryBtnText: { color: "white", fontSize: 14, fontWeight: "900", opacity: 0.75 },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickerCard: {
    width: "90%",
    maxWidth: 420,
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: CARD,
  },
});
