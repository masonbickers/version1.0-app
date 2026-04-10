// app/(protected)/history/index.jsx
import { Ionicons } from "@expo/vector-icons"; // ⭐ NEW ICON SET
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useTheme } from "../../../providers/ThemeProvider";
;
export default function ActivityHistoryPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const linkTrainSessionId = Array.isArray(params?.linkTrainSessionId)
    ? params.linkTrainSessionId[0]
    : params?.linkTrainSessionId;
  const linkSessionKey = Array.isArray(params?.linkSessionKey)
    ? params.linkSessionKey[0]
    : params?.linkSessionKey;
  const linkSessionTitle = Array.isArray(params?.linkSessionTitle)
    ? params.linkSessionTitle[0]
    : params?.linkSessionTitle;

  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setError("");
        setLoading(true);

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) {
          setError("Connect Strava in Settings to view your full activity history.");
          return;
        }

        const resp = await fetch(
          "https://www.strava.com/api/v3/athlete/activities?per_page=50",
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status} ${text}`);
        }

        const raw = await resp.json();
        const safe = Array.isArray(raw) ? raw : [];

        const mapped = safe.map((a) => {
          const km = (a.distance || 0) / 1000;
          const pace = km > 0 ? (a.moving_time || 0) / 60 / km : null;

          return {
            id: String(a.id),
            title: a.name || a.type || "Workout",
            type: a.type,
            distanceKm: km,
            paceMinPerKm: pace,
            movingTimeMin: Math.round((a.moving_time || 0) / 60),
            when: a.start_date,
          };
        }).sort((a, b) => {
          const aMs = a?.when ? new Date(a.when).getTime() : 0;
          const bMs = b?.when ? new Date(b.when).getTime() : 0;
          return bMs - aMs;
        });

        setActivities(mapped);
      } catch (e) {
        console.log("History load error", e);
        setError("Could not load activities.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const s = makeStyles(colors);

  const formatPace = (pace) => {
    if (!pace) return "-";
    const mins = Math.floor(pace);
    const secs = String(Math.round((pace - mins) * 60)).padStart(2, "0");
    return `${mins}:${secs}/km`;
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString();
  };

  /* ⭐ NEW PREMIUM ICON SYSTEM */
  const iconForType = (type) => {
    switch (type) {
      case "Run":
        return "walk-outline";            // best “running” icon in Ionicons
      case "Ride":
        return "bicycle-outline";
      case "Swim":
        return "water-outline";
      case "WeightTraining":
      case "Workout":
        return "fitness-outline";
      case "Walk":
        return "walk-outline";
      case "Hike":
        return "trail-sign-outline";
      default:
        return "pulse-outline";
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>All Activity</Text>

        {linkTrainSessionId || linkSessionKey ? (
          <View style={s.banner}>
            <Text style={s.bannerTitle}>Link Strava activity</Text>
            <Text style={s.bannerText}>
              {linkSessionTitle
                ? `Choose the Strava activity to attach to ${linkSessionTitle}.`
                : "Choose the Strava activity to attach to this training session."}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={{ paddingVertical: 20 }}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <Text style={s.error}>{error}</Text>
        ) : activities.length === 0 ? (
          <Text style={s.empty}>No activities found.</Text>
        ) : (
          activities.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={s.card}
              activeOpacity={0.8}
              onPress={() =>
                router.push({
                  pathname: "/history/[id]",
                  params: {
                    id: a.id,
                    ...(linkTrainSessionId ? { linkTrainSessionId: String(linkTrainSessionId) } : {}),
                    ...(linkSessionKey ? { linkSessionKey: String(linkSessionKey) } : {}),
                    ...(linkSessionTitle ? { linkSessionTitle: String(linkSessionTitle) } : {}),
                  },
                })
              }
            >
              <View style={s.iconWrap}>
                <Ionicons
                  name={iconForType(a.type)}
                  size={20}
                  color={colors.text}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{a.title}</Text>

                <Text style={s.cardMeta}>
                  {a.distanceKm > 0 ? `${a.distanceKm.toFixed(1)} km • ` : ""}
                  {a.movingTimeMin} min
                  {a.distanceKm > 0 && a.paceMinPerKm
                    ? ` • ${formatPace(a.paceMinPerKm)}`
                    : ""}
                </Text>
              </View>

              <Text style={s.when}>{formatDate(a.when)}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- styles ---------- */
function makeStyles(colors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, paddingBottom: 100 },
    title: {
      fontSize: 22,
      fontWeight: "900",
      marginBottom: 16,
      color: colors.text,
    },
    error: { color: "#EF4444", marginTop: 8, fontSize: 13 },
    empty: { marginTop: 8, color: colors.subtext, fontSize: 13 },
    banner: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 14,
    },
    bannerTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
    },
    bannerText: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 17,
      color: colors.subtext,
    },

    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.card,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: 12,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    cardTitle: { fontWeight: "800", color: colors.text },
    cardMeta: { fontSize: 12, color: colors.subtext, marginTop: 2 },
    when: { fontSize: 12, color: colors.subtext },
  });
}
