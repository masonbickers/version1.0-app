import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { getJsonAuthHeaders } from "../../../src/lib/api/authHeaders";

const PRIMARY = "#E6FF3B";

const BUILDER_MODE_OPTIONS = [
  { key: "manual", label: "Manual" },
  { key: "ai", label: "AI" },
];

const WORKOUT_KIND_OPTIONS = [
  { key: "run", label: "Run", icon: "activity" },
  { key: "strength", label: "Strength", icon: "bar-chart-2" },
  { key: "hybrid", label: "Hybrid", icon: "shuffle" },
];

const STEP_KIND_OPTIONS = {
  run: [
    { key: "warmup", label: "Warm-up" },
    { key: "run", label: "Run" },
    { key: "recovery", label: "Recovery" },
    { key: "cooldown", label: "Cool-down" },
  ],
  strength: [
    { key: "warmup", label: "Warm-up" },
    { key: "strength", label: "Strength" },
    { key: "conditioning", label: "Conditioning" },
    { key: "cooldown", label: "Cool-down" },
  ],
  hybrid: [
    { key: "warmup", label: "Warm-up" },
    { key: "run", label: "Run" },
    { key: "strength", label: "Strength" },
    { key: "conditioning", label: "Conditioning" },
    { key: "recovery", label: "Recovery" },
    { key: "cooldown", label: "Cool-down" },
  ],
};

const DURATION_TYPE_OPTIONS = [
  { key: "time", label: "Time" },
  { key: "distance", label: "Distance" },
  { key: "open", label: "Open" },
];

const TARGET_TYPE_OPTIONS = [
  { key: "open", label: "Open" },
  { key: "pace_range", label: "Pace" },
  { key: "hr_range", label: "HR" },
];

const AI_PROMPT_SUGGESTIONS = [
  "Build a 45 minute threshold workout with a proper warm-up and cool-down.",
  "Create a 60 minute long run with a steady aerobic finish.",
  "Give me a 35 minute hybrid engine session with running and bodyweight work.",
  "Create a 40 minute strength session focused on lower body and core.",
];

const SAMPLE_WORKOUT_SEEDS = {
  run_easy_35: {
    mode: "manual",
    kind: "run",
    title: "Easy Run",
    description: "Steady aerobic run to build volume without carrying extra fatigue.",
    durationMin: "35",
    distanceKm: "6.0",
    aiPrompt: "Create an easy aerobic run around 35 minutes with relaxed effort and simple coaching cues.",
    steps: [
      makeInitialStep({
        label: "Easy aerobic",
        stepType: "run",
        durationType: "time",
        durationValue: "35",
        durationUnit: "min",
        notes: "Conversational effort throughout. Keep it smooth.",
      }),
    ],
  },
  run_intervals_intro: {
    mode: "manual",
    kind: "run",
    title: "Intervals Intro",
    description: "Short controlled speed session that stays manageable and clean.",
    durationMin: "32",
    distanceKm: "5.0",
    aiPrompt: "Create an intro interval session with easy warm-up, short quality reps, and an easy cool-down.",
    steps: [
      makeInitialStep({
        label: "Warm up",
        stepType: "warmup",
        durationType: "time",
        durationValue: "10",
        durationUnit: "min",
        notes: "Easy jog building into the work.",
      }),
      makeInitialStep({
        label: "Main set",
        stepType: "run",
        durationType: "time",
        durationValue: "12",
        durationUnit: "min",
        notes: "6 x 1 min hard / 1 min easy.",
      }),
      makeInitialStep({
        label: "Cool-down",
        stepType: "cooldown",
        durationType: "time",
        durationValue: "10",
        durationUnit: "min",
        notes: "Easy jog back down.",
      }),
    ],
  },
  strength_40: {
    mode: "manual",
    kind: "strength",
    title: "Strength Session",
    description: "Compound-led gym session focused on controlled quality reps.",
    durationMin: "40",
    distanceKm: "",
    aiPrompt: "Create a 40 minute strength workout with a warm-up, 2 main lifts, accessory work, and a short cooldown.",
    steps: [
      makeInitialStep({
        label: "Warm up",
        stepType: "warmup",
        durationType: "time",
        durationValue: "8",
        durationUnit: "min",
        notes: "Mobility and activation.",
      }),
      makeInitialStep({
        label: "Main lifts",
        stepType: "strength",
        durationType: "time",
        durationValue: "24",
        durationUnit: "min",
        notes: "Compound focus with controlled rest.",
      }),
      makeInitialStep({
        label: "Cool-down",
        stepType: "cooldown",
        durationType: "time",
        durationValue: "8",
        durationUnit: "min",
        notes: "Breathing and mobility.",
      }),
    ],
  },
  bodyweight_20: {
    mode: "manual",
    kind: "strength",
    title: "Bodyweight Circuit",
    description: "Minimal-equipment circuit for full-body strength and movement quality.",
    durationMin: "20",
    distanceKm: "",
    aiPrompt: "Create a 20 minute bodyweight strength circuit with warm-up and cooldown.",
    steps: [
      makeInitialStep({
        label: "Warm up",
        stepType: "warmup",
        durationType: "time",
        durationValue: "4",
        durationUnit: "min",
        notes: "Open the hips, shoulders, and trunk.",
      }),
      makeInitialStep({
        label: "Circuit",
        stepType: "conditioning",
        durationType: "time",
        durationValue: "12",
        durationUnit: "min",
        notes: "Squats, lunges, push-ups, plank.",
      }),
      makeInitialStep({
        label: "Reset",
        stepType: "cooldown",
        durationType: "time",
        durationValue: "4",
        durationUnit: "min",
        notes: "Easy mobility finish.",
      }),
    ],
  },
  hybrid_engine_30: {
    mode: "manual",
    kind: "hybrid",
    title: "Hybrid Engine",
    description: "Short hybrid hit combining controlled running and bodyweight work.",
    durationMin: "30",
    distanceKm: "4.0",
    aiPrompt: "Create a 30 minute hybrid workout blending running and strength stations with clear coaching cues.",
    steps: [
      makeInitialStep({
        label: "Warm up",
        stepType: "warmup",
        durationType: "time",
        durationValue: "6",
        durationUnit: "min",
        notes: "Easy jog and dynamic prep.",
      }),
      makeInitialStep({
        label: "Run block",
        stepType: "run",
        durationType: "distance",
        durationValue: "3",
        durationUnit: "km",
        notes: "Steady controlled work.",
      }),
      makeInitialStep({
        label: "Strength block",
        stepType: "strength",
        durationType: "time",
        durationValue: "10",
        durationUnit: "min",
        notes: "Bodyweight strength station work.",
      }),
      makeInitialStep({
        label: "Cool-down",
        stepType: "cooldown",
        durationType: "time",
        durationValue: "6",
        durationUnit: "min",
        notes: "Easy movement down-regulation.",
      }),
    ],
  },
  recovery_flow_25: {
    mode: "manual",
    kind: "hybrid",
    title: "Recovery Flow",
    description: "Low-stress recovery session with mobility, breathing, and easy movement.",
    durationMin: "25",
    distanceKm: "",
    aiPrompt: "Create a 25 minute recovery workout focused on mobility and light movement.",
    steps: [
      makeInitialStep({
        label: "Reset flow",
        stepType: "recovery",
        durationType: "time",
        durationValue: "25",
        durationUnit: "min",
        notes: "Mobility, breath work, and easy movement.",
      }),
    ],
  },
};

function uid(prefix = "step") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function makeInitialStep(overrides = {}) {
  return {
    id: uid(),
    label: "",
    stepType: "run",
    durationType: "time",
    durationValue: "",
    durationUnit: "min",
    notes: "",
    targetType: "open",
    paceMin: "",
    paceMax: "",
    hrMin: "",
    hrMax: "",
    ...overrides,
  };
}

function parsePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePaceToSec(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d+:\d{1,2}$/.test(raw)) {
    const [min, sec] = raw.split(":").map(Number);
    if (!Number.isFinite(min) || !Number.isFinite(sec)) return null;
    return min * 60 + sec;
  }
  const direct = Number(raw);
  return Number.isFinite(direct) && direct > 0 ? direct : null;
}

function formatPace(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const mins = Math.floor(sec / 60);
  const secs = Math.round(sec % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function inferKindFromSport(value, fallback = "run") {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("strength")) return "strength";
  if (raw.includes("hybrid")) return "hybrid";
  if (raw.includes("run") || raw.includes("walk") || raw.includes("cycl")) return "run";
  return fallback;
}

function mapKindToSport(kind) {
  if (kind === "strength") return "strength";
  if (kind === "hybrid") return "running";
  return "running";
}

function buildDraftFromSeed(sampleKey, mode = "manual") {
  const seed = SAMPLE_WORKOUT_SEEDS[String(sampleKey || "").trim()];
  if (!seed) {
    return {
      mode,
      kind: "run",
      title: "",
      description: "",
      durationMin: "",
      distanceKm: "",
      aiPrompt: "",
      steps: [makeInitialStep()],
    };
  }

  return {
    mode,
    kind: seed.kind,
    title: seed.title,
    description: seed.description,
    durationMin: seed.durationMin,
    distanceKm: seed.distanceKm,
    aiPrompt: seed.aiPrompt,
    steps: (seed.steps || []).map((step) => ({ ...step, id: uid() })),
  };
}

function buildWorkoutPayload(draft) {
  const durationMin = parsePositive(draft.durationMin);
  const distanceKm = parsePositive(draft.distanceKm);

  const steps = Array.isArray(draft.steps)
    ? draft.steps
        .map((step) => {
          const payload = {
            type: String(step.label || "Step").trim() || "Step",
            stepType: String(step.stepType || "run").trim().toLowerCase(),
            notes: String(step.notes || "").trim(),
            targetType: String(step.targetType || "open").trim().toLowerCase(),
          };

          if (step.durationType !== "open") {
            const rawValue = parsePositive(step.durationValue);
            if (rawValue != null) {
              payload.durationType = step.durationType;
              payload.durationValue = rawValue;
              payload.durationUnit = step.durationUnit || (step.durationType === "distance" ? "km" : "min");
            }
          }

          if (payload.targetType === "pace_range") {
            const minSecPerKm = parsePaceToSec(step.paceMin);
            const maxSecPerKm = parsePaceToSec(step.paceMax);
            if (minSecPerKm && maxSecPerKm) {
              payload.targetValue = {
                minSecPerKm,
                maxSecPerKm,
              };
            } else {
              payload.targetType = "open";
            }
          }

          if (payload.targetType === "hr_range") {
            const minBpm = parsePositive(step.hrMin);
            const maxBpm = parsePositive(step.hrMax);
            if (minBpm && maxBpm) {
              payload.targetValue = {
                minBpm,
                maxBpm,
              };
            } else {
              payload.targetType = "open";
            }
          }

          return payload;
        })
        .filter((step) => {
          if (step.durationType === "open") return Boolean(step.type || step.notes);
          return step.durationValue != null;
        })
    : [];

  return {
    name: String(draft.title || "Custom workout").trim() || "Custom workout",
    sport: mapKindToSport(draft.kind),
    description: String(draft.description || "").trim(),
    totalDurationSec: durationMin ? Math.round(durationMin * 60) : undefined,
    totalDistanceKm: distanceKm ? Number(distanceKm.toFixed(3)) : undefined,
    steps,
  };
}

function buildDraftFromAiWorkout(workout, fallbackKind = "run") {
  const steps = Array.isArray(workout?.steps)
    ? workout.steps.map((step) => ({
        id: uid(),
        label: String(step.type || step.title || "Step").trim() || "Step",
        stepType: String(step.stepType || step.type || "run").trim().toLowerCase(),
        durationType: String(step.durationType || "open").trim().toLowerCase(),
        durationValue:
          step.durationValue != null
            ? String(step.durationValue)
            : step.durationType === "time" && step.durationSec != null
            ? String(step.durationSec / 60)
            : step.durationType === "distance" && step.distanceMeters != null
            ? String(step.distanceMeters / 1000)
            : "",
        durationUnit:
          String(step.durationUnit || "").trim().toLowerCase() ||
          (String(step.durationType || "").trim().toLowerCase() === "distance" ? "km" : "min"),
        notes: String(step.notes || step.description || "").trim(),
        targetType: String(step.targetType || "open").trim().toLowerCase() || "open",
        paceMin: formatPace(step?.targetValue?.minSecPerKm),
        paceMax: formatPace(step?.targetValue?.maxSecPerKm),
        hrMin:
          step?.targetValue?.minBpm != null ? String(Math.round(step.targetValue.minBpm)) : "",
        hrMax:
          step?.targetValue?.maxBpm != null ? String(Math.round(step.targetValue.maxBpm)) : "",
      }))
    : [];

  return {
    mode: "ai",
    kind: inferKindFromSport(workout?.sport, fallbackKind),
    title: String(workout?.title || workout?.name || "").trim(),
    description: String(workout?.description || workout?.notes || "").trim(),
    durationMin:
      workout?.totalDurationSec != null
        ? String(Math.round(Number(workout.totalDurationSec) / 60))
        : "",
    distanceKm:
      workout?.totalDistanceKm != null ? String(Number(workout.totalDistanceKm).toFixed(1)) : "",
    aiPrompt: "",
    steps: steps.length ? steps : [makeInitialStep()],
  };
}

function heroColorsForKind(kind, isDark, accent) {
  if (kind === "strength") {
    return {
      colors: ["#12160C", "#0A0D08", "#000000"],
      accent: "#D7F04B",
    };
  }
  if (kind === "hybrid") {
    return {
      colors: ["#081114", "#0B171A", "#000000"],
      accent: "#7FE3F3",
    };
  }
  return {
    colors: ["#06080A", "#0B1115", "#000000"],
    accent: accent || PRIMARY,
  };
}

export default function CreateWorkoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const requestedSampleKey = Array.isArray(params.sampleKey) ? params.sampleKey[0] : params.sampleKey;
  const requestedMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const initialDraft = useMemo(
    () => buildDraftFromSeed(requestedSampleKey, requestedMode === "ai" ? "ai" : "manual"),
    [requestedMode, requestedSampleKey]
  );

  const [builderMode, setBuilderMode] = useState(initialDraft.mode || "manual");
  const [draft, setDraft] = useState(initialDraft);
  const [aiPrompt, setAiPrompt] = useState(initialDraft.aiPrompt || "");
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentWorkoutId, setSentWorkoutId] = useState("");

  useEffect(() => {
    const nextDraft = buildDraftFromSeed(requestedSampleKey, requestedMode === "ai" ? "ai" : "manual");
    setBuilderMode(nextDraft.mode || "manual");
    setDraft(nextDraft);
    setAiPrompt(nextDraft.aiPrompt || "");
    setSentWorkoutId("");
  }, [requestedMode, requestedSampleKey]);

  const keyboardAppearance = isDark ? "dark" : "light";
  const accentFill = colors?.accentBg || colors?.primary || PRIMARY;
  const onAccent = colors?.sapOnPrimary || "#111111";
  const heroTheme = useMemo(
    () => heroColorsForKind(draft.kind, isDark, colors?.accentBg || colors?.primary || PRIMARY),
    [colors?.accentBg, colors?.primary, draft.kind, isDark]
  );
  const stepOptions = STEP_KIND_OPTIONS[draft.kind] || STEP_KIND_OPTIONS.run;
  const workoutPayload = useMemo(() => buildWorkoutPayload(draft), [draft]);
  const stepCount = Array.isArray(workoutPayload.steps) ? workoutPayload.steps.length : 0;
  const durationLabel = draft.durationMin ? `${draft.durationMin} min` : `${stepCount} steps`;
  const distanceLabel = draft.distanceKm ? `${draft.distanceKm} km` : draft.kind === "strength" ? "Gym" : "Custom";

  const updateDraft = useCallback((patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateStep = useCallback((stepId, patch) => {
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }, []);

  const addStep = useCallback(() => {
    const fallbackType =
      draft.kind === "strength" ? "strength" : draft.kind === "hybrid" ? "conditioning" : "run";
    setDraft((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        makeInitialStep({
          label: prev.kind === "strength" ? "Main block" : "Main set",
          stepType: fallbackType,
          durationType: prev.kind === "strength" ? "time" : "distance",
          durationValue: "",
          durationUnit: prev.kind === "strength" ? "min" : "km",
        }),
      ],
    }));
  }, [draft.kind]);

  const removeStep = useCallback((stepId) => {
    setDraft((prev) => {
      const nextSteps = prev.steps.filter((step) => step.id !== stepId);
      return {
        ...prev,
        steps: nextSteps.length ? nextSteps : [makeInitialStep()],
      };
    });
  }, []);

  const handleAiGenerate = useCallback(async () => {
    try {
      if (!API_URL) throw new Error("API URL missing for this build.");
      if (!String(aiPrompt || "").trim()) {
        Alert.alert("Add a prompt", "Describe the workout you want to generate.");
        return;
      }

      setAiLoading(true);
      const headers = await getJsonAuthHeaders();
      const res = await fetch(`${API_URL}/workouts/ai-watch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: aiPrompt,
          meta: {
            sport: mapKindToSport(draft.kind),
            title: draft.title,
            durationMin: parsePositive(draft.durationMin) || undefined,
            distanceKm: parsePositive(draft.distanceKm) || undefined,
            notes: draft.description,
          },
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || json?.message || "Failed to generate workout.");
      }

      const nextDraft = buildDraftFromAiWorkout(json, draft.kind);
      setDraft((prev) => ({
        ...prev,
        ...nextDraft,
        kind: prev.kind === "hybrid" ? "hybrid" : nextDraft.kind,
      }));
      setBuilderMode("manual");
    } catch (error) {
      Alert.alert("AI workout failed", error?.message || "Try again.");
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, draft.description, draft.distanceKm, draft.durationMin, draft.kind, draft.title]);

  const handleSendToWatch = useCallback(async () => {
    try {
      if (!API_URL) throw new Error("API URL missing for this build.");
      const user = auth.currentUser;
      const uid = String(user?.uid || "").trim();
      if (!uid) throw new Error("Not signed in.");

      if (!workoutPayload.name) {
        throw new Error("Add a workout title first.");
      }

      if (!Array.isArray(workoutPayload.steps) || !workoutPayload.steps.length) {
        throw new Error("Add at least one step before sending.");
      }

      setSending(true);
      const headers = await getJsonAuthHeaders();
      const res = await fetch(`${API_URL}/garmin/send-workout`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId: uid,
          title: workoutPayload.name,
          workout: workoutPayload,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detailText =
          typeof json?.details === "string"
            ? json.details
            : json?.details && typeof json.details === "object"
            ? JSON.stringify(json.details)
            : "";
        throw new Error(
          [json?.error || json?.message || "Failed to send workout", detailText]
            .filter(Boolean)
            .join(" · ")
        );
      }

      setSentWorkoutId(String(json?.createdWorkoutId || ""));
      Alert.alert(
        json?.alreadySynced ? "Already sent" : "Sent",
        json?.message || "Workout sent to your watch."
      );
    } catch (error) {
      Alert.alert("Couldn’t send to watch", error?.message || "Try again.");
    } finally {
      setSending(false);
    }
  }, [workoutPayload]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 100 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
        >
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.headerBtn, { backgroundColor: colors.card2 }]}
              activeOpacity={0.85}
            >
              <Feather name="chevron-left" size={18} color={colors.text} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Create workout</Text>
              <Text style={[styles.headerSubtitle, { color: colors.subtext }]}>
                Build manually or use AI, then send it straight to Garmin.
              </Text>
            </View>
          </View>

          <LinearGradient colors={heroTheme.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <Text style={styles.heroEyebrow}>
              {draft.kind.toUpperCase()} · CUSTOM WORKOUT
              {sentWorkoutId ? " · SENT TO WATCH" : ""}
            </Text>

            <Text style={styles.heroTitle}>{draft.title || "Untitled workout"}</Text>
            <Text style={styles.heroSummary} numberOfLines={3}>
              {draft.description || "Shape the session manually or let AI build the first draft for you."}
            </Text>

            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaChip}>
                <Feather name="clock" size={12} color="#FFFFFF" />
                <Text style={styles.heroMetaText}>{durationLabel}</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Feather name="map-pin" size={12} color="#FFFFFF" />
                <Text style={styles.heroMetaText}>{distanceLabel}</Text>
              </View>
              <View style={styles.heroMetaChip}>
                <Feather name="list" size={12} color="#FFFFFF" />
                <Text style={styles.heroMetaText}>{stepCount} steps</Text>
              </View>
            </View>

            {sentWorkoutId ? (
              <View style={styles.heroStatusRow}>
                <Feather name="check-circle" size={14} color={heroTheme.accent} />
                <Text style={[styles.heroStatusText, { color: heroTheme.accent }]}>
                  Sent to Garmin{sentWorkoutId ? ` · ${sentWorkoutId}` : ""}
                </Text>
              </View>
            ) : null}

            <LinearGradient
              colors={["transparent", heroTheme.accent, "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.heroEdge}
            />
          </LinearGradient>

          <View style={styles.modeRow}>
            {BUILDER_MODE_OPTIONS.map((option) => {
              const active = builderMode === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setBuilderMode(option.key)}
                  style={[
                    styles.modePill,
                    {
                      backgroundColor: active ? accentFill : colors.card2,
                      borderColor: active ? "transparent" : colors.border,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Text
                    style={{
                      color: active ? onAccent : colors.text,
                      fontSize: 12,
                      fontWeight: "800",
                    }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {builderMode === "ai" ? (
            <View style={[styles.card, { backgroundColor: colors.card2, borderColor: colors.border }]}>
              <View style={styles.cardHead}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Generate with AI</Text>
                <TouchableOpacity
                  onPress={handleAiGenerate}
                  style={[
                    styles.inlineBtn,
                    {
                      backgroundColor: accentFill,
                    },
                  ]}
                  activeOpacity={0.85}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color={onAccent} />
                  ) : (
                    <>
                      <Feather name="sparkles" size={14} color={onAccent} />
                      <Text style={[styles.inlineBtnText, { color: onAccent }]}>
                        Generate
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <Text style={[styles.supportText, { color: colors.subtext }]}>
                Describe the session in plain English. AI will generate the first structured draft you can still edit.
              </Text>

              <TextInput
                value={aiPrompt}
                onChangeText={setAiPrompt}
                placeholder="e.g. Create a 50 minute marathon workout with a progressive main set and clear pace cues."
                placeholderTextColor={colors.subtext}
                multiline
                textAlignVertical="top"
                keyboardAppearance={keyboardAppearance}
                style={[
                  styles.bigInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <View style={styles.suggestionWrap}>
                {AI_PROMPT_SUGGESTIONS.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion}
                    onPress={() => setAiPrompt(suggestion)}
                    style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.suggestionText, { color: colors.text }]} numberOfLines={2}>
                      {suggestion}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: colors.card2, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Workout setup</Text>

            <View style={styles.kindRow}>
              {WORKOUT_KIND_OPTIONS.map((option) => {
                const active = draft.kind === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => updateDraft({ kind: option.key })}
                    style={[
                      styles.kindPill,
                      {
                        backgroundColor: active ? accentFill : colors.card,
                        borderColor: active ? "transparent" : colors.border,
                      },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Feather
                      name={option.icon}
                      size={14}
                      color={active ? onAccent : colors.text}
                    />
                    <Text
                      style={{
                        color: active ? onAccent : colors.text,
                        fontWeight: "800",
                        fontSize: 12,
                      }}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.subtext }]}>Title</Text>
            <TextInput
              value={draft.title}
              onChangeText={(value) => updateDraft({ title: value })}
              placeholder="Workout title"
              placeholderTextColor={colors.subtext}
              keyboardAppearance={keyboardAppearance}
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
            />

            <Text style={[styles.label, { color: colors.subtext }]}>Description</Text>
            <TextInput
              value={draft.description}
              onChangeText={(value) => updateDraft({ description: value })}
              placeholder="Short coaching summary or session goal"
              placeholderTextColor={colors.subtext}
              keyboardAppearance={keyboardAppearance}
              multiline
              textAlignVertical="top"
              style={[
                styles.bigInput,
                styles.descriptionInput,
                { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
              ]}
            />

            <View style={styles.metricRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.subtext }]}>Duration (min)</Text>
                <TextInput
                  value={draft.durationMin}
                  onChangeText={(value) => updateDraft({ durationMin: value.replace(/[^0-9.]/g, "") })}
                  placeholder="45"
                  placeholderTextColor={colors.subtext}
                  keyboardAppearance={keyboardAppearance}
                  keyboardType="decimal-pad"
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.subtext }]}>Distance (km)</Text>
                <TextInput
                  value={draft.distanceKm}
                  onChangeText={(value) => updateDraft({ distanceKm: value.replace(/[^0-9.]/g, "") })}
                  placeholder="8.0"
                  placeholderTextColor={colors.subtext}
                  keyboardAppearance={keyboardAppearance}
                  keyboardType="decimal-pad"
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                />
              </View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card2, borderColor: colors.border }]}>
            <View style={styles.cardHead}>
              <View>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Workout steps</Text>
                <Text style={[styles.supportText, { color: colors.subtext }]}>
                  Keep each step clean. Garmin only needs a clear label, duration, and optional target.
                </Text>
              </View>

              <TouchableOpacity
                onPress={addStep}
                style={[styles.inlineBtnGhost, { backgroundColor: colors.card, borderColor: colors.border }]}
                activeOpacity={0.85}
              >
                <Feather name="plus" size={14} color={colors.text} />
                <Text style={[styles.inlineBtnText, { color: colors.text }]}>Add step</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.stepList}>
              {draft.steps.map((step, index) => (
                <View key={step.id} style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.stepCardHead}>
                    <Text style={[styles.stepIndex, { color: colors.subtext }]}>Step {index + 1}</Text>
                    <TouchableOpacity onPress={() => removeStep(step.id)} activeOpacity={0.8}>
                      <Feather name="trash-2" size={16} color={colors.subtext} />
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    value={step.label}
                    onChangeText={(value) => updateStep(step.id, { label: value })}
                    placeholder="Step label"
                    placeholderTextColor={colors.subtext}
                    keyboardAppearance={keyboardAppearance}
                    style={[styles.input, { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text }]}
                  />

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                    {stepOptions.map((option) => {
                      const active = step.stepType === option.key;
                      return (
                        <TouchableOpacity
                          key={`${step.id}-${option.key}`}
                          onPress={() => updateStep(step.id, { stepType: option.key })}
                          style={[
                            styles.optionChip,
                            {
                              backgroundColor: active ? accentFill : colors.card2,
                              borderColor: active ? "transparent" : colors.border,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={{
                              color: active ? onAccent : colors.text,
                              fontSize: 11,
                              fontWeight: "800",
                            }}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.optionRowWrap}>
                    {DURATION_TYPE_OPTIONS.map((option) => {
                      const active = step.durationType === option.key;
                      return (
                        <TouchableOpacity
                          key={`${step.id}-duration-${option.key}`}
                          onPress={() =>
                            updateStep(step.id, {
                              durationType: option.key,
                              durationUnit:
                                option.key === "distance" ? "km" : option.key === "time" ? "min" : "",
                            })
                          }
                          style={[
                            styles.optionChip,
                            {
                              backgroundColor: active ? accentFill : colors.card2,
                              borderColor: active ? "transparent" : colors.border,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={{
                              color: active ? onAccent : colors.text,
                              fontSize: 11,
                              fontWeight: "800",
                            }}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {step.durationType !== "open" ? (
                    <View style={styles.metricRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: colors.subtext }]}>
                          {step.durationType === "distance" ? "Distance" : "Time"}
                        </Text>
                        <TextInput
                          value={String(step.durationValue || "")}
                          onChangeText={(value) =>
                            updateStep(step.id, { durationValue: value.replace(/[^0-9.]/g, "") })
                          }
                          placeholder={step.durationType === "distance" ? "4.0" : "10"}
                          placeholderTextColor={colors.subtext}
                          keyboardAppearance={keyboardAppearance}
                          keyboardType="decimal-pad"
                          style={[
                            styles.input,
                            { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                          ]}
                        />
                      </View>

                      <View style={{ width: 86 }}>
                        <Text style={[styles.label, { color: colors.subtext }]}>Unit</Text>
                        <View style={[styles.unitPill, { backgroundColor: colors.card2, borderColor: colors.border }]}>
                          <Text style={{ color: colors.text, fontWeight: "700" }}>
                            {step.durationType === "distance" ? "km" : "min"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.optionRowWrap}>
                    {TARGET_TYPE_OPTIONS.map((option) => {
                      const active = step.targetType === option.key;
                      return (
                        <TouchableOpacity
                          key={`${step.id}-target-${option.key}`}
                          onPress={() => updateStep(step.id, { targetType: option.key })}
                          style={[
                            styles.optionChip,
                            {
                              backgroundColor: active ? accentFill : colors.card2,
                              borderColor: active ? "transparent" : colors.border,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={{
                              color: active ? onAccent : colors.text,
                              fontSize: 11,
                              fontWeight: "800",
                            }}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {step.targetType === "pace_range" ? (
                    <View style={styles.metricRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: colors.subtext }]}>Fast pace</Text>
                        <TextInput
                          value={step.paceMin}
                          onChangeText={(value) => updateStep(step.id, { paceMin: value })}
                          placeholder="4:30"
                          placeholderTextColor={colors.subtext}
                          keyboardAppearance={keyboardAppearance}
                          style={[
                            styles.input,
                            { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                          ]}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: colors.subtext }]}>Slow pace</Text>
                        <TextInput
                          value={step.paceMax}
                          onChangeText={(value) => updateStep(step.id, { paceMax: value })}
                          placeholder="5:00"
                          placeholderTextColor={colors.subtext}
                          keyboardAppearance={keyboardAppearance}
                          style={[
                            styles.input,
                            { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                          ]}
                        />
                      </View>
                    </View>
                  ) : null}

                  {step.targetType === "hr_range" ? (
                    <View style={styles.metricRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: colors.subtext }]}>Min HR</Text>
                        <TextInput
                          value={step.hrMin}
                          onChangeText={(value) => updateStep(step.id, { hrMin: value.replace(/[^0-9]/g, "") })}
                          placeholder="145"
                          placeholderTextColor={colors.subtext}
                          keyboardAppearance={keyboardAppearance}
                          keyboardType="number-pad"
                          style={[
                            styles.input,
                            { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                          ]}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.label, { color: colors.subtext }]}>Max HR</Text>
                        <TextInput
                          value={step.hrMax}
                          onChangeText={(value) => updateStep(step.id, { hrMax: value.replace(/[^0-9]/g, "") })}
                          placeholder="160"
                          placeholderTextColor={colors.subtext}
                          keyboardAppearance={keyboardAppearance}
                          keyboardType="number-pad"
                          style={[
                            styles.input,
                            { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                          ]}
                        />
                      </View>
                    </View>
                  ) : null}

                  <TextInput
                    value={step.notes}
                    onChangeText={(value) => updateStep(step.id, { notes: value })}
                    placeholder="Coaching cues or structure"
                    placeholderTextColor={colors.subtext}
                    keyboardAppearance={keyboardAppearance}
                    multiline
                    textAlignVertical="top"
                    style={[
                      styles.bigInput,
                      styles.stepNotesInput,
                      { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                    ]}
                  />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 14),
              backgroundColor: colors.bg,
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleSendToWatch}
            disabled={sending}
            style={[
              styles.primaryBtn,
              { backgroundColor: accentFill },
            ]}
            activeOpacity={0.9}
          >
            {sending ? (
              <ActivityIndicator size="small" color={onAccent} />
            ) : (
              <>
                <Feather name="send" size={16} color={onAccent} />
                <Text style={[styles.primaryBtnText, { color: onAccent }]}>
                  {sentWorkoutId ? "Send again" : "Send to watch"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    gap: 12,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  hero: {
    borderRadius: 22,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 10,
    position: "relative",
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.72)",
    textTransform: "uppercase",
  },
  heroTitle: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  heroSummary: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: "rgba(255,255,255,0.84)",
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  heroMetaChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroMetaText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  heroStatusRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroStatusText: {
    fontSize: 12,
    fontWeight: "800",
  },
  heroEdge: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 0,
    height: 3,
    borderRadius: 999,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modePill: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "900",
  },
  supportText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  inlineBtn: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  inlineBtnGhost: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  inlineBtnText: {
    fontSize: 12,
    fontWeight: "800",
  },
  bigInput: {
    minHeight: 112,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    fontWeight: "600",
  },
  descriptionInput: {
    minHeight: 96,
  },
  suggestionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestionChip: {
    width: "48%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  kindRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  kindPill: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "700",
  },
  metricRow: {
    flexDirection: "row",
    gap: 10,
  },
  unitPill: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stepList: {
    gap: 10,
  },
  stepCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 10,
  },
  stepCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepIndex: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  optionRow: {
    gap: 8,
  },
  optionRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNotesInput: {
    minHeight: 80,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "900",
  },
});
