"use client";

import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { db } from "../../../firebaseConfig"; // adjust if your path differs
import { useAuth } from "../../../providers/AuthProvider"; // adjust if your path differs
import { useTheme } from "../../../providers/ThemeProvider"; // adjust if your path differs

// ✅ IMPORTANT: set this to your API base.
// Example: "http://192.168.1.32:3001" (LAN) or "https://yourdomain.com"
const API_BASE = API_URL;

function maskToken(t) {
  if (!t || typeof t !== "string") return "";
  if (t.length <= 18) return "••••••••";
  return `${t.slice(0, 10)}…${t.slice(-8)}`;
}

function fmtDateTime(msOrIso) {
  try {
    if (!msOrIso) return "";
    const d = typeof msOrIso === "number" ? new Date(msOrIso) : new Date(msOrIso);
    return d.toLocaleString();
  } catch {
    return String(msOrIso || "");
  }
}

function yyyyMmDd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function GarminScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();

  const uid = user?.uid;

  const UI = useMemo(() => {
    // Use your theme tokens if you have them; this keeps the same “dark card” look.
    return {
      bg: theme?.bg || "#0b1220",
      card: theme?.card || "#0f1b2f",
      card2: theme?.card2 || "#0d172a",
      text: theme?.text || "#e5e7eb",
      muted: theme?.muted || "#94a3b8",
      border: "rgba(255,255,255,0.08)",
      brand: theme?.brand || "#60a5fa",
      ok: "#34d399",
      warn: "#fbbf24",
      radius: 16,
    };
  }, [theme]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [integration, setIntegration] = useState(null);
  const [healthDocs, setHealthDocs] = useState([]); // raw docs list (or latest)
  const [activities, setActivities] = useState([]);

  const loadAll = useCallback(async () => {
    if (!uid) return;

    setLoading(true);
    try {
      // 1) users/{uid} -> integrations.garmin
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      const garmin = userData?.integrations?.garmin || null;
      setIntegration(garmin);

      // 2) users/{uid}/garmin_health (latest 10)
      const healthRef = collection(db, "users", uid, "garmin_health");
      const healthQ = query(healthRef, orderBy("fetchedAtMs", "desc"), limit(10));
      const healthSnap = await getDocs(healthQ);
      const healthArr = healthSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHealthDocs(healthArr);

      // 3) users/{uid}/garmin_activities (latest 50)
      // NOTE: Your UI text mentions `garmin_activities` OR `garminActivities`.
      // If your collection is named differently, change it here.
      const actRef = collection(db, "users", uid, "garmin_activities");
      const actQ = query(actRef, orderBy("startTimeMs", "desc"), limit(50));
      const actSnap = await getDocs(actQ);
      const actArr = actSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setActivities(actArr);
    } catch (e) {
      console.log("Garmin screen load error:", e);
      Alert.alert("Error", "Couldn’t load Garmin data from Firestore.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    if (!uid) return;

    if (!API_BASE) {
      Alert.alert(
        "Missing API base",
        "Set EXPO_PUBLIC_API_URL for your API endpoint."
      );
      return;
    }

    setRefreshing(true);
    try {
      // ✅ Pick ONE of your endpoints. This one matches what you were testing:
      // /auth/garmin/health/try-dailies?uid=...&date=YYYY-MM-DD
      const date = yyyyMmDd(new Date());
      const url = `${API_BASE}/auth/garmin/health/try-dailies?uid=${encodeURIComponent(uid)}&date=${encodeURIComponent(date)}`;

      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json?.ok === false) {
        console.log("Refresh error:", json);
        Alert.alert("Refresh failed", json?.error || "Garmin refresh returned an error.");
      } else {
        // After server writes into Firestore, reload
        await loadAll();
      }
    } catch (e) {
      console.log("Refresh exception:", e);
      Alert.alert("Error", "Couldn’t refresh Garmin data.");
    } finally {
      setRefreshing(false);
    }
  }, [uid, loadAll]);

  const connected = !!integration?.connected;

  const tokenExpiryText = useMemo(() => {
    // you have expiresAtMs in your raw JSON
    const ms = integration?.expiresAtMs;
    if (!ms) return "";
    return fmtDateTime(ms);
  }, [integration]);

  const linkedAtText = useMemo(() => {
    const ms = integration?.linkedAtMs;
    if (!ms) return "";
    return fmtDateTime(ms);
  }, [integration]);

  const healthCount = healthDocs?.length || 0;
  const activityCount = activities?.length || 0;

  const latestHealth = healthDocs?.[0] || null;

  if (!uid) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: UI.bg }}>
        <View style={{ padding: 18 }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "700" }}>
            Garmin Data
          </Text>
          <Text style={{ marginTop: 8, color: UI.muted }}>
            Please sign in to view Garmin data.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: UI.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: UI.text, fontSize: 22, fontWeight: "800" }}>
            Garmin Data
          </Text>

          <Pressable
            onPress={onRefresh}
            disabled={refreshing}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: UI.card2,
              borderWidth: 1,
              borderColor: UI.border,
              opacity: refreshing ? 0.7 : 1,
            }}
          >
            {refreshing ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator />
                <Text style={{ color: UI.text, fontWeight: "700" }}>Refreshing</Text>
              </View>
            ) : (
              <Text style={{ color: UI.text, fontWeight: "700" }}>Refresh</Text>
            )}
          </Pressable>
        </View>

        {/* Connection */}
        <View style={{
          marginTop: 14,
          backgroundColor: UI.card,
          borderRadius: UI.radius,
          borderWidth: 1,
          borderColor: UI.border,
          padding: 14,
        }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
            Connection
          </Text>

          <Row label="Status" value={connected ? "Connected" : "Not Connected"} valueColor={connected ? UI.ok : UI.warn} UI={UI} />
          <Row label="Garmin User ID" value={integration?.garminUserId || "-"} UI={UI} />
          <Row label="Token Expires" value={tokenExpiryText || "-"} UI={UI} />
          <Row label="Linked At" value={linkedAtText || "-"} UI={UI} />
          <Row label="Token Type" value={integration?.tokenType || "-"} UI={UI} />
          <Row label="Scope" value={integration?.scope || "-"} UI={UI} />

          <View style={{ height: 1, backgroundColor: UI.border, marginVertical: 12 }} />

          <Text style={{ color: UI.muted }}>
            Activities loaded: {activityCount}{" "}
            {activityCount === 0 ? "(no Garmin activity subcollection found)" : ""}
          </Text>
          <Text style={{ color: UI.muted, marginTop: 6 }}>
            Health payloads: {healthCount}{" "}
            {healthCount === 0 ? `(from users/${uid}/garmin_health)` : ""}
          </Text>
        </View>

        {/* Health Highlights */}
        <View style={{
          marginTop: 14,
          backgroundColor: UI.card,
          borderRadius: UI.radius,
          borderWidth: 1,
          borderColor: UI.border,
          padding: 14,
        }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
            Health Highlights
          </Text>

          {loading ? (
            <ActivityIndicator />
          ) : latestHealth?.payload ? (
            <HealthHighlights payload={latestHealth.payload} UI={UI} />
          ) : (
            <Text style={{ color: UI.muted, lineHeight: 20 }}>
              No Garmin Health data found in Firestore yet. Store your Health API responses under{" "}
              <Text style={{ color: UI.text }}>{`users/${uid}/garmin_health`}</Text>{" "}
              with fields: <Text style={{ color: UI.text }}>payload</Text> and{" "}
              <Text style={{ color: UI.text }}>fetchedAtMs</Text> (number).
            </Text>
          )}
        </View>

        {/* Raw integrations.garmin */}
        <View style={{
          marginTop: 14,
          backgroundColor: UI.card,
          borderRadius: UI.radius,
          borderWidth: 1,
          borderColor: UI.border,
          padding: 14,
        }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
            Raw integrations.garmin
          </Text>

          <View style={{
            backgroundColor: "#071021",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: UI.border,
            padding: 12,
          }}>
            <Text style={{ color: UI.muted, fontFamily: "Menlo", fontSize: 12, lineHeight: 18 }}>
              {JSON.stringify(
                integration
                  ? {
                      ...integration,
                      // ✅ mask secrets in the UI
                      accessToken: maskToken(integration.accessToken),
                      refreshToken: maskToken(integration.refreshToken),
                    }
                  : null,
                null,
                2
              )}
            </Text>
          </View>
        </View>

        {/* Raw Health payloads */}
        <View style={{
          marginTop: 14,
          backgroundColor: UI.card,
          borderRadius: UI.radius,
          borderWidth: 1,
          borderColor: UI.border,
          padding: 14,
        }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
            Raw Garmin Health Payloads
          </Text>

          {healthCount === 0 ? (
            <Text style={{ color: UI.muted }}>
              Nothing stored yet under users/{uid}/garmin_health.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {healthDocs.map((h) => (
                <View
                  key={h.id}
                  style={{
                    backgroundColor: "#071021",
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: UI.border,
                    padding: 12,
                  }}
                >
                  <Text style={{ color: UI.muted, marginBottom: 6 }}>
                    fetchedAt: {fmtDateTime(h.fetchedAtMs || h.fetchedAt || h.createdAtMs)}
                  </Text>
                  <Text style={{ color: UI.muted, fontFamily: "Menlo", fontSize: 12, lineHeight: 18 }}>
                    {JSON.stringify(h.payload ?? h, null, 2)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Activities */}
        <View style={{
          marginTop: 14,
          backgroundColor: UI.card,
          borderRadius: UI.radius,
          borderWidth: 1,
          borderColor: UI.border,
          padding: 14,
        }}>
          <Text style={{ color: UI.text, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
            Recent Garmin Activities
          </Text>

          {activities.length === 0 ? (
            <Text style={{ color: UI.muted, lineHeight: 20 }}>
              No activities found yet. If you are importing activities, make sure your importer writes to{" "}
              <Text style={{ color: UI.text }}>{`users/${uid}/garmin_activities`}</Text>{" "}
              (or <Text style={{ color: UI.text }}>garminActivities</Text>) with a{" "}
              <Text style={{ color: UI.text }}>startTimeMs</Text> field so this list can sort properly.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {activities.map((a) => (
                <View
                  key={a.id}
                  style={{
                    backgroundColor: UI.card2,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: UI.border,
                    padding: 12,
                  }}
                >
                  <Text style={{ color: UI.text, fontWeight: "800" }}>
                    {a.activityName || a.type || "Activity"}
                  </Text>
                  <Text style={{ color: UI.muted, marginTop: 4 }}>
                    {fmtDateTime(a.startTimeMs || a.startTime || a.start)}{" "}
                    {a.durationSec ? `• ${Math.round(a.durationSec / 60)} min` : ""}
                    {a.distanceM ? ` • ${(a.distanceM / 1000).toFixed(2)} km` : ""}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {loading && (
          <View style={{ marginTop: 14 }}>
            <ActivityIndicator />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, valueColor, UI }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
      <Text style={{ color: UI.muted }}>{label}</Text>
      <Text
        style={{
          color: valueColor || UI.text,
          fontWeight: "700",
          flexShrink: 1,
          textAlign: "right",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function HealthHighlights({ payload, UI }) {
  // This is deliberately “best-effort” because Garmin payload structure varies.
  // You can refine once you see actual payload keys.
  const p = payload || {};
  const candidates = [
    ["Steps", p.steps ?? p.totalSteps ?? p.stepCount],
    ["Calories", p.calories ?? p.totalCalories ?? p.activeCalories],
    ["Resting HR", p.restingHeartRate ?? p.rhr],
    ["Avg HR", p.averageHeartRate ?? p.avgHr],
    ["Sleep (min)", p.sleepDurationMinutes ?? p.totalSleepMinutes],
    ["Body Battery", p.bodyBattery ?? p.bodyBatteryHigh ?? p.bodyBatteryLow],
    ["Stress", p.stress ?? p.stressLevel],
  ].filter(([, v]) => v !== undefined && v !== null);

  if (candidates.length === 0) {
    return (
      <Text style={{ color: UI.muted }}>
        Health payload found, but no recognised summary fields yet. Open “Raw Garmin Health Payloads” to inspect keys.
      </Text>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {candidates.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: UI.muted }}>{k}</Text>
          <Text style={{ color: UI.text, fontWeight: "800" }}>{String(v)}</Text>
        </View>
      ))}
    </View>
  );
}
