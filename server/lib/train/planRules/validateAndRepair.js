// server/lib/train/planRules/validateAndRepair.js
import { RULES } from "./rulesConfig.js";
import { normaliseGoalPolicyKey } from "./normalization.js";

const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LR_MIN = RULES?.longRun?.minKm ?? 6;
const LR_MAX = RULES?.longRun?.maxKmDefault ?? RULES?.longRun?.maxKm ?? 32;

// --------- helpers ---------
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function roundToWholeMinuteSec(sec) {
  const s = Number(sec || 0);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.round(s / 60) * 60;
}

function unwrapWeeks(maybe) {
  if (Array.isArray(maybe)) return maybe;
  if (maybe && Array.isArray(maybe.weeks)) return maybe.weeks;
  return [];
}

/**
 * OPTION A distance normalisation:
 * Truth order:
 *  1) plannedDistanceKm
 *  2) distanceKm
 *  3) distanceMeters / 1000
 *  4) distance
 */
function normaliseDistanceFields(s) {
  if (!s || typeof s !== "object") return s;

  const planned =
    typeof s?.plannedDistanceKm === "number"
      ? s.plannedDistanceKm
      : toNumber(s?.plannedDistanceKm);

  const dk =
    typeof s?.distanceKm === "number" ? s.distanceKm : toNumber(s?.distanceKm);

  const dm =
    typeof s?.distanceMeters === "number"
      ? s.distanceMeters
      : toNumber(s?.distanceMeters);

  const dist =
    typeof s?.distance === "number" ? s.distance : toNumber(s?.distance);

  let km =
    planned != null
      ? planned
      : dk != null
      ? dk
      : dm != null
      ? dm / 1000
      : dist != null
      ? dist
      : null;

  if (km == null) return s;

  const fixedKm = round1(Math.max(0, km));
  const fixedMeters = Math.round(fixedKm * 1000);

  return {
    ...s,
    plannedDistanceKm: fixedKm,
    distanceKm: fixedKm,
    distance: fixedKm,
    distanceMeters: fixedMeters,
  };
}

function normaliseKindForRules(x) {
  const mode = String(RULES?.normaliseCase || "").toUpperCase();
  const s = String(x || "").trim();
  if (mode === "UPPER") return s.toUpperCase();
  if (mode === "LOWER") return s.toLowerCase();
  return s;
}

function getSessionKind(session = {}) {
  const raw =
    session?.workoutKind ||
    session?.type ||
    session?.sessionType ||
    session?.workout?.kind ||
    session?.workout?.type ||
    "";
  return normaliseKindForRules(raw);
}

function kindUpper(session) {
  return String(getSessionKind(session) || "").toUpperCase();
}

function isLong(session = {}) {
  const t = kindUpper(session);
  return ["LONG", "LONGRUN"].includes(t);
}

function isStrides(session = {}) {
  return kindUpper(session) === "STRIDES";
}

function isHard(session = {}) {
  if (!session) return false;

  const kU = kindUpper(session);

  // STRIDES should NOT be hard by default.
  if (kU === "STRIDES") return false;

  const commonU = ["QUALITY", "INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE"];

  const configuredU = Array.isArray(RULES?.hardSessionTypes)
    ? RULES.hardSessionTypes.map((x) => String(x || "").trim().toUpperCase())
    : [];

  if (commonU.includes(kU) || configuredU.includes(kU)) return true;

  if (RULES?.longRunCountsAsHard && isLong(session)) return true;

  return false;
}

// Meaningful steps: warmup+cooldown-only is NOT structured.
// Also: warmup+steady+cooldown is NOT treated as a "structured main set".
function hasMeaningfulSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return false;

  const types = steps.map((s) => String(s?.stepType || "").toLowerCase());
  const hasRepeat = types.includes("repeat");
  const hasSteady = types.includes("steady");

  if (hasRepeat) return true;
  if (hasSteady && steps.length > 3) return true;

  const hasWarmup = types.includes("warmup");
  const hasCooldown = types.includes("cooldown");
  if (hasWarmup && hasCooldown && steps.length <= 2) return false;

  return hasWarmup && hasCooldown && steps.length > 2;
}

function hasStructuredWorkout(session = {}) {
  const stepsA = hasMeaningfulSteps(session?.steps);
  const stepsB = hasMeaningfulSteps(session?.workout?.steps);
  const blocks = Array.isArray(session?.workout?.blocks) && session.workout.blocks.length > 0;
  return !!(stepsA || stepsB || blocks);
}

function sessionPriorityScore(session = {}) {
  const k = kindUpper(session);

  if (k === "INTERVALS") return 100;
  if (k === "THRESHOLD") return 95;
  if (k === "TEMPO") return 90;
  if (k === "RACEPACE") return 85;
  if (k === "HILLS") return 80;
  if (k === "QUALITY") return 75;

  if (k === "LONG" || k === "LONGRUN") return 60;

  if (k === "STRIDES") return 20;
  if (k === "EASY") return 10;

  return 0;
}

function ensureWorkoutShell(s) {
  const base = normaliseDistanceFields(s);

  const kind = String(
    base?.workout?.kind || base?.workoutKind || base?.sessionType || base?.type || "EASY"
  ).toUpperCase();

  const budgetMeters =
    typeof base?.distanceMeters === "number"
      ? base.distanceMeters
      : typeof base?.plannedDistanceKm === "number"
      ? Math.round(base.plannedDistanceKm * 1000)
      : typeof base?.distanceKm === "number"
      ? Math.round(base.distanceKm * 1000)
      : null;

  const est =
    typeof base?.workout?.estimatedDistanceMeters === "number"
      ? base.workout.estimatedDistanceMeters
      : typeof budgetMeters === "number"
      ? budgetMeters
      : null;

  return {
    ...base,
    workoutKind: String(base?.workoutKind || kind).toUpperCase(),
    workout: {
      sport: base?.workout?.sport || "running",
      kind,
      estimatedDistanceMeters: est,
      ...(base?.workout?.variant ? { variant: base.workout.variant } : {}),
      ...(base?.workout?.title ? { title: base.workout.title } : {}),
      ...(base?.workout?.notes ? { notes: base.workout.notes } : {}),
      ...(base?.workout?.keyTargets ? { keyTargets: base.workout.keyTargets } : {}),
      ...(Number.isFinite(Number(base?.workout?.warmupSec)) ? { warmupSec: Math.max(0, Math.round(Number(base.workout.warmupSec))) } : {}),
      ...(Number.isFinite(Number(base?.workout?.cooldownSec)) ? { cooldownSec: Math.max(0, Math.round(Number(base.workout.cooldownSec))) } : {}),
      ...(Array.isArray(base?.workout?.steps) ? { steps: base.workout.steps } : {}),
      ...(Array.isArray(base?.workout?.blocks) ? { blocks: base.workout.blocks } : {}),
      ...(base?.workout?.tempo ? { tempo: base.workout.tempo } : {}),
      ...(base?.workout?.legacy ? { legacy: base.workout.legacy } : {}),
      ...(base?.workout?.preserveTemplateStructure === true ? { preserveTemplateStructure: true } : {}),
      ...(base?.workout?.meta ? { meta: base.workout.meta } : {}),
    },
  };
}

// ---- tempo blocks parity repair ----
function sumTempoWorkSecFromBlocks(blocks = []) {
  let sum = 0;

  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== "object") continue;
    const t = String(b.type || "").toUpperCase();

    if (t === "CONTINUOUS") {
      sum += Number(b?.work?.valueSec || 0);
      continue;
    }

    if (t === "REPEAT") {
      const reps = Number(b?.repeatCount || 0);
      const sec = Number(b?.work?.valueSec || 0);
      sum += reps * sec;
      continue;
    }

    if (t === "PROGRESSION") {
      const segs = Array.isArray(b?.segments) ? b.segments : [];
      for (const s of segs) sum += Number(s?.work?.valueSec || 0);
      continue;
    }

    if (t === "ALTERNATIONS") {
      const reps = Number(b?.repeatCount || 0);
      sum += reps * Number(b?.on?.valueSec || 0);
      continue;
    }

    if (t === "OVER_UNDER") {
      const reps = Number(b?.repeatCount || 0);
      sum += reps * (Number(b?.over?.valueSec || 0) + Number(b?.under?.valueSec || 0));
      continue;
    }
  }

  return Math.max(0, Math.round(sum));
}

function repairTempoBlueprintParity(session) {
  const k = kindUpper(session);
  if (k !== "TEMPO" && k !== "THRESHOLD") return session;

  const w = session?.workout && typeof session.workout === "object" ? session.workout : null;
  if (!w) return session;

  const blocks = Array.isArray(w?.blocks) ? w.blocks : null;
  if (!blocks || !blocks.length) return session;

  const sumWork = roundToWholeMinuteSec(sumTempoWorkSecFromBlocks(blocks));
  if (!sumWork) return session;

  const existing = Number(w?.tempo?.valueSec || 0) || 0;
  const fixed = roundToWholeMinuteSec(existing) || 0;

  if (fixed === sumWork) return session;

  return {
    ...session,
    workout: {
      ...w,
      kind: k,
      tempo: { type: "TIME", valueSec: sumWork },
    },
    notes: `${session?.notes || ""}${session?.notes ? " " : ""}(Validator: synced tempo work to blocks)`.trim(),
  };
}

function downgradeToEasy(s, noteSuffix) {
  const originalKind = getSessionKind(s);
  const originalName = s?.name || "";
  const suffix = `${noteSuffix || ""}${originalKind ? ` (was ${originalKind})` : ""}`.trim();

  const keyTargets = s?.keyTargets || (originalKind ? `Originally: ${originalKind}` : "");

  const km =
    typeof s?.plannedDistanceKm === "number"
      ? s.plannedDistanceKm
      : typeof s?.distanceKm === "number"
      ? s.distanceKm
      : toNumber(s?.distanceKm) || 0;

  const fixedKm = round1(Math.max(0.5, km));

  const base = normaliseDistanceFields({
    ...s,
    type: "EASY",
    sessionType: "EASY",
    workoutKind: "EASY",
    wasKind: originalKind || undefined,
    wasName: originalName || undefined,
    wasWorkout: s?.workout || undefined,
    wasSteps: s?.steps || undefined,
    name: "Easy run",
    plannedDistanceKm: fixedKm,
    distanceKm: fixedKm,
    distance: fixedKm,
    distanceMeters: Math.round(fixedKm * 1000),
    workout: {
      sport: "running",
      kind: "EASY",
      estimatedDistanceMeters: Math.round(fixedKm * 1000),
    },
    steps: undefined,
    keyTargets,
    notes: `${s?.notes || ""}${s?.notes ? " " : ""}${suffix}`.trim(),
  });

  return ensureWorkoutShell(base);
}

function pickLongDayFromSkeleton(sk, sessions) {
  const explicit = sk?.longRunDay;
  if (explicit && ORDER.includes(explicit)) return explicit;

  const runDays = Array.isArray(sk?.runDays) ? sk.runDays.filter((d) => ORDER.includes(d)) : [];
  if (runDays.length) return runDays.includes("Sun") ? "Sun" : runDays[runDays.length - 1];

  const flagged = Array.isArray(sk?.days)
    ? sk.days.filter((d) => d?.isRunDay).map((d) => d?.day).filter((d) => ORDER.includes(d))
    : [];

  if (flagged.length) return flagged.includes("Sun") ? "Sun" : flagged[flagged.length - 1];

  if (sessions?.some((s) => s?.day === "Sun")) return "Sun";
  return "Sun";
}

function buildPrimaryByDayAndExtras(sessions = []) {
  const primaryByDay = new Map();
  const extras = [];

  for (const s of sessions) {
    const d = String(s?.day || "").trim();
    if (!ORDER.includes(d)) {
      extras.push(s);
      continue;
    }

    if (!primaryByDay.has(d)) {
      primaryByDay.set(d, s);
      continue;
    }

    const curPrimary = primaryByDay.get(d);
    const curScore = sessionPriorityScore(curPrimary);
    const newScore = sessionPriorityScore(s);

    if (newScore > curScore) {
      extras.push(curPrimary);
      primaryByDay.set(d, s);
    } else {
      extras.push(s);
    }
  }

  return { primaryByDay, extras };
}

function buildWeekDaysCanonical({ sessions = [], runDays = [] }) {
  const byDay = new Map();
  for (const d of ORDER) byDay.set(d, []);
  for (const s of sessions) {
    const day = String(s?.day || "").trim();
    if (!ORDER.includes(day)) continue;
    byDay.get(day).push(s);
  }

  const idxMap = new Map();
  sessions.forEach((s, i) => idxMap.set(s, i));

  return ORDER.map((day) => {
    const list = byDay.get(day) || [];
    list.sort((a, b) => {
      const pa = sessionPriorityScore(a);
      const pb = sessionPriorityScore(b);
      if (pb !== pa) return pb - pa;
      return (idxMap.get(a) ?? 0) - (idxMap.get(b) ?? 0);
    });

    const primary = list[0] || null;
    const isRunDay = Array.isArray(runDays) && runDays.includes(day);

    return {
      day,
      intent: list.length ? "RUN" : isRunDay ? "RUN" : "REST",
      title: primary?.name || (isRunDay ? day : "Rest / no structured session"),
      sessions: list,
    };
  });
}

function getRunDaysFromContext(week, sk, sessions) {
  const fromWeek = Array.isArray(week?.runDays) ? week.runDays : null;
  if (fromWeek?.length) return fromWeek.map(String).map((d) => d.trim()).filter((d) => ORDER.includes(d));

  const fromSk = Array.isArray(sk?.runDays) ? sk.runDays : null;
  if (fromSk?.length) return fromSk.map(String).map((d) => d.trim()).filter((d) => ORDER.includes(d));

  const fromFlags = Array.isArray(sk?.days)
    ? sk.days.filter((d) => d?.isRunDay).map((d) => String(d?.day || "").trim()).filter((d) => ORDER.includes(d))
    : null;
  if (fromFlags?.length) return fromFlags;

  const inferred = Array.isArray(sessions)
    ? [...new Set(sessions.map((s) => String(s?.day || "").trim()).filter((d) => ORDER.includes(d)))]
    : [];
  return inferred;
}

function getGoalKeyFromContext(week, sk) {
  return normaliseGoalKey(
    week?.hints?.goalDistance ||
      sk?.hints?.goalDistance ||
      week?.goalDistance ||
      sk?.goalDistance ||
      week?.specId ||
      sk?.specId ||
      "other"
  );
}

function resolveHardCapForWeek({ baseCap, week, sk, sessions }) {
  let cap = Number.isFinite(baseCap) ? baseCap : 1;

  const intended = toNumber(week?.hardDaysTarget) ?? toNumber(sk?.hardDaysTarget) ?? null;
  if (intended != null && intended > 0) cap = Math.max(cap, intended);

  const runDays = getRunDaysFromContext(week, sk, sessions);
  if (runDays.length <= 3) cap = 1;
  if (runDays.length >= 4) cap = Math.max(cap, 2);

  const globalMax = toNumber(RULES?.intensityTargets?.maxQualitySessionsPerWeek);
  if (globalMax != null && globalMax > 0) cap = Math.min(cap, globalMax);

  return cap;
}

function stableSortSessionsByDayThenOriginal(sessions = []) {
  const indexed = sessions.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => {
    const da = ORDER.indexOf(String(a.s?.day || "").trim());
    const db = ORDER.indexOf(String(b.s?.day || "").trim());
    if (da !== db) return da - db;
    return a.i - b.i;
  });
  return indexed.map((x) => x.s);
}

function enforceRunDaysMove(sessions, runDays) {
  if (!Array.isArray(runDays) || runDays.length === 0) return sessions;

  const allowed = runDays.filter((d) => ORDER.includes(d));
  if (allowed.length === 0) return sessions;

  const counts = new Map();
  for (const d of allowed) counts.set(d, 0);

  for (const s of sessions) {
    const d = String(s?.day || "").trim();
    if (counts.has(d)) counts.set(d, (counts.get(d) || 0) + 1);
  }

  function nearestAllowedDay(fromDay) {
    const fromIdx = ORDER.indexOf(fromDay);
    if (fromIdx < 0) {
      let best = allowed[0];
      for (const d of allowed) {
        if ((counts.get(d) || 0) < (counts.get(best) || 0)) best = d;
      }
      return best;
    }

    const scored = allowed.map((d) => {
      const idx = ORDER.indexOf(d);
      const dist = Math.abs(idx - fromIdx);
      const use = counts.get(d) || 0;
      return { d, dist, use, idx };
    });

    scored.sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      if (a.use !== b.use) return a.use - b.use;
      return a.idx - b.idx;
    });

    return scored[0].d;
  }

  return sessions.map((s) => {
    const day = String(s?.day || "").trim();
    if (!ORDER.includes(day)) return s;
    if (allowed.includes(day)) return s;

    const toDay = nearestAllowedDay(day);
    counts.set(toDay, (counts.get(toDay) || 0) + 1);

    return {
      ...s,
      day: toDay,
      notes: `${s?.notes || ""}${s?.notes ? " " : ""}(Moved from ${day} to ${toDay} to respect runDays)`.trim(),
    };
  });
}

function appendNote(base, txt) {
  const b = String(base || "").trim();
  const t = String(txt || "").trim();
  if (!t) return b;
  if (b.includes(t)) return b;
  return b ? `${b} ${t}` : t;
}

function getSessionKm(s) {
  return (
    toNumber(s?.plannedDistanceKm) ??
    toNumber(s?.distanceKm) ??
    toNumber(s?.distance) ??
    0
  );
}

function stepDistanceMetersWithRepeats(step) {
  if (!step || typeof step !== "object") return 0;
  const stepType = String(step?.stepType || "").toLowerCase();
  if (stepType === "repeat" && Array.isArray(step.steps)) {
    const reps = Math.max(1, Math.round(toNumber(step.repeatCount) ?? 1));
    return reps * step.steps.reduce((sum, child) => sum + stepDistanceMetersWithRepeats(child), 0);
  }
  if (String(step?.durationType || "").toLowerCase() !== "distance") return 0;
  return Math.max(0, toNumber(step.durationValue) ?? 0);
}

function scaleDistanceStepsToMeters(steps, targetMeters) {
  const source = Array.isArray(steps) ? steps : [];
  const total = source.reduce((sum, step) => sum + stepDistanceMetersWithRepeats(step), 0);
  const target = Math.max(0, Math.round(Number(targetMeters) || 0));
  if (!source.length || total <= 0 || target <= 0) return source;

  const scale = target / total;

  const scaleStep = (step) => {
    if (!step || typeof step !== "object") return step;
    const stepType = String(step?.stepType || "").toLowerCase();
    if (stepType === "repeat" && Array.isArray(step.steps)) {
      return { ...step, steps: step.steps.map(scaleStep) };
    }
    if (String(step?.durationType || "").toLowerCase() !== "distance") return { ...step };

    const raw = Math.max(0, toNumber(step.durationValue) ?? 0);
    const next = Math.max(0, Math.round(raw * scale));
    return { ...step, durationValue: next };
  };

  const out = source.map(scaleStep);
  const scaledTotal = out.reduce((sum, step) => sum + stepDistanceMetersWithRepeats(step), 0);
  const diff = target - scaledTotal;
  if (Math.abs(diff) <= 1) return out;

  const adjustFirstDistance = (items, totalDiff, multiplier = 1) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const stepType = String(item?.stepType || "").toLowerCase();
      if (stepType === "repeat" && Array.isArray(item.steps)) {
        const reps = Math.max(1, Math.round(toNumber(item.repeatCount) ?? 1));
        if (adjustFirstDistance(item.steps, totalDiff, multiplier * reps)) return true;
      } else if (String(item?.durationType || "").toLowerCase() === "distance") {
        const current = Math.max(0, toNumber(item.durationValue) ?? 0);
        item.durationValue = Math.max(0, current + Math.round(totalDiff / multiplier));
        return true;
      }
    }
    return false;
  };

  adjustFirstDistance(out, diff);
  return out;
}

function withSessionKm(s, km, note) {
  const v = round1(Math.max(0, Number(km) || 0));
  const kind = kindUpper(s);
  const meters = Math.round(v * 1000);

  const flattenToSingleDistanceStep = (workout) => {
    const first = Array.isArray(workout?.steps) ? workout.steps[0] : null;
    const out = {
      ...workout,
      steps: [
        {
          stepType: "steady",
          durationType: "distance",
          durationValue: meters,
          targetType: String(first?.targetType || "none"),
          ...(first?.targetValue != null ? { targetValue: first.targetValue } : {}),
        },
      ],
    };
    return out;
  };

  const workout =
    s?.workout && typeof s.workout === "object"
      ? (() => {
          let w = {
            ...s.workout,
            estimatedDistanceMeters: meters,
          };

          if (!w.meta || typeof w.meta !== "object") w.meta = {};
          w.meta.sessionKm = v;

          const longVariant = String(w?.variant || s?.meta?.longVariant || "").toUpperCase();
          const easyLong = kind === "LONG" && (longVariant.startsWith("EASY") || !longVariant);
          if (kind === "EASY" || easyLong) {
            w = flattenToSingleDistanceStep(w);
          } else if (kind === "LONG" && Array.isArray(w.steps)) {
            w = {
              ...w,
              steps: scaleDistanceStepsToMeters(w.steps, meters),
            };
          }

          return w;
        })()
      : s?.workout;

  return {
    ...s,
    plannedDistanceKm: v,
    distanceKm: v,
    distance: v,
    distanceMeters: meters,
    workout,
    notes: note ? appendNote(s?.notes, note) : s?.notes,
  };
}

function redistributeDeltaToEasy({ sessions, deltaKm }) {
  let remaining = round1(deltaKm);
  if (Math.abs(remaining) < 0.1) return { sessions, appliedKm: 0 };

  const MIN_EASY_KM = 0.5;
  const MAX_EASY_KM = 24;
  const easyIdx = sessions
    .map((s, i) => (kindUpper(s) === "EASY" && !hasStructuredWorkout(s) ? i : -1))
    .filter((i) => i >= 0);

  if (!easyIdx.length) return { sessions, appliedKm: 0 };

  const out = sessions.map((s) => ({ ...s }));
  for (let p = 0; p < easyIdx.length; p++) {
    if (Math.abs(remaining) < 0.1) break;
    const i = easyIdx[p];
    const cur = getSessionKm(out[i]);

    const capUp = MAX_EASY_KM - cur;
    const capDown = cur - MIN_EASY_KM;

    const move =
      remaining > 0
        ? Math.min(remaining, capUp)
        : Math.max(remaining, -capDown);

    if (Math.abs(move) < 0.1) continue;

    out[i] = withSessionKm(
      out[i],
      cur + move,
      "(Guardrail: rebalanced easy distance)"
    );
    remaining = round1(remaining - round1(move));
  }

  return { sessions: out, appliedKm: round1(deltaKm - remaining) };
}

function phaseQualityMaxPct(phase, goalKey) {
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const g = normaliseGoalKey(goalKey);
  const map = RULES?.intensityTargets?.qualitySharePctByPhase || {};
  const cap = toNumber(map?.[p]?.max);
  let resolved = cap != null ? clamp(cap, 15, 45) : null;

  // Marathon 4-day plans should not drift into two-hard-day specific blocks.
  if (g === "marathon" && p === "SPECIFIC") {
    resolved = Math.min(resolved ?? 35, 30);
  }
  // 10K build/specific should stay below ~30% quality share in final weekly mix.
  if (g === "10k" && p === "BUILD") {
    resolved = Math.min(resolved ?? 35, 29.5);
  }
  if (g === "10k" && p === "SPECIFIC") {
    resolved = Math.min(resolved ?? 35, 29.5);
  }

  if (resolved != null) return resolved;

  const fallbackPct = toNumber(RULES?.intensityTargets?.qualityPct);
  return fallbackPct != null ? clamp(fallbackPct * 100, 15, 45) : 35;
}

function goalMaxQualitySessionKm(goalKey, fallbackMaxQ, weeklyKm, runDaysCount) {
  const g = normaliseGoalKey(goalKey);
  const wk = Number(weeklyKm || 0);
  const runs = Number(runDaysCount || 0);
  let cap = Number(fallbackMaxQ || 11);

  if (g === "marathon") cap = Math.max(cap, 14);
  if (g === "half") cap = Math.max(cap, 13);
  if (g === "ultra") cap = Math.max(cap, 16);

  if (g === "half" && wk >= 60) cap = Math.max(cap, 15);
  if (g === "marathon" && wk >= 65) cap = Math.max(cap, 15.5);
  if (g === "ultra" && wk >= 70) cap = Math.max(cap, 19);

  if (g === "5k" || g === "10k") {
    if (wk >= 50) cap = Math.max(cap, 13);
    if (wk >= 60) cap = Math.max(cap, 14);
  }

  if (runs > 0 && runs <= 3) {
    if (wk >= 55) cap += 1.2;
    else if (wk >= 40) cap += 0.8;
  }
  return round1(cap);
}

function easyRunMaxSharePct(goalKey, phase) {
  const g = normaliseGoalKey(goalKey);
  const p = String(phase || "").toUpperCase();
  let pct = 30;
  if (g === "half") pct = 29;
  if (g === "marathon") pct = 27;
  if (g === "ultra") pct = 25;
  if (p === "DELOAD" || p === "TAPER") pct += 1;
  return clamp(pct, 22, 35);
}

function normaliseGoalKey(v) {
  return normaliseGoalPolicyKey(v, "other");
}

function longRunMinForGoal(goalKey = null) {
  const goal = normaliseGoalKey(goalKey);
  if (goal === "return") return 1.5;
  if (goal === "general") return 2.5;
  if (goal === "5k") return 4;
  return LR_MIN;
}

function phaseLongRunMaxPct(phase, goalKey, weeklyTargetKm = null, longTargetKm = null) {
  const p = String(phase || "").toUpperCase().trim() || "BUILD";
  const g = normaliseGoalKey(goalKey);
  const byGoal = RULES?.longRun?.longRunSharePctByGoalPhase || {};
  const goalCap = toNumber(byGoal?.[g]?.[p]?.max);
  const baseCap =
    goalCap != null
      ? clamp(goalCap, 18, 45) / 100
      : (() => {
          const map = RULES?.longRun?.longRunSharePctByPhase || {};
          const cap = toNumber(map?.[p]?.max);
          if (cap != null) return clamp(cap, 18, 45) / 100;
          return toNumber(RULES?.longRun?.maxPctOfWeekly) ?? 0.4;
        })();

  const weekly = toNumber(weeklyTargetKm);
  const longTarget = toNumber(longTargetKm);
  if (weekly != null && weekly > 0 && longTarget != null && longTarget > 0) {
    const targetDriven = clamp(longTarget / weekly + 0.01, 0.26, 0.52);
    return Math.max(baseCap, targetDriven);
  }
  return baseCap;
}

function resolveLongRunPctCap({ phase, goalKey, weeklyTargetKm = null, longTargetKm = null, runDaysCount = null }) {
  const phaseCap = clamp(phaseLongRunMaxPct(phase, goalKey, weeklyTargetKm, longTargetKm), 0.2, 0.6);
  const conservativeGlobal = toNumber(RULES?.longRun?.maxPctOfWeekly) ?? 0.4;
  const goal = normaliseGoalKey(goalKey);
  const speedGoalCap =
    goal === "5k"
      ? 0.36
      : goal === "10k"
      ? 0.38
      : goal === "half"
      ? 0.42
      : null;
  if (Number.isFinite(Number(runDaysCount)) && Number(runDaysCount) === 1) {
    return 1;
  }
  if (Number.isFinite(Number(runDaysCount)) && Number(runDaysCount) > 0 && Number(runDaysCount) <= 3) {
    return Math.min(conservativeGlobal, phaseCap, speedGoalCap ?? 1);
  }
  return Math.min(phaseCap, speedGoalCap ?? 1);
}

function minQualityFloorKm({ weeklyKm, phase, goalKey }) {
  const base = toNumber(RULES?.intensityTargets?.minQualitySessionKm) ?? 5.0;
  const p = String(phase || "").toUpperCase().trim();
  const g = normaliseGoalKey(goalKey);
  const wk = Number(weeklyKm || 0);

  let floor = base;
  if (wk > 0) {
    if (wk <= 18) floor = Math.min(floor, 3.5);
    else if (wk <= 24) floor = Math.min(floor, 4.0);
    else if (wk <= 32) floor = Math.min(floor, 4.5);
  }

  if (p === "DELOAD") floor = Math.min(floor, 3.6);
  if (p === "TAPER") floor = Math.min(floor, 3.2);
  if ((g === "marathon" || g === "ultra") && (p === "DELOAD" || p === "TAPER")) {
    floor = Math.min(floor, 3.0);
  }

  return round1(clamp(floor, 2.8, base));
}

function capQualityShareByPhase({ sessions, weeklyRefKm, phase, goalKey, minQKmPerSession }) {
  let out = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  let edits = 0;
  const notes = [];

  if (!out.length || !Number.isFinite(Number(weeklyRefKm)) || Number(weeklyRefKm) <= 0) {
    return { sessions: out, edits, notes };
  }

  const weekly = Number(weeklyRefKm);
  const maxSharePct = phaseQualityMaxPct(phase, goalKey);
  const maxQualityKm = round1((weekly * maxSharePct) / 100);

  const qualityIdx = out
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isHard(s) && !isLong(s))
    .map(({ i }) => i);

  if (!qualityIdx.length) return { sessions: out, edits, notes };

  let qualityKm = round1(qualityIdx.reduce((a, i) => a + getSessionKm(out[i]), 0));
  let excess = round1(qualityKm - maxQualityKm);
  if (excess <= 0.1) return { sessions: out, edits, notes };

  qualityIdx
    .map((i) => ({ i, km: getSessionKm(out[i]) }))
    .sort((a, b) => b.km - a.km)
    .forEach(({ i }) => {
      if (excess <= 0.1) return;

      const cur = getSessionKm(out[i]);
      let floor = Math.max(0.5, Number(minQKmPerSession) || 5.0);
      const feasibleFloor = maxQualityKm / Math.max(1, qualityIdx.length);
      floor = Math.max(0.5, Math.min(floor, feasibleFloor));
      const room = round1(cur - floor);
      if (room <= 0.1) return;

      const cut = round1(Math.min(room, excess));
      if (cut <= 0.1) return;

      const next = round1(cur - cut);
      out[i] = withSessionKm(
        out[i],
        next,
        `(Guardrail: capped quality share for ${String(phase || "BUILD").toUpperCase()})`
      );
      excess = round1(excess - cut);
      edits += 1;
      notes.push(`quality_share_cap:${kindUpper(out[i])}:${round1(cur)}->${round1(next)}`);
    });

  const qualityKmAfter = round1(qualityIdx.reduce((a, i) => a + getSessionKm(out[i]), 0));
  const removed = round1(qualityKm - qualityKmAfter);
  if (removed > 0.1) {
    const redist = redistributeDeltaToEasy({ sessions: out, deltaKm: removed });
    out = redist.sessions;
    if (Math.abs(redist.appliedKm) >= 0.1) {
      edits += 1;
      notes.push(`quality_reallocated_to_easy:+${round1(redist.appliedKm)}`);
    }
  }

  return { sessions: out, edits, notes };
}

function enforceEasyVsLongBalance({ sessions, weeklyRefKm, longPctCap, goalKey }) {
  let out = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  let edits = 0;
  const notes = [];
  const g = normaliseGoalKey(goalKey);
  const enforceForGoal = g === "5k" || g === "10k" || g === "half" || g === "marathon" || g === "ultra";
  if (!enforceForGoal) return { sessions: out, edits, notes };

  const longIdx = out.findIndex((s) => isLong(s));
  if (longIdx < 0) return { sessions: out, edits, notes };

  const easyIdx = out
    .map((s, i) => (kindUpper(s) === "EASY" ? i : -1))
    .filter((i) => i >= 0);

  if (!easyIdx.length) return { sessions: out, edits, notes };

  const longKm = round1(getSessionKm(out[longIdx]));
  const easyEntries = easyIdx.map((i) => ({ i, km: round1(getSessionKm(out[i])) }));
  const maxEasy = easyEntries.slice().sort((a, b) => b.km - a.km)[0];
  if (!maxEasy) return { sessions: out, edits, notes };
  if (maxEasy.km <= longKm + 0.1) return { sessions: out, edits, notes };

  // Better heuristic than easy-total<=long:
  // keep the single biggest EASY session no larger than LONG when feasible.
  const requiredShift = round1(maxEasy.km - longKm);
  if (requiredShift <= 0.1) return { sessions: out, edits, notes };

  const longCapByPct =
    Number.isFinite(Number(weeklyRefKm)) && Number(weeklyRefKm) > 0
      ? Number(weeklyRefKm) * (Number(longPctCap) || 0.4)
      : LR_MAX;
  const longMin = longRunMinForGoal(goalKey);
  const longCap = clamp(longCapByPct, longMin, LR_MAX);
  const longRoom = round1(longCap - longKm);
  const easyFloor = 0.5;
  const maxReducible = round1(Math.max(0, maxEasy.km - easyFloor));
  const shiftTarget = round1(Math.min(requiredShift, Math.max(0, longRoom), maxReducible));

  if (shiftTarget <= 0.1) {
    notes.push("easy_vs_long_skipped_cap");
    return { sessions: out, edits, notes };
  }

  const easyBefore = getSessionKm(out[maxEasy.i]);
  out[maxEasy.i] = withSessionKm(
    out[maxEasy.i],
    easyBefore - shiftTarget,
    "(Guardrail: reduced largest easy run)"
  );

  const longBefore = getSessionKm(out[longIdx]);
  out[longIdx] = withSessionKm(
    out[longIdx],
    longBefore + shiftTarget,
    "(Guardrail: increased long run for better weekly balance)"
  );

  edits += 2;
  notes.push(`easy_to_long_rebalance:${round1(easyBefore)}->${round1(getSessionKm(out[maxEasy.i]))},${round1(longBefore)}->${round1(getSessionKm(out[longIdx]))}`);

  return { sessions: out, edits, notes };
}

function capLargestEasyRunShare({ sessions, weeklyRefKm, phase, goalKey, longPctCap, maxQ }) {
  let out = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  let edits = 0;
  const notes = [];
  const weekly = Number(weeklyRefKm || 0);
  if (!out.length || !Number.isFinite(weekly) || weekly <= 0) return { sessions: out, edits, notes };

  const easyIdx = out
    .map((s, i) => ({ i, km: getSessionKm(s), t: kindUpper(s) }))
    .filter((x) => x.t === "EASY")
    .sort((a, b) => b.km - a.km);
  if (!easyIdx.length) return { sessions: out, edits, notes };

  const top = easyIdx[0];
  const longIdx = out.findIndex((s) => isLong(s));
  const longKm = longIdx >= 0 ? getSessionKm(out[longIdx]) : 0;

  const byShareCap = round1((weekly * easyRunMaxSharePct(goalKey, phase)) / 100);
  const byLongCap = longIdx >= 0 ? round1(longKm + 0.1) : byShareCap;
  const cap = Math.max(0.5, Math.min(byShareCap, byLongCap));
  const overflow = round1(top.km - cap);
  if (overflow <= 0.1) return { sessions: out, edits, notes };

  const maxQualityKmByPhase = round1((weekly * phaseQualityMaxPct(phase, goalKey)) / 100);
  const currentQualityKm = round1(
    out.reduce((a, s) => (isHard(s) && !isLong(s) ? a + getSessionKm(s) : a), 0)
  );

  // Reduce largest easy first.
  const easyBefore = getSessionKm(out[top.i]);
  let targetReduction = overflow;

  const qIdxPreview = out
    .map((s, i) => ({ i, km: getSessionKm(s) }))
    .filter(({ i }) => isHard(out[i]) && !isLong(out[i]));
  const qualityRoomBySession = round1(
    qIdxPreview.reduce((a, q) => a + Math.max(0, maxQ - q.km), 0)
  );
  const qualityRoomByShare = round1(Math.max(0, maxQualityKmByPhase - currentQualityKm));
  const qualityRoom = round1(Math.max(0, Math.min(qualityRoomBySession, qualityRoomByShare)));

  let longRoom = 0;
  if (longIdx >= 0) {
    const longCapByWeek = weekly * (Number(longPctCap) || 0.4);
    const longMin = longRunMinForGoal(goalKey);
    const longCap = clamp(longCapByWeek, longMin, LR_MAX);
    longRoom = round1(Math.max(0, longCap - longKm));
  }

  const reallocRoom = round1(qualityRoom + longRoom);
  if (reallocRoom <= 0.1) {
    // Keep the easy-run cap even when we cannot reallocate volume safely.
    // Realism > exact weekly target closure in this corner case.
    out[top.i] = withSessionKm(out[top.i], easyBefore - overflow, "(Guardrail: capped largest easy run)");
    edits += 1;
    notes.push(`easy_single_cap:${round1(easyBefore)}->${round1(getSessionKm(out[top.i]))},reallocated=0`);
    return { sessions: out, edits, notes };
  }
  targetReduction = round1(Math.min(targetReduction, reallocRoom));
  if (targetReduction <= 0.1) return { sessions: out, edits, notes };

  out[top.i] = withSessionKm(out[top.i], easyBefore - targetReduction, "(Guardrail: capped largest easy run)");
  edits += 1;

  let remaining = targetReduction;

  // Reallocate to quality sessions up to dynamic maxQ.
  const qIdx = out
    .map((s, i) => ({ i, km: getSessionKm(s) }))
    .filter(({ i }) => isHard(out[i]) && !isLong(out[i]))
    .sort((a, b) => a.km - b.km);
  for (const q of qIdx) {
    if (remaining <= 0.1) break;
    const cur = getSessionKm(out[q.i]);
    const roomPerSession = round1(Math.max(0, maxQ - cur));
    const qualityNow = round1(
      out.reduce((a, s) => (isHard(s) && !isLong(s) ? a + getSessionKm(s) : a), 0)
    );
    const roomByShare = round1(Math.max(0, maxQualityKmByPhase - qualityNow));
    const room = round1(Math.max(0, Math.min(roomPerSession, roomByShare)));
    if (room <= 0.1) continue;
    const add = round1(Math.min(room, remaining));
    out[q.i] = withSessionKm(out[q.i], cur + add, "(Guardrail: rebalanced from oversized easy run)");
    remaining = round1(remaining - add);
    edits += 1;
  }

  // Then reallocate to long run if room.
  if (remaining > 0.1 && longIdx >= 0) {
    const curLong = getSessionKm(out[longIdx]);
    const longCapByWeek = weekly * (Number(longPctCap) || 0.4);
    const longMin = longRunMinForGoal(goalKey);
    const longCap = clamp(longCapByWeek, longMin, LR_MAX);
    const room = round1(Math.max(0, longCap - curLong));
    if (room > 0.1) {
      const add = round1(Math.min(room, remaining));
      out[longIdx] = withSessionKm(out[longIdx], curLong + add, "(Guardrail: rebalanced from oversized easy run)");
      remaining = round1(remaining - add);
      edits += 1;
    }
  }

  notes.push(
    `easy_single_cap:${round1(easyBefore)}->${round1(getSessionKm(out[top.i]))},reallocated=${round1(targetReduction - remaining)}`
  );
  return { sessions: out, edits, notes };
}

function enforceDistanceGuardrails({ sessions, weeklyTargetKm, phase, goalKey }) {
  let out = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  let edits = 0;
  const notes = [];

  const minQ = minQualityFloorKm({ weeklyKm: weeklyTargetKm, phase, goalKey });
  const runDaysCount = new Set(
    out.map((s) => String(s?.day || "").trim()).filter((d) => ORDER.includes(d))
  ).size;

  const maxQ = goalMaxQualitySessionKm(
    goalKey,
    toNumber(RULES?.intensityTargets?.maxQualitySessionKm) ?? 11.0,
    weeklyTargetKm,
    runDaysCount
  );
  const longCurrentKm = toNumber(out.find((s) => isLong(s))?.plannedDistanceKm ?? out.find((s) => isLong(s))?.distanceKm);
  const longPctCap = resolveLongRunPctCap({
    phase,
    goalKey,
    weeklyTargetKm,
    longTargetKm: longCurrentKm,
    runDaysCount,
  });

  const weeklyRef =
    Number.isFinite(Number(weeklyTargetKm)) && Number(weeklyTargetKm) > 0
      ? Number(weeklyTargetKm)
      : out.reduce((a, s) => a + getSessionKm(s), 0);

  // 1) Clamp quality-session km (non-long hard sessions)
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (!isHard(s) || isLong(s)) continue;

    const cur = getSessionKm(s);
    const next = clamp(cur, minQ, maxQ);
    if (Math.abs(next - cur) < 0.1) continue;

    out[i] = withSessionKm(
      s,
      next,
      `(Guardrail: quality km clamped ${minQ}-${maxQ})`
    );
    edits += 1;
    notes.push(`quality_km_clamp:${kindUpper(s)}:${round1(cur)}->${round1(next)}`);
  }

  // 2) Cap long run by weekly percentage + absolute caps
  const longIdx = out.findIndex((s) => isLong(s));
  if (longIdx >= 0 && weeklyRef > 0) {
    const longCur = getSessionKm(out[longIdx]);
    const longCapByWeek = weeklyRef * longPctCap;
    const longMin = longRunMinForGoal(goalKey);
    const longCap = clamp(longCapByWeek, longMin, LR_MAX);

    if (longCur > longCap + 0.1) {
      const cut = round1(longCur - longCap);
      out[longIdx] = withSessionKm(
        out[longIdx],
        longCap,
        `(Guardrail: long run capped to ${round1(longPctCap * 100)}% weekly)`
      );
      edits += 1;
      notes.push(`long_pct_cap:${round1(longCur)}->${round1(longCap)}`);

      // Reallocate removed km to easy runs to preserve weekly volume as best-effort.
      const redist = redistributeDeltaToEasy({ sessions: out, deltaKm: cut });
      out = redist.sessions;
      if (Math.abs(redist.appliedKm) >= 0.1) {
        edits += 1;
        notes.push(`long_reallocated_to_easy:+${round1(redist.appliedKm)}`);
      }
    }
  }

  // 3) Cap quality share by phase and rebalance surplus to easy.
  {
    const qCap = capQualityShareByPhase({
      sessions: out,
      weeklyRefKm: weeklyRef,
      phase,
      goalKey,
      minQKmPerSession: minQ,
    });
    out = qCap.sessions;
    edits += qCap.edits;
    notes.push(...qCap.notes);
  }

  // 4) Keep long run at least as large as combined easy volume when possible.
  {
    const rebalance = enforceEasyVsLongBalance({
      sessions: out,
      weeklyRefKm: weeklyRef,
      longPctCap,
      goalKey,
    });
    out = rebalance.sessions;
    edits += rebalance.edits;
    notes.push(...rebalance.notes);
  }

  // 5) Prevent single oversized easy sessions by rebalancing into quality/long.
  {
    const easyCap = capLargestEasyRunShare({
      sessions: out,
      weeklyRefKm: weeklyRef,
      phase,
      goalKey,
      longPctCap,
      maxQ,
    });
    out = easyCap.sessions;
    edits += easyCap.edits;
    notes.push(...easyCap.notes);
  }

  return { sessions: out, edits, notes };
}

function capLongRunShareOnly({ sessions, weeklyTargetKm, phase, goalKey }) {
  let out = Array.isArray(sessions) ? sessions.map((s) => ({ ...s })) : [];
  let edits = 0;
  const notes = [];
  const goal = normaliseGoalKey(goalKey);
  if (goal !== "5k" && goal !== "10k" && goal !== "half") return { sessions: out, edits, notes };

  const weeklyRef =
    Number.isFinite(Number(weeklyTargetKm)) && Number(weeklyTargetKm) > 0
      ? Number(weeklyTargetKm)
      : out.reduce((a, s) => a + getSessionKm(s), 0);
  if (!out.length || weeklyRef <= 0) return { sessions: out, edits, notes };

  const longIdx = out.findIndex((s) => isLong(s));
  if (longIdx < 0) return { sessions: out, edits, notes };

  const runDaysCount = new Set(
    out.map((s) => String(s?.day || "").trim()).filter((d) => ORDER.includes(d))
  ).size;
  const longCur = getSessionKm(out[longIdx]);
  const longPctCap = resolveLongRunPctCap({
    phase,
    goalKey,
    weeklyTargetKm: weeklyRef,
    longTargetKm: longCur,
    runDaysCount,
  });
  const longMin = longRunMinForGoal(goalKey);
  const longCap = clamp(weeklyRef * longPctCap, longMin, LR_MAX);

  if (longCur <= longCap + 0.1) return { sessions: out, edits, notes };

  const cut = round1(longCur - longCap);
  out[longIdx] = withSessionKm(
    out[longIdx],
    longCap,
    `(Guardrail: long run capped to ${round1(longPctCap * 100)}% weekly)`
  );
  edits += 1;
  notes.push(`long_pct_cap:${round1(longCur)}->${round1(longCap)}`);

  const redist = redistributeDeltaToEasy({ sessions: out, deltaKm: cut });
  out = redist.sessions;
  if (Math.abs(redist.appliedKm) >= 0.1) {
    edits += 1;
    notes.push(`long_reallocated_to_easy:+${round1(redist.appliedKm)}`);
  }

  return { sessions: out, edits, notes };
}

function ensureLongRunMinimal({ sessions, sk, tgt, runDays }) {
  const out = Array.isArray(sessions) ? [...sessions] : [];
  if (out.some((s) => isLong(s))) return { sessions: out, added: false };
  if (out.some((s) => isRace(s))) return { sessions: out, added: false };

  let longDay = pickLongDayFromSkeleton(sk, out);
  if (Array.isArray(runDays) && runDays.length && !runDays.includes(longDay)) {
    longDay = runDays.includes("Sun") ? "Sun" : runDays[runDays.length - 1];
  }

  const goalKey = getGoalKeyFromContext(null, sk);
  const longMin = longRunMinForGoal(goalKey);
  const longKmFromTarget = toNumber(tgt?.longRunKm);
  const longKm = longKmFromTarget != null ? clamp(longKmFromTarget, longMin, LR_MAX) : longMin;

  out.push(
    ensureWorkoutShell(
      normaliseDistanceFields({
        day: longDay,
        type: "LONG",
        sessionType: "LONG",
        workoutKind: "LONG",
        name: "Long run",
        plannedDistanceKm: round1(longKm),
        distanceKm: round1(longKm),
        keyTargets: `Long run: ${round1(longKm)} km`,
        purpose: "Build endurance and aerobic base.",
        notes: "Added by validator (missing long run). Keep it comfortable and controlled.",
      })
    )
  );

  return { sessions: out, added: true };
}

function repairHardSpacingMinimal({ sessions, minGapDays }) {
  const out = stableSortSessionsByDayThenOriginal(Array.isArray(sessions) ? sessions : [])
    .map(normaliseDistanceFields)
    .map(ensureWorkoutShell);

  const minGap = Number(minGapDays);
  if (!Number.isFinite(minGap) || minGap < 1) return { sessions: out, edits: 0, notes: [] };

  let edits = 0;
  const notes = [];
  const HARD_MIN_SESSION_KM = 1.2;

  // Tiny hard sessions are not viable; downgrade before spacing checks.
  for (let i = 0; i < out.length; i++) {
    if (!isHard(out[i]) || isLong(out[i]) || isStrides(out[i])) continue;
    if (getSessionKm(out[i]) >= HARD_MIN_SESSION_KM) continue;
    out[i] = downgradeToEasy(out[i], "(Adjusted to enforce hard-day spacing)");
    edits += 1;
    notes.push("hard_too_short");
  }

  // Always keep only one hard session per day (highest priority).
  for (const day of ORDER) {
    const hard = out
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => String(s?.day || "").trim() === day && isHard(s))
      .sort((a, b) => {
        const ds = sessionPriorityScore(b.s) - sessionPriorityScore(a.s);
        return ds !== 0 ? ds : a.i - b.i;
      });
    if (hard.length <= 1) continue;
    for (const x of hard.slice(1)) {
      out[x.i] = downgradeToEasy(out[x.i], "(Adjusted to enforce hard-day spacing)");
      edits += 1;
      notes.push(`hard_same_day:${day}`);
    }
  }

  let lastHard = null; // { dayIdx, idx }
  for (let dayIdx = 0; dayIdx < ORDER.length; dayIdx++) {
    const day = ORDER[dayIdx];
    const hardToday = out
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => String(s?.day || "").trim() === day && isHard(s))
      .sort((a, b) => {
        const ds = sessionPriorityScore(b.s) - sessionPriorityScore(a.s);
        return ds !== 0 ? ds : a.i - b.i;
      });
    if (!hardToday.length) continue;

    const cur = hardToday[0];
    if (!lastHard) {
      lastHard = { dayIdx, idx: cur.i };
      continue;
    }

    if (dayIdx - lastHard.dayIdx > minGap) {
      lastHard = { dayIdx, idx: cur.i };
      continue;
    }

    const prevScore = sessionPriorityScore(out[lastHard.idx]);
    const curScore = sessionPriorityScore(out[cur.i]);

    if (curScore > prevScore) {
      const prevDay = ORDER[lastHard.dayIdx];
      out[lastHard.idx] = downgradeToEasy(out[lastHard.idx], "(Adjusted to enforce hard-day spacing)");
      edits += 1;
      notes.push(`hard_gap:${prevDay}`);
      lastHard = { dayIdx, idx: cur.i };
    } else {
      out[cur.i] = downgradeToEasy(out[cur.i], "(Adjusted to enforce hard-day spacing)");
      edits += 1;
      notes.push(`hard_gap:${day}`);
    }
  }

  return {
    sessions: stableSortSessionsByDayThenOriginal(out).map(ensureWorkoutShell),
    edits,
    notes,
  };
}

function repairWeeklyDriftMinimal({ sessions, weeklyTargetKm, goalKey = null }) {
  const target = toNumber(weeklyTargetKm);
  let out = stableSortSessionsByDayThenOriginal(Array.isArray(sessions) ? sessions : [])
    .map(normaliseDistanceFields)
    .map(ensureWorkoutShell);

  if (target == null || target <= 0) return { sessions: out, edits: 0, notes: [] };

  const sumPlanned = () =>
    round1(out.reduce((sum, s) => sum + (toNumber(s?.plannedDistanceKm) ?? toNumber(s?.distanceKm) ?? 0), 0));
  const easyIdx = () =>
    out
      .map((s, i) => ({ i, km: getSessionKm(s), t: kindUpper(s) }))
      .filter((x) => x.t === "EASY")
      .sort((a, b) => b.km - a.km);

  let drift = round1(target - sumPlanned());
  if (Math.abs(drift) < 0.1) return { sessions: out, edits: 0, notes: [] };

  let edits = 0;
  const notes = [];

  if (drift > 0) {
    for (const e of easyIdx()) {
      if (drift <= 0.1) break;
      const cur = getSessionKm(out[e.i]);
      const room = round1(Math.max(0, 24 - cur));
      if (room <= 0.1) continue;
      const add = round1(Math.min(room, drift));
      out[e.i] = withSessionKm(out[e.i], cur + add, "(Adjusted to match weekly target)");
      drift = round1(drift - add);
      edits += 1;
    }

    if (drift > 0.1) {
      const longIdx = out.findIndex((s) => isLong(s));
      if (longIdx >= 0) {
        const cur = getSessionKm(out[longIdx]);
        const room = round1(Math.max(0, LR_MAX - cur));
        if (room > 0.1) {
          const add = round1(Math.min(room, drift));
          out[longIdx] = withSessionKm(out[longIdx], cur + add, "(Adjusted to match weekly target)");
          drift = round1(drift - add);
          edits += 1;
        }
      }
    }

    if (drift > 0.1 && out.length) {
      const i = out.findIndex((s) => !isRace(s));
      if (i < 0) {
        notes.push(`weekly_drift_residual:${drift}`);
        return {
          sessions: stableSortSessionsByDayThenOriginal(out).map(ensureWorkoutShell),
          edits,
          notes,
        };
      }
      out[i] = withSessionKm(out[i], getSessionKm(out[i]) + drift, "(Adjusted to match weekly target)");
      edits += 1;
      drift = 0;
    }
  } else {
    let cut = Math.abs(drift);

    for (const e of easyIdx()) {
      if (cut <= 0.1) break;
      const cur = getSessionKm(out[e.i]);
      const reducible = round1(Math.max(0, cur - 0.5));
      if (reducible <= 0.1) continue;
      const sub = round1(Math.min(reducible, cut));
      out[e.i] = withSessionKm(out[e.i], cur - sub, "(Adjusted to match weekly target)");
      cut = round1(cut - sub);
      edits += 1;
    }

    if (cut > 0.1) {
      const longIdx = out.findIndex((s) => isLong(s));
      if (longIdx >= 0) {
        const cur = getSessionKm(out[longIdx]);
        const longFloor = out.length > 1 ? longRunMinForGoal(goalKey) : 0.5;
        const reducible = round1(Math.max(0, cur - longFloor));
        if (reducible > 0.1) {
          const sub = round1(Math.min(reducible, cut));
          out[longIdx] = withSessionKm(out[longIdx], cur - sub, "(Adjusted to match weekly target)");
          cut = round1(cut - sub);
          edits += 1;
        }
      }
    }

    if (cut > 0.1) {
      const qualityFloor = round1(
        Math.max(3.0, (toNumber(RULES?.intensityTargets?.minQualitySessionKm) ?? 5.0) - 1.5)
      );

      const idxAny = out
        .map((s, i) => ({ i, km: getSessionKm(s), hard: isHard(s) && !isLong(s) }))
        .filter(({ i }) => !isRace(out[i]))
        .sort((a, b) => {
          if (a.hard !== b.hard) return a.hard ? 1 : -1; // prefer non-quality trims first
          return b.km - a.km;
        })[0]?.i;

      if (idxAny != null) {
        const curSession = out[idxAny];
        const cur = getSessionKm(curSession);
        const floor = isHard(curSession) && !isLong(curSession) ? qualityFloor : 0.5;
        const reducible = round1(Math.max(0, cur - floor));
        if (reducible > 0.1) {
          const sub = round1(Math.min(reducible, cut));
          out[idxAny] = withSessionKm(out[idxAny], cur - sub, "(Adjusted to match weekly target)");
          cut = round1(cut - sub);
          edits += 1;
        }
      }
    }

    drift = round1(-cut);
  }

  const finalDrift = round1(target - sumPlanned());
  if (Math.abs(finalDrift) >= 0.1) notes.push(`weekly_drift_residual:${finalDrift}`);

  return {
    sessions: stableSortSessionsByDayThenOriginal(out).map(ensureWorkoutShell),
    edits,
    notes,
  };
}

// --------- main ---------
export function validateAndRepairPlan(plan, skeleton, targets, experience) {
  if (!plan?.weeks || !Array.isArray(plan.weeks)) return plan;

  const skWeeks = unwrapWeeks(skeleton);
  const tgtWeeks = unwrapWeeks(targets);

  const fixedWeeks = plan.weeks.map((week, idx) => {
    const sk = skWeeks[idx] || null;
    const tgt = tgtWeeks[idx] || null;

    let sessions = Array.isArray(week.sessions) ? [...week.sessions] : [];
    sessions = sessions.map(normaliseDistanceFields).map(ensureWorkoutShell);

    const runDays = getRunDaysFromContext(week, sk, sessions);
    let guardrailEdits = 0;
    const guardrailNotes = [];

    // Minimal repair 1: ensure a long run exists.
    const longRepair = ensureLongRunMinimal({ sessions, sk, tgt, runDays });
    sessions = longRepair.sessions;
    if (longRepair.added) {
      guardrailEdits += 1;
      guardrailNotes.push("missing_long_run_added");
    }

    // Minimal repair 2: hard-day spacing.
    const spacing = repairHardSpacingMinimal({
      sessions,
      minGapDays: Number(RULES?.spacing?.minGapDaysBetweenHard ?? 0),
    });
    sessions = spacing.sessions;
    guardrailEdits += spacing.edits;
    guardrailNotes.push(...spacing.notes);

    // Minimal repair 3: weekly drift.
    const weeklyTarget = toNumber(tgt?.weeklyKm);
    const drift = repairWeeklyDriftMinimal({
      sessions,
      weeklyTargetKm: weeklyTarget,
      goalKey: getGoalKeyFromContext(week, sk),
    });
    let finalSessions = drift.sessions;
    guardrailEdits += drift.edits;
    guardrailNotes.push(...drift.notes);

    const longRunCap = capLongRunShareOnly({
      sessions: finalSessions,
      weeklyTargetKm: weeklyTarget,
      phase: week?.phase || tgt?.phase || sk?.phase,
      goalKey: getGoalKeyFromContext(week, sk),
    });
    finalSessions = longRunCap.sessions;
    guardrailEdits += longRunCap.edits;
    guardrailNotes.push(...longRunCap.notes);

    finalSessions = stableSortSessionsByDayThenOriginal(finalSessions).map(ensureWorkoutShell);

    const days = buildWeekDaysCanonical({ sessions: finalSessions, runDays });

    const targetWeeklyKm = weeklyTarget;
    const plannedWeeklyKm = round1(
      finalSessions.reduce((sum, s) => sum + (toNumber(s?.plannedDistanceKm) ?? toNumber(s?.distanceKm) ?? 0), 0)
    );
    const computedWeeklyKm = round1(
      finalSessions.reduce((sum, s) => sum + (toNumber(s?.computedTotalKm) ?? toNumber(s?.plannedDistanceKm) ?? 0), 0)
    );
    const driftKm = targetWeeklyKm != null ? round1(targetWeeklyKm - plannedWeeklyKm) : null;
    const computedDriftKm = targetWeeklyKm != null ? round1(targetWeeklyKm - computedWeeklyKm) : null;

    const longSession = finalSessions.find((s) => isLong(s));
    const longKm = longSession ? round1(getSessionKm(longSession)) : 0;
    const qualityKm = round1(finalSessions.reduce((a, s) => a + (isHard(s) && !isLong(s) ? getSessionKm(s) : 0), 0));
    const qualityShare = plannedWeeklyKm > 0 ? round1((qualityKm / plannedWeeklyKm) * 100) : 0;
    const longRunShare = plannedWeeklyKm > 0 ? round1((longKm / plannedWeeklyKm) * 100) : 0;

    const metricsBase = week?.metrics && typeof week.metrics === "object" ? week.metrics : {};
    const repairTypes = [];
    if (longRepair.added) repairTypes.push("missing_long_run");
    if (spacing.edits > 0) repairTypes.push("hard_day_spacing");
    if (drift.edits > 0) repairTypes.push("weekly_drift");
    if (longRunCap.edits > 0) repairTypes.push("long_run_share");
    const repairsApplied = {
      weekIndex: Number(week?.weekIndex || week?.weekNumber || idx + 1) || idx + 1,
      edits: guardrailEdits,
      types: repairTypes,
      missingLongRunAdded: !!longRepair.added,
      hardDaySpacingEdits: spacing.edits,
      weeklyDriftEdits: drift.edits,
      notes: [...guardrailNotes],
    };
    const metrics = {
      ...metricsBase,
      targetWeeklyKm,
      plannedWeeklyKm,
      computedWeeklyKm,
      driftKm,
      computedDriftKm,
      qualityKm,
      qualitySharePct: qualityShare,
      longRunKm: longKm,
      longRunSharePct: longRunShare,
      guardrailEdits,
      guardrailNotes,
      repairsApplied,
    };

    const syncedTargets =
      tgt && typeof tgt === "object"
        ? {
            ...tgt,
            longRunKm: longKm,
          }
        : tgt;

    return {
      ...week,
      sessions: finalSessions,
      days,
      targets: syncedTargets,
      metrics,
      repairsApplied,
      rulesApplied: true,
    };
  });

  return { ...plan, weeks: fixedWeeks, rulesApplied: true };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function weekIndexLabel(week, index) {
  return Number(week?.weekIndex || week?.weekNumber || index + 1) || index + 1;
}

function isRace(session = {}) {
  return kindUpper(session) === "RACE";
}

function isCompleted(session = {}) {
  const status = String(session?.status || session?.completionStatus || "").toLowerCase();
  return Boolean(status === "completed" || session?.completedAt || session?.completed === true);
}

function hasWarmCooldown(session = {}) {
  if (!isHard(session)) return true;
  if (toNumber(session?.warmupMin) > 0 && toNumber(session?.cooldownMin) > 0) return true;
  const steps = Array.isArray(session?.workout?.steps) ? session.workout.steps : Array.isArray(session?.steps) ? session.steps : [];
  const flat = [];
  const queue = [...steps];
  while (queue.length) {
    const step = queue.shift();
    if (!step || typeof step !== "object") continue;
    if (String(step?.stepType || "").toLowerCase() === "repeat" && Array.isArray(step.steps)) queue.unshift(...step.steps);
    flat.push(step);
  }
  const types = flat.map((s) => String(s?.stepType || "").toLowerCase());
  return types.includes("warmup") && types.includes("cooldown");
}

function hasTargets(session = {}) {
  if (session?.targetPace || session?.targetHr || session?.workout?.paceTarget || session?.workout?.hrTarget) return true;
  const steps = Array.isArray(session?.workout?.steps) ? session.workout.steps : [];
  if (!steps.length && Array.isArray(session?.workout?.blocks)) return true;
  return steps.some((s) => s?.targetType || s?.targetValue || s?.paceTarget || s?.hrTarget);
}

function stepCount(session = {}) {
  const steps = Array.isArray(session?.workout?.steps) ? session.workout.steps : [];
  let count = 0;
  const queue = [...steps];
  while (queue.length) {
    const step = queue.shift();
    if (!step || typeof step !== "object") continue;
    count += 1;
    if (Array.isArray(step.steps)) queue.unshift(...step.steps);
  }
  return count;
}

function isPreservedTemplateSession(session = {}) {
  return Boolean(
    session?.preserveTemplateStructure === true ||
      session?.meta?.preserveTemplateStructure === true ||
      session?.workout?.preserveTemplateStructure === true ||
      session?.workout?.meta?.preserveTemplateStructure === true
  );
}

function repairSessionKm(session, nextKm, reason, repairsApplied) {
  const beforeKm = getSessionKm(session);
  const km = round1(Math.max(0, Math.min(beforeKm, nextKm)));
  if (km >= beforeKm) return false;
  session.plannedDistanceKm = km;
  session.distanceKm = km;
  session.distance = km;
  session.distanceMeters = Math.round(km * 1000);
  session.budgetedDistanceKm = km;
  session.budgetedComputedKm = km;
  session.meta = {
    ...(session.meta || {}),
    expandedFinalValidation: { reason, beforeKm, afterKm: km },
  };
  if (session.workout && typeof session.workout === "object") {
    session.workout.estimatedDistanceMeters = Math.round(km * 1000);
    session.workout.budgetedEstimatedDistanceMeters = Math.round(km * 1000);
    session.workout.meta = {
      ...(session.workout.meta || {}),
      expandedFinalValidation: { reason, beforeKm, afterKm: km },
    };
  }
  repairsApplied.push({ type: "reduce_session_volume", reason, beforeKm, afterKm: km });
  return true;
}

function recomputeExpandedMetrics(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const plannedWeeklyKm = round1(sessions.reduce((sum, s) => sum + getSessionKm(s), 0));
  const qualityKm = round1(sessions.reduce((sum, s) => sum + (isHard(s) && !isLong(s) ? getSessionKm(s) : 0), 0));
  const longKm = round1(sessions.reduce((sum, s) => sum + (isLong(s) ? getSessionKm(s) : 0), 0));
  const targetWeeklyKm = toNumber(week?.metrics?.targetWeeklyKm) ?? toNumber(week?.targets?.weeklyKm) ?? plannedWeeklyKm;
  week.metrics = {
    ...(week.metrics || {}),
    plannedWeeklyKm,
    computedWeeklyKm: plannedWeeklyKm,
    renderedWeeklyKm: plannedWeeklyKm,
    displayWeeklyKm: plannedWeeklyKm,
    qualityKm,
    qualitySharePct: plannedWeeklyKm > 0 ? round1((qualityKm / plannedWeeklyKm) * 100) : 0,
    displayQualitySharePct: plannedWeeklyKm > 0 ? round1((qualityKm / plannedWeeklyKm) * 100) : 0,
    longRunKm: longKm,
    longRunSharePct: plannedWeeklyKm > 0 ? round1((longKm / plannedWeeklyKm) * 100) : 0,
    displayLongRunSharePct: plannedWeeklyKm > 0 ? round1((longKm / plannedWeeklyKm) * 100) : 0,
    targetWeeklyKm,
    driftKm: round1(targetWeeklyKm - plannedWeeklyKm),
    computedDriftKm: round1(targetWeeklyKm - plannedWeeklyKm),
  };
}

function convertHardToEasyFinal(session, reason, repairsApplied) {
  if (!isHard(session) || isRace(session) || isCompleted(session)) return false;
  const beforeType = kindUpper(session);
  const beforeKm = getSessionKm(session);
  if (isPreservedTemplateSession(session)) {
    const repaired = repairSessionKm(session, beforeKm * 0.75, reason, repairsApplied);
    if (repaired) {
      repairsApplied.push({
        type: "reduce_preserved_template_volume",
        reason,
        beforeType,
        afterType: beforeType,
      });
    }
    return repaired;
  }
  session.type = "EASY";
  session.sessionType = "EASY";
  session.workoutKind = "EASY";
  session.name = "Easy run";
  session.keyTargets = "Comfortable pace";
  session.workout = {
    sport: "running",
    kind: "EASY",
    estimatedDistanceMeters: Math.round(beforeKm * 0.75 * 1000),
    meta: { expandedFinalValidation: { reason, beforeType } },
  };
  repairSessionKm(session, beforeKm * 0.75, reason, repairsApplied);
  repairsApplied.push({ type: "replace_hard_with_easy", reason, beforeType, afterType: "EASY" });
  return true;
}

function addTrace(trace, rule, result, message, repairApplied = false) {
  trace.push({ rule, result, repairApplied, message });
}

function pushIssue(list, code, message, evidence = null) {
  list.push({ code, message, ...(evidence ? { evidence } : {}) });
}

function approvalFrom({ blockers, warnings, safetyScore }) {
  if (blockers.length || safetyScore < 55) return "blocked";
  if (safetyScore < 70 || warnings.length >= 8) return "needs_review";
  if (warnings.length) return "approved_with_warnings";
  return "approved";
}

function goalFromProfile(profile = {}) {
  return normaliseGoalPolicyKey(profile?.goalDistance || profile?.goal?.distance || profile?.goalPolicyKey || "10K");
}

export function runExpandedFinalValidation({
  plan,
  profile = null,
  goalRealism = null,
  readiness = null,
  completedSessions = null,
} = {}) {
  const nextPlan = clone(plan && typeof plan === "object" ? plan : {});
  const blockers = [];
  const warnings = [];
  const repairsApplied = [];
  const validationTrace = [];
  const weeks = Array.isArray(nextPlan?.weeks) ? nextPlan.weeks : [];
  const goalKey = goalFromProfile(profile || nextPlan);
  const experience = String(profile?.current?.experience || profile?.experience || "").toLowerCase();
  const isBeginnerProfile = experience.includes("new") || experience.includes("beginner");
  let safetyScore = 100;

  if (!weeks.length) {
    pushIssue(blockers, "EMPTY_WEEKS", "Plan has no training weeks.");
    addTrace(validationTrace, "structural.empty_weeks", "fail", "Plan has no weeks.");
    safetyScore -= 50;
    return {
      plan: nextPlan,
      validationSummary: {
        blockers,
        warnings,
        repairsApplied,
        safetyScore: Math.max(0, safetyScore),
        approval: "blocked",
      },
      validationTrace,
    };
  }

  const hasRace = weeks.some((w) => (w.sessions || []).some(isRace));
  const raceGoal = ["5k", "10k", "half", "marathon", "ultra"].includes(goalKey);
  if (raceGoal && !hasRace) {
    pushIssue(warnings, "MISSING_RACE_SESSION", "Race-goal plan does not include an explicit race session.");
    addTrace(validationTrace, "structural.missing_race", "warn", "No explicit race session found.");
    safetyScore -= 5;
  }

  let deloadCount = 0;
  let taperWeeks = 0;
  let previousWeeklyKm = null;
  let previousHardDay = null;

  weeks.forEach((week, wi) => {
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    const weekLabel = weekIndexLabel(week, wi);
    const phase = String(week?.phase || week?.targets?.phase || "").toUpperCase();
    if (phase === "DELOAD" || phase === "RECOVERY") deloadCount += 1;
    if (phase === "TAPER") taperWeeks += 1;

    if (!sessions.length) {
      pushIssue(blockers, "WEEK_WITHOUT_SESSIONS", "A training week has no sessions.", { week: weekLabel });
      addTrace(validationTrace, "structural.week_without_sessions", "fail", `Week ${weekLabel} has no sessions.`);
      safetyScore -= 20;
      return;
    }

    if (!sessions.some(isLong) && !sessions.some(isRace) && sessions.length >= 2) {
      pushIssue(warnings, "MISSING_LONG_RUN", "Training week has no long run.", { week: weekLabel });
      addTrace(validationTrace, "structural.missing_long_run", "warn", `Week ${weekLabel} has no long run.`);
      safetyScore -= 4;
    }

    const hardSessions = sessions.filter((s) => isHard(s) && !isLong(s) && !isRace(s));
    if (hardSessions.length > 2) {
      pushIssue(warnings, "TOO_MANY_HARD_SESSIONS", "Week has too many hard sessions.", { week: weekLabel, hardSessions: hardSessions.length });
      hardSessions.slice(2).forEach((s) => convertHardToEasyFinal(s, "too_many_hard_sessions", repairsApplied));
      addTrace(validationTrace, "load.too_many_hard_sessions", "repair", `Week ${weekLabel} hard sessions reduced.`);
      safetyScore -= 8;
    }

    for (const session of sessions) {
      const day = ORDER.indexOf(String(session?.day || "").trim());
      if (isHard(session) && !isLong(session) && !isRace(session)) {
        if (isBeginnerProfile && kindUpper(session) !== "TEMPO") {
          const beforeType = kindUpper(session);
          convertHardToEasyFinal(session, "beginner_advanced_intensity", repairsApplied);
          pushIssue(warnings, "BEGINNER_ADVANCED_INTENSITY", "Beginner profile had advanced intensity and it was replaced.", { week: weekLabel, type: beforeType });
          addTrace(validationTrace, "safety.beginner_intensity", "repair", `Week ${weekLabel} advanced intensity replaced for beginner profile.`, true);
          safetyScore -= 8;
          continue;
        }

        if (previousHardDay && previousHardDay.weekIndex === wi && day >= 0 && day - previousHardDay.day <= 1) {
          convertHardToEasyFinal(session, "consecutive_hard_days", repairsApplied);
          pushIssue(warnings, "CONSECUTIVE_HARD_DAYS", "Back-to-back hard days were repaired.", { week: weekLabel });
          addTrace(validationTrace, "spacing.consecutive_hard_days", "repair", `Week ${weekLabel} hard-day spacing repaired.`, true);
          safetyScore -= 8;
        } else {
          previousHardDay = { weekIndex: wi, day };
        }
      }

      if (isHard(session) && !hasWarmCooldown(session)) {
        pushIssue(warnings, "QUALITY_MISSING_WARM_COOL", "Quality session missing warm-up/cool-down.", { week: weekLabel, type: kindUpper(session) });
        session.warmupMin = session.warmupMin || 10;
        session.cooldownMin = session.cooldownMin || 8;
        repairsApplied.push({ type: "add_warmup_cooldown_fields", week: weekLabel, sessionType: kindUpper(session) });
        addTrace(validationTrace, "garmin.warmup_cooldown", "repair", `Week ${weekLabel} warm/cool fields added.`, true);
        safetyScore -= 4;
      }

      if (isHard(session) && !hasTargets(session)) {
        pushIssue(warnings, "MISSING_TARGETS", "Quality session missing targets.", { week: weekLabel, type: kindUpper(session) });
        session.targetPace = session.targetPace || "controlled";
        repairsApplied.push({ type: "add_generic_target", week: weekLabel, sessionType: kindUpper(session) });
        safetyScore -= 4;
      }

      const steps = stepCount(session);
      if (steps > 80) {
        pushIssue(warnings, "TOO_MANY_GARMIN_STEPS", "Workout has too many device steps.", { week: weekLabel, steps });
        addTrace(validationTrace, "garmin.too_many_steps", "warn", `Week ${weekLabel} has ${steps} steps.`);
        safetyScore -= 3;
      }

      const trace = session?.meta?.workoutSelectionTrace || session?.workout?.meta?.workoutSelectionTrace;
      if (trace && Number(trace.score) < 55) {
        pushIssue(warnings, "LOW_WORKOUT_SELECTION_SCORE", "Workout scoring selected a low-confidence workout.", { week: weekLabel, score: trace.score });
        convertHardToEasyFinal(session, "low_workout_selection_score", repairsApplied);
        safetyScore -= 6;
      }
    }

    recomputeExpandedMetrics(week);
    const weeklyKm = toNumber(week?.metrics?.plannedWeeklyKm) ?? 0;
    const qualityShare = toNumber(week?.metrics?.qualitySharePct) ?? 0;
    const longShare = toNumber(week?.metrics?.longRunSharePct) ?? 0;

    if (previousWeeklyKm != null && previousWeeklyKm > 0 && phase !== "DELOAD" && phase !== "TAPER" && phase !== "RECOVERY") {
      const rampPct = ((weeklyKm - previousWeeklyKm) / previousWeeklyKm) * 100;
      if (rampPct > 15) {
        pushIssue(warnings, "WEEKLY_RAMP_TOO_STEEP", "Weekly volume ramp is too steep.", { week: weekLabel, rampPct: round1(rampPct) });
        capWeekSessionsForFinal(week, previousWeeklyKm * 1.1, repairsApplied, "weekly_ramp_too_steep");
        addTrace(validationTrace, "load.weekly_ramp", "repair", `Week ${weekLabel} volume capped.`, true);
        safetyScore -= 8;
      }
    }
    previousWeeklyKm = weeklyKm;

    if (longShare > 42 && !sessions.some(isRace)) {
      const long = sessions.find(isLong);
      if (long) {
        repairSessionKm(long, getSessionKm(long) * 0.85, "long_run_share_too_high", repairsApplied);
        recomputeExpandedMetrics(week);
        pushIssue(warnings, "LONG_RUN_SHARE_TOO_HIGH", "Long-run share was too high and reduced.", { week: weekLabel, longSharePct: longShare });
        addTrace(validationTrace, "load.long_run_share", "repair", `Week ${weekLabel} long run reduced.`, true);
        safetyScore -= 6;
      }
    }

    if (qualityShare > (phase === "TAPER" || phase === "DELOAD" ? 28 : 34)) {
      hardSessions.forEach((s) => repairSessionKm(s, getSessionKm(s) * 0.85, "quality_share_too_high", repairsApplied));
      recomputeExpandedMetrics(week);
      pushIssue(warnings, "QUALITY_SHARE_TOO_HIGH", "Intensity distribution was too aggressive and reduced.", { week: weekLabel, qualitySharePct: qualityShare });
      addTrace(validationTrace, "load.quality_share", "repair", `Week ${weekLabel} quality reduced.`, true);
      safetyScore -= 7;
    }

    if ((phase === "RECOVERY" || phase === "DELOAD") && hardSessions.length > 1) {
      hardSessions.slice(1).forEach((s) => convertHardToEasyFinal(s, "recovery_week_too_hard", repairsApplied));
      pushIssue(warnings, "RECOVERY_WEEK_TOO_HARD", "Recovery week had too much hard work.", { week: weekLabel });
      safetyScore -= 6;
    }

    if (phase === "TAPER" && qualityShare > 24) {
      hardSessions.forEach((s) => repairSessionKm(s, getSessionKm(s) * 0.8, "taper_too_heavy", repairsApplied));
      pushIssue(warnings, "TAPER_TOO_HEAVY", "Taper week load reduced.", { week: weekLabel });
      safetyScore -= 6;
    }

    week.days = buildWeekDaysCanonical({
      sessions: stableSortSessionsByDayThenOriginal(week.sessions || []).map(ensureWorkoutShell),
      runDays: Array.isArray(week.runDays) ? week.runDays : [],
    });
    week.sessions = stableSortSessionsByDayThenOriginal(week.sessions || []).map(ensureWorkoutShell);
    recomputeExpandedMetrics(week);
  });

  if (weeks.length >= 8 && deloadCount === 0) {
    pushIssue(warnings, "NO_DELOAD_FOR_LONG_PLAN", "Long plan has no deload/recovery week.");
    addTrace(validationTrace, "load.no_deload", "warn", "No deload/recovery week found.");
    safetyScore -= 5;
  }

  if (raceGoal && hasRace && taperWeeks === 0 && weeks.length >= 6) {
    pushIssue(warnings, "NO_TAPER_BEFORE_RACE", "Race plan has no taper phase.");
    addTrace(validationTrace, "race.no_taper", "warn", "No taper phase before race.");
    safetyScore -= 8;
  }

  if (goalKey === "marathon") {
    const maxLong = Math.max(...weeks.flatMap((w) => (w.sessions || []).filter(isLong).map(getSessionKm)), 0);
    if (maxLong < 24) {
      pushIssue(warnings, "MARATHON_LONG_RUN_INSUFFICIENT", "Marathon plan long runs look insufficient.", { maxLongRunKm: round1(maxLong) });
      safetyScore -= 8;
    }
  }

  if (goalKey === "ultra") {
    const maxLong = Math.max(...weeks.flatMap((w) => (w.sessions || []).filter(isLong).map(getSessionKm)), 0);
    if (maxLong < 28) {
      pushIssue(warnings, "ULTRA_LONG_RUN_INSUFFICIENT", "Ultra plan may lack enough time-on-feet/long-run stimulus.", { maxLongRunKm: round1(maxLong) });
      safetyScore -= 10;
    }
  }

  if (goalKey === "5k") {
    const avgLongShare = weeks.length
      ? weeks.reduce((sum, w) => sum + (toNumber(w?.metrics?.longRunSharePct) ?? 0), 0) / weeks.length
      : 0;
    if (avgLongShare > 38) {
      pushIssue(warnings, "FIVE_K_TOO_MARATHON_LIKE", "5K plan is too long-run dominant.");
      safetyScore -= 5;
    }
  }

  if (goalRealism?.level === "unsafe") {
    pushIssue(blockers, "UNSAFE_GOAL_REALISM", "Goal realism is unsafe.");
    safetyScore -= 20;
  } else if (goalRealism?.level === "aggressive") {
    pushIssue(warnings, "AGGRESSIVE_GOAL_REALISM", "Goal realism is aggressive.");
    safetyScore -= 8;
  }

  if (readiness?.illness || readiness?.injuryPain) {
    pushIssue(warnings, "READINESS_HEALTH_FLAG", "Illness/injury readiness flag present.");
    safetyScore -= 10;
  }

  const paceModel = profile?.paceModel && typeof profile.paceModel === "object" ? profile.paceModel : null;
  if (paceModel) {
    const confidence = toNumber(paceModel.confidence);
    const hasHrFallback = Boolean(paceModel?.hrZones?.zones);
    if (confidence != null && confidence < 45 && !hasHrFallback) {
      pushIssue(warnings, "LOW_PACE_CONFIDENCE_NO_HR_FALLBACK", "Pace model confidence is low and no HR fallback is available.");
      addTrace(validationTrace, "pace.low_confidence_no_hr", "warn", "Low-confidence pace model lacks HR fallback.");
      safetyScore -= 6;
    }

    if (paceModel?.adjustments?.preferEffortTargets === true) {
      const strictPaceSessions = weeks
        .flatMap((w) => (Array.isArray(w.sessions) ? w.sessions : []))
        .filter((s) => !isRace(s) && (s?.targetPace || s?.workout?.paceTarget));
      if (strictPaceSessions.length) {
        pushIssue(warnings, "STRICT_PACE_IN_EFFORT_MODE", "Effort/HR mode still has strict pace targets.");
        addTrace(validationTrace, "pace.effort_mode_targets", "warn", "Effort/HR mode found sessions with pace targets.");
        safetyScore -= 4;
      }
    }

    if (paceModel?.adjustments?.treadmill === true) {
      const treadmillTargets = weeks
        .flatMap((w) => (Array.isArray(w.sessions) ? w.sessions : []))
        .filter((s) => s?.targetTreadmillKph || s?.workout?.treadmillSpeedKph);
      if (!treadmillTargets.length) {
        pushIssue(warnings, "TREADMILL_SPEED_MISSING", "Treadmill pace model did not produce km/h targets.");
        addTrace(validationTrace, "pace.treadmill_speed", "warn", "No treadmill speed targets found.");
        safetyScore -= 4;
      }
    }
  }

  const safetyScoreFinal = Math.max(0, Math.min(100, Math.round(safetyScore)));
  const approval = approvalFrom({ blockers, warnings, safetyScore: safetyScoreFinal });
  nextPlan.expandedFinalValidation = {
    blockers,
    warnings,
    repairsApplied,
    safetyScore: safetyScoreFinal,
    approval,
  };

  return {
    plan: nextPlan,
    validationSummary: nextPlan.expandedFinalValidation,
    validationTrace,
  };
}

function capWeekSessionsForFinal(week, targetKm, repairsApplied, reason) {
  const target = Number(targetKm);
  if (!Number.isFinite(target) || target <= 0) return false;
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const current = sessions.reduce((sum, s) => sum + getSessionKm(s), 0);
  if (current <= target || current <= 0) return false;
  const factor = target / current;
  for (const s of sessions) {
    if (isRace(s) || isCompleted(s)) continue;
    repairSessionKm(s, getSessionKm(s) * factor, reason, repairsApplied);
  }
  recomputeExpandedMetrics(week);
  return true;
}

function applyWeeklyDistanceIfPossible(sessions, weeklyKmTarget) {
  const target = Number(weeklyKmTarget);
  if (!Number.isFinite(target) || target <= 0) return sessions;

  const haveAny = sessions.some((s) => typeof s.distanceKm === "number" || typeof s.plannedDistanceKm === "number");
  if (!haveAny) return sessions;

  const total = sessions.reduce((sum, s) => {
    const km = typeof s.plannedDistanceKm === "number" ? s.plannedDistanceKm : Number(s.distanceKm) || 0;
    return sum + (Number(km) || 0);
  }, 0);

  if (total <= 0) return sessions;

  let diff = round1(target - total);
  if (Math.abs(diff) < 1.0) return sessions;

  const MIN_EASY_KM = 0.5;
  const MAX_EASY_KM = 24;

  const easyIdx = sessions
    .map((s, i) => (kindUpper(s) === "EASY" && !hasStructuredWorkout(s) ? i : -1))
    .filter((i) => i >= 0);

  const longIdx = sessions.findIndex((s) => isLong(s) && !hasStructuredWorkout(s));

  if (easyIdx.length > 0) {
    const easyBases = easyIdx.map((i) => {
      const km = typeof sessions[i].plannedDistanceKm === "number" ? sessions[i].plannedDistanceKm : Number(sessions[i].distanceKm) || 0;
      return Math.max(0, km);
    });

    const easySum = easyBases.reduce((a, b) => a + b, 0) || easyIdx.length;

    let remaining = diff;
    const updated = sessions.map((s) => ({ ...s }));

    for (let k = 0; k < easyIdx.length; k++) {
      const i = easyIdx[k];
      const base = easyBases[k];
      const weight = easySum > 0 ? base / easySum : 1 / easyIdx.length;

      const delta = k === easyIdx.length - 1 ? remaining : round1(remaining * weight);

      const cur = typeof updated[i].plannedDistanceKm === "number" ? updated[i].plannedDistanceKm : Number(updated[i].distanceKm) || 0;
      const next = clamp(cur + delta, MIN_EASY_KM, MAX_EASY_KM);

      const applied = round1(next - cur);
      remaining = round1(remaining - applied);

      const v = round1(next);
      updated[i] = {
        ...updated[i],
        plannedDistanceKm: v,
        distanceKm: v,
        distance: v,
        distanceMeters: Math.round(v * 1000),
        notes: `${updated[i]?.notes || ""}${updated[i]?.notes ? " " : ""}(Adjusted to match weekly target)`.trim(),
      };
    }

    diff = remaining;
    if (Math.abs(diff) < 1.0) return updated;
    sessions = updated;
  }

  if (longIdx >= 0 && Math.abs(diff) >= 1.0) {
    const cur = typeof sessions[longIdx].plannedDistanceKm === "number" ? sessions[longIdx].plannedDistanceKm : Number(sessions[longIdx].distanceKm) || 0;

    const next = clamp(cur + diff, LR_MIN, LR_MAX);

    const applied = round1(next - cur);
    if (Math.abs(applied) >= 0.1) {
      const updated = sessions.map((s, i) => {
        if (i !== longIdx) return s;
        const v = round1(next);
        return {
          ...s,
          plannedDistanceKm: v,
          distanceKm: v,
          distance: v,
          distanceMeters: Math.round(v * 1000),
          notes: `${s?.notes || ""}${s?.notes ? " " : ""}(Adjusted to match weekly target)`.trim(),
        };
      });

      return updated;
    }
  }

  return sessions;
}
