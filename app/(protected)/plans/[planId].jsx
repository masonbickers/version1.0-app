"use client";

/**
 * app/(protected)/plans/[planId].jsx
 * View Training Plan — renders saved multi-week programme (Run + Hyrox + Strength)
 *
 * Firestore:
 * - users/{uid}/trainingPlans/{planId}
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */
function safeStr(v) {
  return String(v ?? "").trim();
}
function readParam(p) {
  return Array.isArray(p) ? p[0] : p;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function asArray(x) {
  return Array.isArray(x) ? x : [];
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ---------------- component ---------------- */
export default function PlanViewPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const planId = safeStr(readParam(params?.planId));

  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null); // full saved plan doc
  const [activeWeek, setActiveWeek] = useState(1);

  // redirect if logged out
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) router.replace("/(auth)/login");
  }, [router]);

  // load plan
  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser;
      if (!user) return;

      if (!planId) {
        setLoading(false);
        Alert.alert("Missing plan id", "This plan link is invalid.");
        return;
      }

      setLoading(true);
      try {
        const ref = doc(db, "users", user.uid, "trainingPlans", planId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Plan not found.");

        const data = snap.data() || {};
        setPlan({ id: snap.id, ...data });

        const weeks = asArray(data.plan);
        const firstWeek = weeks?.[0]?.week || 1;
        setActiveWeek(firstWeek);
      } catch (e) {
        Alert.alert("Could not load plan", e?.message || "Try again.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [planId]);

  const weeksList = useMemo(() => {
    const w = asArray(plan?.plan).map((x) => ({
      week: clamp(Number(x?.week || 1), 1, 52),
      days: asArray(x?.days),
    }));
    // unique & sorted
    const uniq = new Map();
    for (const item of w) uniq.set(item.week, item);
    return Array.from(uniq.values()).sort((a, b) => a.week - b.week);
  }, [plan]);

  const activeWeekObj = useMemo(() => {
    return weeksList.find((w) => w.week === activeWeek) || weeksList[0] || null;
  }, [weeksList, activeWeek]);

  const headerMeta = useMemo(() => {
    const name = safeStr(plan?.name) || "Training Plan";
    const goal = safeStr(plan?.goal);
    const weeks = plan?.weeks ?? weeksList.length;
    const start = safeStr(plan?.startDate);
    return { name, goal, weeks, start };
  }, [plan, weeksList.length]);

  const profileLines = useMemo(() => {
    const p = plan?.profile && typeof plan.profile === "object" ? plan.profile : {};
    const lvl = safeStr(p.level);
    const age = p.age != null ? String(p.age) : "";
    const sex = safeStr(p.sex);
    const ht = p.heightCm != null ? `${p.heightCm}cm` : "";
    const wt = p.weightKg != null ? `${p.weightKg}kg` : "";
    const days = asArray(p.daysAvailable).filter((d) => DAYS.includes(d));
    const tps = p.timePerSessionMin != null ? `${p.timePerSessionMin} min/session` : "";
    const injuries = safeStr(p.injuries);

    const out = [];
    const a = [lvl && `Level: ${lvl}`, age && `Age: ${age}`, sex && `Sex: ${sex}`].filter(Boolean);
    const b = [ht && `Height: ${ht}`, wt && `Weight: ${wt}`, tps && `${tps}`].filter(Boolean);
    if (a.length) out.push(a.join(" • "));
    if (b.length) out.push(b.join(" • "));
    if (days.length) out.push(`Days available: ${days.join(", ")}`);
    if (injuries) out.push(`Constraints: ${injuries}`);
    return out;
  }, [plan]);

  const weekTotals = useMemo(() => {
    const wk = activeWeekObj;
    if (!wk) return { sessions: 0, minutes: 0 };

    let sessions = 0;
    let minutes = 0;

    for (const d of asArray(wk.days)) {
      for (const s0 of asArray(d.sessions)) {
        sessions += 1;
        const dm = Number(s0?.durationMin);
        if (Number.isFinite(dm)) minutes += dm;
      }
    }
    return { sessions, minutes };
  }, [activeWeekObj]);

  const renderBlocksSummary = (sess) => {
    const blocks = asArray(sess?.blocks);
    if (!blocks.length) return null;
    return (
      <View style={{ marginTop: 10, gap: 8 }}>
        {blocks.map((b, i) => {
          const title = safeStr(b?.title) || "Block";
          const kind = safeStr(b?.kind) || "";
          const items = asArray(b?.items);
          return (
            <View key={`${sess?.id || "s"}_b_${i}`} style={s.blockRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.blockTitle} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={s.blockMeta}>
                  {kind ? `${kind} • ` : ""}
                  {items.length} items
                </Text>
              </View>
              <Feather name="layers" size={16} color={colors.subtext} />
            </View>
          );
        })}
      </View>
    );
  };

  // ✅ NEW: open session view
  const openSession = useCallback(
    (weekNum, dayName, sess) => {
      router.push({
        pathname: "/plans/session",
        params: {
          planId,
          week: String(weekNum),
          day: String(dayName),
          sessionId: String(sess?.id || ""),
        },
      });
    },
    [router, planId]
  );

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>Plan</Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {headerMeta.name}
          </Text>
        </View>

        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator />
          <Text style={s.loadingText}>Loading plan…</Text>
        </View>
      ) : !plan ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>Plan not found</Text>
          <Text style={s.emptyText}>This plan link may be invalid.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {/* Summary */}
          <View style={s.summaryCard}>
            <Text style={s.planTitle}>{headerMeta.name}</Text>
            <Text style={s.planSub}>
              {headerMeta.weeks || weeksList.length} weeks
              {headerMeta.start ? ` • start ${headerMeta.start}` : ""}
            </Text>

            {headerMeta.goal ? <Text style={s.goalText}>{headerMeta.goal}</Text> : null}

            {profileLines.length ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                {profileLines.map((ln, i) => (
                  <Text key={`p_${i}`} style={s.profileLine}>
                    {ln}
                  </Text>
                ))}
              </View>
            ) : null}

            {safeStr(plan?.notes) ? (
              <View style={{ marginTop: 10 }}>
                <Text style={s.notesLabel}>Notes</Text>
                <Text style={s.notesText}>{safeStr(plan?.notes)}</Text>
              </View>
            ) : null}
          </View>

          {/* Week selector */}
          <View style={s.weekPicker}>
            <Text style={s.sectionTitle}>Weeks</Text>
            <View style={s.weekRow}>
              {weeksList.map((w) => {
                const active = w.week === activeWeek;
                return (
                  <Pressable
                    key={`wk_${w.week}`}
                    onPress={() => setActiveWeek(w.week)}
                    style={({ pressed }) => [
                      s.weekPill,
                      active && s.weekPillActive,
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={[s.weekText, active && s.weekTextActive]}>W{w.week}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.weekTotals}>
              Week {activeWeekObj?.week || activeWeek} • {weekTotals.sessions} sessions • {weekTotals.minutes} min
            </Text>
          </View>

          {/* Week view */}
          {activeWeekObj ? (
            <View style={s.weekCard}>
              <Text style={s.weekTitle}>Week {activeWeekObj.week}</Text>

              {asArray(activeWeekObj.days).length ? (
                asArray(activeWeekObj.days).map((d) => (
                  <View key={`d_${activeWeekObj.week}_${d.day}`} style={s.dayCard}>
                    <Text style={s.dayTitle}>{safeStr(d?.day) || "Day"}</Text>

                    {asArray(d?.sessions).length ? (
                      asArray(d.sessions).map((sess) => (
                        // ✅ CHANGED: Pressable session card
                        <Pressable
                          key={sess?.id || `${d?.day}_${Math.random()}`}
                          onPress={() => openSession(activeWeekObj.week, d.day, sess)}
                          style={({ pressed }) => [
                            s.sessionCard,
                            pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                          ]}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={s.sessionTitle} numberOfLines={1}>
                                {safeStr(sess?.name) || "Session"}
                              </Text>
                              <Text style={s.sessionMeta}>
                                {safeStr(sess?.type) || "hybrid"} • {sess?.durationMin || 0} min
                                {asArray(sess?.blocks).length
                                  ? ` • ${asArray(sess.blocks).length} blocks`
                                  : ""}
                              </Text>
                            </View>

                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <TypeBadge type={safeStr(sess?.type)} s={s} />
                              <Feather name="chevron-right" size={18} color={colors.subtext} />
                            </View>
                          </View>

                          {safeStr(sess?.notes) ? (
                            <Text style={s.sessionNotes}>{safeStr(sess.notes)}</Text>
                          ) : null}

                          {renderBlocksSummary(sess)}
                        </Pressable>
                      ))
                    ) : (
                      <Text style={s.mutedText}>No sessions.</Text>
                    )}
                  </View>
                ))
              ) : (
                <Text style={s.mutedText}>No days found for this week.</Text>
              )}
            </View>
          ) : (
            <Text style={s.mutedText}>No plan weeks found.</Text>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------------- UI bits ---------------- */
function TypeBadge({ type, s }) {
  const t = safeStr(type).toLowerCase();
  const label =
    t === "run"
      ? "RUN"
      : t === "strength"
      ? "STR"
      : t === "hyrox"
      ? "HYROX"
      : t === "recovery"
      ? "REC"
      : "HYB";

  return (
    <View style={s.typeBadge}>
      <Text style={s.typeBadgeText}>{label}</Text>
    </View>
  );
}

/* ---------------- styles ---------------- */
function makeStyles(colors, isDark) {
  const cardBg = isDark ? "#111217" : "#FFFFFF";
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const border = isDark ? "#1F2128" : "#E1E3E8";
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";

  const softShadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      alignItems: "center",
      justifyContent: "center",
      ...(softShadow || {}),
    },
    headerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    headerSub: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "800",
      marginTop: 2,
    },

    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    loadingText: { color: colors.subtext, fontWeight: "700" },

    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
      gap: 10,
    },
    emptyTitle: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 16,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    emptyText: { color: colors.subtext, fontWeight: "700", textAlign: "center" },

    scroll: { paddingHorizontal: 18, paddingBottom: 28 },

    summaryCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 14,
      ...softShadow,
    },
    planTitle: { color: colors.text, fontWeight: "900", fontSize: 18 },
    planSub: { marginTop: 6, color: colors.subtext, fontWeight: "800", fontSize: 12 },
    goalText: { marginTop: 10, color: colors.text, fontWeight: "700", fontSize: 13, lineHeight: 18 },
    profileLine: { color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    notesLabel: {
      marginTop: 2,
      color: colors.subtext,
      fontWeight: "900",
      fontSize: 11,
      letterSpacing: 0.9,
      textTransform: "uppercase",
    },
    notesText: { marginTop: 6, color: colors.text, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    sectionTitle: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.9, textTransform: "uppercase" },

    weekPicker: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 14,
      ...softShadow,
    },
    weekRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
    weekPill: {
      backgroundColor: panelBg,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    weekPillActive: { backgroundColor: accentBg, borderColor: accentBg },
    weekText: { color: colors.text, fontWeight: "900", fontSize: 12 },
    weekTextActive: { color: "#111111" },
    weekTotals: { marginTop: 10, color: colors.subtext, fontWeight: "800", fontSize: 12 },

    weekCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 14,
      ...softShadow,
    },
    weekTitle: { color: colors.text, fontWeight: "900", fontSize: 14, marginBottom: 10 },

    dayCard: {
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 10,
    },
    dayTitle: { color: colors.text, fontWeight: "900", marginBottom: 8 },

    sessionCard: {
      backgroundColor: isDark ? "#101116" : "#FFFFFF",
      borderRadius: 16,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 8,
    },
    sessionTitle: { color: colors.text, fontWeight: "900" },
    sessionMeta: { marginTop: 4, color: colors.subtext, fontWeight: "800", fontSize: 12 },
    sessionNotes: {
      marginTop: 8,
      color: colors.text,
      fontWeight: "650",
      fontSize: 12,
      lineHeight: 16,
      opacity: 0.95,
    },
    mutedText: { color: colors.subtext, fontWeight: "700" },

    blockRow: {
      backgroundColor: panelBg,
      borderRadius: 14,
      padding: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    blockTitle: { color: colors.text, fontWeight: "900", fontSize: 12 },
    blockMeta: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 11 },

    typeBadge: {
      backgroundColor: accentBg,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    typeBadgeText: { color: "#111111", fontWeight: "900", fontSize: 11, letterSpacing: 0.6 },
  });
}
