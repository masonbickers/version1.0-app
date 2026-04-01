// app/(protected)/train/onboarding/distance.jsx
/**
 * TRAIN-R — Onboarding: A specific distance (Runna-style)
 * Route: /(protected)/train/onboarding/distance
 *
 * Focus:
 *  - Step 1: Choose distance (no fixed race date) + plan length
 *  - Step 2: Goal focus + metric style + optional target time
 *  - Step 3: Current level
 *  - Step 4: Weekly schedule
 *  - Step 5: Preferences
 *  - Step 6: Review & generate (AI) -> saves to Firestore users/{uid}/plans and users/{uid}/planPrefs/current
 */

import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
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
    View
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
import {
    createPlanDocument,
    normalisePlanForSave,
} from "../../../../src/lib/train/planModel";
import { convertAiPlanToApp } from "../../../../src/lib/train/planTransformers";

/* ---------------- tokens ---------------- */
const PRIMARY = "#E6FF3B";
const INK = "#050506";
const CARD = "#111317";
const CARD_2 = "#0E1013";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.70)";
const MUTED_2 = "rgba(255,255,255,0.45)";
const DANGER = "#EF4444";

/* ---------------- options ---------------- */
const DISTANCE_OPTIONS = ["5K", "10K", "Half marathon", "Marathon", "Ultra", "General fitness", "Other"];
const PLAN_LENGTH_OPTIONS = [6, 8, 10, 12, 16, 20];

const GOAL_PRIMARY_FOCUS = [
  "PB / time goal",
  "Finish comfortably",
  "Build base / aerobic",
  "Race-specific prep",
];
const EXPERIENCE_OPTIONS = [
  "New to running",
  "Some experience",
  "Regular runner",
  "Advanced/competitive",
];
const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];
const LONG_RUN_DAY_OPTIONS = ["Sat", "Sun", "Fri", "Any"];
const SURFACE_OPTIONS = ["Road", "Trail", "Treadmill", "Mix"];
const WEAK_AREAS_OPTIONS = [
  "Endurance",
  "Speed",
  "Threshold / tempo",
  "Recovery",
  "Race-day pacing",
  "Strength / conditioning",
];

/* ---------------- helpers ---------------- */
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function formatTimeHHMMSS(date) {
  if (!date) return null;
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}:00`;
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

function SectionTitle({ title, subtitle }) {
  return (
    <View style={{ marginTop: 14, marginBottom: 10 }}>
      <Text style={styles.h1}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.pill, active ? styles.pillSelected : null]}
    >
      <Text style={[styles.pillText, active ? styles.pillTextSelected : null]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StickyFooter({ label, disabled, onPress, hint, leftLabel, onLeft }) {
  return (
    <View style={styles.footerWrap}>
      <View style={styles.footerInner}>
        {hint ? <Text style={styles.footerHint}>{hint}</Text> : null}

        <View style={{ flexDirection: "row", gap: 10 }}>
          {leftLabel ? (
            <TouchableOpacity
              onPress={onLeft}
              activeOpacity={0.9}
              style={styles.secondaryFooterBtn}
            >
              <Text style={styles.secondaryFooterBtnText}>{leftLabel}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.9}
            disabled={disabled}
            style={[
              styles.primaryBtn,
              disabled ? styles.primaryBtnDisabled : null,
              leftLabel ? { flex: 1.4 } : { flex: 1 },
            ]}
          >
            <Text
              style={[
                styles.primaryBtnText,
                disabled ? { opacity: 0.55 } : null,
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ---------------- screen ---------------- */
export default function DistanceOnboarding() {
  const router = useRouter();
  const params = useLocalSearchParams();
  useTheme();
  const { createPlan: createAiPlan } = useAiPlan();

  const bg = INK;

  const STEPS = useMemo(
    () => [
      { key: "distance", title: "Your distance", subtitle: "Pick the distance you’re building towards and how long you want the plan." },
      { key: "goal", title: "Your goal", subtitle: "Choose focus, metric style, and a time goal if you want one." },
      { key: "level", title: "Current level", subtitle: "Weekly km is the key one. PBs help tune paces (optional)." },
      { key: "schedule", title: "Weekly schedule", subtitle: "How often can you realistically run?" },
      { key: "prefs", title: "Preferences", subtitle: "Surfaces, focus areas, gym access, constraints." },
      { key: "review", title: "Review & build", subtitle: "We’ll generate your plan and save it to Train." },
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

  // ---- Distance ----
  const [distance, setDistance] = useState("10K");
  const [customDistance, setCustomDistance] = useState("");
  const [planLengthWeeks, setPlanLengthWeeks] = useState(12);

  // ---- Goal ----
  const [goalPrimaryFocus, setGoalPrimaryFocus] = useState("PB / time goal");
  const [planMetricPreference, setPlanMetricPreference] = useState("time"); // time|distance|mixed
  const [targetTimeMode, setTargetTimeMode] = useState("Just finish");
  const [targetTimeDate, setTargetTimeDate] = useState(null);

  // ---- Level ----
  const [experienceLevel, setExperienceLevel] = useState("Some experience");
  const [recent5k, setRecent5k] = useState("");
  const [recent10k, setRecent10k] = useState("");
  const [recentHalf, setRecentHalf] = useState("");
  const [recentMarathon, setRecentMarathon] = useState("");
  const [currentWeeklyDistance, setCurrentWeeklyDistance] = useState("");
  const [currentLongestRun, setCurrentLongestRun] = useState("");

  // ---- Schedule ----
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [longRunDay, setLongRunDay] = useState("Sun");
  const [availableDaysNotes, setAvailableDaysNotes] = useState("");

  // ---- Prefs ----
  const [surfaces, setSurfaces] = useState(["Road"]);
  const [weakAreas, setWeakAreas] = useState([]);
  const [gymAccess, setGymAccess] = useState("Yes");
  const [crossTrainingPreference, setCrossTrainingPreference] = useState("Some");
  const [injuries, setInjuries] = useState("");
  const [constraints, setConstraints] = useState("");

  // ---- UI ----
  const [loading, setLoading] = useState(false);
  const [showTargetTimePicker, setShowTargetTimePicker] = useState(false);

  const normalisedDistance = useMemo(() => {
    if (distance === "Other" && customDistance.trim()) return customDistance.trim();
    return distance;
  }, [distance, customDistance]);

  const progress = useMemo(
    () => clamp((step + 1) / STEPS.length, 0.05, 1),
    [step, STEPS.length]
  );

  const toggleArrayValue = (arr, value, setFn) => {
    if (arr.includes(value)) setFn(arr.filter((v) => v !== value));
    else setFn([...arr, value]);
  };

  // Step validation
  const isStepValid = (s) => {
    switch (s) {
      case 0:
        return Boolean(normalisedDistance && planLengthWeeks);
      case 1:
        return Boolean(goalPrimaryFocus && planMetricPreference);
      case 2:
        return Boolean(experienceLevel && String(currentWeeklyDistance).trim());
      case 3:
        return Boolean(daysPerWeek);
      case 4:
        return true;
      case 5:
        return true;
      default:
        return true;
    }
  };

  const canContinue = useMemo(() => isStepValid(step), [
    step,
    normalisedDistance,
    planLengthWeeks,
    goalPrimaryFocus,
    planMetricPreference,
    experienceLevel,
    currentWeeklyDistance,
    daysPerWeek,
  ]);

  const handleClose = () => {
    Alert.alert("Leave setup?", "You can finish this later.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const handleBack = () => {
    if (step === 0) return router.back();
    setStep((s) => Math.max(0, s - 1));
  };

  const handleNext = () => {
    if (!isStepValid(step)) {
      Alert.alert("More info needed", "Please complete this section before continuing.");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  // server compatibility goalType
  const deriveGoalType = () => {
    const g = String(normalisedDistance || "").toLowerCase();
    if (g.includes("5k")) return "5k";
    if (g.includes("10k")) return "10k";
    if (g.includes("half")) return "Half";
    if (g.includes("marathon") && !g.includes("half")) return "Marathon";
    if (g.includes("ultra")) return "Ultra";
    if (g.includes("general")) return "General fitness";
    return "10k";
  };

  const confirmReplaceActivePlan = async (uid) => {
    try {
      const plansRef = collection(db, "users", uid, "plans");
      const snap = await getDocs(query(plansRef, orderBy("updatedAt", "desc"), limit(1)));
      if (snap.empty) return true;

      return await new Promise((resolve) => {
        Alert.alert(
          "Replace current plan?",
          "You already have an active training plan. Creating a new one will replace it on your Train page. Continue?",
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
    return Boolean(
      normalisedDistance &&
        planLengthWeeks &&
        goalPrimaryFocus &&
        planMetricPreference &&
        experienceLevel &&
        daysPerWeek &&
        String(currentWeeklyDistance).trim()
    );
  }, [
    normalisedDistance,
    planLengthWeeks,
    goalPrimaryFocus,
    planMetricPreference,
    experienceLevel,
    daysPerWeek,
    currentWeeklyDistance,
  ]);

  const handleGenerate = async () => {
    if (!canGenerate) {
      Alert.alert("More info needed", "Complete distance + plan length, weekly km, and days/week.");
      return;
    }

    const user = auth.currentUser;
    const uid = user?.uid;
    if (!uid) {
      Alert.alert("Not signed in", "You need to be logged in to create a plan.");
      return;
    }

    if (!API_URL) {
      Alert.alert("Missing API URL", "EXPO_PUBLIC_API_URL isn’t set, so AI generation can’t run.");
      return;
    }

    const okToReplace = await confirmReplaceActivePlan(uid);
    if (!okToReplace) return;

    const goalType = deriveGoalType();
    const sessionsPerWeek = Number(daysPerWeek);

    const targetEventDate = ""; // no fixed date for this path
    const targetTime =
      targetTimeMode === "Time goal" && targetTimeDate ? formatTimeHHMMSS(targetTimeDate) : "";

    const extraNotesParts = [
      `Goal path: distance`,
      `Distance: ${normalisedDistance}`,
      `Plan length: ${planLengthWeeks} weeks`,
      `Focus: ${goalPrimaryFocus}`,
      `Metric style: ${planMetricPreference}`,
      `Experience: ${experienceLevel}`,
      `Weekly km: ${currentWeeklyDistance} km`,
      `Longest run: ${currentLongestRun ? `${currentLongestRun} km` : "not given"}`,
      `Runs/week: ${daysPerWeek}`,
      `Long run day: ${longRunDay}`,
      availableDaysNotes ? `Week notes: ${availableDaysNotes}` : null,
      surfaces.length ? `Surfaces: ${surfaces.join(", ")}` : null,
      weakAreas.length ? `Focus areas: ${weakAreas.join(", ")}` : null,
      `Gym access: ${gymAccess}`,
      `Cross training: ${crossTrainingPreference}`,
      injuries ? `Injuries: ${injuries}` : null,
      constraints ? `Constraints: ${constraints}` : null,
      targetTime ? `Target time: ${targetTime}` : null,
    ].filter(Boolean);

    const extraNotes = extraNotesParts.join(" | ");

    setLoading(true);
    try {
      const prefsPayload = {
        goalPath: "distance",
        goalDistance: normalisedDistance,
        goalPrimaryFocus,
        planMetricPreference,
        targetEventName: "",
        raceDateISO: null,
        raceDateUnknown: true,
        planLengthWeeks,
        targetTimeMode,
        targetTime: targetTime || null,

        experienceLevel,
        recentTimes: { fiveK: recent5k || "", tenK: recent10k || "", half: recentHalf || "", marathon: recentMarathon || "" },
        currentWeeklyDistanceKm: currentWeeklyDistance || "",
        currentLongestRunKm: currentLongestRun || "",

        daysPerWeek,
        longRunDay,
        weekNotes: availableDaysNotes || "",

        surfaces,
        weakAreas,
        gymAccess,
        crossTrainingPreference,
        injuries: injuries || "",
        constraints: constraints || "",

        updatedAt: serverTimestamp(),
        platform: Platform.OS,
      };

      await setDoc(doc(db, "users", uid, "planPrefs", "current"), prefsPayload, { merge: true });

      const athleteProfile = {
        goal: {
          path: "distance",
          distance: normalisedDistance,
          primaryFocus: goalPrimaryFocus,
          eventName: "",
          eventDate: null,
          targetTime: targetTime || null,
          planLengthWeeks,
        },
        availability: { sessionsPerWeek, longRunDay, notes: availableDaysNotes || "" },
        current: {
          weeklyKm: Number(currentWeeklyDistance) || 0,
          longestRunKm: Number(currentLongestRun) || 0,
          experience: experienceLevel,
          recentTimes: { fiveK: recent5k || "", tenK: recent10k || "", half: recentHalf || "", marathon: recentMarathon || "" },
        },
        preferences: {
          metric: planMetricPreference,
          surfaces,
          focusAreas: weakAreas,
          injuries: injuries || "",
          constraints: constraints || "",
          treadmill: surfaces.includes("Treadmill") ? "Yes" : "No",
          gymAccess,
          crossTrainingPreference,
        },
      };

      const aiPlan = await createAiPlan({
        userId: uid,
        goalType,
        targetEventDate, // ""
        targetTime,
        current10kTime: recent10k || "",
        sessionsPerWeek,
        weeks: Number(planLengthWeeks),
        goal: `${normalisedDistance} – ${goalPrimaryFocus}`,
        primaryActivity: "Run",
        extraNotes,
        athleteProfile,
      });

      const appPlan = convertAiPlanToApp(aiPlan) || {};

      const meta = {
        name: appPlan.name || `${normalisedDistance} plan (${planLengthWeeks} weeks)`,
        primaryActivity: "Run",
        goalPath: "distance",
        goalDistance: normalisedDistance || "",
        goalPrimaryFocus: goalPrimaryFocus || "",
        targetEventName: "",
        targetEventDate: "",
        targetTime,
        source: "ai-run",
        aiContext: extraNotes,
        planMetricPreference,
      };

      const config = {
        goalPath: "distance",
        goalType,
        normalisedGoalDistance: normalisedDistance,
        goalPrimaryFocus,
        targetEventName: "",
        targetEventDate: "",
        targetTime,
        weeksCount: Number(planLengthWeeks),
        sessionsPerWeek,
        raceDateUnknown: true,
        planLengthWeeks,
        experienceLevel,
        recent5k,
        recent10k,
        recentHalf,
        recentMarathon,
        currentWeeklyDistance,
        currentLongestRun,
        longRunDay,
        availableDaysNotes,
        surfaces,
        weakAreas,
        gymAccess,
        crossTrainingPreference,
        injuries,
        constraints,
        planMetricPreference,
      };

      const planDoc = createPlanDocument({ appPlan, aiPlan, meta, config });
      const cleanedPlanDoc = normalisePlanForSave(planDoc);

      await addDoc(collection(db, "users", uid, "plans"), cleanedPlanDoc);

      Alert.alert("Plan created", "Your plan has been saved and is now visible on the Train page.");
      router.replace("/(protected)/train");
    } catch (e) {
      console.log("[distance-onboarding] error:", e);
      Alert.alert("Error", e?.message || "Something went wrong generating or saving your plan.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- step views ---------------- */
  const StepDistance = () => (
    <>
      <SectionTitle title="Your distance" subtitle="No event date needed — just pick the distance and plan length." />

      <Card>
        <Text style={styles.smallLabel}>Distance</Text>
        <View style={styles.chipRow}>
          {DISTANCE_OPTIONS.map((opt) => (
            <Chip key={opt} label={opt} active={distance === opt} onPress={() => setDistance(opt)} />
          ))}
        </View>

        {distance === "Other" ? (
          <TextInput
            style={styles.input}
            placeholder="e.g. 15K, 10-mile, hilly trail race"
            placeholderTextColor={MUTED_2}
            value={customDistance}
            onChangeText={setCustomDistance}
          />
        ) : null}

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Plan length</Text>
        <Text style={styles.microHint}>Pick a realistic timeline. You can regenerate anytime.</Text>
        <View style={styles.chipRow}>
          {PLAN_LENGTH_OPTIONS.map((w) => (
            <Chip key={w} label={`${w} weeks`} active={planLengthWeeks === w} onPress={() => setPlanLengthWeeks(w)} />
          ))}
        </View>

        {!API_URL ? (
          <Text style={[styles.hint, { marginTop: 10, color: DANGER }]}>
            AI won’t run until EXPO_PUBLIC_API_URL is set.
          </Text>
        ) : null}
      </Card>
    </>
  );

  const StepGoal = () => (
    <>
      <SectionTitle title="Your goal" subtitle="This changes how your sessions are written and progressed." />

      <Card>
        <Text style={styles.smallLabel}>Primary focus</Text>
        <View style={styles.chipRow}>
          {GOAL_PRIMARY_FOCUS.map((opt) => (
            <Chip key={opt} label={opt} active={goalPrimaryFocus === opt} onPress={() => setGoalPrimaryFocus(opt)} />
          ))}
        </View>

        <View style={{ height: 10 }} />

        <Text style={styles.smallLabel}>Plan metric style</Text>
        <Text style={styles.microHint}>Do you want sessions mainly by time or distance?</Text>
        <View style={styles.chipRow}>
          <Chip label="Time-based" active={planMetricPreference === "time"} onPress={() => setPlanMetricPreference("time")} />
          <Chip label="Distance-based" active={planMetricPreference === "distance"} onPress={() => setPlanMetricPreference("distance")} />
          <Chip label="Mixed" active={planMetricPreference === "mixed"} onPress={() => setPlanMetricPreference("mixed")} />
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Target time (optional)</Text>
        <View style={styles.chipRow}>
          <Chip
            label="Just finish"
            active={targetTimeMode === "Just finish"}
            onPress={() => {
              setTargetTimeMode("Just finish");
              setTargetTimeDate(null);
            }}
          />
          <Chip
            label="Time goal"
            active={targetTimeMode === "Time goal"}
            onPress={() => setTargetTimeMode("Time goal")}
          />
        </View>

        {targetTimeMode === "Time goal" ? (
          <TouchableOpacity
            onPress={() => setShowTargetTimePicker(true)}
            activeOpacity={0.85}
            style={[styles.rowBtn, { marginTop: 10 }]}
          >
            <Feather name="clock" size={16} color={PRIMARY} />
            <Text style={styles.rowBtnText}>
              {targetTimeDate ? formatTimeHHMMSS(targetTimeDate) : "Select target time"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </Card>
    </>
  );

  const StepLevel = () => (
    <>
      <SectionTitle title="Current running level" subtitle="Weekly km is the main one. PBs help tune paces (optional)." />

      <Card>
        <Text style={styles.smallLabel}>Experience</Text>
        <View style={styles.chipRow}>
          {EXPERIENCE_OPTIONS.map((opt) => (
            <Chip key={opt} label={opt} active={experienceLevel === opt} onPress={() => setExperienceLevel(opt)} />
          ))}
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Recent race times (optional)</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>5K</Text>
            <TextInput style={styles.input} placeholder="e.g. 20:30" placeholderTextColor={MUTED_2} value={recent5k} onChangeText={setRecent5k} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>10K</Text>
            <TextInput style={styles.input} placeholder="e.g. 43:00" placeholderTextColor={MUTED_2} value={recent10k} onChangeText={setRecent10k} />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>Half</Text>
            <TextInput style={styles.input} placeholder="e.g. 1:35:00" placeholderTextColor={MUTED_2} value={recentHalf} onChangeText={setRecentHalf} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>Marathon</Text>
            <TextInput style={styles.input} placeholder="e.g. 3:30:00" placeholderTextColor={MUTED_2} value={recentMarathon} onChangeText={setRecentMarathon} />
          </View>
        </View>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Current volume</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>Typical weekly distance *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 25"
              placeholderTextColor={MUTED_2}
              keyboardType="numeric"
              value={currentWeeklyDistance}
              onChangeText={setCurrentWeeklyDistance}
            />
            <Text style={styles.microHint}>km per week</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>Longest recent run</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 14"
              placeholderTextColor={MUTED_2}
              keyboardType="numeric"
              value={currentLongestRun}
              onChangeText={setCurrentLongestRun}
            />
            <Text style={styles.microHint}>km (last 4–6 weeks)</Text>
          </View>
        </View>
      </Card>
    </>
  );

  const StepSchedule = () => (
    <>
      <SectionTitle title="Weekly schedule" subtitle="Pick a sustainable frequency. We’ll structure workouts around it." />

      <Card>
        <Text style={styles.smallLabel}>Runs per week</Text>
        <View style={styles.chipRow}>
          {DAYS_PER_WEEK_OPTIONS.map((n) => (
            <Chip key={n} label={`${n}x`} active={daysPerWeek === n} onPress={() => setDaysPerWeek(n)} />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Preferred long run day</Text>
        <View style={styles.chipRow}>
          {LONG_RUN_DAY_OPTIONS.map((d) => (
            <Chip key={d} label={d} active={longRunDay === d} onPress={() => setLongRunDay(d)} />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Anything else about your week?</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. football Wednesdays, long shifts Mondays, avoid back-to-back hard days…"
          placeholderTextColor={MUTED_2}
          value={availableDaysNotes}
          onChangeText={setAvailableDaysNotes}
          multiline
        />
      </Card>
    </>
  );

  const StepPrefs = () => (
    <>
      <SectionTitle title="Preferences & constraints" subtitle="These help the plan feel like it was built for you." />

      <Card>
        <Text style={styles.smallLabel}>Surfaces</Text>
        <View style={styles.chipRow}>
          {SURFACE_OPTIONS.map((opt) => (
            <Chip key={opt} label={opt} active={surfaces.includes(opt)} onPress={() => toggleArrayValue(surfaces, opt, setSurfaces)} />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Focus areas</Text>
        <View style={styles.chipRow}>
          {WEAK_AREAS_OPTIONS.map((opt) => (
            <Chip key={opt} label={opt} active={weakAreas.includes(opt)} onPress={() => toggleArrayValue(weakAreas, opt, setWeakAreas)} />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Gym / strength access</Text>
        <View style={styles.chipRow}>
          <Chip label="Yes" active={gymAccess === "Yes"} onPress={() => setGymAccess("Yes")} />
          <Chip label="Limited" active={gymAccess === "Limited"} onPress={() => setGymAccess("Limited")} />
          <Chip label="No" active={gymAccess === "No"} onPress={() => setGymAccess("No")} />
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Cross-training</Text>
        <View style={styles.chipRow}>
          <Chip label="None" active={crossTrainingPreference === "None"} onPress={() => setCrossTrainingPreference("None")} />
          <Chip label="Some" active={crossTrainingPreference === "Some"} onPress={() => setCrossTrainingPreference("Some")} />
          <Chip label="A lot" active={crossTrainingPreference === "A lot"} onPress={() => setCrossTrainingPreference("A lot")} />
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Injuries (optional)</Text>
        <TextInput style={[styles.input, styles.textArea]} placeholder="e.g. Achilles tightness, niggly knee…" placeholderTextColor={MUTED_2} value={injuries} onChangeText={setInjuries} multiline />

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Other constraints (optional)</Text>
        <TextInput style={[styles.input, styles.textArea]} placeholder="e.g. hate treadmills, avoid intervals on Tuesdays…" placeholderTextColor={MUTED_2} value={constraints} onChangeText={setConstraints} multiline />
      </Card>
    </>
  );

  const StepReview = () => (
    <>
      <SectionTitle title="Review" subtitle="If everything looks right, we’ll build your plan and save it to Train." />

      <Card style={{ backgroundColor: CARD_2 }}>
        <View style={{ gap: 10 }}>
          <SummaryLine icon="map" label="Distance" value={normalisedDistance || "—"} />
          <SummaryLine icon="calendar" label="Plan length" value={`${planLengthWeeks} weeks`} />
          <SummaryLine icon="target" label="Focus" value={goalPrimaryFocus} />
          <SummaryLine icon="activity" label="Metric style" value={planMetricPreference} />
          <SummaryLine icon="clock" label="Target time" value={targetTimeMode === "Just finish" ? "Just finish" : targetTimeDate ? formatTimeHHMMSS(targetTimeDate) : "—"} />
          <SummaryLine icon="user" label="Experience" value={experienceLevel} />
          <SummaryLine icon="bar-chart-2" label="Weekly km" value={`${currentWeeklyDistance || "—"} km`} />
          <SummaryLine icon="calendar" label="Runs / week" value={`${daysPerWeek}x`} />
          <SummaryLine icon="trending-up" label="Long run day" value={longRunDay} />
          <SummaryLine icon="map-pin" label="Surfaces" value={surfaces.length ? surfaces.join(", ") : "—"} />
          <SummaryLine icon="zap" label="Focus areas" value={weakAreas.length ? weakAreas.join(", ") : "—"} />
        </View>

        {!canGenerate ? (
          <Text style={[styles.hint, { marginTop: 12, color: DANGER }]}>
            Missing required: distance + plan length, weekly km, days/week.
          </Text>
        ) : null}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>What happens next</Text>
        <Text style={styles.cardDesc}>
          We’ll generate a plan using your inputs, save it to your account, and show it on your Train page.
        </Text>
      </Card>
    </>
  );

  function SummaryLine({ icon, label, value }) {
    return (
      <View style={styles.summaryLine}>
        <View style={styles.summaryLeft}>
          <Feather name={icon} size={16} color={PRIMARY} />
          <Text style={styles.summaryLabel}>{label}</Text>
        </View>
        <Text style={styles.summaryValue} numberOfLines={1}>{value}</Text>
      </View>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepDistance />;
      case 1:
        return <StepGoal />;
      case 2:
        return <StepLevel />;
      case 3:
        return <StepSchedule />;
      case 4:
        return <StepPrefs />;
      case 5:
        return <StepReview />;
      default:
        return null;
    }
  };

  const footerLabel =
    step === STEPS.length - 1 ? (loading ? "Building your plan…" : "Generate plan with AI") : "Continue";

  const footerDisabled =
    loading || (step === STEPS.length - 1 ? !canGenerate : !canContinue);

  const footerHint = useMemo(() => {
    if (loading) return "This can take a moment.";
    if (step === 0 && !normalisedDistance) return "Pick a distance to continue.";
    if (step === 0 && !planLengthWeeks) return "Pick a plan length to continue.";
    if (step === 2 && !String(currentWeeklyDistance).trim()) return "Weekly km is required to continue.";
    return "";
  }, [loading, step, normalisedDistance, planLengthWeeks, currentWeeklyDistance]);

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
            <Text style={styles.stepKicker}>A SPECIFIC DISTANCE</Text>
            <Text style={styles.stepMini}>
              Step {step + 1} of {STEPS.length} · {STEPS[step]?.key}
            </Text>
          </View>

          {renderStep()}

          <View style={{ height: 140 }} />
        </ScrollView>

        <StickyFooter
          label={footerLabel}
          disabled={footerDisabled}
          onPress={step === STEPS.length - 1 ? handleGenerate : handleNext}
          hint={footerHint}
          leftLabel={step > 0 && !loading ? "Back" : null}
          onLeft={handleBack}
        />
      </KeyboardAvoidingView>

      {/* TIME PICKER */}
      <Modal transparent visible={showTargetTimePicker} animationType="fade" onRequestClose={() => setShowTargetTimePicker(false)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <DateTimePicker
              mode="time"
              value={targetTimeDate || new Date(0, 0, 0, 1, 0, 0)}
              is24Hour
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(event, selectedDate) => {
                if (event.type === "dismissed") {
                  setShowTargetTimePicker(false);
                  return;
                }
                if (selectedDate) setTargetTimeDate(selectedDate);
                setShowTargetTimePicker(false);
              }}
              style={{ alignSelf: "stretch" }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
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
    fontWeight: "800",
  },
  sub: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },

  cardTitle: { color: "white", fontSize: 16, fontWeight: "800", letterSpacing: -0.1 },
  cardDesc: { marginTop: 4, color: MUTED_2, fontSize: 13, lineHeight: 18 },

  smallLabel: {
    color: MUTED_2,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  miniLabel: { marginBottom: 6, color: MUTED, fontSize: 12, fontWeight: "800" },
  microHint: { marginTop: 6, marginBottom: 8, color: MUTED_2, fontSize: 12, lineHeight: 16 },

  chipRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  pillSelected: { backgroundColor: "rgba(230,255,59,0.90)", borderColor: "rgba(230,255,59,0.90)" },
  pillText: { color: "white", fontSize: 13, fontWeight: "800" },
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

  summaryLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
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
  footerInner: { gap: 10 },
  footerHint: { color: MUTED_2, fontSize: 12, fontWeight: "800" },

  primaryBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  primaryBtnDisabled: { backgroundColor: "rgba(255,255,255,0.55)" },
  primaryBtnText: { color: INK, fontSize: 16, fontWeight: "900", letterSpacing: -0.1 },

  secondaryFooterBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flex: 1,
  },
  secondaryFooterBtnText: { color: "white", fontSize: 15, fontWeight: "900", opacity: 0.85 },

  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center" },
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
