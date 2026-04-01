// server/lib/train/planRules/workouts/longRunWorkouts.js
//
// Long-run “details” + workout steps (deterministic).
//
// ✅ ALWAYS returns: { variant, keyTargets, notes, workout }
// ✅ Respects progression signals from targets.progression:
//    - qualityOnLongRun
//    - longQualityLevel (0..3+)
// ✅ Safe guardrails for deload/taper/low volume/return-from-injury.
//
// Output workout format is Garmin-friendly:
// workout: { kind:"LONG", sport:"running", variant, estimatedDistanceMeters, steps:[...] }
//
// ✅ NOTE (Option A contract):
// This file does NOT try to “budget” warmup/cooldown into km.
// plannedDistanceKm remains the full run distance; warm/cool are time steps only.

import {
  normaliseExperienceKey,
  normaliseGoalDistanceKey,
} from "../normalization.js";
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getWeeklyKm(profile = {}) {
  return toNum(profile?.weeklyKm) ?? 0;
}

function normExperience(profile = {}) {
  return normaliseExperienceKey(profile?.experienceKey);
}

function normGoalDistance(profile = {}, goalDistanceOverride) {
  const raw = goalDistanceOverride || profile?.goalDistanceKey || "";
  return normaliseGoalDistanceKey(raw, {
    fallback: "GENERAL",
    allowGeneral: true,
    allowReturn: true,
  });
}

function getPhase(weekIndex, totalWeeks) {
  const w = Math.max(1, Number(weekIndex || 1));
  const tw = Math.max(1, Number(totalWeeks || 12));
  const p = w / tw;
  if (p <= 0.35) return "base";
  if (p <= 0.75) return "build";
  if (p <= 0.9) return "specific";
  return "taper";
}

function stablePick(weekIndex, salt = 0) {
  const w = Math.max(1, Number(weekIndex || 1));
  return (w * 7 + salt) % 13;
}

function estimateLongKm({ longKm, weeklyKm, profile }) {
  const lk = toNum(longKm);
  if (lk != null) return lk;
  const wk = toNum(weeklyKm) ?? getWeeklyKm(profile);
  return wk > 0 ? wk * 0.35 : 10;
}

function asWorkout({ km, variant, steps }) {
  const m = Math.round(Math.max(0, km) * 1000);
  return {
    kind: "LONG",
    sport: "running",
    variant,
    estimatedDistanceMeters: m,
    steps: Array.isArray(steps) ? steps : [],
  };
}

function warmupStep(min = 10) {
  return { stepType: "warmup", durationType: "time", durationValue: Math.round(min * 60), targetType: "none" };
}
function cooldownStep(min = 5) {
  return { stepType: "cooldown", durationType: "time", durationValue: Math.round(min * 60), targetType: "none" };
}

function easyTime(min) {
  return { stepType: "recovery", durationType: "time", durationValue: Math.round(min * 60), targetType: "none" };
}
function steadyTime(min) {
  return { stepType: "steady", durationType: "time", durationValue: Math.round(min * 60), targetType: "none" };
}
function tempoTime(min) {
  return { stepType: "tempo", durationType: "time", durationValue: Math.round(min * 60), targetType: "none" };
}

function easyDistanceKm(km) {
  return {
    stepType: "recovery",
    durationType: "distance",
    durationValue: Math.round(Math.max(0, km) * 1000),
    targetType: "none",
  };
}
function steadyDistanceKm(km) {
  return {
    stepType: "steady",
    durationType: "distance",
    durationValue: Math.round(Math.max(0, km) * 1000),
    targetType: "none",
  };
}
function tempoDistanceKm(km) {
  return {
    stepType: "tempo",
    durationType: "distance",
    durationValue: Math.round(Math.max(0, km) * 1000),
    targetType: "none",
  };
}

function ensureDistanceTotalKm(segmentsKm, totalKm) {
  const segs = (Array.isArray(segmentsKm) ? segmentsKm : []).map((x) => Math.max(0, Number(x || 0)));
  const sum = segs.reduce((a, x) => a + x, 0);
  const target = Math.max(0, Number(totalKm || 0));

  if (segs.length === 0) return [target];

  const diff = target - sum;
  if (Math.abs(diff) < 0.001) return segs;

  segs[0] = Math.max(0, segs[0] + diff);
  return segs;
}

function finishMinutesFromLongKm(lk) {
  if (lk < 10) return 0;
  if (lk < 12) return 8;
  if (lk < 14) return 10;
  if (lk < 16) return 12;
  if (lk < 18) return 15;
  if (lk < 21) return 18;
  if (lk < 24) return 22;
  return 25;
}

// ---------------------- base variants ----------------------

function buildEasyLongSteps({ km }) {
  const warm = 10;
  const cd = 5;
  return [warmupStep(warm), easyDistanceKm(km), cooldownStep(cd)];
}

function buildFastFinishSteps({ km, finishMin }) {
  const warm = 10;
  const cd = 5;
  return [
    warmupStep(warm),
    easyDistanceKm(km),
    ...(finishMin > 0 ? [tempoTime(finishMin)] : []),
    cooldownStep(cd),
  ];
}

function buildProgressionSteps({ km, progMin }) {
  const warm = 10;
  const cd = 5;
  if (progMin >= 10) {
    const steadyMin = Math.max(4, Math.round(progMin * 0.5));
    const tempoMin = Math.max(4, progMin - steadyMin);
    return [warmupStep(warm), easyDistanceKm(km), steadyTime(steadyMin), tempoTime(tempoMin), cooldownStep(cd)];
  }
  return [warmupStep(warm), easyDistanceKm(km), tempoTime(progMin), cooldownStep(cd)];
}

function blocksForSpecific({ goal, advanced, longQualityLevel = 1 }) {
  const lvl = Math.max(1, Math.min(3, Number(longQualityLevel) || 1));

  if (goal === "5K" || goal === "10K") {
    const reps = advanced ? 3 + (lvl - 1) : 3;
    return { reps, workMin: 4, recMin: 2, label: `${reps}×4 min steady (2 min easy)` };
  }
  if (goal === "HALF") {
    const reps = 3;
    const workMin = advanced ? 6 : 5;
    return { reps, workMin, recMin: 2, label: `${reps}×${workMin} min steady (2 min easy)` };
  }
  if (goal === "MARATHON") {
    const reps = 2;
    const workMin = advanced ? 12 : 10;
    return { reps, workMin, recMin: 3, label: `${reps}×${workMin} min steady (3 min easy)` };
  }
  if (goal === "ULTRA") {
    const reps = 2;
    const workMin = advanced ? 10 : 8;
    return { reps, workMin, recMin: 4, label: `${reps}×${workMin} min steady (4 min easy)` };
  }

  const reps = 2 + (advanced ? 1 : 0);
  const workMin = advanced ? 5 : 6;
  const recMin = advanced ? 2 : 3;
  return { reps, workMin, recMin, label: `${reps}×${workMin} min steady (${recMin} min easy)` };
}

function buildSteadyBlocksSteps({ km, blocks }) {
  const warm = 10;
  const cd = 5;

  const repeat = {
    stepType: "repeat",
    repeatCount: blocks.reps,
    steps: [steadyTime(blocks.workMin), ...(blocks.recMin > 0 ? [easyTime(blocks.recMin)] : [])],
  };

  return [warmupStep(warm), easyDistanceKm(km), repeat, cooldownStep(cd)];
}

// ---------------------- Integrated tempo builders ----------------------

function tempoFinishMinForLong({ lk, goal, longQualityLevel = 1, advanced }) {
  const lvl = clamp(Number(longQualityLevel || 1), 1, 4);
  const baseByLen =
    lk >= 28 ? 35 :
    lk >= 24 ? 30 :
    lk >= 21 ? 25 :
    lk >= 18 ? 22 :
    lk >= 16 ? 18 :
    lk >= 14 ? 15 :
    lk >= 12 ? 12 :
    10;

  const goalShift =
    goal === "MARATHON" ? +5 :
    goal === "ULTRA" ? +8 :
    goal === "HALF" ? +3 :
    (goal === "10K" || goal === "5K") ? -5 :
    0;

  const lvlShift = (lvl - 1) * 4;
  const advShift = advanced ? 3 : 0;

  const raw = baseByLen + goalShift + lvlShift + advShift;

  const cap =
    goal === "ULTRA" ? (advanced ? 45 : 40) :
    goal === "MARATHON" ? (advanced ? 40 : 35) :
    goal === "HALF" ? (advanced ? 35 : 30) :
    (advanced ? 25 : 20);

  return clamp(raw, 10, cap);
}

function buildLastTempoFinishSteps({ km, tempoMin, goal }) {
  const warm = 10;
  const cd = 5;

  const tempoKm =
    goal === "ULTRA" ? 3.0 :
    goal === "MARATHON" ? 2.5 :
    goal === "HALF" ? 2.0 :
    1.5;

  const [easyKmAdj, tempoKmAdj] = ensureDistanceTotalKm([Math.max(0, km - tempoKm), tempoKm], km);

  return [
    warmupStep(warm),
    easyDistanceKm(easyKmAdj),
    tempoDistanceKm(tempoKmAdj),
    tempoTime(tempoMin),
    cooldownStep(cd),
  ];
}

function buildAerobicThenTempoFinishSteps({ km, aerobicKm, tempoKm }) {
  const warm = 10;
  const cd = 5;

  const [aKm, tKm] = ensureDistanceTotalKm([aerobicKm, tempoKm], km);

  return [warmupStep(warm), easyDistanceKm(aKm), tempoDistanceKm(tKm), cooldownStep(cd)];
}

function buildTempoBlocksEvery30ishSteps({ km, longQualityLevel = 1 }) {
  const warm = 10;
  const cd = 5;
  const lvl = clamp(Number(longQualityLevel || 1), 1, 4);

  const chunkKm =
    km >= 26 ? 8 :
    km >= 21 ? 7 :
    km >= 18 ? 6 :
    5;

  const tempoBlockKm = clamp(1.2 + (lvl - 1) * 0.4, 1.2, 2.4);
  const maxBlocks =
    km >= 26 ? 3 :
    km >= 21 ? 3 :
    km >= 18 ? 2 :
    2;

  const blocks = clamp(1 + (lvl >= 3 ? 1 : 0), 1, maxBlocks);

  const segments = [];
  segments.push({ type: "easy", km: chunkKm });

  for (let i = 0; i < blocks; i++) {
    segments.push({ type: "tempo", km: tempoBlockKm });
    if (i < blocks - 1) segments.push({ type: "easy", km: chunkKm });
  }

  const used = segments.reduce((a, s) => a + s.km, 0);
  const rem = Math.max(0, km - used);
  if (rem > 0.01) segments.push({ type: "easy", km: rem });

  const fixed = ensureDistanceTotalKm(segments.map((s) => s.km), km);

  const steps = [warmupStep(warm)];
  fixed.forEach((k, idx) => {
    const t = segments[idx]?.type || "easy";
    if (k <= 0.01) return;
    steps.push(t === "tempo" ? tempoDistanceKm(k) : easyDistanceKm(k));
  });
  steps.push(cooldownStep(cd));
  return steps;
}

function buildAlternatingSteadyTempoMilesSteps({ km, longQualityLevel = 1, advanced }) {
  const warm = 10;
  const cd = 5;
  const lvl = clamp(Number(longQualityLevel || 1), 1, 4);

  const blockKm = 2.0;
  const targetPairs =
    km >= 24 ? (advanced ? 5 : 4) :
    km >= 21 ? 4 :
    km >= 18 ? 3 :
    3;

  const pairs = clamp(targetPairs + (lvl >= 3 ? 1 : 0), 3, 6);

  const segments = [];

  const preEasyKm = clamp(km * 0.45, 8, Math.max(8, km - pairs * blockKm * 2));
  segments.push({ type: "easy", km: preEasyKm });

  for (let i = 0; i < pairs; i++) {
    segments.push({ type: "steady", km: blockKm });
    segments.push({ type: "tempo", km: blockKm });
  }

  const used = segments.reduce((a, s) => a + s.km, 0);
  const rem = Math.max(0, km - used);
  if (rem > 0.01) segments.push({ type: "easy", km: rem });

  const fixed = ensureDistanceTotalKm(segments.map((s) => s.km), km);

  const steps = [warmupStep(warm)];
  fixed.forEach((k, idx) => {
    if (k <= 0.01) return;
    const t = segments[idx]?.type || "easy";
    if (t === "tempo") steps.push(tempoDistanceKm(k));
    else if (t === "steady") steps.push(steadyDistanceKm(k));
    else steps.push(easyDistanceKm(k));
  });
  steps.push(cooldownStep(cd));
  return steps;
}

// ---------------------- selection ----------------------

function pickVariant({
  phase,
  goal,
  wkKm,
  lk,
  advanced,
  newer,
  isDeload,
  inTaper,
  qualityOnLongRun,
  longQualityLevel,
  seed,
}) {
  if (goal === "RETURN" || wkKm < 16) return "EASY";
  if (isDeload) return "EASY_DELOAD";
  if (inTaper) return "EASY_TAPER";

  if (!qualityOnLongRun) return "EASY";

  const speedGoal = goal === "5K" || goal === "10K";
  const longGoal = goal === "HALF" || goal === "MARATHON" || goal === "ULTRA";

  const lvl = Math.max(0, Number(longQualityLevel || 0));

  if (phase === "base") {
    if (speedGoal) return "FAST_FINISH";
    return "PROGRESSION";
  }

  if (phase === "build") {
    if (longGoal && lk >= 14) return "AEROBIC_PLUS_TEMPO_FINISH";
    return "PROGRESSION";
  }

  if (phase === "specific") {
    const canDoQuality = !newer && lk >= 12 && wkKm >= 22;
    if (!canDoQuality) return "FAST_FINISH";

    if (longGoal) {
      const pick = (seed + lvl * 3) % 3;
      if (pick === 0) return "LAST_TEMPO_FINISH";
      if (pick === 1) return "TEMPO_BLOCKS_EVERY_30";
      return "ALT_STEADY_TEMPO_MILES";
    }

    return (speedGoal && !advanced) ? "FAST_FINISH" : "STEADY_BLOCKS";
  }

  return "EASY";
}

export function buildLongRunDetails({
  weekIndex,
  totalWeeks,
  isDeload = false,
  profile,
  longKm,
  weeklyKm,
  goalDistance,
  phase: phaseOverride,
  taperByRules,
  qualityOnLongRun = false,
  longQualityLevel = 0,
} = {}) {
  const w = Math.max(1, Number(weekIndex || 1));
  const tw = Math.max(1, Number(totalWeeks || profile?.planLengthWeeks || 12));

  const wkKm = toNum(weeklyKm) ?? getWeeklyKm(profile);
  const goal = normGoalDistance(profile, goalDistance);

  const exp = normExperience(profile);
  const advanced = exp === "advanced";
  const newer = exp === "new";

  const phase = String(phaseOverride || getPhase(w, tw)).toLowerCase();
  const lk = estimateLongKm({ longKm, weeklyKm: wkKm, profile });

  const inTaper = phase === "taper" || !!taperByRules;

  const salt =
    goal === "10K" || goal === "5K" ? 11 :
    goal === "HALF" || goal === "MARATHON" || goal === "ULTRA" ? 17 : 23;

  const seed = stablePick(w, salt) + (w * 31);

  const variant = pickVariant({
    phase,
    goal,
    wkKm,
    lk,
    advanced,
    newer,
    isDeload,
    inTaper,
    qualityOnLongRun: !!qualityOnLongRun,
    longQualityLevel,
    seed,
  });

  const finishMinBase = finishMinutesFromLongKm(lk);
  const finishMin = clamp(finishMinBase - (goal === "10K" || goal === "5K" ? 5 : 0), 0, advanced ? 25 : 18);

  let keyTargets = "Easy all the way";
  let notes = "Easy effort throughout. Keep it relaxed and comfortable.";
  let steps = buildEasyLongSteps({ km: lk });

  if (variant === "EASY_DELOAD") {
    keyTargets = "Keep it easy";
    notes = "Keep it easy — deload week.";
    steps = buildEasyLongSteps({ km: lk });
  } else if (variant === "EASY_TAPER") {
    keyTargets = "Easy, no heroics";
    notes = "Keep this long run comfortable and easy. No heroics.";
    steps = buildEasyLongSteps({ km: lk });
  } else if (variant === "FAST_FINISH") {
    const finishMinApplied = Math.max(8, finishMin);
    keyTargets = `Last ${finishMinApplied} min tempo`;
    notes = `Easy effort. Finish with last ${finishMinApplied} min at controlled tempo (not all-out).`;
    steps = buildFastFinishSteps({ km: lk, finishMin: finishMinApplied });
  } else if (variant === "PROGRESSION") {
    const progMin = clamp(finishMin + 5, 12, advanced ? 30 : 24);
    keyTargets = `Progress last ${progMin} min`;
    notes = `Easy effort. Progress the last ${progMin} min from steady into controlled tempo (no racing).`;
    steps = buildProgressionSteps({ km: lk, progMin });
  } else if (variant === "STEADY_BLOCKS") {
    const blocks = blocksForSpecific({
      goal,
      advanced,
      longQualityLevel: Math.max(1, Number(longQualityLevel) || 1),
    });
    keyTargets = blocks.label;
    notes = `Include ${blocks.label} in the middle. Otherwise easy. Keep it controlled (not threshold).`;
    steps = buildSteadyBlocksSteps({ km: lk, blocks });
  }

  if (variant === "LAST_TEMPO_FINISH") {
    const tempoMin = tempoFinishMinForLong({
      lk,
      goal,
      longQualityLevel: Math.max(1, Number(longQualityLevel) || 1),
      advanced,
    });
    keyTargets = `Tempo finish (last ${tempoMin} min)`;
    notes = `Mostly easy. Finish with ${tempoMin} min at tempo (strong aerobic, controlled). Not threshold.`;
    steps = buildLastTempoFinishSteps({ km: lk, tempoMin, goal });
  } else if (variant === "TEMPO_BLOCKS_EVERY_30") {
    const lvl = Math.max(1, Number(longQualityLevel) || 1);
    keyTargets = lvl >= 3 ? "Tempo blocks (2–3 blocks)" : "Tempo blocks (1–2 blocks)";
    notes = "Mostly easy. Add short tempo blocks spaced through the second half. Smooth and controlled (not threshold).";
    steps = buildTempoBlocksEvery30ishSteps({ km: lk, longQualityLevel: lvl });
  } else if (variant === "ALT_STEADY_TEMPO_MILES") {
    const lvl = Math.max(1, Number(longQualityLevel) || 1);
    keyTargets = "Alternating steady / tempo blocks";
    notes = "Easy early. In the second half, alternate steady and tempo blocks. Keep tempo controlled (not threshold).";
    steps = buildAlternatingSteadyTempoMilesSteps({ km: lk, longQualityLevel: lvl, advanced });
  } else if (variant === "AEROBIC_PLUS_TEMPO_FINISH") {
    const lvl = Math.max(1, Number(longQualityLevel) || 1);
    const tempoKm =
      goal === "ULTRA" ? clamp(3 + (lvl - 1) * 1.0, 3, 7) :
      goal === "MARATHON" ? clamp(3 + (lvl - 1) * 0.8, 3, 6) :
      goal === "HALF" ? clamp(2.5 + (lvl - 1) * 0.6, 2.5, 5) :
      clamp(2 + (lvl - 1) * 0.5, 2, 4);

    const aerobicKm = clamp(lk - tempoKm, 6, lk - 2);
    keyTargets = `${round1(tempoKm)} km @ tempo to finish`;
    notes = `Run ${round1(aerobicKm)} km easy, then finish with ${round1(tempoKm)} km at tempo (strong aerobic, controlled).`;
    steps = buildAerobicThenTempoFinishSteps({ km: lk, aerobicKm, tempoKm });
  }

  return {
    variant,
    keyTargets,
    notes,
    workout: asWorkout({ km: lk, variant, steps }),
  };
}
