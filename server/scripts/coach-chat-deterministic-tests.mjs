import assert from "node:assert/strict";
import {
  __coachChatDeterministicReplyForTest,
  __coachChatLocalFallbackForTest,
  __coachChatLatestPriorityForTest,
} from "../routes/coach-chat.js";

const completedPushContext = {
  clock: {
    todayIso: "2026-06-22",
    todayLabel: "Monday, 22 June 2026",
  },
  training: {
    todaySchedule: [
      {
        planId: "strength-plan",
        sessionKey: "strength-plan_0_0_0",
        weekIndex: 0,
        dayIndex: 0,
        sessionIndex: 0,
        title: "Push",
        planKind: "strength",
        sessionType: "Strength",
        durationMin: 61,
        distanceKm: 0,
        status: "completed",
        completedAt: "2026-06-22T10:00:00.000Z",
        notes: "Strong upper-body session. Keep reps controlled and avoid pushing to failure..",
      },
    ],
    recentCompletedSessions: [
      {
        planId: "strength-plan",
        sessionKey: "strength-plan_0_0_0",
        weekIndex: 0,
        dayIndex: 0,
        sessionIndex: 0,
        title: "Push",
        type: "Weight training",
        durationMin: 61,
        date: "2026-06-22",
        completedAt: "2026-06-22T10:00:00.000Z",
      },
    ],
  },
};

const unknownPushContext = {
  clock: completedPushContext.clock,
  training: {
    todaySchedule: [
      {
        title: "Push",
        planKind: "strength",
        sessionType: "Strength",
        durationMin: 61,
        distanceKm: 0,
        notes: "Strong upper-body session. Keep reps controlled and avoid pushing to failure..",
      },
    ],
    recentCompletedSessions: [],
  },
};

const duplicateLoggedPushContext = {
  clock: completedPushContext.clock,
  training: {
    todaySchedule: [
      {
        planId: "strength-plan",
        sessionKey: "strength-plan_0_0_0",
        weekIndex: 0,
        dayIndex: 0,
        sessionIndex: 0,
        title: "Push",
        planKind: "strength",
        sessionType: "Strength",
        durationMin: 58,
        status: "completed",
        completedAt: "2026-06-22T10:00:00.000Z",
        notes: "Strong upper-body session, but avoid grinding every set to failure.",
      },
    ],
    recentCompletedSessions: [
      {
        id: "logged-push-session",
        title: "Push",
        type: "Weight training",
        durationMin: 61,
        date: "2026-06-22",
        completedAt: "2026-06-22T10:03:00.000Z",
        notes: "Good session",
      },
    ],
  },
};

const weeklyOverviewContext = {
  clock: {
    todayIso: "2026-06-23",
    todayLabel: "Tuesday, 23 June 2026",
  },
  training: {
    currentWeekSchedule: [
      {
        dateLabel: "Mon 22",
        dayIndex: 0,
        title: "Easy Run",
        planKind: "run",
        distanceKm: 8,
        status: "completed",
        notes:
          "Consistency edit: reduced slightly because recent missed sessions put the plan behind target. Keep controlled.",
      },
      {
        dateLabel: "Mon 22",
        dayIndex: 0,
        title: "Upper 1",
        planKind: "strength",
        durationMin: 44,
        status: "completed",
        description:
          "Consistency edit: reduced slightly because recent missed sessions put the plan behind target.",
      },
      {
        dateLabel: "Tue 23",
        dayIndex: 1,
        title: "Lower 1",
        planKind: "strength",
        durationMin: 41,
        status: "planned",
      },
      {
        dateLabel: "Tue 23",
        dayIndex: 1,
        title: "Upper 1 - Power + Performance",
        planKind: "strength",
        durationMin: 45,
        status: "?",
        statusLabel: "?",
        sessionStatus: "?",
        matchStatus: "?",
      },
      {
        dateLabel: "Wed 24",
        dayIndex: 2,
        title: "Speed: 5 x 1200m",
        planKind: "run",
        distanceKm: 9,
        status: "planned",
      },
      {
        dateLabel: "Thu 25",
        dayIndex: 3,
        title: "Upper 2",
        planKind: "strength",
        durationMin: 38,
        status: "skipped",
      },
      {
        dateLabel: "Fri 26",
        dayIndex: 4,
        title: "HM Pace",
        planKind: "run",
        distanceKm: 10,
        status: "moved",
      },
      {
        dateLabel: "Sun 28",
        dayIndex: 6,
        title: "Long Run",
        planKind: "run",
        distanceKm: 13.5,
        status: "planned",
      },
    ],
  },
};

const activePlanContext = {
  clock: {
    todayIso: "2026-06-23",
    todayLabel: "Tuesday, 23 June 2026",
  },
  activePlanSummary: {
    name: "Hybrid Run-Strength Plan",
    primaryActivity: "hybrid run and strength",
    goalPrimaryFocus: "consistency and quality without chasing extra volume",
    sessionsCount: 7,
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
        dateLabel: "Tue 23",
        title: "Lower 1 - Strength + Run Durability",
        planKind: "strength",
        durationMin: 41,
        status: "planned",
      },
    ],
    currentWeekSchedule: weeklyOverviewContext.training.currentWeekSchedule,
  },
};

const missedSessionCases = [
  "I missed today's session, what should I do?",
  "I missed my workout today",
  "I skipped today's session",
];

const broadAiLedPrompts = [
  ...missedSessionCases,
  "My knee hurts when I run, what should I do?",
  "My ankle hurts when I run",
  "My back hurts during deadlifts",
  "How can I improve my 5K time?",
  "How do I run faster?",
  "How can I build endurance?",
  "What should I eat after training?",
  "I want to lose fat but keep performance",
  "I'm tired today, should I train?",
  "I only have 30 minutes today",
  "Can I move today's session to tomorrow?",
  "How should I approach this week?",
];

const cases = [
  {
    name: "urgent chest pain dizziness prompt bypasses AI",
    prompt: "My chest hurts and I feel dizzy during training, should I keep going?",
    context: unknownPushContext,
    includes: "Stop training immediately. Chest pain with dizziness can be serious.",
  },
  {
    name: "urgent severe shortness of breath prompt bypasses AI",
    prompt: "I have severe shortness of breath during exercise, should I continue?",
    context: unknownPushContext,
    includes: "Do not continue the workout.",
  },
  {
    name: "already trained today uses completed-status branch",
    prompt: "Have I already trained today?",
    context: completedPushContext,
    includes: "Yes — you've already completed today's Push session.",
  },
  {
    name: "completed premise uses do-not-repeat branch",
    prompt: "Should I still do today's workout if I already completed it?",
    context: completedPushContext,
    includes: "No — if you've already completed today's planned session, don't repeat it.",
  },
  {
    name: "today plan sees completed planned session",
    prompt: "What should I train today?",
    context: completedPushContext,
    includes: "Today's planned training is already complete.",
  },
  {
    name: "completed premise is respected when status is unknown",
    prompt: "Should I still do today's workout if I already completed it?",
    context: unknownPushContext,
    includes: "No — if you've already completed today's planned session, don't repeat it.",
  },
];

function countOccurrences(text, pattern) {
  return (text.match(pattern) || []).length;
}

for (const testCase of cases) {
  const reply = __coachChatDeterministicReplyForTest(testCase.prompt, testCase.context);
  assert.ok(reply, `${testCase.name}: expected deterministic reply`);
  assert.ok(
    reply.includes(testCase.includes),
    `${testCase.name}: expected reply to include "${testCase.includes}", got:\n${reply}`
  );
  assert.equal(
    reply.includes("0 km"),
    false,
    `${testCase.name}: reply must not include 0 km:\n${reply}`
  );
  assert.equal(
    reply.includes("failure.."),
    false,
    `${testCase.name}: reply must not include double punctuation:\n${reply}`
  );
  assert.equal(
    reply.startsWith("Today is Monday, 22 June 2026.\n\nYou have"),
    false,
    `${testCase.name}: reply hit the old generic today-plan wording:\n${reply}`
  );
}

for (const prompt of broadAiLedPrompts) {
  const reply = __coachChatDeterministicReplyForTest(prompt, activePlanContext);
  assert.equal(
    reply,
    null,
    `${prompt}: broad coaching prompts should go to the AI route, got deterministic reply:\n${reply}`
  );

  const priority = __coachChatLatestPriorityForTest([{ role: "user", content: prompt }]);
  assert.notEqual(
    priority.intent,
    "",
    `${prompt}: expected a latest-message intent for AI routing`
  );
  assert.ok(
    priority.instruction.includes("Answer the latest user message directly"),
    `${prompt}: latest user message should be prioritised:\n${priority.instruction}`
  );
}

const activePlanPrompts = [
  "What plan am I currently on?",
  "What is my current plan?",
  "What training plan am I on?",
];

for (const prompt of activePlanPrompts) {
  const reply = __coachChatDeterministicReplyForTest(prompt, activePlanContext);
  assert.ok(reply, `${prompt}: expected active-plan reply`);
  assert.ok(
    reply.includes("You're currently on"),
    `${prompt}: should answer with the active/current plan:\n${reply}`
  );
  assert.ok(
    reply.includes("Hybrid Run-Strength Plan"),
    `${prompt}: should include active plan name when available:\n${reply}`
  );
  assert.ok(
    reply.includes("Structure:"),
    `${prompt}: should summarise plan structure:\n${reply}`
  );
  assert.ok(
    reply.includes("Main focus:"),
    `${prompt}: should summarise plan focus:\n${reply}`
  );
  assert.equal(
    reply.startsWith("Today's session is"),
    false,
    `${prompt}: should not answer as only today's session:\n${reply}`
  );
  assert.equal(
    reply.includes("Today's planned training is already"),
    false,
    `${prompt}: should not hit today-plan branch:\n${reply}`
  );
  assert.ok(
    reply.split("\n").filter(Boolean).length <= 5,
    `${prompt}: active-plan reply should stay concise:\n${reply}`
  );
}

const weeklyFocusPrompts = [
  "What should I focus on this week?",
  "How should I approach this week?",
  "What is the main goal this week?",
  "What should I prioritise this week?",
];

for (const prompt of weeklyFocusPrompts) {
  const deterministicReply = __coachChatDeterministicReplyForTest(prompt, activePlanContext);
  assert.equal(
    deterministicReply,
    null,
    `${prompt}: weekly focus should remain AI-led before fallback`
  );

  const priority = __coachChatLatestPriorityForTest([{ role: "user", content: prompt }]);
  assert.equal(priority.intent, "weekly_focus", `${prompt}: expected weekly_focus intent`);
  assert.ok(
    priority.instruction.includes("strategic weekly focus"),
    `${prompt}: AI instruction should prioritise weekly strategy:\n${priority.instruction}`
  );

  const fallback = __coachChatLocalFallbackForTest(prompt, activePlanContext);
  assert.ok(
    fallback.includes("consistency and quality"),
    `${prompt}: fallback should mention consistency and quality:\n${fallback}`
  );
  assert.ok(
    fallback.includes("Speed: 5 x 1200m"),
    `${prompt}: fallback should highlight key speed session:\n${fallback}`
  );
  assert.ok(
    fallback.includes("HM Pace"),
    `${prompt}: fallback should highlight HM pace session:\n${fallback}`
  );
  assert.ok(
    fallback.includes("Long Run"),
    `${prompt}: fallback should highlight long run:\n${fallback}`
  );
  assert.ok(
    fallback.includes("recovery, sleep, and fuelling"),
    `${prompt}: fallback should mention recovery supports:\n${fallback}`
  );
  assert.equal(
    fallback.includes("I'm having trouble connecting"),
    false,
    `${prompt}: fallback must not be the generic connection error:\n${fallback}`
  );
}

const generalTrainingAdvicePrompts = [
  "How can I improve my 5K time?",
  "How do I run faster?",
  "How can I build endurance?",
  "How do I get stronger?",
];

for (const prompt of generalTrainingAdvicePrompts) {
  const deterministicReply = __coachChatDeterministicReplyForTest(prompt, activePlanContext);
  assert.equal(
    deterministicReply,
    null,
    `${prompt}: general coaching advice should be AI-led, not deterministic`
  );

  const priority = __coachChatLatestPriorityForTest([{ role: "user", content: prompt }]);
  assert.equal(
    priority.intent,
    "general_training_advice",
    `${prompt}: expected general_training_advice intent`
  );
  assert.ok(
    priority.instruction.includes("general coaching question"),
    `${prompt}: instruction should identify the latest ask as general coaching:\n${priority.instruction}`
  );
  assert.ok(
    priority.instruction.includes("Use the active plan only as background context"),
    `${prompt}: instruction should keep plan context secondary:\n${priority.instruction}`
  );
  assert.ok(
    priority.instruction.includes("Do not simply describe today's session"),
    `${prompt}: instruction should prevent today's session summary:\n${priority.instruction}`
  );

  if (prompt.includes("5K") || prompt.includes("run faster")) {
    assert.ok(
      priority.instruction.includes("speed/interval work"),
      `${prompt}: running improvement instruction should mention speed work:\n${priority.instruction}`
    );
    assert.ok(
      priority.instruction.includes("tempo or threshold work"),
      `${prompt}: running improvement instruction should mention threshold work:\n${priority.instruction}`
    );
  }
}

const weeklyOverviewPrompts = [
  "What sessions do I have this week?",
  "Show me this week’s plan",
  "What is my week looking like?",
];

for (const prompt of weeklyOverviewPrompts) {
  const reply = __coachChatDeterministicReplyForTest(prompt, weeklyOverviewContext);
  assert.ok(reply, `${prompt}: expected deterministic weekly overview reply`);
  assert.ok(reply.includes("Here's your week:"), `${prompt}: should include compact heading`);
  assert.ok(reply.includes("Mon 22"), `${prompt}: should include day/date`);
  assert.ok(reply.includes("Easy Run"), `${prompt}: should include session title`);
  assert.ok(reply.includes("Upper 1"), `${prompt}: should group multiple sessions on one day`);
  assert.ok(
    reply.includes("Upper 1 - Power + Performance · 45 min"),
    `${prompt}: should show unknown-status sessions without a ? marker`
  );
  assert.ok(reply.includes("completed"), `${prompt}: should include completed status text`);
  assert.equal(
    reply.includes("✅"),
    false,
    `${prompt}: weekly overview should not include emoji status markers:\n${reply}`
  );
  assert.ok(reply.includes("skipped"), `${prompt}: should include skipped status where available`);
  assert.ok(reply.includes("moved"), `${prompt}: should include moved status where available`);
  assert.ok(reply.includes("Main focus:"), `${prompt}: should end with weekly focus`);
  assert.equal(
    reply.includes("Consistency edit"),
    false,
    `${prompt}: should not include verbose consistency edit text:\n${reply}`
  );
  assert.equal(
    reply.includes("because recent missed sessions"),
    false,
    `${prompt}: should not dump full session descriptions:\n${reply}`
  );
  assert.equal(
    reply.includes(" · ?"),
    false,
    `${prompt}: should not render unknown placeholder status:\n${reply}`
  );
  assert.equal(
    reply.includes("(?)"),
    false,
    `${prompt}: should not render parenthesised unknown placeholder status:\n${reply}`
  );
  assert.equal(
    reply.includes("?"),
    false,
    `${prompt}: weekly overview should not contain any placeholder question marks:\n${reply}`
  );
  assert.ok(
    reply.split("\n").filter(Boolean).length <= 10,
    `${prompt}: weekly overview should be concise:\n${reply}`
  );
}

const questionStatusVariants = ["?", "❔", "❔️", "❓", "�", "？"];

for (const variant of questionStatusVariants) {
  const reply = __coachChatDeterministicReplyForTest("What sessions do I have this week?", {
    clock: weeklyOverviewContext.clock,
    training: {
      currentWeekSchedule: [
        {
          dateLabel: "Mon 22 Jun",
          dayIndex: 0,
          title: "Upper 1 - Power + Performance",
          planKind: "strength",
          durationMin: 45,
          status: variant,
          statusLabel: variant,
          sessionStatus: variant,
          state: variant,
          logStatus: variant,
          completionStatus: variant,
          matchStatus: variant,
        },
      ],
    },
  });

  assert.ok(
    reply.includes("Upper 1 - Power + Performance · 45 min"),
    `variant ${variant}: should keep session title and metric:\n${reply}`
  );
  assert.equal(
    /[?❔❓�？]/.test(reply),
    false,
    `variant ${variant}: should strip placeholder question statuses from weekly overview:\n${reply}`
  );
}

for (const status of ["active", "started", "in_progress", "planned", "fresh", "pending"]) {
  const reply = __coachChatDeterministicReplyForTest("What sessions do I have this week?", {
    clock: weeklyOverviewContext.clock,
    training: {
      currentWeekSchedule: [
        {
          dateLabel: "Mon 22 Jun",
          dayIndex: 0,
          title: "Upper 1 - Power + Performance",
          planKind: "strength",
          durationMin: 45,
          status,
        },
      ],
    },
  });

  assert.ok(
    reply.includes("Upper 1 - Power + Performance · 45 min"),
    `status ${status}: should keep session title and metric:\n${reply}`
  );
  assert.equal(
    reply.includes(`45 min ·`),
    false,
    `status ${status}: should not append non-allowed weekly status markers:\n${reply}`
  );
}

const aiLedAdjustmentPrompts = [
  "I only have 30 minutes today",
  "What should I do if I'm short on time?",
  "I'm tired today, should I train?",
  "I slept badly last night, should I adjust my workout?",
  "What should I eat after training?",
  "What should I eat before a run?",
  "What should I eat tonight?",
  "How do I hit my protein?",
  "How should I approach this week?",
  "Can I move today's session to tomorrow?",
  "Can I do today’s workout tomorrow instead?",
  "Move my run to Friday",
  "I want to lose fat but keep performance, what should I do?",
];

for (const prompt of aiLedAdjustmentPrompts) {
  const reply = __coachChatDeterministicReplyForTest(prompt, completedPushContext);
  assert.equal(
    reply,
    null,
    `${prompt}: expected AI-led adaptation instead of deterministic today-plan reply, got:\n${reply}`
  );
}

const nutritionAfterLimitedTimePriority = __coachChatLatestPriorityForTest([
  {
    role: "user",
    content: "I only have 30 minutes today, what should I do?",
  },
  {
    role: "assistant",
    content:
      "Use the 30 minutes for recovery: mobility, easy cycling, and light stretching.",
  },
  {
    role: "user",
    content: "What should I eat after training?",
  },
]);

assert.equal(
  nutritionAfterLimitedTimePriority.latestUserText,
  "What should I eat after training?",
  "latest user message should be the nutrition question"
);
assert.equal(
  nutritionAfterLimitedTimePriority.intent,
  "post_training_nutrition",
  "latest nutrition question should override previous limited-time topic"
);
assert.ok(
  nutritionAfterLimitedTimePriority.instruction.includes("This is a nutrition question"),
  "latest-priority instruction should explicitly mark nutrition intent"
);
assert.ok(
  nutritionAfterLimitedTimePriority.instruction.includes("Do not provide a timed mobility"),
  "latest-priority instruction should prevent continuing the previous recovery-plan topic"
);
assert.equal(
  nutritionAfterLimitedTimePriority.previousConversationContext.some((message) =>
    message.content.includes("What should I eat after training?")
  ),
  false,
  "latest user message should not be duplicated into previous conversation context"
);

const fatLossAfterPostTrainingPriority = __coachChatLatestPriorityForTest([
  {
    role: "user",
    content: "What should I eat after training?",
  },
  {
    role: "assistant",
    content:
      "After training, aim for 25-40g protein with carbs and fluids. Good options include chicken and rice, Greek yoghurt and fruit, or a protein shake and banana.",
  },
  {
    role: "user",
    content: "I want to lose fat but keep performance, what should I do?",
  },
]);

assert.equal(
  fatLossAfterPostTrainingPriority.latestUserText,
  "I want to lose fat but keep performance, what should I do?",
  "latest user message should be the fat-loss/performance question"
);
assert.equal(
  fatLossAfterPostTrainingPriority.intent,
  "fat_loss_performance",
  "fat-loss/performance question should not be treated as post-training nutrition"
);
assert.ok(
  fatLossAfterPostTrainingPriority.instruction.includes("small calorie deficit"),
  "fat-loss/performance instruction should mention calorie deficit strategy"
);
assert.ok(
  fatLossAfterPostTrainingPriority.instruction.includes("high protein"),
  "fat-loss/performance instruction should mention protein"
);
assert.ok(
  fatLossAfterPostTrainingPriority.instruction.includes("carbs around training"),
  "fat-loss/performance instruction should mention carbs around training"
);
assert.ok(
  fatLossAfterPostTrainingPriority.instruction.includes("consistent strength work"),
  "fat-loss/performance instruction should mention maintaining training"
);
assert.ok(
  fatLossAfterPostTrainingPriority.instruction.includes("not a post-training meal question"),
  "fat-loss/performance instruction should prevent post-training meal continuation"
);

const scheduleMovePrompts = [
  "Can I move today's session to tomorrow?",
  "Can I do today’s workout tomorrow instead?",
  "Move my run to Friday",
];

for (const prompt of scheduleMovePrompts) {
  const priority = __coachChatLatestPriorityForTest([
    {
      role: "user",
      content: prompt,
    },
  ]);

  assert.equal(
    priority.intent,
    "schedule_reschedule",
    `${prompt}: expected schedule reschedule intent`
  );
  assert.ok(
    priority.instruction.includes("Check tomorrow's planned session"),
    `${prompt}: instruction should tell model to check tomorrow where available`
  );
  assert.ok(
    priority.instruction.includes("warn against stacking"),
    `${prompt}: instruction should warn against stacking hard sessions`
  );
  assert.ok(
    priority.instruction.includes("Do not simply tell the user to complete today as scheduled"),
    `${prompt}: instruction should prevent generic today-plan answer`
  );
  assert.ok(
    priority.instruction.includes("Do not claim the plan has been changed"),
    `${prompt}: instruction should prevent auto-changing plan`
  );
  assert.ok(
    priority.instruction.includes("at least two practical options"),
    `${prompt}: instruction should require options, not a single generic recommendation`
  );
  assert.ok(
    priority.instruction.includes("Want me to move it?"),
    `${prompt}: instruction should ask for confirmation when appropriate`
  );
}

const duplicateReply = __coachChatDeterministicReplyForTest(
  "What should I train today?",
  duplicateLoggedPushContext
);
assert.ok(duplicateReply, "duplicate logged session: expected deterministic reply");
assert.ok(
  duplicateReply.includes("Today's planned training is already complete."),
  `duplicate logged session: expected completed planned training wording, got:\n${duplicateReply}`
);
assert.equal(
  duplicateReply.includes("Other training logged today"),
  false,
  `duplicate logged session: should not show duplicate logged Push as other training:\n${duplicateReply}`
);
assert.equal(
  duplicateReply.includes("61 min"),
  false,
  `duplicate logged session: should prefer the planned completed session and hide duplicate log duration:\n${duplicateReply}`
);
assert.equal(
  countOccurrences(duplicateReply, /\bPush\b/g),
  1,
  `duplicate logged session: expected Push to appear once, got:\n${duplicateReply}`
);

console.log("coach-chat deterministic prompt tests passed");
