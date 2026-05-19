import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import { API_URL } from "../config/api";
import { auth } from "../firebaseConfig";
import { refreshTrainingWidgetSnapshotForUser } from "../src/widgets/trainingWidgetSnapshot";

function isNonFatalInitialSyncResponse(res, data) {
  const message = String(
    data?.error || data?.message || data?.details?.errorMessage || ""
  );
  return (
    data?.ok === true ||
    data?.duplicate === true ||
    res.status === 409 ||
    (res.status === 429 && /just requested|rate limit|wait/i.test(message))
  );
}

async function triggerGarminInitialSync() {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error("No authenticated user");
  if (!API_URL) throw new Error("API is not configured for this build.");

  const idToken = await user.getIdToken();
  const res = await fetch(`${API_URL}/garmin/activities/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason: "initial_garmin_connection",
      days: 90,
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.ok !== true) {
    if (isNonFatalInitialSyncResponse(res, data)) {
      console.log("Garmin initial sync already pending", data);
      return { ...data, ok: true, alreadyPending: true };
    }

    console.log("Garmin initial sync failed", data);
    throw new Error(data?.error || "Garmin initial sync failed");
  }

  return data;
}

export default function GarminLinked() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState("Finishing Garmin connection...");
  const [error, setError] = useState("");

  const success = useMemo(() => String(params?.success || "") === "1", [params]);

  useEffect(() => {
    let active = true;

    async function finish() {
      try {
        if (!success) {
          const reason = String(params?.reason || params?.error || "connection_failed");
          throw new Error(`Could not connect Garmin (${reason}).`);
        }

        await AsyncStorage.setItem("garmin_connected", "1");
        try {
          if (active) setStatus("Garmin connected. Importing recent activities...");
          await triggerGarminInitialSync();
          await refreshTrainingWidgetSnapshotForUser({
            userId: auth.currentUser?.uid || null,
            reason: "garmin_import",
          });
        } catch (syncError) {
          console.log("Garmin initial sync after link failed", syncError);
        }

        if (!active) return;
        setStatus("Garmin connected.");
        setTimeout(() => router.replace("/(protected)/settings"), 500);
      } catch (e) {
        if (!active) return;
        setError(e?.message || "Something went wrong connecting Garmin.");
        setStatus("Garmin connection failed.");
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
