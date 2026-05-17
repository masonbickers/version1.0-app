const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_ALIASES = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

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

function normalizeDay(day) {
  const raw = String(day || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (DAY_ALIASES[upper]) return DAY_ALIASES[upper];
  const title = raw.slice(0, 3);
  const normalized = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  return DAY_ORDER.includes(normalized) ? normalized : null;
}

function normalizeDaySet(days) {
  return new Set((Array.isArray(days) ? days : []).map(normalizeDay).filter(Boolean));
}

function dayIndex(day) {
  return DAY_ORDER.indexOf(normalizeDay(day));
}

function prevDay(day) {
  const idx = dayIndex(day);
  return idx > 0 ? DAY_ORDER[idx - 1] : null;
}

function nextDay(day) {
  const idx = dayIndex(day);
  return idx >= 0 && idx < DAY_ORDER.length - 1 ? DAY_ORDER[idx + 1] : null;
}

function sessionType(session = {}) {
  return String(session.type || session.workoutKind || session.sessionType || "").trim().toUpperCase();
}

function isQuality(session = {}) {
  return ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE", "QUALITY"].includes(sessionType(session));
}

function isIntervals(session = {}) {
  return sessionType(session) === "INTERVALS" || sessionType(session) === "HILLS";
}

function isLong(session = {}) {
  return sessionType(session) === "LONG" || sessionType(session) === "LONGRUN";
}

function isEasy(session = {}) {
  return sessionType(session) === "EASY" || sessionType(session) === "RECOVERY";
}

function isRace(session = {}) {
  return sessionType(session) === "RACE";
}

function isCompleted(session = {}) {
  const status = String(session.status || session.completionStatus || "").toLowerCase();
  return Boolean(status === "completed" || session.completedAt || session.actual || session.completed === true);
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
      strengthAdjustedSessionKm: nextKm,
    };
  }
}

function sessionId(session = {}) {
  return String(session.sessionId || session.id || session.key || "").trim() || null;
}

function weekNumber(week = {}, index = 0) {
  return Number(week.weekIndex || week.weekNumber || index + 1) || index + 1;
}

function recomputeWeekMetrics(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const total = round1(sessions.reduce((sum, s) => sum + plannedKm(s), 0));
  const qualityKm = round1(sessions.reduce((sum, s) => sum + (isQuality(s) ? plannedKm(s) : 0), 0));
  const longRunKm = round1(sessions.reduce((sum, s) => sum + (isLong(s) ? plannedKm(s) : 0), 0));
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

function runnerLevel(profile = {}) {
  const exp = String(profile?.current?.experience || profile?.experience || "").toLowerCase();
  const diff = String(profile?.preferences?.difficulty || profile?.difficulty || "").toLowerCase();
  if (exp.includes("advanced") || diff === "hard" || diff === "aggressive") return "advanced";
  if (exp.includes("new")) return "beginner";
  return "intermediate";
}

function sessionsOnDay(week, day) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).filter((s) => normalizeDay(s.day) === normalizeDay(day));
}

function hasHardNear(week, day) {
  const idx = dayIndex(day);
  return (Array.isArray(week?.sessions) ? week.sessions : []).some((s) => {
    if (!isQuality(s) && !isLong(s)) return false;
    const sIdx = dayIndex(s.day);
    return sIdx >= 0 && Math.abs(sIdx - idx) <= 1;
  });
}

function findMoveDay(week, session, blockedDays) {
  const currentIdx = dayIndex(session.day);
  const candidates = [1, -1, 2, -2]
    .map((offset) => DAY_ORDER[currentIdx + offset])
    .filter(Boolean);
  for (const day of candidates) {
    if (blockedDays.has(day)) continue;
    if (sessionsOnDay(week, day).length) continue;
    if (hasHardNear(week, day)) continue;
    return day;
  }
  return null;
}

function reduceRun(session, changes, week, weekIndex, reason, factor = 0.75) {
  const beforeKm = plannedKm(session);
  setSessionKm(session, beforeKm * factor);
  session.notes = `${session.notes || ""}${session.notes ? " " : ""}Adjusted around strength training.`;
  session.meta = {
    ...(session.meta || {}),
    strengthAdjustment: { action: "reduce_run", reason },
  };
  if (session.workout?.meta && typeof session.workout.meta === "object") {
    session.workout.meta.strengthAdjustment = session.meta.strengthAdjustment;
  }
  recomputeWeekMetrics(week);
  changes.push({
    type: "reduce_run",
    reason,
    sessionId: sessionId(session),
    weekIndex: weekNumber(week, weekIndex),
    beforeKm,
    afterKm: plannedKm(session),
  });
}

function moveRun(session, changes, week, weekIndex, toDay, reason) {
  const fromDay = session.day;
  session.day = toDay;
  session.meta = {
    ...(session.meta || {}),
    strengthAdjustment: { action: "move_run", reason, fromDay, toDay },
  };
  if (session.workout?.meta && typeof session.workout.meta === "object") {
    session.workout.meta.strengthAdjustment = session.meta.strengthAdjustment;
  }
  changes.push({
    type: "move_run",
    reason,
    sessionId: sessionId(session),
    weekIndex: weekNumber(week, weekIndex),
    fromDay,
    toDay,
  });
}

function conflictForSession(session, week, strength, level) {
  const day = normalizeDay(session.day);
  if (!day || isCompleted(session) || isRace(session) || isEasy(session)) return null;
  const heavy = strength.heavyLowerBodyDays;
  const hyrox = strength.hyroxDays;
  const previous = prevDay(day);
  const following = nextDay(day);

  if (isIntervals(session) && previous && heavy.has(previous)) {
    return { code: "INTERVALS_AFTER_HEAVY_LOWER", severity: "high", blockedDays: new Set([previous, day]) };
  }
  if (isLong(session) && previous && heavy.has(previous)) {
    return { code: "LONG_AFTER_HEAVY_LOWER", severity: "high", blockedDays: new Set([previous, day]) };
  }
  if (isLong(session) && day && heavy.has(previous || "")) {
    return { code: "LONG_AFTER_HEAVY_LOWER", severity: "high", blockedDays: new Set([previous, day].filter(Boolean)) };
  }
  if (isLong(session) && following && heavy.has(following)) {
    return { code: "HEAVY_LOWER_BEFORE_LONG_RUN", severity: "medium", blockedDays: new Set([day, following]) };
  }
  if (isQuality(session) && hyrox.has(day) && level !== "advanced") {
    return { code: "HARD_RUN_HYROX_SAME_DAY", severity: "high", blockedDays: new Set([day]) };
  }
  if (isQuality(session) && hyrox.has(day) && level === "advanced") {
    return { code: "CONTROLLED_ADVANCED_HYBRID_DOUBLE", severity: "trace", blockedDays: new Set() };
  }
  return null;
}

function normalizeStrength(strengthTraining = {}) {
  return {
    enabled: strengthTraining?.enabled === true,
    sessionsPerWeek: Math.max(0, Math.round(toNum(strengthTraining?.sessionsPerWeek) || 0)),
    days: normalizeDaySet(strengthTraining?.days),
    lowerBodyDays: normalizeDaySet(strengthTraining?.lowerBodyDays),
    heavyLowerBodyDays: normalizeDaySet(strengthTraining?.heavyLowerBodyDays),
    hyroxDays: normalizeDaySet(strengthTraining?.hyroxDays),
    priority: ["running", "strength", "hybrid"].includes(String(strengthTraining?.priority || "").toLowerCase())
      ? String(strengthTraining.priority).toLowerCase()
      : "hybrid",
  };
}

export function applyStrengthTrainingAwareness({
  plan,
  profile = null,
  strengthTraining = null,
  currentDate = null,
  goalRealism = null,
} = {}) {
  const nextPlan = clone(plan && typeof plan === "object" ? plan : {});
  const strength = normalizeStrength(strengthTraining || {});
  const changes = [];
  const trace = [{
    step: "read_strength_input",
    enabled: strength.enabled,
    sessionsPerWeek: strength.sessionsPerWeek,
    priority: strength.priority,
    currentDate: currentDate || null,
    goalRealismLevel: goalRealism?.level || null,
  }];

  if (!strength.enabled || strength.sessionsPerWeek <= 0) {
    return {
      plan: nextPlan,
      strengthAdjustment: { applied: false, conflictsFound: 0, changes },
      strengthAdjustmentTrace: [...trace, { step: "no_change", reason: "strength_training_not_enabled" }],
    };
  }

  const level = runnerLevel(profile);
  let conflictsFound = 0;
  const weeks = Array.isArray(nextPlan?.weeks) ? nextPlan.weeks : [];

  for (let wi = 0; wi < weeks.length; wi += 1) {
    const week = weeks[wi];
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    for (const session of sessions) {
      const conflict = conflictForSession(session, week, strength, level);
      if (!conflict) continue;
      trace.push({
        step: "conflict_detected",
        conflict: conflict.code,
        sessionId: sessionId(session),
        day: session.day,
        sessionType: sessionType(session),
        runnerLevel: level,
      });
      if (conflict.severity === "trace") continue;
      conflictsFound += 1;

      if (strength.priority === "running") {
        reduceRun(session, changes, week, wi, conflict.code, 0.9);
        trace.push({ step: "adjust", action: "reduce_run_running_priority", conflict: conflict.code });
        continue;
      }

      const blockedDays = new Set([...strength.heavyLowerBodyDays, ...strength.hyroxDays, ...conflict.blockedDays]);
      const moveDay = strength.priority !== "strength" ? findMoveDay(week, session, blockedDays) : null;
      if (moveDay) {
        moveRun(session, changes, week, wi, moveDay, conflict.code);
        trace.push({ step: "adjust", action: "move_run", conflict: conflict.code, toDay: moveDay });
      } else {
        reduceRun(session, changes, week, wi, conflict.code, strength.priority === "strength" ? 0.65 : 0.75);
        trace.push({ step: "adjust", action: "reduce_run", conflict: conflict.code });
      }
    }
  }

  return {
    plan: nextPlan,
    strengthAdjustment: {
      applied: changes.length > 0,
      conflictsFound,
      changes,
    },
    strengthAdjustmentTrace: trace,
  };
}
