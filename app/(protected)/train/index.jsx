// app/(protected)/train/index.jsx
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "../../components/LucideFeather";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { MASON_COACH_TEMPLATE_DOCS } from "./data/coachTemplates";

/* ──────────────────────────────────────────────────────────────
   Helpers + constants
────────────────────────────────────────────────────────────── */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const emptyWeek = () => ({ days: DAYS.map((d) => ({ day: d, sessions: [] })) });
const WEEK_CAROUSEL_FALLBACK_WIDTH = 320;

const PRIMARY = "#E6FF3B";
const JS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SAMPLE_WORKOUTS = [
  {
    key: "run_easy_35",
    category: "running",
    type: "Run",
    title: "Easy aerobic run",
    summary: "Steady low-effort run to keep aerobic volume moving without extra fatigue.",
    bestFor: "Best for easy days or post-hard-session recovery volume.",
    durationMin: 35,
    distanceKm: 6.0,
    rpe: 4,
    notes: "Easy conversational pace. Keep effort controlled from start to finish.",
  },
  {
    key: "run_intervals_intro",
    category: "running",
    type: "Run",
    title: "Intervals intro",
    summary: "Short controlled efforts to touch speed without overloading the day.",
    bestFor: "Great when you want quality in a short time window.",
    durationMin: 32,
    distanceKm: 5.0,
    rpe: 7,
    notes: "10 min easy, 6 x 1 min hard / 1 min easy, then cool down.",
  },
  {
    key: "bodyweight_20",
    category: "strength",
    type: "Bodyweight",
    title: "Bodyweight circuit",
    summary: "Simple full-body circuit for strength stimulus without gym equipment.",
    bestFor: "Ideal for busy days when you still want purposeful strength work.",
    durationMin: 20,
    distanceKm: null,
    rpe: 6,
    notes: "3 rounds: squats, reverse lunges, push-ups, plank. Move with control.",
  },
  {
    key: "strength_40",
    category: "strength",
    type: "Strength",
    title: "Strength session",
    summary: "Compound-led gym session focused on controlled load and clean reps.",
    bestFor: "Good for maintaining strength while building weekly consistency.",
    durationMin: 40,
    distanceKm: null,
    rpe: 7,
    notes: "Focus on compound lifts and core. Keep 1-2 reps in reserve.",
  },
  {
    key: "hybrid_engine_30",
    category: "hybrid",
    type: "Hybrid",
    title: "Hybrid engine builder",
    summary: "Mixed run and functional work to build pacing and transition control.",
    bestFor: "Great for HYROX-style sessions or mixed fitness days.",
    durationMin: 30,
    distanceKm: 3.5,
    rpe: 6,
    notes: "Mixed run and functional work. Stay controlled and keep transitions smooth.",
  },
  {
    key: "recovery_flow_25",
    category: "recovery",
    type: "Recovery",
    title: "Recovery mobility flow",
    summary: "Light mobility and reset work to improve recovery readiness.",
    bestFor: "Best after heavy days when you need low-stress movement.",
    durationMin: 25,
    distanceKm: null,
    rpe: 2,
    notes: "Mobility, breathing, and light core. Reset for the next hard day.",
  },
];

const NO_PLAN_NOTE =
  "Start with one sample workout or quick log today. Build your full plan once your weekly rhythm is clearer.";
const TIP_CARD_IMAGE_A = require("../../../assets/images/run.jpeg");
const TIP_CARD_IMAGE_B = require("../../../assets/images/home/img_home_hero_today.jpg");

const TRAINING_TIP_TOPICS = [
  {
    key: "gut-training",
    title: "Gut training for long events",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Train your gut like your legs. Progress carbs weekly so race-day fueling feels normal.",
    author: "Coach Team",
    updatedText: "Updated 2 months ago",
    intro:
      "Long events demand both strong legs and a prepared gut. Start small in training and build consistency before you increase race intensity.",
    bullets: [
      "Practice race fuel in long sessions, not just on race day.",
      "Match gel timing to your race plan and stick to it.",
      "If GI issues appear, reduce dose and build back gradually.",
    ],
    sectionTitle: "Common mistakes to avoid",
    sectionBody:
      "Do not test new products on race week. Keep your fueling source, timing, and dose stable in the final build so your race plan is repeatable under stress.",
  },
  {
    key: "heat-acclimation",
    title: "Heat acclimation protocol",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Use controlled heat exposure 7-14 days before a hot race block to improve tolerance.",
    author: "Coach Team",
    updatedText: "Updated 6 weeks ago",
    intro:
      "Heat sessions should be progressive, controlled, and recovery-aware. Start with easier efforts and let your body adapt before pushing session quality.",
    bullets: [
      "Keep intensity modest at first and watch hydration closely.",
      "Use post-session weight checks to estimate fluid loss.",
      "Prioritise sleep and electrolytes during acclimation phases.",
    ],
    sectionTitle: "How to apply this this week",
    sectionBody:
      "Add 2-3 short controlled heat exposures after easy training. Track perceived effort and resting fatigue so you adapt without carrying excess load.",
  },
  {
    key: "hyrox-transitions",
    title: "HYROX transition efficiency",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Free speed comes from efficient transitions and fast breathing recovery between stations.",
    author: "Coach Team",
    updatedText: "Updated 1 month ago",
    intro:
      "Most HYROX time leaks happen between stations, not only in work blocks. Rehearse transitions under fatigue so you keep momentum and protect pacing.",
    bullets: [
      "Rehearse entry and exit for each station under fatigue.",
      "Use a single cue per station to stay consistent.",
      "Treat transitions as race segments, not downtime.",
    ],
    sectionTitle: "Execution cue",
    sectionBody:
      "Use one anchor cue for each station, then move immediately. Remove decision friction and keep each transition mechanically identical.",
  },
  {
    key: "race-morning",
    title: "Race morning pacing strategy",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Race execution is won by disciplined starts and effort control, not early speed.",
    author: "Coach Team",
    updatedText: "Updated 3 weeks ago",
    intro:
      "Your first segment sets the whole race. Start below emotional effort, settle breathing, then progress when your mechanics and heart rate are stable.",
    bullets: [
      "Open below target intensity for the first 10-15 minutes.",
      "Use checkpoints to avoid drifting above planned effort.",
      "Save final push for when form and breathing stay stable.",
    ],
    sectionTitle: "Pre-race checklist",
    sectionBody:
      "Lock pacing bands, warm-up timing, and first-fuel timing before the start line. A simple checklist reduces panic pacing in the opening phase.",
  },
  {
    key: "female-cycle",
    title: "Female cycle and training load",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Cycle-aware planning helps place quality where readiness is strongest and recovery where needed.",
    author: "Coach Team",
    updatedText: "Updated 5 weeks ago",
    intro:
      "Use simple symptom and performance tracking to spot your personal readiness pattern. Over time, this improves consistency across harder training blocks.",
    bullets: [
      "Track symptoms and performance trends across phases.",
      "Shift high-quality sessions to stronger readiness days when possible.",
      "Adjust fueling and recovery support around high-fatigue windows.",
    ],
    sectionTitle: "Practical setup",
    sectionBody:
      "Log sleep quality, soreness, mood, and session RPE in one place. Patterns appear quickly and help coach-level adjustments without guesswork.",
  },
  {
    key: "altitude-travel",
    title: "Altitude and travel prep",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Travel and altitude alter effort response, so simplify early sessions and stabilise routines.",
    author: "Coach Team",
    updatedText: "Updated 7 weeks ago",
    intro:
      "The first days after travel are for adaptation, not hero sessions. Keep intensity controlled and prioritise hydration, sleep, and routine timing.",
    bullets: [
      "Arrive with buffer days when possible.",
      "Lower early-session intensity and monitor HR drift.",
      "Hydration and sleep are your first performance priorities.",
    ],
    sectionTitle: "First 48-hour rule",
    sectionBody:
      "Treat the first two days as adaptation days. Keep runs easy, shorten strength sessions, and avoid max efforts while your system recalibrates.",
  },
  {
    key: "caffeine-timing",
    title: "Caffeine timing strategy",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Caffeine is most effective when dose and timing are tested in training before race day.",
    author: "Coach Team",
    updatedText: "Updated 4 weeks ago",
    intro:
      "Caffeine can boost performance, but only when the protocol is familiar. Trial in key sessions so race day feels predictable instead of risky.",
    bullets: [
      "Trial dose and timing in key sessions before racing.",
      "Avoid stacking too much too early in longer events.",
      "Protect sleep by using lower doses late in the day.",
    ],
    sectionTitle: "Dose discipline",
    sectionBody:
      "More is not always better. Use the smallest dose that gives a clear effect and repeat that protocol in training to confirm tolerance.",
  },
  {
    key: "downhill-cadence",
    title: "Downhill cadence control",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Downhill speed comes from cadence and stability, not bigger stride length.",
    author: "Coach Team",
    updatedText: "Updated 2 weeks ago",
    intro:
      "Controlled downhill running saves your legs and protects race rhythm. Focus on quick feet, stable torso, and light ground contact when pace rises.",
    bullets: [
      "Increase cadence slightly and keep contact light.",
      "Stay tall with hips stable and eyes forward.",
      "Use downhill drills to build confidence before race terrain.",
    ],
    sectionTitle: "Drill option",
    sectionBody:
      "Use short downhill repeats with full recovery and form cues only. Build confidence first, then increase speed once mechanics stay clean.",
  },
  {
    key: "strength-taper",
    title: "Strength taper before race week",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Maintain strength stimulus while reducing fatigue in the final pre-race phase.",
    author: "Coach Team",
    updatedText: "Updated 8 weeks ago",
    intro:
      "A good taper keeps movement quality and neural sharpness without residual soreness. Keep key patterns, reduce volume, and avoid novelty close to race day.",
    bullets: [
      "Lower volume first, then lower intensity if needed.",
      "Avoid introducing new lifts close to race day.",
      "Prioritise movement quality and freshness over load.",
    ],
    sectionTitle: "Session focus",
    sectionBody:
      "Choose low-risk compounds and keep reps crisp. End sets with reserve so your running quality remains high through the taper window.",
  },
  {
    key: "taper-anxiety",
    title: "Taper anxiety management",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "A calm taper improves race execution. Keep routines stable and reduce decision noise.",
    author: "Coach Team",
    updatedText: "Updated 10 days ago",
    intro:
      "Most taper anxiety comes from reduced volume and extra mental space. Replace uncertainty with simple routines and a fixed race-week checklist.",
    bullets: [
      "Use short confidence sessions instead of extra volume.",
      "Lock kit, pacing, and fueling plans early.",
      "Replace overthinking with checklist-based preparation.",
    ],
    sectionTitle: "Mental reset prompt",
    sectionBody:
      "When anxiety rises, return to your checklist: sleep, hydration, fueling, and pacing cues. Structure calms decision fatigue before race day.",
  },
];

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

function sessionSportKind(sess) {
  const raw = String(
    sess?.workout?.sport || sess?.sessionType || sess?.type || ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym")) return "strength";
  if (raw.includes("run")) return "run";

  const runTypes = new Set([
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
  ]);
  if (runTypes.has(raw)) return "run";

  return "other";
}

function sortMergedSessions(sessions) {
  const arr = Array.isArray(sessions) ? [...sessions] : [];
  const rank = (sess) => {
    const sport = sessionSportKind(sess);
    if (sport === "run") return 0;
    if (sport === "strength") return 1;
    return 2;
  };
  arr.sort((a, b) => rank(a) - rank(b));
  return arr;
}

function mapSampleTypeToRecordType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("run")) return "run";
  if (t.includes("strength")) return "gym";
  if (t.includes("bodyweight")) return "other";
  return "other";
}

function sampleIconName(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("run")) return "activity";
  if (t.includes("strength")) return "bar-chart-2";
  if (t.includes("hybrid")) return "shuffle";
  if (t.includes("recovery")) return "moon";
  if (t.includes("bodyweight")) return "user";
  return "layers";
}

function sampleEffortLabel(rpe) {
  const x = Number(rpe || 0);
  if (!x) return "Unspecified";
  if (x <= 3) return "Very easy";
  if (x <= 5) return "Easy";
  if (x <= 7) return "Moderate";
  if (x <= 8) return "Hard";
  return "Very hard";
}

function sampleSecondaryMeta(sample) {
  const type = String(sample?.type || "").toLowerCase();
  if (Number.isFinite(Number(sample?.distanceKm)) && Number(sample.distanceKm) > 0) {
    return `${Number(sample.distanceKm).toFixed(1)} km`;
  }
  if (type.includes("strength") || type.includes("bodyweight")) return "Strength focus";
  if (type.includes("recovery")) return "Mobility focus";
  if (type.includes("hybrid")) return "Mixed format";
  return "Training focus";
}

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const silverLight = colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  return {
    bg: colors.bg,
    card: isDark ? "#111217" : silverLight,
    card2: isDark ? "#0E0F12" : "#FFFFFF",
    text: colors.text,
    subtext: colors.subtext,
    border: isDark ? "#1F2128" : silverMed,
    primaryBg: colors?.accentBg ?? PRIMARY,
    primaryText: "#111111",
    headerTitle: colors.text,
    headerSubtitle: colors.subtext,
    isDark,
  };
}

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
  const dd = new Date(d);
  return dd.toISOString().split("T")[0];
}
function fmtDayDate(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const normaliseStr = (s) => String(s || "").trim();

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function formatPaceFromSecPerKm(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}/km`;
}

function formatBpmRange(range) {
  if (!range) return null;
  const min = Number(range?.minBpm ?? range?.min);
  const max = Number(range?.maxBpm ?? range?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return `${Math.round(min)}-${Math.round(max)} bpm`;
}

function formatPaceRange(range) {
  if (!range) return null;
  const min = Number(range?.minSecPerKm);
  const max = Number(range?.maxSecPerKm);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const fast = formatPaceFromSecPerKm(min);
  const slow = formatPaceFromSecPerKm(max);
  if (!fast || !slow) return null;
  return `${fast}-${slow}`;
}

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function getSessionGuidance(sess) {
  const warmupMin = Number(sess?.warmupMin);
  const cooldownMin = Number(sess?.cooldownMin);
  const pace = formatPaceRange(sess?.targetPace || sess?.workout?.paceTarget);
  const hr = formatBpmRange(sess?.targetHr || sess?.workout?.hrTarget);

  const parts = [];
  if (Number.isFinite(warmupMin) && warmupMin > 0) parts.push(`WU ${Math.round(warmupMin)}m`);
  if (Number.isFinite(cooldownMin) && cooldownMin > 0) parts.push(`CD ${Math.round(cooldownMin)}m`);
  if (pace) parts.push(`Pace ${pace}`);
  if (hr) parts.push(`HR ${hr}`);
  return parts.join(" · ");
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

  const pace = sess?.workout?.steps?.find?.((st) => st?.pace?.secPerKm)?.pace?.secPerKm;
  const paceFmt = pace ? formatPaceFromSecPerKm(pace) : null;

  const parts = [];
  if (durationMin) parts.push(`${durationMin}m`);
  if (distanceKm) parts.push(`${Number(distanceKm).toFixed(1)}k`);
  if (paceFmt) parts.push(paceFmt);
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

function typeIconName(sess) {
  const sport = sessionSportKind(sess);
  if (sport === "run") return "activity";
  if (sport === "strength") return "zap";
  const t = String(sess?.sessionType || sess?.type || "training").toLowerCase();
  if (t.includes("mob")) return "heart";
  if (t.includes("yoga")) return "heart";
  if (t.includes("hyrox")) return "target";
  return "layers";
}

function typePipColor(theme, sess) {
  if (sessionSportKind(sess) === "run") return theme.primaryBg;
  return theme.isDark ? "rgba(148,163,184,0.45)" : "rgba(15,23,42,0.15)";
}

/* ──────────────────────────────────────────────────────────────
   Plan normalisation
────────────────────────────────────────────────────────────── */
const mkStep = (over = {}) => ({
  type: over.type || "Run",
  notes: over.notes || "",
  durationType: over.durationType || "Time (min)",
  durationValue: Number(over.durationValue ?? (over.durationType === "Distance (km)" ? 1 : 10)),
  intensityType: over.intensityType || "None",
  intensityTarget: over.intensityTarget || "",
  isRepeat: over.isRepeat || false,
  repeatReps: Number(over.repeatReps || 2),
  steps: Array.isArray(over.steps) ? over.steps : [],
});

const withWarmCool = (session) => {
  const steps = Array.isArray(session.segments) ? session.segments : [];
  const hasWU = steps.some((s) => /^warm/i.test(s.type));
  const hasCD = steps.some((s) => /^cool/i.test(s.type));
  const patched = [...steps];

  if (!hasWU) {
    patched.unshift(
      mkStep({
        type: "Warmup",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1–Z2",
        notes: "Build gradually; drills",
      })
    );
  }
  if (!hasCD) {
    patched.push(
      mkStep({
        type: "CoolDown",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1",
        notes: "Ease down; light mobility",
      })
    );
  }

  return { ...session, segments: patched };
};

function segmentToWorkoutStep(seg) {
  if (!seg) return null;

  if (seg.isRepeat) {
    return {
      type: "repeat",
      reps: Number(seg.repeatReps || 1),
      steps: (seg.steps || []).map((inner) => segmentToWorkoutStep(inner)).filter(Boolean),
    };
  }

  let durationType = "time";
  if (seg.durationType === "Distance (km)") durationType = "distance";
  else if (seg.durationType === "Reps") durationType = "reps";

  const base = {
    type: String(seg.type || "Run").toLowerCase(),
    durationType,
    durationValue: Number(seg.durationValue || 0),
  };

  if (seg.intensityType && seg.intensityType !== "None") {
    let intensityType = "custom";
    if (seg.intensityType === "Pace (/km)") intensityType = "pace";
    if (seg.intensityType === "HR Zone") intensityType = "hr";
    if (seg.intensityType === "RPE") intensityType = "rpe";

    base.intensity = { type: intensityType, target: seg.intensityTarget || "" };
  }

  if (seg.notes) base.notes = seg.notes;
  return base;
}
function segmentsToWorkoutSteps(segments) {
  return (segments || []).map((s) => segmentToWorkoutStep(s)).filter(Boolean);
}

function estimateTotalsFromWorkoutSteps(steps) {
  let totalDistanceKm = 0;
  let totalDurationSec = 0;

  const walk = (step, repsMultiplier = 1) => {
    if (!step) return;

    if (step.type === "repeat" && Array.isArray(step.steps)) {
      const reps = Number(step.reps || 1);
      step.steps.forEach((inner) => walk(inner, repsMultiplier * reps));
      return;
    }

    const durType = step.durationType;
    const val = Number(step.durationValue || 0);
    if (!Number.isFinite(val) || val <= 0) return;

    if (durType === "distance") {
      totalDistanceKm += val * repsMultiplier;
    } else if (durType === "time") {
      totalDurationSec += val * 60 * repsMultiplier;
    }
  };

  (steps || []).forEach((s) => walk(s, 1));

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationSec: Math.round(totalDurationSec),
  };
}

function stockStepToWorkoutStep(step) {
  if (!step || typeof step !== "object") return null;
  const t = String(step.type || "").toUpperCase();

  if (t === "REPEAT") {
    return {
      type: "repeat",
      reps: Number(step.repeat || 1),
      steps: (step.steps || []).map(stockStepToWorkoutStep).filter(Boolean),
      name: step.name || "Repeat",
      notes: step.notes || "",
    };
  }

  if (t === "RUN") {
    const durType = String(step?.duration?.type || "").toUpperCase();
    const durationType = durType === "DISTANCE" ? "distance" : "time";

    const durationValue =
      durationType === "distance"
        ? Number(step?.duration?.meters != null ? step.duration.meters / 1000 : step?.duration?.km || 0)
        : Number(step?.duration?.seconds != null ? step.duration.seconds / 60 : step?.duration?.minutes || 0);

    const out = {
      type: "run",
      durationType,
      durationValue: Number.isFinite(durationValue) ? durationValue : 0,
      name: step.name || "Run",
      notes: step.notes || "",
    };

    const paceSecPerKm = step?.target?.paceSecPerKm;
    const paceKey = step?.target?.paceKey;

    if (Number.isFinite(Number(paceSecPerKm))) {
      out.intensity = { type: "pace", target: String(Math.round(Number(paceSecPerKm))) };
      out.pace = { key: paceKey || "", secPerKm: Math.round(Number(paceSecPerKm)) };
    } else if (paceKey) {
      out.pace = { key: paceKey, secPerKm: null };
    }

    return out;
  }

  return {
    type: String(step.type || "step").toLowerCase(),
    durationType: "time",
    durationValue: 0,
    notes: step.notes || "",
  };
}
function stockStepsToWorkoutSteps(steps) {
  return (steps || []).map(stockStepToWorkoutStep).filter(Boolean);
}
function totalsFromStockSteps(steps) {
  let totalDistanceKm = 0;
  let totalDurationSec = 0;

  const walk = (st, mult = 1) => {
    if (!st) return;
    if (st.type === "repeat" && Array.isArray(st.steps)) {
      const reps = Number(st.reps || 1);
      st.steps.forEach((inner) => walk(inner, mult * reps));
      return;
    }
    const val = Number(st.durationValue || 0);
    if (!Number.isFinite(val) || val <= 0) return;

    if (st.durationType === "distance") totalDistanceKm += val * mult;
    if (st.durationType === "time") totalDurationSec += Math.round(val * 60 * mult);
  };

  (steps || []).forEach((st) => walk(st, 1));

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationSec,
  };
}
function looksLikeStockSession(sess) {
  return Array.isArray(sess?.steps) && sess.steps.length > 0 && sess.steps.some((x) => x?.duration);
}

const normaliseSessionForPlan = (sess) => {
  if (!sess) return null;

  if (looksLikeStockSession(sess)) {
    const workoutSteps = stockStepsToWorkoutSteps(sess.steps);
    const totals = totalsFromStockSteps(workoutSteps);

    const explicitKm = Number(sess?.distanceKm ?? sess?.distance ?? sess?.plannedDistanceKm ?? 0) || 0;

    const totalDistanceKm = explicitKm || totals.totalDistanceKm || 0;
    const totalDurationSec = totals.totalDurationSec || 0;

    const sessionTypeRaw = sess?.sessionType || sess?.type || "RUN";
    const sessionType = String(sessionTypeRaw || "").toLowerCase();

    const title =
      sess?.name ||
      sess?.title ||
      (typeof sessionTypeRaw === "string" ? sessionTypeRaw : "Run");

    return {
      ...sess,
      title,
      name: title,
      type: sess?.type || "Run",
      sessionType: sessionType || "run",
      targetDistanceKm: sess?.targetDistanceKm ?? (totalDistanceKm ? totalDistanceKm : undefined),
      targetDurationMin: sess?.targetDurationMin ?? (totalDurationSec ? Math.round(totalDurationSec / 60) : undefined),
      totalDistanceKm,
      totalDurationSec,
      workout: {
        sport: "run",
        totalDistanceKm,
        totalDurationSec,
        steps: workoutSteps,
      },
    };
  }

  const sportKind = sessionSportKind(sess);
  const sessionType = String(sess.sessionType || sess.type || "").toLowerCase();

  if (sportKind === "strength" || sportKind === "other") {
    const existingWorkout = sess.workout || {};

    const durationMinRaw =
      existingWorkout.totalDurationSec != null
        ? existingWorkout.totalDurationSec / 60
        : sess.targetDurationMin ?? sess.durationMin ?? 0;

    const distanceKmRaw =
      existingWorkout.totalDistanceKm != null
        ? existingWorkout.totalDistanceKm
        : sess.targetDistanceKm ?? sess.distanceKm ?? 0;

    const durationMin = Number(durationMinRaw || 0) || undefined;
    const distanceKm = Number(distanceKmRaw || 0) || undefined;

    const totalDurationSec =
      existingWorkout.totalDurationSec != null
        ? existingWorkout.totalDurationSec
        : durationMin
        ? Math.round(durationMin * 60)
        : 0;

    const totalDistanceKm =
      existingWorkout.totalDistanceKm != null ? existingWorkout.totalDistanceKm : distanceKm || 0;

    return {
      ...sess,
      title: sess.title || sess.name || sess.type || "Session",
      sessionType: sportKind === "strength" ? "gym" : sessionType || "training",
      targetDurationMin: sess.targetDurationMin != null ? sess.targetDurationMin : durationMin,
      targetDistanceKm: sess.targetDistanceKm != null ? sess.targetDistanceKm : distanceKm,
      totalDurationSec,
      totalDistanceKm,
      workout: {
        sport:
          existingWorkout.sport ||
          (sportKind === "strength" ? "strength" : sessionType || "training"),
        totalDurationSec,
        totalDistanceKm,
        steps: Array.isArray(existingWorkout.steps) ? existingWorkout.steps : [],
      },
    };
  }

  const baseWithSegments = withWarmCool(sess.segments ? sess : { ...sess, segments: sess.segments || [] });
  let segments = Array.isArray(baseWithSegments.segments) ? baseWithSegments.segments : [];

  const durationMinRaw =
    baseWithSegments.targetDurationMin != null ? baseWithSegments.targetDurationMin : baseWithSegments.durationMin;
  const distanceKmRaw =
    baseWithSegments.targetDistanceKm != null ? baseWithSegments.targetDistanceKm : baseWithSegments.distanceKm;

  const durationMin = Number(durationMinRaw || 0) || undefined;
  const distanceKm = Number(distanceKmRaw || 0) || undefined;

  const hasMain = segments.some((s) => s && !/^(warm|cool)/i.test(String(s.type || "")) && !s.isRepeat);

  if (!hasMain) {
    let durationType = "Time (min)";
    let durationValue = 0;

    if (distanceKm && !durationMin) {
      durationType = "Distance (km)";
      durationValue = distanceKm;
    } else if (durationMin) {
      durationType = "Time (min)";
      durationValue = durationMin;
    } else {
      durationType = "Time (min)";
      durationValue = 10;
    }

    const warm = segments.find((s) => /^warm/i.test(String(s.type || "")));
    const cool = segments.find((s) => /^cool/i.test(String(s.type || "")));

    const newSegs = [];
    if (warm) newSegs.push(warm);
    newSegs.push(
      mkStep({
        type: "Run",
        durationType,
        durationValue,
        intensityType: "None",
        notes: baseWithSegments.notes || "",
      })
    );
    if (cool) newSegs.push(cool);

    if (newSegs.length) segments = newSegs;
  }

  const workoutSteps =
    baseWithSegments.workout?.steps && baseWithSegments.workout.steps.length
      ? baseWithSegments.workout.steps
      : segmentsToWorkoutSteps(segments);

  const totalsFromSteps = estimateTotalsFromWorkoutSteps(workoutSteps);

  const finalDistanceKm =
    totalsFromSteps.totalDistanceKm || baseWithSegments.workout?.totalDistanceKm || distanceKm || 0;
  const finalDurationSec =
    totalsFromSteps.totalDurationSec ||
    baseWithSegments.workout?.totalDurationSec ||
    (durationMin ? durationMin * 60 : 0);

  const finalDurationMin = finalDurationSec ? finalDurationSec / 60 : durationMin || 0;

  return {
    ...baseWithSegments,
    title: baseWithSegments.title || baseWithSegments.name || baseWithSegments.type || "Run",
    sessionType: "run",
    type: baseWithSegments.type || "Run",
    segments,
    targetDurationMin:
      baseWithSegments.targetDurationMin != null ? baseWithSegments.targetDurationMin : finalDurationMin || undefined,
    targetDistanceKm:
      baseWithSegments.targetDistanceKm != null ? baseWithSegments.targetDistanceKm : finalDistanceKm || undefined,
    totalDistanceKm: finalDistanceKm || undefined,
    totalDurationSec: finalDurationSec || undefined,
    workout: {
      sport: baseWithSegments.workout?.sport || "run",
      totalDistanceKm: finalDistanceKm || 0,
      totalDurationSec: finalDurationSec || 0,
      steps: workoutSteps,
    },
  };
};

const normaliseWeeksForClient = (weeks) =>
  (weeks || []).map((w, wi) => {
    const rawDays = Array.isArray(w?.days) ? w.days : [];
    const dayMap = new Map(rawDays.map((d) => [d?.day, d]));

    const days = DAYS.map((dayLabel) => {
      const d = dayMap.get(dayLabel) || { day: dayLabel, sessions: [] };
      const sessions = (Array.isArray(d?.sessions) ? d.sessions : [])
        .map(normaliseSessionForPlan)
        .filter(Boolean);

      return { day: dayLabel, sessions };
    });

    return {
      title: w?.title || `Week ${wi + 1}`,
      weekIndex0: typeof w?.weekIndex0 === "number" ? w.weekIndex0 : wi,
      weekNumber: typeof w?.weekNumber === "number" ? w.weekNumber : wi + 1,
      days,
    };
  });

function timestampMs(v) {
  if (!v) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v?.toMillis === "function") {
    try {
      const ms = v.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }
  const d = new Date(v);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function resolveSessionLogStatus(log) {
  const raw = String(log?.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "skipped") return raw;
  if (log?.skippedAt) return "skipped";
  if (log?.completedAt || log?.lastTrainSessionId) return "completed";
  return "";
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

function summariseCardStatuses(cards) {
  const list = Array.isArray(cards) ? cards : [];
  let completed = 0;
  let skipped = 0;
  let pending = 0;

  list.forEach((card) => {
    const status = String(card?.status || "").toLowerCase();
    if (status === "completed") {
      completed += 1;
      return;
    }
    if (status === "skipped") {
      skipped += 1;
      return;
    }
    pending += 1;
  });

  return {
    total: list.length,
    completed,
    skipped,
    pending,
    resolved: completed + skipped,
  };
}

function extractWeeksFromPlanDoc(data) {
  if (!data || typeof data !== "object") return [];
  const cands = [
    data?.weeks,
    data?.plan?.weeks,
    data?.planData?.weeks,
    data?.generatedPlan?.weeks,
    data?.activePlan?.weeks,
    data?.template?.weeks,
    data?.payload?.weeks,
  ];
  for (const item of cands) {
    if (Array.isArray(item) && item.length) return item;
  }
  return [];
}

function countSessionsInWeeks(weeks) {
  let total = 0;
  for (const week of Array.isArray(weeks) ? weeks : []) {
    const days = Array.isArray(week?.days) ? week.days : [];
    for (const day of days) {
      total += Array.isArray(day?.sessions) ? day.sessions.length : 0;
    }
    if (!days.length && Array.isArray(week?.sessions)) {
      total += week.sessions.length;
    }
  }
  return total;
}

function getCoachNameFromDoc(data) {
  return (
    normaliseStr(data?.coachName) ||
    normaliseStr(data?.coach?.name) ||
    normaliseStr(data?.meta?.coachName) ||
    normaliseStr(data?.authorName) ||
    normaliseStr(data?.createdByName)
  );
}

function isCoachSetPlanDoc(data) {
  if (!data || typeof data !== "object") return false;

  if (
    data?.isCoachPlan ||
    data?.isPublished ||
    data?.published ||
    data?.public === true ||
    data?.visibility === "public" ||
    data?.meta?.isCoachPlan ||
    data?.meta?.published
  ) {
    return true;
  }

  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  if (source.includes("coach") || source.includes("stock-template")) return true;

  const role = String(
    data?.createdByRole || data?.authorRole || data?.meta?.createdByRole || ""
  ).toLowerCase();
  if (role.includes("coach")) return true;

  return !!getCoachNameFromDoc(data);
}

function normaliseCoachPlanCandidate({ sourceCollection, docData, currentUid }) {
  if (!docData || typeof docData !== "object") return null;

  const ownerUid = String(
    docData?.uid || docData?.userId || docData?.ownerId || docData?.createdByUid || ""
  );
  if (currentUid && ownerUid && ownerUid === currentUid) return null;

  if (!isCoachSetPlanDoc(docData)) return null;

  const weeksRaw = extractWeeksFromPlanDoc(docData);
  if (!weeksRaw.length) return null;

  const weeks = normaliseWeeksForClient(weeksRaw);
  if (!weeks.length) return null;

  const kind = inferPlanKindFromDoc(docData);
  const name =
    normaliseStr(docData?.meta?.name) ||
    normaliseStr(docData?.plan?.name) ||
    normaliseStr(docData?.planName) ||
    normaliseStr(docData?.name) ||
    "Coach plan";

  const description =
    normaliseStr(docData?.description) ||
    normaliseStr(docData?.summary) ||
    normaliseStr(docData?.meta?.summary) ||
    normaliseStr(docData?.primaryFocus) ||
    "";

  const primaryActivity =
    normaliseStr(docData?.primaryActivity) ||
    normaliseStr(docData?.meta?.primaryActivity) ||
    (kind === "strength" ? "Strength" : kind === "run" ? "Run" : "Training");

  const sortMs = Math.max(timestampMs(docData?.updatedAt), timestampMs(docData?.createdAt));

  return {
    id: String(docData.id),
    sourceCollection,
    name,
    description,
    coachName: getCoachNameFromDoc(docData) || "Coach set",
    kind,
    primaryActivity,
    weekCount: weeks.length,
    sessionCount: countSessionsInWeeks(weeks),
    sortMs,
    weeks,
    raw: { ...docData },
  };
}

function findFirstSessionKeyFromWeeks(planId, weeks) {
  if (!planId) return null;
  const list = Array.isArray(weeks) ? weeks : [];
  for (let wi = 0; wi < list.length; wi += 1) {
    const week = list[wi];
    const days = Array.isArray(week?.days) ? week.days : [];
    for (let di = 0; di < days.length; di += 1) {
      const sessions = Array.isArray(days[di]?.sessions) ? days[di].sessions : [];
      if (sessions.length) {
        return buildSessionKey(planId, wi, di, 0);
      }
    }
  }
  return null;
}

function DayPill({ theme, item, onPress }) {
  const active = item.isToday;
  const sessionCount = Array.isArray(item.cards) ? item.cards.length : 0;
  const has = sessionCount > 0;
  const statusLabel = active ? "Today" : has ? "Planned" : "Rest";
  const detailLabel = has ? `${sessionCount} session${sessionCount > 1 ? "s" : ""}` : "Recovery / open";
  const statusBg = active ? theme.primaryBg : has ? theme.card2 : "transparent";
  const statusText = active ? theme.primaryText : has ? theme.text : theme.subtext;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        s.dayPill,
        {
          backgroundColor: active ? theme.card2 : theme.card,
          borderColor: active ? theme.primaryBg : theme.border,
        },
      ]}
    >
      <View style={s.dayPillTop}>
        <Text style={[s.dayPillDow, { color: active ? theme.text : theme.text }]}>{item.dayLabel}</Text>
        <Text style={[s.dayPillDate, { color: theme.subtext }]} numberOfLines={1}>
          {item.dateShort}
        </Text>
      </View>

      <View
        style={[
          s.dayPillStatus,
          {
            backgroundColor: statusBg,
            borderColor: has || active ? "rgba(0,0,0,0)" : theme.border,
          },
        ]}
      >
        <Text style={[s.dayPillStatusText, { color: statusText }]}>{statusLabel}</Text>
      </View>
      <Text style={[s.dayPillMeta, { color: theme.subtext }]} numberOfLines={1}>
        {detailLabel}
      </Text>
    </TouchableOpacity>
  );
}

function ActionRowButton({ icon, label, theme, onPress, primary = false }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        s.actionRowBtn,
        primary
          ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
          : { backgroundColor: theme.card2, borderColor: theme.border },
      ]}
    >
      <Feather name={icon} size={14} color={primary ? theme.primaryText : theme.text} />
      <Text style={{ color: primary ? theme.primaryText : theme.text, fontWeight: "700", fontSize: 13 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ──────────────────────────────────────────────────────────────
   Main screen
────────────────────────────────────────────────────────────── */
export default function TrainIndex() {
  const theme = useScreenTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [companionPlan, setCompanionPlan] = useState(null);
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => {
    const idx = DAYS.indexOf(JS_DAY_LABELS[new Date().getDay()]);
    return idx >= 0 ? idx : 0;
  });

  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [daySheetIndex, setDaySheetIndex] = useState(0);

  const [moreOpen, setMoreOpen] = useState(false);

  const [recordOpen, setRecordOpen] = useState(false);
  const [recordDayIndex, setRecordDayIndex] = useState(0);
  const [recordType, setRecordType] = useState("run");
  const [recordTitle, setRecordTitle] = useState("");
  const [recordDurationMin, setRecordDurationMin] = useState("");
  const [recordDistanceKm, setRecordDistanceKm] = useState("");
  const [recordRpe, setRecordRpe] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [recordSeedSampleKey, setRecordSeedSampleKey] = useState("");
  const [savingQuick, setSavingQuick] = useState(false);
  const [sendingToWatch, setSendingToWatch] = useState(false);
  const [coachPlansLoading, setCoachPlansLoading] = useState(false);
  const [coachPlans, setCoachPlans] = useState([]);
  const [usingCoachPlanId, setUsingCoachPlanId] = useState("");
  const [sessionLogMap, setSessionLogMap] = useState({});
  const [sampleCategory, setSampleCategory] = useState("all");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [tipTopicKey, setTipTopicKey] = useState("gut-training");
  const [weekStripWidth, setWeekStripWidth] = useState(0);
  const weekCarouselTranslateX = useRef(
    new Animated.Value(-WEEK_CAROUSEL_FALLBACK_WIDTH)
  ).current;
  const weekCarouselAnimatingRef = useRef(false);
  const weekCarouselGestureRef = useRef(false);

  const goToSession = useCallback(
    (key) => {
      if (!key) return;
      router.push(`/train/session/${encodeURIComponent(key)}`);
    },
    [router]
  );

  const hasPlan = !!(plan || companionPlan);
  const hasRunPlan = useMemo(() => {
    return [plan, companionPlan].some((p) => p && inferPlanKindFromDoc(p) === "run");
  }, [plan, companionPlan]);

  const hasStrengthPlan = useMemo(() => {
    return [plan, companionPlan].some(
      (p) => p && inferPlanKindFromDoc(p) === "strength"
    );
  }, [plan, companionPlan]);

  const normalisePlanDoc = useCallback((snapDoc) => {
    const data = snapDoc?.data?.() || {};
    const rawPlan = data.plan || {};
    const weeksRaw = rawPlan.weeks || data.weeks || [];
    const weeksNormalised = normaliseWeeksForClient(weeksRaw);

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
      weeks: weeksNormalised,
    };
  }, []);

  const loadLatestPlan = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setPlan(null);
        setCompanionPlan(null);
        setLoading(false);
        return;
      }

      const ref = collection(db, "users", uid, "plans");
      const snap = await getDocs(query(ref, orderBy("updatedAt", "desc"), limit(30)));

      if (snap.empty) {
        setPlan(null);
        setCompanionPlan(null);
      } else {
        const docs = snap.docs.map(normalisePlanDoc).filter((d) => d?.id);

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

        setPlan(primary);
        setCompanionPlan(resolvedCompanion);

        try {
          const uiRef = doc(db, "users", uid, "uiState", "train");
          const uiSnap = await getDoc(uiRef);
          const moveState = uiSnap.exists() ? uiSnap.data()?.lastSessionMove : null;

          if (moveState && typeof moveState === "object") {
            const movePlanId = String(moveState?.planId || "");
            const activePlanIds = [primary?.id, resolvedCompanion?.id]
              .map((id) => String(id || ""))
              .filter(Boolean);
            const matchesActivePlan = movePlanId && activePlanIds.includes(movePlanId);

            if (matchesActivePlan) {
              const requestedWeekIndex = Number(
                moveState?.toWeekIndex ?? moveState?.weekIndex ?? 0
              );
              const requestedDayIndex = Number(
                moveState?.toDayIndex ?? moveState?.dayIndex ?? 0
              );
              const weeksCount = Math.max(
                primary?.weeks?.length || 0,
                resolvedCompanion?.weeks?.length || 0,
                1
              );

              if (Number.isFinite(requestedWeekIndex)) {
                const safeWeekIndex = Math.min(
                  Math.max(Math.round(requestedWeekIndex), 0),
                  Math.max(weeksCount - 1, 0)
                );
                setCurrentWeekIndex(safeWeekIndex);
              }

              if (
                Number.isFinite(requestedDayIndex) &&
                requestedDayIndex >= 0 &&
                requestedDayIndex < DAYS.length
              ) {
                setSelectedDayIndex(Math.round(requestedDayIndex));
              }

              await setDoc(
                uiRef,
                {
                  lastSessionMove: null,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          }
        } catch (moveStateErr) {
          console.log("[train] apply move state error:", moveStateErr);
        }
      }
    } catch (e) {
      console.log("[train] load plan error:", e);
    } finally {
      setLoading(false);
    }
  }, [normalisePlanDoc]);

  const loadCoachPlans = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setCoachPlans([]);
      return;
    }

    setCoachPlansLoading(true);
    try {
      const fetchTopLevelPlanDocs = async (colName) => {
        const colRef = collection(db, colName);
        const attempts = [
          () => getDocs(query(colRef, orderBy("updatedAt", "desc"), limit(40))),
          () => getDocs(query(colRef, orderBy("createdAt", "desc"), limit(40))),
          () => getDocs(query(colRef, limit(40))),
        ];

        for (const runAttempt of attempts) {
          try {
            const snap = await runAttempt();
            if (snap?.empty) continue;
            return snap.docs.map((d) => ({
              sourceCollection: colName,
              docData: { id: d.id, ...d.data() },
            }));
          } catch {}
        }

        return [];
      };

      const [runCandidates, planCandidates] = await Promise.all([
        fetchTopLevelPlanDocs("runPlans"),
        fetchTopLevelPlanDocs("plans"),
      ]);

      const localCandidates = MASON_COACH_TEMPLATE_DOCS.map((docData) => ({
        sourceCollection: "localTemplates",
        docData,
      }));

      const merged = [...localCandidates, ...runCandidates, ...planCandidates];
      const deduped = [];
      const seen = new Set();

      for (const item of merged) {
        const key = `${item.sourceCollection}:${item.docData?.id || ""}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      const normalised = deduped
        .map((x) =>
          normaliseCoachPlanCandidate({
            sourceCollection: x.sourceCollection,
            docData: x.docData,
            currentUid: uid,
          })
        )
        .filter(Boolean)
        .sort((a, b) => b.sortMs - a.sortMs)
        .slice(0, 8);

      setCoachPlans(normalised);
    } catch (e) {
      console.log("[train] load coach plans error:", e);
      setCoachPlans([]);
    } finally {
      setCoachPlansLoading(false);
    }
  }, []);

  const useCoachPlan = useCallback(
    async (coachPlan) => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Sign in required", "Please sign in before adding a coach plan.");
        return;
      }
      if (!coachPlan?.id) return;

      setUsingCoachPlanId(String(coachPlan.id));
      try {
        const source = coachPlan.raw || {};
        const weeks = normaliseWeeksForClient(extractWeeksFromPlanDoc(source));
        if (!weeks.length) throw new Error("This coach plan has no sessions.");

        const kind = source?.kind || inferPlanKindFromDoc(source) || "training";
        const name = coachPlan.name || "Coach plan";
        const primaryActivity =
          source?.primaryActivity ||
          source?.meta?.primaryActivity ||
          coachPlan.primaryActivity ||
          (kind === "strength" ? "Strength" : "Run");

        const basePlanObj =
          source?.plan && typeof source.plan === "object"
            ? { ...source.plan, weeks }
            : { name, primaryActivity, weeks };

        const payload = {
          name,
          kind,
          primaryActivity,
          source: "coach-library",
          plan: basePlanObj,
          weeks,
          coachPlanRef: {
            id: coachPlan.id,
            sourceCollection: coachPlan.sourceCollection,
            coachName: coachPlan.coachName || null,
            name,
          },
          meta: {
            ...(source?.meta || {}),
            importedFromCoachPlan: true,
            coachName: coachPlan.coachName || source?.meta?.coachName || null,
            name,
            primaryActivity,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const ref = await addDoc(collection(db, "users", uid, "plans"), payload);
        await loadLatestPlan();

        const firstKey = findFirstSessionKeyFromWeeks(ref.id, weeks);
        Alert.alert(
          "Coach plan added",
          "You can view it or start the first session now.",
          [
            {
              text: "View",
              onPress: () =>
                router.push({ pathname: "/train/view-plan", params: { planId: ref.id } }),
            },
            firstKey
              ? {
                  text: "Start",
                  onPress: () => goToSession(firstKey),
                }
              : { text: "Done", style: "cancel" },
          ]
        );
      } catch (e) {
        Alert.alert("Couldn’t add coach plan", e?.message || "Try again.");
      } finally {
        setUsingCoachPlanId("");
      }
    },
    [goToSession, loadLatestPlan, router]
  );

  const viewCoachPlan = useCallback(
    (coachPlan) => {
      if (!coachPlan?.id) return;
      if (coachPlan.sourceCollection === "localTemplates") {
        router.push({
          pathname: "/train/coach-plan-preview",
          params: { templateId: coachPlan.id },
        });
        return;
      }
      router.push({
        pathname: "/train/view-plan",
        params: { planId: coachPlan.id },
      });
    },
    [router]
  );

  const loadPlanSessionLogs = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    const planIds = [...new Set([plan?.id, companionPlan?.id].filter(Boolean).map(String))];

    if (!uid || !planIds.length) {
      setSessionLogMap({});
      return;
    }

    try {
      const ref = collection(db, "users", uid, "sessionLogs");
      const chunks = [];
      for (let idx = 0; idx < planIds.length; idx += 10) {
        chunks.push(planIds.slice(idx, idx + 10));
      }

      const snapshots = await Promise.all(
        chunks.map((ids) => getDocs(query(ref, where("planId", "in", ids))))
      );

      const nextMap = {};
      snapshots.forEach((snap) => {
        snap.forEach((docSnap) => {
          nextMap[docSnap.id] = docSnap.data() || {};
        });
      });

      setSessionLogMap(nextMap);
    } catch (e) {
      console.log("[train] load session logs error:", e);
    }
  }, [companionPlan?.id, plan?.id]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadLatestPlan(), loadCoachPlans()]);
    })();
  }, [loadLatestPlan, loadCoachPlans]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        await Promise.all([loadLatestPlan(), loadCoachPlans()]);
      })();
    }, [loadLatestPlan, loadCoachPlans])
  );

  useEffect(() => {
    loadPlanSessionLogs();
  }, [loadPlanSessionLogs]);

  useFocusEffect(
    useCallback(() => {
      loadPlanSessionLogs();
    }, [loadPlanSessionLogs])
  );

  const visibleWeeksCount = useMemo(() => {
    if (!hasPlan) return 0;
    return Math.max(plan?.weeks?.length || 0, companionPlan?.weeks?.length || 0, 1);
  }, [hasPlan, plan?.weeks?.length, companionPlan?.weeks?.length]);
  const maxWeekIndex = useMemo(
    () => Math.max((visibleWeeksCount || 1) - 1, 0),
    [visibleWeeksCount]
  );

  useEffect(() => {
    if (!hasPlan) return;
    setCurrentWeekIndex((prev) =>
      Math.min(Math.max(prev, 0), Math.max((visibleWeeksCount || 1) - 1, 0))
    );
  }, [hasPlan, visibleWeeksCount]);

  const weekPanelWidth = useMemo(
    () => Math.max(Number(weekStripWidth || 0), WEEK_CAROUSEL_FALLBACK_WIDTH),
    [weekStripWidth]
  );

  const clampWeekIndex = useCallback(
    (idx) => Math.min(Math.max(Number(idx || 0), 0), maxWeekIndex),
    [maxWeekIndex]
  );

  useEffect(() => {
    if (!hasPlan) {
      weekCarouselAnimatingRef.current = false;
      weekCarouselGestureRef.current = false;
      weekCarouselTranslateX.setValue(-weekPanelWidth);
      return;
    }
    if (!weekCarouselAnimatingRef.current && !weekCarouselGestureRef.current) {
      weekCarouselTranslateX.setValue(-weekPanelWidth);
    }
  }, [hasPlan, weekPanelWidth, weekCarouselTranslateX]);

  const animateWeekSnapToCenter = useCallback(
    (velocity = 0) => {
      Animated.spring(weekCarouselTranslateX, {
        toValue: -weekPanelWidth,
        velocity,
        tension: 190,
        friction: 22,
        useNativeDriver: true,
      }).start();
    },
    [weekCarouselTranslateX, weekPanelWidth]
  );

  const animateWeekByDelta = useCallback(
    (delta) => {
      if (!hasPlan || weekCarouselAnimatingRef.current) return;
      const signedDelta = Number(delta || 0) > 0 ? 1 : -1;
      const targetIndex = clampWeekIndex(currentWeekIndex + signedDelta);
      if (targetIndex === currentWeekIndex) {
        animateWeekSnapToCenter();
        return;
      }

      weekCarouselAnimatingRef.current = true;
      Animated.timing(weekCarouselTranslateX, {
        toValue: -weekPanelWidth - signedDelta * weekPanelWidth,
        duration: 210,
        useNativeDriver: true,
      }).start(({ finished }) => {
        setCurrentWeekIndex(targetIndex);
        weekCarouselTranslateX.setValue(-weekPanelWidth);
        weekCarouselAnimatingRef.current = false;
        if (!finished) {
          animateWeekSnapToCenter();
        }
      });
    },
    [
      animateWeekSnapToCenter,
      clampWeekIndex,
      currentWeekIndex,
      hasPlan,
      weekCarouselTranslateX,
      weekPanelWidth,
    ]
  );

  const shiftWeek = useCallback(
    (delta) => {
      const step = Math.trunc(Number(delta || 0));
      if (!step) return;
      if (Math.abs(step) === 1) {
        animateWeekByDelta(step);
        return;
      }
      setCurrentWeekIndex((prev) => clampWeekIndex(prev + step));
    },
    [animateWeekByDelta, clampWeekIndex]
  );

  const jumpForwardWeeks = useCallback(() => {
    shiftWeek(4);
  }, [shiftWeek]);

  const weekSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          hasPlan &&
          !weekCarouselAnimatingRef.current &&
          maxWeekIndex > 0 &&
          Math.abs(gesture.dx) > 6 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05,
        onPanResponderGrant: () => {
          weekCarouselGestureRef.current = true;
        },
        onPanResponderMove: (_, gesture) => {
          if (weekCarouselAnimatingRef.current) return;
          const dx = Number(gesture?.dx || 0);
          const blockedAtStart = currentWeekIndex <= 0 && dx > 0;
          const blockedAtEnd = currentWeekIndex >= maxWeekIndex && dx < 0;
          const adjustedDx = blockedAtStart || blockedAtEnd ? dx * 0.32 : dx;
          weekCarouselTranslateX.setValue(-weekPanelWidth + adjustedDx);
        },
        onPanResponderRelease: (_, gesture) => {
          weekCarouselGestureRef.current = false;
          if (weekCarouselAnimatingRef.current) return;

          const dx = Number(gesture?.dx || 0);
          const vx = Number(gesture?.vx || 0);
          const absDx = Math.abs(dx);
          const shouldAdvance =
            absDx > weekPanelWidth * 0.08 || Math.abs(vx) > 0.25;

          if (!shouldAdvance) {
            animateWeekSnapToCenter(vx);
            return;
          }

          const delta = dx < 0 ? 1 : -1;
          animateWeekByDelta(delta);
        },
        onPanResponderTerminate: () => {
          weekCarouselGestureRef.current = false;
          animateWeekSnapToCenter();
        },
      }),
    [
      animateWeekByDelta,
      animateWeekSnapToCenter,
      currentWeekIndex,
      hasPlan,
      maxWeekIndex,
      weekCarouselTranslateX,
      weekPanelWidth,
    ]
  );

  const mergeWeekAtIndex = useCallback((sourceWeekIndex) => {
    if (!hasPlan) return emptyWeek();
    const safeWeekIndex = clampWeekIndex(sourceWeekIndex);

    const out = emptyWeek();
    const appendFromPlan = (srcPlan) => {
      if (!srcPlan?.id) return;
      const srcWeek = srcPlan?.weeks?.[safeWeekIndex];
      if (!srcWeek?.days?.length) return;

      srcWeek.days.forEach((day, dayIdx) => {
        const resolvedDayIndex = DAYS.indexOf(String(day?.day || ""));
        const safeDayIndex = resolvedDayIndex >= 0 ? resolvedDayIndex : dayIdx;
        if (safeDayIndex < 0 || safeDayIndex > DAYS.length - 1) return;

        const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
        sessions.forEach((sess, sessIdx) => {
          out.days[safeDayIndex].sessions.push({
            ...sess,
            __sourcePlanId: srcPlan.id,
            __sourceWeekIndex: safeWeekIndex,
            __sourceDayIndex: safeDayIndex,
            __sourceSessionIndex: sessIdx,
          });
        });
      });
    };

    appendFromPlan(plan);
    appendFromPlan(companionPlan);

    return {
      ...out,
      title:
        plan?.weeks?.[safeWeekIndex]?.title ||
        companionPlan?.weeks?.[safeWeekIndex]?.title ||
        `Week ${safeWeekIndex + 1}`,
      days: out.days.map((d) => ({
        ...d,
        sessions: sortMergedSessions(d.sessions),
      })),
    };
  }, [clampWeekIndex, companionPlan, hasPlan, plan]);

  const week = useMemo(
    () => mergeWeekAtIndex(currentWeekIndex),
    [mergeWeekAtIndex, currentWeekIndex]
  );

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const isoWeekStart = useMemo(() => startOfISOWeek(new Date()), []);

  const buildWeekGrid = useCallback((weekData, sourceWeekIndex) => {
    return (Array.isArray(weekData?.days) ? weekData.days : []).map((d, dayIdx) => {
      const weekOffset = Number.isFinite(Number(sourceWeekIndex))
        ? Math.round(Number(sourceWeekIndex)) * 7
        : 0;
      const date = addDays(isoWeekStart, weekOffset + dayIdx);
      const isoDate = toISODate(date);
      const isToday = isoDate === todayIso;
      const sessions = Array.isArray(d.sessions) ? d.sessions : [];

      const cards = sessions.map((sess, sessIdx) => {
        const title = sess?.title || sess?.name || sess?.sessionType || sess?.type || "Session";
        const meta = sumSessionMeta(sess);
        const guidance = getSessionGuidance(sess);
        const keyPlanId = sess?.__sourcePlanId || plan?.id || null;
        const keyWeekIndex =
          Number.isFinite(Number(sess?.__sourceWeekIndex))
            ? Number(sess.__sourceWeekIndex)
            : sourceWeekIndex;
        const keyDayIndex =
          Number.isFinite(Number(sess?.__sourceDayIndex))
            ? Number(sess.__sourceDayIndex)
            : dayIdx;
        const keySessionIndex =
          Number.isFinite(Number(sess?.__sourceSessionIndex))
            ? Number(sess.__sourceSessionIndex)
            : sessIdx;

        const key = keyPlanId
          ? buildSessionKey(keyPlanId, keyWeekIndex, keyDayIndex, keySessionIndex)
          : null;
        const log = key ? sessionLogMap[key] || null : null;
        const status = resolveSessionLogStatus(log);
        const savedTrainSessionId = String(log?.lastTrainSessionId || "").trim() || null;

        return {
          sess,
          title,
          meta,
          guidance,
          key,
          log,
          status,
          savedTrainSessionId,
          linkedActivity: log?.linkedActivity || null,
        };
      });

      const sessionSummary = summariseCardStatuses(cards);

      const dateLabel = fmtDayDate(date);
      const short = new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

      return {
        dayLabel: d.day,
        dayIdx,
        date,
        dateLabel,
        dateShort: short,
        isoDate,
        isToday,
        cards,
        sessionSummary,
      };
    });
  }, [isoWeekStart, plan?.id, sessionLogMap, todayIso]);

  const weekGrid = useMemo(
    () => buildWeekGrid(week, currentWeekIndex),
    [buildWeekGrid, week, currentWeekIndex]
  );

  const weekCarouselPanels = useMemo(() => {
    const prevWeekIndex = clampWeekIndex(currentWeekIndex - 1);
    const nextWeekIndex = clampWeekIndex(currentWeekIndex + 1);
    const panelSpecs = [
      { id: "prev", weekIndex: prevWeekIndex },
      { id: "current", weekIndex: currentWeekIndex },
      { id: "next", weekIndex: nextWeekIndex },
    ];

    return panelSpecs.map((panel) => ({
      ...panel,
      grid: buildWeekGrid(mergeWeekAtIndex(panel.weekIndex), panel.weekIndex),
    }));
  }, [buildWeekGrid, clampWeekIndex, currentWeekIndex, mergeWeekAtIndex]);

  const today = useMemo(() => weekGrid.find((x) => x.isToday) || null, [weekGrid]);
  const focusedDay = useMemo(
    () => weekGrid?.[selectedDayIndex] || today || weekGrid?.[0] || null,
    [weekGrid, selectedDayIndex, today]
  );
  const focusedDayCards = useMemo(
    () => (Array.isArray(focusedDay?.cards) ? focusedDay.cards : []),
    [focusedDay]
  );
  const focusedDayPriority = useMemo(() => pickPriorityCard(focusedDayCards), [focusedDayCards]);
  const todayFirst = focusedDayPriority.card;
  const todayFirstIndex = focusedDayPriority.index;

  useEffect(() => {
    setSelectedDayIndex((prev) => {
      const maxIdx = Math.max(weekGrid.length - 1, 0);
      return Math.min(Math.max(Number(prev) || 0, 0), maxIdx);
    });
  }, [weekGrid.length]);

  const todayHero = useMemo(() => {
    if (!focusedDay) return null;

    const session = todayFirst?.sess || null;
    const title = todayFirst?.title || "Rest / optional movement";
    const subtitle = todayFirst?.meta || (todayFirst ? "" : "No structured session planned");
    const status = String(todayFirst?.status || "").toLowerCase();

    const type = session ? sessionTypeLabel(session) : "Rest";
    const notes = normaliseStr(session?.notes || session?.workout?.notes || "");
    const guidance = session ? getSessionGuidance(session) : "";
    const focus = notes || guidance || type;

    const rpe =
      session?.intensity?.type === "rpe" ? session?.intensity?.target : session?.rpeTarget ?? null;

    return {
      dateLabel: focusedDay.dateLabel,
      dayLabel: focusedDay.dayLabel,
      isoDate: focusedDay.isoDate,
      dayIdx: focusedDay.dayIdx,
      hasPlan: !!todayFirst?.key,
      key: todayFirst?.key || null,
      status,
      savedTrainSessionId: todayFirst?.savedTrainSessionId || null,
      linkedProvider: normaliseStr(todayFirst?.linkedActivity?.provider || ""),
      isRestDay: !session,
      title,
      subtitle,
      focus: rpe ? `${type} · RPE ${rpe}` : focus,
      session,
      badge: !session
        ? "REST"
        : status === "completed"
        ? "COMPLETED"
        : status === "skipped"
        ? "SKIPPED"
        : focusedDay.isToday
        ? "TODAY"
        : "PLANNED",
    };
  }, [focusedDay, todayFirst]);

  const weekTotals = useMemo(() => {
    let sessions = 0;
    let mins = 0;
    let km = 0;
    let completed = 0;
    let skipped = 0;

    week.days?.forEach((d, dayIdx) =>
      d.sessions?.forEach((sess, sessIdx) => {
        sessions += 1;
        const duration =
          sess.workout?.totalDurationSec != null
            ? sess.workout.totalDurationSec / 60
            : sess.targetDurationMin ?? sess.durationMin ?? 0;

        const dist =
          sess.workout?.totalDistanceKm != null
            ? sess.workout.totalDistanceKm
            : sess.targetDistanceKm ?? sess.distanceKm ?? sess.plannedDistanceKm ?? 0;

        mins += Number(duration || 0);
        km += Number(dist || 0);

        const keyPlanId = sess?.__sourcePlanId || plan?.id || null;
        const keyWeekIndex =
          Number.isFinite(Number(sess?.__sourceWeekIndex))
            ? Number(sess.__sourceWeekIndex)
            : currentWeekIndex;
        const keyDayIndex =
          Number.isFinite(Number(sess?.__sourceDayIndex))
            ? Number(sess.__sourceDayIndex)
            : dayIdx;
        const keySessionIndex =
          Number.isFinite(Number(sess?.__sourceSessionIndex))
            ? Number(sess.__sourceSessionIndex)
            : sessIdx;
        const key = keyPlanId
          ? buildSessionKey(keyPlanId, keyWeekIndex, keyDayIndex, keySessionIndex)
          : null;
        const status = resolveSessionLogStatus(key ? sessionLogMap[key] : null);
        if (status === "completed") completed += 1;
        if (status === "skipped") skipped += 1;
      })
    );

    return {
      sessions,
      mins: Math.round(mins),
      km: Number(km.toFixed(1)),
      completed,
      skipped,
      resolved: completed + skipped,
      pending: Math.max(sessions - completed - skipped, 0),
    };
  }, [currentWeekIndex, plan?.id, sessionLogMap, week]);

  const nextSession = useMemo(() => {
    if (!hasPlan || !focusedDay) return null;
    const todayIdx = typeof focusedDay.dayIdx === "number" ? focusedDay.dayIdx : 0;

    for (let offset = 1; offset < 7; offset += 1) {
      const idx = (todayIdx + offset) % 7;
      const day = weekGrid[idx];
      const { card } = pickPriorityCard(day?.cards);
      if (card && !isResolvedSessionStatus(card?.status)) {
        return {
          ...card,
          dayLabel: day.dayLabel,
          dateShort: day.dateShort,
          dayIdx: day.dayIdx,
          isoDate: day.isoDate,
        };
      }
    }
    return null;
  }, [hasPlan, focusedDay, weekGrid]);

  const planProgress = useMemo(() => {
    if (!visibleWeeksCount) return 0;
    return Math.min(100, Math.round(((currentWeekIndex + 1) / visibleWeeksCount) * 100));
  }, [currentWeekIndex, visibleWeeksCount]);

  const heroPlanTitle = useMemo(() => {
    if (!hasPlan) return "Training Plan";
    if (hasRunPlan && hasStrengthPlan) return "Run + Strength";
    return plan?.name || companionPlan?.name || "Training Plan";
  }, [hasPlan, hasRunPlan, hasStrengthPlan, plan?.name, companionPlan?.name]);

  const heroActivityLabel = useMemo(() => {
    const parts = [];
    if (hasRunPlan) parts.push("Run");
    if (hasStrengthPlan) parts.push("Strength");
    if (!parts.length) parts.push(plan?.primaryActivity || companionPlan?.primaryActivity || "Training");
    return parts.join(" + ");
  }, [
    hasRunPlan,
    hasStrengthPlan,
    plan?.primaryActivity,
    companionPlan?.primaryActivity,
  ]);

  const dynamicSubtitle = useMemo(() => {
    if (loading) return "Loading your training";
    if (!hasPlan) return "No active plan yet";
    if (todayHero?.status === "completed") {
      return `${todayHero.dayLabel || "Selected day"} is complete · ${weekTotals.resolved}/${weekTotals.sessions} sessions marked this week`;
    }
    if (todayHero?.status === "skipped") {
      return `${todayHero.dayLabel || "Selected day"} was skipped · ${weekTotals.resolved}/${weekTotals.sessions} sessions marked this week`;
    }
    if (!todayFirst && nextSession) {
      return `${todayHero?.dayLabel || "Selected day"} is light. Next up: ${nextSession.dayLabel} · ${nextSession.title}`;
    }
    return `${todayFirst ? `${todayHero?.dayLabel || "Day"} is set` : `No session on ${todayHero?.dayLabel || "selected day"}`} · ${weekTotals.sessions} sessions this week`;
  }, [
    hasPlan,
    loading,
    nextSession,
    todayFirst,
    todayHero?.dayLabel,
    todayHero?.status,
    weekTotals.resolved,
    weekTotals.sessions,
  ]);

  const headerContextChip = useMemo(() => {
    if (loading) return "Loading";
    if (!hasPlan) return "No active plan";
    if (hasRunPlan && hasStrengthPlan) return "2 plans running";
    return "Active plan";
  }, [loading, hasPlan, hasRunPlan, hasStrengthPlan]);

  const headerContextMeta = useMemo(() => {
    const nowLabel = new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const selectedDate = focusedDay?.dateLabel || nowLabel;
    if (!hasPlan) return selectedDate;
    return `${selectedDate} · Week ${currentWeekIndex + 1} of ${visibleWeeksCount || 1}`;
  }, [hasPlan, currentWeekIndex, visibleWeeksCount, focusedDay?.dateLabel]);

  const todayHeroSupport = useMemo(() => {
    if (todayHero?.status === "completed") {
      const provider = todayHero?.linkedProvider ? ` via ${todayHero.linkedProvider}` : "";
      const nextLine = nextSession ? ` Next planned: ${nextSession.dayLabel} · ${nextSession.title}.` : "";
      return `This planned session has been completed${provider} and saved to history.${nextLine}`;
    }
    if (todayHero?.status === "skipped") {
      const nextLine = nextSession ? ` Next planned: ${nextSession.dayLabel} · ${nextSession.title}.` : "";
      return `This planned session has been marked as skipped and saved to history.${nextLine}`;
    }
    if (!todayHero?.session) {
      if (nextSession) {
        return `${todayHero?.dayLabel || "Selected day"} is recovery-focused. Next planned: ${nextSession.dayLabel} · ${nextSession.title}.`;
      }
      return `No structured session on ${todayHero?.dayLabel || "this day"}. Use quick log if you train.`;
    }
    return (
      todayHero?.subtitle ||
      todayHero?.focus ||
      "Hit the main objective for this session and keep execution controlled."
    );
  }, [todayHero, nextSession]);

  const extraDaySessions = useMemo(() => {
    if (!focusedDayCards.length || focusedDayCards.length < 2) return [];
    return focusedDayCards.filter((_, idx) => idx !== todayFirstIndex);
  }, [focusedDayCards, todayFirstIndex]);

  const topFadeStart = useMemo(() => {
    const alpha = theme.isDark ? "33" : "55";
    const resolved = withHexAlpha(theme.primaryBg, alpha);
    if (resolved !== theme.primaryBg) return resolved;
    return theme.isDark ? "rgba(230,255,59,0.2)" : "rgba(230,255,59,0.3)";
  }, [theme.isDark, theme.primaryBg]);

  const progressStateLabel = useMemo(() => {
    if (!hasPlan) return "Not started";
    if (weekTotals.sessions && weekTotals.pending === 0) return "Week complete";
    if (weekTotals.resolved > 0) return `${weekTotals.resolved}/${weekTotals.sessions} done`;
    const pct = Number(planProgress || 0);
    if (pct >= 75) return "Ahead";
    if (pct >= 35) return "On track";
    return "Building";
  }, [hasPlan, planProgress, weekTotals.pending, weekTotals.resolved, weekTotals.sessions]);

  const sampleCategories = useMemo(
    () => [
      { key: "all", label: "All" },
      { key: "running", label: "Running" },
      { key: "strength", label: "Strength" },
      { key: "hybrid", label: "Hybrid" },
      { key: "recovery", label: "Recovery" },
    ],
    []
  );
  const visibleSamples = useMemo(() => {
    if (sampleCategory === "all") return SAMPLE_WORKOUTS;
    return SAMPLE_WORKOUTS.filter((w) => w.category === sampleCategory);
  }, [sampleCategory]);
  const recommendedSample = useMemo(() => {
    if (!visibleSamples.length) return null;
    if (sampleCategory !== "all") return visibleSamples[0];

    const day = new Date().getDay();
    const preferredCategory =
      day === 0 || day === 1
        ? "recovery"
        : day === 2 || day === 4
        ? "strength"
        : day === 3
        ? "hybrid"
        : "running";

    return (
      visibleSamples.find((w) => w.category === preferredCategory) ||
      visibleSamples.find((w) => w.category === "running") ||
      visibleSamples[0]
    );
  }, [sampleCategory, visibleSamples]);
  const orderedSamples = useMemo(() => {
    if (!recommendedSample) return visibleSamples;
    return [recommendedSample, ...visibleSamples.filter((w) => w.key !== recommendedSample.key)];
  }, [recommendedSample, visibleSamples]);
  const sampleRecommendationReason = useMemo(() => {
    if (!recommendedSample) return "";
    if (recommendedSample.category === "recovery") return "Low-stress option to stay consistent today.";
    if (recommendedSample.category === "strength") return "Good day to keep strength momentum without overthinking.";
    if (recommendedSample.category === "hybrid") return "Balanced engine and strength mix for a quick quality hit.";
    return "Simple aerobic choice to keep your week moving.";
  }, [recommendedSample]);
  const selectedRecordSample = useMemo(
    () => SAMPLE_WORKOUTS.find((w) => w.key === recordSeedSampleKey) || null,
    [recordSeedSampleKey]
  );
  const activeTipTopic = useMemo(
    () => TRAINING_TIP_TOPICS.find((t) => t.key === tipTopicKey) || TRAINING_TIP_TOPICS[0],
    [tipTopicKey]
  );

  const insight = useMemo(() => {
    if (!hasPlan) {
      return {
        title: "Start simple",
        body: "Log one session or use a sample workout today. Build structure once your routine settles.",
      };
    }

    if (!todayFirst && nextSession) {
      return {
        title: `Light ${String(todayHero?.dayLabel || "day").toLowerCase()}`,
        body: `Your next planned session is ${nextSession.dayLabel} · ${nextSession.title}.`,
      };
    }

    if (weekTotals.sessions >= 5) {
      return {
        title: "Big week ahead",
        body: `You’ve got ${weekTotals.sessions} sessions planned. Focus on consistency, not perfection.`,
      };
    }

    return {
      title: "Keep momentum",
      body: `${weekTotals.sessions} sessions planned this week. Nail ${String(todayHero?.dayLabel || "this day").toLowerCase()}, then build from there.`,
    };
  }, [hasPlan, todayFirst, nextSession, weekTotals.sessions, todayHero?.dayLabel]);

  const openDaySheet = useCallback((idx) => {
    setDaySheetIndex(idx);
    setDaySheetOpen(true);
  }, []);

  const closeDaySheet = useCallback(() => setDaySheetOpen(false), []);
  const closeQuickRecord = useCallback(() => {
    setRecordOpen(false);
    setRecordSeedSampleKey("");
  }, []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeTips = useCallback(() => setTipsOpen(false), []);

  const openQuickRecord = useCallback(
    (dayIdx) => {
      setRecordDayIndex(dayIdx);
      setRecordType("run");

      const day = weekGrid?.[dayIdx];
      const defaultTitle =
        day?.cards?.[0]?.title ||
        (day?.dayLabel === "Sat" || day?.dayLabel === "Sun" ? "Training" : "Session");

      setRecordSeedSampleKey("");
      setRecordTitle(defaultTitle);
      setRecordDurationMin("");
      setRecordDistanceKm("");
      setRecordRpe("");
      setRecordNotes("");
      setRecordOpen(true);
    },
    [weekGrid]
  );

  const handleHeaderDayPress = useCallback(
    (item) => {
      const idx = Number.isInteger(item?.dayIdx) ? item.dayIdx : 0;
      setSelectedDayIndex(idx);
    },
    []
  );

  const applySampleWorkout = useCallback(
    (sample) => {
      const dayIdx = Number.isInteger(focusedDay?.dayIdx) ? focusedDay.dayIdx : 0;
      setRecordDayIndex(dayIdx);
      setRecordType(mapSampleTypeToRecordType(sample?.type));
      setRecordTitle(sample?.title || "Sample workout");
      setRecordDurationMin(sample?.durationMin ? String(sample.durationMin) : "");
      setRecordDistanceKm(
        Number.isFinite(Number(sample?.distanceKm)) ? String(sample.distanceKm) : ""
      );
      setRecordRpe(sample?.rpe ? String(sample.rpe) : "");
      setRecordNotes(sample?.notes || "");
      setRecordSeedSampleKey(sample?.key || "");
      setRecordOpen(true);
    },
    [focusedDay?.dayIdx]
  );

  const saveQuickRecord = useCallback(async () => {
    try {
      setSavingQuick(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Not signed in");

      const day = weekGrid?.[recordDayIndex];
      const isoDate = day?.isoDate || toISODate(new Date());

      const t = String(recordType || "run").toLowerCase();
      const sport = t === "run" ? "run" : t === "gym" ? "gym" : "training";

      const durationMin = Number(recordDurationMin || 0) || null;
      const distanceKm = Number(recordDistanceKm || 0) || null;
      const avgRPE = Number(recordRpe || 0) || null;

      const title =
        normaliseStr(recordTitle) ||
        (t === "run" ? "Run" : t === "gym" ? "Gym" : "Training");

      const payload = {
        date: isoDate,
        title,
        planId: plan?.id || null,
        planName: plan?.name || null,
        primaryActivity: plan?.primaryActivity || null,
        status: "completed",
        source: "quick_log",
        actualDurationMin: durationMin,
        actualDistanceKm: distanceKm,
        avgRPE: avgRPE,
        notes: recordNotes || "",
        sessionType: sport,
        workout: {
          sport,
          totalDurationSec: durationMin ? Math.round(durationMin * 60) : 0,
          totalDistanceKm: distanceKm ? Number(distanceKm.toFixed(3)) : 0,
          steps: [],
        },
        createdAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "users", uid, "trainSessions"), payload);

      closeQuickRecord();
      Alert.alert("Saved", "Session logged to history.");
    } catch (e) {
      Alert.alert("Couldn’t save", e?.message || "Try again.");
    } finally {
      setSavingQuick(false);
    }
  }, [
    closeQuickRecord,
    plan?.id,
    plan?.name,
    plan?.primaryActivity,
    recordDayIndex,
    recordDistanceKm,
    recordDurationMin,
    recordNotes,
    recordRpe,
    recordTitle,
    recordType,
    weekGrid,
  ]);

  const handleSendTodayToWatch = useCallback(async () => {
    if (!plan || !todayHero || todayHero.isRestDay || !todayHero.key) return;

    try {
      setSendingToWatch(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("No user");

      const sess = todayHero.session;
      if (!sess?.workout) throw new Error("No workout data");

      const payload = {
        userId: uid,
        sessionKey: todayHero.key,
        title: todayHero.title,
        workout: sess.workout,
      };

      const res = await fetch(`${API_URL}/garmin/send-workout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to send workout");
      Alert.alert("Sent", "Workout sent to your watch.");
    } catch (e) {
      Alert.alert("Couldn’t send to watch", e?.message || "Try again.");
    } finally {
      setSendingToWatch(false);
    }
  }, [plan, todayHero]);

  const openPrimaryPlan = useCallback(() => {
    if (plan?.id) {
      router.push({ pathname: "/train/view-plan", params: { planId: plan.id } });
      return;
    }
    router.push("/train/view-plan");
  }, [plan?.id, router]);

  const activeDay = useMemo(() => weekGrid?.[daySheetIndex] || null, [weekGrid, daySheetIndex]);
  const openPlannedCard = useCallback(
    (card, fallbackDayIdx = null) => {
      if (card?.savedTrainSessionId && isResolvedSessionStatus(card?.status)) {
        router.push(`/train/history/${card.savedTrainSessionId}`);
        return;
      }
      if (card?.key) {
        goToSession(card.key);
        return;
      }
      if (Number.isInteger(fallbackDayIdx)) {
        openDaySheet(fallbackDayIdx);
      }
    },
    [goToSession, openDaySheet, router]
  );

  const todayHeroPrimaryLabel = useMemo(() => {
    if (todayHero?.status && todayHero?.savedTrainSessionId) return "View session";
    if (todayHero?.key) return "Start session";
    return "Log session";
  }, [todayHero?.key, todayHero?.savedTrainSessionId, todayHero?.status]);

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: theme.bg }}>
      <LinearGradient
        colors={[topFadeStart, theme.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topBackgroundFade}
        pointerEvents="none"
      />
      <ScrollView contentContainerStyle={s.pageContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerTopRow}>
            <Text style={[s.headerTitle, { color: theme.headerTitle }]}>Train</Text>
            <View style={[s.headerContextChip, { backgroundColor: theme.card2, borderColor: theme.border }]}>
              <Text style={[s.headerContextChipText, { color: theme.text }]}>{headerContextChip}</Text>
            </View>
          </View>
          <Text style={[s.headerSubtitle, { color: theme.headerSubtitle }]}>{dynamicSubtitle}</Text>
          <View style={s.headerMetaRow}>
            <Feather name="calendar" size={13} color={theme.subtext} />
            <Text style={[s.headerMetaText, { color: theme.subtext }]}>{headerContextMeta}</Text>
          </View>

          {hasPlan ? (
            <View style={s.headerWeekRow}>
              <Text style={[s.headerWeekLabel, { color: theme.subtext }]}>
                Week {currentWeekIndex + 1} of {visibleWeeksCount || 1}
                {week?.title ? ` · ${week.title}` : ""}
              </Text>
              <View style={s.weekControls}>
                <TouchableOpacity
                  onPress={() => shiftWeek(-1)}
                  disabled={currentWeekIndex === 0}
                  style={[
                    s.weekNav,
                    { borderColor: theme.border, backgroundColor: theme.card2, opacity: currentWeekIndex === 0 ? 0.45 : 1 },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-left" size={16} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => shiftWeek(1)}
                  disabled={currentWeekIndex >= (visibleWeeksCount || 1) - 1}
                  style={[
                    s.weekNav,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.card2,
                      opacity: currentWeekIndex >= (visibleWeeksCount || 1) - 1 ? 0.45 : 1,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-right" size={16} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={jumpForwardWeeks}
                  disabled={currentWeekIndex >= (visibleWeeksCount || 1) - 1}
                  style={[
                    s.weekJump,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.card2,
                      opacity: currentWeekIndex >= (visibleWeeksCount || 1) - 1 ? 0.45 : 1,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Text style={[s.weekJumpText, { color: theme.text }]}>+4 wk</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View
            style={[s.noPlanWeekStrip, hasPlan ? s.activePlanWeekStrip : null]}
            onLayout={(e) => {
              const w = Number(e?.nativeEvent?.layout?.width || 0);
              if (w > 0 && Math.abs(w - weekStripWidth) > 1) {
                setWeekStripWidth(w);
              }
            }}
            {...(hasPlan ? weekSwipeResponder.panHandlers : {})}
          >
            <Animated.View
              style={[
                s.weekCarouselTrack,
                {
                  width: weekPanelWidth * 3,
                  transform: [{ translateX: weekCarouselTranslateX }],
                },
              ]}
            >
              {weekCarouselPanels.map((panel) => (
                <View
                  key={`${panel.id}-${panel.weekIndex}`}
                  style={[s.weekCarouselPanel, { width: weekPanelWidth }]}
                >
                  {panel.grid.map((item) => {
                    const dayNum = new Date(item.date).getDate();
                    const sessionCount = Array.isArray(item.cards) ? item.cards.length : 0;
                    const hasSessions = sessionCount > 0;
                    const isToday = !!item.isToday;
                    const isSelected = item.dayIdx === selectedDayIndex;
                    const visibleDots = hasSessions ? Math.min(sessionCount, 3) : 0;
                    const sessionSummary = item.sessionSummary || summariseCardStatuses(item.cards);
                    const allResolved = hasSessions && sessionSummary.pending === 0;
                    return (
                      <TouchableOpacity
                        key={`${panel.id}-${item.isoDate}`}
                        style={s.noPlanWeekDay}
                        onPress={() => handleHeaderDayPress(item)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            s.noPlanWeekDow,
                            {
                              color: isSelected || isToday ? theme.text : theme.subtext,
                              opacity: hasPlan && !isSelected && !isToday && !hasSessions ? 0.7 : 1,
                            },
                          ]}
                        >
                          {String(item.dayLabel || "").toUpperCase()}
                        </Text>
                        <View
                          style={[
                            s.noPlanWeekDateWrap,
                            isSelected
                              ? {
                                  backgroundColor: hasPlan ? theme.primaryBg : theme.text,
                                  borderColor: hasPlan ? theme.primaryBg : theme.text,
                                }
                              : hasPlan
                                ? {
                                    backgroundColor: allResolved
                                      ? withHexAlpha(theme.primaryBg, theme.isDark ? "1A" : "26")
                                      : hasSessions
                                      ? theme.card2
                                      : "transparent",
                                    borderColor: allResolved
                                      ? theme.primaryBg
                                      : hasSessions || isToday
                                      ? theme.border
                                      : "transparent",
                                  }
                                : { backgroundColor: "transparent", borderColor: "transparent" },
                          ]}
                        >
                          <Text
                            style={[
                              s.noPlanWeekDate,
                              {
                                color: isSelected
                                  ? hasPlan
                                    ? theme.primaryText
                                    : theme.bg
                                  : hasPlan && !hasSessions
                                    ? theme.subtext
                                    : theme.text,
                              },
                            ]}
                          >
                            {dayNum}
                          </Text>
                        </View>
                        <View style={s.noPlanWeekSessionMarkerRow}>
                          {hasSessions
                            ? item.cards.slice(0, visibleDots).map((card, dotIdx) => {
                                const status = String(card?.status || "").toLowerCase();
                                const dotColor =
                                  status === "completed"
                                    ? theme.primaryBg
                                    : status === "skipped"
                                    ? "#F87171"
                                    : isSelected || isToday
                                    ? theme.primaryBg
                                    : theme.text;

                                return (
                                  <View
                                    key={`${panel.id}-${item.isoDate}-dot-${dotIdx}`}
                                    style={[
                                      s.noPlanWeekSessionDot,
                                      {
                                        backgroundColor: dotColor,
                                        opacity: isSelected ? 1 : isToday ? 0.95 : 0.82,
                                      },
                                    ]}
                                  />
                                );
                              })
                            : null}
                          {sessionCount > 3 ? (
                            <Text style={[s.noPlanWeekSessionMoreText, { color: theme.subtext }]}>
                              +{sessionCount - 3}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </Animated.View>
          </View>
        </View>

        {/* Today hero */}
        <View style={s.heroWrap}>
          <LinearGradient
            colors={["transparent", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              s.hero,
              hasPlan ? s.heroNoBg : s.heroNoBlock,
              { borderColor: "transparent" },
            ]}
          >
            {hasPlan ? (
              <>
                <View style={s.heroStatusRow}>
                  <Text style={[s.heroDate, { color: theme.subtext }]}>
                    {todayHero?.dateLabel || headerContextMeta}
                  </Text>
                  {todayHero?.badge ? (
                    <View
                      style={[
                        s.badge,
                        {
                          backgroundColor:
                            todayHero.badge === "COMPLETED"
                              ? withHexAlpha(theme.primaryBg, theme.isDark ? "20" : "2B")
                              : todayHero.badge === "SKIPPED"
                              ? "rgba(248,113,113,0.16)"
                              : theme.card2,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor:
                            todayHero.badge === "COMPLETED"
                              ? withHexAlpha(theme.primaryBg, theme.isDark ? "7A" : "A3")
                              : todayHero.badge === "SKIPPED"
                              ? "rgba(248,113,113,0.45)"
                              : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          s.badgeText,
                          {
                            color:
                              todayHero.badge === "COMPLETED"
                                ? theme.primaryBg
                                : todayHero.badge === "SKIPPED"
                                ? "#F87171"
                                : theme.text,
                          },
                        ]}
                      >
                        {todayHero.badge}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[s.heroTitle, s.heroTitleTight, { color: theme.text }]} numberOfLines={2}>
                  {todayHero?.title || "Rest / optional movement"}
                </Text>
                <Text style={[s.heroSupport, s.heroSupportTight, { color: theme.subtext }]} numberOfLines={2}>
                  {todayHeroSupport}
                </Text>

                <View style={[s.heroActions, s.heroActionsTight]}>
                  <TouchableOpacity
                    onPress={() => {
                      if (todayHero?.status && todayHero?.savedTrainSessionId) {
                        router.push(`/train/history/${todayHero.savedTrainSessionId}`);
                        return;
                      }
                      if (todayHero?.key) return goToSession(todayHero.key);
                      openQuickRecord(focusedDay ? focusedDay.dayIdx : 0);
                    }}
                    style={[s.primaryBtn, { backgroundColor: theme.primaryBg, flex: 1 }]}
                    activeOpacity={0.9}
                  >
                    <Feather
                      name={
                        todayHero?.status && todayHero?.savedTrainSessionId
                          ? "arrow-up-right"
                          : todayHero?.key
                          ? "play"
                          : "plus-circle"
                      }
                      size={16}
                      color={theme.primaryText}
                    />
                    <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>
                      {todayHeroPrimaryLabel}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={openPrimaryPlan}
                    style={[s.secondaryBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="calendar" size={14} color={theme.text} />
                    <Text style={[s.secondaryBtnText, { color: theme.text }]}>Open plan</Text>
                  </TouchableOpacity>
                </View>

                {extraDaySessions.length ? (
                  <View style={s.heroExtraSessionsWrap}>
                    {extraDaySessions.slice(0, 2).map((card, idx) => {
                      const extraSupport = normaliseStr(
                        card?.meta || getSessionGuidance(card?.sess) || sessionTypeLabel(card?.sess)
                      );
                      return (
                        <View
                          key={`hero-extra-session-${card.key || card.title}-${idx}`}
                          style={[s.heroExtraSessionBlock, { borderTopColor: theme.border }]}
                        >
                          <Text style={[s.heroDate, { color: theme.subtext }]}>
                            {todayHero?.dateLabel || headerContextMeta}
                          </Text>
                          <Text style={[s.heroExtraSessionTitle, { color: theme.text }]} numberOfLines={2}>
                            {card?.title || "Session"}
                          </Text>
                          {!!extraSupport ? (
                            <Text style={[s.heroExtraSessionSupport, { color: theme.subtext }]} numberOfLines={2}>
                              {extraSupport}
                            </Text>
                          ) : null}

                          <View style={s.heroExtraSessionActions}>
                            <TouchableOpacity
                              onPress={() => openPlannedCard(card, focusedDay ? focusedDay.dayIdx : 0)}
                              style={[s.primaryBtn, { backgroundColor: theme.primaryBg, flex: 1 }]}
                              activeOpacity={0.9}
                            >
                              <Feather
                                name={
                                  card?.savedTrainSessionId && isResolvedSessionStatus(card?.status)
                                    ? "arrow-up-right"
                                    : "play"
                                }
                                size={16}
                                color={theme.primaryText}
                              />
                              <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>
                                {card?.savedTrainSessionId && isResolvedSessionStatus(card?.status)
                                  ? "View session"
                                  : "Start session"}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={openPrimaryPlan}
                              style={[s.secondaryBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                              activeOpacity={0.85}
                            >
                              <Feather name="calendar" size={14} color={theme.text} />
                              <Text style={[s.secondaryBtnText, { color: theme.text }]}>Open plan</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                    {extraDaySessions.length > 2 ? (
                      <Text style={[s.heroExtraSessionsMoreText, { color: theme.subtext }]}>
                        +{extraDaySessions.length - 2} more on this day
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Text style={[s.heroDate, { color: theme.subtext }]}>{headerContextMeta}</Text>
                <Text style={[s.heroTitle, { color: theme.text }]}>Start your training block</Text>
                <Text style={[s.heroSupport, { color: theme.subtext }]}>
                  Build a full plan or quickly log a sample session today.
                </Text>

                <View style={s.heroActions}>
                  <TouchableOpacity
                    onPress={() => router.push("/train/create-home")}
                    style={[s.primaryBtn, { backgroundColor: theme.primaryBg, flex: 1 }]}
                    activeOpacity={0.9}
                  >
                    <Feather name="sparkles" size={16} color={theme.primaryText} />
                    <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>Create plan</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                    style={[s.secondaryBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="plus-circle" size={14} color={theme.text} />
                    <Text style={[s.secondaryBtnText, { color: theme.text }]}>Quick log</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </LinearGradient>
        </View>

        {hasPlan ? (
          <>
            {/* Up next */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Up next</Text>
              {nextSession ? (
                <TouchableOpacity
                  onPress={() => (nextSession.key ? goToSession(nextSession.key) : openDaySheet(nextSession.dayIdx))}
                  activeOpacity={0.85}
                  style={[s.sessionRow, { marginTop: 8, backgroundColor: theme.card2, borderColor: theme.border }]}
                >
                  <View style={[s.sessionIcon, { borderColor: theme.border }]}>
                    <Feather name={typeIconName(nextSession.sess)} size={16} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: "600" }}>
                      {nextSession.dayLabel} · {nextSession.dateShort}
                    </Text>
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700", marginTop: 4 }} numberOfLines={1}>
                      {nextSession.title}
                    </Text>
                    {!!nextSession.meta ? (
                      <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 4 }}>{nextSession.meta}</Text>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.subtext} />
                </TouchableOpacity>
              ) : (
                <View style={[s.restCard, { marginTop: 8, borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>No next session scheduled</Text>
                  <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12 }}>
                    If you train today, use Quick log to keep your record complete.
                  </Text>
                </View>
              )}
            </View>

            {/* Plan progress */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Plan progress</Text>
              <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={s.progressTopRow}>
                  <View style={s.progressPlanCol}>
                    <Text style={[s.progressKicker, { color: theme.subtext }]}>Active block</Text>
                    <Text style={[s.progressPlanName, { color: theme.text }]} numberOfLines={1}>
                      {plan.name || "Training Plan"}
                    </Text>
                    <Text style={[s.progressPlanMeta, { color: theme.subtext }]}>
                      Week {currentWeekIndex + 1} · {heroActivityLabel}
                    </Text>
                  </View>

                  <View style={[s.progressPercentChip, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                    <Text style={[s.progressPercentValue, { color: theme.text }]}>{planProgress}%</Text>
                    <Text style={[s.progressPercentLabel, { color: theme.subtext }]}>complete</Text>
                  </View>
                </View>

                <View style={s.progressMetaRow}>
                  <View style={[s.progressStateChip, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                    <Text style={[s.progressStateText, { color: theme.text }]}>{progressStateLabel}</Text>
                  </View>
                  <Text style={[s.progressLabel, { color: theme.subtext }]}>Estimated block completion</Text>
                </View>

                <View style={[s.progressTrack, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                  <View style={[s.progressFill, { backgroundColor: theme.primaryBg, width: `${planProgress}%` }]} />
                </View>

                <View style={s.progressStatsRow}>
                  <View style={[s.progressStatCard, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                    <Text style={[s.progressStatValue, { color: theme.text }]}>{weekTotals.sessions}</Text>
                    <Text style={[s.progressStatLabel, { color: theme.subtext }]}>Sessions</Text>
                  </View>
                  <View style={[s.progressStatCard, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                    <Text style={[s.progressStatValue, { color: theme.text }]}>{weekTotals.mins}</Text>
                    <Text style={[s.progressStatLabel, { color: theme.subtext }]}>Minutes</Text>
                  </View>
                  <View style={[s.progressStatCard, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                    <Text style={[s.progressStatValue, { color: theme.text }]}>{`${weekTotals.km} km`}</Text>
                    <Text style={[s.progressStatLabel, { color: theme.subtext }]}>Distance</Text>
                  </View>
                </View>

                <Text style={[s.progressHint, { color: theme.subtext }]}>
                  Progress is based on week position in this block. {weekTotals.resolved}/{weekTotals.sessions} sessions are marked this week.
                </Text>
              </View>
            </View>

            {/* Coach insight */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Coach insight</Text>
              <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <View style={s.cardHeadRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardTitle, { color: theme.text }]}>{insight.title}</Text>
                    <Text style={{ color: theme.subtext, marginTop: 6, fontSize: 13, lineHeight: 20 }}>
                      {insight.body}
                    </Text>
                  </View>
                  <View style={[s.insightIconWrap, { backgroundColor: theme.primaryBg }]}>
                    <Feather name="message-circle" size={15} color={theme.primaryText} />
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <ActionRowButton
                    icon="message-circle"
                    label="Ask coach"
                    theme={theme}
                    onPress={() => router.push("/chat")}
                  />
                  <ActionRowButton
                    icon="plus-circle"
                    label="Quick log"
                    theme={theme}
                    onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                  />
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            {/* Sample workouts */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Sample workouts</Text>
              <Text style={[s.sampleIntro, { color: theme.subtext }]}>
                Pick one structured sample and log it in seconds.
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sampleTabRow}>
                {sampleCategories.map((cat) => {
                  const active = sampleCategory === cat.key;
                  return (
                    <TouchableOpacity
                      key={`sample-tab-${cat.key}`}
                      onPress={() => setSampleCategory(cat.key)}
                      style={[
                        s.sampleTab,
                        active
                          ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
                          : { backgroundColor: theme.card2, borderColor: theme.border },
                      ]}
                      activeOpacity={0.85}
                    >
                      <Text style={{ color: active ? theme.primaryText : theme.subtext, fontWeight: active ? "700" : "600", fontSize: 12 }}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.noPlanCarouselRow}>
                {orderedSamples.map((sample, idx) => {
                  const isRecommended = idx === 0 && sample.key === recommendedSample?.key;
                  return (
                    <View
                      key={sample.key}
                      style={[s.sampleFeaturedCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    >
                      <View style={s.sampleFeaturedTop}>
                        <View style={[s.sampleTypePill, { borderColor: theme.border, backgroundColor: theme.card }]}>
                          <Feather name={sampleIconName(sample.type)} size={13} color={theme.text} />
                          <Text style={[s.sampleTypeText, { color: theme.text }]}>{sample.type}</Text>
                        </View>
                        {isRecommended ? (
                          <Text style={[s.sampleRecoLabel, { color: theme.subtext }]}>Recommended today</Text>
                        ) : null}
                      </View>

                      <Text style={[s.sampleFeaturedTitle, { color: theme.text }]} numberOfLines={2}>
                        {sample.title}
                      </Text>
                      <Text style={[s.sampleFeaturedSummary, { color: theme.subtext }]} numberOfLines={2}>
                        {sample.summary || sample.notes}
                      </Text>
                      <Text style={[s.sampleBestFor, { color: theme.subtext }]} numberOfLines={1}>
                        {sample.durationMin} min · {sampleSecondaryMeta(sample)} · RPE {sample.rpe}
                      </Text>

                      <TouchableOpacity
                        onPress={() => applySampleWorkout(sample)}
                        style={[s.samplePrimaryCta, { backgroundColor: theme.primaryBg }]}
                        activeOpacity={0.9}
                      >
                        <Feather name="plus-circle" size={15} color={theme.primaryText} />
                        <Text style={[s.samplePrimaryCtaText, { color: theme.primaryText }]}>Use sample</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* Guided get started */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Get started</Text>
              <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[s.cardTitle, { color: theme.text }]}>One simple next step</Text>
                <Text style={{ color: theme.subtext, marginTop: 6, fontSize: 13, lineHeight: 20 }}>
                  {NO_PLAN_NOTE}
                </Text>

                <TouchableOpacity
                  onPress={() => router.push("/train/create-home")}
                  style={[s.primaryBtn, { backgroundColor: theme.primaryBg, marginTop: 14 }]}
                  activeOpacity={0.9}
                >
                  <Feather name="sparkles" size={16} color={theme.primaryText} />
                  <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>Create my first plan</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                  style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, marginTop: 10 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={14} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "700" }}>Quick log instead</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* Explore */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={[s.sectionTitle, { color: theme.text }]}>Explore</Text>
            <TouchableOpacity
              onPress={() => setMoreOpen(true)}
              style={[s.coachBrowseBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
              activeOpacity={0.85}
            >
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>More</Text>
              <Feather name="chevron-right" size={13} color={theme.text} />
            </TouchableOpacity>
          </View>
          <Text style={[s.sectionSubtle, { color: theme.subtext }]}>
            Secondary discovery: coach templates and training knowledge.
          </Text>

          <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={s.sectionHead}>
              <Text style={[s.cardTitle, { color: theme.text }]}>Coach set plans</Text>
              <TouchableOpacity
                onPress={() => router.push("/train/coach-plans")}
                style={[s.coachBrowseBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>Browse all</Text>
                <Feather name="chevron-right" size={13} color={theme.text} />
              </TouchableOpacity>
            </View>

            {hasRunPlan && !hasStrengthPlan ? (
              <TouchableOpacity
                onPress={() => router.push("/train/create/create-strength")}
                style={[s.exploreAssistRow, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                activeOpacity={0.85}
              >
                <Feather name="bar-chart-2" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700", flex: 1 }}>
                  Add a strength companion plan to balance your run block.
                </Text>
                <Feather name="chevron-right" size={14} color={theme.subtext} />
              </TouchableOpacity>
            ) : null}
            {hasStrengthPlan && !hasRunPlan ? (
              <TouchableOpacity
                onPress={() => router.push("/train/create/create-run")}
                style={[s.exploreAssistRow, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                activeOpacity={0.85}
              >
                <Feather name="activity" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700", flex: 1 }}>
                  Add a run companion plan to round out weekly conditioning.
                </Text>
                <Feather name="chevron-right" size={14} color={theme.subtext} />
              </TouchableOpacity>
            ) : null}

            {coachPlansLoading ? (
              <View style={s.coachLoadingWrap}>
                <ActivityIndicator />
                <Text style={{ color: theme.subtext, fontWeight: "600", fontSize: 12 }}>Loading coach plans…</Text>
              </View>
            ) : coachPlans.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.coachPlanRow}>
                {coachPlans.map((cp) => {
                  const isRun = cp.kind === "run";
                  const isStrength = cp.kind === "strength";
                  const kindIcon = isRun ? "activity" : isStrength ? "bar-chart-2" : "layers";
                  const kindLabel = isRun ? "Run" : isStrength ? "Strength" : "Training";
                  const isLocalTemplate = cp.sourceCollection === "localTemplates";
                  const isUsing = String(usingCoachPlanId) === String(cp.id);

                  return (
                    <View
                      key={`${cp.sourceCollection}_${cp.id}`}
                      style={[s.coachPlanCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    >
                      <View style={s.coachPlanTop}>
                        <View style={[s.coachTypePill, { backgroundColor: theme.card, borderColor: theme.border }]}>
                          <Feather name={kindIcon} size={12} color={theme.text} />
                          <Text style={[s.coachTypePillText, { color: theme.text }]}>{kindLabel}</Text>
                        </View>
                        <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "600" }} numberOfLines={1}>
                          {cp.coachName}
                        </Text>
                      </View>

                      <Text style={[s.coachPlanName, { color: theme.text }]} numberOfLines={2}>
                        {cp.name}
                      </Text>
                      <Text style={[s.coachPlanMeta, { color: theme.subtext }]}>
                        {cp.weekCount} weeks · {cp.sessionCount} sessions
                      </Text>

                      <View style={s.coachPlanActions}>
                        <TouchableOpacity
                          onPress={() => viewCoachPlan(cp)}
                          style={[s.coachActionBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
                          activeOpacity={0.85}
                        >
                          <Feather name="eye" size={13} color={theme.text} />
                          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>View</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() =>
                            isLocalTemplate
                              ? router.push({
                                  pathname: "/train/coach-plan-preview",
                                  params: { templateId: cp.id },
                                })
                              : useCoachPlan(cp)
                          }
                          disabled={isUsing}
                          style={[
                            s.coachActionBtn,
                            {
                              borderColor: "rgba(0,0,0,0)",
                              backgroundColor: theme.primaryBg,
                              opacity: isUsing ? 0.7 : 1,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          {isUsing ? (
                            <ActivityIndicator size="small" color={theme.primaryText} />
                          ) : (
                            <Feather
                              name={isLocalTemplate ? "sliders" : "plus"}
                              size={13}
                              color={theme.primaryText}
                            />
                          )}
                          <Text style={{ color: theme.primaryText, fontWeight: "700", fontSize: 12 }}>
                            {isUsing ? "Adding…" : isLocalTemplate ? "Personalise" : "Use"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={[s.restCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>No coach plans published</Text>
                <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12 }}>
                  Coach-set templates will appear here as they’re published.
                </Text>
              </View>
            )}
          </View>

          <View style={s.exploreTipsBlock}>
            <View style={s.sectionHead}>
              <Text style={[s.cardTitle, { color: theme.text }]}>Training tips</Text>
              <TouchableOpacity
                onPress={() => setTipsOpen(true)}
                style={[s.coachBrowseBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>Open guide</Text>
                <Feather name="chevron-right" size={13} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tipCardRow}>
              {TRAINING_TIP_TOPICS.slice(0, 6).map((topic) => (
                <TouchableOpacity
                  key={`tip-card-preview-${topic.key}`}
                  onPress={() => {
                    setTipTopicKey(topic.key);
                    setTipsOpen(true);
                  }}
                  style={s.tipCard}
                  activeOpacity={0.85}
                >
                  <Image source={topic.image} style={s.tipCardImage} resizeMode="cover" />
                  <View style={s.tipCardOverlay} />
                  <Text style={s.tipCardTitle} numberOfLines={2}>
                    {topic.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </ScrollView>

      {/* More actions sheet */}
      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={closeMore}>
        <View style={s.modalBackdrop}>
          <View style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>More actions</Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    Quick actions without cluttering the page
                  </Text>
                </View>

                <TouchableOpacity onPress={closeMore} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <View style={{ gap: 10, marginTop: 12 }}>
                <Text style={[s.sheetGroupTitle, { color: theme.subtext }]}>Training</Text>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    openQuickRecord(focusedDay ? focusedDay.dayIdx : 0);
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Quick log</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    openPrimaryPlan();
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="calendar" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Open full plan</Text>
                </TouchableOpacity>

                {hasRunPlan && !hasStrengthPlan ? (
                  <TouchableOpacity
                    onPress={() => {
                      closeMore();
                      router.push("/train/create/create-strength");
                    }}
                    style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="bar-chart-2" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>Add strength plan</Text>
                  </TouchableOpacity>
                ) : null}
                {hasStrengthPlan && !hasRunPlan ? (
                  <TouchableOpacity
                    onPress={() => {
                      closeMore();
                      router.push("/train/create/create-run");
                    }}
                    style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="activity" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>Add run plan</Text>
                  </TouchableOpacity>
                ) : null}

                <Text style={[s.sheetGroupTitle, { color: theme.subtext, marginTop: 4 }]}>Review</Text>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    router.push("/train/history");
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="clock" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>View history</Text>
                </TouchableOpacity>

                <Text style={[s.sheetGroupTitle, { color: theme.subtext, marginTop: 4 }]}>Coach + tools</Text>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    router.push("/chat");
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="message-circle" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Ask coach</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    setTipsOpen(true);
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="book-open" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Open training guide</Text>
                </TouchableOpacity>

                {hasPlan ? (
                  <TouchableOpacity
                    onPress={async () => {
                      closeMore();
                      await handleSendTodayToWatch();
                    }}
                    disabled={sendingToWatch || !todayHero?.key}
                    style={[
                      s.sheetAction,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.card2,
                        opacity: sendingToWatch || !todayHero?.key ? 0.55 : 1,
                      },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Feather name="watch" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>
                      {sendingToWatch ? "Sending…" : "Send selected day to watch"}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {hasPlan ? (
                  <TouchableOpacity
                    onPress={() => {
                      closeMore();
                      router.push({ pathname: "/train/edit-plan", params: { edit: "1", id: plan.id } });
                    }}
                    style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="edit-3" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>Edit plan</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Training tips sheet */}
      <Modal visible={tipsOpen} transparent animationType="slide" onRequestClose={closeTips}>
        <View style={s.modalBackdrop}>
          <View style={s.tipsSheetDock}>
            <View style={[s.sheet, s.tipsSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>Training guide</Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    Niche topics and practical ideas for performance.
                  </Text>
                </View>

                <TouchableOpacity onPress={closeTips} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ marginTop: 10 }} showsVerticalScrollIndicator={false}>
                <Text style={[s.tipArticleTitle, { color: theme.text }]}>{activeTipTopic?.title}</Text>
                <Text style={[s.tipArticleSubtitle, { color: theme.subtext }]}>
                  {activeTipTopic?.subtitle}
                </Text>

                <View style={s.tipAuthorRow}>
                  <View
                    style={[
                      s.tipAuthorAvatar,
                      { borderColor: theme.border, backgroundColor: theme.card2 },
                    ]}
                  >
                    <Feather name="user" size={12} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.tipAuthorText, { color: theme.text }]}>
                      Written by {activeTipTopic?.author || "Coach Team"}
                    </Text>
                    <Text style={[s.tipAuthorMeta, { color: theme.subtext }]}>
                      {activeTipTopic?.updatedText || "Recently updated"}
                    </Text>
                  </View>
                </View>

                <View style={[s.tipDetailCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <Image source={activeTipTopic?.image} style={s.tipDetailImage} resizeMode="cover" />
                </View>

                <Text style={[s.tipBodyText, { color: theme.text }]}>{activeTipTopic?.intro}</Text>
                {(activeTipTopic?.bullets || []).map((point, idx) => (
                  <View key={`tip-detail-point-${idx}`} style={s.tipBulletRow}>
                    <View style={[s.tipPointDot, { backgroundColor: theme.primaryBg }]} />
                    <Text style={[s.tipBulletText, { color: theme.text }]}>{point}</Text>
                  </View>
                ))}

                {activeTipTopic?.sectionTitle ? (
                  <View style={[s.tipCallout, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                    <Text style={[s.tipCalloutTitle, { color: theme.text }]}>
                      {activeTipTopic.sectionTitle}
                    </Text>
                    <Text style={[s.tipCalloutBody, { color: theme.subtext }]}>
                      {activeTipTopic?.sectionBody}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      {/* Day sheet */}
      <Modal visible={daySheetOpen} transparent animationType="slide" onRequestClose={closeDaySheet}>
        <View style={s.modalBackdrop}>
          <View style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>
                    {activeDay?.dayLabel || "Day"}
                  </Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    {activeDay?.dateLabel || ""}
                  </Text>
                </View>

                <TouchableOpacity onPress={closeDaySheet} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => {
                    closeDaySheet();
                    openQuickRecord(activeDay?.dayIdx ?? 0);
                  }}
                  style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, flex: 1 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus" size={14} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "900" }}>Quick log</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    closeDaySheet();
                    openPrimaryPlan();
                  }}
                  style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, flex: 1 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="calendar" size={14} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "900" }}>Open plan</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => {
                  closeDaySheet();
                  router.push("/chat");
                }}
                style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, marginTop: 10 }]}
                activeOpacity={0.85}
              >
                <Feather name="message-circle" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontWeight: "900" }}>Ask coach about this day</Text>
              </TouchableOpacity>

              <View style={{ marginTop: 12, gap: 10 }}>
                {activeDay?.cards?.length ? (
                  activeDay.cards.map((c, idx) => (
                    <TouchableOpacity
                      key={`${activeDay.isoDate}_${idx}`}
                      onPress={() => {
                        closeDaySheet();
                        openPlannedCard(c, activeDay?.dayIdx ?? 0);
                      }}
                      activeOpacity={0.85}
                      style={[s.sheetSession, { backgroundColor: theme.card2, borderColor: theme.border }]}
                    >
                      <View style={[s.sessionIcon, { borderColor: theme.border }]}>
                        <Feather name={typeIconName(c.sess)} size={16} color={theme.text} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={s.sheetSessionTitleRow}>
                          <Text style={{ color: theme.text, fontWeight: "900", flex: 1 }} numberOfLines={1}>
                            {c.title}
                          </Text>
                          {c.status ? (
                            <View
                              style={[
                                s.sheetSessionStatusChip,
                                {
                                  backgroundColor:
                                    c.status === "completed"
                                      ? withHexAlpha(theme.primaryBg, theme.isDark ? "20" : "2B")
                                      : "rgba(248,113,113,0.16)",
                                  borderColor:
                                    c.status === "completed"
                                      ? withHexAlpha(theme.primaryBg, theme.isDark ? "7A" : "A3")
                                      : "rgba(248,113,113,0.45)",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  s.sheetSessionStatusChipText,
                                  {
                                    color: c.status === "completed" ? theme.primaryBg : "#F87171",
                                  },
                                ]}
                              >
                                {c.status === "completed" ? "Completed" : "Skipped"}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {!!c.meta ? (
                          <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 4, fontWeight: "800" }}>
                            {c.meta}
                          </Text>
                        ) : null}
                        {!!c.guidance ? (
                          <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 3, fontWeight: "700" }}>
                            {c.guidance}
                          </Text>
                        ) : null}
                      </View>

                      <Feather name="chevron-right" size={18} color={theme.subtext} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={[s.restCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                    <Text style={{ color: theme.text, fontWeight: "900" }}>Rest / open day</Text>
                    <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12, fontWeight: "800" }}>
                      Tap Quick log to record anything you do.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Quick log modal */}
      <Modal visible={recordOpen} transparent animationType="slide" onRequestClose={closeQuickRecord}>
        <View style={s.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>Quick log</Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    {weekGrid?.[recordDayIndex]?.dateLabel || "Session"}
                  </Text>
                </View>

                <TouchableOpacity onPress={closeQuickRecord} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={s.quickLogScroll}
                contentContainerStyle={s.quickLogContent}
                showsVerticalScrollIndicator={false}
              >
                {selectedRecordSample ? (
                  <LinearGradient
                    colors={
                      theme.isDark
                        ? ["#D8A125", "#8F6D14", "#15171E"]
                        : ["#F5C95E", "#D9A136", "#EDE9DC"]
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0.95, y: 1 }}
                    style={s.quickLogHero}
                  >
                    <View style={s.quickLogHeroTop}>
                      <View style={[s.sampleTypePill, { backgroundColor: "rgba(0,0,0,0.18)", borderColor: "rgba(255,255,255,0.24)" }]}>
                        <Feather name={sampleIconName(selectedRecordSample.type)} size={13} color="#FFFFFF" />
                        <Text style={[s.sampleTypeText, { color: "#FFFFFF" }]}>{selectedRecordSample.type}</Text>
                      </View>
                      <Text style={s.quickLogHeroKicker}>Prefilled sample</Text>
                    </View>

                    <Text style={s.quickLogHeroTitle}>{recordTitle || selectedRecordSample.title}</Text>
                    <Text style={s.quickLogHeroSummary} numberOfLines={2}>
                      {selectedRecordSample.summary || selectedRecordSample.notes}
                    </Text>

                    <View style={s.quickLogHeroMetaRow}>
                      <View style={s.quickLogHeroMetaChip}>
                        <Feather name="clock" size={12} color="#FFFFFF" />
                        <Text style={s.quickLogHeroMetaText}>
                          {recordDurationMin || selectedRecordSample.durationMin || "0"} min
                        </Text>
                      </View>
                      <View style={s.quickLogHeroMetaChip}>
                        <Feather name="map-pin" size={12} color="#FFFFFF" />
                        <Text style={s.quickLogHeroMetaText}>
                          {recordDistanceKm || (selectedRecordSample.distanceKm ? selectedRecordSample.distanceKm.toFixed(1) : "0")} km
                        </Text>
                      </View>
                      <View style={s.quickLogHeroMetaChip}>
                        <Text style={s.quickLogHeroMetaText}>
                          RPE {recordRpe || selectedRecordSample.rpe || "–"}
                        </Text>
                      </View>
                    </View>

                    <Text style={s.quickLogHeroBestFor}>
                      {selectedRecordSample.bestFor || sampleRecommendationReason}
                    </Text>
                  </LinearGradient>
                ) : null}

                <Text style={[s.quickLogSectionTitle, { color: theme.subtext }]}>Session type</Text>
                <View style={[s.quickLogEditCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[
                      { key: "run", label: "Run", icon: "activity" },
                      { key: "gym", label: "Gym", icon: "zap" },
                      { key: "other", label: "Other", icon: "more-horizontal" },
                    ].map((t) => {
                      const active = recordType === t.key;
                      return (
                        <TouchableOpacity
                          key={t.key}
                          onPress={() => setRecordType(t.key)}
                          style={[
                            s.typePill,
                            {
                              borderColor: active ? "rgba(0,0,0,0)" : theme.border,
                              backgroundColor: active ? theme.primaryBg : theme.card,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          <Feather name={t.icon} size={14} color={active ? theme.primaryText : theme.text} />
                          <Text style={{ color: active ? theme.primaryText : theme.text, fontWeight: "700" }}>
                            {t.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <Text style={[s.quickLogSectionTitle, { color: theme.subtext }]}>Session details</Text>
                <View style={[s.quickLogEditCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <Text style={[s.quickLogLabel, { color: theme.subtext }]}>Title</Text>
                  <TextInput
                    value={recordTitle}
                    onChangeText={setRecordTitle}
                    placeholder="e.g. Easy run / Upper body"
                    placeholderTextColor={theme.subtext}
                    style={[
                      s.quickLogInput,
                      { borderColor: theme.border, color: theme.text, backgroundColor: theme.card },
                    ]}
                  />

                  <View style={s.quickLogStatsRow}>
                    <View style={[s.quickLogStatBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <Text style={[s.quickLogStatLabel, { color: theme.subtext }]}>Duration (min)</Text>
                      <TextInput
                        value={recordDurationMin}
                        onChangeText={setRecordDurationMin}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.subtext}
                        style={[s.quickLogStatInput, { color: theme.text }]}
                      />
                    </View>

                    <View style={[s.quickLogStatBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <Text style={[s.quickLogStatLabel, { color: theme.subtext }]}>Distance (km)</Text>
                      <TextInput
                        value={recordDistanceKm}
                        onChangeText={setRecordDistanceKm}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.subtext}
                        style={[s.quickLogStatInput, { color: theme.text }]}
                      />
                    </View>

                    <View style={[s.quickLogStatBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <Text style={[s.quickLogStatLabel, { color: theme.subtext }]}>RPE</Text>
                      <TextInput
                        value={recordRpe}
                        onChangeText={setRecordRpe}
                        keyboardType="numeric"
                        placeholder="–"
                        placeholderTextColor={theme.subtext}
                        style={[s.quickLogStatInput, { color: theme.text }]}
                      />
                    </View>
                  </View>
                </View>

                <Text style={[s.quickLogSectionTitle, { color: theme.subtext }]}>Description / notes</Text>
                <View style={[s.quickLogEditCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <TextInput
                    value={recordNotes}
                    onChangeText={setRecordNotes}
                    placeholder="Anything worth noting…"
                    placeholderTextColor={theme.subtext}
                    multiline
                    style={[
                      s.quickLogNotesInput,
                      { borderColor: theme.border, color: theme.text, backgroundColor: theme.card },
                    ]}
                  />
                </View>

                <View style={s.quickLogActionRow}>
                  <TouchableOpacity
                    onPress={closeQuickRecord}
                    style={[s.modalBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: theme.text, fontWeight: "900" }}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={saveQuickRecord}
                    disabled={savingQuick}
                    style={[
                      s.modalBtn,
                      {
                        borderColor: "rgba(0,0,0,0)",
                        backgroundColor: theme.primaryBg,
                        flex: 1,
                        opacity: savingQuick ? 0.7 : 1,
                      },
                    ]}
                    activeOpacity={0.9}
                  >
                    {savingQuick ? (
                      <ActivityIndicator color={theme.primaryText} />
                    ) : (
                      <>
                        <Feather name="check" size={16} color={theme.primaryText} />
                        <Text style={{ color: theme.primaryText, fontWeight: "900" }}>
                          {selectedRecordSample ? "Save sample log" : "Save log"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={[s.quickLogHelper, { color: theme.subtext }]}>
                  {selectedRecordSample
                    ? "Sample values are prefilled. Edit anything before saving."
                    : "Saves to History as a quick log (no structured steps)."}
                </Text>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ──────────────────────────────────────────────────────────────
   Styles
────────────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  topBackgroundFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },
  pageContent: { paddingHorizontal: 18, paddingBottom: 140, gap: 16 },
  header: { marginTop: 8, marginBottom: 6 },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerTitle: { fontSize: 31, fontWeight: "800", letterSpacing: 0.2 },
  headerSubtitle: { fontSize: 13, marginTop: 3, fontWeight: "500", lineHeight: 18 },
  headerContextChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 30,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  headerContextChipText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  headerMetaRow: { marginTop: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  headerMetaText: { fontSize: 12, fontWeight: "500" },
  headerWeekRow: {
    marginTop: 10,
    marginBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerWeekLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  noPlanWeekStrip: {
    marginTop: 12,
    marginBottom: 2,
    overflow: "hidden",
    width: "100%",
  },
  weekCarouselTrack: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  weekCarouselPanel: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 2,
  },
  activePlanWeekStrip: {
    marginTop: 10,
    marginBottom: 4,
  },
  noPlanWeekDay: {
    flex: 1,
    alignItems: "center",
    gap: 7,
    minWidth: 44,
  },
  noPlanWeekDow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  noPlanWeekDateWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  noPlanWeekDate: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  noPlanWeekSessionMarkerRow: {
    minHeight: 8,
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  noPlanWeekSessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  noPlanWeekSessionMoreText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginLeft: 2,
  },

  heroWrap: { marginBottom: 4 },
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  heroNoBg: {
    borderWidth: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    backgroundColor: "transparent",
  },
  heroNoBlock: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    overflow: "visible",
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  heroTopMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroKicker: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontWeight: "800",
  },
  heroPlan: { fontSize: 20, fontWeight: "900", marginTop: 4 },
  heroMeta: { fontSize: 13, marginTop: 2 },

  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  heroMain: { marginTop: 14 },
  heroStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  heroDate: { fontSize: 12, fontWeight: "500" },
  heroSupport: { marginTop: 8, fontSize: 13, lineHeight: 19, fontWeight: "500" },
  heroExtraSessionsWrap: {
    marginTop: 8,
    gap: 0,
  },
  heroExtraSessionBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  heroExtraSessionTitle: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
  },
  heroExtraSessionSupport: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  heroExtraSessionActions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginTop: 10,
  },
  heroExtraSessionsMoreText: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 8,
  },
  heroInfoRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  heroInfoChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 26,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroInfoChipText: {
    fontSize: 11,
    fontWeight: "900",
  },
  heroTitle: { fontSize: 26, lineHeight: 32, fontWeight: "700", marginTop: 8 },
  heroTitleTight: { marginTop: 5, lineHeight: 30 },
  heroSupportTight: { marginTop: 5, lineHeight: 18 },
  heroSubStrong: { fontSize: 13, marginTop: 8, fontWeight: "800" },
  heroFocusRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 10 },
  heroPip: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  heroFocus: { fontSize: 13, fontWeight: "800", flex: 1 },
  heroNextUpRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroNextUpText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },

  heroActions: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 16 },
  heroActionsTight: { marginTop: 10 },
  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  primaryBtnText: { fontWeight: "700", fontSize: 13 },
  secondaryBtn: {
    minWidth: 120,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  secondaryBtnText: { fontWeight: "700", fontSize: 12 },
  heroTextLink: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  quickNav: { flexDirection: "row", gap: 10, marginTop: 2 },
  quickBtn: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  quickBtnText: { fontWeight: "900", fontSize: 13 },

  section: { marginTop: 4, marginBottom: 8 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: "700", letterSpacing: 0.1 },
  sectionSubtle: { fontSize: 12, fontWeight: "500", marginTop: -2, marginBottom: 10, lineHeight: 17 },

  weekControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  weekStripRow: { gap: 10, paddingRight: 8 },
  weekNav: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  weekJump: {
    minWidth: 58,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  weekJumpText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 14,
    marginTop: 8,
  },
  cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: "700", lineHeight: 22 },

  dayPill: {
    width: 96,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
    minHeight: 108,
  },
  dayPillTop: { width: "100%" },
  dayPillDow: { fontSize: 13, fontWeight: "700" },
  dayPillDate: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  dayPillStatus: {
    marginTop: 8,
    borderRadius: 999,
    minHeight: 20,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayPillStatusText: { fontSize: 10, fontWeight: "700" },
  dayPillMeta: { marginTop: 8, fontSize: 11, fontWeight: "500" },

  sessionRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sessionIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  restCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
  },

  progressTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  progressPlanCol: {
    flex: 1,
  },
  progressKicker: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  progressPlanName: {
    marginTop: 3,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },
  progressPlanMeta: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "500",
  },
  progressPercentChip: {
    minWidth: 82,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  progressPercentValue: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  progressPercentLabel: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  progressMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  progressLabel: { fontSize: 12, fontWeight: "500" },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginTop: 9,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  progressStateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 28,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  progressStateText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  progressStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  progressStatCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  progressStatValue: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  progressStatLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "500",
  },
  progressHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
  },

  insightIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  actionRowBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  secondaryGhost: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  expandBtn: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  tipCardRow: {
    gap: 10,
    paddingRight: 10,
  },
  tipCard: {
    width: 180,
    height: 118,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  tipCardImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  tipCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  tipCardTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tipsSheet: {
    height: "70%",
  },
  tipsSheetDock: {
    width: "100%",
    height: "100%",
    justifyContent: "flex-end",
  },
  tipDetailCard: {
    height: 180,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginTop: 12,
  },
  tipDetailImage: {
    width: "100%",
    height: "100%",
  },
  tipArticleTitle: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  tipArticleSubtitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  tipAuthorRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tipAuthorAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  tipAuthorText: {
    fontSize: 13,
    fontWeight: "900",
  },
  tipAuthorMeta: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: "700",
  },
  tipBodyText: {
    marginTop: 14,
    fontSize: 17,
    lineHeight: 28,
    fontWeight: "700",
  },
  tipBulletRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  tipBulletText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "800",
  },
  tipCallout: {
    marginTop: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
  },
  tipCalloutTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  tipCalloutBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  sampleIntro: {
    marginTop: -2,
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
  },
  sampleTabRow: {
    gap: 8,
    paddingRight: 10,
  },
  sampleTab: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sampleFeaturedCard: {
    width: 300,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  sampleFeaturedTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sampleTypePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sampleTypeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  sampleRecoLabel: { fontSize: 11, fontWeight: "500" },
  sampleRecoTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sampleRecoTagText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sampleFeaturedTitle: {
    marginTop: 2,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  sampleFeaturedSummary: {
    marginTop: -2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
  },
  sampleMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sampleMetaChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sampleMetaText: { fontSize: 11, fontWeight: "800" },
  sampleBestFor: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  samplePrimaryCta: {
    marginTop: 1,
    minHeight: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  samplePrimaryCtaText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  exploreAssistRow: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  exploreTipsBlock: {
    marginTop: 10,
  },
  sampleCtaHint: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  sampleAltWrap: {
    marginTop: 14,
  },
  sampleAltHead: {
    marginBottom: 8,
  },
  sampleAltTitle: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sampleAltSubtitle: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "700",
  },
  noPlanCarouselRow: {
    gap: 10,
    paddingRight: 8,
  },
  sampleAltCard: {
    width: 206,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    gap: 7,
  },
  sampleAltTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sampleAltTypeDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  sampleAltType: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sampleAltCardTitle: {
    fontSize: 14,
    fontWeight: "900",
  },
  sampleAltMeta: {
    fontSize: 12,
    fontWeight: "700",
  },
  sampleAltAction: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sampleAltActionText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sampleBridgeText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  quickLogScroll: {
    marginTop: 10,
    maxHeight: 560,
  },
  quickLogContent: {
    paddingBottom: 4,
    gap: 10,
  },
  quickLogHero: {
    borderRadius: 18,
    padding: 14,
    gap: 8,
    overflow: "hidden",
  },
  quickLogHeroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  quickLogHeroKicker: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#FFFFFF",
  },
  quickLogHeroTitle: {
    marginTop: 1,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  quickLogHeroSummary: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    color: "#F2F2F2",
  },
  quickLogHeroMetaRow: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickLogHeroMetaChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.22)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  quickLogHeroMetaText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  quickLogHeroBestFor: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    color: "#F2F2F2",
  },
  quickLogSectionTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  quickLogEditCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    gap: 9,
  },
  quickLogLabel: { fontSize: 12, fontWeight: "600" },
  quickLogInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 11,
    fontSize: 14,
    fontWeight: "600",
  },
  quickLogStatsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  quickLogStatBox: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  quickLogStatLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  quickLogStatInput: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  quickLogNotesInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 11,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    minHeight: 90,
    textAlignVertical: "top",
  },
  quickLogActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  quickLogPlainStack: {
    gap: 0,
    paddingHorizontal: 2,
  },
  quickLogPlainBrief: {
    marginTop: 2,
  },
  quickLogReadonlyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(127,127,127,0.35)",
  },
  quickLogReadonlyRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  quickLogReadonlyLabel: {
    fontSize: 12,
    fontWeight: "800",
  },
  quickLogReadonlyValue: {
    fontSize: 13,
    fontWeight: "900",
  },
  quickLogReadonlyCopy: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  quickLogHelper: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
    marginTop: -2,
  },

  coachLoadingWrap: {
    minHeight: 86,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  coachPlanRow: { gap: 10, paddingRight: 8 },
  coachPlanCard: {
    width: 300,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
  },
  coachPlanTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  coachTypePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  coachTypePillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  coachBrowseBtn: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  coachPlanName: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: "700",
  },
  coachPlanMeta: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "500",
  },
  coachPlanActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  coachActionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: 18,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSession: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetSessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetSessionStatusChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSessionStatusChipText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  sheetAction: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetActionText: {
    fontWeight: "700",
    fontSize: 13,
  },
  sheetGroupTitle: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: -2,
  },

  typePill: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  fieldLabel: { marginTop: 12, fontSize: 12, fontWeight: "900" },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "700",
  },
  textarea: { minHeight: 92, textAlignVertical: "top" },

  modalBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    flex: 1,
  },
});
