// app/(protected)/journal/insights.jsx

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
    Timestamp,
    collection,
    getDocs,
    orderBy,
    query,
    where,
} from "firebase/firestore";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- small date helpers ---------------- */

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}

/* ---------------- streak helper ---------------- */

function computeStreak(daysSet) {
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = daysAgo(i);
    const key = d.toISOString().slice(0, 10);
    if (daysSet.has(key)) streak += 1;
    else break;
  }
  return streak;
}

export default function JournalInsightsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [streak, setStreak] = useState(0);
  const [daysLogged30, setDaysLogged30] = useState(0);
  const [avgMood, setAvgMood] = useState(null);
  const [avgSleep, setAvgSleep] = useState(null);
  const [miniSeries, setMiniSeries] = useState([]); // last 7 days yes/no

  const user = auth.currentUser;

  useEffect(() => {
    const run = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);

        const since30 = startOfDay(daysAgo(29));
        const entriesRef = collection(db, "users", user.uid, "journalEntries");
        const qEntries = query(
          entriesRef,
          where("date", ">=", Timestamp.fromDate(since30)),
          orderBy("date", "desc")
        );

        const snap = await getDocs(qEntries);
        const list = [];
        const daysSet = new Set();

        let moodSum = 0;
        let moodCount = 0;
        let sleepSum = 0;
        let sleepCount = 0;

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          let d = data.date;
          if (!d) return;
          if (typeof d.toDate === "function") d = d.toDate();
          else d = new Date(d);

          const key = d.toISOString().slice(0, 10);
          daysSet.add(key);

          const mood = data.moodScore; // 1–5
          if (typeof mood === "number" && Number.isFinite(mood)) {
            moodSum += mood;
            moodCount += 1;
          }

          const sleep = data.sleepHours; // 0–24
          if (typeof sleep === "number" && Number.isFinite(sleep)) {
            sleepSum += sleep;
            sleepCount += 1;
          }

          list.push({
            id: docSnap.id,
            date: d,
            mood,
            sleep,
          });
        });

        setEntries(list);
        setDaysLogged30(daysSet.size);
        setStreak(computeStreak(daysSet));
        setAvgMood(moodCount ? moodSum / moodCount : null);
        setAvgSleep(sleepCount ? sleepSum / sleepCount : null);

        // last 7 days completion series
        const last7 = [];
        for (let i = 6; i >= 0; i--) {
          const d = daysAgo(i);
          const key = d.toISOString().slice(0, 10);
          last7.push({
            label: d.toLocaleDateString("en-GB", { weekday: "short" }),
            hasEntry: daysSet.has(key),
          });
        }
        setMiniSeries(last7);
      } catch (e) {
        console.error("Journal insights error", e);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [user]);

  // simple grading based on streak + average mood
  let grade = "C";
  let summary =
    "Logging is a bit on/off. Aim for a few more consistent check-ins.";

  if (streak >= 10 && (avgMood || 0) >= 3.5) {
    grade = "A";
    summary =
      "Strong streak and solid mood scores. Keep doing what you’re doing.";
  } else if (streak >= 5) {
    grade = "B";
    summary =
      "Good consistency. Lock in a daily habit to unlock deeper insights.";
  }

  const s = makeStyles(colors, isDark);

  const hasEntries = entries.length > 0;

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right", "bottom"]}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={s.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.iconButton}
            activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Journal insights</Text>
          <View style={{ width: 32, height: 32 }} />
        </View>

        <Text style={s.headerSub}>
          High-level view of your mood, recovery and habits from your daily
          check-ins.
        </Text>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
          </View>
        ) : !hasEntries ? (
          <>
            <View style={s.emptyCard}>
              <Text style={s.emptyTitle}>No insights yet</Text>
              <Text style={s.emptyBody}>
                Start logging a quick journal check-in each day to unlock mood
                and recovery insights.
              </Text>
            </View>

            <TouchableOpacity
              style={s.primaryBtn}
              onPress={() => router.push("/journal/check-in")}
              activeOpacity={0.9}
            >
              <Feather
                name="edit-3"
                size={16}
                color={colors.sapOnPrimary || "#000"}
              />
              <Text style={s.primaryBtnText}>Start today’s check-in</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.ghostBtn}
              onPress={() => router.push("/journal/setup")}
              activeOpacity={0.9}
            >
              <Feather name="sliders" size={16} color={colors.subtext} />
              <Text style={s.ghostBtnText}>Edit questions</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* GRADE CARD */}
            <View style={s.gradeCard}>
              <View style={s.gradeBadge}>
                <Text style={s.gradeText}>{grade}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.gradeTitle}>Overall journal signal</Text>
                <Text style={s.gradeBody}>{summary}</Text>
              </View>
            </View>

            {/* STATS ROW */}
            <View style={s.statsRow}>
              <StatPill
                icon="sun"
                label="Check-in streak"
                value={streak ? `${streak} days` : "--"}
                colors={colors}
              />
              <StatPill
                icon="calendar"
                label="Logged (30d)"
                value={`${daysLogged30} days`}
                colors={colors}
              />
            </View>

            <View style={s.statsRow}>
              <StatPill
                icon="smile"
                label="Avg mood"
                value={
                  avgMood ? avgMood.toFixed(1).toString() + " / 5" : "--"
                }
                colors={colors}
              />
              <StatPill
                icon="moon"
                label="Avg sleep"
                value={
                  avgSleep ? avgSleep.toFixed(1).toString() + " h" : "--"
                }
                colors={colors}
              />
            </View>

            {/* MINI COMPLETION GRAPH */}
            {miniSeries.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Last 7 days</Text>
                <Text style={s.sectionHint}>
                  Each bar shows whether you completed a check-in that day.
                </Text>

                <View style={s.miniRow}>
                  {miniSeries.map((d) => (
                    <View key={d.label} style={s.miniCol}>
                      <View style={s.miniTrack}>
                        <View
                          style={[
                            s.miniFill,
                            !d.hasEntry && s.miniFillOff,
                          ]}
                        />
                      </View>
                      <Text style={s.miniLabel}>{d.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ACTIONS */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Next steps</Text>
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={() => router.push("/journal/check-in")}
                activeOpacity={0.9}
              >
                <Feather
                  name="edit-3"
                  size={16}
                  color={colors.sapOnPrimary || "#000"}
                />
                <Text style={s.primaryBtnText}>Do today’s check-in</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.ghostBtn}
                onPress={() => router.push("/journal/history")}
                activeOpacity={0.9}
              >
                <Feather name="clock" size={16} color={colors.subtext} />
                <Text style={s.ghostBtnText}>View journal history</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.ghostBtn}
                onPress={() => router.push("/journal/setup")}
                activeOpacity={0.9}
              >
                <Feather name="sliders" size={16} color={colors.subtext} />
                <Text style={s.ghostBtnText}>Edit questions</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------------ small pill component ------------ */

function StatPill({ icon, label, value, colors }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.sapSilverLight || "#F3F4F6",
        borderRadius: 16,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.sapSilverMedium || "#E1E3E8",
        marginRight: 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: colors.sapPrimary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather
            name={icon}
            size={12}
            color={colors.sapOnPrimary || "#000"}
          />
        </View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: "600",
            color: colors.subtext,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 16,
          fontWeight: "800",
          color: colors.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg || "#050505",
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 18,
      paddingBottom: 80,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 4,
      marginBottom: 6,
    },
    iconButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#111217" : "#E5E7EB",
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
    },
    headerSub: {
      fontSize: 13,
      color: colors.subtext,
      marginBottom: 14,
    },
    loadingWrap: {
      paddingVertical: 30,
      alignItems: "center",
    },

    emptyCard: {
      marginTop: 10,
      padding: 14,
      borderRadius: 18,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || "#E1E3E8",
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 4,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },

    primaryBtn: {
      marginTop: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.sapPrimary,
    },
    primaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      color: colors.sapOnPrimary || "#000",
    },
    ghostBtn: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || "#E1E3E8",
      backgroundColor: isDark ? "#050505" : "#FFFFFF",
    },
    ghostBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.subtext,
    },

    gradeCard: {
      marginTop: 14,
      padding: 14,
      borderRadius: 18,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || "#E1E3E8",
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    gradeBadge: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.sapPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    gradeText: {
      fontSize: 20,
      fontWeight: "800",
      color: colors.sapOnPrimary || "#000",
    },
    gradeTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 2,
    },
    gradeBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },

    statsRow: {
      flexDirection: "row",
      marginTop: 12,
      marginBottom: 4,
    },

    section: {
      marginTop: 18,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    sectionHint: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 4,
    },

    miniRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 6,
      marginTop: 10,
    },
    miniCol: {
      flex: 1,
      alignItems: "center",
    },
    miniTrack: {
      width: "100%",
      height: 34,
      borderRadius: 999,
      backgroundColor: isDark ? "#18191E" : "#E5E7EB",
      overflow: "hidden",
      justifyContent: "flex-end",
    },
    miniFill: {
      width: "100%",
      height: "100%",
      backgroundColor: colors.sapPrimary,
    },
    miniFillOff: {
      opacity: 0.25,
    },
    miniLabel: {
      marginTop: 4,
      fontSize: 10,
      color: colors.subtext,
    },
  });
}
