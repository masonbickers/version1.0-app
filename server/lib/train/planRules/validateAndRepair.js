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
      ...(Array.isArray(base?.workout?.steps) ? { steps: base.workout.steps } : {}),
      ...(Array.isArray(base?.workout?.blocks) ? { blocks: base.workout.blocks } : {}),
      ...(base?.workout?.tempo ? { tempo: base.workout.tempo } : {}),
      ...(base?.workout?.legacy ? { legacy: base.workout.legacy } : {}),
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
  if (Number.isFinite(Number(runDaysCount)) && Number(runDaysCount) === 1) {
    return 1;
  }
  if (Number.isFinite(Number(runDaysCount)) && Number(runDaysCount) > 0 && Number(runDaysCount) <= 3) {
    return Math.min(conservativeGlobal, phaseCap);
  }
  return phaseCap;
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
  const longCap = clamp(longCapByPct, LR_MIN, LR_MAX);
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
    const longCap = clamp(longCapByWeek, LR_MIN, LR_MAX);
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
    const longCap = clamp(longCapByWeek, LR_MIN, LR_MAX);
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
    const longCap = clamp(longCapByWeek, LR_MIN, LR_MAX);

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

function ensureLongRunMinimal({ sessions, sk, tgt, runDays }) {
  const out = Array.isArray(sessions) ? [...sessions] : [];
  if (out.some((s) => isLong(s))) return { sessions: out, added: false };

  let longDay = pickLongDayFromSkeleton(sk, out);
  if (Array.isArray(runDays) && runDays.length && !runDays.includes(longDay)) {
    longDay = runDays.includes("Sun") ? "Sun" : runDays[runDays.length - 1];
  }

  const longKmFromTarget = toNumber(tgt?.longRunKm);
  const longKm = longKmFromTarget != null ? clamp(longKmFromTarget, LR_MIN, LR_MAX) : LR_MIN;

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

function repairWeeklyDriftMinimal({ sessions, weeklyTargetKm }) {
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
      const i = 0;
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
        const longFloor = out.length > 1 ? LR_MIN : 0.5;
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
    });
    let finalSessions = drift.sessions;
    guardrailEdits += drift.edits;
    guardrailNotes.push(...drift.notes);

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
