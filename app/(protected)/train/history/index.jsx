// app/(protected)/train/history/index.jsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
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

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: colors?.bg ?? (isDark ? "#050506" : "#F8FAFC"),
    card: colors?.card ?? (isDark ? "#111217" : "#FFFFFF"),
    cardAlt: isDark ? "#171A21" : "#F8FAFC",
    cardMuted: isDark ? "#1D212A" : "#EEF2F7",
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: colors?.border ?? (isDark ? "rgba(255,255,255,0.10)" : "#E2E8F0"),
    primaryBg: colors?.primary ?? "#E6FF3B",
    primaryText: "#111111",
    accentInk: isDark ? "#F4FF9A" : "#5B6500",
    accentSoft: isDark ? "rgba(230,255,59,0.14)" : "rgba(184,215,0,0.12)",
    muted: isDark ? "#18181B" : "#EEF2F7",
    successBg: isDark ? "rgba(34,197,94,0.16)" : "rgba(34,197,94,0.12)",
    successText: isDark ? "#DCFCE7" : "#166534",
    dangerBg: isDark ? "rgba(248,113,113,0.16)" : "rgba(248,113,113,0.12)",
    dangerText: isDark ? "#FECACA" : "#991B1B",
    infoBg: isDark ? "rgba(148,163,184,0.16)" : "rgba(148,163,184,0.12)",
    infoText: isDark ? "#E2E8F0" : "#334155",
    isDark,
  };
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDateLabel(dateStr, createdAt) {
  if (dateStr) {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
  }

  const ms = getTimestampMs(createdAt);
  if (ms) {
    return new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return "Unknown date";
}

function sessionTypeLabel(session) {
  const raw = String(
    session?.workout?.sport || session?.sessionType || session?.primaryActivity || ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym")) return "Strength";
  if (raw.includes("run")) return "Run";
  if (raw.includes("hyrox")) return "Hyrox";
  if (raw.includes("ride") || raw.includes("bike")) return "Ride";
  return "Training";
}

function formatDurationMin(session) {
  const actual = Number(session?.actualDurationMin);
  if (Number.isFinite(actual) && actual > 0) return `${Math.round(actual)} min`;

  const liveSec = Number(session?.live?.durationSec);
  if (Number.isFinite(liveSec) && liveSec > 0) return `${Math.round(liveSec / 60)} min`;

  const target = Number(session?.targetDurationMin);
  if (Number.isFinite(target) && target > 0) return `${Math.round(target)} min`;

  return null;
}

function formatDistanceKm(session) {
  const actual = Number(session?.actualDistanceKm);
  if (Number.isFinite(actual) && actual > 0) return `${Number(actual).toFixed(1)} km`;

  const live = Number(session?.live?.distanceKm);
  if (Number.isFinite(live) && live > 0) return `${Number(live).toFixed(1)} km`;

  const target = Number(session?.targetDistanceKm);
  if (Number.isFinite(target) && target > 0) return `${Number(target).toFixed(1)} km`;

  return null;
}

function formatStatus(session) {
  const status = String(session?.status || "").toLowerCase();
  if (status === "completed") return "Completed";
  if (status === "skipped") return "Skipped";
  if (
    status === "live" ||
    String(session?.live?.status || "").toLowerCase() === "live" ||
    (!!session?.live?.startedAt && !session?.completedAt)
  ) {
    return "Live";
  }
  return "Saved";
}

function sortSessions(list) {
  return [...list].sort((a, b) => {
    const aMs = Math.max(
      getTimestampMs(a?.completedAt),
      getTimestampMs(a?.createdAt)
    );
    const bMs = Math.max(
      getTimestampMs(b?.completedAt),
      getTimestampMs(b?.createdAt)
    );
    return bMs - aMs;
  });
}

function getTypeTone(type, theme) {
  switch (String(type || "").toLowerCase()) {
    case "strength":
      return {
        accent: theme.primaryBg,
        accentSoft: theme.accentSoft,
        accentText: theme.accentInk,
        icon: "activity",
      };
    case "run":
      return {
        accent: "#7DD3FC",
        accentSoft: theme.isDark ? "rgba(125,211,252,0.16)" : "rgba(14,165,233,0.12)",
        accentText: theme.isDark ? "#BAE6FD" : "#0C4A6E",
        icon: "navigation",
      };
    case "hyrox":
      return {
        accent: "#FB923C",
        accentSoft: theme.isDark ? "rgba(251,146,60,0.16)" : "rgba(249,115,22,0.12)",
        accentText: theme.isDark ? "#FED7AA" : "#9A3412",
        icon: "zap",
      };
    case "ride":
      return {
        accent: "#C4B5FD",
        accentSoft: theme.isDark ? "rgba(196,181,253,0.16)" : "rgba(139,92,246,0.12)",
        accentText: theme.isDark ? "#E9D5FF" : "#5B21B6",
        icon: "disc",
      };
    default:
      return {
        accent: theme.isDark ? "#94A3B8" : "#64748B",
        accentSoft: theme.infoBg,
        accentText: theme.infoText,
        icon: "layers",
      };
  }
}

function getStatusTone(status, theme) {
  switch (String(status || "").toLowerCase()) {
    case "completed":
      return {
        backgroundColor: theme.accentSoft,
        borderColor: theme.isDark ? "rgba(230,255,59,0.22)" : "rgba(184,215,0,0.24)",
        color: theme.accentInk,
      };
    case "live":
      return {
        backgroundColor: theme.successBg,
        borderColor: theme.isDark ? "rgba(34,197,94,0.22)" : "rgba(34,197,94,0.18)",
        color: theme.successText,
      };
    case "skipped":
      return {
        backgroundColor: theme.dangerBg,
        borderColor: theme.isDark ? "rgba(248,113,113,0.22)" : "rgba(248,113,113,0.18)",
        color: theme.dangerText,
      };
    default:
      return {
        backgroundColor: theme.infoBg,
        borderColor: theme.border,
        color: theme.infoText,
      };
  }
}

function FilterPill({ label, active, onPress, theme }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        st.filterPill,
        active
          ? st.filterPillActive
          : { backgroundColor: theme.cardAlt, borderColor: theme.border },
      ]}
    >
      {active ? (
        <LinearGradient
          colors={
            theme.isDark
              ? [theme.primaryBg, "#C7E100"]
              : [theme.primaryBg, "#D5F244"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={st.filterPillFill}
        >
          <Text style={[st.filterPillText, { color: theme.primaryText }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <Text style={[st.filterPillText, { color: theme.text }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function SummaryStat({ label, value, icon, theme }) {
  return (
    <View style={[st.statCard, { backgroundColor: theme.cardMuted, borderColor: theme.border }]}>
      <View style={[st.statIconWrap, { backgroundColor: theme.accentSoft }]}>
        <Feather name={icon} size={14} color={theme.accentInk} />
      </View>
      <Text style={[st.statValue, { color: theme.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[st.statLabel, { color: theme.subtext }]}>{label}</Text>
    </View>
  );
}

function formatRpeLabel(session) {
  const value = Number(session?.avgRPE ?? session?.live?.avgRPE);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `RPE ${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

function getStrengthSnapshot(session) {
  const entries = Array.isArray(session?.strengthLog?.entries)
    ? session.strengthLog.entries
    : [];
  const loggedExercisesRaw = Number(session?.strengthLog?.loggedExercises);
  const loggableEntries = entries.filter((entry) => entry?.isLoggable !== false);
  const loggedExercises =
    Number.isFinite(loggedExercisesRaw) && loggedExercisesRaw >= 0
      ? loggedExercisesRaw
      : loggableEntries.filter(
          (entry) =>
            entry?.performed?.completed ||
            (entry?.performed?.metrics?.trackedSetCount || 0) > 0
        ).length;

  let setCount = 0;
  loggableEntries.forEach((entry) => {
    const trackedSets = Number(entry?.performed?.sets);
    const completedSets = Number(entry?.performed?.completedSets);
    if (Number.isFinite(trackedSets) && trackedSets > 0) {
      setCount += trackedSets;
      return;
    }
    if (Number.isFinite(completedSets) && completedSets > 0) {
      setCount += completedSets;
      return;
    }
    if (Array.isArray(entry?.performed?.setLogs)) {
      setCount += entry.performed.setLogs.length;
    }
  });

  const blockCount = new Set(
    loggableEntries
      .map((entry) => String(entry?.blockTitle || "").trim())
      .filter(Boolean)
  ).size;

  return {
    loggedExercises: loggedExercises || 0,
    totalExercises: loggableEntries.length || 0,
    setCount: setCount || 0,
    blockCount: blockCount || 0,
    rpeLabel: formatRpeLabel(session),
    focusLine:
      session?.emphasis ||
      session?.focus ||
      session?.strengthLog?.notes ||
      session?.notes ||
      "",
  };
}

function RunSessionCard({
  session,
  type,
  status,
  tone,
  statusTone,
  dateLabel,
  duration,
  distance,
  hasAnalysis,
  theme,
  onPress,
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        st.cardRow,
        { backgroundColor: theme.cardAlt, borderColor: theme.border },
      ]}
      activeOpacity={0.85}
    >
      <View style={[st.cardAccent, { backgroundColor: tone.accent }]} />

      <View style={st.cardBody}>
        <View style={st.topRow}>
          <View style={[st.typeIconWrap, { backgroundColor: tone.accentSoft }]}>
            <Feather name={tone.icon} size={14} color={tone.accentText} />
          </View>

          <View style={st.titleBlock}>
            <Text style={[st.sessionTitle, { color: theme.text }]} numberOfLines={1}>
              {session.title || "Session"}
            </Text>
            <Text style={[st.sessionDate, { color: theme.subtext }]}>{dateLabel}</Text>
          </View>

          <View style={st.rightRail}>
            <View
              style={[
                st.typeBadge,
                {
                  backgroundColor: tone.accentSoft,
                  borderColor: "rgba(0,0,0,0)",
                },
              ]}
            >
              <Text style={[st.typeBadgeText, { color: tone.accentText }]}>
                {type.toUpperCase()}
              </Text>
            </View>

            <View
              style={[
                st.chevronShell,
                { backgroundColor: theme.cardMuted, borderColor: theme.border },
              ]}
            >
              <Feather name="chevron-right" size={16} color={theme.subtext} />
            </View>
          </View>
        </View>

        <View style={st.metaRow}>
          {duration ? (
            <View
              style={[
                st.metaChip,
                { backgroundColor: theme.cardMuted, borderColor: theme.border },
              ]}
            >
              <Text style={[st.metaChipText, { color: theme.text }]}>{duration}</Text>
            </View>
          ) : null}

          {distance ? (
            <View
              style={[
                st.metaChip,
                { backgroundColor: theme.cardMuted, borderColor: theme.border },
              ]}
            >
              <Text style={[st.metaChipText, { color: theme.text }]}>{distance}</Text>
            </View>
          ) : null}

          <View
            style={[
              st.metaChip,
              st.statusChip,
              {
                backgroundColor: statusTone.backgroundColor,
                borderColor: statusTone.borderColor,
              },
            ]}
          >
            <Text style={[st.metaChipText, { color: statusTone.color }]}>{status}</Text>
          </View>

          {hasAnalysis ? (
            <View
              style={[
                st.metaChip,
                { backgroundColor: theme.accentSoft, borderColor: "rgba(0,0,0,0)" },
              ]}
            >
              <Feather name="star" size={12} color={theme.accentInk} />
              <Text style={[st.metaChipText, { color: theme.accentInk }]}>Insight</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function StrengthSessionCard({
  session,
  type,
  status,
  tone,
  statusTone,
  dateLabel,
  duration,
  hasAnalysis,
  theme,
  onPress,
}) {
  const snapshot = getStrengthSnapshot(session);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        st.cardRow,
        st.strengthCardRow,
        { backgroundColor: theme.cardAlt, borderColor: theme.border },
      ]}
      activeOpacity={0.85}
    >
      <View style={[st.cardAccent, { backgroundColor: tone.accent }]} />

      <View style={st.cardBody}>
        <View style={st.topRow}>
          <View style={[st.typeIconWrap, { backgroundColor: tone.accentSoft }]}>
            <Feather name={tone.icon} size={14} color={tone.accentText} />
          </View>

          <View style={st.titleBlock}>
            <Text style={[st.sessionTitle, { color: theme.text }]} numberOfLines={1}>
              {session.title || "Strength session"}
            </Text>
            <Text style={[st.sessionDate, { color: theme.subtext }]}>{dateLabel}</Text>
          </View>

          <View style={st.rightRail}>
            <View
              style={[
                st.typeBadge,
                {
                  backgroundColor: tone.accentSoft,
                  borderColor: "rgba(0,0,0,0)",
                },
              ]}
            >
              <Text style={[st.typeBadgeText, { color: tone.accentText }]}>
                {type.toUpperCase()}
              </Text>
            </View>

            <View
              style={[
                st.chevronShell,
                { backgroundColor: theme.cardMuted, borderColor: theme.border },
              ]}
            >
              <Feather name="chevron-right" size={16} color={theme.subtext} />
            </View>
          </View>
        </View>

        <View style={st.strengthMetricsRow}>
          <View
            style={[
              st.strengthMetricCard,
              { backgroundColor: theme.cardMuted, borderColor: theme.border },
            ]}
          >
            <Text style={[st.strengthMetricValue, { color: theme.text }]}>
              {snapshot.totalExercises
                ? `${snapshot.loggedExercises}/${snapshot.totalExercises}`
                : snapshot.loggedExercises || "—"}
            </Text>
            <Text style={[st.strengthMetricLabel, { color: theme.subtext }]}>
              Exercises
            </Text>
          </View>

          <View
            style={[
              st.strengthMetricCard,
              { backgroundColor: theme.cardMuted, borderColor: theme.border },
            ]}
          >
            <Text style={[st.strengthMetricValue, { color: theme.text }]}>
              {snapshot.setCount || snapshot.blockCount || "—"}
            </Text>
            <Text style={[st.strengthMetricLabel, { color: theme.subtext }]}>
              {snapshot.setCount ? "Sets" : "Blocks"}
            </Text>
          </View>

          <View
            style={[
              st.strengthMetricCard,
              { backgroundColor: theme.cardMuted, borderColor: theme.border },
            ]}
          >
            <Text style={[st.strengthMetricValue, { color: theme.text }]}>
              {snapshot.rpeLabel ? snapshot.rpeLabel.replace("RPE ", "") : duration || "—"}
            </Text>
            <Text style={[st.strengthMetricLabel, { color: theme.subtext }]}>
              {snapshot.rpeLabel ? "Avg RPE" : "Duration"}
            </Text>
          </View>
        </View>

        {snapshot.focusLine ? (
          <View
            style={[
              st.strengthFocusStrip,
              { backgroundColor: theme.cardMuted, borderColor: theme.border },
            ]}
          >
            <Text style={[st.strengthFocusLabel, { color: theme.subtext }]}>Focus</Text>
            <Text style={[st.strengthFocusValue, { color: theme.text }]} numberOfLines={2}>
              {snapshot.focusLine}
            </Text>
          </View>
        ) : null}

        <View style={st.metaRow}>
          {duration ? (
            <View
              style={[
                st.metaChip,
                { backgroundColor: theme.cardMuted, borderColor: theme.border },
              ]}
            >
              <Text style={[st.metaChipText, { color: theme.text }]}>{duration}</Text>
            </View>
          ) : null}

          {snapshot.blockCount ? (
            <View
              style={[
                st.metaChip,
                { backgroundColor: theme.cardMuted, borderColor: theme.border },
              ]}
            >
              <Text style={[st.metaChipText, { color: theme.text }]}>
                {snapshot.blockCount} block{snapshot.blockCount === 1 ? "" : "s"}
              </Text>
            </View>
          ) : null}

          <View
            style={[
              st.metaChip,
              st.statusChip,
              {
                backgroundColor: statusTone.backgroundColor,
                borderColor: statusTone.borderColor,
              },
            ]}
          >
            <Text style={[st.metaChipText, { color: statusTone.color }]}>{status}</Text>
          </View>

          {hasAnalysis ? (
            <View
              style={[
                st.metaChip,
                { backgroundColor: theme.accentSoft, borderColor: "rgba(0,0,0,0)" },
              ]}
            >
              <Feather name="star" size={12} color={theme.accentInk} />
              <Text style={[st.metaChipText, { color: theme.accentInk }]}>Insight</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function TrainHistory() {
  const theme = useScreenTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [filter, setFilter] = useState("all");

  const loadSessions = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setSessions([]);
        return;
      }

      const ref = collection(db, "users", uid, "trainSessions");

      let list = [];
      try {
        const snap = await getDocs(query(ref, orderBy("completedAt", "desc"), limit(200)));
        list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch {
        try {
          const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(200)));
          list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch {
          const snap = await getDocs(ref);
          list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          list = sortSessions(list);
        }
      }

      setSessions(sortSessions(list));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadSessions();
      setLoading(false);
    })();
  }, [loadSessions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const filteredSessions = useMemo(() => {
    if (filter === "all") return sessions;

    return sessions.filter((s) => {
      const type = sessionTypeLabel(s).toLowerCase();
      if (filter === "run") return type === "run";
      if (filter === "strength") return type === "strength";
      return true;
    });
  }, [sessions, filter]);

  const summary = useMemo(() => {
    let totalSessions = 0;
    let totalMinutes = 0;
    let totalKm = 0;

    filteredSessions.forEach((s) => {
      totalSessions += 1;

      const actualMin = Number(s?.actualDurationMin);
      const liveSec = Number(s?.live?.durationSec);
      const targetMin = Number(s?.targetDurationMin);

      if (Number.isFinite(actualMin) && actualMin > 0) totalMinutes += actualMin;
      else if (Number.isFinite(liveSec) && liveSec > 0) totalMinutes += liveSec / 60;
      else if (Number.isFinite(targetMin) && targetMin > 0) totalMinutes += targetMin;

      const actualKm = Number(s?.actualDistanceKm);
      const liveKm = Number(s?.live?.distanceKm);
      const targetKm = Number(s?.targetDistanceKm);

      if (Number.isFinite(actualKm) && actualKm > 0) totalKm += actualKm;
      else if (Number.isFinite(liveKm) && liveKm > 0) totalKm += liveKm;
      else if (Number.isFinite(targetKm) && targetKm > 0) totalKm += targetKm;
    });

    return {
      sessions: totalSessions,
      minutes: Math.round(totalMinutes),
      km: Number(totalKm.toFixed(1)),
    };
  }, [filteredSessions]);

  const resultsLabel = `${filteredSessions.length} ${
    filteredSessions.length === 1 ? "session" : "sessions"
  }`;
  const filterSubtitle =
    filter === "all"
      ? "Everything you've logged so far."
      : filter === "run"
        ? "Only run sessions in the archive."
        : "Only strength sessions in the archive.";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 124, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={st.rowBetween}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[st.pillBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={18} color={theme.text} />
            <Text style={{ color: theme.text, fontWeight: "800" }}>Back</Text>
          </TouchableOpacity>

          <Text style={[st.h4, { color: theme.text }]}>History</Text>
          <View style={{ width: 68 }} />
        </View>

        <LinearGradient
          colors={
            theme.isDark
              ? ["rgba(28,31,38,0.98)", "rgba(15,17,22,0.98)"]
              : ["#FFFFFF", "#F8FAFC"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[st.heroCard, { borderColor: theme.border }]}
        >
          <View style={st.heroTopRow}>
            <View style={[st.eyebrowPill, { backgroundColor: theme.accentSoft }]}>
              <View style={[st.eyebrowDot, { backgroundColor: theme.primaryBg }]} />
              <Text style={[st.eyebrowText, { color: theme.accentInk }]}>Archive</Text>
            </View>
            <View style={[st.countPill, { backgroundColor: theme.cardMuted, borderColor: theme.border }]}>
              <Text style={[st.countPillText, { color: theme.text }]}>{resultsLabel}</Text>
            </View>
          </View>

          <Text style={[st.heroTitle, { color: theme.text }]}>Training archive</Text>
          <Text style={[st.heroSub, { color: theme.subtext }]}>
            Review completed sessions and track your consistency.
          </Text>

          <View style={st.summaryRow}>
            <SummaryStat label="Sessions" value={summary.sessions} icon="layers" theme={theme} />
            <SummaryStat label="Minutes" value={summary.minutes} icon="clock" theme={theme} />
            <SummaryStat
              label="Distance"
              value={`${summary.km} km`}
              icon="map-pin"
              theme={theme}
            />
          </View>
        </LinearGradient>

        <View style={st.section}>
          <View style={st.sectionHead}>
            <View style={{ flex: 1 }}>
              <Text style={[st.sectionTitle, { color: theme.text }]}>Filters</Text>
              <Text style={[st.sectionSubtle, { color: theme.subtext }]}>{filterSubtitle}</Text>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={st.filterRow}
          >
            <FilterPill
              label="All"
              active={filter === "all"}
              onPress={() => setFilter("all")}
              theme={theme}
            />
            <FilterPill
              label="Run"
              active={filter === "run"}
              onPress={() => setFilter("run")}
              theme={theme}
            />
            <FilterPill
              label="Strength"
              active={filter === "strength"}
              onPress={() => setFilter("strength")}
              theme={theme}
            />
          </ScrollView>
        </View>

        <View style={st.section}>
          <View style={st.sectionHead}>
            <View>
              <Text style={[st.sectionTitle, { color: theme.text }]}>Recent sessions</Text>
              <Text style={[st.sectionSubtle, { color: theme.subtext }]}>
                {resultsLabel} shown in this view.
              </Text>
            </View>
          </View>
        </View>

        {loading ? (
          <View style={[st.card, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
            <View style={[st.stateIcon, { backgroundColor: theme.accentSoft }]}>
              <ActivityIndicator color={theme.accentInk} />
            </View>
            <Text style={[st.stateTitle, { color: theme.text }]}>Loading sessions</Text>
            <Text style={[st.stateBody, { color: theme.subtext }]}>
              Pulling your latest completed training into the archive.
            </Text>
          </View>
        ) : filteredSessions.length === 0 ? (
          <View style={[st.card, { backgroundColor: theme.cardAlt, borderColor: theme.border }]}>
            <View style={[st.stateIcon, { backgroundColor: theme.cardMuted, borderColor: theme.border }]}>
              <Feather name="inbox" size={16} color={theme.subtext} />
            </View>
            <Text style={[st.stateTitle, { color: theme.text }]}>No sessions yet</Text>
            <Text style={[st.stateBody, { color: theme.subtext }]}>
              Completed sessions will appear here once you start logging training.
            </Text>
          </View>
        ) : (
          <View style={st.listStack}>
            {filteredSessions.map((s) => {
              const type = sessionTypeLabel(s);
              const status = formatStatus(s);
              const tone = getTypeTone(type, theme);
              const statusTone = getStatusTone(status, theme);
              const dateLabel = formatDateLabel(s?.date, s?.completedAt || s?.createdAt);
              const duration = formatDurationMin(s);
              const distance = formatDistanceKm(s);
              const hasAnalysis = !!s.analysis;

              if (String(type).toLowerCase() === "strength") {
                return (
                  <StrengthSessionCard
                    key={s.id}
                    session={s}
                    type={type}
                    status={status}
                    tone={tone}
                    statusTone={statusTone}
                    dateLabel={dateLabel}
                    duration={duration}
                    hasAnalysis={hasAnalysis}
                    theme={theme}
                    onPress={() => router.push(`/train/history/${s.id}`)}
                  />
                );
              }

              return (
                <RunSessionCard
                  key={s.id}
                  session={s}
                  type={type}
                  status={status}
                  tone={tone}
                  statusTone={statusTone}
                  dateLabel={dateLabel}
                  duration={duration}
                  distance={distance}
                  hasAnalysis={hasAnalysis}
                  theme={theme}
                  onPress={() => router.push(`/train/history/${s.id}`)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  h4: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 42,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: 16,
    overflow: "hidden",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  eyebrowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  eyebrowDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  eyebrowText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  countPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  countPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  heroSub: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    maxWidth: "92%",
  },

  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  statCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    minHeight: 92,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
    letterSpacing: 0.2,
    textAlign: "center",
  },

  section: {
    marginTop: 2,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  sectionSubtle: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 3,
    lineHeight: 17,
  },

  filterRow: {
    gap: 10,
    paddingRight: 12,
  },

  filterPill: {
    minHeight: 42,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  filterPillActive: {
    borderColor: "rgba(0,0,0,0)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 3,
  },
  filterPillFill: {
    minHeight: 42,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.2,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 160,
  },
  stateIcon: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0)",
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: "800",
  },
  stateBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: 280,
  },

  listStack: {
    gap: 12,
  },

  cardRow: {
    position: "relative",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    paddingLeft: 18,
    overflow: "hidden",
  },
  strengthCardRow: {
    paddingBottom: 16,
  },
  cardAccent: {
    position: "absolute",
    left: 0,
    top: 14,
    bottom: 14,
    width: 4,
    borderRadius: 999,
  },
  cardBody: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  typeIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  sessionTitle: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
  },
  sessionDate: {
    fontSize: 12.5,
    marginTop: 4,
    fontWeight: "600",
  },
  rightRail: {
    alignItems: "flex-end",
    gap: 8,
    marginLeft: 10,
  },
  typeBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  chevronShell: {
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  strengthMetricsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  strengthMetricCard: {
    flex: 1,
    minHeight: 72,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  strengthMetricValue: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  strengthMetricLabel: {
    marginTop: 5,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  strengthFocusStrip: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  strengthFocusLabel: {
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  strengthFocusValue: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "700",
  },

  metaChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusChip: {},
  metaChipText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
