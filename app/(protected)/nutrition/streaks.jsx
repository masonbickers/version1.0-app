// app/(protected)/nutrition/streaks.jsx

/**
 * STREAKS PAGE — SAP GEL STYLE
 * - Uses meal logging days to compute streaks
 * - Current streak (incl. today)
 * - Best streak
 * - Simple 30-day activity grid
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
/* -------------- helpers -------------- */

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const ONE_DAY = 24 * 60 * 60 * 1000;

function normaliseDate(tsOrDate) {
  if (!tsOrDate) return null;
  if (tsOrDate?.toDate) return tsOrDate.toDate();
  if (tsOrDate instanceof Date) return tsOrDate;
  const d = new Date(tsOrDate);
  return isNaN(d.getTime()) ? null : d;
}

export default function StreaksPage() {
  const { colors, isDark } = useTheme();

  // SAP neon + silver palette (aligned with Nutrition main page)
  const PRIMARY = colors.sapPrimary || "#E6FF3B"; // neon yellow
  const SILVER_LIGHT = colors.sapSilverLight || "#F3F4F6";
  const SILVER_MEDIUM = colors.sapSilverMedium || "#E1E3E8";

  const accent = PRIMARY;

  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [mealLogs, setMealLogs] = useState([]);

  const s = makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // subscribe to meal logs
  useEffect(() => {
    if (!user) return;

    const ref = collection(db, "users", user.uid, "meals");
    const q = query(ref, orderBy("date", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMealLogs(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  // unique days where at least one meal log exists
  const uniqueDays = useMemo(() => {
    const daySet = new Set();
    const result = [];

    for (const m of mealLogs) {
      const d = normaliseDate(m.date);
      if (!d) continue;
      const sod = startOfDay(d).getTime();
      if (!daySet.has(sod)) {
        daySet.add(sod);
        result.push(sod);
      }
    }

    result.sort((a, b) => a - b); // ascending
    return result;
  }, [mealLogs]);

  const streakStats = useMemo(() => {
    if (uniqueDays.length === 0) {
      return {
        current: 0,
        best: 0,
        totalDays: 0,
        lastEntry: null,
      };
    }

    const daySet = new Set(uniqueDays);

    // current streak (counting back from today)
    let current = 0;
    let cursor = startOfDay(new Date()).getTime();

    while (daySet.has(cursor)) {
      current += 1;
      cursor -= ONE_DAY;
    }

    // best streak in history
    let best = 1;
    let streak = 1;

    for (let i = 1; i < uniqueDays.length; i++) {
      const prev = uniqueDays[i - 1];
      const curr = uniqueDays[i];
      if (curr - prev === ONE_DAY) {
        streak += 1;
      } else {
        streak = 1;
      }
      if (streak > best) best = streak;
    }

    const lastEntry = new Date(uniqueDays[uniqueDays.length - 1]);

    return {
      current,
      best,
      totalDays: uniqueDays.length,
      lastEntry,
    };
  }, [uniqueDays]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, []);

  const formatDateShort = (date) => {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  };

  // activity grid: last 30 days (including today)
  const last30Days = useMemo(() => {
    const today = startOfDay(new Date());
    const days = [];
    const daySet = new Set(uniqueDays);

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * ONE_DAY);
      const ts = d.getTime();
      const hasEntry = daySet.has(ts);
      days.push({ date: d, hasEntry });
    }

    return days;
  }, [uniqueDays]);

  const streakSubtitle = useMemo(() => {
    const { current, best, totalDays } = streakStats;

    if (totalDays === 0) return "No logged days yet.";
    if (current === 0)
      return `You’ve got ${totalDays} tracked day${
        totalDays === 1 ? "" : "s"
      }. Start today to begin a streak.`;
    if (current === best)
      return `Nice — you’re on your best streak so far (${current} day${
        current === 1 ? "" : "s"
      }).`;
    return `Current streak: ${current} day${
      current === 1 ? "" : "s"
    }. Best streak: ${best} day${best === 1 ? "" : "s"}.`;
  }, [streakStats]);

  /* ------------------ UI ------------------ */

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.page}>
        {/* HEADER — SAP / silver style */}
        <View style={s.header}>
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.backButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="chevron-left" size={24} color={PRIMARY} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Streaks</Text>
              <Text style={s.headerSubtitle}>
                Today • {todayLabel}
              </Text>
            </View>
          </View>
        </View>

        {loading && (
          <View style={s.loadingOverlay}>
            <ActivityIndicator color={PRIMARY} />
          </View>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
        >
          {/* SUMMARY CARD */}
          <View style={s.section}>
            <View style={s.summaryCard}>
              <View style={s.summaryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.summaryLabel}>Current streak</Text>
                  <Text style={s.summaryValue}>
                    {streakStats.current}
                    <Text style={s.summarySuffix}> days</Text>
                  </Text>
                </View>

                <View style={s.summaryPill}>
                  <Feather name="flame" size={14} color="#111111" />
                  <Text style={s.summaryPillText}>On fire</Text>
                </View>
              </View>

              <View style={s.summaryMetaRow}>
                <View style={s.summaryMetaBlock}>
                  <Text style={s.summaryMetaLabel}>Best streak</Text>
                  <Text style={s.summaryMetaValue}>
                    {streakStats.best} d
                  </Text>
                </View>
                <View style={s.summaryMetaBlock}>
                  <Text style={s.summaryMetaLabel}>Tracked days</Text>
                  <Text style={s.summaryMetaValue}>
                    {streakStats.totalDays}
                  </Text>
                </View>
                <View style={s.summaryMetaBlock}>
                  <Text style={s.summaryMetaLabel}>Last log</Text>
                  <Text style={s.summaryMetaValue}>
                    {streakStats.lastEntry
                      ? formatDateShort(streakStats.lastEntry)
                      : "--"}
                  </Text>
                </View>
              </View>

              <Text style={s.summarySubtitleText}>{streakSubtitle}</Text>
            </View>
          </View>

          {/* ACTIVITY GRID */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Last 30 days</Text>
            </View>

            <View style={s.gridCard}>
              <View style={s.gridRowLabels}>
                {["M", "T", "W", "T", "F", "S", "S"].map((d, idx) => (
                  <Text key={idx} style={s.gridDayLabel}>
                    {d}
                  </Text>
                ))}
              </View>

              <View style={s.grid}>
                {last30Days.map((d, idx) => (
                  <View key={idx} style={s.gridItemWrapper}>
                    <View
                      style={[
                        s.gridDot,
                        d.hasEntry && s.gridDotActive,
                      ]}
                    />
                  </View>
                ))}
              </View>

              <View style={s.gridLegendRow}>
                <View style={s.gridLegendItem}>
                  <View style={s.gridDot} />
                  <Text style={s.gridLegendText}>No log</Text>
                </View>
                <View style={s.gridLegendItem}>
                  <View style={[s.gridDot, s.gridDotActive]} />
                  <Text style={s.gridLegendText}>Logged</Text>
                </View>
              </View>
            </View>
          </View>

          {/* HINT */}
          <View style={s.section}>
            <Text style={s.hintText}>
              Streaks are based on days where you log at least one meal entry.
              Log daily to keep the streak alive.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* ---------------- STYLES (SAP GEL STYLE) ---------------- */

function makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
    page: {
      flex: 1,
      paddingHorizontal: 18,
    },
    scrollContent: {
      paddingBottom: 40,
    },
    loadingOverlay: {
      position: "absolute",
      top: 12,
      right: 18,
      zIndex: 10,
    },

    /* HEADER */
    header: {
      marginTop: 6,
      marginBottom: 18,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    backButton: {
      marginRight: 4,
      paddingVertical: 4,
      paddingRight: 6,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: SILVER_MEDIUM,
      marginBottom: 2,
    },
    headerSubtitle: {
      color: colors.subtext,
      fontSize: 13,
    },

    section: {
      marginBottom: 28,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },

    /* SUMMARY CARD */
    summaryCard: {
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },
    summaryLabel: {
      fontSize: 11,
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      fontWeight: "600",
      marginBottom: 4,
    },
    summaryValue: {
      fontSize: 28,
      fontWeight: "800",
      color: colors.text,
    },
    summarySuffix: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.subtext,
    },
    summaryPill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: PRIMARY,
      gap: 6,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    summaryPillText: {
      fontSize: 12,
      fontWeight: "700",
      color: "#111111",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    summaryMetaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 6,
      marginTop: 2,
    },
    summaryMetaBlock: {
      flex: 1,
    },
    summaryMetaLabel: {
      fontSize: 11,
      color: colors.subtext,
      marginBottom: 2,
    },
    summaryMetaValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    summarySubtitleText: {
      fontSize: 13,
      color: colors.subtext,
      marginTop: 6,
      lineHeight: 18,
    },

    /* GRID */
    gridCard: {
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },
    gridRowLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    gridDayLabel: {
      fontSize: 11,
      color: colors.subtext,
      flex: 1,
      textAlign: "center",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 8,
    },
    gridItemWrapper: {
      width: `${100 / 7}%`,
      paddingVertical: 4,
      alignItems: "center",
      justifyContent: "center",
    },
    gridDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
    gridDotActive: {
      backgroundColor: PRIMARY,
      borderColor: PRIMARY,
    },
    gridLegendRow: {
      flexDirection: "row",
      justifyContent: "flex-start",
      gap: 16,
      marginTop: 4,
    },
    gridLegendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    gridLegendText: {
      fontSize: 11,
      color: colors.subtext,
    },

    hintText: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },
  });
}
