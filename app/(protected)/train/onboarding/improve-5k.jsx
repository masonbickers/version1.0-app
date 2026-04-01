// app/(protected)/train/onboarding/improve-5k.jsx
/**
 * TRAIN-R — Improve 5K Onboarding (Runna-style)
 * - Dedicated onboarding path for: Improve my 5K
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
export default function Improve5KOnboarding() {
  const router = useRouter();
  useTheme(); // keep hook; force dark

  const STEPS = useMemo(
    () => [
      { key: "goal", title: "Your 5K goal" },
      { key: "baseline", title: "Baseline" },
      { key: "schedule", title: "Weekly schedule" },
      { key: "focus", title: "Focus & prefs" },
      { key: "review", title: "Review & save" },
    ],
    []
  );

  const [step, setStep] = useState(0);
  const progress = useMemo(
    () => clamp((step + 1) / STEPS.length, 0.05, 1),
    [step, STEPS.length]
  );

  // --------- state
  const [goalType, setGoalType] = useState("pb"); // pb | time | fitness
  const [targetTime, setTargetTime] = useState(""); // optional unless goalType === time
  const [raceDateMode, setRaceDateMode] = useState("no_date"); // no_date | in_mind
  const [raceDate, setRaceDate] = useState(null); // optional
  const [planLengthWeeks, setPlanLengthWeeks] = useState(8); // if no date

  const [current5k, setCurrent5k] = useState(""); // optional but recommended
  const [recent10k, setRecent10k] = useState("");
  const [weeklyKm, setWeeklyKm] = useState(""); // required
  const [longestRunKm, setLongestRunKm] = useState("");

  const [daysPerWeek, setDaysPerWeek] = useState(null); // required
  const [availableDays, setAvailableDays] = useState([]); // >= daysPerWeek
  const [qualityDays, setQualityDays] = useState(2); // 1 or 2 typically
  const [longRunDay, setLongRunDay] = useState(null);

  const [focusAreas, setFocusAreas] = useState(["Speed"]); // Speed/Threshold/Endurance/Strength/Pacing
  const [surfacePref, setSurfacePref] = useState(["Road"]);
  const [gymAccess, setGymAccess] = useState("Yes"); // Yes/Limited/No
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
      case 0: {
        const needsTarget = goalType === "time";
        const hasTarget = !needsTarget || !!targetTime.trim();
        const hasLength = raceDateMode === "no_date" ? !!planLengthWeeks : true;
        return hasTarget && hasLength;
      }
      case 1:
        return String(weeklyKm).trim().length > 0; // allow 0 but realistically should be >0; still allow 0
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
    goalType,
    targetTime,
    raceDateMode,
    planLengthWeeks,
    weeklyKm,
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

    if (!isStepValid(0) || !isStepValid(1) || !isStepValid(2)) {
      Alert.alert("Missing info", "Please complete the required fields.");
      return;
    }

    setLoading(true);
    try {
      const start = nextMonday(new Date());

      const payload = {
        onboardingPath: "improve-5k",
        goalType: "5k_pb",

        fiveKGoal: {
          type: goalType, // pb|time|fitness
          targetTime: targetTime.trim() || null,
          hasRaceDate: raceDateMode === "in_mind",
          raceDateISO: raceDate ? startOfDay(raceDate).toISOString() : null,
          planLengthWeeks: raceDateMode === "no_date" ? planLengthWeeks : null,
        },

        baseline: {
          current5k: current5k || "",
          recent10k: recent10k || "",
          weeklyKm: String(weeklyKm || "").trim(),
          longestRunKm: String(longestRunKm || "").trim(),
        },

        schedule: {
          daysPerWeek: Number(daysPerWeek || 0),
          availableDays,
          qualityDays, // 1 or 2 (normally)
          longRunDay: longRunDay || null,
          startDateISO: start ? start.toISOString() : null,
        },

        preferences: {
          focusAreas,
          surfacePref,
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
      console.log("[improve-5k] save error:", e);
      Alert.alert("Couldn’t save", "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- step UIs ---------------- */
  const StepGoal = () => (
    <>
      <SectionTitle
        title="Improve your 5K"
        subtitle="Set a direction. We’ll build speed + endurance without frying you."
      />

      <CardOption
        selected={goalType === "pb"}
        onPress={() => setGoalType("pb")}
        icon={<Feather name="zap" size={18} color={PRIMARY} />}
        title="PB focus"
        desc="Train for a faster 5K without locking in a time goal."
      />
      <CardOption
        selected={goalType === "time"}
        onPress={() => setGoalType("time")}
        icon={<Feather name="clock" size={18} color={PRIMARY} />}
        title="Time goal"
        desc="I want to hit a specific 5K time."
      />
      <CardOption
        selected={goalType === "fitness"}
        onPress={() => setGoalType("fitness")}
        icon={<Feather name="activity" size={18} color={PRIMARY} />}
        title="Better fitness"
        desc="Get sharper, stronger, and more consistent."
      />

      {goalType === "time" ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.smallLabel}>Target 5K time *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 19:30"
            placeholderTextColor={MUTED_2}
            value={targetTime}
            onChangeText={setTargetTime}
          />
          <Text style={styles.microHint}>Format: mm:ss (we’ll refine later)</Text>
        </Card>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Do you have a date in mind?</Text>
        <View style={styles.chipRow}>
          <Chip
            label="No fixed date"
            active={raceDateMode === "no_date"}
            onPress={() => {
              setRaceDateMode("no_date");
              setRaceDate(null);
            }}
          />
          <Chip
            label="Yes, I’ve got a date"
            active={raceDateMode === "in_mind"}
            onPress={() => setRaceDateMode("in_mind")}
          />
        </View>

        {raceDateMode === "no_date" ? (
          <>
            <View style={{ height: 12 }} />
            <Text style={styles.smallLabel}>Plan length</Text>
            <Text style={styles.microHint}>No date? Choose a cycle length.</Text>
            <View style={styles.chipRow}>
              {[6, 8, 10, 12].map((w) => (
                <Chip
                  key={w}
                  label={`${w} weeks`}
                  active={planLengthWeeks === w}
                  onPress={() => setPlanLengthWeeks(w)}
                />
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={{ height: 12 }} />
            <Text style={styles.smallLabel}>Race date (optional for now)</Text>
            <View style={styles.chipRow}>
              <Chip
                label={raceDate ? fmtShort(startOfDay(raceDate)) : "Set later"}
                active={!!raceDate}
                onPress={() => {
                  // keep simple: quick picks
                  setRaceDate(addDays(startOfDay(new Date()), 28));
                }}
              />
              <Chip
                label="In 6 weeks"
                active={raceDate ? startOfDay(raceDate).getTime() === addDays(startOfDay(new Date()), 42).getTime() : false}
                onPress={() => setRaceDate(addDays(startOfDay(new Date()), 42))}
              />
              <Chip
                label="In 8 weeks"
                active={raceDate ? startOfDay(raceDate).getTime() === addDays(startOfDay(new Date()), 56).getTime() : false}
                onPress={() => setRaceDate(addDays(startOfDay(new Date()), 56))}
              />
            </View>
            <Text style={styles.microHint}>
              If you want a full date picker here, say and I’ll add it like your main onboarding flow.
            </Text>
          </>
        )}
      </Card>
    </>
  );

  const StepBaseline = () => (
    <>
      <SectionTitle
        title="Baseline"
        subtitle="Weekly km is the key. Times help tune paces (optional)."
      />

      <Card>
        <Text style={styles.smallLabel}>Current weekly distance *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 20"
          placeholderTextColor={MUTED_2}
          keyboardType="numeric"
          value={weeklyKm}
          onChangeText={setWeeklyKm}
        />
        <Text style={styles.microHint}>km per week (put 0 if you’re starting back)</Text>

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Longest run (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 10"
          placeholderTextColor={MUTED_2}
          keyboardType="numeric"
          value={longestRunKm}
          onChangeText={setLongestRunKm}
        />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.smallLabel}>Recent times (optional)</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>5K</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 21:10"
              placeholderTextColor={MUTED_2}
              value={current5k}
              onChangeText={setCurrent5k}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.miniLabel}>10K</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 44:00"
              placeholderTextColor={MUTED_2}
              value={recent10k}
              onChangeText={setRecent10k}
            />
          </View>
        </View>
      </Card>
    </>
  );

  const StepSchedule = () => (
    <>
      <SectionTitle
        title="Weekly schedule"
        subtitle="We’ll place 1–2 quality sessions + easy running around your life."
      />

      <Card>
        <Text style={styles.smallLabel}>Runs per week *</Text>
        <View style={styles.chipRow}>
          {[3, 4, 5, 6].map((n) => (
            <Chip
              key={n}
              label={`${n}x`}
              active={daysPerWeek === n}
              onPress={() => {
                setDaysPerWeek(n);
                setAvailableDays((prev) => (prev.length > n ? prev.slice(0, n) : prev));
                if (qualityDays > 2) setQualityDays(2);
                if (n <= 3) setQualityDays(1);
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
              : "Perfect — we can space sessions out."}
          </Text>
        ) : (
          <Text style={[styles.hint, { marginTop: 10 }]}>Choose runs per week first.</Text>
        )}

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>Quality sessions per week</Text>
        <View style={styles.chipRow}>
          <Chip
            label="1 quality"
            active={qualityDays === 1}
            onPress={() => setQualityDays(1)}
          />
          <Chip
            label="2 quality"
            active={qualityDays === 2}
            onPress={() => setQualityDays(2)}
          />
        </View>
        <Text style={styles.microHint}>
          Quality = intervals/tempo. The rest is easy running + strides.
        </Text>

        <View style={{ height: 14 }} />

        <Text style={styles.smallLabel}>Long run day (optional)</Text>
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
      </Card>
    </>
  );

  const StepFocus = () => (
    <>
      <SectionTitle
        title="Focus & preferences"
        subtitle="Pick what you want to improve most. We’ll bias the sessions accordingly."
      />

      <Card>
        <Text style={styles.smallLabel}>Focus areas</Text>
        <View style={styles.chipRow}>
          {["Speed", "Threshold", "Endurance", "Pacing", "Strength"].map((opt) => (
            <Chip
              key={opt}
              label={opt}
              active={focusAreas.includes(opt)}
              onPress={() => toggleArrayValue(focusAreas, opt, setFocusAreas)}
            />
          ))}
        </View>

        <View style={{ height: 12 }} />

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
          placeholder="e.g. Achilles niggle, shin splints history…"
          placeholderTextColor={MUTED_2}
          value={injuries}
          onChangeText={setInjuries}
          multiline
        />

        <View style={{ height: 12 }} />

        <Text style={styles.smallLabel}>Constraints (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="e.g. no track access, avoid hills Tuesdays, only treadmill…"
          placeholderTextColor={MUTED_2}
          value={constraints}
          onChangeText={setConstraints}
          multiline
        />
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>What you’ll see in your plan</Text>
        <Text style={styles.cardDesc}>
          Intervals + tempo (based on your quality choice), easy mileage, strides, and a controlled long run.
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
          <SummaryLine icon="zap" label="Goal" value={prettyGoal(goalType, targetTime)} />
          <SummaryLine
            icon="calendar"
            label="Timing"
            value={
              raceDateMode === "in_mind"
                ? raceDate
                  ? `Race on ${fmtShort(startOfDay(raceDate))}`
                  : "Date in mind (not set)"
                : `${planLengthWeeks} week cycle`
            }
          />
          <SummaryLine icon="bar-chart-2" label="Weekly km" value={`${weeklyKm || "—"} km`} />
          <SummaryLine icon="trending-up" label="Longest run" value={longestRunKm ? `${longestRunKm} km` : "—"} />
          <SummaryLine icon="clock" label="Current 5K" value={current5k || "—"} />
          <SummaryLine icon="calendar" label="Runs / week" value={daysPerWeek ? `${daysPerWeek}x` : "—"} />
          <SummaryLine icon="check-circle" label="Days" value={availableDays.length ? availableDays.join(", ") : "—"} />
          <SummaryLine icon="target" label="Quality / week" value={`${qualityDays}x`} />
          <SummaryLine icon="map" label="Surfaces" value={surfacePref.length ? surfacePref.join(", ") : "—"} />
          <SummaryLine icon="award" label="Focus" value={focusAreas.length ? focusAreas.join(", ") : "—"} />
          <SummaryLine icon="activity" label="Gym access" value={gymAccess} />
          <SummaryLine icon="trending-up" label="Long run" value={longRunDay ? DAY_LABELS[longRunDay] : "—"} />
        </View>

        {!isStepValid(0) || !isStepValid(1) || !isStepValid(2) ? (
          <Text style={[styles.hint, { marginTop: 12, color: DANGER }]}>
            Missing required: weekly km, runs/week + days, and target time (if chosen).
          </Text>
        ) : null}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>Next</Text>
        <Text style={styles.cardDesc}>
          We’ll save this profile to your account. Next step is generating the 5K plan using these exact settings.
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
        return <StepGoal />;
      case 1:
        return <StepBaseline />;
      case 2:
        return <StepSchedule />;
      case 3:
        return <StepFocus />;
      case 4:
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
      ? !isStepValid(0) || !isStepValid(1) || !isStepValid(2)
      : !canContinue);

  const footerHint = useMemo(() => {
    if (loading) return "Just a moment…";
    if (step === 0 && goalType === "time" && !targetTime.trim()) return "Add your target time to continue.";
    if (step === 1 && !String(weeklyKm).trim()) return "Weekly km is required (0 is fine).";
    if (step === 2 && !daysPerWeek) return "Pick runs per week.";
    if (step === 2 && daysPerWeek && availableDays.length < daysPerWeek)
      return `Select ${daysPerWeek - availableDays.length} more day(s).`;
    return "";
  }, [loading, step, goalType, targetTime, weeklyKm, daysPerWeek, availableDays.length]);

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
            <Text style={styles.stepKicker}>IMPROVE 5K</Text>
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
function prettyGoal(goalType, targetTime) {
  if (goalType === "pb") return "PB focus";
  if (goalType === "fitness") return "Better fitness";
  if (goalType === "time") return targetTime ? `Time goal · ${targetTime}` : "Time goal";
  return "Improve 5K";
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
  miniLabel: {
    marginBottom: 6,
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
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
