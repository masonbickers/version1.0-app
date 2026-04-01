// app/(protected)/create/index.jsx
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
;
/* ───────── helpers ───────── */
const APPLE_BLUE = "#007AFF";

const JS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad2 = (n) => String(n).padStart(2, "0");
const meterToKm = (m) => m / 1000;

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}
function paceMinPerKm(distanceMeters, durationMs) {
  const km = distanceMeters / 1000;
  if (!km) return "--:--";
  const min = durationMs / 1000 / 60;
  const perKm = min / km;
  const whole = Math.floor(perKm);
  const sec = Math.round((perKm - whole) * 60);
  return `${pad2(whole)}:${pad2(sec)}/km`;
}
// Haversine meters
function haversine(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const STORAGE_FOLDER = "feed-thumbnails";

// Same session-key pattern as Train page (for potential navigation later)
function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

/* ───────── page ───────── */
export default function CreatePage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = auth.currentUser;
  const storage = getStorage();

  // top toggle
  const [tab, setTab] = useState("post"); // "post" | "record"

  /* ── POST state ── */
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [thumbUri, setThumbUri] = useState(null);
  const [posting, setPosting] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return Alert.alert(
        "Permission needed",
        "Allow photo access to attach images."
      );
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
    });
    if (!res.canceled && res.assets?.[0]?.uri) {
      setThumbUri(res.assets[0].uri);
    }
  };

  const uploadThumbIfAny = async () => {
    if (!thumbUri) return null;
    const blob = await (await fetch(thumbUri)).blob();
    const key = `${STORAGE_FOLDER}/${user?.uid || "anon"}_${Date.now()}.jpg`;
    const r = ref(storage, key);
    await uploadBytes(r, blob, { contentType: "image/jpeg" });
    return await getDownloadURL(r);
  };

  const publishPost = async () => {
    if (!user)
      return Alert.alert("Sign in", "You must be signed in to post.");
    if (!postTitle.trim() && !postBody.trim() && !thumbUri) {
      return Alert.alert("Nothing to post", "Add a title, text, or an image.");
    }
    try {
      setPosting(true);
      const url = await uploadThumbIfAny();
      const profile = {
        uid: user.uid,
        userName:
          user.displayName || user.email?.split("@")[0] || "User",
        userPhoto: user.photoURL || "",
      };
      // Write to global feed so Home picks it up
      await addDoc(collection(db, "activities"), {
        type: "post",
        title: postTitle.trim() || " ",
        meta: postBody.trim() || " ",
        thumbnail: url || "",
        likeCount: 0,
        createdAt: serverTimestamp(),
        ...profile,
      });
      setPostTitle("");
      setPostBody("");
      setThumbUri(null);
      Alert.alert("Posted", "Your post is live in the feed.");
    } catch (e) {
      console.error(e);
      Alert.alert("Post failed", e?.message || "Could not publish post.");
    } finally {
      setPosting(false);
    }
  };

  /* ── RECORD state ── */
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [points, setPoints] = useState([]); // {latitude, longitude, timestamp}
  const [distance, setDistance] = useState(0); // meters
  const [durationMs, setDurationMs] = useState(0);
  const startedAtRef = useRef(null);
  const pauseOffsetRef = useRef(0);
  const watchSubRef = useRef(null);
  const timerRef = useRef(null);

  // ask for location once we land on record tab (or at mount if default)
  useEffect(() => {
    if (tab !== "record") return;
    (async () => {
      const { status } =
        await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status);
      if (status !== "granted") {
        Alert.alert(
          "Location needed",
          "Enable location to record activities."
        );
      }
    })();
  }, [tab]);

  useEffect(() => {
    return () => {
      stopWatch();
      clearTimer();
    };
  }, []);

  const startTimer = () => {
    clearTimer();
    timerRef.current = setInterval(() => {
      if (!startedAtRef.current) return;
      const now = Date.now();
      setDurationMs(
        now - startedAtRef.current - pauseOffsetRef.current
      );
    }, 1000);
  };
  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const startWatch = async () => {
    if (watchSubRef.current) return;
    watchSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
        mayShowUserSettingsDialog: true,
      },
      (loc) => {
        const p = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          timestamp: loc.timestamp,
        };
        setPoints((prev) => {
          if (prev.length) {
            const last = prev[prev.length - 1];
            const d = haversine(last, p);
            if (d > 0 && d < 50)
              setDistance((x) => x + d); // basic outlier filter
          }
          return [...prev, p];
        });
      }
    );
  };
  const stopWatch = () => {
    if (watchSubRef.current) watchSubRef.current.remove();
    watchSubRef.current = null;
  };

  const onStart = async () => {
    if (permissionStatus !== "granted") {
      const { status } =
        await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status);
      if (status !== "granted") return;
    }
    setRecording(true);
    setPaused(false);
    setPoints([]);
    setDistance(0);
    pauseOffsetRef.current = 0;
    startedAtRef.current = Date.now();
    await startWatch();
    startTimer();
  };

  const onPause = () => {
    if (!recording || paused) return;
    setPaused(true);
    stopWatch();
    pauseOffsetRef.current =
      Date.now() - startedAtRef.current - durationMs;
    clearTimer();
  };

  const onResume = async () => {
    if (!recording || !paused) return;
    setPaused(false);
    await startWatch();
    startTimer();
  };

  const onDiscard = () => {
    Alert.alert("Discard activity?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          stopWatch();
          clearTimer();
          setRecording(false);
          setPaused(false);
          setPoints([]);
          setDistance(0);
          setDurationMs(0);
          startedAtRef.current = null;
          pauseOffsetRef.current = 0;
        },
      },
    ]);
  };

  const onFinish = async () => {
    if (!user)
      return Alert.alert(
        "Not signed in",
        "Please sign in to save."
      );
    stopWatch();
    clearTimer();
    try {
      // 1) Save the detailed activity under the user
      const act = {
        type: "run",
        startedAt: startedAtRef.current
          ? new Date(startedAtRef.current)
          : serverTimestamp(),
        createdAt: serverTimestamp(),
        durationMs,
        distanceMeters: Math.round(distance),
        path: points,
        platform: Platform.OS,
        app: "version1.0-app",
      };
      const refDoc = await addDoc(
        collection(db, "users", user.uid, "activities"),
        act
      );

      // 2) Publish a *summary* card into global feed for Home
      const profile = {
        uid: user.uid,
        userName:
          user.displayName || user.email?.split("@")[0] || "User",
        userPhoto: user.photoURL || "",
      };
      const title = `Activity: ${meterToKm(distance).toFixed(2)} km`;
      const meta = `Time ${formatDuration(
        durationMs
      )} • Pace ${paceMinPerKm(distance, durationMs)}`;

      await addDoc(collection(db, "activities"), {
        type: "activity",
        title,
        meta,
        thumbnail: "", // could render a map image later
        likeCount: 0,
        createdAt: serverTimestamp(),
        when: new Date().toLocaleString(),
        ...profile,
        userActivityId: refDoc.id,
      });

      Alert.alert("Saved", "Activity saved & posted to feed.");
    } catch (e) {
      console.error(e);
      Alert.alert(
        "Save failed",
        e?.message || "Could not save activity."
      );
    } finally {
      setRecording(false);
      setPaused(false);
      setPoints([]);
      setDistance(0);
      setDurationMs(0);
      startedAtRef.current = null;
      pauseOffsetRef.current = 0;
    }
  };

  /* ── derived record display ── */
  const timeText = useMemo(
    () => formatDuration(durationMs),
    [durationMs]
  );
  const distKmText = useMemo(
    () => meterToKm(distance).toFixed(2),
    [distance]
  );
  const paceText = useMemo(
    () => paceMinPerKm(distance, durationMs),
    [distance, durationMs]
  );

  /* ── LOAD TODAY'S WORKOUT FROM PLAN ── */
  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(true);

  useEffect(() => {
    const loadPlan = async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) {
          setPlan(null);
          return;
        }
        const ref = collection(db, "users", uid, "plans");
        const snap = await getDocs(
          query(ref, orderBy("updatedAt", "desc"), limit(1))
        );
        if (snap.empty) {
          setPlan(null);
        } else {
          const d = snap.docs[0];
          setPlan({ id: d.id, ...d.data() });
        }
      } catch (e) {
        console.log("[create] load plan error:", e);
        setPlan(null);
      } finally {
        setLoadingPlan(false);
      }
    };
    loadPlan();
  }, []);

  const todayWorkout = useMemo(() => {
    if (!plan?.weeks || !Array.isArray(plan.weeks)) return null;

    const todayLabel = JS_DAY_LABELS[new Date().getDay()];

    const totalWeeks = plan.weeks.length;
    const currentWeekIndex = Math.min(
      Math.max(plan.currentWeekIndex ?? 0, 0),
      totalWeeks - 1
    );
    const week = plan.weeks[currentWeekIndex];
    if (!week?.days || !Array.isArray(week.days)) return null;

    const dayIndex = week.days.findIndex((d) => d.day === todayLabel);
    if (dayIndex === -1) return null;

    const day = week.days[dayIndex];
    const session = day.sessions?.[0];
    if (!session) return null;

    // Duration / distance from workout or fields
    const durationMin =
      session.workout?.totalDurationSec != null
        ? Math.round(session.workout.totalDurationSec / 60)
        : session.targetDurationMin ?? session.durationMin;
    const distanceKm =
      session.workout?.totalDistanceKm != null
        ? session.workout.totalDistanceKm
        : session.targetDistanceKm ?? session.distanceKm;

    const subtitleParts = [];
    if (durationMin) subtitleParts.push(`${durationMin} min`);
    if (distanceKm) subtitleParts.push(`${Number(distanceKm).toFixed(1)} km`);

    return {
      weekIndex: currentWeekIndex,
      dayLabel: todayLabel,
      title: session.title || session.type || "Session",
      subtitle: subtitleParts.join(" · "),
      key: buildSessionKey(plan.id, currentWeekIndex, dayIndex, 0),
    };
  }, [plan]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER – Apple Notes style */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Create</Text>
            <Text style={styles.headerSubtitle}>
              Today • {todayLabel}
            </Text>
          </View>
        </View>

        {/* TODAY'S WORKOUT FROM PLAN */}
        {!loadingPlan && todayWorkout && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today’s workout</Text>
            <View style={styles.planCard}>
              <Text style={styles.planLabel}>
                Week {todayWorkout.weekIndex + 1} ·{" "}
                {todayWorkout.dayLabel}
              </Text>
              <Text style={styles.planTitle}>
                {todayWorkout.title}
              </Text>
              {todayWorkout.subtitle ? (
                <Text style={styles.planSubtitle}>
                  {todayWorkout.subtitle}
                </Text>
              ) : null}
              {/* Optional button could later deep-link to /train/session/[key] */}
            </View>
          </View>
        )}

        {/* TOGGLE: POST / RECORD */}
        <View style={styles.section}>
          <View style={styles.toggle}>
            <ToggleBtn
              active={tab === "post"}
              onPress={() => setTab("post")}
              label="Post"
              colors={colors}
              icon="edit-3"
            />
            <ToggleBtn
              active={tab === "record"}
              onPress={() => setTab("record")}
              label="Record"
              colors={colors}
              icon="activity"
            />
          </View>
        </View>

        {tab === "post" ? (
          <View style={styles.card}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={postTitle}
              onChangeText={setPostTitle}
              placeholder="Share something…"
              placeholderTextColor={colors.subtextSoft}
              style={styles.input}
            />
            <Text style={[styles.label, { marginTop: 10 }]}>Text</Text>
            <TextInput
              value={postBody}
              onChangeText={setPostBody}
              placeholder="What's on your mind?"
              placeholderTextColor={colors.subtextSoft}
              style={[styles.input, { minHeight: 100 }]}
              multiline
            />
            <View style={styles.rowBetween}>
              <TouchableOpacity
                onPress={pickImage}
                style={styles.attachBtn}
              >
                <Feather name="image" size={18} color={colors.text} />
                <Text style={styles.attachText}>
                  {thumbUri ? "Change image" : "Add image"}
                </Text>
              </TouchableOpacity>
              {thumbUri ? (
                <Text
                  style={{
                    color: colors.subtext,
                    fontSize: 12,
                  }}
                >
                  Attached ✓
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={publishPost}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.95 },
              ]}
              disabled={posting}
            >
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.primaryText}>
                {posting ? "Posting…" : "Publish to Feed"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View
              style={{
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <Text style={styles.big}>{timeText}</Text>
              <View style={styles.metricsRow}>
                <Metric
                  label="Distance"
                  value={`${distKmText} km`}
                  colors={colors}
                />
                <Metric
                  label="Pace"
                  value={paceText}
                  colors={colors}
                />
              </View>
              <Text
                style={{
                  color: colors.subtext,
                  fontSize: 12,
                }}
              >
                {permissionStatus === "granted"
                  ? "GPS ready"
                  : "Location permission required"}
              </Text>
            </View>

            {!recording ? (
              <Pressable
                onPress={onStart}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && { opacity: 0.95 },
                ]}
              >
                <Feather name="play" size={16} color="#fff" />
                <Text style={styles.primaryText}>Start</Text>
              </Pressable>
            ) : paused ? (
              <View style={styles.controlsRow}>
                <SecondaryButton
                  label="Discard"
                  onPress={onDiscard}
                  danger
                  colors={colors}
                />
                <PrimaryInline
                  label="Resume"
                  icon="play"
                  onPress={onResume}
                />
                <SecondaryButton
                  label="Finish"
                  onPress={onFinish}
                  colors={colors}
                />
              </View>
            ) : (
              <View style={styles.controlsRow}>
                <SecondaryButton
                  label="Pause"
                  onPress={onPause}
                  colors={colors}
                />
                <PrimaryInline
                  label="Finish"
                  icon="square"
                  onPress={onFinish}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ───────── tiny UI pieces ───────── */
function ToggleBtn({ active, onPress, label, colors, icon }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 10,
          borderRadius: 12,
          backgroundColor: active ? colors.text : colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          opacity: pressed ? 0.95 : 1,
        },
      ]}
    >
      <Feather
        name={icon}
        size={16}
        color={active ? colors.bg : colors.text}
      />
      <Text
        style={{
          color: active ? colors.bg : colors.text,
          fontWeight: "800",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Metric({ label, value, colors }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 8 }}>
      <Text
        style={{
          color: colors.text,
          fontWeight: "800",
          fontSize: 18,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: colors.subtext,
          fontSize: 12,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function PrimaryInline({ label, icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          gap: 8,
          backgroundColor: APPLE_BLUE,
          paddingVertical: 12,
          paddingHorizontal: 22,
          borderRadius: 999,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <Feather name={icon} size={16} color="#fff" />
      <Text style={{ color: "#fff", fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}
function SecondaryButton({ label, onPress, danger, colors }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 2,
          borderColor: danger ? "#DC2626" : colors.border,
          paddingVertical: 12,
          paddingHorizontal: 20,
          borderRadius: 999,
          backgroundColor: "transparent",
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: danger ? "#DC2626" : colors.text,
          fontWeight: "800",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ───────── styles ───────── */
const makeStyles = (colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: {
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 90,
      gap: 18,
    },

    /* HEADER – Apple style */
    header: {
      marginBottom: 4,
    },
    headerTitle: {
      fontSize: 34,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 2,
    },
    headerSubtitle: {
      fontSize: 14,
      color: colors.subtext,
    },

    section: {
      marginTop: 4,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 8,
    },

    // Today's workout card
    planCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 14,
      gap: 4,
    },
    planLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    planTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
      marginTop: 4,
    },
    planSubtitle: {
      fontSize: 14,
      color: colors.subtext,
      marginTop: 2,
    },

    toggle: { flexDirection: "row", gap: 8 },

    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 14,
      gap: 10,
    },

    label: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
      borderRadius: 12,
      padding: 12,
      color: colors.text,
      fontSize: 14,
    },

    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    attachBtn: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    attachText: { color: colors.text, fontWeight: "700" },

    primaryBtn: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: APPLE_BLUE,
      paddingVertical: 14,
      borderRadius: 12,
    },
    primaryText: { color: "white", fontWeight: "800" },

    big: {
      fontSize: 54,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: 1,
    },
    metricsRow: { flexDirection: "row", gap: 24 },

    controlsRow: {
      flexDirection: "row",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
    },
  });
