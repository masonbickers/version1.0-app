import { normaliseTrainingReadinessEntry } from "../../lib/train/readinessModel.js";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function prependLine(existing, line) {
  const nextLine = cleanText(line);
  const current = String(existing || "").trim();
  if (!nextLine) return current;
  if (current.toLowerCase().includes(nextLine.toLowerCase())) return current;
  return current ? `${nextLine}\n${current}` : nextLine;
}

function roundValue(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function scalePositive(value, factor, digits = 0, min = null) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return value;
  const scaled = roundValue(num * factor, digits);
  if (min == null) return scaled;
  return Math.max(min, scaled);
}

function normaliseDayLabel(day, fallback = "Mon") {
  const raw = String(day || "").trim();
  if (!raw) return fallback;
  const map = {
    monday: "Mon",
    mon: "Mon",
    tuesday: "Tue",
    tue: "Tue",
    wednesday: "Wed",
    wed: "Wed",
    thursday: "Thu",
    thu: "Thu",
    thur: "Thu",
    thurs: "Thu",
    friday: "Fri",
    fri: "Fri",
    saturday: "Sat",
    sat: "Sat",
    sunday: "Sun",
    sun: "Sun",
  };
  return map[raw.toLowerCase()] || raw || fallback;
}

function classifySegment(seg = {}) {
  const blob = [
    seg?.title,
    seg?.name,
    seg?.label,
    seg?.type,
    seg?.stepType,
    seg?.kind,
    seg?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(warm[\s-]?up|wu)\b/.test(blob)) return "warmup";
  if (/\b(cool[\s-]?down|cd)\b/.test(blob)) return "cooldown";
  if (/\b(recovery|recover|rest|walk|jog|float)\b/.test(blob)) return "rest";
  if (/\b(strength|lift|squat|bench|deadlift|press|row|lunge)\b/.test(blob)) return "strength";
  return "main";
}

function hasStrengthSignals(session = {}) {
  const blob = [
    session?.title,
    session?.name,
    session?.type,
    session?.sessionType,
    session?.focus,
    session?.emphasis,
    session?.notes,
    session?.workout?.sport,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(strength|gym|hypertrophy|upper|lower|bench|squat|deadlift|press|row|lift)\b/.test(blob)) {
    return true;
  }

  const segments = Array.isArray(session?.segments) ? session.segments : [];
  return segments.some((seg) => {
    const kind = classifySegment(seg);
    if (kind === "strength") return true;
    const sets = Number(seg?.sets ?? 0);
    const reps = Number(seg?.reps ?? seg?.repeatCount ?? 0);
    return sets > 0 || reps > 0;
  });
}

function classifySessionDemand(session = {}) {
  if (hasStrengthSignals(session)) return "strength";

  const blob = [
    session?.title,
    session?.name,
    session?.type,
    session?.sessionType,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(long run|long)\b/.test(blob)) return "long";
  if (/\b(recovery|easy|shakeout|mobility|rest)\b/.test(blob)) return "easy";
  if (/\b(interval|tempo|threshold|track|hill|vo2|max|speed|fartlek|race pace|progression)\b/.test(blob)) {
    return "quality";
  }

  return "aerobic";
}

function baseReductionFactor(preset, demand, ordinal) {
  const profile = {
    strong: {
      quality: [0.7, 0.82, 0.9],
      long: [0.78, 0.88, 0.94],
      easy: [0.88, 0.95, 1],
      aerobic: [0.84, 0.92, 0.98],
      strength: [0.74, 0.86, 0.92],
    },
    moderate: {
      quality: [0.8, 0.9, 1],
      long: [0.86, 0.92, 1],
      easy: [0.92, 0.97, 1],
      aerobic: [0.9, 0.95, 1],
      strength: [0.84, 0.92, 0.96],
    },
  };

  const presetMap = profile[preset] || profile.moderate;
  const steps = presetMap[demand] || presetMap.aerobic;
  const safeOrdinal = Math.max(0, Math.min(steps.length - 1, ordinal));
  return steps[safeOrdinal];
}

function paceRelaxMultiplier(preset, ordinal) {
  if (preset === "strong") return ordinal === 0 ? 1.06 : ordinal === 1 ? 1.04 : 1.02;
  return ordinal === 0 ? 1.04 : ordinal === 1 ? 1.02 : 1;
}

function adjustRunSegment(seg, options) {
  const kind = classifySegment(seg);
  const next = { ...seg };
  const factor = kind === "rest" ? 1.1 : kind === "warmup" || kind === "cooldown" ? 0.95 : options.factor;
  const relaxIntensity = options.demand === "quality" || options.demand === "long";
  const relaxMultiplier = paceRelaxMultiplier(options.preset, options.ordinal);

  if (Number.isFinite(Number(next?.durationMin)) && Number(next.durationMin) > 0) {
    next.durationMin = scalePositive(next.durationMin, factor, 0, 5);
  }
  if (Number.isFinite(Number(next?.distanceKm)) && Number(next.distanceKm) > 0) {
    next.distanceKm = scalePositive(next.distanceKm, factor, 1, 0.8);
  }
  if (Number.isFinite(Number(next?.durationValue)) && Number(next.durationValue) > 0) {
    const durationType = String(next?.durationType || "").toLowerCase();
    const digits = durationType.includes("distance") ? 1 : 0;
    const minValue = durationType.includes("distance") ? 0.4 : 3;
    next.durationValue = scalePositive(next.durationValue, factor, digits, minValue);
  }
  if (Number.isFinite(Number(next?.timeSec)) && Number(next.timeSec) > 0) {
    next.timeSec = scalePositive(next.timeSec, factor, 0, 120);
  }
  if (Number.isFinite(Number(next?.distanceM)) && Number(next.distanceM) > 0) {
    next.distanceM = scalePositive(next.distanceM, factor, 0, 300);
  }

  if (relaxIntensity && next?.targetValue && typeof next.targetValue === "object") {
    const minSecPerKm = Number(next?.targetValue?.minSecPerKm);
    const maxSecPerKm = Number(next?.targetValue?.maxSecPerKm);
    if (Number.isFinite(minSecPerKm) && minSecPerKm > 0) {
      next.targetValue = {
        ...next.targetValue,
        minSecPerKm: Math.round(minSecPerKm * relaxMultiplier),
      };
    }
    if (Number.isFinite(maxSecPerKm) && maxSecPerKm > 0) {
      next.targetValue = {
        ...next.targetValue,
        maxSecPerKm: Math.round(maxSecPerKm * relaxMultiplier),
      };
    }
    const maxBpm = Number(next?.targetValue?.maxBpm ?? next?.targetValue?.max);
    if (Number.isFinite(maxBpm) && maxBpm > 0) {
      next.targetValue = {
        ...next.targetValue,
        maxBpm: Math.max(90, Math.round(maxBpm - (options.preset === "strong" ? 8 : 5))),
      };
    }
  }

  if (relaxIntensity && next?.target && typeof next.target === "object") {
    const paceKey = String(next?.target?.paceKey || "").trim().toUpperCase();
    if (paceKey && paceKey !== "EASY" && paceKey !== "RECOVERY") {
      next.target = {
        ...next.target,
        paceKey: options.preset === "strong" && options.ordinal === 0 ? "RECOVERY" : "EASY",
      };
    }
  }

  if (relaxIntensity && next?.pace && typeof next.pace === "object") {
    const secPerKm = Number(next?.pace?.secPerKm);
    if (Number.isFinite(secPerKm) && secPerKm > 0) {
      next.pace = {
        ...next.pace,
        secPerKm: Math.round(secPerKm * relaxMultiplier),
      };
    }
  }

  if (relaxIntensity && next?.intensityTarget && typeof next.intensityTarget === "string") {
    next.intensityTarget = "Easy / controlled";
  }

  if (Array.isArray(next?.steps)) {
    next.steps = next.steps.map((inner) => adjustRunSegment(inner, options));
  }

  next.notes = prependLine(
    next.notes,
    options.preset === "strong"
      ? "Fatigue edit: keep this controlled and cut the work if effort rises fast."
      : "Fatigue edit: keep this smooth and avoid forcing quality today."
  );

  return next;
}

function adjustStrengthSegment(seg, options) {
  const kind = classifySegment(seg);
  const next = { ...seg };

  if (kind !== "warmup" && kind !== "cooldown" && kind !== "rest") {
    if (Number.isFinite(Number(next?.sets)) && Number(next.sets) > 0) {
      next.sets = Math.max(1, Math.round(Number(next.sets) * options.factor));
    }
    if (Number.isFinite(Number(next?.rpe)) && Number(next.rpe) > 0) {
      next.rpe = roundValue(Math.max(5, Number(next.rpe) - (options.preset === "strong" ? 1 : 0.5)), 1);
    }
  }

  const restSec = Number(next?.restSec ?? next?.restSeconds ?? next?.recoverySec ?? 0);
  if (Number.isFinite(restSec) && restSec > 0) {
    next.restSec = Math.round(restSec * (options.preset === "strong" ? 1.2 : 1.1));
  }

  next.notes = prependLine(
    next.notes,
    options.preset === "strong"
      ? "Fatigue edit: trim volume and leave more reps in reserve today."
      : "Fatigue edit: keep the work clean and slightly under your usual effort."
  );

  if (Array.isArray(next?.steps)) {
    next.steps = next.steps.map((inner) => adjustStrengthSegment(inner, options));
  }

  return next;
}

function buildSessionGuidance(readiness, demand, ordinal) {
  if (demand === "strength") {
    return ordinal === 0
      ? "Reduce top-end effort and leave the gym feeling fresher than you started."
      : "Keep the next lift controlled and avoid chasing load while readiness is down.";
  }
  if (demand === "quality") {
    return ordinal === 0
      ? "Turn this into controlled aerobic work today and stop early if the legs stay flat."
      : "Keep the next quality session softer than planned unless readiness rebounds.";
  }
  if (demand === "long") {
    return "Shorten the volume and keep the whole run honest-easy.";
  }
  return readiness.preset === "strong"
    ? "Keep this session low-stress while recovery catches up."
    : "Stay comfortable and avoid forcing the pace.";
}

function updateSession(session, options) {
  const demand = classifySessionDemand(session);
  const factor = baseReductionFactor(options.preset, demand, options.ordinal);
  const next = { ...session };
  const guidance = buildSessionGuidance(options.readiness, demand, options.ordinal);

  if (Number.isFinite(Number(next?.durationMin)) && Number(next.durationMin) > 0) {
    next.durationMin = scalePositive(next.durationMin, factor, 0, 15);
  }
  if (Number.isFinite(Number(next?.targetDurationMin)) && Number(next.targetDurationMin) > 0) {
    next.targetDurationMin = scalePositive(next.targetDurationMin, factor, 0, 15);
  }
  if (Number.isFinite(Number(next?.distanceKm)) && Number(next.distanceKm) > 0) {
    next.distanceKm = scalePositive(next.distanceKm, factor, 1, 1);
  }
  if (Number.isFinite(Number(next?.targetDistanceKm)) && Number(next.targetDistanceKm) > 0) {
    next.targetDistanceKm = scalePositive(next.targetDistanceKm, factor, 1, 1);
  }
  if (Number.isFinite(Number(next?.plannedDistanceKm)) && Number(next.plannedDistanceKm) > 0) {
    next.plannedDistanceKm = scalePositive(next.plannedDistanceKm, factor, 1, 1);
  }
  if (Number.isFinite(Number(next?.computedTotalKm)) && Number(next.computedTotalKm) > 0) {
    next.computedTotalKm = scalePositive(next.computedTotalKm, factor, 1, 1);
  }

  const noteLine =
    options.preset === "strong"
      ? `Readiness edit: ${guidance}`
      : `Readiness edit: ${guidance}`;
  next.notes = prependLine(next.notes, noteLine);
  next.focus = cleanText(next.focus) || (demand === "strength" ? "Reduced-fatigue session" : "Recovery-protected session");
  next.coaching = {
    ...(next?.coaching && typeof next.coaching === "object" ? next.coaching : {}),
    readinessEdit: noteLine,
    recoveryTarget: guidance,
  };
  next.readinessAdjustment = {
    kind: "short_horizon_fatigue",
    eventId: options.eventId,
    dateKey: options.readiness.dateKey,
    status: options.readiness.status,
    score: options.readiness.score,
    preset: options.preset,
    ordinal: options.ordinal,
    demand,
    reductionFactor: factor,
    appliedAtMs: options.now,
  };

  const segments = Array.isArray(next?.segments) ? next.segments : [];
  if (segments.length) {
    next.segments = segments.map((seg) =>
      demand === "strength"
        ? adjustStrengthSegment(seg, { ...options, factor })
        : adjustRunSegment(seg, { ...options, factor, demand })
    );
  }

  return {
    session: next,
    demand,
    factor,
    guidance,
  };
}

function collectUpcomingSessionRefs(weeks, startWeekIndex, startDayIndex, startSessionIndex, maxSessions) {
  const refs = [];
  const safeWeeks = Array.isArray(weeks) ? weeks : [];

  for (let weekIdx = Math.max(0, startWeekIndex); weekIdx < safeWeeks.length; weekIdx += 1) {
    const week = safeWeeks[weekIdx];
    const dayMap = new Map(
      (Array.isArray(week?.days) ? week.days : []).map((day) => [
        normaliseDayLabel(day?.day, "Mon"),
        day,
      ])
    );

    for (let dayIdx = 0; dayIdx < DAY_ORDER.length; dayIdx += 1) {
      if (weekIdx === startWeekIndex && dayIdx < startDayIndex) continue;
      const day = dayMap.get(DAY_ORDER[dayIdx]);
      const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
      for (let sessionIdx = 0; sessionIdx < sessions.length; sessionIdx += 1) {
        if (
          weekIdx === startWeekIndex &&
          dayIdx === startDayIndex &&
          sessionIdx < startSessionIndex
        ) {
          continue;
        }
        refs.push({
          weekIndex: weekIdx,
          dayIndex: dayIdx,
          sessionIndex: sessionIdx,
        });
        if (refs.length >= maxSessions) return refs;
      }
    }
  }

  return refs;
}

export function applyShortHorizonFatigueEdits({
  weeks,
  currentWeekIndex = 0,
  currentDayIndex = 0,
  currentSessionIndex = 0,
  readinessEntry,
  eventId,
  now = Date.now(),
  maxSessions = 3,
} = {}) {
  const readiness = normaliseTrainingReadinessEntry(readinessEntry || {});
  if (readiness.editPreset === "none") {
    return {
      applied: false,
      reasonCode: "readiness_not_actionable",
      readiness,
      weeks: Array.isArray(weeks) ? weeks : [],
      touchedSessions: [],
    };
  }

  const clonedWeeks = JSON.parse(JSON.stringify(Array.isArray(weeks) ? weeks : []));
  const refs = collectUpcomingSessionRefs(
    clonedWeeks,
    Math.max(0, Number(currentWeekIndex) || 0),
    Math.max(0, Number(currentDayIndex) || 0),
    Math.max(0, Number(currentSessionIndex) || 0),
    Math.max(1, Number(maxSessions) || 3)
  );

  const touchedSessions = [];

  refs.forEach((ref, ordinal) => {
    const week = clonedWeeks[ref.weekIndex];
    const day = Array.isArray(week?.days) ? week.days[ref.dayIndex] : null;
    const session = Array.isArray(day?.sessions) ? day.sessions[ref.sessionIndex] : null;
    if (!session || session?.readinessAdjustment?.dateKey === readiness.dateKey) return;

    const result = updateSession(session, {
      ordinal,
      preset: readiness.editPreset,
      readiness,
      eventId: String(eventId || "").trim() || null,
      now: Math.round(Number(now) || Date.now()),
    });

    day.sessions[ref.sessionIndex] = result.session;
    touchedSessions.push({
      ...ref,
      dayLabel: normaliseDayLabel(day?.day, DAY_ORDER[ref.dayIndex]),
      title: cleanText(result.session?.title || result.session?.name || result.session?.type || "Session"),
      demand: result.demand,
      reductionFactor: result.factor,
      guidance: result.guidance,
    });
  });

  clonedWeeks.forEach((week) => {
    const days = Array.isArray(week?.days) ? week.days : [];
    week.sessions = days.flatMap((day) =>
      (Array.isArray(day?.sessions) ? day.sessions : []).map((session) => ({
        ...session,
        day: normaliseDayLabel(day?.day, "Mon"),
      }))
    );
  });

  return {
    applied: touchedSessions.length > 0,
    reasonCode: touchedSessions.length ? null : "already_applied_today",
    readiness,
    preset: readiness.editPreset,
    weeks: clonedWeeks,
    touchedSessions,
  };
}
