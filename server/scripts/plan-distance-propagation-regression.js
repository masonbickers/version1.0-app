import { applyRunPlanRules } from "../lib/train/planRules/index.js";

function fail(msg) {
  throw new Error(msg);
}

function ensure(cond, msg) {
  if (!cond) fail(msg);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const PROFILE = {
  goal: { distance: "10K", planLengthWeeks: 6, targetDate: "2026-07-12" },
  current: {
    age: 30,
    experience: "Some experience",
    weeklyKm: 35,
    longestRunKm: 14,
  },
  availability: {
    sessionsPerWeek: 3,
    runDays: ["Tue", "Thu", "Sun"],
    longRunDay: "Sun",
  },
  preferences: { difficulty: "balanced", metric: "distance" },
  pacing: { recentRace: { distance: "10K", time: "42:00" } },
  hr: { resting: 52 },
};

function main() {
  const plan = applyRunPlanRules(null, PROFILE);
  const week1 = plan?.weeks?.[0];
  const metrics = week1?.metrics || {};
  const interval = Array.isArray(week1?.sessions)
    ? week1.sessions.find((s) => s?.type === "INTERVALS")
    : null;

  ensure(plan?.distanceContract?.model === "dual_budget_and_rendered", "distance contract model changed");
  ensure(plan?.distanceContract?.weeklyMetricsPrimary === "budgeted", "weekly primary metric changed");
  ensure(interval, "missing week1 intervals session");

  const plannedKm = toNum(interval?.plannedDistanceKm);
  const budgetMUsed = toNum(interval?.workout?.meta?.budgetMUsed);
  const renderedKm = toNum(interval?.renderedDistanceKm);
  const computedKm = toNum(interval?.computedFromStepsKm);

  ensure(plannedKm != null && plannedKm > 0, "invalid plannedDistanceKm");
  ensure(budgetMUsed != null && budgetMUsed > 0, "invalid workout.meta.budgetMUsed");
  ensure(renderedKm != null && computedKm != null, "missing rendered/computed distance");

  ensure(
    Math.abs(budgetMUsed - Math.round(plannedKm * 1000)) <= 120,
    `stale interval budget propagation: planned=${plannedKm} budgetMUsed=${budgetMUsed}`
  );

  // Contract remains dual: rendered/computed are executable values and may be below planned.
  ensure(
    renderedKm <= plannedKm + 0.01 && computedKm <= plannedKm + 0.01,
    `unexpected rendered/computed > planned (${renderedKm}/${computedKm} > ${plannedKm})`
  );

  const notes = Array.isArray(metrics?.guardrailNotes) ? metrics.guardrailNotes.join(" | ") : "";
  ensure(Array.isArray(metrics?.guardrailNotes), `guardrailNotes should be an array: ${notes}`);

  // Invariance checks: this fix must not alter personalization precedence or targets.
  ensure(plan?.anchorTrace?.pace?.selectedPath === "recent_race_or_pb", "pace trace changed");
  ensure(plan?.anchorTrace?.hr?.selectedPath === "resting_override_to_hrr", "hr trace changed");
  ensure(plan?.decisionTrace?.paceSource?.selectedPath === "recent_race_or_pb", "decisionTrace paceSource changed");
  ensure(
    Array.isArray(plan?.decisionTrace?.allocationReason?.weeks) &&
      plan.decisionTrace.allocationReason.weeks.length === (plan?.weeks?.length || 0),
    "decisionTrace allocationReason weeks missing"
  );
  ensure(
    Array.isArray(plan?.decisionTrace?.repairsApplied?.weeks) &&
      plan.decisionTrace.repairsApplied.weeks.length === (plan?.weeks?.length || 0),
    "decisionTrace repairsApplied weeks missing"
  );

  const targetPace = interval?.targetPace || {};
  const targetHr = interval?.targetHr || {};
  ensure(
    toNum(targetPace?.minSecPerKm) === 227 && toNum(targetPace?.maxSecPerKm) === 244,
    `interval targetPace changed: ${JSON.stringify(targetPace)}`
  );
  ensure(
    toNum(targetHr?.minBpm) === 162 && toNum(targetHr?.maxBpm) === 176,
    `interval targetHr changed: ${JSON.stringify(targetHr)}`
  );

  console.log("[plan-distance-propagation] regression passed");
  console.log(
    ` - week1 intervals: planned=${plannedKm}km budgetMUsed=${Math.round(budgetMUsed)}m rendered=${renderedKm}km computed=${computedKm}km`
  );
  console.log(` - traces: pace=${plan?.anchorTrace?.pace?.selectedPath} hr=${plan?.anchorTrace?.hr?.selectedPath}`);
}

try {
  main();
} catch (err) {
  console.error("[plan-distance-propagation] regression failed");
  console.error(err?.message || err);
  process.exit(1);
}
