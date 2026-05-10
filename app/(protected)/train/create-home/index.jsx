// app/(protected)/train/create-home/index.jsx

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

function inferPlanKindFromDoc(planDoc) {
  const kind = String(planDoc?.kind || "").toLowerCase();
  const source = String(planDoc?.source || "").toLowerCase();
  const primary = String(
    planDoc?.primaryActivity || planDoc?.meta?.primaryActivity || ""
  ).toLowerCase();

  if (
    kind === "run" ||
    primary.includes("run") ||
    source.includes("generate-run") ||
    source.includes("run")
  ) {
    return "run";
  }

  if (
    kind === "strength" ||
    primary.includes("strength") ||
    primary.includes("gym") ||
    source.includes("generate-strength") ||
    source.includes("strength")
  ) {
    return "strength";
  }

  if (primary.includes("hyrox") || source.includes("hyrox") || kind === "hyrox") {
    return "hyrox";
  }

  return kind || "training";
}

export default function CreateHome() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const accent = colors?.sapPrimary || colors?.primary || "#E6FF3B";
  const onAccent = colors?.sapOnPrimary || "#111111";

  const s = useMemo(
    () => makeStyles(colors, isDark, accent, onAccent),
    [colors, isDark, accent, onAccent]
  );

  const [checkingPlan, setCheckingPlan] = useState(true);
  const [hasActivePlan, setHasActivePlan] = useState(false);
  const [activePlanKinds, setActivePlanKinds] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          setHasActivePlan(false);
          setActivePlanKinds([]);
          setCheckingPlan(false);
          return;
        }

        const ref = collection(db, "users", uid, "plans");
        const snap = await getDocs(
          query(ref, orderBy("updatedAt", "desc"), limit(12))
        );

        if (snap.empty) {
          setHasActivePlan(false);
          setActivePlanKinds([]);
        } else {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const kinds = Array.from(
            new Set(docs.map(inferPlanKindFromDoc).filter(Boolean))
          );
          setHasActivePlan(true);
          setActivePlanKinds(kinds);
        }
      } catch (e) {
        console.log("[create-home] check active plan error:", e);
        setHasActivePlan(false);
        setActivePlanKinds([]);
      } finally {
        setCheckingPlan(false);
      }
    })();
  }, []);

  const primaryCards = [
    {
      label: "Run Training Plan",
      icon: "activity",
      route: "/train/create/create-run",
      desc: "Build a structured run block with easy runs, workouts and long runs around your goal.",
      tag: "Core",
      badge: "Most popular",
    },
    {
      label: "Strength / Hypertrophy Plan",
      icon: "bar-chart-2",
      route: "/train/create/create-strength",
      desc: "Create a gym plan for strength or muscle that fits around your weekly schedule.",
      tag: "Core",
      badge: "Gym focused",
    },
  ];

  const hybridCards = [
    {
      label: "Hyrox Plan",
      icon: "zap",
      route: "/train/create/create-hyrox",
      desc: "Blend running and stations into a simple hybrid plan with race-focused structure.",
      tag: "Hybrid",
      badge: "Optional",
    },
  ];

  const betaCards = [
    {
      label: "AI Plan (Beta)",
      icon: "sparkles",
      route: "/train/create/ai-plan",
      desc: "Use AI to generate a draft training plan quickly, then refine it afterwards.",
      tag: "Beta",
      badge: "Experimental",
    },
  ];

  const comingSoonCards = [
    {
      label: "Cycling Plan",
      icon: "cpu",
      desc: "Bike-specific programming with endurance and interval structure.",
      tag: "Soon",
    },
    {
      label: "Triathlon Plan",
      icon: "sunrise",
      desc: "Integrated swim, bike and run planning for multi-discipline athletes.",
      tag: "Soon",
    },
    {
      label: "Custom / Blank Plan",
      icon: "edit-3",
      desc: "Start from a blank builder for fully bespoke training blocks.",
      tag: "Soon",
    },
  ];

  const activeKindsLabel = useMemo(() => {
    if (!activePlanKinds.length) return "";
    return activePlanKinds
      .map((k) => {
        if (k === "run") return "Run";
        if (k === "strength") return "Strength";
        if (k === "hyrox") return "Hyrox";
        return k.charAt(0).toUpperCase() + k.slice(1);
      })
      .join(" + ");
  }, [activePlanKinds]);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
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

        <View style={s.header}>
          <Text style={s.kicker}>Training</Text>
          <Text style={s.title}>Create a Plan</Text>
          <Text style={s.subtitle}>
            Choose the training block you want to build, set the schedule, then
            refine it from your plan view.
          </Text>

          <View style={s.pillRow}>
            <View style={s.pill}>
              <Feather name="check-circle" size={14} color={onAccent} />
              <Text style={s.pillText}>Structured plans</Text>
            </View>
            <View style={s.pillMuted}>
              <Feather name="edit-3" size={14} color={colors.subtext} />
              <Text style={s.pillMutedText}>Editable later</Text>
            </View>
          </View>

          {!checkingPlan && hasActivePlan && (
            <View style={s.warningBox}>
              <View style={s.warningHead}>
                <Feather name="alert-triangle" size={14} color={accent} />
                <Text style={s.warningTitle}>Active plan detected</Text>
              </View>
              <Text style={s.warningText}>
                You currently have {activeKindsLabel || "an active plan"}.
                Creating a new plan may replace your main active block unless
                your builder supports companion planning.
              </Text>
            </View>
          )}

          {checkingPlan && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={accent} />
              <Text style={s.loadingText}>Checking your current plans…</Text>
            </View>
          )}
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Start here</Text>
            <Text style={s.sectionSubtitle}>
              Core builders for the main training blocks.
            </Text>
          </View>

          {primaryCards.map((opt, idx) => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => router.push(opt.route)}
              activeOpacity={0.9}
              style={[s.card, idx === 0 && { marginTop: 4 }]}
            >
              <View style={s.iconContainer}>
                <View style={s.iconBg}>
                  <Feather name={opt.icon} size={20} color={accent} />
                </View>
              </View>

              <View style={s.cardMain}>
                <View style={s.cardHeaderRow}>
                  <Text style={s.cardTitle}>{opt.label}</Text>
                  <View style={s.badgePill}>
                    <Text style={s.badgeText}>{opt.badge}</Text>
                  </View>
                </View>

                <Text style={s.cardDesc}>{opt.desc}</Text>

                <View style={s.metaRow}>
                  <View style={s.tag}>
                    <Text style={s.tagText}>{opt.tag}</Text>
                  </View>
                </View>
              </View>

              <Feather name="chevron-right" size={20} color={colors.subtext} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Hybrid</Text>
            <Text style={s.sectionSubtitle}>
              Combine running and station work into one block.
            </Text>
          </View>

          {hybridCards.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => router.push(opt.route)}
              activeOpacity={0.9}
              style={s.card}
            >
              <View style={s.iconContainer}>
                <View style={s.iconBg}>
                  <Feather name={opt.icon} size={20} color={accent} />
                </View>
              </View>

              <View style={s.cardMain}>
                <View style={s.cardHeaderRow}>
                  <Text style={s.cardTitle}>{opt.label}</Text>
                  <View style={s.badgePillMuted}>
                    <Text style={s.badgeTextMuted}>{opt.badge}</Text>
                  </View>
                </View>

                <Text style={s.cardDesc}>{opt.desc}</Text>

                <View style={s.metaRow}>
                  <View style={s.tag}>
                    <Text style={s.tagText}>{opt.tag}</Text>
                  </View>
                </View>
              </View>

              <Feather name="chevron-right" size={20} color={colors.subtext} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Experimental</Text>
            <Text style={s.sectionSubtitle}>
              Draft builders that may need more review after creation.
            </Text>
          </View>

          {betaCards.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => router.push(opt.route)}
              activeOpacity={0.9}
              style={s.card}
            >
              <View style={s.iconContainer}>
                <View style={s.iconBg}>
                  <Feather name={opt.icon} size={20} color={accent} />
                </View>
              </View>

              <View style={s.cardMain}>
                <View style={s.cardHeaderRow}>
                  <Text style={s.cardTitle}>{opt.label}</Text>
                  <View style={s.badgePillBeta}>
                    <Text style={s.badgeTextBeta}>{opt.badge}</Text>
                  </View>
                </View>

                <Text style={s.cardDesc}>{opt.desc}</Text>

                <View style={s.metaRow}>
                  <View style={s.tag}>
                    <Text style={s.tagText}>{opt.tag}</Text>
                  </View>
                </View>
              </View>

              <Feather name="chevron-right" size={20} color={colors.subtext} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Coming soon</Text>
            <Text style={s.sectionSubtitle}>
              Planned builders that are not available yet.
            </Text>
          </View>

          {comingSoonCards.map((opt) => (
            <View key={opt.label} style={[s.card, s.cardDisabled]}>
              <View style={s.iconContainer}>
                <View style={[s.iconBg, s.iconBgDisabled]}>
                  <Feather name={opt.icon} size={20} color={colors.subtext} />
                </View>
              </View>

              <View style={s.cardMain}>
                <View style={s.cardHeaderRow}>
                  <Text style={[s.cardTitle, { color: colors.subtext }]}>
                    {opt.label}
                  </Text>
                  <View style={s.tagDisabled}>
                    <Text style={s.tagTextDisabled}>{opt.tag}</Text>
                  </View>
                </View>

                <Text style={[s.cardDesc, { color: colors.subtext }]}>
                  {opt.desc}
                </Text>
              </View>

              <Feather name="lock" size={18} color={colors.subtext} />
            </View>
          ))}
        </View>

        <View style={s.footerHint}>
          <Feather name="info" size={14} color={colors.subtext} />
          <Text style={s.footerHintText}>
            New plans are saved to your training area and can be edited after
            creation.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accent, onAccent) {
  const bg = colors?.bg || (isDark ? "#050506" : "#F5F5F7");
  const card = colors?.card || (isDark ? "#111217" : "#FFFFFF");
  const card2 = colors?.card2 || (isDark ? "#17181D" : "#F3F4F6");
  const border = colors?.border || (isDark ? "rgba(255,255,255,0.12)" : "rgba(17,17,17,0.12)");
  const quietSurface = card;
  const quietInset = card2;
  const softAccent = isDark ? "rgba(230,255,59,0.12)" : "rgba(230,255,59,0.22)";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: bg,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 52,
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      backgroundColor: quietInset,
    },
    backText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors?.text,
    },

    header: {
      marginBottom: 24,
    },
    kicker: {
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: colors?.subtext,
      marginBottom: 8,
      fontWeight: "800",
    },
    title: {
      fontSize: 32,
      lineHeight: 38,
      fontWeight: "900",
      color: colors?.text,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      color: colors?.subtext,
      lineHeight: 22,
      fontWeight: "600",
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
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: accent,
    },
    pillText: {
      fontSize: 12,
      color: onAccent,
      fontWeight: "800",
      letterSpacing: 0.3,
    },
    pillMuted: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: quietInset,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    pillMutedText: {
      fontSize: 12,
      color: colors?.subtext,
      fontWeight: "700",
    },

    warningBox: {
      marginTop: 16,
      padding: 14,
      borderRadius: 18,
      backgroundColor: softAccent,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.28)" : "rgba(17,17,17,0.08)",
    },
    warningHead: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    warningTitle: {
      color: colors?.text,
      fontWeight: "800",
      fontSize: 12,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    warningText: {
      marginTop: 8,
      color: colors?.subtext,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "600",
    },

    loadingRow: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    loadingText: {
      color: colors?.subtext,
      fontSize: 12,
      fontWeight: "700",
    },

    section: {
      marginBottom: 28,
    },
    sectionHeader: {
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "900",
      color: colors?.text,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: colors?.subtext,
      marginTop: 2,
      fontWeight: "600",
      lineHeight: 17,
    },

    card: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 20,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      backgroundColor: quietSurface,
      marginBottom: 10,
    },
    cardDisabled: {
      opacity: 0.65,
    },

    iconContainer: {
      marginRight: 12,
    },
    iconBg: {
      height: 46,
      width: 46,
      borderRadius: 16,
      backgroundColor: quietInset,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    iconBgDisabled: {
      backgroundColor: quietInset,
    },

    cardMain: {
      flex: 1,
    },
    cardHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
      gap: 8,
    },
    cardTitle: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "900",
      color: colors?.text,
      flex: 1,
    },
    cardDesc: {
      fontSize: 13,
      color: colors?.subtext,
      lineHeight: 19,
      fontWeight: "600",
    },

    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
    },

    tag: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: quietInset,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      alignSelf: "flex-start",
    },
    tagText: {
      fontSize: 10,
      fontWeight: "800",
      color: accent,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    tagDisabled: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: quietInset,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    tagTextDisabled: {
      fontSize: 10,
      fontWeight: "800",
      color: colors?.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    badgePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: accent,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: "900",
      color: onAccent,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    badgePillMuted: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: quietInset,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    badgeTextMuted: {
      fontSize: 10,
      fontWeight: "900",
      color: colors?.text,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    badgePillBeta: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: softAccent,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.24)" : "rgba(17,17,17,0.08)",
    },
    badgeTextBeta: {
      fontSize: 10,
      fontWeight: "900",
      color: colors?.text,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    footerHint: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 2,
      padding: 14,
      borderRadius: 18,
      backgroundColor: quietSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    footerHintText: {
      fontSize: 11,
      color: colors?.subtext,
      flex: 1,
      lineHeight: 16,
      fontWeight: "600",
    },
  });
}
