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

function isLong(session = {}) {
  return sessionType(session) === "LONG" || sessionType(session) === "LONGRUN";
}

function isEasy(session = {}) {
  return ["EASY", "RECOVERY", "AEROBIC"].includes(sessionType(session));
}

function isRace(session = {}) {
  return sessionType(session) === "RACE";
}

function isCompletedRow(row = {}) {
  const status = String(row.status || "").toLowerCase();
  return Boolean(status === "completed" || row.completedAt || row.completed === true);
}

function isMissedRow(row = {}) {
  const status = String(row.status || "").toLowerCase();
  return Boolean(status === "skipped" || status === "missed" || row.skippedAt);
}

function isCompletedSession(session = {}) {
  const status = String(session.status || session.completionStatus || "").toLowerCase();
  return Boolean(status === "completed" || session.completedAt || session.completed === true);
}

function plannedKm(session = {}) {
  return toNum(session.plannedDistanceKm) ?? toNum(session.distanceKm) ?? toNum(session.distance) ?? 0;
}

function actualKm(row = {}) {
  return (
    toNum(row.actualDistanceKm) ??
    toNum(row.completedDistanceKm) ??
    toNum(row.distanceKm) ??
    toNum(row.distance) ??
    0
  );
}

function sessionId(session = {}) {
  return String(session.sessionId || session.id || session.key || session.sessionKey || "").trim() || null;
}

function rowSessionId(row = {}) {
  return String(row.sessionId || row.id || row.key || row.sessionKey || "").trim() || null;
}

function completionAnalysisFromRow(row = {}) {
  const candidates = [
    row.completionAnalysis,
    row.activity?.completionAnalysis,
    row.completedActivity?.completionAnalysis,
    row.linkedActivity?.completionAnalysis,
    row.session?.completionAnalysis,
  ];
  return candidates.find((value) => value && typeof value === "object") || null;
}

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function hasFatigueWarning(analysis = {}) {
  const intensity = analysis.intensityMatch || {};
  const actualHr = toNum(intensity.avgHr);
  const maxHr = toNum(intensity.targetHrRange?.maxBpm ?? intensity.targetHrRange?.max);
  if (actualHr != null && maxHr != null && actualHr > maxHr + 8) return true;
  const text = [
    ...(Array.isArray(analysis.notes) ? analysis.notes : []),
    ...(Array.isArray(analysis.recommendations) ? analysis.recommendations : []),
  ].join(" ").toLowerCase();
  return /\b(fatigue|heart rate|hr|illness|injury|accumulated load|heat)\b/.test(text);
}

function weekNumber(week = {}, index = 0) {
  return Number(week.weekIndex || week.weekNumber || index + 1) || index + 1;
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
      weeklyRecalculatedSessionKm: nextKm,
    };
  }
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
}

function flattenPlanSessions(plan = {}) {
  const out = [];
  const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];
  weeks.forEach((week, weekIndex) => {
    const sessions = Array.isArray(week.sessions) ? week.sessions : [];
    sessions.forEach((session, sessionIndex) => {
      out.push({ week, weekIndex, session, sessionIndex });
    });
  });
  return out;
}

function matchPlanSession(index, row) {
  const id = rowSessionId(row);
  const rowWeek = toNum(row.weekIndex ?? row.weekNumber);
  const rowDay = String(row.day || "").trim();
  const rowType = String(row.type || row.workoutKind || row.sessionType || "").trim().toUpperCase();
  return index.find(({ week, weekIndex, session }) => {
    if (id && sessionId(session) === id) return true;
    const weekMatches = rowWeek == null || weekNumber(week, weekIndex) === rowWeek;
    const dayMatches = !rowDay || String(session.day || "").trim() === rowDay;
    const typeMatches = !rowType || sessionType(session) === rowType;
    return weekMatches && dayMatches && typeMatches;
  });
}

function buildOutcomeSummary(plan, completedSessions = []) {
  const rows = Array.isArray(completedSessions) ? completedSessions : [];
  const index = flattenPlanSessions(plan);
  let planned = 0;
  let actual = 0;
  let plannedHard = 0;
  let actualHard = 0;
  let totalCount = 0;
  let completedCount = 0;
  let missedQuality = 0;
  let missedLongRun = false;
  let maxWeekIndex = -1;
  const completedIds = new Set();
  const completionTrend = {
    analysedSessionCount: 0,
    averageCompletionScore: null,
    lowScoreCount: 0,
    easyOverdoneCount: 0,
    partialLongRunCount: 0,
    qualityMismatchedOrPartialCount: 0,
    fatigueWarningCount: 0,
  };
  let scoreTotal = 0;

  for (const row of rows) {
    const match = matchPlanSession(index, row);
    const session = match?.session || row;
    const rowPlanned = toNum(row.plannedDistanceKm) ?? toNum(row.targetDistanceKm) ?? plannedKm(session);
    const rowActual = isCompletedRow(row) ? actualKm(row) || rowPlanned : 0;
    const hard = isHard(session) || isHard(row);
    const long = isLong(session) || isLong(row);
    totalCount += 1;
    planned += Math.max(0, rowPlanned);
    if (hard) plannedHard += Math.max(0, rowPlanned);
    if (isCompletedRow(row)) {
      completedCount += 1;
      actual += Math.max(0, rowActual);
      if (hard) actualHard += Math.max(0, rowActual);
      const id = sessionId(session) || rowSessionId(row);
      if (id) completedIds.add(id);
    }
    if (isMissedRow(row) && hard) missedQuality += 1;
    if (isMissedRow(row) && long) missedLongRun = true;
    if (match) maxWeekIndex = Math.max(maxWeekIndex, match.weekIndex);

    const analysis = completionAnalysisFromRow(row);
    if (analysis) {
      completionTrend.analysedSessionCount += 1;
      const score = toNum(analysis.completionScore);
      if (score != null) {
        scoreTotal += score;
        if (score < 70) completionTrend.lowScoreCount += 1;
      }
      const status = normalizedStatus(analysis.status);
      const volumeStatus = normalizedStatus(analysis.volumeMatch?.status);
      const intensityStatus = normalizedStatus(analysis.intensityMatch?.status);
      if (isEasy(session) && (status === "overdone" || volumeStatus === "excessive" || intensityStatus === "too_fast")) {
        completionTrend.easyOverdoneCount += 1;
      }
      if (long && (status === "partial" || volumeStatus === "under" || volumeStatus === "slightly_under")) {
        completionTrend.partialLongRunCount += 1;
      }
      if (
        hard &&
        (
          status === "partial" ||
          status === "mismatched" ||
          intensityStatus === "missing_quality" ||
          intensityStatus === "mismatched" ||
          intensityStatus === "under_effort"
        )
      ) {
        completionTrend.qualityMismatchedOrPartialCount += 1;
      }
      if (hasFatigueWarning(analysis)) {
        completionTrend.fatigueWarningCount += 1;
      }
    }
  }

  if (completionTrend.analysedSessionCount > 0) {
    completionTrend.averageCompletionScore = round1(scoreTotal / completionTrend.analysedSessionCount);
  }

  return {
    completionRate: totalCount > 0 ? completedCount / totalCount : 1,
    volumeCompletionRate: planned > 0 ? actual / planned : 1,
    intensityCompletionRate: plannedHard > 0 ? actualHard / plannedHard : 1,
    missedQuality,
    missedLongRun,
    maxWeekIndex,
    completedIds,
    completionAnalysisUsed: completionTrend.analysedSessionCount > 0,
    completionTrend,
  };
}

function nextAdjustableWeek(plan, afterWeekIndex) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const start = Math.max(0, Number(afterWeekIndex) + 1 || 0);
  for (let wi = start; wi < weeks.length; wi += 1) {
    const week = weeks[wi];
    const sessions = Array.isArray(week.sessions) ? week.sessions : [];
    if (sessions.some((s) => !isCompletedSession(s) && !isRace(s))) return { week, weekIndex: wi };
  }
  return null;
}

function reduceSession(session, factor) {
  setSessionKm(session, plannedKm(session) * factor);
}

function convertHardToEasy(session, factor = 0.7) {
  session.type = "EASY";
  session.sessionType = "EASY";
  session.workoutKind = "EASY";
  session.name = "Easy rebuild run";
  session.keyTargets = "Comfortable pace";
  session.workout = {
    kind: "EASY",
    estimatedDistanceMeters: Math.round(plannedKm(session) * factor * 1000),
    meta: { weeklyRecalculation: { action: "convert_hard_to_easy" } },
  };
  reduceSession(session, factor);
}

function capLongRunShare(week, changes, weekIndex, maxShare = 0.42) {
  const sessions = Array.isArray(week.sessions) ? week.sessions : [];
  const total = sessions.reduce((sum, s) => sum + plannedKm(s), 0);
  const long = sessions.find((s) => isLong(s) && !isCompletedSession(s) && !isRace(s));
  if (!long || total <= 0) return;
  const currentShare = plannedKm(long) / total;
  if (currentShare <= maxShare) return;
  const beforeKm = plannedKm(long);
  const nonLong = total - beforeKm;
  const maxLong = nonLong > 0 ? (maxShare * nonLong) / (1 - maxShare) : beforeKm;
  setSessionKm(long, Math.min(beforeKm, maxLong));
  changes.push({
    type: "cap_long_run_share",
    sessionId: sessionId(long),
    weekIndex: weekNumber(week, weekIndex),
    beforeKm,
    afterKm: plannedKm(long),
    maxSharePct: round1(maxShare * 100),
  });
}

function applyRecoveryWeek(week, weekIndex, changes) {
  week.phase = "RECOVERY";
  week.repairPhase = "REBUILD";
  for (const session of week.sessions || []) {
    if (isCompletedSession(session) || isRace(session)) continue;
    const beforeType = sessionType(session);
    const beforeKm = plannedKm(session);
    if (isHard(session)) convertHardToEasy(session, 0.65);
    else reduceSession(session, 0.8);
    changes.push({
      type: "recovery_rebuild_session",
      sessionId: sessionId(session),
      weekIndex: weekNumber(week, weekIndex),
      beforeType,
      afterType: sessionType(session),
      beforeKm,
      afterKm: plannedKm(session),
    });
  }
  recomputeWeekMetrics(week);
}

function reduceQualityOnly(week, weekIndex, changes, factor = 0.8) {
  for (const session of week.sessions || []) {
    if (isCompletedSession(session) || isRace(session) || !isHard(session)) continue;
    const beforeKm = plannedKm(session);
    reduceSession(session, factor);
    session.meta = {
      ...(session.meta || {}),
      weeklyRecalculation: { action: "reduce_quality", factor },
    };
    changes.push({
      type: "reduce_quality",
      sessionId: sessionId(session),
      weekIndex: weekNumber(week, weekIndex),
      beforeKm,
      afterKm: plannedKm(session),
    });
  }
  recomputeWeekMetrics(week);
}

function capWeekProgression(week, weekIndex, changes, capFactor = 0.97) {
  for (const session of week.sessions || []) {
    if (isCompletedSession(session) || isRace(session)) continue;
    const beforeKm = plannedKm(session);
    reduceSession(session, capFactor);
    if (plannedKm(session) !== beforeKm) {
      changes.push({
        type: "cap_week_volume",
        sessionId: sessionId(session),
        weekIndex: weekNumber(week, weekIndex),
        beforeKm,
        afterKm: plannedKm(session),
      });
    }
  }
  recomputeWeekMetrics(week);
}

function reduceNextLongRun(week, weekIndex, changes, factor = 0.85) {
  const long = (week.sessions || []).find((s) => isLong(s) && !isCompletedSession(s) && !isRace(s));
  if (!long) return false;
  const beforeKm = plannedKm(long);
  reduceSession(long, factor);
  changes.push({
    type: "reduce_next_long_run",
    sessionId: sessionId(long),
    weekIndex: weekNumber(week, weekIndex),
    beforeKm,
    afterKm: plannedKm(long),
  });
  recomputeWeekMetrics(week);
  return true;
}

function reduceNextQualitySession(week, weekIndex, changes, factor = 0.85, type = "reduce_next_quality") {
  const quality = (week.sessions || []).find((s) => isHard(s) && !isCompletedSession(s) && !isRace(s));
  if (!quality) return null;
  const beforeKm = plannedKm(quality);
  reduceSession(quality, factor);
  quality.meta = {
    ...(quality.meta || {}),
    weeklyRecalculation: {
      ...(quality.meta?.weeklyRecalculation || {}),
      action: type,
      factor,
    },
  };
  const change = {
    type,
    sessionId: sessionId(quality),
    weekIndex: weekNumber(week, weekIndex),
    beforeKm,
    afterKm: plannedKm(quality),
  };
  changes.push(change);
  recomputeWeekMetrics(week);
  return change;
}

function appendGuidance(existing, addition) {
  const current = String(existing || "").trim();
  if (!current) return addition;
  if (current.toLowerCase().includes(addition.toLowerCase())) return current;
  return `${current} ${addition}`;
}

function slowEasyPaceGuidance(week, weekIndex, changes) {
  const easy = (week.sessions || []).find((s) => isEasy(s) && !isCompletedSession(s) && !isRace(s));
  if (!easy) return null;
  const guidance = "Use the slower end of your easy range until easy runs feel controlled again.";
  easy.executionTip = appendGuidance(easy.executionTip, guidance);
  easy.coachNote = appendGuidance(easy.coachNote, "Recent easy runs were completed too hard, so this run should feel deliberately relaxed.");
  easy.keyTargets = appendGuidance(easy.keyTargets, "Easy effort only; stay relaxed.");
  easy.meta = {
    ...(easy.meta || {}),
    weeklyRecalculation: {
      ...(easy.meta?.weeklyRecalculation || {}),
      action: "slow_easy_guidance",
      reason: "repeated_overdone_easy_runs",
    },
  };
  const change = {
    type: "slow_easy_guidance",
    sessionId: sessionId(easy),
    weekIndex: weekNumber(week, weekIndex),
    message: guidance,
  };
  changes.push(change);
  return change;
}

function fatigueIsHigh(readiness = {}) {
  if (!readiness || typeof readiness !== "object") return false;
  const fatigue = toNum(readiness.fatigue);
  const score = toNum(readiness.score);
  return Boolean(fatigue >= 75 || score <= 45 || readiness.illness || readiness.injuryPain);
}

export function recalculateUpcomingWeeks({
  plan,
  profile = null,
  completedSessions = null,
  currentDate = null,
  goalRealism = null,
  readiness = null,
} = {}) {
  const nextPlan = clone(plan && typeof plan === "object" ? plan : {});
  const changes = [];
  const completionDrivenChanges = [];
  const trace = [{
    step: "input",
    completedSessionCount: Array.isArray(completedSessions) ? completedSessions.length : 0,
    currentDate: currentDate || null,
    goalRealismLevel: goalRealism?.level || null,
  }];

  if (!Array.isArray(completedSessions) || completedSessions.length === 0) {
    return {
      plan: nextPlan,
      weeklyRecalculation: {
        applied: false,
        completionRate: 1,
        volumeCompletionRate: 1,
        intensityCompletionRate: 1,
        decision: "no_outcomes",
        message: "No completed session outcomes supplied.",
        completionAnalysisUsed: false,
        completionTrend: null,
        completionDrivenChanges,
        changes,
      },
      weeklyRecalculationTrace: trace,
    };
  }

  const summary = buildOutcomeSummary(nextPlan, completedSessions);
  const target = nextAdjustableWeek(nextPlan, summary.maxWeekIndex);
  if (!target) {
    return {
      plan: nextPlan,
      weeklyRecalculation: {
        applied: false,
        completionRate: round1(summary.completionRate),
        volumeCompletionRate: round1(summary.volumeCompletionRate),
        intensityCompletionRate: round1(summary.intensityCompletionRate),
        decision: "no_upcoming_week",
        message: "No upcoming adjustable week found.",
        completionAnalysisUsed: summary.completionAnalysisUsed,
        completionTrend: summary.completionTrend,
        completionDrivenChanges,
        changes,
      },
      weeklyRecalculationTrace: [...trace, { step: "no_change", reason: "no_upcoming_week" }],
    };
  }

  const taper = String(target.week.phase || target.week?.targets?.phase || "").toUpperCase() === "TAPER";
  const highFatigue = fatigueIsHigh(readiness);
  let decision = "continue";
  let message = "Completion is on track; upcoming week left as planned.";

  trace.push({
    step: "summary",
    completionRate: round1(summary.completionRate),
    volumeCompletionRate: round1(summary.volumeCompletionRate),
    intensityCompletionRate: round1(summary.intensityCompletionRate),
    missedQuality: summary.missedQuality,
    missedLongRun: summary.missedLongRun,
    completionAnalysisUsed: summary.completionAnalysisUsed,
    completionTrend: summary.completionTrend,
    highFatigue,
    targetWeekIndex: weekNumber(target.week, target.weekIndex),
    taper,
  });

  if (highFatigue && summary.volumeCompletionRate < 0.75) {
    decision = "recovery_rebuild";
    message = "Low completion plus high fatigue triggers a recovery/rebuild week.";
    applyRecoveryWeek(target.week, target.weekIndex, changes);
  } else if (summary.volumeCompletionRate < 0.5) {
    decision = "recovery_rebuild";
    message = "Completed less than 50% planned volume; next week changed to recovery/rebuild.";
    applyRecoveryWeek(target.week, target.weekIndex, changes);
  } else if (summary.volumeCompletionRate < 0.75) {
    decision = "hold_volume_reduce_quality";
    message = "Completed 50-75% planned volume; holding volume and reducing quality.";
    reduceQualityOnly(target.week, target.weekIndex, changes, taper ? 0.9 : 0.8);
    if (!taper) capWeekProgression(target.week, target.weekIndex, changes, 0.98);
  } else if (summary.volumeCompletionRate < 0.9) {
    decision = "small_progression_only";
    message = "Completed 75-90% planned volume; limiting next-week progression.";
    capWeekProgression(target.week, target.weekIndex, changes, taper ? 0.99 : 0.97);
  } else if (summary.volumeCompletionRate > 1.2) {
    decision = "cap_after_overcompletion";
    message = "Completed more than 120% planned volume; next week capped and flagged.";
    capWeekProgression(target.week, target.weekIndex, changes, 0.95);
  }

  if (summary.completionAnalysisUsed) {
    const trend = summary.completionTrend || {};
    const averageScore = toNum(trend.averageCompletionScore);

    if (averageScore != null && averageScore < 70 && decision !== "recovery_rebuild") {
      decision = "completion_recovery_rebuild";
      message = "Recent completion quality is low; next week changed to recovery/rebuild.";
      applyRecoveryWeek(target.week, target.weekIndex, changes);
      completionDrivenChanges.push({
        type: "completion_score_recovery_rebuild",
        averageCompletionScore: averageScore,
        lowScoreCount: trend.lowScoreCount || 0,
      });
    }

    if ((trend.easyOverdoneCount || 0) >= 2) {
      const change = slowEasyPaceGuidance(target.week, target.weekIndex, changes);
      if (change) {
        completionDrivenChanges.push({
          ...change,
          reason: "repeated_overdone_easy_runs",
          count: trend.easyOverdoneCount,
        });
        if (decision === "continue") {
          decision = "completion_guidance_warning";
          message = "Repeated overdone easy runs; next easy run guidance was slowed.";
        }
      }
    }

    if ((trend.partialLongRunCount || 0) >= 2) {
      const beforeCount = changes.length;
      const changed = reduceNextLongRun(target.week, target.weekIndex, changes, taper ? 0.92 : 0.85);
      if (changed) {
        const change = changes[changes.length - 1];
        completionDrivenChanges.push({
          ...change,
          reason: "repeated_partial_long_runs",
          count: trend.partialLongRunCount,
        });
        if (decision === "continue" || decision === "completion_guidance_warning") {
          decision = "completion_reduce_next_long_run";
          message = "Repeated partial long runs; next long run reduced instead of forcing a catch-up.";
        }
      } else if (changes.length === beforeCount) {
        completionDrivenChanges.push({
          type: "partial_long_run_warning",
          reason: "repeated_partial_long_runs",
          count: trend.partialLongRunCount,
        });
      }
    }

    if ((trend.qualityMismatchedOrPartialCount || 0) > 0 && decision !== "recovery_rebuild" && decision !== "completion_recovery_rebuild") {
      const change = reduceNextQualitySession(
        target.week,
        target.weekIndex,
        changes,
        taper ? 0.92 : 0.82,
        "completion_reduce_quality_after_mismatch"
      );
      if (change) {
        completionDrivenChanges.push({
          ...change,
          reason: "quality_mismatched_or_partial",
          count: trend.qualityMismatchedOrPartialCount,
        });
        if (decision === "continue" || decision === "completion_guidance_warning") {
          decision = "completion_reduce_quality_after_mismatch";
          message = "Recent quality work was partial or mismatched; next quality session reduced.";
        }
      }
    }

    if ((trend.fatigueWarningCount || 0) > 0 && decision !== "recovery_rebuild" && decision !== "completion_recovery_rebuild") {
      const alreadyReduced = changes.some((change) => String(change.type || "").includes("quality"));
      if (!alreadyReduced) {
        const change = reduceNextQualitySession(
          target.week,
          target.weekIndex,
          changes,
          taper ? 0.95 : 0.85,
          "completion_reduce_quality_for_fatigue"
        );
        if (change) {
          completionDrivenChanges.push({
            ...change,
            reason: "fatigue_warning",
            count: trend.fatigueWarningCount,
          });
          if (decision === "continue" || decision === "completion_guidance_warning") {
            decision = "completion_reduce_quality_for_fatigue";
            message = "Completion analysis flagged fatigue; next quality session reduced.";
          }
        }
      } else {
        completionDrivenChanges.push({
          type: "fatigue_warning_acknowledged",
          reason: "fatigue_warning",
          count: trend.fatigueWarningCount,
        });
      }
    }
  }

  if (summary.missedQuality > 0 && decision !== "recovery_rebuild") {
    const quality = (target.week.sessions || []).find((s) => isHard(s) && !isCompletedSession(s) && !isRace(s));
    if (quality) {
      const beforeType = sessionType(quality);
      const beforeKm = plannedKm(quality);
      convertHardToEasy(quality, taper ? 0.75 : 0.7);
      changes.push({
        type: "avoid_stacked_missed_quality",
        sessionId: sessionId(quality),
        weekIndex: weekNumber(target.week, target.weekIndex),
        beforeType,
        afterType: sessionType(quality),
        beforeKm,
        afterKm: plannedKm(quality),
      });
      decision = decision === "continue" ? "avoid_stacked_quality" : decision;
      message = "Missed most quality; next week avoids stacked quality catch-up.";
      recomputeWeekMetrics(target.week);
    }
  }

  if (summary.missedLongRun) {
    const changed = reduceNextLongRun(target.week, target.weekIndex, changes, taper ? 0.9 : 0.85);
    if (changed && decision === "continue") {
      decision = "reduce_next_long_run";
      message = "Missed long run; next long run reduced.";
    }
  }

  capLongRunShare(target.week, changes, target.weekIndex, 0.42);
  recomputeWeekMetrics(target.week);

  const applied = changes.length > 0;
  return {
    plan: nextPlan,
    weeklyRecalculation: {
      applied,
      completionRate: round1(summary.completionRate),
      volumeCompletionRate: round1(summary.volumeCompletionRate),
      intensityCompletionRate: round1(summary.intensityCompletionRate),
      completionAnalysisUsed: summary.completionAnalysisUsed,
      completionTrend: summary.completionTrend,
      completionDrivenChanges,
      decision,
      message,
      changes,
    },
    weeklyRecalculationTrace: [
      ...trace,
      {
        step: applied ? "applied" : "no_change",
        decision,
        completionAnalysisUsed: summary.completionAnalysisUsed,
        completionTrend: summary.completionTrend,
        completionDrivenChanges,
        changes,
      },
    ],
  };
}
