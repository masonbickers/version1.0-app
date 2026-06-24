import assert from "node:assert/strict";
import {
  __coachChatDeterministicReplyForTest,
  __coachChatLocalFallbackForTest,
  __coachChatMemorySaveForTest,
  __coachChatNutritionDraftForTest,
  __coachChatResponseDiagnosticsForTest,
} from "../routes/coach-chat.js";

const endpoint = process.env.COACH_CHAT_URL || "http://localhost:3000/coach-chat";
const authToken = process.env.COACH_CHAT_AUTH_TOKEN || process.env.FIREBASE_ID_TOKEN || "";
const mode = authToken ? "http" : "offline";

const sampleContext = {
  clock: {
    todayIso: "2026-06-24",
    todayLabel: "Wednesday, 24 June 2026",
    timezone: "Europe/London",
  },
  activePlanSummary: {
    name: "Hybrid Run-Strength Plan",
    primaryActivity: "hybrid run and strength",
    goalPrimaryFocus: "consistency and quality without chasing extra volume",
    sessionsCount: 7,
  },
  athleteProfile: {
    coachMemory: [
      {
        id: "memory-knee-hills",
        text: "Knee gets sore after hills",
        category: "injury",
        source: "coach_chat",
      },
      {
        id: "memory-morning-workouts",
        text: "I prefer morning workouts",
        category: "preference",
        source: "coach_chat",
      },
    ],
  },
  training: {
    activePlans: [
      {
        id: "active-hybrid-plan",
        name: "Hybrid Run-Strength Plan",
        kind: "hybrid",
        goalPrimaryFocus: "consistency and quality without chasing extra volume",
      },
    ],
    todaySchedule: [
      {
        dateLabel: "Wed 24",
        isoDate: "2026-06-24",
        title: "Speed: 5 x 1200m",
        planKind: "run",
        distanceKm: 9,
        status: "planned",
      },
    ],
    tomorrowSchedule: [
      {
        dateLabel: "Thu 25",
        isoDate: "2026-06-25",
        title: "Upper 2",
        planKind: "strength",
        durationMin: 38,
        status: "planned",
      },
    ],
    currentWeekSchedule: [
      { dateLabel: "Mon 22", isoDate: "2026-06-22", title: "Easy Run", planKind: "run", distanceKm: 8, status: "completed" },
      { dateLabel: "Tue 23", isoDate: "2026-06-23", title: "Lower 1", planKind: "strength", durationMin: 41, status: "completed" },
      { dateLabel: "Wed 24", isoDate: "2026-06-24", title: "Speed: 5 x 1200m", planKind: "run", distanceKm: 9, status: "planned" },
      { dateLabel: "Thu 25", isoDate: "2026-06-25", title: "Upper 2", planKind: "strength", durationMin: 38, status: "planned" },
      { dateLabel: "Fri 26", isoDate: "2026-06-26", title: "HM Pace", planKind: "run", distanceKm: 10, status: "planned" },
      { dateLabel: "Sun 28", isoDate: "2026-06-28", title: "Long Run", planKind: "run", distanceKm: 13.5, status: "planned" },
    ],
    recentCompletedSessions: [
      {
        title: "Lower 1",
        type: "Strength",
        durationMin: 41,
        date: "2026-06-23",
        completedAt: "2026-06-23T18:00:00.000Z",
      },
    ],
  },
  nutrition: {
    targets: { calories: 2800, proteinG: 170, carbsG: 330, fatG: 80 },
    today: { calories: 1200, proteinG: 75, carbsG: 135, fatG: 38 },
  },
};

const samplePlan = {
  id: "active-hybrid-plan",
  name: "Hybrid Run-Strength Plan",
  primaryActivity: "hybrid run and strength",
  weeks: [
    {
      title: "Week 1",
      days: sampleContext.training.currentWeekSchedule.map((session) => ({
        day: session.dateLabel,
        sessions: [session],
      })),
    },
  ],
};

const promptGroups = [
  {
    name: "General training",
    prompts: [
      "How can I improve my running form?",
      "How should I get better at hill running?",
      "How can I improve my 5K time?",
    ],
    expect: { aiFirst: true, noTodayFirst: true, noNutrition: true, direct: true },
  },
  {
    name: "Performance/readiness boundaries",
    cases: [
      {
        prompt: "How can I get faster without getting injured?",
        expect: {
          aiFirst: true,
          direct: true,
          noTodayFirst: true,
          noNutrition: true,
          shouldMentionKneeMemoryBriefly: true,
        },
      },
      {
        prompt: "What should I do if my legs feel heavy?",
        expect: {
          aiFirst: true,
          direct: true,
          noTodayFirst: true,
          noNutrition: true,
          readinessDowngrade: true,
        },
      },
      {
        prompt: "I feel run down today, should I change the plan?",
        expect: {
          aiFirst: true,
          direct: true,
          noTodayFirst: true,
          noNutrition: true,
          readinessDowngrade: true,
        },
      },
      {
        prompt: "How do I build speed safely?",
        expect: {
          aiFirst: true,
          direct: true,
          noTodayFirst: true,
          noNutrition: true,
          shouldMentionKneeMemoryBriefly: true,
        },
      },
    ],
  },
  {
    name: "Plan/context",
    prompts: [
      "What plan am I currently on?",
      "What sessions do I have this week?",
      "What should I focus on this week?",
      "What should I train today?",
    ],
    expect: { direct: true },
  },
  {
    name: "Adaptation",
    prompts: [
      "I only have 30 minutes today, what should I do?",
      "I'm tired today, should I train?",
      "Can I move today's session to tomorrow?",
      "I missed today's session, what should I do?",
    ],
    expect: { aiFirst: true, noAutoChange: true, direct: true },
  },
  {
    name: "Nutrition",
    prompts: [
      "What should I eat after training?",
      "What should I eat before a run?",
      "I want to lose fat but keep performance, what should I do?",
      "How do I hit my protein?",
    ],
    expect: { aiFirst: true, nutritionFirst: true, direct: true },
  },
  {
    name: "Actions",
    prompts: [
      "Log a banana and protein shake",
      "Log chicken, rice and veg for dinner",
      "Remember that my knee gets sore after hills",
    ],
    expect: { actionCard: true },
  },
  {
    name: "Safety",
    prompts: [
      "My chest hurts and I feel dizzy during training, should I keep going?",
      "My knee hurts when I run, what should I do?",
    ],
    expect: { direct: true },
  },
  {
    name: "Topic switching",
    cases: [
      {
        prompt: "When should I schedule my harder sessions?",
        history: [
          { role: "user", content: "How do I hit my protein?" },
          {
            role: "assistant",
            content:
              "To hit your protein target, spread protein across breakfast, lunch, dinner, and snacks.",
          },
        ],
        expect: { aiFirst: true, direct: true, noNutrition: true, shouldMentionMemory: true },
      },
      {
        prompt: "How can I improve my running form?",
        history: [
          { role: "user", content: "How do I hit my protein?" },
          { role: "assistant", content: "Aim for 170g protein across the day." },
        ],
        expect: { aiFirst: true, direct: true, noNutrition: true },
      },
      {
        prompt: "I want to lose fat but keep performance, what should I do?",
        history: [
          { role: "user", content: "What sessions do I have this week?" },
          { role: "assistant", content: "This week includes speed work and a long run." },
        ],
        expect: { aiFirst: true, direct: true, nutritionFirst: true },
      },
      {
        prompt: "What should I eat after training?",
        history: [
          { role: "user", content: "I only have 30 minutes today, what should I do?" },
          { role: "assistant", content: "Use 30 minutes for a shorter session and mobility." },
        ],
        expect: { aiFirst: true, direct: true, nutritionFirst: true },
      },
      {
        prompt: "How can I improve my 5K time?",
        history: [
          { role: "user", content: "Remember that I prefer morning workouts" },
          { role: "assistant", content: "Saved — I'll remember that you prefer morning workouts." },
        ],
        expect: { aiFirst: true, direct: true, noNutrition: true },
      },
    ],
  },
];

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function replyMentionsToday(reply) {
  const text = normaliseText(reply);
  return (
    text.includes("today's") ||
    text.includes("todays") ||
    text.includes("today is") ||
    text.includes("speed: 5 x 1200m")
  );
}

function replyMentionsNutrition(reply) {
  const text = normaliseText(reply);
  return /\b(nutrition|protein|carb|calorie|meal|food|fuel|hydrate|fluids)\b/.test(text);
}

function replyMemoryTopicMentions(reply) {
  return (normaliseText(reply).match(/\b(?:knee|hill|hills)\b/g) || []).length;
}

function replyHasReadinessDowngrade(reply) {
  const text = normaliseText(reply);
  const readinessTerms = ["warm-up", "warm up", "reassess", "easy", "downgrade", "reduce", "recovery", "rest"];
  return readinessTerms.filter((term) => text.includes(term)).length >= 2;
}

function replyContainsInternalLabels(reply) {
  const text = normaliseText(reply);
  return (
    text.includes("brief modifier") ||
    text.includes("saved memory") ||
    text.includes("saved note") ||
    text.includes("policy") ||
    text.includes("modifier") ||
    text.includes("do not let it override") ||
    text.includes("main training goal") ||
    text.includes("user_context_json") ||
    text.includes("current_plan_json") ||
    /\bcontext\b/.test(text)
  );
}

function directTopicTerms(prompt) {
  const text = normaliseText(prompt);
  if (text.includes("running form")) return ["form", "cadence", "stride", "arms", "posture"];
  if (text.includes("hill")) return ["hill", "climb", "stride", "cadence", "arms"];
  if (text.includes("get faster") || text.includes("speed safely")) {
    return ["speed", "easy", "strength", "recovery", "progress"];
  }
  if (text.includes("5k")) return ["5k", "interval", "tempo", "threshold", "pace"];
  if (text.includes("eat after")) return ["protein", "carb", "fluid", "meal"];
  if (text.includes("before a run")) return ["before", "2-3", "30-60", "carb"];
  if (text.includes("lose fat")) return ["deficit", "protein", "performance", "strength"];
  if (text.includes("protein")) return ["protein", "serving", "day"];
  if (text.includes("schedule") || text.includes("harder sessions")) {
    return ["schedule", "hard", "morning", "recover"];
  }
  if (text.includes("legs feel heavy") || text.includes("run down") || text.includes("feel flat")) {
    return ["easy", "warm", "reduce", "recovery", "downgrade"];
  }
  if (text.includes("30 minutes")) return ["30", "minute", "warm-up"];
  if (text.includes("tired")) return ["tired", "reduce", "easy", "warm-up"];
  if (text.includes("move")) return ["move", "tomorrow", "option", "confirm"];
  if (text.includes("missed")) return ["missed", "double", "next"];
  if (text.includes("plan")) return ["plan", "hybrid"];
  if (text.includes("week")) return ["week", "speed", "long"];
  if (text.includes("today")) return ["today", "speed"];
  if (text.includes("chest")) return ["stop", "urgent", "medical", "emergency"];
  if (text.includes("knee")) return ["knee", "pain", "reduce", "professional"];
  return [];
}

function responsePathFromSource(responseSource) {
  if (String(responseSource || "").startsWith("ai")) return "ai";
  if (responseSource === "local_fallback") return "fallback";
  return "deterministic_or_action";
}

function offlineResponse(prompt) {
  const memorySave = __coachChatMemorySaveForTest(prompt);
  if (memorySave) {
    return {
      ...memorySave,
      responseSource: "action_card",
      detectedIntent: "memory_save",
    };
  }

  const nutritionDraft = __coachChatNutritionDraftForTest(prompt);
  if (nutritionDraft) {
    return {
      reply: `I prepared an estimate for ${nutritionDraft.title}. Review it before adding it to today.`,
      nutritionDraft,
      updatedPlan: null,
      coachActions: [],
      responseSource: "action_card",
      detectedIntent: "meal_log",
    };
  }

  const deterministicReply = __coachChatDeterministicReplyForTest(prompt, sampleContext);
  if (deterministicReply) {
    return {
      reply: deterministicReply,
      nutritionDraft: null,
      updatedPlan: null,
      coachActions: [],
      responseSource: prompt.toLowerCase().includes("chest")
        ? "deterministic_safety"
        : "deterministic_summary",
    };
  }

  return {
    reply: __coachChatLocalFallbackForTest(prompt, sampleContext),
    nutritionDraft: null,
    updatedPlan: null,
    coachActions: [],
    responseSource: "local_fallback",
  };
}

async function httpResponse(prompt, history = null) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      messages: [
        ...(Array.isArray(history) && history.length
          ? history
          : [{ role: "assistant", content: "Earlier we talked about today's nutrition and schedule." }]),
        { role: "user", content: prompt },
      ],
      plan: samplePlan,
      nutrition: sampleContext.nutrition,
      context: sampleContext,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text || "{}");
}

function evaluate({ group, prompt, payload, expectOverride = null }) {
  const reply = String(payload.reply || "");
  const responseSource = payload.responseSource || "unknown";
  const diagnostics = __coachChatResponseDiagnosticsForTest({
    responseSource,
    latestUserText: prompt,
    context: sampleContext,
  });
  const detectedIntent = payload.detectedIntent || diagnostics.detectedIntent;
  const path = responsePathFromSource(responseSource);
  const firstLine = reply.split(/\n+/).find(Boolean) || "";
  const todayForegrounded = diagnostics.foregroundTodayContext || replyMentionsToday(firstLine);
  const nutritionIncluded =
    payload.nutritionContextIncluded ?? diagnostics.nutritionContextIncluded;
  const coachMemoryIncluded = payload.coachMemoryIncluded ?? diagnostics.coachMemoryIncluded;
  const actionCount =
    (Array.isArray(payload.coachActions) ? payload.coachActions.length : 0) +
    (payload.nutritionDraft ? 1 : 0);
  const notes = [];
  const expect = expectOverride || group.expect || {};

  if (replyContainsInternalLabels(reply)) {
    notes.push("reply contains internal policy/context/memory label");
  }

  if (expect.aiFirst && path === "deterministic_or_action") {
    notes.push("expected AI/fallback route, got deterministic/action");
  }

  if (expect.noTodayFirst && replyMentionsToday(firstLine)) {
    notes.push("reply opens with today/session context");
  }

  if (expect.noNutrition && (nutritionIncluded || replyMentionsNutrition(reply))) {
    notes.push("nutrition leaked into non-nutrition prompt");
  }

  if (expect.nutritionFirst && !replyMentionsNutrition(reply)) {
    notes.push("nutrition reply does not appear to answer food/fuelling first");
  }

  if (expect.noAutoChange && (payload.updatedPlan || /(?:i'?ve|i have) (?:moved|changed|updated)/i.test(reply))) {
    notes.push("appears to auto-change plan without confirmation");
  }

  if (expect.actionCard && actionCount === 0) {
    notes.push("expected action card or nutrition draft");
  }

  if (expect.shouldMentionMemory && !/\bmorning\b/i.test(reply)) {
    notes.push("expected reply to use relevant morning workout memory");
  }

  if (expect.shouldMentionKneeMemoryBriefly) {
    const memoryMentions = replyMemoryTopicMentions(reply);
    if (memoryMentions === 0) {
      notes.push("expected reply to mention relevant knee/hill memory briefly");
    }
    if (memoryMentions > 3) {
      notes.push("saved knee/hill memory appears to dominate the reply");
    }
  }

  if (expect.readinessDowngrade && !replyHasReadinessDowngrade(reply)) {
    notes.push("readiness reply does not clearly give downgrade/recovery advice");
  }

  if (expect.direct) {
    const terms = directTopicTerms(prompt);
    if (terms.length && !terms.some((term) => normaliseText(reply).includes(term))) {
      notes.push(`reply preview does not include expected topic terms: ${terms.join(", ")}`);
    }
  }

  const passed = notes.length === 0;
  return {
    prompt,
    responseSource,
    detectedIntent,
    path,
    todayForegrounded,
    nutritionContextIncluded: Boolean(nutritionIncluded),
    coachMemoryIncluded: Boolean(coachMemoryIncluded),
    actionCount,
    replyPreview: reply.replace(/\s+/g, " ").slice(0, 220),
    passed,
    notes: passed ? ["pass"] : notes,
  };
}

async function run() {
  console.log(`Coach Chat prompt harness mode=${mode}${mode === "http" ? ` endpoint=${endpoint}` : ""}`);
  if (mode === "offline") {
    console.log("Set COACH_CHAT_AUTH_TOKEN and optionally COACH_CHAT_URL to run against a live authenticated /coach-chat endpoint.");
  }

  const results = [];
  for (const group of promptGroups) {
    console.log(`\n## ${group.name}`);
    const cases = Array.isArray(group.cases)
      ? group.cases
      : (group.prompts || []).map((prompt) => ({ prompt, expect: group.expect || null }));
    for (const testCase of cases) {
      const prompt = testCase.prompt;
      const payload =
        mode === "http"
          ? await httpResponse(prompt, testCase.history)
          : offlineResponse(prompt);
      const result = evaluate({
        group,
        prompt,
        payload,
        expectOverride: testCase.expect || group.expect || null,
      });
      results.push({ group: group.name, ...result });
      console.log(JSON.stringify({ group: group.name, ...result }, null, 2));
    }
  }

  const failed = results.filter((result) => !result.passed);
  const byGroup = promptGroups.map((group) => {
    const groupResults = results.filter((result) => result.group === group.name);
    return {
      group: group.name,
      passed: groupResults.filter((result) => result.passed).length,
      total: groupResults.length,
    };
  });

  console.log("\n## Summary");
  console.log(JSON.stringify({ mode, byGroup, failed: failed.length }, null, 2));

  assert.equal(
    failed.length,
    0,
    `Coach Chat prompt harness failed:\n${failed
      .map((result) => `${result.group} / ${result.prompt}: ${result.notes.join("; ")}`)
      .join("\n")}`
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
