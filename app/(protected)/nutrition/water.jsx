import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function asDate(v) {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function WaterPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const s = makeStyles(colors, isDark);

  const user = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const ref = collection(db, "users", user.uid, "waterLogs");
    const q = query(ref, orderBy("date", "desc"), limit(100));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  const todayTotalMl = useMemo(() => {
    const today = startOfDay(new Date());
    return logs.reduce((sum, row) => {
      const d = asDate(row.date);
      if (!d || !isSameDay(d, today)) return sum;
      return sum + Number(row.ml || 0);
    }, 0);
  }, [logs]);

  const todayLogs = useMemo(() => {
    const today = startOfDay(new Date());
    return logs
      .filter((row) => {
        const d = asDate(row.date);
        return d && isSameDay(d, today);
      })
      .slice(0, 12);
  }, [logs]);

  const addWater = async (ml) => {
    if (!user) {
      Alert.alert("Not signed in", "Please log in again.");
      return;
    }

    try {
      setSaving(true);
      await addDoc(collection(db, "users", user.uid, "waterLogs"), {
        ml: Number(ml),
        date: new Date(),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      Alert.alert("Couldn’t log water", err?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.8}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Hydration</Text>
        <TouchableOpacity onPress={() => router.push("/nutrition")} style={s.iconBtn} activeOpacity={0.8}>
          <Feather name="home" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.sapPrimary || colors.primary} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Today</Text>
            <Text style={s.cardValue}>{Math.round(todayTotalMl)} ml</Text>
            <Text style={s.cardSub}>Quick log water in one tap.</Text>

            <View style={s.row}>
              {[250, 500, 750].map((ml) => (
                <TouchableOpacity
                  key={ml}
                  style={[s.pill, saving && { opacity: 0.6 }]}
                  activeOpacity={0.85}
                  onPress={() => addWater(ml)}
                  disabled={saving}
                >
                  <Text style={s.pillText}>+{ml} ml</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.cardLabel}>Recent logs</Text>
            {!todayLogs.length ? (
              <Text style={s.empty}>No water logged yet today.</Text>
            ) : (
              todayLogs.map((row) => {
                const d = asDate(row.date);
                return (
                  <View key={row.id} style={s.logRow}>
                    <Text style={s.logText}>{Math.round(Number(row.ml || 0))} ml</Text>
                    <Text style={s.logSub}>
                      {d
                        ? d.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark) {
  const border = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: {
      height: 56,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: border,
    },
    iconBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { padding: 16, gap: 12, paddingBottom: 36 },
    card: {
      backgroundColor: isDark ? "#16181D" : "#FFFFFF",
      borderWidth: 1,
      borderColor: border,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    cardLabel: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    cardValue: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "800",
    },
    cardSub: {
      color: colors.subtext,
      fontSize: 13,
    },
    row: {
      marginTop: 4,
      flexDirection: "row",
      gap: 8,
    },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: colors.sapPrimary || "#E6FF3B",
    },
    pillText: {
      color: "#111111",
      fontWeight: "700",
      fontSize: 13,
    },
    empty: {
      color: colors.subtext,
      fontSize: 13,
    },
    logRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: border,
    },
    logText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    logSub: {
      color: colors.subtext,
      fontSize: 12,
    },
  });
}
