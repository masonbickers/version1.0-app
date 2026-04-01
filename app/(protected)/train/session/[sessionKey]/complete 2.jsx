import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../../../../firebaseConfig";
import { useLiveActivity } from "../../../../../providers/LiveActivityProvider";
import { useTheme } from "../../../../../providers/ThemeProvider";

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const accent = colors?.accentBg ?? colors?.sapPrimary ?? colors?.primary ?? "#E6FF3B";
  return {
    bg: colors?.bg ?? (isDark ? "#050506" : "#F5F5F7"),
    card: colors?.card ?? (isDark ? "#101219" : "#F3F4F6"),
    card2: isDark ? "#0E0F12" : "#FFFFFF",
    cardSoft: colors?.surfaceAlt ?? (isDark ? "#0B0C10" : "#FFFFFF"),
    text: colors?.text ?? (isDark ? "#E5E7EB" : "#0F172A"),
    subtext: colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B"),
    border: colors?.border ?? (isDark ? "rgba(255,255,255,0.10)" : "#E1E3E8"),
    primaryBg: accent,
    primaryText: colors?.sapOnPrimary ?? "#111111",
    danger: "#DC2626",
    success: "#16A34A",
    warning: "#F59E0B",
    isDark,
  };
}

function normaliseKey(raw) {
  if (Array.isArray(raw)) return String(raw[0] || "");
  return String(raw || "");
}

function decodeSessionKey(raw) {
  const str = normaliseKey(raw);
  const parts = decodeURIComponent(str).split("_");
  if (parts.length < 4) return { planId: "", weekIndex: 0, dayIndex: 0, sessionIndex: 0 };

  const sessionIndex = Number(parts[parts.length - 1]) || 0;
  const dayIndex = Number(parts[parts.length - 2]) || 0;
  const weekIndex = Number(parts[parts.length - 3]) || 0;
  const planId = parts.slice(0, parts.length - 3).join("_");
  return { planId, weekIndex, dayIndex, sessionIndex };
}

function cycleOption(current, options) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return "";
  const idx = list.findIndex((x) => x === current);
  if (idx < 0) return list[0];
  return list[(idx + 1) % list.length];
}

function secondsToHMMSS(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const RUN_TAGS = ["Run", "Workout", "Tempo", "Long Run", "Intervals"];
const STRENGTH_TAGS = ["Weight Training", "Gym", "Hyrox", "Conditioning"];
const FEEL_OPTIONS = ["Great", "Good", "Okay", "Hard", "Very Hard"];
const VISIBILITY_OPTIONS = ["Everyone", "Followers", "Only me"];
const HIDDEN_OPTIONS = ["None", "Map", "Pace", "Heart rate"];

export default function SessionCompleteScreen() {
  const theme = useScreenTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sessionKey, status: statusParam } = useLocalSearchParams();
  const { liveActivity, setLiveActivity, clearLiveActivity } = useLiveActivity();

  const ScreenHeader = useMemo(
    () => <Stack.Screen options={{ headerShown: false }} />,
    []
  );

  const encodedKey = useMemo(() => normaliseKey(sessionKey), [sessionKey]);

  const pendingSaveDraft = useMemo(() => {
    const draft = liveActivity?.pendingSaveDraft;
    if (!draft || typeof draft !== "object") return null;
    if (encodedKey && draft?.sessionKey && String(draft.sessionKey) !== String(encodedKey)) {
      return null;
    }
    return draft;
  }, [encodedKey, liveActivity?.pendingSaveDraft]);

  const payload = pendingSaveDraft?.payload || null;
  const mode = pendingSaveDraft?.mode === "strength" ? "strength" : "run";
  const isStrength = mode === "strength";

  const draftDurationSec = Number(payload?.live?.durationSec || payload?.strengthLog?.durationSec || 0);
  const draftDistanceKm = Number(payload?.live?.distanceKm || 0);
  const draftPace = payload?.live?.movingPaceMinPerKm || payload?.live?.avgPaceMinPerKm || "--:--";
  const draftLoggedExercises = Number(payload?.strengthLog?.loggedExercises || 0);

  const defaultTitle = String(
    payload?.title ||
      (isStrength ? "Strength Workout" : "Run")
  );
  const defaultTag = isStrength
    ? (String(payload?.primaryActivity || "").toLowerCase().includes("hyrox")
        ? "Hyrox"
        : "Weight Training")
    : "Run";

  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(String(payload?.notes || ""));
  const [activityTag, setActivityTag] = useState(defaultTag);
  const [feeling, setFeeling] = useState("Good");
  const [privateNotes, setPrivateNotes] = useState("");
  const [visibility, setVisibility] = useState("Everyone");
  const [hiddenDetails, setHiddenDetails] = useState("None");
  const [muteActivity, setMuteActivity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState(() => {
    const existing = Array.isArray(payload?.saveMeta?.photos)
      ? payload.saveMeta.photos
      : [];
    return existing
      .filter((p) => p && typeof p?.uri === "string" && p.uri)
      .slice(0, 8)
      .map((p, idx) => ({
        id: String(p?.id || p?.uri || `existing_${idx}`),
        uri: String(p.uri),
        width: Number(p?.width || 0) || null,
        height: Number(p?.height || 0) || null,
        fileName: p?.fileName || null,
        mimeType: p?.mimeType || null,
        fileSize: Number(p?.fileSize || 0) || null,
      }));
  });

  const initialManualStatus =
    String(Array.isArray(statusParam) ? statusParam[0] : statusParam || "").toLowerCase() === "skipped"
      ? "skipped"
      : "completed";
  const [manualStatus, setManualStatus] = useState(initialManualStatus);
  const [manualNotes, setManualNotes] = useState("");

  const tagOptions = isStrength ? STRENGTH_TAGS : RUN_TAGS;

  const sessionCompleteBullets = useMemo(() => {
    const out = [];

    if (isStrength) {
      out.push(`Duration ${secondsToHMMSS(draftDurationSec)}`);
      out.push(`${draftLoggedExercises} exercises logged`);
    } else {
      out.push(`${draftDistanceKm > 0 ? draftDistanceKm.toFixed(2) : "0.00"} km`);
      out.push(`${secondsToHMMSS(draftDurationSec)} moving time`);
      if (draftPace && draftPace !== "--:--") out.push(`${draftPace}/km pace`);
    }

    out.push(`Tag: ${activityTag}`);
    out.push(`Feeling: ${feeling}`);
    out.push(`Visibility: ${visibility}`);
    if (photos.length) out.push(`${photos.length} photos attached`);

    return out;
  }, [
    activityTag,
    draftDistanceKm,
    draftDurationSec,
    draftLoggedExercises,
    draftPace,
    feeling,
    isStrength,
    photos.length,
    visibility,
  ]);

  const resumeLive = useCallback(() => {
    setLiveActivity((prev) => {
      if (!prev || typeof prev !== "object") return prev;
      return {
        ...prev,
        pendingSaveDraft: null,
        updatedAt: Date.now(),
      };
    });
    router.back();
  }, [router, setLiveActivity]);

  const discardActivity = useCallback(() => {
    Alert.alert(
      "Discard activity?",
      "This will remove the pending save data.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            clearLiveActivity();
            router.replace("/train/history");
          },
        },
      ]
    );
  }, [clearLiveActivity, router]);

  const pickPhotos = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission needed", "Allow photo access to attach images.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsMultipleSelection: true,
        selectionLimit: 8,
      });

      if (res.canceled || !Array.isArray(res.assets) || !res.assets.length) return;

      setPhotos((prev) => {
        const next = [...prev];

        for (const asset of res.assets) {
          const uri = String(asset?.uri || "").trim();
          if (!uri) continue;
          if (next.some((x) => x.uri === uri)) continue;
          if (next.length >= 8) break;

          next.push({
            id: String(asset?.assetId || uri),
            uri,
            width: Number(asset?.width || 0) || null,
            height: Number(asset?.height || 0) || null,
            fileName: asset?.fileName || null,
            mimeType: asset?.mimeType || null,
            fileSize: Number(asset?.fileSize || 0) || null,
          });
        }

        return next;
      });
    } catch (e) {
      Alert.alert("Couldn’t open photos", e?.message || "Try again.");
    }
  }, []);

  const removePhoto = useCallback((id) => {
    setPhotos((prev) => prev.filter((x) => String(x.id) !== String(id)));
  }, []);

  const saveActivity = useCallback(async () => {
    try {
      if (!payload) {
        Alert.alert("No draft found", "Go back to live session and finish again.");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      setSaving(true);
      const storage = getStorage();

      const photoDrafts = photos.map((p, idx) => ({
        id: String(p?.id || `photo_${idx}`),
        uri: String(p?.uri || ""),
        width: Number(p?.width || 0) || null,
        height: Number(p?.height || 0) || null,
        fileName: p?.fileName || null,
        mimeType: p?.mimeType || null,
        fileSize: Number(p?.fileSize || 0) || null,
      }));
      const uploadedPhotos = [];

      for (let i = 0; i < photoDrafts.length; i += 1) {
        const photo = photoDrafts[i];
        if (!photo.uri) continue;

        if (/^https?:\/\//i.test(photo.uri)) {
          uploadedPhotos.push({
            ...photo,
            url: photo.uri,
          });
          continue;
        }

        const blob = await (await fetch(photo.uri)).blob();
        const extFromMime = String(photo.mimeType || "")
          .split("/")
          .pop()
          ?.toLowerCase();
        const fallbackExt = "jpg";
        const ext = extFromMime && /^[a-z0-9]+$/.test(extFromMime) ? extFromMime : fallbackExt;
        const key = `train-session-media/${uid}/${Date.now()}_${i}.${ext}`;
        const storageRef = ref(storage, key);
        await uploadBytes(storageRef, blob, {
          contentType: photo.mimeType || "image/jpeg",
        });
        const url = await getDownloadURL(storageRef);

        uploadedPhotos.push({
          ...photo,
          url,
        });
      }

      const finalPayload = {
        ...payload,
        title: String(title || payload?.title || "Session").trim(),
        notes: String(description || payload?.notes || "").trim(),
        status: "completed",
        visibility,
        muted: !!muteActivity,
        saveMeta: {
          mode,
          activityTag,
          feeling,
          privateNotes: String(privateNotes || "").trim() || null,
          hiddenDetails,
          visibility,
          muteActivity: !!muteActivity,
          photos: uploadedPhotos.length ? uploadedPhotos : null,
        },
        media: uploadedPhotos.length
          ? {
              photos: uploadedPhotos,
              count: uploadedPhotos.length,
            }
          : null,
        createdAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "users", uid, "trainSessions"), finalPayload);

      const beaconSessionId = pendingSaveDraft?.beaconSessionId || null;
      if (beaconSessionId) {
        try {
          await updateDoc(doc(db, "users", uid, "liveSessions", beaconSessionId), {
            status: "completed",
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            finalSessionId: ref.id,
          });
        } catch {}
      }

      clearLiveActivity();
      router.replace("/train/history");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save activity.");
    } finally {
      setSaving(false);
    }
  }, [
    activityTag,
    clearLiveActivity,
    description,
    feeling,
    hiddenDetails,
    mode,
    muteActivity,
    payload,
    pendingSaveDraft?.beaconSessionId,
    photos,
    privateNotes,
    router,
    title,
    visibility,
  ]);

  const saveManualLog = useCallback(async () => {
    try {
      if (!encodedKey) {
        Alert.alert("Invalid session", "This session link is missing its key.");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      setSaving(true);

      const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
      const date = new Date().toISOString().split("T")[0];

      await setDoc(
        doc(db, "users", uid, "sessionLogs", encodedKey),
        {
          sessionKey: encodedKey,
          planId: planId || null,
          weekIndex,
          dayIndex,
          sessionIndex,
          date,
          status: manualStatus,
          source: "manual_log",
          notes: String(manualNotes || "").trim() || null,
          updatedAt: serverTimestamp(),
          statusAt: serverTimestamp(),
        },
        { merge: true }
      );

      router.back();
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save session log.");
    } finally {
      setSaving(false);
    }
  }, [encodedKey, manualNotes, manualStatus, router]);

  if (!payload) {
    return (
      <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}>
        {ScreenHeader}
        <View style={sx.root}>
          <View
            style={[
              sx.stickyHeader,
              {
                paddingTop: 2,
                backgroundColor: theme.bg,
                borderBottomColor: theme.border,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.85}
              style={sx.stickyLeftBtn}
            >
              <Text style={[sx.stickyLeftText, { color: theme.text }]}>Back</Text>
            </TouchableOpacity>
            <Text style={[sx.stickyTitle, { color: theme.text }]}>Log Session</Text>
            <View style={sx.stickyRightGhost} />
          </View>

          <ScrollView
            contentContainerStyle={[
              sx.scrollContent,
              { paddingBottom: 96 },
            ]}
            showsVerticalScrollIndicator
          >
            <View style={[sx.heroCard, { backgroundColor: theme.card2 }]}>
              <Text style={[sx.heroTitle, { color: theme.text }]}>Manual session log</Text>
              <Text style={[sx.sectionSub, { color: theme.subtext }]}>
                Mark this session as completed or skipped and attach notes.
              </Text>
            </View>

            <Text style={[sx.sectionTitle, { color: theme.text }]}>Session Outcome</Text>

            <View style={[sx.statusRail, { backgroundColor: theme.card2 }]}>
              <TouchableOpacity
                onPress={() => setManualStatus("completed")}
                style={[
                  sx.statusPill,
                  {
                    backgroundColor:
                      manualStatus === "completed"
                        ? theme.primaryBg
                        : theme.cardSoft,
                  },
                ]}
                activeOpacity={0.88}
              >
                <Text
                  style={[
                    sx.statusPillText,
                    {
                      color:
                        manualStatus === "completed"
                          ? theme.primaryText
                          : theme.text,
                    },
                  ]}
                >
                  Completed
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setManualStatus("skipped")}
                style={[
                  sx.statusPill,
                  {
                    backgroundColor:
                      manualStatus === "skipped"
                        ? "rgba(220,38,38,0.16)"
                        : theme.cardSoft,
                  },
                ]}
                activeOpacity={0.88}
              >
                <Text
                  style={[
                    sx.statusPillText,
                    {
                      color:
                        manualStatus === "skipped"
                          ? theme.danger
                          : theme.text,
                    },
                  ]}
                >
                  Skipped
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[sx.fieldShell, sx.multiField, { backgroundColor: theme.card2 }]}>
              <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Notes</Text>
              <TextInput
                value={manualNotes}
                onChangeText={setManualNotes}
                placeholder="Add context for this session (optional)"
                placeholderTextColor={theme.subtext}
                multiline
                style={[sx.inputText, sx.multiInput, { color: theme.text }]}
              />
            </View>
          </ScrollView>

          <View
            style={[
              sx.bottomBar,
              {
                backgroundColor: theme.bg,
                borderTopColor: theme.border,
                paddingBottom: 8,
              },
            ]}
          >
            <TouchableOpacity
              onPress={saveManualLog}
              disabled={saving}
              style={[
                sx.saveBtn,
                { backgroundColor: theme.primaryBg, opacity: saving ? 0.8 : 1 },
              ]}
              activeOpacity={0.9}
            >
              <Text style={[sx.saveBtnText, { color: theme.primaryText }]}>
                {saving ? "Saving..." : "Save Session Log"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}>
      {ScreenHeader}
      <View style={sx.root}>
        <View
          style={[
            sx.stickyHeader,
            {
              paddingTop: 2,
              backgroundColor: theme.bg,
              borderBottomColor: theme.border,
            },
          ]}
        >
          <TouchableOpacity
            onPress={resumeLive}
            activeOpacity={0.85}
            style={sx.stickyLeftBtn}
          >
            <Text style={[sx.stickyLeftText, { color: theme.text }]}>Resume</Text>
          </TouchableOpacity>
          <Text style={[sx.stickyTitle, { color: theme.text }]}>Save Activity</Text>
          <View style={sx.stickyRightGhost} />
        </View>

        <ScrollView
          contentContainerStyle={[
            sx.scrollContent,
            { paddingBottom: 96 },
          ]}
          showsVerticalScrollIndicator
        >
          <View style={[sx.heroCard, { backgroundColor: theme.card2 }]}>
            <View style={sx.heroTop}>
              <View
                style={[
                  sx.heroModePill,
                  {
                    backgroundColor: isStrength
                      ? "rgba(59,130,246,0.16)"
                      : "rgba(16,163,74,0.16)",
                  },
                ]}
              >
                <Feather
                  name={isStrength ? "shield" : "activity"}
                  size={14}
                  color={theme.text}
                />
                <Text style={[sx.heroModeText, { color: theme.text }]}>
                  {isStrength ? "Strength" : "Run"}
                </Text>
              </View>
              <Text style={[sx.heroTitle, { color: theme.text }]} numberOfLines={1}>
                {title || defaultTitle}
              </Text>
            </View>

            {!isStrength ? (
              <View style={sx.heroStatsRow}>
                <View style={[sx.heroStatCard, { backgroundColor: theme.cardSoft }]}>
                  <Text style={[sx.heroStatValue, { color: theme.text }]}>
                    {draftDistanceKm > 0 ? draftDistanceKm.toFixed(2) : "0.00"}
                  </Text>
                  <Text style={[sx.heroStatLabel, { color: theme.subtext }]}>km</Text>
                </View>
                <View style={[sx.heroStatCard, { backgroundColor: theme.cardSoft }]}>
                  <Text style={[sx.heroStatValue, { color: theme.text }]}>
                    {secondsToHMMSS(draftDurationSec)}
                  </Text>
                  <Text style={[sx.heroStatLabel, { color: theme.subtext }]}>time</Text>
                </View>
                <View style={[sx.heroStatCard, { backgroundColor: theme.cardSoft }]}>
                  <Text style={[sx.heroStatValue, { color: theme.text }]}>{draftPace}</Text>
                  <Text style={[sx.heroStatLabel, { color: theme.subtext }]}>pace</Text>
                </View>
              </View>
            ) : (
              <View style={sx.heroStatsRow}>
                <View style={[sx.heroStatCard, { backgroundColor: theme.cardSoft }]}>
                  <Text style={[sx.heroStatValue, { color: theme.text }]}>
                    {secondsToHMMSS(draftDurationSec)}
                  </Text>
                  <Text style={[sx.heroStatLabel, { color: theme.subtext }]}>elapsed</Text>
                </View>
                <View style={[sx.heroStatCard, { backgroundColor: theme.cardSoft }]}>
                  <Text style={[sx.heroStatValue, { color: theme.text }]}>
                    {draftLoggedExercises}
                  </Text>
                  <Text style={[sx.heroStatLabel, { color: theme.subtext }]}>logged</Text>
                </View>
              </View>
            )}
          </View>

          <View style={[sx.bulletCard, { backgroundColor: theme.card2 }]}>
            <Text style={[sx.bulletTitle, { color: theme.text }]}>Session complete</Text>
            {sessionCompleteBullets.map((line, idx) => (
              <View key={`bullet-${idx}`} style={sx.bulletRow}>
                <Text style={[sx.bulletDot, { color: theme.subtext }]}>•</Text>
                <Text style={[sx.bulletText, { color: theme.subtext }]}>{line}</Text>
              </View>
            ))}
          </View>

          <Text style={[sx.sectionTitle, { color: theme.text }]}>Post</Text>
          <View style={[sx.fieldShell, { backgroundColor: theme.card2 }]}>
            <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Activity title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={isStrength ? "Morning Weight Training" : "Morning Run"}
              placeholderTextColor={theme.subtext}
              style={[sx.inputText, { color: theme.text }]}
            />
          </View>
          <View style={[sx.fieldShell, sx.multiField, { backgroundColor: theme.card2 }]}>
            <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Public description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="How did the session go?"
              placeholderTextColor={theme.subtext}
              multiline
              style={[sx.inputText, sx.multiInput, { color: theme.text }]}
            />
          </View>

          <Text style={[sx.sectionSub, { color: theme.subtext }]}>Photos</Text>
          <TouchableOpacity
            onPress={pickPhotos}
            style={[sx.photoAddRow, { backgroundColor: theme.card2 }]}
            activeOpacity={0.86}
          >
            <View style={sx.photoAddLeft}>
              <Feather name="image" size={18} color={theme.text} />
              <Text style={[sx.photoAddText, { color: theme.text }]}>Add photos</Text>
            </View>
            <Text style={[sx.photoCountText, { color: theme.subtext }]}>
              {photos.length}/8
            </Text>
          </TouchableOpacity>

          {photos.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={sx.photoStrip}
            >
              {photos.map((p, idx) => (
                <View key={`${p.id}_${idx}`} style={sx.photoItem}>
                  <Image source={{ uri: p.uri }} style={sx.photoThumb} />
                  <TouchableOpacity
                    onPress={() => removePhoto(p.id)}
                    style={[sx.photoRemoveBtn, { backgroundColor: theme.card2 }]}
                    activeOpacity={0.9}
                  >
                    <Feather name="x" size={12} color={theme.text} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : null}

          <Text style={[sx.sectionTitle, { color: theme.text }]}>Training Context</Text>
          <Text style={[sx.sectionSub, { color: theme.subtext }]}>Activity tag</Text>
          <View style={sx.chipRow}>
            {tagOptions.map((tag) => {
              const active = tag === activityTag;
              return (
                <TouchableOpacity
                  key={`tag-${tag}`}
                  onPress={() => setActivityTag(tag)}
                  style={[
                    sx.chip,
                    {
                      backgroundColor: active ? theme.primaryBg : theme.card2,
                    },
                  ]}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      sx.chipText,
                      { color: active ? theme.primaryText : theme.text },
                    ]}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[sx.sectionSub, { color: theme.subtext }]}>How it felt</Text>
          <View style={sx.chipRow}>
            {FEEL_OPTIONS.map((option) => {
              const active = option === feeling;
              return (
                <TouchableOpacity
                  key={`feel-${option}`}
                  onPress={() => setFeeling(option)}
                  style={[
                    sx.chip,
                    {
                      backgroundColor: active ? theme.cardSoft : theme.card2,
                    },
                  ]}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      sx.chipText,
                      {
                        color: active ? theme.text : theme.subtext,
                        fontWeight: active ? "800" : "700",
                      },
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[sx.sectionTitle, { color: theme.text }]}>Privacy</Text>
          <Text style={[sx.sectionSub, { color: theme.subtext }]}>Who can view</Text>
          <View style={sx.chipRow}>
            {VISIBILITY_OPTIONS.map((option) => {
              const active = option === visibility;
              return (
                <TouchableOpacity
                  key={`vis-${option}`}
                  onPress={() => setVisibility(option)}
                  style={[
                    sx.chip,
                    {
                      backgroundColor: active ? theme.primaryBg : theme.card2,
                    },
                  ]}
                  activeOpacity={0.88}
                >
                  <Text
                    style={[
                      sx.chipText,
                      { color: active ? theme.primaryText : theme.text },
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={() => setHiddenDetails(cycleOption(hiddenDetails, HIDDEN_OPTIONS))}
            style={[sx.rowButton, { backgroundColor: theme.card2 }]}
            activeOpacity={0.86}
          >
            <View style={sx.rowButtonLeft}>
              <Feather name="eye-off" size={18} color={theme.subtext} />
              <Text style={[sx.rowButtonMuted, { color: theme.subtext }]}>Hidden details</Text>
            </View>
            <Text style={[sx.rowButtonValue, { color: theme.text }]}>{hiddenDetails}</Text>
          </TouchableOpacity>

          <View style={[sx.fieldShell, sx.multiField, { backgroundColor: theme.card2 }]}>
            <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Private notes</Text>
            <TextInput
              value={privateNotes}
              onChangeText={setPrivateNotes}
              placeholder="Only visible to you"
              placeholderTextColor={theme.subtext}
              multiline
              style={[sx.inputText, sx.multiInput, { color: theme.text }]}
            />
          </View>

          <View style={[sx.muteWrap, { backgroundColor: theme.card2 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[sx.muteTitle, { color: theme.text }]}>Mute activity</Text>
              <Text style={[sx.muteDesc, { color: theme.subtext }]}>
                Keep this off your home or club feeds.
              </Text>
            </View>
            <Switch value={muteActivity} onValueChange={setMuteActivity} />
          </View>

          <TouchableOpacity onPress={discardActivity} style={sx.discardBtn} activeOpacity={0.85}>
            <Text style={[sx.discardText, { color: theme.danger }]}>Discard Activity</Text>
          </TouchableOpacity>
        </ScrollView>

        <View
          style={[
            sx.bottomBar,
            {
              backgroundColor: theme.bg,
              borderTopColor: theme.border,
              paddingBottom: 8,
            },
          ]}
        >
          <TouchableOpacity
            onPress={saveActivity}
            disabled={saving}
            style={[
              sx.saveBtn,
              { backgroundColor: theme.primaryBg, opacity: saving ? 0.8 : 1 },
            ]}
            activeOpacity={0.9}
          >
            <Text style={[sx.saveBtnText, { color: theme.primaryText }]}>
              {saving ? "Saving..." : "Save Activity"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const sx = StyleSheet.create({
  safe: { flex: 1 },
  root: { flex: 1 },
  stickyHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stickyLeftBtn: {
    width: 76,
    minHeight: 32,
    justifyContent: "center",
  },
  stickyLeftText: {
    fontSize: 17,
    fontWeight: "500",
  },
  stickyTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  stickyRightGhost: {
    width: 76,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  heroCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heroModePill: {
    minHeight: 26,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroModeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  heroTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  heroStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  heroStatCard: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  heroStatValue: {
    fontSize: 17,
    fontWeight: "800",
  },
  heroStatLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  bulletCard: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  bulletTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  bulletDot: {
    width: 14,
    fontSize: 16,
    lineHeight: 22,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 22,
  },
  sectionTitle: {
    marginTop: 14,
    marginBottom: 10,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  sectionSub: {
    marginTop: 2,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: "700",
  },
  statusRail: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    padding: 6,
    marginBottom: 12,
  },
  statusPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  statusPillText: {
    fontWeight: "900",
    fontSize: 14,
  },
  fieldShell: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.45,
    marginBottom: 7,
  },
  inputText: {
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22,
    paddingVertical: 2,
  },
  multiField: {
    minHeight: 146,
    justifyContent: "flex-start",
  },
  multiInput: {
    minHeight: 110,
    lineHeight: 32,
    textAlignVertical: "top",
  },
  photoAddRow: {
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoAddLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  photoAddText: {
    fontSize: 16,
    fontWeight: "700",
  },
  photoCountText: {
    fontSize: 13,
    fontWeight: "700",
  },
  photoStrip: {
    paddingBottom: 10,
    gap: 10,
  },
  photoItem: {
    width: 82,
    height: 82,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  photoThumb: {
    width: "100%",
    height: "100%",
  },
  photoRemoveBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
    marginBottom: 8,
  },
  chip: {
    minHeight: 42,
    borderRadius: 999,
    paddingHorizontal: 16,
    justifyContent: "center",
    marginHorizontal: 4,
    marginBottom: 10,
  },
  chipText: {
    fontSize: 15,
    fontWeight: "700",
  },
  rowButton: {
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowButtonLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  rowButtonMuted: {
    fontSize: 16,
    fontWeight: "700",
  },
  rowButtonValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  muteWrap: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  muteTitle: {
    fontSize: 17,
    fontWeight: "900",
  },
  muteDesc: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "600",
  },
  discardBtn: {
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 8,
  },
  discardText: {
    fontSize: 17,
    fontWeight: "900",
  },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  saveBtn: {
    minHeight: 60,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
});
