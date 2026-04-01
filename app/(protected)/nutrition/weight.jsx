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
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
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

  const s = makeStyles(colors, isDark, accent, onAccent);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // subscribe to weight entries
  useEffect(() => {
    if (!user) return;

    const ref = collection(db, "users", user.uid, "weights");
    const q = query(ref, orderBy("date", "desc"));

    const unsub = onSnapshot(
      q,
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

  const latest = weights[0] || null;

  const normaliseDate = (tsOrDate) => {
    if (!tsOrDate) return null;
    if (tsOrDate?.toDate) return tsOrDate.toDate();
    if (tsOrDate instanceof Date) return tsOrDate;
    const d = new Date(tsOrDate);
    return isNaN(d.getTime()) ? null : d;
  };

  const weightsAsc = useMemo(() => {
    return [...weights].sort((a, b) => {
      const da = normaliseDate(a.date) || new Date(0);
      const db = normaliseDate(b.date) || new Date(0);
      return da - db;
    });
  }, [weights]);

  // filter by selected period
  const filteredWeights = useMemo(() => {
    if (!weightsAsc.length) return [];

    if (period === "ALL") return weightsAsc;

    const now = new Date();
    let daysBack = 30;
    if (period === "1W") daysBack = 7;
    else if (period === "1M") daysBack = 30;
    else if (period === "3M") daysBack = 90;

    const cutoff = new Date();
    cutoff.setDate(now.getDate() - daysBack);

    return weightsAsc.filter((w) => {
      const d = normaliseDate(w.date);
      return d && d >= cutoff;
    });
  }, [weightsAsc, period]);

  // clear selected point when period changes / data changes
  useEffect(() => {
    setSelectedPoint(null);
  }, [period, weightsAsc.length]);

  const trend = useMemo(() => {
    if (filteredWeights.length < 2) return null;

    const first = filteredWeights[0];
    const last = filteredWeights[filteredWeights.length - 1];
    const start = Number(first.weight || first.value || 0);
    const end = Number(last.weight || last.value || 0);
    const diff = end - start;

    const startDate = normaliseDate(first.date);
    const endDate = normaliseDate(last.date);
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
  }, [filteredWeights]);

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
    if (!trimmed) return;

    const value = Number(trimmed);
    if (!isFinite(value) || value <= 0) {
      Alert.alert("Check value", "Enter a valid weight in kg.");
      return;
    }

    if (!user) {
      Alert.alert("Not signed in", "Please log in again.");
      return;
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
    } catch (err) {
      Alert.alert(
        "Could not save",
        err?.message || "Please try again in a moment."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWeight = (item) => {
    if (!user) return;

    Alert.alert(
      "Delete entry?",
      `Remove ${item.weight} kg from ${formatDate(item.date)}?`,
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

  const headerSubtitle = useMemo(() => {
    if (!latest) return `Today • ${todayLabel}`;
    const d = normaliseDate(latest.date);
    const isToday =
      d && d.toDateString() === new Date().toDateString();
    if (isToday) return `Latest • Today ${todayLabel}`;
    return `Latest • ${formatDate(latest.date)} at ${formatTime(
      latest.date
    )}`;
  }, [latest, todayLabel]);

  // label like "Last 7 days" / "Last 30 days"
  const periodLabel = useMemo(() => {
    switch (period) {
      case "1W":
        return "Last 7 days";
      case "1M":
        return "Last 30 days";
      case "3M":
        return "Last 90 days";
      case "ALL":
      default:
        return "All time";
    }
  }, [period]);

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
          {formatDate(item.date)} · {formatTime(item.date)}
        </Text>
        {item.note ? (
          <Text style={s.entryNote} numberOfLines={1}>
            {item.note}
          </Text>
        ) : null}
      </View>

      <Feather name="trash-2" size={18} color={colors.subtext} />
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
          {/* HEADER */}
          <View style={s.header}>
            <View style={s.headerRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={s.backButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="chevron-left" size={24} color={colors.text} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
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
            {/* LATEST / SUMMARY */}
            <View style={s.section}>
              <View style={s.latestCard}>
                <Text style={s.latestLabel}>Current</Text>
                <Text style={s.latestValue}>
                  {latest ? `${latest.weight} kg` : "-- kg"}
                </Text>
                {latest && (
                  <Text style={s.latestDateText}>
                    Logged {formatDate(latest.date)} at{" "}
                    {formatTime(latest.date)}
                  </Text>
                )}

                <View style={s.trendRow}>
                  <Feather
                    name="trending-up"
                    size={16}
                    color={colors.subtext}
                  />
                  <Text style={s.trendText}>{trendLabel}</Text>
                </View>
              </View>
            </View>

            {/* PERIOD SELECTOR + GRAPH */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>Trend</Text>
                <View style={s.periodRow}>
                  {["1W", "1M", "3M", "ALL"].map((p) => {
                    const active = period === p;
                    return (
                      <TouchableOpacity
                        key={p}
                        onPress={() => setPeriod(p)}
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
                          {p === "ALL" ? "All" : p}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={s.graphCard}>
                {filteredWeights.length < 2 ? (
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

            {/* ADD NEW ENTRY */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Add entry</Text>

              <View style={s.addRow}>
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
                  style={[
                    s.addButton,
                    {
                      backgroundColor: saving ? colors.subtext : accent,
                    },
                  ]}
                  onPress={handleAddWeight}
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

              <TextInput
                style={s.noteInput}
                placeholder="Note (optional, e.g. morning fasted, post-training…)"
                placeholderTextColor={colors.subtext}
                value={newNote}
                onChangeText={setNewNote}
                multiline
              />
              <Text style={s.addHint}>
                Long-press an entry below to delete it.
              </Text>
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
                  {weights.map((w, idx) => (
                    <View
                      key={w.id}
                      style={[
                        idx !== weights.length - 1 && s.listDivider,
                      ]}
                    >
                      {renderRow(w)}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

/* ---------------- GRAPH COMPONENT ---------------- */

function WeightGraph({ data, colors, accent, periodLabel, onPointPress }) {
  const width = SCREEN_WIDTH - 36; // page padding matches main layout
  const height = GRAPH_HEIGHT;

  const pointsData = useMemo(() => {
    if (!data || data.length < 2) return null;

    const sorted = [...data].sort((a, b) => {
      const da = a.date?.toDate?.() || new Date(a.date);
      const db = b.date?.toDate?.() || new Date(b.date);
      return da - db;
    });

    const values = sorted.map((d) => Number(d.weight || d.value || 0));
    let minV = Math.min(...values);
    let maxV = Math.max(...values);

    if (!isFinite(minV) || !isFinite(maxV)) return null;

    // Give a bit of headroom so the line doesn't hug the edges
    if (minV === maxV) {
      minV -= 0.5;
      maxV += 0.5;
    } else {
      const pad = (maxV - minV) * 0.15;
      minV -= pad;
      maxV += pad;
    }

    const span = maxV - minV || 1;
    const usableWidth = width - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT;
    const usableHeight = height - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM;

    const points = sorted.map((row, index) => {
      const v = values[index];
      const x =
        GRAPH_PADDING_LEFT +
        (index / (sorted.length - 1 || 1)) * usableWidth;
      const y =
        GRAPH_PADDING_TOP +
        (1 - (v - minV) / span) * usableHeight;

      return {
        x,
        y,
        weight: v,
        date: row.date,
        note: row.note,
        raw: row,
      };
    });

    return {
      points,
      min: minV,
      max: maxV,
      mid: minV + span / 2,
    };
  }, [data, width, height]);

  if (!pointsData) return null;

  const { points, min, max, mid } = pointsData;
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  const firstLabel = formatLabel(points[0]?.date);
  const midLabel = formatLabel(
    points[Math.floor(points.length / 2)]?.date
  );
  const lastLabel = formatLabel(points[points.length - 1]?.date);

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
      {/* Horizontal grid lines at max / mid / min */}
      {[
        { value: max, labelY: GRAPH_PADDING_TOP + 8 },
        {
          value: mid,
          labelY:
            GRAPH_PADDING_TOP +
            (height - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM) / 2,
        },
        { value: min, labelY: height - GRAPH_PADDING_BOTTOM },
      ].map((row, idx) => (
        <GridRow
          key={idx}
          width={width}
          y={row.labelY}
          label={`${row.value.toFixed(1)} kg`}
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

      {/* Timeframe label above axis */}
      <TextSvg
        x={width / 2}
        y={height - GRAPH_PADDING_BOTTOM + 10}
        text={periodLabel}
        anchor="middle"
      />

      {/* Date labels on X-axis */}
      <TextSvg
        x={GRAPH_PADDING_LEFT}
        y={height - 6}
        text={firstLabel}
        anchor="start"
      />
      {midLabel && (
        <TextSvg
          x={width / 2}
          y={height - 6}
          text={midLabel}
          anchor="middle"
        />
      )}
      <TextSvg
        x={width - GRAPH_PADDING_RIGHT}
        y={height - 6}
        text={lastLabel}
        anchor="end"
      />
    </Svg>
  );
}

function GridRow({ width, y, label }) {
  return (
    <>
      <Line
        x1={GRAPH_PADDING_LEFT}
        x2={width - GRAPH_PADDING_RIGHT}
        y1={y}
        y2={y}
        stroke="#4B5563"
        strokeWidth={1}
        strokeDasharray="4 4"
        opacity={0.6}
      />
      <TextSvg
        x={GRAPH_PADDING_LEFT - 10}
        y={y + 3}
        text={label}
        anchor="end"
      />
    </>
  );
}

function TextSvg({ x, y, text, anchor = "start" }) {
  return (
    <SvgText
      x={x}
      y={y}
      fill="#9CA3AF"
      fontSize={10}
      textAnchor={anchor}
    >
      {text}
    </SvgText>
  );
}

function formatLabel(tsOrDate) {
  if (!tsOrDate) return "";
  const d =
    tsOrDate?.toDate?.() instanceof Function
      ? tsOrDate.toDate()
      : tsOrDate instanceof Date
      ? tsOrDate
      : new Date(tsOrDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/* ---------------- STYLES ---------------- */

function makeStyles(colors, isDark, accent, onAccent) {
  const cardBg = isDark ? "#12141A" : colors.sapSilverLight || colors.card;
  const panelBg = isDark ? "#0E1015" : "#FFFFFF";
  const borderSoft = isDark ? "rgba(255,255,255,0.11)" : colors.sapSilverMedium || colors.border;
  const borderHard = isDark ? "rgba(255,255,255,0.16)" : "#D7DBE3";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
    page: {
      flex: 1,
      paddingHorizontal: 18,
    },
    scrollContent: {
      paddingBottom: 40,
    },

    loadingOverlay: {
      position: "absolute",
      top: 12,
      right: 18,
      zIndex: 10,
    },

    /* HEADER */
    header: {
      marginTop: 6,
      marginBottom: 18,
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
    headerTitle: {
      fontSize: 31,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 2,
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
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    headerMetaText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.1,
    },

    /* SECTIONS */
    section: {
      marginBottom: 26,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 8,
      letterSpacing: 0.2,
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

    /* LATEST CARD */
    latestCard: {
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    latestLabel: {
      fontSize: 12,
      color: colors.subtext,
      letterSpacing: 0.2,
      fontWeight: "700",
      marginBottom: 4,
    },
    latestValue: {
      fontSize: 32,
      fontWeight: "800",
      color: colors.text,
    },
    latestDateText: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 4,
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
      borderRadius: 16,
      paddingVertical: 8,
      paddingHorizontal: 8,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      marginTop: 6,
    },

    planRow: {
      marginTop: 10,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: isDark ? "#101216" : "#ECEFF4",
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
      backgroundColor: isDark ? "#0B0C10" : "#ECEFF4",
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
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 8,
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
      borderColor: "rgba(0,0,0,0.12)",
    },
    addButtonText: {
      color: onAccent,
      fontWeight: "700",
      fontSize: 14,
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

    /* LIST */
    listCard: {
      borderRadius: 16,
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
