// app/lib/training/schema.js

// ───────────────────────────────────────────────────────────────
//  Basic constants
// ───────────────────────────────────────────────────────────────

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ───────────────────────────────────────────────────────────────
//  JSDoc "types" (for editor intellisense, no TS needed)
// ───────────────────────────────────────────────────────────────

/**
 * @typedef {"Warmup" | "Run" | "CoolDown" | "Strength" | "Hyrox" | "Other"} StepType
 */

/**
 * @typedef {"Easy" | "Moderate" | "Hard" | "Max"} Intensity
 */

/**
 * @typedef {Object} Step
 * @property {StepType} type
 * @property {string} description           // e.g. "10' easy jog", "6 x 800m @ 10k pace"
 * @property {number=} durationMinutes      // optional
 * @property {number=} distanceKm           // optional
 * @property {Intensity=} intensity         // optional
 */

/**
 * @typedef {"Easy" | "Tempo" | "Intervals" | "Long" | "Strength" | "Mixed"} SessionFocus
 */

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} label                 // e.g. "Easy run", "Interval session"
 * @property {SessionFocus} focus
 * @property {Step[]} steps
 * @property {string=} notes
 */

/**
 * @typedef {Object} DayPlan
 * @property {"Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"} day
 * @property {Session[]} sessions
 */

/**
 * @typedef {Object} WeekPlan
 * @property {string} title                 // e.g. "Week 1 – Base + Speed"
 * @property {DayPlan[]} days
 */

/**
 * @typedef {"10k" | "Half" | "Marathon" | "Hyrox"} GoalType
 */

/**
 * @typedef {Object} TrainingPlan
 * @property {string=} id                   // Firestore doc id
 * @property {string} userId
 * @property {GoalType} goalType
 * @property {string} targetEventDate       // ISO string
 * @property {string=} targetTime           // e.g. "00:40:00"
 * @property {string=} current10kTime       // e.g. "00:43:00"
 * @property {number} sessionsPerWeek
 * @property {WeekPlan[]} weeks
 * @property {string=} createdAtIso         // client-side ISO (Firestore will also have serverTimestamp)
 */

// ───────────────────────────────────────────────────────────────
//  Helper builders
// ───────────────────────────────────────────────────────────────

/**
 * Create an empty week: Mon–Sun, all rest days.
 * @param {string} title
 * @returns {WeekPlan}
 */
export const emptyWeek = (title = "Week") => ({
  title,
  days: DAYS.map((d) => ({
    day: d,
    sessions: [],
  })),
});

/**
 * Create a basic plan shell (before / without AI).
 * You’ll mostly use this AFTER you get an AI response and just ensure fields exist.
 */
export const createTrainingPlan = ({
  userId,
  goalType,
  targetEventDate,
  targetTime,
  current10kTime,
  sessionsPerWeek,
  weeks,
}) => ({
  userId,
  goalType,
  targetEventDate,
  targetTime: targetTime || "",
  current10kTime: current10kTime || "",
  sessionsPerWeek: Number(sessionsPerWeek) || 3,
  weeks: Array.isArray(weeks) ? weeks : [],
  createdAtIso: new Date().toISOString(),
});

/**
 * Super defensive normaliser for whatever the AI sends back.
 * - Ensures days are valid
 * - Ensures steps/fields exist
 *
 * @param {any} raw
 * @returns {TrainingPlan}
 */
export const normaliseAiPlan = (raw = {}) => {
  const {
    userId = "",
    goalType = "10k",
    targetEventDate = new Date().toISOString().slice(0, 10),
    targetTime = "",
    current10kTime = "",
    sessionsPerWeek = 4,
    weeks = [],
  } = raw;

  const safeWeeks = Array.isArray(weeks) ? weeks : [];

  const cleanedWeeks = safeWeeks.map((week, i) => {
    const title = typeof week?.title === "string" && week.title.trim()
      ? week.title.trim()
      : `Week ${i + 1}`;

    const days = Array.isArray(week?.days) ? week.days : [];

    const cleanedDays = DAYS.map((dayName) => {
      const matching = days.find((d) => d?.day === dayName) || {};
      const sessions = Array.isArray(matching.sessions) ? matching.sessions : [];

      const cleanedSessions = sessions.map((s, idx) => ({
        id: String(s?.id || `${dayName}-${idx}`),
        label: String(s?.label || "Session"),
        focus: s?.focus || "Easy",
        steps: Array.isArray(s?.steps)
          ? s.steps.map((step) => ({
              type: step?.type || "Run",
              description: String(step?.description || ""),
              durationMinutes: Number.isFinite(step?.durationMinutes)
                ? step.durationMinutes
                : undefined,
              distanceKm: Number.isFinite(step?.distanceKm)
                ? step.distanceKm
                : undefined,
              intensity: step?.intensity || undefined,
            }))
          : [],
        notes: s?.notes ? String(s.notes) : undefined,
      }));

      return {
        day: dayName,
        sessions: cleanedSessions,
      };
    });

    return { title, days: cleanedDays };
  });

  return createTrainingPlan({
    userId,
    goalType,
    targetEventDate,
    targetTime,
    current10kTime,
    sessionsPerWeek,
    weeks: cleanedWeeks,
  });
};
