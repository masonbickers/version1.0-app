import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../providers/ThemeProvider";
import { useHomeDashboardData } from "../../../src/hooks/useHomeDashboardData";
import HomeHeader from "../../../components/home/HomeHeader";
import InsightBlock from "../../../components/home/InsightBlock";
import NoPlanState from "../../../components/home/NoPlanState";
import QuickActions from "../../../components/home/QuickActions";
import TodayHero from "../../../components/home/TodayHero";
import WeekProgress from "../../../components/home/WeekProgress";
import WeekTimeline from "../../../components/home/WeekTimeline";

export default function HomeIndexPage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const {
    loading,
    refreshing,
    loadError,
    hasPlan,
    greeting,
    dateLabel,
    statusLabel,
    weekLabel,
    metrics,
    timeline,
    todayHero,
    insight,
    quickActions,
    refresh,
  } = useHomeDashboardData();

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const styles = useMemo(
    () => makeStyles(colors, isDark, accentBg),
    [colors, isDark, accentBg]
  );

  const go = (path) => router.push(path);
  const openTodayPrimary = () => {
    if (todayHero?.completed && todayHero?.savedTrainSessionId) {
      router.push(`/train/history/${encodeURIComponent(todayHero.savedTrainSessionId)}`);
      return;
    }
    if (todayHero?.key) {
      router.push({
        pathname: "/train/session/[sessionKey]",
        params: { sessionKey: todayHero.key },
      });
      return;
    }
    go("/home/calendar");
  };

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[
          isDark ? "rgba(230,255,59,0.12)" : "rgba(230,255,59,0.2)",
          colors.bg,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.topFade}
        pointerEvents="none"
      />

      <View style={styles.page}>
        <HomeHeader
          greeting={greeting}
          dateLabel={dateLabel}
          statusLabel={statusLabel}
          refreshing={refreshing}
          colors={colors}
          styles={styles}
          onRefresh={refresh}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {!!loadError && !loading ? (
            <Text style={[styles.errorText, { color: colors.subtext }]}>
              {loadError}
            </Text>
          ) : null}

          {!hasPlan && !loading ? (
            <NoPlanState
              styles={styles}
              colors={colors}
              accentBg={accentBg}
              onPress={() => go("/train/create-home")}
            />
          ) : (
            <>
              <TodayHero
                data={todayHero}
                styles={styles}
                colors={colors}
                accentBg={accentBg}
                onPrimaryPress={openTodayPrimary}
                onSecondaryPress={() => go("/home/calendar")}
              />

              <WeekProgress
                metrics={metrics}
                weekLabel={weekLabel}
                styles={styles}
                colors={colors}
              />

              <WeekTimeline
                items={timeline}
                styles={styles}
                colors={{ ...colors, isDark }}
                accentBg={accentBg}
                onSelectToday={() => go("/home/today")}
                onSelectCalendar={() => go("/home/calendar")}
              />

              <InsightBlock
                insight={insight}
                styles={styles}
                colors={colors}
                accentBg={accentBg}
              />

              <QuickActions
                items={quickActions}
                styles={styles}
                colors={colors}
                onPress={go}
              />
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(colors, isDark, accentBg) {
  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(17,17,17,0.08)";
  const heroBg = isDark ? "#101216" : "#F7F8FA";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    topFade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 240,
    },
    page: {
      flex: 1,
      paddingHorizontal: 20,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingBottom: 156,
      gap: 28,
    },
    header: {
      paddingTop: 6,
      paddingBottom: 22,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    headerGreeting: {
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: -0.6,
    },
    headerDate: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: "500",
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    statusChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 999,
    },
    statusText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    refreshButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
    },
    errorText: {
      fontSize: 13,
      lineHeight: 19,
      marginTop: -8,
    },
    hero: {
      backgroundColor: heroBg,
      borderRadius: 28,
      padding: 22,
      gap: 14,
    },
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    heroEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    heroStateChip: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(17,17,17,0.06)",
    },
    heroStateText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    heroTitle: {
      fontSize: 30,
      lineHeight: 34,
      fontWeight: "800",
      letterSpacing: -1,
    },
    heroSubtitle: {
      fontSize: 15,
      lineHeight: 22,
      maxWidth: "90%",
    },
    heroMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    heroMetaText: {
      fontSize: 13,
      fontWeight: "600",
      paddingRight: 10,
    },
    heroActionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 4,
    },
    heroPrimaryButton: {
      minHeight: 48,
      borderRadius: 999,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    heroPrimaryText: {
      color: "#111111",
      fontSize: 14,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
    heroSecondaryButton: {
      minHeight: 48,
      paddingHorizontal: 4,
      justifyContent: "center",
    },
    heroSecondaryText: {
      fontSize: 14,
      fontWeight: "700",
    },
    section: {
      gap: 12,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    sectionEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    sectionMeta: {
      fontSize: 12,
      fontWeight: "600",
    },
    sectionLink: {
      fontSize: 13,
      fontWeight: "700",
    },
    metricRow: {
      flexDirection: "row",
      gap: 16,
    },
    metricItem: {
      flex: 1,
      position: "relative",
      paddingRight: 8,
    },
    metricValue: {
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    metricLabel: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: "600",
    },
    metricDivider: {
      position: "absolute",
      top: 2,
      right: -8,
      width: StyleSheet.hairlineWidth,
      bottom: 2,
      backgroundColor: divider,
    },
    timelineRow: {
      flexDirection: "row",
      gap: 6,
    },
    timelineItem: {
      flex: 1,
      minHeight: 104,
      borderRadius: 18,
      paddingHorizontal: 6,
      paddingVertical: 12,
      justifyContent: "space-between",
    },
    timelineDay: {
      fontSize: 9,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      textAlign: "center",
    },
    timelineDate: {
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: -0.5,
      textAlign: "center",
    },
    timelineLabel: {
      fontSize: 9,
      lineHeight: 12,
      fontWeight: "600",
      textAlign: "center",
    },
    insightDivider: {
      width: 36,
      height: 2,
      borderRadius: 999,
      backgroundColor: accentBg,
      marginBottom: 4,
    },
    insightTitle: {
      fontSize: 21,
      lineHeight: 27,
      fontWeight: "800",
      letterSpacing: -0.4,
      maxWidth: "85%",
    },
    insightBody: {
      fontSize: 14,
      lineHeight: 21,
      maxWidth: "92%",
    },
    insightAccent: {
      width: 100,
      height: 1,
      opacity: 0.45,
      marginTop: 4,
    },
    actionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    actionPill: {
      minHeight: 42,
      borderRadius: 999,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
    },
    actionPillText: {
      fontSize: 13,
      fontWeight: "700",
    },
  });
}
