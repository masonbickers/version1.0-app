export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

export function roundInt(value) {
  return Math.round(Number(value || 0));
}

export function deepMerge(base, override) {
  if (!isPlainObject(base)) return override;
  if (!isPlainObject(override)) return base;

  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      out[key] = [...value];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function normaliseDay(value) {
  const raw = String(value || "")
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
  return map[raw] || null;
}

export function uniqOrderedDays(days) {
  const seen = new Set();
  const out = [];
  for (const day of Array.isArray(days) ? days : []) {
    const d = normaliseDay(day);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  out.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return out;
}

export function parseTimeToSeconds(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  const parts = s.split(":").map((x) => Number(x.trim()));
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 2) {
    const [mm, ss] = parts;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

export function normaliseGoalDistance(value) {
  const raw = String(value || "").trim().toUpperCase();
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

export function goalDistanceKm(goalDistanceKey) {
  const map = {
    "5K": 5,
    "10K": 10,
    HALF: 21.1,
    MARATHON: 42.2,
    ULTRA: 50,
  };
  return map[goalDistanceKey] || null;
}

export function formatPace(secPerKm) {
  const sec = roundInt(secPerKm);
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}/km`;
}

export function dayIndex(dayAbbrev) {
  return DAY_ORDER.indexOf(dayAbbrev);
}

export function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function weekStartMonday(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

export function weekdayFromIso(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_ORDER[(d.getUTCDay() + 6) % 7];
}

export function makeSessionId(weekNumber, day, type, ordinal) {
  const token = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return `w${weekNumber}_${token(day)}_${token(type)}_${ordinal}`;
}
