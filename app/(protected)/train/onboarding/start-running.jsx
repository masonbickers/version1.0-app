// app/(protected)/train/onboarding/start-running.jsx
/**
 * TRAIN-R — Start Running Onboarding (Runna-style)
 * - Dedicated onboarding path for: Start running
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
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function nextMonday(from = new Date()) {
  const d = startOfDay(from);
  const day = d.getDay(); // 0 Sun, 1 Mon
  const diff = (8 - day) % 7 || 7;
  return addDays(d, diff);
}
function fmtShort(date) {
  try {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(date);
  }
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
export default function StartRunningOnboarding() {
  const router = useRouter();
  useTheme(); // keep hook; force dark

  const STEPS = useMemo(
    () => [
      { key: "startingPoint", title: "Starting point" },
      { key: "schedule", title: "Schedule" },
      { key: "preferences", title: "Preferences" },
      { key: "review", title: "Review" },
    ],
    []
  );

  const [step, setStep] = useState(0);
  const progress = useMemo(
    () => clamp((step + 1) / STEPS.length, 0.05, 1),
    [step, STEPS.length]
  );

  // --------- state
  const [startingPoint, setStartingPoint] = useState("true_beginner"); // true_beginner | can_jog | returning
  const [runWalkRatio, setRunWalkRatio] = useState("1:1"); // 30:30, 1:1, 2:1, 3:1
  const [sessionLength, setSessionLength] = useState(25); // mins
  const [comfortPace, setComfortPace] = useState("easy"); // easy | moderate

  const [daysPerWeek, setDaysPerWeek] = useState(null); // required
  const [availableDays, setAvailableDays] = useState([]); // >= daysPerWeek
  const [longRunDay, setLongRunDay] = useState(null);

  const [surfacePref, setSurfacePref] = useState(["Road"]);
  const [treadmillAccess, setTreadmillAccess] = useState("No"); // Yes/No
  const [gymAccess, setGymAccess] = useState("Limited"); // Yes/Limited/No
  const [injuries, setInjuries] = useState("");
  const [constraints, setConstraints] = useState("");

  const [loading, setLoading] = useState(false);

  const requiredDaysOk = useMemo(() => {
    if (!daysPerWeek) return false;
    return availableDays.length >= daysPerWeek;
  }, [availableDays.length, daysPerWeek]);

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

  const isStepValid = (s) => {
    switch (s) {
      case 0:
        return !!startingPoint && !!runWalkRatio && !!sessionLength;
      case 1:
        return !!daysPerWeek && requiredDaysOk;
      case 2:
        return true;
      case 3:
        return true;
      default:
        return true;
    }
  };

  const canContinue = useMemo(() => isStepValid(step), [
    step,
    startingPoint,
    runWalkRatio,
    sessionLength,
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
    const user = auth.currentUser;
    if (!user?.uid) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    if (!isStepValid(0) || !isStepValid(1)) {
      Alert.alert("Missing info", "Please complete the required fields.");
      return;
    }

    setLoading(true);
    try {
      const start = nextMonday(new Date());

      const payload = {
        onboardingPath: "start-running",
        goalType: "start",

        startRunning: {
          startingPoint, // true_beginner | can_jog | returning
          runWalkRatio, // e.g. 1:1
          sessionLengthMins: Number(sessionLength || 0),
          comfortPace, // easy|moderate
        },

        schedule: {
          daysPerWeek: Number(daysPerWeek || 0),
          availableDays,
          longRunDay: longRunDay || null,
          startDateISO: start ? start.toISOString() : null,
        },

        preferences: {
          surfacePref,
          treadmillAccess,
          gymAccess,
          injuries: injuries || "",
          constraints: constraints || "",
        },

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
      console.log("[start-running] save error:", e);
      Alert.alert("Couldn’t save", "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- step UIs ---------------- */
  const StepStartingPoint = () => (
    <>
      <SectionTitle
        title="Let’s start running"
        subtitle="We’ll build you up steadily with run/walk, then progress to continuous running."
      />

      <CardOption
        selected={startingPoint === "true_beginner"}
        onPress={() => setStartingPoint("true_beginner")}
        icon={<Feather name="play" size={18} color={PRIMARY} />}
        title="I’m brand new"
        desc="Starting from scratch. We’ll keep it very manageable."
      />
      <CardOption
        selected={startingPoint === "can_jog"}
        onPress={() => setStartingPoint("can_jog")}
        icon={<Feather name="activity" size={18} color={PRIMARY} />}
        title="I can jog a bit"
        desc="You can run short bursts, just need structure."
      />
      <CardOption
        selected={startingPoint === "returning"}
        onPress={() => setStartingPoint("returning")}
        icon={<Feather name="refresh-cw" size={18} color={PRIMARY} />}
        title="Returning after time off"
        desc="We’ll ramp you back up safely."
      />

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Run / walk ratio</Text>
        <Text style={styles.microHint}>Choose what feels doable on day one.</Text>
        <View style={styles.chipRow}>
          {["30:30", "1:1", "2:1", "3:1"].map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={runWalkRatio === opt}
              onPress={() => setRunWalkRatio(opt)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Session length</Text>
        <View style={styles.chipRow}>
          {[20, 25, 30, 35].map((m) => (
            <Chip
              key={m}
              label={`${m} min`}
              active={sessionLength === m}
              onPress={() => setSessionLength(m)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>How hard should “easy” feel?</Text>
        <View style={styles.chipRow}>
          <Chip
            label="Very easy"
            active={comfortPace === "easy"}
            onPress={() => setComfortPace("easy")}
          />
          <Chip
            label="Moderate"
            active={comfortPace === "moderate"}
            onPress={() => setComfortPace("moderate")}
          />
        </View>
      </Card>
    </>
  );

  const StepSchedule = () => (
    <>
      <SectionTitle
        title="Schedule"
        subtitle="Pick something realistic. Two to four days per week is perfect to begin."
      />

      <Card>
        <Text style={styles.smallLabel}>Runs per week *</Text>
        <View style={styles.chipRow}>
          {[2, 3, 4, 5].map((n) => (
            <Chip
              key={n}
              label={`${n}x`}
              active={daysPerWeek === n}
              onPress={() => {
                setDaysPerWeek(n);
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
              ? `Select ${daysPerWeek - availableDays.length} more day(s).`
              : "Nice — we’ll space sessions for recovery."}
          </Text>
        ) : (
          <Text style={[styles.hint, { marginTop: 10 }]}>Choose runs per week first.</Text>
        )}

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>Preferred longer session day (optional)</Text>
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
        </View>

        <Text style={styles.microHint}>
          We’ll keep this gentle early on — it’s about consistency, not smashing workouts.
        </Text>
      </Card>
    </>
  );

  const StepPreferences = () => (
    <>
      <SectionTitle
        title="Preferences"
        subtitle="Just enough detail to make the plan fit your life."
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

        <Text style={styles.smallLabel}>Treadmill access</Text>
        <View style={styles.chipRow}>
          <Chip
            label="Yes"
            active={treadmillAccess === "Yes"}
            onPress={() => setTreadmillAccess("Yes")}
          />
          <Chip
            label="No"
            active={treadmillAccess === "No"}
            onPress={() => setTreadmillAccess("No")}
          />
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Gym / strength access</Text>
        <View style={styles.chipRow}>
          <Chip label="Yes" active={gymAccess === "Yes"} onPress={() => setGymAccess("Yes")} />
          <Chip
            label="Limited"
            active={gymAccess === "Limited"}
            onPress={() => setGymAccess("Limited")}
          />
          <Chip label="No" active={gymAccess === "No"} onPress={() => setGymAccess("No")} />
        </View>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Injuries (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. shin splints history, sore knee…"
          placeholderTextColor={MUTED_2}
          value={injuries}
          onChangeText={setInjuries}
          multiline
        />

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Constraints (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. only mornings, avoid hills, busy weekends…"
          placeholderTextColor={MUTED_2}
          value={constraints}
          onChangeText={setConstraints}
          multiline
        />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>What your first weeks look like</Text>
        <Text style={styles.cardDesc}>
          Run/walk intervals, short easy sessions, gentle progress, and optional strength prompts if you’ve got gym access.
        </Text>
      </Card>
    </>
  );

  const StepReview = () => (
    <>
      <SectionTitle
        title="Review"
        subtitle="If it looks right, we’ll save it and you can generate the plan next."
      />

      <Card style={{ backgroundColor: CARD_2 }}>
        <View style={{ gap: 10 }}>
          <SummaryLine icon="play" label="Starting point" value={prettyStart(startingPoint)} />
          <SummaryLine icon="repeat" label="Run / walk" value={runWalkRatio} />
          <SummaryLine icon="clock" label="Session length" value={`${sessionLength} min`} />
          <SummaryLine icon="activity" label="Easy feel" value={comfortPace === "easy" ? "Very easy" : "Moderate"} />
          <SummaryLine icon="calendar" label="Runs / week" value={daysPerWeek ? `${daysPerWeek}x` : "—"} />
          <SummaryLine icon="check-circle" label="Days" value={availableDays.length ? availableDays.join(", ") : "—"} />
          <SummaryLine icon="trending-up" label="Longer day" value={longRunDay ? DAY_LABELS[longRunDay] : "—"} />
          <SummaryLine icon="map" label="Surfaces" value={surfacePref.length ? surfacePref.join(", ") : "—"} />
          <SummaryLine icon="monitor" label="Treadmill" value={treadmillAccess} />
          <SummaryLine icon="award" label="Gym access" value={gymAccess} />
        </View>

        {!isStepValid(0) || !isStepValid(1) ? (
          <Text style={[styles.hint, { marginTop: 12, color: DANGER }]}>
            Missing required: runs/week + selected days.
          </Text>
        ) : null}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>Next</Text>
        <Text style={styles.cardDesc}>
          We’ll save this profile to your account. Next step is generating a start-running plan using these settings.
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
        return <StepStartingPoint />;
      case 1:
        return <StepSchedule />;
      case 2:
        return <StepPreferences />;
      case 3:
        return <StepReview />;
      default:
        return null;
    }
  };

  const footerLabel =
    step === STEPS.length - 1 ? (loading ? "Saving…" : "Save & continue") : "Continue";

  const footerDisabled =
    loading ||
    (step === STEPS.length - 1
      ? !isStepValid(0) || !isStepValid(1)
      : !canContinue);

  const footerHint = useMemo(() => {
    if (loading) return "Just a moment…";
    if (step === 1 && !daysPerWeek) return "Pick runs per week.";
    if (step === 1 && daysPerWeek && availableDays.length < daysPerWeek)
      return `Select ${daysPerWeek - availableDays.length} more day(s).`;
    return "";
  }, [loading, step, daysPerWeek, availableDays.length]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: INK }]}>
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
            <Text style={styles.stepKicker}>START RUNNING</Text>
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
function prettyStart(s) {
  switch (s) {
    case "true_beginner":
      return "Brand new";
    case "can_jog":
      return "Can jog a bit";
    case "returning":
      return "Returning";
    default:
      return s;
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
