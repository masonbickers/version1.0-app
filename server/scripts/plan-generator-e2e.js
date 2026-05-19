import assert from "node:assert/strict";
import express from "express";
import { createApp } from "../index.js";
import { applyRunPlanRules } from "../lib/train/planRules/index.js";
import { recalculateUpcomingWeeks } from "../lib/train/planRules/adaptiveWeeklyRecalculation.js";
import { scoreGoalRealism } from "../lib/train/planRules/goalRealism.js";
import { repairPlanAfterMissedSession } from "../lib/train/planRules/missedSessionRepair.js";
import { applyReadinessAdjustment } from "../lib/train/planRules/readinessAdjustment.js";
import { applyStrengthTrainingAwareness } from "../lib/train/planRules/strengthAwareness.js";
import { scoreWorkoutCandidate } from "../lib/train/planRules/workoutScoring.js";
import { runExpandedFinalValidation } from "../lib/train/planRules/validateAndRepair.js";
import { buildDynamicPaceModel } from "../lib/train/planRules/pacePhysiology.js";
import {
  applyPlanExplanationToPlan,
  buildPlanExplanation,
} from "../lib/train/planRules/planExplanation.js";
import { analyseRunSessionCompletion } from "../lib/train/sessionCompletion/sessionCompletionAnalysis.js";
import generateRunRouter from "../routes/generate-run.js";

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
    server.on("error", reject);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function postJson(baseUrl, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function makeProfile(overrides = {}) {
  const profile = {
    goal: {
      distance: "10K",
      planLengthWeeks: 8,
      targetDate: "2026-10-01",
    },
    current: {
      age: 32,
      experience: "Some experience",
      weeklyKm: 30,
      longestRunKm: 11,
    },
    availability: {
      sessionsPerWeek: 4,
      runDays: ["Tue", "Thu", "Sat", "Sun"],
      longRunDay: "Sun",
    },
    preferences: {
      difficulty: "balanced",
      metric: "distance",
      treadmill: false,
    },
    pacing: {
      recentRace: {
        distance: "10K",
        time: "50:00",
      },
    },
    hr: {
      resting: 52,
    },
  };

  return {
    ...profile,
    ...overrides,
    goal: { ...profile.goal, ...(overrides.goal || {}) },
    current: { ...profile.current, ...(overrides.current || {}) },
    availability: { ...profile.availability, ...(overrides.availability || {}) },
    preferences: { ...profile.preferences, ...(overrides.preferences || {}) },
    pacing: overrides.pacing === null ? undefined : { ...profile.pacing, ...(overrides.pacing || {}) },
    hr: overrides.hr === null ? undefined : { ...profile.hr, ...(overrides.hr || {}) },
  };
}

function createGeneratorHarness() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    req.user = { uid: "test-user" };
    next();
  });
  app.use("/generate-run", generateRunRouter);
  return app;
}

function assertGoalRealismLevel(label, expectedLevel, profile) {
  const result = scoreGoalRealism(profile);
  assert.equal(
    result.level,
    expectedLevel,
    `${label} expected ${expectedLevel}, got ${result.level}: ${JSON.stringify(result)}`
  );
  assert.ok(Number.isInteger(result.score), `${label} should include integer score`);
  assert.ok(Array.isArray(result.factors), `${label} should include factors`);
  return result;
}

function assertWorkoutScore(label, condition, score) {
  assert.ok(condition, `${label} failed: ${JSON.stringify(score)}`);
}

function flattenSteps(steps = []) {
  const out = [];
  const queue = Array.isArray(steps) ? [...steps] : [];
  while (queue.length) {
    const step = queue.shift();
    if (!step || typeof step !== "object") continue;
    if (step.stepType === "repeat" && Array.isArray(step.steps)) {
      queue.unshift(...step.steps);
      continue;
    }
    out.push(step);
  }
  return out;
}

function allPlanSteps(plan = {}) {
  return (Array.isArray(plan?.weeks) ? plan.weeks : [])
    .flatMap((week) => Array.isArray(week?.sessions) ? week.sessions : [])
    .flatMap((session) => flattenSteps(session?.workout?.steps));
}

function countSteadyTimeSteps(session = {}, seconds) {
  const countMatching = (steps = [], multiplier = 1) => (Array.isArray(steps) ? steps : []).reduce((sum, step) => {
    if (!step || typeof step !== "object") return sum;
    if (step.stepType === "repeat" && Array.isArray(step.steps)) {
      return sum + countMatching(step.steps, multiplier * Math.max(1, Number(step.repeatCount) || 1));
    }
    const type = String(step?.stepType || "").toLowerCase();
    const durationType = String(step?.durationType || "").toLowerCase();
    return sum + (type === "steady" && durationType === "time" && Number(step?.durationValue) === Number(seconds) ? multiplier : 0);
  }, 0);
  return countMatching(session?.workout?.steps);
}

function countSteadyDistanceSteps(session = {}, meters) {
  const countMatching = (steps = [], multiplier = 1) => (Array.isArray(steps) ? steps : []).reduce((sum, step) => {
    if (!step || typeof step !== "object") return sum;
    if (step.stepType === "repeat" && Array.isArray(step.steps)) {
      return sum + countMatching(step.steps, multiplier * Math.max(1, Number(step.repeatCount) || 1));
    }
    const type = String(step?.stepType || "").toLowerCase();
    const durationType = String(step?.durationType || "").toLowerCase();
    return sum + (type === "steady" && durationType === "distance" && Number(step?.durationValue) === Number(meters) ? multiplier : 0);
  }, 0);
  return countMatching(session?.workout?.steps);
}

function findSessionByRole(week = {}, role) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).find(
    (session) => String(session?.role || "").toLowerCase() === String(role || "").toLowerCase()
  );
}

function findDaySessionByRole(week = {}, role) {
  return (Array.isArray(week?.days) ? week.days : [])
    .flatMap((day) => Array.isArray(day?.sessions) ? day.sessions : [])
    .find((session) => String(session?.role || "").toLowerCase() === String(role || "").toLowerCase());
}

function runWorkoutScoringChecks() {
  const baseProfile = makeProfile({
    goal: { distance: "10K", targetTime: "47:00" },
    current: { experience: "Some experience", weeklyKm: 32, longestRunKm: 12 },
    pacing: { recentRace: { distance: "5K", time: "22:05" } },
  });
  const realisticProfile = { ...baseProfile, goalRealism: scoreGoalRealism(baseProfile) };
  const aggressiveBase = makeProfile({
    goal: { distance: "10K", targetTime: "41:00" },
    current: { experience: "Some experience", weeklyKm: 32, longestRunKm: 12 },
    pacing: { recentRace: { distance: "5K", time: "22:05" } },
  });
  const aggressiveProfile = { ...aggressiveBase, goalRealism: scoreGoalRealism(aggressiveBase) };
  const beginnerProfile = makeProfile({
    goal: { distance: "5K", targetTime: "29:00" },
    current: { experience: "New to running", weeklyKm: 14, longestRunKm: 5 },
    preferences: { difficulty: "easy", metric: "distance", treadmill: false },
  });

  const threshold10k = scoreWorkoutCandidate({
    workoutId: "t_10k_2x12min_threshold",
    family: "tempo",
    phase: "SPECIFIC",
    weekIndex: 7,
    profile: realisticProfile,
    targetSessionKm: 8,
    recentWorkoutIds: [],
    spec: { workouts: { tempo: { SPECIFIC: [{ id: "t_10k_2x12min_threshold" }] } } },
    workout: { meta: { workMin: 24, fidelityKeepRatio: 0.95 }, tempo: { valueSec: 1440 } },
  });
  const genericTempo = scoreWorkoutCandidate({
    workoutId: "t_5k_12min_tempo",
    family: "tempo",
    phase: "SPECIFIC",
    weekIndex: 7,
    profile: realisticProfile,
    targetSessionKm: 8,
    recentWorkoutIds: [],
    spec: {},
    workout: { meta: { workMin: 12, fidelityKeepRatio: 0.95 }, tempo: { valueSec: 720 } },
  });
  assertWorkoutScore("10K realistic target should prefer 10K threshold work", threshold10k.score > genericTempo.score, { threshold10k, genericTempo });

  const earlyHard = scoreWorkoutCandidate({
    workoutId: "w_10k_16x400_fast",
    family: "intervals",
    phase: "BASE",
    weekIndex: 1,
    profile: aggressiveProfile,
    targetSessionKm: 6,
    recentWorkoutIds: [],
    spec: {},
    workout: { meta: { planningTargetWorkM: 6400, achievedWorkM: 6400, fidelityKeepRatio: 1 }, blocks: [{}] },
  });
  assertWorkoutScore(
    "10K aggressive target should avoid early overload",
    earlyHard.penalties.some((p) => p.code === "TOO_INTENSE_FOR_GOAL_REALISM"),
    earlyHard
  );

  const beginnerHard = scoreWorkoutCandidate({
    workoutId: "w_5k_16x400_fast",
    family: "intervals",
    phase: "BUILD",
    weekIndex: 3,
    profile: beginnerProfile,
    targetSessionKm: 5,
    recentWorkoutIds: [],
    spec: {},
    workout: { meta: { planningTargetWorkM: 6400, achievedWorkM: 5000, fidelityKeepRatio: 0.78 }, blocks: [{}] },
  });
  assertWorkoutScore(
    "Beginner should not get advanced interval sessions",
    beginnerHard.penalties.some((p) => p.code === "TOO_INTENSE_FOR_BEGINNER"),
    beginnerHard
  );

  const taperHeavy = scoreWorkoutCandidate({
    workoutId: "w_10k_16x400_fast",
    family: "intervals",
    phase: "TAPER",
    weekIndex: 8,
    profile: realisticProfile,
    targetSessionKm: 5,
    recentWorkoutIds: [],
    spec: {},
    workout: { meta: { planningTargetWorkM: 6400, achievedWorkM: 5200, fidelityKeepRatio: 0.81 }, blocks: [{}] },
  });
  assertWorkoutScore(
    "Taper week should choose lighter sharper work",
    taperHeavy.penalties.some((p) => p.code === "TOO_HEAVY_FOR_TAPER"),
    taperHeavy
  );

  const repeat = scoreWorkoutCandidate({
    workoutId: "t_10k_3x10min",
    family: "tempo",
    phase: "BUILD",
    weekIndex: 5,
    profile: realisticProfile,
    targetSessionKm: 8,
    recentWorkoutIds: ["t_10k_3x10min"],
    spec: {},
    workout: { meta: { workMin: 30, fidelityKeepRatio: 0.95 }, tempo: { valueSec: 1800 } },
  });
  assertWorkoutScore("Same workout should not repeat too closely", repeat.penalties.some((p) => p.code === "RECENT_REPEAT"), repeat);

  const trimmed = scoreWorkoutCandidate({
    workoutId: "t_10k_3x10min",
    family: "tempo",
    phase: "BUILD",
    weekIndex: 5,
    profile: realisticProfile,
    targetSessionKm: 4,
    recentWorkoutIds: [],
    spec: {},
    workout: { meta: { workMin: 12, fidelityKeepRatio: 0.45 }, tempo: { valueSec: 720 } },
  });
  assertWorkoutScore(
    "Small session budget should avoid heavy trimming",
    trimmed.penalties.some((p) => p.code === "EXCESSIVE_TRIMMING" || p.code === "SESSION_BUDGET_FIT"),
    trimmed
  );
}

function makeRepairPlan({ taper = false } = {}) {
  return {
    id: "repair-fixture",
    weeks: [
      {
        weekIndex: 1,
        weekNumber: 1,
        phase: taper ? "TAPER" : "BUILD",
        sessions: [
          { sessionId: "w1_tue_easy", day: "Tue", type: "EASY", name: "Easy run", plannedDistanceKm: 6, distanceKm: 6 },
          { sessionId: "w1_wed_quality", day: "Wed", type: "INTERVALS", name: taper ? "Race-week tune-up" : "Intervals", plannedDistanceKm: 7, distanceKm: 7, keyTargets: taper ? "Race sharpener" : "Intervals" },
          { sessionId: "w1_sun_long", day: "Sun", type: "LONG", name: "Long run", plannedDistanceKm: 14, distanceKm: 14 },
        ],
        metrics: { targetWeeklyKm: 27, plannedWeeklyKm: 27 },
      },
      {
        weekIndex: 2,
        weekNumber: 2,
        phase: "BUILD",
        sessions: [
          { sessionId: "w2_tue_quality", day: "Tue", type: "THRESHOLD", name: "Threshold", plannedDistanceKm: 8, distanceKm: 8 },
          { sessionId: "w2_thu_easy", day: "Thu", type: "EASY", name: "Easy run", plannedDistanceKm: 7, distanceKm: 7 },
          { sessionId: "w2_sun_long", day: "Sun", type: "LONG", name: "Long run", plannedDistanceKm: 16, distanceKm: 16 },
        ],
        metrics: { targetWeeklyKm: 31, plannedWeeklyKm: 31 },
      },
    ],
  };
}

function runMissedSessionRepairChecks() {
  const profile = makeProfile();

  const missedEasy = repairPlanAfterMissedSession({
    plan: makeRepairPlan(),
    missedSession: { sessionId: "w1_tue_easy" },
    profile,
  });
  assert.equal(missedEasy.repairType, "skip_easy", "missed easy run should be skipped");
  assert.equal(missedEasy.plan.weeks[0].sessions[0].status, "skipped");

  const missedQuality = repairPlanAfterMissedSession({
    plan: makeRepairPlan(),
    missedSession: { sessionId: "w1_wed_quality" },
    profile,
  });
  assert.notEqual(
    missedQuality.plan.weeks[0].sessions.find((s) => s.sessionId === "w1_wed_quality")?.day,
    "Thu",
    "missed quality should not be moved next to another hard/long day"
  );
  assert.ok(
    ["skip_quality", "move_quality", "safe_sharpener"].includes(missedQuality.repairType),
    `unexpected quality repair ${missedQuality.repairType}`
  );

  const missedLong = repairPlanAfterMissedSession({
    plan: makeRepairPlan(),
    missedSession: { sessionId: "w1_sun_long" },
    profile,
  });
  const nextLong = missedLong.plan.weeks[1].sessions.find((s) => s.sessionId === "w2_sun_long");
  assert.equal(missedLong.repairType, "reduce_next_long_run", "missed long run should reduce next long run");
  assert.ok(nextLong.plannedDistanceKm < 16, "next long run should be reduced");

  const multiple = repairPlanAfterMissedSession({
    plan: makeRepairPlan(),
    missedSessionIds: ["w1_tue_easy", "w1_wed_quality"],
    profile,
  });
  assert.equal(multiple.repairType, "recovery_week", "multiple missed sessions should trigger recovery week");
  assert.equal(multiple.plan.weeks[1].phase, "RECOVERY");
  assert.ok(multiple.plan.weeks[1].sessions.every((s) => s.plannedDistanceKm <= 13), "recovery week should reduce load");

  const taper = repairPlanAfterMissedSession({
    plan: makeRepairPlan({ taper: true }),
    missedSession: { sessionId: "w1_wed_quality" },
    profile,
  });
  const taperSession = taper.plan.weeks[0].sessions.find((s) => s.sessionId === "w1_wed_quality");
  assert.equal(taper.repairType, "safe_sharpener", "missed taper session should become safe sharpener");
  assert.equal(taperSession.type, "EASY");
  assert.ok(taperSession.plannedDistanceKm < 7, "taper repair should not catch up full load");
}

function makeReadinessPlan({ taper = false, completedFirst = false, raceFirst = false } = {}) {
  return {
    id: "readiness-fixture",
    weeks: [
      {
        weekIndex: 1,
        weekNumber: 1,
        phase: taper ? "TAPER" : "BUILD",
        sessions: [
          {
            sessionId: "w1_tue_hard",
            day: "Tue",
            type: raceFirst ? "RACE" : "INTERVALS",
            name: raceFirst ? "10K race" : "Intervals",
            plannedDistanceKm: raceFirst ? 10 : 8,
            distanceKm: raceFirst ? 10 : 8,
            status: completedFirst ? "completed" : undefined,
          },
          { sessionId: "w1_thu_easy", day: "Thu", type: "EASY", name: "Easy", plannedDistanceKm: 6, distanceKm: 6 },
          { sessionId: "w1_sun_long", day: "Sun", type: "LONG", name: "Long", plannedDistanceKm: 14, distanceKm: 14 },
        ],
        metrics: { targetWeeklyKm: raceFirst ? 30 : 28, plannedWeeklyKm: raceFirst ? 30 : 28 },
      },
      {
        weekIndex: 2,
        weekNumber: 2,
        phase: "BUILD",
        sessions: [
          { sessionId: "w2_tue_hard", day: "Tue", type: "THRESHOLD", name: "Threshold", plannedDistanceKm: 8, distanceKm: 8 },
          { sessionId: "w2_thu_easy", day: "Thu", type: "EASY", name: "Easy", plannedDistanceKm: 7, distanceKm: 7 },
        ],
        metrics: { targetWeeklyKm: 15, plannedWeeklyKm: 15 },
      },
    ],
  };
}

function runReadinessAdjustmentChecks() {
  const profile = makeProfile();

  const high = applyReadinessAdjustment({ plan: makeReadinessPlan(), profile, readiness: { score: 92 } });
  assert.equal(high.readinessAdjustment.level, "high");
  assert.equal(high.readinessAdjustment.applied, false, "high readiness should leave plan unchanged");

  const moderate = applyReadinessAdjustment({ plan: makeReadinessPlan(), profile, readiness: { score: 62 } });
  assert.equal(moderate.readinessAdjustment.level, "moderate");
  assert.equal(moderate.plan.weeks[0].sessions[0].type, "INTERVALS");
  assert.ok(moderate.plan.weeks[0].sessions[0].plannedDistanceKm < 8, "moderate readiness should reduce quality volume");

  const low = applyReadinessAdjustment({ plan: makeReadinessPlan(), profile, readiness: { score: 45 } });
  assert.equal(low.readinessAdjustment.level, "low");
  assert.equal(low.plan.weeks[0].sessions[0].type, "EASY", "low readiness should change next hard session to easy");

  const veryLow = applyReadinessAdjustment({ plan: makeReadinessPlan(), profile, readiness: { score: 25 } });
  assert.equal(veryLow.readinessAdjustment.level, "very_low");
  assert.equal(veryLow.plan.weeks[0].sessions[0].type, "RECOVERY", "very low readiness should change next hard session to recovery");

  const injury = applyReadinessAdjustment({ plan: makeReadinessPlan(), profile, readiness: { score: 85, injuryPain: true } });
  assert.equal(injury.readinessAdjustment.level, "very_low", "injury pain should override score");
  assert.equal(injury.plan.weeks[0].sessions[0].type, "RECOVERY");

  const race = applyReadinessAdjustment({ plan: makeReadinessPlan({ raceFirst: true }), profile, readiness: { score: 25 } });
  assert.equal(race.plan.weeks[0].sessions[0].type, "RACE", "race day should never be modified");
  assert.equal(race.plan.weeks[1].sessions[0].type, "RECOVERY", "next non-race hard session can be modified");

  const completed = applyReadinessAdjustment({ plan: makeReadinessPlan({ completedFirst: true }), profile, readiness: { score: 25 } });
  assert.equal(completed.plan.weeks[0].sessions[0].type, "INTERVALS", "completed session should not be modified");
  assert.equal(completed.plan.weeks[1].sessions[0].type, "RECOVERY", "next incomplete hard session can be modified");

  const taper = applyReadinessAdjustment({ plan: makeReadinessPlan({ taper: true }), profile, readiness: { score: 45 } });
  assert.equal(taper.readinessAdjustment.level, "low");
  assert.equal(taper.plan.weeks[0].sessions[0].type, "INTERVALS", "taper low readiness should reduce, not convert to extra training");
  assert.ok(taper.plan.weeks[0].sessions[0].plannedDistanceKm < 8, "taper week should be adjusted conservatively");
}

function makeStrengthPlan({ completed = false, race = false, easyOnly = false } = {}) {
  return {
    id: "strength-fixture",
    weeks: [
      {
        weekIndex: 1,
        weekNumber: 1,
        phase: "BUILD",
        sessions: easyOnly
          ? [
              { sessionId: "w1_tue_easy", day: "Tue", type: "EASY", name: "Easy", plannedDistanceKm: 6, distanceKm: 6 },
            ]
          : [
              {
                sessionId: "w1_wed_hard",
                day: "Wed",
                type: race ? "RACE" : "INTERVALS",
                name: race ? "10K race" : "Intervals",
                plannedDistanceKm: race ? 10 : 8,
                distanceKm: race ? 10 : 8,
                status: completed ? "completed" : undefined,
              },
              { sessionId: "w1_thu_hard", day: "Thu", type: "THRESHOLD", name: "Threshold", plannedDistanceKm: 8, distanceKm: 8 },
              { sessionId: "w1_sun_long", day: "Sun", type: "LONG", name: "Long", plannedDistanceKm: 16, distanceKm: 16 },
            ],
        metrics: { targetWeeklyKm: easyOnly ? 6 : 32, plannedWeeklyKm: easyOnly ? 6 : 32 },
      },
    ],
  };
}

function runStrengthAwarenessChecks() {
  const baseStrength = {
    enabled: true,
    sessionsPerWeek: 4,
    days: ["MONDAY", "TUESDAY", "THURSDAY", "SATURDAY"],
    lowerBodyDays: ["TUESDAY", "SATURDAY"],
    heavyLowerBodyDays: ["TUESDAY"],
    hyroxDays: ["THURSDAY"],
    priority: "hybrid",
  };
  const profile = makeProfile({ current: { experience: "Some experience" } });
  const advanced = makeProfile({ current: { experience: "Advanced/competitive" }, preferences: { difficulty: "hard", metric: "distance", treadmill: false } });

  const intervals = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan(),
    profile,
    strengthTraining: baseStrength,
  });
  const intervalSession = intervals.plan.weeks[0].sessions.find((s) => s.sessionId === "w1_wed_hard");
  assert.ok(intervals.strengthAdjustment.applied, "heavy legs before intervals should apply adjustment");
  assert.ok(intervalSession.day !== "Wed" || intervalSession.plannedDistanceKm < 8, "heavy legs before intervals should move or reduce intervals");

  const longRun = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan(),
    profile,
    strengthTraining: { ...baseStrength, heavyLowerBodyDays: ["SATURDAY"], hyroxDays: [] },
  });
  const longSession = longRun.plan.weeks[0].sessions.find((s) => s.sessionId === "w1_sun_long");
  assert.ok(longRun.strengthAdjustment.applied, "heavy legs before long run should apply adjustment");
  assert.ok(longSession.day !== "Sun" || longSession.plannedDistanceKm < 16, "heavy legs before long run should move or reduce long run");

  const upperOnly = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan({ easyOnly: true }),
    profile,
    strengthTraining: { enabled: true, sessionsPerWeek: 2, days: ["TUESDAY"], lowerBodyDays: [], heavyLowerBodyDays: [], hyroxDays: [], priority: "hybrid" },
  });
  assert.equal(upperOnly.strengthAdjustment.applied, false, "upper body should not affect easy run");

  const hyroxIntermediate = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan(),
    profile,
    strengthTraining: baseStrength,
  });
  const hyroxHard = hyroxIntermediate.plan.weeks[0].sessions.find((s) => s.sessionId === "w1_thu_hard");
  assert.ok(hyroxHard.day !== "Thu" || hyroxHard.plannedDistanceKm < 8, "Hyrox day should avoid extra hard run for non-advanced");

  const hyroxAdvanced = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan(),
    profile: advanced,
    strengthTraining: baseStrength,
  });
  const advancedThu = hyroxAdvanced.plan.weeks[0].sessions.find((s) => s.sessionId === "w1_thu_hard");
  assert.equal(advancedThu.day, "Thu", "advanced hybrid can keep controlled double day");
  assert.equal(advancedThu.plannedDistanceKm, 8);

  const runningPriority = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan(),
    profile,
    strengthTraining: { ...baseStrength, priority: "running" },
  });
  assert.ok(
    runningPriority.strengthAdjustment.changes.some((c) => c.type === "reduce_run"),
    "running priority should move strength conflict less aggressively and reduce run lightly"
  );

  const strengthPriority = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan(),
    profile,
    strengthTraining: { ...baseStrength, priority: "strength" },
  });
  assert.ok(
    strengthPriority.strengthAdjustment.changes.some((c) => c.type === "reduce_run"),
    "strength priority should reduce run instead of moving strength"
  );

  const completed = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan({ completed: true }),
    profile,
    strengthTraining: baseStrength,
  });
  assert.equal(completed.plan.weeks[0].sessions[0].day, "Wed", "completed sessions are never modified");
  assert.equal(completed.plan.weeks[0].sessions[0].plannedDistanceKm, 8);

  const race = applyStrengthTrainingAwareness({
    plan: makeStrengthPlan({ race: true }),
    profile,
    strengthTraining: baseStrength,
  });
  assert.equal(race.plan.weeks[0].sessions[0].type, "RACE", "race day is never modified");
  assert.equal(race.plan.weeks[0].sessions[0].plannedDistanceKm, 10);
}

function makeWeeklyRecalcPlan({ taper = false, race = false, completedFirst = false } = {}) {
  return {
    id: "weekly-recalc-fixture",
    weeks: [
      {
        weekIndex: 1,
        weekNumber: 1,
        phase: "BUILD",
        sessions: [
          { sessionId: "w1_tue_hard", day: "Tue", type: "INTERVALS", name: "Intervals", plannedDistanceKm: 8, distanceKm: 8 },
          { sessionId: "w1_thu_easy", day: "Thu", type: "EASY", name: "Easy", plannedDistanceKm: 6, distanceKm: 6 },
          { sessionId: "w1_sun_long", day: "Sun", type: "LONG", name: "Long", plannedDistanceKm: 14, distanceKm: 14 },
        ],
        metrics: { targetWeeklyKm: 28, plannedWeeklyKm: 28 },
      },
      {
        weekIndex: 2,
        weekNumber: 2,
        phase: taper ? "TAPER" : "BUILD",
        sessions: [
          {
            sessionId: "w2_tue_hard",
            day: "Tue",
            type: race ? "RACE" : "THRESHOLD",
            name: race ? "10K race" : "Threshold",
            plannedDistanceKm: race ? 10 : 9,
            distanceKm: race ? 10 : 9,
            status: completedFirst ? "completed" : undefined,
          },
          { sessionId: "w2_thu_easy", day: "Thu", type: "EASY", name: "Easy", plannedDistanceKm: 8, distanceKm: 8 },
          { sessionId: "w2_sun_long", day: "Sun", type: "LONG", name: "Long", plannedDistanceKm: 11, distanceKm: 11 },
        ],
        metrics: { targetWeeklyKm: race ? 29 : 28, plannedWeeklyKm: race ? 29 : 28 },
      },
    ],
  };
}

function outcomeRows({ actual = [8, 6, 14], statuses = ["completed", "completed", "completed"] } = {}) {
  const base = [
    { sessionId: "w1_tue_hard", type: "INTERVALS", plannedDistanceKm: 8 },
    { sessionId: "w1_thu_easy", type: "EASY", plannedDistanceKm: 6 },
    { sessionId: "w1_sun_long", type: "LONG", plannedDistanceKm: 14 },
  ];
  return base.map((row, index) => ({
    ...row,
    status: statuses[index],
    actualDistanceKm: actual[index],
  }));
}

function runWeeklyRecalculationChecks() {
  const profile = makeProfile();

  const low = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [2, 0, 0], statuses: ["completed", "skipped", "skipped"] }),
  });
  assert.equal(low.weeklyRecalculation.decision, "recovery_rebuild", "low completion should trigger rebuild");
  assert.equal(low.plan.weeks[1].phase, "RECOVERY");

  const medium = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [5, 5, 8], statuses: ["completed", "completed", "completed"] }),
  });
  assert.equal(medium.weeklyRecalculation.decision, "hold_volume_reduce_quality", "medium completion should hold volume and reduce quality");
  assert.ok(medium.plan.weeks[1].sessions[0].plannedDistanceKm < 9);

  const good = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [8, 6, 12], statuses: ["completed", "completed", "completed"] }),
  });
  assert.equal(good.weeklyRecalculation.decision, "continue", "good completion should continue plan");
  assert.equal(good.weeklyRecalculation.applied, false);

  const over = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [12, 9, 18], statuses: ["completed", "completed", "completed"] }),
  });
  assert.equal(over.weeklyRecalculation.decision, "cap_after_overcompletion", "over-completion should cap next week");
  assert.ok(over.plan.weeks[1].sessions[0].plannedDistanceKm < 9);

  const missedQuality = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [0, 6, 14], statuses: ["skipped", "completed", "completed"] }),
  });
  assert.notEqual(missedQuality.plan.weeks[1].sessions[0].type, "THRESHOLD", "missed quality should not stack quality next week");

  const missedLong = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [8, 6, 0], statuses: ["completed", "completed", "skipped"] }),
  });
  const nextLong = missedLong.plan.weeks[1].sessions.find((s) => s.sessionId === "w2_sun_long");
  assert.ok(nextLong.plannedDistanceKm < 11, "missed long run should reduce next long run");

  const taper = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan({ taper: true }),
    profile,
    completedSessions: outcomeRows({ actual: [5, 5, 8], statuses: ["completed", "completed", "completed"] }),
  });
  assert.equal(taper.plan.weeks[1].phase, "TAPER", "taper week phase should be protected");
  assert.ok(taper.plan.weeks[1].sessions[0].plannedDistanceKm >= 8, "taper adjustment should be conservative");

  const race = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan({ race: true }),
    profile,
    completedSessions: outcomeRows({ actual: [2, 0, 0], statuses: ["completed", "skipped", "skipped"] }),
  });
  assert.equal(race.plan.weeks[1].sessions[0].type, "RACE", "race day should be protected");
  assert.equal(race.plan.weeks[1].sessions[0].plannedDistanceKm, 10);

  const completed = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan({ completedFirst: true }),
    profile,
    completedSessions: outcomeRows({ actual: [2, 0, 0], statuses: ["completed", "skipped", "skipped"] }),
  });
  assert.equal(completed.plan.weeks[1].sessions[0].type, "THRESHOLD", "completed sessions should be untouched");
  assert.equal(completed.plan.weeks[1].sessions[0].plannedDistanceKm, 9);

  const highScores = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [8, 6, 14] }).map((row) => ({
      ...row,
      completionAnalysis: {
        status: "completed",
        completionScore: 98,
        volumeMatch: { status: "matched" },
        durationMatch: { status: "matched" },
        intensityMatch: { status: "matched" },
        notes: [],
        recommendations: [],
      },
    })),
  });
  assert.equal(highScores.weeklyRecalculation.completionAnalysisUsed, true, "completion analysis should be detected");
  assert.equal(highScores.weeklyRecalculation.decision, "continue", "high completion scores should not increase the plan");
  assert.equal(highScores.weeklyRecalculation.applied, false, "high completion scores should not cause plan changes");

  const overdoneEasy = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: [
      {
        sessionId: "w1_thu_easy",
        type: "EASY",
        plannedDistanceKm: 6,
        status: "completed",
        actualDistanceKm: 6,
        completionAnalysis: {
          status: "overdone",
          completionScore: 78,
          volumeMatch: { status: "matched" },
          durationMatch: { status: "matched" },
          intensityMatch: { status: "too_fast" },
          notes: ["Easy effort was faster than the planned easy range."],
          recommendations: ["Keep the next easy run genuinely easy to protect recovery."],
        },
      },
      {
        sessionId: "w1_extra_easy",
        weekIndex: 1,
        type: "EASY",
        plannedDistanceKm: 5,
        status: "completed",
        actualDistanceKm: 5,
        completionAnalysis: {
          status: "overdone",
          completionScore: 76,
          volumeMatch: { status: "matched" },
          durationMatch: { status: "matched" },
          intensityMatch: { status: "too_fast" },
          notes: ["Easy effort was faster than the planned easy range."],
          recommendations: ["Keep the next easy run genuinely easy to protect recovery."],
        },
      },
    ],
  });
  assert.equal(overdoneEasy.weeklyRecalculation.decision, "completion_guidance_warning", "repeated overdone easy runs should add guidance");
  assert.ok(
    overdoneEasy.weeklyRecalculation.completionDrivenChanges.some((change) => change.type === "slow_easy_guidance"),
    "overdone easy trend should be recorded as a completion-driven change"
  );
  assert.match(
    overdoneEasy.plan.weeks[1].sessions[1].executionTip,
    /slower end/i,
    "next easy run should tell the runner to use slower easy guidance"
  );

  const partialLongs = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: [
      {
        sessionId: "w1_sun_long",
        type: "LONG",
        plannedDistanceKm: 14,
        status: "completed",
        actualDistanceKm: 14,
        completionAnalysis: {
          status: "partial",
          completionScore: 78,
          volumeMatch: { status: "under" },
          durationMatch: { status: "matched" },
          intensityMatch: { status: "matched" },
          notes: ["Long run was shorter than planned."],
          recommendations: ["Keep the next long run controlled rather than forcing a full catch-up."],
        },
      },
      {
        sessionId: "w1_extra_long",
        weekIndex: 1,
        type: "LONG",
        plannedDistanceKm: 12,
        status: "completed",
        actualDistanceKm: 12,
        completionAnalysis: {
          status: "partial",
          completionScore: 76,
          volumeMatch: { status: "slightly_under" },
          durationMatch: { status: "matched" },
          intensityMatch: { status: "matched" },
          notes: ["Long run was shorter than planned."],
          recommendations: ["Keep the next long run controlled rather than forcing a full catch-up."],
        },
      },
    ],
  });
  assert.equal(partialLongs.weeklyRecalculation.decision, "completion_reduce_next_long_run", "repeated partial long runs should reduce next long run");
  assert.ok(partialLongs.plan.weeks[1].sessions[2].plannedDistanceKm < 11, "completion trend should reduce next long run");

  const mismatchedQuality = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: [
      {
        sessionId: "w1_tue_hard",
        type: "INTERVALS",
        plannedDistanceKm: 8,
        status: "completed",
        actualDistanceKm: 8,
        completionAnalysis: {
          status: "mismatched",
          completionScore: 82,
          volumeMatch: { status: "matched" },
          durationMatch: { status: "matched" },
          intensityMatch: { status: "missing_quality" },
          notes: ["The session was planned as quality work, but the completed activity shows little or no intensity work."],
          recommendations: ["Treat this as a partial quality session and avoid stacking the missed intensity into the next run."],
        },
      },
    ],
  });
  assert.equal(
    mismatchedQuality.weeklyRecalculation.decision,
    "completion_reduce_quality_after_mismatch",
    "mismatched quality should reduce next quality session"
  );
  assert.ok(mismatchedQuality.plan.weeks[1].sessions[0].plannedDistanceKm < 9, "quality mismatch should reduce next hard session");

  const fatigueWarning = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: [
      {
        sessionId: "w1_thu_easy",
        type: "EASY",
        plannedDistanceKm: 6,
        status: "completed",
        actualDistanceKm: 6,
        completionAnalysis: {
          status: "completed",
          completionScore: 82,
          volumeMatch: { status: "matched" },
          durationMatch: { status: "matched" },
          intensityMatch: { status: "matched", avgHr: 164, targetHrRange: { maxBpm: 150 } },
          notes: ["Average heart rate was much higher than expected for this session."],
          recommendations: ["Watch fatigue, heat, illness, or accumulated load before the next hard run."],
        },
      },
    ],
  });
  assert.equal(
    fatigueWarning.weeklyRecalculation.decision,
    "completion_reduce_quality_for_fatigue",
    "fatigue warning should reduce the next quality session"
  );
  assert.ok(fatigueWarning.plan.weeks[1].sessions[0].plannedDistanceKm < 9, "fatigue warning should reduce next hard session");

  const lowCompletionTrend = recalculateUpcomingWeeks({
    plan: makeWeeklyRecalcPlan(),
    profile,
    completedSessions: outcomeRows({ actual: [8, 6, 14] }).map((row, index) => ({
      ...row,
      completionAnalysis: {
        status: index === 0 ? "mismatched" : "partial",
        completionScore: [58, 64, 62][index],
        volumeMatch: { status: "matched" },
        durationMatch: { status: "matched" },
        intensityMatch: { status: index === 0 ? "missing_quality" : "matched" },
        notes: [],
        recommendations: [],
      },
    })),
  });
  assert.equal(lowCompletionTrend.weeklyRecalculation.decision, "completion_recovery_rebuild", "low completion score trend should trigger rebuild");
  assert.equal(lowCompletionTrend.plan.weeks[1].phase, "RECOVERY", "low completion score trend should apply recovery week");
  assert.ok(
    lowCompletionTrend.weeklyRecalculationTrace.some((entry) => entry.completionAnalysisUsed === true),
    "weekly recalculation trace should expose completion analysis usage"
  );
}

function finalValidationIssueCodes(result) {
  return [
    ...(result.validationSummary?.blockers || []),
    ...(result.validationSummary?.warnings || []),
  ].map((issue) => issue.code);
}

function makeFinalValidationPlan({ weeks = null } = {}) {
  return {
    id: "expanded-final-validation-fixture",
    weeks:
      weeks ||
      [
        {
          weekIndex: 1,
          weekNumber: 1,
          phase: "BUILD",
          sessions: [
            {
              sessionId: "w1_tue_quality",
              day: "Tue",
              type: "THRESHOLD",
              name: "Threshold",
              plannedDistanceKm: 8,
              distanceKm: 8,
              warmupMin: 10,
              cooldownMin: 8,
              targetPace: "10K effort",
            },
            { sessionId: "w1_thu_easy", day: "Thu", type: "EASY", name: "Easy", plannedDistanceKm: 6, distanceKm: 6 },
            { sessionId: "w1_sun_long", day: "Sun", type: "LONG", name: "Long", plannedDistanceKm: 14, distanceKm: 14 },
          ],
          metrics: { plannedWeeklyKm: 28, targetWeeklyKm: 28 },
        },
      ],
  };
}

function runExpandedFinalValidationChecks() {
  const profile = makeProfile();

  const overload = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            { sessionId: "o1", day: "Tue", type: "EASY", plannedDistanceKm: 5, distanceKm: 5 },
            { sessionId: "o2", day: "Sun", type: "LONG", plannedDistanceKm: 10, distanceKm: 10 },
          ],
        },
        {
          weekIndex: 2,
          phase: "BUILD",
          sessions: [
            { sessionId: "o3", day: "Tue", type: "INTERVALS", plannedDistanceKm: 10, distanceKm: 10, warmupMin: 10, cooldownMin: 8, targetPace: "5K" },
            { sessionId: "o4", day: "Wed", type: "THRESHOLD", plannedDistanceKm: 10, distanceKm: 10, warmupMin: 10, cooldownMin: 8, targetPace: "10K" },
            { sessionId: "o5", day: "Sun", type: "LONG", plannedDistanceKm: 22, distanceKm: 22 },
          ],
        },
      ],
    }),
    profile,
  });
  assert.ok(finalValidationIssueCodes(overload).includes("WEEKLY_RAMP_TOO_STEEP"), "adaptive overload should be capped");
  assert.ok(finalValidationIssueCodes(overload).includes("CONSECUTIVE_HARD_DAYS"), "back-to-back hard days should be repaired");

  const backToBack = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            { sessionId: "b1", day: "Tue", type: "INTERVALS", plannedDistanceKm: 7, distanceKm: 7, warmupMin: 10, cooldownMin: 8, targetPace: "5K" },
            { sessionId: "b2", day: "Wed", type: "THRESHOLD", plannedDistanceKm: 7, distanceKm: 7, warmupMin: 10, cooldownMin: 8, targetPace: "10K" },
            { sessionId: "b3", day: "Sun", type: "LONG", plannedDistanceKm: 12, distanceKm: 12 },
          ],
        },
      ],
    }),
    profile,
  });
  assert.equal(backToBack.plan.weeks[0].sessions[1].type, "EASY", "back-to-back hard day should become easy");

  const longShare = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            { sessionId: "l1", day: "Tue", type: "EASY", plannedDistanceKm: 4, distanceKm: 4 },
            { sessionId: "l2", day: "Thu", type: "EASY", plannedDistanceKm: 4, distanceKm: 4 },
            { sessionId: "l3", day: "Sun", type: "LONG", plannedDistanceKm: 22, distanceKm: 22 },
          ],
        },
      ],
    }),
    profile,
  });
  assert.ok(finalValidationIssueCodes(longShare).includes("LONG_RUN_SHARE_TOO_HIGH"), "long-run share should be flagged");
  assert.ok(longShare.plan.weeks[0].sessions[2].plannedDistanceKm < 22, "long run should be reduced");

  const taperHeavy = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "TAPER",
          sessions: [
            { sessionId: "t1", day: "Tue", type: "INTERVALS", plannedDistanceKm: 9, distanceKm: 9, warmupMin: 10, cooldownMin: 8, targetPace: "5K" },
            { sessionId: "t2", day: "Thu", type: "EASY", plannedDistanceKm: 5, distanceKm: 5 },
            { sessionId: "t3", day: "Sun", type: "RACE", plannedDistanceKm: 10, distanceKm: 10 },
          ],
        },
      ],
    }),
    profile,
  });
  assert.ok(finalValidationIssueCodes(taperHeavy).includes("TAPER_TOO_HEAVY"), "heavy taper should be reduced");
  assert.ok(taperHeavy.plan.weeks[0].sessions[0].plannedDistanceKm < 9, "taper quality should be reduced");

  const tooManyQuality = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            { sessionId: "q1", day: "Tue", type: "INTERVALS", plannedDistanceKm: 6, distanceKm: 6, warmupMin: 10, cooldownMin: 8, targetPace: "5K" },
            { sessionId: "q2", day: "Thu", type: "THRESHOLD", plannedDistanceKm: 6, distanceKm: 6, warmupMin: 10, cooldownMin: 8, targetPace: "10K" },
            { sessionId: "q3", day: "Sat", type: "TEMPO", plannedDistanceKm: 6, distanceKm: 6, warmupMin: 10, cooldownMin: 8, targetPace: "tempo" },
            { sessionId: "q4", day: "Sun", type: "LONG", plannedDistanceKm: 12, distanceKm: 12 },
          ],
        },
      ],
    }),
    profile,
  });
  assert.ok(finalValidationIssueCodes(tooManyQuality).includes("TOO_MANY_HARD_SESSIONS"), "too many quality sessions should be flagged");
  assert.equal(tooManyQuality.plan.weeks[0].sessions[2].type, "EASY", "third hard session should be replaced");

  const garminInvalid = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            {
              sessionId: "g1",
              day: "Tue",
              type: "INTERVALS",
              plannedDistanceKm: 8,
              distanceKm: 8,
              workout: { steps: Array.from({ length: 81 }, () => ({ type: "interval", target: "5K" })) },
            },
            { sessionId: "g2", day: "Sun", type: "LONG", plannedDistanceKm: 12, distanceKm: 12 },
          ],
        },
      ],
    }),
    profile,
  });
  const garminCodes = finalValidationIssueCodes(garminInvalid);
  assert.ok(garminCodes.includes("QUALITY_MISSING_WARM_COOL"), "missing warm-up should be repaired");
  assert.ok(garminCodes.includes("TOO_MANY_GARMIN_STEPS"), "excessive Garmin steps should be flagged");
  assert.equal(garminInvalid.plan.weeks[0].sessions[0].warmupMin, 10, "warm-up field should be inserted");

  const ultra = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            { sessionId: "u1", day: "Tue", type: "EASY", plannedDistanceKm: 8, distanceKm: 8 },
            { sessionId: "u2", day: "Sun", type: "LONG", plannedDistanceKm: 20, distanceKm: 20 },
          ],
        },
      ],
    }),
    profile: makeProfile({ goal: { distance: "Ultra", planLengthWeeks: 12 }, current: { weeklyKm: 45, longestRunKm: 20 } }),
  });
  assert.ok(finalValidationIssueCodes(ultra).includes("ULTRA_LONG_RUN_INSUFFICIENT"), "ultra plan should check time-on-feet");

  const marathonNoTaper = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: Array.from({ length: 8 }, (_, i) => ({
        weekIndex: i + 1,
        phase: "BUILD",
        sessions: [
          { sessionId: `m${i}_easy`, day: "Tue", type: "EASY", plannedDistanceKm: 8, distanceKm: 8 },
          { sessionId: `m${i}_long`, day: "Sun", type: i === 7 ? "RACE" : "LONG", plannedDistanceKm: i === 7 ? 42.2 : 18, distanceKm: i === 7 ? 42.2 : 18 },
        ],
      })),
    }),
    profile: makeProfile({ goal: { distance: "Marathon", planLengthWeeks: 8 }, current: { weeklyKm: 50, longestRunKm: 24 } }),
  });
  assert.ok(finalValidationIssueCodes(marathonNoTaper).includes("NO_TAPER_BEFORE_RACE"), "marathon race plan should require a taper");

  const beginner = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "BUILD",
          sessions: [
            { sessionId: "n1", day: "Tue", type: "INTERVALS", plannedDistanceKm: 6, distanceKm: 6, warmupMin: 10, cooldownMin: 8, targetPace: "5K" },
            { sessionId: "n2", day: "Sun", type: "LONG", plannedDistanceKm: 8, distanceKm: 8 },
          ],
        },
      ],
    }),
    profile: makeProfile({ current: { experience: "New to running", weeklyKm: 15, longestRunKm: 7 } }),
  });
  assert.ok(finalValidationIssueCodes(beginner).includes("BEGINNER_ADVANCED_INTENSITY"), "beginner advanced intensity should be repaired");
  assert.equal(beginner.plan.weeks[0].sessions[0].type, "EASY");

  const raceProtected = runExpandedFinalValidation({
    plan: makeFinalValidationPlan({
      weeks: [
        {
          weekIndex: 1,
          phase: "TAPER",
          sessions: [
            { sessionId: "r1", day: "Sun", type: "RACE", plannedDistanceKm: 10, distanceKm: 10 },
          ],
        },
      ],
    }),
    profile,
  });
  assert.equal(raceProtected.plan.weeks[0].sessions[0].type, "RACE", "race day should not be changed");
  assert.equal(raceProtected.plan.weeks[0].sessions[0].plannedDistanceKm, 10, "race distance should not be changed");
}

function runDynamicPaceModelChecks() {
  const recent5k = buildDynamicPaceModel({
    profile: makeProfile({
      goal: { distance: "10K", targetTime: "47:00" },
      pacing: { recentRace: { distance: "5K", time: "22:00" } },
    }),
  });
  assert.ok(recent5k.paceModel.confidence >= 80, "recent race should produce high pace confidence");
  assert.ok(
    recent5k.paceModel.raceEquivalents.tenK.timeSec > 44 * 60 &&
      recent5k.paceModel.raceEquivalents.tenK.timeSec < 47 * 60,
    `recent 5K should predict sensible 10K equivalent: ${JSON.stringify(recent5k.paceModel.raceEquivalents.tenK)}`
  );
  assert.ok(
    recent5k.paceModel.raceEquivalents.halfMarathon.timeSec > 100 * 60 &&
      recent5k.paceModel.raceEquivalents.halfMarathon.timeSec < 112 * 60,
    "recent 5K should predict sensible HM equivalent"
  );

  const aggressive = buildDynamicPaceModel({
    profile: makeProfile({
      goal: { distance: "10K", targetTime: "37:30" },
      pacing: { recentRace: { distance: "5K", time: "22:05" } },
    }),
    goalRealism: { level: "unsafe" },
  });
  assert.ok(
    aggressive.paceModel.raceEquivalents.tenK.paceSecPerKm > 245,
    "aggressive target should not override actual recent-race ability"
  );

  const normalReadiness = buildDynamicPaceModel({
    profile: makeProfile({ pacing: { recentRace: { distance: "10K", time: "45:00" } } }),
    readiness: { score: 85 },
  });
  const lowReadiness = buildDynamicPaceModel({
    profile: makeProfile({ pacing: { recentRace: { distance: "10K", time: "45:00" } } }),
    readiness: { score: 42 },
  });
  assert.ok(
    lowReadiness.paceModel.trainingPaces.threshold.minSecPerKm >
      normalReadiness.paceModel.trainingPaces.threshold.minSecPerKm,
    "low readiness should slow quality targets"
  );

  const trail = buildDynamicPaceModel({
    profile: makeProfile({ pacing: { recentRace: { distance: "10K", time: "45:00" } } }),
    environment: { terrain: "technical trail" },
  });
  assert.equal(trail.paceModel.adjustments.preferEffortTargets, true, "trail mode should avoid strict road pace targets");
  assert.equal(trail.paceModel.trainingPaces.threshold.targetMode, "effort_hr");

  const treadmill = buildDynamicPaceModel({
    profile: makeProfile({
      preferences: { treadmill: true },
      pacing: { recentRace: { distance: "10K", time: "45:00" } },
    }),
  });
  assert.ok(treadmill.paceModel.trainingPaces.easy.minKph > 0, "treadmill mode should include km/h speed");
  assert.ok(treadmill.paceModel.trainingPaces.interval.maxKph > treadmill.paceModel.trainingPaces.easy.maxKph);

  const treadmillProfile = makeProfile({
    preferences: { treadmill: true },
    pacing: { recentRace: { distance: "10K", time: "45:00" } },
  });
  const treadmillPlan = applyRunPlanRules(null, {
    ...treadmillProfile,
    paceModel: treadmill.paceModel,
    paceTrace: treadmill.paceTrace,
  });
  assert.ok(
    treadmillPlan.weeks[0].sessions.some((s) => s?.targetTreadmillKph || s?.workout?.treadmillSpeedKph),
    "generated treadmill sessions should expose km/h targets"
  );

  const trailPlan = applyRunPlanRules(null, {
    ...makeProfile({ pacing: { recentRace: { distance: "10K", time: "45:00" } } }),
    paceModel: trail.paceModel,
    paceTrace: trail.paceTrace,
  });
  const trailQuality = trailPlan.weeks.flatMap((w) => w.sessions || []).find((s) => ["INTERVALS", "TEMPO", "THRESHOLD"].includes(s.type));
  assert.ok(trailQuality, "trail fixture should include a quality session");
  assert.equal(trailQuality.targetPace, null, "trail quality session should avoid strict pace target");
  assert.ok(trailQuality.targetHr, "trail quality session should retain HR/effort target");

  const lowConfidence = buildDynamicPaceModel({
    profile: makeProfile({ pacing: null, current: { experience: "Some experience", age: 32 } }),
  });
  assert.ok(lowConfidence.paceModel.confidence < 50, "missing pace data should produce low confidence");
  assert.ok(
    lowConfidence.paceModel.trainingPaces.threshold.maxSecPerKm -
      lowConfidence.paceModel.trainingPaces.threshold.minSecPerKm >=
      20,
    "low-confidence pace data should return broad ranges"
  );

  const hrAnchored = buildDynamicPaceModel({
    profile: makeProfile({
      pacing: null,
      current: { age: 40 },
      hr: { lthr: 170 },
    }),
  });
  assert.equal(hrAnchored.paceModel.hrZones.method, "LTHR", "HR anchors should override age-only zones");
  assert.ok(hrAnchored.paceModel.hrZones.zones.z4.min >= 160, "LTHR z4 should be based on threshold HR");
}

function assertNoInternalExplanationWording(value, label) {
  const text = JSON.stringify(value);
  for (const forbidden of ["workoutSelectionTrace", "specPickId", "undefined", "NaN", "debug"]) {
    assert.equal(text.includes(forbidden), false, `${label} should not leak ${forbidden}`);
  }
}

function runPlanExplanationChecks() {
  const profile = makeProfile({
    goal: { distance: "10K", targetTime: "45:00" },
    current: { weeklyKm: 40, longestRunKm: 14, experience: "Regular runner" },
    availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
    pacing: { recentRace: { distance: "10K", time: "47:30" } },
  });
  const pace = buildDynamicPaceModel({ profile });
  const plan = applyRunPlanRules(null, {
    ...profile,
    paceModel: pace.paceModel,
    paceTrace: pace.paceTrace,
  });
  const explanation = buildPlanExplanation({
    plan,
    profile,
    goalRealism: {
      level: "challenging",
      message: "The goal is challenging relative to recent performances, so progression should stay controlled.",
    },
    paceModel: pace.paceModel,
    validationSummary: {
      blockers: [],
      warnings: [{ code: "LONG_RUN_SHARE_TOO_HIGH", message: "Long-run share was high." }],
      repairsApplied: [{ reason: "long_run_share_too_high" }],
      safetyScore: 86,
      approval: "approved_with_warnings",
    },
    readinessAdjustment: {
      applied: true,
      level: "low",
      message: "This week was reduced because readiness was low.",
    },
    strengthAdjustment: {
      applied: true,
      conflictsFound: 1,
      changes: [{ type: "move_quality" }],
    },
    weeklyRecalculation: {
      applied: true,
      completionRate: 0.7,
      message: "This week was reduced because your recent completion rate was below 75%.",
    },
  });

  assert.ok(explanation.planSummary, "plan includes summary");
  assert.ok(explanation.coachingSummary, "plan includes coaching summary");
  assert.ok(explanation.weeklyNotes.length === plan.weeks.length, "weeks include coach notes");
  assert.ok(explanation.weeklyNotes.every((w) => w.focus && w.coachNote && w.progressionReason), "weekly fields should be populated");
  assert.ok(explanation.sessionNotes.some((s) => /sustainable|speed|economy|quality/i.test(s.whyThisSession)), "quality sessions explain purpose");
  assert.ok(explanation.sessionNotes.some((s) => /endurance|fatigue/i.test(s.whyThisSession)), "long runs explain progression/purpose");
  assert.ok(
    explanation.keyDecisions.some((d) => /readiness|reduced/i.test(d)) ||
      explanation.riskNotes.some((d) => /readiness|reduced/i.test(d)),
    "readiness changes are explained"
  );
  assert.ok(
    explanation.keyDecisions.some((d) => /strength|lower-body|clash/i.test(d)),
    "strength conflicts are explained"
  );
  assert.ok(
    explanation.riskNotes.some((d) => /challenging|controlled/i.test(d)),
    "goal realism warning appears in user-friendly language"
  );
  assertNoInternalExplanationWording(explanation, "plan explanation");

  const enriched = applyPlanExplanationToPlan(plan, explanation);
  assert.ok(enriched.planExplanation?.planSummary, "enriched plan should carry explanation");
  assert.ok(enriched.weeks[0].focus, "week should include focus");
  assert.ok(enriched.weeks[0].coachNote, "week should include coachNote");
  assert.ok(enriched.weeks[0].progressionReason, "week should include progressionReason");
  assert.ok(enriched.weeks[0].sessions.every((s) => s.coachNote && s.executionTip && s.whyThisSession), "sessions should include coach fields");
  assertNoInternalExplanationWording({
    focus: enriched.weeks[0].focus,
    coachNote: enriched.weeks[0].coachNote,
    riskNote: enriched.weeks[0].riskNote,
    progressionReason: enriched.weeks[0].progressionReason,
    sessions: enriched.weeks[0].sessions.map((s) => ({
      coachNote: s.coachNote,
      executionTip: s.executionTip,
      whyThisSession: s.whyThisSession,
    })),
  }, "enriched plan notes");
}

function runSessionCompletionAnalysisChecks() {
  const paceModel = {
    trainingPaces: {
      easy: { minSecPerKm: 360, maxSecPerKm: 435 },
      threshold: { minSecPerKm: 250, maxSecPerKm: 270 },
      interval: { minSecPerKm: 230, maxSecPerKm: 245 },
      racePace: { valueSecPerKm: 300 },
    },
    hrZones: {
      zones: {
        z2: { minBpm: 130, maxBpm: 150 },
        z4: { minBpm: 160, maxBpm: 175 },
        z5: { minBpm: 176, maxBpm: 188 },
      },
    },
  };

  const easyPlanned = { type: "EASY", plannedDistanceKm: 6, plannedDurationSec: 2400 };
  const easyDone = analyseRunSessionCompletion({
    plannedSession: easyPlanned,
    completedActivity: { distanceKm: 6.1, movingTimeSec: 2460, avgHr: 142, type: "running" },
    paceModel,
  });
  assert.equal(easyDone.status, "completed", "easy run completed correctly should be completed");
  assert.equal(easyDone.volumeMatch.status, "matched", "easy run volume should match");
  assert.equal(easyDone.intensityMatch.status, "matched", "easy run intensity should match");
  assert.ok(easyDone.completionScore >= 90, "easy run completion score should be high");

  const easyFast = analyseRunSessionCompletion({
    plannedSession: easyPlanned,
    completedActivity: { distanceKm: 6, movingTimeSec: 1920, avgHr: 162, type: "running" },
    paceModel,
  });
  assert.equal(easyFast.status, "overdone", "easy run too fast should be marked overdone");
  assert.equal(easyFast.intensityMatch.status, "too_fast", "easy run too fast should flag intensity");
  assert.ok(easyFast.notes.some((note) => /faster/i.test(note)), "easy run too fast should include a warning note");
  assert.ok(easyFast.notes.some((note) => /heart rate/i.test(note)), "high HR should include a fatigue warning");

  const longPartial = analyseRunSessionCompletion({
    plannedSession: { type: "LONG", plannedDistanceKm: 14, plannedDurationSec: 5880 },
    completedActivity: { distanceKm: 9.8, movingTimeSec: 4200, avgHr: 145, type: "running" },
    paceModel,
  });
  assert.equal(longPartial.status, "partial", "long run too short should be partial");
  assert.equal(longPartial.volumeMatch.status, "under", "long run partial should flag under-volume");
  assert.ok(longPartial.recommendations.some((note) => /long run/i.test(note)), "long run partial should include a long-run recommendation");

  const qualityMissing = analyseRunSessionCompletion({
    plannedSession: { type: "THRESHOLD", plannedDistanceKm: 8, plannedDurationSec: 3300 },
    completedActivity: { distanceKm: 8.1, movingTimeSec: 3600, avgHr: 145, type: "running", qualityWorkSec: 0 },
    paceModel,
  });
  assert.equal(qualityMissing.status, "mismatched", "quality session without intensity should be mismatched");
  assert.equal(qualityMissing.intensityMatch.status, "missing_quality", "quality session should flag missing intensity work");
  assert.ok(qualityMissing.recommendations.some((note) => /avoid stacking/i.test(note)), "missing quality should warn against stacking work");

  const overdone = analyseRunSessionCompletion({
    plannedSession: easyPlanned,
    completedActivity: { distanceKm: 7.5, movingTimeSec: 3000, avgHr: 146, type: "running" },
    paceModel,
  });
  assert.equal(overdone.status, "overdone", "run above 120% distance should be overdone");
  assert.equal(overdone.volumeMatch.status, "excessive", "overdone run should flag excessive volume");

  const missed = analyseRunSessionCompletion({
    plannedSession: easyPlanned,
    completedActivity: null,
    paceModel,
  });
  assert.equal(missed.status, "missed", "missing activity should be missed");
  assert.equal(missed.completionScore, 0, "missed session score should be zero");
}

async function main() {
  const full = createApp();
  const fullServer = await listen(full.app);
  try {
    const health = await fetch(`${fullServer.baseUrl}/health`);
    assert.equal(health.status, 200, "health should be available without Firebase credentials");
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true, "health should report ok");

    const unauthorized = await postJson(
      fullServer.baseUrl,
      "/generate-run?summary=1",
      { athleteProfile: makeProfile() }
    );
    assert.equal(unauthorized.status, 401, "protected generator route should reject missing auth");
  } finally {
    await close(fullServer.server);
  }

  const harnessServer = await listen(createGeneratorHarness());
  try {
    const happy = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile({
          goal: { distance: "5K", planLengthWeeks: 8 },
          current: { experience: "Advanced/competitive" },
        }),
      }
    );
    assert.equal(happy.status, 200, `happy path failed: ${JSON.stringify(happy.data)}`);
    assert.equal(happy.data.ok, true, "happy path should return ok");
    assert.equal(happy.data.weeksCount, 8, "happy path should return requested plan length");
    assert.ok(happy.data.firstWeek?.sessions?.length === 4, "summary should expose first-week sessions");
    assert.ok(happy.data.professionalReview?.status, "summary should include professional review");
    assert.ok(happy.data.paceModel?.confidence, "summary should include dynamic pace model");
    assert.ok(Array.isArray(happy.data.paceTrace), "summary should include pace trace");
    assert.ok(happy.data.planExplanation?.planSummary, "summary should include plan explanation");
    assert.ok(happy.data.firstWeek?.coachNote, "summary first week should include coach note");
    assert.ok(happy.data.firstWeek?.sessions?.every((s) => s.coachNote && s.executionTip && s.whyThisSession), "summary sessions should include coach notes");
    assert.ok(happy.data.validationSummary?.approval, "summary should include final validation approval");
    assert.ok(Array.isArray(happy.data.validationTrace), "summary should include final validation trace");
    assert.ok(happy.data.planVersion, "summary should include planVersion");
    assert.ok(happy.data.rulesEngineVersion, "summary should include rulesEngineVersion");
    assert.equal(happy.data.templateVersion, null, "rules-engine summary should include null templateVersion");
    assert.ok(happy.data.generatedAt, "summary should include generatedAt");
    assert.ok(happy.data.inputProfileSnapshot?.goal?.distance, "summary should include inputProfileSnapshot");
    assert.ok(happy.data.generatorFeatures?.expandedFinalValidation, "summary should include generatorFeatures");
    assert.equal(happy.data.planSource, "rules_engine", "non-matching profile should use rules_engine source");

    const returnTemplateProfile = makeProfile({
      goal: { distance: "Return to running", planLengthWeeks: 6 },
      current: { experience: "New to running", weeklyKm: 3, longestRunKm: 1.5 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: null,
    });
    const returnTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: returnTemplateProfile }
    );
    assert.equal(returnTemplateResult.status, 200, `return template path failed: ${JSON.stringify(returnTemplateResult.data)}`);
    const returnTemplatePlan = returnTemplateResult.data?.plan;
    assert.equal(returnTemplatePlan?.planSource, "template", "return-to-running 6-week 3-run should use template source");
    assert.equal(returnTemplatePlan?.templateId, "return_6w_3run", "return template response should expose templateId");
    assert.equal(returnTemplatePlan?.weeks?.length, 6, "return template plan should have 6 weeks");
    assert.equal(returnTemplatePlan?.preserveTemplateStructure, true, "return template plan should preserve template structure");
    assert.ok(
      returnTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 3 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "return template should keep three preserved sessions per week"
    );
    assert.equal(
      returnTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS"].includes(session.type)),
      false,
      "return template should not include aggressive workout sessions"
    );
    const returnWeekOneEasy = findSessionByRole(returnTemplatePlan.weeks[0], "easy");
    assert.ok(returnWeekOneEasy, "return template Week 1 should include a run-walk easy session");
    assert.match(String(returnWeekOneEasy?.structure || returnWeekOneEasy?.summary || ""), /6\s*x\s*90\s*sec/i, "return Week 1 run-walk structure should survive intact");
    assert.equal(countSteadyTimeSteps(returnWeekOneEasy, 90), 6, "return Week 1 6x90sec easy run blocks should survive intact");
    assert.ok(Number(returnWeekOneEasy?.plannedDistanceKm) <= 2, "return Week 1 should stay very conservative");
    assert.doesNotMatch(JSON.stringify(returnTemplatePlan), /10\s*x\s*45|10x45|45s/i, "return template plan output should not contain a 10x45s legacy string");
    assert.ok(
      returnTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved return templates"
    );
    assert.ok(
      returnTemplatePlan.weeks.flatMap((week) => week.sessions).every((session) => session?.coachNote && session?.purpose && session?.executionTip),
      "return template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(returnTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to return template sessions");
    assert.ok(returnTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to return template sessions");
    assert.ok(returnTemplatePlan.validationSummary?.approval, "validation should still run for return template plan");

    const generalTemplateProfile = makeProfile({
      goal: { distance: "General fitness", planLengthWeeks: 8 },
      current: { experience: "New to running", weeklyKm: 8, longestRunKm: 3 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: null,
    });
    const generalTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: generalTemplateProfile }
    );
    assert.equal(generalTemplateResult.status, 200, `general fitness template path failed: ${JSON.stringify(generalTemplateResult.data)}`);
    const generalTemplatePlan = generalTemplateResult.data?.plan;
    assert.equal(generalTemplatePlan?.planSource, "template", "general fitness 8-week 3-run should use template source");
    assert.equal(generalTemplatePlan?.templateId, "general_8w_3run", "general template response should expose templateId");
    assert.equal(generalTemplatePlan?.weeks?.length, 8, "general template plan should have 8 weeks");
    assert.equal(generalTemplatePlan?.preserveTemplateStructure, true, "general template plan should preserve template structure");
    assert.ok(
      generalTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 3 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "general template should keep three preserved sessions per week"
    );
    assert.equal(
      generalTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACE"].includes(session.type)),
      false,
      "general template should not include race-specific or aggressive workout sessions"
    );
    const generalWeekTwoSupport = findSessionByRole(generalTemplatePlan.weeks[1], "support");
    assert.ok(generalWeekTwoSupport, "general template Week 2 should include a support run");
    assert.match(String(generalWeekTwoSupport?.structure || generalWeekTwoSupport?.summary || ""), /strides/i, "general Week 2 should include relaxed strides");
    const generalWeekThreeSupport = findSessionByRole(generalTemplatePlan.weeks[2], "support");
    assert.ok(generalWeekThreeSupport, "general template Week 3 should include light steady work");
    assert.equal(countSteadyTimeSteps(generalWeekThreeSupport, 300), 2, "general Week 3 2x5min light steady should survive intact");
    assert.doesNotMatch(JSON.stringify(generalTemplatePlan), /10\s*x\s*45|10x45|45s/i, "general template plan output should not contain a 10x45s legacy string");
    assert.ok(
      generalTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved general templates"
    );
    assert.ok(
      generalTemplatePlan.weeks.flatMap((week) => week.sessions).every((session) => session?.coachNote && session?.purpose && session?.executionTip),
      "general template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(generalTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to general template sessions");
    assert.ok(generalTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to general template sessions");
    assert.ok(generalTemplatePlan.validationSummary?.approval, "validation should still run for general template plan");

    const beginner5kTemplateProfile = makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8, targetTime: "32:00" },
      current: { experience: "New to running", weeklyKm: 12, longestRunKm: 4 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "5K", time: "32:00" } },
    });
    const beginner5kTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: beginner5kTemplateProfile }
    );
    assert.equal(beginner5kTemplateResult.status, 200, `5K beginner template path failed: ${JSON.stringify(beginner5kTemplateResult.data)}`);
    const beginner5kTemplatePlan = beginner5kTemplateResult.data?.plan;
    assert.equal(beginner5kTemplatePlan?.planSource, "template", "5K beginner 8-week 3-run should use template source");
    assert.equal(beginner5kTemplatePlan?.templateId, "5k_beginner_8w_3run", "5K beginner template response should expose templateId");
    assert.equal(beginner5kTemplatePlan?.weeks?.length, 8, "5K beginner template plan should have 8 weeks");
    assert.equal(beginner5kTemplatePlan?.preserveTemplateStructure, true, "5K beginner template plan should preserve template structure");
    assert.ok(
      beginner5kTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 3 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "5K beginner template should keep three preserved sessions per week"
    );
    assert.equal(
      beginner5kTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "5K beginner template should not include aggressive interval sessions"
    );
    const beginner5kWeekTwoSupport = findSessionByRole(beginner5kTemplatePlan.weeks[1], "support");
    assert.ok(beginner5kWeekTwoSupport, "5K beginner template Week 2 should include a support run");
    assert.match(String(beginner5kWeekTwoSupport?.structure || beginner5kWeekTwoSupport?.summary || ""), /strides/i, "5K beginner Week 2 should include light strides");
    const beginner5kWeekThreeQuality = findSessionByRole(beginner5kTemplatePlan.weeks[2], "quality");
    assert.ok(beginner5kWeekThreeQuality, "5K beginner template Week 3 should include short controlled efforts");
    assert.equal(beginner5kWeekThreeQuality.type, "TEMPO", "5K beginner Week 3 quality should remain TEMPO");
    assert.equal(countSteadyTimeSteps(beginner5kWeekThreeQuality, 120), 4, "5K beginner Week 3 4x2min controlled efforts should survive intact");
    assert.match(String(beginner5kWeekThreeQuality?.summary || beginner5kWeekThreeQuality?.workout?.summary || beginner5kWeekThreeQuality?.keyTargets || ""), /4\s*x\s*2\s*min/i, "5K beginner Week 3 should display authored 4x2min summary");
    const beginner5kWeekSevenQuality = findSessionByRole(beginner5kTemplatePlan.weeks[6], "quality");
    assert.equal(countSteadyTimeSteps(beginner5kWeekSevenQuality, 90), 4, "5K beginner Week 7 4x90sec rhythm should survive intact");
    const beginner5kWeekEight = beginner5kTemplatePlan.weeks[7];
    const beginner5kWeekEightRace = findSessionByRole(beginner5kWeekEight, "race");
    assert.equal(String(beginner5kWeekEight?.phase || "").toUpperCase(), "TAPER", "5K beginner Week 8 should remain taper phase");
    assert.equal(beginner5kWeekEightRace?.type, "RACE", "5K beginner Week 8 should include race/timed 5K effort");
    assert.equal(Number(beginner5kWeekEightRace?.plannedDistanceKm), 5, "5K beginner Week 8 race/timed effort should stay 5K");
    assert.match(String(beginner5kWeekEightRace?.summary || beginner5kWeekEightRace?.workout?.summary || beginner5kWeekEightRace?.keyTargets || ""), /5K/i, "5K beginner Week 8 should display authored 5K effort");
    assert.doesNotMatch(JSON.stringify(beginner5kTemplatePlan), /10\s*x\s*45|10x45|45s/i, "5K beginner template plan output should not contain a 10x45s legacy string");
    assert.ok(
      beginner5kTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved 5K beginner templates"
    );
    assert.ok(
      beginner5kTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "5K beginner template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(beginner5kTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to 5K beginner template sessions");
    assert.ok(beginner5kTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to 5K beginner template sessions");
    assert.ok(beginner5kTemplatePlan.validationSummary?.approval, "validation should still run for 5K beginner template plan");
    assert.ok(Array.isArray(beginner5kTemplatePlan.validationTrace), "validation trace should still be returned for 5K beginner template plan");

    const intermediate5kTemplateProfile = makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8, targetTime: "22:00" },
      current: { experience: "Regular runner", weeklyKm: 28, longestRunKm: 10 },
      availability: { sessionsPerWeek: 4, runDays: ["Mon", "Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "5K", time: "22:00" } },
    });
    const intermediate5kTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: intermediate5kTemplateProfile }
    );
    assert.equal(intermediate5kTemplateResult.status, 200, `5K intermediate template path failed: ${JSON.stringify(intermediate5kTemplateResult.data)}`);
    const intermediate5kTemplatePlan = intermediate5kTemplateResult.data?.plan;
    assert.equal(intermediate5kTemplatePlan?.planSource, "template", "5K intermediate 8-week 4-run should use template source");
    assert.equal(intermediate5kTemplatePlan?.templateId, "5k_intermediate_8w_4run", "5K intermediate template response should expose templateId");
    assert.equal(intermediate5kTemplatePlan?.weeks?.length, 8, "5K intermediate template plan should have 8 weeks");
    assert.equal(intermediate5kTemplatePlan?.preserveTemplateStructure, true, "5K intermediate template plan should preserve template structure");
    assert.ok(
      intermediate5kTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 4 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "5K intermediate template should keep four preserved sessions per week"
    );
    assert.ok(
      new Set(intermediate5kTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 4,
      "5K intermediate template should map four sessions onto four separate available days"
    );
    const intermediate5kWeekOneQuality = findSessionByRole(intermediate5kTemplatePlan.weeks[0], "quality");
    assert.ok(intermediate5kWeekOneQuality, "5K intermediate template Week 1 should include threshold");
    assert.equal(intermediate5kWeekOneQuality.type, "THRESHOLD", "5K intermediate Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(intermediate5kWeekOneQuality, 360), 3, "5K intermediate Week 1 3x6min threshold should survive intact");
    assert.match(String(intermediate5kWeekOneQuality?.summary || intermediate5kWeekOneQuality?.workout?.summary || intermediate5kWeekOneQuality?.keyTargets || ""), /3\s*x\s*6\s*min/i, "5K intermediate Week 1 should display authored 3x6min summary");
    const intermediate5kWeekTwoQuality = findSessionByRole(intermediate5kTemplatePlan.weeks[1], "quality");
    assert.ok(intermediate5kWeekTwoQuality, "5K intermediate template Week 2 should include controlled 5K efforts");
    assert.equal(intermediate5kWeekTwoQuality.type, "INTERVALS", "5K intermediate Week 2 quality should remain INTERVALS");
    assert.equal(countSteadyTimeSteps(intermediate5kWeekTwoQuality, 120), 6, "5K intermediate Week 2 6x2min 5K effort should survive intact");
    assert.match(String(intermediate5kWeekTwoQuality?.target || ""), /5k_effort/i, "5K intermediate Week 2 should keep 5K effort placeholder");
    const intermediate5kWeekFiveQuality = findSessionByRole(intermediate5kTemplatePlan.weeks[4], "quality");
    assert.equal(countSteadyDistanceSteps(intermediate5kWeekFiveQuality, 800), 5, "5K intermediate Week 5 5x800m should survive intact");
    const intermediate5kWeekSixQuality = findSessionByRole(intermediate5kTemplatePlan.weeks[5], "quality");
    assert.equal(countSteadyDistanceSteps(intermediate5kWeekSixQuality, 400), 8, "5K intermediate Week 6 8x400m controlled VO2 should survive intact");
    assert.match(String(intermediate5kWeekSixQuality?.target || ""), /vo2_controlled/i, "5K intermediate Week 6 should keep controlled VO2 placeholder");
    const intermediate5kWeekEight = intermediate5kTemplatePlan.weeks[7];
    const intermediate5kWeekEightQuality = findSessionByRole(intermediate5kWeekEight, "quality");
    const intermediate5kWeekEightRace = findSessionByRole(intermediate5kWeekEight, "race");
    assert.equal(String(intermediate5kWeekEight?.phase || "").toUpperCase(), "TAPER", "5K intermediate Week 8 should remain taper phase");
    assert.equal(countSteadyTimeSteps(intermediate5kWeekEightQuality, 60), 6, "5K intermediate Week 8 6x1min sharpener should survive intact");
    assert.equal(intermediate5kWeekEightRace?.type, "RACE", "5K intermediate Week 8 should include race/timed 5K effort");
    assert.equal(Number(intermediate5kWeekEightRace?.plannedDistanceKm), 5, "5K intermediate Week 8 race/timed effort should stay 5K");
    assert.match(String(intermediate5kWeekEightRace?.summary || intermediate5kWeekEightRace?.workout?.summary || intermediate5kWeekEightRace?.keyTargets || ""), /5K/i, "5K intermediate Week 8 should display authored 5K effort");
    assert.doesNotMatch(JSON.stringify(intermediate5kTemplatePlan), /10\s*x\s*45|10x45|45s/i, "5K intermediate template plan output should not contain a 10x45s legacy string");
    assert.ok(
      intermediate5kTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved 5K intermediate templates"
    );
    assert.ok(
      intermediate5kTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "5K intermediate template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(intermediate5kTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to 5K intermediate template sessions");
    assert.ok(intermediate5kTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to 5K intermediate template sessions");
    assert.ok(intermediate5kTemplatePlan.validationSummary?.approval, "validation should still run for 5K intermediate template plan");
    assert.ok(Array.isArray(intermediate5kTemplatePlan.validationTrace), "validation trace should still be returned for 5K intermediate template plan");

    const advanced5kTemplateProfile = makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8, targetTime: "18:30" },
      current: { experience: "Advanced/competitive", weeklyKm: 55, longestRunKm: 16 },
      availability: { sessionsPerWeek: 5, runDays: ["Tue", "Wed", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "5K", time: "18:45" } },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
    });
    const advanced5kTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: advanced5kTemplateProfile }
    );
    assert.equal(advanced5kTemplateResult.status, 200, `5K advanced template path failed: ${JSON.stringify(advanced5kTemplateResult.data)}`);
    const advanced5kTemplatePlan = advanced5kTemplateResult.data?.plan;
    assert.equal(advanced5kTemplatePlan?.planSource, "template", "5K advanced 8-week 5-run should use template source");
    assert.equal(advanced5kTemplatePlan?.templateId, "5k_advanced_8w_5run", "5K advanced template response should expose templateId");
    assert.equal(advanced5kTemplatePlan?.weeks?.length, 8, "5K advanced template plan should have 8 weeks");
    assert.equal(advanced5kTemplatePlan?.preserveTemplateStructure, true, "5K advanced template plan should preserve template structure");
    assert.ok(
      advanced5kTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 5 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "5K advanced template should keep five preserved sessions per week"
    );
    assert.ok(
      new Set(advanced5kTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 5,
      "5K advanced template should map five sessions onto five separate available days"
    );
    const advanced5kWeekOneQuality = findSessionByRole(advanced5kTemplatePlan.weeks[0], "quality");
    assert.ok(advanced5kWeekOneQuality, "5K advanced template Week 1 should include threshold");
    assert.equal(advanced5kWeekOneQuality.type, "THRESHOLD", "5K advanced Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(advanced5kWeekOneQuality, 360), 4, "5K advanced Week 1 4x6min threshold should survive intact");
    assert.match(String(advanced5kWeekOneQuality?.summary || advanced5kWeekOneQuality?.workout?.summary || advanced5kWeekOneQuality?.keyTargets || ""), /4\s*x\s*6\s*min/i, "5K advanced Week 1 should display authored 4x6min summary");
    const advanced5kWeekTwoQuality = findSessionByRole(advanced5kTemplatePlan.weeks[1], "quality");
    assert.equal(countSteadyDistanceSteps(advanced5kWeekTwoQuality, 800), 5, "5K advanced Week 2 5x800m controlled VO2 should survive intact");
    assert.match(String(advanced5kWeekTwoQuality?.target || ""), /vo2_controlled/i, "5K advanced Week 2 should keep controlled VO2 placeholder");
    const advanced5kWeekThreeQuality = findSessionByRole(advanced5kTemplatePlan.weeks[2], "quality");
    assert.equal(countSteadyDistanceSteps(advanced5kWeekThreeQuality, 1000), 5, "5K advanced Week 3 5x1km 5K effort should survive intact");
    assert.match(String(advanced5kWeekThreeQuality?.target || ""), /5k_effort/i, "5K advanced Week 3 should keep 5K effort placeholder");
    const advanced5kWeekFiveQuality = findSessionByRole(advanced5kTemplatePlan.weeks[4], "quality");
    assert.equal(countSteadyDistanceSteps(advanced5kWeekFiveQuality, 1200), 4, "5K advanced Week 5 4x1200m 5K effort should survive intact");
    const advanced5kWeekSixQuality = findSessionByRole(advanced5kTemplatePlan.weeks[5], "quality");
    assert.equal(countSteadyDistanceSteps(advanced5kWeekSixQuality, 800), 6, "5K advanced Week 6 6x800m controlled VO2 should survive intact");
    const advanced5kHas400mRep = allPlanSteps(advanced5kTemplatePlan).some((step) => {
      const type = String(step?.stepType || "").toLowerCase();
      const durationType = String(step?.durationType || "").toLowerCase();
      return type === "steady" && durationType === "distance" && Number(step?.durationValue) === 400;
    });
    assert.equal(advanced5kHas400mRep, false, "5K advanced template should not use 400m short reps as main quality work");
    const advanced5kWeekEight = advanced5kTemplatePlan.weeks[7];
    const advanced5kWeekEightQuality = findSessionByRole(advanced5kWeekEight, "quality");
    const advanced5kWeekEightRace = findSessionByRole(advanced5kWeekEight, "race");
    assert.equal(String(advanced5kWeekEight?.phase || "").toUpperCase(), "TAPER", "5K advanced Week 8 should remain taper phase");
    assert.equal(countSteadyTimeSteps(advanced5kWeekEightQuality, 60), 6, "5K advanced Week 8 6x1min sharpener should survive intact");
    assert.equal(advanced5kWeekEightRace?.type, "RACE", "5K advanced Week 8 should include race/timed 5K effort");
    assert.equal(Number(advanced5kWeekEightRace?.plannedDistanceKm), 5, "5K advanced Week 8 race/timed effort should stay 5K");
    assert.match(String(advanced5kWeekEightRace?.summary || advanced5kWeekEightRace?.workout?.summary || advanced5kWeekEightRace?.keyTargets || ""), /5K/i, "5K advanced Week 8 should display authored 5K effort");
    assert.doesNotMatch(JSON.stringify(advanced5kTemplatePlan), /10\s*x\s*45|10x45|45s/i, "5K advanced template plan output should not contain a 10x45s legacy string");
    assert.ok(
      advanced5kTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved 5K advanced templates"
    );
    assert.ok(
      advanced5kTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "5K advanced template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(advanced5kTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to 5K advanced template sessions");
    assert.ok(advanced5kTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to 5K advanced template sessions");
    assert.ok(advanced5kTemplatePlan.validationSummary?.approval, "validation should still run for 5K advanced template plan");
    assert.ok(Array.isArray(advanced5kTemplatePlan.validationTrace), "validation trace should still be returned for 5K advanced template plan");

    const beginnerHalfTemplateProfile = makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12, targetTime: "2:25:00" },
      current: { experience: "New to running", weeklyKm: 28, longestRunKm: 10 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "1:05:00" } },
    });
    const beginnerHalfTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: beginnerHalfTemplateProfile }
    );
    assert.equal(beginnerHalfTemplateResult.status, 200, `half beginner template path failed: ${JSON.stringify(beginnerHalfTemplateResult.data)}`);
    const beginnerHalfTemplatePlan = beginnerHalfTemplateResult.data?.plan;
    assert.equal(beginnerHalfTemplatePlan?.planSource, "template", "half beginner 12-week 3-run should use template source");
    assert.equal(beginnerHalfTemplatePlan?.templateId, "half_beginner_12w_3run", "half beginner template response should expose templateId");
    assert.equal(beginnerHalfTemplatePlan?.weeks?.length, 12, "half beginner template plan should have 12 weeks");
    assert.equal(beginnerHalfTemplatePlan?.preserveTemplateStructure, true, "half beginner template plan should preserve template structure");
    assert.ok(
      beginnerHalfTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 3 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "half beginner template should keep three preserved sessions per week"
    );
    assert.equal(
      beginnerHalfTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "half beginner template should not include aggressive interval sessions"
    );
    assert.equal(String(beginnerHalfTemplatePlan.weeks[3]?.phase || "").toUpperCase(), "DELOAD", "half beginner Week 4 should be a deload");
    assert.equal(String(beginnerHalfTemplatePlan.weeks[7]?.phase || "").toUpperCase(), "DELOAD", "half beginner Week 8 should be a deload");
    assert.equal(String(beginnerHalfTemplatePlan.weeks[10]?.phase || "").toUpperCase(), "TAPER", "half beginner Week 11 should begin taper");
    assert.equal(String(beginnerHalfTemplatePlan.weeks[11]?.phase || "").toUpperCase(), "TAPER", "half beginner Week 12 should remain taper phase");
    const halfWeekOneLong = findSessionByRole(beginnerHalfTemplatePlan.weeks[0], "long_run");
    const halfWeekNineLong = findSessionByRole(beginnerHalfTemplatePlan.weeks[8], "long_run");
    assert.ok(Number(halfWeekNineLong?.plannedDistanceKm) > Number(halfWeekOneLong?.plannedDistanceKm), "half beginner long run should progress conservatively");
    const halfWeekThreeQuality = findSessionByRole(beginnerHalfTemplatePlan.weeks[2], "quality");
    assert.ok(halfWeekThreeQuality, "half beginner Week 3 should include steady work");
    assert.equal(halfWeekThreeQuality.type, "TEMPO", "half beginner Week 3 quality should remain TEMPO");
    assert.equal(countSteadyTimeSteps(halfWeekThreeQuality, 480), 2, "half beginner Week 3 2x8min steady should survive intact");
    assert.match(String(halfWeekThreeQuality?.summary || halfWeekThreeQuality?.workout?.summary || halfWeekThreeQuality?.keyTargets || ""), /2\s*x\s*8\s*min/i, "half beginner Week 3 should display authored 2x8min summary");
    const halfWeekNineQuality = findSessionByRole(beginnerHalfTemplatePlan.weeks[8], "quality");
    assert.equal(countSteadyTimeSteps(halfWeekNineQuality, 720), 2, "half beginner Week 9 2x12min steady should survive intact");
    const halfWeekTwelve = beginnerHalfTemplatePlan.weeks[11];
    const halfWeekTwelveRace = findSessionByRole(halfWeekTwelve, "race");
    assert.equal(halfWeekTwelveRace?.type, "RACE", "half beginner Week 12 should include race/timed half marathon effort");
    assert.equal(Number(halfWeekTwelveRace?.plannedDistanceKm), 21.1, "half beginner Week 12 race/timed effort should stay half marathon distance");
    assert.match(String(halfWeekTwelveRace?.summary || halfWeekTwelveRace?.workout?.summary || halfWeekTwelveRace?.keyTargets || ""), /half marathon/i, "half beginner Week 12 should display authored half marathon effort");
    assert.doesNotMatch(JSON.stringify(beginnerHalfTemplatePlan), /10\s*x\s*45|10x45|45s/i, "half beginner template plan output should not contain a 10x45s legacy string");
    assert.ok(
      beginnerHalfTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved half beginner templates"
    );
    assert.ok(
      beginnerHalfTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "half beginner template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(beginnerHalfTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to half beginner template sessions");
    assert.ok(beginnerHalfTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to half beginner template sessions");
    assert.ok(beginnerHalfTemplatePlan.validationSummary?.approval, "validation should still run for half beginner template plan");
    assert.ok(Array.isArray(beginnerHalfTemplatePlan.validationTrace), "validation trace should still be returned for half beginner template plan");

    const intermediateHalfTemplateProfile = makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12, targetTime: "1:45:00" },
      current: { experience: "Regular runner", weeklyKm: 42, longestRunKm: 16 },
      availability: { sessionsPerWeek: 4, runDays: ["Mon", "Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "49:00" } },
    });
    const intermediateHalfTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: intermediateHalfTemplateProfile }
    );
    assert.equal(intermediateHalfTemplateResult.status, 200, `half intermediate template path failed: ${JSON.stringify(intermediateHalfTemplateResult.data)}`);
    const intermediateHalfTemplatePlan = intermediateHalfTemplateResult.data?.plan;
    assert.equal(intermediateHalfTemplatePlan?.planSource, "template", "half intermediate 12-week 4-run should use template source");
    assert.equal(intermediateHalfTemplatePlan?.templateId, "half_intermediate_12w_4run", "half intermediate template response should expose templateId");
    assert.equal(intermediateHalfTemplatePlan?.weeks?.length, 12, "half intermediate template plan should have 12 weeks");
    assert.equal(intermediateHalfTemplatePlan?.preserveTemplateStructure, true, "half intermediate template plan should preserve template structure");
    assert.ok(
      intermediateHalfTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 4 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "half intermediate template should keep four preserved sessions per week"
    );
    assert.ok(
      new Set(intermediateHalfTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 4,
      "half intermediate template should map four sessions onto four separate available days"
    );
    assert.equal(
      intermediateHalfTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "half intermediate template should avoid aggressive interval sessions"
    );
    assert.equal(String(intermediateHalfTemplatePlan.weeks[3]?.phase || "").toUpperCase(), "DELOAD", "half intermediate Week 4 should be a deload");
    assert.equal(String(intermediateHalfTemplatePlan.weeks[7]?.phase || "").toUpperCase(), "DELOAD", "half intermediate Week 8 should be a deload");
    assert.equal(String(intermediateHalfTemplatePlan.weeks[10]?.phase || "").toUpperCase(), "TAPER", "half intermediate Week 11 should begin taper");
    assert.equal(String(intermediateHalfTemplatePlan.weeks[11]?.phase || "").toUpperCase(), "TAPER", "half intermediate Week 12 should remain taper phase");
    const intermediateHalfWeekOneLong = findSessionByRole(intermediateHalfTemplatePlan.weeks[0], "long_run");
    const intermediateHalfWeekNineLong = findSessionByRole(intermediateHalfTemplatePlan.weeks[8], "long_run");
    assert.ok(Number(intermediateHalfWeekNineLong?.plannedDistanceKm) > Number(intermediateHalfWeekOneLong?.plannedDistanceKm), "half intermediate long run should progress conservatively");
    const intermediateHalfWeekOneQuality = findSessionByRole(intermediateHalfTemplatePlan.weeks[0], "quality");
    assert.ok(intermediateHalfWeekOneQuality, "half intermediate Week 1 should include threshold work");
    assert.equal(intermediateHalfWeekOneQuality.type, "THRESHOLD", "half intermediate Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(intermediateHalfWeekOneQuality, 480), 3, "half intermediate Week 1 3x8min threshold should survive intact");
    assert.match(String(intermediateHalfWeekOneQuality?.summary || intermediateHalfWeekOneQuality?.workout?.summary || intermediateHalfWeekOneQuality?.keyTargets || ""), /3\s*x\s*8\s*min/i, "half intermediate Week 1 should display authored 3x8min summary");
    const intermediateHalfWeekThreeQuality = findSessionByRole(intermediateHalfTemplatePlan.weeks[2], "quality");
    assert.ok(intermediateHalfWeekThreeQuality, "half intermediate Week 3 should include half-marathon rhythm");
    assert.equal(intermediateHalfWeekThreeQuality.type, "TEMPO", "half intermediate Week 3 quality should remain TEMPO");
    assert.equal(countSteadyTimeSteps(intermediateHalfWeekThreeQuality, 600), 3, "half intermediate Week 3 3x10min half-marathon rhythm should survive intact");
    assert.match(String(intermediateHalfWeekThreeQuality?.summary || intermediateHalfWeekThreeQuality?.workout?.summary || intermediateHalfWeekThreeQuality?.keyTargets || ""), /3\s*x\s*10\s*min/i, "half intermediate Week 3 should display authored 3x10min summary");
    const intermediateHalfWeekNineQuality = findSessionByRole(intermediateHalfTemplatePlan.weeks[8], "quality");
    assert.equal(countSteadyTimeSteps(intermediateHalfWeekNineQuality, 720), 3, "half intermediate Week 9 3x12min half-marathon rhythm should survive intact");
    const intermediateHalfWeekTwelve = intermediateHalfTemplatePlan.weeks[11];
    const intermediateHalfWeekTwelveQuality = findSessionByRole(intermediateHalfWeekTwelve, "quality");
    const intermediateHalfWeekTwelveRace = findSessionByRole(intermediateHalfWeekTwelve, "race");
    assert.equal(countSteadyTimeSteps(intermediateHalfWeekTwelveQuality, 120), 4, "half intermediate Week 12 4x2min race-rhythm tune-up should survive intact");
    assert.equal(intermediateHalfWeekTwelveRace?.type, "RACE", "half intermediate Week 12 should include race/timed half marathon effort");
    assert.equal(Number(intermediateHalfWeekTwelveRace?.plannedDistanceKm), 21.1, "half intermediate Week 12 race/timed effort should stay half marathon distance");
    assert.match(String(intermediateHalfWeekTwelveRace?.summary || intermediateHalfWeekTwelveRace?.workout?.summary || intermediateHalfWeekTwelveRace?.keyTargets || ""), /half marathon/i, "half intermediate Week 12 should display authored half marathon effort");
    assert.doesNotMatch(JSON.stringify(intermediateHalfTemplatePlan), /10\s*x\s*45|10x45|45s/i, "half intermediate template plan output should not contain a 10x45s legacy string");
    assert.ok(
      intermediateHalfTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved half intermediate templates"
    );
    assert.ok(
      intermediateHalfTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "half intermediate template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(intermediateHalfTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to half intermediate template sessions");
    assert.ok(intermediateHalfTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to half intermediate template sessions");
    assert.ok(intermediateHalfTemplatePlan.validationSummary?.approval, "validation should still run for half intermediate template plan");
    assert.ok(Array.isArray(intermediateHalfTemplatePlan.validationTrace), "validation trace should still be returned for half intermediate template plan");

    const advancedHalfTemplateProfile = makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12, targetTime: "1:28:00" },
      current: { experience: "Advanced/competitive", weeklyKm: 70, longestRunKm: 22 },
      availability: { sessionsPerWeek: 5, runDays: ["Tue", "Wed", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "40:00" } },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
    });
    const advancedHalfTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: advancedHalfTemplateProfile }
    );
    assert.equal(advancedHalfTemplateResult.status, 200, `half advanced template path failed: ${JSON.stringify(advancedHalfTemplateResult.data)}`);
    const advancedHalfTemplatePlan = advancedHalfTemplateResult.data?.plan;
    assert.equal(advancedHalfTemplatePlan?.planSource, "template", "half advanced 12-week 5-run should use template source");
    assert.equal(advancedHalfTemplatePlan?.templateId, "half_advanced_12w_5run", "half advanced template response should expose templateId");
    assert.equal(advancedHalfTemplatePlan?.weeks?.length, 12, "half advanced template plan should have 12 weeks");
    assert.equal(advancedHalfTemplatePlan?.preserveTemplateStructure, true, "half advanced template plan should preserve template structure");
    assert.ok(
      advancedHalfTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 5 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "half advanced template should keep five preserved sessions per week"
    );
    assert.ok(
      new Set(advancedHalfTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 5,
      "half advanced template should map five sessions onto five separate available days"
    );
    assert.equal(
      advancedHalfTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "half advanced template should not use short VO2/sprint intervals as the main weekly session"
    );
    assert.equal(String(advancedHalfTemplatePlan.weeks[3]?.phase || "").toUpperCase(), "DELOAD", "half advanced Week 4 should be a deload");
    assert.equal(String(advancedHalfTemplatePlan.weeks[7]?.phase || "").toUpperCase(), "DELOAD", "half advanced Week 8 should be a deload");
    assert.equal(String(advancedHalfTemplatePlan.weeks[10]?.phase || "").toUpperCase(), "TAPER", "half advanced Week 11 should begin taper");
    assert.equal(String(advancedHalfTemplatePlan.weeks[11]?.phase || "").toUpperCase(), "TAPER", "half advanced Week 12 should remain taper phase");
    const advancedHalfWeekOneLong = findSessionByRole(advancedHalfTemplatePlan.weeks[0], "long_run");
    const advancedHalfWeekNineLong = findSessionByRole(advancedHalfTemplatePlan.weeks[8], "long_run");
    assert.ok(Number(advancedHalfWeekNineLong?.plannedDistanceKm) > Number(advancedHalfWeekOneLong?.plannedDistanceKm), "half advanced long run should progress before taper");
    const advancedHalfWeekOneQuality = findSessionByRole(advancedHalfTemplatePlan.weeks[0], "quality");
    assert.ok(advancedHalfWeekOneQuality, "half advanced Week 1 should include threshold work");
    assert.equal(advancedHalfWeekOneQuality.type, "THRESHOLD", "half advanced Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(advancedHalfWeekOneQuality, 600), 3, "half advanced Week 1 3x10min threshold should survive intact");
    assert.match(String(advancedHalfWeekOneQuality?.summary || advancedHalfWeekOneQuality?.workout?.summary || advancedHalfWeekOneQuality?.keyTargets || ""), /3\s*x\s*10\s*min/i, "half advanced Week 1 should display authored 3x10min summary");
    const advancedHalfWeekTwoQuality = findSessionByRole(advancedHalfTemplatePlan.weeks[1], "quality");
    assert.equal(countSteadyTimeSteps(advancedHalfWeekTwoQuality, 720), 3, "half advanced Week 2 3x12min HM rhythm should survive intact");
    const advancedHalfWeekFiveQuality = findSessionByRole(advancedHalfTemplatePlan.weeks[4], "quality");
    assert.equal(countSteadyTimeSteps(advancedHalfWeekFiveQuality, 600), 4, "half advanced Week 5 4x10min threshold should survive intact");
    const advancedHalfWeekNineQuality = findSessionByRole(advancedHalfTemplatePlan.weeks[8], "quality");
    assert.equal(countSteadyTimeSteps(advancedHalfWeekNineQuality, 1080), 3, "half advanced Week 9 3x18min HM rhythm should survive intact");
    const advancedHalfWeekTenLong = findSessionByRole(advancedHalfTemplatePlan.weeks[9], "long_run");
    assert.equal(countSteadyTimeSteps(advancedHalfWeekTenLong, 600), 3, "half advanced Week 10 long-run HM blocks should survive intact");
    const advancedHalfHasShortDistanceRep = allPlanSteps(advancedHalfTemplatePlan).some((step) => {
      const type = String(step?.stepType || "").toLowerCase();
      const durationType = String(step?.durationType || "").toLowerCase();
      const durationValue = Number(step?.durationValue);
      return type === "steady" && durationType === "distance" && durationValue > 0 && durationValue <= 400;
    });
    assert.equal(advancedHalfHasShortDistanceRep, false, "half advanced template should not use short sprint-style distance reps");
    const advancedHalfWeekTwelve = advancedHalfTemplatePlan.weeks[11];
    const advancedHalfWeekTwelveQuality = findSessionByRole(advancedHalfWeekTwelve, "quality");
    const advancedHalfWeekTwelveRace = findSessionByRole(advancedHalfWeekTwelve, "race");
    assert.equal(countSteadyTimeSteps(advancedHalfWeekTwelveQuality, 120), 5, "half advanced Week 12 5x2min race-rhythm tune-up should survive intact");
    assert.equal(advancedHalfWeekTwelveRace?.type, "RACE", "half advanced Week 12 should include race/timed half marathon effort");
    assert.equal(Number(advancedHalfWeekTwelveRace?.plannedDistanceKm), 21.1, "half advanced Week 12 race/timed effort should stay half marathon distance");
    assert.match(String(advancedHalfWeekTwelveRace?.summary || advancedHalfWeekTwelveRace?.workout?.summary || advancedHalfWeekTwelveRace?.keyTargets || ""), /half marathon/i, "half advanced Week 12 should display authored half marathon effort");
    assert.doesNotMatch(JSON.stringify(advancedHalfTemplatePlan), /10\s*x\s*45|10x45|45s/i, "half advanced template plan output should not contain a 10x45s legacy string");
    assert.ok(
      advancedHalfTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved half advanced templates"
    );
    assert.ok(
      advancedHalfTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "half advanced template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(advancedHalfTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to half advanced template sessions");
    assert.ok(advancedHalfTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to half advanced template sessions");
    assert.ok(advancedHalfTemplatePlan.validationSummary?.approval, "validation should still run for half advanced template plan");
    assert.ok(Array.isArray(advancedHalfTemplatePlan.validationTrace), "validation trace should still be returned for half advanced template plan");

    const beginnerMarathonTemplateProfile = makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16, targetTime: "4:45:00" },
      current: { experience: "New to running", weeklyKm: 42, longestRunKm: 18 },
      availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Half marathon", time: "2:10:00" } },
    });
    const beginnerMarathonTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: beginnerMarathonTemplateProfile }
    );
    assert.equal(beginnerMarathonTemplateResult.status, 200, `marathon beginner template path failed: ${JSON.stringify(beginnerMarathonTemplateResult.data)}`);
    const beginnerMarathonTemplatePlan = beginnerMarathonTemplateResult.data?.plan;
    assert.equal(beginnerMarathonTemplatePlan?.planSource, "template", "marathon beginner 16-week 4-run should use template source");
    assert.equal(beginnerMarathonTemplatePlan?.templateId, "marathon_beginner_16w_4run", "marathon beginner template response should expose templateId");
    assert.equal(beginnerMarathonTemplatePlan?.weeks?.length, 16, "marathon beginner template plan should have 16 weeks");
    assert.equal(beginnerMarathonTemplatePlan?.preserveTemplateStructure, true, "marathon beginner template plan should preserve template structure");
    assert.ok(
      beginnerMarathonTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 4 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "marathon beginner template should keep four preserved sessions per week"
    );
    assert.ok(
      new Set(beginnerMarathonTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 4,
      "marathon beginner template should map four sessions onto four separate available days"
    );
    assert.equal(
      beginnerMarathonTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "marathon beginner template should not include aggressive interval sessions"
    );
    assert.equal(String(beginnerMarathonTemplatePlan.weeks[3]?.phase || "").toUpperCase(), "DELOAD", "marathon beginner Week 4 should be a deload");
    assert.equal(String(beginnerMarathonTemplatePlan.weeks[7]?.phase || "").toUpperCase(), "DELOAD", "marathon beginner Week 8 should be a deload");
    assert.equal(String(beginnerMarathonTemplatePlan.weeks[11]?.phase || "").toUpperCase(), "DELOAD", "marathon beginner Week 12 should be a deload");
    assert.equal(String(beginnerMarathonTemplatePlan.weeks[13]?.phase || "").toUpperCase(), "TAPER", "marathon beginner Week 14 should begin taper");
    assert.equal(String(beginnerMarathonTemplatePlan.weeks[15]?.phase || "").toUpperCase(), "TAPER", "marathon beginner Week 16 should remain taper phase");
    const marathonWeekOneLong = findSessionByRole(beginnerMarathonTemplatePlan.weeks[0], "long_run");
    const marathonWeekElevenLong = findSessionByRole(beginnerMarathonTemplatePlan.weeks[10], "long_run");
    assert.ok(Number(marathonWeekElevenLong?.plannedDistanceKm) > Number(marathonWeekOneLong?.plannedDistanceKm), "marathon beginner long run should progress conservatively");
    assert.ok(Number(marathonWeekElevenLong?.plannedDistanceKm) >= 24, "marathon beginner template should include sufficient long-run stimulus");
    const marathonWeekOneQuality = findSessionByRole(beginnerMarathonTemplatePlan.weeks[0], "quality");
    assert.ok(marathonWeekOneQuality, "marathon beginner Week 1 should include steady work");
    assert.equal(marathonWeekOneQuality.type, "TEMPO", "marathon beginner Week 1 quality should remain TEMPO");
    assert.equal(countSteadyTimeSteps(marathonWeekOneQuality, 480), 2, "marathon beginner Week 1 2x8min steady should survive intact");
    assert.match(String(marathonWeekOneQuality?.summary || marathonWeekOneQuality?.workout?.summary || marathonWeekOneQuality?.keyTargets || ""), /2\s*x\s*8\s*min/i, "marathon beginner Week 1 should display authored 2x8min summary");
    const marathonWeekNineQuality = findSessionByRole(beginnerMarathonTemplatePlan.weeks[8], "quality");
    assert.equal(countSteadyTimeSteps(marathonWeekNineQuality, 720), 3, "marathon beginner Week 9 3x12min marathon rhythm should survive intact");
    assert.match(String(marathonWeekNineQuality?.summary || marathonWeekNineQuality?.workout?.summary || marathonWeekNineQuality?.keyTargets || ""), /3\s*x\s*12\s*min/i, "marathon beginner Week 9 should display authored 3x12min summary");
    const marathonWeekThirteenQuality = findSessionByRole(beginnerMarathonTemplatePlan.weeks[12], "quality");
    assert.equal(countSteadyTimeSteps(marathonWeekThirteenQuality, 1200), 2, "marathon beginner Week 13 2x20min marathon rhythm should survive intact");
    const marathonWeekSixteen = beginnerMarathonTemplatePlan.weeks[15];
    const marathonWeekSixteenQuality = findSessionByRole(marathonWeekSixteen, "quality");
    const marathonWeekSixteenRace = findSessionByRole(marathonWeekSixteen, "race");
    assert.equal(countSteadyTimeSteps(marathonWeekSixteenQuality, 120), 4, "marathon beginner Week 16 4x2min race-rhythm tune-up should survive intact");
    assert.equal(marathonWeekSixteenRace?.type, "RACE", "marathon beginner Week 16 should include race/timed marathon effort");
    assert.equal(Number(marathonWeekSixteenRace?.plannedDistanceKm), 42.2, "marathon beginner Week 16 race/timed effort should stay marathon distance");
    assert.match(String(marathonWeekSixteenRace?.summary || marathonWeekSixteenRace?.workout?.summary || marathonWeekSixteenRace?.keyTargets || ""), /marathon/i, "marathon beginner Week 16 should display authored marathon effort");
    assert.doesNotMatch(JSON.stringify(beginnerMarathonTemplatePlan), /10\s*x\s*45|10x45|45s/i, "marathon beginner template plan output should not contain a 10x45s legacy string");
    assert.ok(
      beginnerMarathonTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved marathon beginner templates"
    );
    assert.ok(
      beginnerMarathonTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "marathon beginner template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(beginnerMarathonTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to marathon beginner template sessions");
    assert.ok(beginnerMarathonTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to marathon beginner template sessions");
    assert.ok(beginnerMarathonTemplatePlan.validationSummary?.approval, "validation should still run for marathon beginner template plan");
    assert.ok(Array.isArray(beginnerMarathonTemplatePlan.validationTrace), "validation trace should still be returned for marathon beginner template plan");

    const intermediateMarathonTemplateProfile = makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16, targetTime: "3:45:00" },
      current: { experience: "Regular runner", weeklyKm: 58, longestRunKm: 24 },
      availability: { sessionsPerWeek: 5, runDays: ["Tue", "Wed", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Half marathon", time: "1:47:00" } },
    });
    const intermediateMarathonTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: intermediateMarathonTemplateProfile }
    );
    assert.equal(intermediateMarathonTemplateResult.status, 200, `marathon intermediate template path failed: ${JSON.stringify(intermediateMarathonTemplateResult.data)}`);
    const intermediateMarathonTemplatePlan = intermediateMarathonTemplateResult.data?.plan;
    assert.equal(intermediateMarathonTemplatePlan?.planSource, "template", "marathon intermediate 16-week 5-run should use template source");
    assert.equal(intermediateMarathonTemplatePlan?.templateId, "marathon_intermediate_16w_5run", "marathon intermediate template response should expose templateId");
    assert.equal(intermediateMarathonTemplatePlan?.weeks?.length, 16, "marathon intermediate template plan should have 16 weeks");
    assert.equal(intermediateMarathonTemplatePlan?.preserveTemplateStructure, true, "marathon intermediate template plan should preserve template structure");
    assert.ok(
      intermediateMarathonTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 5 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "marathon intermediate template should keep five preserved sessions per week"
    );
    assert.ok(
      new Set(intermediateMarathonTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 5,
      "marathon intermediate template should map five sessions onto five separate available days"
    );
    assert.equal(
      intermediateMarathonTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "marathon intermediate template should avoid aggressive VO2/short interval sessions"
    );
    assert.equal(String(intermediateMarathonTemplatePlan.weeks[3]?.phase || "").toUpperCase(), "DELOAD", "marathon intermediate Week 4 should be a deload");
    assert.equal(String(intermediateMarathonTemplatePlan.weeks[7]?.phase || "").toUpperCase(), "DELOAD", "marathon intermediate Week 8 should be a deload");
    assert.equal(String(intermediateMarathonTemplatePlan.weeks[11]?.phase || "").toUpperCase(), "DELOAD", "marathon intermediate Week 12 should be a deload");
    assert.equal(String(intermediateMarathonTemplatePlan.weeks[13]?.phase || "").toUpperCase(), "TAPER", "marathon intermediate Week 14 should begin taper");
    assert.equal(String(intermediateMarathonTemplatePlan.weeks[15]?.phase || "").toUpperCase(), "TAPER", "marathon intermediate Week 16 should remain taper phase");
    const intermediateMarathonWeekOneLong = findSessionByRole(intermediateMarathonTemplatePlan.weeks[0], "long_run");
    const intermediateMarathonWeekElevenLong = findSessionByRole(intermediateMarathonTemplatePlan.weeks[10], "long_run");
    assert.ok(Number(intermediateMarathonWeekElevenLong?.plannedDistanceKm) > Number(intermediateMarathonWeekOneLong?.plannedDistanceKm), "marathon intermediate long run should progress before taper");
    assert.ok(Number(intermediateMarathonWeekElevenLong?.plannedDistanceKm) >= 24, "marathon intermediate template should include sufficient long-run stimulus");
    const intermediateMarathonWeekOneQuality = findSessionByRole(intermediateMarathonTemplatePlan.weeks[0], "quality");
    assert.ok(intermediateMarathonWeekOneQuality, "marathon intermediate Week 1 should include threshold support");
    assert.equal(intermediateMarathonWeekOneQuality.type, "THRESHOLD", "marathon intermediate Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekOneQuality, 480), 3, "marathon intermediate Week 1 3x8min threshold should survive intact");
    assert.match(String(intermediateMarathonWeekOneQuality?.summary || intermediateMarathonWeekOneQuality?.workout?.summary || intermediateMarathonWeekOneQuality?.keyTargets || ""), /3\s*x\s*8\s*min/i, "marathon intermediate Week 1 should display authored 3x8min summary");
    const intermediateMarathonWeekThreeQuality = findSessionByRole(intermediateMarathonTemplatePlan.weeks[2], "quality");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekThreeQuality, 600), 3, "marathon intermediate Week 3 3x10min marathon rhythm should survive intact");
    const intermediateMarathonWeekNineQuality = findSessionByRole(intermediateMarathonTemplatePlan.weeks[8], "quality");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekNineQuality, 900), 3, "marathon intermediate Week 9 3x15min marathon rhythm should survive intact");
    const intermediateMarathonWeekElevenQuality = findSessionByRole(intermediateMarathonTemplatePlan.weeks[10], "quality");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekElevenQuality, 1200), 3, "marathon intermediate Week 11 3x20min marathon rhythm should survive intact");
    const intermediateMarathonWeekThirteenQuality = findSessionByRole(intermediateMarathonTemplatePlan.weeks[12], "quality");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekThirteenQuality, 1500), 2, "marathon intermediate Week 13 2x25min marathon rhythm should survive intact");
    const intermediateMarathonWeekThirteenLong = findSessionByRole(intermediateMarathonTemplatePlan.weeks[12], "long_run");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekThirteenLong, 600), 3, "marathon intermediate Week 13 long-run marathon blocks should survive intact");
    const intermediateMarathonHasShortDistanceRep = allPlanSteps(intermediateMarathonTemplatePlan).some((step) => {
      const type = String(step?.stepType || "").toLowerCase();
      const durationType = String(step?.durationType || "").toLowerCase();
      const durationValue = Number(step?.durationValue);
      return type === "steady" && durationType === "distance" && durationValue > 0 && durationValue <= 400;
    });
    assert.equal(intermediateMarathonHasShortDistanceRep, false, "marathon intermediate template should not use short sprint-style distance reps");
    const intermediateMarathonWeekSixteen = intermediateMarathonTemplatePlan.weeks[15];
    const intermediateMarathonWeekSixteenQuality = findSessionByRole(intermediateMarathonWeekSixteen, "quality");
    const intermediateMarathonWeekSixteenRace = findSessionByRole(intermediateMarathonWeekSixteen, "race");
    assert.equal(countSteadyTimeSteps(intermediateMarathonWeekSixteenQuality, 120), 5, "marathon intermediate Week 16 5x2min race-rhythm tune-up should survive intact");
    assert.equal(intermediateMarathonWeekSixteenRace?.type, "RACE", "marathon intermediate Week 16 should include race/timed marathon effort");
    assert.equal(Number(intermediateMarathonWeekSixteenRace?.plannedDistanceKm), 42.2, "marathon intermediate Week 16 race/timed effort should stay marathon distance");
    assert.match(String(intermediateMarathonWeekSixteenRace?.summary || intermediateMarathonWeekSixteenRace?.workout?.summary || intermediateMarathonWeekSixteenRace?.keyTargets || ""), /marathon/i, "marathon intermediate Week 16 should display authored marathon effort");
    assert.doesNotMatch(JSON.stringify(intermediateMarathonTemplatePlan), /10\s*x\s*45|10x45|45s/i, "marathon intermediate template plan output should not contain a 10x45s legacy string");
    assert.ok(
      intermediateMarathonTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved marathon intermediate templates"
    );
    assert.ok(
      intermediateMarathonTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "marathon intermediate template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(intermediateMarathonTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to marathon intermediate template sessions");
    assert.ok(intermediateMarathonTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to marathon intermediate template sessions");
    assert.ok(intermediateMarathonTemplatePlan.validationSummary?.approval, "validation should still run for marathon intermediate template plan");
    assert.ok(Array.isArray(intermediateMarathonTemplatePlan.validationTrace), "validation trace should still be returned for marathon intermediate template plan");

    const advancedMarathonTemplateProfile = makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 18, targetTime: "3:00:00" },
      current: { experience: "Advanced/competitive", weeklyKm: 82, longestRunKm: 30 },
      availability: { sessionsPerWeek: 5, runDays: ["Tue", "Wed", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Half marathon", time: "1:25:00" } },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
    });
    const advancedMarathonTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: advancedMarathonTemplateProfile }
    );
    assert.equal(advancedMarathonTemplateResult.status, 200, `marathon advanced template path failed: ${JSON.stringify(advancedMarathonTemplateResult.data)}`);
    const advancedMarathonTemplatePlan = advancedMarathonTemplateResult.data?.plan;
    assert.equal(advancedMarathonTemplatePlan?.planSource, "template", "marathon advanced 18-week 5-run should use template source");
    assert.equal(advancedMarathonTemplatePlan?.templateId, "marathon_advanced_18w_5run", "marathon advanced template response should expose templateId");
    assert.equal(advancedMarathonTemplatePlan?.weeks?.length, 18, "marathon advanced template plan should have 18 weeks");
    assert.equal(advancedMarathonTemplatePlan?.preserveTemplateStructure, true, "marathon advanced template plan should preserve template structure");
    assert.ok(
      advancedMarathonTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 5 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "marathon advanced template should keep five preserved sessions per week"
    );
    assert.ok(
      new Set(advancedMarathonTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 5,
      "marathon advanced template should map five sessions onto five separate available days"
    );
    assert.equal(
      advancedMarathonTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "marathon advanced template should avoid VO2/short intervals as the main weekly focus"
    );
    assert.equal(String(advancedMarathonTemplatePlan.weeks[3]?.phase || "").toUpperCase(), "DELOAD", "marathon advanced Week 4 should be a deload");
    assert.equal(String(advancedMarathonTemplatePlan.weeks[7]?.phase || "").toUpperCase(), "DELOAD", "marathon advanced Week 8 should be a deload");
    assert.equal(String(advancedMarathonTemplatePlan.weeks[11]?.phase || "").toUpperCase(), "DELOAD", "marathon advanced Week 12 should be a deload");
    assert.equal(String(advancedMarathonTemplatePlan.weeks[15]?.phase || "").toUpperCase(), "TAPER", "marathon advanced Week 16 should begin taper");
    assert.equal(String(advancedMarathonTemplatePlan.weeks[17]?.phase || "").toUpperCase(), "TAPER", "marathon advanced Week 18 should remain taper phase");
    const advancedMarathonWeekOneLong = findSessionByRole(advancedMarathonTemplatePlan.weeks[0], "long_run");
    const advancedMarathonWeekFourteenLong = findSessionByRole(advancedMarathonTemplatePlan.weeks[13], "long_run");
    assert.ok(Number(advancedMarathonWeekFourteenLong?.plannedDistanceKm) > Number(advancedMarathonWeekOneLong?.plannedDistanceKm), "marathon advanced long run should progress before taper");
    assert.ok(Number(advancedMarathonWeekFourteenLong?.plannedDistanceKm) >= 24, "marathon advanced template should include sufficient long-run stimulus");
    const advancedMarathonWeekOneQuality = findSessionByRole(advancedMarathonTemplatePlan.weeks[0], "quality");
    assert.ok(advancedMarathonWeekOneQuality, "marathon advanced Week 1 should include threshold support");
    assert.equal(advancedMarathonWeekOneQuality.type, "THRESHOLD", "marathon advanced Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekOneQuality, 600), 3, "marathon advanced Week 1 3x10min threshold should survive intact");
    assert.match(String(advancedMarathonWeekOneQuality?.summary || advancedMarathonWeekOneQuality?.workout?.summary || advancedMarathonWeekOneQuality?.keyTargets || ""), /3\s*x\s*10\s*min/i, "marathon advanced Week 1 should display authored 3x10min summary");
    const advancedMarathonWeekThreeQuality = findSessionByRole(advancedMarathonTemplatePlan.weeks[2], "quality");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekThreeQuality, 720), 3, "marathon advanced Week 3 3x12min marathon rhythm should survive intact");
    const advancedMarathonWeekNineQuality = findSessionByRole(advancedMarathonTemplatePlan.weeks[8], "quality");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekNineQuality, 900), 4, "marathon advanced Week 9 4x15min marathon rhythm should survive intact");
    const advancedMarathonWeekElevenQuality = findSessionByRole(advancedMarathonTemplatePlan.weeks[10], "quality");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekElevenQuality, 1200), 3, "marathon advanced Week 11 3x20min marathon rhythm should survive intact");
    const advancedMarathonWeekFourteenQuality = findSessionByRole(advancedMarathonTemplatePlan.weeks[13], "quality");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekFourteenQuality, 1500), 2, "marathon advanced Week 14 2x25min marathon rhythm should survive intact");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekFourteenLong, 900), 4, "marathon advanced Week 14 peak long-run marathon blocks should survive intact");
    const advancedMarathonHasShortDistanceRep = allPlanSteps(advancedMarathonTemplatePlan).some((step) => {
      const type = String(step?.stepType || "").toLowerCase();
      const durationType = String(step?.durationType || "").toLowerCase();
      const durationValue = Number(step?.durationValue);
      return type === "steady" && durationType === "distance" && durationValue > 0 && durationValue <= 400;
    });
    assert.equal(advancedMarathonHasShortDistanceRep, false, "marathon advanced template should not use short sprint-style distance reps");
    const advancedMarathonWeekEighteen = advancedMarathonTemplatePlan.weeks[17];
    const advancedMarathonWeekEighteenQuality = findSessionByRole(advancedMarathonWeekEighteen, "quality");
    const advancedMarathonWeekEighteenRace = findSessionByRole(advancedMarathonWeekEighteen, "race");
    assert.equal(countSteadyTimeSteps(advancedMarathonWeekEighteenQuality, 120), 5, "marathon advanced Week 18 5x2min race-rhythm tune-up should survive intact");
    assert.equal(advancedMarathonWeekEighteenRace?.type, "RACE", "marathon advanced Week 18 should include race/timed marathon effort");
    assert.equal(Number(advancedMarathonWeekEighteenRace?.plannedDistanceKm), 42.2, "marathon advanced Week 18 race/timed effort should stay marathon distance");
    assert.match(String(advancedMarathonWeekEighteenRace?.summary || advancedMarathonWeekEighteenRace?.workout?.summary || advancedMarathonWeekEighteenRace?.keyTargets || ""), /marathon/i, "marathon advanced Week 18 should display authored marathon effort");
    assert.doesNotMatch(JSON.stringify(advancedMarathonTemplatePlan), /10\s*x\s*45|10x45|45s/i, "marathon advanced template plan output should not contain a 10x45s legacy string");
    assert.ok(
      advancedMarathonTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved marathon advanced templates"
    );
    assert.ok(
      advancedMarathonTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "marathon advanced template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(advancedMarathonTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to marathon advanced template sessions");
    assert.ok(advancedMarathonTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to marathon advanced template sessions");
    assert.ok(advancedMarathonTemplatePlan.validationSummary?.approval, "validation should still run for marathon advanced template plan");
    assert.ok(Array.isArray(advancedMarathonTemplatePlan.validationTrace), "validation trace should still be returned for marathon advanced template plan");

    const beginnerTemplateProfile = makeProfile({
      goal: { distance: "10K", planLengthWeeks: 8, targetTime: "70:00" },
      current: { experience: "New to running", weeklyKm: 18, longestRunKm: 7 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "5K", time: "34:00" } },
    });
    const beginnerTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: beginnerTemplateProfile }
    );
    assert.equal(beginnerTemplateResult.status, 200, `beginner template path failed: ${JSON.stringify(beginnerTemplateResult.data)}`);
    const beginnerTemplatePlan = beginnerTemplateResult.data?.plan;
    assert.equal(beginnerTemplatePlan?.planSource, "template", "10K beginner 8-week 3-run should use template source");
    assert.equal(beginnerTemplatePlan?.templateId, "10k_beginner_8w_3run", "beginner template response should expose templateId");
    assert.equal(beginnerTemplatePlan?.weeks?.length, 8, "beginner template plan should have 8 weeks");
    assert.equal(beginnerTemplatePlan?.preserveTemplateStructure, true, "beginner template plan should preserve template structure");
    assert.ok(
      beginnerTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 3 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "beginner template should keep three preserved sessions per week"
    );
    assert.equal(
      beginnerTemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "beginner template should not include aggressive interval sessions"
    );
    const beginnerWeekTwoSupport = findSessionByRole(beginnerTemplatePlan.weeks[1], "support");
    assert.ok(beginnerWeekTwoSupport, "beginner template Week 2 should include a support run");
    assert.match(String(beginnerWeekTwoSupport?.structure || beginnerWeekTwoSupport?.summary || ""), /strides/i, "beginner Week 2 should include light strides");
    const beginnerWeekThreeQuality = findSessionByRole(beginnerTemplatePlan.weeks[2], "quality");
    assert.ok(beginnerWeekThreeQuality, "beginner template Week 3 should include gentle tempo");
    assert.equal(beginnerWeekThreeQuality.type, "TEMPO", "beginner Week 3 quality should remain TEMPO");
    assert.equal(countSteadyTimeSteps(beginnerWeekThreeQuality, 300), 2, "beginner Week 3 2x5min gentle tempo should survive intact");
    assert.match(String(beginnerWeekThreeQuality?.summary || beginnerWeekThreeQuality?.workout?.summary || beginnerWeekThreeQuality?.keyTargets || ""), /2\s*x\s*5\s*min/i, "beginner Week 3 should display authored 2x5min tempo summary");
    const beginnerWeekEight = beginnerTemplatePlan.weeks[7];
    const beginnerWeekEightRace = findSessionByRole(beginnerWeekEight, "race");
    assert.equal(String(beginnerWeekEight?.phase || "").toUpperCase(), "TAPER", "beginner Week 8 should remain taper phase");
    assert.equal(beginnerWeekEightRace?.type, "RACE", "beginner Week 8 should include race/timed 10K effort");
    assert.equal(Number(beginnerWeekEightRace?.plannedDistanceKm), 10, "beginner Week 8 race/timed effort should stay 10K");
    assert.match(String(beginnerWeekEightRace?.summary || beginnerWeekEightRace?.workout?.summary || beginnerWeekEightRace?.keyTargets || ""), /10K/i, "beginner Week 8 should display authored 10K effort");
    assert.doesNotMatch(JSON.stringify(beginnerTemplatePlan), /10\s*x\s*45|10x45|45s/i, "beginner template plan output should not contain a 10x45s legacy string");
    assert.ok(
      beginnerTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved beginner templates"
    );
    assert.ok(
      beginnerTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "beginner template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(beginnerTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to beginner template sessions");
    assert.ok(beginnerTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to beginner template sessions");
    assert.ok(beginnerTemplatePlan.validationSummary?.approval, "validation should still run for beginner template plan");
    assert.ok(Array.isArray(beginnerTemplatePlan.validationTrace), "validation trace should still be returned for beginner template plan");

    const beginner4TemplateProfile = makeProfile({
      goal: { distance: "10K", planLengthWeeks: 8, targetTime: "70:00" },
      current: { experience: "New to running", weeklyKm: 18, longestRunKm: 7 },
      availability: { sessionsPerWeek: 4, runDays: ["Mon", "Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "5K", time: "34:00" } },
    });
    const beginner4TemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: beginner4TemplateProfile }
    );
    assert.equal(beginner4TemplateResult.status, 200, `beginner 4-run template path failed: ${JSON.stringify(beginner4TemplateResult.data)}`);
    const beginner4TemplatePlan = beginner4TemplateResult.data?.plan;
    assert.equal(beginner4TemplatePlan?.planSource, "template", "10K beginner 8-week 4-run should use template source");
    assert.equal(beginner4TemplatePlan?.templateId, "10k_beginner_8w_4run", "beginner 4-run template response should expose templateId");
    assert.equal(beginner4TemplatePlan?.weeks?.length, 8, "beginner 4-run template plan should have 8 weeks");
    assert.equal(beginner4TemplatePlan?.preserveTemplateStructure, true, "beginner 4-run template plan should preserve template structure");
    assert.ok(
      beginner4TemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 4 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "beginner 4-run template should keep four preserved sessions per week"
    );
    assert.ok(
      new Set(beginner4TemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 4,
      "beginner 4-run template should map four sessions onto four separate available days"
    );
    assert.equal(
      beginner4TemplatePlan.weeks.flatMap((week) => week.sessions).some((session) => session.type === "INTERVALS"),
      false,
      "beginner 4-run template should not include aggressive interval sessions"
    );
    const beginner4WeekTwoSupport = findSessionByRole(beginner4TemplatePlan.weeks[1], "support");
    assert.ok(beginner4WeekTwoSupport, "beginner 4-run template Week 2 should include a support run");
    assert.match(String(beginner4WeekTwoSupport?.structure || beginner4WeekTwoSupport?.summary || ""), /strides/i, "beginner 4-run Week 2 should include light strides");
    const beginner4WeekThreeQuality = findSessionByRole(beginner4TemplatePlan.weeks[2], "quality");
    assert.ok(beginner4WeekThreeQuality, "beginner 4-run template Week 3 should include gentle tempo");
    assert.equal(beginner4WeekThreeQuality.type, "TEMPO", "beginner 4-run Week 3 quality should remain TEMPO");
    assert.equal(countSteadyTimeSteps(beginner4WeekThreeQuality, 300), 2, "beginner 4-run Week 3 2x5min gentle tempo should survive intact");
    assert.match(String(beginner4WeekThreeQuality?.summary || beginner4WeekThreeQuality?.workout?.summary || beginner4WeekThreeQuality?.keyTargets || ""), /2\s*x\s*5\s*min/i, "beginner 4-run Week 3 should display authored 2x5min tempo summary");
    const beginner4WeekEight = beginner4TemplatePlan.weeks[7];
    const beginner4WeekEightRace = findSessionByRole(beginner4WeekEight, "race");
    assert.equal(String(beginner4WeekEight?.phase || "").toUpperCase(), "TAPER", "beginner 4-run Week 8 should remain taper phase");
    assert.equal(beginner4WeekEightRace?.type, "RACE", "beginner 4-run Week 8 should include race/timed 10K effort");
    assert.equal(Number(beginner4WeekEightRace?.plannedDistanceKm), 10, "beginner 4-run Week 8 race/timed effort should stay 10K");
    assert.match(String(beginner4WeekEightRace?.summary || beginner4WeekEightRace?.workout?.summary || beginner4WeekEightRace?.keyTargets || ""), /10K/i, "beginner 4-run Week 8 should display authored 10K effort");
    assert.doesNotMatch(JSON.stringify(beginner4TemplatePlan), /10\s*x\s*45|10x45|45s/i, "beginner 4-run template plan output should not contain a 10x45s legacy string");
    assert.ok(
      beginner4TemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved beginner 4-run templates"
    );
    assert.ok(
      beginner4TemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "beginner 4-run template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(beginner4TemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to beginner 4-run template sessions");
    assert.ok(beginner4TemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to beginner 4-run template sessions");
    assert.ok(beginner4TemplatePlan.validationSummary?.approval, "validation should still run for beginner 4-run template plan");
    assert.ok(Array.isArray(beginner4TemplatePlan.validationTrace), "validation trace should still be returned for beginner 4-run template plan");

    const templateProfile = makeProfile({
      goal: { distance: "10K", planLengthWeeks: 8, targetTime: "50:00" },
      current: { experience: "Regular runner", weeklyKm: 20, longestRunKm: 12 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "50:00" } },
    });
    const templateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: templateProfile }
    );
    assert.equal(templateResult.status, 200, `template path failed: ${JSON.stringify(templateResult.data)}`);
    const templatePlan = templateResult.data?.plan;
    assert.equal(templatePlan?.planSource, "template", "10K intermediate 8-week 3-run should use template source");
    assert.equal(templatePlan?.templateId, "10k_intermediate_8w_3run", "template response should expose templateId");
    assert.ok(templatePlan?.planVersion, "template plan should expose planVersion");
    assert.ok(templatePlan?.rulesEngineVersion, "template plan should expose rulesEngineVersion");
    assert.ok(templatePlan?.templateVersion, "template plan should expose templateVersion");
    assert.ok(templatePlan?.generatedAt, "template plan should expose generatedAt");
    assert.equal(templatePlan?.generatorFeatures?.templateFirst, true, "template plan should expose generator features");
    assert.equal(templatePlan?.inputProfileSnapshot?.goal?.targetTime, "50:00", "template plan should include input profile snapshot");
    assert.ok(templatePlan?.validationSummary?.approval, "template plan should include validationSummary");
    assert.ok(templatePlan?.goalRealism?.level, "template plan should include goalRealism");
    assert.ok(templatePlan?.paceModel?.confidence, "template plan should include paceModel");
    assert.ok(templatePlan?.planExplanation?.planSummary, "template plan should include planExplanation");
    const savedTemplatePlanDoc = {
      kind: "run",
      planSource: templatePlan.planSource,
      templateId: templatePlan.templateId,
      planVersion: templatePlan.planVersion,
      inputProfileSnapshot: templatePlan.inputProfileSnapshot,
      validationSummary: templatePlan.validationSummary,
      plan: templatePlan,
    };
    const reloadedTemplatePlan = {
      ...savedTemplatePlanDoc.plan,
      planSource: savedTemplatePlanDoc.plan.planSource || savedTemplatePlanDoc.planSource,
      templateId: savedTemplatePlanDoc.plan.templateId || savedTemplatePlanDoc.templateId,
      planVersion: savedTemplatePlanDoc.plan.planVersion || savedTemplatePlanDoc.planVersion,
      inputProfileSnapshot: savedTemplatePlanDoc.plan.inputProfileSnapshot || savedTemplatePlanDoc.inputProfileSnapshot,
      validationSummary: savedTemplatePlanDoc.plan.validationSummary || savedTemplatePlanDoc.validationSummary,
    };
    assert.equal(reloadedTemplatePlan.planSource, "template", "saved/reloaded template plan should retain planSource");
    assert.equal(reloadedTemplatePlan.templateId, "10k_intermediate_8w_3run", "saved/reloaded template plan should retain templateId");
    assert.ok(reloadedTemplatePlan.planVersion, "saved/reloaded template plan should retain planVersion");
    assert.ok(reloadedTemplatePlan.inputProfileSnapshot?.goal?.distance, "saved/reloaded template plan should retain inputProfileSnapshot");
    assert.ok(reloadedTemplatePlan.validationSummary?.approval, "saved/reloaded template plan should retain validationSummary");
    assert.equal(templatePlan?.weeks?.length, 8, "template plan should have 8 weeks");
    assert.equal(templatePlan?.preserveTemplateStructure, true, "template plan should preserve template structure");
    assert.ok(
      templatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "template-generated sessions should be marked preserveTemplateStructure"
    );
    const weekOneQuality = findSessionByRole(templatePlan.weeks[0], "quality");
    assert.ok(weekOneQuality, "template Week 1 should include a quality session");
    assert.match(String(weekOneQuality?.structure || weekOneQuality?.keyTargets || ""), /3\s*x\s*6/i, "Week 1 quality should be threshold 3x6min");
    assert.equal(weekOneQuality.type, "THRESHOLD", "Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(weekOneQuality, 360), 3, "Week 1 threshold 3x6min should survive intact");
    assert.match(String(weekOneQuality?.summary || weekOneQuality?.workout?.summary || weekOneQuality?.keyTargets || ""), /3\s*x\s*6\s*min/i, "Week 1 should display authored 3x6min summary");
    const weekOneQualityFromDays = findDaySessionByRole(templatePlan.weeks[0], "quality");
    assert.equal(weekOneQualityFromDays?.sessionId, weekOneQuality.sessionId, "saved week.days should reference the same Week 1 quality session the UI renders");
    assert.match(String(weekOneQualityFromDays?.summary || weekOneQualityFromDays?.workout?.summary || weekOneQualityFromDays?.keyTargets || ""), /3\s*x\s*6\s*min/i, "Week 1 saved day view should display authored 3x6min summary");
    const weekThreeQuality = findSessionByRole(templatePlan.weeks[2], "quality");
    assert.ok(weekThreeQuality, "template Week 3 should include a quality session");
    assert.equal(weekThreeQuality.type, "INTERVALS", "Week 3 quality should remain INTERVALS");
    assert.equal(countSteadyTimeSteps(weekThreeQuality, 180), 5, "Week 3 5x3min 10K effort should survive intact");
    assert.match(String(weekThreeQuality?.target || ""), /10k_effort/i, "Week 3 should keep 10K effort target placeholder");
    assert.match(String(weekThreeQuality?.summary || weekThreeQuality?.workout?.summary || weekThreeQuality?.keyTargets || ""), /5\s*x\s*3\s*min/i, "Week 3 should display authored 5x3min summary");
    assert.match(String(findDaySessionByRole(templatePlan.weeks[2], "quality")?.summary || ""), /5\s*x\s*3\s*min/i, "Week 3 saved day view should display authored 5x3min summary");
    const weekEight = templatePlan.weeks[7];
    const weekEightQuality = findSessionByRole(weekEight, "quality");
    const weekEightRace = findSessionByRole(weekEight, "race");
    assert.equal(String(weekEight?.phase || "").toUpperCase(), "TAPER", "Week 8 should remain taper phase");
    assert.equal(countSteadyTimeSteps(weekEightQuality, 60), 6, "Week 8 short sharpen 6x1min should survive intact");
    assert.match(String(weekEightQuality?.summary || weekEightQuality?.workout?.summary || weekEightQuality?.keyTargets || ""), /6\s*x\s*1\s*min/i, "Week 8 should display authored 6x1min sharpen summary");
    assert.match(String(findDaySessionByRole(weekEight, "quality")?.summary || ""), /6\s*x\s*1\s*min/i, "Week 8 saved day view should display authored 6x1min sharpen summary");
    assert.equal(weekEightRace?.type, "RACE", "Week 8 should include race day");
    assert.equal(Number(weekEightRace?.plannedDistanceKm), 10, "Week 8 race should stay 10K");
    const hasPrimary45SecondRep = allPlanSteps(templatePlan).some((step) => {
      const type = String(step?.stepType || "").toLowerCase();
      const durationType = String(step?.durationType || "").toLowerCase();
      return type === "steady" && durationType === "time" && Number(step?.durationValue) === 45;
    });
    assert.equal(hasPrimary45SecondRep, false, "template plan should not contain 45-second dynamic replacements");
    assert.doesNotMatch(JSON.stringify(templatePlan), /10\s*x\s*45|10x45|45s/i, "template plan output should not contain a 10x45s legacy string");
    assert.ok(
      templatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved templates"
    );
    assert.ok(
      templatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(countSteadyDistanceSteps(templatePlan.weeks[4].sessions.find((s) => s.role === "quality"), 1000) >= 4, "Week 5 4x1km should retain authored distance reps");
    assert.ok(templatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to template sessions");
    assert.ok(templatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to template sessions");
    assert.ok(templatePlan.validationSummary?.approval, "validation should still run for template plan");
    assert.ok(Array.isArray(templatePlan.validationTrace), "validation trace should still be returned for template plan");

    const template4Profile = makeProfile({
      goal: { distance: "10K", planLengthWeeks: 8, targetTime: "50:00" },
      current: { experience: "Regular runner", weeklyKm: 20, longestRunKm: 12 },
      availability: { sessionsPerWeek: 4, runDays: ["Mon", "Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "50:00" } },
    });
    const template4Result = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: template4Profile }
    );
    assert.equal(template4Result.status, 200, `4-run template path failed: ${JSON.stringify(template4Result.data)}`);
    const template4Plan = template4Result.data?.plan;
    assert.equal(template4Plan?.planSource, "template", "10K intermediate 8-week 4-run should use template source");
    assert.equal(template4Plan?.templateId, "10k_intermediate_8w_4run", "4-run template response should expose templateId");
    assert.equal(template4Plan?.weeks?.length, 8, "4-run template plan should have 8 weeks");
    assert.equal(template4Plan?.preserveTemplateStructure, true, "4-run template plan should preserve template structure");
    assert.ok(
      template4Plan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 4 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "4-run template should keep four preserved sessions per week"
    );
    assert.ok(
      template4Plan.weeks.every((week) => findSessionByRole(week, "support")),
      "4-run template should include the authored support run each week"
    );
    assert.ok(
      new Set(template4Plan.weeks[0].sessions.map((session) => session.day)).size >= 4,
      "4-run template should map the support run onto a separate available day"
    );
    const template4WeekOneQuality = findSessionByRole(template4Plan.weeks[0], "quality");
    assert.ok(template4WeekOneQuality, "4-run template Week 1 should include a quality session");
    assert.match(String(template4WeekOneQuality?.structure || template4WeekOneQuality?.keyTargets || ""), /3\s*x\s*6/i, "4-run Week 1 quality should be threshold 3x6min");
    assert.equal(template4WeekOneQuality.type, "THRESHOLD", "4-run Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(template4WeekOneQuality, 360), 3, "4-run Week 1 threshold 3x6min should survive intact");
    assert.match(String(template4WeekOneQuality?.summary || template4WeekOneQuality?.workout?.summary || template4WeekOneQuality?.keyTargets || ""), /3\s*x\s*6\s*min/i, "4-run Week 1 should display authored 3x6min summary");
    const template4WeekThreeQuality = findSessionByRole(template4Plan.weeks[2], "quality");
    assert.ok(template4WeekThreeQuality, "4-run template Week 3 should include a quality session");
    assert.equal(template4WeekThreeQuality.type, "INTERVALS", "4-run Week 3 quality should remain INTERVALS");
    assert.equal(countSteadyTimeSteps(template4WeekThreeQuality, 180), 5, "4-run Week 3 5x3min 10K effort should survive intact");
    assert.match(String(template4WeekThreeQuality?.target || ""), /10k_effort/i, "4-run Week 3 should keep 10K effort target placeholder");
    const template4WeekEight = template4Plan.weeks[7];
    const template4WeekEightQuality = findSessionByRole(template4WeekEight, "quality");
    const template4WeekEightRace = findSessionByRole(template4WeekEight, "race");
    assert.equal(String(template4WeekEight?.phase || "").toUpperCase(), "TAPER", "4-run Week 8 should remain taper phase");
    assert.equal(countSteadyTimeSteps(template4WeekEightQuality, 60), 6, "4-run Week 8 short sharpen 6x1min should survive intact");
    assert.match(String(template4WeekEightQuality?.summary || template4WeekEightQuality?.workout?.summary || template4WeekEightQuality?.keyTargets || ""), /6\s*x\s*1\s*min/i, "4-run Week 8 should display authored 6x1min sharpen summary");
    assert.equal(template4WeekEightRace?.type, "RACE", "4-run Week 8 should include race day");
    assert.equal(Number(template4WeekEightRace?.plannedDistanceKm), 10, "4-run Week 8 race should stay 10K");
    assert.doesNotMatch(JSON.stringify(template4Plan), /10\s*x\s*45|10x45|45s/i, "4-run template plan output should not contain a 10x45s legacy string");
    assert.ok(
      template4Plan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved 4-run templates"
    );
    assert.ok(template4Plan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to 4-run template sessions");
    assert.ok(template4Plan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to 4-run template sessions");
    assert.ok(template4Plan.validationSummary?.approval, "validation should still run for 4-run template plan");

    const advancedTemplateProfile = makeProfile({
      goal: { distance: "10K", planLengthWeeks: 10, targetTime: "38:30" },
      current: { experience: "Advanced/competitive", weeklyKm: 60, longestRunKm: 18 },
      availability: { sessionsPerWeek: 5, runDays: ["Tue", "Wed", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "39:00" } },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
    });
    const advancedTemplateResult = await postJson(
      harnessServer.baseUrl,
      "/generate-run",
      { athleteProfile: advancedTemplateProfile }
    );
    assert.equal(advancedTemplateResult.status, 200, `advanced template path failed: ${JSON.stringify(advancedTemplateResult.data)}`);
    const advancedTemplatePlan = advancedTemplateResult.data?.plan;
    assert.equal(advancedTemplatePlan?.planSource, "template", "10K advanced 10-week 5-run should use template source");
    assert.equal(advancedTemplatePlan?.templateId, "10k_advanced_10w_5run", "advanced template response should expose templateId");
    assert.equal(advancedTemplatePlan?.weeks?.length, 10, "advanced template plan should have 10 weeks");
    assert.equal(advancedTemplatePlan?.preserveTemplateStructure, true, "advanced template plan should preserve template structure");
    assert.ok(
      advancedTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.length === 5 &&
        week.sessions.every((session) => session.preserveTemplateStructure === true)
      ),
      "advanced template should keep five preserved sessions per week"
    );
    assert.ok(
      new Set(advancedTemplatePlan.weeks[0].sessions.map((session) => session.day)).size >= 5,
      "advanced template should map five sessions onto five separate available days"
    );
    const advancedWeekOneQuality = findSessionByRole(advancedTemplatePlan.weeks[0], "quality");
    assert.ok(advancedWeekOneQuality, "advanced template Week 1 should include a quality session");
    assert.equal(advancedWeekOneQuality.type, "THRESHOLD", "advanced Week 1 quality should remain THRESHOLD");
    assert.equal(countSteadyTimeSteps(advancedWeekOneQuality, 480), 3, "advanced Week 1 3x8min threshold should survive intact");
    assert.match(String(advancedWeekOneQuality?.summary || advancedWeekOneQuality?.workout?.summary || advancedWeekOneQuality?.keyTargets || ""), /3\s*x\s*8\s*min/i, "advanced Week 1 should display authored 3x8min threshold summary");
    const advancedWeekTwoQuality = findSessionByRole(advancedTemplatePlan.weeks[1], "quality");
    assert.ok(advancedWeekTwoQuality, "advanced template Week 2 should include controlled VO2");
    assert.equal(advancedWeekTwoQuality.type, "INTERVALS", "advanced Week 2 controlled VO2 should remain INTERVALS");
    assert.equal(countSteadyDistanceSteps(advancedWeekTwoQuality, 800), 5, "advanced Week 2 5x800m controlled VO2 should survive intact");
    assert.match(String(advancedWeekTwoQuality?.summary || advancedWeekTwoQuality?.workout?.summary || advancedWeekTwoQuality?.keyTargets || ""), /5\s*x\s*800\s*m/i, "advanced Week 2 should display authored 5x800m summary");
    const advancedWeekFiveQuality = findSessionByRole(advancedTemplatePlan.weeks[4], "quality");
    assert.equal(countSteadyDistanceSteps(advancedWeekFiveQuality, 1000), 5, "advanced Week 5 5x1km 10K effort should survive intact");
    assert.match(String(advancedWeekFiveQuality?.target || ""), /10k_effort/i, "advanced Week 5 should keep 10K effort placeholder");
    const advancedWeekSixQuality = findSessionByRole(advancedTemplatePlan.weeks[5], "quality");
    assert.equal(countSteadyDistanceSteps(advancedWeekSixQuality, 2000), 3, "advanced Week 6 3x2km 10K effort should survive intact");
    const advancedWeekTen = advancedTemplatePlan.weeks[9];
    const advancedWeekTenQuality = findSessionByRole(advancedWeekTen, "quality");
    const advancedWeekTenRace = findSessionByRole(advancedWeekTen, "race");
    assert.equal(String(advancedWeekTen?.phase || "").toUpperCase(), "TAPER", "advanced Week 10 should remain taper phase");
    assert.equal(countSteadyTimeSteps(advancedWeekTenQuality, 60), 6, "advanced Week 10 short sharpen 6x1min should survive intact");
    assert.equal(advancedWeekTenRace?.type, "RACE", "advanced Week 10 should include race day");
    assert.equal(Number(advancedWeekTenRace?.plannedDistanceKm), 10, "advanced Week 10 race should stay 10K");
    assert.doesNotMatch(JSON.stringify(advancedTemplatePlan), /10\s*x\s*45|10x45|45s/i, "advanced template plan output should not contain a 10x45s legacy string");
    assert.ok(
      advancedTemplatePlan.weeks.every((week) =>
        week.sessions.every((session) =>
          session?.workout?.meta?.legacyWorkoutGenerationSkipped === true &&
          session?.workout?.meta?.templateRendered === true &&
          session?.workout?.meta?.templatePickId == null &&
          session?.workout?.meta?.specPickId == null
        )
      ),
      "legacy interval/tempo generation should be skipped for preserved advanced templates"
    );
    assert.ok(
      advancedTemplatePlan.weeks.every((week) =>
        Array.isArray(week.sessions) &&
        week.sessions.every((session) => session.coachNote && session.purpose && session.executionTip)
      ),
      "advanced template sessions should keep coach notes, purpose, and execution tips"
    );
    assert.ok(advancedTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workout?.steps) && session.workout.steps.length), "Garmin steps should attach to advanced template sessions");
    assert.ok(advancedTemplatePlan.weeks[0].sessions.every((session) => Array.isArray(session?.workoutSteps) && session.workoutSteps.length), "display workoutSteps should attach to advanced template sessions");
    assert.ok(advancedTemplatePlan.validationSummary?.approval, "validation should still run for advanced template plan");

    const templateReadiness = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: templateProfile,
        readiness: { score: 45 },
      }
    );
    assert.equal(templateReadiness.status, 200, `template readiness route failed: ${JSON.stringify(templateReadiness.data)}`);
    assert.equal(templateReadiness.data?.planSource, "template", "readiness-adjusted template should retain template source");
    assert.equal(templateReadiness.data?.readinessAdjustment?.level, "low", "readiness adjustment should still run for template plan");
    assert.ok(templateReadiness.data?.validationSummary?.approval, "validation should still run after template readiness adjustment");

    const missing = await postJson(harnessServer.baseUrl, "/generate-run?summary=1", {
      athleteProfile: {
        goal: { distance: "10K" },
      },
    });
    assert.equal(missing.status, 400, "missing critical fields should be rejected");
    assert.ok(Array.isArray(missing.data?.details), "missing-field rejection should include details");

    const lowFrequencyCases = [
      {
        label: "half marathon 1x",
        profile: makeProfile({
          goal: { distance: "Half marathon", planLengthWeeks: 12 },
          current: { weeklyKm: 30, longestRunKm: 12, experience: "Some experience" },
          availability: { sessionsPerWeek: 1, runDays: ["Sun"], longRunDay: "Sun" },
        }),
      },
      {
        label: "marathon 1x",
        profile: makeProfile({
          goal: { distance: "Marathon", planLengthWeeks: 16 },
          current: { weeklyKm: 42, longestRunKm: 18, experience: "Regular runner" },
          availability: { sessionsPerWeek: 1, runDays: ["Sun"], longRunDay: "Sun" },
        }),
      },
      {
        label: "ultra 1x",
        profile: makeProfile({
          goal: { distance: "Ultra", planLengthWeeks: 12 },
          current: { weeklyKm: 45, longestRunKm: 18, experience: "Regular runner" },
          availability: { sessionsPerWeek: 1, runDays: ["Sun"], longRunDay: "Sun" },
        }),
      },
    ];
    for (const { label, profile } of lowFrequencyCases) {
      const blocked = await postJson(
        harnessServer.baseUrl,
        "/generate-run?summary=1",
        { athleteProfile: profile }
      );
      assert.equal(blocked.status, 422, `${label} should be blocked`);
      assert.equal(blocked.data?.code, "LOW_FREQUENCY_FOR_GOAL");
      assert.equal(blocked.data?.warning?.severity, "blocker");
      assert.ok(Array.isArray(blocked.data?.alternatives), `${label} response should include alternatives`);

      const override = await postJson(
        harnessServer.baseUrl,
        "/generate-run?summary=1&allowGoalRisk=1",
        { athleteProfile: profile }
      );
      assert.equal(override.status, 200, `${label} risk override failed: ${JSON.stringify(override.data)}`);
      assert.equal(override.data?.goalRiskValidation?.allowedByOverride, true);
      assert.equal(override.data?.professionalReview?.status, "not_approved");
    }

    const malformedRace = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile({
          pacing: { recentRace: { distance: "10K", time: "not-a-time" } },
        }),
      }
    );
    assert.equal(malformedRace.status, 400, "malformed race anchor should be rejected");

    const unrealisticTarget = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile({
          goal: { distance: "10K", targetTime: "37:30" },
          pacing: { recentRace: { distance: "5K", time: "22:05" } },
        }),
      }
    );
    assert.equal(unrealisticTarget.status, 422, "unrealistic target time should be blocked");
    assert.equal(unrealisticTarget.data?.code, "GOAL_REALISM_UNSAFE");
    assert.equal(unrealisticTarget.data?.goalRealism?.level, "unsafe");

    const impossibleLongestRun = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile({
          current: { weeklyKm: 12, longestRunKm: 18 },
        }),
      }
    );
    assert.equal(impossibleLongestRun.status, 422, "longest run above weekly volume should be blocked");
    assert.equal(impossibleLongestRun.data?.code, "LONGEST_RUN_EXCEEDS_WEEKLY_VOLUME");

    assertGoalRealismLevel(
      "realistic 10K target",
      "realistic",
      makeProfile({
        goal: { distance: "10K", targetTime: "47:00" },
        current: { weeklyKm: 32, longestRunKm: 12, experience: "Some experience" },
        pacing: { recentRace: { distance: "5K", time: "22:05" } },
      })
    );
    assertGoalRealismLevel(
      "challenging 10K target",
      "challenging",
      makeProfile({
        goal: { distance: "10K", targetTime: "43:30" },
        current: { weeklyKm: 32, longestRunKm: 12, experience: "Some experience" },
        pacing: { recentRace: { distance: "5K", time: "22:05" } },
      })
    );
    assertGoalRealismLevel(
      "aggressive 10K target",
      "aggressive",
      makeProfile({
        goal: { distance: "10K", targetTime: "41:00" },
        current: { weeklyKm: 32, longestRunKm: 12, experience: "Some experience" },
        pacing: { recentRace: { distance: "5K", time: "22:05" } },
      })
    );
    assertGoalRealismLevel(
      "unsafe 10K target",
      "unsafe",
      makeProfile({
        goal: { distance: "10K", targetTime: "37:30" },
        current: { weeklyKm: 30, longestRunKm: 11, experience: "Some experience" },
        pacing: { recentRace: { distance: "5K", time: "22:05" } },
      })
    );
    assertGoalRealismLevel(
      "marathon target with low weekly km",
      "unsafe",
      makeProfile({
        goal: { distance: "Marathon", planLengthWeeks: 16, targetTime: "4:15:00" },
        current: { weeklyKm: 15, longestRunKm: 10, experience: "Some experience" },
        availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
        pacing: { recentRace: { distance: "10K", time: "55:00" } },
      })
    );
    assertGoalRealismLevel(
      "half marathon with short plan length",
      "challenging",
      makeProfile({
        goal: { distance: "Half marathon", planLengthWeeks: 8, targetTime: "1:55:00" },
        current: { weeklyKm: 24, longestRunKm: 12, experience: "Some experience" },
        availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
        pacing: { recentRace: { distance: "10K", time: "54:00" } },
      })
    );
    runWorkoutScoringChecks();
    runMissedSessionRepairChecks();
    runReadinessAdjustmentChecks();
    runStrengthAwarenessChecks();
    runWeeklyRecalculationChecks();
    runExpandedFinalValidationChecks();
    runDynamicPaceModelChecks();
    runPlanExplanationChecks();
    runSessionCompletionAnalysisChecks();

    const repairedRoute = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile(),
        missedSession: { weekIndex: 1, day: "Tue", type: "INTERVALS" },
      }
    );
    assert.equal(repairedRoute.status, 200, `missed-session route repair failed: ${JSON.stringify(repairedRoute.data)}`);
    assert.ok(repairedRoute.data?.missedSessionRepair, "summary should include missedSessionRepair");
    assert.ok(repairedRoute.data?.missedSessionRepairTrace, "summary should include missedSessionRepairTrace");

    const readinessRoute = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile(),
        readiness: { score: 45 },
      }
    );
    assert.equal(readinessRoute.status, 200, `readiness route adjustment failed: ${JSON.stringify(readinessRoute.data)}`);
    assert.equal(readinessRoute.data?.readinessAdjustment?.level, "low");
    assert.ok(Array.isArray(readinessRoute.data?.readinessAdjustmentTrace), "summary should include readiness trace");

    const strengthRoute = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile(),
        strengthTraining: {
          enabled: true,
          sessionsPerWeek: 3,
          days: ["TUESDAY", "THURSDAY", "SATURDAY"],
          lowerBodyDays: ["TUESDAY"],
          heavyLowerBodyDays: ["TUESDAY"],
          hyroxDays: ["THURSDAY"],
          priority: "hybrid",
        },
      }
    );
    assert.equal(strengthRoute.status, 200, `strength route adjustment failed: ${JSON.stringify(strengthRoute.data)}`);
    assert.ok(strengthRoute.data?.strengthAdjustment, "summary should include strengthAdjustment");
    assert.ok(Array.isArray(strengthRoute.data?.strengthAdjustmentTrace), "summary should include strength trace");

    const weeklyRoute = await postJson(
      harnessServer.baseUrl,
      "/generate-run?summary=1",
      {
        athleteProfile: makeProfile(),
        completedSessions: [
          { weekIndex: 1, day: "Tue", type: "INTERVALS", plannedDistanceKm: 7, actualDistanceKm: 3, status: "completed" },
          { weekIndex: 1, day: "Thu", type: "EASY", plannedDistanceKm: 6, actualDistanceKm: 0, status: "skipped" },
          { weekIndex: 1, day: "Sun", type: "LONG", plannedDistanceKm: 9, actualDistanceKm: 0, status: "skipped" },
        ],
      }
    );
    assert.equal(weeklyRoute.status, 200, `weekly recalculation route failed: ${JSON.stringify(weeklyRoute.data)}`);
    assert.ok(weeklyRoute.data?.weeklyRecalculation, "summary should include weeklyRecalculation");
    assert.ok(Array.isArray(weeklyRoute.data?.weeklyRecalculationTrace), "summary should include weekly recalculation trace");
    assert.ok(weeklyRoute.data?.validationSummary?.approval, "summary should include final validation after adaptive layers");
  } finally {
    await close(harnessServer.server);
  }

  console.log("[plan-generator-e2e] passed");
  console.log(" - health works without Firebase credentials");
  console.log(" - protected app route rejects missing auth");
  console.log(" - generator happy path returns summary plan");
  console.log(" - missing profile fields reject cleanly");
  console.log(" - low-frequency goals block unless explicitly overridden");
  console.log(" - malformed personalization anchors reject cleanly");
  console.log(" - unrealistic profile quality inputs reject cleanly");
  console.log(" - goal realism scoring covers realistic/challenging/aggressive/unsafe scenarios");
  console.log(" - workout candidate scoring covers goal/phase/level/repeat/budget cases");
  console.log(" - missed-session repair covers easy, quality, long, multiple, and taper cases");
  console.log(" - readiness adjustment covers high/moderate/low/very-low, injury, race, completed, and taper cases");
  console.log(" - strength awareness covers heavy legs, Hyrox, priorities, completed sessions, and race protection");
  console.log(" - adaptive weekly recalculation covers completion, overtraining, missed quality/long, taper, race, and completed-session protection");
  console.log(" - expanded final validation covers overload, spacing, load, taper, Garmin structure, race-specific checks, beginners, and race protection");
  console.log(" - dynamic pace physiology covers race equivalents, readiness, trail/effort, treadmill, low confidence, and HR anchors");
  console.log(" - plan explanation covers summaries, coach notes, session purpose, adaptive explanations, and wording hygiene");
  console.log(" - session completion analysis covers matched, overdone, partial, mismatched, and missed runs");
}

main().catch((err) => {
  console.error("[plan-generator-e2e] failed");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
