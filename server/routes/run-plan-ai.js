// server/routes/run-plan-ai.js
import express from "express";

export default function runPlanAiRoute(openai) {
  const router = express.Router();

  /* -------------------------------------------------------------------------- */
  /*  Safety: if no OpenAI client, we'll just use a local fallback              */
  /* -------------------------------------------------------------------------- */

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const defaultWeeks = 8;
  const defaultSessionsPerWeek = 4;

  /**
   * Simple local fallback plan if OpenAI is not configured or errors.
   * Structure matches the TrainingPlan JSON schema used in ai-plan.js.
   */
  function makeFallbackPlan(form = {}) {
    const goal = form.goal || {};
    const profile = form.profile || {};
    const availability = form.availability || {};

    const goalType =
      goal.distance ||
      goal.primaryFocus ||
      "Run goal";

    const weeksRequested = form.weeks || defaultWeeks;
    const sessionsPerWeek =
      availability.daysPerWeek || defaultSessionsPerWeek;

    const wCount = clamp(Number(weeksRequested) || defaultWeeks, 1, 24);
    const sPerWeek = clamp(
      Number(sessionsPerWeek) || defaultSessionsPerWeek,
      1,
      7
    );

    const weeksArr = [];

    for (let w = 0; w < wCount; w++) {
      const title =
        w === 0
          ? "Week 1 – base running (fallback)"
          : `Week ${w + 1} – base running (fallback)`;

      const weekDays = DAYS.map((dayName, idx) => {
        if (idx >= sPerWeek) {
          return { day: dayName, sessions: [] };
        }

        const typicalWeeklyKm =
          profile.currentWeeklyDistanceKm || 30;
        const baseRunMinutes = clamp(
          Math.round(typicalWeeklyKm * 2),
          30,
          75
        );

        return {
          day: dayName,
          sessions: [
            {
              label: "Easy run",
              notes:
                "Local fallback plan – generated without AI. Adjust as needed for your level.",
              steps: [
                {
                  type: "Easy",
                  description: "Comfortable, conversational pace on road or treadmill.",
                  durationMinutes: baseRunMinutes,
                  distanceKm: 0,
                  intensity: "Easy · Z2",
                },
                {
                  type: "Optional strides",
                  description: "4–6 x 20s relaxed strides at 5K effort with full recovery.",
                  durationMinutes: 8,
                  distanceKm: 0,
                  intensity: "Strides",
                },
              ],
            },
          ],
        };
      });

      weeksArr.push({
        title,
        focus: "Base endurance (fallback)",
        days: weekDays,
      });
    }

    return {
      name: `Plan – ${goalType}`,
      goalType,
      weeks: weeksArr,
    };
  }

  /* -------------------------------------------------------------------------- */
  /*  JSON schema (same structure as in ai-plan.js)                             */
  /* -------------------------------------------------------------------------- */

  const trainingStepSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        description:
          "Short label for the step, e.g. 'Warmup', 'Intervals', 'Easy'",
      },
      description: {
        type: "string",
        description: "What to do in this step (structure, feel, etc.)",
      },
      durationMinutes: {
        type: "number",
        description:
          "Duration in minutes for this step. 0 if step is purely distance based.",
      },
      distanceKm: {
        type: "number",
        description:
          "Distance in kilometres for this step. 0 if step is purely time based.",
      },
      intensity: {
        type: "string",
        description:
          "Intensity cue: pace (/km), HR zone, RPE, or qualitative effort.",
      },
    },
    required: ["type", "description", "durationMinutes", "distanceKm", "intensity"],
  };

  const trainingSessionSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: {
        type: "string",
        description: "Session title, e.g. 'Easy run', 'Intervals 6 x 1km'",
      },
      notes: {
        type: "string",
        description:
          "High-level coaching notes for the whole session, shoes, surface, focus, etc.",
      },
      steps: {
        type: "array",
        description: "Ordered steps that make up the full session.",
        items: trainingStepSchema,
        minItems: 1,
      },
    },
    required: ["label", "notes", "steps"],
  };

  const trainingDaySchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      day: {
        type: "string",
        description: "Day of week (Mon, Tue, ...).",
        enum: DAYS,
      },
      sessions: {
        type: "array",
        items: trainingSessionSchema,
        description: "One or more sessions for this day (often 0–1).",
      },
    },
    required: ["day", "sessions"],
  };

  const trainingWeekSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "Week title, e.g. 'Week 1 – Base running'.",
      },
      focus: {
        type: "string",
        description: "High-level focus (base, build, taper, race week, etc.).",
      },
      days: {
        type: "array",
        description: "Seven days of the week with sessions.",
        items: trainingDaySchema,
        minItems: 1,
        maxItems: 7,
      },
    },
    required: ["title", "focus", "days"],
  };

  const trainingPlanSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        description: "Full plan name, suitable to show in UI.",
      },
      goalType: {
        type: "string",
        description: "Goal type (10k, Half, Marathon, Hyrox, etc.).",
      },
      weeks: {
        type: "array",
        items: trainingWeekSchema,
        minItems: 1,
        description: "Ordered weeks of the plan.",
      },
    },
    required: ["name", "goalType", "weeks"],
  };

  /* -------------------------------------------------------------------------- */
  /*  POST /run-plan-ai                                                         */
  /* -------------------------------------------------------------------------- */

  router.post("/", async (req, res) => {
    const form = req.body || {};

    // If no OpenAI, return a fallback but still match shape
    if (!openai) {
      const fallbackPlan = makeFallbackPlan(form);
      return res.json({
        ok: true,
        plan: fallbackPlan,
        meta: {
          createdAt: new Date().toISOString(),
          source: "run-plan-ai-local-fallback",
        },
      });
    }

    try {
      const goal = form.goal || {};
      const profile = form.profile || {};
      const availability = form.availability || {};
      const preferences = form.preferences || {};
      const constraints = form.constraints || {};

      const goalType =
        goal.distance ||
        goal.primaryFocus ||
        "Run goal";

      const systemPrompt = `
You are an experienced UK endurance coach.
You design pragmatic training plans for busy amateur athletes who care about performance,
recovery and injury prevention.

You must output a structured JSON training plan that strictly matches the TrainingPlan JSON schema.
Do not invent fields that are not in the schema.
All runs should be described in realistic minutes and/or km, with clear intensity cues.
`.trim();

      const context = {
        goalType,
        intakeForm: form,
        summary: {
          goal,
          profile,
          availability,
          preferences,
          constraints,
        },
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
                  "Create a structured running training plan that exactly matches the TrainingPlan JSON schema. " +
                  "Here is the runner's full intake form JSON:\n" +
                  JSON.stringify(context, null, 2),
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
        console.error("[run-plan-ai] JSON parse error, falling back:", e);
        plan = null;
      }

      // If AI fails or shape is broken, use fallback
      if (!plan || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
        const fallbackPlan = makeFallbackPlan(form);
        return res.json({
          ok: true,
          plan: fallbackPlan,
          meta: {
            createdAt: new Date().toISOString(),
            source: "run-plan-ai-fallback-invalid-json",
          },
        });
      }

      // Happy path – valid schema-compliant plan
      const meta = {
        createdAt: new Date().toISOString(),
        source: "run-plan-ai-schema-v1",
      };

      return res.json({ ok: true, plan, meta });
    } catch (err) {
      console.error("[run-plan-ai] error:", err);

      const fallbackPlan = makeFallbackPlan(req.body || {});
      return res.json({
        ok: true,
        plan: fallbackPlan,
        meta: {
          createdAt: new Date().toISOString(),
          source: "run-plan-ai-fallback-error",
          error: err?.message,
        },
      });
    }
  });

  return router;
}
