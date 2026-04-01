import { applyRunPlanRules } from "../lib/train/planRules/index.js";

const DISTANCES = ["5K", "10K", "Half marathon", "Marathon", "Ultra"];
const EXPERIENCES = [
  "New to running",
  "Some experience",
  "Regular runner",
  "Advanced/competitive",
];
const FREQUENCIES = [1, 3, 4, 5];

const DAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_SETS = {
  1: ["Sun"],
  3: ["Tue", "Thu", "Sun"],
  4: ["Tue", "Thu", "Sat", "Sun"],
  5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function sumDistanceMetersFromStep(step) {
  if (!step || typeof step !== "object") return 0;

  const stepType = String(step.stepType || "").toLowerCase();
  if (stepType === "repeat") {
    const reps = Math.max(1, Math.round(toNum(step.repeatCount) ?? 1));
    const inner = (Array.isArray(step.steps) ? step.steps : []).reduce(
      (sum, st) => sum + sumDistanceMetersFromStep(st),
      0
    );
    return reps * inner;
  }

  const durationType = String(step.durationType || "").toLowerCase();
  if (durationType !== "distance") return 0;

  const v = toNum(step.durationValue);
  return v != null && v > 0 ? v : 0;
}

function kindOf(session) {
  return String(session?.workoutKind || session?.type || session?.sessionType || "").toUpperCase();
}

function isQuality(kind) {
  return ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS"].includes(String(kind || "").toUpperCase());
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
  };
}

function makeScenarios() {
  const out = [];
  for (const distance of DISTANCES) {
    for (const experience of EXPERIENCES) {
      for (const sessionsPerWeek of FREQUENCIES) {
        const name = `${distance}_${experience}_${sessionsPerWeek}x`
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^\w]+/g, "_");
        out.push({
          name,
          meta: { distance, experience, sessionsPerWeek },
          athleteProfile: buildProfile({ distance, experience, sessionsPerWeek }),
        });
      }
    }
  }
  return out;
}

function collectHardFailures(plan, ctx) {
  const failures = [];
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];

  if (!weeks.length) {
    failures.push(`${ctx}: no weeks`);
    return failures;
  }

  for (const week of weeks) {
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    const metrics = week?.metrics || {};
    let plannedWeeklyFromSessions = 0;
    let computedWeeklyFromSessions = 0;
    let renderedWeeklyFromSessions = 0;

    for (const s of sessions) {
      const type = kindOf(s);
      const plannedKm = toNum(s?.plannedDistanceKm);
      const computedKm = toNum(s?.computedTotalKm);
      const renderedKm = toNum(s?.renderedDistanceKm);
      const executableKm = toNum(s?.executableDistanceKm);
      const distanceKm = toNum(s?.distanceKm);
      const distanceMeters = toNum(s?.distanceMeters);
      const budgetedComputedKm = toNum(s?.budgetedComputedKm);
      const estimatedM = toNum(s?.workout?.estimatedDistanceMeters);
      const budgetedEstimatedM = toNum(s?.workout?.budgetedEstimatedDistanceMeters);
      const steps = Array.isArray(s?.steps) ? s.steps : Array.isArray(s?.workout?.steps) ? s.workout.steps : [];

      if (plannedKm == null || plannedKm < 0) failures.push(`${ctx}/w${week.weekIndex}: invalid planned km (${type})`);
      if (computedKm == null || computedKm < 0) failures.push(`${ctx}/w${week.weekIndex}: invalid computed km (${type})`);
      if (estimatedM == null || estimatedM < 0) failures.push(`${ctx}/w${week.weekIndex}: invalid estimated meters (${type})`);
      if (!steps.length) failures.push(`${ctx}/w${week.weekIndex}: missing steps (${type})`);

      if (plannedKm != null) plannedWeeklyFromSessions += plannedKm;
      if (computedKm != null) computedWeeklyFromSessions += computedKm;
      if (renderedKm != null) renderedWeeklyFromSessions += renderedKm;

      if (budgetedComputedKm != null && plannedKm != null && Math.abs(plannedKm - budgetedComputedKm) > 0.01) {
        failures.push(
          `${ctx}/w${week.weekIndex}: planned/budgeted mismatch ${type} (${plannedKm} vs ${budgetedComputedKm})`
        );
      }

      if (computedKm != null && estimatedM != null) {
        const expectedM = Math.round(computedKm * 1000);
        if (Math.abs(expectedM - estimatedM) > 1) {
          failures.push(`${ctx}/w${week.weekIndex}: computed/estimated mismatch ${type} (${expectedM} vs ${estimatedM})`);
        }
      }
      if (plannedKm != null && budgetedEstimatedM != null) {
        const expectedBudgetM = Math.round(plannedKm * 1000);
        if (Math.abs(expectedBudgetM - budgetedEstimatedM) > 1) {
          failures.push(
            `${ctx}/w${week.weekIndex}: planned/budgetedEstimated mismatch ${type} (${expectedBudgetM} vs ${budgetedEstimatedM})`
          );
        }
      }

      if (computedKm != null && renderedKm != null && Math.abs(computedKm - renderedKm) > 0.01) {
        failures.push(`${ctx}/w${week.weekIndex}: computed/rendered mismatch ${type} (${computedKm} vs ${renderedKm})`);
      }
      if (computedKm != null && executableKm != null && Math.abs(computedKm - executableKm) > 0.01) {
        failures.push(`${ctx}/w${week.weekIndex}: computed/executable mismatch ${type} (${computedKm} vs ${executableKm})`);
      }
      if (computedKm != null && distanceKm != null && Math.abs(computedKm - distanceKm) > 0.01) {
        failures.push(`${ctx}/w${week.weekIndex}: computed/distanceKm mismatch ${type} (${computedKm} vs ${distanceKm})`);
      }
      if (computedKm != null && distanceMeters != null) {
        const expectedDistanceM = Math.round(computedKm * 1000);
        if (Math.abs(expectedDistanceM - distanceMeters) > 1) {
          failures.push(
            `${ctx}/w${week.weekIndex}: computed/distanceMeters mismatch ${type} (${expectedDistanceM} vs ${distanceMeters})`
          );
        }
      }

      const explicitDistanceM = steps.reduce((sum, st) => sum + sumDistanceMetersFromStep(st), 0);
      const warmupKm = Math.max(0, toNum(s?.warmupKm) ?? 0);
      const cooldownKm = Math.max(0, toNum(s?.cooldownKm) ?? 0);
      const executableM = Math.round(Math.max(0, (computedKm ?? 0) * 1000));
      const minimumExpectedM = Math.round(explicitDistanceM + (warmupKm + cooldownKm) * 1000);
      if (computedKm != null && minimumExpectedM > executableM + 150) {
        failures.push(
          `${ctx}/w${week.weekIndex}: step lower-bound exceeds executable ${type} (${minimumExpectedM} > ${executableM})`
        );
      }

      if (type === "LONG" && String(s?.targetSemantics || "") === "primary_quality_segment") {
        if (toNum(s?.targetPacePrimary?.minSecPerKm) == null && toNum(s?.targetHrPrimary?.minBpm) == null) {
          failures.push(`${ctx}/w${week.weekIndex}: long quality semantics missing primary targets`);
        }
      }

      if (isQuality(type)) {
        if (toNum(s?.warmupMin) == null || toNum(s?.cooldownMin) == null) {
          failures.push(`${ctx}/w${week.weekIndex}: missing warmup/cooldown mins ${type}`);
        }
      } else if (type === "EASY") {
        if (s?.warmupMin != null || s?.cooldownMin != null) {
          failures.push(`${ctx}/w${week.weekIndex}: easy should not carry warmup/cooldown`);
        }
      }
    }

    const plannedWeeklyKm = toNum(metrics?.plannedWeeklyKm);
    if (plannedWeeklyKm != null && Math.abs(round1(plannedWeeklyFromSessions) - plannedWeeklyKm) > 0.01) {
      failures.push(
        `${ctx}/w${week.weekIndex}: planned weekly mismatch (${round1(plannedWeeklyFromSessions)} vs ${plannedWeeklyKm})`
      );
    }
    const computedWeeklyKm = toNum(metrics?.computedWeeklyKm);
    if (computedWeeklyKm != null && Math.abs(round1(computedWeeklyFromSessions) - computedWeeklyKm) > 0.01) {
      failures.push(
        `${ctx}/w${week.weekIndex}: computed weekly mismatch (${round1(computedWeeklyFromSessions)} vs ${computedWeeklyKm})`
      );
    }
    const renderedWeeklyKm = toNum(metrics?.renderedWeeklyKm);
    if (renderedWeeklyKm != null && Math.abs(round1(renderedWeeklyFromSessions) - renderedWeeklyKm) > 0.01) {
      failures.push(
        `${ctx}/w${week.weekIndex}: rendered weekly mismatch (${round1(renderedWeeklyFromSessions)} vs ${renderedWeeklyKm})`
      );
    }
  }

  for (const week of weeks) {
    const byDay = new Map();
    for (const s of week.sessions || []) {
      const d = String(s?.day || "");
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(kindOf(s));
    }
    for (const [day, types] of byDay.entries()) {
      if (types.includes("STRIDES") && types.includes("EASY")) {
        failures.push(`${ctx}/w${week.weekIndex}: duplicate easy+strides artifact on ${day}`);
      }
    }
  }

  return failures;
}

function scorePlan(plan) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  let trainingQuality = 100;
  let fidelity = 100;
  const notes = [];

  const weekly = weeks.map((w) => toNum(w?.metrics?.plannedWeeklyKm) ?? 0);
  for (let i = 1; i < weekly.length; i++) {
    const prev = weekly[i - 1];
    const cur = weekly[i];
    if (prev <= 0 || cur <= 0) continue;
    const phase = String(weeks[i]?.phase || "").toLowerCase();
    const deltaPct = ((cur - prev) / prev) * 100;
    if ((phase === "deload" || phase === "taper") && deltaPct > -3) {
      trainingQuality -= 4;
      notes.push(`w${i + 1}: ${phase} not meaningfully lighter`);
    } else if (!["deload", "taper"].includes(phase) && deltaPct > 18) {
      trainingQuality -= 5;
      notes.push(`w${i + 1}: ramp too steep (${round1(deltaPct)}%)`);
    }
  }

  for (const week of weeks) {
    const q = toNum(week?.metrics?.qualitySharePct);
    const l = toNum(week?.metrics?.longRunSharePct);
    const phase = String(week?.phase || "").toLowerCase();

    if (q != null) {
      if (phase === "taper" && q > 28) {
        trainingQuality -= 5;
        notes.push(`w${week.weekIndex}: taper quality share high (${q}%)`);
      } else if (q < 8 || q > 42) {
        trainingQuality -= 3;
        notes.push(`w${week.weekIndex}: quality share out of range (${q}%)`);
      }
    }

    if (l != null && (l < 18 || l > 45)) {
      trainingQuality -= 2;
      notes.push(`w${week.weekIndex}: long-run share unusual (${l}%)`);
    }

    for (const s of week.sessions || []) {
      const type = kindOf(s);
      const steps = Array.isArray(s?.steps) ? s.steps : [];
      const hasRepeat = steps.some((st) => String(st?.stepType || "").toLowerCase() === "repeat");
      const keyTargets = String(s?.keyTargets || "");
      const notesText = String(s?.notes || "");

      if (type === "LONG") {
        const badLongRecovery = steps.some(
          (st) =>
            String(st?.stepType || "").toLowerCase() === "recovery" &&
            String(st?.durationType || "").toLowerCase() === "distance"
        );
        if (badLongRecovery) {
          fidelity -= 8;
          notes.push(`w${week.weekIndex}: long run uses recovery distance steps`);
        }
      }

      if (isQuality(type)) {
        if (hasRepeat && !/[x×]/i.test(keyTargets)) {
          fidelity -= 2;
          notes.push(`w${week.weekIndex}: quality keyTargets missing reps pattern`);
        }
        if (notesText && !/warm up|cool down/i.test(notesText)) {
          fidelity -= 1;
          notes.push(`w${week.weekIndex}: quality note missing warm/cool language`);
        }
      }

      const spec = String(s?.meta?.specPickId || "").trim();
      const variant = String(s?.workout?.variant || "").trim();
      if (spec && variant && spec !== variant && !variant.includes(spec) && !spec.includes(variant)) {
        fidelity -= 2;
        notes.push(`w${week.weekIndex}: spec/variant mismatch (${spec} vs ${variant})`);
      }
    }
  }

  trainingQuality = Math.max(0, trainingQuality);
  fidelity = Math.max(0, fidelity);
  return { trainingQuality, fidelity, notes };
}

function runScenario({ name, athleteProfile }) {
  const plan = applyRunPlanRules(null, athleteProfile);
  const hardFailures = collectHardFailures(plan, name);
  const score = scorePlan(plan);
  return {
    name,
    hardFailures,
    trainingQuality: score.trainingQuality,
    fidelity: score.fidelity,
    notes: score.notes,
  };
}

function main() {
  const scenarios = makeScenarios();
  const results = scenarios.map(runScenario);

  const hardFailing = results.filter((r) => r.hardFailures.length > 0);
  const passCount = results.length - hardFailing.length;
  const avgTq = round1(results.reduce((a, r) => a + r.trainingQuality, 0) / Math.max(1, results.length));
  const avgFid = round1(results.reduce((a, r) => a + r.fidelity, 0) / Math.max(1, results.length));

  const ranked = results
    .slice()
    .sort((a, b) => (a.trainingQuality + a.fidelity) - (b.trainingQuality + b.fidelity))
    .slice(0, 6);

  console.log("[plan-quality] summary");
  console.log(` - scenarios: ${results.length}`);
  console.log(` - hard-pass: ${passCount}`);
  console.log(` - hard-fail: ${hardFailing.length}`);
  console.log(` - avg trainingQuality: ${avgTq}`);
  console.log(` - avg fidelity: ${avgFid}`);
  console.log(" - lowest combined scores:");
  for (const r of ranked) {
    console.log(`   * ${r.name}: TQ=${r.trainingQuality}, FID=${r.fidelity}`);
  }

  if (hardFailing.length) {
    console.error("[plan-quality] hard failures");
    for (const r of hardFailing.slice(0, 10)) {
      for (const f of r.hardFailures.slice(0, 10)) {
        console.error(` - ${f}`);
      }
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("[plan-quality] crashed");
  console.error(err?.stack || err?.message || err);
  process.exit(1);
}
