import assert from "node:assert/strict";
import { generatePlanFromRequest } from "../src/planner/index.js";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GOAL_CASES = [
  { goal: "5K", weeklyKm: 24, longestRunKm: 9, weekOptions: [6, 8, 10] },
  { goal: "10K", weeklyKm: 36, longestRunKm: 14, weekOptions: [8, 10, 12] },
  { goal: "HALF", weeklyKm: 42, longestRunKm: 16, weekOptions: [10, 12, 16] },
  { goal: "MARATHON", weeklyKm: 54, longestRunKm: 22, weekOptions: [12, 16, 20] },
  { goal: "ULTRA", weeklyKm: 62, longestRunKm: 28, weekOptions: [12, 16, 20] },
];

const SESSION_COUNTS = [2, 3, 4, 5, 6];
const DIFFICULTIES = ["easy", "balanced", "hard"];

function pickRunDays(count) {
  if (count <= 0) return [];
  const out = [];
  const step = 7 / count;
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor(i * step) % 7;
    const day = DAY_ORDER[idx];
    if (!out.includes(day)) out.push(day);
  }

  for (const day of DAY_ORDER) {
    if (out.length >= count) break;
    if (!out.includes(day)) out.push(day);
  }

  return out.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function estimateTargetDate(weeks) {
  // Keep this deterministic; race alignment details are handled in generator.
  const base = new Date("2026-03-01T00:00:00Z");
  const d = new Date(base);
  d.setUTCDate(base.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function makePayload({
  goal,
  planLengthWeeks,
  sessionsPerWeek,
  difficulty,
  weeklyKm,
  longestRunKm,
}) {
  const runDays = pickRunDays(sessionsPerWeek);
  const longRunDay = runDays[runDays.length - 1];

  return {
    athleteProfile: {
      goal: {
        distance: goal,
        planLengthWeeks,
        targetDate: estimateTargetDate(planLengthWeeks),
      },
      current: {
        experience: "Some experience",
        weeklyKm,
        longestRunKm,
        age: 32,
      },
      availability: {
        sessionsPerWeek,
        runDays,
        longRunDay,
      },
      preferences: {
        difficulty,
        metric: "distance",
        treadmill: false,
      },
      pacing: {
        recentRace: {
          distance: goal === "ULTRA" ? "MARATHON" : goal,
          time: goal === "5K" ? "22:00" : goal === "10K" ? "45:00" : goal === "HALF" ? "1:42:00" : "3:40:00",
        },
      },
      hr: {
        resting: 52,
        max: 190,
      },
      templateId:
        goal === "5K"
          ? "5k_8w_4"
          : goal === "10K"
            ? "10k_10w_4"
            : goal === "HALF"
              ? "hm_12w_4"
              : goal === "MARATHON"
                ? "mar_16w_4"
                : "ultra_16w_5",
    },
  };
}

function assertWeekShape(plan, sessionsPerWeek) {
  assert.ok(Array.isArray(plan.weeks), "plan.weeks must be array");
  for (const week of plan.weeks) {
    assert.equal(
      week.sessions.length,
      sessionsPerWeek,
      `week ${week.weekNumber} expected ${sessionsPerWeek} sessions, got ${week.sessions.length}`
    );
    assert.ok(Array.isArray(week.days), "week.days must be array");
    assert.equal(week.days.length, 7, `week ${week.weekNumber} should have 7 day views`);
  }
}

function assertSessionContract(plan) {
  for (const week of plan.weeks) {
    const canonicalIds = new Set((week.sessions || []).map((s) => s.sessionId));
    const derivedIds = new Set();
    for (const day of week.days || []) {
      for (const s of day.sessions || []) derivedIds.add(s.sessionId);
    }

    for (const id of canonicalIds) {
      assert.ok(derivedIds.has(id), `missing day-view copy for session ${id}`);
    }
  }
}

function runMatrix() {
  const failures = [];
  let total = 0;
  let passed = 0;

  for (const g of GOAL_CASES) {
    for (const weeks of g.weekOptions) {
      for (const sessionsPerWeek of SESSION_COUNTS) {
        for (const difficulty of DIFFICULTIES) {
          total += 1;
          const payload = makePayload({
            goal: g.goal,
            planLengthWeeks: weeks,
            sessionsPerWeek,
            difficulty,
            weeklyKm: g.weeklyKm,
            longestRunKm: g.longestRunKm,
          });

          const result = generatePlanFromRequest(payload);
          const caseId = `${g.goal}|${weeks}w|${sessionsPerWeek}x|${difficulty}`;

          try {
            assert.equal(result.ok, true, `generator rejected case ${caseId}: ${(result.errors || []).join("; ")}`);
            const plan = result.plan;

            assert.equal(plan.goal.distance, g.goal, `${caseId}: goal mismatch`);
            assert.equal(plan.weeks.length, weeks, `${caseId}: wrong week count`);
            assert.equal(plan.template?.mode, "stock_adapted", `${caseId}: missing stock template mode`);
            assert.ok(plan.template?.id, `${caseId}: missing template id`);
            assertWeekShape(plan, sessionsPerWeek);
            assertSessionContract(plan);

            const lastWeek = plan.weeks[plan.weeks.length - 1];
            assert.ok(lastWeek.sessions.some((s) => s.type === "RACE"), `${caseId}: race missing in last week`);

            passed += 1;
          } catch (err) {
            failures.push({ caseId, error: err?.message || String(err) });
          }
        }
      }
    }
  }

  if (failures.length) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          total,
          passed,
          failed: failures.length,
          failures: failures.slice(0, 20),
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        total,
        passed,
        failed: 0,
      },
      null,
      2
    )
  );
}

runMatrix();
