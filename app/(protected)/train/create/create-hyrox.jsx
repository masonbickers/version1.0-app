// app/(protected)/train/create-hyrox.jsx
import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";
import { useAiPlan } from "../../../../src/hooks/useAiPlan";
import { convertAiPlanToApp } from "../../../../src/lib/train/planTransformers";

/* ------------------------------------------------------------------ */
/* CONFIG                                                              */
/* ------------------------------------------------------------------ */

const HYROX_CATEGORY_OPTIONS = [
  "Open Solo",
  "Pro Solo",
  "Open Doubles",
  "Pro Doubles",
  "Mixed Doubles",
  "Relay",
];

const HYROX_GOAL_FOCUS = [
  "Just finish",
  "PB / time goal",
  "Qualify for Worlds",
  "Build engine",
  "Transition from running",
];

const HYROX_EXPERIENCE_OPTIONS = [
  "Never done Hyrox",
  "Done 1 race",
  "Done 2–3 races",
  "Done 4+ races",
];

const STATION_WEAKNESS_OPTIONS = [
  "Running",
  "Sled Push",
  "Sled Pull",
  "Burpee broad jumps",
  "Row",
  "Ski",
  "Farmers carry",
  "Lunges",
  "Wall balls",
];

const STRENGTH_BACKGROUND_OPTIONS = [
  "Mainly strength",
  "Balanced strength & endurance",
  "Mainly endurance",
];

const DAYS_PER_WEEK_OPTIONS = [3, 4, 5, 6, 7];
const TRAINING_DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GYM_ACCESS_OPTIONS = [
  "Full Hyrox-style gym (sleds, ski, row, track)",
  "Most kit (ski/row + weights, but no sled track)",
  "Basic gym (cardio kit + weights, no sleds)",
  "Minimal equipment / home set-up",
];

const CROSS_TRAINING_OPTIONS = ["None", "Some", "A lot"];
const PLAN_LENGTH_OPTIONS = [6, 8, 10, 12, 16];

const STEPS = [
  "Goal",
  "Current fitness",
  "Weekly schedule",
  "Stations & constraints",
];

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
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

function formatTimeHHMMSS(date) {
  if (!date) return null;
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = "00";
  return `${h}:${m}:${s}`;
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

/* ------------------------------------------------------------------ */
/* THEME + UI PRIMITIVES                                               */
/* ------------------------------------------------------------------ */

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";

  return {
    isDark,
    bg: isDark ? "#050506" : "#F5F5F7",
    card: isDark ? "#111217" : "#FFFFFF",
    cardSoft: isDark ? "#0B0C10" : "#F3F4F6",
    text: colors.text,
    subtext: colors.subtext,
    border: isDark ? "rgba(255,255,255,0.10)" : "#E1E3E8",
    muted: colors.muted || (isDark ? "#18181B" : "#E5E7EB"),
    primaryBg: accent,
    primaryText: "#111111",
    pillBg: isDark ? "#111217" : "#FFFFFF",
    progressTrack: isDark
      ? "rgba(230,255,59,0.24)"
      : "rgba(230,255,59,0.32)",
    accent,
  };
}

function Chip({
  label,
  active,
  onPress,
  theme,
  compact = false,
  disabled = false,
  style,
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

/* ------------------------------------------------------------------ */
/* MAIN SCREEN                                                         */
/* ------------------------------------------------------------------ */

export default function CreateHyroxPlan() {
  const theme = useScreenTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;
  const { createPlan: createAiPlan } = useAiPlan();

  const initialStep = useMemo(() => {
    const raw = params?.step;
    if (!raw) return 0;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n < STEPS.length ? n : 0;
  }, [params?.step]);

  const [step, setStep] = useState(initialStep);

  // Goal
  const [hyroxCategory, setHyroxCategory] = useState("Pro Solo");
  const [hyroxGoalFocus, setHyroxGoalFocus] = useState("PB / time goal");
  const [targetEventName, setTargetEventName] = useState("");
  const [eventLocation, setEventLocation] = useState("");

  const [eventDate, setEventDate] = useState(null);
  const [dateUnknown, setDateUnknown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [planLengthWeeks, setPlanLengthWeeks] = useState(12);

  const [timeGoalMode, setTimeGoalMode] = useState("Just finish");
  const [timeGoalDate, setTimeGoalDate] = useState(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Current fitness
  const [hyroxExperience, setHyroxExperience] = useState("Done 1 race");
  const [hyroxBestTime, setHyroxBestTime] = useState("");
  const [recent5kRun, setRecent5kRun] = useState("");
  const [recent10kRun, setRecent10kRun] = useState("");
  const [row1kTime, setRow1kTime] = useState("");
  const [ski1kTime, setSki1kTime] = useState("");
  const [strengthBackground, setStrengthBackground] = useState(
    "Balanced strength & endurance"
  );

  // Weekly schedule
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
  const [trainingDays, setTrainingDays] = useState([]);
  const [weekNotes, setWeekNotes] = useState("");

  // Stations & constraints
  const [weakStations, setWeakStations] = useState([]);
  const [gymAccess, setGymAccess] = useState(
    "Most kit (ski/row + weights, but no sled track)"
  );
  const [crossTrainingPreference, setCrossTrainingPreference] = useState("Some");
  const [injuries, setInjuries] = useState("");
  const [constraints, setConstraints] = useState("");

  const [loading, setLoading] = useState(false);

  const effectiveTargetDate = dateUnknown
    ? "Unknown"
    : eventDate
    ? formatDateYYYYMMDD(eventDate)
    : null;

  const effectiveTimeGoal =
    timeGoalMode === "Just finish"
      ? "Just finish"
      : timeGoalDate
      ? formatTimeHHMMSS(timeGoalDate)
      : null;

  const hasTargetDate = !!eventDate && !dateUnknown;

  const toggleArrayValue = (arr, value, setFn) => {
    if (arr.includes(value)) {
      setFn(arr.filter((v) => v !== value));
    } else {
      setFn([...arr, value]);
    }
  };

  const canSubmit = useMemo(
    () =>
      Boolean(
        hyroxCategory &&
          hyroxGoalFocus &&
          hyroxExperience &&
          sessionsPerWeek &&
          (!hasTargetDate && !effectiveTargetDate ? planLengthWeeks : true)
      ),
    [
      hyroxCategory,
      hyroxGoalFocus,
      hyroxExperience,
      sessionsPerWeek,
      hasTargetDate,
      effectiveTargetDate,
      planLengthWeeks,
    ]
  );

  const summaryText = useMemo(() => {
    const eventLabel = targetEventName ? targetEventName : hyroxCategory;
    const timeline = hasTargetDate
      ? formatDatePretty(eventDate)
      : `${planLengthWeeks}w`;
    return `${eventLabel} · ${hyroxGoalFocus} · ${sessionsPerWeek}x/wk · ${timeline}`;
  }, [
    targetEventName,
    hyroxCategory,
    hyroxGoalFocus,
    sessionsPerWeek,
    hasTargetDate,
    eventDate,
    planLengthWeeks,
  ]);

  const isStepValid = (s) => {
    switch (s) {
      case 0: {
        const hasGoal = Boolean(hyroxCategory && hyroxGoalFocus);
        const needsLength = !eventDate && dateUnknown;
        const hasLength = !!planLengthWeeks;
        return needsLength ? hasGoal && hasLength : hasGoal;
      }
      case 1:
        return Boolean(hyroxExperience);
      case 2:
        return Boolean(sessionsPerWeek);
      case 3:
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!isStepValid(step)) {
      Alert.alert(
        "More info needed",
        "Please complete this section before continuing."
      );
      return;
    }
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 0));
  };

  const confirmReplaceActivePlan = async (uid) => {
    try {
      const plansRef = collection(db, "users", uid, "plans");
      const snap = await getDocs(
        query(plansRef, orderBy("updatedAt", "desc"), limit(1))
      );

      if (snap.empty) return true;

      return await new Promise((resolve) => {
        Alert.alert(
          "Replace current plan?",
          "You already have an active training plan. Creating a new one will replace it on your Train page. Continue?",
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
      console.log("[create-hyrox] failed to check existing plans:", e);
      return true;
    }
  };

  const handleGenerate = async () => {
    if (!canSubmit) {
      Alert.alert(
        "More info needed",
        "Please at least set your Hyrox category, goal and sessions per week."
      );
      return;
    }

    const uid = user?.uid;
    if (!uid) {
      Alert.alert(
        "Not signed in",
        "You need to be logged in to save a training plan."
      );
      return;
    }

    const okToReplace = await confirmReplaceActivePlan(uid);
    if (!okToReplace) return;

    const goalType = "Hyrox";
    const weeksCount = hasTargetDate ? undefined : planLengthWeeks;
    const targetEventDate =
      hasTargetDate && effectiveTargetDate && effectiveTargetDate !== "Unknown"
        ? effectiveTargetDate
        : "";
    const targetTime =
      effectiveTimeGoal && effectiveTimeGoal !== "Just finish"
        ? effectiveTimeGoal
        : "";

    const extraNotesParts = [
      `Hyrox category: ${hyroxCategory}`,
      `Hyrox goal focus: ${hyroxGoalFocus}`,
      hyroxExperience ? `Hyrox experience: ${hyroxExperience}` : null,
      hyroxBestTime
        ? `Best Hyrox time: ${hyroxBestTime}`
        : "Best Hyrox time: not given",
      recent5kRun ? `Recent 5K: ${recent5kRun}` : null,
      recent10kRun ? `Recent 10K: ${recent10kRun}` : null,
      row1kTime ? `Row 1K: ${row1kTime}` : null,
      ski1kTime ? `Ski 1K: ${ski1kTime}` : null,
      strengthBackground
        ? `Strength/endurance profile: ${strengthBackground}`
        : null,
      `Sessions per week: ${sessionsPerWeek}`,
      trainingDays.length
        ? `Preferred training days: ${trainingDays.join(", ")}`
        : null,
      weekNotes ? `Week notes: ${weekNotes}` : null,
      weakStations.length
        ? `Weaker stations to prioritise: ${weakStations.join(", ")}`
        : null,
      `Gym access: ${gymAccess}`,
      `Cross training: ${crossTrainingPreference}`,
      injuries ? `Injuries: ${injuries}` : null,
      constraints ? `Other constraints: ${constraints}` : null,
      targetEventName
        ? `Target event: ${targetEventName}${
            eventLocation ? ` in ${eventLocation}` : ""
          }${targetEventDate ? ` on ${targetEventDate}` : ""}`
        : null,
    ].filter(Boolean);

    const extraNotes = extraNotesParts.join(" | ");

    setLoading(true);
    try {
      const aiPlan = await createAiPlan({
        userId: uid,
        goalType,
        targetEventDate,
        targetTime,
        current10kTime: recent10kRun || "",
        sessionsPerWeek,
        weeks: weeksCount,
        goal: `Hyrox ${hyroxCategory} – ${hyroxGoalFocus}`,
        primaryActivity: "Hyrox",
        extraNotes,
      });

      const appPlan = convertAiPlanToApp(aiPlan) || {};

      const planDoc = {
        ...appPlan,
        name:
          appPlan.name ||
          (targetEventName
            ? `${targetEventName} – Hyrox ${hyroxCategory}`
            : `Hyrox ${hyroxCategory} plan`),
        primaryActivity: appPlan.primaryActivity || "Hyrox",
        goalDistance: `Hyrox ${hyroxCategory}`,
        goalPrimaryFocus: hyroxGoalFocus || "",
        targetEventName: targetEventName || "",
        targetEventDate,
        targetTime,
        source: "ai-hyrox",
        meta: {
          hyroxCategory,
          hyroxGoalFocus,
          hyroxExperience,
          hyroxBestTime,
          recent5kRun,
          recent10kRun,
          row1kTime,
          ski1kTime,
          strengthBackground,
          sessionsPerWeek,
          trainingDays,
          weakStations,
          gymAccess,
          crossTrainingPreference,
          injuries,
          constraints,
          eventLocation,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const cleanedPlanDoc = removeUndefinedDeep(planDoc);
      await addDoc(collection(db, "users", uid, "plans"), cleanedPlanDoc);

      Alert.alert(
        "Plan created",
        "Your Hyrox plan has been saved and is now visible on the Train page."
      );
      router.replace("/train");
    } catch (e) {
      console.log("[create-hyrox] AI / save error:", e);
      Alert.alert(
        "Error",
        e?.message || "Something went wrong generating or saving your plan."
      );
    } finally {
      setLoading(false);
    }
  };

  const renderGoalStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 1"
        subtitle="What is your Hyrox goal?"
        theme={theme}
      />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Set the race format, timeline and finish target so the plan matches the event.
      </Text>

      <View style={{ marginTop: 4, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Category</Text>
        <View style={styles.chipRow}>
          {HYROX_CATEGORY_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={hyroxCategory === opt}
              onPress={() => setHyroxCategory(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Primary goal</Text>
        <View style={styles.chipRow}>
          {HYROX_GOAL_FOCUS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={hyroxGoalFocus === opt}
              onPress={() => setHyroxGoalFocus(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Event details (optional)</Text>

        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.cardSoft,
              color: theme.text,
            },
          ]}
          placeholder="e.g. Hyrox London"
          placeholderTextColor={theme.subtext}
          value={targetEventName}
          onChangeText={setTargetEventName}
        />

        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.cardSoft,
              color: theme.text,
            },
          ]}
          placeholder="Location (optional)"
          placeholderTextColor={theme.subtext}
          value={eventLocation}
          onChangeText={setEventLocation}
        />
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Event date</Text>

        <TouchableOpacity
          onPress={() => {
            setDateUnknown(false);
            setShowDatePicker(true);
          }}
          activeOpacity={0.9}
          style={[
            styles.optionRow,
            {
              borderColor: eventDate ? theme.accent : theme.border,
              backgroundColor: theme.cardSoft,
            },
          ]}
        >
          <View
            style={[
              styles.optionIconWrap,
              { borderColor: eventDate ? theme.accent : theme.border },
            ]}
          >
            <Feather
              name="calendar"
              size={16}
              color={eventDate ? theme.accent : theme.subtext}
            />
          </View>

          <View style={styles.optionTextBlock}>
            <Text style={[styles.optionTitle, { color: theme.text }]}>
              {eventDate ? formatDatePretty(eventDate) : "Select event date"}
            </Text>
            <Text style={[styles.optionSubtitle, { color: theme.subtext }]}>
              Use a fixed date if you already know your race.
            </Text>
          </View>

          <View style={styles.optionRightSlot}>
            <Feather name="chevron-right" size={16} color={theme.subtext} />
          </View>
        </TouchableOpacity>

        <OptionRow
          title="I’m not sure of the date yet"
          subtitle="Build a fixed-length block instead"
          leftIcon="clock"
          theme={theme}
          active={dateUnknown}
          onPress={() => {
            setDateUnknown((prev) => !prev);
            if (!dateUnknown) setEventDate(null);
          }}
        />
      </View>

      {!hasTargetDate && (
        <View style={{ marginTop: 10, gap: 8 }}>
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
      )}

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Finish target</Text>

        <View style={styles.chipRow}>
          <Chip
            label="Just finish"
            theme={theme}
            compact
            active={timeGoalMode === "Just finish"}
            onPress={() => {
              setTimeGoalMode("Just finish");
              setTimeGoalDate(null);
            }}
          />
          <Chip
            label="Time goal"
            theme={theme}
            compact
            active={timeGoalMode === "Time goal"}
            onPress={() => setTimeGoalMode("Time goal")}
          />
        </View>

        {timeGoalMode === "Time goal" ? (
          <TouchableOpacity
            onPress={() => setShowTimePicker(true)}
            activeOpacity={0.9}
            style={[
              styles.optionRow,
              {
                borderColor: timeGoalDate ? theme.accent : theme.border,
                backgroundColor: theme.cardSoft,
              },
            ]}
          >
            <View
              style={[
                styles.optionIconWrap,
                { borderColor: timeGoalDate ? theme.accent : theme.border },
              ]}
            >
              <Feather
                name="clock"
                size={16}
                color={timeGoalDate ? theme.accent : theme.subtext}
              />
            </View>

            <View style={styles.optionTextBlock}>
              <Text style={[styles.optionTitle, { color: theme.text }]}>
                {timeGoalDate
                  ? formatTimeHHMMSS(timeGoalDate)
                  : "Select target time"}
              </Text>
              <Text style={[styles.optionSubtitle, { color: theme.subtext }]}>
                Pick your target finish time in hh:mm:ss.
              </Text>
            </View>

            <View style={styles.optionRightSlot}>
              <Feather name="chevron-right" size={16} color={theme.subtext} />
            </View>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const renderCurrentFitnessStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 2"
        subtitle="What does your current fitness look like?"
        theme={theme}
      />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        This helps set sensible running paces, engine work and station bias.
      </Text>

      <View style={{ gap: 8 }}>
        {HYROX_EXPERIENCE_OPTIONS.map((opt) => (
          <OptionRow
            key={opt}
            title={opt}
            subtitle="Your Hyrox experience level"
            leftIcon="activity"
            theme={theme}
            active={hyroxExperience === opt}
            onPress={() => setHyroxExperience(opt)}
          />
        ))}
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Best Hyrox time (optional)
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
          placeholder="e.g. 1:02:30"
          placeholderTextColor={theme.subtext}
          value={hyroxBestTime}
          onChangeText={setHyroxBestTime}
        />
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Recent running (optional)
        </Text>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>5K</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 19:30"
              placeholderTextColor={theme.subtext}
              value={recent5kRun}
              onChangeText={setRecent5kRun}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>10K</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 40:30"
              placeholderTextColor={theme.subtext}
              value={recent10kRun}
              onChangeText={setRecent10kRun}
            />
          </View>
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Erg scores (optional)
        </Text>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>Row 1K</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 3:30"
              placeholderTextColor={theme.subtext}
              value={row1kTime}
              onChangeText={setRow1kTime}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.miniLabel, { color: theme.subtext }]}>Ski 1K</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.cardSoft,
                  color: theme.text,
                },
              ]}
              placeholder="e.g. 3:40"
              placeholderTextColor={theme.subtext}
              value={ski1kTime}
              onChangeText={setSki1kTime}
            />
          </View>
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Strength vs endurance background
        </Text>
        <View style={styles.chipRow}>
          {STRENGTH_BACKGROUND_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={strengthBackground === opt}
              onPress={() => setStrengthBackground(opt)}
            />
          ))}
        </View>
      </View>
    </View>
  );

  const renderWeeklyScheduleStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 3"
        subtitle="How should your week be set up?"
        theme={theme}
      />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Set session frequency and preferred days so the block fits your life.
      </Text>

      <View style={{ marginTop: 4, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Sessions per week</Text>
        <View style={styles.chipRow}>
          {DAYS_PER_WEEK_OPTIONS.map((n) => (
            <Chip
              key={n}
              label={`${n}x`}
              theme={theme}
              compact
              active={sessionsPerWeek === n}
              onPress={() => setSessionsPerWeek(n)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Preferred training days
        </Text>
        <View style={styles.chipRow}>
          {TRAINING_DAY_OPTIONS.map((d) => (
            <Chip
              key={d}
              label={d}
              theme={theme}
              compact
              active={trainingDays.includes(d)}
              onPress={() => toggleArrayValue(trainingDays, d, setTrainingDays)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Week notes (optional)
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
          placeholder="e.g. football on Wednesdays, long run on Sundays, travel on Mondays..."
          placeholderTextColor={theme.subtext}
          value={weekNotes}
          onChangeText={setWeekNotes}
          multiline
        />
      </View>
    </View>
  );

  const renderStationsStep = () => (
    <View style={styles.card}>
      <SectionHeader
        title="Question 4"
        subtitle="Which stations and constraints matter most?"
        theme={theme}
      />
      <Text style={[styles.stepIntro, { color: theme.subtext }]}>
        Bias the plan toward your weaker areas and the kit you actually have.
      </Text>

      <View style={{ marginTop: 4, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Stations you struggle with
        </Text>
        <View style={styles.chipRow}>
          {STATION_WEAKNESS_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={weakStations.includes(opt)}
              onPress={() => toggleArrayValue(weakStations, opt, setWeakStations)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Gym / equipment access
        </Text>
        <View style={styles.chipRow}>
          {GYM_ACCESS_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={gymAccess === opt}
              onPress={() => setGymAccess(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>Cross-training</Text>
        <View style={styles.chipRow}>
          {CROSS_TRAINING_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              theme={theme}
              compact
              active={crossTrainingPreference === opt}
              onPress={() => setCrossTrainingPreference(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Current / recent injuries (optional)
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
          placeholder="e.g. Achilles, low back, knee pain..."
          placeholderTextColor={theme.subtext}
          value={injuries}
          onChangeText={setInjuries}
          multiline
        />
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Extra constraints (optional)
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
          placeholder="e.g. travel, marathon prep overlap, preferred session layout..."
          placeholderTextColor={theme.subtext}
          value={constraints}
          onChangeText={setConstraints}
          multiline
        />
      </View>
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
              Hyrox block setup tailored to your event, engine, station weaknesses and available kit.
            </Text>
          </View>

          <View style={styles.stepStage}>
            <View style={styles.stepInner}>
              {step === 0 && renderGoalStep()}
              {step === 1 && renderCurrentFitnessStep()}
              {step === 2 && renderWeeklyScheduleStep()}
              {step === 3 && renderStationsStep()}
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

        <Modal
          transparent
          visible={showDatePicker}
          animationType="fade"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View
              style={[
                styles.pickerCard,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <DateTimePicker
                mode="date"
                value={eventDate || new Date()}
                display={Platform.OS === "ios" ? "inline" : "calendar"}
                onChange={(event, selectedDate) => {
                  if (event.type === "dismissed") {
                    setShowDatePicker(false);
                    return;
                  }
                  if (selectedDate) {
                    setEventDate(selectedDate);
                    setDateUnknown(false);
                  }
                  setShowDatePicker(false);
                }}
                style={{ alignSelf: "stretch" }}
              />
            </View>
          </View>
        </Modal>

        <Modal
          transparent
          visible={showTimePicker}
          animationType="fade"
          onRequestClose={() => setShowTimePicker(false)}
        >
          <View style={styles.pickerBackdrop}>
            <View
              style={[
                styles.pickerCard,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <DateTimePicker
                mode="time"
                value={timeGoalDate || new Date(0, 0, 0, 1, 0, 0)}
                is24Hour
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, selectedDate) => {
                  if (event.type === "dismissed") {
                    setShowTimePicker(false);
                    return;
                  }
                  if (selectedDate) {
                    setTimeGoalDate(selectedDate);
                  }
                  setShowTimePicker(false);
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
/* STYLES                                                              */
/* ------------------------------------------------------------------ */

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
  optionRightSlot: {
    marginLeft: 8,
    justifyContent: "center",
    alignItems: "center",
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