// app/(protected)/nutrition/weight.jsx

/**
 * WEIGHT TRACKING PAGE — APPLE-STYLE + SAP GEL ACCENT
 * - Shows latest weight + change over time
 * - Period selector (1W / 1M / 3M / All)
 * - Clear trend graph with area + min/mid/max labels
 * - Points tap-able for exact value + time
 * - Simple "is the plan working?" message using nutrition goal (if present)
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Line,
  Path,
  Polyline,
  Text as SvgText,
} from "react-native-svg";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRAPH_HEIGHT = 220;
// extra room on left so Y labels don't get clipped
const GRAPH_PADDING_LEFT = 52;
const GRAPH_PADDING_RIGHT = 16;
const GRAPH_PADDING_TOP = 18;
const GRAPH_PADDING_BOTTOM = 26;
const GRAPH_Y_MIN_SPAN_KG = 2.4;
const GRAPH_Y_SPREAD_MULTIPLIER = 1.75;
const PERIOD_OPTIONS = [
  { key: "1W", chipLabel: "1W", rangeLabel: "Last 7 days", daysBack: 7 },
  { key: "1M", chipLabel: "1M", rangeLabel: "Last 30 days", daysBack: 30 },
  { key: "3M", chipLabel: "3M", rangeLabel: "Last 90 days", daysBack: 90 },
  { key: "6M", chipLabel: "6M", rangeLabel: "Last 180 days", daysBack: 180 },
  { key: "ALL", chipLabel: "1Y", rangeLabel: "Last 12 months", daysBack: 365 },
];

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function coerceDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const sec =
    typeof value?.seconds === "number"
      ? value.seconds
      : typeof value?._seconds === "number"
      ? value._seconds
      : null;

  if (Number.isFinite(sec)) {
    const nanos =
      typeof value?.nanoseconds === "number"
        ? value.nanoseconds
        : typeof value?._nanoseconds === "number"
        ? value._nanoseconds
        : 0;
    const d = new Date(sec * 1000 + Math.floor(nanos / 1e6));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export default function WeightPage() {
  const { colors, isDark } = useTheme();

  // SAP GEL accent + on-accent text
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const onAccent = colors.sapOnPrimary || "#111111";

  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState([]);
  const [newWeight, setNewWeight] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [period, setPeriod] = useState("1M"); // "1W" | "1M" | "3M" | "ALL"

  const [nutritionGoal, setNutritionGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [showAddEntrySheet, setShowAddEntrySheet] = useState(false);

  const s = makeStyles(colors, isDark, accent, onAccent);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // subscribe to weight entries
  useEffect(() => {
    if (!user) return;

    const ref = collection(db, "users", user.uid, "weights");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setWeights(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  // fetch nutrition goal (for "plan working" hint)
  useEffect(() => {
    if (!user) return;

    const run = async () => {
      try {
        const ref = doc(db, "users", user.uid, "nutrition", "profile");
        const snap = await getDoc(ref);
        setNutritionGoal(snap.exists() ? snap.data() : null);
      } catch {
        setNutritionGoal(null);
      } finally {
        setGoalLoading(false);
      }
    };

    run();
  }, [user]);

  const normaliseDate = useCallback((tsOrDate) => coerceDate(tsOrDate), []);

  const weightsAsc = useMemo(() => {
    return [...weights].sort((a, b) => {
      const da = normaliseDate(a.date || a.createdAt) || new Date(0);
      const db = normaliseDate(b.date || b.createdAt) || new Date(0);
      return da - db;
    });
  }, [weights, normaliseDate]);

  const weightsDesc = useMemo(() => {
    return [...weightsAsc].reverse();
  }, [weightsAsc]);

  const latest = weightsDesc[0] || null;

  const getWeightsForPeriod = useCallback((rows, periodKey) => {
    if (!rows.length) return [];

    const selected =
      PERIOD_OPTIONS.find((option) => option.key === periodKey) || null;
    const daysBack = selected?.daysBack;

    if (!Number.isFinite(daysBack)) return rows;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    return rows.filter((w) => {
      const d = normaliseDate(w.date || w.createdAt);
      return d && d >= cutoff;
    });
  }, [normaliseDate]);

  const graphablePeriods = useMemo(
    () =>
      PERIOD_OPTIONS.filter(
        (option) => getWeightsForPeriod(weightsAsc, option.key).length >= 1
      ),
    [weightsAsc, getWeightsForPeriod]
  );

  const activePeriod = useMemo(() => {
    if (graphablePeriods.some((option) => option.key === period)) return period;
    return graphablePeriods[0]?.key || period;
  }, [graphablePeriods, period]);

  // filter by selected period
  const filteredWeights = useMemo(() => {
    return getWeightsForPeriod(weightsAsc, activePeriod);
  }, [weightsAsc, activePeriod, getWeightsForPeriod]);

  // clear selected point when period changes / data changes
  useEffect(() => {
    setSelectedPoint(null);
  }, [activePeriod, weightsAsc.length]);

  const trend = useMemo(() => {
    if (filteredWeights.length < 2) return null;

    const first = filteredWeights[0];
    const last = filteredWeights[filteredWeights.length - 1];
    const start = Number(first.weight || first.value || 0);
    const end = Number(last.weight || last.value || 0);
    const diff = end - start;

    const startDate = normaliseDate(first.date || first.createdAt);
    const endDate = normaliseDate(last.date || last.createdAt);
    if (!startDate || !endDate) return { start, end, diff };

    const ms = endDate.getTime() - startDate.getTime();
    const days = Math.max(1, ms / (1000 * 60 * 60 * 24));
    const perWeek = (diff / days) * 7;

    return {
      start,
      end,
      diff,
      days,
      perWeek,
    };
  }, [filteredWeights, normaliseDate]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, []);

  const formatDate = (tsOrDate) => {
    const d = normaliseDate(tsOrDate);
    if (!d) return "";
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  };

  const formatTime = (tsOrDate) => {
    const d = normaliseDate(tsOrDate);
    if (!d) return "";
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleAddWeight = async () => {
    const trimmed = newWeight.trim().replace(",", ".");
    if (!trimmed) return false;

    const value = Number(trimmed);
    if (!isFinite(value) || value <= 0) {
      Alert.alert("Check value", "Enter a valid weight in kg.");
      return false;
    }

    if (!user) {
      Alert.alert("Not signed in", "Please log in again.");
      return false;
    }

    try {
      setSaving(true);
      const ref = collection(db, "users", user.uid, "weights");

      await addDoc(ref, {
        weight: value,
        unit: "kg",
        note: newNote.trim() || "",
        date: Timestamp.now(),
        createdAt: serverTimestamp(),
      });

      setNewWeight("");
      setNewNote("");
      Keyboard.dismiss();
      return true;
    } catch (err) {
      Alert.alert(
        "Could not save",
        err?.message || "Please try again in a moment."
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWeight = (item) => {
    if (!user) return;

    Alert.alert(
      "Delete entry?",
      `Remove ${item.weight} kg from ${formatDate(item.date || item.createdAt)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const ref = doc(db, "users", user.uid, "weights", item.id);
              await deleteDoc(ref);
            } catch (err) {
              Alert.alert(
                "Could not delete",
                err?.message || "Please try again."
              );
            }
          },
        },
      ]
    );
  };

  const trendLabel = useMemo(() => {
    if (!trend) return "Not enough data yet.";
    const { diff } = trend;
    const rounded = Math.round(diff * 10) / 10;

    if (rounded === 0) return "No change over this period.";
    if (rounded < 0)
      return `Down ${Math.abs(rounded)} kg over this period.`;
    return `Up ${rounded} kg over this period.`;
  }, [trend]);

  const headerSubtitle = (() => {
    if (!latest) return `Today • ${todayLabel}`;
    const d = normaliseDate(latest.date || latest.createdAt);
    const isToday = d && d.toDateString() === new Date().toDateString();
    if (isToday) return `Latest • Today ${todayLabel}`;
    return `Latest • ${formatDate(latest.date || latest.createdAt)} at ${formatTime(
      latest.date || latest.createdAt
    )}`;
  })();

  // label like "Last 7 days" / "Last 30 days"
  const periodLabel = useMemo(() => {
    return (
      PERIOD_OPTIONS.find((option) => option.key === activePeriod)
        ?.rangeLabel || "All time"
    );
  }, [activePeriod]);

  const currentWeightValue = latest ? Number(latest.weight || latest.value || 0) : null;
  const startWeightValue =
    filteredWeights.length > 0
      ? Number(filteredWeights[0].weight || filteredWeights[0].value || 0)
      : null;
  const changeValue = trend?.diff ?? null;
  const weeklyChangeValue = trend?.perWeek ?? null;

  const trendIconName = useMemo(() => {
    if (!trend) return "minus";
    if (trend.diff < 0) return "trending-down";
    if (trend.diff > 0) return "trending-up";
    return "minus";
  }, [trend]);

  const formatKg = useCallback((value, digits = 1) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return `${n.toFixed(digits).replace(/\.0$/, "")} kg`;
  }, []);

  const formatSignedKg = useCallback((value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    const abs = Math.abs(n).toFixed(1).replace(/\.0$/, "");
    if (n === 0) return "0 kg";
    return `${n > 0 ? "+" : "-"}${abs} kg`;
  }, []);

  const adjustDraftWeight = useCallback(
    (delta) => {
      const parsed = Number(newWeight.trim().replace(",", "."));
      const fallback = Number(latest?.weight || latest?.value || 0);
      const base = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      if (!Number.isFinite(base) || base <= 0) return;

      const next = Math.max(0, Math.round((base + delta) * 10) / 10);
      setNewWeight(next.toFixed(1).replace(/\.0$/, ""));
    },
    [newWeight, latest]
  );

  const applyLatestWeight = useCallback(() => {
    const fallback = Number(latest?.weight || latest?.value || 0);
    if (!Number.isFinite(fallback) || fallback <= 0) return;
    setNewWeight(fallback.toFixed(1).replace(/\.0$/, ""));
  }, [latest]);

  // ---- simple "is the plan working?" text based on goalType + trend ----
  const planFeedback = useMemo(() => {
    if (!nutritionGoal || !trend) return null;

    const goalType = nutritionGoal.goalType || nutritionGoal.type; // be forgiving
    if (!goalType) return null;

    const perWeek = trend.perWeek ?? 0;
    const rounded = Math.round(perWeek * 10) / 10;

    if (goalType === "fat_loss") {
      if (rounded < -1) {
        return `Weight is dropping quickly (~${Math.abs(
          rounded
        )} kg/week). Consider a slightly higher calorie target if energy or performance is suffering.`;
      }
      if (rounded < -0.25) {
        return `Trend supports fat loss (~${Math.abs(
          rounded
        )} kg/week). Keep an eye on recovery and adjust if you feel flat.`;
      }
      if (rounded > 0.1) {
        return `Weight is creeping up (~${rounded} kg/week). If fat loss is the goal, consider tightening calories or increasing activity.`;
      }
      return `Weight is fairly stable. If you expected more loss, you may be closer to maintenance than a deficit.`;
    }

    if (goalType === "muscle_gain") {
      if (rounded > 0.75) {
        return `Weight is climbing fast (~${rounded} kg/week). This might be more than needed for lean gain — consider a slightly smaller surplus.`;
      }
      if (rounded > 0.25) {
        return `Trend supports muscle gain (~${rounded} kg/week). Check strength and performance — if they’re rising too, you’re on track.`;
      }
      if (rounded < -0.1) {
        return `Weight is drifting down (~${Math.abs(
          rounded
        )} kg/week). For muscle gain, you may need more calories.`;
      }
      return `Weight is mostly flat. For muscle gain, a small surplus might help move things along.`;
    }

    // default / maintenance
    if (Math.abs(rounded) < 0.1) {
      return `Weight is very stable (~${rounded} kg/week), which is consistent with maintenance.`;
    }
    if (rounded > 0.1) {
      return `Weight is trending up (~${rounded} kg/week). If maintenance is the goal, you may be slightly above your ideal calorie level.`;
    }
    return `Weight is trending down (~${Math.abs(
      rounded
    )} kg/week). If you aimed for maintenance, you might be in a small deficit.`;
  }, [nutritionGoal, trend]);

  /* --------------- row component --------------- */

  const renderRow = (item) => (
    <TouchableOpacity
      key={item.id}
      activeOpacity={0.7}
      onLongPress={() => handleDeleteWeight(item)}
      style={s.entryRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.entryWeight}>{item.weight} kg</Text>
        <Text style={s.entryDate}>
          {formatDate(item.date || item.createdAt)} · {formatTime(
            item.date || item.createdAt
          )}
        </Text>
        {item.note ? (
          <Text style={s.entryNote} numberOfLines={1}>
            {item.note}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={() => handleDeleteWeight(item)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={s.deleteMini}
        activeOpacity={0.8}
      >
        <Feather name="trash-2" size={16} color={colors.subtext} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  /* ----------------- UI ----------------- */

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          style={s.page}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* HEADER + OVERVIEW */}
          <View style={s.headerCard}>
            <View style={s.headerRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={s.backButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="chevron-left" size={22} color={colors.text} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={s.headerEyebrow}>Body Metrics</Text>
                <Text style={s.headerTitle}>Weight</Text>
                <Text style={s.headerSubtitle}>{headerSubtitle}</Text>

                <View style={s.headerMetaRow}>
                  <View style={s.headerMetaPill}>
                    <Feather name="bar-chart-2" size={13} color={colors.subtext} />
                    <Text style={s.headerMetaText}>{periodLabel}</Text>
                  </View>
                  <View style={s.headerMetaPill}>
                    <Feather name="list" size={13} color={colors.subtext} />
                    <Text style={s.headerMetaText}>
                      {weights.length} entr{weights.length === 1 ? "y" : "ies"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={s.kpiGrid}>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Current</Text>
                <Text style={s.kpiValue}>{formatKg(currentWeightValue)}</Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Change</Text>
                <Text style={s.kpiValue}>{formatSignedKg(changeValue)}</Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Weekly</Text>
                <Text style={s.kpiValue}>
                  {Number.isFinite(weeklyChangeValue)
                    ? formatSignedKg(weeklyChangeValue)
                    : "--"}
                </Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Start</Text>
                <Text style={s.kpiValue}>{formatKg(startWeightValue)}</Text>
              </View>
            </View>

            <View style={s.trendRow}>
              <Feather name={trendIconName} size={16} color={colors.subtext} />
              <Text style={s.trendText}>{trendLabel}</Text>
            </View>

            <View style={s.headerNeonEdge} />
          </View>

          {loading && (
            <View style={s.loadingOverlay}>
              <ActivityIndicator />
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* PERIOD SELECTOR + GRAPH */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>Trend</Text>
                <View style={s.periodRow}>
                  {graphablePeriods.map((option) => {
                    const active = activePeriod === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => setPeriod(option.key)}
                        activeOpacity={0.8}
                        style={[
                          s.periodChip,
                          active && s.periodChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            s.periodChipText,
                            active && s.periodChipTextActive,
                          ]}
                        >
                          {option.chipLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={s.graphCard}>
                {filteredWeights.length < 1 ? (
                  <Text style={s.emptyText}>
                    Not enough entries yet to show a trend. Log a few more
                    weights to see the graph.
                  </Text>
                ) : (
                  <WeightGraph
                    data={filteredWeights}
                    colors={colors}
                    accent={accent}
                    periodLabel={periodLabel}
                    periodKey={activePeriod}
                    onPointPress={setSelectedPoint}
                  />
                )}

                {/* Selected point details */}
                {selectedPoint && (
                  <View style={s.pointDetail}>
                    <Text style={s.pointDetailTitle}>
                      {selectedPoint.weight.toFixed(1)} kg
                    </Text>
                    <Text style={s.pointDetailText}>
                      {formatDate(selectedPoint.date)} at{" "}
                      {formatTime(selectedPoint.date)}
                    </Text>
                    {selectedPoint.note ? (
                      <Text style={s.pointDetailNote}>
                        {selectedPoint.note}
                      </Text>
                    ) : null}
                  </View>
                )}

                {!goalLoading && planFeedback && (
                  <View style={s.planRow}>
                    <Text style={s.planLabel}>Plan insight</Text>
                    <Text style={s.planText}>{planFeedback}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* HISTORY */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>History</Text>
                <Text style={s.sectionMeta}>
                  {weights.length} entries
                </Text>
              </View>

              {weights.length === 0 ? (
                <Text style={s.emptyText}>
                  No weight entries yet. Add your first entry to start
                  tracking.
                </Text>
              ) : (
                <View style={s.listCard}>
                  {weightsDesc.map((w, idx) => (
                    <View
                      key={w.id}
                      style={[
                        idx !== weightsDesc.length - 1 && s.listDivider,
                      ]}
                    >
                      {renderRow(w)}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={s.fabAdd}
            onPress={() => setShowAddEntrySheet(true)}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={17} color={onAccent} />
            <Text style={s.fabAddText}>Add entry</Text>
          </TouchableOpacity>

          <Modal
            visible={showAddEntrySheet}
            transparent
            animationType="slide"
            onRequestClose={() => setShowAddEntrySheet(false)}
          >
            <View style={s.sheetOverlay}>
              <TouchableOpacity
                style={s.sheetBackdrop}
                activeOpacity={1}
                onPress={() => {
                  if (!saving) setShowAddEntrySheet(false);
                }}
              />

              <KeyboardAvoidingView
                style={s.sheetKeyboard}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
              >
                <View style={s.sheetCard}>
                  <View style={s.sheetHandle} />
                  <View style={s.sheetHeader}>
                    <Text style={s.sheetTitle}>Add Entry</Text>
                    <TouchableOpacity
                      onPress={() => setShowAddEntrySheet(false)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={s.sheetClose}
                    >
                      <Feather name="x" size={16} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                  <Text style={s.sheetSubtitle}>
                    Log today’s weight quickly.
                  </Text>

                  <View style={s.addCard}>
                    <View style={s.addRow}>
                      <TouchableOpacity
                        style={s.adjustButton}
                        onPress={() => adjustDraftWeight(-0.1)}
                        activeOpacity={0.8}
                      >
                        <Feather name="minus" size={14} color={colors.text} />
                        <Text style={s.adjustButtonText}>0.1</Text>
                      </TouchableOpacity>

                      <View style={s.addLeft}>
                        <TextInput
                          style={s.weightInput}
                          placeholder="Weight"
                          placeholderTextColor={colors.subtext}
                          keyboardType="decimal-pad"
                          value={newWeight}
                          onChangeText={setNewWeight}
                        />
                        <Text style={s.weightUnit}>kg</Text>
                      </View>

                      <TouchableOpacity
                        style={s.adjustButton}
                        onPress={() => adjustDraftWeight(0.1)}
                        activeOpacity={0.8}
                      >
                        <Feather name="plus" size={14} color={colors.text} />
                        <Text style={s.adjustButtonText}>0.1</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          s.addButton,
                          {
                            backgroundColor: saving ? colors.subtext : accent,
                          },
                        ]}
                        onPress={async () => {
                          const saved = await handleAddWeight();
                          if (saved) setShowAddEntrySheet(false);
                        }}
                        disabled={saving || !newWeight.trim()}
                        activeOpacity={0.8}
                      >
                        {saving ? (
                          <ActivityIndicator color={onAccent} />
                        ) : (
                          <>
                            <Feather name="check" size={16} color={onAccent} />
                            <Text style={s.addButtonText}>Save</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={s.quickActionRow}>
                      <TouchableOpacity
                        style={s.ghostAction}
                        onPress={applyLatestWeight}
                        disabled={!latest}
                        activeOpacity={0.8}
                      >
                        <Feather
                          name="clock"
                          size={14}
                          color={colors.subtext}
                        />
                        <Text style={s.ghostActionText}>
                          {latest
                            ? `Use latest (${formatKg(latest.weight)})`
                            : "No latest yet"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TextInput
                      style={s.noteInput}
                      placeholder="Note (optional, e.g. morning fasted, post-training…)"
                      placeholderTextColor={colors.subtext}
                      value={newNote}
                      onChangeText={setNewNote}
                      multiline
                    />
                  </View>

                  <Text style={s.addHint}>
                    Tap the bin icon to delete. Long-press an entry also works.
                  </Text>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

/* ---------------- GRAPH COMPONENT ---------------- */

function formatXAxisTick(date, periodKey) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";

  if (periodKey === "1W") {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
    });
  }

  if (periodKey === "ALL") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
    });
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function compressAxisTicks(ticks, minGapPx, maxCount) {
  if (!Array.isArray(ticks) || ticks.length <= 2) return ticks || [];

  const sorted = [...ticks]
    .filter((tick) => Number.isFinite(tick?.x) && typeof tick?.label === "string")
    .sort((a, b) => a.x - b.x);
  if (sorted.length <= 2) return sorted;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const middle = sorted.slice(1, -1);

  const out = [first];
  middle.forEach((tick) => {
    const prev = out[out.length - 1];
    if (tick.x - prev.x >= minGapPx && last.x - tick.x >= minGapPx * 0.7) {
      out.push(tick);
    }
  });

  if (last.x - out[out.length - 1].x < minGapPx * 0.7) {
    out[out.length - 1] = last;
  } else {
    out.push(last);
  }

  if (out.length <= maxCount) return out;

  const sampled = [out[0]];
  const inner = out.slice(1, -1);
  const innerWanted = Math.max(0, maxCount - 2);

  if (innerWanted === 1) {
    sampled.push(inner[Math.floor(inner.length / 2)]);
  } else if (innerWanted > 1) {
    for (let i = 0; i < innerWanted; i += 1) {
      const idx = Math.round((i * (inner.length - 1)) / (innerWanted - 1));
      sampled.push(inner[idx]);
    }
  }

  sampled.push(out[out.length - 1]);
  return sampled;
}

function WeightGraph({
  data,
  colors,
  accent,
  periodLabel,
  periodKey,
  onPointPress,
}) {
  const width = SCREEN_WIDTH - 36; // page padding matches main layout
  const height = GRAPH_HEIGHT;

  const pointsData = useMemo(() => {
    if (!data || data.length < 1) return null;

    const sorted = [...data].sort((a, b) => {
      const da = coerceDate(a.date || a.createdAt) || new Date(0);
      const db = coerceDate(b.date || b.createdAt) || new Date(0);
      return da - db;
    });

    const dates = sorted.map((row) => {
      return coerceDate(row?.date || row?.createdAt);
    });
    if (dates.some((d) => !(d instanceof Date) || isNaN(d.getTime()))) {
      return null;
    }

    const timestamps = dates.map((d) => d.getTime());
    const minDataMs = Math.min(...timestamps);
    const maxDataMs = Math.max(...timestamps);

    const selectedPeriod = PERIOD_OPTIONS.find(
      (option) => option.key === periodKey
    );
    const periodDaysBack = selectedPeriod?.daysBack;

    const nowMs = Date.now();
    const maxMs = Number.isFinite(periodDaysBack)
      ? Math.max(nowMs, maxDataMs)
      : maxDataMs;
    const minMs = Number.isFinite(periodDaysBack)
      ? maxMs - periodDaysBack * 24 * 60 * 60 * 1000
      : minDataMs;
    const hasTimeSpan = maxMs > minMs;

    const values = sorted.map((d) => Number(d.weight || d.value || 0));
    let minV = Math.min(...values);
    let maxV = Math.max(...values);

    if (!isFinite(minV) || !isFinite(maxV)) return null;

    // Keep a wider Y-domain so the axis has more spread.
    const rawSpan = Math.max(0, maxV - minV);
    const center = (maxV + minV) / 2;
    const targetSpan =
      rawSpan === 0
        ? GRAPH_Y_MIN_SPAN_KG
        : Math.max(GRAPH_Y_MIN_SPAN_KG, rawSpan * GRAPH_Y_SPREAD_MULTIPLIER);
    minV = center - targetSpan / 2;
    maxV = center + targetSpan / 2;

    const span = maxV - minV || 1;
    const usableWidth = width - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT;
    const usableHeight = height - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM;

    const points = sorted.map((row, index) => {
      const v = values[index];
      const xRatio = hasTimeSpan
        ? (timestamps[index] - minMs) / (maxMs - minMs)
        : index / (sorted.length - 1 || 1);
      const x =
        GRAPH_PADDING_LEFT + xRatio * usableWidth;
      const y =
        GRAPH_PADDING_TOP +
        (1 - (v - minV) / span) * usableHeight;

      return {
        x,
        y,
        weight: v,
        date: row.date || row.createdAt,
        note: row.note,
        raw: {
          ...row,
          date: row.date || row.createdAt,
        },
      };
    });

    return {
      points,
      min: minV,
      max: maxV,
      span,
      minMs,
      maxMs,
      timestamps,
      usableWidth,
      usableHeight,
    };
  }, [data, width, height, periodKey]);

  const yTicks = useMemo(() => {
    if (!pointsData) return [];
    const { max, span, usableHeight } = pointsData;
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      value: max - span * ratio,
      y: GRAPH_PADDING_TOP + ratio * usableHeight,
    }));
  }, [pointsData]);

  const xTicks = useMemo(() => {
    if (!pointsData) return [];

    const { minMs, maxMs, usableWidth } = pointsData;
    if (!isFinite(minMs) || !isFinite(maxMs)) return [];

    if (periodKey === "ALL") {
      const startDate = new Date(minMs);
      const endDate = new Date(maxMs);
      const candidates = [
        { ts: minMs, label: formatXAxisTick(startDate, "ALL") },
      ];

      const cursor = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        1
      );

      while (cursor.getTime() < maxMs) {
        candidates.push({
          ts: cursor.getTime(),
          label: cursor.toLocaleDateString("en-GB", {
            month: "short",
            year: "2-digit",
          }),
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }

      candidates.push({
        ts: maxMs,
        label: formatXAxisTick(endDate, "ALL"),
      });

      const rawTicks = candidates.map((tick) => {
        const ratio = maxMs === minMs ? 0 : (tick.ts - minMs) / (maxMs - minMs);
        return {
          x: GRAPH_PADDING_LEFT + ratio * usableWidth,
          label: tick.label,
        };
      });

      return compressAxisTicks(rawTicks, 56, 5);
    }

    const countByPeriod = {
      "1W": 7,
      "1M": 5,
      "3M": 6,
      "6M": 6,
      ALL: 6,
    };
    const tickCount = Math.max(2, countByPeriod[periodKey] || 5);

    if (maxMs === minMs) {
      const onlyDate = new Date(minMs);
      return [
        {
          x: GRAPH_PADDING_LEFT,
          label: formatXAxisTick(onlyDate, periodKey),
        },
      ];
    }

    const ticks = Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      const tickMs = minMs + ratio * (maxMs - minMs);
      const tickDate = new Date(tickMs);
      return {
        x: GRAPH_PADDING_LEFT + ratio * usableWidth,
        label: formatXAxisTick(tickDate, periodKey),
      };
    });

    const deduped = ticks.filter(
      (tick, index, arr) =>
        index === 0 ||
        index === arr.length - 1 ||
        tick.label !== arr[index - 1].label
    );
    const gapByPeriod = {
      "1W": 34,
      "1M": 46,
      "3M": 50,
      "6M": 52,
      ALL: 56,
    };
    return compressAxisTicks(deduped, gapByPeriod[periodKey] || 46, 6);
  }, [pointsData, periodKey]);

  if (!pointsData) return null;

  const { points } = pointsData;
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // area path under line
  const areaPath = (() => {
    if (!points.length) return "";
    const first = points[0];
    const last = points[points.length - 1];
    const baseY = height - GRAPH_PADDING_BOTTOM;

    let d = `M ${first.x} ${baseY}`;
    points.forEach((p) => {
      d += ` L ${p.x} ${p.y}`;
    });
    d += ` L ${last.x} ${baseY} Z`;
    return d;
  })();

  return (
    <Svg width={width} height={height}>
      {/* Horizontal grid lines with richer Y scale */}
      {yTicks.map((row, idx) => (
        <GridRow
          key={idx}
          width={width}
          y={row.y}
          label={`${row.value.toFixed(1)} kg`}
          colors={colors}
        />
      ))}

      {/* Vertical guide lines for time ticks */}
      {xTicks.map((tick, idx) => (
        <Line
          key={`x-grid-${idx}`}
          x1={tick.x}
          x2={tick.x}
          y1={GRAPH_PADDING_TOP}
          y2={height - GRAPH_PADDING_BOTTOM}
          stroke={colors?.subtext || "#4B5563"}
          strokeWidth={1}
          opacity={0.12}
        />
      ))}

      {/* Filled area under line */}
      <Path d={areaPath} fill={accent} opacity={0.15} />

      {/* Line */}
      <Polyline
        points={polylinePoints}
        fill="none"
        stroke={accent}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots (tap-able) */}
      {points.map((p, i) => (
        <Circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === points.length - 1 ? 4 : 3}
          fill={i === points.length - 1 ? accent : "#FFFFFF"}
          stroke={accent}
          strokeWidth={1}
          onPress={() => onPointPress && onPointPress(p.raw)}
        />
      ))}

      {/* Top labels */}
      <TextSvg
        x={GRAPH_PADDING_LEFT}
        y={GRAPH_PADDING_TOP - 6}
        text="Weight (kg)"
        anchor="start"
        color={colors.subtext}
      />
      <TextSvg
        x={width - GRAPH_PADDING_RIGHT}
        y={GRAPH_PADDING_TOP - 6}
        text={periodLabel}
        anchor="end"
        color={colors.subtext}
      />

      {/* Date labels on X-axis */}
      {xTicks.map((tick, index) => (
        <TextSvg
          key={`x-label-${index}`}
          x={tick.x}
          y={height - 6}
          text={tick.label}
          anchor={
            index === 0
              ? "start"
              : index === xTicks.length - 1
              ? "end"
              : "middle"
          }
          color={colors.subtext}
        />
      ))}
    </Svg>
  );
}

function GridRow({ width, y, label, colors }) {
  return (
    <>
      <Line
        x1={GRAPH_PADDING_LEFT}
        x2={width - GRAPH_PADDING_RIGHT}
        y1={y}
        y2={y}
        stroke={colors?.subtext || "#4B5563"}
        strokeWidth={1}
        strokeDasharray="4 4"
        opacity={0.35}
      />
      <TextSvg
        x={GRAPH_PADDING_LEFT - 10}
        y={y + 3}
        text={label}
        anchor="end"
        color={colors?.subtext}
      />
    </>
  );
}

function TextSvg({ x, y, text, anchor = "start", color = "#9CA3AF" }) {
  return (
    <SvgText
      x={x}
      y={y}
      fill={color}
      fontSize={10}
      textAnchor={anchor}
    >
      {text}
    </SvgText>
  );
}

/* ---------------- STYLES ---------------- */

function makeStyles(colors, isDark, accent, onAccent) {
  const cardBase = colors.card || (isDark ? "#101219" : "#F3F4F6");
  const cardBg = withHexAlpha(cardBase, isDark ? "D4" : "F4");
  const panelBg = withHexAlpha(cardBase, isDark ? "CC" : "F2");
  const panelBgSoft = withHexAlpha(cardBase, isDark ? "B8" : "EA");
  const borderSoft =
    colors.border || (isDark ? "rgba(255,255,255,0.10)" : "#E1E3E8");
  const borderHard = borderSoft;

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg || (isDark ? "#050506" : "#F5F5F7"),
    },
    page: {
      flex: 1,
      paddingHorizontal: 16,
    },
    scrollContent: {
      paddingBottom: 120,
    },

    loadingOverlay: {
      position: "absolute",
      top: 12,
      right: 18,
      zIndex: 10,
    },

    /* HEADER */
    headerCard: {
      marginTop: 6,
      marginBottom: 18,
      borderRadius: 22,
      borderWidth: 0,
      borderColor: "transparent",
      backgroundColor: "transparent",
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 12,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    backButton: {
      marginRight: 10,
      marginTop: 2,
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderHard,
    },
    headerEyebrow: {
      fontSize: 11,
      fontWeight: "800",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 4,
    },
    headerTitle: {
      fontSize: 26,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 1,
      letterSpacing: 0.1,
    },
    headerSubtitle: {
      color: colors.subtext,
      fontSize: 14,
      fontWeight: "600",
    },
    headerMetaRow: {
      marginTop: 9,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    headerMetaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
    },
    headerMetaText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.1,
    },
    kpiGrid: {
      marginTop: 10,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    kpiCard: {
      width: "48%",
      borderRadius: 14,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    kpiLabel: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 3,
    },
    kpiValue: {
      fontSize: 15,
      color: colors.text,
      fontWeight: "800",
    },
    headerNeonEdge: {
      marginTop: 10,
      height: 2,
      borderRadius: 999,
      backgroundColor: withHexAlpha(accent, isDark ? "B0" : "90"),
    },

    /* SECTIONS */
    section: {
      marginBottom: 26,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
      marginBottom: 8,
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    sectionMeta: {
      fontSize: 12,
      color: colors.subtext,
    },

    trendRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 8,
    },
    trendText: {
      fontSize: 13,
      color: colors.subtext,
      flex: 1,
    },

    /* PERIOD + GRAPH */
    periodRow: {
      flexDirection: "row",
      gap: 8,
    },
    periodChip: {
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
    },
    periodChipActive: {
      backgroundColor: accent,
      borderColor: accent,
    },
    periodChipText: {
      fontSize: 12,
      color: colors.subtext,
      fontWeight: "700",
    },
    periodChipTextActive: {
      color: onAccent,
      fontWeight: "800",
    },

    graphCard: {
      paddingVertical: 8,
      paddingHorizontal: 0,
      backgroundColor: "transparent",
      borderWidth: 0,
      marginTop: 6,
    },

    planRow: {
      marginTop: 10,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: panelBgSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    planLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    planText: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 18,
    },

    pointDetail: {
      marginTop: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: panelBgSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    pointDetailTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 2,
    },
    pointDetailText: {
      fontSize: 13,
      color: colors.subtext,
    },
    pointDetailNote: {
      marginTop: 2,
      fontSize: 12,
      color: colors.subtext,
    },

    /* ADD ENTRY */
    addCard: {
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: cardBg,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    adjustButton: {
      height: 38,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      paddingHorizontal: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    adjustButtonText: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "700",
    },
    addLeft: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: panelBg,
    },
    weightInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 0,
    },
    weightUnit: {
      fontSize: 14,
      color: colors.subtext,
      marginLeft: 4,
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      gap: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withHexAlpha(accent, isDark ? "66" : "8A"),
    },
    addButtonText: {
      color: onAccent,
      fontWeight: "700",
      fontSize: 14,
    },
    quickActionRow: {
      marginBottom: 8,
    },
    ghostAction: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
    },
    ghostActionText: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
    },
    noteInput: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 40,
      color: colors.text,
      fontSize: 14,
      backgroundColor: panelBg,
      marginBottom: 4,
    },
    addHint: {
      fontSize: 11,
      color: colors.subtext,
    },

    fabAdd: {
      position: "absolute",
      right: 18,
      bottom: 18,
      height: 46,
      borderRadius: 999,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: accent,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withHexAlpha(accent, isDark ? "8A" : "AA"),
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    fabAddText: {
      color: onAccent,
      fontSize: 13,
      fontWeight: "800",
      letterSpacing: 0.2,
    },

    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheetKeyboard: {
      width: "100%",
    },
    sheetCard: {
      width: "100%",
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      backgroundColor: colors.bg || (isDark ? "#050506" : "#F5F5F7"),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 16,
    },
    sheetHandle: {
      alignSelf: "center",
      width: 42,
      height: 4,
      borderRadius: 999,
      backgroundColor: withHexAlpha(colors.subtext || "#9CA3AF", "55"),
      marginBottom: 10,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 2,
    },
    sheetTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
    },
    sheetSubtitle: {
      fontSize: 13,
      color: colors.subtext,
      marginBottom: 10,
    },
    sheetClose: {
      width: 30,
      height: 30,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
    },

    /* LIST */
    listCard: {
      borderRadius: 20,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    listDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderSoft,
    },
    entryRow: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    deleteMini: {
      width: 30,
      height: 30,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      alignItems: "center",
      justifyContent: "center",
    },
    entryWeight: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    entryDate: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },
    entryNote: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },

    emptyText: {
      fontSize: 13,
      color: colors.subtext,
      marginTop: 6,
    },
  });
}
