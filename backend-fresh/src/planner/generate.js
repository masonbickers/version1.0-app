import { deriveHrZones, derivePaces } from "./anchors.js";
import { buildWeeklyTargets } from "./phases.js";
import { applyStockTemplate } from "./stockPlans.js";
import {
  DAY_ORDER,
  addDaysIso,
  clamp,
  dayIndex,
  goalDistanceKm,
  makeSessionId,
  round1,
  roundInt,
  weekStartMonday,
  weekdayFromIso
} from "./utils.js";
import {
  makeEasySession,
  makeLongSession,
  makeQualitySession,
  makeRaceSession
} from "./workouts.js";

const TRAINING_QUALITY_TYPES = new Set(["INTERVALS", "THRESHOLD", "TEMPO"]);

function chooseQualityDays(runDays, longRunDay, desiredCount) {
  const candidates = runDays.filter((d) => d !== longRunDay);
  const targetCount = Math.min(Math.max(0, Number(desiredCount) || 0), candidates.length);

  if (targetCount <= 1) {
    if (!targetCount) return [];
    const longIdx = dayIndex(longRunDay);
    return candidates
      .slice()
      .sort((a, b) => Math.abs(dayIndex(b) - longIdx) - Math.abs(dayIndex(a) - longIdx))
      .slice(0, 1)
      .sort((a, b) => dayIndex(a) - dayIndex(b));
  }

  if (targetCount >= candidates.length) return candidates;

  const longIdx = dayIndex(longRunDay);
  const sortedByLongDistance = candidates
    .slice()
    .sort((a, b) => Math.abs(dayIndex(b) - longIdx) - Math.abs(dayIndex(a) - longIdx));

  const picked = [sortedByLongDistance[0]];

  while (picked.length < targetCount) {
    let bestDay = null;
    let bestScore = -1;

    for (const day of candidates) {
      if (picked.includes(day)) continue;

      const idx = dayIndex(day);
      const spacing = Math.min(...picked.map((p) => Math.abs(dayIndex(p) - idx)));
      const distFromLong = longIdx >= 0 ? Math.abs(longIdx - idx) : 3;
      const longAdjPenalty = distFromLong <= 1 ? -100 : distFromLong === 2 ? -5 : 0;
      const score = spacing * 10 + distFromLong + longAdjPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestDay = day;
      }
    }

    if (!bestDay) break;
    picked.push(bestDay);
  }

  return picked.sort((a, b) => dayIndex(a) - dayIndex(b));
}

function qualityDaysTargetForPhase(config, phase, runDaysCount) {
  const rawByPhase = config?.distribution?.qualityDaysByPhase;
  const fallback = Number(config?.distribution?.qualityDaysPerWeek ?? 2);
  const phaseValue =
    rawByPhase && typeof rawByPhase === "object" ? Number(rawByPhase[phase]) : Number.NaN;
  const desired = Number.isFinite(phaseValue) ? phaseValue : fallback;
  const maxAllowed = Math.max(0, Math.max(1, runDaysCount) - 1);

  return Math.max(0, Math.min(Math.round(desired), maxAllowed));
}

function allocateWeekDistances({
  weeklyKm,
  longKm,
  phase,
  qualityCount,
  easyCount,
  config
}) {
  const qPctBase = config.distribution.qualityPctByPhase[phase] ?? 0.25;
  const singleQualityDayPctScale = Number(config.distribution.singleQualityDayPctScale ?? 0.82);
  const qPct =
    qualityCount === 1 && Number.isFinite(singleQualityDayPctScale)
      ? qPctBase * singleQualityDayPctScale
      : qPctBase;

  const minQ = config.distribution.minQualitySessionKm;
  const maxQ = config.distribution.maxQualitySessionKm;
  const minEasy = config.distribution.minEasySessionKm;
  const maxEasyToLongRatio = Number(config.distribution.maxEasyToLongRatio ?? 0.92);
  const maxLongRunShareForOverflow = Number(config.distribution.maxLongRunShareForOverflow ?? 0.4);

  let qualityTotal = round1(weeklyKm * qPct);
  let perQ = qualityCount ? qualityTotal / qualityCount : 0;
  perQ = Math.min(Math.max(perQ, minQ), maxQ);
  qualityTotal = round1(perQ * qualityCount);

  let remaining = round1(weeklyKm - longKm - qualityTotal);
  let perEasy = easyCount ? remaining / easyCount : 0;

  if (easyCount && perEasy < minEasy) {
    const needed = round1(minEasy * easyCount - remaining);
    const canCutQ = Math.max(0, round1(qualityTotal - qualityCount * minQ));
    const cutQ = Math.min(needed, canCutQ);

    qualityTotal = round1(qualityTotal - cutQ);
    perQ = qualityCount ? qualityTotal / qualityCount : 0;
    remaining = round1(weeklyKm - longKm - qualityTotal);
    perEasy = easyCount ? remaining / easyCount : 0;
  }

  const qualityDistances = Array.from({ length: qualityCount }, () => round1(perQ));
  const easyDistances = Array.from({ length: easyCount }, () => round1(perEasy));

  if (
    easyDistances.length &&
    Number.isFinite(longKm) &&
    longKm > 0 &&
    Number.isFinite(maxEasyToLongRatio)
  ) {
    const easyCapKm = round1(Math.max(minEasy, longKm * maxEasyToLongRatio));
    let overflow = 0;

    for (let i = 0; i < easyDistances.length; i += 1) {
      if (easyDistances[i] <= easyCapKm) continue;
      overflow = round1(overflow + (easyDistances[i] - easyCapKm));
      easyDistances[i] = easyCapKm;
    }

    if (
      overflow > 0 &&
      Number.isFinite(maxLongRunShareForOverflow) &&
      maxLongRunShareForOverflow > 0
    ) {
      const longCap = round1(Math.max(longKm, weeklyKm * maxLongRunShareForOverflow));
      const longHeadroom = round1(Math.max(0, longCap - longKm));
      if (longHeadroom > 0) {
        const addToLong = round1(Math.min(longHeadroom, overflow));
        longKm = round1(longKm + addToLong);
        overflow = round1(overflow - addToLong);
      }
    }

    if (overflow > 0 && qualityDistances.length) {
      for (let i = 0; i < qualityDistances.length && overflow > 0; i += 1) {
        const headroom = round1(maxQ - qualityDistances[i]);
        if (headroom <= 0) continue;
        const add = round1(Math.min(headroom, overflow));
        qualityDistances[i] = round1(qualityDistances[i] + add);
        overflow = round1(overflow - add);
      }
    }

    if (overflow > 0) {
      longKm = round1(longKm + overflow);
    }
  }

  const sum = round1(
    longKm +
      qualityDistances.reduce((s, x) => s + x, 0) +
      easyDistances.reduce((s, x) => s + x, 0)
  );

  const drift = round1(weeklyKm - sum);
  if (Math.abs(drift) >= 0.1) {
    if (easyDistances.length) {
      easyDistances[easyDistances.length - 1] = round1(
        easyDistances[easyDistances.length - 1] + drift
      );
    } else if (qualityDistances.length) {
      qualityDistances[qualityDistances.length - 1] = round1(
        qualityDistances[qualityDistances.length - 1] + drift
      );
    } else {
      longKm = round1(longKm + drift);
    }
  }

  return { longKm, qualityDistances, easyDistances };
}

function setSessionDistanceKm(session, nextKm) {
  const km = round1(Math.max(0, Number(nextKm) || 0));
  session.distanceKm = km;
  session.plannedDistanceKm = km;
  session.distanceMeters = roundInt(km * 1000);

  if (session.workout && typeof session.workout === "object") {
    session.workout.estimatedDistanceMeters = roundInt(km * 1000);

    const steps = Array.isArray(session.workout.steps) ? session.workout.steps : [];
    if (steps.length === 1 && String(steps[0]?.durationType).toLowerCase() === "distance") {
      steps[0].durationValue = roundInt(km * 1000);
    }
  }
}

function normalizeRaceSessionHeadline(session, raceDistanceKm) {
  const km = round1(Math.max(0, Number(raceDistanceKm) || 0));
  session.distanceKm = km;
  session.plannedDistanceKm = km;
  session.distanceMeters = roundInt(km * 1000);
}

function easyVariantAddRank(session) {
  const variant = String(session?.workout?.variant || "");
  if (variant === "aerobic_easy") return 0;
  if (variant === "steady_easy") return 1;
  if (variant === "recovery") return 3;
  if (variant === "shakeout") return 4;
  return 2;
}

function easyVariantCutRank(session) {
  const variant = String(session?.workout?.variant || "");
  if (variant === "shakeout") return 0;
  if (variant === "recovery") return 1;
  if (variant === "aerobic_easy") return 2;
  if (variant === "steady_easy") return 3;
  return 4;
}

function rebalanceWeekToTarget(sessions, weeklyTargetKm, config, warnings, weekNumber) {
  const currentWeeklyKm = round1(sessions.reduce((sum, s) => sum + (s.distanceKm || 0), 0));
  let drift = round1(weeklyTargetKm - currentWeeklyKm);
  if (Math.abs(drift) < 0.1) return;

  const minEasyKm = round1(
    Math.max(2.5, Number(config?.distribution?.minEasySessionKm ?? 4) * 0.8)
  );
  const maxEasyToLongRatio = Number(config?.distribution?.maxEasyToLongRatio ?? 0.92);

  const longIdx = sessions.findIndex((s) => s.type === "LONG");
  const longKm = longIdx >= 0 ? round1(sessions[longIdx].distanceKm || 0) : 0;
  const easyCapKm =
    longKm > 0 && Number.isFinite(maxEasyToLongRatio)
      ? round1(Math.max(minEasyKm, longKm * maxEasyToLongRatio))
      : Number.POSITIVE_INFINITY;

  if (drift > 0) {
    const easyIdxs = sessions
      .map((s, idx) => ({ s, idx }))
      .filter(({ s, idx }) => idx !== longIdx && s.type === "EASY")
      .sort((a, b) => {
        const rankDiff = easyVariantAddRank(a.s) - easyVariantAddRank(b.s);
        if (rankDiff !== 0) return rankDiff;
        return (a.s.distanceKm || 0) - (b.s.distanceKm || 0);
      })
      .map(({ idx }) => idx);

    for (const idx of easyIdxs) {
      if (drift <= 0) break;
      const cur = round1(sessions[idx].distanceKm || 0);
      const headroom = round1(Math.max(0, easyCapKm - cur));
      if (headroom <= 0) continue;
      const add = round1(Math.min(headroom, drift));
      setSessionDistanceKm(sessions[idx], cur + add);
      drift = round1(drift - add);
    }

    if (drift > 0 && longIdx >= 0) {
      const cur = round1(sessions[longIdx].distanceKm || 0);
      setSessionDistanceKm(sessions[longIdx], cur + drift);
      drift = 0;
    }
  } else {
    let needToRemove = Math.abs(drift);

    const easyIdxs = sessions
      .map((s, idx) => ({ s, idx }))
      .filter(({ s, idx }) => idx !== longIdx && s.type === "EASY")
      .sort((a, b) => {
        const rankDiff = easyVariantCutRank(a.s) - easyVariantCutRank(b.s);
        if (rankDiff !== 0) return rankDiff;
        return (b.s.distanceKm || 0) - (a.s.distanceKm || 0);
      })
      .map(({ idx }) => idx);

    for (const idx of easyIdxs) {
      if (needToRemove <= 0) break;
      const cur = round1(sessions[idx].distanceKm || 0);
      const removable = round1(Math.max(0, cur - minEasyKm));
      if (removable <= 0) continue;
      const cut = round1(Math.min(removable, needToRemove));
      setSessionDistanceKm(sessions[idx], cur - cut);
      needToRemove = round1(needToRemove - cut);
    }

    if (needToRemove > 0 && longIdx >= 0) {
      const cur = round1(sessions[longIdx].distanceKm || 0);
      const minLongKm = round1(Math.max(minEasyKm + 0.5, goalDistanceKm("5K") || 5));
      const removable = round1(Math.max(0, cur - minLongKm));
      if (removable > 0) {
        const cut = round1(Math.min(removable, needToRemove));
        setSessionDistanceKm(sessions[longIdx], cur - cut);
        needToRemove = round1(needToRemove - cut);
      }
    }

    drift = round1(-needToRemove);
  }

  const finalWeeklyKm = round1(sessions.reduce((sum, s) => sum + (s.distanceKm || 0), 0));
  const remainingDrift = round1(weeklyTargetKm - finalWeeklyKm);
  if (Math.abs(remainingDrift) >= 0.2) {
    warnings.push(
      `Week ${weekNumber}: weekly target drift remains ${remainingDrift.toFixed(
        1
      )} km after rebalancing.`
    );
  }
}

function enforceLongRunDominance(sessions, config, warnings, weekNumber) {
  const longIdx = sessions.findIndex((s) => s.type === "LONG");
  if (longIdx < 0) return;

  const minLeadKm = round1(
    Math.max(0.2, Number(config?.distribution?.longRunMinLeadKm ?? 0.4))
  );
  const minEasyKm = round1(
    Math.max(2.5, Number(config?.distribution?.minEasySessionKm ?? 4) * 0.8)
  );

  const currentLongKm = round1(sessions[longIdx].distanceKm || 0);
  const maxOtherKm = sessions.reduce((maxKm, s, idx) => {
    if (idx === longIdx || s.type === "RACE") return maxKm;
    return Math.max(maxKm, round1(s.distanceKm || 0));
  }, 0);

  const targetLongKm = round1(maxOtherKm + minLeadKm);
  if (currentLongKm >= targetLongKm) return;

  let needed = round1(targetLongKm - currentLongKm);
  const donorIdxs = sessions
    .map((s, idx) => ({ s, idx }))
    .filter(({ s, idx }) => idx !== longIdx && s.type === "EASY")
    .sort((a, b) => {
      const rankDiff = easyVariantCutRank(a.s) - easyVariantCutRank(b.s);
      if (rankDiff !== 0) return rankDiff;
      return (b.s.distanceKm || 0) - (a.s.distanceKm || 0);
    })
    .map(({ idx }) => idx);

  let movedKm = 0;
  for (const idx of donorIdxs) {
    if (needed <= 0) break;
    const cur = round1(sessions[idx].distanceKm || 0);
    const canGive = round1(Math.max(0, cur - minEasyKm));
    if (canGive <= 0) continue;

    const give = round1(Math.min(canGive, needed));
    setSessionDistanceKm(sessions[idx], cur - give);
    needed = round1(needed - give);
    movedKm = round1(movedKm + give);
  }

  if (movedKm > 0) {
    setSessionDistanceKm(sessions[longIdx], currentLongKm + movedKm);
  }

  const finalLongKm = round1(sessions[longIdx].distanceKm || 0);
  const finalMaxOtherKm = sessions.reduce((maxKm, s, idx) => {
    if (idx === longIdx || s.type === "RACE") return maxKm;
    return Math.max(maxKm, round1(s.distanceKm || 0));
  }, 0);

  if (finalLongKm < round1(finalMaxOtherKm + minLeadKm)) {
    warnings.push(
      `Week ${weekNumber}: unable to enforce long-run dominance fully; long=${finalLongKm.toFixed(
        1
      )} km, max non-long=${finalMaxOtherKm.toFixed(1)} km.`
    );
  }
}

function isEasyOrBeginnerProfile(profile) {
  const difficulty = String(profile?.preferences?.difficulty || "").toLowerCase();
  const experience = String(profile?.current?.experience || "").toLowerCase();
  return difficulty === "easy" || experience.includes("beginner");
}

function buildRaceWeekSupportPolicy(goalKm, profile) {
  const difficulty = String(profile?.preferences?.difficulty || "").toLowerCase();
  const experience = String(profile?.current?.experience || "").toLowerCase();
  const isEasyOrBeginner = difficulty === "easy" || experience.includes("beginner");
  const isHard = difficulty === "hard" || experience.includes("advanced");

  if (goalKm <= 10) {
    return {
      maxPreRaceSupportRuns: isEasyOrBeginner ? 1 : 2,
      allowShakeout: !isEasyOrBeginner,
      maxPostRaceSupportRuns: 0,
      supportPreferenceDaysBefore: [3, 5],
      earlySupportCapKm: isEasyOrBeginner ? 3.5 : 4.5,
      lateSupportCapKm: isEasyOrBeginner ? 0 : 3.5,
      shakeoutCapKm: isEasyOrBeginner ? 0 : 2.0,
      shakeoutMinKm: 1.2
    };
  }

  if (goalKm <= 21.2) {
    return {
      maxPreRaceSupportRuns: isEasyOrBeginner ? 1 : 2,
      allowShakeout: true,
      maxPostRaceSupportRuns: 0,
      supportPreferenceDaysBefore: [4, 2],
      earlySupportCapKm: isEasyOrBeginner ? 4.5 : 6.0,
      lateSupportCapKm: isEasyOrBeginner ? 0 : 4.0,
      shakeoutCapKm: isEasyOrBeginner ? 1.8 : 2.5,
      shakeoutMinKm: 1.2
    };
  }

  return {
    maxPreRaceSupportRuns: isHard ? 3 : 2,
    allowShakeout: true,
    maxPostRaceSupportRuns: 0,
    supportPreferenceDaysBefore: isHard ? [5, 3] : [4, 2],
    earlySupportCapKm: isHard ? 8.0 : 6.0,
    lateSupportCapKm: isHard ? 5.0 : 4.0,
    shakeoutCapKm: isHard ? 3.0 : 2.2,
    shakeoutMinKm: 1.5
  };
}

function raceWeekMinKmForSession(dayIdx, raceDayIdx, profile, config) {
  const isEasyOrBeginner = isEasyOrBeginnerProfile(profile);

  if (dayIdx > raceDayIdx) return 0;

  const daysBeforeRace = raceDayIdx - dayIdx;
  if (daysBeforeRace === 1) {
    return isEasyOrBeginner
      ? 0
      : round1(Math.max(1.2, Number(config?.raceWeek?.preRaceDayCapKm ?? 2) * 0.3));
  }

  return isEasyOrBeginner ? 1.5 : 2;
}

function applyRaceWeekRecoveryCaps(lastWeek, raceIdx, config, warnings) {
  const raceDay = lastWeek?.sessions?.[raceIdx]?.day;
  const raceDayIdx = dayIndex(raceDay);
  if (raceDayIdx < 0) return;

  const minEasyKm = round1(
    Math.max(2.5, Number(config?.distribution?.minEasySessionKm ?? 4) * 0.7)
  );
  const postRaceCap = round1(
    Math.max(minEasyKm, Number(config?.raceWeek?.postRaceEasyCapKm ?? 6))
  );
  const preRaceCap = round1(
    Math.max(postRaceCap, Number(config?.raceWeek?.preRaceEasyCapKm ?? 8))
  );
  const preRaceDayCap = round1(
    Math.max(minEasyKm, Number(config?.raceWeek?.preRaceDayCapKm ?? postRaceCap + 1))
  );

  let removedKm = 0;
  for (let idx = 0; idx < lastWeek.sessions.length; idx += 1) {
    if (idx === raceIdx) continue;
    const session = lastWeek.sessions[idx];
    if (session.type !== "EASY") continue;

    const sDayIdx = dayIndex(session.day);
    if (sDayIdx <= raceDayIdx) continue;

    const current = round1(session.distanceKm || 0);
    const capped = round1(Math.min(current, postRaceCap));
    if (capped >= current) continue;

    setSessionDistanceKm(session, capped);
    removedKm = round1(removedKm + (current - capped));
    warnings.push(
      `Race week recovery cap: reduced EASY on ${session.day} from ${current.toFixed(
        1
      )} km to ${capped.toFixed(1)} km.`
    );
  }

  if (removedKm <= 0) return;

  for (let idx = 0; idx < lastWeek.sessions.length; idx += 1) {
    if (idx === raceIdx) continue;
    const session = lastWeek.sessions[idx];
    if (session.type !== "EASY") continue;

    const sDayIdx = dayIndex(session.day);
    if (sDayIdx < 0 || sDayIdx >= raceDayIdx) continue;

    const daysBeforeRace = raceDayIdx - sDayIdx;
    if (daysBeforeRace !== 1) continue;

    const current = round1(session.distanceKm || 0);
    const capped = round1(Math.min(current, preRaceDayCap));
    if (capped >= current) continue;

    setSessionDistanceKm(session, capped);
    removedKm = round1(removedKm + (current - capped));
    warnings.push(
      `Race week freshness cap: reduced EASY on ${session.day} from ${current.toFixed(
        1
      )} km to ${capped.toFixed(1)} km.`
    );
  }

  const preRaceEasyIdxs = lastWeek.sessions
    .map((s, idx) => ({ s, idx }))
    .filter(({ s, idx }) => {
      if (idx === raceIdx || s.type !== "EASY") return false;
      const d = dayIndex(s.day);
      if (d < 0 || d >= raceDayIdx) return false;
      return raceDayIdx - d > 1;
    })
    .sort((a, b) => dayIndex(b.s.day) - dayIndex(a.s.day))
    .map(({ idx }) => idx);

  for (const idx of preRaceEasyIdxs) {
    if (removedKm <= 0) break;

    const current = round1(lastWeek.sessions[idx].distanceKm || 0);
    const headroom = round1(preRaceCap - current);
    if (headroom <= 0) continue;

    const add = round1(Math.min(headroom, removedKm));
    setSessionDistanceKm(lastWeek.sessions[idx], current + add);
    removedKm = round1(removedKm - add);
  }

  if (removedKm > 0.1) {
    warnings.push(
      `Race week recovery left ${removedKm.toFixed(
        1
      )} km unallocated to keep post-race load conservative.`
    );
  }
}

function buildDaysView(sessions) {
  return DAY_ORDER.map((day) => {
    const daySessions = sessions.filter((s) => s.day === day);
    return {
      day,
      intent: daySessions.length ? "RUN" : "REST",
      title: daySessions.length ? daySessions[0].name : "Rest / no structured session",
      sessions: daySessions,
      sessionIds: daySessions.map((s) => s.sessionId),
      sessionsDerivedFromCanonical: true
    };
  });
}

function buildMetrics(sessions, weeklyTargetKm) {
  const plannedWeeklyKm = round1(sessions.reduce((sum, s) => sum + (s.distanceKm || 0), 0));
  const qualityKm = round1(
    sessions
      .filter((s) => TRAINING_QUALITY_TYPES.has(s.type))
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );
  const raceKm = round1(
    sessions
      .filter((s) => s.type === "RACE")
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );
  const longRunKm = round1(
    sessions
      .filter((s) => s.type === "LONG")
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );

  return {
    targetWeeklyKm: round1(weeklyTargetKm),
    plannedWeeklyKm,
    computedWeeklyKm: plannedWeeklyKm,
    driftKm: round1(weeklyTargetKm - plannedWeeklyKm),
    qualityKm,
    qualitySharePct: plannedWeeklyKm > 0 ? round1((qualityKm / plannedWeeklyKm) * 100) : 0,
    raceKm,
    raceSharePct: plannedWeeklyKm > 0 ? round1((raceKm / plannedWeeklyKm) * 100) : 0,
    longRunKm,
    longRunSharePct: plannedWeeklyKm > 0 ? round1((longRunKm / plannedWeeklyKm) * 100) : 0,
    sessionCountExpected: sessions.length,
    sessionCountMatchesRunDays: true
  };
}

function weekStartMondayOnOrAfter(isoDate) {
  const monday = weekStartMonday(isoDate);
  if (!monday) return null;
  const startDay = weekdayFromIso(isoDate);
  const startDayIdx = dayIndex(startDay);
  if (startDayIdx <= 0) return monday;
  return addDaysIso(monday, 7);
}

function attachCalendarDates(weeks, { targetDate, startDate, anchorMode } = {}) {
  if (!Array.isArray(weeks) || !weeks.length) return weeks;

  const mode = String(anchorMode || "").trim().toLowerCase();
  const preferStart = mode === "start";
  let firstWeekStart = null;

  if (preferStart && startDate) {
    firstWeekStart = weekStartMondayOnOrAfter(startDate);
  } else if (targetDate) {
    const raceWeekStart = weekStartMonday(targetDate);
    if (!raceWeekStart) return weeks;
    firstWeekStart = addDaysIso(raceWeekStart, -(weeks.length - 1) * 7);
  } else if (startDate) {
    firstWeekStart = weekStartMondayOnOrAfter(startDate);
  } else {
    return weeks;
  }
  if (!firstWeekStart) return weeks;

  return weeks.map((week, weekIdx) => {
    const weekStartDate = addDaysIso(firstWeekStart, weekIdx * 7);
    const weekEndDate = addDaysIso(weekStartDate, 6);

    const sessions = week.sessions.map((s) => {
      const offset = dayIndex(s.day);
      return { ...s, date: offset >= 0 ? addDaysIso(weekStartDate, offset) : null };
    });

    const days = week.days.map((d) => {
      const offset = dayIndex(d.day);
      const date = offset >= 0 ? addDaysIso(weekStartDate, offset) : null;
      const daySessions = sessions.filter((s) => s.day === d.day);

      return {
        ...d,
        date,
        sessions: daySessions,
        sessionIds: daySessions.map((s) => s.sessionId)
      };
    });

    return { ...week, weekStartDate, weekEndDate, sessions, days };
  });
}

function pickPreferredSupportRuns(candidates, desiredDaysBefore, raceDayIdx, count) {
  const remaining = candidates.slice();
  const picked = [];

  for (const targetDaysBefore of desiredDaysBefore) {
    if (!remaining.length || picked.length >= count) break;

    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const daysBefore = raceDayIdx - remaining[i].dayIdx;
      const score = Math.abs(daysBefore - targetDaysBefore);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      picked.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }
  }

  while (remaining.length && picked.length < count) {
    picked.push(remaining.pop());
  }

  return picked;
}

function buildQualityFamilyHints(profile, phase, weekNumber, qualityCount) {
  const goalKm = goalDistanceKm(profile?.goal?.distance) || 10;
  const focus = String(profile?.preferences?.trainingFocus || "balanced").toLowerCase();
  const isSpeedFocus = focus === "speed";
  const isEnduranceFocus = focus === "endurance";

  if (qualityCount <= 0) return [];

  if (phase === "deload") {
    return qualityCount === 1
      ? ["THRESHOLD"]
      : ["INTERVALS", "THRESHOLD"].slice(0, qualityCount);
  }

  if (phase === "taper") {
    if (goalKm <= 10) return qualityCount === 1 ? ["INTERVALS"] : ["INTERVALS", "THRESHOLD"];
    return qualityCount === 1 ? ["THRESHOLD"] : ["THRESHOLD", "INTERVALS"];
  }

  if (goalKm <= 5) {
    if (qualityCount === 1) return [isSpeedFocus ? "INTERVALS" : "THRESHOLD"];
    return weekNumber % 2 === 0 ? ["INTERVALS", "THRESHOLD"] : ["THRESHOLD", "INTERVALS"];
  }

  if (goalKm <= 10) {
    if (qualityCount === 1) return [weekNumber % 2 === 0 ? "INTERVALS" : "THRESHOLD"];
    if (isSpeedFocus) return ["INTERVALS", "THRESHOLD"];
    return weekNumber % 2 === 0 ? ["THRESHOLD", "INTERVALS"] : ["INTERVALS", "THRESHOLD"];
  }

  if (goalKm <= 21.2) {
    if (qualityCount === 1) return ["THRESHOLD"];
    if (isSpeedFocus) return ["INTERVALS", "THRESHOLD"];
    return ["THRESHOLD", "INTERVALS"];
  }

  if (goalKm <= 42.2) {
    if (qualityCount === 1) return ["THRESHOLD"];
    if (qualityCount === 2) {
      if (isSpeedFocus && weekNumber % 3 === 0) return ["INTERVALS", "THRESHOLD"];
      if (isEnduranceFocus) return ["THRESHOLD", "THRESHOLD"];
      return weekNumber % 4 === 0 ? ["INTERVALS", "THRESHOLD"] : ["THRESHOLD", "THRESHOLD"];
    }
    return ["THRESHOLD", "THRESHOLD", "INTERVALS"].slice(0, qualityCount);
  }

  if (qualityCount === 1) return ["THRESHOLD"];
  return ["THRESHOLD", "THRESHOLD"].slice(0, qualityCount);
}

function buildWorkoutSubtype(qType, profile, target, qualityIndex, qualityCount) {
  const goalKm = goalDistanceKm(profile?.goal?.distance) || 10;
  const phase = target.phase;
  const focus = String(profile?.preferences?.trainingFocus || "balanced").toLowerCase();

  if (qType === "INTERVALS") {
    if (phase === "taper") return "sharpen";
    if (phase === "deload") return "light";
    if (goalKm <= 5) return qualityIndex === 0 ? "speed" : "vo2";
    if (goalKm <= 10) return qualityIndex === 0 ? "vo2" : "speed";
    if (goalKm <= 21.2) return "10k_support";
    if (goalKm <= 42.2) return focus === "speed" ? "10k_support" : "economy";
    return "economy";
  }

  if (phase === "taper") return "controlled";
  if (phase === "deload") return "light";
  if (goalKm <= 5) return "tempo";
  if (goalKm <= 10) return qualityCount > 1 && qualityIndex === 0 ? "tempo" : "progression";
  if (goalKm <= 21.2) return focus === "endurance" ? "cruise" : "progression";
  if (goalKm <= 42.2) {
    return qualityCount > 1 && qualityIndex === 1 ? "steady_threshold" : "cruise";
  }
  return "steady_threshold";
}

function buildLongRunSubtype(profile, target) {
  const goalKm = goalDistanceKm(profile?.goal?.distance) || 10;
  const phase = target.phase;
  const weekNumber = target.weekNumber;
  const focus = String(profile?.preferences?.trainingFocus || "balanced").toLowerCase();

  if (phase === "taper" || phase === "deload") return "long_easy";

  if (goalKm <= 10) {
    if (weekNumber % 3 === 0) return "long_progressive";
    return "long_easy";
  }

  if (goalKm <= 21.2) {
    if (focus === "speed" && weekNumber % 4 === 0) return "long_fast_finish";
    if (weekNumber % 3 === 0) return "long_progressive";
    return "long_easy";
  }

  if (goalKm <= 42.2) {
    if (focus === "endurance" && weekNumber % 4 === 0) return "long_marathon_blocks";
    if (weekNumber % 3 === 0) return "long_fast_finish";
    if (weekNumber % 2 === 0) return "long_progressive";
    return "long_easy";
  }

  if (weekNumber % 3 === 0) return "long_steady";
  return "long_easy";
}

function classifyEasySubtypesForWeek(profile, target, easyDays, easyDistances) {
  const goalKm = goalDistanceKm(profile?.goal?.distance) || 10;
  const phase = String(target?.phase || "").toLowerCase();
  const focus = String(profile?.preferences?.trainingFocus || "balanced").toLowerCase();

  const items = easyDays.map((day, idx) => ({
    day,
    idx,
    distanceKm: round1(easyDistances[idx] || 0),
    subtype: "aerobic_easy"
  }));

  const out = new Map();
  if (!items.length) return out;

  if (phase === "taper") {
    let smallestIdx = 0;
    for (let i = 1; i < items.length; i += 1) {
      if (items[i].distanceKm < items[smallestIdx].distanceKm) smallestIdx = i;
    }

    items.forEach((item, i) => {
      out.set(item.day, i === smallestIdx ? "shakeout" : "aerobic_easy");
    });
    return out;
  }

  if (phase === "deload") {
    let largestIdx = 0;
    for (let i = 1; i < items.length; i += 1) {
      if (items[i].distanceKm > items[largestIdx].distanceKm) largestIdx = i;
    }

    items.forEach((item, i) => {
      out.set(item.day, i === largestIdx ? "aerobic_easy" : "recovery");
    });
    return out;
  }

  if (items.length === 1) {
    out.set(items[0].day, "aerobic_easy");
    return out;
  }

  let smallestIdx = 0;
  for (let i = 1; i < items.length; i += 1) {
    if (items[i].distanceKm < items[smallestIdx].distanceKm) smallestIdx = i;
  }
  items[smallestIdx].subtype = "recovery";

  if (items.length === 2) {
    items.forEach((item) => out.set(item.day, item.subtype));
    return out;
  }

  const canUseSteady =
    items.length >= 3 &&
    (goalKm > 10 || focus === "endurance" || focus === "speed");

  if (canUseSteady) {
    const candidates = items
      .map((item, itemIndex) => ({ ...item, itemIndex }))
      .filter((x) => x.itemIndex !== smallestIdx)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    if (candidates.length >= 2) {
      const steadyCandidate = candidates[candidates.length - 2];
      if (steadyCandidate && steadyCandidate.distanceKm >= 5.5) {
        items[steadyCandidate.itemIndex].subtype = "steady_easy";
      }
    }
  }

  items.forEach((item) => out.set(item.day, item.subtype));
  return out;
}

function relabelEasySessionsAfterBalancing({
  sessions,
  profile,
  target,
  paces,
  hrZones
}) {
  const easyEntries = sessions
    .map((session, idx) => ({ session, idx }))
    .filter(({ session }) => session.type === "EASY");

  if (!easyEntries.length) return;

  const easyDays = easyEntries.map(({ session }) => session.day);
  const easyDistances = easyEntries.map(({ session }) => round1(session.distanceKm || 0));
  const subtypeByDay = classifyEasySubtypesForWeek(profile, target, easyDays, easyDistances);

  easyEntries.forEach(({ session, idx }) => {
    const easySubtype = subtypeByDay.get(session.day) || "aerobic_easy";
    sessions[idx] = makeEasySession({
      weekNumber: target.weekNumber,
      ordinal: idx + 1,
      day: session.day,
      distanceKm: round1(session.distanceKm || 0),
      paces,
      hrZones,
      phase: target.phase,
      goalDistance: profile?.goal?.distance,
      trainingFocus: profile?.preferences?.trainingFocus,
      easySubtype
    });
  });
}

function rebalanceRaceWeekNonRaceSessions(lastWeek, raceIdx, paces, hrZones, config, warnings, profile) {
  const raceDayIdx = dayIndex(lastWeek.sessions[raceIdx]?.day);
  if (raceDayIdx < 0) return;

  const goalKm = goalDistanceKm(profile?.goal?.distance) || 10;
  const policy = buildRaceWeekSupportPolicy(goalKm, profile);

  const nonRaceIdxs = lastWeek.sessions
    .map((s, idx) => ({ s, idx }))
    .filter(({ idx }) => idx !== raceIdx)
    .map(({ idx }) => idx);

  if (!nonRaceIdxs.length) return;

  const meta = nonRaceIdxs.map((idx) => {
    const session = lastWeek.sessions[idx];
    const dIdx = dayIndex(session.day);
    const minKm = raceWeekMinKmForSession(dIdx, raceDayIdx, profile, config);

    return {
      idx,
      day: session.day,
      dayIdx: dIdx,
      currentKm: round1(session.distanceKm || 0),
      minKm: round1(minKm),
      isPostRace: dIdx > raceDayIdx,
      isDayBeforeRace: dIdx >= 0 && raceDayIdx - dIdx === 1,
      daysBeforeRace: dIdx >= 0 ? raceDayIdx - dIdx : 99
    };
  });

  const postRace = meta.filter((m) => m.isPostRace).sort((a, b) => a.dayIdx - b.dayIdx);
  const preRace = meta
    .filter((m) => !m.isPostRace && m.dayIdx < raceDayIdx)
    .sort((a, b) => a.dayIdx - b.dayIdx);

  const keepIdxs = new Set();

  const shakeout = preRace.find((m) => m.isDayBeforeRace);
  const preRaceNonShakeout = preRace.filter((m) => !m.isDayBeforeRace);

  let remainingPreSlots = policy.maxPreRaceSupportRuns;
  if (policy.allowShakeout && shakeout && remainingPreSlots > 0) {
    keepIdxs.add(shakeout.idx);
    remainingPreSlots -= 1;
  }

  const chosenSupports = pickPreferredSupportRuns(
    preRaceNonShakeout,
    policy.supportPreferenceDaysBefore,
    raceDayIdx,
    Math.max(0, remainingPreSlots)
  );

  chosenSupports.forEach((m) => keepIdxs.add(m.idx));
  postRace.slice(0, policy.maxPostRaceSupportRuns).forEach((m) => keepIdxs.add(m.idx));

  const desiredByIdx = new Map();

  const keptPreRace = preRace
    .filter((m) => keepIdxs.has(m.idx))
    .sort((a, b) => a.dayIdx - b.dayIdx);

  let nonShakeoutOrdinal = 0;
  keptPreRace.forEach((m) => {
    if (m.isDayBeforeRace) {
      const targetKm = round1(
        Math.min(
          Math.max(policy.shakeoutMinKm, m.minKm),
          Math.max(policy.shakeoutMinKm, policy.shakeoutCapKm)
        )
      );
      desiredByIdx.set(m.idx, targetKm);
      return;
    }

    const cap = nonShakeoutOrdinal === 0 ? policy.earlySupportCapKm : policy.lateSupportCapKm;
    const minAllowed = Math.max(m.minKm, 1.5);
    const current = Math.max(minAllowed, m.currentKm);
    desiredByIdx.set(m.idx, round1(Math.min(current, cap)));
    nonShakeoutOrdinal += 1;
  });

  const keptPostRace = postRace
    .filter((m) => keepIdxs.has(m.idx))
    .sort((a, b) => a.dayIdx - b.dayIdx);

  keptPostRace.forEach((m) => {
    desiredByIdx.set(m.idx, round1(Math.max(1.5, Math.min(m.currentKm, 3))));
  });

  const removeIdxs = new Set();

  meta.forEach((m) => {
    if (!keepIdxs.has(m.idx)) {
      removeIdxs.add(m.idx);
      warnings.push(`Race week pruning: removed EASY on ${m.day}.`);
    }
  });

  meta.forEach((m) => {
    if (removeIdxs.has(m.idx)) return;

    const original = lastWeek.sessions[m.idx];
    const km = round1(desiredByIdx.get(m.idx) ?? 0);
    const easySubtype = m.isDayBeforeRace
      ? "shakeout"
      : m.isPostRace
        ? "recovery"
        : "aerobic_easy";

    if (km <= 0.1) {
      removeIdxs.add(m.idx);
      warnings.push(`Race week pruning: removed EASY on ${original.day}.`);
      return;
    }

    lastWeek.sessions[m.idx] = makeEasySession({
      weekNumber: lastWeek.weekNumber,
      ordinal: m.idx + 1,
      day: original.day,
      distanceKm: km,
      paces,
      hrZones,
      phase: lastWeek.phase,
      goalDistance: profile?.goal?.distance,
      easySubtype
    });
  });

  if (removeIdxs.size) {
    lastWeek.sessions = lastWeek.sessions.filter((_, idx) => !removeIdxs.has(idx));
  }

  const finalNonRaceKm = round1(
    lastWeek.sessions
      .filter((s) => s.type !== "RACE")
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );

  const relaxedTargetNonRaceKm = round1(
    Array.from(desiredByIdx.values()).reduce((sum, km) => sum + km, 0)
  );
  const remainingDrift = round1(relaxedTargetNonRaceKm - finalNonRaceKm);

  if (Math.abs(remainingDrift) >= 0.5) {
    warnings.push(
      `Race week balancing left ${remainingDrift.toFixed(
        1
      )} km drift against relaxed support-run target.`
    );
  }
}

function insertRaceInLastWeek(weeks, profile, paces, hrZones, config, warnings) {
  if (!profile.goal.targetDate || !weeks.length) return weeks;

  const lastIdx = weeks.length - 1;
  const lastWeek = { ...weeks[lastIdx], sessions: [...weeks[lastIdx].sessions] };
  const raceDay = weekdayFromIso(profile.goal.targetDate);
  const targetDistanceKm = goalDistanceKm(profile.goal.distance) || 10;

  let replaceIdx = lastWeek.sessions.findIndex((s) => s.day === raceDay);
  if (replaceIdx < 0) {
    warnings.push(
      `goal.targetDate ${profile.goal.targetDate} is ${raceDay}, not in runDays. Replacing ${profile.availability.longRunDay} with race session.`
    );
    replaceIdx = lastWeek.sessions.findIndex((s) => s.day === profile.availability.longRunDay);
  }
  if (replaceIdx < 0) return weeks;

  const original = lastWeek.sessions[replaceIdx];
  lastWeek.sessions[replaceIdx] = makeRaceSession({
    weekNumber: lastWeek.weekNumber,
    ordinal: replaceIdx + 1,
    day: original.day,
    distanceKm: targetDistanceKm,
    paces,
    hrZones,
    warmupMin: config.workouts.warmupMin,
    cooldownMin: config.workouts.cooldownMin,
    goalDistance: profile.goal.distance
  });

  normalizeRaceSessionHeadline(lastWeek.sessions[replaceIdx], targetDistanceKm);

  for (let idx = 0; idx < lastWeek.sessions.length; idx += 1) {
    if (idx === replaceIdx) continue;

    const s = lastWeek.sessions[idx];
    if (
      s.type !== "INTERVALS" &&
      s.type !== "THRESHOLD" &&
      s.type !== "TEMPO" &&
      s.type !== "LONG"
    ) {
      continue;
    }

    const easyKm =
      s.type === "LONG"
        ? round1(Math.max(4, Math.min(s.distanceKm, targetDistanceKm * 0.5)))
        : round1(Math.max(3, s.distanceKm * 0.85));

    lastWeek.sessions[idx] = makeEasySession({
      weekNumber: lastWeek.weekNumber,
      ordinal: idx + 1,
      day: s.day,
      distanceKm: easyKm,
      paces,
      hrZones,
      phase: lastWeek.phase,
      goalDistance: profile.goal.distance,
      easySubtype: dayIndex(s.day) === dayIndex(raceDay) - 1 ? "shakeout" : "recovery"
    });

    warnings.push(`Race week adjustment: converted ${s.type} on ${s.day} to EASY.`);
  }

  rebalanceRaceWeekNonRaceSessions(lastWeek, replaceIdx, paces, hrZones, config, warnings, profile);

  replaceIdx = lastWeek.sessions.findIndex(
    (s) => s.type === "RACE" && s.day === original.day
  );

  if (replaceIdx >= 0) {
    applyRaceWeekRecoveryCaps(lastWeek, replaceIdx, config, warnings);
  }

  lastWeek.days = buildDaysView(lastWeek.sessions);
  lastWeek.metrics = buildMetrics(lastWeek.sessions, lastWeek.targets.weeklyKm);
  lastWeek.targets = {
    ...lastWeek.targets,
    longRunKm: lastWeek.metrics.longRunKm
  };

  if (replaceIdx >= 0) {
    lastWeek.race = {
      day: lastWeek.sessions[replaceIdx].day,
      date: profile.goal.targetDate,
      distanceKm: targetDistanceKm
    };
  }

  const next = [...weeks];
  next[lastIdx] = lastWeek;
  return next;
}

function generateWeeks(profile, config, paces, hrZones, warnings) {
  const weeklyTargets = buildWeeklyTargets(profile, config);
  const runDays = profile.availability.runDays;
  const longRunDay = profile.availability.longRunDay;
  const sessionsPerWeek = Number(profile?.availability?.sessionsPerWeek) || runDays.length || 4;
  const trainingFocus = String(profile?.preferences?.trainingFocus || "balanced").toLowerCase();
  const goalDistance = profile?.goal?.distance || "10K";

  return weeklyTargets.map((target) => {
    const qualityTarget = qualityDaysTargetForPhase(config, target.phase, runDays.length);
    const qualityDays = chooseQualityDays(runDays, longRunDay, qualityTarget);
    const easyDays = runDays.filter((d) => d !== longRunDay && !qualityDays.includes(d));
    const qualityTypePlan = buildQualityFamilyHints(
      profile,
      target.phase,
      target.weekNumber,
      qualityDays.length
    );
    const longSubtype = buildLongRunSubtype(profile, target);

    const allocated = allocateWeekDistances({
      weeklyKm: target.weeklyKm,
      longKm: target.longKm,
      phase: target.phase,
      qualityCount: qualityDays.length,
      easyCount: easyDays.length,
      config
    });

    const easySubtypeByDay = classifyEasySubtypesForWeek(
      profile,
      target,
      easyDays,
      allocated.easyDistances
    );

    let qCursor = 0;
    let eCursor = 0;

    const sessions = runDays.map((day, index) => {
      if (day === longRunDay) {
        return makeLongSession({
          weekNumber: target.weekNumber,
          ordinal: index + 1,
          day,
          distanceKm: allocated.longKm,
          phase: target.phase,
          paces,
          hrZones,
          goalDistance,
          trainingFocus,
          longSubtype
        });
      }

      if (qualityDays.includes(day)) {
        const qType =
          qualityTypePlan[qCursor] ||
          config.workouts.qualityOrder[qCursor % config.workouts.qualityOrder.length] ||
          "THRESHOLD";

        const qKm =
          allocated.qualityDistances[qCursor] ?? config.distribution.minQualitySessionKm;

        const workoutSubtype = buildWorkoutSubtype(
          qType,
          profile,
          target,
          qCursor,
          qualityDays.length
        );

        qCursor += 1;

        return makeQualitySession({
          weekNumber: target.weekNumber,
          ordinal: index + 1,
          day,
          distanceKm: qKm,
          qType,
          phase: target.phase,
          paces,
          hrZones,
          warmupMin: config.workouts.warmupMin,
          cooldownMin: config.workouts.cooldownMin,
          goalDistance,
          trainingFocus,
          sessionsPerWeek,
          qualityIndex: qCursor - 1,
          qualityCount: qualityDays.length,
          workoutSubtype
        });
      }

      const easyKm =
        allocated.easyDistances[eCursor] ?? config.distribution.minEasySessionKm;
      const easySubtype = easySubtypeByDay.get(day) || "aerobic_easy";

      eCursor += 1;

      return makeEasySession({
        weekNumber: target.weekNumber,
        ordinal: index + 1,
        day,
        distanceKm: easyKm,
        paces,
        hrZones,
        phase: target.phase,
        goalDistance,
        trainingFocus,
        easySubtype
      });
    });

    rebalanceWeekToTarget(sessions, target.weeklyKm, config, warnings, target.weekNumber);
    enforceLongRunDominance(sessions, config, warnings, target.weekNumber);
    relabelEasySessionsAfterBalancing({
      sessions,
      profile,
      target,
      paces,
      hrZones
    });

    const days = config.output.includeDayViews ? buildDaysView(sessions) : [];
    const metrics = buildMetrics(sessions, target.weeklyKm);

    const targets = {
      weekIndex: target.weekNumber,
      weeklyKm: target.weeklyKm,
      longRunKm: metrics.longRunKm,
      isDeload: target.phase === "deload",
      isTaper: target.phase === "taper",
      phase: String(target.phase).toUpperCase(),
      difficulty: profile.preferences.difficulty
    };

    return {
      weekIndex: target.weekNumber,
      weekNumber: target.weekNumber,
      phase: target.phase,
      runDays,
      sessions,
      days,
      metrics,
      targets
    };
  });
}

function inferCoreTemplateWeeksFromId(templateId) {
  const raw = String(templateId || "").trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/_(\d+)w(?:_|$)/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 2) return null;
  return Math.round(n);
}

function resolveCoreTemplateWeeks(profile, requestedWeeks) {
  const totalWeeks = Math.max(2, Number(requestedWeeks) || 10);
  if (!profile?.goal?.targetDate) return totalWeeks;

  const metaWeeks = Number(profile?.templateMeta?.weeks);
  const fromMeta = Number.isFinite(metaWeeks) && metaWeeks >= 2 ? Math.round(metaWeeks) : null;
  const fromId = inferCoreTemplateWeeksFromId(profile?.templateId);
  const resolved = fromMeta || fromId;

  if (!Number.isFinite(resolved) || resolved < 2) return totalWeeks;
  return Math.max(2, Math.min(totalWeeks, resolved));
}

function resolveFillerGenerationPhase(config, weekNumber, bridgeWeeks) {
  const total = Math.max(1, Number(bridgeWeeks) || 1);
  const deloadEvery = Math.max(3, Number(config?.phaseModel?.deloadEvery) || 4);
  const progress = total === 1 ? 1 : weekNumber / total;

  if (weekNumber < total && weekNumber % deloadEvery === 0) return "deload";
  if (progress < 0.35) return "base";
  return "build";
}

function buildFillerWeeks({
  profile,
  config,
  paces,
  hrZones,
  warnings,
  fillerWeeks,
  coreStartWeeklyKm,
  coreStartLongKm
}) {
  const bridgeWeeks = Math.max(0, Math.floor(Number(fillerWeeks) || 0));
  if (!bridgeWeeks) return [];

  const runDays = Array.isArray(profile?.availability?.runDays)
    ? profile.availability.runDays.slice()
    : [];
  if (!runDays.length) return [];

  const longRunDay = profile?.availability?.longRunDay || runDays[runDays.length - 1];
  const sessionsPerWeek = Number(profile?.availability?.sessionsPerWeek) || runDays.length || 4;
  const trainingFocus = String(profile?.preferences?.trainingFocus || "balanced").toLowerCase();
  const goalDistance = profile?.goal?.distance || "10K";

  let prevWeeklyKm = round1(
    clamp(
      Number(profile?.current?.weeklyKm) || 0,
      config.progression.minWeeklyKm,
      config.progression.maxWeeklyKm
    )
  );
  const startWeeklyKm = prevWeeklyKm;
  const targetWeeklyKm = round1(
    clamp(
      Number(coreStartWeeklyKm) || prevWeeklyKm,
      config.progression.minWeeklyKm,
      config.progression.maxWeeklyKm
    )
  );

  let prevLongKm = round1(
    clamp(
      Number(profile?.current?.longestRunKm) || (startWeeklyKm * 0.3),
      config.progression.longRunMinKm,
      Math.min(config.progression.longRunMaxKm, Math.max(config.progression.longRunMinKm, startWeeklyKm * 0.5))
    )
  );

  const startLongKm = prevLongKm;
  const targetLongKm = round1(
    clamp(
      Number(coreStartLongKm) || prevLongKm,
      config.progression.longRunMinKm,
      config.progression.longRunMaxKm
    )
  );

  const planQuality = String(profile?.preferences?.planQuality || "").toLowerCase();
  const highQualityPlan =
    planQuality === "high" && runDays.length >= 4 && !isEasyOrBeginnerProfile(profile);

  const weeks = [];

  for (let i = 0; i < bridgeWeeks; i += 1) {
    const weekNumber = i + 1;
    const progress = bridgeWeeks === 1 ? 0.8 : weekNumber / (bridgeWeeks + 1);

    const desiredWeeklyKm = round1(
      startWeeklyKm + (targetWeeklyKm - startWeeklyKm) * progress
    );

    const maxUp = round1(
      prevWeeklyKm *
        (1 + Math.min(0.1, Number(config?.progression?.maxWeeklyIncreasePct) || 0.1))
    );
    const maxDown = round1(
      prevWeeklyKm * (1 - Math.min(0.15, Math.max(0.08, Number(config?.progression?.deloadDropPct) * 0.4 || 0.1)))
    );

    let weeklyKm = round1(clamp(desiredWeeklyKm, maxDown, maxUp));
    weeklyKm = round1(
      clamp(weeklyKm, config.progression.minWeeklyKm, config.progression.maxWeeklyKm)
    );

    const baseLongPct = Number(config?.distribution?.longRunPctByPhase?.base ?? 0.3);
    const desiredLongByPct = round1(weeklyKm * clamp(baseLongPct - 0.02, 0.2, 0.42));
    const desiredLongByTrend = round1(
      startLongKm + (targetLongKm - startLongKm) * progress
    );
    const desiredLongKm = round1((desiredLongByPct + desiredLongByTrend) / 2);

    const longStep = clamp(
      desiredLongKm - prevLongKm,
      -1.2,
      Number(config?.progression?.maxLongRunIncreaseKm) || 1.6
    );

    const longKm = round1(
      clamp(
        prevLongKm + longStep,
        config.progression.longRunMinKm,
        Math.min(config.progression.longRunMaxKm, weeklyKm * 0.5)
      )
    );

    const fillerPhase = resolveFillerGenerationPhase(config, weekNumber, bridgeWeeks);
    let qualityTarget = qualityDaysTargetForPhase(config, fillerPhase, runDays.length);
    if (highQualityPlan && fillerPhase === "build") qualityTarget = Math.max(qualityTarget, 2);
    if (isEasyOrBeginnerProfile(profile)) qualityTarget = Math.min(qualityTarget, 1);

    const qualityDays = chooseQualityDays(runDays, longRunDay, qualityTarget);
    const easyDays = runDays.filter((d) => d !== longRunDay && !qualityDays.includes(d));
    const qualityTypePlan = buildQualityFamilyHints(
      profile,
      fillerPhase,
      weekNumber,
      qualityDays.length
    );

    const allocated = allocateWeekDistances({
      weeklyKm,
      longKm,
      phase: fillerPhase,
      qualityCount: qualityDays.length,
      easyCount: easyDays.length,
      config
    });

    const target = {
      weekNumber,
      phase: fillerPhase,
      weeklyKm,
      longKm: allocated.longKm
    };

    const longSubtype = buildLongRunSubtype(profile, target);

    const easySubtypeByDay = classifyEasySubtypesForWeek(
      profile,
      target,
      easyDays,
      allocated.easyDistances
    );

    let qualityCursor = 0;
    let easyCursor = 0;

    const sessions = runDays.map((day, index) => {
      if (day === longRunDay) {
        return makeLongSession({
          weekNumber,
          ordinal: index + 1,
          day,
          distanceKm: allocated.longKm,
          phase: fillerPhase,
          paces,
          hrZones,
          goalDistance,
          trainingFocus,
          longSubtype
        });
      }

      if (qualityDays.includes(day)) {
        const qType = qualityTypePlan[qualityCursor] || "THRESHOLD";
        const qKm =
          allocated.qualityDistances[qualityCursor] ?? config.distribution.minQualitySessionKm;

        const workoutSubtype = buildWorkoutSubtype(
          qType,
          profile,
          target,
          qualityCursor,
          qualityDays.length
        );
        qualityCursor += 1;

        return makeQualitySession({
          weekNumber,
          ordinal: index + 1,
          day,
          distanceKm: qKm,
          qType,
          phase: fillerPhase,
          paces,
          hrZones,
          warmupMin: config.workouts.warmupMin,
          cooldownMin: config.workouts.cooldownMin,
          goalDistance,
          trainingFocus,
          sessionsPerWeek,
          qualityIndex: qualityCursor - 1,
          qualityCount: qualityDays.length,
          workoutSubtype
        });
      }

      const easyKm =
        allocated.easyDistances[easyCursor] ?? config.distribution.minEasySessionKm;
      const easySubtype = easySubtypeByDay.get(day) || "aerobic_easy";
      easyCursor += 1;

      return makeEasySession({
        weekNumber,
        ordinal: index + 1,
        day,
        distanceKm: easyKm,
        paces,
        hrZones,
        phase: fillerPhase,
        goalDistance,
        trainingFocus,
        easySubtype
      });
    });

    rebalanceWeekToTarget(sessions, weeklyKm, config, warnings, weekNumber);
    enforceLongRunDominance(sessions, config, warnings, weekNumber);
    relabelEasySessionsAfterBalancing({
      sessions,
      profile,
      target,
      paces,
      hrZones
    });

    const fillerSessions = sessions.map((session) => ({
      ...session,
      isFillerSession: true,
      planStage: "filler"
    }));

    const days = config.output.includeDayViews ? buildDaysView(fillerSessions) : [];
    const metrics = buildMetrics(fillerSessions, weeklyKm);

    weeks.push({
      weekIndex: weekNumber,
      weekNumber,
      phase: "filler",
      fillerPhase,
      isFiller: true,
      runDays,
      sessions: fillerSessions,
      days,
      metrics,
      targets: {
        weekIndex: weekNumber,
        weeklyKm,
        longRunKm: metrics.longRunKm,
        isDeload: fillerPhase === "deload",
        isTaper: false,
        phase: "FILLER",
        difficulty: profile.preferences.difficulty
      }
    });

    prevWeeklyKm = metrics.plannedWeeklyKm;
    prevLongKm = metrics.longRunKm;
  }

  return weeks;
}

function offsetWeeks(weeks, offset, includeDayViews) {
  const shift = Number(offset) || 0;
  if (!shift) return weeks;

  return (Array.isArray(weeks) ? weeks : []).map((week, index) => {
    const originalWeekNumber =
      Number.isFinite(Number(week?.weekNumber)) ? Number(week.weekNumber) : index + 1;
    const weekNumber = originalWeekNumber + shift;

    const sessions = (Array.isArray(week?.sessions) ? week.sessions : []).map((session, sIdx) => {
      const sessionType = session?.type || session?.sessionType || "RUN";
      return {
        ...session,
        sessionId: makeSessionId(weekNumber, session?.day, sessionType, sIdx + 1)
      };
    });

    const days = includeDayViews ? buildDaysView(sessions) : [];

    return {
      ...week,
      weekIndex: weekNumber,
      weekNumber,
      sessions,
      days,
      targets: week?.targets
        ? { ...week.targets, weekIndex: weekNumber }
        : week?.targets
    };
  });
}

export function buildRunPlan(profile, config) {
  const requestedWeeks = Math.max(2, Number(profile?.goal?.planLengthWeeks) || 10);
  const coreTemplateWeeks = resolveCoreTemplateWeeks(profile, requestedWeeks);
  const bridgeWeeks =
    profile?.goal?.targetDate && requestedWeeks > coreTemplateWeeks
      ? requestedWeeks - coreTemplateWeeks
      : 0;

  const coreProfile =
    bridgeWeeks > 0
      ? {
          ...profile,
          goal: {
            ...profile.goal,
            planLengthWeeks: coreTemplateWeeks
          }
        }
      : profile;

  const {
    config: adaptedConfig,
    template,
    adaptationsApplied
  } = applyStockTemplate(coreProfile, config);

  const warnings = [];
  const paces = derivePaces(coreProfile);
  const hrZones = deriveHrZones(coreProfile);

  const coreWeeks = generateWeeks(coreProfile, adaptedConfig, paces, hrZones, warnings);
  let weeks = coreWeeks;

  if (bridgeWeeks > 0) {
    const filler = buildFillerWeeks({
      profile: coreProfile,
      config: adaptedConfig,
      paces,
      hrZones,
      warnings,
      fillerWeeks: bridgeWeeks,
      coreStartWeeklyKm: coreWeeks?.[0]?.targets?.weeklyKm,
      coreStartLongKm: coreWeeks?.[0]?.targets?.longRunKm
    });

    weeks = [
      ...filler,
      ...offsetWeeks(coreWeeks, filler.length, adaptedConfig.output.includeDayViews)
    ];

    warnings.push(
      `Inserted ${filler.length} bridge week(s) before the core stock block to cover time until plan start.`
    );
  }

  weeks = insertRaceInLastWeek(weeks, profile, paces, hrZones, adaptedConfig, warnings);

  if (adaptedConfig.output.includeSessionDates) {
    const anchorDateMode = String(profile?.goal?.anchorDateMode || "race").toLowerCase();
    weeks = attachCalendarDates(weeks, {
      targetDate: profile.goal.targetDate,
      startDate: profile.goal.startDate,
      anchorMode: anchorDateMode
    });

    if (anchorDateMode === "start" && profile.goal.targetDate) {
      const raceWeek = weeks[weeks.length - 1];
      const raceSession = Array.isArray(raceWeek?.sessions)
        ? raceWeek.sessions.find((s) => s.type === "RACE")
        : null;

      if (raceSession?.date && raceSession.date !== profile.goal.targetDate) {
        warnings.push(
          `Start-date anchoring mismatch: race session is dated ${raceSession.date}, while goal.targetDate is ${profile.goal.targetDate}. Increase or decrease planLengthWeeks to align exactly.`
        );
      }
    }
  }

  const finalAdaptations = [...adaptationsApplied];
  if (bridgeWeeks > 0) {
    finalAdaptations.push(`bridge_weeks:${bridgeWeeks}`);
    finalAdaptations.push(`core_template_weeks:${coreTemplateWeeks}`);
    finalAdaptations.push(`requested_weeks:${requestedWeeks}`);
  }

  return {
    id: null,
    name: adaptedConfig.planName,
    generatorVersion: "fresh-1.8.0",
    goal: profile.goal,
    template: {
      mode: "stock_adapted",
      id: template.id,
      name: template.name,
      goalDistance: template.goalDistance,
      sourceTemplateId: profile?.templateId || null,
      adaptationsApplied: finalAdaptations,
      bridge: {
        enabled: bridgeWeeks > 0,
        fillerWeeks: bridgeWeeks,
        coreTemplateWeeks,
        requestedWeeks
      }
    },
    weeks,
    paces,
    hrZones,
    rulesApplied: true,
    sessionContract: {
      canonicalPath: "weeks[].sessions",
      derivedPath: "weeks[].days[].sessions",
      idField: "sessionId"
    },
    decisionTrace: adaptedConfig.output.includeDecisionTrace
      ? {
          generator: "backend-fresh-stock-adapted",
          template: {
            id: template.id,
            name: template.name,
            goalDistance: template.goalDistance,
            sourceTemplateId: profile?.templateId || null,
            adaptationsApplied: finalAdaptations,
            bridge: {
              enabled: bridgeWeeks > 0,
              fillerWeeks: bridgeWeeks,
              coreTemplateWeeks,
              requestedWeeks
            }
          },
          phaseModel: adaptedConfig.phaseModel,
          progression: adaptedConfig.progression,
          distribution: adaptedConfig.distribution,
          warnings
        }
      : null
  };
}
