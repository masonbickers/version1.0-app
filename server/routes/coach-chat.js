// server/routes/coach-chat.js
import express from "express";

function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function extractWeeks(plan) {
  const candidates = [
    plan?.weeks,
    plan?.plan?.weeks,
    plan?.planData?.weeks,
    plan?.generatedPlan?.weeks,
    plan?.activePlan?.weeks,
    plan?.output?.weeks,
    plan?.result?.weeks,
    plan?.template?.weeks,
    plan?.program?.weeks,
    plan?.schedule?.weeks,
    plan?.payload?.weeks,
  ];

  for (const candidate of candidates) {
    const weeks = normaliseList(candidate);
    if (weeks.length) return weeks;
  }

  return [];
}

function summarisePlan(plan) {
  if (!plan) return null;

  const weeks = extractWeeks(plan);
  let sessionsCount = 0;
  let totalMinutes = 0;
  let totalKm = 0;
  const preview = [];

  weeks.forEach((week, weekIndex) => {
    const weekLabel =
      week?.title ||
      (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);
    const days = normaliseList(week?.days);

    if (days.length) {
      days.forEach((day, dayIndex) => {
        const dayLabel = day?.day || day?.label || day?.name || `Day ${dayIndex + 1}`;
        const sessions = normaliseList(day?.sessions);

        sessions.forEach((session) => {
          sessionsCount += 1;
          const durationMin = Number(session?.targetDurationMin ?? session?.durationMin ?? 0) || 0;
          const distanceKm = Number(session?.targetDistanceKm ?? session?.distanceKm ?? 0) || 0;
          totalMinutes += durationMin;
          totalKm += distanceKm;

          if (preview.length < 8) {
            preview.push({
              week: weekLabel,
              day: dayLabel,
              title:
                session?.title ||
                session?.name ||
                session?.type ||
                session?.sessionType ||
                "Session",
              durationMin: durationMin || null,
              distanceKm: distanceKm || null,
            });
          }
        });
      });
      return;
    }

    const sessions = [
      ...normaliseList(week?.sessions),
      ...normaliseList(week?.workouts),
    ];

    sessions.forEach((session) => {
      sessionsCount += 1;
      const durationMin = Number(session?.targetDurationMin ?? session?.durationMin ?? 0) || 0;
      const distanceKm = Number(session?.targetDistanceKm ?? session?.distanceKm ?? 0) || 0;
      totalMinutes += durationMin;
      totalKm += distanceKm;

      if (preview.length < 8) {
        preview.push({
          week: weekLabel,
          day: weekLabel,
          title:
            session?.title ||
            session?.name ||
            session?.type ||
            session?.sessionType ||
            "Session",
          durationMin: durationMin || null,
          distanceKm: distanceKm || null,
        });
      }
    });
  });

  return {
    name: plan?.name || plan?.title || null,
    primaryActivity: plan?.primaryActivity || plan?.meta?.primaryActivity || null,
    goalPrimaryFocus: plan?.goalPrimaryFocus || plan?.meta?.goalPrimaryFocus || null,
    targetEventName: plan?.targetEventName || plan?.meta?.targetEventName || null,
    targetEventDate: plan?.targetEventDate || plan?.meta?.targetEventDate || null,
    weeksCount: weeks.length,
    sessionsCount,
    totalMinutes: Math.round(totalMinutes),
    totalKm: Number(totalKm.toFixed(1)),
    preview,
  };
}

const WEEKDAY_INDEX = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

function latestUserMessage(messages) {
  for (let i = (Array.isArray(messages) ? messages.length : 0) - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item?.role === "user" && typeof item?.content === "string" && item.content.trim()) {
      return item.content.trim();
    }
  }
  return "";
}

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatSessionDetail(session, { includeDate = false } = {}) {
  if (!session) return null;

  const title = String(session?.title || session?.name || "Session").trim();
  const bits = [];
  if (includeDate && session?.dateLabel) bits.push(session.dateLabel);
  bits.push(title);
  if (session?.distanceKm != null) bits.push(`${session.distanceKm} km`);
  else if (session?.durationMin != null) bits.push(`${session.durationMin} min`);
  return bits.filter(Boolean).join(" · ");
}

function formatSessionCoachLine(session, { includeDate = false } = {}) {
  if (!session) return null;

  const title = String(session?.title || session?.name || "Session").trim();
  const bits = [];
  if (includeDate && session?.dateLabel) bits.push(session.dateLabel);
  bits.push(title);
  if (session?.distanceKm != null) bits.push(`${session.distanceKm} km`);
  else if (session?.durationMin != null) bits.push(`${session.durationMin} min`);

  const effort = String(session?.notes || session?.description || "").trim();
  const main = bits.filter(Boolean).join(" - ");
  return effort ? `${main}. ${effort}` : main;
}

function buildLiveContextFacts(context) {
  const lines = [];
  const clock = context?.clock || null;
  const training = context?.training || {};
  const activePlans = Array.isArray(training?.activePlans)
    ? training.activePlans.filter(Boolean)
    : [];
  const todaySchedule = Array.isArray(training?.todaySchedule)
    ? training.todaySchedule.filter(Boolean)
    : [];
  const currentWeekSchedule = Array.isArray(training?.currentWeekSchedule)
    ? training.currentWeekSchedule.filter(Boolean)
    : [];

  if (clock?.todayLabel || clock?.localTime || clock?.timezone) {
    lines.push(
      [
        "Local now:",
        clock?.todayLabel || null,
        clock?.localTime ? `at ${clock.localTime}` : null,
        clock?.timezone ? `(${clock.timezone})` : null,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  if (activePlans.length) {
    lines.push(
      `Active plans: ${activePlans
        .map((plan) =>
          [plan?.name || "Plan", plan?.kind ? `(${plan.kind})` : null]
            .filter(Boolean)
            .join(" ")
        )
        .join(" | ")}`
    );
  }

  if (todaySchedule.length) {
    lines.push(`Today's sessions: ${todaySchedule.map((item) => formatSessionDetail(item)).join(" | ")}`);
  } else if (clock?.todayLabel) {
    lines.push("Today's sessions: none scheduled in the loaded plan.");
  }

  if (currentWeekSchedule.length) {
    lines.push(
      `This week: ${currentWeekSchedule
        .slice(0, 10)
        .map((item) => formatSessionDetail(item, { includeDate: true }))
        .join(" | ")}`
    );
  }

  return lines.filter(Boolean).join("\n");
}

function tryDeterministicCoachReply(message, context) {
  const text = normaliseText(message);
  if (!text) return null;

  const clock = context?.clock || null;
  const training = context?.training || {};
  const activePlans = Array.isArray(training?.activePlans)
    ? training.activePlans.filter(Boolean)
    : [];
  const todaySchedule = Array.isArray(training?.todaySchedule)
    ? training.todaySchedule.filter(Boolean)
    : [];
  const currentWeekSchedule = Array.isArray(training?.currentWeekSchedule)
    ? training.currentWeekSchedule.filter(Boolean)
    : [];

  const asksDay =
    text.includes("what day is it") ||
    text.includes("what day is today") ||
    text.includes("what's the day");
  const asksDate =
    text.includes("what date is it") ||
    text.includes("what's the date") ||
    text.includes("what is the date");
  const asksTime =
    text.includes("what time is it") ||
    text.includes("what's the time") ||
    text.includes("what is the time now");

  if ((asksDay || asksDate || asksTime) && clock) {
    const lines = [];
    if (clock?.todayLabel) lines.push(`It is ${clock.todayLabel}.`);
    if (asksTime && clock?.localTime) lines.push(`Local time is ${clock.localTime}.`);
    if (clock?.timezone) lines.push(`Timezone: ${clock.timezone}.`);
    return lines.filter(Boolean).join("\n");
  }

  const asksTodayPlan =
    (text.includes("today") &&
      (text.includes("session") ||
        text.includes("workout") ||
        text.includes("training") ||
        text.includes("plan") ||
        text.includes("have"))) ||
    text.includes("what do i have today") ||
    text.includes("what's on today");

  if (asksTodayPlan && clock) {
    if (!todaySchedule.length) {
      return [
        `Today is ${clock.todayLabel}.`,
        "",
        "I do not have a scheduled session for you today in the loaded plan.",
        "",
        "Use it as a recovery day, or log anything you do separately.",
      ].join("\n");
    }

    if (todaySchedule.length === 1) {
      const session = todaySchedule[0];
      const line = formatSessionCoachLine(session);
      return [
        `Today is ${clock.todayLabel}.`,
        "",
        `You have ${line}.`,
        "",
        "Keep it controlled and follow the plan target rather than adding extra volume.",
      ].join("\n");
    }

    return [
      `Today is ${clock.todayLabel}.`,
      "",
      "You have these sessions today:",
      ...todaySchedule.map((item) => `- ${formatSessionCoachLine(item)}`),
      "",
      "Prioritise the key session, and keep the rest easy unless the plan says otherwise.",
    ].join("\n");
  }

  const asksThisWeek =
    text.includes("this week") &&
    (text.includes("session") ||
      text.includes("workout") ||
      text.includes("training") ||
      text.includes("plan") ||
      text.includes("have"));

  if (asksThisWeek && clock) {
    if (!currentWeekSchedule.length) {
      return [
        `This week starts from ${clock.todayLabel}.`,
        "",
        "I do not have any scheduled sessions loaded for this week.",
      ].join("\n");
    }

    return [
      "Here is your week at a glance:",
      ...currentWeekSchedule.map(
        (item) => `- ${formatSessionCoachLine(item, { includeDate: true })}`
      ),
      "",
      "The main job is to hit the planned work without chasing extra volume.",
    ].join("\n");
  }

  const weekdayMatch = Object.keys(WEEKDAY_INDEX).find((day) => text.includes(day));
  const asksSpecificDay =
    !!weekdayMatch &&
    (text.includes("what do i have") ||
      text.includes("what session") ||
      text.includes("what workout") ||
      text.includes("what training") ||
      text.includes("on "));

  if (asksSpecificDay) {
    const dayIndex = WEEKDAY_INDEX[weekdayMatch];
    const daySessions = currentWeekSchedule.filter(
      (item) => Number(item?.dayIndex) === dayIndex
    );

    if (!daySessions.length) {
      return [
        `I do not have a scheduled session for ${weekdayMatch[0].toUpperCase()}${weekdayMatch.slice(1)} in the loaded current week.`,
        "",
        "Treat it as recovery unless you manually add or move a session.",
      ].join("\n");
    }

    return [
      `On ${weekdayMatch[0].toUpperCase()}${weekdayMatch.slice(1)}, you have:`,
      ...daySessions.map((item) => `- ${formatSessionCoachLine(item, { includeDate: true })}`),
      "",
      "Stick to the target unless your recovery says otherwise.",
    ].join("\n");
  }

  const asksActivePlan =
    text.includes("what plan am i on") ||
    text.includes("which plan am i on") ||
    text.includes("what training plan am i on") ||
    text.includes("what is my current plan") ||
    text.includes("what's my current plan");

  if (asksActivePlan) {
    if (!activePlans.length) {
      return "I do not have an active plan loaded right now.";
    }

    return [
      "You are currently on" + (activePlans.length > 1 ? " these plans:" : " this plan:"),
      ...activePlans.map((plan) => {
        const bits = [plan?.name || "Plan"];
        if (plan?.kind) bits.push(plan.kind);
        if (plan?.targetEventDate) bits.push(`target ${plan.targetEventDate}`);
        return `- ${bits.join(" · ")}`;
      }),
      "",
      "I will use this as the baseline for training advice.",
    ].join("\n");
  }

  return null;
}

function safeStringify(value, maxChars = 16000) {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length <= maxChars) return json;
    return `${json.slice(0, maxChars)}\n... [truncated]`;
  } catch {
    return "";
  }
}

function extractJsonObject(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * Coach chat route for Train-R.
 *
 * Request body:
 * {
 *   messages: [{ role: "user" | "assistant", content: string }],
 *   plan?: object | null,
 *   nutrition?: object | null,
 *   context?: object | null
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

      const { messages, plan, nutrition, context } = req.body || {};

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Request body must include a non-empty 'messages' array.",
        });
      }

      const trimmedMessages = messages
        .filter(
          (m) =>
            (m?.role === "user" || m?.role === "assistant") &&
            typeof m?.content === "string" &&
            m.content.trim()
        )
        .slice(-30)
        .map((m) => ({
          role: m.role,
          content: String(m.content).trim(),
        }));

      const planSummary = summarisePlan(plan);
      const mergedContext = {
        ...(context && typeof context === "object" ? context : {}),
        ...(nutrition ? { nutrition } : {}),
        ...(planSummary ? { activePlanSummary: planSummary } : {}),
      };
      const latestUserText = latestUserMessage(trimmedMessages);
      const deterministicReply = tryDeterministicCoachReply(
        latestUserText,
        mergedContext
      );

      if (deterministicReply) {
        return res.json({
          reply: deterministicReply,
          updatedPlan: null,
          raw: JSON.stringify({ reply: deterministicReply, updatedPlan: null }),
        });
      }

      const systemPrompt = `
You are Train-R's AI coach.

Behave more like ChatGPT than a generic app bot:
- natural, direct, helpful, and context-aware
- answer the user's question first
- keep replies concise by default
- write for mobile reading, not desktop reading
- sound like a coach in conversation, not a notification or template

STYLE RULES:
- Do not answer in one dense paragraph unless the user explicitly asks for that format.
- Use short sentences.
- Break ideas onto separate lines.
- Prefer bullets for advice, recommendations, tradeoffs, and summaries.
- Prefer numbered steps when explaining what to do next.
- Keep each bullet to one idea where possible.
- Start with a short direct answer, then break the rest down.
- Leave a blank line between short sections when it improves readability.
- Avoid fluff, filler, and repeated phrasing.
- Avoid generic sign-offs like "Enjoy your run", "You've got this", or "Let me know if..."
- Do not repeat the user's exact wording unless needed for clarity.
- Avoid markdown tables.
- If the question is simple, answer in 1 to 4 short lines.
- If the answer is longer, use this default shape:
  1. one short answer sentence
  2. 3 to 6 short bullets
  3. one short next-step line if useful

You know the user's live context:
- training plan
- exact current schedule when provided
- current local date/time when provided
- recent training sessions
- nutrition targets and intake
- body metrics and weight trend
- profile notes / injuries / constraints when provided

Grounding rules:
- Treat USER_CONTEXT_JSON and CURRENT_PLAN_JSON as the source of truth.
- If USER_CONTEXT_JSON.clock is present, treat it as the source of truth for the user's current local day, date, time, and timezone.
- If USER_CONTEXT_JSON.training.exactSchedule or USER_CONTEXT_JSON.training.activePlans is present, treat that as the user's exact current plan and current session layout, including moved sessions and recent plan edits.
- Prefer exactSchedule/currentWeekSchedule/todaySchedule over older conversational memory.
- When talking about days, use the provided isoDate/dateLabel if available, not just the weekday name.
- If the user asks what day/date/time it is today or now, answer directly from USER_CONTEXT_JSON.clock and do not invent or infer another calendar date.
- If a data point is missing, say you do not have it.
- Do not invent meals, sessions, injuries, or targets.
- If the user asks about nutrition, use their real targets/intake where available.
- If the user asks about training or recovery, use their recent sessions and current plan where available.
- If the user asks for changes to their plan, you may update it conservatively.

Plan update rules:
- Only return a non-null updatedPlan when the user is explicitly asking to change, move, reduce, increase, or adapt their plan.
- Keep the same overall plan structure.
- Respect progression and avoid reckless jumps in volume or intensity.
- If you are not changing the plan, updatedPlan must be null.

Safety:
- Be conservative with injury advice.
- Encourage professional help for severe, persistent, or escalating pain.

RESPONSE FORMAT:
Return VALID JSON ONLY with this exact shape:
{
  "reply": "chat reply text",
  "updatedPlan": null
}

If you are changing the plan:
{
  "reply": "chat reply text",
  "updatedPlan": { ...full updated plan object... }
}
      `.trim();

      const contextMessage = {
        role: "system",
        content:
          "USER_CONTEXT_JSON:\n" + safeStringify(mergedContext, 14000),
      };

      const liveContextFacts = buildLiveContextFacts(mergedContext);
      const factsMessage = liveContextFacts
        ? {
            role: "system",
            content: "LIVE_CONTEXT_FACTS:\n" + liveContextFacts,
          }
        : null;

      const planMessage = plan
        ? {
            role: "system",
            content:
              "CURRENT_PLAN_JSON:\n" + safeStringify(plan, 18000),
          }
        : {
            role: "system",
            content:
              "CURRENT_PLAN_JSON:\nnull",
          };

      const chatMessages = [
        { role: "system", content: systemPrompt },
        contextMessage,
        ...(factsMessage ? [factsMessage] : []),
        planMessage,
        ...trimmedMessages,
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: chatMessages,
        temperature: 0.35,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices?.[0]?.message?.content?.trim() || "";
      const parsed = extractJsonObject(raw);

      const reply =
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : raw || "Got it. Ask me another question.";

      const updatedPlan =
        parsed && Object.prototype.hasOwnProperty.call(parsed, "updatedPlan")
          ? parsed.updatedPlan
          : null;

      return res.json({
        reply,
        updatedPlan: updatedPlan && typeof updatedPlan === "object" ? updatedPlan : null,
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
