import { RULES } from "./rulesConfig.js";

export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const GOAL_DISTANCE_KEYS = ["5K", "10K", "HALF", "MARATHON", "ULTRA"];
export const EXPERIENCE_LEVEL_KEYS = ["new", "some", "regular", "advanced"];
export const METRIC_MODES = ["time", "distance", "mixed"];

const DAY_ALIAS = {
  monday: "Mon",
  mon: "Mon",
  tuesday: "Tue",
  tue: "Tue",
  wednesday: "Wed",
  wed: "Wed",
  thursday: "Thu",
  thu: "Thu",
  thur: "Thu",
  thurs: "Thu",
  friday: "Fri",
  fri: "Fri",
  saturday: "Sat",
  sat: "Sat",
  sunday: "Sun",
  sun: "Sun",
};

const VALID_DAYS = new Set(DAY_ORDER);
const VALID_METRIC_MODES = new Set(METRIC_MODES);

function normaliseText(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function productExperienceLevels() {
  const fromRules = RULES?.productSpec?.experienceLevels;
  if (Array.isArray(fromRules) && fromRules.length >= 4) return fromRules;
  return [
    "New to running",
    "Some experience",
    "Regular runner",
    "Advanced/competitive",
  ];
}

export function normaliseGoalDistanceKey(
  value,
  { fallback = "10K", allowGeneral = false, allowReturn = false } = {}
) {
  const raw = normaliseText(value);
  if (!raw) return fallback;

  // Non-race aliases (optional)
  if (
    allowReturn &&
    (raw.includes("return") || raw.includes("injury") || raw.includes("rehab"))
  ) {
    return "RETURN";
  }
  if (allowGeneral && raw.includes("general")) return "GENERAL";

  // Ultra first (contains "50k"/"100k", which also contain "10")
  if (
    raw.includes("ultra") ||
    raw.includes("50k") ||
    raw.includes("100k") ||
    raw.includes("50m")
  ) {
    return "ULTRA";
  }

  // Marathon before half
  if (
    (raw.includes("marathon") ||
      raw.includes("mara") ||
      raw.includes("42k") ||
      raw.includes("42.2k") ||
      raw.includes("42.195k") ||
      raw.includes("26.2")) &&
    !raw.includes("half")
  ) {
    return "MARATHON";
  }

  if (
    raw.includes("half") ||
    raw === "hm" ||
    raw.includes("21k") ||
    raw.includes("21.1k") ||
    raw.includes("21.0975k")
  ) {
    return "HALF";
  }

  if (
    raw.includes("10k") ||
    raw.includes("10 km") ||
    raw === "10" ||
    raw === "10km"
  ) {
    return "10K";
  }

  if (
    raw.includes("parkrun") ||
    raw.includes("5k") ||
    raw.includes("5 km") ||
    raw === "5" ||
    raw === "5km"
  ) {
    return "5K";
  }

  if (GOAL_DISTANCE_KEYS.includes(String(value || "").toUpperCase())) {
    return String(value || "").toUpperCase();
  }

  return fallback;
}

export function goalKeyToPolicyKey(goalKey, fallback = "other") {
  const g = String(goalKey || "").toUpperCase();
  if (g === "5K") return "5k";
  if (g === "10K") return "10k";
  if (g === "HALF") return "half";
  if (g === "MARATHON") return "marathon";
  if (g === "ULTRA") return "ultra";
  if (g === "GENERAL") return "general";
  if (g === "RETURN") return "return";
  return fallback;
}

export function goalKeyToByDistanceKey(goalKey, fallback = "10k") {
  const g = String(goalKey || "").toUpperCase();
  if (g === "5K") return "5k";
  if (g === "10K") return "10k";
  if (g === "HALF") return "half";
  if (g === "MARATHON") return "mara";
  if (g === "ULTRA") return "ultra";
  return fallback;
}

export function normaliseGoalPolicyKey(value, fallback = "other") {
  const key = normaliseGoalDistanceKey(value, {
    fallback: null,
    allowGeneral: true,
    allowReturn: true,
  });
  if (!key) return fallback;
  return goalKeyToPolicyKey(key, fallback);
}

export function normaliseExperienceLabel(value, fallback = null) {
  const levels = productExperienceLevels();
  const fallbackLabel = fallback || levels[1] || "Some experience";
  const raw = normaliseText(value);
  if (!raw) return fallbackLabel;

  if (raw.includes("new") || raw.includes("beginner") || raw.includes("novice")) {
    return levels[0] || "New to running";
  }
  if (raw.includes("regular")) return levels[2] || "Regular runner";
  if (
    raw.includes("advanced") ||
    raw.includes("competitive") ||
    raw.includes("elite")
  ) {
    return levels[3] || "Advanced/competitive";
  }
  if (raw.includes("some") || raw.includes("intermediate")) {
    return levels[1] || "Some experience";
  }

  // Exact canonical label provided
  const exact = levels.find((x) => normaliseText(x) === raw);
  return exact || fallbackLabel;
}

export function experienceLabelToKey(label, fallback = "some") {
  const raw = normaliseText(label);
  if (!raw) return fallback;
  if (raw.includes("new") || raw.includes("beginner") || raw.includes("novice")) return "new";
  if (raw.includes("regular")) return "regular";
  if (raw.includes("advanced") || raw.includes("competitive") || raw.includes("elite")) return "advanced";
  if (raw.includes("some") || raw.includes("intermediate")) return "some";
  return fallback;
}

export function normaliseExperienceKey(value, fallback = "some") {
  const label = normaliseExperienceLabel(value, null);
  if (label) return experienceLabelToKey(label, fallback);
  return experienceLabelToKey(value, fallback);
}

export function normaliseMetricMode(metric, fallback = "time") {
  const raw = normaliseText(metric);
  if (!raw) return fallback;
  if (VALID_METRIC_MODES.has(raw)) return raw;

  if (["km", "kilometer", "kilometre", "metric"].includes(raw)) return "distance";
  if (["duration", "minutes", "mins", "min"].includes(raw)) return "time";
  if (["hybrid", "both"].includes(raw)) return "mixed";

  return fallback;
}

export function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

function sessionsPerWeekBounds() {
  const cfg = RULES?.normalization?.sessionsPerWeek || {};
  const min = clampInt(cfg.min ?? 1, 1, 7);
  const max = clampInt(cfg.max ?? 7, min, 7);
  const fallback = clampInt(cfg.default ?? 4, min, max);
  return { min, max, fallback };
}

function planLengthWeeksBounds() {
  const cfg = RULES?.normalization?.planLengthWeeks || {};
  const min = clampInt(cfg.min ?? 1, 1, 104);
  const max = clampInt(cfg.max ?? 52, min, 104);
  const fallback = clampInt(cfg.default ?? 12, min, max);
  return { min, max, fallback };
}

function fallbackRunDaysForCount(n) {
  const map = RULES?.normalization?.fallbackRunDaysBySessions || {};
  const fromCfg = Array.isArray(map?.[n]) ? map[n] : null;
  if (fromCfg && fromCfg.length) return fromCfg;

  const defaults = {
    1: ["Sun"],
    2: ["Tue", "Sun"],
    3: ["Tue", "Thu", "Sun"],
    4: ["Tue", "Thu", "Sat", "Sun"],
    5: ["Mon", "Tue", "Thu", "Sat", "Sun"],
    6: ["Mon", "Tue", "Wed", "Thu", "Sat", "Sun"],
    7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  };
  return Array.isArray(defaults[n]) ? defaults[n] : defaults[4];
}

export function normaliseSessionsPerWeek(sessionsPerWeek, fallback = null) {
  const bounds = sessionsPerWeekBounds();
  const raw = sessionsPerWeek ?? fallback ?? bounds.fallback;
  return clampInt(raw, bounds.min, bounds.max);
}

export function normalisePlanLengthWeeks(planLengthWeeks, fallback = null) {
  const bounds = planLengthWeeksBounds();
  const raw = planLengthWeeks ?? fallback ?? bounds.fallback;
  return clampInt(raw, bounds.min, bounds.max);
}

export function normaliseDayAbbrev(day) {
  if (!day) return null;
  const raw = String(day).trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  const mapped = DAY_ALIAS[key] || raw;
  return VALID_DAYS.has(mapped) ? mapped : null;
}

export function uniqOrderedDays(days) {
  const arr = Array.isArray(days) ? days : [];
  const cleaned = arr.map(normaliseDayAbbrev).filter(Boolean);

  const uniq = [];
  const seen = new Set();
  for (const d of cleaned) {
    if (seen.has(d)) continue;
    seen.add(d);
    uniq.push(d);
  }

  uniq.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return uniq;
}

export function ensureRunDaysCount(runDays, sessionsPerWeek) {
  const n = normaliseSessionsPerWeek(sessionsPerWeek);

  const baseInput =
    Array.isArray(runDays) && runDays.length
      ? uniqOrderedDays(runDays)
      : uniqOrderedDays(fallbackRunDaysForCount(n));

  let out = [...baseInput];

  if (out.length > n) out = out.slice(0, n);

  if (out.length < n) {
    for (const d of DAY_ORDER) {
      if (out.length >= n) break;
      if (!out.includes(d)) out.push(d);
    }
  }

  out.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return out;
}

export function normaliseLongRunDay(day, { allowAny = true } = {}) {
  const defaultDay = String(RULES?.normalization?.defaultLongRunDay || "Sun");
  if (!day) return defaultDay;

  const raw = String(day).trim();
  if (!raw) return defaultDay;

  if (allowAny && raw.toLowerCase() === "any") return "Any";

  return normaliseDayAbbrev(raw) || defaultDay;
}

export function chooseLongRunDay(longRunDay, runDays = [], opts = {}) {
  const defaultDay = String(RULES?.normalization?.defaultLongRunDay || "Sun");
  const days = uniqOrderedDays(runDays);
  const lr = normaliseLongRunDay(longRunDay, opts);

  if (lr === "Any") {
    if (days.includes("Sun")) return "Sun";
    return days[days.length - 1] || defaultDay;
  }

  if (days.length && !days.includes(lr)) {
    if (days.includes("Sun")) return "Sun";
    return days[days.length - 1] || defaultDay;
  }

  return lr || defaultDay;
}

export function normalisePublicDifficulty(v) {
  const raw = String(v || "balanced").toLowerCase().trim();
  const map = {
    beginner: "easy",
    easy: "easy",
    light: "easy",
    gentle: "easy",
    conservative: "easy",
    moderate: "balanced",
    balanced: "balanced",
    normal: "balanced",
    standard: "balanced",
    hard: "hard",
    advanced: "hard",
    aggressive: "hard",
  };
  const d = map[raw] || raw;
  return d === "easy" || d === "hard" ? d : "balanced";
}

export function normaliseDifficultyKey(v) {
  return normalisePublicDifficulty(v);
}

export function normaliseProgressionDifficulty(v) {
  const raw = String(v || "").trim().toLowerCase();
  if (!raw) return "standard";
  if (["easy", "conservative", "beginner"].includes(raw)) return "conservative";
  if (["standard", "moderate", "normal", "balanced"].includes(raw)) return "standard";
  if (["hard", "aggressive", "advanced"].includes(raw)) return "aggressive";
  if (["elite", "very hard", "very_hard"].includes(raw)) return "elite";
  return "standard";
}

export function progressionDifficultyToPublic(v) {
  const d = String(v || "").trim().toLowerCase();
  if (d === "conservative") return "easy";
  if (d === "aggressive" || d === "elite") return "hard";
  return "balanced";
}
