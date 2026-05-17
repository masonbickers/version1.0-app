import {
  normaliseDifficultyKey,
  normaliseExperienceKey,
  normaliseGoalDistanceKey,
  normalisePlanLengthWeeks,
  normaliseSessionsPerWeek,
} from "./normalization.js";

function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

function phaseForWeek({ weekIndex, weeks, goal, taperWeeks }) {
  const w = clampInt(weekIndex, 1, weeks);
  const W = Math.max(1, Number(weeks) || 1);
  const taper = clampInt(taperWeeks, 0, Math.min(4, W - 1));

  if (taper > 0 && w > W - taper) return "TAPER";
  if (w % 4 === 0) return "DELOAD";

  const nonTaper = Math.max(1, W - taper);
  const baseEnd = Math.max(1, Math.round(nonTaper * 0.25));
  const specificStart = Math.max(baseEnd + 1, nonTaper - Math.max(1, Math.round(nonTaper * 0.25)) + 1);

  if (w <= baseEnd) return "BASE";
  if (["5K", "10K", "HALF", "MARATHON", "ULTRA"].includes(goal) && w >= specificStart) {
    return "SPECIFIC";
  }
  return "BUILD";
}

function taperWeeksForGoal(goal, weeks) {
  if (goal === "GENERAL" || goal === "RETURN") return 0;
  if (weeks <= 6) return 1;
  if (goal === "5K") return 1;
  return 2;
}

function levelFor({ experience, difficulty }) {
  const exp = normaliseExperienceKey(experience);
  const diff = normaliseDifficultyKey(difficulty);
  if (exp === "new") return "beginner";
  if (exp === "advanced" || diff === "hard") return "advanced";
  return "intermediate";
}

function baseQualityCount({ level, sessionsPerWeek, goal }) {
  const spw = normaliseSessionsPerWeek(sessionsPerWeek);
  if (goal === "RETURN") return 0;
  if (goal === "GENERAL" && level === "beginner") return 0;
  if (spw <= 2) return spw <= 1 ? 0 : 1;
  if (level === "beginner") return 1;
  if (level === "advanced" && spw >= 5) return 2;
  if (level === "intermediate" && spw >= 5) return 2;
  return 1;
}

function familyPatternForGoal(goal, level) {
  if (goal === "5K") {
    return level === "advanced"
      ? ["INTERVALS", "THRESHOLD", "INTERVALS", "TEMPO"]
      : ["INTERVALS", "THRESHOLD", "INTERVALS", "THRESHOLD"];
  }
  if (goal === "10K") {
    return level === "advanced"
      ? ["INTERVALS", "THRESHOLD", "TEMPO", "INTERVALS"]
      : ["INTERVALS", "THRESHOLD", "TEMPO", "THRESHOLD"];
  }
  if (goal === "HALF") {
    return level === "advanced"
      ? ["THRESHOLD", "TEMPO", "INTERVALS", "THRESHOLD"]
      : ["THRESHOLD", "TEMPO", "THRESHOLD", "INTERVALS"];
  }
  if (goal === "MARATHON") {
    return level === "advanced"
      ? ["TEMPO", "THRESHOLD", "INTERVALS", "TEMPO"]
      : ["TEMPO", "THRESHOLD", "TEMPO", "THRESHOLD"];
  }
  if (goal === "ULTRA") {
    return ["HILLS", "TEMPO", "HILLS", "THRESHOLD"];
  }
  return ["THRESHOLD", "INTERVALS", "TEMPO", "THRESHOLD"];
}

function qualityFamiliesForWeek({ phase, weekIndex, goal, level, sessionsPerWeek }) {
  const baseCount = baseQualityCount({ level, sessionsPerWeek, goal });
  if (baseCount <= 0) return [];
  if (phase === "DELOAD") return baseCount >= 1 ? ["THRESHOLD"] : [];
  if (phase === "TAPER") {
    if (goal === "5K" || goal === "10K") return ["INTERVALS"];
    return ["TEMPO"];
  }

  const pattern = familyPatternForGoal(goal, level);
  const primary = pattern[(Math.max(1, Number(weekIndex) || 1) - 1) % pattern.length];
  if (baseCount === 1) return [primary];

  const secondary =
    primary === "INTERVALS" || primary === "HILLS"
      ? "THRESHOLD"
      : goal === "5K" || goal === "10K"
      ? "INTERVALS"
      : primary === "TEMPO"
      ? "INTERVALS"
      : "TEMPO";
  return [primary, secondary];
}

export function selectStockPlanProfile(inputs = {}) {
  const goal = normaliseGoalDistanceKey(inputs?.goalDistance || "10K", {
    fallback: "10K",
    allowGeneral: true,
    allowReturn: true,
  });
  const weeks = normalisePlanLengthWeeks(inputs?.planLengthWeeks || null);
  const sessionsPerWeek = normaliseSessionsPerWeek(inputs?.sessionsPerWeek || null);
  const level = levelFor({
    experience: inputs?.experience,
    difficulty: inputs?.difficulty,
  });
  const taperWeeks = taperWeeksForGoal(goal, weeks);

  const templateWeeks = [];
  for (let w = 1; w <= weeks; w += 1) {
    const phase = phaseForWeek({ weekIndex: w, weeks, goal, taperWeeks });
    templateWeeks.push({
      weekIndex: w,
      phase,
      qualityFamilies: qualityFamiliesForWeek({
        phase,
        weekIndex: w,
        goal,
        level,
        sessionsPerWeek,
      }),
    });
  }

  return {
    id: `${goal}_${weeks}W_${sessionsPerWeek}X_${level}`.toLowerCase(),
    source: "stock-plan-template",
    goal,
    weeks,
    sessionsPerWeek,
    level,
    taperWeeks,
    templateWeeks,
    scaling: {
      volume: "current_weekly_km_and_longest_run",
      pace: "threshold_recent_race_or_default_policy",
      guardrails: "professional_review_and_low_frequency_policy",
    },
  };
}
