// app/(protected)/me/this-week.jsx
// ✅ Offline-first: shows cached data when disconnected / Strava request fails
// ✅ Caches: week activities + detail cache (persisted) + last sync meta
// ✅ Never wipes UI on fetch failure
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
import Svg, { G, Path, Text as SvgText } from "react-native-svg";

import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Date helpers (LOCAL-safe)
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeekMonday(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function localKeyFromDate(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseLocalKeyToDate(key) {
  if (!key || typeof key !== "string") return null;
  const [y, m, d] = key.split("-").map((n) => Number(n));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtShort(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function fmtWeekTitle(weekStart) {
  return `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`;
}
function dayNameShort(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
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
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   Type helpers
───────────────────────────────────────────── */
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("bike") || x.includes("cycling")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}

/* ─────────────────────────────────────────────
   ✅ Offline cache keys (per-week)
───────────────────────────────────────────── */
function weekKeyFromMonday(weekStart) {
  // stable key (local week start)
  return localKeyFromDate(weekStart); // YYYY-MM-DD (Monday)
}
function weekActsCacheKey(weekKey) {
  return `trainr_strava_week_cache_v1_${weekKey}`;
}
function weekMetaCacheKey(weekKey) {
  return `trainr_strava_week_cache_meta_v1_${weekKey}`; // { updatedAtISO }
}
const STRAVA_DETAIL_CACHE_KEY = "trainr_strava_activity_detail_cache_v1"; // { [id]: detail }

/* ============================================================================
   THIS WEEK — offline-first + cached
============================================================================ */
export default function ThisWeekPage() {
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

  const [weekActs, setWeekActs] = useState([]); // mapped

  // day modal
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // donut filter
  const [typeFilter, setTypeFilter] = useState("All");

  // details cache
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [activityDetailCache, setActivityDetailCache] = useState({});

  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEndExclusive = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekTitle = useMemo(() => fmtWeekTitle(weekStart), [weekStart]);
  const weekKey = useMemo(() => weekKeyFromMonday(weekStart), [weekStart]);

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  /* ─────────────────────────────────────────────
     Cache: load week + meta + detail cache (offline-first)
  ────────────────────────────────────────────── */
  const loadCaches = useCallback(async () => {
    try {
      const [weekRaw, metaRaw, detailRaw] = await Promise.all([
        AsyncStorage.getItem(weekActsCacheKey(weekKey)),
        AsyncStorage.getItem(weekMetaCacheKey(weekKey)),
        AsyncStorage.getItem(STRAVA_DETAIL_CACHE_KEY),
      ]);

      const cachedWeek = safeJsonParse(weekRaw || "");
      if (Array.isArray(cachedWeek) && cachedWeek.length) {
        setWeekActs(cachedWeek);
      }

      const meta = safeJsonParse(metaRaw || "") || null;
      if (meta?.updatedAtISO) setLastSyncISO(meta.updatedAtISO);

      const details = safeJsonParse(detailRaw || "");
      if (details && typeof details === "object") setActivityDetailCache(details);
    } catch (e) {
      console.warn("week cache load error", e);
    }
  }, [weekKey]);

  const saveWeekCache = useCallback(
    async (arr, updatedAtISO) => {
      try {
        await AsyncStorage.setItem(weekActsCacheKey(weekKey), JSON.stringify(arr || []));
        await AsyncStorage.setItem(
          weekMetaCacheKey(weekKey),
          JSON.stringify({ updatedAtISO: updatedAtISO || new Date().toISOString() })
        );
      } catch (e) {
        console.warn("week cache save error", e);
      }
    },
    [weekKey]
  );

  const saveDetailCache = useCallback(async (nextObj) => {
    try {
      await AsyncStorage.setItem(STRAVA_DETAIL_CACHE_KEY, JSON.stringify(nextObj || {}));
    } catch (e) {
      console.warn("detail cache save error", e);
    }
  }, []);

  /* ─────────────────────────────────────────────
     Load (offline-first):
     1) always load caches
     2) then attempt Strava refresh
     3) on failure: keep cached, show message
  ────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // 1) show cached immediately if present
      await loadCaches();

      // 2) attempt refresh
      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasToken(false);
        // ✅ do NOT wipe weekActs; keep cached
        if (!weekActs.length) {
          setError("Strava not connected. Showing any cached data available.");
        }
        return;
      }
      setHasToken(true);

      const after = Math.floor(weekStart.getTime() / 1000);
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava week load error", resp.status, text);
        // ✅ keep cached; don’t setWeekActs([])
        setError("Couldn’t refresh Strava. Showing cached data.");
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const weekOnly = safe.filter((a) => {
        const when = a?.start_date_local || a?.start_date;
        const t = when ? new Date(when).getTime() : 0;
        return t >= weekStart.getTime() && t < weekEndExclusive.getTime();
      });

      const mapped = weekOnly
        .map((a) => {
          const distanceKm = (a.distance || 0) / 1000;
          const when = a.start_date_local || a.start_date;
          const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

          const rawType = a.type || "Workout";
          const type = normaliseType(rawType);

          return {
            id: String(a.id),
            title: a.name || rawType || "Workout",
            type,
            rawType,
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

      const nowISO = new Date().toISOString();
      setLastSyncISO(nowISO);

      setWeekActs(mapped);
      await saveWeekCache(mapped, nowISO);
    } catch (e) {
      console.error("Week load error", e);
      setError("Couldn’t refresh weekly data. Showing cached data if available.");
      // ✅ keep cached; don’t wipe
    } finally {
      setLoading(false);
    }
  }, [loadCaches, saveWeekCache, weekActs.length, weekEndExclusive, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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

  // 7 day keys
  const weekDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      out.push({
        key: localKeyFromDate(d),
        dateObj: d,
        dow: dayNameShort(d),
        dom: String(d.getDate()),
      });
    }
    return out;
  }, [weekStart]);

  const weekProgress = useMemo(() => {
    const today = startOfDay(new Date());
    const idx = Math.floor((today.getTime() - weekStart.getTime()) / 86400000);
    const daysElapsed = clamp(idx + 1, 1, 7);
    return { daysElapsed, pct: Math.round((daysElapsed / 7) * 100) };
  }, [weekStart]);

  const dayTotals = useMemo(() => {
    const by = {};
    weekActs.forEach((a) => {
      const k = localKeyFromDate(a.when);
      if (!by[k]) by[k] = { timeMin: 0, runKm: 0, count: 0 };
      by[k].count += 1;
      by[k].timeMin += a.movingTimeMin || 0;
      if (a.type === "Run") by[k].runKm += a.distanceKm || 0;
    });

    return weekDays.map((d) => ({
      ...d,
      timeMin: by[d.key]?.timeMin || 0,
      runKm: by[d.key]?.runKm || 0,
      count: by[d.key]?.count || 0,
    }));
  }, [weekActs, weekDays]);

  const weekTotals = useMemo(() => {
    const activities = weekActs.length;
    const timeMin = weekActs.reduce((s, a) => s + (a.movingTimeMin || 0), 0);
    const runKm = weekActs
      .filter((a) => a.type === "Run")
      .reduce((s, a) => s + (a.distanceKm || 0), 0);
    const elevGainM = weekActs.reduce((s, a) => s + (a.elevGainM || 0), 0);
    return { activities, timeMin, runKm, elevGainM };
  }, [weekActs]);

  const keySessions = useMemo(() => {
    const runs = weekActs.filter((a) => a.type === "Run" && Number(a.distanceKm || 0) > 0);
    const longestRun = [...runs].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0] || null;
    const fastestRun = [...runs]
      .filter((a) => Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0)
      .sort((a, b) => (a.paceMinPerKm || 999) - (b.paceMinPerKm || 999))[0] || null;
    const longestSession =
      [...weekActs].sort((a, b) => (b.movingTimeSec || 0) - (a.movingTimeSec || 0))[0] || null;

    return { longestRun, fastestRun, longestSession };
  }, [weekActs]);

  const typeDist = useMemo(() => {
    const by = {};
    weekActs.forEach((a) => {
      const t = a.type || "Other";
      by[t] = (by[t] || 0) + (a.movingTimeMin || 0);
    });

    const entries = Object.entries(by)
      .map(([k, v]) => ({ type: k, minutes: Number(v || 0) }))
      .filter((x) => x.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);

    const total = entries.reduce((s, x) => s + x.minutes, 0) || 1;

    const main = [];
    let other = 0;
    entries.forEach((e) => {
      const pct = e.minutes / total;
      if (pct < 0.08 && e.type !== "Other") other += e.minutes;
      else main.push(e);
    });
    if (other > 0) {
      const idx = main.findIndex((x) => x.type === "Other");
      if (idx >= 0) main[idx].minutes += other;
      else main.push({ type: "Other", minutes: other });
    }

    const finalTotal = main.reduce((s, x) => s + x.minutes, 0) || 1;

    let acc = 0;
    const arcs = main.map((e) => {
      const start = acc;
      const frac = e.minutes / finalTotal;
      acc += frac;
      return { ...e, start, end: acc, pct: Math.round(frac * 100) };
    });

    return { totalMin: finalTotal, arcs };
  }, [weekActs]);

  const selectedDayActivities = useMemo(() => {
    if (!selectedDayKey) return [];
    const list = weekActs.filter((a) => localKeyFromDate(a.when) === selectedDayKey);
    return list.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [weekActs, selectedDayKey]);

  const selectedDayTotals = useMemo(() => {
    const list = selectedDayActivities;
    const timeMin = list.reduce((s, a) => s + (a.movingTimeMin || 0), 0);
    const runKm = list.filter((a) => a.type === "Run").reduce((s, a) => s + (a.distanceKm || 0), 0);
    const elevGainM = list.reduce((s, a) => s + (a.elevGainM || 0), 0);
    return { count: list.length, timeMin, runKm, elevGainM };
  }, [selectedDayActivities]);

  const openDay = useCallback((dayKey) => {
    setSelectedDayKey(dayKey);
    setDaySheetOpen(true);
  }, []);

  const groupedLog = useMemo(() => {
    const groups = {};
    weekActs.forEach((a) => {
      const k = localKeyFromDate(a.when);
      if (!groups[k]) groups[k] = [];
      groups[k].push(a);
    });
    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    });

    return weekDays.map((d) => ({
      ...d,
      list: (groups[d.key] || []).filter((a) => (typeFilter === "All" ? true : a.type === typeFilter)),
    }));
  }, [weekActs, weekDays, typeFilter]);

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
                  <Text style={s.heroBadge}>THIS WEEK</Text>
                  <Text style={s.heroName}>{weekTitle}</Text>
                  <Text style={s.heroSub}>
                    Progress: {weekProgress.daysElapsed}/7 days · Strava: {hasToken ? "Connected" : "Not connected"}
                    {lastSyncISO ? ` · cached/synced ${formatWhenLine(lastSyncISO)}` : ""}
                  </Text>
                </View>
              </View>

              {/* Totals row */}
              <View style={s.summaryRow}>
                <SummaryPill label="Sessions" value={String(weekTotals.activities)} colors={colors} isDark={isDark} />
                <SummaryPill label="Time" value={formatHoursMin(weekTotals.timeMin)} colors={colors} isDark={isDark} />
                <SummaryPill label="Run km" value={weekTotals.runKm.toFixed(1)} colors={colors} isDark={isDark} />
                <SummaryPill label="Elev" value={`${Math.round(weekTotals.elevGainM)}m`} colors={colors} isDark={isDark} />
              </View>

              {/* Weekly bars (tap day) */}
              <View style={s.panel}>
                <View style={s.panelHeader}>
                  <Text style={s.panelTitle}>Daily volume</Text>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => openDay(localKeyFromDate(new Date()))}
                    style={s.panelAction}
                  >
                    <Text style={s.panelActionText}>Open today</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : weekActs.length === 0 ? (
                  <Text style={s.hint}>
                    {hasToken
                      ? "No sessions logged this week yet."
                      : "Strava not connected. Showing any cached data available."}
                  </Text>
                ) : (
                  <>
                    <WeekBars
                      data={dayTotals}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onDayPress={(k) => openDay(k)}
                      selectedKey={selectedDayKey}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>Tap a day to view sessions and breakdown.</Text>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}
              </View>

              {/* Type distribution donut + filter */}
              <View style={s.panel}>
                <View style={s.panelHeader}>
                  <Text style={s.panelTitle}>Time split</Text>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => setTypeFilter("All")} style={s.panelAction}>
                    <Text style={s.panelActionText}>{typeFilter === "All" ? "All types" : typeFilter}</Text>
                    <Feather name="sliders" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {typeDist.arcs.length === 0 ? (
                  <Text style={s.hint}>
                    {weekActs.length ? "No activity time logged this week." : "No cached activity time available."}
                  </Text>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 10 }}>
                    <Donut
                      arcs={typeDist.arcs}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onSlicePress={(t) => setTypeFilter((prev) => (prev === t ? "All" : t))}
                      activeType={typeFilter === "All" ? "" : typeFilter}
                    />
                    <View style={{ flex: 1 }}>
                      {typeDist.arcs.map((a) => (
                        <TouchableOpacity
                          key={a.type}
                          activeOpacity={0.85}
                          onPress={() => setTypeFilter((prev) => (prev === a.type ? "All" : a.type))}
                          style={[
                            s.legendRow,
                            typeFilter === a.type
                              ? { backgroundColor: isDark ? "#00000044" : "#FFFFFFAA" }
                              : null,
                          ]}
                        >
                          <View style={s.legendDot(accent, a.type)} />
                          <Text style={[s.legendText, { color: colors.text }]}>{a.type}</Text>
                          <Text style={[s.legendSub, { color: colors.subtext }]}>{a.pct}%</Text>
                        </TouchableOpacity>
                      ))}
                      <Text style={[s.hint, { marginTop: 8 }]}>Tap a type to filter the log.</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Key sessions */}
              <View style={s.panel}>
                <Text style={s.panelTitle}>Key sessions</Text>
                <View style={{ marginTop: 10, gap: 10 }}>
                  <KeySessionRow
                    icon="flag"
                    title="Longest run"
                    value={keySessions.longestRun ? `${keySessions.longestRun.distanceKm.toFixed(2)} km` : "—"}
                    sub={
                      keySessions.longestRun
                        ? `${fmtShort(new Date(keySessions.longestRun.when))} · ${formatMinSec(
                            keySessions.longestRun.movingTimeSec
                          )}`
                        : "No run logged"
                    }
                    colors={colors}
                    isDark={isDark}
                    onPress={() => keySessions.longestRun && router.push(`/me/activity/${keySessions.longestRun.id}`)}
                  />

                  <KeySessionRow
                    icon="zap"
                    title="Fastest pace run"
                    value={keySessions.fastestRun ? formatPace(keySessions.fastestRun.paceMinPerKm) : "—"}
                    sub={
                      keySessions.fastestRun
                        ? `${keySessions.fastestRun.distanceKm.toFixed(2)} km · ${fmtShort(
                            new Date(keySessions.fastestRun.when)
                          )}`
                        : "No paced run logged"
                    }
                    colors={colors}
                    isDark={isDark}
                    onPress={() => keySessions.fastestRun && router.push(`/me/activity/${keySessions.fastestRun.id}`)}
                  />

                  <KeySessionRow
                    icon="clock"
                    title="Longest session"
                    value={keySessions.longestSession ? formatMinSec(keySessions.longestSession.movingTimeSec) : "—"}
                    sub={
                      keySessions.longestSession
                        ? `${keySessions.longestSession.type} · ${fmtShort(
                            new Date(keySessions.longestSession.when)
                          )}`
                        : "No sessions logged"
                    }
                    colors={colors}
                    isDark={isDark}
                    onPress={() => keySessions.longestSession && router.push(`/me/activity/${keySessions.longestSession.id}`)}
                  />
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* WEEK LOG */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="calendar" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Week log</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.hint}>Grouped by day · Tap session to open · Hold for more detail.</Text>

            {groupedLog.every((g) => g.list.length === 0) ? (
              <Text style={[s.hint, { marginTop: 12 }]}>
                {weekActs.length ? "No sessions match this filter." : "No sessions logged (or no cached data yet)."}
              </Text>
            ) : (
              groupedLog.map((g) => (
                <View key={g.key} style={{ marginTop: 16 }}>
                  <TouchableOpacity activeOpacity={0.9} onPress={() => openDay(g.key)} style={s.dayHeader}>
                    <View>
                      <Text style={[s.dayHeaderTitle, { color: colors.text }]}>
                        {g.dow} {g.dom}
                      </Text>
                      <Text style={[s.dayHeaderSub, { color: colors.subtext }]}>
                        {g.list.length ? `${g.list.length} session${g.list.length === 1 ? "" : "s"}` : "Rest day"}
                      </Text>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      {g.list.length ? (
                        <>
                          <MiniStat
                            label="Time"
                            value={`${g.list.reduce((s2, a) => s2 + (a.movingTimeMin || 0), 0)}m`}
                            colors={colors}
                          />
                          <MiniStat
                            label="Run"
                            value={`${g.list
                              .filter((a) => a.type === "Run")
                              .reduce((s2, a) => s2 + (a.distanceKm || 0), 0)
                              .toFixed(1)}k`}
                            colors={colors}
                          />
                        </>
                      ) : null}
                      <Feather name="chevron-right" size={16} color={colors.subtext} />
                    </View>
                  </TouchableOpacity>

                  {g.list.length ? (
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {g.list.map((a) => {
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
                          <CompactActivityCard
                            key={a.id}
                            userName={displayName}
                            avatarUri={user?.photoURL || ""}
                            initial={initial}
                            accent={accent}
                            colors={colors}
                            isDark={isDark}
                            title={a.title}
                            subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                            notes={desc}
                            distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                            paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                            timeText={formatMinSec(a.movingTimeSec)}
                            showDistance={showDistance}
                            showPace={showPace}
                            onPress={() => router.push(`/me/activity/${a.id}`)}
                            onLongPress={() => fetchActivityDetailIfNeeded(a.id)}
                            loadingDetail={detailLoadingId === a.id}
                          />
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        <DaySheet
          open={daySheetOpen}
          onClose={() => setDaySheetOpen(false)}
          dayDate={selectedDayKey ? parseLocalKeyToDate(selectedDayKey) : null}
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
   Week bars
───────────────────────────────────────────── */
function WeekBars({ data, accent, colors, isDark, onDayPress, selectedKey }) {
  const anyRun = data.some((d) => Number(d.runKm || 0) > 0);
  const metricKey = anyRun ? "runKm" : "timeMin";
  const metricLabel = anyRun ? "km" : "min";

  const max = Math.max(...data.map((d) => Number(d[metricKey] || 0)), 0) || 1;

  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
        {data.map((d) => {
          const v = Number(d[metricKey] || 0);
          const h = clamp((v / max) * 86, 4, 86);
          const active = selectedKey && selectedKey === d.key;

          return (
            <TouchableOpacity
              key={d.key}
              activeOpacity={0.9}
              onPress={() => onDayPress?.(d.key)}
              style={{ flex: 1, alignItems: "center" }}
            >
              <Text style={{ fontSize: 11, fontWeight: "900", color: colors.subtext }}>
                {v ? (metricKey === "runKm" ? v.toFixed(1) : String(Math.round(v))) : "—"}
                <Text style={{ fontSize: 10, fontWeight: "800" }}> {metricLabel}</Text>
              </Text>

              <View
                style={{
                  marginTop: 8,
                  width: "100%",
                  borderRadius: 999,
                  height: 90,
                  justifyContent: "flex-end",
                  backgroundColor: isDark ? "#0B0C10" : "#ECEEF3",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: h,
                    width: "100%",
                    borderRadius: 999,
                    backgroundColor: accent,
                    opacity: v ? (active ? 0.95 : 0.75) : 0.25,
                  }}
                />
              </View>

              <Text style={{ marginTop: 8, fontSize: 12, fontWeight: "900", color: colors.text }}>
                {d.dow}
              </Text>
              <Text style={{ marginTop: 2, fontSize: 11, fontWeight: "800", color: colors.subtext }}>
                {d.dom}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Donut
───────────────────────────────────────────── */
function Donut({ arcs, accent, colors, isDark, onSlicePress, activeType }) {
  const size = 132;
  const rOuter = 56;
  const rInner = 36;
  const cx = size / 2;
  const cy = size / 2;

  // NOTE: no hooks inside components conditionally in RN; this is safe (always called).
  const palette = [
    accent,
    isDark ? "#7BFFEE" : "#2DD4BF",
    isDark ? "#B7A3FF" : "#8B5CF6",
    isDark ? "#FFB86B" : "#F59E0B",
    isDark ? "#7EA8FF" : "#3B82F6",
    isDark ? "#FF7AA2" : "#EF4444",
    isDark ? "#A9FF7A" : "#22C55E",
  ];

  const polar = (angle, radius) => {
    const a = (angle - 90) * (Math.PI / 180);
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };

  const arcPath = (startFrac, endFrac) => {
    const startAngle = startFrac * 360;
    const endAngle = endFrac * 360;
    const large = endAngle - startAngle > 180 ? 1 : 0;

    const p1 = polar(startAngle, rOuter);
    const p2 = polar(endAngle, rOuter);
    const p3 = polar(endAngle, rInner);
    const p4 = polar(startAngle, rInner);

    return [
      `M ${p1.x} ${p1.y}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y}`,
      `L ${p3.x} ${p3.y}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y}`,
      "Z",
    ].join(" ");
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {arcs.map((a, idx) => {
          const fill = palette[idx % palette.length];
          const active = activeType && activeType === a.type;
          const opacity = activeType ? (active ? 1 : 0.25) : 0.92;

          return (
            <G key={a.type}>
              <Path d={arcPath(a.start, a.end)} fill={fill} opacity={opacity} onPress={() => onSlicePress?.(a.type)} />
            </G>
          );
        })}

        <SvgText x={cx} y={cy - 2} textAnchor="middle" fontSize={12} fontWeight="900" fill={colors.text}>
          {activeType ? activeType : "All"}
        </SvgText>
        <SvgText x={cx} y={cy + 16} textAnchor="middle" fontSize={12} fontWeight="900" fill={colors.subtext}>
          Tap to filter
        </SvgText>
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Key session row
───────────────────────────────────────────── */
function KeySessionRow({ icon, title, value, sub, colors, isDark, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        backgroundColor: isDark ? "#0B0C10" : "#ECEEF3",
        borderRadius: 18,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 14,
          backgroundColor: isDark ? "#111217" : "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={16} color={colors.text} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 4 }}>{value}</Text>
        <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 4 }} numberOfLines={1}>
          {sub}
        </Text>
      </View>

      <Feather name="chevron-right" size={18} color={colors.subtext} />
    </TouchableOpacity>
  );
}

function MiniStat({ label, value, colors }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={{ color: colors.subtext, fontSize: 10, fontWeight: "900" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Activity card
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
      style={[
        cardStyles.wrap,
        { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card },
      ]}
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
   Day sheet modal
───────────────────────────────────────────── */
function DaySheet({
  open,
  onClose,
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
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pill label="Sessions" value={String(totals?.count || 0)} colors={colors} isDark={isDark} />
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
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No sessions on this day.</Text>
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
   UI helpers
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

    summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },

    panel: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    panelTitle: { fontSize: 13, fontWeight: "900", color: colors.text },
    panelAction: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: isDark ? "#18191E" : "#E6E7EC" },
    panelActionText: { fontSize: 12, fontWeight: "900", color: colors.text },

    legendRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, marginTop: 8 },
    legendDot: (accentColor) => ({ width: 10, height: 10, borderRadius: 5, backgroundColor: accentColor, opacity: 0.8 }),
    legendText: { fontSize: 13, fontWeight: "900", flex: 1 },
    legendSub: { fontSize: 12, fontWeight: "900" },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: { width: 28, height: 28, borderRadius: 12, backgroundColor: isDark ? "#18191E" : "#E6E7EC", alignItems: "center", justifyContent: "center" },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },
    refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.sapSilverMedium || colors.border, backgroundColor: colors.sapSilverLight || colors.card },

    dayHeader: {
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      borderRadius: 18,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      shadowColor: "#000",
      shadowOpacity: 0.07,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    dayHeaderTitle: { fontSize: 16, fontWeight: "900" },
    dayHeaderSub: { marginTop: 3, fontSize: 12, fontWeight: "800" },

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
