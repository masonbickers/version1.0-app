// app/(protected)/journal/setup.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* -------------------- CONFIG -------------------- */

// Core questions: always on, non-editable
const CORE_QUESTIONS = [
  { key: "mood", label: "Mood" },
  { key: "stress", label: "Stress" },
  { key: "energy", label: "Energy" },
  { key: "sleepHours", label: "Sleep hours" },
  { key: "sleepQuality", label: "Sleep quality" },
];

// Optional questions: user can toggle on/off
const OPTIONAL_QUESTIONS = [
  { key: "soreness", label: "Soreness" },
  { key: "painInjury", label: "Pain / injury" },
  { key: "alcohol", label: "Alcohol" },
  { key: "caffeineLate", label: "Caffeine late" },
  { key: "screensLate", label: "Screens late" },
  { key: "travel", label: "Travel" },
  { key: "illness", label: "Illness" },
  { key: "workStress", label: "Work stress" },
  { key: "lifeStress", label: "Life stress" },
];

// Simple reminder presets – can expand later
const REMINDER_PRESETS = [
  { key: "off", label: "No reminder", time: null },
  { key: "morning", label: "Morning (08:00)", time: "08:00" },
  { key: "evening", label: "Evening (21:00)", time: "21:00" },
];

// Default optional selection if no settings exist yet
const DEFAULT_OPTIONAL_STATE = {
  soreness: true,
  painInjury: true,
  alcohol: true,
  caffeineLate: true,
  screensLate: true,
  travel: true,
  illness: true,
  workStress: false,
  lifeStress: false,
};

export default function JournalSetupPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [optionalQuestions, setOptionalQuestions] = useState(
    DEFAULT_OPTIONAL_STATE
  );
  const [reminderPreset, setReminderPreset] = useState("evening");

  // -------------------- LOAD SETTINGS --------------------
  useEffect(() => {
    const loadSettings = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const js = data.journalSettings || {};

          if (typeof js.enabled === "boolean") setEnabled(js.enabled);

          if (js.optionalQuestions && typeof js.optionalQuestions === "object") {
            setOptionalQuestions((prev) => ({
              ...prev,
              ...js.optionalQuestions,
            }));
          }

          // Map existing time (if any) to preset; default to evening
          if (typeof js.reminderTime === "string") {
            const match = REMINDER_PRESETS.find(
              (p) => p.time === js.reminderTime
            );
            if (match) setReminderPreset(match.key);
          } else if (typeof js.reminderPreset === "string") {
            // fallback for future schema
            setReminderPreset(js.reminderPreset);
          }
        }
      } catch (err) {
        console.error("Error loading journal settings", err);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [user]);

  // -------------------- HANDLERS --------------------
  const toggleOptional = (key) => {
    setOptionalQuestions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleReset = () => {
    setEnabled(true);
    setOptionalQuestions(DEFAULT_OPTIONAL_STATE);
    setReminderPreset("evening");
  };

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Sign in again to save journal settings.");
      return;
    }

    try {
      setSaving(true);

      const presetObj =
        REMINDER_PRESETS.find((p) => p.key === reminderPreset) ||
        REMINDER_PRESETS[2]; // evening fallback

      const coreConfig = CORE_QUESTIONS.reduce((acc, q) => {
        acc[q.key] = true;
        return acc;
      }, {});

      const ref = doc(db, "users", user.uid);
      await setDoc(
        ref,
        {
          journalSettings: {
            enabled,
            coreQuestions: coreConfig,
            optionalQuestions,
            reminderPreset: presetObj.key,
            reminderTime: presetObj.time,
            updatedAt: new Date().toISOString(),
          },
        },
        { merge: true }
      );

      Alert.alert("Saved", "Journal setup updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error("Error saving journal settings", err);
      Alert.alert(
        "Error",
        "Couldn't save your journal settings. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const s = makeStyles(colors, isDark, accent);

  // -------------------- RENDER --------------------
  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        {/* HEADER */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.iconButtonGhost}
            activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Journal setup</Text>
          <View style={{ width: 32 }} />
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
            <Text style={s.loadingText}>Loading your journal setup…</Text>
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ENABLE TOGGLE */}
            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>Turn on journal insights</Text>
                  <Text style={s.cardBody}>
                    When enabled, we’ll use your daily check-ins to spot
                    patterns in mood, recovery and training focus.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setEnabled((v) => !v)}
                  activeOpacity={0.9}
                  style={[s.toggle, enabled ? s.toggleOn : s.toggleOff]}
                >
                  <View style={s.toggleThumb} />
                </TouchableOpacity>
              </View>
            </View>

            {/* CORE QUESTIONS */}
            <View style={s.card}>
              <Text style={s.sectionLabel}>Core questions</Text>
              <Text style={s.cardBody}>
                These are always included in your daily check-in.
              </Text>

              <View style={s.coreList}>
                {CORE_QUESTIONS.map((q) => (
                  <View key={q.key} style={s.coreRow}>
                    <View style={s.coreIcon}>
                      <Feather
                        name="check"
                        size={14}
                        color={colors.sapOnPrimary}
                      />
                    </View>
                    <Text style={s.coreLabel}>{q.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* OPTIONAL QUESTIONS */}
            <View style={s.card}>
              <Text style={s.sectionLabel}>Optional questions</Text>
              <Text style={s.cardBody}>
                Add extra context you care about. We’ll only ask the questions
                you enable here.
              </Text>

              <View style={s.chipRow}>
                {OPTIONAL_QUESTIONS.map((opt) => {
                  const isActive = !!optionalQuestions[opt.key];
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => toggleOptional(opt.key)}
                      activeOpacity={0.85}
                      style={[
                        s.chip,
                        isActive ? s.chipActive : s.chipInactive,
                      ]}
                    >
                      <Text
                        style={[
                          s.chipLabel,
                          isActive ? s.chipLabelActive : s.chipLabelInactive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* REMINDER TIME */}
            <View style={s.card}>
              <Text style={s.sectionLabel}>Daily reminder</Text>
              <Text style={s.cardBody}>
                Choose when we should nudge you to complete your check-in.
              </Text>

              <View style={s.chipRow}>
                {REMINDER_PRESETS.map((preset) => {
                  const active = reminderPreset === preset.key;
                  return (
                    <TouchableOpacity
                      key={preset.key}
                      onPress={() => setReminderPreset(preset.key)}
                      activeOpacity={0.85}
                      style={[
                        s.chipSmall,
                        active ? s.chipActive : s.chipInactive,
                      ]}
                    >
                      <Text
                        style={[
                          s.chipLabel,
                          active ? s.chipLabelActive : s.chipLabelInactive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* HOW IT WORKS / INFO */}
            <View style={s.cardMuted}>
              <View style={s.cardMutedHeader}>
                <Feather
                  name="info"
                  size={14}
                  color={colors.subtext || "#6B7280"}
                />
                <Text style={s.cardMutedTitle}>How this works</Text>
              </View>
              <Text style={s.cardMutedBody}>
                Your answers power the insights on your You page and in the
                journal Insights tab. The more consistent your check-ins, the
                smarter the suggestions become.
              </Text>
              <Text style={s.cardMutedSub}>
                You can change these settings any time. Nothing is shared
                publicly.
              </Text>
            </View>

            {/* BUTTONS */}
            <View style={s.buttonRow}>
              <TouchableOpacity
                style={s.secondaryBtn}
                activeOpacity={0.9}
                onPress={handleReset}
                disabled={saving}
              >
                <Text style={s.secondaryBtnText}>Reset</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.primaryBtn}
                activeOpacity={0.9}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.sapOnPrimary || "#000"}
                  />
                ) : (
                  <>
                    <Feather
                      name="check"
                      size={16}
                      color={colors.sapOnPrimary}
                    />
                    <Text style={s.primaryBtnText}>Save</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

/* -------------------- STYLES -------------------- */

function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg || "#050505",
    },
    page: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 8,
    },
    iconButtonGhost: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    loadingText: {
      marginTop: 8,
      fontSize: 13,
      color: colors.subtext,
      textAlign: "center",
    },

    scroll: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 18,
      paddingBottom: 80, // clear footer
    },

    card: {
      backgroundColor: colors.sapSilverLight || colors.card,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      marginBottom: 14,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 4,
    },
    cardBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 16,
    },

    // toggle
    toggle: {
      width: 46,
      height: 26,
      borderRadius: 999,
      padding: 3,
      flexDirection: "row",
      alignItems: "center",
    },
    toggleOn: {
      backgroundColor: accent,
      justifyContent: "flex-end",
    },
    toggleOff: {
      backgroundColor: isDark ? "#111217" : "#E5E7EB",
      justifyContent: "flex-start",
    },
    toggleThumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "#fff",
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      ...Platform.select({
        android: { elevation: 1 },
      }),
    },

    /* CORE QUESTIONS LIST */
    coreList: {
      marginTop: 10,
      gap: 6,
    },
    coreRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    coreIcon: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
    },
    coreLabel: {
      fontSize: 13,
      color: colors.text,
      fontWeight: "600",
    },

    // chips
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
    },
    chipSmall: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
    },
    chipActive: {
      backgroundColor: accent,
      borderColor: accent,
    },
    chipInactive: {
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderColor: colors.sapSilverMedium || colors.border,
    },
    chipLabel: {
      fontSize: 12,
      fontWeight: "700",
    },
    chipLabelActive: {
      color: colors.sapOnPrimary,
    },
    chipLabelInactive: {
      color: colors.subtext,
    },

    // muted info card
    cardMuted: {
      backgroundColor: isDark ? "#111217" : "#F9FAFB",
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      marginBottom: 18,
    },
    cardMutedHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 4,
    },
    cardMutedTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    cardMutedBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },
    cardMutedSub: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 6,
    },

    // buttons
    buttonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    secondaryBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.sapSilverMedium || colors.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.subtext,
    },
    primaryBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      ...Platform.select({
        android: { elevation: 3 },
      }),
    },
    primaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.sapOnPrimary,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
  });
}
