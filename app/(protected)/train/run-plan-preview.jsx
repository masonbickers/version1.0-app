// app/(protected)/train/run-plan-preview.jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const APPLE_BLUE = "#E6FF3B";
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ------------------------------------------------------------------
// Theme helper
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

// Little pill tag
function Tag({ label }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function fmtMinutesFromSec(sec) {
  const s = Number(sec) || 0;
  if (!s) return null;
  return Math.round(s / 60);
}

function safeToFixed1(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return (Math.round(v * 10) / 10).toFixed(1);
}

// Build days array from week.sessions (rules-engine / legacy schema support)
function buildDaysFromSessions(week) {
  const sessions = Array.isArray(week?.sessions) ? week.sessions : [];
  const byDay = new Map(DAY_ORDER.map((d) => [d, []]));

  for (const s of sessions) {
    const day = s?.day || s?.dayName;
    if (day && byDay.has(day)) {
      byDay.get(day).push(s);
    }
  }

  return DAY_ORDER.map((d) => ({ day: d, sessions: byDay.get(d) || [] }));
}

// ------------------------------------------------------------------
// MAIN SCREEN
// ------------------------------------------------------------------
export default function RunPlanPreview() {
  const { plan: planParam, goalDistance, primaryFocus } = useLocalSearchParams();
  const router = useRouter();
  const theme = useScreenTheme();
  const user = auth.currentUser;

  const [plan, setPlan] = useState(null);
  const [saving, setSaving] = useState(false);

  // Decode & parse plan from params
  useEffect(() => {
    if (!planParam) {
      setPlan(null);
      return;
    }

    try {
      const raw = Array.isArray(planParam) && planParam.length > 0 ? planParam[0] : planParam;
      const decoded = decodeURIComponent(raw);
      const parsed = JSON.parse(decoded);
      setPlan(parsed);
    } catch (err) {
      console.log("[run-plan-preview] failed to parse plan:", err);
      setPlan(null);
    }
  }, [planParam]);

  // Normalise to TrainingPlan-ish schema: { name, goalType, primaryActivity, weeks[] }
  const { safePlan, weeks } = useMemo(() => {
    if (!plan || typeof plan !== "object") {
      return {
        safePlan: {
          name: "Run plan",
          goalType: "",
          primaryActivity: "Run",
          weeks: [],
        },
        weeks: [],
      };
    }

    const name = plan.name || "Run plan";
    const goalType = plan.goalType || "";
    const primaryActivity = plan.primaryActivity || "Run";
    const weeksArr = Array.isArray(plan.weeks) ? plan.weeks : [];

    return {
      safePlan: { ...plan, name, goalType, primaryActivity, weeks: weeksArr },
      weeks: weeksArr,
    };
  }, [plan]);

  const totalWeeks = weeks.length || null;

  const safeGoalDistance =
    (Array.isArray(goalDistance) ? goalDistance[0] : goalDistance) || safePlan.goalType || "";
  const safePrimaryFocus = (Array.isArray(primaryFocus) ? primaryFocus[0] : primaryFocus) || "";

  // ------------------------------------------------------------------
  // Save plan (Firestore)
  // ------------------------------------------------------------------
  const handleSavePlan = async () => {
    if (!plan) {
      Alert.alert("No plan", "There is no plan to save.");
      return;
    }

    if (!user?.uid) {
      Alert.alert("Sign-in required", "Please sign in again before saving your plan.");
      return;
    }

    setSaving(true);
    try {
      const ref = await addDoc(collection(db, "runPlans"), {
        userId: user.uid,
        createdAt: serverTimestamp(),
        mode: "run",
        source: "run-plan-preview",
        planName: safePlan.name || null,
        goalType: safePlan.goalType || null,
        goalDistance: safeGoalDistance || null,
        primaryFocus: safePrimaryFocus || null,
        totalWeeks: totalWeeks,
        plan: safePlan,
      });

      console.log("[run-plan-preview] saved plan with id:", ref.id);

      Alert.alert("Plan saved", "Your run plan has been saved to your library.", [
        {
          text: "View my plans",
          onPress: () => router.push("/(protected)/train/index"),
        },
        { text: "Stay here" },
      ]);
    } catch (err) {
      console.log("[run-plan-preview] error saving plan:", err);
      Alert.alert("Error", err?.message || "Something went wrong while saving your plan.");
    } finally {
      setSaving(false);
    }
  };

  if (!plan) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={styles.centerContainer}>
          <Text style={{ color: theme.text, fontSize: 16, marginBottom: 8 }}>No plan loaded</Text>
          <Text style={{ color: theme.subtext, fontSize: 13, marginBottom: 16 }}>
            There was a problem loading your plan. Try generating it again.
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.secondaryBtn, { borderColor: theme.border, paddingHorizontal: 20 }]}
          >
            <Text style={{ color: theme.text, fontWeight: "700" }}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* HEADER */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.pillBtn, { borderColor: theme.border, paddingHorizontal: 10 }]}
          activeOpacity={0.85}
        >
          <Feather name="chevron-left" size={18} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "700" }}>Back</Text>
        </TouchableOpacity>

        <View style={{ alignItems: "center" }}>
          <Text style={[styles.hTitle, { color: theme.text }]}>Your run plan</Text>
          <Text style={{ fontSize: 12, color: theme.subtext, marginTop: 2 }}>
            Review your weeks, days, and sessions before saving
          </Text>
        </View>

        <View style={{ width: 70 }} />
      </View>

      {/* CONTENT */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Top summary card */}
        <View style={[styles.summaryCard, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: theme.text, marginBottom: 4 }}>
                {safeGoalDistance || "Run goal"}
              </Text>
              <Text style={{ color: theme.subtext, fontSize: 13 }}>
                {safePrimaryFocus || "Structured run plan built from your profile and availability."}
              </Text>
              {safePlan.name && safePlan.name !== safeGoalDistance && (
                <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                  {safePlan.name}
                </Text>
              )}
            </View>

            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {totalWeeks && <Tag label={`${totalWeeks} weeks`} />}
              {safePlan.goalType ? <Tag label={safePlan.goalType} /> : null}
              {safePlan.primaryActivity ? <Tag label={safePlan.primaryActivity} /> : null}
            </View>
          </View>

          <View style={{ marginTop: 10, padding: 8, borderRadius: 10, backgroundColor: theme.muted }}>
            <Text style={{ fontSize: 11, color: theme.subtext }}>
              This plan is saved as structured JSON. If your generator outputs weeks.sessions instead of weeks.days,
              we’ll still render it correctly.
            </Text>
          </View>
        </View>

        {/* Weeks */}
        {weeks.map((week, wIdx) => {
          const weekTitle = week.title || `Week ${wIdx + 1}`;
          const weekFocus = week.focus || null;

          // ✅ Support BOTH schemas:
          // 1) week.days[].sessions[]
          // 2) week.sessions[] with { day: "Mon"/... }
          const weekDays = Array.isArray(week.days)
            ? week.days
            : Array.isArray(week.sessions)
              ? buildDaysFromSessions(week)
              : [];

          return (
            <View
              key={weekTitle + wIdx}
              style={[styles.weekCard, { borderColor: theme.border, backgroundColor: theme.card }]}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: theme.text }}>{weekTitle}</Text>
                {weekFocus ? <Tag label={weekFocus} /> : null}
              </View>

              {week.notes ? (
                <Text style={{ fontSize: 12, color: theme.subtext, marginBottom: 6 }}>{week.notes}</Text>
              ) : null}

              {weekDays.length === 0 ? (
                <Text style={{ fontSize: 12, color: theme.subtext }}>No days listed in this week.</Text>
              ) : (
                weekDays.map((day, dIdx) => {
                  const dayLabel = day.day || day.dayName || `Day ${dIdx + 1}`;
                  const sessions = Array.isArray(day.sessions) ? day.sessions : [];

                  return (
                    <View key={dayLabel + dIdx} style={styles.dayBlock}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text, marginBottom: 4 }}>
                        {dayLabel}
                      </Text>

                      {sessions.length === 0 ? (
                        <Text style={{ fontSize: 11, color: theme.subtext, marginBottom: 4 }}>
                          Rest / no structured session.
                        </Text>
                      ) : (
                        sessions.map((session, sIdx) => {
                          // ✅ handle both “new maker” and “rules-engine”
                          const title =
                            session.title ||
                            session.label ||
                            session.name ||
                            session.type ||
                            `Session ${sIdx + 1}`;

                          const notes = session.notes || "";
                          const segments = Array.isArray(session.segments) ? session.segments : [];
                          const steps = Array.isArray(session.steps) ? session.steps : [];

                          // totals injected by server normaliser (if present)
                          const durMinFromTotals = fmtMinutesFromSec(session?.totals?.totalDurationSec);
                          const distFromTotals = safeToFixed1(session?.totals?.totalDistanceKm);

                          // rules-engine style distance
                          const distFromDistanceKm =
                            typeof session?.distanceKm === "number" ? safeToFixed1(session.distanceKm) : null;

                          const showCount = segments.length > 0 ? segments.length : steps.length;

                          return (
                            <View
                              key={title + sIdx}
                              style={[styles.sessionCard, { borderColor: theme.border, backgroundColor: theme.bg }]}
                            >
                              <View
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 4,
                                }}
                              >
                                <View style={{ flex: 1, paddingRight: 8 }}>
                                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: theme.text }}>
                                    {title}
                                  </Text>

                                  {(durMinFromTotals || distFromTotals || distFromDistanceKm) ? (
                                    <Text style={{ fontSize: 11, color: theme.subtext, marginTop: 2 }}>
                                      {durMinFromTotals ? `~${durMinFromTotals} min` : ""}
                                      {durMinFromTotals && (distFromTotals || distFromDistanceKm) ? " · " : ""}
                                      {distFromTotals ? `~${distFromTotals} km` : ""}
                                      {!distFromTotals && distFromDistanceKm ? `~${distFromDistanceKm} km` : ""}
                                    </Text>
                                  ) : null}
                                </View>

                                {showCount > 0 ? (
                                  <Text style={{ fontSize: 11, color: theme.subtext }}>
                                    {showCount} item{showCount > 1 ? "s" : ""}
                                  </Text>
                                ) : null}
                              </View>

                              {notes ? (
                                <Text style={{ fontSize: 11, color: theme.subtext, marginBottom: 4 }}>{notes}</Text>
                              ) : null}

                              {/* Prefer SEGMENTS. Fallback to STEPS. Else show a compact rules-engine row */}
                              {segments.length > 0 ? (
                                <View style={{ marginTop: 4 }}>
                                  {segments.map((seg, tIdx) => {
                                    const label = seg.label || `Segment ${tIdx + 1}`;
                                    const desc = seg.description || "";
                                    const dist = Number(seg.distanceKm) || 0;
                                    const dur = Number(seg.durationMin) || 0;
                                    const intensity = seg.intensity || "";
                                    const rpe = seg.rpe || "";

                                    return (
                                      <View key={label + tIdx} style={styles.stepRow}>
                                        <View style={{ flex: 1 }}>
                                          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.text }}>
                                            {label}
                                          </Text>
                                          {desc ? (
                                            <Text style={{ fontSize: 11, color: theme.subtext, marginTop: 2 }}>
                                              {desc}
                                            </Text>
                                          ) : null}
                                          {(intensity || rpe) ? (
                                            <Text style={{ fontSize: 11, color: theme.subtext, marginTop: 2 }}>
                                              {[intensity, rpe].filter(Boolean).join(" · ")}
                                            </Text>
                                          ) : null}
                                        </View>

                                        <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
                                          {dist > 0 ? (
                                            <Text style={{ fontSize: 11, color: theme.text, fontWeight: "600" }}>
                                              {safeToFixed1(dist)} km
                                            </Text>
                                          ) : null}
                                          {dur > 0 ? (
                                            <Text style={{ fontSize: 11, color: theme.subtext }}>
                                              ~{Math.round(dur)} min
                                            </Text>
                                          ) : null}
                                        </View>
                                      </View>
                                    );
                                  })}
                                </View>
                              ) : steps.length > 0 ? (
                                <View style={{ marginTop: 4 }}>
                                  {steps.map((step, tIdx) => {
                                    const stepType = step.type || step.name || `Step ${tIdx + 1}`;
                                    const stepDesc = step.description || step.notes || "";
                                    const dist = step.distanceKm ?? step.distance_km ?? step.distance ?? 0;
                                    const dur = step.durationMinutes ?? step.duration_min ?? step.duration ?? 0;
                                    const intensity = step.intensity || step.zone || step.rpe || null;

                                    const hasDist = typeof dist === "number" && dist > 0;
                                    const hasDur = typeof dur === "number" && dur > 0;

                                    return (
                                      <View key={stepType + tIdx} style={styles.stepRow}>
                                        <View style={{ flex: 1 }}>
                                          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme.text }}>
                                            {stepType}
                                          </Text>
                                          {stepDesc ? (
                                            <Text style={{ fontSize: 11, color: theme.subtext, marginTop: 2 }}>
                                              {stepDesc}
                                            </Text>
                                          ) : null}
                                        </View>

                                        <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
                                          {hasDist ? (
                                            <Text style={{ fontSize: 11, color: theme.text, fontWeight: "600" }}>
                                              {dist} km
                                            </Text>
                                          ) : null}
                                          {hasDur ? (
                                            <Text style={{ fontSize: 11, color: theme.subtext }}>~{dur} min</Text>
                                          ) : null}
                                          {intensity ? (
                                            <Text style={{ fontSize: 11, color: theme.subtext, marginTop: 1 }}>
                                              {typeof intensity === "number" ? `RPE ${intensity}` : String(intensity)}
                                            </Text>
                                          ) : null}
                                        </View>
                                      </View>
                                    );
                                  })}
                                </View>
                              ) : (
                                <Text style={{ fontSize: 11, color: theme.subtext, marginTop: 4 }}>
                                  {typeof session?.distanceKm === "number"
                                    ? `Planned distance: ~${safeToFixed1(session.distanceKm)} km`
                                    : "No segments/steps provided for this session."}
                                </Text>
                              )}
                            </View>
                          );
                        })
                      )}
                    </View>
                  );
                })
              )}
            </View>
          );
        })}

        {weeks.length === 0 && (
          <View
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 12,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
            }}
          >
            <Text style={{ fontSize: 13, color: theme.subtext }}>
              No week-by-week structure was provided. If you’re passing plans via route params, consider saving the
              generated plan first and loading by ID to avoid truncation.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { borderTopColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.85}
          style={[styles.secondaryBtn, { borderColor: theme.border, flex: 1 }]}
        >
          <Text style={{ color: theme.text, fontWeight: "700", textAlign: "center" }}>Edit inputs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSavePlan}
          disabled={saving}
          activeOpacity={0.9}
          style={[styles.primaryBtn, { flex: 1.4, backgroundColor: saving ? theme.muted : theme.primaryBg }]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={theme.primaryText} />
          ) : (
            <Feather name="save" size={18} color={theme.primaryText} style={{ marginRight: 2 }} />
          )}
          <Text style={{ color: saving ? "#6B7280" : theme.primaryText, fontWeight: "800" }}>
            {saving ? "Saving…" : "Save plan"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------
// STYLES
// ------------------------------------------------------------------
const styles = StyleSheet.create({
  hTitle: { fontSize: 24, fontWeight: "800" },

  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },

  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    marginTop: 8,
    marginBottom: 10,
  },

  weekCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    marginTop: 10,
  },

  dayBlock: {
    marginTop: 8,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(148,163,184,0.4)",
  },

  sessionCard: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 8,
  },

  stepRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(209,213,219,0.7)",
  },

  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,122,255,0.08)",
  },
  tagText: {
    fontSize: 11,
    fontWeight: "700",
    color: APPLE_BLUE,
  },

  bottomBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(0,0,0,0.02)",
    gap: 10,
  },

  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
});
