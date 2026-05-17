import { parseRecentRaceAnchor } from "./deriveInputs.js";
import { normaliseGoalDistanceKey } from "./normalization.js";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
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
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) {
    const [mm, ss] = parts;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }
  const [hh, mm, ss] = parts;
  if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
  return hh * 3600 + mm * 60 + ss;
}

function formatTime(seconds) {
  const sec = Math.round(Number(seconds));
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function formatPace(secPerKm) {
  const sec = Math.round(Number(secPerKm));
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}/km`;
}

function raceDistanceKmFromLabel(label) {
  const d = String(label || "").trim().toLowerCase();
  if (!d) return null;
  if (d === "5k" || d.includes("5k")) return 5;
  if (d === "10k" || d.includes("10k")) return 10;
  if (d.includes("half")) return 21.0975;
  if (d.includes("marathon") && !d.includes("half")) return 42.195;
  if (d.includes("ultra")) return 50;
  return null;
}

function predictRaceTimeSec({ fromDistanceKm, fromTimeSec, toDistanceKm }) {
  const fromKm = toNum(fromDistanceKm);
  const fromSec = toNum(fromTimeSec);
  const toKm = toNum(toDistanceKm);
  if (!fromKm || !fromSec || !toKm) return null;
  return fromSec * Math.pow(toKm / fromKm, 1.06);
}

function levelFromScore(score) {
  if (score >= 80) return "realistic";
  if (score >= 65) return "challenging";
  if (score >= 45) return "aggressive";
  return "unsafe";
}

function worseLevel(a, b) {
  const order = { realistic: 0, challenging: 1, aggressive: 2, unsafe: 3 };
  return (order[b] || 0) > (order[a] || 0) ? b : a;
}

function levelFromFactorStatus(status) {
  if (status === "unsafe") return "unsafe";
  if (status === "aggressive") return "aggressive";
  if (status === "challenging" || status === "low" || status === "limited" || status === "short" || status === "mismatch") {
    return "challenging";
  }
  return "realistic";
}

function minWeeksForGoal(goalKey) {
  return {
    "5K": { recommended: 6, absolute: 4 },
    "10K": { recommended: 8, absolute: 6 },
    HALF: { recommended: 10, absolute: 8 },
    MARATHON: { recommended: 14, absolute: 10 },
    ULTRA: { recommended: 16, absolute: 12 },
  }[goalKey] || { recommended: 8, absolute: 4 };
}

function volumeForGoal(goalKey) {
  return {
    "5K": { recommended: 8, absolute: 3 },
    "10K": { recommended: 14, absolute: 6 },
    HALF: { recommended: 22, absolute: 12 },
    MARATHON: { recommended: 32, absolute: 18 },
    ULTRA: { recommended: 42, absolute: 25 },
  }[goalKey] || { recommended: 8, absolute: 3 };
}

function longestRunForGoal(goalKey) {
  return {
    "5K": 3,
    "10K": 6,
    HALF: 11,
    MARATHON: 18,
    ULTRA: 24,
  }[goalKey] || 3;
}

function minimumSessionsForGoal(goalKey) {
  if (goalKey === "MARATHON") return 3;
  if (goalKey === "ULTRA") return 4;
  if (goalKey === "HALF") return 2;
  return 2;
}

function pushFactor(factors, factor) {
  factors.push(factor);
  return factor.penalty || 0;
}

export function scoreGoalRealism(profile = {}) {
  const goal = profile?.goal && typeof profile.goal === "object" ? profile.goal : {};
  const current = profile?.current && typeof profile.current === "object" ? profile.current : {};
  const availability = profile?.availability && typeof profile.availability === "object" ? profile.availability : {};
  const preferences = profile?.preferences && typeof profile.preferences === "object" ? profile.preferences : {};

  const goalKey = normaliseGoalDistanceKey(goal.distance, {
    fallback: "10K",
    allowGeneral: true,
    allowReturn: true,
  });
  const goalKm = raceDistanceKmFromLabel(goal.distance);
  const targetTimeSec = parseTimeToSeconds(goal.targetTime ?? goal.estimatedRaceTime);
  const recentRace = parseRecentRaceAnchor(profile?.pacing?.recentRace || current?.recentRace);
  const predictedTimeSec =
    goalKm && recentRace
      ? predictRaceTimeSec({
          fromDistanceKm: recentRace.distanceKm,
          fromTimeSec: recentRace.timeSec,
          toDistanceKm: goalKm,
        })
      : null;

  const weeklyKm = toNum(current.weeklyKm);
  const longestRunKm = toNum(current.longestRunKm);
  const sessionsPerWeek = Math.round(toNum(availability.sessionsPerWeek) || 0);
  const planLengthWeeks = Math.round(toNum(goal.planLengthWeeks) || 0);
  const experience = String(current.experience || "").trim();
  const difficulty = String(preferences.difficulty || "").trim().toLowerCase();

  const factors = [];
  let score = 100;
  let suggestedTargetTime = targetTimeSec ? formatTime(targetTimeSec) : null;
  const weekRule = minWeeksForGoal(goalKey);
  let suggestedPlanLengthWeeks = planLengthWeeks || weekRule.recommended;

  if (targetTimeSec && predictedTimeSec && goalKm) {
    const fasterPct = ((predictedTimeSec - targetTimeSec) / predictedTimeSec) * 100;
    const targetPace = targetTimeSec / goalKm;
    const predictedPace = predictedTimeSec / goalKm;
    let penalty = 0;
    let status = "ok";
    if (fasterPct > 18) {
      penalty = 45;
      status = "unsafe";
    } else if (fasterPct > 10) {
      penalty = 28;
      status = "aggressive";
    } else if (fasterPct > 4) {
      penalty = 14;
      status = "challenging";
    } else if (fasterPct < -10) {
      penalty = -4;
      status = "conservative";
    }

    if (fasterPct > 4) {
      suggestedTargetTime = formatTime(predictedTimeSec * 0.94);
    }

    score -= pushFactor(factors, {
      code: "TARGET_PACE_GAP",
      status,
      penalty,
      message:
        fasterPct > 4
          ? `Target ${goalKey} time requires ${formatPace(targetPace)}, but recent ${recentRace.distance} suggests about ${formatPace(predictedPace)}.`
          : "Target pace is aligned with recent race evidence.",
      evidence: {
        targetTime: formatTime(targetTimeSec),
        targetPace: formatPace(targetPace),
        recentRace: { distance: recentRace.distance, time: formatTime(recentRace.timeSec) },
        predictedTime: formatTime(predictedTimeSec),
        predictedPace: formatPace(predictedPace),
        fasterThanPredictionPct: round1(fasterPct),
      },
    });
  } else {
    score -= pushFactor(factors, {
      code: "PACE_EVIDENCE",
      status: "unknown",
      penalty: targetTimeSec ? 8 : 0,
      message: targetTimeSec
        ? "Target time provided without a recent PB/race anchor."
        : "No target time provided; pace realism is not scored.",
    });
  }

  const volumeRule = volumeForGoal(goalKey);
  if (weeklyKm != null) {
    let penalty = 0;
    let status = "ok";
    if (weeklyKm < volumeRule.absolute) {
      penalty = 35;
      status = "unsafe";
    } else if (weeklyKm < volumeRule.recommended) {
      penalty = 15;
      status = "low";
    }
    score -= pushFactor(factors, {
      code: "CURRENT_WEEKLY_KM",
      status,
      penalty,
      message: status === "ok" ? "Current weekly volume supports this goal." : "Current weekly volume is light for this goal.",
      evidence: { weeklyKm, recommendedWeeklyKm: volumeRule.recommended, minimumWeeklyKm: volumeRule.absolute },
    });
  }

  const longestRecommended = longestRunForGoal(goalKey);
  if (longestRunKm != null) {
    let penalty = 0;
    let status = "ok";
    if (longestRunKm < longestRecommended * 0.55) {
      penalty = 18;
      status = "low";
    } else if (longestRunKm < longestRecommended * 0.75) {
      penalty = 9;
      status = "limited";
    }
    score -= pushFactor(factors, {
      code: "LONGEST_RECENT_RUN",
      status,
      penalty,
      message: status === "ok" ? "Longest recent run supports this goal." : "Longest recent run is short for this goal.",
      evidence: { longestRunKm, recommendedLongestRunKm: longestRecommended },
    });
  }

  const minSessions = minimumSessionsForGoal(goalKey);
  if (sessionsPerWeek > 0) {
    const penalty = sessionsPerWeek < minSessions ? (goalKey === "ULTRA" || goalKey === "MARATHON" ? 35 : 22) : 0;
    score -= pushFactor(factors, {
      code: "SESSIONS_PER_WEEK",
      status: penalty ? "low" : "ok",
      penalty,
      message: penalty ? "Run frequency is low for this goal." : "Run frequency supports this goal.",
      evidence: { sessionsPerWeek, minimumRecommendedSessionsPerWeek: minSessions },
    });
  }

  if (planLengthWeeks > 0) {
    let penalty = 0;
    let status = "ok";
    if (planLengthWeeks < weekRule.absolute) {
      penalty = 30;
      status = "unsafe";
    } else if (planLengthWeeks < weekRule.recommended) {
      penalty = 12;
      status = "short";
    }
    if (penalty) suggestedPlanLengthWeeks = Math.max(suggestedPlanLengthWeeks, weekRule.recommended);
    score -= pushFactor(factors, {
      code: "PLAN_LENGTH",
      status,
      penalty,
      message: penalty ? "Plan length is short for this goal." : "Plan length supports this goal.",
      evidence: { planLengthWeeks, recommendedWeeks: weekRule.recommended, minimumWeeks: weekRule.absolute },
    });
  }

  if (experience === "New to running" && (difficulty === "hard" || difficulty === "aggressive")) {
    score -= pushFactor(factors, {
      code: "EXPERIENCE_DIFFICULTY",
      status: "mismatch",
      penalty: 12,
      message: "Hard difficulty is a mismatch for a beginner profile.",
      evidence: { experience, difficulty },
    });
  } else {
    score -= pushFactor(factors, {
      code: "EXPERIENCE_DIFFICULTY",
      status: "ok",
      penalty: 0,
      message: "Experience and difficulty are aligned.",
      evidence: { experience, difficulty },
    });
  }

  const finalScore = clamp(Math.round(score), 0, 100);
  const level = factors.reduce(
    (acc, factor) => worseLevel(acc, levelFromFactorStatus(factor?.status)),
    levelFromScore(finalScore)
  );
  const messageByLevel = {
    realistic: "This goal is realistic from the current profile.",
    challenging: "This goal is challenging but plausible with consistent training.",
    aggressive: "This goal is aggressive and should be treated as high risk.",
    unsafe: "This goal is unsafe or not professionally defensible from the current profile.",
  };

  return {
    level,
    score: finalScore,
    message: messageByLevel[level],
    suggestedTargetTime,
    suggestedPlanLengthWeeks,
    factors,
  };
}
