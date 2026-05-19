import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
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

async function postJson(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function createHarness() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    req.user = { uid: "create-run-page-e2e" };
    next();
  });
  app.use("/generate-run", generateRunRouter);
  return app;
}

function makeCreateRunPageProfile(overrides = {}) {
  const base = {
    goal: {
      type: "race",
      distance: "10K",
      primaryFocus: "PB / time goal",
      eventName: "",
      startDate: "2026-06-01",
      anchorDateMode: "start",
      targetDate: null,
      eventDate: null,
      targetTime: "50:00",
      planLengthWeeks: 12,
    },
    availability: {
      sessionsPerWeek: 4,
      runDays: ["Mon", "Tue", "Thu", "Sun"],
      longRunDay: "Sun",
      difficulty: "balanced",
      notes: "",
    },
    current: {
      weeklyKm: 25,
      longestRunKm: 8.8,
      experience: "Some experience",
      age: 32,
      recentTimes: {
        fiveK: "",
        tenK: "",
        half: "",
        marathon: "",
      },
      recentRace: null,
    },
    preferences: {
      difficulty: "balanced",
      trainingFocus: "balanced",
      planQuality: "high",
      metric: "time",
      surfaces: ["Road"],
      focusAreas: [],
      profile: {
        gender: "not_say",
        birthDate: "1994-01-01",
      },
      injuries: "",
      constraints: "",
      treadmill: "No",
      gymAccess: "Yes",
      crossTrainingPreference: "Some",
    },
    pacing: {
      thresholdPaceSecPerKm: 305,
      easyPaceSecPerKm: 345,
      tempoPaceSecPerKm: 305,
      intervalPaceSecPerKm: 285,
      racePaceSecPerKm: 300,
      recentRace: {
        distance: "10K",
        distanceKm: 10,
        timeSec: 3000,
      },
    },
    hr: {},
    templateId: "10k_12w_4",
    templateMeta: {
      distance: "10K",
      weeks: 12,
      runs: 4,
      requestedWeeks: 12,
    },
  };

  return {
    ...base,
    ...overrides,
    goal: { ...base.goal, ...(overrides.goal || {}) },
    availability: { ...base.availability, ...(overrides.availability || {}) },
    current: { ...base.current, ...(overrides.current || {}) },
    preferences: { ...base.preferences, ...(overrides.preferences || {}) },
    pacing: overrides.pacing === null ? {} : { ...base.pacing, ...(overrides.pacing || {}) },
    templateMeta: overrides.templateMeta === null ? null : { ...base.templateMeta, ...(overrides.templateMeta || {}) },
  };
}

function assertCreateRunPageWiring() {
  const sourceUrl = new URL("../../app/(protected)/train/create/create-run.jsx", import.meta.url);
  const source = fs.readFileSync(sourceUrl, "utf8");

  assert.match(source, /currentLongestRunDistance/, "create page should keep longest-run form state");
  assert.match(source, /testID="create-run-longest-run-input"/, "longest-run field should be targetable by UI tests");
  assert.match(source, /testID="create-run-weekly-distance-input"/, "weekly-distance field should be targetable by UI tests");
  assert.match(source, /longestRunKm:\s*longestRunKmNum/, "athleteProfile should use the user-entered longest run");
  assert.match(source, /allowGoalRisk/, "low-frequency confirmation should pass the route risk override");
  assert.match(source, /templateVersion:\s*generatedPlan\?\.templateVersion/, "saved run plans should persist templateVersion");
  assert.match(source, /generatorFeatures:\s*generatedPlan\?\.generatorFeatures/, "saved run plans should persist generatorFeatures");
  assert.match(source, /weeklyRecalculation:\s*generatedPlan\?\.weeklyRecalculation/, "saved run plans should persist weekly recalculation summary");
  assert.match(source, /readinessAdjustment:\s*generatedPlan\?\.readinessAdjustment/, "saved run plans should persist readiness summary");
  assert.match(source, /strengthAdjustment:\s*generatedPlan\?\.strengthAdjustment/, "saved run plans should persist strength summary");
  assert.match(source, /missedSessionRepair:\s*generatedPlan\?\.missedSessionRepair/, "saved run plans should persist missed-session repair summary");
  assert.match(source, /stripRawDebugFields\(\{/, "normal saved run plans should strip raw debug trace fields");

  const viewSource = fs.readFileSync(
    new URL("../../app/(protected)/train/view-plan.jsx", import.meta.url),
    "utf8"
  );
  assert.match(viewSource, /"templateVersion"/, "view-plan reload should preserve templateVersion");
  assert.match(viewSource, /"generatorFeatures"/, "view-plan reload should preserve generatorFeatures");
  assert.match(viewSource, /weeklyRecalculation/, "view-plan reload should preserve adaptive recalculation summary");
  assert.match(viewSource, /PlanIntelligenceCards[\s\S]*generatorFeatures=/, "plan intelligence UI should receive generatorFeatures");
}

async function main() {
  assertCreateRunPageWiring();

  const { server, baseUrl } = await listen(createHarness());
  try {
    const realistic = await postJson(
      baseUrl,
      "/generate-run?summary=1&allowDefaults=1",
      { athleteProfile: makeCreateRunPageProfile() }
    );
    assert.equal(realistic.status, 200, `create-page happy path failed: ${JSON.stringify(realistic.data)}`);
    assert.equal(realistic.data?.weeksCount, 12, "create-page profile should preserve requested plan length");
    assert.equal(realistic.data?.professionalReview?.status, "approved", "realistic profile should be approved");
    assert.equal(realistic.data?.firstWeek?.sessions?.length, 4, "first week should match selected run frequency");
    assert.ok(realistic.data?.planVersion, "create-page summary should include planVersion");
    assert.ok(realistic.data?.rulesEngineVersion, "create-page summary should include rulesEngineVersion");
    assert.ok(realistic.data?.generatorFeatures?.expandedFinalValidation, "create-page summary should include generatorFeatures");
    assert.ok(realistic.data?.inputProfileSnapshot?.goal?.distance, "create-page summary should include inputProfileSnapshot");
    assert.ok(realistic.data?.validationSummary?.approval, "create-page summary should include validationSummary");

    const riskyProfile = makeCreateRunPageProfile({
      goal: {
        distance: "Marathon",
        targetTime: "4:00:00",
        planLengthWeeks: 16,
      },
      availability: {
        sessionsPerWeek: 2,
        runDays: ["Tue", "Sun"],
        longRunDay: "Sun",
      },
      current: {
        weeklyKm: 42,
        longestRunKm: 18,
        experience: "Regular runner",
      },
      pacing: {
        recentRace: {
          distance: "Half marathon",
          time: "1:55:00",
        },
      },
      templateId: null,
      templateMeta: null,
    });

    const blocked = await postJson(
      baseUrl,
      "/generate-run?summary=1&allowDefaults=1",
      { athleteProfile: riskyProfile }
    );
    assert.equal(blocked.status, 422, "risky create-page profile should be blocked without override");
    assert.equal(blocked.data?.code, "LOW_FREQUENCY_FOR_GOAL");

    const override = await postJson(
      baseUrl,
      "/generate-run?summary=1&allowDefaults=1&allowGoalRisk=1",
      { athleteProfile: riskyProfile }
    );
    assert.equal(override.status, 200, `risk override failed: ${JSON.stringify(override.data)}`);
    assert.equal(override.data?.goalRiskValidation?.allowedByOverride, true);
    assert.equal(override.data?.professionalReview?.status, "not_approved");
  } finally {
    await close(server);
  }

  console.log("[plan-create-run-page-e2e] passed");
  console.log(" - create page exposes weekly and longest-run fields for UI tests");
  console.log(" - create page profile generates a personalized 10K plan");
  console.log(" - low-frequency plans block unless allowGoalRisk is passed");
}

main().catch((err) => {
  console.error("[plan-create-run-page-e2e] failed");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
