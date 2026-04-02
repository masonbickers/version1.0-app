// app/(protected)/me.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path as SvgPath } from "react-native-svg";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const PRIMARY = "#E6FF3B";
const STRAVA_CACHE_KEY = "strava_cached_activities_v1";
const STRENGTH_TYPES = new Set([
  "workout",
  "weighttraining",
  "crossfit",
  "strengthtraining",
  "gymworkout",
]);

const QUICK_LINKS = [
  { key: "month", icon: "calendar", label: "Monthly summary", path: "/me/month" },
  { key: "week", icon: "bar-chart-2", label: "This week", path: "/me/this-week" },
  { key: "trends", icon: "trending-up", label: "Trends", path: "/me/trends" },
  { key: "insights", icon: "activity", label: "Insights", path: "/me/insights" },
  { key: "consistency", icon: "check-circle", label: "Consistency", path: "/me/consistency" },
  { key: "journal", icon: "book-open", label: "Journal", path: "/journal/history" },
  { key: "stats", icon: "pie-chart", label: "Stats", path: "/me/stats" },
  { key: "goals", icon: "target", label: "Goals", path: "/me/goals" },
  { key: "prs", icon: "award", label: "PRs", path: "/me/prs" },
  { key: "calendar", icon: "clock", label: "Calendar", path: "/me/calendar" },
];

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatKm(value) {
  return toNum(value, 0).toFixed(1);
}

function formatMinutesAsHm(value) {
  const mins = Math.max(0, Math.round(toNum(value, 0)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatDateShort(ms) {
  if (!ms) return "Unknown";
  try {
    return new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "Unknown";
  }
}

function formatPaceMinPerKm(value) {
  const paceMin = toNum(value, 0);
  if (!paceMin || paceMin <= 0) return "";
  let mins = Math.floor(paceMin);
  let secs = Math.round((paceMin - mins) * 60);
  if (secs === 60) {
    mins += 1;
    secs = 0;
  }
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

function resolveAvgPaceMinPerKm(activity) {
  const direct = toNum(
    activity?.avgPaceMinPerKm ??
      activity?.paceMinPerKm ??
      activity?.averagePaceMinPerKm,
    0
  );
  if (direct > 0) return direct;

  const distanceKm = toNum(activity?.distanceKm, 0);
  const movingTimeMin = toNum(activity?.movingTimeMin, 0);
  if (distanceKm > 0 && movingTimeMin > 0) return movingTimeMin / distanceKm;
  return 0;
}

function resolveAverageHeartRate(activity) {
  const hr = toNum(
    activity?.averageHeartrate ??
      activity?.avgHeartrate ??
      activity?.average_hr ??
      activity?.average_heartrate ??
      activity?.avg_hr,
    0
  );
  if (hr <= 0) return 0;
  return Math.round(hr);
}

function resolveSummaryPolyline(activity) {
  const polyline =
    activity?.summaryPolyline ||
    activity?.mapSummaryPolyline ||
    activity?.map?.summary_polyline ||
    activity?.map?.polyline ||
    "";
  const raw = String(polyline || "").trim();
  return raw.length >= 5 ? raw : "";
}

function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const points = [];

  while (index < len) {
    let shift = 0;
    let result = 0;
    let b;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return points;
}

function buildRoutePath(polyline, width = 92, height = 44, padding = 4) {
  const points = decodePolyline(polyline);
  if (points.length < 2) return "";

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }

  const lngRange = Math.max(maxLng - minLng, 1e-9);
  const latRange = Math.max(maxLat - minLat, 1e-9);
  const innerW = Math.max(width - padding * 2, 1);
  const innerH = Math.max(height - padding * 2, 1);

  const routeAspect = lngRange / latRange;
  const boxAspect = innerW / innerH;

  let scale;
  let offsetX = padding;
  let offsetY = padding;

  if (routeAspect >= boxAspect) {
    scale = innerW / lngRange;
    const usedH = latRange * scale;
    offsetY = padding + (innerH - usedH) / 2;
  } else {
    scale = innerH / latRange;
    const usedW = lngRange * scale;
    offsetX = padding + (innerW - usedW) / 2;
  }

  const path = points
    .map((p, index) => {
      const x = offsetX + (p.longitude - minLng) * scale;
      const y = offsetY + (maxLat - p.latitude) * scale;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return path;
}

function RoutePreview({ polyline, accent, colors, isDark }) {
  const width = 92;
  const height = 44;
  const path = useMemo(() => buildRoutePath(polyline, width, height, 4), [polyline]);

  if (!path) return null;

  return (
    <View
      style={[
        s.routePreviewWrap,
        {
          borderColor: colors.border,
          backgroundColor: isDark ? "#0F1218" : "#F4F6FA",
        },
      ]}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <SvgPath
          d={path}
          fill="none"
          stroke={accent}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function dayKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function deriveDashboard(activities) {
  const now = Date.now();
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartMs = monthStart.getTime();

  let weekRuns = 0;
  let weekWorkouts = 0;
  let weekDistanceKm = 0;
  let weekTimeMin = 0;
  let weekStrengthMin = 0;

  let monthWorkouts = 0;
  let monthDistanceKm = 0;
  let monthTimeMin = 0;

  const runDistanceByDay = {};

  for (const row of activities) {
    const startMs = toMillis(row.startDateMs || row.startDate || row.when);
    if (!startMs) continue;

    const type = String(row.type || "").toLowerCase();
    const isRun = type === "run";
    const isStrength = STRENGTH_TYPES.has(type);
    const distanceKm = toNum(row.distanceKm, 0);
    const movingTimeMin = toNum(row.movingTimeMin, 0);

    if (startMs >= weekStart) {
      weekWorkouts += 1;
      weekDistanceKm += distanceKm;
      weekTimeMin += movingTimeMin;
      if (isRun) {
        weekRuns += 1;
        const key = dayKey(startMs);
        runDistanceByDay[key] = (runDistanceByDay[key] || 0) + distanceKm;
      }
      if (isStrength) {
        weekStrengthMin += movingTimeMin;
      }
    }

    if (startMs >= monthStartMs) {
      monthWorkouts += 1;
      monthDistanceKm += distanceKm;
      monthTimeMin += movingTimeMin;
    }
  }

  const distanceSeries7d = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const key = dayKey(d.getTime());
    const label = d.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 1);
    distanceSeries7d.push({ label, value: toNum(runDistanceByDay[key], 0) });
  }

  return {
    weekRuns,
    weekWorkouts,
    weekDistanceKm,
    weekTimeMin,
    weekStrengthMin,
    monthWorkouts,
    monthDistanceKm,
    monthTimeMin,
    distanceSeries7d,
  };
}

function StatTile({ label, value, colors }) {
  return (
    <View style={[s.statTile, { borderColor: colors.border }]}>
      <Text style={[s.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[s.statLabel, { color: colors.subtext }]}>{label}</Text>
    </View>
  );
}

function DistanceBars({ data, accent, colors }) {
  const max = Math.max(1, ...data.map((x) => toNum(x.value, 0)));

  return (
    <View style={s.barsWrap}>
      {data.map((item, idx) => {
        const height = Math.max(4, Math.round((toNum(item.value, 0) / max) * 52));
        return (
          <View key={`${item.label}-${idx}`} style={s.barCol}>
            <View style={[s.barTrack, { backgroundColor: colors.border }]}>
              <View style={[s.barFill, { height, backgroundColor: accent }]} />
            </View>
            <Text style={[s.barLabel, { color: colors.subtext }]}>{item.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function YouPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [tab, setTab] = useState("progress");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stravaConnected, setStravaConnected] = useState(false);
  const [lastSyncISO, setLastSyncISO] = useState("");
  const [activities, setActivities] = useState([]);

  const accent = colors?.accentBg || colors?.sapPrimary || PRIMARY;
  const accentText = colors?.sapOnPrimary || "#0B0B0B";

  const displayName = user?.displayName || "Your account";
  const email = user?.email || "No email";
  const initial = String(displayName || email || "Y").trim().charAt(0).toUpperCase() || "Y";

  const dashboard = useMemo(() => deriveDashboard(activities), [activities]);
  const recent = useMemo(() => activities.slice(0, 12), [activities]);

  const loadMeData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setActivities([]);
        setLoading(false);
        return;
      }

      const connected = (await AsyncStorage.getItem("strava_connected")) === "1";
      setStravaConnected(connected);

      const cachedRaw = await AsyncStorage.getItem(STRAVA_CACHE_KEY);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          if (cached?.cachedAtISO) setLastSyncISO(String(cached.cachedAtISO));
        } catch {}
      }

      const userSnap = await getDoc(doc(db, "users", uid));
      const userData = userSnap.exists() ? userSnap.data() : null;
      const syncMs = toMillis(userData?.lastStravaSyncAt);
      if (syncMs) setLastSyncISO(new Date(syncMs).toISOString());

      const q = query(
        collection(db, "users", uid, "stravaActivities"),
        orderBy("startDate", "desc"),
        limit(100)
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
      setActivities(rows);
    } catch (e) {
      setError(String(e?.message || e || "Failed to load your page"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMeData();
  }, [loadMeData]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[s.safe, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={isDark ? [accent + "30", colors.bg] : [accent + "5A", colors.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={s.hero}
        >
          <View style={{ paddingTop: insets.top || 8 }}>
            <View style={s.heroTopRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={[s.iconBtn, { borderColor: colors.border }]}
                activeOpacity={0.85}
              >
                <Feather name="chevron-left" size={20} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/settings")}
                style={[s.iconBtn, { borderColor: colors.border }]}
                activeOpacity={0.85}
              >
                <Feather name="settings" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={s.profileRow}>
              <View style={[s.avatarWrap, { borderColor: accent }]}>
                {user?.photoURL ? (
                  <Image source={{ uri: user.photoURL }} style={s.avatar} />
                ) : (
                  <View style={[s.avatarFallback, { backgroundColor: isDark ? "#111217" : "#F3F4F6" }]}>
                    <Text style={[s.avatarInitial, { color: colors.text }]}>{initial}</Text>
                  </View>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[s.kicker, { color: colors.subtext }]}>You</Text>
                <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={[s.email, { color: colors.subtext }]} numberOfLines={1}>
                  {email}
                </Text>

                <View style={s.statusRow}>
                  <View
                    style={[
                      s.statusPill,
                      {
                        backgroundColor: stravaConnected
                          ? isDark
                            ? "rgba(34,197,94,0.18)"
                            : "rgba(34,197,94,0.14)"
                          : isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(15,23,42,0.06)",
                      },
                    ]}
                  >
                    <Text style={[s.statusText, { color: stravaConnected ? "#22C55E" : colors.subtext }]}>
                      {stravaConnected ? "Strava Connected" : "Strava Not Connected"}
                    </Text>
                  </View>

                  {lastSyncISO ? (
                    <Text style={[s.syncText, { color: colors.subtext }]}>
                      Sync {formatDateShort(new Date(lastSyncISO).getTime())}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={s.heroActions}>
              <TouchableOpacity
                onPress={() => router.push("/profile")}
                activeOpacity={0.9}
                style={[s.primaryBtn, { backgroundColor: accent }]}
              >
                <Feather name="user" size={16} color={accentText} />
                <Text style={[s.primaryBtnText, { color: accentText }]}>Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push("/settings")}
                activeOpacity={0.85}
                style={[s.secondaryBtn, { borderColor: colors.border }]}
              >
                <Feather name="sliders" size={15} color={colors.text} />
                <Text style={[s.secondaryBtnText, { color: colors.text }]}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>

        <View style={s.body}>
          <View style={[s.tabRow, { borderColor: colors.border, backgroundColor: isDark ? "#101216" : "#EEF2F7" }]}>
            {[
              { key: "progress", label: "Progress" },
              { key: "activities", label: "Activities" },
            ].map((entry) => {
              const active = tab === entry.key;
              return (
                <TouchableOpacity
                  key={entry.key}
                  onPress={() => setTab(entry.key)}
                  activeOpacity={0.85}
                  style={[
                    s.tabBtn,
                    active && {
                      backgroundColor: accent,
                      borderColor: accent,
                    },
                  ]}
                >
                  <Text style={[s.tabText, { color: active ? accentText : colors.subtext }]}>
                    {entry.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator />
              <Text style={[s.loadingText, { color: colors.subtext }]}>Loading dashboard...</Text>
            </View>
          ) : (
            <>
              {!!error && (
                <View style={[s.errorCard, { borderColor: colors.border }]}>
                  <Text style={{ color: "#FCA5A5", fontWeight: "700" }}>{error}</Text>
                </View>
              )}

              {tab === "progress" ? (
                <>
                  <View style={s.statsGrid}>
                    <StatTile label="Runs (7d)" value={String(dashboard.weekRuns)} colors={colors} />
                    <StatTile label="Distance (7d)" value={`${formatKm(dashboard.weekDistanceKm)} km`} colors={colors} />
                    <StatTile label="Time (7d)" value={formatMinutesAsHm(dashboard.weekTimeMin)} colors={colors} />
                    <StatTile label="Strength (7d)" value={formatMinutesAsHm(dashboard.weekStrengthMin)} colors={colors} />
                  </View>

                  <View style={[s.sectionCard, { borderColor: colors.border }]}>
                    <View style={s.sectionHeadRow}>
                      <Text style={[s.sectionTitle, { color: colors.text }]}>Weekly volume</Text>
                      <Text style={[s.sectionHint, { color: colors.subtext }]}>
                        {formatKm(dashboard.weekDistanceKm)} km total
                      </Text>
                    </View>
                    <DistanceBars
                      data={dashboard.distanceSeries7d}
                      accent={accent}
                      colors={colors}
                    />
                  </View>

                  <View style={[s.sectionCard, { borderColor: colors.border }]}>
                    <Text style={[s.sectionTitle, { color: colors.text }]}>This month</Text>
                    <View style={s.monthRow}>
                      <Text style={[s.monthLabel, { color: colors.subtext }]}>Workouts</Text>
                      <Text style={[s.monthValue, { color: colors.text }]}>{dashboard.monthWorkouts}</Text>
                    </View>
                    <View style={s.monthRow}>
                      <Text style={[s.monthLabel, { color: colors.subtext }]}>Distance</Text>
                      <Text style={[s.monthValue, { color: colors.text }]}>{formatKm(dashboard.monthDistanceKm)} km</Text>
                    </View>
                    <View style={s.monthRow}>
                      <Text style={[s.monthLabel, { color: colors.subtext }]}>Time</Text>
                      <Text style={[s.monthValue, { color: colors.text }]}>{formatMinutesAsHm(dashboard.monthTimeMin)}</Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={[s.sectionCard, { borderColor: colors.border }]}>
                  <Text style={[s.sectionTitle, { color: colors.text }]}>Recent activities</Text>
                  {!recent.length ? (
                    <Text style={{ color: colors.subtext }}>
                      No synced activities yet. Connect Strava in Settings.
                    </Text>
                  ) : (
                    recent.map((item) => {
                      const whenMs = toMillis(item.startDateMs || item.startDate || item.when);
                      const itemType = String(item.type || "Workout");
                      const itemTypeKey = itemType.toLowerCase();
                      const isRun = itemTypeKey === "run";
                      const isStrength = STRENGTH_TYPES.has(itemTypeKey);
                      const distanceKm = toNum(item.distanceKm, 0);
                      const durationLabel = formatMinutesAsHm(item.movingTimeMin || 0);
                      const avgPaceLabel = formatPaceMinPerKm(resolveAvgPaceMinPerKm(item));
                      const avgHr = resolveAverageHeartRate(item);
                      const summaryPolyline = resolveSummaryPolyline(item);

                      let primaryMetric = durationLabel || "Workout";
                      const secondaryParts = [];

                      if (isRun) {
                        if (avgPaceLabel) {
                          primaryMetric = avgPaceLabel;
                          if (distanceKm > 0) secondaryParts.push(`${formatKm(distanceKm)} km`);
                        } else if (distanceKm > 0) {
                          primaryMetric = `${formatKm(distanceKm)} km`;
                        } else {
                          primaryMetric = "Run";
                        }
                        if (avgHr > 0) secondaryParts.push(`Avg ${avgHr} bpm`);
                        if (durationLabel) secondaryParts.push(durationLabel);
                      } else if (isStrength) {
                        primaryMetric = avgHr > 0 ? `Avg ${avgHr} bpm` : "Strength";
                        if (durationLabel) secondaryParts.push(durationLabel);
                      } else {
                        if (distanceKm > 0) primaryMetric = `${formatKm(distanceKm)} km`;
                        if (durationLabel) secondaryParts.push(durationLabel);
                        if (avgHr > 0) secondaryParts.push(`Avg ${avgHr} bpm`);
                      }

                      const secondaryMetric = secondaryParts.join(" · ");

                      return (
                        <TouchableOpacity
                          key={String(item.id)}
                          activeOpacity={0.85}
                          onPress={() => router.push(`/me/activity/${item.id}`)}
                          style={[s.activityRow, { borderColor: colors.border }]}
                        >
                          <View style={s.activityMain}>
                            <Text style={[s.activityTitle, { color: colors.text }]} numberOfLines={1}>
                              {item.name || item.title || itemType}
                            </Text>
                            <View style={s.activitySubRow}>
                              <Text style={[s.activitySub, { color: colors.subtext }]}>
                                {formatDateShort(whenMs)}
                              </Text>
                              <View
                                style={[
                                  s.typePill,
                                  {
                                    backgroundColor: isRun
                                      ? isDark
                                        ? "rgba(230,255,59,0.18)"
                                        : "rgba(191,216,42,0.24)"
                                      : isDark
                                      ? "rgba(255,255,255,0.09)"
                                      : "rgba(15,23,42,0.06)",
                                  },
                                ]}
                              >
                                <Text style={[s.typePillText, { color: isRun ? accent : colors.subtext }]}>
                                  {itemType}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={s.activityMeta}>
                            <Text style={[s.activityMetaText, { color: colors.text }]}>{primaryMetric}</Text>
                            {!!secondaryMetric && (
                              <Text style={[s.activityMetaSubText, { color: colors.subtext }]} numberOfLines={1}>
                                {secondaryMetric}
                              </Text>
                            )}
                            {isRun && !!summaryPolyline && (
                              <RoutePreview
                                polyline={summaryPolyline}
                                accent={accent}
                                colors={colors}
                                isDark={isDark}
                              />
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              )}
            </>
          )}

          <View style={s.linksWrap}>
            {QUICK_LINKS.map((item) => (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.85}
                onPress={() => router.push(item.path)}
                style={[s.linkRow, { borderColor: colors.border }]}
              >
                <View style={[s.linkIcon, { backgroundColor: isDark ? "#12141A" : "#F3F4F6" }]}>
                  <Feather name={item.icon} size={16} color={colors.text} />
                </View>
                <Text style={[s.linkLabel, { color: colors.text }]}>{item.label}</Text>
                <Feather name="chevron-right" size={16} color={colors.subtext} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: 120 },

  hero: { paddingHorizontal: 18, paddingBottom: 14 },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },

  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: {
    width: 62,
    height: 62,
    borderRadius: 16,
    borderWidth: 1.5,
    overflow: "hidden",
  },
  avatar: { width: "100%", height: "100%" },
  avatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontSize: 24, fontWeight: "900" },

  kicker: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  name: { marginTop: 2, fontSize: 22, fontWeight: "800" },
  email: { marginTop: 2, fontSize: 12, fontWeight: "500" },

  statusRow: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: "800" },
  syncText: { fontSize: 11, fontWeight: "700" },

  heroActions: { marginTop: 12, flexDirection: "row", gap: 10 },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { fontSize: 13, fontWeight: "800" },
  secondaryBtn: {
    minWidth: 122,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "transparent",
  },
  secondaryBtnText: { fontSize: 13, fontWeight: "800" },

  body: { marginTop: 10, paddingHorizontal: 18, gap: 12 },
  tabRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    padding: 4,
    flexDirection: "row",
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: { fontSize: 13, fontWeight: "800" },

  loadingWrap: {
    minHeight: 90,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: { fontSize: 12, fontWeight: "600" },

  errorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statTile: {
    width: "48%",
    minHeight: 82,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
    gap: 6,
  },
  statValue: { fontSize: 20, fontWeight: "900" },
  statLabel: { fontSize: 12, fontWeight: "700" },

  sectionCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  sectionHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  sectionHint: { fontSize: 12, fontWeight: "700" },

  barsWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 6,
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  barTrack: {
    width: "100%",
    height: 56,
    borderRadius: 8,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderRadius: 8,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: "700",
  },

  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthLabel: { fontSize: 13, fontWeight: "700" },
  monthValue: { fontSize: 14, fontWeight: "800" },

  activityRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  activityMain: { flex: 1, gap: 2 },
  activityTitle: { fontSize: 14, fontWeight: "800" },
  activitySubRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  activitySub: { fontSize: 12, fontWeight: "600" },
  typePill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  typePillText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  activityMeta: { alignItems: "flex-end", gap: 4, maxWidth: 170 },
  activityMetaText: { fontSize: 13, fontWeight: "800" },
  activityMetaSubText: { fontSize: 11, fontWeight: "700", textAlign: "right" },
  routePreviewWrap: {
    marginTop: 2,
    width: 92,
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },

  linksWrap: { marginTop: 2, gap: 10 },
  linkRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    minHeight: 54,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "transparent",
  },
  linkIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  linkLabel: { flex: 1, fontSize: 14, fontWeight: "700" },
});
