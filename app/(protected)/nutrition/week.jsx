// app/(protected)/nutrition/week.jsx

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Timestamp,
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- helpers ---------- */
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

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRAPH_WIDTH = SCREEN_WIDTH - 36; // padding 18 + 18

export default function NutritionWeekPage() {
  const { colors, isDark } = useTheme();

  // SAP neon + silver, same as main nutrition page
  const PRIMARY = colors.sapPrimary || "#E6FF3B";
  const SILVER_LIGHT = colors.sapSilverLight || "#F3F4F6";
  const SILVER_MEDIUM = colors.sapSilverMedium || "#E1E3E8";

  const accent = PRIMARY;
  const router = useRouter();
  const user = auth.currentUser;
  const s = makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM);

  const [loading, setLoading] = useState(true);
  const [weekStats, setWeekStats] = useState(null);

  /* ---------------- LOAD WEEK DATA ---------------- */
  useEffect(() => {
    if (!user) return;

    const loadWeek = async () => {
      try {
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
            byDay[key] = {
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              meals: 0,
            };
          }
          byDay[key].calories += Number(m.calories || 0);
          byDay[key].protein += Number(m.protein || 0);
          byDay[key].carbs += Number(m.carbs || 0);
          byDay[key].fat += Number(m.fat || 0);
          byDay[key].meals += 1;
        });

        const days = Object.keys(byDay).sort(); // YYYY-MM-DD ascending

        // base totals using all tracked days
        const totals = days.reduce(
          (acc, k) => ({
            calories: acc.calories + byDay[k].calories,
            protein: acc.protein + byDay[k].protein,
            carbs: acc.carbs + byDay[k].carbs,
            fat: acc.fat + byDay[k].fat,
            days: acc.days + 1,
          }),
          { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
        );

        const avgAll =
          totals.days > 0
            ? {
                calories: Math.round(totals.calories / totals.days),
                protein: Math.round(totals.protein / totals.days),
                carbs: Math.round(totals.carbs / totals.days),
                fat: Math.round(totals.fat / totals.days),
              }
            : { calories: 0, protein: 0, carbs: 0, fat: 0 };

        // --- anomaly detection (based on calories) ---
        const dailyList = days.map((key) => ({
          key,
          ...byDay[key],
        }));

        const calorieValues = dailyList
          .map((d) => Number(d.calories || 0))
          .filter((v) => v > 0)
          .sort((a, b) => a - b);

        let medianCalories = 0;
        if (calorieValues.length > 0) {
          const mid = Math.floor(calorieValues.length / 2);
          if (calorieValues.length % 2 === 1) {
            medianCalories = calorieValues[mid];
          } else {
            medianCalories = Math.round(
              (calorieValues[mid - 1] + calorieValues[mid]) / 2
            );
          }
        }

        // mark anomalies: very low or very high vs median
        const LOW_FACTOR = 0.5; // 50% of median
        const HIGH_FACTOR = 1.5; // 150% of median

        const withFlags = dailyList.map((d) => {
          const kcal = Number(d.calories || 0);

          let isAnomaly = false;
          let reason = "";

          if (!medianCalories || kcal === 0) {
            isAnomaly = false;
          } else if (kcal < medianCalories * LOW_FACTOR) {
            isAnomaly = true;
            reason = "Very low vs median";
          } else if (kcal > medianCalories * HIGH_FACTOR) {
            isAnomaly = true;
            reason = "Very high vs median";
          }

          return {
            ...d,
            isAnomaly,
            anomalyReason: reason,
          };
        });

        const cleanDays = withFlags.filter((d) => !d.isAnomaly);
        const cleanCount = cleanDays.length;

        const cleanTotals =
          cleanCount > 0
            ? cleanDays.reduce(
                (acc, d) => ({
                  calories: acc.calories + d.calories,
                  protein: acc.protein + d.protein,
                  carbs: acc.carbs + d.carbs,
                  fat: acc.fat + d.fat,
                  days: acc.days + 1,
                }),
                { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
              )
            : { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 };

        const avgClean =
          cleanTotals.days > 0
            ? {
                calories: Math.round(cleanTotals.calories / cleanTotals.days),
                protein: Math.round(cleanTotals.protein / cleanTotals.days),
                carbs: Math.round(cleanTotals.carbs / cleanTotals.days),
                fat: Math.round(cleanTotals.fat / cleanTotals.days),
              }
            : avgAll;

        setWeekStats({
          byDay,
          days,
          avgAll,
          avgClean,
          totalDays: totals.days,
          medianCalories,
          anomaliesCount: withFlags.filter((d) => d.isAnomaly).length,
          dailyList: withFlags,
        });
      } catch (err) {
        console.error("Load week nutrition error:", err);
      } finally {
        setLoading(false);
      }
    };

    loadWeek();
  }, [user]);

  /* ------------ period header (date range) ------------ */
  const periodLabel = useMemo(() => {
    if (!weekStats?.days?.length) return "Last 7 days";
    const sorted = weekStats.days;

    const fmt = (dateStr) =>
      new Date(dateStr).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });

    return `${fmt(sorted[0])} – ${fmt(sorted[sorted.length - 1])}`;
  }, [weekStats]);

  /* ------------ insights ------------ */
  const insights = useMemo(() => {
    if (!weekStats?.dailyList?.length) {
      return {
        headline: "Not enough data yet.",
        lines: ["Log a few days of meals to unlock weekly insights."],
      };
    }

    const days = weekStats.dailyList;
    const nonZero = days.filter((d) => d.calories > 0);

    if (!nonZero.length) {
      return {
        headline: "No calories logged.",
        lines: ["Add meals to see your weekly calorie pattern."],
      };
    }

    const sortedByCals = [...nonZero].sort(
      (a, b) => a.calories - b.calories
    );

    const lowest = sortedByCals[0];
    const highest = sortedByCals[sortedByCals.length - 1];

    const range = highest.calories - lowest.calories;

    const consistency =
      range <= 300
        ? "Very consistent calorie intake across the week."
        : range <= 600
        ? "Reasonably consistent, with some higher and lower days."
        : "Quite a bit of variation between your highest and lowest days.";

    const formatDay = (key) =>
      new Date(key).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });

    const headline =
      weekStats.avgClean?.calories && weekStats.medianCalories
        ? `Smoothed average: ~${weekStats.avgClean.calories} kcal/day`
        : "Weekly pattern summary";

    const anomalyLine =
      weekStats.anomaliesCount && weekStats.anomaliesCount > 0
        ? `Ignored ${weekStats.anomaliesCount} anomalous day${
            weekStats.anomaliesCount === 1 ? "" : "s"
          } when smoothing the averages.`
        : "No obvious outlier days this week.";

    return {
      headline,
      lines: [
        `Highest day: ${Math.round(
          highest.calories
        )} kcal (${formatDay(highest.key)}).`,
        `Lowest day: ${Math.round(
          lowest.calories
        )} kcal (${formatDay(lowest.key)}).`,
        `Range between highest and lowest: ~${Math.round(range)} kcal.`,
        consistency,
        anomalyLine,
      ],
    };
  }, [weekStats]);

  if (!user) return null;

  return (
    <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
      {/* HEADER */}
      <View style={s.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={24} color={accent} />
        </TouchableOpacity>

        <View style={s.headerTextWrap}>
          <Text style={s.headerTitle}>Week</Text>
          <Text style={s.headerSubtitle}>{periodLabel}</Text>

          <View style={s.headerMetaRow}>
            <View style={s.headerMetaPill}>
              <Feather name="calendar" size={13} color={colors.subtext} />
              <Text style={s.headerMetaText}>
                {weekStats?.totalDays ?? 0} day{(weekStats?.totalDays ?? 0) === 1 ? "" : "s"} tracked
              </Text>
            </View>

            {!!weekStats?.anomaliesCount && (
              <View style={s.headerMetaPillWarn}>
                <Feather name="alert-circle" size={13} color="#b91c1c" />
                <Text style={s.headerMetaText}>
                  {weekStats.anomaliesCount}{" "}
                  {weekStats.anomaliesCount === 1 ? "anomaly" : "anomalies"}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* LOADING / EMPTY */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={accent} />
        </View>
      ) : !weekStats ? (
        <View style={s.center}>
          <Text style={s.emptyText}>
            No data found for the last 7 days.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* SUMMARY CARD — CLEAN vs RAW */}
          <View style={s.summaryCard}>
            <Text style={s.summaryTitle}>Daily averages</Text>

            <View style={s.summaryRow}>
              <Mini
                label="Smoothed kcal"
                value={`${weekStats.avgClean.calories} kcal`}
                colors={colors}
              />
              <Mini
                label="Protein"
                value={`${weekStats.avgClean.protein} g`}
                colors={colors}
              />
              <Mini
                label="Carbs"
                value={`${weekStats.avgClean.carbs} g`}
                colors={colors}
              />
              <Mini
                label="Fat"
                value={`${weekStats.avgClean.fat} g`}
                colors={colors}
              />
            </View>

            <View style={s.summarySubRow}>
              <Text style={s.summarySubLabel}>Raw avg</Text>
              <Text style={s.summarySubValue}>
                {weekStats.avgAll.calories} kcal / day
              </Text>
            </View>

            <Text style={s.summaryHint}>
              Based on {weekStats.totalDays} tracked day
              {weekStats.totalDays === 1 ? "" : "s"}. Anomalous days are
              excluded from the smoothed averages.
            </Text>
          </View>

          {/* INSIGHTS CARD */}
          <View style={s.insightCard}>
            <Text style={s.insightTitle}>Insights</Text>
            <Text style={s.insightHeadline}>
              {insights.headline}
            </Text>
            {insights.lines.map((line, idx) => (
              <View key={idx} style={s.insightLineRow}>
                <View style={s.bulletDot} />
                <Text style={s.insightText}>{line}</Text>
              </View>
            ))}
          </View>

          {/* WEEKLY GRAPH */}
          <View style={s.graphCard}>
            <View style={s.graphHeaderRow}>
              <Text style={s.sectionTitle}>Calories trend</Text>
              {weekStats.medianCalories ? (
                <Text style={s.graphMeta}>
                  Median: {weekStats.medianCalories} kcal
                </Text>
              ) : null}
            </View>

            {weekStats.dailyList && weekStats.dailyList.length > 0 ? (
              <View style={s.graphWrapper}>
                {weekStats.dailyList.map((d) => (
                  <DayBar
                    key={d.key}
                    dayKey={d.key}
                    calories={d.calories}
                    isAnomaly={d.isAnomaly}
                    colors={colors}
                    accent={accent}
                  />
                ))}
              </View>
            ) : (
              <Text style={s.emptyTextSmall}>
                No days with calories yet.
              </Text>
            )}
          </View>

          {/* BREAKDOWN TABLE */}
          <Text style={s.sectionTitle}>Day-by-day breakdown</Text>

          <View style={s.tableHeader}>
            <Text style={[s.tableCellDate, s.tableHeaderText]}>Date</Text>
            <Text style={[s.tableCell, s.tableHeaderText]}>Kcal</Text>
            <Text style={[s.tableCell, s.tableHeaderText]}>P</Text>
            <Text style={[s.tableCell, s.tableHeaderText]}>C</Text>
            <Text style={[s.tableCell, s.tableHeaderText]}>F</Text>
            <Text style={[s.tableCell, s.tableHeaderText]}>Meals</Text>
          </View>

          {weekStats.days
            .slice()
            .reverse()
            .map((key) => {
              const d = weekStats.byDay[key];
              const full = weekStats.dailyList.find((x) => x.key === key);
              const dateLabel = new Date(key).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
              });

              const isAnomaly = full?.isAnomaly;
              return (
                <View
                  key={key}
                  style={[
                    s.tableRow,
                    isAnomaly && s.tableRowAnomaly,
                  ]}
                >
                  <Text style={s.tableCellDate}>
                    {dateLabel}
                    {isAnomaly ? " *" : ""}
                  </Text>
                  <Text style={s.tableCell}>
                    {Math.round(d.calories)}
                  </Text>
                  <Text style={s.tableCell}>
                    {Math.round(d.protein)}
                  </Text>
                  <Text style={s.tableCell}>
                    {Math.round(d.carbs)}
                  </Text>
                  <Text style={s.tableCell}>
                    {Math.round(d.fat)}
                  </Text>
                  <Text style={s.tableCell}>{d.meals}</Text>
                </View>
              );
            })}

          {weekStats.anomaliesCount > 0 && (
            <Text style={s.anomalyFootnote}>
              * Marked days were treated as anomalies for the smoothed
              averages (very low or high vs weekly median calories).
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------- Mini card ---------- */
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

/* ---------- Day bar (graph row) ---------- */
function DayBar({ dayKey, calories, isAnomaly, colors, accent }) {
  const d = new Date(dayKey);
  const label = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
  });

  const safeKcal = Math.max(0, Number(calories || 0));
  // clamp bar width to 0–100% based on simple scaling against 3500 kcal
  const pct = Math.max(
    4, // tiny minimum so zero doesn't disappear
    Math.min(100, (safeKcal / 3500) * 100)
  );

  const s = StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
      gap: 8,
    },
    date: {
      width: 70,
      fontSize: 12,
      color: colors.subtext,
    },
    barTrack: {
      flex: 1,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.border,
      overflow: "hidden",
    },
    barFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: isAnomaly ? "#FF3B30" : accent,
    },
    value: {
      width: 70,
      textAlign: "right",
      fontSize: 12,
      color: isAnomaly ? "#FF3B30" : colors.text,
      fontWeight: isAnomaly ? "700" : "500",
    },
  });

  return (
    <View style={s.row}>
      <Text style={s.date}>{label}</Text>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={s.value}>
        {Math.round(safeKcal)} kcal
      </Text>
    </View>
  );
}

/* ---------- styles ---------- */
function makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM) {
  const cardBg = isDark ? "#12141A" : SILVER_LIGHT;
  const panelBg = isDark ? "#0E1015" : "#FFFFFF";
  const borderSoft = isDark ? "rgba(255,255,255,0.11)" : SILVER_MEDIUM;
  const borderHard = isDark ? "rgba(255,255,255,0.17)" : "#D7DBE3";

  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 10,
    },
    backBtn: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderHard,
      marginTop: 2,
    },
    headerTextWrap: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: 0.1,
      color: colors.text,
    },
    headerSubtitle: {
      color: colors.subtext,
      fontSize: 13,
      marginTop: 2,
    },
    headerMetaRow: {
      marginTop: 9,
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
    headerMetaPillWarn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(248,113,113,0.18)" : "rgba(248,113,113,0.12)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(248,113,113,0.38)" : "rgba(248,113,113,0.34)",
    },
    headerMetaText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.1,
    },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },

    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 32,
    },

    summaryCard: {
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 18,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    summaryTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 8,
      letterSpacing: 0.2,
    },
    summaryRow: {
      flexDirection: "row",
      marginBottom: 8,
    },
    summarySubRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4,
    },
    summarySubLabel: {
      fontSize: 12,
      color: colors.subtext,
    },
    summarySubValue: {
      fontSize: 13,
      color: colors.text,
      fontWeight: "600",
    },
    summaryHint: {
      fontSize: 11,
      color: colors.subtext,
      lineHeight: 16,
    },

    /* INSIGHTS */
    insightCard: {
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 18,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    insightTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 4,
      letterSpacing: 0.2,
    },
    insightHeadline: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 6,
    },
    insightLineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginBottom: 4,
    },
    bulletDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginTop: 6,
      backgroundColor: PRIMARY,
    },
    insightText: {
      flex: 1,
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },

    /* GRAPH CARD */
    graphCard: {
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 18,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    graphHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 0.2,
    },
    graphMeta: {
      fontSize: 12,
      color: colors.subtext,
    },
    graphWrapper: {
      width: GRAPH_WIDTH,
      maxWidth: "100%",
    },

    /* table */
    tableHeader: {
      flexDirection: "row",
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      marginBottom: 2,
      marginTop: 4,
    },
    tableHeaderText: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: "600",
    },

    tableRow: {
      flexDirection: "row",
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    tableRowAnomaly: {
      backgroundColor: isDark ? "#1C0B0B" : "#FFF4F2",
    },
    tableCellDate: {
      flex: 1.4,
      fontSize: 13,
      color: colors.text,
    },
    tableCell: {
      flex: 0.8,
      fontSize: 13,
      color: colors.text,
      textAlign: "right",
    },

    anomalyFootnote: {
      fontSize: 11,
      color: colors.subtext,
      marginTop: 6,
      marginBottom: 4,
    },

    emptyText: {
      fontSize: 14,
      color: colors.subtext,
    },
    emptyTextSmall: {
      fontSize: 12,
      color: colors.subtext,
    },
  });
}
