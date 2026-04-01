// app/(protected)/me/month.jsx
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

import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Date helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}
function formatMonthTitle(dateObj) {
  return dateObj.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
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
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   ✅ Offline cache keys
───────────────────────────────────────────── */
function monthKeyFromDate(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "unknown";
  return dt.toISOString().slice(0, 7); // YYYY-MM
}
function monthCacheKey(monthKey) {
  return `trainr_strava_month_cache_v1_${monthKey}`;
}
function monthCacheMetaKey(monthKey) {
  return `trainr_strava_month_cache_meta_v1_${monthKey}`; // { updatedAtISO }
}
const STRAVA_DETAIL_CACHE_KEY = "trainr_strava_activity_detail_cache_v1"; // { [id]: detail }

/* ============================================================================
   Month — Clean Strava-like month overview + CLICKABLE points
   ✅ Caches Strava month data + detail so it shows offline / when refresh fails
============================================================================ */
export default function MonthPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncISO, setLastSyncISO] = useState("");

  const [monthActs, setMonthActs] = useState([]); // mapped

  // Chart metric
  const [graphMetric, setGraphMetric] = useState("run_km"); // run_km | time_min | count

  // Point selection + day sheet
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // detailed activity fetch cache
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [activityDetailCache, setActivityDetailCache] = useState({}); // { [id]: detailedActivity }

  const monthStart = useMemo(() => startOfMonth(new Date()), []);
  const monthTitle = useMemo(() => formatMonthTitle(new Date()), []);
  const monthKey = useMemo(() => monthKeyFromDate(new Date()), []);

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  /* ─────────────────────────────────────────────
     Offline cache: load month + meta (fast UI)
  ────────────────────────────────────────────── */
  const loadMonthCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(monthCacheKey(monthKey));
      const parsed = safeJsonParse(raw || "");
      const arr = Array.isArray(parsed) ? parsed : [];
      if (arr.length) setMonthActs(arr);

      const metaRaw = await AsyncStorage.getItem(monthCacheMetaKey(monthKey));
      const meta = safeJsonParse(metaRaw || "") || null;
      if (meta?.updatedAtISO) setLastSyncISO(meta.updatedAtISO);
    } catch (e) {
      console.warn("month cache load error", e);
    }
  }, [monthKey]);

  const saveMonthCache = useCallback(
    async (arr, updatedAtISO) => {
      try {
        await AsyncStorage.setItem(monthCacheKey(monthKey), JSON.stringify(arr || []));
        await AsyncStorage.setItem(
          monthCacheMetaKey(monthKey),
          JSON.stringify({ updatedAtISO: updatedAtISO || new Date().toISOString() })
        );
      } catch (e) {
        console.warn("month cache save error", e);
      }
    },
    [monthKey]
  );

  const loadDetailCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STRAVA_DETAIL_CACHE_KEY);
      const parsed = safeJsonParse(raw || "");
      const obj = parsed && typeof parsed === "object" ? parsed : {};
      setActivityDetailCache(obj);
    } catch (e) {
      console.warn("detail cache load error", e);
    }
  }, []);

  const saveDetailCache = useCallback(async (nextObj) => {
    try {
      await AsyncStorage.setItem(STRAVA_DETAIL_CACHE_KEY, JSON.stringify(nextObj || {}));
    } catch (e) {
      console.warn("detail cache save error", e);
    }
  }, []);

  /* ─────────────────────────────────────────────
     Load (offline-first):
     - show cached immediately
     - then try to refresh from Strava (if token)
     - on failure, keep cached data
  ────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // Always load caches first (offline-first)
      await Promise.all([loadMonthCache(), loadDetailCache()]);

      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasToken(false);
        if (!monthActs?.length) {
          setError("Strava not connected. Showing any cached data available.");
        }
        return;
      }
      setHasToken(true);

      const after = Math.floor(monthStart.getTime() / 1000);
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava month load error", resp.status, text);
        // Keep cached, do not wipe
        setError("Couldn’t refresh Strava. Showing cached data.");
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const monthOnly = safe.filter((a) => {
        const t = a?.start_date ? new Date(a.start_date).getTime() : 0;
        return t >= monthStart.getTime();
      });

      const nowISO = new Date().toISOString();
      setLastSyncISO(nowISO);

      const mapped = monthOnly
        .map((a) => {
          const distanceKm = (a.distance || 0) / 1000;
          const when = a.start_date_local || a.start_date;
          const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

          return {
            id: String(a.id),
            title: a.name || a.type || "Workout",
            type: a.type || "Workout",
            when,
            distanceKm,
            movingTimeMin: Math.round((a.moving_time || 0) / 60),
            movingTimeSec: Number(a.moving_time || 0),
            paceMinPerKm: pace,
            elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
            description: a.description || "",
            deviceName: a.device_name || "",
          };
        })
        .filter((x) => x && x.id && x.when);

      mapped.sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : 0;
        const tb = b.when ? new Date(b.when).getTime() : 0;
        return tb - ta;
      });

      setMonthActs(mapped);
      await saveMonthCache(mapped, nowISO);
    } catch (e) {
      console.error("Month load error", e);
      setError("Couldn’t refresh Strava. Showing cached data.");
    } finally {
      setLoading(false);
    }
  }, [loadMonthCache, loadDetailCache, monthActs?.length, monthStart, saveMonthCache]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const monthTotals = useMemo(() => {
    const activities = monthActs.length;
    const timeMin = monthActs.reduce((sum, a) => sum + (a.movingTimeMin || 0), 0);
    const distanceKm = monthActs
      .filter((a) => a.type === "Run")
      .reduce((sum, a) => sum + (a.distanceKm || 0), 0);
    return { activities, timeMin, distanceKm };
  }, [monthActs]);

  // Daily series (month-to-date)
  const dailySeries = useMemo(() => {
    const by = {};
    monthActs.forEach((a) => {
      if (!a.when) return;
      const k = isoKey(a.when);
      if (!k) return;
      if (!by[k]) by[k] = { runKm: 0, timeMin: 0, count: 0 };
      by[k].count += 1;
      by[k].timeMin += a.movingTimeMin || 0;
      if (a.type === "Run") by[k].runKm += a.distanceKm || 0;
    });

    const now = startOfDay(new Date());
    const daysSoFar = Math.floor((now.getTime() - monthStart.getTime()) / 86400000) + 1;

    const out = [];
    for (let i = 0; i < Math.max(1, daysSoFar); i++) {
      const d = new Date(monthStart);
      d.setDate(monthStart.getDate() + i);
      const k = isoKey(d);
      out.push({
        key: k,
        dateObj: d,
        label: String(d.getDate()),
        runKm: by[k]?.runKm || 0,
        timeMin: by[k]?.timeMin || 0,
        count: by[k]?.count || 0,
      });
    }
    return out;
  }, [monthActs, monthStart]);

  const chart = useMemo(() => {
    const metricLabel =
      graphMetric === "run_km" ? "Distance" : graphMetric === "time_min" ? "Time" : "Activities";

    const series = dailySeries.map((d) => ({
      key: d.key,
      dateObj: d.dateObj,
      label: d.label,
      value:
        graphMetric === "run_km"
          ? d.runKm
          : graphMetric === "time_min"
          ? d.timeMin
          : d.count,
      runKm: d.runKm,
      timeMin: d.timeMin,
      count: d.count,
    }));

    const values = series.map((x) => Number(x.value || 0));
    const max = Math.max(...values, 0);
    const mid = max / 2;

    return { metricLabel, series, max, mid };
  }, [dailySeries, graphMetric]);

  // Activities for selected day
  const selectedDayActivities = useMemo(() => {
    if (!selectedDayKey) return [];
    const list = monthActs.filter((a) => {
      const k = isoKey(a.when);
      return k && k === selectedDayKey;
    });
    return list.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [monthActs, selectedDayKey]);

  const selectedDayTotals = useMemo(() => {
    if (!selectedDayKey) return { runKm: 0, timeMin: 0, elevGainM: 0, count: 0 };
    const list = selectedDayActivities;
    const runKm = list
      .filter((x) => x.type === "Run")
      .reduce((s, x) => s + (x.distanceKm || 0), 0);
    const timeMin = list.reduce((s, x) => s + (x.movingTimeMin || 0), 0);
    const elevGainM = list.reduce((s, x) => s + (x.elevGainM || 0), 0);
    return { runKm, timeMin, elevGainM, count: list.length };
  }, [selectedDayActivities, selectedDayKey]);

  const onPointPress = useCallback((p) => {
    setSelectedDayKey(p.key);
    setDaySheetOpen(true);
  }, []);

  // Detailed activity endpoint (cached + persisted)
  const fetchActivityDetailIfNeeded = useCallback(
    async (id) => {
      try {
        if (!id) return;
        if (activityDetailCache[id]) return;

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) return;

        setDetailLoadingId(id);

        const resp = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) return;

        const detail = await resp.json();

        setActivityDetailCache((prev) => {
          const next = { ...prev, [id]: detail };
          saveDetailCache(next);
          return next;
        });
      } catch {
        // ignore
      } finally {
        setDetailLoadingId("");
      }
    },
    [activityDetailCache, saveDetailCache]
  );

  const topActions = (
    <View style={s.sectionHeaderRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={s.sectionIcon}>
          <Feather name="list" size={16} color={colors.text} />
        </View>
        <Text style={s.sectionTitle}>Month log</Text>
      </View>

      <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
        <Feather name="refresh-cw" size={16} color={colors.text} />
      </TouchableOpacity>
    </View>
  );

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
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={s.iconButtonGhost}
                  activeOpacity={0.8}
                >
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.push("/settings")}
                  style={s.iconButtonGhost}
                  activeOpacity={0.8}
                >
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
                  <Text style={s.heroBadge}>MONTH</Text>
                  <Text style={s.heroName}>{monthTitle}</Text>
                  <Text style={s.heroSub}>
                    Strava: {hasToken ? "Connected" : "Not connected"}
                    {lastSyncISO ? ` · cached/synced ${formatWhenLine(lastSyncISO)}` : ""}
                  </Text>
                </View>
              </View>

              <View style={s.summaryRow}>
                <SummaryPill label="Activities" value={String(monthTotals.activities)} colors={colors} isDark={isDark} />
                <SummaryPill label="Time" value={formatHoursMin(monthTotals.timeMin)} colors={colors} isDark={isDark} />
                <SummaryPill label="Run km" value={monthTotals.distanceKm.toFixed(1)} colors={colors} isDark={isDark} />
              </View>

              {/* CLEAN CHART */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>{chart.metricLabel}</Text>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const k = isoKey(new Date());
                      setSelectedDayKey(k);
                      setDaySheetOpen(true);
                    }}
                    style={s.chartAction}
                  >
                    <Text style={s.chartActionText}>Open day</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 10 }}>
                  <MetricToggle
                    value={graphMetric}
                    onChange={setGraphMetric}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    options={[
                      { key: "run_km", label: "Run" },
                      { key: "time_min", label: "Time" },
                      { key: "count", label: "Count" },
                    ]}
                  />
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading chart…</Text>
                  </View>
                ) : chart.series.length > 0 ? (
                  <>
                    <StravaCleanAreaChart
                      data={chart.series}
                      max={chart.max}
                      mid={chart.mid}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onPointPress={onPointPress}
                      activeKey={selectedDayKey}
                      formatY={(v) =>
                        graphMetric === "run_km"
                          ? `${Number(v || 0).toFixed(0)} km`
                          : graphMetric === "time_min"
                          ? `${Math.round(v || 0)} min`
                          : `${Math.round(v || 0)}`
                      }
                      xLabelEvery={7}
                      tooltipText={(p) => {
                        if (!p) return "";
                        const date = p.dateObj
                          ? p.dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                          : p.label;
                        return `${date} • ${
                          graphMetric === "run_km"
                            ? `${p.runKm.toFixed(1)} km`
                            : graphMetric === "time_min"
                            ? `${Math.round(p.timeMin)} min`
                            : `${p.count} act`
                        }`;
                      }}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>Tap a point to view that day’s activities.</Text>
                  </>
                ) : (
                  <Text style={s.hint}>
                    {hasToken ? "No data yet this month." : "No Strava token — showing any cached data."}
                  </Text>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}
              </View>
            </View>
          </LinearGradient>

          {/* MONTH LOG */}
          <View style={s.section}>
            {topActions}

            <Text style={s.hint}>Tap to open · Hold to fetch device + full notes (cached for offline).</Text>

            {loading ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator />
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : monthActs.length === 0 ? (
              <Text style={s.hint}>
                {hasToken ? "No activities logged yet this month." : "No cached activities yet."}
              </Text>
            ) : (
              <>
                {monthActs.slice(0, 30).map((a) => {
                  const detail = activityDetailCache?.[a.id];
                  const whenObj = a.when ? new Date(a.when) : null;

                  const deviceLine =
                    detail?.device_name || detail?.gear?.name || a.deviceName || "Strava";

                  const desc = detail?.description || a.description || "";

                  const hasDistance = Number(a.distanceKm || 0) > 0;
                  const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
                  const showDistance = a.type === "Run" && hasDistance;
                  const showPace = a.type === "Run" && hasDistance && hasPace;

                  return (
                    <View key={a.id} style={{ marginTop: 12 }}>
                      <CompactActivityCard
                        userName={displayName}
                        avatarUri={user?.photoURL || ""}
                        initial={initial}
                        accent={accent}
                        colors={colors}
                        isDark={isDark}
                        title={a.title}
                        subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                        notes={desc}
                        type={a.type}
                        distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                        paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                        timeText={formatMinSec(a.movingTimeSec)}
                        showDistance={showDistance}
                        showPace={showPace}
                        onPress={() => router.push(`/me/activity/${a.id}`)}
                        onLongPress={() => fetchActivityDetailIfNeeded(a.id)}
                        loadingDetail={detailLoadingId === a.id}
                      />
                    </View>
                  );
                })}
              </>
            )}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* DAY SHEET / MODAL */}
        <DaySheet
          open={daySheetOpen}
          onClose={() => setDaySheetOpen(false)}
          dayKey={selectedDayKey}
          dayDate={selectedDayKey ? new Date(selectedDayKey) : null}
          totals={selectedDayTotals}
          activities={selectedDayActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          onOpenActivity={(id) => router.push(`/me/activity/${id}`)}
          onPeekDetail={fetchActivityDetailIfNeeded}
          detailCache={activityDetailCache}
          detailLoadingId={detailLoadingId}
          userName={displayName}
          avatarUri={user?.photoURL || ""}
          initial={initial}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Clean area chart with clickable points
───────────────────────────────────────────── */
function StravaCleanAreaChart({
  data,
  max,
  mid,
  accent,
  colors,
  isDark,
  onPointPress,
  activeKey,
  formatY,
  xLabelEvery = 7,
  tooltipText,
}) {
  const screenW = Dimensions.get("window").width;
  const W = Math.min(380, Math.max(320, screenW - 36));
  const H = 170;

  const padTop = 16;
  const padBottom = 28;
  const padLeft = 6;
  const padRight = 44;

  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const safeMax = Math.max(1, Number(max || 0));
  const safeMid = Number(mid || 0);

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
  const fillD = `${lineD} L ${xFor(data.length - 1).toFixed(2)} ${baseY.toFixed(
    2
  )} L ${xFor(0).toFixed(2)} ${baseY.toFixed(2)} Z`;

  const midY = yFor(safeMid);

  const ticks = data
    .map((p, i) => ({ i, label: p.label }))
    .filter((t, idx) => idx === 0 || idx === data.length - 1 || Number(t.label) % xLabelEvery === 0);

  const activeIndex = activeKey ? data.findIndex((p) => p.key === activeKey) : -1;
  const activePoint = activeIndex >= 0 ? data[activeIndex] : null;
  const ax = activeIndex >= 0 ? xFor(activeIndex) : 0;
  const ay = activeIndex >= 0 ? yFor(activePoint?.value) : 0;
  const tip = tooltipText?.(activePoint);

  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line
          x1={padLeft}
          y1={midY}
          x2={padLeft + innerW}
          y2={midY}
          stroke={isDark ? "#262730" : "#E1E3EA"}
          strokeWidth={1}
        />

        <Path d={fillD} fill={accent} opacity={0.18} />
        <Path d={lineD} stroke={accent} strokeWidth={3} fill="none" />

        <SvgText x={padLeft + innerW + 8} y={yFor(safeMax) + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {formatY(safeMax)}
        </SvgText>
        <SvgText x={padLeft + innerW + 8} y={midY + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {formatY(safeMid)}
        </SvgText>
        <SvgText x={padLeft + innerW + 8} y={baseY + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {formatY(0)}
        </SvgText>

        {data.map((p, i) => {
          const x = xFor(i);
          const y = yFor(p.value);
          return <Circle key={p.key} cx={x} cy={y} r={16} fill="transparent" onPress={() => onPointPress?.(p)} />;
        })}

        {activePoint ? (
          <>
            <Circle cx={ax} cy={ay} r={12} fill={accent} opacity={0.2} />
            <Circle cx={ax} cy={ay} r={6} fill={accent} />
            {tip ? (
              <SvgText
                x={clamp(ax, padLeft + 70, padLeft + innerW - 10)}
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

        {ticks.map((t) => {
          const x = xFor(t.i);
          return (
            <SvgText
              key={`tick-${t.i}`}
              x={x}
              y={H - 6}
              fontSize={12}
              fontWeight="800"
              fill={colors.subtext}
              textAnchor="middle"
            >
              {t.label}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   NORMAL sized activity card
───────────────────────────────────────────── */
function CompactActivityCard({
  userName,
  avatarUri,
  initial,
  accent,
  colors,
  isDark,
  title,
  subLine,
  notes,
  type,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
  onLongPress,
  loadingDetail,
}) {
  const showNotes = (notes || "").trim().length > 0;

  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[cardStyles.wrap, { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card }]}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatarWrap, { borderColor: accent }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={cardStyles.avatarImg} />
          ) : (
            <View style={[cardStyles.avatarFallback, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}>
              <Text style={[cardStyles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.userName, { color: colors.text }]} numberOfLines={1}>
            {userName}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Feather name="activity" size={15} color={colors.text} />
            <Text style={[cardStyles.subLine, { color: colors.subtext }]} numberOfLines={1}>
              {subLine}
            </Text>
          </View>
        </View>

        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>

      {showNotes ? (
        <Text style={[cardStyles.notes, { color: colors.subtext }]} numberOfLines={3}>
          {notes}
        </Text>
      ) : null}

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <MetricBlockSmall key={m.key} label={m.label} value={m.value} colors={colors} />
        ))}
      </View>

      {loadingDetail ? (
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>Loading details…</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function MetricBlockSmall({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>{value}</Text>
    </View>
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
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { width: 54, height: 54, borderRadius: 18, borderWidth: 3, overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "900" },
  userName: { fontSize: 16, fontWeight: "900" },
  subLine: { fontSize: 13, fontWeight: "700", flex: 1 },
  title: { marginTop: 10, fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
  notes: { marginTop: 10, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  metricsRow: { marginTop: 16, flexDirection: "row", gap: 18 },
});

/* ─────────────────────────────────────────────
   Day Sheet
───────────────────────────────────────────── */
function DaySheet({
  open,
  onClose,
  dayKey,
  dayDate,
  totals,
  activities,
  colors,
  isDark,
  accent,
  router,
  onOpenActivity,
  onPeekDetail,
  detailCache,
  detailLoadingId,
  userName,
  avatarUri,
  initial,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>
                {dayDate
                  ? dayDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" })
                  : "Day"}
              </Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {dayDate ? dayDate.toLocaleDateString("en-GB") : ""}
              </Text>
              {dayKey ? (
                <Text style={[stylesGlobal.sheetSub, { color: colors.subtext, marginTop: 4 }]}>
                  {`Day key: ${dayKey}`}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pill label="Activities" value={String(totals?.count || 0)} colors={colors} isDark={isDark} />
            <Pill label="Time" value={formatHoursMin(totals?.timeMin || 0)} colors={colors} isDark={isDark} />
            <Pill label="Run km" value={(totals?.runKm || 0).toFixed(1)} colors={colors} isDark={isDark} />
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {activities?.length ? (
            activities.map((a) => {
              const detail = detailCache?.[a.id];
              const whenObj = a.when ? new Date(a.when) : null;
              const deviceLine = detail?.device_name || a.deviceName || "Strava";
              const desc = detail?.description || a.description || "";

              const hasDistance = Number(a.distanceKm || 0) > 0;
              const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
              const showDistance = a.type === "Run" && hasDistance;
              const showPace = a.type === "Run" && hasDistance && hasPace;

              return (
                <View key={a.id} style={{ marginTop: 14 }}>
                  <CompactActivityCard
                    userName={userName}
                    avatarUri={avatarUri}
                    initial={initial}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    title={a.title}
                    subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                    notes={desc}
                    type={a.type}
                    distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                    paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                    timeText={formatMinSec(a.movingTimeSec)}
                    showDistance={showDistance}
                    showPace={showPace}
                    onPress={() => onOpenActivity?.(a.id)}
                    onLongPress={() => onPeekDetail?.(a.id)}
                    loadingDetail={detailLoadingId === a.id}
                  />
                </View>
              );
            })
          ) : (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No activities on this day.</Text>
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

/* ─────────────────────────────────────────────
   UI helper components
───────────────────────────────────────────── */
function SummaryPill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDark ? "#1B1C22" : "#E6E7EC",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 16, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
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
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: { width: 60, height: 60, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: { position: "absolute", inset: 0, borderRadius: 16, borderWidth: 2, borderColor: accent },
    heroTextCol: { flex: 1 },
    heroBadge: { fontSize: 11, fontWeight: "900", color: colors.subtextSoft || colors.subtext, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2 },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    summaryRow: { flexDirection: "row", gap: 10, marginTop: 14 },

    chartWrap: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    chartTitle: { fontSize: 13, fontWeight: "900", color: colors.text },
    chartAction: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: isDark ? "#18191E" : "#E6E7EC" },
    chartActionText: { fontSize: 12, fontWeight: "900", color: colors.text },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: { width: 28, height: 28, borderRadius: 12, backgroundColor: isDark ? "#18191E" : "#E6E7EC", alignItems: "center", justifyContent: "center" },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },
    refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.sapSilverMedium || colors.border, backgroundColor: colors.sapSilverLight || colors.card },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({ alignSelf: "center", width: 46, height: 5, borderRadius: 999, backgroundColor: isDark ? "#2A2B33" : "#E6E7EC", marginBottom: 10 }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#18191E" : "#F3F4F6" }),
  cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});
