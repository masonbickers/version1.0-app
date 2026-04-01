"use client";

/**
 * app/(protected)/training/plans/[planId]/index.jsx
 * Plan Detail (read-only)
 *
 * ✅ Improvements:
 * - Cleaner week/day/session layout
 * - Sessions are tappable -> navigates to a session detail route
 * - Better meta + chips
 *
 * Firestore:
 * - users/{uid}/trainingPlans/{planId}
 *
 * Routes used:
 * - Back: /training
 * - Session detail: /training/plans/[planId]/session/[sessionKey]
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../../../firebaseConfig";
import { useTheme } from "../../../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */
function safeStr(v) {
  return String(v ?? "").trim();
}
function cap(s) {
  const x = safeStr(s);
  if (!x) return "";
  return x.charAt(0).toUpperCase() + x.slice(1);
}
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function stableKeyFromSession({ weekNum, dayLabel, sessionIndex, sess }) {
  // Prefer explicit id if present
  const explicit = safeStr(sess?.id || sess?.sessionId);
  if (explicit) return explicit;

  // Fallback stable key
  const nm = safeStr(sess?.name || sess?.title || "session")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "");
  return `w${weekNum}-${safeStr(dayLabel).toLowerCase()}-${sessionIndex}-${nm}`.slice(0, 80);
}
function countBlockItems(blocks) {
  if (!Array.isArray(blocks)) return 0;
  let n = 0;
  for (const b of blocks) {
    const items = Array.isArray(b?.items) ? b.items : [];
    n += items.length;
  }
  return n;
}

/* ---------------- component ---------------- */
export default function TrainingPlanDetailPage() {
  const router = useRouter();
  const { planId } = useLocalSearchParams();

  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");

  // collapsible weeks
  const [openWeeks, setOpenWeeks] = useState({}); // { [weekNum]: boolean }

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) {
      router.replace("/(auth)/login");
      return;
    }

    const id = safeStr(planId);
    if (!id) {
      setErr("Missing plan id.");
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setErr("");
      try {
        const ref = doc(db, "users", u.uid, "trainingPlans", id);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setPlan(null);
          setErr("Plan not found.");
          setLoading(false);
          return;
        }

        const data = snap.data() || {};
        const planData = { id: snap.id, ...data };

        // Default: open week 1 (or first week number present)
        const firstWeekNum =
          Array.isArray(planData.plan) && planData.plan.length
            ? planData.plan[0]?.week ?? 1
            : 1;

        setOpenWeeks((prev) => ({ ...prev, [String(firstWeekNum || 1)]: true }));
        setPlan(planData);
      } catch (e) {
        setErr(e?.message || "Failed to load plan.");
      } finally {
        setLoading(false);
      }
    })();
  }, [planId, router]);

  const weeks = Array.isArray(plan?.plan) ? plan.plan : [];

  const toggleWeek = (weekNum) => {
    const k = String(weekNum);
    setOpenWeeks((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const handleOpenSession = useCallback(
    ({ weekNum, dayLabel, sessionIndex, sess }) => {
      const id = safeStr(planId);
      if (!id) return;
      const sessionKey = stableKeyFromSession({ weekNum, dayLabel, sessionIndex, sess });
      router.push(`/training/plans/${encodeURIComponent(id)}/session/${encodeURIComponent(sessionKey)}`);
    },
    [router, planId]
  );

  // Flatten sessions for quick actions (optional)
  const allSessions = useMemo(() => {
    const out = [];
    weeks.forEach((w) => {
      const weekNum = w?.week ?? 1;
      const days = Array.isArray(w?.days) ? w.days : [];
      days.forEach((d) => {
        const dayLabel = safeStr(d?.day) || "Day";
        const sessions = Array.isArray(d?.sessions) ? d.sessions : [];
        sessions.forEach((sess, idx) => {
          out.push({
            weekNum,
            dayLabel,
            sessionIndex: idx,
            sess,
            sessionKey: stableKeyFromSession({ weekNum, dayLabel, sessionIndex: idx, sess }),
          });
        });
      });
    });
    return out;
  }, [weeks]);

  const openFirstSession = () => {
    if (!allSessions.length) return;
    const x = allSessions[0];
    handleOpenSession(x);
  };

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.iconBtn}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.headerTitle}>Plan</Text>
            <Text style={s.headerSub}>Loading…</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading plan…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (err || !plan) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.iconBtn}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.headerTitle}>Plan</Text>
            <Text style={s.headerSub}>Not available</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <View style={s.center}>
          <Text style={s.errorTitle}>Couldn’t open plan</Text>
          <Text style={s.errorText}>{err || "This plan doesn’t exist."}</Text>

          <Pressable onPress={() => router.replace("/training")} style={s.primaryBtn}>
            <Feather name="arrow-left" size={18} color="#111111" />
            <Text style={s.primaryBtnText}>Back to training</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const totalWeeks = toInt(plan.weeks) || weeks.length || 0;

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>Training Plan</Text>
          <Text style={s.headerSub}>Tap a session to view</Text>
        </View>

        <Pressable onPress={openFirstSession} style={s.iconBtn} disabled={!allSessions.length}>
          <Feather name="play" size={18} color={allSessions.length ? colors.text : colors.subtext} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Summary */}
        <View style={s.summaryCard}>
          <Text style={s.planName}>{safeStr(plan.name) || "Training plan"}</Text>

          <View style={s.metaRow}>
            <View style={s.metaChip}>
              <Feather name="calendar" size={14} color={colors.subtext} />
              <Text style={s.metaChipText}>{totalWeeks ? `${totalWeeks} weeks` : "Programme"}</Text>
            </View>

            {!!safeStr(plan.startDate) && (
              <View style={s.metaChip}>
                <Feather name="flag" size={14} color={colors.subtext} />
                <Text style={s.metaChipText}>Start {safeStr(plan.startDate)}</Text>
              </View>
            )}

            <View style={s.metaChip}>
              <Feather name="layers" size={14} color={colors.subtext} />
              <Text style={s.metaChipText}>{allSessions.length} sessions</Text>
            </View>
          </View>

          {!!safeStr(plan.goal) && <Text style={s.planGoal}>{safeStr(plan.goal)}</Text>}
        </View>

        {/* Weeks */}
        {weeks.length ? (
          weeks.map((w) => {
            const weekNum = w?.week ?? "?";
            const isOpen = !!openWeeks[String(weekNum)];
            const days = Array.isArray(w?.days) ? w.days : [];

            // small summary for closed state
            let weekSessions = 0;
            days.forEach((d) => {
              const sessions = Array.isArray(d?.sessions) ? d.sessions : [];
              weekSessions += sessions.length;
            });

            return (
              <View key={`week_${weekNum}`} style={s.weekCard}>
                <Pressable onPress={() => toggleWeek(weekNum)} style={s.weekTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.weekTitle}>Week {weekNum}</Text>
                    <Text style={s.weekSub}>
                      {weekSessions ? `${weekSessions} sessions` : "No sessions"} • Tap to {isOpen ? "collapse" : "expand"}
                    </Text>
                  </View>
                  <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.subtext} />
                </Pressable>

                {isOpen ? (
                  <View style={{ marginTop: 12, gap: 10 }}>
                    {days.map((d) => {
                      const dayLabel = safeStr(d?.day) || "Day";
                      const sessions = Array.isArray(d?.sessions) ? d.sessions : [];

                      return (
                        <View key={`w${weekNum}_${dayLabel}`} style={s.dayCard}>
                          <View style={s.dayTopRow}>
                            <Text style={s.dayTitle}>{dayLabel}</Text>
                            <Text style={s.dayMeta}>
                              {sessions.length ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "Rest"}
                            </Text>
                          </View>

                          {sessions.length === 0 ? (
                            <Text style={s.restText}>Rest / no session</Text>
                          ) : (
                            <View style={{ marginTop: 10, gap: 8 }}>
                              {sessions.map((sess, idx) => {
                                const blocks = Array.isArray(sess?.blocks) ? sess.blocks : [];
                                const items = countBlockItems(blocks);
                                const durationMin = toInt(sess?.durationMin || sess?.duration || 0);

                                const priority = safeStr(sess?.priority);
                                const timeOfDay = safeStr(sess?.timeOfDay);
                                const type = cap(sess?.type) || "Session";

                                return (
                                  <Pressable
                                    key={stableKeyFromSession({ weekNum, dayLabel, sessionIndex: idx, sess })}
                                    style={({ pressed }) => [s.sessionCard, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
                                    onPress={() => handleOpenSession({ weekNum, dayLabel, sessionIndex: idx, sess })}
                                  >
                                    <View style={s.sessionTopRow}>
                                      <Text style={s.sessionTitle} numberOfLines={1}>
                                        {safeStr(sess?.name) || "Session"}
                                      </Text>

                                      <View style={s.badgeRow}>
                                        {!!timeOfDay && (
                                          <View style={s.badge}>
                                            <Text style={s.badgeText}>{timeOfDay}</Text>
                                          </View>
                                        )}
                                        {!!priority && (
                                          <View
                                            style={[
                                              s.badge,
                                              safeStr(priority) === "primary" ? s.badgePrimary : s.badgeSecondary,
                                            ]}
                                          >
                                            <Text style={s.badgeText}>{priority}</Text>
                                          </View>
                                        )}
                                      </View>
                                    </View>

                                    <Text style={s.sessionMeta} numberOfLines={1}>
                                      {type}
                                      {durationMin ? ` • ${durationMin} min` : ""}
                                      {blocks.length ? ` • ${blocks.length} blocks` : ""}
                                      {items ? ` • ${items} items` : ""}
                                    </Text>

                                    {!!safeStr(sess?.notes) ? (
                                      <Text style={s.sessionNotes} numberOfLines={2}>
                                        {safeStr(sess.notes)}
                                      </Text>
                                    ) : null}

                                    <View style={s.sessionCTA}>
                                      <Text style={s.sessionCTAText}>View session</Text>
                                      <Feather name="chevron-right" size={16} color={colors.subtext} />
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>No plan data</Text>
            <Text style={s.emptyText}>This plan exists but doesn’t contain any weeks/days yet.</Text>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
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
      ...softShadow,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "900",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    headerSub: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 2,
    },

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
    planName: { color: colors.text, fontWeight: "900", fontSize: 18 },
    metaRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: panelBg,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    metaChipText: { color: colors.text, fontWeight: "800", fontSize: 12 },
    planGoal: { marginTop: 10, color: colors.text, fontWeight: "700", fontSize: 13, lineHeight: 18 },

    weekCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 12,
      ...softShadow,
    },
    weekTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    weekTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    weekSub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    dayCard: {
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    dayTopRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
    dayTitle: { color: colors.text, fontWeight: "900", fontSize: 13 },
    dayMeta: { color: colors.subtext, fontWeight: "800", fontSize: 12 },

    restText: { marginTop: 8, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    sessionCard: {
      backgroundColor: isDark ? "#101116" : "#FFFFFF",
      borderRadius: 16,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    sessionTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    sessionTitle: { flex: 1, color: colors.text, fontWeight: "900", fontSize: 14 },
    sessionMeta: { marginTop: 6, color: colors.subtext, fontWeight: "700", fontSize: 12 },
    sessionNotes: { marginTop: 8, color: colors.text, fontWeight: "650", fontSize: 12, lineHeight: 16, opacity: 0.9 },

    sessionCTA: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? "#1F2128" : "#E8EAF0",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sessionCTAText: { color: colors.subtext, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },

    badgeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      backgroundColor: panelBg,
    },
    badgeText: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    },
    badgePrimary: { backgroundColor: "rgba(230,255,59,0.18)", borderColor: "rgba(230,255,59,0.45)" },
    badgeSecondary: { backgroundColor: "rgba(148,163,184,0.10)", borderColor: border },

    emptyCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      ...softShadow,
    },
    emptyTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    emptyText: { marginTop: 6, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, gap: 10 },
    centerText: { color: colors.subtext, fontWeight: "700" },

    errorTitle: { color: colors.text, fontWeight: "900", fontSize: 18, textAlign: "center" },
    errorText: { color: colors.subtext, fontWeight: "700", fontSize: 13, lineHeight: 18, textAlign: "center" },

    primaryBtn: {
      marginTop: 10,
      backgroundColor: accentBg,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      ...softShadow,
    },
    primaryBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", fontSize: 12 },
  });
}
