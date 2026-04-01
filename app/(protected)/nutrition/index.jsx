"use client";

/**
 * NUTRITION PAGE — SAP GEL STYLE
 * Accent: Neon Yellow
 * Card: Clean silver, soft borders
 */

import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- config ---------------- */

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH - 36; // screen minus horizontal padding
const CARD_GAP = 12;
const CARD_SNAP_INTERVAL = CARD_WIDTH + CARD_GAP;

// same idea as chat page so content clears your footer
const FOOTER_OFFSET = 90;

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}
function addDays(d = new Date(), n = 0) {
  const x = new Date(d);
  x.setDate(x.getDate() + Number(n || 0));
  return x;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatClock(d) {
  try {
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function mealDateToJS(meal) {
  const raw = meal?.date;
  if (!raw) return null;
  if (typeof raw?.toDate === "function") return raw.toDate();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayProgressPct(selectedDate) {
  const now = new Date();
  const dayStart = startOfDay(selectedDate);
  const dayEnd = endOfDay(selectedDate);

  const t = isSameDay(dayStart, now) ? now : dayEnd;
  const total = dayEnd.getTime() - dayStart.getTime();
  const done = Math.max(
    0,
    Math.min(total, t.getTime() - dayStart.getTime())
  );
  return total ? done / total : 1;
}

function dayPartLabel(d) {
  const h = d.getHours();
  if (h < 10) return "Morning";
  if (h < 14) return "Late morning";
  if (h < 18) return "Afternoon";
  if (h < 22) return "Evening";
  return "Late";
}

function mealTypeIcon(mealType) {
  const t = String(mealType || "").toLowerCase();
  if (t.includes("breakfast")) return "sunrise";
  if (t.includes("lunch")) return "sun";
  if (t.includes("dinner")) return "moon";
  if (t.includes("snack")) return "coffee";
  return "circle";
}

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function coverageSummary(meals, cutoffDate) {
  const parts = {
    Morning: 0,
    "Late morning": 0,
    Afternoon: 0,
    Evening: 0,
    Late: 0,
  };
  let counted = 0;

  meals.forEach((m) => {
    const d = mealDateToJS(m);
    if (!d) return;
    if (d.getTime() > cutoffDate.getTime()) return;
    const p = dayPartLabel(d);
    parts[p] += 1;
    counted += 1;
  });

  const filled = Object.keys(parts).filter((k) => parts[k] > 0);
  return { parts, filled, counted };
}

/**
 * Fallback coach: "Training fuel match" WITH time-of-day awareness.
 * If selected day is today, we evaluate "so far today" instead of end-of-day.
 */
function fallbackTrainingMatch({ totals, goal, foodQuality, selectedDate }) {
  const goalCals = Number(goal?.dailyCalories || 0);
  const cals = Number(totals?.calories || 0);
  const protein = Number(totals?.protein || 0);
  const carbs = Number(totals?.carbs || 0);

  const now = new Date();
  const cutoff = isSameDay(startOfDay(selectedDate), now)
    ? now
    : endOfDay(selectedDate);
  const pctDay = dayProgressPct(selectedDate);

  // slightly front-loaded expectation curve
  const expectedPct = Math.min(1, Math.max(0.1, Math.pow(pctDay, 0.85)));
  const expectedCalsSoFar = goalCals ? Math.round(goalCals * expectedPct) : 0;

  if (!cals) {
    return {
      grade: "—",
      dayType: isSameDay(startOfDay(selectedDate), now)
        ? `So far (${formatClock(cutoff)})`
        : "That day",
      summary:
        "Log at least one meal to check how your fuel matches your training.",
      tips: [
        "Start with a balanced meal + fluids.",
        "Aim for protein in every meal.",
      ],
      timeMeta: goalCals
        ? `Expected by now: ~${expectedCalsSoFar} kcal`
        : "",
    };
  }

  const diffSoFar = goalCals
    ? (cals - expectedCalsSoFar) / Math.max(1, expectedCalsSoFar)
    : 0;
  const diffEnd = goalCals ? (cals - goalCals) / Math.max(1, goalCals) : 0;

  const useSoFar = isSameDay(startOfDay(selectedDate), now);
  const diffRatio = Math.abs(useSoFar ? diffSoFar : diffEnd);

  let grade = "B";
  if (diffRatio <= 0.12) grade = "A";
  else if (diffRatio <= 0.22) grade = "B";
  else if (diffRatio <= 0.38) grade = "C";
  else grade = "D";

  const isLowCarb = carbs < 2.5 * Math.max(1, protein); // loose heuristic
  const fq = String(foodQuality?.grade || "").toUpperCase();
  const fqPenalty = fq === "D" || fq === "F";

  let dayType = useSoFar ? `So far (${formatClock(cutoff)})` : "That day";
  if (useSoFar) {
    if (diffSoFar < -0.25)
      dayType = `Under-fuelling so far (${formatClock(cutoff)})`;
    if (diffSoFar > 0.25)
      dayType = `Over-fuelling so far (${formatClock(cutoff)})`;
  } else {
    if (diffEnd < -0.2) dayType = "Under-fuelled";
    if (diffEnd > 0.2) dayType = "Over-fuelled";
  }

  let summary =
    "Your nutrition is broadly aligned with your training needs.";
  if (grade === "A")
    summary = "Dialled in — your intake matches the day’s training demands nicely.";
  if (grade === "C")
    summary = "Some mismatch — tighten energy + carb timing around sessions.";
  if (grade === "D")
    summary = "Big mismatch — your intake is likely limiting training quality or recovery.";

  const kcalPct = goalCals ? Math.round((cals / goalCals) * 100) : 0;
  const expectedPctInt = goalCals ? Math.round(expectedPct * 100) : 0;

  const tips = [];
  if (useSoFar) {
    if (cals < expectedCalsSoFar * 0.85) {
      tips.push(
        `You’re behind for this time of day (${kcalPct}% vs ~${expectedPctInt}%). Add a carb + protein top-up.`
      );
    } else if (cals > expectedCalsSoFar * 1.15) {
      tips.push(
        `You’re ahead for this time of day (${kcalPct}% vs ~${expectedPctInt}%). Keep the rest of the day lighter but protein steady.`
      );
    } else {
      tips.push(
        `On pace for this time of day (${kcalPct}% vs ~${expectedPctInt}%).`
      );
    }
  } else {
    if (goalCals && cals < goalCals * 0.85)
      tips.push(
        "You finished the day under target — add 300–600 kcal on heavy training days."
      );
    if (goalCals && cals > goalCals * 1.15)
      tips.push(
        "You finished the day over target — trim low-satiety extras and keep protein stable."
      );
  }

  if (isLowCarb)
    tips.push(
      "If you trained today: increase carbs earlier + post-session for performance/recovery."
    );
  tips.push("Hit protein evenly across the day (25–40 g per meal).");
  if (fqPenalty)
    tips.push(
      "Improve food quality: swap one ultra-processed item for whole-food carbs + veg."
    );

  return {
    grade,
    dayType,
    summary,
    tips: tips.slice(0, 4),
    timeMeta: goalCals
      ? `So far: ${cals} kcal (${kcalPct}%) • Expected by now: ~${expectedCalsSoFar} kcal (~${expectedPctInt}%)`
      : "",
  };
}

export default function NutritionPage() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;

  /**
   * ✅ THEME-DRIVEN COLOURS (no hard-coded neon usage for text on white)
   * - accentBg: neon for fills (buttons/chips)
   * - accentText: readable “neon ink” in light mode for text/icons on white
   * - silverLight/silverMed: consistent SAP silvers from tokens where available
   */
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText =
    colors?.accentText ?? (isDark ? accentBg : "#7A8F00"); // readable on white
  const silverLight =
    colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const [selectedDate, setSelectedDate] = useState(() => startOfDay());

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [todayMeals, setTodayMeals] = useState([]);
  const [weekStats, setWeekStats] = useState(null);
  const [quickMealType, setQuickMealType] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // chat-style quick log
  const [quickText, setQuickText] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);

  // nutrition goal
  const [nutritionGoal, setNutritionGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  // analysis
  const [analysis, setAnalysis] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // food quality (AI, per selected day)
  const [foodQuality, setFoodQuality] = useState(null);
  const [foodQualityLoading, setFoodQualityLoading] = useState(false);

  // ✅ training match (AI, per selected day)
  const [trainingMatch, setTrainingMatch] = useState(null);
  const [trainingMatchLoading, setTrainingMatchLoading] = useState(false);

  // carousels
  const [goalSlideIndex, setGoalSlideIndex] = useState(0);
  const [insightSlideIndex, setInsightSlideIndex] = useState(0);

  // 🔑 track keyboard like chat page
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ✅ scroll restore (remember where user was on the page)
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const restoredScrollOnceRef = useRef(false);

  const s = useMemo(
    () =>
      makeStyles(
        colors,
        isDark,
        accentBg,
        accentText,
        silverLight,
        silverMed
      ),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );
  const topFadeStart = useMemo(() => {
    const alpha = isDark ? "33" : "55";
    const resolved = withHexAlpha(accentBg, alpha);
    if (resolved !== accentBg) return resolved;
    return isDark ? "rgba(230,255,59,0.2)" : "rgba(230,255,59,0.3)";
  }, [accentBg, isDark]);

  /* redirect when logged out */
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  /* keyboard listeners – same pattern as chat page */
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ✅ Restore selected day when coming back from Meal Detail (or deep links)
  useEffect(() => {
    const raw = params?.date;
    if (!raw) return;

    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return;

    setSelectedDate(startOfDay(d));
  }, [params?.date]);

  // ✅ Restore scroll position when coming back (only once per "return")
  useEffect(() => {
    const raw = params?.scrollY;
    const y = Number(raw ?? 0);

    // no scroll restore requested
    if (!y) {
      restoredScrollOnceRef.current = false;
      return;
    }

    // avoid repeatedly forcing scroll while user interacts
    if (restoredScrollOnceRef.current) return;

    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
      restoredScrollOnceRef.current = true;
    }, 60);

    return () => clearTimeout(t);
  }, [params?.scrollY]);

  /* fetch nutrition goal */
  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "users", user.uid, "nutrition", "profile");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setNutritionGoal(snap.exists() ? snap.data() : null);
        setGoalLoading(false);
      },
      () => setGoalLoading(false)
    );

    return () => unsub();
  }, [user]);

  /* fetch meals for selected day */
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const mealsRef = collection(db, "users", user.uid, "meals");
    const from = Timestamp.fromDate(startOfDay(selectedDate));
    const to = Timestamp.fromDate(endOfDay(selectedDate));

    const qMeals = query(
      mealsRef,
      where("date", ">=", from),
      where("date", "<=", to),
      orderBy("date", "desc")
    );

    const unsub = onSnapshot(qMeals, (snap) => {
      setTodayMeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsub();
  }, [user, selectedDate]);

  /* compute totals for selected day */
  const todayTotals = useMemo(() => {
    const base = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    return todayMeals.reduce(
      (acc, m) => ({
        calories: acc.calories + Number(m.calories || 0),
        protein: acc.protein + Number(m.protein || 0),
        carbs: acc.carbs + Number(m.carbs || 0),
        fat: acc.fat + Number(m.fat || 0),
      }),
      base
    );
  }, [todayMeals]);

  const goalCals = nutritionGoal?.dailyCalories || 0;

  const macroTargets = useMemo(
    () => ({
      protein: nutritionGoal ? Number(nutritionGoal.proteinTarget || 0) : 0,
      carbs: nutritionGoal ? Number(nutritionGoal.carbTarget || 0) : 0,
      fat: nutritionGoal ? Number(nutritionGoal.fatTarget || 0) : 0,
    }),
    [nutritionGoal]
  );

  const remaining = useMemo(() => {
    if (!nutritionGoal) return null;
    return {
      calories: Math.max(0, Math.round(goalCals - todayTotals.calories || 0)),
      protein: Math.max(
        0,
        Math.round(macroTargets.protein - todayTotals.protein || 0)
      ),
      carbs: Math.max(
        0,
        Math.round(macroTargets.carbs - todayTotals.carbs || 0)
      ),
      fat: Math.max(0, Math.round(macroTargets.fat - todayTotals.fat || 0)),
    };
  }, [nutritionGoal, goalCals, todayTotals, macroTargets]);

  const isTodaySelected = useMemo(() => {
    const todayStart = startOfDay();
    return startOfDay(selectedDate).getTime() === todayStart.getTime();
  }, [selectedDate]);

  const setSelectedDay = useCallback((value) => {
    restoredScrollOnceRef.current = false; // allow restore on next return
    const next = startOfDay(value instanceof Date ? value : new Date(value));
    const todayStart = startOfDay();
    setSelectedDate(next > todayStart ? todayStart : next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const daySliderItems = useMemo(() => {
    const todayStart = startOfDay();
    const selectedStart = startOfDay(selectedDate);
    const selectedDiff = Math.round(
      (todayStart.getTime() - selectedStart.getTime()) / (24 * 60 * 60 * 1000)
    );

    let end = todayStart;
    if (selectedDiff > 6) {
      end = addDays(selectedStart, 3);
      if (end > todayStart) end = todayStart;
    }
    const start = addDays(end, -6);

    return Array.from({ length: 7 }, (_, idx) => {
      const date = startOfDay(addDays(start, idx));
      return {
        key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
        date,
        isSelected: isSameDay(date, selectedStart),
        isToday: isSameDay(date, todayStart),
        dow: date.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
        day: String(date.getDate()),
      };
    });
  }, [selectedDate]);

  /* filtered meals (search by title / notes / type) */
  const filteredMeals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return todayMeals;

    return todayMeals.filter((m) => {
      const title = String(m.title || "").toLowerCase();
      const notes = String(m.notes || "").toLowerCase();
      const type = String(m.mealType || "").toLowerCase();
      return (
        title.includes(q) || notes.includes(q) || (type && type.includes(q))
      );
    });
  }, [todayMeals, searchQuery]);

  /* AI daily analysis – for selected day's totals */
  useEffect(() => {
    if (!nutritionGoal) return setAnalysis("");
    const hasAny =
      todayTotals.calories ||
      todayTotals.protein ||
      todayTotals.carbs ||
      todayTotals.fat;

    if (!hasAny) return setAnalysis("");
    if (!API_URL) return;

    let cancelled = false;
    const run = async () => {
      try {
        setAnalysisLoading(true);

        const res = await fetch(`${API_URL}/nutrition/analyse-day`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totals: todayTotals, goal: nutritionGoal }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (!cancelled) setAnalysis(data.analysis || "");
      } catch {
        if (!cancelled) setAnalysis("");
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    };

    run();
    return () => (cancelled = true);
  }, [nutritionGoal, todayTotals]);

  /* AI food quality for selected day */
  useEffect(() => {
    if (!nutritionGoal) {
      setFoodQuality(null);
      return;
    }

    if (!todayMeals.length) {
      setFoodQuality(null);
      return;
    }

    if (!API_URL) return;

    let cancelled = false;

    const run = async () => {
      try {
        setFoodQualityLoading(true);

        const res = await fetch(`${API_URL}/nutrition/food-quality`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: nutritionGoal,
            totals: todayTotals,
            meals: todayMeals,
          }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (!cancelled) {
          setFoodQuality(data);
        }
      } catch {
        if (!cancelled) setFoodQuality(null);
      } finally {
        if (!cancelled) setFoodQualityLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [nutritionGoal, todayTotals, todayMeals]);

  /* ✅ AI training match for selected day — time-of-day aware */
  useEffect(() => {
    if (!nutritionGoal) {
      setTrainingMatch(null);
      return;
    }
    if (!todayMeals.length) {
      setTrainingMatch(null);
      return;
    }

    const now = new Date();
    const cutoff = isSameDay(startOfDay(selectedDate), now) ? now : endOfDay(selectedDate);
    const pctDay = dayProgressPct(selectedDate);
    const coverage = coverageSummary(todayMeals, cutoff);

    let cancelled = false;

    const run = async () => {
      try {
        if (!API_URL) {
          const fb = fallbackTrainingMatch({
            totals: todayTotals,
            goal: nutritionGoal,
            foodQuality,
            selectedDate,
          });
          if (!cancelled) {
            setTrainingMatch({
              ...fb,
              cutoffLabel: isSameDay(startOfDay(selectedDate), now)
                ? `So far (${formatClock(cutoff)})`
                : "Full day",
              dayPct: pctDay,
              coverage,
            });
          }
          return;
        }

        setTrainingMatchLoading(true);

        const res = await fetch(`${API_URL}/nutrition/training-match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: selectedDate.toISOString(),
            nowISO: cutoff.toISOString(),
            dayProgressPct: pctDay,
            goal: nutritionGoal,
            totals: todayTotals,
            meals: todayMeals,
            mealTiming: {
              cutoffISO: cutoff.toISOString(),
              coverageParts: coverage.parts,
              filledParts: coverage.filled,
              mealsLoggedSoFar: coverage.counted,
            },
            foodQuality,
          }),
        });

        if (!res.ok) throw new Error("fallback");

        const data = await res.json();

        if (!cancelled) {
          setTrainingMatch({
            grade: data.grade ?? data.fuelGrade ?? "—",
            dayType:
              data.dayType ??
              (isSameDay(startOfDay(selectedDate), now)
                ? `So far (${formatClock(cutoff)})`
                : "That day"),
            summary: data.summary ?? "",
            tips: Array.isArray(data.tips) ? data.tips : [],
            timeMeta: data.timeMeta ?? "",
            cutoffLabel: isSameDay(startOfDay(selectedDate), now)
              ? `So far (${formatClock(cutoff)})`
              : "Full day",
            dayPct: pctDay,
            coverage,
          });
        }
      } catch {
        if (!cancelled) {
          const fb = fallbackTrainingMatch({
            totals: todayTotals,
            goal: nutritionGoal,
            foodQuality,
            selectedDate,
          });
          setTrainingMatch({
            ...fb,
            cutoffLabel: isSameDay(startOfDay(selectedDate), new Date())
              ? `So far (${formatClock(new Date())})`
              : "Full day",
            dayPct: pctDay,
            coverage,
          });
        }
      } finally {
        if (!cancelled) setTrainingMatchLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [nutritionGoal, todayTotals, todayMeals, selectedDate, foodQuality]);

  /* load 7-day stats for summary chip & nutrition score */
  const loadWeek = useCallback(async () => {
    if (!user) return;

    const since = startOfDay(daysAgo(6));
    const mealsRef = collection(db, "users", user.uid, "meals");
    const qMeals = query(
      mealsRef,
      where("date", ">=", Timestamp.fromDate(since)),
      orderBy("date", "desc")
    );

    const snap = await getDocs(qMeals);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const byDay = {};
    rows.forEach((m) => {
      const d = m.date?.toDate?.() || new Date(m.date);
      const key = d.toISOString().slice(0, 10);
      if (!byDay[key]) {
        byDay[key] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
      }
      byDay[key].calories += Number(m.calories || 0);
      byDay[key].protein += Number(m.protein || 0);
      byDay[key].carbs += Number(m.carbs || 0);
      byDay[key].fat += Number(m.fat || 0);
      byDay[key].meals += 1;
    });

    const days = Object.keys(byDay).sort();
    const total = days.reduce(
      (acc, k) => ({
        calories: acc.calories + byDay[k].calories,
        protein: acc.protein + byDay[k].protein,
        carbs: acc.carbs + byDay[k].carbs,
        fat: acc.fat + byDay[k].fat,
        days: acc.days + 1,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
    );

    const avg =
      total.days > 0
        ? {
            calories: Math.round(total.calories / total.days),
            protein: Math.round(total.protein / total.days),
            carbs: Math.round(total.carbs / total.days),
            fat: Math.round(total.fat / total.days),
          }
        : { calories: 0, protein: 0, carbs: 0, fat: 0 };

    setWeekStats({ byDay, days, avg, totalDays: total.days });
  }, [user]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const nutritionScore = useMemo(() => {
    if (!weekStats || !goalCals) return null;
    const diffRatio = Math.abs(weekStats.avg.calories - goalCals) / goalCals;
    let grade = "C";
    let desc = "Big swings vs your calorie target.";
    if (diffRatio <= 0.08) {
      grade = "A";
      desc = "Dialled in — very close to your target on average.";
    } else if (diffRatio <= 0.15) {
      grade = "B";
      desc = "Pretty close to your target, with some day-to-day variation.";
    }
    return { grade, desc, diffPercent: Math.round(diffRatio * 100) };
  }, [weekStats, goalCals]);

  // ---- nutrition score for selected day ----
  const todayScore = useMemo(() => {
    if (!nutritionGoal || !goalCals) return null;
    if (!todayTotals.calories) return null;

    const diffRatio = Math.abs(todayTotals.calories - goalCals) / goalCals;

    let grade = "C";
    if (diffRatio <= 0.08) grade = "A";
    else if (diffRatio <= 0.15) grade = "B";
    else if (diffRatio > 0.3) grade = "D";

    let summary = "";
    if (diffRatio <= 0.08) summary = "You’re right on track with calories for this day.";
    else if (diffRatio <= 0.15) summary = "You’re close to the calorie target for this day.";
    else if (todayTotals.calories < goalCals) summary = "You’re well under the calorie target for this day.";
    else summary = "You’ve gone over the calorie target for this day.";

    return { grade, summary };
  }, [nutritionGoal, goalCals, todayTotals.calories]);

  /* barcode scan — placeholder route for now */
  const handleScanBarcode = useCallback(() => {
    router.push("/nutrition/barcode");
  }, [router]);

  /* meal scan */
  const handleScanMeal = useCallback(async () => {
    if (scanning) return;
    if (!API_URL)
      return Alert.alert("Config error", "EXPO_PUBLIC_API_URL missing in .env");

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted")
      return Alert.alert("Camera required", "Please enable camera access.");

    try {
      setScanning(true);

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const res = await fetch(`${API_URL}/nutrition/estimate-macros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: result.assets[0].base64 }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const {
        title = "Meal",
        calories = 0,
        protein = 0,
        carbs = 0,
        fat = 0,
        notes = "",
      } = data;

      Alert.alert(title, `${Math.round(calories)} kcal`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: () => {
            router.push({
              pathname: "/nutrition/add",
              params: {
                title,
                calories: String(Math.round(calories)),
                protein: String(Math.round(protein)),
                carbs: String(Math.round(carbs)),
                fat: String(Math.round(fat)),
                notes,
                fromScan: "1",
                date: selectedDate.toISOString(),
              },
            });
          },
        },
      ]);
    } catch (err) {
      Alert.alert("Scan failed", err?.message || "Could not scan meal.");
    } finally {
      setScanning(false);
    }
  }, [scanning, router, selectedDate]);

  /* quick log -> save meal on selected day */
  const handleQuickLog = useCallback(async () => {
    if (quickLoading || !quickText.trim()) return;
    if (!API_URL) return Alert.alert("Error", "API URL missing from env.");
    if (!user) return Alert.alert("Error", "Please sign in again.");

    try {
      setQuickLoading(true);

      const res = await fetch(`${API_URL}/nutrition/describe-meal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: quickText.trim() }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const {
        title = quickText,
        calories = 0,
        protein = 0,
        carbs = 0,
        fat = 0,
        fibre,
        fiber,
        sugar,
        sodium,
        notes = "",
      } = data;

      const finalTitle = quickMealType ? `${quickMealType}: ${title}` : title;

      const base = startOfDay(selectedDate);
      const now = new Date();
      base.setHours(
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
      );
      const dateTs = Timestamp.fromDate(base);

      await addDoc(collection(db, "users", user.uid, "meals"), {
        title: finalTitle,
        mealType: quickMealType || "Unspecified",
        calories: Number(calories) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
        fibre: Number(fibre ?? fiber ?? 0) || 0,
        sugar: Number(sugar || 0) || 0,
        sodium: Number(sodium || 0) || 0,
        notes:
          notes ||
          `Quick log: ${quickText}${quickMealType ? ` (${quickMealType})` : ""}`,
        source: "chat",
        date: dateTs,
        createdAt: serverTimestamp(),
      });

      setQuickText("");
    } catch (err) {
      Alert.alert("Could not log meal", err?.message || "Please try again.");
    } finally {
      setQuickLoading(false);
    }
  }, [quickText, quickLoading, user, quickMealType, selectedDate]);

  /* row renderer */
  const renderMealRow = (item) => {
    const icon = mealTypeIcon(item?.mealType);

    return (
      <TouchableOpacity
        key={item.id}
        style={s.mealRow}
        onPress={() =>
          router.push({
            pathname: `/nutrition/${item.id}`,
            params: {
              fromDate: selectedDate.toISOString(),
              scrollY: String(scrollYRef.current || 0),
            },
          })
        }
        activeOpacity={0.7}
      >
        <View style={s.mealTypeIconWrap}>
          <Feather name={icon} size={14} color={accentText} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.mealTitle}>
            {item.mealType ? `${item.mealType} · ${item.title}` : item.title}
          </Text>

          <Text style={s.mealMacros} numberOfLines={1}>
            P {Math.round(item.protein || 0)} g · C {Math.round(item.carbs || 0)} g
            · F {Math.round(item.fat || 0)} g
          </Text>

          {item.notes ? (
            <Text style={s.mealNotes} numberOfLines={1}>
              {item.notes}
            </Text>
          ) : null}
        </View>

        <View style={s.mealRightCol}>
          <Text style={s.mealKcal}>{Math.round(item.calories)} kcal</Text>
          <Feather name="chevron-right" size={16} color={colors.subtext} />
        </View>
      </TouchableOpacity>
    );
  };

  /* ---------------------------------------- */

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <LinearGradient
        colors={[topFadeStart, colors.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topBackgroundFade}
        pointerEvents="none"
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={s.page}>
          {/* HEADER + DAY NAV */}
          <View style={s.header}>
            {/* ✅ Title row with top-right share */}
            <View style={s.headerTopRow}>
              <Text style={s.headerTitle}>Nutrition</Text>

              <TouchableOpacity
                onPress={() => router.push("/nutrition/nutrition-list")}
                style={s.iconButtonGhost}
                activeOpacity={0.8}
              >
                <Feather name="share-2" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.headerTagline}>
              Daily fuel, macros, and coaching in one place.
            </Text>

            {/* Day selector (copied from Train layout pattern) */}
            <View style={s.dayNavCard}>
              {daySliderItems.map((item) => {
                const dayKey = item.date.toISOString().slice(0, 10);
                const hasMeals = Number(weekStats?.byDay?.[dayKey]?.meals || 0) > 0;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setSelectedDay(item.date)}
                    activeOpacity={0.85}
                    style={s.daySliderChip}
                  >
                    <Text
                      style={[
                        s.daySliderDow,
                        {
                          color: item.isSelected || item.isToday ? colors.text : colors.subtext,
                          opacity: !item.isSelected && !item.isToday && !hasMeals ? 0.7 : 1,
                        },
                      ]}
                    >
                      {item.dow}
                    </Text>

                    <View
                      style={[
                        s.daySliderDateWrap,
                        item.isSelected
                          ? { backgroundColor: accentBg, borderColor: accentBg }
                          : {
                              backgroundColor: hasMeals ? (colors.card || "#FFFFFF") : "transparent",
                              borderColor: hasMeals || item.isToday ? silverMed : "transparent",
                            },
                      ]}
                    >
                      <Text
                        style={[
                          s.daySliderDate,
                          {
                            color: item.isSelected
                              ? "#111111"
                              : !hasMeals
                                ? colors.subtext
                                : colors.text,
                          },
                        ]}
                      >
                        {item.day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.headerMetaRow}>
              <View
                style={[
                  s.headerMetaPill,
                  nutritionGoal ? s.headerMetaPillGood : s.headerMetaPillWarn,
                ]}
              >
                <Feather
                  name={nutritionGoal ? "check-circle" : "alert-circle"}
                  size={13}
                  color={nutritionGoal ? "#0f5132" : "#7f1d1d"}
                />
                <Text style={s.headerMetaPillText}>
                  {nutritionGoal ? "Goal configured" : "Goal required"}
                </Text>
              </View>

              <View style={s.headerMetaPill}>
                <Feather name="list" size={13} color={colors.subtext} />
                <Text style={s.headerMetaPillText}>
                  {todayMeals.length} meal{todayMeals.length === 1 ? "" : "s"}{" "}
                  {isTodaySelected ? "today" : "logged"}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              s.scrollContent,
              keyboardVisible && { paddingBottom: FOOTER_OFFSET },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            onScroll={(e) => {
              scrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            {/* NUTRITION GOAL + SLIDER */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>Daily goal</Text>
                <TouchableOpacity
                  onPress={() => router.push("/nutrition/goal")}
                  style={s.sectionEdit}
                >
                  <Feather
                    name={nutritionGoal ? "edit-2" : "plus-circle"}
                    size={14}
                    color={accentText}
                  />
                  <Text style={s.sectionEditText}>
                    {nutritionGoal ? "Edit" : "Set"}
                  </Text>
                </TouchableOpacity>
              </View>

              {goalLoading ? (
                <ActivityIndicator />
              ) : !nutritionGoal ? (
                <Text style={s.emptySmall}>
                  No goal set yet — tap set to create one.
                </Text>
              ) : (
                <View style={s.goalCarouselContainer}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={CARD_SNAP_INTERVAL}
                    snapToAlignment="start"
                    disableIntervalMomentum
                    decelerationRate="fast"
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      const x = e.nativeEvent.contentOffset.x;
                      const idx = Math.max(
                        0,
                        Math.min(2, Math.round(x / CARD_SNAP_INTERVAL))
                      );
                      setGoalSlideIndex(idx);
                    }}
                  >
                    {/* Slide 0 — calories vs goal */}
                    <View style={[s.goalSlideCard, { width: CARD_WIDTH }]}>
                      <Text style={s.goalSlideTitle}>Calories</Text>
                      <Text style={s.goalSlideNumber}>
                        {Math.round(todayTotals.calories)} /{" "}
                        {Math.round(goalCals)}{" "}
                        <Text style={s.goalSlideNumberUnit}>kcal</Text>
                      </Text>
                      <Text style={s.goalSlideSub}>
                        Left: {remaining ? `${remaining.calories} kcal` : "-"}
                      </Text>

                      {todayScore && (
                        <View style={s.todayScoreRow}>
                          <View style={s.todayScoreBadge}>
                            <Text style={s.todayScoreBadgeText}>
                              {todayScore.grade}
                            </Text>
                          </View>
                          <Text style={s.todayScoreText}>
                            {todayScore.summary}
                          </Text>
                        </View>
                      )}

                      <TouchableOpacity
                        onPress={() => router.push("/nutrition/today")}
                        activeOpacity={0.8}
                        style={s.goalSlideLink}
                      >
                        <Text style={s.goalSlideLinkText}>
                          View detailed breakdown
                        </Text>
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={accentText}
                        />
                      </TouchableOpacity>
                    </View>

                    {/* Slide 1 — macros */}
                    <View style={[s.goalSlideCard, { width: CARD_WIDTH }]}>
                      <Text style={s.goalSlideTitle}>Macros</Text>

                      <View style={s.goalMacroRow}>
                        <MacroLine
                          label="Protein"
                          eaten={todayTotals.protein}
                          target={macroTargets.protein}
                          unit="g"
                          colors={colors}
                          isDark={isDark}
                          accentBg={accentBg}
                        />
                        <MacroLine
                          label="Carbs"
                          eaten={todayTotals.carbs}
                          target={macroTargets.carbs}
                          unit="g"
                          colors={colors}
                          isDark={isDark}
                          accentBg={accentBg}
                        />
                        <MacroLine
                          label="Fat"
                          eaten={todayTotals.fat}
                          target={macroTargets.fat}
                          unit="g"
                          colors={colors}
                          isDark={isDark}
                          accentBg={accentBg}
                        />
                      </View>

                      {remaining && (
                        <Text style={s.goalSlideSub}>
                          Left — P {remaining.protein} g · C {remaining.carbs} g
                          · F {remaining.fat} g
                        </Text>
                      )}
                    </View>

                    {/* Slide 2 — food quality (AI) */}
                    <View style={[s.goalSlideCard, { width: CARD_WIDTH }]}>
                      <Text style={s.goalSlideTitle}>Food quality</Text>

                      {foodQualityLoading ? (
                        <ActivityIndicator />
                      ) : !todayMeals.length ? (
                        <Text style={s.goalSlideSub}>
                          Log at least one meal to see food quality for this day.
                        </Text>
                      ) : foodQuality ? (
                        <>
                          <View style={s.todayScoreRow}>
                            <View style={s.todayScoreBadge}>
                              <Text style={s.todayScoreBadgeText}>
                                {foodQuality.grade}
                              </Text>
                            </View>
                            <Text style={s.foodQualitySummary}>
                              {foodQuality.summary}
                            </Text>
                          </View>

                          {foodQuality.detail ? (
                            <Text style={s.foodQualityDetail}>
                              {foodQuality.detail}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={s.goalSlideSub}>
                          Couldn’t load food quality. It’ll refresh next time you
                          open this screen.
                        </Text>
                      )}

                      <TouchableOpacity
                        onPress={() =>
                          router.push({
                            pathname: "/nutrition/food-quality",
                            params: { date: selectedDate.toISOString() },
                          })
                        }
                        activeOpacity={0.8}
                        style={s.goalSlideLink}
                      >
                        <Text style={s.goalSlideLinkText}>
                          View detailed breakdown
                        </Text>
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={accentText}
                        />
                      </TouchableOpacity>
                    </View>
                  </ScrollView>

                  {/* dots */}
                  <View style={s.dotRow}>
                    {[0, 1, 2].map((idx) => (
                      <View
                        key={idx}
                        style={[s.dot, goalSlideIndex === idx && s.dotActive]}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* EMPTY-STATE CTA WHEN NO GOAL */}
            {!goalLoading && !nutritionGoal && (
              <View style={s.goalEmptyWrapper}>
                <Text style={s.goalEmptyTitle}>
                  Set your goal to unlock nutrition tracking
                </Text>
                <Text style={s.goalEmptyText}>
                  Create a daily calorie and macro target, then log meals and
                  get AI feedback tailored to your plan.
                </Text>

                <TouchableOpacity
                  style={s.goalEmptyButton}
                  onPress={() => router.push("/nutrition/goal")}
                  activeOpacity={0.9}
                >
                  <Text style={s.goalEmptyButtonText}>
                    Set goal & nutrition plan
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* MAIN CONTENT — ONLY WHEN GOAL IS SET */}
            {nutritionGoal && (
              <>
                {/* ACTION BUTTONS */}
                <View style={s.actionRow}>
                  {/* + Add meal */}
                  <TouchableOpacity
                    style={s.actionPrimary}
                    onPress={() =>
                      router.push({
                        pathname: "/nutrition/add",
                        params: { date: selectedDate.toISOString() },
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Feather name="plus" size={18} color="#111111" />
                    <Text style={s.actionPrimaryText}>Add meal</Text>
                  </TouchableOpacity>

                  {/* Scan barcode */}
                  <TouchableOpacity
                    onPress={handleScanBarcode}
                    style={s.actionScan}
                    activeOpacity={0.8}
                  >
                    <Feather name="maximize" size={18} color={accentText} />
                  </TouchableOpacity>

                  {/* Photo scan */}
                  <TouchableOpacity
                    onPress={handleScanMeal}
                    style={s.actionScan}
                    activeOpacity={0.8}
                    disabled={scanning}
                  >
                    {scanning ? (
                      <ActivityIndicator color={accentText} />
                    ) : (
                      <Feather name="camera" size={18} color={accentText} />
                    )}
                  </TouchableOpacity>
                </View>

                {/* INSIGHTS SLIDER */}
                <View style={s.section}>
                  <View style={s.sectionHeader}>
                    <Text style={s.sectionTitle}>Insights</Text>
                  </View>

                  <View style={s.insightsCarouselContainer}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      snapToInterval={CARD_SNAP_INTERVAL}
                      snapToAlignment="start"
                      disableIntervalMomentum
                      decelerationRate="fast"
                      scrollEventThrottle={16}
                      onScroll={(e) => {
                        const x = e.nativeEvent.contentOffset.x;
                        const idx = Math.max(
                          0,
                          Math.min(2, Math.round(x / CARD_SNAP_INTERVAL))
                        );
                        setInsightSlideIndex(idx);
                      }}
                    >
                      {/* Slide 0 — Weight card */}
                      <View style={[s.insightCard, { width: CARD_WIDTH }]}>
                        <Text style={s.insightTitle}>Weight trend</Text>
                        <Text style={s.insightSubtitle}>
                          Log your weight to see a graph of your long-term
                          progress. Open the weight screen to add entries.
                        </Text>

                        <TouchableOpacity
                          style={s.insightButton}
                          activeOpacity={0.85}
                          onPress={() => router.push("/nutrition/weight")}
                        >
                          <Text style={s.insightButtonText}>
                            Open weight tracking
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Slide 1 — Nutrition score */}
                      <View style={[s.insightCard, { width: CARD_WIDTH }]}>
                        <Text style={s.insightTitle}>Nutrition score</Text>

                        {nutritionScore ? (
                          <View style={s.scoreRow}>
                            <View style={s.scoreBadgeWrap}>
                              <Text style={s.scoreBadgeText}>
                                {nutritionScore.grade}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.insightSubtitle}>
                                {nutritionScore.desc}
                              </Text>
                              <Text style={s.insightMeta}>
                                Avg kcal is about {nutritionScore.diffPercent}%
                                away from your target.
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={s.insightSubtitle}>
                            Log a few more days of meals to see a simple nutrition
                            score here.
                          </Text>
                        )}

                        <View style={s.insightLinksRow}>
                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() => router.push("/nutrition/streaks")}
                          >
                            <Text style={s.insightPillText}>View streaks</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() => router.push("/nutrition/week")}
                          >
                            <Text style={s.insightPillText}>View trends</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* ✅ Slide 2 — Training fuel match (time-of-day aware) */}
                      <View style={[s.insightCard, { width: CARD_WIDTH }]}>
                        <Text style={s.insightTitle}>Training fuel match</Text>

                        {trainingMatchLoading ? (
                          <ActivityIndicator />
                        ) : !todayMeals.length ? (
                          <Text style={s.insightSubtitle}>
                            Log at least one meal to check whether your fuel
                            matches your training day.
                          </Text>
                        ) : trainingMatch ? (
                          <>
                            <View style={s.scoreRow}>
                              <View style={s.scoreBadgeWrap}>
                                <Text style={s.scoreBadgeText}>
                                  {String(trainingMatch.grade || "—")}
                                </Text>
                              </View>

                              <View style={{ flex: 1 }}>
                                <View style={s.trainingTagRow}>
                                  <View style={s.trainingTag}>
                                    <Text style={s.trainingTagText}>
                                      {String(trainingMatch.dayType || "So far")}
                                    </Text>
                                  </View>

                                  {foodQuality?.grade ? (
                                    <View style={s.trainingTagSoft}>
                                      <Text style={s.trainingTagSoftText}>
                                        Quality: {String(foodQuality.grade)}
                                      </Text>
                                    </View>
                                  ) : null}

                                  {trainingMatch?.coverage?.filled?.length ? (
                                    <View style={s.trainingTagSoft}>
                                      <Text style={s.trainingTagSoftText}>
                                        Logged:{" "}
                                        {trainingMatch.coverage.filled.join(
                                          " · "
                                        )}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>

                                <Text style={s.insightSubtitle}>
                                  {trainingMatch.summary || "—"}
                                </Text>

                                {!!trainingMatch.timeMeta && (
                                  <Text style={s.insightMeta}>
                                    {trainingMatch.timeMeta}
                                  </Text>
                                )}
                              </View>
                            </View>

                            {Array.isArray(trainingMatch.tips) &&
                            trainingMatch.tips.length ? (
                              <View style={{ marginTop: 8 }}>
                                {trainingMatch.tips.slice(0, 4).map((t, i) => (
                                  <View
                                    key={`${i}-${t}`}
                                    style={s.bulletRow}
                                  >
                                    <View style={s.bulletDot} />
                                    <Text style={s.bulletText}>{t}</Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </>
                        ) : (
                          <Text style={s.insightSubtitle}>
                            Couldn’t load this insight. It’ll refresh next time
                            you open this screen.
                          </Text>
                        )}

                        <View style={s.insightLinksRow}>
                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() =>
                              router.push({
                                pathname: "/nutrition/food-quality",
                                params: { date: selectedDate.toISOString() },
                              })
                            }
                          >
                            <Text style={s.insightPillText}>Improve quality</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() => router.push("/nutrition/today")}
                          >
                            <Text style={s.insightPillText}>See breakdown</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </ScrollView>

                    <View style={s.dotRow}>
                      {[0, 1, 2].map((idx) => (
                        <View
                          key={idx}
                          style={[
                            s.dot,
                            insightSlideIndex === idx && s.dotActive,
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                </View>

                {/* QUICK LOG */}
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Quick Log</Text>

                  <View style={s.quickLogCard}>
                    <View style={s.segmentRow}>
                      {["Breakfast", "Lunch", "Dinner", "Snack"].map((mt) => {
                        const active = quickMealType === mt;
                        return (
                          <TouchableOpacity
                            key={mt}
                            onPress={() => setQuickMealType(active ? "" : mt)}
                            style={[s.segment, active && s.segmentActive]}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                s.segmentText,
                                active && s.segmentTextActive,
                              ]}
                            >
                              {mt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <View style={s.quickBox}>
                      <TextInput
                        placeholder="Type what you had…"
                        placeholderTextColor={colors.subtext}
                        value={quickText}
                        onChangeText={setQuickText}
                        style={s.quickInput}
                        multiline
                        keyboardAppearance={isDark ? "dark" : "light"}
                        blurOnSubmit={false}
                      />

                      <TouchableOpacity
                        style={s.quickSend}
                        onPress={handleQuickLog}
                        disabled={!quickText.trim() || quickLoading}
                      >
                        {quickLoading ? (
                          <ActivityIndicator color="#111111" />
                        ) : (
                          <Feather name="arrow-up" size={16} color="#111111" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* TODAY / SELECTED DAY */}
                <View style={s.section}>
                  <View style={s.sectionHeader}>
                    <Text style={s.sectionTitle}>Intake for the day</Text>
                  </View>

                  <View style={s.intakeCard}>
                    <View style={s.macroRow}>
                      <Chip
                        label="Calories"
                        value={`${todayTotals.calories} kcal`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                      <Chip
                        label="Protein"
                        value={`${todayTotals.protein} g`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                      <Chip
                        label="Carbs"
                        value={`${todayTotals.carbs} g`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                      <Chip
                        label="Fat"
                        value={`${todayTotals.fat} g`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                    </View>

                    {analysisLoading ? (
                      <ActivityIndicator style={{ marginTop: 10 }} />
                    ) : !!analysis ? (
                      <View style={s.coachNote}>
                        <Text style={s.coachTitle}>Coach note</Text>
                        <Text style={s.coachText}>{analysis}</Text>
                      </View>
                    ) : null}

                    <View style={s.searchBox}>
                      <Feather name="search" size={16} color={colors.subtext} />
                      <TextInput
                        style={s.searchInput}
                        placeholder="Search this day’s meals…"
                        placeholderTextColor={colors.subtext}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        returnKeyType="search"
                        keyboardAppearance={isDark ? "dark" : "light"}
                      />
                      {searchQuery ? (
                        <TouchableOpacity
                          onPress={() => setSearchQuery("")}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Feather
                            name="x-circle"
                            size={16}
                            color={colors.subtext}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {loading ? (
                      <ActivityIndicator />
                    ) : filteredMeals.length === 0 ? (
                      <Text style={s.empty}>
                        {searchQuery
                          ? "No meals match your search."
                          : "No meals logged for this day."}
                      </Text>
                    ) : (
                      filteredMeals.map((m) => (
                        <View key={m.id} style={s.sectionRowWrapper}>
                          {renderMealRow(m)}
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- small UI bits ---------------- */

function Mini({ label, value, colors }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontWeight: "700", color: colors.text }}>
        {String(value)}
      </Text>
      <Text style={{ fontSize: 12, color: colors.subtext }}>{label}</Text>
    </View>
  );
}

function Chip({ label, value, colors, silverLight, silverMed }) {
  const labelColor = colors?.subtextSoft || colors?.subtext || colors?.text || "#9CA3AF";
  const valueColor = colors?.text || "#E5E7EB";

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        backgroundColor: silverLight,
        paddingHorizontal: 6,
        paddingVertical: 7,
        borderRadius: 12,
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: silverMed,
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={{
          color: labelColor,
          fontSize: 10,
          fontWeight: "800",
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={{ color: valueColor, fontWeight: "700", fontSize: 11 }}
      >
        {value}
      </Text>
    </View>
  );
}

function MacroLine({ label, eaten, target, unit, colors, isDark, accentBg }) {
  const safeTarget = target || 0;
  const pct = safeTarget ? Math.min(1, eaten / safeTarget) : 0;

  return (
    <View style={{ marginBottom: 8 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: 2,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: colors.subtext }}>
          {Math.round(eaten)} / {Math.round(safeTarget)} {unit}
        </Text>
      </View>

      <View
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: isDark
            ? colors.border
            : colors.borderStrong ?? "#D1D5DB",
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        <View
          style={{
            width: `${Math.round(pct * 100)}%`,
            backgroundColor: accentBg,
          }}
        />
      </View>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? "#12141A" : "#F6F7FA";
  const panelBg = isDark ? "#0B0E14" : "#FFFFFF";
  const borderSoft = isDark ? "rgba(255,255,255,0.11)" : silverMed;
  const borderHard = isDark ? "rgba(255,255,255,0.16)" : "#D5D9E1";

  const shadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.26,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      };

  const softShadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 5 },
        elevation: 2,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    topBackgroundFade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 280,
    },
    page: { flex: 1, paddingHorizontal: 18 },
    scrollContent: { paddingBottom: FOOTER_OFFSET + 70, flexGrow: 1 },

    /* HEADER */
    header: { marginTop: 6, marginBottom: 10 },

    /* ✅ title row w/ share on the right */
    headerTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 4,
    },

    headerTitle: {
      fontSize: 31,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: colors.text,
      flex: 1,
    },

    headerTagline: {
      marginTop: 2,
      marginBottom: 12,
      color: colors.subtext,
      fontSize: 13,
      fontWeight: "600",
      lineHeight: 18,
    },

    /* ✅ ghost icon button for header */
    iconButtonGhost: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },

    dayNavCard: {
      marginTop: 12,
      marginBottom: 2,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 2,
    },
    daySliderChip: {
      flex: 1,
      alignItems: "center",
      gap: 7,
      minWidth: 44,
    },
    daySliderDow: {
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.6,
    },
    daySliderDateWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: "center",
      justifyContent: "center",
    },
    daySliderDate: {
      fontSize: 18,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    headerMetaRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    headerMetaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    headerMetaPillGood: {
      backgroundColor: isDark ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.12)",
      borderColor: isDark ? "rgba(34,197,94,0.38)" : "rgba(34,197,94,0.35)",
    },
    headerMetaPillWarn: {
      backgroundColor: isDark ? "rgba(248,113,113,0.18)" : "rgba(248,113,113,0.12)",
      borderColor: isDark ? "rgba(248,113,113,0.40)" : "rgba(248,113,113,0.36)",
    },
    headerMetaPillText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.2,
    },

    /* ACTION BUTTONS */
    actionRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
    actionPrimary: {
      backgroundColor: accentBg,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
      ...shadow,
    },
    actionPrimaryText: {
      color: "#111111",
      fontWeight: "800",
      fontSize: 13,
      letterSpacing: 0.2,
    },
    actionScan: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: panelBg,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...softShadow,
    },

    /* SECTIONS */
    section: { marginBottom: 22 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10, alignItems: "center" },
    sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text, letterSpacing: 0.2 },
    sectionEdit: { flexDirection: "row", alignItems: "center", gap: 6 },
    sectionEditText: { fontSize: 12, color: accentText, fontWeight: "800", letterSpacing: 0.2 },

    /* DAILY GOAL CAROUSEL */
    goalCarouselContainer: { marginTop: 6 },
    goalSlideCard: {
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginRight: CARD_GAP,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    goalSlideTitle: { fontSize: 11, fontWeight: "800", color: colors.subtext, textTransform: "uppercase", letterSpacing: 1.0, marginBottom: 6 },
    goalSlideNumber: { fontSize: 26, fontWeight: "900", color: colors.text, marginBottom: 6 },
    goalSlideNumberUnit: { fontSize: 14, fontWeight: "700", color: colors.subtext },
    goalSlideSub: { fontSize: 13, color: colors.subtext, marginTop: 2, marginBottom: 8, lineHeight: 18 },
    goalSlideLink: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 },
    goalSlideLinkText: { fontSize: 13, color: accentText, fontWeight: "800" },
    goalMacroRow: { marginTop: 4 },

    /* EMPTY-STATE CTA FOR GOAL */
    goalEmptyWrapper: {
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 18,
      marginTop: 4,
      marginBottom: 22,
      borderRadius: 18,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...shadow,
    },
    goalEmptyTitle: { fontSize: 17, fontWeight: "800", color: colors.text, textAlign: "center", marginBottom: 10, letterSpacing: 0.1 },
    goalEmptyText: { fontSize: 13, color: colors.subtext, textAlign: "center", marginBottom: 16, lineHeight: 19, fontWeight: "600" },
    goalEmptyButton: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: accentBg, alignItems: "center", justifyContent: "center", minWidth: 210, ...softShadow },
    goalEmptyButtonText: { color: "#111111", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },

    /* INSIGHTS CAROUSEL */
    insightsCarouselContainer: { marginTop: 6 },
    insightCard: {
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginRight: CARD_GAP,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...shadow,
    },
    insightTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 8, letterSpacing: 0.2 },
    insightSubtitle: { fontSize: 13, color: colors.subtext, lineHeight: 18, marginBottom: 10 },
    insightButton: { marginTop: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: accentBg, alignSelf: "flex-start", ...softShadow },
    insightButtonText: { color: "#111111", fontWeight: "800", fontSize: 13, letterSpacing: 0.2 },
    insightLinksRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
    insightPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: borderSoft, ...softShadow },
    insightPillText: { fontSize: 12, fontWeight: "800", color: colors.text },
    insightMeta: { fontSize: 11, color: colors.subtext, marginTop: 6 },

    scoreRow: { flexDirection: "row", gap: 10, alignItems: "center" },
    scoreBadgeWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: accentBg, alignItems: "center", justifyContent: "center", ...softShadow },
    scoreBadgeText: { color: "#111111", fontWeight: "900", fontSize: 18 },

    trainingTagRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
    trainingTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: accentBg, ...softShadow },
    trainingTagText: { color: "#111111", fontWeight: "900", fontSize: 12, letterSpacing: 0.2 },
    trainingTagSoft: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: borderSoft },
    trainingTagSoftText: { color: colors.text, fontWeight: "800", fontSize: 12 },

    bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 6 },
    bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: accentBg, marginTop: 7 },
    bulletText: { flex: 1, fontSize: 12, color: colors.subtext, lineHeight: 18, fontWeight: "600" },

    /* carousel dots */
    dotRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 12 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: isDark ? "#2A2D36" : "#D6D9E0" },
    dotActive: { width: 18, height: 6, borderRadius: 3, backgroundColor: accentBg },

    /* MACROS */
    macroRow: {
      flexDirection: "row",
      flexWrap: "nowrap",
      gap: 6,
      marginTop: 0,
      marginBottom: 2,
    },

    /* QUICK LOG */
    quickLogCard: {
      backgroundColor: cardBg,
      borderRadius: 16,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...shadow,
    },
    quickBox: {
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderHard,
      ...softShadow,
    },
    quickInput: { flex: 1, color: colors.text, fontSize: 15, padding: 0, lineHeight: 20, minHeight: 32, maxHeight: 120 },
    quickSend: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: accentBg,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
      ...softShadow,
    },

    segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    segment: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: borderSoft, backgroundColor: panelBg, ...softShadow },
    segmentActive: { backgroundColor: accentBg, borderColor: accentBg },
    segmentText: { fontSize: 13, color: colors.text, fontWeight: "700" },
    segmentTextActive: { color: "#111111", fontWeight: "900" },

    /* SEARCH */
    searchBox: { marginTop: 14, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: borderHard, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: panelBg, ...softShadow },
    searchInput: { flex: 1, color: colors.text, paddingVertical: 0, fontSize: 14, fontWeight: "600" },

    intakeCard: {
      backgroundColor: "transparent",
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: 0,
      borderColor: "transparent",
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },

    /* DAY MEALS */
    sectionRowWrapper: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: borderSoft },
    mealRow: { paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    mealTypeIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: isDark ? "rgba(230,255,59,0.13)" : "rgba(230,255,59,0.20)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.35)" : "rgba(122,143,0,0.30)",
      alignItems: "center",
      justifyContent: "center",
    },
    mealTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 3 },
    mealMacros: { fontSize: 12, color: colors.subtext, marginBottom: 2 },
    mealNotes: { fontSize: 12, color: colors.subtext },
    mealRightCol: { alignItems: "flex-end", justifyContent: "center", gap: 4 },
    mealKcal: { fontWeight: "900", color: colors.text },

    /* COACH NOTE */
    coachNote: { backgroundColor: panelBg, padding: 12, borderRadius: 14, marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: borderHard, ...softShadow },
    coachTitle: { color: colors.subtext, fontSize: 11, fontWeight: "900", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
    coachText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "700" },

    /* EMPTY */
    empty: { color: colors.subtext, marginTop: 12, fontWeight: "600" },
    emptySmall: { color: colors.subtext, fontSize: 13, fontWeight: "600" },

    todayScoreRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
    todayScoreBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: accentBg, alignItems: "center", justifyContent: "center", ...softShadow },
    todayScoreBadgeText: { color: "#111111", fontWeight: "900", fontSize: 14 },
    todayScoreText: { flex: 1, fontSize: 13, color: colors.subtext, fontWeight: "600", lineHeight: 18 },

    foodQualitySummary: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18, fontWeight: "700" },
    foodQualityDetail: { marginTop: 6, fontSize: 12, color: colors.subtext, lineHeight: 18, fontWeight: "600" },
  });
}
