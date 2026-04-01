// server/routes/train-chat.js
import express from "express";
import OpenAI from "openai";

// 🔥 IMPORT THE TRANSFORMER
import { convertAiPlanToApp } from "../utils/train/planTransformers.js";
const router = express.Router();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/* ----------------------------------------------------------------------------
   Small helpers
---------------------------------------------------------------------------- */

// Summarise plan for ChatGPT
function summarisePlan(plan) {
  if (!plan || !Array.isArray(plan.weeks)) {
    return {
      weeksCount: 0,
      sessionsCount: 0,
      totalMinutes: 0,
      totalKm: 0,
      weeks: [],
    };
  }

  let sessionsCount = 0;
  let totalMinutes = 0;
  let totalKm = 0;

  const weeksSummary = plan.weeks.map((w, wi) => {
    const days = Array.isArray(w.days) ? w.days : [];
    const daySummaries = days.map((d) => {
      const sessions = Array.isArray(d.sessions) ? d.sessions : [];
      const sessionsMini = sessions.map((s) => {
        sessionsCount += 1;

        const mins =
          s.targetDurationMin != null
            ? Number(s.targetDurationMin)
            : Number(s.durationMin || 0);
        const km =
          s.targetDistanceKm != null
            ? Number(s.targetDistanceKm)
            : Number(s.distanceKm || 0);

        totalMinutes += mins || 0;
        totalKm += km || 0;

        return {
          title: s.title || s.type || "Session",
          durationMin: mins || 0,
          distanceKm: km || 0,
          notes: s.notes || "",
        };
      });

      return {
        day: d.day,
        sessions: sessionsMini,
      };
    });

    return {
      title: w.title || `Week ${wi + 1}`,
      days: daySummaries,
    };
  });

  return {
    weeksCount: plan.weeks.length,
    sessionsCount,
    totalMinutes,
    totalKm: Number(totalKm.toFixed(1)),
    weeks: weeksSummary,
  };
}

// Chat history → short text
function historyToText(history = []) {
  if (!Array.isArray(history) || history.length === 0) return "None yet.";
  const last = history.slice(-6);
  return last
    .map((m) => {
      const role = m.role === "assistant" ? "Coach" : "You";
      const content = String(m.content || "").slice(0, 200);
      return `${role}: ${content}`;
    })
    .join("\n");
}

// Clean ```json … ```
function cleanJsonString(str = "") {
  let cleaned = String(str).trim();
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  return cleaned.trim();
}

/* ----------------------------------------------------------------------------
   MAIN ENDPOINT
---------------------------------------------------------------------------- */

router.post("/", async (req, res) => {
  const { message, plan, history = [], now } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  if (!plan || !Array.isArray(plan.weeks) || !plan.weeks.length) {
    return res.json({
      reply:
        "I don’t see a structured plan stored. Tell me roughly what you're doing each week and I'll help you tidy it up.",
    });
  }

  const summary = summarisePlan(plan);
  const trimmedMsg = message.trim();
  const upperMsg = trimmedMsg.toUpperCase();
  const wantsUpdate =
    upperMsg === "YES UPDATE" || upperMsg.startsWith("YES UPDATE");

  /* -------------------------------------------------------------------------
     BRANCH: USER CONFIRMED “YES UPDATE”
     → strict JSON via responses.create + small payload
  ------------------------------------------------------------------------- */
  if (wantsUpdate) {
    if (!openai) {
      return res.json({
        reply:
          "I can't update the plan because the AI service isn't configured.",
      });
    }

    try {
      // Use a light version of the plan (avoid huge Firestore object)
      const litePlan = {
        name: plan.name || "Training Plan",
        primaryActivity: plan.primaryActivity || "",
        goalType: plan.goalType || "",
        weeks: plan.weeks || [],
      };

      // Only need the last assistant message as context for what to change
      const lastCoachMessage =
        [...history]
          .reverse()
          .find((m) => m.role === "assistant")?.content || "";

      const systemText = `
You are Mason’s hybrid running/strength/Hyrox coach.

The user REPLIED "YES UPDATE".

You previously suggested some changes to the training plan.
Now you MUST apply those changes to the CURRENT_PLAN and return STRICT JSON:

{
  "reply": "short human explanation of what you changed",
  "updatedPlan": { ...FULL UPDATED PLAN OBJECT... }
}

Rules for "updatedPlan":
- It MUST be a valid JSON object.
- It MUST follow EXACTLY the same structure as CURRENT_PLAN.
- Keep fields you don't need to change AS THEY ARE.
- Only adjust the weeks/days/sessions that genuinely need to change.
- Do NOT add any new top-level keys.
- Do NOT wrap the JSON in backticks.
- Do NOT include any text outside this JSON object.
`.trim();

      const userPayload = {
        CURRENT_PLAN: litePlan,
        LAST_COACH_MESSAGE: lastCoachMessage,
        USER_CONFIRMATION: trimmedMsg,
      };

      // Small JSON schema: reply + updatedPlan (object)
      const updateSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
          reply: {
            type: "string",
            description: "Short human explanation of what changed.",
          },
          updatedPlan: {
            type: "object",
            description:
              "Full updated plan; same structure as CURRENT_PLAN (name, primaryActivity, goalType, weeks).",
          },
        },
        required: ["updatedPlan"],
      };

      const resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemText }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(userPayload, null, 2),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "PlanUpdate",
            schema: updateSchema,
          },
        },
      });

      const jsonText =
        resp.output_text || resp.output?.[0]?.content?.[0]?.text || "{}";

      const cleaned = cleanJsonString(jsonText);
      console.log("[train-chat] JSON-schema reply:", cleaned);

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        console.warn("[train-chat] JSON parse fail in YES UPDATE:", e);
        return res.json({
          reply:
            "I tried to update the plan but couldn't parse the JSON the AI returned. Please adjust manually in the editor.",
        });
      }

      let replyText =
        typeof parsed.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : "Plan updated.";

      let updatedPlan =
        parsed.updatedPlan ||
        parsed.plan ||
        parsed.trainingPlan ||
        (parsed.weeks && Array.isArray(parsed.weeks) ? parsed : null);

      if (!updatedPlan) {
        console.warn(
          "[train-chat] JSON had no updatedPlan/plan/trainingPlan/weeks:",
          parsed
        );
        return res.json({
          reply:
            "I tried to update the plan but couldn't find a valid updated structure. Please adjust manually in the editor.",
        });
      }

      // Strip fields AI should not control
      delete updatedPlan.id;
      delete updatedPlan.createdAt;
      delete updatedPlan.updatedAt;
      delete updatedPlan.coachChat;

      // 🔥 NORMALISE + MERGE WITH EXISTING PLAN (server-side)
      const finalPlan = convertAiPlanToApp(updatedPlan, plan);

      return res.json({
        reply: replyText,
        updatedPlan: finalPlan,
      });
    } catch (err) {
      console.error("[train-chat] YES UPDATE error:", err);
      return res.json({
        reply:
          "I hit a tech issue trying to rewrite your plan. For now, copy the suggestions into the editor manually.",
      });
    }
  }

  /* -------------------------------------------------------------------------
     NORMAL CHAT BRANCH (no JSON mode)
  ------------------------------------------------------------------------- */

  const avgPerWeek =
    summary.weeksCount > 0
      ? (summary.sessionsCount / summary.weeksCount).toFixed(1)
      : summary.sessionsCount;

  // Fallback if OpenAI is not configured
  if (!openai) {
    return res.json({
      reply: [
        `Can't reach the AI coach, but here's your block summary:`,
        `• Weeks: ${summary.weeksCount}`,
        `• Sessions: ${summary.sessionsCount} (~${avgPerWeek}/week)`,
        `• Volume: ${summary.totalMinutes} min / ${summary.totalKm} km`,
      ].join("\n"),
    });
  }

  try {
    const historyText = historyToText(history);
    const nowLine = now
      ? `Local time: ${now.dayLabel} at ${now.timeHHMM} (iso: ${now.iso})`
      : "Local time not provided";

    const systemText = `
You are Mason’s hybrid coach (running + strength + Hyrox).
Speak like a real UK coach: short, specific, practical.

You MUST:
- Use the plan summary & full JSON provided.
- Use the chat history so it feels like a flowing conversation.
- Use time info for "today / tomorrow / this week" correctly.
- Answer in 3–6 tight bullet points OR 2–4 short paragraphs max.

When you SUGGEST CHANGING THE PLAN (moving sessions, changing intensity, adding/removing runs):
- Clearly describe what should change.
- At the END of your answer, add this line exactly (only once):

Reply: YES UPDATE to apply these changes to your saved plan, or NO KEEP to leave it as it is.

Only include that confirmation line when you are actually proposing a change to the plan.
Never say that you can't see their plan – you ALWAYS have the JSON summary.
`.trim();

    const userText = `
PLAN SUMMARY (JSON):
${JSON.stringify(summary, null, 2)}

FULL PLAN (JSON, for reference):
${JSON.stringify(plan, null, 2)}

CHAT HISTORY (last few turns):
${historyText}

TIME INFO:
${nowLine}

USER MESSAGE:
"${message}"

Reply as the coach. Keep it tight, specific and practical.
`.trim();

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemText }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      ],
      max_output_tokens: 240,
    });

    const replyText =
      resp.output_text || resp.output?.[0]?.content?.[0]?.text || "";

    if (!replyText.trim()) {
      return res.json({
        reply:
          "I saw your plan but the reply came out empty. Ask again with something concrete like “How would you pace today’s session?”",
      });
    }

    return res.json({ reply: replyText.trim() });
  } catch (err) {
    console.error("[train-chat] error:", err);

    return res.json({
      reply: [
        `The coach hit a tech issue replying just now.`,
        ``,
        `From your current plan I can see:`,
        `• Weeks: ${summary.weeksCount}`,
        `• Sessions: ${summary.sessionsCount} (~${avgPerWeek} per week)`,
        `• Volume: ~${summary.totalMinutes} minutes / ${summary.totalKm} km`,
        ``,
        `Use that as your anchor. Keep your key quality work, let the rest be genuinely easy, and don’t be afraid to drop one light session if you feel run down.`,
      ].join("\n"),
    });
  }
});

export default router;
