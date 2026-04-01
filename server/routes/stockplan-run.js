// server/routes/stockplan-run.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

/* -----------------------------------------
   Path helpers (stable regardless of cwd)
----------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/routes -> server
const SERVER_ROOT = path.resolve(__dirname, "..");
// server/lib/run/templates
const TEMPLATE_DIR = path.resolve(SERVER_ROOT, "lib", "run", "templates");

/* -----------------------------------------
   Pace helpers
----------------------------------------- */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function parseTimeToSeconds(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  const parts = s.split(":").map((x) => x.trim());
  if (parts.some((p) => p === "" || isNaN(Number(p)))) return null;

  if (parts.length === 2) {
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return mm * 60 + ss;
  }
  if (parts.length === 3) {
    const hh = Number(parts[0]);
    const mm = Number(parts[1]);
    const ss = Number(parts[2]);
    if (hh < 0 || mm < 0 || ss < 0 || mm >= 60 || ss >= 60) return null;
    return hh * 3600 + mm * 60 + ss;
  }
  return null;
}

function secPerKmFromRace(distanceKey, timeSec) {
  const km =
    distanceKey === "5K"
      ? 5
      : distanceKey === "10K"
      ? 10
      : distanceKey === "Half marathon"
      ? 21.0975
      : distanceKey === "Marathon"
      ? 42.195
      : null;

  if (!km || !Number.isFinite(timeSec) || timeSec <= 0) return null;
  return timeSec / km;
}

function pickBestRecentTimeSec(current) {
  const tenK = parseTimeToSeconds(current?.recentTimes?.tenK);
  const fiveK = parseTimeToSeconds(current?.recentTimes?.fiveK);
  const half = parseTimeToSeconds(current?.recentTimes?.half);
  const mara = parseTimeToSeconds(current?.recentTimes?.marathon);

  if (Number.isFinite(tenK) && tenK > 0) return { distance: "10K", timeSec: tenK };
  if (Number.isFinite(fiveK) && fiveK > 0) return { distance: "5K", timeSec: fiveK };
  if (Number.isFinite(half) && half > 0) return { distance: "Half marathon", timeSec: half };
  if (Number.isFinite(mara) && mara > 0) return { distance: "Marathon", timeSec: mara };
  return null;
}

function difficultyScale(difficulty) {
  if (difficulty === "Conservative") return 1.02;
  if (difficulty === "Aggressive") return 0.98;
  return 1.0;
}

function buildPaceTable(athleteProfile) {
  const recent =
    athleteProfile?.current?.recentRace || pickBestRecentTimeSec(athleteProfile?.current);

  let base10kSecPerKm = null;

  if (recent?.distance && Number.isFinite(recent?.timeSec)) {
    const secPerKm = secPerKmFromRace(recent.distance, recent.timeSec);
    if (secPerKm) {
      if (recent.distance === "10K") base10kSecPerKm = secPerKm;
      else if (recent.distance === "5K") base10kSecPerKm = secPerKm * 1.06;
      else if (recent.distance === "Half marathon") base10kSecPerKm = secPerKm * 0.94;
      else if (recent.distance === "Marathon") base10kSecPerKm = secPerKm * 0.90;
    }
  }

  if (!base10kSecPerKm) {
    const weeklyKm = Number(athleteProfile?.current?.weeklyKm) || 0;
    const approx10k =
      weeklyKm >= 50 ? 255 : weeklyKm >= 30 ? 280 : weeklyKm >= 15 ? 310 : 340;
    base10kSecPerKm = approx10k;
  }

  const scale = difficultyScale(athleteProfile?.availability?.difficulty);

  const TEN_K = base10kSecPerKm * scale;
  const THRESH = TEN_K * 1.07;
  const VO2 = TEN_K * 0.95;
  const STEADY = TEN_K * 1.18;
  const EASY = TEN_K * 1.30;
  const RECOVERY = TEN_K * 1.40;
  const STRIDES = TEN_K * 0.85;

  return { TEN_K, THRESH, VO2, STEADY, EASY, RECOVERY, STRIDES };
}

function roundSec(n) {
  return Math.round(Number(n));
}

/* -----------------------------------------
   Workout expansion
----------------------------------------- */

function isHardSession(sessionType) {
  const t = String(sessionType || "").toUpperCase();
  return ["INTERVAL", "TEMPO", "THRESHOLD", "VO2", "HILL", "RACE", "PROGRESSION"].includes(t);
}

function isEasySession(sessionType) {
  const t = String(sessionType || "").toUpperCase();
  return ["EASY", "RECOVERY", "AEROBIC"].includes(t);
}

function addWarmupAndCooldown(session, paceTable) {
  const steps = Array.isArray(session.steps) ? session.steps : [];
  const wuMin = session?.warmupMin ?? 12;
  const cdMin = session?.cooldownMin ?? 10;

  const warmup = {
    type: "RUN",
    name: "Warm up",
    duration: { type: "TIME", seconds: wuMin * 60 },
    target: { paceKey: "EASY", paceSecPerKm: roundSec(paceTable.EASY) },
    notes: "Easy jog + drills if you like",
  };

  const cooldown = {
    type: "RUN",
    name: "Cool down",
    duration: { type: "TIME", seconds: cdMin * 60 },
    target: { paceKey: "EASY", paceSecPerKm: roundSec(paceTable.EASY) },
    notes: "Easy jog",
  };

  return { ...session, steps: [warmup, ...steps, cooldown] };
}

function addStridesToEasyRun(session, paceTable) {
  const steps = Array.isArray(session.steps) ? session.steps : [];

  const strideSet = {
    type: "REPEAT",
    name: "Strides",
    repeat: 6,
    steps: [
      {
        type: "RUN",
        name: "Stride",
        duration: { type: "TIME", seconds: 20 },
        target: { paceKey: "STRIDES", paceSecPerKm: roundSec(paceTable.STRIDES) },
        notes: "Fast but relaxed",
      },
      {
        type: "RUN",
        name: "Easy float",
        duration: { type: "TIME", seconds: 60 },
        target: { paceKey: "EASY", paceSecPerKm: roundSec(paceTable.EASY) },
      },
    ],
  };

  return { ...session, steps: [...steps, strideSet], hasStrides: true };
}

function applyPacesToSteps(session, paceTable) {
  const applyToStep = (step) => {
    if (!step || typeof step !== "object") return step;

    if (step.type === "REPEAT" && Array.isArray(step.steps)) {
      return { ...step, steps: step.steps.map(applyToStep) };
    }

    const key = step?.target?.paceKey;
    if (!key) return step;

    const pace = paceTable[key];
    if (!pace) return step;

    const already = step?.target?.paceSecPerKm;
    if (Number.isFinite(already) && already > 0) return step;

    return {
      ...step,
      target: { ...step.target, paceSecPerKm: roundSec(pace) },
    };
  };

  const steps = Array.isArray(session.steps) ? session.steps : [];
  return { ...session, steps: steps.map(applyToStep) };
}

/* -----------------------------------------
   Day mapping
----------------------------------------- */
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normaliseRunDays(runDays) {
  const arr = Array.isArray(runDays) ? runDays : [];
  const uniq = [];
  const seen = new Set();
  for (const d of arr) {
    if (!DAY_ORDER.includes(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    uniq.push(d);
  }
  return uniq.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
}

function mapTemplateDaysToUserDays({ sessions, userRunDays, userLongRunDay }) {
  const runDays = normaliseRunDays(userRunDays);
  const longDay = userLongRunDay === "Any" ? null : userLongRunDay;

  const out = sessions.map((s) => ({ ...s }));
  const idxs = out.map((s, i) => ({ s, i }));

  const longIdx =
    idxs.find((x) => String(x.s.slot || "").toUpperCase() === "LONG") ||
    idxs.find((x) => String(x.s.sessionType || "").toUpperCase() === "LONG");

  const qualityIdxs = idxs.filter((x) => {
    const slot = String(x.s.slot || "").toUpperCase();
    const t = String(x.s.sessionType || "").toUpperCase();
    return (
      slot.startsWith("QUALITY") ||
      ["INTERVAL", "VO2", "THRESHOLD", "TEMPO", "HILL", "RACE", "PROGRESSION"].includes(t)
    );
  });

  const qualityOrdered = qualityIdxs.slice(0, 2);
  const easyIdxs = idxs.filter((x) => !qualityIdxs.includes(x) && (!longIdx || x.i !== longIdx.i));

  const used = new Set();
  const assign = new Map();

  const reserveDay = (day) => {
    if (!day) return false;
    if (!runDays.includes(day)) return false;
    if (used.has(day)) return false;
    used.add(day);
    return true;
  };

  if (longIdx) {
    const chosen = longDay && reserveDay(longDay) ? longDay : null;
    if (chosen) assign.set(longIdx.i, chosen);
  }

  const pickNextFree = () => runDays.find((d) => !used.has(d)) || null;

  for (const q of qualityOrdered) {
    const d = pickNextFree();
    if (!d) break;
    reserveDay(d);
    assign.set(q.i, d);
  }

  for (const e of easyIdxs) {
    const d = pickNextFree();
    if (!d) break;
    reserveDay(d);
    assign.set(e.i, d);
  }

  return out.map((s, i) => ({
    ...s,
    day: assign.get(i) || (runDays[i] || "Mon"),
  }));
}

/* -----------------------------------------
   Template loading + normalisation
----------------------------------------- */
function loadTemplate(templateId) {
  const templatePath = path.resolve(TEMPLATE_DIR, `${templateId}.json`);
  if (!fs.existsSync(templatePath)) {
    // Helpful debug info
    const available = fs.existsSync(TEMPLATE_DIR)
      ? fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".json"))
      : [];
    const hint = available.length ? ` Available: ${available.slice(0, 25).join(", ")}${available.length > 25 ? "…" : ""}` : "";
    throw new Error(`Template not found: ${templateId} (looked in ${TEMPLATE_DIR}).${hint}`);
  }
  const raw = fs.readFileSync(templatePath, "utf-8");
  return JSON.parse(raw);
}

function normaliseTemplate(template) {
  const weeks = Array.isArray(template?.weeks) ? template.weeks : [];
  return {
    ...template,
    id: template?.id || template?.templateId || template?.name,
    name: template?.name || template?.id || "Run plan",
    weeks: weeks.map((w, idx) => ({
      ...w,
      weekIndex0: typeof w?.weekIndex0 === "number" ? w.weekIndex0 : idx,
      weekNumber: typeof w?.weekNumber === "number" ? w.weekNumber : idx + 1,
      sessions: Array.isArray(w?.sessions) ? w.sessions : [],
    })),
  };
}

/* -----------------------------------------
   Build plan from template + athleteProfile
----------------------------------------- */
function buildPlanFromStock({ athleteProfile, template }) {
  const paceTable = buildPaceTable(athleteProfile);

  const runDays = normaliseRunDays(athleteProfile?.availability?.runDays);
  const longRunDay = athleteProfile?.availability?.longRunDay || "Any";
  const sessionsPerWeek = clamp(
    Number(athleteProfile?.availability?.sessionsPerWeek) || runDays.length || 4,
    2,
    7
  );

  const tplWeeks = Array.isArray(template?.weeks) ? template.weeks : [];

  const weeks = tplWeeks.map((w) => {
    let sessions = Array.isArray(w.sessions) ? w.sessions.map((s) => ({ ...s })) : [];

    if (sessions.length > sessionsPerWeek) {
      sessions = sessions
        .slice()
        .sort((a, b) => {
          const aHard = isHardSession(a.sessionType) ? 1 : 0;
          const bHard = isHardSession(b.sessionType) ? 1 : 0;
          const aLong = String(a.slot || "").toUpperCase() === "LONG" ? 2 : 0;
          const bLong = String(b.slot || "").toUpperCase() === "LONG" ? 2 : 0;
          return bLong + bHard - (aLong + aHard);
        })
        .slice(0, sessionsPerWeek);
    } else if (sessions.length < sessionsPerWeek) {
      const need = sessionsPerWeek - sessions.length;
      const easyCandidates = sessions.filter((s) => isEasySession(s.sessionType));
      for (let i = 0; i < need; i++) {
        const base = easyCandidates[i % Math.max(1, easyCandidates.length)];
        if (base) sessions.push({ ...base, name: base.name ? `${base.name} (extra)` : "Easy (extra)" });
        else
          sessions.push({
            sessionType: "EASY",
            name: "Easy run",
            steps: [
              { type: "RUN", duration: { type: "TIME", seconds: 40 * 60 }, target: { paceKey: "EASY" } },
            ],
          });
      }
    }

    sessions = mapTemplateDaysToUserDays({
      sessions,
      userRunDays: runDays,
      userLongRunDay: longRunDay,
    });

    sessions = sessions.map((s) => {
      let out = { ...s };
      if (!Array.isArray(out.steps)) out.steps = [];

      out = applyPacesToSteps(out, paceTable);

      if (isHardSession(out.sessionType)) {
        out = addWarmupAndCooldown(out, paceTable);
        out = applyPacesToSteps(out, paceTable);
      }

      if (isEasySession(out.sessionType)) {
        out = addStridesToEasyRun(out, paceTable);
        out = applyPacesToSteps(out, paceTable);
      }

      out.type = out.type || out.sessionType || "EASY";
      out.notes = out.notes || "";

      out.paceSummary = out.paceSummary || {
        EASY: roundSec(paceTable.EASY),
        THRESH: roundSec(paceTable.THRESH),
        TEN_K: roundSec(paceTable.TEN_K),
      };

      return out;
    });

    return {
      ...w,
      sessions,
      days: DAY_ORDER.map((day) => ({
        day,
        sessions: sessions.filter((s) => s.day === day),
      })),
    };
  });

  return {
    name: template.name || "Run plan",
    kind: "run",
    source: "stock-template",
    templateId: template.id,
    weeks,
    paceTable: Object.fromEntries(Object.entries(paceTable).map(([k, v]) => [k, roundSec(v)])),
  };
}

/* -----------------------------------------
   Route
   NOTE: mounted at app.use("/stockplan-run", router)
   so POST "/" => POST /stockplan-run
----------------------------------------- */
router.post("/", async (req, res) => {
  try {
    const athleteProfile = req.body?.athleteProfile;
    if (!athleteProfile) return res.status(400).json({ error: "Missing athleteProfile" });

    const templateId = athleteProfile?.templateId;
    if (!templateId) return res.status(400).json({ error: "Missing templateId on athleteProfile" });

    const templateRaw = loadTemplate(templateId);
    const template = normaliseTemplate(templateRaw);

    const plan = buildPlanFromStock({ athleteProfile, template });

    return res.json({ plan });
  } catch (e) {
    console.log("[stockplan-run] error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

export default router;
