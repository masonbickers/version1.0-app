// app/(protected)/journal/setting.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
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

export default function JournalSettingPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // settings that sit on top of the basic journal setup
  const [morningReminderOn, setMorningReminderOn] = useState(false);
  const [eveningReminderOn, setEveningReminderOn] = useState(true);
  const [showOnYouPage, setShowOnYouPage] = useState(true);
  const [includeTradingContext, setIncludeTradingContext] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const js = data.journalSettings || {};

          if (js.reminders) {
            if (typeof js.reminders.morningOn === "boolean") {
              setMorningReminderOn(js.reminders.morningOn);
            }
            if (typeof js.reminders.eveningOn === "boolean") {
              setEveningReminderOn(js.reminders.eveningOn);
            }
          }

          if (typeof js.showOnYouPage === "boolean") {
            setShowOnYouPage(js.showOnYouPage);
          }
          if (typeof js.includeTradingContext === "boolean") {
            setIncludeTradingContext(js.includeTradingContext);
          }
        }
      } catch (err) {
        console.error("Error loading journal settings", err);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [user]);

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Sign in again to update journal settings.");
      return;
    }
    try {
      setSaving(true);
      const ref = doc(db, "users", user.uid);

      await setDoc(
        ref,
        {
          journalSettings: {
            // we only touch these keys; other keys (enabled, focus, notesHint)
            // from /journal/setup are preserved because of merge: true
            reminders: {
              morningOn: morningReminderOn,
              eveningOn: eveningReminderOn,
            },
            showOnYouPage,
            includeTradingContext,
            updatedAt: new Date().toISOString(),
          },
        },
        { merge: true }
      );

      Alert.alert("Saved", "Journal settings updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error("Error saving journal settings", err);
      Alert.alert(
        "Error",
        "Couldn't save your journal settings. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const s = makeStyles(colors, isDark, accent);

  if (loading) {
    return (
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={s.safe}>
        <View style={s.loadingWrap}>
          <ActivityIndicator />
          <Text style={s.loadingText}>Loading journal settings…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        {/* HEADER */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.iconButtonGhost}
            activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Journal settings</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* REMINDERS */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Daily reminders</Text>
            <Text style={s.cardBody}>
              Lightweight nudges to keep journalling consistent. Times are
              approximate and use your device time zone.
            </Text>

            <View style={s.rowBetween}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowTitle}>Morning check-in</Text>
                <Text style={s.rowSub}>
                  Quick feel for sleep, mood and stress. Around 08:00.
                </Text>
              </View>
              <Toggle
                value={morningReminderOn}
                onChange={setMorningReminderOn}
                accent={accent}
                colors={colors}
                isDark={isDark}
              />
            </View>

            <View style={s.rowDivider} />

            <View style={s.rowBetween}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowTitle}>Evening reflection</Text>
                <Text style={s.rowSub}>
                  Capture wins, frustrations and trading notes. Around 21:00.
                </Text>
              </View>
              <Toggle
                value={eveningReminderOn}
                onChange={setEveningReminderOn}
                accent={accent}
                colors={colors}
                isDark={isDark}
              />
            </View>
          </View>

          {/* VISIBILITY */}
          <View style={s.card}>
            <Text style={s.cardTitle}>What appears on your You page?</Text>
            <Text style={s.cardBody}>
              Choose how much of your journal we summarise into weekly
              insights.
            </Text>

            <View style={s.rowBetween}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowTitle}>Show journal insights</Text>
                <Text style={s.rowSub}>
                  When off, your entries are still saved but we hide insight
                  cards from the You tab.
                </Text>
              </View>
              <Toggle
                value={showOnYouPage}
                onChange={setShowOnYouPage}
                accent={accent}
                colors={colors}
                isDark={isDark}
              />
            </View>

            <View style={s.rowDivider} />

            <View style={s.rowBetween}>
              <View style={s.rowLabelCol}>
                <Text style={s.rowTitle}>Include trading context</Text>
                <Text style={s.rowSub}>
                  We’ll use any notes tagged with trading, markets or risk to
                  understand how mindset links to performance.
                </Text>
              </View>
              <Toggle
                value={includeTradingContext}
                onChange={setIncludeTradingContext}
                accent={accent}
                colors={colors}
                isDark={isDark}
              />
            </View>
          </View>

          {/* DATA SECTION */}
          <View style={s.cardMuted}>
            <View style={s.cardMutedHeader}>
              <Feather
                name="shield"
                size={14}
                color={colors.subtext || "#6B7280"}
              />
              <Text style={s.cardMutedTitle}>Your data</Text>
            </View>
            <Text style={s.cardMutedBody}>
              Journal entries stay private to your account. Turning off
              insights doesn’t delete past entries – it just stops us from
              analysing them. You’ll be able to export or clear all journal
              data from here in a future update.
            </Text>
          </View>

          {/* BUTTONS */}
          <View style={s.buttonRow}>
            <TouchableOpacity
              style={s.secondaryBtn}
              activeOpacity={0.9}
              onPress={() => router.back()}
              disabled={saving}
            >
              <Text style={s.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.primaryBtn}
              activeOpacity={0.9}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator
                  size="small"
                  color={colors.sapOnPrimary || "#000"}
                />
              ) : (
                <>
                  <Feather
                    name="check"
                    size={16}
                    color={colors.sapOnPrimary}
                  />
                  <Text style={s.primaryBtnText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* ---------- tiny toggle component ---------- */

function Toggle({ value, onChange, accent, colors, isDark }) {
  const active = !!value;
  return (
    <TouchableOpacity
      onPress={() => onChange(!value)}
      activeOpacity={0.9}
      style={[
        {
          width: 46,
          height: 26,
          borderRadius: 999,
          padding: 3,
          flexDirection: "row",
          alignItems: "center",
        },
        active
          ? { backgroundColor: accent, justifyContent: "flex-end" }
          : {
              backgroundColor: isDark ? "#111217" : "#E5E7EB",
              justifyContent: "flex-start",
            },
      ]}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: "#fff",
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          ...Platform.select({
            android: { elevation: 1 },
          }),
        }}
      />
    </TouchableOpacity>
  );
}

/* ---------- styles ---------- */

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
      justifyContent: "space-between",
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
    headerTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
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

    card: {
      backgroundColor: colors.sapSilverLight || colors.card,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      marginBottom: 14,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 4,
    },
    cardBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
      marginBottom: 10,
    },

    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 16,
      marginTop: 8,
    },
    rowLabelCol: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },
    rowSub: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
      lineHeight: 17,
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.sapSilverMedium || colors.border,
      marginVertical: 10,
      opacity: 0.6,
    },

    cardMuted: {
      backgroundColor: isDark ? "#111217" : "#F9FAFB",
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      marginBottom: 18,
    },
    cardMutedHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 4,
    },
    cardMutedTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    cardMutedBody: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },

    buttonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 6,
      marginBottom: 8,
    },
    secondaryBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.sapSilverMedium || colors.border,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.subtext,
    },
    primaryBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      ...Platform.select({
        android: { elevation: 3 },
      }),
    },
    primaryBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.sapOnPrimary,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
  });
}
