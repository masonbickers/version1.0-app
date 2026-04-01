"use client";

/**
 * app/(protected)/training/exercises.jsx
 * Exercise Library — pick an exercise to add into Builder (no AI)
 *
 * Uses Firestore:
 * - users/{uid}/exerciseLibrary (optional user-saved/custom exercises)
 * - publicExercises (global seed library, optional)  // not used yet
 *
 * Can be opened in 2 modes:
 * 1) Picker mode (from Builder):
 *    /training/exercises?mode=pick&returnTo=/training/builder&blockId=...&slotId=...
 *    -> on select, navigates back with params:
 *       returnTo?addExercise=1&exercise=<ENCODED_JSON>&blockId=...&slotId=...
 *
 * 2) Manage mode (default):
 *    /training/exercises
 *
 * Notes:
 * - Builder should decode+parse "exercise" and insert it into its draft.
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- helpers ---------- */

function safeStr(v) {
  return String(v ?? "").trim();
}

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const CATEGORY = [
  "Compound",
  "Accessories",
  "Hyrox / Metcon",
  "Mobility",
  "Core",
  "Cardio",
  "Other",
];

const MUSCLE_GROUPS = [
  "Full body",
  "Upper",
  "Lower",
  "Chest",
  "Back",
  "Shoulders",
  "Arms",
  "Legs",
  "Glutes",
  "Core",
  "Calves",
  "Cardio",
];

const EQUIPMENT = [
  "Barbell",
  "Dumbbells",
  "Kettlebell",
  "Machine",
  "Cable",
  "Bodyweight",
  "Bands",
  "Erg",
  "Sled",
  "Sandbag",
  "Other",
];

/**
 * Default global library (light seed) — you can expand later.
 * This is used even if Firestore has nothing, so the page always works.
 */
const DEFAULT_LIBRARY = [
  { name: "Back Squat", category: "Compound", muscleGroup: "Legs", equipment: "Barbell" },
  { name: "Front Squat", category: "Compound", muscleGroup: "Legs", equipment: "Barbell" },
  { name: "Romanian Deadlift", category: "Compound", muscleGroup: "Legs", equipment: "Barbell" },
  { name: "Deadlift", category: "Compound", muscleGroup: "Full body", equipment: "Barbell" },
  { name: "Bench Press", category: "Compound", muscleGroup: "Chest", equipment: "Barbell" },
  { name: "Incline Dumbbell Press", category: "Compound", muscleGroup: "Chest", equipment: "Dumbbells" },
  { name: "Overhead Press", category: "Compound", muscleGroup: "Shoulders", equipment: "Barbell" },
  { name: "Pull-up", category: "Compound", muscleGroup: "Back", equipment: "Bodyweight" },
  { name: "Barbell Row", category: "Compound", muscleGroup: "Back", equipment: "Barbell" },
  { name: "Lat Pulldown", category: "Accessories", muscleGroup: "Back", equipment: "Cable" },
  { name: "Cable Row", category: "Accessories", muscleGroup: "Back", equipment: "Cable" },
  { name: "Leg Press", category: "Accessories", muscleGroup: "Legs", equipment: "Machine" },
  { name: "Hamstring Curl", category: "Accessories", muscleGroup: "Legs", equipment: "Machine" },
  { name: "Leg Extension", category: "Accessories", muscleGroup: "Legs", equipment: "Machine" },
  { name: "DB Lateral Raise", category: "Accessories", muscleGroup: "Shoulders", equipment: "Dumbbells" },
  { name: "Biceps Curl", category: "Accessories", muscleGroup: "Arms", equipment: "Dumbbells" },
  { name: "Triceps Pushdown", category: "Accessories", muscleGroup: "Arms", equipment: "Cable" },
  { name: "Plank", category: "Core", muscleGroup: "Core", equipment: "Bodyweight" },
  { name: "Hanging Knee Raise", category: "Core", muscleGroup: "Core", equipment: "Bodyweight" },

  // Hyrox-ish
  { name: "SkiErg", category: "Hyrox / Metcon", muscleGroup: "Cardio", equipment: "Erg" },
  { name: "RowErg", category: "Hyrox / Metcon", muscleGroup: "Cardio", equipment: "Erg" },
  { name: "Assault Bike", category: "Hyrox / Metcon", muscleGroup: "Cardio", equipment: "Other" },
  { name: "Sled Push", category: "Hyrox / Metcon", muscleGroup: "Full body", equipment: "Sled" },
  { name: "Sled Pull", category: "Hyrox / Metcon", muscleGroup: "Full body", equipment: "Sled" },
  { name: "Farmer Carry", category: "Hyrox / Metcon", muscleGroup: "Full body", equipment: "Dumbbells" },
  { name: "Wall Balls", category: "Hyrox / Metcon", muscleGroup: "Full body", equipment: "Other" },
  { name: "Sandbag Lunges", category: "Hyrox / Metcon", muscleGroup: "Legs", equipment: "Sandbag" },

  // Mobility
  { name: "Couch Stretch", category: "Mobility", muscleGroup: "Lower", equipment: "Bodyweight" },
  { name: "Thoracic Openers", category: "Mobility", muscleGroup: "Upper", equipment: "Bodyweight" },
];

export default function ExercisesPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;

  const { colors, isDark } = useTheme();
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText = colors?.accentText ?? (isDark ? accentBg : "#7A8F00");
  const silverLight = colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const s = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // mode
  const mode = safeStr(params?.mode) || "manage"; // "pick" | "manage"
  const returnTo = safeStr(params?.returnTo) || ""; // should be like "/training/builder"
  const blockId = safeStr(params?.blockId) || "";
  const slotId = safeStr(params?.slotId) || "";

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [muscle, setMuscle] = useState("");
  const [equip, setEquip] = useState("");

  const [userLib, setUserLib] = useState([]); // {id, name, ...}
  const [loading, setLoading] = useState(true);

  // add modal
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("Accessories");
  const [newMuscle, setNewMuscle] = useState("Full body");
  const [newEquip, setNewEquip] = useState("Other");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // load user library
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const ref = collection(db, "users", user.uid, "exerciseLibrary");
    const qRef = query(ref, orderBy("name", "asc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        setUserLib(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  // merged library: user custom first (tagged), then defaults excluding duplicates by name
  const merged = useMemo(() => {
    const seen = new Set();
    const out = [];

    userLib.forEach((x) => {
      const nm = safeStr(x.name).toLowerCase();
      if (!nm || seen.has(nm)) return;
      seen.add(nm);
      out.push({ ...x, _source: "custom" });
    });

    DEFAULT_LIBRARY.forEach((x) => {
      const nm = safeStr(x.name).toLowerCase();
      if (!nm || seen.has(nm)) return;
      seen.add(nm);
      out.push({ ...x, _source: "default" });
    });

    return out;
  }, [userLib]);

  const filtered = useMemo(() => {
    const q = safeStr(search).toLowerCase();
    return merged.filter((x) => {
      const nm = safeStr(x.name).toLowerCase();
      if (q && !nm.includes(q)) return false;
      if (cat && safeStr(x.category) !== cat) return false;
      if (muscle && safeStr(x.muscleGroup) !== muscle) return false;
      if (equip && safeStr(x.equipment) !== equip) return false;
      return true;
    });
  }, [merged, search, cat, muscle, equip]);

  const pickExercise = useCallback(
    (x) => {
      // build the exercise object that builder will insert
      const payload = {
        name: safeStr(x.name),
        category: safeStr(x.category),
        muscleGroup: safeStr(x.muscleGroup),
        equipment: safeStr(x.equipment),
        notes: safeStr(x.notes),
        source: x._source || "unknown",
        // default prescription — builder can edit
        prescription: {
          scheme: "sets_reps", // sets_reps | time | distance | intervals
          sets: 3,
          reps: 10,
          rpe: "",
          restSec: 90,
          load: "",
        },
        meta: {
          timezone: getTimezone(),
          pickedAtISO: new Date().toISOString(),
        },
      };

      if (mode !== "pick" || !returnTo) {
        Alert.alert("Exercise", `${payload.name}\n\nOpen Builder to add it to a workout.`);
        return;
      }

      const qs = new URLSearchParams();
      qs.set("addExercise", "1");

      // ✅ IMPORTANT: encode payload to keep querystring safe
      qs.set("exercise", encodeURIComponent(JSON.stringify(payload)));

      if (blockId) qs.set("blockId", blockId);
      if (slotId) qs.set("slotId", slotId);

      router.push(`${returnTo}?${qs.toString()}`);
    },
    [mode, returnTo, router, blockId, slotId]
  );

  const addCustom = useCallback(async () => {
    if (!user) return Alert.alert("Error", "Please sign in again.");
    const nm = safeStr(newName);
    if (nm.length < 2) return Alert.alert("Missing name", "Add an exercise name.");

    try {
      setSaving(true);

      await addDoc(collection(db, "users", user.uid, "exerciseLibrary"), {
        name: nm,
        category: newCat,
        muscleGroup: newMuscle,
        equipment: newEquip,
        notes: safeStr(newNotes),
        createdAt: serverTimestamp(),
      });

      setShowAdd(false);
      setNewName("");
      setNewNotes("");
      setNewCat("Accessories");
      setNewMuscle("Full body");
      setNewEquip("Other");
    } catch (e) {
      Alert.alert("Could not save", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  }, [user, newName, newCat, newMuscle, newEquip, newNotes]);

  const removeCustom = useCallback(
    async (id) => {
      if (!user) return;
      Alert.alert("Delete exercise?", "This removes it from your custom library.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "users", user.uid, "exerciseLibrary", id));
            } catch (e) {
              Alert.alert("Could not delete", e?.message || "Try again.");
            }
          },
        },
      ]);
    },
    [user]
  );

  const clearFilters = () => {
    setSearch("");
    setCat("");
    setMuscle("");
    setEquip("");
  };

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle}>{mode === "pick" ? "Pick exercise" : "Exercises"}</Text>
          <Text style={s.headerSub}>
            {mode === "pick" ? "Tap one to add to your workout" : "Your library + defaults"}
          </Text>
        </View>

        <TouchableOpacity onPress={() => setShowAdd(true)} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="plus" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Search */}
        <View style={s.searchBox}>
          <Feather name="search" size={16} color={colors.subtext} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search exercises…"
            placeholderTextColor={colors.subtext}
            style={s.searchInput}
            keyboardAppearance={isDark ? "dark" : "light"}
            returnKeyType="search"
          />
          {(search || cat || muscle || equip) ? (
            <TouchableOpacity onPress={clearFilters} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x-circle" size={16} color={colors.subtext} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filters */}
        <View style={s.filtersCard}>
          <Text style={s.filtersTitle}>Filters</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <FilterPill label={`Category${cat ? `: ${cat}` : ""}`} active={!!cat} s={s} onPress={() => {}} disabled />
            <FilterPill label={`Muscle${muscle ? `: ${muscle}` : ""}`} active={!!muscle} s={s} onPress={() => {}} disabled />
            <FilterPill label={`Equipment${equip ? `: ${equip}` : ""}`} active={!!equip} s={s} onPress={() => {}} disabled />
          </ScrollView>

          <View style={{ marginTop: 10, gap: 8 }}>
            <PillRow title="Category" options={CATEGORY} value={cat} onChange={setCat} s={s} />
            <PillRow title="Muscle" options={MUSCLE_GROUPS} value={muscle} onChange={setMuscle} s={s} />
            <PillRow title="Equipment" options={EQUIPMENT} value={equip} onChange={setEquip} s={s} />
          </View>
        </View>

        {/* List */}
        <View style={s.card}>
          <View style={s.cardHeadRow}>
            <Text style={s.cardTitle}>Results</Text>
            <Text style={s.cardMeta}>{filtered.length} exercises</Text>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 18 }}>
              <Text style={s.cardSub}>Loading…</Text>
            </View>
          ) : filtered.length === 0 ? (
            <Text style={s.cardSub}>No matches. Try removing filters.</Text>
          ) : (
            <View style={{ marginTop: 6 }}>
              {filtered.map((x, idx) => {
                const isCustom = x._source === "custom";
                return (
                  <TouchableOpacity
                    key={`${safeStr(x.id) || safeStr(x.name)}-${idx}`}
                    style={s.row}
                    activeOpacity={0.85}
                    onPress={() => pickExercise(x)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={s.rowTitleLine}>
                        <Text style={s.rowTitle}>{safeStr(x.name)}</Text>
                        <View style={[s.tag, isCustom ? s.tagCustom : s.tagDefault]}>
                          <Text style={s.tagText}>{isCustom ? "Custom" : "Default"}</Text>
                        </View>
                      </View>
                      <Text style={s.rowSub} numberOfLines={1}>
                        {safeStr(x.category) || "—"} • {safeStr(x.muscleGroup) || "—"} • {safeStr(x.equipment) || "—"}
                      </Text>
                      {safeStr(x.notes) ? (
                        <Text style={s.rowNote} numberOfLines={1}>
                          {safeStr(x.notes)}
                        </Text>
                      ) : null}
                    </View>

                    {isCustom && mode !== "pick" ? (
                      <TouchableOpacity
                        onPress={() => removeCustom(x.id)}
                        style={s.rowIcon}
                        activeOpacity={0.85}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Feather name="trash-2" size={18} color={colors.subtext} />
                      </TouchableOpacity>
                    ) : (
                      <Feather name="chevron-right" size={18} color={colors.subtext} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Add custom modal */}
      <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>Add exercise</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)} activeOpacity={0.85}>
                <Feather name="x" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.label}>Name</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Bulgarian Split Squat"
              placeholderTextColor={colors.subtext}
              style={s.input}
              keyboardAppearance={isDark ? "dark" : "light"}
              autoCapitalize="words"
            />

            <Text style={[s.label, { marginTop: 12 }]}>Category</Text>
            <SelectRow options={CATEGORY} value={newCat} onChange={setNewCat} s={s} />

            <Text style={[s.label, { marginTop: 12 }]}>Muscle group</Text>
            <SelectRow options={MUSCLE_GROUPS} value={newMuscle} onChange={setNewMuscle} s={s} />

            <Text style={[s.label, { marginTop: 12 }]}>Equipment</Text>
            <SelectRow options={EQUIPMENT} value={newEquip} onChange={setNewEquip} s={s} />

            <Text style={[s.label, { marginTop: 12 }]}>Notes (optional)</Text>
            <TextInput
              value={newNotes}
              onChangeText={setNewNotes}
              placeholder="e.g. slow eccentric, keep torso upright"
              placeholderTextColor={colors.subtext}
              style={[s.input, { minHeight: 80, textAlignVertical: "top" }]}
              multiline
              keyboardAppearance={isDark ? "dark" : "light"}
            />

            <TouchableOpacity
              style={[s.primaryBtn, saving && { opacity: 0.7 }]}
              onPress={addCustom}
              activeOpacity={0.9}
              disabled={saving}
            >
              <Feather name="check" size={18} color="#111111" />
              <Text style={s.primaryBtnText}>{saving ? "Saving…" : "Save exercise"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- small UI bits ---------- */

function FilterPill({ label, active, s, onPress, disabled }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
      style={[s.filterPill, active && s.filterPillActive, disabled && { opacity: 0.85 }]}
    >
      <Text style={[s.filterPillText, active && s.filterPillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PillRow({ title, options, value, onChange, s }) {
  return (
    <View>
      <Text style={s.rowLabel}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <TouchableOpacity
          onPress={() => onChange("")}
          style={[s.pill, !value && s.pillActive]}
          activeOpacity={0.85}
        >
          <Text style={[s.pillText, !value && s.pillTextActive]}>All</Text>
        </TouchableOpacity>

        {options.map((opt) => {
          const active = value === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onChange(active ? "" : opt)}
              style={[s.pill, active && s.pillActive]}
              activeOpacity={0.85}
            >
              <Text style={[s.pillText, active && s.pillTextActive]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SelectRow({ options, value, onChange, s }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(opt)}
            style={[s.pill, active && s.pillActive]}
            activeOpacity={0.85}
          >
            <Text style={[s.pillText, active && s.pillTextActive]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ---------- styles ---------- */

function makeStyles(colors, isDark, accentBg, _accentText, _silverLight, silverMed) {
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const cardBg = isDark ? "#111217" : "#FFFFFF";

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

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    headerSub: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 2,
    },

    scroll: { paddingHorizontal: 18, paddingBottom: 130 },

    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 10,
      ...softShadow,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: "650",
      paddingVertical: 0,
    },

    filtersCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      marginBottom: 14,
      ...softShadow,
    },
    filtersTitle: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 13,
      letterSpacing: 0.9,
      textTransform: "uppercase",
      marginBottom: 10,
    },
    filterPill: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      backgroundColor: panelBg,
    },
    filterPillActive: { backgroundColor: accentBg, borderColor: accentBg },
    filterPillText: { color: colors.text, fontWeight: "800", fontSize: 12 },
    filterPillTextActive: { color: "#111111", fontWeight: "900" },

    rowLabel: {
      color: colors.subtext,
      fontWeight: "900",
      fontSize: 11,
      letterSpacing: 0.9,
      textTransform: "uppercase",
      marginBottom: 6,
    },

    pill: {
      backgroundColor: panelBg,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
    },
    pillActive: { backgroundColor: accentBg, borderColor: accentBg },
    pillText: { color: colors.text, fontWeight: "800", fontSize: 12 },
    pillTextActive: { color: "#111111", fontWeight: "900" },

    card: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      marginBottom: 14,
      ...softShadow,
    },
    cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    cardTitle: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 13,
      letterSpacing: 0.9,
      textTransform: "uppercase",
    },
    cardMeta: { color: colors.subtext, fontWeight: "800", fontSize: 12 },
    cardSub: { color: colors.subtext, fontSize: 13, lineHeight: 18, fontWeight: "650" },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? "#1F2128" : "#E4E6EC",
    },
    rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    rowTitle: { color: colors.text, fontWeight: "900", fontSize: 14 },
    rowSub: { color: colors.subtext, fontWeight: "650", fontSize: 12, marginTop: 3 },
    rowNote: { color: colors.subtext, fontWeight: "650", fontSize: 12, marginTop: 3, opacity: 0.9 },

    tag: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      backgroundColor: panelBg,
    },
    tagCustom: { backgroundColor: accentBg, borderColor: accentBg },
    tagDefault: {},
    tagText: { color: isDark ? colors.text : "#111111", fontWeight: "900", fontSize: 11 },

    rowIcon: { padding: 6, borderRadius: 10 },

    primaryBtn: {
      backgroundColor: accentBg,
      borderRadius: 22,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 10,
      marginTop: 14,
      ...softShadow,
    },
    primaryBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },

    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "flex-end",
      padding: 16,
    },
    modalCard: {
      width: "100%",
      backgroundColor: cardBg,
      borderRadius: 24,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      ...softShadow,
      maxHeight: "90%",
    },
    modalHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    modalTitle: {
      color: colors.text,
      fontWeight: "900",
      fontSize: 14,
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },

    label: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 0.9,
      textTransform: "uppercase",
      marginBottom: 6,
      marginTop: 6,
    },
    input: {
      backgroundColor: panelBg,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : silverMed,
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },
  });
}
