// app/(protected)/train/utils/planTransformers.js

/* ------------------------------------------
   CONSTANTS
------------------------------------------ */
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ------------------------------------------
   STEP BUILDER (APP SHAPE)
------------------------------------------ */
export function mkStep(over = {}) {
  return {
    type: over.type || "Run",
    notes: over.notes || "",
    durationType: over.durationType || "Time (min)",
    durationValue: Number(
      over.durationValue ??
        (over.durationType === "Distance (km)" ? 1 : 10)
    ),
    intensityType: over.intensityType || "None",
    intensityTarget: over.intensityTarget || "",
    isRepeat: over.isRepeat || false,
    repeatReps: Number(over.repeatReps || 2),
    steps: Array.isArray(over.steps) ? over.steps : [],

    // ✅ Preserve export/edit metadata (Garmin-ready)
    stepId: over.stepId || undefined,
    garmin: over.garmin || undefined,
  };
}

/* ------------------------------------------
   HELPERS: DETECT & CONVERT SERVER SEGMENTS
------------------------------------------ */
function looksLikeServerRunStep(seg) {
  if (!seg || typeof seg !== "object") return false;
  // server route uses { kind:"runStep", label, description, durationMin, distanceKm, ... }
  return (
    seg.kind === "runStep" ||
    ("durationMin" in seg && "distanceKm" in seg) ||
    ("durationType" in seg && "durationValue" in seg)
  );
}

function toAppDuration(seg) {
  // Prefer server "durationType/value/unit" if present, otherwise fall back to durationMin/distanceKm
  const dt = String(seg?.durationType || "").toLowerCase();
  const dv = Number(seg?.durationValue || 0);
  const du = String(seg?.durationUnit || "").toLowerCase();

  // Server-normalised: time=sec, distance=m
  if (dt === "time" && dv > 0) {
    return { durationType: "Time (min)", durationValue: Math.round((dv / 60) * 10) / 10 };
  }
  if (dt === "distance" && dv > 0) {
    return { durationType: "Distance (km)", durationValue: Math.round((dv / 1000) * 100) / 100 };
  }

  // Legacy fallback
  const durMin = Number(seg?.durationMin || 0);
  const distKm = Number(seg?.distanceKm || 0);

  if (distKm > 0 && (!durMin || durMin === 0)) {
    return { durationType: "Distance (km)", durationValue: distKm };
  }
  if (durMin > 0) {
    return { durationType: "Time (min)", durationValue: durMin };
  }

  return { durationType: "Time (min)", durationValue: 10 };
}

function toAppIntensity(seg) {
  // Keep your UI simple: use intensityTarget text, and keep numeric targets in garmin blob
  const intensityText =
    seg?.intensity ||
    seg?.intensityTarget ||
    "";

  return {
    intensityType: intensityText ? "Target" : "None",
    intensityTarget: intensityText,
  };
}

function toGarminBlob(seg) {
  // Keep the machine-readable fields available for later FIT export / Garmin API
  const targetType = seg?.targetType;
  const targetLow = Number(seg?.targetLow || 0);
  const targetHigh = Number(seg?.targetHigh || 0);
  const targetUnit = seg?.targetUnit;

  const durationType = seg?.durationType;
  const durationValue = Number(seg?.durationValue || 0);
  const durationUnit = seg?.durationUnit;

  return {
    // duration (server style)
    durationType: durationType || undefined,
    durationValue: durationValue || 0,
    durationUnit: durationUnit || undefined,

    // targets (server style)
    targetType: targetType || undefined,
    targetLow: targetLow || 0,
    targetHigh: targetHigh || 0,
    targetUnit: targetUnit || undefined,

    // keep useful extras
    reps: Number(seg?.reps || 0),
    sets: Number(seg?.sets || 1),
    rpe: seg?.rpe || "",
    label: seg?.label || "",
    stationName: seg?.stationName || "",
  };
}

function serverSegmentToAppStep(seg) {
  const { durationType, durationValue } = toAppDuration(seg);
  const { intensityType, intensityTarget } = toAppIntensity(seg);

  return mkStep({
    type: seg?.label || "Run",
    notes: seg?.description || seg?.notes || "",
    durationType,
    durationValue,
    intensityType,
    intensityTarget,

    // preserve ID + export fields
    stepId: seg?.stepId,
    garmin: toGarminBlob(seg),
  });
}

/**
 * Convert a session.segments array:
 * - If already app steps -> return as-is
 * - If server "runStep" objects -> convert to app steps
 */
function convertSegmentsIfNeeded(segments) {
  const segs = Array.isArray(segments) ? segments : [];
  if (segs.length === 0) return [];

  // If any segment looks like server runStep -> convert all
  const needsConvert = segs.some(looksLikeServerRunStep);
  if (!needsConvert) return segs;

  return segs.map(serverSegmentToAppStep);
}

/**
 * Wrap interval work+recovery into a repeat block (APP FORMAT).
 * Pattern:
 * - A "work" step: garmin.reps > 0 OR label contains "x" etc
 * - Immediately followed by a "recovery" step
 * Then we replace [work, recovery] with a single repeat wrapper.
 */
function groupIntervalsIntoRepeatBlocks(appSteps) {
  const steps = Array.isArray(appSteps) ? appSteps : [];
  const out = [];

  const isRecovery = (s) => {
    const t = String(s?.type || "").toLowerCase();
    const n = String(s?.notes || "").toLowerCase();
    return (
      t.includes("recovery") ||
      t.includes("rest") ||
      n.includes("recovery") ||
      n.includes("easy jog") ||
      n.includes("very easy")
    );
  };

  const isWorkWithReps = (s) => {
    const reps = Number(s?.garmin?.reps || 0);
    if (reps > 0) return true;

    // fallback: try to infer from label
    const t = String(s?.type || "");
    return /\b\d+\s*[x×]\b/i.test(t) || /\b\d+\s*[x×]\s*\d+/i.test(t);
  };

  for (let i = 0; i < steps.length; i++) {
    const a = steps[i];
    const b = steps[i + 1];

    if (a && b && isWorkWithReps(a) && isRecovery(b)) {
      const reps = Number(a?.garmin?.reps || a?.repeatReps || 0) || 2;

      out.push(
        mkStep({
          type: "Repeat",
          notes: "Intervals",
          durationType: "Time (min)",
          durationValue: 0,
          intensityType: "None",
          intensityTarget: "",
          isRepeat: true,
          repeatReps: reps,
          steps: [
            // keep original work + recovery steps inside
            { ...a, isRepeat: false },
            { ...b, isRepeat: false },
          ],
          // stable ID for the wrapper (optional)
          stepId: `repeat-${a?.stepId || i}`,
          garmin: { repeatCount: reps },
        })
      );

      i++; // skip b
      continue;
    }

    out.push(a);
  }

  return out;
}

/* ------------------------------------------
   ENSURE SEGMENTS ARRAY (NO AUTO WARM/COOL)
------------------------------------------ */
export function withWarmCool(session) {
  const steps = Array.isArray(session.segments) ? session.segments : [];
  return { ...session, segments: steps };
}

/* ------------------------------------------
   NORMALISE SINGLE SESSION
------------------------------------------ */
export function normaliseSessionForPlan(sess) {
  const base = withWarmCool(sess || {});

  const durationMinRaw =
    base.targetDurationMin != null ? base.targetDurationMin : base.durationMin;
  const distanceKmRaw =
    base.targetDistanceKm != null ? base.targetDistanceKm : base.distanceKm;

  const durationMin = Number(durationMinRaw || 0) || undefined;
  const distanceKm = Number(distanceKmRaw || 0) || undefined;

  // ✅ Convert server segments if needed, then group repeats
  let segments = convertSegmentsIfNeeded(base.segments);
  segments = groupIntervalsIntoRepeatBlocks(segments);

  const hasMain = segments.some(
    (s) =>
      s &&
      !/^(warm|cool)/i.test(String(s.type || "")) &&
      !s.isRepeat
  );

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

    const warm = segments.find((s) => /^warm/i.test(String(s.type || "")));
    const cool = segments.find((s) => /^cool/i.test(String(s.type || "")));

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

/* ------------------------------------------
   NORMALISE WEEKS BEFORE SAVING
------------------------------------------ */
export function normaliseWeeksForSave(weeks) {
  return (weeks || []).map((w, wi) => ({
    title: w.title || `Week ${wi + 1}`,
    days: (w.days || []).map((d) => ({
      day: d.day,
      sessions: (d.sessions || []).map(normaliseSessionForPlan),
    })),
  }));
}

/* ------------------------------------------
   AI → APP (TRAINING PLAN)  (LEGACY "steps" SHAPE)
------------------------------------------ */
export function trainingPlanToWeeks(aiPlan) {
  if (!aiPlan?.weeks?.length) {
    return [
      {
        title: "Week 1",
        days: DAYS.map((d) => ({ day: d, sessions: [] })),
      },
    ];
  }

  return aiPlan.weeks.map((w, wi) => {
    const srcDays = Array.isArray(w.days) ? w.days : [];

    return {
      title: w.title || `Week ${wi + 1}`,
      days: DAYS.map((dayName) => {
        const dayObj = srcDays.find((d) => d.day === dayName) || {};
        const sessionsSrc = Array.isArray(dayObj.sessions) ? dayObj.sessions : [];

        const sessions = sessionsSrc.map((s) => {
          const steps = Array.isArray(s.steps) ? s.steps : [];

          const segments = steps.map((st) => {
            const durMin = Number(st.durationMinutes || 0);
            const distKm = Number(st.distanceKm || 0);

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
              type: st.type || "Run",
              notes: st.description || "",
              durationType,
              durationValue,
              intensityType: "None",
              intensityTarget: st.intensity || "",
              // preserve anything extra if present
              stepId: st.stepId,
              garmin: st.garmin,
            });
          });

          const totalMin = steps.reduce(
            (sum, st) => sum + (Number(st.durationMinutes) || 0),
            0
          );
          const totalKm = steps.reduce(
            (sum, st) => sum + (Number(st.distanceKm) || 0),
            0
          );

          return normaliseSessionForPlan({
            type: "Run",
            title: s.label || "Session",
            durationMin: totalMin || undefined,
            distanceKm: totalKm || undefined,
            notes: s.notes || "",
            segments,
          });
        });

        return { day: dayName, sessions };
      }),
    };
  });
}

/* ------------------------------------------
   ⭐ SMART MERGE ENGINE ⭐
------------------------------------------ */
export function mergeUpdatedIntoExisting(existing, updated) {
  if (!existing || !updated) return updated;

  const final = { ...existing };

  if (!Array.isArray(updated.weeks)) return existing;

  final.weeks = updated.weeks.map((newW, wi) => {
    const oldW = existing.weeks?.[wi] || { days: [] };

    return {
      title: newW.title || oldW.title || `Week ${wi + 1}`,
      days: DAYS.map((dayName) => {
        const newDay = newW.days?.find((d) => d.day === dayName);
        const oldDay = oldW.days?.find((d) => d.day === dayName);

        return {
          day: dayName,
          sessions: newDay?.sessions?.length ? newDay.sessions : oldDay?.sessions || [],
        };
      }),
    };
  });

  return final;
}

/* ------------------------------------------
   MAIN CONVERTER
   (used by /train index + train-chat)
------------------------------------------ */
export function convertAiPlanToApp(updatedPlan, existingPlan = null) {
  if (!updatedPlan) return null;

  // detect if plan has sessions with segments (either app steps OR server runStep objects)
  const hasSegments =
    Array.isArray(updatedPlan.weeks) &&
    updatedPlan.weeks.some((w) =>
      (w.days || []).some((d) =>
        (d.sessions || []).some(
          (s) => Array.isArray(s.segments) && s.segments.length
        )
      )
    );

  const convertedWeeks = hasSegments ? updatedPlan.weeks : trainingPlanToWeeks(updatedPlan);

  // Deep normalise for save/usage (this now converts server segments + groups repeats)
  const normalised = normaliseWeeksForSave(convertedWeeks);

  const cleanPlan = {
    ...updatedPlan,
    weeks: normalised,
  };

  if (existingPlan) {
    return mergeUpdatedIntoExisting(existingPlan, cleanPlan);
  }

  return cleanPlan;
}
