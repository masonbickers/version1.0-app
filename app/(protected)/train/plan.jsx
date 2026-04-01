// app/(protected)/train/plan.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

// ---- constants -------------------------------------------------------------
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PRIMARY = "#E6FF3B"; // neon yellow
const SILVER_LIGHT = "#F3F4F6";
const SILVER_MEDIUM = "#E1E3E8";

const emptyWeek = () => ({ days: DAYS.map((d) => ({ day: d, sessions: [] })) });

function sessionSportKind(sess) {
  const raw = String(
    sess?.workout?.sport || sess?.sessionType || sess?.type || ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym")) return "strength";
  if (raw.includes("run")) return "run";

  const runTypes = new Set([
    "easy",
    "recovery",
    "interval",
    "intervals",
    "threshold",
    "tempo",
    "long",
    "race",
    "strides",
    "fartlek",
  ]);
  if (runTypes.has(raw)) return "run";

  return "other";
}

// ------------------------------------------------------------------
// THEME — SAP gel style to match Train index
function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: isDark ? "#050506" : "#F5F5F7",
    card: isDark ? "#111217" : SILVER_LIGHT,
    text: colors.text,
    subtext: colors.subtext,
    border: SILVER_MEDIUM,
    muted: isDark ? "#18191E" : "#E6E7EC",
    primaryBg: PRIMARY,
    primaryText: "#111111",
    headerTitle: colors.text,
    headerSubtitle: colors.subtext,
  };
}

// Encode session → route key (same as Train index)
function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

/* ------------------------------------------------------------------ */
/*  NORMALISERS (match train/index and support all types)             */
/* ------------------------------------------------------------------ */

const mkStep = (over = {}) => ({
  type: over.type || "Run",
  notes: over.notes || "",
  durationType: over.durationType || "Time (min)",
  durationValue: Number(
    over.durationValue ?? (over.durationType === "Distance (km)" ? 1 : 10)
  ),
  intensityType: over.intensityType || "None",
  intensityTarget: over.intensityTarget || "",
  isRepeat: over.isRepeat || false,
  repeatReps: Number(over.repeatReps || 2),
  steps: Array.isArray(over.steps) ? over.steps : [],
});

const withWarmCool = (session) => {
  const steps = Array.isArray(session.segments) ? session.segments : [];
  const hasWU = steps.some((s) => /^warm/i.test(s.type));
  const hasCD = steps.some((s) => /^cool/i.test(s.type));
  const patched = [...steps];

  if (!hasWU) {
    patched.unshift(
      mkStep({
        type: "Warmup",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1–Z2",
        notes: "Build gradually; drills",
      })
    );
  }
  if (!hasCD) {
    patched.push(
      mkStep({
        type: "CoolDown",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1",
        notes: "Ease down; light mobility",
      })
    );
  }

  return { ...session, segments: patched };
};

function segmentToWorkoutStep(seg) {
  if (!seg) return null;

  if (seg.isRepeat) {
    return {
      type: "repeat",
      reps: Number(seg.repeatReps || 1),
      steps: (seg.steps || [])
        .map((inner) => segmentToWorkoutStep(inner))
        .filter(Boolean),
    };
  }

  let durationType = "time";
  if (seg.durationType === "Distance (km)") durationType = "distance";
  else if (seg.durationType === "Reps") durationType = "reps";

  const base = {
    type: String(seg.type || "Run").toLowerCase(),
    durationType,
    durationValue: Number(seg.durationValue || 0),
  };

  if (seg.intensityType && seg.intensityType !== "None") {
    let intensityType = "custom";
    if (seg.intensityType === "Pace (/km)") intensityType = "pace";
    if (seg.intensityType === "HR Zone") intensityType = "hr";
    if (seg.intensityType === "RPE") intensityType = "rpe";

    base.intensity = {
      type: intensityType,
      target: seg.intensityTarget || "",
    };
  }

  if (seg.notes) base.notes = seg.notes;

  return base;
}

function segmentsToWorkoutSteps(segments) {
  return (segments || [])
    .map((s) => segmentToWorkoutStep(s))
    .filter(Boolean);
}

function estimateTotalsFromWorkoutSteps(steps) {
  let totalDistanceKm = 0;
  let totalDurationSec = 0;

  const walk = (step, repsMultiplier = 1) => {
    if (!step) return;

    if (step.type === "repeat" && Array.isArray(step.steps)) {
      const reps = Number(step.reps || 1);
      step.steps.forEach((inner) => walk(inner, repsMultiplier * reps));
      return;
    }

    const durType = step.durationType;
    const val = Number(step.durationValue || 0);
    if (!Number.isFinite(val) || val <= 0) return;

    if (durType === "distance") {
      totalDistanceKm += val * repsMultiplier;
    } else if (durType === "time") {
      totalDurationSec += val * 60 * repsMultiplier;
    }
  };

  (steps || []).forEach((s) => walk(s, 1));

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationSec: Math.round(totalDurationSec),
  };
}

/**
 * Normalise ONE session so this page works for:
 * - run (full warmup/main/cooldown logic)
 * - hyrox, strength, cross-train, etc. (no forced warm/cool)
 */
const normaliseSessionForPlan = (sess) => {
  if (!sess) return null;

  const sportKind = sessionSportKind(sess);
  const sessionType = String(
    sess.sessionType || sess.type || ""
  ).toLowerCase();

  // ------------------------------------------------------------------
  // 1) NON-RUN SESSIONS (hyrox, strength, cross-train, etc.)
  // ------------------------------------------------------------------
  if (sportKind === "strength" || sportKind === "other") {
    const existingWorkout = sess.workout || {};

    const durationMinRaw =
      existingWorkout.totalDurationSec != null
        ? existingWorkout.totalDurationSec / 60
        : sess.targetDurationMin ?? sess.durationMin ?? 0;

    const distanceKmRaw =
      existingWorkout.totalDistanceKm != null
        ? existingWorkout.totalDistanceKm
        : sess.targetDistanceKm ?? sess.distanceKm ?? 0;

    const durationMin = Number(durationMinRaw || 0) || undefined;
    const distanceKm = Number(distanceKmRaw || 0) || undefined;

    const totalDurationSec =
      existingWorkout.totalDurationSec != null
        ? existingWorkout.totalDurationSec
        : durationMin
        ? Math.round(durationMin * 60)
        : 0;

    const totalDistanceKm =
      existingWorkout.totalDistanceKm != null
        ? existingWorkout.totalDistanceKm
        : distanceKm || 0;

    return {
      ...sess,
      sessionType: sportKind === "strength" ? "gym" : sessionType || "training",
      targetDurationMin:
        sess.targetDurationMin != null ? sess.targetDurationMin : durationMin,
      targetDistanceKm:
        sess.targetDistanceKm != null ? sess.targetDistanceKm : distanceKm,
      totalDurationSec,
      totalDistanceKm,
      workout: {
        sport:
          existingWorkout.sport ||
          (sportKind === "strength" ? "strength" : sessionType || "training"),
        totalDurationSec,
        totalDistanceKm,
        steps: Array.isArray(existingWorkout.steps)
          ? existingWorkout.steps
          : [],
      },
    };
  }

  // ------------------------------------------------------------------
  // 2) RUN SESSIONS (keep existing behaviour)
  // ------------------------------------------------------------------

  const baseWithSegments = withWarmCool(
    sess.segments ? sess : { ...sess, segments: sess.segments || [] }
  );
  let segments = Array.isArray(baseWithSegments.segments)
    ? baseWithSegments.segments
    : [];

  const durationMinRaw =
    baseWithSegments.targetDurationMin != null
      ? baseWithSegments.targetDurationMin
      : baseWithSegments.durationMin;
  const distanceKmRaw =
    baseWithSegments.targetDistanceKm != null
      ? baseWithSegments.targetDistanceKm
      : baseWithSegments.distanceKm;

  const durationMin = Number(durationMinRaw || 0) || undefined;
  const distanceKm = Number(distanceKmRaw || 0) || undefined;

  const hasMain = segments.some(
    (s) =>
      s &&
      !/^(warm|cool)/i.test(String(s.type || "")) &&
      !s.isRepeat
  );

  if (!hasMain) {
    let durationType = "Time (min)";
    let durationValue = 0;

    if (distanceKm && !durationMin) {
      durationType = "Distance (km)";
      durationValue = distanceKm;
    } else if (durationMin) {
      durationType = "Time (min)";
      durationValue = durationMin;
    } else {
      durationType = "Time (min)";
      durationValue = 10;
    }

    const warm = segments.find((s) =>
      /^warm/i.test(String(s.type || ""))
    );
    const cool = segments.find((s) =>
      /^cool/i.test(String(s.type || ""))
    );

    const newSegs = [];
    if (warm) newSegs.push(warm);
    newSegs.push(
      mkStep({
        type: "Run",
        durationType,
        durationValue,
        intensityType: "None",
        notes: baseWithSegments.notes || "",
      })
    );
    if (cool) newSegs.push(cool);

    if (newSegs.length) segments = newSegs;
  }

  const workoutSteps =
    baseWithSegments.workout?.steps && baseWithSegments.workout.steps.length
      ? baseWithSegments.workout.steps
      : segmentsToWorkoutSteps(segments);

  const totalsFromSteps = estimateTotalsFromWorkoutSteps(workoutSteps);

  const finalDistanceKm =
    totalsFromSteps.totalDistanceKm ||
    baseWithSegments.workout?.totalDistanceKm ||
    distanceKm ||
    0;
  const finalDurationSec =
    totalsFromSteps.totalDurationSec ||
    baseWithSegments.workout?.totalDurationSec ||
    (durationMin ? durationMin * 60 : 0);
  const finalDurationMin = finalDurationSec
    ? finalDurationSec / 60
    : durationMin || 0;

  return {
    ...baseWithSegments,
    sessionType: "run",
    type: baseWithSegments.type || "Run",
    segments,
    targetDurationMin:
      baseWithSegments.targetDurationMin != null
        ? baseWithSegments.targetDurationMin
        : finalDurationMin || undefined,
    targetDistanceKm:
      baseWithSegments.targetDistanceKm != null
        ? baseWithSegments.targetDistanceKm
        : finalDistanceKm || undefined,
    totalDistanceKm: finalDistanceKm || undefined,
    totalDurationSec: finalDurationSec || undefined,
    workout: {
      sport: baseWithSegments.workout?.sport || "run",
      totalDistanceKm: finalDistanceKm || 0,
      totalDurationSec: finalDurationSec || 0,
      steps: workoutSteps,
    },
  };
};

const normaliseWeeksForClient = (weeks) =>
  (weeks || []).map((w, wi) => ({
    title: w.title || `Week ${wi + 1}`,
    days: (w.days || DAYS.map((d) => ({ day: d, sessions: [] }))).map(
      (d) => ({
        day: d.day,
        sessions: (d.sessions || [])
          .map(normaliseSessionForPlan)
          .filter(Boolean),
      })
    ),
  }));

/* ------------------------------------------------------------------ */

export default function PlanPage() {
  const theme = useScreenTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [currentWeekIndex, setCurrentWeekIndex] = useState(0);
  const [removing, setRemoving] = useState(false);

  // Load latest plan (same as Train index)
  useEffect(() => {
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          setPlan(null);
          setLoading(false);
          return;
        }

        const ref = collection(db, "users", uid, "plans");
        const snap = await getDocs(
          query(ref, orderBy("updatedAt", "desc"), limit(1))
        );

        if (snap.empty) {
          setPlan(null);
        } else {
          const d = snap.docs[0];
          const data = d.data();
          const weeksNormalised = normaliseWeeksForClient(data.weeks || []);
          setPlan({ id: d.id, ...data, weeks: weeksNormalised });
        }
      } catch (e) {
        console.log("[plan] load plan error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Keep week index valid
  useEffect(() => {
    if (!plan?.weeks) return;
    setCurrentWeekIndex((prev) =>
      Math.min(Math.max(prev, 0), plan.weeks.length - 1)
    );
  }, [plan]);

  // Plan totals
  const totals = useMemo(() => {
    if (!plan?.weeks) return { sessions: 0, mins: 0, km: 0 };
    let sTotals = 0;
    let m = 0;
    let k = 0;
    plan.weeks.forEach((w) =>
      w.days?.forEach((d) =>
        d.sessions?.forEach((sess) => {
          sTotals += 1;
          const duration =
            sess.workout?.totalDurationSec != null
              ? sess.workout.totalDurationSec / 60
              : sess.targetDurationMin ?? sess.durationMin ?? 0;
          const dist =
            sess.workout?.totalDistanceKm != null
              ? sess.workout.totalDistanceKm
              : sess.targetDistanceKm ?? sess.distanceKm ?? 0;
          m += Number(duration || 0);
          k += Number(dist || 0);
        })
      )
    );
    return {
      sessions: sTotals,
      mins: Math.round(m),
      km: Number(k.toFixed(1)),
    };
  }, [plan]);

  // Current week object
  const currentWeek = useMemo(() => {
    if (!plan?.weeks) return emptyWeek();
    return plan.weeks[currentWeekIndex] ?? emptyWeek();
  }, [plan, currentWeekIndex]);

  // Today info for highlighting / jump
  const todayInfo = useMemo(() => {
    const now = new Date();
    const jsIdx = now.getDay();
    const dayLabel = JS_DAY_LABELS[jsIdx];

    return {
      jsIdx,
      dayLabel,
      dateLabel: now.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    };
  }, []);

  const todayDayIndexInCurrentWeek = useMemo(() => {
    const days = currentWeek.days || [];
    return days.findIndex((d) => d.day === todayInfo.dayLabel);
  }, [currentWeek, todayInfo.dayLabel]);

  // Jump to week containing today (rough heuristic: week 0 is "this week")
  const handleJumpToTodayWeek = () => {
    if (!plan?.weeks?.length) return;
    setCurrentWeekIndex(0);
  };

  // --- Remove plan -------------------------------------------------------
  const confirmRemovePlan = () => {
    if (!plan || removing) return;

    Alert.alert(
      "Remove training plan?",
      "This will delete your current plan. Your completed activities and history will be kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const uid = auth.currentUser?.uid;
              if (!uid || !plan?.id) return;
              setRemoving(true);
              const ref = doc(db, "users", uid, "plans", plan.id);
              await deleteDoc(ref);
              setPlan(null);
              setCurrentWeekIndex(0);
            } catch (e) {
              console.log("[plan] remove plan error:", e);
              Alert.alert(
                "Couldn’t remove plan",
                "Something went wrong while removing your plan. Please try again."
              );
            } finally {
              setRemoving(false);
            }
          },
        },
      ]
    );
  };

  // UI helpers --------------------------------------------------------------
  const renderSessionChip = (sess, sessionIndex, dayIndex) => {
    const durationMin =
      sess.workout?.totalDurationSec != null
        ? Math.round(sess.workout.totalDurationSec / 60)
        : sess.targetDurationMin ?? sess.durationMin;
    const distanceKm =
      sess.workout?.totalDistanceKm != null
        ? sess.workout.totalDistanceKm
        : sess.targetDistanceKm ?? sess.distanceKm;

    const parts = [];
    if (durationMin) parts.push(`${durationMin} min`);
    if (distanceKm) parts.push(`${Number(distanceKm).toFixed(1)} km`);

    const meta = parts.join(" · ");

    const key = buildSessionKey(
      plan.id,
      currentWeekIndex,
      dayIndex,
      sessionIndex
    );

    return (
      <TouchableOpacity
        key={key}
        onPress={() =>
          router.push(`/train/session/${encodeURIComponent(key)}`)
        }
        style={[
          styles.sessionChip,
          { borderColor: theme.border, backgroundColor: theme.bg },
        ]}
        activeOpacity={0.85}
      >
        <Text style={[styles.sessionTitle, { color: theme.text }]}>
          {sess.title || sess.type || "Session"}
        </Text>
        {meta ? (
          <Text style={[styles.sessionMeta, { color: theme.subtext }]}>
            {meta}
          </Text>
        ) : null}
        <Feather
          name="chevron-right"
          size={14}
          color={theme.subtext}
          style={{ marginLeft: 4 }}
        />
      </TouchableOpacity>
    );
  };

  // ------------------------------------------------------------------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: 80,
          gap: 18,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={22} color={theme.text} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={[styles.hTitle, { color: theme.headerTitle }]}>
              PLAN
            </Text>
            <Text
              style={[styles.hSubtitle, { color: theme.headerSubtitle }]}
            >
              Overview of your training block
            </Text>
          </View>

          {plan && (
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: "/train/edit-plan",
                  params: { edit: "1", id: plan.id },
                })
              }
              style={[styles.pillBtn, { borderColor: theme.border }]}
              activeOpacity={0.85}
            >
              <Feather name="edit-3" size={14} color={theme.text} />
              <Text style={{ color: theme.text, fontWeight: "700" }}>
                Edit
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Plan summary */}
        <View style={styles.section}>
          {loading ? (
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={{ color: theme.subtext }}>Loading plan…</Text>
            </View>
          ) : !plan ? (
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.h4, { color: theme.text }]}>
                No training plan
              </Text>
              <Text style={{ color: theme.subtext, marginTop: 4 }}>
                Head back to Train and create your first plan with AI or
                from scratch.
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/train/create-home")}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: theme.primaryBg, marginTop: 10 },
                ]}
                activeOpacity={0.85}
              >
                <Feather
                  name="sparkles"
                  size={16}
                  color={theme.primaryText}
                />
                <Text
                  style={{
                    color: theme.primaryText,
                    fontWeight: "800",
                  }}
                >
                  Create plan
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.label, { color: theme.subtext }]}>
                Plan summary
              </Text>
              <Text style={[styles.h4, { color: theme.text }]}>
                {plan.name || "Training Plan"}
              </Text>
              <Text style={{ color: theme.subtext, marginTop: 2 }}>
                {plan.primaryActivity || "Training"} ·{" "}
                {plan.weeks?.length || 1} week
                {plan.weeks?.length > 1 ? "s" : ""}
              </Text>

              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text
                    style={[styles.summaryValue, { color: theme.text }]}
                  >
                    {totals.sessions}
                  </Text>
                  <Text
                    style={[styles.summaryLabel, { color: theme.subtext }]}
                  >
                    Sessions
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text
                    style={[styles.summaryValue, { color: theme.text }]}
                  >
                    {totals.mins}
                  </Text>
                  <Text
                    style={[styles.summaryLabel, { color: theme.subtext }]}
                  >
                    Minutes
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text
                    style={[styles.summaryValue, { color: theme.text }]}
                  >
                    {totals.km} km
                  </Text>
                  <Text
                    style={[styles.summaryLabel, { color: theme.subtext }]}
                  >
                    Distance
                  </Text>
                </View>
              </View>

              {/* Today pill + Jump to today */}
              <View style={styles.summaryFooterRow}>
                <View
                  style={[
                    styles.todayPill,
                    { backgroundColor: theme.bg, borderColor: theme.border },
                  ]}
                >
                  <Feather
                    name="sun"
                    size={14}
                    color={theme.subtext}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={{ color: theme.subtext, fontSize: 12 }}>
                    Today: {todayInfo.dateLabel}
                  </Text>
                </View>

                {plan.weeks?.length > 0 && (
                  <TouchableOpacity
                    onPress={handleJumpToTodayWeek}
                    style={styles.jumpBtn}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={{
                        color: theme.primaryBg,
                        fontSize: 12,
                        fontWeight: "700",
                      }}
                    >
                      Jump to this week
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Week selector + week view */}
        {plan && (
          <View style={styles.section}>
            <View
              style={[
                styles.card,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              {/* Week selector */}
              <View style={styles.weekHeaderRow}>
                <TouchableOpacity
                  onPress={() =>
                    setCurrentWeekIndex((i) => Math.max(i - 1, 0))
                  }
                  disabled={currentWeekIndex === 0}
                  style={styles.weekNavBtn}
                >
                  <Feather
                    name="chevron-left"
                    size={18}
                    color={
                      currentWeekIndex === 0
                        ? theme.subtext
                        : theme.text
                    }
                  />
                </TouchableOpacity>

                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={[styles.label, { color: theme.subtext }]}>
                    Week {currentWeekIndex + 1} of{" "}
                    {plan.weeks?.length || 1}
                  </Text>
                  {currentWeek.title && (
                    <Text
                      style={{
                        color: theme.subtext,
                        fontSize: 11,
                        marginTop: 2,
                      }}
                    >
                      {currentWeek.title}
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  onPress={() =>
                    setCurrentWeekIndex((i) =>
                      Math.min(i + 1, (plan.weeks?.length || 1) - 1)
                    )
                  }
                  disabled={
                    currentWeekIndex >= (plan.weeks?.length || 1) - 1
                  }
                  style={styles.weekNavBtn}
                >
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={
                      currentWeekIndex >= (plan.weeks?.length || 1) - 1
                        ? theme.subtext
                        : theme.text
                    }
                  />
                </TouchableOpacity>
              </View>

              {/* Week day-by-day list */}
              <View style={{ marginTop: 8 }}>
                {(currentWeek.days || []).map((d, dayIndex) => {
                  const isToday =
                    d.day === todayInfo.dayLabel &&
                    currentWeekIndex === 0; // treating week 0 as "this week"

                  const hasSessions = d.sessions && d.sessions.length > 0;

                  return (
                    <View
                      key={`${d.day}_${dayIndex}`}
                      style={[
                        styles.dayRow,
                        {
                          borderColor: theme.border,
                          backgroundColor: isToday
                            ? theme.bg
                            : "transparent",
                        },
                      ]}
                    >
                      <View style={styles.dayLabelCol}>
                        <Text
                          style={[
                            styles.dayLabel,
                            {
                              color: isToday
                                ? theme.primaryBg
                                : theme.text,
                            },
                          ]}
                        >
                          {d.day}
                        </Text>
                        {isToday && (
                          <Text
                            style={{
                              color: theme.primaryBg,
                              fontSize: 11,
                              marginTop: 2,
                            }}
                          >
                            Today
                          </Text>
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        {hasSessions ? (
                          d.sessions.map((sess, sessionIndex) =>
                            renderSessionChip(
                              sess,
                              sessionIndex,
                              dayIndex
                            )
                          )
                        ) : (
                          <Text
                            style={{
                              color: theme.subtext,
                              fontSize: 12,
                            }}
                          >
                            Rest / no structured session
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* Delete plan button at bottom */}
        {plan && (
          <View style={[styles.section, { marginTop: 8 }]}>
            <View style={{ alignItems: "center" }}>
              <TouchableOpacity
                onPress={confirmRemovePlan}
                style={styles.deletePlanBtn}
                activeOpacity={0.85}
                disabled={removing}
              >
                <Feather
                  name="trash-2"
                  size={16}
                  color={removing ? "#FF8A80" : "#FF3B30"}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={{
                    color: removing ? "#FF8A80" : "#FF3B30",
                    fontWeight: "700",
                    fontSize: 13,
                  }}
                >
                  {removing ? "Removing plan…" : "Delete plan"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------
// styles
const styles = StyleSheet.create({
  header: {
    marginTop: 6,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    padding: 6,
    marginRight: 4,
  },
  hTitle: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  hSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },

  h4: { fontSize: 18, fontWeight: "800" },

  section: {
    marginBottom: 24,
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 14,
    gap: 10,
  },

  label: { fontSize: 12, fontWeight: "700" },

  // summary
  summaryRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  summaryItem: {
    flex: 1,
    paddingVertical: 6,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: "800",
  },
  summaryLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  summaryFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  todayPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  jumpBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },

  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  pillBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  // week / days
  weekHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  weekNavBtn: { padding: 4 },

  dayRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dayLabelCol: {
    width: 60,
  },
  dayLabel: {
    fontWeight: "800",
  },

  sessionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  sessionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  sessionMeta: {
    fontSize: 12,
    marginLeft: 6,
  },

  deletePlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#FF3B30",
    marginTop: 4,
  },
});
