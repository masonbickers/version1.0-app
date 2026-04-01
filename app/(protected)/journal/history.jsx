// app/(protected)/journal/history.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
    Timestamp,
    collection,
    getDocs,
    limit,
    orderBy,
    query,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */

function keyFromTimestamp(ts) {
  if (!ts) return null;
  let d;
  if (ts instanceof Timestamp) d = ts.toDate();
  else d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function formatListDate(d) {
  if (!d) return "";
  const date =
    d instanceof Date ? d : new Date(d.seconds ? d.seconds * 1000 : d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function monthLabel(d) {
  if (!d) return "";
  const date =
    d instanceof Date ? d : new Date(d.seconds ? d.seconds * 1000 : d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function daysBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  return Math.round((d1 - d2) / (24 * 60 * 60 * 1000));
}

/* ---------------- component ---------------- */

export default function JournalHistoryPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");

  // fetch last ~60 entries
  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        setError("");
        const ref = collection(db, "users", user.uid, "journalEntries");
        const q = query(ref, orderBy("date", "desc"), limit(60));
        const snap = await getDocs(q);

        const list = snap.docs.map((docSnap) => {
          const data = docSnap.data();
          const date = data.date || null;
          const dateKey = data.dateKey || keyFromTimestamp(date) || docSnap.id;
          return {
            id: docSnap.id,
            date,
            dateKey,
            mood: data.mood ?? null,
            energy: data.energy ?? null,
            stress: data.stress ?? null,
            sleepHours: data.sleepHours ?? null,
            sleepQuality: data.sleepQuality ?? null,
            trainedToday: !!data.trainedToday,
            sessionRpe: data.sessionRpe ?? null,
            sorenessScore: data.sorenessScore ?? null,
            eveningNote: data.eveningNote || "",
          };
        });

        setEntries(list);
      } catch (err) {
        console.error("Error loading journal history", err);
        setError("Couldn't load your journal history.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  /* --------- summary metrics (7-day view + streak) --------- */

  const summary = useMemo(() => {
    if (!entries.length) {
      return {
        streak: 0,
        last7Completed: 0,
        avgMood: null,
        avgEnergy: null,
      };
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const keys = new Set(entries.map((e) => e.dateKey));

    // streak from today backwards
    let streak = 0;
    for (let offset = 0; offset < 365; offset++) {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      const key = d.toISOString().slice(0, 10);
      if (keys.has(key)) streak += 1;
      else break;
    }

    // last 7 days completed + avg mood / energy
    let last7Completed = 0;
    let moodSum = 0;
    let moodCount = 0;
    let energySum = 0;
    let energyCount = 0;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    entries.forEach((e) => {
      if (!e.date) return;
      const d =
        e.date instanceof Timestamp ? e.date.toDate() : new Date(e.date);
      if (Number.isNaN(d.getTime())) return;

      if (d >= sevenDaysAgo) {
        last7Completed += 1;
        if (typeof e.mood === "number") {
          moodSum += e.mood;
          moodCount += 1;
        }
        if (typeof e.energy === "number") {
          energySum += e.energy;
          energyCount += 1;
        }
      }
    });

    return {
      streak,
      last7Completed,
      avgMood: moodCount ? moodSum / moodCount : null,
      avgEnergy: energyCount ? energySum / energyCount : null,
    };
  }, [entries]);

  const s = makeStyles(colors, isDark, accent);

  const renderStatCard = (label, value, sub) => (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );

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
            <Text style={s.headerTitle}>Journal history</Text>
            <Text style={s.headerSubtitle}>
              See past check-ins and patterns.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/journal/check-in")}
            style={s.headerAction}
            activeOpacity={0.9}
          >
            <Feather
              name="plus"
              size={16}
              color={colors.sapOnPrimary}
            />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
            <Text style={s.loadingText}>
              Loading your journal history…
            </Text>
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* summary row */}
            <View style={s.summaryRow}>
              {renderStatCard(
                "Streak",
                `${summary.streak}d`,
                summary.streak
                  ? "Consecutive days logged"
                  : "Start today"
              )}
              {renderStatCard(
                "Last 7 days",
                `${summary.last7Completed}/7`,
                "Entries in last week"
              )}
              {renderStatCard(
                "Avg mood",
                summary.avgMood
                  ? `${summary.avgMood.toFixed(1)}/5`
                  : "--",
                "Last 7 days"
              )}
            </View>

            {error ? (
              <Text style={s.errorText}>{error}</Text>
            ) : null}

            {/* empty state */}
            {!entries.length && !loading ? (
              <View style={s.emptyWrap}>
                <Text style={s.emptyTitle}>No entries yet</Text>
                <Text style={s.emptyBody}>
                  Your daily check-ins will appear here. Start with a quick
                  check-in for today.
                </Text>
                <TouchableOpacity
                  style={s.emptyBtn}
                  onPress={() => router.push("/journal/check-in")}
                  activeOpacity={0.9}
                >
                  <Feather
                    name="edit-3"
                    size={16}
                    color={colors.sapOnPrimary}
                  />
                  <Text style={s.emptyBtnText}>Start today’s check-in</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* list */}
            {entries.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {entries.map((entry, idx) => {
                  const date = entry.date
                    ? entry.date instanceof Timestamp
                      ? entry.date.toDate()
                      : new Date(entry.date)
                    : null;
                  const thisMonth = monthLabel(date);
                  const prevMonth =
                    idx > 0
                      ? monthLabel(
                          entries[idx - 1].date instanceof Timestamp
                            ? entries[idx - 1].date.toDate()
                            : entries[idx - 1].date
                        )
                      : null;

                  const showMonthHeader =
                    !prevMonth || prevMonth !== thisMonth;

                  const hasNote =
                    entry.eveningNote && entry.eveningNote.trim().length > 0;

                  return (
                    <View key={entry.id}>
                      {showMonthHeader && (
                        <Text style={s.monthHeader}>{thisMonth}</Text>
                      )}

                      <TouchableOpacity
                        style={s.row}
                        activeOpacity={0.85}
                        onPress={() =>
                          router.push(
                            `/journal/entry/${entry.dateKey}`
                          )
                        }
                      >
                        <View style={s.rowLeft}>
                          <Text style={s.rowDate}>
                            {formatListDate(date)}
                          </Text>
                          <View style={s.rowTags}>
                            {typeof entry.mood === "number" && (
                              <TagChip
                                icon="smile"
                                label={`Mood ${entry.mood}/5`}
                                colors={colors}
                              />
                            )}
                            {typeof entry.energy === "number" && (
                              <TagChip
                                icon="zap"
                                label={`Energy ${entry.energy}/5`}
                                colors={colors}
                              />
                            )}
                            {typeof entry.sleepHours === "number" && (
                              <TagChip
                                icon="moon"
                                label={`${entry.sleepHours}h sleep`}
                                colors={colors}
                              />
                            )}
                            {entry.trainedToday && (
                              <TagChip
                                icon="activity"
                                label={
                                  entry.sessionRpe
                                    ? `Trained · RPE ${entry.sessionRpe}`
                                    : "Trained"
                                }
                                colors={colors}
                              />
                            )}
                          </View>
                        </View>

                        <View style={s.rowRight}>
                          {hasNote && (
                            <Feather
                              name="message-circle"
                              size={16}
                              color={colors.subtext}
                              style={{ marginBottom: 4 }}
                            />
                          )}
                          <Feather
                            name="chevron-right"
                            size={18}
                            color={colors.subtext}
                          />
                        </View>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ---------------- small components ---------------- */

function TagChip({ icon, label, colors }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: colors.sapSilverLight || "#F3F4F6",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.sapSilverMedium || "#E1E3E8",
        marginRight: 6,
        marginTop: 4,
      }}
    >
      <Feather
        name={icon}
        size={11}
        color={colors.subtext}
        style={{ marginRight: 4 }}
      />
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: colors.subtext,
        }}
      >
        {label}
      </Text>
    </View>
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
    headerAction: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      ...Platform.select({
        android: { elevation: 3 },
      }),
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

    summaryRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 10,
      marginBottom: 8,
    },
    statCard: {
      flex: 1,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 10,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
    },
    statValue: {
      fontSize: 16,
      fontWeight: "800",
      color: colors.text,
    },
    statLabel: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },
    statSub: {
      fontSize: 11,
      color: colors.subtext,
      marginTop: 4,
    },

    errorText: {
      marginTop: 8,
      fontSize: 12,
      color: colors.danger || "#EF4444",
    },

    emptyWrap: {
      marginTop: 24,
      paddingHorizontal: 10,
      paddingVertical: 14,
      borderRadius: 18,
      backgroundColor: isDark ? "#111217" : "#F9FAFB",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
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
    emptyBtn: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: accent,
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      ...Platform.select({
        android: { elevation: 2 },
      }),
    },
    emptyBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.sapOnPrimary,
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },

    monthHeader: {
      marginTop: 16,
      marginBottom: 4,
      fontSize: 12,
      fontWeight: "700",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },

    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      marginBottom: 8,
    },
    rowLeft: {
      flex: 1,
    },
    rowDate: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    rowTags: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 4,
    },
    rowRight: {
      alignItems: "flex-end",
      justifyContent: "center",
      marginLeft: 8,
    },
  });
}
