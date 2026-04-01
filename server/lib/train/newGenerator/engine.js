import { deriveHrZones, derivePaces } from "./anchors.js";
import {
  DAYS,
  addDays,
  clamp,
  goalDistanceToKm,
  isoWeekStart,
  round1,
  roundInt,
  sessionId,
  weekdayAbbrevFromIso,
  weekdayIndex,
} from "./utils.js";

const QUALITY_TYPES = new Set(["INTERVALS", "THRESHOLD", "TEMPO", "RACE"]);

const INTERVAL_LIBRARY = [
  { id: "12x400m", reps: 12, workM: 400, recoverSec: 75, label: "12x400m (rec 75s)" },
  { id: "6x800m", reps: 6, workM: 800, recoverSec: 120, label: "6x800m (rec 2 min)" },
  { id: "4x1200m", reps: 4, workM: 1200, recoverSec: 150, label: "4x1200m (rec 150s)" },
  { id: "5x1000m", reps: 5, workM: 1000, recoverSec: 150, label: "5x1000m (rec 150s)" },
  { id: "3x1900m", reps: 3, workM: 1900, recoverSec: 180, label: "3x1900m (rec 3 min)" },
];

const THRESHOLD_LIBRARY = [
  { id: "20min_tempo", minutes: 20, label: "20 min tempo" },
  { id: "3x10min", reps: 3, workSec: 600, recoverSec: 90, label: "3x10 min (rec 90s)" },
  { id: "2x15min", reps: 2, workSec: 900, recoverSec: 90, label: "2x15 min (rec 90s)" },
  { id: "25min_progression", minutes: 25, label: "25 min progression" },
  { id: "12min_taper", minutes: 12, label: "12 min tempo" },
  { id: "2x3min_deload", reps: 2, workSec: 180, recoverSec: 60, label: "2x3 min (rec 1 min)" },
];

function phaseForWeek(weekNumber, totalWeeks, cfg) {
  const taperStart = Math.max(1, totalWeeks - cfg.phaseModel.taperWeeks + 1);
  if (weekNumber >= taperStart) return "taper";
  if (weekNumber <= cfg.phaseModel.baseWeeks) return "base";
  if (cfg.phaseModel.deloadEvery > 0 && weekNumber % cfg.phaseModel.deloadEvery === 0) return "deload";
  return "build";
}

function phaseUpper(phase) {
  return String(phase || "").toUpperCase();
}

function nextWeeklyTarget(prev, phase, cfg) {
  const {
    weeklyIncreasePct,
    maxWeeklyIncreasePct,
    deloadDropPct,
    taperDropPct,
    minWeeklyKm,
    maxWeeklyKm,
  } = cfg.progression;

  let next = prev;
  if (phase === "deload") next = prev * (1 - deloadDropPct);
  else if (phase === "taper") next = prev * (1 - taperDropPct);
  else next = prev * (1 + Math.min(weeklyIncreasePct, maxWeeklyIncreasePct));

  return round1(clamp(next, minWeeklyKm, maxWeeklyKm));
}

function buildWeekTargets(athleteProfile, config) {
  const totalWeeks = athleteProfile.goal.planLengthWeeks;
  const weeks = [];

  const firstWeeklyKm = round1(
    clamp(
      athleteProfile.current.weeklyKm,
      config.progression.minWeeklyKm,
      config.progression.maxWeeklyKm
    )
  );

  let prevWeeklyKm = firstWeeklyKm;
  let prevLongKm = athleteProfile.current.longestRunKm;

  for (let w = 1; w <= totalWeeks; w += 1) {
    const phase = phaseForWeek(w, totalWeeks, config);
    const weeklyKm = w === 1 ? firstWeeklyKm : nextWeeklyTarget(prevWeeklyKm, phase, config);

    const desiredLong = weeklyKm * (config.distribution.longRunPctByPhase[phase] ?? 0.3);
    const maxUp = phase === "build" || phase === "base" ? config.progression.maxLongRunIncreaseKm : 0.9;
    const maxDown = phase === "deload" || phase === "taper" ? 3 : 1.2;
    const step = clamp(desiredLong - prevLongKm, -maxDown, maxUp);
    let longRunKm = round1(prevLongKm + step);
    longRunKm = round1(
      clamp(
        longRunKm,
        6,
        Math.min(config.progression.longRunMaxKm, weeklyKm * 0.45)
      )
    );

    weeks.push({
      weekNumber: w,
      phase,
      weeklyKmTarget: weeklyKm,
      longRunKmTarget: longRunKm,
      qualityPctTarget: config.distribution.qualityPctByPhase[phase] ?? 0.25,
      longPctTarget: config.distribution.longRunPctByPhase[phase] ?? 0.3,
    });

    prevWeeklyKm = weeklyKm;
    prevLongKm = longRunKm;
  }

  return weeks;
}

function chooseQualityDays(runDays, longRunDay, config) {
  const available = runDays.filter((d) => d !== longRunDay);
  if (!available.length) return [];
  const desired = Math.min(config.distribution.qualityDaysPerWeek, available.length);
  return available.slice(0, desired);
}

function allocateDistances({ weekTargetKm, longRunKm, qualityCount, easyCount, phase, config }) {
  const minQ = config.distribution.minQualitySessionKm;
  const maxQ = config.distribution.maxQualitySessionKm;
  const minEasy = config.distribution.minEasySessionKm;
  const qualityPct = config.distribution.qualityPctByPhase[phase] ?? 0.25;

  let longKm = round1(longRunKm);
  let qualityTotalKm = round1(weekTargetKm * qualityPct);
  let perQualityKm = qualityCount ? clamp(qualityTotalKm / qualityCount, minQ, maxQ) : 0;
  qualityTotalKm = round1(perQualityKm * qualityCount);

  let remainingKm = round1(weekTargetKm - longKm - qualityTotalKm);
  let easyPerSessionKm = easyCount ? remainingKm / easyCount : 0;

  if (easyCount && easyPerSessionKm < minEasy) {
    const requiredForEasy = round1(minEasy * easyCount);
    const deficit = round1(requiredForEasy - remainingKm);
    const maxQualityCut = round1(Math.max(0, qualityTotalKm - qualityCount * minQ));
    const qualityCut = Math.min(deficit, maxQualityCut);

    qualityTotalKm = round1(qualityTotalKm - qualityCut);
    perQualityKm = qualityCount ? qualityTotalKm / qualityCount : 0;
    remainingKm = round1(weekTargetKm - longKm - qualityTotalKm);
    easyPerSessionKm = easyCount ? remainingKm / easyCount : 0;

    if (easyPerSessionKm < minEasy) {
      const stillShort = round1(requiredForEasy - remainingKm);
      const longCut = Math.min(stillShort, Math.max(0, longKm - 6));
      longKm = round1(longKm - longCut);
      remainingKm = round1(weekTargetKm - longKm - qualityTotalKm);
      easyPerSessionKm = easyCount ? remainingKm / easyCount : 0;
    }
  }

  const qualityDistances = Array.from({ length: qualityCount }, () => round1(perQualityKm));
  const easyDistances = Array.from({ length: easyCount }, () => round1(easyPerSessionKm));

  const total = round1(longKm + qualityDistances.reduce((s, v) => s + v, 0) + easyDistances.reduce((s, v) => s + v, 0));
  const drift = round1(weekTargetKm - total);
  if (Math.abs(drift) >= 0.1) {
    if (easyDistances.length) easyDistances[easyDistances.length - 1] = round1(easyDistances[easyDistances.length - 1] + drift);
    else longKm = round1(longKm + drift);
  }

  return {
    longKm,
    qualityDistances,
    easyDistances,
  };
}

function intervalVariantForWeek(weekNumber, phase) {
  if (phase === "deload") return { id: "3x800m", reps: 3, workM: 800, recoverSec: 160, label: "3x800m (rec 160s)" };
  if (phase === "taper") return { id: "3x900m", reps: 3, workM: 900, recoverSec: 160, label: "3x900m (rec 160s)" };
  return INTERVAL_LIBRARY[(weekNumber - 1) % INTERVAL_LIBRARY.length];
}

function thresholdVariantForWeek(weekNumber, phase) {
  if (phase === "deload") return THRESHOLD_LIBRARY.find((x) => x.id === "2x3min_deload");
  if (phase === "taper") return THRESHOLD_LIBRARY.find((x) => x.id === "12min_taper");
  if (phase === "base") return THRESHOLD_LIBRARY.find((x) => x.id === "20min_tempo");
  const buildOnly = THRESHOLD_LIBRARY.filter((x) => ["3x10min", "2x15min", "25min_progression"].includes(x.id));
  return buildOnly[(weekNumber - 1) % buildOnly.length];
}

function makeBaseSession({
  weekNumber,
  ordinal,
  day,
  type,
  name,
  distanceKm,
  notes,
  purpose,
  keyTargets,
  targetPace,
  targetHr,
  workout,
}) {
  return {
    sessionId: sessionId(weekNumber, day, type, ordinal),
    day,
    type,
    sessionType: type,
    workoutKind: type,
    name,
    distanceKm: round1(distanceKm),
    plannedDistanceKm: round1(distanceKm),
    distanceMeters: roundInt(distanceKm * 1000),
    notes,
    purpose,
    keyTargets,
    targetPace,
    targetHr,
    workout,
  };
}

function easyWorkout(distanceKm, paces, hrZones) {
  return {
    sport: "running",
    kind: "EASY",
    estimatedDistanceMeters: roundInt(distanceKm * 1000),
    paceTarget: paces.easy,
    hrTarget: hrZones?.zones?.z2 || null,
    steps: [
      {
        stepType: "steady",
        durationType: "distance",
        durationValue: roundInt(distanceKm * 1000),
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z2 || null,
      },
    ],
  };
}

function longWorkout(distanceKm, paces, hrZones) {
  return {
    sport: "running",
    kind: "LONG",
    estimatedDistanceMeters: roundInt(distanceKm * 1000),
    paceTarget: paces.easy,
    hrTarget: hrZones?.zones?.z2 || null,
    steps: [
      {
        stepType: "steady",
        durationType: "distance",
        durationValue: roundInt(distanceKm * 1000),
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z2 || null,
      },
    ],
  };
}

function intervalsWorkout(variant, distanceKm, paces, hrZones) {
  return {
    sport: "running",
    kind: "INTERVALS",
    variant: variant.id,
    estimatedDistanceMeters: roundInt(distanceKm * 1000),
    paceTarget: paces.interval,
    hrTarget: hrZones?.zones?.z4 || null,
    steps: [
      {
        stepType: "warmup",
        durationType: "time",
        durationValue: 900,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null,
      },
      {
        stepType: "repeat",
        repeatCount: variant.reps,
        steps: [
          {
            stepType: "steady",
            durationType: "distance",
            durationValue: variant.workM,
            targetType: "pace_range",
            targetValue: paces.interval,
          },
          {
            stepType: "recovery",
            durationType: "time",
            durationValue: variant.recoverSec,
            targetType: "hr_range",
            targetValue: hrZones?.zones?.z1 || null,
          },
        ],
      },
      {
        stepType: "cooldown",
        durationType: "time",
        durationValue: 600,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null,
      },
    ],
  };
}

function thresholdWorkout(variant, distanceKm, paces, hrZones) {
  const block =
    variant.reps && variant.workSec
      ? {
          stepType: "repeat",
          repeatCount: variant.reps,
          steps: [
            {
              stepType: "steady",
              durationType: "time",
              durationValue: variant.workSec,
              targetType: "pace_range",
              targetValue: paces.tempo,
            },
            {
              stepType: "recovery",
              durationType: "time",
              durationValue: variant.recoverSec || 90,
              targetType: "hr_range",
              targetValue: hrZones?.zones?.z1 || null,
            },
          ],
        }
      : {
          stepType: "steady",
          durationType: "time",
          durationValue: roundInt((variant.minutes || 20) * 60),
          targetType: "pace_range",
          targetValue: paces.tempo,
        };

  return {
    sport: "running",
    kind: "THRESHOLD",
    variant: variant.id,
    estimatedDistanceMeters: roundInt(distanceKm * 1000),
    paceTarget: paces.tempo,
    hrTarget: hrZones?.zones?.z3 || null,
    steps: [
      {
        stepType: "warmup",
        durationType: "time",
        durationValue: 900,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null,
      },
      block,
      {
        stepType: "cooldown",
        durationType: "time",
        durationValue: 600,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null,
      },
    ],
  };
}

function raceWorkout(distanceKm, paces, hrZones) {
  return {
    sport: "running",
    kind: "RACE",
    estimatedDistanceMeters: roundInt(distanceKm * 1000),
    paceTarget: {
      minSecPerKm: paces.raceSecPerKm,
      maxSecPerKm: paces.raceSecPerKm,
    },
    hrTarget: hrZones?.zones?.z4 || hrZones?.zones?.z5 || null,
    steps: [
      {
        stepType: "warmup",
        durationType: "time",
        durationValue: 900,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null,
      },
      {
        stepType: "race",
        durationType: "distance",
        durationValue: roundInt(distanceKm * 1000),
        targetType: "pace_range",
        targetValue: {
          minSecPerKm: paces.raceSecPerKm,
          maxSecPerKm: paces.raceSecPerKm,
        },
      },
      {
        stepType: "cooldown",
        durationType: "time",
        durationValue: 600,
        targetType: "hr_range",
        targetValue: hrZones?.zones?.z1 || null,
      },
    ],
  };
}

function buildWeekDaysView(weekSessions) {
  return DAYS.map((day) => {
    const sessions = weekSessions.filter((s) => s.day === day);
    return {
      day,
      intent: sessions.length ? "RUN" : "REST",
      title: sessions.length ? sessions[0].name : "Rest / no structured session",
      sessions,
      sessionIds: sessions.map((s) => s.sessionId),
      sessionsDerivedFromCanonical: true,
    };
  });
}

function weeklyMetrics(sessions, weeklyTargetKm) {
  const plannedWeeklyKm = round1(sessions.reduce((sum, s) => sum + (s.distanceKm || 0), 0));
  const qualityKm = round1(
    sessions
      .filter((s) => QUALITY_TYPES.has(s.type))
      .reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );
  const longRunKm = round1(
    sessions.filter((s) => s.type === "LONG").reduce((sum, s) => sum + (s.distanceKm || 0), 0)
  );
  return {
    targetWeeklyKm: round1(weeklyTargetKm),
    plannedWeeklyKm,
    qualityKm,
    qualitySharePct: plannedWeeklyKm > 0 ? round1((qualityKm / plannedWeeklyKm) * 100) : 0,
    longRunKm,
    longRunSharePct: plannedWeeklyKm > 0 ? round1((longRunKm / plannedWeeklyKm) * 100) : 0,
    driftKm: round1(weeklyTargetKm - plannedWeeklyKm),
    sessionCountExpected: sessions.length,
  };
}

function attachSessionDates(weeks, targetDate, includeSessionDates) {
  if (!includeSessionDates || !targetDate) return weeks;
  const raceWeekStart = isoWeekStart(targetDate);
  if (!raceWeekStart) return weeks;
  const firstWeekStart = addDays(raceWeekStart, -(weeks.length - 1) * 7);
  if (!firstWeekStart) return weeks;

  return weeks.map((week, idx) => {
    const weekStartDate = addDays(firstWeekStart, idx * 7);
    const weekEndDate = addDays(weekStartDate, 6);
    const sessions = week.sessions.map((s) => {
      const dayOffset = weekdayIndex(s.day);
      return {
        ...s,
        date: dayOffset >= 0 ? addDays(weekStartDate, dayOffset) : null,
      };
    });

    const days = week.days.map((d) => {
      const dayOffset = weekdayIndex(d.day);
      const date = dayOffset >= 0 ? addDays(weekStartDate, dayOffset) : null;
      return {
        ...d,
        date,
        sessions: sessions.filter((s) => s.day === d.day),
        sessionIds: sessions.filter((s) => s.day === d.day).map((s) => s.sessionId),
      };
    });

    return {
      ...week,
      weekStartDate,
      weekEndDate,
      sessions,
      days,
    };
  });
}

function applyRaceWeekRule(weeks, athleteProfile, paces, hrZones, warnings) {
  const targetDate = athleteProfile.goal.targetDate;
  if (!targetDate || !weeks.length) return weeks;

  const raceDay = weekdayAbbrevFromIso(targetDate);
  const lastIndex = weeks.length - 1;
  const lastWeek = { ...weeks[lastIndex] };
  const sessions = [...lastWeek.sessions];
  const goalDistanceKm = goalDistanceToKm(athleteProfile.goal.distance) || 10;

  let replaceIndex = sessions.findIndex((s) => s.day === raceDay);
  if (replaceIndex < 0) {
    warnings.push(
      `goal.targetDate (${targetDate}) is ${raceDay}, which is not in runDays. Replacing ${athleteProfile.availability.longRunDay} with race session.`
    );
    replaceIndex = sessions.findIndex((s) => s.day === athleteProfile.availability.longRunDay);
  }

  if (replaceIndex < 0) return weeks;

  const original = sessions[replaceIndex];
  sessions[replaceIndex] = makeBaseSession({
    weekNumber: lastWeek.weekNumber,
    ordinal: replaceIndex + 1,
    day: original.day,
    type: "RACE",
    name: `${athleteProfile.goal.distance} Race`,
    distanceKm: goalDistanceKm,
    notes: "Race day. Run by feel and execute your pacing plan.",
    purpose: "Goal event",
    keyTargets: `${athleteProfile.goal.distance} effort`,
    targetPace: {
      minSecPerKm: paces.raceSecPerKm,
      maxSecPerKm: paces.raceSecPerKm,
    },
    targetHr: hrZones?.zones?.z4 || hrZones?.zones?.z5 || null,
    workout: raceWorkout(goalDistanceKm, paces, hrZones),
  });

  const oldTotal = round1(lastWeek.sessions.reduce((sum, s) => sum + s.distanceKm, 0));
  const newTotal = round1(sessions.reduce((sum, s) => sum + s.distanceKm, 0));
  const delta = round1(oldTotal - newTotal);
  if (Math.abs(delta) >= 0.1) {
    const easyIndex = sessions.findIndex((s) => s.type === "EASY");
    if (easyIndex >= 0) {
      sessions[easyIndex] = {
        ...sessions[easyIndex],
        distanceKm: round1(Math.max(2, sessions[easyIndex].distanceKm + delta)),
        plannedDistanceKm: round1(Math.max(2, sessions[easyIndex].plannedDistanceKm + delta)),
        distanceMeters: roundInt(Math.max(2, sessions[easyIndex].distanceKm + delta) * 1000),
        workout: easyWorkout(Math.max(2, sessions[easyIndex].distanceKm + delta), paces, hrZones),
      };
    }
  }

  lastWeek.sessions = sessions;
  lastWeek.days = buildWeekDaysView(sessions);
  lastWeek.metrics = weeklyMetrics(sessions, lastWeek.targets.weeklyKm);
  lastWeek.race = {
    day: sessions[replaceIndex].day,
    date: targetDate,
    distanceKm: goalDistanceKm,
  };

  const next = [...weeks];
  next[lastIndex] = lastWeek;
  return next;
}

export function generateRunPlanV2({ athleteProfile, generatorConfig }) {
  const paces = derivePaces(athleteProfile);
  const hrZones = deriveHrZones(athleteProfile);
  const warnings = [];

  const weekTargets = buildWeekTargets(athleteProfile, generatorConfig);
  const runDays = athleteProfile.availability.runDays;
  const longRunDay = athleteProfile.availability.longRunDay;

  const weeks = weekTargets.map((target) => {
    const qualityDays = chooseQualityDays(runDays, longRunDay, generatorConfig);
    const easyDays = runDays.filter((d) => d !== longRunDay && !qualityDays.includes(d));
    const distances = allocateDistances({
      weekTargetKm: target.weeklyKmTarget,
      longRunKm: target.longRunKmTarget,
      qualityCount: qualityDays.length,
      easyCount: easyDays.length,
      phase: target.phase,
      config: generatorConfig,
    });

    let qualityCursor = 0;
    let easyCursor = 0;
    const sessions = runDays.map((day, idx) => {
      if (day === longRunDay) {
        const km = distances.longKm;
        return makeBaseSession({
          weekNumber: target.weekNumber,
          ordinal: idx + 1,
          day,
          type: "LONG",
          name: "Long run",
          distanceKm: km,
          notes:
            target.phase === "deload"
              ? "Keep this long run comfortable and easy."
              : target.phase === "taper"
                ? "Keep this long run comfortable and easy. No heroics."
                : "Easy effort throughout. Keep it relaxed and comfortable.",
          purpose: "Aerobic endurance",
          keyTargets: "Easy all the way",
          targetPace: paces.easy,
          targetHr: hrZones?.zones?.z2 || null,
          workout: longWorkout(km, paces, hrZones),
        });
      }

      if (qualityDays.includes(day)) {
        const qType = generatorConfig.workouts.qualityOrder[qualityCursor % generatorConfig.workouts.qualityOrder.length];
        const qKm = distances.qualityDistances[qualityCursor] ?? generatorConfig.distribution.minQualitySessionKm;
        qualityCursor += 1;

        if (qType === "INTERVALS") {
          const variant = intervalVariantForWeek(target.weekNumber, target.phase);
          return makeBaseSession({
            weekNumber: target.weekNumber,
            ordinal: idx + 1,
            day,
            type: "INTERVALS",
            name: "Intervals",
            distanceKm: qKm,
            notes: `Warm up 15 min easy. Main set: ${variant.label}. Cool down 10 min easy.`,
            purpose: "Speed / VO2 / economy",
            keyTargets: variant.label,
            targetPace: paces.interval,
            targetHr: hrZones?.zones?.z4 || null,
            workout: intervalsWorkout(variant, qKm, paces, hrZones),
          });
        }

        const variant = thresholdVariantForWeek(target.weekNumber, target.phase);
        return makeBaseSession({
          weekNumber: target.weekNumber,
          ordinal: idx + 1,
          day,
          type: "THRESHOLD",
          name: "Threshold",
          distanceKm: qKm,
          notes: `Warm up 15 min easy. Main set: ${variant.label}. Cool down 10 min easy.`,
          purpose: "Controlled hard / aerobic power",
          keyTargets: variant.label,
          targetPace: paces.tempo,
          targetHr: hrZones?.zones?.z3 || null,
          workout: thresholdWorkout(variant, qKm, paces, hrZones),
        });
      }

      const easyKm = distances.easyDistances[easyCursor] ?? generatorConfig.distribution.minEasySessionKm;
      easyCursor += 1;
      return makeBaseSession({
        weekNumber: target.weekNumber,
        ordinal: idx + 1,
        day,
        type: "EASY",
        name: "Easy run",
        distanceKm: easyKm,
        notes: "Easy effort. Keep it relaxed.",
        purpose: "Aerobic base + recovery",
        keyTargets: "Easy pace range",
        targetPace: paces.easy,
        targetHr: hrZones?.zones?.z2 || null,
        workout: easyWorkout(easyKm, paces, hrZones),
      });
    });

    const metrics = weeklyMetrics(sessions, target.weeklyKmTarget);
    const targets = {
      weekIndex: target.weekNumber,
      weeklyKm: target.weeklyKmTarget,
      longRunKm: target.longRunKmTarget,
      isDeload: target.phase === "deload",
      isTaper: target.phase === "taper",
      phase: phaseUpper(target.phase),
      difficulty: athleteProfile.preferences.difficulty,
      progression: {
        qualityPctTarget: round1(target.qualityPctTarget * 100),
        longRunPctTarget: round1(target.longPctTarget * 100),
      },
    };

    return {
      weekIndex: target.weekNumber,
      weekNumber: target.weekNumber,
      phase: target.phase,
      runDays,
      sessions,
      days: buildWeekDaysView(sessions),
      metrics,
      targets,
    };
  });

  const withRaceWeek = applyRaceWeekRule(weeks, athleteProfile, paces, hrZones, warnings);
  const datedWeeks = attachSessionDates(
    withRaceWeek,
    athleteProfile.goal.targetDate,
    generatorConfig.output.includeSessionDates
  );

  const decisionTrace = generatorConfig.output.includeDecisionTrace
    ? {
        generator: "new_generator_v2",
        phaseModel: generatorConfig.phaseModel,
        progression: generatorConfig.progression,
        distribution: generatorConfig.distribution,
        warnings,
      }
    : null;

  return {
    id: null,
    name: generatorConfig.name,
    generatorVersion: "2.0.0",
    goal: {
      distance: athleteProfile.goal.distance,
      planLengthWeeks: athleteProfile.goal.planLengthWeeks,
      targetDate: athleteProfile.goal.targetDate,
    },
    weeks: datedWeeks,
    paces,
    hrZones,
    rulesApplied: true,
    sessionContract: {
      canonicalPath: "weeks[].sessions",
      derivedPath: "weeks[].days[].sessions",
      idField: "sessionId",
    },
    decisionTrace,
  };
}

