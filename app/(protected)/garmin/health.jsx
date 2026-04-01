"use client";

import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { db } from "../../../firebaseConfig"; // ✅ adjust ONLY if your other pages use a different path
import { useAuth } from "../../../providers/AuthProvider"; // ✅ adjust ONLY if your other pages use a different path

export default function GarminHealthPage() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!uid) return;

    setErr("");
    setLoading(true);

    const q = query(
      collection(db, "users", uid, "garmin_health"),
      orderBy("fetchedAtMs", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (e) => {
        console.error("garmin_health snapshot error:", e);
        setErr(String(e?.message || e));
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000", padding: 16 }}>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 6 }}>
        Garmin Health
      </Text>

      {/* tiny debug line so we know what's happening */}
      <Text style={{ color: "rgba(255,255,255,0.7)", marginBottom: 12 }}>
        uid: {uid ? uid.slice(0, 8) + "…" : "none"} · count: {docs.length} {err ? `· error: ${err}` : ""}
      </Text>

      {loading ? (
        <ActivityIndicator />
      ) : docs.length === 0 ? (
        <Text style={{ color: "#fff" }}>No health payloads yet.</Text>
      ) : (
        <ScrollView>
          {docs.map((d) => {
            const isOpen = openId === d.id;
            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => setOpenId(isOpen ? null : d.id)}
                style={{
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.15)",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  padding: 12,
                  borderRadius: 14,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>
                  {d.kind || d.id}
                </Text>

                <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 6 }}>
                  date: {d.date || "—"} · fetchedAtMs: {d.fetchedAtMs || "—"}
                </Text>

                {isOpen ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: "#fff", fontWeight: "800", marginBottom: 6 }}>
                      Payload
                    </Text>
                    <Text style={{ color: "rgba(255,255,255,0.9)", fontFamily: "Menlo", fontSize: 12 }}>
                      {JSON.stringify(d.payload ?? d, null, 2)}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
