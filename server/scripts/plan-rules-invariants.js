import { applyRunPlanRules } from "../lib/train/planRules/index.js";
import { RULES } from "../lib/train/planRules/rulesConfig.js";

const DISTANCES = ["5K", "10K", "Half marathon", "Marathon", "Ultra"];
const EXPERIENCES = [
  "New to running",
  "Some experience",
  "Regular runner",
  "Advanced/competitive",
];
const FREQUENCIES = [1, 3, 4, 5];

const DAY_SETS = {
  1: ["Sun"],
  3: ["Tue", "Thu", "Sun"],
  4: ["Tue", "Thu", "Sat", "Sun"],
  5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
};

const DAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function fail(msg) {
  throw new Error(msg);
}

function isQualityType(type) {
  const t = String(type || "").toUpperCase();
  return t === "INTERVALS" || t === "TEMPO" || t === "THRESHOLD" || t === "HILLS";
}

function isLongType(type) {
  const t = String(type || "").toUpperCase();
  return t === "LONG" || t === "LONGRUN";
}

function isHardType(type) {
  const t = String(type || "").toUpperCase();
  if (!t) return false;
  const configured = Array.isArray(RULES?.hardSessionTypes)
    ? RULES.hardSessionTypes.map((x) => String(x || "").toUpperCase())
    : [];
  const defaults = ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE", "QUALITY"];
  if (configured.includes(t) || defaults.includes(t)) return true;
  if (RULES?.longRunCountsAsHard && isLongType(t)) return true;
  return false;
}

function qualityShareCapPctForPhase(phase) {
  const p = String(phase || "").toUpperCase().trim();
  const cap = toNum(RULES?.intensityTargets?.qualitySharePctByPhase?.[p]?.max);
  if (cap != null) return cap;
  return 45;
}

function buildProfile({ distance, experience, sessionsPerWeek }) {
  const expKey = String(experience || "").toLowerCase();
  const distKey = String(distance || "").toLowerCase();

  const weeklyBaseByExp = {
    "new to running": 18,
    "some experience": 28,
    "regular runner": 42,
    "advanced/competitive": 58,
  };
  const longestBaseByExp = {
    "new to running": 7,
    "some experience": 10,
    "regular runner": 16,
    "advanced/competitive": 22,
  };
  const thresholdByExp = {
    "new to running": 340,
    "some experience": 305,
    "regular runner": 275,
    "advanced/competitive": 255,
  };

  const distanceWeeklyAdjust =
    distKey.includes("ultra") ? 15 : distKey.includes("marathon") ? 8 : distKey.includes("half") ? 4 : distKey.includes("5k") ? -2 : 0;
  const distanceLongestAdjust =
    distKey.includes("ultra") ? 8 : distKey.includes("marathon") ? 4 : distKey.includes("half") ? 2 : distKey.includes("5k") ? -1 : 0;

  const weeklyRaw = (weeklyBaseByExp[expKey] ?? 28) + distanceWeeklyAdjust;
  const weeklyKm = Math.max(14, weeklyRaw);
  const longestRaw = (longestBaseByExp[expKey] ?? 10) + distanceLongestAdjust;
  const longestRunKm = Math.min(Math.max(5, longestRaw), round1(weeklyKm * 0.45));

  const planLengthWeeks = distKey.includes("ultra") ? 14 : distKey.includes("marathon") ? 12 : 8;
  const difficulty = expKey === "advanced/competitive" ? "Aggressive" : "Balanced";
  const thresholdPaceSecPerKm = thresholdByExp[expKey] ?? 300;
  const runDays = DAY_SETS[sessionsPerWeek];

  return {
    goal: { distance, planLengthWeeks, targetDate: "2026-10-01" },
    current: { weeklyKm, longestRunKm, experience },
    availability: { sessionsPerWeek, runDays, longRunDay: "Sun" },
    difficulty,
    pacing: { thresholdPaceSecPerKm },
    hr: { max: 190, resting: 52 },

    // compatibility mirror fields
    weeklyKm,
    longestRunKm,
    sessionsPerWeek,
    longRunDay: "Sun",
    goalDistance: distance,
    experience,
  };
}

function qualityBoundsFor({ distance, phase, experience, sessionsPerWeek }) {
  const d = String(distance || "").toLowerCase();
  const p = String(phase || "").toLowerCase();
  const e = String(experience || "").toLowerCase();
  const speed = d.includes("5k") || d.includes("10k");
  const veryEndurance = d.includes("marathon") || d.includes("ultra");
  const expMinShift = e.includes("new") ? -3 : e.includes("some") ? -2 : 0;
  const freqMinShift = Number(sessionsPerWeek) <= 3 ? (speed ? -4 : -2) : 0;
  const enduranceShift = !speed && veryEndurance ? -2 : 0;

  if (p === "deload") return [Math.max(14, (speed ? 20 : 16) + expMinShift + freqMinShift + enduranceShift), speed ? 33 : 30];
  if (p === "taper") return [Math.max(14, (speed ? 18 : 16) + expMinShift + freqMinShift + enduranceShift), speed ? 33 : 30];
  if (p === "specific") return [Math.max(16, (speed ? 26 : 20) + expMinShift + freqMinShift + enduranceShift), speed ? 39 : 35];
  if (p === "build") return [Math.max(16, (speed ? 24 : 19) + expMinShift + freqMinShift + enduranceShift), speed ? 37 : 34];
  return [Math.max(16, (speed ? 22 : 18) + expMinShift + freqMinShift + enduranceShift), speed ? 36 : 33]; // base / fallback
}

function assertSessionInvariants(session, ctx) {
  const type = String(session?.type || session?.workoutKind || "").toUpperCase();
  const plannedKm = toNum(session?.plannedDistanceKm);
  const computedTotalKm = toNum(session?.computedTotalKm);

  if (plannedKm == null || plannedKm < 0) fail(`${ctx}: invalid plannedDistanceKm for ${type}`);
  if (computedTotalKm == null || computedTotalKm < 0) fail(`${ctx}: invalid computedTotalKm for ${type}`);
  const lowerBound = Math.max(0.5, plannedKm * 0.5);
  const upperBound = Math.max(plannedKm + 0.5, plannedKm * 3.5);
  if (computedTotalKm < lowerBound || computedTotalKm > upperBound) {
    fail(`${ctx}: computedTotalKm out of plausible range for ${type} (${computedTotalKm}, planned=${plannedKm})`);
  }

  const steps = Array.isArray(session?.workout?.steps) ? session.workout.steps : null;
  if (!steps || !steps.length) fail(`${ctx}: missing workout.steps for ${type}`);

  if (!session?.targetHr) fail(`${ctx}: missing targetHr for ${type}`);
  if (!session?.targetPace) fail(`${ctx}: missing targetPace for ${type}`);

  if (isQualityType(type)) {
    if (!Number.isFinite(toNum(session?.warmupMin))) fail(`${ctx}: missing warmupMin for ${type}`);
    if (!Number.isFinite(toNum(session?.cooldownMin))) fail(`${ctx}: missing cooldownMin for ${type}`);
    if (!String(session?.keyTargets || "").trim()) fail(`${ctx}: missing keyTargets for ${type}`);
  } else if (type === "EASY") {
    if (session?.warmupMin != null || session?.cooldownMin != null) {
      fail(`${ctx}: easy should not carry warmup/cooldown minutes`);
    }
  }
}

function assertHardDaySpacing(week, ctx) {
  const minGapDays = toNum(RULES?.spacing?.minGapDaysBetweenHard);
  if (minGapDays == null || minGapDays < 1) return;

  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const hardDays = sessions
    .filter((s) => isHardType(s?.type || s?.workoutKind))
    .map((s) => DAY_INDEX[String(s?.day || "")])
    .filter((x) => Number.isInteger(x))
    .sort((a, b) => a - b);

  for (let i = 1; i < hardDays.length; i++) {
    const gap = hardDays[i] - hardDays[i - 1];
    if (gap <= minGapDays) {
      fail(`${ctx}: hard sessions too close (gap=${gap} days, minGap=${minGapDays})`);
    }
  }
}

function assertLongRunExists(week, ctx) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const hasLong = sessions.some((s) => isLongType(s?.type || s?.workoutKind));
  if (!hasLong) fail(`${ctx}: missing long run`);
}

function assertRunDaysRespected(week, meta, ctx) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const expectedRunDaysRaw = Array.isArray(week?.runDays) && week.runDays.length
    ? week.runDays
    : Array.isArray(meta?.runDays)
    ? meta.runDays
    : [];
  const expectedRunDays = [...new Set(expectedRunDaysRaw.map((d) => String(d || "").trim()).filter((d) => DAY_INDEX[d] != null))];
  if (!expectedRunDays.length) return;

  const expectedSet = new Set(expectedRunDays);
  const actualSet = new Set(
    sessions
      .map((s) => String(s?.day || "").trim())
      .filter((d) => DAY_INDEX[d] != null)
  );

  for (const d of actualSet) {
    if (!expectedSet.has(d)) fail(`${ctx}: session scheduled on non-run day (${d})`);
  }
  for (const d of expectedSet) {
    if (!actualSet.has(d)) fail(`${ctx}: expected run day missing session (${d})`);
  }
}

function assertQualityShareWithinCap(week, ctx) {
  const metrics = week?.metrics || {};
  const qualityShare = toNum(metrics?.qualitySharePct);
  if (qualityShare == null) fail(`${ctx}: missing qualitySharePct`);

  const phase = week?.phase || week?.targets?.phase || "";
  const cap = qualityShareCapPctForPhase(phase);
  if (qualityShare > cap + 0.25) {
    fail(`${ctx}: qualitySharePct above cap (${qualityShare} > ${cap})`);
  }
}

function assertWeekInvariants(week, meta, ctx) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  if (!sessions.length) fail(`${ctx}: no sessions in week`);

  assertLongRunExists(week, ctx);
  assertRunDaysRespected(week, meta, ctx);
  for (const s of sessions) assertSessionInvariants(s, ctx);
  assertHardDaySpacing(week, ctx);
  assertQualityShareWithinCap(week, ctx);

  const metrics = week?.metrics || {};
  const drift = toNum(metrics?.driftKm);
  const computedDrift = toNum(metrics?.computedDriftKm);
  const qualityShare = toNum(metrics?.qualitySharePct);
  const longShare = toNum(metrics?.longRunSharePct);
  const planned = toNum(metrics?.plannedWeeklyKm);
  const computed = toNum(metrics?.computedWeeklyKm);

  const isOneDay = Number(meta?.sessionsPerWeek) === 1;
  const driftCap = isOneDay ? 60 : 0.9;
  if (drift != null && Math.abs(drift) > driftCap) fail(`${ctx}: driftKm too high (${drift})`);
  const computedDriftCap = isOneDay ? 60 : 20;
  if (computedDrift != null && Math.abs(computedDrift) > computedDriftCap) {
    fail(`${ctx}: computedDriftKm too high (${computedDrift})`);
  }
  if (planned != null && computed != null && Math.abs(planned - computed) > 20) {
    fail(`${ctx}: planned/computed weekly mismatch (${planned} vs ${computed})`);
  }

  if (qualityShare == null || qualityShare < 0 || qualityShare > 45) fail(`${ctx}: invalid qualitySharePct (${qualityShare})`);
  const longShareMax = Number(meta?.sessionsPerWeek) === 1 ? 100 : 52;
  if (longShare == null || longShare < 0 || longShare > longShareMax) {
    fail(`${ctx}: invalid longRunSharePct (${longShare})`);
  }
}

function assertPlanInvariants(plan, meta, ctx) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  if (!weeks.length) fail(`${ctx}: no weeks returned`);

  const trace = plan?.decisionTrace;
  if (!trace || typeof trace !== "object") fail(`${ctx}: missing decisionTrace`);
  const paceSource = trace?.paceSource;
  if (!paceSource || typeof paceSource !== "object") {
    fail(`${ctx}: missing decisionTrace.paceSource`);
  }
  if (!String(paceSource?.selectedPath || "").trim()) {
    fail(`${ctx}: missing decisionTrace.paceSource.selectedPath`);
  }
  const phaseReasonWeeks = Array.isArray(trace?.phaseReason?.weeks)
    ? trace.phaseReason.weeks
    : [];
  if (phaseReasonWeeks.length !== weeks.length) {
    fail(
      `${ctx}: decisionTrace.phaseReason.weeks length mismatch (${phaseReasonWeeks.length} vs ${weeks.length})`
    );
  }
  const allocationReasonWeeks = Array.isArray(trace?.allocationReason?.weeks)
    ? trace.allocationReason.weeks
    : [];
  if (allocationReasonWeeks.length !== weeks.length) {
    fail(
      `${ctx}: decisionTrace.allocationReason.weeks length mismatch (${allocationReasonWeeks.length} vs ${weeks.length})`
    );
  }
  const repairsAppliedWeeks = Array.isArray(trace?.repairsApplied?.weeks)
    ? trace.repairsApplied.weeks
    : [];
  if (repairsAppliedWeeks.length !== weeks.length) {
    fail(
      `${ctx}: decisionTrace.repairsApplied.weeks length mismatch (${repairsAppliedWeeks.length} vs ${weeks.length})`
    );
  }

  for (let i = 0; i < weeks.length; i++) {
    assertWeekInvariants(weeks[i], meta, `${ctx}/week${i + 1}`);
  }

  const taperWeeks = weeks.filter((w) => String(w?.phase || "").toLowerCase() === "taper");
  if (taperWeeks.length) {
    const nonTaper = weeks.filter((w) => String(w?.phase || "").toLowerCase() !== "taper");
    const maxNonTaper = Math.max(
      ...nonTaper.map((w) => toNum(w?.metrics?.plannedWeeklyKm) ?? 0),
      0
    );

    for (const tw of taperWeeks) {
      const planned = toNum(tw?.metrics?.plannedWeeklyKm) ?? 0;
      if (planned > maxNonTaper + 0.1) {
        fail(`${ctx}: taper week plannedWeeklyKm above non-taper max (${planned} > ${maxNonTaper})`);
      }
    }

    if (taperWeeks.length >= 2) {
      const first = toNum(taperWeeks[0]?.metrics?.plannedWeeklyKm) ?? 0;
      const last = toNum(taperWeeks[taperWeeks.length - 1]?.metrics?.plannedWeeklyKm) ?? 0;
      if (last > first + 0.1) {
        fail(`${ctx}: final taper week is not lighter (${last} > ${first})`);
      }
    }
  }
}

function makeScenarios() {
  const out = [];
  for (const distance of DISTANCES) {
    for (const experience of EXPERIENCES) {
      for (const sessionsPerWeek of FREQUENCIES) {
        const key = `${distance}_${experience}_${sessionsPerWeek}x`
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^\w]+/g, "_");
        out.push({
          name: key,
          meta: { distance, experience, sessionsPerWeek, runDays: DAY_SETS[sessionsPerWeek] || [] },
          athleteProfile: buildProfile({ distance, experience, sessionsPerWeek }),
        });
      }
    }
  }
  return out;
}

function runScenario({ name, meta, athleteProfile }) {
  const plan = applyRunPlanRules(null, athleteProfile);
  assertPlanInvariants(plan, meta, name);
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks.length : 0;
  return { name, weeks };
}

function main() {
  const scenarios = makeScenarios();
  const out = [];
  for (const sc of scenarios) out.push(runScenario(sc));

  console.log("[plan-rules] invariants passed");
  console.log(` - scenarios: ${out.length}`);
  const sample = out.slice(0, 6);
  for (const x of sample) console.log(` - ${x.name}: ${x.weeks} weeks`);
  if (out.length > sample.length) console.log(` - ... ${out.length - sample.length} more`);
}

try {
  main();
} catch (err) {
  console.error("[plan-rules] invariants failed");
  console.error(err?.message || err);
  process.exit(1);
}
