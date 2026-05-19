// app/(protected)/summary/index.jsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";

import { db } from "../../../firebaseConfig";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";
import AccountSheet from "../../../components/AccountSheet";
import { useHomeDashboardData } from "../../../src/hooks/useHomeDashboardData";

const PRIMARY = "#E6FF3B";

/* ---------------- THEME ---------------- */
function useScreenTheme() {
  useTheme();

  return {
    bg: "#000000", // ✅ page stays pure black
    text: "#FFFFFF",
    subtext: "rgba(255,255,255,0.62)",
    border: "rgba(255,255,255,0.10)",
    muted: "rgba(255,255,255,0.06)",
    track: "rgba(255,255,255,0.12)",
    primaryBg: PRIMARY,
    primaryText: "#111111",

    // ✅ “Homex” style: soft glass gradient INSIDE sections only (your neon yellow tint)
    cardGradient: [
      "rgba(255,255,255,0.08)",
      "rgba(230,255,59,0.18)",
      "rgba(255,255,255,0.04)",
    ],
  };
}

/* ---------------- MOCK DATA (replace later) ---------------- */
const mockSummary = {
  name: "Mason",
  today: {
    move: { value: 560, goal: 800, unit: "kcal" },
    exercise: { value: 34, goal: 45, unit: "min" },
    stand: { value: 10, goal: 12, unit: "hrs" },
  },
  training: {
    currentPlan: "Hybrid Hyrox Block",
    currentWeek: 3,
    totalWeeks: 8,
    workoutsThisWeek: 5,
    weeklyMinutes: 315,
    weeklyDistanceKm: 42.7,
    nextSession: "Hyrox engine + sleds",
    nextSessionDay: "Tomorrow",
  },
  trends: {
    weeklyLoad: "↑ 6% vs last week",
    runningPace: "5:45 /km → 5:32 /km",
    strength: "Upper push volume up",
  },
  recentActivity: [
    {
      id: "1",
      title: "10 km progression run",
      subtitle: "Zone 2 → Zone 3 · 54:10",
      tag: "Run",
      day: "Mon",
    },
    {
      id: "2",
      title: "Hyrox engine session",
      subtitle: "Row · Sled · Burpees · Run",
      tag: "Hyrox",
      day: "Sat",
    },
    {
      id: "3",
      title: "Upper strength",
      subtitle: "Bench · Pull · Shoulders",
      tag: "Strength",
      day: "Thu",
    },
  ],
  recovery: {
    sleepHours: 7.4,
    sleepNote: "Sleep slightly down vs last week.",
    hrv: 82,
    hrvNote: "HRV stable – good readiness.",
    restingHr: 47,
    weight: 74.6,
  },
};

/* ---------------- HELPERS ---------------- */
const clamp = (v, g) => {
  if (!g || g <= 0) return 0;
  const p = v / g;
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(1, p));
};

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUpdatedAt(value) {
  const ms = toMillis(value);
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function pickNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function formatSleep(value) {
  const minutes =
    value > 24
      ? value
      : value > 0
        ? value * 60
        : 0;
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function metricValue(metrics, label, fallback = "—") {
  const match = (Array.isArray(metrics) ? metrics : []).find(
    (item) => String(item?.label || "").toLowerCase() === label.toLowerCase()
  );
  return match?.value || fallback;
}

function extractGarminHealthSummary(doc) {
  const payload = doc?.payload || doc?.data || doc?.summary || doc || {};
  const source = payload?.summary || payload?.dailySummary || payload?.wellnessSummary || payload;

  const sleepMinutes = pickNumber(
    source.sleepDurationMinutes,
    source.totalSleepMinutes,
    source.sleepingSeconds ? source.sleepingSeconds / 60 : null,
    source.durationInSeconds ? source.durationInSeconds / 60 : null,
    source.sleepHours
  );
  const steps = pickNumber(source.steps, source.totalSteps, source.stepCount);
  const restingHr = pickNumber(source.restingHeartRate, source.restingHr, source.rhr);
  const avgStress = pickNumber(source.averageStressLevel, source.avgStressLevel, source.stressLevel, source.stress);
  const bodyBattery = pickNumber(
    source.bodyBatteryMostRecentValue,
    source.bodyBattery,
    source.bodyBatteryHigh,
    source.bodyBatteryChargedValue
  );
  const hrv = pickNumber(source.hrv, source.hrvMs, source.lastNightAvg);
  const activeCalories = pickNumber(source.activeKilocalories, source.activeCalories, source.calories);

  const metrics = [
    sleepMinutes ? { icon: "moon", label: "Sleep", value: formatSleep(sleepMinutes) } : null,
    restingHr ? { icon: "heart", label: "RHR", value: `${Math.round(restingHr)} bpm` } : null,
    hrv ? { icon: "activity", label: "HRV", value: `${Math.round(hrv)} ms` } : null,
    bodyBattery ? { icon: "battery", label: "Battery", value: `${Math.round(bodyBattery)}` } : null,
    avgStress ? { icon: "zap", label: "Stress", value: `${Math.round(avgStress)}` } : null,
    steps ? { icon: "map", label: "Steps", value: `${Math.round(steps).toLocaleString()}` } : null,
    activeCalories ? { icon: "trending-up", label: "Active", value: `${Math.round(activeCalories)} Cal` } : null,
  ].filter(Boolean);

  if (!metrics.length) return null;

  let guidance = "Use this alongside how you feel before changing today’s training.";
  if ((sleepMinutes && sleepMinutes < 390) || (avgStress && avgStress >= 70)) {
    guidance = "Recovery looks pressured. Keep intensity controlled unless you feel unusually good.";
  } else if ((sleepMinutes && sleepMinutes >= 420) || (bodyBattery && bodyBattery >= 70)) {
    guidance = "Recovery looks usable. Train as planned if soreness and energy feel normal.";
  }

  return {
    dateLabel: formatUpdatedAt(doc?.updatedAt || doc?.fetchedAt || doc?.createdAt || doc?.fetchedAtMs || doc?.updatedAtMs),
    metrics,
    guidance,
  };
}

async function fetchGarminHealthDocs(uid) {
  const ref = collection(db, "users", uid, "garmin_health");
  const querySpecs = [
    query(ref, orderBy("updatedAt", "desc"), limit(12)),
    query(ref, orderBy("fetchedAt", "desc"), limit(12)),
    query(ref, orderBy("fetchedAtMs", "desc"), limit(12)),
  ];
  const batches = await Promise.all(
    querySpecs.map((spec) => getDocs(spec).catch(() => null))
  );
  const byId = new Map();
  batches.forEach((snap) => {
    snap?.docs?.forEach((item) => {
      byId.set(item.id, { id: item.id, ...(item.data() || {}) });
    });
  });
  return Array.from(byId.values()).sort(
    (a, b) =>
      toMillis(b.updatedAt || b.fetchedAt || b.createdAt || b.fetchedAtMs || b.updatedAtMs) -
      toMillis(a.updatedAt || a.fetchedAt || a.createdAt || a.fetchedAtMs || a.updatedAtMs)
  );
}

function Card({ theme, children, style }) {
  return (
    <LinearGradient
      colors={theme.cardGradient}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.card, { borderColor: theme.border }, style]}
    >
      {children}
    </LinearGradient>
  );
}

/* “Homex” pill stat */
function StatPill({ icon, value, label, theme }) {
  return (
    <View style={styles.statPill}>
      <View style={[styles.statIcon, { backgroundColor: "rgba(230,255,59,0.15)" }]}>
        <Feather name={icon} size={14} color={theme.primaryBg} />
      </View>

      <View>
        <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
        <Text style={[styles.statLabel, { color: theme.subtext }]}>{label}</Text>
      </View>
    </View>
  );
}

/* Progress row (kept from your summary, just styled cleaner) */
function ProgressRow({ title, metric, icon, theme }) {
  const pct = `${Math.max(8, Math.round(clamp(metric.value, metric.goal) * 100))}%`;

  return (
    <View style={styles.row}>
      <View style={[styles.iconCircle, { borderColor: theme.border }]}>
        <Feather name={icon} size={14} color={theme.primaryBg} />
      </View>

      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, { color: theme.text }]}>{title}</Text>
          <Text style={{ color: theme.subtext, fontSize: 12 }}>
            {metric.value} / {metric.goal} {metric.unit}
          </Text>
        </View>

        <View style={[styles.barTrack, { backgroundColor: theme.track }]}>
          <View style={[styles.barFill, { width: pct, backgroundColor: theme.primaryBg }]} />
        </View>
      </View>
    </View>
  );
}

function GarminHealthCard({ summary, theme }) {
  if (!summary) return null;

  return (
    <Card theme={theme}>
      <View style={styles.cardTopRow}>
        <View style={styles.sectionTitleRow}>
          <Feather name="watch" size={15} color={theme.primaryBg} />
          <Text style={styles.cardTitle}>Garmin readiness</Text>
        </View>
        {!!summary.dateLabel && (
          <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: "800" }}>
            {summary.dateLabel}
          </Text>
        )}
      </View>

      <View style={styles.garminMetricGrid}>
        {summary.metrics.slice(0, 6).map((metric) => (
          <View key={`${metric.label}-${metric.value}`} style={styles.garminMetric}>
            <Feather name={metric.icon} size={14} color={theme.primaryBg} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statLabel, { color: theme.subtext }]}>{metric.label}</Text>
              <Text style={[styles.statValue, { color: theme.text }]}>{metric.value}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={[styles.garminGuidance, { color: theme.text }]}>
        {summary.guidance}
      </Text>
    </Card>
  );
}

/* ---------------- SCREEN ---------------- */
export default function SummaryIndex() {
  const theme = useScreenTheme();
  const router = useRouter();
  const { user } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [garminHealthSummary, setGarminHealthSummary] = useState(null);
  const {
    loading: dashboardLoading,
    hasPlan,
    activePlanName,
    activePlanCount,
    primaryActivity,
    weekLabel,
    metrics,
    todayHero,
    statusLabel,
  } = useHomeDashboardData();

  const name = useMemo(() => user?.displayName || mockSummary.name || "You", [user]);
  const trainingSummary = useMemo(() => {
    const weekTotal = metricValue(metrics, "Week total");
    const sessions = metricValue(metrics, "Sessions");
    const weight = metricValue(metrics, "Weight");

    return {
      currentPlan: hasPlan
        ? activePlanName || `${primaryActivity || "Training"} plan`
        : dashboardLoading
          ? "Loading active plan"
          : "No active plan yet",
      currentWeekLabel: hasPlan ? weekLabel || "This week" : "This week",
      sessions,
      weeklyDistance: weekTotal,
      weeklyMinutes: "—",
      weight,
      nextSession: hasPlan
        ? todayHero?.title || "Open plan"
        : "Create a plan to see today's session",
      nextSessionDay: hasPlan
        ? todayHero?.eyebrow || statusLabel || "Today"
        : "Not set",
      planCountLabel:
        activePlanCount > 1 ? `${activePlanCount} active plans` : "Active plan",
    };
  }, [
    activePlanCount,
    activePlanName,
    dashboardLoading,
    hasPlan,
    metrics,
    primaryActivity,
    statusLabel,
    todayHero?.eyebrow,
    todayHero?.title,
    weekLabel,
  ]);

  useEffect(() => {
    let active = true;

    async function loadGarminHealthSummary() {
      if (!user?.uid) {
        setGarminHealthSummary(null);
        return;
      }

      try {
        const docs = await fetchGarminHealthDocs(user.uid);
        const nextSummary = docs.map(extractGarminHealthSummary).find(Boolean) || null;
        if (active) setGarminHealthSummary(nextSummary);
      } catch (error) {
        console.log("[summary] load Garmin health failed:", error);
        if (active) setGarminHealthSummary(null);
      }
    }

    loadGarminHealthSummary();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <AccountSheet visible={accountOpen} onClose={() => setAccountOpen(false)} user={user} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120, gap: 18, paddingTop: 6 }}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.hey, { color: theme.text }]}>Hey, {name}</Text>
            <Text style={[styles.sub, { color: theme.subtext }]}>Your training summary</Text>
          </View>

          <TouchableOpacity
            onPress={() => setAccountOpen(true)}
            style={[styles.avatar, { backgroundColor: theme.primaryBg }]}
            activeOpacity={0.9}
          >
            <Text style={{ fontWeight: "900", color: theme.primaryText }}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </TouchableOpacity>
        </View>

        {/* TODAY (with Homex-style inner pill row) */}
        <Card theme={theme}>
          <Text style={styles.cardTitle}>Today</Text>

          {/* Keep your progress rows */}
          <ProgressRow title="Move" metric={mockSummary.today.move} icon="zap" theme={theme} />
          <ProgressRow title="Exercise" metric={mockSummary.today.exercise} icon="activity" theme={theme} />
          <ProgressRow title="Stand" metric={mockSummary.today.stand} icon="clock" theme={theme} />

          {/* ✅ Homex-like inner pill row (your neon yellow) */}
          <View style={styles.innerPillRow}>
            <StatPill
              icon="activity"
              value={hasPlan ? trainingSummary.sessions : `${mockSummary.training.workoutsThisWeek}`}
              label="Sessions"
              theme={theme}
            />
            <StatPill
              icon="clock"
              value={hasPlan ? trainingSummary.weeklyMinutes : `${mockSummary.training.weeklyMinutes}`}
              label="Minutes"
              theme={theme}
            />
            <StatPill
              icon="map"
              value={hasPlan ? trainingSummary.weeklyDistance : `${mockSummary.training.weeklyDistanceKm.toFixed(1)} km`}
              label="Distance"
              theme={theme}
            />
          </View>
        </Card>

        {/* GARMIN READINESS */}
        <GarminHealthCard summary={garminHealthSummary} theme={theme} />

        {/* TRAINING BLOCK */}
        <Card theme={theme}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardTitle}>Training block</Text>

            <TouchableOpacity
              onPress={() => router.push("/train/plan")}
              style={[styles.smallPill, { borderColor: theme.border }]}
              activeOpacity={0.85}
            >
              <Feather name="calendar" size={14} color={theme.primaryBg} />
              <Text style={{ color: theme.text, fontWeight: "900", fontSize: 12 }}>
                View plan
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.big, { color: theme.text }]}>{trainingSummary.currentPlan}</Text>
          <Text style={{ color: theme.subtext, marginTop: 4 }}>
            {dashboardLoading
              ? "Checking your plan status"
              : hasPlan
                ? `${trainingSummary.currentWeekLabel} · ${trainingSummary.planCountLabel}`
                : "Start a plan to unlock this block"}
          </Text>

          {/* ✅ Same Homex pill row here too */}
          <View style={[styles.innerPillRow, { marginTop: 12 }]}>
            <StatPill
              icon="activity"
              value={hasPlan ? trainingSummary.sessions : `${mockSummary.training.workoutsThisWeek}`}
              label="Sessions"
              theme={theme}
            />
            <StatPill
              icon="clock"
              value={hasPlan ? trainingSummary.weeklyMinutes : `${mockSummary.training.weeklyMinutes}`}
              label="Minutes"
              theme={theme}
            />
            <StatPill
              icon="map"
              value={hasPlan ? trainingSummary.weeklyDistance : `${mockSummary.training.weeklyDistanceKm.toFixed(1)} km`}
              label="Distance"
              theme={theme}
            />
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.miniHeading, { color: theme.subtext }]}>Next session</Text>
            <Text style={{ color: theme.text, fontWeight: "800", marginTop: 4 }}>
              {trainingSummary.nextSessionDay} · {trainingSummary.nextSession}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push(hasPlan ? "/chat" : "/train/create-home")}
            style={[styles.primaryBtn, { backgroundColor: theme.primaryBg }]}
            activeOpacity={0.92}
          >
            <Feather name={hasPlan ? "message-circle" : "plus"} size={18} color={theme.primaryText} />
            <Text style={{ fontWeight: "900", color: theme.primaryText }}>
              {hasPlan ? "Ask coach about this week" : "Create a plan"}
            </Text>
          </TouchableOpacity>
        </Card>

        {/* TRENDS (pill chips) */}
        <Card theme={theme}>
          <Text style={styles.cardTitle}>Trends</Text>

          <View style={{ gap: 10 }}>
            <View style={[styles.trendChip, { borderColor: theme.border }]}>
              <Feather name="trending-up" size={14} color={theme.primaryBg} />
              <Text style={{ color: theme.text, fontWeight: "800" }}>
                Load: {mockSummary.trends.weeklyLoad}
              </Text>
            </View>

            <View style={[styles.trendChip, { borderColor: theme.border }]}>
              <Feather name="trending-up" size={14} color={theme.primaryBg} />
              <Text style={{ color: theme.text, fontWeight: "800" }}>
                Run pace: {mockSummary.trends.runningPace}
              </Text>
            </View>

            <View style={[styles.trendChip, { borderColor: theme.border }]}>
              <Feather name="trending-up" size={14} color={theme.primaryBg} />
              <Text style={{ color: theme.text, fontWeight: "800" }}>
                {mockSummary.trends.strength}
              </Text>
            </View>
          </View>
        </Card>

        {/* RECENT ACTIVITY */}
        <Card theme={theme}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardTitle}>Recent activity</Text>

            <TouchableOpacity
              onPress={() => router.push("/train")}
              style={[styles.smallPill, { borderColor: theme.border }]}
              activeOpacity={0.85}
            >
              <Text style={{ color: theme.text, fontWeight: "900", fontSize: 12 }}>
                See all
              </Text>
              <Feather name="chevron-right" size={14} color={theme.text} />
            </TouchableOpacity>
          </View>

          {mockSummary.recentActivity.map((a, i) => (
            <View
              key={a.id}
              style={[
                styles.activityRow,
                i < mockSummary.recentActivity.length - 1 && {
                  borderBottomColor: theme.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={[styles.tagCircle, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text, fontWeight: "900" }}>
                  {a.tag[0]}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "800" }} numberOfLines={1}>
                  {a.title}
                </Text>
                <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
                  {a.subtitle}
                </Text>
              </View>

              <Text style={{ color: theme.subtext, fontSize: 12 }}>{a.day}</Text>
            </View>
          ))}
        </Card>

        {/* RECOVERY (Homex pill row) */}
        <Card theme={theme} style={{ marginBottom: 28 }}>
          <Text style={styles.cardTitle}>Recovery & body</Text>

          <View style={styles.innerPillRow}>
            <StatPill icon="moon" value={`${mockSummary.recovery.sleepHours.toFixed(1)}h`} label="Sleep" theme={theme} />
            <StatPill icon="heart" value={`${mockSummary.recovery.hrv}`} label="HRV" theme={theme} />
            <StatPill icon="activity" value={`${mockSummary.recovery.restingHr}`} label="RHR" theme={theme} />
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.miniHeading, { color: theme.subtext }]}>Notes</Text>
            <Text style={{ color: theme.text, marginTop: 6 }}>{mockSummary.recovery.sleepNote}</Text>
            <Text style={{ color: theme.text, marginTop: 6 }}>{mockSummary.recovery.hrvNote}</Text>
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.miniHeading, { color: theme.subtext }]}>Weight</Text>
            <Text style={[styles.big, { color: theme.text, marginTop: 4 }]}>
              {mockSummary.recovery.weight.toFixed(1)} kg
            </Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- STYLES ---------------- */
const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  hey: { fontSize: 22, fontWeight: "900" },
  sub: { fontSize: 12, marginTop: 4 },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },

  card: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontSize: 13,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  smallPill: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(0,0,0,0.20)",
  },

  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },

  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  rowTitle: { fontSize: 14, fontWeight: "800" },

  barTrack: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 999 },

  big: { fontSize: 18, fontWeight: "900" },
  miniHeading: { fontSize: 12, fontWeight: "900", textTransform: "uppercase" },

  primaryBtn: {
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
  },

  /* ✅ Homex inner pill row */
  innerPillRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 18,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    marginTop: 8,
  },

  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontWeight: "900",
    fontSize: 14,
  },
  statLabel: {
    fontSize: 11,
    marginTop: 1,
  },

  garminMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  garminMetric: {
    width: "48%",
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  garminGuidance: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },

  trendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(0,0,0,0.28)",
  },

  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },

  tagCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(211, 89, 89, 0.25)",
  },
});
