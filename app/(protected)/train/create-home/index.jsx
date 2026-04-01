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
          <Text style={s.kicker}>PROGRAM BUILDER</Text>
          <Text style={s.title}>Create a Plan</Text>
          <Text style={s.subtitle}>
            Start with the most important builders for beta. Pick a plan type,
            set your schedule, and refine it afterwards.
          </Text>

          <View style={s.pillRow}>
            <View style={s.pill}>
              <Feather name="check-circle" size={14} color={onAccent} />
              <Text style={s.pillText}>Beta-ready builders only</Text>
            </View>
            <View style={s.pillMuted}>
              <Feather name="edit-3" size={14} color={colors.subtext} />
              <Text style={s.pillMutedText}>Editable after creation</Text>
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
              These are the main create flows to support your beta.
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
              Use this if your Hyrox builder is tested and stable in your app.
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
              Visible for beta, but clearly marked so users know it may change.
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
              Hidden from the main beta flow, but shown here to set expectations.
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
            For beta, keep the main user path focused on Run, Strength, and
            optionally Hyrox. Only expose AI if it has been tested in your build.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accent, onAccent) {
  const silverLight = colors?.sapSilverLight || "#F3F4F6";
  const silverMedium = colors?.sapSilverMedium || "#E1E3E8";

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
      borderColor: colors?.border,
      backgroundColor: isDark ? "#111217" : "#E5E7EB",
    },
    backText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors?.text,
    },

    header: {
      marginBottom: 20,
    },
    kicker: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: colors?.subtext,
      marginBottom: 4,
      fontWeight: "800",
    },
    title: {
      fontSize: 30,
      fontWeight: "800",
      color: colors?.text,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors?.subtext,
      lineHeight: 20,
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
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: accent,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    pillText: {
      fontSize: 11,
      color: onAccent,
      fontWeight: "800",
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
      borderColor: colors?.border,
    },
    pillMutedText: {
      fontSize: 11,
      color: colors?.subtext,
      fontWeight: "600",
    },

    warningBox: {
      marginTop: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: isDark
        ? "rgba(230,255,59,0.08)"
        : "rgba(230,255,59,0.22)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark
        ? "rgba(230,255,59,0.35)"
        : "rgba(17,17,17,0.08)",
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
      marginTop: 6,
      color: colors?.subtext,
      fontSize: 12,
      lineHeight: 17,
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
      marginBottom: 26,
    },
    sectionHeader: {
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "800",
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
      gap: 8,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: colors?.text,
      flex: 1,
    },
    cardDesc: {
      fontSize: 12,
      color: colors?.subtext,
      lineHeight: 17,
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
      backgroundColor: isDark ? "#0B0C10" : "#E5F0FF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMedium,
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
      backgroundColor: isDark ? "#0B0C10" : "#E5E7EB",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMedium,
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
      backgroundColor: isDark ? "#0F172A" : "#E5E7EB",
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
      backgroundColor: isDark ? "rgba(230,255,59,0.10)" : "rgba(230,255,59,0.35)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.35)" : "rgba(17,17,17,0.08)",
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
      marginTop: 4,
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