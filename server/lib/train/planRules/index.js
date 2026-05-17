//server/lib/train/planRules/index.js
import { normaliseAthleteProfile } from "./deriveInputs.js";
import { fillSessionsFromSkeleton } from "./fillSessions.js";
import { attachGarminStepsToSessions } from "./garminSteps.js";
import { normalisePlanLengthWeeks } from "./normalization.js";
import { buildProfessionalPlanReview } from "./professionalReview.js";
import { buildProgressionTargets } from "./progression.js";
import { RULES } from "./rulesConfig.js";
import { buildSkeleton } from "./skeleton.js";
import { selectStockPlanProfile } from "./stockPlans.js";
import { validateAndRepairPlan } from "./validateAndRepair.js";

// template loader
import { getTemplateById } from "../../run/templates/index.js";
/* ───────────────────────────────────────────
   Warmup/Cooldown extraction (additive, safe)
─────────────────────────────────────────── */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function token(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "x";
}
function distanceToken(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}
export function getLowFrequencyGoalWarning(distance, sessionsPerWeek) {
  const distanceKey = distanceToken(distance);
  const runs = Math.round(toNum(sessionsPerWeek) ?? 0);
  if (!runs) return null;

  const isHalf = distanceKey.includes("half");
  const isMarathon = distanceKey.includes("marathon") && !isHalf;
  const isUltra = distanceKey.includes("ultra");

  if (isHalf && runs === 1) {
    return {
      code: "LOW_FREQUENCY_FOR_GOAL",
      severity: "blocker",
      distance: "Half marathon",
      sessionsPerWeek: runs,
      recommendedSessionsPerWeek: 3,
      overrideRequired: true,
      message: "A half marathon plan is ambitious with 1 run per week. Add more run days or choose a shorter goal.",
    };
  }

  if (isMarathon && runs <= 2) {
    return {
      code: "LOW_FREQUENCY_FOR_GOAL",
      severity: "blocker",
      distance: "Marathon",
      sessionsPerWeek: runs,
      recommendedSessionsPerWeek: 3,
      overrideRequired: true,
      message: "A marathon plan is ambitious with fewer than 3 runs per week. Add more run days or choose a shorter goal.",
    };
  }

  if (isUltra && runs < 4) {
    return {
      code: "LOW_FREQUENCY_FOR_GOAL",
      severity: "blocker",
      distance: "Ultra",
      sessionsPerWeek: runs,
      recommendedSessionsPerWeek: 4,
      overrideRequired: true,
      message: "An ultra plan is ambitious with fewer than 4 runs per week. Add more run days or choose a shorter goal.",
    };
  }

  return null;
}
function makeSessionId({ weekIndex, day, type, ordinal }) {
  return `w${Number(weekIndex) || 0}_${token(day)}_${token(type)}_${Number(ordinal) || 0}`;
}
function stepTypeIs(step, t) {
  return String(step?.stepType || "").toLowerCase() === String(t).toLowerCase();
}
function getWarmCoolFromSteps(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  const warm = arr.find((s) => stepTypeIs(s, "warmup"));
  const cool = arr.find((s) => stepTypeIs(s, "cooldown"));

  const warmSec =
    warm && String(warm.durationType || "").toLowerCase() === "time"
      ? toNum(warm.durationValue)
      : null;

  const coolSec =
    cool && String(cool.durationType || "").toLowerCase() === "time"
      ? toNum(cool.durationValue)
      : null;

  return {
    warmupSec: warmSec != null ? Math.max(0, Math.round(warmSec)) : null,
    cooldownSec: coolSec != null ? Math.max(0, Math.round(coolSec)) : null,
  };
}

function kindUpper(session) {
  return String(
    session?.type ||
      session?.workoutKind ||
      session?.sessionType ||
      session?.workout?.kind ||
      ""
  )
    .trim()
    .toUpperCase();
}

function raceDistanceKm(goalDistance) {
  const key = distanceToken(goalDistance);
  if (key.includes("5k")) return 5;
  if (key.includes("10k")) return 10;
  if (key.includes("half")) return 21.1;
  if (key.includes("marathon") && !key.includes("half")) return 42.2;
  return null;
}

function isRaceGoal(profile) {
  const goalDistance = String(profile?.goalDistance || "").toUpperCase();
  if (!["5K", "10K", "HALF", "MARATHON"].includes(goalDistance)) return false;
  return Boolean(profile?.eventDate || profile?.targetDate || profile?.recentRace || profile?.paces?.race);
}

function recomputeWeekMetricsFromSessions(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const total = round1(
    sessions.reduce((sum, s) => sum + Math.max(0, toNum(s?.plannedDistanceKm) ?? toNum(s?.distanceKm) ?? 0), 0)
  );
  const qualityKm = round1(
    sessions.reduce((sum, s) => {
      const kind = kindUpper(s);
      if (!isHardNonLongKind(kind)) return sum;
      return sum + Math.max(0, toNum(s?.plannedDistanceKm) ?? toNum(s?.distanceKm) ?? 0);
    }, 0)
  );
  const longKm = round1(
    sessions.reduce((sum, s) => {
      const kind = kindUpper(s);
      if (kind !== "LONG" && kind !== "LONGRUN") return sum;
      return sum + Math.max(0, toNum(s?.plannedDistanceKm) ?? toNum(s?.distanceKm) ?? 0);
    }, 0)
  );
  const raceKm = round1(
    sessions.reduce((sum, s) => {
      if (kindUpper(s) !== "RACE") return sum;
      return sum + Math.max(0, toNum(s?.plannedDistanceKm) ?? toNum(s?.distanceKm) ?? 0);
    }, 0)
  );
  const metrics = week?.metrics && typeof week.metrics === "object" ? week.metrics : {};
  return {
    ...metrics,
    plannedWeeklyKm: total,
    targetWeeklyKm: toNum(metrics?.targetWeeklyKm) ?? toNum(week?.targets?.weeklyKm) ?? total,
    qualityKm,
    qualitySharePct: total > 0 ? round1((qualityKm / total) * 100) : 0,
    longRunKm: longKm,
    longRunSharePct: total > 0 ? round1((longKm / total) * 100) : 0,
    ...(raceKm > 0
      ? {
          raceKm,
          raceSharePct: total > 0 ? round1((raceKm / total) * 100) : 0,
        }
      : {}),
  };
}

function trimRaceWeekQualityToCap(sessions, capPct = 28) {
  const cap = clamp((toNum(capPct) ?? 28) / 100, 0.05, 0.6);
  const list = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  const qualityIndexes = list
    .map((s, index) => ({ s, index, kind: kindUpper(s) }))
    .filter(({ kind }) => isHardNonLongKind(kind) && kind !== "RACE")
    .map(({ index }) => index);

  if (!qualityIndexes.length) return list;

  const total = list.reduce((sum, s) => sum + Math.max(0, toNum(s?.plannedDistanceKm) ?? toNum(s?.distanceKm) ?? 0), 0);
  const quality = qualityIndexes.reduce(
    (sum, index) => sum + Math.max(0, toNum(list[index]?.plannedDistanceKm) ?? toNum(list[index]?.distanceKm) ?? 0),
    0
  );
  if (total <= 0 || quality <= 0 || quality / total <= cap + 0.0005) return list;

  const fixed = Math.max(0, total - quality);
  const allowedQuality = fixed > 0 ? (cap * fixed) / (1 - cap) : quality;
  const scale = quality > 0 ? clamp(allowedQuality / quality, 0.2, 1) : 1;

  for (const index of qualityIndexes) {
    const session = list[index];
    const currentKm = Math.max(0, toNum(session?.plannedDistanceKm) ?? toNum(session?.distanceKm) ?? 0);
    const nextKm = round1(currentKm * scale);
    list[index] = {
      ...session,
      plannedDistanceKm: nextKm,
      distanceKm: nextKm,
      distance: nextKm,
      distanceMeters: Math.round(nextKm * 1000),
      budgetedDistanceKm: nextKm,
      budgetedComputedKm: nextKm,
      meta: {
        ...(session?.meta && typeof session.meta === "object" ? session.meta : {}),
        raceWeekQualityCapPct: round1(cap * 100),
        raceWeekQualityTrimmedFromKm: round1(currentKm),
      },
      workout: {
        ...(session?.workout && typeof session.workout === "object" ? session.workout : {}),
        estimatedDistanceMeters: Math.round(nextKm * 1000),
        budgetedEstimatedDistanceMeters: Math.round(nextKm * 1000),
      },
    };
  }

  return list;
}

function sharpenFinalRaceWeekQuality(sessions, profile) {
  const list = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  const goal = String(profile?.goalDistance || "").toUpperCase();
  if (goal !== "5K" && goal !== "10K") return list;

  const qualityIdx = list.findIndex((s) => {
    const kind = kindUpper(s);
    return isHardNonLongKind(kind) && kind !== "RACE";
  });
  if (qualityIdx < 0) return list;

  const session = list[qualityIdx];
  const currentKm = Math.max(0, toNum(session?.plannedDistanceKm) ?? toNum(session?.distanceKm) ?? 0);
  const nextKm = round1(Math.min(currentKm || 4.5, goal === "5K" ? 4.2 : 4.8));
  const reps = goal === "5K" ? 4 : 5;
  const recoverySec = goal === "5K" ? 90 : 75;
  const warmupSec = nextKm <= 4.2 ? 8 * 60 : 10 * 60;
  const cooldownSec = nextKm <= 4.2 ? 5 * 60 : 6 * 60;

  list[qualityIdx] = {
    ...session,
    type: "INTERVALS",
    workoutKind: "INTERVALS",
    sessionType: "INTERVALS",
    name: "Race-week tune-up",
    title: "Race-week tune-up",
    purpose: "Sharpen without fatigue",
    keyTargets: `${reps}x400m at goal race pace`,
    notes: `Warm up ${Math.round(warmupSec / 60)} min easy. Main set: ${reps}x400m at goal race pace with ${recoverySec}s easy recoveries. Cool down ${Math.round(cooldownSec / 60)} min easy.`,
    plannedDistanceKm: nextKm,
    distanceKm: nextKm,
    distance: nextKm,
    distanceMeters: Math.round(nextKm * 1000),
    budgetedDistanceKm: nextKm,
    budgetedComputedKm: nextKm,
    meta: {
      ...(session?.meta && typeof session.meta === "object" ? session.meta : {}),
      raceWeekSharpener: true,
      replacedRaceWeekWorkout: session?.workout?.variant || session?.meta?.specPickId || session?.type || null,
    },
    workout: {
      sport: "running",
      kind: "INTERVALS",
      variant: `${goal}_RACE_WEEK_${reps}x400_RACEPACE`,
      warmupSec,
      cooldownSec,
      blocks: [
        {
          type: "REPEAT_DISTANCE",
          reps,
          workM: 400,
          recover: { type: "TIME", sec: recoverySec },
          intensityKey: "racepace",
          intensity: "RACEPACE",
        },
      ],
      reps,
      repDistanceM: 400,
      recovery: { type: "JOG_TIME", valueSec: recoverySec },
      meta: {
        raceWeekSharpener: true,
        budgetMUsed: Math.round(nextKm * 1000),
      },
    },
  };

  return list;
}

function replaceFinalLongRunWithRace(plan, profile) {
  if (!isRaceGoal(profile) || !Array.isArray(plan?.weeks) || !plan.weeks.length) return plan;

  const km = raceDistanceKm(profile?.goalDistance);
  if (!km) return plan;

  const weeks = plan.weeks.map((w) => ({ ...w }));
  const finalIndex = weeks.length - 1;
  const finalWeek = {
    ...weeks[finalIndex],
    phase: "taper",
    targets:
      weeks[finalIndex]?.targets && typeof weeks[finalIndex].targets === "object"
        ? { ...weeks[finalIndex].targets, phase: "TAPER", isTaper: true }
        : { phase: "TAPER", isTaper: true },
  };
  const sessions = Array.isArray(finalWeek.sessions) ? finalWeek.sessions.map((s) => ({ ...s })) : [];
  const longIdx = sessions.findIndex((s) => {
    const kind = kindUpper(s);
    return kind === "LONG" || kind === "LONGRUN";
  });
  if (longIdx < 0) return plan;

  const long = sessions[longIdx];
  const raceSession = {
    ...long,
    type: "RACE",
    workoutKind: "RACE",
    sessionType: "RACE",
    name: `${profile.goalDistance} race`,
    title: `${profile.goalDistance} race`,
    purpose: "Race day",
    keyTargets: "Controlled race effort",
    notes: "Race day. Warm up separately if needed, then run the target distance at sustainable race effort.",
    plannedDistanceKm: km,
    distanceKm: km,
    distance: km,
    distanceMeters: Math.round(km * 1000),
    budgetedDistanceKm: km,
    budgetedComputedKm: km,
    renderedDistanceKm: km,
    renderedComputedTotalKm: km,
    executableDistanceKm: km,
    computedTotalKm: km,
    warmupMin: null,
    cooldownMin: null,
    warmupKm: 0,
    cooldownKm: 0,
    meta: {
      ...(long?.meta && typeof long.meta === "object" ? long.meta : {}),
      raceDistanceKm: km,
      replacedSessionType: kindUpper(long),
    },
    workout: {
      sport: "running",
      kind: "RACE",
      variant: "RACE",
      estimatedDistanceMeters: Math.round(km * 1000),
      budgetedEstimatedDistanceMeters: Math.round(km * 1000),
      meta: { raceDistanceKm: km },
    },
  };

  sessions[longIdx] = raceSession;
  finalWeek.sessions = trimRaceWeekQualityToCap(sharpenFinalRaceWeekQuality(sessions, profile), 28);
  finalWeek.metrics = recomputeWeekMetricsFromSessions(finalWeek);
  finalWeek.days = Array.isArray(finalWeek.days)
    ? finalWeek.days.map((day) => ({
        ...day,
        sessions: Array.isArray(day?.sessions)
          ? finalWeek.sessions.filter((s) => String(s?.day || "").trim() === String(day?.day || "").trim())
          : [],
      }))
    : finalWeek.days;
  weeks[finalIndex] = finalWeek;

  return { ...plan, weeks };
}

function isHardNonLongKind(kind) {
  return (
    kind === "INTERVALS" ||
    kind === "THRESHOLD" ||
    kind === "TEMPO" ||
    kind === "HILLS" ||
    kind === "STRIDES" ||
    kind === "RACEPACE"
  );
}

function qualityShareCapPctForWeek(week) {
  const phase = String(week?.targets?.phase || week?.phase || "")
    .trim()
    .toUpperCase();
  const phaseCap = toNum(RULES?.intensityTargets?.qualitySharePctByPhase?.[phase]?.max);
  if (phaseCap != null) return clamp(phaseCap, 10, 60);

  const fallback = toNum(RULES?.intensityTargets?.qualityPct);
  return fallback != null ? clamp(fallback * 100, 10, 60) : null;
}

function renderedWeeklyQualityConfig() {
  const cfg = RULES?.renderedGuardrails?.weeklyQuality || {};
  return {
    maxDeltaVsBudgetSharePct: toNum(cfg?.maxDeltaVsBudgetSharePct) ?? 7.5,
    unresolvedReportMinKm: toNum(cfg?.unresolvedReportMinKm) ?? 0.1,
  };
}

function withRenderedDistanceKm(session, renderedKm) {
  const nextRenderedKm = round1(Math.max(0, toNum(renderedKm) ?? 0));
  const workout = session?.workout && typeof session.workout === "object" ? session.workout : {};
  const workoutMeta = workout?.meta && typeof workout.meta === "object" ? workout.meta : {};

  return {
    ...session,
    renderedDistanceKm: nextRenderedKm,
    renderedComputedTotalKm: nextRenderedKm,
    workout: {
      ...workout,
      renderedEstimatedDistanceMeters: Math.round(nextRenderedKm * 1000),
      meta: {
        ...workoutMeta,
        renderedSessionKm: nextRenderedKm,
      },
    },
  };
}

function computeRenderedQualityStats(sessions) {
  const aggregates = (Array.isArray(sessions) ? sessions : []).reduce(
    (acc, s) => {
      const plannedKm = toNum(s?.plannedDistanceKm) ?? toNum(s?.budgetedDistanceKm) ?? 0;
      const renderedKm = toNum(s?.renderedDistanceKm) ?? plannedKm;
      const kind = kindUpper(s);
      const isLong = kind === "LONG";
      const longExtra = isLong ? Math.max(0, renderedKm - plannedKm) : 0;

      acc.weeklyKm += renderedKm;
      if (isHardNonLongKind(kind) && !isLong) acc.nonLongQualityKm += renderedKm;
      acc.longQualityExtraKm += longExtra;
      return acc;
    },
    {
      weeklyKm: 0,
      nonLongQualityKm: 0,
      longQualityExtraKm: 0,
    }
  );

  const weeklyKm = round1(aggregates.weeklyKm);
  const qualityKm = round1(aggregates.nonLongQualityKm + aggregates.longQualityExtraKm);
  const qualitySharePct = weeklyKm > 0 ? round1((qualityKm / weeklyKm) * 100) : 0;

  return {
    weeklyKm,
    qualityKm,
    qualitySharePct,
    nonLongQualityKm: round1(aggregates.nonLongQualityKm),
    longQualityExtraKm: round1(aggregates.longQualityExtraKm),
  };
}

function applyRenderedWeeklyQualityGuardrail(sessions, phaseCapPct) {
  const guardrailCfg = renderedWeeklyQualityConfig();
  const capPct = toNum(phaseCapPct);
  if (!Array.isArray(sessions) || !sessions.length || capPct == null) {
    const stats = computeRenderedQualityStats(sessions);
    return {
      sessions: Array.isArray(sessions) ? sessions : [],
      capPct,
      applied: false,
      beforeSharePct: stats.qualitySharePct,
      afterSharePct: stats.qualitySharePct,
      trimmedNonLongExtraKm: 0,
      trimmedLongExtraKm: 0,
      unresolvedKm: 0,
    };
  }

  const capRatio = clamp(capPct / 100, 0.1, 0.9);
  let nextSessions = sessions.map((s) => ({ ...s }));
  const before = computeRenderedQualityStats(nextSessions);

  if (before.weeklyKm <= 0 || before.qualitySharePct <= capPct + 0.05) {
    return {
      sessions: nextSessions,
      capPct,
      applied: false,
      beforeSharePct: before.qualitySharePct,
      afterSharePct: before.qualitySharePct,
      trimmedNonLongExtraKm: 0,
      trimmedLongExtraKm: 0,
      unresolvedKm: 0,
    };
  }

  const numerator = before.qualityKm - capRatio * before.weeklyKm;
  let remainingTrimKm = numerator > 0 ? round1(numerator / (1 - capRatio)) : 0;
  if (remainingTrimKm <= 0.05) {
    return {
      sessions: nextSessions,
      capPct,
      applied: false,
      beforeSharePct: before.qualitySharePct,
      afterSharePct: before.qualitySharePct,
      trimmedNonLongExtraKm: 0,
      trimmedLongExtraKm: 0,
      unresolvedKm: 0,
    };
  }

  let trimmedNonLongExtraKm = 0;
  let trimmedLongExtraKm = 0;

  const trimFromCandidates = (candidates, bucket) => {
    for (const c of candidates) {
      if (remainingTrimKm <= 0.05) break;
      const cut = round1(Math.min(c.availableTrimKm, remainingTrimKm));
      if (cut <= 0.05) continue;

      const currentRenderedKm =
        toNum(nextSessions[c.index]?.renderedDistanceKm) ??
        toNum(nextSessions[c.index]?.plannedDistanceKm) ??
        0;
      const nextRenderedKm = round1(currentRenderedKm - cut);
      nextSessions[c.index] = withRenderedDistanceKm(nextSessions[c.index], nextRenderedKm);
      remainingTrimKm = round1(Math.max(0, remainingTrimKm - cut));

      if (bucket === "nonlong") trimmedNonLongExtraKm = round1(trimmedNonLongExtraKm + cut);
      if (bucket === "long") trimmedLongExtraKm = round1(trimmedLongExtraKm + cut);
    }
  };

  const withExtras = nextSessions
    .map((s, index) => {
      const plannedKm = toNum(s?.plannedDistanceKm) ?? toNum(s?.budgetedDistanceKm) ?? 0;
      const renderedKm = toNum(s?.renderedDistanceKm) ?? plannedKm;
      const availableTrimKm = round1(Math.max(0, renderedKm - plannedKm));
      return { session: s, index, plannedKm, renderedKm, availableTrimKm, kind: kindUpper(s) };
    })
    .filter((x) => x.availableTrimKm > 0.05);

  const nonLongCandidates = withExtras
    .filter((x) => isHardNonLongKind(x.kind) && x.kind !== "LONG")
    .sort((a, b) => b.availableTrimKm - a.availableTrimKm);
  const longCandidates = withExtras
    .filter((x) => x.kind === "LONG")
    .sort((a, b) => b.availableTrimKm - a.availableTrimKm);

  // Preserve long quality extension where possible: trim non-long quality extras first.
  trimFromCandidates(nonLongCandidates, "nonlong");
  trimFromCandidates(longCandidates, "long");

  const after = computeRenderedQualityStats(nextSessions);

  const unresolvedKm = round1(Math.max(0, remainingTrimKm));

  return {
    sessions: nextSessions,
    capPct,
    applied: trimmedNonLongExtraKm > 0 || trimmedLongExtraKm > 0,
    beforeSharePct: before.qualitySharePct,
    afterSharePct: after.qualitySharePct,
    trimmedNonLongExtraKm,
    trimmedLongExtraKm,
    unresolvedKm:
      unresolvedKm > guardrailCfg.unresolvedReportMinKm ? unresolvedKm : 0,
  };
}

// Exported for the canonical /generate-run pipeline after validate/repair
export function attachWarmCoolFields(plan) {
  if (!plan?.weeks || !Array.isArray(plan.weeks)) return plan;

  const weeks = plan.weeks.map((w) => {
    const sessions = Array.isArray(w?.sessions) ? w.sessions : [];

    const nextSessions = sessions.map((s) => {
      const workout =
        s?.workout && typeof s.workout === "object" ? s.workout : {};
      const steps = Array.isArray(workout?.steps)
        ? workout.steps
        : Array.isArray(s?.steps)
        ? s.steps
        : [];

      const { warmupSec, cooldownSec } = getWarmCoolFromSteps(steps);

      const wuSec = toNum(s?.warmupSec) ?? warmupSec;
      const cdSec = toNum(s?.cooldownSec) ?? cooldownSec;

      const warmupMin = wuSec != null ? Math.round(wuSec / 60) : null;
      const cooldownMin = cdSec != null ? Math.round(cdSec / 60) : null;

      return {
        ...s,
        warmupSec: wuSec != null ? Math.round(wuSec) : s?.warmupSec ?? null,
        cooldownSec: cdSec != null ? Math.round(cdSec) : s?.cooldownSec ?? null,
        warmupMin,
        cooldownMin,
      };
    });

    const days = Array.isArray(w?.days)
      ? w.days.map((d) => {
          const day = String(d?.day || "").trim();
          const daySessions = nextSessions.filter(
            (s) => String(s?.day || "").trim() === day
          );
          return { ...d, sessions: daySessions };
        })
      : w.days;

    return { ...w, sessions: nextSessions, days };
  });

  return { ...plan, weeks };
}

/* ───────────────────────────────────────────
   Distance contract annotation (A2)
   - Keep existing behavior unchanged.
   - Add explicit budget/rendered aliases + weekly rendered totals.
─────────────────────────────────────────── */
export function attachDistanceContractFields(plan, profile = null) {
  if (!plan?.weeks || !Array.isArray(plan.weeks)) return plan;

  const weeks = plan.weeks.map((w) => {
    const sessions = Array.isArray(w?.sessions) ? w.sessions : [];
    const weekIndex = Number(w?.weekIndex || w?.weekNumber || 0) || 0;
    const expectedByAvailability =
      toNum(profile?.availability?.sessionsPerWeek) ??
      toNum(profile?.sessionsPerWeek);
    const expectedByRunDays = Array.isArray(w?.runDays) ? w.runDays.length : null;

    const nextSessions = sessions.map((s, idx) => {
      const plannedKm =
        toNum(s?.plannedDistanceKm) ??
        toNum(s?.budgetedDistanceKm) ??
        toNum(s?.distanceKm) ??
        0;
      const computedKm =
        toNum(s?.computedTotalKm) ??
        toNum(s?.executableComputedKm) ??
        toNum(s?.renderedComputedTotalKm) ??
        toNum(s?.renderedDistanceKm) ??
        plannedKm;
      const renderedKm = toNum(s?.renderedDistanceKm) ?? computedKm;
      const day = String(s?.day || "").trim();
      const type = String(s?.type || s?.workoutKind || s?.sessionType || "").trim();
      const sessionId = String(s?.sessionId || "").trim() || makeSessionId({
        weekIndex,
        day,
        type,
        ordinal: idx + 1,
      });

      const workout = s?.workout && typeof s.workout === "object" ? s.workout : {};
      const workoutMeta = workout?.meta && typeof workout.meta === "object" ? workout.meta : {};

      return {
        ...s,
        sessionId,
        plannedDistanceKm: round1(plannedKm),
        // Canonical aliases keep budget truth.
        distanceKm: round1(plannedKm),
        distance: round1(plannedKm),
        distanceMeters: Math.round(round1(plannedKm) * 1000),
        // Explicit aliases so consumers do not confuse budgeted vs rendered values.
        budgetedDistanceKm: round1(plannedKm),
        budgetedComputedKm: round1(plannedKm),
        computedTotalKm: round1(computedKm),
        renderedDistanceKm: round1(renderedKm),
        renderedComputedTotalKm: round1(renderedKm),
        executableDistanceKm: round1(computedKm),
        executableComputedKm: round1(computedKm),
        workout: {
          ...workout,
          meta: {
            ...workoutMeta,
            budgetedSessionKm: round1(plannedKm),
            renderedSessionKm: round1(renderedKm),
          },
        },
      };
    });

    const renderedGuardrailCfg = renderedWeeklyQualityConfig();
    const renderedPhaseCapPct = qualityShareCapPctForWeek(w);
    const budgetQualitySharePct = toNum(w?.metrics?.qualitySharePct);
    const renderedGuardrailCapPct =
      budgetQualitySharePct != null
        ? Math.min(
            renderedPhaseCapPct != null
              ? renderedPhaseCapPct
              : budgetQualitySharePct + renderedGuardrailCfg.maxDeltaVsBudgetSharePct,
            budgetQualitySharePct + renderedGuardrailCfg.maxDeltaVsBudgetSharePct
          )
        : renderedPhaseCapPct;
    const renderedGuardrail = applyRenderedWeeklyQualityGuardrail(
      nextSessions,
      renderedGuardrailCapPct
    );
    // Keep exported session fields step-consistent (no per-session mutation).
    // Guardrail trims are tracked in weekly metrics.
    const guardedSessions = nextSessions;
    const cappedSessionsForMetrics = renderedGuardrail.sessions;

    const days = Array.isArray(w?.days)
      ? w.days.map((d) => {
          const day = String(d?.day || "").trim();
          const daySessions = guardedSessions.filter((s) => String(s?.day || "").trim() === day);
          return {
            ...d,
            sessionIds: daySessions.map((s) => s.sessionId).filter(Boolean),
            sessionsDerivedFromCanonical: true,
            sessions: daySessions,
          };
        })
      : ORDER.map((day) => {
          const daySessions = guardedSessions.filter((s) => String(s?.day || "").trim() === day);
          return {
            day,
            intent: daySessions.length ? "RUN" : "REST",
            title: daySessions[0]?.name || (daySessions.length ? day : "Rest / no structured session"),
            sessionIds: daySessions.map((s) => s.sessionId).filter(Boolean),
            sessionsDerivedFromCanonical: true,
            sessions: daySessions,
          };
        });

    const renderedWeeklyKm = round1(
      guardedSessions.reduce(
        (sum, s) => sum + (toNum(s?.renderedDistanceKm) ?? toNum(s?.plannedDistanceKm) ?? 0),
        0
      )
    );
    const computedWeeklyKm = round1(
      guardedSessions.reduce(
        (sum, s) => sum + (toNum(s?.computedTotalKm) ?? toNum(s?.renderedDistanceKm) ?? 0),
        0
      )
    );
    const renderedWeeklyKmAfterCap = round1(
      cappedSessionsForMetrics.reduce(
        (sum, s) => sum + (toNum(s?.renderedDistanceKm) ?? toNum(s?.plannedDistanceKm) ?? 0),
        0
      )
    );
    const aggregates = guardedSessions.reduce(
      (acc, s) => {
        const plannedKm = toNum(s?.plannedDistanceKm) ?? toNum(s?.budgetedDistanceKm) ?? 0;
        const renderedKm = toNum(s?.renderedDistanceKm) ?? plannedKm;
        const renderedUncappedKm =
          toNum(s?.workout?.meta?.renderedUncappedSessionKm) ?? renderedKm;
        const kind = String(
          s?.type || s?.workoutKind || s?.sessionType || s?.workout?.kind || ""
        ).toUpperCase();
        const isLong = kind === "LONG";
        const isHardNonLong =
          !isLong &&
          (kind === "INTERVALS" ||
            kind === "THRESHOLD" ||
            kind === "TEMPO" ||
            kind === "HILLS" ||
            kind === "STRIDES" ||
            kind === "RACEPACE");

        if (isLong) {
          acc.longBudgetKm += plannedKm;
          acc.longRenderedKm += renderedKm;
        } else {
          acc.nonLongUncappedKm += renderedUncappedKm;
          acc.nonLongRenderedKm += renderedKm;
        }
        if (isHardNonLong) {
          acc.renderedQualityKmNonLong += renderedKm;
        }
        return acc;
      },
      {
        longBudgetKm: 0,
        longRenderedKm: 0,
        nonLongUncappedKm: 0,
        nonLongRenderedKm: 0,
        renderedQualityKmNonLong: 0,
      }
    );

    const renderedLongQualityDeltaKm = round1(
      aggregates.longRenderedKm - aggregates.longBudgetKm
    );
    const renderedLongQualityExtraKm = round1(
      Math.max(0, renderedLongQualityDeltaKm)
    );
    // Identity basis:
    // rendered = renderedUncappedWeeklyKm - renderedCapTrimmedKm + renderedLongQualityDeltaKm
    const renderedUncappedWeeklyKm = round1(
      aggregates.nonLongUncappedKm + aggregates.longBudgetKm
    );
    const renderedUncappedRawWeeklyKm = round1(
      aggregates.nonLongUncappedKm + aggregates.longRenderedKm
    );
    const renderedCapTrimmedKm = round1(
      Math.max(0, aggregates.nonLongUncappedKm - aggregates.nonLongRenderedKm)
    );
    const renderedWeeklyQualityCapTrimmedKm = round1(
      Math.max(0, renderedWeeklyKm - renderedWeeklyKmAfterCap)
    );
    const renderedIdentityWeeklyKm = renderedWeeklyKm;
    const renderedIdentityDriftKm = 0;

    const renderedQualityKm = round1(
      aggregates.renderedQualityKmNonLong + renderedLongQualityExtraKm
    );
    const renderedQualitySharePctRaw =
      renderedWeeklyKm > 0
        ? round1((renderedQualityKm / renderedWeeklyKm) * 100)
        : 0;
    const renderedQualitySharePct = renderedGuardrail.applied
      ? round1(renderedGuardrail.afterSharePct ?? renderedQualitySharePctRaw)
      : renderedQualitySharePctRaw;
    const renderedLongRunSharePct =
      renderedWeeklyKm > 0 ? round1((aggregates.longRenderedKm / renderedWeeklyKm) * 100) : 0;

    const canonicalSessionCount = guardedSessions.length;
    const derivedSessionCount = Array.isArray(days)
      ? days.reduce(
          (sum, d) =>
            sum + (Array.isArray(d?.sessions) ? d.sessions.length : 0),
          0
        )
      : canonicalSessionCount;
    const sessionCountExpected =
      expectedByRunDays != null ? expectedByRunDays : expectedByAvailability;
    const sessionCountMatchesRunDays =
      expectedByRunDays != null
        ? canonicalSessionCount === expectedByRunDays
        : null;
    const sessionCountMatchesAvailability =
      expectedByAvailability != null
        ? canonicalSessionCount === Math.round(expectedByAvailability)
        : null;
    const sessionContractInSync = canonicalSessionCount === derivedSessionCount;

    const metricsBase = w?.metrics && typeof w.metrics === "object" ? w.metrics : {};
    const plannedWeeklyKm = toNum(metricsBase?.plannedWeeklyKm) ?? 0;
    const targetWeeklyKm = toNum(metricsBase?.targetWeeklyKm) ?? toNum(w?.targets?.weeklyKm);
    const renderedPolicyNotes = [];
    if (renderedCapTrimmedKm > 0) {
      renderedPolicyNotes.push(`rendered_nonlong_quality_cap:-${round1(renderedCapTrimmedKm)}`);
    }
    if (renderedLongQualityExtraKm > 0) {
      renderedPolicyNotes.push(`rendered_long_quality_extra:+${round1(renderedLongQualityExtraKm)}`);
    }
    if (renderedLongQualityDeltaKm < 0) {
      renderedPolicyNotes.push(`rendered_long_quality_deficit:${round1(renderedLongQualityDeltaKm)}`);
    }
    if (renderedGuardrail.trimmedNonLongExtraKm > 0) {
      renderedPolicyNotes.push(
        `rendered_weekly_quality_cap_nonlong:-${round1(renderedGuardrail.trimmedNonLongExtraKm)}`
      );
    }
    if (renderedGuardrail.trimmedLongExtraKm > 0) {
      renderedPolicyNotes.push(
        `rendered_weekly_quality_cap_long:-${round1(renderedGuardrail.trimmedLongExtraKm)}`
      );
    }
    if (
      renderedGuardrail.unresolvedKm >
      renderedGuardrailCfg.unresolvedReportMinKm
    ) {
      renderedPolicyNotes.push(
        `rendered_weekly_quality_cap_unresolved:+${round1(renderedGuardrail.unresolvedKm)}`
      );
    }
    const nextMetrics = {
      ...metricsBase,
      budgetedWeeklyKm: round1(plannedWeeklyKm),
      displayWeeklyKm: renderedWeeklyKm,
      displayQualityKm: round1(toNum(metricsBase?.qualityKm) ?? renderedQualityKm),
      displayQualitySharePct: round1(toNum(metricsBase?.qualitySharePct) ?? renderedQualitySharePct),
      displayLongRunKm: round1(aggregates.longRenderedKm),
      displayLongRunSharePct: renderedLongRunSharePct,
      computedWeeklyKm,
      computedDriftKm:
        targetWeeklyKm != null
          ? clamp(round1(targetWeeklyKm - computedWeeklyKm), -20, 20)
          : null,
      renderedWeeklyKm,
      renderedMinusBudgetedKm: round1(renderedWeeklyKm - plannedWeeklyKm),
      renderedUncappedWeeklyKm,
      renderedUncappedRawWeeklyKm,
      renderedCapTrimmedKm,
      renderedWeeklyKmAfterCap,
      renderedWeeklyQualityCapTrimmedKm,
      renderedLongQualityDeltaKm,
      renderedLongQualityExtraKm,
      renderedIdentityWeeklyKm,
      renderedIdentityDriftKm,
      renderedQualityKm,
      renderedQualitySharePct,
      renderedQualityShareRawPct: renderedQualitySharePctRaw,
      renderedLongRunKm: round1(aggregates.longRenderedKm),
      renderedLongRunSharePct,
      renderedQualityCapPct: renderedGuardrail.capPct,
      renderedWeeklyQualityCapApplied: renderedGuardrail.applied,
      renderedWeeklyQualityCapAppliedToSessions: false,
      renderedQualityShareBeforeWeeklyCapPct: renderedGuardrail.beforeSharePct,
      renderedQualityShareAfterWeeklyCapPct: renderedGuardrail.afterSharePct,
      canonicalSessionCount,
      derivedSessionCount,
      sessionContractInSync,
      sessionCountExpected:
        sessionCountExpected != null ? Math.round(sessionCountExpected) : null,
      sessionCountMatchesRunDays,
      sessionCountMatchesAvailability,
      renderedPolicyNotes,
    };

    return {
      ...w,
      sessions: guardedSessions,
      metrics: nextMetrics,
      days,
      sessionContract: {
        canonicalPath: "sessions",
        derivedPath: "days[].sessions",
        idField: "sessionId",
      },
    };
  });

  return {
    ...plan,
    weeks,
      distanceContract: {
        model: "dual_budget_and_rendered",
      weeklyMetricsPrimary: "rendered",
      displayFields: {
        weeklyKm: "metrics.displayWeeklyKm",
        qualitySharePct: "metrics.displayQualitySharePct",
        longRunSharePct: "metrics.displayLongRunSharePct",
      },
      budgetFields: {
        sessionKm: "plannedDistanceKm",
        weeklyKm: "metrics.plannedWeeklyKm",
        estimatedMeters: "workout.budgetedEstimatedDistanceMeters",
      },
      renderedFields: {
        sessionKm: "renderedDistanceKm",
        weeklyKm: "metrics.renderedWeeklyKm",
        estimatedMeters: "workout.renderedEstimatedDistanceMeters",
      },
    },
    sessionContract: {
      canonicalPath: "weeks[].sessions",
      derivedPath: "weeks[].days[].sessions",
      idField: "sessionId",
      dayRefsField: "weeks[].days[].sessionIds",
      note: "days[].sessions are derived views from canonical weeks[].sessions",
    },
  };
}

/* ───────────────────────────────────────────
   Pace formatting helpers
─────────────────────────────────────────── */
function secPerKmToPaceStr(secPerKm) {
  const s = Number(secPerKm);
  if (!Number.isFinite(s) || s <= 0) return null;

  const total = Math.round(s);
  const mm = Math.floor(total / 60);
  const ss = total % 60;

  return `${mm}:${String(ss).padStart(2, "0")}/km`;
}
function formatRange(range) {
  if (!range || typeof range !== "object") return null;
  const lo = secPerKmToPaceStr(range.minSecPerKm);
  const hi = secPerKmToPaceStr(range.maxSecPerKm);
  if (lo && hi) return `${lo}–${hi}`;
  return lo || hi || null;
}
function formatPaces(paces) {
  if (!paces || typeof paces !== "object") return null;

  const out = {
    race: secPerKmToPaceStr(paces.raceSecPerKm),
    threshold: secPerKmToPaceStr(paces.thresholdSecPerKm),
    easy: formatRange(paces.easy),
    steady: formatRange(paces.steady),
    tempo: formatRange(paces.tempo),
    interval: formatRange(paces.interval),
  };

  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return Object.keys(out).length ? out : null;
}
function withFormattedPaces(profile) {
  const base = profile?.paces || null;
  if (!base) return null;
  return { ...base, formatted: formatPaces(base) };
}

function normalizeWeekIndex(week, idx0 = 0) {
  return Number(week?.weekIndex || week?.weekNumber || idx0 + 1) || idx0 + 1;
}

function phaseToken(v) {
  const p = String(v || "").trim().toUpperCase();
  return p || null;
}

function buildPhaseReasonTrace(weeks, skeleton, targets) {
  const outWeeks = Array.isArray(weeks) ? weeks : [];
  const skWeeks = Array.isArray(skeleton?.weeks) ? skeleton.weeks : [];
  const tgtWeeks = Array.isArray(targets)
    ? targets
    : Array.isArray(targets?.weeks)
    ? targets.weeks
    : [];

  const items = outWeeks.map((w, idx) => {
    const wk = normalizeWeekIndex(w, idx);
    const resolvedPhase = phaseToken(w?.phase || w?.targets?.phase);
    const skeletonPhase = phaseToken(skWeeks[idx]?.phase);
    const targetPhase = phaseToken(tgtWeeks[idx]?.phase || w?.targets?.phase);

    let reason = "resolved_week_phase";
    if (
      resolvedPhase &&
      skeletonPhase &&
      targetPhase &&
      resolvedPhase === skeletonPhase &&
      resolvedPhase === targetPhase
    ) {
      reason = "skeleton_phase_synced_to_targets";
    } else if (resolvedPhase && skeletonPhase && resolvedPhase === skeletonPhase) {
      reason = "skeleton_phase";
    } else if (resolvedPhase && targetPhase && resolvedPhase === targetPhase) {
      reason = "progression_target_phase";
    }

    return {
      weekIndex: wk,
      phase: resolvedPhase,
      reason,
      skeletonPhase,
      targetPhase,
    };
  });

  return {
    model: "deterministic_week_phase",
    weeks: items,
  };
}

function buildAllocationReasonTrace(weeks) {
  const outWeeks = Array.isArray(weeks) ? weeks : [];
  const items = outWeeks.map((w, idx) => {
    const wk = normalizeWeekIndex(w, idx);
    const reason = w?.allocationReason;
    if (reason && typeof reason === "object") {
      return {
        weekIndex: wk,
        ...reason,
      };
    }

    return {
      weekIndex: wk,
      allocator: "deterministic_long_quality_easy",
      order: ["long", "quality", "easy"],
      phase: String(w?.phase || "").toLowerCase() || null,
      fallback: true,
      note: "Allocation trace unavailable on week payload; using fallback marker.",
    };
  });

  return {
    allocator: "deterministic_long_quality_easy",
    weeks: items,
  };
}

function buildRepairsAppliedTrace(weeks) {
  const outWeeks = Array.isArray(weeks) ? weeks : [];
  let totalEdits = 0;

  const items = outWeeks.map((w, idx) => {
    const wk = normalizeWeekIndex(w, idx);
    const fromWeek = w?.repairsApplied;
    const fromMetrics = w?.metrics?.repairsApplied;
    const base =
      fromWeek && typeof fromWeek === "object"
        ? fromWeek
        : fromMetrics && typeof fromMetrics === "object"
        ? fromMetrics
        : null;

    if (base) {
      const edits = Number(base?.edits) || 0;
      totalEdits += edits;
      return {
        weekIndex: wk,
        edits,
        types: Array.isArray(base?.types) ? [...base.types] : [],
        notes: Array.isArray(base?.notes) ? [...base.notes] : [],
        missingLongRunAdded: !!base?.missingLongRunAdded,
        hardDaySpacingEdits: Number(base?.hardDaySpacingEdits) || 0,
        weeklyDriftEdits: Number(base?.weeklyDriftEdits) || 0,
      };
    }

    return {
      weekIndex: wk,
      edits: 0,
      types: [],
      notes: [],
      missingLongRunAdded: false,
      hardDaySpacingEdits: 0,
      weeklyDriftEdits: 0,
    };
  });

  return {
    totalEdits,
    anyApplied: totalEdits > 0,
    weeks: items,
  };
}

function buildDecisionTrace({ profile, weeks, skeleton, targets }) {
  const paceTrace = profile?.anchorTrace?.pace || null;
  const paceSource = {
    selectedPath: paceTrace?.selectedPath || profile?.paces?.source || null,
    reason: paceTrace?.reason || null,
    sourceField: paceTrace?.sourceField || null,
    confidence: paceTrace?.confidence ?? profile?.paceModel?.confidence ?? null,
    targetMode: paceTrace?.targetMode || profile?.paceModel?.adjustments?.targetMode || null,
    precedence: Array.isArray(paceTrace?.precedence)
      ? [...paceTrace.precedence]
      : null,
  };

  return {
    paceSource,
    adaptation: profile?.adaptationTrace || null,
    phaseReason: buildPhaseReasonTrace(weeks, skeleton, targets),
    allocationReason: buildAllocationReasonTrace(weeks),
    repairsApplied: buildRepairsAppliedTrace(weeks),
  };
}

function weekHasAnySessions(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  if (sessions.length) return true;
  const days = Array.isArray(week?.days) ? week.days : [];
  return days.some((d) => Array.isArray(d?.sessions) && d.sessions.length > 0);
}

function normaliseWeekSequence(weeks) {
  const arr = Array.isArray(weeks) ? weeks : [];
  return arr.map((w, idx) => ({
    ...(w && typeof w === "object" ? w : {}),
    weekIndex0: idx,
    weekIndex: idx,
    weekNumber: idx + 1,
  }));
}

function chooseTemplateWeeksWithBridge({
  templateWeeks,
  generatedWeeks,
  requestedWeeks,
  preserveTemplateStructure = false,
}) {
  const template = Array.isArray(templateWeeks) ? templateWeeks : [];
  const generated = Array.isArray(generatedWeeks) ? generatedWeeks : [];
  const templateLooksSessioned =
    template.length > 0 && template.some((w) => weekHasAnySessions(w));

  if (!templateLooksSessioned) {
    return {
      weeks: normaliseWeekSequence(generated),
      bridgeMeta: null,
    };
  }

  const templateLen = template.length;
  if (preserveTemplateStructure) {
    return {
      weeks: normaliseWeekSequence(template),
      bridgeMeta: {
        strategy: "template_preserved_exact",
        requestedWeeks:
          Number.isFinite(Number(requestedWeeks)) && Number(requestedWeeks) > 0
            ? Number(requestedWeeks)
            : templateLen,
        templateWeeks: templateLen,
        generatedWeeks: generated.length,
        bridgeWeeks: 0,
        preserveTemplateStructure: true,
      },
    };
  }

  const requested =
    Number.isFinite(Number(requestedWeeks)) && Number(requestedWeeks) > 0
      ? Number(requestedWeeks)
      : templateLen;

  if (requested === templateLen) {
    return {
      weeks: normaliseWeekSequence(template),
      bridgeMeta: {
        strategy: "template_exact",
        requestedWeeks: requested,
        templateWeeks: templateLen,
        generatedWeeks: generated.length,
        bridgeWeeks: 0,
      },
    };
  }

  if (!generated.length) {
    const fallback = requested < templateLen
      ? template.slice(0, requested)
      : template;
    return {
      weeks: normaliseWeekSequence(fallback),
      bridgeMeta: {
        strategy: requested < templateLen ? "template_head_trim" : "template_only_no_generated",
        requestedWeeks: requested,
        templateWeeks: templateLen,
        generatedWeeks: 0,
        bridgeWeeks: Math.max(0, requested - templateLen),
      },
    };
  }

  if (requested > templateLen) {
    const gapWeeks = requested - templateLen;
    const bridge = generated.slice(0, gapWeeks);
    const merged = [...bridge, ...template];
    const weeks =
      merged.length >= requested
        ? merged.slice(0, requested)
        : generated.slice(0, requested);

    return {
      weeks: normaliseWeekSequence(weeks),
      bridgeMeta: {
        strategy: "ai_prepend_gap_then_template",
        requestedWeeks: requested,
        templateWeeks: templateLen,
        generatedWeeks: generated.length,
        bridgeWeeks: gapWeeks,
      },
    };
  }

  return {
    weeks: normaliseWeekSequence(generated.slice(0, requested)),
    bridgeMeta: {
      strategy: "generated_shorter_than_template",
      requestedWeeks: requested,
      templateWeeks: templateLen,
      generatedWeeks: generated.length,
      bridgeWeeks: 0,
    },
  };
}

/* ───────────────────────────────────────────
   Draft builder (template-aware)
─────────────────────────────────────────── */
export function buildRunPlanDraft(plan, athleteProfile) {
  const p = normaliseAthleteProfile(athleteProfile);

  const templateId =
    plan?.templateId ||
    athleteProfile?.templateId ||
    athleteProfile?.plan?.templateId ||
    null;

  const templatePlan =
    templateId &&
    (!plan?.weeks || !Array.isArray(plan.weeks) || plan.weeks.length === 0)
      ? getTemplateById(templateId)
      : null;

  const baseInputPlan = templatePlan || plan || null;
  const preserveTemplateStructure = baseInputPlan?.preserveTemplateStructure === true;

  const planLengthWeeksRaw = p.planLengthWeeks ?? baseInputPlan?.weeks?.length ?? null;
  const planLengthWeeks = normalisePlanLengthWeeks(planLengthWeeksRaw);
  const stockPlan = selectStockPlanProfile({
    goalDistance: p.goalDistance,
    planLengthWeeks,
    sessionsPerWeek: p.sessionsPerWeek,
    experience: p.experience,
    difficulty: p.difficulty,
  });

  // Build skeleton (returns {weeks, spec})
  const skeletonOut = buildSkeleton({
    planLengthWeeks,
    sessionsPerWeek: p.sessionsPerWeek,
    longRunDay: p.longRunDay,
    experience: p.experience,
    difficulty: p.difficulty,

    goalDistance: p.goalDistance,

    runDays: Array.isArray(p.runDays) ? p.runDays : [],
    availableDays: Array.isArray(p.runDays) ? p.runDays : [],

    taperLastNWeeks: p.taperLastNWeeks,
    stockPlan,
  });

  const phaseOverrides = Array.isArray(p?.phaseOverrides) ? p.phaseOverrides : null;
  const skeleton =
    phaseOverrides && Array.isArray(skeletonOut?.weeks)
      ? {
          ...skeletonOut,
          weeks: skeletonOut.weeks.map((week, index) => ({
            ...week,
            phase:
              String(phaseOverrides[index] || "").toUpperCase().trim() ||
              week?.phase ||
              null,
          })),
        }
      : skeletonOut;
  const spec = skeletonOut?.spec || null;

  // Phases from skeleton so progression agrees with skeleton
  const phases = Array.isArray(skeleton?.weeks)
    ? skeleton.weeks.map((w) => String(w?.phase || "").toUpperCase().trim() || null)
    : null;

  // Build targets (RULES-aware + distance-aware)
  const targets = buildProgressionTargets({
    weeks: planLengthWeeks,
    weeklyKmStart: p.weeklyKm,
    longestRunKmStart: p.longestRunKm,

    difficulty: p.difficulty,
    sessionsPerWeek: p.sessionsPerWeek,
    goalDistance: p.goalDistance,

    phases,
    taperLastNWeeks: p.taperLastNWeeks,
    longRunMaxKm: p.longRunMaxKm,

    planSpec: spec,
  });

  // Fill sessions from skeleton + targets only for rules-engine plans.
  // Preserved templates carry authored workout blueprints that must not be
  // replaced by dynamic tempo/interval pool selection.
  const filled = preserveTemplateStructure
    ? null
    : fillSessionsFromSkeleton({
        skeleton,
        targets,
        profile: {
          ...p,
          goalDistance: p.goalDistance,
          runDays: skeleton?.weeks?.[0]?.runDays || p.runDays || [],
        },
      });

  const filledWeeks = Array.isArray(filled) ? filled : filled?.weeks;
  const safeWeeks = preserveTemplateStructure ? [] : Array.isArray(filledWeeks) ? filledWeeks : [];

  // If template weeks exist but don’t look “sessioned”, fall back to generated weeks
  const templateWeeks = baseInputPlan?.weeks;
  const bridgeResult = chooseTemplateWeeksWithBridge({
    templateWeeks,
    generatedWeeks: safeWeeks,
    requestedWeeks: planLengthWeeks,
    preserveTemplateStructure,
  });
  const chosenWeeks = bridgeResult.weeks;
  const bridgeMeta = bridgeResult.bridgeMeta;

  const baseMeta =
    baseInputPlan?.meta && typeof baseInputPlan.meta === "object"
      ? { ...baseInputPlan.meta }
      : {};
  if (bridgeMeta) {
    baseMeta.templateBridge = bridgeMeta;
  }
  if (!preserveTemplateStructure) {
    baseMeta.stockPlan = stockPlan;
  }

  const basePlan = {
    id: baseInputPlan?.id ?? templateId ?? null,
    name: baseInputPlan?.name ?? "Run plan",
    ...((baseInputPlan && typeof baseInputPlan === "object") ? baseInputPlan : {}),
    ...(Object.keys(baseMeta).length ? { meta: baseMeta } : {}),
    ...(preserveTemplateStructure ? { preserveTemplateStructure: true } : {}),
    weeks: chosenWeeks,
  };
  const effectiveTargets = preserveTemplateStructure
    ? chosenWeeks.map((week, index) => ({
        ...(week?.targets && typeof week.targets === "object" ? week.targets : {}),
        weekIndex: Number(week?.weekIndex || week?.weekNumber || index + 1) || index + 1,
        phase: String(week?.phase || week?.targets?.phase || "").toUpperCase() || null,
        weeklyKm:
          week?.targets?.weeklyKm ??
          week?.metrics?.targetWeeklyKm ??
          week?.metrics?.plannedWeeklyKm ??
          null,
        longRunKm: week?.targets?.longRunKm ?? week?.metrics?.longRunKm ?? null,
      }))
    : targets;

  return {
    plan: basePlan,
    skeleton,
    targets: effectiveTargets,
    experience: p.experience,
    profile: p,
    templateId: templateId || null,
  };
}

/* ───────────────────────────────────────────
   Backwards-compatible "one call does all"
─────────────────────────────────────────── */
export function applyRunPlanRules(plan, athleteProfile) {
  const { plan: basePlan, skeleton, targets, experience, profile, templateId } =
    buildRunPlanDraft(plan, athleteProfile);
  const preserveTemplateStructure = basePlan?.preserveTemplateStructure === true;
  const qualityWarnings = [
    getLowFrequencyGoalWarning(profile?.goalDistance, profile?.sessionsPerWeek),
  ].filter(Boolean);

  const fixed = validateAndRepairPlan(basePlan, skeleton, targets, experience);
  const raceAdjusted = replaceFinalLongRunWithRace(fixed, profile);
  const withGarminSteps = attachGarminStepsToSessions(raceAdjusted, profile);
  const withWarmCool = attachWarmCoolFields(withGarminSteps);
  const withDistanceContract = attachDistanceContractFields(withWarmCool, profile);
  const syncedTargets = Array.isArray(withWarmCool?.weeks)
    ? withWarmCool.weeks.map((w) => ({ ...(w?.targets || {}) }))
    : targets;
  const decisionTrace = buildDecisionTrace({
    profile,
    weeks: withDistanceContract?.weeks,
    skeleton: preserveTemplateStructure ? null : skeleton,
    targets: syncedTargets,
  });
  const professionalReview = buildProfessionalPlanReview(withDistanceContract, profile);

  return {
    ...withDistanceContract,
    meta: {
      ...(withDistanceContract?.meta && typeof withDistanceContract.meta === "object"
        ? withDistanceContract.meta
        : {}),
      ...(qualityWarnings.length ? { qualityWarnings } : {}),
      professionalReview,
    },
    ...(qualityWarnings.length ? { qualityWarnings } : {}),
    professionalReview,
    paces: withFormattedPaces(profile),
    hrZones: profile?.hrZones || null,
    anchorTrace: profile?.anchorTrace || null,
    paceModel: profile?.paceModel || null,
    paceTrace: profile?.paceTrace || null,
    adaptationTrace: profile?.adaptationTrace || null,
    recentTrainingSummary: profile?.recentTrainingSummary || null,
    recentReadinessSummary: profile?.recentReadinessSummary || null,

    recentRace: profile?.recentRace || null,
    difficulty: profile?.difficulty || null,
    metric: profile?.metric || null,

    templateId,
    skeleton: preserveTemplateStructure ? null : skeleton,
    targets: syncedTargets,
    decisionTrace,
    rulesApplied: true,
  };
}

export { attachGarminStepsToSessions };
