// app/(protected)/settings.jsx
"use client";

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { API_URL } from "../../config/api";
import { auth } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

// ✅ optional sync (kept)
import { syncStravaActivities } from "../../src/lib/strava/syncStrava";

// Ensures auth sessions are completed cleanly (especially on iOS)
WebBrowser.maybeCompleteAuthSession();

/* ─────────────────────────────────────────────────────────────
  Helpers: API base + scheme
───────────────────────────────────────────────────────────── */

function normalizeApiBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;

  try {
    const url = new URL(withScheme);
    if (!url.port) {
      url.port = url.protocol === "https:" ? "443" : "3001";
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function guessLanApiBase() {
  return normalizeApiBase(API_URL);
}

function guessAppScheme() {
  // Linking.createURL("/") returns e.g. "exp://192.168..." in Expo Go,
  // or "trainr://..." in a dev build.
  const u = Linking.createURL("/");
  const scheme = u.split("://")[0];
  return scheme || "exp";
}

const API_BASE = guessLanApiBase();
const APP_SCHEME = guessAppScheme();

// Deep link return targets (server should redirect to these)
const STRAVA_RETURN_URL = Linking.createURL("strava-linked");
const GARMIN_RETURN_URL = Linking.createURL("garmin-linked");

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme, colors, isDark } = useTheme();

  const accentFill =
    colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";
  const accentInk = isDark
    ? colors.text || "#E5E7EB"
    : colors.accentText || "#3F4F00";

  const [notifEnabled, setNotifEnabled] = React.useState(true);
  const [analyticsOptIn, setAnalyticsOptIn] = React.useState(true);

  const [stravaConnecting, setStravaConnecting] = React.useState(false);
  const [stravaConnected, setStravaConnected] = React.useState(false);
  const [stravaSyncing, setStravaSyncing] = React.useState(false);

  const [garminConnecting, setGarminConnecting] = React.useState(false);
  const [garminConnected, setGarminConnected] = React.useState(false);

  const handleClose = React.useCallback(() => {
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(protected)/me");
  }, [router]);

  const s = makeStyles(colors, isDark, accentFill, accentInk);

  React.useEffect(() => {
    AsyncStorage.getItem("strava_connected")
      .then((v) => setStravaConnected(v === "1"))
      .catch(() => {});
    AsyncStorage.getItem("garmin_connected")
      .then((v) => setGarminConnected(v === "1"))
      .catch(() => {});

    console.log("Settings loaded");
    console.log("API_BASE =", API_BASE);
    console.log("APP_SCHEME =", APP_SCHEME);
    console.log("STRAVA_RETURN_URL =", STRAVA_RETURN_URL);
    console.log("GARMIN_RETURN_URL =", GARMIN_RETURN_URL);
  }, []);

  const ThemeOption = ({ value, label }) => {
    const active = theme === value;
    return (
      <TouchableOpacity
        onPress={() => setTheme(value)}
        activeOpacity={0.9}
        style={[s.option, active && s.optionActive]}
      >
        <View style={[s.radio, active && s.radioActive]}>
          {active && <View style={s.radioDot} />}
        </View>
        <Text style={[s.optionText, active && s.optionTextActive]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const onSignOut = async () => {
    try {
      await auth.signOut();
      router.replace("/(auth)/login");
    } catch (e) {}
  };

  /* ───────────────────────────────
      STRAVA (FIXED)
      ✅ No more exp://localhost or scheme://localhost redirects
      ✅ Flow: App -> SERVER /strava/start -> Strava -> SERVER /strava/callback -> App deep link
  ─────────────────────────────── */

  const runInitialStravaSync = React.useCallback(async (accessToken) => {
    const user = auth.currentUser;
    if (!user?.uid) return;
    if (!accessToken) return;

    try {
      setStravaSyncing(true);
      await syncStravaActivities(user.uid, accessToken);
    } catch (e) {
      console.log("Initial Strava sync error:", e);
      Alert.alert(
        "Strava",
        "Connected, but syncing failed. Try again later."
      );
    } finally {
      setStravaSyncing(false);
    }
  }, []);

  const fetchStravaTokensFromResult = React.useCallback(
    async (resultKey) => {
      const user = auth.currentUser;
      if (!user?.uid) throw new Error("Please sign in again.");
      const idToken = await user.getIdToken();

      const resp = await fetch(`${API_BASE}/strava/oauth-result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ resultKey }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          json?.error || `OAuth result failed (${resp.status})`
        );
      }
      return json || {};
    },
    []
  );

  const checkApiReachable = React.useCallback(async () => {
    if (!API_BASE) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const resp = await fetch(`${API_BASE}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      return !!resp?.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const handleConnectStrava = React.useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user?.uid) {
        Alert.alert("Strava", "Please sign in again and try.");
        return;
      }
      if (!API_BASE) {
        Alert.alert(
          "Strava",
          "API is not configured for this build. Set EXPO_PUBLIC_API_URL in EAS environment variables."
        );
        return;
      }

      const apiUp = await checkApiReachable();
      if (!apiUp) {
        Alert.alert(
          "Strava",
          `Can't reach your API server at ${API_BASE}.\n\nStart the backend on port 3001 and keep your phone on the same Wi-Fi.`
        );
        return;
      }

      setStravaConnecting(true);

      const startUrl = `${API_BASE}/strava/start?uid=${encodeURIComponent(
        user.uid
      )}&returnUrl=${encodeURIComponent(STRAVA_RETURN_URL)}`;

      console.log("Strava connect:");
      console.log("STRAVA_RETURN_URL =", STRAVA_RETURN_URL);
      console.log("Strava startUrl =", startUrl);

      const result = await WebBrowser.openAuthSessionAsync(
        startUrl,
        STRAVA_RETURN_URL
      );

      console.log("Strava auth result =", result);

      if (result.type !== "success" || !result.url) {
        return;
      }

      const parsed = Linking.parse(result.url);
      console.log("Strava parsed result =", parsed);

      const success = parsed?.queryParams?.success;

      if (success === "1" || success === 1) {
        let accessToken = parsed?.queryParams?.accessToken;
        let refreshToken = parsed?.queryParams?.refreshToken;
        let expiresAt = parsed?.queryParams?.expiresAt;
        const resultKey = parsed?.queryParams?.resultKey;

        if (!accessToken && resultKey) {
          const exchange = await fetchStravaTokensFromResult(String(resultKey));
          accessToken = exchange?.accessToken;
          refreshToken = exchange?.refreshToken;
          expiresAt = exchange?.expiresAt;
        }

        if (!accessToken) {
          throw new Error("OAuth completed but no Strava access token was returned.");
        }

        const updates = [
          ["strava_connected", "1"],
          ["strava_access_token", String(accessToken)],
        ];
        if (refreshToken) updates.push(["strava_refresh_token", String(refreshToken)]);
        if (expiresAt != null && String(expiresAt) !== "") {
          updates.push(["strava_expires_at", String(expiresAt)]);
        }
        await AsyncStorage.multiSet(updates);
        setStravaConnected(true);

        if (accessToken) {
          await runInitialStravaSync(String(accessToken));
        }

        Alert.alert("Strava", "Strava account connected.");
      } else {
        const reason = parsed?.queryParams?.reason;
        Alert.alert(
          "Strava",
          reason
            ? `Could not connect Strava (${String(reason)}).`
            : "Something went wrong connecting Strava."
        );
      }
    } catch (err) {
      console.error("Strava connect error", err);
      Alert.alert(
        "Strava",
        err?.message || "Something went wrong connecting Strava."
      );
    } finally {
      setStravaConnecting(false);
    }
  }, [checkApiReachable, fetchStravaTokensFromResult, runInitialStravaSync]);

  const handleDisconnectStrava = () => {
    Alert.alert(
      "Disconnect Strava",
      "Disconnecting removes the link from this device. (You may still need to revoke access in Strava.)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await AsyncStorage.multiRemove([
                "strava_connected",
                "strava_access_token",
                "strava_refresh_token",
                "strava_expires_at",
              ]);
              setStravaConnected(false);
              Alert.alert("Strava", "Strava has been disconnected.");
            } catch (e) {
              console.error("Strava disconnect error", e);
              Alert.alert("Strava", "Something went wrong disconnecting Strava.");
            }
          },
        },
      ]
    );
  };

  /* ───────────────────────────────
      GARMIN (same “server start -> deep link return” approach)
  ─────────────────────────────── */

  const handleConnectGarmin = async () => {
    try {
      const user = auth.currentUser;
      if (!user?.uid) {
        Alert.alert("Garmin", "Please sign in again and try.");
        return;
      }
      if (!API_BASE) {
        Alert.alert(
          "Garmin",
          "API is not configured for this build. Set EXPO_PUBLIC_API_URL in EAS environment variables."
        );
        return;
      }

      setGarminConnecting(true);

      const startUrl = `${API_BASE}/auth/garmin/start?uid=${encodeURIComponent(
        user.uid
      )}&redirectToApp=${encodeURIComponent(GARMIN_RETURN_URL)}`;

      console.log("Garmin connect:");
      console.log("GARMIN_RETURN_URL =", GARMIN_RETURN_URL);
      console.log("Garmin startUrl =", startUrl);

      const result = await WebBrowser.openAuthSessionAsync(
        startUrl,
        GARMIN_RETURN_URL
      );

      console.log("Garmin auth result =", result);

      if (result.type !== "success" || !result.url) {
        return;
      }

      const parsed = Linking.parse(result.url);
      console.log("Garmin parsed result =", parsed);

      const success = parsed?.queryParams?.success;

      if (success === "1" || success === 1) {
        await AsyncStorage.multiSet([["garmin_connected", "1"]]);
        setGarminConnected(true);
        Alert.alert("Garmin", "Garmin account connected.");
      } else {
        const reason = parsed?.queryParams?.reason;
        Alert.alert(
          "Garmin",
          reason
            ? `Could not connect Garmin (${String(reason)}).`
            : "Something went wrong connecting Garmin."
        );
      }
    } catch (e) {
      console.log("Garmin connect error", e);
      Alert.alert(
        "Garmin",
        e?.message || "Something went wrong connecting Garmin."
      );
    } finally {
      setGarminConnecting(false);
    }
  };

  const handleDisconnectGarmin = () => {
    Alert.alert(
      "Disconnect Garmin",
      "Disconnecting removes the link from this device. (You may still need to revoke access in Garmin.)",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await AsyncStorage.multiRemove(["garmin_connected"]);
              setGarminConnected(false);
              Alert.alert("Garmin", "Garmin has been disconnected.");
            } catch (e) {
              console.error("Garmin disconnect error", e);
              Alert.alert("Garmin", "Something went wrong disconnecting Garmin.");
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.page} contentContainerStyle={s.content}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Settings</Text>
            <Text style={s.headerSubtitle}>Theme, connections & account</Text>
            <Text style={s.debugTiny}>
              API: {API_BASE.replace("http://", "")}
            </Text>
            <Text style={s.debugTiny}>Scheme: {APP_SCHEME}</Text>
            <Text style={s.debugTiny}>Garmin return: {GARMIN_RETURN_URL}</Text>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            activeOpacity={0.85}
            style={s.headerBtn}
          >
            <Feather name="x" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>Appearance</Text>
        <View style={s.card}>
          <Text style={s.label}>Theme</Text>
          <View style={s.themeRow}>
            <ThemeOption value="light" label="Light" />
            <ThemeOption value="dark" label="Dark" />
            <ThemeOption value="system" label="System" />
          </View>
          <Text style={s.hint}>
            {Platform.OS === "ios" ? "iOS" : "Your device"} system setting is
            respected when “System” is selected.
          </Text>
        </View>

        <Text style={s.sectionTitle}>Preferences</Text>
        <View style={s.card}>
          <Row
            icon="bell"
            label="Notifications"
            right={
              <Switch
                trackColor={{
                  false: isDark ? "#2A2A2A" : "#D1D5DB",
                  true: accentFill,
                }}
                thumbColor={notifEnabled ? colors.card : "#f4f3f4"}
                onValueChange={setNotifEnabled}
                value={notifEnabled}
              />
            }
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="activity"
            label="Share anonymous analytics"
            right={
              <Switch
                trackColor={{
                  false: isDark ? "#2A2A2A" : "#D1D5DB",
                  true: accentFill,
                }}
                thumbColor={analyticsOptIn ? colors.card : "#f4f3f4"}
                onValueChange={setAnalyticsOptIn}
                value={analyticsOptIn}
              />
            }
            colors={colors}
          />
        </View>

        <Text style={s.sectionTitle}>Connections</Text>
        <View style={s.card}>
          <Row
            icon="zap"
            label={
              stravaConnected
                ? stravaSyncing
                  ? "Strava (Syncing…)"
                  : "Strava (Connected)"
                : "Connect Strava"
            }
            onPress={stravaConnected ? undefined : handleConnectStrava}
            right={
              stravaConnecting || stravaSyncing ? (
                <ActivityIndicator size="small" />
              ) : stravaConnected ? (
                <Feather name="check-circle" size={20} color="#22C55E" />
              ) : (
                <Feather name="chevron-right" size={18} color={colors.subtext} />
              )
            }
            colors={colors}
          />

          {stravaConnected && (
            <>
              <Divider colors={colors} />
              <Row
                icon="x-circle"
                label="Disconnect Strava"
                onPress={handleDisconnectStrava}
                danger
                colors={colors}
                right={null}
              />
            </>
          )}

          <Divider colors={colors} />

          <Row
            icon="watch"
            label={
              garminConnected
                ? garminConnecting
                  ? "Garmin (Connecting…)"
                  : "Garmin (Connected)"
                : "Connect Garmin"
            }
            onPress={garminConnected ? undefined : handleConnectGarmin}
            right={
              garminConnecting ? (
                <ActivityIndicator size="small" />
              ) : garminConnected ? (
                <Feather name="check-circle" size={20} color="#22C55E" />
              ) : (
                <Feather name="chevron-right" size={18} color={colors.subtext} />
              )
            }
            colors={colors}
          />

          {garminConnected && (
            <>
              <Divider colors={colors} />
              <Row
                icon="x-circle"
                label="Disconnect Garmin"
                onPress={handleDisconnectGarmin}
                danger
                colors={colors}
                right={null}
              />
            </>
          )}
        </View>

        <Text style={s.sectionTitle}>Account</Text>
        <View style={s.card}>
          <Row
            icon="user"
            label="Edit profile"
            onPress={() => router.push("/profile/edit")}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="credit-card"
            label="Plans & Billing"
            onPress={() => router.push("/plans")}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="lock"
            label="Colours"
            onPress={() => router.push("/colours")}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="lock"
            label="Fonts"
            onPress={() => router.push("/fonts")}
            colors={colors}
          />
          <Divider colors={colors} />
          <Row
            icon="log-out"
            label="Sign out"
            danger
            onPress={onSignOut}
            colors={colors}
          />
        </View>

        <Text style={s.footerNote}>BE App - Beta Preview 0.01</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- small components ---------- */

function Row({ icon, label, right, onPress, danger, colors }) {
  const dangerColor = colors.danger || "#EF4444";
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.8 : 1}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}
    >
      <Feather
        name={icon}
        size={18}
        color={danger ? dangerColor : colors.text}
      />
      <Text
        style={{
          marginLeft: 12,
          flex: 1,
          fontWeight: "800",
          color: danger ? dangerColor : colors.text,
        }}
      >
        {label}
      </Text>
      {right ?? (
        <Feather name="chevron-right" size={18} color={colors.subtext} />
      )}
    </TouchableOpacity>
  );
}

function Divider({ colors }) {
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
      }}
    />
  );
}

/* ---------- styles ---------- */

function makeStyles(colors, isDark, accentFill, accentInk) {
  const cardBg = colors.sapSilverLight || colors.card;
  const cardBorder = colors.sapSilverMedium || colors.border;

  const optionBg = isDark ? "#0E0F14" : colors.surfaceAlt || colors.bg;
  const optionBorder = isDark ? "#1B1C22" : colors.borderStrong || cardBorder;

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: 18, paddingBottom: 40, paddingTop: 6 },

    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    headerTitle: {
      fontSize: 32,
      fontWeight: "900",
      color: colors.text,
      marginBottom: 2,
      letterSpacing: -0.3,
    },
    headerSubtitle: {
      fontSize: 14,
      color: colors.subtext,
    },
    debugTiny: {
      marginTop: 6,
      fontSize: 11,
      color: colors.subtext,
      opacity: 0.7,
    },
    headerBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: isDark ? "#00000040" : "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: cardBorder,
    },

    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      marginTop: 12,
      marginBottom: 10,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },

    card: {
      backgroundColor: cardBg,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: cardBorder,
      marginBottom: 16,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: isDark ? 0.22 : 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: isDark ? 0 : 2 },
      }),
    },

    label: {
      color: colors.subtext,
      fontWeight: "800",
      marginBottom: 8,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },

    themeRow: { flexDirection: "row", gap: 8 },

    option: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: optionBorder,
      backgroundColor: optionBg,
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },

    optionActive: {
      borderColor: accentFill,
      backgroundColor: isDark ? "#00000055" : "#FFFFFF",
    },

    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.subtext,
      alignItems: "center",
      justifyContent: "center",
    },
    radioActive: { borderColor: accentFill },
    radioDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: accentFill,
    },

    optionText: { color: colors.subtext, fontWeight: "800", fontSize: 13 },
    optionTextActive: { color: colors.text },

    hint: { marginTop: 8, color: colors.subtext, fontSize: 12, lineHeight: 16 },

    footerNote: {
      textAlign: "center",
      color: colors.subtext,
      marginTop: 4,
      marginBottom: 8,
      fontSize: 12,
    },
  });
}
