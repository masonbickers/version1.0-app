// app/(protected)/nutrition/goal.jsx

/**
 * NUTRITION GOAL — SAP GEL STYLE
 * Neon yellow accent + silver cards to match Nutrition screens
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
;

// fallbacks (mirror theme tokens)
const FALLBACK_PRIMARY = "#E6FF3B"; // neon yellow
const FALLBACK_SILVER_LIGHT = "#F3F4F6";
const FALLBACK_SILVER_MEDIUM = "#E1E3E8";

const activityOptions = [
  { value: "sedentary", label: "Sedentary (desk, little exercise)" },
  { value: "light", label: "Lightly active (1–2 sessions/week)" },
  { value: "moderate", label: "Moderately active (3–4 sessions/week)" },
  { value: "high", label: "Very active (5+ hard sessions/week)" },
];

const goalOptions = [
  { value: "fat_loss", label: "Fat loss" },
  { value: "maintenance", label: "Maintenance" },
  { value: "muscle_gain", label: "Muscle gain" },
];

export default function NutritionGoalPage() {
  const { colors, isDark } = useTheme();

  const PRIMARY = colors.sapPrimary || FALLBACK_PRIMARY;
  const SILVER_LIGHT = colors.sapSilverLight || FALLBACK_SILVER_LIGHT;
  const SILVER_MEDIUM = colors.sapSilverMedium || FALLBACK_SILVER_MEDIUM;

  const router = useRouter();
  const user = auth.currentUser;

  const s = useMemo(
    () => makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM),
    [colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM]
  );

  const [sex, setSex] = useState("male");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [activityLevel, setActivityLevel] = useState("moderate");
  const [goalType, setGoalType] = useState("maintenance");
  const [extraNotes, setExtraNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // usability: derived validity
  const isFormValid = useMemo(
    () => !!age.trim() && !!heightCm.trim() && !!weightKg.trim(),
    [age, heightCm, weightKg]
  );

  // load existing profile if present
  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      try {
        const ref = doc(db, "users", user.uid, "nutrition", "profile");
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const d = snap.data();
          if (d.sex) setSex(d.sex);
          if (d.age) setAge(String(d.age));
          if (d.heightCm) setHeightCm(String(d.heightCm));
          if (d.weightKg) setWeightKg(String(d.weightKg));
          if (d.activityLevel) setActivityLevel(d.activityLevel);
          if (d.goalType) setGoalType(d.goalType);
          if (d.extraNotes) setExtraNotes(d.extraNotes);
        }
      } catch (err) {
        console.error("Load nutrition profile error:", err);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  const handleSave = async () => {
    if (!user) {
      Alert.alert("Not signed in", "Please log in again.");
      return;
    }
    if (!API_URL) {
      Alert.alert(
        "Config error",
        "EXPO_PUBLIC_API_URL is not set in your .env."
      );
      return;
    }

    const ageNum = Number(age);
    const hNum = Number(heightCm);
    const wNum = Number(weightKg);

    const invalidAge = !Number.isFinite(ageNum) || ageNum < 12 || ageNum > 100;
    const invalidHeight = !Number.isFinite(hNum) || hNum < 120 || hNum > 230;
    const invalidWeight = !Number.isFinite(wNum) || wNum < 35 || wNum > 300;

    if (invalidAge || invalidHeight || invalidWeight) {
      Alert.alert(
        "Invalid values",
        "Use age 12-100, height 120-230 cm, and weight 35-300 kg."
      );
      return;
    }

    try {
      setSaving(true);

      // ask AI server for full plan (macros + micros + nutrient split)
      const res = await fetch(`${API_URL}/nutrition/plan-goal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sex,
          age: ageNum,
          heightCm: hNum,
          weightKg: wNum,
          activityLevel,
          goalType,
          extraNotes,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Failed to create plan");
      }

      const data = await res.json();

      /* ---------------- core macro targets ---------------- */

      const dailyCalories = Number(data.dailyCalories || data.calories || 0);
      const proteinTarget = Number(data.proteinG || data.protein || 0);
      const carbTarget = Number(data.carbsG || data.carbs || 0);
      const fatTarget = Number(data.fatG || data.fat || 0);

      /* ---------------- micro targets ---------------- */

      const fibreTarget = Number(
        data.fibreG ?? data.fiberG ?? data.fibre ?? data.fiber ?? 0
      );
      const sugarTarget = Number(data.sugarG ?? data.sugar ?? 0);
      const sodiumTarget = Number(data.sodiumMg ?? data.sodium ?? 0);

      const saturatedFatTarget = Number(
        data.saturatedFatG ?? data.satFatG ?? data.saturatedFat ?? 0
      );
      const polyunsaturatedFatTarget = Number(
        data.polyunsaturatedFatG ??
          data.polyFatG ??
          data.polyunsaturatedFat ??
          0
      );
      const monounsaturatedFatTarget = Number(
        data.monounsaturatedFatG ??
          data.monoFatG ??
          data.monounsaturatedFat ??
          0
      );
      const transFatTarget = Number(data.transFatG ?? data.transFat ?? 0);

      const cholesterolTarget = Number(
        data.cholesterolMg ?? data.cholesterol ?? 0
      );

      const potassiumTarget = Number(data.potassiumMg ?? data.potassium ?? 0);
      const calciumTarget = Number(data.calciumMg ?? data.calcium ?? 0);
      const ironTarget = Number(data.ironMg ?? data.iron ?? 0);

      const vitaminATarget = Number(data.vitaminA ?? data.vitaminAIU ?? 0);
      const vitaminCTarget = Number(data.vitaminC ?? data.vitaminCMg ?? 0);

      /* ---------------- nutrient split (% of kcal) ---------------- */

      const macroProteinPct = Number(
        data.proteinPct ??
          data.proteinPercent ??
          data.macroProteinPct ??
          0
      );
      const macroCarbPct = Number(
        data.carbPct ??
          data.carbsPct ??
          data.carbPercent ??
          data.carbsPercent ??
          data.macroCarbPct ??
          0
      );
      const macroFatPct = Number(
        data.fatPct ?? data.fatPercent ?? data.macroFatPct ?? 0
      );

      const activityLevelLabel =
        activityOptions.find((o) => o.value === activityLevel)?.label ||
        activityLevel;
      const goalTypeLabel =
        goalOptions.find((o) => o.value === goalType)?.label || goalType;

      const ref = doc(db, "users", user.uid, "nutrition", "profile");
      await setDoc(
        ref,
        {
          sex,
          age: ageNum,
          heightCm: hNum,
          weightKg: wNum,
          activityLevel,
          activityLevelLabel,
          goalType,
          goalTypeLabel,
          extraNotes,

          // macro targets
          dailyCalories,
          proteinTarget,
          carbTarget,
          fatTarget,

          // micro targets
          fibreTarget,
          sugarTarget,
          sodiumTarget,
          saturatedFatTarget,
          polyunsaturatedFatTarget,
          monounsaturatedFatTarget,
          transFatTarget,
          cholesterolTarget,
          potassiumTarget,
          vitaminATarget,
          vitaminCTarget,
          calciumTarget,
          ironTarget,

          // nutrient split as % of kcal
          macroProteinPct,
          macroCarbPct,
          macroFatPct,

          notes: data.notes || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      router.back();
    } catch (err) {
      console.error("Save nutrition goal error:", err);
      Alert.alert(
        "Could not save goal",
        err?.message || "Something went wrong."
      );
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return null;
  }

  // numeric helpers (small UX clean up)
  const handleNumericChange = (setter) => (text) => {
    const cleaned = text.replace(/[^0-9]/g, "");
    setter(cleaned);
  };

  return (
    <SafeAreaView style={s.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        {/* HEADER — match Nutrition SAP vibe */}
        <View style={s.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={s.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="chevron-left" size={22} color={PRIMARY} />
          </TouchableOpacity>

          <View style={s.headerTextWrap}>
            <Text style={s.headerTitle}>Nutrition goal</Text>
            <Text style={s.headerSubtitle}>
              Let AI set your calories, macros and key nutrients.
            </Text>
          </View>

          <View style={{ width: 32 }} />
        </View>

        <View style={s.helperRow}>
          <View style={s.stepPill}>
            <Text style={s.stepPillText}>3 quick steps</Text>
          </View>
          <Text style={s.helperText}>
            This stays private to your account and you can tweak it anytime.
          </Text>
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={PRIMARY} />
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* STEP 1 ------------------------------------------------ */}
            <View style={s.stepHeaderRow}>
              <Text style={s.sectionTitle}>Step 1</Text>
              <Text style={s.sectionSubTitle}>Your details</Text>
            </View>

            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.label}>Sex</Text>
                <View style={s.segmentRow}>
                  {["male", "female"].map((v) => {
                    const active = sex === v;
                    return (
                      <TouchableOpacity
                        key={v}
                        style={[s.segment, active && s.segmentActive]}
                        onPress={() => setSex(v)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            s.segmentText,
                            active && s.segmentTextActive,
                          ]}
                        >
                          {v === "male" ? "Male" : "Female"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={s.row}>
                <Text style={s.label}>Age</Text>
                <TextInput
                  style={s.input}
                  keyboardType="numeric"
                  value={age}
                  onChangeText={handleNumericChange(setAge)}
                  placeholder="Years"
                  placeholderTextColor={colors.subtext}
                  returnKeyType="next"
                />
                <Text style={s.inputHint}>
                  Used to calculate your base metabolism.
                </Text>
              </View>

              <View style={s.rowTwoCols}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Height (cm)</Text>
                  <TextInput
                    style={s.input}
                    keyboardType="numeric"
                    value={heightCm}
                    onChangeText={handleNumericChange(setHeightCm)}
                    placeholder="e.g. 180"
                    placeholderTextColor={colors.subtext}
                    returnKeyType="next"
                  />
                  <Text style={s.inputHint}>
                    Rough is fine — you can update later.
                  </Text>
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Weight (kg)</Text>
                  <TextInput
                    style={s.input}
                    keyboardType="numeric"
                    value={weightKg}
                    onChangeText={handleNumericChange(setWeightKg)}
                    placeholder="e.g. 75"
                    placeholderTextColor={colors.subtext}
                    returnKeyType="done"
                  />
                  <Text style={s.inputHint}>
                    Helps tailor calorie and protein targets.
                  </Text>
                </View>
              </View>
            </View>

            {/* STEP 2 ------------------------------------------------ */}
            <View style={s.stepHeaderRow}>
              <Text style={s.sectionTitle}>Step 2</Text>
              <Text style={s.sectionSubTitle}>Activity & goal</Text>
            </View>

            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.label}>Activity level</Text>
                <Text style={s.inputHintSmall}>
                  Pick the option that best matches a typical week.
                </Text>
                {activityOptions.map((opt) => {
                  const active = activityLevel === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[s.optionRow, active && s.optionRowActive]}
                      onPress={() => setActivityLevel(opt.value)}
                      activeOpacity={0.8}
                    >
                      <View
                        style={[
                          s.radioOuter,
                          active && s.radioOuterActive,
                        ]}
                      >
                        {active && <View style={s.radioInner} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          active && s.optionTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={s.row}>
                <Text style={s.label}>Goal</Text>
                <Text style={s.inputHintSmall}>
                  We’ll adjust calories and macros around this.
                </Text>
                {goalOptions.map((opt) => {
                  const active = goalType === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[s.optionRow, active && s.optionRowActive]}
                      onPress={() => setGoalType(opt.value)}
                      activeOpacity={0.8}
                    >
                      <View
                        style={[
                          s.radioOuter,
                          active && s.radioOuterActive,
                        ]}
                      >
                        {active && <View style={s.radioInner} />}
                      </View>
                      <Text
                        style={[
                          s.optionText,
                          active && s.optionTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* STEP 3 ------------------------------------------------ */}
            <View style={s.stepHeaderRow}>
              <Text style={s.sectionTitle}>Step 3</Text>
              <Text style={s.sectionSubTitle}>Extra context (optional)</Text>
            </View>

            <View style={s.card}>
              <Text style={s.label}>Anything else AI should know?</Text>
              <Text style={s.inputHintSmall}>
                Training focus, sports, digestion, preferences, schedule, etc.
              </Text>
              <TextInput
                style={[s.input, s.textArea]}
                multiline
                value={extraNotes}
                onChangeText={setExtraNotes}
                placeholder="e.g. Hyrox + running, want to stay fuelled but lean; avoid super high fibre before races; busy days Mon–Thu…"
                placeholderTextColor={colors.subtext}
              />
            </View>

            {/* SAVE BUTTON ------------------------------------------- */}
            <TouchableOpacity
              style={[
                s.saveBtn,
                (!isFormValid || saving) && s.saveBtnDisabled,
              ]}
              onPress={handleSave}
              disabled={!isFormValid || saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Feather name="zap" size={18} color="#111111" />
                  <Text style={s.saveBtnText}>Let AI set my target</Text>
                </>
              )}
            </TouchableOpacity>

            {!isFormValid && (
              <Text style={s.validationHint}>
                Age, height and weight are required to calculate your plan.
              </Text>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },

    /* HEADER — SAP-ish */
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 6,
    },
    backBtn: {
      paddingRight: 6,
      paddingVertical: 4,
    },
    headerTextWrap: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: "800",
      letterSpacing: 0.5,
      color: colors.text,
      textTransform: "uppercase",
    },
    headerSubtitle: {
      color: colors.subtext,
      fontSize: 13,
      marginTop: 2,
    },

    helperRow: {
      paddingHorizontal: 18,
      paddingBottom: 10,
    },
    stepPill: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      marginBottom: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },
    stepPillText: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    helperText: {
      fontSize: 13,
      color: colors.subtext,
    },

    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },

    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 40,
    },

    stepHeaderRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 8,
      marginTop: 12,
      marginBottom: 4,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    sectionSubTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },

    card: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 18,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },

    row: {
      marginBottom: 12,
    },
    rowTwoCols: {
      flexDirection: "row",
      marginBottom: 4,
    },

    label: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
      marginBottom: 4,
    },

    input: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.text,
      backgroundColor: isDark ? "#050506" : "#FFFFFF",
      fontSize: 14,
    },
    textArea: {
      minHeight: 90,
      textAlignVertical: "top",
    },
    inputHint: {
      marginTop: 4,
      fontSize: 11,
      color: colors.subtext,
    },
    inputHintSmall: {
      marginBottom: 6,
      fontSize: 11,
      color: colors.subtext,
    },

    /* segmented control for sex */
    segmentRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 4,
    },
    segment: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
      backgroundColor: isDark ? "#050506" : "#FFFFFF",
    },
    segmentActive: {
      backgroundColor: PRIMARY,
      borderColor: PRIMARY,
    },
    segmentText: {
      fontSize: 13,
      color: colors.text,
      fontWeight: "500",
    },
    segmentTextActive: {
      color: "#111111",
      fontWeight: "600",
    },

    /* radio lists */
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      gap: 10,
    },
    optionRowActive: {
      borderRadius: 12,
      paddingHorizontal: 6,
      backgroundColor: isDark ? "#18191E" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },
    radioOuter: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: "#C7C7CC",
      alignItems: "center",
      justifyContent: "center",
    },
    radioOuterActive: {
      borderColor: PRIMARY,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: PRIMARY,
    },
    optionText: {
      fontSize: 13,
      color: colors.subtext,
      flex: 1,
      flexWrap: "wrap",
    },
    optionTextActive: {
      color: colors.text,
      fontWeight: "600",
    },

    saveBtn: {
      marginTop: 8,
      marginBottom: 6,
      backgroundColor: PRIMARY,
      borderRadius: 999,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    saveBtnDisabled: {
      opacity: 0.6,
    },
    saveBtnText: {
      color: "#111111",
      fontWeight: "800",
      fontSize: 15,
      letterSpacing: 0.3,
    },

    validationHint: {
      textAlign: "center",
      fontSize: 12,
      color: colors.subtext,
      marginBottom: 16,
    },
  });
}
