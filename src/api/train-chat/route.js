// app/api/train-chat/route.js
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req) {
  try {
    const body = await req.json();
    const { plan, messages } = body || {};

    const convo = Array.isArray(messages) ? messages : [];
    const lastUser = convo.filter((m) => m.role === "user").slice(-1)[0];

    if (!lastUser?.content) {
      return Response.json(
        { error: "No user message provided" },
        { status: 400 }
      );
    }

    // If no AI key, return fallback message
    if (!openai) {
      return Response.json({
        reply: `AI is offline, but your plan "${
          plan?.name || "Training Plan"
        }" looks good. Keep your easy runs very easy and nail your key sessions.`,
      });
    }

    const systemPrompt = `
You are a friendly British endurance coach.
The user is currently following this training plan:

${JSON.stringify(plan).slice(0, 5000)}

Rules:
- Be concise, helpful, and conversational.
- Reference specific sessions when helpful.
- Avoid rewriting the full plan.
`.trim();

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: lastUser.content }],
        },
      ],
    });

    const replyText =
      response.output_text ||
      response.output?.[0]?.content?.[0]?.text ||
      "Sorry, I couldn't generate a response.";

    return Response.json({ reply: replyText });
  } catch (err) {
    console.error("[train-chat] API error:", err);
    return Response.json(
      { error: "Failed to chat about training plan" },
      { status: 500 }
    );
  }
}
