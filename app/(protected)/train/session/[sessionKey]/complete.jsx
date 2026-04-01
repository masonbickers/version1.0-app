import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
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
import { useLiveActivity } from "../../../../../providers/LiveActivityProvider";
import { useTheme } from "../../../../../providers/ThemeProvider";
import { decodeSessionKey } from "../../../../../src/train/utils/sessionHelpers";
import {
  buildPlannedTrainSessionPayload,
  loadPlannedSessionRecord,
  stripNilValues,
} from "../../../../../src/train/utils/sessionRecordHelpers";

export default function SessionCompleteScreen() {
  const router = useRouter();
  const { sessionKey, status: statusParam } = useLocalSearchParams();
  const { colors } = useTheme();
  const { liveActivity, clearLiveActivity } = useLiveActivity();

  const encodedKey = useMemo(
    () => (Array.isArray(sessionKey) ? sessionKey[0] : String(sessionKey || "")),
    [sessionKey]
  );

  const initialStatus = String(Array.isArray(statusParam) ? statusParam[0] : statusParam || "").toLowerCase();
  const [status, setStatus] = useState(initialStatus === "skipped" ? "skipped" : "completed");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingTrainSessionId, setExistingTrainSessionId] = useState(null);
  const pendingSaveDraft = useMemo(() => {
    const draft = liveActivity?.pendingSaveDraft;
    if (!draft || typeof draft !== "object") return null;
    if (!encodedKey) return null;
    if (draft?.sessionKey && String(draft.sessionKey) !== String(encodedKey)) return null;
    return draft;
  }, [encodedKey, liveActivity?.pendingSaveDraft]);
  const hasLiveDraft = !!pendingSaveDraft?.payload;

  useEffect(() => {
    if (hasLiveDraft) {
      setNotes(String(pendingSaveDraft?.payload?.notes || ""));
    }
  }, [hasLiveDraft, pendingSaveDraft?.payload?.notes]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid || !encodedKey) return;

        const snap = await getDoc(doc(db, "users", uid, "sessionLogs", encodedKey));
        if (!snap.exists()) return;

        const log = snap.data() || {};
        const nextTrainSessionId = String(log?.lastTrainSessionId || "").trim();

        if (cancelled) return;

        setExistingTrainSessionId(nextTrainSessionId || null);

        if (!hasLiveDraft) {
          setStatus(String(log?.status || initialStatus || "").toLowerCase() === "skipped" ? "skipped" : "completed");
          setNotes(String(log?.notes || ""));
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [encodedKey, hasLiveDraft, initialStatus]);

  const save = async () => {
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
      const trimmedNotes = notes.trim();
      const source = hasLiveDraft ? "live_save" : "manual_log";
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

      let trainSessionPayload;
      let sessionDate = new Date().toISOString().split("T")[0];

      if (hasLiveDraft) {
        const payload = pendingSaveDraft?.payload || {};
        sessionDate = payload?.date || sessionDate;
        trainSessionPayload = {
          ...payload,
          sessionKey: encodedKey,
          notes: trimmedNotes || payload?.notes || "",
          status,
          source: "live_save",
        };
      } else {
        const plannedRecord = await loadPlannedSessionRecord(uid, encodedKey);
        if (!plannedRecord?.planDoc || !plannedRecord?.session) {
          Alert.alert("Save failed", "Could not find the planned session to save.");
          return;
        }

        const plannedPayload = buildPlannedTrainSessionPayload({
          encodedKey,
          planDoc: plannedRecord.planDoc,
          session: plannedRecord.session,
          dayLabel: plannedRecord.dayLabel,
          status,
          notes: trimmedNotes,
          source: "manual_log",
        });

        sessionDate = plannedPayload.date || sessionDate;
        trainSessionPayload = {
          ...stripNilValues(plannedPayload),
          notes: trimmedNotes || null,
        };
        if (hasExistingTrainSession) {
          delete trainSessionPayload.source;
        }
      }

      const statusFieldsForTrainSession =
        status === "completed"
          ? hasExistingTrainSession
            ? {
                updatedAt: serverTimestamp(),
                completedAt: serverTimestamp(),
                skippedAt: deleteField(),
              }
            : {
                createdAt: serverTimestamp(),
                completedAt: serverTimestamp(),
              }
          : hasExistingTrainSession
          ? {
              updatedAt: serverTimestamp(),
              skippedAt: serverTimestamp(),
              completedAt: deleteField(),
            }
          : {
              createdAt: serverTimestamp(),
              skippedAt: serverTimestamp(),
            };

      const sessionLogPayload = {
        sessionKey: encodedKey,
        planId: planId || null,
        weekIndex,
        dayIndex,
        sessionIndex,
        date: sessionDate,
        status,
        source,
        notes: trimmedNotes || null,
        lastTrainSessionId: trainSessionRef.id,
        updatedAt: serverTimestamp(),
        statusAt: serverTimestamp(),
        ...(status === "completed"
          ? { completedAt: serverTimestamp(), skippedAt: deleteField() }
          : { skippedAt: serverTimestamp(), completedAt: deleteField() }),
      };

      if (hasLiveDraft) {
        if (trainSessionPayload?.live) sessionLogPayload.live = trainSessionPayload.live;
        if (trainSessionPayload?.avgRPE != null) sessionLogPayload.avgRPE = trainSessionPayload.avgRPE;
      }

      if (!existingLogSnap.exists()) {
        sessionLogPayload.createdAt = serverTimestamp();
      }

      const batch = writeBatch(db);
      batch.set(
        trainSessionRef,
        {
          ...trainSessionPayload,
          ...statusFieldsForTrainSession,
        },
        { merge: hasExistingTrainSession }
      );
      batch.set(sessionLogRef, sessionLogPayload, { merge: true });
      await batch.commit();

      setExistingTrainSessionId(trainSessionRef.id);

      if (hasLiveDraft) {
        const beaconSessionId = pendingSaveDraft?.beaconSessionId || null;
        if (beaconSessionId) {
          try {
            await updateDoc(doc(db, "users", uid, "liveSessions", beaconSessionId), {
              status,
              completedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              finalSessionId: trainSessionRef.id,
            });
          } catch {}
        }

        clearLiveActivity();
      }

      Alert.alert("Saved", "Session has been saved to history.", [
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
          <Text style={[styles.title, { color: colors.text }]}>Log Session</Text>
          <View style={styles.iconSpacer} />
        </View>

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.subtext }]}>Status</Text>
          <View style={styles.row}>
            <TouchableOpacity
              onPress={() => setStatus("completed")}
              style={[
                styles.pill,
                {
                  borderColor: colors.border,
                  backgroundColor: status === "completed" ? colors.primary : colors.bg,
                },
              ]}
              activeOpacity={0.85}
            >
              <Text style={{ color: status === "completed" ? "#111111" : colors.text, fontWeight: "700" }}>
                Completed
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setStatus("skipped")}
              style={[
                styles.pill,
                {
                  borderColor: colors.border,
                  backgroundColor: status === "skipped" ? colors.primary : colors.bg,
                },
              ]}
              activeOpacity={0.85}
            >
              <Text style={{ color: status === "skipped" ? "#111111" : colors.text, fontWeight: "700" }}>
                Skipped
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: colors.subtext, marginTop: 16 }]}>Notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional notes"
            placeholderTextColor={colors.subtext}
            multiline
            style={[
              styles.input,
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
            <Text style={{ color: "#111111", fontWeight: "800" }}>
              {saving ? "Saving..." : hasLiveDraft ? "Save activity" : "Save session log"}
            </Text>
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
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  input: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    minHeight: 92,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  primaryBtn: {
    marginTop: 14,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
});
