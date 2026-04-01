// app/(protected)/train/create/create-strength.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
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

const STEPS = [
  "Goal",
  "Current level",
  "Weekly structure",
  "Schedule + recovery",
  "Exercise profile",
  "Preferences",
  "Review",
];

const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GOAL_TYPE_OPTIONS = [
  {
    key: "Hypertrophy biased",
    title: "Hypertrophy",
    blurb: "Bias towards muscle growth and volume progression.",
    icon: "activity",
  },
  {
    key: "Strength biased",
    title: "Strength",
    blurb: "Bias towards lower-rep loading and force output.",
    icon: "trending-up",
  },
  {
    key: "Powerbuilding (mix)",
    title: "Powerbuilding",
    blurb: "Blend strength progression with hypertrophy work.",
    icon: "layers",
  },
  {
    key: "General training",
    title: "General training",
    blurb: "Balanced strength, movement quality and consistency.",
    icon: "shield",
  },
  {
    key: "Body recomposition",
    title: "Body recomposition",
    blurb: "Preserve or build muscle while improving body composition.",
    icon: "target",
  },
];

const EXPERIENCE_OPTIONS = [
  {
    key: "New to lifting",
    backend: "Beginner",
    title: "Beginner",
    blurb: "Relatively new to structured lifting and progression.",
  },
  {
    key: "Some experience",
    backend: "Intermediate",
    title: "Intermediate",
    blurb: "Training semi-consistently and ready for more structure.",
  },
  {
    key: "Regular lifter",
    backend: "Intermediate",
    title: "Advanced intermediate",
    blurb: "Regular lifting history and able to tolerate structured loading.",
  },
  {
    key: "Advanced / powerlifter",
    backend: "Advanced",
    title: "Advanced",
    blurb: "Experienced with higher intensity and more periodised blocks.",
  },
];

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6];

const SPLIT_OPTIONS = [
  "Full body",
  "Upper / lower",
  "Push / pull / legs",
  "Push / pull / legs (2x)",
  "Body part split",
];

const SESSION_LENGTH_OPTIONS = [
  "30-45 min",
  "45-60 min",
  "60-75 min",
  "90+ min",
];

const EQUIPMENT_OPTIONS = [
  "Commercial gym",
  "Home gym (rack & barbell)",
  "Dumbbells only",
  "Minimal (bands / bodyweight)",
];

const WEAK_AREAS_OPTIONS = [
  "Squat strength",
  "Deadlift strength",
  "Bench / pressing",
  "Pull-ups / back",
  "Glutes / posterior chain",
  "Shoulder stability",
  "Core / trunk",
];

const FOCUS_AREAS_OPTIONS = [
  "Max strength",
  "Muscle size",
  "Performance for sport",
  "Support for Hyrox / endurance",
  "General health",
];

const PLAN_LENGTH_OPTIONS = [6, 8, 10, 12, 16];

const RECOVERY_OPTIONS = ["Low", "Moderate", "High"];
const SLEEP_OPTIONS = ["Poor", "Average", "Good"];
const STRESS_OPTIONS = ["Low", "Moderate", "High"];

const PROGRESSION_STYLE_OPTIONS = [
  "Simple progressive overload",
  "RPE based",
  "% based",
  "Auto-regulated",
  "No preference",
];

const PRIORITY_LIFT_OPTIONS = [
  "Squat",
  "Bench press",
  "Deadlift",
  "Overhead press",
  "Pull-up",
];

const EXERCISE_STYLE_OPTIONS = [
  "No preference",
  "Barbell bias",
  "Machine bias",
  "Dumbbell bias",
  "Mixed / balanced",
];

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    isDark,
    bg: isDark ? "#050506" : "#F5F5F7",
    card: isDark ? "#111217" : "#FFFFFF",
    cardSoft: isDark ? "#0B0C10" : "#F3F4F6",
    text: colors.text,
    subtext: colors.subtext,
    border: isDark ? "rgba(255,255,255,0.10)" : "#E1E3E8",
    muted: colors.muted || (isDark ? "#18181B" : "#E5E7EB"),
    primaryBg: "#E6FF3B",
    primaryText: "#0A1113",
    pillBg: isDark ? "#111217" : "#FFFFFF",
    progressTrack: isDark
      ? "rgba(230,255,59,0.24)"
      : "rgba(230,255,59,0.32)",
    accent: "#E6FF3B",
    danger: "#ef4444",
    warnBg: isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)",
    ok: "#22c55e",
  };
}

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

function isStrengthPlanDoc(data) {
  const kind = String(data?.kind || data?.plan?.kind || "").toLowerCase();
  const source = String(data?.source || "").toLowerCase();
  const primaryActivity = String(
    data?.meta?.primaryActivity || data?.primaryActivity || ""
  ).toLowerCase();
  const goalType = String(data?.goalType || "").toLowerCase();

  return (
    kind === "strength" ||
    source.includes("strength") ||
    primaryActivity.includes("strength") ||
    primaryActivity.includes("gym") ||
    goalType.includes("strength")
  );
}

function normaliseNumberString(value) {
  const raw = String(value || "").replace(",", ".").trim();
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : "";
}

function parseOptionalNumber(value) {
  const raw = normaliseNumberString(value);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function expandEquipmentAccess(labels) {
  const selected = Array.isArray(labels) ? labels : [];
  const out = new Set();

  selected.forEach((label) => {
    if (label === "Commercial gym") {
      [
        "barbell",
        "rack",
        "bench",
        "dumbbell",
        "machine",
        "cable",
        "pull-up bar",
        "smith machine",
        "bands",
        "kettlebell",
        "trap bar",
      ].forEach((item) => out.add(item));
    }

    if (label === "Home gym (rack & barbell)") {
      ["barbell", "rack", "bench", "dumbbell", "bands"].forEach((item) =>
        out.add(item)
      );
    }

    if (label === "Dumbbells only") {
      ["dumbbell", "bench"].forEach((item) => out.add(item));
    }

    if (label === "Minimal (bands / bodyweight)") {
      ["bands", "bodyweight"].forEach((item) => out.add(item));
    }
  });

  return Array.from(out);
}

function mapExperienceForBackend(value) {
  const match = EXPERIENCE_OPTIONS.find((opt) => opt.key === value);
  return match?.backend || value || "Intermediate";
}

function buildOtherSessionsSummary({
  runningSessionsPerWeek,
  hyroxSessionsPerWeek,
  sportSessionsPerWeek,
  hardestConditioningDay,
  preferredRestDay,
}) {
  const parts = [];

  if (runningSessionsPerWeek > 0) {
    parts.push(`${runningSessionsPerWeek} run session(s)/week`);
  }
  if (hyroxSessionsPerWeek > 0) {
    parts.push(`${hyroxSessionsPerWeek} Hyrox session(s)/week`);
  }
  if (sportSessionsPerWeek > 0) {
    parts.push(`${sportSessionsPerWeek} sport session(s)/week`);
  }
  if (hardestConditioningDay) {
    parts.push(`hardest conditioning day: ${hardestConditioningDay}`);
  }
  if (preferredRestDay) {
    parts.push(`preferred rest day: ${preferredRestDay}`);
  }

  return parts.join(" | ");
}

function sortDays(days) {
  return [...days].sort(
    (a, b) => DAY_OPTIONS.indexOf(a) - DAY_OPTIONS.indexOf(b)
  );
}

function Chip({
  label,
  active,
  onPress,
  theme,
  compact = false,
  disabled = false,
}) {
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

function SectionHeader({ title, subtitle, theme }) {
  return (
    <View style={{ marginBottom: 16, alignItems: "center" }}>
      <Text
        style={[styles.sectionTitle, { color: theme.subtext, textAlign: "center" }]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={[styles.sectionPrompt, { color: theme.text, textAlign: "center" }]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

function OptionRow({ title, subtitle, active, onPress, theme, leftIcon }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[
        styles.optionRow,
        {
          borderColor: active ? theme.accent : theme.border,
          backgroundColor: theme.cardSoft,
        },
      ]}
    >
      {leftIcon ? (
        <View
          style={[
            styles.optionIconWrap,
            { borderColor: active ? theme.accent : theme.border },
          ]}
        >
          <Feather
            name={leftIcon}
            size={16}
            color={active ? theme.accent : theme.subtext}
          />
        </View>
      ) : null}

      <View style={styles.optionTextBlock}>
        <Text style={[styles.optionTitle, { color: theme.text }]}>{title}</Text>
        {!!subtitle ? (
          <Text style={[styles.optionSubtitle, { color: theme.subtext }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          styles.optionTick,
          {
            borderColor: active ? theme.accent : theme.border,
            backgroundColor: active ? theme.accent : "transparent",
          },
        ]}
      >
        {active ? <Feather name="check" size={14} color="#0B1215" /> : null}
      </View>
    </TouchableOpacity>
  );
}

export default function CreateStrengthPlan() {
  const theme = useScreenTheme();
  const router = useRouter();
  const user = auth.currentUser;

  const [step, setStep] = useState(0);

  const [goalType, setGoalType] = useState("Hypertrophy biased");
  const [primaryFocus, setPrimaryFocus] = useState("Muscle size");
  const [secondaryFocus, setSecondaryFocus] = useState([]);
  const [planLengthWeeks, setPlanLengthWeeks] = useState(12);

  const [experienceLevel, setExperienceLevel] = useState("Regular lifter");
  const [currentSquat, setCurrentSquat] = useState("");
  const [currentBench, setCurrentBench] = useState("");
  const [currentDeadlift, setCurrentDeadlift] = useState("");
  const [trainingAgeYears, setTrainingAgeYears] = useState("");
  const [bodyweightKg, setBodyweightKg] = useState("");

  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [preferredSplit, setPreferredSplit] = useState("Upper / lower");
  const [sessionLength, setSessionLength] = useState("60-75 min");

  const [preferredDays, setPreferredDays] = useState(["Mon", "Tue", "Thu", "Sat"]);
  const [preferredRestDay, setPreferredRestDay] = useState("Sun");
  const [runningSessionsPerWeek, setRunningSessionsPerWeek] = useState(0);
  const [hyroxSessionsPerWeek, setHyroxSessionsPerWeek] = useState(0);
  const [sportSessionsPerWeek, setSportSessionsPerWeek] = useState(0);
  const [hardestConditioningDay, setHardestConditioningDay] = useState("");
  const [recoveryCapacity, setRecoveryCapacity] = useState("Moderate");
  const [sleepQuality, setSleepQuality] = useState("Average");
  const [stressLevel, setStressLevel] = useState("Moderate");

  const [progressionStyle, setProgressionStyle] = useState(
    "Simple progressive overload"
  );
  const [priorityLifts, setPriorityLifts] = useState([]);
  const [liftsToAvoid, setLiftsToAvoid] = useState("");
  const [preferredExerciseStyle, setPreferredExerciseStyle] = useState(
    "Mixed / balanced"
  );
  const [overheadBarbellAllowed, setOverheadBarbellAllowed] = useState(true);
  const [fixedMainLifts, setFixedMainLifts] = useState(true);

  const [equipmentLabels, setEquipmentLabels] = useState(["Commercial gym"]);
  const [weakAreas, setWeakAreas] = useState([]);
  const [injuries, setInjuries] = useState("");
  const [constraints, setConstraints] = useState("");
  const [notesForCoach, setNotesForCoach] = useState("");

  const [loading, setLoading] = useState(false);

  const toggleArrayValue = (arr, value, setFn) => {
    if (arr.includes(value)) {
      setFn(arr.filter((v) => v !== value));
    } else {
      setFn([...arr, value]);
    }
  };

  const equipment = useMemo(
    () => expandEquipmentAccess(equipmentLabels),
    [equipmentLabels]
  );

  const clampedPreferredDays = useMemo(() => {
    return sortDays(preferredDays.filter((d) => DAY_OPTIONS.includes(d))).slice(
      0,
      daysPerWeek
    );
  }, [preferredDays, daysPerWeek]);

  const structuredOtherSessions = useMemo(
    () =>
      buildOtherSessionsSummary({
        runningSessionsPerWeek,
        hyroxSessionsPerWeek,
        sportSessionsPerWeek,
        hardestConditioningDay,
        preferredRestDay,
      }),
    [
      runningSessionsPerWeek,
      hyroxSessionsPerWeek,
      sportSessionsPerWeek,
      hardestConditioningDay,
      preferredRestDay,
    ]
  );

  const canSubmit = useMemo(
    () =>
      Boolean(
        goalType &&
          primaryFocus &&
          experienceLevel &&
          daysPerWeek &&
          preferredSplit &&
          sessionLength &&
          planLengthWeeks &&
          equipment.length &&
          clampedPreferredDays.length > 0
      ),
    [
      goalType,
      primaryFocus,
      experienceLevel,
      daysPerWeek,
      preferredSplit,
      sessionLength,
      planLengthWeeks,
      equipment.length,
      clampedPreferredDays.length,
    ]
  );

  const summaryText = useMemo(() => {
    const focus = primaryFocus || "Focus";
    const split = preferredSplit || "Split";
    return `${goalType} · ${focus} · ${daysPerWeek}x/wk · ${split}`;
  }, [goalType, primaryFocus, daysPerWeek, preferredSplit]);

  const isStepValid = (s) => {
    switch (s) {
      case 0:
        return Boolean(goalType && primaryFocus && planLengthWeeks);
      case 1:
        return Boolean(experienceLevel);
      case 2:
        return Boolean(daysPerWeek && preferredSplit && sessionLength);
      case 3:
        return Boolean(
          clampedPreferredDays.length > 0 &&
            clampedPreferredDays.length <= daysPerWeek &&
            recoveryCapacity &&
            sleepQuality &&
            stressLevel
        );
      case 4:
        return Boolean(progressionStyle && preferredExerciseStyle);
      case 5:
        return Boolean(equipment.length);
      case 6:
      default:
        return true;
    }
  };

  const confirmReplaceActivePlan = async (uid) => {
    try {
      const plansRef = collection(db, "users", uid, "plans");
      const snap = await getDocs(
        query(plansRef, orderBy("updatedAt", "desc"), limit(25))
      );
      if (snap.empty) return true;

      const hasExistingStrengthPlan = snap.docs.some((d) =>
        isStrengthPlanDoc(d.data() || {})
      );
      if (!hasExistingStrengthPlan) return true;

      return await new Promise((resolve) => {
        Alert.alert(
          "Replace existing strength plan?",
          "You already have a strength plan. Creating another strength plan may replace the currently shown strength block, but your running plan stays available.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            {
              text: "Replace",
              style: "destructive",
              onPress: () => resolve(true),
            },
          ]
        );
      });
    } catch (e) {
      console.log("[create-strength] failed to check existing plans:", e);
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

  const handleGenerate = async () => {
    if (!canSubmit) {
      Alert.alert(
        "More info needed",
        "Please complete the core setup before generating your plan."
      );
      return;
    }

    const uid = user?.uid;
    if (!uid) {
      Alert.alert("Not signed in", "You need to be logged in to save a plan.");
      return;
    }

    const okToReplace = await confirmReplaceActivePlan(uid);
    if (!okToReplace) return;

    setLoading(true);

    try {
      const squatNum = parseOptionalNumber(currentSquat);
      const benchNum = parseOptionalNumber(currentBench);
      const deadliftNum = parseOptionalNumber(currentDeadlift);
      const trainingAgeNum = parseOptionalNumber(trainingAgeYears);
      const bodyweightNum = parseOptionalNumber(bodyweightKg);

      const exercisePreferenceNotes = [
        priorityLifts.length ? `Priority lifts: ${priorityLifts.join(", ")}` : "",
        liftsToAvoid ? `Lifts to avoid: ${liftsToAvoid}` : "",
        preferredExerciseStyle ? `Exercise style: ${preferredExerciseStyle}` : "",
        overheadBarbellAllowed ? "Overhead barbell allowed" : "Avoid overhead barbell",
        fixedMainLifts
          ? "Keep main lifts stable across the block"
          : "Open to more exercise rotation",
        progressionStyle ? `Preferred progression: ${progressionStyle}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const recoveryNotes = [
        `Recovery capacity: ${recoveryCapacity}`,
        `Sleep quality: ${sleepQuality}`,
        `Stress level: ${stressLevel}`,
      ].join(" | ");

      const payload = removeUndefinedDeep({
        athleteProfile: {
          goalType,
          primaryFocus,
          secondaryFocus,
          planLengthWeeks,
          experienceLevel: mapExperienceForBackend(experienceLevel),
          experienceLabel: experienceLevel,

          currentSquat: squatNum,
          currentBench: benchNum,
          currentDeadlift: deadliftNum,
          trainingAgeYears: trainingAgeNum,
          bodyweightKg: bodyweightNum,

          daysPerWeek,
          preferredDays: clampedPreferredDays,
          preferredRestDay,
          preferredSplit,
          sessionLength,

          otherSessions: structuredOtherSessions,
          equipment,
          equipmentAccessLabels: equipmentLabels,
          weakAreas,
          injuries,
          constraints: [constraints, exercisePreferenceNotes]
            .filter(Boolean)
            .join(" | "),
          notesForCoach: [notesForCoach, recoveryNotes]
            .filter(Boolean)
            .join(" | "),

          recoveryCapacity,
          sleepQuality,
          stressLevel,

          runningSessionsPerWeek,
          hyroxSessionsPerWeek,
          sportSessionsPerWeek,
          hardestConditioningDay,

          progressionStyle,
          priorityLifts,
          liftsToAvoid,
          preferredExerciseStyle,
          overheadBarbellAllowed,
          fixedMainLifts,
        },
      });

      const response = await fetch(`${API_URL}/generate-strength`, {
        method: "POST",
        headers: await getJsonAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      let data = null;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      const generatedPlan = data?.plan || data;
      if (!generatedPlan || !Array.isArray(generatedPlan.weeks)) {
        throw new Error("Strength plan response missing weeks.");
      }

      if (!generatedPlan.weeks.length) {
        throw new Error("Strength plan returned with no weeks.");
      }

      const planDoc = {
        ...generatedPlan,
        kind: "strength",
        name: generatedPlan.name || "Strength / Hypertrophy Plan",
        primaryActivity: generatedPlan.primaryActivity || "Strength",
        goalType,
        primaryFocus,
        secondaryFocus,
        sessionsPerWeek: daysPerWeek,
        planLengthWeeks,
        preferredSplit,
        sessionLength,
        preferredDays: clampedPreferredDays,
        preferredRestDay,
        recoveryCapacity,
        sleepQuality,
        stressLevel,
        runningSessionsPerWeek,
        hyroxSessionsPerWeek,
        sportSessionsPerWeek,
        hardestConditioningDay,
        progressionStyle,
        priorityLifts,
        liftsToAvoid,
        preferredExerciseStyle,
        fixedMainLifts,
        overheadBarbellAllowed,
        equipmentAccessLabels: equipmentLabels,
        equipmentDetailed: equipment,
        source: generatedPlan.source || "generate-strength",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const cleanedPlanDoc = removeUndefinedDeep(planDoc);
      await addDoc(collection(db, "users", uid, "plans"), cleanedPlanDoc);

      Alert.alert(
        "Plan created",
        "Your strength plan has been saved and is now visible on the Train page."
      );
      router.replace("/train");
    } catch (e) {
      console.log("[create-strength] AI / save error:", e);
      Alert.alert(
        "Error",
        e?.message ||
          "Something went wrong generating or saving your strength plan."
      );
    } finally {
      setLoading(false);
    }
  };

  const renderGoalStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 1"
        subtitle="What is your strength goal?"
        theme={theme}
      />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Pick the main outcome you want this block to drive.
      </Text>

      <View style={{ gap: 8 }}>
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

      <View style={{ marginTop: 10 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Main focus</Text>
        <View style={styles.chipRow}>
          {FOCUS_AREAS_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={primaryFocus === opt}
              onPress={() => setPrimaryFocus(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Secondary focus (optional)
        </Text>
        <View style={styles.chipRow}>
          {FOCUS_AREAS_OPTIONS.map((opt) => (
            <Chip
              key={`secondary-${opt}`}
              label={opt}
              theme={theme}
              compact
              active={secondaryFocus.includes(opt)}
              onPress={() => toggleArrayValue(secondaryFocus, opt, setSecondaryFocus)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Plan length</Text>
        <View style={styles.chipRow}>
          {PLAN_LENGTH_OPTIONS.map((w) => (
            <Chip
              key={w}
              label={`${w} weeks`}
              theme={theme}
              compact
              active={planLengthWeeks === w}
              onPress={() => setPlanLengthWeeks(w)}
            />
          ))}
        </View>
      </View>
    </View>
  );

  const renderCurrentLevelStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 2"
        subtitle="How would you rate your lifting level?"
        theme={theme}
      />

      <View style={{ gap: 8 }}>
        {EXPERIENCE_OPTIONS.map((opt) => (
          <OptionRow
            key={opt.key}
            title={opt.title}
            subtitle={opt.blurb}
            leftIcon="bar-chart-2"
            theme={theme}
            active={experienceLevel === opt.key}
            onPress={() => setExperienceLevel(opt.key)}
          />
        ))}
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Current stats (optional)
        </Text>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Squat (kg)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 120"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={currentSquat}
              onChangeText={setCurrentSquat}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Bench (kg)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 90"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={currentBench}
              onChangeText={setCurrentBench}
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Deadlift (kg)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 150"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={currentDeadlift}
              onChangeText={setCurrentDeadlift}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Training age (years)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 3"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={trainingAgeYears}
              onChangeText={setTrainingAgeYears}
            />
          </View>
        </View>

        <View>
          <Text style={[styles.miniLabel, { color: theme.subtext }]}>
            Bodyweight (kg, optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.cardSoft,
                color: theme.text,
              },
            ]}
            placeholder="e.g. 78"
            placeholderTextColor={theme.subtext}
            keyboardType="numeric"
            value={bodyweightKg}
            onChangeText={setBodyweightKg}
          />
        </View>
      </View>
    </View>
  );

  const renderWeeklyStructureStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 3"
        subtitle="How should your week be structured?"
        theme={theme}
      />

      <View style={{ marginBottom: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Lifting days per week
        </Text>
        <View style={styles.chipRow}>
          {DAYS_PER_WEEK_OPTIONS.map((n) => (
            <Chip
              key={n}
              label={`${n}x`}
              theme={theme}
              compact
              active={daysPerWeek === n}
              onPress={() => {
                setDaysPerWeek(n);
                setPreferredDays((prev) => sortDays(prev).slice(0, n));
              }}
            />
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Preferred split</Text>
        <View style={styles.chipRow}>
          {SPLIT_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={preferredSplit === opt}
              onPress={() => setPreferredSplit(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Session length</Text>
        <View style={styles.chipRow}>
          {SESSION_LENGTH_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={sessionLength === opt}
              onPress={() => setSessionLength(opt)}
            />
          ))}
        </View>
      </View>
    </View>
  );

  const renderScheduleRecoveryStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 4"
        subtitle="Which days suit you best, and how well do you recover?"
        theme={theme}
      />

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Preferred lifting days (pick up to {daysPerWeek})
        </Text>
        <View style={styles.chipRow}>
          {DAY_OPTIONS.map((day) => {
            const active = preferredDays.includes(day);
            const disabled = !active && preferredDays.length >= daysPerWeek;

            return (
              <Chip
                key={day}
                label={day}
                theme={theme}
                compact
                active={active}
                disabled={disabled}
                onPress={() => {
                  if (active) {
                    setPreferredDays((prev) => prev.filter((d) => d !== day));
                    return;
                  }
                  if (preferredDays.length < daysPerWeek) {
                    setPreferredDays((prev) => sortDays([...prev, day]));
                  }
                }}
              />
            );
          })}
        </View>
      </View>

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Preferred rest day
        </Text>
        <View style={styles.chipRow}>
          {DAY_OPTIONS.map((day) => (
            <Chip
              key={`rest-${day}`}
              label={day}
              theme={theme}
              compact
              active={preferredRestDay === day}
              onPress={() => setPreferredRestDay(day)}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Runs per week
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="0"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={String(runningSessionsPerWeek)}
              onChangeText={(v) => setRunningSessionsPerWeek(Number(v) || 0)}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Hyrox sessions
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="0"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={String(hyroxSessionsPerWeek)}
              onChangeText={(v) => setHyroxSessionsPerWeek(Number(v) || 0)}
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Sport sessions
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="0"
              placeholderTextColor={theme.subtext}
              keyboardType="numeric"
              value={String(sportSessionsPerWeek)}
              onChangeText={(v) => setSportSessionsPerWeek(Number(v) || 0)}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>
              Hardest conditioning day
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. Thu"
              placeholderTextColor={theme.subtext}
              value={hardestConditioningDay}
              onChangeText={setHardestConditioningDay}
            />
          </View>
        </View>
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Recovery capacity
        </Text>
        <View style={styles.chipRow}>
          {RECOVERY_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={recoveryCapacity === opt}
              onPress={() => setRecoveryCapacity(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Sleep quality</Text>
        <View style={styles.chipRow}>
          {SLEEP_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={sleepQuality === opt}
              onPress={() => setSleepQuality(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Stress level</Text>
        <View style={styles.chipRow}>
          {STRESS_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={stressLevel === opt}
              onPress={() => setStressLevel(opt)}
            />
          ))}
        </View>
      </View>
    </View>
  );

  const renderExerciseProfileStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 5"
        subtitle="How do you want the training to feel?"
        theme={theme}
      />

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Preferred progression style
        </Text>
        <View style={styles.chipRow}>
          {PROGRESSION_STYLE_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={progressionStyle === opt}
              onPress={() => setProgressionStyle(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Priority lifts (optional)
        </Text>
        <View style={styles.chipRow}>
          {PRIORITY_LIFT_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={priorityLifts.includes(opt)}
              onPress={() => toggleArrayValue(priorityLifts, opt, setPriorityLifts)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Exercise style</Text>
        <View style={styles.chipRow}>
          {EXERCISE_STYLE_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={preferredExerciseStyle === opt}
              onPress={() => setPreferredExerciseStyle(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Barbell overhead work
        </Text>
        <View style={styles.chipRow}>
          <Chip
            label="Allowed"
            theme={theme}
            compact
            active={overheadBarbellAllowed}
            onPress={() => setOverheadBarbellAllowed(true)}
          />
          <Chip
            label="Avoid"
            theme={theme}
            compact
            active={!overheadBarbellAllowed}
            onPress={() => setOverheadBarbellAllowed(false)}
          />
        </View>
      </View>

      <View style={{ marginBottom: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Main lift stability
        </Text>
        <View style={styles.chipRow}>
          <Chip
            label="Keep main lifts stable"
            theme={theme}
            compact
            active={fixedMainLifts}
            onPress={() => setFixedMainLifts(true)}
          />
          <Chip
            label="More exercise rotation"
            theme={theme}
            compact
            active={!fixedMainLifts}
            onPress={() => setFixedMainLifts(false)}
          />
        </View>
      </View>

      <View>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Lifts to avoid (optional)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.cardSoft,
              color: theme.text,
              minHeight: 72,
              textAlignVertical: "top",
            },
          ]}
          placeholder="e.g. dips, high-bar squat, barbell overhead press"
          placeholderTextColor={theme.subtext}
          value={liftsToAvoid}
          onChangeText={setLiftsToAvoid}
          multiline
        />
      </View>
    </View>
  );

  const renderPreferencesStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 6"
        subtitle="Preferences and constraints"
        theme={theme}
      />

      <View style={{ marginBottom: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Equipment access
        </Text>
        <View style={styles.chipRow}>
          {EQUIPMENT_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={equipmentLabels.includes(opt)}
              onPress={() => toggleArrayValue(equipmentLabels, opt, setEquipmentLabels)}
            />
          ))}
        </View>
        <Text style={[styles.helperText, { color: theme.subtext }]}>
          Detailed equipment passed to the generator:{" "}
          {equipment.length ? equipment.join(", ") : "None"}
        </Text>
      </View>

      <View style={{ marginBottom: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Weak areas</Text>
        <View style={styles.chipRow}>
          {WEAK_AREAS_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={weakAreas.includes(opt)}
              onPress={() => toggleArrayValue(weakAreas, opt, setWeakAreas)}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <View>
          <Text style={[styles.label, { color: theme.subtext }]}>
            Injuries / restrictions
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.cardSoft,
                color: theme.text,
                minHeight: 72,
                textAlignVertical: "top",
              },
            ]}
            placeholder="e.g. lower back history, shoulder impingement"
            placeholderTextColor={theme.subtext}
            value={injuries}
            onChangeText={setInjuries}
            multiline
          />
        </View>

        <View>
          <Text style={[styles.label, { color: theme.subtext }]}>
            Constraints / preferences
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.cardSoft,
                color: theme.text,
                minHeight: 72,
                textAlignVertical: "top",
              },
            ]}
            placeholder="e.g. prefer machines, avoid jumping, need lower body away from long run"
            placeholderTextColor={theme.subtext}
            value={constraints}
            onChangeText={setConstraints}
            multiline
          />
        </View>

        <View>
          <Text style={[styles.label, { color: theme.subtext }]}>
            Notes for coach (optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.cardSoft,
                color: theme.text,
                minHeight: 72,
                textAlignVertical: "top",
              },
            ]}
            placeholder="Add context that should shape exercise choices and progression."
            placeholderTextColor={theme.subtext}
            value={notesForCoach}
            onChangeText={setNotesForCoach}
            multiline
          />
        </View>
      </View>
    </View>
  );

  const renderReviewStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 7"
        subtitle="Review your strength plan setup"
        theme={theme}
      />

      <View
        style={[
          styles.reviewCard,
          { borderColor: theme.border, backgroundColor: theme.cardSoft },
        ]}
      >
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Goal: {goalType}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Main focus: {primaryFocus}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Experience: {mapExperienceForBackend(experienceLevel)}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Frequency: {daysPerWeek} sessions/week
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Preferred days: {clampedPreferredDays.join(", ") || "Not set"}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Rest day: {preferredRestDay || "Not set"}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Split: {preferredSplit}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Session length: {sessionLength}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Block length: {planLengthWeeks} weeks
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Equipment: {equipment.length ? equipment.join(", ") : "Not set"}
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Recovery: {recoveryCapacity} · {sleepQuality} sleep · {stressLevel} stress
        </Text>
        <Text style={[styles.reviewLine, { color: theme.text }]}>
          Progression: {progressionStyle}
        </Text>
      </View>

      {secondaryFocus.length ? (
        <Text style={[styles.helperText, { color: theme.subtext }]}>
          Secondary focus: {secondaryFocus.join(" · ")}
        </Text>
      ) : null}

      {weakAreas.length ? (
        <Text style={[styles.helperText, { color: theme.subtext }]}>
          Weak areas: {weakAreas.join(" · ")}
        </Text>
      ) : null}

      {priorityLifts.length ? (
        <Text style={[styles.helperText, { color: theme.subtext }]}>
          Priority lifts: {priorityLifts.join(" · ")}
        </Text>
      ) : null}

      {structuredOtherSessions ? (
        <Text style={[styles.helperText, { color: theme.subtext }]}>
          Other training: {structuredOtherSessions}
        </Text>
      ) : null}
    </View>
  );

  const isLastStep = step === STEPS.length - 1;
  const stepReady = isStepValid(step);
  const nextDisabled = loading || (!stepReady && !isLastStep);
  const generateDisabled = loading || (isLastStep && !canSubmit);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={() => (step === 0 ? router.back() : handleBack())}
              style={[
                styles.iconCircle,
                { borderColor: theme.border, backgroundColor: theme.pillBg },
              ]}
              activeOpacity={0.85}
            >
              <Feather name="arrow-left" size={20} color={theme.text} />
            </TouchableOpacity>

            <View style={{ flex: 1, alignItems: "center" }}>
              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: theme.progressTrack, width: "75%" },
                ]}
              >
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
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  marginTop: 8,
                  textAlign: "center",
                  width: "100%",
                }}
              >
                {step + 1}/{STEPS.length} · {STEPS[step]}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => router.back()}
              style={[
                styles.iconCircle,
                { borderColor: theme.border, backgroundColor: theme.pillBg },
              ]}
              activeOpacity={0.85}
            >
              <Feather name="x" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.summaryStrip}>
            <Text style={{ color: theme.text, fontWeight: "900", textAlign: "center" }}>
              {summaryText}
            </Text>
            <Text
              style={{
                color: theme.subtext,
                fontSize: 11,
                marginTop: 4,
                textAlign: "center",
              }}
            >
              Strength block setup tailored to your schedule, recovery, and
              exercise preferences.
            </Text>
          </View>

          <View style={styles.stepStage}>
            <View style={styles.stepInner}>
              {step === 0 && renderGoalStep()}
              {step === 1 && renderCurrentLevelStep()}
              {step === 2 && renderWeeklyStructureStep()}
              {step === 3 && renderScheduleRecoveryStep()}
              {step === 4 && renderExerciseProfileStep()}
              {step === 5 && renderPreferencesStep()}
              {step === 6 && renderReviewStep()}
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.stickyBar,
            { borderTopColor: theme.border, backgroundColor: theme.bg },
          ]}
        >
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
                <Feather
                  name="arrow-right"
                  size={18}
                  color={nextDisabled ? "#6B7280" : "#1A1D22"}
                />
                <Text
                  style={{
                    color: nextDisabled ? "#6B7280" : "#1A1D22",
                    fontWeight: "900",
                  }}
                >
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
                {loading ? (
                  <ActivityIndicator
                    color={generateDisabled ? "#6B7280" : "#1A1D22"}
                  />
                ) : (
                  <Feather
                    name="zap"
                    size={18}
                    color={generateDisabled ? "#6B7280" : "#1A1D22"}
                  />
                )}
                <Text
                  style={{
                    color: generateDisabled ? "#6B7280" : "#1A1D22",
                    fontWeight: "900",
                  }}
                >
                  {loading ? "Building your plan..." : "Generate plan"}
                </Text>
              </TouchableOpacity>
            )}

            <View
              style={{
                marginTop: 8,
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: theme.subtext, fontSize: 11 }}>
                {isLastStep
                  ? canSubmit
                    ? "Ready to generate your plan."
                    : "Finish this question to continue."
                  : "One question per page for a fast setup."}
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingBottom: 140,
    paddingTop: 6,
  },

  topBar: {
    marginTop: 0,
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
  miniLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 6,
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

  reviewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 6,
    marginTop: 8,
  },
  reviewLine: {
    fontSize: 14,
    fontWeight: "700",
  },

  primaryBtn: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 14,
  },

  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});