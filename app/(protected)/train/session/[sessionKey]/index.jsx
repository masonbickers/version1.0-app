// app/(protected)/train/session/[sessionKey]/index.jsx
import Feather from "../../../../components/LucideFeather";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../../../../../config/api";
import { auth, db } from "../../../../../firebaseConfig";
import { useTheme } from "../../../../../providers/ThemeProvider";
import { fetchTrainPlanById } from "../../../../../src/train/utils/sessionRecordHelpers";
import { classifyAuxSegmentKind, decodeSessionKey } from "../../../../../src/train/utils/sessionHelpers";

/* ------------------------------------------------------------------ */
/*  THEME – SAP GEL STYLE                                             */
/* ------------------------------------------------------------------ */

const PRIMARY = "#E6FF3B";
const SILVER_LIGHT = "#F3F4F6";
const SILVER_MEDIUM = "#E1E3E8";

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const accentBg = colors?.accentBg ?? PRIMARY;
  return {
    bg: isDark ? "#050506" : "#F5F5F7",
    card: colors?.card ?? (isDark ? "#101219" : SILVER_LIGHT),
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: colors?.border ?? (isDark ? "rgba(255,255,255,0.10)" : SILVER_MEDIUM),
    primaryBg: accentBg,
    primaryText: colors?.sapOnPrimary ?? "#050506",
    primaryBorder: colors?.accentBorder ?? accentBg,
    muted: colors?.surfaceAlt ?? (isDark ? "#18191E" : "#E6E7EC"),
    isDark,
  };
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                           */
/* ------------------------------------------------------------------ */

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function normaliseDayLabel(day, fallback = "Mon") {
  const value = String(day || "").trim();
  if (!value) return fallback;
  if (DAY_ORDER.includes(value)) return value;

  const map = {
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

  return map[value.toLowerCase()] || fallback;
}

function parseNumericText(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  return extractFirstNumber(raw);
}

function extractFirstNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function extractRestSecFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const m =
    raw.match(
      /(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\s*(?:rest|recover(?:y)?)\b/i
    ) ||
    raw.match(
      /\b(?:rest|recover(?:y)?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i
    );
  if (!m) return null;
  const val = Number(m[1]);
  const unit = String(m[2] || "").toLowerCase();
  if (!Number.isFinite(val) || val <= 0) return null;
  return unit.startsWith("m") ? Math.round(val * 60) : Math.round(val);
}

function extractRpeFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const explicit = raw.match(/\bRPE\s*([0-9]+(?:\.[0-9]+)?)\b/i);
  if (explicit) {
    const n = Number(explicit[1]);
    return Number.isFinite(n) && n > 0 ? Number(n.toFixed(1)) : null;
  }
  return null;
}

const MASON_STRENGTH_FALLBACKS = {
  "upper strength": {
    "bench press": { restSec: 150, rpe: 8 },
    "weighted pull ups": { restSec: 120, rpe: 8 },
    "overhead press": { restSec: 120, rpe: 7.5 },
    "barbell row": { restSec: 105, rpe: 7.5 },
    biceps: { restSec: 75, rpe: 8 },
    "biceps curl": { restSec: 75, rpe: 8 },
    triceps: { restSec: 75, rpe: 8 },
    "triceps pressdown": { restSec: 75, rpe: 8 },
  },
  "lower strength": {
    "back squat": { restSec: 180, rpe: 8 },
    "romanian deadlift": { restSec: 150, rpe: 8 },
    "walking lunges": { restSec: 90, rpe: 7.5 },
    "hamstring curl": { restSec: 75, rpe: 8 },
    "standing calf raises": { restSec: 60, rpe: 8 },
    "core circuit": { restSec: 60, rpe: 7 },
  },
  "upper volume": {
    "incline db press": { restSec: 90, rpe: 8 },
    "lat pulldown": { restSec: 90, rpe: 8 },
    "lateral raises": { restSec: 60, rpe: 8.5 },
    "cable fly": { restSec: 60, rpe: 8 },
    "cable curl": { restSec: 60, rpe: 8 },
    "triceps pushdown": { restSec: 60, rpe: 8 },
  },
  "lower hypertrophy": {
    "front squat or hack squat": { restSec: 120, rpe: 8 },
    "hip thrust": { restSec: 120, rpe: 8 },
    "single leg rdl": { restSec: 90, rpe: 8 },
    "leg extension": { restSec: 75, rpe: 8 },
    "hamstring curl": { restSec: 75, rpe: 8 },
    "walking lunges": { restSec: 75, rpe: 8 },
    "calf raises": { restSec: 60, rpe: 8 },
    "core carries": { restSec: 75, rpe: 7.5 },
    "sled push": { restSec: 90, rpe: 8.5 },
    "wall balls": { restSec: 75, rpe: 8.5 },
  },
};

function normalizeTextKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMasonFallbackPrescription(seg, options = {}) {
  const planName = normalizeTextKey(options?.planName);
  const coachName = normalizeTextKey(options?.coachName || options?.planCoachName);
  const sessionTitle = normalizeTextKey(
    options?.sessionTitle || options?.stationName || seg?.stationName || ""
  );
  const masonTagged =
    planName.includes("mason bickers") ||
    coachName.includes("mason bickers") ||
    coachName === "mason";
  const knownMasonBlock = Object.keys(MASON_STRENGTH_FALLBACKS).some((key) =>
    sessionTitle.includes(key)
  );
  if (!masonTagged && !knownMasonBlock) return null;

  const blockKey = Object.keys(MASON_STRENGTH_FALLBACKS).find((key) =>
    sessionTitle.includes(key)
  );
  if (!blockKey) return null;

  const exerciseName = normalizeTextKey(seg?.title || seg?.name || seg?.type || "");
  if (!exerciseName) return null;

  const defaults = MASON_STRENGTH_FALLBACKS[blockKey] || {};
  if (defaults[exerciseName]) return defaults[exerciseName];
  const looseKey = Object.keys(defaults).find(
    (k) => exerciseName.includes(k) || k.includes(exerciseName)
  );
  return looseKey ? defaults[looseKey] : null;
}

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function isWritableUserPlanPath(pathSegments, uid) {
  return (
    Array.isArray(pathSegments) &&
    pathSegments.length >= 4 &&
    pathSegments[0] === "users" &&
    pathSegments[1] === uid &&
    ["plans", "runPlans", "trainingPlans"].includes(pathSegments[2])
  );
}

function isStrengthPlanDoc(data) {
  const kind = String(data?.kind || data?.plan?.kind || "").toLowerCase();
  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  const primaryActivity = String(
    data?.meta?.primaryActivity ||
      data?.primaryActivity ||
      data?.plan?.primaryActivity ||
      ""
  ).toLowerCase();
  const goalType = String(data?.goalType || data?.plan?.goalType || "").toLowerCase();

  if (kind === "strength") return true;
  if (source.includes("strength")) return true;
  if (primaryActivity.includes("strength") || primaryActivity.includes("gym")) return true;
  if (goalType.includes("strength")) return true;

  const weeks = Array.isArray(data?.weeks)
    ? data.weeks
    : Array.isArray(data?.plan?.weeks)
    ? data.plan.weeks
    : [];

  return weeks.some((w) =>
    Array.isArray(w?.days) &&
    w.days.some((d) =>
      Array.isArray(d?.sessions) &&
      d.sessions.some((s) => {
        const sport = String(
          s?.workout?.sport || s?.sessionType || s?.type || ""
        ).toLowerCase();
        return (
          sport.includes("strength") ||
          sport.includes("gym") ||
          Array.isArray(s?.blocks)
        );
      })
    )
  );
}

function isRunPlanDoc(data) {
  const kind = String(data?.kind || data?.plan?.kind || "").toLowerCase();
  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  const primaryActivity = String(
    data?.meta?.primaryActivity ||
      data?.primaryActivity ||
      data?.plan?.primaryActivity ||
      ""
  ).toLowerCase();

  if (kind === "run") return true;
  if (source.includes("run")) return true;
  if (primaryActivity.includes("run")) return true;

  const athleteProfile = data?.athleteProfile || data?.plan?.athleteProfile || {};
  if (athleteProfile?.goal?.distance) return true;
  if (athleteProfile?.availability?.runDays?.length) return true;

  const weeks = Array.isArray(data?.weeks)
    ? data.weeks
    : Array.isArray(data?.plan?.weeks)
    ? data.plan.weeks
    : [];

  return weeks.some((w) => {
    const sessions = Array.isArray(w?.sessions)
      ? w.sessions
      : Array.isArray(w?.days)
      ? w.days.flatMap((d) => (Array.isArray(d?.sessions) ? d.sessions : []))
      : [];

    return sessions.some((s) => {
      const hasDistance =
        typeof s?.distanceKm === "number" ||
        typeof s?.distance === "number" ||
        typeof s?.plannedDistanceKm === "number" ||
        typeof s?.distanceMeters === "number";

      const hasRunStepTarget =
        Array.isArray(s?.steps) &&
        s.steps.some((st) => st?.targetType || st?.durationType);

      return hasDistance || hasRunStepTarget;
    });
  });
}

function classifyPlanType(data, session) {
  const sessionSegments = normaliseToSegments(session);
  const hasStrengthSegments = sessionSegments.some((seg) => hasStrengthPrescription(seg));
  const hasRunSegments = sessionSegments.some((seg) => hasRunPrescription(seg));
  if (hasRunSegments && !hasStrengthSegments) return "run";
  if (hasStrengthSegments && !hasRunSegments) return "strength";

  const sport = String(
    session?.workout?.sport || session?.sessionType || session?.type || ""
  ).toLowerCase();

  if (
    sport.includes("strength") ||
    sport.includes("gym") ||
    Array.isArray(session?.blocks)
  ) {
    if (hasRunSegments) return "run";
    return "strength";
  }

  if (
    sport.includes("run") ||
    sport.includes("interval") ||
    sport.includes("tempo") ||
    sport.includes("easy") ||
    sport.includes("long")
  ) {
    return "run";
  }

  const titleBlob = [
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|row|lunge|press|sets?|reps?|rpe)\b/.test(
      titleBlob
    )
  ) {
    return "strength";
  }

  const hasStrengthAnywhere = isStrengthPlanDoc(data);
  const hasRunAnywhere = isRunPlanDoc(data);
  if (hasStrengthAnywhere && !hasRunAnywhere) return "strength";
  if (hasRunAnywhere && !hasStrengthAnywhere) return "run";

  return "run";
}

function normaliseSessionForLookup(raw, fallbackDay) {
  const session = raw && typeof raw === "object" ? raw : {};
  const day = normaliseDayLabel(
    session.day || session.dow || session.weekday,
    normaliseDayLabel(fallbackDay || "Mon")
  );

  const type = session.type || session.sessionType || "RUN";
  const title =
    session.title ||
    session.name ||
    session.workoutName ||
    session.sessionName ||
    session.keyTargets ||
    type;

  return {
    ...session,
    day,
    type,
    sessionType: session.sessionType || type,
    title,
  };
}

function deriveDaysFromCanonicalSessions(sessions) {
  const byDay = new Map();
  for (const raw of Array.isArray(sessions) ? sessions : []) {
    const s = normaliseSessionForLookup(raw, raw?.day);
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day).push(s);
  }

  return DAY_ORDER.map((day) => ({
    day,
    sessions: byDay.get(day) || [],
  }));
}

function normaliseWeekForLookup(week, fallbackWeekNumber) {
  const w = week && typeof week === "object" ? week : {};

  const daysRaw = Array.isArray(w.days) ? w.days : [];
  const hasUsableDays = daysRaw.some((d) => Array.isArray(d?.sessions));

  const days = hasUsableDays
    ? DAY_ORDER.map((dayLabel) => {
        const src = daysRaw.find((d) => normaliseDayLabel(d?.day, dayLabel) === dayLabel);
        const sessions = Array.isArray(src?.sessions)
          ? src.sessions.map((s) => normaliseSessionForLookup(s, dayLabel))
          : [];
        return {
          day: dayLabel,
          recoveryGuidance: src?.recoveryGuidance || "",
          sessions,
        };
      })
    : deriveDaysFromCanonicalSessions(w.sessions);

  const sessions = Array.isArray(w.sessions)
    ? w.sessions.map((s) => normaliseSessionForLookup(s, s?.day))
    : days.flatMap((d) => d.sessions);

  return {
    ...w,
    weekNumber:
      Number.isFinite(Number(w.weekNumber))
        ? Number(w.weekNumber)
        : Number.isFinite(Number(w.weekIndex))
        ? Number(w.weekIndex)
        : fallbackWeekNumber,
    days,
    sessions,
  };
}

function unwrapPlanDoc(data) {
  const root = data || {};
  const p1 = root?.plan && typeof root.plan === "object" ? root.plan : null;
  const p2 = p1?.plan && typeof p1.plan === "object" ? p1.plan : null;

  const weeks =
    (Array.isArray(root?.weeks) && root.weeks) ||
    (Array.isArray(p1?.weeks) && p1.weeks) ||
    (Array.isArray(p2?.weeks) && p2.weeks) ||
    [];

  const meta = root?.meta || p1?.meta || p2?.meta || {};
  const primaryActivity = root?.primaryActivity || p1?.primaryActivity || p2?.primaryActivity;

  return { weeks, meta, primaryActivity, planObj: p1 || root };
}

function blocksToSegments(blocks) {
  const src = Array.isArray(blocks) ? blocks : [];
  const out = [];

  src.forEach((block) => {
    if (!block || typeof block !== "object") return;

    const blockKind = String(block.kind || block.type || "").trim();
    const blockLabel = String(block.title || blockKind || "Block").trim();
    const items = Array.isArray(block.items) ? block.items : [];

    if (!items.length) {
      out.push({
        type: blockLabel,
        kind: blockKind || "main",
      });
      return;
    }

    items.forEach((item) => {
      if (!item || typeof item !== "object") return;

      const title = String(item.title || item.name || blockLabel || "Exercise").trim();
      const itemKind = String(item.kind || "").trim();
      const timeSec = Number(item.timeSec ?? item.durationSec ?? 0);
      const sets = Number(item.sets ?? 0);
      const reps = Number(item.reps ?? 0);
      const restSec = Number(item.restSec ?? 0);
      const loadKg = Number(item.loadKg ?? 0);
      const rpe = parseNumericText(item.rpe);
      const rir = parseNumericText(item.rir);
      const load = String(item.load ?? "").trim();
      const cues = String(item.cues || item.notes || "").trim();
      const effort = String(item.effort || "").trim();

      const seg = {
        type: title,
        kind: blockKind || itemKind || "main",
        stationName: blockLabel,
      };

      if (timeSec > 0) {
        seg.durationType = "Time (min)";
        seg.durationValue = Math.round((timeSec / 60) * 10) / 10;
      }
      if (sets > 0) seg.sets = sets;
      if (reps > 0) seg.reps = reps;
      if (restSec > 0) seg.restSec = Math.round(restSec);
      if (loadKg > 0) seg.loadKg = loadKg;
      if (load) seg.load = load;
      if (rpe != null && rpe > 0) seg.rpe = rpe;
      if (rir != null && rir >= 0) seg.rir = rir;

      const notes = [cues, effort ? `Effort: ${effort}` : ""].filter(Boolean).join(" · ");
      if (notes) seg.notes = notes;

      out.push(seg);
    });
  });

  return out;
}

function normaliseCoachStyleStep(rawStep) {
  if (!rawStep || typeof rawStep !== "object") return rawStep;

  const out = { ...rawStep };

  const titleFromName = String(out.title || out.name || "").trim();
  if (!out.title && titleFromName) out.title = titleFromName;

  const durationObj =
    out.duration && typeof out.duration === "object" ? out.duration : null;
  if (!out.durationType && durationObj) {
    const durationTypeRaw = String(durationObj.type || "").toUpperCase();
    const sec = Number(durationObj.seconds);
    const meters = Number(durationObj.meters);

    if (durationTypeRaw === "TIME" && Number.isFinite(sec) && sec > 0) {
      out.durationType = "time";
      out.durationValue = Math.round(sec);
      if (!out.stepType && out.type) out.stepType = String(out.type).toLowerCase();
    } else if (durationTypeRaw === "DISTANCE" && Number.isFinite(meters) && meters > 0) {
      out.durationType = "distance";
      out.durationValue = Math.round(meters);
      if (!out.stepType && out.type) out.stepType = String(out.type).toLowerCase();
    }
  }

  const targetObj = out.target && typeof out.target === "object" ? out.target : null;
  if (!out.targetType && targetObj) {
    const paceSec = Number(targetObj.paceSecPerKm);
    if (Number.isFinite(paceSec) && paceSec > 0) {
      out.targetType = "pace_range";
      out.targetValue = {
        minSecPerKm: Math.round(paceSec),
        maxSecPerKm: Math.round(paceSec),
      };
    }
  }

  const typeRaw = String(out.type || out.stepType || "").toUpperCase();
  if (typeRaw === "REPEAT") {
    out.isRepeat = true;
    if (!Number.isFinite(Number(out.repeatCount)) || Number(out.repeatCount) <= 0) {
      const count = Number(out.repeat ?? out.reps);
      if (Number.isFinite(count) && count > 0) out.repeatCount = Math.round(count);
    }
  }

  if (Array.isArray(out.steps)) {
    out.steps = out.steps.map((step) => normaliseCoachStyleStep(step));
  }

  return out;
}

function isStrengthLikeSession(session) {
  const sport = String(
    session?.workout?.sport || session?.sessionType || session?.type || ""
  ).toLowerCase();
  if (sport.includes("strength") || sport.includes("gym") || Array.isArray(session?.blocks)) {
    return true;
  }

  const titleBlob = [
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|row|lunge|press)\b/.test(
    titleBlob
  );
}

function parseStrengthTokenToSegment(token, stationName) {
  const raw = String(token || "").trim();
  if (!raw) return null;

  const optional = /^optional\s*:/i.test(raw);
  const cleaned = raw
    .replace(/^optional\s*:\s*/i, "")
    .replace(/[.;:,]+$/g, "")
    .trim();
  if (!cleaned) return null;

  const repMatch = cleaned.match(
    /^(.*?)(?:\s*-\s*)?(\d+)\s*x\s*(\d+)(\s*\/\s*leg)?(?:\s+(.*))?$/i
  );
  const setMatch = cleaned.match(/^(.*?)(?:\s*-\s*)?(\d+)\s*sets?(?:\s+(.*))?$/i);
  const roundMatch = cleaned.match(/^(.*?)(?:\s*-\s*)?(\d+)\s*rounds?(?:\s+(.*))?$/i);

  const parseRestSec = (value) => {
    const txt = String(value || "");
    if (!txt) return null;

    let m =
      txt.match(
        /(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\s*(?:rest|recover(?:y)?)\b/i
      ) ||
      txt.match(
        /\b(?:rest|recover(?:y)?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i
      );

    if (!m) return null;
    const val = Number(m[1]);
    const unit = String(m[2] || "").toLowerCase();
    if (!Number.isFinite(val) || val <= 0) return null;
    if (unit.startsWith("m")) return Math.round(val * 60);
    return Math.round(val);
  };

  const parseRpe = (value) => {
    const txt = String(value || "");
    if (!txt) return null;
    const m = txt.match(/\bRPE\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? Number(n.toFixed(1)) : null;
  };

  const parseRir = (value) => {
    const txt = String(value || "");
    if (!txt) return null;
    const m = txt.match(/\bRIR\s*([0-9]+(?:\.[0-9]+)?)\b/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(1)) : null;
  };

  const detailTail =
    String(repMatch?.[5] || setMatch?.[3] || roundMatch?.[3] || "").trim() || cleaned;

  const seg = {
    type: cleaned,
    kind: optional ? "accessory" : "main",
    stationName: stationName || "Strength block",
  };

  if (repMatch) {
    const name = String(repMatch[1] || "").trim();
    const sets = Number(repMatch[2] || 0);
    const reps = Number(repMatch[3] || 0);
    if (name) seg.type = name;
    if (Number.isFinite(sets) && sets > 0) seg.sets = sets;
    if (Number.isFinite(reps) && reps > 0) seg.reps = reps;
    if (repMatch[4]) seg.notes = "Per leg";
  } else if (setMatch) {
    const name = String(setMatch[1] || "").trim();
    const sets = Number(setMatch[2] || 0);
    if (name) seg.type = name;
    if (Number.isFinite(sets) && sets > 0) seg.sets = sets;
  } else if (roundMatch) {
    const name = String(roundMatch[1] || "").trim();
    const rounds = Number(roundMatch[2] || 0);
    if (name) seg.type = name;
    if (Number.isFinite(rounds) && rounds > 0) {
      seg.sets = rounds;
      seg.notes = seg.notes ? `${seg.notes} · Rounds` : "Rounds";
    }
  }

  const restSec = parseRestSec(detailTail);
  const rpe = parseRpe(detailTail);
  const rir = parseRir(detailTail);

  if (Number.isFinite(restSec) && restSec > 0) seg.restSec = restSec;
  if (Number.isFinite(rpe) && rpe > 0) seg.rpe = rpe;
  if (Number.isFinite(rir) && rir >= 0) seg.rir = rir;

  if (optional) {
    seg.notes = seg.notes ? `Optional · ${seg.notes}` : "Optional";
  }

  return seg;
}

function strengthNotesToSegments(session) {
  const text = String(
    session?.notes || session?.description || session?.summary || ""
  ).trim();
  if (!text) return [];

  const stationName =
    String(session?.title || session?.name || session?.sessionType || "Strength")
      .trim() || "Strength";

  const tokens = text
    .split(/[\n;]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const segments = tokens
    .map((token) => parseStrengthTokenToSegment(token, stationName))
    .filter(Boolean);

  return segments;
}

function normaliseToSegments(session) {
  if (!session || typeof session !== "object") return [];

  const directSegments = Array.isArray(session.segments) ? session.segments : [];
  if (directSegments.length) return directSegments.map((seg) => normaliseCoachStyleStep(seg));

  const directSteps = Array.isArray(session.steps) ? session.steps : [];
  if (directSteps.length) return directSteps.map((seg) => normaliseCoachStyleStep(seg));

  const workoutSteps = Array.isArray(session.workout?.steps) ? session.workout.steps : [];
  if (workoutSteps.length) return workoutSteps.map((seg) => normaliseCoachStyleStep(seg));

  if (Array.isArray(session.blocks)) {
    const fromBlocks = blocksToSegments(session.blocks);
    if (fromBlocks.length) return fromBlocks;
  }

  if (isStrengthLikeSession(session)) {
    const fromNotes = strengthNotesToSegments(session);
    if (fromNotes.length) return fromNotes;
  }

  return [];
}

function classifySegment(seg) {
  if (!seg || typeof seg !== "object") return "main";

  const auxKind = classifyAuxSegmentKind(seg);
  if (auxKind !== "main") return auxKind;

  const base = [
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
    .join(" ")
    .toLowerCase();

  if (
    base.includes("sled") ||
    base.includes("wall ball") ||
    base.includes("burpee") ||
    base.includes("ski") ||
    base.includes("row") ||
    base.includes("farmers carry")
  ) {
    return "hyroxStation";
  }

  if (
    base.includes("float") ||
    base.includes("recover") ||
    base.includes("recovery") ||
    base.includes("jog recovery")
  ) {
    return "rest";
  }

  return "main";
}

function isRepeatBlock(seg) {
  if (!seg || typeof seg !== "object") return false;
  if (seg.isRepeat) return true;

  const t = String(seg.type || seg.stepType || seg.label || "").toLowerCase();
  if (t.includes("repeat")) return true;
  if (t === "repeat") return true;
  if (seg.durationType === "Reps") return true;
  if (Array.isArray(seg.steps) && seg.steps.length && (seg.repeatCount || seg.reps)) return true;

  return false;
}

function getRepeatCount(seg) {
  if (!seg || typeof seg !== "object") return 2;

  const rr = Number(seg.repeatReps ?? seg.repeatCount ?? seg.repeat ?? seg.reps);
  if (Number.isFinite(rr) && rr > 0) return rr;

  if (seg.durationType === "Reps") {
    const dv = Number(seg.durationValue);
    if (Number.isFinite(dv) && dv > 0) return Math.round(dv);
  }

  return 2;
}

function isGenericSegmentLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  const v = raw.toLowerCase();

  if (
    v === "run" ||
    v === "strength" ||
    v === "gym" ||
    v === "main" ||
    v === "step" ||
    v === "block" ||
    v === "work" ||
    v === "exercise" ||
    v === "primary" ||
    v === "accessory"
  ) {
    return true;
  }

  if (v.startsWith("repeat")) return true;
  return false;
}

function hasStrengthPrescription(seg) {
  if (!seg || typeof seg !== "object") return false;
  const kind = classifySegment(seg);
  if (kind === "warmup" || kind === "cooldown" || kind === "rest") return false;
  const sets = Number(seg.sets ?? 0);
  const reps = Number(seg.reps ?? 0);
  const rest = Number(seg.restSec ?? 0);
  const rpe = parseNumericText(seg.rpe);
  const rir = parseNumericText(seg.rir);
  const hasLoad = !!String(seg.load || "").trim() || Number(seg.loadKg ?? 0) > 0;
  const strongStrengthSignals = sets > 0 || reps > 0 || rir != null || hasLoad;
  if (strongStrengthSignals) return true;

  const runLike = hasRunPrescription(seg);
  if (runLike) return false;

  return rest > 0 || rpe != null;
}

function hasRunPrescription(seg) {
  if (!seg || typeof seg !== "object") return false;

  const type = String(seg.type || seg.stepType || seg.label || "").toLowerCase();
  const durationType = String(seg.durationType || "").toLowerCase();
  const targetType = String(seg.targetType || "").toLowerCase();
  const paceKey = String(seg?.target?.paceKey || seg?.pace?.key || "").toLowerCase();
  const hasPaceTarget =
    !!paceKey ||
    Number.isFinite(Number(seg?.target?.paceSecPerKm)) ||
    Number.isFinite(Number(seg?.pace?.secPerKm));
  const hasHrTarget =
    targetType.includes("hr") ||
    Number.isFinite(Number(seg?.targetValue?.minBpm)) ||
    Number.isFinite(Number(seg?.targetValue?.maxBpm));

  if (type === "run") return true;
  if (type.includes("tempo") || type.includes("interval")) return true;
  if (hasPaceTarget || hasHrTarget || targetType.includes("pace")) return true;
  if (durationType === "distance" || durationType === "time") return true;
  if (durationType.includes("distance") || durationType.includes("time")) return true;

  if (Array.isArray(seg.steps) && seg.steps.some((s) => hasRunPrescription(s))) return true;

  return false;
}

function getSegmentTitle(seg) {
  if (!seg) return "Block";

  const label = String(seg.label || "").trim();
  const title = String(seg.title || seg.name || "").trim();
  const type = String(seg.type || seg.stepType || "").trim();
  const station = String(seg.stationName || "").trim();
  const kind = String(seg.kind || "").trim();

  if (hasStrengthPrescription(seg)) {
    if (title && !isGenericSegmentLabel(title)) return title;
    if (type && !isGenericSegmentLabel(type)) return type;
  }

  if (label) return label;
  if (isRepeatBlock(seg)) return `Repeat x${getRepeatCount(seg)}`;
  if (title && !isGenericSegmentLabel(title)) return title;
  if (type && !isGenericSegmentLabel(type)) return type;
  if (station) return station;
  if (kind) return kind;
  if (title) return title;
  if (type) return type;

  return "Block";
}

function formatDistanceKmSmart(kmInput) {
  const km = Number(kmInput);
  if (!Number.isFinite(km) || km <= 0) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  const rounded = km >= 10 ? Number(km.toFixed(0)) : Number(km.toFixed(1));
  return `${String(rounded).replace(/\.0$/, "")} km`;
}

function formatDuration(seg, options = {}) {
  if (!seg || typeof seg !== "object") return null;
  const allowStrengthFallback = options?.allowStrengthFallback !== false;
  const hasGarminStepSchema =
    !!seg.stepType || !!seg.targetType || !!seg.targetValue;

  const dtNew = String(seg.durationType || "").toLowerCase();
  if (dtNew === "time" && seg.durationValue != null) {
    const v = Number(seg.durationValue || 0);
    if (!v) return null;
    if (hasGarminStepSchema) {
      if (v < 180 && Math.abs(v % 60) > 0.01) return `${Math.round(v)} sec`;
      return `${Math.round(v / 60)} min`;
    }
    return `${Math.round(v)} min`;
  }

  if (dtNew === "distance" && seg.durationValue != null) {
    const v = Number(seg.durationValue || 0);
    if (!v) return null;
    const km = hasGarminStepSchema ? v / 1000 : v > 50 ? v / 1000 : v;
    return formatDistanceKmSmart(km);
  }

  if (seg.durationType && seg.durationValue != null) {
    const v = Number(seg.durationValue || 0);
    if (!v) return null;

    switch (seg.durationType) {
      case "Time (min)":
        return `${Math.round(v)} min`;
      case "Distance (km)":
        return formatDistanceKmSmart(v);
      case "Reps":
        return `${Math.round(v)} reps`;
      default:
        break;
    }
  }

  const durMin = Number(seg.durationMin ?? 0);
  const distKm = Number(seg.distanceKm ?? 0);
  const sets = Number(seg.sets ?? 0);
  const reps = Number(seg.reps ?? 0);

  if (durMin > 0 && distKm > 0) return `${Math.round(durMin)} min · ${formatDistanceKmSmart(distKm)}`;
  if (durMin > 0) return `${Math.round(durMin)} min`;
  if (distKm > 0) return formatDistanceKmSmart(distKm);
  if (!allowStrengthFallback) return null;
  if (sets > 0 && reps > 0) return `${sets} × ${reps}`;
  if (reps > 0) return `${reps} reps`;

  return null;
}

function formatPaceFromSecPerKm(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${String(m)}:${String(r).padStart(2, "0")}/km`;
}

function formatPaceKeyLabel(key) {
  const k = String(key || "").trim().toUpperCase();
  if (!k) return null;
  if (k === "EASY") return "Easy";
  if (k === "THRESHOLD") return "Threshold";
  if (k === "RECOVERY") return "Recovery";
  return k;
}

function paceStringToSpeedLabel(str) {
  if (!str) return null;
  const match = String(str).match(/(\d+):(\d+)/);
  if (!match) return null;
  const min = parseInt(match[1], 10);
  const sec = parseInt(match[2], 10);
  const paceMin = min + sec / 60;
  if (!paceMin) return null;
  const speed = 60 / paceMin;
  if (!Number.isFinite(speed)) return null;
  return `${speed.toFixed(1)} km/h`;
}

function formatIntensity(seg) {
  if (!seg || typeof seg !== "object") return null;

  if (seg._treadmillIntensity) return seg._treadmillIntensity;

  if (seg.targetType === "pace_range" && seg.targetValue) {
    const min = Number(seg?.targetValue?.minSecPerKm);
    const max = Number(seg?.targetValue?.maxSecPerKm);
    const minFmt = formatPaceFromSecPerKm(min);
    const maxFmt = formatPaceFromSecPerKm(max);
    if (minFmt && maxFmt) {
      if (minFmt === maxFmt) return `Pace · ${minFmt}`;
      return `Pace · ${minFmt}-${maxFmt}`;
    }
  }

  if (seg?.target?.paceKey) {
    const paceLabel = formatPaceKeyLabel(seg.target.paceKey);
    return paceLabel ? `Pace · ${paceLabel}` : null;
  }

  if (seg.targetType === "hr_range" && seg.targetValue) {
    const min = Number(seg?.targetValue?.minBpm ?? seg?.targetValue?.min);
    const max = Number(seg?.targetValue?.maxBpm ?? seg?.targetValue?.max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return `HR · ${Math.round(min)}-${Math.round(max)} bpm`;
    }
  }

  if (seg?.pace?.secPerKm != null) {
    const pace = formatPaceFromSecPerKm(seg.pace.secPerKm);
    if (pace) return `Pace · ${pace}`;
  }

  if (seg.intensity && typeof seg.intensity === "object") {
    const t = seg.intensity.type;
    const target = seg.intensity.target;
    if (t && target) {
      if (t === "pace") {
        const n = Number(target);
        return Number.isFinite(n) ? `Pace · ${n}s/km` : `Pace · ${String(target)}`;
      }
      return `${String(t)} · ${String(target)}`;
    }
    if (t) return String(t);
  }

  if (seg.intensityType && seg.intensityType !== "None") {
    const type = seg.intensityType;
    const target = seg.intensityTarget || "";
    if (!target) return type;
    return `${type} – ${target}`;
  }

  const rpeNum = Number(seg.rpe);
  const rirNum = Number(seg.rir);
  const rpe =
    Number.isFinite(rpeNum) && rpeNum > 0
      ? `RPE ${Math.round(rpeNum * 10) / 10}`
      : typeof seg.rpe === "string"
      ? seg.rpe
      : null;
  const rir =
    Number.isFinite(rirNum) && rirNum >= 0
      ? `RIR ${Math.round(rirNum * 10) / 10}`
      : typeof seg.rir === "string"
      ? seg.rir
      : null;

  if (seg.intensity && rpe) return `${seg.intensity} · ${rpe}`;
  if (seg.intensity && rir) return `${seg.intensity} · ${rir}`;
  if (seg.intensity) return seg.intensity;
  if (rpe && rir) return `${rpe} · ${rir}`;
  if (rpe) return rpe;
  if (rir) return rir;

  return null;
}

function formatSessionTargetPace(session) {
  const p = session?.targetPace || session?.workout?.paceTarget;
  const min = Number(p?.minSecPerKm);
  const max = Number(p?.maxSecPerKm);
  const minFmt = formatPaceFromSecPerKm(min);
  const maxFmt = formatPaceFromSecPerKm(max);
  return minFmt && maxFmt ? `${minFmt}-${maxFmt}` : null;
}

function formatSessionTargetHr(session) {
  const h = session?.targetHr || session?.workout?.hrTarget;
  const min = Number(h?.minBpm ?? h?.min);
  const max = Number(h?.maxBpm ?? h?.max);
  return Number.isFinite(min) && Number.isFinite(max)
    ? `${Math.round(min)}-${Math.round(max)} bpm`
    : null;
}

function buildExtraMetricChips(seg) {
  if (!seg || typeof seg !== "object") return [];
  const kind = classifySegment(seg);
  if (kind === "warmup" || kind === "cooldown" || kind === "rest") return [];
  const chips = [];

  if (seg.stationName) chips.push(seg.stationName);

  const sets = Number(seg.sets ?? 0);
  const reps = Number(seg.reps ?? seg.repeatCount ?? 0);
  if (sets > 0 && reps > 0) chips.push(`${sets} × ${reps}`);
  else if (reps > 0 && !isRepeatBlock(seg)) chips.push(`${reps} reps`);

  const restSec = Number(seg.restSec ?? 0);
  if (restSec > 0) chips.push(`Rest ${Math.round(restSec)}s`);

  const loadText = String(seg.load || "").trim();
  if (loadText) chips.push(loadText);

  const load = Number(seg.loadKg ?? 0);
  if (load > 0) chips.push(`${load} kg`);

  return chips;
}

function buildStrengthPrescriptionColumns(seg, options = {}) {
  if (!seg || typeof seg !== "object") return [];
  const kind = classifySegment(seg);
  if (kind === "warmup" || kind === "cooldown" || kind === "rest") return [];

  const setsNum = parseNumericText(seg.sets);
  const repsNum = parseNumericText(seg.reps ?? seg.repeatCount);
  const repRange = String(seg.repRange || seg.repsRange || "").trim();
  const rpeNum = parseNumericText(seg.rpe ?? seg.targetRpe);

  const restOverride = String(options?.restOverride || "").trim();
  const restSecRaw = Number(
    seg.restSec ?? seg.restSeconds ?? seg.recoverySec ?? seg.recoverSec ?? 0
  );
  const restText = String(seg.rest || seg.recovery || "").trim();
  const textBlob = [
    seg.rest,
    seg.recovery,
    seg.notes,
    seg.cues,
    seg.title,
    seg.name,
    seg.type,
  ]
    .filter(Boolean)
    .join(" ");
  const restFromText = extractRestSecFromText(textBlob);
  const rpeFromText = extractRpeFromText(textBlob);
  const fallback = getMasonFallbackPrescription(seg, options);

  const restSec =
    Number.isFinite(restSecRaw) && restSecRaw > 0
      ? restSecRaw
      : Number.isFinite(restFromText) && restFromText > 0
      ? restFromText
      : Number.isFinite(Number(fallback?.restSec)) && Number(fallback.restSec) > 0
      ? Number(fallback.restSec)
      : 0;
  const rpeResolved =
    rpeNum != null
      ? rpeNum
      : rpeFromText != null
      ? rpeFromText
      : Number.isFinite(Number(fallback?.rpe)) && Number(fallback.rpe) > 0
      ? Number(fallback.rpe)
      : null;

  const setsValue =
    setsNum != null && setsNum > 0 ? String(Math.round(setsNum)) : "—";
  const repsValue =
    repsNum != null && repsNum > 0
      ? String(Math.round(repsNum))
      : repRange || "—";
  const restValue = restOverride
    ? restOverride
    : Number.isFinite(restSec) && restSec > 0
    ? `${Math.round(restSec)}s`
    : restText || "—";
  const rpeValue =
    rpeResolved != null
      ? Number.isInteger(rpeResolved)
        ? String(rpeResolved)
        : rpeResolved.toFixed(1)
      : "—";

  return [
    { key: "sets", label: "Sets", value: setsValue },
    { key: "reps", label: "Reps", value: repsValue },
    { key: "rest", label: "Rest", value: restValue },
    { key: "rpe", label: "RPE", value: rpeValue },
  ];
}

function getStrengthBlockLabel(seg) {
  if (!seg || typeof seg !== "object") return "Main block";
  const station = String(seg.stationName || "").trim();
  if (station) return station;

  const kind = classifySegment(seg);
  if (kind === "warmup") return "Warm-up";
  if (kind === "cooldown") return "Cool-down";
  if (kind === "rest") return "Recovery";
  return "Main block";
}

function stepBg(kind, theme, options = {}) {
  const strengthLayout = !!options?.strengthLayout;
  if (strengthLayout) {
    return "transparent";
  }

  if (kind === "rest") return theme.muted;
  if (kind === "warmup" || kind === "cooldown") {
    return withHexAlpha(theme.primaryBg, theme.isDark ? "10" : "14");
  }
  if (kind === "hyroxStation" || kind === "main") {
    return withHexAlpha(theme.primaryBg, theme.isDark ? "14" : "1C");
  }
  return theme.card;
}

function stepBorder(kind, theme, options = {}) {
  const strengthLayout = !!options?.strengthLayout;
  if (strengthLayout) {
    return "transparent";
  }

  if (kind === "hyroxStation" || kind === "main") return theme.primaryBorder;
  if (kind === "warmup" || kind === "cooldown") {
    return withHexAlpha(theme.primaryBorder, theme.isDark ? "B3" : "99");
  }
  return theme.border;
}

function rightTagLabel(kind, metaSport, planType) {
  const s = String(metaSport || "").toLowerCase();
  if (kind === "rest") return "RECOVERY";
  if (kind === "hyroxStation") return "STATION";
  if (planType === "strength" || s.includes("strength") || s.includes("gym")) return "GYM";
  if (s.includes("bike")) return "RIDE";
  return "RUN";
}

function convertSegmentsToTreadmill(segments) {
  if (!Array.isArray(segments)) return [];

  return segments.map((seg) => {
    if (!seg || typeof seg !== "object") return seg;

    const clone = { ...seg };

    const baseTarget =
      clone.intensityTarget ||
      clone.intensity ||
      clone.pace ||
      clone.intensity?.target ||
      "";
    const speedLabel = paceStringToSpeedLabel(baseTarget);

    if (speedLabel) {
      clone._treadmillIntensity = `Treadmill ~${speedLabel}`;
    } else if (clone.intensity) {
      clone._treadmillIntensity = `${clone.intensity} (Treadmill)`;
    } else if (clone.intensity?.type) {
      clone._treadmillIntensity = `${clone.intensity.type} (Treadmill)`;
    }

    if (Array.isArray(clone.steps)) {
      clone.steps = convertSegmentsToTreadmill(clone.steps);
    }

    return clone;
  });
}

function buildOverviewLines(segments) {
  if (!Array.isArray(segments) || !segments.length) return [];
  return segments.map((seg) => {
    const kind = classifySegment(seg);
    const title = getSegmentTitle(seg);
    const dur = formatDuration(seg, {
      allowStrengthFallback: kind !== "warmup" && kind !== "cooldown" && kind !== "rest",
    });
    const inten = formatIntensity(seg);

    if (isRepeatBlock(seg) && Array.isArray(seg.steps) && seg.steps.length) {
      const reps = getRepeatCount(seg);
      const innerBits = seg.steps
        .map((s) => {
          const innerKind = classifySegment(s);
          const d = formatDuration(s, {
            allowStrengthFallback:
              innerKind !== "warmup" && innerKind !== "cooldown" && innerKind !== "rest",
          });
          const i = formatIntensity(s);
          if (d && i) return `${d} @ ${i}`;
          if (d) return d;
          if (i) return i;
          return getSegmentTitle(s);
        })
        .filter(Boolean)
        .join(" · ");
      return `Repeat ${reps}×: ${innerBits}${seg.notes ? ` · ${seg.notes}` : ""}`;
    }

    const pieces = [];

    if (kind === "warmup") pieces.push(title || "Warm-up");
    else if (kind === "cooldown") pieces.push(title || "Cool-down");
    else if (kind === "rest") pieces.push("Recovery / rest");
    else pieces.push(title || "Main block");

    if (dur) pieces.push(dur);
    if (inten) pieces.push(inten);
    if (seg.notes) pieces.push(seg.notes);

    return pieces.join(" · ");
  });
}

function buildStrengthOverview(session, meta, weekFocus) {
  const coaching = session?.coaching || {};
  const lines = [];

  if (session?.emphasis) lines.push(`Emphasis: ${session.emphasis}`);
  if (session?.focus || weekFocus) lines.push(`Focus: ${session.focus || weekFocus}`);
  if (meta?.durationMin) lines.push(`Planned duration: ${meta.durationMin} min`);
  if (coaching?.weekPhase) lines.push(`Week phase: ${coaching.weekPhase}`);
  if (coaching?.progressionNote) lines.push(`Progression: ${coaching.progressionNote}`);
  if (coaching?.recoveryTarget) lines.push(`Recovery target: ${coaching.recoveryTarget}`);
  if (coaching?.exerciseStability) lines.push(`Exercise stability: ${coaching.exerciseStability}`);

  return lines;
}

function buildWatchPayload(session, encodedKey, meta, segments, planType) {
  const sport =
    session?.workout?.sport ||
    (planType === "strength" ? "strength" : "run");

  const totalDurationSec =
    session?.workout?.totalDurationSec ||
    (meta?.durationMin ? meta.durationMin * 60 : 0);

  const totalDistanceKm =
    session?.workout?.totalDistanceKm ||
    meta?.distanceKm ||
    0;

  return {
    sessionKey: encodedKey,
    title: session?.title || session?.type || "Session",
    workout: session?.workout || {
      sport,
      totalDurationSec,
      totalDistanceKm,
      steps: Array.isArray(session?.steps) && session.steps.length ? session.steps : segments,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  HERO                                                              */
/* ------------------------------------------------------------------ */

function RunHero({ session, dayLabel, weekIndex, totalWeeks, logBadge, theme }) {
  return (
    <View style={{ height: 360 }}>
      <ImageBackground
        source={require("../../../../../assets/images/run.jpeg")}
        style={{ flex: 1 }}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(0,0,0,0.75)", "rgba(0,0,0,0.9)", "#000000"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ flex: 1 }}
        >
          <View style={st.heroBottomContent}>
            <Text style={st.heroSmallLabel}>
              {dayLabel || "Session"}
              {weekIndex != null
                ? totalWeeks
                  ? ` · Week ${weekIndex + 1}/${totalWeeks}`
                  : ` · Week ${weekIndex + 1}`
                : ""}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Text style={st.heroTitleText}>
                {session?.title || session?.type || "Session"}
              </Text>

              {!!logBadge && (
                <View
                  style={[
                    st.statusPill,
                    logBadge.tone === "good" ? st.statusGood : st.statusBad,
                  ]}
                >
                  <Text style={st.statusPillText}>{logBadge.label}</Text>
                </View>
              )}
            </View>

            {(session?.sessionType || session?.type) && (
              <Text style={st.heroSubtitleText}>
                {(session.sessionType || session.type || "Training") +
                  (session.layout ? ` · ${session.layout}` : "")}
              </Text>
            )}
          </View>

          <LinearGradient
            colors={["transparent", theme.primaryBg, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={st.heroNeonEdge}
          />
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

function StrengthHero({ session, dayLabel, weekIndex, totalWeeks, logBadge, theme }) {
  return (
    <View style={{ height: 320, backgroundColor: "#000000" }}>
      <LinearGradient
        colors={theme.isDark ? ["#0A0D12", "#0B1215", "#000000"] : ["#DDE43A", "#B9C317", "#0F172A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <View style={[st.heroStrengthOverlay, theme.isDark ? null : { backgroundColor: "rgba(0,0,0,0.18)" }]}>
          <View style={st.heroBottomContent}>
            <Text style={st.heroSmallLabel}>
              {dayLabel || "Session"}
              {weekIndex != null
                ? totalWeeks
                  ? ` · Week ${weekIndex + 1}/${totalWeeks}`
                  : ` · Week ${weekIndex + 1}`
                : ""}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Text style={st.heroTitleText}>
                {session?.title || session?.type || "Strength session"}
              </Text>

              {!!logBadge && (
                <View
                  style={[
                    st.statusPill,
                    logBadge.tone === "good" ? st.statusGood : st.statusBad,
                  ]}
                >
                  <Text style={st.statusPillText}>{logBadge.label}</Text>
                </View>
              )}
            </View>

            <Text style={st.heroSubtitleText}>
              {session?.emphasis || session?.focus || session?.sessionType || "Strength"}
            </Text>
          </View>

          <LinearGradient
            colors={["transparent", theme.primaryBg, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={st.heroNeonEdge}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

function SessionStickyHeader({ onBack, theme, insets }) {
  return (
    <View pointerEvents="box-none" style={st.stickyHeaderWrap}>
      <LinearGradient
        pointerEvents="none"
        colors={
          theme.isDark
            ? ["rgba(0,0,0,0.72)", "rgba(0,0,0,0.26)", "transparent"]
            : ["rgba(15,23,42,0.28)", "rgba(15,23,42,0.08)", "transparent"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={st.stickyHeaderFade}
      />

      <View style={[st.stickyHeaderRow, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={st.roundIconBtn}
          activeOpacity={0.85}
        >
          <Feather name="chevron-left" size={20} color="#ffffff" />
        </TouchableOpacity>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity style={st.roundIconBtn} activeOpacity={0.85}>
            <Feather name="heart" size={18} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity style={st.roundIconBtn} activeOpacity={0.85}>
            <Feather name="maximize-2" size={18} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  COMPONENT                                                         */
/* ------------------------------------------------------------------ */

export default function TrainSessionDetail() {
  const theme = useScreenTheme();
  const router = useRouter();
  const { sessionKey } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const currentUid = auth.currentUser?.uid || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [planType, setPlanType] = useState("run");
  const [dayLabel, setDayLabel] = useState("");
  const [weekIndex, setWeekIndex] = useState(null);
  const [weekFocus, setWeekFocus] = useState("");
  const [sendingToWatch, setSendingToWatch] = useState(false);
  const [mode, setMode] = useState("outdoor");
  const [activeTab, setActiveTab] = useState("steps");
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  const [movingSession, setMovingSession] = useState(false);

  const [logLoading, setLogLoading] = useState(true);
  const [sessionLog, setSessionLog] = useState(null);

  const encodedKey = useMemo(
    () => (Array.isArray(sessionKey) ? sessionKey[0] : sessionKey),
    [sessionKey]
  );
  const decodedKey = useMemo(() => decodeSessionKey(encodedKey), [encodedKey]);

  useEffect(() => {
    setMoveSheetOpen(false);
    setMovingSession(false);
  }, [encodedKey]);

  useEffect(() => {
    (async () => {
      try {
        setError("");
        setLoading(true);

        if (!encodedKey) {
          setError("Invalid session link.");
          setLoading(false);
          return;
        }

        const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);

        if (!planId) {
          setError("Invalid session link.");
          setLoading(false);
          return;
        }

        if (!currentUid) {
          setError("Not signed in.");
          setLoading(false);
          return;
        }

        const planDoc = await fetchTrainPlanById(currentUid, planId);
        if (!planDoc) {
          setError("Plan not found.");
          setLoading(false);
          return;
        }

        const { weeks, primaryActivity } = unwrapPlanDoc(planDoc);
        const normalisedWeeks = (Array.isArray(weeks) ? weeks : []).map((w, i) =>
          normaliseWeekForLookup(w, i + 1)
        );

        const week = normalisedWeeks?.[weekIndex];
        const day = week?.days?.[dayIndex];
        let sess = day?.sessions?.[sessionIndex];

        if (!sess && week?.sessions?.length) {
          const daySessions = week.sessions.filter((s) => s.day === (day?.day || ""));
          sess = daySessions[sessionIndex] || week.sessions[sessionIndex] || null;
        }

        if (!sess) {
          setError("Session not found in plan.");
          setLoading(false);
          return;
        }

        const detectedPlanType = classifyPlanType(planDoc, sess);

        setPlan({
          ...planDoc,
          id: planDoc.id || planId,
          primaryActivity: primaryActivity || planDoc?.primaryActivity,
          weeks: normalisedWeeks,
        });
        setSession(sess);
        setPlanType(detectedPlanType);
        setDayLabel(day?.day || sess?.day || "");
        setWeekIndex(weekIndex);
        setWeekFocus(
          week?.focus ||
            week?.phase?.label ||
            week?.targets?.phase ||
            week?.phase ||
            ""
        );
        setLoading(false);
      } catch (e) {
        console.log("[session] load error:", e);
        setError(e?.message || "Could not load session.");
        setLoading(false);
      }
    })();
  }, [currentUid, encodedKey]);

  const loadSessionLog = useCallback(async () => {
    try {
      if (!currentUid || !encodedKey) {
        setSessionLog(null);
        setLogLoading(false);
        return;
      }

      setLogLoading(true);
      const snap = await getDoc(doc(db, "users", currentUid, "sessionLogs", encodedKey));
      setSessionLog(snap.exists() ? snap.data() : null);
    } catch (e) {
      console.log("[session] load log error:", e);
      setSessionLog(null);
    } finally {
      setLogLoading(false);
    }
  }, [currentUid, encodedKey]);

  useFocusEffect(
    useCallback(() => {
      loadSessionLog();
    }, [loadSessionLog])
  );

  const segments = useMemo(() => normaliseToSegments(session), [session]);

  const isStrengthSession = useMemo(() => {
    const hasStrengthSegments =
      Array.isArray(segments) && segments.some((seg) => hasStrengthPrescription(seg));
    const hasRunSegments =
      Array.isArray(segments) && segments.some((seg) => hasRunPrescription(seg));

    const sport = String(
      session?.workout?.sport || session?.sessionType || session?.type || ""
    ).toLowerCase();
    if (sport.includes("strength") || sport.includes("gym") || Array.isArray(session?.blocks)) {
      if (hasRunSegments && !hasStrengthSegments) return false;
      return true;
    }
    if (
      sport.includes("run") ||
      sport.includes("interval") ||
      sport.includes("tempo") ||
      sport.includes("easy") ||
      sport.includes("long")
    ) {
      return false;
    }

    if (hasStrengthSegments && !hasRunSegments) {
      return true;
    }
    if (hasRunSegments && !hasStrengthSegments) {
      return false;
    }

    const titleBlob = [
      session?.title,
      session?.name,
      session?.focus,
      session?.emphasis,
      session?.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|row|lunge|press)\b/.test(
        titleBlob
      )
    ) {
      return true;
    }

    return planType === "strength";
  }, [planType, session, segments]);

  const isRunSession = !isStrengthSession;

  const displayedSegments = useMemo(
    () =>
      !isRunSession || mode === "outdoor"
        ? segments
        : convertSegmentsToTreadmill(segments),
    [segments, mode, isRunSession]
  );

  const meta = useMemo(() => {
    if (!session || typeof session !== "object") {
      return {
        durationMin: null,
        distanceKm: null,
        budgetedDistanceKm: null,
        renderedDistanceKm: null,
        executableDistanceKm: null,
        budgetPrimary: true,
        distanceSemanticsModel: null,
        sport: "training",
      };
    }

    const workout = session.workout || {};
    const metersToKm = (m) => {
      const n = Number(m);
      if (!Number.isFinite(n)) return null;
      return n / 1000;
    };
    const toKm = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Number(n.toFixed(1)) : null;
    };
    const pickKm = (...values) => {
      for (const value of values) {
        if (value == null) continue;
        const km = toKm(value);
        if (km != null) return km;
      }
      return null;
    };

    let durationMin =
      workout.totalDurationSec != null
        ? Math.round(Number(workout.totalDurationSec) / 60)
        : session.targetDurationMin ??
          session.durationMin ??
          session.totalDurationMin ??
          null;

    let budgetedRawDistance =
      session.budgetedDistanceKm ??
      session.plannedDistanceKm ??
      session.computedTotalKm ??
      session.targetDistanceKm ??
      session.distanceKm ??
      session.totalDistanceKm ??
      metersToKm(workout.budgetedEstimatedDistanceMeters) ??
      metersToKm(workout.estimatedDistanceMeters) ??
      workout.totalDistanceKm ??
      null;

    if ((durationMin == null || budgetedRawDistance == null) && Array.isArray(segments)) {
      let segDurMin = 0;
      let segDistKm = 0;

      segments.forEach((seg) => {
        if (!seg || typeof seg !== "object") return;

        const dt = String(seg.durationType || "").toLowerCase();
        const dv = Number(seg.durationValue || 0);

        if (dt === "time" && dv > 0) {
          segDurMin += dv >= 120 ? dv / 60 : dv;
        }

        if (dt === "distance" && dv > 0) {
          segDistKm += dv > 50 ? dv / 1000 : dv;
        }

        const dMin = Number(seg.durationMin || 0);
        const dKm = Number(seg.distanceKm || 0);
        if (dMin > 0) segDurMin += dMin;
        if (dKm > 0) segDistKm += dKm;
      });

      if (durationMin == null && segDurMin > 0) durationMin = Math.round(segDurMin);
      if ((budgetedRawDistance == null || budgetedRawDistance === 0) && segDistKm > 0) {
        budgetedRawDistance = segDistKm;
      }
    }

    const budgetedDistanceKm = pickKm(budgetedRawDistance);
    const renderedDistanceKm = pickKm(
      session.renderedDistanceKm,
      session.renderedComputedTotalKm,
      session.executableDistanceKm,
      session.executableComputedKm,
      workout?.meta?.renderedSessionKm,
      workout?.meta?.executableSessionKm,
      metersToKm(workout.renderedEstimatedDistanceMeters),
      metersToKm(workout.executableEstimatedDistanceMeters),
      budgetedDistanceKm
    );
    const executableDistanceKm = pickKm(
      session.executableDistanceKm,
      session.executableComputedKm,
      workout?.meta?.executableSessionKm,
      metersToKm(workout.executableEstimatedDistanceMeters),
      renderedDistanceKm
    );

    const sportRaw =
      workout.sport ||
      session.sessionType ||
      session.type ||
      plan?.primaryActivity ||
      (isStrengthSession ? "strength" : "run");

    const sport = String(sportRaw).toLowerCase();
    const budgetPrimary =
      session?.distanceSemantics?.budgetPrimary ??
      workout?.meta?.budgetPrimary ??
      true;
    const distanceSemanticsModel =
      session?.distanceSemantics?.model ?? workout?.meta?.distanceSemanticsModel ?? null;

    return {
      durationMin: durationMin != null ? Math.round(durationMin) : null,
      distanceKm: budgetedDistanceKm,
      budgetedDistanceKm,
      renderedDistanceKm,
      executableDistanceKm,
      budgetPrimary,
      distanceSemanticsModel,
      sport,
    };
  }, [session, segments, plan, isStrengthSession]);

  const description = useMemo(() => {
    if (!session || typeof session !== "object") return "";
    return (
      session.description ||
      session.longDescription ||
      session.summary ||
      session.aiSummary ||
      session.workout?.description ||
      session.notes ||
      session.workout?.notes ||
      ""
    );
  }, [session]);

  const overviewLines = useMemo(() => {
    if (isStrengthSession) {
      const base = buildStrengthOverview(session, meta, weekFocus);
      const structural = buildOverviewLines(displayedSegments);
      return [...base, ...structural];
    }
    return buildOverviewLines(displayedSegments);
  }, [displayedSegments, isStrengthSession, session, meta, weekFocus]);

  const totalWeeks = useMemo(() => {
    const data = plan || {};
    const { weeks } = unwrapPlanDoc(data);
    return Array.isArray(weeks) ? weeks.length : null;
  }, [plan]);

  const sessionTargets = useMemo(() => {
    if (!session) return null;

    const warmupMin = Number(session?.warmupMin);
    const cooldownMin = Number(session?.cooldownMin);
    const pace = formatSessionTargetPace(session);
    const hr = formatSessionTargetHr(session);

    return {
      warmupMin: Number.isFinite(warmupMin) && warmupMin > 0 ? Math.round(warmupMin) : null,
      cooldownMin: Number.isFinite(cooldownMin) && cooldownMin > 0 ? Math.round(cooldownMin) : null,
      pace,
      hr,
    };
  }, [session]);

  const logBadge = useMemo(() => {
    const status = String(sessionLog?.status || "").toLowerCase();
    if (status === "completed") return { label: "COMPLETED", tone: "good" };
    if (status === "skipped") return { label: "SKIPPED", tone: "bad" };
    return null;
  }, [sessionLog]);

  const savedTrainSessionId = useMemo(() => {
    const value = String(sessionLog?.lastTrainSessionId || "").trim();
    return value || null;
  }, [sessionLog?.lastTrainSessionId]);

  const canMoveSession = useMemo(
    () => isWritableUserPlanPath(plan?.__path, currentUid),
    [currentUid, plan?.__path]
  );

  const openSavedSession = useCallback(() => {
    if (savedTrainSessionId) {
      router.push(`/train/history/${savedTrainSessionId}`);
      return;
    }
    router.push("/train/history");
  }, [router, savedTrainSessionId]);

  const openMoveSessionSheet = useCallback(() => {
    if (!canMoveSession) {
      Alert.alert(
        "Can't move session",
        "Only sessions from your editable plan can be moved right now."
      );
      return;
    }
    setMoveSheetOpen(true);
  }, [canMoveSession]);

  const statusSummary = useMemo(() => {
    const status = String(sessionLog?.status || "").toLowerCase();
    if (!status) return null;

    const title = status === "skipped" ? "Session skipped" : "Session completed";
    const body = savedTrainSessionId
      ? status === "skipped"
        ? "This planned session has been marked as skipped and linked to history."
        : "This planned session has been completed and linked to your history."
      : status === "skipped"
      ? "This planned session has been marked as skipped."
      : "This planned session has been completed and saved.";

    const note = String(sessionLog?.notes || "").trim();

    return {
      title,
      body,
      note: note || null,
      actionLabel: savedTrainSessionId ? "View saved session" : "Open history",
      tone: status === "skipped" ? "bad" : "good",
    };
  }, [savedTrainSessionId, sessionLog]);

  const chips = useMemo(() => {
    const arr = [];

    if (isStrengthSession) {
      if (session?.emphasis) arr.push(session.emphasis);
      if (session?.focus || weekFocus) arr.push(session.focus || weekFocus);
      if (meta.durationMin) arr.push(`${meta.durationMin} min`);
      if (session?.coaching?.weekPhase) arr.push(session.coaching.weekPhase);
      if (Array.isArray(session?.blocks) && session.blocks.length) {
        arr.push(`${session.blocks.length} blocks`);
      }
      return arr.slice(0, 4);
    }

    const budgetedKm = Number(meta.budgetedDistanceKm);
    const renderedKm = Number(meta.renderedDistanceKm);
    const hasBudgeted = Number.isFinite(budgetedKm) && budgetedKm > 0;
    const hasRendered = Number.isFinite(renderedKm) && renderedKm > 0;
    const sameDistance = hasBudgeted && hasRendered && Math.abs(budgetedKm - renderedKm) < 0.05;

    if (hasBudgeted) arr.push(`Budget ${budgetedKm.toFixed(1)} km`);
    if (hasRendered && !sameDistance) arr.push(`Rendered ${renderedKm.toFixed(1)} km`);
    if (!hasBudgeted && meta.distanceKm) arr.push(`${meta.distanceKm} km`);
    if (meta.durationMin) arr.push(`${meta.durationMin} min`);
    if (meta.sport) arr.push(meta.sport === "run" ? "Running" : meta.sport);
    if (session?.focus || weekFocus) arr.push(session.focus || weekFocus);

    return arr.slice(0, 4);
  }, [meta, session, weekFocus, isStrengthSession]);

  const strengthRenderSummary = useMemo(() => {
    if (!isStrengthSession) return null;
    const rows = Array.isArray(displayedSegments) ? displayedSegments : [];
    if (!rows.length) return null;

    let exerciseCount = 0;
    let estimatedSets = 0;
    let recoveryCount = 0;

    rows.forEach((seg) => {
      const kind = classifySegment(seg);
      if (kind === "rest") {
        recoveryCount += 1;
        return;
      }

      if (kind === "warmup" || kind === "cooldown") return;

      exerciseCount += 1;

      const setCount = parseNumericText(seg?.sets);
      if (setCount != null && setCount > 0) {
        estimatedSets += Math.round(setCount);
        return;
      }

      if (isRepeatBlock(seg)) {
        estimatedSets += getRepeatCount(seg);
        return;
      }

      estimatedSets += 1;
    });

    return {
      exerciseCount,
      estimatedSets,
      recoveryCount,
    };
  }, [displayedSegments, isStrengthSession]);

  const quickActions = useMemo(() => {
    if (isStrengthSession) {
      return [
        {
          key: "blocks",
          icon: "list",
          label: "SESSION\nBLOCKS",
          onPress: () => setActiveTab("steps"),
        },
        {
          key: "about",
          icon: "file-text",
          label: "SESSION\nOVERVIEW",
          onPress: () => setActiveTab("about"),
        },
        {
          key: "move",
          icon: "calendar",
          label: "MOVE\nDAY",
          onPress: openMoveSessionSheet,
        },
        {
          key: "saved",
          icon: savedTrainSessionId ? "arrow-up-right" : "clock",
          label: savedTrainSessionId ? "VIEW\nSAVED" : "VIEW\nHISTORY",
          onPress: openSavedSession,
        },
      ];
    }

    return [
      {
        key: "about",
        icon: "activity",
        label: "SESSION\nOVERVIEW",
        onPress: () => setActiveTab("about"),
      },
      {
        key: "move",
        icon: "calendar",
        label: "MOVE\nDAY",
        onPress: openMoveSessionSheet,
      },
      {
        key: savedTrainSessionId ? "saved" : "link",
        icon: savedTrainSessionId ? "arrow-up-right" : "link",
        label: savedTrainSessionId ? "VIEW\nSAVED" : "LINK\nACTIVITY",
        onPress: savedTrainSessionId
          ? openSavedSession
          : () => {
              router.push(`/train/session/${encodeURIComponent(encodedKey)}/link-activity`);
            },
      },
      {
        key: "skip",
        icon: "skip-forward",
        label: "SKIP\nWORKOUT",
        onPress: () => {
          router.push(`/train/session/${encodeURIComponent(encodedKey)}/complete?status=skipped`);
        },
      },
    ];
  }, [
    encodedKey,
    isStrengthSession,
    openMoveSessionSheet,
    openSavedSession,
    router,
    savedTrainSessionId,
  ]);

  const handleMoveSessionToDay = async (targetDayRaw) => {
    if (!session || !plan?.id || !encodedKey) return;

    if (!currentUid) {
      Alert.alert("Not signed in", "Please sign in and try again.");
      return;
    }

    if (!canMoveSession || !Array.isArray(plan?.__path)) {
      Alert.alert(
        "Can't move session",
        "Only sessions from your editable plan can be moved right now."
      );
      return;
    }

    const targetDay = normaliseDayLabel(targetDayRaw, "Mon");
    const targetDayIndex = DAY_ORDER.indexOf(targetDay);
    if (targetDayIndex < 0) return;

    const fromWeekIndex = Number(decodedKey?.weekIndex || 0);
    const fromDayIndexFromKey = Number(decodedKey?.dayIndex || 0);
    const fromSessionIndexFromKey = Number(decodedKey?.sessionIndex || 0);
    const currentDayIndex =
      fromDayIndexFromKey >= 0 && fromDayIndexFromKey < DAY_ORDER.length
        ? fromDayIndexFromKey
        : DAY_ORDER.indexOf(normaliseDayLabel(dayLabel, "Mon"));

    if (targetDayIndex === currentDayIndex) {
      setMoveSheetOpen(false);
      return;
    }

    setMovingSession(true);
    try {
      const planId = String(decodedKey?.planId || plan?.id || "");
      if (!planId) throw new Error("Invalid plan reference.");

      const sourceWeeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
      const weeks = JSON.parse(JSON.stringify(sourceWeeks));
      const week = weeks[fromWeekIndex];
      if (!week || typeof week !== "object") throw new Error("Week not found.");

      const dayMap = new Map(
        (Array.isArray(week?.days) ? week.days : []).map((d) => [
          normaliseDayLabel(d?.day, "Mon"),
          d,
        ])
      );
      const days = DAY_ORDER.map((d) => {
        const src = dayMap.get(d) || {};
        return {
          ...src,
          day: d,
          sessions: Array.isArray(src?.sessions) ? [...src.sessions] : [],
        };
      });

      const sourceDay = days[currentDayIndex] || { day: DAY_ORDER[currentDayIndex], sessions: [] };
      const targetDayObj = days[targetDayIndex] || { day: DAY_ORDER[targetDayIndex], sessions: [] };

      const sourceSessions = Array.isArray(sourceDay?.sessions) ? [...sourceDay.sessions] : [];
      let sourceSessionIndex = fromSessionIndexFromKey;
      let movedSession = sourceSessions[sourceSessionIndex];

      if (!movedSession) {
        const fallbackIdx = sourceSessions.findIndex((s) => {
          const a = String(s?.title || s?.name || "").trim().toLowerCase();
          const b = String(session?.title || session?.name || "").trim().toLowerCase();
          const ta = String(s?.sessionType || s?.type || "").trim().toLowerCase();
          const tb = String(session?.sessionType || session?.type || "").trim().toLowerCase();
          return a && b && a === b && ta === tb;
        });
        if (fallbackIdx >= 0) {
          sourceSessionIndex = fallbackIdx;
          movedSession = sourceSessions[fallbackIdx];
        }
      }

      if (!movedSession) {
        throw new Error("Session not found at its current day index.");
      }

      sourceSessions.splice(sourceSessionIndex, 1);

      const targetSessions = Array.isArray(targetDayObj?.sessions) ? [...targetDayObj.sessions] : [];
      targetSessions.push({
        ...movedSession,
        day: DAY_ORDER[targetDayIndex],
      });
      const newSessionIndex = targetSessions.length - 1;

      days[currentDayIndex] = {
        ...sourceDay,
        day: DAY_ORDER[currentDayIndex],
        sessions: sourceSessions,
      };
      days[targetDayIndex] = {
        ...targetDayObj,
        day: DAY_ORDER[targetDayIndex],
        sessions: targetSessions,
      };

      weeks[fromWeekIndex] = {
        ...week,
        days,
        sessions: days.flatMap((d) =>
          (Array.isArray(d?.sessions) ? d.sessions : []).map((s) => ({
            ...s,
            day: d.day,
          }))
        ),
      };

      const planRef = doc(db, ...plan.__path);
      const payload = {
        weeks,
        updatedAt: serverTimestamp(),
      };
      if (plan?.plan && typeof plan.plan === "object") {
        payload["plan.weeks"] = weeks;
      }

      await updateDoc(planRef, payload);

      const oldSessionKey = String(encodedKey);
      const newSessionKey = buildSessionKey(
        planId,
        fromWeekIndex,
        targetDayIndex,
        newSessionIndex
      );

      if (newSessionKey !== oldSessionKey) {
        const oldLogRef = doc(db, "users", currentUid, "sessionLogs", oldSessionKey);
        const oldLogSnap = await getDoc(oldLogRef);

        if (oldLogSnap.exists()) {
          const oldLogData = oldLogSnap.data() || {};

          await setDoc(
            doc(db, "users", currentUid, "sessionLogs", newSessionKey),
            {
              ...oldLogData,
              sessionKey: newSessionKey,
              planId,
              weekIndex: fromWeekIndex,
              dayIndex: targetDayIndex,
              sessionIndex: newSessionIndex,
              movedFromSessionKey: oldSessionKey,
              movedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );

          await setDoc(
            oldLogRef,
            {
              movedToSessionKey: newSessionKey,
              movedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      await setDoc(
        doc(db, "users", currentUid, "uiState", "train"),
        {
          lastSessionMove: {
            planId,
            toWeekIndex: fromWeekIndex,
            toDayIndex: targetDayIndex,
            movedFromSessionKey: oldSessionKey,
            movedToSessionKey: newSessionKey,
            movedAt: serverTimestamp(),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setMoveSheetOpen(false);
      router.replace(`/train/session/${encodeURIComponent(newSessionKey)}`);
      Alert.alert("Session moved", `Moved to ${DAY_ORDER[targetDayIndex]}.`);
    } catch (e) {
      Alert.alert("Couldn't move session", e?.message || "Try again.");
    } finally {
      setMovingSession(false);
    }
  };

  const handleSendToWatch = async () => {
    if (!session) return;
    if (isStrengthSession) return;
    try {
      setSendingToWatch(true);
      if (!currentUid) throw new Error("No user");

      const payload = {
        userId: currentUid,
        ...buildWatchPayload(session, encodedKey, meta, displayedSegments, planType),
      };

      const res = await fetch(`${API_URL}/garmin/send-workout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to send workout");
      Alert.alert("Sent to watch", "Workout sent to your watch.");
    } catch (e) {
      console.log("[session] send to watch error:", e);
      Alert.alert("Couldn't send to watch", e?.message || "Try again.");
    } finally {
      setSendingToWatch(false);
    }
  };

  const currentDayIndexForMove = useMemo(() => {
    const fromKey = Number(decodedKey?.dayIndex);
    if (Number.isFinite(fromKey) && fromKey >= 0 && fromKey < DAY_ORDER.length) return fromKey;
    return DAY_ORDER.indexOf(normaliseDayLabel(dayLabel, "Mon"));
  }, [decodedKey?.dayIndex, dayLabel]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: 140,
          backgroundColor: theme.bg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {isStrengthSession ? (
          <StrengthHero
            session={session}
            dayLabel={dayLabel}
            weekIndex={weekIndex}
            totalWeeks={totalWeeks}
            logBadge={!logLoading ? logBadge : null}
            theme={theme}
          />
        ) : (
          <RunHero
            session={session}
            dayLabel={dayLabel}
            weekIndex={weekIndex}
            totalWeeks={totalWeeks}
            logBadge={!logLoading ? logBadge : null}
            theme={theme}
          />
        )}

        <View style={[st.sheet, { backgroundColor: theme.bg }]}>
          <View
            style={[
              st.tabRow,
              {
                backgroundColor: withHexAlpha(theme.card, theme.isDark ? "CC" : "F2"),
                borderColor: withHexAlpha(theme.border, theme.isDark ? "CC" : "B3"),
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => setActiveTab("steps")}
              style={[
                st.tabButton,
                activeTab === "steps" && { backgroundColor: theme.card },
              ]}
            >
              <Text
                style={[
                  st.tabText,
                  { color: activeTab === "steps" ? theme.text : theme.subtext },
                ]}
              >
                {isStrengthSession ? "BLOCKS" : "STEPS"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab("about")}
              style={[
                st.tabButton,
                activeTab === "about" && { backgroundColor: theme.card },
              ]}
            >
              <Text
                style={[
                  st.tabText,
                  { color: activeTab === "about" ? theme.text : theme.subtext },
                ]}
              >
                ABOUT
              </Text>
            </TouchableOpacity>
          </View>

          {session && !loading && !error && (
            <View style={st.quickActionsRow}>
              {quickActions.map((action) => (
                <TouchableOpacity
                  key={action.key}
                  style={st.quickActionItem}
                  activeOpacity={0.85}
                  onPress={action.onPress}
                >
                  <View
                    style={[
                      st.quickActionCircle,
                      {
                        borderColor: withHexAlpha(theme.primaryBorder, theme.isDark ? "A3" : "8F"),
                        backgroundColor: withHexAlpha(theme.card, theme.isDark ? "66" : "E0"),
                      },
                    ]}
                  >
                    <Feather name={action.icon} size={18} color={theme.text} />
                  </View>
                  <Text style={[st.quickActionLabel, { color: theme.subtext }]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!logLoading && statusSummary ? (
            <View
              style={[
                st.statusSummaryCard,
                {
                  borderColor:
                    statusSummary.tone === "good"
                      ? withHexAlpha(theme.primaryBorder, theme.isDark ? "A3" : "7A")
                      : withHexAlpha("#F87171", theme.isDark ? "A3" : "70"),
                  backgroundColor: withHexAlpha(theme.card, theme.isDark ? "D4" : "F2"),
                },
              ]}
            >
              <View style={st.statusSummaryTopRow}>
                <View
                  style={[
                    st.statusSummaryIconWrap,
                    {
                      backgroundColor:
                        statusSummary.tone === "good"
                          ? withHexAlpha(theme.primaryBg, theme.isDark ? "22" : "2E")
                          : "rgba(248,113,113,0.16)",
                    },
                  ]}
                >
                  <Feather
                    name={statusSummary.tone === "good" ? "check-circle" : "skip-forward"}
                    size={18}
                    color={statusSummary.tone === "good" ? theme.primaryBg : "#F87171"}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={[st.statusSummaryEyebrow, { color: theme.subtext }]}>
                    Planned session status
                  </Text>
                  <Text style={[st.statusSummaryTitle, { color: theme.text }]}>
                    {statusSummary.title}
                  </Text>
                  <Text style={[st.statusSummaryBody, { color: theme.subtext }]}>
                    {statusSummary.body}
                  </Text>
                  {statusSummary.note ? (
                    <Text style={[st.statusSummaryNote, { color: theme.text }]}>
                      Notes: {statusSummary.note}
                    </Text>
                  ) : null}
                </View>
              </View>

              <TouchableOpacity
                onPress={openSavedSession}
                style={[st.statusSummaryAction, { borderColor: theme.border }]}
                activeOpacity={0.85}
              >
                <Text style={[st.statusSummaryActionText, { color: theme.text }]}>
                  {statusSummary.actionLabel}
                </Text>
                <Feather name="arrow-up-right" size={14} color={theme.text} />
              </TouchableOpacity>
            </View>
          ) : null}

          {loading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={theme.primaryBg} />
              <Text style={{ color: theme.subtext, marginTop: 6, fontSize: 13 }}>
                Loading session…
              </Text>
            </View>
          ) : error ? (
            <View style={{ paddingVertical: 16 }}>
              <Text style={{ color: "#F87171", fontWeight: "700" }}>{error}</Text>
            </View>
          ) : (
            session && (
              <>
                {activeTab === "about" ? (
                  <View style={{ marginTop: 12, gap: 10 }}>
                    <Text style={[st.aboutTitle, { color: theme.text }]}>Overview</Text>

                    {description ? (
                      <Text style={{ fontSize: 14, lineHeight: 20, color: theme.text }}>
                        {description}
                      </Text>
                    ) : (
                      <Text style={{ fontSize: 14, lineHeight: 20, color: theme.subtext }}>
                        {isStrengthSession
                          ? "No written coaching description for this strength session yet."
                          : "No written description for this session yet."}
                      </Text>
                    )}

                    {chips.length > 0 && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                        {chips.map((chip, idx) => (
                          <View key={idx} style={[st.chip, { backgroundColor: theme.muted }]}>
                            <Text style={[st.chipText, { color: theme.text }]}>{chip}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={[st.metaCard, { backgroundColor: theme.card }]}>
                      {isStrengthSession ? (
                        <>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
                            <View style={{ minWidth: 110 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>DURATION</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {meta.durationMin ? `${meta.durationMin} min` : "—"}
                              </Text>
                            </View>

                            <View style={{ minWidth: 120 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>TARGET</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {session?.targetDurationMin
                                  ? `${session.targetDurationMin} min`
                                  : "—"}
                              </Text>
                            </View>

                            <View style={{ minWidth: 110 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>BLOCKS</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {displayedSegments.length > 0
                                  ? displayedSegments.length
                                  : Array.isArray(session?.blocks)
                                  ? session.blocks.length
                                  : 0}
                              </Text>
                            </View>
                          </View>

                          <View style={{ marginTop: 10 }}>
                            <Text style={[st.metaCardLabel, { color: theme.subtext }]}>FOCUS</Text>
                            <Text style={[st.metaCardValue, { color: theme.text }]}>
                              {session.focus || weekFocus || "General strength"}
                            </Text>
                          </View>

                          {!!session?.emphasis && (
                            <View style={{ marginTop: 10 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>EMPHASIS</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {session.emphasis}
                              </Text>
                            </View>
                          )}

                          {!!session?.coaching?.weekPhase && (
                            <View style={{ marginTop: 10 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>WEEK PHASE</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {session.coaching.weekPhase}
                              </Text>
                            </View>
                          )}

                          {!!session?.coaching?.progressionNote && (
                            <View style={{ marginTop: 10 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>PROGRESSION</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {session.coaching.progressionNote}
                              </Text>
                            </View>
                          )}

                          {!!session?.coaching?.recoveryTarget && (
                            <View style={{ marginTop: 10 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>RECOVERY TARGET</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {session.coaching.recoveryTarget}
                              </Text>
                            </View>
                          )}

                          {!!session?.coaching?.exerciseStability && (
                            <View style={{ marginTop: 10 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>STABILITY</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {session.coaching.exerciseStability}
                              </Text>
                            </View>
                          )}
                        </>
                      ) : (
                        <>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
                            <View style={{ minWidth: 96 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>DURATION</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {meta.durationMin ? `${meta.durationMin} min` : "—"}
                              </Text>
                            </View>
                            <View style={{ minWidth: 120 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>
                                BUDGETED DISTANCE
                              </Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {meta.budgetedDistanceKm != null ? `${meta.budgetedDistanceKm} km` : "—"}
                              </Text>
                            </View>
                            <View style={{ minWidth: 120 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>
                                RENDERED DISTANCE
                              </Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {meta.renderedDistanceKm != null ? `${meta.renderedDistanceKm} km` : "—"}
                              </Text>
                            </View>
                          </View>

                          {meta.budgetedDistanceKm != null &&
                            meta.renderedDistanceKm != null &&
                            Math.abs(meta.budgetedDistanceKm - meta.renderedDistanceKm) > 0.05 && (
                              <Text
                                style={{
                                  marginTop: 8,
                                  fontSize: 12,
                                  lineHeight: 16,
                                  color: theme.subtext,
                                }}
                              >
                                Budgeted distance drives weekly plan totals. Rendered distance is the full
                                executable workout footprint.
                              </Text>
                            )}

                          <View style={{ marginTop: 10 }}>
                            <Text style={[st.metaCardLabel, { color: theme.subtext }]}>FOCUS</Text>
                            <Text style={[st.metaCardValue, { color: theme.text }]}>
                              {session.focus || weekFocus || "General training"}
                            </Text>
                          </View>

                          {(sessionTargets?.warmupMin ||
                            sessionTargets?.cooldownMin ||
                            sessionTargets?.pace ||
                            sessionTargets?.hr) && (
                            <View style={{ marginTop: 10 }}>
                              <Text style={[st.metaCardLabel, { color: theme.subtext }]}>TARGETS</Text>
                              <Text style={[st.metaCardValue, { color: theme.text }]}>
                                {sessionTargets?.warmupMin
                                  ? `WU ${sessionTargets.warmupMin}m`
                                  : "WU —"}
                                {" · "}
                                {sessionTargets?.cooldownMin
                                  ? `CD ${sessionTargets.cooldownMin}m`
                                  : "CD —"}
                                {sessionTargets?.pace ? ` · Pace ${sessionTargets.pace}` : ""}
                                {sessionTargets?.hr ? ` · HR ${sessionTargets.hr}` : ""}
                              </Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>

                    {overviewLines.length > 0 && (
                      <View style={{ marginTop: 10 }}>
                        <Text style={[st.aboutTitle, { color: theme.text }]}>
                          {isStrengthSession ? "Structure + coaching" : "Structure"}
                        </Text>
                        {overviewLines.map((line, idx) => (
                          <View key={idx} style={{ flexDirection: "row", gap: 6, marginTop: idx === 0 ? 4 : 6 }}>
                            <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 1 }}>
                              {idx + 1}.
                            </Text>
                            <Text style={{ color: theme.text, fontSize: 13, lineHeight: 18, flex: 1 }}>
                              {line}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={{ marginTop: 14 }}>
                    <View style={st.stepsHeaderRow}>
                      <Text style={[st.aboutTitle, { color: theme.text }]}>
                        {isStrengthSession ? "Strength Session Builder" : "Run Session Flow"}
                      </Text>

                      {isRunSession ? (
                        <View style={[st.modeToggleWrapper, { backgroundColor: theme.muted }]}>
                          <TouchableOpacity
                            onPress={() => setMode("outdoor")}
                            style={[
                              st.modeToggleBtn,
                              mode === "outdoor" && { backgroundColor: theme.primaryBg },
                            ]}
                            activeOpacity={0.85}
                          >
                            <Text
                              style={[
                                st.modeToggleText,
                                { color: mode === "outdoor" ? theme.primaryText : theme.subtext },
                              ]}
                            >
                              OUTDOOR
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => setMode("treadmill")}
                            style={[
                              st.modeToggleBtn,
                              mode === "treadmill" && { backgroundColor: theme.primaryBg },
                            ]}
                            activeOpacity={0.85}
                          >
                            <Text
                              style={[
                                st.modeToggleText,
                                { color: mode === "treadmill" ? theme.primaryText : theme.subtext },
                              ]}
                            >
                              TREADMILL
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View
                          style={[
                            st.strengthLayoutBadge,
                            {
                              borderColor: theme.border,
                              backgroundColor: withHexAlpha(theme.card, theme.isDark ? "9E" : "EC"),
                            },
                          ]}
                        >
                          <Text style={[st.strengthLayoutBadgeText, { color: theme.subtext }]}>
                            STRENGTH TABLE
                          </Text>
                        </View>
                      )}
                    </View>

                    {isStrengthSession && strengthRenderSummary ? (
                      <View style={st.strengthSummaryRow}>
                        <View
                          style={[
                            st.strengthSummaryCard,
                            { borderColor: theme.border, backgroundColor: withHexAlpha(theme.card, theme.isDark ? "8F" : "E8") },
                          ]}
                        >
                          <Text style={[st.strengthSummaryValue, { color: theme.text }]}>
                            {strengthRenderSummary.exerciseCount}
                          </Text>
                          <Text style={[st.strengthSummaryLabel, { color: theme.subtext }]}>
                            Exercises
                          </Text>
                        </View>

                        <View
                          style={[
                            st.strengthSummaryCard,
                            { borderColor: theme.border, backgroundColor: withHexAlpha(theme.card, theme.isDark ? "8F" : "E8") },
                          ]}
                        >
                          <Text style={[st.strengthSummaryValue, { color: theme.text }]}>
                            {strengthRenderSummary.estimatedSets}
                          </Text>
                          <Text style={[st.strengthSummaryLabel, { color: theme.subtext }]}>
                            Est. Sets
                          </Text>
                        </View>

                        <View
                          style={[
                            st.strengthSummaryCard,
                            { borderColor: theme.border, backgroundColor: withHexAlpha(theme.card, theme.isDark ? "8F" : "E8") },
                          ]}
                        >
                          <Text style={[st.strengthSummaryValue, { color: theme.text }]}>
                            {strengthRenderSummary.recoveryCount}
                          </Text>
                          <Text style={[st.strengthSummaryLabel, { color: theme.subtext }]}>
                            Recovery
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    {displayedSegments.length === 0 ? (
                      <Text style={{ color: theme.subtext, marginTop: 8, fontSize: 13 }}>
                        {isStrengthSession
                          ? "No detailed blocks — follow coaching notes / target duration."
                          : "No detailed steps — follow notes / target duration."}
                      </Text>
                    ) : (
                      <View
                        style={[
                          {
                            gap: isStrengthSession ? 8 : 12,
                            marginTop: isStrengthSession ? 8 : 10,
                          },
                          isStrengthSession ? st.strengthStepsList : st.runStepsList,
                        ]}
                      >
                        {isStrengthSession ? (
                          <View
                            style={[
                              st.strengthTableHeaderRow,
                              { borderColor: theme.border, backgroundColor: withHexAlpha(theme.card, theme.isDark ? "A8" : "F2") },
                            ]}
                          >
                            <View style={st.strengthTableHeaderExercise}>
                              <Text style={[st.strengthTableHeaderText, { color: theme.subtext }]}>
                                Exercise
                              </Text>
                            </View>
                            <View style={st.strengthTableHeaderMetrics}>
                              {["Sets", "Reps", "Rest", "RPE"].map((label, idx) => (
                                <View
                                  key={`strength-head-${label}`}
                                  style={[
                                    st.strengthTableHeaderMetric,
                                    {
                                      borderLeftWidth: idx > 0 ? StyleSheet.hairlineWidth : 0,
                                      borderLeftColor: withHexAlpha(theme.border, theme.isDark ? "CC" : "A8"),
                                    },
                                  ]}
                                >
                                  <Text style={[st.strengthTableHeaderText, { color: theme.subtext }]}>
                                    {label}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        ) : null}

                        <View
                          style={
                            isStrengthSession
                              ? [
                                  st.strengthUnifiedList,
                                  {
                                    borderColor: withHexAlpha(theme.border, theme.isDark ? "C9" : "A8"),
                                    backgroundColor: withHexAlpha(theme.card, theme.isDark ? "94" : "EE"),
                                  },
                                ]
                              : null
                          }
                        >
                          {displayedSegments.map((seg, i) => {
                          const kind = classifySegment(seg);
                          const baseTag = rightTagLabel(kind, meta.sport, planType);
                          const isStrengthAuxKind =
                            kind === "warmup" || kind === "cooldown" || kind === "rest";
                          const strengthBlockLabel = isStrengthSession
                            ? getStrengthBlockLabel(seg)
                            : "";
                          const prevStrengthBlockLabel =
                            isStrengthSession && i > 0
                              ? getStrengthBlockLabel(displayedSegments[i - 1])
                              : "";
                          const showStrengthBlockHeader =
                            isStrengthSession &&
                            !!strengthBlockLabel &&
                            strengthBlockLabel !== prevStrengthBlockLabel;

                          if (isRepeatBlock(seg) && Array.isArray(seg.steps)) {
                            const inner = seg.steps || [];

                            const workStep =
                              inner.find((s) => classifySegment(s) !== "rest") || inner[0];
                            const restStep =
                              inner.find((s) => classifySegment(s) === "rest") ||
                              inner.find((s) => {
                                const t = [
                                  s?.title,
                                  s?.name,
                                  s?.label,
                                  s?.stepType,
                                  s?.type,
                                  s?.notes,
                                  s?.target?.paceKey,
                                ]
                                  .filter(Boolean)
                                  .join(" ")
                                  .toLowerCase();
                                return t.includes("rest") || t.includes("recover") || t.includes("float");
                              });

                            const reps = getRepeatCount(seg);
                            const workKind = classifySegment(workStep);

                            const workDur = formatDuration(workStep, {
                              allowStrengthFallback:
                                workKind !== "warmup" &&
                                workKind !== "cooldown" &&
                                workKind !== "rest",
                            });
                            const workInt = formatIntensity(workStep);
                            const workTitle = getSegmentTitle(workStep);
                            const workDetailLine = [workDur, workInt].filter(Boolean).join(" · ");
                            const leadWithWorkTitle = hasStrengthPrescription(workStep);
                            const useWorkTitle =
                              !!workTitle && !isGenericSegmentLabel(workTitle);

                            const workMainLine =
                              workStep?.mainText ||
                              (leadWithWorkTitle
                                ? [workTitle, workDetailLine].filter(Boolean).join(" · ")
                                : [useWorkTitle ? workTitle : "", workDetailLine]
                                    .filter(Boolean)
                                    .join(" · ") || workDetailLine || workTitle);
                            const repeatPrimaryText = workDur ? `${reps} x ${workDur}` : `Repeat x${reps}`;
                            const repeatSecondaryText = [useWorkTitle ? workTitle : "", workInt]
                              .filter(Boolean)
                              .join(" · ");

                            const workSecondaryLine = workStep?.notes || seg?.notes || "";

                            const restDur = restStep
                              ? formatDuration(restStep, { allowStrengthFallback: false })
                              : null;
                            const restInt = restStep ? formatIntensity(restStep) : null;
                            const restTitleRaw = restStep ? getSegmentTitle(restStep) : "";
                            const restTitle =
                              restTitleRaw && !isGenericSegmentLabel(restTitleRaw)
                                ? restTitleRaw
                                : "Recovery";

                            const restBase =
                              restDur || restInt
                                ? [restDur, restInt].filter(Boolean).join(" · ")
                                : "Rest";

                            const restText = restStep
                              ? restStep.notes
                                ? `${restTitle} · ${restBase} – ${restStep.notes}`
                                : `${restTitle} · ${restBase}`
                              : null;
                            const workPrescriptionColumns = isStrengthSession
                              ? buildStrengthPrescriptionColumns(workStep, {
                                  restOverride: restDur || "",
                                  sessionTitle: session?.title || session?.name || "",
                                  planName: plan?.name || plan?.meta?.name || "",
                                  coachName: plan?.coachName || plan?.meta?.coachName || "",
                                })
                              : [];
                            const repeatBgStart = isStrengthSession
                              ? withHexAlpha(theme.card, theme.isDark ? "F2" : "EE")
                              : withHexAlpha(theme.primaryBg, theme.isDark ? "F2" : "E8");
                            const repeatBgEnd = isStrengthSession
                              ? withHexAlpha(theme.card, theme.isDark ? "D6" : "D8")
                              : withHexAlpha(theme.primaryBg, theme.isDark ? "C9" : "CC");
                            const repeatBodyBg = isStrengthSession
                              ? withHexAlpha(theme.card, theme.isDark ? "B8" : "F6")
                              : withHexAlpha(theme.primaryBg, theme.isDark ? "12" : "18");
                            const repeatBorder = isStrengthSession
                              ? withHexAlpha(theme.border, theme.isDark ? "CC" : "A8")
                              : withHexAlpha(theme.primaryBg, theme.isDark ? "66" : "6E");
                            const repeatSubTextColor = isStrengthSession
                              ? withHexAlpha(theme.text, theme.isDark ? "BF" : "9E")
                              : withHexAlpha(theme.primaryText, "D6");

                            return (
                              <View key={i} style={{ gap: isStrengthSession ? 0 : 8 }}>
                                {showStrengthBlockHeader ? (
                                  <View
                                    style={[
                                      st.strengthBlockHeader,
                                      isStrengthSession ? st.strengthBlockHeaderInline : null,
                                      {
                                        borderColor: theme.border,
                                        backgroundColor: isStrengthSession ? "transparent" : theme.card,
                                      },
                                    ]}
                                  >
                                    <Text style={[st.strengthBlockOverline, { color: theme.subtext }]}>
                                      Block
                                    </Text>
                                    <Text style={[st.strengthBlockTitle, { color: theme.text }]}>
                                      {strengthBlockLabel}
                                    </Text>
                                  </View>
                                ) : null}

                                <View style={[st.repeatWrapper, isStrengthSession ? st.repeatWrapperStrength : null]}>
                                  <LinearGradient
                                    colors={[repeatBgStart, repeatBgEnd]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    style={st.repeatHeader}
                                  >
                                    <View style={st.repeatHeaderLeft}>
                                      <Feather
                                        name={isStrengthSession ? "list" : "repeat"}
                                        size={14}
                                        color={isStrengthSession ? theme.text : theme.primaryText}
                                      />
                                      <Text
                                        style={[
                                          st.repeatHeaderText,
                                          { color: isStrengthSession ? theme.text : theme.primaryText },
                                        ]}
                                      >
                                        {repeatPrimaryText}
                                      </Text>
                                    </View>
                                    {!!repeatSecondaryText && (
                                      <Text style={[st.repeatHeaderSubText, { color: repeatSubTextColor }]}>
                                        {repeatSecondaryText}
                                      </Text>
                                    )}
                                  </LinearGradient>

                                  <View
                                    style={[
                                      st.stepCard,
                                      isStrengthSession ? st.stepCardStrength : null,
                                      st.stepCardRepeat,
                                      isStrengthSession && i > 0
                                        ? {
                                            borderTopWidth: StyleSheet.hairlineWidth,
                                            borderTopColor: withHexAlpha(
                                              theme.border,
                                              theme.isDark ? "9E" : "8F"
                                            ),
                                          }
                                        : null,
                                      { backgroundColor: repeatBodyBg, borderColor: repeatBorder },
                                    ]}
                                  >
                                    <View style={st.stepIndexColRepeat}>
                                      <Text style={[st.stepIndex, { color: theme.text }]}>{i + 1}</Text>
                                      <View style={[st.stepIndexDivider, { backgroundColor: theme.border }]} />
                                    </View>

                                    <View style={{ flex: 1, gap: 4 }}>
                                      {isStrengthSession ? (
                                        <>
                                          <View style={st.strengthTableRow}>
                                            <View style={st.strengthTableExerciseCell}>
                                              {!!workMainLine && (
                                                <Text style={[st.stepMainText, { color: theme.text }]}>
                                                  {workMainLine}
                                                </Text>
                                              )}
                                              {!!workSecondaryLine && (
                                                <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                                  {workSecondaryLine}
                                                </Text>
                                              )}
                                            </View>

                                            <View style={st.strengthTableMetricsWrap}>
                                              {workPrescriptionColumns.map((item, metricIdx) => (
                                                <View
                                                  key={`repeat-${i}-${item.key}`}
                                                  style={[
                                                    st.strengthTableMetricCol,
                                                    {
                                                      backgroundColor: withHexAlpha(theme.bg, theme.isDark ? "78" : "EE"),
                                                      borderLeftWidth: metricIdx > 0 ? StyleSheet.hairlineWidth : 0,
                                                      borderLeftColor: withHexAlpha(theme.border, theme.isDark ? "CC" : "A8"),
                                                    },
                                                  ]}
                                                >
                                                  <Text style={[st.strengthTableMetricLabel, { color: theme.subtext }]}>
                                                    {item.label}
                                                  </Text>
                                                  <Text style={[st.strengthTableMetricValue, { color: theme.text }]}>
                                                    {item.value}
                                                  </Text>
                                                </View>
                                              ))}
                                            </View>
                                          </View>

                                          {!!restText && (
                                            <Text style={[st.repeatRestText, { color: theme.text }]}>
                                              {restText}
                                            </Text>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          {!!workMainLine && (
                                            <Text style={[st.stepMainText, { color: theme.text }]}>
                                              {workMainLine}
                                            </Text>
                                          )}
                                          {!!workSecondaryLine && (
                                            <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                              {workSecondaryLine}
                                            </Text>
                                          )}
                                          {!!restText && (
                                            <Text style={[st.repeatRestText, { color: theme.text }]}>{restText}</Text>
                                          )}
                                        </>
                                      )}
                                    </View>

                                    {!isStrengthSession ? (
                                      <View style={st.repeatRightCol}>
                                        <View style={st.repeatTagRow}>
                                          <Feather name="activity" size={12} color={theme.text} />
                                          <Text style={[st.stepRightTagTextLight, { color: theme.text }]}>{baseTag}</Text>
                                        </View>
                                        {restStep && (
                                          <Text style={[st.stepRightTagTextLight, { marginTop: 8, opacity: 0.9, color: theme.subtext }]}>
                                            RECOVERY
                                          </Text>
                                        )}
                                      </View>
                                    ) : null}
                                  </View>
                                </View>
                              </View>
                            );
                          }

                          const durLabel = formatDuration(seg, {
                            allowStrengthFallback:
                              kind !== "warmup" && kind !== "cooldown" && kind !== "rest",
                          });
                          const intenLabel = formatIntensity(seg);
                          const extraChips = buildExtraMetricChips(seg);
                          const segTitle = getSegmentTitle(seg);
                          const detailLine = [durLabel, intenLabel].filter(Boolean).join(" · ");
                          const leadWithTitle = hasStrengthPrescription(seg);
                          const useRunTitle =
                            !isStrengthSession &&
                            !!segTitle &&
                            !isGenericSegmentLabel(segTitle);

                          const kindLabel =
                            kind === "warmup"
                              ? "Warm-Up"
                              : kind === "cooldown"
                              ? "Cool Down"
                              : kind === "rest"
                              ? "Rest"
                              : kind === "hyroxStation"
                              ? "Station"
                              : baseTag === "GYM"
                              ? "Strength"
                              : baseTag === "RIDE"
                              ? "Ride"
                              : "Run";
                          const runTitleLine = !isStrengthSession
                            ? useRunTitle
                              ? segTitle
                              : kindLabel
                            : "";
                          const runDetailLine = !isStrengthSession ? detailLine : "";
                          const strengthPrescription = [durLabel, intenLabel].filter(Boolean).join(" · ");
                          const strengthPrescriptionColumns =
                            isStrengthSession && !isStrengthAuxKind
                              ? buildStrengthPrescriptionColumns(seg, {
                                  sessionTitle: session?.title || session?.name || "",
                                  planName: plan?.name || plan?.meta?.name || "",
                                  coachName: plan?.coachName || plan?.meta?.coachName || "",
                                })
                              : [];

                          const secondaryLine = seg.notes || "";
                          const showStrengthTableRow =
                            isStrengthSession && !isStrengthAuxKind && strengthPrescriptionColumns.length > 0;

                          return (
                            <View key={i} style={{ gap: isStrengthSession ? 0 : 8 }}>
                              {showStrengthBlockHeader ? (
                                <View
                                  style={[
                                    st.strengthBlockHeader,
                                    isStrengthSession ? st.strengthBlockHeaderInline : null,
                                    {
                                      borderColor: theme.border,
                                      backgroundColor: isStrengthSession ? "transparent" : theme.card,
                                    },
                                  ]}
                                >
                                  <Text style={[st.strengthBlockOverline, { color: theme.subtext }]}>
                                    Block
                                  </Text>
                                  <Text style={[st.strengthBlockTitle, { color: theme.text }]}>
                                    {strengthBlockLabel}
                                  </Text>
                                </View>
                              ) : null}

                              <View
                                style={[
                                  st.stepCard,
                                  isStrengthSession ? st.stepCardStrength : null,
                                  isStrengthSession && i > 0
                                    ? {
                                        borderTopWidth: StyleSheet.hairlineWidth,
                                        borderTopColor: withHexAlpha(
                                          theme.border,
                                          theme.isDark ? "9E" : "8F"
                                        ),
                                      }
                                    : null,
                                  {
                                    backgroundColor: stepBg(kind, theme, {
                                      strengthLayout: isStrengthSession,
                                    }),
                                    borderColor: stepBorder(kind, theme, {
                                      strengthLayout: isStrengthSession,
                                    }),
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    st.stepIndexCol,
                                    showStrengthTableRow ? st.stepIndexColStrength : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      st.stepIndex,
                                      { color: theme.text },
                                      showStrengthTableRow ? st.stepIndexStrength : null,
                                    ]}
                                  >
                                    {i + 1}
                                  </Text>
                                </View>

                                <View
                                  style={[
                                    { flex: 1, gap: 2 },
                                    showStrengthTableRow ? st.strengthExerciseRowContent : null,
                                  ]}
                                >
                                  {!showStrengthTableRow ? (
                                    <Text style={[st.stepHeader, { color: theme.subtext }]}>
                                      {isStrengthSession && !isStrengthAuxKind ? "Exercise" : kindLabel}
                                    </Text>
                                  ) : null}

                                  {isStrengthSession && !isStrengthAuxKind ? (
                                    <>
                                      {showStrengthTableRow ? (
                                        <View style={st.strengthTableRow}>
                                          <View style={st.strengthTableExerciseCell}>
                                              {!!segTitle && (
                                              <Text
                                                style={[
                                                  st.stepMainText,
                                                  st.strengthExerciseTitle,
                                                  { color: theme.text },
                                                ]}
                                              >
                                                {segTitle}
                                              </Text>
                                            )}
                                            {!!secondaryLine && (
                                              <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                                {secondaryLine}
                                              </Text>
                                            )}
                                          </View>

                                          <View style={st.strengthTableMetricsWrap}>
                                            {strengthPrescriptionColumns.map((item, metricIdx) => (
                                              <View
                                                key={`${i}-strength-col-${item.key}`}
                                                style={[
                                                  st.strengthTableMetricCol,
                                                  {
                                                    backgroundColor: withHexAlpha(theme.bg, theme.isDark ? "75" : "EC"),
                                                    borderLeftWidth: metricIdx > 0 ? StyleSheet.hairlineWidth : 0,
                                                    borderLeftColor: withHexAlpha(theme.border, theme.isDark ? "CC" : "A8"),
                                                  },
                                                ]}
                                              >
                                                <Text style={[st.strengthTableMetricLabel, { color: theme.subtext }]}>
                                                  {item.label}
                                                </Text>
                                                <Text style={[st.strengthTableMetricValue, { color: theme.text }]}>
                                                  {item.value}
                                                </Text>
                                              </View>
                                            ))}
                                          </View>
                                        </View>
                                      ) : (
                                        <>
                                          {!!segTitle && (
                                            <Text style={[st.stepMainText, { color: theme.text }]}>
                                              {segTitle}
                                            </Text>
                                          )}
                                          {!!strengthPrescription && (
                                            <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                              Prescription · {strengthPrescription}
                                            </Text>
                                          )}
                                          {!!secondaryLine && (
                                            <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                              {secondaryLine}
                                            </Text>
                                          )}
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      {!!runTitleLine && (
                                        <Text style={[st.stepMainText, { color: theme.text }]}>{runTitleLine}</Text>
                                      )}
                                      {!!runDetailLine && (
                                        <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                          {runDetailLine}
                                        </Text>
                                      )}
                                      {!!secondaryLine && (
                                        <Text style={[st.stepSecondaryText, { color: theme.subtext }]}>
                                          {secondaryLine}
                                        </Text>
                                      )}
                                    </>
                                  )}

                                  {extraChips.length > 0 && !showStrengthTableRow && (
                                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                                      {extraChips.map((chip, idx) => (
                                        <View
                                          key={`${i}-chip-${idx}`}
                                          style={[st.metaChip, { backgroundColor: theme.bg }]}
                                        >
                                          <Text style={{ fontSize: 11, color: theme.text, fontWeight: "600" }}>
                                            {chip}
                                          </Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}
                                </View>

                                {!showStrengthTableRow ? (
                                  <View style={st.stepRightTag}>
                                    <Text style={[st.stepRightTagText, { color: theme.subtext }]}>{baseTag}</Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>
                          );
                        })}
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </>
            )
          )}
        </View>
      </ScrollView>

      <SessionStickyHeader onBack={() => router.back()} theme={theme} insets={insets} />

      <Modal
        visible={moveSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !movingSession && setMoveSheetOpen(false)}
      >
        <Pressable
          style={st.moveModalBackdrop}
          onPress={() => {
            if (!movingSession) setMoveSheetOpen(false);
          }}
        >
          <Pressable
            style={[st.moveModalCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => {}}
          >
            <Text style={[st.moveModalTitle, { color: theme.text }]}>Move Session</Text>
            <Text style={[st.moveModalSubtitle, { color: theme.subtext }]}>
              Choose a new day for this session in the current week.
            </Text>

            <View style={st.moveDayGrid}>
              {DAY_ORDER.map((day, idx) => {
                const isCurrent = idx === currentDayIndexForMove;
                const disabled = isCurrent || movingSession;

                return (
                  <TouchableOpacity
                    key={`move-${day}`}
                    disabled={disabled}
                    onPress={() => handleMoveSessionToDay(day)}
                    style={[
                      st.moveDayBtn,
                      {
                        borderColor: isCurrent ? theme.primaryBorder : theme.border,
                        backgroundColor: isCurrent
                          ? withHexAlpha(theme.primaryBg, theme.isDark ? "1F" : "33")
                          : theme.bg,
                        opacity: disabled ? 0.65 : 1,
                      },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text style={[st.moveDayBtnText, { color: theme.text }]}>{day}</Text>
                    {isCurrent ? (
                      <Text style={[st.moveDayBtnSub, { color: theme.subtext }]}>Current</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              onPress={() => setMoveSheetOpen(false)}
              disabled={movingSession}
              style={[st.moveCancelBtn, { borderColor: theme.border }]}
              activeOpacity={0.85}
            >
              <Text style={[st.moveCancelText, { color: theme.text }]}>
                {movingSession ? "Moving..." : "Cancel"}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {session && !loading && !error && (
        <View
          style={[
            st.bottomBar,
            {
              paddingBottom: (insets.bottom || 16) + 8,
              backgroundColor: withHexAlpha(theme.bg, theme.isDark ? "F2" : "F7"),
              borderTopColor: withHexAlpha(theme.border, theme.isDark ? "A3" : "BF"),
            },
          ]}
        >
          <View style={st.bottomButtonsRow}>
            {isStrengthSession ? (
              <>
                <TouchableOpacity
                  onPress={() =>
                    router.push(`/train/session/${encodeURIComponent(encodedKey)}/log-strength`)
                  }
                  style={[st.bottomPrimaryBtn, { backgroundColor: theme.primaryBg }]}
                  activeOpacity={0.9}
                >
                  <Feather name="check-circle" size={18} color={theme.primaryText} />
                  <Text style={st.bottomPrimaryText}>
                    {sessionLog?.status ? "Edit Log" : "Log Session"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    router.push(`/train/session/${encodeURIComponent(encodedKey)}/link-activity`)
                  }
                  style={[st.bottomSecondaryBtn, { borderColor: theme.border }]}
                  activeOpacity={0.85}
                >
                  <Feather name="link" size={16} color={theme.text} />
                  <Text style={[st.bottomSecondaryText, { color: theme.text }]}>Link</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() =>
                    router.push(
                      `/train/session/${encodeURIComponent(encodedKey)}/log-strength?status=skipped`
                    )
                  }
                  style={[st.bottomSecondaryBtn, { borderColor: theme.border }]}
                  activeOpacity={0.85}
                >
                  <Feather name="skip-forward" size={16} color={theme.text} />
                  <Text style={[st.bottomSecondaryText, { color: theme.text }]}>Skip</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => router.push(`/train/session/${encodeURIComponent(encodedKey)}/live`)}
                  style={[st.bottomPrimaryBtn, { backgroundColor: theme.primaryBg }]}
                  activeOpacity={0.9}
                >
                  <Feather name="play-circle" size={18} color={theme.primaryText} />
                  <Text style={st.bottomPrimaryText}>Start</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSendToWatch}
                  disabled={sendingToWatch}
                  style={[
                    st.bottomSecondaryBtn,
                    { borderColor: theme.border, opacity: sendingToWatch ? 0.6 : 1 },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="watch" size={16} color={theme.text} />
                  <Text style={[st.bottomSecondaryText, { color: theme.text }]}>
                    {sendingToWatch ? "Sending…" : "Watch"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.push(`/train/session/${encodeURIComponent(encodedKey)}/complete`)}
                  style={[st.bottomSecondaryBtn, { borderColor: theme.border }]}
                  activeOpacity={0.85}
                >
                  <Feather name="check-circle" size={16} color={theme.text} />
                  <Text style={[st.bottomSecondaryText, { color: theme.text }]}>
                    {sessionLog?.status ? "Edit Log" : "Log"}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  STYLES                                                            */
/* ------------------------------------------------------------------ */

const st = StyleSheet.create({
  stickyHeaderWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    pointerEvents: "box-none",
  },
  stickyHeaderFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 118,
  },
  stickyHeaderRow: {
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroStrengthOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  roundIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroBottomContent: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  heroSmallLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  heroTitleText: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 6,
  },
  heroSubtitleText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    marginTop: 2,
  },
  heroNeonEdge: { height: 3 },

  statusPill: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  statusGood: {
    backgroundColor: "rgba(34,197,94,0.22)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.45)",
  },
  statusBad: {
    backgroundColor: "rgba(248,113,113,0.18)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.42)",
  },
  statusPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  sheet: {
    marginTop: -18,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
  },

  tabRow: {
    flexDirection: "row",
    borderRadius: 999,
    padding: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },

  aboutTitle: { fontSize: 16, fontWeight: "800" },

  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 11, fontWeight: "600" },

  metaCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 18,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  metaCardLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  metaCardValue: { fontSize: 14, fontWeight: "700", marginTop: 2 },

  stepsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  runStepsList: {
    gap: 12,
  },
  strengthStepsList: {
    gap: 6,
  },
  strengthUnifiedList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: "hidden",
  },
  strengthSummaryRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 6,
  },
  strengthSummaryCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  strengthSummaryValue: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  strengthSummaryLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  modeToggleWrapper: { flexDirection: "row", borderRadius: 999, padding: 2 },
  modeToggleBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  modeToggleText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  strengthLayoutBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  strengthLayoutBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  strengthBlockHeader: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  strengthBlockHeaderInline: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  strengthBlockOverline: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  strengthBlockTitle: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "800",
  },

  stepCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  stepCardStrength: {
    borderRadius: 0,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 0,
  },
  stepIndexCol: { width: 26, marginRight: 10, alignItems: "flex-start" },
  stepIndexColStrength: {
    width: 22,
    marginRight: 8,
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingTop: 1,
  },
  stepIndexStrength: {
    lineHeight: 18,
    fontSize: 15,
  },
  stepIndex: { fontSize: 16, fontWeight: "700" },
  strengthExerciseRowContent: { justifyContent: "flex-start", gap: 0, paddingTop: 1 },
  strengthExerciseTitle: { marginTop: 0, lineHeight: 18 },
  stepHeader: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: "700" },
  stepMainText: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  stepSecondaryText: { fontSize: 12, marginTop: 1 },
  strengthTableHeaderRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  strengthTableHeaderExercise: {
    flex: 1,
    minWidth: 0,
  },
  strengthTableHeaderMetrics: {
    width: 180,
    maxWidth: 180,
    minWidth: 180,
    flexDirection: "row",
    alignItems: "center",
  },
  strengthTableHeaderMetric: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  strengthTableHeaderText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  strengthTableRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    marginTop: 2,
  },
  strengthTableExerciseCell: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  strengthTableMetricsWrap: {
    width: 176,
    maxWidth: 176,
    minWidth: 176,
    flexDirection: "row",
    borderRadius: 9,
    overflow: "hidden",
  },
  strengthTableMetricCol: {
    flex: 1,
    borderRadius: 9,
    paddingHorizontal: 5,
    paddingVertical: 4,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  strengthTableMetricLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  strengthTableMetricValue: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  stepRightTag: { marginLeft: 10, alignItems: "flex-end", justifyContent: "center" },
  stepRightTagText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  stepRightTagTextLight: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#FFFFFF",
  },

  metaChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },

  repeatWrapper: { borderRadius: 18, overflow: "hidden" },
  repeatWrapperStrength: { borderRadius: 0 },
  repeatHeader: { paddingHorizontal: 12, paddingVertical: 6 },
  repeatHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  repeatHeaderText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  repeatHeaderSubText: {
    marginTop: 2,
    color: "rgba(255,255,255,0.86)",
    fontSize: 11,
    fontWeight: "600",
  },
  stepCardRepeat: { borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  stepIndexColRepeat: { width: 32, marginRight: 12, alignItems: "center" },
  stepIndexDivider: {
    marginTop: 6,
    width: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    flexGrow: 1,
  },
  repeatRestText: { marginTop: 4, fontSize: 13, fontWeight: "600", color: "#FFFFFF" },
  repeatRightCol: { marginLeft: 10, alignItems: "flex-end", justifyContent: "space-between" },
  repeatTagRow: { flexDirection: "row", alignItems: "center", gap: 4 },

  quickActionsRow: {
    marginTop: 14,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  quickActionItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  quickActionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textAlign: "center" },
  statusSummaryCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  statusSummaryTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  statusSummaryIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  statusSummaryEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  statusSummaryTitle: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "800",
  },
  statusSummaryBody: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  statusSummaryNote: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  statusSummaryAction: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  statusSummaryActionText: {
    fontSize: 12,
    fontWeight: "800",
  },

  moveModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  moveModalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
  },
  moveModalTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  moveModalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  moveDayGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  moveDayBtn: {
    width: "31%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  moveDayBtnText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  moveDayBtnSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "600",
  },
  moveCancelBtn: {
    marginTop: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  moveCancelText: {
    fontSize: 13,
    fontWeight: "800",
  },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomButtonsRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bottomPrimaryBtn: {
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 12,
  },
  bottomPrimaryText: { marginLeft: 8, fontWeight: "800", fontSize: 14 },
  bottomSecondaryBtn: {
    flex: 0.7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bottomSecondaryText: { marginLeft: 6, fontWeight: "800", fontSize: 12 },
});
