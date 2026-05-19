import { applyRunPlanRules, getLowFrequencyGoalWarning } from "../lib/train/planRules/index.js";
import { validateInputContract, validatePersonalizationInputs } from "../routes/generate-run.js";

function fail(message) {
  throw new Error(message);
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function makeProfile(overrides = {}) {
  const base = {
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
    ...base,
    ...overrides,
    goal: { ...base.goal, ...(overrides.goal || {}) },
    current: { ...base.current, ...(overrides.current || {}) },
    availability: { ...base.availability, ...(overrides.availability || {}) },
    preferences: { ...base.preferences, ...(overrides.preferences || {}) },
    pacing: overrides.pacing === null ? undefined : { ...base.pacing, ...(overrides.pacing || {}) },
    hr: overrides.hr === null ? undefined : { ...base.hr, ...(overrides.hr || {}) },
  };
}

const SCENARIOS = [
  {
    id: "new_runner_5k",
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8 },
      current: {
        age: 29,
        experience: "New to running",
        weeklyKm: 14,
        longestRunKm: 5,
      },
      availability: {
        sessionsPerWeek: 3,
        runDays: ["Tue", "Thu", "Sun"],
        longRunDay: "Sun",
      },
      pacing: { recentRace: { distance: "5K", time: "32:00" } },
      hr: { resting: 58 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "comeback_runner_10k_after_break",
    profile: makeProfile({
      goal: { distance: "10K", planLengthWeeks: 10 },
      current: {
        age: 37,
        experience: "Some experience",
        weeklyKm: 16,
        longestRunKm: 6,
      },
      availability: {
        sessionsPerWeek: 3,
        runDays: ["Tue", "Thu", "Sun"],
        longRunDay: "Sun",
      },
      preferences: { difficulty: "easy" },
      pacing: { recentRace: { distance: "5K", time: "30:30" } },
      hr: { resting: 57 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "fast_5k_runner",
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 10 },
      current: {
        age: 28,
        experience: "Advanced/competitive",
        weeklyKm: 62,
        longestRunKm: 18,
      },
      availability: {
        sessionsPerWeek: 5,
        runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"],
        longRunDay: "Sun",
      },
      preferences: { difficulty: "hard" },
      pacing: { recentRace: { distance: "5K", time: "17:45" } },
      hr: { resting: 43, lthr: 178 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "some_experience_10k",
    profile: makeProfile({
      goal: { distance: "10K", planLengthWeeks: 10 },
      current: {
        age: 34,
        experience: "Some experience",
        weeklyKm: 28,
        longestRunKm: 10,
      },
      availability: {
        sessionsPerWeek: 4,
        runDays: ["Mon", "Wed", "Fri", "Sun"],
        longRunDay: "Sun",
      },
      pacing: { recentRace: { distance: "10K", time: "52:00" } },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "first_marathoner",
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: {
        age: 40,
        experience: "Some experience",
        weeklyKm: 38,
        longestRunKm: 18,
      },
      availability: {
        sessionsPerWeek: 4,
        runDays: ["Tue", "Thu", "Sat", "Sun"],
        longRunDay: "Sun",
      },
      preferences: { difficulty: "balanced" },
      pacing: { recentRace: { distance: "Half marathon", time: "2:04:00" } },
      hr: { resting: 55 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "regular_half_marathon",
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: {
        age: 39,
        experience: "Regular runner",
        weeklyKm: 44,
        longestRunKm: 17,
      },
      availability: {
        sessionsPerWeek: 4,
        runDays: ["Tue", "Thu", "Sat", "Sun"],
        longRunDay: "Sun",
      },
      pacing: { recentRace: { distance: "10K", time: "46:00" } },
      hr: { resting: 50, lthr: 168 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "advanced_marathon",
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: {
        age: 41,
        experience: "Advanced/competitive",
        weeklyKm: 70,
        longestRunKm: 28,
      },
      availability: {
        sessionsPerWeek: 5,
        runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"],
        longRunDay: "Sun",
      },
      preferences: { difficulty: "hard" },
      pacing: { recentRace: { distance: "Half marathon", time: "1:28:00" } },
      hr: { resting: 45, lthr: 174 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "return_to_running",
    profile: makeProfile({
      goal: { distance: "Return to running", planLengthWeeks: 6 },
      current: {
        age: 36,
        experience: "New to running",
        weeklyKm: 0,
        longestRunKm: 0,
      },
      availability: {
        sessionsPerWeek: 3,
        runDays: ["Tue", "Thu", "Sun"],
        longRunDay: "Sun",
      },
      preferences: { difficulty: "easy" },
      pacing: null,
      hr: null,
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
    allowDefaultTargets: true,
  },
  {
    id: "low_availability_half_marathon",
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: {
        age: 35,
        experience: "Some experience",
        weeklyKm: 30,
        longestRunKm: 12,
      },
      availability: {
        sessionsPerWeek: 1,
        runDays: ["Sun"],
        longRunDay: "Sun",
      },
      pacing: { recentRace: { distance: "10K", time: "54:00" } },
      hr: { resting: 55 },
    }),
    expectedStatus: ["not_approved"],
    expectedLowFrequencyBlock: true,
  },
  {
    id: "ultra_runner_50k",
    profile: makeProfile({
      goal: { distance: "Ultra", planLengthWeeks: 18 },
      current: {
        age: 36,
        experience: "Regular runner",
        weeklyKm: 68,
        longestRunKm: 30,
      },
      availability: {
        sessionsPerWeek: 5,
        runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"],
        longRunDay: "Sun",
      },
      preferences: { difficulty: "balanced" },
      pacing: { recentRace: { distance: "Marathon", time: "3:55:00" } },
      hr: { resting: 49 },
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
  },
  {
    id: "low_availability_marathon",
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: {
        age: 38,
        experience: "Regular runner",
        weeklyKm: 42,
        longestRunKm: 18,
      },
      availability: {
        sessionsPerWeek: 1,
        runDays: ["Sun"],
        longRunDay: "Sun",
      },
      pacing: { recentRace: { distance: "Half marathon", time: "1:55:00" } },
      hr: { resting: 54 },
    }),
    expectedStatus: ["not_approved"],
    expectedLowFrequencyBlock: true,
  },
  {
    id: "low_availability_ultra",
    profile: makeProfile({
      goal: { distance: "Ultra", planLengthWeeks: 12 },
      current: {
        age: 37,
        experience: "Regular runner",
        weeklyKm: 45,
        longestRunKm: 18,
      },
      availability: {
        sessionsPerWeek: 1,
        runDays: ["Sun"],
        longRunDay: "Sun",
      },
      pacing: { recentRace: { distance: "Marathon", time: "4:00:00" } },
      hr: { resting: 54 },
    }),
    expectedStatus: ["not_approved"],
    expectedLowFrequencyBlock: true,
  },
  {
    id: "bad_missing_pace_hr_anchors",
    profile: makeProfile({
      current: {
        age: undefined,
        experience: "Some experience",
        weeklyKm: 30,
        longestRunKm: 11,
      },
      pacing: null,
      hr: null,
    }),
    expectedStatus: ["approved", "approved_with_caveats"],
    allowDefaultTargets: true,
    expectDefaultTargets: true,
  },
];

function runScenario(scenario) {
  const contract = validateInputContract(scenario.profile);
  ensure(
    contract.errors.length === 0,
    `${scenario.id}: contract errors: ${contract.errors.join("; ")}`
  );

  const personalization = validatePersonalizationInputs(scenario.profile);
  ensure(
    scenario.allowDefaultTargets || personalization.errors.length === 0,
    `${scenario.id}: personalization errors: ${personalization.errors.join("; ")}`
  );

  const lowFrequencyWarning = getLowFrequencyGoalWarning(
    scenario.profile.goal.distance,
    scenario.profile.availability.sessionsPerWeek
  );
  if (scenario.expectedLowFrequencyBlock) {
    ensure(!!lowFrequencyWarning, `${scenario.id}: expected low-frequency warning`);
  } else {
    ensure(!lowFrequencyWarning, `${scenario.id}: unexpected low-frequency warning`);
  }

  const plan = applyRunPlanRules(null, scenario.profile);
  const review = plan.professionalReview || {};
  ensure(
    scenario.expectedStatus.includes(review.status),
    `${scenario.id}: unexpected professional status ${review.status}`
  );
  ensure(
    Array.isArray(plan.weeks) && plan.weeks.length === scenario.profile.goal.planLengthWeeks,
    `${scenario.id}: generated weeks mismatch`
  );
  ensure(plan.weeks.every((w) => Array.isArray(w.sessions) && w.sessions.length > 0), `${scenario.id}: empty week`);
  ensure(plan.anchorTrace?.pace?.selectedPath, `${scenario.id}: missing pace trace`);
  ensure(plan.anchorTrace?.hr?.selectedPath != null, `${scenario.id}: missing HR trace`);

  if (scenario.expectDefaultTargets) {
    ensure(plan.anchorTrace.pace.selectedPath === "default_policy", `${scenario.id}: expected default pace`);
    ensure(plan.anchorTrace.hr.selectedPath === "none", `${scenario.id}: expected no HR anchor`);
  }

  return {
    id: scenario.id,
    status: review.status,
    blockers: review.blockers || 0,
    warnings: review.warnings || 0,
    pace: plan.anchorTrace.pace.selectedPath,
    hr: plan.anchorTrace.hr.selectedPath,
    lowFrequency: Boolean(lowFrequencyWarning),
  };
}

try {
  const results = SCENARIOS.map(runScenario);
  console.log("[plan-real-scenarios] QA passed");
  for (const result of results) {
    console.log(
      ` - ${result.id}: ${result.status}, blockers=${result.blockers}, warnings=${result.warnings}, pace=${result.pace}, hr=${result.hr}`
    );
  }
} catch (err) {
  console.error("[plan-real-scenarios] QA failed");
  console.error(err?.message || err);
  process.exit(1);
}
