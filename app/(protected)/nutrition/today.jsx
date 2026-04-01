// app/(protected)/nutrition/today.jsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- helpers ---------- */

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

function getBucketForMeal(meal) {
  const rawType =
    (meal.mealType || meal.type || meal.meal || "").toString().toLowerCase();

  if (rawType.includes("breakfast")) return "breakfast";
  if (rawType.includes("lunch")) return "lunch";
  if (rawType.includes("dinner") || rawType.includes("evening")) return "dinner";
  if (rawType.includes("snack")) return "snacks";

  const date = meal.date?.toDate?.() || new Date(meal.date || Date.now());
  const hour = date.getHours();

  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 21) return "dinner";
  return "snacks";
}

function mealTypeIcon(mealType) {
  const t = String(mealType || "").toLowerCase();
  if (t.includes("breakfast")) return "sunrise";
  if (t.includes("lunch")) return "sun";
  if (t.includes("dinner")) return "moon";
  if (t.includes("snack")) return "coffee";
  return "circle";
}

function mealTypeForBucket(bucketKey) {
  if (bucketKey === "breakfast") return "Breakfast";
  if (bucketKey === "lunch") return "Lunch";
  if (bucketKey === "dinner") return "Dinner";
  if (bucketKey === "snacks") return "Snack";
  return "Breakfast";
}

function fmtShortDate(d) {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PAGE_PAD = 18;

/* ---------- page ---------- */

export default function NutritionTodayPage() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Theme tokens (SAP GEL)
  const SAP_PRIMARY = colors.sapPrimary || "#E6FF3B"; // neon
  const ACCENT = isDark ? SAP_PRIMARY : colors.accentStrong || "#A6C800";
  const ACCENT_ON = colors.sapOnPrimary || "#0B0B0B";

  const BG = colors.bg || (isDark ? "#050506" : "#F5F5F7");
  const SURFACE = colors.surface || (isDark ? "#0E0F14" : "#FFFFFF");
  const SURFACE_ALT =
    colors.surfaceAlt ||
    (isDark ? "#111217" : colors.sapSilverLight || "#F3F4F6");
  const BORDER =
    colors.sapSilverMedium || colors.borderStrong || colors.border || "#E1E3E8";
  const TRACK = isDark ? "#24252B" : "#D2D4DA";

  const router = useRouter();
  const user = auth.currentUser;

  const [meals, setMeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  const [currentDate, setCurrentDate] = useState(() => new Date());

  const [analysis, setAnalysis] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const s = makeStyles({
    colors,
    isDark,
    BG,
    SURFACE,
    SURFACE_ALT,
    BORDER,
    TRACK,
    ACCENT,
    ACCENT_ON,
    SAP_PRIMARY,
    insets,
  });

  /* redirect if logged out */
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  /* subscribe to meals for selected day */
  useEffect(() => {
    if (!user) return;

    setLoading(true);

    const mealsRef = collection(db, "users", user.uid, "meals");
    const qMeals = query(
      mealsRef,
      where("date", ">=", Timestamp.fromDate(startOfDay(currentDate))),
      where("date", "<=", Timestamp.fromDate(endOfDay(currentDate))),
      orderBy("date", "asc")
    );

    const unsub = onSnapshot(
      qMeals,
      (snap) => {
        setMeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user, currentDate]);

  /* subscribe to goal profile (for targets) */
  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "users", user.uid, "nutrition", "profile");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setGoal(snap.exists() ? snap.data() : null);
        setGoalLoading(false);
      },
      () => setGoalLoading(false)
    );

    return () => unsub();
  }, [user]);

  /* totals */
  const totals = useMemo(() => {
    return meals.reduce(
      (acc, m) => ({
        calories: acc.calories + Number(m.calories || 0),
        protein: acc.protein + Number(m.protein || 0),
        carbs: acc.carbs + Number(m.carbs || 0),
        fat: acc.fat + Number(m.fat || 0),

        fibre: acc.fibre + Number(m.fibre ?? m.fiber ?? 0),
        sugar: acc.sugar + Number(m.sugar || 0),
        sodium: acc.sodium + Number(m.sodium || 0),

        saturatedFat:
          acc.saturatedFat + Number(m.saturatedFat ?? m.satFat ?? 0),
        polyunsaturatedFat:
          acc.polyunsaturatedFat +
          Number(m.polyunsaturatedFat ?? m.polyFat ?? 0),
        monounsaturatedFat:
          acc.monounsaturatedFat +
          Number(m.monounsaturatedFat ?? m.monoFat ?? 0),
        transFat: acc.transFat + Number(m.transFat || 0),
        cholesterol: acc.cholesterol + Number(m.cholesterol || 0),

        potassium: acc.potassium + Number(m.potassium || 0),
        vitaminA: acc.vitaminA + Number(m.vitaminA || 0),
        vitaminC: acc.vitaminC + Number(m.vitaminC || 0),
        calcium: acc.calcium + Number(m.calcium || 0),
        iron: acc.iron + Number(m.iron || 0),
      }),
      {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fibre: 0,
        sugar: 0,
        sodium: 0,
        saturatedFat: 0,
        polyunsaturatedFat: 0,
        monounsaturatedFat: 0,
        transFat: 0,
        cholesterol: 0,
        potassium: 0,
        vitaminA: 0,
        vitaminC: 0,
        calcium: 0,
        iron: 0,
      }
    );
  }, [meals]);

  /* group into buckets */
  const buckets = useMemo(() => {
    const result = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    meals.forEach((m) => {
      const bucket = getBucketForMeal(m);
      result[bucket].push(m);
    });
    return result;
  }, [meals]);

  const bucketCalories = useMemo(() => {
    const sum = (arr) =>
      arr.reduce((acc, m) => acc + Number(m.calories || 0), 0);
    return {
      breakfast: sum(buckets.breakfast),
      lunch: sum(buckets.lunch),
      dinner: sum(buckets.dinner),
      snacks: sum(buckets.snacks),
    };
  }, [buckets]);

  const currentLabel = useMemo(() => fmtShortDate(currentDate), [currentDate]);

  const isToday = useMemo(() => {
    const now = new Date();
    return startOfDay(now).getTime() === startOfDay(currentDate).getTime();
  }, [currentDate]);

  const canGoForward = !isToday;

  const shiftDay = (delta) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + delta);
      return d;
    });
  };

  const openAddMeal = (mealType) => {
    const dateISO = startOfDay(currentDate).toISOString();
    router.push({
      pathname: "/nutrition/add-food",
      params: mealType ? { date: dateISO, mealType } : { date: dateISO },
    });
  };

  const dailyGoal = Number(goal?.dailyCalories || 0);
  const kcalLeft =
    dailyGoal > 0 ? Math.max(0, Math.round(dailyGoal - totals.calories)) : null;

  const macroTargets = useMemo(
    () => ({
      protein: goal ? Number(goal.proteinTarget || 0) : 0,
      carbs: goal ? Number(goal.carbTarget || 0) : 0,
      fat: goal ? Number(goal.fatTarget || 0) : 0,
    }),
    [goal]
  );

  const progressPct = useMemo(() => {
    if (!dailyGoal) return 0;
    return clamp((totals.calories / dailyGoal) * 100, 0, 140);
  }, [totals.calories, dailyGoal]);

  const headerSubtitle = useMemo(() => {
    if (!goal || !dailyGoal) return `${currentLabel}`;
    const p = Math.round(clamp(progressPct, 0, 999));
    return `${currentLabel} • ${p}% of target`;
  }, [goal, dailyGoal, currentLabel, progressPct]);

  /* AI analysis of the day */
  useEffect(() => {
    if (!goal || !API_URL) {
      setAnalysis("");
      return;
    }

    const hasAny =
      totals.calories || totals.protein || totals.carbs || totals.fat;

    if (!hasAny) {
      setAnalysis("");
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setAnalysisLoading(true);

        const res = await fetch(`${API_URL}/nutrition/analyse-day`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totals, goal }),
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
    return () => {
      cancelled = true;
    };
  }, [goal, totals]);

  /* ---- UI helpers ---- */

  const renderMealRow = (item) => {
    const icon = mealTypeIcon(item.mealType || item.type || item.meal);

    return (
      <TouchableOpacity
        key={item.id}
        style={s.mealRow}
        activeOpacity={0.78}
        onPress={() => router.push(`/nutrition/${item.id}`)}
      >
        <View style={s.mealIconPill}>
          <Feather name={icon} size={14} color={s.accentColor} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.mealTitle} numberOfLines={1}>
            {item.title || "Entry"}
          </Text>
          {!!item.notes && (
            <Text style={s.mealNotes} numberOfLines={1}>
              {item.notes}
            </Text>
          )}
        </View>

        <View style={s.mealRightCol}>
          <Text style={s.mealKcal}>{Math.round(item.calories || 0)} kcal</Text>
          <Text style={s.mealMacros}>
            P {Math.round(item.protein || 0)} · C {Math.round(item.carbs || 0)} ·
            F {Math.round(item.fat || 0)}
          </Text>
        </View>

        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </TouchableOpacity>
    );
  };

  const renderBucket = (label, key, icon) => {
    const list = buckets[key] || [];
    const kcal = Math.round(bucketCalories[key] || 0);

    return (
      <View style={s.section} key={key}>
        <View style={s.sectionHeaderRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={s.sectionIcon}>
              <Feather name={icon} size={15} color={colors.text} />
            </View>
            <View>
              <Text style={s.sectionTitle}>{label}</Text>
              <Text style={s.sectionSub}>{kcal} kcal</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openAddMeal(mealTypeForBucket(key))}
            style={s.sectionAddBtn}
          >
            <Feather name="plus" size={16} color={s.onAccent} />
          </TouchableOpacity>
        </View>

        <View style={s.sectionCard}>
          {list.length === 0 ? (
            <Text style={s.emptySmall}>Nothing logged.</Text>
          ) : (
            list.map((m, idx) => (
              <View key={m.id} style={idx !== list.length - 1 && s.rowDivider}>
                {renderMealRow(m)}
              </View>
            ))
          )}
        </View>
      </View>
    );
  };

  return (
    // ✅ FULL SCREEN TOP: remove SafeArea padding at top so the hero fills the whole screen.
    // We handle the notch spacing inside the hero with insets.top.
    <SafeAreaView style={s.safe} edges={["left", "right", "bottom"]}>
      <View style={s.page}>
        {/* FULL-SCREEN HERO TOP */}
        <View style={s.heroWrap}>
          <LinearGradient
            colors={
              isDark
                ? [SAP_PRIMARY + "2A", "transparent"]
                : [SAP_PRIMARY + "33", "transparent"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.heroGlow}
          />

          {/* notch-safe content */}
          <View style={[s.heroContent, { paddingTop: Math.max(insets.top, 12) }]}>
            <View style={s.headerRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={s.iconBtn}
                activeOpacity={0.85}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="chevron-left" size={18} color={colors.text} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={s.headerTitle}>Nutrition</Text>
                <Text style={s.headerSubtitle}>{headerSubtitle}</Text>
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => openAddMeal()}
                style={[
                  s.iconBtn,
                  { backgroundColor: s.accentColor, borderColor: "transparent" },
                ]}
              >
                <Feather name="plus" size={18} color={s.onAccent} />
              </TouchableOpacity>
            </View>

            <View style={s.dayNavRow}>
              <TouchableOpacity
                onPress={() => shiftDay(-1)}
                style={s.dayNavBtn}
                activeOpacity={0.85}
              >
                <Feather name="chevron-left" size={18} color={s.accentColor} />
                <Text style={s.dayNavText}>Prev</Text>
              </TouchableOpacity>

              <View style={s.dayChip}>
                <Text style={s.dayChipText}>{isToday ? "Today" : "Day"}</Text>
              </View>

              <TouchableOpacity
                onPress={canGoForward ? () => shiftDay(1) : undefined}
                disabled={!canGoForward}
                style={[s.dayNavBtn, !canGoForward && { opacity: 0.45 }]}
                activeOpacity={0.85}
              >
                <Text style={s.dayNavText}>Next</Text>
                <Feather name="chevron-right" size={18} color={s.accentColor} />
              </TouchableOpacity>
	            </View>
	
	            <View style={s.headerMetaRow}>
	              <View
	                style={[
	                  s.headerMetaPill,
	                  goal ? s.headerMetaPillGood : s.headerMetaPillWarn,
	                ]}
	              >
	                <Feather
	                  name={goal ? "check-circle" : "alert-circle"}
	                  size={13}
	                  color={goal ? "#14532d" : "#7f1d1d"}
	                />
	                <Text style={s.headerMetaPillText}>
	                  {goal ? "Goal active" : "Set daily goal"}
	                </Text>
	              </View>
	
	              <View style={s.headerMetaPill}>
	                <Feather name="list" size={13} color={colors.subtext} />
	                <Text style={s.headerMetaPillText}>
	                  {meals.length} item{meals.length === 1 ? "" : "s"}
	                </Text>
	              </View>
	            </View>

	            <View style={s.progressCard}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.progressTitle}>Daily target</Text>
                  <Text style={s.progressValue}>
                    {Math.round(totals.calories)}{" "}
                    <Text style={s.progressUnit}>
                      / {Math.round(dailyGoal || 0)} kcal
                    </Text>
                  </Text>
                  <Text style={s.progressSub}>
                    {dailyGoal
                      ? `Left: ${kcalLeft != null ? kcalLeft : "-"} kcal`
                      : "Set a calorie target to enable progress tracking."}
                  </Text>
                </View>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => router.push("/nutrition/food-quality")}
                  style={s.pillBtn}
                >
                  <Text style={s.pillBtnText}>Food quality</Text>
                  <Feather name="chevron-right" size={16} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 12 }}>
                <View style={s.progressTrack}>
                  <View
                    style={[
                      s.progressFill,
                      { width: `${Math.min(100, progressPct)}%` },
                    ]}
                  />
                </View>
                {dailyGoal > 0 && progressPct > 100 ? (
                  <Text style={s.progressOver}>
                    Over target by{" "}
                    {Math.max(0, Math.round(totals.calories - dailyGoal))} kcal
                  </Text>
                ) : null}
              </View>

              <View style={s.quickActions}>
                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={() => openAddMeal()}
                  style={[s.quickBtn, { backgroundColor: s.accentColor }]}
                >
                  <Feather name="plus" size={16} color={s.onAccent} />
                  <Text style={[s.quickBtnText, { color: s.onAccent }]}>
                    Add meal
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={() => router.push("/nutrition")}
                  style={[
                    s.quickBtn,
                    { backgroundColor: isDark ? "#18191E" : "#E6E7EC" },
                  ]}
                >
                  <Feather name="grid" size={16} color={colors.text} />
                  <Text style={[s.quickBtnText, { color: colors.text }]}>
                    Nutrition home
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {loading || goalLoading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={s.accentColor} />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
          >
            {/* ✅ REMOVED DUPLICATE: the old Overview carousel section is gone */}

            {/* Coach note */}
            {!!goal && (
              <View style={s.section}>
                <View style={s.sectionHeaderRow}>
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                  >
                    <View style={s.sectionIcon}>
                      <Feather name="zap" size={15} color={colors.text} />
                    </View>
                    <Text style={s.sectionTitle}>Coach note</Text>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => router.push("/nutrition/food-quality")}
                    style={s.smallGhostBtn}
                  >
                    <Text style={s.smallGhostBtnText}>Details</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={s.sectionCard}>
                  {analysisLoading ? (
                    <ActivityIndicator color={s.accentColor} />
                  ) : analysis ? (
                    <View>
                      <Text style={s.coachTitle}>AI summary</Text>
                      <Text style={s.coachText}>{analysis}</Text>
                    </View>
                  ) : (
                    <Text style={s.emptySmall}>
                      Log some meals to see an AI breakdown of your day.
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Meals */}
            {renderBucket("Breakfast", "breakfast", "sunrise")}
            {renderBucket("Lunch", "lunch", "sun")}
            {renderBucket("Dinner", "dinner", "moon")}
            {renderBucket("Snacks", "snacks", "bookmark")}

            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ---------- small UI bits ---------- */

function KpiPill({ label, value, sub, colors, isDark, accent }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 18,
        padding: 12,
        backgroundColor: isDark ? "#111217" : "#FFFFFF",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDark ? "#1B1C22" : "#E6E7EC",
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.7,
          color: colors.subtext,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontSize: 18,
          fontWeight: "900",
          color: colors.text,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          marginTop: 4,
          fontSize: 12,
          fontWeight: "700",
          color: colors.subtext,
        }}
      >
        {sub}
      </Text>
      <View
        style={{
          marginTop: 10,
          height: 2,
          borderRadius: 999,
          backgroundColor: accent,
          opacity: isDark ? 0.35 : 0.22,
        }}
      />
    </View>
  );
}

/* ---------- styles ---------- */

function makeStyles({
  colors,
  isDark,
  BG,
  SURFACE,
  SURFACE_ALT,
  BORDER,
  TRACK,
  ACCENT,
  ACCENT_ON,
  SAP_PRIMARY,
  insets,
}) {
  const headerTitleColor = colors.headerTitle || colors.text;

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG },
    page: { flex: 1, paddingHorizontal: PAGE_PAD },

    /* HERO */
    heroWrap: {
      position: "relative",
      marginLeft: -PAGE_PAD,
      marginRight: -PAGE_PAD,
      paddingHorizontal: PAGE_PAD,
      // ✅ full screen feel: extend hero background up under the status bar area
      paddingTop: 0,
      paddingBottom: 14,
      backgroundColor: BG,
    },
    heroGlow: {
      position: "absolute",
      left: 0,
      right: 0,
      top: -(insets?.top || 0), // ✅ push glow under status bar
      height: 220 + (insets?.top || 0),
    },
    heroContent: {
      // actual content gets notch padding via inline style in JSX
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingBottom: 8,
    },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#D9DDE5",
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: 0.1,
      color: headerTitleColor,
    },
    headerSubtitle: {
      marginTop: 2,
      color: colors.subtext,
      fontSize: 13,
      fontWeight: "600",
    },

    dayNavRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 2,
      marginBottom: 12,
    },
    dayNavBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#D9DDE5",
    },
    dayNavText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
      letterSpacing: 0.1,
    },

    dayChip: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: isDark ? "#00000055" : "#FFFFFFAA",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#D9DDE5",
    },
    dayChipText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
      letterSpacing: 0.1,
    },

    headerMetaRow: {
      marginBottom: 10,
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
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#D9DDE5",
    },
    headerMetaPillGood: {
      backgroundColor: isDark ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.12)",
      borderColor: isDark ? "rgba(34,197,94,0.35)" : "rgba(34,197,94,0.35)",
    },
    headerMetaPillWarn: {
      backgroundColor: isDark ? "rgba(248,113,113,0.18)" : "rgba(248,113,113,0.12)",
      borderColor: isDark ? "rgba(248,113,113,0.38)" : "rgba(248,113,113,0.35)",
    },
    headerMetaPillText: {
      fontSize: 11,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.1,
    },

    kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },

    progressCard: {
      backgroundColor: SURFACE_ALT,
      borderRadius: 16,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: BORDER,
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.16 : 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
      marginBottom: 10,
    },
    progressTitle: {
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 0.7,
      color: colors.subtext,
      textTransform: "uppercase",
    },
    progressValue: {
      marginTop: 8,
      fontSize: 22,
      fontWeight: "900",
      color: colors.text,
    },
    progressUnit: { fontSize: 13, fontWeight: "800", color: colors.subtext },
    progressSub: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: "700",
      color: colors.subtext,
      lineHeight: 18,
    },

    pillBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#D2D7E0",
    },
    pillBtnText: { fontSize: 12, fontWeight: "800", color: colors.text },

    progressTrack: {
      height: 10,
      borderRadius: 999,
      backgroundColor: TRACK,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: SAP_PRIMARY,
    },

    progressOver: {
      marginTop: 8,
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "800",
    },

    quickActions: { marginTop: 12, flexDirection: "row", gap: 10 },
    quickBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.10)",
    },
    quickBtnText: {
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.15,
    },

    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    scrollContent: { paddingBottom: 70 },

    section: { marginTop: 18 },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },

    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.2,
    },
    sectionSub: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "800",
      color: colors.subtext,
    },

    sectionAddBtn: {
      width: 34,
      height: 34,
      borderRadius: 12,
      backgroundColor: ACCENT,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
    },

    smallGhostBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.12)" : "#D9DDE5",
    },
    smallGhostBtnText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
      letterSpacing: 0.1,
    },

    sectionCard: {
      backgroundColor: SURFACE_ALT,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: BORDER,
      paddingHorizontal: 14,
      paddingVertical: 10,
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.14 : 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 5 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: BORDER },

    emptySmall: {
      color: colors.subtext,
      fontSize: 13,
      paddingVertical: 6,
      fontWeight: "700",
    },

    coachTitle: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "800",
      marginBottom: 6,
      letterSpacing: 0.3,
    },
    coachText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
    },

    mealRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 10 },
    mealIconPill: {
      width: 30,
      height: 30,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    mealTitle: { fontSize: 14, fontWeight: "900", color: colors.text },
    mealNotes: { fontSize: 12, color: colors.subtext, fontWeight: "700", marginTop: 2 },
    mealRightCol: { alignItems: "flex-end" },
    mealKcal: { fontWeight: "900", color: colors.text, fontSize: 13 },
    mealMacros: { marginTop: 3, fontWeight: "800", color: colors.subtext, fontSize: 11 },
  });

  styles.accentColor = ACCENT;
  styles.fillNeon = SAP_PRIMARY;
  styles.onAccent = ACCENT_ON;

  return styles;
}
