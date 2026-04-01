// app/(protected)/summary/index.jsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import AccountSheet from "../../components/AccountSheet";

const PRIMARY = "#E6FF3B";

/* ---------------- THEME ---------------- */
function useScreenTheme() {
  const { colors } = useTheme();

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

/* ---------------- SCREEN ---------------- */
export default function SummaryIndex() {
  const theme = useScreenTheme();
  const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);

  const user = auth.currentUser;
  const name = useMemo(() => user?.displayName || mockSummary.name || "You", [user]);

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
              value={`${mockSummary.training.workoutsThisWeek}`}
              label="Workouts"
              theme={theme}
            />
            <StatPill
              icon="clock"
              value={`${mockSummary.training.weeklyMinutes}`}
              label="Minutes"
              theme={theme}
            />
            <StatPill
              icon="map"
              value={`${mockSummary.training.weeklyDistanceKm.toFixed(1)} km`}
              label="Distance"
              theme={theme}
            />
          </View>
        </Card>

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

          <Text style={[styles.big, { color: theme.text }]}>{mockSummary.training.currentPlan}</Text>
          <Text style={{ color: theme.subtext, marginTop: 4 }}>
            Week {mockSummary.training.currentWeek} of {mockSummary.training.totalWeeks}
          </Text>

          {/* ✅ Same Homex pill row here too */}
          <View style={[styles.innerPillRow, { marginTop: 12 }]}>
            <StatPill icon="activity" value={`${mockSummary.training.workoutsThisWeek}`} label="Workouts" theme={theme} />
            <StatPill icon="clock" value={`${mockSummary.training.weeklyMinutes}`} label="Minutes" theme={theme} />
            <StatPill
              icon="map"
              value={`${mockSummary.training.weeklyDistanceKm.toFixed(1)} km`}
              label="Distance"
              theme={theme}
            />
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={[styles.miniHeading, { color: theme.subtext }]}>Next session</Text>
            <Text style={{ color: theme.text, fontWeight: "800", marginTop: 4 }}>
              {mockSummary.training.nextSessionDay} · {mockSummary.training.nextSession}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push("/chat")}
            style={[styles.primaryBtn, { backgroundColor: theme.primaryBg }]}
            activeOpacity={0.92}
          >
            <Feather name="message-circle" size={18} color={theme.primaryText} />
            <Text style={{ fontWeight: "900", color: theme.primaryText }}>
              Ask coach about this week
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
