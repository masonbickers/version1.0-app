// app/(protected)/fonts.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useTheme } from "../../providers/ThemeProvider";

/**
 * Fonts Test Page — SAP GEL style
 * ✅ Selectable font families (Body / Headings / Metrics)
 * ✅ Theme toggle (Light/Dark/System)
 * ✅ Shows readability on different backgrounds
 *
 * Note:
 * React Native will silently fall back if a font family isn't loaded/installed.
 * If you want these to work for sure, load fonts via expo-font and ensure the
 * fontFamily names here match the loaded names.
 */

export default function FontsTestPage() {
  const router = useRouter();
  const { theme, setTheme, colors, isDark } = useTheme();

  const accentFill =
    colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";

  // ✅ rule: no neon text
  const accentInk = isDark
    ? colors.text || "#E5E7EB"
    : colors.accentText || "#3F4F00";

  const subtextStrong = useMemo(() => {
    if (colors.subtextStrong) return colors.subtextStrong;
    return isDark ? colors.subtext || "#B7B7B7" : "#4B5563";
  }, [colors, isDark]);

  const defaultSystemFont = useMemo(() => {
    // iOS: "System" works well
    // Android: "sans-serif" is the closest equivalent
    return Platform.select({ ios: "System", android: "sans-serif", default: "System" });
  }, []);

  const FONT_PRESETS = useMemo(() => {
    // These names must match your loaded fontFamily names if using expo-font.
    // Keep a few variations people often use.
    return [
      { label: "System", value: defaultSystemFont, note: "Best native UI feel" },

      // Common UI fonts (only work if loaded)
      { label: "Inter", value: "Inter", note: "Modern UI default" },
      { label: "Manrope", value: "Manrope", note: "Soft + premium" },
      { label: "Plus Jakarta Sans", value: "PlusJakartaSans", note: "Sleek + modern" },
      { label: "Space Grotesk", value: "SpaceGrotesk", note: "Technical / performance" },
      { label: "IBM Plex Sans", value: "IBMPlexSans", note: "Systems feel" },

      // “Brand” classics (may exist on some devices, often needs loading)
      { label: "Helvetica Now", value: "HelveticaNowText", note: "Premium classic" },
      { label: "Neue Haas", value: "NeueHaasGroteskText", note: "Editorial brand" },
      { label: "Söhne", value: "Sohne", note: "High-end editorial" },

      // Metrics-friendly (often needs loading)
      { label: "DIN", value: "DIN", note: "Sport/engineering metrics" },
      { label: "JetBrains Mono", value: "JetBrainsMono", note: "Mono stats only" },
    ];
  }, [defaultSystemFont]);

  // Selections
  const [bodyFont, setBodyFont] = useState(defaultSystemFont);
  const [headingFont, setHeadingFont] = useState(defaultSystemFont);
  const [metricFont, setMetricFont] = useState(defaultSystemFont);

  // Optional: manual override inputs (useful when your loaded font name differs)
  const [bodyCustom, setBodyCustom] = useState("");
  const [headingCustom, setHeadingCustom] = useState("");
  const [metricCustom, setMetricCustom] = useState("");

  const resolvedBodyFont = bodyCustom.trim() || bodyFont;
  const resolvedHeadingFont = headingCustom.trim() || headingFont;
  const resolvedMetricFont = metricCustom.trim() || metricFont;

  // Optional toggles
  const [tabularNums, setTabularNums] = useState(true);

  const [sample, setSample] = useState(
    "The quick brown fox jumps over the lazy dog. 0123456789"
  );

  const s = useMemo(
    () => makeStyles(colors, isDark, accentFill),
    [colors, isDark, accentFill]
  );

  const dividerColour = colors.border || colors.borderStrong || "#D5D8DE";

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.page}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.85}
            style={s.iconBtn}
          >
            <Feather name="chevron-left" size={18} color={colors.text} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={s.title}>Fonts</Text>
            <Text style={s.subtext}>
              Select fonts and preview styles • theme:{" "}
              <Text style={{ fontWeight: "900", color: colors.text }}>
                {theme}
              </Text>
            </Text>
          </View>

          <View style={s.badgePill}>
            <Text style={s.badgeText}>Train-R</Text>
          </View>
        </View>

        {/* Theme toggles */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Theme</Text>
          <View style={s.row}>
            <ThemePill
              label="Light"
              active={theme === "light"}
              onPress={() => setTheme("light")}
              s={s}
            />
            <ThemePill
              label="Dark"
              active={theme === "dark"}
              onPress={() => setTheme("dark")}
              s={s}
            />
            <ThemePill
              label="System"
              active={theme === "system"}
              onPress={() => setTheme("system")}
              s={s}
            />
          </View>

          <View style={s.rowBetween}>
            <Text style={s.cardHint}>
              Switch themes to spot readability issues quickly.
            </Text>

            <TouchableOpacity
              onPress={() => setTabularNums((v) => !v)}
              activeOpacity={0.85}
              style={s.smallToggle}
            >
              <Feather
                name={tabularNums ? "check-square" : "square"}
                size={16}
                color={colors.text}
              />
              <Text style={s.smallToggleText}>Tabular nums</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Font selectors */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Font selectors</Text>
          <Text style={s.cardHint}>
            Tap a preset to select. If you’ve loaded fonts with expo-font, the
            fontFamily must match your loaded name. Otherwise it will fall back.
          </Text>

          <View style={{ marginTop: 12, gap: 14 }}>
            <FontPicker
              title="Body"
              selected={bodyFont}
              custom={bodyCustom}
              onSelect={setBodyFont}
              onCustom={setBodyCustom}
              presets={FONT_PRESETS}
              colors={colors}
              isDark={isDark}
              accentFill={accentFill}
            />

            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: dividerColour, opacity: 0.9 }} />

            <FontPicker
              title="Headings"
              selected={headingFont}
              custom={headingCustom}
              onSelect={setHeadingFont}
              onCustom={setHeadingCustom}
              presets={FONT_PRESETS}
              colors={colors}
              isDark={isDark}
              accentFill={accentFill}
            />

            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: dividerColour, opacity: 0.9 }} />

            <FontPicker
              title="Metrics"
              selected={metricFont}
              custom={metricCustom}
              onSelect={setMetricFont}
              onCustom={setMetricCustom}
              presets={FONT_PRESETS}
              colors={colors}
              isDark={isDark}
              accentFill={accentFill}
            />
          </View>

          <View style={{ marginTop: 14 }}>
            <Text style={s.tokenLine}>
              Body font:{" "}
              <Text style={{ fontWeight: "900", color: colors.text }}>
                {resolvedBodyFont}
              </Text>
            </Text>
            <Text style={s.tokenLine}>
              Heading font:{" "}
              <Text style={{ fontWeight: "900", color: colors.text }}>
                {resolvedHeadingFont}
              </Text>
            </Text>
            <Text style={s.tokenLine}>
              Metric font:{" "}
              <Text style={{ fontWeight: "900", color: colors.text }}>
                {resolvedMetricFont}
              </Text>
            </Text>
          </View>
        </View>

        {/* Sample input */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Sample text</Text>
          <TextInput
            value={sample}
            onChangeText={setSample}
            placeholder="Type your sample…"
            placeholderTextColor={colors.subtext}
            style={[
              s.input,
              {
                fontFamily: resolvedBodyFont,
              },
            ]}
            multiline
          />
          <Text style={s.cardHint}>
            Use this to test readability at small sizes and on different
            surfaces.
          </Text>
        </View>

        {/* Type scale on Surface */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Type scale (Surface)</Text>
          <Text style={s.cardHint}>
            These are your “app-like” styles using your selected fonts.
          </Text>

          <View style={{ marginTop: 12, gap: 14 }}>
            <TypeRow label="Display · 34 / 900" textStyle={mergeFont(s.display, resolvedHeadingFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow label="H1 · 28 / 900" textStyle={mergeFont(s.h1, resolvedHeadingFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow label="H2 · 22 / 900" textStyle={mergeFont(s.h2, resolvedHeadingFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow label="Title · 18 / 900" textStyle={mergeFont(s.title18, resolvedHeadingFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow label="Body · 14 / 400" textStyle={mergeFont(s.body, resolvedBodyFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow label="Body Strong · 14 / 800" textStyle={mergeFont(s.bodyStrong, resolvedBodyFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow label="Caption · 12 / 600" textStyle={mergeFont(s.caption, resolvedBodyFont, tabularNums)}>
              {sample}
            </TypeRow>

            <TypeRow
              label="Caption Strong · 12 / 800 (recommended)"
              textStyle={mergeFont(s.captionStrong, resolvedBodyFont, tabularNums)}
            >
              {sample}
            </TypeRow>
          </View>

          <View style={s.divider} />

          <Text style={s.cardLabel}>Token checks</Text>
          <Text style={s.tokenLine}>
            Text token: <Text style={{ fontWeight: "900" }}>{colors.text}</Text>
          </Text>
          <Text style={s.tokenLine}>
            Subtext token:{" "}
            <Text style={{ fontWeight: "900" }}>{colors.subtext}</Text>
          </Text>
          <Text style={s.tokenLine}>
            Subtext strong:{" "}
            <Text style={{ fontWeight: "900" }}>{subtextStrong}</Text>
          </Text>
          <Text style={s.tokenLine}>
            Accent ink (no neon):{" "}
            <Text style={{ fontWeight: "900", color: accentInk }}>
              {accentInk}
            </Text>
          </Text>
        </View>

        {/* Readability on different backgrounds */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Readability on backgrounds</Text>
          <Text style={s.cardHint}>
            Checks typography on bg / surfaceAlt / section and shows accent fill
            using “on accent” text.
          </Text>

          <View style={{ marginTop: 12, gap: 12 }}>
            <BackgroundTypeTile
              label="Text on Background"
              bg={colors.bg}
              text={colors.text}
              sub={colors.subtext}
              subStrong={subtextStrong}
              accentInk={accentInk}
              sample={sample}
              colors={colors}
              isDark={isDark}
              bodyFont={resolvedBodyFont}
              headingFont={resolvedHeadingFont}
              metricFont={resolvedMetricFont}
              tabularNums={tabularNums}
            />

            <BackgroundTypeTile
              label="Text on Surface Alt"
              bg={colors.surfaceAlt || colors.sapSilverLight || "#F3F4F6"}
              text={colors.text}
              sub={colors.subtext}
              subStrong={subtextStrong}
              accentInk={accentInk}
              sample={sample}
              colors={colors}
              isDark={isDark}
              bodyFont={resolvedBodyFont}
              headingFont={resolvedHeadingFont}
              metricFont={resolvedMetricFont}
              tabularNums={tabularNums}
            />

            <BackgroundTypeTile
              label="Text on Section"
              bg={colors.section || colors.muted || "#EEF0F3"}
              text={colors.text}
              sub={colors.subtext}
              subStrong={subtextStrong}
              accentInk={accentInk}
              sample={sample}
              colors={colors}
              isDark={isDark}
              bodyFont={resolvedBodyFont}
              headingFont={resolvedHeadingFont}
              metricFont={resolvedMetricFont}
              tabularNums={tabularNums}
            />

            {/* Accent fill */}
            <BackgroundTypeTile
              label="On Accent (buttons/badges)"
              bg={accentFill}
              text={colors.sapOnPrimary || "#111111"}
              sub={colors.sapOnPrimary || "#111111"}
              subStrong={colors.sapOnPrimary || "#111111"}
              accentInk={colors.sapOnPrimary || "#111111"}
              sample={"On Accent uses sapOnPrimary — never neon text."}
              colors={colors}
              isDark={isDark}
              isAccent
              bodyFont={resolvedBodyFont}
              headingFont={resolvedHeadingFont}
              metricFont={resolvedMetricFont}
              tabularNums={tabularNums}
            />
          </View>
        </View>

        {/* Numerals + UI labels */}
        <View style={[s.card, { marginBottom: 28 }]}>
          <Text style={s.cardLabel}>Numerals & UI labels</Text>
          <Text style={s.cardHint}>
            Useful for metrics cards, pace, distance, and small uppercase labels.
            Metrics use your selected “Metrics” font.
          </Text>

          <View style={{ marginTop: 12, gap: 12 }}>
            <View style={s.miniCard}>
              <Text style={mergeFont(s.kicker, resolvedBodyFont, tabularNums)}>
                KICKER / LABEL
              </Text>

              <Text style={mergeFont(s.metric, resolvedMetricFont, tabularNums)}>
                3:45/km
              </Text>

              <Text style={mergeFont(s.bodyStrong, resolvedBodyFont, tabularNums)}>
                Weekly distance
              </Text>

              <Text style={mergeFont(s.captionStrong, resolvedBodyFont, tabularNums)}>
                30.4 km
              </Text>
            </View>

            <View style={s.miniCard}>
              <Text style={mergeFont(s.kicker, resolvedBodyFont, tabularNums)}>
                KICKER / LABEL
              </Text>

              <Text style={mergeFont(s.metric, resolvedMetricFont, tabularNums)}>
                18:21
              </Text>

              <Text style={mergeFont(s.bodyStrong, resolvedBodyFont, tabularNums)}>
                5K PB
              </Text>

              <Text
                style={mergeFont(
                  [s.caption, { color: colors.subtext }],
                  resolvedBodyFont,
                  tabularNums
                )}
              >
                Check if digits look crisp
              </Text>
            </View>

            <View style={s.miniCard}>
              <Text style={mergeFont(s.kicker, resolvedBodyFont, tabularNums)}>
                KICKER / LABEL
              </Text>

              <Text style={mergeFont(s.metric, resolvedMetricFont, tabularNums)}>
                110kg
              </Text>

              <Text style={mergeFont(s.bodyStrong, resolvedBodyFont, tabularNums)}>
                Bench
              </Text>

              <Text
                style={mergeFont(
                  [s.caption, { color: subtextStrong }],
                  resolvedBodyFont,
                  tabularNums
                )}
              >
                Subtext Strong recommended on light greys
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Components
───────────────────────────────────────────── */

function ThemePill({ label, active, onPress, s }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[s.pill, active && s.pillActive]}
    >
      <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function FontPicker({
  title,
  selected,
  custom,
  onSelect,
  onCustom,
  presets,
  colors,
  isDark,
  accentFill,
}) {
  const border = colors.borderStrong || colors.sapSilverMedium || colors.border;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 12, fontWeight: "900", color: colors.text }}>
          {title}
        </Text>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: isDark ? "#00000022" : colors.card,
            borderWidth: 1,
            borderColor: border,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "900", color: colors.text }}>
            {custom.trim() ? "Custom" : "Preset"}
          </Text>
        </View>
      </View>

      {/* Presets */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {presets.map((f) => {
          const active = !custom.trim() && selected === f.value;
          return (
            <TouchableOpacity
              key={`${title}-${f.value}`}
              onPress={() => {
                onCustom("");
                onSelect(f.value);
              }}
              activeOpacity={0.9}
              style={{
                borderRadius: 999,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: active
                  ? (isDark ? "#00000055" : "#FFFFFF")
                  : (colors.surfaceAlt || colors.bg),
                borderWidth: 1,
                borderColor: active ? (colors.accentBorder || accentFill) : border,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "900",
                  color: active ? colors.text : colors.subtext,
                }}
              >
                {f.label}
              </Text>
              {f.note ? (
                <Text
                  style={{
                    marginTop: 2,
                    fontSize: 10,
                    fontWeight: "800",
                    color: colors.subtext,
                    opacity: 0.85,
                  }}
                >
                  {f.note}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Custom override */}
      <View style={{ marginTop: 6 }}>
        <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>
          Custom fontFamily (optional)
        </Text>
        <TextInput
          value={custom}
          onChangeText={onCustom}
          placeholder='e.g. "SpaceGrotesk" or your loaded name'
          placeholderTextColor={colors.subtext}
          style={{
            marginTop: 8,
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: border,
            color: colors.text,
            fontSize: 13,
          }}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Quick preview line */}
      <View
        style={{
          marginTop: 8,
          borderRadius: 14,
          padding: 12,
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: border,
        }}
      >
        <Text style={{ fontSize: 10, fontWeight: "900", color: colors.subtext, letterSpacing: 0.7, textTransform: "uppercase" }}>
          Preview
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontSize: 16,
            fontWeight: "900",
            color: colors.text,
            fontFamily: custom.trim() || selected,
          }}
        >
          The quick brown fox — 0123456789
        </Text>
        <Text
          style={{
            marginTop: 6,
            fontSize: 12,
            color: colors.subtext,
            fontFamily: custom.trim() || selected,
          }}
        >
          If this looks identical across presets, the font may be falling back.
        </Text>
      </View>
    </View>
  );
}

function TypeRow({ label, textStyle, children }) {
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          fontSize: 10,
          fontWeight: "900",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          opacity: 0.75,
        }}
      >
        {label}
      </Text>
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

function BackgroundTypeTile({
  label,
  bg,
  text,
  sub,
  subStrong,
  accentInk,
  sample,
  colors,
  isDark,
  isAccent,
  bodyFont,
  headingFont,
  metricFont,
  tabularNums,
}) {
  const border = colors.borderStrong || colors.sapSilverMedium || colors.border;
  const chipBg = isDark
    ? "#00000033"
    : colors.surfaceAlt || colors.sapSilverLight || "#F3F4F6";

  return (
    <View
      style={{
        borderRadius: 18,
        overflow: "hidden",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: border,
      }}
    >
      <View style={{ backgroundColor: bg, padding: 14 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "900",
              color: text,
              fontFamily: headingFont,
            }}
            numberOfLines={1}
          >
            {label}
          </Text>

          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: isAccent ? "#00000022" : chipBg,
              borderWidth: 1,
              borderColor: isDark ? "#00000022" : border,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "900",
                color: text,
                fontFamily: bodyFont,
              }}
            >
              {isAccent ? "Accent" : "Neutral"}
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 10, gap: 8 }}>
          <Text style={mergeFont({ fontSize: 18, fontWeight: "900", color: text }, headingFont, tabularNums)}>
            {sample}
          </Text>

          <Text style={mergeFont({ fontSize: 13, lineHeight: 18, color: sub }, bodyFont, tabularNums)}>
            Subtext: {sample}
          </Text>

          <Text style={mergeFont({ fontSize: 12, fontWeight: "800", color: subStrong }, bodyFont, tabularNums)}>
            Subtext Strong: {sample}
          </Text>

          {!isAccent ? (
            <Text style={mergeFont({ fontSize: 13, fontWeight: "900", color: accentInk }, bodyFont, tabularNums)}>
              Accent Ink (no neon): {sample}
            </Text>
          ) : null}

          <Text style={mergeFont({ fontSize: 12, fontWeight: "900", color: text, opacity: 0.95 }, metricFont, tabularNums)}>
            Metrics font preview: 3:45/km · 18:21 · 110kg
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Helper: attach font + optional tabular numerals
───────────────────────────────────────────── */

function mergeFont(style, fontFamily, tabularNums) {
  const base = Array.isArray(style) ? style : [style];
  const extra = {
    fontFamily,
    ...(tabularNums ? { fontVariant: ["tabular-nums"] } : null),
  };
  return [...base, extra];
}

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */

function makeStyles(colors, isDark, accentFill) {
  const cardBg = colors.sapSilverLight || colors.card;
  const border = colors.borderStrong || colors.sapSilverMedium || colors.border;

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 36 },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    badgePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: accentFill,
      borderWidth: 1,
      borderColor: colors.accentBorder || accentFill,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.sapOnPrimary || "#111111",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },

    title: { fontSize: 26, fontWeight: "900", color: colors.text },
    subtext: { fontSize: 13, color: colors.subtext, lineHeight: 18 },

    card: {
      backgroundColor: cardBg,
      borderRadius: 18,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 14,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: isDark ? 0.2 : 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: isDark ? 0 : 2 },
      }),
    },
    cardLabel: {
      fontSize: 12,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    cardHint: {
      marginTop: 6,
      fontSize: 12,
      color: colors.subtext,
      lineHeight: 16,
    },

    row: { flexDirection: "row", gap: 10, marginTop: 10 },

    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginTop: 10,
    },

    smallToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: border,
    },
    smallToggleText: {
      fontSize: 12,
      fontWeight: "900",
      color: colors.text,
    },

    pill: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceAlt || colors.bg,
      borderWidth: 1,
      borderColor: border,
    },
    pillActive: {
      borderColor: accentFill,
      backgroundColor: isDark ? "#00000055" : "#FFFFFF",
    },
    pillText: { fontSize: 13, fontWeight: "900", color: colors.subtext },
    pillTextActive: { color: colors.text },

    input: {
      marginTop: 10,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: border,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      minHeight: 82,
    },

    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 14,
      opacity: 0.9,
    },

    tokenLine: {
      marginTop: 6,
      fontSize: 12,
      color: colors.subtext,
      lineHeight: 16,
    },

    // Type scale (fontFamily is injected via mergeFont)
    display: {
      fontSize: 34,
      fontWeight: "900",
      color: colors.text,
      lineHeight: 40,
    },
    h1: { fontSize: 28, fontWeight: "900", color: colors.text, lineHeight: 34 },
    h2: { fontSize: 22, fontWeight: "900", color: colors.text, lineHeight: 28 },
    title18: {
      fontSize: 18,
      fontWeight: "900",
      color: colors.text,
      lineHeight: 24,
    },
    body: { fontSize: 14, fontWeight: "400", color: colors.text, lineHeight: 20 },
    bodyStrong: {
      fontSize: 14,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 20,
    },
    caption: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.subtext,
      lineHeight: 16,
    },
    captionStrong: {
      fontSize: 12,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 16,
    },

    // Numerals / UI
    miniCard: {
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: border,
      padding: 14,
    },
    kicker: {
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: colors.subtext,
      marginBottom: 10,
    },
    metric: {
      fontSize: 30,
      fontWeight: "900",
      color: colors.text,
      lineHeight: 36,
      marginBottom: 8,
    },
  });
}
