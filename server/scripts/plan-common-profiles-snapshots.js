import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { applyRunPlanRules } from "../lib/train/planRules/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_DIR = path.join(__dirname, "snapshots");
const SNAPSHOT_FILE = path.join(
  SNAPSHOT_DIR,
  "plan-common-profiles.snapshot.json"
);
const SNAPSHOT_VERSION = 1;

const DISTANCE_CASES = [
  { key: "5k", label: "5K", weeklyKm: 28, longestRunKm: 10, planLengthWeeks: 8 },
  { key: "10k", label: "10K", weeklyKm: 36, longestRunKm: 14, planLengthWeeks: 8 },
  { key: "half", label: "Half marathon", weeklyKm: 44, longestRunKm: 18, planLengthWeeks: 10 },
  { key: "marathon", label: "Marathon", weeklyKm: 54, longestRunKm: 24, planLengthWeeks: 12 },
];

const FREQUENCIES = [3, 4, 5];
const DAY_SETS = {
  3: ["Tue", "Thu", "Sun"],
  4: ["Tue", "Thu", "Sat", "Sun"],
  5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
}

function fail(msg) {
  throw new Error(msg);
}

function ensure(cond, msg) {
  if (!cond) fail(msg);
}

function sessionTypeOf(s) {
  return String(s?.type || s?.workoutKind || s?.sessionType || "").toUpperCase();
}

function buildProfile(distanceDef, sessionsPerWeek) {
  const runDays = DAY_SETS[sessionsPerWeek];
  return {
    goal: {
      distance: distanceDef.label,
      planLengthWeeks: distanceDef.planLengthWeeks,
      targetDate: "2026-10-01",
    },
    current: {
      weeklyKm: distanceDef.weeklyKm,
      longestRunKm: distanceDef.longestRunKm,
      experience: "Some experience",
      age: 30,
    },
    availability: { sessionsPerWeek, runDays, longRunDay: "Sun" },
    preferences: { difficulty: "balanced", metric: "distance" },
    pacing: { thresholdPaceSecPerKm: 305 },
    hr: { max: 190, resting: 52 },

    // compatibility mirror fields used elsewhere in planner
    goalDistance: distanceDef.label,
    weeklyKm: distanceDef.weeklyKm,
    longestRunKm: distanceDef.longestRunKm,
    sessionsPerWeek,
    runDays,
    longRunDay: "Sun",
    experience: "Some experience",
    difficulty: "Balanced",
  };
}

function summarizeWeek(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const metrics = week?.metrics || {};

  return {
    weekIndex: Number(week?.weekIndex || week?.weekNumber || 0) || null,
    phase: String(week?.phase || "").toLowerCase() || null,
    runDays: Array.isArray(week?.runDays) ? [...week.runDays] : [],
    metrics: {
      targetWeeklyKm: round1(metrics?.targetWeeklyKm),
      plannedWeeklyKm: round1(metrics?.plannedWeeklyKm),
      driftKm: round1(metrics?.driftKm),
      qualitySharePct: round1(metrics?.qualitySharePct),
      longRunSharePct: round1(metrics?.longRunSharePct),
    },
    sessions: sessions.map((s) => ({
      day: String(s?.day || ""),
      type: sessionTypeOf(s),
      plannedDistanceKm: round1(s?.plannedDistanceKm),
      renderedDistanceKm: round1(s?.renderedDistanceKm),
      computedTotalKm: round1(s?.computedTotalKm),
    })),
  };
}

function summarizePlan(plan, meta) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  return {
    scenario: meta,
    summary: {
      weeksCount: weeks.length,
      anchorTrace: {
        pacePath: plan?.anchorTrace?.pace?.selectedPath || null,
        hrPath: plan?.anchorTrace?.hr?.selectedPath || null,
      },
      weeks: weeks.map(summarizeWeek),
    },
  };
}

function createCurrentSnapshot() {
  const scenarios = [];

  for (const d of DISTANCE_CASES) {
    for (const f of FREQUENCIES) {
      const profile = buildProfile(d, f);
      const plan = applyRunPlanRules(null, profile);
      const id = `${d.key}_${f}x`;
      scenarios.push(
        summarizePlan(plan, {
          id,
          distance: d.label,
          sessionsPerWeek: f,
          weeklyKm: d.weeklyKm,
          longestRunKm: d.longestRunKm,
          planLengthWeeks: d.planLengthWeeks,
        })
      );
    }
  }

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    generatedBy: "server/scripts/plan-common-profiles-snapshots.js",
    cases: scenarios,
  };
}

function diffValues(a, b, pathName = "$", out = [], limit = 60) {
  if (out.length >= limit) return out;

  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) {
    out.push(`${pathName}: type mismatch ${ta} vs ${tb}`);
    return out;
  }

  if (ta === "array") {
    if (a.length !== b.length) {
      out.push(`${pathName}: length mismatch ${a.length} vs ${b.length}`);
    }
    const max = Math.min(a.length, b.length);
    for (let i = 0; i < max && out.length < limit; i++) {
      diffValues(a[i], b[i], `${pathName}[${i}]`, out, limit);
    }
    return out;
  }

  if (ta === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (out.length >= limit) break;
      if (!(k in a)) {
        out.push(`${pathName}.${k}: missing in actual`);
        continue;
      }
      if (!(k in b)) {
        out.push(`${pathName}.${k}: missing in expected`);
        continue;
      }
      diffValues(a[k], b[k], `${pathName}.${k}`, out, limit);
    }
    return out;
  }

  if (a !== b) {
    out.push(`${pathName}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
  return out;
}

function writeSnapshot(snapshot) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function main() {
  const update = process.argv.includes("--update");
  const current = createCurrentSnapshot();

  if (update) {
    writeSnapshot(current);
    console.log("[plan-common-snapshots] snapshots updated");
    console.log(` - file: ${SNAPSHOT_FILE}`);
    console.log(` - cases: ${current.cases.length}`);
    return;
  }

  if (!fs.existsSync(SNAPSHOT_FILE)) {
    fail(
      `snapshot file missing: ${SNAPSHOT_FILE}. Run with --update to create it.`
    );
  }

  const expectedRaw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
  const expected = JSON.parse(expectedRaw);

  ensure(
    Number(expected?.snapshotVersion) === SNAPSHOT_VERSION,
    `snapshotVersion mismatch: expected ${SNAPSHOT_VERSION}, got ${expected?.snapshotVersion}`
  );

  const diffs = diffValues(current, expected);
  if (diffs.length) {
    const preview = diffs.slice(0, 20).join("\n - ");
    fail(
      `snapshot drift detected (${diffs.length} diff(s)).\n - ${preview}\nRun: node server/scripts/plan-common-profiles-snapshots.js --update`
    );
  }

  console.log("[plan-common-snapshots] regression passed");
  console.log(` - file: ${SNAPSHOT_FILE}`);
  console.log(` - cases: ${current.cases.length}`);
}

try {
  main();
} catch (err) {
  console.error("[plan-common-snapshots] regression failed");
  console.error(err?.message || err);
  process.exit(1);
}

