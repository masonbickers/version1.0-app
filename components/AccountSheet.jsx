// components/AccountSheet.jsx
import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
    Animated,
    Dimensions,
    Easing,
    Modal,
    PanResponder,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { useTheme } from "../providers/ThemeProvider";

const PRIMARY = "#E6FF3B";
const SCREEN_WIDTH = Dimensions.get("window").width;

export default function AccountSheet({ visible, onClose, user }) {
  const { colors, isDark } = useTheme();

  const theme = {
    bg: "rgba(0,0,0,0.55)",
    sheetBg: isDark ? "#111217" : "#171717",
    cardBg: isDark ? "#1A1B21" : "#202124",
    border: "#2A2B31",
    text: colors.text,
    subtext: colors.subtext,
    primary: PRIMARY,
  };

  const name = user?.displayName || "Your Name";
  const email = user?.email || "you@example.com";

  // ---- sheet animation & scrolling ----
  const translateY = useRef(new Animated.Value(800)).current;
  const slideX = useRef(new Animated.Value(0)).current; // root ↔ detail
  const scrollRef = useRef(null);

  // "root" or "detail"
  const [mode, setMode] = useState("root");

  // which detail page is active when mode === "detail"
  const [detailPage, setDetailPage] = useState(null); // e.g. "notifications"

  // Notification toggles
  const [notifyDailySummary, setNotifyDailySummary] = useState(true);
  const [notifySessionReminders, setNotifySessionReminders] = useState(true);
  const [notifyCoachTips, setNotifyCoachTips] = useState(false);

  // ---- helpers ----
  const detailTitleMap = {
    notifications: "Notifications",
    health: "Health Details",
    moveGoal: "Change Move Goal",
    units: "Units of Measure",
    privacy: "Privacy",
    workout: "Workout",
    fitness: "Fitness+",
    redeem: "Redeem Gift Card or Code",
    sendGift: "Send Gift Card by Email",
  };

  const openDetail = (pageKey) => {
    setDetailPage(pageKey);
    Animated.timing(slideX, {
      toValue: -SCREEN_WIDTH,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMode("detail");
    });
  };

  const backToRoot = () => {
    Animated.timing(slideX, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMode("root");
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  // Close AFTER slide-down animation – avoids flicker
  const animateClose = () => {
    Animated.timing(translateY, {
      toValue: 800,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      onClose?.();
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        translateY.setValue(800);
        slideX.setValue(0);
        setMode("root");
        setDetailPage(null);
      }, 120);
    });
  };

  // When becoming visible: reset & slide up (no bounce)
  useEffect(() => {
    if (visible) {
      translateY.setValue(800);
      slideX.setValue(0);
      setMode("root");
      setDetailPage(null);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }, 50);

      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const shouldClose = g.dy > 140 || g.vy > 0.9;
        if (shouldClose) {
          animateClose();
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  // -------- detail page content renderer --------
  const renderDetailContent = () => {
    switch (detailPage) {
      case "notifications":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowWithSwitch
                label="Daily summary"
                subtitle="Steps, training load & recovery snapshot"
                value={notifyDailySummary}
                onValueChange={setNotifyDailySummary}
                theme={theme}
              />
              <Divider theme={theme} />
              <RowWithSwitch
                label="Session reminders"
                subtitle="Remind me before planned workouts"
                value={notifySessionReminders}
                onValueChange={setNotifySessionReminders}
                theme={theme}
              />
              <Divider theme={theme} />
              <RowWithSwitch
                label="Coach tips"
                subtitle="Contextual tips based on my plan"
                value={notifyCoachTips}
                onValueChange={setNotifyCoachTips}
                theme={theme}
              />
            </View>

            <View style={{ marginTop: 14, paddingHorizontal: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  lineHeight: 18,
                }}
              >
                Notification preferences are used to guide how often we nudge
                you about training, recovery and nutrition. You can also control
                system-level alerts from your phone’s settings.
              </Text>
            </View>
          </>
        );

      case "health":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <RowStatic
              label="Date of Birth"
              value="Set in Health"
              theme={theme}
            />
            <Divider theme={theme} />
            <RowStatic label="Height" value="—" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Weight" value="—" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Sex" value="—" theme={theme} />
          </View>
        );

      case "moveGoal":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowStatic
                label="Daily move goal"
                value="Custom"
                theme={theme}
              />
              <Divider theme={theme} />
              <View style={styles.moveGoalContainer}>
                <Text style={{ color: theme.subtext, fontSize: 13 }}>
                  Adjust how aggressive your daily activity target is. This will
                  be used for streaks and rings.
                </Text>
              </View>
            </View>
          </>
        );

      case "units":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <RowStatic label="Distance" value="Kilometres" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Energy" value="Kilocalories" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Weight" value="Kilograms" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Height" value="Centimetres" theme={theme} />
          </View>
        );

      case "privacy":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowStatic
                label="Data & analytics"
                value="On"
                theme={theme}
              />
              <Divider theme={theme} />
              <RowStatic
                label="Share training insights"
                value="Off"
                theme={theme}
              />
            </View>

            <View style={{ marginTop: 14, paddingHorizontal: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  lineHeight: 18,
                }}
              >
                We use your data to personalise your plan and improve Train-R.
                You can request a copy or delete your account from the Privacy
                centre on the web.
              </Text>
            </View>
          </>
        );

      case "workout":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <RowStatic
              label="Default sport"
              value="Running"
              theme={theme}
            />
            <Divider theme={theme} />
            <RowStatic
              label="Auto-import from Strava"
              value="Enabled"
              theme={theme}
            />
            <Divider theme={theme} />
            <RowStatic
              label="Send workouts to watch"
              value="On"
              theme={theme}
            />
          </View>
        );

      case "fitness":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowStatic
                label="Linked services"
                value="None"
                theme={theme}
              />
              <Divider theme={theme} />
              <RowStatic
                label="Share progress with friends"
                value="Off"
                theme={theme}
              />
            </View>

            <View style={{ marginTop: 14, paddingHorizontal: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  lineHeight: 18,
                }}
              >
                Connect other fitness apps and services here once they’re
                available in Train-R.
              </Text>
            </View>
          </>
        );

      case "redeem":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={{ color: theme.text, fontSize: 14 }}>
                Redeem code
              </Text>
              <Text
                style={{
                  color: theme.subtext,
                  fontSize: 12,
                  marginTop: 6,
                  lineHeight: 18,
                }}
              >
                If you’ve been given a Train-R access code or gift, you’ll be
                able to redeem it here in a later update.
              </Text>
            </View>
          </View>
        );

      case "sendGift":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={{ color: theme.text, fontSize: 14 }}>
                Send a gift card
              </Text>
              <Text
                style={{
                  color: theme.subtext,
                  fontSize: 12,
                  marginTop: 6,
                  lineHeight: 18,
                }}
              >
                Soon you’ll be able to send Train-R access as a gift to friends
                and family directly from this screen.
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade" // background fade, sheet slide is custom
      onRequestClose={animateClose}
    >
      <View style={[styles.overlay, { backgroundColor: theme.bg }]}>
        <SafeAreaView style={styles.safe}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme.sheetBg, transform: [{ translateY }] },
            ]}
            {...panResponder.panHandlers}
          >
            {/* Inner horizontal pager – root + detail */}
            <Animated.View
              style={[
                styles.innerPager,
                { width: SCREEN_WIDTH * 2, transform: [{ translateX: slideX }] },
              ]}
            >
              {/* ROOT PAGE — ACCOUNT */}
              <View style={[styles.page, { width: SCREEN_WIDTH }]}>
                {/* HEADER */}
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: theme.text }]}>
                    Account
                  </Text>
                  <TouchableOpacity
                    onPress={animateClose}
                    style={styles.closeBtn}
                    activeOpacity={0.8}
                  >
                    <Feather name="x" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  ref={scrollRef}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingBottom: 24, // fills nicely, no big gap
                  }}
                >
                  {/* PROFILE CARD */}
                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.profileRow}
                      activeOpacity={0.85}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {name.charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.profileName, { color: theme.text }]}
                        >
                          {name}
                        </Text>
                        <Text
                          style={[
                            styles.profileEmail,
                            { color: theme.subtext },
                          ]}
                          numberOfLines={1}
                        >
                          {email}
                        </Text>
                      </View>

                      <Feather
                        name="chevron-right"
                        size={18}
                        color={theme.subtext}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* SETTINGS GROUPS */}
                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Notifications"
                      theme={theme}
                      onPress={() => openDetail("notifications")}
                    />
                  </View>

                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Health Details"
                      theme={theme}
                      onPress={() => openDetail("health")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Change Move Goal"
                      theme={theme}
                      onPress={() => openDetail("moveGoal")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Units of Measure"
                      theme={theme}
                      onPress={() => openDetail("units")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Privacy"
                      theme={theme}
                      onPress={() => openDetail("privacy")}
                    />
                  </View>

                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Workout"
                      theme={theme}
                      accent
                      onPress={() => openDetail("workout")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Fitness+"
                      theme={theme}
                      accent
                      onPress={() => openDetail("fitness")}
                    />
                  </View>

                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Redeem Gift Card or Code"
                      theme={theme}
                      accent
                      onPress={() => openDetail("redeem")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Send Gift Card by Email"
                      theme={theme}
                      accent
                      onPress={() => openDetail("sendGift")}
                    />
                  </View>
                </ScrollView>
              </View>

              {/* DETAIL PAGE (re-used for all detail screens) */}
              <View style={[styles.page, { width: SCREEN_WIDTH }]}>
                {/* HEADER – back chevron, dynamic title */}
                <View style={styles.subHeader}>
                  <TouchableOpacity
                    onPress={backToRoot}
                    style={styles.backBtn}
                    activeOpacity={0.8}
                  >
                    <Feather name="chevron-left" size={20} color={theme.text} />
                  </TouchableOpacity>
                  <Text style={[styles.subHeaderTitle, { color: theme.text }]}>
                    {detailTitleMap[detailPage] || "Account"}
                  </Text>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingBottom: 24,
                  }}
                >
                  {renderDetailContent()}
                </ScrollView>
              </View>
            </Animated.View>
          </Animated.View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/* ---------- sub components ---------- */

function Row({ label, theme, accent, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.row}
      onPress={onPress}
    >
      <Text
        style={[
          styles.rowLabel,
          { color: accent ? theme.primary : theme.text },
        ]}
      >
        {label}
      </Text>
      <Feather name="chevron-right" size={18} color={theme.subtext} />
    </TouchableOpacity>
  );
}

function RowStatic({ label, value, theme }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      {value ? (
        <Text
          style={{
            fontSize: 13,
            color: theme.subtext,
          }}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

function RowWithSwitch({ label, subtitle, value, onValueChange, theme }) {
  return (
    <View style={styles.rowSwitchContainer}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        {subtitle ? (
          <Text
            style={{
              fontSize: 12,
              color: theme.subtext,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#3A3A3A", true: theme.primary }}
        thumbColor={value ? "#111111" : "#f4f3f4"}
      />
    </View>
  );
}

function Divider({ theme }) {
  return (
    <View
      style={[styles.divider, { borderBottomColor: theme.border }]}
    />
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  innerPager: {
    flexDirection: "row",
    flex: 1,
  },
  page: {
    flex: 1,
  },

  // Root header
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  closeBtn: {
    position: "absolute",
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 20,
    backgroundColor: "rgba(38,38,38,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Sub-page header (detail pages)
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    marginTop: 4,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  subHeaderTitle: {
    fontSize: 17,
    fontWeight: "700",
  },

  sectionCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    overflow: "hidden",
  },

  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 20,
  },
  profileName: {
    fontSize: 15,
    fontWeight: "600",
  },
  profileEmail: {
    fontSize: 12,
    marginTop: 2,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },

  rowSwitchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 10,
  },

  moveGoalContainer: {
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
});
