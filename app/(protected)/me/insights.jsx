// app/(protected)/me/insights.jsx
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
function isoKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
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
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
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
  if (Number.isNaN(d.getTime())) return "";
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
function safeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ============================================================================
   Insights — training insight + patterns (Strava-backed)
============================================================================ */
export default function InsightsPage() {
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
  const [rangeDays, setRangeDays] = useState(28); // 7/28/90

  // day tap on chart
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

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

      const after = Math.floor(daysAgo(Math.max(7, rangeDays + 7)).getTime() / 1000); // extra buffer
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava insights load error", resp.status, text);
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

      // keep only range window for analysis (end = today)
      const cut = startOfDay(daysAgo(rangeDays - 1)).getTime();
      setActs(mapped.filter((a) => (a.when ? new Date(a.when).getTime() : 0) >= cut));
    } catch (e) {
      console.error("Insights load error", e);
      setError("Couldn’t load insight data. Try again.");
      setActs([]);
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

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
     Daily series for chart
     - Bars: total minutes
     - Line: run km
  ────────────────────────────────────────────── */
  const dailySeries = useMemo(() => {
    const by = {};
    acts.forEach((a) => {
      if (!a.when) return;
      const k = isoKey(a.when);
      if (!k) return;
      if (!by[k]) by[k] = { timeMin: 0, runKm: 0, count: 0, strengthMin: 0 };
      by[k].count += 1;
      by[k].timeMin += safeNum(a.movingTimeMin);
      if (a.type === "Run") by[k].runKm += safeNum(a.distanceKm);
      if (a.type === "Strength") by[k].strengthMin += safeNum(a.movingTimeMin);
    });

    const start = startOfDay(daysAgo(rangeDays - 1));
    const out = [];
    for (let i = 0; i < rangeDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = isoKey(d);
      out.push({
        key: k,
        dateObj: d,
        label: i === 0 || i === rangeDays - 1 ? d.getDate().toString() : "",
        timeMin: by[k]?.timeMin || 0,
        runKm: by[k]?.runKm || 0,
        count: by[k]?.count || 0,
        strengthMin: by[k]?.strengthMin || 0,
      });
    }
    return out;
  }, [acts, rangeDays]);

  const chart = useMemo(() => {
    const maxTime = Math.max(...dailySeries.map((d) => d.timeMin), 0);
    const maxRun = Math.max(...dailySeries.map((d) => d.runKm), 0);
    return {
      maxTime: Math.max(1, maxTime),
      maxRun: Math.max(1, maxRun),
    };
  }, [dailySeries]);

  /* ─────────────────────────────────────────────
     Insights calculations
  ────────────────────────────────────────────── */
  const insights = useMemo(() => {
    const totalActs = acts.length;
    const totalTimeMin = acts.reduce((s, a) => s + safeNum(a.movingTimeMin), 0);

    const runActs = acts.filter((a) => a.type === "Run");
    const runKm = runActs.reduce((s, a) => s + safeNum(a.distanceKm), 0);
    const runTimeMin = runActs.reduce((s, a) => s + safeNum(a.movingTimeMin), 0);

    const strengthActs = acts.filter((a) => a.type === "Strength");
    const strengthMin = strengthActs.reduce((s, a) => s + safeNum(a.movingTimeMin), 0);

    const otherMin = totalTimeMin - runTimeMin - strengthMin;

    // frequency
    const daysWithTraining = new Set(acts.map((a) => isoKey(a.when)).filter(Boolean)).size;
    const sessionsPerWeek = rangeDays > 0 ? (totalActs / rangeDays) * 7 : 0;

    // consistency streak (up to today)
    const trainedDays = new Set(dailySeries.filter((d) => d.count > 0).map((d) => d.key));
    let streak = 0;
    for (let i = 0; i < rangeDays; i++) {
      const k = isoKey(daysAgo(i));
      if (trainedDays.has(k)) streak += 1;
      else break;
    }

    // best week in range (time minutes)
    let bestWeekMin = 0;
    let bestWeekStart = null;
    for (let i = 0; i <= rangeDays - 7; i++) {
      const sum = dailySeries.slice(i, i + 7).reduce((s, x) => s + safeNum(x.timeMin), 0);
      if (sum > bestWeekMin) {
        bestWeekMin = sum;
        bestWeekStart = dailySeries[i]?.dateObj || null;
      }
    }

    // weekday pattern
    const byDow = Array.from({ length: 7 }, (_, idx) => ({ idx, count: 0, timeMin: 0, runKm: 0 }));
    dailySeries.forEach((d) => {
      const dow = d.dateObj.getDay(); // 0 Sun
      byDow[dow].count += d.count;
      byDow[dow].timeMin += d.timeMin;
      byDow[dow].runKm += d.runKm;
    });
    const peakDay = [...byDow].sort((a, b) => b.timeMin - a.timeMin)[0];

    // intensity proxy (run pace buckets)
    const pacedRuns = runActs
      .map((r) => ({ pace: r.paceMinPerKm, minutes: r.movingTimeMin }))
      .filter((x) => Number.isFinite(x.pace) && x.pace > 0 && x.minutes > 0);

    // buckets: easy (>5:15), steady (4:30–5:15), hard (<4:30)
    let easyMin = 0,
      steadyMin = 0,
      hardMin = 0;
    pacedRuns.forEach((x) => {
      if (x.pace > 5.25) easyMin += x.minutes;
      else if (x.pace >= 4.5) steadyMin += x.minutes;
      else hardMin += x.minutes;
    });
    const pacedTotal = easyMin + steadyMin + hardMin || 1;

    const recs = [];
    if (sessionsPerWeek < 3) recs.push("Build consistency: aim for 3–4 sessions/week.");
    if (runKm > 0 && hardMin / pacedTotal > 0.35)
      recs.push("A lot of hard running — keep most runs easy to recover.");
    if (runKm > 0 && easyMin / pacedTotal < 0.45)
      recs.push("Add more easy minutes to support speed gains.");
    if (strengthMin < 60 && rangeDays >= 28) recs.push("Strength is light — 2 short sessions/week would help.");
    if (!recs.length) recs.push("You’re well balanced — keep the routine and progress gradually.");

    return {
      totalActs,
      totalTimeMin,
      runKm,
      runActs: runActs.length,
      runTimeMin,
      strengthActs: strengthActs.length,
      strengthMin,
      otherMin,
      daysWithTraining,
      sessionsPerWeek,
      streak,
      bestWeekMin,
      bestWeekStart,
      peakDay,
      easyMin,
      steadyMin,
      hardMin,
      recs,
    };
  }, [acts, dailySeries, rangeDays]);

  /* ─────────────────────────────────────────────
     Day modal data
  ────────────────────────────────────────────── */
  const selectedDayActivities = useMemo(() => {
    if (!selectedDayKey) return [];
    return acts
      .filter((a) => isoKey(a.when) === selectedDayKey)
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, selectedDayKey]);

  const selectedDayTotals = useMemo(() => {
    const list = selectedDayActivities;
    const timeMin = list.reduce((s, x) => s + safeNum(x.movingTimeMin), 0);
    const runKm = list.filter((x) => x.type === "Run").reduce((s, x) => s + safeNum(x.distanceKm), 0);
    return { timeMin, runKm, count: list.length };
  }, [selectedDayActivities]);

  const onBarPress = useCallback((p) => {
    setSelectedDayKey(p.key);
    setDayOpen(true);
  }, []);

  const rangeLabel = useMemo(() => {
    if (rangeDays === 7) return "This week";
    if (rangeDays === 28) return "Last 28 days";
    return "Last 90 days";
  }, [rangeDays]);

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
                  <Text style={s.heroBadge}>INSIGHTS</Text>
                  <Text style={s.heroName}>Training insights</Text>
                  <Text style={s.heroSub}>
                    {rangeLabel} · Strava: {hasToken ? "Connected" : "Not connected"}
                  </Text>
                </View>
              </View>

              {/* RANGE TOGGLE */}
              <View style={{ marginTop: 12 }}>
                <RangeToggle
                  value={rangeDays}
                  onChange={setRangeDays}
                  accent={accent}
                  colors={colors}
                  isDark={isDark}
                  options={[
                    { key: 7, label: "7d" },
                    { key: 28, label: "28d" },
                    { key: 90, label: "90d" },
                  ]}
                />
              </View>

              {/* CHART */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>Training load</Text>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const todayKey = isoKey(new Date());
                      setSelectedDayKey(todayKey);
                      setDayOpen(true);
                    }}
                    style={s.chartAction}
                  >
                    <Text style={s.chartActionText}>Open today</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasToken ? (
                  <Text style={s.hint}>Connect Strava to see insights.</Text>
                ) : (
                  <>
                    <CleanBarsWithLine
                      data={dailySeries}
                      maxBars={chart.maxTime}
                      maxLine={chart.maxRun}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onBarPress={onBarPress}
                      activeKey={selectedDayKey}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>
                      Bars = total minutes · Line = run km · Tap a day for details
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

          {/* INSIGHT CARDS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="bar-chart-2" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Overview</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={s.grid}>
              <InsightCard
                title="Sessions"
                value={String(insights.totalActs)}
                sub={`${insights.daysWithTraining} days trained`}
                s={s}
              />
              <InsightCard
                title="Time"
                value={formatHoursMin(insights.totalTimeMin)}
                sub={`${insights.sessionsPerWeek.toFixed(1)}/week`}
                s={s}
              />
              <InsightCard title="Run km" value={insights.runKm.toFixed(1)} sub={`${insights.runActs} runs`} s={s} />
              <InsightCard title="Streak" value={`${insights.streak} days`} sub="Up to today" s={s} />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Distribution</Text>
            <View style={s.splitWrap}>
              <SplitRow
                label="Running"
                pct={fmtPct((insights.runTimeMin / Math.max(1, insights.totalTimeMin)) * 100)}
                value={formatHoursMin(insights.runTimeMin)}
                colors={colors}
              />
              <SplitRow
                label="Strength"
                pct={fmtPct((insights.strengthMin / Math.max(1, insights.totalTimeMin)) * 100)}
                value={formatHoursMin(insights.strengthMin)}
                colors={colors}
              />
              <SplitRow
                label="Other"
                pct={fmtPct((insights.otherMin / Math.max(1, insights.totalTimeMin)) * 100)}
                value={formatHoursMin(insights.otherMin)}
                colors={colors}
              />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Running intensity (pace proxy)</Text>
            <View style={s.splitWrap}>
              <SplitRow
                label="Easy"
                pct={fmtPct(
                  (insights.easyMin / Math.max(1, insights.easyMin + insights.steadyMin + insights.hardMin)) * 100
                )}
                value={formatHoursMin(insights.easyMin)}
                colors={colors}
              />
              <SplitRow
                label="Steady"
                pct={fmtPct(
                  (insights.steadyMin / Math.max(1, insights.easyMin + insights.steadyMin + insights.hardMin)) * 100
                )}
                value={formatHoursMin(insights.steadyMin)}
                colors={colors}
              />
              <SplitRow
                label="Hard"
                pct={fmtPct(
                  (insights.hardMin / Math.max(1, insights.easyMin + insights.steadyMin + insights.hardMin)) * 100
                )}
                value={formatHoursMin(insights.hardMin)}
                colors={colors}
              />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Patterns</Text>
            <View style={s.patternWrap}>
              <PatternTile
                title="Peak day"
                value={insights.peakDay ? DOW[insights.peakDay.idx] : "—"}
                sub={insights.peakDay ? `${Math.round(insights.peakDay.timeMin)} min` : ""}
                colors={colors}
                isDark={isDark}
              />
              <PatternTile
                title="Best week"
                value={insights.bestWeekMin ? formatHoursMin(insights.bestWeekMin) : "—"}
                sub={
                  insights.bestWeekStart
                    ? `From ${insights.bestWeekStart.toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })}`
                    : ""
                }
                colors={colors}
                isDark={isDark}
              />
              <PatternTile
                title="Avg run pace"
                value={(() => {
                  const runOnly = acts.filter((a) => a.type === "Run" && a.distanceKm > 0 && a.movingTimeSec > 0);
                  const totalKm = runOnly.reduce((s, a) => s + a.distanceKm, 0);
                  const totalSec = runOnly.reduce((s, a) => s + a.movingTimeSec, 0);
                  return formatPace(paceMinPerKm(totalKm, totalSec));
                })()}
                sub="Weighted by distance"
                colors={colors}
                isDark={isDark}
              />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Coaching notes</Text>
            <View style={s.recsWrap}>
              {insights.recs.map((r, idx) => (
                <View key={idx} style={s.recRow}>
                  <View style={s.bullet} />
                  <Text style={s.recText}>{r}</Text>
                </View>
              ))}
            </View>

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
                onPress={() => router.push("/me/month")}
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
                <Feather name="calendar" size={16} color={colors.text} />
                <Text style={[s.ctaText, { color: colors.text }]}>Month</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* DAY MODAL */}
        <DaySheet
          open={dayOpen}
          onClose={() => setDayOpen(false)}
          dayDate={selectedDayKey ? new Date(selectedDayKey) : null}
          totals={selectedDayTotals}
          activities={selectedDayActivities}
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
   Clean clickable bars + line chart
   - Bars: minutes
   - Line: run km
   FIX: no <View> inside <Svg> (use <G>)
───────────────────────────────────────────── */
function CleanBarsWithLine({ data, maxBars, maxLine, accent, colors, isDark, onBarPress, activeKey }) {
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
    const t = clamp(Number(v || 0) / Math.max(1, maxLine), 0, 1);
    return padTop + (1 - t) * innerH;
  };

  const lineD = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForLine(i).toFixed(2)} ${yForLine(p.runKm).toFixed(2)}`)
    .join(" ");

  const midY = padTop + innerH * 0.5;

  const labelIdxs = useMemo(() => {
    const out = new Set([0, Math.max(0, data.length - 1)]);
    const step = Math.max(1, Math.round(data.length / 4));
    for (let i = 0; i < data.length; i += step) out.add(i);
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
          const h = baseY - y;
          const active = i === activeIndex;

          // Make the hit target cover the bar area
          const hitCx = x + barInnerW / 2;
          const hitCy = y + h / 2;
          const hitR = Math.max(12, barInnerW * 0.9);

          return (
            <G key={p.key}>
              <Path
                d={`M ${x} ${baseY} L ${x} ${y} L ${x + barInnerW} ${y} L ${x + barInnerW} ${baseY} Z`}
                fill={isDark ? "#20222B" : "#E6E7EC"}
                opacity={active ? 1 : 0.92}
              />
              <Circle cx={hitCx} cy={hitCy} r={hitR} fill="transparent" onPress={() => onBarPress?.(p)} />
            </G>
          );
        })}

        {/* Line */}
        <Path d={lineD} stroke={accent} strokeWidth={3} fill="none" />

        {/* Active marker */}
        {activeIndex >= 0 ? (
          (() => {
            const p = data[activeIndex];
            const ax = xForLine(activeIndex);
            const ay = yForLine(p.runKm);
            const tip = `${p.dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} • ${Math.round(
              p.timeMin
            )} min • ${p.runKm.toFixed(1)} km`;

            return (
              <G>
                <Circle cx={ax} cy={ay} r={12} fill={accent} opacity={0.18} />
                <Circle cx={ax} cy={ay} r={6} fill={accent} />
                <SvgText
                  x={clamp(ax, padLeft + 80, padLeft + innerW - 10)}
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
            {data[i]?.dateObj?.getDate?.() || ""}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Day Sheet (normal sized cards + hide distance/pace if missing)
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
   Components
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

function PatternTile({ title, value, sub, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 18,
        padding: 14,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
      }}
    >
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6 }} numberOfLines={1}>
        {sub}
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
   Compact Activity Card
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
    splitWrap: {
      marginTop: 10,
      backgroundColor: isDark ? "#111217" : "#F3F4F6",
      borderRadius: 18,
      paddingHorizontal: 14,
    },

    patternWrap: { marginTop: 10, flexDirection: "row", gap: 10 },

    recsWrap: {
      marginTop: 10,
      backgroundColor: isDark ? "#111217" : "#F3F4F6",
      borderRadius: 18,
      padding: 14,
    },
    recRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
    bullet: { width: 8, height: 8, borderRadius: 999, backgroundColor: accent, marginTop: 6 },
    recText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },

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
