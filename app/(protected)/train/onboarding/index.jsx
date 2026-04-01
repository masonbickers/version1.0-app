// app/(protected)/train/onboarding/index.jsx
/**
 * TRAIN-R — Onboarding entry (Runna-style goal picker)
 * - Matches the screenshot: single screen, premium cards, sticky CTA
 * - Each option routes to its own dedicated onboarding path
 *
 * Routes (create these screens):
 *  - /onboarding/race-date
 *  - /onboarding/distance   ✅ (we made this)
 *  - /onboarding/start-running
 *  - /onboarding/get-back-into-it
 *  - /onboarding/improve-5k
 *  - /onboarding/general-fitness
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
    Alert,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { useTheme } from "../../../../providers/ThemeProvider";

/* ---------------- tokens ---------------- */
const PRIMARY = "#E6FF3B";
const INK = "#050506";
const CARD = "#111317";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.70)";
const MUTED_2 = "rgba(255,255,255,0.45)";

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

function CardOption({ icon, title, desc, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={[styles.cardOption, selected ? styles.cardSelected : null]}
    >
      <View style={styles.cardInner}>
        <View style={styles.cardLeft}>
          <View style={styles.cardIconWrap}>{icon}</View>

          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{title}</Text>
            {desc ? <Text style={styles.cardDesc}>{desc}</Text> : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function StickyFooter({ label, disabled, onPress }) {
  return (
    <View style={styles.footerWrap}>
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
    </View>
  );
}

/* ---------------- screen ---------------- */
export default function PlanOnboardingIndex() {
  const router = useRouter();
  useTheme(); // keep hook to stay consistent with app
  const bg = INK;

  const [selected, setSelected] = useState(null);

  // Runna-style: this is an early step, so progress is small
  const progress = useMemo(() => 0.12, []);

  const handleClose = () => {
    Alert.alert("Leave setup?", "You can come back and finish this later.", [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const handleContinue = () => {
    if (!selected) return;

    const routes = {
      race: "/(protected)/train/onboarding/race-date",
      distance: "/(protected)/train/onboarding/distance",
      start: "/(protected)/train/onboarding/start-running",
      return: "/(protected)/train/onboarding/get-back-into-it",
      improve5k: "/(protected)/train/onboarding/improve-5k",
      general: "/(protected)/train/onboarding/general-fitness",
    };

    const target = routes[selected];
    if (!target) return;

    router.push(target);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <TopBar progress={progress} onBack={() => router.back()} onClose={handleClose} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.h1}>What are you training towards?</Text>
        <Text style={styles.sub}>
          Pick the option that matches what you want right now. You can change it later.
        </Text>

        <View style={{ marginTop: 14 }}>
          <CardOption
            selected={selected === "race"}
            onPress={() => setSelected("race")}
            icon={<Feather name="flag" size={18} color={PRIMARY} />}
            title="A race date"
            desc="You’ve got an event in mind and want structured prep."
          />

          <CardOption
            selected={selected === "distance"}
            onPress={() => setSelected("distance")}
            icon={<Feather name="map" size={18} color={PRIMARY} />}
            title="A specific distance"
            desc="Build towards 5K, 10K, half marathon and beyond."
          />

          <CardOption
            selected={selected === "start"}
            onPress={() => setSelected("start")}
            icon={<Feather name="play" size={18} color={PRIMARY} />}
            title="Start running"
            desc="Ease in with confidence and consistency."
          />

          <CardOption
            selected={selected === "return"}
            onPress={() => setSelected("return")}
            icon={<Feather name="refresh-cw" size={18} color={PRIMARY} />}
            title="Get back into it"
            desc="A smart ramp-up after time off."
          />

          <CardOption
            selected={selected === "improve5k"}
            onPress={() => setSelected("improve5k")}
            icon={<Feather name="zap" size={18} color={PRIMARY} />}
            title="Improve my 5K"
            desc="Sharpen speed and pacing with quality sessions."
          />

          <CardOption
            selected={selected === "general"}
            onPress={() => setSelected("general")}
            icon={<Feather name="activity" size={18} color={PRIMARY} />}
            title="General fitness"
            desc="A balanced plan that keeps you progressing."
          />
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <StickyFooter label="Continue" disabled={!selected} onPress={handleContinue} />
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  safe: { flex: 1 },

  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
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

  h1: {
    color: "white",
    fontSize: 34,
    letterSpacing: -0.4,
    fontWeight: "900",
    marginTop: 6,
  },
  sub: {
    marginTop: 10,
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },

  cardOption: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 12,
  },
  cardSelected: {
    borderColor: "rgba(230,255,59,0.75)",
    shadowColor: PRIMARY,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  cardInner: { flexDirection: "row", alignItems: "center" },
  cardLeft: { flexDirection: "row", gap: 12, alignItems: "center", flex: 1 },
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
    fontWeight: "900",
    letterSpacing: -0.1,
  },
  cardDesc: {
    marginTop: 4,
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
  },

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
});
