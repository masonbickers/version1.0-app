// app/(protected)/train/create.jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { API_URL } from "../../../../config/api";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";
import { useAiPlan } from "../../../../src/hooks/useAiPlan"; // ✅ AI hook

// ✅ All plan helpers now come from the shared model
import {
  createBasePlan,
  mkStep,
  normalisePlanForSave,
  normaliseSessionForPlan,
  normaliseWeeksForSave,
  planToPreview,
  trainingPlanToWeeks,
} from "../../../../src/lib/train/planModel";

/* ----------------- config ----------------- */
// 🔒 Run-only plans (for now)
const ACTIVITY_TYPES = ["Run"];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STEP_TYPES = [
  "Warmup",
  "Run",
  "Tempo",
  "Intervals",
  "CoolDown",
  "Recovery",
  "Drills",
  "Rest",
];
const DURATION_TYPES = ["Time (min)", "Distance (km)", "Reps"];
const INTENSITY_TYPES = ["Pace (/km)", "HR Zone", "RPE", "None"];

const emptyWeek = (title) => ({
  title,
  days: DAYS.map((d) => ({ day: d, sessions: [] })),
});

const uidOrThrow = () => {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in.");
  return u.uid;
};

/* Map ThemeProvider to the screen theme */
function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? colors?.primary ?? "#E6FF3B";
  const accentText = colors?.sapOnPrimary ?? "#111111";
  const card2 = colors?.surfaceAlt ?? (isDark ? "#0E0F12" : "#FFFFFF");
  const muted = colors?.section ?? colors?.surfaceAlt ?? (isDark ? "#171A22" : "#E8ECF2");
  return {
    bg: colors.bg,
    card: colors.card,
    card2,
    text: colors.text,
    subtext: colors.subtext,
    border: colors.border,
    muted,
    primaryBg: accentBg,
    primaryText: accentText,
    placeholder: colors.subtextSoft || "#9CA3AF",
    headerTitle: colors.text,
    headerSubtitle: colors.subtext,
  };
}

/* ----------------- helpers ----------------- */
const normaliseStr = (s) => String(s || "").trim();

/* ----------------- small UI bits ----------------- */
function ActivityPicker({ theme, value, onChange }) {
  // Now only shows "Run" but keeps the same pill UI
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
      style={{ marginVertical: 8 }}
    >
      {ACTIVITY_TYPES.map((t) => {
        const active = value === t;
        return (
          <TouchableOpacity
            key={t}
            onPress={() => onChange(t)}
            style={[
              st.pill,
              {
                backgroundColor: active ? theme.primaryBg : theme.card2,
                borderColor: theme.border,
              },
            ]}
          >
            <Text
              style={{
                color: active ? theme.primaryText : theme.text,
                fontWeight: "700",
              }}
            >
              {t}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ----------------- STEP EDITOR MODAL ----------------- */
function StepFieldRow({ label, children, theme }) {
  return (
    <View style={{ gap: 6, marginBottom: 10 }}>
      <Text
        style={{
          color: theme.subtext,
          fontSize: 12,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

function SelectRow({ value, onChange, options, theme }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[
              st.pill,
              {
                backgroundColor: active ? theme.primaryBg : theme.card2,
                borderColor: theme.border,
              },
            ]}
          >
            <Text
              style={{
                color: active ? theme.primaryText : theme.text,
                fontWeight: "700",
              }}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function StepEditorModal({ visible, onClose, theme, session, onChange }) {
  const [view, setView] = useState("overview"); // overview | edit
  const [idx, setIdx] = useState(-1);
  const [draft, setDraft] = useState(mkStep({}));

  useEffect(() => {
    if (!visible) {
      setView("overview");
      setIdx(-1);
    }
  }, [visible]);

  const segs = Array.isArray(session.segments) ? session.segments : [];

  const openEdit = (i) => {
    const s = segs[i] || mkStep({});
    setDraft(JSON.parse(JSON.stringify(s)));
    setIdx(i);
    setView("edit");
  };

  const saveEdit = () => {
    const next = Array.from(segs);
    if (idx >= 0) next[idx] = draft;
    else next.push(draft);
    onChange({ ...session, segments: next });
    setView("overview");
    setIdx(-1);
  };

  const removeAt = (i) => {
    const next = Array.from(segs);
    next.splice(i, 1);
    onChange({ ...session, segments: next });
  };

  const addSimple = () => {
    onChange({
      ...session,
      segments: [
        ...segs,
        mkStep({
          type: "Run",
          durationType: "Time (min)",
          durationValue: 20,
        }),
      ],
    });
  };

  const addRepeat = () => {
    const repeat = mkStep({
      isRepeat: true,
      repeatReps: 2,
      steps: [
        mkStep({
          type: "Intervals",
          durationType: "Time (min)",
          durationValue: 3,
          intensityType: "Pace (/km)",
          intensityTarget: "I pace",
          notes: "Strong, smooth",
        }),
        mkStep({
          type: "Recovery",
          durationType: "Time (min)",
          durationValue: 2,
          intensityType: "HR Zone",
          intensityTarget: "Z1–Z2",
        }),
      ],
    });
    onChange({ ...session, segments: [...segs, repeat] });
  };

  const renderStepChip = (s, i, depth = 0) => {
    const isRepeat = s.isRepeat;
    return (
      <View
        key={`seg-${depth}-${i}`}
        style={[
          st.stepChip,
          { borderColor: theme.border, backgroundColor: theme.card },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontWeight: "700" }}>
            {isRepeat ? `Repeat x${s.repeatReps}` : s.type}
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 12 }}>
            {isRepeat
              ? `${s.steps?.length || 0} steps`
              : `${s.durationType
                  .replace("(min)", "")
                  .replace("(km)", "")
                  .trim()}: ${s.durationValue}${
                  s.intensityType !== "None"
                    ? ` · ${s.intensityTarget || s.intensityType}`
                    : ""
                }`}
          </Text>
          {!!normaliseStr(s.notes) && (
            <Text
              style={{
                color: theme.subtext,
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {s.notes}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!isRepeat && (
            <TouchableOpacity
              onPress={() => openEdit(i)}
              style={[st.pillBtn, { borderColor: theme.border }]}
            >
              <Feather name="edit" size={14} color={theme.text} />
              <Text style={{ color: theme.text, fontWeight: "700" }}>
                Edit
              </Text>
            </TouchableOpacity>
          )}
          {isRepeat && (
            <TouchableOpacity
              onPress={() => {
                setDraft(JSON.parse(JSON.stringify(s)));
                setIdx(i);
                setView("edit");
              }}
              style={[st.pillBtn, { borderColor: theme.border }]}
            >
              <Feather name="layers" size={14} color={theme.text} />
              <Text style={{ color: theme.text, fontWeight: "700" }}>
                Edit set
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => removeAt(i)}
            style={[st.pillBtn, { borderColor: theme.border }]}
          >
            <Feather name="trash-2" size={14} color="#B91C1C" />
            <Text style={{ color: "#B91C1C", fontWeight: "700" }}>
              Remove
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[st.modalSafe, { backgroundColor: theme.bg }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          {view === "overview" ? (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <View style={st.rowBetween}>
                <Text style={[st.modalTitle, { color: theme.text }]}>
                  Session steps
                </Text>
                <TouchableOpacity
                  onPress={onClose}
                  style={[st.pillBtn, { borderColor: theme.border }]}
                >
                  <Feather name="x" size={16} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "700" }}>
                    Close
                  </Text>
                </TouchableOpacity>
              </View>

              {/* List steps */}
              <View style={{ gap: 8 }}>
                {segs.length === 0 && (
                  <Text style={{ color: theme.subtext }}>
                    No steps yet. Add warm-up / main intervals / cool-down.
                  </Text>
                )}
                {segs.map((s, i) => (
                  <View key={`s-${i}`}>
                    {renderStepChip(s, i)}
                    {s.isRepeat &&
                      Array.isArray(s.steps) &&
                      s.steps.length > 0 && (
                        <View
                          style={{
                            marginLeft: 12,
                            marginTop: 6,
                            gap: 6,
                          }}
                        >
                          {s.steps.map((inner, j) => (
                            <View
                              key={`inner-${i}-${j}`}
                              style={[
                                st.stepChip,
                                {
                                  borderColor: theme.border,
                                  backgroundColor: theme.card,
                                },
                              ]}
                            >
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    color: theme.text,
                                    fontWeight: "700",
                                  }}
                                >
                                  {inner.type}
                                </Text>
                                <Text
                                  style={{
                                    color: theme.subtext,
                                    fontSize: 12,
                                  }}
                                >
                                  {inner.durationType
                                    .replace("(min)", "")
                                    .replace("(km)", "")
                                    .trim()}
                                  : {inner.durationValue}
                                  {inner.intensityType !== "None"
                                    ? ` · ${
                                        inner.intensityTarget ||
                                        inner.intensityType
                                      }`
                                    : ""}
                                </Text>
                                {!!normaliseStr(inner.notes) && (
                                  <Text
                                    style={{
                                      color: theme.subtext,
                                      fontSize: 12,
                                      marginTop: 2,
                                    }}
                                  >
                                    {inner.notes}
                                  </Text>
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                  </View>
                ))}
              </View>

              {/* Add buttons */}
              <View
                style={{ flexDirection: "row", gap: 10, marginTop: 10 }}
              >
                <TouchableOpacity
                  onPress={addSimple}
                  style={[
                    st.primaryBtn,
                    { backgroundColor: theme.primaryBg },
                  ]}
                >
                  <Feather name="plus" size={16} color={theme.primaryText} />
                  <Text
                    style={{
                      color: theme.primaryText,
                      fontWeight: "800",
                    }}
                  >
                    Add step
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={addRepeat}
                  style={[
                    st.outlineBtn,
                    { borderColor: theme.border },
                  ]}
                >
                  <Feather name="repeat" size={16} color={theme.text} />
                  <Text
                    style={{ color: theme.text, fontWeight: "800" }}
                  >
                    Add repeat set
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            // EDIT VIEW
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <View style={st.rowBetween}>
                <Text style={[st.modalTitle, { color: theme.text }]}>
                  {draft.isRepeat ? "Edit repeat set" : "Edit step"}
                </Text>
                <TouchableOpacity
                  onPress={() => setView("overview")}
                  style={[st.pillBtn, { borderColor: theme.border }]}
                >
                  <Feather
                    name="chevrons-left"
                    size={16}
                    color={theme.text}
                  />
                  <Text style={{ color: theme.text, fontWeight: "700" }}>
                    Back
                  </Text>
                </TouchableOpacity>
              </View>

              {!draft.isRepeat && (
                <>
                  <StepFieldRow label="Step type" theme={theme}>
                    <SelectRow
                      value={draft.type}
                      onChange={(v) =>
                        setDraft({ ...draft, type: v })
                      }
                      options={STEP_TYPES}
                      theme={theme}
                    />
                  </StepFieldRow>

                  <StepFieldRow label="Notes" theme={theme}>
                    <TextInput
                      style={[
                        st.input,
                        {
                          color: theme.text,
                          borderColor: theme.border,
                          backgroundColor: theme.card,
                        },
                      ]}
                      placeholder="e.g. relaxed, tall hips, quick feet"
                      placeholderTextColor={theme.placeholder}
                      value={draft.notes}
                      onChangeText={(t) =>
                        setDraft({ ...draft, notes: t })
                      }
                      multiline
                    />
                  </StepFieldRow>

                  <StepFieldRow label="Duration type" theme={theme}>
                    <SelectRow
                      value={draft.durationType}
                      onChange={(v) =>
                        setDraft({ ...draft, durationType: v })
                      }
                      options={DURATION_TYPES}
                      theme={theme}
                    />
                  </StepFieldRow>

                  <StepFieldRow label="Duration value" theme={theme}>
                    <TextInput
                      style={[
                        st.input,
                        {
                          color: theme.text,
                          borderColor: theme.border,
                          backgroundColor: theme.card,
                        },
                      ]}
                      keyboardType="numeric"
                      placeholder={
                        draft.durationType === "Distance (km)"
                          ? "e.g. 1.0"
                          : "e.g. 10"
                      }
                      placeholderTextColor={theme.placeholder}
                      value={String(draft.durationValue ?? "")}
                      onChangeText={(t) =>
                        setDraft({
                          ...draft,
                          durationValue: Number(t || 0),
                        })
                      }
                    />
                  </StepFieldRow>

                  <StepFieldRow label="Intensity target" theme={theme}>
                    <SelectRow
                      value={draft.intensityType}
                      onChange={(v) =>
                        setDraft({ ...draft, intensityType: v })
                      }
                      options={INTENSITY_TYPES}
                      theme={theme}
                    />
                    {draft.intensityType !== "None" && (
                      <TextInput
                        style={[
                          st.input,
                          {
                            color: theme.text,
                            borderColor: theme.border,
                            backgroundColor: theme.card,
                            marginTop: 8,
                          },
                        ]}
                        placeholder={
                          draft.intensityType === "Pace (/km)"
                            ? "e.g. 4:00–4:05 /km"
                            : draft.intensityType === "HR Zone"
                            ? "e.g. Z2 / Z4"
                            : "e.g. RPE 7–8"
                        }
                        placeholderTextColor={theme.placeholder}
                        value={draft.intensityTarget}
                        onChangeText={(t) =>
                          setDraft({
                            ...draft,
                            intensityTarget: t,
                          })
                        }
                      />
                    )}
                  </StepFieldRow>
                </>
              )}

              {draft.isRepeat && (
                <>
                  <StepFieldRow label="Repetitions" theme={theme}>
                    <TextInput
                      style={[
                        st.input,
                        {
                          color: theme.text,
                          borderColor: theme.border,
                          backgroundColor: theme.card,
                        },
                      ]}
                      keyboardType="numeric"
                      placeholder="e.g. 4"
                      placeholderTextColor={theme.placeholder}
                      value={String(draft.repeatReps || 2)}
                      onChangeText={(t) =>
                        setDraft({
                          ...draft,
                          repeatReps: Number(t || 1),
                        })
                      }
                    />
                  </StepFieldRow>

                  <Text
                    style={[
                      st.label,
                      { color: theme.subtext, marginTop: 6 },
                    ]}
                  >
                    Inner steps
                  </Text>
                  <View style={{ gap: 8 }}>
                    {(draft.steps || []).map((s, i) => (
                      <View
                        key={`inner-${i}`}
                        style={[
                          st.stepChip,
                          {
                            borderColor: theme.border,
                            backgroundColor: theme.card,
                          },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: theme.text,
                              fontWeight: "700",
                            }}
                          >
                            {s.type}
                          </Text>
                          <Text
                            style={{
                              color: theme.subtext,
                              fontSize: 12,
                            }}
                          >
                            {s.durationType
                              .replace("(min)", "")
                              .replace("(km)", "")
                              .trim()}
                            : {s.durationValue}
                            {s.intensityType !== "None"
                              ? ` · ${
                                  s.intensityTarget ||
                                  s.intensityType
                                }`
                              : ""}
                          </Text>
                          {!!normaliseStr(s.notes) && (
                            <Text
                              style={{
                                color: theme.subtext,
                                fontSize: 12,
                                marginTop: 2,
                              }}
                            >
                              {s.notes}
                            </Text>
                          )}
                        </View>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity
                            onPress={() => {
                              const copy = JSON.parse(
                                JSON.stringify(s)
                              );
                              setDraft((d0) => {
                                const d = { ...d0 };
                                d.steps[i] = copy;
                                return d;
                              });
                              setView("edit");
                            }}
                            style={[
                              st.pillBtn,
                              { borderColor: theme.border },
                            ]}
                          >
                            <Feather
                              name="edit"
                              size={14}
                              color={theme.text}
                            />
                            <Text
                              style={{
                                color: theme.text,
                                fontWeight: "700",
                              }}
                            >
                              Edit
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              const next = JSON.parse(
                                JSON.stringify(draft)
                              );
                              next.steps.splice(i, 1);
                              setDraft(next);
                            }}
                            style={[
                              st.pillBtn,
                              { borderColor: theme.border },
                            ]}
                          >
                            <Feather
                              name="trash-2"
                              size={14}
                              color="#B91C1C"
                            />
                            <Text
                              style={{
                                color: "#B91C1C",
                                fontWeight: "700",
                              }}
                            >
                              Remove
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>

                  <View
                    style={{ flexDirection: "row", gap: 10, marginTop: 10 }}
                  >
                    <TouchableOpacity
                      onPress={() =>
                        setDraft((d) => ({
                          ...d,
                          steps: [
                            ...(d.steps || []),
                            mkStep({
                              type: "Intervals",
                              durationType: "Time (min)",
                              durationValue: 3,
                            }),
                          ],
                        }))
                      }
                      style={[
                        st.outlineBtn,
                        { borderColor: theme.border },
                      ]}
                    >
                      <Feather
                        name="plus"
                        size={16}
                        color={theme.text}
                      />
                      <Text
                        style={{
                          color: theme.text,
                          fontWeight: "800",
                        }}
                      >
                        Add inner step
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <View
                style={{ flexDirection: "row", gap: 10, marginTop: 12 }}
              >
                <TouchableOpacity
                  onPress={saveEdit}
                  style={[
                    st.primaryBtn,
                    { backgroundColor: theme.primaryBg },
                  ]}
                >
                  <Feather
                    name="check"
                    size={16}
                    color={theme.primaryText}
                  />
                  <Text
                    style={{
                      color: theme.primaryText,
                      fontWeight: "800",
                    }}
                  >
                    Save step
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/* ----------------- session editor with STEPS button ----------------- */
function SessionRow({ theme, session, onChange, onDelete }) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const segments = Array.isArray(session.segments)
    ? session.segments
    : [];

  const wu = segments.find((s) => /^warm/i.test(s.type));
  const cd = segments.find((s) => /^cool/i.test(s.type));
  const mains = segments.filter(
    (s) => !/^(warm|cool)/i.test(s.type)
  );
  const stepsSummary = `${wu ? "WU" : ""}${
    mains.length ? (wu ? " • " : "") + `${mains.length} main` : ""
  }${cd ? " • CD" : ""}`;

  return (
    <View
      style={[
        st.sessionRow,
        { borderColor: theme.border, backgroundColor: theme.card },
      ]}
    >
      <TextInput
        placeholder="Title (e.g. Easy + strides)"
        placeholderTextColor={theme.placeholder}
        value={session.title}
        onChangeText={(t) => onChange({ ...session, title: t })}
        style={[
          st.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.card,
          },
        ]}
      />

      {/* Optional high-level fields */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          placeholder="Duration (min)"
          placeholderTextColor={theme.placeholder}
          keyboardType="numeric"
          value={
            session.durationMin
              ? String(session.durationMin)
              : session.targetDurationMin
              ? String(session.targetDurationMin)
              : ""
          }
          onChangeText={(t) =>
            onChange({
              ...session,
              durationMin: Number(t) || 0,
              targetDurationMin: Number(t) || 0,
            })
          }
          style={[
            st.inputHalf,
            {
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.card,
            },
          ]}
        />
        <TextInput
          placeholder="Distance (km)"
          placeholderTextColor={theme.placeholder}
          keyboardType="numeric"
          value={
            session.distanceKm
              ? String(session.distanceKm)
              : session.targetDistanceKm
              ? String(session.targetDistanceKm)
              : ""
          }
          onChangeText={(t) =>
            onChange({
              ...session,
              distanceKm: Number(t) || 0,
              targetDistanceKm: Number(t) || 0,
            })
          }
          style={[
            st.inputHalf,
            {
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.card,
            },
          ]}
        />
      </View>

      <TextInput
        placeholder="Notes (e.g. route, surface, shoes)"
        placeholderTextColor={theme.placeholder}
        value={session.notes || ""}
        onChangeText={(t) => onChange({ ...session, notes: t })}
        style={[
          st.input,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.card,
          },
        ]}
      />

      {/* Steps launcher */}
      <TouchableOpacity
        onPress={() => setStepsOpen(true)}
        style={[
          st.pillBtn,
          { borderColor: theme.border, alignSelf: "flex-start" },
        ]}
      >
        <Feather name="list" size={16} color={theme.text} />
        <Text style={{ color: theme.text, fontWeight: "700" }}>
          Steps {segments.length ? `(${segments.length})` : ""}
          {stepsSummary ? ` — ${stepsSummary}` : ""}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onDelete} style={st.delBtn}>
        <Feather name="trash-2" size={16} color="#B91C1C" />
        <Text style={{ color: "#B91C1C", fontWeight: "700" }}>
          Remove session
        </Text>
      </TouchableOpacity>

      <StepEditorModal
        visible={stepsOpen}
        onClose={() => setStepsOpen(false)}
        theme={theme}
        session={session}
        onChange={(s) => onChange(normaliseSessionForPlan(s))}
      />
    </View>
  );
}

/* ----------------- Day/Week editors ----------------- */
function DayColumn({ theme, day, onAdd, onChangeAt, onDeleteAt }) {
  return (
    <View style={{ flex: 1, minWidth: 220 }}>
      <Text style={[st.dayTitle, { color: theme.text }]}>{day.day}</Text>
      {day.sessions.map((sess, idx) => (
        <SessionRow
          key={idx}
          theme={theme}
          session={sess}
          onChange={(s) => onChangeAt(idx, s)}
          onDelete={() => onDeleteAt(idx)}
        />
      ))}
      <TouchableOpacity
        onPress={onAdd}
        style={[
          st.addBtn,
          { borderColor: theme.border, backgroundColor: theme.card },
        ]}
      >
        <Feather name="plus" size={16} color={theme.text} />
        <Text style={{ color: theme.text, fontWeight: "700" }}>
          Add session
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function WeekEditor({ theme, week, onChange, onDuplicate }) {
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={[st.sectionTitle, { color: theme.text }]}>
          {week.title || "Week"}
        </Text>
        <TouchableOpacity
          onPress={onDuplicate}
          style={[
            st.dupBtn,
            {
              backgroundColor: theme.card2,
              borderColor: theme.border,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <Feather name="copy" size={14} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "800" }}>
            Duplicate week
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12 }}
      >
        {week.days.map((d, i) => (
          <DayColumn
            key={d.day}
            theme={theme}
            day={d}
            onAdd={() => {
              const next = { ...week };
              next.days[i] = {
                ...next.days[i],
                sessions: [
                  ...next.days[i].sessions,
                  normaliseSessionForPlan({
                    type: "Run",
                    title: "",
                    durationMin: 45,
                    distanceKm: 0,
                    notes: "",
                    segments: [],
                  }),
                ],
              };
              onChange(next);
            }}
            onChangeAt={(idx, s) => {
              const next = { ...week };
              const list = [...next.days[i].sessions];
              list[idx] = normaliseSessionForPlan(s);
              next.days[i] = { ...next.days[i], sessions: list };
              onChange(next);
            }}
            onDeleteAt={(idx) => {
              const next = { ...week };
              const list = [...next.days[i].sessions];
              list.splice(idx, 1);
              next.days[i] = { ...next.days[i], sessions: list };
              onChange(next);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/* ----------------- AI modal ----------------- */
function AIGenerateModal({
  visible,
  onClose,
  onGenerate,
  theme,
  onGenerateViaChatGPT,
  aiCalling,
}) {
  const [goal, setGoal] = useState("Sub-40 10K in 4 weeks");
  const [focus, setFocus] = useState("Run");
  const [weeks, setWeeks] = useState("4");
  const [daysPerWeek, setDaysPerWeek] = useState("4");
  const [notes, setNotes] = useState(
    "Current 5K: 20:00. Include warm-up/cool-down and clear paces & HR zones."
  );

  const submitLocal = () =>
    onGenerate({
      goal,
      primaryActivity: focus,
      weeks: Number(weeks) || 4,
      daysPerWeek: Number(daysPerWeek) || 4,
      extraNotes: notes,
    });

  const submitChatGPT = async () => {
    try {
      await onGenerateViaChatGPT?.({
        goal,
        primaryActivity: focus,
        weeks: Number(weeks) || 4,
        daysPerWeek: Number(daysPerWeek) || 4,
        extraNotes: notes,
      });
    } catch (e) {
      Alert.alert(
        "AI error",
        e?.message || "Could not generate via ChatGPT."
      );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[st.modalSafe, { backgroundColor: theme.bg }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={[st.modalTitle, { color: theme.text }]}>
              Generate with AI
            </Text>
            <Text style={{ color: theme.subtext, fontSize: 10 }}>
              API_URL → {API_URL}
            </Text>

            <TextInput
              style={[
                st.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.card,
                },
              ]}
              placeholder="Goal"
              placeholderTextColor={theme.placeholder}
              value={goal}
              onChangeText={setGoal}
            />
            {/* Run-only activity picker (single option) */}
            <ActivityPicker
              theme={theme}
              value={focus}
              onChange={setFocus}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[
                  st.inputHalf,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.card,
                  },
                ]}
                placeholder="Weeks"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={weeks}
                onChangeText={setWeeks}
              />
              <TextInput
                style={[
                  st.inputHalf,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.card,
                  },
                ]}
                placeholder="Days / week"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={daysPerWeek}
                onChangeText={setDaysPerWeek}
              />
            </View>
            <TextInput
              style={[
                st.input,
                {
                  color: theme.text,
                  borderColor: theme.border,
                  backgroundColor: theme.card,
                  minHeight: 80,
                },
              ]}
              multiline
              placeholder="Anything to add?"
              placeholderTextColor={theme.placeholder}
              value={notes}
              onChangeText={setNotes}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                onPress={onClose}
                style={[st.outlineBtn, { borderColor: theme.border }]}
              >
                <Text
                  style={{ color: theme.text, fontWeight: "700" }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitLocal}
                style={[
                  st.primaryBtn,
                  { backgroundColor: theme.primaryBg },
                ]}
              >
                <Feather
                  name="sparkles"
                  size={16}
                  color={theme.primaryText}
                />
                <Text
                  style={{
                    color: theme.primaryText,
                    fontWeight: "800",
                  }}
                >
                  Generate
                </Text>
              </TouchableOpacity>
              {onGenerateViaChatGPT && (
                <TouchableOpacity
                  onPress={submitChatGPT}
                  disabled={aiCalling}
                  style={[
                    st.primaryBtn,
                    {
                      backgroundColor: theme.primaryBg,
                      opacity: aiCalling ? 0.6 : 1,
                    },
                  ]}
                >
                  <Feather
                    name="cpu"
                    size={16}
                    color={theme.primaryText}
                  />
                  <Text
                    style={{
                      color: theme.primaryText,
                      fontWeight: "800",
                    }}
                  >
                    {aiCalling ? "Thinking…" : "Use ChatGPT"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              onPress={async () => {
                try {
                  const r = await fetch(`${API_URL}/health`);
                  const t = await r.text();
                  Alert.alert("Health", t);
                } catch (err) {
                  Alert.alert("Health failed", String(err));
                }
              }}
              style={[
                st.primaryBtn,
                { backgroundColor: theme.primaryBg, marginTop: 8 },
              ]}
            >
              <Text
                style={{
                  color: theme.primaryText,
                  fontWeight: "800",
                }}
              >
                Ping API
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

/* ----------------- page ----------------- */
export default function TrainCreate() {
  const theme = useScreenTheme();
  const router = useRouter();
  const params = useLocalSearchParams();

  const { createPlan: createAiPlan } = useAiPlan(); // ✅ NEW

  const [planId, setPlanId] = useState(null);
  const [planName, setPlanName] = useState("Custom Plan");
  const [primaryActivity, setPrimaryActivity] = useState("Run");
  const [weeks, setWeeks] = useState([emptyWeek("Week 1")]);
  const [paceGuide, setPaceGuide] = useState([]);

  const [aiVisible, setAiVisible] = useState(false);
  const [aiCalling, setAiCalling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState("preview"); // default preview vibe

  // If editing, load existing
  useEffect(() => {
    (async () => {
      if (!params?.edit) return;
      try {
        const uid = uidOrThrow();
        if (params.id) {
          const snap = await getDoc(
            doc(db, "users", uid, "plans", String(params.id))
          );
          if (snap.exists()) {
            const d = snap.data();
            setPlanId(snap.id);
            setPlanName(d.name || "Training Plan");
            setPrimaryActivity(d.primaryActivity || "Run");
            setWeeks(
              Array.isArray(d.weeks) && d.weeks.length
                ? d.weeks
                : [emptyWeek("Week 1")]
            );
            setPaceGuide(d.paceGuide || []);
            return;
          }
        }
        const ref = collection(db, "users", uid, "plans");
        const latest = await getDocs(
          query(ref, orderBy("updatedAt", "desc"), limit(1))
        );
        if (!latest.empty) {
          const doc0 = latest.docs[0];
          const d = doc0.data();
          setPlanId(doc0.id);
          setPlanName(d.name || "Training Plan");
          setPrimaryActivity(d.primaryActivity || "Run");
          setWeeks(
            Array.isArray(d.weeks) && d.weeks.length
              ? d.weeks
              : [emptyWeek("Week 1")]
          );
          setPaceGuide(d.paceGuide || []);
        }
      } catch {
        // ignore
      }
    })();
  }, [params?.edit, params?.id]);

  const totals = useMemo(() => {
    let sessions = 0,
      mins = 0,
      km = 0;
    weeks.forEach((w) =>
      w.days.forEach((d) =>
        d.sessions.forEach((s) => {
          sessions += 1;
          const duration =
            s.targetDurationMin != null
              ? s.targetDurationMin
              : s.durationMin || 0;
          const dist =
            s.targetDistanceKm != null
              ? s.targetDistanceKm
              : s.distanceKm || 0;
          mins += Number(duration || 0);
          km += Number(dist || 0);
        })
      )
    );
    return { sessions, mins, km: Number(km.toFixed(1)) };
  }, [weeks]);

  const addWeek = () =>
    setWeeks((w) => [...w, emptyWeek(`Week ${w.length + 1}`)]);

  /* ---- Plan generation via backend (useAiPlan → /generate-run) ---- */
  const handleGenerateViaChatGPT = async (prefs) => {
    try {
      setAiCalling(true);
      const uid = uidOrThrow();

      const weeksCount = Number(prefs.weeks) || 4;
      const sessionsPerWeek = Number(prefs.daysPerWeek) || 4;

      // Rough target date: current date + weeksCount
      const now = new Date();
      const targetDateObj = new Date(
        now.getTime() + weeksCount * 7 * 24 * 60 * 60 * 1000
      );
      const targetEventDate = targetDateObj.toISOString().slice(0, 10);

      // Guess goalType from goal text
      const goalLower = String(prefs.goal || "").toLowerCase();
      let goalType = "10k";
      if (goalLower.includes("hyrox")) goalType = "Hyrox";
      else if (goalLower.includes("half")) goalType = "Half";
      else if (goalLower.includes("marathon")) goalType = "Marathon";

      const plan = await createAiPlan({
        userId: uid,
        goalType,
        targetEventDate,
        targetTime: "",
        current10kTime: "",
        sessionsPerWeek,
        weeks: weeksCount,
        // extra info the server can use in its prompt (even if optional)
        goal: prefs.goal,
        primaryActivity: "Run",
        extraNotes: prefs.extraNotes,
      });

      const weeksFromPlan = trainingPlanToWeeks(plan);

      setPlanName(prefs.goal || "AI Plan");
      setPrimaryActivity("Run");
      setWeeks(weeksFromPlan);
      setPaceGuide([]); // can be extended later if we generate pace guide server-side
      setAiVisible(false);
      setMode("preview");
    } catch (e) {
      const msg = e?.message || "Could not generate via AI.";
      Alert.alert("AI error", msg);
    } finally {
      setAiCalling(false);
    }
  };

  /* ---- Local "Generate" just delegates to AI ---- */
  const handleAIGenerate = async (prefs) => {
    return handleGenerateViaChatGPT(prefs);
  };

  /* ---- Save ---- */
  const savePlan = async () => {
    try {
      setSaving(true);
      const uid = uidOrThrow();
      console.log("[train/create] Saving plan for uid:", uid);

      // 1) Normalise weeks in the CURRENT screen’s format
      const weeksForSave = normaliseWeeksForSave(weeks);

      // 2) Build a canonical plan object via planModel
      const basePlan = createBasePlan({
        userId: uid,
        name: (planName || "").trim() || "Training Plan",
        primaryActivity: primaryActivity || "Run",
        planType: "run", // later: "hyrox", "strength", "hybrid", etc.
        weeks: weeksForSave,
        meta: {
          createdBy: params?.edit ? "manual-edit" : "manual-create",
          totals, // sessions / mins / km
          paceGuide,
        },
      });

      // 3) Let planModel clean everything + ensure stable shape
      const normalisedPlan = normalisePlanForSave(basePlan);

      // 4) Keep backwards-compatible top-level fields you already use
      const payload = {
        ...normalisedPlan,
        totals,
        paceGuide,
        updatedAt: serverTimestamp(),
      };

      console.log(
        "[train/create] payload (without timestamps):",
        JSON.stringify({ ...payload, updatedAt: "<serverTimestamp>" }, null, 2)
      );

      if (planId) {
        // 📝 Update existing plan
        const ref = doc(db, "users", uid, "plans", planId);
        console.log("[train/create] Updating existing plan:", planId);
        await setDoc(ref, payload, { merge: true });
        console.log("[train/create] Update complete:", planId);
      } else {
        // 🆕 Create new plan
        const ref = await addDoc(
          collection(db, "users", uid, "plans"),
          {
            ...payload,
            createdAt: serverTimestamp(),
          }
        );
        console.log("[train/create] Created new plan with id:", ref.id);
        setPlanId(ref.id);
      }

      Alert.alert("Saved", "Your plan has been saved.");
      router.replace("/train");
    } catch (e) {
      console.log("[train/create] Save error:", e);
      Alert.alert("Save failed", e?.message || "Could not save plan.");
    } finally {
      setSaving(false);
    }
  };

  const preview = planToPreview(normaliseWeeksForSave(weeks));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <AIGenerateModal
        visible={aiVisible}
        onClose={() => setAiVisible(false)}
        onGenerate={handleAIGenerate}
        onGenerateViaChatGPT={handleGenerateViaChatGPT}
        aiCalling={aiCalling}
        theme={theme}
      />

      <ScrollView contentContainerStyle={st.pageContent} showsVerticalScrollIndicator={false}>
        <View style={st.header}>
          <Text style={[st.headerTitle, { color: theme.headerTitle }]}>Create Plan</Text>
          <Text style={[st.headerSubtitle, { color: theme.headerSubtitle }]}>
            Build your run block, shape each week, then save to train.
          </Text>
        </View>

        <View style={st.topControls}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[st.pillBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
          >
            <Feather name="chevron-left" size={17} color={theme.text} />
            <Text style={{ color: theme.text, fontWeight: "800" }}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
            style={[
              st.pillBtn,
              {
                borderColor: mode === "edit" ? theme.primaryBg : theme.border,
                backgroundColor: mode === "edit" ? theme.primaryBg : theme.card2,
              },
            ]}
          >
            <Feather
              name={mode === "edit" ? "eye" : "edit"}
              size={15}
              color={mode === "edit" ? theme.primaryText : theme.text}
            />
            <Text
              style={{
                color: mode === "edit" ? theme.primaryText : theme.text,
                fontWeight: "900",
              }}
            >
              {mode === "edit" ? "Preview" : "Edit"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[st.heroCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={st.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={[st.heroKicker, { color: theme.subtext }]}>Plan snapshot</Text>
              <Text style={[st.heroName, { color: theme.text }]} numberOfLines={1}>
                {planName || "Custom Plan"}
              </Text>
              <Text style={[st.heroMeta, { color: theme.subtext }]}>
                {weeks.length} {weeks.length === 1 ? "week" : "weeks"} · {primaryActivity}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setAiVisible(true)}
              style={[st.heroAiBtn, { backgroundColor: theme.primaryBg }]}
            >
              <Feather name="sparkles" size={14} color={theme.primaryText} />
              <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 12 }}>
                AI Builder
              </Text>
            </TouchableOpacity>
          </View>

          <View style={st.heroStatsRow}>
            <View style={[st.heroStatCard, { backgroundColor: theme.card2, borderColor: theme.border }]}>
              <Text style={[st.heroStatValue, { color: theme.text }]}>{totals.sessions}</Text>
              <Text style={[st.heroStatLabel, { color: theme.subtext }]}>Sessions</Text>
            </View>

            <View style={[st.heroStatCard, { backgroundColor: theme.card2, borderColor: theme.border }]}>
              <Text style={[st.heroStatValue, { color: theme.text }]}>{totals.mins}</Text>
              <Text style={[st.heroStatLabel, { color: theme.subtext }]}>Minutes</Text>
            </View>

            <View style={[st.heroStatCard, { backgroundColor: theme.card2, borderColor: theme.border }]}>
              <Text style={[st.heroStatValue, { color: theme.text }]}>{totals.km}</Text>
              <Text style={[st.heroStatLabel, { color: theme.subtext }]}>Km</Text>
            </View>
          </View>
        </View>

        {/* Meta */}
        <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={st.rowBetween}>
            <Text style={[st.sectionTitle, { color: theme.text }]}>Plan setup</Text>
            <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "800" }}>
              {mode === "edit" ? "Editing structure" : "Reviewing output"}
            </Text>
          </View>

          <Text style={[st.label, { color: theme.subtext }]}>Plan name</Text>
          <TextInput
            style={[
              st.input,
              {
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.card2,
              },
            ]}
            placeholder="Custom Plan"
            placeholderTextColor={theme.placeholder}
            value={planName}
            onChangeText={setPlanName}
          />
          <Text
            style={[
              st.label,
              { color: theme.subtext, marginTop: 10 },
            ]}
          >
            Primary activity
          </Text>
          <ActivityPicker
            theme={theme}
            value={primaryActivity}
            onChange={setPrimaryActivity}
          />
        </View>

        <View style={st.rowBetween}>
          <Text style={[st.sectionTitle, { color: theme.text }]}>
            {mode === "edit" ? "Weeks" : "Plan preview"}
          </Text>
          <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "800" }}>
            {preview.length} {preview.length === 1 ? "week" : "weeks"}
          </Text>
        </View>

        {mode === "edit" ? (
          <>
            {weeks.map((w, idx) => (
              <View
                key={idx}
                style={[
                  st.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text
                  style={[st.weekTitle, { color: theme.text }]}
                >{`${w.title || `Week ${idx + 1}`}`}</Text>
                <WeekEditor
                  theme={theme}
                  week={w}
                  onChange={(next) => {
                    const copy = [...weeks];
                    copy[idx] = next;
                    setWeeks(copy);
                  }}
                  onDuplicate={() => {
                    const dup = JSON.parse(JSON.stringify(w));
                    setWeeks((prev) => {
                      const c = [...prev];
                      c.splice(idx + 1, 0, dup);
                      return c;
                    });
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    marginTop: 10,
                  }}
                >
                  <TouchableOpacity
                    onPress={() =>
                      setWeeks((prev) =>
                        prev.filter((_, i) => i !== idx)
                      )
                    }
                    style={[
                      st.outlineBtn,
                      { borderColor: theme.border },
                    ]}
                  >
                    <Text
                      style={{
                        color: theme.text,
                        fontWeight: "700",
                      }}
                    >
                      Remove week
                    </Text>
                  </TouchableOpacity>
                  {idx === weeks.length - 1 && (
                    <TouchableOpacity
                      onPress={addWeek}
                      style={[
                        st.primaryBtn,
                        { backgroundColor: theme.primaryBg },
                      ]}
                    >
                      <Feather
                        name="plus"
                        size={16}
                        color={theme.primaryText}
                      />
                      <Text
                        style={{
                          color: theme.primaryText,
                          fontWeight: "800",
                        }}
                      >
                        Add week
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </>
        ) : (
          // ---------- PREVIEW ----------
          <View style={{ gap: 18 }}>
            {!!paceGuide.length && (
              <View
                style={[
                  st.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                    gap: 4,
                  },
                ]}
              >
                <Text style={[st.weekTitle, { color: theme.text }]}>
                  Pace guide
                </Text>
                {paceGuide.map((p, i) => (
                  <Text
                    key={i}
                    style={{ color: theme.subtext }}
                  >{`\u2022 ${p}`}</Text>
                ))}
              </View>
            )}

            {preview.map((wk) => (
              <View
                key={wk.title}
                style={[
                  st.card,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text style={[st.weekTitle, { color: theme.text }]}>
                  {wk.title}
                </Text>
                <View
                  style={[st.previewRow, { borderColor: theme.border }]}
                >
                  <Text
                    style={[
                      st.previewHeadCell,
                      { color: theme.subtext },
                    ]}
                  >
                    Day
                  </Text>
                  <Text
                    style={[
                      st.previewHeadCell,
                      { color: theme.subtext, flex: 1.2 },
                    ]}
                  >
                    Session
                  </Text>
                  <Text
                    style={[
                      st.previewHeadCell,
                      { color: theme.subtext, flex: 2 },
                    ]}
                  >
                    Details
                  </Text>
                  <Text
                    style={[
                      st.previewHeadCell,
                      { color: theme.subtext },
                    ]}
                  >
                    Target
                  </Text>
                </View>
                {wk.rows.map((r, i) => (
                  <View
                    key={i}
                    style={[
                      st.previewRow,
                      { borderColor: theme.border },
                    ]}
                  >
                    <Text
                      style={[st.previewCell, { color: theme.text }]}
                    >
                      {r.day}
                    </Text>
                    <Text
                      style={[
                        st.previewCell,
                        { color: theme.text, flex: 1.2 },
                      ]}
                    >
                      {r.session}
                    </Text>
                    <Text
                      style={[
                        st.previewCell,
                        { color: theme.text, flex: 2 },
                      ]}
                    >
                      {r.details}
                    </Text>
                    <Text
                      style={[st.previewCell, { color: theme.text }]}
                    >
                      {r.target}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        <View style={st.footerActions}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[st.outlineBtn, { borderColor: theme.border }]}
          >
            <Text style={{ fontWeight: "700", color: theme.text }}>
              Cancel
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={savePlan}
            disabled={saving}
            style={[
              st.primaryBtn,
              { backgroundColor: theme.primaryBg, opacity: saving ? 0.65 : 1 },
            ]}
          >
            <Feather
              name="save"
              size={16}
              color={theme.primaryText}
            />
            <Text
              style={{
                color: theme.primaryText,
                fontWeight: "800",
              }}
            >
              {saving ? "Saving…" : "Save plan"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ----------------- styles ----------------- */
const st = StyleSheet.create({
  pageContent: {
    paddingHorizontal: 18,
    paddingTop: 0,
    paddingBottom: 150,
    gap: 14,
  },
  header: { marginBottom: 2 },
  headerTitle: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },

  topControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: 14,
    gap: 12,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  heroKicker: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroName: { fontSize: 20, fontWeight: "900" },
  heroMeta: { marginTop: 4, fontSize: 13, fontWeight: "700" },
  heroAiBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
  },
  heroStatsRow: { flexDirection: "row", gap: 10 },
  heroStatCard: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  heroStatValue: {
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 2,
  },
  heroStatLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  h4: { fontSize: 18, fontWeight: "800" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: 14,
    gap: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontWeight: "600",
  },
  inputHalf: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontWeight: "600",
  },

  pill: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  weekTitle: { fontSize: 17, fontWeight: "900" },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },

  sessionRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 11,
    gap: 8,
    marginBottom: 10,
  },
  dayTitle: {
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  addBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    minHeight: 42,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dupBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
  },

  outlineBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    minHeight: 44,
    paddingVertical: 11,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    minHeight: 44,
    paddingVertical: 11,
  },

  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pillBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    minHeight: 40,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  modalSafe: { flex: 1 },
  modalTitle: { fontSize: 24, fontWeight: "900", letterSpacing: 0.3 },

  stepChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  previewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    gap: 8,
  },
  previewHeadCell: { width: 90, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.3 },
  previewCell: { width: 90, fontSize: 13, lineHeight: 18, fontWeight: "600" },

  delBtn: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerActions: { flexDirection: "row", gap: 10, marginTop: 2 },
});
