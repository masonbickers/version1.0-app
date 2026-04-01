import { clamp, round1 } from "./utils.js";

function weekPhase(weekNumber, totalWeeks, phaseModel) {
  const taperStart = Math.max(1, totalWeeks - phaseModel.taperWeeks + 1);
  if (weekNumber >= taperStart) return "taper";
  if (weekNumber <= phaseModel.baseWeeks) return "base";
  if (phaseModel.deloadEvery > 0 && weekNumber % phaseModel.deloadEvery === 0) return "deload";
  return "build";
}

function nextWeeklyKm(previousKm, phase, progression) {
  let next = previousKm;
  if (phase === "deload") next *= 1 - progression.deloadDropPct;
  else if (phase === "taper") next *= 1 - progression.taperDropPct;
  else next *= 1 + Math.min(progression.weeklyIncreasePct, progression.maxWeeklyIncreasePct);

  return round1(clamp(next, progression.minWeeklyKm, progression.maxWeeklyKm));
}

function stretchNumericSeries(values, targetLen, fallback = 1) {
  const src = Array.isArray(values) ? values : [];
  if (!targetLen || targetLen < 1) return [];
  if (!src.length) return Array.from({ length: targetLen }, () => fallback);
  if (src.length === targetLen) return src.slice();
  if (src.length === 1) return Array.from({ length: targetLen }, () => src[0]);

  const out = [];
  for (let i = 0; i < targetLen; i += 1) {
    const pos = targetLen === 1 ? 0 : (i * (src.length - 1)) / (targetLen - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(src.length - 1, Math.ceil(pos));
    if (lo === hi) {
      out.push(src[lo]);
      continue;
    }
    const ratio = pos - lo;
    out.push(src[lo] + (src[hi] - src[lo]) * ratio);
  }
  return out;
}

function stretchPhaseSeries(values, targetLen) {
  const src = Array.isArray(values) ? values : [];
  if (!targetLen || targetLen < 1) return [];
  if (!src.length) return Array.from({ length: targetLen }, () => "build");
  if (src.length === targetLen) return src.slice();
  if (src.length === 1) return Array.from({ length: targetLen }, () => src[0]);

  const out = [];
  for (let i = 0; i < targetLen; i += 1) {
    const pos = targetLen === 1 ? 0 : (i * (src.length - 1)) / (targetLen - 1);
    out.push(src[Math.round(pos)] || "build");
  }
  return out;
}

function buildStockWeeklyTargets(profile, config, stockTemplate) {
  const totalWeeks = profile.goal.planLengthWeeks;
  const out = [];

  const progression = config.progression;
  const baseWeeklyKm = round1(
    clamp(profile.current.weeklyKm, progression.minWeeklyKm, progression.maxWeeklyKm)
  );

  const multipliers = stretchNumericSeries(stockTemplate.weeklyMultipliers, totalWeeks, 1);
  const phaseSeries = stretchPhaseSeries(stockTemplate.phasePattern, totalWeeks);
  if (phaseSeries.length) phaseSeries[phaseSeries.length - 1] = "taper";

  let prevWeeklyKm = baseWeeklyKm;
  let prevLongKm = round1(profile.current.longestRunKm);

  for (let week = 1; week <= totalWeeks; week += 1) {
    const phase = phaseSeries[week - 1] || weekPhase(week, totalWeeks, config.phaseModel);
    let weeklyKm = week === 1 ? baseWeeklyKm : round1(baseWeeklyKm * (multipliers[week - 1] || 1));
    weeklyKm = round1(clamp(weeklyKm, progression.minWeeklyKm, progression.maxWeeklyKm));

    if (week > 1) {
      const maxUpKm = round1(prevWeeklyKm * (1 + progression.maxWeeklyIncreasePct));
      if (weeklyKm > maxUpKm) weeklyKm = maxUpKm;

      const maxDropPct =
        phase === "deload"
          ? Math.max(progression.deloadDropPct, 0.18)
          : phase === "taper"
            ? Math.max(progression.taperDropPct, 0.25)
            : 0.14;
      const minDownKm = round1(prevWeeklyKm * (1 - maxDropPct));
      if (weeklyKm < minDownKm) weeklyKm = minDownKm;

      weeklyKm = round1(clamp(weeklyKm, progression.minWeeklyKm, progression.maxWeeklyKm));
    }

    const longPct = config.distribution.longRunPctByPhase[phase] ?? 0.3;
    const desiredLong = weeklyKm * longPct;
    const maxUp = phase === "build" || phase === "base" ? progression.maxLongRunIncreaseKm : 0.9;
    const maxDown = phase === "deload" || phase === "taper" ? 3 : 1.2;
    const step = clamp(desiredLong - prevLongKm, -maxDown, maxUp);

    const longKm = round1(
      clamp(
        prevLongKm + step,
        progression.longRunMinKm,
        Math.min(progression.longRunMaxKm, weeklyKm * 0.5)
      )
    );

    out.push({
      weekNumber: week,
      phase,
      weeklyKm,
      longKm,
      qualityPct: config.distribution.qualityPctByPhase[phase] ?? 0.25,
      longPct,
    });

    prevWeeklyKm = weeklyKm;
    prevLongKm = longKm;
  }

  return out;
}

export function buildWeeklyTargets(profile, config) {
  const stockTemplate = config?.stockTemplate;
  if (stockTemplate?.mode === "stock_adapted") {
    return buildStockWeeklyTargets(profile, config, stockTemplate);
  }

  const totalWeeks = profile.goal.planLengthWeeks;
  const out = [];

  let prevWeeklyKm = round1(clamp(profile.current.weeklyKm, config.progression.minWeeklyKm, config.progression.maxWeeklyKm));
  let prevLongKm = round1(profile.current.longestRunKm);

  for (let week = 1; week <= totalWeeks; week += 1) {
    const phase = weekPhase(week, totalWeeks, config.phaseModel);
    const weeklyKm = week === 1 ? prevWeeklyKm : nextWeeklyKm(prevWeeklyKm, phase, config.progression);

    const longPct = config.distribution.longRunPctByPhase[phase] ?? 0.3;
    const desiredLong = weeklyKm * longPct;
    const maxUp = phase === "build" || phase === "base" ? config.progression.maxLongRunIncreaseKm : 0.9;
    const maxDown = phase === "deload" || phase === "taper" ? 3 : 1.2;
    const step = clamp(desiredLong - prevLongKm, -maxDown, maxUp);

    const longKm = round1(
      clamp(
        prevLongKm + step,
        config.progression.longRunMinKm,
        Math.min(config.progression.longRunMaxKm, weeklyKm * 0.46)
      )
    );

    out.push({
      weekNumber: week,
      phase,
      weeklyKm,
      longKm,
      qualityPct: config.distribution.qualityPctByPhase[phase] ?? 0.25,
      longPct,
    });

    prevWeeklyKm = weeklyKm;
    prevLongKm = longKm;
  }

  return out;
}
