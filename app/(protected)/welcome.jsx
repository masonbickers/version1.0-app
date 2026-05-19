import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";
import { buildNutritionProfilePayload } from "../../src/lib/nutrition/dataModel";

const TRAINING_GOALS = ["5K", "10K", "Half marathon", "Marathon", "Hybrid", "Strength"];
const ABILITY_LEVELS = ["Beginner", "Returning", "Intermediate", "Advanced"];
const NUTRITION_GOALS = ["Maintain", "Fat loss", "Muscle gain", "Performance"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function numberOrNull(value) {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toggleValue(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function WelcomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const accent = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";

  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(auth.currentUser?.displayName || "");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [goal, setGoal] = useState("10K");
  const [ability, setAbility] = useState("Returning");
  const [trainingDays, setTrainingDays] = useState(["Mon", "Wed", "Fri"]);
  const [sessionsPerWeek, setSessionsPerWeek] = useState("3");
  const [sessionLength, setSessionLength] = useState("45");
  const [currentRun, setCurrentRun] = useState("");
  const [currentStrength, setCurrentStrength] = useState("");
  const [nutritionGoal, setNutritionGoal] = useState("Maintain");
  const [dailyCalories, setDailyCalories] = useState("");
  const [proteinTarget, setProteinTarget] = useState("");
  const [connectGarmin, setConnectGarmin] = useState(false);
  const [connectStrava, setConnectStrava] = useState(false);
  const [connectAppleHealth, setConnectAppleHealth] = useState(false);

  const finish = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Add your name", "This keeps the test profile readable.");
      return;
    }
    if (!trainingDays.length) {
      Alert.alert("Pick training days", "Choose at least one preferred training day.");
      return;
    }

    const profile = {
      name: name.trim(),
      email: auth.currentUser?.email || "",
      age: numberOrNull(age),
      heightCm: numberOrNull(heightCm),
      weightKg: numberOrNull(weightKg),
    };
    const planPrefs = {
      goalPrimaryFocus: goal,
      goalDistance: goal,
      currentAbility: ability,
      preferredDays: trainingDays,
      sessionsPerWeek: numberOrNull(sessionsPerWeek) || trainingDays.length,
      sessionLengthMin: numberOrNull(sessionLength),
      currentRunAbility: currentRun.trim(),
      currentStrengthAbility: currentStrength.trim(),
      onboardingSource: "draft_1_user_test",
      updatedAt: serverTimestamp(),
    };
    const nutritionProfile = buildNutritionProfilePayload({
      ...profile,
      nutritionGoal,
      goalType: nutritionGoal.toLowerCase().replace(/\s+/g, "_"),
      dailyCalories: numberOrNull(dailyCalories),
      proteinTarget: numberOrNull(proteinTarget),
    });
    const connectedAppPreferences = {
      garmin: { desired: connectGarmin, connected: false },
      strava: { desired: connectStrava, connected: false },
      appleHealth: { desired: connectAppleHealth, connected: false },
      updatedAt: serverTimestamp(),
    };

    try {
      setSaving(true);
      await Promise.all([
        setDoc(
          doc(db, "users", uid),
          {
            ...profile,
            welcomeSeen: true,
            onboardingComplete: true,
            onboardingCompletedAt: serverTimestamp(),
            goal,
            currentAbility: ability,
            trainingPreferences: planPrefs,
            connectedAppPreferences,
            integrations: connectedAppPreferences,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ),
        setDoc(doc(db, "users", uid, "planPrefs", "current"), planPrefs, { merge: true }),
        setDoc(doc(db, "users", uid, "nutrition", "profile"), nutritionProfile, { merge: true }),
      ]);
      router.replace("/(protected)/home");
    } catch (e) {
      Alert.alert("Could not save onboarding", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <LinearGradient
        colors={isDark ? ["#0A0A0A", "#111111", "#000000"] : ["#F7F9EF", "#F5F5F5", "#EFEFEF"]}
        style={s.page}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.header}>
              <Text style={s.kicker}>DRAFT 1 SETUP</Text>
              <Text style={s.title}>Set up your test profile</Text>
              <Text style={s.subtitle}>
                This powers Home, Train, Fuel, Progress, and Chat during the user test.
              </Text>
            </View>

            <Section title="Profile" s={s}>
              <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" s={s} />
              <View style={s.grid}>
                <Field label="Age" value={age} onChangeText={setAge} keyboardType="numeric" placeholder="32" s={s} />
                <Field label="Height" value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" placeholder="cm" s={s} />
                <Field label="Weight" value={weightKg} onChangeText={setWeightKg} keyboardType="numeric" placeholder="kg" s={s} />
              </View>
            </Section>

            <Section title="Training" s={s}>
              <ChoiceRow options={TRAINING_GOALS} value={goal} onChange={setGoal} s={s} />
              <ChoiceRow options={ABILITY_LEVELS} value={ability} onChange={setAbility} s={s} />
              <Text style={s.label}>Preferred training days</Text>
              <View style={s.chips}>
                {DAYS.map((day) => (
                  <Chip
                    key={day}
                    label={day}
                    active={trainingDays.includes(day)}
                    onPress={() => setTrainingDays((prev) => toggleValue(prev, day))}
                    s={s}
                  />
                ))}
              </View>
              <View style={s.grid}>
                <Field label="Sessions/week" value={sessionsPerWeek} onChangeText={setSessionsPerWeek} keyboardType="numeric" placeholder="3" s={s} />
                <Field label="Session length" value={sessionLength} onChangeText={setSessionLength} keyboardType="numeric" placeholder="min" s={s} />
              </View>
              <Field label="Current running ability" value={currentRun} onChangeText={setCurrentRun} placeholder="e.g. 5K in 28 min, 15 km/week" s={s} />
              <Field label="Current strength ability" value={currentStrength} onChangeText={setCurrentStrength} placeholder="e.g. 3 gym days, squat 80 kg" s={s} />
            </Section>

            <Section title="Nutrition" s={s}>
              <ChoiceRow options={NUTRITION_GOALS} value={nutritionGoal} onChange={setNutritionGoal} s={s} />
              <View style={s.grid}>
                <Field label="Daily calories" value={dailyCalories} onChangeText={setDailyCalories} keyboardType="numeric" placeholder="optional" s={s} />
                <Field label="Protein target" value={proteinTarget} onChangeText={setProteinTarget} keyboardType="numeric" placeholder="g/day" s={s} />
              </View>
            </Section>

            <Section title="Connected apps" s={s}>
              <Toggle label="Garmin" value={connectGarmin} onChange={setConnectGarmin} s={s} />
              <Toggle label="Strava" value={connectStrava} onChange={setConnectStrava} s={s} />
              <Toggle label="Apple Health" value={connectAppleHealth} onChange={setConnectAppleHealth} s={s} />
            </Section>

            <TouchableOpacity
              style={[s.primary, { backgroundColor: accent }, saving && { opacity: 0.7 }]}
              onPress={finish}
              disabled={saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Feather name="check" size={18} color="#111111" />
                  <Text style={s.primaryText}>Save and open Home</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

function Section({ title, children, s }) {
  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, s, ...props }) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#8A8F98" style={s.input} {...props} />
    </View>
  );
}

function ChoiceRow({ options, value, onChange, s }) {
  return (
    <View style={s.chips}>
      {options.map((option) => (
        <Chip key={option} label={option} active={value === option} onPress={() => onChange(option)} s={s} />
      ))}
    </View>
  );
}

function Chip({ label, active, onPress, s }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Toggle({ label, value, onChange, s }) {
  return (
    <TouchableOpacity onPress={() => onChange(!value)} activeOpacity={0.85} style={s.toggle}>
      <View style={[s.toggleBox, value && s.toggleBoxActive]}>
        {value ? <Feather name="check" size={13} color="#111111" /> : null}
      </View>
      <Text style={s.toggleText}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors, isDark) {
  const accent = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1 },
    content: { padding: 20, paddingBottom: 34, gap: 14 },
    header: { gap: 8, paddingTop: 8, paddingBottom: 6 },
    kicker: { color: accent, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
    title: { color: colors.text, fontSize: 32, lineHeight: 36, fontWeight: "900" },
    subtitle: { color: colors.subtext, fontSize: 15, lineHeight: 22 },
    card: {
      gap: 12,
      borderRadius: 18,
      padding: 16,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
    fieldWrap: { flex: 1, gap: 6 },
    label: { color: colors.subtext, fontSize: 12, fontWeight: "800" },
    input: {
      minHeight: 46,
      borderRadius: 12,
      paddingHorizontal: 12,
      color: colors.text,
      backgroundColor: isDark ? "#07080A" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      fontWeight: "700",
    },
    grid: { flexDirection: "row", gap: 10 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      minHeight: 36,
      borderRadius: 999,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#07080A" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: accent, borderColor: accent },
    chipText: { color: colors.text, fontSize: 12, fontWeight: "800" },
    chipTextActive: { color: "#111111" },
    toggle: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 38 },
    toggleBox: {
      width: 24,
      height: 24,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isDark ? "#07080A" : "#F3F4F6",
    },
    toggleBoxActive: { backgroundColor: accent, borderColor: accent },
    toggleText: { color: colors.text, fontSize: 14, fontWeight: "800" },
    primary: {
      minHeight: 54,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    primaryText: { color: "#111111", fontSize: 16, fontWeight: "900" },
  });
}
