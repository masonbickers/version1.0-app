// server/lib/train/planRules/planExplanation.js

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 10) / 10 : 0;
}

function safeText(value) {
  return String(value || "")
    .replace(/\b(undefined|null|NaN)\b/gi, "")
    .replace(/\b(meta|trace|specPickId|workoutSelectionTrace|debug|validation)\b/gi, "decision")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTexts(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const text = safeText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function goalLabel(profile = {}) {
  return String(profile?.goal?.distance || profile?.goalDistance || "running").trim();
}

function goalKey(profile = {}) {
  const s = goalLabel(profile).toLowerCase();
  if (s.includes("5k")) return "5K";
  if (s.includes("10k")) return "10K";
  if (s.includes("half")) return "half marathon";
  if (s.includes("marathon") && !s.includes("half")) return "marathon";
  if (s.includes("ultra")) return "ultra";
  if (s.includes("return")) return "return to running";
  if (s.includes("general")) return "general fitness";
  return goalLabel(profile);
}

function sessionKind(session = {}) {
  return String(session?.type || session?.sessionType || session?.workoutKind || "").trim().toUpperCase();
}

function plannedKm(session = {}) {
  return toNum(session?.plannedDistanceKm) ?? toNum(session?.distanceKm) ?? toNum(session?.distance) ?? 0;
}

function weekKm(week = {}) {
  return (
    toNum(week?.metrics?.plannedWeeklyKm) ??
    (Array.isArray(week?.sessions) ? round1(week.sessions.reduce((sum, s) => sum + plannedKm(s), 0)) : 0)
  );
}

function longRunShare(week = {}) {
  const fromMetrics = toNum(week?.metrics?.longRunSharePct);
  if (fromMetrics != null) return fromMetrics;
  const total = weekKm(week);
  if (!total) return null;
  const long = (week.sessions || []).filter((s) => sessionKind(s) === "LONG").reduce((sum, s) => sum + plannedKm(s), 0);
  return round1((long / total) * 100);
}

function qualitySessions(week = {}) {
  return (Array.isArray(week?.sessions) ? week.sessions : []).filter((s) =>
    ["INTERVALS", "TEMPO", "THRESHOLD", "HILLS", "RACEPACE"].includes(sessionKind(s))
  );
}

function firstQualitySession(plan = {}) {
  for (const week of Array.isArray(plan?.weeks) ? plan.weeks : []) {
    const found = qualitySessions(week)[0];
    if (found) return { week, session: found };
  }
  return null;
}

function firstLongRun(plan = {}) {
  for (const week of Array.isArray(plan?.weeks) ? plan.weeks : []) {
    const found = (week?.sessions || []).find((s) => sessionKind(s) === "LONG");
    if (found) return { week, session: found };
  }
  return null;
}

function formatKm(value) {
  const n = toNum(value);
  if (n == null) return null;
  return `${round1(n)}km`;
}

function explainPhase(phase) {
  const p = String(phase || "").toUpperCase();
  if (p === "BASE") return "Build easy volume and durable running rhythm.";
  if (p === "BUILD") return "Progress the main training load while keeping recovery space.";
  if (p === "SPECIFIC") return "Make the work more specific to the goal distance.";
  if (p === "TAPER") return "Freshen up while keeping enough sharpness for race day.";
  if (p === "DELOAD" || p === "RECOVERY") return "Absorb the previous work with a lighter week.";
  return "Keep training consistent and controlled.";
}

function sessionPurpose(kind, goal) {
  if (kind === "EASY") return `This builds aerobic volume for your ${goal} goal without adding unnecessary stress.`;
  if (kind === "LONG") return `This supports your ${goal} goal by extending endurance and improving fatigue resistance.`;
  if (kind === "THRESHOLD") return `This supports your ${goal} goal by improving the pace you can hold sustainably.`;
  if (kind === "TEMPO") return `This builds controlled speed endurance without turning the session into a race.`;
  if (kind === "INTERVALS") return `This develops speed and running economy for the faster parts of your ${goal} build.`;
  if (kind === "RACE") return "This is the target event the plan is preparing you for.";
  if (kind === "RECOVERY") return "This protects recovery so the next useful training session can land well.";
  return `This session supports the overall ${goal} build.`;
}

function executionTip(kind, session = {}) {
  if (session?.targetMode === "effort_hr") return "Use effort and heart rate first. Let pace vary with terrain, heat, and fatigue.";
  if (kind === "EASY") return "Keep it conversational. Finishing fresher than you started is the right outcome.";
  if (kind === "LONG") return "Start relaxed and keep the final third controlled. Do not chase pace early.";
  if (kind === "THRESHOLD" || kind === "TEMPO") return "Keep this controlled. The goal is rhythm, not racing the reps.";
  if (kind === "INTERVALS") return "Run the first rep slightly restrained, then settle into repeatable form.";
  if (kind === "RACE") return "Use the first part to settle, then build into your strongest sustainable effort.";
  if (kind === "RECOVERY") return "Keep this genuinely easy. Recovery is the purpose.";
  return "Focus on smooth execution and leave a little in reserve.";
}

function coachNoteForSession(kind, session = {}, profile = {}) {
  const goal = goalKey(profile);
  const km = formatKm(plannedKm(session));
  const prefix = km ? `${km} ${String(kind || "").toLowerCase()} session.` : `${String(kind || "Run").toLowerCase()} session.`;
  if (kind === "LONG") return `${prefix} It is placed to build endurance without letting the long run dominate the week.`;
  if (["THRESHOLD", "TEMPO", "INTERVALS"].includes(kind)) return `${prefix} This is the key quality stimulus for your ${goal} progression.`;
  if (kind === "EASY") return `${prefix} Easy running keeps the weekly volume productive and recoverable.`;
  if (kind === "RACE") return `${prefix} Everything around this should protect readiness for the event.`;
  return `${prefix} Keep the intent clear and avoid adding extra work.`;
}

function weekProgressionReason(weeks, index) {
  const current = weekKm(weeks[index]);
  if (index === 0) return `Starts at ${formatKm(current) || "a conservative load"} to avoid a sharp jump from current training.`;
  const previous = weekKm(weeks[index - 1]);
  if (!previous || !current) return "Progression is based on keeping the week recoverable.";
  const delta = round1(current - previous);
  if (Math.abs(delta) < 0.6) return "Volume is held steady so the quality work can settle.";
  if (delta > 0) return `Volume rises by ${formatKm(delta)} from last week, keeping the build gradual.`;
  return `Volume drops by ${formatKm(Math.abs(delta))} so you can absorb the previous work.`;
}

function riskTextFromIssue(issue = {}) {
  const code = String(issue.code || "").toUpperCase();
  if (code.includes("GOAL_REALISM") || code.includes("AGGRESSIVE")) {
    return "Your goal is ambitious relative to the available evidence, so the plan keeps the build controlled.";
  }
  if (code.includes("LONG_RUN_SHARE")) {
    return "The long run was watched closely because it can become too large a share of weekly volume.";
  }
  if (code.includes("RAMP")) {
    return "Weekly volume progression was capped to avoid a sharp load jump.";
  }
  if (code.includes("TAPER")) {
    return "Race-week load was kept conservative so freshness is protected.";
  }
  if (code.includes("PACE")) {
    return "Pace targets should be treated as guidance because confidence is limited.";
  }
  return safeText(issue.message || "A safety check added a caution for this plan.");
}

function buildKeyDecisions({ plan, profile, goalRealism, paceModel, validationSummary, readinessAdjustment, strengthAdjustment, weeklyRecalculation }) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const firstWeek = weeks[0] || null;
  const decisions = [];
  const currentKm = toNum(profile?.current?.weeklyKm) ?? toNum(profile?.weeklyKm);
  const startKm = firstWeek ? weekKm(firstWeek) : null;
  if (startKm != null && currentKm != null) {
    decisions.push(`Your plan starts at ${formatKm(startKm)} because your recent volume is ${formatKm(currentKm)}/week, so we are avoiding a sharp jump.`);
  } else if (startKm != null) {
    decisions.push(`Your plan starts at ${formatKm(startKm)} so the first week is controlled and repeatable.`);
  }

  const firstQuality = firstQualitySession(plan);
  if (firstQuality?.session) {
    const kind = sessionKind(firstQuality.session);
    const label = kind === "THRESHOLD" || kind === "TEMPO" ? "threshold-based" : kind.toLowerCase();
    decisions.push(`Your first quality session is ${label} because your ${goalKey(profile)} goal needs sustainable speed before harder race-specific work.`);
  }

  const long = firstLongRun(plan);
  if (long?.week) {
    const share = longRunShare(long.week);
    if (share != null && share >= 30) {
      decisions.push(`Your long run is capped carefully because it already represents ${round1(share)}% of weekly volume.`);
    }
  }

  if (paceModel?.confidence != null) {
    const targetMode = paceModel?.adjustments?.targetMode;
    if (String(targetMode || "").includes("effort")) {
      decisions.push("Pace targets use effort and heart rate where terrain, fatigue, or goal type makes strict road pace less reliable.");
    } else {
      decisions.push(`Paces are based on your current fitness evidence with ${Math.round(paceModel.confidence)}% confidence.`);
    }
  }

  if (goalRealism?.level && goalRealism.level !== "realistic") {
    decisions.push(`Your goal is marked ${goalRealism.level}, so the plan protects progression and recovery rather than forcing every target.`);
  }

  if (readinessAdjustment?.applied) {
    decisions.push(readinessAdjustment.message || "The next sessions were adjusted because readiness was lower than normal.");
  }
  if (strengthAdjustment?.applied) {
    decisions.push("Run placement was checked against strength training so hard running and heavy lower-body work do not clash.");
  }
  if (weeklyRecalculation?.applied) {
    decisions.push(weeklyRecalculation.message || "Upcoming load was recalculated from recent completion and training outcome data.");
  }

  for (const repair of validationSummary?.repairsApplied || []) {
    if (repair?.reason === "long_run_share_too_high") decisions.push("Long-run distance was reduced because it was too much of the week.");
    if (repair?.reason === "weekly_ramp_too_steep") decisions.push("Weekly distance was capped because the ramp was too steep.");
  }

  return uniqueTexts(decisions);
}

function buildRiskNotes({ goalRealism, paceModel, validationSummary, readinessAdjustment }) {
  const notes = [];
  if (goalRealism?.level && ["challenging", "aggressive", "unsafe"].includes(goalRealism.level)) {
    notes.push(goalRealism.message || `This goal is ${goalRealism.level}; treat the plan as controlled progression rather than a guarantee.`);
  }
  if (paceModel?.confidence != null && paceModel.confidence < 60) {
    notes.push("Pace confidence is limited, so use the ranges and heart-rate guidance instead of chasing exact splits.");
  }
  if (paceModel?.adjustments?.preferEffortTargets) {
    notes.push("Effort and heart rate should lead on sessions where terrain, heat, fatigue, or ultra specificity makes pace unreliable.");
  }
  if (readinessAdjustment?.level === "low" || readinessAdjustment?.level === "very_low") {
    notes.push("Low readiness means the next hard effort should be reduced or replaced rather than forced.");
  }
  for (const issue of [
    ...(validationSummary?.blockers || []),
    ...(validationSummary?.warnings || []),
  ].slice(0, 6)) {
    notes.push(riskTextFromIssue(issue));
  }
  return uniqueTexts(notes);
}

function buildWeeklyNotes({ plan, profile, readinessAdjustment, strengthAdjustment, weeklyRecalculation }) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  return weeks.map((week, index) => {
    const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
    const qualityCount = qualitySessions(week).length;
    const long = sessions.find((s) => sessionKind(s) === "LONG");
    const phaseFocus = explainPhase(week?.phase);
    const focus = qualityCount > 0
      ? `${phaseFocus} Includes ${qualityCount} controlled quality session${qualityCount === 1 ? "" : "s"}.`
      : phaseFocus;
    const progressionReason = weekProgressionReason(weeks, index);
    const riskBits = [];
    const share = longRunShare(week);
    if (share != null && share > 38) riskBits.push(`Long run is ${round1(share)}% of weekly volume, so keep it easy.`);
    if (week?.phase === "TAPER") riskBits.push("Do not add missed work into this taper week.");
    if (readinessAdjustment?.applied && index === 0) riskBits.push(readinessAdjustment.message);
    if (weeklyRecalculation?.applied && index <= 1) riskBits.push(weeklyRecalculation.message);
    if (strengthAdjustment?.applied && index === 0) riskBits.push("Strength-training conflicts were checked before placing hard runs.");

    const coachNote = long
      ? `${progressionReason} The long run is ${formatKm(plannedKm(long))}, which keeps endurance moving without turning the week into one big session.`
      : progressionReason;

    return {
      weekIndex: Number(week?.weekIndex || week?.weekNumber || index + 1) || index + 1,
      focus: safeText(focus),
      coachNote: safeText(coachNote),
      riskNote: safeText(uniqueTexts(riskBits).join(" ")),
      progressionReason: safeText(progressionReason),
    };
  });
}

function buildSessionNotes({ plan, profile }) {
  const notes = [];
  const goal = goalKey(profile);
  for (const [weekIdx, week] of (Array.isArray(plan?.weeks) ? plan.weeks : []).entries()) {
    for (const [sessionIdx, session] of (week?.sessions || []).entries()) {
      const kind = sessionKind(session);
      notes.push({
        weekIndex: Number(week?.weekIndex || week?.weekNumber || weekIdx + 1) || weekIdx + 1,
        sessionId: session?.sessionId || null,
        day: session?.day || null,
        sessionIndex: sessionIdx,
        coachNote: safeText(coachNoteForSession(kind, session, profile)),
        executionTip: safeText(executionTip(kind, session)),
        whyThisSession: safeText(sessionPurpose(kind, goal)),
      });
    }
  }
  return notes;
}

export function applyPlanExplanationToPlan(plan, explanation) {
  if (!plan || typeof plan !== "object") return plan;
  const weeklyByIndex = new Map((explanation?.weeklyNotes || []).map((w) => [Number(w.weekIndex), w]));
  const sessionNotes = Array.isArray(explanation?.sessionNotes) ? explanation.sessionNotes : [];
  const nextWeeks = (Array.isArray(plan.weeks) ? plan.weeks : []).map((week, wi) => {
    const weekIndex = Number(week?.weekIndex || week?.weekNumber || wi + 1) || wi + 1;
    const weekNote = weeklyByIndex.get(weekIndex) || {};
    const sessions = (Array.isArray(week.sessions) ? week.sessions : []).map((session, si) => {
      const note = sessionNotes.find((n) =>
        (n.sessionId && n.sessionId === session?.sessionId) ||
        (Number(n.weekIndex) === weekIndex && Number(n.sessionIndex) === si)
      ) || {};
      const preserveTemplateStructure = Boolean(
        session?.preserveTemplateStructure === true ||
          session?.meta?.preserveTemplateStructure === true ||
          session?.workout?.preserveTemplateStructure === true ||
          session?.workout?.meta?.preserveTemplateStructure === true
      );
      return {
        ...session,
        coachNote: preserveTemplateStructure
          ? session.coachNote || note.coachNote || ""
          : note.coachNote || session.coachNote || "",
        executionTip: preserveTemplateStructure
          ? session.executionTip || note.executionTip || ""
          : note.executionTip || session.executionTip || "",
        whyThisSession: preserveTemplateStructure
          ? session.whyThisSession || note.whyThisSession || ""
          : note.whyThisSession || session.whyThisSession || "",
      };
    });
    const days = Array.isArray(week.days)
      ? week.days.map((day) => ({
          ...day,
          sessions: Array.isArray(day.sessions)
            ? day.sessions.map((session) => {
                const idx = sessions.findIndex((s) =>
                  (s.sessionId && s.sessionId === session?.sessionId) ||
                  (s.day === session?.day && s.type === session?.type && plannedKm(s) === plannedKm(session))
                );
                return idx >= 0 ? sessions[idx] : session;
              })
            : day.sessions,
        }))
      : week.days;

    return {
      ...week,
      focus: weekNote.focus || week.focus || "",
      coachNote: weekNote.coachNote || week.coachNote || "",
      riskNote: weekNote.riskNote || week.riskNote || "",
      progressionReason: weekNote.progressionReason || week.progressionReason || "",
      sessions,
      days,
    };
  });

  return {
    ...plan,
    weeks: nextWeeks,
    planExplanation: explanation,
  };
}

export function buildPlanExplanation({
  plan,
  profile = {},
  goalRealism = null,
  paceModel = null,
  validationSummary = null,
  readinessAdjustment = null,
  strengthAdjustment = null,
  weeklyRecalculation = null,
} = {}) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
  const firstWeekKm = weeks.length ? weekKm(weeks[0]) : null;
  const peakKm = weeks.length ? Math.max(...weeks.map(weekKm)) : null;
  const goal = goalKey(profile);
  const sessionsPerWeek =
    toNum(profile?.availability?.sessionsPerWeek) ?? toNum(profile?.sessionsPerWeek) ?? null;
  const planSummary = safeText(
    `This ${weeks.length || ""}-week ${goal} plan starts at ${formatKm(firstWeekKm) || "a controlled load"}${peakKm != null ? ` and builds toward ${formatKm(peakKm)}` : ""}${sessionsPerWeek ? ` across ${sessionsPerWeek} runs per week` : ""}.`
  );

  const keyDecisions = buildKeyDecisions({
    plan,
    profile,
    goalRealism,
    paceModel,
    validationSummary,
    readinessAdjustment,
    strengthAdjustment,
    weeklyRecalculation,
  });
  const riskNotes = buildRiskNotes({
    goalRealism,
    paceModel,
    validationSummary,
    readinessAdjustment,
  });
  const weeklyNotes = buildWeeklyNotes({
    plan,
    profile,
    readinessAdjustment,
    strengthAdjustment,
    weeklyRecalculation,
  });
  const sessionNotes = buildSessionNotes({ plan, profile });
  const coachingSummary = safeText(
    [
      keyDecisions[0] || "The plan is built around controlled progression.",
      riskNotes[0] || "Keep easy days easy so the quality sessions stay productive.",
    ].join(" ")
  );

  return {
    planSummary,
    coachingSummary,
    keyDecisions,
    riskNotes,
    weeklyNotes,
    sessionNotes,
  };
}
