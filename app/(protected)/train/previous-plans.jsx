import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const PRIMARY = "#E6FF3B";

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: colors?.bg ?? (isDark ? "#050506" : "#F5F5F7"),
    card: colors?.card ?? (isDark ? "#101114" : "#FFFFFF"),
    card2: colors?.card2 ?? (isDark ? "#15161A" : "#F1F5F9"),
    text: colors?.text ?? (isDark ? "#F4F4F5" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: isDark ? "rgba(255,255,255,0.10)" : "#E2E8F0",
    primaryBg: PRIMARY,
    primaryText: "#111111",
  };
}

function toDateMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatDate(value) {
  const ms = toDateMs(value);
  if (!ms) return "No date";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function inferPlanKind(planDoc) {
  const raw = String(
    planDoc?.primaryActivity ||
      planDoc?.plan?.primaryActivity ||
      planDoc?.kind ||
      planDoc?.source ||
      planDoc?.type ||
      planDoc?.name ||
      ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym") || raw.includes("hypertrophy")) return "strength";
  if (raw.includes("hyrox") || raw.includes("hybrid")) return "hybrid";
  if (raw.includes("run") || raw.includes("race") || raw.includes("5k") || raw.includes("10k")) return "run";
  return "training";
}

function getWeeks(planDoc) {
  if (Array.isArray(planDoc?.weeks)) return planDoc.weeks;
  if (Array.isArray(planDoc?.plan?.weeks)) return planDoc.plan.weeks;
  return [];
}

function countSessions(planDoc) {
  return getWeeks(planDoc).reduce((total, week) => {
    if (Array.isArray(week?.sessions)) return total + week.sessions.length;
    if (Array.isArray(week?.days)) {
      return (
        total +
        week.days.reduce(
          (dayTotal, day) => dayTotal + (Array.isArray(day?.sessions) ? day.sessions.length : 0),
          0
        )
      );
    }
    return total;
  }, 0);
}

function planSortMs(planDoc) {
  return (
    toDateMs(planDoc?.updatedAt) ||
    toDateMs(planDoc?.createdAt) ||
    toDateMs(planDoc?.startDate) ||
    0
  );
}

function resolveActivePlanIds(plans) {
  const active = new Set();
  const byKind = { run: null, strength: null, hybrid: null };

  for (const plan of plans) {
    const kind = inferPlanKind(plan);
    if (!byKind[kind] && ["run", "strength", "hybrid"].includes(kind)) {
      byKind[kind] = plan;
    }
  }

  if (byKind.run) active.add(byKind.run.id);
  if (byKind.strength) active.add(byKind.strength.id);
  if (!active.size && byKind.hybrid) active.add(byKind.hybrid.id);
  if (!active.size && plans[0]?.id) active.add(plans[0].id);

  return active;
}

export default function PreviousPlansPage() {
  const router = useRouter();
  const theme = useScreenTheme();
  const [user, setUser] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.replace("/(auth)/login");
        return;
      }
      setUser(u);
    });
    return () => unsub();
  }, [router]);

  const loadPlans = useCallback(async ({ refresh = false } = {}) => {
    if (!user?.uid) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const ref = collection(db, "users", user.uid, "plans");
      const snap = await getDocs(query(ref, orderBy("updatedAt", "desc"), limit(50)));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => planSortMs(b) - planSortMs(a));
      setPlans(rows);
    } catch (e) {
      console.log("[previous-plans] load plans error:", e);
      setPlans([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    loadPlans();
  }, [user?.uid, loadPlans]);

  const previousPlans = useMemo(() => {
    const activeIds = resolveActivePlanIds(plans);
    return plans.filter((plan) => !activeIds.has(plan.id));
  }, [plans]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadPlans({ refresh: true })}
            tintColor={theme.primaryBg}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: theme.card2, borderColor: theme.border }]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={22} color={theme.text} />
            <Text style={[styles.backText, { color: theme.text }]}>Back</Text>
          </TouchableOpacity>
          <Text style={[styles.kicker, { color: theme.subtext }]}>Training</Text>
          <Text style={[styles.title, { color: theme.text }]}>Previous plans</Text>
          <Text style={[styles.subtitle, { color: theme.subtext }]}>
            Older training blocks saved to your account.
          </Text>
        </View>

        {loading ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <ActivityIndicator color={theme.primaryBg} />
            <Text style={[styles.emptyText, { color: theme.subtext }]}>Loading plans…</Text>
          </View>
        ) : previousPlans.length ? (
          <View style={styles.list}>
            {previousPlans.map((plan) => {
              const kind = inferPlanKind(plan);
              const weeks = getWeeks(plan);
              const sessions = countSessions(plan);
              return (
                <TouchableOpacity
                  key={plan.id}
                  onPress={() =>
                    router.push({ pathname: "/train/view-plan", params: { planId: plan.id } })
                  }
                  style={[styles.planCard, { backgroundColor: theme.card, borderColor: theme.border }]}
                  activeOpacity={0.86}
                >
                  <View style={[styles.iconWrap, { backgroundColor: theme.card2, borderColor: theme.border }]}>
                    <Feather name={kind === "strength" ? "bar-chart-2" : "calendar"} size={19} color={theme.primaryBg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planTitle, { color: theme.text }]} numberOfLines={2}>
                      {plan.name || plan.title || "Training plan"}
                    </Text>
                    <Text style={[styles.planMeta, { color: theme.subtext }]}>
                      {formatDate(plan.updatedAt || plan.createdAt)} · {weeks.length || 0} wk · {sessions} sessions
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={22} color={theme.subtext} />
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.card2, borderColor: theme.border }]}>
              <Feather name="archive" size={22} color={theme.primaryBg} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No previous plans yet</Text>
            <Text style={[styles.emptyText, { color: theme.subtext }]}>
              When you create another plan, older blocks will appear here.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 36,
  },
  header: { marginBottom: 22 },
  backBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 20,
  },
  backText: { fontSize: 15, fontWeight: "800" },
  kicker: {
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0,
    marginBottom: 6,
  },
  title: { fontSize: 40, lineHeight: 44, fontWeight: "900", letterSpacing: 0 },
  subtitle: { marginTop: 8, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  list: { gap: 12 },
  planCard: {
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  planTitle: { fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: 0 },
  planMeta: { marginTop: 6, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 190,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 20, lineHeight: 24, fontWeight: "900", letterSpacing: 0 },
  emptyText: { marginTop: 8, textAlign: "center", fontSize: 14, lineHeight: 20, fontWeight: "700" },
});
