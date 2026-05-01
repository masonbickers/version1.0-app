import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { API_URL } from "../config/api";
import { auth } from "../firebaseConfig";
import { syncStravaActivities } from "../src/lib/strava/syncStrava";

async function fetchStravaTokens(resultKey) {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("Please sign in again.");
  if (!API_URL) throw new Error("API is not configured for this build.");

  const idToken = await user.getIdToken();
  const resp = await fetch(`${API_URL}/strava/oauth-result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ resultKey }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json?.error || `OAuth result failed (${resp.status})`);
  return json || {};
}

export default function StravaLinked() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState("Finishing Strava connection...");
  const [error, setError] = useState("");

  const success = useMemo(() => String(params?.success || "") === "1", [params]);

  useEffect(() => {
    let active = true;

    async function finish() {
      try {
        if (!success) {
          const reason = String(params?.reason || params?.error || "connection_failed");
          throw new Error(`Could not connect Strava (${reason}).`);
        }

        let accessToken = params?.accessToken ? String(params.accessToken) : "";
        let refreshToken = params?.refreshToken ? String(params.refreshToken) : "";
        let expiresAt = params?.expiresAt ? String(params.expiresAt) : "";
        const resultKey = params?.resultKey ? String(params.resultKey) : "";

        if (!accessToken && resultKey) {
          const tokenResult = await fetchStravaTokens(resultKey);
          accessToken = tokenResult?.accessToken ? String(tokenResult.accessToken) : "";
          refreshToken = tokenResult?.refreshToken ? String(tokenResult.refreshToken) : "";
          expiresAt = tokenResult?.expiresAt != null ? String(tokenResult.expiresAt) : "";
        }

        if (!accessToken) {
          throw new Error("OAuth completed but no Strava access token was returned.");
        }

        const updates = [
          ["strava_connected", "1"],
          ["strava_access_token", accessToken],
        ];
        if (refreshToken) updates.push(["strava_refresh_token", refreshToken]);
        if (expiresAt) updates.push(["strava_expires_at", expiresAt]);
        await AsyncStorage.multiSet(updates);

        const uid = auth.currentUser?.uid;
        if (uid) {
          try {
            await syncStravaActivities(uid, accessToken);
          } catch {}
        }

        if (!active) return;
        setStatus("Strava connected.");
        setTimeout(() => router.replace("/(protected)/settings"), 500);
      } catch (e) {
        if (!active) return;
        setError(e?.message || "Something went wrong connecting Strava.");
        setStatus("Strava connection failed.");
      }
    }

    finish();
    return () => {
      active = false;
    };
  }, [params, router, success]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#000" }}>
      {!error ? <ActivityIndicator color="#E6FF3B" /> : null}
      <Text style={{ color: "#F5F5F5", fontSize: 18, fontWeight: "800", marginTop: 16, textAlign: "center" }}>
        {status}
      </Text>
      {!!error && (
        <>
          <Text style={{ color: "#A3A3A3", fontSize: 14, lineHeight: 20, marginTop: 10, textAlign: "center" }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => router.replace("/(protected)/settings")}
            style={{ marginTop: 18, borderRadius: 999, backgroundColor: "#E6FF3B", paddingHorizontal: 18, paddingVertical: 12 }}
          >
            <Text style={{ color: "#111", fontWeight: "900" }}>Back to Settings</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}
