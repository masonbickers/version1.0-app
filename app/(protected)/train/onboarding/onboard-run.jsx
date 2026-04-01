// app/(protected)/train/onboarding/index.jsx
/**
 * TRAIN-R — Plan Onboarding (unique, Runna-quality flow)
 * - Full-screen, dark, premium cards
 * - Neon Yellow accent (#E6FF3B)
 * - Multi-step wizard + progress bar
 * - Saves onboarding prefs to Firestore (users/{uid}/planPrefs/current)
 *
 * Notes:
 * - This does NOT generate the AI plan yet (we’ll build that after).
 * - Adjust the final router.replace(...) destination to wherever you want.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
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
  const day = d.getDay(); // 0 Sun, 1 Mon ...
  const diff = (8 - day) % 7 || 7;
  return addDays(d, diff);
}

function fmtShort(date) {
  // e.g. Mon, 15 Dec 2025
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

function SectionTitle({ title, subtitle, rightHelp }) {
  return (
    <View style={{ marginTop: 14, marginBottom: 10 }}>
      <View style={styles.titleRow}>
        <Text style={styles.h1}>{title}</Text>
        {rightHelp ? <View style={{ marginLeft: 10 }}>{rightHelp}</View> : null}
      </View>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
    </View>
  );
}

function CardOption({ icon, title, desc, selected, onPress, right }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[
        styles.card,
        selected ? styles.cardSelected : null,
      ]}
    >
      <View style={styles.cardInner}>
        <View style={styles.cardLeft}>
          {icon ? (
            <View style={styles.cardIconWrap}>
              {icon}
            </View>
          ) : null}

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

function Pill({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[
        styles.pill,
        selected ? styles.pillSelected : null,
      ]}
    >
      <Text style={[styles.pillText, selected ? styles.pillTextSelected : null]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function StickyFooter({ label, disabled, onPress, secondaryLabel, onSecondary }) {
  return (
    <View style={styles.footerWrap}>
      <View style={styles.footerInner}>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          disabled={disabled}
          style={[styles.primaryBtn, disabled ? styles.primaryBtnDisabled : null]}
        >
          <Text style={[styles.primaryBtnText, disabled ? { opacity: 0.55 } : null]}>
            {label}
          </Text>
        </TouchableOpacity>

        {secondaryLabel ? (
          <TouchableOpacity
            onPress={onSecondary}
            activeOpacity={0.85}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/* ---------------- screen ---------------- */
export default function PlanOnboarding() {
  const router = useRouter();
  const { isDark } = useTheme();

  // keep app feel: always dark for onboarding
  const bg = INK;

  const [step, setStep] = useState(0);

  // answers
  const [goal, setGoal] = useState(null); // string
  const [ability, setAbility] = useState(null); // beginner/intermediate/advanced/elite
  const [runDaysPerWeek, setRunDaysPerWeek] = useState(null); // number
  const [availableDays, setAvailableDays] = useState([]); // ["Tue","Thu",...]
  const [longRunDay, setLongRunDay] = useState(null); // "Sun"
  const [startDate, setStartDate] = useState(null); // Date
  const [gender, setGender] = useState(null); // "male" | "female" | "nonbinary" | "nosay"
  const [volume, setVolume] = useState("steady"); // steady/progressive/ambitious
  const [difficulty, setDifficulty] = useState("balanced"); // balanced/challenging/confident

  const totalSteps = 8;

  const progress = useMemo(() => {
    return clamp((step + 1) / totalSteps, 0.05, 1);
  }, [step]);

  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return !!goal;
      case 1:
        return !!ability;
      case 2:
        return !!runDaysPerWeek;
      case 3:
        return availableDays.length >= (runDaysPerWeek || 0);
      case 4:
        return !!longRunDay;
      case 5:
        return !!startDate;
      case 6:
        // gender optional (can continue even if null)
        return true;
      case 7:
        return true;
      default:
        return false;
    }
  }, [step, goal, ability, runDaysPerWeek, availableDays, longRunDay, startDate]);

  const handleBack = () => {
    if (step === 0) return router.back();
    setStep((s) => Math.max(0, s - 1));
  };

  const handleClose = () => {
    Alert.alert("Leave setup?", "You can finish this later from Plan Setup.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const handleNext = async () => {
    if (!canContinue) return;

    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
      return;
    }

    // final step -> save prefs (no AI generation yet)
    try {
      const user = auth.currentUser;
      if (!user) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      const payload = {
        goal,
        ability,
        runDaysPerWeek,
        availableDays,
        longRunDay,
        startDateISO: startDate ? startOfDay(startDate).toISOString() : null,
        gender: gender || null,
        trainingVolume: volume,
        trainingDifficulty: difficulty,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        platform: Platform.OS,
      };

      await setDoc(
        doc(db, "users", user.uid, "planPrefs", "current"),
        payload,
        { merge: true }
      );

      // send user somewhere sensible (change this to your plan preview screen)
      router.replace("/(protected)/train");
    } catch (e) {
      console.log("onboarding save error:", e);
      Alert.alert("Couldn’t save", "Please try again.");
    }
  };

  /* ---------- step renderers ---------- */
  const StepGoal = () => (
    <>
      <SectionTitle
        title="What are you training towards?"
        subtitle="Pick the option that matches what you want right now. You can change it later."
      />

      <CardOption
        selected={goal === "race"}
        onPress={() => setGoal("race")}
        icon={<Feather name="flag" size={18} color={PRIMARY} />}
        title="A race date"
        desc="You’ve got an event in mind and want structured prep."
      />
      <CardOption
        selected={goal === "distance"}
        onPress={() => setGoal("distance")}
        icon={<Feather name="map" size={18} color={PRIMARY} />}
        title="A specific distance"
        desc="Build towards 5K, 10K, half marathon and beyond."
      />
      <CardOption
        selected={goal === "start"}
        onPress={() => setGoal("start")}
        icon={<Feather name="play" size={18} color={PRIMARY} />}
        title="Start running"
        desc="Ease in with confidence and consistency."
      />
      <CardOption
        selected={goal === "return"}
        onPress={() => setGoal("return")}
        icon={<Feather name="refresh-cw" size={18} color={PRIMARY} />}
        title="Get back into it"
        desc="A smart ramp-up after time off."
      />
      <CardOption
        selected={goal === "5k_pb"}
        onPress={() => setGoal("5k_pb")}
        icon={<Feather name="zap" size={18} color={PRIMARY} />}
        title="Improve my 5K"
        desc="Sharpen speed and pacing with quality sessions."
      />
      <CardOption
        selected={goal === "general"}
        onPress={() => setGoal("general")}
        icon={<Feather name="activity" size={18} color={PRIMARY} />}
        title="General fitness"
        desc="A balanced plan that keeps you progressing."
      />
    </>
  );

  const StepAbility = () => (
    <>
      <SectionTitle
        title="How would you rate your running right now?"
        subtitle="This helps us choose the right session mix and recovery."
        rightHelp={
          <View style={styles.helpBubble}>
            <Feather name="help-circle" size={18} color="white" />
          </View>
        }
      />

      <CardOption
        selected={ability === "beginner"}
        onPress={() => setAbility("beginner")}
        icon={<Feather name="circle" size={18} color={PRIMARY} />}
        title="Starter"
        desc="Comfortable running short distances, building consistency."
      />
      <CardOption
        selected={ability === "intermediate"}
        onPress={() => setAbility("intermediate")}
        icon={<Feather name="circle" size={18} color={PRIMARY} />}
        title="Improver"
        desc="You run most weeks and want a clearer structure."
      />
      <CardOption
        selected={ability === "advanced"}
        onPress={() => setAbility("advanced")}
        icon={<Feather name="circle" size={18} color={PRIMARY} />}
        title="Advanced"
        desc="You do longer runs and some faster sessions."
      />
      <CardOption
        selected={ability === "elite"}
        onPress={() => setAbility("elite")}
        icon={<Feather name="circle" size={18} color={PRIMARY} />}
        title="Performance"
        desc="You train consistently with structured workouts."
        right={
          <View style={styles.badge}>
            <Text style={styles.badgeText}>High volume</Text>
          </View>
        }
      />
    </>
  );

  const StepRunDays = () => (
    <>
      <SectionTitle
        title="How many running days per week?"
        subtitle="Choose something sustainable — consistency beats big weeks."
      />

      {[2, 3, 4, 5, 6, 7].map((n) => (
        <CardOption
          key={n}
          selected={runDaysPerWeek === n}
          onPress={() => {
            setRunDaysPerWeek(n);
            // reset day selections if now impossible
            setAvailableDays((prev) => prev.slice(0, n));
            if (longRunDay && !availableDays.includes(longRunDay)) setLongRunDay(null);
          }}
          title={`${n} days`}
          desc={
            n <= 3
              ? "Low stress, easy to fit in."
              : n === 4
              ? "Great balance of progress + recovery."
              : n === 5
              ? "Strong weekly rhythm with variety."
              : n === 6
              ? "High frequency — keep easy days easy."
              : "Daily running — advanced consistency."
          }
          icon={<Feather name="calendar" size={18} color={PRIMARY} />}
        />
      ))}
    </>
  );

  const StepAvailableDays = () => {
    const required = runDaysPerWeek || 0;

    const toggle = (d) => {
      setAvailableDays((prev) => {
        const has = prev.includes(d);
        if (has) {
          // if removing long-run day, clear
          if (longRunDay === d) setLongRunDay(null);
          return prev.filter((x) => x !== d);
        }
        return [...prev, d];
      });
    };

    return (
      <>
        <SectionTitle
          title="Which days can you run?"
          subtitle={
            required
              ? `Pick at least ${required} day${required === 1 ? "" : "s"} so we can schedule sessions smartly.`
              : "Pick the days that suit you."
          }
        />

        {DAYS.map((d) => {
          const selected = availableDays.includes(d);
          return (
            <CardOption
              key={d}
              selected={selected}
              onPress={() => toggle(d)}
              title={DAY_LABELS[d]}
              desc={selected ? "Selected" : ""}
              icon={
                <View style={[styles.checkCircle, selected ? styles.checkCircleOn : null]}>
                  {selected ? <Feather name="check" size={16} color={INK} /> : null}
                </View>
              }
            />
          );
        })}

        {required ? (
          <Text style={[styles.hint, { marginTop: 8 }]}>
            {availableDays.length < required
              ? `Select ${required - availableDays.length} more to continue.`
              : "Nice — we can build a clean weekly pattern."}
          </Text>
        ) : null}
      </>
    );
  };

  const StepLongRun = () => (
    <>
      <SectionTitle
        title="Long run day?"
        subtitle="We’ll place your longest session on the day that suits your life."
      />

      {availableDays.length === 0 ? (
        <Text style={styles.hint}>Pick your available days first.</Text>
      ) : (
        availableDays
          .slice()
          .sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b))
          .map((d) => (
            <CardOption
              key={d}
              selected={longRunDay === d}
              onPress={() => setLongRunDay(d)}
              title={DAY_LABELS[d]}
              icon={<Feather name="trending-up" size={18} color={PRIMARY} />}
              desc="Primary long run slot"
            />
          ))
      )}
    </>
  );

  const StepStartDate = () => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const mon = nextMonday(today);

    const options = [
      { key: "today", label: "Today", date: today, note: "Start immediately" },
      { key: "tomorrow", label: "Tomorrow", date: tomorrow, note: "A fresh start" },
      { key: "monday", label: "Next Monday", date: mon, note: "Clean week reset" },
    ];

    return (
      <>
        <SectionTitle
          title="When do you want to start?"
          subtitle="Pick a start that fits your schedule. You can adjust it later."
        />

        <View style={styles.card}>
          <View style={{ padding: 14 }}>
            <Text style={styles.smallLabel}>Quick picks</Text>

            <View style={styles.pillRow}>
              {options.map((o) => (
                <Pill
                  key={o.key}
                  label={o.label}
                  selected={startDate && startOfDay(startDate).getTime() === o.date.getTime()}
                  onPress={() => setStartDate(o.date)}
                />
              ))}
            </View>

            <Text style={[styles.hint, { marginTop: 10 }]}>
              {startDate ? `Selected: ${fmtShort(startOfDay(startDate))}` : "Choose one to continue."}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { marginTop: 12 }]}>
          <View style={{ padding: 14 }}>
            <Text style={styles.cardTitle}>Prefer a custom start?</Text>
            <Text style={styles.cardDesc}>
              For now, we’ll keep it simple. If you want a custom date picker next, say the word and I’ll add it.
            </Text>
          </View>
        </View>
      </>
    );
  };

  const StepGender = () => (
    <>
      <SectionTitle
        title="Anything you want to share?"
        subtitle="Optional — this can help tailor guidance. You can skip."
      />

      <CardOption
        selected={gender === "female"}
        onPress={() => setGender("female")}
        title="Female"
        icon={<Feather name="user" size={18} color={PRIMARY} />}
      />
      <CardOption
        selected={gender === "male"}
        onPress={() => setGender("male")}
        title="Male"
        icon={<Feather name="user" size={18} color={PRIMARY} />}
      />
      <CardOption
        selected={gender === "nonbinary"}
        onPress={() => setGender("nonbinary")}
        title="Non-binary"
        icon={<Feather name="users" size={18} color={PRIMARY} />}
      />
      <CardOption
        selected={gender === "nosay"}
        onPress={() => setGender("nosay")}
        title="Prefer not to say"
        icon={<Feather name="eye-off" size={18} color={PRIMARY} />}
      />

      <Text style={[styles.hint, { marginTop: 10 }]}>
        We never show this on your public profile.
      </Text>
    </>
  );

  const StepPreferences = () => (
    <>
      <SectionTitle
        title="Training preferences"
        subtitle="These shape how the plan ramps up and how hard sessions feel."
      />

      <View style={styles.prefCard}>
        <View style={styles.prefRow}>
          <View style={styles.prefLeft}>
            <View style={styles.prefIcon}>
              <Feather name="bar-chart-2" size={18} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefTitle}>Training volume</Text>
              <Text style={styles.prefDesc}>How quickly we build mileage + workload.</Text>
            </View>
          </View>

          <View style={styles.prefPills}>
            <Pill
              label="Steady"
              selected={volume === "steady"}
              onPress={() => setVolume("steady")}
            />
            <Pill
              label="Progressive"
              selected={volume === "progressive"}
              onPress={() => setVolume("progressive")}
            />
            <Pill
              label="Ambitious"
              selected={volume === "ambitious"}
              onPress={() => setVolume("ambitious")}
            />
          </View>
        </View>

        <View style={styles.prefDivider} />

        <View style={styles.prefRow}>
          <View style={styles.prefLeft}>
            <View style={styles.prefIcon}>
              <Feather name="target" size={18} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.prefTitle}>Session difficulty</Text>
              <Text style={styles.prefDesc}>Balance between easy days and harder efforts.</Text>
            </View>
          </View>

          <View style={styles.prefPills}>
            <Pill
              label="Balanced"
              selected={difficulty === "balanced"}
              onPress={() => setDifficulty("balanced")}
            />
            <Pill
              label="Challenging"
              selected={difficulty === "challenging"}
              onPress={() => setDifficulty("challenging")}
            />
            <Pill
              label="Confident"
              selected={difficulty === "confident"}
              onPress={() => setDifficulty("confident")}
            />
          </View>
        </View>
      </View>

      <View style={[styles.card, { marginTop: 12 }]}>
        <View style={{ padding: 14 }}>
          <Text style={styles.cardTitle}>Review</Text>

          <View style={{ marginTop: 10, gap: 8 }}>
            <SummaryLine icon="compass" label="Focus" value={goal ? prettyGoal(goal) : "—"} />
            <SummaryLine icon="activity" label="Level" value={ability ? prettyAbility(ability) : "—"} />
            <SummaryLine icon="calendar" label="Runs / week" value={runDaysPerWeek ? String(runDaysPerWeek) : "—"} />
            <SummaryLine
              icon="check-circle"
              label="Available"
              value={availableDays.length ? availableDays.map((d) => d).join(", ") : "—"}
            />
            <SummaryLine
              icon="trending-up"
              label="Long run"
              value={longRunDay ? DAY_LABELS[longRunDay] : "—"}
            />
            <SummaryLine
              icon="play"
              label="Start"
              value={startDate ? fmtShort(startOfDay(startDate)) : "—"}
            />
            <SummaryLine icon="bar-chart-2" label="Volume" value={prettyVolume(volume)} />
            <SummaryLine icon="target" label="Difficulty" value={prettyDiff(difficulty)} />
          </View>

          <Text style={[styles.hint, { marginTop: 12 }]}>
            Next: we’ll generate your plan using these preferences.
          </Text>
        </View>
      </View>
    </>
  );

  function SummaryLine({ icon, label, value }) {
    return (
      <View style={styles.summaryLine}>
        <View style={styles.summaryLeft}>
          <Feather name={icon} size={16} color={PRIMARY} />
          <Text style={styles.summaryLabel}>{label}</Text>
        </View>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
    );
  }

  const renderStep = () => {
    switch (step) {
      case 0:
        return <StepGoal />;
      case 1:
        return <StepAbility />;
      case 2:
        return <StepRunDays />;
      case 3:
        return <StepAvailableDays />;
      case 4:
        return <StepLongRun />;
      case 5:
        return <StepStartDate />;
      case 6:
        return <StepGender />;
      case 7:
        return <StepPreferences />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <TopBar progress={progress} onBack={handleBack} onClose={handleClose} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderStep()}
        <View style={{ height: 120 }} />
      </ScrollView>

      <StickyFooter
        label={step === totalSteps - 1 ? "Save & continue" : "Continue"}
        disabled={!canContinue}
        onPress={handleNext}
        secondaryLabel={step === 6 ? "Skip for now" : null}
        onSecondary={() => {
          setGender(null);
          handleNext();
        }}
      />
    </SafeAreaView>
  );
}

/* ---------------- helpers for copy ---------------- */
function prettyGoal(g) {
  switch (g) {
    case "race":
      return "Race preparation";
    case "distance":
      return "Distance goal";
    case "start":
      return "Start running";
    case "return":
      return "Return to running";
    case "5k_pb":
      return "5K improvement";
    case "general":
      return "General fitness";
    default:
      return g;
  }
}
function prettyAbility(a) {
  switch (a) {
    case "beginner":
      return "Starter";
    case "intermediate":
      return "Improver";
    case "advanced":
      return "Advanced";
    case "elite":
      return "Performance";
    default:
      return a;
  }
}
function prettyVolume(v) {
  switch (v) {
    case "steady":
      return "Steady";
    case "progressive":
      return "Progressive";
    case "ambitious":
      return "Ambitious";
    default:
      return v;
  }
}
function prettyDiff(d) {
  switch (d) {
    case "balanced":
      return "Balanced";
    case "challenging":
      return "Challenging";
    case "confident":
      return "Confident";
    default:
      return d;
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

  titleRow: { flexDirection: "row", alignItems: "center" },
  h1: {
    color: "white",
    fontSize: 32,
    letterSpacing: -0.3,
    fontWeight: "800",
    flex: 1,
  },
  sub: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },

  helpBubble: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  card: {
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

  hint: {
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
  },

  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleOn: {
    borderColor: "rgba(230,255,59,0.85)",
    backgroundColor: "rgba(230,255,59,0.85)",
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: "rgba(230,255,59,0.10)",
    borderWidth: 1,
    borderColor: "rgba(230,255,59,0.18)",
  },
  badgeText: {
    color: "rgba(230,255,59,0.95)",
    fontSize: 12,
    fontWeight: "800",
  },

  smallLabel: {
    color: MUTED_2,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  pillRow: {
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
  pillTextSelected: {
    color: INK,
  },

  prefCard: {
    backgroundColor: CARD_2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 10,
  },
  prefRow: { gap: 10 },
  prefLeft: { flexDirection: "row", gap: 12, alignItems: "center" },
  prefIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(230,255,59,0.06)",
    borderWidth: 1,
    borderColor: "rgba(230,255,59,0.12)",
  },
  prefTitle: { color: "white", fontSize: 15, fontWeight: "900" },
  prefDesc: { marginTop: 3, color: MUTED_2, fontSize: 13, lineHeight: 18 },
  prefPills: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  prefDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 14,
  },

  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryLabel: { color: MUTED, fontSize: 13, fontWeight: "800" },
  summaryValue: { color: "white", fontSize: 13, fontWeight: "800" },

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

  secondaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "800",
    opacity: 0.75,
  },
});
