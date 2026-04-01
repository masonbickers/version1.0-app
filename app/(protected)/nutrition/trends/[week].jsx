import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../../../providers/ThemeProvider";

export default function NutritionWeekDetailPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const week = String(params.week || "").trim();

  return (
    <SafeAreaView edges={["top"]} style={[s.safe, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.icon} activeOpacity={0.8}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.text }]}>Trend Detail</Text>
        <View style={s.icon} />
      </View>

      <View style={s.body}>
        <Text style={[s.bodyTitle, { color: colors.text }]}>
          Week view for {week || "selected period"}
        </Text>
        <Text style={[s.bodySub, { color: colors.subtext }]}>
          Detailed trend drill-down is not implemented yet.
        </Text>

        <TouchableOpacity
          style={s.cta}
          activeOpacity={0.85}
          onPress={() => router.replace("/nutrition/week")}
        >
          <Text style={s.ctaText}>Open weekly trends</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
  },
  body: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "center",
    gap: 10,
  },
  bodyTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  bodySub: {
    fontSize: 14,
    lineHeight: 20,
  },
  cta: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#E6FF3B",
  },
  ctaText: {
    color: "#111111",
    fontWeight: "700",
    fontSize: 14,
  },
});
