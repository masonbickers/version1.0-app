// server/routes/workout.js
// ESM + matches your server pattern: export default (openai) => router
// Mounted as: app.use("/workouts", workoutRoutes(openai))
// Endpoints:
//   GET  /workouts/health
//   POST /workouts/ai  { prompt, meta? }

import express from "express";
import { requireUser } from "../utils/requireUser.js";

const router = express.Router();

/* ---------------- helpers ---------------- */

function safeStr(v) {
  return String(v ?? "").trim();
}
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function isValidBlockKind(k) {
  return ["warmup", "strength", "conditioning", "hyrox", "accessory", "cooldown"].includes(k);
}
function isValidItemKind(k) {
  return ["exercise", "interval", "emom", "amrap", "for_time"].includes(k);
}

function normaliseWorkoutResponse(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];

  const normalisedBlocks = blocks.map((b) => {
    const kind = isValidBlockKind(b?.kind) ? b.kind : "strength";
    const title = safeStr(b?.title) || kind.toUpperCase();

    const items = Array.isArray(b?.items) ? b.items : [];
    const normalisedItems = items
      .map((it) => {
        const k = isValidItemKind(it?.kind) ? it.kind : "exercise";
        const base = {
          id: it?.id || uid(),
          kind: k,
          name: safeStr(it?.name) || (k === "exercise" ? "Exercise" : "Item"),
          notes: safeStr(it?.notes) || "",
        };

        if (k === "exercise") {
          return {
            ...base,
            sets: it?.sets != null ? clamp(toNum(it.sets, 0), 0, 50) : undefined,
            reps: it?.reps != null ? clamp(toNum(it.reps, 0), 0, 200) : undefined,
            weight: it?.weight != null ? toNum(it.weight, 0) : undefined,
            rpe: it?.rpe != null ? toNum(it.rpe, 0) : undefined,
            restSec: it?.restSec != null ? clamp(toNum(it.restSec, 0), 0, 3600) : undefined,
          };
        }

        if (k === "interval") {
          return {
            ...base,
            workSec: it?.workSec != null ? clamp(toNum(it.workSec, 0), 0, 3600) : undefined,
            restSec: it?.restSec != null ? clamp(toNum(it.restSec, 0), 0, 3600) : undefined,
            rounds: it?.rounds != null ? clamp(toNum(it.rounds, 0), 1, 200) : undefined,
          };
        }

        // emom / amrap / for_time
        return {
          ...base,
          minutes: it?.minutes != null ? clamp(toNum(it.minutes, 0), 1, 240) : undefined,
          task: safeStr(it?.task) || "",
        };
      })
      .filter(Boolean);

    return {
      id: b?.id || uid(),
      title,
      kind,
      items: normalisedItems,
    };
  });

  return {
    name: safeStr(data.name),
    type: safeStr(data.type),
    goal: safeStr(data.goal),
    durationMin:
      data.durationMin != null && Number.isFinite(Number(data.durationMin))
        ? clamp(toNum(data.durationMin, 0), 0, 600)
        : undefined,
    notes: safeStr(data.notes),
    blocks: normalisedBlocks,
  };
}

function buildSystemPrompt() {
  return `
You generate a SINGLE workout session in structured JSON.

Rules:
- Output MUST be valid JSON (no markdown).
- Include: { name, type, goal, durationMin, notes, blocks: [...] }
- blocks: array of { title, kind, items }
- kind must be one of: warmup | strength | conditioning | hyrox | accessory | cooldown
- items must be array of:
  1) Exercise:
     { kind:"exercise", name, notes?, sets?, reps?, weight?, rpe?, restSec? }
  2) Interval:
     { kind:"interval", name, notes?, workSec, restSec, rounds }
  3) EMOM/AMRAP/FOR_TIME:
     { kind:"emom"|"amrap"|"for_time", name?, notes?, minutes, task? }

Guidelines:
- Keep it realistic and coach-like.
- If user provides duration, fit it (roughly).
- Add a warmup and cooldown when possible.
- If user mentions Hyrox, include Hyrox-style conditioning (sled push/pull, burpees, row, run etc) if appropriate.
- Use sensible defaults:
  - strength sets 3-5, reps 3-12, rest 60-180 sec
  - intervals rounds 4-10 with work/rest 30-120 sec
- Don't include medical claims or injury rehab advice.
`.trim();
}

function buildUserPrompt(prompt, meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  return `
User request:
${safeStr(prompt)}

Existing meta (may be empty; you may refine it):
- name: ${safeStr(m.name)}
- type: ${safeStr(m.type)}
- goal: ${safeStr(m.goal)}
- durationMin: ${m.durationMin != null ? String(m.durationMin) : ""}
- notes: ${safeStr(m.notes)}

Return JSON only.
`.trim();
}

/* ---------------- routes factory ---------------- */

export default function workoutRoutes(openai) {
  // quick health check
  router.get("/health", (_req, res) => {
    res.json({ ok: true, route: "workout" });
  });

  // POST /workouts/ai
  router.post("/ai", requireUser, async (req, res) => {
    try {
      const prompt = safeStr(req.body?.prompt);
      const meta = req.body?.meta && typeof req.body.meta === "object" ? req.body.meta : {};

      if (!prompt) return res.status(400).json({ error: "Missing prompt." });
      if (!openai) return res.status(500).json({ error: "OpenAI client not configured on server." });

      const model = process.env.OPENAI_MODEL_WORKOUT || "gpt-4o-mini";
      const system = buildSystemPrompt();
      const user = buildUserPrompt(prompt, meta);

      const completion = await openai.chat.completions.create({
        model,
        temperature: 0.6,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // openai v4 supports this; if your installed version doesn't, remove this line
        response_format: { type: "json_object" },
      });

      const content = completion?.choices?.[0]?.message?.content || "";
      let parsed = null;

      try {
        parsed = JSON.parse(content);
      } catch {
        return res.status(502).json({
          error: "AI did not return valid JSON.",
          raw: content?.slice(0, 2000),
        });
      }

      const normalised = normaliseWorkoutResponse(parsed);

      if (!Array.isArray(normalised.blocks) || normalised.blocks.length === 0) {
        return res.status(502).json({
          error: "AI returned no blocks. Try a more specific prompt.",
          raw: parsed,
        });
      }

      return res.json(normalised);
    } catch (err) {
      return res.status(500).json({ error: safeStr(err?.message) || "Unknown error" });
    }
  });

  return router;
}
