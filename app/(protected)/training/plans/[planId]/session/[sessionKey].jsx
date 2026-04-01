"use client";

/**
 * app/(protected)/training/plans/[planId]/session/[sessionKey].jsx
 * Session Detail (read-only) for a session inside a Training Plan
 *
 * Firestore:
 * - users/{uid}/trainingPlans/{planId}
 *
 * Route:
 * - /training/plans/[planId]/session/[sessionKey]
 *
 * This page:
 * - Loads the plan doc
 * - Finds the session by:
 *    1) session.id / session.sessionId === sessionKey
 *    2) fallback stableKey match (same algo as plan detail page)
 * - Renders session header + blocks + items
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
import { auth, db } from "../../../../../../firebaseConfig";
import { useTheme } from "../../../../../../providers/ThemeProvider";

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
function asArray(x) {
  return Array.isArray(x) ? x : [];
}
function stableKeyFromSession({ weekNum, dayLabel, sessionIndex, sess }) {
  const explicit = safeStr(sess?.id || sess?.sessionId);
  if (explicit) return explicit;

  const nm = safeStr(sess?.name || sess?.title || "session")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "");
  return `w${weekNum}-${safeStr(dayLabel).toLowerCase()}-${sessionIndex}-${nm}`.slice(0, 80);
}
function countBlockItems(blocks) {
  let n = 0;
  asArray(blocks).forEach((b) => {
    n += asArray(b?.items).length;
  });
  return n;
}
function formatRest(restSec) {
  const n = toInt(restSec);
  if (!n) return "";
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
function formatDurationMin(min) {
  const n = toInt(min);
  if (!n) return "";
  return `${n} min`;
}

function itemTitle(it) {
  return (
    safeStr(it?.name) ||
    safeStr(it?.title) ||
    safeStr(it?.exercise) ||
    safeStr(it?.movement) ||
    "Item"
  );
}

/**
 * Attempts to infer a nice "prescription" line from common schemas:
 * - sets/reps: sets, reps, load, rpe, restSec
 * - time: timeSec / timeMin / durationSec
 * - distance: distance, unit
 * - intervals: intervals, work/rest
 * - notes fallbacks
 */
function describePrescription(it) {
  const p = it?.prescription || it?.rx || it || {};
  const scheme = safeStr(p?.scheme) || safeStr(it?.scheme) || "";

  // Sets/Reps
  const sets = toInt(p?.sets ?? it?.sets);
  const reps = toInt(p?.reps ?? it?.reps);
  const load = safeStr(p?.load ?? it?.load);
  const rpe = safeStr(p?.rpe ?? it?.rpe);
  const restSec = toInt(p?.restSec ?? it?.restSec);

  if (scheme === "sets_reps" || (sets && reps)) {
    const bits = [];
    if (sets && reps) bits.push(`${sets}×${reps}`);
    if (load) bits.push(load);
    if (rpe) bits.push(`RPE ${rpe}`);
    if (restSec) bits.push(`Rest ${formatRest(restSec)}`);
    return bits.join(" • ");
  }

  // Time
  const timeSec = toInt(p?.timeSec ?? it?.timeSec ?? p?.durationSec ?? it?.durationSec);
  const timeMin = toInt(p?.timeMin ?? it?.timeMin);
  if (scheme === "time" || timeSec || timeMin) {
    const totalSec = timeSec || (timeMin ? timeMin * 60 : 0);
    if (!totalSec) return "";
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }

  // Distance
  const dist = p?.distance ?? it?.distance;
  const unit = safeStr(p?.unit ?? it?.unit) || "m";
  if (scheme === "distance" || dist) {
    const d = Number(dist);
    if (!Number.isFinite(d) || !d) return "";
    return `${d}${unit}`;
  }

  // Intervals
  const intervals = toInt(p?.intervals ?? it?.intervals);
  const workSec = toInt(p?.workSec ?? it?.workSec);
  const restIntSec = toInt(p?.restSec ?? it?.restSec);
  if (scheme === "intervals" || intervals) {
    const bits = [];
    if (intervals) bits.push(`${intervals} rounds`);
    if (workSec) bits.push(`Work ${formatRest(workSec)}`);
    if (restIntSec) bits.push(`Rest ${formatRest(restIntSec)}`);
    return bits.join(" • ");
  }

  // fallback: notes-ish
  const note = safeStr(it?.notes || it?.note || p?.notes);
  return note ? note : "";
}

/* ---------------- component ---------------- */
export default function PlanSessionDetailPage() {
  const router = useRouter();
  const { planId, sessionKey } = useLocalSearchParams();

  const { colors, isDark } = useTheme();
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const s = useMemo(() => makeStyles(colors, isDark, accentBg), [colors, isDark, accentBg]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [plan, setPlan] = useState(null);
  const [ctx, setCtx] = useState(null); // { weekNum, dayLabel, sessionIndex, sess }

  const load = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) {
      router.replace("/(auth)/login");
      return;
    }

    const pid = safeStr(planId);
    const sk = safeStr(sessionKey);

    if (!pid) {
      setErr("Missing plan id.");
      setLoading(false);
      return;
    }
    if (!sk) {
      setErr("Missing session key.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErr("");
    try {
      const ref = doc(db, "users", u.uid, "trainingPlans", pid);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setErr("Plan not found.");
        setPlan(null);
        setCtx(null);
        setLoading(false);
        return;
      }

      const data = snap.data() || {};
      const planData = { id: snap.id, ...data };
      setPlan(planData);

      const weeks = asArray(planData?.plan);

      // Find session by explicit id first
      let found = null;

      for (const w of weeks) {
        const weekNum = w?.week ?? 1;
        const days = asArray(w?.days);

        for (const d of days) {
          const dayLabel = safeStr(d?.day) || "Day";
          const sessions = asArray(d?.sessions);

          for (let i = 0; i < sessions.length; i++) {
            const sess = sessions[i];
            const explicit = safeStr(sess?.id || sess?.sessionId);
            if (explicit && explicit === sk) {
              found = { weekNum, dayLabel, sessionIndex: i, sess };
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }

      // Fallback: stable key match
      if (!found) {
        for (const w of weeks) {
          const weekNum = w?.week ?? 1;
          const days = asArray(w?.days);

          for (const d of days) {
            const dayLabel = safeStr(d?.day) || "Day";
            const sessions = asArray(d?.sessions);

            for (let i = 0; i < sessions.length; i++) {
              const sess = sessions[i];
              const key = stableKeyFromSession({ weekNum, dayLabel, sessionIndex: i, sess });
              if (key === sk) {
                found = { weekNum, dayLabel, sessionIndex: i, sess };
                break;
              }
            }
            if (found) break;
          }
          if (found) break;
        }
      }

      if (!found) {
        setErr("Session not found in this plan.");
        setCtx(null);
        setLoading(false);
        return;
      }

      setCtx(found);
    } catch (e) {
      setErr(e?.message || "Failed to load session.");
      setPlan(null);
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [router, planId, sessionKey]);

  useEffect(() => {
    load();
  }, [load]);

  const sess = ctx?.sess || null;
  const blocks = useMemo(() => asArray(sess?.blocks), [sess]);
  const totalItems = useMemo(() => countBlockItems(blocks), [blocks]);

  const subtitle = useMemo(() => {
    if (!ctx || !sess) return "";
    const bits = [];
    bits.push(`Week ${ctx.weekNum}`);
    bits.push(ctx.dayLabel);

    const type = cap(sess?.type) || "";
    if (type) bits.push(type);

    const dur = formatDurationMin(sess?.durationMin || sess?.duration);
    if (dur) bits.push(dur);

    if (blocks.length) bits.push(`${blocks.length} blocks`);
    if (totalItems) bits.push(`${totalItems} items`);

    return bits.join(" • ");
  }, [ctx, sess, blocks.length, totalItems]);

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.iconBtn}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.headerTitle}>Session</Text>
            <Text style={s.headerSub}>Loading…</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (err || !sess) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.iconBtn}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.headerTitle}>Session</Text>
            <Text style={s.headerSub}>Not available</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <View style={s.center}>
          <Text style={s.errorTitle}>Couldn’t open session</Text>
          <Text style={s.errorText}>{err || "This session doesn’t exist."}</Text>

          <Pressable onPress={() => router.replace(`/training/plans/${safeStr(planId)}`)} style={s.primaryBtn}>
            <Feather name="arrow-left" size={18} color="#111111" />
            <Text style={s.primaryBtnText}>Back to plan</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const timeOfDay = safeStr(sess?.timeOfDay);
  const priority = safeStr(sess?.priority);
  const notes = safeStr(sess?.notes);

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {safeStr(sess?.name) || "Session"}
          </Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>

        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Summary */}
        <View style={s.summaryCard}>
          <Text style={s.sessionName}>{safeStr(sess?.name) || "Session"}</Text>
          <Text style={s.sessionMeta}>{subtitle}</Text>

          <View style={s.badgeRow}>
            {!!timeOfDay && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{timeOfDay}</Text>
              </View>
            )}
            {!!priority && (
              <View style={[s.badge, priority === "primary" ? s.badgePrimary : s.badgeSecondary]}>
                <Text style={s.badgeText}>{priority}</Text>
              </View>
            )}
          </View>

          {!!notes && <Text style={s.sessionNotes}>{notes}</Text>}
        </View>

        {/* Blocks */}
        {blocks.length ? (
          blocks.map((b, bi) => {
            const title = safeStr(b?.title) || `Block ${bi + 1}`;
            const items = asArray(b?.items);

            return (
              <View key={`block_${bi}`} style={s.blockCard}>
                <View style={s.blockTopRow}>
                  <Text style={s.blockTitle}>{title}</Text>
                  <View style={s.blockChip}>
                    <Text style={s.blockChipText}>{items.length} items</Text>
                  </View>
                </View>

                {!!safeStr(b?.notes) && <Text style={s.blockNotes}>{safeStr(b.notes)}</Text>}

                {items.length ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    {items.map((it, ii) => {
                      const t = itemTitle(it);
                      const desc = describePrescription(it);
                      const secondary = safeStr(it?.subtitle || it?.sub || it?.detail);

                      return (
                        <View key={`it_${bi}_${ii}`} style={s.itemRow}>
                          <View style={s.itemLeft}>
                            <View style={s.itemIndex}>
                              <Text style={s.itemIndexText}>{ii + 1}</Text>
                            </View>
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={s.itemTitle} numberOfLines={1}>
                              {t}
                            </Text>

                            {!!desc && (
                              <Text style={s.itemMeta} numberOfLines={2}>
                                {desc}
                              </Text>
                            )}

                            {!!secondary && !desc && (
                              <Text style={s.itemMeta} numberOfLines={2}>
                                {secondary}
                              </Text>
                            )}

                            {!!safeStr(it?.notes) && (
                              <Text style={s.itemNotes} numberOfLines={2}>
                                {safeStr(it.notes)}
                              </Text>
                            )}
                          </View>

                          <Feather name="chevron-right" size={16} color={colors.subtext} />
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={s.muted}>No items in this block.</Text>
                )}
              </View>
            );
          })
        ) : (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>No blocks</Text>
            <Text style={s.emptyText}>This session doesn’t have any blocks yet.</Text>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
function makeStyles(colors, isDark, accentBg) {
  const cardBg = isDark ? "#111217" : "#FFFFFF";
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const border = isDark ? "#1F2128" : "#E1E3E8";

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
      letterSpacing: 0.4,
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
    sessionName: { color: colors.text, fontWeight: "900", fontSize: 18 },
    sessionMeta: { marginTop: 6, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },
    badgeRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
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
    sessionNotes: { marginTop: 10, color: colors.text, fontWeight: "650", fontSize: 13, lineHeight: 18, opacity: isDark ? 0.92 : 1 },

    blockCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 12,
      ...softShadow,
    },
    blockTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    blockTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    blockChip: {
      backgroundColor: panelBg,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    blockChipText: { color: colors.subtext, fontWeight: "900", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },
    blockNotes: { marginTop: 8, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    itemRow: {
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    itemLeft: { justifyContent: "center", alignItems: "center" },
    itemIndex: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: isDark ? "#101116" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      alignItems: "center",
      justifyContent: "center",
    },
    itemIndexText: { color: colors.text, fontWeight: "900", fontSize: 12 },
    itemTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    itemMeta: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },
    itemNotes: { marginTop: 6, color: colors.text, fontWeight: "650", fontSize: 12, lineHeight: 16, opacity: 0.9 },

    muted: { marginTop: 10, color: colors.subtext, fontWeight: "700", fontSize: 12 },

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
