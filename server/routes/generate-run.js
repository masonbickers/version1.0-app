import express from "express";
import { applyRunPlanRules } from "../lib/train/planRules/index.js";
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
import { RULES } from "../lib/train/planRules/rulesConfig.js";

const router = express.Router();

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

  // 1) goal.distance
  const goalDistanceRaw = goal.distance;
  if (typeof goalDistanceRaw !== "string" || !goalDistanceRaw.trim()) {
    errors.push("Missing required field athleteProfile.goal.distance.");
  } else if (
    !normaliseGoalDistanceKey(goalDistanceRaw, { fallback: null })
  ) {
    errors.push(
      `Invalid athleteProfile.goal.distance. Supported values include: ${allowedGoalDistances.join(", ")}.`
    );
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
  } else if (!Number.isFinite(weeklyKm) || weeklyKm <= 0) {
    errors.push("Invalid athleteProfile.current.weeklyKm. Expected a positive number.");
  }

  // 4) current.longestRunKm
  const longestRunKm = toNumberOrNull(current.longestRunKm);
  if (current.longestRunKm === undefined || current.longestRunKm === null || current.longestRunKm === "") {
    errors.push("Missing required field athleteProfile.current.longestRunKm.");
  } else if (!Number.isFinite(longestRunKm) || longestRunKm <= 0) {
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

/**
 * Personalization anchor precedence:
 * Pace: threshold pace > recent race/PB > recentTimes fallback > default policy
 * HR: age baseline max (220-age) > resting/LTHR overrides where provided
 */
function deriveMaxHrFromAge(profile) {
  const ageRaw = profile?.current?.age ?? profile?.age;
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
    const validation = validatePersonalizationInputs(athleteProfile);

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

    let enrichedProfile = athleteProfile;
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
        enrichedProfile = adaptationResult?.athleteProfile || athleteProfile;
      } catch (adaptErr) {
        console.log("[generate-run] recent training adaptation skipped:", adaptErr?.message || adaptErr);
      }
    }

    // ✅ Rules engine generates the full plan using personalized inputs
    const plan = applyRunPlanRules(null, enrichedProfile);

    const summaryMode = req.query?.summary === "1" || req.query?.summary === "true";
    if (!summaryMode) return res.json({ plan });

    const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
    const firstWeek = weeks[0];

    return res.json({
      ok: true,
      planId: plan?.id ?? null,
      name: plan?.name ?? "Run plan",
      weeksCount: weeks.length,
      personalization: {
        paces: plan?.paces || null,
        hrZones: plan?.hrZones || null,
        anchorTrace: plan?.anchorTrace || null,
      },
      adaptation: plan?.adaptationTrace || null,
      recentTrainingSummary: plan?.recentTrainingSummary || null,
      recentReadinessSummary: plan?.recentReadinessSummary || null,
      decisionTrace: plan?.decisionTrace || null,
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
export { validateCriticalRouteInputs, validateInputContract, validatePersonalizationInputs };
