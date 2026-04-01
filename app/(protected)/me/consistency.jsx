// app/(protected)/me/consistency.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

// Firestore (nutrition days)
import { Timestamp, collection, getDocs, orderBy, query, where } from "firebase/firestore";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ✅ LOCAL date key (avoids UTC shifting from toISOString())
function isoKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// ✅ Parse YYYY-MM-DD as LOCAL date (not UTC)
function parseLocalKey(key) {
  const s = String(key || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(key); // fallback
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function formatWeekLabel(weekStart) {
  const s = new Date(weekStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `Wk of ${s}`;
}

function formatDayLabel(key) {
  const d = parseLocalKey(key);
  if (Number.isNaN(d.getTime())) return key || "";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" });
}

function sameDayKey(a, b) {
  return isoKey(a) === isoKey(b);
}

/* ─────────────────────────────────────────────
   Consistency Page
   - Training: from Strava (token in AsyncStorage: strava_access_token)
   - Nutrition: from Firestore users/{uid}/meals (date Timestamp)
   - Heatmap: last 12 weeks (84 days)
───────────────────────────────────────────── */
export default function ConsistencyPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();

  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [hasStrava, setHasStrava] = useState(false);
  const [stravaActs, setStravaActs] = useState([]); // mapped minimal

  const [meals, setMeals] = useState([]); // minimal: { id, dayKey }
  const [error, setError] = useState("");

  // mode filter
  const [mode, setMode] = useState("Both"); // Both | Training | Nutrition

  // drilldown modal
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // ✅ stabilise the range (updates on refresh)
  const [rangeKey, setRangeKey] = useState(() => isoKey(new Date()));

  const s = makeStyles(colors, isDark, accent);

  const horizonDays = 84; // 12 weeks

  const range = useMemo(() => {
    const end = startOfDay(parseLocalKey(rangeKey)); // stable “today” for this render cycle
    const start = startOfDay(addDays(end, -(horizonDays - 1)));
    return { start, end };
  }, [rangeKey, horizonDays]);

  const dayKeys = useMemo(() => {
    return Array.from({ length: horizonDays }).map((_, i) => isoKey(addDays(range.start, i)));
  }, [range.start, horizonDays]);

  /* ─────────────────────────────────────────────
     Load Strava activities (last 84 days)
  ────────────────────────────────────────────── */
  const loadStrava = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasStrava(false);
        setStravaActs([]);
        return;
      }

      setHasStrava(true);

      const after = Math.floor(range.start.getTime() / 1000);
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava consistency load error", resp.status, text);
        setError("Couldn’t load Strava. Try reconnecting in Settings.");
        setStravaActs([]);
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const mapped = safe
        .map((a) => {
          const when = a.start_date_local || a.start_date;
          const d = when ? new Date(when) : null;
          const k = d && !Number.isNaN(d.getTime()) ? isoKey(d) : "";
          return {
            id: String(a.id),
            title: a.name || a.type || "Session",
            type: a.type || "Workout",
            when,
            dayKey: k,
            minutes: Math.round((Number(a.moving_time || 0) || 0) / 60),
            distanceKm: (Number(a.distance || 0) || 0) / 1000,
          };
        })
        .filter((a) => a.dayKey);

      mapped.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      setStravaActs(mapped);
    } catch (e) {
      console.warn("Strava consistency error", e);
      setError("Couldn’t load Strava. Try again.");
      setStravaActs([]);
    }
  }, [range.start]);

  /* ─────────────────────────────────────────────
     Load meals for horizon (Firestore)
  ────────────────────────────────────────────── */
  const loadMeals = useCallback(async () => {
    try {
      if (!user?.uid) {
        setMeals([]);
        return;
      }

      const mealsRef = collection(db, "users", user.uid, "meals");

      const qMeals = query(
        mealsRef,
        where("date", ">=", Timestamp.fromDate(range.start)),
        where("date", "<=", Timestamp.fromDate(addDays(range.end, 1))), // inclusive-ish
        orderBy("date", "desc")
      );

      const snap = await getDocs(qMeals);
      const rows = snap.docs
        .map((d) => {
          const data = d.data() || {};
          const dt = data.date?.toDate?.() || (data.date ? new Date(data.date) : null);
          const k = dt && !Number.isNaN(dt.getTime()) ? isoKey(dt) : "";
          return { id: d.id, dayKey: k };
        })
        .filter((r) => r.dayKey);

      setMeals(rows);
    } catch (e) {
      console.warn("Meals consistency error", e);
      setMeals([]);
    }
  }, [user?.uid, range.start, range.end]);

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      await Promise.all([loadStrava(), loadMeals()]);
    } finally {
      setLoading(false);
    }
  }, [loadStrava, loadMeals]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRangeKey(isoKey(new Date())); // ✅ refresh range anchoring
    // loadAll will re-run via dependency change
    setRefreshing(false);
  }, []);

  /* ─────────────────────────────────────────────
     Aggregate by day
  ────────────────────────────────────────────── */
  const trainingByDay = useMemo(() => {
    const by = {};
    stravaActs.forEach((a) => {
      if (!a.dayKey) return;
      if (!by[a.dayKey]) by[a.dayKey] = { count: 0, minutes: 0, items: [] };
      by[a.dayKey].count += 1;
      by[a.dayKey].minutes += Number(a.minutes || 0) || 0;
      by[a.dayKey].items.push(a);
    });
    return by;
  }, [stravaActs]);

  const mealsByDay = useMemo(() => {
    const by = {};
    meals.forEach((m) => {
      if (!m.dayKey) return;
      if (!by[m.dayKey]) by[m.dayKey] = { count: 0 };
      by[m.dayKey].count += 1;
    });
    return by;
  }, [meals]);

  const daySeries = useMemo(() => {
    return dayKeys.map((k) => {
      const t = trainingByDay[k]?.count || 0;
      const m = mealsByDay[k]?.count || 0;

      const hasTraining = t > 0;
      const hasMeals = m > 0;

      let score = 0; // 0..3
      if (mode === "Training") {
        score = hasTraining ? clamp(t, 1, 3) : 0;
      } else if (mode === "Nutrition") {
        score = hasMeals ? clamp(m >= 3 ? 3 : m, 1, 3) : 0;
      } else {
        if (hasTraining || hasMeals) score = 1;
        if (hasTraining && hasMeals) score = 2;
        if (hasTraining && hasMeals && (m >= 3 || t >= 2)) score = 3;
      }

      return {
        dayKey: k,
        trainingCount: t,
        trainingMinutes: trainingByDay[k]?.minutes || 0,
        mealCount: m,
        score,
      };
    });
  }, [dayKeys, trainingByDay, mealsByDay, mode]);

  /* ─────────────────────────────────────────────
     Streaks + headline stats
  ────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const nowKey = isoKey(new Date());

    const hit = (d) => {
      if (mode === "Training") return d.trainingCount > 0;
      if (mode === "Nutrition") return d.mealCount > 0;
      return d.trainingCount > 0 || d.mealCount > 0;
    };

    const hits = daySeries.map((d) => (hit(d) ? 1 : 0));
    const totalHits = hits.reduce((a, b) => a + b, 0);
    const pct = (totalHits / Math.max(1, hits.length)) * 100;

    // current streak (ending today OR yesterday if today not logged yet)
    const todayIdx = daySeries.findIndex((d) => d.dayKey === nowKey);
    const startIdx = todayIdx >= 0 ? todayIdx : daySeries.length - 1;

    let cur = 0;
    for (let i = startIdx; i >= 0; i--) {
      if (hits[i] === 1) cur += 1;
      else break;
    }
    if (cur === 0 && startIdx - 1 >= 0) {
      let cur2 = 0;
      for (let i = startIdx - 1; i >= 0; i--) {
        if (hits[i] === 1) cur2 += 1;
        else break;
      }
      cur = cur2;
    }

    // best streak
    let best = 0;
    let run = 0;
    for (let i = 0; i < hits.length; i++) {
      if (hits[i] === 1) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }

    const last7 = hits.slice(-7).reduce((a, b) => a + b, 0);
    const last30 = hits.slice(-30).reduce((a, b) => a + b, 0);

    const totalSessions = daySeries.reduce((a, d) => a + d.trainingCount, 0);
    const totalMealDays = daySeries.reduce((a, d) => a + (d.mealCount > 0 ? 1 : 0), 0);

    return {
      pct,
      totalHits,
      currentStreak: cur,
      bestStreak: best,
      last7,
      last30,
      totalSessions,
      totalMealDays,
    };
  }, [daySeries, mode]);

  const weeks = useMemo(() => {
    // rolling heatmap grouped into 12 columns of 7
    const out = [];
    for (let i = 0; i < daySeries.length; i += 7) {
      const slice = daySeries.slice(i, i + 7);
      const wkStart = slice[0]?.dayKey ? parseLocalKey(slice[0].dayKey) : new Date();
      out.push({
        key: `${slice[0]?.dayKey || i}`,
        label: formatWeekLabel(wkStart),
        days: slice,
      });
    }
    return out;
  }, [daySeries]);

  const selectedDay = useMemo(() => {
    if (!selectedDayKey) return null;
    return daySeries.find((d) => d.dayKey === selectedDayKey) || null;
  }, [daySeries, selectedDayKey]);

  const selectedTrainingItems = useMemo(() => {
    if (!selectedDayKey) return [];
    return trainingByDay[selectedDayKey]?.items || [];
  }, [trainingByDay, selectedDayKey]);

  /* ───────────────────────────────────────────── */

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={onRefresh} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="refresh-cw" size={18} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="settings" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>CONSISTENCY</Text>
                  <Text style={s.heroName}>Keep the chain alive</Text>
                  <Text style={s.heroSub}>Last 12 weeks · {mode === "Both" ? "Training + Nutrition" : mode}</Text>
                </View>
              </View>

              {/* MODE TOGGLE */}
              <View style={s.modeRow}>
                {["Both", "Training", "Nutrition"].map((m) => {
                  const active = mode === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      activeOpacity={0.9}
                      onPress={() => setMode(m)}
                      style={[s.modePill, active && { backgroundColor: accent, borderColor: accent }]}
                    >
                      <Text
                        style={[
                          s.modeText,
                          active && { color: colors.sapOnPrimary || "#0B0B0B", fontWeight: "900" },
                        ]}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* HEADLINE STATS */}
              <View style={s.kpiRow}>
                <Kpi label="Current streak" value={`${stats.currentStreak}d`} colors={colors} isDark={isDark} />
                <Kpi label="Best streak" value={`${stats.bestStreak}d`} colors={colors} isDark={isDark} />
                <Kpi label="Hit rate" value={fmtPct(stats.pct)} colors={colors} isDark={isDark} />
              </View>

              {error ? <Text style={s.error}>{error}</Text> : null}
              {!hasStrava && mode !== "Nutrition" ? (
                <Text style={s.hint}>
                  Training consistency uses Strava. Connect Strava in Settings to fill the training heatmap.
                </Text>
              ) : null}
            </View>
          </LinearGradient>

          {/* HEATMAP */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="activity" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Heatmap</Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <LegendDot level={0} colors={colors} isDark={isDark} accent={accent} />
                <LegendDot level={1} colors={colors} isDark={isDark} accent={accent} />
                <LegendDot level={2} colors={colors} isDark={isDark} accent={accent} />
                <LegendDot level={3} colors={colors} isDark={isDark} accent={accent} />
              </View>
            </View>

            {loading ? (
              <View style={{ paddingVertical: 18 }}>
                <ActivityIndicator />
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : (
              <View style={s.heatWrap}>
                {weeks.map((w, wi) => (
                  <View key={w.key} style={s.weekCol}>
                    <Text style={s.weekLabel} numberOfLines={1}>
                      {wi % 2 === 0 ? w.label : " "}
                    </Text>

                    {w.days.map((d) => {
                      const isToday = d.dayKey === isoKey(new Date());
                      return (
                        <TouchableOpacity
                          key={d.dayKey}
                          activeOpacity={0.9}
                          onPress={() => {
                            setSelectedDayKey(d.dayKey);
                            setDayOpen(true);
                          }}
                          style={[
                            s.dayDot,
                            {
                              backgroundColor: dotColor(d.score, isDark, colors, accent),
                              borderColor: isToday ? accent : "transparent",
                              borderWidth: isToday ? 2 : 0,
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            )}

            <Text style={s.hint}>Tap a square to see what you did that day. Stronger colour = stronger day.</Text>
          </View>

          {/* SUMMARY CARDS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="trending-up" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Summary</Text>
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Last 7 days</Text>
              <Text style={s.cardBig}>
                {stats.last7} / 7 <Text style={s.cardUnit}>days hit</Text>
              </Text>
              <Text style={s.cardSub}>
                {mode === "Training"
                  ? "A hit = at least 1 Strava session"
                  : mode === "Nutrition"
                  ? "A hit = at least 1 meal logged"
                  : "A hit = training OR meals logged"}
              </Text>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Last 30 days</Text>
              <Text style={s.cardBig}>
                {stats.last30} / 30 <Text style={s.cardUnit}>days hit</Text>
              </Text>

              {mode !== "Nutrition" ? <Text style={s.cardSub}>Total sessions: {stats.totalSessions}</Text> : null}
              {mode !== "Training" ? <Text style={s.cardSub}>Days with meals: {stats.totalMealDays}</Text> : null}
            </View>
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* DAY DETAIL SHEET */}
        <DayDetailSheet
          open={dayOpen}
          onClose={() => setDayOpen(false)}
          colors={colors}
          isDark={isDark}
          accent={accent}
          mode={mode}
          dayKey={selectedDayKey}
          day={selectedDay}
          trainingItems={selectedTrainingItems}
          onGoToNutrition={() => {
            if (!selectedDayKey) return;
            const d = parseLocalKey(selectedDayKey);
            router.push({ pathname: "/nutrition", params: { date: d.toISOString() } });
            setDayOpen(false);
          }}
          onGoToActivity={(id) => {
            if (!id) return;
            router.push(`/me/activity/${id}`);
            setDayOpen(false);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   UI bits
───────────────────────────────────────────── */
function Kpi({ label, value, colors, isDark }) {
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? "#111217" : "#F3F4F6", borderRadius: 18, padding: 12 }}>
      <Text style={{ color: colors.subtext, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 }}>{value}</Text>
    </View>
  );
}

function LegendDot({ level, colors, isDark, accent }) {
  return (
    <View
      style={{
        width: 12,
        height: 12,
        borderRadius: 4,
        backgroundColor: dotColor(level, isDark, colors, accent),
      }}
    />
  );
}

function dotColor(score, isDark, colors, accent) {
  if (!score) return isDark ? "#1B1C22" : "#E6E7EC";
  if (score === 1) return isDark ? accent + "66" : accent + "55";
  if (score === 2) return isDark ? accent + "AA" : accent + "88";
  return accent; // 3
}

/* ─────────────────────────────────────────────
   Day Detail Sheet
───────────────────────────────────────────── */
function DayDetailSheet({
  open,
  onClose,
  colors,
  isDark,
  accent,
  mode,
  dayKey,
  day,
  trainingItems,
  onGoToNutrition,
  onGoToActivity,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const title = useMemo(() => formatDayLabel(dayKey || ""), [dayKey]);

  const trainingCount = day?.trainingCount || 0;
  const trainingMin = day?.trainingMinutes || 0;
  const mealCount = day?.mealCount || 0;

  const showTraining = mode !== "Nutrition";
  const showNutrition = mode !== "Training";

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>{mode === "Both" ? "Training + Nutrition" : mode}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            {showTraining ? <Pill label="Sessions" value={`${trainingCount}`} colors={colors} isDark={isDark} /> : null}
            {showTraining ? <Pill label="Minutes" value={`${trainingMin}`} colors={colors} isDark={isDark} /> : null}
            {showNutrition ? <Pill label="Meals" value={`${mealCount}`} colors={colors} isDark={isDark} /> : null}
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {/* TRAINING LIST */}
          {showTraining ? (
            <View style={{ marginTop: 8 }}>
              <Text style={sheetStyles.sectionLabel(colors)}>Training</Text>

              {trainingItems?.length ? (
                trainingItems.slice(0, 12).map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    activeOpacity={0.9}
                    onPress={() => onGoToActivity?.(a.id)}
                    style={[sheetStyles.row(isDark), { borderColor: isDark ? "#1F2128" : "#E1E3E8" }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={sheetStyles.rowTitle(colors)} numberOfLines={1}>
                        {a.title}
                      </Text>
                      <Text style={sheetStyles.rowSub(colors)} numberOfLines={1}>
                        {a.type} · {Math.max(0, Number(a.minutes || 0))} min
                        {Number(a.distanceKm || 0) > 0 ? ` · ${a.distanceKm.toFixed(2)} km` : ""}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.subtext} />
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No Strava sessions on this day.</Text>
              )}
            </View>
          ) : null}

          {/* NUTRITION CTA */}
          {showNutrition ? (
            <View style={{ marginTop: 18 }}>
              <Text style={sheetStyles.sectionLabel(colors)}>Nutrition</Text>

              <View style={[sheetStyles.box(isDark), { borderColor: isDark ? "#1F2128" : "#E1E3E8" }]}>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 14 }}>Meals logged: {mealCount}</Text>
                <Text style={{ marginTop: 6, color: colors.subtext, fontWeight: "700", lineHeight: 18 }}>
                  Tap below to jump to Nutrition for this date.
                </Text>

                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={onGoToNutrition}
                  style={[stylesGlobal.ctaSmall, { backgroundColor: accent, marginTop: 12 }]}
                >
                  <Feather name="external-link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={[stylesGlobal.ctaSmallText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Open Nutrition</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Pill({ label, value, colors, isDark }) {
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? "#111217" : "#F3F4F6", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 12 }}>
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const sheetStyles = {
  sectionLabel: (colors) => ({
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  }),
  row: (isDark) => ({
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: isDark ? "#111217" : "#F3F4F6",
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  }),
  rowTitle: (colors) => ({ color: colors.text, fontWeight: "900", fontSize: 14 }),
  rowSub: (colors) => ({ marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 }),
  box: (isDark) => ({
    borderRadius: 18,
    padding: 14,
    backgroundColor: isDark ? "#111217" : "#F3F4F6",
    borderWidth: StyleSheet.hairlineWidth,
  }),
};

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    modeRow: { flexDirection: "row", gap: 8, marginTop: 14 },
    modePill: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : "#E1E3E8",
    },
    modeText: {
      color: colors.text,
      fontWeight: "800",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    kpiRow: { flexDirection: "row", gap: 10, marginTop: 14 },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },

    heatWrap: {
      marginTop: 12,
      flexDirection: "row",
      gap: 8,
      padding: 12,
      borderRadius: 18,
      backgroundColor: isDark ? "#111217" : (colors.sapSilverLight || "#F3F4F6"),
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    weekCol: { alignItems: "center", gap: 6 },
    weekLabel: { color: colors.subtext, fontSize: 10, fontWeight: "900", width: 54, textAlign: "center" },
    dayDot: { width: 14, height: 14, borderRadius: 4 },

    card: {
      marginTop: 12,
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "#111217" : (colors.sapSilverLight || "#F3F4F6"),
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : "#E1E3E8",
    },
    cardTitle: { color: colors.subtext, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 },
    cardBig: { marginTop: 8, color: colors.text, fontSize: 22, fontWeight: "900" },
    cardUnit: { fontSize: 12, color: colors.subtext, fontWeight: "900" },
    cardSub: { marginTop: 6, color: colors.subtext, fontSize: 13, fontWeight: "700", lineHeight: 18 },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13, fontWeight: "800" },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  ctaSmall: {
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaSmallText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});
