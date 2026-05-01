import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useMemo } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppIcon from "../../assets/images/icon.png";
import { useTheme } from "../../providers/ThemeProvider";

export default function LoginLanding() {
  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  return (
    <SafeAreaView edges={["left", "right"]} style={s.safe}>
      <LinearGradient
        colors={isDark ? ["#030303", "#0A0B0F", "#16181D"] : ["#0A0A0A", "#17191F", "#2A2D35"]}
        start={{ x: 0.08, y: 0.04 }}
        end={{ x: 0.92, y: 1 }}
        style={s.page}
      >
        <View style={s.stack}>
          <View style={s.brandWrap}>
            <Image source={AppIcon} style={s.brandIcon} resizeMode="contain" />
          </View>

          <View style={s.wordmarkWrap}>
            <Text style={s.wordmarkGhost}>VERSION</Text>
            <Text style={s.wordmarkSolid}>VERSION</Text>
          </View>

          <View style={s.captionWrap}>
            <Text style={s.caption}>Training, nutrition, and coaching in one place.</Text>
          </View>

          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity style={s.primaryBtn} activeOpacity={0.9}>
              <Text style={s.primaryBtnText}>Sign in</Text>
            </TouchableOpacity>
          </Link>

          <View style={s.footerRow}>
            <Text style={s.footerPrompt}>Don&apos;t have an account?</Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity activeOpacity={0.85}>
                <Text style={s.footerLink}>Sign up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark) {
  const accent = colors?.accentBg || colors?.sapPrimary || "#E6FF3B";
  const muted = isDark ? "rgba(210,214,220,0.42)" : "rgba(229,231,235,0.32)";
  const prompt = isDark ? "rgba(214,218,224,0.72)" : "rgba(235,237,240,0.72)";
  const buttonText = colors?.sapOnPrimary || "#111111";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: "#050506",
    },
    page: {
      flex: 1,
    },
    stack: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 18,
      paddingBottom: 108,
    },
    brandWrap: {
      marginBottom: 22,
      alignSelf: "center",
      alignItems: "center",
    },
    brandIcon: {
      width: 204,
      height: 204,
    },
    wordmarkWrap: {
      marginBottom: 18,
      alignSelf: "center",
      width: "100%",
      maxWidth: 360,
    },
    wordmarkGhost: {
      color: muted,
      fontSize: 62,
      lineHeight: 58,
      fontWeight: "200",
      letterSpacing: -3.2,
      textAlign: "left",
    },
    wordmarkSolid: {
      marginTop: -12,
      color: accent,
      fontSize: 56,
      lineHeight: 54,
      fontWeight: "900",
      letterSpacing: -3.2,
      textAlign: "left",
    },
    captionWrap: {
      width: "100%",
      maxWidth: 360,
      alignSelf: "center",
      marginBottom: 28,
    },
    caption: {
      color: prompt,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    primaryBtn: {
      height: 44,
      borderRadius: 4,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      maxWidth: 360,
      alignSelf: "center",
      shadowColor: accent,
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    primaryBtnText: {
      color: buttonText,
      fontSize: 14,
      fontWeight: "900",
    },
    footerRow: {
      marginTop: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      flexWrap: "wrap",
    },
    footerPrompt: {
      color: prompt,
      fontSize: 12,
      fontWeight: "500",
    },
    footerLink: {
      color: accent,
      fontSize: 12,
      fontWeight: "700",
      textDecorationLine: "underline",
    },
  });
}
