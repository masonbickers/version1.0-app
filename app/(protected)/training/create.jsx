"use client";

/**
 * app/(protected)/training/create.jsx
 * Create — choose a builder type, then go to /training/builder with params
 *
 * Routes:
 * - Builder: /training/builder?builderType=run|strength|hyrox|hybrid|conditioning|mobility|recovery|other
 * - Duplicate: /training/builder?duplicateFrom=ID
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- helpers ---------- */
function safeStr(v) {
  return String(v ?? "").trim();
}

export default function TrainingCreateSelectorPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, isDark } = useTheme();

  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const onAccent = colors.sapOnPrimary || "#111111";

  const s = useMemo(() => makeStyles(colors, isDark, accent, onAccent), [
    colors,
    isDark,
    accent,
    onAccent,
  ]);

  // redirect if logged out
  useEffect(() => {
    if (!auth.currentUser) router.replace("/(auth)/login");
  }, [router]);

  // If duplicating, forward straight to builder
  const duplicateFrom = safeStr(params?.duplicateFrom);
  useEffect(() => {
    if (!duplicateFrom) return;
    router.replace({
      pathname: "/training/builder",
      params: { duplicateFrom },
    });
  }, [duplicateFrom, router]);

  const sections = [
    {
      title: "Endurance",
      subtitle: "Structured running and cardio sessions.",
      items: [
        {
          label: "Run Builder",
          icon: "activity",
          tag: "Running",
          desc: "Warm-up, intervals, tempo, long run steps — structured and clean.",
          enabled: true,
          builderType: "run",
        },
        {
          label: "Conditioning Builder",
          icon: "wind",
          tag: "Engine",
          desc: "Intervals, EMOM/AMRAP, mixed cardio blocks.",
          enabled: true,
          builderType: "conditioning",
        },
      ],
    },
    {
      title: "Strength & Muscle",
      subtitle: "Build workouts with proper sets / reps / load.",
      items: [
        {
          label: "Strength Builder",
          icon: "bar-chart-2",
          tag: "Strength",
          desc: "Warm-up → main lifts → accessories → finisher.",
          enabled: true,
          builderType: "strength",
        },
        {
          label: "Mobility / Recovery Builder",
          icon: "heart",
          tag: "Recovery",
          desc: "Mobility flow, rehab, easy aerobic / reset sessions.",
          enabled: true,
          builderType: "mobility",
        },
      ],
    },
    {
      title: "Hybrid & Other",
      subtitle: "Mix modalities or build Hyrox sessions.",
      items: [
        {
          label: "Hyrox Builder",
          icon: "zap",
          tag: "Hybrid",
          desc: "Run + stations, race sims, pacing blocks, strength endurance.",
          enabled: true,
          builderType: "hyrox",
        },
        {
          label: "Hybrid Builder",
          icon: "layers",
          tag: "Mixed",
          desc: "Run + strength same session — build anything.",
          enabled: true,
          builderType: "hybrid",
        },
        {
          label: "Blank / Other",
          icon: "edit-3",
          tag: "Custom",
          desc: "Start clean and build any structure you want.",
          enabled: true,
          builderType: "other",
        },
      ],
    },
  ];

  const goBuilder = (builderType) => {
    router.push({
      pathname: "/training/builder",
      params: {
        builderType,
        type: builderType, // keep legacy compatibility
      },
    });
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {/* BACK ROW */}
        <View style={s.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.85}
            style={s.backBtn}
          >
            <Feather name="chevron-left" size={18} color={colors.text} />
            <Text style={s.backText}>Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
        </View>

        {/* HEADER */}
        <View style={s.header}>
          <Text style={s.kicker}>WORKOUT BUILDER</Text>
          <Text style={s.title}>Create a Session</Text>
          <Text style={s.subtitle}>
            Pick what you’re building. You’ll choose the details inside the builder.
          </Text>

          <View style={s.pillRow}>
            <View style={s.pill}>
              <Feather name="sliders" size={14} color={onAccent} />
              <Text style={s.pillText}>Choose a builder type</Text>
            </View>
            <View style={s.pillMuted}>
              <Feather name="edit-3" size={14} color={colors.subtext} />
              <Text style={s.pillMutedText}>Fully editable</Text>
            </View>
          </View>
        </View>

        {/* SECTIONS */}
        {sections.map((section) => (
          <View key={section.title} style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              <Text style={s.sectionSubtitle}>{section.subtitle}</Text>
            </View>

            {section.items.map((opt, idx) => {
              const disabled = !opt.enabled;
              return (
                <TouchableOpacity
                  key={opt.label}
                  onPress={() => {
                    if (!disabled) goBuilder(opt.builderType);
                  }}
                  activeOpacity={disabled ? 1 : 0.9}
                  style={[
                    s.card,
                    idx === 0 && { marginTop: 4 },
                    disabled && s.cardDisabled,
                  ]}
                  disabled={disabled}
                >
                  <View style={s.iconContainer}>
                    <View style={[s.iconBg, disabled && s.iconBgDisabled]}>
                      <Feather
                        name={opt.icon}
                        size={20}
                        color={disabled ? colors.subtext : accent}
                      />
                    </View>
                  </View>

                  <View style={s.cardMain}>
                    <View style={s.cardHeaderRow}>
                      <Text
                        style={[
                          s.cardTitle,
                          disabled && { color: colors.subtext },
                        ]}
                      >
                        {opt.label}
                      </Text>

                      {opt.tag ? (
                        <View style={[s.tag, disabled && s.tagDisabled]}>
                          <Text
                            style={[
                              s.tagText,
                              disabled && s.tagTextDisabled,
                            ]}
                          >
                            {opt.tag}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <Text
                      style={[
                        s.cardDesc,
                        disabled && { color: colors.subtext },
                      ]}
                    >
                      {opt.desc}
                    </Text>
                  </View>

                  <Feather
                    name={disabled ? "lock" : "chevron-right"}
                    size={20}
                    color={colors.subtext}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* FOOTER HINT */}
        <View style={s.footerHint}>
          <Feather name="info" size={14} color={colors.subtext} />
          <Text style={s.footerHintText}>
            Want AI-generated plans? That lives in the Plan Builder (AI) flow — this is for manual session building.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accent, onAccent) {
  const silverLight = colors.sapSilverLight || "#F3F4F6";
  const silverMedium = colors.sapSilverMedium || "#E1E3E8";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
    scrollContent: {
      paddingHorizontal: 18,
      paddingTop: 0,
      paddingBottom: 40,
    },

    /* HEADER ROW */
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#111217" : "#E5E7EB",
    },
    backText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },

    /* HEADER */
    header: {
      marginBottom: 20,
    },
    kicker: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: colors.subtext,
      marginBottom: 4,
    },
    title: {
      fontSize: 30,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.subtext,
      lineHeight: 20,
    },

    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: accent,
      shadowColor: "#000",
      shadowOpacity: 0.3,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    pillText: {
      fontSize: 11,
      color: onAccent,
      fontWeight: "700",
      letterSpacing: 0.3,
    },
    pillMuted: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#E5E7EB",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pillMutedText: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: "500",
    },

    /* SECTIONS */
    section: {
      marginBottom: 26,
    },
    sectionHeader: {
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },

    /* CARD */
    card: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 18,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMedium,
      backgroundColor: isDark ? "#111217" : silverLight,
      marginBottom: 8,
    },
    cardDisabled: {
      opacity: 0.65,
    },
    iconContainer: {
      marginRight: 12,
    },
    iconBg: {
      height: 44,
      width: 44,
      borderRadius: 14,
      backgroundColor: isDark ? "#050609" : "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMedium,
    },
    iconBgDisabled: {
      backgroundColor: isDark ? "#0B0C10" : "#FFFFFF",
    },
    cardMain: {
      flex: 1,
    },
    cardHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
      gap: 10,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
      flexShrink: 1,
    },
    cardDesc: {
      fontSize: 12,
      color: colors.subtext,
      lineHeight: 17,
    },

    tag: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: isDark ? "#0B0C10" : "#E5F0FF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMedium,
    },
    tagDisabled: {
      backgroundColor: isDark ? "#0B0C10" : "#E5E7EB",
    },
    tagText: {
      fontSize: 10,
      fontWeight: "700",
      color: accent,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    tagTextDisabled: {
      color: colors.subtext,
    },

    /* FOOTER */
    footerHint: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 4,
    },
    footerHintText: {
      fontSize: 11,
      color: colors.subtext,
      flex: 1,
      lineHeight: 16,
    },
  });
}
