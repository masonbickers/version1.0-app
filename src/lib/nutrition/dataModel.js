import { Timestamp, serverTimestamp } from "firebase/firestore";

export const NUTRITION_PROFILE_PATH = ["nutrition", "profile"];
export const MEALS_COLLECTION = "meals";
export const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

export function startOfDayISO(inputISO) {
  const d = inputISO ? new Date(String(inputISO)) : new Date();
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback.toISOString();
  }
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function timestampOnSelectedDay(selectedDayISO) {
  const base = new Date(String(selectedDayISO || ""));
  if (Number.isNaN(base.getTime())) return Timestamp.fromDate(new Date());
  const now = new Date();
  base.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return Timestamp.fromDate(base);
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normaliseMealType(value, fallback = "Unspecified") {
  const clean = String(value || "").trim();
  if (!clean) return fallback;
  return MEAL_TYPES.includes(clean) ? clean : clean.slice(0, 40);
}

export function buildMealLogPayload(input = {}) {
  const macros = input.macros && typeof input.macros === "object" ? input.macros : {};
  const raw = input.raw && typeof input.raw === "object" ? input.raw : {};
  const dateISO = startOfDayISO(input.dateISO || input.date);

  return {
    title: String(input.title || input.name || raw.title || raw.name || "Food").trim(),
    mealType: normaliseMealType(input.mealType),
    calories: numberOrZero(input.calories ?? macros.calories ?? raw.calories),
    protein: numberOrZero(input.protein ?? macros.protein ?? raw.protein),
    carbs: numberOrZero(input.carbs ?? macros.carbs ?? raw.carbs),
    fat: numberOrZero(input.fat ?? macros.fat ?? raw.fat),
    fibre: numberOrZero(input.fibre ?? input.fiber ?? raw.fibre ?? raw.fiber),
    sugar: numberOrZero(input.sugar ?? raw.sugar),
    sodium: numberOrZero(input.sodium ?? raw.sodium),
    servingText: String(input.servingText || raw.servingText || ""),
    notes: String(input.notes || raw.notes || ""),
    source: String(input.source || "manual"),
    date: timestampOnSelectedDay(dateISO),
    dateKey: dateISO.slice(0, 10),
    createdAt: input.createdAt || serverTimestamp(),
    updatedAt: input.updatedAt || serverTimestamp(),
    ...(input.brand ? { brand: String(input.brand) } : {}),
    ...(input.barcode ? { barcode: String(input.barcode) } : {}),
    ...(input.spokenText ? { spokenText: String(input.spokenText) } : {}),
  };
}

export function buildNutritionProfilePayload(input = {}) {
  return {
    goalType: String(input.goalType || input.nutritionGoal || "maintenance"),
    dailyCalories: numberOrZero(input.dailyCalories),
    proteinTarget: numberOrZero(input.proteinTarget),
    carbTarget: numberOrZero(input.carbTarget),
    fatTarget: numberOrZero(input.fatTarget),
    weightKg: numberOrZero(input.weightKg),
    heightCm: numberOrZero(input.heightCm),
    age: numberOrZero(input.age),
    sex: String(input.sex || ""),
    activityLevel: String(input.activityLevel || ""),
    updatedAt: input.updatedAt || serverTimestamp(),
  };
}
