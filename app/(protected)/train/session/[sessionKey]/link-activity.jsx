import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
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
  buildPlannedTrainSessionPayload,
  loadPlannedSessionRecord,
  stripNilValues,
} from "../../../../../src/train/utils/sessionRecordHelpers";

const PROVIDERS = ["Garmin", "Strava", "Apple Health", "Other"];

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
      const linkedActivity = {
        provider,
        reference: trimmedReference,
      };

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

      const plannedPayload = buildPlannedTrainSessionPayload({
        encodedKey,
        planDoc: plannedRecord.planDoc,
        session: plannedRecord.session,
        dayLabel: plannedRecord.dayLabel,
        status: "completed",
        notes: trimmedNotes,
        source: "linked_activity",
        linkedActivity,
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
          ...(existingLogSnap.exists() ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );

      await batch.commit();
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
            placeholder="e.g. https://strava.com/activities/... or 123456"
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
