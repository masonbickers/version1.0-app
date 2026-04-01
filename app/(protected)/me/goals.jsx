// app/(protected)/me/goals.jsx
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
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

// Firestore
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

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
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ✅ LOCAL date key (avoids UTC shifting caused by toISOString())
function isoKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
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
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
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

function toWeekLabel(weekStartDate) {
  return `Wk of ${weekStartDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })}`;
}

// ✅ renamed to avoid clashing with ProgressRow prop name
function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return clamp(n, 0, 100);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

/* ─────────────────────────────────────────────
   Firestore path
   users/{uid}/me/goals (single doc)
───────────────────────────────────────────── */
function goalsDocRef(uid) {
  return doc(db, "users", uid, "me", "goals");
}

/* ============================================================================
   Goals — weekly targets + progress from Strava
============================================================================ */
export default function GoalsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");

  // strava activities for window (4 weeks)
  const [acts, setActs] = useState([]);

  // goals state (stored)
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState({
    weeklySessions: 5,
    weeklyRunKm: 30,
    weeklyMinutes: 300,
    weeklyStrengthMinutes: 120,
  });

  const [editOpen, setEditOpen] = useState(false);

  // drilldown week modal
  const [weekOpen, setWeekOpen] = useState(false);
  const [selectedWeekKey, setSelectedWeekKey] = useState(null);

  // details cache for long press
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState({});

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const loadGoals = useCallback(async () => {
    try {
      if (!user?.uid) return;
      const ref = goalsDocRef(user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        setTargets((prev) => ({
          weeklySessions: Number.isFinite(Number(data.weeklySessions))
            ? Number(data.weeklySessions)
            : prev.weeklySessions,
          weeklyRunKm: Number.isFinite(Number(data.weeklyRunKm))
            ? Number(data.weeklyRunKm)
            : prev.weeklyRunKm,
          weeklyMinutes: Number.isFinite(Number(data.weeklyMinutes))
            ? Number(data.weeklyMinutes)
            : prev.weeklyMinutes,
          weeklyStrengthMinutes: Number.isFinite(Number(data.weeklyStrengthMinutes))
            ? Number(data.weeklyStrengthMinutes)
            : prev.weeklyStrengthMinutes,
        }));
      }
    } catch (e) {
      console.warn("goals load error", e);
    }
  }, [user?.uid]);

  const saveGoals = useCallback(
    async (nextTargets) => {
      if (!user?.uid) return;
      try {
        setSaving(true);
        const ref = goalsDocRef(user.uid);
        await setDoc(
          ref,
          {
            ...nextTargets,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("goals save error", e);
        setError("Couldn’t save goals. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [user?.uid]
  );

  const loadStrava = useCallback(async () => {
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

      // last 28 days window
      const after = Math.floor(addDays(new Date(), -28).getTime() / 1000);

      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava goals load error", resp.status, text);
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

      mapped.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      setActs(mapped);
    } catch (e) {
      console.error("Goals Strava load error", e);
      setError("Couldn’t load progress. Try again.");
      setActs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadGoals(), loadStrava()]);
  }, [loadGoals, loadStrava]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

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
     Weekly aggregations for last 4 weeks + current week
  ────────────────────────────────────────────── */
  const weekly = useMemo(() => {
    const thisWeekStart = startOfWeekMonday(new Date());
    const start = addDays(thisWeekStart, -21); // 4 weeks incl this

    const by = {};
    for (let i = 0; i < 4; i++) {
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
      const ws = startOfWeekMonday(new Date(a.when));
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
    const current = series[series.length - 1] || null;

    return { series, current };
  }, [acts]);

  const progress = useMemo(() => {
    const cur = weekly.current;
    if (!cur) {
      return {
        sessions: 0,
        runKm: 0,
        minutes: 0,
        strengthMin: 0,
        pctSessions: 0,
        pctRunKm: 0,
        pctMinutes: 0,
        pctStrength: 0,
      };
    }

    const sessions = cur.count;
    const runKm = cur.runKm;
    const minutes = cur.timeMin;
    const strengthMin = cur.strengthMin;

    const pctSessions = (sessions / Math.max(1, safeNum(targets.weeklySessions))) * 100;
    const pctRunKm = (runKm / Math.max(1, safeNum(targets.weeklyRunKm))) * 100;
    const pctMinutes = (minutes / Math.max(1, safeNum(targets.weeklyMinutes))) * 100;
    const pctStrength = (strengthMin / Math.max(1, safeNum(targets.weeklyStrengthMinutes))) * 100;

    return { sessions, runKm, minutes, strengthMin, pctSessions, pctRunKm, pctMinutes, pctStrength };
  }, [weekly.current, targets]);

  const currentWeekActivities = useMemo(() => {
    const cur = weekly.current;
    if (!cur) return [];
    const start = cur.weekStart.getTime();
    const end = addDays(cur.weekStart, 7).getTime();
    return acts
      .filter((a) => {
        const t = a.when ? new Date(a.when).getTime() : 0;
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, weekly.current]);

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
                  <TouchableOpacity onPress={() => setEditOpen(true)} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="edit-3" size={18} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="settings" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
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
                  <Text style={s.heroBadge}>GOALS</Text>
                  <Text style={s.heroName}>Weekly targets</Text>
                  <Text style={s.heroSub}>
                    {hasToken ? "Progress from Strava" : "Connect Strava for progress"}
                    {weekly.current?.weekStart ? ` · ${toWeekLabel(weekly.current.weekStart)}` : ""}
                  </Text>
                </View>
              </View>

              {/* PROGRESS BARS */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>This week</Text>
                  <TouchableOpacity onPress={onRefresh} style={s.refreshBtnMini} activeOpacity={0.85}>
                    <Feather name="refresh-cw" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasToken ? (
                  <Text style={s.hint}>Connect Strava to track progress automatically.</Text>
                ) : (
                  <>
                    <ProgressRow
                      title="Sessions"
                      left={`${progress.sessions}/${targets.weeklySessions}`}
                      pct={progress.pctSessions}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />
                    <ProgressRow
                      title="Run km"
                      left={`${progress.runKm.toFixed(1)}/${Number(targets.weeklyRunKm).toFixed(0)}`}
                      pct={progress.pctRunKm}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />
                    <ProgressRow
                      title="Total minutes"
                      left={`${Math.round(progress.minutes)}/${Number(targets.weeklyMinutes).toFixed(0)}`}
                      pct={progress.pctMinutes}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />
                    <ProgressRow
                      title="Strength minutes"
                      left={`${Math.round(progress.strengthMin)}/${Number(targets.weeklyStrengthMinutes).toFixed(0)}`}
                      pct={progress.pctStrength}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => {
                          const cur = weekly.current;
                          if (cur) onWeekPress(cur);
                        }}
                        style={[s.cta, { backgroundColor: isDark ? "#18191E" : "#E6E7EC", flex: 1 }]}
                      >
                        <Feather name="list" size={16} color={colors.text} />
                        <Text style={[s.ctaText, { color: colors.text }]}>View week</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setEditOpen(true)}
                        style={[s.cta, { backgroundColor: accent, flex: 1 }]}
                      >
                        <Feather name="sliders" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                        <Text style={[s.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Edit goals</Text>
                      </TouchableOpacity>
                    </View>
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

          {/* LAST 4 WEEKS STRIP */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="calendar" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Last 4 weeks</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            {hasToken ? (
              <>
                <WeekStrip
                  weeks={weekly.series}
                  accent={accent}
                  colors={colors}
                  isDark={isDark}
                  targets={targets}
                  onWeekPress={onWeekPress}
                />
                <Text style={s.hint}>Tap a week to see sessions.</Text>
              </>
            ) : (
              <Text style={s.hint}>Connect Strava to see week-by-week progress.</Text>
            )}

            {/* THIS WEEK ACTIVITIES (quick list) */}
            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>This week’s sessions</Text>

            {loading ? (
              <View style={{ paddingVertical: 14 }}>
                <ActivityIndicator />
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : !hasToken ? (
              <Text style={s.hint}>Connect Strava to see your sessions here.</Text>
            ) : currentWeekActivities.length === 0 ? (
              <Text style={s.hint}>No sessions logged yet this week.</Text>
            ) : (
              <>
                {currentWeekActivities.slice(0, 8).map((a) => {
                  const whenObj = a.when ? new Date(a.when) : null;

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
                        subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${a.type}`}
                        notes={""}
                        distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                        paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                        timeText={formatHoursMin(a.movingTimeMin)}
                        showDistance={showDistance}
                        showPace={showPace}
                        onPress={() => router.push(`/me/activity/${a.id}`)}
                        onLongPress={() => fetchDetailIfNeeded(a.id)}
                        loadingDetail={detailLoadingId === a.id}
                      />
                    </View>
                  );
                })}
              </>
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* EDIT GOALS MODAL */}
        <EditGoalsSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          colors={colors}
          isDark={isDark}
          accent={accent}
          saving={saving}
          targets={targets}
          setTargets={setTargets}
          onSave={async (next) => {
            await saveGoals(next);
            setEditOpen(false);
          }}
        />

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
   Progress bar row (clean, no borders)
───────────────────────────────────────────── */
function ProgressRow({ title, left, pct, accent, colors, isDark }) {
  const pRaw = Number(pct || 0);
  const p = Number.isFinite(pRaw) ? clamp(pRaw, 0, 999) : 0;
  const widthPct = clampPct(p); // width must be 0..100
  const label = p >= 100 ? "Done" : fmtPct(p);

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: 13 }}>{title}</Text>
        <Text style={{ color: colors.subtext, fontWeight: "900", fontSize: 12 }}>
          {left} · {label}
        </Text>
      </View>

      <View
        style={{
          marginTop: 8,
          height: 10,
          borderRadius: 999,
          backgroundColor: isDark ? "#1B1C22" : "#E6E7EC",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${widthPct}%`,
            backgroundColor: accent,
            borderRadius: 999,
          }}
        />
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week strip (4 small bars) — clickable
───────────────────────────────────────────── */
function WeekStrip({ weeks, accent, colors, isDark, targets, onWeekPress }) {
  const maxMinutes = Math.max(...weeks.map((w) => w.timeMin), safeNum(targets.weeklyMinutes), 1);

  return (
    <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
      {weeks.map((w, idx) => {
        const h = 56;
        const fill = clamp((w.timeMin / maxMinutes) * 100, 0, 100);
        const isCurrent = idx === weeks.length - 1;

        return (
          <TouchableOpacity
            key={w.key}
            activeOpacity={0.9}
            onPress={() => onWeekPress?.(w)}
            style={{
              flex: 1,
              backgroundColor: isDark ? "#111217" : "#F3F4F6",
              borderRadius: 18,
              padding: 12,
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 10 },
              ...Platform.select({ android: { elevation: 1 } }),
            }}
          >
            <Text style={{ color: colors.subtext, fontSize: 11, fontWeight: "900" }} numberOfLines={1}>
              {toWeekLabel(w.weekStart)}
            </Text>

            <View
              style={{
                marginTop: 10,
                height: h,
                borderRadius: 14,
                backgroundColor: isDark ? "#1B1C22" : "#E6E7EC",
                overflow: "hidden",
                justifyContent: "flex-end",
              }}
            >
              <View
                style={{
                  height: `${fill}%`,
                  backgroundColor: accent,
                  opacity: isCurrent ? 1 : 0.7,
                }}
              />
            </View>

            <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 8 }}>
              {formatHoursMin(w.timeMin)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────────────────────
   Edit goals sheet
───────────────────────────────────────────── */
function EditGoalsSheet({ open, onClose, colors, isDark, accent, saving, targets, setTargets, onSave }) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.78);

  const [local, setLocal] = useState(targets);

  useEffect(() => {
    if (open) setLocal(targets);
  }, [open, targets]);

  const setField = (k, v) => {
    const n = String(v ?? "").replace(/[^0-9.]/g, "");
    setLocal((p) => ({ ...p, [k]: n }));
  };

  const commit = async () => {
    const next = {
      weeklySessions: clamp(Math.round(safeNum(local.weeklySessions)), 0, 99),
      weeklyRunKm: clamp(safeNum(local.weeklyRunKm), 0, 400),
      weeklyMinutes: clamp(Math.round(safeNum(local.weeklyMinutes)), 0, 5000),
      weeklyStrengthMinutes: clamp(Math.round(safeNum(local.weeklyStrengthMinutes)), 0, 2000),
    };
    setTargets(next);
    await onSave?.(next);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>Edit weekly goals</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>Used for progress bars + trends.</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          <FieldRow
            label="Sessions"
            value={String(local.weeklySessions ?? "")}
            onChangeText={(v) => setField("weeklySessions", v)}
            suffix=" / week"
            colors={colors}
            isDark={isDark}
          />
          <FieldRow
            label="Run distance"
            value={String(local.weeklyRunKm ?? "")}
            onChangeText={(v) => setField("weeklyRunKm", v)}
            suffix=" km / week"
            colors={colors}
            isDark={isDark}
          />
          <FieldRow
            label="Total training time"
            value={String(local.weeklyMinutes ?? "")}
            onChangeText={(v) => setField("weeklyMinutes", v)}
            suffix=" min / week"
            colors={colors}
            isDark={isDark}
          />
          <FieldRow
            label="Strength time"
            value={String(local.weeklyStrengthMinutes ?? "")}
            onChangeText={(v) => setField("weeklyStrengthMinutes", v)}
            suffix=" min / week"
            colors={colors}
            isDark={isDark}
          />

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={commit}
            disabled={saving}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16, opacity: saving ? 0.7 : 1 }]}
          >
            {saving ? <ActivityIndicator /> : <Feather name="check" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />}
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>
              {saving ? "Saving…" : "Save goals"}
            </Text>
          </TouchableOpacity>

          <Text style={{ marginTop: 10, color: colors.subtext, fontSize: 12, lineHeight: 17 }}>
            Tip: keep targets realistic — the app will surface consistency, not perfection.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function FieldRow({ label, value, onChangeText, suffix, colors, isDark }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{label}</Text>
      <View
        style={{
          marginTop: 8,
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 18,
          backgroundColor: isDark ? "#111217" : "#F3F4F6",
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.subtext}
          style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: "900" }}
        />
        <Text style={{ color: colors.subtext, fontWeight: "900", marginLeft: 8 }}>{suffix}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week sheet — shows activities + hides distance/pace if missing
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
                    timeText={`${Math.round(a.movingTimeMin)} min`}
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

/* ─────────────────────────────────────────────
   Compact Activity Card (stat value size 16)
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
   Small pill (used in WeekSheet header)
───────────────────────────────────────────── */
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

    sectionMiniTitle: { marginTop: 10, color: colors.text, fontSize: 13, fontWeight: "900" },

    cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
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
  cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});
