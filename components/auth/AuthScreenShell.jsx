import { LinearGradient } from "expo-linear-gradient";
import { useMemo } from "react";
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../providers/ThemeProvider";

export default function AuthScreenShell({
  heroSource,
  brandSource,
  kicker,
  title,
  subtitle,
  ghostTitle,
  badge,
  disableScroll = false,
  centered = false,
  backgroundColors,
  backgroundStart,
  backgroundEnd,
  children,
}) {
  const { colors, isDark } = useTheme();
  const s = useMemo(() => createAuthStyles(colors, isDark), [colors, isDark]);

  const content = (
      <View style={[s.content, centered && s.contentCentered, disableScroll && s.contentStatic]}>
      <View style={s.stack}>
        <View style={s.heroBlock}>
          {!!ghostTitle && <Text style={s.ghostTitle}>{ghostTitle}</Text>}

          {!!brandSource && (
            <View style={s.brandWrap}>
              <Image source={brandSource} style={s.brandIcon} resizeMode="contain" />
            </View>
          )}

          <View style={s.heroTopRow}>
            {!!kicker && <Text style={s.kicker}>{kicker}</Text>}
            {!!badge && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{badge}</Text>
              </View>
            )}
          </View>

          <Text style={s.title}>{title}</Text>
          {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        </View>

        {children}
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={["left", "right"]} style={s.safe}>
      {backgroundColors ? (
        <LinearGradient
          colors={backgroundColors}
          start={backgroundStart || { x: 0.08, y: 0.04 }}
          end={backgroundEnd || { x: 0.92, y: 1 }}
          style={s.page}
        >
          <KeyboardAvoidingView
            style={s.flex}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            {disableScroll ? (
              content
            ) : (
              <ScrollView
                contentContainerStyle={s.scrollOnlyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {content}
              </ScrollView>
            )}
          </KeyboardAvoidingView>
        </LinearGradient>
      ) : (
        <ImageBackground
          source={heroSource}
          style={s.page}
          imageStyle={s.backgroundImage}
          resizeMode="cover"
        >
          <LinearGradient
            colors={["rgba(5,5,6,0.02)", "rgba(8,9,12,0.14)", "rgba(5,5,6,0.34)"]}
            locations={[0, 0.42, 1]}
            style={s.overlay}
          >
            <View style={s.ambientGlowTop} />
            <View style={s.ambientGlowBottom} />

            <KeyboardAvoidingView
              style={s.flex}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              {disableScroll ? (
                content
              ) : (
                <ScrollView
                  contentContainerStyle={s.scrollOnlyContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {content}
                </ScrollView>
              )}
            </KeyboardAvoidingView>
          </LinearGradient>
        </ImageBackground>
      )}
    </SafeAreaView>
  );
}

export function createAuthStyles(colors, isDark) {
  const inputText = "#0F141A";
  const inputBorder = "rgba(15,20,26,0.14)";
  const inputBg = isDark
    ? "rgba(242,244,247,0.96)"
    : "rgba(250,250,250,0.96)";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: "#050506",
    },
    page: {
      flex: 1,
      backgroundColor: "#050506",
    },
    backgroundImage: {
      opacity: 0.98,
    },
    overlay: {
      flex: 1,
    },
    ambientGlowTop: { display: "none" },
    ambientGlowBottom: { display: "none" },
    flex: {
      flex: 1,
    },
    scrollOnlyContent: {
      flexGrow: 1,
    },
    content: {
      flexGrow: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 10,
    },
    contentCentered: {
      justifyContent: "center",
    },
    contentStatic: {
      flex: 1,
    },
    stack: {
      width: "100%",
      maxWidth: 420,
      alignSelf: "center",
    },
    heroBlock: {
      position: "relative",
      paddingTop: 0,
      paddingBottom: 14,
      marginBottom: 8,
      minHeight: 150,
      justifyContent: "flex-end",
    },
    brandWrap: {
      alignSelf: "center",
      alignItems: "center",
      marginBottom: 16,
    },
    brandIcon: {
      width: 156,
      height: 156,
    },
    ghostTitle: {
      position: "absolute",
      left: 0,
      bottom: 10,
      color: "rgba(255,255,255,0.12)",
      fontSize: 72,
      lineHeight: 72,
      fontWeight: "900",
      letterSpacing: -3.6,
    },
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 0,
    },
    kicker: {
      color: "rgba(255,255,255,0.85)",
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1.8,
      textTransform: "uppercase",
    },
    badge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(17,17,17,0.72)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.22)",
    },
    badgeText: {
      color: "#FFFFFF",
      fontSize: 9.5,
      fontWeight: "900",
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    title: {
      color: "#FFFFFF",
      fontSize: 32,
      lineHeight: 32,
      fontWeight: "900",
      letterSpacing: -1.1,
      maxWidth: "100%",
      alignSelf: "center",
      textAlign: "center",
    },
    subtitle: {
      marginTop: 7,
      color: "rgba(255,255,255,0.84)",
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "600",
      maxWidth: "88%",
    },
    formCard: {
      backgroundColor: "transparent",
      borderWidth: 0,
      padding: 0,
      shadowOpacity: 0,
      elevation: 0,
    },
    helperStrip: {
      marginBottom: 8,
    },
    helperStripText: {
      color: "#FFFFFF",
      fontSize: 11.5,
      lineHeight: 16,
      fontWeight: "700",
    },
    errorBox: {
      backgroundColor: "rgba(127,29,29,0.72)",
      borderColor: "rgba(248,113,113,0.58)",
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 11,
      paddingVertical: 9,
      marginBottom: 10,
    },
    errorText: {
      color: "#FEE2E2",
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
    },
    sectionEyebrow: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.5,
      marginBottom: 6,
      textTransform: "uppercase",
    },
    sectionTitle: {
      color: "#FFFFFF",
      fontSize: 24,
      lineHeight: 26,
      fontWeight: "900",
      letterSpacing: -0.8,
      marginBottom: 6,
    },
    sectionSubtitle: {
      color: "rgba(255,255,255,0.78)",
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
      marginBottom: 10,
    },
    fieldGroup: {
      marginBottom: 8,
    },
    fieldLabel: {
      color: "rgba(255,255,255,0.74)",
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.1,
      marginBottom: 6,
      textTransform: "uppercase",
    },
    inputShell: {
      minHeight: 50,
      borderRadius: 6,
      paddingHorizontal: 13,
      paddingVertical: 12,
      justifyContent: "center",
      backgroundColor: inputBg,
      borderWidth: 1,
      borderColor: inputBorder,
    },
    inputShellError: {
      borderColor: "#F87171",
    },
    input: {
      padding: 0,
      color: inputText,
      fontSize: 14.5,
      fontWeight: "700",
    },
    fieldError: {
      color: "#FECACA",
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      marginTop: 4,
    },
    primaryBtn: {
      minHeight: 50,
      borderRadius: 4,
      marginTop: 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(10,10,12,0.94)",
      borderWidth: 0,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    primaryBtnDisabled: {
      opacity: 0.72,
    },
    primaryBtnText: {
      color: "#FFFFFF",
      fontSize: 14.5,
      fontWeight: "900",
      letterSpacing: 0.2,
    },
    dividerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
      marginBottom: 6,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: "rgba(255,255,255,0.16)",
    },
    dividerText: {
      marginHorizontal: 10,
      color: "rgba(255,255,255,0.62)",
      fontSize: 9.5,
      fontWeight: "800",
      letterSpacing: 1.1,
      textTransform: "uppercase",
    },
    appleWrap: {
      marginBottom: 2,
    },
    appleButton: {
      width: "100%",
      height: 42,
    },
    footerRow: {
      marginTop: 10,
      alignItems: "center",
      gap: 5,
    },
    footerBtn: {
      paddingHorizontal: 0,
      paddingVertical: 2,
      backgroundColor: "transparent",
      borderWidth: 0,
      minHeight: 0,
      borderRadius: 0,
    },
    footerBtnText: {
      color: "rgba(255,255,255,0.92)",
      fontSize: 12,
      fontWeight: "600",
      textDecorationLine: "underline",
    },
    footerMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      flexWrap: "wrap",
      justifyContent: "center",
    },
    footerPrompt: {
      color: "rgba(255,255,255,0.76)",
      fontSize: 12,
      fontWeight: "600",
    },
    footerLink: {
      color: "rgba(255,255,255,0.92)",
      fontSize: 12,
      fontWeight: "600",
      textDecorationLine: "underline",
    },
  });
}
