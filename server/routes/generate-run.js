import express from "express";
import {
  applyRunPlanRules,
  getLowFrequencyGoalWarning,
} from "../lib/train/planRules/index.js";
import {
  applyRecentTrainingSafeguardsToProfile,
  loadRecentReadinessRowsForUser,
  loadRecentTrainingRowsForUser,
} from "../lib/train/planRules/adaptation.js";
import { parseRecentRaceAnchor } from "../lib/train/planRules/deriveInputs.js";
import {
  normaliseDayAbbrev,
  normaliseGoalDistanceKey,
} from "../lib/train/planRules/normalization.js";
import { scoreGoalRealism } from "../lib/train/planRules/goalRealism.js";
import { repairPlanAfterMissedSession } from "../lib/train/planRules/missedSessionRepair.js";
import { applyReadinessAdjustment } from "../lib/train/planRules/readinessAdjustment.js";
import { applyStrengthTrainingAwareness } from "../lib/train/planRules/strengthAwareness.js";
import { recalculateUpcomingWeeks } from "../lib/train/planRules/adaptiveWeeklyRecalculation.js";
import { buildDynamicPaceModel } from "../lib/train/planRules/pacePhysiology.js";
import {
  applyPlanExplanationToPlan,
  buildPlanExplanation,
} from "../lib/train/planRules/planExplanation.js";
import { runExpandedFinalValidation } from "../lib/train/planRules/validateAndRepair.js";
import { RULES } from "../lib/train/planRules/rulesConfig.js";
import { selectRunPlanTemplate } from "../lib/train/templates/templateSelector.js";
import { buildPlanFromTemplate } from "../lib/train/templates/templateScaler.js";

const router = express.Router();

const RUN_PLAN_VERSION = "run-plan-v1";
const RULES_ENGINE_VERSION = "rules-engine-v1";
const TEMPLATE_VERSION = "gold-template-v1";

const REQUIRED_INPUT_FIELDS = [
  "athleteProfile.goal.distance",
  "athleteProfile.goal.planLengthWeeks",
  "athleteProfile.current.weeklyKm",
  "athleteProfile.current.longestRunKm",
  "athleteProfile.current.experience",
  "athleteProfile.availability.sessionsPerWeek",
  "athleteProfile.availability.runDays",
  "athleteProfile.availability.longRunDay",
  "athleteProfile.preferences.difficulty",
];

const REQUIRED_INPUT_OBJECTS = [
  "athleteProfile",
  "athleteProfile.goal",
  "athleteProfile.current",
  "athleteProfile.availability",
  "athleteProfile.preferences",
];

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getPathValue(root, path) {
  if (!path) return undefined;
  const keys = String(path).split(".");
  let cur = root;
  for (const key of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function hasNonEmptyValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string" && !v.trim()) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function validateCriticalRouteInputs(body) {
  const errors = [];

  if (!isPlainObject(body)) {
    errors.push("Missing request JSON body.");
    return { errors };
  }

  for (const path of REQUIRED_INPUT_OBJECTS) {
    const value = getPathValue(body, path);
    if (!isPlainObject(value)) {
      errors.push(`Missing required object ${path}.`);
    }
  }

  for (const path of REQUIRED_INPUT_FIELDS) {
    const value = getPathValue(body, path);
    if (!hasNonEmptyValue(value)) {
      errors.push(`Missing required field ${path}.`);
    }
  }

  return { errors };
}

function parseTimeToSeconds(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const parts = s.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((x) => Number(x));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) {
    const [mm, ss] = nums;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }
  const [hh, mm, ss] = nums;
  if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
  return hh * 3600 + mm * 60 + ss;
}

function hasRecentTimesAnchor(profile) {
  const recentTimes = profile?.current?.recentTimes || {};
  const candidates = [
    recentTimes?.fiveK,
    recentTimes?.tenK,
    recentTimes?.half,
    recentTimes?.marathon,
  ];
  return candidates.some((v) => Number.isFinite(parseTimeToSeconds(v)));
}

function ageFromBirthDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - d.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

function validateInputContract(profile) {
  const errors = [];
  const bounds = RULES?.normalization || {};
  const sessionsCfg = bounds.sessionsPerWeek || {};
  const weeksCfg = bounds.planLengthWeeks || {};

  const sessionsMin = Number.isFinite(Number(sessionsCfg.min)) ? Number(sessionsCfg.min) : 1;
  const sessionsMax = Number.isFinite(Number(sessionsCfg.max)) ? Number(sessionsCfg.max) : 7;
  const weeksMin = Number.isFinite(Number(weeksCfg.min)) ? Number(weeksCfg.min) : 1;
  const weeksMax = Number.isFinite(Number(weeksCfg.max)) ? Number(weeksCfg.max) : 52;

  const allowedExperience = Array.isArray(RULES?.productSpec?.experienceLevels)
    ? RULES.productSpec.experienceLevels
    : ["New to running", "Some experience", "Regular runner", "Advanced/competitive"];
  const allowedDifficulty = Array.isArray(RULES?.productSpec?.difficultyModes)
    ? RULES.productSpec.difficultyModes
    : ["easy", "balanced", "hard"];
  const allowedGoalDistances = Array.isArray(RULES?.productSpec?.goalDistances)
    ? RULES.productSpec.goalDistances
    : ["5K", "10K", "HALF", "MARATHON", "ULTRA"];

  const goal = isPlainObject(profile?.goal) ? profile.goal : {};
  const current = isPlainObject(profile?.current) ? profile.current : {};
  const availability = isPlainObject(profile?.availability) ? profile.availability : {};
  const preferences = isPlainObject(profile?.preferences) ? profile.preferences : {};
  let goalDistanceKey = null;

  // 1) goal.distance
  const goalDistanceRaw = goal.distance;
  if (typeof goalDistanceRaw !== "string" || !goalDistanceRaw.trim()) {
    errors.push("Missing required field athleteProfile.goal.distance.");
  } else {
    goalDistanceKey = normaliseGoalDistanceKey(goalDistanceRaw, {
      fallback: null,
      allowGeneral: true,
      allowReturn: true,
    });
    if (!goalDistanceKey) {
      errors.push(
        `Invalid athleteProfile.goal.distance. Supported values include: ${allowedGoalDistances.join(", ")}.`
      );
    }
  }

  // 2) goal.planLengthWeeks
  const planLengthWeeks = toNumberOrNull(goal.planLengthWeeks);
  if (goal.planLengthWeeks === undefined || goal.planLengthWeeks === null || goal.planLengthWeeks === "") {
    errors.push("Missing required field athleteProfile.goal.planLengthWeeks.");
  } else if (!Number.isInteger(planLengthWeeks)) {
    errors.push("Invalid athleteProfile.goal.planLengthWeeks. Expected an integer.");
  } else if (planLengthWeeks < weeksMin || planLengthWeeks > weeksMax) {
    errors.push(
      `Invalid athleteProfile.goal.planLengthWeeks. Expected ${weeksMin}-${weeksMax}.`
    );
  }

  // 3) current.weeklyKm
  const weeklyKm = toNumberOrNull(current.weeklyKm);
  if (current.weeklyKm === undefined || current.weeklyKm === null || current.weeklyKm === "") {
    errors.push("Missing required field athleteProfile.current.weeklyKm.");
  } else if (!Number.isFinite(weeklyKm) || weeklyKm < 0) {
    errors.push("Invalid athleteProfile.current.weeklyKm. Expected a non-negative number.");
  } else if (weeklyKm <= 0 && !["GENERAL", "RETURN"].includes(goalDistanceKey)) {
    errors.push("Invalid athleteProfile.current.weeklyKm. Expected a positive number.");
  }

  // 4) current.longestRunKm
  const longestRunKm = toNumberOrNull(current.longestRunKm);
  if (current.longestRunKm === undefined || current.longestRunKm === null || current.longestRunKm === "") {
    errors.push("Missing required field athleteProfile.current.longestRunKm.");
  } else if (!Number.isFinite(longestRunKm) || longestRunKm < 0) {
    errors.push("Invalid athleteProfile.current.longestRunKm. Expected a non-negative number.");
  } else if (longestRunKm <= 0 && !["GENERAL", "RETURN"].includes(goalDistanceKey)) {
    errors.push("Invalid athleteProfile.current.longestRunKm. Expected a positive number.");
  }

  // 5) current.experience
  const experience = typeof current.experience === "string" ? current.experience.trim() : "";
  if (!experience) {
    errors.push("Missing required field athleteProfile.current.experience.");
  } else if (!allowedExperience.includes(experience)) {
    errors.push(
      `Invalid athleteProfile.current.experience. Allowed values: ${allowedExperience.join(", ")}.`
    );
  }

  // 6) availability.sessionsPerWeek
  const sessionsPerWeek = toNumberOrNull(availability.sessionsPerWeek);
  if (
    availability.sessionsPerWeek === undefined ||
    availability.sessionsPerWeek === null ||
    availability.sessionsPerWeek === ""
  ) {
    errors.push("Missing required field athleteProfile.availability.sessionsPerWeek.");
  } else if (!Number.isInteger(sessionsPerWeek)) {
    errors.push("Invalid athleteProfile.availability.sessionsPerWeek. Expected an integer.");
  } else if (sessionsPerWeek < sessionsMin || sessionsPerWeek > sessionsMax) {
    errors.push(
      `Invalid athleteProfile.availability.sessionsPerWeek. Expected ${sessionsMin}-${sessionsMax}.`
    );
  }

  // 7) availability.runDays
  const runDays = availability.runDays;
  let normalizedRunDays = [];
  if (!Array.isArray(runDays) || runDays.length === 0) {
    errors.push("Missing required field athleteProfile.availability.runDays.");
  } else {
    const invalidRunDays = [];
    const normalized = [];

    for (const d of runDays) {
      const nd = normaliseDayAbbrev(d);
      if (!nd) invalidRunDays.push(String(d));
      else normalized.push(nd);
    }

    if (invalidRunDays.length) {
      errors.push(
        `Invalid athleteProfile.availability.runDays. Invalid day(s): ${invalidRunDays.join(", ")}. Use Mon..Sun abbreviations.`
      );
    }

    const unique = [...new Set(normalized)];
    if (unique.length !== normalized.length) {
      errors.push("Invalid athleteProfile.availability.runDays. Duplicate day values are not allowed.");
    }

    if (
      Number.isInteger(sessionsPerWeek) &&
      sessionsPerWeek >= sessionsMin &&
      sessionsPerWeek <= sessionsMax &&
      unique.length !== sessionsPerWeek
    ) {
      errors.push(
        "Invalid athleteProfile.availability.runDays. Count must match availability.sessionsPerWeek."
      );
    }

    normalizedRunDays = unique;
  }

  // 8) availability.longRunDay
  const longRunDayRaw = availability.longRunDay;
  const longRunDay = normaliseDayAbbrev(longRunDayRaw);
  if (longRunDayRaw === undefined || longRunDayRaw === null || String(longRunDayRaw).trim() === "") {
    errors.push("Missing required field athleteProfile.availability.longRunDay.");
  } else if (!longRunDay) {
    errors.push("Invalid athleteProfile.availability.longRunDay. Use Mon..Sun abbreviation.");
  } else if (normalizedRunDays.length && !normalizedRunDays.includes(longRunDay)) {
    errors.push(
      "Invalid athleteProfile.availability.longRunDay. Value must be one of availability.runDays."
    );
  }

  // 9) preferences.difficulty
  const difficulty = typeof preferences.difficulty === "string" ? preferences.difficulty.trim().toLowerCase() : "";
  if (!difficulty) {
    errors.push("Missing required field athleteProfile.preferences.difficulty.");
  } else if (!allowedDifficulty.includes(difficulty)) {
    errors.push(
      `Invalid athleteProfile.preferences.difficulty. Allowed values: ${allowedDifficulty.join(", ")}.`
    );
  }

  return { errors };
}

function validateProfileQualityInputs(profile) {
  const warnings = [];
  const blockers = [];

  const goal = isPlainObject(profile?.goal) ? profile.goal : {};
  const current = isPlainObject(profile?.current) ? profile.current : {};
  const availability = isPlainObject(profile?.availability) ? profile.availability : {};
  const preferences = isPlainObject(profile?.preferences) ? profile.preferences : {};

  const goalKey = normaliseGoalDistanceKey(goal.distance, {
    fallback: null,
    allowGeneral: true,
    allowReturn: true,
  });
  const weeklyKm = toNumberOrNull(current.weeklyKm);
  const longestRunKm = toNumberOrNull(current.longestRunKm);
  const planLengthWeeks = toNumberOrNull(goal.planLengthWeeks);
  const sessionsPerWeek = toNumberOrNull(availability.sessionsPerWeek);
  const difficulty = String(preferences.difficulty || "").trim().toLowerCase();
  const experience = String(current.experience || "").trim();

  const issue = ({ code, severity = "warning", message, evidence = null, recommendation = null }) => ({
    code,
    severity,
    message,
    ...(evidence ? { evidence } : {}),
    ...(recommendation ? { recommendation } : {}),
  });
  const addWarning = (item) => warnings.push(issue({ ...item, severity: "warning" }));
  const addBlocker = (item) => blockers.push(issue({ ...item, severity: "blocker" }));

  if (weeklyKm != null && longestRunKm != null && weeklyKm > 0 && longestRunKm > weeklyKm) {
    addBlocker({
      code: "LONGEST_RUN_EXCEEDS_WEEKLY_VOLUME",
      message: "Longest recent run cannot be higher than current weekly volume.",
      evidence: { weeklyKm, longestRunKm },
      recommendation: "Check whether weekly volume or longest recent run was entered incorrectly.",
    });
  }

  const minWeeksByGoal = {
    "5K": { recommended: 6, absolute: 4 },
    "10K": { recommended: 8, absolute: 6 },
    HALF: { recommended: 10, absolute: 8 },
    MARATHON: { recommended: 14, absolute: 10 },
    ULTRA: { recommended: 16, absolute: 12 },
  };
  const weekRule = minWeeksByGoal[goalKey];
  if (weekRule && planLengthWeeks != null) {
    if (planLengthWeeks < weekRule.absolute) {
      addBlocker({
        code: "INSUFFICIENT_WEEKS_FOR_GOAL",
        message: `${goalKey} plans need at least ${weekRule.absolute} weeks for a defensible build.`,
        evidence: { goal: goalKey, planLengthWeeks, minimumWeeks: weekRule.absolute },
        recommendation: `Increase plan length to ${weekRule.recommended}+ weeks or choose a shorter goal.`,
      });
    } else if (planLengthWeeks < weekRule.recommended) {
      addWarning({
        code: "SHORT_BUILD_FOR_GOAL",
        message: `${goalKey} plans are safer with ${weekRule.recommended}+ weeks.`,
        evidence: { goal: goalKey, planLengthWeeks, recommendedWeeks: weekRule.recommended },
        recommendation: "Extend the plan length if the event date allows.",
      });
    }
  }

  const volumeRules = {
    "5K": { recommended: 8, absolute: 3 },
    "10K": { recommended: 14, absolute: 6 },
    HALF: { recommended: 22, absolute: 12 },
    MARATHON: { recommended: 32, absolute: 18 },
    ULTRA: { recommended: 42, absolute: 25 },
  };
  const volumeRule = volumeRules[goalKey];
  if (volumeRule && weeklyKm != null) {
    if (weeklyKm < volumeRule.absolute) {
      addBlocker({
        code: "CURRENT_VOLUME_TOO_LOW_FOR_GOAL",
        message: `Current weekly volume is too low for a ${goalKey} plan.`,
        evidence: { goal: goalKey, weeklyKm, minimumWeeklyKm: volumeRule.absolute },
        recommendation: "Build base mileage first or choose a shorter/lower-risk goal.",
      });
    } else if (weeklyKm < volumeRule.recommended) {
      addWarning({
        code: "CURRENT_VOLUME_BELOW_RECOMMENDED_FOR_GOAL",
        message: `Current weekly volume is below the recommended starting point for a ${goalKey} plan.`,
        evidence: { goal: goalKey, weeklyKm, recommendedWeeklyKm: volumeRule.recommended },
        recommendation: "Use an easier difficulty or extend the plan length.",
      });
    }
  }

  if (
    experience === "New to running" &&
    (difficulty === "hard" || difficulty === "aggressive") &&
    goalKey !== "GENERAL" &&
    goalKey !== "RETURN"
  ) {
    addWarning({
      code: "BEGINNER_ADVANCED_DIFFICULTY_MISMATCH",
      message: "Beginner users should not be assigned advanced or hard plans.",
      evidence: { experience, difficulty },
      recommendation: "Use easy or balanced difficulty until the athlete has consistent running history.",
    });
  }

  if (Number.isInteger(sessionsPerWeek) && Array.isArray(availability.runDays)) {
    const uniqueRunDays = [...new Set(availability.runDays.map(normaliseDayAbbrev).filter(Boolean))];
    if (uniqueRunDays.length !== sessionsPerWeek) {
      addBlocker({
        code: "RUN_DAY_COUNT_MISMATCH",
        message: "Selected run days must match sessions per week.",
        evidence: { sessionsPerWeek, selectedRunDays: uniqueRunDays.length },
        recommendation: "Adjust availability.sessionsPerWeek or selected run days.",
      });
    }
  }

  return { warnings, blockers };
}

/**
 * Personalization anchor precedence:
 * Pace: threshold pace > recent race/PB > recentTimes fallback > default policy
 * HR: age baseline max (220-age) > resting/LTHR overrides where provided
 */
function deriveMaxHrFromAge(profile) {
  const ageRaw =
    profile?.current?.age ??
    profile?.age ??
    ageFromBirthDate(profile?.preferences?.profile?.birthDate);
  const age = Number(ageRaw);
  if (!Number.isFinite(age) || age < 12 || age > 100) return null;

  const maxHr = Math.round(220 - age);
  if (!Number.isFinite(maxHr) || maxHr < 120 || maxHr > 220) return null;
  return maxHr;
}

function validatePersonalizationInputs(profile) {
  const errors = [];
  const warnings = [];

  const pacing = profile?.pacing || {};
  const hr = profile?.hr || {};

  const threshold = Number(pacing?.thresholdPaceSecPerKm);
  const hasThreshold = Number.isFinite(threshold) && threshold > 0;

  const rr = pacing?.recentRace || null;
  const parsedRecentRace = parseRecentRaceAnchor(rr);
  const hasRecentRace = !!parsedRecentRace;

  if (hasThreshold && (threshold < 120 || threshold > 900)) {
    errors.push("pacing.thresholdPaceSecPerKm must be between 120 and 900 seconds/km.");
  }

  if (rr && !hasRecentRace) {
    errors.push(
      "pacing.recentRace requires a parseable race result (distance or distanceKm + timeSec/time/result)."
    );
  }

  const hasRecentTimes = hasRecentTimesAnchor(profile);
  const hasPaceAnchor = hasThreshold || hasRecentRace || hasRecentTimes;
  if (!hasPaceAnchor) {
    warnings.push(
      "No pace anchor provided; planner will use default pace policy."
    );
  }

  const explicitMax = Number(hr?.max);
  const resting = Number(hr?.resting);
  const lthr = Number(hr?.lthr);
  const derivedMax = deriveMaxHrFromAge(profile);
  const max = Number.isFinite(derivedMax) ? derivedMax : Number.isFinite(explicitMax) ? explicitMax : null;

  const hasHrr = Number.isFinite(max) && Number.isFinite(resting);
  const hasLthr = Number.isFinite(lthr) && lthr > 0;

  if (hasHrr) {
    if (Number.isFinite(derivedMax)) {
      warnings.push("Using age-derived hr.max (220-age).");
      if (Number.isFinite(explicitMax) && Math.abs(explicitMax - derivedMax) >= 1) {
        warnings.push("Provided hr.max differs from age-derived max and is ignored.");
      }
    } else if (Number.isFinite(explicitMax)) {
      warnings.push("Age not provided/valid; using provided hr.max.");
    }
    if (max <= resting) errors.push("hr.max must be greater than hr.resting.");
    if (resting < 30 || resting > 120) {
      warnings.push("hr.resting is outside the typical range (30-120 bpm).");
    }
    if (max < 120 || max > 240) {
      warnings.push("hr.max is outside the typical range (120-240 bpm).");
    }
  }

  if (Number.isFinite(lthr) && (lthr < 120 || lthr > 220)) {
    warnings.push("hr.lthr is outside the typical range (120-220 bpm).");
  }

  const hasMaxOnly = Number.isFinite(max);
  const hasHrAnchor = hasHrr || hasLthr || hasMaxOnly;
  if (hasMaxOnly && !hasHrr && !hasLthr) {
    warnings.push("Using max-HR baseline zones (age-derived 220-age when age is available).");
  }
  if (!hasHrAnchor) {
    warnings.push(
      "No HR anchor provided; planner may use generic defaults."
    );
  }

  return { errors, warnings, hasPaceAnchor, hasHrAnchor };
}

function buildLowFrequencyAlternatives(warning) {
  const distance = String(warning?.distance || "").toLowerCase();
  const recommended = warning?.recommendedSessionsPerWeek || null;
  const alternatives = [];

  if (recommended) {
    alternatives.push({
      type: "increase_frequency",
      message: `Increase to at least ${recommended} run days per week.`,
    });
  }

  if (distance.includes("ultra")) {
    alternatives.push({
      type: "reduce_goal",
      message: "Choose a marathon, half marathon, or general fitness goal first.",
    });
  } else if (distance.includes("marathon")) {
    alternatives.push({
      type: "reduce_goal",
      message: "Choose a half marathon, 10K, or general fitness goal first.",
    });
  } else if (distance.includes("half")) {
    alternatives.push({
      type: "reduce_goal",
      message: "Choose a 5K, 10K, or general fitness goal first.",
    });
  }

  alternatives.push({
    type: "finish_only",
    message:
      "Use a lower-risk finish-only plan only if the athlete accepts the limitation.",
  });

  return alternatives;
}

function flattenWorkoutSteps(steps = []) {
  const out = [];
  const queue = Array.isArray(steps) ? [...steps] : [];

  while (queue.length) {
    const st = queue.shift();
    if (!st || typeof st !== "object") continue;

    if (st.stepType === "repeat" && Array.isArray(st.steps)) {
      queue.unshift(...st.steps);
      continue;
    }

    out.push(st);
  }

  return out;
}

function hasMissedSessionRepairInput(body = {}) {
  const profile = body?.athleteProfile || {};
  return Boolean(
    body?.missedSession ||
      (Array.isArray(body?.missedSessionIds) && body.missedSessionIds.length) ||
      (Array.isArray(body?.completedSessions) && body.completedSessions.length) ||
      profile?.missedSession ||
      (Array.isArray(profile?.missedSessionIds) && profile.missedSessionIds.length) ||
      (Array.isArray(profile?.completedSessions) && profile.completedSessions.length)
  );
}

function getReadinessInput(body = {}) {
  const profile = body?.athleteProfile || {};
  return body?.readiness || profile?.readiness || profile?.current?.readiness || null;
}

function getStrengthTrainingInput(body = {}) {
  const profile = body?.athleteProfile || {};
  return body?.strengthTraining || profile?.strengthTraining || profile?.current?.strengthTraining || null;
}

function getCompletedSessionsInput(body = {}) {
  const profile = body?.athleteProfile || {};
  return body?.completedSessions || profile?.completedSessions || null;
}

function getRecentActivitiesInput(body = {}) {
  const profile = body?.athleteProfile || {};
  return body?.recentActivities || profile?.recentActivities || profile?.activities || null;
}

function getEnvironmentInput(body = {}) {
  const profile = body?.athleteProfile || {};
  return body?.environment || profile?.environment || profile?.preferences?.environment || null;
}

function templateVersionFor(template) {
  if (!template) return null;
  return (
    template.templateVersion ||
    template.version ||
    template?.metadata?.templateVersion ||
    template?.metadata?.version ||
    TEMPLATE_VERSION
  );
}

function summarizeMissedSessionRepair(result) {
  if (!result) return null;
  return {
    repairApplied: Boolean(result.repairApplied),
    repairType: result.repairType || null,
    message: result.message || null,
    changes: Array.isArray(result.changes) ? result.changes : [],
  };
}

function summarizeReadinessAdjustment(result) {
  const adjustment = result?.readinessAdjustment || null;
  if (!adjustment) return null;
  return {
    applied: Boolean(adjustment.applied),
    level: adjustment.level || null,
    score: adjustment.score ?? null,
    message: adjustment.message || null,
    changes: Array.isArray(adjustment.changes) ? adjustment.changes : [],
  };
}

function summarizeStrengthAdjustment(result) {
  const adjustment = result?.strengthAdjustment || null;
  if (!adjustment) return null;
  return {
    applied: Boolean(adjustment.applied),
    conflictsFound: Number(adjustment.conflictsFound || 0),
    changes: Array.isArray(adjustment.changes) ? adjustment.changes : [],
  };
}

function summarizeWeeklyRecalculation(result) {
  const weekly = result?.weeklyRecalculation || null;
  if (!weekly) return null;
  return {
    applied: Boolean(weekly.applied),
    completionRate: weekly.completionRate ?? null,
    volumeCompletionRate: weekly.volumeCompletionRate ?? null,
    intensityCompletionRate: weekly.intensityCompletionRate ?? null,
    decision: weekly.decision || null,
    message: weekly.message || null,
    completionAnalysisUsed: Boolean(weekly.completionAnalysisUsed),
    completionTrend: weekly.completionTrend || null,
    completionDrivenChanges: Array.isArray(weekly.completionDrivenChanges)
      ? weekly.completionDrivenChanges
      : [],
    changes: Array.isArray(weekly.changes) ? weekly.changes : [],
  };
}

function buildGeneratorFeatures({
  selectedTemplate,
  missedRepair,
  readinessResult,
  strengthResult,
  weeklyRecalculationResult,
}) {
  return {
    profileValidation: true,
    goalRealism: true,
    templateFirst: Boolean(selectedTemplate),
    dynamicPaceModel: true,
    rulesEngineGuardrails: true,
    garminSteps: true,
    missedSessionRepair: Boolean(missedRepair),
    readinessAdjustment: Boolean(readinessResult),
    strengthAwareness: Boolean(strengthResult),
    adaptiveWeeklyRecalculation: Boolean(weeklyRecalculationResult),
    expandedFinalValidation: true,
    planExplanation: true,
  };
}

// POST /generate-run?summary=1
router.post("/", async (req, res) => {
  try {
    const critical = validateCriticalRouteInputs(req.body);
    if (critical.errors.length) {
      return res.status(400).json({
        error: "Missing critical athleteProfile inputs.",
        details: critical.errors,
        requiredFields: REQUIRED_INPUT_FIELDS,
        hints: [
          "Provide athleteProfile.goal/current/availability/preferences objects.",
          "Include all required input fields before requesting plan generation.",
        ],
      });
    }

    const athleteProfile = req.body?.athleteProfile;
    const contract = validateInputContract(athleteProfile);
    if (contract.errors.length) {
      return res.status(400).json({
        error: "Missing or invalid athleteProfile inputs.",
        details: contract.errors,
        requiredFields: REQUIRED_INPUT_FIELDS,
        hints: [
          "Provide all required fields exactly under athleteProfile.goal/current/availability/preferences.",
          "Keep optional fields as needed: goal.targetDate/eventDate, current.recentTimes, and preferences.metric/treadmill/timePerSessionMin/longRunMaxMin.",
        ],
      });
    }

    const allowDefaults =
      req.query?.allowDefaults === "1" || req.query?.allowDefaults === "true";
    const allowGoalRisk =
      req.query?.allowGoalRisk === "1" ||
      req.query?.allowGoalRisk === "true" ||
      req.query?.allowRisk === "1" ||
      req.query?.allowRisk === "true";
    const profileQuality = validateProfileQualityInputs(athleteProfile);
    const goalRealism = scoreGoalRealism(athleteProfile);
    const lowFrequencyWarning = getLowFrequencyGoalWarning(
      athleteProfile?.goal?.distance,
      athleteProfile?.availability?.sessionsPerWeek
    );

    const unsafeGoalRealism = goalRealism?.level === "unsafe";
    if ((lowFrequencyWarning || profileQuality.blockers.length || unsafeGoalRealism) && !allowGoalRisk) {
      return res.status(422).json({
        error: "Goal/profile combination is not professionally defensible.",
        code: lowFrequencyWarning?.code || profileQuality.blockers[0]?.code || "GOAL_REALISM_UNSAFE",
        severity: "blocker",
        warning: lowFrequencyWarning || null,
        blockers: profileQuality.blockers,
        warnings: profileQuality.warnings,
        goalRealism,
        alternatives: lowFrequencyWarning ? buildLowFrequencyAlternatives(lowFrequencyWarning) : [
          {
            type: "adjust_profile",
            message: "Correct unrealistic profile inputs before generating a plan.",
          },
          {
            type: "reduce_goal",
            message: "Choose a shorter or lower-risk goal.",
          },
          {
            type: "extend_build",
            message: "Use a longer plan length if the event date allows.",
          },
        ],
        hints: [
          "Increase availability.sessionsPerWeek and provide matching runDays.",
          "Choose a shorter goal distance.",
          "Adjust unrealistic target time, volume, longest run, or plan length.",
          "To generate a review-only plan anyway, pass ?allowGoalRisk=1.",
        ],
      });
    }

    const validation = validatePersonalizationInputs(athleteProfile);
    const readinessInput = getReadinessInput(req.body);
    const recentActivitiesInput = getRecentActivitiesInput(req.body);
    const environmentInput = getEnvironmentInput(req.body);

    if (validation.errors.length && !allowDefaults) {
      return res.status(400).json({
        error: "Missing or invalid personalization inputs for Runna-level targets.",
        details: validation.errors,
        hints: [
          "Pace precedence: pacing.thresholdPaceSecPerKm > pacing.recentRace > current.recentTimes > default policy.",
          "HR precedence: age baseline (220-age) then resting/LTHR overrides when provided.",
          "To generate anyway with generic defaults, pass ?allowDefaults=1.",
        ],
      });
    }

    let enrichedProfile = { ...athleteProfile, goalRealism };
    const useRecentTraining =
      req.query?.useRecentTraining !== "0" &&
      req.query?.useRecentTraining !== "false" &&
      athleteProfile?.adaptation?.enabled !== false;

    if (useRecentTraining && req.user?.uid) {
      try {
        const [recentTrainingRows, recentReadinessRows] = await Promise.all([
          loadRecentTrainingRowsForUser(req.user.uid),
          loadRecentReadinessRowsForUser(req.user.uid),
        ]);
        const adaptationResult = applyRecentTrainingSafeguardsToProfile({
          athleteProfile,
          recentTrainingRows,
          recentReadinessRows,
        });
        enrichedProfile = {
          ...(adaptationResult?.athleteProfile || athleteProfile),
          goalRealism,
        };
      } catch (adaptErr) {
        console.log("[generate-run] recent training adaptation skipped:", adaptErr?.message || adaptErr);
      }
    }

    const dynamicPaceResult = buildDynamicPaceModel({
      profile: enrichedProfile,
      goalRealism,
      readiness: readinessInput,
      recentActivities: recentActivitiesInput,
      environment: environmentInput,
    });
    enrichedProfile = {
      ...enrichedProfile,
      paceModel: dynamicPaceResult.paceModel,
      paceTrace: dynamicPaceResult.paceTrace,
    };

    const selectedTemplate = selectRunPlanTemplate(enrichedProfile);
    const planSource = selectedTemplate ? "template" : "rules_engine";
    const templateId = selectedTemplate?.id || null;
    const templateVersion = templateVersionFor(selectedTemplate);
    const templatePlan = selectedTemplate
      ? buildPlanFromTemplate({
          template: selectedTemplate,
          profile: enrichedProfile,
          paceModel: dynamicPaceResult.paceModel,
        })
      : null;

    // Rules engine still applies guardrails, Garmin steps, distance contracts, and review.
    let plan = applyRunPlanRules(templatePlan, enrichedProfile);
    plan = {
      ...plan,
      planSource,
      ...(templateId ? { templateId } : {}),
    };
    let missedRepair = null;
    if (hasMissedSessionRepairInput(req.body)) {
      missedRepair = repairPlanAfterMissedSession({
        plan,
        missedSession: req.body?.missedSession || athleteProfile?.missedSession || null,
        missedSessionIds: req.body?.missedSessionIds || athleteProfile?.missedSessionIds || null,
        completedSessions: req.body?.completedSessions || athleteProfile?.completedSessions || null,
        profile: enrichedProfile,
        currentDate: req.body?.currentDate || athleteProfile?.currentDate || null,
        goalRealism,
      });
      plan = missedRepair.plan;
    }
    let readinessResult = null;
    if (readinessInput) {
      readinessResult = applyReadinessAdjustment({
        plan,
        profile: enrichedProfile,
        readiness: readinessInput,
        goalRealism,
        currentDate: req.body?.currentDate || athleteProfile?.currentDate || null,
      });
      plan = readinessResult.plan;
    }
    const strengthTrainingInput = getStrengthTrainingInput(req.body);
    let strengthResult = null;
    if (strengthTrainingInput) {
      strengthResult = applyStrengthTrainingAwareness({
        plan,
        profile: enrichedProfile,
        strengthTraining: strengthTrainingInput,
        currentDate: req.body?.currentDate || athleteProfile?.currentDate || null,
        goalRealism,
      });
      plan = strengthResult.plan;
    }
    const completedSessionsInput = getCompletedSessionsInput(req.body);
    let weeklyRecalculationResult = null;
    if (Array.isArray(completedSessionsInput) && completedSessionsInput.length) {
      weeklyRecalculationResult = recalculateUpcomingWeeks({
        plan,
        profile: enrichedProfile,
        completedSessions: completedSessionsInput,
        currentDate: req.body?.currentDate || athleteProfile?.currentDate || null,
        goalRealism,
        readiness: readinessInput,
      });
      plan = weeklyRecalculationResult.plan;
    }
    const finalValidationResult = runExpandedFinalValidation({
      plan,
      profile: enrichedProfile,
      goalRealism,
      readiness: readinessInput,
      completedSessions: completedSessionsInput,
    });
    plan = finalValidationResult.plan;
    const planExplanation = buildPlanExplanation({
      plan,
      profile: enrichedProfile,
      goalRealism,
      paceModel: dynamicPaceResult.paceModel,
      validationSummary: finalValidationResult.validationSummary,
      readinessAdjustment: readinessResult?.readinessAdjustment || null,
      strengthAdjustment: strengthResult?.strengthAdjustment || null,
      weeklyRecalculation: weeklyRecalculationResult?.weeklyRecalculation || null,
    });
    plan = applyPlanExplanationToPlan(plan, planExplanation);

    const generatedAt = new Date().toISOString();
    const missedSessionRepair = summarizeMissedSessionRepair(missedRepair);
    const readinessAdjustment = summarizeReadinessAdjustment(readinessResult);
    const strengthAdjustment = summarizeStrengthAdjustment(strengthResult);
    const weeklyRecalculation = summarizeWeeklyRecalculation(weeklyRecalculationResult);
    const generatorFeatures = buildGeneratorFeatures({
      selectedTemplate,
      missedRepair,
      readinessResult,
      strengthResult,
      weeklyRecalculationResult,
    });
    const planVersionMetadata = {
      planSource,
      templateId: templateId || null,
      templateVersion,
      planVersion: RUN_PLAN_VERSION,
      rulesEngineVersion: RULES_ENGINE_VERSION,
      generatedAt,
      inputProfileSnapshot: athleteProfile,
      generatorFeatures,
      validationSummary: finalValidationResult.validationSummary,
      goalRealism,
      paceModel: dynamicPaceResult.paceModel,
      planExplanation,
      weeklyRecalculation,
      readinessAdjustment,
      strengthAdjustment,
      missedSessionRepair,
    };

    const planResponse = {
      ...plan,
      ...planVersionMetadata,
      planSource,
      ...(templateId ? { templateId } : {}),
      goalRiskValidation: {
        allowedByOverride: Boolean(lowFrequencyWarning && allowGoalRisk),
        warning: lowFrequencyWarning || null,
      },
      profileQualityValidation: {
        allowedByOverride: Boolean(profileQuality.blockers.length && allowGoalRisk),
        blockers: profileQuality.blockers,
        warnings: profileQuality.warnings,
      },
      goalRealism,
      paceModel: dynamicPaceResult.paceModel,
      paceTrace: dynamicPaceResult.paceTrace,
      planExplanation,
      validationSummary: finalValidationResult.validationSummary,
      validationTrace: finalValidationResult.validationTrace,
      ...(missedRepair
        ? {
            missedSessionRepair,
            missedSessionRepairTrace: missedRepair.missedSessionRepairTrace,
          }
        : {}),
      ...(readinessResult
        ? {
            readinessAdjustment,
            readinessAdjustmentTrace: readinessResult.readinessAdjustmentTrace,
          }
        : {}),
      ...(strengthResult
        ? {
            strengthAdjustment,
            strengthAdjustmentTrace: strengthResult.strengthAdjustmentTrace,
          }
        : {}),
      ...(weeklyRecalculationResult
        ? {
            weeklyRecalculation,
            weeklyRecalculationTrace: weeklyRecalculationResult.weeklyRecalculationTrace,
          }
        : {}),
    };

    const summaryMode = req.query?.summary === "1" || req.query?.summary === "true";
    if (!summaryMode) return res.json({ plan: planResponse });

    const weeks = Array.isArray(planResponse?.weeks) ? planResponse.weeks : [];
    const firstWeek = weeks[0];

    return res.json({
      ok: true,
      planId: planResponse?.id ?? null,
      name: planResponse?.name ?? "Run plan",
      planSource: planResponse.planSource || "rules_engine",
      templateId: planResponse.templateId || null,
      templateVersion: planResponse.templateVersion || null,
      planVersion: planResponse.planVersion || null,
      rulesEngineVersion: planResponse.rulesEngineVersion || null,
      generatedAt: planResponse.generatedAt || null,
      inputProfileSnapshot: planResponse.inputProfileSnapshot || null,
      generatorFeatures: planResponse.generatorFeatures || null,
      weeksCount: weeks.length,
      personalization: {
        paces: planResponse?.paces || null,
        hrZones: planResponse?.hrZones || null,
        anchorTrace: planResponse?.anchorTrace || null,
      },
      adaptation: planResponse?.adaptationTrace || null,
      recentTrainingSummary: planResponse?.recentTrainingSummary || null,
      recentReadinessSummary: planResponse?.recentReadinessSummary || null,
      decisionTrace: planResponse?.decisionTrace || null,
      professionalReview: planResponse?.professionalReview || null,
      goalRiskValidation: planResponse.goalRiskValidation,
      profileQualityValidation: planResponse.profileQualityValidation,
      goalRealism: planResponse.goalRealism,
      paceModel: planResponse.paceModel || null,
      paceTrace: planResponse.paceTrace || null,
      planExplanation: planResponse.planExplanation || null,
      missedSessionRepair: planResponse.missedSessionRepair || null,
      missedSessionRepairTrace: planResponse.missedSessionRepairTrace || null,
      readinessAdjustment: planResponse.readinessAdjustment || null,
      readinessAdjustmentTrace: planResponse.readinessAdjustmentTrace || null,
      strengthAdjustment: planResponse.strengthAdjustment || null,
      strengthAdjustmentTrace: planResponse.strengthAdjustmentTrace || null,
      weeklyRecalculation: planResponse.weeklyRecalculation || null,
      weeklyRecalculationTrace: planResponse.weeklyRecalculationTrace || null,
      validationSummary: planResponse.validationSummary || null,
      validationTrace: planResponse.validationTrace || null,
      personalizationValidation: {
        usedDefaults: !validation.hasPaceAnchor || !validation.hasHrAnchor,
        warnings: validation.warnings,
        errors: validation.errors,
      },
      firstWeek: firstWeek
        ? {
            weekNumber: firstWeek.weekNumber ?? 1,
            phase: firstWeek.phase,
            runDays: firstWeek.runDays,
            metrics: firstWeek.metrics,
            focus: firstWeek.focus || null,
            coachNote: firstWeek.coachNote || null,
            riskNote: firstWeek.riskNote || null,
            progressionReason: firstWeek.progressionReason || null,
            sessions: (firstWeek.sessions || []).map((s) => {
              const flatSteps = flattenWorkoutSteps(s?.workout?.steps);
              return {
                day: s.day,
                type: s.type,
                name: s.name,
                plannedDistanceKm: s.plannedDistanceKm ?? s.distanceKm ?? null,
                warmupMin: s.warmupMin ?? null,
                cooldownMin: s.cooldownMin ?? null,
                stepsCount: flatSteps.length,
                targetHr: s.targetHr ?? s?.workout?.hrTarget ?? null,
                targetPace: s.targetPace ?? s?.workout?.paceTarget ?? null,
                coachNote: s.coachNote || null,
                executionTip: s.executionTip || null,
                whyThisSession: s.whyThisSession || null,
                // keep targets visible in summary if your engine sets them on steps
                targetsPreview: flatSteps.map((st) => ({
                  targetType: st.targetType ?? null,
                  targetValue: st.targetValue ?? null,
                })),
              };
            }),
          }
        : null,
    });
  } catch (e) {
    console.error("[generate-run] error:", e);
    return res.status(500).json({ error: e?.message || "Plan generation failed" });
  }
});

export default router;
export {
  validateCriticalRouteInputs,
  validateInputContract,
  validatePersonalizationInputs,
  validateProfileQualityInputs,
};
