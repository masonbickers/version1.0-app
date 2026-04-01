/**
 * TRAIN-R — General Fitness Onboarding (Runna-style)
 * - Dedicated onboarding path for: General fitness
 * - Dark premium cards + neon accent
 * - Multi-step wizard + progress bar + sticky CTA
 * - Saves prefs to Firestore: users/{uid}/planPrefs/current
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
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

import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

/* ---------------- tokens ---------------- */
const PRIMARY = "#E6FF3B";
const INK = "#050506";
const CARD = "#111317";
const CARD_2 = "#0E1013";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.70)";
const MUTED_2 = "rgba(255,255,255,0.45)";
const DANGER = "#EF4444";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LABELS = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/* ---------------- reusable UI ---------------- */
function TopBar({ progress, onBack, onClose }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn} hitSlop={12}>
        <Feather name="arrow-left" size={22} color="white" />
      </TouchableOpacity>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={12}>
        <Feather name="x" size={22} color="white" />
      </TouchableOpacity>
    </View>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <View style={{ marginTop: 14, marginBottom: 10 }}>
      <Text style={styles.h1}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function CardOption({ icon, title, desc, selected, onPress, right }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.cardOption, selected ? styles.cardSelected : null]}
    >
      <View style={styles.cardInner}>
        <View style={styles.cardLeft}>
          {icon ? <View style={styles.cardIconWrap}>{icon}</View> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{title}</Text>
            {desc ? <Text style={styles.cardDesc}>{desc}</Text> : null}
          </View>
        </View>
        {right ? <View style={{ marginLeft: 10 }}>{right}</View> : null}
      </View>
    </TouchableOpacity>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.pill, active ? styles.pillSelected : null]}
    >
      <Text style={[styles.pillText, active ? styles.pillTextSelected : null]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StickyFooter({ label, disabled, onPress, hint, leftLabel, onLeft }) {
  return (
    <View style={styles.footerWrap}>
      <View style={styles.footerInner}>
        {hint ? <Text style={styles.footerHint}>{hint}</Text> : null}

        <View style={{ flexDirection: "row", gap: 10 }}>
          {leftLabel ? (
            <TouchableOpacity
              onPress={onLeft}
              activeOpacity={0.9}
              style={styles.secondaryFooterBtn}
            >
              <Text style={styles.secondaryFooterBtnText}>{leftLabel}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.9}
            disabled={disabled}
            style={[
              styles.primaryBtn,
              disabled ? styles.primaryBtnDisabled : null,
              leftLabel ? { flex: 1.4 } : { flex: 1 },
            ]}
          >
            <Text
              style={[
                styles.primaryBtnText,
                disabled ? { opacity: 0.55 } : null,
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* ---------------- screen ---------------- */
export default function GeneralFitnessOnboarding() {
  const router = useRouter();
  useTheme(); // keep hook, but force dark here
  const bg = INK;

  const STEPS = useMemo(
    () => [
      { key: "focus", title: "Your focus" },
      { key: "level", title: "Current level" },
      { key: "schedule", title: "Weekly schedule" },
      { key: "prefs", title: "Preferences" },
      { key: "review", title: "Review & save" },
    ],
    []
  );

  const [step, setStep] = useState(0);
  const progress = useMemo(
    () => clamp((step + 1) / STEPS.length, 0.05, 1),
    [step, STEPS.length]
  );

  // ---- state
  const [primaryFocus, setPrimaryFocus] = useState(null); // required
  const [experienceLevel, setExperienceLevel] = useState(null); // required
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState(""); // required
  const [longestRecentRunKm, setLongestRecentRunKm] = useState(""); // optional

  const [daysPerWeek, setDaysPerWeek] = useState(null); // required
  const [availableDays, setAvailableDays] = useState([]); // must be >= daysPerWeek
  const [longRunDay, setLongRunDay] = useState(null); // optional but nice

  const [surfacePref, setSurfacePref] = useState(["Road"]); // optional
  const [strengthAccess, setStrengthAccess] = useState("Yes"); // Yes/Limited/No
  const [crossTraining, setCrossTraining] = useState("Some"); // None/Some/A lot
  const [injuries, setInjuries] = useState("");
  const [constraints, setConstraints] = useState("");

  const [loading, setLoading] = useState(false);

  const toggleArrayValue = (arr, value, setFn) => {
    if (arr.includes(value)) setFn(arr.filter((v) => v !== value));
    else setFn([...arr, value]);
  };

  const toggleDay = (d) => {
    setAvailableDays((prev) => {
      const has = prev.includes(d);
      if (has) {
        if (longRunDay === d) setLongRunDay(null);
        return prev.filter((x) => x !== d);
      }
      return [...prev, d];
    });
  };

  const requiredDaysOk = useMemo(() => {
    if (!daysPerWeek) return false;
    return availableDays.length >= daysPerWeek;
  }, [availableDays.length, daysPerWeek]);

  const isStepValid = (s) => {
    switch (s) {
      case 0:
        return !!primaryFocus;
      case 1:
        return !!experienceLevel && String(currentWeeklyKm).trim().length > 0;
      case 2:
        return !!daysPerWeek && requiredDaysOk;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return true;
    }
  };

  const canContinue = useMemo(() => isStepValid(step), [
    step,
    primaryFocus,
    experienceLevel,
    currentWeeklyKm,
    daysPerWeek,
    requiredDaysOk,
  ]);

  const handleClose = () => {
    Alert.alert("Leave setup?", "You can finish this later.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const handleBack = () => {
    if (step === 0) return router.back();
    setStep((s) => Math.max(0, s - 1));
  };

  const handleNext = () => {
    if (!isStepValid(step)) {
      Alert.alert("More info needed", "Please complete this section to continue.");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleSave = async () => {
    if (!isStepValid(4)) {
      Alert.alert("Missing info", "Please complete the required fields.");
      return;
    }

    const user = auth.currentUser;
    if (!user?.uid) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        onboardingPath: "general-fitness",
        goalType: "general-fitness",

        primaryFocus: primaryFocus || "",
        experienceLevel: experienceLevel || "",
        currentWeeklyKm: String(currentWeeklyKm || "").trim(),
        longestRecentRunKm: String(longestRecentRunKm || "").trim(),

        daysPerWeek: Number(daysPerWeek || 0),
        availableDays,
        longRunDay: longRunDay || null,

        surfacePref,
        strengthAccess,
        crossTraining,
        injuries: injuries || "",
        constraints: constraints || "",

        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        platform: Platform.OS,
      };

      await setDoc(doc(db, "users", user.uid, "planPrefs", "current"), payload, {
        merge: true,
      });

      Alert.alert("Saved", "Your preferences have been saved.");
      router.replace("/(protected)/train");
    } catch (e) {
      console.log("[general-fitness] save error:", e);
      Alert.alert("Couldn’t save", "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- step UIs ---------------- */
  const StepFocus = () => (
    <>
      <SectionTitle
        title="General fitness"
        subtitle="What’s the main thing you want from running right now?"
      />

      <CardOption
        selected={primaryFocus === "base"}
        onPress={() => setPrimaryFocus("base")}
        icon={<Feather name="activity" size={18} color={PRIMARY} />}
        title="Build an aerobic base"
        desc="Feel fitter, improve endurance, keep it sustainable."
      />
      <CardOption
        selected={primaryFocus === "consistency"}
        onPress={() => setPrimaryFocus("consistency")}
        icon={<Feather name="check-circle" size={18} color={PRIMARY} />}
        title="Consistency & routine"
        desc="A simple weekly structure you can stick to."
      />
      <CardOption
        selected={primaryFocus === "weight"}
        onPress={() => setPrimaryFocus("weight")}
        icon={<Feather name="trending-down" size={18} color={PRIMARY} />}
        title="Body comp / weight loss"
        desc="Steady running + manageable progress."
      />
      <CardOption
        selected={primaryFocus === "feelgood"}
        onPress={() => setPrimaryFocus("feelgood")}
        icon={<Feather name="smile" size={18} color={PRIMARY} />}
        title="Feel-good fitness"
        desc="Low stress, better energy, better mood."
      />
    </>
  );

  const StepLevel = () => (
    <>
      <SectionTitle
        title="Current level"
        subtitle="Weekly km is the key input. Be honest — it’s how we keep you healthy."
      />

      <Card>
        <Text style={styles.smallLabel}>Experience</Text>
        <View style={styles.chipRow}>
          {["New", "Some", "Regular", "Advanced"].map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={experienceLevel === opt}
              onPress={() => setExperienceLevel(opt)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Typical weekly distance *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 25"
          placeholderTextColor={MUTED_2}
          keyboardType="numeric"
          value={currentWeeklyKm}
          onChangeText={setCurrentWeeklyKm}
        />
        <Text style={styles.microHint}>km per week</Text>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Longest run recently (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 12"
          placeholderTextColor={MUTED_2}
          keyboardType="numeric"
          value={longestRecentRunKm}
          onChangeText={setLongestRecentRunKm}
        />
        <Text style={styles.microHint}>km (last 4–6 weeks)</Text>

        {!String(currentWeeklyKm).trim() ? (
          <Text style={[styles.hint, { color: DANGER }]}>
            Weekly km is required.
          </Text>
        ) : null}
      </Card>
    </>
  );

  const StepSchedule = () => (
    <>
      <SectionTitle
        title="Weekly schedule"
        subtitle="Pick a frequency you can actually repeat every week."
      />

      <Card>
        <Text style={styles.smallLabel}>Runs per week *</Text>
        <View style={styles.chipRow}>
          {[2, 3, 4, 5, 6].map((n) => (
            <Chip
              key={n}
              label={`${n}x`}
              active={daysPerWeek === n}
              onPress={() => {
                setDaysPerWeek(n);
                // trim if needed
                setAvailableDays((prev) => (prev.length > n ? prev.slice(0, n) : prev));
              }}
            />
          ))}
        </View>

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>
          Available days {daysPerWeek ? `* (pick ${daysPerWeek})` : ""}
        </Text>

        <View style={styles.dayGrid}>
          {DAYS.map((d) => {
            const selected = availableDays.includes(d);
            return (
              <TouchableOpacity
                key={d}
                onPress={() => toggleDay(d)}
                activeOpacity={0.86}
                style={[styles.dayPill, selected ? styles.dayPillOn : null]}
              >
                <Text style={[styles.dayPillText, selected ? styles.dayPillTextOn : null]}>
                  {d}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {daysPerWeek ? (
          <Text style={[styles.hint, { marginTop: 10 }]}>
            {availableDays.length < daysPerWeek
              ? `Select ${daysPerWeek - availableDays.length} more to continue.`
              : "Perfect — we can build a clean weekly pattern."}
          </Text>
        ) : (
          <Text style={[styles.hint, { marginTop: 10 }]}>
            Choose runs per week first.
          </Text>
        )}

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>Preferred long run day (optional)</Text>
        <View style={styles.chipRow}>
          {availableDays
            .slice()
            .sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b))
            .map((d) => (
              <Chip
                key={d}
                label={d}
                active={longRunDay === d}
                onPress={() => setLongRunDay(d)}
              />
            ))}
          {!availableDays.length ? (
            <Text style={styles.hint}>Pick available days above.</Text>
          ) : null}
        </View>
      </Card>
    </>
  );

  const StepPrefs = () => (
    <>
      <SectionTitle
        title="Preferences"
        subtitle="These make the plan feel like it’s yours (and not generic)."
      />

      <Card>
        <Text style={styles.smallLabel}>Surfaces</Text>
        <View style={styles.chipRow}>
          {["Road", "Trail", "Treadmill", "Mix"].map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={surfacePref.includes(opt)}
              onPress={() => toggleArrayValue(surfacePref, opt, setSurfacePref)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Strength / gym access</Text>
        <View style={styles.chipRow}>
          {["Yes", "Limited", "No"].map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={strengthAccess === opt}
              onPress={() => setStrengthAccess(opt)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Cross-training</Text>
        <View style={styles.chipRow}>
          {["None", "Some", "A lot"].map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={crossTraining === opt}
              onPress={() => setCrossTraining(opt)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Injuries (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. Achilles tightness, knee niggle…"
          placeholderTextColor={MUTED_2}
          value={injuries}
          onChangeText={setInjuries}
          multiline
        />

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Constraints (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. avoid intervals Tuesdays, hate treadmills…"
          placeholderTextColor={MUTED_2}
          value={constraints}
          onChangeText={setConstraints}
          multiline
        />
      </Card>
    </>
  );

  const StepReview = () => (
    <>
      <SectionTitle
        title="Review"
        subtitle="If this looks right, we’ll save it and you can build a plan next."
      />

      <Card style={{ backgroundColor: CARD_2 }}>
        <View style={{ gap: 10 }}>
          <SummaryLine icon="target" label="Focus" value={prettyFocus(primaryFocus)} />
          <SummaryLine icon="user" label="Level" value={experienceLevel || "—"} />
          <SummaryLine icon="bar-chart-2" label="Weekly km" value={`${currentWeeklyKm || "—"} km`} />
          <SummaryLine icon="calendar" label="Runs / week" value={daysPerWeek ? `${daysPerWeek}x` : "—"} />
          <SummaryLine
            icon="check-circle"
            label="Days"
            value={availableDays.length ? availableDays.join(", ") : "—"}
          />
          <SummaryLine
            icon="trending-up"
            label="Long run"
            value={longRunDay ? DAY_LABELS[longRunDay] : "—"}
          />
          <SummaryLine icon="map" label="Surfaces" value={surfacePref.length ? surfacePref.join(", ") : "—"} />
          <SummaryLine icon="zap" label="Strength access" value={strengthAccess || "—"} />
          <SummaryLine icon="refresh-cw" label="Cross-training" value={crossTraining || "—"} />
        </View>

        {!isStepValid(0) || !isStepValid(1) || !isStepValid(2) ? (
          <Text style={[styles.hint, { marginTop: 12, color: DANGER }]}>
            Missing required: Focus, weekly km, runs/week + available days.
          </Text>
        ) : null}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>Next</Text>
        <Text style={styles.cardDesc}>
          We’ll save these preferences to your account. Next we can generate your plan (AI) using this exact profile.
        </Text>
      </Card>
    </>
  );

  function SummaryLine({ icon, label, value }) {
    return (
      <View style={styles.summaryLine}>
        <View style={styles.summaryLeft}>
          <Feather name={icon} size={16} color={PRIMARY} />
          <Text style={styles.summaryLabel}>{label}</Text>
        </View>
        <Text style={styles.summaryValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepFocus />;
      case 1:
        return <StepLevel />;
      case 2:
        return <StepSchedule />;
      case 3:
        return <StepPrefs />;
      case 4:
        return <StepReview />;
      default:
        return null;
    }
  };

  const footerLabel =
    step === STEPS.length - 1 ? (loading ? "Saving…" : "Save & continue") : "Continue";

  const footerDisabled =
    loading || (step === STEPS.length - 1 ? !isStepValid(0) || !isStepValid(1) || !isStepValid(2) : !canContinue);

  const footerHint = useMemo(() => {
    if (loading) return "Just a moment…";
    if (step === 0 && !primaryFocus) return "Choose a focus to continue.";
    if (step === 1 && !experienceLevel) return "Choose your current level.";
    if (step === 1 && !String(currentWeeklyKm).trim()) return "Weekly km is required.";
    if (step === 2 && !daysPerWeek) return "Pick runs per week.";
    if (step === 2 && daysPerWeek && availableDays.length < daysPerWeek)
      return `Select ${daysPerWeek - availableDays.length} more day(s).`;
    return "";
  }, [loading, step, primaryFocus, experienceLevel, currentWeeklyKm, daysPerWeek, availableDays.length]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <TopBar progress={progress} onBack={handleBack} onClose={handleClose} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.stepMeta}>
            <Text style={styles.stepKicker}>GENERAL FITNESS</Text>
            <Text style={styles.stepMini}>
              Step {step + 1} of {STEPS.length} · {STEPS[step]?.key}
            </Text>
          </View>

          {renderStep()}

          <View style={{ height: 140 }} />
        </ScrollView>

        <StickyFooter
          label={footerLabel}
          disabled={footerDisabled}
          onPress={step === STEPS.length - 1 ? handleSave : handleNext}
          hint={footerHint}
          leftLabel={step > 0 && !loading ? "Back" : null}
          onLeft={handleBack}
        />

        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <View style={styles.loadingPill}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Saving…</Text>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- helpers ---------------- */
function prettyFocus(v) {
  switch (v) {
    case "base":
      return "Build aerobic base";
    case "consistency":
      return "Consistency & routine";
    case "weight":
      return "Body comp / weight loss";
    case "feelgood":
      return "Feel-good fitness";
    default:
      return v || "—";
  }
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  safe: { flex: 1 },

  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },

  topBar: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: "rgba(230,255,59,0.85)",
  },

  stepMeta: { marginTop: 6, marginBottom: 6 },
  stepKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  stepMini: { marginTop: 4, color: MUTED_2, fontSize: 12, fontWeight: "700" },

  h1: {
    color: "white",
    fontSize: 32,
    letterSpacing: -0.3,
    fontWeight: "800",
  },
  sub: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },

  cardOption: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },

  cardSelected: {
    borderColor: "rgba(230,255,59,0.75)",
    shadowColor: PRIMARY,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },

  cardInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLeft: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    flex: 1,
  },
  cardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(230,255,59,0.06)",
    borderWidth: 1,
    borderColor: "rgba(230,255,59,0.12)",
  },
  cardTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.1,
  },
  cardDesc: {
    marginTop: 4,
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
  },

  smallLabel: {
    color: MUTED_2,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  microHint: {
    marginTop: 6,
    marginBottom: 8,
    color: MUTED_2,
    fontSize: 12,
    lineHeight: 16,
  },

  chipRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  pillSelected: {
    backgroundColor: "rgba(230,255,59,0.90)",
    borderColor: "rgba(230,255,59,0.90)",
  },
  pillText: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
  },
  pillTextSelected: { color: INK },

  input: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: "top",
  },

  dayGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  dayPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  dayPillOn: {
    backgroundColor: "rgba(230,255,59,0.90)",
    borderColor: "rgba(230,255,59,0.90)",
  },
  dayPillText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },
  dayPillTextOn: { color: INK },

  hint: {
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },

  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryLabel: { color: MUTED, fontSize: 13, fontWeight: "800" },
  summaryValue: { color: "white", fontSize: 13, fontWeight: "900", maxWidth: "55%" },

  footerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 10,
    backgroundColor: "rgba(5,5,6,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  footerInner: { gap: 10 },
  footerHint: { color: MUTED_2, fontSize: 12, fontWeight: "800" },

  primaryBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  primaryBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  primaryBtnText: {
    color: INK,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.1,
  },

  secondaryFooterBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flex: 1,
  },
  secondaryFooterBtnText: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
    opacity: 0.85,
  },

  loadingOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 82,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingPill: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(17,19,23,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  loadingText: { color: "white", fontSize: 13, fontWeight: "900" },
});
