import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../../providers/ThemeProvider";

export default function NutritionMicrosPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const s = makeStyles(colors, isDark);

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.8}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Micronutrients</Text>
        <View style={s.iconBtn} />
      </View>

      <View style={s.body}>
        <Text style={s.title}>Micros dashboard is in progress.</Text>
        <Text style={s.sub}>
          Use Food Quality for now to review fibre, sugar, sodium, and meal-level quality.
        </Text>

        <TouchableOpacity
          style={s.cta}
          activeOpacity={0.85}
          onPress={() => router.push("/nutrition/food-quality")}
        >
          <Text style={s.ctaText}>Open Food Quality</Text>
          <Feather name="arrow-right" size={16} color="#111111" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    header: {
      height: 56,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
    },
    iconBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    body: {
      flex: 1,
      paddingHorizontal: 18,
      justifyContent: "center",
      gap: 10,
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
    },
    sub: {
      color: colors.subtext,
      fontSize: 14,
      lineHeight: 20,
    },
    cta: {
      marginTop: 12,
      alignSelf: "flex-start",
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: colors.sapPrimary || "#E6FF3B",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    ctaText: {
      color: "#111111",
      fontWeight: "700",
      fontSize: 14,
    },
  });
}
