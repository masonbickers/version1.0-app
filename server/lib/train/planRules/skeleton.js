// server/lib/train/planRules/skeleton.js
import { getPlanSpec } from "./planSpecs/index.js";
import {
  DAY_ORDER as SHARED_DAY_ORDER,
  chooseLongRunDay as chooseLongRunDayShared,
  clampInt as clampIntShared,
  ensureRunDaysCount as ensureRunDaysCountShared,
  normaliseDayAbbrev as normaliseDayAbbrevShared,
  normaliseDifficultyKey,
  normaliseExperienceLabel,
  normaliseGoalDistanceKey,
  normalisePlanLengthWeeks,
  normaliseProgressionDifficulty,
  normaliseSessionsPerWeek,
  uniqOrderedDays as uniqOrderedDaysShared,
} from "./normalization.js";
import { RULES } from "./rulesConfig.js";

const DAY_ORDER = SHARED_DAY_ORDER;

function clampInt(n, lo, hi) {
  return clampIntShared(n, lo, hi);
}

function normaliseDayAbbrev(day) {
  return normaliseDayAbbrevShared(day);
}

function uniqOrderedDays(days) {
  return uniqOrderedDaysShared(days);
}

function ensureRunDaysCount(runDays, sessionsPerWeek) {
  return ensureRunDaysCountShared(runDays, sessionsPerWeek);
}

function forceIncludeDay(runDays, requiredDay, n) {
  const days = uniqOrderedDays(runDays);
  const req = normaliseDayAbbrev(requiredDay);

  if (!req) return ensureRunDaysCount(days, n);

  let out = days.includes(req) ? [...days] : uniqOrderedDays([...days, req]);

  while (out.length > n) {
    const idx = out.findIndex((d) => d !== req);
    if (idx === -1) break;
    out.splice(idx, 1);
  }

  out = ensureRunDaysCount(out, n);

  if (!out.includes(req)) {
    out = uniqOrderedDays([...out, req]);
    while (out.length > n) {
      const idx = out.findIndex((d) => d !== req);
      if (idx === -1) break;
      out.splice(idx, 1);
    }
  }

  out.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return out;
}

function chooseLongRunDay(longRunDay, runDays) {
  return chooseLongRunDayShared(longRunDay, runDays);
}

function pickRunDays({ runDaysRaw, availableDaysRaw, sessionsPerWeek, longRunDay }) {
  const n = normaliseSessionsPerWeek(sessionsPerWeek);

  const raw =
    Array.isArray(runDaysRaw) && runDaysRaw.length ? runDaysRaw : availableDaysRaw;

  let runDays = uniqOrderedDays(raw);
  runDays = ensureRunDaysCount(runDays, n);

  const lr = chooseLongRunDay(longRunDay, runDays);
  if (lr) runDays = forceIncludeDay(runDays, lr, n);

  return runDays;
}

// -----------------------------
// difficulty-aware hard day targets
// -----------------------------
function normaliseDifficulty(difficulty) {
  return normaliseProgressionDifficulty(difficulty);
}

function baseHardFromRules(experience) {
  // ✅ support both old + new keys
  return (
    RULES?.maxHardSessionsByExperience?.[experience] ??
    RULES?.hardDaysPerWeekByExperience?.[experience] ??
    RULES?.maxHardSessionsByExperience?.["Some experience"] ??
    RULES?.hardDaysPerWeekByExperience?.["Some experience"] ??
    1
  );
}

function computeHardDaysTarget({ experience, difficulty, sessionsPerWeek }) {
  const base = baseHardFromRules(experience);

  const diff = normaliseDifficulty(difficulty);
  const spw = normaliseSessionsPerWeek(sessionsPerWeek);

  let target = base;

  if (diff === "conservative") target = 1;
  if (diff === "standard") target = Math.max(1, target);
  if (diff === "aggressive") target = Math.max(target, spw >= 4 ? 2 : 1);
  if (diff === "elite") target = Math.max(target, spw >= 4 ? 2 : 1);

  // Safety: never exceed (spw - 1)
  target = Math.min(target, Math.max(1, spw - 1));
  return clampInt(target, 1, 3);
}

// -----------------------------
// spacing helpers (quality day selection)
// -----------------------------
function dayIndex(d) {
  return DAY_ORDER.indexOf(d);
}

function gapDays(a, b) {
  const ia = dayIndex(a);
  const ib = dayIndex(b);
  if (ia < 0 || ib < 0) return 99;
  return Math.abs(ia - ib);
}

function chooseQualitySlots({ orderedRunDays, longRunDay, desiredSlots }) {
  const lr = chooseLongRunDay(longRunDay, orderedRunDays);
  const nonLong = orderedRunDays.filter((d) => d !== lr);

  const minGap = clampInt(RULES?.spacing?.minGapDaysBetweenHard ?? 1, 1, 6);

  if (!desiredSlots || desiredSlots <= 0) return [];
  if (!nonLong.length) return [];

  // Prefer classic Tue/Thu patterns if possible
  const preferPairs = [
    ["Tue", "Thu"],
    ["Tue", "Fri"],
    ["Wed", "Fri"],
    ["Mon", "Thu"],
  ];

  const isOk = (d, chosen = []) => {
    if (!nonLong.includes(d)) return false;
    if (lr && gapDays(d, lr) <= minGap) return false;
    for (const c of chosen) {
      if (gapDays(d, c) <= minGap) return false;
    }
    return true;
  };

  if (desiredSlots >= 2 && nonLong.length >= 2) {
    for (const [a, b] of preferPairs) {
      if (isOk(a, []) && isOk(b, [a])) return [a, b];
    }

    // Relax LR rule if we must, still keep hard-hard spacing
    const isOkRelaxLR = (d, chosen = []) => {
      if (!nonLong.includes(d)) return false;
      for (const c of chosen) {
        if (gapDays(d, c) <= minGap) return false;
      }
      return true;
    };

    const midPref = ["Tue", "Wed", "Thu", "Fri"];
    let first = midPref.find((d) => isOk(d, [])) || midPref.find((d) => isOkRelaxLR(d, [])) || nonLong[0];

    let second =
      [...midPref].reverse().find((d) => isOk(d, [first])) ||
      [...midPref].reverse().find((d) => isOkRelaxLR(d, [first])) ||
      nonLong.find((d) => d !== first && gapDays(d, first) > minGap) ||
      nonLong.find((d) => d !== first) ||
      null;

    return [first, second].filter(Boolean).slice(0, 2);
  }

  // One quality slot
  const mid = ["Tue", "Wed", "Thu", "Fri"];
  const best =
    mid.find((d) => isOk(d, [])) ||
    mid.find((d) => nonLong.includes(d)) ||
    nonLong[0];

  return [best].filter(Boolean);
}

// -----------------------------
// intents
// -----------------------------
function rankRunDays(runDays, longRunDay) {
  const lr = chooseLongRunDay(longRunDay, runDays);
  const ordered = uniqOrderedDays(runDays);
  return { ordered, lr };
}

function buildDayIntents({ runDays, longRunDay, sessionsPerWeek, difficulty, experience, spec }) {
  const diff = normaliseDifficulty(difficulty);
  const { ordered, lr } = rankRunDays(runDays, longRunDay);
  const spw = normaliseSessionsPerWeek(sessionsPerWeek || ordered.length || null);

  const byDay = {};
  for (const d of ordered) {
    byDay[d] = { intent: "EASY_SUPPORT", priority: "C", tags: [] };
  }

  if (lr && byDay[lr]) {
    byDay[lr].intent = "LONG_PRIMARY";
    byDay[lr].priority = "A";
    byDay[lr].tags.push("longRunDay");
  }

  const hardTarget = computeHardDaysTarget({
    experience: experience || "Some experience",
    difficulty: diff,
    sessionsPerWeek: spw,
  });

  const specId = String(spec?.id || spec?.name || "").toUpperCase();
  const isUltraLike = specId.includes("ULTRA");

  const desiredQualitySlots = isUltraLike ? Math.min(hardTarget, 2) : hardTarget;

  const qualitySlots = chooseQualitySlots({
    orderedRunDays: ordered,
    longRunDay: lr,
    desiredSlots: desiredQualitySlots,
  });

  for (let i = 0; i < qualitySlots.length; i++) {
    const d = qualitySlots[i];
    if (!byDay[d]) continue;

    if (i === 0) {
      byDay[d].intent = isUltraLike ? "HILLS_PRIMARY" : "INTERVALS_PRIMARY";
      byDay[d].priority = "A";
      byDay[d].tags.push("quality", isUltraLike ? "hills" : "speed");
    } else {
      byDay[d].intent = "THRESHOLD_PRIMARY";
      byDay[d].priority = "A";
      byDay[d].tags.push("quality", "threshold");
    }
  }

  const firstSupport = ordered.find((d) => byDay[d]?.intent === "EASY_SUPPORT") || ordered[0];
  if (firstSupport && byDay[firstSupport]) byDay[firstSupport].tags.push("strides_optional");

  if ((diff === "aggressive" || diff === "elite") && spw >= 4 && lr && byDay[lr]) {
    byDay[lr].tags.push("quality_optional");
  }

  return byDay;
}

// -----------------------------
// Week phase assignment (deterministic model)
// BASE -> BUILD, with scheduled DELOAD and final TAPER.
// -----------------------------
function derivePhaseForWeek({ weekIndex, planLengthWeeks, taperLastNWeeks }) {
  const W = Math.max(1, Number(planLengthWeeks) || 1);
  const i = Math.max(1, Number(weekIndex) || 1);

  const taperWeeks =
    clampInt(taperLastNWeeks ?? RULES?.taper?.lastNWeeksDefault ?? 1, 1, 6);

  const isTaper = i > W - taperWeeks;
  if (isTaper) return "TAPER";

  const deloadEvery = clampInt(RULES?.deload?.everyNWeeks ?? 4, 2, 8);
  if (i % deloadEvery === 0) return "DELOAD";

  const nonTaperWeeks = Math.max(1, W - taperWeeks);
  const baseEnd = Math.max(1, Math.round(nonTaperWeeks * 0.25));
  if (i <= baseEnd) return "BASE";
  return "BUILD";
}

export function buildSkeleton(inputs = {}) {
  const experience = normaliseExperienceLabel(
    inputs?.experience ?? "Some experience"
  );
  const difficulty = normaliseDifficultyKey(
    inputs?.difficulty ?? "balanced"
  );

  const sessionsPerWeek = normaliseSessionsPerWeek(
    inputs?.sessionsPerWeek ?? null
  );

  const longRunDay = inputs?.longRunDay ?? "Sun";

  const runDaysRaw = inputs?.runDays ?? [];
  const availableDaysRaw = inputs?.availableDays ?? [];

  const planLengthWeeks = normalisePlanLengthWeeks(
    inputs?.planLengthWeeks ?? null
  );

  const goalDistance = normaliseGoalDistanceKey(
    inputs?.goalDistance ?? "10K",
    { fallback: "10K" }
  );
  const spec = getPlanSpec(goalDistance);

  const runDays = pickRunDays({
    runDaysRaw,
    availableDaysRaw,
    sessionsPerWeek,
    longRunDay,
  });

  const hardDaysTarget = computeHardDaysTarget({
    experience,
    difficulty,
    sessionsPerWeek,
  });

  const dayIntents = buildDayIntents({
    runDays,
    longRunDay,
    sessionsPerWeek,
    difficulty,
    experience,
    spec,
  });

  const taperLastNWeeks =
    inputs?.taperLastNWeeks ?? null;

  const weeks = [];
  for (let w = 1; w <= planLengthWeeks; w++) {
    const phase = derivePhaseForWeek({
      weekIndex: w,
      planLengthWeeks,
      taperLastNWeeks,
    });

    const days = DAY_ORDER.map((day) => {
      const meta = dayIntents[day] || null;

      return {
        day,
        sessions: [],
        isRunDay: runDays.includes(day),
        intent: meta?.intent || (runDays.includes(day) ? "RUN" : "REST"),
        priority: meta?.priority || (runDays.includes(day) ? "C" : "D"),
        tags: Array.isArray(meta?.tags) ? [...meta.tags] : [],
      };
    });

    const weekHints = {
      difficulty: normaliseDifficulty(difficulty),
      qualityHint: hardDaysTarget >= 2 ? "two_quality_days" : "one_quality_day",
      specId: spec?.id || null,
      goalDistance: String(goalDistance || ""),
    };

    weeks.push({
      weekIndex: w,
      week: w,
      phase,
      hardDaysTarget,
      runDays: [...runDays],
      days,
      sessions: [],
      hints: weekHints,
      specId: spec?.id || null,
      _spec: spec || null,
    });
  }

  return { weeks, spec };
}
