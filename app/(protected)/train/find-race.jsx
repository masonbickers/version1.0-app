// app/(protected)/train/find-race.jsx
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { API_URL } from "../../../config/api";
import { useTheme } from "../../../providers/ThemeProvider";
;
/* ---------------- shared helpers ---------------- */

const APPLE_BLUE = "#E6FF3B";


console.log("[find-race] API_URL:", API_URL);

function formatDateYYYYMMDD(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  if (!date) return null;
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  if (!date) return null;
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/* ---------------- filter configs ---------------- */

// Distance *from user location* (radius in km)
const LOCATION_DISTANCE_FILTERS = [
  { key: "any", label: "Anywhere", radiusKm: null },
  { key: "near", label: "Near me (≤ 25km)", radiusKm: 25 },
  { key: "city", label: "Up to 75km", radiusKm: 75 },
  { key: "region", label: "Up to 200km", radiusKm: 200 },
  { key: "far", label: "Up to 500km", radiusKm: 500 },
];

const TIME_FILTERS = [
  { key: "any", label: "Any time" },
  { key: "aroundDate", label: "Around my date" },
  { key: "3m", label: "Next 3 months" },
  { key: "6m", label: "Next 6 months" },
  { key: "12m", label: "Next 12 months" },
];

export default function FindRacePage() {
  const { colors, isDark } = useTheme();
  const theme = {
    bg: colors.bg,
    card: colors.card,
    text: colors.text,
    subtext: colors.subtext,
    border: colors.border,
    muted: colors.muted || (isDark ? "#3A3A3C" : "#F2F2F7"),
  };

  const router = useRouter();
  const params = useLocalSearchParams();

  const goalDistanceRaw = params?.goalDistance;
  const targetDateRaw = params?.targetDate;
  const stepRaw = params?.step;
  const returnToRaw = params?.returnTo;

  const goalDistance = useMemo(
    () =>
      Array.isArray(goalDistanceRaw) ? goalDistanceRaw[0] : goalDistanceRaw,
    [goalDistanceRaw]
  );
  const targetDateStr = useMemo(
    () => (Array.isArray(targetDateRaw) ? targetDateRaw[0] : targetDateRaw),
    [targetDateRaw]
  );
  const fromStep = useMemo(() => {
    const raw = Array.isArray(stepRaw) ? stepRaw[0] : stepRaw;
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : "0";
  }, [stepRaw]);
  const returnTo = useMemo(() => {
    const raw = Array.isArray(returnToRaw) ? returnToRaw[0] : returnToRaw;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return "/(protected)/train/create/create-run";
  }, [returnToRaw]);

  // --- search + results state ---
  const [query, setQuery] = useState(""); // ONLY race name / city
  const [loading, setLoading] = useState(false);
  const [remoteRaces, setRemoteRaces] = useState([]);
  const [error, setError] = useState("");

  // --- location state ---
  const [userLocation, setUserLocation] = useState(null); // { latitude, longitude } | null
  const [locationError, setLocationError] = useState("");
  const [locationRequested, setLocationRequested] = useState(false);

  // derived "around date" window from targetDateStr
  const { aroundStart: aroundStartStr, aroundEnd: aroundEndStr } = useMemo(() => {
    if (!targetDateStr) return { aroundStart: null, aroundEnd: null };

    const parts = String(targetDateStr).split("-");
    if (parts.length < 3) return { aroundStart: null, aroundEnd: null };

    const d = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );
    if (isNaN(d.getTime())) return { aroundStart: null, aroundEnd: null };

    const start = addDays(d, -21);
    const end = addDays(d, 21);

    return {
      aroundStart: start ? formatDateYYYYMMDD(start) : null,
      aroundEnd: end ? formatDateYYYYMMDD(end) : null,
    };
  }, [targetDateStr]);

  const hasTargetDate = !!targetDateStr;

  // ------------ filter state ------------

  const [distanceFilter, setDistanceFilter] = useState("any"); // distance from location
  const [timeFilter, setTimeFilter] = useState(
    targetDateStr ? "aroundDate" : "6m"
  );

  // Request user location lazily when we actually need it
  useEffect(() => {
    const selected = LOCATION_DISTANCE_FILTERS.find(
      (f) => f.key === distanceFilter
    );
    const needsLocation = selected && selected.radiusKm != null;

    if (!needsLocation) return;
    if (userLocation || locationRequested) return;

    let cancelled = false;

    async function getLocation() {
      try {
        setLocationRequested(true);
        setLocationError("");

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          if (!cancelled) {
            setLocationError(
              "Location permission not granted. Distance-from-me filter will be ignored."
            );
          }
          return;
        }

        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!cancelled) {
          setUserLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch (err) {
        console.log("[find-race] location error", err);
        if (!cancelled) {
          setLocationError(
            "Couldn't get your location. Distance filter may not be accurate."
          );
        }
      }
    }

    getLocation();

    return () => {
      cancelled = true;
    };
  }, [distanceFilter, userLocation, locationRequested]);

  // ------------ search with filters ------------

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRemoteRaces([]);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError("");

        const searchParams = new URLSearchParams();

        // basic text search – ONLY name / city
        searchParams.set("q", q);

        // base context
        if (goalDistance) {
          searchParams.set("goalDistance", goalDistance);
        }
        if (targetDateStr) {
          searchParams.set("targetDate", targetDateStr);
        }

        // ---- distance-from-me → userLat/userLng/radiusKm ----
        const distanceConfig = LOCATION_DISTANCE_FILTERS.find(
          (f) => f.key === distanceFilter
        );
        const radiusKm = distanceConfig?.radiusKm ?? null;

        if (radiusKm != null && userLocation) {
          searchParams.set("userLat", String(userLocation.latitude));
          searchParams.set("userLng", String(userLocation.longitude));
          searchParams.set("radiusKm", String(radiusKm));
        }

        // ---- time span → windowStart / windowEnd ----
        let windowStartStr = null;
        let windowEndStr = null;
        const today = new Date();

        if (timeFilter === "aroundDate" && aroundStartStr && aroundEndStr) {
          windowStartStr = aroundStartStr;
          windowEndStr = aroundEndStr;
        } else if (timeFilter === "3m") {
          windowStartStr = formatDateYYYYMMDD(today);
          windowEndStr = formatDateYYYYMMDD(addMonths(today, 3));
        } else if (timeFilter === "6m") {
          windowStartStr = formatDateYYYYMMDD(today);
          windowEndStr = formatDateYYYYMMDD(addMonths(today, 6));
        } else if (timeFilter === "12m") {
          windowStartStr = formatDateYYYYMMDD(today);
          windowEndStr = formatDateYYYYMMDD(addMonths(today, 12));
        }
        // "any" = no date filter

        if (windowStartStr) searchParams.set("windowStart", windowStartStr);
        if (windowEndStr) searchParams.set("windowEnd", windowEndStr);

        const url = `${API_URL}/races/ai-search?${searchParams.toString()}`;
        console.log("[find-race] fetching:", url);

        const res = await fetch(url);
        if (!res.ok) {
          console.log("[find-race] HTTP error:", res.status);
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        console.log("[find-race] data:", data);

        if (!cancelled) {
          setRemoteRaces(Array.isArray(data.races) ? data.races : []);
        }
      } catch (err) {
        console.log("[find-race] error", err);
        if (!cancelled) {
          const msg =
            err instanceof Error && err.message.startsWith("HTTP")
              ? `Server error (${err.message}).`
              : "Couldn't fetch races. Try again or tweak your filters.";
          setError(msg);
          setRemoteRaces([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const t = setTimeout(run, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    query,
    goalDistance,
    targetDateStr,
    distanceFilter,
    timeFilter,
    aroundStartStr,
    aroundEndStr,
    userLocation,
  ]);

  const handleSelectRace = (race) => {
    // return to create-run with selected race encoded into params
    router.replace({
      pathname: returnTo,
      params: {
        step: fromStep,
        selectedRaceName: race.name || "",
        selectedRaceDate: race.date || "",
        selectedRaceDistance: race.distance || "",
      },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
      >
        {/* HEADER */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[
              styles.pillBtn,
              { borderColor: theme.border, paddingHorizontal: 10 },
            ]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={18} color={theme.text} />
            <Text
              style={{
                color: theme.text,
                fontWeight: "700",
              }}
            >
              Back
            </Text>
          </TouchableOpacity>

          <Text style={[styles.title, { color: theme.text }]}>Find a race</Text>

          <View style={{ width: 70 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Context text */}
          <View
            style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}
          >
            <Text style={{ fontSize: 12, color: theme.subtext }}>
              Filter by{" "}
              <Text style={{ fontWeight: "700" }}>distance from you</Text> and{" "}
              <Text style={{ fontWeight: "700" }}>time of year</Text>, then
              search by race name or city.
            </Text>
          </View>

          {/* Distance from me filter section */}
          <View style={{ paddingHorizontal: 16, marginBottom: 6 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: theme.subtext,
                marginBottom: 6,
              }}
            >
              Distance from me
            </Text>
            <View style={styles.filterRow}>
              {LOCATION_DISTANCE_FILTERS.map((opt) => {
                const isActive = distanceFilter === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setDistanceFilter(opt.key)}
                    activeOpacity={0.9}
                    style={[
                      styles.filterChip,
                      {
                        borderColor: isActive ? APPLE_BLUE : theme.border,
                        backgroundColor: isActive ? "rgba(230,255,59,0.20)" : theme.bg,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: isActive ? "700" : "500",
                        color: isActive ? "#0B1215" : theme.text,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!!locationError && distanceFilter !== "any" && (
              <Text
                style={{
                  fontSize: 11,
                  color: "#EF4444",
                  marginTop: 4,
                }}
              >
                {locationError}
              </Text>
            )}
            {!userLocation &&
              !locationError &&
              distanceFilter !== "any" &&
              locationRequested && (
                <Text
                  style={{
                    fontSize: 11,
                    color: theme.subtext,
                    marginTop: 4,
                  }}
                >
                  Getting your location… if this hangs, try switching distance to
                  "Anywhere".
                </Text>
              )}
          </View>

          {/* Time span filter section */}
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: theme.subtext,
                marginBottom: 6,
              }}
            >
              Time span
            </Text>
            <View style={styles.filterRow}>
              {TIME_FILTERS.map((opt) => {
                const isActive = timeFilter === opt.key;
                const isAround = opt.key === "aroundDate";
                const disabled = isAround && !hasTargetDate;

                return (
                  <TouchableOpacity
                    key={opt.key}
                    disabled={disabled}
                    onPress={() => !disabled && setTimeFilter(opt.key)}
                    activeOpacity={0.9}
                    style={[
                      styles.filterChip,
                      {
                        borderColor: isActive ? APPLE_BLUE : theme.border,
                        backgroundColor: isActive ? "rgba(230,255,59,0.20)" : theme.bg,
                        opacity: disabled ? 0.4 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: isActive ? "700" : "500",
                        color: isActive ? "#0B1215" : theme.text,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!hasTargetDate && (
              <Text
                style={{
                  fontSize: 11,
                  color: theme.subtext,
                  marginTop: 2,
                }}
              >
                Add a race date on the form to enable "Around my date".
              </Text>
            )}
          </View>

          {/* Search bar (name / city only) */}
          <View style={{ paddingHorizontal: 16 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: theme.subtext,
                marginBottom: 4,
              }}
            >
              Search
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.card,
                  color: theme.text,
                  marginBottom: 10,
                },
              ]}
              placeholder="Race name or city (e.g. Berlin, London)"
              placeholderTextColor={theme.subtext}
              value={query}
              onChangeText={setQuery}
            />
          </View>

          {/* Results / status */}
          <View style={{ paddingHorizontal: 16 }}>
            {query.trim().length < 2 && (
              <Text
                style={{ fontSize: 12, color: theme.subtext, marginBottom: 6 }}
              >
                Type at least 2 characters to start searching.
              </Text>
            )}

            {loading && (
              <View style={{ marginTop: 12, alignItems: "center" }}>
                <ActivityIndicator size="small" color={APPLE_BLUE} />
                <Text
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: theme.subtext,
                  }}
                >
                  Finding races that match your filters…
                </Text>
              </View>
            )}

            {!!error && (
              <Text style={{ fontSize: 12, color: "#EF4444", marginTop: 8 }}>
                {error}
              </Text>
            )}

            {!loading &&
              !error &&
              query.trim().length >= 2 &&
              remoteRaces.length === 0 && (
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.subtext,
                    marginTop: 8,
                  }}
                >
                  No races found — try another city, distance range, or time
                  span.
                </Text>
              )}

            {remoteRaces.map((race) => (
              <TouchableOpacity
                key={
                  race.id ||
                  race.url ||
                  `${race.name || "race"}-${race.date || ""}-${race.location || ""}`
                }
                onPress={() => handleSelectRace(race)}
                activeOpacity={0.9}
                style={[
                  styles.raceRow,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.card,
                  },
                ]}
              >
                <Text
                  style={{
                    fontWeight: "700",
                    color: theme.text,
                    marginBottom: 2,
                  }}
                >
                  {race.name}
                </Text>
                {!!race.location && (
                  <Text
                    style={{
                      color: theme.subtext,
                      fontSize: 12,
                    }}
                  >
                    {race.location}
                  </Text>
                )}
                <Text
                  style={{
                    color: theme.subtext,
                    fontSize: 11,
                    marginTop: 4,
                  }}
                >
                  {race.distance || "Distance N/A"}
                  {race.date ? ` · ${race.date}` : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  pillBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  filterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  raceRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
});
