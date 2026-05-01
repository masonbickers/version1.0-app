import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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

const GOAL_PRESETS = {
  run: {
    distance: ["5", "10", "14", "21"],
    time: ["30", "45", "60", "75"],
  },
  hybrid: {
    distance: ["3", "5", "8", "10"],
    time: ["30", "45", "60", "75"],
  },
  strength: {
    time: ["30", "45", "60", "75"],
  },
};

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

const SAMPLE_HEADER_TITLES = {
  run_easy_35: { kind: "run", title: "Create easy run" },
  run_intervals_intro: { kind: "run", title: "Create interval workout" },
  strength_40: { kind: "strength", title: "Create strength workout" },
  bodyweight_20: { kind: "strength", title: "Create bodyweight workout" },
  hybrid_engine_30: { kind: "hybrid", title: "Create hybrid workout" },
  recovery_flow_25: { kind: "hybrid", title: "Create recovery workout" },
};

const KIND_HEADER_TITLES = {
  run: "Create run workout",
  strength: "Create strength workout",
  hybrid: "Create hybrid workout",
};

function getCreateWorkoutHeaderTitle(sampleKey, kind, mode) {
  if (mode === "ai") return "Create workout";

  const sampleConfig = SAMPLE_HEADER_TITLES[String(sampleKey || "").trim()];
  if (sampleConfig && sampleConfig.kind === kind) {
    return sampleConfig.title;
  }

  return KIND_HEADER_TITLES[String(kind || "").trim()] || "Create workout";
}

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

function defaultSampleKeyForKind(kind) {
  if (kind === "strength") return "strength_40";
  if (kind === "hybrid") return "hybrid_engine_30";
  return "run_easy_35";
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

  const resolvedSteps = steps.length
    ? steps
    : [
        {
          type: String(draft.title || "Main set").trim() || "Main set",
          stepType:
            draft.kind === "strength" ? "strength" : draft.kind === "hybrid" ? "conditioning" : "run",
          notes: String(draft.description || "").trim(),
          targetType: "open",
          ...(distanceKm
            ? {
                durationType: "distance",
                durationValue: distanceKm,
                durationUnit: "km",
              }
            : durationMin
            ? {
                durationType: "time",
                durationValue: durationMin,
                durationUnit: "min",
              }
            : {
                durationType: "open",
              }),
        },
      ];

  return {
    name: String(draft.title || "Custom workout").trim() || "Custom workout",
    sport: mapKindToSport(draft.kind),
    description: String(draft.description || "").trim(),
    totalDurationSec: durationMin ? Math.round(durationMin * 60) : undefined,
    totalDistanceKm: distanceKm ? Number(distanceKm.toFixed(3)) : undefined,
    steps: resolvedSteps,
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

function buildExpandedStepMap(steps = []) {
  return (Array.isArray(steps) ? steps : []).reduce((acc, step) => {
    const hasExtras =
      String(step?.targetType || "open").trim().toLowerCase() !== "open" ||
      !!String(step?.notes || "").trim();
    if (hasExtras && step?.id) acc[step.id] = true;
    return acc;
  }, {});
}

function formatGoalMeta(goalMode, goalValue) {
  const n = parsePositive(goalValue);
  if (!n) return goalMode === "distance" ? "10 km" : "45 min";
  if (goalMode === "distance") {
    return `${Number(n).toFixed(n % 1 === 0 ? 0 : 1)} km`;
  }
  return `${Math.round(n)} min`;
}

function portionValue(goalMode, total, ratio, minFloor = 1) {
  const safe = parsePositive(total) || 0;
  if (!safe) return "";
  if (goalMode === "distance") {
    return String(Math.max(minFloor, Number((safe * ratio).toFixed(1))));
  }
  return String(Math.max(minFloor, Math.round(safe * ratio)));
}

function makeDraftStep({ label, stepType, goalMode, durationValue, notes = "", targetType = "open" }) {
  return makeInitialStep({
    label,
    stepType,
    durationType: goalMode === "distance" ? "distance" : "time",
    durationValue: String(durationValue || ""),
    durationUnit: goalMode === "distance" ? "km" : "min",
    notes,
    targetType,
  });
}

function buildRecommendationDraft({ kind, title, description, goalMode, goalValue, steps, aiPrompt }) {
  return {
    mode: "manual",
    kind,
    title,
    description,
    durationMin: goalMode === "time" || kind === "strength" ? String(goalValue || "") : "",
    distanceKm: goalMode === "distance" ? String(goalValue || "") : "",
    aiPrompt: aiPrompt || "",
    steps,
  };
}

function buildRecommendationCards(sampleKey, kind, goalMode, goalValue) {
  const family =
    String(sampleKey || "").trim() ||
    (kind === "strength" ? "strength_40" : kind === "hybrid" ? "hybrid_engine_30" : "run_easy_35");
  const goalMeta = formatGoalMeta(goalMode, goalValue);
  const runWarm = portionValue(goalMode, goalValue, 0.2, goalMode === "distance" ? 1 : 5);
  const runMain = portionValue(goalMode, goalValue, 0.6, goalMode === "distance" ? 2 : 12);
  const runCool = portionValue(goalMode, goalValue, 0.2, goalMode === "distance" ? 1 : 5);

  if (family === "run_intervals_intro") {
    return [
      {
        id: "short_repeats",
        title: "Short Repeats",
        tag: "Best for speed",
        meta: `Intervals · ${goalMeta}`,
        aiPrompt: `Build a short repeat workout for ${goalMeta} with clear reps and recoveries.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Short Repeats",
          description: "Controlled speed work with short reps and relaxed recoveries.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode, durationValue: runWarm, notes: "Easy build into work." }),
            makeDraftStep({ label: "Main set", stepType: "run", goalMode, durationValue: runMain, notes: "8 x 1 min hard / 75 sec easy." }),
            makeDraftStep({ label: "Cool-down", stepType: "cooldown", goalMode, durationValue: runCool, notes: "Jog back down easy." }),
          ],
        }),
      },
      {
        id: "tempo_blocks",
        title: "Tempo Blocks",
        tag: "Best for threshold",
        meta: `Tempo · ${goalMeta}`,
        aiPrompt: `Build a tempo block workout for ${goalMeta} with warm-up and cooldown.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Tempo Blocks",
          description: "Threshold-focused work with smoother sustained blocks.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode, durationValue: runWarm, notes: "Easy jog and prep strides." }),
            makeDraftStep({ label: "Tempo blocks", stepType: "run", goalMode, durationValue: runMain, notes: "2 x 10 min tempo with 2 min float." }),
            makeDraftStep({ label: "Cool-down", stepType: "cooldown", goalMode, durationValue: runCool, notes: "Relaxed jog finish." }),
          ],
        }),
      },
      {
        id: "fartlek_build",
        title: "Fartlek Build",
        tag: "Best for variety",
        meta: `Fartlek · ${goalMeta}`,
        aiPrompt: `Build a fartlek workout for ${goalMeta} with simple on-off changes.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Fartlek Build",
          description: "Simple on-off changes that stay controlled and light.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode, durationValue: runWarm, notes: "Easy jog with a few pick-ups." }),
            makeDraftStep({ label: "Fartlek", stepType: "run", goalMode, durationValue: runMain, notes: "Alternating 2 min on / 1 min easy." }),
            makeDraftStep({ label: "Cool-down", stepType: "cooldown", goalMode, durationValue: runCool, notes: "Jog easy to finish." }),
          ],
        }),
      },
    ];
  }

  if (family === "strength_40") {
    return [
      {
        id: "full_body",
        title: "Full Body Strength",
        tag: "Best for balance",
        meta: `Strength · ${goalMeta}`,
        aiPrompt: `Build a full-body strength session for ${goalMeta} with a warm-up and accessories.`,
        draft: buildRecommendationDraft({
          kind: "strength",
          title: "Full Body Strength",
          description: "Compound-led gym session covering push, pull, and lower body.",
          goalMode: "time",
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 6), notes: "Mobility and activation." }),
            makeDraftStep({ label: "Main lifts", stepType: "strength", goalMode: "time", durationValue: portionValue("time", goalValue, 0.55, 16), notes: "2 compound lifts with controlled rest." }),
            makeDraftStep({ label: "Accessory work", stepType: "conditioning", goalMode: "time", durationValue: portionValue("time", goalValue, 0.25, 8), notes: "Accessory strength and trunk work." }),
          ],
        }),
      },
      {
        id: "upper_body",
        title: "Upper Strength",
        tag: "Best for upper",
        meta: `Strength · ${goalMeta}`,
        aiPrompt: `Build an upper-body strength workout for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "strength",
          title: "Upper Strength",
          description: "Push-pull upper session with controlled pressing and rowing.",
          goalMode: "time",
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 6), notes: "Shoulder prep and band activation." }),
            makeDraftStep({ label: "Push + pull", stepType: "strength", goalMode: "time", durationValue: portionValue("time", goalValue, 0.6, 18), notes: "Bench, pull ups, overhead press, row." }),
            makeDraftStep({ label: "Accessories", stepType: "conditioning", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 8), notes: "Arms and trunk finisher." }),
          ],
        }),
      },
      {
        id: "lower_body",
        title: "Lower Strength",
        tag: "Best for lower",
        meta: `Strength · ${goalMeta}`,
        aiPrompt: `Build a lower-body strength workout for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "strength",
          title: "Lower Strength",
          description: "Squat and hinge focused session with unilateral work.",
          goalMode: "time",
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 6), notes: "Hips, ankles, and activation." }),
            makeDraftStep({ label: "Main lifts", stepType: "strength", goalMode: "time", durationValue: portionValue("time", goalValue, 0.55, 16), notes: "Squat, RDL, split squat." }),
            makeDraftStep({ label: "Finish", stepType: "conditioning", goalMode: "time", durationValue: portionValue("time", goalValue, 0.25, 8), notes: "Core and carry finisher." }),
          ],
        }),
      },
    ];
  }

  if (family === "bodyweight_20") {
    return [
      {
        id: "bodyweight_circuit",
        title: "Bodyweight Circuit",
        tag: "Best for no kit",
        meta: `Bodyweight · ${goalMeta}`,
        aiPrompt: `Build a bodyweight circuit for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "strength",
          title: "Bodyweight Circuit",
          description: "Simple full-body circuit using bodyweight only.",
          goalMode: "time",
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 4), notes: "Open hips, shoulders, trunk." }),
            makeDraftStep({ label: "Circuit", stepType: "conditioning", goalMode: "time", durationValue: portionValue("time", goalValue, 0.6, 10), notes: "Squats, lunges, push-ups, plank." }),
            makeDraftStep({ label: "Reset", stepType: "cooldown", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 4), notes: "Mobility reset." }),
          ],
        }),
      },
      {
        id: "emom_builder",
        title: "EMOM Builder",
        tag: "Best for structure",
        meta: `Conditioning · ${goalMeta}`,
        aiPrompt: `Build a bodyweight EMOM for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "strength",
          title: "EMOM Builder",
          description: "Minute-by-minute bodyweight work with repeatable pacing.",
          goalMode: "time",
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: portionValue("time", goalValue, 0.15, 4), notes: "Prep and activation." }),
            makeDraftStep({ label: "EMOM", stepType: "conditioning", goalMode: "time", durationValue: portionValue("time", goalValue, 0.7, 12), notes: "Alternating squat, push, core stations." }),
            makeDraftStep({ label: "Cool-down", stepType: "cooldown", goalMode: "time", durationValue: portionValue("time", goalValue, 0.15, 4), notes: "Breathing and easy stretch." }),
          ],
        }),
      },
      {
        id: "core_conditioning",
        title: "Core + Conditioning",
        tag: "Best for trunk",
        meta: `Core · ${goalMeta}`,
        aiPrompt: `Build a core and conditioning bodyweight workout for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "strength",
          title: "Core + Conditioning",
          description: "Short bodyweight session with trunk focus and smooth flow.",
          goalMode: "time",
          goalValue,
          steps: [
            makeDraftStep({ label: "Prep", stepType: "warmup", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 4), notes: "Breathing, hips, and spine prep." }),
            makeDraftStep({ label: "Main flow", stepType: "conditioning", goalMode: "time", durationValue: portionValue("time", goalValue, 0.6, 10), notes: "Core, carries, and movement quality." }),
            makeDraftStep({ label: "Reset", stepType: "cooldown", goalMode: "time", durationValue: portionValue("time", goalValue, 0.2, 4), notes: "Easy mobility finish." }),
          ],
        }),
      },
    ];
  }

  if (family === "hybrid_engine_30") {
    return [
      {
        id: "hybrid_engine",
        title: "Hybrid Engine",
        tag: "Best for balance",
        meta: `Hybrid · ${goalMeta}`,
        aiPrompt: `Build a hybrid engine workout for ${goalMeta} with running and strength stations.`,
        draft: buildRecommendationDraft({
          kind: "hybrid",
          title: "Hybrid Engine",
          description: "Alternating running and work stations with steady control.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: goalMode === "distance" ? "time" : goalMode, durationValue: goalMode === "distance" ? "8" : portionValue("time", goalValue, 0.2, 6), notes: "Easy jog and movement prep." }),
            makeDraftStep({ label: "Run block", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.5, goalMode === "distance" ? 2 : 12), notes: "Steady aerobic work." }),
            makeDraftStep({ label: "Work block", stepType: "strength", goalMode: "time", durationValue: portionValue("time", goalMode === "time" ? goalValue : 18, 0.35, 8), notes: "Sled, carries, burpees, wall balls." }),
          ],
        }),
      },
      {
        id: "run_strength_combo",
        title: "Run + Strength",
        tag: "Best for mixed load",
        meta: `Hybrid · ${goalMeta}`,
        aiPrompt: `Build a run and strength combo workout for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "hybrid",
          title: "Run + Strength",
          description: "Run-led session with a dedicated strength station block.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: "8", notes: "Prep and build." }),
            makeDraftStep({ label: "Steady run", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.6, goalMode === "distance" ? 3 : 15), notes: "Controlled pacing." }),
            makeDraftStep({ label: "Strength station", stepType: "strength", goalMode: "time", durationValue: "10", notes: "Functional strength work." }),
          ],
        }),
      },
      {
        id: "threshold_mix",
        title: "Threshold Mix",
        tag: "Best for engine",
        meta: `Hybrid · ${goalMeta}`,
        aiPrompt: `Build a threshold-style hybrid workout for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "hybrid",
          title: "Threshold Mix",
          description: "Harder hybrid session with controlled threshold effort.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Warm-up", stepType: "warmup", goalMode: "time", durationValue: "8", notes: "Prep and build." }),
            makeDraftStep({ label: "Threshold run", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.45, goalMode === "distance" ? 2 : 12), notes: "Controlled threshold effort." }),
            makeDraftStep({ label: "Conditioning", stepType: "conditioning", goalMode: "time", durationValue: "12", notes: "Carries, lunges, burpee broad jumps." }),
          ],
        }),
      },
    ];
  }

  if (family === "recovery_flow_25") {
    return [
      {
        id: "recovery_flow",
        title: "Recovery Flow",
        tag: "Best for reset",
        meta: `Recovery · ${goalMeta}`,
        aiPrompt: `Build a recovery flow workout for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "hybrid",
          title: "Recovery Flow",
          description: "Low-stress mobility and movement session to reset.",
          goalMode: "time",
          goalValue: goalMode === "time" ? goalValue : 25,
          steps: [
            makeDraftStep({ label: "Mobility flow", stepType: "recovery", goalMode: "time", durationValue: portionValue("time", goalMode === "time" ? goalValue : 25, 0.5, 10), notes: "Open hips, spine, shoulders." }),
            makeDraftStep({ label: "Easy movement", stepType: "recovery", goalMode: "time", durationValue: portionValue("time", goalMode === "time" ? goalValue : 25, 0.5, 10), notes: "Breathing and easy movement." }),
          ],
        }),
      },
      {
        id: "easy_reset_jog",
        title: "Easy Reset Jog",
        tag: "Best for shakeout",
        meta: `Recovery · ${goalMeta}`,
        aiPrompt: `Build an easy recovery jog for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Easy Reset Jog",
          description: "Very easy shakeout effort with no pressure.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Easy jog", stepType: "recovery", goalMode, durationValue: goalValue, notes: "Keep it conversational and soft." }),
          ],
        }),
      },
      {
        id: "breath_reset",
        title: "Breath + Reset",
        tag: "Best for recovery",
        meta: `Recovery · ${goalMeta}`,
        aiPrompt: `Build a breath and recovery session for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "hybrid",
          title: "Breath + Reset",
          description: "Breathing, trunk control, and mobility work.",
          goalMode: "time",
          goalValue: goalMode === "time" ? goalValue : 20,
          steps: [
            makeDraftStep({ label: "Breath work", stepType: "recovery", goalMode: "time", durationValue: portionValue("time", goalMode === "time" ? goalValue : 20, 0.4, 8), notes: "Down-regulation and control." }),
            makeDraftStep({ label: "Reset flow", stepType: "recovery", goalMode: "time", durationValue: portionValue("time", goalMode === "time" ? goalValue : 20, 0.6, 12), notes: "Mobility and easy trunk work." }),
          ],
        }),
      },
    ];
  }

  if (family === "run_easy_35") {
    return [
      {
        id: "steady_easy",
        title: "Steady Easy Run",
        tag: "Best for balance",
        meta: `Easy · ${goalMeta}`,
        aiPrompt: `Build a steady easy run for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Steady Easy Run",
          description: "Relaxed aerobic run to build volume without extra fatigue.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Easy aerobic", stepType: "run", goalMode, durationValue: goalValue, notes: "Conversational effort throughout." }),
          ],
        }),
      },
      {
        id: "progression_run",
        title: "Progression Run",
        tag: "Best for rhythm",
        meta: `Easy to steady · ${goalMeta}`,
        aiPrompt: `Build a progression run for ${goalMeta} finishing steady.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Progression Run",
          description: "Start smooth, then lift gradually into a steady finish.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Settle in", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.7, goalMode === "distance" ? 3 : 20), notes: "Relaxed and controlled." }),
            makeDraftStep({ label: "Steady finish", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.3, goalMode === "distance" ? 1 : 10), notes: "Lift smoothly into steady effort." }),
          ],
        }),
      },
      {
        id: "recovery_cruise",
        title: "Recovery Cruise",
        tag: "Best for easy days",
        meta: `Recovery · ${goalMeta}`,
        aiPrompt: `Build a recovery cruise run for ${goalMeta}.`,
        draft: buildRecommendationDraft({
          kind: "run",
          title: "Recovery Cruise",
          description: "Light aerobic work designed to leave you fresher, not flatter.",
          goalMode,
          goalValue,
          steps: [
            makeDraftStep({ label: "Recovery run", stepType: "recovery", goalMode, durationValue: goalValue, notes: "Very easy effort throughout." }),
          ],
        }),
      },
    ];
  }

  return [
    {
      id: "long_aerobic",
      title: "Long Aerobic",
      tag: "Best for endurance",
      meta: `Long run · ${goalMeta}`,
      aiPrompt: `Build a long aerobic run for ${goalMeta}.`,
      draft: buildRecommendationDraft({
        kind: "run",
        title: "Long Aerobic",
        description: "Steady long run focused on rhythm and aerobic time.",
        goalMode,
        goalValue,
        steps: [
          makeDraftStep({ label: "Long aerobic", stepType: "run", goalMode, durationValue: goalValue, notes: "Stay relaxed and controlled." }),
        ],
      }),
    },
    {
      id: "progressive_long",
      title: "Progressive Long Run",
      tag: "Best for progression",
      meta: `Long run · ${goalMeta}`,
      aiPrompt: `Build a progressive long run for ${goalMeta}.`,
      draft: buildRecommendationDraft({
        kind: "run",
        title: "Progressive Long Run",
        description: "Start easy and finish with more intent.",
        goalMode,
        goalValue,
        steps: [
          makeDraftStep({ label: "Settle", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.75, goalMode === "distance" ? 6 : 35), notes: "Easy aerobic." }),
          makeDraftStep({ label: "Finish steady", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.25, goalMode === "distance" ? 2 : 12), notes: "Lift to steady effort." }),
        ],
      }),
    },
    {
      id: "fast_finish",
      title: "Fast Finish Long Run",
      tag: "Best for race prep",
      meta: `Long run · ${goalMeta}`,
      aiPrompt: `Build a fast finish long run for ${goalMeta}.`,
      draft: buildRecommendationDraft({
        kind: "run",
        title: "Fast Finish Long Run",
        description: "Long run with a firmer closing section.",
        goalMode,
        goalValue,
        steps: [
          makeDraftStep({ label: "Easy volume", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.8, goalMode === "distance" ? 8 : 45), notes: "Relaxed aerobic pacing." }),
          makeDraftStep({ label: "Fast finish", stepType: "run", goalMode, durationValue: portionValue(goalMode, goalValue, 0.2, goalMode === "distance" ? 2 : 10), notes: "Strong but controlled close." }),
        ],
      }),
    },
  ];
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

  const [draft, setDraft] = useState(initialDraft);
  const [goalMode, setGoalMode] = useState(
    initialDraft.kind === "strength" ? "time" : initialDraft.distanceKm ? "distance" : "time"
  );
  const [flowStep, setFlowStep] = useState("goal");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState("");
  const [showAdvancedEditor, setShowAdvancedEditor] = useState(false);
  const [expandedStepIds, setExpandedStepIds] = useState(() =>
    buildExpandedStepMap(initialDraft.steps)
  );
  const [aiPrompt, setAiPrompt] = useState(initialDraft.aiPrompt || "");
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentWorkoutId, setSentWorkoutId] = useState("");

  useEffect(() => {
    const nextDraft = buildDraftFromSeed(requestedSampleKey, requestedMode === "ai" ? "ai" : "manual");
    setDraft(nextDraft);
    setGoalMode(nextDraft.kind === "strength" ? "time" : nextDraft.distanceKm ? "distance" : "time");
    setFlowStep("goal");
    setSelectedRecommendationId("");
    setShowAdvancedEditor(false);
    setExpandedStepIds(buildExpandedStepMap(nextDraft.steps));
    setAiPrompt(nextDraft.aiPrompt || "");
    setSentWorkoutId("");
  }, [requestedMode, requestedSampleKey]);

  useEffect(() => {
    if (draft.kind === "strength" && goalMode !== "time") {
      setGoalMode("time");
    }
  }, [draft.kind, goalMode]);

  const keyboardAppearance = isDark ? "dark" : "light";
  const accentFill = colors?.accentBg || colors?.primary || PRIMARY;
  const onAccent = colors?.sapOnPrimary || "#111111";
  const heroTheme = useMemo(
    () => heroColorsForKind(draft.kind, isDark, colors?.accentBg || colors?.primary || PRIMARY),
    [colors?.accentBg, colors?.primary, draft.kind, isDark]
  );
  const stepOptions = STEP_KIND_OPTIONS[draft.kind] || STEP_KIND_OPTIONS.run;
  const workoutPayload = useMemo(() => buildWorkoutPayload(draft), [draft]);
  const goalPresets = GOAL_PRESETS[draft.kind]?.[goalMode] || GOAL_PRESETS.run[goalMode] || [];
  const goalValue = goalMode === "distance" ? draft.distanceKm : draft.durationMin;
  const goalUnitLabel = goalMode === "distance" ? "KM" : "MIN";
  const goalMeta = formatGoalMeta(goalMode, goalValue);
  const headerTitle = useMemo(
    () => getCreateWorkoutHeaderTitle(requestedSampleKey, draft.kind, requestedMode),
    [draft.kind, requestedMode, requestedSampleKey]
  );
  const effectiveSampleKey = useMemo(() => {
    const raw = String(requestedSampleKey || "").trim();
    const fallback = defaultSampleKeyForKind(draft.kind);
    if (!raw) return fallback;
    if (draft.kind === "run" && raw.startsWith("run_")) return raw;
    if (draft.kind === "strength" && (raw === "strength_40" || raw === "bodyweight_20")) return raw;
    if (draft.kind === "hybrid" && (raw === "hybrid_engine_30" || raw === "recovery_flow_25")) return raw;
    return fallback;
  }, [draft.kind, requestedSampleKey]);
  const recommendationCards = useMemo(
    () => buildRecommendationCards(effectiveSampleKey, draft.kind, goalMode, goalValue),
    [draft.kind, effectiveSampleKey, goalMode, goalValue]
  );

  const updateDraft = useCallback((patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateGoalValue = useCallback(
    (value) => {
      const cleaned = value.replace(/[^0-9.]/g, "");
      if (goalMode === "distance") {
        updateDraft({ distanceKm: cleaned });
        return;
      }
      updateDraft({ durationMin: cleaned });
    },
    [goalMode, updateDraft]
  );

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
    setExpandedStepIds((prev) => {
      if (!prev?.[stepId]) return prev;
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
  }, []);

  const toggleStepExtras = useCallback((stepId) => {
    setExpandedStepIds((prev) => ({
      ...prev,
      [stepId]: !prev?.[stepId],
    }));
  }, []);

  const applyRecommendation = useCallback((card) => {
    if (!card?.draft) return;
    const nextDraft = {
      ...card.draft,
      mode: requestedMode === "ai" ? "ai" : "manual",
    };
    setDraft(nextDraft);
    setGoalMode(
      nextDraft.kind === "strength" ? "time" : nextDraft.distanceKm ? "distance" : "time"
    );
    setSelectedRecommendationId(card.id);
    setExpandedStepIds(buildExpandedStepMap(nextDraft.steps));
    setAiPrompt(
      card.aiPrompt ||
        `Build a ${goalMeta} ${nextDraft.kind} workout called ${nextDraft.title}. ${nextDraft.description}`
    );
    setSentWorkoutId("");
  }, [goalMeta, requestedMode]);

  const handleContinue = useCallback(() => {
    if (!parsePositive(goalValue)) {
      Alert.alert("Set a target", `Enter a ${goalMode === "distance" ? "distance" : "duration"} first.`);
      return;
    }

    const firstCard = recommendationCards[0];
    if (firstCard) {
      applyRecommendation(firstCard);
    }
    setFlowStep("recommendations");
  }, [applyRecommendation, goalMode, goalValue, recommendationCards]);

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
      setGoalMode(
        nextDraft.kind === "strength" ? "time" : nextDraft.distanceKm ? "distance" : "time"
      );
      setFlowStep("recommendations");
      setSelectedRecommendationId("ai_custom");
      setShowAdvancedEditor(false);
      setExpandedStepIds(buildExpandedStepMap(nextDraft.steps));
      setSentWorkoutId("");
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
        <View style={styles.contentNoScroll}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => {
                if (flowStep === "recommendations") {
                  setFlowStep("goal");
                  return;
                }
                router.back();
              }}
              style={[styles.headerBtn, { backgroundColor: colors.card2 }]}
              activeOpacity={0.85}
            >
              <Feather name="chevron-left" size={18} color={colors.text} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>{headerTitle}</Text>
              <Text style={[styles.headerSubtitle, { color: colors.subtext }]}>
                {flowStep === "goal"
                  ? "Choose your target first."
                  : "Pick the best workout for that target."}
              </Text>
            </View>
          </View>

          <View style={styles.flowStepsRow}>
            {["Target", "Workout"].map((label, index) => {
              const active = flowStep === (index === 0 ? "goal" : "recommendations");
              const complete = index === 0 && flowStep === "recommendations";
              return (
                <View
                  key={label}
                  style={[
                    styles.flowStepChip,
                    {
                      backgroundColor: active ? accentFill : colors.card2,
                      borderColor: active || complete ? "transparent" : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? onAccent : complete ? accentFill : colors.subtext,
                      fontSize: 11,
                      fontWeight: "900",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {`${index + 1}. ${label}`}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={styles.mainPanel}>
            {flowStep === "goal" ? (
              <View style={[styles.card, styles.mainCard, { backgroundColor: colors.card2, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Select target goal</Text>
                <Text style={[styles.supportText, { color: colors.subtext }]}>
                  Pick the session type and target. We&apos;ll suggest the workout next.
                </Text>

                <View style={styles.kindRow}>
                  {WORKOUT_KIND_OPTIONS.map((option) => {
                    const active = draft.kind === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => {
                          updateDraft({ kind: option.key });
                          setFlowStep("goal");
                          setSelectedRecommendationId("");
                        }}
                        style={[
                          styles.kindPill,
                          styles.compactKindPill,
                          {
                            backgroundColor: active ? accentFill : colors.card,
                            borderColor: active ? "transparent" : colors.border,
                          },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Feather name={option.icon} size={13} color={active ? onAccent : colors.text} />
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

                <View style={[styles.goalCard, styles.compactGoalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.goalCardHead}>
                    <Text style={[styles.goalCardTitle, { color: colors.text }]}>Target</Text>
                    {draft.kind !== "strength" ? (
                      <View style={[styles.goalModeRow, styles.compactGoalModeRow, { backgroundColor: colors.card2, borderColor: colors.border }]}>
                        {["distance", "time"].map((modeKey) => {
                          const active = goalMode === modeKey;
                          return (
                            <TouchableOpacity
                              key={modeKey}
                              onPress={() => setGoalMode(modeKey)}
                              style={[
                                styles.goalModePill,
                                {
                                  backgroundColor: active ? accentFill : "transparent",
                                },
                              ]}
                              activeOpacity={0.85}
                            >
                              <Text
                                style={{
                                  color: active ? onAccent : colors.subtext,
                                  fontSize: 11,
                                  fontWeight: "900",
                                  textTransform: "uppercase",
                                }}
                              >
                                {modeKey}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>

                  <View style={[styles.goalDisplay, styles.compactGoalDisplay, { backgroundColor: colors.card2, borderColor: colors.border }]}>
                    <TextInput
                      value={goalValue}
                      onChangeText={updateGoalValue}
                      placeholder={goalMode === "distance" ? "10.0" : "45"}
                      placeholderTextColor={colors.subtext}
                      keyboardAppearance={keyboardAppearance}
                      keyboardType="decimal-pad"
                      style={[styles.goalDisplayInput, styles.compactGoalDisplayInput, { color: colors.text }]}
                    />
                    <Text style={[styles.goalDisplayUnit, { color: colors.subtext }]}>{goalUnitLabel}</Text>
                  </View>

                  <View style={styles.goalPresetRow}>
                    {goalPresets.slice(0, 4).map((preset) => {
                      const active = String(goalValue || "") === String(preset);
                      return (
                        <TouchableOpacity
                          key={`${goalMode}-${preset}`}
                          onPress={() => updateGoalValue(String(preset))}
                          style={[
                            styles.goalPresetChip,
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
                            {goalMode === "distance" ? `${preset}k` : `${preset}m`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={[styles.simplePlanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.simplePlanTitle, { color: colors.text }]}>
                    {draft.kind === "strength" ? "Strength target" : `${goalMeta} target`}
                  </Text>
                  <Text style={[styles.simplePlanText, { color: colors.subtext }]}>
                    We&apos;ll recommend a few simple options based on this target.
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.card, styles.mainCard, { backgroundColor: colors.card2, borderColor: colors.border }]}>
                <View style={styles.cardHead}>
                  <View>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>Recommended workouts</Text>
                    <Text style={[styles.supportText, { color: colors.subtext }]}>
                      Based on {goalMeta}, here are the best fits.
                    </Text>
                  </View>
                  {sentWorkoutId ? (
                    <View style={[styles.summaryStatusPill, { backgroundColor: colors.card }]}>
                      <Text style={[styles.summaryStatusText, { color: accentFill }]}>SENT</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.recommendationList}>
                  {recommendationCards.map((card, index) => {
                    const active = selectedRecommendationId === card.id;
                    return (
                      <TouchableOpacity
                        key={card.id}
                        onPress={() => applyRecommendation(card)}
                        style={[
                          styles.recommendationCard,
                          {
                            backgroundColor: active ? colors.card : colors.card2,
                            borderColor: active ? accentFill : colors.border,
                          },
                        ]}
                        activeOpacity={0.85}
                      >
                        <View
                          style={[
                            styles.recommendationEdge,
                            { backgroundColor: active ? accentFill : index === 0 ? accentFill : heroTheme.accent },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.recommendationTitleRow}>
                            <Text style={[styles.recommendationTitle, { color: colors.text }]} numberOfLines={1}>
                              {card.title}
                            </Text>
                            <View
                              style={[
                                styles.recommendationTag,
                                {
                                  backgroundColor: active ? accentFill : colors.card,
                                  borderColor: active ? "transparent" : colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  color: active ? onAccent : colors.subtext,
                                  fontSize: 9,
                                  fontWeight: "900",
                                  letterSpacing: 0.4,
                                  textTransform: "uppercase",
                                }}
                              >
                                {active ? "Picked" : card.tag}
                              </Text>
                            </View>
                          </View>
                          <Text style={[styles.recommendationMeta, { color: colors.subtext }]} numberOfLines={1}>
                            {card.meta}
                          </Text>
                          <Text style={[styles.recommendationBody, { color: colors.text }]} numberOfLines={2}>
                            {card.draft.description}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.recommendationActionRow}>
                  <TouchableOpacity
                    onPress={() => setFlowStep("goal")}
                    style={[styles.inlineBtnGhost, styles.recommendationActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="arrow-left" size={14} color={colors.text} />
                    <Text style={[styles.inlineBtnText, { color: colors.text }]}>Change target</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setShowAdvancedEditor(true)}
                    style={[styles.inlineBtnGhost, styles.recommendationActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="edit-3" size={14} color={colors.text} />
                    <Text style={[styles.inlineBtnText, { color: colors.text }]}>Edit</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={handleAiGenerate}
                  style={[styles.inlineBtnGhost, styles.fullWidthButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                  activeOpacity={0.85}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color={colors.text} />
                  ) : (
                    <>
                      <Feather name="sparkles" size={14} color={colors.text} />
                      <Text style={[styles.inlineBtnText, { color: colors.text }]}>Generate with AI</Text>
                    </>
                  )}
                </TouchableOpacity>

                {selectedRecommendationId === "ai_custom" ? (
                  <View style={[styles.simplePlanCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.simplePlanTitle, { color: colors.text }]}>
                      {draft.title || "AI custom workout"}
                    </Text>
                    <Text style={[styles.simplePlanText, { color: colors.subtext }]}>
                      AI built a custom version from your selected target.
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </View>

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
            onPress={flowStep === "goal" ? handleContinue : handleSendToWatch}
            disabled={flowStep === "recommendations" ? sending : false}
            style={[
              styles.primaryBtn,
              { backgroundColor: accentFill },
            ]}
            activeOpacity={0.9}
          >
            {flowStep === "recommendations" && sending ? (
              <ActivityIndicator size="small" color={onAccent} />
            ) : (
              <>
                <Feather
                  name={flowStep === "goal" ? "arrow-right" : "send"}
                  size={16}
                  color={onAccent}
                />
                <Text style={[styles.primaryBtnText, { color: onAccent }]}>
                  {flowStep === "goal"
                    ? "Continue"
                    : sentWorkoutId
                    ? "Send again"
                    : "Send to watch"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={showAdvancedEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAdvancedEditor(false)}
      >
        <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setShowAdvancedEditor(false)}
              style={[styles.headerBtn, { backgroundColor: colors.card2 }]}
              activeOpacity={0.85}
            >
              <Feather name="chevron-left" size={18} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Edit steps</Text>
              <Text style={[styles.headerSubtitle, { color: colors.subtext }]}>
                Full control over structure and targets.
              </Text>
            </View>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) + 88 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
          >
            <View style={[styles.card, { backgroundColor: colors.card2, borderColor: colors.border }]}>
              <View style={styles.advancedActionsRow}>
                <Text style={[styles.advancedLabel, { color: colors.subtext }]}>Advanced step editor</Text>
                <TouchableOpacity
                  onPress={addStep}
                  style={[styles.inlineBtnGhost, { backgroundColor: colors.card, borderColor: colors.border }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus" size={14} color={colors.text} />
                  <Text style={[styles.inlineBtnText, { color: colors.text }]}>Step</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.stepList}>
                {draft.steps.map((step, index) => {
                  const showExtras = !!expandedStepIds?.[step.id];
                  const hasExtras =
                    String(step.targetType || "open").trim().toLowerCase() !== "open" ||
                    !!String(step.notes || "").trim();

                  return (
                    <View key={step.id} style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.stepCardHead}>
                        <Text style={[styles.stepIndex, { color: colors.subtext }]}>Step {index + 1}</Text>
                        <View style={styles.stepHeadActions}>
                          <TouchableOpacity
                            onPress={() => toggleStepExtras(step.id)}
                            style={[styles.stepActionBtn, { backgroundColor: colors.card2, borderColor: colors.border }]}
                            activeOpacity={0.8}
                          >
                            <Feather
                              name={showExtras ? "chevron-up" : "sliders"}
                              size={14}
                              color={showExtras || hasExtras ? colors.text : colors.subtext}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => removeStep(step.id)}
                            style={[styles.stepActionBtn, { backgroundColor: colors.card2, borderColor: colors.border }]}
                            activeOpacity={0.8}
                          >
                            <Feather name="trash-2" size={14} color={colors.subtext} />
                          </TouchableOpacity>
                        </View>
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

                      <View style={styles.stepDurationBlock}>
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
                                  styles.compactInput,
                                  { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                                ]}
                              />
                            </View>

                            <View style={{ width: 78 }}>
                              <Text style={[styles.label, { color: colors.subtext }]}>Unit</Text>
                              <View style={[styles.unitPill, styles.compactPill, { backgroundColor: colors.card2, borderColor: colors.border }]}>
                                <Text style={{ color: colors.text, fontWeight: "700" }}>
                                  {step.durationType === "distance" ? "km" : "min"}
                                </Text>
                              </View>
                            </View>
                          </View>
                        ) : null}
                      </View>

                      {showExtras ? (
                        <View style={styles.stepExtrasWrap}>
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
                                    styles.compactInput,
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
                                    styles.compactInput,
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
                                    styles.compactInput,
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
                                    styles.compactInput,
                                    { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                                  ]}
                                />
                              </View>
                            </View>
                          ) : null}

                          <TextInput
                            value={step.notes}
                            onChangeText={(value) => updateStep(step.id, { notes: value })}
                            placeholder="Optional notes"
                            placeholderTextColor={colors.subtext}
                            keyboardAppearance={keyboardAppearance}
                            multiline
                            textAlignVertical="top"
                            style={[
                              styles.bigInput,
                              styles.stepNotesInput,
                              styles.compactNotesInput,
                              { backgroundColor: colors.card2, borderColor: colors.border, color: colors.text },
                            ]}
                          />
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => toggleStepExtras(step.id)}
                          style={[styles.stepExtrasToggle, { backgroundColor: colors.card2, borderColor: colors.border }]}
                          activeOpacity={0.85}
                        >
                          <Feather name="plus-circle" size={14} color={colors.subtext} />
                          <Text style={[styles.stepExtrasToggleText, { color: colors.subtext }]}>
                            {hasExtras ? "Show target and notes" : "Add target or notes"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
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
              onPress={() => setShowAdvancedEditor(false)}
              style={[styles.primaryBtn, { backgroundColor: accentFill }]}
              activeOpacity={0.9}
            >
              <Feather name="check" size={16} color={onAccent} />
              <Text style={[styles.primaryBtnText, { color: onAccent }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  contentNoScroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  mainPanel: {
    flex: 1,
    gap: 10,
  },
  flowStepsRow: {
    flexDirection: "row",
    gap: 8,
  },
  flowStepChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
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
    fontSize: 22,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  summaryCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  summaryEyebrow: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  summaryStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  summaryStatusText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  summaryTitle: {
    fontSize: 21,
    lineHeight: 24,
    fontWeight: "900",
  },
  summaryMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryMetaChip: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryMetaText: {
    fontSize: 11,
    fontWeight: "800",
  },
  hero: {
    borderRadius: 22,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 8,
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
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  heroSummary: {
    fontSize: 12,
    lineHeight: 17,
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
    gap: 8,
  },
  mainCard: {
    gap: 8,
  },
  structureCard: {
    gap: 8,
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
  aiPromptInput: {
    minHeight: 88,
  },
  descriptionInput: {
    minHeight: 72,
  },
  recommendationList: {
    gap: 8,
  },
  recommendationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  recommendationMiniCard: {
    width: "48%",
    minHeight: 64,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: "center",
    overflow: "hidden",
  },
  recommendationMiniEdge: {
    position: "absolute",
    left: 0,
    top: 10,
    bottom: 10,
    width: 4,
    borderRadius: 999,
  },
  recommendationMiniTitle: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: "900",
  },
  recommendationMiniMeta: {
    marginLeft: 8,
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
  },
  recommendationCard: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recommendationEdge: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 999,
  },
  recommendationTitle: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
  },
  recommendationMeta: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  recommendationBody: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  recommendationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  recommendationTag: {
    minHeight: 22,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendationActionRow: {
    flexDirection: "row",
    gap: 8,
  },
  recommendationActionBtn: {
    flex: 1,
  },
  kindRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  goalCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  compactGoalCard: {
    gap: 8,
  },
  goalCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  goalCardTitle: {
    fontSize: 16,
    fontWeight: "900",
  },
  goalModeRow: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    flexDirection: "row",
    gap: 4,
  },
  compactGoalModeRow: {
    minHeight: 32,
  },
  goalModePill: {
    minWidth: 78,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  goalDisplay: {
    minHeight: 74,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  compactGoalDisplay: {
    minHeight: 62,
  },
  goalDisplayInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 34,
    fontWeight: "900",
    textAlign: "center",
  },
  compactGoalDisplayInput: {
    fontSize: 28,
  },
  goalDisplayUnit: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  goalPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  goalPresetChip: {
    minHeight: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
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
  compactKindPill: {
    minHeight: 34,
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
  compactInput: {
    minHeight: 42,
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
  compactPill: {
    minHeight: 42,
  },
  stepList: {
    gap: 10,
  },
  stepSummaryList: {
    gap: 8,
  },
  stepSummaryRow: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  compactStepSummaryRow: {
    minHeight: 52,
  },
  stepSummaryBadge: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stepSummaryBadgeText: {
    fontSize: 12,
    fontWeight: "900",
  },
  stepSummaryTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  stepSummaryMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
  },
  simplePlanCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  simplePlanTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  simplePlanText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  advancedActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  advancedLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  stepCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 8,
  },
  stepCardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepHeadActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepActionBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
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
  stepDurationBlock: {
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
  stepExtrasWrap: {
    gap: 8,
  },
  stepExtrasToggle: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepExtrasToggleText: {
    fontSize: 12,
    fontWeight: "700",
  },
  stepNotesInput: {
    minHeight: 80,
  },
  compactNotesInput: {
    minHeight: 62,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  fullWidthButton: {
    width: "100%",
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
