"use client";

/**
 * Nutrition Stats — scrollable list style (Garmin-like)
 * Fix: wrap content in ScrollView + safe bottom padding
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../../providers/ThemeProvider";

export default function NutritionStatsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const items = [
    {
      title: "Daily Summary",
      subtitle: "Calories, macros, and goal progress",
      route: "/nutrition/today",
    },
    {
      title: "Food Quality",
      subtitle: "Whole-food score + improvements",
      route: "/nutrition/food-quality",
    },
    {
      title: "Training Fuel Match",
      subtitle: "Fuel vs training load + timing",
      route: "/nutrition/fuelmatch",
    },
    {
      title: "Calories Burned",
      subtitle: "Active + resting (if available)",
      route: "/garmin/health",
    },
    {
      title: "Hydration",
      subtitle: "Fluids + electrolytes targets",
      route: "/nutrition/water",
    },
    {
      title: "Weight",
      subtitle: "Trends and weekly averages",
      route: "/nutrition/weight",
    },
    {
      title: "Streaks",
      subtitle: "Consistency and logging streaks",
      route: "/nutrition/streaks",
    },
    {
      title: "Trends",
      subtitle: "7–30 day nutrition trends",
      route: "/nutrition/week",
    },
    {
      title: "Micros (Beta)",
      subtitle: "Fibre, sugar, sodium and more",
      route: "/nutrition/micros",
      badge: "BETA",
    },
    {
      title: "Settings",
      subtitle: "Goals, targets, and preferences",
      route: "/nutrition/goal",
    },
  ];

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header (fixed) */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.headerIcon}
          activeOpacity={0.75}
        >
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <Text style={s.headerTitle}>Nutrition Stats</Text>

        <View style={s.headerIcon} />
      </View>

      {/* ✅ Scrollable content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.sectionLabel}>NUTRITION</Text>

        <View style={s.listCard}>
          {items.map((it, idx) => (
            <Row
              key={it.title}
              title={it.title}
              subtitle={it.subtitle}
              badge={it.badge}
              isLast={idx === items.length - 1}
              onPress={() => router.push(it.route)}
              styles={s}
              colors={colors}
            />
          ))}
        </View>

        <Text style={[s.sectionLabel, { marginTop: 18 }]}>TOOLS</Text>

        <View style={s.listCard}>
          <Row
            title="Log a Meal"
            subtitle="Quick add or scan"
            onPress={() => router.push("/nutrition")}
            styles={s}
            colors={colors}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- row ---------------- */

function Row({
  title,
  subtitle,
  badge,
  onPress,
  isLast,
  styles: s,
  colors,
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={s.row}>
      <View style={{ flex: 1 }}>
        <View style={s.rowTopLine}>
          <Text style={s.rowTitle}>{title}</Text>

          {badge ? (
            <View style={s.badge}>
              <Text style={s.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>

        {subtitle ? <Text style={s.rowSub}>{subtitle}</Text> : null}
      </View>

      <Feather name="chevron-right" size={20} color={colors.subtext} />

      {!isLast ? <View style={s.divider} /> : null}
    </TouchableOpacity>
  );
}

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark) {
  const bg = colors?.bg ?? "#000000";
  const text = colors?.text ?? "#FFFFFF";
  const sub = colors?.subtext ?? "rgba(255,255,255,0.65)";

  const panel = isDark ? "#141414" : "#FFFFFF";
  const rowBg = isDark ? "#1B1B1B" : "#F3F4F6";
  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const section = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: bg },

    header: {
      height: 54,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },

    headerIcon: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
    },

    headerTitle: {
      color: text,
      fontSize: 18,
      fontWeight: "700",
      letterSpacing: 0.2,
    },

    /* ✅ gives room to scroll + clears any bottom nav/footer */
    scrollContent: {
      paddingTop: 18,
      paddingBottom: 120,
    },

    sectionLabel: {
      color: section,
      fontSize: 13,
      letterSpacing: 1.1,
      paddingHorizontal: 18,
      marginBottom: 10,
    },

    listCard: {
      backgroundColor: panel,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },

    row: {
      paddingHorizontal: 18,
      paddingVertical: 14,
      backgroundColor: rowBg,
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
    },

    divider: {
      position: "absolute",
      left: 18,
      right: 18,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: divider,
    },

    rowTopLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 4,
    },

    rowTitle: {
      color: text,
      fontSize: 18,
      fontWeight: "500",
    },

    rowSub: {
      color: sub,
      fontSize: 12,
      lineHeight: 16,
      paddingRight: 10,
    },

    badge: {
      paddingHorizontal: 10,
      paddingVertical: Platform.OS === "ios" ? 5 : 4,
      borderRadius: 10,
      backgroundColor: isDark ? "#2B2B2B" : "#E5E7EB",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
    },

    badgeText: {
      color: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.65)",
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.6,
    },
  });
}
