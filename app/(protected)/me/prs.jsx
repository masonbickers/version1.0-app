// app/(protected)/me/prs.jsx
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
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function formatPace(paceMinPerKm) {
  if (!paceMinPerKm || !Number.isFinite(paceMinPerKm)) return "—";
  const mins = Math.floor(paceMinPerKm);
  const secs = Math.round((paceMinPerKm - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}
function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
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
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("cycling") || x.includes("bike")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}
function prettyDistanceKm(km) {
  if (!km || !Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

/* Best-effort parser from activity detail */
function bestEffortSeconds(detail, targetMeters) {
  const eff = Array.isArray(detail?.best_efforts) ? detail.best_efforts : [];
  const match = eff.find((e) => Number(e?.distance) === Number(targetMeters));
  if (match?.elapsed_time) return Number(match.elapsed_time);
  return null;
}

/* ─────────────────────────────────────────────
   ALL-TIME Strava pagination loader (fallback)
───────────────────────────────────────────── */
async function fetchStravaActivitiesAllTime(token, { maxPages = 30 } = {}) {
  const perPage = 200;
  let page = 1;
  const all = [];

  while (page <= maxPages) {
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Strava error ${resp.status}: ${text}`);
    }

    const batch = await resp.json();
    const safe = Array.isArray(batch) ? batch : [];
    all.push(...safe);

    if (safe.length < perPage) break;
    page += 1;
  }

  return all;
}

/* ─────────────────────────────────────────────
   ✅ “SYNC” loader (matches app’s sync behaviour)
   - Shows cached data even if Strava is disconnected
   - Tries server sync if token exists
   - Falls back to direct Strava fetch if server sync fails
───────────────────────────────────────────── */
const CACHE_KEY = "strava_cached_activities_alltime";
const CACHE_SYNC_AT = "strava_cached_activities_alltime_synced_at";

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function tryServerSyncAllTime({ maxPages = 30 } = {}) {
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
      scope: "activities_all_time",
      maxPages,
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

async function loadCachedAllTime() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const at = await AsyncStorage.getItem(CACHE_SYNC_AT);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      activities: Array.isArray(parsed) ? parsed : [],
      syncedAt: at ? Number(at) : 0,
    };
  } catch {
    return { activities: [], syncedAt: 0 };
  }
}

async function writeCacheAllTime(activities) {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify(Array.isArray(activities) ? activities : [])
    );
    await AsyncStorage.setItem(CACHE_SYNC_AT, String(Date.now()));
  } catch {
    // ignore
  }
}

/* ─────────────────────────────────────────────
   Prediction helpers ("AI-ish" on-device)
───────────────────────────────────────────── */
function riegelPredictSeconds(t1Sec, d1m, d2m, k = 1.06) {
  if (!t1Sec || !d1m || !d2m) return null;
  const ratio = d2m / d1m;
  return t1Sec * Math.pow(ratio, k);
}
function enduranceExponentFromVolume(kmPerWeek) {
  const k = 1.08 - clamp((kmPerWeek - 10) / 60, 0, 1) * 0.04; // 1.08 → 1.04
  return clamp(k, 1.04, 1.10);
}
function weeklyRunKm(acts, lookbackDays = 56) {
  const cutoff = Date.now() - lookbackDays * 86400000;
  const runs = acts
    .filter((a) => a.type === "Run" && a.when)
    .filter((a) => new Date(a.when).getTime() >= cutoff);
  const totalKm = runs.reduce((sum, a) => sum + (a.distanceKm || 0), 0);
  const weeks = Math.max(1, lookbackDays / 7);
  return totalKm / weeks;
}
function trendFactorFromRuns(acts) {
  const now = Date.now();
  const w = 14 * 86400000;

  const bucket = (start, end) => {
    const runs = acts
      .filter((a) => a.type === "Run" && a.when)
      .filter((a) => {
        const t = new Date(a.when).getTime();
        return (
          t >= start &&
          t < end &&
          (a.distanceKm || 0) > 0 &&
          (a.movingTimeSec || 0) > 0
        );
      });

    const dist = runs.reduce((s, r) => s + (r.distanceKm || 0), 0);
    const sec = runs.reduce((s, r) => s + (r.movingTimeSec || 0), 0);
    const pace = dist > 0 ? (sec / 60) / dist : null; // min/km
    return { dist, pace };
  };

  const recent = bucket(now - w, now);
  const prior = bucket(now - 2 * w, now - w);

  const confidence = recent.dist >= 25 ? "High" : recent.dist >= 12 ? "Medium" : "Low";

  if (!recent.pace || !prior.pace) return { factor: 1.0, confidence };

  const change = (prior.pace - recent.pace) / prior.pace;
  const clamped = clamp(change, -0.05, 0.05);
  const factor = 1 - clamped;

  return { factor, confidence };
}
function pickAnchorFromBestEfforts(bestEfforts) {
  const prefer = [5000, 10000, 1000];
  for (const m of prefer) {
    const x = bestEfforts.find((b) => b.meters === m && b.best?.sec);
    if (x) return { meters: m, ...x.best };
  }
  const any = bestEfforts.find((b) => b.best?.sec);
  return any ? { meters: any.meters, ...any.best } : null;
}

/* ============================================================================
   PRs — Personal Records (Strava-based)
   ✅ Shows cached data even if Strava disconnected
============================================================================ */
export default function PRsPage() {
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
  const [filter, setFilter] = useState("All");

  // details cache for accurate best efforts
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState({}); // id -> activity detail

  // modal for PR card click
  const [openPR, setOpenPR] = useState(null);

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
      const pace = paceMinPerKm(distanceKm, a.moving_time || 0);
      const type = normaliseType(a.type || "Workout");

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
        average_speed: Number(a.average_speed || 0),
        max_speed: Number(a.max_speed || 0),
      };
    });

    mapped.sort((a, b) => {
      const ta = a.when ? new Date(a.when).getTime() : 0;
      const tb = b.when ? new Date(b.when).getTime() : 0;
      return tb - ta;
    });

    return mapped;
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // ✅ Always show cached immediately (even if disconnected)
      const cached = await loadCachedAllTime();
      if (cached.activities?.length) {
        setActs(mapActivities(cached.activities));
        setSyncedAt(cached.syncedAt || 0);
      }

      // Connection state (independent from cached)
      const token = await AsyncStorage.getItem("strava_access_token");
      const connected = !!token;
      setHasToken(connected);

      // If not connected, stop here (but cached stays visible)
      if (!connected) return;

      // Try server sync first
      const synced = await tryServerSyncAllTime({ maxPages: 30 });
      if (synced.ok) {
        const arr = Array.isArray(synced.activities) ? synced.activities : [];
        await writeCacheAllTime(arr);
        const fresh = await loadCachedAllTime();
        setActs(mapActivities(arr));
        setSyncedAt(fresh.syncedAt || Date.now());
        return;
      }

      // Fallback: direct Strava fetch
      const raw = await fetchStravaActivitiesAllTime(token, { maxPages: 30 });
      const safe = Array.isArray(raw) ? raw : [];
      await writeCacheAllTime(safe);
      const fresh = await loadCachedAllTime();
      setActs(mapActivities(safe));
      setSyncedAt(fresh.syncedAt || Date.now());
    } catch (e) {
      console.error("PR load error", e);
      setError("Couldn’t load Strava. Try reconnecting in Settings.");
      // keep cached if present; only clear if none
      // (don’t nuke acts here)
    } finally {
      setLoading(false);
    }
  }, [mapActivities]);

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

  const filteredActs = useMemo(() => {
    return acts.filter((a) => (filter === "All" ? true : a.type === filter));
  }, [acts, filter]);

  /* ─────────────────────────────────────────────
     PR calculation (ALL TIME)
  ────────────────────────────────────────────── */
  const prs = useMemo(() => {
    const runs = acts.filter((a) => a.type === "Run" && Number(a.distanceKm || 0) > 0);

    const longestRun =
      [...runs].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0] || null;

    const highestElev =
      [...acts].sort((a, b) => (b.elevGainM || 0) - (a.elevGainM || 0))[0] || null;

    const longestTime =
      [...acts].sort((a, b) => (b.movingTimeSec || 0) - (a.movingTimeSec || 0))[0] || null;

    const targets = [
      { key: "best_1k", label: "Fastest 1 km", meters: 1000 },
      { key: "best_5k", label: "Fastest 5 km", meters: 5000 },
      { key: "best_10k", label: "Fastest 10 km", meters: 10000 },
    ];

    const bestEfforts = targets.map((t) => {
      const candidates = runs.filter((a) => (a.distanceKm || 0) * 1000 >= t.meters);

      let best = null;

      candidates.forEach((a) => {
        const detail = detailCache[a.id];
        const beSec = detail ? bestEffortSeconds(detail, t.meters) : null;

        let sec = beSec;
        if (!sec) {
          const pace = a.paceMinPerKm;
          if (pace && Number.isFinite(pace)) {
            const km = t.meters / 1000;
            sec = pace * 60 * km;
          }
        }

        if (!sec || !Number.isFinite(sec)) return;

        if (!best || sec < best.sec) {
          best = { sec, activity: a, exact: !!beSec };
        }
      });

      return { ...t, best };
    });

    const kmPerWeek = weeklyRunKm(acts, 56);
    const k = enduranceExponentFromVolume(kmPerWeek);
    const trend = trendFactorFromRuns(acts);
    const anchor = pickAnchorFromBestEfforts(bestEfforts);

    const predictedByMeters = {};
    [1000, 5000, 10000].forEach((m) => {
      if (!anchor?.sec) {
        predictedByMeters[m] = null;
        return;
      }
      const base = riegelPredictSeconds(anchor.sec, anchor.meters, m, k);
      predictedByMeters[m] = base ? base * trend.factor : null;
    });

    return {
      longestRun,
      highestElev,
      longestTime,
      bestEfforts,
      prediction: {
        predictedByMeters,
        confidence: trend.confidence,
      },
    };
  }, [acts, detailCache]);

  // Opportunistic detail fetch for likely PR candidates (only if connected)
  useEffect(() => {
    if (!hasToken) return;

    const runs = acts.filter((a) => a.type === "Run" && Number(a.distanceKm || 0) > 0);
    if (!runs.length) return;

    const fastestPace = [...runs]
      .filter((a) => Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0)
      .sort((a, b) => (a.paceMinPerKm || 999) - (b.paceMinPerKm || 999))[0];

    const longest = [...runs].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0];
    const longOnes = [...runs]
      .sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))
      .slice(0, 6);

    const ids = [fastestPace?.id, longest?.id, ...longOnes.map((x) => x.id)].filter(Boolean);

    ids.forEach((id) => {
      if (!detailCache[id]) fetchDetailIfNeeded(id);
    });
  }, [acts, hasToken, detailCache, fetchDetailIfNeeded]);

  const headerPRCards = useMemo(() => {
    const cards = [];
    const conf = prs?.prediction?.confidence || "Low";

    prs.bestEfforts.forEach((b) => {
      const predSec = prs?.prediction?.predictedByMeters?.[b.meters] || null;

      if (!b.best) {
        cards.push({
          key: b.key,
          title: b.label,
          value: "—",
          sub: "No qualifying run found",
          pred: predSec ? formatMinSec(predSec) : "—",
          predSub: predSec ? `Predicted now · ${conf} confidence` : "",
          activityId: "",
        });
      } else {
        cards.push({
          key: b.key,
          title: b.label,
          value: formatMinSec(b.best.sec),
          sub: `${prettyDistanceKm(b.best.activity.distanceKm)} · ${b.best.exact ? "Exact" : "Estimated"}`,
          pred: predSec ? formatMinSec(predSec) : "—",
          predSub: predSec ? `Predicted now · ${conf} confidence` : "",
          activityId: b.best.activity.id,
        });
      }
    });

    cards.push({
      key: "longest_run",
      title: "Longest run",
      value: prs.longestRun ? prettyDistanceKm(prs.longestRun.distanceKm) : "—",
      sub: prs.longestRun ? formatWhenLine(prs.longestRun.when) : "No run found",
      pred: "",
      predSub: "",
      activityId: prs.longestRun?.id || "",
    });

    cards.push({
      key: "highest_elev",
      title: "Most elevation",
      value: prs.highestElev ? `${Math.round(prs.highestElev.elevGainM || 0)} m` : "—",
      sub: prs.highestElev
        ? `${prs.highestElev.type} · ${formatWhenLine(prs.highestElev.when)}`
        : "No sessions found",
      pred: "",
      predSub: "",
      activityId: prs.highestElev?.id || "",
    });

    cards.push({
      key: "longest_time",
      title: "Longest session",
      value: prs.longestTime ? formatMinSec(prs.longestTime.movingTimeSec) : "—",
      sub: prs.longestTime
        ? `${prs.longestTime.type} · ${formatWhenLine(prs.longestTime.when)}`
        : "No sessions found",
      pred: "",
      predSub: "",
      activityId: prs.longestTime?.id || "",
    });

    return cards;
  }, [prs]);

  const openPRModal = useCallback(
    async (card) => {
      setOpenPR(card);
      if (card?.activityId && hasToken) fetchDetailIfNeeded(card.activityId);
    },
    [fetchDetailIfNeeded, hasToken]
  );

  const activePRActivity = useMemo(() => {
    if (!openPR?.activityId) return null;
    return acts.find((a) => a.id === openPR.activityId) || null;
  }, [openPR, acts]);

  const activePRDetail = useMemo(() => {
    if (!openPR?.activityId) return null;
    return detailCache[openPR.activityId] || null;
  }, [openPR, detailCache]);

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
                  <Text style={s.heroBadge}>PRS</Text>
                  <Text style={s.heroName}>Personal records</Text>
                  <Text style={s.heroSub}>
                    Based on all time · Strava: {hasToken ? "Connected" : "Disconnected"}
                    {syncedLine}
                    {!hasToken && hasData ? " · Showing cached data" : ""}
                  </Text>
                </View>
              </View>

              {/* PR grid */}
              <View style={s.prGrid}>
                {headerPRCards.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    activeOpacity={0.9}
                    onPress={() => openPRModal(c)}
                    style={s.prCard}
                  >
                    <Text style={s.prTitle} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <Text style={s.prValue} numberOfLines={1}>
                      {c.value}
                    </Text>
                    <Text style={s.prSub} numberOfLines={1}>
                      {c.sub}
                    </Text>

                    {c.predSub ? (
                      <Text style={s.prPred} numberOfLines={1}>
                        Predicted: <Text style={{ fontWeight: "900" }}>{c.pred}</Text>{" "}
                        <Text style={{ color: colors.subtext }}>
                          ({prs?.prediction?.confidence || "Low"})
                        </Text>
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>

              {loading ? (
                <View style={{ paddingVertical: 14 }}>
                  <ActivityIndicator />
                  <Text style={s.loadingText}>Loading…</Text>
                </View>
              ) : null}

              {/* Always allow reconnect CTA, but never hide cached data */}
              {!hasToken ? (
                <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                  <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                </TouchableOpacity>
              ) : null}

              {error ? <Text style={s.error}>{error}</Text> : null}
            </View>
          </LinearGradient>

          {/* FILTER + LIST */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="award" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Activities</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.hint}>
              Tap activity to open · Hold to fetch full detail (device + notes + best efforts).
            </Text>

            <TypeFilter
              value={filter}
              onChange={setFilter}
              accent={accent}
              colors={colors}
              isDark={isDark}
              options={["All", "Run", "Strength", "Ride", "Walk", "Swim", "Other"]}
            />

            {!hasData ? (
              <Text style={[s.hint, { marginTop: 12 }]}>
                {hasToken
                  ? "No activities found."
                  : "No cached activities yet. Reconnect Strava once to sync and cache your history."}
              </Text>
            ) : (
              <View style={{ marginTop: 12, gap: 12 }}>
                {!hasToken ? (
                  <View style={s.cacheBanner}>
                    <Feather name="database" size={14} color={colors.text} />
                    <Text style={s.cacheBannerText}>
                      Showing last synced data.
                    </Text>
                  </View>
                ) : null}

                {filteredActs.slice(0, 60).map((a) => {
                  const detail = detailCache[a.id];
                  const whenObj = a.when ? new Date(a.when) : null;

                  const deviceLine = detail?.device_name || detail?.gear?.name || a.deviceName || "Strava";
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
                      type={a.type}
                      distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                      paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                      timeText={formatMinSec(a.movingTimeSec)}
                      showDistance={showDistance}
                      showPace={showPace}
                      onPress={() => router.push(`/me/activity/${a.id}`)}
                      onLongPress={() => (hasToken ? fetchDetailIfNeeded(a.id) : null)}
                      loadingDetail={detailLoadingId === a.id}
                    />
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* PR MODAL */}
        <PRModal
          open={!!openPR}
          onClose={() => setOpenPR(null)}
          pr={openPR}
          activity={activePRActivity}
          detail={activePRDetail}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          loadingDetail={detailLoadingId === openPR?.activityId}
          onFetchDetail={() => (hasToken && openPR?.activityId ? fetchDetailIfNeeded(openPR.activityId) : null)}
          userName={displayName}
          avatarUri={user?.photoURL || ""}
          initial={initial}
          hasToken={hasToken}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   PR Modal
───────────────────────────────────────────── */
function PRModal({
  open,
  onClose,
  pr,
  activity,
  detail,
  colors,
  isDark,
  accent,
  router,
  loadingDetail,
  onFetchDetail,
  userName,
  avatarUri,
  initial,
  hasToken,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const whenObj = activity?.when ? new Date(activity.when) : null;
  const deviceLine = detail?.device_name || detail?.gear?.name || activity?.deviceName || "Strava";
  const desc = detail?.description || activity?.description || "";

  const hasDistance = Number(activity?.distanceKm || 0) > 0;
  const hasPace = Number.isFinite(activity?.paceMinPerKm) && activity?.paceMinPerKm > 0;
  const showDistance = activity?.type === "Run" && hasDistance;
  const showPace = activity?.type === "Run" && hasDistance && hasPace;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />

          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                {pr?.title || "PR"}
              </Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]} numberOfLines={2}>
                {pr?.value || "—"} · {pr?.sub || ""}
                {pr?.predSub ? `\nPredicted: ${pr?.pred || "—"}` : ""}
              </Text>
            </View>

            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => pr?.activityId && router.push(`/me/activity/${pr.activityId}`)}
              style={[stylesGlobal.cta, { backgroundColor: accent, flex: 1 }]}
            >
              <Feather name="external-link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
              <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>
                Open activity
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onFetchDetail}
              disabled={!hasToken}
              style={[
                stylesGlobal.cta,
                { backgroundColor: isDark ? "#18191E" : "#E6E7EC", flex: 1, opacity: hasToken ? 1 : 0.55 },
              ]}
            >
              <Feather name="download" size={16} color={colors.text} />
              <Text style={[stylesGlobal.ctaText, { color: colors.text }]}>
                {hasToken ? "Fetch detail" : "Reconnect to fetch"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {!activity ? (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>
              No linked activity found for this PR.
            </Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              <CompactActivityCard
                userName={userName}
                avatarUri={avatarUri}
                initial={initial}
                accent={accent}
                colors={colors}
                isDark={isDark}
                title={activity.title}
                subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                notes={desc}
                type={activity.type}
                distanceText={showDistance ? `${activity.distanceKm.toFixed(2)} km` : ""}
                paceText={showPace ? formatPace(activity.paceMinPerKm) : ""}
                timeText={formatMinSec(activity.movingTimeSec)}
                showDistance={showDistance}
                showPace={showPace}
                onPress={() => router.push(`/me/activity/${activity.id}`)}
                onLongPress={() => (hasToken ? onFetchDetail() : null)}
                loadingDetail={loadingDetail}
              />

              {detail?.best_efforts?.length ? (
                <View style={{ marginTop: 14 }}>
                  <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>
                    Best efforts
                  </Text>

                  <View style={{ marginTop: 10, gap: 8 }}>
                    {detail.best_efforts
                      .filter((b) => [1000, 5000, 10000].includes(Number(b.distance)))
                      .slice(0, 6)
                      .map((b, idx) => (
                        <View
                          key={`${b.distance}-${idx}`}
                          style={{
                            backgroundColor: isDark ? "#111217" : "#F3F4F6",
                            borderRadius: 16,
                            padding: 12,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Text style={{ color: colors.text, fontWeight: "900" }}>
                            {Number(b.distance) === 1000 ? "1 km" : Number(b.distance) === 5000 ? "5 km" : "10 km"}
                          </Text>
                          <Text style={{ color: colors.subtext, fontWeight: "900" }}>
                            {formatMinSec(Number(b.elapsed_time || 0))}
                          </Text>
                        </View>
                      ))}
                  </View>
                </View>
              ) : null}

              {loadingDetail ? (
                <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator size="small" />
                  <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>
                    Loading details…
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Type filter (clean)
───────────────────────────────────────────── */
function TypeFilter({ value, onChange, options, accent, colors, isDark }) {
  const track = isDark ? "#0E0F14" : "#FFFFFF";
  const border = isDark ? "#1B1C22" : "#E6E7EC";
  const activeBg = isDark ? "#00000066" : "#FFFFFFAA";

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
      style={{ marginTop: 6 }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            activeOpacity={0.9}
            onPress={() => onChange(opt)}
            style={{
              borderRadius: 999,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? accent : border,
              paddingVertical: 10,
              paddingHorizontal: 14,
              backgroundColor: active ? activeBg : track,
            }}
          >
            <Text style={{ fontWeight: "900", color: active ? colors.text : colors.subtext }}>
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ─────────────────────────────────────────────
   Compact Activity Card
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
            <Feather name={typeIconForType(type)} size={15} color={colors.text} />
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
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>
            Loading details…
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function typeIconForType(type) {
  if (type === "Run") return "activity";
  if (type === "Ride") return "wind";
  if (type === "Strength") return "zap";
  if (type === "Walk") return "map";
  if (type === "Swim") return "droplet";
  return "circle";
}

function MetricBlockSmall({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>
        {value}
      </Text>
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
  avatarWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 3,
    overflow: "hidden",
  },
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
    heroAvatarBorder: {
      position: "absolute",
      inset: 0,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: accent,
    },
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

    prGrid: {
      marginTop: 14,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    prCard: {
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
    prTitle: { color: colors.subtext, fontSize: 12, fontWeight: "900" },
    prValue: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 },
    prSub: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6 },
    prPred: { marginTop: 8, color: colors.text, fontSize: 12, fontWeight: "800" },

    connectBtn: {
      marginTop: 14,
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
    cacheBannerText: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      fontWeight: "800",
    },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
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
  ctaText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});
