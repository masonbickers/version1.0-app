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

const WORKOUT_SYNCS_SUBCOL = "garmin_workout_syncs"; // users/{uid}/garmin_workout_syncs

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

async function loadWorkoutSyncs(uid) {
  try {
    const ref = collection(db, "users", uid, WORKOUT_SYNCS_SUBCOL);
    const q = query(ref, orderBy("uploadedAtMs", "desc"), limit(20));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export default function GarminDataPage() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [integration, setIntegration] = useState(null);
  const [workoutSyncs, setWorkoutSyncs] = useState([]);

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

      // 2) Load recent Garmin Training API workout sends
      const syncs = await loadWorkoutSyncs(uid);
      setWorkoutSyncs(syncs);
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
            Garmin Training API
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
                  Workouts sent:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {workoutSyncs.length}
                  </Text>
                  <Text style={muted()}> (from users/{uid}/{WORKOUT_SYNCS_SUBCOL})</Text>
                </Text>
              </View>
            </View>

            {/* Training API status */}
            <View style={card()}>
              <Text style={title()}>What This Connection Does</Text>
              <Text style={[muted(), { marginTop: 10, lineHeight: 18 }]}>
                This Garmin app is configured for Training API. It can send structured workouts
                from Be to Garmin. It does not backfill health, sleep, stress, HRV, or activity history.
              </Text>
            </View>

            {/* Raw integration */}
            <View style={card()}>
              <Text style={title()}>Raw integrations.garmin</Text>
              <Text style={[mono(), { marginTop: 10 }]}>{pretty(integration)}</Text>
            </View>

            {/* Workout sync log */}
            <View style={card()}>
              <Text style={title()}>Workout Send History</Text>
              {workoutSyncs.length === 0 ? (
                <Text style={[muted(), { marginTop: 10 }]}>
                  No workouts have been sent to Garmin yet.
                </Text>
              ) : (
                <View style={{ marginTop: 10, gap: 10 }}>
                  {workoutSyncs.map((sync) => (
                    <View
                      key={sync.id}
                      style={{
                        backgroundColor: "#0f172a",
                        borderWidth: 1,
                        borderColor: "#1f2937",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <Text style={{ color: "white", fontWeight: "800" }}>
                        {sync.title || "Workout"}{" "}
                        <Text style={muted()}>{sync.garminWorkoutId || sync.id}</Text>
                      </Text>
                      <View style={{ marginTop: 8, gap: 4 }}>
                        <Row k="Uploaded" v={fmtDate(sync.uploadedAtMs)} />
                        <Row k="Session" v={sync.sessionKey || "—"} />
                        <Row k="Response" v={sync.responseStatus || "—"} />
                      </View>

                      <Text style={[mono(), { marginTop: 10, opacity: 0.9 }]}>
                        {pretty(sync)}
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
