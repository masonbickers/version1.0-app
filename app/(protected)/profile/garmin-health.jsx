"use client";

import { Feather } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function GarminHealthPage() {
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#007AFF";
  const s = useMemo(() => styles(colors, isDark, accent), [colors, isDark, accent]);

  const uid = auth.currentUser?.uid;

  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);

  const pullAndShow = async () => {
    if (!uid) return Alert.alert("Not signed in", "Sign in first.");

    setLoading(true);
    try {
      // 1) Ask server to pull from Garmin + store in Firestore
      const url = `${API_URL}/auth/garmin/health/daily?uid=${encodeURIComponent(uid)}&date=${encodeURIComponent(date)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        console.log("Garmin pull failed:", r.status, j);
        return Alert.alert("Garmin pull failed", j?.error || "Check server logs / entitlement / endpoint path.");
      }

      // 2) Read stored document
      const ref = doc(db, "users", uid, "garmin_health", `daily_${date}`);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setData(j.data || null);
        setMeta({ note: "Stored doc not found; showing server response." });
        return;
      }

      const stored = snap.data();
      setData(stored.payload || null);
      setMeta({ fetchedAtMs: stored.fetchedAtMs, kind: stored.kind, date: stored.date });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.header}>
          <Text style={s.title}>Garmin Health</Text>
          <Text style={s.sub}>Daily health summary for {date}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Actions</Text>

          <Pressable
            onPress={pullAndShow}
            disabled={loading}
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.92 }, loading && { opacity: 0.7 }]}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Feather name="download" size={16} color="#fff" />}
            <Text style={s.primaryBtnText}>{loading ? "Pulling…" : "Pull today’s Garmin health"}</Text>
          </Pressable>

          <Text style={s.helper}>
            This calls your server, which fetches from Garmin Health API and stores the raw payload in Firestore.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Meta</Text>
          <Text style={s.mono}>{JSON.stringify(meta, null, 2)}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Raw Garmin Payload</Text>
          <Text style={s.mono}>{JSON.stringify(data, null, 2)}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function styles(colors, isDark, accent) {
  return {
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    header: { gap: 4, marginBottom: 6 },
    title: { fontSize: 26, fontWeight: "900", color: colors.text },
    sub: { fontSize: 13, color: colors.subtext },
    card: {
      borderRadius: 16,
      padding: 14,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    cardTitle: { fontSize: 14, fontWeight: "900", color: colors.text },
    primaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 999,
      paddingVertical: 12,
      backgroundColor: accent,
    },
    primaryBtnText: { color: "#fff", fontWeight: "900" },
    helper: { fontSize: 12, color: colors.subtext },
    mono: {
      fontFamily: "Menlo",
      fontSize: 12,
      lineHeight: 16,
      color: isDark ? "#e5e7eb" : "#111827",
    },
  };
}
