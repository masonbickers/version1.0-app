// app/(protected)/chat/page.jsx
"use client";

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useTheme } from "../../../providers/ThemeProvider";

import { onAuthStateChanged } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";

/* ---------------- palette ---------------- */
const BG = "#000000";
const TEXT = "#FFFFFF";
const SUBTEXT = "#8A8A8D";
const USER_BUBBLE_BG = "#1A1A1D";
const COACH_BUBBLE_BG = "#000000";
const PRIMARY = "#E6FF3B";

const FOOTER_OFFSET = 90;

// storage keys
const VISIBLE_CHAT_STORAGE_KEY = "trainr_coach_chat_visible_v1";
const MEMORY_CHAT_STORAGE_KEY = "trainr_coach_chat_memory_v1";

const INITIAL_SYSTEM_MESSAGE =
  "Hey, I'm your AI coach. I know your training plan and, when available, your nutrition goal and recent meals. I can help with running, Hyrox, strength, recovery, and fuelling. Ask me anything – from how to fuel, what to adjust if you have a niggle, to how to tweak your plan when life gets in the way.";

// ------------------------------------------------------
function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefinedDeep(v))
      .filter((v) => v !== undefined);
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = removeUndefinedDeep(val);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  if (value === undefined) return undefined;
  return value;
}

// date helpers
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}
function safeToDate(tsLike) {
  const d =
    tsLike?.toDate?.() ||
    (tsLike instanceof Date ? tsLike : new Date(tsLike));
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

// keep system message small (LLMs hate massive blobs)
function buildNutritionContextText(nutritionSummary) {
  if (!nutritionSummary) return "Nutrition context: none available.";

  const goal = nutritionSummary.goal;
  const today = nutritionSummary.today;
  const week = nutritionSummary.week;

  const goalLine = goal
    ? `Goal: ${Math.round(goal.dailyCalories || 0)} kcal • P ${Math.round(
        goal.proteinTarget || 0
      )}g • C ${Math.round(goal.carbTarget || 0)}g • F ${Math.round(
        goal.fatTarget || 0
      )}g`
    : "Goal: not set.";

  const todayLine = today?.totals
    ? `Today (${today.date}): ${Math.round(today.totals.calories || 0)} kcal • P ${Math.round(
        today.totals.protein || 0
      )}g • C ${Math.round(today.totals.carbs || 0)}g • F ${Math.round(
        today.totals.fat || 0
      )}g`
    : "Today: no totals.";

  const remainLine =
    today?.remaining && goal
      ? `Remaining today: ${Math.round(today.remaining.calories || 0)} kcal • P ${Math.round(
          today.remaining.protein || 0
        )}g • C ${Math.round(today.remaining.carbs || 0)}g • F ${Math.round(
          today.remaining.fat || 0
        )}g`
      : "";

  const weekLine = week?.avg
    ? `7-day avg: ${Math.round(week.avg.calories || 0)} kcal • P ${Math.round(
        week.avg.protein || 0
      )}g • C ${Math.round(week.avg.carbs || 0)}g • F ${Math.round(
        week.avg.fat || 0
      )}g (days logged: ${week.totalDays || 0})`
    : "7-day avg: none.";

  const scoreLine = week?.nutritionScore
    ? `Nutrition score: ${week.nutritionScore.grade} (${week.nutritionScore.desc})`
    : "";

  // last 8 meals only (compact)
  const meals = Array.isArray(nutritionSummary.recentMeals)
    ? nutritionSummary.recentMeals.slice(0, 8)
    : [];

  const mealsLines =
    meals.length > 0
      ? meals
          .map((m) => {
            const when = m.date ? m.date.slice(0, 16).replace("T", " ") : "";
            const type = m.mealType ? `${m.mealType} · ` : "";
            return `- ${when} | ${type}${m.title} (${Math.round(m.calories || 0)} kcal, P ${Math.round(
              m.protein || 0
            )}g C ${Math.round(m.carbs || 0)}g F ${Math.round(m.fat || 0)}g)`;
          })
          .join("\n")
      : "- No meals logged in last 7 days.";

  return [
    "Nutrition context (use this as truth):",
    goalLine,
    todayLine,
    remainLine,
    weekLine,
    scoreLine,
    "Recent meals:",
    mealsLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlanContextText(plan) {
  if (!plan) return "Plan context: none available.";
  const meta = plan?.meta || {};
  return [
    "Training plan context:",
    `Name: ${meta.name || plan.name || ""}`,
    `Primary: ${meta.primaryActivity || plan.primaryActivity || ""}`,
    `Event: ${meta.targetEventName || plan.targetEventName || ""} ${meta.targetEventDate || plan.targetEventDate || ""}`,
    `Focus: ${meta.goalPrimaryFocus || plan.goalPrimaryFocus || ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function CoachChatPage() {
  const { isDark } = useTheme();

  const [input, setInput] = useState("");

  const [messages, setMessages] = useState([
    { id: "welcome", role: "assistant", content: INITIAL_SYSTEM_MESSAGE },
  ]);

  const [memoryMessages, setMemoryMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [plan, setPlan] = useState(null);
  const [planDocId, setPlanDocId] = useState(null);

  const [nutritionSummary, setNutritionSummary] = useState(null);

  const [user, setUser] = useState(null);

  const scrollViewRef = useRef(null);
  const s = makeStyles();

  const scrollToEnd = () =>
    scrollViewRef.current?.scrollToEnd?.({ animated: true });

  useEffect(() => {
    scrollToEnd();
  }, [messages, isSending]);

  // keyboard listeners
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // auth subscription
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // load chat from storage
  useEffect(() => {
    const loadChat = async () => {
      try {
        const [visibleRaw, memoryRaw] = await Promise.all([
          AsyncStorage.getItem(VISIBLE_CHAT_STORAGE_KEY),
          AsyncStorage.getItem(MEMORY_CHAT_STORAGE_KEY),
        ]);

        if (visibleRaw) {
          const parsedVisible = JSON.parse(visibleRaw);
          if (Array.isArray(parsedVisible) && parsedVisible.length > 0) {
            setMessages(parsedVisible);
          }
        }

        if (memoryRaw) {
          const parsedMemory = JSON.parse(memoryRaw);
          if (Array.isArray(parsedMemory)) setMemoryMessages(parsedMemory);
        }
      } catch (err) {
        console.log("[coach-chat] failed to load chat:", err);
      } finally {
        setHydrated(true);
      }
    };

    loadChat();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      VISIBLE_CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-80))
    ).catch((err) => console.log("[coach-chat] save visible err:", err));
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      MEMORY_CHAT_STORAGE_KEY,
      JSON.stringify(memoryMessages.slice(-200))
    ).catch((err) => console.log("[coach-chat] save memory err:", err));
  }, [memoryMessages, hydrated]);

  // load latest plan
  useEffect(() => {
    if (!user) return;

    const loadLatestPlan = async () => {
      try {
        const plansRef = collection(db, "users", user.uid, "plans");
        const snap = await getDocs(
          query(plansRef, orderBy("updatedAt", "desc"), limit(1))
        );

        if (!snap.empty) {
          const docSnap = snap.docs[0];
          const data = docSnap.data();
          setPlan({ id: docSnap.id, ...data });
          setPlanDocId(docSnap.id);
        } else {
          setPlan(null);
          setPlanDocId(null);
        }
      } catch (err) {
        console.log("[coach-chat] failed to load plan:", err);
      }
    };

    loadLatestPlan();
  }, [user]);

  // LIVE nutrition (same schema as Nutrition page: meals.date Timestamp)
  useEffect(() => {
    if (!user) {
      setNutritionSummary(null);
      return;
    }

    let unsubGoal = null;
    let unsubMeals = null;

    const goalRef = doc(db, "users", user.uid, "nutrition", "profile");
    const mealsRef = collection(db, "users", user.uid, "meals");

    const since = startOfDay(daysAgo(6));
    const qMeals7d = query(
      mealsRef,
      where("date", ">=", Timestamp.fromDate(since)),
      orderBy("date", "desc")
    );

    let latestGoal = null;
    let latestMeals = [];

    const recompute = () => {
      const goal = latestGoal
        ? {
            dailyCalories: Number(latestGoal.dailyCalories || 0),
            proteinTarget: Number(latestGoal.proteinTarget || 0),
            carbTarget: Number(latestGoal.carbTarget || 0),
            fatTarget: Number(latestGoal.fatTarget || 0),
            raw: latestGoal,
          }
        : null;

      const goalCals = goal?.dailyCalories || 0;

      const today = startOfDay();
      const todayKey = today.toISOString().slice(0, 10);

      const todayTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      const byDay = {};

      latestMeals.forEach((m) => {
        const d = safeToDate(m.date);
        if (!d) return;
        const key = d.toISOString().slice(0, 10);

        if (!byDay[key]) {
          byDay[key] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
        }

        byDay[key].calories += Number(m.calories || 0);
        byDay[key].protein += Number(m.protein || 0);
        byDay[key].carbs += Number(m.carbs || 0);
        byDay[key].fat += Number(m.fat || 0);
        byDay[key].meals += 1;

        if (key === todayKey) {
          todayTotals.calories += Number(m.calories || 0);
          todayTotals.protein += Number(m.protein || 0);
          todayTotals.carbs += Number(m.carbs || 0);
          todayTotals.fat += Number(m.fat || 0);
        }
      });

      const dayKeys = Object.keys(byDay);
      const total = dayKeys.reduce(
        (acc, k) => ({
          calories: acc.calories + byDay[k].calories,
          protein: acc.protein + byDay[k].protein,
          carbs: acc.carbs + byDay[k].carbs,
          fat: acc.fat + byDay[k].fat,
          days: acc.days + 1,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
      );

      const weekAvg =
        total.days > 0
          ? {
              calories: Math.round(total.calories / total.days),
              protein: Math.round(total.protein / total.days),
              carbs: Math.round(total.carbs / total.days),
              fat: Math.round(total.fat / total.days),
            }
          : { calories: 0, protein: 0, carbs: 0, fat: 0 };

      let nutritionScore = null;
      if (goalCals && weekAvg.calories) {
        const diffRatio = Math.abs(weekAvg.calories - goalCals) / goalCals;
        let grade = "C";
        let desc = "Big swings vs your calorie target.";
        if (diffRatio <= 0.08) {
          grade = "A";
          desc = "Dialled in — very close to your target on average.";
        } else if (diffRatio <= 0.15) {
          grade = "B";
          desc = "Pretty close to your target, with some day-to-day variation.";
        }
        nutritionScore = { grade, desc, diffPercent: Math.round(diffRatio * 100) };
      }

      const remaining =
        goal && goalCals
          ? {
              calories: Math.max(0, Math.round(goalCals - todayTotals.calories)),
              protein: Math.max(
                0,
                Math.round((goal.proteinTarget || 0) - todayTotals.protein)
              ),
              carbs: Math.max(
                0,
                Math.round((goal.carbTarget || 0) - todayTotals.carbs)
              ),
              fat: Math.max(
                0,
                Math.round((goal.fatTarget || 0) - todayTotals.fat)
              ),
            }
          : null;

      const recentMeals = latestMeals.slice(0, 25).map((m) => {
        const d = safeToDate(m.date);
        return {
          id: m.id,
          title: m.title || "",
          mealType: m.mealType || "",
          calories: Number(m.calories || 0),
          protein: Number(m.protein || 0),
          carbs: Number(m.carbs || 0),
          fat: Number(m.fat || 0),
          notes: m.notes || "",
          source: m.source || "",
          date: d ? d.toISOString() : null,
        };
      });

      const summary = {
        goal,
        today: { date: todayKey, totals: todayTotals, remaining },
        week: { avg: weekAvg, totalDays: total.days, nutritionScore },
        recentMeals,
      };

      const hasAnything =
        !!goal ||
        recentMeals.length > 0 ||
        todayTotals.calories ||
        todayTotals.protein ||
        todayTotals.carbs ||
        todayTotals.fat;

      setNutritionSummary(hasAnything ? summary : null);

      console.log(
        "[coach-chat] nutrition linked:",
        hasAnything,
        "meals7d:",
        latestMeals.length,
        "goal:",
        !!goal
      );
    };

    unsubGoal = onSnapshot(
      goalRef,
      (snap) => {
        latestGoal = snap.exists() ? snap.data() : null;
        recompute();
      },
      (err) => {
        console.log("[coach-chat] goal snapshot error:", err);
        latestGoal = null;
        recompute();
      }
    );

    unsubMeals = onSnapshot(
      qMeals7d,
      (snap) => {
        latestMeals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        recompute();
      },
      (err) => {
        console.log("[coach-chat] meals snapshot error:", err);
        latestMeals = [];
        recompute();
      }
    );

    return () => {
      if (unsubGoal) unsubGoal();
      if (unsubMeals) unsubMeals();
    };
  }, [user]);

  const nutritionLinkedText = useMemo(() => {
    if (!nutritionSummary) return "not linked";
    const n = nutritionSummary.recentMeals?.length || 0;
    const goal = nutritionSummary.goal ? "goal" : "no goal";
    return `linked • ${n} meals (7d) • ${goal}`;
  }, [nutritionSummary]);

  const handleClearChat = async () => {
    const reset = [
      { id: "welcome", role: "assistant", content: INITIAL_SYSTEM_MESSAGE },
    ];
    setMessages(reset);
    try {
      await AsyncStorage.setItem(VISIBLE_CHAT_STORAGE_KEY, JSON.stringify(reset));
    } catch (err) {
      console.log("[coach-chat] failed to clear visible chat:", err);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setMemoryMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      if (!API_URL) throw new Error("API_URL missing (check EXPO_PUBLIC_API_URL).");

      // build system context that ALWAYS includes nutrition + plan
      const nutritionText = buildNutritionContextText(nutritionSummary);
      const planText = buildPlanContextText(
        plan
          ? {
              ...plan,
              meta: {
                name: plan.name || "",
                primaryActivity: plan.primaryActivity || "",
                goalDistance: plan.goalDistance || "",
                goalPrimaryFocus: plan.goalPrimaryFocus || "",
                targetEventName: plan.targetEventName || "",
                targetEventDate: plan.targetEventDate || "",
              },
            }
          : null
      );

      const systemMsg = {
        role: "system",
        content:
          `${INITIAL_SYSTEM_MESSAGE}\n\n` +
          `---\n${planText}\n---\n` +
          `${nutritionText}\n---\n` +
          `Important: When answering, reference the nutrition context above if the user asks about meals/macros. If nutrition context is empty, say so.`,
      };

      const mem = [...memoryMessages, userMessage]
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-40);

      const payload = {
        messages: [
          systemMsg,
          ...mem.map((m) => ({ role: m.role, content: m.content })),
        ],
        // still include for later server use, but SYSTEM is the guaranteed channel
        nutrition: nutritionSummary || null,
        plan: plan || null,
      };

      console.log("[coach-chat] sending payload has nutrition:", !!nutritionSummary);

      const res = await fetch(`${API_URL}/coach-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      console.log("[coach-chat] status:", res.status);
      console.log("[coach-chat] raw response:", rawText);

      if (!res.ok) {
        throw new Error(`coach-chat failed (${res.status}): ${rawText.slice(0, 200)}`);
      }

      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server did not return valid JSON.");
      }

      const replyText =
        data.reply ||
        data.message ||
        data.answer ||
        data.text ||
        data.content ||
        data.output ||
        data.response ||
        data.result ||
        "Got it — let’s keep going.";

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: replyText,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setMemoryMessages((prev) => [...prev, assistantMessage]);

      // plan update
      if (data.updatedPlan && planDocId && user) {
        try {
          const planRef = doc(db, "users", user.uid, "plans", planDocId);
          const cleanedUpdates = removeUndefinedDeep({
            ...data.updatedPlan,
            updatedAt: serverTimestamp(),
          });
          await updateDoc(planRef, cleanedUpdates);
          setPlan((prev) => ({ ...(prev || {}), ...data.updatedPlan }));
        } catch (err) {
          console.log("[coach-chat] Failed to update plan:", err);
        }
      }
    } catch (err) {
      console.log("[coach-chat] error:", err);

      const errorMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: err?.message || "I couldn't reach the server. Try again in a moment.",
      };

      setMessages((prev) => [...prev, errorMessage]);
      setMemoryMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  };

  const renderBubble = (msg) => {
    const isUserBubble = msg.role === "user";
    return (
      <View
        key={msg.id}
        style={[
          s.messageRow,
          { justifyContent: isUserBubble ? "flex-end" : "flex-start" },
        ]}
      >
        <View style={[s.bubble, isUserBubble ? s.bubbleUser : s.bubbleCoach]}>
          {!isUserBubble && <Text style={s.coachLabel}>Coach</Text>}
          <Text style={s.bubbleText}>{msg.content}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <LinearGradient
        colors={[
          "rgba(230,255,59,0.18)",
          "rgba(230,255,59,0.10)",
          "rgba(230,255,59,0.05)",
          "rgba(0,0,0,1)",
        ]}
        style={s.fullBackground}
      />
      <View style={s.fullOverlay} />

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={s.page}>
          <View style={s.header}>
            <View style={s.headerTextBlock}>
              <Text style={s.headerTitle}>COACH</Text>
              <Text style={s.headerSubtitle}>
                AI training, fuelling & recovery — using your plan
                {nutritionSummary?.goal ? " and nutrition goal" : ""}
              </Text>

              {plan && (
                <Text style={s.headerPlanTag}>
                  Linked plan: {plan.name || "Run plan"}
                </Text>
              )}

              {/* ✅ tells you if meals are actually coming in */}
              <Text style={s.headerPlanTag}>Nutrition: {nutritionLinkedText}</Text>
            </View>

            <View style={s.headerActions}>
              <TouchableOpacity
                onPress={handleClearChat}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={s.clearBtn}
              >
                <Feather name="trash-2" size={16} color={SUBTEXT} />
                <Text style={s.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            ref={scrollViewRef}
            style={s.messagesScroll}
            contentContainerStyle={[
              s.messagesContent,
              keyboardVisible && { paddingBottom: 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={scrollToEnd}
          >
            {messages.map(renderBubble)}

            {isSending && (
              <View style={s.messageRow}>
                <View style={[s.bubble, s.bubbleCoach]}>
                  <Text style={s.coachLabel}>Coach</Text>
                  <View style={s.typingRow}>
                    <ActivityIndicator size="small" color={PRIMARY} />
                    <Text style={s.typingText}>Thinking…</Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          <View style={[s.inputWrapper, keyboardVisible && { bottom: 8 }]}>
            <View style={s.inputContainer}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask about your plan, fuelling, niggles, or tweaks…"
                placeholderTextColor={SUBTEXT}
                multiline
                style={s.input}
                keyboardAppearance={isDark ? "dark" : "light"}
              />

              <TouchableOpacity
                disabled={!input.trim() || isSending}
                onPress={handleSend}
                style={[
                  s.sendButton,
                  (!input.trim() || isSending) && s.sendDisabled,
                ]}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color="#111" />
                ) : (
                  <Feather name="arrow-up" size={17} color="#111" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
function makeStyles() {
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: BG },

    fullBackground: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 0,
    },
    fullOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.55)",
      zIndex: 0,
    },

    page: {
      flex: 1,
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: FOOTER_OFFSET + 20,
      zIndex: 1,
      backgroundColor: "transparent",
    },

    header: {
      paddingVertical: 8,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    },
    headerTextBlock: { flex: 1, minWidth: 0 },
    headerTitle: {
      fontSize: 26,
      fontWeight: "700",
      color: TEXT,
      marginBottom: 2,
    },
    headerSubtitle: { color: SUBTEXT, fontSize: 13 },
    headerPlanTag: {
      color: SUBTEXT,
      fontSize: 11,
      marginTop: 4,
      fontStyle: "italic",
    },

    headerActions: { flexDirection: "row", alignItems: "center" },
    clearBtn: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#2D2D2F",
      backgroundColor: "#111111",
      gap: 6,
    },
    clearBtnText: { fontSize: 11, color: SUBTEXT, fontWeight: "600" },

    messagesScroll: { flex: 1, zIndex: 1, backgroundColor: "transparent" },
    messagesContent: { paddingBottom: FOOTER_OFFSET + 60, paddingTop: 10 },

    messageRow: { flexDirection: "row", marginVertical: 6 },

    bubble: {
      maxWidth: "82%",
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    bubbleCoach: {
      backgroundColor: COACH_BUBBLE_BG,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#E1E3E8",
    },
    bubbleUser: {
      backgroundColor: USER_BUBBLE_BG,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#E1E3E8",
    },

    coachLabel: { fontSize: 11, color: SUBTEXT, marginBottom: 4 },
    bubbleText: { color: TEXT, fontSize: 15, lineHeight: 21 },

    typingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    typingText: { fontSize: 13, color: SUBTEXT },

    inputWrapper: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: FOOTER_OFFSET - 10,
      zIndex: 2,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "flex-end",
      backgroundColor: "#111",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#E1E3E8",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
    },
    input: {
      flex: 1,
      color: TEXT,
      fontSize: 15,
      padding: 0,
      minHeight: 32,
      maxHeight: 120,
    },
    sendButton: {
      width: 36,
      height: 36,
      backgroundColor: PRIMARY,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 8,
    },
    sendDisabled: { backgroundColor: "#666" },
  });
}
