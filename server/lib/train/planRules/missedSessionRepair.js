const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function dayIndex(day) {
  return DAY_ORDER.indexOf(String(day || "").trim());
}

function sessionType(session = {}) {
  return String(session.type || session.workoutKind || session.sessionType || "").trim().toUpperCase();
}

function isEasy(session) {
  const type = sessionType(session);
  return type === "EASY" || type === "RECOVERY";
}

function isLong(session) {
  const type = sessionType(session);
  return type === "LONG" || type === "LONGRUN";
}

function isHard(session) {
  const type = sessionType(session);
  return ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE", "QUALITY"].includes(type);
}

function isRaceSpecific(session = {}, week = {}) {
  const phase = String(week?.phase || week?.targets?.phase || "").toUpperCase();
  const text = `${session?.name || ""} ${session?.keyTargets || ""} ${session?.notes || ""}`.toLowerCase();
  return phase === "SPECIFIC" || phase === "TAPER" || text.includes("race");
}

function sessionId(session = {}) {
  return String(session.sessionId || session.id || session.key || "").trim();
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
      budgetedSessionKm: nextKm,
    };
  }
}

function weekNumber(week, index) {
  return Number(week?.weekIndex || week?.weekNumber || index + 1) || index + 1;
}

function recomputeWeekMetrics(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const total = round1(sessions.reduce((sum, s) => sum + plannedKm(s), 0));
  const qualityKm = round1(sessions.reduce((sum, s) => sum + (isHard(s) ? plannedKm(s) : 0), 0));
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
  return week;
}

function normalizeMissedSessions({ missedSession, missedSessionIds, completedSessions }) {
  const out = [];
  if (missedSession) out.push(typeof missedSession === "string" ? { sessionId: missedSession } : missedSession);
  if (Array.isArray(missedSessionIds)) {
    for (const id of missedSessionIds) out.push({ sessionId: id });
  }
  if (Array.isArray(completedSessions)) {
    for (const row of completedSessions) {
      const status = String(row?.status || "").toLowerCase();
      if (status === "skipped" || status === "missed" || row?.skippedAt) out.push(row);
    }
  }
  const seen = new Set();
  return out.filter((item) => {
    const key = String(item?.sessionId || item?.id || item?.key || item?.sessionKey || `${item?.weekIndex || ""}:${item?.day || ""}:${item?.type || ""}`).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findSession(plan, missed) {
  const wantedId = String(missed?.sessionId || missed?.id || missed?.key || missed?.sessionKey || "").trim();
  const wantedWeek = toNum(missed?.weekIndex ?? missed?.weekNumber);
  const wantedDay = String(missed?.day || "").trim();
  const wantedType = String(missed?.type || missed?.workoutKind || missed?.sessionType || "").trim().toUpperCase();
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];

  for (let wi = 0; wi < weeks.length; wi += 1) {
    const week = weeks[wi];
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    for (let si = 0; si < sessions.length; si += 1) {
      const s = sessions[si];
      const id = sessionId(s);
      const weekMatches = wantedWeek == null || weekNumber(week, wi) === wantedWeek;
      const dayMatches = !wantedDay || String(s?.day || "").trim() === wantedDay;
      const typeMatches = !wantedType || sessionType(s) === wantedType;
      if ((wantedId && id === wantedId) || (!wantedId && weekMatches && dayMatches && typeMatches)) {
        return { week, weekIndex: wi, session: s, sessionIndex: si };
      }
    }
  }
  return null;
}

function sessionsOnDay(week, day) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).filter((s) => String(s?.day || "").trim() === day);
}

function hardNearDay(week, targetDay) {
  const idx = dayIndex(targetDay);
  return (Array.isArray(week?.sessions) ? week.sessions : []).some((s) => {
    if (!isHard(s) && !isLong(s)) return false;
    const sIdx = dayIndex(s.day);
    return sIdx >= 0 && Math.abs(sIdx - idx) <= 1;
  });
}

function longRunPreviousDay(week, targetDay) {
  const idx = dayIndex(targetDay);
  return (Array.isArray(week?.sessions) ? week.sessions : []).some((s) => isLong(s) && dayIndex(s.day) === idx - 1);
}

function findSafeMoveDay(week, missedDay, session) {
  const start = dayIndex(missedDay);
  if (start < 0) return null;
  for (let offset = 1; offset <= 2; offset += 1) {
    const candidate = DAY_ORDER[start + offset];
    if (!candidate) continue;
    if (sessionsOnDay(week, candidate).length) continue;
    if (hardNearDay(week, candidate)) continue;
    if (sessionType(session) === "INTERVALS" && longRunPreviousDay(week, candidate)) continue;
    return candidate;
  }
  return null;
}

function markSkipped(session, reason) {
  session.status = "skipped";
  session.adaptation = {
    ...(session.adaptation || {}),
    missedSessionRepair: reason,
  };
  session.meta = {
    ...(session.meta || {}),
    missedSessionRepair: reason,
  };
}

function reduceNextLongRun(plan, fromWeekIndex, changes, reason) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  for (let wi = fromWeekIndex + 1; wi < weeks.length; wi += 1) {
    const long = (weeks[wi].sessions || []).find(isLong);
    if (!long) continue;
    const before = plannedKm(long);
    const after = round1(before * 0.85);
    setSessionKm(long, after);
    long.notes = `${long.notes || ""}${long.notes ? " " : ""}Reduced after missed long run.`;
    long.meta = {
      ...(long.meta || {}),
      missedSessionRepair: { action: "reduced_next_long_run", reason },
    };
    recomputeWeekMetrics(weeks[wi]);
    changes.push({
      type: "reduce_next_long_run",
      sessionId: sessionId(long) || null,
      weekIndex: weekNumber(weeks[wi], wi),
      beforeKm: before,
      afterKm: after,
    });
    return true;
  }
  return false;
}

function convertNextWeekToRecovery(plan, fromWeekIndex, changes) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const week = weeks[fromWeekIndex + 1];
  if (!week) return false;
  const sessions = Array.isArray(week.sessions) ? week.sessions : [];
  week.phase = "RECOVERY";
  week.repairPhase = "REBUILD";
  for (const s of sessions) {
    const beforeType = sessionType(s);
    const beforeKm = plannedKm(s);
    if (isHard(s)) {
      s.type = "EASY";
      s.sessionType = "EASY";
      s.workoutKind = "EASY";
      s.name = "Easy rebuild run";
      s.keyTargets = "Comfortable pace";
      s.workout = {
        kind: "EASY",
        estimatedDistanceMeters: Math.round(beforeKm * 0.8 * 1000),
        meta: {
          ...(s.workout?.meta || {}),
          missedSessionRepair: { action: "converted_quality_to_easy_rebuild" },
        },
      };
    }
    setSessionKm(s, beforeKm * 0.8);
    changes.push({
      type: "recovery_week_adjust_session",
      sessionId: sessionId(s) || null,
      weekIndex: weekNumber(week, fromWeekIndex + 1),
      beforeType,
      afterType: sessionType(s),
      beforeKm,
      afterKm: plannedKm(s),
    });
  }
  recomputeWeekMetrics(week);
  return true;
}

function applySingleMissedRepair({ plan, found, changes }) {
  const { week, weekIndex, session } = found;
  const type = sessionType(session);
  const missedId = sessionId(session) || null;
  const phase = String(week?.phase || "").toUpperCase();

  if (isEasy(session)) {
    markSkipped(session, { decision: "skip", reason: "easy_or_recovery_runs_are_not_made_up" });
    changes.push({ type: "skip_session", sessionId: missedId, sessionType: type });
    return {
      repairType: "skip_easy",
      decision: "skipped",
      reason: "Missed easy/recovery run skipped; no catch-up volume added.",
    };
  }

  if (isLong(session)) {
    markSkipped(session, { decision: "reduce_next_long_run", reason: "missed_long_run" });
    const reduced = reduceNextLongRun(plan, weekIndex, changes, "missed_long_run");
    changes.push({ type: "mark_missed_long_skipped", sessionId: missedId });
    return {
      repairType: reduced ? "reduce_next_long_run" : "skip_long",
      decision: reduced ? "reduced_next_long_run" : "skipped",
      reason: reduced
        ? "Missed long run skipped and next long run reduced; no catch-up volume added."
        : "Missed long run skipped; no future long run available to reduce.",
    };
  }

  if (isHard(session)) {
    if (phase === "TAPER" || isRaceSpecific(session, week)) {
      markSkipped(session, { decision: "safe_sharpener_only", reason: "missed_race_specific_or_taper_session" });
      session.type = "EASY";
      session.sessionType = "EASY";
      session.workoutKind = "EASY";
      session.name = "Easy sharpener";
      setSessionKm(session, plannedKm(session) * 0.55);
      changes.push({ type: "replace_with_safe_sharpener", sessionId: missedId, weekIndex: weekNumber(week, weekIndex) });
      recomputeWeekMetrics(week);
      return {
        repairType: "safe_sharpener",
        decision: "replaced_with_safe_sharpener",
        reason: "Missed taper/race-specific session replaced with safer sharpener, not full catch-up.",
      };
    }

    const moveDay = findSafeMoveDay(week, session.day, session);
    if (moveDay) {
      const fromDay = session.day;
      session.day = moveDay;
      session.meta = {
        ...(session.meta || {}),
        missedSessionRepair: { decision: "moved_quality", fromDay, toDay: moveDay },
      };
      changes.push({ type: "move_quality_session", sessionId: missedId, fromDay, toDay: moveDay, weekIndex: weekNumber(week, weekIndex) });
      return {
        repairType: "move_quality",
        decision: "moved",
        reason: "Missed quality run moved within 48h because spacing rules were safe.",
      };
    }

    markSkipped(session, { decision: "skip_quality", reason: "no_safe_48h_slot" });
    changes.push({ type: "skip_quality_session", sessionId: missedId, weekIndex: weekNumber(week, weekIndex) });
    return {
      repairType: "skip_quality",
      decision: "skipped",
      reason: "Missed quality run skipped because no safe 48h move was available.",
    };
  }

  markSkipped(session, { decision: "skip_unknown", reason: "unknown_session_type" });
  changes.push({ type: "skip_session", sessionId: missedId, sessionType: type });
  return {
    repairType: "skip_unknown",
    decision: "skipped",
    reason: "Missed session skipped because session type was not safely repairable.",
  };
}

export function repairPlanAfterMissedSession({
  plan,
  missedSession = null,
  missedSessionIds = null,
  completedSessions = null,
  profile = null,
  currentDate = null,
  goalRealism = null,
} = {}) {
  const sourcePlan = plan && typeof plan === "object" ? plan : {};
  const nextPlan = clone(sourcePlan);
  const missed = normalizeMissedSessions({ missedSession, missedSessionIds, completedSessions });
  const changes = [];

  if (!missed.length) {
    return {
      plan: nextPlan,
      repairApplied: false,
      repairType: "none",
      message: "No missed sessions supplied.",
      changes,
      missedSessionRepairTrace: {
        missedSessionId: null,
        decision: "none",
        reason: "no_missed_sessions",
        changes,
      },
    };
  }

  const found = missed.map((item) => ({ input: item, found: findSession(nextPlan, item) })).filter((x) => x.found);
  if (!found.length) {
    return {
      plan: nextPlan,
      repairApplied: false,
      repairType: "not_found",
      message: "Missed session was not found in the generated plan.",
      changes,
      missedSessionRepairTrace: {
        missedSessionId: missed.map((m) => m.sessionId || m.id || m.sessionKey || null).filter(Boolean).join(",") || null,
        decision: "not_found",
        reason: "missed_session_not_found",
        changes,
      },
    };
  }

  let result;
  if (found.length >= 2) {
    const first = found[0].found;
    for (const item of found) {
      markSkipped(item.found.session, { decision: "multiple_missed_sessions", reason: "switch_next_week_to_recovery" });
      changes.push({ type: "mark_skipped", sessionId: sessionId(item.found.session) || null });
    }
    convertNextWeekToRecovery(nextPlan, first.weekIndex, changes);
    result = {
      repairType: "recovery_week",
      decision: "next_week_recovery",
      reason: "Multiple missed sessions trigger a recovery/rebuild week.",
    };
  } else {
    result = applySingleMissedRepair({ plan: nextPlan, found: found[0].found, changes });
  }

  nextPlan.missedSessionRepairTrace = {
    missedSessionId: found.map((item) => sessionId(item.found.session) || item.input?.sessionId || item.input?.sessionKey || null).filter(Boolean).join(",") || null,
    decision: result.decision,
    reason: result.reason,
    repairType: result.repairType,
    currentDate: currentDate || null,
    goalRealismLevel: goalRealism?.level || null,
    changes,
  };

  return {
    plan: nextPlan,
    repairApplied: true,
    repairType: result.repairType,
    message: result.reason,
    changes,
    missedSessionRepairTrace: nextPlan.missedSessionRepairTrace,
  };
}
