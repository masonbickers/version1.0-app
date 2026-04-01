const DEFAULT_RUN_DAYS_BY_FREQ = {
  2: ["Tue", "Sun"],
  3: ["Tue", "Thu", "Sun"],
  4: ["Tue", "Thu", "Sat", "Sun"],
  5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
  6: ["Mon", "Tue", "Wed", "Fri", "Sat", "Sun"],
  7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePreferredDays(value) {
  if (Array.isArray(value)) {
    return value.map((d) => String(d || "").slice(0, 3)).filter(Boolean);
  }
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((d) => String(d || "").slice(0, 3))
    .filter(Boolean);
}

function inferGoalDistance(payload) {
  const explicit = String(
    payload?.goalDistance ||
      payload?.goalType ||
      payload?.goal?.distance ||
      ""
  )
    .trim()
    .toLowerCase();
  const text = String(payload?.goal || payload?.userPrompt || "")
    .trim()
    .toLowerCase();
  const merged = `${explicit} ${text}`;

  if (
    /\bhyrox\b|\bcycle\b|\bcycling\b|\bbike\b|\btri\b|\bstrength\b|\bhypertrophy\b|\bgym\b|\bweight(s)?\b|\bbodybuilding\b/.test(
      merged
    )
  ) {
    return null;
  }
  if (/\bmarathon\b/.test(merged) && !/\bhalf\b/.test(merged)) return "Marathon";
  if (/\bhalf\b/.test(merged)) return "Half marathon";
  if (/\b5k\b/.test(merged)) return "5K";
  if (/\b10k\b/.test(merged)) return "10K";
  return "10K";
}

function inferRecentTimes(payload) {
  const fiveK =
    payload?.recent5k ||
    payload?.fiveK ||
    payload?.pb5k ||
    payload?.athleteProfile?.current?.recentTimes?.fiveK ||
    "";
  const tenK =
    payload?.current10kTime ||
    payload?.recent10k ||
    payload?.tenK ||
    payload?.pb10k ||
    payload?.athleteProfile?.current?.recentTimes?.tenK ||
    "";
  const half =
    payload?.recentHalf ||
    payload?.pbHM ||
    payload?.athleteProfile?.current?.recentTimes?.halfMarathon ||
    "";
  const marathon =
    payload?.recentMarathon ||
    payload?.pbMarathon ||
    payload?.athleteProfile?.current?.recentTimes?.marathon ||
    "";

  return {
    fiveK: String(fiveK || "").trim(),
    tenK: String(tenK || "").trim(),
    halfMarathon: String(half || "").trim(),
    marathon: String(marathon || "").trim(),
  };
}

function inferExperience(payload) {
  const exp = String(
    payload?.experience ||
      payload?.experienceLevel ||
      payload?.athleteProfile?.current?.experience ||
      "Some experience"
  );
  return exp || "Some experience";
}

function inferDifficulty(payload) {
  const raw = String(
    payload?.difficulty ||
      payload?.intensityPref ||
      payload?.athleteProfile?.preferences?.intensityPref ||
      "Balanced"
  )
    .trim()
    .toLowerCase();
  if (raw.includes("aggr")) return "Aggressive";
  if (raw.includes("cons")) return "Conservative";
  return "Balanced";
}

export function buildGenerateRunRequest(payload = {}) {
  if (payload?.athleteProfile && typeof payload.athleteProfile === "object") {
    return {
      athleteProfile: payload.athleteProfile,
      allowDefaults: true,
      unsupported: false,
    };
  }

  const distance = inferGoalDistance(payload);
  if (!distance) {
    return {
      athleteProfile: null,
      allowDefaults: false,
      unsupported: true,
      reason: "Only running plans are supported via /generate-run.",
    };
  }

  const sessionsPerWeek = Math.max(
    2,
    Math.min(
      7,
      Math.round(
        toNum(payload?.sessionsPerWeek, toNum(payload?.daysPerWeek, 4)) || 4
      )
    )
  );
  const runDays =
    parsePreferredDays(
      payload?.preferredDays || payload?.runDays || payload?.availability?.runDays
    ) || [];
  const defaultRunDays =
    DEFAULT_RUN_DAYS_BY_FREQ[sessionsPerWeek] || DEFAULT_RUN_DAYS_BY_FREQ[4];
  const finalRunDays = runDays.length ? runDays : defaultRunDays;
  const longRunDay = String(
    payload?.longRunDay ||
      payload?.availability?.longRunDay ||
      finalRunDays[finalRunDays.length - 1] ||
      "Sun"
  );

  const weeks = Math.max(
    4,
    Math.min(
      24,
      Math.round(
        toNum(payload?.weeks, toNum(payload?.planLengthWeeks, 8)) || 8
      )
    )
  );

  const recentTimes = inferRecentTimes(payload);
  const maxHR = toNum(payload?.maxHR, toNum(payload?.athleteProfile?.hr?.max));

  const athleteProfile = {
    goal: {
      distance,
      planLengthWeeks: weeks,
      targetDate: payload?.targetEventDate || null,
      targetTime: payload?.targetTime || null,
      primaryFocus: payload?.goal || null,
    },
    availability: {
      sessionsPerWeek,
      runDays: finalRunDays,
      longRunDay,
    },
    current: {
      weeklyKm: toNum(
        payload?.weeklyKm,
        toNum(payload?.currentWeeklyDistance, 30)
      ),
      longestRunKm: toNum(
        payload?.longestRunKm,
        toNum(payload?.currentLongestRun, 12)
      ),
      experience: inferExperience(payload),
      recentTimes,
    },
    difficulty: inferDifficulty(payload),
    hr: {
      max: maxHR || 190,
      resting: toNum(payload?.restingHR, 52),
    },
  };

  return {
    athleteProfile,
    allowDefaults: true,
    unsupported: false,
  };
}
