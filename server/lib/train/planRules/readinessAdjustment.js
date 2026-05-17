const LEVELS = ["high", "normal", "moderate", "low", "very_low"];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sessionType(session = {}) {
  return String(session.type || session.workoutKind || session.sessionType || "").trim().toUpperCase();
}

function isHard(session = {}) {
  return ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE", "QUALITY"].includes(sessionType(session));
}

function isRace(session = {}) {
  return sessionType(session) === "RACE";
}

function isCompleted(session = {}) {
  const status = String(session.status || session.completionStatus || "").toLowerCase();
  return Boolean(status === "completed" || session.completedAt || session.actual || session.completed === true);
}

function isTaperWeek(week = {}) {
  return String(week.phase || week?.targets?.phase || "").trim().toUpperCase() === "TAPER";
}

function plannedKm(session = {}) {
  return toNum(session.plannedDistanceKm) ?? toNum(session.distanceKm) ?? toNum(session.distance) ?? 0;
}

function setSessionKm(session, km) {
  const nextKm = round1(Math.max(0, km));
  session.plannedDistanceKm = nextKm;
  session.distanceKm = nextKm;
  session.distance = nextKm;
  session.distanceMeters = Math.round(nextKm * 1000);
  session.budgetedDistanceKm = nextKm;
  session.budgetedComputedKm = nextKm;
  if (session.workout && typeof session.workout === "object") {
    session.workout.estimatedDistanceMeters = Math.round(nextKm * 1000);
    session.workout.budgetedEstimatedDistanceMeters = Math.round(nextKm * 1000);
    session.workout.meta = {
      ...(session.workout.meta || {}),
      readinessAdjustedSessionKm: nextKm,
    };
  }
}

function recomputeWeekMetrics(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const total = round1(sessions.reduce((sum, s) => sum + plannedKm(s), 0));
  const qualityKm = round1(sessions.reduce((sum, s) => sum + (isHard(s) ? plannedKm(s) : 0), 0));
  const longRunKm = round1(sessions.reduce((sum, s) => sum + (["LONG", "LONGRUN"].includes(sessionType(s)) ? plannedKm(s) : 0), 0));
  const targetWeeklyKm = toNum(week?.metrics?.targetWeeklyKm) ?? toNum(week?.targets?.weeklyKm) ?? total;
  week.metrics = {
    ...(week.metrics || {}),
    plannedWeeklyKm: total,
    computedWeeklyKm: total,
    renderedWeeklyKm: total,
    displayWeeklyKm: total,
    qualityKm,
    longRunKm,
    qualitySharePct: total > 0 ? round1((qualityKm / total) * 100) : 0,
    displayQualitySharePct: total > 0 ? round1((qualityKm / total) * 100) : 0,
    longRunSharePct: total > 0 ? round1((longRunKm / total) * 100) : 0,
    displayLongRunSharePct: total > 0 ? round1((longRunKm / total) * 100) : 0,
    targetWeeklyKm,
    driftKm: round1(targetWeeklyKm - total),
    computedDriftKm: round1(targetWeeklyKm - total),
  };
}

function deriveReadinessLevel(readiness = {}) {
  if (!readiness || typeof readiness !== "object") return { level: "normal", score: null, reasons: ["no_readiness_input"] };
  const reasons = [];
  let score = toNum(readiness.score);
  if (score == null) {
    const components = [
      toNum(readiness.sleepScore),
      readiness.fatigue != null ? 100 - Math.max(0, Math.min(100, Number(readiness.fatigue))) : null,
      readiness.soreness != null ? 100 - Math.max(0, Math.min(100, Number(readiness.soreness))) : null,
    ].filter((x) => x != null);
    score = components.length ? Math.round(components.reduce((a, b) => a + b, 0) / components.length) : 75;
    reasons.push("derived_score");
  }

  if (readiness.illness || readiness.injuryPain) {
    reasons.push(readiness.illness ? "illness" : "injury_pain");
    return { level: "very_low", score, reasons };
  }

  if (toNum(readiness.restingHrTrend) != null && toNum(readiness.restingHrTrend) >= 8) {
    score -= 12;
    reasons.push("resting_hr_elevated");
  }
  if (toNum(readiness.hrvTrend) != null && toNum(readiness.hrvTrend) <= -12) {
    score -= 12;
    reasons.push("hrv_suppressed");
  }
  if (readiness.recentLoadSpike) {
    score -= 10;
    reasons.push("recent_load_spike");
  }
  if (toNum(readiness.fatigue) != null && toNum(readiness.fatigue) >= 75) {
    score -= 10;
    reasons.push("high_fatigue");
  }
  if (toNum(readiness.soreness) != null && toNum(readiness.soreness) >= 75) {
    score -= 10;
    reasons.push("high_soreness");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  if (finalScore >= 85) return { level: "high", score: finalScore, reasons };
  if (finalScore >= 70) return { level: "normal", score: finalScore, reasons };
  if (finalScore >= 55) return { level: "moderate", score: finalScore, reasons };
  if (finalScore >= 40) return { level: "low", score: finalScore, reasons };
  return { level: "very_low", score: finalScore, reasons };
}

function findNextAdjustableHardSession(plan) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  for (let wi = 0; wi < weeks.length; wi += 1) {
    const week = weeks[wi];
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    for (let si = 0; si < sessions.length; si += 1) {
      const session = sessions[si];
      if (isCompleted(session)) continue;
      if (isRace(session)) continue;
      if (!isHard(session)) continue;
      return { week, weekIndex: wi, session, sessionIndex: si };
    }
  }
  return null;
}

function sessionId(session = {}) {
  return String(session.sessionId || session.id || session.key || "").trim() || null;
}

function weekNumber(week = {}, index = 0) {
  return Number(week.weekIndex || week.weekNumber || index + 1) || index + 1;
}

function reduceQuality(found, changes, pct) {
  const { week, weekIndex, session } = found;
  const beforeKm = plannedKm(session);
  const afterKm = round1(beforeKm * (1 - pct));
  setSessionKm(session, afterKm);
  session.notes = `${session.notes || ""}${session.notes ? " " : ""}Readiness adjustment: reduced quality volume.`;
  session.meta = {
    ...(session.meta || {}),
    readinessAdjustment: { action: "reduce_quality_volume", reductionPct: round1(pct * 100) },
  };
  if (session.workout?.meta && typeof session.workout.meta === "object") {
    session.workout.meta.readinessAdjustment = session.meta.readinessAdjustment;
  }
  recomputeWeekMetrics(week);
  changes.push({
    type: "reduce_quality_volume",
    sessionId: sessionId(session),
    weekIndex: weekNumber(week, weekIndex),
    beforeKm,
    afterKm,
    reductionPct: round1(pct * 100),
  });
}

function convertToEasy(found, changes, { rest = false } = {}) {
  const { week, weekIndex, session } = found;
  const beforeType = sessionType(session);
  const beforeKm = plannedKm(session);
  if (rest) {
    session.status = "readiness_rest";
    session.type = "RECOVERY";
    session.sessionType = "RECOVERY";
    session.workoutKind = "RECOVERY";
    session.name = "Rest / recovery";
    session.keyTargets = "Rest, mobility, or short walk only";
    session.workout = { kind: "RECOVERY", steps: [], meta: { readinessAdjustment: { action: "replace_with_recovery" } } };
    setSessionKm(session, 0);
  } else {
    session.type = "EASY";
    session.sessionType = "EASY";
    session.workoutKind = "EASY";
    session.name = "Easy readiness run";
    session.keyTargets = "Comfortable pace only";
    session.workout = { kind: "EASY", estimatedDistanceMeters: Math.round(beforeKm * 0.65 * 1000), meta: { readinessAdjustment: { action: "replace_with_easy" } } };
    setSessionKm(session, beforeKm * 0.65);
  }
  session.notes = `${session.notes || ""}${session.notes ? " " : ""}Adjusted for low readiness.`;
  session.meta = {
    ...(session.meta || {}),
    readinessAdjustment: rest ? { action: "replace_with_recovery" } : { action: "replace_with_easy" },
  };
  recomputeWeekMetrics(week);
  changes.push({
    type: rest ? "replace_hard_with_recovery" : "replace_hard_with_easy",
    sessionId: sessionId(session),
    weekIndex: weekNumber(week, weekIndex),
    beforeType,
    afterType: sessionType(session),
    beforeKm,
    afterKm: plannedKm(session),
  });
}

export function applyReadinessAdjustment({
  plan,
  profile = null,
  readiness = null,
  goalRealism = null,
  currentDate = null,
} = {}) {
  const nextPlan = clone(plan && typeof plan === "object" ? plan : {});
  const readinessState = deriveReadinessLevel(readiness);
  const changes = [];
  const trace = [{
    step: "derive_readiness",
    level: readinessState.level,
    score: readinessState.score,
    reasons: readinessState.reasons,
    currentDate: currentDate || null,
    goalRealismLevel: goalRealism?.level || null,
  }];

  if (readinessState.level === "high" || readinessState.level === "normal") {
    const message = readinessState.level === "high"
      ? "Readiness is high; plan left unchanged."
      : "Readiness is normal; plan left unchanged.";
    trace.push({ step: "no_change", reason: "readiness_not_low" });
    return {
      plan: nextPlan,
      readinessAdjustment: {
        applied: false,
        level: readinessState.level,
        score: readinessState.score,
        message,
        changes,
      },
      readinessAdjustmentTrace: trace,
    };
  }

  const found = findNextAdjustableHardSession(nextPlan);
  if (!found) {
    trace.push({ step: "no_change", reason: "no_adjustable_hard_session" });
    return {
      plan: nextPlan,
      readinessAdjustment: {
        applied: false,
        level: readinessState.level,
        score: readinessState.score,
        message: "No upcoming adjustable hard session found.",
        changes,
      },
      readinessAdjustmentTrace: trace,
    };
  }

  const taper = isTaperWeek(found.week);
  if (readinessState.level === "moderate") {
    reduceQuality(found, changes, taper ? 0.1 : 0.15);
    trace.push({ step: "adjust", action: "reduce_quality_volume", taper });
  } else if (readinessState.level === "low") {
    if (taper) reduceQuality(found, changes, 0.2);
    else convertToEasy(found, changes, { rest: false });
    trace.push({ step: "adjust", action: taper ? "reduce_taper_quality" : "replace_hard_with_easy", taper });
  } else if (readinessState.level === "very_low") {
    convertToEasy(found, changes, { rest: true });
    trace.push({ step: "adjust", action: "replace_hard_with_recovery", taper });
  }

  const messageByLevel = {
    moderate: "Readiness is moderate; next quality session was reduced.",
    low: taper
      ? "Readiness is low in taper; quality was reduced conservatively."
      : "Readiness is low; next hard session was changed to easy.",
    very_low: "Readiness is very low; next hard session was changed to rest/recovery.",
  };

  return {
    plan: nextPlan,
    readinessAdjustment: {
      applied: changes.length > 0,
      level: readinessState.level,
      score: readinessState.score,
      message: messageByLevel[readinessState.level] || "Readiness adjustment applied.",
      changes,
    },
    readinessAdjustmentTrace: trace,
  };
}

export const READINESS_LEVELS = LEVELS;
