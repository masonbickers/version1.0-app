// app/(protected)/journal/check-in.jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Timestamp, doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */

function todayKey(dateOverride) {
  if (dateOverride) return dateOverride;
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatPrettyDate(key) {
  if (!key) return "";
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/* default config if journalSettings missing */
const DEFAULT_CORE = {
  mood: true,
  stress: true,
  energy: true,
  sleepHours: true,
  sleepQuality: true,
};

const DEFAULT_OPTIONAL = {
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

/* ---------------- page ---------------- */

export default function JournalCheckInPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const user = auth.currentUser;

  const dateKey = useMemo(() => todayKey(params.date), [params.date]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState(null);

  // core questions
  const [sleepHours, setSleepHours] = useState(null); // number
  const [sleepQuality, setSleepQuality] = useState(null); // 1–5
  const [mood, setMood] = useState(null); // 1–5
  const [stress, setStress] = useState(null); // 1–5
  const [energy, setEnergy] = useState(null); // 1–5

  // optional – numeric
  const [soreness, setSoreness] = useState(null); // 1–5

  // optional – toggles
  const [alcohol, setAlcohol] = useState(false);
  const [caffeineLate, setCaffeineLate] = useState(false);
  const [screensLate, setScreensLate] = useState(false);
  const [travel, setTravel] = useState(false);
  const [illness, setIllness] = useState(false);
  const [painInjury, setPainInjury] = useState(false);
  const [workStress, setWorkStress] = useState(false);
  const [lifeStress, setLifeStress] = useState(false);

  // day / training
  const [trainedToday, setTrainedToday] = useState(false);
  const [sessionRpe, setSessionRpe] = useState(null); // 1–10
  const [stuckToPlan, setStuckToPlan] = useState(false);

  const [eveningNote, setEveningNote] = useState("");

  /* ---------------- load settings + existing entry ---------------- */

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const userRef = doc(db, "users", user.uid);
        const entryRef = doc(
          db,
          "users",
          user.uid,
          "journalEntries",
          dateKey
        );

        const [userSnap, entrySnap] = await Promise.all([
          getDoc(userRef),
          getDoc(entryRef),
        ]);

        // journalSettings
        if (userSnap.exists()) {
          const data = userSnap.data();
          const js = data.journalSettings || {};
          const core = js.coreQuestions || DEFAULT_CORE;
          const optional = js.optionalQuestions || DEFAULT_OPTIONAL;
          setSettings({
            enabled: js.enabled !== false,
            coreQuestions: { ...DEFAULT_CORE, ...core },
            optionalQuestions: { ...DEFAULT_OPTIONAL, ...optional },
          });
        } else {
          setSettings({
            enabled: true,
            coreQuestions: DEFAULT_CORE,
            optionalQuestions: DEFAULT_OPTIONAL,
          });
        }

        // entry values
        if (entrySnap.exists()) {
          const data = entrySnap.data();

          setSleepHours(
            typeof data.sleepHours === "number" ? data.sleepHours : null
          );
          setSleepQuality(
            typeof data.sleepQuality === "number"
              ? data.sleepQuality
              : null
          );
          setMood(typeof data.mood === "number" ? data.mood : null);
          setStress(
            typeof data.stress === "number" ? data.stress : null
          );
          setEnergy(
            typeof data.energy === "number" ? data.energy : null
          );

          setSoreness(
            typeof data.sorenessScore === "number"
              ? data.sorenessScore
              : null
          );

          setAlcohol(!!data.alcohol);
          setCaffeineLate(
            data.caffeineLate != null ? !!data.caffeineLate : false
          );
          setScreensLate(
            data.screensLate != null ? !!data.screensLate : false
          );
          setTravel(!!data.travel);
          setIllness(!!data.illness);
          setPainInjury(!!data.painInjury);
          setWorkStress(!!data.workStress);
          setLifeStress(!!data.lifeStress);

          setTrainedToday(!!data.trainedToday);
          setSessionRpe(
            typeof data.sessionRpe === "number"
              ? data.sessionRpe
              : null
          );
          setStuckToPlan(!!data.stuckToPlan);

          setEveningNote(data.eveningNote || "");
        }
      } catch (err) {
        console.error("Error loading journal entry", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user, dateKey]);

  /* ---------------- helpers driven by settings ---------------- */

  const isCoreOn = (key) =>
    !settings?.coreQuestions ? true : !!settings.coreQuestions[key];

  const isOptOn = (key) =>
    !settings?.optionalQuestions ? true : !!settings.optionalQuestions[key];

  /* ---------------- save ---------------- */

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }
    try {
      setSaving(true);

      const ref = doc(
        db,
        "users",
        user.uid,
        "journalEntries",
        dateKey
      );

      await setDoc(
        ref,
        {
          dateKey,
          date: Timestamp.fromDate(new Date(dateKey)),
          // core
          sleepHours:
            typeof sleepHours === "number" ? sleepHours : null,
          sleepQuality:
            typeof sleepQuality === "number" ? sleepQuality : null,
          mood: typeof mood === "number" ? mood : null,
          stress: typeof stress === "number" ? stress : null,
          energy: typeof energy === "number" ? energy : null,
          // optional numeric
          sorenessScore:
            typeof soreness === "number" ? soreness : null,
          // optional toggles
          alcohol,
          caffeineLate,
          screensLate,
          travel,
          illness,
          painInjury,
          workStress,
          lifeStress,
          // training
          trainedToday,
          sessionRpe:
            typeof sessionRpe === "number" ? sessionRpe : null,
          stuckToPlan,
          // note
          eveningNote: eveningNote?.trim() || "",
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );

      Alert.alert("Saved", "Check-in saved for today.", [
        {
          text: "OK",
          onPress: () => router.back(),
        },
      ]);
    } catch (err) {
      console.error("Save journal error", err);
      Alert.alert(
        "Error",
        "Sorry, there was a problem saving your check-in."
      );
    } finally {
      setSaving(false);
    }
  };

  const s = makeStyles(colors, isDark, accent);
  const prettyDate = formatPrettyDate(dateKey);

  /* ---------------- UI helpers ---------------- */

  const renderScaleRow = (label, value, setValue, max) => (
    <View style={s.scaleBlock}>
      <View style={s.rowBetween}>
        <Text style={s.fieldLabel}>{label}</Text>
        <Text style={s.fieldValue}>
          {value ? `${value}/${max}` : "—"}
        </Text>
      </View>
      <View style={s.scaleRow}>
        {Array.from({ length: max }).map((_, idx) => {
          const num = idx + 1;
          const active = value === num;
          return (
            <TouchableOpacity
              key={num}
              onPress={() => setValue(num)}
              activeOpacity={0.85}
              style={[
                s.scaleChip,
                active ? s.scaleChipActive : s.scaleChipInactive,
              ]}
            >
              <Text
                style={[
                  s.scaleChipText,
                  active
                    ? s.scaleChipTextActive
                    : s.scaleChipTextInactive,
                ]}
              >
                {num}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const sleepHourOptions = [4, 5, 6, 7, 8, 9];

  /* ---------------- render ---------------- */

  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      style={s.safe}
    >
      <View style={s.page}>
        {/* header */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.iconButtonGhost}
            activeOpacity={0.8}
          >
            <Feather
              name="chevron-left"
              size={20}
              color={colors.text}
            />
          </TouchableOpacity>
          <View style={s.headerTextWrap}>
            <Text style={s.headerTitle}>Daily check-in</Text>
            <Text style={s.headerSubtitle}>{prettyDate}</Text>
          </View>
          <View style={{ width: 32 }} />
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
            <Text style={s.loadingText}>
              Loading today’s check-in…
            </Text>
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Morning section */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Morning</Text>
              <Text style={s.sectionHint}>
                Quick feel for sleep, mood and stress.
              </Text>

              {/* Sleep hours */}
              {isCoreOn("sleepHours") && (
                <View style={s.block}>
                  <View style={s.rowBetween}>
                    <Text style={s.fieldLabel}>Sleep duration</Text>
                    <Text style={s.fieldValue}>
                      {sleepHours ? `${sleepHours} h` : "—"}
                    </Text>
                  </View>
                  <View style={s.chipRow}>
                    {sleepHourOptions.map((h) => {
                      const active = sleepHours === h;
                      return (
                        <TouchableOpacity
                          key={h}
                          onPress={() => setSleepHours(h)}
                          activeOpacity={0.85}
                          style={[
                            s.chip,
                            active
                              ? s.chipActive
                              : s.chipInactive,
                          ]}
                        >
                          <Text
                            style={[
                              s.chipText,
                              active
                                ? s.chipTextActive
                                : s.chipTextInactive,
                            ]}
                          >
                            {h}h
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* core scales */}
              {isCoreOn("sleepQuality") &&
                renderScaleRow(
                  "Sleep quality",
                  sleepQuality,
                  setSleepQuality,
                  5
                )}
              {isCoreOn("mood") &&
                renderScaleRow("Mood", mood, setMood, 5)}
              {isCoreOn("energy") &&
                renderScaleRow("Energy", energy, setEnergy, 5)}
              {isCoreOn("stress") &&
                renderScaleRow("Stress", stress, setStress, 5)}

              {/* soreness (optional numeric) */}
              {isOptOn("soreness") &&
                renderScaleRow(
                  "Soreness",
                  soreness,
                  setSoreness,
                  5
                )}

              {/* lifestyle toggles */}
              <View style={s.block}>
                <Text style={s.fieldLabel}>Last night</Text>
                <View style={s.toggleRow}>
                  {isOptOn("alcohol") && (
                    <ToggleChip
                      label="Alcohol"
                      value={alcohol}
                      onChange={setAlcohol}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                  {isOptOn("caffeineLate") && (
                    <ToggleChip
                      label="Caffeine late"
                      value={caffeineLate}
                      onChange={setCaffeineLate}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                  {isOptOn("screensLate") && (
                    <ToggleChip
                      label="Screens late"
                      value={screensLate}
                      onChange={setScreensLate}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                  {isOptOn("travel") && (
                    <ToggleChip
                      label="Travel"
                      value={travel}
                      onChange={setTravel}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                </View>
              </View>

              {/* health / stress toggles */}
              <View style={s.block}>
                <Text style={s.fieldLabel}>Health & stress</Text>
                <View style={s.toggleRow}>
                  {isOptOn("painInjury") && (
                    <ToggleChip
                      label="Pain / injury"
                      value={painInjury}
                      onChange={setPainInjury}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                  {isOptOn("illness") && (
                    <ToggleChip
                      label="Illness"
                      value={illness}
                      onChange={setIllness}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                  {isOptOn("workStress") && (
                    <ToggleChip
                      label="Work stressful"
                      value={workStress}
                      onChange={setWorkStress}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                  {isOptOn("lifeStress") && (
                    <ToggleChip
                      label="Life stressful"
                      value={lifeStress}
                      onChange={setLifeStress}
                      colors={colors}
                      isDark={isDark}
                    />
                  )}
                </View>
              </View>
            </View>

            {/* Day section */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Today</Text>
              <Text style={s.sectionHint}>
                Training + focus for the day.
              </Text>

              <View style={s.block}>
                <Text style={s.fieldLabel}>Training</Text>
                <View style={s.toggleRow}>
                  <ToggleChip
                    label="Trained today"
                    value={trainedToday}
                    onChange={setTrainedToday}
                    colors={colors}
                    isDark={isDark}
                  />
                  <ToggleChip
                    label="Stuck to plan"
                    value={stuckToPlan}
                    onChange={setStuckToPlan}
                    colors={colors}
                    isDark={isDark}
                  />
                </View>
              </View>

              {/* RPE scale */}
              {renderScaleRow(
                "Hardest session RPE",
                sessionRpe,
                setSessionRpe,
                10
              )}

              {/* note */}
              <View style={s.block}>
                <Text style={s.fieldLabel}>
                  Big win / main frustration
                </Text>
                <TextInput
                  style={s.noteInput}
                  placeholder="Optional. E.g. ‘Intervals felt sharp but over-traded in the afternoon.’"
                  placeholderTextColor={colors.subtext}
                  multiline
                  value={eveningNote}
                  onChangeText={setEveningNote}
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* buttons */}
            <View style={s.buttonRow}>
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => router.back()}
                activeOpacity={0.9}
                disabled={saving}
              >
                <Text style={s.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={handleSave}
                activeOpacity={0.9}
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

/* ---------------- small components ---------------- */

function ToggleChip({ label, value, onChange, colors, isDark }) {
  const active = !!value;
  return (
    <TouchableOpacity
      onPress={() => onChange(!value)}
      activeOpacity={0.85}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active
          ? colors.sapPrimary
          : colors.sapSilverMedium || colors.border,
        backgroundColor: active
          ? colors.sapPrimary
          : isDark
          ? "#111217"
          : "#FFFFFF",
        marginRight: 8,
        marginTop: 8,
      }}
    >
      {active && (
        <Feather
          name="check"
          size={12}
          color={colors.sapOnPrimary}
          style={{ marginRight: 6 }}
        />
      )}
      <Text
        style={{
          fontSize: 12,
          fontWeight: "700",
          color: active ? colors.sapOnPrimary : colors.subtext,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ---------------- styles ---------------- */

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
    headerTextWrap: {
      flex: 1,
      marginLeft: 10,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
    },
    headerSubtitle: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
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
      paddingBottom: 80,
    },

    section: {
      marginTop: 14,
      marginBottom: 6,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sectionHint: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },

    block: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
    },

    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },
    fieldValue: {
      fontSize: 12,
      color: colors.subtext,
    },

    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 8,
    },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      marginRight: 8,
      marginTop: 6,
    },
    chipActive: {
      backgroundColor: accent,
      borderColor: accent,
    },
    chipInactive: {
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderColor: colors.sapSilverMedium || colors.border,
    },
    chipText: {
      fontSize: 12,
      fontWeight: "700",
    },
    chipTextActive: {
      color: colors.sapOnPrimary,
    },
    chipTextInactive: {
      color: colors.subtext,
    },

    scaleBlock: {
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
    },
    scaleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 8,
    },
    scaleChip: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 6,
      marginTop: 6,
      borderWidth: 1,
    },
    scaleChipActive: {
      backgroundColor: accent,
      borderColor: accent,
    },
    scaleChipInactive: {
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderColor: colors.sapSilverMedium || colors.border,
    },
    scaleChipText: {
      fontSize: 13,
      fontWeight: "700",
    },
    scaleChipTextActive: {
      color: colors.sapOnPrimary,
    },
    scaleChipTextInactive: {
      color: colors.subtext,
    },

    toggleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 6,
    },

    noteInput: {
      marginTop: 8,
      minHeight: 90,
      fontSize: 13,
      color: colors.text,
    },

    buttonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 18,
      marginBottom: 8,
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
