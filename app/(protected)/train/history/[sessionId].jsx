// app/(protected)/train/history/[sessionId].jsx
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

const PRIMARY = "#E6FF3B";
const SILVER_LIGHT = "#F3F4F6";
const SILVER_MEDIUM = "#E1E3E8";

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const accentBg = colors?.accentBg ?? colors?.primary ?? PRIMARY;
  return {
    bg: isDark ? "#050506" : "#F5F5F7",
    card: colors?.card ?? (isDark ? "#101219" : SILVER_LIGHT),
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: colors?.border ?? (isDark ? "rgba(255,255,255,0.10)" : SILVER_MEDIUM),
    primaryBg: accentBg,
    primaryText: colors?.sapOnPrimary ?? "#050506",
    primaryBorder: colors?.accentBorder ?? accentBg,
    muted: colors?.surfaceAlt ?? (isDark ? "#18191E" : "#E6E7EC"),
    danger: "#B91C1C",
    isDark,
  };
}

function withHexAlpha(hex, alpha = "FF") {
  if (typeof hex !== "string") return hex;
  if (!hex.startsWith("#")) return hex;
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${alpha}`;
  }
  if (hex.length === 7) return `${hex}${alpha}`;
  return hex;
}

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDateLabel(dateStr, fallbackTs) {
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

  const ms = getTimestampMs(fallbackTs);
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
    session?.workout?.sport ||
      session?.sessionType ||
      session?.primaryActivity ||
      ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym")) return "Strength";
  if (raw.includes("run")) return "Run";
  if (raw.includes("hyrox")) return "Hyrox";
  if (raw.includes("ride") || raw.includes("bike")) return "Ride";
  return "Training";
}

function formatMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} min` : null;
}

function formatKm(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)} km` : null;
}

function formatPace(value) {
  if (!value) return null;
  return `${String(value)}/km`;
}

function formatBpm(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} bpm` : null;
}

function formatStatus(session) {
  const status = String(session?.status || "").toLowerCase();
  if (status === "completed") return "Completed";
  if (status === "skipped") return "Skipped";
  return "Saved";
}

function formatCount(value, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n)}${suffix}`;
}

function formatWeightKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
}

function formatRestLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 60) return `${Math.round(n)} sec rest`;
  const mins = Math.floor(n / 60);
  const secs = Math.round(n % 60);
  if (!secs) return `${mins} min rest`;
  return `${mins}m ${secs}s rest`;
}

function formatRpeLabel(value, prefix = "RPE") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${prefix} ${Number.isInteger(n) ? n : n.toFixed(1)}`;
}

function formatSignedDelta(value, options = {}) {
  const { digits = 0, suffix = "" } = options;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;

  const rounded = digits > 0 ? Number(n.toFixed(digits)) : Math.round(n);
  const abs = Math.abs(rounded);
  const absText = digits > 0 ? abs.toFixed(digits) : String(abs);
  return `${rounded > 0 ? "+" : "-"}${absText}${suffix ? ` ${suffix}` : ""}`;
}

function compactText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSessionDescriptionText(session) {
  if (!session || typeof session !== "object") return "";

  const candidates = [
    session?.description,
    session?.summary,
    session?.workout?.description,
    session?.workout?.summary,
    session?.workout?.notes,
    session?.notes,
  ];

  for (const item of candidates) {
    const cleaned = compactText(item);
    if (cleaned) return cleaned;
  }

  return "";
}

function buildDescriptionInsights(description, { isStrengthSession = false } = {}) {
  const text = compactText(description);
  if (!text) return null;

  const lower = text.toLowerCase();
  const focus = [];
  const execution = [];
  const recovery = [];
  const addUnique = (arr, line) => {
    if (!line || arr.includes(line)) return;
    arr.push(line);
  };

  if (/\b(interval|repeat|tempo|threshold|vo2|max|speed|pace)\b/.test(lower)) {
    addUnique(focus, "Quality pace work is the main performance target.");
  }
  if (/\b(long run|aerobic|easy|base|zone 2|z2)\b/.test(lower)) {
    addUnique(focus, "Aerobic development and controlled effort are prioritized.");
  }
  if (/\b(hill|incline|climb)\b/.test(lower)) {
    addUnique(focus, "Incline work is used to build strength and economy.");
  }
  if (/\b(strength|hypertrophy|compound|squat|deadlift|press|row|lunge)\b/.test(lower)) {
    addUnique(focus, "Strength stimulus is the primary objective.");
  }
  if (/\b(hyrox|station|sled|wall ball|burpee)\b/.test(lower)) {
    addUnique(focus, "Hybrid station quality and transitions are emphasized.");
  }

  if (/\bwarm\s?up|warmup\b/.test(lower)) {
    addUnique(execution, "Warm up progressively before the main workload.");
  }
  if (/\bcool\s?down|cooldown\b/.test(lower)) {
    addUnique(recovery, "Complete a full cooldown to support recovery.");
  }
  if (/\b(rest|recover|recovery)\b/.test(lower)) {
    addUnique(execution, "Respect recoveries so work reps stay on quality.");
  }
  if (/\brpe\b/.test(lower)) {
    addUnique(execution, "Use the RPE guidance to cap effort drift.");
  }
  if (/\b(negative split|build|progressive)\b/.test(lower)) {
    addUnique(execution, "Build effort progressively instead of starting too hard.");
  }
  if (/\b(form|technique|cadence|posture)\b/.test(lower)) {
    addUnique(execution, "Keep form consistent as fatigue builds.");
  }
  if (/\b(fuel|hydration|carb|electrolyte)\b/.test(lower)) {
    addUnique(recovery, "Plan fueling and hydration around this session demand.");
  }

  if (!focus.length) {
    addUnique(
      focus,
      isStrengthSession
        ? "Session focus is structured strength execution quality."
        : "Session focus is controlled execution quality."
    );
  }
  if (!execution.length) {
    addUnique(execution, "Keep pacing and effort even from first rep to last.");
  }

  const sentenceParts = text
    .split(/[.!?]\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const firstSentence = sentenceParts[0] || text;

  return {
    source:
      firstSentence.length > 180
        ? `${firstSentence.slice(0, 177)}...`
        : firstSentence,
    headline: focus[0],
    bullets: [...focus.slice(1), ...execution, ...recovery].slice(0, 4),
  };
}

function getStrengthSnapshot(session) {
  const entries = Array.isArray(session?.strengthLog?.entries)
    ? session.strengthLog.entries
    : [];
  const loggableEntries = entries.filter((entry) => entry?.isLoggable !== false);
  const loggedExercisesRaw = Number(session?.strengthLog?.loggedExercises);

  const loggedExercises =
    Number.isFinite(loggedExercisesRaw) && loggedExercisesRaw >= 0
      ? loggedExercisesRaw
      : loggableEntries.filter(
          (entry) =>
            entry?.performed?.completed ||
            (entry?.performed?.metrics?.trackedSetCount || 0) > 0
        ).length;

  let setCount = 0;
  let totalReps = 0;
  let totalVolumeKg = 0;

  loggableEntries.forEach((entry) => {
    const trackedSets = Number(entry?.performed?.sets);
    const completedSets = Number(entry?.performed?.completedSets);
    const metrics = entry?.performed?.metrics || {};

    if (Number.isFinite(trackedSets) && trackedSets > 0) {
      setCount += trackedSets;
    } else if (Number.isFinite(completedSets) && completedSets > 0) {
      setCount += completedSets;
    } else if (Array.isArray(entry?.performed?.setLogs)) {
      setCount += entry.performed.setLogs.length;
    }

    totalReps += Number(metrics?.totalReps || 0) || 0;
    totalVolumeKg += Number(metrics?.volumeKg || 0) || 0;
  });

  return {
    loggedExercises: loggedExercises || 0,
    totalExercises: loggableEntries.length || 0,
    setCount: setCount || 0,
    totalReps: totalReps || 0,
    totalVolumeKg: totalVolumeKg ? Number(totalVolumeKg.toFixed(1)) : 0,
  };
}

function StatCard({ label, value, theme }) {
  return (
    <View
      style={[
        st.statCard,
        {
          backgroundColor: withHexAlpha(theme.card, theme.isDark ? "A8" : "F2"),
          borderColor: theme.border,
        },
      ]}
    >
      <Text style={[st.statValue, { color: theme.text }]}>{value}</Text>
      <Text style={[st.statLabel, { color: theme.subtext }]}>{label}</Text>
    </View>
  );
}

function KeyStatCard({ label, value, sub, theme }) {
  return (
    <View
      style={[
        st.keyStatCard,
        {
          backgroundColor: withHexAlpha(theme.card, theme.isDark ? "A8" : "F2"),
          borderColor: theme.border,
        },
      ]}
    >
      <Text style={[st.keyStatLabel, { color: theme.subtext }]}>{label}</Text>
      <Text style={[st.keyStatValue, { color: theme.text }]}>{value}</Text>
      {sub ? <Text style={[st.keyStatSub, { color: theme.subtext }]}>{sub}</Text> : null}
    </View>
  );
}

function InfoChip({ label, theme, tone = "neutral" }) {
  const accent = tone === "accent";
  const danger = tone === "danger";
  return (
    <View
      style={[
        st.infoChip,
        {
          backgroundColor: accent
            ? withHexAlpha(theme.primaryBg, theme.isDark ? "E8" : "DD")
            : danger
            ? "rgba(248,113,113,0.16)"
            : theme.muted,
        },
      ]}
    >
      <Text
        style={[
          st.infoChipText,
          {
            color: accent ? theme.primaryText : danger ? "#F87171" : theme.text,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function MetricRow({
  label,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  theme,
  showDivider = true,
}) {
  return (
    <View
      style={[
        st.metricRow,
        showDivider ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border } : null,
      ]}
    >
      <View style={st.metricLabelCol}>
        <Text style={[st.metricLabel, { color: theme.subtext }]}>{label}</Text>
      </View>

      <View style={st.metricValueCol}>
        <Text style={[st.metricValueLabel, { color: theme.subtext }]}>{leftLabel}</Text>
        <Text style={[st.metricValue, { color: theme.text }]}>{leftValue || "—"}</Text>
      </View>

      <View style={st.metricValueCol}>
        <Text style={[st.metricValueLabel, { color: theme.subtext }]}>{rightLabel}</Text>
        <Text style={[st.metricValue, { color: theme.text }]}>{rightValue || "—"}</Text>
      </View>
    </View>
  );
}

export default function TrainHistoryDetail() {
  const theme = useScreenTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();

  const sessionId = useMemo(() => {
    const raw = params?.sessionId;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params?.sessionId]);
  const returnWeekIndex = useMemo(() => {
    const raw = params?.returnWeekIndex;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }, [params?.returnWeekIndex]);
  const returnDayIndex = useMemo(() => {
    const raw = params?.returnDayIndex;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed < 7 ? Math.round(parsed) : null;
  }, [params?.returnDayIndex]);
  const hasExplicitTrainReturn = useMemo(() => {
    const raw = params?.returnToken;
    const token = Array.isArray(raw) ? raw[0] : raw;
    return String(token || "").trim().length > 0 && returnWeekIndex != null && returnDayIndex != null;
  }, [params?.returnToken, returnDayIndex, returnWeekIndex]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const stickyHeaderTop = Math.max(insets.top, 12) + 6;
  const stickyHeaderInset = stickyHeaderTop + 40;
  const goBackToPreviousScreen = useCallback(() => {
    if (hasExplicitTrainReturn) {
      router.replace({
        pathname: "/train",
        params: {
          returnWeekIndex: String(returnWeekIndex),
          returnDayIndex: String(returnDayIndex),
          returnToken: String(Date.now()),
        },
      });
      return;
    }
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/train/history");
  }, [hasExplicitTrainReturn, returnDayIndex, returnWeekIndex, router]);

  const loadSession = useCallback(async () => {
    try {
      const uid = auth.currentUser?.uid;

      if (!uid) {
        setError("Not signed in.");
        setSession(null);
        return;
      }

      if (!sessionId) {
        setError("Invalid session ID.");
        setSession(null);
        return;
      }

      const snap = await getDoc(
        doc(db, "users", uid, "trainSessions", String(sessionId))
      );

      if (!snap.exists()) {
        setError("Session not found.");
        setSession(null);
        return;
      }

      setError("");
      setSession({ id: snap.id, ...snap.data() });
    } catch (e) {
      setError(e?.message || "Could not load session.");
      setSession(null);
    }
  }, [sessionId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadSession();
      setLoading(false);
    })();
  }, [loadSession]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSession();
    setRefreshing(false);
  }, [loadSession]);

  const analysis = session?.analysis;
  const descriptionText = useMemo(() => getSessionDescriptionText(session), [session]);
  const type = useMemo(() => sessionTypeLabel(session), [session]);
  const status = useMemo(() => formatStatus(session), [session]);
  const isStrengthSession = useMemo(() => {
    if (type === "Strength") return true;
    return Array.isArray(session?.strengthLog?.entries) && session.strengthLog.entries.length > 0;
  }, [session?.strengthLog?.entries, type]);
  const descriptionInsights = useMemo(
    () => buildDescriptionInsights(descriptionText, { isStrengthSession }),
    [descriptionText, isStrengthSession]
  );

  const summary = useMemo(() => {
    if (!session) return null;

    const plannedMinutes = session?.targetDurationMin ?? null;
    const plannedKm = session?.targetDistanceKm ?? null;

    const actualMinutes =
      session?.actualDurationMin ??
      (session?.live?.durationSec
        ? Number(session.live.durationSec) / 60
        : null);

    const actualKm = session?.actualDistanceKm ?? session?.live?.distanceKm ?? null;

    const avgPace = session?.live?.avgPaceMinPerKm || null;
    const movingPace = session?.live?.movingPaceMinPerKm || null;
    const movingMinutes = session?.live?.movingDurationSec
      ? Number(session.live.movingDurationSec) / 60
      : null;
    const avgHeartrate =
      session?.linkedActivity?.averageHeartrate ??
      session?.live?.avgHeartrate ??
      session?.live?.averageHeartrate ??
      session?.live?.avgHr ??
      null;
    const maxHeartrate =
      session?.linkedActivity?.maxHeartrate ??
      session?.live?.maxHeartrate ??
      session?.live?.maximumHeartrate ??
      session?.live?.maxHr ??
      null;

    return {
      dateLabel: formatDateLabel(
        session?.date,
        session?.completedAt || session?.createdAt
      ),
      plannedMinutes,
      plannedKm,
      actualMinutes,
      actualKm,
      avgPace,
      movingPace,
      movingMinutes,
      rpe: session?.avgRPE ?? null,
      notes: session?.notes || "",
      title: session?.title || "Session",
      primaryActivity: session?.primaryActivity || "",
      avgHeartrate,
      maxHeartrate,
    };
  }, [session]);

  const strengthSnapshot = useMemo(
    () => (isStrengthSession ? getStrengthSnapshot(session) : null),
    [isStrengthSession, session]
  );

  const topStats = useMemo(() => {
    if (!summary) return [];

    if (isStrengthSession && strengthSnapshot) {
      const stats = [];
      if (summary.actualMinutes) {
        stats.push({
          label: "Duration",
          value: formatMinutes(summary.actualMinutes),
        });
      }
      if (summary.avgHeartrate) {
        stats.push({
          label: "Avg HR",
          value: formatBpm(summary.avgHeartrate),
        });
      }
      if (summary.maxHeartrate) {
        stats.push({
          label: "Max HR",
          value: formatBpm(summary.maxHeartrate),
        });
      }
      if (strengthSnapshot.totalExercises || strengthSnapshot.loggedExercises) {
        stats.push({
          label: "Exercises",
          value: `${strengthSnapshot.loggedExercises}/${strengthSnapshot.totalExercises || strengthSnapshot.loggedExercises}`,
        });
      }
      if (strengthSnapshot.setCount) {
        stats.push({
          label: "Sets",
          value: String(strengthSnapshot.setCount),
        });
      }
      if (strengthSnapshot.totalReps) {
        stats.push({
          label: "Reps",
          value: String(strengthSnapshot.totalReps),
        });
      } else if (summary.rpe != null) {
        stats.push({
          label: "RPE",
          value: String(summary.rpe),
        });
      }
      if (strengthSnapshot.totalVolumeKg) {
        stats.push({
          label: "Volume",
          value: formatWeightKg(strengthSnapshot.totalVolumeKg),
        });
      }
      return stats.slice(0, 6);
    }

    const stats = [];
    if (summary.actualMinutes)
      stats.push({
        label: "Duration",
        value: formatMinutes(summary.actualMinutes),
      });
    if (summary.actualKm)
      stats.push({
        label: "Distance",
        value: formatKm(summary.actualKm),
      });
    if (summary.avgPace)
      stats.push({
        label: "Avg pace",
        value: formatPace(summary.avgPace),
      });
    else if (summary.movingPace)
      stats.push({
        label: "Moving pace",
        value: formatPace(summary.movingPace),
      });
    if (summary.avgHeartrate)
      stats.push({
        label: "Avg HR",
        value: formatBpm(summary.avgHeartrate),
      });
    if (summary.maxHeartrate)
      stats.push({
        label: "Max HR",
        value: formatBpm(summary.maxHeartrate),
      });
    if (summary.rpe != null)
      stats.push({
        label: "RPE",
        value: String(summary.rpe),
      });

    return stats.slice(0, 6);
  }, [isStrengthSession, strengthSnapshot, summary]);

  const compareRows = useMemo(() => {
    if (!summary) return [];

    const rows = [
      {
        label: "Duration",
        leftLabel: "Planned",
        leftValue: formatMinutes(summary.plannedMinutes),
        rightLabel: "Actual",
        rightValue: formatMinutes(summary.actualMinutes),
      },
      {
        label: "Distance",
        leftLabel: "Planned",
        leftValue: formatKm(summary.plannedKm),
        rightLabel: "Actual",
        rightValue: formatKm(summary.actualKm),
      },
    ];

    if (summary.avgPace || summary.movingPace) {
      rows.push({
        label: "Pace",
        leftLabel: "Avg",
        leftValue: formatPace(summary.avgPace),
        rightLabel: "Moving",
        rightValue: formatPace(summary.movingPace),
      });
    }

    if (summary.movingMinutes || summary.rpe != null) {
      rows.push({
        label: "Session",
        leftLabel: "Moving",
        leftValue: formatMinutes(summary.movingMinutes),
        rightLabel: "RPE",
        rightValue: summary.rpe != null ? String(summary.rpe) : null,
      });
    }

    if (isStrengthSession && strengthSnapshot) {
      rows.push({
        label: "Exercises",
        leftLabel: "Logged",
        leftValue:
          strengthSnapshot.totalExercises || strengthSnapshot.loggedExercises
            ? `${strengthSnapshot.loggedExercises}/${strengthSnapshot.totalExercises || strengthSnapshot.loggedExercises}`
            : null,
        rightLabel: "Sets",
        rightValue: formatCount(strengthSnapshot.setCount),
      });

      rows.push({
        label: "Strength",
        leftLabel: "Reps",
        leftValue: formatCount(strengthSnapshot.totalReps),
        rightLabel: "Volume",
        rightValue: formatWeightKg(strengthSnapshot.totalVolumeKg),
      });
    }

    return rows.filter(
      (row) => row.leftValue || row.rightValue
    );
  }, [isStrengthSession, strengthSnapshot, summary]);

  const keyStats = useMemo(() => {
    if (!summary) return [];

    const items = [];
    const push = (label, value, sub = "") => {
      const v = String(value || "").trim();
      if (!v) return;
      items.push({ label, value: v, sub: String(sub || "").trim() });
    };

    const plannedMin = Number(summary.plannedMinutes);
    const actualMin = Number(summary.actualMinutes);
    if (Number.isFinite(plannedMin) && plannedMin > 0 && Number.isFinite(actualMin) && actualMin > 0) {
      const pct = Math.round((actualMin / plannedMin) * 100);
      push("Duration vs plan", `${pct}%`, formatSignedDelta(actualMin - plannedMin, { suffix: "min" }));
    } else if (Number.isFinite(actualMin) && actualMin > 0) {
      push("Duration", formatMinutes(actualMin));
    }

    if (isStrengthSession && strengthSnapshot) {
      const totalExercises = Number(strengthSnapshot.totalExercises || 0);
      const loggedExercises = Number(strengthSnapshot.loggedExercises || 0);
      if (totalExercises > 0 || loggedExercises > 0) {
        push(
          "Exercises logged",
          `${loggedExercises}/${totalExercises || loggedExercises}`,
          strengthSnapshot.setCount ? `${Math.round(strengthSnapshot.setCount)} sets` : ""
        );
      }
      if (strengthSnapshot.totalReps) {
        push(
          "Strength reps",
          String(Math.round(strengthSnapshot.totalReps)),
          strengthSnapshot.totalVolumeKg
            ? `${Number(strengthSnapshot.totalVolumeKg).toFixed(1)} kg volume`
            : ""
        );
      } else if (summary.rpe != null) {
        push("Session RPE", `RPE ${summary.rpe}`);
      }
      if (summary.avgHeartrate || summary.maxHeartrate) {
        push(
          "Heart rate",
          formatBpm(summary.avgHeartrate) || "—",
          summary.maxHeartrate ? `Max ${formatBpm(summary.maxHeartrate)}` : ""
        );
      }
      return items.slice(0, 4);
    }

    const plannedKm = Number(summary.plannedKm);
    const actualKm = Number(summary.actualKm);
    if (Number.isFinite(plannedKm) && plannedKm > 0 && Number.isFinite(actualKm) && actualKm > 0) {
      const pct = Math.round((actualKm / plannedKm) * 100);
      push("Distance vs plan", `${pct}%`, formatSignedDelta(actualKm - plannedKm, { digits: 1, suffix: "km" }));
    } else if (Number.isFinite(actualKm) && actualKm > 0) {
      push("Distance", formatKm(actualKm));
    }

    const paceValue = formatPace(summary.avgPace) || formatPace(summary.movingPace);
    if (paceValue) {
      push(
        "Pace",
        paceValue,
        summary.avgPace && summary.movingPace
          ? `Moving ${formatPace(summary.movingPace)}`
          : ""
      );
    }

    if (summary.avgHeartrate || summary.maxHeartrate) {
      push(
        "Heart rate",
        formatBpm(summary.avgHeartrate) || "—",
        summary.maxHeartrate ? `Max ${formatBpm(summary.maxHeartrate)}` : ""
      );
    }

    if (summary.rpe != null) {
      push("Session RPE", `RPE ${summary.rpe}`);
    }

    return items.slice(0, 4);
  }, [isStrengthSession, strengthSnapshot, summary]);

  const splits = useMemo(() => {
    return Array.isArray(session?.live?.splits) ? session.live.splits : [];
  }, [session]);

  const sequence = useMemo(() => {
    return Array.isArray(session?.live?.steps?.sequence)
      ? session.live.steps.sequence
      : [];
  }, [session]);

  const segments = useMemo(() => {
    return Array.isArray(session?.segments) ? session.segments : [];
  }, [session]);

  const strengthSections = useMemo(() => {
    if (!isStrengthSession) return [];

    const entries = Array.isArray(session?.strengthLog?.entries)
      ? session.strengthLog.entries
      : [];
    const out = [];
    const byKey = new Map();

    entries.forEach((entry) => {
      const blockTitle = String(entry?.blockTitle || "Main block").trim() || "Main block";
      const key = blockTitle.toLowerCase();
      let section = byKey.get(key);
      if (!section) {
        section = { title: blockTitle, items: [] };
        byKey.set(key, section);
        out.push(section);
      }
      section.items.push(entry);
    });

    return out;
  }, [isStrengthSession, session?.strengthLog?.entries]);

  const linkedActivity = useMemo(() => {
    const linked = session?.linkedActivity;
    if (!linked || typeof linked !== "object") return null;
    const provider = String(linked.provider || "").trim() || "External";
    const reference = String(linked.reference || "").trim();
    const title = String(linked.title || "").trim();
    return {
      provider,
      reference,
      title,
      startDateLocal: linked.startDateLocal || linked.startDate || null,
      deviceName: linked.deviceName || null,
      distanceKm: linked.distanceKm ?? null,
      movingTimeMin: linked.movingTimeMin ?? null,
      averageHeartrate: linked.averageHeartrate ?? null,
      maxHeartrate: linked.maxHeartrate ?? null,
      openable:
        provider.toLowerCase() === "strava" &&
        reference &&
        !Number.isNaN(new Date(String(linked.startDateLocal || linked.startDate || "")).getTime()),
    };
  }, [session?.linkedActivity]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: stickyHeaderInset,
          paddingBottom: 18,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={[st.loadingWrap, st.sectionSpace]}>
            <ActivityIndicator />
            <Text style={{ color: theme.subtext, marginTop: 6 }}>Loading…</Text>
          </View>
        ) : error ? (
          <View style={[st.loadingWrap, st.sectionSpace]}>
            <Text style={{ color: theme.danger, fontWeight: "900" }}>{error}</Text>
          </View>
        ) : session && summary ? (
          <>
            <View
              style={[st.heroCard, st.sectionSpace]}
            >
              <Text style={[st.label, { color: theme.subtext }]}>
                {summary.dateLabel}
              </Text>

              <Text style={[st.title, { color: theme.text }]}>{summary.title}</Text>

              <View style={st.heroMetaRow}>
                <InfoChip label={type} theme={theme} />
                <InfoChip
                  label={status}
                  theme={theme}
                  tone={
                    status === "Completed"
                      ? "accent"
                      : status === "Skipped"
                      ? "danger"
                      : "neutral"
                  }
                />
              </View>

              {!!summary.primaryActivity && !isStrengthSession && (
                <Text
                  style={{ color: theme.subtext, marginTop: 8, lineHeight: 18 }}
                >
                  {summary.primaryActivity}
                </Text>
              )}

              <View style={st.summaryStatsRow}>
                {topStats.length ? (
                  topStats.map((item) => (
                    <StatCard
                      key={item.label}
                      label={item.label}
                      value={item.value}
                      theme={theme}
                    />
                  ))
                ) : (
                  <StatCard label="Status" value={status} theme={theme} />
                )}
              </View>

              {compareRows.length > 0 && !isStrengthSession && (
                <View style={[st.metricGroup, { borderTopColor: theme.border }]}>
                  {compareRows.map((row, idx) => (
                    <MetricRow
                      key={`${row.label}-${idx}`}
                      label={row.label}
                      leftLabel={row.leftLabel}
                      leftValue={row.leftValue}
                      rightLabel={row.rightLabel}
                      rightValue={row.rightValue}
                      theme={theme}
                      showDivider={idx < compareRows.length - 1}
                    />
                  ))}
                </View>
              )}
            </View>

            {keyStats.length > 0 && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>Key stats</Text>

                <View style={st.keyStatsGrid}>
                  {keyStats.map((item, idx) => (
                    <KeyStatCard
                      key={`key-stat-${item.label}-${idx}`}
                      label={item.label}
                      value={item.value}
                      sub={item.sub}
                      theme={theme}
                    />
                  ))}
                </View>
              </View>
            )}

            {descriptionInsights && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>
                  Description analysis
                </Text>

                <View
                  style={[
                    st.detailCard,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <Text style={[st.noteLabel, { color: theme.subtext }]}>
                    Source
                  </Text>
                  <Text style={[st.descriptionSourceText, { color: theme.text }]}>
                    {descriptionInsights.source}
                  </Text>

                  <View style={st.descriptionHeadlineRow}>
                    <Feather name="zap" size={14} color={theme.primaryBg} />
                    <Text style={[st.descriptionHeadline, { color: theme.text }]}>
                      {descriptionInsights.headline}
                    </Text>
                  </View>

                  {descriptionInsights.bullets.map((line, idx) => (
                    <Text key={`desc-analysis-${idx}`} style={[st.descriptionBullet, { color: theme.text }]}>
                      • {line}
                    </Text>
                  ))}
                </View>
              </View>
            )}

            {isStrengthSession && strengthSections.length > 0 && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>
                  Completed exercises
                </Text>

                {strengthSections.map((section, sectionIdx) => (
                  <View
                    key={`strength-section-${sectionIdx}`}
                    style={[
                      st.detailCard,
                      st.strengthSectionCard,
                      { backgroundColor: theme.card, borderColor: theme.border },
                    ]}
                  >
                    <Text style={[st.strengthSectionOverline, { color: theme.subtext }]}>
                      Block {sectionIdx + 1}
                    </Text>
                    <Text style={[st.cardTitle, { color: theme.text, marginTop: 2 }]}>
                      {section.title}
                    </Text>

                    <View style={st.strengthEntryStack}>
                      {section.items.map((entry, entryIdx) => {
                        const prescribed = entry?.prescribed || {};
                        const performed = entry?.performed || {};
                        const setLogs = Array.isArray(performed?.setLogs) ? performed.setLogs : [];

                        const prescriptionBits = [
                          prescribed?.sets && prescribed?.reps
                            ? `${prescribed.sets} x ${prescribed.reps}`
                            : prescribed?.sets
                            ? `${prescribed.sets} sets`
                            : prescribed?.reps
                            ? `${prescribed.reps} reps`
                            : null,
                          formatWeightKg(prescribed?.loadKg),
                          formatRestLabel(prescribed?.restSec),
                          formatRpeLabel(prescribed?.rpe, "Target RPE"),
                        ].filter(Boolean);

                        const performedBits = [
                          performed?.completedSets
                            ? `${performed.completedSets} completed sets`
                            : performed?.sets
                            ? `${performed.sets} tracked sets`
                            : null,
                          Number(performed?.metrics?.totalReps || 0) > 0
                            ? `${performed.metrics.totalReps} reps`
                            : null,
                          Number(performed?.metrics?.volumeKg || 0) > 0
                            ? formatWeightKg(performed.metrics.volumeKg)
                            : null,
                          formatRpeLabel(performed?.actualRpe, "Actual RPE"),
                        ].filter(Boolean);

                        return (
                          <View
                            key={`${entry?.id || entryIdx}`}
                            style={[
                              st.strengthEntryCard,
                              {
                                borderTopColor:
                                  entryIdx === 0 ? "transparent" : theme.border,
                              },
                            ]}
                          >
                            <View style={st.rowBetween}>
                              <View style={{ flex: 1 }}>
                                <Text style={[st.strengthEntryTitle, { color: theme.text }]}>
                                  {entry?.title || `Exercise ${entryIdx + 1}`}
                                </Text>
                                {!!prescriptionBits.length && (
                                  <Text style={[st.cardSubtext, { color: theme.subtext }]}>
                                    {prescriptionBits.join(" · ")}
                                  </Text>
                                )}
                              </View>

                              <View
                                style={[
                                  st.entryStatusPill,
                                  {
                                    backgroundColor:
                                      performed?.completed ||
                                      Number(performed?.completedSets || 0) > 0
                                        ? theme.primaryBg
                                        : theme.muted,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    st.entryStatusText,
                                    {
                                      color:
                                        performed?.completed ||
                                        Number(performed?.completedSets || 0) > 0
                                          ? theme.primaryText
                                          : theme.text,
                                    },
                                  ]}
                                >
                                  {performed?.completed ||
                                  Number(performed?.completedSets || 0) > 0
                                    ? "Logged"
                                    : "Planned"}
                                </Text>
                              </View>
                            </View>

                            {!!performedBits.length && (
                              <View style={st.detailPillRow}>
                                {performedBits.map((bit, bitIdx) => (
                                  <View
                                    key={`${entry?.id || entryIdx}-bit-${bitIdx}`}
                                    style={[
                                      st.detailPill,
                                      { backgroundColor: theme.muted },
                                    ]}
                                  >
                                    <Text style={[st.detailPillText, { color: theme.text }]}>
                                      {bit}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}

                            {setLogs.length > 0 ? (
                              <View style={st.setLogStack}>
                                {setLogs.map((setRow, setIdx) => {
                                  const setParts = [
                                    formatWeightKg(setRow?.loadKg),
                                    formatCount(setRow?.reps, " reps"),
                                  ].filter(Boolean);
                                  return (
                                    <View
                                      key={`${entry?.id || entryIdx}-set-${setIdx}`}
                                      style={[
                                        st.setLogRow,
                                        { backgroundColor: theme.muted },
                                      ]}
                                    >
                                      <Text style={[st.setLogIndex, { color: theme.subtext }]}>
                                        Set {setRow?.set || setIdx + 1}
                                      </Text>
                                      <Text style={[st.setLogValue, { color: theme.text }]}>
                                        {setParts.join(" · ") || "No load / reps logged"}
                                      </Text>
                                      <Text
                                        style={[
                                          st.setLogDone,
                                          {
                                            color: setRow?.completed
                                              ? theme.primaryBg
                                              : theme.subtext,
                                          },
                                        ]}
                                      >
                                        {setRow?.completed ? "Done" : "Logged"}
                                      </Text>
                                    </View>
                                  );
                                })}
                              </View>
                            ) : null}

                            {!!performed?.notes && (
                              <View style={st.exerciseNoteWrap}>
                                <Text style={[st.noteLabel, { color: theme.subtext }]}>
                                  Exercise notes
                                </Text>
                                <Text style={[st.exerciseNoteText, { color: theme.text }]}>
                                  {performed.notes}
                                </Text>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {splits.length > 0 && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>Splits</Text>

                <View style={[st.flatList, { borderTopColor: theme.border }]}>
                  {splits.map((sp, idx) => (
                    <View
                      key={`split-${idx}`}
                      style={[
                        st.flatRow,
                        idx < splits.length - 1
                          ? {
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: theme.border,
                            }
                          : null,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontWeight: "900" }}>
                          {sp?.km ?? idx + 1} km
                        </Text>
                        {(sp?.elev != null || sp?.hr != null) && (
                          <Text style={[st.rowMetaText, { color: theme.subtext }]}>
                            {sp?.elev != null ? `Elev ${sp.elev}` : ""}
                            {sp?.elev != null && sp?.hr != null ? " · " : ""}
                            {sp?.hr != null ? `HR ${sp.hr}` : ""}
                          </Text>
                        )}
                      </View>

                      <Text style={{ color: theme.text, fontWeight: "900" }}>
                        {sp?.pace || "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {sequence.length > 0 && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>
                  Executed steps
                </Text>

                <View style={[st.flatList, { borderTopColor: theme.border }]}>
                  {sequence.map((item, idx) => (
                    <View
                      key={`seq-${idx}`}
                      style={[
                        st.timelineRow,
                        idx < sequence.length - 1
                          ? {
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: theme.border,
                            }
                          : null,
                      ]}
                    >
                      <View style={[st.stepIndex, { backgroundColor: theme.muted }]}>
                        <Text style={{ color: theme.text, fontWeight: "900" }}>
                          {idx + 1}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontWeight: "900" }}>
                          {item?.title || "Step"}
                        </Text>

                        {!!item?.durationLabel && (
                          <Text style={[st.rowMetaText, { color: theme.subtext }]}>
                            {item.durationLabel}
                          </Text>
                        )}

                        {!!item?.notes && (
                          <Text
                            style={{
                              color: theme.subtext,
                              marginTop: 4,
                              lineHeight: 18,
                            }}
                          >
                            {item.notes}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {segments.length > 0 && sequence.length === 0 && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>
                  Session structure
                </Text>

                <View style={[st.flatList, { borderTopColor: theme.border }]}>
                  {segments.map((seg, idx) => (
                    <View
                      key={`seg-${idx}`}
                      style={[
                        st.flatRow,
                        idx < segments.length - 1
                          ? {
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: theme.border,
                            }
                          : null,
                      ]}
                    >
                      <Text
                        style={{ color: theme.text, fontWeight: "900", flex: 1 }}
                      >
                        {seg?.title || seg?.name || seg?.type || `Segment ${idx + 1}`}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {analysis && (
              <View style={st.sectionSpace}>
                <Text style={[st.sectionTitle, { color: theme.text }]}>
                  AI feedback
                </Text>

                {!!analysis.summary && (
                  <Text
                    style={{ color: theme.text, marginTop: 8, lineHeight: 20 }}
                  >
                    {analysis.summary}
                  </Text>
                )}

                {Array.isArray(analysis.strengths) &&
                  analysis.strengths.length > 0 && (
                    <View style={st.feedbackBlock}>
                      <Text style={[st.subLabel, { color: theme.subtext }]}>
                        Strengths
                      </Text>
                      {analysis.strengths.map((x, i) => (
                        <Text
                          key={`s-${i}`}
                          style={[st.bulletText, { color: theme.text }]}
                        >
                          • {x}
                        </Text>
                      ))}
                    </View>
                  )}

                {Array.isArray(analysis.weakPoints) &&
                  analysis.weakPoints.length > 0 && (
                    <View style={st.feedbackBlock}>
                      <Text style={[st.subLabel, { color: theme.subtext }]}>
                        To improve
                      </Text>
                      {analysis.weakPoints.map((x, i) => (
                        <Text
                          key={`w-${i}`}
                          style={[st.bulletText, { color: theme.text }]}
                        >
                          • {x}
                        </Text>
                      ))}
                    </View>
                  )}

                {Array.isArray(analysis.suggestions) &&
                  analysis.suggestions.length > 0 && (
                    <View style={st.feedbackBlock}>
                      <Text style={[st.subLabel, { color: theme.subtext }]}>
                        Next session focus
                      </Text>
                      {analysis.suggestions.map((x, i) => (
                        <Text
                          key={`n-${i}`}
                          style={[st.bulletText, { color: theme.text }]}
                        >
                          • {x}
                        </Text>
                      ))}
                    </View>
                  )}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>

      <View pointerEvents="box-none" style={st.stickyHeaderWrap}>
        <LinearGradient
          pointerEvents="none"
          colors={
            theme.isDark
              ? ["rgba(0,0,0,0.78)", "rgba(0,0,0,0.32)", "transparent"]
              : ["rgba(15,23,42,0.28)", "rgba(15,23,42,0.08)", "transparent"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={st.stickyHeaderFade}
        />

        <View style={[st.stickyHeaderRow, { paddingTop: stickyHeaderTop }]}>
          <TouchableOpacity
            onPress={goBackToPreviousScreen}
            style={st.headerIconBtn}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </TouchableOpacity>

          <Text style={[st.h4, { color: theme.text }]}>Session</Text>

          <TouchableOpacity
            onPress={() => setInfoOpen(true)}
            disabled={!session || !summary}
            style={[
              st.headerIconBtn,
              { opacity: session && summary ? 1 : 0.45 },
            ]}
            activeOpacity={0.85}
          >
            <Feather name="info" size={17} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={infoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoOpen(false)}
      >
        <View style={st.sheetOverlay}>
          <TouchableOpacity
            style={st.sheetBackdrop}
            activeOpacity={1}
            onPress={() => setInfoOpen(false)}
          />

          <View
            style={[
              st.sheetPanel,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <View
              style={[
                st.sheetHandle,
                { backgroundColor: theme.border },
              ]}
            />

            <View style={st.sheetHeader}>
              <Text style={[st.sheetTitle, { color: theme.text }]}>Session info</Text>
              <TouchableOpacity
                onPress={() => setInfoOpen(false)}
                style={[
                  st.iconBtn,
                  st.sheetCloseBtn,
                  { borderColor: theme.border, backgroundColor: theme.muted },
                ]}
                activeOpacity={0.85}
              >
                <Feather name="x" size={16} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={st.sheetScrollContent}
            >
              <View
                style={[
                  st.detailCard,
                  st.infoCard,
                  { backgroundColor: theme.muted, borderColor: theme.border },
                ]}
              >
                <Text style={[st.noteLabel, { color: theme.subtext }]}>
                  External activity
                </Text>

                {linkedActivity ? (
                  <>
                    <Text style={[st.inlineSectionTitle, { color: theme.text }]}>
                      {linkedActivity.title || `${linkedActivity.provider} activity`}
                    </Text>
                    <Text style={[st.cardSubtext, { color: theme.subtext }]}>
                      {linkedActivity.provider}
                      {linkedActivity.startDateLocal
                        ? ` · ${formatDateLabel(linkedActivity.startDateLocal, null)}`
                        : ""}
                    </Text>

                    <View style={st.detailPillRow}>
                      {formatMinutes(linkedActivity.movingTimeMin) ? (
                        <View
                          style={[
                            st.detailPill,
                            { backgroundColor: theme.card },
                          ]}
                        >
                          <Text style={[st.detailPillText, { color: theme.text }]}>
                            {formatMinutes(linkedActivity.movingTimeMin)}
                          </Text>
                        </View>
                      ) : null}
                      {formatKm(linkedActivity.distanceKm) ? (
                        <View
                          style={[
                            st.detailPill,
                            { backgroundColor: theme.card },
                          ]}
                        >
                          <Text style={[st.detailPillText, { color: theme.text }]}>
                            {formatKm(linkedActivity.distanceKm)}
                          </Text>
                        </View>
                      ) : null}
                      {formatBpm(linkedActivity.averageHeartrate) ? (
                        <View
                          style={[
                            st.detailPill,
                            { backgroundColor: theme.card },
                          ]}
                        >
                          <Text style={[st.detailPillText, { color: theme.text }]}>
                            {formatBpm(linkedActivity.averageHeartrate)}
                          </Text>
                        </View>
                      ) : null}
                      {formatBpm(linkedActivity.maxHeartrate) ? (
                        <View
                          style={[
                            st.detailPill,
                            { backgroundColor: theme.card },
                          ]}
                        >
                          <Text style={[st.detailPillText, { color: theme.text }]}>
                            {formatBpm(linkedActivity.maxHeartrate)}
                          </Text>
                        </View>
                      ) : null}
                      {linkedActivity.deviceName ? (
                        <View
                          style={[
                            st.detailPill,
                            { backgroundColor: theme.card },
                          ]}
                        >
                          <Text style={[st.detailPillText, { color: theme.text }]}>
                            {linkedActivity.deviceName}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : (
                  <Text style={[st.cardSubtext, { color: theme.subtext, marginTop: 6 }]}>
                    No Strava activity linked yet.
                  </Text>
                )}

                <View style={st.cardActionRow}>
                  {linkedActivity?.provider?.toLowerCase() === "strava" &&
                  linkedActivity.reference ? (
                    <TouchableOpacity
                      onPress={() => {
                        setInfoOpen(false);
                        router.push(`/history/${linkedActivity.reference}`);
                      }}
                      style={[
                        st.inlineActionBtn,
                        { borderColor: theme.border, backgroundColor: theme.card },
                      ]}
                      activeOpacity={0.85}
                    >
                      <Feather name="arrow-up-right" size={14} color={theme.text} />
                      <Text style={[st.inlineActionText, { color: theme.text }]}>
                        Open Strava
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    onPress={() => {
                      setInfoOpen(false);
                      router.push({
                        pathname: "/history",
                        params: {
                          linkTrainSessionId: String(session.id),
                          linkSessionTitle: summary.title,
                        },
                      });
                    }}
                    style={[
                      st.inlineActionBtn,
                      { borderColor: theme.border, backgroundColor: theme.card },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Feather name="link" size={14} color={theme.text} />
                    <Text style={[st.inlineActionText, { color: theme.text }]}>
                      {linkedActivity?.provider?.toLowerCase() === "strava"
                        ? "Change Strava link"
                        : "Choose Strava activity"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {!!summary?.notes && (
                <View
                  style={[
                    st.detailCard,
                    st.infoCard,
                    { backgroundColor: theme.muted, borderColor: theme.border },
                  ]}
                >
                  <Text style={[st.noteLabel, { color: theme.subtext }]}>Notes</Text>
                  <Text style={[st.sheetNoteText, { color: theme.text }]}>
                    {summary.notes}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  topSpacing: {
    marginBottom: 8,
  },
  stickyHeaderWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    pointerEvents: "box-none",
  },
  stickyHeaderFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 118,
  },
  stickyHeaderRow: {
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionSpace: {
    marginBottom: 14,
  },
  loadingWrap: {
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
  },

  h4: {
    fontSize: 17,
    fontWeight: "900",
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
  },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineActionBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inlineActionText: {
    fontSize: 12,
    fontWeight: "900",
  },
  cardActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },

  pillBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  heroCard: {
    paddingHorizontal: 2,
    paddingVertical: 0,
  },
  detailCard: {
    marginTop: 6,
    borderRadius: 18,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  strengthSectionCard: {
    marginTop: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  cardSubtext: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },

  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },

  summaryStatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
    gap: 6,
  },
  keyStatsGrid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  keyStatCard: {
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 74,
  },
  keyStatLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  keyStatValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "900",
  },
  keyStatSub: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },

  statCard: {
    minWidth: 80,
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },

  statValue: {
    fontSize: 14,
    fontWeight: "900",
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "800",
    marginTop: 3,
  },

  infoChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  infoChipText: {
    fontSize: 10,
    fontWeight: "900",
  },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "900",
  },

  subLabel: {
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  metricGroup: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 2,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 8,
  },
  metricLabelCol: {
    width: 62,
    paddingTop: 2,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  metricValueCol: {
    flex: 1,
    minWidth: 0,
  },
  metricValueLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
  metricValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "900",
  },

  noteBlock: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  inlineSectionTitle: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: "900",
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  flatList: {
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  strengthSectionOverline: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  strengthEntryStack: {
    marginTop: 8,
  },
  strengthEntryCard: {
    paddingTop: 10,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  strengthEntryTitle: {
    fontSize: 14,
    fontWeight: "900",
  },
  entryStatusPill: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  entryStatusText: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  detailPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  detailPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  detailPillText: {
    fontSize: 10,
    fontWeight: "800",
  },
  setLogStack: {
    marginTop: 8,
    gap: 6,
  },
  setLogRow: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  setLogIndex: {
    width: 40,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  setLogValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  setLogDone: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  exerciseNoteWrap: {
    marginTop: 8,
  },
  exerciseNoteText: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
  },
  descriptionSourceText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
  },
  descriptionHeadlineRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  descriptionHeadline: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  descriptionBullet: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
  },

  flatRow: {
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowMetaText: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
  },

  timelineRow: {
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepIndex: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  feedbackBlock: {
    marginTop: 10,
  },

  bulletText: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.56)",
  },
  sheetPanel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: "70%",
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    alignSelf: "center",
  },
  sheetHeader: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "900",
  },
  sheetCloseBtn: {
    width: 34,
    height: 34,
  },
  sheetScrollContent: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  infoCard: {
    marginTop: 0,
    marginBottom: 10,
  },
  sheetNoteText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
  },

  label: {
    fontSize: 11,
    fontWeight: "800",
  },
});
