import express from "express";

const router = express.Router();

/* ============================================================================
   CONSTANTS
============================================================================ */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DAY_MAP = {
  monday: "Mon",
  mon: "Mon",
  tuesday: "Tue",
  tue: "Tue",
  tues: "Tue",
  wednesday: "Wed",
  wed: "Wed",
  thursday: "Thu",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  friday: "Fri",
  fri: "Fri",
  saturday: "Sat",
  sat: "Sat",
  sunday: "Sun",
  sun: "Sun",
};

const DEFAULT_DAYS_BY_FREQ = {
  2: ["Tue", "Fri"],
  3: ["Mon", "Wed", "Fri"],
  4: ["Mon", "Tue", "Thu", "Sat"],
  5: ["Mon", "Tue", "Wed", "Fri", "Sat"],
  6: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

const SPLIT_TEMPLATES = {
  "Full body": [
    {
      title: "Full Body A",
      emphasis: "Squat + Push",
      main: ["Squat", "Horizontal Push"],
      accessory: ["Horizontal Pull", "Single-Leg", "Core"],
      lowerStress: "high",
    },
    {
      title: "Full Body B",
      emphasis: "Hinge + Pull",
      main: ["Hinge", "Vertical Pull"],
      accessory: ["Vertical Push", "Posterior Chain", "Core"],
      lowerStress: "high",
    },
    {
      title: "Full Body C",
      emphasis: "Bench + Lower Accessory",
      main: ["Bench", "Squat Pattern"],
      accessory: ["Upper Pull", "Shoulders", "Arms"],
      lowerStress: "moderate",
    },
  ],
  "Upper / lower": [
    {
      title: "Upper Strength",
      emphasis: "Heavy press + pull",
      main: ["Horizontal Push", "Upper Pull"],
      accessory: ["Vertical Push", "Horizontal Pull", "Arms"],
      lowerStress: "low",
    },
    {
      title: "Lower Strength",
      emphasis: "Heavy lower",
      main: ["Squat", "Hinge"],
      accessory: ["Single-Leg", "Posterior Chain", "Core"],
      lowerStress: "high",
    },
    {
      title: "Upper Volume",
      emphasis: "Upper hypertrophy",
      main: ["Upper Pull", "Upper Push"],
      accessory: ["Shoulders", "Arms", "Core"],
      lowerStress: "low",
    },
    {
      title: "Lower Volume",
      emphasis: "Lower hypertrophy",
      main: ["Hinge", "Squat Pattern"],
      accessory: ["Single-Leg", "Posterior Chain", "Core"],
      lowerStress: "moderate",
    },
  ],
  "Push / pull / legs": [
    {
      title: "Push",
      emphasis: "Pressing",
      main: ["Upper Push", "Horizontal Push"],
      accessory: ["Shoulders", "Chest", "Arms"],
      lowerStress: "low",
    },
    {
      title: "Pull",
      emphasis: "Back + biceps",
      main: ["Upper Pull", "Vertical Pull"],
      accessory: ["Horizontal Pull", "Posterior Chain", "Arms"],
      lowerStress: "moderate",
    },
    {
      title: "Legs",
      emphasis: "Lower body",
      main: ["Squat", "Hinge"],
      accessory: ["Single-Leg", "Squat Pattern", "Core"],
      lowerStress: "high",
    },
  ],
  "Push / pull / legs (2x)": [
    {
      title: "Push 1",
      emphasis: "Heavy push",
      main: ["Horizontal Push", "Upper Push"],
      accessory: ["Shoulders", "Chest", "Arms"],
      lowerStress: "low",
    },
    {
      title: "Pull 1",
      emphasis: "Heavy pull",
      main: ["Upper Pull", "Vertical Pull"],
      accessory: ["Horizontal Pull", "Posterior Chain", "Arms"],
      lowerStress: "moderate",
    },
    {
      title: "Legs 1",
      emphasis: "Heavy legs",
      main: ["Squat", "Hinge"],
      accessory: ["Single-Leg", "Posterior Chain", "Core"],
      lowerStress: "high",
    },
    {
      title: "Push 2",
      emphasis: "Volume push",
      main: ["Bench", "Upper Push"],
      accessory: ["Chest", "Shoulders", "Arms"],
      lowerStress: "low",
    },
    {
      title: "Pull 2",
      emphasis: "Volume pull",
      main: ["Vertical Pull", "Upper Pull"],
      accessory: ["Horizontal Pull", "Posterior Chain", "Arms"],
      lowerStress: "moderate",
    },
    {
      title: "Legs 2",
      emphasis: "Volume legs",
      main: ["Hinge", "Squat Pattern"],
      accessory: ["Single-Leg", "Posterior Chain", "Core"],
      lowerStress: "moderate",
    },
  ],
  "Body part split": [
    {
      title: "Chest + Triceps",
      emphasis: "Chest",
      main: ["Chest", "Upper Push"],
      accessory: ["Shoulders", "Arms", "Core"],
      lowerStress: "low",
    },
    {
      title: "Back + Biceps",
      emphasis: "Back",
      main: ["Back", "Vertical Pull"],
      accessory: ["Horizontal Pull", "Posterior Chain", "Arms"],
      lowerStress: "moderate",
    },
    {
      title: "Legs",
      emphasis: "Leg development",
      main: ["Legs", "Hinge"],
      accessory: ["Squat Pattern", "Single-Leg", "Core"],
      lowerStress: "high",
    },
    {
      title: "Shoulders + Core",
      emphasis: "Shoulders",
      main: ["Shoulders", "Upper Push"],
      accessory: ["Upper Pull", "Arms", "Core"],
      lowerStress: "low",
    },
    {
      title: "Full Body Pump",
      emphasis: "Low fatigue full body",
      main: ["Full Body", "Upper Pull"],
      accessory: ["Posterior Chain", "Single-Leg", "Core"],
      lowerStress: "moderate",
    },
  ],
};

const EXERCISE_LIBRARY = {
  Squat: [
    {
      title: "Back Squat",
      equipment: ["barbell", "rack"],
      skill: "intermediate",
      jointStress: ["knee", "back"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["squat", "priority-squat", "barbell"],
    },
    {
      title: "Front Squat",
      equipment: ["barbell", "rack"],
      skill: "intermediate",
      jointStress: ["wrist", "back"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["squat", "priority-squat", "barbell"],
    },
    {
      title: "Hack Squat",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: ["knee"],
      stimulus: ["hypertrophy"],
      tags: ["quad", "machine"],
    },
    {
      title: "Goblet Squat",
      equipment: ["dumbbell", "kettlebell"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["general", "hypertrophy"],
      tags: ["squat", "dumbbell"],
    },
  ],
  Hinge: [
    {
      title: "Deadlift",
      equipment: ["barbell"],
      skill: "intermediate",
      jointStress: ["back"],
      stimulus: ["strength"],
      tags: ["deadlift", "priority-deadlift", "barbell"],
    },
    {
      title: "Trap Bar Deadlift",
      equipment: ["trap bar"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["strength", "power"],
      tags: ["deadlift", "priority-deadlift"],
    },
    {
      title: "Romanian Deadlift",
      equipment: ["barbell", "dumbbell"],
      skill: "beginner",
      jointStress: ["hamstring"],
      stimulus: ["hypertrophy", "strength"],
      tags: ["hinge", "hamstring"],
    },
  ],
  Bench: [
    {
      title: "Barbell Bench Press",
      equipment: ["barbell", "bench"],
      skill: "beginner",
      jointStress: ["shoulder"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["bench", "priority-bench", "barbell"],
    },
    {
      title: "Dumbbell Bench Press",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["bench", "priority-bench", "dumbbell"],
    },
    {
      title: "Incline Bench Press",
      equipment: ["barbell", "bench"],
      skill: "intermediate",
      jointStress: ["shoulder"],
      stimulus: ["hypertrophy", "strength"],
      tags: ["bench", "barbell"],
    },
  ],
  "Upper Push": [
    {
      title: "Overhead Press",
      equipment: ["barbell"],
      skill: "intermediate",
      jointStress: ["shoulder", "back"],
      stimulus: ["strength"],
      tags: ["overhead", "barbell"],
    },
    {
      title: "Dumbbell Shoulder Press",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: ["shoulder"],
      stimulus: ["hypertrophy"],
      tags: ["overhead", "dumbbell"],
    },
    {
      title: "Machine Shoulder Press",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["machine"],
    },
  ],
  "Upper Pull": [
    {
      title: "Barbell Row",
      equipment: ["barbell"],
      skill: "intermediate",
      jointStress: ["back"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["row", "barbell"],
    },
    {
      title: "Chest-Supported Row",
      equipment: ["machine", "bench", "dumbbell"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["row", "supported", "machine"],
    },
    {
      title: "Weighted Pull-Up",
      equipment: ["pull-up bar"],
      skill: "advanced",
      jointStress: ["elbow", "shoulder"],
      stimulus: ["strength"],
      tags: ["pull-up", "priority-pull-up"],
    },
  ],
  "Horizontal Push": [
    {
      title: "Bench Press",
      equipment: ["barbell", "bench"],
      skill: "beginner",
      jointStress: ["shoulder"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["bench", "priority-bench", "barbell"],
    },
    {
      title: "Incline Dumbbell Press",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["press", "dumbbell"],
    },
    {
      title: "Machine Chest Press",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["machine"],
    },
  ],
  "Horizontal Pull": [
    {
      title: "Seated Cable Row",
      equipment: ["cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["row", "cable"],
    },
    {
      title: "Machine Row",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["row", "machine"],
    },
    {
      title: "Single-Arm Dumbbell Row",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["row", "dumbbell"],
    },
  ],
  "Vertical Push": [
    {
      title: "Push Press",
      equipment: ["barbell"],
      skill: "advanced",
      jointStress: ["shoulder"],
      stimulus: ["power", "strength"],
      tags: ["overhead", "barbell", "power"],
    },
    {
      title: "Overhead Press",
      equipment: ["barbell"],
      skill: "intermediate",
      jointStress: ["shoulder"],
      stimulus: ["strength"],
      tags: ["overhead", "barbell"],
    },
    {
      title: "Arnold Press",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["overhead", "dumbbell"],
    },
  ],
  "Vertical Pull": [
    {
      title: "Pull-Up",
      equipment: ["pull-up bar"],
      skill: "intermediate",
      jointStress: ["elbow", "shoulder"],
      stimulus: ["strength"],
      tags: ["pull-up", "priority-pull-up"],
    },
    {
      title: "Lat Pulldown",
      equipment: ["machine", "cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["vertical-pull", "machine"],
    },
    {
      title: "Single-Arm Cable Pulldown",
      equipment: ["cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["vertical-pull", "cable"],
    },
  ],
  "Single-Leg": [
    {
      title: "Bulgarian Split Squat",
      equipment: ["dumbbell", "bench"],
      skill: "intermediate",
      jointStress: ["knee"],
      stimulus: ["hypertrophy"],
      tags: ["single-leg", "quad"],
    },
    {
      title: "Walking Lunge",
      equipment: ["dumbbell"],
      skill: "beginner",
      jointStress: ["knee"],
      stimulus: ["hypertrophy"],
      tags: ["single-leg"],
    },
    {
      title: "Step-Up",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["general", "hypertrophy"],
      tags: ["single-leg"],
    },
  ],
  "Posterior Chain": [
    {
      title: "Hip Thrust",
      equipment: ["barbell", "bench", "machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["glutes", "posterior-chain"],
    },
    {
      title: "Back Extension",
      equipment: ["machine", "bench"],
      skill: "beginner",
      jointStress: ["back"],
      stimulus: ["hypertrophy"],
      tags: ["posterior-chain", "supported"],
    },
    {
      title: "Romanian Deadlift",
      equipment: ["barbell", "dumbbell"],
      skill: "beginner",
      jointStress: ["hamstring"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["hinge", "hamstring"],
    },
  ],
  "Squat Pattern": [
    {
      title: "Leg Press",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["quad", "machine"],
    },
    {
      title: "Hack Squat",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: ["knee"],
      stimulus: ["hypertrophy"],
      tags: ["quad", "machine"],
    },
    {
      title: "Goblet Squat",
      equipment: ["dumbbell", "kettlebell"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["general", "hypertrophy"],
      tags: ["squat", "dumbbell"],
    },
  ],
  Shoulders: [
    {
      title: "Lateral Raise",
      equipment: ["dumbbell", "cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["shoulders", "dumbbell"],
    },
    {
      title: "Rear Delt Fly",
      equipment: ["dumbbell", "machine", "cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["shoulders"],
    },
    {
      title: "Face Pull",
      equipment: ["cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["shoulders", "cable"],
    },
  ],
  Arms: [
    {
      title: "Cable Triceps Pressdown",
      equipment: ["cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["arms", "cable"],
    },
    {
      title: "Hammer Curl",
      equipment: ["dumbbell"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["arms", "dumbbell"],
    },
    {
      title: "EZ-Bar Curl",
      equipment: ["barbell"],
      skill: "beginner",
      jointStress: ["elbow"],
      stimulus: ["hypertrophy"],
      tags: ["arms", "barbell"],
    },
  ],
  Core: [
    {
      title: "Pallof Press",
      equipment: ["cable", "band", "bands"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["general"],
      tags: ["core", "anti-rotation"],
    },
    {
      title: "Plank Variation",
      equipment: [],
      skill: "beginner",
      jointStress: [],
      stimulus: ["general"],
      tags: ["core"],
    },
    {
      title: "Hanging Knee Raise",
      equipment: ["pull-up bar"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["general"],
      tags: ["core"],
    },
  ],
  Chest: [
    {
      title: "Machine Chest Press",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["chest", "machine"],
    },
    {
      title: "Incline Dumbbell Press",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["chest", "dumbbell"],
    },
    {
      title: "Bench Press",
      equipment: ["barbell", "bench"],
      skill: "beginner",
      jointStress: ["shoulder"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["bench", "priority-bench", "barbell"],
    },
  ],
  Back: [
    {
      title: "Lat Pulldown",
      equipment: ["machine", "cable"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["back", "machine"],
    },
    {
      title: "Chest-Supported Row",
      equipment: ["machine", "bench", "dumbbell"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["back", "supported"],
    },
    {
      title: "Single-Arm Dumbbell Row",
      equipment: ["dumbbell", "bench"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["back", "dumbbell"],
    },
  ],
  Legs: [
    {
      title: "Back Squat",
      equipment: ["barbell", "rack"],
      skill: "intermediate",
      jointStress: ["knee", "back"],
      stimulus: ["strength", "hypertrophy"],
      tags: ["legs", "priority-squat", "barbell"],
    },
    {
      title: "Leg Press",
      equipment: ["machine"],
      skill: "beginner",
      jointStress: [],
      stimulus: ["hypertrophy"],
      tags: ["legs", "machine"],
    },
    {
      title: "Romanian Deadlift",
      equipment: ["barbell", "dumbbell"],
      skill: "beginner",
      jointStress: ["hamstring"],
      stimulus: ["hypertrophy", "strength"],
      tags: ["legs", "hinge"],
    },
  ],
  "Full Body": [
    {
      title: "Dumbbell Clean + Press",
      equipment: ["dumbbell"],
      skill: "intermediate",
      jointStress: [],
      stimulus: ["general", "power"],
      tags: ["full-body", "dumbbell"],
    },
    {
      title: "Thruster",
      equipment: ["barbell", "dumbbell"],
      skill: "intermediate",
      jointStress: ["shoulder", "knee"],
      stimulus: ["general"],
      tags: ["full-body", "barbell"],
    },
    {
      title: "Kettlebell Complex",
      equipment: ["kettlebell"],
      skill: "intermediate",
      jointStress: [],
      stimulus: ["general", "conditioning"],
      tags: ["full-body", "conditioning"],
    },
  ],
};

const EXPERIENCE_RANK = {
  beginner: 1,
  novice: 1,
  intermediate: 2,
  advanced: 3,
};

const DEFAULT_EQUIPMENT = [
  "barbell",
  "rack",
  "bench",
  "dumbbell",
  "machine",
  "cable",
  "pull-up bar",
];

/* ============================================================================
   UTILITIES
============================================================================ */

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();

  for (const value of asArray(list)) {
    const s = String(value || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }

  return out;
}

function normalizeTokens(list) {
  return uniqStrings(list).map((x) => String(x).trim().toLowerCase());
}

function normalizeDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  return DAY_MAP[raw] || null;
}

function parseSessionLengthMinutes(sessionLength) {
  const raw = String(sessionLength || "").trim();
  if (!raw) return 60;

  const plus = raw.match(/^(\d+)\s*\+\s*(?:min|mins|minutes)?$/i);
  if (plus) return clamp(Number(plus[1]), 30, 150);

  const range = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return clamp(Math.round((lo + hi) / 2), 30, 150);
    }
  }

  const single = toNumber(raw, null);
  if (single != null) return clamp(Math.round(single), 30, 150);

  return 60;
}

function chooseTrainingDays(daysPerWeek, preferredDays) {
  const target = clamp(Math.round(toNumber(daysPerWeek, 4) || 4), 2, 7);

  const normalizedPreferred = uniqStrings(preferredDays)
    .map(normalizeDay)
    .filter(Boolean);

  const picked = [];
  for (const d of normalizedPreferred) {
    if (!picked.includes(d)) picked.push(d);
    if (picked.length >= target) break;
  }

  const fallback = DEFAULT_DAYS_BY_FREQ[target] || DEFAULT_DAYS_BY_FREQ[4];
  for (const d of fallback) {
    if (!picked.includes(d)) picked.push(d);
    if (picked.length >= target) break;
  }

  return picked.slice(0, target);
}

function splitTemplatesFor(preferredSplit) {
  const key = String(preferredSplit || "").trim();
  if (SPLIT_TEMPLATES[key]) return SPLIT_TEMPLATES[key];
  return SPLIT_TEMPLATES["Upper / lower"];
}

function safeLower(v) {
  return String(v || "").trim().toLowerCase();
}

function adjacentDays(day) {
  const idx = DAYS.indexOf(day);
  if (idx < 0) return [];
  const prev = DAYS[(idx + 6) % 7];
  const next = DAYS[(idx + 1) % 7];
  return [prev, next];
}

function parseRecoveryLabel(value) {
  const raw = safeLower(value);
  if (raw.includes("low")) return "low";
  if (raw.includes("high")) return "high";
  return "moderate";
}

function parseSleepLabel(value) {
  const raw = safeLower(value);
  if (raw.includes("poor")) return "poor";
  if (raw.includes("good")) return "good";
  return "average";
}

function parseStressLabel(value) {
  const raw = safeLower(value);
  if (raw.includes("high")) return "high";
  if (raw.includes("low")) return "low";
  return "moderate";
}

function parseExerciseStyle(value) {
  const raw = safeLower(value);
  if (raw.includes("barbell")) return "barbell";
  if (raw.includes("machine")) return "machine";
  if (raw.includes("dumbbell")) return "dumbbell";
  return "mixed";
}

function parsePriorityTags(priorityLifts) {
  const tags = new Set();

  for (const lift of uniqStrings(priorityLifts)) {
    const raw = safeLower(lift);
    if (raw.includes("squat")) tags.add("priority-squat");
    if (raw.includes("bench")) tags.add("priority-bench");
    if (raw.includes("dead")) tags.add("priority-deadlift");
    if (raw.includes("pull-up") || raw.includes("pull up")) tags.add("priority-pull-up");
    if (raw.includes("overhead")) tags.add("overhead");
  }

  return Array.from(tags);
}

function parseAvoidTerms(profile) {
  const combined = [
    profile.liftsToAvoid,
    profile.constraints,
    profile.notesForCoach,
    profile.injuries,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  return {
    noOverheadBarbell:
      profile.overheadBarbellAllowed === false ||
      /avoid overhead barbell|no overhead barbell|no barbell overhead/.test(combined),
    avoidBarbell: /avoid barbell/.test(combined),
    avoidMachines: /avoid machines|no machines/.test(combined),
    avoidDips: /\bdips?\b/.test(combined),
    avoidHighBarSquat: /high-bar squat|high bar squat/.test(combined),
    avoidConventionalDeadlift: /conventional deadlift|avoid deadlift/.test(combined),
    explicitText: combined,
  };
}

function inferSessionFatigue(profile, day) {
  let penalty = 0;

  const runCount = toNumber(profile.runningSessionsPerWeek, 0) || 0;
  const hyroxCount = toNumber(profile.hyroxSessionsPerWeek, 0) || 0;
  const sportCount = toNumber(profile.sportSessionsPerWeek, 0) || 0;

  penalty += runCount * 0.02;
  penalty += hyroxCount * 0.04;
  penalty += sportCount * 0.03;

  const hardDay = normalizeDay(profile.hardestConditioningDay);
  if (hardDay) {
    if (day === hardDay) penalty += 0.18;
    if (adjacentDays(hardDay).includes(day)) penalty += 0.08;
  }

  const restDay = normalizeDay(profile.preferredRestDay);
  if (restDay && day === restDay) penalty += 0.12;

  const recovery = parseRecoveryLabel(profile.recoveryCapacity);
  const sleep = parseSleepLabel(profile.sleepQuality);
  const stress = parseStressLabel(profile.stressLevel);

  if (recovery === "low") penalty += 0.1;
  if (recovery === "high") penalty -= 0.05;

  if (sleep === "poor") penalty += 0.08;
  if (sleep === "good") penalty -= 0.03;

  if (stress === "high") penalty += 0.08;
  if (stress === "low") penalty -= 0.03;

  return clamp(penalty, -0.08, 0.35);
}

function isLowerDominantTemplate(template) {
  const patterns = [...asArray(template.main), ...asArray(template.accessory)].map(safeLower);
  return patterns.some((p) =>
    p.includes("squat") ||
    p.includes("hinge") ||
    p.includes("legs") ||
    p.includes("single-leg") ||
    p.includes("posterior")
  );
}

function reorderTemplatesForSchedule(templates, trainingDays, profile) {
  const hardDay = normalizeDay(profile.hardestConditioningDay);
  if (!hardDay || !trainingDays.length) return templates;

  const reordered = [...templates];
  const riskyDays = new Set([hardDay, ...adjacentDays(hardDay)]);

  const lowerHeavy = reordered.filter((t) => isLowerDominantTemplate(t));
  const others = reordered.filter((t) => !isLowerDominantTemplate(t));

  if (!lowerHeavy.length || !others.length) return reordered;

  const planned = [];
  let lowerIdx = 0;
  let otherIdx = 0;

  for (const day of trainingDays) {
    const risky = riskyDays.has(day);

    if (risky && otherIdx < others.length) {
      planned.push(others[otherIdx++]);
    } else if (!risky && lowerIdx < lowerHeavy.length) {
      planned.push(lowerHeavy[lowerIdx++]);
    } else if (otherIdx < others.length) {
      planned.push(others[otherIdx++]);
    } else if (lowerIdx < lowerHeavy.length) {
      planned.push(lowerHeavy[lowerIdx++]);
    }
  }

  return planned.length ? planned : reordered;
}

/* ============================================================================
   PROFILE NORMALISATION
============================================================================ */

function normalizeStrengthProfile(body) {
  const src = isPlainObject(body?.athleteProfile) ? body.athleteProfile : body;

  return {
    goalType: String(src?.goalType || "General training").trim(),
    primaryFocus: String(src?.primaryFocus || "General strength").trim(),
    secondaryFocus: uniqStrings(src?.secondaryFocus),
    planLengthWeeks: clamp(Math.round(toNumber(src?.planLengthWeeks, 12) || 12), 4, 24),
    experienceLevel: String(src?.experienceLevel || "Intermediate").trim(),
    trainingAgeYears: toNumber(src?.trainingAgeYears, null),

    currentSquat: toNumber(src?.currentSquat, null),
    currentBench: toNumber(src?.currentBench, null),
    currentDeadlift: toNumber(src?.currentDeadlift, null),
    bodyweightKg: toNumber(src?.bodyweightKg, null),

    daysPerWeek: clamp(Math.round(toNumber(src?.daysPerWeek, 4) || 4), 2, 7),
    preferredDays: uniqStrings(src?.preferredDays || src?.daysAvailable || src?.runDays),
    preferredRestDay: String(src?.preferredRestDay || "").trim(),
    preferredSplit: String(src?.preferredSplit || "Upper / lower").trim(),
    sessionLength: String(src?.sessionLength || "60-75 min").trim(),

    equipment: uniqStrings(src?.equipment),
    weakAreas: uniqStrings(src?.weakAreas),
    injuries: String(src?.injuries || "").trim(),
    constraints: String(src?.constraints || "").trim(),
    otherSessions: String(src?.otherSessions || "").trim(),
    notesForCoach: String(src?.notesForCoach || "").trim(),

    recoveryCapacity: String(src?.recoveryCapacity || "Moderate").trim(),
    sleepQuality: String(src?.sleepQuality || "Average").trim(),
    stressLevel: String(src?.stressLevel || "Moderate").trim(),

    runningSessionsPerWeek: clamp(Math.round(toNumber(src?.runningSessionsPerWeek, 0) || 0), 0, 14),
    hyroxSessionsPerWeek: clamp(Math.round(toNumber(src?.hyroxSessionsPerWeek, 0) || 0), 0, 14),
    sportSessionsPerWeek: clamp(Math.round(toNumber(src?.sportSessionsPerWeek, 0) || 0), 0, 14),
    hardestConditioningDay: String(src?.hardestConditioningDay || "").trim(),

    progressionStyle: String(src?.progressionStyle || "No preference").trim(),
    priorityLifts: uniqStrings(src?.priorityLifts),
    liftsToAvoid: String(src?.liftsToAvoid || "").trim(),
    preferredExerciseStyle: String(src?.preferredExerciseStyle || "Mixed / balanced").trim(),
    overheadBarbellAllowed:
      typeof src?.overheadBarbellAllowed === "boolean" ? src.overheadBarbellAllowed : true,
    fixedMainLifts:
      typeof src?.fixedMainLifts === "boolean" ? src.fixedMainLifts : true,
  };
}

function validateStrengthProfile(profile) {
  const errors = [];

  if (!profile.goalType) errors.push("Missing goalType.");
  if (!profile.primaryFocus) errors.push("Missing primaryFocus.");
  if (!profile.experienceLevel) errors.push("Missing experienceLevel.");

  if (!Number.isInteger(profile.planLengthWeeks) || profile.planLengthWeeks < 4 || profile.planLengthWeeks > 24) {
    errors.push("planLengthWeeks must be an integer between 4 and 24.");
  }

  if (!Number.isInteger(profile.daysPerWeek) || profile.daysPerWeek < 2 || profile.daysPerWeek > 7) {
    errors.push("daysPerWeek must be an integer between 2 and 7.");
  }

  return errors;
}

/* ============================================================================
   COACHING LOGIC
============================================================================ */

function inferGoalMode(goalType, primaryFocus) {
  const merged = `${goalType} ${primaryFocus}`.toLowerCase();

  if (merged.includes("strength")) return "strength";
  if (merged.includes("power")) return "powerbuilding";
  if (
    merged.includes("hypertrophy") ||
    merged.includes("muscle") ||
    merged.includes("size") ||
    merged.includes("recomp") ||
    merged.includes("recomposition")
  ) {
    return "hypertrophy";
  }
  return "general";
}

function normalizeExperience(experienceLevel) {
  const raw = safeLower(experienceLevel);
  if (raw.includes("beginner") || raw.includes("novice")) return "beginner";
  if (raw.includes("advanced")) return "advanced";
  return "intermediate";
}

function getWeekPhase(weekNumber, totalWeeks) {
  const isFinalWeek = weekNumber === totalWeeks;
  const isDeload = totalWeeks >= 6 && weekNumber % 4 === 0 && !isFinalWeek;

  if (isFinalWeek) {
    return {
      label: "Consolidation",
      volumeFactor: 0.9,
      intensityFactor: 0.98,
      rpeDelta: -0.5,
      progressionNote: "Hold performance, reduce fatigue, leave the block feeling good.",
    };
  }

  if (isDeload) {
    return {
      label: "Deload",
      volumeFactor: 0.68,
      intensityFactor: 0.9,
      rpeDelta: -1,
      progressionNote: "Reduce sets and effort; maintain movement quality and technical sharpness.",
    };
  }

  if (weekNumber <= Math.ceil(totalWeeks * 0.35)) {
    return {
      label: "Base",
      volumeFactor: 1,
      intensityFactor: 0.96,
      rpeDelta: 0,
      progressionNote: "Accumulate quality volume and build technical consistency.",
    };
  }

  if (weekNumber <= Math.ceil(totalWeeks * 0.75)) {
    return {
      label: "Build",
      volumeFactor: 1.04,
      intensityFactor: 1,
      rpeDelta: 0.3,
      progressionNote: "Push load or reps gradually while keeping execution consistent.",
    };
  }

  return {
    label: "Peak Build",
    volumeFactor: 0.96,
    intensityFactor: 1.03,
    rpeDelta: 0.4,
    progressionNote: "Bias heavier quality work, keep accessories targeted and efficient.",
  };
}

function getMainLiftPrescription(goalMode, phase, sessionRole, profile, fatiguePenalty = 0) {
  const deload = phase.label === "Deload";
  const progressionStyle = safeLower(profile.progressionStyle);

  let prescription;

  if (goalMode === "strength") {
    if (sessionRole === "primary") {
      prescription = deload
        ? { sets: 3, reps: 4, restSec: 150, targetRpe: 6.5 }
        : { sets: 5, reps: 4, restSec: 180, targetRpe: 8 };
    } else {
      prescription = deload
        ? { sets: 2, reps: 6, restSec: 105, targetRpe: 6.5 }
        : { sets: 3, reps: 6, restSec: 120, targetRpe: 7.5 };
    }
  } else if (goalMode === "hypertrophy") {
    if (sessionRole === "primary") {
      prescription = deload
        ? { sets: 3, reps: 8, restSec: 105, targetRpe: 6.5 }
        : { sets: 4, reps: 8, restSec: 120, targetRpe: 8 };
    } else {
      prescription = deload
        ? { sets: 2, reps: 10, restSec: 60, targetRpe: 6.5 }
        : { sets: 3, reps: 10, restSec: 75, targetRpe: 8 };
    }
  } else if (goalMode === "powerbuilding") {
    if (sessionRole === "primary") {
      prescription = deload
        ? { sets: 3, reps: 5, restSec: 135, targetRpe: 6.5 }
        : { sets: 4, reps: 5, restSec: 165, targetRpe: 8 };
    } else {
      prescription = deload
        ? { sets: 2, reps: 8, restSec: 75, targetRpe: 6.5 }
        : { sets: 3, reps: 8, restSec: 90, targetRpe: 7.5 };
    }
  } else {
    if (sessionRole === "primary") {
      prescription = deload
        ? { sets: 3, reps: 6, restSec: 120, targetRpe: 6.5 }
        : { sets: 4, reps: 6, restSec: 150, targetRpe: 7.5 };
    } else {
      prescription = deload
        ? { sets: 2, reps: 10, restSec: 60, targetRpe: 6.5 }
        : { sets: 3, reps: 10, restSec: 75, targetRpe: 7.5 };
    }
  }

  if (!deload && fatiguePenalty >= 0.14) {
    prescription.sets = Math.max(2, prescription.sets - 1);
    prescription.targetRpe = Math.max(6.5, prescription.targetRpe - 0.5);
  }

  let progression =
    "Progress conservatively while keeping technique stable.";

  if (progressionStyle.includes("rpe")) {
    progression = "Increase load only when all sets land at or below target RPE with clean execution.";
  } else if (progressionStyle.includes("%")) {
    progression = "Use percentage-based load progressions week to week where possible.";
  } else if (progressionStyle.includes("auto")) {
    progression = "Auto-regulate with readiness and keep 1-3 reps in reserve on most work.";
  } else if (progressionStyle.includes("simple")) {
    progression = "Add small load increments once all sets and reps are completed cleanly.";
  }

  return { ...prescription, progression };
}

function getAccessoryPrescription(goalMode, phase, weakAreaBias = false, fatiguePenalty = 0) {
  const deload = phase.label === "Deload";

  let sets = 3;
  let reps = 10;
  let restSec = 75;
  let targetRpe = 7.5;

  if (goalMode === "strength") {
    sets = 3;
    reps = 8;
    restSec = 90;
    targetRpe = 7.5;
  } else if (goalMode === "hypertrophy") {
    sets = 3;
    reps = 10;
    restSec = 60;
    targetRpe = 8;
  } else if (goalMode === "powerbuilding") {
    sets = 3;
    reps = 8;
    restSec = 75;
    targetRpe = 7.5;
  }

  if (weakAreaBias && !deload) {
    sets += 1;
  }

  if (deload) {
    sets = Math.max(2, sets - 1);
    targetRpe = 6.5;
  }

  if (!deload && fatiguePenalty >= 0.14) {
    sets = Math.max(2, sets - 1);
    targetRpe = Math.max(6.5, targetRpe - 0.5);
  }

  return {
    sets,
    reps,
    restSec,
    targetRpe,
    progression: weakAreaBias
      ? "Prioritise control and full ROM; add reps before load."
      : "Progress gradually with quality execution.",
  };
}

function inferAvailableEquipment(profile) {
  const equipment = normalizeTokens(profile.equipment);
  return equipment.length ? equipment : DEFAULT_EQUIPMENT;
}

function inferRestrictions(profile) {
  const text = `${profile.injuries} ${profile.constraints} ${profile.notesForCoach}`.toLowerCase();

  return {
    shoulderSensitive: /shoulder|rotator|imping/i.test(text),
    backSensitive: /back|spine|disc|lumbar/i.test(text),
    kneeSensitive: /knee|patella|acl|meniscus/i.test(text),
    elbowSensitive: /elbow|tendon/i.test(text),
    wristSensitive: /wrist/i.test(text),
    hamstringSensitive: /hamstring/i.test(text),
  };
}

function weakAreaMatchesPattern(pattern, weakAreas) {
  const p = safeLower(pattern);
  const areas = normalizeTokens(weakAreas);

  return areas.some((area) => {
    if (area.includes("shoulder") && (p.includes("shoulder") || p.includes("push"))) return true;
    if (area.includes("back") && (p.includes("pull") || p.includes("back"))) return true;
    if (area.includes("chest") && (p.includes("chest") || p.includes("push"))) return true;
    if (area.includes("arm") && p.includes("arm")) return true;
    if (area.includes("glute") && (p.includes("posterior") || p.includes("hinge"))) return true;
    if (area.includes("hamstring") && (p.includes("hinge") || p.includes("posterior"))) return true;
    if (area.includes("quad") && (p.includes("squat") || p.includes("legs"))) return true;
    if (area.includes("core") && p.includes("core")) return true;
    return false;
  });
}

function scoreExerciseOption(option, context) {
  const {
    availableEquipment,
    experience,
    restrictions,
    goalMode,
    weakAreaBias,
    recentTitles,
    profile,
    pattern,
  } = context;

  let score = 0;

  const needed = normalizeTokens(option.equipment);
  const equipmentMatch =
    needed.length === 0 || needed.every((item) => availableEquipment.includes(item));
  if (!equipmentMatch) return -999;

  score += 20;

  const optionSkill = EXPERIENCE_RANK[safeLower(option.skill)] || 2;
  const athleteSkill = EXPERIENCE_RANK[safeLower(experience)] || 2;

  if (optionSkill <= athleteSkill) score += 8;
  else score -= 8;

  const stresses = normalizeTokens(option.jointStress);

  if (restrictions.shoulderSensitive && stresses.includes("shoulder")) score -= 12;
  if (restrictions.backSensitive && stresses.includes("back")) score -= 12;
  if (restrictions.kneeSensitive && stresses.includes("knee")) score -= 10;
  if (restrictions.elbowSensitive && stresses.includes("elbow")) score -= 8;
  if (restrictions.wristSensitive && stresses.includes("wrist")) score -= 8;
  if (restrictions.hamstringSensitive && stresses.includes("hamstring")) score -= 8;

  const stimulus = normalizeTokens(option.stimulus);
  if (goalMode === "strength" && stimulus.includes("strength")) score += 6;
  if (goalMode === "hypertrophy" && stimulus.includes("hypertrophy")) score += 6;
  if (goalMode === "powerbuilding" && (stimulus.includes("strength") || stimulus.includes("hypertrophy"))) {
    score += 5;
  }

  if (weakAreaBias && stimulus.includes("hypertrophy")) score += 4;

  const style = parseExerciseStyle(profile.preferredExerciseStyle);
  const tags = normalizeTokens(option.tags);

  if (style === "barbell" && tags.includes("barbell")) score += 5;
  if (style === "machine" && tags.includes("machine")) score += 5;
  if (style === "dumbbell" && tags.includes("dumbbell")) score += 5;

  const priorityTags = parsePriorityTags(profile.priorityLifts);
  if (priorityTags.some((tag) => tags.includes(tag))) score += 9;

  const avoid = parseAvoidTerms(profile);

  if (avoid.noOverheadBarbell && tags.includes("overhead") && tags.includes("barbell")) score -= 40;
  if (avoid.avoidBarbell && tags.includes("barbell")) score -= 25;
  if (avoid.avoidMachines && tags.includes("machine")) score -= 25;
  if (avoid.avoidDips && safeLower(option.title).includes("dip")) score -= 50;
  if (avoid.avoidHighBarSquat && safeLower(option.title).includes("high-bar")) score -= 40;
  if (avoid.avoidConventionalDeadlift && safeLower(option.title) === "deadlift") score -= 35;

  if (recentTitles.has(safeLower(option.title))) score -= profile.fixedMainLifts ? 1 : 3;

  if (pattern === "Upper Push" || pattern === "Vertical Push") {
    if (profile.overheadBarbellAllowed === false && tags.includes("overhead") && tags.includes("barbell")) {
      score -= 50;
    }
  }

  return score;
}

function pickBestExercise(pattern, context) {
  const options = EXERCISE_LIBRARY[pattern] || [];
  if (!options.length) {
    return {
      title: `Standard ${pattern}`,
      pattern,
      selectedReason: "Fallback exercise",
      substitutions: [],
    };
  }

  const scored = options
    .map((opt) => ({ ...opt, score: scoreExerciseOption(opt, { ...context, pattern }) }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const backups = scored.slice(1, 3).map((x) => x.title);

  return {
    title: winner?.title || options[0].title,
    pattern,
    selectedReason:
      (winner?.score || 0) >= 20
        ? "Selected for fit with equipment, experience, schedule, and current goal."
        : "Selected as the best available option.",
    substitutions: backups,
  };
}

function inferLoadHint(exerciseTitle, pattern, profile, goalMode, isPrimary, phase) {
  const lowerTitle = `${exerciseTitle} ${pattern}`.toLowerCase();
  const squat = toNumber(profile.currentSquat, null);
  const bench = toNumber(profile.currentBench, null);
  const deadlift = toNumber(profile.currentDeadlift, null);

  const usePct = (oneRm, low, high) => {
    if (oneRm == null || oneRm <= 0) return null;
    return `${Math.round(oneRm * low)}-${Math.round(oneRm * high)} kg`;
  };

  const progressionStyle = safeLower(profile.progressionStyle);
  const percentBias = progressionStyle.includes("%");

  if (lowerTitle.includes("squat") || lowerTitle.includes("leg press") || lowerTitle.includes("hack")) {
    const range = usePct(
      squat,
      goalMode === "strength" ? 0.74 * phase.intensityFactor : 0.62 * phase.intensityFactor,
      goalMode === "strength" ? 0.84 * phase.intensityFactor : 0.74 * phase.intensityFactor
    );
    if (range) return percentBias ? `~${range} (${Math.round(phase.intensityFactor * 100)}% phase bias)` : range;
  }

  if (lowerTitle.includes("bench") || lowerTitle.includes("press") || lowerTitle.includes("chest")) {
    const range = usePct(
      bench,
      goalMode === "strength" ? 0.74 * phase.intensityFactor : 0.62 * phase.intensityFactor,
      goalMode === "strength" ? 0.84 * phase.intensityFactor : 0.74 * phase.intensityFactor
    );
    if (range) return percentBias ? `~${range} (${Math.round(phase.intensityFactor * 100)}% phase bias)` : range;
  }

  if (lowerTitle.includes("deadlift") || lowerTitle.includes("hinge") || lowerTitle.includes("rdl")) {
    const range = usePct(
      deadlift,
      goalMode === "strength" ? 0.72 * phase.intensityFactor : 0.6 * phase.intensityFactor,
      goalMode === "strength" ? 0.82 * phase.intensityFactor : 0.72 * phase.intensityFactor
    );
    if (range) return percentBias ? `~${range} (${Math.round(phase.intensityFactor * 100)}% phase bias)` : range;
  }

  if (isPrimary) return goalMode === "strength" ? "Heavy but crisp" : "Moderate-heavy";
  return "Moderate, controlled";
}

function buildWarmupBlock(sessionType, restrictions, fatiguePenalty = 0) {
  const items = [
    {
      kind: "warmup",
      title: "5-8 min easy cardio",
      timeSec: fatiguePenalty > 0.14 ? 300 : 420,
      effort: "easy",
      notes: "Raise temperature gradually.",
    },
    {
      kind: "mobility",
      title: "Dynamic mobility sequence",
      timeSec: 300,
      notes: "Target ankles, hips, thoracic spine, and shoulders as needed.",
    },
    {
      kind: "ramp",
      title: "Progressive ramp-up sets",
      timeSec: 360,
      notes: "3-5 build-up sets before first main lift.",
    },
  ];

  if (restrictions.shoulderSensitive && sessionType.toLowerCase().includes("upper")) {
    items.push({
      kind: "prep",
      title: "Scap and cuff prep",
      timeSec: 180,
      notes: "Band external rotations, face pulls, scap push-ups.",
    });
  }

  if (restrictions.kneeSensitive || restrictions.backSensitive) {
    items.push({
      kind: "prep",
      title: "Lower body activation",
      timeSec: 180,
      notes: "Glute bridge, bodyweight split squat, trunk bracing drills.",
    });
  }

  return {
    id: "warmup",
    kind: "warmup",
    title: "Warm-up",
    items,
  };
}

function buildExerciseItem({
  exercise,
  prescription,
  load,
  isPrimary,
  weakAreaBias,
}) {
  return {
    kind: "exercise",
    title: exercise.title,
    pattern: exercise.pattern,
    sets: prescription.sets,
    reps: prescription.reps,
    restSec: prescription.restSec,
    rpe: prescription.targetRpe,
    load,
    progression: prescription.progression,
    cues: isPrimary
      ? "Control the eccentric, own the position, finish with 1-2 reps in reserve."
      : weakAreaBias
        ? "Bias full range and high-quality contraction."
        : "Smooth tempo, stable positions, stop short of technical breakdown.",
    selectedReason: exercise.selectedReason,
    substitutions: exercise.substitutions,
  };
}

function estimateBlockTimeMin(items) {
  let totalSec = 0;

  for (const item of items) {
    if (item.timeSec) {
      totalSec += item.timeSec;
      continue;
    }

    const sets = Number(item.sets || 0);
    const reps = Number(item.reps || 0);
    const restSec = Number(item.restSec || 0);

    if (sets > 0) {
      const repWorkSec = Math.max(20, reps * 4);
      totalSec += sets * repWorkSec + Math.max(0, sets - 1) * restSec;
    }
  }

  return Math.max(1, Math.round(totalSec / 60));
}

function trimAccessoriesForTime(accessoryItems, sessionMinutes, fatiguePenalty = 0) {
  let maxAccessoryCount = sessionMinutes <= 45 ? 2 : sessionMinutes <= 60 ? 3 : 4;
  if (fatiguePenalty >= 0.14) maxAccessoryCount = Math.max(2, maxAccessoryCount - 1);
  return accessoryItems.slice(0, maxAccessoryCount);
}

function blocksToSegments(blocks) {
  const src = Array.isArray(blocks) ? blocks : [];
  const out = [];

  src.forEach((block) => {
    if (!block || typeof block !== "object") return;

    const blockKind = String(block.kind || block.type || "").trim();
    const blockLabel = String(block.title || blockKind || "Block").trim();
    const items = Array.isArray(block.items) ? block.items : [];

    if (!items.length) {
      out.push({
        type: blockLabel,
        kind: blockKind || "main",
      });
      return;
    }

    items.forEach((item) => {
      if (!item || typeof item !== "object") return;

      const title = String(item.title || item.name || blockLabel || "Exercise").trim();
      const timeSec = Number(item.timeSec ?? item.durationSec ?? 0);
      const sets = Number(item.sets ?? 0);
      const reps = Number(item.reps ?? 0);
      const restSec = Number(item.restSec ?? 0);
      const rpe = Number(item.rpe ?? 0);
      const load = String(item.load || "").trim();

      const seg = {
        type: title,
        kind: blockKind || "main",
        stationName: blockLabel,
      };

      if (timeSec > 0) {
        seg.durationType = "Time (min)";
        seg.durationValue = Math.max(1, Math.round((timeSec / 60) * 10) / 10);
      }
      if (sets > 0) seg.sets = sets;
      if (reps > 0) seg.reps = reps;
      if (restSec > 0) seg.restSec = Math.round(restSec);
      if (load) seg.load = load;
      if (Number.isFinite(rpe) && rpe > 0) seg.rpe = Math.round(rpe * 10) / 10;

      const notes = [
        item.cues,
        item.progression ? `Progression: ${item.progression}` : "",
        item.selectedReason || "",
      ]
        .filter(Boolean)
        .join(" · ");

      if (notes) seg.notes = notes;

      out.push(seg);
    });
  });

  return out;
}

/* ============================================================================
   SESSION BUILDING
============================================================================ */

function buildStableMainLiftMap(templates, profile, goalMode) {
  if (!profile.fixedMainLifts) return null;

  const experience = normalizeExperience(profile.experienceLevel);
  const availableEquipment = inferAvailableEquipment(profile);
  const restrictions = inferRestrictions(profile);
  const recentTitles = new Set();

  const map = {};

  for (const template of templates) {
    const mainPatterns = asArray(template.main).slice(0, 2);
    map[template.title] = {};

    for (const pattern of mainPatterns) {
      const weakAreaBias = weakAreaMatchesPattern(pattern, profile.weakAreas || []);
      const exercise = pickBestExercise(pattern, {
        availableEquipment,
        experience,
        restrictions,
        goalMode,
        weakAreaBias,
        recentTitles,
        profile,
      });
      map[template.title][pattern] = exercise;
      recentTitles.add(safeLower(exercise.title));
    }
  }

  return map;
}

function buildStrengthSession({
  weekNumber,
  day,
  dayIndex,
  sessionOrder,
  template,
  profile,
  goalMode,
  baseSessionMinutes,
  phase,
  recentExerciseTitles,
  stableMainLiftMap,
}) {
  const experience = normalizeExperience(profile.experienceLevel);
  const availableEquipment = inferAvailableEquipment(profile);
  const restrictions = inferRestrictions(profile);
  const weakAreas = uniqStrings(profile.weakAreas || []);
  const fatiguePenalty = inferSessionFatigue(profile, day);

  const sessionMinutes = Math.max(
    35,
    Math.round(baseSessionMinutes * phase.volumeFactor * (1 - fatiguePenalty))
  );

  const contextBase = {
    availableEquipment,
    experience,
    restrictions,
    goalMode,
    recentTitles: recentExerciseTitles,
    profile,
  };

  const mainPatterns = asArray(template.main).slice(0, 2);
  const accessoryPatterns = asArray(template.accessory).slice(0, 4);

  const mainItems = mainPatterns.map((pattern, idx) => {
    const weakAreaBias = weakAreaMatchesPattern(pattern, weakAreas);

    const stableExercise =
      stableMainLiftMap?.[template.title]?.[pattern] || null;

    const exercise =
      stableExercise ||
      pickBestExercise(pattern, {
        ...contextBase,
        weakAreaBias,
      });

    recentExerciseTitles.add(safeLower(exercise.title));

    const prescription = getMainLiftPrescription(
      goalMode,
      phase,
      idx === 0 ? "primary" : "secondary",
      profile,
      fatiguePenalty
    );

    return buildExerciseItem({
      exercise,
      prescription,
      load: inferLoadHint(exercise.title, pattern, profile, goalMode, idx === 0, phase),
      isPrimary: idx === 0,
      weakAreaBias,
    });
  });

  const accessoryItemsRaw = accessoryPatterns.map((pattern) => {
    const weakAreaBias = weakAreaMatchesPattern(pattern, weakAreas);

    const exercise = pickBestExercise(pattern, {
      ...contextBase,
      weakAreaBias,
    });

    recentExerciseTitles.add(safeLower(exercise.title));

    const prescription = getAccessoryPrescription(goalMode, phase, weakAreaBias, fatiguePenalty);

    return buildExerciseItem({
      exercise,
      prescription,
      load: "Choose a load that keeps reps clean and controlled.",
      isPrimary: false,
      weakAreaBias,
    });
  });

  const accessoryItems = trimAccessoriesForTime(accessoryItemsRaw, sessionMinutes, fatiguePenalty);

  const warmupBlock = buildWarmupBlock(template.title, restrictions, fatiguePenalty);

  const mainBlock = {
    id: `main_${weekNumber}_${day}`,
    kind: "main",
    title: "Main Work",
    items: mainItems,
  };

  const accessoryBlock = {
    id: `accessory_${weekNumber}_${day}`,
    kind: "accessory",
    title: "Accessory Work",
    items: accessoryItems,
  };

  const cooldownBlock = {
    id: `cooldown_${weekNumber}_${day}`,
    kind: "cooldown",
    title: "Cool-down",
    items: [
      {
        kind: "cooldown",
        title: "Breathing + mobility reset",
        timeSec: 300,
        notes: "Bring HR down and restore positions used in the session.",
      },
    ],
  };

  const blocks = [warmupBlock, mainBlock, accessoryBlock, cooldownBlock];
  const segments = blocksToSegments(blocks);

  const estimatedDurationMin =
    estimateBlockTimeMin(warmupBlock.items) +
    estimateBlockTimeMin(mainBlock.items) +
    estimateBlockTimeMin(accessoryBlock.items) +
    estimateBlockTimeMin(cooldownBlock.items);

  const constraints = uniqStrings([profile.injuries, profile.constraints]).join(" | ");

  const notes = [
    `${phase.label} week.`,
    phase.progressionNote,
    `Session emphasis: ${template.emphasis}.`,
    weakAreas.length ? `Weak-area bias: ${weakAreas.join(", ")}.` : "",
    constraints ? `Constraints noted: ${constraints}.` : "",
    fatiguePenalty >= 0.14 ? "Session adjusted down slightly due to surrounding fatigue / recovery demand." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    day,
    type: "Strength",
    sessionType: "gym",
    title: template.title,
    emphasis: template.emphasis,
    focus: mainPatterns.join(" + "),
    notes,
    targetDurationMin: sessionMinutes,
    durationMin: estimatedDurationMin,
    totalDistanceKm: 0,
    coaching: {
      weekPhase: phase.label,
      progressionNote: phase.progressionNote,
      recoveryTarget:
        phase.label === "Deload"
          ? "Keep effort low and finish fresh."
          : fatiguePenalty >= 0.14
            ? "Prioritise quality over load and keep more reps in reserve today."
            : "Finish with 1-3 reps in reserve on most work.",
      exerciseStability: profile.fixedMainLifts
        ? "Primary lifts are kept stable across the block to drive progression."
        : "Primary lifts can rotate slightly for variety and joint management.",
      fatiguePenalty: Math.round(fatiguePenalty * 100) / 100,
    },
    workout: {
      sport: "strength",
      totalDurationSec: estimatedDurationMin * 60,
      totalDistanceKm: 0,
      steps: segments,
      notes: `Primary emphasis: ${template.emphasis}.`,
    },
    segments,
    steps: segments,
    blocks,
  };
}

/* ============================================================================
   PLAN BUILDING
============================================================================ */

function buildStrengthPlan(profile, uid) {
  const trainingDays = chooseTrainingDays(profile.daysPerWeek, profile.preferredDays);
  const templates = splitTemplatesFor(profile.preferredSplit);
  const orderedTemplates = reorderTemplatesForSchedule(templates, trainingDays, profile);
  const goalMode = inferGoalMode(profile.goalType, profile.primaryFocus);
  const baseSessionMinutes = parseSessionLengthMinutes(profile.sessionLength);

  const weeks = [];
  const recentExerciseTitles = new Set();
  const stableMainLiftMap = buildStableMainLiftMap(orderedTemplates, profile, goalMode);

  for (let wi = 0; wi < profile.planLengthWeeks; wi += 1) {
    const weekNumber = wi + 1;
    const phase = getWeekPhase(weekNumber, profile.planLengthWeeks);

    let sessionOrder = 0;

    const days = DAYS.map((dayLabel, dayIndex) => {
      if (!trainingDays.includes(dayLabel)) {
        return {
          day: dayLabel,
          sessions: [],
          recoveryGuidance:
            normalizeDay(profile.preferredRestDay) === dayLabel
              ? "Preferred rest day. Keep activity light and recovery-focused."
              : dayLabel === normalizeDay(profile.hardestConditioningDay)
                ? "Hard conditioning day. Avoid adding more lower-body fatigue."
                : dayLabel === "Wed" || dayLabel === "Sun"
                  ? "Optional mobility, walking, or complete rest."
                  : "Non-lifting day.",
        };
      }

      const template = orderedTemplates[sessionOrder % orderedTemplates.length];

      const session = buildStrengthSession({
        weekNumber,
        day: dayLabel,
        dayIndex,
        sessionOrder,
        template,
        profile,
        goalMode,
        baseSessionMinutes,
        phase,
        recentExerciseTitles,
        stableMainLiftMap,
      });

      sessionOrder += 1;

      return {
        day: dayLabel,
        sessions: [session],
      };
    });

    weeks.push({
      title: `Week ${weekNumber} - ${phase.label}`,
      focus:
        phase.label === "Deload"
          ? "Reduce fatigue and consolidate adaptations"
          : `${profile.primaryFocus} progression`,
      weekNumber,
      phase: {
        label: phase.label,
        volumeFactor: phase.volumeFactor,
        intensityFactor: phase.intensityFactor,
        progressionNote: phase.progressionNote,
      },
      days,
    });
  }

  return {
    name: `${profile.planLengthWeeks}-Week Strength Plan`,
    goalType: `${profile.goalType} - ${profile.primaryFocus}`,
    kind: "strength",
    primaryActivity: "Strength",
    source: "generate-strength",
    meta: {
      generator: "strength-v3-adaptive",
      generatedForUid: uid || null,
      trainingDays,
      preferredRestDay: normalizeDay(profile.preferredRestDay),
      hardestConditioningDay: normalizeDay(profile.hardestConditioningDay),
      split: profile.preferredSplit,
      sessionLength: profile.sessionLength,
      experienceLevel: profile.experienceLevel,
      goalMode,
      coachingStyle: "adaptive_strength",
      fixedMainLifts: profile.fixedMainLifts,
      progressionStyle: profile.progressionStyle,
    },
    athleteProfile: {
      goalType: profile.goalType,
      primaryFocus: profile.primaryFocus,
      secondaryFocus: profile.secondaryFocus,
      planLengthWeeks: profile.planLengthWeeks,
      daysPerWeek: profile.daysPerWeek,
      preferredDays: profile.preferredDays,
      preferredRestDay: profile.preferredRestDay,
      preferredSplit: profile.preferredSplit,
      sessionLength: profile.sessionLength,
      equipment: profile.equipment,
      weakAreas: profile.weakAreas,
      injuries: profile.injuries,
      constraints: profile.constraints,
      notesForCoach: profile.notesForCoach,
      otherSessions: profile.otherSessions,
      trainingAgeYears: profile.trainingAgeYears,
      currentSquat: profile.currentSquat,
      currentBench: profile.currentBench,
      currentDeadlift: profile.currentDeadlift,
      bodyweightKg: profile.bodyweightKg,
      recoveryCapacity: profile.recoveryCapacity,
      sleepQuality: profile.sleepQuality,
      stressLevel: profile.stressLevel,
      runningSessionsPerWeek: profile.runningSessionsPerWeek,
      hyroxSessionsPerWeek: profile.hyroxSessionsPerWeek,
      sportSessionsPerWeek: profile.sportSessionsPerWeek,
      hardestConditioningDay: profile.hardestConditioningDay,
      progressionStyle: profile.progressionStyle,
      priorityLifts: profile.priorityLifts,
      liftsToAvoid: profile.liftsToAvoid,
      preferredExerciseStyle: profile.preferredExerciseStyle,
      overheadBarbellAllowed: profile.overheadBarbellAllowed,
      fixedMainLifts: profile.fixedMainLifts,
    },
    planGuidelines: {
      progression: [
        "Primary lifts: add load conservatively only when all working sets land inside the target RPE and technique remains stable.",
        "Accessories: progress reps first, then load.",
        "During deload weeks: reduce sets and keep 3-4 reps in reserve.",
      ],
      execution: [
        "Stop most sets with 1-3 reps in reserve unless otherwise specified.",
        "Do not sacrifice technique to chase load progression.",
        "Where joints are sensitive, prefer machine or supported variations listed as substitutions.",
        "If outside conditioning load is high, reduce ambition on lower-body loading before reducing quality.",
      ],
    },
    weeks,
  };
}

/* ============================================================================
   ROUTE
============================================================================ */

router.post("/", (req, res) => {
  try {
    const profile = normalizeStrengthProfile(req.body || {});
    const errors = validateStrengthProfile(profile);

    if (errors.length) {
      return res.status(400).json({
        error: "Missing or invalid strength-plan inputs.",
        details: errors,
      });
    }

    const plan = buildStrengthPlan(profile, req?.user?.uid || null);

    return res.json({
      ok: true,
      generator: "strength-v3-adaptive",
      plan,
    });
  } catch (error) {
    console.error("[generate-strength] error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate strength plan.",
    });
  }
});

export default router;