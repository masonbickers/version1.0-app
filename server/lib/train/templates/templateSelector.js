import advanced5k8w5run from "./5k/advanced_8w_5run.js";
import beginner5k8w3run from "./5k/beginner_8w_3run.js";
import intermediate5k8w4run from "./5k/intermediate_8w_4run.js";
import advanced10k10w5run from "./10k/advanced_10w_5run.js";
import beginner10k8w3run from "./10k/beginner_8w_3run.js";
import beginner10k8w4run from "./10k/beginner_8w_4run.js";
import intermediate10k8w3run from "./10k/intermediate_8w_3run.js";
import intermediate10k8w4run from "./10k/intermediate_8w_4run.js";
import advancedHalf12w5run from "./half/advanced_12w_5run.js";
import beginnerHalf12w3run from "./half/beginner_12w_3run.js";
import intermediateHalf12w4run from "./half/intermediate_12w_4run.js";
import advancedMarathon18w5run from "./marathon/advanced_18w_5run.js";
import beginnerMarathon16w4run from "./marathon/beginner_16w_4run.js";
import intermediateMarathon16w5run from "./marathon/intermediate_16w_5run.js";
import general8w3run from "./general/general_8w_3run.js";
import return6w3run from "./return/return_6w_3run.js";

function text(value) {
  return String(value || "").trim();
}

function normaliseGoalDistance(value) {
  const key = text(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "5k" || key === "5000m" || key.includes("5k")) return "5K";
  if (key === "10k" || key === "10000m" || key.includes("10k")) return "10K";
  if (key === "half" || key === "hm" || key.includes("half") || key.includes("21.1")) return "HALF";
  if (key === "marathon" || key === "mara" || key.includes("marathon") || key.includes("42.2")) return "MARATHON";
  if (key.includes("return") || key.includes("injury") || key.includes("rehab")) return "RETURN";
  if (key.includes("general") || key.includes("fitness")) return "GENERAL";
  return text(value).toUpperCase();
}

function normaliseExperience(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function readPlanLengthWeeks(profile = {}) {
  const raw = profile?.goal?.planLengthWeeks ?? profile?.planLengthWeeks ?? profile?.weeks;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function readSessionsPerWeek(profile = {}) {
  const raw = profile?.availability?.sessionsPerWeek ?? profile?.sessionsPerWeek;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.round(n);
  const runDays = profile?.availability?.runDays ?? profile?.runDays;
  return Array.isArray(runDays) ? runDays.length : null;
}

function isBeginnerExperience(value) {
  return value === "beginner" ||
    value === "new_runner" ||
    value === "new_to_running" ||
    value === "novice" ||
    value === "new" ||
    value.includes("beginner") ||
    value.includes("novice") ||
    value.includes("new");
}

function isAdvancedExperience(value) {
  return value === "advanced" ||
    value === "advanced_competitive" ||
    value === "competitive" ||
    value === "elite" ||
    value.includes("advanced") ||
    value.includes("competitive") ||
    value.includes("elite");
}

function isIntermediateExperience(value) {
  return value === "intermediate" ||
    value === "some_experience" ||
    value === "regular_runner";
}

export function selectRunPlanTemplate(profile = {}) {
  const goalDistance = normaliseGoalDistance(profile?.goal?.distance ?? profile?.goalDistance);

  const experience = normaliseExperience(profile?.current?.experience ?? profile?.experience);
  const sessionsPerWeek = readSessionsPerWeek(profile);
  if (![3, 4, 5].includes(sessionsPerWeek)) return null;

  const weeks = readPlanLengthWeeks(profile);
  if (!Number.isFinite(weeks)) return null;

  if (goalDistance === "RETURN") {
    if (Math.abs(weeks - 6) > 1) return null;
    return sessionsPerWeek === 3 && isBeginnerExperience(experience) ? return6w3run : null;
  }

  if (goalDistance === "GENERAL") {
    if (Math.abs(weeks - 8) > 1) return null;
    return sessionsPerWeek === 3 && isBeginnerExperience(experience) ? general8w3run : null;
  }

  if (goalDistance === "5K") {
    if (Math.abs(weeks - 8) > 1) return null;
    if (isBeginnerExperience(experience)) {
      return sessionsPerWeek === 3 ? beginner5k8w3run : null;
    }
    if (isIntermediateExperience(experience)) {
      return sessionsPerWeek === 4 ? intermediate5k8w4run : null;
    }
    if (isAdvancedExperience(experience)) {
      return sessionsPerWeek === 5 ? advanced5k8w5run : null;
    }
    return null;
  }

  if (goalDistance === "HALF") {
    if (Math.abs(weeks - 12) > 1) return null;
    if (isBeginnerExperience(experience)) {
      return sessionsPerWeek === 3 ? beginnerHalf12w3run : null;
    }
    if (isIntermediateExperience(experience)) {
      return sessionsPerWeek === 4 ? intermediateHalf12w4run : null;
    }
    if (isAdvancedExperience(experience)) {
      return sessionsPerWeek === 5 ? advancedHalf12w5run : null;
    }
    return null;
  }

  if (goalDistance === "MARATHON") {
    if (isAdvancedExperience(experience)) {
      return sessionsPerWeek === 5 && Math.abs(weeks - 18) <= 1 ? advancedMarathon18w5run : null;
    }
    if (Math.abs(weeks - 16) > 1) return null;
    if (isBeginnerExperience(experience)) {
      return sessionsPerWeek === 4 ? beginnerMarathon16w4run : null;
    }
    if (isIntermediateExperience(experience)) {
      return sessionsPerWeek === 5 ? intermediateMarathon16w5run : null;
    }
    return null;
  }

  if (goalDistance !== "10K") return null;

  if (isAdvancedExperience(experience)) {
    return sessionsPerWeek === 5 && Math.abs(weeks - 10) <= 1 ? advanced10k10w5run : null;
  }

  if (Math.abs(weeks - 8) > 1) return null;

  if (isBeginnerExperience(experience)) {
    if (sessionsPerWeek === 4) return beginner10k8w4run;
    return sessionsPerWeek === 3 ? beginner10k8w3run : null;
  }

  if (!isIntermediateExperience(experience)) return null;

  if (sessionsPerWeek === 4) return intermediate10k8w4run;
  return intermediate10k8w3run;
}

export default selectRunPlanTemplate;
