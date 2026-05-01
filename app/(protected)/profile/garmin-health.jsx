"use client";

import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(date, delta) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken?.();
  if (!token) throw new Error("Please sign in again.");
  return { Authorization: `Bearer ${token}` };
}

export default function GarminHealthPage() {
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#007AFF";
  const s = useMemo(() => styles(colors, isDark, accent), [colors, isDark, accent]);

  const uid = auth.currentUser?.uid;

  const [date] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);

  const readStoredDay = async () => {
    if (!uid) return Alert.alert("Not signed in", "Sign in first.");

    setLoading(true);
    try {
      const url = `${API_URL}/garmin/health/read?kind=dailies&date=${encodeURIComponent(date)}`;
      const r = await fetch(url, { headers: await authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j?.error || "Could not read Garmin health data.");

      if (!j.found) {
        setData(null);
        setMeta({
          found: false,
          date,
          note: "No stored Garmin daily summary for this date yet. Request backfill, then check again after Garmin delivers the webhook.",
          triedDocIds: j.triedDocIds || [],
        });
        return;
      }

      const stored = j.doc || {};
      setData(stored.data || stored.payload || null);
      setMeta({ found: true, docId: j.docId, kind: stored.kind, date: stored.date });
    } catch (e) {
      console.error(e);
      Alert.alert("Error", e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const requestBackfill30 = async () => {
    if (!uid) return Alert.alert("Not signed in", "Sign in first.");

    const to = todayISO();
    const from = addDaysISO(to, -29);

    setBackfilling(true);
    try {
      const url = `${API_URL}/garmin/health/backfill/dailies-range?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`;
      const r = await fetch(url, { headers: await authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Backfill request failed.");

      setMeta({
        backfill: true,
        from,
        to,
        requested: j.requested,
        accepted: j.accepted,
        failed: j.failed,
        message: j.message,
        results: j.results,
      });
      Alert.alert(
        "Garmin backfill requested",
        `Requested ${j.requested || 0} days. Garmin will deliver available daily summaries via webhook.`
      );
    } catch (e) {
      console.error(e);
      Alert.alert("Backfill failed", e?.message || "Something went wrong");
    } finally {
      setBackfilling(false);
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
            onPress={requestBackfill30}
            disabled={backfilling}
            style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.92 }, backfilling && { opacity: 0.7 }]}
          >
            {backfilling ? <ActivityIndicator color="#fff" /> : <Feather name="download" size={16} color="#fff" />}
            <Text style={s.primaryBtnText}>{backfilling ? "Requesting…" : "Backfill last 30 days"}</Text>
          </Pressable>

          <Pressable
            onPress={readStoredDay}
            disabled={loading}
            style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.92 }, loading && { opacity: 0.7 }]}
          >
            {loading ? <ActivityIndicator color={accent} /> : <Feather name="refresh-cw" size={16} color={accent} />}
            <Text style={s.secondaryBtnText}>{loading ? "Checking…" : "Check selected day"}</Text>
          </Pressable>

          <Text style={s.helper}>
            Backfill requests Garmin daily summaries. Available data is delivered later by Garmin webhook, then stored in Firestore.
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
    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 999,
      paddingVertical: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: accent,
    },
    secondaryBtnText: { color: accent, fontWeight: "900" },
    helper: { fontSize: 12, color: colors.subtext },
    mono: {
      fontFamily: "Menlo",
      fontSize: 12,
      lineHeight: 16,
      color: isDark ? "#e5e7eb" : "#111827",
    },
  };
}
