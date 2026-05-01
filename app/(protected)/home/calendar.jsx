import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Feather from "../../../components/LucideFeather";
import { useTheme } from "../../../providers/ThemeProvider";
import { useHomeDashboardData } from "../../../src/hooks/useHomeDashboardData";

function stateLabel(day) {
  if (day.isToday) return "Today";
  if (day.state === "completed") return "Completed";
  if (day.cards?.length) return "Upcoming";
  return "Recovery";
}

export default function HomeCalendarPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const [weekOffset, setWeekOffset] = useState(0);
  const {
    metrics,
    calendarDays,
    loadError,
    weekLabel,
    canGoPrevWeek,
    canGoNextWeek,
  } = useHomeDashboardData({ weekOffset });
  const styles = useMemo(
    () => makeStyles(colors, isDark, accentBg),
    [colors, isDark, accentBg]
  );

  const completedCount = calendarDays.filter((day) =>
    day.cards?.some((card) => card.status === "completed")
  ).length;

  const openCard = (card) => {
    if (card?.status === "completed" && card?.savedTrainSessionId) {
      router.push(`/train/history/${encodeURIComponent(card.savedTrainSessionId)}`);
      return;
    }
    if (card?.key) {
      router.push({
        pathname: "/train/session/[sessionKey]",
        params: { sessionKey: card.key },
      });
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.iconButton}
            activeOpacity={0.82}
          >
            <Feather name="chevron-left" size={18} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCopy}>
            <Text style={[styles.headerEyebrow, { color: colors.subtext }]}>
              Calendar
            </Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {weekLabel || "This week"}
            </Text>
          </View>

          <View style={styles.headerChip}>
            <Text style={[styles.headerChipText, { color: colors.text }]}>
              {completedCount}/{calendarDays.length || 7}
            </Text>
          </View>
        </View>

        <View style={styles.content}>
          {!!loadError ? (
            <Text style={[styles.errorText, { color: colors.subtext }]}>
              {loadError}
            </Text>
          ) : null}

          <View style={styles.weekNavRow}>
            <TouchableOpacity
              style={[styles.weekNavButton, !canGoPrevWeek && styles.weekNavButtonDisabled]}
              onPress={() => setWeekOffset((prev) => prev - 1)}
              activeOpacity={0.82}
              disabled={!canGoPrevWeek}
            >
              <Feather
                name="chevron-left"
                size={14}
                color={!canGoPrevWeek ? colors.subtext : colors.text}
              />
              <Text
                style={[
                  styles.weekNavText,
                  { color: !canGoPrevWeek ? colors.subtext : colors.text },
                ]}
              >
                Prev
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.weekNavButton, !canGoNextWeek && styles.weekNavButtonDisabled]}
              onPress={() => setWeekOffset((prev) => prev + 1)}
              activeOpacity={0.82}
              disabled={!canGoNextWeek}
            >
              <Text
                style={[
                  styles.weekNavText,
                  { color: !canGoNextWeek ? colors.subtext : colors.text },
                ]}
              >
                Next
              </Text>
              <Feather
                name="chevron-right"
                size={14}
                color={!canGoNextWeek ? colors.subtext : colors.text}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.metricRow}>
            {metrics.map((item) => (
              <View key={item.label} style={styles.metricItem}>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {item.value}
                </Text>
                <Text style={[styles.metricLabel, { color: colors.subtext }]}>
                  {item.label}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.list}>
            {calendarDays.map((day) => (
              <View
                key={day.isoDate}
                style={[
                  styles.dayRow,
                  day.isToday && styles.dayRowToday,
                ]}
              >
                <View style={styles.dayRail}>
                  <View
                    style={[
                      styles.dayDot,
                      day.isToday
                        ? { backgroundColor: accentBg }
                        : day.state === "completed"
                          ? styles.dayDotCompleted
                          : styles.dayDotDefault,
                    ]}
                  />
                  <Text style={[styles.dayName, { color: colors.text }]}>
                    {day.day}
                  </Text>
                </View>

                <View style={styles.dayContent}>
                  <View style={styles.dayHeaderRow}>
                    <Text style={[styles.dayDateInline, { color: colors.subtext }]}>
                      {day.date}
                    </Text>
                    <Text style={[styles.dayStatus, { color: colors.subtext }]}>
                      {stateLabel(day)}
                    </Text>
                  </View>

                  {day.cards?.length ? (
                    day.cards.map((card, idx) => (
                      <TouchableOpacity
                        key={`${day.isoDate}-${idx}`}
                        style={styles.sessionLine}
                        onPress={() => openCard(card)}
                        activeOpacity={0.82}
                      >
                        <View style={styles.sessionTopRow}>
                          <Text style={[styles.sessionTitle, { color: colors.text }]}>
                            {card.title || "Session"}
                          </Text>
                          <Text
                            style={[
                              styles.sessionState,
                              card.status === "completed"
                                ? styles.sessionStateCompleted
                                : card.status === "skipped"
                                  ? styles.sessionStateSkipped
                                  : styles.sessionStatePlanned,
                            ]}
                          >
                            {card.status === "completed"
                              ? "Done"
                              : card.status === "skipped"
                                ? "Skipped"
                                : "Planned"}
                          </Text>
                        </View>

                        {!!card.meta ? (
                          <Text style={[styles.sessionMeta, { color: colors.subtext }]}>
                            {card.meta}
                          </Text>
                        ) : null}
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={[styles.sessionEmpty, { color: colors.subtext }]}>
                      No structured session planned
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accentBg) {
  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(17,17,17,0.08)";
  const subtle = isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1, paddingHorizontal: 20 },
    header: {
      paddingTop: 8,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    iconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: subtle,
      alignItems: "center",
      justifyContent: "center",
    },
    headerCopy: {
      flex: 1,
      gap: 2,
    },
    headerEyebrow: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    headerTitle: {
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.5,
    },
    headerChip: {
      minHeight: 30,
      minWidth: 46,
      borderRadius: 999,
      paddingHorizontal: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: subtle,
    },
    headerChipText: {
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    content: {
      flex: 1,
      gap: 14,
    },
    weekNavRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
    },
    weekNavButton: {
      minHeight: 30,
      borderRadius: 999,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: subtle,
    },
    weekNavButtonDisabled: {
      opacity: 0.5,
    },
    weekNavText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    errorText: {
      fontSize: 12,
      lineHeight: 17,
    },
    metricRow: {
      flexDirection: "row",
      gap: 12,
    },
    metricItem: {
      flex: 1,
      paddingVertical: 6,
    },
    metricValue: {
      fontSize: 17,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    metricLabel: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: "600",
    },
    list: {
      flex: 1,
      gap: 6,
    },
    dayRow: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: divider,
    },
    dayRowToday: {
      backgroundColor: subtle,
      borderRadius: 18,
      paddingHorizontal: 10,
      borderTopWidth: 0,
    },
    dayRail: {
      width: 46,
      alignItems: "flex-start",
    },
    dayDot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      marginBottom: 6,
    },
    dayDotCompleted: {
      backgroundColor: isDark ? "#62D38B" : "#237A46",
    },
    dayDotDefault: {
      backgroundColor: isDark ? "#2A2D33" : "#D6DADF",
    },
    dayName: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    dayContent: {
      flex: 1,
      gap: 4,
    },
    dayHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dayDateInline: {
      fontSize: 11,
      fontWeight: "600",
    },
    dayStatus: {
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sessionLine: {
      gap: 2,
      paddingBottom: 4,
    },
    sessionTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 8,
    },
    sessionTitle: {
      flex: 1,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "700",
    },
    sessionMeta: {
      fontSize: 11,
      lineHeight: 14,
    },
    sessionState: {
      fontSize: 9,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
      overflow: "hidden",
    },
    sessionStateCompleted: {
      color: isDark ? "#7BE3A3" : "#237A46",
      backgroundColor: isDark
        ? "rgba(123,227,163,0.12)"
        : "rgba(35,122,70,0.1)",
    },
    sessionStateSkipped: {
      color: isDark ? "#F6C26B" : "#8B6B00",
      backgroundColor: isDark
        ? "rgba(246,194,107,0.12)"
        : "rgba(139,107,0,0.1)",
    },
    sessionStatePlanned: {
      color: colors.text,
      backgroundColor: isDark
        ? "rgba(255,255,255,0.06)"
        : "rgba(17,17,17,0.06)",
    },
    sessionEmpty: {
      fontSize: 12,
      lineHeight: 16,
      paddingTop: 1,
    },
  });
}
