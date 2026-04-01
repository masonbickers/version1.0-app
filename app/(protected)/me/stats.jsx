// app/(protected)/me/stats.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
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
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { API_URL } from "../../../config/api";
import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

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
function isoKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function safeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("cycling") || x.includes("bike")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}
function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
}
function formatPace(pace) {
  if (!pace || !Number.isFinite(pace)) return "—";
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}
function startOfWeekMonday(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function weekRangeLabel(weekStart) {
  const s = new Date(weekStart);
  const e = addDays(s, 6);
  const a = s.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const b = e.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${a} – ${b}`;
}
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  const now = new Date();
  const diffDays = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000
  );
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}

/* ─────────────────────────────────────────────
   ✅ “SYNC” style caching (show data even if disconnected)
───────────────────────────────────────────── */
const CACHE_KEY = "strava_cached_activities_stats_window";
const CACHE_META = "strava_cached_activities_stats_window_synced_at";

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}
async function loadCachedWindow() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const at = await AsyncStorage.getItem(CACHE_META);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      activities: Array.isArray(parsed) ? parsed : [],
      syncedAt: at ? Number(at) : 0,
    };
  } catch {
    return { activities: [], syncedAt: 0 };
  }
}
async function writeCachedWindow(activities) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(Array.isArray(activities) ? activities : []));
    await AsyncStorage.setItem(CACHE_META, String(Date.now()));
  } catch {
    // ignore
  }
}
async function tryServerSyncWindow({ days, rangeKey }) {
  if (!API_URL) return { ok: false, reason: "no_api_url" };
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: "no_user" };

  const idToken = await user.getIdToken().catch(() => "");
  if (!idToken) return { ok: false, reason: "no_id_token" };

  const resp = await fetch(`${API_URL}/strava/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      scope: "activities_window",
      rangeKey, // "12w" | "26w" | "52w"
      days,
      perPage: 200,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: `http_${resp.status}`, detail: t };
  }

  const payload = await safeJson(resp);
  const arr =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.activities) && payload.activities) ||
    (Array.isArray(payload?.data?.activities) && payload.data.activities) ||
    [];

  return { ok: true, activities: arr, payload };
}
async function fetchStravaWindow(token, afterUnixSec) {
  const resp = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${afterUnixSec}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Strava error ${resp.status}: ${text}`);
  }

  const raw = await resp.json();
  return Array.isArray(raw) ? raw : [];
}

/* ============================================================================
   Stats — week trend + rolling windows (Strava-based)
   ✅ Shows cached data if Strava disconnected
============================================================================ */
export default function StatsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");

  const [acts, setActs] = useState([]); // mapped
  const [metric, setMetric] = useState("time_min"); // time_min | run_km | count | strength_min
  const [range, setRange] = useState("12w"); // 12w | 26w | 52w

  // modal
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // weekStart iso

  // sync meta
  const [syncedAt, setSyncedAt] = useState(0);

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const mapActivities = useCallback((safe) => {
    const mapped = (Array.isArray(safe) ? safe : []).map((a) => {
      const distanceKm = (a.distance || 0) / 1000;
      const when = a.start_date_local || a.start_date;
      const type = normaliseType(a.type || "Workout");
      const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

      return {
        id: String(a.id),
        title: a.name || a.type || "Workout",
        type,
        when,
        distanceKm,
        movingTimeMin: Math.round((a.moving_time || 0) / 60),
        movingTimeSec: Number(a.moving_time || 0),
        paceMinPerKm: pace,
        elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
      };
    });

    mapped.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    return mapped;
  }, []);

  const daysForRange = useMemo(() => {
    return range === "12w" ? 84 : range === "26w" ? 182 : 365;
  }, [range]);

  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // ✅ always hydrate from cache first
      const cached = await loadCachedWindow();
      if (cached.activities?.length) {
        setActs(mapActivities(cached.activities));
        setSyncedAt(cached.syncedAt || 0);
      }

      const token = await AsyncStorage.getItem("strava_access_token");
      const connected = !!token;
      setHasToken(connected);

      // If disconnected, keep cached visible
      if (!connected) return;

      const days = daysForRange;
      const after = Math.floor(addDays(new Date(), -days).getTime() / 1000);

      // Try server sync first (matches "sync" behaviour)
      const synced = await tryServerSyncWindow({ days, rangeKey: range });
      if (synced.ok) {
        const arr = Array.isArray(synced.activities) ? synced.activities : [];
        await writeCachedWindow(arr);
        const fresh = await loadCachedWindow();
        setActs(mapActivities(arr));
        setSyncedAt(fresh.syncedAt || Date.now());
        return;
      }

      // Fallback: direct Strava fetch
      const raw = await fetchStravaWindow(token, after);
      await writeCachedWindow(raw);
      const fresh = await loadCachedWindow();
      setActs(mapActivities(raw));
      setSyncedAt(fresh.syncedAt || Date.now());
    } catch (e) {
      console.error("Stats load error", e);
      setError("Couldn’t load stats. Try reconnecting in Settings.");
      // keep cached if present
    } finally {
      setLoading(false);
    }
  }, [daysForRange, mapActivities, range]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /* ─────────────────────────────────────────────
     Quick windows
  ────────────────────────────────────────────── */
  const windows = useMemo(() => {
    const now = new Date();
    const t7 = addDays(now, -7).getTime();
    const t28 = addDays(now, -28).getTime();
    const t90 = addDays(now, -90).getTime();

    const weekStart = startOfWeekMonday(now);
    const lastWeekStart = addDays(weekStart, -7);
    const weekEnd = addDays(weekStart, 7).getTime();
    const lastWeekEnd = addDays(lastWeekStart, 7).getTime();

    const empty = () => ({
      count: 0,
      timeMin: 0,
      runKm: 0,
      runTimeMin: 0,
      strengthMin: 0,
      elevM: 0,
    });

    const addAct = (acc, a) => {
      acc.count += 1;
      acc.timeMin += safeNum(a.movingTimeMin);
      acc.elevM += safeNum(a.elevGainM);
      if (a.type === "Run") {
        acc.runKm += safeNum(a.distanceKm);
        acc.runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") {
        acc.strengthMin += safeNum(a.movingTimeMin);
      }
    };

    const out = {
      d7: empty(),
      d28: empty(),
      d90: empty(),
      thisWeek: empty(),
      lastWeek: empty(),
    };

    acts.forEach((a) => {
      const t = a.when ? new Date(a.when).getTime() : 0;
      if (!t) return;

      if (t >= t7) addAct(out.d7, a);
      if (t >= t28) addAct(out.d28, a);
      if (t >= t90) addAct(out.d90, a);

      if (t >= weekStart.getTime() && t < weekEnd) addAct(out.thisWeek, a);
      if (t >= lastWeekStart.getTime() && t < lastWeekEnd) addAct(out.lastWeek, a);
    });

    const avgPace = (runKm, runTimeMin) => {
      if (runKm <= 0 || runTimeMin <= 0) return null;
      return runTimeMin / runKm;
    };

    return {
      weekStart,
      lastWeekStart,
      out,
      avgPace7: avgPace(out.d7.runKm, out.d7.runTimeMin),
      avgPace28: avgPace(out.d28.runKm, out.d28.runTimeMin),
      avgPace90: avgPace(out.d90.runKm, out.d90.runTimeMin),
      avgPaceThisWeek: avgPace(out.thisWeek.runKm, out.thisWeek.runTimeMin),
      avgPaceLastWeek: avgPace(out.lastWeek.runKm, out.lastWeek.runTimeMin),
    };
  }, [acts]);

  /* ─────────────────────────────────────────────
     Weekly series for chart
  ────────────────────────────────────────────── */
  const weeklySeries = useMemo(() => {
    const now = new Date();
    const thisWeek = startOfWeekMonday(now);

    const weeks = range === "12w" ? 12 : range === "26w" ? 26 : 52;

    const by = {};
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = addDays(thisWeek, -7 * i);
      const key = isoKey(ws);
      by[key] = {
        key,
        weekStart: ws,
        count: 0,
        timeMin: 0,
        runKm: 0,
        runTimeMin: 0,
        strengthMin: 0,
        elevM: 0,
      };
    }

    acts.forEach((a) => {
      if (!a.when) return;
      const ws = startOfWeekMonday(new Date(a.when));
      const k = isoKey(ws);
      const bucket = by[k];
      if (!bucket) return;

      bucket.count += 1;
      bucket.timeMin += safeNum(a.movingTimeMin);
      bucket.elevM += safeNum(a.elevGainM);
      if (a.type === "Run") {
        bucket.runKm += safeNum(a.distanceKm);
        bucket.runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") {
        bucket.strengthMin += safeNum(a.movingTimeMin);
      }
    });

    const series = Object.values(by).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

    const mapped = series.map((w) => ({
      ...w,
      value:
        metric === "time_min"
          ? w.timeMin
          : metric === "run_km"
          ? w.runKm
          : metric === "strength_min"
          ? w.strengthMin
          : w.count,
      label: w.weekStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    }));

    const max = Math.max(...mapped.map((m) => Number(m.value || 0)), 0);
    return { series: mapped, max: Math.max(1, max) };
  }, [acts, metric, range]);

  const selectedWeek = useMemo(() => {
    if (!selectedKey) return null;
    return weeklySeries.series.find((w) => w.key === selectedKey) || null;
  }, [weeklySeries.series, selectedKey]);

  const selectedWeekActivities = useMemo(() => {
    if (!selectedWeek) return [];
    const start = selectedWeek.weekStart.getTime();
    const end = addDays(selectedWeek.weekStart, 7).getTime();
    return acts
      .filter((a) => {
        const t = a.when ? new Date(a.when).getTime() : 0;
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, selectedWeek]);

  const onPointPress = useCallback((w) => {
    setSelectedKey(w.key);
    setSheetOpen(true);
  }, []);

  const fmtMetric = useCallback(
    (w) => {
      if (!w) return "—";
      if (metric === "time_min") return formatHoursMin(w.value);
      if (metric === "run_km") return `${Number(w.value || 0).toFixed(1)} km`;
      if (metric === "strength_min") return `${Math.round(w.value || 0)} min`;
      return `${Math.round(w.value || 0)} sess`;
    },
    [metric]
  );

  const syncedLine = useMemo(() => {
    if (!syncedAt) return "";
    const d = new Date(syncedAt);
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return ` · Synced ${date} ${time}`;
  }, [syncedAt]);

  const hasData = acts.length > 0;

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

                <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="settings" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroAvatarWrap}>
                  {user?.photoURL ? (
                    <Image source={{ uri: user.photoURL }} style={s.heroAvatar} />
                  ) : (
                    <View style={s.heroAvatarFallback}>
                      <Text style={s.heroAvatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={s.heroAvatarBorder} />
                </View>

                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>STATS</Text>
                  <Text style={s.heroName}>Training overview</Text>
                  <Text style={s.heroSub}>
                    Strava: {hasToken ? "Connected" : "Disconnected"}
                    {syncedLine}
                    {!hasToken && hasData ? " · Showing cached data" : ""}
                    {" · "}
                    {range === "12w" ? "12 weeks" : range === "26w" ? "26 weeks" : "52 weeks"}
                  </Text>
                </View>
              </View>

              {/* CHART */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>Weekly trend</Text>
                  <TouchableOpacity onPress={onRefresh} style={s.refreshBtnMini} activeOpacity={0.85}>
                    <Feather name="refresh-cw" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 10 }}>
                  <MetricToggle
                    value={metric}
                    onChange={setMetric}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    options={[
                      { key: "time_min", label: "Time" },
                      { key: "run_km", label: "Run km" },
                      { key: "strength_min", label: "Strength" },
                      { key: "count", label: "Count" },
                    ]}
                  />
                </View>

                <View style={{ marginTop: 10 }}>
                  <MetricToggle
                    value={range}
                    onChange={setRange}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    options={[
                      { key: "12w", label: "12w" },
                      { key: "26w", label: "26w" },
                      { key: "52w", label: "52w" },
                    ]}
                  />
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasData ? (
                  <Text style={s.hint}>
                    {hasToken
                      ? "No sessions found in this range yet."
                      : "No cached stats yet. Reconnect Strava once to sync and cache your activity."}
                  </Text>
                ) : (
                  <>
                    {!hasToken ? (
                      <View style={s.cacheBanner}>
                        <Feather name="database" size={14} color={colors.text} />
                        <Text style={s.cacheBannerText}>Showing last synced data.</Text>
                      </View>
                    ) : null}

                    <WeeklyChart
                      data={weeklySeries.series}
                      max={weeklySeries.max}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      activeKey={selectedKey}
                      onPointPress={onPointPress}
                      tooltipText={(w) => (w ? `${weekRangeLabel(w.weekStart)} • ${fmtMetric(w)}` : "")}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>Tap a point to open that week.</Text>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}

                {!hasToken ? (
                  <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                    <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                    <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </LinearGradient>

          {/* QUICK STATS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="bar-chart-2" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Key numbers</Text>
              </View>
            </View>

            {!hasData ? (
              <Text style={s.hint}>
                {hasToken
                  ? "No activity data available for these cards."
                  : "Reconnect Strava to sync and cache your activity. If you already synced before, you should see cached cards here."}
              </Text>
            ) : (
              <>
                {!hasToken ? (
                  <View style={[s.cacheBanner, { marginTop: 12 }]}>
                    <Feather name="database" size={14} color={colors.text} />
                    <Text style={s.cacheBannerText}>Cards based on cached data.</Text>
                  </View>
                ) : null}

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="This week"
                  subtitle={weekRangeLabel(windows.weekStart)}
                  items={[
                    { k: "Sessions", v: String(windows.out.thisWeek.count) },
                    { k: "Time", v: formatHoursMin(windows.out.thisWeek.timeMin) },
                    { k: "Run km", v: windows.out.thisWeek.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPaceThisWeek) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last week"
                  subtitle={weekRangeLabel(windows.lastWeekStart)}
                  items={[
                    { k: "Sessions", v: String(windows.out.lastWeek.count) },
                    { k: "Time", v: formatHoursMin(windows.out.lastWeek.timeMin) },
                    { k: "Run km", v: windows.out.lastWeek.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPaceLastWeek) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last 7 days"
                  subtitle="Rolling"
                  items={[
                    { k: "Sessions", v: String(windows.out.d7.count) },
                    { k: "Time", v: formatHoursMin(windows.out.d7.timeMin) },
                    { k: "Run km", v: windows.out.d7.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPace7) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last 28 days"
                  subtitle="Rolling"
                  items={[
                    { k: "Sessions", v: String(windows.out.d28.count) },
                    { k: "Time", v: formatHoursMin(windows.out.d28.timeMin) },
                    { k: "Run km", v: windows.out.d28.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPace28) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last 90 days"
                  subtitle="Rolling"
                  items={[
                    { k: "Sessions", v: String(windows.out.d90.count) },
                    { k: "Time", v: formatHoursMin(windows.out.d90.timeMin) },
                    { k: "Run km", v: windows.out.d90.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPace90) },
                  ]}
                />
              </>
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* WEEK SHEET */}
        <WeekBreakdownSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          week={selectedWeek}
          activities={selectedWeekActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Weekly chart (clickable points)
───────────────────────────────────────────── */
function WeeklyChart({ data, max, accent, colors, isDark, activeKey, onPointPress, tooltipText }) {
  const screenW = Dimensions.get("window").width;
  const W = Math.min(392, Math.max(320, screenW - 36));
  const H = 180;

  const padTop = 18;
  const padBottom = 26;
  const padLeft = 10;
  const padRight = 10;

  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const safeMax = Math.max(1, Number(max || 0));
  const xFor = (i) => {
    if (data.length <= 1) return padLeft + innerW;
    return padLeft + (i * innerW) / (data.length - 1);
  };
  const yFor = (v) => {
    const t = clamp(Number(v || 0) / safeMax, 0, 1);
    return padTop + (1 - t) * innerH;
  };
  const baseY = padTop + innerH;

  const lineD = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`)
    .join(" ");
  const fillD = `${lineD} L ${xFor(data.length - 1).toFixed(2)} ${baseY.toFixed(2)} L ${xFor(0).toFixed(
    2
  )} ${baseY.toFixed(2)} Z`;

  const activeIndex = activeKey ? data.findIndex((p) => p.key === activeKey) : -1;
  const activePoint = activeIndex >= 0 ? data[activeIndex] : null;
  const ax = activeIndex >= 0 ? xFor(activeIndex) : 0;
  const ay = activeIndex >= 0 ? yFor(activePoint?.value) : 0;

  const tip = tooltipText?.(activePoint);

  const ticks = data
    .map((p, i) => ({ i, label: p.label }))
    .filter((t, idx) => idx === 0 || idx === data.length - 1 || idx % 4 === 0);

  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line
          x1={padLeft}
          y1={baseY}
          x2={padLeft + innerW}
          y2={baseY}
          stroke={isDark ? "#232430" : "#E1E3EA"}
          strokeWidth={1}
        />

        <Path d={fillD} fill={accent} opacity={0.16} />
        <Path d={lineD} stroke={accent} strokeWidth={3} fill="none" />

        {data.map((p, i) => (
          <Circle
            key={p.key}
            cx={xFor(i)}
            cy={yFor(p.value)}
            r={16}
            fill="transparent"
            onPress={() => onPointPress?.(p)}
          />
        ))}

        {activePoint ? (
          <>
            <Circle cx={ax} cy={ay} r={12} fill={accent} opacity={0.2} />
            <Circle cx={ax} cy={ay} r={6} fill={accent} />
            {tip ? (
              <SvgText
                x={clamp(ax, padLeft + 110, padLeft + innerW - 10)}
                y={clamp(ay - 12, padTop + 10, baseY - 10)}
                fontSize={12}
                fontWeight="900"
                fill={colors.text}
                textAnchor="middle"
              >
                {tip}
              </SvgText>
            ) : null}
          </>
        ) : null}

        {ticks.map((t) => (
          <SvgText
            key={`tick-${t.i}`}
            x={xFor(t.i)}
            y={H - 6}
            fontSize={12}
            fontWeight="800"
            fill={colors.subtext}
            textAnchor="middle"
          >
            {t.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Stat cards
───────────────────────────────────────────── */
function StatGrid({ title, subtitle, items, colors, isDark, accent }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{subtitle}</Text>
      </View>

      <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
        {items.slice(0, 2).map((it) => (
          <StatCard key={it.k} label={it.k} value={it.v} colors={colors} isDark={isDark} accent={accent} />
        ))}
      </View>
      <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
        {items.slice(2, 4).map((it) => (
          <StatCard key={it.k} label={it.k} value={it.v} colors={colors} isDark={isDark} accent={accent} />
        ))}
      </View>
    </View>
  );
}

function StatCard({ label, value, colors, isDark, accent }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 18,
        padding: 14,
        backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 10 },
        ...Platform.select({ android: { elevation: 1 } }),
      }}
    >
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 10 }} numberOfLines={1}>
        {value}
      </Text>
      <View style={{ height: 4, width: 34, borderRadius: 999, backgroundColor: accent, marginTop: 10, opacity: 0.7 }} />
    </View>
  );
}

/* ─────────────────────────────────────────────
   Toggles
───────────────────────────────────────────── */
function MetricToggle({ value, onChange, options, accent, colors, isDark }) {
  const track = isDark ? "#0E0F14" : "#FFFFFF";
  const border = isDark ? "#1B1C22" : "#E6E7EC";
  const activeBg = isDark ? "#00000066" : "#FFFFFFAA";

  return (
    <View
      style={{
        backgroundColor: track,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: border,
        padding: 4,
        flexDirection: "row",
        gap: 6,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            activeOpacity={0.9}
            onPress={() => onChange(opt.key)}
            style={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? activeBg : "transparent",
              borderWidth: active ? 1 : 0,
              borderColor: active ? accent : "transparent",
            }}
          >
            <Text style={{ fontWeight: "900", letterSpacing: 0.3, color: active ? colors.text : colors.subtext }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week breakdown sheet
───────────────────────────────────────────── */
function WeekBreakdownSheet({ open, onClose, week, activities, colors, isDark, accent, router }) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const totals = useMemo(() => {
    const out = { count: 0, timeMin: 0, runKm: 0, runTimeMin: 0, strengthMin: 0, elevM: 0 };
    (activities || []).forEach((a) => {
      out.count += 1;
      out.timeMin += safeNum(a.movingTimeMin);
      out.elevM += safeNum(a.elevGainM);
      if (a.type === "Run") {
        out.runKm += safeNum(a.distanceKm);
        out.runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") out.strengthMin += safeNum(a.movingTimeMin);
    });
    return out;
  }, [activities]);

  const avgPace = useMemo(() => {
    if (totals.runKm <= 0 || totals.runTimeMin <= 0) return null;
    return totals.runTimeMin / totals.runKm;
  }, [totals.runKm, totals.runTimeMin]);

  const title = week?.weekStart ? weekRangeLabel(week.weekStart) : "Week";

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {totals.count} sessions · {formatHoursMin(totals.timeMin)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pill label="Run km" value={totals.runKm.toFixed(1)} colors={colors} isDark={isDark} />
            <Pill label="Avg pace" value={formatPace(avgPace)} colors={colors} isDark={isDark} />
            <Pill label="Strength" value={formatHoursMin(totals.strengthMin)} colors={colors} isDark={isDark} />
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {activities?.length ? (
            activities.map((a) => {
              const whenObj = a.when ? new Date(a.when) : null;
              const hasDistance = Number(a.distanceKm || 0) > 0;
              const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
              const showDistance = a.type === "Run" && hasDistance;
              const showPace = a.type === "Run" && hasDistance && hasPace;

              return (
                <View key={a.id} style={{ marginTop: 14 }}>
                  <CompactActivityCard
                    colors={colors}
                    isDark={isDark}
                    accent={accent}
                    title={a.title}
                    subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${a.type}`}
                    distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                    paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                    timeText={formatMinSec(a.movingTimeSec)}
                    showDistance={showDistance}
                    showPace={showPace}
                    onPress={() => router.push(`/me/activity/${a.id}`)}
                  />
                </View>
              );
            })
          ) : (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No sessions in this week.</Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/record")}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16 }]}
          >
            <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add a session</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Pill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Compact activity card
───────────────────────────────────────────── */
function CompactActivityCard({
  colors,
  isDark,
  accent,
  title,
  subLine,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
}) {
  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      style={[
        cardStyles.wrap,
        { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800", marginTop: 6 }} numberOfLines={1}>
            {subLine}
          </Text>
        </View>
        <View style={{ width: 8 }} />
        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <View key={m.key} style={{ flex: 1 }}>
            <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{m.label}</Text>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>{m.value}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 4, width: 34, borderRadius: 999, backgroundColor: accent, marginTop: 12, opacity: 0.7 }} />
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  metricsRow: { marginTop: 14, flexDirection: "row", gap: 18 },
});

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
    heroTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: {
      width: 60,
      height: 60,
      borderRadius: 16,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: { position: "absolute", inset: 0, borderRadius: 16, borderWidth: 2, borderColor: accent },
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

    chartWrap: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    chartTitle: { fontSize: 13, fontWeight: "900", color: colors.text },

    refreshBtnMini: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },

    connectBtn: {
      marginTop: 12,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
    },
    connectBtnText: {
      color: colors.sapOnPrimary || "#0B0B0B",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 13,
    },

    cacheBanner: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: isDark ? "#18191E" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#2A2B33" : "#E6E7EC",
    },
    cacheBannerText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "800" },

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

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
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
  cta: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});
