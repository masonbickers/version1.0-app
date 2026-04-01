// app/dev/ping.jsx
import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { API_URL } from "../../config/api";
import { getJsonAuthHeaders } from "../../src/lib/api/authHeaders";


export default function DevPing() {
  const [msg, setMsg] = useState("Ready");

  const ping = async () => {
    try {
      const r = await fetch(`${API_URL}/health`);
      const t = await r.text();
      setMsg(`GET /health → ${r.status} ${t}`);
    } catch (e) {
      setMsg(`Ping failed: ${e?.message}`);
    }
  };

  const gen = async () => {
    try {
      const authHeaders = await getJsonAuthHeaders();
      const r = await fetch(`${API_URL}/generate-run?allowDefaults=1`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          athleteProfile: {
            goal: { distance: "10K", planLengthWeeks: 8 },
            availability: { sessionsPerWeek: 4, runDays: ["Tue", "Thu", "Sat", "Sun"], longRunDay: "Sun" },
            current: { weeklyKm: 30, longestRunKm: 12, experience: "Some experience" },
            difficulty: "Balanced",
          },
        }),
      });
      const t = await r.text();
      setMsg(`POST /generate-run → ${r.status} ${t.slice(0, 120)}…`);
    } catch (e) {
      setMsg(`AI call failed: ${e?.message}`);
    }
  };

  useEffect(() => { ping(); }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
      <Text style={{ fontWeight: "800", fontSize: 18 }}>Dev Ping</Text>
      <Text>API_URL: {API_URL}</Text>
      <Text>{msg}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity onPress={ping} style={{ padding: 10, borderWidth: 1, borderRadius: 8 }}>
          <Text>Ping</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={gen} style={{ padding: 10, borderWidth: 1, borderRadius: 8 }}>
          <Text>Generate</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
