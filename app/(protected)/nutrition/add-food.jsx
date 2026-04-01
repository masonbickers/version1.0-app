"use client";

/**
 * ADD FOOD — Train-R (SAP GEL style)
 * ✅ Prompts meal type (Breakfast/Lunch/Dinner/Snack) when user taps + Add
 * ✅ Adds instantly to the selected day (Firestore Timestamp on selected day)
 * ✅ Shows popup "Food added"
 * ✅ Stays on this page so user can add multiple items quickly
 * ✅ Shows the day being added to at the top
 *
 * ✅ QUICK LOG (AI) inside Add page:
 * - User types quick text → AI suggests an item + macros
 * - User taps Correct / Wrong
 * - Wrong → re-run the AI lookup again (same text)
 * - Correct → asks meal type (Breakfast/Lunch/Dinner/Snack) → logs it to the selected day
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import {
    Timestamp,
    addDoc,
    collection,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
} from "firebase/firestore";
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
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- config ---------------- */

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

const TABS = [
  { key: "all", label: "All" },
  { key: "meals", label: "My Meals" },
  { key: "recipes", label: "My Recipes" },
  { key: "foods", label: "My Foods" },
];

const SORTS = [
  { key: "recent", label: "Most recent" },
  { key: "az", label: "A–Z" },
];

const COLLECTIONS = {
  foods: "foods",
  recipes: "recipes",
  mealTemplates: "mealTemplates",
  meals: "meals", // logged meals (history comes from here)
};

function safeLower(x) {
  return String(x || "").toLowerCase();
}

function fmtNumber(n) {
  const v = Number(n || 0);
  if (Number.isNaN(v)) return "0";
  return String(Math.round(v));
}

/** ✅ ensure we always use the correct day (start-of-day ISO) */
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

/** ✅ build a Firestore Timestamp on selected day, with current time-of-day */
function timestampOnSelectedDay(selectedDayISO) {
  const base = new Date(String(selectedDayISO));
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    return Timestamp.fromDate(fallback);
  }
  const now = new Date();
  base.setHours(
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
  return Timestamp.fromDate(base);
}

/** ✅ pretty label for the selected day */
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

// Turn various shapes into a single UI model
function normaliseRow(row, source) {
  const title =
    row?.title ||
    row?.name ||
    row?.foodName ||
    row?.label ||
    row?.displayName ||
    "Food";

  const calories =
    row?.calories ??
    row?.kcal ??
    row?.energy ??
    row?.nutrition?.calories ??
    0;

  const servingText =
    row?.servingText ||
    row?.serving ||
    row?.portion ||
    row?.unit ||
    row?.amountText ||
    "";

  const brand = row?.brand || row?.manufacturer || row?.sourceBrand || "";

  const protein = row?.protein ?? row?.macros?.protein ?? 0;
  const carbs = row?.carbs ?? row?.macros?.carbs ?? 0;
  const fat = row?.fat ?? row?.macros?.fat ?? 0;

  // Provider metadata for global results
  const provider = row?.provider || row?.sourceProvider || "";
  const providerId =
    row?.providerId || row?.nix_item_id || row?.foodId || row?.id || "";
  const isGeneric = !!row?.isGeneric;

  return {
    id: row?.id || `${source}:${title}:${servingText || "x"}`,
    source,
    title,
    calories: Number(calories || 0),
    servingText,
    brand,
    macros: {
      protein: Number(protein || 0),
      carbs: Number(carbs || 0),
      fat: Number(fat || 0),
    },
    provider,
    providerId,
    verification:
      row?.verification || (row?.verified ? "verified" : "unverified"),
    verified: Boolean(row?.verified || row?.verification === "verified"),
    isGeneric,
    _raw: row,
  };
}

function hasAnyMacros(row) {
  const c = Number(row?.calories || 0);
  const p = Number(row?.macros?.protein || 0);
  const cr = Number(row?.macros?.carbs || 0);
  const f = Number(row?.macros?.fat || 0);
  return c > 0 || p > 0 || cr > 0 || f > 0;
}

function toQuickAIRow(ai, quickText) {
  const title = ai?.title || quickText || "Food";
  const calories = Number(ai?.calories || 0);
  const protein = Number(ai?.protein || 0);
  const carbs = Number(ai?.carbs || 0);
  const fat = Number(ai?.fat || 0);
  const notes =
    ai?.notes ||
    `Quick log: ${quickText}${ai?.confidence ? ` (conf: ${ai.confidence})` : ""}`;

  return normaliseRow(
    {
      id: `quick-ai:${safeLower(title)}:${safeLower(String(calories))}`,
      title,
      calories,
      protein,
      carbs,
      fat,
      brand: ai?.brand || "",
      servingText: ai?.servingText || "",
      notes,
    },
    "quick-ai"
  );
}

export default function AddFoodPage() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();

  const [userReady, setUserReady] = useState(false);

  const initialMeal =
    params?.mealType && MEAL_TYPES.includes(String(params.mealType))
      ? String(params.mealType)
      : "Breakfast";

  const [mealType, setMealType] = useState(initialMeal);
  const [mealPickerOpen, setMealPickerOpen] = useState(false);

  const [tab, setTab] = useState("all");
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");

  const [foods, setFoods] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(true);

  // ✅ Global search state
  const [globalResults, setGlobalResults] = useState([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const lastGlobalQueryRef = useRef("");

  // ✅ Prompt state (pick Breakfast/Lunch/Dinner/Snack when adding)
  const [mealPromptOpen, setMealPromptOpen] = useState(false);
  const [pendingRow, setPendingRow] = useState(null);
  const [addingId, setAddingId] = useState(""); // row.id currently adding

  // ✅ QUICK LOG (AI) state
  const [quickText, setQuickText] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickCandidate, setQuickCandidate] = useState(null);
  const [quickConfirmOpen, setQuickConfirmOpen] = useState(false);
  const quickLastTextRef = useRef("");

  // SAP GEL tokens
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

  // auth gate
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.replace("/(auth)/login");
      setUserReady(!!u);
    });
    return () => unsub();
  }, [router]);

  /**
   * ✅ Date handling:
   * If NutritionPage passes params.date we honour it.
   * Otherwise fallback to TODAY.
   */
  const selectedDateISO = useMemo(
    () => startOfDayISO(params?.date),
    [params?.date]
  );

  const selectedDayLabel = useMemo(
    () => formatDayLabel(selectedDateISO),
    [selectedDateISO]
  );

  /** ✅ consistent “close/back” behaviour */
  const goBackToNutrition = useCallback(() => {
    router.replace({
      pathname: "/nutrition",
      params: { date: selectedDateISO },
    });
  }, [router, selectedDateISO]);

  // live subscriptions
  useEffect(() => {
    const u = auth.currentUser;
    if (!u || !userReady) return;

    setLoading(true);
    const unsubs = [];

    // My Foods
    {
      const ref = collection(db, "users", u.uid, COLLECTIONS.foods);
      const qy = query(ref, orderBy("updatedAt", "desc"), limit(120));
      const unsub = onSnapshot(
        qy,
        (snap) => setFoods(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => {}
      );
      unsubs.push(unsub);
    }

    // My Recipes
    {
      const ref = collection(db, "users", u.uid, COLLECTIONS.recipes);
      const qy = query(ref, orderBy("updatedAt", "desc"), limit(120));
      const unsub = onSnapshot(
        qy,
        (snap) => setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => {}
      );
      unsubs.push(unsub);
    }

    // My Meals (templates)
    {
      const ref = collection(db, "users", u.uid, COLLECTIONS.mealTemplates);
      const qy = query(ref, orderBy("updatedAt", "desc"), limit(120));
      const unsub = onSnapshot(
        qy,
        (snap) =>
          setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => {}
      );
      unsubs.push(unsub);
    }

    // History from logged meals
    {
      const ref = collection(db, "users", u.uid, COLLECTIONS.meals);
      const qy = query(ref, orderBy("createdAt", "desc"), limit(80));
      const unsub = onSnapshot(
        qy,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

          const seen = new Set();
          const uniq = [];
          for (const r of rows) {
            const title = r?.title || r?.name || r?.foodName || "";
            const servingText = r?.servingText || r?.serving || r?.portion || "";
            const key = `${safeLower(title)}__${safeLower(servingText)}`;
            if (!title) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            uniq.push(r);
          }
          setHistory(uniq.slice(0, 35));
        },
        () => {}
      );
      unsubs.push(unsub);
    }

    const t = setTimeout(() => setLoading(false), 220);

    return () => {
      clearTimeout(t);
      unsubs.forEach((fn) => fn?.());
    };
  }, [userReady]);

  /* ---------------- navigation actions ---------------- */

  const handleBarcode = useCallback(() => {
    router.push({
      pathname: "/nutrition/barcode",
      params: { date: selectedDateISO, mealType },
    });
  }, [router, selectedDateISO, mealType]);

  const handleVoice = useCallback(() => {
    router.push({
      pathname: "/nutrition/voice-log",
      params: { date: selectedDateISO, mealType },
    });
  }, [router, selectedDateISO, mealType]);

  const handleMealScan = useCallback(() => {
    router.push({
      pathname: "/nutrition/meal-scan",
      params: { date: selectedDateISO, mealType },
    });
  }, [router, selectedDateISO, mealType]);

  const handleQuickAdd = useCallback(() => {
    router.push({
      pathname: "/nutrition/quick-add",
      params: { date: selectedDateISO, mealType },
    });
  }, [router, selectedDateISO, mealType]);

  /* ---------------- data helpers ---------------- */

  // ✅ Fetch details for global items that are generic / missing macros
  const fetchGlobalDetailsIfNeeded = useCallback(async (row) => {
    if (hasAnyMacros(row) && !row.isGeneric) return row;

    if (!API_URL) {
      throw new Error("Missing API_URL (EXPO_PUBLIC_API_URL).");
    }

    let item = null;

    // 1) deterministic provider lookup
    try {
      const qs = new URLSearchParams();
      if (row.provider) qs.set("provider", row.provider);
      if (row.providerId) qs.set("id", row.providerId);
      qs.set("name", row.title || "");

      const detailsRes = await fetch(
        `${API_URL}/nutrition/food-details?${qs.toString()}`
      );
      if (detailsRes.ok) {
        const detailsData = await detailsRes.json();
        item = detailsData?.item || detailsData;
      }
    } catch {
      // fall through to AI fallback
    }

    // 2) AI fallback for unmatched generic names
    if (!item) {
      const prompt = [row.title, row.servingText].filter(Boolean).join(", ");
      const aiRes = await fetch(`${API_URL}/nutrition/describe-meal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt || row.title || "Food item" }),
      });
      if (!aiRes.ok) throw new Error(await aiRes.text());
      item = await aiRes.json();
    }

    const perServing = item?.perServing || item?.nutrientsPerServing || {};
    const filled = normaliseRow(
      {
        ...row?._raw,
        title: item?.title || row.title,
        calories: Number(item?.calories ?? perServing?.calories ?? row.calories ?? 0),
        protein: Number(
          item?.macros?.protein ??
            item?.protein ??
            perServing?.protein ??
            row?.macros?.protein ??
            0
        ),
        carbs: Number(
          item?.macros?.carbs ??
            item?.carbs ??
            perServing?.carbs ??
            row?.macros?.carbs ??
            0
        ),
        fat: Number(
          item?.macros?.fat ??
            item?.fat ??
            perServing?.fat ??
            row?.macros?.fat ??
            0
        ),
        fibre: Number(item?.fibre ?? perServing?.fibre ?? 0),
        sugar: Number(item?.sugar ?? perServing?.sugar ?? 0),
        sodium: Number(item?.sodium ?? perServing?.sodiumMg ?? 0),
        potassium: Number(item?.potassium ?? perServing?.potassiumMg ?? 0),
        notes: item?.notes || row?._raw?.notes || "",
        brand: item?.brand || row.brand || "",
        servingText: item?.servingText || item?.serving?.text || row.servingText || "",
        provider: item?.provider || row.provider,
        providerId: item?.providerId || row.providerId,
        verification: item?.verification || row?.verification || "",
        verified: Boolean(item?.verified ?? row?.verified),
        isGeneric: false,
      },
      "global"
    );

    return filled;
  }, []);

  // ✅ Actually add to Firestore (stay on page)
  const addRowToDay = useCallback(
    async (row, chosenMealType) => {
      const u = auth.currentUser;
      if (!u) return;

      const dateTs = timestampOnSelectedDay(selectedDateISO);

      // global row may need macro fill
      let finalRow = row;

      if (row?.source === "global") {
        setGlobalLoading(true);
        try {
          finalRow = await fetchGlobalDetailsIfNeeded(row);
        } catch (e) {
          const msg =
            e?.message?.includes("404")
              ? "This item needs a nutrition lookup endpoint on your backend."
              : "Couldn’t load nutrition details.";
          throw new Error(msg);
        } finally {
          setGlobalLoading(false);
        }
      }

      await addDoc(collection(db, "users", u.uid, "meals"), {
        title: finalRow.title || "Food",
        mealType: chosenMealType || "Unspecified",

        calories: Number(finalRow.calories || 0),
        protein: Number(finalRow.macros?.protein || 0),
        carbs: Number(finalRow.macros?.carbs || 0),
        fat: Number(finalRow.macros?.fat || 0),

        servingText: finalRow.servingText || "",
        notes:
          finalRow?._raw?.notes ||
          (finalRow.brand ? `Brand: ${finalRow.brand}` : ""),
        source: finalRow.source || "quick",

        date: dateTs, // 🔑 MUST exist + MUST be Timestamp on selected day
        createdAt: serverTimestamp(),
      });
    },
    [selectedDateISO, fetchGlobalDetailsIfNeeded]
  );

  /* ---------------- Add flow: open meal prompt ---------------- */

  const openMealPromptForRow = useCallback((row) => {
    setPendingRow(row);
    setMealPromptOpen(true);
  }, []);

  const confirmAddWithMeal = useCallback(
    async (chosenMeal) => {
      if (!pendingRow) return;

      const row = pendingRow;
      setMealPromptOpen(false);
      setPendingRow(null);

      // keep header meal chip in sync with last used selection
      if (chosenMeal && chosenMeal !== mealType) setMealType(chosenMeal);

      const id = row?.id ? String(row.id) : "x";
      setAddingId(id);

      try {
        await addRowToDay(row, chosenMeal);
        Alert.alert("Food added", "Added to your day.");
      } catch (e) {
        Alert.alert("Couldn’t add item", e?.message || "Please try again.");
      } finally {
        setAddingId("");
      }
    },
    [pendingRow, mealType, addRowToDay]
  );

  /* ---------------- QUICK LOG (AI) ---------------- */

  const runQuickAI = useCallback(
    async (text) => {
      if (!API_URL) {
        Alert.alert("Config error", "Missing API_URL (EXPO_PUBLIC_API_URL).");
        return;
      }

      const q = String(text || "").trim();
      if (!q) return;

      try {
        setQuickLoading(true);
        quickLastTextRef.current = q;

        const res = await fetch(`${API_URL}/nutrition/describe-meal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: q }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        const row = toQuickAIRow(data, q);
        setQuickCandidate(row);
        setQuickConfirmOpen(true);
      } catch (e) {
        Alert.alert(
          "Couldn’t analyse",
          e?.message || "Please try a different description."
        );
      } finally {
        setQuickLoading(false);
      }
    },
    [API_URL]
  );

  const onQuickWrong = useCallback(async () => {
    // re-run the same prompt again
    const q = quickLastTextRef.current || quickText.trim();
    await runQuickAI(q);
  }, [runQuickAI, quickText]);

  const onQuickCorrect = useCallback(() => {
    if (!quickCandidate) return;
    setQuickConfirmOpen(false);
    // now force meal selection prompt (Breakfast/Lunch/Dinner/Snack)
    openMealPromptForRow(quickCandidate);
  }, [quickCandidate, openMealPromptForRow]);

  /* ---------------- GLOBAL SEARCH ---------------- */

  useEffect(() => {
    let alive = true;

    const q = search.trim();
    const shouldSearchGlobal = tab === "all" && q.length >= 2;

    if (!shouldSearchGlobal) {
      setGlobalResults([]);
      setGlobalError("");
      setGlobalLoading(false);
      lastGlobalQueryRef.current = "";
      return () => {
        alive = false;
      };
    }

    if (!API_URL) {
      setGlobalError("Missing API_URL in app config.");
      setGlobalResults([]);
      setGlobalLoading(false);
      return () => {
        alive = false;
      };
    }

    const debounce = setTimeout(async () => {
      try {
        setGlobalLoading(true);
        setGlobalError("");

        lastGlobalQueryRef.current = q;

        const res = await fetch(
          `${API_URL}/nutrition/search?q=${encodeURIComponent(q)}`
        );
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (!alive) return;
        if (lastGlobalQueryRef.current !== q) return;

        const rows = (data?.results || []).map((r) => normaliseRow(r, "global"));
        setGlobalResults(rows);
      } catch (e) {
        if (!alive) return;
        setGlobalResults([]);
        setGlobalError("Couldn’t load global results.");
      } finally {
        if (!alive) return;
        setGlobalLoading(false);
      }
    }, 420);

    return () => {
      alive = false;
      clearTimeout(debounce);
    };
  }, [search, tab]);

  /* ---------------- derived lists ---------------- */

  const listByTab = useMemo(() => {
    const normFoods = foods.map((r) => normaliseRow(r, "foods"));
    const normRecipes = recipes.map((r) => normaliseRow(r, "recipes"));
    const normTemplates = templates.map((r) => normaliseRow(r, "meals"));

    if (tab === "foods") return normFoods;
    if (tab === "recipes") return normRecipes;
    if (tab === "meals") return normTemplates;

    return [...normTemplates, ...normRecipes, ...normFoods];
  }, [foods, recipes, templates, tab]);

  const filtered = useMemo(() => {
    const q = safeLower(search.trim());
    if (!q) return listByTab;

    return listByTab.filter((r) => {
      const t = safeLower(r.title);
      const b = safeLower(r.brand);
      const sTxt = safeLower(r.servingText);
      return t.includes(q) || b.includes(q) || sTxt.includes(q);
    });
  }, [listByTab, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "az") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
      return arr;
    }
    return arr;
  }, [filtered, sort]);

  const historyFiltered = useMemo(() => {
    const q = safeLower(search.trim());
    const normHistory = history.map((r) => normaliseRow(r, "history"));
    if (!q) return normHistory;

    return normHistory.filter((r) => {
      const t = safeLower(r.title);
      const b = safeLower(r.brand);
      const sTxt = safeLower(r.servingText);
      return t.includes(q) || b.includes(q) || sTxt.includes(q);
    });
  }, [history, search]);

  /* ---------------- render helpers ---------------- */

  const renderRow = (row) => {
    const kcal = fmtNumber(row.calories);
    const servingLine = [row.servingText || null, row.brand || null]
      .filter(Boolean)
      .join(" • ");
    const qualityTag =
      row.source === "global"
        ? row.verified
          ? "Verified"
          : row.verification === "community"
          ? "Community"
          : "Unverified"
        : "";

    const isAddingThis = addingId && String(row.id) === String(addingId);

    return (
      <View key={row.id} style={s.rowWrap}>
        <View style={s.row}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {row.title}
            </Text>

            <Text style={s.rowMeta} numberOfLines={1}>
              {row.source === "global" && row.brand ? `${row.brand} • ` : ""}
              {kcal} kcal{servingLine ? ` • ${servingLine}` : ""}
              {qualityTag ? ` • ${qualityTag}` : ""}
            </Text>

            {row.macros?.protein || row.macros?.carbs || row.macros?.fat ? (
              <Text style={s.rowMacros} numberOfLines={1}>
                P {fmtNumber(row.macros.protein)}g · C {fmtNumber(row.macros.carbs)}g · F{" "}
                {fmtNumber(row.macros.fat)}g
              </Text>
            ) : row.source === "global" ? (
              <Text style={s.rowMacros} numberOfLines={1}>
                Tap + to load and add
              </Text>
            ) : null}
          </View>

          {/* ✅ Add button: prompt meal type -> add -> popup -> stay here */}
          <TouchableOpacity
            onPress={() => openMealPromptForRow(row)}
            activeOpacity={0.85}
            style={s.addBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={!!addingId} // 1 add at a time
          >
            {isAddingThis || (globalLoading && row.source === "global") ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <Feather name="plus" size={18} color="#111111" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.page}>
          {/* Top bar */}
          <View style={s.topBar}>
            <TouchableOpacity
              onPress={goBackToNutrition}
              style={s.iconBtn}
              activeOpacity={0.8}
            >
              <Feather name="x" size={20} color={colors.text} />
            </TouchableOpacity>

            <Pressable
              onPress={() => setMealPickerOpen((v) => !v)}
              style={s.titlePicker}
            >
              <Text style={s.topTitle}>Select a meal</Text>
              <View style={s.mealChip}>
                <Text style={s.mealChipText}>{mealType}</Text>
                <Feather name="chevron-down" size={14} color={accentText} />
              </View>
            </Pressable>

            <View style={{ width: 40 }} />
          </View>

          {/* ✅ Day being added to */}
          <View style={s.dayStrip}>
            <Text style={s.dayStripText}>Adding to</Text>
            <View style={s.dayPill}>
              <Text style={s.dayPillText}>{selectedDayLabel}</Text>
            </View>
          </View>

          {/* Meal dropdown (header picker) */}
          {mealPickerOpen ? (
            <View style={s.dropdown}>
              {MEAL_TYPES.map((mt) => {
                const active = mt === mealType;
                return (
                  <TouchableOpacity
                    key={mt}
                    style={[s.dropdownItem, active && s.dropdownItemActive]}
                    onPress={() => {
                      setMealType(mt);
                      setMealPickerOpen(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={[s.dropdownText, active && s.dropdownTextActive]}>
                      {mt}
                    </Text>
                    {active ? <Feather name="check" size={16} color="#111111" /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {/* ✅ QUICK LOG (AI) */}
          <View style={s.quickWrap}>
            <View style={s.quickHeadRow}>
              <Text style={s.quickTitle}>Quick log</Text>
              <Text style={s.quickSub}>Describe your food in one line</Text>
            </View>

            <View style={s.quickBox}>
              <TextInput
                placeholder="e.g. chicken wrap and crisps"
                placeholderTextColor={colors.subtext}
                value={quickText}
                onChangeText={setQuickText}
                style={s.quickInput}
                keyboardAppearance={isDark ? "dark" : "light"}
                returnKeyType="done"
                autoCorrect
              />
              <TouchableOpacity
                style={[s.quickSend, (!quickText.trim() || quickLoading) && { opacity: 0.5 }]}
                onPress={() => runQuickAI(quickText)}
                disabled={!quickText.trim() || quickLoading}
                activeOpacity={0.85}
              >
                {quickLoading ? (
                  <ActivityIndicator color="#111111" />
                ) : (
                  <Feather name="sparkles" size={16} color="#111111" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Search */}
          <View style={s.searchBox}>
            <Feather name="search" size={16} color={colors.subtext} />
            <TextInput
              placeholder="Search foods, meals, recipes…"
              placeholderTextColor={colors.subtext}
              value={search}
              onChangeText={setSearch}
              style={s.searchInput}
              keyboardAppearance={isDark ? "dark" : "light"}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {!!search ? (
              <TouchableOpacity
                onPress={() => setSearch("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x-circle" size={16} color={colors.subtext} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Tabs */}
          <View style={s.tabsRow}>
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[s.tab, active && s.tabActive]}
                  onPress={() => setTab(t.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[s.tabText, active && s.tabTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Action tiles */}
          <View style={s.actionsGrid}>
            <ActionTile label="Barcode" icon="maximize" onPress={handleBarcode} s={s} accentText={accentText} />
            <ActionTile label="Voice log" icon="mic" onPress={handleVoice} s={s} accentText={accentText} />
            <ActionTile label="Meal scan" icon="camera" onPress={handleMealScan} s={s} accentText={accentText} />
            <ActionTile label="Quick add" icon="plus-circle" onPress={handleQuickAdd} s={s} accentText={accentText} />
          </View>

          {/* Lists */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>
                {tab === "all"
                  ? "History"
                  : tab === "meals"
                  ? "My Meals"
                  : tab === "recipes"
                  ? "My Recipes"
                  : "My Foods"}
              </Text>

              <TouchableOpacity
                style={s.sortPill}
                activeOpacity={0.85}
                onPress={() => setSort((prev) => (prev === "recent" ? "az" : "recent"))}
              >
                <Feather name="sliders" size={14} color={colors.text} />
                <Text style={s.sortPillText}>
                  {SORTS.find((x) => x.key === sort)?.label || "Most recent"}
                </Text>
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator style={{ marginTop: 12 }} />
            ) : tab === "all" ? (
              <>
                {/* Global results */}
                {search.trim().length >= 2 ? (
                  <>
                    <View style={s.subHeadRow}>
                      <Text style={s.subHead}>Global results</Text>
                      <Text style={s.subHeadRight}>
                        {globalLoading
                          ? "Searching…"
                          : globalError
                          ? "—"
                          : globalResults.length
                          ? `${globalResults.length} found`
                          : "0 found"}
                      </Text>
                    </View>

                    <View style={s.card}>
                      {globalLoading && !globalResults.length ? (
                        <ActivityIndicator style={{ padding: 14 }} />
                      ) : globalError ? (
                        <Text style={s.empty}>{globalError}</Text>
                      ) : globalResults.length ? (
                        globalResults.slice(0, 20).map(renderRow)
                      ) : (
                        <Text style={s.empty}>No global matches — try another search.</Text>
                      )}
                    </View>

                    <View style={{ height: 14 }} />
                  </>
                ) : null}

                {/* History */}
                {historyFiltered.length ? (
                  <View style={s.card}>{historyFiltered.slice(0, 12).map(renderRow)}</View>
                ) : (
                  <View style={s.card}>
                    <Text style={s.empty}>
                      No history yet — add a meal, then your frequent foods will appear here.
                    </Text>
                  </View>
                )}

                <View style={{ height: 14 }} />

                <View style={s.subHeadRow}>
                  <Text style={s.subHead}>Saved</Text>
                  <Text style={s.subHeadRight}>{sorted.length ? `${sorted.length} items` : ""}</Text>
                </View>

                <View style={s.card}>
                  {sorted.length ? (
                    sorted.slice(0, 40).map(renderRow)
                  ) : (
                    <Text style={s.empty}>
                      Nothing saved yet — create foods, recipes, or meals to see them here.
                    </Text>
                  )}
                </View>
              </>
            ) : (
              <View style={s.card}>
                {sorted.length ? (
                  sorted.map(renderRow)
                ) : (
                  <Text style={s.empty}>
                    {search
                      ? "No matches — try a different search."
                      : "Nothing here yet — add items from Quick add, or create foods/recipes."}
                  </Text>
                )}
              </View>
            )}

            <View style={{ height: 24 }} />
          </ScrollView>

          {/* ✅ Meal-type prompt modal (shown on + press or quick-log confirm) */}
          <Modal
            visible={mealPromptOpen}
            transparent
            animationType="fade"
            onRequestClose={() => {
              setMealPromptOpen(false);
              setPendingRow(null);
            }}
          >
            <Pressable
              style={s.modalOverlay}
              onPress={() => {
                setMealPromptOpen(false);
                setPendingRow(null);
              }}
            >
              <Pressable style={s.modalCard} onPress={() => {}}>
                <View style={s.modalHead}>
                  <Text style={s.modalTitle}>Add to which meal?</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setMealPromptOpen(false);
                      setPendingRow(null);
                    }}
                    style={s.modalClose}
                    activeOpacity={0.85}
                  >
                    <Feather name="x" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={s.modalSub}>
                  {pendingRow?.title ? pendingRow.title : "Food"} • {selectedDayLabel}
                </Text>

                <View style={{ height: 10 }} />

                {MEAL_TYPES.map((mt) => {
                  const active = mt === mealType;
                  return (
                    <TouchableOpacity
                      key={mt}
                      style={[s.modalItem, active && s.modalItemActive]}
                      onPress={() => confirmAddWithMeal(mt)}
                      activeOpacity={0.9}
                      disabled={!!addingId}
                    >
                      <Text style={[s.modalItemText, active && s.modalItemTextActive]}>
                        {mt}
                      </Text>
                      {active ? <Feather name="check" size={16} color="#111111" /> : null}
                    </TouchableOpacity>
                  );
                })}

                <View style={{ height: 8 }} />

                <TouchableOpacity
                  style={s.modalCancel}
                  onPress={() => {
                    setMealPromptOpen(false);
                    setPendingRow(null);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={s.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>

          {/* ✅ Quick-log confirmation modal (AI found this item → Correct/Wrong) */}
          <Modal
            visible={quickConfirmOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setQuickConfirmOpen(false)}
          >
            <Pressable
              style={s.modalOverlay}
              onPress={() => setQuickConfirmOpen(false)}
            >
              <Pressable style={s.modalCard} onPress={() => {}}>
                <View style={s.modalHead}>
                  <Text style={s.modalTitle}>AI found this</Text>
                  <TouchableOpacity
                    onPress={() => setQuickConfirmOpen(false)}
                    style={s.modalClose}
                    activeOpacity={0.85}
                  >
                    <Feather name="x" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <Text style={s.modalSub}>
                  For: “{quickLastTextRef.current || quickText.trim() || "—"}”
                </Text>

                <View style={{ height: 12 }} />

                <View style={s.aiCard}>
                  <Text style={s.aiTitle} numberOfLines={2}>
                    {quickCandidate?.title || "Food"}
                  </Text>
                  <Text style={s.aiMeta}>
                    {fmtNumber(quickCandidate?.calories)} kcal • P{" "}
                    {fmtNumber(quickCandidate?.macros?.protein)}g • C{" "}
                    {fmtNumber(quickCandidate?.macros?.carbs)}g • F{" "}
                    {fmtNumber(quickCandidate?.macros?.fat)}g
                  </Text>
                  {quickCandidate?._raw?.notes ? (
                    <Text style={s.aiNotes} numberOfLines={3}>
                      {String(quickCandidate._raw.notes)}
                    </Text>
                  ) : null}
                </View>

                <View style={{ height: 10 }} />

                <View style={s.aiBtnRow}>
                  <TouchableOpacity
                    style={[s.aiBtn, s.aiBtnGhost]}
                    onPress={onQuickWrong}
                    activeOpacity={0.9}
                    disabled={quickLoading}
                  >
                    {quickLoading ? (
                      <ActivityIndicator />
                    ) : (
                      <>
                        <Feather name="refresh-cw" size={16} color={colors.text} />
                        <Text style={s.aiBtnGhostText}>Wrong</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.aiBtn, s.aiBtnSolid]}
                    onPress={onQuickCorrect}
                    activeOpacity={0.9}
                    disabled={!quickCandidate}
                  >
                    <Feather name="check" size={16} color="#111111" />
                    <Text style={s.aiBtnSolidText}>Correct</Text>
                  </TouchableOpacity>
                </View>

                <Text style={s.aiHint}>
                  Wrong will re-run the AI using the same text.
                </Text>
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActionTile({ label, icon, onPress, s, accentText }) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.85}>
      <View style={s.tileIconWrap}>
        <Feather name={icon} size={18} color={accentText} />
      </View>
      <Text style={s.tileLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

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
    titlePicker: { alignItems: "center", gap: 6 },
    topTitle: {
      fontSize: 15,
      fontWeight: "800",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: colors.text,
    },
    mealChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    mealChipText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 12,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },

    /* ✅ day strip */
    dayStrip: {
      marginTop: -4,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    dayStripText: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    dayPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
    },
    dayPillText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },

    dropdown: {
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      borderRadius: 16,
      padding: 8,
      marginBottom: 12,
    },
    dropdownItem: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dropdownItemActive: { backgroundColor: accentBg },
    dropdownText: {
      color: colors.text,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },
    dropdownTextActive: { color: "#111111" },

    /* QUICK LOG */
    quickWrap: {
      marginBottom: 12,
      borderRadius: 20,
      backgroundColor: isDark ? "#111217" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      padding: 12,
    },
    quickHeadRow: { marginBottom: 8 },
    quickTitle: {
      color: colors.text,
      fontWeight: "900",
      letterSpacing: 0.7,
      textTransform: "uppercase",
      fontSize: 12,
    },
    quickSub: {
      color: colors.subtext,
      fontSize: 12,
      marginTop: 2,
    },
    quickBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    quickInput: {
      flex: 1,
      color: colors.text,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      fontSize: 14,
    },
    quickSend: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: accentBg,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },

    /* Search */
    searchBox: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      backgroundColor: isDark ? "#111217" : silverLight,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    searchInput: { flex: 1, color: colors.text, paddingVertical: 0, fontSize: 14 },

    tabsRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 12,
      marginBottom: 12,
      flexWrap: "wrap",
    },
    tab: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
    },
    tabActive: { backgroundColor: accentBg, borderColor: accentBg },
    tabText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    tabTextActive: { color: "#111111" },

    actionsGrid: {
      flexDirection: "row",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 14,
    },
    tile: {
      width: "48%",
      backgroundColor: isDark ? "#111217" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      borderRadius: 18,
      paddingVertical: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    tileIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 14,
      backgroundColor: isDark ? "#0F1014" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      alignItems: "center",
      justifyContent: "center",
    },
    tileLabel: {
      color: colors.text,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },

    scrollContent: { paddingBottom: 24 },

    sectionHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: colors.text,
    },
    sortPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: isDark ? "#111217" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sortPillText: { color: colors.text, fontWeight: "700", fontSize: 12 },

    subHeadRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
      paddingHorizontal: 2,
    },
    subHead: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    subHeadRight: { color: colors.subtext, fontSize: 12, fontWeight: "700" },

    card: {
      backgroundColor: isDark ? "#111217" : silverLight,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      overflow: "hidden",
    },
    rowWrap: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    row: {
      paddingHorizontal: 14,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
    rowMeta: { color: colors.subtext, fontSize: 12, marginTop: 2 },
    rowMacros: { color: colors.subtext, fontSize: 12, marginTop: 2 },

    addBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: accentBg,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },

    empty: { padding: 14, color: colors.subtext, lineHeight: 20 },

    /* ---------- modal ---------- */
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
    modalItemActive: {
      backgroundColor: accentBg,
      borderColor: accentBg,
    },
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
    },
    modalCancelText: {
      color: colors.text,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },

    /* AI confirm card */
    aiCard: {
      backgroundColor: isDark ? "#111217" : silverLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: silverMed,
      borderRadius: 16,
      padding: 12,
    },
    aiTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "900",
      marginBottom: 6,
    },
    aiMeta: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginBottom: 6,
    },
    aiNotes: {
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 18,
    },
    aiBtnRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 6,
    },
    aiBtn: {
      flex: 1,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
    },
    aiBtnGhost: {
      backgroundColor: isDark ? "#111217" : silverLight,
      borderColor: colors.border,
    },
    aiBtnGhostText: {
      color: colors.text,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },
    aiBtnSolid: {
      backgroundColor: accentBg,
      borderColor: accentBg,
    },
    aiBtnSolidText: {
      color: "#111111",
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 12,
    },
    aiHint: {
      marginTop: 10,
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 18,
    },
  });
}
