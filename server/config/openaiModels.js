export const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";
export const OPENAI_FALLBACK_MODEL =
  process.env.OPENAI_FALLBACK_MODEL || "gpt-4.1-mini";
export const OPENAI_WORKOUT_MODEL =
  process.env.OPENAI_MODEL_WORKOUT || DEFAULT_OPENAI_MODEL;
export const OPENAI_COACH_CHAT_MODEL =
  process.env.OPENAI_MODEL_CHAT || OPENAI_FALLBACK_MODEL;
