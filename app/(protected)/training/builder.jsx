"use client";

/**
 * app/(protected)/plans/builder.jsx
 * Next-level builder (client-side):
 * - Adds user-specific pace bands (derived from 5K/10K) into the prompt
 * - Stronger contract wording for strength: primary lifts + accessories + strict fields
 * - Keeps Garmin-compatible runSteps requirement
 * - Keeps job queue/kick + Firestore subscription flow
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDoc, collection, doc, onSnapshot } from "firebase/firestore";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { stripUndefinedDeep, withTimestamps } from "../../../src/firestoreSafe";

/* ---------------- helpers ---------------- */
function safeStr(v) {
  return String(v ?? "").trim();
}
function toNum(v, fallback = undefined) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function readCsvList(s) {
  return safeStr(s)
    .split(",")
    .map((x) => safeStr(x))
    .filter(Boolean);
}
function yyyyMmDd(d) {
  const x = safeStr(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "";
}
function asArr(x) {
  return Array.isArray(x) ? x : [];
}
function isObj(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function uidOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("Please sign in again.");
  return u.uid;
}
function msNow() {
  return Date.now();
}

/* ---------------- time/pace helpers ---------------- */
/**
 * Accepts:
 * - "18:21" => mm:ss
 * - "00:18:21" => hh:mm:ss
 * Returns total seconds or undefined
 */
function parseTimeToSec(input) {
  const s = safeStr(input);
  if (!s) return undefined;

  const parts = s.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return undefined;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return undefined;

  let h = 0, m = 0, sec = 0;
  if (nums.length === 2) {
    m = nums[0];
    sec = nums[1];
  } else {
    h = nums[0];
    m = nums[1];
    sec = nums[2];
  }
  const total = h * 3600 + m * 60 + sec;
  return total > 0 ? total : undefined;
}

/** Format seconds-per-km to "m:ss/km" */
function fmtPaceSecPerKm(secPerKm) {
  const s = Math.round(secPerKm);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}/km`;
}

/**
 * Derive rough training pace bands from 5K/10K times.
 * This is not physiology-perfect, but it's consistent, stable,
 * and gives the model concrete targets to use in runSteps.
 *
 * Output: { easy, steady, tempo, threshold, vo2 } each => { low, high }
 * Where low/high are pace strings "m:ss/km" (low = faster, high = slower)
 */
function derivePaceBands({ fiveK, tenK, level }) {
  const t5 = parseTimeToSec(fiveK);
  const t10 = parseTimeToSec(tenK);

  // choose best anchor: 5k preferred; else 10k; else none
  let pace5kSecPerKm = undefined;
  let pace10kSecPerKm = undefined;

  if (t5) pace5kSecPerKm = t5 / 5;
  if (t10) pace10kSecPerKm = t10 / 10;

  // anchor pace: use 5k if present, else 10k slightly adjusted
  let anchor = pace5kSecPerKm;
  if (!anchor && pace10kSecPerKm) anchor = pace10kSecPerKm * 0.96; // ~5k is a bit quicker than 10k

  if (!anchor) return null;

  // Simple level tweak: beginners get slightly more conservative bands
  const lvl = safeStr(level).toLowerCase();
  const conserv = lvl === "beginner" ? 1.03 : lvl === "advanced" ? 0.99 : 1.0;

  // anchor ≈ 5k pace
  const p5 = anchor * conserv;

  // Bands as multipliers of 5k pace (slower = bigger number)
  // These are deliberately wide ranges so AI can pick sensibly.
  const bands = {
    easy:      { low: p5 * 1.35, high: p5 * 1.55 },
    steady:    { low: p5 * 1.22, high: p5 * 1.32 },
    tempo:     { low: p5 * 1.12, high: p5 * 1.20 },
    threshold: { low: p5 * 1.05, high: p5 * 1.10 },
    vo2:       { low: p5 * 0.98, high: p5 * 1.03 },
  };

  // Convert to formatted strings (low=faster, high=slower)
  const out = {};
  Object.keys(bands).forEach((k) => {
    const low = bands[k].low;
    const high = bands[k].high;
    out[k] = {
      low: fmtPaceSecPerKm(Math.min(low, high)),
      high: fmtPaceSecPerKm(Math.max(low, high)),
    };
  });

  return out;
}

/* ---------------- constants ---------------- */
const SCHEMA_VERSION = 3;
const AI_PLAN_START_ENDPOINT = "/plans/ai/start";
const AI_PLAN_KICK_ENDPOINT = "/plans/ai/kick";
const JOB_KEY = "activePlanBuildJobId_v2";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LEVELS = [
  { key: "beginner", label: "Beginner" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
];

const DOUBLE_STYLES = [
  { key: "run+lift", label: "Run + Strength same day" },
  { key: "lift+hyrox", label: "Strength + Hyrox same day" },
  { key: "run+hyrox", label: "Run + Hyrox same day" },
  { key: "performance", label: "Performance-biased (coach decides)" },
];

const DEFAULT_EQUIPMENT = "barbell,dumbbell,bands,rower,ski,bike,treadmill";
const DEFAULT_GOAL = "Build a hybrid plan: Running + Hyrox + Strength";

// queued-too-long threshold for auto-kick
const QUEUE_KICK_MS = 12_000;

/* ---------------- normalisation ---------------- */
function isValidDay(x) {
  return DAYS.includes(x);
}

function normaliseRunSteps(steps) {
  const arr = asArr(steps);
  return arr
    .map((st, i) => {
      const s = isObj(st) ? st : {};
      const duration = isObj(s.duration) ? s.duration : {};
      const target = isObj(s.target) ? s.target : {};
      const durationType = safeStr(duration.type);
      const targetType = safeStr(target.type);

      const out = {
        id: safeStr(s.id) || `step_${msNow()}_${i}`,
        type: safeStr(s.type) || "work",
        duration: {
          type: durationType || "open",
          value: toNum(duration.value, undefined),
        },
        target: {
          type: targetType || "open",
          value: safeStr(target.value) || "",
          low: safeStr(target.low) || "",
          high: safeStr(target.high) || "",
        },
        notes: safeStr(s.notes) || "",
      };

      return stripUndefinedDeep(out);
    })
    .filter(Boolean);
}

function normaliseItems(items) {
  const arr = asArr(items);
  return arr.map((it) => {
    const x = isObj(it) ? it : {};
    return stripUndefinedDeep({
      kind: safeStr(x.kind) || "note",
      title: safeStr(x.title) || "Item",

      // strength / exercise fields
      rpe: toNum(x.rpe, undefined),
      restSec: toNum(x.restSec, undefined),
      effort: safeStr(x.effort) || "",

      sets: toNum(x.sets, undefined),
      reps: toNum(x.reps, undefined),
      load: safeStr(x.load) || "",
      tempo: safeStr(x.tempo) || "",
      rir: toNum(x.rir, undefined),

      // run / cardio fields
      distanceM: toNum(x.distanceM, undefined),
      timeSec: toNum(x.timeSec, undefined),
      pace: safeStr(x.pace) || "",
      inclinePct: toNum(x.inclinePct, undefined),

      // hyrox / metcon fields
      rounds: toNum(x.rounds, undefined),
      calories: toNum(x.calories, undefined),
      cues: safeStr(x.cues) || "",
    });
  });
}

function normaliseBlocks(blocks) {
  const b = asArr(blocks);
  return b.map((blk, i) => {
    const x = isObj(blk) ? blk : {};
    return {
      id: x?.id || `${msNow()}_${i}`,
      title: safeStr(x?.title) || "Block",
      kind: safeStr(x?.kind) || "strength",
      collapsed: false,
      items: normaliseItems(x?.items),
    };
  });
}

function normalisePlanResponse(raw) {
  const data = isObj(raw) ? raw : {};
  const weeks = clamp(toNum(data.weeks, 0) ?? 0, 1, 52);
  const startDate = yyyyMmDd(data.startDate) || "";

  const plan = asArr(data.plan);
  const safePlan = plan
    .map((w) => {
      const weekNum = clamp(toNum(w?.week, 0) ?? 0, 1, 52);
      const days = asArr(w?.days);

      const safeDays = days
        .map((d) => {
          const day = isValidDay(d?.day) ? d.day : null;
          if (!day) return null;

          const sessions = asArr(d?.sessions);
          const safeSessions = sessions
            .map((s, idx) => {
              const durationMin = clamp(toNum(s?.durationMin, 60) ?? 60, 10, 240);
              const timeOfDay = safeStr(s?.timeOfDay);
              const priority = safeStr(s?.priority);

              const blocks = normaliseBlocks(s?.blocks);
              const runSteps = normaliseRunSteps(s?.runSteps);

              return stripUndefinedDeep({
                id: s?.id || `${weekNum}_${day}_${idx}_${msNow()}`,
                name: safeStr(s?.name) || "Session",
                type: safeStr(s?.type) || "hybrid",
                timeOfDay: timeOfDay || undefined,
                priority: priority || "secondary",
                durationMin,
                blocks,
                runSteps: runSteps?.length ? runSteps : undefined,
                notes: safeStr(s?.notes) || "",
              });
            })
            .filter(Boolean);

          return { day, sessions: safeSessions };
        })
        .filter(Boolean);

      return { week: weekNum, days: safeDays };
    })
    .filter(Boolean);

  return {
    name: safeStr(data.name) || "",
    goal: safeStr(data.goal) || "",
    weeks,
    startDate,
    profile: isObj(data.profile) ? data.profile : {},
    plan: safePlan,
  };
}

/* ---------------- validation (lightweight client safety) ---------------- */
function ensureWarmCoolBlocks(session) {
  const blocks = asArr(session?.blocks);
  const hasWarm = blocks.some((b) => safeStr(b?.kind) === "warmup");
  const hasCool = blocks.some((b) => safeStr(b?.kind) === "cooldown");

  const out = [...blocks];

  if (!hasWarm) {
    out.unshift({
      id: `warm_${msNow()}`,
      title: "Warm-up",
      kind: "warmup",
      collapsed: false,
      items: [
        {
          kind: session?.type === "run" ? "run" : "cardio",
          title: "Easy warm-up",
          timeSec: 600,
          effort: "easy",
          rpe: 4,
        },
      ],
    });
  }
  if (!hasCool) {
    out.push({
      id: `cool_${msNow()}`,
      title: "Cool-down",
      kind: "cooldown",
      collapsed: false,
      items: [
        {
          kind: session?.type === "run" ? "run" : "cardio",
          title: "Easy cool-down",
          timeSec: 600,
          effort: "easy",
          rpe: 3,
        },
      ],
    });
  }

  return out;
}

function validateAndFixPlan(plan) {
  const warnings = [];
  const fixed = { ...plan, plan: asArr(plan?.plan).map((w) => ({ ...w })) };

  fixed.plan = fixed.plan.map((wk) => {
    const days = asArr(wk?.days).map((d) => ({ ...d }));
    const dayMap = new Map(days.map((d) => [d.day, d]));

    const safeDays = DAYS.map((day) => {
      const base = dayMap.get(day) || { day, sessions: [] };
      const sessions = asArr(base.sessions).map((s) => ({ ...s }));
      return { day, sessions };
    });

    const daysFixed = safeDays.map((d) => {
      const sessions = asArr(d.sessions).map((sess, idx) => {
        const s = { ...sess };
        s.type = safeStr(s.type) || "hybrid";
        s.priority = safeStr(s.priority) || "secondary";
        s.durationMin = clamp(toNum(s.durationMin, 60) ?? 60, 10, 240);

        s.blocks = ensureWarmCoolBlocks(s);

        if (asArr(d.sessions).length >= 2 && !safeStr(s.timeOfDay)) {
          s.timeOfDay = idx === 0 ? "AM" : idx === 1 ? "PM" : "MID";
          warnings.push(`Added timeOfDay to Week ${wk.week} ${d.day} "${s.name || "Session"}".`);
        }

        return s;
      });

      return { ...d, sessions };
    });

    return { ...wk, days: daysFixed };
  });

  return { fixed, warnings };
}

/* ---------------- component ---------------- */
export default function PlanBuilderPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) router.replace("/(auth)/login");
  }, [router]);

  // required inputs
  const [planName, setPlanName] = useState("");
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [weeks, setWeeks] = useState("6");
  const [startDate, setStartDate] = useState("");
  const [daysAvailable, setDaysAvailable] = useState(["Mon", "Tue", "Thu", "Fri"]);

  // split preferences
  const [runsPerWeek, setRunsPerWeek] = useState("4");
  const [hyroxPerWeek, setHyroxPerWeek] = useState("2");
  const [strengthPerWeek, setStrengthPerWeek] = useState("4");

  // double-day controls
  const [allowDoubleDays, setAllowDoubleDays] = useState(true);
  const [maxSessionsPerDay, setMaxSessionsPerDay] = useState("2");
  const [doubleDayStyle, setDoubleDayStyle] = useState("performance");

  // athlete profile
  const [level, setLevel] = useState("intermediate");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("male");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [injuries, setInjuries] = useState("");

  // performance markers
  const [fiveK, setFiveK] = useState("");
  const [tenK, setTenK] = useState("");
  const [weeklyKm, setWeeklyKm] = useState("");
  const [benchKg, setBenchKg] = useState("");
  const [squatKg, setSquatKg] = useState("");
  const [deadliftKg, setDeadliftKg] = useState("");

  // equipment + constraints
  const [equipmentCsv, setEquipmentCsv] = useState(DEFAULT_EQUIPMENT);
  const [timePerSessionMin, setTimePerSessionMin] = useState("60");
  const [notes, setNotes] = useState("");

  // AI + result
  const [aiLoading, setAiLoading] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [saving, setSaving] = useState(false);

  // job progress
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const unsubRef = useRef(null);
  const queuedSinceRef = useRef(null);
  const kickedRef = useRef(false);

  const canGenerate = useMemo(() => {
    const w = toNum(weeks);
    const okWeeks = w != null && w >= 1 && w <= 52;
    const okDays = Array.isArray(daysAvailable) && daysAvailable.length > 0;
    return !!safeStr(planName) && !!safeStr(goal) && okWeeks && okDays;
  }, [planName, goal, weeks, daysAvailable]);

  const toggleDay = useCallback((d) => {
    setDaysAvailable((prev) => {
      const has = prev.includes(d);
      if (has) return prev.filter((x) => x !== d);
      return [...prev, d];
    });
  }, []);

  const apiBase = useMemo(() => String(API_URL || "").replace(/\/$/, ""), [API_URL]);

  async function authedFetch(path, payload) {
    if (!apiBase) throw new Error("Missing API_URL (config/api.js).");
    const u = auth.currentUser;
    if (!u) throw new Error("Please sign in again.");
    const token = await u.getIdToken(true);

    const res = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload || {}),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(safeStr(body?.error) || safeStr(body?.message) || `Request failed (${res.status}).`);
    }
    return body;
  }

  function buildPrompt() {
    const w = clamp(toNum(weeks, 6) ?? 6, 1, 52);
    const runs = clamp(toNum(runsPerWeek, 4) ?? 4, 0, 14);
    const hyrox = clamp(toNum(hyroxPerWeek, 2) ?? 2, 0, 14);
    const strength = clamp(toNum(strengthPerWeek, 4) ?? 4, 0, 14);

    const maxPerDay = clamp(toNum(maxSessionsPerDay, 2) ?? 2, 1, 3);
    const equip = readCsvList(equipmentCsv);
    const timeCap = clamp(toNum(timePerSessionMin, 60) ?? 60, 10, 240);

    // derive pace bands (if we have any benchmark)
    const paceBands = derivePaceBands({ fiveK, tenK, level });

    const profile = stripUndefinedDeep({
      level,
      age: toNum(age, undefined),
      sex: safeStr(sex),
      heightCm: toNum(heightCm, undefined),
      weightKg: toNum(weightKg, undefined),
      injuries: safeStr(injuries),
      daysAvailable,
      timePerSessionMin: timeCap,
      equipment: equip,
      weeklyTargets: { runsPerWeek: runs, hyroxPerWeek: hyrox, strengthPerWeek: strength },
      doubleDays: { allow: !!allowDoubleDays, maxSessionsPerDay: maxPerDay, style: doubleDayStyle },
      running: { weeklyKm: toNum(weeklyKm, undefined), fiveK: safeStr(fiveK), tenK: safeStr(tenK), paceBands },
      strength: { benchKg: toNum(benchKg, undefined), squatKg: toNum(squatKg, undefined), deadliftKg: toNum(deadliftKg, undefined) },
    });

    const coachingDefaults = stripUndefinedDeep({
      useRPE: true,
      rpeScale: "1-10",
      paceUnit: "min/km",
      // If present, the AI MUST use these bands for pace targets.
      paceBands: paceBands || undefined,

      strengthRestSec: { primary: 150, accessory: 75 },
      runEffortBands: {
        easy: "RPE 4-5",
        steady: "RPE 6",
        tempo: "RPE 7",
        threshold: "RPE 8",
        vo2: "RPE 9",
        all_out: "RPE 10",
      },

      fatigueRules: [
        "Do not place heavy lower-body primary lifts within 24h of hard run intervals if avoidable.",
        "If double-day: AM is primary, PM is secondary and shorter.",
        "Include a deload week if weeks >= 6 (reduce volume ~25-40%).",
      ],

      garminRunStepRules: [
        "Every RUN session must include session.runSteps.",
        "Steps must begin with warmup and end with cooldown.",
        "For intervals: steps must alternate work/rest (no work-work back-to-back).",
        "Prefer target.type='pace' with target.low/target.high using paceBands when available.",
      ],

      strengthProgrammingRules: [
        "Every strength session must have: a Primary Lift block (compound) + Accessories block.",
        "Primary lift: 1-2 big compounds (e.g. squat/bench/deadlift/press/pull) with sets, reps, load guidance, restSec, and rpe or rir.",
        "Accessories: 3-6 movements with sets/reps/restSec and rpe or rir.",
        "If the athlete provided bench/squat/deadlift numbers, scale loads relative to them (percentages or 'RPE-based').",
      ],
    });

    const paceInstruction = paceBands
      ? `
PACING (IMPORTANT):
Use these pace bands (min/km) for ALL runStep targets:
${JSON.stringify(paceBands, null, 2)}
- easy runs: use easy.low..easy.high
- tempo: tempo.low..tempo.high
- threshold: threshold.low..threshold.high
- intervals/VO2: vo2.low..vo2.high
In runSteps, set target.type="pace" and fill target.low/target.high.`
      : `
PACING (IMPORTANT):
User did not provide enough benchmarks for pace bands.
Use target.type="effort" with clear RPE guidance instead (easy/steady/tempo/threshold/vo2).`;

    const text = `
Create a ${w}-week HYBRID training plan starting ${startDate || "next Monday"}.

Goal:
${goal}

Weekly targets:
- Runs per week: ${runs}
- Hyrox/Metcon per week: ${hyrox}
- Strength per week: ${strength}
- Days available: ${daysAvailable.join(", ")}
- Time cap per session: ${timeCap} minutes
- Double days allowed: ${allowDoubleDays ? "YES" : "NO"}
- Max sessions per day: ${maxPerDay}
- Double-day preference: ${doubleDayStyle}

Athlete profile:
${JSON.stringify(profile, null, 2)}

Coaching defaults:
${JSON.stringify(coachingDefaults, null, 2)}

${paceInstruction}

OUTPUT MUST BE VALID JSON WITH THIS EXACT TOP-LEVEL SHAPE:

{
  "name": string,
  "goal": string,
  "weeks": number,
  "startDate": "YYYY-MM-DD",
  "profile": object,
  "plan": [
    {
      "week": number,
      "days": [
        { "day": "Mon|Tue|Wed|Thu|Fri|Sat|Sun", "sessions": [ ... ] }
      ]
    }
  ]
}

Rules:
- Every week must include ALL 7 days Mon..Sun. Rest day => sessions: []
- Put main sessions on daysAvailable; non-available days should be recovery-only if used.
- Always include warmup + cooldown blocks in every session.

STRENGTH RULES (STRICT):
- Strength sessions must have blocks:
  - kind="warmup"
  - kind="strength" with a clear Primary Lift section (compound lifts)
  - kind="strength" (or "accessory") for accessories
  - kind="cooldown"
- Every exercise item must include:
  kind="exercise", title, sets, reps, restSec, load, and (rpe OR rir).
- Primary lifts must come first and be labelled in the item titles e.g. "PRIMARY: Back Squat".

RUN RULES (STRICT / GARMIN):
- Every RUN must include runSteps.
- runSteps must: warmup first, cooldown last, and alternate work/rest for intervals.
- Use duration.type="time" (seconds) or "distance" (metres). Avoid "open" for interval work.
- Prefer target.type="pace" with target.low/target.high if paceBands exist; else use target.type="effort".

PROGRAMMING:
- Progress week-to-week and include a deload week if weeks >= 6 (reduce volume ~25-40%).
- Keep it coherent and recoverable with the given weekly split.
Extra notes: ${safeStr(notes) || "(none)"}
`.trim();

    return {
      profile,
      meta: stripUndefinedDeep({
        name: safeStr(planName),
        goal: safeStr(goal),
        weeks: w,
        startDate: safeStr(startDate),
        profile,
      }),
      prompt: text,
    };
  }

  function subscribeToJob(uid, nextJobId) {
    if (unsubRef.current) {
      try { unsubRef.current(); } catch {}
      unsubRef.current = null;
    }

    const jobRef = doc(db, "users", uid, "planBuildJobs", nextJobId);
    queuedSinceRef.current = msNow();
    kickedRef.current = false;

    unsubRef.current = onSnapshot(jobRef, async (snap) => {
      const data = snap.data();
      if (!data) return;

      setJob(data);

      // auto-kick if queued too long (serverless-safe)
      if (data.status === "queued") {
        const queuedFor = msNow() - (queuedSinceRef.current || msNow());
        if (!kickedRef.current && queuedFor > QUEUE_KICK_MS) {
          kickedRef.current = true;
          try {
            await authedFetch(AI_PLAN_KICK_ENDPOINT, { jobId: nextJobId });
          } catch {
            // ignore kick errors; snapshot will still show error if job fails
          }
        }
      }

      if (data.status === "done" && data.result?.plan?.length) {
        const norm = normalisePlanResponse(data.result);
        const { fixed, warnings } = validateAndFixPlan(norm);

        setGenerated(fixed);
        setAiLoading(false);

        if (warnings?.length) {
          Alert.alert(
            "Plan generated (auto-fixed)",
            warnings.slice(0, 6).join("\n") + (warnings.length > 6 ? `\n… +${warnings.length - 6} more` : "")
          );
        }

        AsyncStorage.removeItem(JOB_KEY).catch(() => {});
        setJobId(null);

        if (unsubRef.current) {
          try { unsubRef.current(); } catch {}
          unsubRef.current = null;
        }
      }

      if (data.status === "error") {
        setAiLoading(false);
        Alert.alert("AI generation failed", data.error || "Try again.");

        AsyncStorage.removeItem(JOB_KEY).catch(() => {});
        setJobId(null);

        if (unsubRef.current) {
          try { unsubRef.current(); } catch {}
          unsubRef.current = null;
        }
      }
    });
  }

  // restore job
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const savedJobId = await AsyncStorage.getItem(JOB_KEY);
        if (!savedJobId || !mounted) return;

        setJobId(savedJobId);
        setAiLoading(true);
        subscribeToJob(uid, savedJobId);
      } catch {
        // ignore
      }
    })();

    return () => {
      mounted = false;
      if (unsubRef.current) {
        try { unsubRef.current(); } catch {}
        unsubRef.current = null;
      }
    };
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) {
      Alert.alert("Missing info", "Add Plan name, Weeks, and at least 1 training day.");
      return;
    }

    setAiLoading(true);
    setGenerated(null);
    setJob(null);
    setJobId(null);

    // clean previous subscription
    if (unsubRef.current) {
      try { unsubRef.current(); } catch {}
      unsubRef.current = null;
    }

    try {
      const uid = uidOrThrow();
      const { prompt, meta } = buildPrompt();

      const body = await authedFetch(AI_PLAN_START_ENDPOINT, { prompt, meta });

      const newJobId = safeStr(body?.jobId);
      if (!newJobId) throw new Error("Server did not return jobId.");

      setJobId(newJobId);
      await AsyncStorage.setItem(JOB_KEY, newJobId);

      subscribeToJob(uid, newJobId);
    } catch (e) {
      setAiLoading(false);
      Alert.alert("AI generation failed", e?.message || "Try again.");
      AsyncStorage.removeItem(JOB_KEY).catch(() => {});
      setJobId(null);
    }
  }, [
    canGenerate,
    planName,
    goal,
    weeks,
    startDate,
    daysAvailable,
    runsPerWeek,
    hyroxPerWeek,
    strengthPerWeek,
    allowDoubleDays,
    maxSessionsPerDay,
    doubleDayStyle,
    level,
    age,
    sex,
    heightCm,
    weightKg,
    injuries,
    fiveK,
    tenK,
    weeklyKm,
    benchKg,
    squatKg,
    deadliftKg,
    equipmentCsv,
    timePerSessionMin,
    notes,
    apiBase,
  ]);

  const canSave = useMemo(() => !!generated?.plan?.length && !saving, [generated, saving]);

  const handleSave = useCallback(async () => {
    if (!generated?.plan?.length) return Alert.alert("Nothing to save", "Generate a plan first.");
    if (saving) return;

    setSaving(true);
    try {
      const uid = uidOrThrow();

      const payload = stripUndefinedDeep({
        schemaVersion: SCHEMA_VERSION,
        name: generated.name || safeStr(planName),
        goal: generated.goal || safeStr(goal),
        weeks: generated.weeks,
        startDate: generated.startDate || safeStr(startDate),
        profile: generated.profile || {},
        plan: generated.plan,
        builderSettings: {
          allowDoubleDays,
          maxSessionsPerDay: clamp(toNum(maxSessionsPerDay, 2) ?? 2, 1, 3),
          doubleDayStyle,
          runsPerWeek: clamp(toNum(runsPerWeek, 4) ?? 4, 0, 14),
          hyroxPerWeek: clamp(toNum(hyroxPerWeek, 2) ?? 2, 0, 14),
          strengthPerWeek: clamp(toNum(strengthPerWeek, 4) ?? 4, 0, 14),
          timePerSessionMin: clamp(toNum(timePerSessionMin, 60) ?? 60, 10, 240),
          daysAvailable,
        },
        notes: safeStr(notes),
      });

      const ref = collection(db, "users", uid, "trainingPlans");
      const created = await addDoc(ref, withTimestamps(payload, { create: true }));

      Alert.alert("Saved", "Training plan created.");
      router.replace(`/plans/${created.id}`);
    } catch (e) {
      console.log("PLAN SAVE ERROR:", e);
      Alert.alert("Save failed", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  }, [
    generated,
    planName,
    goal,
    startDate,
    notes,
    router,
    saving,
    allowDoubleDays,
    maxSessionsPerDay,
    doubleDayStyle,
    runsPerWeek,
    hyroxPerWeek,
    strengthPerWeek,
    timePerSessionMin,
    daysAvailable,
  ]);

  const progressPct = useMemo(() => clamp(toNum(job?.progress, 0) ?? 0, 0, 100), [job?.progress]);

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>Plan Builder</Text>
          <Text style={s.headerSub}>User-paced runs • Primary lifts + accessories • Garmin-friendly structure</Text>
        </View>

        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Plan basics */}
        <Card title="Plan basics" s={s}>
          <Field label="Plan name *" value={planName} onChange={setPlanName} s={s} colors={colors} isDark={isDark} />
          <Field label="Goal *" value={goal} onChange={setGoal} s={s} colors={colors} isDark={isDark} multiline />

          <Row>
            <MiniField label="Weeks *" value={weeks} onChange={setWeeks} s={s} colors={colors} isDark={isDark} />
            <MiniField
              label="Start date (YYYY-MM-DD)"
              value={startDate}
              onChange={setStartDate}
              s={s}
              colors={colors}
              isDark={isDark}
              numeric={false}
            />
          </Row>

          <Text style={s.label}>Days available *</Text>
          <View style={s.dayRow}>
            {DAYS.map((d) => {
              const active = daysAvailable.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [s.dayPill, active && s.dayPillActive, pressed && { opacity: 0.85 }]}
                >
                  <Text style={[s.dayText, active && s.dayTextActive]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Split */}
        <Card title="Weekly split targets" s={s}>
          <Row>
            <MiniField label="Runs / week" value={runsPerWeek} onChange={setRunsPerWeek} s={s} colors={colors} isDark={isDark} />
            <MiniField label="Hyrox / week" value={hyroxPerWeek} onChange={setHyroxPerWeek} s={s} colors={colors} isDark={isDark} />
            <MiniField
              label="Strength / week"
              value={strengthPerWeek}
              onChange={setStrengthPerWeek}
              s={s}
              colors={colors}
              isDark={isDark}
            />
          </Row>

          <Row>
            <MiniField
              label="Time cap (min)"
              value={timePerSessionMin}
              onChange={setTimePerSessionMin}
              s={s}
              colors={colors}
              isDark={isDark}
            />
            <MiniField
              label="Max sessions/day"
              value={maxSessionsPerDay}
              onChange={setMaxSessionsPerDay}
              s={s}
              colors={colors}
              isDark={isDark}
            />
          </Row>

          <View style={s.inlineRow}>
            <Text style={s.label}>Allow double days</Text>
            <TouchableOpacity
              onPress={() => setAllowDoubleDays((v) => !v)}
              style={[s.switchPill, allowDoubleDays && s.switchPillOn]}
              activeOpacity={0.85}
            >
              <Text style={[s.switchText, allowDoubleDays && s.switchTextOn]}>{allowDoubleDays ? "ON" : "OFF"}</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.label}>Double-day style</Text>
          <View style={s.pillRow}>
            {DOUBLE_STYLES.map((x) => {
              const active = doubleDayStyle === x.key;
              return (
                <TouchableOpacity
                  key={x.key}
                  onPress={() => setDoubleDayStyle(x.key)}
                  style={[s.pill, active && s.pillActive]}
                  activeOpacity={0.85}
                >
                  <Text style={[s.pillText, active && s.pillTextActive]}>{x.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={s.hint}>
            Tip: fill in 5K/10K for auto-derived pace bands (used inside Garmin runSteps).
          </Text>
        </Card>

        {/* Athlete */}
        <Card title="Athlete profile" s={s}>
          <Text style={s.label}>Level</Text>
          <View style={s.pillRow}>
            {LEVELS.map((l) => {
              const active = level === l.key;
              return (
                <TouchableOpacity
                  key={l.key}
                  onPress={() => setLevel(l.key)}
                  style={[s.pill, active && s.pillActive]}
                  activeOpacity={0.85}
                >
                  <Text style={[s.pillText, active && s.pillTextActive]}>{l.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Row>
            <MiniField label="Age" value={age} onChange={setAge} s={s} colors={colors} isDark={isDark} />
            <MiniField label="Sex" value={sex} onChange={setSex} s={s} colors={colors} isDark={isDark} numeric={false} />
          </Row>
          <Row>
            <MiniField label="Height (cm)" value={heightCm} onChange={setHeightCm} s={s} colors={colors} isDark={isDark} />
            <MiniField label="Weight (kg)" value={weightKg} onChange={setWeightKg} s={s} colors={colors} isDark={isDark} />
          </Row>

          <Field
            label="Injuries / constraints"
            value={injuries}
            onChange={setInjuries}
            s={s}
            colors={colors}
            isDark={isDark}
            placeholder="e.g. Achilles, lower back, none"
          />
        </Card>

        {/* Benchmarks */}
        <Card title="Benchmarks" s={s}>
          <Row>
            <MiniField label="5K time (mm:ss)" value={fiveK} onChange={setFiveK} s={s} colors={colors} isDark={isDark} numeric={false} />
            <MiniField label="10K time (mm:ss)" value={tenK} onChange={setTenK} s={s} colors={colors} isDark={isDark} numeric={false} />
            <MiniField label="Weekly km" value={weeklyKm} onChange={setWeeklyKm} s={s} colors={colors} isDark={isDark} />
          </Row>
          <Row>
            <MiniField label="Bench (kg)" value={benchKg} onChange={setBenchKg} s={s} colors={colors} isDark={isDark} />
            <MiniField label="Squat (kg)" value={squatKg} onChange={setSquatKg} s={s} colors={colors} isDark={isDark} />
            <MiniField label="Deadlift (kg)" value={deadliftKg} onChange={setDeadliftKg} s={s} colors={colors} isDark={isDark} />
          </Row>

          {/* quick derived pace preview */}
          {(() => {
            const pb = derivePaceBands({ fiveK, tenK, level });
            if (!pb) return null;
            return (
              <View style={s.paceCard}>
                <Text style={s.paceTitle}>Derived pace bands (min/km)</Text>
                <Text style={s.paceLine}>Easy: {pb.easy.low} – {pb.easy.high}</Text>
                <Text style={s.paceLine}>Steady: {pb.steady.low} – {pb.steady.high}</Text>
                <Text style={s.paceLine}>Tempo: {pb.tempo.low} – {pb.tempo.high}</Text>
                <Text style={s.paceLine}>Threshold: {pb.threshold.low} – {pb.threshold.high}</Text>
                <Text style={s.paceLine}>VO2/Intervals: {pb.vo2.low} – {pb.vo2.high}</Text>
              </View>
            );
          })()}
        </Card>

        {/* Equipment */}
        <Card title="Equipment + notes" s={s}>
          <Field
            label="Equipment (comma-separated)"
            value={equipmentCsv}
            onChange={setEquipmentCsv}
            s={s}
            colors={colors}
            isDark={isDark}
            placeholder="barbell,dumbbell,sled,rower,ski,bike"
          />
          <Field
            label="Extra coaching notes (optional)"
            value={notes}
            onChange={setNotes}
            s={s}
            colors={colors}
            isDark={isDark}
            multiline
            placeholder="e.g. Deload week 4. Avoid heavy deadlifts. Prefer treadmill intervals."
          />
        </Card>

        {/* Generate */}
        <TouchableOpacity
          style={[s.primaryBtn, (!canGenerate || aiLoading) && { opacity: 0.5 }]}
          activeOpacity={0.9}
          onPress={handleGenerate}
          disabled={!canGenerate || aiLoading}
        >
          {aiLoading ? <ActivityIndicator /> : <Feather name="zap" size={18} color="#111111" />}
          <Text style={s.primaryBtnText}>{aiLoading ? "Generating…" : "Generate full plan"}</Text>
        </TouchableOpacity>

        {/* Progress panel */}
        {aiLoading ? (
          <View style={s.progressCard}>
            <View style={s.progressTop}>
              <Text style={s.progressTitle}>
                {safeStr(job?.message) || "Building plan…"}{" "}
                {Number.isFinite(toNum(job?.progress)) ? `${progressPct}%` : ""}
              </Text>
              <View style={s.progressRight}>
                {jobId ? (
                  <View style={s.progressTag}>
                    <Text style={s.progressTagText}>RUNNING</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={s.progressBarOuter}>
              <View style={[s.progressBarInner, { width: `${progressPct}%` }]} />
            </View>

            <Text style={s.progressHint}>You can leave this screen — progress will resume automatically.</Text>
          </View>
        ) : null}

        {/* Preview */}
        {generated?.plan?.length ? (
          <View style={{ marginTop: 14 }}>
            <Text style={s.sectionTitle}>Preview</Text>

            <View style={s.previewCard}>
              <Text style={s.previewTitle}>{generated.name || planName}</Text>
              <Text style={s.previewSub}>
                {generated.weeks} weeks • start {generated.startDate || startDate || "TBC"}
              </Text>
            </View>

            {generated.plan.map((w0) => (
              <View key={`w_${w0.week}`} style={s.weekCard}>
                <Text style={s.weekTitle}>Week {w0.week}</Text>

                {(w0.days || []).map((d) => (
                  <View key={`w${w0.week}_${d.day}`} style={s.dayCard}>
                    <Text style={s.dayTitle}>{d.day}</Text>

                    {(d.sessions || []).length === 0 ? (
                      <Text style={s.restText}>Rest / no session</Text>
                    ) : (
                      (d.sessions || []).map((sess) => (
                        <View key={sess.id} style={s.sessionCard}>
                          <View style={s.sessionTopRow}>
                            <Text style={s.sessionTitle} numberOfLines={1}>
                              {sess.name}
                            </Text>

                            <View style={s.badgeRow}>
                              {sess.timeOfDay ? (
                                <View style={s.badge}><Text style={s.badgeText}>{sess.timeOfDay}</Text></View>
                              ) : null}
                              {sess.priority ? (
                                <View style={[s.badge, sess.priority === "primary" ? s.badgePrimary : s.badgeSecondary]}>
                                  <Text style={s.badgeText}>{sess.priority}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>

                          <Text style={s.sessionMeta}>
                            {sess.type} • {sess.durationMin} min • {sess.blocks?.length || 0} blocks
                            {sess.type === "run" ? ` • ${asArr(sess.runSteps).length || 0} steps` : ""}
                          </Text>

                          {sess.notes ? <Text style={s.sessionNotes}>{sess.notes}</Text> : null}
                        </View>
                      ))
                    )}
                  </View>
                ))}
              </View>
            ))}

            <TouchableOpacity
              style={[s.saveBtn, (!canSave || saving) && { opacity: 0.5 }]}
              activeOpacity={0.9}
              onPress={handleSave}
              disabled={!canSave || saving}
            >
              {saving ? <ActivityIndicator /> : <Feather name="save" size={18} color="#111111" />}
              <Text style={s.saveBtnText}>{saving ? "Saving…" : "Save plan"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- small UI ---------------- */
function Row({ children }) {
  return <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;
}

function Card({ title, children, s }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, multiline, s, colors, isDark }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        style={[s.input, multiline && { height: 90, textAlignVertical: "top", paddingTop: 10 }]}
        multiline={multiline}
        keyboardAppearance={isDark ? "dark" : "light"}
      />
    </View>
  );
}

function MiniField({ label, value, onChange, placeholder, s, colors, isDark, numeric = true }) {
  return (
    <View style={{ flex: 1, marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        style={s.input}
        keyboardType={numeric ? "numeric" : "default"}
        keyboardAppearance={isDark ? "dark" : "light"}
        autoCorrect={!numeric}
        autoCapitalize="none"
      />
    </View>
  );
}

/* ---------------- styles ---------------- */
function makeStyles(colors, isDark) {
  const cardBg = isDark ? "#111217" : "#FFFFFF";
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const border = isDark ? "#1F2128" : "#E1E3E8";
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";

  const softShadow = isDark
    ? { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4 }
    : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 2 };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: border, alignItems: "center", justifyContent: "center", ...softShadow },
    headerTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
    headerSub: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 2, textAlign: "center" },
    scroll: { paddingHorizontal: 18, paddingBottom: 28 },

    card: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 14, ...softShadow },
    cardTitle: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 10 },

    label: { color: colors.subtext, fontSize: 11, fontWeight: "900", letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 6 },
    input: { backgroundColor: panelBg, borderRadius: 16, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 10, borderWidth: StyleSheet.hairlineWidth, borderColor: border, color: colors.text, fontWeight: "700", fontSize: 14 },

    hint: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6, lineHeight: 16 },

    dayRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    dayPill: { backgroundColor: panelBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    dayPillActive: { backgroundColor: accentBg, borderColor: accentBg },
    dayText: { color: colors.text, fontWeight: "900", fontSize: 12 },
    dayTextActive: { color: "#111111" },

    pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
    pill: { backgroundColor: panelBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    pillActive: { backgroundColor: accentBg, borderColor: accentBg },
    pillText: { color: colors.text, fontWeight: "800", fontSize: 12 },
    pillTextActive: { color: "#111111", fontWeight: "900" },

    inlineRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4, marginBottom: 10 },
    switchPill: { backgroundColor: panelBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    switchPillOn: { backgroundColor: accentBg, borderColor: accentBg },
    switchText: { color: colors.text, fontWeight: "900", fontSize: 12 },
    switchTextOn: { color: "#111111" },

    primaryBtn: { marginTop: 6, backgroundColor: accentBg, borderRadius: 22, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, ...softShadow },
    primaryBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },

    progressCard: { marginTop: 10, backgroundColor: cardBg, borderRadius: 18, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: border, ...softShadow },
    progressTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    progressTitle: { flex: 1, color: colors.text, fontWeight: "900", fontSize: 13 },
    progressRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    progressTag: { backgroundColor: isDark ? "rgba(230,255,59,0.14)" : "rgba(230,255,59,0.35)", borderWidth: StyleSheet.hairlineWidth, borderColor: isDark ? "rgba(230,255,59,0.45)" : "rgba(0,0,0,0.06)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
    progressTagText: { color: colors.text, fontWeight: "900", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
    progressBarOuter: { marginTop: 10, height: 10, borderRadius: 999, backgroundColor: isDark ? "#1F2128" : "#E9EDF3", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    progressBarInner: { height: "100%", backgroundColor: accentBg, borderRadius: 999 },
    progressHint: { marginTop: 8, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    sectionTitle: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 10 },

    previewCard: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 12, ...softShadow },
    previewTitle: { color: colors.text, fontWeight: "900", fontSize: 16 },
    previewSub: { marginTop: 6, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    weekCard: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 12, ...softShadow },
    weekTitle: { color: colors.text, fontWeight: "900", fontSize: 14, marginBottom: 10 },

    dayCard: { backgroundColor: panelBg, borderRadius: 18, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 10 },
    dayTitle: { color: colors.text, fontWeight: "900", marginBottom: 8 },
    restText: { color: colors.subtext, fontWeight: "700", fontSize: 12 },

    sessionCard: { backgroundColor: isDark ? "#101116" : "#FFFFFF", borderRadius: 16, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 8 },
    sessionTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    sessionTitle: { flex: 1, color: colors.text, fontWeight: "900" },
    sessionMeta: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },
    sessionNotes: { marginTop: 6, color: colors.text, fontWeight: "650", fontSize: 12, opacity: 0.9 },

    badgeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: border, backgroundColor: panelBg },
    badgeText: { color: colors.text, fontWeight: "900", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 },
    badgePrimary: { backgroundColor: "rgba(230,255,59,0.18)", borderColor: "rgba(230,255,59,0.45)" },
    badgeSecondary: { backgroundColor: "rgba(148,163,184,0.10)", borderColor: border },

    saveBtn: { marginTop: 6, backgroundColor: accentBg, borderRadius: 22, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, ...softShadow },
    saveBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },

    paceCard: { marginTop: 10, backgroundColor: isDark ? "#0F1015" : "#F7F9FC", borderRadius: 16, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    paceTitle: { color: colors.text, fontWeight: "900", marginBottom: 6 },
    paceLine: { color: colors.subtext, fontWeight: "800", fontSize: 12, lineHeight: 16 },
  });
}
