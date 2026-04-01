"use client";

/**
 * app/(protected)/nutrition/fuel-match.jsx
 * Fuel Match — analyse food vs training (time-of-day aware)
 *
 * ✅ Now also pulls Strava activities and shows them EVEN if Strava is disconnected:
 * - Attempts to fetch from server: GET /strava/activities?after=<unix>&before=<unix>
 * - If that fails (disconnected / token expired / no link), it loads cached activities
 * - Caches per-day + “last known” activities in AsyncStorage
 *
 * ✅ Auto-preloads analysis (no manual prompt required)
 * - Runs automatically when goal + meals + sessions/strava are loaded
 * - Debounced + deduped to avoid spam calls from Firestore snapshots
 *
 * Requires:
 * - API_URL configured
 * - Firestore meals in: users/{uid}/meals
 * - Training sessions in: users/{uid}/trainingSessions  (adjust below if different)
 *
 * Server endpoint:
 * - POST /nutrition/fuel-match
 * Body: { dateISO, timezone, nowLocalISO, goal, totals, meals, sessions }
 * Returns: { grade, summary, timing, targets, actions, notes }
 */

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- date helpers ---------- */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function fmtTime(d) {
  try {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
function fmtDate(d) {
  try {
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}
function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function isoDayKey(d) {
  try {
    return startOfDay(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/* ---------- Strava normaliser ---------- */
function normaliseStravaActivity(a) {
  // Expected Strava-ish fields:
  // name, type, sport_type, start_date / start_date_local, elapsed_time, moving_time,
  // distance (m), total_elevation_gain, workout_type, average_speed, average_heartrate
  const start =
    (a?.start_date_local && new Date(a.start_date_local)) ||
    (a?.start_date && new Date(a.start_date)) ||
    null;

  const distanceKm =
    a?.distance != null ? Math.round((Number(a.distance) / 1000) * 10) / 10 : 0;

  const durationMin =
    a?.elapsed_time != null
      ? Math.round(Number(a.elapsed_time) / 60)
      : a?.moving_time != null
      ? Math.round(Number(a.moving_time) / 60)
      : 0;

  const type = a?.sport_type || a?.type || "Activity";
  const title = a?.name || type;

  return {
    id: String(a?.id ?? `${title}-${start?.toISOString?.() ?? Math.random()}`),
    title,
    type,
    intensity: a?.workout_type != null ? `workout ${a.workout_type}` : "",
    durationMin,
    distanceKm,
    startTime: start ? start.toISOString() : null,
    endTime: null,
    notes: "",
    _raw: a,
  };
}

export default function FuelMatchPage() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");
  const silverLight = colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const s = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));

  // profile goal
  const [nutritionGoal, setNutritionGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  // meals
  const [mealsLoading, setMealsLoading] = useState(true);
  const [meals, setMeals] = useState([]);

  // training sessions (app-logged)
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessions, setSessions] = useState([]);

  // strava activities
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaSource, setStravaSource] = useState("none"); // "live" | "cache" | "none"
  const [stravaError, setStravaError] = useState("");
  const [stravaActivities, setStravaActivities] = useState([]);

  // AI result
  const [fuelMatch, setFuelMatch] = useState(null);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError] = useState("");

  // debounce + dedupe
  const debounceTimerRef = useRef(null);
  const lastPayloadKeyRef = useRef("");
  const reqIdRef = useRef(0);

  // set date from params if provided
  useEffect(() => {
    const raw = params?.date;
    if (!raw) return;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return;
    setSelectedDate(startOfDay(d));
  }, [params?.date]);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  /* fetch nutrition goal */
  useEffect(() => {
    if (!user) return;
    setGoalLoading(true);

    const ref = doc(db, "users", user.uid, "nutrition", "profile");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setNutritionGoal(snap.exists() ? snap.data() : null);
        setGoalLoading(false);
      },
      () => setGoalLoading(false)
    );

    return () => unsub();
  }, [user]);

  /* fetch meals for selected day */
  useEffect(() => {
    if (!user) return;

    setMealsLoading(true);
    const ref = collection(db, "users", user.uid, "meals");
    const from = Timestamp.fromDate(startOfDay(selectedDate));
    const to = Timestamp.fromDate(endOfDay(selectedDate));

    const qMeals = query(
      ref,
      where("date", ">=", from),
      where("date", "<=", to),
      orderBy("date", "asc")
    );

    const unsub = onSnapshot(
      qMeals,
      (snap) => {
        setMeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMealsLoading(false);
      },
      () => setMealsLoading(false)
    );

    return () => unsub();
  }, [user, selectedDate]);

  /**
   * ✅ fetch training sessions for selected day (app-logged)
   * Collection: users/{uid}/trainingSessions
   * Fields expected:
   * - startTime: Timestamp
   */
  useEffect(() => {
    if (!user) return;

    setSessionsLoading(true);
    const ref = collection(db, "users", user.uid, "trainingSessions"); // <-- change if needed
    const from = Timestamp.fromDate(startOfDay(selectedDate));
    const to = Timestamp.fromDate(endOfDay(selectedDate));

    const qSessions = query(
      ref,
      where("startTime", ">=", from),
      where("startTime", "<=", to),
      orderBy("startTime", "asc")
    );

    const unsub = onSnapshot(
      qSessions,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSessionsLoading(false);
      },
      () => setSessionsLoading(false)
    );

    return () => unsub();
  }, [user, selectedDate]);

  /**
   * ✅ Fetch Strava activities (even if disconnected)
   * - Try live fetch from server
   * - If fails, fallback to cached activities for that day (or last known)
   */
  useEffect(() => {
    let cancelled = false;

    const loadFromCache = async (dayKey) => {
      try {
        const cachedDay = await AsyncStorage.getItem(`strava_day_${dayKey}`);
        if (cachedDay) {
          const parsed = JSON.parse(cachedDay);
          if (!cancelled) {
            setStravaActivities(Array.isArray(parsed) ? parsed : []);
            setStravaSource("cache");
          }
          return true;
        }

        // fallback: last known
        const cachedLast = await AsyncStorage.getItem("strava_last");
        if (cachedLast) {
          const parsed = JSON.parse(cachedLast);
          if (!cancelled) {
            setStravaActivities(Array.isArray(parsed) ? parsed : []);
            setStravaSource("cache");
          }
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    const fetchLive = async () => {
      if (!API_URL) return;
      const dayKey = isoDayKey(selectedDate);
      setStravaLoading(true);
      setStravaError("");

      const after = Math.floor(startOfDay(selectedDate).getTime() / 1000);
      const before = Math.floor(endOfDay(selectedDate).getTime() / 1000);

      try {
        // Primary assumption based on your server mounting: app.use("/strava", stravaRoutes)
        // -> GET /strava/activities?after=&before=
        const res = await fetch(
          `${API_URL}/strava/activities?after=${after}&before=${before}`,
          { method: "GET" }
        );

        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        const list = Array.isArray(data) ? data : data?.activities || [];

        const normalised = (Array.isArray(list) ? list : [])
          .map(normaliseStravaActivity)
          .filter(Boolean);

        if (!cancelled) {
          setStravaActivities(normalised);
          setStravaSource("live");
        }

        // cache per-day + last
        try {
          await AsyncStorage.setItem(`strava_day_${dayKey}`, JSON.stringify(normalised));
          await AsyncStorage.setItem("strava_last", JSON.stringify(normalised));
        } catch {
          // ignore cache errors
        }
      } catch (e) {
        // live failed -> show cached instead, but keep UI alive
        const msg = e?.message || "Strava unavailable";
        if (!cancelled) setStravaError(msg);

        const usedCache = await loadFromCache(isoDayKey(selectedDate));
        if (!usedCache && !cancelled) {
          setStravaActivities([]);
          setStravaSource("none");
        }
      } finally {
        if (!cancelled) setStravaLoading(false);
      }
    };

    fetchLive();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const totals = useMemo(() => {
    const base = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    return meals.reduce(
      (acc, m) => ({
        calories: acc.calories + Number(m.calories || 0),
        protein: acc.protein + Number(m.protein || 0),
        carbs: acc.carbs + Number(m.carbs || 0),
        fat: acc.fat + Number(m.fat || 0),
      }),
      base
    );
  }, [meals]);

  const dayLabel = useMemo(() => fmtDate(selectedDate), [selectedDate]);

  const handleChangeDay = useCallback((delta) => {
    setFuelMatch(null);
    setFuelError("");
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      const todayStart = startOfDay();
      if (next > todayStart) return todayStart;
      return startOfDay(next);
    });
  }, []);

  // merge app sessions + strava activities for analysis payload
  const mergedSessionsForAnalysis = useMemo(() => {
    const safeApp = sessions.map((t) => ({
      title: t.title || t.name || t.type || "Session",
      type: t.type || "Training",
      intensity: t.intensity || t.zone || "",
      durationMin: Number(t.durationMin || t.duration || 0),
      distanceKm: Number(t.distanceKm || t.distance || 0),
      startTime: t.startTime?.toDate?.()?.toISOString?.() || null,
      endTime: t.endTime?.toDate?.()?.toISOString?.() || null,
      notes: t.notes || "",
      source: "app",
    }));

    const safeStrava = stravaActivities.map((a) => ({
      title: a.title || "Activity",
      type: a.type || "Strava",
      intensity: a.intensity || "",
      durationMin: Number(a.durationMin || 0),
      distanceKm: Number(a.distanceKm || 0),
      startTime: a.startTime || null,
      endTime: a.endTime || null,
      notes: a.notes || "",
      source: "strava",
    }));

    return [...safeApp, ...safeStrava].sort((x, y) => {
      const ax = x.startTime ? new Date(x.startTime).getTime() : 0;
      const ay = y.startTime ? new Date(y.startTime).getTime() : 0;
      return ax - ay;
    });
  }, [sessions, stravaActivities]);

  const buildPayload = useCallback(() => {
    const timezone = getTimezone();
    const nowLocalISO = new Date().toISOString();

    const safeMeals = meals.map((m) => ({
      title: m.title || "",
      mealType: m.mealType || "",
      calories: Number(m.calories || 0),
      protein: Number(m.protein || 0),
      carbs: Number(m.carbs || 0),
      fat: Number(m.fat || 0),
      notes: m.notes || "",
      date: m.date?.toDate?.()?.toISOString?.() || null,
    }));

    return {
      dateISO: selectedDate.toISOString(),
      timezone,
      nowLocalISO,
      goal: nutritionGoal,
      totals,
      meals: safeMeals,
      sessions: mergedSessionsForAnalysis,
    };
  }, [meals, mergedSessionsForAnalysis, nutritionGoal, selectedDate, totals]);

  const payloadKey = useMemo(() => {
    const mealKey = meals
      .map((m) => `${m.id}:${m.date?.seconds ?? ""}:${m.calories ?? ""}:${m.protein ?? ""}:${m.carbs ?? ""}:${m.fat ?? ""}`)
      .join("|");

    const appSessionKey = sessions
      .map((t) => `${t.id}:${t.startTime?.seconds ?? ""}:${t.durationMin ?? ""}:${t.distanceKm ?? ""}:${t.intensity ?? ""}`)
      .join("|");

    const stravaKey = stravaActivities
      .map((a) => `${a.id}:${a.startTime ?? ""}:${a.durationMin ?? ""}:${a.distanceKm ?? ""}`)
      .join("|");

    const goalKey = nutritionGoal
      ? `${nutritionGoal.dailyCalories ?? ""}:${nutritionGoal.proteinTarget ?? nutritionGoal.proteinG ?? ""}:${nutritionGoal.carbTarget ?? nutritionGoal.carbsG ?? ""}:${nutritionGoal.fatTarget ?? nutritionGoal.fatG ?? ""}`
      : "no-goal";

    const dateKey = selectedDate.toISOString().slice(0, 10);

    return `${dateKey}__${goalKey}__${mealKey}__${appSessionKey}__${stravaKey}`;
  }, [meals, nutritionGoal, selectedDate, sessions, stravaActivities]);

  const runFuelMatch = useCallback(
    async ({ silent = false } = {}) => {
      if (!nutritionGoal) {
        if (!silent) Alert.alert("Set a goal", "Set your nutrition goal first.");
        return;
      }
      if (!API_URL) {
        if (!silent) Alert.alert("Config error", "API URL missing from env.");
        return;
      }
      if (!user) {
        if (!silent) Alert.alert("Error", "Please sign in again.");
        return;
      }

      const payload = buildPayload();

      try {
        setFuelLoading(true);
        setFuelError("");

        const myReqId = ++reqIdRef.current;

        const res = await fetch(`${API_URL}/nutrition/fuel-match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (myReqId !== reqIdRef.current) return; // ignore stale
        setFuelMatch(data);
      } catch (e) {
        const msg = e?.message || "Try again.";
        setFuelError(msg);
        if (!silent) Alert.alert("Fuel Match failed", msg);
      } finally {
        setFuelLoading(false);
      }
    },
    [buildPayload, nutritionGoal, user]
  );

  /**
   * ✅ Auto-preload analysis (debounced + deduped)
   * - Waits for goal + meals + sessions + strava fetch to settle
   */
  useEffect(() => {
    if (!nutritionGoal) return;
    if (goalLoading || mealsLoading || sessionsLoading || stravaLoading) return;
    if (!API_URL) return;

    if (lastPayloadKeyRef.current === payloadKey) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      lastPayloadKeyRef.current = payloadKey;
      runFuelMatch({ silent: true });
    }, 450);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [
    API_URL,
    goalLoading,
    mealsLoading,
    nutritionGoal,
    payloadKey,
    runFuelMatch,
    sessionsLoading,
    stravaLoading,
  ]);

  const anyTraining = mergedSessionsForAnalysis.length > 0;

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerIcon} activeOpacity={0.8}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={s.headerTitle}>Fuel Match</Text>
          <Text style={s.headerSub}>{dayLabel}</Text>
        </View>

        <TouchableOpacity
          onPress={() => router.push("/share")}
          style={s.headerIcon}
          activeOpacity={0.8}
        >
          <Feather name="share-2" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Day nav */}
        <View style={s.dayRow}>
          <TouchableOpacity onPress={() => handleChangeDay(-1)} style={s.dayBtn} activeOpacity={0.85}>
            <Feather name="chevron-left" size={18} color={colors.text} />
            <Text style={s.dayBtnText}>Prev</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setFuelMatch(null);
              setFuelError("");
              setSelectedDate(startOfDay(new Date()));
            }}
            style={s.dayPill}
            activeOpacity={0.85}
          >
            <Text style={s.dayPillText}>Today</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => handleChangeDay(1)} style={s.dayBtn} activeOpacity={0.85}>
            <Text style={s.dayBtnText}>Next</Text>
            <Feather name="chevron-right" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Overview */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Day overview</Text>

          {goalLoading ? (
            <ActivityIndicator />
          ) : !nutritionGoal ? (
            <Text style={s.cardSub}>Set a nutrition goal first to enable Fuel Match.</Text>
          ) : (
            <>
              <View style={s.kpiRow}>
                <Kpi label="Calories" value={`${Math.round(totals.calories)} kcal`} s={s} />
                <Kpi label="Protein" value={`${Math.round(totals.protein)} g`} s={s} />
                <Kpi label="Carbs" value={`${Math.round(totals.carbs)} g`} s={s} />
                <Kpi label="Fat" value={`${Math.round(totals.fat)} g`} s={s} />
              </View>

              <Text style={s.cardMeta}>
                Meals: {meals.length} • Training: {mergedSessionsForAnalysis.length}
              </Text>
            </>
          )}
        </View>

        {/* Training list (App + Strava) */}
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>Training today</Text>

            <View style={s.pillsRow}>
              <View style={s.pill}>
                <Text style={s.pillText}>App: {sessions.length}</Text>
              </View>
              <View style={s.pill}>
                <Text style={s.pillText}>
                  Strava: {stravaActivities.length}
                  {stravaSource === "cache" ? " (cached)" : ""}
                </Text>
              </View>
            </View>
          </View>

          {sessionsLoading || stravaLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator />
              <Text style={s.cardSub}>Loading training…</Text>
            </View>
          ) : !anyTraining ? (
            <Text style={s.cardSub}>
              No training found (app or Strava). Fuel Match will focus on general alignment and meal timing.
            </Text>
          ) : (
            <View style={{ marginTop: 6 }}>
              {mergedSessionsForAnalysis.map((t) => {
                const st = t.startTime ? new Date(t.startTime) : null;
                const label = st ? `${fmtTime(st)} • ` : "";
                return (
                  <View key={`${t.source || "x"}_${t.title}_${t.startTime || ""}`} style={s.listRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.listTitle}>
                        {label}
                        {t.title || "Session"}
                      </Text>
                      <Text style={s.listSub}>
                        {t.source === "strava" ? "Strava" : "App"}
                        {" • "}
                        {t.type || "Training"}
                        {t.intensity ? ` • ${t.intensity}` : ""}
                        {t.durationMin ? ` • ${t.durationMin} min` : ""}
                        {t.distanceKm ? ` • ${t.distanceKm} km` : ""}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* If Strava failed live, show a gentle message but still show cached */}
          {!stravaLoading && stravaError ? (
            <View style={{ marginTop: 10 }}>
              <Text style={s.cardSub}>
                Strava isn’t connected right now — showing cached activities if available.
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <TouchableOpacity
              style={s.ghostBtn}
              onPress={async () => {
                // manual refresh of Strava only
                try {
                  setStravaLoading(true);
                  setStravaError("");
                  setStravaSource("none");

                  const after = Math.floor(startOfDay(selectedDate).getTime() / 1000);
                  const before = Math.floor(endOfDay(selectedDate).getTime() / 1000);
                  const res = await fetch(
                    `${API_URL}/strava/activities?after=${after}&before=${before}`,
                    { method: "GET" }
                  );
                  if (!res.ok) throw new Error(await res.text());
                  const data = await res.json();
                  const list = Array.isArray(data) ? data : data?.activities || [];
                  const normalised = (Array.isArray(list) ? list : [])
                    .map(normaliseStravaActivity)
                    .filter(Boolean);

                  setStravaActivities(normalised);
                  setStravaSource("live");

                  const dayKey = isoDayKey(selectedDate);
                  await AsyncStorage.setItem(`strava_day_${dayKey}`, JSON.stringify(normalised));
                  await AsyncStorage.setItem("strava_last", JSON.stringify(normalised));
                } catch (e) {
                  setStravaError(e?.message || "Strava unavailable");
                  // load cache
                  const dayKey = isoDayKey(selectedDate);
                  const cachedDay = await AsyncStorage.getItem(`strava_day_${dayKey}`);
                  if (cachedDay) {
                    setStravaActivities(JSON.parse(cachedDay) || []);
                    setStravaSource("cache");
                  }
                } finally {
                  setStravaLoading(false);
                }
              }}
              activeOpacity={0.9}
              disabled={!API_URL || stravaLoading}
            >
              {stravaLoading ? (
                <ActivityIndicator color={accentText} />
              ) : (
                <>
                  <Feather name="refresh-ccw" size={16} color={accentText} />
                  <Text style={s.ghostBtnText}>Refresh Strava</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={s.ghostBtn}
              onPress={() => router.push("/(protected)/settings")}
              activeOpacity={0.9}
            >
              <Feather name="link" size={16} color={accentText} />
              <Text style={s.ghostBtnText}>Connect Strava</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Auto analysis status + manual refresh */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Auto analysis</Text>

          {goalLoading || mealsLoading || sessionsLoading || stravaLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator />
              <Text style={s.cardSub}>Loading data… Fuel Match will run automatically.</Text>
            </View>
          ) : fuelLoading ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator />
              <Text style={s.cardSub}>Analysing…</Text>
            </View>
          ) : fuelError ? (
            <>
              <Text style={s.cardSub}>Couldn’t load Fuel Match.</Text>
              <Text style={[s.cardSub, { marginTop: 6 }]}>{fuelError}</Text>
            </>
          ) : fuelMatch ? (
            <Text style={s.cardSub}>Up to date for this day (updates automatically).</Text>
          ) : (
            <Text style={s.cardSub}>Ready — will auto-run when needed.</Text>
          )}

          <TouchableOpacity
            style={[s.ghostBtn, { marginTop: 12 }]}
            onPress={() => {
              lastPayloadKeyRef.current = "";
              runFuelMatch({ silent: false });
            }}
            activeOpacity={0.9}
            disabled={!nutritionGoal || fuelLoading || goalLoading || mealsLoading || sessionsLoading || stravaLoading}
          >
            {fuelLoading ? (
              <ActivityIndicator color={accentText} />
            ) : (
              <>
                <Feather name="zap" size={16} color={accentText} />
                <Text style={s.ghostBtnText}>Refresh analysis</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Result */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Fuel Match result</Text>

          {!fuelMatch ? (
            <Text style={s.cardSub}>
              Once your meals and training load, Fuel Match auto-generates a time-aware breakdown.
            </Text>
          ) : (
            <>
              <View style={s.gradeRow}>
                <View style={s.gradeBadge}>
                  <Text style={s.gradeText}>{fuelMatch.grade || "—"}</Text>
                </View>
                <Text style={s.resultSummary}>{fuelMatch.summary || ""}</Text>
              </View>

              {fuelMatch.timing ? (
                <Block title="Timing & distribution" text={fuelMatch.timing} s={s} />
              ) : null}

              {fuelMatch.targets ? (
                <Block title="Targets for this training" text={formatTargets(fuelMatch.targets)} s={s} />
              ) : null}

              {Array.isArray(fuelMatch.actions) && fuelMatch.actions.length ? (
                <Block
                  title="What to do next"
                  text={fuelMatch.actions.map((a) => `• ${a}`).join("\n")}
                  s={s}
                />
              ) : null}

              {fuelMatch.notes ? <Block title="Notes" text={fuelMatch.notes} s={s} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- small components ---------- */

function Kpi({ label, value, s }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={s.kpiLabel}>{label}</Text>
    </View>
  );
}

function Block({ title, text, s }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      <Text style={s.blockText}>{text}</Text>
    </View>
  );
}

function formatTargets(targets) {
  if (!targets) return "";
  if (typeof targets === "string") return targets;

  const parts = [];
  if (targets.carbs_g_per_kg) parts.push(`Carbs: ${targets.carbs_g_per_kg} g/kg`);
  if (targets.protein_g_per_kg) parts.push(`Protein: ${targets.protein_g_per_kg} g/kg`);
  if (targets.pre_fuel) parts.push(`Pre: ${targets.pre_fuel}`);
  if (targets.intra_fuel) parts.push(`Intra: ${targets.intra_fuel}`);
  if (targets.post_fuel) parts.push(`Post: ${targets.post_fuel}`);
  return parts.join("\n");
}

/* ---------- styles ---------- */

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? "#111217" : silverLight;
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";

  const softShadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headerIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    headerSub: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 2,
    },

    scroll: { paddingHorizontal: 18, paddingBottom: 140 },

    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14,
      gap: 10,
    },
    dayBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...softShadow,
    },
    dayBtnText: { color: colors.text, fontWeight: "800", fontSize: 12 },
    dayPill: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: accentBg,
      ...softShadow,
    },
    dayPillText: { color: "#111111", fontWeight: "900", fontSize: 12 },

    card: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      marginBottom: 14,
      ...softShadow,
    },
    cardTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 8,
    },
    pillsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    pill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
    },
    pillText: { color: colors.text, fontWeight: "800", fontSize: 11 },

    cardTitle: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 13,
      letterSpacing: 0.9,
      textTransform: "uppercase",
    },
    cardSub: {
      color: colors.subtext,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    cardMeta: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 10,
    },

    kpiRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
    kpi: {
      backgroundColor: panelBg,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      minWidth: "47%",
      ...softShadow,
    },
    kpiValue: { color: colors.text, fontWeight: "900", fontSize: 14 },
    kpiLabel: { color: colors.subtext, fontWeight: "700", fontSize: 11, marginTop: 4 },

    listRow: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? "#1F2128" : "#E4E6EC",
    },
    listTitle: { color: colors.text, fontWeight: "800", fontSize: 14 },
    listSub: { color: colors.subtext, fontWeight: "600", fontSize: 12, marginTop: 3 },

    ghostBtn: {
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingVertical: 12,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...softShadow,
    },
    ghostBtnText: {
      color: accentText,
      fontWeight: "900",
      letterSpacing: 0.3,
      fontSize: 12,
      textTransform: "uppercase",
    },

    gradeRow: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 6 },
    gradeBadge: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: accentBg,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    gradeText: { color: "#111111", fontWeight: "900", fontSize: 18 },
    resultSummary: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 13, lineHeight: 18 },

    block: {
      marginTop: 12,
      backgroundColor: panelBg,
      borderRadius: 16,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
    },
    blockTitle: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 0.9,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    blockText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "650" },
  });
}
