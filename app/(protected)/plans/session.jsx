"use client";

/**
 * app/(protected)/plans/session.jsx
 * View + Start a specific session from a saved training plan.
 *
 * Route params (query):
 * - planId
 * - week
 * - day   (Mon..Sun)
 * - sessionId
 *
 * Firestore:
 * - users/{uid}/trainingPlans/{planId}
 * - users/{uid}/planSessions/{sessionDocId}   (created on Start)
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
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { addDoc, collection, doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { stripUndefinedDeep, withTimestamps } from "../../../src/firestoreSafe";

/* ---------------- helpers ---------------- */
function safeStr(v) {
  return String(v ?? "").trim();
}
function readParam(p) {
  return Array.isArray(p) ? p[0] : p;
}
function asArray(x) {
  return Array.isArray(x) ? x : [];
}
function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ---------------- component ---------------- */
export default function PlanSessionPage() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const planId = safeStr(readParam(params?.planId));
  const week = toNum(readParam(params?.week), null);
  const day = safeStr(readParam(params?.day));
  const sessionId = safeStr(readParam(params?.sessionId));

  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);

  // redirect if logged out
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) router.replace("/(auth)/login");
  }, [router]);

  // validate params early
  useEffect(() => {
    if (!planId) Alert.alert("Missing plan", "This link is invalid (missing planId).");
    if (!week) Alert.alert("Missing week", "This link is invalid (missing week).");
    if (!day) Alert.alert("Missing day", "This link is invalid (missing day).");
    if (!sessionId) Alert.alert("Missing session", "This link is invalid (missing sessionId).");
  }, [planId, week, day, sessionId]);

  // load plan + locate session
  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser;
      if (!user) return;

      if (!planId || !week || !day || !sessionId) {
        setLoading(false);
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
        const wk = weeks.find((w) => Number(w?.week) === Number(week));
        if (!wk) throw new Error(`Week ${week} not found in this plan.`);

        const dObj = asArray(wk?.days).find((d) => safeStr(d?.day) === day);
        if (!dObj) throw new Error(`Day ${day} not found in week ${week}.`);

        const sess = asArray(dObj?.sessions).find((x) => safeStr(x?.id) === sessionId);
        if (!sess) throw new Error("Session not found (bad sessionId).");

        setSession({
          ...sess,
          _meta: { week: Number(week), day, planId: snap.id, planName: safeStr(data?.name) },
        });
      } catch (e) {
        Alert.alert("Could not load session", e?.message || "Try again.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [planId, week, day, sessionId]);

  const handleStart = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return Alert.alert("Error", "Please sign in again.");
    if (!session) return;
    if (starting) return;

    setStarting(true);
    try {
      // Create an “in progress” session instance you can later resume
      const payload = stripUndefinedDeep({
        kind: "planSession",
        status: "in_progress",
        planId: session?._meta?.planId,
        planName: session?._meta?.planName,
        week: session?._meta?.week,
        day: session?._meta?.day,
        sourceSessionId: safeStr(session?.id),
        sessionSnapshot: {
          id: safeStr(session?.id),
          name: safeStr(session?.name),
          type: safeStr(session?.type),
          durationMin: session?.durationMin ?? 0,
          notes: safeStr(session?.notes),
          blocks: asArray(session?.blocks),
        },
        startedAtMs: Date.now(),
      });

      const ref = collection(db, "users", user.uid, "planSessions");
      const created = await addDoc(ref, withTimestamps(payload, { create: true }));

      Alert.alert("Session started", "Your session is now in progress.");
      // If you later build a live “player” screen, route there:
      // router.push(`/training/session/${created.id}`);
      // For now, just stay on this screen.
    } catch (e) {
      Alert.alert("Could not start", e?.message || "Try again.");
    } finally {
      setStarting(false);
    }
  }, [session, starting]);

  const title = useMemo(() => safeStr(session?.name) || "Session", [session]);
  const meta = useMemo(() => {
    const t = safeStr(session?.type) || "hybrid";
    const dm = Number(session?.durationMin || 0);
    return `${t.toUpperCase()} • ${dm} min • Week ${week || "?"} • ${day || "?"}`;
  }, [session, week, day]);

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>Session</Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {safeStr(plan?.name) || "Training Plan"}
          </Text>
        </View>

        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator />
          <Text style={s.loadingText}>Loading session…</Text>
        </View>
      ) : !session ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyTitle}>Session not found</Text>
          <Text style={s.emptyText}>This link may be invalid.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          <View style={s.card}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.meta}>{meta}</Text>

            {!!safeStr(session?.notes) && (
              <View style={{ marginTop: 10 }}>
                <Text style={s.sectionLabel}>Notes</Text>
                <Text style={s.notes}>{safeStr(session?.notes)}</Text>
              </View>
            )}
          </View>

          {/* Blocks */}
          {asArray(session?.blocks).map((b, bi) => {
            const items = asArray(b?.items);
            return (
              <View key={`b_${bi}`} style={s.blockCard}>
                <View style={s.blockHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.blockTitle}>{safeStr(b?.title) || `Block ${bi + 1}`}</Text>
                    <Text style={s.blockMeta}>
                      {safeStr(b?.kind) ? `${safeStr(b.kind)} • ` : ""}
                      {items.length} items
                    </Text>
                  </View>
                  <Feather name="layers" size={16} color={colors.subtext} />
                </View>

                {items.length ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    {items.map((it, ii) => (
                      <View key={`it_${bi}_${ii}`} style={s.itemRow}>
                        <Text style={s.itemTitle} numberOfLines={2}>
                          {safeStr(it?.name || it?.title || it?.exercise || it?.type || `Item ${ii + 1}`)}
                        </Text>
                        {!!safeStr(it?.notes) && (
                          <Text style={s.itemNotes} numberOfLines={3}>
                            {safeStr(it?.notes)}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={s.muted}>No items in this block.</Text>
                )}
              </View>
            );
          })}

          {/* Start */}
          <TouchableOpacity
            style={[s.primaryBtn, starting && { opacity: 0.6 }]}
            activeOpacity={0.9}
            onPress={handleStart}
            disabled={starting}
          >
            {starting ? <ActivityIndicator /> : <Feather name="play" size={18} color="#111111" />}
            <Text style={s.primaryBtnText}>{starting ? "Starting…" : "Start session"}</Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
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
    ? { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4 }
    : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 2 };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: border, alignItems: "center", justifyContent: "center", ...softShadow },
    headerTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
    headerSub: { color: colors.subtext, fontSize: 12, fontWeight: "800", marginTop: 2 },

    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    loadingText: { color: colors.subtext, fontWeight: "700" },

    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, gap: 10 },
    emptyTitle: { color: colors.text, fontWeight: "900", fontSize: 16, textTransform: "uppercase", letterSpacing: 0.6 },
    emptyText: { color: colors.subtext, fontWeight: "700", textAlign: "center" },

    scroll: { paddingHorizontal: 18, paddingBottom: 28 },

    card: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 14, ...softShadow },
    title: { color: colors.text, fontWeight: "900", fontSize: 18 },
    meta: { marginTop: 6, color: colors.subtext, fontWeight: "800", fontSize: 12 },

    sectionLabel: { marginTop: 2, color: colors.subtext, fontWeight: "900", fontSize: 11, letterSpacing: 0.9, textTransform: "uppercase" },
    notes: { marginTop: 6, color: colors.text, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    blockCard: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 14, ...softShadow },
    blockHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    blockTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    blockMeta: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 11 },

    itemRow: { backgroundColor: panelBg, borderRadius: 16, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    itemTitle: { color: colors.text, fontWeight: "800", fontSize: 13, lineHeight: 18 },
    itemNotes: { marginTop: 6, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    muted: { color: colors.subtext, fontWeight: "700", marginTop: 10 },

    primaryBtn: { marginTop: 6, backgroundColor: accentBg, borderRadius: 22, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, ...softShadow },
    primaryBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  });
}
