// server/routes/coach-chat.js
import express from "express";

/**
 * Coach chat route for Train-R.
 *
 * Request body:
 * {
 *   messages: [{ role: "user" | "assistant" | "system", content: string }],
 *   plan?: {
 *     sessions?: Array<any>,
 *     planConfig?: object,
 *     aiContext?: string,
 *     meta?: object
 *   }
 * }
 *
 * Response:
 * {
 *   reply: string,
 *   updatedPlan: object | null,
 *   raw: string
 * }
 */
export default function coachChatRoute(openai) {
  const router = express.Router();

  if (!openai) {
    console.warn("[coach-chat] OpenAI client not configured.");
  }

  router.post("/", async (req, res) => {
    try {
      if (!openai) {
        return res.status(500).json({
          error: "OpenAI client not configured on the server.",
        });
      }

      const { messages, plan } = req.body || {};

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Request body must include a non-empty 'messages' array.",
        });
      }

      const trimmedMessages = messages.slice(-20);

      const systemPrompt = `
You are Train-R's AI coach.

You can:
- Answer questions about training, running, Hyrox, strength, recovery, and nutrition.
- Give specific guidance about how to fuel before/after sessions, race-week strategy, sleep, and recovery.
- When a training plan "plan" is provided, you can MODIFY it if needed:
  - Adjust sessions, intensities, distances, days, or add/remove sessions.
  - Adapt the plan for niggles/injuries (e.g. swap a run for cross-training, reduce volume, change intensities).
  - Respect the user's constraints and progression (avoid huge jumps in volume).

IMPORTANT:
- Be safe and conservative with injury advice. Encourage seeing a qualified professional if pain persists or is severe.
- For nutrition, give practical, performance-focused advice (carbs, protein, hydration, timing).

RESPONSE FORMAT (CRITICAL):
You MUST respond with VALID JSON ONLY, no markdown, no backticks, with shape:

{
  "reply": "What you want to say to the user (chat message).",
  "updatedPlan": { ... } // plan object, or null if you didn't change anything
}

Rules:
- "reply" must be a string.
- "updatedPlan" must be:
    - The modified plan using the SAME structure as the input "plan", OR
    - The original plan unchanged if you choose not to modify, OR
    - null if no plan was provided.
- Do NOT include extra top-level keys.
- Do NOT include comments.
- Do NOT wrap the JSON in markdown code fences.
      `.trim();

      const planContext = plan
        ? {
            sessions: plan.sessions || [],
            planConfig: plan.planConfig || {},
            aiContext: plan.aiContext || "",
            meta: plan.meta || {},
          }
        : null;

      const systemPlanMessage = planContext
        ? {
            role: "system",
            content:
              "Here is this user's current training plan context (sessions, config, notes). You may update it if appropriate:\n\n" +
              JSON.stringify(planContext).slice(0, 12000),
          }
        : {
            role: "system",
            content:
              "No plan JSON is provided. If the user asks to change their plan, explain you don't have their plan loaded but still give general advice.",
          };

      const chatMessages = [
        { role: "system", content: systemPrompt },
        systemPlanMessage,
        ...trimmedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: chatMessages,
        temperature: 0.4,
        response_format: { type: "text" },
      });

      const raw =
        completion.choices?.[0]?.message?.content?.trim() || "";

      let reply = "Got it — let's keep going.";
      let updatedPlan = plan || null;

      try {
        const parsed = JSON.parse(raw);

        if (parsed && typeof parsed === "object") {
          if (typeof parsed.reply === "string") {
            reply = parsed.reply;
          }
          if ("updatedPlan" in parsed) {
            updatedPlan = parsed.updatedPlan;
          }
        } else {
          reply = raw || reply;
        }
      } catch (err) {
        console.warn("[coach-chat] Failed to parse JSON:", err);
        reply = raw || reply;
      }

      return res.json({
        reply,
        updatedPlan,
        raw,
      });
    } catch (err) {
      console.error("[coach-chat] error:", err);
      return res.status(500).json({
        error: "Something went wrong in coach-chat.",
        details: err?.message || String(err),
      });
    }
  });

  return router;
}
