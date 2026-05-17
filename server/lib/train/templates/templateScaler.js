const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normaliseDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const map = {
    mon: "Mon",
    monday: "Mon",
    tue: "Tue",
    tues: "Tue",
    tuesday: "Tue",
    wed: "Wed",
    weds: "Wed",
    wednesday: "Wed",
    thu: "Thu",
    thur: "Thu",
    thurs: "Thu",
    thursday: "Thu",
    fri: "Fri",
    friday: "Fri",
    sat: "Sat",
    saturday: "Sat",
    sun: "Sun",
    sunday: "Sun",
  };
  return map[raw] || null;
}

function orderedRunDays(profile = {}) {
  const raw =
    profile?.availability?.runDays ??
    profile?.runDays ??
    [];
  const seen = new Set();
  const days = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    const day = normaliseDay(value);
    if (!day || seen.has(day)) continue;
    seen.add(day);
    days.push(day);
  }
  return days.length ? days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)) : ["Tue", "Thu", "Sun"];
}

function longRunDay(profile = {}, runDays = []) {
  const requested = normaliseDay(profile?.availability?.longRunDay ?? profile?.longRunDay);
  if (requested && runDays.includes(requested)) return requested;
  if (runDays.includes("Sun")) return "Sun";
  return runDays[runDays.length - 1] || "Sun";
}

function qualityDay(runDays = [], longDay = "Sun") {
  const candidates = runDays.filter((day) => day !== longDay);
  return candidates[1] || candidates[0] || runDays[0] || "Thu";
}

function easyDay(runDays = [], longDay = "Sun", quality = "Thu") {
  return runDays.find((day) => day !== longDay && day !== quality) || runDays.find((day) => day !== longDay) || "Tue";
}

function secondaryDay(runDays = [], longDay = "Sun", quality = "Thu", easy = "Tue") {
  return (
    runDays.find((day) => day !== longDay && day !== quality && day !== easy) ||
    runDays.find((day) => day !== longDay && day !== quality) ||
    easy
  );
}

function tertiaryDay(runDays = [], longDay = "Sun", quality = "Thu", easy = "Tue", secondary = "Wed") {
  return (
    runDays.find((day) => day !== longDay && day !== quality && day !== easy && day !== secondary) ||
    runDays.find((day) => day !== longDay && day !== quality && day !== easy) ||
    secondary
  );
}

function weekTargetKm({ currentWeeklyKm, weekIndex, phase, loadMultiplier = null }) {
  const base = Math.max(12, currentWeeklyKm || 0);
  const multipliers = [1, 1.06, 1.1, 0.88, 1.12, 1.16, 0.92, 0.7];
  const phaseKey = String(phase || "").toUpperCase();
  const multiplier = toNumber(loadMultiplier, null);
  const raw = base * (multiplier || multipliers[weekIndex - 1] || 1);
  if (phaseKey === "DELOAD") return round1(Math.max(12, raw));
  if (phaseKey === "TAPER") return round1(Math.max(10, raw));
  return round1(Math.max(12, raw));
}

function sessionDistanceKm({ session, targetWeeklyKm, currentLongestRunKm }) {
  if (Number.isFinite(Number(session?.fixedDistanceKm))) return round1(Number(session.fixedDistanceKm));
  const share = toNumber(session?.targetShare, 0.3);
  let km = round1(targetWeeklyKm * share);
  const role = String(session?.role || "").toLowerCase();
  if (role === "long_run") {
    const authoredCap = toNumber(session?.longRunCapKm ?? session?.maxDistanceKm, null);
    const cap = authoredCap != null
      ? clamp(authoredCap, 6, 40)
      : Math.max(6, Math.min(18, currentLongestRunKm + 3));
    km = Math.min(km, cap);
  }
  if (role === "quality") km = clamp(km, 5, 11);
  if (role === "easy") km = Math.max(4, km);
  if (role === "race") km = Math.max(5, km);
  return round1(km);
}

function sessionDay({ session, runDays, longDay, quality, hasQuality = true }) {
  const role = String(session?.role || "").toLowerCase();
  if (role === "long_run" || role === "race") return longDay;
  if (role === "quality") return quality;
  const primaryEasy = easyDay(runDays, longDay, quality);
  const secondary = secondaryDay(runDays, longDay, quality, primaryEasy);
  if (["support", "secondary", "steady", "easy_strides", "strides", "optional"].includes(role)) {
    return secondary;
  }
  if (["recovery", "shakeout", "aerobic"].includes(role)) {
    if (!hasQuality) return quality;
    return tertiaryDay(runDays, longDay, quality, primaryEasy, secondary);
  }
  return primaryEasy;
}

function buildWorkout(session = {}, km = 0) {
  const workout = session?.workout && typeof session.workout === "object" ? session.workout : {};
  return {
    sport: "running",
    kind: workout.kind || session.type,
    estimatedDistanceMeters: Math.round((km || 0) * 1000),
    preserveTemplateStructure: true,
    targetPlaceholder: session.target || null,
    structure: session.structure || null,
    ...workout,
    preserveTemplateStructure: true,
    meta: {
      ...(workout.meta && typeof workout.meta === "object" ? workout.meta : {}),
      templateTarget: session.target || null,
      templateStructure: session.structure || null,
      templateTargetShare: session.targetShare ?? null,
      preserveTemplateStructure: true,
    },
  };
}

function buildWeekDays({ runDays, sessions }) {
  return runDays.map((day) => {
    const daySessions = sessions.filter((session) => session.day === day);
    return {
      day,
      title: daySessions[0]?.name || (daySessions.length ? day : "Rest / no structured session"),
      sessions: daySessions,
      sessionIds: daySessions.map((session) => session.sessionId).filter(Boolean),
    };
  });
}

export function hydrateTemplateSession({
  template,
  week,
  templateSession,
  weekIndex,
  sessionIndex,
  runDays,
  longDay,
  quality,
  targetWeeklyKm,
  currentLongestRunKm,
  hasQuality = true,
} = {}) {
  const km = sessionDistanceKm({
    session: templateSession,
    targetWeeklyKm,
    currentLongestRunKm,
  });
  const day = sessionDay({ session: templateSession, runDays, longDay, quality, hasQuality });
  const type = String(templateSession?.type || "EASY").toUpperCase();
  const sessionId = `${template.id}_w${weekIndex}_${String(templateSession?.role || type).toLowerCase()}_${sessionIndex + 1}`;
  const purpose = String(templateSession?.purpose || "").trim();
  const executionTip = String(templateSession?.executionTip || "").trim();

  return {
    sessionId,
    day,
    role: templateSession?.role,
    type,
    workoutKind: type,
    sessionType: type,
    name: templateSession?.structure || type,
    title: templateSession?.structure || type,
    target: templateSession?.target || null,
    targetPlaceholder: templateSession?.target || null,
    targetShare: templateSession?.targetShare ?? null,
    structure: templateSession?.structure || null,
    purpose,
    executionTip,
    coachNote: purpose,
    whyThisSession: purpose,
    notes: executionTip,
    keyTargets: templateSession?.structure || templateSession?.target || "",
    preserveTemplateStructure: true,
    plannedDistanceKm: km,
    distanceKm: km,
    distance: km,
    distanceMeters: Math.round(km * 1000),
    budgetedDistanceKm: km,
    workout: buildWorkout(templateSession, km),
    meta: {
      ...(templateSession?.meta && typeof templateSession.meta === "object" ? templateSession.meta : {}),
      templateId: template.id,
      templateWeek: weekIndex,
      templatePhase: week?.phase || null,
      templateRole: templateSession?.role || null,
      templateTarget: templateSession?.target || null,
      preserveTemplateStructure: true,
    },
  };
}

export function buildPlanFromTemplate({ template, profile = {}, paceModel = null } = {}) {
  if (!template?.id || !Array.isArray(template?.weeks)) {
    throw new Error("buildPlanFromTemplate requires a valid template.");
  }

  const runDays = orderedRunDays(profile);
  const longDay = longRunDay(profile, runDays);
  const qDay = qualityDay(runDays, longDay);
  const currentWeeklyKm = toNumber(profile?.current?.weeklyKm ?? profile?.weeklyKm, 24);
  const currentLongestRunKm = toNumber(profile?.current?.longestRunKm ?? profile?.longestRunKm, 8);

  const weeks = template.weeks.map((week, weekOffset) => {
    const weekIndex = weekOffset + 1;
    const targetWeeklyKm = weekTargetKm({
      currentWeeklyKm,
      weekIndex,
      phase: week.phase,
      loadMultiplier: week.loadMultiplier,
    });

    const templateSessions = Array.isArray(week.sessions) ? week.sessions : [];
    const hasQuality = templateSessions.some((session) => String(session?.role || "").toLowerCase() === "quality");
    const sessions = templateSessions.map((templateSession, sessionOffset) =>
      hydrateTemplateSession({
        template,
        week,
        templateSession,
        weekIndex,
        sessionIndex: sessionOffset,
        runDays,
        longDay,
        quality: qDay,
        targetWeeklyKm,
        currentLongestRunKm,
        hasQuality,
      })
    );

    const plannedWeeklyKm = round1(sessions.reduce((sum, session) => sum + (toNumber(session.plannedDistanceKm, 0) || 0), 0));
    const usesAuthoredWeeklyKm =
      ["RETURN", "GENERAL"].includes(String(template?.metadata?.distance || "").toUpperCase()) &&
      templateSessions.length > 0 &&
      templateSessions.every((session) => Number.isFinite(Number(session?.fixedDistanceKm)));
    const effectiveWeeklyKm = usesAuthoredWeeklyKm ? plannedWeeklyKm : targetWeeklyKm;
    const long = sessions.find((session) => session.role === "long_run");
    const qualityKm = round1(sessions
      .filter((session) => ["INTERVALS", "TEMPO", "THRESHOLD"].includes(session.type))
      .reduce((sum, session) => sum + (toNumber(session.plannedDistanceKm, 0) || 0), 0));

    return {
      weekIndex,
      weekNumber: week.weekNumber || weekIndex,
      phase: String(week.phase || "").toUpperCase(),
      preserveTemplateStructure: true,
      focus: week.focus || "",
      coachNote: week.coachNote || "",
      progressionReason: week.focus || "",
      runDays,
      longRunDay: longDay,
      sessions,
      days: buildWeekDays({ runDays, sessions }),
      targets: {
        weekIndex,
        phase: String(week.phase || "").toUpperCase(),
        weeklyKm: effectiveWeeklyKm,
        longRunKm: long ? long.plannedDistanceKm : 0,
        isDeload: String(week.phase || "").toUpperCase() === "DELOAD",
        isTaper: String(week.phase || "").toUpperCase() === "TAPER",
      },
      metrics: {
        targetWeeklyKm: effectiveWeeklyKm,
        plannedWeeklyKm,
        qualityKm,
        qualitySharePct: plannedWeeklyKm > 0 ? round1((qualityKm / plannedWeeklyKm) * 100) : 0,
        longRunKm: long ? long.plannedDistanceKm : 0,
        longRunSharePct: long && plannedWeeklyKm > 0 ? round1((long.plannedDistanceKm / plannedWeeklyKm) * 100) : 0,
      },
    };
  });

  return {
    id: template.id,
    name: [
      template.metadata?.distance || "Run",
      template.metadata?.level || "",
      `${template.metadata?.weeks || weeks.length}-week plan`,
    ].filter(Boolean).join(" "),
    source: "template",
    planSource: "template",
    preserveTemplateStructure: true,
    templateId: template.id,
    templateMetadata: template.metadata,
    goalDistance: template.metadata?.distance || "10K",
    planLengthWeeks: template.metadata?.weeks || weeks.length,
    runsPerWeek: template.metadata?.runsPerWeek || runDays.length,
    paceModel: paceModel || profile?.paceModel || null,
    weeks,
    meta: {
      templateId: template.id,
      templateSource: "gold_standard_template",
      templateMetadata: template.metadata,
    },
  };
}

export default buildPlanFromTemplate;
