import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Feather from "../../../components/LucideFeather";
import { useTheme } from "../../../providers/ThemeProvider";
import { useHomeDashboardData } from "../../../src/hooks/useHomeDashboardData";

export default function HomeTodayPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { todayHero, insight, loadError } = useHomeDashboardData();
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const styles = useMemo(() => makeStyles(colors, isDark, accentBg), [colors, isDark, accentBg]);
  const openPrimary = () => {
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
    router.push("/home/calendar");
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
            <Text style={[styles.headerEyebrow, { color: colors.subtext }]}>Today</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Session focus</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {!!loadError ? (
            <Text style={[styles.errorText, { color: colors.subtext }]}>{loadError}</Text>
          ) : null}

          <View style={styles.hero}>
            <Text style={[styles.heroEyebrow, { color: colors.subtext }]}>
              {todayHero.eyebrow}
            </Text>
            <Text style={[styles.heroTitle, { color: colors.text }]}>{todayHero.title}</Text>
            <Text style={[styles.heroSubtitle, { color: colors.subtext }]}>
              {todayHero.subtitle}
            </Text>
            <View style={styles.metaRow}>
              {todayHero.meta.map((item) => (
                <Text key={item} style={[styles.metaText, { color: colors.text }]}>
                  {item}
                </Text>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: accentBg }]}
              onPress={openPrimary}
              activeOpacity={0.88}
            >
              <Text style={styles.primaryButtonText}>
                {todayHero.completed ? "Review workout" : "Start workout"}
              </Text>
            </TouchableOpacity>
          </View>

          {insight ? (
            <View style={styles.block}>
              <Text style={[styles.blockEyebrow, { color: colors.subtext }]}>
                {insight.eyebrow}
              </Text>
              <Text style={[styles.blockTitle, { color: colors.text }]}>
                {insight.title}
              </Text>
              <Text style={[styles.blockBody, { color: colors.subtext }]}>
                {insight.body}
              </Text>
            </View>
          ) : null}

          <View style={styles.block}>
            <Text style={[styles.blockEyebrow, { color: colors.subtext }]}>
              Next step
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/home/calendar")}
              activeOpacity={0.82}
            >
              <Text style={[styles.linkText, { color: colors.text }]}>
                Open the full calendar
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accentBg) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1, paddingHorizontal: 20 },
    header: {
      paddingTop: 8,
      paddingBottom: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    iconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerCopy: { gap: 2 },
    headerEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    headerTitle: {
      fontSize: 26,
      fontWeight: "800",
      letterSpacing: -0.7,
    },
    content: {
      paddingBottom: 60,
      gap: 28,
    },
    errorText: {
      fontSize: 13,
      lineHeight: 19,
    },
    hero: {
      backgroundColor: isDark ? "#101216" : "#F7F8FA",
      borderRadius: 28,
      padding: 22,
      gap: 14,
    },
    heroEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.9,
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
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    metaText: {
      fontSize: 13,
      fontWeight: "600",
    },
    primaryButton: {
      minHeight: 48,
      borderRadius: 999,
      paddingHorizontal: 18,
      justifyContent: "center",
      alignItems: "center",
      marginTop: 6,
    },
    primaryButtonText: {
      color: "#111111",
      fontSize: 14,
      fontWeight: "800",
    },
    block: {
      gap: 10,
      paddingTop: 4,
    },
    blockEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    blockTitle: {
      fontSize: 21,
      lineHeight: 27,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    blockBody: {
      fontSize: 14,
      lineHeight: 21,
    },
    linkText: {
      fontSize: 15,
      fontWeight: "700",
    },
  });
}
