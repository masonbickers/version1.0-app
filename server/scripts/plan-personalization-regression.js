import { applyRunPlanRules } from "../lib/train/planRules/index.js";
import { validateInputContract, validatePersonalizationInputs } from "../routes/generate-run.js";

function fail(msg) {
  throw new Error(msg);
}

function ensure(cond, msg) {
  if (!cond) fail(msg);
}

const BASE_PROFILE = {
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
};

const CASES = [
  {
    id: "threshold_age_resting",
    profile: {
      ...BASE_PROFILE,
      pacing: { thresholdPaceSecPerKm: 260 },
      hr: { resting: 52 },
    },
    expectedRouteReject: false,
    expectedPacePath: "threshold_pace",
    expectedHrPath: "resting_override_to_hrr",
    expectedIntervalHrSource: "profile_hr_zones_fallback",
    expectedEasyHrSource: "steps",
  },
  {
    id: "recentRace_lthr",
    profile: {
      ...BASE_PROFILE,
      pacing: { recentRace: { distanceKm: 10, timeSec: 2520 } },
      hr: { lthr: 172 },
    },
    expectedRouteReject: false,
    expectedPacePath: "recent_race_or_pb",
    expectedHrPath: "lthr_override",
  },
  {
    id: "recentTimes_age",
    profile: {
      ...BASE_PROFILE,
      current: {
        ...BASE_PROFILE.current,
        recentTimes: { tenK: "42:00" },
      },
    },
    expectedRouteReject: false,
    expectedPacePath: "recent_times_fallback",
    expectedHrPath: "max_only_default",
  },
  {
    id: "no_pace_anchor_age_only",
    profile: { ...BASE_PROFILE },
    expectedRouteReject: false,
    expectedPacePath: "default_policy",
    expectedHrPath: "max_only_default",
  },
  {
    id: "no_profile_hr_generic_default_label",
    profile: {
      ...BASE_PROFILE,
      current: {
        ...BASE_PROFILE.current,
        age: undefined,
      },
    },
    expectedRouteReject: false,
    expectedPacePath: "default_policy",
    expectedHrPath: "none",
    expectedIntervalHrSource: "default",
    expectedEasyHrSource: "default",
  },
  {
    id: "malformed_recentRace",
    profile: {
      ...BASE_PROFILE,
      pacing: { recentRace: { distanceKm: 10, time: "bad" } },
      hr: { resting: 52 },
    },
    expectedRouteReject: true,
    expectedRouteErrorContains: "parseable race result",
    expectedPacePathWhenForced: "default_policy",
  },
];

function getFirstSession(plan) {
  if (!Array.isArray(plan?.weeks) || !plan.weeks.length) return null;
  const week = plan.weeks[0];
  if (!Array.isArray(week?.sessions) || !week.sessions.length) return null;
  return week.sessions[0];
}

function runCase(def) {
  const contract = validateInputContract(def.profile);
  ensure(
    Array.isArray(contract?.errors) && contract.errors.length === 0,
    `${def.id}: contract validation failed unexpectedly: ${JSON.stringify(contract?.errors || [])}`
  );

  const personalization = validatePersonalizationInputs(def.profile);
  const routeReject = Array.isArray(personalization?.errors) && personalization.errors.length > 0;
  ensure(
    routeReject === def.expectedRouteReject,
    `${def.id}: route reject mismatch. expected=${def.expectedRouteReject} actual=${routeReject} errors=${JSON.stringify(personalization?.errors || [])}`
  );

  if (def.expectedRouteReject) {
    ensure(
      (personalization.errors || []).some((e) =>
        String(e).toLowerCase().includes(String(def.expectedRouteErrorContains || "").toLowerCase())
      ),
      `${def.id}: expected route error containing '${def.expectedRouteErrorContains}', got ${JSON.stringify(personalization.errors || [])}`
    );

    // Force planner run to prove malformed payload no longer selects recent-race path.
    const plan = applyRunPlanRules(null, def.profile);
    const forcedPath = plan?.anchorTrace?.pace?.selectedPath || null;
    ensure(
      forcedPath === def.expectedPacePathWhenForced,
      `${def.id}: forced planner path mismatch. expected=${def.expectedPacePathWhenForced} actual=${forcedPath}`
    );
    return {
      id: def.id,
      routeReject,
      routeErrors: personalization.errors || [],
      forcedPlannerPacePath: forcedPath,
    };
  }

  const plan = applyRunPlanRules(null, def.profile);
  const trace = plan?.anchorTrace || null;
  const pacePath = trace?.pace?.selectedPath || null;
  const hrPath = trace?.hr?.selectedPath || null;
  const week1Sessions = Array.isArray(plan?.weeks?.[0]?.sessions) ? plan.weeks[0].sessions : [];
  const intervals = week1Sessions.find((s) => s?.type === "INTERVALS") || null;
  const easy = week1Sessions.find((s) => s?.type === "EASY") || null;

  ensure(!!trace, `${def.id}: missing plan.anchorTrace`);
  ensure(
    pacePath === def.expectedPacePath,
    `${def.id}: pace path mismatch. expected=${def.expectedPacePath} actual=${pacePath}`
  );
  ensure(
    hrPath === def.expectedHrPath,
    `${def.id}: hr path mismatch. expected=${def.expectedHrPath} actual=${hrPath}`
  );

  const s = getFirstSession(plan);
  ensure(!!s, `${def.id}: missing first session`);
  ensure(!!s.targetPace, `${def.id}: missing first session targetPace`);
  ensure(!!s.targetHr, `${def.id}: missing first session targetHr`);
  ensure(!!s.targetSource, `${def.id}: missing first session targetSource`);

  if (def.expectedIntervalHrSource != null) {
    ensure(
      intervals?.targetSource?.hr === def.expectedIntervalHrSource,
      `${def.id}: interval hr source mismatch. expected=${def.expectedIntervalHrSource} actual=${intervals?.targetSource?.hr}`
    );
  }
  if (def.expectedEasyHrSource != null) {
    ensure(
      easy?.targetSource?.hr === def.expectedEasyHrSource,
      `${def.id}: easy hr source mismatch. expected=${def.expectedEasyHrSource} actual=${easy?.targetSource?.hr}`
    );
  }

  return {
    id: def.id,
    routeReject,
    pacePath,
    hrPath,
    firstSession: {
      sessionId: s.sessionId,
      type: s.type,
      targetPace: s.targetPace,
      targetHr: s.targetHr,
      targetSource: s.targetSource,
    },
    intervalTargetSourceHr: intervals?.targetSource?.hr ?? null,
    easyTargetSourceHr: easy?.targetSource?.hr ?? null,
  };
}

function main() {
  const out = CASES.map(runCase);
  console.log("[plan-personalization] regression passed");
  console.log(` - cases: ${out.length}`);
  for (const r of out) {
    if (r.routeReject) {
      console.log(` - ${r.id}: route rejected as expected`);
      continue;
    }
    console.log(` - ${r.id}: pace=${r.pacePath} hr=${r.hrPath}`);
  }
}

try {
  main();
} catch (err) {
  console.error("[plan-personalization] regression failed");
  console.error(err?.message || err);
  process.exit(1);
}
