import { normaliseExperienceKey, normaliseGoalPolicyKey } from "./normalization.js";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function idText(workoutId) {
  return String(workoutId || "").toLowerCase();
}

function goalFromProfile(profile = {}) {
  return normaliseGoalPolicyKey(
    profile?.goalPolicyKey || profile?.goalDistance || profile?.goal?.distance || "10K"
  );
}

function runnerLevel(profile = {}) {
  const exp = normaliseExperienceKey(profile?.experienceKey || profile?.experience || profile?.current?.experience);
  const diff = String(profile?.difficultyKey || profile?.difficulty || profile?.preferences?.difficulty || "").toLowerCase();
  if (exp === "new") return "beginner";
  if (exp === "advanced" || diff === "hard" || diff === "aggressive" || diff === "elite") return "advanced";
  return "intermediate";
}

function goalMatchesId(goal, id) {
  if (!goal || goal === "general" || goal === "return") return true;
  if (goal === "marathon") return id.includes("mara") || id.includes("marathon");
  return id.includes(goal);
}

function idealFamilyByGoalPhase({ goal, phase, family }) {
  const p = String(phase || "").toUpperCase();
  const f = String(family || "").toUpperCase();
  if (p === "TAPER") return ["sharp", "racepace", "race_pace", "light", "400", "1k"];
  if (p === "BASE") return f === "intervals" ? ["hills", "400", "800", "aerobic"] : ["tempo", "cruise", "continuous"];
  if (p === "BUILD") return f === "intervals" ? ["800", "1k", "1200", "2k", "hills"] : ["threshold", "progression", "tempo"];
  if (p === "SPECIFIC") {
    if (goal === "5k") return ["5k", "400", "800", "sharp"];
    if (goal === "10k") return ["10k", "racepace", "race_pace", "2k", "3k"];
    if (goal === "half" || goal === "marathon" || goal === "ultra") return [goal, "specific", "tempo", "threshold", "progression"];
  }
  return [];
}

function intensityFromId(id) {
  if (/(16x|12x|10x|70min|60min|50min|4x4k|3x5k|2x30)/.test(id)) return "high";
  if (/(8x|6x|5x|3x|25min|40min|2x15|3x10|2x12)/.test(id)) return "moderate";
  if (/(light|sharp|taper|3x1k|4x3|12min|20min|8x60)/.test(id)) return "light";
  return "moderate";
}

function workoutFitsBudget({ workout, family, targetSessionKm }) {
  const km = toNum(targetSessionKm);
  if (!km || km <= 0 || !workout) return { status: "unknown", penalty: 4 };
  if (family === "intervals") {
    const planned = toNum(workout?.meta?.planningTargetWorkM) ?? toNum(workout?.meta?.requestedWorkM) ?? toNum(workout?.meta?.targetWorkM);
    const achieved = toNum(workout?.meta?.achievedWorkM) ?? toNum(workout?.meta?.targetWorkM);
    if (!planned || !achieved) return { status: "unknown", penalty: 3 };
    const keep = achieved / planned;
    if (keep < 0.55) return { status: "poor", penalty: 28 };
    if (keep < 0.75) return { status: "trimmed", penalty: 16 };
    if (keep > 1.2) return { status: "oversized", penalty: 12 };
    return { status: "fits", penalty: 0 };
  }
  const keep = toNum(workout?.meta?.fidelityKeepRatio);
  if (keep != null) {
    if (keep < 0.55) return { status: "poor", penalty: 28 };
    if (keep < 0.75) return { status: "trimmed", penalty: 16 };
  }
  const workMin = toNum(workout?.meta?.workMin) ?? (toNum(workout?.tempo?.valueSec) != null ? toNum(workout.tempo.valueSec) / 60 : null);
  if (workMin != null && km < 5 && workMin > 25) return { status: "oversized", penalty: 18 };
  return { status: "fits", penalty: 0 };
}

function garminCompatible(workout) {
  if (!workout || typeof workout !== "object") return false;
  if (Array.isArray(workout.blocks) && workout.blocks.length) return true;
  if (Array.isArray(workout.steps) && workout.steps.length) return true;
  if (workout.tempo || workout.reps || workout.repDistanceM) return true;
  return false;
}

export function scoreWorkoutCandidate({
  workoutId,
  family,
  phase,
  weekIndex,
  profile,
  targetSessionKm,
  recentWorkoutIds,
  spec,
  workout = null,
  previousWorkout = null,
} = {}) {
  const id = idText(workoutId);
  const reasons = [];
  const penalties = [];
  let score = 100;
  const goal = goalFromProfile(profile);
  const level = runnerLevel(profile);
  const phaseKey = String(phase || "").toUpperCase();
  const recent = Array.isArray(recentWorkoutIds)
    ? recentWorkoutIds
    : recentWorkoutIds instanceof Set
      ? [...recentWorkoutIds]
      : [];

  function reward(points, reason) {
    score += points;
    reasons.push(reason);
  }
  function penalize(points, code, message, evidence = null) {
    score -= points;
    penalties.push({ code, penalty: points, message, ...(evidence ? { evidence } : {}) });
  }

  if (!workoutId) {
    penalize(100, "MISSING_WORKOUT_ID", "Candidate has no workout id.");
    return { workoutId, score: 0, reasons, penalties };
  }

  if (goalMatchesId(goal, id)) reward(10, "Workout id matches goal distance.");
  else penalize(18, "GOAL_MISMATCH", "Workout id does not match goal distance.", { goal });

  const phaseTokens = idealFamilyByGoalPhase({ goal, phase: phaseKey, family });
  if (phaseTokens.some((token) => id.includes(token))) reward(12, "Workout matches phase emphasis.");
  else penalize(8, "PHASE_WEAK_MATCH", "Workout is not an ideal match for this phase.", { phase: phaseKey });

  const intensity = intensityFromId(id);
  if (level === "beginner" && intensity === "high") {
    penalize(30, "TOO_INTENSE_FOR_BEGINNER", "High-intensity candidate is inappropriate for a beginner.");
  } else if (level === "advanced" && intensity !== "light" && phaseKey !== "TAPER") {
    reward(5, "Workout intensity is suitable for advanced runner.");
  }

  const realismLevel = profile?.goalRealism?.level || profile?.goalRealismLevel || null;
  if ((realismLevel === "aggressive" || realismLevel === "unsafe") && intensity === "high" && Number(weekIndex) <= 3) {
    penalize(22, "TOO_INTENSE_FOR_GOAL_REALISM", "Aggressive goals should avoid high-intensity loading in early weeks.");
  }
  if (phaseKey === "TAPER" && intensity === "high") {
    penalize(24, "TOO_HEAVY_FOR_TAPER", "Taper week should use lighter sharpening work.");
  }

  if (recent.includes(workoutId)) {
    penalize(26, "RECENT_REPEAT", "Workout was used recently.");
  } else {
    reward(8, "Workout has not been used recently.");
  }

  const budgetFit = workoutFitsBudget({ workout, family, targetSessionKm });
  if (budgetFit.status === "fits") reward(12, "Workout fits available session budget.");
  else penalize(budgetFit.penalty, "SESSION_BUDGET_FIT", "Workout needs too much fitting for session budget.", { status: budgetFit.status });

  const keep = toNum(workout?.meta?.fidelityKeepRatio);
  if (keep != null && keep < 0.7) {
    penalize(20, "EXCESSIVE_TRIMMING", "Workout would need excessive trimming.", { fidelityKeepRatio: keep });
  } else if (keep != null) {
    reward(6, "Workout preserves requested structure after fitting.");
  }

  if (previousWorkout && family === "tempo") {
    const prev = toNum(previousWorkout?.workMin);
    const cur = toNum(workout?.meta?.workMin) ?? (toNum(workout?.tempo?.valueSec) != null ? toNum(workout.tempo.valueSec) / 60 : null);
    if (prev != null && cur != null) {
      if (phaseKey !== "TAPER" && cur + 0.5 < prev) penalize(10, "REGRESSIVE_TEMPO_LOAD", "Tempo work regresses from previous non-taper workout.");
      else if (phaseKey !== "TAPER" && cur <= prev + 4) reward(5, "Tempo progression is controlled.");
    }
  }

  if (garminCompatible(workout)) reward(8, "Workout has Garmin-compatible structure.");
  else penalize(20, "GARMIN_INCOMPATIBLE", "Workout lacks executable structure for Garmin rendering.");

  const knownInSpec = Object.values(spec?.workouts || {})
    .flatMap((byPhase) => Object.values(byPhase || {}).flat())
    .some((x) => (typeof x === "string" ? x : x?.id) === workoutId);
  if (knownInSpec) reward(5, "Workout is present in distance spec pool.");

  return {
    workoutId,
    score: clamp(Math.round(score), 0, 140),
    reasons,
    penalties,
  };
}

export function pickBestScoredWorkout({
  candidates = [],
  buildWorkout,
  family,
  phase,
  weekIndex,
  profile,
  targetSessionKm,
  recentWorkoutIds,
  spec,
  previousWorkout = null,
} = {}) {
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map((x) => (typeof x === "string" ? { id: x } : x))
    .filter((x) => x && typeof x === "object" && x.id);
  if (!normalized.length || typeof buildWorkout !== "function") return null;

  const scored = normalized.map((candidate, index) => {
    const workout = buildWorkout(candidate);
    const result = scoreWorkoutCandidate({
      workoutId: candidate.id,
      family,
      phase,
      weekIndex,
      profile,
      targetSessionKm,
      recentWorkoutIds,
      spec,
      workout,
      previousWorkout,
    });
    return { candidate, workout, ...result, tieBreaker: index };
  });

  scored.sort((a, b) => b.score - a.score || a.tieBreaker - b.tieBreaker);
  const selected = scored[0] || null;
  if (!selected || selected.score < 45) return null;

  return {
    picked: selected.candidate,
    workout: selected.workout,
    score: selected.score,
    workoutSelectionTrace: {
      selectedWorkoutId: selected.workoutId,
      score: selected.score,
      rejectedCandidates: scored.slice(1).map((s) => ({
        workoutId: s.workoutId,
        score: s.score,
        penalties: s.penalties,
      })),
      reasons: selected.reasons,
      penalties: selected.penalties,
    },
  };
}
