// app/(protected)/train/utils/planModel.js
import { serverTimestamp } from "firebase/firestore";
import { withPlanAdaptationDefaults } from "./adaptationModel";

// Days used across the plan (keep in sync with create.jsx)
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Small helper
const normaliseStr = (s) => String(s || "").trim();

/* ----------------- STEP SHAPE ----------------- */

export function mkStep(over = {}) {
  return {
    type: over.type || "Run", // Warmup | Run | Tempo | Intervals | CoolDown | ...
    notes: over.notes || "",
    durationType: over.durationType || "Time (min)", // Time (min) | Distance (km) | Reps
    durationValue: Number(
      over.durationValue ?? (over.durationType === "Distance (km)" ? 1 : 10)
    ),
    intensityType: over.intensityType || "None", // Pace (/km) | HR Zone | RPE | None
    intensityTarget: over.intensityTarget || "", // e.g. 4:15–4:20 /km, Z4, RPE 7–8
    // Repeat set support (optional container step)
    isRepeat: over.isRepeat || false,
    repeatReps: Number(over.repeatReps || 2),
    steps: Array.isArray(over.steps) ? over.steps : [], // inner steps for a repeat block
  };
}

/* ----------------- SESSION NORMALISATION ----------------- */

/**
 * Previously this injected default Warmup / CoolDown blocks.
 * Now it ONLY ensures `segments` is always an array and returns the session
 * unchanged otherwise – no auto WU / CD.
 */
function withWarmCool(session) {
  const steps = Array.isArray(session.segments) ? session.segments : [];
  return { ...session, segments: steps };
}

/**
 * Normalise one session object into the shape that Today / StartSession /
 * History expect:
 * - segments always present (but no auto warm-up / cool-down)
 * - at least one MAIN "Run" step
 * - targetDurationMin / targetDistanceKm set from durationMin / distanceKm
 */
export function normaliseSessionForPlan(sess) {
  // 1) Ensure segments array exists (no longer adds warmup/cooldown)
  const base = withWarmCool(sess || {});

  // 2) Work out session-level duration/distance
  const durationMinRaw =
    base.targetDurationMin != null
      ? base.targetDurationMin
      : base.durationMin;
  const distanceKmRaw =
    base.targetDistanceKm != null
      ? base.targetDistanceKm
      : base.distanceKm;

  const durationMin = Number(durationMinRaw || 0) || undefined;
  const distanceKm = Number(distanceKmRaw || 0) || undefined;

  let segments = Array.isArray(base.segments) ? base.segments : [];

  // 3) Does this already have a MAIN step (not warm/cool)?
  const hasMain = segments.some(
    (s) =>
      s &&
      !/^(warm|cool)/i.test(String(s.type || "")) &&
      !s.isRepeat
  );

  // 4) If no main step, inject a generic "Run" block
  if (!hasMain) {
    let durationType = "Time (min)";
    let durationValue = 0;

    if (distanceKm && !durationMin) {
      durationType = "Distance (km)";
      durationValue = distanceKm;
    } else if (durationMin) {
      durationType = "Time (min)";
      durationValue = durationMin;
    } else {
      durationType = "Time (min)";
      durationValue = 10;
    }

    const warm = segments.find((s) =>
      /^warm/i.test(String(s.type || ""))
    );
    const cool = segments.find((s) =>
      /^cool/i.test(String(s.type || ""))
    );

    const newSegs = [];
    if (warm) newSegs.push(warm);
    newSegs.push(
      mkStep({
        type: "Run",
        durationType,
        durationValue,
        intensityType: "None",
        notes: base.notes || "",
      })
    );
    if (cool) newSegs.push(cool);

    if (newSegs.length) {
      segments = newSegs;
    }
  }

  return {
    ...base,
    type: "Run",
    segments,
    targetDurationMin:
      base.targetDurationMin != null ? base.targetDurationMin : durationMin,
    targetDistanceKm:
      base.targetDistanceKm != null ? base.targetDistanceKm : distanceKm,
  };
}

/**
 * Ensure all weeks/days/sessions are normalised before saving to Firestore.
 */
export function normaliseWeeksForSave(weeks) {
  return (weeks || []).map((w, wi) => ({
    title: w.title || `Week ${wi + 1}`,
    days: (w.days || []).map((d) => ({
      day: d.day,
      sessions: (d.sessions || []).map(normaliseSessionForPlan),
    })),
  }));
}

/* ---------- Convert AI JSON training plan into this screen's weeks shape ---------- */
/**
 * Plan shape assumed:
 * {
 *   weeks: [
 *     {
 *       title,
 *       days: [
 *         {
 *           day: "Mon" | ...,
 *           sessions: [
 *             {
 *               label,
 *               notes,
 *               steps: [
 *                 { type, description, durationMinutes, distanceKm, intensity }
 *               ]
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
export function trainingPlanToWeeks(plan) {
  if (!plan || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    return [
      {
        title: "Week 1",
        days: DAYS.map((d) => ({ day: d, sessions: [] })),
      },
    ];
  }

  return plan.weeks.map((w, wi) => {
    const daysArray = Array.isArray(w.days) ? w.days : [];
    return {
      title: w.title || `Week ${wi + 1}`,
      days: DAYS.map((dayName) => {
        const daySrc =
          daysArray.find((d) => d && d.day === dayName) || {};
        const sessionsSrc = Array.isArray(daySrc.sessions)
          ? daySrc.sessions
          : [];

        const sessions = sessionsSrc.map((s) => {
          const steps = Array.isArray(s.steps) ? s.steps : [];

          const segments = steps.map((step) => {
            const durMin = Number(step?.durationMinutes || 0);
            const distKm = Number(step?.distanceKm || 0);

            let durationType = "Time (min)";
            let durationValue = 0;

            if (distKm > 0 && (!durMin || durMin === 0)) {
              durationType = "Distance (km)";
              durationValue = distKm;
            } else if (durMin > 0) {
              durationType = "Time (min)";
              durationValue = durMin;
            } else {
              durationType = "Time (min)";
              durationValue = 10;
            }

            return mkStep({
              type: step?.type || "Run",
              notes: step?.description || "",
              durationType,
              durationValue,
              // stash intensity text into target, keep type as "None"
              intensityType: "None",
              intensityTarget: step?.intensity || "",
            });
          });

          const totalMin = steps.reduce(
            (sum, st) => sum + (Number(st?.durationMinutes) || 0),
            0
          );
          const totalKm = steps.reduce(
            (sum, st) => sum + (Number(st?.distanceKm) || 0),
            0
          );

          return normaliseSessionForPlan({
            type: "Run",
            title: s?.label || "Session",
            durationMin: totalMin || undefined,
            distanceKm: totalKm || undefined,
            notes: s?.notes || "",
            segments,
          });
        });

        return { day: dayName, sessions };
      }),
    };
  });
}

/* ----------------- PREVIEW TABLE RENDERER ----------------- */

function stepToMini(seg) {
  if (seg.isRepeat) {
    const inner = seg.steps
      ?.map((s) => stepToMini(s))
      .filter(Boolean)
      .join(" / ");
    return `Repeat x${seg.repeatReps} [ ${inner || "—"} ]`;
  }
  const dur =
    seg.durationType === "Time (min)"
      ? `${Math.round(seg.durationValue)} min`
      : seg.durationType === "Distance (km)"
      ? `${Number(seg.durationValue)} km`
      : `${Math.round(seg.durationValue)} reps`;
  const inten =
    seg.intensityType === "None"
      ? ""
      : ` @ ${seg.intensityTarget || seg.intensityType}`;
  return `${seg.type}: ${dur}${inten}${
    seg.notes ? ` · ${seg.notes}` : ""
  }`;
}

function row(day, session) {
  // If the AI plan provided explicit details/target, show those
  if (session.detailsFromMarkdown || session.targetFromMarkdown) {
    return {
      day,
      session: session.title || `${session.type || "Session"}`,
      details: session.detailsFromMarkdown || session.notes || "",
      target: session.targetFromMarkdown || "",
    };
  }

  const segs = Array.isArray(session.segments) ? session.segments : [];
  const warm = segs.find((s) => /^warm/i.test(s.type));
  const cool = segs.find((s) => /^cool/i.test(s.type));
  const mains = segs.filter(
    (s) => !/^(warm|cool)/i.test(s.type)
  );

  const warmText = warm ? stepToMini(warm) : null;
  const mainText = mains.length
    ? mains.map((s) => stepToMini(s)).filter(Boolean).join("  /  ")
    : session.notes || "";
  const coolText = cool ? stepToMini(cool) : null;

  const detailLines = [];
  if (warmText) detailLines.push(warmText);
  if (mainText) detailLines.push(mainText);
  if (coolText) detailLines.push(coolText);

  const details =
    detailLines.length > 0 ? detailLines.join("\n") : session.notes || "";

  const target =
    mains.find((m) => m.intensityTarget)?.intensityTarget ||
    mains.find((m) => m.intensityType && m.intensityType !== "None")
      ?.intensityType ||
    "Per notes";

  return {
    day,
    session: session.title || `${session.type || "Run"} session`,
    details,
    target,
  };
}

export function planToPreview(planWeeks) {
  return (planWeeks || []).map((w) => {
    const rows = [];
    (w.days || []).forEach((d) =>
      (d.sessions || []).forEach((s) => rows.push(row(d.day, s)))
    );
    return { title: w.title || "Week", rows };
  });
}

/* ----------------- NEW: PLAN DOC CREATION FOR FIRESTORE ----------------- */

/**
 * Flatten app plan sessions (weeks → flat array) for AI/chat editing.
 * This is used when saving plans from create-run / create screens.
 */
function flattenPlanSessions(appPlan) {
  if (!appPlan) return [];

  const weeks = Array.isArray(appPlan.weeks) ? appPlan.weeks : [];
  const flat = [];

  weeks.forEach((week, weekIdx) => {
    const sessions = Array.isArray(week.sessions) ? week.sessions : [];

    sessions.forEach((session, sessionIdx) => {
      flat.push({
        id:
          session.id ||
          `w${weekIdx + 1}-s${sessionIdx + 1}`,
        weekIndex: week.weekIndex ?? weekIdx + 1,

        date: session.date || null, // ideally "YYYY-MM-DD"
        type: session.type || session.sessionType || "Run",
        title: session.title || session.name || "",
        description: session.notes || session.description || "",
        distanceKm:
          session.distanceKm ??
          (typeof session.distance === "number" ? session.distance : null),
        durationMin:
          session.durationMin ??
          (typeof session.duration === "number" ? session.duration : null),
        intensity: session.intensity || session.effort || "",
        notes: session.notes || "",

        raw: session,
      });
    });
  });

  return flat;
}

/**
 * Deep-remove undefined values from any structure before saving to Firestore.
 */
export function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefinedDeep(v))
      .filter((v) => v !== undefined);
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = removeUndefinedDeep(val);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }

  if (value === undefined) return undefined;
  return value;
}

export function normalisePlanForSave(planDoc) {
  return removeUndefinedDeep(planDoc);
}

/**
 * Build a full plan document ready for Firestore from:
 * - appPlan (convertAiPlanToApp result)
 * - aiPlan (raw response from AI)
 * - meta (high-level metadata)
 * - config (generation config for re-gen / edits)
 */
export function createPlanDocument({ appPlan, aiPlan, meta, config }) {
  const {
    name,
    primaryActivity,
    goalDistance,
    goalPrimaryFocus,
    targetEventName,
    targetEventDate,
    targetTime,
    source,
    aiContext,
  } = meta || {};

  const flatSessions = flattenPlanSessions(appPlan || {});

  return withPlanAdaptationDefaults({
    // Base plan structure (weeks etc.)
    ...appPlan,

    // Human-readable metadata
    name: appPlan?.name || name || "Training plan",
    primaryActivity: appPlan?.primaryActivity || primaryActivity || "Run",
    goalDistance: goalDistance || "",
    goalPrimaryFocus: goalPrimaryFocus || "",
    targetEventName: targetEventName || "",
    targetEventDate: targetEventDate || "",
    targetTime: targetTime || "",
    source: source || "ai",

    // AI-friendly content
    sessions: flatSessions,
    rawAiPlan: aiPlan,
    aiContext: aiContext || "",

    // Config used when generating
    planConfig: config || {},

    // Versioning
    aiVersion: 1,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
