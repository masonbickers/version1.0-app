"use client";

import { Feather } from "@expo/vector-icons";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { API_URL } from "../../../config/api";
import { db } from "../../../firebaseConfig";
import { useAuth } from "../../../providers/AuthProvider";
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

function safePreview(value, maxChars = 2400) {
  if (value == null) return "No payload.";
  let text = "";
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n… truncated ${text.length - maxChars} characters for app stability`;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sourcePayload(doc) {
  return doc?.data || doc?.payload || doc?.summary || doc || {};
}

function formatDate(value) {
  const ms = toMillis(value);
  if (!ms) return "No timestamp";
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMetric(value, suffix = "") {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString()}${suffix}`;
}

function summariseHealthDoc(doc) {
  const kind = String(doc?.kind || doc?.id || "").toLowerCase();
  if (kind.includes("request") || kind.includes("pull") || kind === "user_id") {
    return { hasUsefulData: false };
  }

  const payload = sourcePayload(doc);
  const source = payload?.summary || payload?.dailySummary || payload?.wellnessSummary || payload;
  const isErrorPayload = !!(
    source?.errorMessage ||
    source?.error ||
    source?.errors ||
    source?.status === 400 ||
    source?.status === 409
  );
  const sleepMinutes = pickNumber(
    source.sleepDurationMinutes,
    source.totalSleepMinutes,
    source.sleepingSeconds ? source.sleepingSeconds / 60 : null
  );
  const hrv = pickNumber(source.hrv, source.hrvMs, source.lastNightAvg);
  const restingHr = pickNumber(
    source.restingHeartRateInBeatsPerMinute,
    source.restingHeartRate,
    source.restingHr,
    source.rhr
  );

  return {
    steps: pickNumber(source.steps, source.totalSteps, source.stepCount),
    activeCalories: pickNumber(source.activeKilocalories, source.activeCalories, source.calories),
    stress: pickNumber(source.averageStressLevel, source.avgStressLevel, source.stressLevel, source.stress),
    bodyBattery: pickNumber(
      source.bodyBatteryMostRecentValue,
      source.bodyBattery,
      source.bodyBatteryHigh,
      source.bodyBatteryChargedValue
    ),
    sleep: sleepMinutes,
    hrv,
    restingHr,
    hasUsefulData:
      !isErrorPayload &&
      (pickNumber(source.steps, source.totalSteps, source.stepCount) != null ||
        sleepMinutes != null ||
        hrv != null ||
        restingHr != null),
  };
}

async function fetchHealthDocs(uid) {
  const ref = collection(db, "users", uid, "garmin_health");
  const specs = [
    query(ref, orderBy("updatedAt", "desc"), limit(30)),
    query(ref, orderBy("fetchedAt", "desc"), limit(30)),
    query(ref, orderBy("fetchedAtMs", "desc"), limit(30)),
  ];

  const snaps = await Promise.all(specs.map((spec) => getDocs(spec).catch(() => null)));
  const byId = new Map();
  snaps.forEach((snap) => {
    snap?.docs?.forEach((docSnap) => {
      byId.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() || {}) });
    });
  });

  return Array.from(byId.values()).sort(
    (a, b) =>
      toMillis(b.updatedAt || b.fetchedAt || b.fetchedAtMs) -
      toMillis(a.updatedAt || a.fetchedAt || a.fetchedAtMs)
  );
}

function Metric({ icon, label, value, colors }) {
  return (
    <View style={[styles.metric, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name={icon} size={15} color={colors.sapPrimary || colors.primary || "#E6FF3B"} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.metricLabel, { color: colors.subtext }]}>{label}</Text>
        <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function GarminHealthPage() {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const uid = user?.uid;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [docs, setDocs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!uid) {
      setDocs([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setErr("");
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      setDocs(await fetchHealthDocs(uid));
    } catch (e) {
      console.error("garmin_health load error:", e);
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  const requestBackfill30 = useCallback(async () => {
    if (!user?.uid) {
      Alert.alert("Not signed in", "Sign in first.");
      return;
    }
    if (!API_URL) {
      Alert.alert("API unavailable", "The app does not have an API URL configured.");
      return;
    }

    const to = todayISO();
    const from = addDaysISO(to, -29);

    setBackfilling(true);
    try {
      const token = await user.getIdToken();
      const url = `${API_URL}/garmin/health/backfill/dailies-range?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Backfill request failed.");

      Alert.alert(
        "Backfill requested",
        `Requested ${json.requested || 0} days. Garmin will deliver available summaries by webhook.`
      );
      await load({ silent: true });
    } catch (e) {
      Alert.alert("Backfill failed", e?.message || "Something went wrong.");
    } finally {
      setBackfilling(false);
    }
  }, [load, user]);

  const latestUseful = useMemo(
    () => docs.find((doc) => summariseHealthDoc(doc).hasUsefulData) || null,
    [docs]
  );
  const latestSummary = latestUseful ? summariseHealthDoc(latestUseful) : null;

  return (
    <View style={[styles.safe, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load({ silent: true })} />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Garmin Health</Text>
          <Text style={[styles.subtitle, { color: colors.subtext }]}>
            Latest daily health payloads saved under your account.
          </Text>
        </View>

        {!!err && <Text style={[styles.error, { color: colors.danger || "#EF4444" }]}>{err}</Text>}

        {loading ? (
          <ActivityIndicator />
        ) : latestSummary ? (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: isDark ? "rgba(255,255,255,0.06)" : colors.card }]}>
            <View style={styles.cardTop}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Latest usable summary</Text>
              <Text style={[styles.cardMeta, { color: colors.subtext }]}>
                {latestUseful.date || "No date"} · {latestUseful.kind || latestUseful.id}
              </Text>
            </View>
            <View style={styles.metricGrid}>
              <Metric icon="map" label="Steps" value={formatMetric(latestSummary.steps)} colors={colors} />
              <Metric icon="zap" label="Active Cal" value={formatMetric(latestSummary.activeCalories)} colors={colors} />
              <Metric icon="heart" label="RHR" value={formatMetric(latestSummary.restingHr, " bpm")} colors={colors} />
              <Metric icon="activity" label="HRV" value={formatMetric(latestSummary.hrv, " ms")} colors={colors} />
              <Metric icon="battery" label="Battery" value={formatMetric(latestSummary.bodyBattery)} colors={colors} />
              <Metric icon="moon" label="Sleep" value={latestSummary.sleep ? `${Math.round(latestSummary.sleep)} min` : "—"} colors={colors} />
            </View>
          </View>
        ) : (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>No usable health summary yet</Text>
            <Text style={[styles.subtitle, { color: colors.subtext }]}>
              Garmin may have accepted a backfill request, but daily summaries have not arrived with readable metrics yet.
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={requestBackfill30}
          disabled={backfilling}
          activeOpacity={0.88}
          style={[
            styles.primaryButton,
            { backgroundColor: colors.sapPrimary || colors.primary || "#E6FF3B" },
            backfilling && { opacity: 0.7 },
          ]}
        >
          {backfilling ? (
            <ActivityIndicator color="#111111" />
          ) : (
            <Feather name="download" size={16} color="#111111" />
          )}
          <Text style={styles.primaryButtonText}>
            {backfilling ? "Requesting backfill..." : "Request last 30 days from Garmin"}
          </Text>
        </TouchableOpacity>

        <View style={styles.listHeader}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Stored payloads</Text>
          <Text style={[styles.cardMeta, { color: colors.subtext }]}>{docs.length} docs</Text>
        </View>

        {docs.map((d) => {
            const isOpen = openId === d.id;
            const summary = summariseHealthDoc(d);
            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => setOpenId(isOpen ? null : d.id)}
                style={{
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  padding: 12,
                  borderRadius: 14,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {d.kind || d.id}
                </Text>

                <Text style={{ color: colors.subtext, marginTop: 6 }}>
                  date: {d.date || "—"} · saved: {formatDate(d.updatedAt || d.fetchedAt || d.fetchedAtMs)}
                </Text>
                <Text style={{ color: colors.subtext, marginTop: 4 }}>
                  steps: {formatMetric(summary.steps)} · RHR: {formatMetric(summary.restingHr, " bpm")} · status: {d.meta?.status || "—"}
                </Text>

                {isOpen ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: colors.text, fontWeight: "800", marginBottom: 6 }}>
                      Payload
                    </Text>
                    <Text style={{ color: colors.text, fontFamily: "Menlo", fontSize: 12 }}>
                      {safePreview(sourcePayload(d))}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  header: { gap: 5 },
  title: { fontSize: 26, fontWeight: "900" },
  subtitle: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 13, fontWeight: "800" },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  cardTop: { gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "900" },
  cardMeta: { fontSize: 12, fontWeight: "700" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: {
    width: "48%",
    minHeight: 58,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  metricLabel: { fontSize: 11, fontWeight: "800" },
  metricValue: { fontSize: 15, fontWeight: "900", marginTop: 2 },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "900",
  },
});
