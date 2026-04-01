// server/lib/train/planRules/garminSteps.js
// Builds Garmin-style workouts with steps/repeats + warmup/cooldown.
//
// OPTION A (Runna-like):
// - Quality sessions (INTERVALS / TEMPO / THRESHOLD / STRIDES) get warmup + cooldown steps.
// - EASY + LONG do NOT get warmup/cooldown steps; they are a single steady run.
// - Distances for EASY + LONG are NOT inflated by warm/cool. plannedDistanceKm is the total run distance.
// - plannedDistanceKm is budget intent.
// - executable/rendered/computed fields and estimated meters are step-derived and mutually consistent.
// - Budget values remain available via explicit budgeted* fields.
//
// ✅ Renderer-first design:
// - If session.workout has blueprint `blocks`, render those into Garmin steps.
// - If session.workout already has meaningful structured `steps`, KEEP them (prevents mismatch).
// - If session.workout is legacy/simple (interval reps/repDistanceM/recovery), render that.
// - Otherwise fall back to older “invented” builders (backwards compatibility).
//
// ✅ Invariants enforced here:
// 1) Never changes training intent.
// 2) If meaningful steps already exist, keep them.
// 3) warmup+cooldown-only is NOT considered meaningful.
// 4) attachGarminStepsToSessions computes workouts ONCE per week.sessions, then syncs week.days.
//
// ✅ CRITICAL FIX (distance contract):
// - plannedDistanceKm remains the week budget from fillSessions.js.
// - budgetedComputedKm follows the budget contract (same meaning as plannedDistanceKm).
// - computedTotalKm / renderedDistanceKm / executableDistanceKm are step-derived executable totals.
// - buildGarminWorkoutForSession always uses plannedDistanceKm first (never distanceKm first).
// - explicit alias fields are added so API consumers can read semantics without guesswork:
//   budgetedDistanceKm/budgetedComputedKm and renderedDistanceKm/renderedComputedTotalKm.
//
// ✅ UPDATE IN THIS VERSION (HR targets + Runna-like defaults):
// - Adds HR targets (hr_range) where pace targets are not provided.
//   - EASY/LONG main steady step: Z2
//   - Warmup/Cooldown/Recovery steps: Z1
//   - Any step with targetType "none" gets an HR fallback if zones exist.
// - Keeps existing pace_range targets for quality work (intervals/tempo/etc).
// - Does NOT change distances or workout intent.
//
// ✅ UPDATE IN THIS VERSION (Intervals blocks contract):
// - Supports intervalWorkouts.js "blocks" including FILL_DISTANCE.
// - FILL_DISTANCE renders as an EASY cooldown distance step (HR Z1 fallback if no pace target).
// - Keeps filler out of labels (intervalWorkouts handles that), but renderer must execute it.
//
// ✅ UPDATE IN THIS VERSION (Preserve blueprint fields):
// - If a session has workout.blocks / workout.variant, we preserve them on the final workout object
//   so API consumers (and your curl/jq) can see them.
//
// ✅ FIX IN THIS VERSION (variant null):
// - If blueprint.variant is null/empty but blocks exist, infer a stable variant string.
// - If blueprint.meta.specPickId exists, prefer that as the variant (good debug ID).
//
// Notes:
// - Step schema supports one targetType; we keep pace_range where present,
//   otherwise we attach hr_range.
// - hr_range targetValue is { minBpm, maxBpm }.

function round(n) {
  return Math.round(n);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseTimeToSeconds(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s) return null;

  const parts = s.split(":").map((x) => x.trim());
  if (parts.length === 3) {
    const [hh, mm, ss] = parts.map(Number);
    if ([hh, mm, ss].some((v) => !Number.isFinite(v))) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  if (parts.length === 2) {
    const [mm, ss] = parts.map(Number);
    if ([mm, ss].some((v) => !Number.isFinite(v))) return null;
    return mm * 60 + ss;
  }
  const maybeMin = Number(s);
  if (Number.isFinite(maybeMin)) return Math.round(maybeMin * 60);
  return null;
}

/* ───────────────────────────────────────────
   Preserve blueprint fields on final workout
─────────────────────────────────────────── */

// helper: detect filler blocks (Runna top-up)
function isFillerBlock(b) {
  return b && typeof b === "object" && String(b.type || "").toUpperCase() === "FILL_DISTANCE";
}

// helper: infer a non-null variant from blocks (only used if blueprint variant is missing)
function inferVariantFromBlocks(blocks = [], fallbackGoalKey = "GENERAL") {
  const arr = Array.isArray(blocks) ? blocks : [];
  if (!arr.length) return null;

  const hasFill = arr.some(isFillerBlock);
  const real = arr.filter((b) => !isFillerBlock(b));
  const b0 = real[0] || arr[0];
  if (!b0 || typeof b0 !== "object") return null;

  const t = String(b0.type || "").toUpperCase();
  let base = null;

  if (t === "REPEAT_DISTANCE") {
    const reps = Number(b0.reps || 0) || 6;
    const workM = Number(b0.workM || 0) || 400;
    base = `${fallbackGoalKey}_REPEAT_${reps}x${workM}m`;
  } else if (t === "ON_OFF_KM" || t === "ON_OFF_DISTANCE") {
    const reps = Number(b0.reps || 0) || 4;
    const onM = Number(b0.onM || 0) || 1000;
    const offM = Number(b0.offM || 0) || 1000;
    base = `${fallbackGoalKey}_ONOFF_${reps}x${onM}on_${offM}off`;
  } else if (t === "PYRAMID_DISTANCE") {
    const repsM = Array.isArray(b0.repsM)
      ? b0.repsM.map(Number).filter((x) => Number.isFinite(x) && x > 0)
      : [];
    const mn = repsM.length ? Math.min(...repsM) : 0;
    const mx = repsM.length ? Math.max(...repsM) : 0;
    base = `${fallbackGoalKey}_LADDER_${mn}_${mx}`;
  } else if (t === "MIXED_SET") {
    const sets = Number(b0.sets || 0) || 1;
    base = `${fallbackGoalKey}_MIXED_${sets}set`;
  } else if (t === "OVER_UNDER_1K") {
    const reps = Number(b0.reps || 0) || 4;
    base = `${fallbackGoalKey}_OVERUNDER_${reps}x1k`;
  } else if (t === "BROKEN_K" || t === "BROKEN_DISTANCE") {
    const reps = Number(b0.reps || 0) || 4;
    const d = Number(b0.distanceM || 1000) || 1000;
    base = `${fallbackGoalKey}_BROKEN_${reps}x${d}m`;
  } else if (t === "FLOATING") {
    const reps = Number(b0.reps || 0) || 6;
    const workM = Number(b0.workM || 0) || 400;
    base = `${fallbackGoalKey}_FLOAT_${reps}x${workM}m`;
  } else if (t === "REPEAT_TIME" || t === "CRUISE_TIME" || t === "HILL_REPEAT_TIME") {
    const reps = Number(b0.reps || 0) || 6;
    const workSec = Number(b0.workSec || b0.seconds || 0) || 0;
    base = `${fallbackGoalKey}_${t}_${reps}x${workSec}s`;
  } else if (t) {
    base = `${fallbackGoalKey}_${t}`;
  }

  if (!base) return null;
  return hasFill ? `${base}_PLUS_FILL` : base;
}

function resolveVariantFromBlueprint(bp, w) {
  // 1) explicit variant on bp or workout
  const v0 = bp?.variant ?? w?.variant;
  const v = String(v0 ?? "").trim();
  if (v) return v;

  // 2) stable ID (your meta already has this)
  const spec = String(bp?.meta?.specPickId ?? "").trim();
  if (spec) return spec;

  // 3) infer from blocks (when blocks exist)
  const goalKey = String(bp?.meta?.goalKey ?? bp?.meta?.goal ?? "GENERAL").toUpperCase() || "GENERAL";
  const inferred = inferVariantFromBlocks(bp?.blocks, goalKey);
  return inferred || null;
}

function preserveBlueprintFields(bp, w) {
  if (!bp || typeof bp !== "object") return w;
  if (!w || typeof w !== "object") return w;
  const resolvedVariant = resolveVariantFromBlueprint(bp, w);
  const mergedMeta = { ...(bp.meta || {}), ...(w.meta || {}) };
  const cleanedMeta = { ...mergedMeta };

  // Remove noisy fit/debug breadcrumbs that frequently become stale after repairs/guardrails.
  delete cleanedMeta.fitSteps;
  delete cleanedMeta.seed;
  delete cleanedMeta.candidates;
  delete cleanedMeta.chosenFromPoolIndex;
  delete cleanedMeta.usedWeekWeeklyKm;

  if (resolvedVariant && (bp?.meta?.specPickId || cleanedMeta?.specPickId)) {
    cleanedMeta.specPickId = resolvedVariant;
    if (bp?.meta?.pickedId != null || cleanedMeta.pickedId != null) cleanedMeta.pickedId = resolvedVariant;
  }

  return {
    ...w,
    // ✅ keep blueprint-first fields visible after garmin rendering
    // ✅ never leave variant null if we can infer it (blocks/specPickId)
    variant: resolvedVariant,

    blocks: Array.isArray(bp.blocks) ? bp.blocks : Array.isArray(w.blocks) ? w.blocks : [],
    title: bp.title ?? w.title,
    notes: bp.notes ?? w.notes,
    keyTargets: bp.keyTargets ?? w.keyTargets,
    meta: cleanedMeta,
  };
}

/* ───────────────────────────────────────────
   HR target helpers (Runna-like defaults)
─────────────────────────────────────────── */

function getHrZones(profile = {}) {
  const z =
    (profile?.hrZones && typeof profile.hrZones === "object" ? profile.hrZones : null) ||
    (profile?.personalization?.hrZones && typeof profile.personalization.hrZones === "object"
      ? profile.personalization.hrZones
      : null) ||
    null;

  if (!z || typeof z !== "object") return null;
  if (!z.zones || typeof z.zones !== "object") return null;
  return z;
}

function hrRangeForZone(profile, zoneKey) {
  const hrz = getHrZones(profile);
  if (!hrz) return null;

  const key = String(zoneKey || "").toLowerCase().trim(); // "z1"..."z5"
  const z = hrz?.zones?.[key];
  if (!z || typeof z !== "object") return null;

  const min = toNum(z.min);
  const max = toNum(z.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || max < min) return null;

  return { minBpm: round(min), maxBpm: round(max) };
}

function hrTarget(profile, zoneKey) {
  const range = hrRangeForZone(profile, zoneKey);
  if (!range) return { targetType: "none", targetValue: null };
  return { targetType: "hr_range", targetValue: range };
}

// Apply HR fallback only if targetType is "none" or missing
function applyHrFallbackToStep(step, profile, ctxKind) {
  if (!step || typeof step !== "object") return step;

  // recurse into repeat blocks
  if (String(step.stepType || "").toLowerCase() === "repeat" && Array.isArray(step.steps)) {
    return { ...step, steps: step.steps.map((st) => applyHrFallbackToStep(st, profile, ctxKind)) };
  }

  const tt = String(step.targetType || "none").toLowerCase();
  if (tt && tt !== "none") return step; // keep pace_range or any other explicit target

  const st = String(step.stepType || "").toLowerCase();
  const kind = String(ctxKind || "").toUpperCase();

  // Runna-like defaults:
  // - Warmup/Cooldown/Recovery: Z1
  // - EASY/LONG steady: Z2
  // - Other steady segments without pace: Z2
  let zone = null;

  if (st === "warmup" || st === "cooldown" || st === "recovery") {
    zone = "z1";
  } else if (st === "steady") {
    if (kind === "EASY" || kind === "LONG") zone = "z2";
    else zone = "z2";
  } else if (st === "tempo") {
    zone = kind === "LONG" ? "z3" : "z3";
  }

  if (!zone) return step;

  const tgt = hrTarget(profile, zone);
  if (tgt.targetType === "none") return step;

  return { ...step, targetType: tgt.targetType, targetValue: tgt.targetValue };
}

function applyHrFallbackToSteps(steps, profile, ctxKind) {
  if (!Array.isArray(steps)) return steps;
  return steps.map((s) => applyHrFallbackToStep(s, profile, ctxKind));
}

/**
 * Pace anchor should use *normalised* profile if provided.
 */
function calc10kPaceSecPerKm(profile = {}) {
  if (
    profile?.paces?.raceSecPerKm != null &&
    Number.isFinite(profile.paces.raceSecPerKm) &&
    profile.paces.raceSecPerKm > 0
  ) {
    return profile.paces.raceSecPerKm;
  }

  if (
    profile?.recentRace &&
    Number.isFinite(profile.recentRace.timeSec) &&
    Number.isFinite(profile.recentRace.distanceKm) &&
    profile.recentRace.timeSec > 0 &&
    profile.recentRace.distanceKm > 0
  ) {
    return profile.recentRace.timeSec / profile.recentRace.distanceKm;
  }

  const goal = profile.goal || {};
  const recent = profile.current?.recentTimes || profile.recentTimes || {};

  const tenKTarget = parseTimeToSeconds(goal.targetTime);
  if (tenKTarget) return tenKTarget / 10;

  const tenKRecent = parseTimeToSeconds(recent.tenK);
  if (tenKRecent) return tenKRecent / 10;

  const fiveK = parseTimeToSeconds(recent.fiveK);
  if (fiveK) {
    const fiveKPace = fiveK / 5;
    const bump = fiveKPace < 220 ? 12 : fiveKPace < 260 ? 15 : 18;
    return fiveKPace + bump;
  }

  return 270; // 4:30/km default
}

function paceToTargetRange(paceSecPerKm, toleranceSec = 8) {
  const min = round(paceSecPerKm - toleranceSec);
  const max = round(paceSecPerKm + toleranceSec);
  return { minSecPerKm: min, maxSecPerKm: max };
}

function warmupStep({ seconds = 720, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "warmup",
    durationType: "time",
    durationValue: round(seconds),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function cooldownStep({ seconds = 600, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "cooldown",
    durationType: "time",
    durationValue: round(seconds),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function cooldownStepDistance({ meters = 200, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "cooldown",
    durationType: "distance",
    durationValue: round(meters),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function steadyStepDistance({ meters, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "steady",
    durationType: "distance",
    durationValue: round(meters),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function steadyStepTime({ seconds, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "steady",
    durationType: "time",
    durationValue: round(seconds),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function recoveryStep({ seconds = 75, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "recovery",
    durationType: "time",
    durationValue: round(seconds),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function recoveryStepDistance({ meters = 200, targetType = "none", targetValue = null }) {
  const step = {
    stepType: "recovery",
    durationType: "distance",
    durationValue: round(meters),
    targetType,
  };
  if (targetValue != null) step.targetValue = targetValue;
  return step;
}

function repeatBlock({ repeatCount, steps }) {
  return {
    stepType: "repeat",
    repeatCount: round(repeatCount),
    steps,
  };
}

/**
 * OPTION A RULE:
 * - Only quality sessions get default warm/cool.
 * - EASY + LONG default warm/cool to 0, always.
 */
function isQualityKind(kindHint) {
  const k = String(kindHint || "").toUpperCase();
  return k === "INTERVALS" || k === "TEMPO" || k === "THRESHOLD" || k === "STRIDES";
}

/**
 * Resolve warmup/cooldown seconds.
 */
function resolveWarmCooldownSec({ session, blueprint, kindHint }) {
  const k = String(kindHint || "").toUpperCase();

  const defaultWarm = isQualityKind(k) ? 15 * 60 : 0;
  const defaultCool = isQualityKind(k) ? 10 * 60 : 0;

  if (k === "EASY" || k === "LONG") {
    return { warmupSec: 0, cooldownSec: 0 };
  }

  const sWarm = toNum(session?.warmupSec);
  const sCool = toNum(session?.cooldownSec);

  const bWarm = toNum(blueprint?.warmupSec);
  const bCool = toNum(blueprint?.cooldownSec);

  const mWarm = toNum(blueprint?.meta?.warmupSec);
  const mCool = toNum(blueprint?.meta?.cooldownSec);

  const warmupSec = sWarm ?? bWarm ?? mWarm ?? defaultWarm;
  const cooldownSec = sCool ?? bCool ?? mCool ?? defaultCool;

  return {
    warmupSec: clamp(warmupSec, 0, 30 * 60),
    cooldownSec: clamp(cooldownSec, 0, 30 * 60),
  };
}

function injectKindIntoWorkout(kind, workout) {
  const k = String(kind || "").toUpperCase();
  const w = workout && typeof workout === "object" ? workout : {};
  return { ...w, kind: k || String(w.kind || "EASY").toUpperCase() };
}

function normalizeLongRunSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((st) => {
    if (!st || typeof st !== "object") return st;
    if (String(st.stepType || "").toLowerCase() === "repeat" && Array.isArray(st.steps)) {
      return { ...st, steps: normalizeLongRunSteps(st.steps) };
    }
    if (
      String(st.stepType || "").toLowerCase() === "recovery" &&
      String(st.durationType || "").toLowerCase() === "distance"
    ) {
      return { ...st, stepType: "steady" };
    }
    return st;
  });
}

function getSessionKind(session) {
  const raw = session?.workoutKind || session?.type || session?.sessionType || session?.workout?.kind || "EASY";
  return String(raw).toUpperCase();
}

function getBlueprintKind(session) {
  const raw = session?.workout?.kind || null;
  return raw ? String(raw).toUpperCase() : null;
}

/**
 * Detect whether steps already represent a meaningful structured workout.
 * warmup+cooldown-only is NOT considered meaningful.
 */
function isStructuredSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return false;

  const types = steps.map((s) => String(s?.stepType || "").toLowerCase());
  const hasWarmup = types.includes("warmup");
  const hasCooldown = types.includes("cooldown");
  const hasRepeat = types.includes("repeat");
  const hasSteady = types.includes("steady");

  if (hasRepeat || hasSteady) return true;
  if (hasWarmup && hasCooldown && steps.length <= 2) return false;
  return hasWarmup && hasCooldown && steps.length > 2;
}

function sameTarget(a, b) {
  const ta = String(a?.targetType || "").toLowerCase();
  const tb = String(b?.targetType || "").toLowerCase();
  if (ta !== tb) return false;
  const va = a?.targetValue ?? null;
  const vb = b?.targetValue ?? null;
  return JSON.stringify(va) === JSON.stringify(vb);
}

// Normalize legacy "repeatCount N + one trailing steady rep" into repeatCount N+1.
function normalizeRepeatEncoding(steps) {
  const arr = Array.isArray(steps) ? [...steps] : [];
  for (let i = 0; i < arr.length - 1; i++) {
    const cur = arr[i];
    const nxt = arr[i + 1];
    if (String(cur?.stepType || "").toLowerCase() !== "repeat" || !Array.isArray(cur?.steps)) continue;
    const work = cur.steps.find((st) => String(st?.stepType || "").toLowerCase() === "steady");
    if (!work) continue;
    if (String(nxt?.stepType || "").toLowerCase() !== "steady") continue;
    if (String(nxt?.durationType || "").toLowerCase() !== String(work?.durationType || "").toLowerCase()) continue;
    if (Math.round(toNum(nxt?.durationValue) ?? -1) !== Math.round(toNum(work?.durationValue) ?? -2)) continue;
    if (!sameTarget(nxt, work)) continue;

    const repCount = Math.max(1, Math.round(toNum(cur?.repeatCount) ?? 1));
    arr[i] = { ...cur, repeatCount: repCount + 1 };
    arr.splice(i + 1, 1);
  }
  return arr;
}

// Collapse adjacent cooldown steps into one to avoid emitting
// `... repeat, cooldown, cooldown` after filler rendering.
function normalizeCooldownEncoding(steps, profile) {
  const arr = Array.isArray(steps) ? [...steps] : [];
  const cooldownSecPerKm = estimateEasySecPerKm(profile);

  const metersToSec = (m) => {
    const meters = Math.max(0, toNum(m) ?? 0);
    if (!meters || !Number.isFinite(cooldownSecPerKm) || cooldownSecPerKm <= 0) return 0;
    return round((meters / 1000) * cooldownSecPerKm);
  };

  for (let i = 0; i < arr.length - 1; i++) {
    const cur = arr[i];
    const nxt = arr[i + 1];
    if (String(cur?.stepType || "").toLowerCase() !== "cooldown") continue;
    if (String(nxt?.stepType || "").toLowerCase() !== "cooldown") continue;

    const curType = String(cur?.durationType || "").toLowerCase();
    const nxtType = String(nxt?.durationType || "").toLowerCase();

    if (curType === "time" && nxtType === "time" && sameTarget(cur, nxt)) {
      arr[i] = { ...cur, durationValue: round((toNum(cur.durationValue) ?? 0) + (toNum(nxt.durationValue) ?? 0)) };
      arr.splice(i + 1, 1);
      i--;
      continue;
    }

    if (curType === "distance" && nxtType === "distance" && sameTarget(cur, nxt)) {
      arr[i] = { ...cur, durationValue: round((toNum(cur.durationValue) ?? 0) + (toNum(nxt.durationValue) ?? 0)) };
      arr.splice(i + 1, 1);
      i--;
      continue;
    }

    if (curType === "distance" && nxtType === "time") {
      arr[i + 1] = {
        ...nxt,
        durationType: "time",
        durationValue: round((toNum(nxt.durationValue) ?? 0) + metersToSec(cur.durationValue)),
      };
      arr.splice(i, 1);
      i--;
      continue;
    }

    if (curType === "time" && nxtType === "distance") {
      arr[i] = {
        ...cur,
        durationType: "time",
        durationValue: round((toNum(cur.durationValue) ?? 0) + metersToSec(nxt.durationValue)),
      };
      arr.splice(i + 1, 1);
      i--;
    }
  }
  return arr;
}

function buildEasyWorkout({ meters, profile }) {
  const tgt = hrTarget(profile, "z2");
  return {
    sport: "running",
    estimatedDistanceMeters: round(meters),
    steps: [steadyStepDistance({ meters, targetType: tgt.targetType, targetValue: tgt.targetValue })],
  };
}

function buildLongWorkout({ meters, profile }) {
  const tgt = hrTarget(profile, "z2");
  return {
    sport: "running",
    estimatedDistanceMeters: round(meters),
    steps: [steadyStepDistance({ meters, targetType: tgt.targetType, targetValue: tgt.targetValue })],
  };
}

/**
 * STRIDES: special-case
 */
function buildStridesWorkout({ meters, profile, session }) {
  const bp = session?.workout && typeof session.workout === "object" ? session.workout : {};
  const reps = Number(bp?.reps || 6) || 6;
  const repDistanceM = Number(bp?.repDistanceM || 80) || 80;
  const recSec = Number(bp?.recovery?.valueSec || 60) || 60;

  const { warmupSec, cooldownSec } = resolveWarmCooldownSec({ session, blueprint: bp, kindHint: "STRIDES" });

  const pace10k = calc10kPaceSecPerKm(profile);
  const stridePace = clamp(pace10k - 25, 160, 360);

  const wuTgt = hrTarget(profile, "z1");
  const cdTgt = hrTarget(profile, "z1");

  const wu = warmupSec > 0 ? warmupStep({ seconds: warmupSec, ...wuTgt }) : null;
  const cd = cooldownSec > 0 ? cooldownStep({ seconds: cooldownSec, ...cdTgt }) : null;

  const workStep = steadyStepDistance({
    meters: repDistanceM,
    targetType: "pace_range",
    targetValue: paceToTargetRange(stridePace, 12),
  });

  const recTgt = hrTarget(profile, "z1");
  const recStep = recoveryStep({ seconds: recSec, ...recTgt });

  const steps = [];
  if (wu) steps.push(wu);

  // ✅ no recovery after last rep
  if (reps > 1) {
    steps.push(repeatBlock({ repeatCount: reps - 1, steps: [workStep, recStep] }));
    steps.push(workStep);
  } else {
    steps.push(workStep);
  }

  if (cd) steps.push(cd);

  const w = {
    sport: "running",
    estimatedDistanceMeters: round(meters),
    steps: applyHrFallbackToSteps(steps, profile, "STRIDES"),
  };

  // ✅ preserve blueprint fields for consumers
  return preserveBlueprintFields(bp, w);
}

/* ───────────────────────────────────────────
   Intensity → target pace range helpers
─────────────────────────────────────────── */

function normaliseIntensityLabel(v) {
  if (!v) return "";
  return String(v).trim().toUpperCase();
}

function intensityToPaceKey(intensityLabel, kindHint) {
  const s = normaliseIntensityLabel(intensityLabel);
  const k = String(kindHint || "").toUpperCase();

  if (s === "TEMPO") return "tempo";
  if (s === "THRESHOLD" || s === "T" || s === "T+" || s === "T++") return "threshold";
  if (s === "E" || s === "EASY" || s === "REC" || s === "RECOVERY") return "easy";
  if (s === "STEADY") return "steady";
  if (s === "INTERVAL" || s === "INTERVALS") return "interval";
  if (s === "RACEPACE" || s === "RACE PACE") return "racepace";

  if (s === "10K") return k === "INTERVALS" ? "interval" : "threshold";
  if (s === "5K") return "interval";
  if (s.includes("10K")) return k === "INTERVALS" ? "interval" : "threshold";
  if (s.includes("5K")) return "interval";

  if (s.includes("UNDER")) return "threshold";
  if (s.includes("OVER")) return "interval";

  if (k === "INTERVALS") return "interval";
  if (k === "THRESHOLD") return "threshold";
  return "tempo";
}

function paceRangeFromProfile(profile, paceKey) {
  const p = profile?.paces;
  if (!p || typeof p !== "object") return null;

  if (paceKey === "threshold") {
    const thr = Number(p?.thresholdSecPerKm);
    if (Number.isFinite(thr) && thr > 0) return paceToTargetRange(thr, 10);
    return null;
  }

  if (paceKey === "racepace") {
    const rp = Number(p?.raceSecPerKm);
    if (Number.isFinite(rp) && rp > 0) return paceToTargetRange(rp, 8);
    return null;
  }

  const r = p?.[paceKey];
  if (r && Number.isFinite(r.minSecPerKm) && Number.isFinite(r.maxSecPerKm)) {
    const min = Number(r.minSecPerKm);
    const max = Number(r.maxSecPerKm);
    if (min > 0 && max > 0 && max >= min) return { minSecPerKm: round(min), maxSecPerKm: round(max) };
  }

  return null;
}

function intensityToPaceDeltaSec(intensityLabel) {
  const s = normaliseIntensityLabel(intensityLabel);

  if (!s || s === "E" || s === "EASY" || s === "REC" || s === "RECOVERY") return null;

  if (s === "STEADY") return +35;
  if (s === "TEMPO") return +15;
  if (s === "THRESHOLD" || s === "T") return +8;

  if (s === "T+") return +4;
  if (s === "T++") return 0;

  if (s === "RACEPACE" || s === "10K") return 0;
  if (s === "5K") return -12;

  if (s.includes("UNDER")) return +8;
  if (s.includes("OVER")) return 0;

  if (s.includes("10K")) return 0;
  if (s.includes("5K")) return -12;

  return +15;
}

function targetForIntensity({ profile, intensityLabel, intensityKey, isDeload, kindHint, forcePaceInDeload = false }) {
  const kind = String(kindHint || "").toUpperCase();
  const paceAllowedInDeload =
    forcePaceInDeload ||
    kind === "INTERVALS" ||
    kind === "THRESHOLD" ||
    kind === "TEMPO" ||
    kind === "STRIDES";
  if (isDeload && !paceAllowedInDeload) return { targetType: "none", targetValue: null };

  const keyFromKey = intensityKey ? String(intensityKey).toLowerCase().trim() : "";
  const paceKey = keyFromKey || intensityToPaceKey(intensityLabel, kindHint);

  // easy is HR-driven by fallback
  if (paceKey === "easy") return { targetType: "none", targetValue: null };

  const fromProfile = paceRangeFromProfile(profile, paceKey);
  if (fromProfile) return { targetType: "pace_range", targetValue: fromProfile };

  const delta = intensityToPaceDeltaSec(intensityLabel);
  if (delta == null) return { targetType: "none", targetValue: null };

  const pace10k = calc10kPaceSecPerKm(profile);
  const k = String(kindHint || "").toUpperCase();
  const tol = k === "INTERVALS" ? 6 : k === "STRIDES" ? 12 : 10;

  const pace = clamp(pace10k + delta, 160, 420);
  return { targetType: "pace_range", targetValue: paceToTargetRange(pace, tol) };
}

function flattenStepsForTargets(steps = []) {
  const out = [];
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const st of arr) {
      if (!st || typeof st !== "object") continue;
      out.push(st);
      if (Array.isArray(st.steps)) walk(st.steps);
    }
  };
  walk(steps);
  return out;
}

function firstExplicitTargetValue(steps = [], targetType) {
  const want = String(targetType || "").toLowerCase();
  const flat = flattenStepsForTargets(steps);
  for (const st of flat) {
    const tt = String(st?.targetType || "").toLowerCase();
    if (tt !== want) continue;
    if (st?.targetValue && typeof st.targetValue === "object") return st.targetValue;
  }
  return null;
}

function firstExplicitMainHrRange(steps = []) {
  const flat = flattenStepsForTargets(steps);
  for (const st of flat) {
    const tt = String(st?.targetType || "").toLowerCase();
    if (tt !== "hr_range") continue;

    const stepType = String(st?.stepType || "").toLowerCase();
    const isSupport =
      stepType === "warmup" ||
      stepType === "cooldown" ||
      stepType === "recovery";
    if (isSupport) continue;

    if (st?.targetValue && typeof st.targetValue === "object") {
      return st.targetValue;
    }
  }
  return null;
}

function strongestExplicitPaceRange(steps = []) {
  const flat = flattenStepsForTargets(steps);
  let best = null;
  let bestFastest = Infinity;
  for (const st of flat) {
    const tt = String(st?.targetType || "").toLowerCase();
    if (tt !== "pace_range") continue;
    const stepType = String(st?.stepType || "").toLowerCase();
    const isSupport = stepType === "warmup" || stepType === "cooldown" || stepType === "recovery";
    if (isSupport) continue;
    const min = toNum(st?.targetValue?.minSecPerKm);
    const max = toNum(st?.targetValue?.maxSecPerKm);
    const fastest = min != null ? min : max;
    if (!Number.isFinite(fastest)) continue;
    if (fastest < bestFastest) {
      bestFastest = fastest;
      best = st?.targetValue;
    }
  }
  return best;
}

function strongestExplicitMainHrRange(steps = []) {
  const flat = flattenStepsForTargets(steps);
  let best = null;
  let bestMin = -1;
  let bestMax = -1;
  for (const st of flat) {
    const tt = String(st?.targetType || "").toLowerCase();
    if (tt !== "hr_range") continue;

    const stepType = String(st?.stepType || "").toLowerCase();
    const isSupport = stepType === "warmup" || stepType === "cooldown" || stepType === "recovery";
    if (isSupport) continue;

    const min = toNum(st?.targetValue?.minBpm);
    const max = toNum(st?.targetValue?.maxBpm);
    if (min == null || max == null) continue;
    if (min > bestMin || (min === bestMin && max > bestMax)) {
      bestMin = min;
      bestMax = max;
      best = st?.targetValue;
    }
  }
  return best;
}

function hasQualityLongContent(steps = []) {
  const flat = flattenStepsForTargets(steps);
  return flat.some((st) => {
    const stepType = String(st?.stepType || "").toLowerCase();
    const targetType = String(st?.targetType || "").toLowerCase();
    if (stepType === "tempo" || stepType === "repeat") return true;
    if (stepType === "steady" && targetType === "pace_range") return true;
    return false;
  });
}

function defaultHrZoneForKind(kind) {
  const k = String(kind || "").toUpperCase();
  if (k === "INTERVALS" || k === "STRIDES") return "z4";
  if (k === "TEMPO" || k === "THRESHOLD") return "z3";
  return "z2";
}

function isQualityKindForSummary(kind) {
  const k = String(kind || "").toUpperCase();
  return k === "INTERVALS" || k === "TEMPO" || k === "THRESHOLD" || k === "STRIDES";
}

function isBpmRange(v) {
  return (
    v &&
    typeof v === "object" &&
    Number.isFinite(Number(v.minBpm)) &&
    Number.isFinite(Number(v.maxBpm))
  );
}

function hrZoneLabel(zoneKey) {
  const z = String(zoneKey || "").toLowerCase();
  if (z === "z1") return { zone: "Z1", label: "Easy recovery" };
  if (z === "z2") return { zone: "Z2", label: "Easy aerobic" };
  if (z === "z3") return { zone: "Z3", label: "Steady / tempo" };
  if (z === "z4") return { zone: "Z4", label: "Threshold / hard" };
  if (z === "z5") return { zone: "Z5", label: "VO2 / very hard" };
  return { zone: "Z2", label: "Easy aerobic" };
}

function defaultPaceRangeForKind({ profile, kind, isDeload }) {
  const k = String(kind || "").toUpperCase();

  if (k === "EASY" || k === "LONG") {
    return paceRangeFromProfile(profile, "easy") || paceToTargetRange(clamp(calc10kPaceSecPerKm(profile) + 60, 220, 480), 15);
  }

  if (k === "THRESHOLD") {
    const tgt = targetForIntensity({
      profile,
      intensityLabel: "THRESHOLD",
      intensityKey: "threshold",
      isDeload: false,
      kindHint: k,
    });
    return tgt?.targetType === "pace_range" ? tgt.targetValue : null;
  }

  if (k === "TEMPO") {
    const tgt = targetForIntensity({
      profile,
      intensityLabel: "TEMPO",
      intensityKey: "tempo",
      isDeload: false,
      kindHint: k,
    });
    return tgt?.targetType === "pace_range" ? tgt.targetValue : null;
  }

  if (k === "INTERVALS") {
    const tgt = targetForIntensity({
      profile,
      intensityLabel: "INTERVAL",
      intensityKey: "interval",
      isDeload: false,
      kindHint: k,
    });
    return tgt?.targetType === "pace_range" ? tgt.targetValue : null;
  }

  if (k === "STRIDES") {
    return paceToTargetRange(clamp(calc10kPaceSecPerKm(profile) - 25, 160, 360), 12);
  }

  return null;
}

function deriveSessionGuidance({ steps, profile, kind, isDeload }) {
  const k = String(kind || "").toUpperCase();
  const isQualityLong = k === "LONG" && hasQualityLongContent(steps);
  const paceFromSteps = isQualityLong ? strongestExplicitPaceRange(steps) : firstExplicitTargetValue(steps, "pace_range");
  const hrFromSteps = isQualityLong ? strongestExplicitMainHrRange(steps) : firstExplicitMainHrRange(steps);
  const hrZone = defaultHrZoneForKind(kind);
  const fallbackPace = isQualityLong
    ? paceRangeFromProfile(profile, "tempo") || defaultPaceRangeForKind({ profile, kind: "TEMPO", isDeload: false })
    : defaultPaceRangeForKind({ profile, kind, isDeload });
  const fallbackHrFromProfile = isQualityLong
    ? hrRangeForZone(profile, "z3")
    : hrRangeForZone(profile, hrZone);
  const fallbackHr = fallbackHrFromProfile || hrZoneLabel(isQualityLong ? "z3" : hrZone);

  let hrRange = hrFromSteps || fallbackHr || null;
  // For quality sessions, never let summary HR drift easier than intended zone.
  if (isQualityKindForSummary(kind) && isBpmRange(hrRange) && isBpmRange(fallbackHr)) {
    if (Number(hrRange.minBpm) < Number(fallbackHr.minBpm)) {
      hrRange = fallbackHr;
    }
  }

  return {
    paceRange: paceFromSteps || fallbackPace || null,
    hrRange,
    source: {
      pace: paceFromSteps ? "steps" : fallbackPace ? "default" : null,
      hr:
        hrFromSteps && hrRange === hrFromSteps
          ? "steps"
          : fallbackHrFromProfile && hrRange === fallbackHrFromProfile
          ? "profile_hr_zones_fallback"
          : fallbackHr
          ? "default"
          : null,
    },
  };
}

/* ───────────────────────────────────────────
   TEMPO/THRESHOLD blueprint renderer (blocks → Garmin steps)
─────────────────────────────────────────── */

function renderTempoFromBlueprint({ blueprint, profile, isDeload, totalMeters, kindHint = "TEMPO", session = null }) {
  const { warmupSec, cooldownSec } = resolveWarmCooldownSec({ session, blueprint, kindHint });

  const steps = [];

  if (warmupSec > 0) {
    const wuTgt = hrTarget(profile, "z1");
    steps.push(warmupStep({ seconds: warmupSec, ...wuTgt }));
  }

  const blocks = Array.isArray(blueprint?.blocks) ? blueprint.blocks : [];

  const pushWorkTime = (sec, intensity, intensityKey) => {
    const s = Number(sec || 0) || 0;
    if (s <= 0) return;

    const { targetType, targetValue } = targetForIntensity({
      profile,
      intensityLabel: intensity,
      intensityKey,
      isDeload,
      kindHint,
    });

    steps.push(steadyStepTime({ seconds: s, targetType, targetValue }));
  };

  const pushRecoverTime = (sec) => {
    const s = Number(sec || 0) || 0;
    if (s <= 0) return;

    const recTgt = hrTarget(profile, "z1");
    steps.push(recoveryStep({ seconds: s, ...recTgt }));
  };

  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const bt = String(b.type || "").toUpperCase();

    if (bt === "CONTINUOUS") {
      const sec = Number(b?.work?.valueSec ?? b?.sec ?? b?.seconds) || 0;
      const intensity = b?.work?.intensity ?? b?.intensity ?? "tempo";
      const intensityKey = b?.work?.intensityKey ?? b?.intensityKey ?? null;
      pushWorkTime(sec, intensity, intensityKey);
      continue;
    }

    if (bt === "REPEAT") {
      const repeatCount = Number(b?.repeatCount ?? b?.reps ?? 0) || 0;
      const workSec = Number(b?.work?.valueSec ?? b?.workSec ?? 0) || 0;
      const recSec = Number(b?.recover?.valueSec ?? b?.recoverSec ?? 0) || 0;

      if (repeatCount > 0 && workSec > 0) {
        const intensity = b?.work?.intensity ?? b?.intensity ?? "tempo";
        const intensityKey = b?.work?.intensityKey ?? b?.intensityKey ?? null;

        const onTarget = targetForIntensity({
          profile,
          intensityLabel: intensity,
          intensityKey,
          isDeload,
          kindHint,
        });

        const inner = [
          steadyStepTime({
            seconds: workSec,
            targetType: onTarget.targetType,
            targetValue: onTarget.targetValue,
          }),
        ];

        if (recSec > 0) {
          const recTgt = hrTarget(profile, "z1");
          inner.push(recoveryStep({ seconds: recSec, ...recTgt }));
        }

        steps.push(repeatBlock({ repeatCount, steps: inner }));
      }
      continue;
    }

    if (bt === "LADDER_TIME") {
      const reps = Array.isArray(b?.reps) ? b.reps : [];
      const recSec = Number(b?.recoverSec ?? 0) || 0;
      const intensities = Array.isArray(b?.intensities) ? b.intensities : [];

      reps.forEach((sec0, i) => {
        const sec = Number(sec0) || 0;
        if (sec <= 0) return;
        const intensity = intensities[i] ?? b?.intensity ?? "tempo";
        pushWorkTime(sec, intensity, null);
        if (recSec > 0 && i < reps.length - 1) pushRecoverTime(recSec);
      });
      continue;
    }

    if (bt === "PROGRESSIVE") {
      const segs = Array.isArray(b?.segments) ? b.segments : [];
      for (const seg of segs) {
        const sec = Number(seg?.sec ?? seg?.seconds ?? 0) || 0;
        const intensity = seg?.intensity ?? "tempo";
        pushWorkTime(sec, intensity, null);
      }
      continue;
    }

    if (bt === "PROGRESSION") {
      const segs = Array.isArray(b?.segments) ? b.segments : [];
      for (const seg of segs) {
        const wsec = Number(seg?.work?.valueSec ?? 0) || 0;
        const wint = seg?.work?.intensity ?? "tempo";
        const wkey = seg?.work?.intensityKey ?? null;
        if (wsec > 0) pushWorkTime(wsec, wint, wkey);

        const rsec = Number(seg?.recover?.valueSec ?? 0) || 0;
        if (rsec > 0) pushRecoverTime(rsec);
      }
      continue;
    }

    if (bt === "ALTERNATIONS") {
      const repeatCount = Number(b?.repeatCount ?? 0) || 0;
      const onSec = Number(b?.on?.valueSec ?? 0) || 0;
      const offSec = Number(b?.off?.valueSec ?? 0) || 0;

      const intensityOn = b?.on?.intensity ?? b?.intensityOn ?? "threshold";
      const intensityKeyOn = b?.on?.intensityKey ?? b?.intensityKeyOn ?? b?.intensityKey ?? null;

      if (repeatCount > 0 && onSec > 0) {
        const onTarget = targetForIntensity({
          profile,
          intensityLabel: intensityOn,
          intensityKey: intensityKeyOn,
          isDeload,
          kindHint,
        });

        const inner = [
          steadyStepTime({
            seconds: onSec,
            targetType: onTarget.targetType,
            targetValue: onTarget.targetValue,
          }),
        ];
        if (offSec > 0) {
          const recTgt = hrTarget(profile, "z1");
          inner.push(recoveryStep({ seconds: offSec, ...recTgt }));
        }
        steps.push(repeatBlock({ repeatCount, steps: inner }));
      }
      continue;
    }

    if (bt === "OVER_UNDER") {
      const repeatCount = Number(b?.repeatCount ?? 0) || 0;
      const overSec = Number(b?.over?.valueSec ?? 0) || 0;
      const underSec = Number(b?.under?.valueSec ?? 0) || 0;
      const recSec = Number(b?.recover?.valueSec ?? 0) || 0;

      const iOver = b?.over?.intensity ?? "threshold";
      const kOver = b?.over?.intensityKey ?? null;
      const iUnder = b?.under?.intensity ?? "tempo";
      const kUnder = b?.under?.intensityKey ?? null;

      if (repeatCount > 0 && (overSec > 0 || underSec > 0)) {
        const overTarget = targetForIntensity({
          profile,
          intensityLabel: iOver,
          intensityKey: kOver,
          isDeload,
          kindHint,
        });
        const underTarget = targetForIntensity({
          profile,
          intensityLabel: iUnder,
          intensityKey: kUnder,
          isDeload,
          kindHint,
        });

        const inner = [];
        if (overSec > 0)
          inner.push(
            steadyStepTime({
              seconds: overSec,
              targetType: overTarget.targetType,
              targetValue: overTarget.targetValue,
            })
          );
        if (underSec > 0)
          inner.push(
            steadyStepTime({
              seconds: underSec,
              targetType: underTarget.targetType,
              targetValue: underTarget.targetValue,
            })
          );
        if (recSec > 0) {
          const recTgt = hrTarget(profile, "z1");
          inner.push(recoveryStep({ seconds: recSec, ...recTgt }));
        }

        steps.push(repeatBlock({ repeatCount, steps: inner }));
      }
      continue;
    }

    if (process?.env?.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[garminSteps] Unknown tempo block type:", bt, b);
    }
  }

  if (cooldownSec > 0) {
    const cdTgt = hrTarget(profile, "z1");
    steps.push(cooldownStep({ seconds: cooldownSec, ...cdTgt }));
  }

  const w = {
    sport: "running",
    estimatedDistanceMeters: round(totalMeters),
    steps: applyHrFallbackToSteps(steps, profile, kindHint),
  };

  // ✅ preserve blueprint fields for consumers
  return preserveBlueprintFields(blueprint, w);
}

/* ───────────────────────────────────────────
   INTERVALS renderers
─────────────────────────────────────────── */

function buildIntervalsFallbackInvented({ profile, ctx, session = null }) {
  const isDeload = !!ctx?.isDeload;

  const { warmupSec, cooldownSec } = resolveWarmCooldownSec({
    session,
    blueprint: session?.workout,
    kindHint: "INTERVALS",
  });

  const pace10k = calc10kPaceSecPerKm(profile);

  const intDelta = isDeload ? 8 : 12;
  const intPace = clamp(pace10k - intDelta, 180, 360);

  const wkKm = Number(profile.weeklyKm || profile.current?.weeklyKm || 0) || 0;
  const exp = String(profile.experience || profile.current?.experience || "").toLowerCase();

  const prefer800 = wkKm >= 35 && !exp.includes("new");
  const repMeters = prefer800 ? 800 : 400;

  const baseReps =
    wkKm >= 55 ? (prefer800 ? 6 : 10) :
    wkKm >= 40 ? (prefer800 ? 5 : 8) :
    wkKm >= 30 ? (prefer800 ? 4 : 6) :
    (prefer800 ? 3 : 5);

  const reps = isDeload ? Math.max(3, baseReps - 1) : baseReps;
  const recSec = prefer800 ? 120 : 75;

  const workStep = steadyStepDistance({
    meters: repMeters,
    targetType: "pace_range",
    targetValue: paceToTargetRange(intPace, 6),
  });

  const steps = [];

  if (warmupSec > 0) {
    const wuTgt = hrTarget(profile, "z1");
    steps.push(warmupStep({ seconds: warmupSec, ...wuTgt }));
  }

  if (reps > 1) {
    const recTgt = hrTarget(profile, "z1");
    steps.push(repeatBlock({ repeatCount: reps - 1, steps: [workStep, recoveryStep({ seconds: recSec, ...recTgt })] }));
    steps.push(workStep);
  } else {
    steps.push(workStep);
  }

  if (cooldownSec > 0) {
    const cdTgt = hrTarget(profile, "z1");
    steps.push(cooldownStep({ seconds: cooldownSec, ...cdTgt }));
  }

  return {
    sport: "running",
    estimatedDistanceMeters: round(0), // overwritten later by computed meters
    steps: applyHrFallbackToSteps(steps, profile, "INTERVALS"),
  };
}

function renderIntervalsFromSimpleBlueprint({ blueprint, profile, isDeload, totalMeters, session = null }) {
  const reps = Number(blueprint?.reps || 0) || 0;
  const repDistanceM = Number(blueprint?.repDistanceM || 0) || 0;

  const { warmupSec, cooldownSec } = resolveWarmCooldownSec({ session, blueprint, kindHint: "INTERVALS" });

  const { targetType, targetValue } = targetForIntensity({
    profile,
    intensityLabel: "INTERVAL",
    intensityKey: "interval",
    isDeload,
    kindHint: "INTERVALS",
  });

  const workStep = steadyStepDistance({
    meters: repDistanceM > 0 ? repDistanceM : 400,
    targetType,
    targetValue,
  });

  const rec = blueprint?.recovery || {};
  const recType = String(rec?.type || "JOG_TIME").toUpperCase();

  const recTgt = hrTarget(profile, "z1");
  const recStep =
    recType === "JOG_DISTANCE"
      ? recoveryStepDistance({ meters: Number(rec?.valueM || 200) || 200, ...recTgt })
      : recoveryStep({ seconds: Number(rec?.valueSec || 90) || 90, ...recTgt });

  const steps = [];

  if (warmupSec > 0) {
    const wuTgt = hrTarget(profile, "z1");
    steps.push(warmupStep({ seconds: warmupSec, ...wuTgt }));
  }

  if (reps > 1) {
    steps.push(repeatBlock({ repeatCount: reps - 1, steps: [workStep, recStep] }));
    steps.push(workStep);
  } else {
    steps.push(workStep);
  }

  if (cooldownSec > 0) {
    const cdTgt = hrTarget(profile, "z1");
    steps.push(cooldownStep({ seconds: cooldownSec, ...cdTgt }));
  }

  const w = {
    sport: "running",
    estimatedDistanceMeters: round(totalMeters),
    steps: applyHrFallbackToSteps(steps, profile, "INTERVALS"),
  };

  return preserveBlueprintFields(blueprint, w);
}

function renderIntervalsFromBlocks({ blocks, profile, isDeload }) {
  const steps = [];

  const addRecover = (rec) => {
    const recType = String(rec?.type || "TIME").toUpperCase();
    const recTgt = hrTarget(profile, "z1");

    return recType === "DISTANCE"
      ? recoveryStepDistance({ meters: Number(rec?.m ?? rec?.valueM ?? 200) || 200, ...recTgt })
      : recoveryStep({ seconds: Number(rec?.sec ?? rec?.valueSec ?? 90) || 90, ...recTgt });
  };

  const pushRepeatWithGaps = ({ reps, workStep, recoverStep }) => {
    const n = Math.max(0, Number(reps || 0) || 0);
    if (n <= 0) return;

    if (n >= 2) {
      steps.push(repeatBlock({ repeatCount: n - 1, steps: [workStep, recoverStep] }));
      steps.push(workStep);
      return;
    }
    steps.push(workStep);
  };

  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;

    const t0 = String(b.type || "").toUpperCase();
    const t =
      t0 === "ON_OFF_KM" ? "ON_OFF_DISTANCE" :
      t0 === "BROKEN_K" ? "BROKEN_DISTANCE" :
      t0 === "OVER_UNDER_1K" ? "OVER_UNDER_DISTANCE" :
      t0;

    // 0) ✅ FILL_DISTANCE (Runna-style top-up)
    if (t === "FILL_DISTANCE") {
      const m = Number(b?.meters ?? b?.workM ?? 0) || 0;
      if (m > 0) {
        // Represent filler as cooldown distance to avoid duplicate recovery semantics
        // (recovery is already carried inside repeat children).
        const recTgt = hrTarget(profile, "z1");
        steps.push(
          cooldownStepDistance({
            meters: round(m),
            targetType: recTgt.targetType,
            targetValue: recTgt.targetValue,
          })
        );
      }
      continue;
    }

    // 1) Classic repeats (distance)
    if (t === "REPEAT_DISTANCE") {
      const reps = Number(b?.reps ?? b?.repeatCount ?? 0) || 0;

      const workKm = Number(b?.workKm ?? 0) || 0;
      const workM = Number(b?.workM ?? b?.meters ?? 0) || (workKm > 0 ? Math.round(workKm * 1000) : 0);

      const intensity = b?.intensity ?? b?.intensityLabel ?? "INTERVAL";
      const intensityKey = b?.intensityKey ?? null;

      const tgt = targetForIntensity({
        profile,
        intensityLabel: intensity,
        intensityKey,
        isDeload,
        kindHint: "INTERVALS",
      });

      const workStep = steadyStepDistance({
        meters: workM > 0 ? workM : 400,
        targetType: tgt.targetType,
        targetValue: tgt.targetValue,
      });

      const recStep = addRecover(b?.recover);
      pushRepeatWithGaps({ reps: reps > 0 ? reps : 5, workStep, recoverStep: recStep });
      continue;
    }

    // 2) Pyramid / ladder (distance)
    if (t === "PYRAMID_DISTANCE") {
      const repsArr = Array.isArray(b?.reps) ? b.reps : Array.isArray(b?.repsM) ? b.repsM : [];

      const recoverSec = Number(b?.recoverSec ?? b?.recover?.sec ?? 90) || 90;
      const intensity = b?.intensity ?? "INTERVAL";
      const intensityKey = b?.intensityKey ?? null;

      const { targetType, targetValue } = targetForIntensity({
        profile,
        intensityLabel: intensity,
        intensityKey,
        isDeload,
        kindHint: "INTERVALS",
      });

      repsArr.forEach((m0, i) => {
        const m = Number(m0) || 0;
        if (m <= 0) return;
        steps.push(steadyStepDistance({ meters: m, targetType, targetValue }));
        if (recoverSec > 0 && i < repsArr.length - 1) {
          const recTgt = hrTarget(profile, "z1");
          steps.push(recoveryStep({ seconds: recoverSec, ...recTgt }));
        }
      });
      continue;
    }

    // 3) Mixed set
    if (t === "MIXED_SET") {
      const sets = Math.max(1, Number(b?.sets ?? 1) || 1);
      const repsArr = Array.isArray(b?.reps) ? b.reps : [];

      const oneSetSteps = [];
      repsArr.forEach((r, idx) => {
        const workM = Number(r?.workM ?? 0) || 0;
        if (workM > 0) {
          const tgt = targetForIntensity({
            profile,
            intensityLabel: r?.intensity ?? b?.intensity ?? "INTERVAL",
            intensityKey: r?.intensityKey ?? b?.intensityKey ?? null,
            isDeload,
            kindHint: "INTERVALS",
          });

          oneSetSteps.push(
            steadyStepDistance({
              meters: workM,
              targetType: tgt.targetType,
              targetValue: tgt.targetValue,
            })
          );
        }

        const recSec = Number(r?.recoverSec ?? 0) || 0;
        if (recSec > 0 && idx < repsArr.length - 1) {
          const recTgt = hrTarget(profile, "z1");
          oneSetSteps.push(recoveryStep({ seconds: recSec, ...recTgt }));
        }
      });

      if (!oneSetSteps.length) continue;

      if (sets >= 2) steps.push(repeatBlock({ repeatCount: sets, steps: oneSetSteps }));
      else steps.push(...oneSetSteps);

      continue;
    }

    // 4) On/off blocks (distance)
    if (t === "ON_OFF_DISTANCE") {
      const repeatCount = Number(b?.repeatCount ?? b?.reps ?? 0) || 0;
      const onM = Number(b?.onM ?? b?.workM ?? 0) || 0;
      const offM = Number(b?.offM ?? b?.recoverM ?? 0) || 0;

      const intensity = b?.intensity ?? b?.onIntensity ?? "INTERVAL";
      const intensityKey = b?.intensityKey ?? b?.onIntensityKey ?? null;

      if (repeatCount > 0 && onM > 0) {
        const { targetType, targetValue } = targetForIntensity({
          profile,
          intensityLabel: intensity,
          intensityKey,
          isDeload,
          kindHint: "INTERVALS",
        });

        const inner = [steadyStepDistance({ meters: onM, targetType, targetValue })];
        if (offM > 0) {
          const recTgt = hrTarget(profile, "z1");
          inner.push(recoveryStepDistance({ meters: offM, ...recTgt }));
        }
        steps.push(repeatBlock({ repeatCount, steps: inner }));
      }
      continue;
    }

    // 5) Broken distance
    if (t === "BROKEN_DISTANCE") {
      const reps = Number(b?.reps ?? 0) || 0;
      const distanceM = Number(b?.distanceM ?? 0) || 0;

      const chunks = Array.isArray(b?.chunksM)
        ? b.chunksM
        : reps > 0 && distanceM > 0
          ? Array.from({ length: reps }, () => distanceM)
          : [];

      const recoverSec = Number(b?.recoverSec ?? 90) || 90;
      const intensity = b?.intensity ?? "INTERVAL";
      const intensityKey = b?.intensityKey ?? null;

      const tgt = targetForIntensity({
        profile,
        intensityLabel: intensity,
        intensityKey,
        isDeload,
        kindHint: "INTERVALS",
      });

      for (let i = 0; i < chunks.length; i++) {
        const m = Number(chunks[i]) || 0;
        if (m <= 0) continue;
        steps.push(
          steadyStepDistance({
            meters: Math.max(50, round(m)),
            targetType: tgt.targetType,
            targetValue: tgt.targetValue,
          })
        );
        if (recoverSec > 0 && i < chunks.length - 1) {
          const recTgt = hrTarget(profile, "z1");
          steps.push(recoveryStep({ seconds: recoverSec, ...recTgt }));
        }
      }
      continue;
    }

    // 6) Over/under 1k
    if (t === "OVER_UNDER_DISTANCE") {
      const repeatCount = Number(b?.repeatCount ?? b?.reps ?? 0) || 0;
      const overM = Number(b?.overM ?? 1000) || 1000;
      const underM = Number(b?.underM ?? 1000) || 1000;
      const recSec = Number(b?.recoverSec ?? b?.recover?.sec ?? 60) || 60;

      const iOver = b?.intensityOver ?? b?.overIntensity ?? "INTERVAL";
      const kOver = b?.intensityOverKey ?? b?.overIntensityKey ?? null;
      const iUnder = b?.intensityUnder ?? b?.underIntensity ?? "THRESHOLD";
      const kUnder = b?.intensityUnderKey ?? b?.underIntensityKey ?? null;

      if (repeatCount > 0 && (overM > 0 || underM > 0)) {
        const overT = targetForIntensity({
          profile,
          intensityLabel: iOver,
          intensityKey: kOver,
          isDeload,
          kindHint: "INTERVALS",
        });
        const underT = targetForIntensity({
          profile,
          intensityLabel: iUnder,
          intensityKey: kUnder,
          isDeload,
          kindHint: "INTERVALS",
        });

        const inner = [];
        if (overM > 0) inner.push(steadyStepDistance({ meters: overM, targetType: overT.targetType, targetValue: overT.targetValue }));
        if (underM > 0) inner.push(steadyStepDistance({ meters: underM, targetType: underT.targetType, targetValue: underT.targetValue }));

        if (repeatCount >= 2 && recSec > 0) {
          const recTgt = hrTarget(profile, "z1");
          const innerWithRec = [...inner, recoveryStep({ seconds: recSec, ...recTgt })];
          steps.push(repeatBlock({ repeatCount: repeatCount - 1, steps: innerWithRec }));
          steps.push(...inner);
        } else {
          steps.push(repeatBlock({ repeatCount: repeatCount || 1, steps: inner }));
        }
      }
      continue;
    }

    // 7) Floating
    if (t === "FLOATING") {
      const reps = Number(b?.reps ?? 0) || 0;
      const workM = Number(b?.workM ?? 0) || 0;

      const intensity = b?.intensity ?? "INTERVAL";
      const intensityKey = b?.intensityKey ?? null;

      const tgt = targetForIntensity({
        profile,
        intensityLabel: intensity,
        intensityKey,
        isDeload,
        kindHint: "INTERVALS",
      });

      const workStep = steadyStepDistance({
        meters: workM > 0 ? workM : 400,
        targetType: tgt.targetType,
        targetValue: tgt.targetValue,
      });

      const recStep = addRecover(b?.recover);
      pushRepeatWithGaps({ reps: reps > 0 ? reps : 5, workStep, recoverStep: recStep });
      continue;
    }

    // 8) Ultra time-based blocks
    if (t === "REPEAT_TIME" || t === "CRUISE_TIME" || t === "HILL_REPEAT_TIME") {
      const reps = Number(b?.reps ?? b?.repeatCount ?? 0) || 0;
      const workSec = Number(b?.workSec ?? b?.seconds ?? 0) || 0;
      const recSec = Number(b?.recoverSec ?? b?.recSec ?? 0) || 0;

      const intensity = b?.intensity ?? b?.intensityLabel ?? (t === "CRUISE_TIME" ? "THRESHOLD" : "INTERVAL");
      const intensityKey = b?.intensityKey ?? (t === "CRUISE_TIME" ? "threshold" : "interval");

      const tgt = targetForIntensity({
        profile,
        intensityLabel: intensity,
        intensityKey,
        isDeload,
        kindHint: "INTERVALS",
      });

      const workStep = steadyStepTime({
        seconds: workSec > 0 ? workSec : 4 * 60,
        targetType: tgt.targetType,
        targetValue: tgt.targetValue,
      });

      const recTgt = hrTarget(profile, "z1");
      const recStep = recoveryStep({ seconds: recSec > 0 ? recSec : 120, ...recTgt });

      pushRepeatWithGaps({ reps: reps > 0 ? reps : 4, workStep, recoverStep: recStep });
      continue;
    }

    if (process?.env?.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[garminSteps] Unknown interval block type:", t, b);
    }
  }

  return { steps: applyHrFallbackToSteps(steps, profile, "INTERVALS") };
}

function renderIntervalsFromBlueprint({ blueprint, profile, isDeload, totalMeters, session = null }) {
  const { warmupSec, cooldownSec } = resolveWarmCooldownSec({ session, blueprint, kindHint: "INTERVALS" });

  const steps = [];

  if (warmupSec > 0) {
    const wuTgt = hrTarget(profile, "z1");
    steps.push(warmupStep({ seconds: warmupSec, ...wuTgt }));
  }

  const blocks = Array.isArray(blueprint?.blocks) ? blueprint.blocks : null;

  if (blocks && blocks.length) {
    const inner = renderIntervalsFromBlocks({ blocks, profile, isDeload });
    steps.push(...(Array.isArray(inner.steps) ? inner.steps : []));
  } else if (Number(blueprint?.reps) && Number(blueprint?.repDistanceM) && blueprint?.recovery) {
    const simple = renderIntervalsFromSimpleBlueprint({ blueprint, profile, isDeload, totalMeters, session });
    const simpleSteps = Array.isArray(simple.steps) ? simple.steps : [];
    const stripped = simpleSteps.slice(1, Math.max(1, simpleSteps.length - 1)); // drop warm/cool
    steps.push(...stripped);
  }

  if (cooldownSec > 0) {
    const cdTgt = hrTarget(profile, "z1");
    steps.push(cooldownStep({ seconds: cooldownSec, ...cdTgt }));
  }

  const w = {
    sport: "running",
    estimatedDistanceMeters: round(totalMeters),
    steps: applyHrFallbackToSteps(steps, profile, "INTERVALS"),
  };

  // ✅ preserve blueprint fields for consumers
  return preserveBlueprintFields(blueprint, w);
}

/* ───────────────────────────────────────────
   Main builder
─────────────────────────────────────────── */

export function buildGarminWorkoutForSession(session, profile, ctx = {}) {
  const kind = getSessionKind(session);
  const blueprintKind = getBlueprintKind(session);

  const baseKm = toNum(session?.plannedDistanceKm) ?? toNum(session?.distanceKm) ?? 0;
  const totalMeters = Math.max(0, Math.round(baseKm * 1000));

  const isDeload = !!ctx?.isDeload;

  if (blueprintKind === "STRIDES") {
    const w = buildStridesWorkout({ meters: totalMeters, profile, session });
    return injectKindIntoWorkout("STRIDES", w);
  }

  const isTempoLike =
    kind === "TEMPO" || kind === "THRESHOLD" || blueprintKind === "TEMPO" || blueprintKind === "THRESHOLD";

  if (isTempoLike) {
    const bp = session?.workout && typeof session.workout === "object" ? session.workout : {};
    const hasBlocks = Array.isArray(bp?.blocks) && bp.blocks.length > 0;

    const finalKind = blueprintKind === "THRESHOLD" || kind === "THRESHOLD" ? "THRESHOLD" : "TEMPO";

    // If meaningful steps already exist (and no blocks), keep them
    if (!hasBlocks && isStructuredSteps(bp?.steps)) {
      const kept = applyHrFallbackToSteps(bp.steps, profile, finalKind);

      const w = {
        sport: bp?.sport || "running",
        estimatedDistanceMeters: round(totalMeters || bp?.estimatedDistanceMeters || 0),
        steps: kept,
      };

      return injectKindIntoWorkout(finalKind, preserveBlueprintFields(bp, w));
    }

    if (hasBlocks) {
      const w0 = renderTempoFromBlueprint({
        blueprint: bp,
        profile,
        isDeload,
        totalMeters: totalMeters || round(bp?.estimatedDistanceMeters || 0) || 0,
        kindHint: finalKind,
        session,
      });

      // ✅ ensure bp fields survive
      const w = preserveBlueprintFields(bp, w0);

      return injectKindIntoWorkout(finalKind, w);
    }

    // Last-resort fallback: simple steady-time workout
    const { warmupSec, cooldownSec } = resolveWarmCooldownSec({ session, blueprint: bp, kindHint: finalKind });

    const steps = [];
    if (warmupSec > 0) {
      const wuTgt = hrTarget(profile, "z1");
      steps.push(warmupStep({ seconds: warmupSec, ...wuTgt }));
    }

    steps.push(
      steadyStepTime({
        seconds: 20 * 60,
        ...targetForIntensity({ profile, intensityLabel: finalKind, intensityKey: null, isDeload, kindHint: finalKind }),
      })
    );

    if (cooldownSec > 0) {
      const cdTgt = hrTarget(profile, "z1");
      steps.push(cooldownStep({ seconds: cooldownSec, ...cdTgt }));
    }

    const w = {
      sport: "running",
      estimatedDistanceMeters: round(totalMeters),
      steps: applyHrFallbackToSteps(steps, profile, finalKind),
    };

    return injectKindIntoWorkout(finalKind, preserveBlueprintFields(bp, w));
  }

  if (kind === "INTERVALS" || blueprintKind === "INTERVALS") {
    const bp = session?.workout && typeof session.workout === "object" ? session.workout : {};
    const hasBlocks = Array.isArray(bp?.blocks) && bp.blocks.length > 0;
    const hasSimple = Number(bp?.reps) > 0 && Number(bp?.repDistanceM) > 0 && !!bp?.recovery;

    if (hasBlocks || hasSimple) {
      const w0 = renderIntervalsFromBlueprint({
        blueprint: bp,
        profile,
        isDeload,
        totalMeters: totalMeters || round(bp?.estimatedDistanceMeters || 0) || 0,
        session,
      });

      // ✅ ensure bp fields survive
      const w = preserveBlueprintFields(bp, w0);

      const steps = Array.isArray(w?.steps) ? w.steps : [];
      const hasMain = steps.some((st) => st?.stepType === "repeat") || steps.some((st) => st?.stepType === "steady");
      if (!hasMain) {
        const fallback = buildIntervalsFallbackInvented({ profile, ctx, session });
        return injectKindIntoWorkout("INTERVALS", preserveBlueprintFields(bp, fallback));
      }

      return injectKindIntoWorkout("INTERVALS", w);
    }

    const fallback = buildIntervalsFallbackInvented({ profile, ctx, session });
    return injectKindIntoWorkout("INTERVALS", preserveBlueprintFields(bp, fallback));
  }

  if (kind === "STRIDES") {
    const w = buildStridesWorkout({ meters: totalMeters, profile, session });
    return injectKindIntoWorkout("STRIDES", w);
  }

  if (kind === "LONG") {
    const bp = session?.workout && typeof session.workout === "object" ? session.workout : {};
    const fallbackVariant =
      String(bp?.variant || session?.meta?.longVariant || "EASY").trim() || "EASY";

    // Keep meaningful long-run blueprints (e.g., fast finish/progression/blocks) instead of flattening to steady.
    if (isStructuredSteps(bp?.steps)) {
      const kept = applyHrFallbackToSteps(normalizeLongRunSteps(bp.steps), profile, "LONG");
      const w = {
        sport: bp?.sport || "running",
        estimatedDistanceMeters: round(totalMeters || bp?.estimatedDistanceMeters || 0),
        steps: kept,
        variant: fallbackVariant,
      };
      return injectKindIntoWorkout("LONG", preserveBlueprintFields(bp, w));
    }

    const flat = { ...buildLongWorkout({ meters: totalMeters, profile }), variant: fallbackVariant };
    return injectKindIntoWorkout("LONG", preserveBlueprintFields(bp, flat));
  }

  return injectKindIntoWorkout(kind, buildEasyWorkout({ meters: totalMeters, profile }));
}

/* ───────────────────────────────────────────
   Distance accounting for Option A
─────────────────────────────────────────── */

function estimateEasySecPerKm(profile) {
  const p = profile?.paces;
  if (p?.easy && Number.isFinite(Number(p.easy.maxSecPerKm))) {
    return Number(p.easy.maxSecPerKm);
  }
  return clamp(calc10kPaceSecPerKm(profile) + 60, 220, 480);
}

function warmCoolKmFromTime({ profile, warmupSec, cooldownSec }) {
  const secPerKm = estimateEasySecPerKm(profile);
  const wuKm = warmupSec > 0 ? warmupSec / secPerKm : 0;
  const cdKm = cooldownSec > 0 ? cooldownSec / secPerKm : 0;
  return { warmupKm: round1(wuKm), cooldownKm: round1(cdKm) };
}

function midPaceSecPerKm(rangeLike) {
  const min = toNum(rangeLike?.minSecPerKm);
  const max = toNum(rangeLike?.maxSecPerKm);
  if (min != null && max != null) return (min + max) / 2;
  if (min != null) return min;
  if (max != null) return max;
  return null;
}

function paceFromStepTarget(step) {
  if (!step || String(step?.targetType || "").toLowerCase() !== "pace_range") return null;
  return midPaceSecPerKm(step?.targetValue);
}

function fallbackPaceForKind({ kind, profile }) {
  const k = String(kind || "").toUpperCase();
  const p = profile?.paces || {};
  if (k === "INTERVALS" || k === "STRIDES") return midPaceSecPerKm(p.interval) ?? estimateEasySecPerKm(profile);
  if (k === "THRESHOLD" || k === "TEMPO") return midPaceSecPerKm(p.tempo) ?? estimateEasySecPerKm(profile);
  if (k === "LONG" || k === "EASY") return midPaceSecPerKm(p.easy) ?? estimateEasySecPerKm(profile);
  return estimateEasySecPerKm(profile);
}

function stepMetersEstimate(step, { profile, kind }) {
  if (!step || typeof step !== "object") return 0;
  const stepType = String(step?.stepType || "").toLowerCase();
  if (stepType === "repeat" && Array.isArray(step.steps)) {
    const loops = clamp(Math.round(toNum(step.repeatCount) ?? 0), 0, 500);
    const perLoop = step.steps.reduce((sum, st) => sum + stepMetersEstimate(st, { profile, kind }), 0);
    return loops * perLoop;
  }

  const durationType = String(step?.durationType || "").toLowerCase();
  const durationValue = toNum(step?.durationValue) ?? 0;
  if (durationValue <= 0) return 0;
  if (durationType === "distance") return durationValue;
  if (durationType !== "time") return 0;
  // Time-based warmup/recovery/cooldown segments are guidance/load management,
  // not additive distance budget in the exported contract.
  if (stepType === "warmup" || stepType === "cooldown" || stepType === "recovery") return 0;

  const paceFromTarget = paceFromStepTarget(step);
  const longTempoPace = midPaceSecPerKm(profile?.paces?.tempo);
  const longSteadyPace = midPaceSecPerKm(profile?.paces?.steady);
  const secPerKm = paceFromTarget != null
    ? paceFromTarget
    : stepType === "warmup" || stepType === "cooldown" || stepType === "recovery"
    ? estimateEasySecPerKm(profile)
    : String(kind || "").toUpperCase() === "LONG" && stepType === "tempo"
    ? longTempoPace ?? fallbackPaceForKind({ kind, profile })
    : String(kind || "").toUpperCase() === "LONG" && stepType === "steady" && durationType === "time"
    ? longSteadyPace ?? fallbackPaceForKind({ kind, profile })
    : fallbackPaceForKind({ kind, profile });

  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return 0;
  return (durationValue / secPerKm) * 1000;
}

function sumDistanceMetersFromSteps(step) {
  if (!step || typeof step !== "object") return 0;
  const stepType = String(step?.stepType || "").toLowerCase();
  if (stepType === "repeat" && Array.isArray(step?.steps)) {
    const reps = clamp(Math.round(toNum(step?.repeatCount) ?? 0), 0, 500);
    const perRep = step.steps.reduce((sum, st) => sum + sumDistanceMetersFromSteps(st), 0);
    return reps * perRep;
  }
  if (String(step?.durationType || "").toLowerCase() !== "distance") return 0;
  const meters = toNum(step?.durationValue) ?? 0;
  return meters > 0 ? meters : 0;
}

function capDistanceEncodedStepsToBudget(steps, budgetKm) {
  const arr = Array.isArray(steps) ? steps.map((st) => ({ ...st })) : [];
  const budgetMeters = Math.max(0, Math.round((toNum(budgetKm) ?? 0) * 1000));
  if (!arr.length || budgetMeters <= 0) return arr;

  const totalMeters = arr.reduce((sum, st) => sum + sumDistanceMetersFromSteps(st), 0);
  if (totalMeters <= budgetMeters + 25) return arr;

  let adjusted = arr;
  let remainingMeters = totalMeters;

  for (let i = 0; i < adjusted.length; i++) {
    const st = adjusted[i];
    if (String(st?.stepType || "").toLowerCase() !== "repeat" || !Array.isArray(st?.steps)) continue;
    const repeatCount = Math.max(1, Math.round(toNum(st?.repeatCount) ?? 1));
    const workIdx = st.steps.findIndex(
      (x) =>
        String(x?.stepType || "").toLowerCase() === "steady" &&
        String(x?.durationType || "").toLowerCase() === "distance" &&
        (toNum(x?.durationValue) ?? 0) > 0
    );
    if (workIdx < 0) continue;

    const workMeters = Math.round(toNum(st.steps[workIdx]?.durationValue) ?? 0);
    if (workMeters <= 0) continue;

    const repeatDistanceMeters = repeatCount * workMeters;
    const otherMeters = Math.max(0, remainingMeters - repeatDistanceMeters);
    const availableForRepeat = Math.max(0, budgetMeters - otherMeters);
    if (availableForRepeat >= repeatDistanceMeters) continue;

    const nextRepeat = { ...st, steps: st.steps.map((x) => ({ ...x })) };
    if (repeatCount <= 3) {
      const scaledWorkMeters = Math.floor((availableForRepeat / repeatCount) / 50) * 50;
      if (scaledWorkMeters >= 100) {
        nextRepeat.steps[workIdx].durationValue = scaledWorkMeters;
      } else {
        const allowedReps = Math.max(1, Math.floor(availableForRepeat / workMeters));
        nextRepeat.repeatCount = allowedReps;
      }
    } else {
      const allowedReps = Math.max(1, Math.floor(availableForRepeat / workMeters));
      nextRepeat.repeatCount = allowedReps;
    }

    adjusted[i] = nextRepeat;
    remainingMeters = adjusted.reduce((sum, s) => sum + sumDistanceMetersFromSteps(s), 0);
    break;
  }

  return adjusted;
}

function sumStepTimeByType(step, typeName) {
  if (!step || typeof step !== "object") return 0;
  const isRepeat = String(step?.stepType || "").toLowerCase() === "repeat";
  if (isRepeat && Array.isArray(step.steps)) {
    const loops = clamp(Math.round(toNum(step.repeatCount) ?? 0), 0, 500);
    const perLoop = step.steps.reduce((sum, st) => sum + sumStepTimeByType(st, typeName), 0);
    return loops * perLoop;
  }

  const st = String(step?.stepType || "").toLowerCase();
  const dt = String(step?.durationType || "").toLowerCase();
  const dv = toNum(step?.durationValue) ?? 0;
  if (st !== typeName || dt !== "time" || dv <= 0) return 0;
  return dv;
}

function qualityMetersFromStep(step) {
  if (!step || typeof step !== "object") return 0;
  const stepType = String(step?.stepType || "").toLowerCase();
  if (stepType === "repeat" && Array.isArray(step.steps)) {
    const loops = clamp(Math.round(toNum(step.repeatCount) ?? 0), 0, 500);
    const perLoop = step.steps.reduce((sum, st) => sum + qualityMetersFromStep(st), 0);
    return loops * perLoop;
  }

  if (stepType !== "steady") return 0;
  if (String(step?.targetType || "").toLowerCase() !== "pace_range") return 0;
  return stepMetersEstimate(step, { profile: null, kind: "INTERVALS" });
}

function isHardKind(kind) {
  const k = String(kind || "").toUpperCase();
  return k === "INTERVALS" || k === "THRESHOLD" || k === "TEMPO" || k === "HILLS";
}

function formatDurationLabel(step) {
  const dt = String(step?.durationType || "").toLowerCase();
  const dv = Math.round(toNum(step?.durationValue) ?? 0);
  if (dv <= 0) return null;
  if (dt === "distance") return `${dv}m`;
  if (dt !== "time") return null;
  if (dv % 60 === 0) return `${Math.round(dv / 60)} min`;
  return `${dv}s`;
}

function summarizeMainSetFromSteps(steps) {
  const arr = Array.isArray(steps) ? steps : [];
  if (!arr.length) return null;

  const repIdx = arr.findIndex((s) => String(s?.stepType || "").toLowerCase() === "repeat" && Array.isArray(s?.steps));
  if (repIdx >= 0) {
    const rep = arr[repIdx];
    const work = rep.steps.find((st) => String(st?.stepType || "").toLowerCase() === "steady") || rep.steps[0];
    const rec = rep.steps.find((st) => String(st?.stepType || "").toLowerCase() === "recovery");
    const workLabel = formatDurationLabel(work);
    if (workLabel) {
      let reps = Math.max(1, Math.round(toNum(rep?.repeatCount) ?? 1));
      const next = arr[repIdx + 1];
      const nextIsExtraRep =
        String(next?.stepType || "").toLowerCase() === "steady" &&
        String(next?.durationType || "").toLowerCase() === String(work?.durationType || "").toLowerCase() &&
        Math.round(toNum(next?.durationValue) ?? -1) === Math.round(toNum(work?.durationValue) ?? -2) &&
        String(next?.targetType || "").toLowerCase() === String(work?.targetType || "").toLowerCase();
      if (nextIsExtraRep) reps += 1;

      const recLabel = formatDurationLabel(rec);
      return recLabel ? `${reps}x${workLabel} (rec ${recLabel})` : `${reps}x${workLabel}`;
    }
  }

  const steady = arr.find((s) => String(s?.stepType || "").toLowerCase() === "steady");
  const steadyLabel = formatDurationLabel(steady);
  if (!steadyLabel) return null;
  const tt = String(steady?.targetType || "").toLowerCase();
  if (tt === "pace_range") return `${steadyLabel} tempo`;
  return `${steadyLabel} steady`;
}

function qualityNotesFromSteps({ warmupMin, cooldownMin, mainSet }) {
  const parts = [];
  if (Number.isFinite(warmupMin) && warmupMin > 0) parts.push(`Warm up ${warmupMin} min easy.`);
  if (mainSet) parts.push(`Main set: ${mainSet}.`);
  if (Number.isFinite(cooldownMin) && cooldownMin > 0) parts.push(`Cool down ${cooldownMin} min easy.`);
  return parts.join(" ").trim() || null;
}

function extractRepairAnnotations(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const matches = s.match(/\([^)]*\)/g) || [];
  return matches
    .map((m) => m.trim())
    .filter((m) => /guardrail|adjust|rebalanced|capped|drift/i.test(m));
}

function mergeQualityNotesWithAnnotations({ rebuiltNotes, originalNotes }) {
  if (!rebuiltNotes) return String(originalNotes || "").trim() || null;
  const annotations = extractRepairAnnotations(originalNotes);
  if (!annotations.length) return rebuiltNotes;
  return `${rebuiltNotes} ${annotations.join(" ")}`.replace(/\s+/g, " ").trim();
}

function isGenericQualitySummary(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return true;
  return (
    s === "hold pace range" ||
    s === "intervals set" ||
    s === "comfortable pace" ||
    s === "easy effort" ||
    s === "easy all the way"
  );
}

function computeTotalKmForSession({ session, kind, profile, steps }) {
  const baseKm = toNum(session?.plannedDistanceKm) ?? toNum(session?.distanceKm) ?? 0;

  if (kind === "EASY") {
    return {
      warmupMin: null,
      cooldownMin: null,
      warmupKm: 0,
      cooldownKm: 0,
      computedTotalKm: round1(baseKm),
      isQualityLong: false,
    };
  }

  const stepsList = Array.isArray(steps) ? steps : [];
  const isQualityLong = kind === "LONG" && hasQualityLongContent(stepsList);
  if (kind === "LONG" && !isQualityLong) {
    return {
      warmupMin: null,
      cooldownMin: null,
      warmupKm: 0,
      cooldownKm: 0,
      computedTotalKm: round1(baseKm),
      isQualityLong: false,
    };
  }
  const warmupSecFromSteps = stepsList.reduce((sum, st) => sum + sumStepTimeByType(st, "warmup"), 0);
  const cooldownSecFromSteps = stepsList.reduce((sum, st) => sum + sumStepTimeByType(st, "cooldown"), 0);
  const fallbackWarmCool = resolveWarmCooldownSec({ session, blueprint: session?.workout, kindHint: kind });
  const warmupSec = warmupSecFromSteps > 0 ? warmupSecFromSteps : fallbackWarmCool.warmupSec;
  const cooldownSec = cooldownSecFromSteps > 0 ? cooldownSecFromSteps : fallbackWarmCool.cooldownSec;

  const warmupMin = warmupSec > 0 ? Math.round(warmupSec / 60) : null;
  const cooldownMin = cooldownSec > 0 ? Math.round(cooldownSec / 60) : null;

  const { warmupKm, cooldownKm } = { warmupKm: 0, cooldownKm: 0 };
  const stepMeters = stepsList.reduce((sum, st) => sum + stepMetersEstimate(st, { profile, kind }), 0);
  const computedFromStepsKm = round1(stepMeters / 1000);
  const hardSession = isHardKind(kind) || (String(kind || "").toUpperCase() === "LONG" && !!isQualityLong);
  const lowerBoundRatio = hardSession ? 0.8 : 0.7;
  const lowerBound = round1(Math.max(0.5, baseKm * lowerBoundRatio));
  const upperBound = round1(Math.max(baseKm + 0.5, baseKm * 3.5));
  const boundedComputedKm =
    computedFromStepsKm > 0 ? round1(clamp(computedFromStepsKm, lowerBound, upperBound)) : round1(baseKm);
  return {
    warmupMin,
    cooldownMin,
    warmupKm,
    cooldownKm,
    computedTotalKm: boundedComputedKm,
    isQualityLong,
  };
}

// Keep rendered distance close to budget for quality non-long sessions so
// weekly rendered load stays guardrail-coherent while preserving step fidelity.
function capRenderedSessionKm({ kind, budgetKm, renderedKm, isQualityLong = false }) {
  const k = String(kind || "").toUpperCase();
  const budget = Math.max(0, toNum(budgetKm) ?? 0);
  const rendered = Math.max(0, toNum(renderedKm) ?? budget);
  if (budget <= 0) return round1(rendered);

  if (k === "LONG" && isQualityLong) {
    const maxMultiplier = 1.16;
    const maxExtraKm = 1.6;
    const capKm = budget + Math.min(maxExtraKm, budget * (maxMultiplier - 1));
    return round1(Math.min(rendered, capKm));
  }

  const isQualityNonLong = isHardKind(k) && k !== "LONG";
  if (!isQualityNonLong) return round1(rendered);

  const maxMultiplier = 1.35;
  const maxExtraKm = 2.5;
  const capKm = budget + Math.min(maxExtraKm, budget * (maxMultiplier - 1));
  // Upper-cap only: do not floor to budget, or identity math can drift when
  // rendered estimate is legitimately below planned budget distance.
  return round1(Math.min(rendered, capKm));
}

/**
 * Attach Garmin workouts + steps to sessions.
 */
export function attachGarminStepsToSessions(plan, profile) {
  if (!plan?.weeks || !Array.isArray(plan.weeks)) return plan;

  const totalWeeks = plan.weeks.length;

  const weeks = plan.weeks.map((w) => {
    const isDeload = !!w?.targets?.isDeload;
    const weekIndex = Number(w?.weekIndex || w?.targets?.weekIndex || 0) || null;
    const ctx = { isDeload, weekIndex };
    const weekWeeklyKm =
      toNum(w?.metrics?.plannedWeeklyKm) ??
      toNum(w?.metrics?.targetWeeklyKm) ??
      toNum(w?.targets?.weeklyKm) ??
      toNum(profile?.weeklyKm) ??
      0;
    const phaseOverride = String(w?.phase || w?.targets?.phase || "").toLowerCase() || undefined;

    const baseSessions = Array.isArray(w.sessions) ? w.sessions : [];

    const sessions = baseSessions.map((s) => {
      // Renderer-only contract:
      // do not regenerate session templates or mutate training budget intent here.
      const rebuiltSession = s;
      const kind = getSessionKind(rebuiltSession);

      const baseKm =
        toNum(rebuiltSession?.plannedDistanceKm) ??
        toNum(rebuiltSession?.budgetedDistanceKm) ??
        toNum(rebuiltSession?.distanceKm) ??
        0;

      const sessionForBuild = {
        ...rebuiltSession,
        plannedDistanceKm: round1(baseKm),
        distanceKm: round1(baseKm),
        distance: round1(baseKm),
        distanceMeters: Math.max(0, Math.round((round1(baseKm) || 0) * 1000)),
      };

      const workoutBuilt = buildGarminWorkoutForSession(sessionForBuild, profile, ctx);
      const durableKind = String(sessionForBuild?.workoutKind || workoutBuilt?.kind || kind || "EASY").toUpperCase();

      const stepsRaw = Array.isArray(workoutBuilt?.steps) ? workoutBuilt.steps : [];
      const stepsNormalized = normalizeCooldownEncoding(normalizeRepeatEncoding(stepsRaw), profile);
      const stepsBudgetCapped = capDistanceEncodedStepsToBudget(stepsNormalized, baseKm);
      const steps = applyHrFallbackToSteps(stepsBudgetCapped, profile, durableKind);
      const dist = computeTotalKmForSession({ session: sessionForBuild, kind: durableKind, profile, steps });
      const renderedTotalKmRaw = dist.computedTotalKm ?? round1(baseKm);
      const shouldUseRendered =
        (isHardKind(durableKind) && durableKind !== "LONG") || (durableKind === "LONG" && !!dist?.isQualityLong);
      const renderedSessionKmRaw = shouldUseRendered ? round1(renderedTotalKmRaw) : round1(baseKm);
      // Keep session-level rendered/executable fields aligned to steps.
      // Weekly quality-share caps are reported in weekly metrics, not by mutating
      // per-session step-derived distance fields.
      const renderedSessionKm = round1(renderedSessionKmRaw);
      const renderedPolicyCapSessionKm = capRenderedSessionKm({
        kind: durableKind,
        budgetKm: baseKm,
        renderedKm: renderedSessionKmRaw,
        isQualityLong: !!dist?.isQualityLong,
      });
      const budgetSessionKm = round1(baseKm);
      const budgetedEstimatedDistanceMeters = Math.max(0, Math.round((budgetSessionKm || 0) * 1000));
      const executableEstimatedDistanceMeters = Math.max(0, Math.round((renderedSessionKm || 0) * 1000));
      const guidance = deriveSessionGuidance({
        steps,
        profile,
        kind: durableKind,
        isDeload,
      });
      const isQualityLongSession = durableKind === "LONG" && !!dist?.isQualityLong;
      const longOverallPace = isQualityLongSession
        ? defaultPaceRangeForKind({ profile, kind: "LONG", isDeload })
        : null;
      const longOverallHr = isQualityLongSession
        ? hrRangeForZone(profile, "z2") || hrZoneLabel("z2")
        : null;

      // ✅ IMPORTANT: preserve blueprint fields on the final workout object too
      const bp =
        sessionForBuild?.workout && typeof sessionForBuild.workout === "object" ? sessionForBuild.workout : null;

      // keep variant/blocks/meta visible on workoutBuilt (and infer if needed)
      const workout = preserveBlueprintFields(bp, workoutBuilt);

      let keyTargets = sessionForBuild?.keyTargets;
      let notes = sessionForBuild?.notes;
      if (isHardKind(durableKind) && durableKind !== "LONG") {
        const keyTargetMainSet =
          !isGenericQualitySummary(keyTargets) && String(keyTargets || "").trim()
            ? String(keyTargets).trim()
            : null;
        const mainSet = summarizeMainSetFromSteps(steps) || keyTargetMainSet;
        const rebuiltNotes = qualityNotesFromSteps({
          warmupMin: dist.warmupMin,
          cooldownMin: dist.cooldownMin,
          mainSet,
        });
        if (mainSet) keyTargets = mainSet;
        notes = mergeQualityNotesWithAnnotations({
          rebuiltNotes,
          originalNotes: notes,
        });
      }

      return {
        ...sessionForBuild,
        workoutKind: durableKind,
        sessionType: sessionForBuild?.sessionType || sessionForBuild?.type || durableKind,
        keyTargets,
        notes,
        distanceSemantics: {
          model: "dual_budget_and_rendered",
          budgetPrimary: true,
          budgeted: {
            sessionKmField: "plannedDistanceKm",
            computedKmField: "budgetedComputedKm",
            estimatedMetersField: "workout.budgetedEstimatedDistanceMeters",
          },
          rendered: {
            sessionKmField: "renderedDistanceKm",
            computedKmField: "renderedComputedTotalKm",
            estimatedMetersField: "workout.renderedEstimatedDistanceMeters",
          },
        },
        meta: {
          ...(sessionForBuild?.meta && typeof sessionForBuild.meta === "object" ? sessionForBuild.meta : {}),
          plannedBudgetKm: round1(baseKm),
        },

        workout: {
          ...(workout || {}),
          // Estimated distance should match the executable step content.
          estimatedDistanceMeters: executableEstimatedDistanceMeters,
          // Budget contract is exposed via explicit budgeted* aliases.
          budgetedEstimatedDistanceMeters,
          renderedEstimatedDistanceMeters: executableEstimatedDistanceMeters,
          executableEstimatedDistanceMeters,
          meta: {
            ...((workout && typeof workout === "object" && workout.meta && typeof workout.meta === "object")
              ? workout.meta
              : {}),
            distanceSemanticsModel: "dual_budget_and_rendered",
            budgetPrimary: true,
            sessionKm: budgetSessionKm,
            budgetedSessionKm: budgetSessionKm,
            renderedSessionKm,
            executableSessionKm: renderedSessionKm,
            renderedUncappedSessionKm: renderedSessionKmRaw,
            renderedPolicyCapSessionKm: round1(renderedPolicyCapSessionKm),
            renderedPolicyCapDeferred: renderedPolicyCapSessionKm < renderedSessionKm,
            renderedCapApplied: false,
            computedFromStepsKm: round1(dist.computedTotalKm ?? budgetSessionKm),
            targetSemantics:
              isQualityLongSession
                ? "primary_quality_segment"
                : "session_overall",
          },
          steps,
          paceTarget: guidance.paceRange,
          hrTarget: guidance.hrRange,
        },

        steps,
        targetPace: guidance.paceRange,
        targetHr: guidance.hrRange,
        targetSource: guidance.source,
        targetPacePrimary: isQualityLongSession ? guidance.paceRange : null,
        targetHrPrimary: isQualityLongSession ? guidance.hrRange : null,
        targetPaceOverall: longOverallPace,
        targetHrOverall: longOverallHr,
        targetSemantics:
          isQualityLongSession
            ? "primary_quality_segment"
            : "session_overall",

        warmupMin: dist.warmupMin,
        cooldownMin: dist.cooldownMin,
        warmupKm: dist.warmupKm,
        cooldownKm: dist.cooldownKm,

        computedTotalKm: renderedSessionKm,
        computedFromStepsKm: round1(dist.computedTotalKm ?? budgetSessionKm),
        budgetedDistanceKm: budgetSessionKm,
        budgetedComputedKm: budgetSessionKm,
        renderedDistanceKm: renderedSessionKm,
        renderedComputedTotalKm: renderedSessionKm,
        executableDistanceKm: renderedSessionKm,
        executableComputedKm: renderedSessionKm,

        plannedDistanceKm: budgetSessionKm,
        plannedDistanceMeters: budgetedEstimatedDistanceMeters,
        // Canonical contract: distance* aliases remain budget truth.
        // Executable/rendered totals live in explicit rendered*/executable* fields.
        distanceKm: budgetSessionKm,
        distance: budgetSessionKm,
        distanceMeters: budgetedEstimatedDistanceMeters,
      };
    });

    const days = Array.isArray(w.days)
      ? w.days.map((d) => {
          const day = String(d?.day || "").trim();
          const daySessions = sessions.filter((s) => String(s?.day || "").trim() === day);
          return { ...d, sessions: daySessions };
        })
      : w.days;

    return { ...w, sessions, days };
  });

  return { ...plan, weeks };
}
