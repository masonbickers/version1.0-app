import assert from "node:assert/strict";
import {
  __coachChatDeterministicReplyForTest,
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

const missedSessionCases = [
  "I missed today's session, what should I do?",
  "I missed my workout today",
  "I skipped today's session",
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
    name: "knee running pain prompt bypasses AI",
    prompt: "My knee hurts when I run, what should I do?",
    context: unknownPushContext,
    includes: "Don't push through knee pain.",
  },
  {
    name: "ankle running pain prompt bypasses AI",
    prompt: "My ankle hurts when I run",
    context: unknownPushContext,
    includes: "Don't push through ankle pain.",
  },
  {
    name: "back deadlift pain prompt bypasses AI",
    prompt: "My back hurts during deadlifts",
    context: unknownPushContext,
    includes: "Don't push through back pain during lifting.",
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

for (const prompt of missedSessionCases) {
  const reply = __coachChatDeterministicReplyForTest(prompt, completedPushContext);
  assert.ok(reply, `${prompt}: expected short adaptive missed-session reply`);
  assert.ok(
    reply.includes("marked as completed"),
    `${prompt}: expected completed status acknowledgement, got:\n${reply}`
  );
  assert.ok(
    reply.includes("don't double up aggressively"),
    `${prompt}: expected conservative no-doubling advice, got:\n${reply}`
  );
  assert.equal(
    reply.includes("Today's planned training is already complete."),
    false,
    `${prompt}: should not return generic completed-plan block:\n${reply}`
  );
  assert.equal(
    reply.includes("\nCompleted:"),
    false,
    `${prompt}: should not dump completed session section:\n${reply}`
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
