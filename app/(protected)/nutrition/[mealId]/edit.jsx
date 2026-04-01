// app/(protected)/nutrition/[mealId]/edit.jsx

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc, updateDoc } from "firebase/firestore";
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

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

const FALLBACK_PRIMARY = "#E6FF3B";
const FALLBACK_SILVER_LIGHT = "#F3F4F6";
const FALLBACK_SILVER_MEDIUM = "#E1E3E8";

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const normalised = String(value).trim().replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
};

export default function EditMealPage() {
  const router = useRouter();
  const { mealId } = useLocalSearchParams();

  const { colors, isDark } = useTheme();
  const PRIMARY = colors.sapPrimary || FALLBACK_PRIMARY;
  const SILVER_LIGHT = colors.sapSilverLight || FALLBACK_SILVER_LIGHT;
  const SILVER_MEDIUM = colors.sapSilverMedium || FALLBACK_SILVER_MEDIUM;

  const s = makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM);

  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // fields
  const [title, setTitle] = useState("");
  const [mealType, setMealType] = useState("Lunch");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [notes, setNotes] = useState("");

  const docRef = useMemo(() => {
    if (!user || !mealId) return null;
    return doc(db, "users", user.uid, "meals", String(mealId));
  }, [user, mealId]);

  useEffect(() => {
    (async () => {
      if (!docRef) {
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          Alert.alert("Not found", "This meal no longer exists.");
          router.back();
          return;
        }

        const m = snap.data() || {};
        setTitle(String(m.title || ""));
        setMealType(String(m.mealType || "Lunch"));
        setCalories(m.calories !== undefined ? String(m.calories) : "");
        setProtein(m.protein !== undefined ? String(m.protein) : "");
        setCarbs(m.carbs !== undefined ? String(m.carbs) : "");
        setFat(m.fat !== undefined ? String(m.fat) : "");
        setNotes(String(m.notes || ""));
      } catch (e) {
        console.log("Load meal for edit error", e);
        Alert.alert("Error", "Could not load this meal.");
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [docRef, router]);

  const save = async () => {
    if (!user || !docRef) {
      Alert.alert("Not signed in", "Please log in again.");
      return;
    }

    if (!title.trim() && !mealType.trim()) {
      Alert.alert("Add details", "Please enter a title or choose a meal type.");
      return;
    }

    try {
      setSaving(true);

      await updateDoc(docRef, {
        title: title.trim(),
        mealType: mealType.trim(),
        calories: toNumber(calories),
        protein: toNumber(protein),
        carbs: toNumber(carbs),
        fat: toNumber(fat),
        notes: notes.trim(),
        updatedAt: new Date(),
      });

      // back to detail
      router.replace(`/nutrition/${String(mealId)}`);
    } catch (e) {
      console.log("Update meal error", e);
      Alert.alert("Save failed", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.loadingWrap}>
          <ActivityIndicator color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={s.page}>
          {/* HEADER */}
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="chevron-left" size={22} color={PRIMARY} />
            </TouchableOpacity>

            <View style={s.headerTextWrap}>
              <Text style={s.headerTitle}>Edit meal</Text>
              <Text style={s.headerSubtitle}>Update your logged food</Text>
            </View>

            <View style={{ width: 32 }} />
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* DETAILS */}
            <Text style={s.sectionTitle}>Details</Text>
            <View style={s.card}>
              <Field
                label="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Chicken & rice"
                colors={colors}
              />

              <View style={s.mealTypeRow}>
                <Text style={s.label}>Meal type</Text>

                <View style={s.segmentRow}>
                  {["Breakfast", "Lunch", "Dinner", "Snack"].map((mt) => {
                    const active = mealType === mt;
                    return (
                      <TouchableOpacity
                        key={mt}
                        style={[s.segment, active && s.segmentActive]}
                        onPress={() => setMealType(mt)}
                        activeOpacity={0.8}
                      >
                        <Text style={[s.segmentText, active && s.segmentTextActive]}>
                          {mt}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput
                  style={s.freeTypeInput}
                  value={mealType}
                  onChangeText={setMealType}
                  placeholder="Breakfast / Lunch / Dinner / Snack"
                  placeholderTextColor={colors.subtext}
                />
              </View>
            </View>

            {/* MACROS */}
            <Text style={s.sectionTitle}>Macros</Text>
            <View style={s.card}>
              <View style={s.rowTwoCols}>
                <FieldSmall
                  label="Calories"
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="numeric"
                  placeholder="kcal"
                  colors={colors}
                />
                <View style={s.spacer} />
                <FieldSmall
                  label="Protein"
                  value={protein}
                  onChangeText={setProtein}
                  keyboardType="numeric"
                  placeholder="g"
                  colors={colors}
                />
              </View>

              <View style={s.rowTwoCols}>
                <FieldSmall
                  label="Carbs"
                  value={carbs}
                  onChangeText={setCarbs}
                  keyboardType="numeric"
                  placeholder="g"
                  colors={colors}
                />
                <View style={s.spacer} />
                <FieldSmall
                  label="Fat"
                  value={fat}
                  onChangeText={setFat}
                  keyboardType="numeric"
                  placeholder="g"
                  colors={colors}
                />
              </View>
            </View>

            {/* NOTES */}
            <Text style={s.sectionTitle}>Notes</Text>
            <View style={s.card}>
              <Field
                label="Notes (optional)"
                value={notes}
                onChangeText={setNotes}
                placeholder="Taste, timing, how you felt..."
                multiline
                colors={colors}
                inputStyle={s.notesInput}
              />
            </View>

            {/* SAVE */}
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.9 }]}
              onPress={save}
              activeOpacity={0.9}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Feather name="check" size={18} color="#111111" />
                  <Text style={s.saveBtnText}>Save changes</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------- fields ---------- */

function Field({ label, colors, inputStyle, ...rest }) {
  const SILVER_LIGHT = colors.sapSilverLight || FALLBACK_SILVER_LIGHT;
  const SILVER_MEDIUM = colors.sapSilverMedium || FALLBACK_SILVER_MEDIUM;

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ marginBottom: 4, fontWeight: "600", fontSize: 13, color: colors.subtext }}>
        {label}
      </Text>
      <TextInput
        {...rest}
        style={[
          {
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontSize: 14,
            backgroundColor: SILVER_LIGHT,
            borderColor: SILVER_MEDIUM,
            color: colors.text,
          },
          inputStyle,
        ]}
        placeholderTextColor={colors.subtext}
      />
    </View>
  );
}

function FieldSmall({ label, colors, style, ...rest }) {
  const SILVER_LIGHT = colors.sapSilverLight || FALLBACK_SILVER_LIGHT;
  const SILVER_MEDIUM = colors.sapSilverMedium || FALLBACK_SILVER_MEDIUM;

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ marginBottom: 4, fontWeight: "600", fontSize: 13, color: colors.subtext }}>
        {label}
      </Text>
      <TextInput
        {...rest}
        style={[
          {
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontSize: 14,
            backgroundColor: SILVER_LIGHT,
            borderColor: SILVER_MEDIUM,
            color: colors.text,
          },
          style,
        ]}
        placeholderTextColor={colors.subtext}
      />
    </View>
  );
}

/* ---------- styles ---------- */

function makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: isDark ? "#050506" : "#F5F5F7" },
    page: { flex: 1, paddingHorizontal: 18 },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

    headerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingBottom: 14 },
    backBtn: { paddingRight: 6, paddingVertical: 4 },
    headerTextWrap: { flex: 1 },
    headerTitle: {
      fontSize: 24,
      fontWeight: "800",
      letterSpacing: 0.4,
      color: colors.text,
      textTransform: "uppercase",
    },
    headerSubtitle: { color: colors.subtext, fontSize: 13, marginTop: 2 },

    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 40 },

    sectionTitle: {
      marginTop: 10,
      marginBottom: 6,
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    card: {
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 16,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },

    rowTwoCols: { flexDirection: "row", marginBottom: 8, gap: 10 },
    spacer: { width: 10 },

    mealTypeRow: { marginBottom: 4, marginTop: 4 },
    label: { fontSize: 13, fontWeight: "600", color: colors.subtext, marginBottom: 6 },

    segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    segment: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
    },
    segmentActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
    segmentText: { fontSize: 13, color: colors.text, fontWeight: "500" },
    segmentTextActive: { color: "#111111", fontWeight: "600" },

    freeTypeInput: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 14,
      marginTop: 6,
      backgroundColor: SILVER_LIGHT,
      borderColor: SILVER_MEDIUM,
      color: colors.text,
    },

    notesInput: { minHeight: 80, textAlignVertical: "top" },

    saveBtn: {
      marginTop: 8,
      backgroundColor: PRIMARY,
      paddingVertical: 12,
      borderRadius: 999,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    saveBtnText: { color: "#111111", fontWeight: "800", fontSize: 15, letterSpacing: 0.3 },

    cancelBtn: { alignItems: "center", marginTop: 10 },
    cancelText: { color: colors.subtext, fontWeight: "600", fontSize: 14 },
  });
}
