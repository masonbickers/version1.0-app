// app/(protected)/train/utils/planTransformers.js

/* ------------------------------------------
   CONSTANTS
------------------------------------------ */
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ------------------------------------------
   STEP BUILDER
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
  };
}

/* ------------------------------------------
   ADD WARMUP + COOLDOWN IF MISSING
------------------------------------------ */
export function withWarmCool(session) {
  const segs = Array.isArray(session.segments) ? session.segments : [];
  const hasWU = segs.some((s) => /^warm/i.test(s.type));
  const hasCD = segs.some((s) => /^cool/i.test(s.type));

  const next = [...segs];

  if (!hasWU) {
    next.unshift(
      mkStep({
        type: "Warmup",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1–Z2",
        notes: "Build gradually; drills",
      })
    );
  }

  if (!hasCD) {
    next.push(
      mkStep({
        type: "CoolDown",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1",
        notes: "Ease down; light mobility",
      })
    );
  }

  return { ...session, segments: next };
}

/* ------------------------------------------
   NORMALISE SINGLE SESSION
------------------------------------------ */
export function normaliseSessionForPlan(sess) {
  const s = withWarmCool(sess || {});

  const durationMin = Number(s.durationMin || 0) || undefined;
  const distanceKm = Number(s.distanceKm || 0) || undefined;

  return {
    ...s,
    targetDurationMin:
      s.targetDurationMin != null ? s.targetDurationMin : durationMin,
    targetDistanceKm:
      s.targetDistanceKm != null ? s.targetDistanceKm : distanceKm,
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
   AI → APP (TRAINING PLAN)
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
        const sessionsSrc = Array.isArray(dayObj.sessions)
          ? dayObj.sessions
          : [];

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
          sessions:
            newDay?.sessions?.length
              ? newDay.sessions
              : oldDay?.sessions || [],
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

  // 🔍 Detect if the plan already looks like an “app plan” (has segments)
  const hasSegments =
    Array.isArray(updatedPlan.weeks) &&
    updatedPlan.weeks.some((w) =>
      (w.days || []).some((d) =>
        (d.sessions || []).some(
          (s) => Array.isArray(s.segments) && s.segments.length
        )
      )
    );

  // If it's already app-shaped, just take its weeks;
  // otherwise, convert from AI "steps" shape.
  const convertedWeeks = hasSegments
    ? updatedPlan.weeks
    : trainingPlanToWeeks(updatedPlan);

  // Deep normalise for save / usage
  const normalised = normaliseWeeksForSave(convertedWeeks);

  const cleanPlan = {
    ...updatedPlan,
    weeks: normalised,
  };

  // Optionally merge into existing plan so we keep meta fields
  if (existingPlan) {
    return mergeUpdatedIntoExisting(existingPlan, cleanPlan);
  }

  return cleanPlan;
}
