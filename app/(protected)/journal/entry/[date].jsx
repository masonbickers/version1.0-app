// app/(protected)/journal/entry/[date].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Timestamp, doc, getDoc } from "firebase/firestore";
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

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */

function formatPrettyDate(key) {
  if (!key) return "";
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTimeStamp(ts) {
  if (!ts) return "";
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------- main page ---------------- */

export default function JournalEntryDetailPage() {
  const router = useRouter();
  const { date } = useLocalSearchParams();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const user = auth.currentUser;

  const dateKey = useMemo(
    () => (typeof date === "string" ? date : ""),
    [date]
  );
  const prettyDate = formatPrettyDate(dateKey);

  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!user || !dateKey) {
        setLoading(false);
        return;
      }
      try {
        const ref = doc(
          db,
          "users",
          user.uid,
          "journalEntries",
          dateKey
        );
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setEntry(snap.data());
        } else {
          setEntry(null);
        }
      } catch (err) {
        console.error("Error loading journal entry detail", err);
        setEntry(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, dateKey]);

  const s = makeStyles(colors, isDark, accent);

  const onEdit = () =>
    router.push(`/journal/check-in?date=${encodeURIComponent(dateKey)}`);

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
            <Text style={s.headerTitle}>Check-in</Text>
            <Text style={s.headerSubtitle}>{prettyDate}</Text>
          </View>

          <TouchableOpacity
            onPress={onEdit}
            style={s.headerAction}
            activeOpacity={0.9}
            disabled={loading}
          >
            <Feather
              name="edit-3"
              size={16}
              color={colors.sapOnPrimary}
            />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator />
            <Text style={s.loadingText}>
              Loading your check-in…
            </Text>
          </View>
        ) : !entry ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTitle}>No check-in saved</Text>
            <Text style={s.emptyBody}>
              You haven’t logged anything for this day yet.
            </Text>
            <TouchableOpacity
              style={s.emptyBtn}
              onPress={onEdit}
              activeOpacity={0.9}
            >
              <Feather
                name="edit-3"
                size={16}
                color={colors.sapOnPrimary}
              />
              <Text style={s.emptyBtnText}>
                Add check-in for this day
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Morning block */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Morning</Text>

              <View style={s.card}>
                <Row
                  label="Sleep"
                  value={
                    typeof entry.sleepHours === "number"
                      ? `${entry.sleepHours} h`
                      : "—"
                  }
                  colors={colors}
                />
                <Row
                  label="Sleep quality"
                  value={
                    typeof entry.sleepQuality === "number"
                      ? `${entry.sleepQuality}/5`
                      : "—"
                  }
                  colors={colors}
                />
                <Row
                  label="Mood"
                  value={
                    typeof entry.mood === "number"
                      ? `${entry.mood}/5`
                      : "—"
                  }
                  colors={colors}
                />
                <Row
                  label="Stress"
                  value={
                    typeof entry.stress === "number"
                      ? `${entry.stress}/5`
                      : "—"
                  }
                  colors={colors}
                />

                {typeof entry.energy === "number" && (
                  <Row
                    label="Energy"
                    value={`${entry.energy}/5`}
                    colors={colors}
                  />
                )}

                <View style={s.divider} />

                <Text style={s.fieldLabel}>Last night</Text>
                <View style={s.toggleRow}>
                  <Pill
                    label="Alcohol"
                    active={!!entry.alcohol}
                    colors={colors}
                  />
                  <Pill
                    label="Late meal"
                    active={!!entry.lateMeal}
                    colors={colors}
                  />
                  <Pill
                    label="Night shoot / screens"
                    active={!!entry.nightShoot}
                    colors={colors}
                  />
                </View>
              </View>
            </View>

            {/* Today / training */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Today</Text>

              <View style={s.card}>
                <Text style={s.fieldLabel}>Training</Text>
                <View style={s.toggleRow}>
                  <Pill
                    label="Trained"
                    active={!!entry.trainedToday}
                    colors={colors}
                  />
                  <Pill
                    label="Stuck to plan"
                    active={!!entry.stuckToPlan}
                    colors={colors}
                  />
                </View>

                <View style={s.rowBetween}>
                  <Text style={[s.fieldLabel, { marginTop: 10 }]}>
                    Hardest session RPE
                  </Text>
                  <Text style={[s.fieldValue, { marginTop: 10 }]}>
                    {typeof entry.sessionRpe === "number"
                      ? `${entry.sessionRpe}/10`
                      : "—"}
                  </Text>
                </View>

                {typeof entry.sorenessScore === "number" && (
                  <Row
                    label="Body soreness"
                    value={`${entry.sorenessScore}/5`}
                    colors={colors}
                  />
                )}
              </View>
            </View>

            {/* Notes */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Notes</Text>

              <View style={s.card}>
                {entry.eveningNote && entry.eveningNote.trim() ? (
                  <Text style={s.noteText}>{entry.eveningNote}</Text>
                ) : (
                  <Text style={s.notePlaceholder}>
                    No notes logged for this day.
                  </Text>
                )}
              </View>
            </View>

            {entry.updatedAt && (
              <Text style={s.updatedText}>
                Last updated {formatTimeStamp(entry.updatedAt)}
              </Text>
            )}

            {/* edit CTA at bottom */}
            <View style={s.bottomRow}>
              <TouchableOpacity
                style={s.bottomBtn}
                onPress={onEdit}
                activeOpacity={0.9}
              >
                <Feather
                  name="edit-3"
                  size={16}
                  color={colors.sapOnPrimary}
                />
                <Text style={s.bottomBtnText}>Edit this check-in</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

/* ---------------- small components ---------------- */

function Row({ label, value, colors }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 8,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: colors.text,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 12,
          color: colors.subtext,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function Pill({ label, active, colors }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active
          ? colors.sapPrimary
          : colors.sapSilverMedium || colors.border,
        backgroundColor: active ? colors.sapPrimary : "#00000000",
        marginRight: 8,
        marginTop: 6,
      }}
    >
      {active && (
        <Feather
          name="check"
          size={12}
          color={colors.sapOnPrimary}
          style={{ marginRight: 4 }}
        />
      )}
      <Text
        style={{
          fontSize: 12,
          fontWeight: "700",
          color: active ? colors.sapOnPrimary : colors.subtext,
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

    section: {
      marginTop: 16,
      marginBottom: 4,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },

    updatedText: {
      fontSize: 11,
      color: colors.subtext,
      marginTop: 10,
      textAlign: "left",
    },

    card: {
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
    },

    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
      marginTop: 6,
    },
    fieldValue: {
      fontSize: 12,
      color: colors.subtext,
    },

    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.sapSilverMedium || colors.border,
      marginVertical: 10,
    },

    toggleRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginTop: 4,
    },

    noteText: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 19,
    },
    notePlaceholder: {
      fontSize: 13,
      color: colors.subtext,
      fontStyle: "italic",
    },

    bottomRow: {
      marginTop: 18,
      marginBottom: 8,
      alignItems: "flex-start",
    },
    bottomBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: accent,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      ...Platform.select({
        android: { elevation: 3 },
      }),
    },
    bottomBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.sapOnPrimary,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },

    emptyWrap: {
      flex: 1,
      paddingHorizontal: 24,
      justifyContent: "center",
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 6,
      textAlign: "center",
    },
    emptyBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 19,
      textAlign: "center",
    },
    emptyBtn: {
      marginTop: 16,
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: accent,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      ...Platform.select({
        android: { elevation: 3 },
      }),
    },
    emptyBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.sapOnPrimary,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
  });
}
