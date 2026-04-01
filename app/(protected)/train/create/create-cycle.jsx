// app/(protected)/train/create-cycling.jsx
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
;

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const CYCLING_GOAL_OPTIONS = [
  "General fitness / endurance",
  "40km TT",
  "100km / century",
  "Gran Fondo / sportive",
  "Climbing-focused",
  "Crit / road racing",
];

const CYCLING_GOAL_FOCUS = [
  "Just finish",
  "PB / time goal",
  "Build endurance",
  "Improve climbing",
  "Improve sprint / punch",
  "Race-specific prep",
];

const EXPERIENCE_OPTIONS = [
  "New to cycling",
  "Some experience",
  "Regular rider",
  "Experienced racer",
];

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];

const TRAINING_DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const BIKE_ENV_OPTIONS = [
  "Road outdoors",
  "Indoor trainer / smart trainer",
  "Mix of indoors and outdoors",
];

const TERRAIN_PREF_OPTIONS = [
  "Flat",
  "Rolling",
  "Hilly",
  "Mountainous",
  "Mixed",
];

const CROSS_TRAINING_OPTIONS = ["None", "Some", "A lot"];

const APPLE_BLUE = "#E6FF3B";

const STEPS = [
  "Goal",
  "Current fitness",
  "Weekly schedule",
  "Constraints & preferences",
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

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

// Remove all undefined values (deep) before saving to Firestore
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

// ------------------------------------------------------------------
// Theme helper / Chip
// ------------------------------------------------------------------

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: colors.bg,
    card: colors.card,
    text: colors.text,
    subtext: colors.subtext,
    border: colors.border,
    muted: colors.muted || (isDark ? "#3A3A3C" : "#F2F2F7"),
    primaryBg: APPLE_BLUE,
    primaryText: "#FFFFFF",
  };
}

function Chip({ label, active, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.chip,
        style,
        active && styles.chipActive,
        active && { borderColor: APPLE_BLUE, backgroundColor: "rgba(230,255,59,0.20)" },
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          active && { color: "#0B1215", fontWeight: "700" },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ------------------------------------------------------------------
// MAIN SCREEN
// ------------------------------------------------------------------

export default function CreateCyclingPlan() {
  const theme = useScreenTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;
  const { createPlan: createAiPlan } = useAiPlan();

  // Step initialisation
  const initialStep = useMemo(() => {
    const raw = params?.step;
    if (!raw) return 0;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n < STEPS.length ? n : 0;
  }, [params?.step]);
  const [step, setStep] = useState(initialStep);

  // -------- GOAL ----------
  const [bikeGoalType, setBikeGoalType] = useState("100km / century");
  const [bikeGoalFocus, setBikeGoalFocus] = useState("Build endurance");
  const [targetEventName, setTargetEventName] = useState("");
  const [eventLocation, setEventLocation] = useState("");

  const [eventDate, setEventDate] = useState(null); // Date | null
  const [dateUnknown, setDateUnknown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [planLengthWeeks, setPlanLengthWeeks] = useState(12);

  const [timeGoalMode, setTimeGoalMode] = useState("Just finish");
  const [timeGoalDate, setTimeGoalDate] = useState(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // -------- CURRENT FITNESS ----------
  const [experienceLevel, setExperienceLevel] = useState("Regular rider");
  const [bikeFTP, setBikeFTP] = useState(""); // watts
  const [bikeWeight, setBikeWeight] = useState(""); // kg (for W/kg calc in AI)
  const [longestRideDist, setLongestRideDist] = useState(""); // km
  const [avgWeeklyBikeDist, setAvgWeeklyBikeDist] = useState(""); // km
  const [terrainPref, setTerrainPref] = useState("Rolling");
  const [bikeEnv, setBikeEnv] = useState("Mix of indoors and outdoors");

  // Optional short-run info if you mix running (can help AI a bit)
  const [recent5k, setRecent5k] = useState("");

  // -------- WEEKLY SCHEDULE ----------
  const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
  const [trainingDays, setTrainingDays] = useState([]);
  const [weekNotes, setWeekNotes] = useState("");

  // -------- PREFERENCES / CONSTRAINTS ----------
  const [crossTrainingPreference, setCrossTrainingPreference] =
    useState("Some");
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
        bikeGoalType &&
          bikeGoalFocus &&
          experienceLevel &&
          sessionsPerWeek &&
          (!hasTargetDate && !effectiveTargetDate ? planLengthWeeks : true)
      ),
    [
      bikeGoalType,
      bikeGoalFocus,
      experienceLevel,
      sessionsPerWeek,
      hasTargetDate,
      effectiveTargetDate,
      planLengthWeeks,
    ]
  );

  // ------------------------------------------------------------------
  // Step validation / navigation
  // ------------------------------------------------------------------

  const isStepValid = (s) => {
    switch (s) {
      case 0: {
        const hasGoal = Boolean(bikeGoalType && bikeGoalFocus);
        const needsLength = !eventDate && dateUnknown;
        const hasLength = !!planLengthWeeks;
        return needsLength ? hasGoal && hasLength : hasGoal;
      }
      case 1:
        return Boolean(experienceLevel);
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

  // ------------------------------------------------------------------
  // Check if user already has a plan and confirm replacement
  // ------------------------------------------------------------------

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
      console.log("[create-cycling] failed to check existing plans:", e);
      return true;
    }
  };

  // ------------------------------------------------------------------
  // Generate Cycling plan via AI + save to Firestore
  // ------------------------------------------------------------------

  const handleGenerate = async () => {
    if (!canSubmit) {
      Alert.alert(
        "More info needed",
        "Please at least set your goal, experience and sessions per week."
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

    const goalType = "Cycling";
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
      `Cycling goal type: ${bikeGoalType}`,
      `Goal focus: ${bikeGoalFocus}`,
      `Experience: ${experienceLevel}`,
      bikeFTP ? `FTP: ${bikeFTP} W` : null,
      bikeWeight ? `Body weight: ${bikeWeight} kg` : null,
      longestRideDist ? `Longest recent ride: ${longestRideDist} km` : null,
      avgWeeklyBikeDist
        ? `Typical weekly distance: ${avgWeeklyBikeDist} km`
        : null,
      bikeEnv ? `Bike environment: ${bikeEnv}` : null,
      terrainPref ? `Preferred terrain: ${terrainPref}` : null,
      recent5k ? `Recent 5K run: ${recent5k}` : null,
      `Sessions per week: ${sessionsPerWeek}`,
      trainingDays.length
        ? `Preferred training days: ${trainingDays.join(", ")}`
        : null,
      weekNotes ? `Week notes: ${weekNotes}` : null,
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
        current10kTime: "", // not relevant here
        sessionsPerWeek,
        weeks: weeksCount,
        goal: `Cycling – ${bikeGoalType} – ${bikeGoalFocus}`,
        primaryActivity: "Cycling",
        extraNotes,
      });

      const appPlan = convertAiPlanToApp(aiPlan) || {};

      const planDoc = {
        ...appPlan,
        name:
          appPlan.name ||
          (targetEventName
            ? `${targetEventName} – ${bikeGoalType}`
            : `${bikeGoalType} cycling plan`),
        primaryActivity: appPlan.primaryActivity || "Cycling",
        goalDistance: bikeGoalType || "",
        goalPrimaryFocus: bikeGoalFocus || "",
        targetEventName: targetEventName || "",
        targetEventDate,
        targetTime,
        source: "ai-cycling",
        meta: {
          bikeGoalType,
          bikeGoalFocus,
          experienceLevel,
          bikeFTP,
          bikeWeight,
          longestRideDist,
          avgWeeklyBikeDist,
          terrainPref,
          bikeEnv,
          recent5k,
          sessionsPerWeek,
          trainingDays,
          weekNotes,
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
        "Your cycling plan has been saved and is now visible on the Train page."
      );
      router.replace("/train");
    } catch (e) {
      console.log("[create-cycling] AI / save error:", e);
      Alert.alert(
        "Error",
        e?.message || "Something went wrong generating or saving your plan."
      );
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------

  const renderGoalStep = () => (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.card },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Goal</Text>
      <Text style={{ color: theme.subtext, fontSize: 12 }}>
        What’s the main cycling focus?
      </Text>

      {/* Goal type */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Goal type
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CYCLING_GOAL_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={bikeGoalType === opt}
              onPress={() => setBikeGoalType(opt)}
            />
          ))}
        </View>
      </View>

      {/* Goal focus */}
      <View style={{ marginTop: 12, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Primary focus
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CYCLING_GOAL_FOCUS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={bikeGoalFocus === opt}
              onPress={() => setBikeGoalFocus(opt)}
            />
          ))}
        </View>
      </View>

      {/* Event name / location */}
      <View style={{ marginTop: 12, gap: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Event (optional)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.bg,
              color: theme.text,
            },
          ]}
          placeholder="e.g. RideLondon 100, Dragon Ride, local sportive"
          placeholderTextColor={theme.subtext}
          value={targetEventName}
          onChangeText={setTargetEventName}
        />
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.bg,
              color: theme.text,
              marginTop: 6,
            },
          ]}
          placeholder="Location (city / region) – optional"
          placeholderTextColor={theme.subtext}
          value={eventLocation}
          onChangeText={setEventLocation}
        />
      </View>

      {/* Event date */}
      <View style={{ marginTop: 12, gap: 6 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Event date
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            onPress={() => {
              setDateUnknown(false);
              setShowDatePicker(true);
            }}
            activeOpacity={0.85}
            style={[
              styles.pillBtn,
              {
                flex: 1.4,
                borderColor: theme.border,
                justifyContent: "space-between",
              },
            ]}
          >
            <View
              style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
            >
              <Feather name="calendar" size={16} color={theme.text} />
              <Text
                style={{
                  color: theme.text,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {eventDate ? formatDatePretty(eventDate) : "Select date"}
              </Text>
            </View>
          </TouchableOpacity>

          <Chip
            label="I'm not sure yet"
            active={dateUnknown}
            onPress={() => {
              setDateUnknown((prev) => !prev);
              if (!dateUnknown) setEventDate(null);
            }}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      {/* Plan length */}
      {!hasTargetDate && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text style={[styles.label, { color: theme.subtext }]}>
            Plan length
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 11 }}>
            No fixed event? Choose how many weeks you want to build for.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[8, 10, 12, 16, 20].map((w) => (
              <Chip
                key={w}
                label={`${w} weeks`}
                active={planLengthWeeks === w}
                onPress={() => setPlanLengthWeeks(w)}
              />
            ))}
          </View>
        </View>
      )}

      {/* Time goal */}
      <View style={{ marginTop: 12, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Time goal
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip
            label="Just finish"
            active={timeGoalMode === "Just finish"}
            onPress={() => {
              setTimeGoalMode("Just finish");
              setTimeGoalDate(null);
            }}
          />
          <Chip
            label="Time goal"
            active={timeGoalMode === "Time goal"}
            onPress={() => setTimeGoalMode("Time goal")}
          />
        </View>

        {timeGoalMode === "Time goal" && (
          <TouchableOpacity
            onPress={() => setShowTimePicker(true)}
            activeOpacity={0.85}
            style={[
              styles.pillBtn,
              {
                borderColor: theme.border,
                justifyContent: "space-between",
                marginTop: 4,
              },
            ]}
          >
            <View
              style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
            >
              <Feather name="clock" size={16} color={theme.text} />
              <Text
                style={{
                  color: theme.text,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {timeGoalDate
                  ? formatTimeHHMMSS(timeGoalDate)
                  : "Select target time (hh:mm:ss)"}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderCurrentFitnessStep = () => (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.card },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Current fitness
      </Text>
      <Text style={{ color: theme.subtext, fontSize: 12 }}>
        Helps set safe volumes, intensities and progression.
      </Text>

      {/* Experience */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Cycling experience
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {EXPERIENCE_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={experienceLevel === opt}
              onPress={() => setExperienceLevel(opt)}
            />
          ))}
        </View>
      </View>

      {/* FTP / weight */}
      <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.miniLabel, { color: theme.subtext }]}>
            FTP (watts)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.bg,
                color: theme.text,
              },
            ]}
            placeholder="e.g. 280"
            placeholderTextColor={theme.subtext}
            keyboardType="numeric"
            value={bikeFTP}
            onChangeText={setBikeFTP}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.miniLabel, { color: theme.subtext }]}>
            Body weight (kg)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.bg,
                color: theme.text,
              },
            ]}
            placeholder="e.g. 75"
            placeholderTextColor={theme.subtext}
            keyboardType="numeric"
            value={bikeWeight}
            onChangeText={setBikeWeight}
          />
        </View>
      </View>

      {/* Distances */}
      <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.miniLabel, { color: theme.subtext }]}>
            Longest recent ride (km)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.bg,
                color: theme.text,
              },
            ]}
            placeholder="e.g. 120"
            placeholderTextColor={theme.subtext}
            keyboardType="numeric"
            value={longestRideDist}
            onChangeText={setLongestRideDist}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.miniLabel, { color: theme.subtext }]}>
            Typical weekly distance (km)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                borderColor: theme.border,
                backgroundColor: theme.bg,
                color: theme.text,
              },
            ]}
            placeholder="e.g. 200"
            placeholderTextColor={theme.subtext}
            keyboardType="numeric"
            value={avgWeeklyBikeDist}
            onChangeText={setAvgWeeklyBikeDist}
          />
        </View>
      </View>

      {/* Environment & terrain */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Riding environment
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {BIKE_ENV_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={bikeEnv === opt}
              onPress={() => setBikeEnv(opt)}
            />
          ))}
        </View>
      </View>

      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Preferred terrain
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TERRAIN_PREF_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={terrainPref === opt}
              onPress={() => setTerrainPref(opt)}
            />
          ))}
        </View>
      </View>

      {/* Optional run reference */}
      <View style={{ marginTop: 10, gap: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          5K run time (optional)
        </Text>
        <Text style={{ color: theme.subtext, fontSize: 11 }}>
          Only if you want the AI to consider cross-discipline fitness.
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.bg,
              color: theme.text,
            },
          ]}
          placeholder="e.g. 19:30"
          placeholderTextColor={theme.subtext}
          value={recent5k}
          onChangeText={setRecent5k}
        />
      </View>
    </View>
  );

  const renderWeeklyScheduleStep = () => (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.card },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Weekly schedule
      </Text>
      <Text style={{ color: theme.subtext, fontSize: 12 }}>
        How many bike sessions can you realistically do?
      </Text>

      {/* Sessions per week */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Sessions per week
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {DAYS_PER_WEEK_OPTIONS.map((n) => (
            <Chip
              key={n}
              label={`${n}x`}
              active={sessionsPerWeek === n}
              onPress={() => setSessionsPerWeek(n)}
            />
          ))}
        </View>
      </View>

      {/* Training days */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Preferred training days
        </Text>
        <Text style={{ color: theme.subtext, fontSize: 11 }}>
          Optional, but helps avoid heavy sessions on bad days.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TRAINING_DAY_OPTIONS.map((d) => (
            <Chip
              key={d}
              label={d}
              active={trainingDays.includes(d)}
              onPress={() => toggleArrayValue(trainingDays, d, setTrainingDays)}
            />
          ))}
        </View>
      </View>

      {/* Week notes */}
      <View style={{ marginTop: 10, gap: 4 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Anything else about your week? (optional)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.bg,
              color: theme.text,
              minHeight: 60,
              textAlignVertical: "top",
            },
          ]}
          placeholder="e.g. only indoor midweek, long ride Sundays, commute by bike some days…"
          placeholderTextColor={theme.subtext}
          value={weekNotes}
          onChangeText={setWeekNotes}
          multiline
        />
      </View>
    </View>
  );

  const renderConstraintsStep = () => (
    <View
      style={[
        styles.card,
        { borderColor: theme.border, backgroundColor: theme.card },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: theme.text }]}>
        Constraints & preferences
      </Text>

      {/* Cross training */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Cross-training
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {CROSS_TRAINING_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={crossTrainingPreference === opt}
              onPress={() => setCrossTrainingPreference(opt)}
            />
          ))}
        </View>
      </View>

      {/* Injuries */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Current / recent injuries (optional)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.bg,
              color: theme.text,
              minHeight: 50,
              textAlignVertical: "top",
            },
          ]}
          placeholder="e.g. knee pain above 2hrs, lower back in aero, previous crashes…"
          placeholderTextColor={theme.subtext}
          value={injuries}
          onChangeText={setInjuries}
          multiline
        />
      </View>

      {/* Other constraints */}
      <View style={{ marginTop: 10, gap: 8 }}>
        <Text style={[styles.label, { color: theme.subtext }]}>
          Anything else the coach should know? (optional)
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              borderColor: theme.border,
              backgroundColor: theme.bg,
              color: theme.text,
              minHeight: 50,
              textAlignVertical: "top",
            },
          ]}
          placeholder="e.g. limited daylight, no turbo at home, big work trips, other races to fit around…"
          placeholderTextColor={theme.subtext}
          value={constraints}
          onChangeText={setConstraints}
          multiline
        />
      </View>
    </View>
  );

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------

  const isLastStep = step === STEPS.length - 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 120,
            gap: 18,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* HEADER + STEP INDICATOR */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => (step === 0 ? router.back() : handleBack())}
              style={[
                styles.pillBtn,
                { borderColor: theme.border, paddingHorizontal: 10 },
              ]}
              activeOpacity={0.85}
            >
              <Feather name="chevron-left" size={18} color={theme.text} />
              <Text
                style={{
                  color: theme.text,
                  fontWeight: "700",
                }}
              >
                {step === 0 ? "Back" : "Previous"}
              </Text>
            </TouchableOpacity>

            <View style={{ alignItems: "center" }}>
              <Text style={[styles.hTitle, { color: theme.text }]}>
                Cycling plan
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  marginTop: 2,
                }}
              >
                Step {step + 1} of {STEPS.length} · {STEPS[step]}
              </Text>
            </View>

            <View style={{ width: 70 }} />
          </View>

          {/* Step dots */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              gap: 6,
              marginTop: -6,
              marginBottom: 4,
            }}
          >
            {STEPS.map((_, idx) => (
              <View
                key={idx}
                style={{
                  width: idx === step ? 22 : 8,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: idx === step ? APPLE_BLUE : theme.muted,
                }}
              />
            ))}
          </View>

          {/* Helper text */}
          <Text
            style={{
              fontSize: 14,
              color: theme.subtext,
            }}
          >
            Share your cycling background, event target and weekly life so we
            can build a plan that actually fits, not just a generic Zwift plan.
          </Text>

          {/* CURRENT STEP CONTENT */}
          {step === 0 && renderGoalStep()}
          {step === 1 && renderCurrentFitnessStep()}
          {step === 2 && renderWeeklyScheduleStep()}
          {step === 3 && renderConstraintsStep()}

          {/* NAV BUTTONS */}
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 4,
            }}
          >
            {step > 0 ? (
              <TouchableOpacity
                onPress={handleBack}
                activeOpacity={0.85}
                style={[
                  styles.secondaryBtn,
                  { borderColor: theme.border, flex: 1 },
                ]}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  Back
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            <TouchableOpacity
              onPress={isLastStep ? handleGenerate : handleNext}
              disabled={loading || (isLastStep && !canSubmit)}
              activeOpacity={0.9}
              style={[
                styles.primaryBtn,
                {
                  flex: 1.4,
                  backgroundColor:
                    loading || (isLastStep && !canSubmit)
                      ? theme.muted
                      : theme.primaryBg,
                },
              ]}
            >
              <Feather
                name={isLastStep ? "sparkles" : "arrow-right"}
                size={18}
                color={
                  loading || (isLastStep && !canSubmit)
                    ? "#6B7280"
                    : theme.primaryText
                }
              />
              <Text
                style={{
                  color:
                    loading || (isLastStep && !canSubmit)
                      ? "#6B7280"
                      : theme.primaryText,
                  fontWeight: "800",
                }}
              >
                {isLastStep
                  ? loading
                    ? "Building your plan…"
                    : "Generate plan with AI"
                  : "Next"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* DATE PICKER MODAL */}
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

        {/* TIME PICKER MODAL */}
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

// ------------------------------------------------------------------
// STYLES
// ------------------------------------------------------------------

const styles = StyleSheet.create({
  hTitle: { fontSize: 28, fontWeight: "800" },

  headerRow: {
    marginTop: 0,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
  },

  label: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  miniLabel: {
    fontSize: 11,
    fontWeight: "600",
  },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },

  pillBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 12,
  },

  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D1D5DB",
  },
  chipActive: {
    borderWidth: 1.2,
  },
  chipLabel: {
    fontSize: 12,
    color: "#4B5563",
  },

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
    borderWidth: StyleSheet.hairlineWidth,
  },
});
