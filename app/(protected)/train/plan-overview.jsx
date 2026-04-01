// app/(protected)/train/view-plan.jsx

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ───────────────────────────────────────────
   Helpers
─────────────────────────────────────────── */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRIMARY = "#E6FF3B";

const pad2 = (n) => String(n).padStart(2, "0");

function secondsToHMM(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function metresToKm(m) {
  if (!Number.isFinite(m) || m <= 0) return "";
  return (m / 1000).toFixed(1).replace(/\.0$/, "") + " km";
}

function safeUpper(v) {
  return String(v || "").toUpperCase();
}

/* ───────────────────────────────────────────
   STOCK PLAN SUPPORT
   - weeks[].sessions[] with slot
   - steps contain REPEAT with nested RUN steps
─────────────────────────────────────────── */

function isStockWeek(w) {
  return !!w && !Array.isArray(w.days) && Array.isArray(w.sessions);
}

function mapStockWeekToDays(stockWeek, runDays, longRunDay) {
  const days = DAYS.map((d) => ({ day: d, sessions: [] }));

  const sessions = Array.isArray(stockWeek?.sessions) ? stockWeek.sessions : [];
  const bySlot = new Map();
  sessions.forEach((s) => bySlot.set(String(s?.slot || ""), s));

  const runOrder =
    Array.isArray(runDays) && runDays.length ? runDays : ["Mon", "Tue", "Thu", "Sun"];
  const longDay =
    longRunDay && DAYS.includes(longRunDay) ? longRunDay : runOrder[runOrder.length - 1];

  const pickDay = (d) => days.find((x) => x.day === d);

  const q1 = bySlot.get("QUALITY_1");
  const q2 = bySlot.get("QUALITY_2");
  const easy = bySlot.get("EASY");
  const long = bySlot.get("LONG");

  if (long) pickDay(longDay)?.sessions.push(long);

  const remaining = runOrder.filter((d) => d !== longDay);
  if (q1) pickDay(remaining[0] || runOrder[0])?.sessions.push(q1);
  if (q2) pickDay(remaining[1] || runOrder[1])?.sessions.push(q2);
  if (easy) pickDay(remaining[2] || runOrder[2])?.sessions.push(easy);

  return { ...stockWeek, days };
}

/* ───────────────────────────────────────────
   Step formatting (raw + stock + normalised)
─────────────────────────────────────────── */

function formatStepLine(step) {
  if (!step || typeof step !== "object") return "";

  // STOCK RAW: { type:"RUN", duration:{type:"TIME"/"DISTANCE", seconds/meters}, target:{paceKey:"VO2"} }
  const rawType = String(step.type || step.stepType || "STEP").toUpperCase();

  // Repeat container => not displayed as a preview line (we expand it)
  if (rawType === "REPEAT" || rawType === "repeat") return "";

  const name = String(step.name || "").trim();

  // duration
  let durText = "";
  const dur = step.duration && typeof step.duration === "object" ? step.duration : null;

  // stock raw duration
  if (dur?.type) {
    const dt = String(dur.type).toUpperCase();
    if (dt === "TIME") durText = secondsToHMM(Number(dur.seconds || 0));
    if (dt === "DISTANCE") durText = metresToKm(Number(dur.meters || 0));
  }

  // normalised duration
  if (!durText && step.durationType) {
    const dt = String(step.durationType).toLowerCase();
    const v = Number(step.durationValue || 0);
    if (dt === "time") durText = v >= 120 ? secondsToHMM(v) : secondsToHMM(v * 60);
    if (dt === "distance") durText = v > 50 ? metresToKm(v) : metresToKm(v * 1000);
  }

  // targets
  let targetText = "";
  const paceKey = step?.target?.paceKey || step?.intensity?.target;
  const paceKeyType = step?.intensity?.type;

  if (paceKey) {
    // stock uses paceKey token
    targetText = ` @ ${String(paceKey)}`;
  } else if (paceKeyType && step?.intensity?.target) {
    targetText = ` @ ${String(step.intensity.target)}`;
  } else if (step?.targetType === "pace_range" && step?.targetValue) {
    const { minSecPerKm, maxSecPerKm } = step.targetValue;
    if (Number.isFinite(minSecPerKm) && Number.isFinite(maxSecPerKm)) {
      const fast = `${Math.floor(minSecPerKm / 60)}:${pad2(Math.round(minSecPerKm % 60))}`;
      const slow = `${Math.floor(maxSecPerKm / 60)}:${pad2(Math.round(maxSecPerKm % 60))}`;
      targetText = ` @ ${fast}–${slow}/km`;
    }
  }

  const label = name || (rawType === "RUN" ? "Run" : rawType.toLowerCase());

  return `${label}${durText ? ` • ${durText}` : ""}${targetText}`;
}

/**
 * ✅ Flatten steps for preview:
 * - expands REPEAT blocks
 * - returns a list of “meaningful” step lines
 */
function flattenStepsForPreview(steps, out = [], max = 3) {
  if (!Array.isArray(steps) || out.length >= max) return out;

  for (const st of steps) {
    if (out.length >= max) break;
    if (!st || typeof st !== "object") continue;

    const t = String(st.type || st.stepType || "").toUpperCase();

    if (t === "REPEAT") {
      // expand
      const reps = Number(st.repeat || st.repeatCount || st.reps || 0) || 0;
      const inner = Array.isArray(st.steps) ? st.steps : [];

      // optional: show a compact “Repeat ×n” line if we have room AND no inner lines exist
      // but usually better to show the inner workout lines
      flattenStepsForPreview(inner, out, max);
      continue;
    }

    const line = formatStepLine(st);
    if (line) out.push(line);
  }

  return out;
}

/* ───────────────────────────────────────────
   Distance estimates from stock steps
   (so “0 km planned” becomes useful where possible)
─────────────────────────────────────────── */

function sumDistanceMetersFromSteps(steps) {
  if (!Array.isArray(steps)) return 0;

  const sumStep = (st) => {
    if (!st || typeof st !== "object") return 0;
    const t = String(st.type || "").toUpperCase();

    if (t === "REPEAT") {
      const reps = Number(st.repeat || 0) || 0;
      const inner = Array.isArray(st.steps) ? st.steps : [];
      const innerSum = inner.reduce((a, x) => a + sumStep(x), 0);
      return reps * innerSum;
    }

    const dur = st.duration && typeof st.duration === "object" ? st.duration : null;
    if (dur?.type && String(dur.type).toUpperCase() === "DISTANCE") {
      return Number(dur.meters || 0) || 0;
    }

    return 0;
  };

  return steps.reduce((a, st) => a + sumStep(st), 0);
}

function sessionDistanceKm(session) {
  // If your generated plans already store a km field, keep supporting it
  const km =
    (typeof session?.workout?.totalDistanceKm === "number" && session.workout.totalDistanceKm) ||
    (typeof session?.distanceKm === "number" && session.distanceKm) ||
    (typeof session?.plannedDistanceKm === "number" && session.plannedDistanceKm) ||
    null;

  if (typeof km === "number" && Number.isFinite(km) && km > 0) return km;

  // Stock: derive from distance steps (e.g. 6×400m = 2.4km)
  const meters = sumDistanceMetersFromSteps(session?.steps);
  if (meters > 0) return Math.round((meters / 1000) * 10) / 10;

  return null;
}

function weekPlannedKm(week) {
  const days = Array.isArray(week?.days) ? week.days : [];
  let total = 0;
  for (const d of days) {
    for (const s of d?.sessions || []) {
      const km = sessionDistanceKm(s);
      if (typeof km === "number") total += km;
    }
  }
  return Math.round(total * 10) / 10;
}

/* ───────────────────────────────────────────
   Firestore fetch (same as before)
─────────────────────────────────────────── */

async function tryGetDoc(pathSegments) {
  const ref = doc(db, ...pathSegments);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

async function fetchPlanById(uid, planId) {
  if (!planId) return null;

  const candidates = [
    ["users", uid, "plans", planId],
    ["users", uid, "runPlans", planId],
    ["plans", planId],
    ["runPlans", planId],
  ];

  for (const segs of candidates) {
    try {
      const found = await tryGetDoc(segs);
      if (found) return found;
    } catch {}
  }
  return null;
}

async function fetchLatestFromSubcollection(uid, sub) {
  const col = collection(db, "users", uid, sub);

  try {
    const q1 = query(col, orderBy("updatedAt", "desc"), limit(1));
    const s1 = await getDocs(q1);
    if (!s1.empty) return { id: s1.docs[0].id, ...s1.docs[0].data() };
  } catch {}

  try {
    const q2 = query(col, orderBy("createdAt", "desc"), limit(1));
    const s2 = await getDocs(q2);
    if (!s2.empty) return { id: s2.docs[0].id, ...s2.docs[0].data() };
  } catch {}

  try {
    const q3 = query(col, limit(1));
    const s3 = await getDocs(q3);
    if (!s3.empty) return { id: s3.docs[0].id, ...s3.docs[0].data() };
  } catch {}

  return null;
}

async function fetchLatestTopLevel(colName, uidField, uid) {
  try {
    const q1 = query(
      collection(db, colName),
      where(uidField, "==", uid),
      orderBy("updatedAt", "desc"),
      limit(1)
    );
    const s1 = await getDocs(q1);
    if (!s1.empty) return { id: s1.docs[0].id, ...s1.docs[0].data() };
  } catch {}

  try {
    const q2 = query(
      collection(db, colName),
      where(uidField, "==", uid),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const s2 = await getDocs(q2);
    if (!s2.empty) return { id: s2.docs[0].id, ...s2.docs[0].data() };
  } catch {}

  return null;
}

async function fetchLatestPlan(uid) {
  const p1 = await fetchLatestFromSubcollection(uid, "plans");
  if (p1) return p1;

  const p2 = await fetchLatestFromSubcollection(uid, "runPlans");
  if (p2) return p2;

  const p3 =
    (await fetchLatestTopLevel("plans", "uid", uid)) ||
    (await fetchLatestTopLevel("plans", "userId", uid));
  if (p3) return p3;

  const p4 =
    (await fetchLatestTopLevel("runPlans", "uid", uid)) ||
    (await fetchLatestTopLevel("runPlans", "userId", uid));
  if (p4) return p4;

  return null;
}

function extractWeeksFromDoc(docObj) {
  if (!docObj) return [];
  const p = docObj?.plan || docObj;
  const nested = p?.plan;
  const raw = p?.weeks || nested?.weeks || docObj?.weeks || [];
  return Array.isArray(raw) ? raw : [];
}

/* ───────────────────────────────────────────
   Screen
─────────────────────────────────────────── */

export default function ViewPlanPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, isDark } = useTheme();

  const theme = useMemo(() => {
    return {
      bg: isDark ? "#050506" : "#F5F5F7",
      card: isDark ? "#111217" : "#FFFFFF",
      text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
      subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
      border: isDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)",
      pillBg: isDark ? "#0D0E12" : "#F3F4F6",
    };
  }, [colors, isDark]);

  const styles = useMemo(() => makeStyles(theme), [theme]);

  const planId =
    typeof params?.planId === "string"
      ? params.planId
      : Array.isArray(params?.planId)
      ? params.planId[0]
      : null;

  const [user, setUser] = useState(null);
  const [planDoc, setPlanDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [activeWeekIdx, setActiveWeekIdx] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
    });
    return () => unsub();
  }, [router]);

  const loadPlan = useCallback(async () => {
    if (!user?.uid) return;

    setError("");
    try {
      let p = null;
      if (planId) p = await fetchPlanById(user.uid, planId);
      if (!p) p = await fetchLatestPlan(user.uid);

      if (!p) {
        setPlanDoc(null);
        setError("No plan found yet. Generate one first.");
        return;
      }

      setPlanDoc(p);
      setActiveWeekIdx(0);
    } catch (e) {
      setPlanDoc(null);
      setError(e?.message || "Failed to load plan.");
    }
  }, [user?.uid, planId]);

  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      setLoading(true);
      await loadPlan();
      setLoading(false);
    })();
  }, [user?.uid, loadPlan]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPlan();
    setRefreshing(false);
  }, [loadPlan]);

  const planRoot = planDoc?.plan || planDoc || {};
  const meta = planDoc?.meta || planRoot?.meta || {};
  const athleteProfile = planDoc?.athleteProfile || planRoot?.athleteProfile || meta?.athleteProfile || {};
  const availability = athleteProfile?.availability || meta?.availability || {};

  const runDays = Array.isArray(availability?.runDays) ? availability.runDays : null;
  const longRunDay = availability?.longRunDay || null;

  const weeks = useMemo(() => {
    const raw = extractWeeksFromDoc(planDoc);

    // normalise into week.days always
    const mapped = raw.map((w, idx) => {
      if (isStockWeek(w)) {
        const wk = mapStockWeekToDays(w, runDays, longRunDay);
        return {
          ...wk,
          weekNumber: typeof wk.weekNumber === "number" ? wk.weekNumber : idx + 1,
          days: (wk.days || []).map((d) => ({
            day: d.day,
            sessions: Array.isArray(d.sessions) ? d.sessions : [],
          })),
        };
      }

      // already has days
      const byDay = new Map();
      (w.days || []).forEach((d) => byDay.set(d.day, d));
      const days = DAYS.map((day) => byDay.get(day) || { day, sessions: [] });

      return {
        ...w,
        weekNumber: typeof w.weekNumber === "number" ? w.weekNumber : idx + 1,
        days,
      };
    });

    return mapped;
  }, [planDoc, runDays, longRunDay]);

  const summary = useMemo(() => {
    const goal = athleteProfile?.goal || meta?.goal || {};

    const name = meta?.name || planRoot?.name || planRoot?.id || "Run plan";
    const distance = planRoot?.distance || goal?.distance || meta?.distance || "";

    // ✅ IMPORTANT: weeks count should come from the plan data (stock template = weeks.length)
    const weeksCount = weeks.length;

    const runsPerWeek =
      planRoot?.runsPerWeek ||
      availability?.sessionsPerWeek ||
      meta?.sessionsPerWeek ||
      "";

    const difficulty = availability?.difficulty || meta?.difficulty || "Balanced";

    const weeklyKmNow = athleteProfile?.current?.weeklyKm ?? meta?.weeklyKm ?? "";
    const longestRunNow = athleteProfile?.current?.longestRunKm ?? meta?.longestRunKm ?? "";

    return {
      name,
      distance,
      weeksCount,
      runsPerWeek,
      difficulty,
      runDays: runDays || [],
      longRunDay: longRunDay || "",
      weeklyKmNow,
      longestRunNow,
    };
  }, [athleteProfile, meta, planRoot, weeks.length, runDays, longRunDay]);

  const activeWeek = weeks[activeWeekIdx] || weeks[0];

  if (loading) {
    return (
      <View style={styles.page}>
        <TopBar title="View plan" onBack={() => router.back()} styles={styles} />
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading plan…</Text>
        </View>
      </View>
    );
  }

  if (!planDoc || !weeks.length) {
    return (
      <View style={styles.page}>
        <TopBar title="View plan" onBack={() => router.back()} styles={styles} />
        <View style={[styles.card, { margin: 16 }]}>
          <Text style={styles.h1}>No plan</Text>
          <Text style={styles.muted}>{error || "Generate a plan first."}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <TopBar title="View plan" onBack={() => router.back()} styles={styles} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Title card */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {summary.name}
          </Text>
          <Text style={styles.heroSub}>
            {summary.distance || "Run"} • {summary.weeksCount} weeks • {summary.runsPerWeek || "—"} runs/week
          </Text>
        </View>

        {/* Summary */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>SUMMARY</Text>

          <View style={styles.pillsRow}>
            <Pill label="GOAL" value={summary.distance || "—"} styles={styles} />
            <Pill label="TARGET" value={"—"} styles={styles} />
            <Pill label="WEEKS" value={String(summary.weeksCount)} styles={styles} />
            <Pill label="RUNS/WK" value={String(summary.runsPerWeek || "—")} styles={styles} />
            <Pill label="LONG RUN" value={summary.longRunDay || "—"} styles={styles} />
            <Pill label="DIFFICULTY" value={summary.difficulty || "—"} styles={styles} />
          </View>

          {!!summary.runDays.length && (
            <Text style={styles.muted2}>
              Run days: <Text style={styles.bold}>{summary.runDays.join(", ")}</Text>
            </Text>
          )}

          <View style={styles.hr} />

          <Text style={styles.muted2}>
            Current volume: <Text style={styles.bold}>{summary.weeklyKmNow || "—"} km/wk</Text> •{" "}
            Longest run: <Text style={styles.bold}>{summary.longestRunNow || "—"} km</Text>
          </Text>
        </View>

        {/* Week chips */}
        <Text style={styles.sectionLabel}>WEEKS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
          {weeks.map((w, idx) => {
            const active = idx === activeWeekIdx;
            const km = weekPlannedKm(w);
            return (
              <Pressable
                key={`w-${idx}`}
                onPress={() => setActiveWeekIdx(idx)}
                style={[styles.weekChip, active && styles.weekChipActive]}
              >
                <Text style={[styles.weekChipText, active && styles.weekChipTextActive]}>
                  W{w.weekNumber}
                </Text>
                <Text style={[styles.weekChipSub, active && styles.weekChipSubActive]}>
                  {km ? `${km}k` : "Ok"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Week block */}
        <View style={styles.weekBlock}>
          <View style={styles.weekHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.weekTitle}>Week {activeWeek.weekNumber}</Text>
              <Text style={styles.weekMeta}>
                {weekPlannedKm(activeWeek) ? `${weekPlannedKm(activeWeek)} km planned` : "0 km planned"} •{" "}
                {activeWeek?.focus || "Build"}
              </Text>
            </View>

            <Text style={styles.chev}>▾</Text>
          </View>

          <View style={{ gap: 12 }}>
            {(activeWeek?.days || []).map((d) => (
              <DaySection key={`${activeWeek.weekNumber}-${d.day}`} dayObj={d} styles={styles} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/* ───────────────────────────────────────────
   UI components
─────────────────────────────────────────── */

function TopBar({ title, onBack, styles }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} style={styles.backBtn}>
        <Text style={styles.backTxt}>←</Text>
      </Pressable>
      <Text style={styles.topTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Pill({ label, value, styles }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillValue}>{value}</Text>
    </View>
  );
}

function DaySection({ dayObj, styles }) {
  const sessions = Array.isArray(dayObj?.sessions) ? dayObj.sessions : [];
  const isRun = sessions.length > 0;

  return (
    <View style={styles.dayBlock}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{dayObj.day}</Text>
        <View style={[styles.dayBadge, isRun ? styles.badgeRun : styles.badgeRest]}>
          <Text style={[styles.dayBadgeTxt, isRun ? styles.badgeRunTxt : styles.badgeRestTxt]}>
            {isRun ? "RUN" : "REST"}
          </Text>
        </View>
      </View>

      {sessions.map((s, i) => {
        const title = s?.name || s?.title || safeUpper(s?.sessionType || s?.type || "RUN");
        const notes = String(s?.notes || "").trim();

        const previewLines = flattenStepsForPreview(s?.steps || [], [], 3);

        return (
          <View key={`${dayObj.day}-s-${i}`} style={styles.sessionCard}>
            <Text style={styles.sessionTitle}>{title}</Text>
            {!!notes && <Text style={styles.sessionNotes}>{notes}</Text>}

            {previewLines.length ? (
              <View style={{ marginTop: 8, gap: 4 }}>
                {previewLines.map((line, idx) => (
                  <Text key={`${dayObj.day}-line-${i}-${idx}`} style={styles.stepLine}>
                    • {line}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={[styles.stepLine, { opacity: 0.7, marginTop: 8 }]}>
                • No step details
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/* ───────────────────────────────────────────
   Styles (matches your screenshot vibe)
─────────────────────────────────────────── */

function makeStyles(t) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: t.bg },

    topBar: {
      paddingTop: 10,
      paddingBottom: 12,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    backBtn: {
      width: 40,
      height: 36,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.pillBg,
      alignItems: "center",
      justifyContent: "center",
    },
    backTxt: { color: t.text, fontSize: 18, fontWeight: "900" },
    topTitle: { flex: 1, textAlign: "center", color: t.text, fontSize: 16, fontWeight: "900" },

    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    muted: { color: t.subtext, fontWeight: "700" },

    hero: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 14,
      marginBottom: 12,
    },
    heroTitle: { color: t.text, fontSize: 20, fontWeight: "900" },
    heroSub: { color: t.subtext, fontSize: 12, fontWeight: "800", marginTop: 6 },

    card: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 14,
      marginBottom: 14,
    },

    sectionLabel: {
      color: t.text,
      fontWeight: "900",
      fontSize: 13,
      letterSpacing: 0.6,
      marginBottom: 10,
    },

    pillsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

    pill: {
      backgroundColor: t.pillBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 999,
      paddingVertical: 10,
      paddingHorizontal: 12,
      minWidth: 88,
    },
    pillLabel: { color: t.subtext, fontSize: 11, fontWeight: "800" },
    pillValue: { color: t.text, fontSize: 14, fontWeight: "900", marginTop: 2 },

    muted2: { color: t.subtext, fontSize: 13, fontWeight: "700", marginTop: 12 },
    bold: { color: t.text, fontWeight: "900" },
    hr: { height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginTop: 12 },

    weekChip: {
      width: 64,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.pillBg,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    weekChipActive: {
      borderColor: "rgba(230,255,59,0.55)",
      backgroundColor: "rgba(230,255,59,0.18)",
    },
    weekChipText: { color: t.text, fontWeight: "900", fontSize: 12 },
    weekChipTextActive: { color: t.text },
    weekChipSub: { color: t.subtext, fontWeight: "800", fontSize: 11, marginTop: 3 },
    weekChipSubActive: { color: t.text, opacity: 0.85 },

    weekBlock: {
      backgroundColor: t.card,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 14,
    },
    weekHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    weekTitle: { color: t.text, fontSize: 16, fontWeight: "900" },
    weekMeta: { color: t.subtext, fontSize: 12, fontWeight: "800", marginTop: 4 },
    chev: { color: t.subtext, fontSize: 18, fontWeight: "900" },

    dayBlock: {
      backgroundColor: "rgba(255,255,255,0.03)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: 16,
      padding: 12,
      gap: 10,
    },
    dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    dayTitle: { color: t.text, fontSize: 14, fontWeight: "900" },

    dayBadge: {
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
    },
    badgeRun: {
      backgroundColor: "rgba(230,255,59,0.15)",
      borderColor: "rgba(230,255,59,0.45)",
    },
    badgeRest: {
      backgroundColor: "rgba(148,163,184,0.10)",
      borderColor: t.border,
    },
    dayBadgeTxt: { fontSize: 12, fontWeight: "900" },
    badgeRunTxt: { color: t.text },
    badgeRestTxt: { color: t.subtext },

    sessionCard: {
      backgroundColor: t.bg,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      padding: 12,
    },
    sessionTitle: { color: t.text, fontSize: 16, fontWeight: "900" },
    sessionNotes: { color: t.subtext, fontSize: 13, fontWeight: "700", marginTop: 6, lineHeight: 18 },
    stepLine: { color: t.text, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  });
}
