import { applyRunPlanRules } from "../lib/train/planRules/index.js";

function fail(message) {
  throw new Error(message);
}

function ensure(condition, message) {
  if (!condition) fail(message);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function qualityCount(week) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).filter((s) =>
    ["INTERVALS", "THRESHOLD", "TEMPO", "HILLS"].includes(String(s?.type || "").toUpperCase())
  ).length;
}

function sessionKm(session) {
  return (
    toNum(session?.renderedDistanceKm) ??
    toNum(session?.plannedDistanceKm) ??
    toNum(session?.distanceKm) ??
    0
  );
}

function makeProfile(overrides = {}) {
  const base = {
    goal: { distance: "10K", planLengthWeeks: 12, targetDate: "2026-09-01" },
    current: {
      age: 32,
      experience: "Some experience",
      weeklyKm: 25,
      longestRunKm: 9,
    },
    availability: {
      sessionsPerWeek: 4,
      runDays: ["Mon", "Tue", "Thu", "Sun"],
      longRunDay: "Sun",
    },
    preferences: { difficulty: "balanced", metric: "distance", treadmill: false },
    pacing: { recentRace: { distance: "10K", time: "50:00" } },
    hr: { resting: 52 },
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

const CASES = [
  {
    id: "beginner_5k_3x",
    expectedLevel: "beginner",
    expectedGoal: "5K",
    maxQualityPerWeek: 1,
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8 },
      current: { age: 29, experience: "New to running", weeklyKm: 12, longestRunKm: 5 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "5K", time: "32:00" } },
    }),
  },
  {
    id: "intermediate_10k_4x",
    expectedLevel: "intermediate",
    expectedGoal: "10K",
    maxQualityPerWeek: 1,
    profile: makeProfile(),
  },
  {
    id: "advanced_10k_5x",
    expectedLevel: "advanced",
    expectedGoal: "10K",
    maxQualityPerWeek: 2,
    profile: makeProfile({
      current: { age: 31, experience: "Advanced/competitive", weeklyKm: 60, longestRunKm: 18 },
      availability: { sessionsPerWeek: 5, runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "10K", time: "40:00" } },
      hr: { resting: 45 },
    }),
  },
  {
    id: "advanced_10k_4x",
    expectedLevel: "advanced",
    expectedGoal: "10K",
    maxQualityPerWeek: 1,
    expectedRunDays: ["Mon", "Tue", "Thu", "Sun"],
    minPeakPctOfCurrent: 1,
    profile: makeProfile({
      templateId: "10k_8w_4",
      goal: { distance: "10K", planLengthWeeks: 8 },
      current: { age: 23, experience: "Advanced/competitive", weeklyKm: 40, longestRunKm: 13 },
      availability: { sessionsPerWeek: 4, runDays: ["Mon", "Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "balanced", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "10K", time: "38:00" } },
      hr: {},
    }),
    enforceEasyNotLongerThanLong: true,
  },
  {
    id: "intermediate_half_4x",
    expectedLevel: "intermediate",
    expectedGoal: "HALF",
    maxQualityPerWeek: 1,
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: { age: 37, experience: "Regular runner", weeklyKm: 42, longestRunKm: 16 },
      availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "47:30" } },
    }),
  },
];

const results = CASES.map((testCase) => {
  const plan = applyRunPlanRules(null, testCase.profile);
  const stock = plan?.meta?.stockPlan;
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];

  ensure(stock?.source === "stock-plan-template", `${testCase.id}: missing stock plan metadata`);
  ensure(stock?.goal === testCase.expectedGoal, `${testCase.id}: wrong stock goal ${stock?.goal}`);
  ensure(stock?.level === testCase.expectedLevel, `${testCase.id}: wrong stock level ${stock?.level}`);
  ensure(weeks.length === testCase.profile.goal.planLengthWeeks, `${testCase.id}: week count mismatch`);
  ensure(plan?.professionalReview?.status !== "not_approved", `${testCase.id}: unexpectedly not approved`);

  const phases = weeks.map((w) => String(w?.phase || "").toUpperCase());
  if (!["GENERAL", "RETURN"].includes(stock.goal)) {
    ensure(phases.includes("TAPER"), `${testCase.id}: missing taper phase`);
  }
  if (weeks.length >= 8) {
    ensure(phases.includes("DELOAD"), `${testCase.id}: missing deload phase`);
  }

  const firstWeekKm = toNum(weeks[0]?.metrics?.displayWeeklyKm) ?? toNum(weeks[0]?.metrics?.plannedWeeklyKm);
  const currentKm = toNum(testCase.profile.current.weeklyKm);
  ensure(firstWeekKm != null && currentKm != null, `${testCase.id}: missing weekly km`);
  ensure(firstWeekKm >= currentKm * 0.85, `${testCase.id}: week 1 volume too low`);

  if (testCase.minPeakPctOfCurrent) {
    const peakKm = Math.max(
      ...weeks.map((w) => toNum(w?.metrics?.displayWeeklyKm) ?? toNum(w?.metrics?.plannedWeeklyKm) ?? 0)
    );
    ensure(
      peakKm >= currentKm * testCase.minPeakPctOfCurrent,
      `${testCase.id}: peak volume ${peakKm}km below current ${currentKm}km`
    );
  }

  if (testCase.expectedRunDays) {
    const actualRunDays = (Array.isArray(weeks[0]?.sessions) ? weeks[0].sessions : [])
      .map((s) => String(s?.day || "").trim())
      .filter(Boolean);
    ensure(
      JSON.stringify(actualRunDays) === JSON.stringify(testCase.expectedRunDays),
      `${testCase.id}: week 1 sessions on ${actualRunDays.join(", ")}`
    );
  }

  const maxQuality = Math.max(...weeks.map(qualityCount));
  ensure(maxQuality <= testCase.maxQualityPerWeek, `${testCase.id}: too many quality sessions (${maxQuality})`);

  if (testCase.enforceEasyNotLongerThanLong) {
    for (const week of weeks) {
      const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
      const longKm = Math.max(
        0,
        ...sessions
          .filter((s) => String(s?.type || "").toUpperCase() === "LONG")
          .map(sessionKm)
      );
      const largestEasyKm = Math.max(
        0,
        ...sessions
          .filter((s) => String(s?.type || "").toUpperCase() === "EASY")
          .map(sessionKm)
      );
      ensure(
        largestEasyKm <= longKm + 0.1 || String(week?.phase || "").toLowerCase() === "taper",
        `${testCase.id}: easy run ${largestEasyKm}km exceeds long run ${longKm}km in week ${week.weekNumber || week.weekIndex}`
      );
    }
  }

  const intervalPace = toNum(plan?.paces?.interval?.minSecPerKm);
  ensure(intervalPace != null, `${testCase.id}: missing interval pace`);

  return {
    id: testCase.id,
    stock: stock.id,
    status: plan.professionalReview.status,
    week1Km: Math.round(firstWeekKm * 10) / 10,
    maxQuality,
    intervalPace,
  };
});

const beginner = results.find((r) => r.id === "beginner_5k_3x");
const advanced = results.find((r) => r.id === "advanced_10k_5x");
ensure(
  beginner && advanced && advanced.week1Km > beginner.week1Km * 3,
  "advanced volume should scale well above beginner volume"
);
ensure(
  beginner && advanced && advanced.intervalPace < beginner.intervalPace,
  "advanced pace should scale faster than beginner pace"
);

console.log("[plan-stock-template] regression passed");
for (const r of results) {
  console.log(
    ` - ${r.id}: ${r.stock}, status=${r.status}, week1=${r.week1Km}km, maxQuality=${r.maxQuality}`
  );
}
