// app/(protected)/profile/garmin-data.jsx
"use client";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { db } from "../../../firebaseConfig";
import { useAuth } from "../../../providers/AuthProvider";

const HEALTH_SUBCOL = "garmin_health"; // users/{uid}/garmin_health

function fmtDate(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function pretty(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

async function tryLoadActivities(uid) {
  const candidates = ["garmin_activities", "garminActivities"];

  for (const name of candidates) {
    try {
      const ref = collection(db, "users", uid, name);
      const q = query(ref, orderBy("startTimeMs", "desc"), limit(50));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return {
          source: name,
          items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
      }
    } catch {}
  }

  return { source: null, items: [] };
}

async function loadHealth(uid) {
  // We’ll show the latest few health payloads (daily/sleep/stress/etc.)
  try {
    const ref = collection(db, "users", uid, HEALTH_SUBCOL);
    const q = query(ref, orderBy("fetchedAtMs", "desc"), limit(7));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/**
 * Garmin Health payloads differ by entitlement/device.
 * This function tries to pull “nice” top-line numbers if present.
 */
function extractHighlights(healthDocs) {
  // Find the most recent payload (any kind)
  const latest = healthDocs?.[0]?.payload || null;
  if (!latest) return null;

  // Some integrations store arrays for a date range; handle both.
  const data = Array.isArray(latest) ? latest[0] : latest;

  // Common-ish patterns (you may need to tweak once you see your real JSON)
  const steps =
    data?.steps ??
    data?.totalSteps ??
    data?.wellness?.steps ??
    data?.dailySummary?.steps;

  const calories =
    data?.calories ??
    data?.totalCalories ??
    data?.wellness?.calories ??
    data?.dailySummary?.calories;

  const distanceM =
    data?.distanceInMeters ??
    data?.distanceMeters ??
    data?.distance ??
    data?.wellness?.distanceMeters;

  const restingHr =
    data?.restingHeartRate ??
    data?.restingHr ??
    data?.wellness?.restingHeartRate;

  const avgHr =
    data?.averageHeartRate ??
    data?.avgHr ??
    data?.wellness?.averageHeartRate;

  const stressAvg =
    data?.averageStressLevel ??
    data?.avgStress ??
    data?.stress?.average ??
    data?.wellness?.averageStressLevel;

  const bodyBattery =
    data?.bodyBattery ??
    data?.bodyBatteryScore ??
    data?.bodyBattery?.value;

  const sleepSec =
    data?.sleepSeconds ??
    data?.totalSleepSeconds ??
    data?.sleep?.totalSleepSeconds ??
    data?.sleepSummary?.sleepTimeSeconds;

  const sleepScore =
    data?.sleepScore ??
    data?.sleep?.sleepScore ??
    data?.sleepSummary?.sleepScore;

  return {
    steps,
    calories,
    distanceM,
    restingHr,
    avgHr,
    stressAvg,
    bodyBattery,
    sleepSec,
    sleepScore,
  };
}

function fmtDuration(sec) {
  if (!sec || typeof sec !== "number") return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function GarminDataPage() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [integration, setIntegration] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activitiesSource, setActivitiesSource] = useState(null);

  const [healthDocs, setHealthDocs] = useState([]);

  const connected = integration?.connected === true;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);

    try {
      // 1) Load user doc -> integrations.garmin
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      const garmin = userData?.integrations?.garmin || null;
      setIntegration(garmin);

      // 2) Load recent Garmin activities
      const { source, items } = await tryLoadActivities(uid);
      setActivitiesSource(source);
      setActivities(items);

      // 3) Load Garmin Health payloads stored in Firestore
      const hd = await loadHealth(uid);
      setHealthDocs(hd);
    } catch (e) {
      console.error("Garmin data load error:", e);
      Alert.alert("Error", "Couldn’t load Garmin data. Check Firestore rules/logs.");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  const onRefresh = useCallback(async () => {
    if (!uid) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [uid, load]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    if (!integration) {
      return [
        ["Status", "Not connected"],
        ["Garmin User ID", "—"],
        ["Token Expires", "—"],
        ["Linked At", "—"],
      ];
    }

    return [
      ["Status", connected ? "Connected" : "Not connected"],
      ["Garmin User ID", integration?.garminUserId || "—"],
      ["Token Expires", fmtDate(integration?.expiresAtMs)],
      ["Linked At", fmtDate(integration?.linkedAtMs)],
      ["Token Type", integration?.tokenType || "—"],
      ["Scope", integration?.scope || "—"],
    ];
  }, [integration, connected]);

  const highlights = useMemo(() => extractHighlights(healthDocs), [healthDocs]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: "white", fontSize: 18, fontWeight: "800" }}>
            Garmin Data
          </Text>

          <Pressable
            onPress={onRefresh}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: "#1f2937",
              borderWidth: 1,
              borderColor: "#334155",
              opacity: refreshing ? 0.7 : 1,
            }}
            disabled={refreshing}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Text>
          </Pressable>
        </View>

        {!uid ? (
          <View style={card()}>
            <Text style={title()}>Not signed in</Text>
            <Text style={muted()}>Sign in to view your Garmin data.</Text>
          </View>
        ) : loading ? (
          <View style={[card(), { alignItems: "center", paddingVertical: 22 }]}>
            <ActivityIndicator />
            <Text style={[muted(), { marginTop: 10 }]}>Loading…</Text>
          </View>
        ) : (
          <>
            {/* Connection summary */}
            <View style={card()}>
              <Text style={title()}>Connection</Text>
              <View style={{ marginTop: 10, gap: 8 }}>
                {summary.map(([k, v]) => (
                  <View
                    key={k}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <Text style={muted()}>{k}</Text>
                    <Text
                      style={{
                        color: "white",
                        fontWeight: "700",
                        flexShrink: 1,
                        textAlign: "right",
                      }}
                    >
                      {String(v)}
                    </Text>
                  </View>
                ))}
              </View>

              <View
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: "#1f2937",
                }}
              >
                <Text style={muted()}>
                  Activities loaded:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {activities.length}
                  </Text>
                  {activitiesSource ? (
                    <Text style={muted()}> (from users/{uid}/{activitiesSource})</Text>
                  ) : (
                    <Text style={muted()}> (no Garmin activity subcollection found)</Text>
                  )}
                </Text>

                <Text style={muted()}>
                  Health payloads:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {healthDocs.length}
                  </Text>
                  <Text style={muted()}> (from users/{uid}/{HEALTH_SUBCOL})</Text>
                </Text>
              </View>
            </View>

            {/* Health highlights */}
            <View style={card()}>
              <Text style={title()}>Health Highlights</Text>

              {healthDocs.length === 0 ? (
                <Text style={[muted(), { marginTop: 10 }]}>
                  No Garmin Health data found in Firestore yet.
                  Store your Health API responses under `users/{uid}/{HEALTH_SUBCOL}` with fields:
                  `payload` and `fetchedAtMs` (number).
                </Text>
              ) : !highlights ? (
                <Text style={[muted(), { marginTop: 10 }]}>
                  Health payloads found, but couldn’t extract highlights yet.
                  Scroll down to see raw JSON — then we’ll map the fields perfectly.
                </Text>
              ) : (
                <View style={{ marginTop: 10, gap: 6 }}>
                  <Row k="Steps" v={highlights.steps ?? "—"} />
                  <Row
                    k="Distance"
                    v={
                      typeof highlights.distanceM === "number"
                        ? `${(highlights.distanceM / 1000).toFixed(2)} km`
                        : highlights.distanceM ?? "—"
                    }
                  />
                  <Row k="Calories" v={highlights.calories ?? "—"} />
                  <Row k="Resting HR" v={highlights.restingHr ?? "—"} />
                  <Row k="Avg HR" v={highlights.avgHr ?? "—"} />
                  <Row k="Stress (avg)" v={highlights.stressAvg ?? "—"} />
                  <Row k="Body Battery" v={highlights.bodyBattery ?? "—"} />
                  <Row
                    k="Sleep"
                    v={
                      typeof highlights.sleepSec === "number"
                        ? fmtDuration(highlights.sleepSec)
                        : highlights.sleepSec ?? "—"
                    }
                  />
                  <Row k="Sleep Score" v={highlights.sleepScore ?? "—"} />
                </View>
              )}
            </View>

            {/* Raw integration */}
            <View style={card()}>
              <Text style={title()}>Raw integrations.garmin</Text>
              <Text style={[mono(), { marginTop: 10 }]}>{pretty(integration)}</Text>
            </View>

            {/* Raw Health payloads */}
            <View style={card()}>
              <Text style={title()}>Raw Garmin Health Payloads</Text>
              {healthDocs.length === 0 ? (
                <Text style={[muted(), { marginTop: 10 }]}>
                  Nothing stored yet under users/{uid}/{HEALTH_SUBCOL}.
                </Text>
              ) : (
                <View style={{ marginTop: 10, gap: 10 }}>
                  {healthDocs.map((h) => (
                    <View
                      key={h.id}
                      style={{
                        backgroundColor: "#0f172a",
                        borderWidth: 1,
                        borderColor: "#1f2937",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <Text style={{ color: "white", fontWeight: "800" }}>
                        {h.kind || "health"}{" "}
                        <Text style={muted()}>{h.date || ""}</Text>
                      </Text>
                      <View style={{ marginTop: 8, gap: 4 }}>
                        <Row k="Fetched" v={fmtDate(h.fetchedAtMs)} />
                        <Row k="Doc ID" v={h.id} />
                      </View>

                      <Text style={[mono(), { marginTop: 10, opacity: 0.9 }]}>
                        {pretty(h.payload)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Activities list */}
            <View style={card()}>
              <Text style={title()}>Recent Garmin Activities</Text>
              {activities.length === 0 ? (
                <Text style={[muted(), { marginTop: 10 }]}>
                  No activities found yet. If you are importing activities, make sure your importer writes
                  to `users/{uid}/garmin_activities` (or `garminActivities`) with a `startTimeMs` field so
                  this list can sort properly.
                </Text>
              ) : (
                <View style={{ marginTop: 10, gap: 10 }}>
                  {activities.map((a) => (
                    <View
                      key={a.id}
                      style={{
                        backgroundColor: "#0f172a",
                        borderWidth: 1,
                        borderColor: "#1f2937",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <Text style={{ color: "white", fontWeight: "800" }}>
                        {a.activityName || a.type || "Activity"}{" "}
                        <Text style={muted()}>{a.id}</Text>
                      </Text>

                      <View style={{ marginTop: 8, gap: 4 }}>
                        <Row k="Start" v={fmtDate(a.startTimeMs || a.startTime || a.start)} />
                        <Row k="Duration (s)" v={a.durationSec ?? a.duration ?? "—"} />
                        <Row k="Distance (m)" v={a.distanceM ?? a.distance ?? "—"} />
                        <Row k="Avg HR" v={a.avgHr ?? a.averageHeartRate ?? "—"} />
                        <Row k="Calories" v={a.calories ?? "—"} />
                      </View>

                      <Text style={[mono(), { marginTop: 10, opacity: 0.9 }]}>
                        {pretty(a)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ k, v }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text style={muted()}>{k}</Text>
      <Text style={{ color: "white", fontWeight: "700", flexShrink: 1, textAlign: "right" }}>
        {String(v)}
      </Text>
    </View>
  );
}

function card() {
  return {
    backgroundColor: "#111827",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 14,
  };
}
function title() {
  return { color: "white", fontSize: 14, fontWeight: "900" };
}
function muted() {
  return { color: "#9ca3af", fontSize: 12, fontWeight: "600" };
}
function mono() {
  return {
    color: "#e5e7eb",
    fontSize: 12,
    lineHeight: 16,
    fontFamily: "Menlo",
  };
}
