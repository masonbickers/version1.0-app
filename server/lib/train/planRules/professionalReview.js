const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const QUALITY_KINDS = new Set(["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE", "QUALITY"]);

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}

function goalKey(distance) {
  const s = String(distance || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (s === "5k" || s.includes("5k")) return "5k";
  if (s === "10k" || s.includes("10k")) return "10k";
  if (s.includes("half")) return "half";
  if (s.includes("marathon") && !s.includes("half")) return "marathon";
  if (s.includes("ultra")) return "ultra";
  if (s.includes("return")) return "return";
  if (s.includes("general")) return "general";
  return "other";
}

function kind(session) {
  return String(
    session?.workoutKind ||
      session?.type ||
      session?.sessionType ||
      session?.workout?.kind ||
      ""
  ).trim().toUpperCase();
}

function hasRaceSession(sessions) {
  return (Array.isArray(sessions) ? sessions : []).some((s) => kind(s) === "RACE");
}

function plannedKm(session) {
  return toNum(session?.plannedDistanceKm) ?? toNum(session?.distanceKm) ?? 0;
}

function weekNumber(week, index) {
  return Number(week?.weekNumber) || Number(week?.weekIndex) || index + 1;
}

function issue({ code, severity = "warning", week = null, message, evidence = null, recommendation = null }) {
  return {
    code,
    severity,
    ...(week != null ? { week } : {}),
    message,
    ...(evidence ? { evidence } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

function minimumRunsForGoal(goal) {
  if (goal === "5k" || goal === "10k") return 2;
  if (goal === "half") return 2;
  if (goal === "marathon") return 3;
  if (goal === "ultra") return 4;
  return 1;
}

function qualityCapForPhase(phase) {
  const p = String(phase || "").toLowerCase();
  if (p === "deload") return 26;
  if (p === "taper") return 28;
  if (p === "specific") return 31;
  return 31;
}

function hasWarmCool(session) {
  if (!QUALITY_KINDS.has(kind(session))) return true;
  const warm = toNum(session?.warmupMin);
  const cool = toNum(session?.cooldownMin);
  if (warm != null && warm > 0 && cool != null && cool > 0) return true;

  const steps = Array.isArray(session?.workout?.steps)
    ? session.workout.steps
    : Array.isArray(session?.steps)
    ? session.steps
    : [];
  const types = steps.map((s) => String(s?.stepType || "").toLowerCase());
  return types.includes("warmup") && types.includes("cooldown");
}

function hardDaySpacingIssues(sessions, wk) {
  const hardDays = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => QUALITY_KINDS.has(kind(s)))
    .map((s) => ORDER.indexOf(String(s?.day || "").trim()))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);

  const out = [];
  for (let i = 1; i < hardDays.length; i += 1) {
    if (hardDays[i] - hardDays[i - 1] <= 1) {
      out.push(issue({
        code: "HARD_DAYS_TOO_CLOSE",
        severity: "blocker",
        week: wk,
        message: "Hard run sessions are scheduled on adjacent days.",
        evidence: { days: [ORDER[hardDays[i - 1]], ORDER[hardDays[i]]] },
        recommendation: "Separate quality sessions with at least one easier day.",
      }));
    }
  }
  return out;
}

export function buildProfessionalPlanReview(plan, profile = {}) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const goal = goalKey(profile?.goalDistance || profile?.goal?.distance || plan?.goalDistance);
  const sessionsPerWeek = Math.round(
    toNum(profile?.sessionsPerWeek || profile?.availability?.sessionsPerWeek) || 0
  );
  const issues = [];
  const paceModel = profile?.paceModel && typeof profile.paceModel === "object" ? profile.paceModel : null;

  const minRuns = minimumRunsForGoal(goal);
  if (sessionsPerWeek > 0 && sessionsPerWeek < minRuns) {
    issues.push(issue({
      code: "INSUFFICIENT_RUN_FREQUENCY_FOR_GOAL",
      severity: "blocker",
      message: `This goal needs at least ${minRuns} run days per week for a professionally defensible plan.`,
      evidence: { goal, sessionsPerWeek, minimumRecommendedRunsPerWeek: minRuns },
      recommendation: "Increase run frequency or choose a shorter/lower-risk goal.",
    }));
  }

  if (paceModel) {
    const confidence = toNum(paceModel.confidence);
    if (confidence != null && confidence < 50) {
      issues.push(issue({
        code: "LOW_PACE_MODEL_CONFIDENCE",
        severity: "warning",
        message: "Pace targets are low confidence and should be treated as broad effort ranges.",
        evidence: { confidence, targetMode: paceModel?.adjustments?.targetMode || null },
        recommendation: "Use recent race, threshold, or completed session data to recalibrate paces.",
      }));
    }
    if (paceModel?.adjustments?.preferEffortTargets === true) {
      issues.push(issue({
        code: "PACE_MODEL_EFFORT_MODE",
        severity: "warning",
        message: "The pace model prefers effort/HR targets for this context.",
        evidence: { terrainMode: paceModel?.adjustments?.terrainMode || null, targetMode: paceModel?.adjustments?.targetMode || null },
      }));
    }
  }

  if (!weeks.length) {
    issues.push(issue({
      code: "EMPTY_PLAN",
      severity: "blocker",
      message: "No training weeks were generated.",
      recommendation: "Regenerate after completing the required profile inputs.",
    }));
  }

  weeks.forEach((week, index) => {
    const wk = weekNumber(week, index);
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    const isRaceWeek = hasRaceSession(sessions);
    const phase = String(week?.phase || week?.targets?.phase || "").toLowerCase();
    const weeklyKm = toNum(week?.metrics?.plannedWeeklyKm) ?? round1(sessions.reduce((sum, s) => sum + plannedKm(s), 0));
    const targetKm = toNum(week?.targets?.weeklyKm);
    const qualityShare = toNum(week?.metrics?.qualitySharePct);
    const longShare = toNum(week?.metrics?.longRunSharePct);
    const longSessions = sessions.filter((s) => kind(s) === "LONG" || kind(s) === "LONGRUN");

    if (!sessions.length) {
      issues.push(issue({
        code: "WEEK_WITHOUT_SESSIONS",
        severity: "blocker",
        week: wk,
        message: "A training week has no run sessions.",
      }));
    }

    if (sessionsPerWeek > 0 && sessions.length < sessionsPerWeek) {
      issues.push(issue({
        code: "SESSION_COUNT_BELOW_REQUEST",
        severity: "warning",
        week: wk,
        message: "Generated sessions are fewer than the requested run frequency.",
        evidence: { sessions: sessions.length, sessionsPerWeek },
      }));
    }

    if (sessionsPerWeek >= 2 && longSessions.length !== 1 && !hasRaceSession(sessions)) {
      issues.push(issue({
        code: "LONG_RUN_COUNT_INVALID",
        severity: "blocker",
        week: wk,
        message: "Each normal training week should have exactly one long run.",
        evidence: { longRunCount: longSessions.length },
      }));
    }

    if (!isRaceWeek && targetKm != null && Math.abs(weeklyKm - targetKm) > 0.6) {
      issues.push(issue({
        code: "WEEKLY_DISTANCE_DRIFT",
        severity: "warning",
        week: wk,
        message: "Planned weekly distance drifts from the progression target.",
        evidence: { plannedWeeklyKm: weeklyKm, targetWeeklyKm: targetKm, driftKm: round1(weeklyKm - targetKm) },
      }));
    }

    if (qualityShare != null && qualityShare > qualityCapForPhase(phase) + 0.5) {
      issues.push(issue({
        code: "QUALITY_SHARE_TOO_HIGH",
        severity: phase === "taper" || phase === "deload" ? "blocker" : "warning",
        week: wk,
        message: "Quality work is too large a share of the week.",
        evidence: { phase, qualitySharePct: qualityShare, capPct: qualityCapForPhase(phase) },
        recommendation: "Reduce hard-session distance and move volume to easy running.",
      }));
    }

    if (!isRaceWeek && longShare != null && (longShare < 18 || longShare > 42)) {
      issues.push(issue({
        code: "LONG_RUN_SHARE_OUT_OF_RANGE",
        severity: "warning",
        week: wk,
        message: "Long-run share is outside the normal coaching range.",
        evidence: { longRunSharePct: longShare },
      }));
    }

    for (const session of sessions) {
      if (!hasWarmCool(session)) {
        issues.push(issue({
          code: "QUALITY_SESSION_MISSING_WARM_COOL",
          severity: "blocker",
          week: wk,
          message: "A quality session is missing a warmup or cooldown.",
          evidence: { day: session?.day || null, type: kind(session) },
        }));
      }
    }

    issues.push(...hardDaySpacingIssues(sessions, wk));
  });

  for (let i = 1; i < weeks.length; i += 1) {
    const prev = toNum(weeks[i - 1]?.metrics?.plannedWeeklyKm);
    const cur = toNum(weeks[i]?.metrics?.plannedWeeklyKm);
    if (prev == null || cur == null || prev <= 0 || cur <= 0) continue;
    const phase = String(weeks[i]?.phase || "").toLowerCase();
    const deltaPct = round1(((cur - prev) / prev) * 100);

    if (!["deload", "taper"].includes(phase) && deltaPct > 15) {
      issues.push(issue({
        code: "WEEKLY_RAMP_TOO_STEEP",
        severity: deltaPct > 20 ? "blocker" : "warning",
        week: weekNumber(weeks[i], i),
        message: "Weekly volume increases faster than a conservative coaching ramp.",
        evidence: { previousWeeklyKm: prev, currentWeeklyKm: cur, deltaPct },
      }));
    }

    if ((phase === "deload" || phase === "taper") && deltaPct > -3) {
      issues.push(issue({
        code: "RECOVERY_WEEK_NOT_LIGHTER",
        severity: "warning",
        week: weekNumber(weeks[i], i),
        message: "A deload or taper week is not meaningfully lighter than the previous week.",
        evidence: { phase, previousWeeklyKm: prev, currentWeeklyKm: cur, deltaPct },
      }));
    }
  }

  const blockers = issues.filter((x) => x.severity === "blocker");
  const warnings = issues.filter((x) => x.severity === "warning");
  const status = blockers.length ? "not_approved" : warnings.length ? "approved_with_caveats" : "approved";

  return {
    status,
    label:
      status === "approved"
        ? "Plan approved"
        : status === "approved_with_caveats"
        ? "Plan approved with caveats"
        : "Not professionally approved",
    summary:
      status === "approved"
        ? "The plan passes load, spacing, intensity, and workout-structure checks."
        : status === "approved_with_caveats"
        ? "The plan is usable, but the caveats should be reviewed before training."
        : "The plan should not be used as-is because one or more coaching guardrails failed.",
    reviewedBy: "trainr_rules_engine",
    standardVersion: "professional-run-plan-v1",
    blockers: blockers.length,
    warnings: warnings.length,
    issues,
    standards: {
      minimumRunsForGoal: minRuns,
      maxBuildRampPct: 15,
      maxQualitySharePct: { build: 31, deload: 26, taper: 28 },
      longRunSharePctRange: [18, 42],
      hardDayMinimumGapDays: 1,
      qualitySessionsRequireWarmupCooldown: true,
    },
  };
}
