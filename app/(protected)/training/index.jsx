"use client";

/**
 * app/(protected)/training/index.jsx
 * Workouts — Template Library + Plan Dashboard (Runna-level)
 *
 * Firestore:
 * - users/{uid}/workoutTemplates/{templateId}
 * - users/{uid}/trainingPlans/{planId}
 * - users/{uid}/trainSessions/{sessionId}  (completed sessions)
 * - users/{uid}/meta/planBuilder  (builder status)
 *
 * Routes:
 * - Create workout: /training/create
 * - Workout detail: /training/[workoutId]
 * - Plan builder: /training/builder
 * - Plans list: /training/plans
 * - Plan detail: /training/plans/[planId]
 * - Schedule workout: /training/schedule-workout
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const FOOTER_OFFSET = 110;

const TYPE_FILTERS = [
  { key: "all", label: "All" },
  { key: "strength", label: "Strength" },
  { key: "hyrox", label: "Hyrox" },
  { key: "conditioning", label: "Conditioning" },
  { key: "mobility", label: "Mobility" },
];

/* ---------------- helpers ---------------- */

function safeLower(v) {
  return String(v || "").toLowerCase();
}
function fmtType(t) {
  const s = safeLower(t);
  if (!s) return "Workout";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function sumItems(blocks) {
  if (!Array.isArray(blocks)) return 0;
  let n = 0;
  for (const b of blocks) {
    const items = Array.isArray(b?.items) ? b.items : [];
    n += items.length;
  }
  return n;
}
function getPrimaryMovements(blocks) {
  if (!Array.isArray(blocks)) return [];
  const names = [];
  for (const b of blocks) {
    const items = Array.isArray(b?.items) ? b.items : [];
    for (const it of items) {
      const name = it?.name || it?.title || it?.exercise || "";
      if (!name) continue;
      const clean = String(name).trim();
      if (!clean) continue;
      if (!names.includes(clean)) names.push(clean);
      if (names.length >= 3) return names;
    }
  }
  return names;
}
function normaliseList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}
function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}
function pad2(n) {
  return String(n).padStart(2, "0");
}
function ymd(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseYMD(s) {
  // expects YYYY-MM-DD
  const str = String(s || "");
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!yy || !mm || !dd) return null;
  const d = new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
function diffDaysUTC(a, b) {
  // days between dates a and b (UTC, floor)
  const ms = 24 * 60 * 60 * 1000;
  const ta = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const tb = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.floor((tb - ta) / ms);
}
function minutesFromSessionDoc(d) {
  const n =
    d?.actualDurationMin ??
    (d?.live?.durationSec != null ? d.live.durationSec / 60 : null) ??
    null;
  if (n == null) return 0;
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : 0;
}
function distanceKmFromSessionDoc(d) {
  const n =
    d?.actualDistanceKm ??
    (d?.live?.distanceKm != null ? d.live.distanceKm : null) ??
    null;
  if (n == null) return 0;
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Extract weeks from plan (supports nested shapes)
 */
function extractWeeks(plan) {
  const candidates = [
    plan?.weeks,
    plan?.plan?.weeks,
    plan?.planData?.weeks,
    plan?.generatedPlan?.weeks,
    plan?.activePlan?.weeks,
    plan?.output?.weeks,
    plan?.result?.weeks,
    plan?.template?.weeks,
    plan?.program?.weeks,
    plan?.schedule?.weeks,
    plan?.payload?.weeks,
  ];

  for (const c of candidates) {
    const w = normaliseList(c);
    if (w.length) return w;
  }
  return [];
}

/**
 * Count total sessions in a plan (supports:
 *  A) weeks[w].days[d].sessions[]
 *  B) weeks[w].sessions[]
 *  C) weeks[w].workouts[]
 */
function countTotalSessions(plan) {
  const weeks = extractWeeks(plan);
  let total = 0;

  for (const w of weeks) {
    const days = normaliseList(w?.days);
    if (days.length) {
      for (const day of days) {
        const sessions = normaliseList(day?.sessions);
        total += sessions.length;
      }
      continue;
    }

    const sessions = normaliseList(w?.sessions);
    if (sessions.length) {
      total += sessions.length;
      continue;
    }

    const workouts = normaliseList(w?.workouts);
    total += workouts.length;
  }

  // fallback if plan stores "sessions" at top-level
  if (!total) {
    const top = normaliseList(plan?.sessions);
    total += top.length;
  }

  return total;
}

/**
 * Get a session object for a specific week/day
 * Returns { sess, dayLabel, sessionIndexGuess }
 */
function getPlanSessionForDay(plan, weekIndex, dayIndex) {
  const weeks = extractWeeks(plan);
  const w = weeks?.[weekIndex];
  if (!w) return { sess: null, dayLabel: "", sessionIndexGuess: 0 };

  const days = normaliseList(w?.days);
  if (days.length) {
    const day = days?.[dayIndex];
    const dayLabel =
      day?.day || day?.label || day?.name || (w?.weekNumber != null ? `Week ${w.weekNumber}` : "");
    const sessions = normaliseList(day?.sessions);
    const sess = sessions?.[0] || null;
    return { sess, dayLabel, sessionIndexGuess: 0 };
  }

  // Template shape: assume dayIndex maps into week.sessions (often 7 long)
  const weekSessions = normaliseList(w?.sessions);
  if (weekSessions.length) {
    const sess = weekSessions?.[dayIndex] || weekSessions?.[0] || null;
    const dayLabel = w?.weekNumber != null ? `Week ${w.weekNumber}` : "";
    const idx = weekSessions?.[dayIndex] ? dayIndex : 0;
    return { sess, dayLabel, sessionIndexGuess: idx };
  }

  const workouts = normaliseList(w?.workouts);
  if (workouts.length) {
    const sess = workouts?.[dayIndex] || workouts?.[0] || null;
    const dayLabel = w?.weekNumber != null ? `Week ${w.weekNumber}` : "";
    const idx = workouts?.[dayIndex] ? dayIndex : 0;
    return { sess, dayLabel, sessionIndexGuess: idx };
  }

  return { sess: null, dayLabel: "", sessionIndexGuess: 0 };
}

function formatPlanSubtitle(plan) {
  const weeks = extractWeeks(plan);
  const weeksCount = weeks.length || Number(plan?.weeks || 0) || null;
  const goal = plan?.goal ? String(plan.goal) : "";
  const primary = plan?.primaryActivity ? String(plan.primaryActivity) : "";

  const bits = [];
  if (weeksCount) bits.push(`${weeksCount} weeks`);
  if (primary) bits.push(primary);
  if (goal) bits.push(goal);
  return bits.join(" • ");
}

function fmtSessionTitle(sess) {
  return (
    sess?.title ||
    sess?.name ||
    sess?.type ||
    sess?.sessionType ||
    sess?.kind ||
    "Session"
  );
}

function fmtSessionMeta(sess) {
  // support run template: sess.workout.totalDurationSec / totalDistanceKm
  const w = sess?.workout || {};
  const min =
    w?.totalDurationSec != null
      ? Math.round(Number(w.totalDurationSec) / 60)
      : sess?.targetDurationMin ?? sess?.durationMin ?? null;

  const km =
    w?.totalDistanceKm != null
      ? Number(Number(w.totalDistanceKm).toFixed(1))
      : sess?.targetDistanceKm ?? sess?.distanceKm ?? null;

  const bits = [];
  if (min) bits.push(`${min} min`);
  if (km) bits.push(`${Number(km).toFixed(1)} km`);
  return bits.join(" • ");
}

function isRunLikePlan(plan) {
  const kind = safeLower(plan?.kind);
  const primary = safeLower(plan?.primaryActivity);
  return kind.includes("run") || primary.includes("run");
}

/* ---------------- main component ---------------- */

export default function WorkoutsIndexPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  // ✅ don’t “cache” auth.currentUser at render time (can be null then populate)
  const [user, setUser] = useState(() => auth.currentUser);

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");
  const silverLight = colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const s = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);

  // training plans
  const [plansLoading, setPlansLoading] = useState(true);
  const [plans, setPlans] = useState([]);

  // ✅ plan builder status (banner)
  const [planBuild, setPlanBuild] = useState({
    status: "idle", // "idle" | "building" | "error" | "done"
    planName: "",
    message: "",
    startedAt: null,
  });

  // ✅ plan analytics (from trainSessions)
  const [planStatsLoading, setPlanStatsLoading] = useState(false);
  const [planStats, setPlanStats] = useState({
    completedCount: 0,
    minutes: 0,
    distanceKm: 0,
    last7Count: 0,
    lastCompletedAt: null,
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // auth listener
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u || null);
      if (!u) router.replace("/(auth)/login");
    });
    return () => unsub();
  }, [router]);

  // live templates
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const ref = collection(db, "users", user.uid, "workoutTemplates");
    const qRef = query(ref, orderBy("updatedAt", "desc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setTemplates(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  // live plans
  useEffect(() => {
    if (!user) return;

    setPlansLoading(true);
    const ref = collection(db, "users", user.uid, "trainingPlans");
    const qRef = query(ref, orderBy("updatedAt", "desc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setPlans(rows);
        setPlansLoading(false);
      },
      () => setPlansLoading(false)
    );

    return () => unsub();
  }, [user]);

  // live plan-builder status doc
  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "users", user.uid, "meta", "planBuilder");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        const status = String(d?.status || "idle");
        setPlanBuild({
          status: ["idle", "building", "error", "done"].includes(status) ? status : "idle",
          planName: String(d?.planName || ""),
          message: String(d?.message || ""),
          startedAt: d?.startedAt || null,
        });
      },
      () => setPlanBuild({ status: "idle", planName: "", message: "", startedAt: null })
    );

    return () => unsub();
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      const typeOk = typeFilter === "all" ? true : safeLower(t.type) === safeLower(typeFilter);
      if (!typeOk) return false;
      if (!q) return true;

      const name = safeLower(t.name);
      const notes = safeLower(t.notes);
      const goal = safeLower(t.goal);
      const type = safeLower(t.type);

      const blocks = Array.isArray(t.blocks) ? t.blocks : [];
      const blockText = blocks
        .map((b) => {
          const title = safeLower(b?.title);
          const items = Array.isArray(b?.items) ? b.items : [];
          const itemsText = items.map((it) => safeLower(it?.name || it?.title || it?.exercise)).join(" ");
          return `${title} ${itemsText}`;
        })
        .join(" ");

      return name.includes(q) || goal.includes(q) || notes.includes(q) || type.includes(q) || blockText.includes(q);
    });
  }, [templates, search, typeFilter]);

  // open workout detail
  const handleOpen = useCallback((id) => {
    router.push(`/training/${id}`);
  }, [router]);

  // open plan detail
  const handleOpenPlan = useCallback((id) => {
    router.push(`/training/plans/${id}`);
  }, [router]);

  // open plans list
  const handleOpenPlansList = useCallback(() => {
    router.push("/training/plans");
  }, [router]);

  const handleDelete = useCallback(async (item) => {
    if (!user) return;

    Alert.alert("Delete workout?", `This will delete “${item?.name || "Workout"}”.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "users", user.uid, "workoutTemplates", item.id));
          } catch (e) {
            Alert.alert("Delete failed", e?.message || "Try again.");
          }
        },
      },
    ]);
  }, [user]);

  const handleDuplicate = useCallback((item) => {
    router.push({ pathname: "/training/create", params: { duplicateFrom: item?.id } });
  }, [router]);

  const latestPlan = useMemo(() => plans?.[0] || null, [plans]);
  const isBuildingPlan = planBuild.status === "building";

  /**
   * ✅ PLAN PROGRESS MODEL
   * - uses plan.startDate (YYYY-MM-DD) if present
   * - otherwise treats it as "not started"
   */
  const planProgress = useMemo(() => {
    if (!latestPlan) {
      return {
        hasPlan: false,
        started: false,
        startDate: null,
        todayIndex: 0,
        weekIndex: 0,
        dayIndex: 0,
        totalWeeks: 0,
        totalSessions: 0,
        todaySession: null,
        todayLabel: "",
        sessionIndexGuess: 0,
      };
    }

    const weeks = extractWeeks(latestPlan);
    const totalWeeks = weeks.length || Number(latestPlan?.weeks || 0) || 0;
    const totalSessions = countTotalSessions(latestPlan);

    const start = parseYMD(latestPlan?.startDate);
    const started = !!start;

    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));

    const todayIndex = started ? diffDaysUTC(start, todayUTC) : 0;
    const safeTodayIndex = Math.max(0, todayIndex);

    const weekIndex = totalWeeks ? Math.floor(safeTodayIndex / 7) : Math.floor(safeTodayIndex / 7);
    const dayIndex = safeTodayIndex % 7;

    const { sess, dayLabel, sessionIndexGuess } = getPlanSessionForDay(latestPlan, weekIndex, dayIndex);

    return {
      hasPlan: true,
      started,
      startDate: start ? ymd(start) : null,
      todayIndex: safeTodayIndex,
      weekIndex,
      dayIndex,
      totalWeeks,
      totalSessions,
      todaySession: sess,
      todayLabel: dayLabel,
      sessionIndexGuess,
    };
  }, [latestPlan]);

  /**
   * ✅ Live stats for the active plan:
   * - completed sessions
   * - minutes
   * - km
   * - last 7 days count
   *
   * Reads: users/{uid}/trainSessions where planId == latestPlan.id
   */
  useEffect(() => {
    if (!user || !latestPlan?.id) return;

    setPlanStatsLoading(true);

    const ref = collection(db, "users", user.uid, "trainSessions");
    const qRef = query(
      ref,
      where("planId", "==", latestPlan.id),
      orderBy("completedAt", "desc"),
      limit(250)
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const completedCount = rows.length;

        let minutes = 0;
        let distanceKm = 0;

        const now = new Date();
        const nowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
        const last7Start = new Date(nowUTC.getTime() - 6 * 24 * 60 * 60 * 1000);

        let last7Count = 0;

        for (const r of rows) {
          minutes += minutesFromSessionDoc(r);
          distanceKm += distanceKmFromSessionDoc(r);

          const dateStr = String(r?.date || "");
          const d = parseYMD(dateStr);
          if (d && d >= last7Start && d <= nowUTC) last7Count += 1;
        }

        const lastCompletedAt = rows?.[0]?.completedAt || null;

        setPlanStats({
          completedCount,
          minutes: Math.round(minutes),
          distanceKm: Number(distanceKm.toFixed(1)),
          last7Count,
          lastCompletedAt,
        });

        setPlanStatsLoading(false);
      },
      () => setPlanStatsLoading(false)
    );

    return () => unsub();
  }, [user, latestPlan?.id]);

  const planCompletionPct = useMemo(() => {
    if (!planProgress.hasPlan) return 0;
    const total = Number(planProgress.totalSessions || 0);
    const done = Number(planStats.completedCount || 0);
    if (!total) return 0;
    return clamp(Math.round((done / total) * 100), 0, 100);
  }, [planProgress.hasPlan, planProgress.totalSessions, planStats.completedCount]);

  const renderPlansPanel = () => {
    // Loading state
    if (plansLoading) {
      return (
        <View style={s.plansCard}>
          <View style={s.plansTopRow}>
            <Text style={s.cardSectionTitle}>Your plan</Text>
            <ActivityIndicator />
          </View>
          <Text style={s.plansMuted}>Loading…</Text>
        </View>
      );
    }

    const hasPlans = Array.isArray(plans) && plans.length > 0;

    return (
      <View style={s.plansCard}>
        <View style={s.plansTopRow}>
          <Text style={s.cardSectionTitle}>Your plan</Text>

          {/* Plan builder route */}
          <TouchableOpacity
            style={[s.plansCreateBtn, isBuildingPlan && { opacity: 0.6 }]}
            activeOpacity={0.9}
            disabled={isBuildingPlan}
            onPress={() => router.push("/training/builder")}
          >
            {isBuildingPlan ? (
              <ActivityIndicator size="small" />
            ) : (
              <Feather name="zap" size={16} color="#111111" />
            )}
            <Text style={s.plansCreateBtnText}>{isBuildingPlan ? "Building…" : "Build plan"}</Text>
          </TouchableOpacity>
        </View>

        {/* ✅ Building banner */}
        {isBuildingPlan ? (
          <View style={s.buildingBanner}>
            <View style={s.buildingLeft}>
              <ActivityIndicator />
              <View style={{ flex: 1 }}>
                <Text style={s.buildingTitle} numberOfLines={1}>
                  Building your plan…
                </Text>
                <Text style={s.buildingSub} numberOfLines={2}>
                  {planBuild.planName ? `“${planBuild.planName}”` : "AI is generating your programme"}
                  {planBuild.message ? ` • ${planBuild.message}` : ""}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={s.buildingOpenBtn}
              activeOpacity={0.85}
              onPress={() => router.push("/training/builder")}
            >
              <Text style={s.buildingOpenText}>Open</Text>
              <Feather name="chevron-right" size={14} color={accentText} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ✅ No plan yet */}
        {!hasPlans ? (
          <>
            <Text style={s.plansMuted}>
              No plans yet. Build one and it’ll show up here with week + today + stats.
            </Text>

            <TouchableOpacity
              style={[s.plansBigBtn, isBuildingPlan && { opacity: 0.6 }]}
              activeOpacity={0.9}
              disabled={isBuildingPlan}
              onPress={() => router.push("/training/builder")}
            >
              {isBuildingPlan ? <ActivityIndicator /> : <Feather name="plus" size={18} color="#111111" />}
              <Text style={s.plansBigBtnText}>
                {isBuildingPlan ? "Plan is building…" : "Create your first plan"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* ✅ ACTIVE PLAN DASHBOARD */}
            <TouchableOpacity
              style={s.planHero}
              activeOpacity={0.92}
              onPress={() => handleOpenPlan(latestPlan.id)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.planHeroTitle} numberOfLines={1}>
                  {latestPlan.name || "Training plan"}
                </Text>
                <Text style={s.planHeroSub} numberOfLines={2}>
                  {formatPlanSubtitle(latestPlan) || "Programme"}
                  {latestPlan.startDate ? ` • starts ${latestPlan.startDate}` : ""}
                </Text>
              </View>

              <View style={s.planHeroRight}>
                <Text style={s.planPct}>{planCompletionPct}%</Text>
                <Text style={s.planPctSub}>complete</Text>
              </View>
            </TouchableOpacity>

            {/* progress bar */}
            <View style={s.progressBarOuter}>
              <View style={[s.progressBarInner, { width: `${planCompletionPct}%`, backgroundColor: accentBg }]} />
            </View>

            {/* week + today row */}
            <View style={s.planRow2}>
              <View style={s.planMiniCard}>
                <Text style={s.planMiniLabel}>Current week</Text>
                <Text style={s.planMiniValue}>
                  {planProgress.started ? `Week ${planProgress.weekIndex + 1}` : "—"}
                </Text>
                <Text style={s.planMiniSub}>
                  {planProgress.started
                    ? `Day ${planProgress.dayIndex + 1} of 7`
                    : latestPlan.startDate
                    ? `Starts ${latestPlan.startDate}`
                    : "Add a start date in plan"}
                </Text>
              </View>

              <View style={s.planMiniCard}>
                <Text style={s.planMiniLabel}>This week</Text>
                <Text style={s.planMiniValue}>
                  {planStatsLoading ? "…" : String(planStats.last7Count || 0)}
                </Text>
                <Text style={s.planMiniSub}>sessions done (7d)</Text>
              </View>
            </View>

            {/* Today card */}
            <View style={s.todayCard}>
              <View style={s.todayTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.todayLabel}>Today</Text>
                  <Text style={s.todayTitle} numberOfLines={1}>
                    {planProgress.todaySession ? fmtSessionTitle(planProgress.todaySession) : "No session found"}
                  </Text>
                  <Text style={s.todaySub} numberOfLines={2}>
                    {planProgress.todaySession
                      ? [
                          isRunLikePlan(latestPlan) ? "Run" : (latestPlan.primaryActivity || "Training"),
                          fmtSessionMeta(planProgress.todaySession),
                        ].filter(Boolean).join(" • ")
                      : "Open your plan to see today’s workout"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={s.todayOpenBtn}
                  activeOpacity={0.9}
                  onPress={() => handleOpenPlan(latestPlan.id)}
                >
                  <Text style={s.todayOpenText}>Open</Text>
                  <Feather name="chevron-right" size={16} color={accentText} />
                </TouchableOpacity>
              </View>

              {/* quick actions */}
              <View style={s.quickRow}>
                <TouchableOpacity
                  style={s.quickBtn}
                  activeOpacity={0.9}
                  onPress={() => handleOpenPlan(latestPlan.id)}
                >
                  <Feather name="layers" size={16} color={colors.text} />
                  <Text style={s.quickText}>View plan</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.quickBtn}
                  activeOpacity={0.9}
                  onPress={() => router.push("/training/plans")}
                >
                  <Feather name="list" size={16} color={colors.text} />
                  <Text style={s.quickText}>All plans</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.quickBtn}
                  activeOpacity={0.9}
                  onPress={() => {
                    // “Stats” view inside this page for now:
                    Alert.alert(
                      "Plan stats",
                      `${planStats.completedCount || 0} sessions completed\n${planStats.minutes || 0} minutes\n${planStats.distanceKm || 0} km`,
                      [{ text: "OK" }]
                    );
                  }}
                >
                  <Feather name="bar-chart-2" size={16} color={colors.text} />
                  <Text style={s.quickText}>Stats</Text>
                </TouchableOpacity>
              </View>

              {/* KPI strip */}
              <View style={s.kpiRow}>
                <View style={s.kpiChip}>
                  <Text style={s.kpiLabel}>Completed</Text>
                  <Text style={s.kpiValue}>
                    {planStatsLoading ? "…" : `${planStats.completedCount}/${planProgress.totalSessions || "—"}`}
                  </Text>
                </View>

                <View style={s.kpiChip}>
                  <Text style={s.kpiLabel}>Minutes</Text>
                  <Text style={s.kpiValue}>{planStatsLoading ? "…" : String(planStats.minutes || 0)}</Text>
                </View>

                <View style={s.kpiChip}>
                  <Text style={s.kpiLabel}>Distance</Text>
                  <Text style={s.kpiValue}>{planStatsLoading ? "…" : `${planStats.distanceKm || 0} km`}</Text>
                </View>
              </View>
            </View>

            {/* footer row */}
            <View style={s.plansMetaRow}>
              <Text style={s.plansMuted}>{plans.length} plans saved</Text>

              <TouchableOpacity style={s.plansLink} activeOpacity={0.85} onPress={handleOpenPlansList}>
                <Text style={s.plansLinkText}>View all</Text>
                <Feather name="chevron-right" size={14} color={accentText} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    );
  };

  // ✅ header MUST remain the same (kept identical, only added dashboard below it)
  const renderHeader = () => (
    <View style={s.headerWrap}>
      <View style={s.headerRow}>
        <Text style={s.headerTitle}>Workouts</Text>

        <TouchableOpacity
          style={s.createBtn}
          activeOpacity={0.9}
          onPress={() => router.push("/training/create")}
        >
          <Feather name="plus" size={18} color="#111111" />
          <Text style={s.createBtnText}>Create</Text>
        </TouchableOpacity>
      </View>

      {/* ✅ new plan dashboard */}
      {renderPlansPanel()}

      <View style={s.searchBox}>
        <Feather name="search" size={16} color={colors.subtext} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search workouts, exercises, notes…"
          placeholderTextColor={colors.subtext}
          style={s.searchInput}
          keyboardAppearance={isDark ? "dark" : "light"}
          returnKeyType="search"
          autoCorrect={false}
        />
        {!!search && (
          <TouchableOpacity
            onPress={() => setSearch("")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="x-circle" size={16} color={colors.subtext} />
          </TouchableOpacity>
        )}
      </View>

      <View style={s.filterRow}>
        {TYPE_FILTERS.map((f) => {
          const active = typeFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[s.filterPill, active && s.filterPillActive]}
              activeOpacity={0.85}
              onPress={() => setTypeFilter(f.key)}
            >
              <Text style={[s.filterText, active && s.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={s.metaRow}>
        <Text style={s.metaText}>
          {filtered.length} / {templates.length} templates
        </Text>

        <TouchableOpacity
          style={s.metaLink}
          onPress={() => router.push("/training/schedule-workout")}
          activeOpacity={0.85}
        >
          <Text style={s.metaLinkText}>Schedule</Text>
          <Feather name="chevron-right" size={14} color={accentText} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderItem = ({ item }) => {
    const blocks = Array.isArray(item.blocks) ? item.blocks : [];
    const itemCount = sumItems(blocks);
    const highlights = getPrimaryMovements(blocks);
    const duration = Number(item.durationMin || item.duration || 0);

    return (
      <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => handleOpen(item.id)}>
        <View style={s.cardTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle} numberOfLines={1}>
              {item.name || "Workout"}
            </Text>

            <Text style={s.cardSub} numberOfLines={1}>
              {fmtType(item.type)}
              {item.goal ? ` • ${item.goal}` : ""}
              {duration ? ` • ${duration} min` : ""}
            </Text>
          </View>

          <Feather name="chevron-right" size={18} color={colors.subtext} />
        </View>

        <View style={s.chipRow}>
          <View style={s.chip}>
            <Text style={s.chipLabel}>Blocks</Text>
            <Text style={s.chipValue}>{blocks.length}</Text>
          </View>

          <View style={s.chip}>
            <Text style={s.chipLabel}>Items</Text>
            <Text style={s.chipValue}>{itemCount}</Text>
          </View>

          {!!item.lastUsedAt && (
            <View style={s.chip}>
              <Text style={s.chipLabel}>Used</Text>
              <Text style={s.chipValue}>recent</Text>
            </View>
          )}
        </View>

        {!!highlights.length && (
          <Text style={s.highlights} numberOfLines={2}>
            {highlights.join(" • ")}
          </Text>
        )}

        <View style={s.cardActions}>
          <TouchableOpacity style={s.actionPill} activeOpacity={0.85} onPress={() => handleDuplicate(item)}>
            <Feather name="copy" size={14} color={colors.text} />
            <Text style={s.actionPillText}>Duplicate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.actionPill}
            activeOpacity={0.85}
            onPress={() =>
              router.push({
                pathname: "/training/schedule-workout",
                params: { templateId: item.id },
              })
            }
          >
            <Feather name="calendar" size={14} color={colors.text} />
            <Text style={s.actionPillText}>Schedule</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.actionPill, s.actionDanger]} activeOpacity={0.85} onPress={() => handleDelete(item)}>
            <Feather name="trash-2" size={14} color={colors.text} />
            <Text style={s.actionPillText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          loading ? (
            <View style={s.emptyWrap}>
              <ActivityIndicator />
              <Text style={s.emptyText}>Loading workouts…</Text>
            </View>
          ) : (
            <View style={s.emptyWrap}>
              <Text style={s.emptyTitle}>
                {templates.length ? "No matches" : "No workouts yet"}
              </Text>
              <Text style={s.emptyText}>
                {templates.length
                  ? "Try a different search or filter."
                  : "Create your first workout template to reuse and schedule it."}
              </Text>

              <TouchableOpacity style={s.emptyBtn} activeOpacity={0.9} onPress={() => router.push("/training/create")}>
                <Feather name="plus" size={18} color="#111111" />
                <Text style={s.emptyBtnText}>Create workout</Text>
              </TouchableOpacity>
            </View>
          )
        }
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? "#111217" : "#FFFFFF";
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";

  const softShadow = isDark
    ? { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4 }
    : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 2 };

  const border = isDark ? "#1F2128" : silverMed;

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    listContent: { paddingHorizontal: 18, paddingBottom: FOOTER_OFFSET },

    headerWrap: { paddingTop: 8, paddingBottom: 12 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 },
    headerTitle: { fontSize: 30, fontWeight: "900", letterSpacing: 0.6, color: colors.text, textTransform: "uppercase" },

    createBtn: { backgroundColor: accentBg, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8, ...softShadow },
    createBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", fontSize: 12 },

    plansCard: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 12, ...softShadow },
    plansTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 },
    cardSectionTitle: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.9, textTransform: "uppercase" },

    plansCreateBtn: { backgroundColor: accentBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
    plansCreateBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", fontSize: 11 },
    plansMuted: { color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    buildingBanner: {
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    buildingLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
    buildingTitle: { color: colors.text, fontWeight: "900", fontSize: 13 },
    buildingSub: { marginTop: 2, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },
    buildingOpenBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? "#0E0F12" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    buildingOpenText: { color: accentText, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },

    /* ✅ Runna-level plan dashboard */
    planHero: {
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    planHeroTitle: { color: colors.text, fontWeight: "900", fontSize: 15 },
    planHeroSub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    planHeroRight: { alignItems: "flex-end" },
    planPct: { color: colors.text, fontWeight: "900", fontSize: 18 },
    planPctSub: { marginTop: 2, color: colors.subtext, fontWeight: "800", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },

    progressBarOuter: {
      marginTop: 10,
      height: 10,
      borderRadius: 999,
      backgroundColor: isDark ? "#0B0C10" : "#ECEFF4",
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    progressBarInner: {
      height: "100%",
      borderRadius: 999,
    },

    planRow2: { marginTop: 10, flexDirection: "row", gap: 10 },
    planMiniCard: {
      flex: 1,
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    planMiniLabel: { color: colors.subtext, fontWeight: "900", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
    planMiniValue: { marginTop: 6, color: colors.text, fontWeight: "900", fontSize: 16 },
    planMiniSub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    todayCard: {
      marginTop: 10,
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    todayTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
    todayLabel: { color: colors.subtext, fontWeight: "900", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
    todayTitle: { marginTop: 6, color: colors.text, fontWeight: "900", fontSize: 15 },
    todaySub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    todayOpenBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? "#0E0F12" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    todayOpenText: { color: accentText, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },

    quickRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    quickBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: isDark ? "#0E0F12" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    quickText: { color: colors.text, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },

    kpiRow: { marginTop: 12, flexDirection: "row", gap: 10 },
    kpiChip: {
      flex: 1,
      backgroundColor: isDark ? "#0E0F12" : silverLight,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    kpiLabel: { color: colors.subtext, fontWeight: "900", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 },
    kpiValue: { marginTop: 6, color: colors.text, fontWeight: "900", fontSize: 13 },

    plansMetaRow: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    plansLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: isDark ? "#0E0F12" : silverLight, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    plansLinkText: { color: accentText, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
    plansBigBtn: { marginTop: 12, backgroundColor: accentBg, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, ...softShadow },
    plansBigBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", fontSize: 12 },

    searchBox: { backgroundColor: panelBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 10 : 8, borderWidth: StyleSheet.hairlineWidth, borderColor: border, flexDirection: "row", alignItems: "center", gap: 8, ...softShadow },
    searchInput: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 14, paddingVertical: 0 },

    filterRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    filterPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: border, ...softShadow },
    filterPillActive: { backgroundColor: accentBg, borderColor: accentBg },
    filterText: { color: colors.text, fontWeight: "800", fontSize: 12 },
    filterTextActive: { color: "#111111", fontWeight: "900" },

    metaRow: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    metaText: { color: colors.subtext, fontWeight: "700", fontSize: 12 },
    metaLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: isDark ? "#0E0F12" : silverLight, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    metaLinkText: { color: accentText, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },

    card: { backgroundColor: cardBg, borderRadius: 22, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: border, marginBottom: 12, ...softShadow },
    cardTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    cardTitle: { color: colors.text, fontWeight: "900", fontSize: 16, letterSpacing: 0.2 },
    cardSub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
    chip: { backgroundColor: isDark ? "#0E0F12" : silverLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: border, minWidth: "30%" },
    chipLabel: { color: colors.subtext, fontWeight: "800", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 },
    chipValue: { marginTop: 4, color: colors.text, fontWeight: "900", fontSize: 13 },

    highlights: { marginTop: 10, color: colors.text, fontWeight: "700", fontSize: 12, lineHeight: 18, opacity: isDark ? 0.9 : 1 },

    cardActions: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    actionPill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: border },
    actionDanger: { borderColor: isDark ? "#3A1E22" : "#F0C9D0", backgroundColor: isDark ? "#1A0F12" : "#FFF5F6" },
    actionPillText: { color: colors.text, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },

    emptyWrap: { paddingTop: 26, paddingHorizontal: 10, alignItems: "center", gap: 10 },
    emptyTitle: { color: colors.text, fontWeight: "900", fontSize: 18, textTransform: "uppercase", letterSpacing: 0.7, textAlign: "center" },
    emptyText: { color: colors.subtext, fontWeight: "650", fontSize: 13, lineHeight: 18, textAlign: "center" },
    emptyBtn: { marginTop: 8, backgroundColor: accentBg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8, ...softShadow },
    emptyBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", fontSize: 12 },
  });
}
