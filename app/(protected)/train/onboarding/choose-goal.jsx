import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

const PRIMARY = "#E6FF3B";
const INK = "#050506";
const CARD = "#111317";
const BORDER = "rgba(255,255,255,0.10)";
const MUTED = "rgba(255,255,255,0.70)";
const MUTED_2 = "rgba(255,255,255,0.45)";

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

function StickyFooter({ disabled, onPress }) {
  return (
    <View style={styles.footerWrap}>
      <View style={styles.footerInner}>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          disabled={disabled}
          style={[
            styles.primaryBtn,
            disabled ? styles.primaryBtnDisabled : null,
          ]}
        >
          <Text style={[styles.primaryBtnText, disabled ? { opacity: 0.55 } : null]}>
            Continue
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function OptionCard({ icon, title, desc, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={[styles.option, selected ? styles.optionSelected : null]}
    >
      <View style={styles.optionRow}>
        <View style={styles.iconWrap}>
          <Feather name={icon} size={18} color={PRIMARY} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionDesc}>{desc}</Text>
        </View>

        <View style={styles.rightTick}>
          {selected ? (
            <View style={styles.tickDot}>
              <Feather name="check" size={14} color={INK} />
            </View>
          ) : (
            <View style={styles.tickEmpty} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ChooseGoalPathScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState(null);

  const progress = 0.12; // first step vibe

  const options = useMemo(
    () => [
      {
        key: "raceDate",
        icon: "flag",
        title: "A race date",
        desc: "You’ve got an event in mind and want structured prep.",
      },
      {
        key: "distance",
        icon: "map",
        title: "A specific distance",
        desc: "Build towards 5K, 10K, half marathon and beyond.",
      },
      {
        key: "startRunning",
        icon: "play",
        title: "Start running",
        desc: "Ease in with confidence and consistency.",
      },
      {
        key: "getBackIntoIt",
        icon: "refresh-ccw",
        title: "Get back into it",
        desc: "A smart ramp-up after time off.",
      },
      {
        key: "improve5k",
        icon: "zap",
        title: "Improve my 5K",
        desc: "Sharpen speed and pacing with quality sessions.",
      },
      {
        key: "generalFitness",
        icon: "activity",
        title: "General fitness",
        desc: "A balanced plan that keeps you progressing.",
      },
    ],
    []
  );

  const onClose = () => router.back();
  const onBack = () => router.back();

  const goNext = () => {
    if (!selected) return;

    // ✅ send into your combined onboarding with a goalPath
    // (we’ll make the combined screen respond to this param in the next section)
    const autoOpenRaceDate = selected === "raceDate" ? "1" : "0";

    router.push({
      pathname: "/(protected)/train/onboarding",
      params: {
        goalPath: selected,
        autoOpenRaceDate,
      },
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: INK }]}>
      <TopBar progress={progress} onBack={onBack} onClose={onClose} />

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
          {options.map((opt) => (
            <OptionCard
              key={opt.key}
              icon={opt.icon}
              title={opt.title}
              desc={opt.desc}
              selected={selected === opt.key}
              onPress={() => setSelected(opt.key)}
            />
          ))}
        </View>

        <View style={{ height: 140 }} />
      </ScrollView>

      <StickyFooter disabled={!selected} onPress={goNext} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

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

  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },

  h1: {
    color: "white",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 8,
  },
  sub: {
    marginTop: 10,
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
  },

  option: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 12,
  },
  optionSelected: {
    borderColor: "rgba(230,255,59,0.75)",
    shadowColor: PRIMARY,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(230,255,59,0.06)",
    borderWidth: 1,
    borderColor: "rgba(230,255,59,0.12)",
  },
  optionTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.1,
  },
  optionDesc: {
    marginTop: 4,
    color: MUTED_2,
    fontSize: 13,
    lineHeight: 18,
  },

  rightTick: { width: 30, alignItems: "flex-end" },
  tickEmpty: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tickDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "rgba(230,255,59,0.95)",
    alignItems: "center",
    justifyContent: "center",
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
  footerInner: { gap: 10 },

  primaryBtn: {
    height: 58,
    borderRadius: 18,
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
