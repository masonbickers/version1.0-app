//src/firestoreSafe.js

import { serverTimestamp } from "firebase/firestore";

/**
 * Firestore can't store undefined anywhere (even nested).
 * Must preserve special objects (FieldValue, Timestamp, Date, etc.)
 */
function isPlainObject(v) {
  if (!v || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function stripUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  // preserve Date
  if (value instanceof Date) return value;

  // preserve non-plain objects (Firestore FieldValue, Timestamp, etc.)
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep).filter((x) => x !== undefined);
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const cleaned = stripUndefinedDeep(v);
    if (cleaned === undefined) continue;
    out[k] = cleaned;
  }
  return out;
}

/** Add timestamps AFTER cleaning */
export function withTimestamps(payload, { create = false } = {}) {
  const cleaned = stripUndefinedDeep(payload);
  if (create) return { ...cleaned, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  return { ...cleaned, updatedAt: serverTimestamp() };
}
