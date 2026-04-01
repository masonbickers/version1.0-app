import assert from "node:assert/strict";
import { generateRunPlanV2, normalizeAndValidateRequest } from "../lib/train/newGenerator/index.js";

const payload = {
  athleteProfile: {
    goal: {
      distance: "10K",
      planLengthWeeks: 10,
      targetDate: "2026-10-01",
    },
    current: {
      experience: "Some experience",
      weeklyKm: 36,
      longestRunKm: 14,
      age: 30,
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
        time: "42:00",
      },
    },
    hr: {
      resting: 52,
      max: 190,
    },
  },
  generatorConfig: {
    phaseModel: {
      baseWeeks: 2,
      deloadEvery: 4,
      taperWeeks: 1,
    },
  },
};

const normalized = normalizeAndValidateRequest(payload);
assert.equal(normalized.errors.length, 0, `validation failed: ${normalized.errors.join("; ")}`);

const plan = generateRunPlanV2({
  athleteProfile: normalized.athleteProfile,
  generatorConfig: normalized.generatorConfig,
});

assert.equal(plan.weeks.length, 10, "expected 10 weeks");
assert.equal(plan.weeks[0].sessions.length, 4, "expected 4 sessions in week 1");
assert.ok(plan.weeks[9].sessions.some((s) => s.type === "RACE"), "expected race session in last week");

const sample = {
  week1: {
    phase: plan.weeks[0].phase,
    metrics: plan.weeks[0].metrics,
  },
  lastWeek: {
    phase: plan.weeks[9].phase,
    race: plan.weeks[9].race || null,
    metrics: plan.weeks[9].metrics,
  },
};

console.log(JSON.stringify({ ok: true, sample }, null, 2));
