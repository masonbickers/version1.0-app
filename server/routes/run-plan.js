// server/routes/run-plan.js
import express from "express";
import { applyRunPlanRules } from "../lib/train/planRules/index.js";

const router = express.Router();

/* -------------------- helpers -------------------- */

const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function uniq(arr) {
  return [...new Set(asArray(arr))];
}

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Distance contract (Option A — recommended):
 * - plannedDistanceKm: THE budget truth (weekly totals + primary UI distance)
 * - distanceKm: MUST MATCH plannedDistanceKm
 * - computedTotalKm: expanded/debug only
 * - distanceMeters: must match planned distanceKm
 */
function plannedKmForSession(s) {
  const base = safeNum(s?.plannedDistanceKm) ?? safeNum(s?.distanceKm) ?? 0;
  return base;
}

function expandedKmForSession(s) {
  const computed = safeNum(s?.computedTotalKm);
  if (computed != null) return computed;
  return plannedKmForSession(s);
}

function getKindUpper(s) {
  return String(
    s?.workoutKind ||
      s?.type ||
      s?.sessionType ||
      s?.workout?.kind ||
      s?.workout?.type ||
      ""
  )
    .trim()
    .toUpperCase();
}

/**
 * ✅ Output normalisation (Option A):
 * - plannedDistanceKm remains truth
 * - distanceKm forced to plannedDistanceKm
 * - distanceMeters matches planned
 * - workout.estimatedDistanceMeters can remain expanded (nice for garmin preview)
 */
function normaliseSessionDistanceForOutput(session) {
  if (!session) return session;

  const plannedKm = plannedKmForSession(session);
  const computedKm = safeNum(session?.computedTotalKm);

  const plannedMeters = Math.round(plannedKm * 1000);
  const expandedMeters = computedKm != null ? Math.round(computedKm * 1000) : null;

  const workout =
    session?.workout && typeof session.workout === "object"
      ? session.workout
      : null;

  const nextWorkout = workout
    ? {
        ...workout,
        estimatedDistanceMeters:
          expandedMeters != null ? expandedMeters : plannedMeters,
      }
    : workout;

  return {
    ...session,
    plannedDistanceKm: plannedKm,
    computedTotalKm:
      computedKm != null ? computedKm : session?.computedTotalKm ?? null,

    // ✅ Contract fields (planned/budget)
    distanceKm: plannedKm,
    distance: plannedKm,
    distanceMeters: plannedMeters,

    ...(nextWorkout ? { workout: nextWorkout } : {}),
  };
}

function normalisePlanDistancesForOutput(plan) {
  if (!plan || !Array.isArray(plan?.weeks)) return plan;

  const weeks = plan.weeks.map((w) => {
    const sessions = asArray(w?.sessions).map(normaliseSessionDistanceForOutput);

    const days = asArray(w?.days).map((d) => ({
      ...d,
      sessions: asArray(d?.sessions).map(normaliseSessionDistanceForOutput),
    }));

    return {
      ...w,
      sessions,
      days: w?.days ? days : w?.days,
    };
  });

  return { ...plan, weeks };
}

/**
 * Add per-week computed metrics (so jq can compare properly):
 * - metrics.computedWeeklyKm = sum(computedTotalKm) (falls back to planned)
 * - metrics.summedPlannedKm  = sum(plannedDistanceKm)
 */
function attachWeekDistanceMetrics(plan) {
  if (!plan || !Array.isArray(plan?.weeks)) return plan;

  const weeks = plan.weeks.map((w) => {
    const sessions = asArray(w?.sessions);

    const summedPlannedKm = round1(
      sessions.reduce((sum, s) => sum + plannedKmForSession(s), 0)
    );

    const computedWeeklyKm = round1(
      sessions.reduce((sum, s) => sum + expandedKmForSession(s), 0)
    );

    const nextMetrics = {
      ...(w?.metrics && typeof w.metrics === "object" ? w.metrics : {}),
      computedWeeklyKm,
      summedPlannedKm,
    };

    return { ...w, metrics: nextMetrics };
  });

  return { ...plan, weeks };
}

function isHardSession(s) {
  if (!s) return false;
  if (s.isHard != null) return Boolean(s.isHard);
  if (s?.workout?.isHard != null) return Boolean(s.workout.isHard);

  const t = getKindUpper(s);
  return (
    t === "INTERVALS" ||
    t === "TEMPO" ||
    t === "THRESHOLD" ||
    t === "HILLS" ||
    t === "RACEPACE" ||
    t === "QUALITY"
  );
}

function isLongSession(s) {
  if (!s) return false;
  if (s.isLong != null) return Boolean(s.isLong);
  if (s?.workout?.isLong != null) return Boolean(s.workout.isLong);

  const t = getKindUpper(s);
  return t === "LONG" || t === "LONGRUN";
}

function summariseSession(s) {
  if (!s) return null;

  const workout = s.workout || {};
  const blocks = asArray(workout.blocks);
  const steps = asArray(workout.steps);

  const title =
    s.title ||
    workout.title ||
    s.name ||
    s.sessionType ||
    s.type ||
    s.workoutKind ||
    "Run";

  const day = s.day || s.weekday || s.dateLabel || null;

  const kmPlanned = round1(plannedKmForSession(s));
  const kmExpanded = round1(expandedKmForSession(s));
  const kmBase = round1(safeNum(s?.distanceKm));

  const hard = isHardSession(s);
  const long = isLongSession(s);

  const details =
    workout.description ||
    s.description ||
    (blocks.length
      ? blocks
          .map((b) => {
            const kind = b.type || b.kind || "BLOCK";
            const d = b.distanceM
              ? `${Math.round(b.distanceM)}m`
              : b.distanceKm
              ? `${b.distanceKm}km`
              : b.durationSec
              ? `${Math.round(b.durationSec / 60)}min`
              : "";
            const reps = b.reps ? `x${b.reps}` : "";
            const pace = b.paceTarget || b.pace || b.intensity || b.target || "";
            return [kind, reps, d, pace].filter(Boolean).join(" ");
          })
          .filter(Boolean)
          .join(" | ")
      : steps.length
      ? `${steps.length} steps`
      : "");

  return {
    day,
    title,
    type: s.type || s.sessionType || s.workoutKind || null,
    kmPlanned,
    kmExpanded,
    kmBase,
    isHard: hard,
    isLong: long,
    details: details || null,

    workoutKind: s.workoutKind || workout.kind || null,
    intensity: s.intensity || workout.intensity || null,
    anchors: workout.anchors || s.anchors || null,
    repairNotes: asArray(s.repairNotes || workout.repairNotes),

    warmupMin: safeNum(s.warmupMin),
    cooldownMin: safeNum(s.cooldownMin),
    warmupKm: safeNum(s.warmupKm),
    cooldownKm: safeNum(s.cooldownKm),
  };
}

function summariseWeek(w) {
  const rawSessions = asArray(w?.sessions);
  const sessions = rawSessions.map(summariseSession).filter(Boolean);

  const weeklyTargetKm =
    safeNum(w?.targets?.weeklyKm) ??
    safeNum(w?.weeklyKm) ??
    safeNum(w?.targetWeeklyKm) ??
    null;

  const longRunTargetKm =
    safeNum(w?.targets?.longRunKm) ??
    safeNum(w?.longRunTargetKm) ??
    safeNum(w?.longRunKmTarget) ??
    safeNum(w?.targetLongRunKm) ??
    null;

  const weeklyPlannedKm = round1(
    rawSessions.reduce((sum, s) => sum + plannedKmForSession(s), 0)
  );

  const weeklyExpandedKm = round1(
    rawSessions.reduce((sum, s) => sum + expandedKmForSession(s), 0)
  );

  const weeklyPlannedDriftKm =
    weeklyTargetKm != null && weeklyPlannedKm != null
      ? round1(weeklyPlannedKm - weeklyTargetKm)
      : null;

  const hardCount = sessions.filter((s) => s.isHard).length;
  const longCount = sessions.filter((s) => s.isLong).length;

  const byDay = {};
  for (const d of ORDER) byDay[d] = [];
  for (const s of sessions) {
    const d = s.day;
    if (d && byDay[d]) byDay[d].push(s);
  }

  return {
    weekIndex: safeNum(w?.weekIndex) ?? safeNum(w?.index) ?? null,
    weeklyTargetKm,
    weeklyPlannedKm,
    weeklyExpandedKm,
    weeklyPlannedDriftKm,
    longRunTargetKm,
    hardCount,
    longCount,
    sessions,
    byDay,
  };
}

function buildPlanSummary(plan) {
  const weeks = asArray(plan?.weeks);
  return {
    weeksCount: weeks.length,
    weeks: weeks.map(summariseWeek),
  };
}

function detectPlanIssues(plan, runDays, longRunDay) {
  const issues = [];
  const weeks = asArray(plan?.weeks);
  const runDaySet = new Set(asArray(runDays));

  weeks.forEach((w, wi) => {
    const sessions = asArray(w?.sessions);

    const bad = sessions.filter((s) => s?.day && !runDaySet.has(s.day));
    if (bad.length) {
      issues.push({
        week: wi + 1,
        type: "NON_RUN_DAY_SESSIONS",
        message: `Found ${bad.length} session(s) on non-run days`,
        days: uniq(bad.map((s) => s.day)).sort(),
      });
    }

    if (longRunDay) {
      const hasLR = sessions.some((s) => {
        const t = getKindUpper(s);
        return (
          s?.day === longRunDay &&
          (Boolean(s?.isLong) || t === "LONG" || t === "LONGRUN")
        );
      });

      if (!hasLR) {
        issues.push({
          week: wi + 1,
          type: "MISSING_LONG_RUN",
          message: `No long run detected on ${longRunDay}`,
        });
      }
    }

    const days = asArray(w?.days);
    if (days.length) {
      const daySessionCount = days.reduce(
        (acc, d) => acc + asArray(d?.sessions).length,
        0
      );
      if (daySessionCount !== sessions.length) {
        issues.push({
          week: wi + 1,
          type: "DAYS_SESSIONS_MISMATCH",
          message: `week.days sessions (${daySessionCount}) != week.sessions (${sessions.length})`,
        });
      }
    }

    const weeklyTargetKm = safeNum(w?.targets?.weeklyKm);
    if (weeklyTargetKm != null) {
      const planned = round1(
        sessions.reduce((sum, s) => sum + plannedKmForSession(s), 0)
      );
      const drift = planned != null ? round1(planned - weeklyTargetKm) : null;
      if (drift != null && Math.abs(drift) >= 0.2) {
        issues.push({
          week: wi + 1,
          type: "WEEKLY_KM_DRIFT",
          message: `Planned weekly total (${planned}km) differs from target (${weeklyTargetKm}km) by ${drift}km`,
          plannedKm: planned,
          targetKm: weeklyTargetKm,
          driftKm: drift,
        });
      }
    }
  });

  return issues;
}

/* -------------------- route -------------------- */

/**
 * Mount like:
 *   app.use("/run-plan", runPlanRouter)
 *
 * Endpoint:
 *   POST /run-plan?debug=1
 */
router.post("/", (req, res) => {
  const debug = String(req.query?.debug || "") === "1";

  try {
    const { athleteProfile } = req.body || {};
    if (!athleteProfile) {
      return res.status(400).json({ error: "Missing athleteProfile" });
    }

    const availability = athleteProfile.availability || {};

    const runDays =
      availability.runDays ??
      availability.availableDays ??
      availability.daysAvailable ??
      availability.selectedDays ??
      athleteProfile.runDays ??
      athleteProfile.availableDays ??
      [];

    const longRunDay =
      availability.longRunDay ?? athleteProfile.longRunDay ?? "Sun";

    const planLengthWeeks =
      pickFirst(athleteProfile, ["planLengthWeeks"]) ??
      pickFirst(athleteProfile?.goal, ["planLengthWeeks"]);

    const normalisedAthleteProfile = {
      ...athleteProfile,
      availability: {
        ...availability,
        longRunDay,
        runDays: Array.isArray(runDays) ? runDays : [],
      },
      goal: {
        ...athleteProfile.goal,
        planLengthWeeks,
      },
    };

    if (debug) {
      console.log("[run-plan] input", {
        sessionsPerWeek: normalisedAthleteProfile?.availability?.sessionsPerWeek ?? null,
        longRunDay: normalisedAthleteProfile?.availability?.longRunDay ?? null,
        runDays: normalisedAthleteProfile?.availability?.runDays ?? [],
        difficulty: normalisedAthleteProfile?.difficulty ?? null,
        planLengthWeeks: normalisedAthleteProfile?.goal?.planLengthWeeks ?? null,
        recentTimes: normalisedAthleteProfile?.current?.recentTimes ?? null,
        targetTime: normalisedAthleteProfile?.goal?.targetTime ?? null,
      });
    }

    // Shared core planner: same pipeline as /generate-run.
    const plan = applyRunPlanRules(null, normalisedAthleteProfile);

    const firstWeek = plan?.weeks?.[0];

    if (debug) {
      console.log("[run-plan] debugVersion=v11", {
        weeksCount: Array.isArray(plan?.weeks) ? plan.weeks.length : 0,
        hasWeeks: Array.isArray(plan?.weeks),
        hasSessions: Array.isArray(firstWeek?.sessions),
        sessionsCount: firstWeek?.sessions?.length || 0,
        hasDays: Array.isArray(firstWeek?.days),
        daysCount: firstWeek?.days?.length || 0,
        firstWeekSessionDays: Array.isArray(firstWeek?.sessions)
          ? [...new Set(firstWeek.sessions.map((s) => s.day))].sort()
          : [],
      });
    }

    const issues = detectPlanIssues(
      plan,
      normalisedAthleteProfile?.availability?.runDays,
      normalisedAthleteProfile?.availability?.longRunDay
    );

    const summary = buildPlanSummary(plan);

    return res.json({
      plan: { ...plan, debugVersion: "v11" },
      issues,
      summary: debug ? summary : undefined,
    });
  } catch (e) {
    console.error("[run-plan] error:", e);
    return res
      .status(500)
      .json({ error: e?.message || "Failed to build plan" });
  }
});

export default router;
