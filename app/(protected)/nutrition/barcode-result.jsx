// app/(protected)/nutrition/barcode-result.jsx
"use client";

/**
 * BARCODE RESULT — SAP GEL STYLE
 * - Looks up barcode via API
 * - Lets user choose serving + quantity
 * - Sends prefills to /nutrition/add
 * - Hides footer/tab bar on this screen
 */

import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { useTheme } from "../../../providers/ThemeProvider";

const PRIMARY = "#E6FF3B";

const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack"];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export default function BarcodeResultScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const params = useLocalSearchParams();

  // ---------------- Hide footer / tab bar on this screen ----------------
  useEffect(() => {
    const parent = navigation.getParent?.();
    if (!parent) return;

    parent.setOptions?.({
      tabBarStyle: { display: "none" },
    });

    return () => {
      parent.setOptions?.({
        tabBarStyle: undefined,
      });
    };
  }, [navigation]);

  // ---------------- Params ----------------
  const barcode = useMemo(() => {
    const raw = typeof params.barcode === "string" ? params.barcode : "";
    return raw.trim();
  }, [params.barcode]);

  const dateParam = useMemo(() => {
    const raw = typeof params.date === "string" ? params.date : null;
    const ok = raw && !Number.isNaN(new Date(raw).getTime());
    return ok ? raw : new Date().toISOString();
  }, [params.date]);

  const mealTypeParam = useMemo(() => {
    const raw = typeof params.mealType === "string" ? params.mealType : "";
    const clean = raw.trim();
    return MEAL_TYPES.includes(clean) ? clean : "";
  }, [params.mealType]);

  // ---------------- State ----------------
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const [product, setProduct] = useState(null);

  // serving controls
  const [mealType, setMealType] = useState(mealTypeParam || "Lunch");
  const [unitMode, setUnitMode] = useState("serving"); // "serving" | "grams"
  const [qty, setQty] = useState(1); // servings or grams depending on mode

  const s = makeStyles(colors, isDark);

  // ---------------- Lookup ----------------
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!barcode) {
        setLoading(false);
        setLookupError("No barcode received.");
        return;
      }
      if (!API_URL) {
        setLoading(false);
        setLookupError("API URL missing. Check EXPO_PUBLIC_API_URL.");
        return;
      }

      try {
        setLoading(true);
        setLookupError("");

        const endpoint = `${API_URL}/nutrition/barcode-lookup`;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcode }),
        });

        const text = await res.text();

        if (!res.ok) {
          throw new Error(
            `Barcode lookup failed (${res.status}). ${text?.slice(0, 140) || ""}`
          );
        }

        let data = {};
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Lookup response was not valid JSON.");
        }

        /**
         * Expected shapes (any of these are fine):
         * 1) { title, brand, servingSize, servingUnit, macrosPerServing: {calories,protein,carbs,fat}, macrosPer100g: {...} }
         * 2) { product: { ...same... } }
         */
        const p = data.product || data;

        if (!p?.title && !p?.name) {
          throw new Error("No product found for that barcode.");
        }

        const normalised = {
          title: p.title || p.name || "Food item",
          brand: p.brand || p.brands || "",
          servingSize: Number(p.servingSize || p.serving_size || 1) || 1,
          servingUnit: p.servingUnit || p.serving_unit || "serving",

          // per serving
          perServing: p.macrosPerServing || p.perServing || {
            calories: Number(p.calories || 0),
            protein: Number(p.protein || 0),
            carbs: Number(p.carbs || 0),
            fat: Number(p.fat || 0),
          },

          // per 100g (optional)
          per100g: p.macrosPer100g || p.per100g || null,
        };

        if (!cancelled) setProduct(normalised);
      } catch (e) {
        if (!cancelled) setLookupError(e?.message || "Could not look up barcode.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  const computed = useMemo(() => {
    if (!product) return null;

    const safeQty =
      unitMode === "grams"
        ? clamp(Number(qty || 0), 1, 5000)
        : clamp(Number(qty || 0), 0.25, 50);

    // prefer per100g if using grams
    if (unitMode === "grams" && product.per100g) {
      const factor = safeQty / 100;
      return {
        calories: Math.round((product.per100g.calories || 0) * factor),
        protein: Math.round((product.per100g.protein || 0) * factor),
        carbs: Math.round((product.per100g.carbs || 0) * factor),
        fat: Math.round((product.per100g.fat || 0) * factor),
        qty: safeQty,
      };
    }

    // fallback: per serving
    const factor = safeQty;
    return {
      calories: Math.round((product.perServing?.calories || 0) * factor),
      protein: Math.round((product.perServing?.protein || 0) * factor),
      carbs: Math.round((product.perServing?.carbs || 0) * factor),
      fat: Math.round((product.perServing?.fat || 0) * factor),
      qty: safeQty,
    };
  }, [product, unitMode, qty]);

  const goToAdd = useCallback(() => {
    if (!product || !computed) return;

    router.push({
      pathname: "/nutrition/add",
      params: {
        // prefills
        title: product.title,
        brand: product.brand,
        calories: String(computed.calories),
        protein: String(computed.protein),
        carbs: String(computed.carbs),
        fat: String(computed.fat),

        // context
        mealType,
        barcode: String(barcode),
        date: dateParam,
        fromBarcode: "1",

        // serving info
        unitMode,
        quantity: String(computed.qty),
        servingSize: String(product.servingSize || 1),
        servingUnit: String(product.servingUnit || "serving"),
      },
    });
  }, [router, product, computed, mealType, barcode, dateParam, unitMode]);

  const goManual = useCallback(() => {
    router.push({
      pathname: "/nutrition/add",
      params: {
        barcode: String(barcode),
        date: dateParam,
        mealType,
        fromBarcode: "1",
      },
    });
  }, [router, barcode, dateParam, mealType]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.page}>
          <Header onBack={() => router.back()} />
          <View style={s.center}>
            <ActivityIndicator size="large" color={PRIMARY} />
            <Text style={s.subtle}>Looking up barcode…</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.page}>
          <Header onBack={() => router.back()} />
          <View style={s.card}>
            <Text style={s.cardTitle}>No result</Text>
            <Text style={s.cardText}>
              {lookupError || "We couldn’t find a product for this barcode."}
            </Text>

            <TouchableOpacity style={s.primaryBtn} onPress={goManual} activeOpacity={0.9}>
              <Feather name="edit-3" size={16} color="#111111" />
              <Text style={s.primaryBtnText}>Add manually</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() =>
                router.replace({
                  pathname: "/nutrition/barcode",
                  params: { date: dateParam, mealType },
                })
              }
              activeOpacity={0.9}
            >
              <Text style={s.secondaryBtnText}>Scan again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.page}>
        <Header onBack={() => router.back()} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 26 }}
        >
          {/* Product card */}
          <View style={s.card}>
            <Text style={s.cardEyebrow}>FOUND</Text>
            <Text style={s.productTitle}>{product.title}</Text>
            {!!product.brand && <Text style={s.productBrand}>{product.brand}</Text>}

            <View style={s.kpiRow}>
              <KPI label="Calories" value={`${computed?.calories ?? 0} kcal`} />
              <KPI label="Protein" value={`${computed?.protein ?? 0} g`} />
              <KPI label="Carbs" value={`${computed?.carbs ?? 0} g`} />
              <KPI label="Fat" value={`${computed?.fat ?? 0} g`} />
            </View>

            <Text style={s.metaText}>
              Barcode: <Text style={{ color: colors.text }}>{barcode}</Text>
            </Text>
          </View>

          {/* Meal type */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Add to</Text>
            <View style={s.segmentRow}>
              {MEAL_TYPES.map((t) => {
                const active = mealType === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[s.segment, active && s.segmentActive]}
                    onPress={() => setMealType(t)}
                    activeOpacity={0.85}
                  >
                    <Text style={[s.segmentText, active && s.segmentTextActive]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Portion controls */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Portion</Text>

            <View style={s.modeRow}>
              <TouchableOpacity
                style={[s.modeChip, unitMode === "serving" && s.modeChipActive]}
                onPress={() => {
                  setUnitMode("serving");
                  setQty(1);
                }}
                activeOpacity={0.85}
              >
                <Text style={[s.modeChipText, unitMode === "serving" && s.modeChipTextActive]}>
                  Servings
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.modeChip, unitMode === "grams" && s.modeChipActive]}
                onPress={() => {
                  setUnitMode("grams");
                  setQty(100);
                }}
                activeOpacity={0.85}
                disabled={!product.per100g}
              >
                <Text style={[s.modeChipText, unitMode === "grams" && s.modeChipTextActive]}>
                  Grams
                </Text>
              </TouchableOpacity>
            </View>

            {!product.per100g && (
              <Text style={s.subtleSmall}>
                Grams mode unavailable (no per-100g nutrition provided). Using serving values.
              </Text>
            )}

            <View style={s.qtyRow}>
              <TouchableOpacity
                style={s.qtyBtn}
                onPress={() => {
                  setQty((v) => {
                    const next = (Number(v || 0) || 0) - (unitMode === "grams" ? 10 : 0.25);
                    return unitMode === "grams" ? clamp(next, 1, 5000) : clamp(next, 0.25, 50);
                  });
                }}
                activeOpacity={0.85}
              >
                <Feather name="minus" size={18} color={PRIMARY} />
              </TouchableOpacity>

              <View style={s.qtyMid}>
                <Text style={s.qtyNumber}>
                  {unitMode === "grams" ? Math.round(qty) : qty}
                </Text>
                <Text style={s.qtyUnit}>
                  {unitMode === "grams"
                    ? "g"
                    : `serving${Number(qty) === 1 ? "" : "s"}`}
                </Text>
              </View>

              <TouchableOpacity
                style={s.qtyBtn}
                onPress={() => {
                  setQty((v) => {
                    const next = (Number(v || 0) || 0) + (unitMode === "grams" ? 10 : 0.25);
                    return unitMode === "grams" ? clamp(next, 1, 5000) : clamp(next, 0.25, 50);
                  });
                }}
                activeOpacity={0.85}
              >
                <Feather name="plus" size={18} color={PRIMARY} />
              </TouchableOpacity>
            </View>

            {unitMode === "serving" && (
              <Text style={s.subtleSmall}>
                Serving: {product.servingSize} {product.servingUnit}
              </Text>
            )}
          </View>

          {/* Actions */}
          <TouchableOpacity style={s.primaryBtn} onPress={goToAdd} activeOpacity={0.9}>
            <Feather name="check" size={18} color="#111111" />
            <Text style={s.primaryBtnText}>Add to diary</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.secondaryBtn} onPress={goManual} activeOpacity={0.9}>
            <Text style={s.secondaryBtnText}>Edit manually instead</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* ---------------- UI bits ---------------- */

function Header({ onBack }) {
  return (
    <View style={stylesHeader.headerRow}>
      <TouchableOpacity
        onPress={onBack}
        style={stylesHeader.iconButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="chevron-left" size={22} color={PRIMARY} />
      </TouchableOpacity>
      <Text style={stylesHeader.headerTitle}>Scan barcode</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

const stylesHeader = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: "#F9FAFB",
    textTransform: "uppercase",
  },
});

function KPI({ label, value }) {
  return (
    <View style={{ flex: 1, minWidth: "48%" }}>
      <Text style={{ color: "#7C7F87", fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

/* ---------------- styles ---------------- */

function makeStyles(colors, isDark) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#000000",
    },
    page: {
      flex: 1,
      paddingHorizontal: 18,
    },
    center: {
      flex: 1,
      paddingTop: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    subtle: {
      marginTop: 10,
      color: colors.subtext,
      fontSize: 13,
    },

    card: {
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: isDark ? "#111217" : "#0B0B0D",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.10)",
      marginTop: 10,
      marginBottom: 16,
    },
    cardEyebrow: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.subtext,
      letterSpacing: 1,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: "#FFFFFF",
      marginBottom: 6,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    cardText: {
      color: colors.subtext,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 14,
    },

    productTitle: {
      color: "#FFFFFF",
      fontSize: 18,
      fontWeight: "900",
      lineHeight: 22,
    },
    productBrand: {
      color: colors.subtext,
      fontSize: 13,
      marginTop: 4,
      marginBottom: 10,
    },

    kpiRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 10,
    },

    metaText: {
      marginTop: 12,
      color: colors.subtext,
      fontSize: 12,
    },

    section: {
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "800",
      color: "#FFFFFF",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 10,
    },

    segmentRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    segment: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.16)",
      backgroundColor: "rgba(255,255,255,0.04)",
    },
    segmentActive: {
      backgroundColor: PRIMARY,
      borderColor: PRIMARY,
    },
    segmentText: {
      fontSize: 13,
      color: "#FFFFFF",
      fontWeight: "600",
    },
    segmentTextActive: {
      color: "#111111",
      fontWeight: "800",
    },

    modeRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 10,
    },
    modeChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.16)",
      backgroundColor: "rgba(255,255,255,0.04)",
      alignItems: "center",
      justifyContent: "center",
    },
    modeChipActive: {
      borderColor: PRIMARY,
      backgroundColor: "rgba(230,255,59,0.10)",
    },
    modeChipText: {
      color: "#FFFFFF",
      fontWeight: "700",
    },
    modeChipTextActive: {
      color: PRIMARY,
    },

    subtleSmall: {
      marginTop: 2,
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 16,
    },

    qtyRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: 18,
      padding: 12,
      backgroundColor: isDark ? "#111217" : "#0B0B0D",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.10)",
    },
    qtyBtn: {
      width: 44,
      height: 44,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.04)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.12)",
    },
    qtyMid: {
      alignItems: "center",
      justifyContent: "center",
    },
    qtyNumber: {
      color: "#FFFFFF",
      fontWeight: "900",
      fontSize: 22,
      lineHeight: 24,
    },
    qtyUnit: {
      marginTop: 2,
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },

    primaryBtn: {
      marginTop: 8,
      backgroundColor: PRIMARY,
      paddingVertical: 12,
      borderRadius: 999,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    primaryBtnText: {
      color: "#111111",
      fontWeight: "900",
      fontSize: 15,
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },

    secondaryBtn: {
      marginTop: 10,
      paddingVertical: 12,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(230,255,59,0.55)",
      backgroundColor: "rgba(0,0,0,0.15)",
    },
    secondaryBtnText: {
      color: PRIMARY,
      fontWeight: "800",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      fontSize: 13,
    },
  });
}
