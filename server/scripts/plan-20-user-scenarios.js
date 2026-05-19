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

function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}

function kind(session) {
  return String(session?.workoutKind || session?.type || session?.sessionType || "").toUpperCase();
}

function isQuality(session) {
  return ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS"].includes(kind(session));
}

function qualityCount(week) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).filter(isQuality).length;
}

function hasRaceSession(week) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).some((s) => kind(s) === "RACE");
}

function weeklyKm(week) {
  return (
    toNum(week?.metrics?.displayWeeklyKm) ??
    toNum(week?.metrics?.renderedWeeklyKm) ??
    toNum(week?.metrics?.plannedWeeklyKm) ??
    0
  );
}

function makeProfile(overrides = {}) {
  const base = {
    goal: { distance: "10K", planLengthWeeks: 12, targetDate: "2026-10-01" },
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

function scorePlanQuality(plan) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const review = plan?.professionalReview || {};
  let score = 100;
  const notes = [];

  const blockers = toNum(review?.blockers) ?? 0;
  const warnings = toNum(review?.warnings) ?? 0;
  if (blockers > 0) {
    score -= blockers * 30;
    notes.push(`${blockers} blocker(s)`);
  }
  if (warnings > 0) {
    score -= Math.min(20, warnings * 2);
    notes.push(`${warnings} warning(s)`);
  }

  const weekly = weeks.map(weeklyKm);
  for (let i = 1; i < weekly.length; i += 1) {
    const prev = weekly[i - 1];
    const cur = weekly[i];
    if (prev <= 0 || cur <= 0) continue;
    const phase = String(weeks[i]?.phase || "").toLowerCase();
    const deltaPct = ((cur - prev) / prev) * 100;
    if ((phase === "deload" || phase === "taper") && deltaPct > -2) {
      score -= 3;
      notes.push(`w${i + 1} ${phase} not lighter`);
    } else if (!["deload", "taper"].includes(phase) && deltaPct > 24) {
      score -= 5;
      notes.push(`w${i + 1} ramp ${round1(deltaPct)}%`);
    } else if (!["deload", "taper"].includes(phase) && deltaPct > 18) {
      score -= 2;
      notes.push(`w${i + 1} ramp ${round1(deltaPct)}%`);
    }
  }

  for (const week of weeks) {
    const q = toNum(week?.metrics?.displayQualitySharePct) ?? toNum(week?.metrics?.qualitySharePct);
    const l = toNum(week?.metrics?.displayLongRunSharePct) ?? toNum(week?.metrics?.longRunSharePct);
    const phase = String(week?.phase || "").toLowerCase();
    const raceWeek = hasRaceSession(week);

    if (q != null) {
      if (phase === "taper" && q > 28) {
        score -= 4;
        notes.push(`w${week.weekIndex} taper quality ${q}%`);
      } else if (q > 36) {
        score -= 4;
        notes.push(`w${week.weekIndex} quality ${q}%`);
      }
    }

    if (!raceWeek && l != null && (l < 18 || l > 42)) {
      score -= 3;
      notes.push(`w${week.weekIndex} long share ${l}%`);
    }
  }

  return {
    score: Math.max(0, Math.round(score)),
    notes,
  };
}

function expectedMaxQuality({ level, sessionsPerWeek, goal }) {
  if (goal === "RETURN") return 0;
  if (goal === "GENERAL" && level === "beginner") return 0;
  if (sessionsPerWeek <= 2) return 1;
  if (level === "advanced" && sessionsPerWeek >= 4) return 2;
  if (level === "intermediate" && sessionsPerWeek >= 5) return 2;
  return 1;
}

const SCENARIOS = [
  {
    id: "return_to_running_3x",
    expectedGoal: "RETURN",
    expectedLevel: "beginner",
    minScore: 70,
    profile: makeProfile({
      goal: { distance: "Return to running", planLengthWeeks: 6 },
      current: { age: 36, experience: "New to running", weeklyKm: 0, longestRunKm: 0 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: null,
      hr: null,
    }),
  },
  {
    id: "general_fitness_beginner_3x",
    expectedGoal: "GENERAL",
    expectedLevel: "beginner",
    minScore: 75,
    profile: makeProfile({
      goal: { distance: "General fitness", planLengthWeeks: 8 },
      current: { age: 30, experience: "New to running", weeklyKm: 8, longestRunKm: 3 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: null,
      hr: { resting: 58 },
    }),
  },
  {
    id: "beginner_5k_finish_3x",
    expectedGoal: "5K",
    expectedLevel: "beginner",
    minScore: 75,
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8 },
      current: { age: 29, experience: "New to running", weeklyKm: 12, longestRunKm: 5 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "5K", time: "32:00" } },
      hr: { resting: 58 },
    }),
  },
  {
    id: "beginner_5k_improve_4x",
    expectedGoal: "5K",
    expectedLevel: "beginner",
    minScore: 75,
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 8 },
      current: { age: 27, experience: "New to running", weeklyKm: 18, longestRunKm: 6 },
      availability: { sessionsPerWeek: 4, runDays: ["Mon", "Wed", "Fri", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "balanced", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "5K", time: "29:30" } },
    }),
  },
  {
    id: "intermediate_5k_pb_4x",
    expectedGoal: "5K",
    expectedLevel: "intermediate",
    minScore: 80,
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 10 },
      current: { age: 34, experience: "Some experience", weeklyKm: 28, longestRunKm: 9 },
      availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "5K", time: "24:00" } },
    }),
  },
  {
    id: "advanced_5k_race_5x",
    expectedGoal: "5K",
    expectedLevel: "advanced",
    minScore: 80,
    profile: makeProfile({
      goal: { distance: "5K", planLengthWeeks: 10 },
      current: { age: 25, experience: "Advanced/competitive", weeklyKm: 55, longestRunKm: 15 },
      availability: { sessionsPerWeek: 5, runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "5K", time: "18:45" } },
      hr: { resting: 44 },
    }),
  },
  {
    id: "beginner_10k_first_3x",
    expectedGoal: "10K",
    expectedLevel: "beginner",
    minScore: 72,
    profile: makeProfile({
      goal: { distance: "10K", planLengthWeeks: 10 },
      current: { age: 42, experience: "New to running", weeklyKm: 18, longestRunKm: 7 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "easy", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "5K", time: "31:00" } },
    }),
  },
  {
    id: "intermediate_10k_pb_4x",
    expectedGoal: "10K",
    expectedLevel: "intermediate",
    minScore: 82,
    profile: makeProfile(),
  },
  {
    id: "advanced_10k_5x",
    expectedGoal: "10K",
    expectedLevel: "advanced",
    minScore: 78,
    profile: makeProfile({
      current: { age: 31, experience: "Advanced/competitive", weeklyKm: 60, longestRunKm: 18 },
      availability: { sessionsPerWeek: 5, runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "10K", time: "40:00" } },
      hr: { resting: 45 },
    }),
  },
  {
    id: "half_first_timer_3x",
    expectedGoal: "HALF",
    expectedLevel: "intermediate",
    minScore: 75,
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: { age: 35, experience: "Some experience", weeklyKm: 28, longestRunKm: 12 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "58:00" } },
    }),
  },
  {
    id: "half_intermediate_4x",
    expectedGoal: "HALF",
    expectedLevel: "intermediate",
    minScore: 80,
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: { age: 39, experience: "Regular runner", weeklyKm: 42, longestRunKm: 16 },
      availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "47:30" } },
    }),
  },
  {
    id: "half_advanced_5x",
    expectedGoal: "HALF",
    expectedLevel: "advanced",
    minScore: 78,
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: { age: 33, experience: "Advanced/competitive", weeklyKm: 65, longestRunKm: 21 },
      availability: { sessionsPerWeek: 5, runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "10K", time: "40:30" } },
      hr: { resting: 43 },
    }),
  },
  {
    id: "marathon_first_timer_3x",
    expectedGoal: "MARATHON",
    expectedLevel: "intermediate",
    minScore: 72,
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: { age: 41, experience: "Some experience", weeklyKm: 35, longestRunKm: 16 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Half marathon", time: "2:05:00" } },
    }),
  },
  {
    id: "marathon_intermediate_4x",
    expectedGoal: "MARATHON",
    expectedLevel: "intermediate",
    minScore: 78,
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: { age: 38, experience: "Regular runner", weeklyKm: 50, longestRunKm: 22 },
      availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Half marathon", time: "1:50:00" } },
    }),
  },
  {
    id: "marathon_advanced_5x",
    expectedGoal: "MARATHON",
    expectedLevel: "advanced",
    minScore: 76,
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: { age: 41, experience: "Advanced/competitive", weeklyKm: 75, longestRunKm: 28 },
      availability: { sessionsPerWeek: 5, runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "Half marathon", time: "1:28:00" } },
      hr: { resting: 45, lthr: 174 },
    }),
  },
  {
    id: "ultra_regular_4x",
    expectedGoal: "ULTRA",
    expectedLevel: "intermediate",
    minScore: 74,
    profile: makeProfile({
      goal: { distance: "Ultra", planLengthWeeks: 16 },
      current: { age: 37, experience: "Regular runner", weeklyKm: 55, longestRunKm: 24 },
      availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Marathon", time: "4:10:00" } },
      hr: { resting: 50 },
    }),
  },
  {
    id: "ultra_advanced_5x",
    expectedGoal: "ULTRA",
    expectedLevel: "advanced",
    minScore: 74,
    profile: makeProfile({
      goal: { distance: "Ultra", planLengthWeeks: 18 },
      current: { age: 36, experience: "Advanced/competitive", weeklyKm: 80, longestRunKm: 32 },
      availability: { sessionsPerWeek: 5, runDays: ["Mon", "Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
      preferences: { difficulty: "hard", metric: "distance", treadmill: false },
      pacing: { recentRace: { distance: "Marathon", time: "3:20:00" } },
      hr: { resting: 43 },
    }),
  },
  {
    id: "half_1x_blocked",
    expectedGoal: "HALF",
    expectedLevel: "intermediate",
    expectedStatus: ["not_approved"],
    profile: makeProfile({
      goal: { distance: "Half marathon", planLengthWeeks: 12 },
      current: { age: 35, experience: "Some experience", weeklyKm: 30, longestRunKm: 12 },
      availability: { sessionsPerWeek: 1, runDays: ["Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "10K", time: "54:00" } },
    }),
  },
  {
    id: "marathon_2x_blocked",
    expectedGoal: "MARATHON",
    expectedLevel: "intermediate",
    expectedStatus: ["not_approved"],
    profile: makeProfile({
      goal: { distance: "Marathon", planLengthWeeks: 16 },
      current: { age: 40, experience: "Regular runner", weeklyKm: 42, longestRunKm: 18 },
      availability: { sessionsPerWeek: 2, runDays: ["Tue", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Half marathon", time: "1:55:00" } },
    }),
  },
  {
    id: "ultra_3x_blocked",
    expectedGoal: "ULTRA",
    expectedLevel: "intermediate",
    expectedStatus: ["not_approved"],
    profile: makeProfile({
      goal: { distance: "Ultra", planLengthWeeks: 16 },
      current: { age: 37, experience: "Regular runner", weeklyKm: 55, longestRunKm: 24 },
      availability: { sessionsPerWeek: 3, runDays: ["Tue", "Thu", "Sun"], longRunDay: "Sun" },
      pacing: { recentRace: { distance: "Marathon", time: "4:00:00" } },
    }),
  },
];

const results = SCENARIOS.map((scenario) => {
  const plan = applyRunPlanRules(null, scenario.profile);
  const stock = plan?.meta?.stockPlan;
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const review = plan?.professionalReview || {};
  const status = String(review?.status || "");
  const expectedStatus = scenario.expectedStatus || ["approved", "approved_with_caveats"];

  ensure(expectedStatus.includes(status), `${scenario.id}: unexpected status ${status}`);
  ensure(stock?.source === "stock-plan-template", `${scenario.id}: missing stock plan`);
  ensure(stock?.goal === scenario.expectedGoal, `${scenario.id}: expected goal ${scenario.expectedGoal}, got ${stock?.goal}`);
  ensure(stock?.level === scenario.expectedLevel, `${scenario.id}: expected level ${scenario.expectedLevel}, got ${stock?.level}`);
  ensure(weeks.length === scenario.profile.goal.planLengthWeeks, `${scenario.id}: week count mismatch`);

  const phases = weeks.map((w) => String(w?.phase || "").toUpperCase());
  if (status !== "not_approved") {
    ensure((toNum(review?.blockers) ?? 0) === 0, `${scenario.id}: approved plan has blockers`);
    if (!["GENERAL", "RETURN"].includes(stock.goal)) {
      ensure(phases.includes("TAPER"), `${scenario.id}: missing taper`);
    }
    if (weeks.length >= 8) {
      ensure(phases.includes("DELOAD"), `${scenario.id}: missing deload`);
    }

    const maxQ = Math.max(...weeks.map(qualityCount));
    const expectedQ = expectedMaxQuality({
      level: scenario.expectedLevel,
      sessionsPerWeek: scenario.profile.availability.sessionsPerWeek,
      goal: scenario.expectedGoal,
    });
    ensure(maxQ <= expectedQ, `${scenario.id}: too many quality sessions (${maxQ} > ${expectedQ})`);

    const firstWeekKm = weeklyKm(weeks[0]);
    const currentKm = toNum(scenario.profile.current.weeklyKm);
    if (currentKm != null && currentKm > 0) {
      ensure(firstWeekKm >= currentKm * 0.75, `${scenario.id}: week 1 volume too low`);
      ensure(firstWeekKm <= currentKm * 1.25, `${scenario.id}: week 1 volume too high`);
    }
  } else {
    ensure((toNum(review?.blockers) ?? 0) > 0, `${scenario.id}: not-approved plan missing blocker`);
  }

  const quality = scorePlanQuality(plan);
  if (status !== "not_approved") {
    ensure(
      quality.score >= (scenario.minScore ?? 70),
      `${scenario.id}: quality score ${quality.score} below ${scenario.minScore ?? 70}; ${quality.notes.join(", ")}`
    );
  }

  return {
    id: scenario.id,
    status,
    level: stock.level,
    stock: stock.id,
    qualityScore: quality.score,
    week1Km: round1(weeklyKm(weeks[0])),
    peakKm: round1(Math.max(...weeks.map(weeklyKm))),
    maxQuality: Math.max(...weeks.map(qualityCount)),
    intervalPace: toNum(plan?.paces?.interval?.minSecPerKm),
    notes: quality.notes,
  };
});

const beginner5k = results.find((r) => r.id === "beginner_5k_finish_3x");
const advanced5k = results.find((r) => r.id === "advanced_5k_race_5x");
const intermediate10k = results.find((r) => r.id === "intermediate_10k_pb_4x");
const advanced10k = results.find((r) => r.id === "advanced_10k_5x");

ensure(
  beginner5k && advanced5k && advanced5k.week1Km > beginner5k.week1Km * 3,
  "advanced 5K volume should scale well above beginner 5K volume"
);
ensure(
  beginner5k && advanced5k && advanced5k.intervalPace < beginner5k.intervalPace,
  "advanced 5K pace should scale faster than beginner 5K pace"
);
ensure(
  intermediate10k && advanced10k && advanced10k.maxQuality > intermediate10k.maxQuality,
  "advanced 10K should carry more quality capacity than intermediate 10K"
);

const approved = results.filter((r) => r.status !== "not_approved");
const blocked = results.filter((r) => r.status === "not_approved");
const avgScore = round1(approved.reduce((sum, r) => sum + r.qualityScore, 0) / Math.max(1, approved.length));

console.log("[plan-20-scenarios] QA passed");
console.log(` - scenarios: ${results.length}`);
console.log(` - approved/with-caveats: ${approved.length}`);
console.log(` - not-approved: ${blocked.length}`);
console.log(` - avg approved quality score: ${avgScore}`);
for (const r of results) {
  console.log(
    ` - ${r.id}: ${r.status}, level=${r.level}, score=${r.qualityScore}, week1=${r.week1Km}km, peak=${r.peakKm}km, maxQ=${r.maxQuality}`
  );
}
