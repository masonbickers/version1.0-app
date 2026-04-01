"use client";

/**
 * app/(protected)/training/schedule-workout/index.jsx
 * Schedule a workout template to a date (and optional time)
 *
 * Reads optional params:
 * - templateId (string)
 *
 * Firestore:
 * - users/{uid}/workoutTemplates/{templateId}
 * - users/{uid}/scheduledWorkouts/{scheduledId}
 *
 * Notes:
 * - Keeps it minimal and reliable.
 * - You can later wire scheduledWorkouts into your calendar / dashboard view.
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */
function safeStr(v) {
  return String(v ?? "").trim();
}
function yyyyMmDd(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function nowLocalYmd() {
  return yyyyMmDd(new Date());
}

export default function ScheduleWorkoutPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const templateIdParam = safeStr(params?.templateId);

  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templateIdParam);

  const [date, setDate] = useState(nowLocalYmd()); // YYYY-MM-DD
  const [time, setTime] = useState(""); // "HH:MM" optional
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // Load templates (simple)
  useEffect(() => {
    if (!user) return;

    (async () => {
      setLoading(true);
      try {
        const ref = collection(db, "users", user.uid, "workoutTemplates");
        const qRef = query(ref, orderBy("updatedAt", "desc"));
        const snap = await getDocs(qRef);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setTemplates(rows);

        // If templateId param is provided but not in selected (or no longer exists), clear
        if (templateIdParam && !rows.some((t) => t.id === templateIdParam)) {
          setSelectedTemplateId("");
        }
      } catch (e) {
        Alert.alert("Load failed", e?.message || "Could not load templates.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user, templateIdParam]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || null;
  }, [templates, selectedTemplateId]);

  const canSave = !!selectedTemplateId && !!date && !saving;

  const handleSave = async () => {
    if (!user) return;

    const templateId = safeStr(selectedTemplateId);
    if (!templateId) {
      Alert.alert("Pick a workout", "Select a workout template first.");
      return;
    }

    const ymd = safeStr(date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD (e.g. 2026-02-10).");
      return;
    }

    // Optional time validation
    const t = safeStr(time);
    if (t && !/^\d{2}:\d{2}$/.test(t)) {
      Alert.alert("Invalid time", "Use HH:MM (e.g. 07:30) or leave blank.");
      return;
    }

    setSaving(true);
    try {
      // Ensure template exists (guard)
      const templateRef = doc(db, "users", user.uid, "workoutTemplates", templateId);
      const templateSnap = await getDoc(templateRef);
      if (!templateSnap.exists()) {
        Alert.alert("Template missing", "That workout template no longer exists.");
        setSaving(false);
        return;
      }

      const template = templateSnap.data() || {};
      const scheduledRef = collection(db, "users", user.uid, "scheduledWorkouts");

      // Minimal scheduled doc
      await addDoc(scheduledRef, {
        templateId,
        templateName: template?.name || "Workout",
        type: template?.type || "",
        goal: template?.goal || "",
        date: ymd, // store as string for simplicity
        time: t || "", // optional
        notes: safeStr(notes),
        status: "scheduled",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Optional: mark template "last used"
      await updateDoc(templateRef, {
        lastUsedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      Alert.alert("Scheduled", "Workout scheduled successfully.");
      router.back();
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.iconBtn}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>Schedule</Text>
          <Text style={s.headerSub}>Add a workout to your calendar</Text>
        </View>

        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading workouts…</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {/* Pick template */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Workout</Text>
            <Text style={s.cardMuted}>
              {templates.length
                ? "Tap one to select."
                : "No workout templates yet. Create one first."}
            </Text>

            <View style={{ height: 10 }} />

            {templates.map((t) => {
              const active = t.id === selectedTemplateId;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setSelectedTemplateId(t.id)}
                  style={[s.templateRow, active && s.templateRowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.templateName} numberOfLines={1}>
                      {t.name || "Workout"}
                    </Text>
                    <Text style={s.templateSub} numberOfLines={1}>
                      {(t.type ? String(t.type) : "workout").toUpperCase()}
                      {t.goal ? ` • ${t.goal}` : ""}
                    </Text>
                  </View>

                  {active ? (
                    <Feather name="check-circle" size={18} color={s._accentText.color} />
                  ) : (
                    <Feather name="circle" size={18} color={colors.subtext} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Date / time */}
          <View style={s.card}>
            <Text style={s.cardTitle}>When</Text>

            <View style={s.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Date (YYYY-MM-DD)</Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="2026-02-10"
                  placeholderTextColor={colors.subtext}
                  style={s.input}
                  keyboardAppearance={isDark ? "dark" : "light"}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={{ width: 12 }} />

              <View style={{ width: 140 }}>
                <Text style={s.label}>Time (optional)</Text>
                <TextInput
                  value={time}
                  onChangeText={setTime}
                  placeholder="07:30"
                  placeholderTextColor={colors.subtext}
                  style={s.input}
                  keyboardAppearance={isDark ? "dark" : "light"}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            <Text style={s.hint}>Tip: leave time blank if you just want “on that day”.</Text>
          </View>

          {/* Notes */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. do this before work, keep it easy, focus on form…"
              placeholderTextColor={colors.subtext}
              style={[s.input, { height: 92, textAlignVertical: "top", paddingTop: 12 }]}
              keyboardAppearance={isDark ? "dark" : "light"}
              multiline
            />
          </View>

          {/* Summary */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Summary</Text>
            <Text style={s.summaryText}>
              {selectedTemplate
                ? `Scheduling “${selectedTemplate.name || "Workout"}” on ${date}${time ? ` at ${time}` : ""}.`
                : "Select a workout to schedule."}
            </Text>
          </View>

          {/* Save */}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[s.saveBtn, !canSave && { opacity: 0.45 }]}
          >
            {saving ? (
              <ActivityIndicator />
            ) : (
              <>
                <Feather name="calendar" size={18} color="#111111" />
                <Text style={s.saveBtnText}>Save schedule</Text>
              </>
            )}
          </Pressable>

          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
function makeStyles(colors, isDark) {
  const cardBg = isDark ? "#111217" : "#FFFFFF";
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const border = isDark ? "#1F2128" : "#E1E3E8";

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");

  const softShadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      };

  const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "900",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    headerSub: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 2,
    },

    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    centerText: { color: colors.subtext, fontWeight: "700" },

    scroll: { paddingHorizontal: 18, paddingBottom: 18 },

    card: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 12,
      ...softShadow,
    },
    cardTitle: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 13,
      letterSpacing: 0.9,
      textTransform: "uppercase",
    },
    cardMuted: {
      marginTop: 6,
      color: colors.subtext,
      fontWeight: "700",
      fontSize: 12,
      lineHeight: 16,
    },

    templateRow: {
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 10,
    },
    templateRowActive: {
      borderColor: accentBg,
      backgroundColor: isDark ? "rgba(230,255,59,0.10)" : "rgba(230,255,59,0.25)",
    },
    templateName: { color: colors.text, fontWeight: "900", fontSize: 14 },
    templateSub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    fieldRow: { flexDirection: "row", alignItems: "flex-start" },
    label: { color: colors.subtext, fontWeight: "800", fontSize: 11, marginBottom: 8 },
    input: {
      backgroundColor: panelBg,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      color: colors.text,
      fontWeight: "800",
      fontSize: 14,
    },
    hint: { marginTop: 10, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    summaryText: { marginTop: 8, color: colors.text, fontWeight: "700", fontSize: 13, lineHeight: 18 },

    saveBtn: {
      backgroundColor: accentBg,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      ...softShadow,
    },
    saveBtnText: {
      color: "#111111",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 12,
    },
  });

  // tiny hack so we can reuse accent text colour for the check icon above
  styles._accentText = { color: accentText };

  return styles;
}
