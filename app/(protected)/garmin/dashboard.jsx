// app/(protected)/garmin/dashboard.jsx

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_URL } from "../../../config/api";
import { useAuth } from "../../../providers/AuthProvider"; // adjust path

function guessLanApiBase() {
  return String(API_URL || "").replace(/\/$/, "");
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toISODate(d);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeJson(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { raw: txt };
  }
}

async function authHeaders(user) {
  const token = await user?.getIdToken?.();
  if (!token) throw new Error("Please sign in again.");
  return { Authorization: `Bearer ${token}` };
}

export default function SummaryScreen() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState(null);
  const [data, setData] = useState(null);
  const [debug, setDebug] = useState(null);
  const [connected, setConnected] = useState(false);

  const base = useMemo(() => guessLanApiBase(), []);
  const canFetch = !!uid && !!selectedDate && !!base;

  useEffect(() => {
    if (!base) {
      setMessage("API not configured for this build. Set EXPO_PUBLIC_API_URL.");
    }
  }, [base]);

  const fetchDebug = useCallback(async () => {
    if (!uid) return null;
    const r = await fetch(`${base}/garmin/health/debug`, {
      headers: await authHeaders(user),
    });
    const j = await safeJson(r);
    setDebug(j);
    setConnected(!!j?.connected);
    return j;
  }, [base, uid, user]);

  const fetchDailies = useCallback(
    async (dateISO) => {
      const url = `${base}/garmin/health/read?kind=dailies&date=${encodeURIComponent(
        dateISO
      )}`;

      const r = await fetch(url, { headers: await authHeaders(user) });
      const j = await safeJson(r);
      const day = j?.found ? j?.doc?.data || null : null;
      const isPending = !j?.found;

      return { j, day, isPending };
    },
    [base, user]
  );

  const triggerBackfill = useCallback(
    async (dateISO) => {
      const url = `${base}/garmin/health/backfill/dailies?date=${encodeURIComponent(
        dateISO
      )}`;
      const r = await fetch(url, { headers: await authHeaders(user) });
      const j = await safeJson(r);
      return j;
    },
    [base, user]
  );

  const runLoad = useCallback(
    async (dateISO) => {
      if (!canFetch) return;

      setLoading(true);
      setPending(false);
      setMessage("");
      setErr(null);
      setData(null);

      try {
        const dbg = await fetchDebug();

        if (!dbg?.connected) {
          setLoading(false);
          setMessage("Garmin not connected yet. Connect from Settings first.");
          return;
        }

        // 1) Fast path: read existing stored webhook doc
        const first = await fetchDailies(dateISO);

        if (first.day) {
          setData(first.day);
          setLoading(false);
          return;
        }

        // 2) If missing, request backfill then poll for webhook storage
        setPending(true);
        setMessage("Requesting Garmin backfill…");
        const backfill = await triggerBackfill(dateISO);
        if (backfill?.ok === false && backfill?.status !== 202 && backfill?.status !== 409) {
          setPending(false);
          setLoading(false);
          setMessage("");
          setErr(
            backfill?.data?.errorMessage ||
              backfill?.errorMessage ||
              backfill?.error ||
              "Backfill request failed."
          );
          return;
        }

        const maxAttempts = 12;
        const intervalMs = 2500;

        for (let i = 0; i < maxAttempts; i++) {
          setMessage(`Waiting for Garmin data… (${i + 1}/${maxAttempts})`);
          await sleep(intervalMs);

          const res = await fetchDailies(dateISO);

          if (res.day) {
            setData(res.day);
            setPending(false);
            setLoading(false);
            setMessage("");
            return;
          }

          // If Garmin said “pending” (409), we just keep waiting
          if (!res.isPending) {
            // Not pending but still no data = genuinely not available yet
            break;
          }
        }

        setPending(false);
        setLoading(false);
        setMessage("No Garmin data for this day yet. Try again later.");
      } catch (e) {
        setErr(String(e?.message || e));
        setPending(false);
        setLoading(false);
      }
    },
    [canFetch, fetchDailies, fetchDebug, triggerBackfill]
  );

  useEffect(() => {
    if (!canFetch) return;
    runLoad(selectedDate);
  }, [canFetch, selectedDate, runLoad]);

  const prev = () => setSelectedDate((d) => addDays(d, -1));
  const next = () => setSelectedDate((d) => addDays(d, +1));

  const onRefresh = () => runLoad(selectedDate);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Header row */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Pressable
            onPress={prev}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.15)",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: "#fff" }}>‹ Prev</Text>
          </Pressable>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "600" }}>
              Garmin Daily Summary
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
              {selectedDate}
            </Text>
            <Text
              style={{
                color: "rgba(255,255,255,0.35)",
                marginTop: 6,
                fontSize: 12,
                maxWidth: 260,
                textAlign: "center",
              }}
              numberOfLines={2}
            >
              {base}
            </Text>
          </View>

          <Pressable
            onPress={next}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.15)",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: "#fff" }}>Next ›</Text>
          </Pressable>
        </View>

        {/* Refresh */}
        <View style={{ alignItems: "center", marginTop: 14 }}>
          <Pressable
            onPress={onRefresh}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 18,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.15)",
              backgroundColor: "rgba(255,255,255,0.06)",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: "#fff", fontWeight: "600" }}>Refresh</Text>
          </Pressable>
        </View>

        {/* Content */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.06)",
            padding: 16,
          }}
        >
          {loading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator />
              <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 10 }}>
                {pending ? message || "Waiting for Garmin…" : "Loading…"}
              </Text>
            </View>
          ) : err ? (
            <Text style={{ color: "#ffb4b4" }}>{err}</Text>
          ) : !data ? (
            <Text style={{ color: "rgba(255,255,255,0.7)" }}>
              {message || "No Garmin data for this day yet."}
            </Text>
          ) : (
            <>
              <Rows
                rows={[
                  ["Steps", data.steps],
                  ["Active kcal", data.activeKilocalories],
                  ["BMR kcal", data.bmrKilocalories],
                  ["Resting HR", data.restingHeartRateInBeatsPerMinute],
                  ["Avg HR", data.averageHeartRateInBeatsPerMinute],
                  ["Max HR", data.maxHeartRateInBeatsPerMinute],
                  ["Distance (m)", data.distanceInMeters],
                  ["Duration (s)", data.durationInSeconds],
                  ["Stress avg", data.averageStressLevel],
                  ["Body Battery +", data.bodyBatteryChargedValue],
                  ["Body Battery -", data.bodyBatteryDrainedValue],
                ]}
              />

              <Text
                style={{
                  marginTop: 18,
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 12,
                }}
              >
                Raw (debug)
              </Text>
              <Text
                style={{
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                {JSON.stringify(data, null, 2)}
              </Text>
            </>
          )}
        </View>

        <View style={{ marginTop: 10, alignItems: "center" }}>
          <Text style={{ color: connected ? "#8CE99A" : "#FFB4B4", fontWeight: "700" }}>
            {connected ? "Connected" : "Not connected"}
          </Text>
          {!!debug?.garminUserId && (
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 4 }}>
              Garmin User: {String(debug.garminUserId).slice(0, 8)}…
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Rows({ rows }) {
  return (
    <View style={{ gap: 12 }}>
      {rows.map(([k, v]) => (
        <View
          key={k}
          style={{ flexDirection: "row", justifyContent: "space-between" }}
        >
          <Text style={{ color: "rgba(255,255,255,0.7)" }}>{k}</Text>
          <Text style={{ color: "#fff", fontWeight: "600" }}>{v ?? "-"}</Text>
        </View>
      ))}
    </View>
  );
}
