"use client";

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */

function toDateSafe(v) {
  try {
    if (!v) return null;
    if (v?.toDate && typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtShortDate(d) {
  try {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function safeType(item) {
  const t = String(item?.type || item?.activityType || item?.sport || "").toLowerCase();
  if (t.includes("run")) return "run";
  if (t.includes("strength") || t.includes("gym") || t.includes("lift")) return "strength";
  if (t.includes("hyrox")) return "hyrox";
  return t || "session";
}

function getDistanceKm(item) {
  const v =
    item?.distanceKm ??
    item?.distance_km ??
    item?.distance ??
    item?.summary?.distance ??
    0;

  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;

  // if it looks like metres, convert
  return n > 400 ? n / 1000 : n;
}

function getDurationMin(item) {
  const v =
    item?.durationMin ??
    item?.duration_min ??
    item?.durationMinutes ??
    item?.duration ??
    item?.summary?.durationMin ??
    0;

  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return n > 10000 ? Math.round(n / 60) : Math.round(n); // seconds safeguard
}

function titleFor(item) {
  return item?.title || item?.name || item?.displayName || (safeType(item) === "run" ? "Run" : "Session");
}

/* ---------------- ranges ---------------- */

const RANGES = [
  { key: "7d", label: "7D", days: 7 },
  { key: "28d", label: "28D", days: 28 },
  { key: "12w", label: "12W", days: 84 },
];

export default function ProgressPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  // SAP GEL-ish tokens
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? "#111111";
  const cardBg = colors?.card ?? (isDark ? "#111217" : "#F3F4F6");

  const s = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, cardBg),
    [colors, isDark, accentBg, accentText, cardBg]
  );

  const uid = auth.currentUser?.uid || null;

  const [range, setRange] = useState("28d");
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState([]);
  const [recent, setRecent] = useState([]);

  const days = useMemo(() => RANGES.find((r) => r.key === range)?.days || 28, [range]);

  const timeMin = useMemo(() => {
    const now = new Date();
    const start = startOfDay(addDays(now, -(days - 1)));
    return start;
  }, [days]);

  const load = useCallback(async () => {
    if (!uid) return;

    setLoading(true);

    try {
      const ref = collection(db, "activities");

      // Primary query: uid
      let snap;
      try {
        const qy = query(
          ref,
          where("uid", "==", uid),
          where("createdAt", ">=", timeMin),
          orderBy("createdAt", "desc"),
          limit(400)
        );
        snap = await getDocs(qy);
      } catch {
        // Fallback schema: userId
        const qy2 = query(
          ref,
          where("userId", "==", uid),
          where("createdAt", ">=", timeMin),
          orderBy("createdAt", "desc"),
          limit(400)
        );
        snap = await getDocs(qy2);
      }

      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRows(items);

      // Recent list (last 12)
      setRecent(items.slice(0, 12));
    } catch (e) {
      console.log("[progress] load error", e);
      setRows([]);
      setRecent([]);
    } finally {
      setLoading(false);
    }
  }, [uid, timeMin]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------------- aggregates ---------------- */

  const daily = useMemo(() => {
    // build day buckets from timeMin to today (inclusive)
    const start = timeMin;
    const end = startOfDay(new Date());
    const daysCount = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;

    const map = new Map();
    for (let i = 0; i < daysCount; i++) {
      const d = startOfDay(addDays(start, i));
      map.set(d.getTime(), {
        date: d,
        runKm: 0,
        strength: 0,
        total: 0,
      });
    }

    for (const r of rows) {
      const d0 = startOfDay(toDateSafe(r?.createdAt) || toDateSafe(r?.startTime) || new Date());
      const key = d0.getTime();
      const bucket = map.get(key);
      if (!bucket) continue;

      bucket.total += 1;

      const t = safeType(r);
      if (t === "run") bucket.runKm += getDistanceKm(r);
      if (t === "strength" || t === "gym") bucket.strength += 1;
    }

    return Array.from(map.values());
  }, [rows, timeMin]);

  const totals = useMemo(() => {
    let runKm = 0;
    let strength = 0;
    let total = 0;
    const activeDays = new Set();

    for (const d of daily) {
      runKm += d.runKm;
      strength += d.strength;
      total += d.total;
      if (d.total > 0) activeDays.add(d.date.getTime());
    }

    return {
      runKm,
      strength,
      total,
      activeDays: activeDays.size,
    };
  }, [daily]);

  const maxRunKm = useMemo(() => {
    let m = 0;
    for (const d of daily) m = Math.max(m, d.runKm);
    return m || 1;
  }, [daily]);

  /* ---------------- render ---------------- */

  if (!uid) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.center}>
          <Text style={s.h1}>Not signed in</Text>
          <Text style={s.subtext}>Please log in to view your progress.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace("/(auth)/login")}>
            <Text style={s.primaryBtnTextDark}>Go to login</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>Progress</Text>
          <Text style={s.subtitle}>Performance over time</Text>
        </View>

        <TouchableOpacity onPress={load} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="refresh-cw" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Range selector */}
      <View style={s.rangeRow}>
        {RANGES.map((r) => {
          const active = r.key === range;
          return (
            <TouchableOpacity
              key={r.key}
              onPress={() => setRange(r.key)}
              style={[s.rangePill, active && s.rangePillActive]}
              activeOpacity={0.85}
            >
              <Text style={[s.rangeText, active && s.rangeTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.loadingText}>Loading your stats…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {/* KPI cards */}
          <View style={s.kpiGrid}>
            <KPI
              label="Run distance"
              value={`${totals.runKm.toFixed(totals.runKm >= 100 ? 0 : 1)} km`}
              icon="map"
              s={s}
            />
            <KPI label="Strength sessions" value={`${totals.strength}`} icon="zap" s={s} />
            <KPI label="Total sessions" value={`${totals.total}`} icon="activity" s={s} />
            <KPI label="Active days" value={`${totals.activeDays}`} icon="calendar" s={s} />
          </View>

          {/* Trend */}
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>Run trend</Text>
              <Text style={s.cardSub}>{range === "12" ? "Last 12 weeks" : `Last ${days} days`}</Text>
            </View>

            <View style={s.chartWrap}>
              {daily.map((d, idx) => {
                const h = Math.max(2, Math.round((d.runKm / maxRunKm) * 60));
                const has = d.runKm > 0;
                return (
                  <View key={String(d.date.getTime())} style={s.barCol}>
                    <View
                      style={[
                        s.bar,
                        {
                          height: h,
                          opacity: has ? 1 : 0.25,
                        },
                      ]}
                    />
                    {/* sparse labels */}
                    {(idx === 0 || idx === daily.length - 1 || idx % 7 === 0) ? (
                      <Text style={s.barLabel}>{fmtShortDate(d.date)}</Text>
                    ) : (
                      <Text style={s.barLabelMuted}> </Text>
                    )}
                  </View>
                );
              })}
            </View>

            <Text style={s.chartHint}>
              Tip: log runs with distance (km) to make this chart more accurate.
            </Text>
          </View>

          {/* Recent */}
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>Recent sessions</Text>
              <TouchableOpacity onPress={() => router.push("/activity-feed")} activeOpacity={0.85}>
                <Text style={s.linkText}>View all</Text>
              </TouchableOpacity>
            </View>

            {recent.length ? (
              <View style={{ marginTop: 4 }}>
                {recent.map((it) => (
                  <RecentRow
                    key={it.id}
                    item={it}
                    colors={colors}
                    isDark={isDark}
                    onPress={() => router.push(`/activity/${it.id}`)}
                    accentBg={accentBg}
                    accentText={accentText}
                  />
                ))}
              </View>
            ) : (
              <Text style={s.emptyText}>No sessions yet — log your first run or gym session.</Text>
            )}
          </View>

          {/* CTA */}
          <View style={s.ctaRow}>
            <Pressable
              style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.92 }]}
              onPress={() => router.push("/train")}
            >
              <Feather name="plus" size={16} color={accentText} />
              <Text style={s.primaryBtnTextDark}>Log a session</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.95 }]}
              onPress={() => router.push("/me")}
            >
              <Feather name="user" size={16} color={colors.text} />
              <Text style={s.secondaryBtnText}>Back to Me</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------------- components ---------------- */

function KPI({ label, value, icon, s }) {
  return (
    <View style={s.kpiCard}>
      <View style={s.kpiIcon}>
        <Feather name={icon} size={16} color={s._accentText} />
      </View>
      <Text style={s.kpiValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const RecentRow = memo(function RecentRow({
  item,
  onPress,
  colors,
  isDark,
  accentBg,
  accentText,
}) {
  const t = safeType(item);
  const title = titleFor(item);
  const meta = (() => {
    const when = toDateSafe(item?.createdAt) || toDateSafe(item?.startTime);
    const d = when
      ? when.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
      : "";
    const parts = [];
    if (d) parts.push(d);

    if (t === "run") {
      const km = getDistanceKm(item);
      if (km) parts.push(`${km.toFixed(km >= 100 ? 0 : 1)} km`);
    }

    const mins = getDurationMin(item);
    if (mins) parts.push(`${mins} min`);

    return parts.join(" • ");
  })();

  const badge = t === "run" ? "Run" : t === "strength" ? "Strength" : t === "hyrox" ? "Hyrox" : "Session";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View
        style={{
          backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>{badge}</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "800" }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: colors.subtext, marginTop: 2, fontSize: 12 }} numberOfLines={1}>
          {meta || " "}
        </Text>
      </View>

      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: accentBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="chevron-right" size={18} color={accentText} />
      </View>
    </TouchableOpacity>
  );
});

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark, accentBg, accentText, cardBg) {
  return StyleSheet.create({
    _accentText: accentText, // used by KPI component

    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: isDark ? "#101114" : cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontSize: 30,
      fontWeight: "900",
      color: colors.text,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 13,
      color: colors.subtext,
    },

    rangeRow: {
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 4,
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
    },
    rangePill: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
    },
    rangePillActive: {
      backgroundColor: accentBg,
      borderColor: accentBg,
    },
    rangeText: {
      color: colors.text,
      fontWeight: "800",
      fontSize: 12,
      letterSpacing: 0.3,
    },
    rangeTextActive: {
      color: accentText,
    },

    content: {
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 90,
      gap: 14,
    },

    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 24 },
    h1: { fontSize: 18, fontWeight: "900", color: colors.text },
    subtext: { marginTop: 6, color: colors.subtext },
    loadingText: { marginTop: 8, color: colors.subtext },

    kpiGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    kpiCard: {
      width: "48%",
      backgroundColor: isDark ? "#111217" : cardBg,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 12,
    },
    kpiIcon: {
      width: 34,
      height: 34,
      borderRadius: 14,
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    kpiValue: { color: colors.text, fontWeight: "900", fontSize: 18 },
    kpiLabel: { color: colors.subtext, marginTop: 4, fontWeight: "700", fontSize: 12 },

    card: {
      backgroundColor: isDark ? "#111217" : cardBg,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      paddingBottom: 10,
    },
    cardHead: {
      paddingHorizontal: 14,
      paddingTop: 14,
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: "900",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: colors.text,
    },
    cardSub: {
      fontSize: 12,
      color: colors.subtext,
      fontWeight: "700",
    },
    linkText: {
      fontSize: 12,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: colors.text,
      opacity: 0.8,
    },

    chartWrap: {
      marginTop: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 4,
      height: 96,
    },
    barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
    bar: {
      width: "100%",
      borderRadius: 8,
      backgroundColor: accentBg,
    },
    barLabel: {
      marginTop: 6,
      fontSize: 10,
      color: colors.subtext,
      textAlign: "center",
    },
    barLabelMuted: { marginTop: 6, fontSize: 10, color: "transparent" },
    chartHint: {
      paddingHorizontal: 14,
      paddingTop: 10,
      fontSize: 12,
      color: colors.subtext,
    },

    emptyText: { paddingHorizontal: 14, paddingTop: 12, color: colors.subtext },

    ctaRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 2,
    },
    primaryBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 999,
      paddingVertical: 12,
      backgroundColor: accentBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentBg,
    },
    primaryBtnTextDark: { color: accentText, fontWeight: "900", fontSize: 13, letterSpacing: 0.3 },

    secondaryBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 999,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    secondaryBtnText: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.3 },
  });
}
