// src/train/data/coachTemplates.js

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_COACH_NAME = "Coach Team";

const sec = (minutes) => Math.max(0, Math.round(Number(minutes || 0) * 60));

function timeRunStep(name, minutes, paceKey, notes = "") {
  return {
    type: "RUN",
    name,
    duration: { type: "TIME", seconds: sec(minutes) },
    target: paceKey ? { paceKey } : null,
    notes,
  };
}

function distanceRunStep(name, km, paceKey, notes = "") {
  return {
    type: "RUN",
    name,
    duration: { type: "DISTANCE", meters: Math.round(Number(km || 0) * 1000) },
    target: paceKey ? { paceKey } : null,
    notes,
  };
}

function repeatBlock({
  reps,
  workSec,
  recoverSec,
  workMeters,
  recoverMeters,
  workPaceKey = "5K",
  recoverPaceKey = "EASY",
  workName = "Fast",
  recoverName = "Float",
  workNotes = "",
  recoverNotes = "",
  workRpe,
  recoverRpe,
}) {
  const safeWorkMeters = Math.round(Number(workMeters || 0));
  const safeRecoverMeters = Math.round(Number(recoverMeters || 0));
  const safeWorkSec = Math.max(10, Math.round(Number(workSec || 0)));
  const safeRecoverSec = Math.max(10, Math.round(Number(recoverSec || 0)));

  const repLabel =
    safeWorkMeters > 0
      ? safeWorkMeters >= 1000
        ? `${String((safeWorkMeters / 1000).toFixed(1)).replace(/\.0$/, "")}k`
        : `${safeWorkMeters}m`
      : safeWorkSec >= 60
      ? `${(safeWorkSec / 60).toFixed(safeWorkSec % 60 === 0 ? 0 : 1)} min`
      : `${safeWorkSec}s`;

  return {
    type: "REPEAT",
    name: `${reps} x ${repLabel}`,
    repeat: Math.max(1, Math.round(Number(reps || 1))),
    steps: [
      {
        type: "RUN",
        name: workName,
        duration:
          safeWorkMeters > 0
            ? { type: "DISTANCE", meters: safeWorkMeters }
            : { type: "TIME", seconds: safeWorkSec },
        target: { paceKey: workPaceKey },
        ...(typeof workNotes === "string" && workNotes.trim() ? { notes: workNotes.trim() } : {}),
        ...(Number.isFinite(Number(workRpe)) && Number(workRpe) > 0
          ? { rpe: Number(Number(workRpe).toFixed(1)) }
          : {}),
      },
      {
        type: "RUN",
        name: recoverName,
        duration:
          safeRecoverMeters > 0
            ? { type: "DISTANCE", meters: safeRecoverMeters }
            : { type: "TIME", seconds: safeRecoverSec },
        target: { paceKey: recoverPaceKey },
        ...(typeof recoverNotes === "string" && recoverNotes.trim()
          ? { notes: recoverNotes.trim() }
          : {}),
        ...(Number.isFinite(Number(recoverRpe)) && Number(recoverRpe) > 0
          ? { rpe: Number(Number(recoverRpe).toFixed(1)) }
          : {}),
      },
    ],
  };
}

function formatIntervalRepToken({ workSec, workMeters }) {
  const meters = Math.round(Number(workMeters || 0));
  if (Number.isFinite(meters) && meters > 0) {
    if (meters >= 1000) {
      const km = Number((meters / 1000).toFixed(1));
      return `${String(km).replace(/\.0$/, "")}k`;
    }
    // Running convention: 400m reps are commonly called "400s".
    return `${meters}s`;
  }

  const secValue = Math.max(30, Math.round(Number(workSec || 0)));
  if (secValue % 60 === 0) {
    const min = secValue / 60;
    return `${min} min`;
  }
  return `${secValue}s`;
}

function buildSpeedSessionTitle({ reps, workSec, workMeters }) {
  const safeReps = Math.max(1, Math.round(Number(reps || 1)));
  const repToken = formatIntervalRepToken({ workSec, workMeters });
  if (!repToken) return "Intervals";

  if (/[0-9]s$/i.test(repToken)) {
    return `${safeReps} x ${repToken}`;
  }
  return `${safeReps} x ${repToken} Repeats`;
}

function makeSpeedSession(weekNumber, speedSet, levelLabel) {
  const workSec = Math.max(30, Math.round(Number(speedSet?.workSec || 60)));
  const recoverSec = Math.max(30, Math.round(Number(speedSet?.recoverSec || 60)));
  const workMeters = Math.round(Number(speedSet?.workMeters ?? speedSet?.repMeters ?? 0));
  const recoverMeters = Math.round(Number(speedSet?.recoverMeters ?? speedSet?.floatMeters ?? 0));
  const reps = Math.max(4, Math.round(Number(speedSet?.reps || 6)));
  const intervalTitle = buildSpeedSessionTitle({ reps, workSec, workMeters });

  return {
    title: intervalTitle,
    name: intervalTitle,
    type: "RUN",
    sessionType: "intervals",
    targetDurationMin: 48,
    targetDistanceKm: Number((6 + weekNumber * 0.2).toFixed(1)),
    notes: `${levelLabel} quality day. Controlled hard reps, smooth recoveries.`,
    steps: [
      timeRunStep("Warm up", 15, "EASY", "Build to stride rhythm"),
      repeatBlock({
        reps,
        workSec,
        recoverSec,
        workMeters,
        recoverMeters,
        workPaceKey: speedSet?.paceKey || "5K",
        recoverPaceKey: "EASY",
      }),
      timeRunStep("Cool down", 12, "EASY", "Jog easy and reset"),
    ],
  };
}

function makeEasySession(distanceKm) {
  const km = Number(distanceKm || 0);
  const estimatedMin = Math.max(30, Math.round(km * 6.1));
  const mainKm = Math.max(2, Number((km - 2).toFixed(1)));

  return {
    title: `Easy Run ${km.toFixed(1)} km`,
    name: `Easy Run ${km.toFixed(1)} km`,
    type: "RUN",
    sessionType: "easy",
    targetDurationMin: estimatedMin,
    targetDistanceKm: km,
    notes: "Conversational effort from start to finish.",
    steps: [
      timeRunStep("Warm up jog", 10, "EASY"),
      distanceRunStep("Easy aerobic", mainKm, "EASY"),
      timeRunStep("Cool down jog", 10, "EASY"),
    ],
  };
}

function makeTempoSession(tempoMinutes, tempoDistanceKm) {
  const tempoMin = Math.max(10, Math.round(Number(tempoMinutes || 0)));
  const km = Number(tempoDistanceKm || 0);
  const estimatedMin = Math.max(38, tempoMin + 25);

  return {
    title: `Tempo Run ${km.toFixed(1)} km`,
    name: `Tempo Run ${km.toFixed(1)} km`,
    type: "RUN",
    sessionType: "tempo",
    targetDurationMin: estimatedMin,
    targetDistanceKm: km,
    notes: "Steady threshold work. Strong but sustainable.",
    steps: [
      timeRunStep("Warm up", 15, "EASY"),
      timeRunStep("Tempo block", tempoMin, "THRESHOLD", "Settle into race rhythm"),
      timeRunStep("Cool down", 10, "EASY"),
    ],
  };
}

function makeLongSession(distanceKm) {
  const km = Number(distanceKm || 0);
  const estimatedMin = Math.max(50, Math.round(km * 6.3));
  const mainKm = Math.max(4, Number((km - 1.5).toFixed(1)));

  return {
    title: `Long Run ${km.toFixed(1)} km`,
    name: `Long Run ${km.toFixed(1)} km`,
    type: "RUN",
    sessionType: "long",
    targetDurationMin: estimatedMin,
    targetDistanceKm: km,
    notes: "Relaxed aerobic long run. Keep effort easy and smooth.",
    steps: [
      timeRunStep("Warm up", 10, "EASY"),
      distanceRunStep("Long aerobic", mainKm, "EASY"),
      timeRunStep("Cool down", 5, "EASY"),
    ],
  };
}

function weekDaysForSessions(speedSession, easySession, tempoSession, longSession) {
  const map = {
    Tue: [speedSession],
    Thu: [easySession],
    Sat: [tempoSession],
    Sun: [longSession],
  };

  return DAYS.map((day) => ({
    day,
    sessions: (map[day] || []).map((sess) => ({
      ...sess,
      day,
    })),
  }));
}

function adjustSpeedSets(baseSets, mode) {
  if (mode === "foundation") {
    return baseSets.map((set) => ({
      ...set,
      reps: Math.max(4, set.reps - 1),
      recoverSec: set.recoverSec + 10,
    }));
  }

  if (mode === "performance") {
    return baseSets.map((set) => ({
      ...set,
      reps: set.reps + 1,
      recoverSec: Math.max(45, set.recoverSec - 10),
    }));
  }

  return baseSets;
}

const WEEK_STRUCTURE_8 = [
  {
    phaseLabel: "Foundation build",
    volumeFactor: 0.92,
    qualityFactor: 0.92,
    isDeload: false,
    isTaper: false,
  },
  {
    phaseLabel: "Aerobic build",
    volumeFactor: 1.0,
    qualityFactor: 1.0,
    isDeload: false,
    isTaper: false,
  },
  {
    phaseLabel: "Load build",
    volumeFactor: 1.07,
    qualityFactor: 1.08,
    isDeload: false,
    isTaper: false,
  },
  {
    phaseLabel: "Deload",
    volumeFactor: 0.78,
    qualityFactor: 0.72,
    isDeload: true,
    isTaper: false,
  },
  {
    phaseLabel: "Rebuild",
    volumeFactor: 1.1,
    qualityFactor: 1.08,
    isDeload: false,
    isTaper: false,
  },
  {
    phaseLabel: "Race-specific build",
    volumeFactor: 1.16,
    qualityFactor: 1.12,
    isDeload: false,
    isTaper: false,
  },
  {
    phaseLabel: "Peak specificity",
    volumeFactor: 1.2,
    qualityFactor: 1.15,
    isDeload: false,
    isTaper: false,
  },
  {
    phaseLabel: "Taper",
    volumeFactor: 0.72,
    qualityFactor: 0.7,
    isDeload: true,
    isTaper: true,
  },
];

function clampRange(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function round1(value) {
  return Number(Number(value || 0).toFixed(1));
}

function scaleWeekKm(baseKm, weekStructure, multiplier = 1, min = 3.5, max = 28) {
  const raw = Number(baseKm || 0);
  const factor = Number(weekStructure?.volumeFactor || 1) * Number(multiplier || 1);
  const scaled = raw * factor;
  return round1(clampRange(scaled, min, max));
}

function scaleWeekMin(baseMin, weekStructure, multiplier = 1, min = 8, max = 75) {
  const raw = Number(baseMin || 0);
  const factor = Number(weekStructure?.qualityFactor || 1) * Number(multiplier || 1);
  return Math.round(clampRange(raw * factor, min, max));
}

function tuneSpeedSetForWeek(baseSet, weekStructure, mode) {
  const set = baseSet || {};
  const modeQualityShift =
    mode === "performance" ? 1.05 : mode === "foundation" ? 0.95 : 1;
  const qualityFactor = Number(weekStructure?.qualityFactor || 1) * modeQualityShift;

  const repsBase = Number(set.reps || 6);
  const reps = Math.round(clampRange(repsBase * qualityFactor, 4, 14));

  const workSecBase = Number(set.workSec || 60);
  const workSec = Math.round(
    clampRange(
      workSecBase * (weekStructure?.isDeload ? 0.9 : weekStructure?.isTaper ? 0.85 : 1),
      45,
      360
    )
  );

  const recoverSecBase = Number(set.recoverSec || 75);
  const recoverSec = Math.round(
    clampRange(
      recoverSecBase * (weekStructure?.isDeload ? 1.2 : weekStructure?.isTaper ? 1.15 : 1),
      45,
      180
    )
  );

  return {
    ...set,
    reps,
    workSec,
    recoverSec,
  };
}

function sessionTargetDistanceKm(session, fallback = 0) {
  const km = Number(
    session?.targetDistanceKm ??
      session?.distanceKm ??
      session?.plannedDistanceKm ??
      session?.totalDistanceKm ??
      fallback
  );
  return Number.isFinite(km) && km > 0 ? km : 0;
}

function build10k8w4Template(config, index) {
  const weekFocus = [
    "Base consistency",
    "Aerobic capacity",
    "Speed endurance",
    "Threshold control",
    "Race-specific strength",
    "Sustained threshold",
    "Peak 10K sharpening",
    "Taper and execute",
  ];

  const speedBase = [
    { reps: 8, workMeters: 400, recoverMeters: 200, workSec: 95, recoverSec: 75, paceKey: "5K" },
    { reps: 10, workMeters: 400, recoverMeters: 200, workSec: 92, recoverSec: 60, paceKey: "5K" },
    { reps: 6, workMeters: 800, recoverMeters: 200, workSec: 190, recoverSec: 90, paceKey: "10K" },
    { reps: 5, workMeters: 400, recoverMeters: 200, workSec: 95, recoverSec: 120, paceKey: "10K" },
    { reps: 8, workMeters: 600, recoverMeters: 200, workSec: 145, recoverSec: 60, paceKey: "5K" },
    { reps: 6, workMeters: 1000, recoverMeters: 300, workSec: 240, recoverSec: 90, paceKey: "10K" },
    { reps: 5, workMeters: 1200, recoverMeters: 400, workSec: 290, recoverSec: 120, paceKey: "10K" },
    { reps: 6, workMeters: 400, recoverMeters: 200, workSec: 90, recoverSec: 90, paceKey: "5K" },
  ];

  const speedSetsBase = adjustSpeedSets(speedBase, config.mode);

  const weeks = Array.from({ length: 8 }).map((_, wi) => {
    const weekStructure = WEEK_STRUCTURE_8[wi] || WEEK_STRUCTURE_8[WEEK_STRUCTURE_8.length - 1];

    const tunedSet = tuneSpeedSetForWeek(speedSetsBase[wi], weekStructure, config.mode);
    const easyKm = scaleWeekKm(config.easyKm[wi], weekStructure, 1, 4, 18);
    const tempoKm = scaleWeekKm(config.tempoKm[wi], weekStructure, weekStructure.isDeload ? 0.95 : 1, 4, 20);
    const tempoMin = scaleWeekMin(config.tempoMinutes[wi], weekStructure, weekStructure.isDeload ? 0.9 : 1, 10, 45);
    const longKm = scaleWeekKm(config.longKm[wi], weekStructure, weekStructure.isTaper ? 0.9 : 1.03, 7, 28);

    const speedSession = makeSpeedSession(wi + 1, tunedSet, config.levelLabel);
    speedSession.targetDistanceKm = round1(
      clampRange(Number(speedSession.targetDistanceKm || 6) * weekStructure.volumeFactor, 4, 16)
    );
    speedSession.targetDurationMin = Math.round(
      clampRange(Number(speedSession.targetDurationMin || 48) * weekStructure.qualityFactor, 32, 75)
    );

    if (weekStructure.isDeload && !weekStructure.isTaper) {
      speedSession.notes = `${speedSession.notes} Deload week: reduce strain and finish fresh.`;
    } else if (weekStructure.isTaper) {
      speedSession.notes = `${speedSession.notes} Taper week: short and sharp, never maximal.`;
    }

    const easySession = makeEasySession(easyKm);
    const tempoSession = makeTempoSession(tempoMin, tempoKm);
    const longSession = makeLongSession(longKm);

    if (weekStructure.isDeload && !weekStructure.isTaper) {
      easySession.notes = `${easySession.notes} Deload focus: keep this very relaxed.`;
      tempoSession.notes = `${tempoSession.notes} Keep this controlled, below maximal threshold.`;
      longSession.notes = `${longSession.notes} Reduced load week: prioritize recovery.`;
    }

    if (weekStructure.isTaper) {
      easySession.notes = `${easySession.notes} Race-week freshness run.`;
      tempoSession.notes = `${tempoSession.notes} Short sharpen only; stay smooth.`;
      longSession.notes = `${longSession.notes} Taper long run: keep this conservative.`;
    }

    const weekDays = weekDaysForSessions(speedSession, easySession, tempoSession, longSession);
    const weeklyKm = round1(
      sessionTargetDistanceKm(speedSession) +
        sessionTargetDistanceKm(easySession) +
        sessionTargetDistanceKm(tempoSession) +
        sessionTargetDistanceKm(longSession)
    );
    const longRunKm = round1(sessionTargetDistanceKm(longSession, longKm));

    return {
      title: `Week ${wi + 1}`,
      weekIndex0: wi,
      weekNumber: wi + 1,
      focus: `${weekFocus[wi] || "10K progression"} · ${weekStructure.phaseLabel}`,
      phase: {
        label: weekStructure.phaseLabel,
        isDeload: !!weekStructure.isDeload,
        isTaper: !!weekStructure.isTaper,
      },
      targets: {
        weeklyKm,
        longRunKm,
        isDeload: !!weekStructure.isDeload,
        isTaper: !!weekStructure.isTaper,
        qualityFactor: round1(weekStructure.qualityFactor),
        volumeFactor: round1(weekStructure.volumeFactor),
      },
      days: weekDays,
    };
  });

  const planTargets = weeks.map((week) => ({
    weekNumber: week.weekNumber,
    weeklyKm: Number(week?.targets?.weeklyKm || 0),
    longRunKm: Number(week?.targets?.longRunKm || 0),
    isDeload: !!week?.targets?.isDeload,
    isTaper: !!week?.targets?.isTaper,
  }));

  const coachName = String(config?.coachName || DEFAULT_COACH_NAME);
  const goalType = String(config?.goalType || "10K");
  const planLabel = String(config?.planLabel || "10K in 8 Weeks");
  const templateName = `${config.name} - ${planLabel} (4 Runs/Week)`;
  const createdAt = Date.now() - index * 1000;

  return {
    id: config.id,
    name: templateName,
    kind: "run",
    source: "coach-template-local",
    isCoachPlan: true,
    isPublished: true,
    visibility: "public",
    createdByRole: "coach",
    coachName,
    primaryActivity: "Run",
    description:
      config.description ||
      "Professional 8-week progression with 4 key sessions weekly: speed, easy aerobic, tempo, and long run.",
    goalType,
    sessionsPerWeek: 4,
    targets: planTargets,
    weeks,
    meta: {
      name: templateName,
      coachName,
      primaryActivity: "Run",
      isCoachPlan: true,
      published: true,
      primaryFocus: goalType,
      profile: config.levelLabel,
      quality: "professional-coach-template",
      periodisation: "3-week build + deload, then rebuild to peak, then taper",
      coachSpecialty: config.coachSpecialty || "Endurance performance",
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function strengthItem({
  title,
  sets,
  reps,
  restSec,
  rpe,
  rir,
  load,
  loadKg,
  cues,
  effort,
  timeSec,
}) {
  return {
    title,
    ...(Number.isFinite(Number(sets)) && Number(sets) > 0
      ? { sets: Math.round(Number(sets)) }
      : {}),
    ...(Number.isFinite(Number(reps)) && Number(reps) > 0
      ? { reps: Math.round(Number(reps)) }
      : {}),
    ...(Number.isFinite(Number(restSec)) && Number(restSec) > 0
      ? { restSec: Math.round(Number(restSec)) }
      : {}),
    ...(Number.isFinite(Number(rpe)) && Number(rpe) > 0
      ? { rpe: Number(Number(rpe).toFixed(1)) }
      : {}),
    ...(Number.isFinite(Number(rir)) && Number(rir) >= 0
      ? { rir: Number(Number(rir).toFixed(1)) }
      : {}),
    ...(typeof load === "string" && load.trim() ? { load: load.trim() } : {}),
    ...(Number.isFinite(Number(loadKg)) && Number(loadKg) > 0
      ? { loadKg: Math.round(Number(loadKg)) }
      : {}),
    ...(typeof cues === "string" && cues.trim() ? { cues: cues.trim() } : {}),
    ...(typeof effort === "string" && effort.trim() ? { effort: effort.trim() } : {}),
    ...(Number.isFinite(Number(timeSec)) && Number(timeSec) > 0
      ? { timeSec: Math.round(Number(timeSec)) }
      : {}),
  };
}

function withSessionCoaching(session, coaching = {}) {
  if (!session || typeof session !== "object") return session;
  return {
    ...session,
    coaching: {
      ...(session?.coaching && typeof session.coaching === "object" ? session.coaching : {}),
      ...(coaching && typeof coaching === "object" ? coaching : {}),
    },
  };
}

function withSessionLabels(session, kind, fallbackSessionType = "") {
  if (!session || typeof session !== "object") return session;
  const k = String(kind || "").toLowerCase();
  const out = { ...session };
  const existingSessionType = String(out.sessionType || "").toLowerCase();
  const workout = out.workout && typeof out.workout === "object" ? { ...out.workout } : {};

  if (k === "strength") {
    out.type = "GYM";
    out.sessionType =
      existingSessionType && existingSessionType !== "run" ? out.sessionType : "gym";
    out.layoutType = "strength";
    out.activityType = "strength";
    out.primaryModality = "strength";
    out.workout = {
      ...workout,
      sport: "strength",
    };
    return out;
  }

  out.type = "RUN";
  out.sessionType =
    existingSessionType && existingSessionType !== "gym" && existingSessionType !== "strength"
      ? out.sessionType
      : fallbackSessionType || "run";
  out.layoutType = "run";
  out.activityType = "run";
  out.primaryModality = "run";
  out.workout = {
    ...workout,
    sport: "run",
    steps:
      Array.isArray(workout.steps) && workout.steps.length
        ? workout.steps
        : Array.isArray(out.steps)
        ? out.steps
        : [],
    ...(Number.isFinite(Number(workout.totalDurationSec)) && Number(workout.totalDurationSec) > 0
      ? { totalDurationSec: Number(workout.totalDurationSec) }
      : Number.isFinite(Number(out.targetDurationMin))
      ? { totalDurationSec: Math.round(Number(out.targetDurationMin) * 60) }
      : {}),
    ...(Number.isFinite(Number(workout.totalDistanceKm)) && Number(workout.totalDistanceKm) > 0
      ? { totalDistanceKm: Number(workout.totalDistanceKm) }
      : Number.isFinite(Number(out.targetDistanceKm))
      ? { totalDistanceKm: Number(out.targetDistanceKm) }
      : {}),
  };
  return out;
}

const MASON_UPPER_STRENGTH_BLOCKS = [
  {
    kind: "main",
    title: "Primary Strength",
    items: [
      strengthItem({
        title: "Bench Press",
        sets: 5,
        reps: 5,
        restSec: 150,
        rpe: 8,
        rir: 2,
        cues: "Controlled eccentric, pause 1s on chest",
      }),
      strengthItem({
        title: "Weighted Pull Ups",
        sets: 4,
        reps: 6,
        restSec: 120,
        rpe: 8,
        rir: 2,
        cues: "Full hang, chest tall to bar",
      }),
      strengthItem({
        title: "Overhead Press",
        sets: 4,
        reps: 6,
        restSec: 120,
        rpe: 7.5,
        rir: 2.5,
        cues: "Brace trunk, strict reps",
      }),
      strengthItem({
        title: "Barbell Row",
        sets: 4,
        reps: 8,
        restSec: 105,
        rpe: 7.5,
        rir: 2,
        cues: "Pause on torso each rep",
      }),
    ],
  },
  {
    kind: "accessory",
    title: "Accessory",
    items: [
      strengthItem({
        title: "Biceps Curl",
        sets: 3,
        reps: 10,
        restSec: 75,
        rpe: 8,
        rir: 2,
        cues: "Controlled lowering",
      }),
      strengthItem({
        title: "Triceps Pressdown",
        sets: 3,
        reps: 10,
        restSec: 75,
        rpe: 8,
        rir: 2,
        cues: "Lockout and squeeze",
      }),
    ],
  },
];

const MASON_LOWER_STRENGTH_BLOCKS = [
  {
    kind: "main",
    title: "Primary Strength",
    items: [
      strengthItem({
        title: "Back Squat",
        sets: 5,
        reps: 5,
        restSec: 180,
        rpe: 8,
        rir: 2,
        cues: "Brace before every rep, controlled depth",
      }),
      strengthItem({
        title: "Romanian Deadlift",
        sets: 3,
        reps: 6,
        restSec: 150,
        rpe: 8,
        rir: 2,
        cues: "Hinge with tension in hamstrings",
      }),
      strengthItem({
        title: "Walking Lunges",
        sets: 3,
        reps: 10,
        restSec: 90,
        rpe: 7.5,
        rir: 2.5,
        cues: "Per leg, upright torso",
      }),
      strengthItem({
        title: "Hamstring Curl",
        sets: 3,
        reps: 10,
        restSec: 75,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Standing Calf Raises",
        sets: 4,
        reps: 12,
        restSec: 60,
        rpe: 8,
        rir: 2,
      }),
    ],
  },
  {
    kind: "accessory",
    title: "Core",
    items: [
      strengthItem({
        title: "Core Circuit",
        sets: 3,
        reps: 1,
        restSec: 60,
        rpe: 7,
        cues: "45-60s per station, no form breakdown",
      }),
    ],
  },
];

const MASON_UPPER_VOLUME_BLOCKS = [
  {
    kind: "main",
    title: "Hypertrophy",
    items: [
      strengthItem({
        title: "Incline DB Press",
        sets: 4,
        reps: 10,
        restSec: 90,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Lat Pulldown",
        sets: 4,
        reps: 10,
        restSec: 90,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Lateral Raises",
        sets: 4,
        reps: 15,
        restSec: 60,
        rpe: 8.5,
        rir: 1.5,
      }),
      strengthItem({
        title: "Cable Fly",
        sets: 3,
        reps: 12,
        restSec: 60,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Cable Curl",
        sets: 3,
        reps: 12,
        restSec: 60,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Triceps Pushdown",
        sets: 3,
        reps: 12,
        restSec: 60,
        rpe: 8,
        rir: 2,
      }),
    ],
  },
];

const MASON_LOWER_HYPERTROPHY_BLOCKS = [
  {
    kind: "main",
    title: "Lower Hypertrophy",
    items: [
      strengthItem({
        title: "Front Squat or Hack Squat",
        sets: 4,
        reps: 8,
        restSec: 120,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Hip Thrust",
        sets: 4,
        reps: 8,
        restSec: 120,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Single Leg RDL",
        sets: 3,
        reps: 10,
        restSec: 90,
        rpe: 8,
        rir: 2,
        cues: "Per leg, full hip control",
      }),
      strengthItem({
        title: "Leg Extension",
        sets: 3,
        reps: 12,
        restSec: 75,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Hamstring Curl",
        sets: 3,
        reps: 12,
        restSec: 75,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Walking Lunges",
        sets: 3,
        reps: 12,
        restSec: 75,
        rpe: 8,
        rir: 2,
        cues: "Per leg, even stride length",
      }),
      strengthItem({
        title: "Calf Raises",
        sets: 4,
        reps: 12,
        restSec: 60,
        rpe: 8,
        rir: 2,
      }),
      strengthItem({
        title: "Core Carries",
        sets: 3,
        reps: 1,
        restSec: 75,
        rpe: 7.5,
        cues: "30-45s carries, heavy and stable",
      }),
    ],
  },
  {
    kind: "accessory",
    title: "Optional Finisher",
    items: [
      strengthItem({
        title: "Sled Push",
        sets: 4,
        reps: 1,
        restSec: 90,
        rpe: 8.5,
        cues: "Optional, 20-30m efforts",
      }),
      strengthItem({
        title: "Wall Balls",
        sets: 3,
        reps: 20,
        restSec: 75,
        rpe: 8.5,
        cues: "Optional, smooth breathing rhythm",
      }),
    ],
  },
];

function renderGymNotesFromBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .flatMap((block) => (Array.isArray(block?.items) ? block.items : []))
    .map((item) => {
      const title = String(item?.title || item?.name || "Exercise").trim();
      const sets = Number(item?.sets || 0);
      const reps = Number(item?.reps || 0);
      const rpe = Number(item?.rpe || 0);
      const rest = Number(item?.restSec || 0);

      const parts = [title];
      if (sets > 0 && reps > 0) parts.push(`${sets}x${reps}`);
      if (rpe > 0) parts.push(`RPE ${Number(rpe.toFixed(1))}`);
      if (rest > 0) parts.push(`${Math.round(rest)}s rest`);
      return parts.join(" ");
    })
    .join("; ");
}

function withDeloadStrengthBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((block) => ({
    ...block,
    items: (Array.isArray(block?.items) ? block.items : []).map((item) => {
      const sets = Number(item?.sets || 0);
      const timeSec = Number(item?.timeSec || 0);
      const rpe = Number(item?.rpe || 0);
      const rir = Number(item?.rir || 0);
      const restSec = Number(item?.restSec || 0);

      return {
        ...item,
        ...(sets > 0 ? { sets: Math.max(2, Math.round(sets * 0.8)) } : {}),
        ...(timeSec > 0 ? { timeSec: Math.max(45, Math.round(timeSec * 0.85)) } : {}),
        ...(rpe > 0 ? { rpe: Number(Math.max(6, rpe - 0.7).toFixed(1)) } : {}),
        ...(Number.isFinite(rir) && rir >= 0 ? { rir: Number((rir + 1).toFixed(1)) } : {}),
        ...(restSec > 0 ? { restSec: Math.round(restSec + 15) } : {}),
      };
    }),
  }));
}

function makeGymSession(
  name,
  targetDurationMin,
  notes,
  focus = "Strength progression",
  options = {}
) {
  const min = Math.max(20, Math.round(Number(targetDurationMin || 45)));
  const isDeload = !!options?.isDeload;
  const baseBlocks = Array.isArray(options?.blocks) ? deepClone(options.blocks) : [];
  const blocks = isDeload ? withDeloadStrengthBlocks(baseBlocks) : baseBlocks;
  const finalNotes = notes || renderGymNotesFromBlocks(blocks);

  return {
    title: name,
    name,
    type: "Gym",
    sessionType: "gym",
    targetDurationMin: min,
    notes: finalNotes,
    focus,
    emphasis: options?.emphasis || "",
    coaching: {
      weekPhase: isDeload ? "Deload week" : "Build week",
      progressionNote: isDeload
        ? "Reduced volume and slightly lower effort to absorb load."
        : "Progress load with technical precision and controlled effort.",
      recoveryTarget: isDeload ? "Prioritise freshness and quality reps" : "Complete all sets with stable tempo",
      ...(options?.coaching && typeof options.coaching === "object" ? options.coaching : {}),
    },
    blocks,
    workout: {
      sport: "strength",
      totalDurationSec: min * 60,
      totalDistanceKm: 0,
      steps: [],
    },
  };
}

function makeHybridEasySession(distanceKm) {
  const km = Number(distanceKm || 0);
  const estimatedMin = Math.max(30, Math.round(km * 6.2));

  return {
    title: `Easy Run ${km.toFixed(1)} km`,
    name: `Easy Run ${km.toFixed(1)} km`,
    type: "RUN",
    sessionType: "easy",
    targetDurationMin: estimatedMin,
    targetDistanceKm: km,
    notes: "Aerobic maintenance. Keep this conversational at RPE 3-4 and finish fresher than you started.",
    coaching: {
      progressionNote: "Keep cadence light and posture relaxed throughout.",
      recoveryTarget: "Breathing fully under control inside first 3-4 min.",
      exerciseStability: "No surges and no race effort during this run.",
    },
    steps: [
      distanceRunStep(
        "Easy aerobic",
        km,
        "EASY",
        "RPE 3-4. Conversational effort, smooth mechanics, no pace forcing."
      ),
    ],
  };
}

function makeHybridLongSession(distanceKm) {
  const km = Number(distanceKm || 0);
  const estimatedMin = Math.max(55, Math.round(km * 6.15));

  return {
    title: `Long Run ${km.toFixed(1)} km`,
    name: `Long Run ${km.toFixed(1)} km`,
    type: "RUN",
    sessionType: "long",
    targetDurationMin: estimatedMin,
    targetDistanceKm: km,
    notes:
      "Steady long aerobic run at RPE 4-5. Stay patient early, then hold stable rhythm through the final third.",
    coaching: {
      progressionNote: "Build durability with even pacing and no early surges.",
      recoveryTarget: "Hydrate and refuel within 30 min post-run.",
      exerciseStability: "Maintain relaxed shoulders and efficient stride mechanics.",
    },
    steps: [
      distanceRunStep(
        "Long aerobic",
        km,
        "EASY",
        "RPE 4-5. Smooth aerobic output; final 15 min can progress slightly if controlled."
      ),
    ],
  };
}

function makeHybridTempoSession({
  label,
  reps = 1,
  workMin = 20,
  recoverMin = 3,
  warmUpKm = 2.5,
  coolDownKm = 1.5,
  targetDistanceKm,
  notes = "",
}) {
  const safeReps = Math.max(1, Math.round(Number(reps || 1)));
  const safeWorkMin = Math.max(8, Number(workMin || 20));
  const safeRecoverMin = Math.max(1, Number(recoverMin || 3));
  const warmKm = Math.max(1, Number(warmUpKm || 2));
  const coolKm = Math.max(1, Number(coolDownKm || 1));

  const steps = [distanceRunStep("Warm up", warmKm, "EASY", "Build into rhythm")];

  if (safeReps > 1) {
    steps.push(
      repeatBlock({
        reps: safeReps,
        workSec: Math.round(safeWorkMin * 60),
        recoverSec: Math.round(safeRecoverMin * 60),
        workPaceKey: "THRESHOLD",
        recoverPaceKey: "EASY",
        workName: "Tempo",
        recoverName: "Easy float",
        workNotes: "RPE 7-8. Controlled threshold, strong but sustainable.",
        recoverNotes: `RPE 3. Keep this truly easy for ${Math.round(safeRecoverMin)} min.`,
      })
    );
  } else {
    steps.push(
      timeRunStep(
        "Tempo block",
        safeWorkMin,
        "THRESHOLD",
        "RPE 7-8. Controlled, strong, and sustainable through full block."
      )
    );
  }

  steps.push(distanceRunStep("Cool down", coolKm, "EASY", "RPE 2-3. Reset breathing and mechanics."));

  const targetKm =
    Number(targetDistanceKm || 0) > 0
      ? Number(targetDistanceKm)
      : Number((warmKm + coolKm + (safeWorkMin / 4) * safeReps).toFixed(1));

  return {
    title: label || `Tempo ${safeReps > 1 ? `${safeReps} x ${safeWorkMin} min` : `${safeWorkMin} min`}`,
    name: label || `Tempo ${safeReps > 1 ? `${safeReps} x ${safeWorkMin} min` : `${safeWorkMin} min`}`,
    type: "RUN",
    sessionType: "tempo",
    targetDurationMin: Math.round(warmKm * 6 + coolKm * 6 + safeWorkMin * safeReps + safeRecoverMin * (safeReps - 1)),
    targetDistanceKm: Number(targetKm.toFixed(1)),
    notes:
      notes ||
      "Threshold development session. Work reps at RPE 7-8, easy recoveries at RPE 3, with form and breathing under control.",
    coaching: {
      progressionNote: "Prioritise pace stability over chasing one fast rep.",
      recoveryTarget: "Heart rate should settle during recoveries before next rep.",
      exerciseStability: "Hold tall posture and even contact through all tempo work.",
    },
    steps,
  };
}

function makeHybridSpeedSession({
  label,
  reps,
  workMeters,
  recoverSec,
  workPaceKey = "5K",
  warmUpKm = 2.0,
  coolDownKm = 2.0,
  targetDistanceKm,
  notes = "",
}) {
  const safeReps = Math.max(3, Math.round(Number(reps || 6)));
  const safeWorkMeters = Math.max(200, Math.round(Number(workMeters || 400)));
  const safeRecoverSec = Math.max(45, Math.round(Number(recoverSec || 75)));
  const warmKm = Math.max(1, Number(warmUpKm || 2));
  const coolKm = Math.max(1, Number(coolDownKm || 2));

  const title = label || `${safeReps} x ${safeWorkMeters}m Repeats`;
  const workKm = (safeWorkMeters * safeReps) / 1000;
  const computedKm = Number((warmKm + coolKm + workKm).toFixed(1));

  return {
    title,
    name: title,
    type: "RUN",
    sessionType: "intervals",
    targetDurationMin: Math.round(warmKm * 6 + coolKm * 6 + safeReps * ((safeWorkMeters / 1000) * 3.8 + safeRecoverSec / 60)),
    targetDistanceKm: Number((targetDistanceKm || computedKm).toFixed(1)),
    notes:
      notes ||
      `Quality interval session. Fast reps at RPE 8-9 with ${safeRecoverSec}s float/jog recoveries at RPE 3-4.`,
    coaching: {
      progressionNote: "Hit consistent splits across reps before increasing aggression.",
      recoveryTarget: "Float recoveries stay easy enough to repeat quality mechanics.",
      exerciseStability: "Relax shoulders and keep turnover quick, not strained.",
    },
    steps: [
      distanceRunStep(
        "Warm up",
        warmKm,
        "EASY",
        "RPE 2-3. Progressively build effort and include 2-4 short strides before reps."
      ),
      repeatBlock({
        reps: safeReps,
        workMeters: safeWorkMeters,
        recoverSec: safeRecoverSec,
        workPaceKey,
        recoverPaceKey: "EASY",
        workName: safeWorkMeters >= 1000 ? "Rep" : `${safeWorkMeters}m rep`,
        recoverName: "Float recovery",
        workNotes: "RPE 8-9. Fast but repeatable, hold form under pressure.",
        recoverNotes: `RPE 3-4. ${safeRecoverSec}s jog/float, reset breathing before next rep.`,
      }),
      distanceRunStep("Cool down", coolKm, "EASY", "RPE 2-3. Easy jog and full reset."),
    ],
  };
}

function makeHybridLadderSpeedSession() {
  const ladderMeters = [400, 600, 800, 1000, 800, 600, 400];
  const steps = [distanceRunStep("Warm up", 2.0, "EASY", "Stay relaxed and build into work")];

  ladderMeters.forEach((meters, idx) => {
    steps.push(
      distanceRunStep(
        `Fast ${meters}m`,
        meters / 1000,
        meters >= 1000 ? "10K" : "5K",
        "RPE 8-9. Smooth and controlled, quick cadence, no overstriding."
      )
    );
    if (idx < ladderMeters.length - 1) {
      steps.push(
        timeRunStep(
          "Float recover",
          1.25,
          "EASY",
          "RPE 3-4. Jog recovery and reset posture before next rep."
        )
      );
    }
  });

  steps.push(distanceRunStep("Cool down", 2.0, "EASY", "RPE 2-3. Let HR come down gradually."));

  return {
    title: "Ladder 400-600-800-1000",
    name: "Ladder 400-600-800-1000",
    type: "RUN",
    sessionType: "intervals",
    targetDurationMin: 60,
    targetDistanceKm: 8.6,
    notes:
      "Ladder quality session. Fast reps at RPE 8-9, float recoveries at RPE 3-4, and pace discipline as reps extend.",
    coaching: {
      progressionNote: "Control opening reps so quality stays high on longer middle reps.",
      recoveryTarget: "Use float jog recoveries to restore rhythm, not complete stop.",
      exerciseStability: "Stay tall and keep ground contact quick through fatigue.",
    },
    steps,
  };
}

function buildMasonHybrid6WeekTemplate() {
  const easyKm = [8.0, 9.0, 10.0, 10.0, 10.5, 7.5];
  const longKm = [12.0, 14.0, 15.0, 17.0, 18.0, 14.0];
  const speedSessions = [
    makeHybridSpeedSession({
      label: "6 x 800m Repeats",
      reps: 6,
      workMeters: 800,
      recoverSec: 90,
      workPaceKey: "5K",
      targetDistanceKm: 8.8,
      notes: "6 x 800m at controlled hard effort. 90s float/jog between reps.",
    }),
    makeHybridSpeedSession({
      label: "12 x 400m Repeats",
      reps: 12,
      workMeters: 400,
      recoverSec: 60,
      workPaceKey: "3K",
      targetDistanceKm: 8.8,
      notes: "12 x 400m with short recoveries. Keep pace smooth and repeatable.",
    }),
    makeHybridSpeedSession({
      label: "5 x 1k Repeats",
      reps: 5,
      workMeters: 1000,
      recoverSec: 120,
      workPaceKey: "10K",
      targetDistanceKm: 9.0,
      notes: "5 x 1k with 2:00 recoveries. Controlled threshold-10k effort.",
    }),
    makeHybridLadderSpeedSession(),
    makeHybridSpeedSession({
      label: "14 x 400m Repeats",
      reps: 14,
      workMeters: 400,
      recoverSec: 60,
      workPaceKey: "3K",
      targetDistanceKm: 9.6,
      notes: "Progression week: 14 x 400m. Keep rhythm and avoid forcing early reps.",
    }),
    makeHybridSpeedSession({
      label: "4 x 1k Repeats (Deload)",
      reps: 4,
      workMeters: 1000,
      recoverSec: 120,
      workPaceKey: "10K",
      warmUpKm: 1.5,
      coolDownKm: 1.5,
      targetDistanceKm: 7.0,
      notes: "Deload quality: lower rep count, keep mechanics sharp.",
    }),
  ];

  const tempoSessions = [
    makeHybridTempoSession({
      label: "Tempo 20 min",
      reps: 1,
      workMin: 20,
      targetDistanceKm: 9.0,
      notes: "20 min continuous tempo. Settle and hold.",
    }),
    makeHybridTempoSession({
      label: "Tempo 2 x 12 min",
      reps: 2,
      workMin: 12,
      recoverMin: 3,
      targetDistanceKm: 9.5,
      notes: "2 x 12 min tempo with 3 min easy between.",
    }),
    makeHybridTempoSession({
      label: "Tempo 25 min",
      reps: 1,
      workMin: 25,
      targetDistanceKm: 10.2,
      notes: "25 min continuous tempo. Controlled progression through final 8 min.",
    }),
    makeHybridTempoSession({
      label: "Tempo 3 x 10 min",
      reps: 3,
      workMin: 10,
      recoverMin: 3,
      targetDistanceKm: 12.0,
      notes: "3 x 10 min tempo, 3 min easy recoveries.",
    }),
    makeHybridTempoSession({
      label: "Tempo 30 min",
      reps: 1,
      workMin: 30,
      targetDistanceKm: 11.5,
      notes: "30 min sustained tempo at controlled threshold effort.",
    }),
    makeHybridTempoSession({
      label: "Tempo 20 min (Deload)",
      reps: 1,
      workMin: 20,
      warmUpKm: 2.0,
      coolDownKm: 1.5,
      targetDistanceKm: 8.5,
      notes: "Deload tempo. Keep this smooth and never maximal.",
    }),
  ];

  const weeks = Array.from({ length: 6 }).map((_, wi) => {
    const weekNumber = wi + 1;
    const isDeload = weekNumber === 6;
    const speedSession = withSessionLabels(
      withSessionCoaching(speedSessions[wi], {
        weekPhase: isDeload ? "Deload week" : `Build week ${weekNumber}`,
        progressionNote: isDeload
          ? "Reduced quality volume; keep mechanics sharp and efficient."
          : `Primary quality day for week ${weekNumber}; target even split execution.`,
        recoveryTarget: "Between reps, recover enough to preserve quality mechanics.",
        exerciseStability: "No sprinting first reps. Build quality through the set.",
      }),
      "run",
      "intervals"
    );
    const easySession = withSessionLabels(
      withSessionCoaching(makeHybridEasySession(easyKm[wi]), {
        weekPhase: isDeload ? "Deload week" : `Build week ${weekNumber}`,
      }),
      "run",
      "easy"
    );
    const longSession = withSessionLabels(
      withSessionCoaching(makeHybridLongSession(longKm[wi]), {
        weekPhase: isDeload ? "Deload week" : `Build week ${weekNumber}`,
      }),
      "run",
      "long"
    );
    const tempoSession = withSessionLabels(
      withSessionCoaching(tempoSessions[wi], {
        weekPhase: isDeload ? "Deload week" : `Build week ${weekNumber}`,
        progressionNote: isDeload
          ? "Keep tempo controlled and submaximal."
          : "Hold threshold control with stable breathing and form.",
        recoveryTarget: "Complete cooldown with breathing recovered and no residual strain.",
        exerciseStability: "Rhythm and posture should remain consistent through final rep/minutes.",
      }),
      "run",
      "tempo"
    );

    const upperStrength = withSessionLabels(
      makeGymSession(
      "Upper Strength",
      isDeload ? 50 : 60,
      "",
      "Upper-body max strength",
      {
        blocks: MASON_UPPER_STRENGTH_BLOCKS,
        isDeload,
        emphasis: "Upper-body max strength",
      }
      ),
      "strength",
      "gym"
    );
    const lowerStrength = withSessionLabels(
      makeGymSession(
      "Lower Strength",
      isDeload ? 55 : 65,
      "",
      "Lower-body max strength",
      {
        blocks: MASON_LOWER_STRENGTH_BLOCKS,
        isDeload,
        emphasis: "Lower-body max strength",
      }
      ),
      "strength",
      "gym"
    );
    const upperVolume = withSessionLabels(
      makeGymSession(
      "Upper Volume",
      isDeload ? 45 : 55,
      "",
      "Upper-body hypertrophy and durability",
      {
        blocks: MASON_UPPER_VOLUME_BLOCKS,
        isDeload,
        emphasis: "Upper-body volume",
      }
      ),
      "strength",
      "gym"
    );
    const lowerHypertrophy = withSessionLabels(
      makeGymSession(
      "Lower Hypertrophy",
      isDeload ? 50 : 60,
      "",
      "Lower-body hypertrophy and tissue resilience",
      {
        blocks: MASON_LOWER_HYPERTROPHY_BLOCKS,
        isDeload,
        emphasis: "Lower-body hypertrophy",
      }
      ),
      "strength",
      "gym"
    );

    const daySessions = {
      Mon: [upperStrength],
      Tue: [speedSession],
      Wed: [lowerStrength],
      Thu: [easySession],
      Fri: [upperVolume],
      Sat: [longSession],
      Sun: [tempoSession, lowerHypertrophy],
    };

    const days = DAYS.map((day) => ({
      day,
      sessions: (daySessions[day] || []).map((sess) => ({ ...sess, day })),
    }));

    const weeklyRunKm = Number(
      (
        Number(speedSession?.targetDistanceKm || 0) +
        Number(easySession?.targetDistanceKm || 0) +
        Number(longSession?.targetDistanceKm || 0) +
        Number(tempoSession?.targetDistanceKm || 0)
      ).toFixed(1)
    );

    return {
      title: `Week ${weekNumber}`,
      weekIndex0: wi,
      weekNumber,
      focus: isDeload
        ? "Deload and absorb"
        : weekNumber <= 2
        ? "Build consistency"
        : weekNumber <= 4
        ? "Progressive load"
        : "Peak load and execute",
      phase: {
        label: isDeload ? "Deload" : "Build",
        isDeload,
        isTaper: false,
      },
      targets: {
        weeklyKm: weeklyRunKm,
        longRunKm: Number(longSession?.targetDistanceKm || 0),
        isDeload,
        isTaper: false,
        qualityFactor: isDeload ? 0.82 : 1,
        volumeFactor: isDeload ? 0.8 : 1,
      },
      days,
    };
  });

  const targets = weeks.map((week) => ({
    weekNumber: week.weekNumber,
    weeklyKm: Number(week?.targets?.weeklyKm || 0),
    longRunKm: Number(week?.targets?.longRunKm || 0),
    isDeload: !!week?.targets?.isDeload,
    isTaper: false,
  }));

  const now = Date.now();
  const createdAt = now - TEMPLATE_CONFIGS.length * 1000 - 500;

  return {
    id: "coach_mason_hybrid_6w_1_1",
    name: "Mason Bickers 6 week hybrid plan 1.1",
    kind: "hybrid",
    source: "coach-template-local",
    isCoachPlan: true,
    isPublished: true,
    visibility: "public",
    createdByRole: "coach",
    coachName: "Mason Bickers",
    primaryActivity: "Hybrid",
    description:
      "6-week hybrid block blending 4 run sessions with 4 strength sessions each week. Includes progressive run volume, weekly quality structure, and a final deload.",
    goalType: "Half marathon + Hybrid performance",
    sessionsPerWeek: 8,
    targets,
    weeks,
    meta: {
      name: "Mason Bickers 6 week hybrid plan 1.1",
      coachName: "Mason Bickers",
      primaryActivity: "Hybrid",
      isCoachPlan: true,
      published: true,
      primaryFocus: "Hybrid half marathon build",
      profile: "Intermediate to advanced",
      quality: "professional-coach-template",
      periodisation: "4-week progressive build + peak week + deload week",
      coachSpecialty: "Hybrid running and strength integration",
      sessionsPerWeek: 8,
      planVersion: "1.1",
    },
    createdAt,
    updatedAt: createdAt,
  };
}

const TEMPLATE_CONFIGS = [
  {
    id: "coach_elena_foundation_10k_8w4",
    name: "Elena Foundation",
    coachName: "Elena Marquez",
    coachSpecialty: "Female performance running",
    goalType: "10K",
    planLabel: "10K in 8 Weeks",
    description:
      "Foundation-first 10K build focused on aerobic consistency, controlled tempo, and durable progression.",
    mode: "foundation",
    levelLabel: "Foundation",
    easyKm: [5.0, 5.5, 6.0, 6.0, 6.5, 7.0, 7.0, 5.5],
    tempoKm: [5.5, 6.0, 6.0, 6.5, 6.5, 7.0, 7.0, 5.5],
    tempoMinutes: [12, 14, 15, 16, 18, 20, 22, 12],
    longKm: [8.0, 9.0, 10.0, 11.0, 11.5, 12.0, 13.0, 9.0],
  },
  {
    id: "coach_tom_progressive_10k_8w4",
    name: "Tom Progressive",
    coachName: "Tom Caldwell",
    coachSpecialty: "Race-pace progression",
    goalType: "10K",
    planLabel: "10K in 8 Weeks",
    description:
      "Progressive 10K block for athletes ready for higher weekly volume and longer threshold segments.",
    mode: "progressive",
    levelLabel: "Progressive",
    easyKm: [6.0, 6.0, 7.0, 7.0, 8.0, 8.0, 9.0, 6.0],
    tempoKm: [6.0, 6.5, 7.0, 7.5, 8.0, 8.0, 8.5, 6.0],
    tempoMinutes: [15, 17, 18, 20, 22, 24, 26, 14],
    longKm: [10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 10.0],
  },
  {
    id: "coach_nadia_performance_10k_8w4",
    name: "Nadia Performance",
    coachName: "Nadia Petrov",
    coachSpecialty: "Sub-40 10K prep",
    goalType: "10K",
    planLabel: "Performance 10K Block",
    description:
      "High-quality performance 10K plan with tight recoveries and aggressive race-specific sessions.",
    mode: "performance",
    levelLabel: "Performance",
    easyKm: [7.0, 7.5, 8.0, 8.0, 9.0, 9.5, 10.0, 7.0],
    tempoKm: [7.0, 7.5, 8.0, 8.5, 9.0, 9.0, 9.5, 7.0],
    tempoMinutes: [18, 20, 22, 24, 26, 28, 30, 16],
    longKm: [12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 12.0],
  },
  {
    id: "coach_liam_durability_10k_8w4",
    name: "Liam Durability",
    coachName: "Liam O'Donnell",
    coachSpecialty: "Injury-resilient progression",
    goalType: "10K",
    planLabel: "Durability 10K Block",
    description:
      "Durability-led progression for athletes returning to structure and building robust weekly rhythm.",
    mode: "foundation",
    levelLabel: "Foundation",
    easyKm: [5.5, 6.0, 6.0, 6.5, 7.0, 7.0, 7.5, 6.0],
    tempoKm: [5.0, 5.5, 6.0, 6.0, 6.5, 6.5, 7.0, 5.5],
    tempoMinutes: [12, 13, 14, 15, 16, 18, 19, 12],
    longKm: [8.5, 9.5, 10.5, 11.0, 11.5, 12.5, 13.0, 9.0],
  },
  {
    id: "coach_sophia_racecraft_10k_8w4",
    name: "Sophia Racecraft",
    coachName: "Sophia Kim",
    coachSpecialty: "Race execution and pacing",
    goalType: "10K",
    planLabel: "Racecraft 10K Block",
    description:
      "Racecraft-focused progression with pacing control, threshold confidence, and late-block sharpening.",
    mode: "progressive",
    levelLabel: "Progressive",
    easyKm: [6.0, 6.5, 7.0, 7.0, 7.5, 8.0, 8.0, 6.5],
    tempoKm: [6.0, 6.0, 6.5, 7.0, 7.5, 7.5, 8.0, 6.0],
    tempoMinutes: [14, 16, 18, 19, 21, 23, 24, 14],
    longKm: [9.5, 10.5, 11.5, 12.5, 13.0, 14.0, 14.5, 10.0],
  },
  {
    id: "coach_mateo_threshold_10k_8w4",
    name: "Mateo Threshold",
    coachName: "Mateo Ruiz",
    coachSpecialty: "Threshold development",
    goalType: "10K",
    planLabel: "Threshold 10K Block",
    description:
      "Threshold-biased build for athletes targeting stronger sustained pace and improved lactate control.",
    mode: "performance",
    levelLabel: "Performance",
    easyKm: [6.5, 7.0, 7.5, 8.0, 8.5, 8.5, 9.0, 6.5],
    tempoKm: [7.0, 7.5, 8.0, 8.5, 8.5, 9.0, 9.5, 7.0],
    tempoMinutes: [18, 20, 22, 24, 25, 27, 29, 16],
    longKm: [11.0, 12.0, 13.0, 14.0, 14.5, 15.5, 16.0, 11.0],
  },
  {
    id: "coach_hana_competition_10k_8w4",
    name: "Hana Competition",
    coachName: "Hana Suzuki",
    coachSpecialty: "Elite competition prep",
    goalType: "10K",
    planLabel: "Competition 10K Block",
    description:
      "Competition-style quality distribution with precise workouts for experienced performance athletes.",
    mode: "performance",
    levelLabel: "Performance",
    easyKm: [7.0, 7.5, 8.0, 8.5, 9.0, 9.0, 9.5, 7.0],
    tempoKm: [7.5, 8.0, 8.5, 9.0, 9.0, 9.5, 10.0, 7.0],
    tempoMinutes: [19, 21, 23, 25, 27, 29, 31, 17],
    longKm: [12.0, 13.0, 14.0, 15.0, 15.5, 16.5, 17.0, 12.0],
  },
  {
    id: "coach_reece_hybrid_10k_8w4",
    name: "Reece Hybrid Runner",
    coachName: "Reece Bennett",
    coachSpecialty: "Hybrid athlete integration",
    goalType: "10K",
    planLabel: "Hybrid-Friendly 10K Block",
    description:
      "Hybrid-friendly 10K plan balancing quality running with manageable total load for mixed training weeks.",
    mode: "progressive",
    levelLabel: "Progressive",
    easyKm: [5.5, 6.0, 6.5, 6.5, 7.0, 7.0, 7.5, 6.0],
    tempoKm: [5.5, 6.0, 6.5, 7.0, 7.0, 7.5, 8.0, 6.0],
    tempoMinutes: [14, 15, 17, 18, 20, 22, 24, 14],
    longKm: [9.0, 10.0, 11.0, 12.0, 12.5, 13.5, 14.0, 9.5],
  },
  {
    id: "coach_amina_sharpener_10k_8w4",
    name: "Amina Sharpener",
    coachName: "Amina El-Sayed",
    coachSpecialty: "Late-block race sharpening",
    goalType: "10K",
    planLabel: "Sharpening 10K Block",
    description:
      "Sharpening-focused block with quality progression and controlled taper for confident race execution.",
    mode: "performance",
    levelLabel: "Performance",
    easyKm: [6.5, 7.0, 7.5, 7.5, 8.0, 8.5, 8.5, 6.0],
    tempoKm: [6.5, 7.0, 7.5, 8.0, 8.5, 8.5, 9.0, 6.5],
    tempoMinutes: [17, 19, 21, 23, 24, 26, 28, 15],
    longKm: [10.5, 11.5, 12.5, 13.5, 14.0, 15.0, 15.5, 10.5],
  },
  {
    id: "coach_grace_return_10k_8w4",
    name: "Grace Return-to-Race",
    coachName: "Grace Holloway",
    coachSpecialty: "Return to racing",
    goalType: "10K",
    planLabel: "Return to Racing 10K",
    description:
      "Professional return-to-race pathway with conservative load progression and smart quality sessions.",
    mode: "foundation",
    levelLabel: "Foundation",
    easyKm: [5.0, 5.5, 5.5, 6.0, 6.5, 6.5, 7.0, 5.5],
    tempoKm: [5.0, 5.5, 6.0, 6.0, 6.5, 6.5, 7.0, 5.5],
    tempoMinutes: [11, 12, 14, 15, 16, 17, 19, 11],
    longKm: [8.0, 8.5, 9.5, 10.0, 11.0, 11.5, 12.5, 8.5],
  },
];

const MASON_HYBRID_6_WEEK_PLAN_1_1 = buildMasonHybrid6WeekTemplate();

export const MASON_COACH_TEMPLATE_DOCS = [
  ...TEMPLATE_CONFIGS.map((cfg, idx) => build10k8w4Template(cfg, idx)),
  MASON_HYBRID_6_WEEK_PLAN_1_1,
];

export const COACH_PLAN_PACE_PROFILES = [
  { key: "conservative", label: "Conservative" },
  { key: "balanced", label: "Balanced" },
  { key: "aggressive", label: "Aggressive" },
];

export const COACH_PLAN_MILEAGE_FACTORS = [
  { key: "0.90", label: "-10%", value: 0.9 },
  { key: "1.00", label: "Standard", value: 1.0 },
  { key: "1.10", label: "+10%", value: 1.1 },
];

export const DEFAULT_COACH_PLAN_PERSONALISATION = {
  tenKPace: "5:30",
  paceProfile: "balanced",
  mileageScale: 1.0,
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function parsePaceToSecPerKm(v) {
  const m = String(v || "")
    .trim()
    .match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const ss = Number(m[2]);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return null;
  return mm * 60 + ss;
}

export function formatSecPerKm(v) {
  const sec = Number(v);
  if (!Number.isFinite(sec) || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getPaceOffsets(profileKey) {
  const key = String(profileKey || "balanced").toLowerCase();
  if (key === "conservative") {
    return { easy: 85, threshold: 20, k10: 0, k5: -14, k3: -24 };
  }
  if (key === "aggressive") {
    return { easy: 65, threshold: 8, k10: 0, k5: -24, k3: -36 };
  }
  return { easy: 75, threshold: 12, k10: 0, k5: -20, k3: -30 };
}

function paceFromKey(paceKey, base10kSec, profileKey) {
  const key = String(paceKey || "").toUpperCase();
  if (!key) return null;

  const offsets = getPaceOffsets(profileKey);

  if (key.includes("EASY")) return base10kSec + offsets.easy;
  if (key.includes("RECOVERY")) return base10kSec + offsets.easy + 10;
  if (key.includes("THRESH") || key.includes("TEMPO")) return base10kSec + offsets.threshold;
  if (key.includes("10K")) return base10kSec + offsets.k10;
  if (key.includes("5K")) return base10kSec + offsets.k5;
  if (key.includes("3K") || key.includes("VO2")) return base10kSec + offsets.k3;
  return null;
}

function scaleDistanceMeters(rawMeters, mileageScale) {
  const meters = Number(rawMeters);
  if (!Number.isFinite(meters) || meters <= 0) return rawMeters;
  const scaled = Math.round(meters * mileageScale);
  return clamp(scaled, 200, 60000);
}

function scaleDistanceKm(rawKm, mileageScale) {
  const km = Number(rawKm);
  if (!Number.isFinite(km) || km <= 0) return rawKm;
  const scaled = km * mileageScale;
  return Number(clamp(scaled, 0.2, 60).toFixed(1));
}

function scaleDurationMin(rawMin, mileageScale) {
  const min = Number(rawMin);
  if (!Number.isFinite(min) || min <= 0) return rawMin;
  const scaled = Math.round(min * mileageScale);
  return clamp(scaled, 8, 240);
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function personaliseStep(step, options) {
  if (!step || typeof step !== "object") return step;

  const {
    mileageScale = 1,
    paceProfile = "balanced",
    base10kSec = parsePaceToSecPerKm(DEFAULT_COACH_PLAN_PERSONALISATION.tenKPace),
  } = options || {};

  const out = { ...step };
  const type = String(out.type || "").toUpperCase();

  if (type === "REPEAT") {
    out.steps = Array.isArray(out.steps)
      ? out.steps.map((x) => personaliseStep(x, options))
      : [];
    return out;
  }

  const duration = out.duration && typeof out.duration === "object" ? { ...out.duration } : null;
  if (duration && String(duration.type || "").toUpperCase() === "DISTANCE") {
    duration.meters = scaleDistanceMeters(duration.meters, mileageScale);
  }
  if (duration) out.duration = duration;

  const target = out.target && typeof out.target === "object" ? { ...out.target } : {};
  const paceKey = String(target.paceKey || "").toUpperCase();
  if (paceKey) {
    const paceSecPerKm = paceFromKey(paceKey, base10kSec, paceProfile);
    if (Number.isFinite(paceSecPerKm) && paceSecPerKm > 0) {
      target.paceSecPerKm = Math.round(paceSecPerKm);
      out.pace = { key: paceKey, secPerKm: Math.round(paceSecPerKm) };
    }
  }
  out.target = Object.keys(target).length ? target : null;

  return out;
}

function personaliseSession(session, options) {
  if (!session || typeof session !== "object") return session;
  const mileageScale = Number(options?.mileageScale || 1);
  const out = { ...session };

  if (out.targetDistanceKm != null) {
    out.targetDistanceKm = scaleDistanceKm(out.targetDistanceKm, mileageScale);
  }
  if (out.distanceKm != null) {
    out.distanceKm = scaleDistanceKm(out.distanceKm, mileageScale);
  }
  if (out.plannedDistanceKm != null) {
    out.plannedDistanceKm = scaleDistanceKm(out.plannedDistanceKm, mileageScale);
  }
  if (out.targetDurationMin != null) {
    out.targetDurationMin = scaleDurationMin(out.targetDurationMin, mileageScale);
  }

  out.steps = Array.isArray(out.steps)
    ? out.steps.map((step) => personaliseStep(step, options))
    : [];

  return out;
}

function personaliseWeeks(weeks, options) {
  const src = Array.isArray(weeks) ? weeks : [];
  return src.map((week) => {
    const outWeek = { ...week };
    if (Array.isArray(week?.days)) {
      outWeek.days = week.days.map((day) => ({
        ...day,
        sessions: (Array.isArray(day?.sessions) ? day.sessions : []).map((s) =>
          personaliseSession(s, options)
        ),
      }));
    }

    if (Array.isArray(week?.sessions)) {
      outWeek.sessions = week.sessions.map((s) => personaliseSession(s, options));
    }
    return outWeek;
  });
}

export function getCoachTemplateById(templateId) {
  const id = String(templateId || "");
  return MASON_COACH_TEMPLATE_DOCS.find((tpl) => String(tpl?.id || "") === id) || null;
}

export function personaliseCoachTemplateDoc(templateDoc, personalisation = {}) {
  const source = templateDoc && typeof templateDoc === "object" ? deepClone(templateDoc) : {};

  const paceProfileRaw = String(personalisation?.paceProfile || "balanced").toLowerCase();
  const paceProfile =
    COACH_PLAN_PACE_PROFILES.some((x) => x.key === paceProfileRaw) ? paceProfileRaw : "balanced";

  const mileageScaleRaw = Number(personalisation?.mileageScale);
  const mileageScale = Number.isFinite(mileageScaleRaw)
    ? clamp(mileageScaleRaw, 0.8, 1.25)
    : DEFAULT_COACH_PLAN_PERSONALISATION.mileageScale;

  const parsedPace = parsePaceToSecPerKm(personalisation?.tenKPace);
  const base10kSec =
    parsedPace != null
      ? parsedPace
      : parsePaceToSecPerKm(DEFAULT_COACH_PLAN_PERSONALISATION.tenKPace);
  const tenKPace = parsedPace != null ? personalisation.tenKPace : DEFAULT_COACH_PLAN_PERSONALISATION.tenKPace;

  const weeks = personaliseWeeks(source.weeks, { mileageScale, paceProfile, base10kSec });

  return {
    ...source,
    weeks,
    meta: {
      ...(source.meta || {}),
      personalisation: {
        tenKPace,
        paceProfile,
        mileageScale,
      },
    },
  };
}

// Expo Router scans files under app/ as routes. Provide a no-op default export
// so this data module does not trigger a missing-default-export warning.
export default function CoachTemplatesDataRoute() {
  return null;
}
