const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

export function roundInt(value) {
  return Math.round(Number(value || 0));
}

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normaliseDay(value) {
  const key = String(value || "")
    .trim()
    .slice(0, 3)
    .toLowerCase();
  const map = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  };
  return map[key] || null;
}

export function uniqOrderedDays(days) {
  const seen = new Set();
  return (Array.isArray(days) ? days : [])
    .map((d) => normaliseDay(d))
    .filter(Boolean)
    .filter((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    })
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

export function parseTimeToSeconds(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const parts = s.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map((x) => Number(x));
  if (nums.some((x) => !Number.isFinite(x))) return null;

  if (nums.length === 2) {
    const [mm, ss] = nums;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }

  const [hh, mm, ss] = nums;
  if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
  return hh * 3600 + mm * 60 + ss;
}

export function goalDistanceToKm(goalDistance) {
  const key = String(goalDistance || "").trim().toUpperCase();
  if (key === "5K") return 5;
  if (key === "10K") return 10;
  if (key === "HALF" || key === "HALF MARATHON") return 21.1;
  if (key === "MARATHON") return 42.2;
  if (key === "ULTRA") return 50;
  return null;
}

export function normaliseGoalDistance(goalDistance) {
  const raw = String(goalDistance || "").trim().toUpperCase();
  const aliases = {
    "5K": "5K",
    "10K": "10K",
    HALF: "HALF",
    "HALF MARATHON": "HALF",
    MARATHON: "MARATHON",
    ULTRA: "ULTRA",
  };
  return aliases[raw] || null;
}

export function formatPace(secPerKm) {
  const sec = roundInt(secPerKm);
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}/km`;
}

export function weekdayIndex(dayAbbrev) {
  return DAY_ORDER.indexOf(dayAbbrev);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function weekdayAbbrevFromIso(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_ORDER[(d.getUTCDay() + 6) % 7];
}

export function isoWeekStart(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function sessionId(weekNumber, day, type, ordinal) {
  const token = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return `w${weekNumber}_${token(day)}_${token(type)}_${ordinal}`;
}

export function deepMerge(target, source) {
  if (!isPlainObject(target)) return source;
  if (!isPlainObject(source)) return target;
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (Array.isArray(v)) {
      out[k] = [...v];
      continue;
    }
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export const DAYS = DAY_ORDER;
