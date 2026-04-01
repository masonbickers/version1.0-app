// server/lib/train/planRules/workouts/intervalWorkouts.js
//
// Intervals builder: expanded to cover “best practice” interval menus from 5K → Ultra.
// ✅ Distance-based + (optional) time-based (for Ultra cruise/hills)
// ✅ Deterministic pick (phase/goal/weekIndex/weeklyKm/experience/deload)
// ✅ Blueprint-first: blueprint.blocks + blueprint.variant
// ✅ Legacy fields derived from blocks (reps/repDistanceM/recovery) so old UI won’t drift
//
// RUNNA-LEVEL CONTRACT (IMPORTANT):
// ✅ totalKm is the distance budget for the SESSION excluding warmup/cooldown.
// ✅ warmup/cooldown are time steps added by renderer; they must not squeeze main sets.
// ✅ Main-set + recoveries should approximately equal totalKm.
// ✅ If a chosen workout under-fills the budget after fitting, add a FILL_DISTANCE block.
//
// ✅ Updates in this version:
// - Budget uses full totalKm (no buffer subtraction).
// - Adds FILL_DISTANCE block to top-up to budget.
// - fitBlocksToBudget trims filler first if we’re over budget.
// - sumTotalMeters understands FILL_DISTANCE.
// - blocksKeyTargets ignores filler for display.
// - deriveLegacyFromBlocks ignores filler.
//
// ✅ UPDATE IN THIS VERSION (variant hardening):
// - Guarantees blueprint.variant is NEVER null/empty.
// - If picked.variant is missing, we infer a stable variant from blocks (+ _PLUS_FILL when filler exists).
//   This fixes downstream consumers seeing workout.variant === null.

import { RULES } from "../rulesConfig.js";
import {
  normaliseExperienceKey,
  normaliseGoalDistanceKey,
} from "../normalization.js";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intervalFidelityPolicy() {
  const cfg = RULES?.fidelity?.intervals || {};
  const capCfg = cfg?.phaseWorkCapMult || {};
  return {
    floorNonTaper: toNum(cfg?.floorRatioNonTaper) ?? 0.85,
    floorDeload: toNum(cfg?.floorRatioDeload) ?? 0.7,
    floorTaper: toNum(cfg?.floorRatioTaper) ?? 0,
    taperMinKeepRatio: toNum(cfg?.taperMinKeepRatio) ?? 0.75,
    deloadCapMult: toNum(capCfg?.deload) ?? 1.1,
    taperCapMult: toNum(capCfg?.taper) ?? 1.05,
  };
}

function getWeeklyKm(profile = {}) {
  return toNum(profile?.weeklyKm) ?? 0;
}

function getTotalWeeks(profile = {}, fallback = 12) {
  return toNum(profile?.planLengthWeeks) ?? fallback;
}

function getPhase(weekIndex, totalWeeks) {
  const w = Number(weekIndex || 1);
  const tw = Math.max(1, Number(totalWeeks || 12));
  const p = w / tw;
  if (p <= 0.35) return "base";
  if (p <= 0.75) return "build";
  if (p <= 0.9) return "specific";
  return "taper";
}

function normExperience(profile = {}) {
  return normaliseExperienceKey(profile?.experienceKey);
}

function normaliseGoalDistance(profile = {}) {
  const raw = profile?.goalDistanceKey ?? "";
  const key = normaliseGoalDistanceKey(raw, {
    fallback: "GENERAL",
    allowGeneral: true,
    allowReturn: true,
  });
  return key === "RETURN" ? "GENERAL" : key;
}

function goalOffset(goalKey) {
  const s = String(goalKey || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 11;
}

function hashString(s) {
  const str = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function computeTargetWorkMeters({ wkKm, phase, goalKey, expKey, isDeload }) {
  const advanced = expKey === "advanced";
  const regular = expKey === "regular";
  const newer = expKey === "new";

  const base =
    wkKm >= 80 ? 7200 :
    wkKm >= 65 ? 6000 :
    wkKm >= 55 ? 5200 :
    wkKm >= 45 ? 4400 :
    wkKm >= 35 ? 3600 :
    wkKm >= 25 ? 2800 :
    wkKm >= 18 ? 2200 :
    1800;

  let goalShift = 0;
  if (goalKey === "5K") goalShift = +700;
  else if (goalKey === "10K") goalShift = +400;
  else if (goalKey === "HALF") goalShift = +200;
  else if (goalKey === "MARATHON") goalShift = +100;
  else if (goalKey === "ULTRA") goalShift = 0;

  let phaseShift = 0;
  if (phase === "base") phaseShift = -200;
  if (phase === "build") phaseShift = +250;
  if (phase === "specific") phaseShift = +450;
  if (phase === "taper") phaseShift = -1400;

  let target = base + goalShift + phaseShift;

  const cap =
    advanced ? 9000 :
    regular ? 7000 :
    newer ? 3800 :
    5600;

  target = clamp(target, 1600, cap);

  if (isDeload) target = Math.max(1200, Math.round(target * 0.75));

  return Math.round(target / 100) * 100;
}

function computeTargetWorkSecondsUltra({ wkKm, phase, expKey, isDeload }) {
  const advanced = expKey === "advanced";
  const newer = expKey === "new";

  let baseMin =
    wkKm >= 80 ? 42 :
    wkKm >= 60 ? 36 :
    wkKm >= 45 ? 30 :
    wkKm >= 30 ? 24 :
    20;

  if (phase === "base") baseMin -= 4;
  if (phase === "specific") baseMin += 6;
  if (phase === "taper") baseMin -= 12;

  const capMin = advanced ? 50 : newer ? 28 : 40;
  baseMin = clamp(baseMin, 16, capMin);

  if (isDeload) baseMin = Math.max(12, Math.round(baseMin * 0.75));

  return Math.round(baseMin * 60);
}

// -----------------------------
// Intensity helpers (renderer-friendly)
// -----------------------------

function intensityForGoal(goalKey) {
  if (goalKey === "5K") return "5K";
  if (goalKey === "10K") return "10K";
  if (goalKey === "HALF") return "HMP";
  if (goalKey === "MARATHON" || goalKey === "ULTRA") return "STEADY";
  return "10K";
}

function attachIntensity(obj, { intensityKey, intensityLabel }) {
  return {
    ...obj,
    intensityKey: intensityKey || null,
    intensity: intensityLabel || null,
  };
}

function baseRecoveryForRepM(repM, phase, isDeload, goalKey) {
  const base =
    repM <= 200 ? 45 :
    repM <= 300 ? 60 :
    repM <= 400 ? 75 :
    repM <= 600 ? 90 :
    repM <= 800 ? 120 :
    repM <= 1200 ? 150 :
    repM <= 1600 ? 180 :
    repM <= 2000 ? 180 :
    repM <= 3000 ? 150 :
    repM <= 5000 ? 120 :
    120;

  const goalAdj =
    goalKey === "MARATHON" ? -10 :
    goalKey === "HALF" ? -5 :
    goalKey === "ULTRA" ? -10 :
    0;

  const phaseBump = phase === "taper" ? 10 : phase === "specific" ? 5 : 0;
  const deloadBump = isDeload ? 10 : 0;
  return clamp(base + phaseBump + deloadBump + goalAdj, 30, 240);
}

function sumWorkMeters(blocks = []) {
  let sum = 0;

  for (const b of blocks) {
    if (!b) continue;

    // filler is NOT counted as "work"
    if (b.type === "FILL_DISTANCE") continue;

    if (b.type === "REPEAT_DISTANCE") {
      sum += Number(b.reps || 0) * Number(b.workM || 0);
      continue;
    }

    if (b.type === "PYRAMID_DISTANCE") {
      const arr = Array.isArray(b.repsM) ? b.repsM : [];
      sum += arr.reduce((a, m) => a + Number(m || 0), 0);
      continue;
    }

    if (b.type === "MIXED_SET") {
      const sets = Number(b.sets || 0);
      const reps = Array.isArray(b.reps) ? b.reps : [];
      const perSet = reps.reduce((a, r) => a + Number(r?.workM || 0), 0);
      sum += sets * perSet;
      continue;
    }

    if (b.type === "FLOATING") {
      sum += Number(b.reps || 0) * Number(b.workM || 0);
      continue;
    }

    if (b.type === "ON_OFF_KM" || b.type === "ON_OFF_DISTANCE") {
      sum += Number(b.reps || 0) * Number(b.onM || 0);
      continue;
    }

    if (b.type === "BROKEN_K") {
      const reps = Number(b.reps || 1);
      sum += reps * Number(b.distanceM || 1000);
      continue;
    }

    if (b.type === "OVER_UNDER_1K") {
      sum += Number(b.reps || 0) * 1000;
      continue;
    }

    if (b.type === "REPEAT_TIME" || b.type === "CRUISE_TIME" || b.type === "HILL_REPEAT_TIME") {
      continue;
    }
  }

  return Math.round(sum);
}

// -----------------------------
// ✅ Total metres incl. recoveries (estimated) for budgeting
// -----------------------------

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

function estimateEasySecPerKm(profile = {}) {
  const min = toNum(profile?.paces?.easy?.minSecPerKm);
  const max = toNum(profile?.paces?.easy?.maxSecPerKm);
  if (min != null && max != null && min > 0 && max > 0) return (min + max) / 2;

  const recent = profile.current?.recentTimes || profile.recentTimes || {};
  const tenK = parseTimeToSeconds(recent.tenK);
  if (tenK) return tenK / 10 + 85;

  return 270 + 85;
}

function metersFromTimeAtEasyPace(sec, profile) {
  const pace = Math.max(1, Number(estimateEasySecPerKm(profile) || 300));
  const s = Math.max(0, Number(sec || 0));
  return Math.round((s / pace) * 1000);
}

function sumTotalMeters(blocks = [], profile) {
  let sum = 0;

  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b) continue;

    if (b.type === "FILL_DISTANCE") {
      sum += Math.max(0, Number(b.meters || b.workM || 0));
      continue;
    }

    if (b.type === "REPEAT_DISTANCE") {
      const reps = Math.max(0, Number(b.reps || 0));
      const workM = Math.max(0, Number(b.workM || 0));
      sum += reps * workM;

      const gaps = Math.max(0, reps - 1);

      const r = b.recover || {};
      const rType = String(r.type || "TIME").toUpperCase();
      if (rType === "DISTANCE") {
        sum += gaps * Math.max(0, Number(r.m || r.valueM || 0));
      } else {
        const sec = Math.max(0, Number(r.sec || r.valueSec || 0));
        sum += gaps * metersFromTimeAtEasyPace(sec, profile);
      }
      continue;
    }

    if (b.type === "PYRAMID_DISTANCE") {
      const arr = Array.isArray(b.repsM) ? b.repsM : [];
      const clean = arr.map(Number).filter((x) => Number.isFinite(x) && x > 0);

      sum += clean.reduce((a, m) => a + m, 0);

      const gaps = Math.max(0, clean.length - 1);
      const r = b.recover || {};
      const rType = String(r.type || "TIME").toUpperCase();

      if (rType === "DISTANCE") {
        sum += gaps * Math.max(0, Number(r.m || r.valueM || 0));
      } else {
        const sec = Math.max(0, Number(r.sec || r.valueSec || 90));
        sum += gaps * metersFromTimeAtEasyPace(sec, profile);
      }

      continue;
    }

    if (b.type === "MIXED_SET") {
      const sets = Math.max(0, Number(b.sets || 0));
      const reps = Array.isArray(b.reps) ? b.reps : [];

      const workPerSet = reps.reduce((a, r) => a + Math.max(0, Number(r?.workM || 0)), 0);
      sum += sets * workPerSet;

      if (reps.length >= 2) {
        const betweenRecM = reps
          .slice(0, -1)
          .reduce((a, r) => a + metersFromTimeAtEasyPace(Math.max(0, Number(r?.recoverSec || 0)), profile), 0);
        sum += sets * betweenRecM;
      }
      continue;
    }

    if (b.type === "FLOATING") {
      sum += Number(b.reps || 0) * Number(b.workM || 0);
      continue;
    }

    if (b.type === "ON_OFF_KM" || b.type === "ON_OFF_DISTANCE") {
      sum += Number(b.reps || 0) * (Number(b.onM || 0) + Number(b.offM || 0));
      continue;
    }

    if (b.type === "BROKEN_K") {
      const reps = Number(b.reps || 1);
      sum += reps * Number(b.distanceM || 1000);
      continue;
    }

    if (b.type === "OVER_UNDER_1K") {
      const reps = Math.max(0, Number(b.reps || 0));
      sum += reps * 2000;

      const gaps = Math.max(0, reps - 1);
      const recSec = Math.max(0, Number(b.recoverSec || 60));
      sum += gaps * metersFromTimeAtEasyPace(recSec, profile);

      continue;
    }

    if (b.type === "REPEAT_TIME" || b.type === "CRUISE_TIME" || b.type === "HILL_REPEAT_TIME") continue;
  }

  return Math.max(0, Math.round(sum));
}

// -----------------------------
// Variant hardening helpers
// -----------------------------

function normaliseVariant(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function isFillerBlock(b) {
  return b && typeof b === "object" && String(b.type || "").toUpperCase() === "FILL_DISTANCE";
}

function inferVariantFromBlocks(blocks = [], goalKey = "GENERAL") {
  const arr = Array.isArray(blocks) ? blocks : [];
  if (!arr.length) return null;

  const hasFill = arr.some((b) => isFillerBlock(b));
  const real = arr.filter((b) => !isFillerBlock(b));
  const b0 = real[0] || arr[0];
  if (!b0 || typeof b0 !== "object") return null;

  const t = String(b0.type || "").toUpperCase();

  let base = null;

  if (t === "REPEAT_DISTANCE") {
    const reps = Number(b0.reps || 0) || 6;
    const workM = Number(b0.workM || 0) || 400;
    base = `${goalKey}_REPEAT_${reps}x${workM}m`;
  } else if (t === "ON_OFF_KM" || t === "ON_OFF_DISTANCE") {
    const reps = Number(b0.reps || 0) || 4;
    const onM = Number(b0.onM || 0) || 1000;
    const offM = Number(b0.offM || 0) || 1000;
    base = `${goalKey}_ONOFF_${reps}x${onM}on_${offM}off`;
  } else if (t === "PYRAMID_DISTANCE") {
    const repsM = Array.isArray(b0.repsM) ? b0.repsM.map(Number).filter((x) => Number.isFinite(x) && x > 0) : [];
    const mn = repsM.length ? Math.min(...repsM) : 0;
    const mx = repsM.length ? Math.max(...repsM) : 0;
    base = `${goalKey}_LADDER_${mn}_${mx}`;
  } else if (t === "MIXED_SET") {
    const sets = Number(b0.sets || 0) || 1;
    base = `${goalKey}_MIXED_${sets}set`;
  } else if (t === "OVER_UNDER_1K") {
    const reps = Number(b0.reps || 0) || 4;
    base = `${goalKey}_OVERUNDER_${reps}x1k`;
  } else if (t === "BROKEN_K") {
    const reps = Number(b0.reps || 0) || 4;
    const d = Number(b0.distanceM || 1000) || 1000;
    base = `${goalKey}_BROKEN_${reps}x${d}m`;
  } else if (t === "FLOATING") {
    const reps = Number(b0.reps || 0) || 6;
    const workM = Number(b0.workM || 0) || 400;
    base = `${goalKey}_FLOAT_${reps}x${workM}m`;
  } else if (t === "REPEAT_TIME" || t === "CRUISE_TIME" || t === "HILL_REPEAT_TIME") {
    const reps = Number(b0.reps || 0) || 6;
    const workSec = Number(b0.workSec || 0) || 240;
    base = `${goalKey}_${t}_${reps}x${Math.round(workSec)}s`;
  } else {
    base = `${goalKey}_${t}`;
  }

  if (!base) return null;
  return hasFill ? `${base}_PLUS_FILL` : base;
}

// -----------------------------
// Block builders (distance)
// -----------------------------

function buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload, intensityKey = "interval", intensityLabel }) {
  const recSec = baseRecoveryForRepM(repM, phase, isDeload, goalKey);

  return attachIntensity(
    {
      type: "REPEAT_DISTANCE",
      reps,
      workM: repM,
      recover: { type: "TIME", sec: recSec },
    },
    { intensityKey, intensityLabel: intensityLabel || intensityForGoal(goalKey) }
  );
}

function buildPyramidExactLadder({ repsM, recoverSec = 90, goalKey }) {
  return attachIntensity(
    {
      type: "PYRAMID_DISTANCE",
      repsM,
      recover: { type: "TIME", sec: recoverSec },
    },
    { intensityKey: "interval", intensityLabel: intensityForGoal(goalKey) }
  );
}

function buildMixedSet({ sets, parts, goalKey }) {
  return {
    type: "MIXED_SET",
    sets,
    reps: parts.map((p) => ({
      workM: Number(p.workM || 0),
      recoverSec: Number(p.recoverSec || 0),
      intensityKey: p.intensityKey || "interval",
      intensity: p.intensity || intensityForGoal(goalKey),
    })),
  };
}

function buildOnOffKm({ reps, onM, offM, goalKey, onIntensityKey = "interval", offIntensityKey = "steady" }) {
  return {
    type: "ON_OFF_KM",
    reps,
    onM,
    offM,
    intensityOn: intensityForGoal(goalKey),
    intensityOnKey: onIntensityKey,
    intensityOff: "STEADY",
    intensityOffKey: offIntensityKey,
  };
}

function buildOverUnder1k({ reps, goalKey }) {
  return {
    type: "OVER_UNDER_1K",
    reps,
    overM: 1000,
    underM: 1000,
    intensityOver: "THRESHOLD",
    intensityOverKey: "threshold",
    intensityUnder: goalKey === "HALF" ? "HMP" : "STEADY",
    intensityUnderKey: "steady",
    recoverSec: 60,
  };
}

// New: filler block to hit session distance budget (Runna-style)
function buildFillDistance({ meters, intensityKey = "easy", intensityLabel = "EASY" }) {
  const m = Math.max(0, Math.round(Number(meters || 0)));
  return attachIntensity({ type: "FILL_DISTANCE", meters: m }, { intensityKey, intensityLabel });
}

function getTopupCapMeters({ budgetM, phase }) {
  const p = String(phase || "").toLowerCase();
  const pct =
    p === "deload" || p === "taper" ? 0.08 :
    p === "specific" ? 0.12 :
    0.10;
  const hardCap = p === "deload" || p === "taper" ? 600 : 900;
  return Math.max(250, Math.min(hardCap, Math.round(Number(budgetM || 0) * pct)));
}

function topupIntensityForPhase(phase) {
  const p = String(phase || "").toLowerCase();
  if (p === "specific" || p === "build") {
    return { intensityKey: "steady", intensityLabel: "STEADY" };
  }
  return { intensityKey: "easy", intensityLabel: "EASY" };
}

// -----------------------------
// Optional Ultra TIME blocks
// -----------------------------

function buildRepeatTimeBlock({ reps, workSec, recSec, intensityKey, intensityLabel }) {
  return attachIntensity(
    {
      type: "REPEAT_TIME",
      reps,
      workSec,
      recoverSec: recSec,
    },
    { intensityKey, intensityLabel }
  );
}

function buildCruiseTimeBlock({ reps, workSec, recSec = 120 }) {
  return attachIntensity(
    {
      type: "CRUISE_TIME",
      reps,
      workSec,
      recoverSec: recSec,
    },
    { intensityKey: "threshold", intensityLabel: "THRESHOLD" }
  );
}

function buildHillRepeatTimeBlock({ reps, workSec, recSec = 120 }) {
  return attachIntensity(
    {
      type: "HILL_REPEAT_TIME",
      reps,
      workSec,
      recoverSec: recSec,
    },
    { intensityKey: "interval", intensityLabel: "INTERVAL" }
  );
}

// -----------------------------
// Candidate bank
// -----------------------------

function buildMenuCandidates({ goalKey, phase, wkKm, expKey, isDeload, targetWorkM, targetWorkSecUltra }) {
  const advanced = expKey === "advanced";
  const newer = expKey === "new";

  const candidates = [];
  const add = (variant, blocks, meta = {}) => {
    candidates.push({
      variant,
      blocks: Array.isArray(blocks) ? blocks : [],
      achievedWorkM: sumWorkMeters(blocks),
      meta,
    });
  };

  const pickReps = (lo, hi, ideal) => clamp(Math.round(ideal), lo, hi);

  // 5K menu
  if (goalKey === "5K") {
    {
      const repM = 400;
      const ideal = targetWorkM / repM;
      const reps = pickReps(newer ? 10 : 12, advanced ? 16 : 14, ideal);
      add("5K_12_16x400", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 500;
      const ideal = targetWorkM / repM;
      const reps = pickReps(8, 10, ideal);
      add("5K_8_10x500", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 600;
      const ideal = targetWorkM / repM;
      const reps = pickReps(6, 8, ideal);
      add("5K_6_8x600", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 800;
      const ideal = targetWorkM / repM;
      const reps = pickReps(5, 6, ideal);
      add("5K_5_6x800", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 1000;
      const ideal = targetWorkM / repM;
      const reps = pickReps(4, 6, ideal);
      add("5K_4_6x1K", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const sets = newer ? 2 : 3;
      add("5K_3x(1K+600+400)", [
        buildMixedSet({
          sets,
          parts: [
            { workM: 1000, recoverSec: 120, intensityKey: "interval", intensity: "10K" },
            { workM: 600, recoverSec: 90, intensityKey: "interval", intensity: "5K" },
            { workM: 400, recoverSec: 75, intensityKey: "interval", intensity: "5K" },
          ],
          goalKey,
        }),
      ]);
    }
    {
      const repM = 200;
      const ideal = targetWorkM / repM;
      const reps = pickReps(newer ? 12 : 16, advanced ? 24 : 20, ideal);
      add("5K_12_24x200", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 300;
      const ideal = targetWorkM / repM;
      const reps = pickReps(newer ? 8 : 10, advanced ? 14 : 12, ideal);
      add("5K_8_14x300", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
  }

  // 10K menu
  if (goalKey === "10K") {
    {
      const repM = 1000;
      const ideal = targetWorkM / repM;
      const reps = pickReps(5, 8, ideal);
      add("10K_5_8x1K", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 1200;
      const ideal = targetWorkM / repM;
      const reps = pickReps(4, 6, ideal);
      add("10K_4_6x1200", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 1600;
      const ideal = targetWorkM / repM;
      const reps = pickReps(3, 5, ideal);
      add("10K_3_5x1600", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const repM = 2000;
      const reps = newer ? 2 : 3;
      add("10K_3x2K", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
    }
    {
      const reps = clamp(Math.round(targetWorkM / 1000), 4, 6);
      add("10K_(1Kfast/1Ksteady)x4_6", [buildOnOffKm({ reps, onM: 1000, offM: 1000, goalKey })]);
    }
    {
      const ladder = [400, 800, 1200, 1600, 1200, 800, 400];
      const rec = phase === "taper" ? 105 : 90;
      add("10K_LADDER_400_1600", [buildPyramidExactLadder({ repsM: ladder, recoverSec: rec, goalKey })]);
    }
  }

  // Half Marathon menu
  if (goalKey === "HALF") {
    {
      const repM = 1200;
      const ideal = targetWorkM / repM;
      const reps = pickReps(5, 7, ideal);
      add("HM_5_7x1200", [
        buildRepeatsBlock({
          repM,
          reps,
          phase,
          goalKey,
          isDeload,
          intensityKey: "threshold",
          intensityLabel: "THRESHOLD",
        }),
      ]);
    }
    {
      const repM = 1600;
      const ideal = targetWorkM / repM;
      const reps = pickReps(3, 5, ideal);
      add("HM_3_5x1600", [
        buildRepeatsBlock({
          repM,
          reps,
          phase,
          goalKey,
          isDeload,
          intensityKey: "threshold",
          intensityLabel: "THRESHOLD",
        }),
      ]);
    }
    {
      const repM = 2000;
      const ideal = targetWorkM / repM;
      const reps = pickReps(4, 6, ideal);
      add("HM_4_6x2K", [
        buildRepeatsBlock({
          repM,
          reps,
          phase,
          goalKey,
          isDeload,
          intensityKey: "threshold",
          intensityLabel: "THRESHOLD",
        }),
      ]);
    }
    {
      const repM = 3000;
      const reps = newer ? 2 : 3;
      add("HM_3x3K", [
        buildRepeatsBlock({
          repM,
          reps,
          phase,
          goalKey,
          isDeload,
          intensityKey: "threshold",
          intensityLabel: "THRESHOLD",
        }),
      ]);
    }
    {
      const repM = 5000;
      const reps = newer ? 1 : 2;
      add("HM_2x5K", [
        buildRepeatsBlock({
          repM,
          reps,
          phase,
          goalKey,
          isDeload,
          intensityKey: "steady",
          intensityLabel: "HMP",
        }),
      ]);
    }
    {
      const reps = newer ? 4 : 5;
      add("HM_(1Kthr/1Khmp)x5", [buildOverUnder1k({ reps, goalKey })]);
    }
    {
      add("HM_6ksteady_4kthr_2kfast", [
        buildMixedSet({
          sets: 1,
          parts: [
            { workM: 6000, recoverSec: 0, intensityKey: "steady", intensity: "STEADY" },
            { workM: 4000, recoverSec: 0, intensityKey: "threshold", intensity: "THRESHOLD" },
            { workM: 2000, recoverSec: 0, intensityKey: "interval", intensity: "10K" },
          ],
          goalKey,
        }),
      ]);
    }
  }

  // Marathon menu
  if (goalKey === "MARATHON") {
    const mpKey = "steady";
    const mpLabel = "STEADY";

    {
      const repM = 2000;
      const ideal = targetWorkM / repM;
      const reps = pickReps(5, 8, ideal);
      add("M_5_8x2K_MP", [
        buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload, intensityKey: mpKey, intensityLabel: mpLabel }),
      ]);
    }

    {
      const repM = 5000;
      const reps = newer ? 2 : clamp(Math.round(targetWorkM / repM), 3, 4);
      add("M_3_4x5K_MP", [
        buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload, intensityKey: mpKey, intensityLabel: mpLabel }),
      ]);
    }

    {
      const repM = phase === "specific" && !newer ? 10000 : 8000;
      const reps = newer ? 1 : 2;
      add("M_2x8_10K_MP", [
        buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload, intensityKey: mpKey, intensityLabel: mpLabel }),
      ]);
    }

    {
      const sets = newer ? 2 : 3;
      add("M_(3KMP+1Kthr)x3", [
        buildMixedSet({
          sets,
          parts: [
            { workM: 3000, recoverSec: 60, intensityKey: mpKey, intensity: mpLabel },
            { workM: 1000, recoverSec: 120, intensityKey: "threshold", intensity: "THRESHOLD" },
          ],
          goalKey,
        }),
      ]);
    }

    {
      const parts = [
        { workM: 10000, recoverSec: 0, intensityKey: mpKey, intensity: mpLabel },
        ...Array.from({ length: 6 }, () => ({ workM: 1000, recoverSec: 30, intensityKey: mpKey, intensity: mpLabel })),
        { workM: 5000, recoverSec: 0, intensityKey: mpKey, intensity: mpLabel },
      ];
      add("M_10Ksteady_6x1KMP_5Ksteady", [buildMixedSet({ sets: 1, parts, goalKey })]);
    }
  }

  // Ultra menu
  if (goalKey === "ULTRA") {
    if (targetWorkSecUltra > 0) {
      const hillWork = clamp(phase === "specific" ? 5 * 60 : 4 * 60, 3 * 60, 5 * 60);
      const reps = clamp(Math.round((targetWorkSecUltra * 0.55) / hillWork), 6, 10);
      add("U_HILLS_3_5MIN", [buildHillRepeatTimeBlock({ reps, workSec: hillWork, recSec: 120 })], { timeBased: true });
    }

    if (targetWorkSecUltra > 0) {
      const workSec = 10 * 60;
      const reps = clamp(Math.round((targetWorkSecUltra * 0.7) / workSec), 4, 6);
      add("U_CRUISE_4_6x10MIN", [buildCruiseTimeBlock({ reps, workSec, recSec: 2 * 60 })], { timeBased: true });
    }

    if (targetWorkSecUltra > 0 && !newer) {
      add(
        "U_3x30STRONG_10EASY",
        [buildRepeatTimeBlock({ reps: 3, workSec: 30 * 60, recSec: 10 * 60, intensityKey: "steady", intensityLabel: "STEADY" })],
        { timeBased: true }
      );
    }

    add(
      "U_DISTANCE_PROXY_ONOFF",
      [buildOnOffKm({ reps: 6, onM: 1000, offM: 1000, goalKey: "ULTRA", onIntensityKey: "threshold", offIntensityKey: "easy" })],
      { proxy: true }
    );
  }

  // GENERAL fallback
  if (goalKey === "GENERAL") {
    const repM = wkKm >= 35 ? 800 : 400;
    const reps = clamp(Math.round(targetWorkM / repM), 5, repM === 800 ? 6 : 10);
    add("GEN_REPEATS", [buildRepeatsBlock({ repM, reps, phase, goalKey, isDeload })]);
  }

  return candidates;
}

// -----------------------------
// Scoring + pick (with rotation)
// -----------------------------

function scoreCandidate({ c, targetWorkM, phase, goalKey, expKey, wkKm, isDeload }) {
  const achieved = Number(c?.achievedWorkM || sumWorkMeters(c?.blocks || [])) || 0;
  const diff = Math.abs(achieved - targetWorkM);

  const newer = expKey === "new";
  const advanced = expKey === "advanced";

  const variant = String(c?.variant || "");

  const complexity =
    variant.includes("LADDER") ? 1.4 :
    variant.includes("MIXED") ? 1.6 :
    variant.includes("OVER_UNDER") ? 1.5 :
    variant.includes("CRUISE") ? 1.4 :
    variant.includes("HILLS") ? 1.6 :
    variant.includes("PROXY") ? 0.9 :
    1.0;

  let penalty = 0;
  if (newer) penalty += complexity * 450;
  if (isDeload) penalty += complexity * 700;
  if (phase === "taper") penalty += complexity * 650;

  if (goalKey === "MARATHON") {
    if (variant.includes("5K_")) penalty += 1200;
    if (variant.includes("LADDER")) penalty += 600;
  }
  if (goalKey === "HALF") {
    if (variant.includes("5K_12_24x200")) penalty += 500;
  }

  if (wkKm < 22 && (variant.includes("MIXED") || variant.includes("OVER_UNDER"))) penalty += 650;

  if (advanced) penalty *= 0.75;

  if (c?.meta?.timeBased) penalty += 2500;

  return diff + penalty;
}

function firstBlockType(c) {
  const b0 = Array.isArray(c?.blocks) && c.blocks.length ? c.blocks[0] : null;
  return String(b0?.type || "").toUpperCase();
}

function preferredTypesForWeek({ phase, weekIndex, goalKey }) {
  const p = String(phase || "").toLowerCase();
  const w = Math.max(1, Number(weekIndex || 1));
  const g = String(goalKey || "").toUpperCase();
  const k = (w - 1) % 3; // deterministic rotation

  if (p === "deload" || p === "taper") {
    return k === 0
      ? ["REPEAT_DISTANCE", "OVER_UNDER_1K"]
      : k === 1
        ? ["OVER_UNDER_1K", "REPEAT_DISTANCE"]
        : ["MIXED_SET", "REPEAT_DISTANCE"];
  }

  if (g === "MARATHON" || g === "HALF") {
    return k === 0
      ? ["REPEAT_DISTANCE", "MIXED_SET"]
      : k === 1
        ? ["OVER_UNDER_1K", "REPEAT_DISTANCE"]
        : ["MIXED_SET", "OVER_UNDER_1K"];
  }

  return k === 0
    ? ["REPEAT_DISTANCE", "ON_OFF_KM", "ON_OFF_DISTANCE"]
    : k === 1
      ? ["ON_OFF_KM", "OVER_UNDER_1K", "REPEAT_DISTANCE"]
      : ["MIXED_SET", "PYRAMID_DISTANCE", "REPEAT_DISTANCE"];
}

function diversityPenalty({ c, phase, weekIndex, goalKey }) {
  const t = firstBlockType(c);
  if (!t) return 0;
  const preferred = preferredTypesForWeek({ phase, weekIndex, goalKey });
  const idx = preferred.indexOf(t);
  if (idx === 0) return -140;
  if (idx === 1) return -70;
  return 90;
}

function rankCandidates({ candidates, targetWorkM, phase, goalKey, expKey, wkKm, isDeload, seed, weekIndex }) {
  const safe = Array.isArray(candidates) ? candidates : [];
  const scored = safe.map((c, idx) => {
    const s = scoreCandidate({ c, targetWorkM, phase, goalKey, expKey, wkKm, isDeload });
    const dv = diversityPenalty({ c, phase, weekIndex, goalKey });
    const tie = ((seed + idx) % 13) * 2;
    return { ...c, _score: s + dv + tie };
  });
  scored.sort((a, b) => a._score - b._score);
  return scored;
}

function pickBest({ candidates, targetWorkM, phase, goalKey, expKey, wkKm, isDeload, seed, weekIndex }) {
  const scored = rankCandidates({ candidates, targetWorkM, phase, goalKey, expKey, wkKm, isDeload, seed, weekIndex });
  const best = scored[0];
  if (!best) return null;

  const conservative = isDeload || phase === "taper";
  const Kmax = conservative ? 1 : 3;
  const margin = conservative ? 0 : 350;

  const pool = [best];
  for (let i = 1; i < scored.length && pool.length < Kmax; i++) {
    if (scored[i]._score <= best._score + margin) pool.push(scored[i]);
  }

  const pickIdx = pool.length ? (seed % pool.length) : 0;
  return pool[pickIdx] || best;
}

// -----------------------------
// Legacy derivation (for older UI)
// -----------------------------

function deriveLegacyFromBlocks(blocks = []) {
  const realBlocks = Array.isArray(blocks) ? blocks.filter((b) => !isFillerBlock(b)) : [];

  const rep = realBlocks.find((b) => b?.type === "REPEAT_DISTANCE");
  if (rep) {
    const reps = Number(rep.reps || 0) || 6;
    const repDistanceM = Number(rep.workM || 0) || 400;

    const r = rep.recover || {};
    const recovery =
      String(r.type || "TIME").toUpperCase() === "DISTANCE"
        ? { type: "JOG_DISTANCE", valueM: clamp(Number(r.m || r.valueM || 0) || 200, 100, 1200) }
        : { type: "JOG_TIME", valueSec: clamp(Number(r.sec || r.valueSec || 0) || 90, 30, 300) };

    return { reps, repDistanceM, recovery };
  }

  const pyr = realBlocks.find((b) => b?.type === "PYRAMID_DISTANCE");
  if (pyr) {
    const arr = Array.isArray(pyr.repsM) ? pyr.repsM : [];
    const reps = Math.max(3, arr.length || 6);
    const sorted = [...arr]
      .map(Number)
      .filter((x) => Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);
    const repDistanceM = Number(sorted[Math.floor(sorted.length / 2)] || 600);

    const recovery = {
      type: "JOG_TIME",
      valueSec: clamp(Number(pyr?.recover?.sec || 90), 30, 300),
    };
    return { reps, repDistanceM, recovery };
  }

  const ms = realBlocks.find((b) => b?.type === "MIXED_SET");
  if (ms) {
    const sets = clamp(Number(ms.sets || 0) || 2, 1, 6);
    const repsArr = Array.isArray(ms.reps) ? ms.reps : [];
    const first = repsArr[0] || {};
    const repDistanceM = clamp(Number(first.workM || 0) || 800, 200, 10000);
    const recSec = clamp(Number(first.recoverSec || 0) || 90, 0, 300);

    return {
      reps: sets,
      repDistanceM,
      recovery: { type: "JOG_TIME", valueSec: recSec },
    };
  }

  const oo = realBlocks.find((b) => b?.type === "ON_OFF_KM" || b?.type === "ON_OFF_DISTANCE");
  if (oo) {
    const reps = clamp(Number(oo.reps || 0) || 4, 2, 10);
    const repDistanceM = clamp(Number(oo.onM || 0) || 1000, 400, 2000);
    const offM = clamp(Number(oo.offM || 0) || 1000, 200, 3000);

    return {
      reps,
      repDistanceM,
      recovery: { type: "JOG_DISTANCE", valueM: offM },
    };
  }

  const ou = realBlocks.find((b) => b?.type === "OVER_UNDER_1K");
  if (ou) {
    const reps = clamp(Number(ou.reps || 0) || 4, 2, 10);
    const repDistanceM = 1000;
    const recSec = clamp(Number(ou.recoverSec || 0) || 60, 0, 240);

    return {
      reps,
      repDistanceM,
      recovery: { type: "JOG_TIME", valueSec: recSec },
    };
  }

  return {
    reps: 6,
    repDistanceM: 400,
    recovery: { type: "JOG_TIME", valueSec: 90 },
  };
}

// -----------------------------
// Formatting helpers
// -----------------------------

function fmtRec(sec) {
  const s = Math.max(0, Number(sec || 0));
  if (!s) return "";
  if (s < 90) return `${Math.round(s)}s`;
  const m = s / 60;
  const rounded = Math.round(m * 2) / 2;
  return `${rounded} min`;
}

function blocksKeyTargets(blocks = []) {
  if (!Array.isArray(blocks) || !blocks.length) return "Intervals";

  // ignore filler in label
  const real = blocks.filter((b) => !isFillerBlock(b));
  const b = real[0] || blocks[0];

  if (!b) return "Intervals";

  if (b.type === "REPEAT_DISTANCE") {
    const reps = Number(b.reps || 0) || 6;
    const workM = Number(b.workM || 0) || 400;
    const rec = fmtRec(Number(b?.recover?.sec || 0));
    const recTxt = rec ? ` (rec ${rec})` : "";
    return `${reps}×${workM}m${recTxt}`;
  }

  if (b.type === "PYRAMID_DISTANCE") {
    const arr = Array.isArray(b.repsM) ? b.repsM : [];
    const rec = fmtRec(Number(b?.recover?.sec || 0));
    const recTxt = rec ? ` (rec ${rec})` : "";
    return `Ladder ${arr.join("-")}m${recTxt}`;
  }

  if (b.type === "MIXED_SET") {
    const sets = Number(b.sets || 1);
    const repsArr = Array.isArray(b.reps) ? b.reps : [];
    const parts = repsArr.map((r) => `${Number(r?.workM || 0)}m`).filter(Boolean);
    return `${sets} set(s): ${parts.join(" + ")}`;
  }

  if (b.type === "ON_OFF_KM") {
    const reps = Number(b.reps || 0) || 4;
    const onM = Number(b.onM || 1000);
    const offM = Number(b.offM || 1000);
    return `${reps}×(${onM}m fast / ${offM}m steady)`;
  }

  if (b.type === "OVER_UNDER_1K") {
    const reps = Number(b.reps || 0) || 4;
    const rec = fmtRec(Number(b.recoverSec || 0));
    return `${reps}×(1k threshold / 1k steady)${rec ? ` (rec ${rec})` : ""}`;
  }

  if (b.type === "CRUISE_TIME") {
    const reps = Number(b.reps || 0) || 4;
    return `${reps}×${Math.round((Number(b.workSec || 0) || 600) / 60)} min cruise`;
  }

  if (b.type === "HILL_REPEAT_TIME") {
    const reps = Number(b.reps || 0) || 8;
    return `${reps}×${Math.round((Number(b.workSec || 0) || 240) / 60)} min hills`;
  }

  return "Intervals";
}

function fitBlocksToBudget(blocks = [], budgetM, profile) {
  const bM = Number(budgetM);
  if (!Array.isArray(blocks) || !blocks.length) return { blocks, fitSteps: [] };
  if (!Number.isFinite(bM) || bM <= 0) return { blocks, fitSteps: [] };

  const out = blocks.map((b) => (b && typeof b === "object" ? { ...b } : b));
  const fitSteps = [];

  const total = () => sumTotalMeters(out, profile);

  // If we are over budget and last block is filler, trim filler first
  const trimFillerIfNeeded = () => {
    const last = out[out.length - 1];
    if (!last || !isFillerBlock(last)) return false;

    const curTotal = total();
    if (curTotal <= bM) return false;

    const overshoot = curTotal - bM;
    const m0 = Math.max(0, Number(last.meters || 0));
    const m1 = Math.max(0, Math.round(m0 - overshoot));

    last.meters = m1;
    fitSteps.push(`fill→${m1}m`);

    // if filler becomes tiny, drop it
    if (m1 < 100) {
      out.pop();
      fitSteps.push("fill→dropped");
    }
    return true;
  };

  if (total() <= bM) return { blocks: out, fitSteps };

  // First try: trim filler
  if (trimFillerIfNeeded() && total() <= bM) return { blocks: out, fitSteps };

  const b0 = out[0];
  if (!b0 || typeof b0 !== "object") return { blocks: out, fitSteps };

  if (b0.type === "REPEAT_DISTANCE") {
    const minReps = 3;
    let reps = clamp(Number(b0.reps || 0) || 6, minReps, 50);
    while (reps > minReps && total() > bM) {
      reps -= 1;
      b0.reps = reps;
      fitSteps.push(`reps→${reps}`);
      if (trimFillerIfNeeded()) break;
    }

    const repOptions = [Number(b0.workM || 0) || 400, 1200, 1000, 800, 600, 500, 400, 300, 200]
      .filter((x, i, arr) => Number.isFinite(x) && x > 0 && arr.indexOf(x) === i);
    repOptions.sort((a, b) => b - a);

    for (let i = 0; i < repOptions.length && total() > bM; i++) {
      const cur = Number(b0.workM || 0) || 400;
      const next = repOptions.find((x) => x < cur);
      if (!next) break;
      b0.workM = next;
      fitSteps.push(`repM→${next}`);
      if (trimFillerIfNeeded()) break;
    }

    // final trim filler again if needed
    trimFillerIfNeeded();
    return { blocks: out, fitSteps };
  }

  if (b0.type === "ON_OFF_KM" || b0.type === "ON_OFF_DISTANCE") {
    const minReps = 2;
    let reps = clamp(Number(b0.reps || 0) || 4, minReps, 20);
    while (reps > minReps && total() > bM) {
      reps -= 1;
      b0.reps = reps;
      fitSteps.push(`reps→${reps}`);
      if (trimFillerIfNeeded()) break;
    }
    trimFillerIfNeeded();
    return { blocks: out, fitSteps };
  }

  if (b0.type === "OVER_UNDER_1K") {
    const minReps = 2;
    let reps = clamp(Number(b0.reps || 0) || 4, minReps, 12);
    while (reps > minReps && total() > bM) {
      reps -= 1;
      b0.reps = reps;
      fitSteps.push(`reps→${reps}`);
      if (trimFillerIfNeeded()) break;
    }
    trimFillerIfNeeded();
    return { blocks: out, fitSteps };
  }

  if (b0.type === "MIXED_SET") {
    const minSets = 1;
    let sets = clamp(Number(b0.sets || 0) || 2, minSets, 10);
    while (sets > minSets && total() > bM) {
      sets -= 1;
      b0.sets = sets;
      fitSteps.push(`sets→${sets}`);
      if (trimFillerIfNeeded()) break;
    }
    trimFillerIfNeeded();
    return { blocks: out, fitSteps };
  }

  if (b0.type === "PYRAMID_DISTANCE") {
    const minLen = 3;
    let arr = Array.isArray(b0.repsM)
      ? [...b0.repsM].map(Number).filter((x) => Number.isFinite(x) && x > 0)
      : [];
    if (arr.length < minLen) return { blocks: out, fitSteps };

    while (arr.length > minLen && total() > bM) {
      arr = arr.slice(1, -1);
      b0.repsM = arr;
      fitSteps.push(`ladder→len${arr.length}`);
      if (trimFillerIfNeeded()) break;
    }
    trimFillerIfNeeded();
    return { blocks: out, fitSteps };
  }

  trimFillerIfNeeded();
  return { blocks: out, fitSteps };
}

function chooseCandidateThatFits({ ranked, budgetM, profile, targetWorkM, phase, isDeload, seed = 0 }) {
  const list = Array.isArray(ranked) ? ranked : [];
  if (!list.length) return null;

  const maxTry = isDeload || phase === "taper" ? 2 : 6;
  const tryCount = Math.min(maxTry, list.length);

  const minWorkFloorM = Math.max(
    1200,
    Math.round((Number(targetWorkM || 0) || 0) * (isDeload ? 0.55 : 0.65))
  );
  const minWorkKeepRatio = isDeload || phase === "taper" ? 0.45 : 0.60;

  // Deterministic rotation across nearby top candidates to reduce repeated weekly templates.
  const rotateWindow = Math.min(4, tryCount);
  const start = rotateWindow > 0 ? Math.abs(Number(seed || 0)) % rotateWindow : 0;

  const order = [];
  for (let i = 0; i < tryCount; i++) {
    if (i < rotateWindow) {
      order.push((start + i) % rotateWindow);
    } else {
      order.push(i);
    }
  }

  let best = null;
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const c = list[i];
    const origTotal = sumTotalMeters(c.blocks, profile);
    const origWork = sumWorkMeters(c.blocks);

    const fitted = fitBlocksToBudget(c.blocks, budgetM, profile);
    const fittedBlocks = fitted.blocks;
    const fittedTotal = sumTotalMeters(fittedBlocks, profile);
    const fittedWork = sumWorkMeters(fittedBlocks);

    if (fittedTotal > budgetM) continue;

    if (fittedWork < minWorkFloorM && i + 1 < Math.min(maxTry, list.length)) {
      continue;
    }

    const keepRatio = origWork > 0 ? fittedWork / origWork : 1;
    const fitStepText = Array.isArray(fitted.fitSteps) ? fitted.fitSteps.join("|") : "";
    const surgeryPenalty =
      (fitStepText.includes("repM→") ? 240 : 0) +
      (fitStepText.includes("reps→") ? 120 : 0) +
      (fitStepText.includes("sets→") ? 120 : 0) +
      (fitStepText.includes("ladder→") ? 180 : 0);
    const underfillM = Math.max(0, budgetM - fittedTotal);
    const score = underfillM + surgeryPenalty + (1 - Math.min(1, keepRatio)) * 500;

    const candidate = {
      chosen: c,
      blocks: fittedBlocks,
      fitSteps: [
        `try#${oi + 1}/${tryCount}:${c.variant}`,
        `rankIdx=${i}`,
        `budgetM=${budgetM}`,
        `totalM:${origTotal}→${fittedTotal}`,
        `workM:${sumWorkMeters(c.blocks)}→${fittedWork}`,
        ...(fitted.fitSteps || []),
      ],
      chosenFromPoolIndex: i,
      score,
      keepRatio,
    };

    if (!best || candidate.score < best.score) best = candidate;
    if (keepRatio < minWorkKeepRatio && oi + 1 < order.length) {
      continue;
    }
    // Early exit for "good enough" fit.
    if (underfillM <= 200 && keepRatio >= minWorkKeepRatio) break;
  }

  if (best) return best;

  const c0 = list[0];
  const fitted = fitBlocksToBudget(c0.blocks, budgetM, profile);
  return {
    chosen: c0,
    blocks: fitted.blocks,
    fitSteps: ["fallback_best", `budgetM=${budgetM}`, ...(fitted.fitSteps || [])],
    chosenFromPoolIndex: 0,
  };
}

function intervalSpecFidelityFloorRatio(phase, isDeload) {
  const policy = intervalFidelityPolicy();
  const p = String(phase || "").toLowerCase();
  if (p === "taper") return policy.floorTaper;
  if (isDeload || p === "deload") return policy.floorDeload;
  // Non-taper intervals should preserve requested workout identity more strongly.
  return policy.floorNonTaper;
}

function reduceIntervalWorkToCap(blocks = [], maxWorkM = 0) {
  const out = structuredClone(Array.isArray(blocks) ? blocks : []);
  const cap = Number(maxWorkM) || 0;
  if (!(cap > 0) || !out.length) return out;

  let guard = 0;
  while (sumWorkMeters(out) > cap && guard < 240) {
    guard += 1;
    let changed = false;

    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      if (!b || typeof b !== "object") continue;
      const t = String(b.type || "").toUpperCase();
      const minReps = t === "OVER_UNDER_1K" ? 2 : 1;

      if (Number.isFinite(Number(b.reps)) && Number(b.reps) > minReps) {
        b.reps = Number(b.reps) - 1;
        changed = true;
        break;
      }
      if (Number.isFinite(Number(b.repeatCount)) && Number(b.repeatCount) > minReps) {
        b.repeatCount = Number(b.repeatCount) - 1;
        changed = true;
        break;
      }
      if (Number.isFinite(Number(b.sets)) && Number(b.sets) > 1) {
        b.sets = Number(b.sets) - 1;
        changed = true;
        break;
      }
      if (t === "PYRAMID_DISTANCE" && Array.isArray(b.repsM) && b.repsM.length > 3) {
        b.repsM = b.repsM.slice(1, -1);
        changed = true;
        break;
      }
    }

    if (!changed) break;
  }

  return out;
}

// -----------------------------
// Public API
// -----------------------------

export function buildIntervalsWorkout({
  weekIndex,
  profile,
  isDeload = false,
  totalWeeks,
  totalKm,
  weekWeeklyKm,
  phaseOverride,
  goalKeyOverride,
} = {}) {
  const wkKm =
    Number.isFinite(Number(weekWeeklyKm)) && Number(weekWeeklyKm) > 0
      ? Number(weekWeeklyKm)
      : getWeeklyKm(profile);

  const tw = totalWeeks || getTotalWeeks(profile, 12);

  const phaseRaw = phaseOverride ? String(phaseOverride).toLowerCase() : getPhase(weekIndex, tw);
  const phase = ["base", "build", "specific", "taper", "deload"].includes(phaseRaw) ? phaseRaw : getPhase(weekIndex, tw);

  const expKey = normExperience(profile);
  const goalKey = goalKeyOverride || normaliseGoalDistance(profile);

  const targetWorkM = computeTargetWorkMeters({ wkKm, phase, goalKey, expKey, isDeload });

  const targetWorkSecUltra =
    goalKey === "ULTRA"
      ? computeTargetWorkSecondsUltra({ wkKm, phase, expKey, isDeload })
      : 0;

  const candidates = buildMenuCandidates({
    goalKey,
    phase,
    wkKm,
    expKey,
    isDeload,
    targetWorkM,
    targetWorkSecUltra,
  });

  const userSeedBase = profile?.userId || profile?.athleteId || profile?.uid || "";
  const seedBase =
    (hashString(userSeedBase) + goalOffset(goalKey) + Math.max(0, Number(weekIndex || 1) - 1)) >>> 0;

  const ranked = rankCandidates({
    candidates,
    targetWorkM,
    phase,
    goalKey,
    expKey,
    wkKm,
    isDeload,
    seed: seedBase,
    weekIndex,
  });

  const baseWarm = goalKey === "MARATHON" || goalKey === "ULTRA" ? 16 : 14;
  const baseCool = goalKey === "MARATHON" || goalKey === "ULTRA" ? 12 : 10;

  const volBump = wkKm >= 70 ? 3 : wkKm >= 55 ? 2 : wkKm >= 40 ? 1 : 0;
  const phaseBump = phase === "specific" ? 1 : 0;
  const deloadCut = isDeload ? -2 : 0;

  const warmupMin = clamp(baseWarm + volBump + phaseBump + deloadCut, 10, 24);
  const cooldownMin = clamp(baseCool + volBump + deloadCut, 8, 20);

  const warmupSec = warmupMin * 60;
  const cooldownSec = cooldownMin * 60;

  const totalM =
    Number.isFinite(Number(totalKm)) && Number(totalKm) > 0 ? Math.round(Number(totalKm) * 1000) : null;

  let picked = pickBest({
    candidates,
    targetWorkM,
    phase,
    goalKey,
    expKey,
    wkKm,
    isDeload,
    seed: seedBase,
    weekIndex,
  });

  if (!picked) {
    picked = {
      variant: "REPEATS",
      blocks: [buildRepeatsBlock({ repM: 400, reps: 6, phase, goalKey, isDeload })],
    };
  }

  let blocks = Array.isArray(picked.blocks) ? picked.blocks : [];
  let fitSteps = [];
  let chosenFromPoolIndex = 0;

  // Fit to distance budget (Runna-level = full budget, no subtracting buffer)
  if (totalM != null) {
    const budgetM = Math.max(800, totalM);

    const chosen = chooseCandidateThatFits({
      ranked,
      budgetM,
      profile,
      targetWorkM,
      phase,
      isDeload,
      seed: seedBase,
    });

    if (chosen?.chosen) {
      picked = chosen.chosen;
      blocks = chosen.blocks;
      fitSteps = chosen.fitSteps || [];
      chosenFromPoolIndex = Number(chosen.chosenFromPoolIndex || 0);
    }

    // Top up if we’re under budget by meaningful amount
    const filledTolM = 120; // tolerance for rounding/drift
    const curTotal = sumTotalMeters(blocks, profile);
    const remaining = Math.max(0, budgetM - curTotal);

    if (remaining > filledTolM) {
      const capped = Math.min(remaining, getTopupCapMeters({ budgetM, phase }));
      if (capped > filledTolM) {
        const topupIntensity = topupIntensityForPhase(phase);
        blocks = [
          ...blocks,
          buildFillDistance({
            meters: capped,
            intensityKey: topupIntensity.intensityKey,
            intensityLabel: topupIntensity.intensityLabel,
          }),
        ];
        fitSteps.push(`topup→${Math.round(capped)}m`);
        if (capped < remaining) fitSteps.push(`topup_capped:${Math.round(remaining)}→${Math.round(capped)}m`);
      } else {
        fitSteps.push(`topup→none(remaining=${Math.round(remaining)}m,capped)`);
      }
    } else {
      fitSteps.push(`topup→none(remaining=${Math.round(remaining)}m)`);
    }

    // Safety: if top-up pushed us over (shouldn’t), trim filler
    const afterTotal = sumTotalMeters(blocks, profile);
    if (afterTotal > budgetM + 20) {
      const fittedAgain = fitBlocksToBudget(blocks, budgetM, profile);
      blocks = fittedAgain.blocks;
      fitSteps.push(...(fittedAgain.fitSteps || []));
    }
  }

  const achievedWorkM = sumWorkMeters(blocks);
  const isLowerStressPhase = isDeload || phase === "taper";
  const phaseWorkCapM = isLowerStressPhase ? Math.round((Number(targetWorkM) || 0) * (phase === "taper" ? 1.05 : 1.1)) : 0;
  if (phaseWorkCapM > 0 && achievedWorkM > phaseWorkCapM) {
    blocks = reduceIntervalWorkToCap(blocks, phaseWorkCapM);
  }
  const cappedAchievedWorkM = sumWorkMeters(blocks);
  const { reps, repDistanceM, recovery } = deriveLegacyFromBlocks(blocks);
  const planningTargetWorkM = Math.max(0, Math.round(Number(targetWorkM) || 0));
  const resolvedTargetWorkM = Math.max(
    0,
    Math.round(Number(cappedAchievedWorkM) || planningTargetWorkM)
  );

  // ✅ harden variant so it can never be null/empty downstream
  const resolvedVariant =
    normaliseVariant(picked?.variant) ||
    inferVariantFromBlocks(blocks, goalKey) ||
    "REPEATS";

  const blueprint = {
    kind: "INTERVALS",
    variant: resolvedVariant,
    blocks,
    warmupSec,
    cooldownSec,

    reps,
    repDistanceM,
    recovery,

    meta: {
      phase,
      goalKey,
      targetWorkM: resolvedTargetWorkM,
      planningTargetWorkM,
      achievedWorkM: cappedAchievedWorkM,
      isDeload: !!isDeload,
      seed: seedBase,
      candidates: candidates.length,
      timeBased: !!picked?.meta?.timeBased,
      proxy: !!picked?.meta?.proxy,
      usedWeekWeeklyKm: wkKm,

      chosenFromPoolIndex,
      fitSteps,
      budgetMUsed: totalM != null ? totalM : null,
    },
  };

  const keyTargets = intervalsKeyTargets(blueprint);
  const title = `Intervals: ${keyTargets}`;
  const notes = `Warm up ${Math.round(warmupSec / 60)} min easy. Main set: ${keyTargets}. Cool down ${Math.round(
    cooldownSec / 60
  )} min easy.`;

  return { ...blueprint, title, keyTargets, notes };
}

export function intervalsKeyTargets(blueprint) {
  if (!blueprint) return "Intervals";
  const blocks = Array.isArray(blueprint.blocks) ? blueprint.blocks : [];
  if (blocks.length) return blocksKeyTargets(blocks);

  const repM = blueprint.repDistanceM || 400;
  const reps = blueprint.reps || 6;

  if (blueprint.recovery?.type === "JOG_TIME") {
    const rec = fmtRec(Number(blueprint.recovery.valueSec || 0));
    return `${reps}×${repM}m (rec ${rec || "90s"} jog)`;
  }
  return `${reps}×${repM}m (rec ${blueprint.recovery?.valueM || 200}m jog)`;
}

// -------------------- Spec pool ID support --------------------

function parseIntervalsId(id) {
  const s = String(id || "").toLowerCase().trim();

  const mHills = s.match(/hills?_?(\d+)\s*x\s*(\d+)\s*s/);
  if (mHills) {
    return { kind: "HILL_TIME", reps: Number(mHills[1]), workSec: Number(mHills[2]) };
  }

  const mRepeat = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(k|km|m)?/);
  if (mRepeat) {
    const reps = Number(mRepeat[1]);
    const dist = Number(mRepeat[2]);
    const unit = String(mRepeat[3] || "").toLowerCase();

    let repM = 0;
    if (unit === "k" || unit === "km") repM = Math.round(dist * 1000);
    else repM = Math.round(dist);

    if (repM > 0) return { kind: "REPEAT_DISTANCE", reps, repM };
  }

  const mNx400 = s.match(/(\d+)\s*x\s*400/);
  if (mNx400) return { kind: "REPEAT_DISTANCE", reps: Number(mNx400[1]), repM: 400 };

  return null;
}

export function buildIntervalsWorkoutById({
  id,
  weekIndex,
  profile,
  isDeload = false,
  totalWeeks,
  totalKm,
  weekWeeklyKm,
  phaseOverride,
  goalKeyOverride,
} = {}) {
  const tw = totalWeeks || getTotalWeeks(profile, 12);

  const phaseRaw = phaseOverride ? String(phaseOverride).toLowerCase() : getPhase(weekIndex, tw);
  const phase = ["base", "build", "specific", "taper", "deload"].includes(phaseRaw) ? phaseRaw : getPhase(weekIndex, tw);

  const wkKm =
    Number.isFinite(Number(weekWeeklyKm)) && Number(weekWeeklyKm) > 0
      ? Number(weekWeeklyKm)
      : getWeeklyKm(profile);

  const expKey = normExperience(profile);
  const goalKey = goalKeyOverride || normaliseGoalDistance(profile);

  const parsed = parseIntervalsId(id);
  if (!parsed) return null;

  let blocks = null;

  if (parsed.kind === "REPEAT_DISTANCE") {
    blocks = [
      buildRepeatsBlock({
        repM: parsed.repM,
        reps: clamp(parsed.reps, 2, 30),
        phase,
        goalKey,
        isDeload,
      }),
    ];
  }

  if (parsed.kind === "HILL_TIME") {
    blocks = [
      buildHillRepeatTimeBlock({
        reps: clamp(parsed.reps, 4, 20),
        workSec: clamp(parsed.workSec, 20, 180),
        recSec: 120,
      }),
    ];
  }

  if (!blocks) return null;
  const requestedBlocks = structuredClone(blocks);
  const requestedWorkM = sumWorkMeters(requestedBlocks);

  const base = buildIntervalsWorkout({
    weekIndex,
    profile,
    isDeload,
    totalWeeks: tw,
    totalKm,
    weekWeeklyKm: wkKm,
    phaseOverride: phase,
    goalKeyOverride: goalKey,
  });

  const totalM =
    Number.isFinite(Number(totalKm)) && Number(totalKm) > 0 ? Math.round(Number(totalKm) * 1000) : null;
  if (totalM != null) {
    const budgetM = Math.max(800, totalM);
    const fitted = fitBlocksToBudget(blocks, budgetM, profile);
    blocks = fitted.blocks;

    // top up
    const curTotal = sumTotalMeters(blocks, profile);
    const remaining = Math.max(0, budgetM - curTotal);
    if (remaining > 120) {
      const capped = Math.min(remaining, getTopupCapMeters({ budgetM, phase }));
      if (capped > 120) {
        const topupIntensity = topupIntensityForPhase(phase);
        blocks = [
          ...blocks,
          buildFillDistance({
            meters: capped,
            intensityKey: topupIntensity.intensityKey,
            intensityLabel: topupIntensity.intensityLabel,
          }),
        ];
      }
    }
  }

  // Enforce hard fidelity floor for requested specs (except taper).
  const workBeforeFloorM = sumWorkMeters(blocks);
  const preFloorKeepRatio =
    requestedWorkM > 0 ? workBeforeFloorM / requestedWorkM : 1;
  const floorRatio = intervalSpecFidelityFloorRatio(phase, isDeload);
  const fidelityPolicy = floorRatio > 0 ? "hard_floor" : "taper_relaxed";
  const fidelityFloorBypassedReason = floorRatio > 0 ? null : "taper_phase_policy";
  let fidelityFloorApplied = false; // true only when we actually clamp to requested blocks
  if (floorRatio > 0 && preFloorKeepRatio < floorRatio) {
    blocks = requestedBlocks;
    fidelityFloorApplied = true;
  }
  const workAfterFloorM = sumWorkMeters(blocks);

  const { reps, repDistanceM, recovery } = deriveLegacyFromBlocks(blocks);
  const isLowerStressPhase = isDeload || phase === "taper";
  const fidelityPolicyCfg = intervalFidelityPolicy();
  const basePhaseWorkCapM = isLowerStressPhase
    ? Math.round(
        (Number(base?.meta?.targetWorkM) || 0) *
          (phase === "taper" ? fidelityPolicyCfg.taperCapMult : fidelityPolicyCfg.deloadCapMult)
      )
    : 0;
  // Taper should be lighter, but not so clipped that requested interval identity collapses.
  const taperMinKeepRatio = phase === "taper" ? Math.max(0, fidelityPolicyCfg.taperMinKeepRatio) : null;
  const taperMinWorkByKeep =
    taperMinKeepRatio != null && requestedWorkM > 0
      ? Math.round(requestedWorkM * taperMinKeepRatio)
      : 0;
  const phaseWorkCapM = Math.max(basePhaseWorkCapM, taperMinWorkByKeep);
  const blocksBeforePhaseCap = structuredClone(blocks);
  if (phaseWorkCapM > 0 && workAfterFloorM > phaseWorkCapM) {
    blocks = reduceIntervalWorkToCap(blocks, phaseWorkCapM);
  }
  let achievedWorkM = sumWorkMeters(blocks);
  let fidelityPhaseCapApplied = phaseWorkCapM > 0 && achievedWorkM < workAfterFloorM;
  let fidelityPhaseCapBypassedReason = null;
  let fidelityTaperMinKeepApplied = false;
  if (phase === "taper" && taperMinWorkByKeep > 0 && achievedWorkM < taperMinWorkByKeep) {
    const preCapWorkM = sumWorkMeters(blocksBeforePhaseCap);
    if (preCapWorkM >= taperMinWorkByKeep) {
      blocks = blocksBeforePhaseCap;
    } else {
      // Last fallback to keep policy-consistent even with coarse rep granularity.
      blocks = requestedBlocks;
    }
    achievedWorkM = sumWorkMeters(blocks);
    fidelityPhaseCapApplied = phaseWorkCapM > 0 && achievedWorkM < workAfterFloorM;
    fidelityPhaseCapBypassedReason = "taper_min_keep_guard";
    fidelityTaperMinKeepApplied = true;
  }
  const planningTargetWorkM = Math.max(0, Math.round(Number(base?.meta?.planningTargetWorkM ?? base?.meta?.targetWorkM) || 0));
  const requestedTargetWorkM = Math.max(0, Math.round(Number(requestedWorkM) || planningTargetWorkM || 0));
  // Public target reflects final executable work after fidelity/taper policy.
  // Keep planningTargetWorkM + requestedWorkM for upstream planning intent.
  const targetWorkMResolved = Math.max(0, Math.round(Number(achievedWorkM) || requestedTargetWorkM || 0));

  const resolvedVariant =
    inferVariantFromBlocks(blocks, goalKey) ||
    normaliseVariant(id) ||
    normaliseVariant(base?.variant) ||
    "REPEATS";

  const blueprint = {
    ...base,
    id,
    kind: "INTERVALS",
    variant: resolvedVariant,
    blocks,
    reps,
    repDistanceM,
    recovery,
    meta: {
      ...(base.meta || {}),
      planningTargetWorkM,
      targetWorkM: targetWorkMResolved,
      requestedWorkM: requestedTargetWorkM > 0 ? requestedTargetWorkM : null,
      source: "spec_id",
      requestedSpecId: id,
      templatePickId: id,
      pickedId: resolvedVariant,
      specPickId: resolvedVariant,
      achievedWorkM,
      fidelityPolicy,
      fidelityFloorRatio: floorRatio > 0 ? floorRatio : null,
      fidelityFloorBypassedReason,
      fidelityKeepRatioPreFloor: requestedWorkM > 0 ? Number(preFloorKeepRatio.toFixed(3)) : 1,
      fidelityKeepRatioPostFloor: requestedWorkM > 0 ? Number((workAfterFloorM / requestedWorkM).toFixed(3)) : 1,
      selectedKeepAfterFloorPolicy: requestedWorkM > 0 ? Number((workAfterFloorM / requestedWorkM).toFixed(3)) : 1,
      fidelityKeepRatio: requestedWorkM > 0 ? Number((achievedWorkM / requestedWorkM).toFixed(3)) : 1,
      finalKeepAfterPhaseCaps: requestedWorkM > 0 ? Number((achievedWorkM / requestedWorkM).toFixed(3)) : 1,
      fidelityFloorApplied,
      fidelityTaperMinKeepRatio: taperMinKeepRatio,
      fidelityTaperMinKeepApplied,
      fidelityTaperMinKeepWorkM: taperMinWorkByKeep > 0 ? taperMinWorkByKeep : null,
      fidelityConfigRef: "RULES.fidelity.intervals",
      fidelityPhaseWorkCapBaseM: basePhaseWorkCapM > 0 ? basePhaseWorkCapM : null,
      fidelityPhaseWorkCapM: phaseWorkCapM > 0 ? phaseWorkCapM : null,
      fidelityPhaseCapApplied,
      fidelityPhaseCapBypassedReason,
    },
  };

  const keyTargets = intervalsKeyTargets(blueprint);
  const title = `Intervals: ${keyTargets}`;
  const notes = `Warm up ${Math.round((blueprint.warmupSec || 0) / 60)} min easy. Main set: ${keyTargets}. Cool down ${Math.round(
    (blueprint.cooldownSec || 0) / 60
  )} min easy.`;

  return { ...blueprint, title, keyTargets, notes };
}

export function getIntervalsWorkout(args = {}) {
  const byId = args?.id ? buildIntervalsWorkoutById(args) : null;
  return byId || buildIntervalsWorkout(args);
}
