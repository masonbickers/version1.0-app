// app/(protected)/train/edit-plan.jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
;
// ------------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GOAL_DISTANCE_OPTIONS = [
  "5K",
  "10K",
  "Half marathon",
  "Marathon",
  "Ultra",
  "General fitness",
  "Return from injury",
];

const GOAL_PRIMARY_FOCUS = [
  "PB / time goal",
  "Finish comfortably",
  "Build base / aerobic",
  "Race-specific prep",
];

const DAYS_PER_WEEK_OPTIONS = [2, 3, 4, 5, 6, 7];

const APPLE_BLUE = "#E6FF3B";

const emptyWeek = (index = 0) => ({
  title: `Week ${index + 1}`,
  days: DAYS.map((d) => ({ day: d, sessions: [] })),
});

// ------------------------------------------------------------------
// THEME
// ------------------------------------------------------------------

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: colors.bg,
    card: colors.card,
    text: colors.text,
    subtext: colors.subtext,
    border: colors.border,
    muted: colors.muted || (isDark ? "#3A3A3C" : "#F2F2F7"),
    primaryBg: APPLE_BLUE,
    primaryText: "#FFFFFF",
  };
}

function Chip({ label, active, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.chip,
        style,
        active && styles.chipActive,
        active && { borderColor: APPLE_BLUE, backgroundColor: "rgba(230,255,59,0.20)" },
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          active && { color: "#0B1215", fontWeight: "700" },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Remove all undefined values deeply so Firestore is happy
function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefinedDeep(v))
      .filter((v) => v !== undefined);
  }

  if (value && typeof value === "object" && value.constructor === Object) {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = removeUndefinedDeep(v);
      if (cleaned !== undefined) result[k] = cleaned;
    }
    return result;
  }

  if (value === undefined) return undefined;
  return value;
}

// ------------------------------------------------------------------
// MAIN SCREEN
// ------------------------------------------------------------------

export default function EditPlanPage() {
  const theme = useScreenTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;

  // Accept either ?planId=... or ?id=...
  const planId = useMemo(() => {
    const raw = params?.planId ?? params?.id;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params?.planId, params?.id]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Plan-level fields
  const [name, setName] = useState("");
  const [goalDistance, setGoalDistance] = useState("10K");
  const [goalPrimaryFocus, setGoalPrimaryFocus] =
    useState("PB / time goal");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [targetEventName, setTargetEventName] = useState("");
  const [targetEventDate, setTargetEventDate] = useState(""); // YYYY-MM-DD
  const [targetTime, setTargetTime] = useState(""); // HH:MM:SS

  // Full weeks/days/sessions structure
  const [weeks, setWeeks] = useState([]);

  // Selection for editing a session
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedSessionIndex, setSelectedSessionIndex] = useState(-1);

  // ------------------------------------------------------------------
  // LOAD PLAN
  // ------------------------------------------------------------------

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || !planId) {
      setLoadError("Missing plan information.");
      setLoading(false);
      return;
    }

    const loadPlan = async () => {
      try {
        const ref = doc(db, "users", uid, "plans", planId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setLoadError("Plan not found.");
          setLoading(false);
          return;
        }

        const data = snap.data() || {};

        setName(data.name || "");
        setGoalDistance(data.goalDistance || "10K");
        setGoalPrimaryFocus(
          data.goalPrimaryFocus || "PB / time goal"
        );
        const sessions =
          typeof data.sessionsPerWeek === "number"
            ? data.sessionsPerWeek
            : typeof data.daysPerWeek === "number"
            ? data.daysPerWeek
            : 4;
        setDaysPerWeek(sessions);

        setTargetEventName(data.targetEventName || "");
        setTargetEventDate(data.targetEventDate || "");
        setTargetTime(data.targetTime || "");

        const incomingWeeks = Array.isArray(data.weeks)
          ? data.weeks
          : [];

        if (incomingWeeks.length) {
          setWeeks(incomingWeeks);
        } else {
          setWeeks([emptyWeek(0)]);
        }

        // initialise selection
        setSelectedWeekIndex(0);
        setSelectedDayIndex(0);
        setSelectedSessionIndex(
          incomingWeeks?.[0]?.days?.[0]?.sessions?.length ? 0 : -1
        );

        setLoading(false);
      } catch (e) {
        console.log("[edit-plan] load error", e);
        setLoadError("Could not load this plan.");
        setLoading(false);
      }
    };

    loadPlan();
  }, [user?.uid, planId]);

  const canSave = useMemo(
    () =>
      !!name.trim() &&
      !!goalDistance &&
      !!goalPrimaryFocus &&
      weeks.length > 0,
    [name, goalDistance, goalPrimaryFocus, weeks.length]
  );

  // ------------------------------------------------------------------
  // HELPERS TO EDIT WEEKS / DAYS / SESSIONS
  // ------------------------------------------------------------------

  const selectedWeek = weeks[selectedWeekIndex] || null;
  const selectedDay =
    selectedWeek?.days?.[selectedDayIndex] || null;
  const selectedSession =
    selectedDay?.sessions?.[selectedSessionIndex] || null;

  const updateWeeks = (updater) => {
    setWeeks((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return Array.isArray(next) && next.length ? next : [emptyWeek(0)];
    });
  };

  const addWeek = () => {
    updateWeeks((prev) => {
      const next = [...prev, emptyWeek(prev.length)];
      return next;
    });
    setSelectedWeekIndex(weeks.length);
    setSelectedDayIndex(0);
    setSelectedSessionIndex(-1);
  };

  const removeCurrentWeek = () => {
    if (weeks.length <= 1) {
      Alert.alert(
        "Can't remove",
        "You need at least one week in the plan."
      );
      return;
    }
    updateWeeks((prev) => {
      const next = prev.filter(
        (_w, idx) => idx !== selectedWeekIndex
      );
      return next;
    });
    setSelectedWeekIndex((prev) => Math.max(prev - 1, 0));
    setSelectedDayIndex(0);
    setSelectedSessionIndex(-1);
  };

  const addSessionToDay = (weekIndex, dayIndex) => {
    updateWeeks((prev) => {
      const next = [...prev];
      const w = { ...(next[weekIndex] || emptyWeek(weekIndex)) };
      const days = Array.isArray(w.days)
        ? [...w.days]
        : DAYS.map((d) => ({ day: d, sessions: [] }));
      const day = { ...(days[dayIndex] || { day: DAYS[dayIndex], sessions: [] }) };
      const sessions = Array.isArray(day.sessions)
        ? [...day.sessions]
        : [];

      sessions.push({
        title: "Easy run",
        type: "Run",
        targetDurationMin: 30,
        targetDistanceKm: undefined,
        notes: "",
      });

      day.sessions = sessions;
      days[dayIndex] = day;
      w.days = days;
      next[weekIndex] = w;
      return next;
    });

    setSelectedWeekIndex(weekIndex);
    setSelectedDayIndex(dayIndex);
    setSelectedSessionIndex(
      (selectedDay?.sessions?.length || 0) // previous length
    );
  };

  const removeSelectedSession = () => {
    if (!selectedWeek || !selectedDay || selectedSessionIndex < 0) return;

    updateWeeks((prev) => {
      const next = [...prev];
      const w = { ...next[selectedWeekIndex] };
      const days = [...(w.days || [])];
      const day = { ...(days[selectedDayIndex] || {}) };
      const sessions = Array.isArray(day.sessions)
        ? [...day.sessions]
        : [];

      sessions.splice(selectedSessionIndex, 1);
      day.sessions = sessions;
      days[selectedDayIndex] = day;
      w.days = days;
      next[selectedWeekIndex] = w;
      return next;
    });

    setSelectedSessionIndex((prev) => Math.max(prev - 1, -1));
  };

  const updateSelectedSessionField = (field, value) => {
    if (!selectedWeek || !selectedDay || selectedSessionIndex < 0) return;

    updateWeeks((prev) => {
      const next = [...prev];
      const w = { ...next[selectedWeekIndex] };
      const days = [...(w.days || [])];
      const day = { ...(days[selectedDayIndex] || {}) };
      const sessions = Array.isArray(day.sessions)
        ? [...day.sessions]
        : [];

      const sess = { ...(sessions[selectedSessionIndex] || {}) };

      if (field === "targetDurationMin" || field === "targetDistanceKm") {
        const cleaned = String(value).replace(",", ".");
        const num =
          cleaned.trim() === "" ? undefined : Number(cleaned);
        sess[field] = Number.isFinite(num) ? num : undefined;
      } else {
        sess[field] = value;
      }

      sessions[selectedSessionIndex] = sess;
      day.sessions = sessions;
      days[selectedDayIndex] = day;
      w.days = days;
      next[selectedWeekIndex] = w;
      return next;
    });
  };

  // ------------------------------------------------------------------
  // SAVE
  // ------------------------------------------------------------------

  const handleSave = async () => {
    if (!canSave) {
      Alert.alert(
        "More info needed",
        "Please make sure the plan has a name, goal distance, focus and at least one week."
      );
      return;
    }

    const uid = user?.uid;
    if (!uid || !planId) {
      Alert.alert(
        "Not signed in",
        "You need to be logged in to edit a plan."
      );
      return;
    }

    setSaving(true);
    try {
      const ref = doc(db, "users", uid, "plans", planId);

      const updates = removeUndefinedDeep({
        name: name.trim(),
        goalDistance,
        goalPrimaryFocus,
        sessionsPerWeek: daysPerWeek,
        daysPerWeek,
        targetEventName: targetEventName || "",
        targetEventDate: targetEventDate || "",
        targetTime: targetTime || "",
        weeks,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(ref, updates);

      Alert.alert("Saved", "Your plan has been updated.");
      router.back();
    } catch (e) {
      console.log("[edit-plan] save error", e);
      Alert.alert(
        "Error",
        e?.message || "Something went wrong while saving your plan."
      );
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            gap: 8,
          }}
        >
          <ActivityIndicator size="small" />
          <Text style={{ color: theme.subtext, fontSize: 13 }}>
            Loading plan…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 24,
            gap: 12,
          }}
        >
          <Text
            style={{
              color: "#EF4444",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            {loadError}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[
              styles.secondaryBtn,
              { borderColor: theme.border, paddingHorizontal: 20 },
            ]}
          >
            <Text style={{ color: theme.text, fontWeight: "700" }}>
              Go back
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 140,
            gap: 18,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[
                styles.pillBtn,
                { borderColor: theme.border, paddingHorizontal: 10 },
              ]}
              activeOpacity={0.85}
            >
              <Feather name="chevron-left" size={18} color={theme.text} />
              <Text
                style={{
                  color: theme.text,
                  fontWeight: "700",
                }}
              >
                Back
              </Text>
            </TouchableOpacity>

            <View style={{ alignItems: "center" }}>
              <Text style={[styles.hTitle, { color: theme.text }]}>
                Edit plan
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  marginTop: 2,
                }}
              >
                Adjust details & sessions
              </Text>
            </View>

            <View style={{ width: 70 }} />
          </View>

          {/* PLAN-LEVEL CARD */}
          <View
            style={[
              styles.card,
              { borderColor: theme.border, backgroundColor: theme.card },
            ]}
          >
            {/* Plan name */}
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: theme.subtext }]}>
                Plan name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g. London Half build-up"
                placeholderTextColor={theme.subtext}
                value={name}
                onChangeText={setName}
              />
            </View>

            {/* Goal distance */}
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={[styles.label, { color: theme.subtext }]}>
                Goal distance
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {GOAL_DISTANCE_OPTIONS.map((opt) => (
                  <Chip
                    key={opt}
                    label={opt}
                    active={goalDistance === opt}
                    onPress={() => setGoalDistance(opt)}
                  />
                ))}
              </View>
            </View>

            {/* Primary focus */}
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={[styles.label, { color: theme.subtext }]}>
                Primary focus
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {GOAL_PRIMARY_FOCUS.map((opt) => (
                  <Chip
                    key={opt}
                    label={opt}
                    active={goalPrimaryFocus === opt}
                    onPress={() => setGoalPrimaryFocus(opt)}
                  />
                ))}
              </View>
            </View>

            {/* Sessions per week */}
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={[styles.label, { color: theme.subtext }]}>
                Runs per week
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {DAYS_PER_WEEK_OPTIONS.map((n) => (
                  <Chip
                    key={n}
                    label={`${n}x`}
                    active={daysPerWeek === n}
                    onPress={() => setDaysPerWeek(n)}
                  />
                ))}
              </View>
            </View>

            {/* Race info */}
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={[styles.label, { color: theme.subtext }]}>
                Target race (optional)
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.bg,
                    color: theme.text,
                  },
                ]}
                placeholder="e.g. Valencia Half"
                placeholderTextColor={theme.subtext}
                value={targetEventName}
                onChangeText={setTargetEventName}
              />
            </View>

            <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.miniLabel, { color: theme.subtext }]}>
                  Race date (YYYY-MM-DD)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.bg,
                      color: theme.text,
                    },
                  ]}
                  placeholder="e.g. 2026-03-15"
                  placeholderTextColor={theme.subtext}
                  value={targetEventDate}
                  onChangeText={setTargetEventDate}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.miniLabel, { color: theme.subtext }]}>
                  Target time (HH:MM:SS)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.bg,
                      color: theme.text,
                    },
                  ]}
                  placeholder="e.g. 01:25:00"
                  placeholderTextColor={theme.subtext}
                  value={targetTime}
                  onChangeText={setTargetTime}
                  autoCapitalize="none"
                />
              </View>
            </View>
          </View>

          {/* STRUCTURE CARD: WEEKS / DAYS / SESSIONS */}
          <View
            style={[
              styles.card,
              { borderColor: theme.border, backgroundColor: theme.card },
            ]}
          >
            <Text style={[styles.label, { color: theme.subtext }]}>
              Plan structure
            </Text>

            {/* Week selector row */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
                alignItems: "center",
              }}
            >
              {weeks.map((w, idx) => (
                <Chip
                  key={idx}
                  label={w.title || `Week ${idx + 1}`}
                  active={selectedWeekIndex === idx}
                  onPress={() => {
                    setSelectedWeekIndex(idx);
                    setSelectedDayIndex(0);
                    setSelectedSessionIndex(-1);
                  }}
                />
              ))}

              <TouchableOpacity
                onPress={addWeek}
                activeOpacity={0.85}
                style={[
                  styles.pillBtn,
                  { borderColor: theme.border, paddingHorizontal: 10 },
                ]}
              >
                <Feather name="plus" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontSize: 12 }}>
                  Add week
                </Text>
              </TouchableOpacity>
            </View>

            {weeks.length > 1 && (
              <TouchableOpacity
                onPress={removeCurrentWeek}
                activeOpacity={0.85}
                style={{ marginTop: 6 }}
              >
                <Text
                  style={{
                    color: "#EF4444",
                    fontSize: 12,
                    textDecorationLine: "underline",
                  }}
                >
                  Remove this week
                </Text>
              </TouchableOpacity>
            )}

            {/* Days + sessions for selected week */}
            <View style={{ marginTop: 10, gap: 10 }}>
              {(selectedWeek?.days || []).map((day, dayIdx) => {
                const sessions = Array.isArray(day.sessions)
                  ? day.sessions
                  : [];
                const isSelectedDay =
                  selectedDayIndex === dayIdx;

                return (
                  <View
                    key={`${day.day}_${dayIdx}`}
                    style={[
                      styles.dayRow,
                      { borderColor: theme.border },
                    ]}
                  >
                    <View style={styles.dayHeaderRow}>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedDayIndex(dayIdx);
                          setSelectedSessionIndex(
                            sessions.length ? 0 : -1
                          );
                        }}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={{
                            fontWeight: "800",
                            color: isSelectedDay
                              ? APPLE_BLUE
                              : theme.text,
                          }}
                        >
                          {day.day}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() =>
                          addSessionToDay(selectedWeekIndex, dayIdx)
                        }
                        activeOpacity={0.85}
                        style={styles.addSessionBtn}
                      >
                        <Feather
                          name="plus"
                          size={12}
                          color={APPLE_BLUE}
                        />
                        <Text
                          style={{
                            color: APPLE_BLUE,
                            fontSize: 11,
                            fontWeight: "700",
                          }}
                        >
                          Add session
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ marginTop: 4 }}>
                      {sessions.length === 0 ? (
                        <Text
                          style={{
                            color: theme.subtext,
                            fontSize: 12,
                          }}
                        >
                          Rest / no structured session
                        </Text>
                      ) : (
                        sessions.map((sess, sessIdx) => {
                          const isSelectedSession =
                            selectedDayIndex === dayIdx &&
                            selectedSessionIndex === sessIdx;

                          const duration =
                            sess.targetDurationMin ??
                            sess.durationMin ??
                            (sess.workout?.totalDurationSec
                              ? Math.round(
                                  sess.workout.totalDurationSec /
                                    60
                                )
                              : null);
                          const distance =
                            sess.targetDistanceKm ??
                            sess.distanceKm ??
                            sess.workout?.totalDistanceKm;

                          const metaParts = [];
                          if (duration)
                            metaParts.push(`${duration} min`);
                          if (distance)
                            metaParts.push(
                              `${Number(distance).toFixed(1)} km`
                            );
                          const meta = metaParts.join(" · ");

                          return (
                            <TouchableOpacity
                              key={sessIdx}
                              onPress={() => {
                                setSelectedWeekIndex(
                                  selectedWeekIndex
                                );
                                setSelectedDayIndex(dayIdx);
                                setSelectedSessionIndex(sessIdx);
                              }}
                              activeOpacity={0.85}
                              style={[
                                styles.sessionChip,
                                isSelectedSession && {
                                  borderColor: APPLE_BLUE,
                                  backgroundColor: "rgba(230,255,59,0.20)",
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  fontWeight: "600",
                                  color: theme.text,
                                }}
                              >
                                {sess.title || sess.type || "Session"}
                              </Text>
                              {meta ? (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: theme.subtext,
                                    marginRight: 4,
                                  }}
                                >
                                  {meta}
                                </Text>
                              ) : null}
                              <Feather
                                name="chevron-right"
                                size={14}
                                color={theme.subtext}
                              />
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* SESSION EDITOR */}
          <View
            style={[
              styles.card,
              { borderColor: theme.border, backgroundColor: theme.card },
            ]}
          >
            <Text style={[styles.label, { color: theme.subtext }]}>
              Edit session
            </Text>

            {!selectedSession ? (
              <Text
                style={{
                  color: theme.subtext,
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                Select a session from the list above to edit its details.
              </Text>
            ) : (
              <>
                <Text
                  style={{
                    color: theme.subtext,
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  Week {selectedWeekIndex + 1} ·{" "}
                  {selectedDay?.day || ""} · Session{" "}
                  {selectedSessionIndex + 1}
                </Text>

                {/* Title */}
                <View style={{ marginTop: 10, gap: 6 }}>
                  <Text
                    style={[styles.miniLabel, { color: theme.subtext }]}
                  >
                    Title
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.bg,
                        color: theme.text,
                      },
                    ]}
                    placeholder="e.g. Easy run"
                    placeholderTextColor={theme.subtext}
                    value={selectedSession.title || ""}
                    onChangeText={(txt) =>
                      updateSelectedSessionField("title", txt)
                    }
                  />
                </View>

                {/* Type */}
                <View style={{ marginTop: 10, gap: 6 }}>
                  <Text
                    style={[styles.miniLabel, { color: theme.subtext }]}
                  >
                    Type
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.bg,
                        color: theme.text,
                      },
                    ]}
                    placeholder="e.g. Easy, Tempo, Intervals"
                    placeholderTextColor={theme.subtext}
                    value={selectedSession.type || "Run"}
                    onChangeText={(txt) =>
                      updateSelectedSessionField("type", txt)
                    }
                  />
                </View>

                {/* Duration + distance */}
                <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.miniLabel,
                        { color: theme.subtext },
                      ]}
                    >
                      Target duration (min)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          borderColor: theme.border,
                          backgroundColor: theme.bg,
                          color: theme.text,
                        },
                      ]}
                      placeholder="e.g. 45"
                      placeholderTextColor={theme.subtext}
                      keyboardType="numeric"
                      value={
                        selectedSession.targetDurationMin != null
                          ? String(selectedSession.targetDurationMin)
                          : ""
                      }
                      onChangeText={(txt) =>
                        updateSelectedSessionField(
                          "targetDurationMin",
                          txt
                        )
                      }
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.miniLabel,
                        { color: theme.subtext },
                      ]}
                    >
                      Target distance (km)
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          borderColor: theme.border,
                          backgroundColor: theme.bg,
                          color: theme.text,
                        },
                      ]}
                      placeholder="e.g. 10"
                      placeholderTextColor={theme.subtext}
                      keyboardType="numeric"
                      value={
                        selectedSession.targetDistanceKm != null
                          ? String(selectedSession.targetDistanceKm)
                          : ""
                      }
                      onChangeText={(txt) =>
                        updateSelectedSessionField(
                          "targetDistanceKm",
                          txt
                        )
                      }
                    />
                  </View>
                </View>

                {/* Notes */}
                <View style={{ marginTop: 10, gap: 6 }}>
                  <Text
                    style={[styles.miniLabel, { color: theme.subtext }]}
                  >
                    Notes
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.bg,
                        color: theme.text,
                        minHeight: 60,
                        textAlignVertical: "top",
                      },
                    ]}
                    placeholder="e.g. Keep in Z2, relaxed breathing, soft surface if possible."
                    placeholderTextColor={theme.subtext}
                    value={selectedSession.notes || ""}
                    onChangeText={(txt) =>
                      updateSelectedSessionField("notes", txt)
                    }
                    multiline
                  />
                </View>

                {/* Remove session */}
                <View style={{ marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={removeSelectedSession}
                    activeOpacity={0.85}
                    style={styles.deleteSessionBtn}
                  >
                    <Feather
                      name="trash-2"
                      size={14}
                      color="#FF3B30"
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      style={{
                        color: "#FF3B30",
                        fontSize: 12,
                        fontWeight: "700",
                      }}
                    >
                      Delete this session
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* SAVE BUTTON */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !canSave}
            activeOpacity={0.9}
            style={[
              styles.primaryBtn,
              {
                backgroundColor:
                  saving || !canSave ? theme.muted : theme.primaryBg,
              },
            ]}
          >
            <Feather
              name="save"
              size={18}
              color={
                saving || !canSave ? "#6B7280" : theme.primaryText
              }
            />
            <Text
              style={{
                color:
                  saving || !canSave ? "#6B7280" : theme.primaryText,
                fontWeight: "800",
              }}
            >
              {saving ? "Saving…" : "Save plan changes"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------
// STYLES
// ------------------------------------------------------------------

const styles = StyleSheet.create({
  hTitle: { fontSize: 26, fontWeight: "800" },

  headerRow: {
    marginTop: 6,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },

  label: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  miniLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
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

  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 12,
    marginTop: 4,
  },

  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D1D5DB",
  },
  chipActive: {
    borderWidth: 1.2,
  },
  chipLabel: {
    fontSize: 12,
    color: "#4B5563",
  },

  dayRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  dayHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  addSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37,99,235,0.3)",
  },

  sessionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E5EA",
    marginTop: 6,
  },

  deleteSessionBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#FF3B30",
  },
});
