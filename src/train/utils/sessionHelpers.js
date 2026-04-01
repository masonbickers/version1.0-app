function toSafeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// planId may contain underscores, so decode from the tail
export function decodeSessionKey(raw) {
  const rawStr = Array.isArray(raw) ? raw[0] : String(raw || "");
  const str = decodeURIComponent(rawStr);
  const parts = str.split("_");

  if (parts.length < 4) {
    return { planId: "", weekIndex: 0, dayIndex: 0, sessionIndex: 0 };
  }

  const sessionIndex = toSafeInt(parts.pop(), 0);
  const dayIndex = toSafeInt(parts.pop(), 0);
  const weekIndex = toSafeInt(parts.pop(), 0);
  const planId = parts.join("_");

  return { planId, weekIndex, dayIndex, sessionIndex };
}

const AUX_STRENGTH_RE =
  /\b(warm[\s-]?up|cool[\s-]?down|rest|recovery|recover|mobility|activation|stretch)\b/i;

export function isAuxStrengthStep({ title, blockTitle, rawType } = {}) {
  const type = String(rawType || "").toLowerCase();
  if (
    type.includes("warmup") ||
    type.includes("warm-up") ||
    type.includes("cooldown") ||
    type.includes("cool-down") ||
    type.includes("rest") ||
    type.includes("recovery") ||
    type.includes("recover") ||
    type.includes("mobility") ||
    type.includes("activation") ||
    type.includes("stretch")
  ) {
    return true;
  }

  const text = `${String(title || "")} ${String(blockTitle || "")}`.trim();
  return AUX_STRENGTH_RE.test(text);
}

export function classifyAuxSegmentKind(seg) {
  if (!seg || typeof seg !== "object") return "main";

  const rawText = [
    seg.label,
    seg.stationName,
    seg.kind,
    seg.title,
    seg.name,
    seg.stepType,
    seg.type,
    seg.notes,
  ]
    .filter(Boolean)
    .join(" ");
  const base = String(rawText).toLowerCase();

  if (base.includes("warm")) return "warmup";
  if (base.includes("cool")) return "cooldown";

  if (
    base.includes("rest") ||
    base.includes("float") ||
    base.includes("recover") ||
    base.includes("recovery") ||
    base.includes("jog") ||
    base.includes("walk")
  ) {
    return "rest";
  }

  return "main";
}
