// app/(protected)/me/trends.jsx
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
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";

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
function startOfWeekMonday(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  x.setDate(x.getDate() + diff);
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
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
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
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  const now = new Date();
  const diffDays = Math.floor((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}
function safeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function toWeekLabel(weekStartDate) {
  return `Wk of ${weekStartDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
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
function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

/* ============================================================================
   Trends — weekly trend chart + rolling averages + breakdown
   - clean UI (no borders), clickable weeks to drill into activities
============================================================================ */
export default function TrendsPage() {
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
  const [rangeWeeks, setRangeWeeks] = useState(12); // 6 / 12 / 24

  // week drilldown modal
  const [weekOpen, setWeekOpen] = useState(false);
  const [selectedWeekKey, setSelectedWeekKey] = useState(null);

  // details cache (device + notes optional)
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState({});

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasToken(false);
        setActs([]);
        return;
      }
      setHasToken(true);

      // fetch enough for weekly analysis (range + buffer)
      const daysBack = rangeWeeks * 7 + 14;
      const after = Math.floor(addDays(new Date(), -daysBack).getTime() / 1000);

      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava trends load error", resp.status, text);
        setError("Couldn’t load Strava. Try reconnecting in Settings.");
        setActs([]);
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const mapped = safe.map((a) => {
        const distanceKm = (a.distance || 0) / 1000;
        const when = a.start_date_local || a.start_date;
        const type = normaliseType(a.type || "Workout");
        const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

        return {
          id: String(a.id),
          title: a.name || a.type || "Workout",
          type,
          rawType: a.type || "Workout",
          when,
          distanceKm,
          movingTimeMin: Math.round((a.moving_time || 0) / 60),
          movingTimeSec: Number(a.moving_time || 0),
          paceMinPerKm: pace,
          elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
          description: a.description || "",
          deviceName: a.device_name || "",
        };
      });

      mapped.sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : 0;
        const tb = b.when ? new Date(b.when).getTime() : 0;
        return tb - ta;
      });

      // keep only last N weeks (Monday-start)
      const thisWeekStart = startOfWeekMonday(new Date());
      const windowStart = addDays(thisWeekStart, -(rangeWeeks - 1) * 7);
      setActs(mapped.filter((a) => (a.when ? new Date(a.when).getTime() : 0) >= windowStart.getTime()));
    } catch (e) {
      console.error("Trends load error", e);
      setError("Couldn’t load trends. Try again.");
      setActs([]);
    } finally {
      setLoading(false);
    }
  }, [rangeWeeks]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const fetchDetailIfNeeded = useCallback(
    async (id) => {
      try {
        if (!id) return;
        if (detailCache[id]) return;

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) return;

        setDetailLoadingId(id);

        const resp = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) return;

        const detail = await resp.json();
        setDetailCache((prev) => ({ ...prev, [id]: detail }));
      } catch {
        // ignore
      } finally {
        setDetailLoadingId("");
      }
    },
    [detailCache]
  );

  /* ─────────────────────────────────────────────
     Weekly aggregation
  ────────────────────────────────────────────── */
  const weekly = useMemo(() => {
    const thisWeekStart = startOfWeekMonday(new Date());
    const start = addDays(thisWeekStart, -(rangeWeeks - 1) * 7);

    const by = {};
    for (let i = 0; i < rangeWeeks; i++) {
      const ws = addDays(start, i * 7);
      const key = isoKey(ws);
      by[key] = {
        key,
        weekStart: ws,
        timeMin: 0,
        runKm: 0,
        runTimeMin: 0,
        strengthMin: 0,
        count: 0,
      };
    }

    acts.forEach((a) => {
      if (!a.when) return;
      const d = startOfDay(new Date(a.when));
      const ws = startOfWeekMonday(d);
      const k = isoKey(ws);
      if (!by[k]) return;

      by[k].count += 1;
      by[k].timeMin += safeNum(a.movingTimeMin);

      if (a.type === "Run") {
        by[k].runKm += safeNum(a.distanceKm);
        by[k].runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") {
        by[k].strengthMin += safeNum(a.movingTimeMin);
      }
    });

    const series = Object.values(by).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
    const maxTime = Math.max(...series.map((w) => w.timeMin), 0);

    const roll = series.map((w, idx) => {
      const from = Math.max(0, idx - 3);
      const slice = series.slice(from, idx + 1);
      const avgTime = slice.reduce((s, x) => s + x.timeMin, 0) / slice.length;
      const avgRun = slice.reduce((s, x) => s + x.runKm, 0) / slice.length;
      return { ...w, avgTime, avgRun };
    });

    return { series: roll, maxTime: Math.max(1, maxTime) };
  }, [acts, rangeWeeks]);

  /* ─────────────────────────────────────────────
     Week selection + activities in that week
  ────────────────────────────────────────────── */
  const onWeekPress = useCallback((w) => {
    setSelectedWeekKey(w.key);
    setWeekOpen(true);
  }, []);

  const selectedWeekObj = useMemo(() => {
    if (!selectedWeekKey) return null;
    return weekly.series.find((w) => w.key === selectedWeekKey) || null;
  }, [weekly.series, selectedWeekKey]);

  const selectedWeekActivities = useMemo(() => {
    if (!selectedWeekObj) return [];
    const start = selectedWeekObj.weekStart.getTime();
    const end = addDays(selectedWeekObj.weekStart, 7).getTime();
    return acts
      .filter((a) => {
        const t = a.when ? new Date(a.when).getTime() : 0;
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, selectedWeekObj]);

  const topSummary = useMemo(() => {
    const last = weekly.series[weekly.series.length - 1];
    const prev = weekly.series[weekly.series.length - 2];
    if (!last) return null;

    const deltaTime = prev ? last.timeMin - prev.timeMin : 0;
    const deltaRun = prev ? last.runKm - prev.runKm : 0;

    const runShare = (last.runTimeMin / Math.max(1, last.timeMin)) * 100;
    const strengthShare = (last.strengthMin / Math.max(1, last.timeMin)) * 100;

    return { last, deltaTime, deltaRun, runShare, strengthShare };
  }, [weekly.series]);

  const rangeLabel = useMemo(() => {
    if (rangeWeeks === 6) return "Last 6 weeks";
    if (rangeWeeks === 12) return "Last 12 weeks";
    return "Last 24 weeks";
  }, [rangeWeeks]);

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
                  <Text style={s.heroBadge}>TRENDS</Text>
                  <Text style={s.heroName}>Weekly trends</Text>
                  <Text style={s.heroSub}>
                    {rangeLabel} · Strava: {hasToken ? "Connected" : "Not connected"}
                  </Text>
                </View>
              </View>

              {/* RANGE TOGGLE */}
              <View style={{ marginTop: 12 }}>
                <RangeToggle
                  value={rangeWeeks}
                  onChange={setRangeWeeks}
                  accent={accent}
                  colors={colors}
                  isDark={isDark}
                  options={[
                    { key: 6, label: "6w" },
                    { key: 12, label: "12w" },
                    { key: 24, label: "24w" },
                  ]}
                />
              </View>

              {/* CHART */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>Minutes per week</Text>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const last = weekly.series[weekly.series.length - 1];
                      if (last) onWeekPress(last);
                    }}
                    style={s.chartAction}
                  >
                    <Text style={s.chartActionText}>Open latest</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasToken ? (
                  <Text style={s.hint}>Connect Strava to see trends.</Text>
                ) : (
                  <>
                    <WeeklyBarsWithAvgLine
                      data={weekly.series}
                      maxBars={weekly.maxTime}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onWeekPress={onWeekPress}
                      activeKey={selectedWeekKey}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>
                      Bars = total minutes · Line = 4-week avg · Tap a week to drill in
                    </Text>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}
              </View>

              {!hasToken ? (
                <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                  <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </LinearGradient>

          {/* DETAIL / SUMMARY CARDS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="trending-up" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>This week</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            {topSummary ? (
              <>
                <View style={s.grid}>
                  <InsightCard
                    title="Time"
                    value={formatHoursMin(topSummary.last.timeMin)}
                    sub={`${topSummary.deltaTime >= 0 ? "+" : ""}${Math.round(topSummary.deltaTime)} min vs last wk`}
                    s={s}
                  />
                  <InsightCard
                    title="Run km"
                    value={topSummary.last.runKm.toFixed(1)}
                    sub={`${topSummary.deltaRun >= 0 ? "+" : ""}${topSummary.deltaRun.toFixed(1)} km vs last wk`}
                    s={s}
                  />
                  <InsightCard
                    title="Sessions"
                    value={String(topSummary.last.count)}
                    sub={toWeekLabel(topSummary.last.weekStart)}
                    s={s}
                  />
                  <InsightCard
                    title="Strength"
                    value={formatHoursMin(topSummary.last.strengthMin)}
                    sub={`${fmtPct(topSummary.strengthShare)} of total`}
                    s={s}
                  />
                </View>

                <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Split</Text>
                <View style={s.splitWrap}>
                  <SplitRow
                    label="Running"
                    pct={fmtPct(topSummary.runShare)}
                    value={formatHoursMin(topSummary.last.runTimeMin)}
                    colors={colors}
                  />
                  <SplitRow
                    label="Strength"
                    pct={fmtPct(topSummary.strengthShare)}
                    value={formatHoursMin(topSummary.last.strengthMin)}
                    colors={colors}
                  />
                  <SplitRow
                    label="Other"
                    pct={fmtPct(
                      ((topSummary.last.timeMin - topSummary.last.runTimeMin - topSummary.last.strengthMin) /
                        Math.max(1, topSummary.last.timeMin)) *
                        100
                    )}
                    value={formatHoursMin(
                      topSummary.last.timeMin - topSummary.last.runTimeMin - topSummary.last.strengthMin
                    )}
                    colors={colors}
                  />
                </View>

                <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Trend note</Text>
                <View style={s.noteWrap}>
                  <TrendNote weekly={weekly.series} colors={colors} />
                </View>
              </>
            ) : (
              <Text style={s.hint}>No weekly trend data yet.</Text>
            )}

            {/* Quick actions */}
            <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push("/record")}
                style={[s.cta, { backgroundColor: accent, flex: 1 }]}
              >
                <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                <Text style={[s.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add session</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push("/me/insights")}
                style={[
                  s.cta,
                  {
                    flex: 1,
                    backgroundColor: "transparent",
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: isDark ? "rgba(255,255,255,0.18)" : "#D8DCE5",
                  },
                ]}
              >
                <Feather name="bar-chart-2" size={16} color={colors.text} />
                <Text style={[s.ctaText, { color: colors.text }]}>Insights</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* WEEK MODAL */}
        <WeekSheet
          open={weekOpen}
          onClose={() => setWeekOpen(false)}
          week={selectedWeekObj}
          activities={selectedWeekActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          onOpenActivity={(id) => router.push(`/me/activity/${id}`)}
          onPeekDetail={fetchDetailIfNeeded}
          detailCache={detailCache}
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
   Weekly bars + rolling avg line (clickable)
   ✅ FIX: no <View> inside <Svg> (invalid). Use <G>.
───────────────────────────────────────────── */
function WeeklyBarsWithAvgLine({ data, maxBars, accent, colors, isDark, onWeekPress, activeKey }) {
  const screenW = Dimensions.get("window").width;
  const W = Math.min(390, Math.max(320, screenW - 36));
  const H = 190;

  const padTop = 16;
  const padBottom = 26;
  const padLeft = 6;
  const padRight = 44;

  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const barW = innerW / Math.max(1, data.length);
  const barGap = Math.max(1, Math.round(barW * 0.2));
  const barInnerW = Math.max(2, barW - barGap);

  const xForBar = (i) => padLeft + i * barW + barGap / 2;
  const yForBar = (v) => {
    const t = clamp(Number(v || 0) / Math.max(1, maxBars), 0, 1);
    return padTop + (1 - t) * innerH;
  };
  const baseY = padTop + innerH;

  const xForLine = (i) => {
    if (data.length <= 1) return padLeft + innerW;
    return padLeft + (i * innerW) / (data.length - 1);
  };
  const yForLine = (v) => {
    const t = clamp(Number(v || 0) / Math.max(1, maxBars), 0, 1);
    return padTop + (1 - t) * innerH;
  };

  const lineD = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForLine(i).toFixed(2)} ${yForLine(p.avgTime).toFixed(2)}`)
    .join(" ");

  const midY = padTop + innerH * 0.5;

  const labelIdxs = useMemo(() => {
    const out = new Set([0, data.length - 1]);
    const step = Math.round(data.length / 4);
    if (step > 0) for (let i = 0; i < data.length; i += step) out.add(i);
    return Array.from(out).sort((a, b) => a - b);
  }, [data.length]);

  const activeIndex = activeKey ? data.findIndex((d) => d.key === activeKey) : -1;

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

        {/* Bars */}
        {data.map((p, i) => {
          const x = xForBar(i);
          const y = yForBar(p.timeMin);
          const active = i === activeIndex;

          return (
            <G key={p.key}>
              <Path
                d={`M ${x} ${baseY} L ${x} ${y} L ${x + barInnerW} ${y} L ${x + barInnerW} ${baseY} Z`}
                fill={isDark ? "#20222B" : "#E6E7EC"}
                opacity={active ? 1 : 0.9}
              />

              {/* hit area */}
              <Circle
                cx={x + barInnerW / 2}
                cy={padTop + innerH / 2}
                r={Math.max(14, barInnerW)}
                fill="transparent"
                onPress={() => onWeekPress?.(p)}
              />
            </G>
          );
        })}

        {/* Rolling avg line */}
        <Path d={lineD} stroke={accent} strokeWidth={3} fill="none" />

        {/* Active marker + tooltip */}
        {activeIndex >= 0 ? (
          (() => {
            const p = data[activeIndex];
            const ax = xForLine(activeIndex);
            const ay = yForLine(p.avgTime);
            const tip = `${toWeekLabel(p.weekStart)} • ${Math.round(p.timeMin)} min`;

            return (
              <G>
                <Circle cx={ax} cy={ay} r={12} fill={accent} opacity={0.18} />
                <Circle cx={ax} cy={ay} r={6} fill={accent} />
                <SvgText
                  x={clamp(ax, padLeft + 90, padLeft + innerW - 10)}
                  y={clamp(ay - 12, padTop + 12, baseY - 12)}
                  fontSize={12}
                  fontWeight="900"
                  fill={colors.text}
                  textAnchor="middle"
                >
                  {tip}
                </SvgText>
              </G>
            );
          })()
        ) : null}

        {/* Right axis labels */}
        <SvgText x={padLeft + innerW + 8} y={padTop + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {Math.round(maxBars)}m
        </SvgText>
        <SvgText x={padLeft + innerW + 8} y={midY + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {Math.round(maxBars * 0.5)}m
        </SvgText>
        <SvgText x={padLeft + innerW + 8} y={baseY + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          0
        </SvgText>

        {/* X labels */}
        {labelIdxs.map((i) => (
          <SvgText
            key={`tick-${i}`}
            x={xForLine(i)}
            y={H - 6}
            fontSize={12}
            fontWeight="800"
            fill={colors.subtext}
            textAnchor="middle"
          >
            {data[i]?.weekStart?.getDate?.() || ""}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week sheet — shows activities + hides distance/pace if missing
   Keeps your stat value size (16)
───────────────────────────────────────────── */
function WeekSheet({
  open,
  onClose,
  week,
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

  const title = useMemo(() => {
    if (!week?.weekStart) return "Week";
    const start = week.weekStart;
    const end = addDays(start, 6);
    return `${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString(
      "en-GB",
      { day: "2-digit", month: "short" }
    )}`;
  }, [week]);

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
                {week ? `${week.count} sessions · ${formatHoursMin(week.timeMin)}` : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {week ? (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pill label="Time" value={formatHoursMin(week.timeMin)} colors={colors} isDark={isDark} />
              <Pill label="Run km" value={week.runKm.toFixed(1)} colors={colors} isDark={isDark} />
              <Pill label="Strength" value={formatHoursMin(week.strengthMin)} colors={colors} isDark={isDark} />
            </View>
          ) : null}
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

function TrendNote({ weekly, colors }) {
  if (!weekly || weekly.length < 8) {
    return (
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "700" }}>
        Add a few weeks to see trends.
      </Text>
    );
  }
  const last4 = weekly.slice(-4);
  const prev4 = weekly.slice(-8, -4);

  const a = last4.reduce((s, w) => s + w.timeMin, 0) / 4;
  const b = prev4.reduce((s, w) => s + w.timeMin, 0) / 4;
  const delta = a - b;
  const pct = (delta / Math.max(1, b)) * 100;

  const msg =
    delta > 10
      ? `Your last 4-week average is up ${Math.round(delta)} min/week (${fmtPct(pct)}). Nice build — keep it steady.`
      : delta < -10
      ? `Your last 4-week average is down ${Math.round(Math.abs(delta))} min/week (${fmtPct(Math.abs(pct))}). If that’s unplanned, add 1 easy session.`
      : `Your volume is steady over the last 8 weeks. Great base — progress in small steps.`;

  return <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "700" }}>{msg}</Text>;
}

/* ─────────────────────────────────────────────
   UI bits
───────────────────────────────────────────── */
function RangeToggle({ value, onChange, options, accent, colors, isDark }) {
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

function InsightCard({ title, value, sub, s }) {
  return (
    <View style={s.insightCard}>
      <Text style={s.insightTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={s.insightValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.insightSub} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

function SplitRow({ label, pct, value, colors }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 }}>
      <Text style={{ color: colors.text, fontWeight: "900" }}>{label}</Text>
      <Text style={{ color: colors.subtext, fontWeight: "900" }}>
        {pct} · {value}
      </Text>
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
   Compact Activity Card (keeps your stat value size 16)
   - hides distance/pace if missing
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
    chartAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },
    chartActionText: { fontSize: 12, fontWeight: "900", color: colors.text },

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
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      backgroundColor: colors.sapSilverLight || colors.card,
    },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },

    grid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },
    insightCard: {
      width: "48%",
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    insightTitle: { color: colors.subtext, fontSize: 12, fontWeight: "900" },
    insightValue: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 },
    insightSub: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6 },

    sectionMiniTitle: { marginTop: 10, color: colors.text, fontSize: 13, fontWeight: "900" },
    splitWrap: { marginTop: 10, backgroundColor: isDark ? "#111217" : "#F3F4F6", borderRadius: 18, paddingHorizontal: 14 },
    noteWrap: { marginTop: 10, backgroundColor: isDark ? "#111217" : "#F3F4F6", borderRadius: 18, padding: 14 },

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
