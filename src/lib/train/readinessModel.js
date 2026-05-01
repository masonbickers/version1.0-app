export const TRAINING_READINESS_MODEL_VERSION = 1;
export const TRAINING_READINESS_COLLECTION = "trainingReadiness";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, digits = null) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!Number.isFinite(digits)) return num;
  return Number(num.toFixed(digits));
}

function toBool(value) {
  return value === true;
}

function cleanText(value, maxLen = 320) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trim()}…` : text;
}

function safeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === "function") {
    try {
      const next = value.toDate();
      if (next instanceof Date && !Number.isNaN(next.getTime())) return next;
    } catch {}
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalDateKey(value = new Date()) {
  const date = safeDate(value) || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftDateKey(dateKey, deltaDays = 0) {
  const base = safeDate(`${String(dateKey || "").trim()}T12:00:00`);
  if (!base) return toLocalDateKey();
  base.setDate(base.getDate() + Math.round(Number(deltaDays) || 0));
  return toLocalDateKey(base);
}

function scoreReasons(entry = {}) {
  let score = 72;
  const reasonCodes = [];
  const flags = {
    poorSleep: false,
    lowEnergy: false,
    highStress: false,
    highSoreness: false,
    injuryConcern: false,
    illness: false,
    heavyCarryover: false,
  };

  const sleepHours = toNumber(entry.sleepHours, 1);
  const sleepQuality = toNumber(entry.sleepQuality);
  const mood = toNumber(entry.mood);
  const stress = toNumber(entry.stress);
  const energy = toNumber(entry.energy);
  const sorenessScore = toNumber(entry.sorenessScore);
  const sessionRpe = toNumber(entry.sessionRpe, 1);

  if (sleepHours != null) {
    if (sleepHours < 5) {
      score -= 18;
      reasonCodes.push("very_low_sleep");
      flags.poorSleep = true;
    } else if (sleepHours < 6) {
      score -= 12;
      reasonCodes.push("low_sleep");
      flags.poorSleep = true;
    } else if (sleepHours < 7) {
      score -= 6;
      reasonCodes.push("slightly_low_sleep");
    } else if (sleepHours >= 8) {
      score += 4;
    }
  }

  if (sleepQuality != null) {
    score += ({ 1: -10, 2: -6, 3: 0, 4: 3, 5: 5 }[sleepQuality] ?? 0);
    if (sleepQuality <= 2) {
      reasonCodes.push("poor_sleep_quality");
      flags.poorSleep = true;
    }
  }

  if (energy != null) {
    score += ({ 1: -16, 2: -9, 3: 0, 4: 4, 5: 7 }[energy] ?? 0);
    if (energy <= 2) {
      reasonCodes.push("low_energy");
      flags.lowEnergy = true;
    }
  }

  if (stress != null) {
    score += ({ 1: 3, 2: 1, 3: 0, 4: -6, 5: -11 }[stress] ?? 0);
    if (stress >= 4) {
      reasonCodes.push("high_stress");
      flags.highStress = true;
    }
  }

  if (sorenessScore != null) {
    score += ({ 1: 2, 2: 0, 3: -6, 4: -14, 5: -22 }[sorenessScore] ?? 0);
    if (sorenessScore >= 4) {
      reasonCodes.push("high_soreness");
      flags.highSoreness = true;
    }
  }

  if (mood != null) {
    score += ({ 1: -6, 2: -3, 3: 0, 4: 2, 5: 4 }[mood] ?? 0);
    if (mood <= 2) reasonCodes.push("low_mood");
  }

  if (toBool(entry.painInjury)) {
    score -= 22;
    flags.injuryConcern = true;
    reasonCodes.push("pain_or_injury");
  }

  if (toBool(entry.illness)) {
    score -= 24;
    flags.illness = true;
    reasonCodes.push("illness");
  }

  if (toBool(entry.travel)) {
    score -= 6;
    reasonCodes.push("travel");
  }

  if (toBool(entry.alcohol)) {
    score -= 3;
    reasonCodes.push("alcohol");
  }

  if (toBool(entry.caffeineLate)) {
    score -= 3;
    reasonCodes.push("late_caffeine");
  }

  if (toBool(entry.screensLate)) {
    score -= 2;
    reasonCodes.push("late_screens");
  }

  if (toBool(entry.workStress)) {
    score -= 2;
    reasonCodes.push("work_stress");
  }

  if (toBool(entry.lifeStress)) {
    score -= 3;
    reasonCodes.push("life_stress");
  }

  if (toBool(entry.trainedToday) && sessionRpe != null) {
    if (sessionRpe >= 9) {
      score -= 10;
      flags.heavyCarryover = true;
      reasonCodes.push("very_hard_recent_session");
    } else if (sessionRpe >= 8) {
      score -= 6;
      flags.heavyCarryover = true;
      reasonCodes.push("hard_recent_session");
    }
  }

  score = clamp(Math.round(score), 0, 100);

  const status =
    score >= 78 ? "good" : score >= 60 ? "ok" : score >= 42 ? "caution" : "low";
  const editPreset = status === "low" ? "strong" : status === "caution" ? "moderate" : "none";

  let headline = "Ready to train";
  let guidance = "Proceed as planned.";

  if (status === "ok") {
    headline = "Mostly ready";
    guidance = "Keep the session controlled if anything feels flat in the first 10-15 minutes.";
  } else if (status === "caution") {
    headline = "Readiness is down";
    guidance =
      "Use a lighter version of the next 1-2 sessions and keep today aerobic if effort rises too quickly.";
  } else if (status === "low") {
    headline = "Recovery should lead today";
    guidance =
      "Shift the next couple of sessions down, trim volume, and avoid forcing quality under fatigue.";
  }

  const summaryBits = [];
  if (flags.poorSleep) summaryBits.push("sleep is low");
  if (flags.lowEnergy) summaryBits.push("energy is down");
  if (flags.highStress) summaryBits.push("stress is elevated");
  if (flags.highSoreness) summaryBits.push("soreness is high");
  if (flags.injuryConcern) summaryBits.push("pain/injury is flagged");
  if (flags.illness) summaryBits.push("illness is flagged");
  if (flags.heavyCarryover) summaryBits.push("recent load is still carrying over");

  return {
    score,
    status,
    editPreset,
    headline,
    guidance,
    summary:
      summaryBits.length > 0
        ? `${headline}: ${summaryBits.join(", ")}.`
        : `${headline}: no major readiness flags were captured.`,
    reasonCodes,
    flags,
  };
}

export function normaliseTrainingReadinessEntry(entry = {}, overrides = {}) {
  const dateKey =
    cleanText(overrides?.dateKey || entry?.dateKey || toLocalDateKey(entry?.date), 24) ||
    toLocalDateKey();
  const date = safeDate(entry?.date) || safeDate(`${dateKey}T12:00:00`);
  const derived = scoreReasons({ ...entry, ...overrides });

  return {
    version: TRAINING_READINESS_MODEL_VERSION,
    dateKey,
    date: date ? date.toISOString() : `${dateKey}T12:00:00.000Z`,
    source: cleanText(overrides?.source || entry?.source || "journal", 40) || "journal",
    sleepHours: toNumber(overrides?.sleepHours ?? entry?.sleepHours, 1),
    sleepQuality: toNumber(overrides?.sleepQuality ?? entry?.sleepQuality),
    mood: toNumber(overrides?.mood ?? entry?.mood),
    stress: toNumber(overrides?.stress ?? entry?.stress),
    energy: toNumber(overrides?.energy ?? entry?.energy),
    sorenessScore: toNumber(overrides?.sorenessScore ?? entry?.sorenessScore),
    alcohol: toBool(overrides?.alcohol ?? entry?.alcohol),
    caffeineLate: toBool(overrides?.caffeineLate ?? entry?.caffeineLate),
    screensLate: toBool(overrides?.screensLate ?? entry?.screensLate),
    travel: toBool(overrides?.travel ?? entry?.travel),
    illness: toBool(overrides?.illness ?? entry?.illness),
    painInjury: toBool(overrides?.painInjury ?? entry?.painInjury),
    workStress: toBool(overrides?.workStress ?? entry?.workStress),
    lifeStress: toBool(overrides?.lifeStress ?? entry?.lifeStress),
    trainedToday: toBool(overrides?.trainedToday ?? entry?.trainedToday),
    sessionRpe: toNumber(overrides?.sessionRpe ?? entry?.sessionRpe, 1),
    stuckToPlan: toBool(overrides?.stuckToPlan ?? entry?.stuckToPlan),
    notes: cleanText(overrides?.notes ?? entry?.notes ?? entry?.eveningNote, 320),
    score: derived.score,
    status: derived.status,
    editPreset: derived.editPreset,
    headline: derived.headline,
    guidance: derived.guidance,
    summary: derived.summary,
    reasonCodes: derived.reasonCodes,
    flags: derived.flags,
    updatedAtMs:
      Math.round(
        Number(
          overrides?.updatedAtMs ??
            entry?.updatedAtMs ??
            safeDate(entry?.updatedAt)?.getTime() ??
            Date.now()
        )
      ) || Date.now(),
  };
}

export function buildTrainingReadinessEntryFromJournalEntry(entry = {}, options = {}) {
  return normaliseTrainingReadinessEntry(
    {
      ...entry,
      source: options?.source || "journal",
      notes: cleanText(options?.notes || entry?.eveningNote || entry?.notes, 320),
    },
    options
  );
}

export function isTrainingReadinessActionable(entry) {
  const readiness = normaliseTrainingReadinessEntry(entry || {});
  return readiness.editPreset !== "none";
}

export function isTrainingReadinessFresh(entry, now = Date.now()) {
  const readiness = normaliseTrainingReadinessEntry(entry || {});
  const date = safeDate(readiness.date);
  if (!date) return false;
  return Math.abs(Number(now) - date.getTime()) <= DAY_MS * 1.5;
}
