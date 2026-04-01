// app/(protected)/nutrition/[mealId]/index.jsx

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteDoc, doc, getDoc, updateDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../../config/api";
import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

/* ---------------- config ---------------- */

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}
function startCase(s = "") {
  return String(s).trim();
}
function fmtNum(x, dp = 0) {
  const v = n(x);
  if (!v) return "0";
  if (dp <= 0) return String(Math.round(v));
  return v.toFixed(dp);
}

/* ---------------- component ---------------- */

export default function MealDetailPage() {
  const { mealId, fromDate, scrollY } = useLocalSearchParams();

  const { colors, isDark } = useTheme();
  const router = useRouter();
  const user = auth.currentUser;

  // theme-driven accents (matches Nutrition page)
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");
  const silverLight =
    colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const s = useMemo(
    () =>
      makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  const [meal, setMeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingType, setUpdatingType] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiFeedback, setAiFeedback] = useState(null);

  /**
   * Back behaviour:
   * - Prefer router.back() if possible (keeps footer state stable)
   * - Else fallback to explicit /nutrition with date+scroll restore
   */
  const goBackSafe = useCallback(() => {
    try {
      if (typeof router?.canGoBack === "function" && router.canGoBack()) {
        router.back();
        return;
      }
    } catch {}

    const rawDate = fromDate ? String(fromDate) : "";
    const rawScroll = scrollY ? String(scrollY) : "";

    if (rawDate) {
      const d = new Date(rawDate);
      if (!Number.isNaN(d.getTime())) {
        router.replace({
          pathname: "/nutrition",
          params: {
            date: d.toISOString(),
            ...(rawScroll ? { scrollY: rawScroll } : {}),
          },
        });
        return;
      }
    }
    router.replace("/nutrition");
  }, [router, fromDate, scrollY]);

  // Load meal
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!user || !mealId) {
        if (mounted) setLoading(false);
        return;
      }

      try {
        const ref = doc(db, "users", user.uid, "meals", String(mealId));
        const snap = await getDoc(ref);

        if (!mounted) return;

        if (snap.exists()) {
          setMeal({ id: snap.id, ...snap.data() });
        } else {
          setMeal(null);
        }
      } catch (e) {
        console.log("Load meal error", e);
        Alert.alert("Error", "Could not load this meal.");
        if (mounted) setMeal(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user, mealId]);

  const remove = useCallback(() => {
    if (!user || !meal) return;

    Alert.alert("Delete meal", "Are you sure you want to delete this entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "users", user.uid, "meals", meal.id));
            goBackSafe();
          } catch (e) {
            Alert.alert("Delete failed", e?.message || "Please try again.");
          }
        },
      },
    ]);
  }, [user, meal, goBackSafe]);

  const handleChangeMealType = useCallback(
    async (type) => {
      if (!user || !meal || updatingType) return;

      const finalType = type;
      try {
        setUpdatingType(true);
        const ref = doc(db, "users", user.uid, "meals", meal.id);
        await updateDoc(ref, { mealType: finalType });
        setMeal((prev) => (prev ? { ...prev, mealType: finalType } : prev));
      } catch (e) {
        console.log("Update mealType error", e);
        Alert.alert("Update failed", e?.message || "Could not update meal type.");
      } finally {
        setUpdatingType(false);
      }
    },
    [user, meal, updatingType]
  );

  const handleAnalyseMeal = useCallback(async () => {
    if (!meal || aiLoading) return;
    if (!API_URL) {
      Alert.alert("Config error", "EXPO_PUBLIC_API_URL missing in .env");
      return;
    }

    try {
      setAiLoading(true);
      setAiFeedback(null);

      const payload = {
        meal: {
          title: meal.title || "",
          notes: meal.notes || "",
          mealType: meal.mealType || "",
          calories: n(meal.calories),
          protein: n(meal.protein),
          carbs: n(meal.carbs),
          fat: n(meal.fat),
          fibre: n(meal.fibre ?? meal.fiber),
          sugar: n(meal.sugar),
          sodium: n(meal.sodium),

          saturatedFat: n(meal.saturatedFat ?? meal.satFat),
          polyunsaturatedFat: n(meal.polyunsaturatedFat ?? meal.polyFat),
          monounsaturatedFat: n(meal.monounsaturatedFat ?? meal.monoFat),
          transFat: n(meal.transFat),
          cholesterol: n(meal.cholesterol),

          potassium: n(meal.potassium),
          vitaminA: n(meal.vitaminA),
          vitaminC: n(meal.vitaminC),
          calcium: n(meal.calcium),
          iron: n(meal.iron),
        },
      };

      const res = await fetch(`${API_URL}/nutrition/meal-quality`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`API error ${res.status} – ${text.slice(0, 120)}`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Could not parse AI response");
      }

      setAiFeedback(data);
    } catch (e) {
      console.log("AI analyse meal error", e);
      Alert.alert(
        "AI unavailable",
        e?.message || "Could not analyse this meal right now."
      );
    } finally {
      setAiLoading(false);
    }
  }, [meal, aiLoading]);

  /* ---------------- derived + display ---------------- */

  const headerDate = useMemo(() => {
    try {
      if (meal?.date?.toDate) {
        const d = meal.date.toDate();
        return d.toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    } catch {}
    return "";
  }, [meal?.date]);

  const selectedType =
    meal?.mealType && typeof meal.mealType === "string" ? meal.mealType : "";

  const micro = useMemo(() => {
    if (!meal) return null;

    const fibre = n(meal.fibre ?? meal.fiber);
    const sugar = n(meal.sugar);
    const sodium = n(meal.sodium);

    const saturatedFat = n(meal.saturatedFat ?? meal.satFat);
    const polyunsaturatedFat = n(meal.polyunsaturatedFat ?? meal.polyFat);
    const monounsaturatedFat = n(meal.monounsaturatedFat ?? meal.monoFat);
    const transFat = n(meal.transFat);

    const cholesterol = n(meal.cholesterol);
    const potassium = n(meal.potassium);
    const vitaminA = n(meal.vitaminA);
    const vitaminC = n(meal.vitaminC);
    const calcium = n(meal.calcium);
    const iron = n(meal.iron);

    const hasBasicMicros = !!(fibre || sugar || sodium);
    const hasFatsMicros = !!(
      saturatedFat ||
      polyunsaturatedFat ||
      monounsaturatedFat ||
      transFat
    );
    const hasMineralsVits = !!(
      potassium ||
      vitaminA ||
      vitaminC ||
      calcium ||
      iron ||
      cholesterol
    );

    return {
      fibre,
      sugar,
      sodium,
      saturatedFat,
      polyunsaturatedFat,
      monounsaturatedFat,
      transFat,
      cholesterol,
      potassium,
      vitaminA,
      vitaminC,
      calcium,
      iron,
      hasBasicMicros,
      hasFatsMicros,
      hasMineralsVits,
    };
  }, [meal]);

  /* ---------------- states ---------------- */

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator color={accentBg} />
        </View>
      </SafeAreaView>
    );
  }

  if (!meal) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.page}>
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={goBackSafe}
              style={s.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="chevron-left" size={22} color={accentText} />
            </TouchableOpacity>
          </View>
          <Text style={s.subtle}>Meal not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const title = startCase(meal.title || "Meal");

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.page}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        {/* HEADER */}
        <View style={s.headerRow}>
          <TouchableOpacity
            onPress={goBackSafe}
            style={s.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="chevron-left" size={22} color={accentText} />
          </TouchableOpacity>

          <View style={s.headerTextWrap}>
            <Text style={s.title} numberOfLines={2}>
              {title}
            </Text>
            {!!headerDate && <Text style={s.subtitle}>{headerDate}</Text>}
          </View>

          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: `/nutrition/${meal.id}/edit`,
                params: {
                  ...(fromDate ? { fromDate: String(fromDate) } : {}),
                  ...(scrollY ? { scrollY: String(scrollY) } : {}),
                },
              })
            }
            style={s.iconBtnAccent}
            activeOpacity={0.85}
          >
            <Feather name="edit-2" size={18} color="#111111" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={remove}
            style={s.iconBtnDanger}
            activeOpacity={0.85}
          >
            <Feather name="trash-2" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* HERO MACROS */}
        <View style={s.heroCard}>
          <View style={s.heroTopRow}>
            <View style={s.kcalPill}>
              <Text style={s.kcalPillLabel}>CALORIES</Text>
              <Text style={s.kcalPillValue}>{fmtNum(meal.calories)} kcal</Text>
            </View>

            <View style={s.heroMiniGrid}>
              <HeroMini label="Protein" value={`${fmtNum(meal.protein)}g`} s={s} />
              <HeroMini label="Carbs" value={`${fmtNum(meal.carbs)}g`} s={s} />
              <HeroMini label="Fat" value={`${fmtNum(meal.fat)}g`} s={s} />
            </View>
          </View>

          {!!meal.notes ? (
            <View style={s.heroNotes}>
              <Text style={s.heroNotesTitle}>Notes</Text>
              <Text style={s.heroNotesText}>{String(meal.notes)}</Text>
            </View>
          ) : null}
        </View>

        {/* MEAL TYPE + AI */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Meal type</Text>
            {updatingType ? (
              <View style={s.savingPill}>
                <ActivityIndicator size="small" color="#111111" />
                <Text style={s.savingPillText}>Saving</Text>
              </View>
            ) : null}
          </View>

          <View style={s.typeRow}>
            {MEAL_TYPES.map((type) => {
              const active = selectedType.toLowerCase() === type.toLowerCase();
              return (
                <TouchableOpacity
                  key={type}
                  style={[s.typeChip, active && s.typeChipActive]}
                  onPress={() => handleChangeMealType(type)}
                  activeOpacity={0.85}
                  disabled={updatingType}
                >
                  <Text
                    style={[
                      s.typeChipText,
                      active && s.typeChipTextActive,
                    ]}
                  >
                    {type}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.aiWrap}>
            <TouchableOpacity
              style={[s.aiButton, aiLoading && { opacity: 0.75 }]}
              onPress={handleAnalyseMeal}
              activeOpacity={0.9}
              disabled={aiLoading}
            >
              {aiLoading ? (
                <>
                  <ActivityIndicator size="small" color="#111111" />
                  <Text style={s.aiButtonText}>Analysing…</Text>
                </>
              ) : (
                <>
                  <Feather name="activity" size={16} color="#111111" />
                  <Text style={s.aiButtonText}>Analyse with AI</Text>
                </>
              )}
            </TouchableOpacity>

            {aiFeedback ? (
              <View style={s.aiCard}>
                <View style={s.aiHeaderRow}>
                  {aiFeedback.grade ? (
                    <View style={s.aiGradeBadge}>
                      <Text style={s.aiGradeText}>
                        {String(aiFeedback.grade).toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  {!!aiFeedback.summary ? (
                    <Text style={s.aiSummaryText}>{aiFeedback.summary}</Text>
                  ) : null}
                </View>
                {!!aiFeedback.detail ? (
                  <Text style={s.aiDetailText}>{aiFeedback.detail}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* DETAILS */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Macros</Text>
          <View style={s.sectionCard}>
            <Row label="Calories" value={`${fmtNum(meal.calories)} kcal`} last={false} s={s} />
            <Row label="Protein" value={`${fmtNum(meal.protein)} g`} last={false} s={s} />
            <Row
              label="Carbohydrates"
              value={`${fmtNum(meal.carbs)} g`}
              last={false}
              s={s}
            />
            <Row label="Fat" value={`${fmtNum(meal.fat)} g`} last={true} s={s} />
          </View>
        </View>

        {micro?.hasBasicMicros ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Micros</Text>
            <View style={s.sectionCard}>
              {micro.fibre ? (
                <Row label="Fibre" value={`${fmtNum(micro.fibre)} g`} last={false} s={s} />
              ) : null}
              {micro.sugar ? (
                <Row label="Sugar" value={`${fmtNum(micro.sugar)} g`} last={false} s={s} />
              ) : null}
              {micro.sodium ? (
                <Row label="Sodium" value={`${fmtNum(micro.sodium)} mg`} last={true} s={s} />
              ) : null}
            </View>
          </View>
        ) : null}

        {micro?.hasFatsMicros ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Fat breakdown</Text>
            <View style={s.sectionCard}>
              {micro.saturatedFat ? (
                <Row
                  label="Saturated fat"
                  value={`${fmtNum(micro.saturatedFat)} g`}
                  last={false}
                  s={s}
                />
              ) : null}
              {micro.polyunsaturatedFat ? (
                <Row
                  label="Polyunsaturated fat"
                  value={`${fmtNum(micro.polyunsaturatedFat)} g`}
                  last={false}
                  s={s}
                />
              ) : null}
              {micro.monounsaturatedFat ? (
                <Row
                  label="Monounsaturated fat"
                  value={`${fmtNum(micro.monounsaturatedFat)} g`}
                  last={false}
                  s={s}
                />
              ) : null}
              {micro.transFat ? (
                <Row
                  label="Trans fat"
                  value={`${fmtNum(micro.transFat)} g`}
                  last={true}
                  s={s}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        {micro?.hasMineralsVits ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Minerals & vitamins</Text>
            <View style={s.sectionCard}>
              {[
                micro.potassium && {
                  label: "Potassium",
                  value: `${fmtNum(micro.potassium)} mg`,
                },
                micro.vitaminA && { label: "Vitamin A", value: `${fmtNum(micro.vitaminA)} mg` },
                micro.vitaminC && { label: "Vitamin C", value: `${fmtNum(micro.vitaminC)} mg` },
                micro.calcium && { label: "Calcium", value: `${fmtNum(micro.calcium)} mg` },
                micro.iron && { label: "Iron", value: `${fmtNum(micro.iron)} mg` },
                micro.cholesterol && {
                  label: "Cholesterol",
                  value: `${fmtNum(micro.cholesterol)} mg`,
                },
              ]
                .filter(Boolean)
                .map((row, idx, arr) => (
                  <Row
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    last={idx === arr.length - 1}
                    s={s}
                  />
                ))}
            </View>
          </View>
        ) : null}

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- UI bits ---------------- */

function HeroMini({ label, value, s }) {
  return (
    <View style={s.heroMiniCard}>
      <Text style={s.heroMiniLabel}>{label.toUpperCase()}</Text>
      <Text style={s.heroMiniValue}>{value}</Text>
    </View>
  );
}

function Row({ label, value, last, s }) {
  return (
    <View
      style={[
        s.row,
        !last && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: s.__silverMed,
        },
      ]}
    >
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const cardBg = isDark ? "#111217" : silverLight;

  const shadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.35,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 6,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 3,
      };

  const softShadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      };

  const styles = StyleSheet.create({
    __silverMed: silverMed, // stash for Row border colour

    safe: { flex: 1, backgroundColor: colors.bg },

    page: {
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 26,
    },

    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 14,
      gap: 10,
    },
    backBtn: {
      width: 38,
      height: 38,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    headerTextWrap: { flex: 1 },
    title: { fontSize: 22, fontWeight: "900", color: colors.text },
    subtitle: { fontSize: 13, color: colors.subtext, marginTop: 3, fontWeight: "700" },

    iconBtnAccent: {
      width: 42,
      height: 42,
      borderRadius: 16,
      backgroundColor: accentBg,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    iconBtnDanger: {
      width: 42,
      height: 42,
      borderRadius: 16,
      backgroundColor: "#B91C1C",
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },

    /* HERO */
    heroCard: {
      backgroundColor: panelBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...shadow,
      marginBottom: 16,
    },
    heroTopRow: {
      flexDirection: "row",
      gap: 12,
      alignItems: "stretch",
    },
    kcalPill: {
      flex: 1,
      borderRadius: 18,
      padding: 12,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...softShadow,
    },
    kcalPillLabel: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtext,
      letterSpacing: 1.1,
    },
    kcalPillValue: {
      marginTop: 6,
      fontSize: 20,
      fontWeight: "900",
      color: colors.text,
    },
    heroMiniGrid: { width: 140, gap: 10 },
    heroMiniCard: {
      backgroundColor: cardBg,
      borderRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...softShadow,
    },
    heroMiniLabel: {
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1.0,
      color: colors.subtext,
    },
    heroMiniValue: {
      marginTop: 4,
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
    },

    heroNotes: {
      marginTop: 12,
      backgroundColor: cardBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
    },
    heroNotesTitle: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtext,
      letterSpacing: 1.0,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    heroNotesText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },

    /* SECTION */
    section: { marginBottom: 16 },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 1.0,
      marginBottom: 8,
    },

    savingPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: accentBg,
      ...softShadow,
    },
    savingPillText: { color: "#111111", fontWeight: "900", fontSize: 12 },

    sectionCard: {
      backgroundColor: panelBg,
      borderRadius: 22,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...shadow,
    },

    /* MEAL TYPE */
    typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
    typeChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      backgroundColor: panelBg,
      ...softShadow,
    },
    typeChipActive: { backgroundColor: accentBg, borderColor: accentBg },
    typeChipText: { fontSize: 13, color: colors.text, fontWeight: "800" },
    typeChipTextActive: { color: "#111111", fontWeight: "900" },

    /* AI */
    aiWrap: {
      backgroundColor: panelBg,
      borderRadius: 22,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...softShadow,
    },
    aiButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: accentBg,
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    aiButtonText: {
      fontSize: 13,
      fontWeight: "900",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: "#111111",
    },

    aiCard: {
      marginTop: 10,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      backgroundColor: cardBg,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    aiHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    aiGradeBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "#16A34A",
    },
    aiGradeText: { color: "#FFFFFF", fontWeight: "900", fontSize: 12, letterSpacing: 0.6 },
    aiSummaryText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "800", lineHeight: 18 },
    aiDetailText: { color: colors.subtext, fontSize: 12, lineHeight: 18, fontWeight: "600" },

    /* ROWS */
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
    },
    rowLabel: {
      color: colors.subtext,
      fontWeight: "800",
      fontSize: 13,
    },
    rowValue: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 14,
    },

    subtle: { color: colors.subtext, fontSize: 14, fontWeight: "700" },
  });

  // attach for Row border use
  styles.__silverMed = silverMed;
  return styles;
}
