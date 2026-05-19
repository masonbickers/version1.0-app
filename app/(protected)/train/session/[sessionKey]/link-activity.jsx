import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../../../../firebaseConfig";
import { useTheme } from "../../../../../providers/ThemeProvider";
import { decodeSessionKey } from "../../../../../src/train/utils/sessionHelpers";
import {
  buildLinkedActivityPayload,
  validateExternalActivityPlannedSessionMatch,
} from "../../../../../src/train/utils/activitySessionMatch";
import {
  buildPlannedTrainSessionPayload,
  loadPlannedSessionRecord,
  stripNilValues,
} from "../../../../../src/train/utils/sessionRecordHelpers";
import { refreshTrainingWidgetSnapshotForUser } from "../../../../../src/widgets/trainingWidgetSnapshot";

const PROVIDERS = ["Garmin", "Strava"];

function providerCollections(provider) {
  const raw = String(provider || "").toLowerCase();
  if (raw.includes("garmin")) return ["garmin_activities", "garminActivities"];
  if (raw.includes("strava")) return ["stravaActivities"];
  return [];
}

function extractActivityReferenceId(reference) {
  const raw = String(reference || "").trim();
  if (!raw) return "";
  const activityPathMatch = raw.match(/activities\/([^/?#]+)/i);
  if (activityPathMatch?.[1]) return decodeURIComponent(activityPathMatch[1]);
  const trimmed = raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() || raw;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const n = Number(value);
  if (Number.isFinite(n) && n > 1000000000) return n;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toISODateFromMs(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normaliseImportedActivity(docSnap, source, provider) {
  const data = docSnap?.data ? docSnap.data() || {} : docSnap || {};
  const raw = data?.rawGarminActivity || data?.raw || {};
  const startSeconds = Number(
    data?.startTimeInSeconds ??
      data?.activityStartTimeInSeconds ??
      raw?.startTimeInSeconds ??
      raw?.activityStartTimeInSeconds
  );
  const startMs =
    (Number.isFinite(startSeconds) && startSeconds > 0 ? startSeconds * 1000 : 0) ||
    toMillis(data?.startTimeMs) ||
    toMillis(data?.startDateMs) ||
    toMillis(data?.startTime) ||
    toMillis(data?.startDate) ||
    toMillis(data?.startedAt) ||
    toMillis(raw?.startTime) ||
    toMillis(raw?.startDate);
  const distanceMeters = Number(
    data?.distanceMeters ??
      data?.distance ??
      data?.distanceInMeters ??
      raw?.distanceMeters ??
      raw?.distanceInMeters ??
      raw?.distance
  );
  const durationSeconds = Number(
    data?.durationSeconds ??
      data?.movingTime ??
      data?.moving_time ??
      data?.elapsedTime ??
      raw?.durationInSeconds ??
      raw?.movingDurationInSeconds ??
      raw?.elapsedDurationInSeconds
  );
  const averageHeartRate = Number(
    data?.averageHeartRate ??
      data?.average_heartrate ??
      data?.averageHeartRateInBeatsPerMinute ??
      raw?.averageHeartRate ??
      raw?.averageHeartRateInBeatsPerMinute
  );

  return {
    id: String(docSnap?.id || data?.id || data?.activityId || raw?.activityId || ""),
    source,
    provider,
    title:
      data?.name ||
      data?.title ||
      data?.activityName ||
      raw?.activityName ||
      `${provider} activity`,
    type: data?.type || data?.activityType || raw?.activityType || raw?.sport || "",
    device: data?.deviceName || data?.device_name || raw?.deviceName || raw?.device_name || "",
    startMs,
    isoDate: toISODateFromMs(startMs),
    distanceMeters: Number.isFinite(distanceMeters) && distanceMeters > 0 ? distanceMeters : null,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null,
    averageHeartRate: Number.isFinite(averageHeartRate) && averageHeartRate > 0 ? averageHeartRate : null,
  };
}

async function findImportedActivity(uid, provider, reference) {
  const sources = providerCollections(provider);
  const refId = extractActivityReferenceId(reference);
  if (!uid || !sources.length || !refId) return null;

  for (const source of sources) {
    const directSnap = await getDoc(doc(db, "users", uid, source, refId));
    if (directSnap.exists()) {
      return normaliseImportedActivity(directSnap, source, provider);
    }

    const col = collection(db, "users", uid, source);
    for (const field of ["activityId", "id", "upstreamId"]) {
      try {
        const snap = await getDocs(query(col, where(field, "==", refId), limit(1)));
        if (!snap.empty) return normaliseImportedActivity(snap.docs[0], source, provider);
      } catch {}
    }
  }

  return null;
}

export default function LinkActivityScreen() {
  const router = useRouter();
  const { sessionKey, provider: providerParam } = useLocalSearchParams();
  const { colors } = useTheme();

  const encodedKey = useMemo(
    () => (Array.isArray(sessionKey) ? sessionKey[0] : String(sessionKey || "")),
    [sessionKey]
  );
  const initialProvider = useMemo(() => {
    const raw = Array.isArray(providerParam) ? providerParam[0] : providerParam;
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return "Garmin";
    const match = PROVIDERS.find((opt) => opt.toLowerCase() === value);
    return match || "Garmin";
  }, [providerParam]);

  const [provider, setProvider] = useState(initialProvider);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingTrainSessionId, setExistingTrainSessionId] = useState(null);

  useEffect(() => {
    setProvider(initialProvider);
  }, [initialProvider]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid || !encodedKey) return;

        const snap = await getDoc(doc(db, "users", uid, "sessionLogs", encodedKey));
        if (!snap.exists()) return;

        const log = snap.data() || {};
        const linked = log?.linkedActivity || {};
        const nextTrainSessionId = String(log?.lastTrainSessionId || "").trim();

        if (cancelled) return;

        if (linked?.provider) setProvider(String(linked.provider));
        if (linked?.reference) setReference(String(linked.reference));
        if (log?.notes) setNotes(String(log.notes));
        setExistingTrainSessionId(nextTrainSessionId || null);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [encodedKey]);

  const save = async () => {
    try {
      if (!encodedKey) {
        Alert.alert("Invalid session", "This session link is missing its key.");
        return;
      }
      if (!reference.trim()) {
        Alert.alert("Missing activity", "Please add an activity link or ID.");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      setSaving(true);
      const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
      const trimmedNotes = notes.trim();
      const trimmedReference = reference.trim();
      const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
      const existingLogSnap = await getDoc(sessionLogRef);
      const existingLog = existingLogSnap.exists() ? existingLogSnap.data() || {} : null;
      const resolvedTrainSessionId =
        String(existingTrainSessionId || existingLog?.lastTrainSessionId || "").trim() || null;

      let trainSessionRef = resolvedTrainSessionId
        ? doc(db, "users", uid, "trainSessions", resolvedTrainSessionId)
        : doc(collection(db, "users", uid, "trainSessions"));

      let hasExistingTrainSession = false;
      if (resolvedTrainSessionId) {
        const trainSessionSnap = await getDoc(trainSessionRef);
        hasExistingTrainSession = trainSessionSnap.exists();
        if (!hasExistingTrainSession) {
          trainSessionRef = doc(collection(db, "users", uid, "trainSessions"));
        }
      }

      const plannedRecord = await loadPlannedSessionRecord(uid, encodedKey);
      if (!plannedRecord?.planDoc || !plannedRecord?.session) {
        Alert.alert("Save failed", "Could not find the planned session to link.");
        return;
      }

      const importedActivity = await findImportedActivity(uid, provider, trimmedReference);
      if (!importedActivity) {
        Alert.alert(
          "Activity not found",
          "This activity has to exist in your imported Garmin or Strava activities before it can be linked to a planned session."
        );
        return;
      }

      const match = validateExternalActivityPlannedSessionMatch({
        activity: importedActivity,
        session: plannedRecord.session,
        plannedIsoDate: plannedRecord.dayDate || "",
      });
      if (!match.matches) {
        Alert.alert("Does not match planned session", match.reason || "Choose the activity that matches this planned session.");
        return;
      }

      const linkedActivity = buildLinkedActivityPayload(importedActivity);
      const activityOverrides = {
        date: plannedRecord.dayDate || importedActivity.isoDate || null,
        actualDurationMin: linkedActivity.movingTimeMin,
        actualDistanceKm: linkedActivity.distanceKm,
      };

      const plannedPayload = buildPlannedTrainSessionPayload({
        encodedKey,
        planDoc: plannedRecord.planDoc,
        session: plannedRecord.session,
        dayLabel: plannedRecord.dayLabel,
        status: "completed",
        notes: trimmedNotes,
        source: "linked_activity",
        linkedActivity,
        overrides: activityOverrides,
      });

      const trainSessionPayload = {
        ...stripNilValues(plannedPayload),
        notes: trimmedNotes || null,
        linkedActivity,
      };
      if (hasExistingTrainSession) {
        delete trainSessionPayload.source;
      }

      const statusFieldsForTrainSession = hasExistingTrainSession
        ? {
            updatedAt: serverTimestamp(),
            completedAt: serverTimestamp(),
            skippedAt: deleteField(),
          }
        : {
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            completedAt: serverTimestamp(),
          };

      const batch = writeBatch(db);
      batch.set(
        trainSessionRef,
        {
          ...trainSessionPayload,
          ...statusFieldsForTrainSession,
        },
        { merge: hasExistingTrainSession }
      );

      batch.set(
        sessionLogRef,
        {
          sessionKey: encodedKey,
          planId: planId || null,
          weekIndex,
          dayIndex,
          sessionIndex,
          date: plannedPayload.date,
          status: "completed",
          source: "linked_activity",
          notes: trimmedNotes || null,
          linkedActivity,
          lastTrainSessionId: trainSessionRef.id,
          updatedAt: serverTimestamp(),
          statusAt: serverTimestamp(),
          completedAt: serverTimestamp(),
          skippedAt: deleteField(),
          matchStatus: "linked",
          matchConfidence: Math.round(Number(match.score || 0)),
          ...(existingLogSnap.exists() ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );

      batch.set(
        doc(db, "users", uid, importedActivity.source, String(importedActivity.id)),
        {
          linkedSessionKey: encodedKey,
          linkedTrainSessionId: trainSessionRef.id,
          linkStatus: "linked",
          linkedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();
      await refreshTrainingWidgetSnapshotForUser({
        userId: uid,
        reason: "activity_linked",
      }).catch((error) => {
        console.warn("[widgets] linked activity snapshot failed:", error?.message || error);
      });
      setExistingTrainSessionId(trainSessionRef.id);

      Alert.alert("Linked", "Activity has been linked and saved to history.", [
        {
          text: "OK",
          onPress: () => router.replace(`/train/history/${trainSessionRef.id}`),
        },
      ]);
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Link Activity</Text>
          <View style={styles.iconSpacer} />
        </View>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.subtext }]}>Provider</Text>
          <View style={styles.row}>
            {PROVIDERS.map((opt) => {
              const active = provider === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setProvider(opt)}
                  style={[
                    styles.pill,
                    {
                      borderColor: colors.border,
                      backgroundColor: active ? colors.primary : colors.bg,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: active ? "#111111" : colors.text, fontWeight: "700" }}>{opt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.subtext, marginTop: 16 }]}>Activity Link or ID</Text>
          <TextInput
            value={reference}
            onChangeText={setReference}
            placeholder="Garmin or Strava activity link or ID"
            placeholderTextColor={colors.subtext}
            autoCapitalize="none"
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.bg,
              },
            ]}
          />

          <Text style={[styles.label, { color: colors.subtext, marginTop: 12 }]}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={colors.subtext}
            multiline
            style={[
              styles.input,
              styles.multiInput,
              {
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.bg,
              },
            ]}
          />

          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: saving ? colors.border : colors.primary,
              },
            ]}
            activeOpacity={0.9}
          >
            <Text style={{ color: "#111111", fontWeight: "800" }}>{saving ? "Saving..." : "Save link"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  iconSpacer: { width: 40, height: 40 },
  title: { fontSize: 18, fontWeight: "800" },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
  },
  label: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  input: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiInput: {
    minHeight: 82,
    textAlignVertical: "top",
  },
  primaryBtn: {
    marginTop: 14,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
});
