import { applyRunPlanRules } from "../lib/train/planRules/index.js";

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function argFlag(name) {
  return process.argv.includes(`--${name}`) || ["1", "true", "yes"].includes(String(argValue(name, "")).toLowerCase());
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatPace(secPerKm) {
  const n = Number(secPerKm);
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = Math.floor(n / 60);
  const sec = Math.round(n % 60);
  return `${min}:${String(sec).padStart(2, "0")}/km`;
}

function formatDuration(type, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "";
  if (String(type || "").toLowerCase() === "distance") {
    return v >= 750 ? `${Math.round((v / 1000) * 10) / 10} km` : `${Math.round(v)} m`;
  }
  if (String(type || "").toLowerCase() === "time") {
    const min = Math.floor(v / 60);
    const sec = Math.round(v % 60);
    return sec ? `${min}m ${sec}s` : `${min} min`;
  }
  return String(v);
}

function formatKm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 10) / 10);
}

function sessionDisplayDistanceKm(session) {
  return toNumber(session?.renderedDistanceKm, toNumber(session?.computedTotalKm, toNumber(session?.plannedDistanceKm, 0)));
}

function sessionBudgetDistanceKm(session) {
  return toNumber(session?.budgetedDistanceKm, toNumber(session?.plannedDistanceKm, 0));
}

function distanceLabel(session, { debugBudget = false } = {}) {
  const displayKm = sessionDisplayDistanceKm(session);
  const budgetKm = sessionBudgetDistanceKm(session);
  const kind = String(session?.type || session?.workoutKind || "").toUpperCase();
  const showBudget = ["INTERVALS", "THRESHOLD", "TEMPO", "STRIDES"].includes(kind) && Math.abs(displayKm - budgetKm) >= 0.2;
  const executableLabel = showBudget ? `${formatKm(displayKm)} km est.` : `${formatKm(displayKm)} km`;
  return debugBudget && showBudget ? `${executableLabel} (budget ${formatKm(budgetKm)} km)` : executableLabel;
}

function formatTarget(targetType, targetValue) {
  const type = String(targetType || "").toLowerCase();
  if (!targetValue || typeof targetValue !== "object") return "";
  if (type.includes("pace")) {
    const min = formatPace(targetValue.minSecPerKm);
    const max = formatPace(targetValue.maxSecPerKm);
    return [min, max].filter(Boolean).join("-");
  }
  if (type.includes("hr")) {
    const min = Number(targetValue.minBpm);
    const max = Number(targetValue.maxBpm);
    if (Number.isFinite(min) && Number.isFinite(max)) return `${Math.round(min)}-${Math.round(max)} bpm`;
  }
  return "";
}

function formatStep(step) {
  if (!step || typeof step !== "object") return "";
  const stepType = String(step.stepType || "step").replace(/_/g, " ");
  if (stepType.toLowerCase() === "repeat") {
    const inner = (Array.isArray(step.steps) ? step.steps : []).map(formatStep).filter(Boolean).join(" + ");
    return `${step.repeatCount || 1}x (${inner})`;
  }

  const duration = formatDuration(step.durationType, step.durationValue);
  const target = formatTarget(step.targetType, step.targetValue);
  return [stepType, duration, target].filter(Boolean).join(" · ");
}

const distance = argValue("distance", "10K");
const targetTime = argValue("targetTime", "50:00");
const weeks = toNumber(argValue("weeks", 12), 12);
const sessionsPerWeek = toNumber(argValue("sessions", 4), 4);
const weeklyKm = toNumber(argValue("weeklyKm", 25), 25);
const longestRunKm = toNumber(argValue("longestRunKm", 8.8), 8.8);
const experience = argValue("experience", "Some experience");
const debugBudget = argFlag("debugBudget");

const runDaysByFrequency = {
  1: ["Sun"],
  2: ["Thu", "Sun"],
  3: ["Tue", "Thu", "Sun"],
  4: ["Mon", "Tue", "Thu", "Sun"],
  5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
};
const runDays = runDaysByFrequency[sessionsPerWeek] || runDaysByFrequency[4];

const profile = {
  goal: {
    type: "race",
    distance,
    primaryFocus: "PB / time goal",
    startDate: "2026-05-12",
    targetDate: null,
    eventDate: null,
    targetTime,
    planLengthWeeks: weeks,
  },
  availability: {
    sessionsPerWeek,
    runDays,
    longRunDay: "Sun",
    difficulty: "balanced",
  },
  current: {
    weeklyKm,
    longestRunKm,
    experience,
    age: 35,
  },
  preferences: {
    difficulty: "balanced",
    trainingFocus: "balanced",
    planQuality: "high",
    metric: "time",
    surfaces: ["Road"],
    gymAccess: "Yes",
    crossTrainingPreference: "Some",
  },
  pacing: {},
  hr: {},
};

const plan = applyRunPlanRules(null, profile);

console.log(`Sample ${distance} plan · ${sessionsPerWeek}x/week · ${weeks} weeks · target ${targetTime}`);
console.log(`Current: ${weeklyKm} km/week · longest run ${longestRunKm} km · ${experience}`);

if (Array.isArray(plan.qualityWarnings) && plan.qualityWarnings.length) {
  console.log("\nQuality warnings");
  for (const warning of plan.qualityWarnings) {
    console.log(`- ${warning.severity || "warning"} · ${warning.code || "warning"} · ${warning.message}`);
  }
}

if (plan.professionalReview) {
  console.log("\nProfessional review");
  console.log(`- ${plan.professionalReview.label}: ${plan.professionalReview.summary}`);
  for (const reviewIssue of (plan.professionalReview.issues || []).slice(0, 8)) {
    console.log(`- ${reviewIssue.severity} · ${reviewIssue.code} · ${reviewIssue.message}`);
  }
}

for (const [i, week] of (plan.weeks || []).entries()) {
  console.log(`\nWeek ${i + 1} · ${week.phase}`);
  const displayWeeklyKm = week.metrics?.displayWeeklyKm ?? week.metrics?.renderedWeeklyKm ?? week.metrics?.plannedWeeklyKm ?? "?";
  const displayQualityShare =
    week.metrics?.displayQualitySharePct ?? week.metrics?.renderedQualitySharePct ?? week.metrics?.qualitySharePct ?? "?";
  const displayLongRunShare =
    week.metrics?.displayLongRunSharePct ?? week.metrics?.renderedLongRunSharePct ?? week.metrics?.longRunSharePct ?? "?";
  console.log(
    `Total ${displayWeeklyKm} km · Quality ${displayQualityShare}% · Long run ${displayLongRunShare}%`
  );

  for (const session of week.sessions || []) {
    const title = session.title || session.name || session.type || "Session";
    console.log(`- ${session.day}: ${session.type} · ${title} · ${distanceLabel(session, { debugBudget })}`);
    const steps = Array.isArray(session.workout?.steps)
      ? session.workout.steps
      : Array.isArray(session.steps)
      ? session.steps
      : [];
    for (const step of steps.map(formatStep).filter(Boolean)) {
      console.log(`  - ${step}`);
    }
  }
}
