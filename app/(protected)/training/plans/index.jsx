"use client";

/**
 * app/(protected)/plans/index.jsx
 * Plans List — shows all saved training plans
 *
 * Firestore:
 * - users/{uid}/trainingPlans/{planId}
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

function safeStr(v) {
  return String(v ?? "").trim();
}

export default function PlansIndexPage() {
  const router = useRouter();
  const user = auth.currentUser;

  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const ref = collection(db, "users", user.uid, "trainingPlans");
    const qRef = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPlans(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>Plans</Text>
          <Text style={s.headerSub}>All saved training plans</Text>
        </View>

        <TouchableOpacity onPress={() => router.push("/plans/builder")} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="plus" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
            <Text style={s.muted}>Loading plans…</Text>
          </View>
        ) : plans.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>No plans yet</Text>
            <Text style={s.muted}>Build a plan and it’ll show up here.</Text>

            <TouchableOpacity
              style={s.primaryBtn}
              activeOpacity={0.9}
              onPress={() => router.push("/plans/builder")}
            >
              <Feather name="zap" size={18} color="#111111" />
              <Text style={s.primaryBtnText}>Build plan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.cardHeadRow}>
              <Text style={s.cardTitle}>Your plans</Text>
              <Text style={s.cardMeta}>{plans.length} saved</Text>
            </View>

            {plans.map((p) => {
              const name = safeStr(p.name) || "Training plan";
              const goal = safeStr(p.goal);
              const weeks = p.weeks ?? "";
              const startDate = safeStr(p.startDate);

              return (
                <TouchableOpacity
                  key={p.id}
                  style={s.row}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/plans/${p.id}`)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={s.rowSub} numberOfLines={2}>
                      {weeks ? `${weeks} weeks` : "—"}
                      {startDate ? ` • start ${startDate}` : ""}
                      {goal ? ` • ${goal}` : ""}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.subtext} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark) {
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const cardBg = isDark ? "#111217" : "#FFFFFF";
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
    headerSub: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 2 },

    scroll: { paddingHorizontal: 18, paddingBottom: 28 },

    card: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, ...softShadow },
    cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    cardTitle: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.9, textTransform: "uppercase" },
    cardMeta: { color: colors.subtext, fontWeight: "800", fontSize: 12 },

    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border },
    rowTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    rowSub: { color: colors.subtext, fontWeight: "650", fontSize: 12, marginTop: 3, lineHeight: 16 },

    loadingWrap: { paddingTop: 30, alignItems: "center", gap: 10 },
    emptyWrap: { paddingTop: 30, alignItems: "center", gap: 10 },
    emptyTitle: { color: colors.text, fontWeight: "900", fontSize: 16 },
    muted: { color: colors.subtext, fontWeight: "650", fontSize: 13, textAlign: "center" },

    primaryBtn: { marginTop: 10, backgroundColor: accentBg, borderRadius: 22, paddingVertical: 14, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, ...softShadow },
    primaryBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  });
}
