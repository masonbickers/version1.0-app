"use client";

/**
 * MEAL SCAN — Train-R (SAP GEL style)
 * ✅ Opens camera, takes photo, sends to backend
 * ✅ Shows AI guess (title + macros + notes)
 * ✅ User taps Correct / Wrong (Wrong re-scan)
 * ✅ If Correct -> prompts meal type (Breakfast/Lunch/Dinner/Snack)
 * ✅ Logs to Firestore on the selected day (param date)
 * ✅ Stays on the page so user can scan/log multiple meals
 *
 * Route: /nutrition/meal-scan
 * File: app/(protected)/nutrition/meal-scan.jsx
 */

import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    Timestamp,
    addDoc,
    collection,
    serverTimestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
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
  base.setHours(
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
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

/* ---------------- page ---------------- */

export default function MealScanPage() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");
  const silverLight =
    colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const s = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  const selectedDateISO = useMemo(
    () => startOfDayISO(params?.date),
    [params?.date]
  );

  const selectedDayLabel = useMemo(
    () => formatDayLabel(selectedDateISO),
    [selectedDateISO]
  );

  const initialMeal =
    params?.mealType && MEAL_TYPES.includes(String(params.mealType))
      ? String(params.mealType)
      : "";

  const [candidate, setCandidate] = useState(null); // { title, calories, protein, carbs, fat, notes }
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // meal prompt after "Correct"
  const [mealPromptOpen, setMealPromptOpen] = useState(false);
  const [chosenMeal, setChosenMeal] = useState(initialMeal);

  const goBack = useCallback(() => {
    router.replace({
      pathname: "/nutrition/add",
      params: { date: selectedDateISO, mealType: chosenMeal || "" },
    });
  }, [router, selectedDateISO, chosenMeal]);

  const requestCameraAccess = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      const granted = status === "granted";
      setCameraReady(granted);
      return granted;
    } catch {
      setCameraReady(false);
      return false;
    }
  }, []);

  useEffect(() => {
    // pre-request camera permission
    (async () => {
      await requestCameraAccess();
    })();
  }, [requestCameraAccess]);

  const takePhotoAndAnalyse = useCallback(async () => {
    if (busy) return;
    if (!API_URL) {
      Alert.alert("Config error", "Missing API_URL (EXPO_PUBLIC_API_URL).");
      return;
    }

    const hasAccess = await requestCameraAccess();
    if (!hasAccess) {
      Alert.alert(
        "Camera required",
        "Please enable camera access in Settings to scan meals.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              Linking.openSettings().catch(() => {});
            },
          },
        ]
      );
      return;
    }

    try {
      setBusy(true);

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled) return;
      const imageBase64 = result.assets?.[0]?.base64 || "";
      if (!imageBase64) {
        throw new Error("No image data captured. Please try again.");
      }

      const res = await fetch(`${API_URL}/nutrition/estimate-macros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const next = {
        title: data?.title || "Meal",
        calories: Number(data?.calories || 0),
        protein: Number(data?.protein || 0),
        carbs: Number(data?.carbs || 0),
        fat: Number(data?.fat || 0),
        notes: data?.notes || "",
        // optional extras
        fibre: Number(data?.fibre ?? data?.fiber ?? 0) || 0,
        sugar: Number(data?.sugar ?? 0) || 0,
        sodium: Number(data?.sodium ?? 0) || 0,
        source: "meal-scan",
      };

      setCandidate(next);
    } catch (e) {
      Alert.alert("Scan failed", e?.message || "Could not scan meal.");
    } finally {
      setBusy(false);
    }
  }, [busy, requestCameraAccess]);

  const onWrong = useCallback(async () => {
    // re-scan: just open camera again
    setCandidate(null);
    await takePhotoAndAnalyse();
  }, [takePhotoAndAnalyse]);

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
          title: candidate.title || "Meal",
          mealType: mealTypeFinal || "Unspecified",
          calories: Number(candidate.calories || 0),
          protein: Number(candidate.protein || 0),
          carbs: Number(candidate.carbs || 0),
          fat: Number(candidate.fat || 0),
          fibre: Number(candidate.fibre || 0),
          sugar: Number(candidate.sugar || 0),
          sodium: Number(candidate.sodium || 0),
          notes: candidate.notes || "Meal scan",
          source: "meal-scan",
          date: dateTs,
          createdAt: serverTimestamp(),
        });

        setMealPromptOpen(false);
        setChosenMeal(mealTypeFinal);
        Alert.alert("Food added", "Added to your day.");

        // stay here so they can scan again
        setCandidate(null);
      } catch (e) {
        Alert.alert("Couldn’t add meal", e?.message || "Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [candidate, selectedDateISO]
  );

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.page}>
          {/* Top bar */}
          <View style={s.topBar}>
            <TouchableOpacity onPress={goBack} style={s.iconBtn} activeOpacity={0.8}>
              <Feather name="chevron-left" size={20} color={colors.text} />
            </TouchableOpacity>

            <View style={{ alignItems: "center", flex: 1 }}>
              <Text style={s.topTitle}>Meal scan</Text>
              <View style={s.dayPill}>
                <Text style={s.dayPillText}>{selectedDayLabel}</Text>
              </View>
            </View>

            <View style={{ width: 40 }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
            {/* Primary action */}
            <TouchableOpacity
              style={s.scanBtn}
              onPress={takePhotoAndAnalyse}
              activeOpacity={0.9}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Feather name="camera" size={18} color="#111111" />
                  <Text style={s.scanBtnText}>{candidate ? "Scan again" : "Scan meal"}</Text>
                </>
              )}
            </TouchableOpacity>

            {!cameraReady ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>Camera permission needed</Text>
                <Text style={s.cardText}>
                  Enable camera access to scan meals. If you’ve denied it before, turn it on in
                  Settings.
                </Text>
                <View style={{ height: 12 }} />
                <TouchableOpacity
                  style={s.recheckBtn}
                  onPress={() => {
                    requestCameraAccess().then((granted) => {
                      if (!granted) {
                        Linking.openSettings().catch(() => {});
                      }
                    });
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="settings" size={16} color={colors.text} />
                  <Text style={s.recheckBtnText}>Open Settings</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Result */}
            {candidate ? (
              <View style={s.card}>
                <Text style={s.cardTitle}>AI found</Text>

                <View style={s.resultBox}>
                  <Text style={s.resultTitle}>{candidate.title}</Text>
                  <Text style={s.resultMeta}>
                    {fmt(candidate.calories)} kcal • P {fmt(candidate.protein)}g • C{" "}
                    {fmt(candidate.carbs)}g • F {fmt(candidate.fat)}g
                  </Text>
                  {!!candidate.notes ? (
                    <Text style={s.resultNotes} numberOfLines={4}>
                      {candidate.notes}
                    </Text>
                  ) : null}
                </View>

                <View style={s.btnRow}>
                  <TouchableOpacity
                    style={[s.btn, s.btnGhost]}
                    onPress={onWrong}
                    activeOpacity={0.9}
                    disabled={busy}
                  >
                    <Feather name="refresh-cw" size={16} color={colors.text} />
                    <Text style={s.btnGhostText}>Wrong</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.btn, s.btnSolid]}
                    onPress={onCorrect}
                    activeOpacity={0.9}
                    disabled={busy}
                  >
                    <Feather name="check" size={16} color="#111111" />
                    <Text style={s.btnSolidText}>Correct</Text>
                  </TouchableOpacity>
                </View>

                <Text style={s.hint}>
                  Correct will ask which meal to log it under, then save to {selectedDayLabel}.
                </Text>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.cardTitle}>How it works</Text>
                <Text style={s.cardText}>
                  Take a photo of your meal. We’ll estimate calories and macros. Confirm if it’s right,
                  then choose Breakfast / Lunch / Dinner / Snack to log it.
                </Text>
              </View>
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
                  <TouchableOpacity
                    onPress={() => setMealPromptOpen(false)}
                    style={s.modalClose}
                    activeOpacity={0.85}
                  >
                    <Feather name="x" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={s.modalSub}>
                  {candidate?.title || "Meal"} • {selectedDayLabel}
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
                      <Text style={[s.modalItemText, active && s.modalItemTextActive]}>
                        {mt}
                      </Text>
                      {active ? <Feather name="check" size={16} color="#111111" /> : null}
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  style={s.modalCancel}
                  onPress={() => setMealPromptOpen(false)}
                  activeOpacity={0.85}
                >
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

    scanBtn: {
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
      marginBottom: 12,
    },
    scanBtnText: {
      color: "#111111",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 12,
    },

    recheckBtn: {
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
    },
    recheckBtnText: {
      color: colors.text,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },

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
