// app/(protected)/nutrition/food-quality.jsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    Timestamp,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Food Quality — wired to real data + AI
   - Overall: /nutrition/food-quality { goal, totals, meals }
   - Per item: /nutrition/meal-quality { meal } (single item, NOT assumed "meal")
   ✅ Per-item analysis runs automatically (no tap needed)
───────────────────────────────────────────── */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function pct(n) {
  return clamp(Number.isFinite(n) ? n : 0, 0, 100);
}
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
function daysBackFrom(date, nDays) {
  const x = new Date(date);
  x.setDate(x.getDate() - nDays);
  return x;
}
function gradeToScore(grade) {
  const g = String(grade || "").toUpperCase().trim();
  if (g === "A" || g === "A+") return 88;
  if (g === "B") return 74;
  if (g === "C") return 58;
  if (g === "D") return 42;
  if (g === "E") return 34;
  if (g === "F") return 26;
  return 60;
}
function scoreToLabel(v) {
  if (v >= 85) return "Elite";
  if (v >= 70) return "Strong";
  if (v >= 55) return "Okay";
  return "Needs work";
}

export default function FoodQualityPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  // Range selector
  const [range, setRange] = useState("today"); // today | 7d | 30d

  // UI sheet
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // Real data
  const [nutritionGoal, setNutritionGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  const [meals, setMeals] = useState([]);
  const [mealsLoading, setMealsLoading] = useState(true);

  // Overall AI result (truth)
  const [ai, setAi] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Per-item AI (auto)
  const [itemAiById, setItemAiById] = useState({}); // { [id]: { grade, summary, detail } }
  const [itemAiLoading, setItemAiLoading] = useState({}); // { [id]: true }
  const inFlightRef = useRef(new Set()); // prevents double-requests

  const s = makeStyles(colors, isDark, accent);

  // Date anchor
  const anchorDate = useMemo(() => {
    const raw = params?.date ? new Date(String(params.date)) : new Date();
    return Number.isNaN(raw.getTime()) ? new Date() : raw;
  }, [params?.date]);

  const windowStartEnd = useMemo(() => {
    const end = endOfDay(anchorDate);
    if (range === "today") return { from: startOfDay(anchorDate), to: end };
    if (range === "7d") return { from: startOfDay(daysBackFrom(anchorDate, 6)), to: end };
    return { from: startOfDay(daysBackFrom(anchorDate, 29)), to: end };
  }, [anchorDate, range]);

  // Redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // Load nutrition goal
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

  // Load food logs for range (live)
  useEffect(() => {
    if (!user) return;

    setMealsLoading(true);

    const mealsRef = collection(db, "users", user.uid, "meals");
    const fromTs = Timestamp.fromDate(windowStartEnd.from);
    const toTs = Timestamp.fromDate(windowStartEnd.to);

    const qMeals = query(
      mealsRef,
      where("date", ">=", fromTs),
      where("date", "<=", toTs),
      orderBy("date", "desc")
    );

    const unsub = onSnapshot(
      qMeals,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMeals(rows);
        setMealsLoading(false);
      },
      () => setMealsLoading(false)
    );

    return () => unsub();
  }, [user, windowStartEnd.from, windowStartEnd.to]);

  // Totals for the window
  const totals = useMemo(() => {
    const base = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0 };
    return (meals || []).reduce(
      (acc, m) => ({
        calories: acc.calories + Number(m.calories || 0),
        protein: acc.protein + Number(m.protein || 0),
        carbs: acc.carbs + Number(m.carbs || 0),
        fat: acc.fat + Number(m.fat || 0),
        fibre: acc.fibre + Number(m.fibre || m.fiber || 0),
        sugar: acc.sugar + Number(m.sugar || 0),
        sodium: acc.sodium + Number(m.sodium || 0),
      }),
      base
    );
  }, [meals]);

  // Overall AI
  useEffect(() => {
    if (!nutritionGoal || !meals?.length || !API_URL) {
      setAi(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setAiLoading(true);

        const res = await fetch(`${API_URL}/nutrition/food-quality`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: nutritionGoal,
            totals,
            meals,
            window: {
              from: windowStartEnd.from.toISOString(),
              to: windowStartEnd.to.toISOString(),
              range,
            },
          }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!cancelled) setAi(data || null);
      } catch (_err) {
        if (!cancelled) {
          setAi(null);
          Alert.alert("Food quality", "Couldn’t load food quality right now.");
        }
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [nutritionGoal, meals, totals, range, windowStartEnd.from, windowStartEnd.to]);

  // Overall score/label
  const overallScore = useMemo(() => (ai?.grade ? gradeToScore(ai.grade) : 0), [ai?.grade]);
  const scoreLabel = useMemo(() => scoreToLabel(overallScore), [overallScore]);

  const scoreHint = useMemo(() => {
    if (aiLoading) return "Analysing your logged food…";
    if (!meals?.length) return "Log some food to generate your food quality score.";
    if (!ai) return "We couldn’t generate a score right now. Try again shortly.";
    return ai.summary || "Food quality analysis ready.";
  }, [aiLoading, meals?.length, ai]);

  // Breakdown bars (overall + a couple inferred)
  const breakdown = useMemo(() => {
    const apiBreakdown = ai?.breakdown || ai?.scores || null;

    const pTarget = Number(nutritionGoal?.proteinTarget || 0);
    const cTarget = Number(nutritionGoal?.carbTarget || 0);
    const fTarget = Number(nutritionGoal?.fatTarget || 0);

    const proteinScore =
      apiBreakdown?.protein ??
      (pTarget ? pct((totals.protein / pTarget) * 100) : pct((totals.protein / 140) * 100));
    const fibreScore = apiBreakdown?.fibre ?? pct((totals.fibre / 30) * 100);

    const upfScore = apiBreakdown?.upf ?? pct(overallScore);
    const plantsScore = apiBreakdown?.plants ?? pct(overallScore - 6);
    const microsScore = apiBreakdown?.micros ?? pct(overallScore - 8);
    const hydrationScore = apiBreakdown?.hydration ?? pct(overallScore - 10);

    const overall = apiBreakdown?.overall ?? overallScore;

    return {
      fibre: fibreScore,
      protein: proteinScore,
      plants: plantsScore,
      hydration: hydrationScore,
      upf: upfScore,
      micros: microsScore,
      overall: pct(overall),
      targets: { pTarget, cTarget, fTarget },
    };
  }, [ai, overallScore, nutritionGoal, totals]);

  const levers = useMemo(
    () => [
      {
        key: "upf",
        title: "Ultra-processed",
        value: breakdown.upf,
        right: "Higher = better avoidance",
        what:
          ai?.detail ||
          "We look for patterns that usually indicate higher ultra-processed intake (snack-heavy, low fibre, low variety).",
        improve: [
          "Swap 1 packaged snack for fruit + yoghurt or nuts.",
          "Choose minimally processed versions (oats over cereal, potatoes over crisps).",
          "Aim: 80/20 — you don’t need perfection.",
        ],
      },
      {
        key: "fibre",
        title: "Fibre",
        value: breakdown.fibre,
        right: "Higher is better",
        what: "Estimated from your logged fibre field (where available).",
        improve: ["Add a veg to 2 meals.", "Use oats/berries/beans 3x per week.", "Aim: 25–35g/day."],
      },
      {
        key: "protein",
        title: "Protein",
        value: breakdown.protein,
        right: "Higher is better",
        what: breakdown.targets?.pTarget
          ? `Estimated vs your target (${Math.round(breakdown.targets.pTarget)}g/day).`
          : "Estimated from your logged protein.",
        improve: ["25–40g per meal.", "Add a “protein anchor” to breakfast.", "Use lean protein + dairy + legumes."],
      },
      {
        key: "plants",
        title: "Plant variety",
        value: breakdown.plants,
        right: "AI-based estimate",
        what: "This becomes more accurate when we add food-type classification (veg/fruit/wholegrains).",
        improve: ["Target 20+ different plants/week.", "Mix frozen + fresh veg.", "Add herbs/spices for free wins."],
      },
      {
        key: "micros",
        title: "Micronutrients",
        value: breakdown.micros,
        right: "AI-based estimate",
        what: "This becomes more accurate once we tag foods by category and micronutrient density.",
        improve: [
          "Colour on plate: green + orange + purple.",
          "Include eggs/fish/leafy greens 2–3x/week.",
          "Use iodised salt if you don’t eat much seafood.",
        ],
      },
      {
        key: "hydration",
        title: "Hydration",
        value: breakdown.hydration,
        right: "Not logged yet (estimate)",
        what: "When you add water logging, we’ll score hydration directly.",
        improve: ["500ml on wake.", "Add electrolytes on long sessions.", "Aim: pale-yellow urine, not clear."],
      },
    ],
    [breakdown, ai?.detail]
  );

  // Build the list we actually show (cap to keep requests sensible)
  const visibleItems = useMemo(() => (meals || []).slice(0, 12), [meals]);

  // Helper: call single-item analysis endpoint
  const analyseItem = useCallback(
    async (m) => {
      if (!API_URL) return null;
      if (!m?.id) return null;

      // cache/in-flight guards
      if (itemAiById[m.id]) return itemAiById[m.id];
      if (inFlightRef.current.has(m.id)) return null;

      inFlightRef.current.add(m.id);
      setItemAiLoading((prev) => ({ ...prev, [m.id]: true }));

      const r = m || {};
      const mealPayload = {
        title: r.title || "Food item",
        mealType: r.mealType || "",
        calories: Number(r.calories || 0),
        protein: Number(r.protein || 0),
        carbs: Number(r.carbs || 0),
        fat: Number(r.fat || 0),

        fibre: Number(r.fibre ?? r.fiber ?? 0) || 0,
        sugar: Number(r.sugar ?? 0) || 0,

        saturatedFat: Number(r.saturatedFat ?? 0) || 0,
        polyunsaturatedFat: Number(r.polyunsaturatedFat ?? 0) || 0,
        monounsaturatedFat: Number(r.monounsaturatedFat ?? 0) || 0,
        transFat: Number(r.transFat ?? 0) || 0,

        cholesterol: Number(r.cholesterol ?? 0) || 0,
        sodium: Number(r.sodium ?? 0) || 0,
        potassium: Number(r.potassium ?? 0) || 0,

        vitaminA: Number(r.vitaminA ?? 0) || 0,
        vitaminC: Number(r.vitaminC ?? 0) || 0,
        calcium: Number(r.calcium ?? 0) || 0,
        iron: Number(r.iron ?? 0) || 0,

        notes: r.notes || "",
      };

      try {
        const res = await fetch(`${API_URL}/nutrition/meal-quality`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meal: mealPayload }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json(); // { grade, summary, detail }

        setItemAiById((prev) => ({ ...prev, [m.id]: data }));
        return data;
      } catch (_e) {
        const fallback = {
          grade: "B",
          summary: "Couldn’t analyse this item right now.",
          detail: "Try again in a moment.",
        };
        setItemAiById((prev) => ({ ...prev, [m.id]: fallback }));
        return fallback;
      } finally {
        setItemAiLoading((prev) => ({ ...prev, [m.id]: false }));
        inFlightRef.current.delete(m.id);
      }
    },
    [API_URL, itemAiById]
  );

  // ✅ Auto-analyse visible items (no tap)
  useEffect(() => {
    if (!API_URL) return;
    if (!visibleItems.length) return;

    let cancelled = false;

    // simple concurrency limiter
    const CONCURRENCY = 2;

    const runQueue = async () => {
      const queue = visibleItems.filter((m) => m?.id && !itemAiById[m.id]);

      let idx = 0;
      const workers = new Array(CONCURRENCY).fill(0).map(async () => {
        while (!cancelled && idx < queue.length) {
          const m = queue[idx];
          idx += 1;
          // eslint-disable-next-line no-await-in-loop
          await analyseItem(m);
        }
      });

      await Promise.all(workers);
    };

    runQueue();

    return () => {
      cancelled = true;
    };
  }, [API_URL, visibleItems, itemAiById, analyseItem]);

  const openDetail = useCallback(
    (item) => {
      // attach cached AI if available
      if (item?.type === "foodItem" && item?.raw?.id && itemAiById[item.raw.id]) {
        setSelectedItem({ ...item, ai: itemAiById[item.raw.id] });
      } else {
        setSelectedItem(item);
      }
      setDetailOpen(true);
    },
    [itemAiById]
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setSelectedItem(null);
  }, []);

  // UI cards: show grade/summary straight away (or loading)
  const itemCards = useMemo(() => {
    return visibleItems.map((m) => {
      const p = Number(m.protein || 0);
      const fib = Number(m.fibre || m.fiber || 0);
      const cal = Number(m.calories || 0);

      const tags = [];
      if (p >= 25) tags.push("protein ok");
      else if (p > 0) tags.push("protein low");

      if (fib >= 8) tags.push("fibre good");
      else if (fib > 0) tags.push("fibre low");

      if (cal >= 600) tags.push("high kcal");
      if (!tags.length) tags.push("logged");

      const aiItem = itemAiById[m.id];
      const loading = !!itemAiLoading[m.id];

      return {
        id: m.id,
        title: m.title || "Food item",
        notes: m.notes || "",
        tags,
        ai: aiItem || null,
        loading,
        raw: { ...m, id: m.id },
      };
    });
  }, [visibleItems, itemAiById, itemAiLoading]);

  const pageTitleRange = useMemo(() => {
    if (range === "today") return "Today";
    if (range === "7d") return "7 days";
    return "30 days";
  }, [range]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push("/nutrition")} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="grid" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>NUTRITION</Text>
                  <Text style={s.heroName}>Food quality</Text>
                  <Text style={s.heroSub}>{pageTitleRange} · based on your logged food</Text>
                </View>
              </View>

              <View style={{ marginTop: 12 }}>
                <ToggleRow
                  value={range}
                  onChange={setRange}
                  accent={accent}
                  colors={colors}
                  isDark={isDark}
                  options={[
                    { key: "today", label: "Today" },
                    { key: "7d", label: "7 days" },
                    { key: "30d", label: "30 days" },
                  ]}
                />
              </View>

              {/* SCORE CARD */}
              <View style={s.scoreCard}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.scoreTitle}>Overall score</Text>

                    {goalLoading || mealsLoading || aiLoading ? (
                      <Text style={s.scoreSub}>Analysing…</Text>
                    ) : !nutritionGoal ? (
                      <Text style={s.scoreSub}>Set a nutrition goal to enable food quality.</Text>
                    ) : !meals.length ? (
                      <Text style={s.scoreSub}>No food logged in this window — log food to get a score.</Text>
                    ) : (
                      <Text style={s.scoreSub}>{scoreHint}</Text>
                    )}
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() =>
                      openDetail({
                        type: "overall",
                        title: "Food quality (AI)",
                        value: breakdown.overall,
                        label: scoreLabel,
                        explain:
                          "This uses your logged food + totals and your goal to generate a quality grade, summary and improvement guidance.",
                        tips: ["Win breakfast: protein + fibre.", "Upgrade snacks: fruit + yoghurt, nuts, jerky.", "Two veg portions/day minimum."],
                      })
                    }
                    style={s.scorePillBtn}
                  >
                    <Text style={s.scorePillBtnText}>How it works</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 14 }}>
                  {goalLoading || mealsLoading || aiLoading ? (
                    <View style={{ height: 130, alignItems: "center", justifyContent: "center" }}>
                      <ActivityIndicator />
                    </View>
                  ) : (
                    <ScoreRing score={breakdown.overall} accent={accent} colors={colors} isDark={isDark} label={scoreLabel} />
                  )}
                </View>

                {ai?.detail ? (
                  <View style={{ marginTop: 12 }}>
                    <Text style={s.hint}>{ai.detail}</Text>
                  </View>
                ) : null}

                <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    activeOpacity={0.92}
                    onPress={() =>
                      router.push({
                        pathname: "/nutrition/add",
                        params: { date: startOfDay(anchorDate).toISOString() },
                      })
                    }
                    style={[s.cta, { backgroundColor: accent, flex: 1 }]}
                  >
                    <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                    <Text style={[s.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Log food</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.92}
                    onPress={() => router.push("/nutrition")}
                    style={[s.cta, { backgroundColor: isDark ? "#18191E" : "#E6E7EC", flex: 1 }]}
                  >
                    <Feather name="arrow-right" size={16} color={colors.text} />
                    <Text style={[s.ctaText, { color: colors.text }]}>Nutrition home</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* BREAKDOWN */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="sliders" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Breakdown</Text>
              </View>

              <TouchableOpacity activeOpacity={0.9} onPress={() => openDetail({ type: "glossary" })} style={s.smallBtn}>
                <Feather name="info" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.hint}>
              Tap a bar for why it matters + quick fixes. Some bars are estimates until we add food-type tagging.
            </Text>

            <View style={{ marginTop: 10 }}>
              {levers.map((x) => (
                <TouchableOpacity key={x.key} activeOpacity={0.92} onPress={() => openDetail(x)} style={s.leverRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.leverTitle}>{x.title}</Text>
                    <Text style={s.leverSub} numberOfLines={1}>
                      {x.right}
                    </Text>
                    <View style={s.barTrack}>
                      <View style={[s.barFill, { width: `${pct(x.value)}%`, backgroundColor: accent }]} />
                    </View>
                  </View>

                  <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
                    <Text style={s.leverPct}>{Math.round(x.value)}%</Text>
                    <Feather name="chevron-right" size={18} color={colors.subtext} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* FOOD ITEMS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="coffee" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Food items</Text>
              </View>
            </View>

            {mealsLoading ? (
              <View style={{ marginTop: 12 }}>
                <ActivityIndicator />
              </View>
            ) : !meals.length ? (
              <Text style={s.hint}>No food logged in this window.</Text>
            ) : (
              <View style={{ marginTop: 10 }}>
                {itemCards.map((m) => (
                  <View key={m.id} style={s.mealCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.mealTitle}>{m.title}</Text>
                        {m.notes ? <Text style={s.mealSub}>{m.notes}</Text> : null}

                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                          {m.tags.map((t) => (
                            <View key={t} style={s.tag}>
                              <Text style={s.tagText}>{t}</Text>
                            </View>
                          ))}
                        </View>

                        {m.loading ? (
                          <Text style={[s.mealSub, { marginTop: 10 }]}>Analysing…</Text>
                        ) : m.ai?.summary ? (
                          <Text style={[s.mealSub, { marginTop: 10 }]} numberOfLines={2}>
                            {m.ai.summary}
                          </Text>
                        ) : null}
                      </View>

                      {/* Grade shown automatically */}
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() =>
                          openDetail({
                            type: "foodItem",
                            title: m.title,
                            raw: m.raw,
                            ai: m.ai || null,
                          })
                        }
                        style={s.mealScoreBtn}
                      >
                        <Text style={s.mealScore}>{m.loading ? "…" : m.ai?.grade || "—"}</Text>
                        <Text style={s.mealScoreSub}>{m.loading ? "AI" : "grade"}</Text>
                        <Feather name="chevron-right" size={18} color={colors.text} />
                      </TouchableOpacity>
                    </View>

                    <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() =>
                          openDetail({
                            type: "foodItem",
                            title: m.title,
                            raw: m.raw,
                            ai: m.ai || null,
                          })
                        }
                        style={s.actionChip}
                      >
                        <Text style={s.actionChipText}>View</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => router.push({ pathname: "/nutrition/add", params: { date: startOfDay(anchorDate).toISOString() } })}
                        style={s.actionChip}
                      >
                        <Text style={s.actionChipText}>Log more</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* QUICK RULES */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="check-circle" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Quick rules</Text>
              </View>
            </View>

            <View style={{ marginTop: 10 }}>
              <RuleRow title="Protein anchor" body="Every meal starts with a protein source. Then add carbs/fat." colors={colors} isDark={isDark} />
              <RuleRow title="Fibre daily" body="2 veg portions + 1 fruit minimum. Beans/oats = easy win." colors={colors} isDark={isDark} />
              <RuleRow title="UPF 80/20" body="Most calories from whole foods. Leave room for life." colors={colors} isDark={isDark} />
              <RuleRow title="Hydration baseline" body="500ml on wake + 500ml during/after training." colors={colors} isDark={isDark} />
            </View>
          </View>

          <View style={{ height: 28 }} />
        </ScrollView>

        <DetailSheet open={detailOpen} onClose={closeDetail} item={selectedItem} colors={colors} isDark={isDark} accent={accent} />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Components
───────────────────────────────────────────── */
function ToggleRow({ value, onChange, options, accent, colors, isDark }) {
  const track = isDark ? "#0E0F14" : "#FFFFFF";
  const border = isDark ? "#1B1C22" : "#E6E7EC";
  const activeBg = isDark ? "#00000066" : "#FFFFFFAA";

  return (
    <View
      style={{
        backgroundColor: track,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: border,
        padding: 4,
        flexDirection: "row",
        gap: 6,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            activeOpacity={0.9}
            onPress={() => onChange(opt.key)}
            style={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? activeBg : "transparent",
              borderWidth: active ? 1 : 0,
              borderColor: active ? accent : "transparent",
            }}
          >
            <Text style={{ fontWeight: "900", letterSpacing: 0.3, color: active ? colors.text : colors.subtext }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ScoreRing({ score, accent, colors, isDark, label }) {
  const size = 130;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const p = pct(score) / 100;
  const dashOffset = c * (1 - p);

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={isDark ? "#1B1C22" : "#E6E7EC"} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={accent}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>

        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 34, fontWeight: "900", color: colors.text }}>{Math.round(pct(score))}</Text>
          <Text style={{ fontSize: 12, fontWeight: "900", color: colors.subtext, marginTop: 4 }}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

function RuleRow({ title, body, colors, isDark }) {
  return (
    <View style={{ marginTop: 10, padding: 14, borderRadius: 18, backgroundColor: isDark ? "#111217" : "#F3F4F6" }}>
      <Text style={{ color: colors.text, fontWeight: "900", fontSize: 13 }}>{title}</Text>
      <Text style={{ color: colors.subtext, fontWeight: "700", fontSize: 13, marginTop: 6, lineHeight: 18 }}>{body}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Detail Sheet
───────────────────────────────────────────── */
function DetailSheet({ open, onClose, item, colors, isDark, accent }) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const content = useMemo(() => {
    if (!item) return null;

    if (item.type === "glossary") {
      return {
        title: "Glossary",
        sub: "What the score is looking at",
        blocks: [
          {
            h: "UPF",
            p: "Ultra-processed foods are typically industrial formulations with additives and refined ingredients. Higher score = better avoidance.",
          },
          { h: "Fibre", p: "More fibre usually means better gut health, hunger control and micronutrients." },
          { h: "Protein", p: "Supports recovery and helps keep calories under control without sacrificing performance." },
          { h: "Plant variety", p: "More plant diversity = broader micronutrients and better gut diversity." },
          { h: "Micronutrients", p: "Vitamins/minerals from whole foods support training, sleep and recovery." },
          { h: "Hydration", p: "Water + electrolytes (when needed) help performance and appetite regulation." },
        ],
      };
    }

    if (item.type === "foodItem") {
      const ai = item.ai;
      const r = item.raw || {};
      const macrosLine = `kcal ${Math.round(r.calories || 0)} · P ${Math.round(r.protein || 0)}g · C ${Math.round(
        r.carbs || 0
      )}g · F ${Math.round(r.fat || 0)}g`;

      return {
        title: item.title || "Food item",
        sub: ai?.grade ? `Grade: ${ai.grade}` : "Analysing (or not available yet)",
        blocks: [
          ai?.summary ? { h: "Summary", p: ai.summary } : { h: "Summary", p: "We’ll add this as the analysis completes." },
          ai?.detail ? { h: "Improve", p: ai.detail } : { h: "Improve", p: "—" },
          { h: "Logged macros", p: macrosLine },
          r.notes ? { h: "Notes", p: r.notes } : null,
        ].filter(Boolean),
      };
    }

    return {
      title: item.title || "Detail",
      sub: item.right || item.label || "",
      blocks: [
        item.value != null ? { h: "Score", p: `${Math.round(item.value)}%` } : null,
        item.explain ? { h: "How it’s calculated", p: item.explain } : null,
        item.what ? { h: "What it means", p: item.what } : null,
        item.improve?.length ? { h: "Improve fast", p: item.improve.join(" · ") } : null,
        item.tips?.length ? { h: "Quick tips", p: item.tips.join(" · ") } : null,
      ].filter(Boolean),
    };
  }, [item]);

  if (!content) return null;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View
        style={[
          stylesGlobal.sheet,
          {
            backgroundColor: isDark ? "#0E0F14" : "#FFFFFF",
            maxHeight: sheetMaxH,
          },
        ]}
      >
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{content.title}</Text>
              {content.sub ? <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>{content.sub}</Text> : null}
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {content.blocks.map((b) => (
            <View
              key={b.h}
              style={{
                marginTop: 12,
                borderRadius: 18,
                padding: 14,
                backgroundColor: isDark ? "#111217" : "#F3F4F6",
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900", fontSize: 13 }}>{b.h}</Text>
              <Text style={{ color: colors.subtext, fontWeight: "700", fontSize: 13, marginTop: 6, lineHeight: 18 }}>{b.p}</Text>
            </View>
          ))}

          <TouchableOpacity activeOpacity={0.92} onPress={onClose} style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16 }]}>
            <Feather name="check" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    scoreCard: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 14,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    scoreTitle: { fontSize: 13, fontWeight: "900", color: colors.text },
    scoreSub: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: "700",
      color: colors.subtext,
      maxWidth: 280,
      lineHeight: 18,
    },

    scorePillBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },
    scorePillBtnText: { fontSize: 12, fontWeight: "900", color: colors.text },

    cta: {
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
    },
    ctaText: {
      fontSize: 13,
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },

    smallBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },

    leverRow: {
      padding: 14,
      borderRadius: 18,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      marginTop: 10,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    leverTitle: { color: colors.text, fontWeight: "900", fontSize: 13 },
    leverSub: { color: colors.subtext, fontWeight: "700", fontSize: 12, marginTop: 6 },
    leverPct: { color: colors.text, fontWeight: "900", fontSize: 13 },

    barTrack: {
      height: 10,
      borderRadius: 999,
      backgroundColor: isDark ? "#1B1C22" : "#E6E7EC",
      overflow: "hidden",
      marginTop: 10,
    },
    barFill: { height: "100%", borderRadius: 999 },

    mealCard: {
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
      marginTop: 10,
    },
    mealTitle: { color: colors.text, fontWeight: "900", fontSize: 15 },
    mealSub: { color: colors.subtext, fontWeight: "700", fontSize: 13, marginTop: 6, lineHeight: 18 },

    tag: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },
    tagText: { color: colors.text, fontWeight: "900", fontSize: 12 },

    mealScoreBtn: {
      width: 84,
      borderRadius: 18,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      padding: 10,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    mealScore: { color: colors.text, fontWeight: "900", fontSize: 22 },
    mealScoreSub: { color: colors.subtext, fontWeight: "900", fontSize: 12 },

    actionChip: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    actionChipText: { color: colors.text, fontWeight: "900", fontSize: 12 },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  cta: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});
