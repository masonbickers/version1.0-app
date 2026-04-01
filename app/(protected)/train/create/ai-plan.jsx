import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { API_URL } from "../../../../config/api";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";
import { getJsonAuthHeaders } from "../../../../src/lib/api/authHeaders";

/* -----------------------------
   UI tokens (match your style)
------------------------------ */
const PRIMARY = "#E6FF3B";
const BG = "#0B0F14";
const CARD = "#101720";
const TEXT = "#E9EEF5";
const MUTED = "#9AA7B5";
const BORDER = "rgba(255,255,255,0.10)";

/* -----------------------------
   Options
------------------------------ */
const GOAL_DISTANCE_OPTIONS = ["5K", "10K", "Half marathon", "Marathon", "General fitness", "Return from injury"];
const PRIMARY_FOCUS_OPTIONS = ["PB / time goal", "Build endurance", "Build speed", "Return from injury", "Hybrid / fitness"];
const EXPERIENCE_OPTIONS = ["Beginner", "Some experience", "Intermediate", "Advanced/competitive"];
const INTENSITY_PREF_OPTIONS = ["Conservative", "Balanced", "Aggressive"];
const GUIDANCE_OPTIONS = ["Pace", "HR", "RPE"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toNum(v, fallback = null) {
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

function hhmmssToString(v) {
  // keep as provided; backend can validate
  return String(v || "").trim();
}

export default function AiPlanCreatePage() {
  const router = useRouter();
  const { theme } = useTheme?.() || { theme: "dark" };

  const [user, setUser] = useState(null);

  // ---- Form state (goal)
  const [goalDistance, setGoalDistance] = useState("10K");
  const [primaryFocus, setPrimaryFocus] = useState("PB / time goal");
  const [targetTime, setTargetTime] = useState("00:37:00");
  const [planLengthWeeks, setPlanLengthWeeks] = useState("8");

  // ---- Current fitness
  const [weeklyKm, setWeeklyKm] = useState("25");
  const [longestRunKm, setLongestRunKm] = useState("15");
  const [experience, setExperience] = useState("Advanced/competitive");
  const [fiveK, setFiveK] = useState("18:21");
  const [tenK, setTenK] = useState("38:43");

  // ---- Availability
  const [sessionsPerWeek, setSessionsPerWeek] = useState("4");
  const [runDays, setRunDays] = useState(["Mon", "Wed", "Fri", "Sun"]);
  const [longRunDay, setLongRunDay] = useState("Sun");
  const [maxHardDays, setMaxHardDays] = useState("2");
  const [weekdayMaxMins, setWeekdayMaxMins] = useState("60");
  const [weekendMaxMins, setWeekendMaxMins] = useState("90");

  // ---- Preferences
  const [intensityPref, setIntensityPref] = useState("Balanced");
  const [guidanceMode, setGuidanceMode] = useState("Pace");
  const [includeWarmupCooldown, setIncludeWarmupCooldown] = useState(true);
  const [allowStrides, setAllowStrides] = useState(true);
  const [allowHills, setAllowHills] = useState(false);

  // ---- Injury / notes
  const [injuryNotes, setInjuryNotes] = useState("");

  // ---- UX state
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub?.();
  }, []);

  const canSubmit = useMemo(() => {
    const w = toNum(weeklyKm, null);
    const lr = toNum(longestRunKm, null);
    const spw = toNum(sessionsPerWeek, null);
    const weeks = toNum(planLengthWeeks, null);
    return !!user && w != null && lr != null && spw != null && weeks != null && runDays?.length > 0 && !!longRunDay;
  }, [user, weeklyKm, longestRunKm, sessionsPerWeek, planLengthWeeks, runDays, longRunDay]);

  function toggleRunDay(d) {
    setRunDays((prev) => {
      const has = prev.includes(d);
      const next = has ? prev.filter((x) => x !== d) : [...prev, d];
      // Keep order Mon..Sun
      return DAYS.filter((day) => next.includes(day));
    });
  }

  async function generatePlan() {
    if (!API_URL) {
      Alert.alert("Missing API URL", "Set EXPO_PUBLIC_API_URL so the app can call your plan endpoint.");
      return;
    }
    if (!canSubmit) {
      Alert.alert("Missing info", "Please fill in the required fields (weekly km, longest run, runs per week, run days).");
      return;
    }

    const payload = {
      athleteProfile: {
        availability: {
          sessionsPerWeek: toNum(sessionsPerWeek, 4),
          runDays,
          longRunDay,
          constraints: {
            maxHardDays: toNum(maxHardDays, 2),
            weekdayMaxMins: toNum(weekdayMaxMins, 60),
            weekendMaxMins: toNum(weekendMaxMins, 90),
          },
        },
        current: {
          weeklyKm: toNum(weeklyKm, 25),
          longestRunKm: toNum(longestRunKm, 15),
          experience,
          recentTimes: {
            fiveK: hhmmssToString(fiveK),
            tenK: hhmmssToString(tenK),
          },
        },
        goal: {
          distance: goalDistance,
          primaryFocus,
          targetTime: hhmmssToString(targetTime),
          planLengthWeeks: toNum(planLengthWeeks, 8),
        },
        preferences: {
          intensityPref,
          guidanceMode,
          includeWarmupCooldown,
          allowStrides,
          allowHills,
          injuryNotes: String(injuryNotes || "").trim(),
        },
      },
      // Optional: your backend can use this to force “blocks → steps” output
      output: {
        wantGarminSteps: true,
        wantBlocks: true,
      },
      meta: {
        client: "expo",
        createdAtISO: new Date().toISOString(),
      },
    };

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/generate-run?allowDefaults=1`, {
        method: "POST",
        headers: await getJsonAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Plan API failed (${res.status}). ${txt}`.trim());
      }

      const data = await res.json();
      const plan = data?.plan || data; // support either {plan} or direct

      if (!plan?.weeks?.length) {
        throw new Error("No plan returned (missing plan.weeks).");
      }

      // Save to Firestore (canonical plan + metadata)
      const ref = await addDoc(collection(db, "users", user.uid, "trainingPlans"), {
        createdAt: serverTimestamp(),
        goalDistance,
        primaryFocus,
        targetTime: hhmmssToString(targetTime),
        planLengthWeeks: toNum(planLengthWeeks, 8),
        athleteProfile: payload.athleteProfile,
        plan,
        // Keep raw response for debugging (optional)
        rawResponse: data,
        version: "ai-plan-v1",
      });

      // Navigate to view-plan (change route as needed)
      router.push({
        pathname: "/(protected)/train/view-plan",
        params: { planId: ref.id },
      });
    } catch (e) {
      console.log("Generate plan error:", e);
      Alert.alert("Could not generate plan", e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>AI Plan Generator</Text>
        <Text style={styles.subtitle}>
          Fully personalised plan → blocks → Garmin steps. No templates.
        </Text>

        {!user ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in required</Text>
            <Text style={styles.muted}>Please log in to generate and save plans.</Text>
          </View>
        ) : null}

        {/* GOAL */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Goal</Text>

          <Row label="Distance" value={goalDistance} options={GOAL_DISTANCE_OPTIONS} onPick={setGoalDistance} />
          <Row label="Focus" value={primaryFocus} options={PRIMARY_FOCUS_OPTIONS} onPick={setPrimaryFocus} />

          <Field label="Target time (hh:mm:ss)" value={targetTime} onChangeText={setTargetTime} placeholder="00:37:00" />
          <Field label="Plan length (weeks)" value={planLengthWeeks} onChangeText={setPlanLengthWeeks} placeholder="8" keyboardType="number-pad" />
        </View>

        {/* CURRENT */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current fitness</Text>

          <Field label="Weekly km" value={weeklyKm} onChangeText={setWeeklyKm} placeholder="25" keyboardType="decimal-pad" />
          <Field label="Longest run (km) last 4 weeks" value={longestRunKm} onChangeText={setLongestRunKm} placeholder="15" keyboardType="decimal-pad" />
          <Row label="Experience" value={experience} options={EXPERIENCE_OPTIONS} onPick={setExperience} />

          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Field label="Recent 5K (mm:ss or hh:mm:ss)" value={fiveK} onChangeText={setFiveK} placeholder="18:21" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Recent 10K (mm:ss or hh:mm:ss)" value={tenK} onChangeText={setTenK} placeholder="38:43" />
            </View>
          </View>
        </View>

        {/* AVAILABILITY */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Availability</Text>

          <Field label="Runs per week" value={sessionsPerWeek} onChangeText={setSessionsPerWeek} placeholder="4" keyboardType="number-pad" />
          <Row label="Long run day" value={longRunDay} options={DAYS} onPick={setLongRunDay} />

          <Text style={styles.label}>Run days</Text>
          <View style={styles.pills}>
            {DAYS.map((d) => {
              const active = runDays.includes(d);
              return (
                <TouchableOpacity
                  key={d}
                  onPress={() => toggleRunDay(d)}
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Field label="Max hard days / week" value={maxHardDays} onChangeText={setMaxHardDays} placeholder="2" keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Weekday max mins" value={weekdayMaxMins} onChangeText={setWeekdayMaxMins} placeholder="60" keyboardType="number-pad" />
            </View>
          </View>

          <Field label="Weekend max mins" value={weekendMaxMins} onChangeText={setWeekendMaxMins} placeholder="90" keyboardType="number-pad" />
        </View>

        {/* PREFERENCES */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Preferences</Text>

          <Row label="Intensity preference" value={intensityPref} options={INTENSITY_PREF_OPTIONS} onPick={setIntensityPref} />
          <Row label="Guidance mode" value={guidanceMode} options={GUIDANCE_OPTIONS} onPick={setGuidanceMode} />

          <Toggle label="Include warmup + cooldown" value={includeWarmupCooldown} onChange={setIncludeWarmupCooldown} />
          <Toggle label="Allow strides" value={allowStrides} onChange={setAllowStrides} />
          <Toggle label="Allow hills" value={allowHills} onChange={setAllowHills} />

          <Text style={styles.label}>Injury / constraints notes (optional)</Text>
          <TextInput
            value={injuryNotes}
            onChangeText={setInjuryNotes}
            placeholder="e.g. Achilles niggle, avoid track, max 2 hard days"
            placeholderTextColor="rgba(233,238,245,0.35)"
            style={[styles.input, { height: 90, textAlignVertical: "top" }]}
            multiline
          />
        </View>

        {/* CTA */}
        <View style={styles.footer}>
          <TouchableOpacity
            disabled={!canSubmit || loading}
            onPress={generatePlan}
            style={[styles.cta, (!canSubmit || loading) && styles.ctaDisabled]}
          >
            {loading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator />
                <Text style={styles.ctaText}>Generating…</Text>
              </View>
            ) : (
              <Text style={styles.ctaText}>Generate AI Plan</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            This generates a blocks-based plan, validates it, and saves it to your account.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* -----------------------------
   Small components
------------------------------ */
function Field({ label, value, onChangeText, placeholder, keyboardType }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={String(value ?? "")}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(233,238,245,0.35)"
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={!!value} onValueChange={onChange} />
    </View>
  );
}

function Row({ label, value, options, onPick }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pills}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onPick(opt)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* -----------------------------
   Styles
------------------------------ */
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingBottom: 28 },
  title: { color: TEXT, fontSize: 28, fontWeight: "800", letterSpacing: 0.2 },
  subtitle: { color: MUTED, marginTop: 6, lineHeight: 18 },

  card: {
    marginTop: 14,
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  muted: { color: MUTED, marginTop: 6 },

  label: { color: MUTED, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXT,
  },

  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  pillActive: {
    borderColor: "rgba(230,255,59,0.65)",
    backgroundColor: "rgba(230,255,59,0.14)",
  },
  pillText: { color: TEXT, fontSize: 12, fontWeight: "700" },
  pillTextActive: { color: TEXT },

  grid2: { flexDirection: "row", gap: 10 },

  toggleRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  footer: { marginTop: 16, gap: 10 },
  cta: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaDisabled: { opacity: 0.55 },
  ctaText: { color: "#0B0F14", fontWeight: "900", fontSize: 14, letterSpacing: 0.2 },
  hint: { color: MUTED, fontSize: 12, lineHeight: 16 },
});
