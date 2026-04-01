// server/routes/ai-plan.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*  OpenAI client                                                             */
/* -------------------------------------------------------------------------- */

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const defaultWeeks = 4;
const defaultSessionsPerWeek = 4;

/* ------------------------------- Rule config ------------------------------ */

const RULES = {
  hardDaysPerWeekByExperience: {
    "New to running": 1,
    "Some experience": 1,
    "Regular runner": 2,
    "Advanced/competitive": 2,
  },
  deload: { everyNWeeks: 4, reducePct: 0.2 },
};

/* ------------------------------- Time parsing ----------------------------- */

function parseTimeToSeconds(str) {
  if (!str) return null;
  const s = String(str).trim();
  // Accept: "20:30", "1:35:00", "00:42:10"
  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || isNaN(Number(p)))) return null;

  if (parts.length === 2) {
    const [mm, ss] = parts.map(Number);
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts.map(Number);
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

/**
 * Estimate easy-pace minutes per km from a 10K time if present.
 * Very rough, but good enough for distributing duration targets.
 */
function estimateEasyMinPerKmFrom10k(current10kTime) {
  const sec = parseTimeToSeconds(current10kTime);
  if (!sec) return 6.0; // default
  const tenKMinPerKm = (sec / 60) / 10;
  // easy pace ~ +20% to +30% slower than 10K pace
  const easy = tenKMinPerKm * 1.25;
  return clamp(easy, 4.5, 7.5);
}

/* -------------------------- Distance label → km --------------------------- */

function parseDistanceToKm(label) {
  if (!label) return null;
  const lower = String(label).toLowerCase().trim();

  if (lower.includes("5k")) return 5;
  if (lower.includes("10k")) return 10;
  if (lower.includes("half")) return 21.1;
  if (lower.includes("marathon") && !lower.includes("half")) return 42.2;
  if (lower.includes("ultra")) return 50;

  const match = lower.match(
    /(\d+(\.\d+)?)\s*(k|km|kilomet(er|re)s?|mile|mi)\b/
  );
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[3];

  if (!isFinite(value)) return null;

  if (unit.startsWith("k")) return value;
  if (unit.startsWith("m")) return value * 1.60934;

  return null;
}

/* --------------------------- Schema-safe builders ------------------------- */

function makeRunSession({
  title,
  tags = [],
  notes = "",
  warmupMin = 10,
  mainMin = 30,
  mainDesc = "Continuous running at the prescribed effort.",
  mainRpe = "RPE 4–5",
  mainIntensity = "Easy · conversational · HR Z2",
  cooldownMin = 10,
}) {
  // IMPORTANT: Must match your schema exactly (no extra fields)
  return {
    title,
    sessionType: "run",
    layout: "run-steps",
    tags,
    notes,
    segments: [
      {
        kind: "runStep",
        label: "Warm-up",
        description:
          "10 min easy jog, gradually building. Add light mobility/drills if you like.",
        distanceKm: 0,
        durationMin: warmupMin,
        reps: 0,
        sets: 1,
        loadKg: 0,
        stationName: "",
        rpe: "RPE 3–4",
        intensity: "Z1–Z2 · very easy / conversational",
      },
      {
        kind: "runStep",
        label: "Main",
        description: mainDesc,
        distanceKm: 0,
        durationMin: mainMin,
        reps: 0,
        sets: 1,
        loadKg: 0,
        stationName: "",
        rpe: mainRpe,
        intensity: mainIntensity,
      },
      {
        kind: "runStep",
        label: "Cool-down",
        description:
          "5–10 min very easy jog or brisk walk, then light calf/hamstring/hip mobility.",
        distanceKm: 0,
        durationMin: cooldownMin,
        reps: 0,
        sets: 1,
        loadKg: 0,
        stationName: "",
        rpe: "RPE 2–3",
        intensity: "Z1 · very easy",
      },
    ],
  };
}

function ensure7Days(week) {
  const map = new Map((week?.days || []).map((d) => [d.day, d]));
  const days = DAYS.map((day) => {
    const existing = map.get(day);
    if (existing && Array.isArray(existing.sessions)) {
      return { day, sessions: existing.sessions };
    }
    return { day, sessions: [] };
  });

  return { ...week, days };
}

function dayHasRun(dayObj) {
  return Array.isArray(dayObj?.sessions) && dayObj.sessions.length > 0;
}

function sessionLooksHard(sess) {
  const tags = (sess?.tags || []).map((t) => String(t).toLowerCase());
  const t = String(sess?.title || "").toLowerCase();

  const hardTag =
    tags.includes("tempo") ||
    tags.includes("intervals") ||
    tags.includes("hills") ||
    tags.includes("racepace") ||
    tags.includes("quality");

  const hardTitle =
    t.includes("tempo") ||
    t.includes("interval") ||
    t.includes("hills") ||
    t.includes("race pace") ||
    t.includes("threshold");

  return hardTag || hardTitle;
}

function sessionLooksLong(sess) {
  const tags = (sess?.tags || []).map((t) => String(t).toLowerCase());
  const t = String(sess?.title || "").toLowerCase();
  return tags.includes("long") || t.includes("long run");
}

function downgradeToEasy(sess) {
  // Keep schema; just adjust content
  return makeRunSession({
    title: "Easy run",
    tags: ["easy", "aerobic"],
    notes:
      (sess?.notes ? `${sess.notes} ` : "") +
      "Adjusted to easy to fit plan rules (recovery and distribution).",
    warmupMin: 10,
    mainMin: clamp(Number(sess?.segments?.[1]?.durationMin) || 30, 20, 50),
    mainDesc:
      "Continuous easy run at conversational pace. Keep breathing controlled and relaxed.",
    mainRpe: "RPE 4–5",
    mainIntensity: "Easy · conversational · HR Z2",
    cooldownMin: 10,
  });
}

/* ------------------------- Rules: structure + repair ---------------------- */

function pickLongRunDay(longRunDay) {
  if (longRunDay === "Sat" || longRunDay === "Sun" || longRunDay === "Fri") {
    return longRunDay;
  }
  // "Any" or unknown → default weekend
  return "Sun";
}

function choosePreferredRunDays(sessionsPerWeek, longRunDay) {
  // Safe defaults; feel “Runna-like” and avoids back-to-back hard naturally
  const lr = pickLongRunDay(longRunDay);

  const presets = {
    2: ["Tue", lr],
    3: ["Tue", "Thu", lr],
    4: ["Tue", "Thu", lr, "Sun"],
    5: ["Mon", "Tue", "Thu", lr, "Sun"],
    6: ["Mon", "Tue", "Wed", "Thu", lr, "Sun"],
    7: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  };

  const days = presets[clamp(Number(sessionsPerWeek) || 4, 2, 7)] || presets[4];
  return Array.from(new Set(days));
}

/**
 * Apply Runna-style rules WITHOUT adding any new JSON fields
 * (schema has additionalProperties: false).
 */
function applyRunPlanRules({
  plan,
  athleteProfile,
  sessionsPerWeek,
  weeksCount,
  current10kTime,
}) {
  if (!plan || !Array.isArray(plan.weeks)) return plan;

  const experience =
    athleteProfile?.current?.experience || "Some experience";
  const hardCap =
    RULES.hardDaysPerWeekByExperience[experience] ?? 1;

  const weeklyKmStart = Number(athleteProfile?.current?.weeklyKm || 0) || 15;
  const longestRunKmStart =
    Number(athleteProfile?.current?.longestRunKm || 0) || Math.max(6, weeklyKmStart * 0.3);

  const goalDistanceLabel = athleteProfile?.goal?.distance || "";
  const goalKm = parseDistanceToKm(goalDistanceLabel);

  const longRunDay = pickLongRunDay(
    athleteProfile?.availability?.longRunDay || "Sun"
  );

  const easyMinPerKm = estimateEasyMinPerKmFrom10k(current10kTime);

  const cleanWeeks = clamp(Number(weeksCount) || plan.weeks.length || 12, 1, 24);
  const cleanSessions = clamp(Number(sessionsPerWeek) || 4, 1, 7);

  const preferredRunDays = choosePreferredRunDays(cleanSessions, longRunDay);

  // Build simple weekly km progression with deloads (no extra fields saved)
  let wkKm = Math.max(weeklyKmStart, 8);
  let lrKm = Math.max(longestRunKmStart, wkKm * 0.3);

  const fixedWeeks = plan.weeks.slice(0, cleanWeeks).map((rawWeek, wi) => {
    const weekIndex = wi + 1;
    const isDeload =
      RULES.deload.everyNWeeks > 0 && weekIndex % RULES.deload.everyNWeeks === 0;

    // keep progression gentle
    const growth = Math.min(wkKm * 0.1, 6);
    const targetWkKm = isDeload ? Math.max(wkKm * (1 - RULES.deload.reducePct), 8) : wkKm;

    // long run constraints
    const longCap = targetWkKm * 0.4;
    const targetLrKm = Math.min(lrKm, longCap);

    // Convert target weekly km to minutes using estimated easy pace.
    // This lets us “normalise” session durations without needing exact paces.
    const weeklyMinTarget = clamp(targetWkKm * easyMinPerKm, 90, 420);

    // Rough distribution:
    // - Long run main ≈ 35% of weekly minutes (cap sensible)
    // - Quality main ≈ 18–22%
    // - Remaining split across easy runs
    const longMainMin = clamp(weeklyMinTarget * 0.35, 40, goalKm && goalKm >= 21 ? 120 : 95);
    const qualityMainMin = clamp(weeklyMinTarget * 0.20, 20, 55);

    // Ensure 7 days, keep schema intact
    let week = ensure7Days(rawWeek);

    // 1) Force exactly sessionsPerWeek run days (add/remove easy runs)
    let runDaysNow = week.days.filter(dayHasRun).map((d) => d.day);

    // Remove extra run days first (prefer removing easiest/shortest)
    while (runDaysNow.length > cleanSessions) {
      // candidates not in preferredRunDays first
      const removable = week.days
        .filter((d) => dayHasRun(d))
        .map((d) => ({
          day: d.day,
          hard: d.sessions.some(sessionLooksHard),
          long: d.sessions.some(sessionLooksLong),
          preferred: preferredRunDays.includes(d.day),
        }))
        .filter((x) => !x.long) // never remove long run day
        .sort((a, b) => {
          // remove non-preferred + easy first
          if (a.preferred !== b.preferred) return a.preferred ? 1 : -1;
          if (a.hard !== b.hard) return a.hard ? 1 : -1;
          return 0;
        });

      const pick = removable[0];
      if (!pick) break;
      const idx = week.days.findIndex((d) => d.day === pick.day);
      if (idx >= 0) week.days[idx] = { ...week.days[idx], sessions: [] };
      runDaysNow = week.days.filter(dayHasRun).map((d) => d.day);
    }

    // Add missing run days as easy runs on preferred days
    while (runDaysNow.length < cleanSessions) {
      const candidateDay =
        preferredRunDays.find((d) => !runDaysNow.includes(d)) ||
        DAYS.find((d) => !runDaysNow.includes(d));

      if (!candidateDay) break;

      const idx = week.days.findIndex((d) => d.day === candidateDay);
      if (idx >= 0) {
        week.days[idx] = {
          ...week.days[idx],
          sessions: [
            makeRunSession({
              title: "Easy run",
              tags: ["easy", "aerobic"],
              notes:
                "Added to match your selected runs-per-week and keep consistency.",
              warmupMin: 10,
              mainMin: 30,
              mainDesc:
                "Continuous easy running at conversational pace. Keep it smooth and controlled.",
              mainRpe: "RPE 4–5",
              mainIntensity: "Easy · conversational · HR Z2",
              cooldownMin: 10,
            }),
          ],
        };
      }

      runDaysNow = week.days.filter(dayHasRun).map((d) => d.day);
    }

    // 2) Ensure ONE long run on longRunDay
    const weekHasLong = week.days.some((d) =>
      d.sessions?.some(sessionLooksLong)
    );

    if (!weekHasLong) {
      const idx = week.days.findIndex((d) => d.day === longRunDay);
      if (idx >= 0) {
        week.days[idx] = {
          ...week.days[idx],
          sessions: [
            makeRunSession({
              title: "Long run",
              tags: ["long", "endurance"],
              notes:
                "Keep this relaxed and controlled. The long run builds endurance; it should not feel like a race.",
              warmupMin: 10,
              mainMin: Math.round(longMainMin),
              mainDesc:
                "Steady long run at relaxed pace. Keep breathing controlled; avoid surging. If you feel great, finish the last 10 minutes slightly steadier (still controlled).",
              mainRpe: "RPE 5–6",
              mainIntensity: "Z2 · easy–steady · HR Z2",
              cooldownMin: 10,
            }),
          ],
        };
      }
    } else {
      // If AI put long run on a weird day, move it to longRunDay (preferably)
      const longFromIdx = week.days.findIndex((d) =>
        d.sessions?.some(sessionLooksLong)
      );
      const longToIdx = week.days.findIndex((d) => d.day === longRunDay);

      if (longFromIdx >= 0 && longToIdx >= 0 && longFromIdx !== longToIdx) {
        const longSession = week.days[longFromIdx].sessions.find(sessionLooksLong);
        // remove from old day
        week.days[longFromIdx] = {
          ...week.days[longFromIdx],
          sessions: week.days[longFromIdx].sessions.filter((s) => s !== longSession),
        };
        // place on target day (replace if needed)
        week.days[longToIdx] = { ...week.days[longToIdx], sessions: [longSession] };
      }
    }

    // 3) Cap hard days + prevent back-to-back hard
    const hardDays = week.days
      .filter((d) => d.sessions?.some(sessionLooksHard))
      .map((d) => d.day);

    // Downgrade extra hard days beyond cap (keep the earliest one(s))
    if (hardDays.length > hardCap) {
      const toDowngrade = hardDays.slice(hardCap);
      for (const dayName of toDowngrade) {
        const idx = week.days.findIndex((d) => d.day === dayName);
        if (idx >= 0 && week.days[idx]?.sessions?.[0]) {
          week.days[idx] = {
            ...week.days[idx],
            sessions: [downgradeToEasy(week.days[idx].sessions[0])],
          };
        }
      }
    }

    // No back-to-back hard days (downgrade second)
    for (let i = 0; i < DAYS.length - 1; i++) {
      const aIdx = week.days.findIndex((d) => d.day === DAYS[i]);
      const bIdx = week.days.findIndex((d) => d.day === DAYS[i + 1]);
      if (aIdx < 0 || bIdx < 0) continue;

      const aHard = week.days[aIdx].sessions?.some(sessionLooksHard);
      const bHard = week.days[bIdx].sessions?.some(sessionLooksHard);

      if (aHard && bHard) {
        if (week.days[bIdx]?.sessions?.[0]) {
          week.days[bIdx] = {
            ...week.days[bIdx],
            sessions: [downgradeToEasy(week.days[bIdx].sessions[0])],
          };
        }
      }
    }

    // 4) Normalise main durations a bit (long/quality/easy distribution)
    // Identify long day + one quality day (if any)
    const longIdx = week.days.findIndex((d) => d.sessions?.some(sessionLooksLong));
    const qualityIdxs = week.days
      .map((d, idx) => (d.sessions?.some(sessionLooksHard) ? idx : -1))
      .filter((x) => x >= 0);

    // Set long run main duration
    if (longIdx >= 0 && week.days[longIdx]?.sessions?.[0]?.segments?.[1]) {
      const s = week.days[longIdx].sessions[0];
      const main = s.segments[1];
      const adjustedMain = isDeload ? longMainMin * (1 - RULES.deload.reducePct) : longMainMin;
      main.durationMin = Math.round(adjustedMain);
      s.segments[1] = main;
      week.days[longIdx].sessions[0] = s;
    }

    // Set first quality main duration (if present)
    if (qualityIdxs.length > 0) {
      const qIdx = qualityIdxs[0];
      const s = week.days[qIdx].sessions[0];
      if (s?.segments?.[1]) {
        const adjustedMain = isDeload ? qualityMainMin * (1 - RULES.deload.reducePct) : qualityMainMin;
        s.segments[1].durationMin = Math.round(adjustedMain);
        week.days[qIdx].sessions[0] = s;
      }
    }

    // Adjust easy runs to fill remaining weekly minutes (very roughly)
    const runIdxs = week.days
      .map((d, idx) => (dayHasRun(d) ? idx : -1))
      .filter((x) => x >= 0);

    const totalWarmCoolMin = runIdxs.length * (10 + 10);
    const remainingMainMin =
      weeklyMinTarget - totalWarmCoolMin - (qualityIdxs.length > 0 ? qualityMainMin : 0) - longMainMin;

    const easyIdxs = runIdxs.filter(
      (idx) => idx !== longIdx && !qualityIdxs.includes(idx)
    );

    const perEasyMain = easyIdxs.length > 0 ? remainingMainMin / easyIdxs.length : 0;
    const easyMainMin = clamp(perEasyMain, 20, 55);

    for (const idx of easyIdxs) {
      const sess = week.days[idx]?.sessions?.[0];
      if (!sess?.segments?.[1]) continue;
      const adjustedMain = isDeload ? easyMainMin * (1 - RULES.deload.reducePct) : easyMainMin;
      sess.segments[1].durationMin = Math.round(adjustedMain);
      // keep tag sanity
      const tags = (sess.tags || []).map((t) => String(t).toLowerCase());
      if (!tags.includes("easy")) sess.tags = ["easy", "aerobic"];
      week.days[idx].sessions[0] = sess;
    }

    // 5) Deload labelling (still schema-safe: only edit existing fields)
    if (isDeload) {
      week = {
        ...week,
        title: week?.title ? `${week.title} (deload)` : `Week ${weekIndex} – deload`,
        focus:
          week?.focus
            ? `${week.focus} (reduced volume)`
            : "Deload week – reduced volume, keep everything controlled",
      };
    }

    // Update progression for next week
    if (!isDeload) {
      wkKm = targetWkKm + growth;
      lrKm = Math.min(targetLrKm + 2.5, wkKm * 0.4);
    } else {
      // keep base steady after deload
      wkKm = wkKm;
      lrKm = Math.max(targetLrKm, wkKm * 0.3);
    }

    return week;
  });

  return {
    ...plan,
    weeks: fixedWeeks,
    primaryActivity: "Run",
  };
}

/**
 * Simple local fallback *running* plan if OpenAI is not configured or errors.
 * Structure matches the UNIVERSAL TrainingPlan JSON schema.
 */
function makeFallbackPlan(body = {}) {
  const {
    goalType = "10k",
    weeks = defaultWeeks,
    sessionsPerWeek = defaultSessionsPerWeek,
  } = body;

  const wCount = clamp(Number(weeks) || defaultWeeks, 1, 24);
  const sPerWeek = clamp(Number(sessionsPerWeek) || defaultSessionsPerWeek, 1, 7);

  const weeksArr = [];

  for (let w = 0; w < wCount; w++) {
    const title = w === 0 ? "Week 1 – base endurance" : `Week ${w + 1} – base endurance`;

    const weekDays = DAYS.map((dayName, idx) => {
      if (idx >= sPerWeek) return { day: dayName, sessions: [] };

      const isLongRunDay = dayName === "Sat" || dayName === "Sun";
      const isQualityDay = dayName === "Wed";

      let titleText = "Easy run";
      let tags = ["easy", "aerobic"];
      let mainDescription =
        "Continuous easy run at conversational pace. You should finish feeling like you could do more.";
      let mainDuration = 35;
      let mainIntensity = "Z2 · easy conversational pace";
      let mainRpe = "RPE 4–5";

      if (isQualityDay && w > 0) {
        titleText = "Tempo / interval session";
        tags = ["tempo", "quality"];
        mainDescription =
          "2 × 8–10 min at comfortably hard tempo pace with 3–4 min easy jog between blocks.";
        mainDuration = 30;
        mainIntensity = "Tempo effort · around 10K–HM pace · HR Z3–Z4";
        mainRpe = "RPE 7–8";
      } else if (isLongRunDay) {
        titleText = "Long run";
        tags = ["long", "endurance"];
        mainDescription =
          "Steady long run at relaxed pace. Keep breathing controlled; avoid racing the distance.";
        mainDuration = 60;
        mainIntensity = "Z2 · easy–steady long run pace";
        mainRpe = "RPE 5–6";
      }

      return {
        day: dayName,
        sessions: [
          makeRunSession({
            title: titleText,
            tags,
            notes:
              "Local fallback plan – generated without AI. Keep everything controlled and focus on smooth, relaxed running.",
            warmupMin: 10,
            mainMin: mainDuration,
            mainDesc: mainDescription,
            mainRpe,
            mainIntensity,
            cooldownMin: 10,
          }),
        ],
      };
    });

    weeksArr.push({
      title,
      focus: "Base endurance and consistent easy running",
      days: weekDays,
    });
  }

  return {
    name: `Running plan – ${goalType}`,
    goalType,
    primaryActivity: "Run",
    weeks: weeksArr,
  };
}

/* -------------------------------------------------------------------------- */
/*  JSON schema for structured response (UNIVERSAL, RUN-FOCUSED)             */
/* -------------------------------------------------------------------------- */

const trainingSegmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    distanceKm: { type: "number" },
    durationMin: { type: "number" },
    reps: { type: "number" },
    sets: { type: "number" },
    loadKg: { type: "number" },
    stationName: { type: "string" },
    rpe: { type: "string" },
    intensity: { type: "string" },
  },
  required: [
    "kind",
    "label",
    "description",
    "distanceKm",
    "durationMin",
    "reps",
    "sets",
    "loadKg",
    "stationName",
    "rpe",
    "intensity",
  ],
};

const trainingSessionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    sessionType: { type: "string", enum: ["run"] },
    layout: { type: "string", enum: ["run-steps"] },
    tags: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
    segments: { type: "array", items: trainingSegmentSchema, minItems: 3 },
  },
  required: ["title", "sessionType", "layout", "tags", "notes", "segments"],
};

const trainingDaySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    day: { type: "string", enum: DAYS },
    sessions: { type: "array", items: trainingSessionSchema },
  },
  required: ["day", "sessions"],
};

const trainingWeekSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    focus: { type: "string" },
    days: { type: "array", items: trainingDaySchema, minItems: 1, maxItems: 7 },
  },
  required: ["title", "focus", "days"],
};

const trainingPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    goalType: { type: "string" },
    primaryActivity: { type: "string" },
    weeks: { type: "array", items: trainingWeekSchema, minItems: 1 },
  },
  required: ["name", "goalType", "primaryActivity", "weeks"],
};

/* -------------------------------------------------------------------------- */
/*  Route: POST /ai-plan/plan                                                 */
/* -------------------------------------------------------------------------- */

router.post("/plan", async (req, res) => {
  const body = req.body || {};

  // If no OpenAI key, just return local fallback
  if (!openai) {
    const fallback = makeFallbackPlan(body);
    // still apply rules if athleteProfile present (keeps behaviour consistent)
    const fixed = applyRunPlanRules({
      plan: fallback,
      athleteProfile: body.athleteProfile,
      sessionsPerWeek: body.sessionsPerWeek,
      weeksCount: body.weeks,
      current10kTime: body.current10kTime,
    });
    return res.json({ plan: fixed, source: "local-fallback+rules" });
  }

  try {
    const {
      userId = "anonymous",
      goalType = "10k",
      targetEventDate,
      targetTime,
      current10kTime,
      sessionsPerWeek = defaultSessionsPerWeek,
      weeks = defaultWeeks,
      goal,
      primaryActivity = "Run",
      extraNotes = "",
      athleteProfile = null, // ✅ NEW
    } = body;

    const cleanWeeks = clamp(Number(weeks) || defaultWeeks, 1, 24);
    const cleanSessions = clamp(Number(sessionsPerWeek) || defaultSessionsPerWeek, 1, 7);

    const systemPrompt = `
You are an experienced UK running coach who writes professional training plans
for road and hybrid runners of all levels, from first 5K up to advanced marathoners.

This route is **running-only**:

- Every session is a RUN, no strength or Hyrox stations.
- primaryActivity MUST be "Run".
- sessionType MUST be "run".
- layout MUST be "run-steps".

Hard rules:
- Output JSON that matches the TrainingPlan schema exactly.
- 7 days per week (Mon–Sun).
- Exactly ${cleanSessions} run days per week (other days are rest: sessions = []).
- Include exactly ONE long run per week.
- Avoid back-to-back hard sessions.
- Use warm-up + main + cool-down segments in every session.

Use the provided athleteProfile context to keep the plan realistic.
`.trim();

    const userPrompt = {
      userId,
      goalType,
      primaryActivity: "Run",
      targetEventDate,
      targetTime,
      current10kTime,
      sessionsPerWeek: cleanSessions,
      weeks: cleanWeeks,
      naturalGoalText: goal,
      extraNotes,
      athleteProfile, // ✅ include full profile for the model
    };

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Create a fully running-specific training plan JSON that matches the TrainingPlan schema exactly. " +
                "Here is the athlete context:\n" +
                JSON.stringify(userPrompt, null, 2),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "TrainingPlan",
          schema: trainingPlanSchema,
        },
      },
    });

    const jsonText =
      response.output_text ||
      response.output?.[0]?.content?.[0]?.text ||
      "{}";

    let plan;
    try {
      plan = JSON.parse(jsonText);
    } catch (e) {
      console.error("[ai-plan] JSON parse error, falling back:", e);
      plan = null;
    }

    if (!plan || !plan.weeks || !Array.isArray(plan.weeks)) {
      const fallback = makeFallbackPlan(body);
      const fixedFallback = applyRunPlanRules({
        plan: fallback,
        athleteProfile,
        sessionsPerWeek: cleanSessions,
        weeksCount: cleanWeeks,
        current10kTime,
      });
      return res.json({ plan: fixedFallback, source: "fallback-invalid-json+rules" });
    }

    // Hard-enforce primaryActivity = "Run" just in case
    plan.primaryActivity = "Run";

    // ✅ APPLY RUNNA-LEVEL RULES (schema-safe)
    const fixedPlan = applyRunPlanRules({
      plan,
      athleteProfile,
      sessionsPerWeek: cleanSessions,
      weeksCount: cleanWeeks,
      current10kTime,
    });

    return res.json({ plan: fixedPlan, source: "openai+rules" });
  } catch (err) {
    console.error("[ai-plan] error:", err);
    const fallback = makeFallbackPlan(req.body || {});
    const fixedFallback = applyRunPlanRules({
      plan: fallback,
      athleteProfile: (req.body || {}).athleteProfile,
      sessionsPerWeek: (req.body || {}).sessionsPerWeek,
      weeksCount: (req.body || {}).weeks,
      current10kTime: (req.body || {}).current10kTime,
    });
    return res.json({ plan: fixedFallback, source: "fallback-error+rules" });
  }
});

export default router;
