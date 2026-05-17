// server/lib/train/planRules/pacePhysiology.js

const DISTANCES = {
  fiveK: { label: "5K", km: 5 },
  tenK: { label: "10K", km: 10 },
  halfMarathon: { label: "Half marathon", km: 21.0975 },
  marathon: { label: "Marathon", km: 42.195 },
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(n) {
  return Math.round(Number(n) || 0);
}

function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function parseTimeToSeconds(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const parts = s.split(":").map((x) => Number(String(x).trim()));
  if (parts.length === 2) {
    const [mm, ss] = parts;
    if (![mm, ss].every(Number.isFinite) || mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    if (![hh, mm, ss].every(Number.isFinite) || hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

function distanceToKm(label) {
  const s = String(label || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "5k" || s.includes("5k")) return 5;
  if (s === "10k" || s.includes("10k")) return 10;
  if (s.includes("half")) return 21.0975;
  if (s.includes("marathon") && !s.includes("half")) return 42.195;
  if (s.includes("50k")) return 50;
  if (s.includes("ultra")) return 50;
  return null;
}

function goalKey(profile = {}) {
  const s = String(profile?.goal?.distance || profile?.goalDistance || "").toLowerCase();
  if (s.includes("5k")) return "5k";
  if (s.includes("10k")) return "10k";
  if (s.includes("half")) return "half";
  if (s.includes("marathon") && !s.includes("half")) return "marathon";
  if (s.includes("ultra")) return "ultra";
  return "other";
}

function goalDistanceKm(profile = {}) {
  const key = goalKey(profile);
  if (key === "5k") return 5;
  if (key === "10k") return 10;
  if (key === "half") return 21.0975;
  if (key === "marathon") return 42.195;
  if (key === "ultra") return 50;
  return distanceToKm(profile?.goal?.distance || profile?.goalDistance) || 10;
}

function secondsToPace(secPerKm) {
  const sec = round(secPerKm);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}/km`;
}

function secondsToTime(sec) {
  const total = round(sec);
  if (!Number.isFinite(total) || total <= 0) return null;
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function secToKph(secPerKm) {
  const sec = Number(secPerKm);
  return Number.isFinite(sec) && sec > 0 ? round1(3600 / sec) : null;
}

function formatRange(minSec, maxSec, { includeKph = false, targetMode = "pace" } = {}) {
  const min = round(clamp(minSec, 120, 900));
  const max = round(clamp(maxSec, 120, 900));
  const out = {
    min: secondsToPace(min),
    max: secondsToPace(max),
    minSecPerKm: min,
    maxSecPerKm: max,
    targetMode,
  };
  if (includeKph) {
    out.minKph = secToKph(max);
    out.maxKph = secToKph(min);
    out.kph = `${out.minKph}-${out.maxKph} km/h`;
  }
  return out;
}

function raceEquivalent({ label, km, timeSec }) {
  const paceSecPerKm = timeSec / km;
  return {
    label,
    distanceKm: km,
    timeSec: round(timeSec),
    time: secondsToTime(timeSec),
    paceSecPerKm: round(paceSecPerKm),
    pace: secondsToPace(paceSecPerKm),
  };
}

function vo2FromVelocity(velocityMPerMin) {
  return -4.6 + 0.182258 * velocityMPerMin + 0.000104 * velocityMPerMin * velocityMPerMin;
}

function percentVo2Max(timeMin) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMin) + 0.2989558 * Math.exp(-0.1932605 * timeMin);
}

function vdotFromPerformance({ distanceKm, timeSec }) {
  const km = Number(distanceKm);
  const sec = Number(timeSec);
  if (!Number.isFinite(km) || !Number.isFinite(sec) || km <= 0 || sec <= 0) return null;
  const timeMin = sec / 60;
  const velocity = (km * 1000) / timeMin;
  const pct = percentVo2Max(timeMin);
  const vo2 = vo2FromVelocity(velocity);
  const vdot = vo2 / pct;
  return Number.isFinite(vdot) && vdot > 10 && vdot < 100 ? vdot : null;
}

function timeForVdot(vdot, distanceKm) {
  const target = Number(vdot);
  const km = Number(distanceKm);
  if (!Number.isFinite(target) || !Number.isFinite(km) || target <= 0 || km <= 0) return null;
  let lo = Math.max(150, km * 120);
  let hi = Math.max(lo + 60, km * 900);
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const estimate = vdotFromPerformance({ distanceKm: km, timeSec: mid });
    if (!Number.isFinite(estimate)) break;
    if (estimate > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function makeRaceAnchor({ source, sourceField, distance, distanceKm, timeSec, date = null }) {
  const km = toNum(distanceKm) ?? distanceToKm(distance);
  const sec = toNum(timeSec);
  if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(sec) || sec <= 0) return null;
  return { source, sourceField, distance: distance || `${km}K`, distanceKm: km, timeSec: sec, date };
}

function explicitRecentRace(profile = {}) {
  const rr = profile?.pacing?.recentRace || profile?.current?.recentRace || null;
  if (!rr || typeof rr !== "object") return null;
  return makeRaceAnchor({
    source: "recent_race_or_pb",
    sourceField: profile?.pacing?.recentRace ? "pacing.recentRace" : "current.recentRace",
    distance: rr.distance,
    distanceKm: rr.distanceKm,
    timeSec: toNum(rr.timeSec) ?? parseTimeToSeconds(rr.time) ?? parseTimeToSeconds(rr.result),
    date: rr.date || null,
  });
}

function recentTimes(profile = {}) {
  const times = profile?.current?.recentTimes || {};
  const out = [];
  const add = (key, distance, distanceKm) => {
    const sec = parseTimeToSeconds(times?.[key]);
    const race = makeRaceAnchor({
      source: "recent_times_fallback",
      sourceField: `current.recentTimes.${key}`,
      distance,
      distanceKm,
      timeSec: sec,
    });
    if (race) out.push(race);
  };
  add("fiveK", "5K", 5);
  add("tenK", "10K", 10);
  add("half", "Half marathon", 21.0975);
  add("marathon", "Marathon", 42.195);
  return out;
}

function goalTargetRace(profile = {}) {
  const sec =
    toNum(profile?.pacing?.estimatedRaceTimeSec) ??
    parseTimeToSeconds(profile?.goal?.targetTime) ??
    parseTimeToSeconds(profile?.goal?.estimatedRaceTime) ??
    parseTimeToSeconds(profile?.pacing?.estimatedRaceTime);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return makeRaceAnchor({
    source: "goal_target_time",
    sourceField: profile?.pacing?.estimatedRaceTimeSec ? "pacing.estimatedRaceTimeSec" : "goal.targetTime",
    distance: profile?.goal?.distance || profile?.goalDistance,
    distanceKm: goalDistanceKm(profile),
    timeSec: sec,
  });
}

function raceLikeActivity(activity = {}) {
  const name = String(activity?.name || activity?.title || activity?.workoutType || "").toLowerCase();
  const raceFlag = activity?.isRace === true || activity?.race === true || /\b(race|time trial|parkrun|tt)\b/.test(name);
  if (!raceFlag) return null;
  const distanceKm = toNum(activity.distanceKm) ?? (toNum(activity.distanceMeters) != null ? toNum(activity.distanceMeters) / 1000 : null);
  const timeSec =
    toNum(activity.movingTimeSec) ??
    toNum(activity.elapsedTimeSec) ??
    toNum(activity.durationSec) ??
    parseTimeToSeconds(activity.time);
  return makeRaceAnchor({
    source: "recent_activity_race_like",
    sourceField: "recentActivities",
    distance: activity.distance || null,
    distanceKm,
    timeSec,
    date: activity.date || activity.startDate || null,
  });
}

function thresholdActivityCandidate(activity = {}) {
  const blob = `${activity?.name || ""} ${activity?.type || ""} ${activity?.workoutType || ""}`.toLowerCase();
  if (!/\b(threshold|tempo|cruise|lactate|steady state)\b/.test(blob)) return null;
  const secPerKm =
    toNum(activity.averagePaceSecPerKm) ??
    toNum(activity.avgPaceSecPerKm) ??
    (() => {
      const distanceKm = toNum(activity.distanceKm) ?? (toNum(activity.distanceMeters) != null ? toNum(activity.distanceMeters) / 1000 : null);
      const timeSec = toNum(activity.movingTimeSec) ?? toNum(activity.durationSec);
      return distanceKm && timeSec ? timeSec / distanceKm : null;
    })();
  if (!Number.isFinite(secPerKm) || secPerKm < 120 || secPerKm > 900) return null;
  return { source: "recent_threshold_session", secPerKm, date: activity.date || activity.startDate || null };
}

function thresholdAnchor(profile = {}) {
  const sec =
    toNum(profile?.pacing?.thresholdPaceSecPerKm) ??
    toNum(profile?.pacing?.thresholdSecPerKm) ??
    toNum(profile?.personalization?.paces?.anchor?.thresholdPaceSecPerKm);
  if (!Number.isFinite(sec) || sec < 120 || sec > 900) return null;
  return {
    source: "threshold_pace",
    sourceField: profile?.pacing?.thresholdPaceSecPerKm ? "pacing.thresholdPaceSecPerKm" : "personalization.paces.anchor.thresholdPaceSecPerKm",
    thresholdSecPerKm: sec,
    distanceKm: 10,
    timeSec: (sec / 1.04) * 10,
  };
}

function defaultThreshold(profile = {}) {
  const experience = String(profile?.current?.experience || profile?.experience || "").toLowerCase();
  if (experience.includes("advanced")) return 265;
  if (experience.includes("regular")) return 285;
  if (experience.includes("new") || experience.includes("beginner")) return 335;
  return 305;
}

function deriveHrZones(profile = {}) {
  const hr = profile?.hr || profile?.current?.hr || {};
  const age = toNum(profile?.current?.age ?? profile?.age);
  const max = toNum(hr.max);
  const resting = toNum(hr.resting);
  const lthr = toNum(hr.lthr ?? hr.threshold);
  const derivedMax = Number.isFinite(age) && age >= 12 && age <= 100 ? 220 - age : null;
  const baselineMax = Number.isFinite(max) ? max : derivedMax;

  if (Number.isFinite(lthr) && lthr > 0) {
    const zone = (lo, hi) => ({ min: round(lthr * lo), max: round(lthr * hi) });
    return {
      method: "LTHR",
      source: "lthr_override",
      lthr: round(lthr),
      zones: {
        z1: zone(0.70, 0.80),
        z2: zone(0.80, 0.89),
        z3: zone(0.90, 0.94),
        z4: zone(0.95, 0.99),
        z5: zone(1.00, 1.06),
      },
    };
  }

  if (Number.isFinite(baselineMax) && Number.isFinite(resting) && baselineMax > resting) {
    const hrr = baselineMax - resting;
    const zone = (lo, hi) => ({ min: round(resting + hrr * lo), max: round(resting + hrr * hi) });
    return {
      method: "HRR",
      source: Number.isFinite(max) ? "hrr_from_max_and_resting" : "hrr_from_age_max_and_resting",
      max: round(baselineMax),
      resting: round(resting),
      zones: {
        z1: zone(0.50, 0.60),
        z2: zone(0.60, 0.70),
        z3: zone(0.70, 0.80),
        z4: zone(0.80, 0.90),
        z5: zone(0.90, 1.00),
      },
    };
  }

  if (Number.isFinite(baselineMax)) {
    const zone = (lo, hi) => ({ min: round(baselineMax * lo), max: round(baselineMax * hi) });
    return {
      method: "MAX",
      source: Number.isFinite(max) ? "max_override" : "age_220_minus_age",
      max: round(baselineMax),
      zones: {
        z1: zone(0.60, 0.70),
        z2: zone(0.70, 0.80),
        z3: zone(0.80, 0.87),
        z4: zone(0.87, 0.93),
        z5: zone(0.93, 1.00),
      },
    };
  }

  return null;
}

function readinessFactor(readiness, warnings) {
  if (!readiness || typeof readiness !== "object") return { factor: 1, level: "normal" };
  if (readiness.illness || readiness.injuryPain) {
    warnings.push("Illness or injury pain present; pace targets should be replaced by effort/HR until resolved.");
    return { factor: 1.1, level: "very_low", preferEffort: true };
  }
  const score = toNum(readiness.score);
  const fatigue = String(readiness.fatigue || "").toLowerCase();
  const soreness = String(readiness.soreness || "").toLowerCase();
  if (Number.isFinite(score)) {
    if (score < 35) return { factor: 1.08, level: "very_low", preferEffort: true };
    if (score < 50) return { factor: 1.05, level: "low" };
    if (score < 70) return { factor: 1.025, level: "moderate" };
    return { factor: 1, level: score >= 85 ? "high" : "normal" };
  }
  if (fatigue.includes("high") || soreness.includes("high")) return { factor: 1.05, level: "low" };
  return { factor: 1, level: "normal" };
}

function environmentFactor(environment = {}, profile = {}, warnings = []) {
  const prefs = profile?.preferences || {};
  const env = { ...(prefs.environment || {}), ...(environment || {}) };
  const terrain = String(env.terrain || env.surface || prefs.terrain || "").toLowerCase();
  const tempC = toNum(env.temperatureC ?? env.heatC ?? env.tempC);
  const elevationGainM = toNum(env.elevationGainM ?? env.routeElevationGainM);
  const distanceKm = toNum(env.distanceKm) || goalDistanceKm(profile) || 10;
  const altitudeM = toNum(env.altitudeM);
  let factor = 1;
  let preferEffort = false;

  if (Number.isFinite(tempC) && tempC > 20) {
    const heatFactor = clamp((tempC - 20) * 0.005, 0, 0.08);
    factor += heatFactor;
    warnings.push(`Heat adjustment applied for ${round1(tempC)}C conditions.`);
  }
  if (Number.isFinite(elevationGainM) && elevationGainM > 0 && distanceKm > 0) {
    const climbPerKm = elevationGainM / distanceKm;
    factor += clamp(climbPerKm / 1000, 0, 0.08);
  }
  if (Number.isFinite(altitudeM) && altitudeM > 1200) {
    factor += clamp((altitudeM - 1200) / 10000, 0, 0.06);
  }
  if (terrain.includes("trail") || terrain.includes("fell") || terrain.includes("technical")) {
    factor += terrain.includes("technical") ? 0.1 : 0.06;
    preferEffort = true;
    warnings.push("Trail/technical terrain should use effort or HR rather than strict road pace.");
  }

  return { factor, preferEffort, terrainMode: preferEffort ? "effort_hr" : "road_pace" };
}

function equivalentMapFromVdot(vdot) {
  const out = {};
  for (const [key, def] of Object.entries(DISTANCES)) {
    const sec = timeForVdot(vdot, def.km);
    if (sec) out[key] = raceEquivalent({ label: def.label, km: def.km, timeSec: sec });
  }
  return out;
}

function choosePrimaryAnchor({ profile, recentActivities, paceTrace, warnings }) {
  const explicit = explicitRecentRace(profile);
  if (explicit) {
    paceTrace.push({ rule: "anchor.recent_race", result: "selected", message: "Using recent race/PB as primary pace anchor." });
    return { type: "race", confidence: 88, race: explicit };
  }

  const activityRace = (Array.isArray(recentActivities) ? recentActivities : []).map(raceLikeActivity).find(Boolean);
  if (activityRace) {
    paceTrace.push({ rule: "anchor.recent_activity_race", result: "selected", message: "Using race-like recent activity as primary pace anchor." });
    return { type: "race", confidence: 78, race: activityRace };
  }

  const threshold = thresholdAnchor(profile);
  if (threshold) {
    paceTrace.push({ rule: "anchor.threshold", result: "selected", message: "Using threshold pace anchor." });
    return { type: "threshold", confidence: 76, threshold };
  }

  const recent = recentTimes(profile)[0];
  if (recent) {
    paceTrace.push({ rule: "anchor.recent_times", result: "selected", message: "Using recent-times fallback as pace anchor." });
    return { type: "race", confidence: 68, race: recent };
  }

  const target = goalTargetRace(profile);
  if (target) {
    warnings.push("Only goal target time was available; using broad pace ranges so the goal does not override actual ability.");
    paceTrace.push({ rule: "anchor.goal_target", result: "fallback", message: "Using target time only because no objective pace anchor was supplied." });
    return { type: "race", confidence: 52, race: target, targetOnly: true };
  }

  const thresholdSec = defaultThreshold(profile);
  paceTrace.push({ rule: "anchor.default_policy", result: "fallback", message: "Using default threshold policy because no pace anchor was supplied." });
  warnings.push("No recent race, threshold, or activity pace anchor supplied; pace confidence is low.");
  return {
    type: "threshold",
    confidence: 35,
    threshold: {
      source: "default_policy",
      sourceField: null,
      thresholdSecPerKm: thresholdSec,
      distanceKm: 10,
      timeSec: (thresholdSec / 1.04) * 10,
    },
    defaultOnly: true,
  };
}

function recalibrateThreshold({ thresholdSec, recentActivities, paceTrace, warnings }) {
  const candidates = (Array.isArray(recentActivities) ? recentActivities : [])
    .map(thresholdActivityCandidate)
    .filter(Boolean);
  if (!candidates.length) return { thresholdSec, applied: false, candidates: [] };

  const candidate = candidates.reduce((sum, c) => sum + c.secPerKm, 0) / candidates.length;
  if (!Number.isFinite(candidate) || candidate <= 0) return { thresholdSec, applied: false, candidates };

  const deltaRatio = Math.abs(candidate - thresholdSec) / thresholdSec;
  if (deltaRatio > 0.08) {
    warnings.push("Recent threshold sessions conflict with the primary pace anchor; keeping conservative pace ranges.");
    paceTrace.push({ rule: "threshold.recalibration", result: "warn", message: "Recent threshold sessions were too far from anchor to fully recalibrate." });
    return { thresholdSec: Math.max(thresholdSec, candidate), applied: false, candidates };
  }

  const next = thresholdSec * 0.7 + candidate * 0.3;
  paceTrace.push({ rule: "threshold.recalibration", result: "applied", message: "Recent threshold sessions nudged threshold pace." });
  return { thresholdSec: next, applied: true, candidates };
}

function buildTrainingPaces({
  thresholdSec,
  raceEquivalents,
  goalKm,
  confidence,
  adjustmentFactor,
  includeKph,
  targetMode,
}) {
  const lowConfidence = confidence < 60;
  const rangePad = lowConfidence ? 1.04 : 1;
  const adjustedThreshold = thresholdSec * adjustmentFactor;
  const fiveK = raceEquivalents.fiveK?.paceSecPerKm || adjustedThreshold * 0.94;
  const goalEquivalent = Object.values(raceEquivalents)
    .slice()
    .sort((a, b) => Math.abs(a.distanceKm - goalKm) - Math.abs(b.distanceKm - goalKm))[0];
  const racePace = (goalEquivalent?.paceSecPerKm || adjustedThreshold / 1.04) * adjustmentFactor;

  const racePaceObj = lowConfidence
    ? formatRange(racePace * 0.98, racePace * 1.05 * rangePad, { includeKph, targetMode })
    : {
        value: secondsToPace(racePace),
        secPerKm: round(racePace),
        targetMode,
        ...(includeKph ? { kph: secToKph(racePace), speed: `${secToKph(racePace)} km/h` } : {}),
      };

  return {
    easy: formatRange(adjustedThreshold * 1.18, adjustedThreshold * 1.42 * rangePad, { includeKph, targetMode }),
    steady: formatRange(adjustedThreshold * 1.08, adjustedThreshold * 1.16 * rangePad, { includeKph, targetMode }),
    threshold: formatRange(adjustedThreshold * 0.985, adjustedThreshold * 1.025 * rangePad, { includeKph, targetMode }),
    tempo: formatRange(adjustedThreshold * 1.0, adjustedThreshold * 1.06 * rangePad, { includeKph, targetMode }),
    interval: formatRange(fiveK * adjustmentFactor * 0.98, fiveK * adjustmentFactor * 1.04 * rangePad, { includeKph, targetMode }),
    racePace: racePaceObj,
  };
}

export function pacesForEngineFromPaceModel(paceModel = null) {
  if (!paceModel || typeof paceModel !== "object") return null;
  const t = paceModel.trainingPaces || {};
  const range = (key) => {
    const r = t?.[key];
    const min = toNum(r?.minSecPerKm);
    const max = toNum(r?.maxSecPerKm);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;
    return { minSecPerKm: round(min), maxSecPerKm: round(max) };
  };
  const thresholdRange = range("threshold");
  const thresholdSecPerKm = thresholdRange ? round((thresholdRange.minSecPerKm + thresholdRange.maxSecPerKm) / 2) : null;
  const raceSecPerKm =
    toNum(t?.racePace?.secPerKm) ??
    (toNum(t?.racePace?.minSecPerKm) != null && toNum(t?.racePace?.maxSecPerKm) != null
      ? round((toNum(t.racePace.minSecPerKm) + toNum(t.racePace.maxSecPerKm)) / 2)
      : null);
  const paces = {
    source: "dynamic_pace_model",
    confidence: round(paceModel.confidence || 0),
    thresholdSecPerKm,
    raceSecPerKm,
    easy: range("easy"),
    steady: range("steady"),
    tempo: range("tempo") || thresholdRange,
    interval: range("interval"),
  };
  for (const key of Object.keys(paces)) {
    if (paces[key] == null) delete paces[key];
  }
  return paces.thresholdSecPerKm || paces.raceSecPerKm ? paces : null;
}

export function buildDynamicPaceModel({
  profile = {},
  goalRealism = null,
  readiness = null,
  recentActivities = null,
  environment = null,
} = {}) {
  const warnings = [];
  const paceTrace = [];
  const primary = choosePrimaryAnchor({ profile, recentActivities, paceTrace, warnings });
  const hrZones = deriveHrZones(profile);
  const includeKph = Boolean(profile?.preferences?.treadmill || environment?.treadmill || profile?.treadmill);
  const gKey = goalKey(profile);
  const goalKm = goalDistanceKm(profile);

  let vdot = null;
  let thresholdSec = null;
  if (primary.type === "race") {
    vdot = vdotFromPerformance(primary.race);
    if (vdot) {
      const thresholdTime = timeForVdot(vdot, 15);
      thresholdSec = thresholdTime ? thresholdTime / 15 : primary.race.timeSec / primary.race.distanceKm * 1.04;
    }
  } else if (primary.type === "threshold") {
    thresholdSec = primary.threshold.thresholdSecPerKm;
    vdot = vdotFromPerformance({ distanceKm: 10, timeSec: primary.threshold.timeSec });
  }

  if (!Number.isFinite(thresholdSec) || thresholdSec <= 0) thresholdSec = defaultThreshold(profile);
  if (!Number.isFinite(vdot) || vdot <= 0) {
    vdot = vdotFromPerformance({ distanceKm: 10, timeSec: (thresholdSec / 1.04) * 10 });
  }

  const recalibration = recalibrateThreshold({ thresholdSec, recentActivities, paceTrace, warnings });
  thresholdSec = recalibration.thresholdSec;

  const raceEquivalents = equivalentMapFromVdot(vdot);
  const readinessAdj = readinessFactor(readiness, warnings);
  const envAdj = environmentFactor(environment, profile, warnings);
  const preferEffort =
    readinessAdj.preferEffort ||
    envAdj.preferEffort ||
    gKey === "ultra" ||
    primary.confidence < 45;
  const targetMode = preferEffort ? "effort_hr" : primary.confidence < 60 && hrZones ? "pace_range_hr_fallback" : "pace";
  const adjustmentFactor = Math.max(1, readinessAdj.factor) * Math.max(1, envAdj.factor);

  let confidence = primary.confidence;
  if (recalibration.applied) confidence += 4;
  if (hrZones && confidence < 60) confidence += 5;
  if (goalRealism?.level === "aggressive") confidence -= 5;
  if (goalRealism?.level === "unsafe") confidence -= 12;
  if (envAdj.preferEffort) confidence -= 4;
  confidence = clamp(round(confidence), 20, 95);

  if (gKey === "ultra") {
    warnings.push("Ultra plans should use effort/HR and terrain context more than strict pace.");
  }
  if (primary.targetOnly && goalRealism && ["aggressive", "unsafe"].includes(goalRealism.level)) {
    warnings.push("Aggressive target time was not allowed to override actual ability anchors.");
  }

  const trainingPaces = buildTrainingPaces({
    thresholdSec,
    raceEquivalents,
    goalKm,
    confidence,
    adjustmentFactor,
    includeKph,
    targetMode,
  });

  const paceModel = {
    confidence,
    vdot: round1(vdot),
    primaryAnchor: primary.race
      ? {
          source: primary.race.source,
          sourceField: primary.race.sourceField,
          distanceKm: primary.race.distanceKm,
          timeSec: round(primary.race.timeSec),
        }
      : {
          source: primary.threshold?.source || "threshold",
          sourceField: primary.threshold?.sourceField || null,
          thresholdSecPerKm: round(thresholdSec),
        },
    raceEquivalents,
    trainingPaces,
    hrZones,
    adjustments: {
      readinessLevel: readinessAdj.level,
      readinessFactor: round1(readinessAdj.factor),
      environmentFactor: round1(envAdj.factor),
      adjustmentFactor: round1(adjustmentFactor),
      terrainMode: envAdj.terrainMode,
      preferEffortTargets: preferEffort,
      targetMode,
      treadmill: includeKph,
      thresholdRecalibrated: recalibration.applied,
      thresholdCandidateCount: recalibration.candidates.length,
      lowConfidenceUsesRanges: confidence < 60,
    },
    warnings,
  };

  paceTrace.push({
    rule: "pace_model.output",
    result: "built",
    message: `Dynamic pace model built with ${confidence}% confidence.`,
  });

  return { paceModel, paceTrace };
}
