"use client";

/**
 * VOICE LOG — Train-R (SAP GEL style) — VOICE ONLY (NO TEXT INPUT)
 * ✅ Tap Record -> listens & transcribes live
 * ✅ Auto-stops -> runs AI estimate from transcript (/nutrition/describe-meal)
 * ✅ Shows AI guess (title + macros + notes)
 * ✅ User taps Correct / Wrong (Wrong clears & lets you record again)
 * ✅ If Correct -> prompts meal type (Breakfast/Lunch/Dinner/Snack)
 * ✅ Logs to Firestore on the selected day (param date)
 * ✅ Stays on the page so user can log multiple items
 *
 * Route: /nutrition/voice-log
 * File: app/(protected)/nutrition/voice-log.jsx
 *
 * REQUIRES:
 * - @react-native-voice/voice installed
 * - running in a Dev Client (not Expo Go)
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { Timestamp, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

function startOfDayISO(inputISO) {
  const d = inputISO ? new Date(String(inputISO)) : new Date();
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback.toISOString();
  }
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function timestampOnSelectedDay(selectedDayISO) {
  const base = new Date(String(selectedDayISO));
  if (Number.isNaN(base.getTime())) return Timestamp.fromDate(new Date());
  const now = new Date();
  base.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return Timestamp.fromDate(base);
}

function fmt(n) {
  const v = Number(n || 0);
  return Number.isNaN(v) ? "0" : String(Math.round(v));
}

function formatDayLabel(iso) {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "Today";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------------- Voice import (required) ---------------- */

let Voice = null;
try {
  Voice = require("@react-native-voice/voice").default;
} catch {
  Voice = null;
}

/* ---------------- page ---------------- */

export default function VoiceLogPage() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");
  const silverLight = colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const s = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  const selectedDateISO = useMemo(() => startOfDayISO(params?.date), [params?.date]);
  const selectedDayLabel = useMemo(() => formatDayLabel(selectedDateISO), [selectedDateISO]);

  const initialMeal =
    params?.mealType && MEAL_TYPES.includes(String(params.mealType)) ? String(params.mealType) : "";

  // voice state
  const [voiceReady, setVoiceReady] = useState(!!Voice);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [partial, setPartial] = useState("");

  // AI result
  const [candidate, setCandidate] = useState(null);

  // meal prompt
  const [mealPromptOpen, setMealPromptOpen] = useState(false);
  const [chosenMeal, setChosenMeal] = useState(initialMeal || "");

  const listeningRef = useRef(false);
  const stoppedByUserRef = useRef(false);
  const transcriptRef = useRef("");
  const partialRef = useRef("");
  const autoAnalyseRef = useRef(null);

  // auth gate
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.replace("/(auth)/login");
    });
    return () => unsub();
  }, [router]);

  const goBack = useCallback(() => {
    router.replace({
      pathname: "/nutrition/add",
      params: { date: selectedDateISO, mealType: chosenMeal || "" },
    });
  }, [router, selectedDateISO, chosenMeal]);

  const autoAnalyseIfPossible = useCallback(async (spokenText = "") => {
    const text = String(spokenText || transcriptRef.current || partialRef.current || "").trim();
    if (!text) return;
    if (!API_URL) {
      Alert.alert("Config error", "Missing API_URL (EXPO_PUBLIC_API_URL).");
      return;
    }

    try {
      setBusy(true);

      const res = await fetch(`${API_URL}/nutrition/describe-meal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const next = {
        title: data?.title || text,
        calories: Number(data?.calories || 0),
        protein: Number(data?.protein || 0),
        carbs: Number(data?.carbs || 0),
        fat: Number(data?.fat || 0),
        notes: data?.notes || "",
        fibre: Number(data?.fibre ?? data?.fiber ?? 0) || 0,
        sugar: Number(data?.sugar ?? 0) || 0,
        sodium: Number(data?.sodium ?? 0) || 0,
        raw: data,
        source: "voice",
        spokenText: text,
      };

      setCandidate(next);
    } catch (e) {
      Alert.alert("Couldn’t analyse", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    autoAnalyseRef.current = autoAnalyseIfPossible;
  }, [autoAnalyseIfPossible]);

  /* ---------------- Voice lifecycle ---------------- */

  useEffect(() => {
    let mounted = true;

    if (!Voice) {
      setVoiceReady(false);
      return;
    }

    (async () => {
      try {
        const available = await Voice.isAvailable();
        if (mounted) setVoiceReady(Boolean(available));
      } catch {
        // If availability check fails on a device, still allow start() attempt.
        if (mounted) setVoiceReady(true);
      }
    })();

    Voice.onSpeechStart = () => {
      listeningRef.current = true;
      setListening(true);
      setPartial("");
      partialRef.current = "";
      stoppedByUserRef.current = false;
    };

    Voice.onSpeechEnd = async () => {
      listeningRef.current = false;
      setListening(false);

      // If we didn't stop manually, we can auto-analyse after speech ends
      if (!stoppedByUserRef.current) {
        const spoken = String(transcriptRef.current || partialRef.current || "").trim();
        if (!spoken) return;
        // Give results a beat to land (some devices fire end before results)
        setTimeout(() => {
          autoAnalyseRef.current?.(spoken);
        }, 250);
      }
    };

    Voice.onSpeechResults = (e) => {
      const text = e?.value?.[0] || "";
      if (text) {
        setTranscript(text);
        setPartial("");
        transcriptRef.current = text;
        partialRef.current = "";
      }
    };

    Voice.onSpeechPartialResults = (e) => {
      const text = e?.value?.[0] || "";
      if (text) {
        setPartial(text);
        partialRef.current = text;
      }
    };

    Voice.onSpeechError = (e) => {
      listeningRef.current = false;
      setListening(false);
      const msg = String(e?.error?.message || "Voice recognition failed.");
      const normalized = msg.toLowerCase();
      if (normalized.includes("no speech") || normalized.includes("no match") || normalized.includes("timeout")) {
        return;
      }
      Alert.alert("Voice error", msg);
    };

    return () => {
      mounted = false;
      try {
        Voice.destroy();
      } catch {}
      try {
        Voice.removeAllListeners();
      } catch {}
    };
  }, []);

  const startListening = useCallback(async () => {
    if (!Voice) return;
    if (busy) return;
    if (!voiceReady) {
      Alert.alert("Voice unavailable", "Speech recognition is not available on this device.");
      return;
    }

    try {
      setCandidate(null);
      setTranscript("");
      setPartial("");
      transcriptRef.current = "";
      partialRef.current = "";
      stoppedByUserRef.current = false;

      // en-GB for UK
      await Voice.start("en-GB");
    } catch (e) {
      setListening(false);
      Alert.alert("Couldn’t start voice", e?.message || "Try again.");
    }
  }, [busy, voiceReady]);

  const stopListening = useCallback(async () => {
    if (!Voice) return;
    try {
      stoppedByUserRef.current = true;
      await Voice.stop();
      setListening(false);
    } catch {}
  }, []);

  const onWrong = useCallback(() => {
    setCandidate(null);
    setMealPromptOpen(false);
    setTranscript("");
    setPartial("");
    transcriptRef.current = "";
    partialRef.current = "";
  }, []);

  const onCorrect = useCallback(() => {
    if (!candidate) return;
    setMealPromptOpen(true);
  }, [candidate]);

  const logCandidate = useCallback(
    async (mealTypeFinal) => {
      const u = auth.currentUser;
      if (!u) {
        Alert.alert("Sign in required", "Please sign in again.");
        return;
      }
      if (!candidate) return;

      try {
        setBusy(true);
        const dateTs = timestampOnSelectedDay(selectedDateISO);

        await addDoc(collection(db, "users", u.uid, "meals"), {
          title: candidate.title || "Food",
          mealType: mealTypeFinal || "Unspecified",
          calories: Number(candidate.calories || 0),
          protein: Number(candidate.protein || 0),
          carbs: Number(candidate.carbs || 0),
          fat: Number(candidate.fat || 0),
          fibre: Number(candidate.fibre || 0),
          sugar: Number(candidate.sugar || 0),
          sodium: Number(candidate.sodium || 0),
          notes: candidate.notes || `Voice log: ${candidate.spokenText || ""}`,
          source: "voice",
          spokenText: candidate.spokenText || "",
          date: dateTs,
          createdAt: serverTimestamp(),
        });

        setMealPromptOpen(false);
        setChosenMeal(mealTypeFinal);

        Alert.alert("Food added", "Added to your day.");

        // stay on page so they can do another
        setCandidate(null);
        setTranscript("");
        setPartial("");
        transcriptRef.current = "";
        partialRef.current = "";
      } catch (e) {
        Alert.alert("Couldn’t add item", e?.message || "Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [candidate, selectedDateISO]
  );

  const displayHeard = useMemo(() => {
    const t = (transcript || partial || "").trim();
    return t;
  }, [transcript, partial]);

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.page}>
          {/* Top bar */}
          <View style={s.topBar}>
            <TouchableOpacity onPress={goBack} style={s.iconBtn} activeOpacity={0.8}>
              <Feather name="chevron-left" size={20} color={colors.text} />
            </TouchableOpacity>

            <View style={{ alignItems: "center", flex: 1 }}>
              <Text style={s.topTitle}>Voice log</Text>
              <View style={s.dayPill}>
                <Text style={s.dayPillText}>{selectedDayLabel}</Text>
              </View>
            </View>

            <View style={{ width: 40 }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
            {/* Voice-only requirement */}
            {!voiceReady ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>Voice not available</Text>
                <Text style={s.cardText}>
                  This screen requires native voice recognition. Install @react-native-voice/voice
                  and run in a Dev Client (not Expo Go).
                </Text>

                <View style={{ height: 12 }} />

                <TouchableOpacity style={s.secondaryBtnWide} onPress={goBack} activeOpacity={0.9}>
                  <Feather name="arrow-left" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnWideText}>Back</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Speak card */}
                <View style={s.card}>
                  <Text style={s.cardTitle}>Speak your food</Text>
                  <Text style={s.cardText}>
                    Tap record and say what you ate. We’ll auto-analyse when you stop talking.
                  </Text>

                  <View style={{ height: 12 }} />

                  <TouchableOpacity
                    style={[s.micBtn, listening && s.micBtnActive, busy && { opacity: 0.7 }]}
                    onPress={listening ? stopListening : startListening}
                    activeOpacity={0.9}
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <ActivityIndicator color="#111111" />
                        <Text style={s.micBtnText}>Working…</Text>
                      </>
                    ) : listening ? (
                      <>
                        <Feather name="mic" size={18} color="#111111" />
                        <Text style={s.micBtnText}>Listening… Tap to stop</Text>
                      </>
                    ) : (
                      <>
                        <Feather name="mic" size={18} color="#111111" />
                        <Text style={s.micBtnText}>Record</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {!!displayHeard ? (
                    <>
                      <View style={{ height: 12 }} />
                      <View style={s.heardBox}>
                        <Text style={s.heardLabel}>Heard</Text>
                        <Text style={s.heardText} numberOfLines={4}>
                          {displayHeard}
                        </Text>
                      </View>
                    </>
                  ) : null}

                  {/* Manual analyse button (optional) — still voice-first, no typing */}
                  {!!displayHeard && !candidate && (
                    <>
                      <View style={{ height: 12 }} />
                      <TouchableOpacity
                        style={[s.secondaryBtnWide, busy && { opacity: 0.7 }]}
                        onPress={autoAnalyseIfPossible}
                        activeOpacity={0.9}
                        disabled={busy}
                      >
                        <Feather name="zap" size={16} color={colors.text} />
                        <Text style={s.secondaryBtnWideText}>Analyse now</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>

                {/* AI result */}
                {candidate ? (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>AI found</Text>

                    <View style={s.resultBox}>
                      <Text style={s.resultTitle}>{candidate.title}</Text>
                      <Text style={s.resultMeta}>
                        {fmt(candidate.calories)} kcal • P {fmt(candidate.protein)}g • C {fmt(candidate.carbs)}g • F{" "}
                        {fmt(candidate.fat)}g
                      </Text>

                      {!!candidate.notes ? (
                        <Text style={s.resultNotes} numberOfLines={4}>
                          {candidate.notes}
                        </Text>
                      ) : null}
                    </View>

                    <View style={s.btnRow}>
                      <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={onWrong} activeOpacity={0.9} disabled={busy}>
                        <Feather name="refresh-cw" size={16} color={colors.text} />
                        <Text style={s.btnGhostText}>Wrong</Text>
                      </TouchableOpacity>

                      <TouchableOpacity style={[s.btn, s.btnSolid]} onPress={onCorrect} activeOpacity={0.9} disabled={busy}>
                        <Feather name="check" size={16} color="#111111" />
                        <Text style={s.btnSolidText}>Correct</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={s.hint}>
                      Correct will ask which meal to log it under, then save to {selectedDayLabel}. You’ll stay here to log more.
                    </Text>
                  </View>
                ) : (
                  <View style={s.card}>
                    <Text style={s.cardTitle}>How it works</Text>
                    <Text style={s.cardText}>
                      Record your voice → we transcribe → AI estimates macros → you confirm and choose Breakfast / Lunch / Dinner / Snack.
                    </Text>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* Meal type prompt */}
          <Modal
            visible={mealPromptOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setMealPromptOpen(false)}
          >
            <Pressable style={s.modalOverlay} onPress={() => setMealPromptOpen(false)}>
              <Pressable style={s.modalCard} onPress={() => {}}>
                <View style={s.modalHead}>
                  <Text style={s.modalTitle}>Add to which meal?</Text>
                  <TouchableOpacity onPress={() => setMealPromptOpen(false)} style={s.modalClose} activeOpacity={0.85}>
                    <Feather name="x" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={s.modalSub}>
                  {candidate?.title || "Food"} • {selectedDayLabel}
                </Text>

                <View style={{ height: 10 }} />

                {MEAL_TYPES.map((mt) => {
                  const active = mt === chosenMeal;
                  return (
                    <TouchableOpacity
                      key={mt}
                      style={[s.modalItem, active && s.modalItemActive]}
                      onPress={() => logCandidate(mt)}
                      activeOpacity={0.9}
                      disabled={busy}
                    >
                      <Text style={[s.modalItemText, active && s.modalItemTextActive]}>{mt}</Text>
                      {active ? <Feather name="check" size={16} color="#111111" /> : null}
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity style={s.modalCancel} onPress={() => setMealPromptOpen(false)} activeOpacity={0.85}>
                  <Text style={s.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1, paddingHorizontal: 18 },

    topBar: {
      marginTop: 6,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: isDark ? "#101114" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      alignItems: "center",
      justifyContent: "center",
    },
    topTitle: {
      fontSize: 15,
      fontWeight: "900",
      letterSpacing: 0.7,
      textTransform: "uppercase",
      color: colors.text,
    },
    dayPill: {
      marginTop: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      alignSelf: "center",
    },
    dayPillText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },

    scroll: { paddingBottom: 24 },

    card: {
      backgroundColor: isDark ? "#111217" : silverLight,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      padding: 14,
      marginBottom: 12,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 0.7,
      textTransform: "uppercase",
      marginBottom: 8,
    },
    cardText: { color: colors.subtext, fontSize: 13, lineHeight: 19 },

    micBtn: {
      backgroundColor: accentBg,
      borderRadius: 18,
      paddingVertical: 14,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    micBtnActive: {
      transform: [{ scale: 0.99 }],
      shadowOpacity: 0.24,
    },
    micBtnText: {
      color: "#111111",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 12,
    },

    heardBox: {
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      borderRadius: 16,
      padding: 12,
    },
    heardLabel: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    heardText: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },

    secondaryBtnWide: {
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
    },
    secondaryBtnWideText: {
      color: colors.text,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },

    resultBox: {
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      borderRadius: 16,
      padding: 12,
    },
    resultTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
    resultMeta: { color: colors.subtext, fontSize: 12, marginTop: 6, fontWeight: "700" },
    resultNotes: { color: colors.subtext, fontSize: 12, marginTop: 8, lineHeight: 18 },

    btnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    btn: {
      flex: 1,
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
    },
    btnGhost: {
      backgroundColor: isDark ? "#111217" : silverLight,
      borderColor: colors.border,
    },
    btnGhostText: {
      color: colors.text,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },
    btnSolid: { backgroundColor: accentBg, borderColor: accentBg },
    btnSolidText: {
      color: "#111111",
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 12, lineHeight: 18 },

    /* modal */
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
      padding: 18,
    },
    modalCard: {
      width: "100%",
      maxWidth: 520,
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      padding: 14,
    },
    modalHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "900",
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    modalClose: {
      width: 36,
      height: 36,
      borderRadius: 14,
      backgroundColor: isDark ? "#111217" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      alignItems: "center",
      justifyContent: "center",
    },
    modalSub: {
      marginTop: 8,
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
    },
    modalItem: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: isDark ? "#111217" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    modalItemActive: { backgroundColor: accentBg, borderColor: accentBg },
    modalItemText: {
      color: colors.text,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },
    modalItemTextActive: { color: "#111111" },
    modalCancel: {
      paddingVertical: 12,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#111217" : silverLight,
      marginTop: 2,
    },
    modalCancelText: {
      color: colors.text,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },
  });
}
