// app/(protected)/colours.jsx
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { useTheme } from "../../providers/ThemeProvider";

export default function ColoursTestPage() {
  const router = useRouter();
  const { theme, setTheme, colors, isDark } = useTheme();

  const accentFill =
    colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";

  // ✅ no neon text: use accentInk for links/icons on light surfaces
  const accentInk = isDark
    ? colors.text || "#E5E7EB"
    : colors.accentText || "#3F4F00";

  const s = useMemo(
    () => makeStyles(colors, isDark, accentFill),
    [colors, isDark, accentFill]
  );

  const [showHex, setShowHex] = useState(true);

  const swatches = useMemo(() => {
    const get = (k, fallback) => (colors?.[k] ? colors[k] : fallback);

    return [
      // Core surfaces
      { key: "bg", label: "Background", value: get("bg", "#F5F5F7"), role: "bg" },
      { key: "surface", label: "Surface", value: get("card", "#FFFFFF"), role: "surface" },
      {
        key: "surfaceAlt",
        label: "Surface Alt",
        value: get("surfaceAlt", get("sapSilverLight", "#F3F4F6")),
        role: "surfaceAlt",
      },
      {
        key: "section",
        label: "Section",
        value: get("section", get("muted", "#EEF0F3")),
        role: "section",
      },

      // Borders
      { key: "border", label: "Border", value: get("border", "#D5D8DE"), role: "border" },
      {
        key: "borderStrong",
        label: "Border Strong",
        value: get("borderStrong", get("sapSilverMedium", "#C7CBD4")),
        role: "borderStrong",
      },

      // Text
      { key: "text", label: "Text", value: get("text", "#111827"), role: "text" },
      { key: "subtext", label: "Subtext", value: get("subtext", "#6B7280"), role: "subtext" },
      {
        key: "subtextSoft",
        label: "Subtext Soft",
        value: get("subtextSoft", "#8A909A"),
        role: "subtextSoft",
      },

      // Accent roles
      { key: "accentBg", label: "Accent Fill", value: accentFill, role: "accentBg" },
      { key: "accentText", label: "Accent Ink", value: accentInk, role: "accentText" },
      {
        key: "accentBorder",
        label: "Accent Border",
        value: get("accentBorder", accentFill),
        role: "accentBorder",
      },
      {
        key: "sapOnPrimary",
        label: "On Accent (Text)",
        value: get("sapOnPrimary", "#111111"),
        role: "onAccent",
      },

      // Status
      { key: "success", label: "Success", value: get("success", "#22C55E"), role: "success" },
      { key: "warning", label: "Warning", value: get("warning", "#F59E0B"), role: "warning" },
      { key: "danger", label: "Danger", value: get("danger", "#EF4444"), role: "danger" },

      // SAP GEL legacy (if present)
      { key: "sapPrimary", label: "SAP Primary", value: get("sapPrimary", accentFill), role: "sapPrimary" },
      { key: "sapSilverLight", label: "SAP Silver Light", value: get("sapSilverLight", "#F3F4F6"), role: "sapSilverLight" },
      { key: "sapSilverMedium", label: "SAP Silver Medium", value: get("sapSilverMedium", "#E1E3E8"), role: "sapSilverMedium" },
    ];
  }, [colors, accentFill, accentInk]);

  const textSamples = useMemo(() => {
    return [
      { label: "Title", style: s.title },
      { label: "Section Title", style: s.sectionTitle },
      { label: "Body", style: s.body },
      { label: "Subtext", style: s.subtext },
      {
        label: "Link / Accent Ink",
        style: [s.body, { color: accentInk, fontWeight: "900" }],
      },
      {
        label: "Danger",
        style: [s.body, { color: colors.danger || "#EF4444", fontWeight: "900" }],
      },
    ];
  }, [s, accentInk, colors]);

  // Backgrounds to test “text-over-background” + “border-on-background”
  const backgroundRoles = useMemo(() => {
    const pick = (key, fallback) => colors?.[key] ?? fallback;

    const surfaceAlt = colors.surfaceAlt ?? colors.sapSilverLight ?? "#F3F4F6";
    const section = colors.section ?? colors.muted ?? "#EEF0F3";

    return [
      { key: "bg", label: "Background (bg)", value: pick("bg", "#F5F5F7") },
      { key: "card", label: "Surface (card)", value: pick("card", "#FFFFFF") },
      { key: "surfaceAlt", label: "Surface Alt", value: surfaceAlt },
      { key: "section", label: "Section", value: section },
      { key: "accentFill", label: "Accent Fill", value: accentFill, isAccent: true },
    ];
  }, [colors, accentFill]);

  // Border colours to test
  const borderColours = useMemo(() => {
    const border = colors.border ?? "#D5D8DE";
    const borderStrong = colors.borderStrong ?? colors.sapSilverMedium ?? "#C7CBD4";
    const accentBorder = colors.accentBorder ?? accentFill;

    return [
      { key: "border", label: "Border", value: border },
      { key: "borderStrong", label: "Border Strong", value: borderStrong },
      { key: "accentBorder", label: "Accent Border", value: accentBorder },
    ];
  }, [colors, accentFill]);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.page}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85} style={s.iconBtn}>
            <Feather name="chevron-left" size={18} color={colors.text} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={s.title}>Colours</Text>
            <Text style={s.subtext}>
              Palette test • theme: <Text style={{ fontWeight: "900" }}>{theme}</Text>
            </Text>
          </View>

          <TouchableOpacity onPress={() => setShowHex((v) => !v)} activeOpacity={0.85} style={s.iconBtn}>
            <Feather name={showHex ? "hash" : "eye"} size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Theme toggles */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Theme</Text>
          <View style={s.row}>
            <ThemePill label="Light" active={theme === "light"} onPress={() => setTheme("light")} s={s} />
            <ThemePill label="Dark" active={theme === "dark"} onPress={() => setTheme("dark")} s={s} />
            <ThemePill label="System" active={theme === "system"} onPress={() => setTheme("system")} s={s} />
          </View>
          <Text style={s.cardHint}>Use this page to quickly spot contrast issues (especially in light mode).</Text>
        </View>

        {/* Text over background (per background tile) */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Text on backgrounds</Text>
          <Text style={s.cardHint}>
            Each tile shows which text colours to use *on that background* (Text, Subtext, Accent Ink). Accent fill uses On Accent text.
          </Text>

          <View style={{ marginTop: 12, gap: 12 }}>
            {backgroundRoles.map((bg) => (
              <BackgroundSpecTile
                key={bg.key}
                bg={bg}
                showHex={showHex}
                colors={colors}
                isDark={isDark}
                accentInk={accentInk}
                accentFill={accentFill}
              />
            ))}
          </View>
        </View>

        {/* Border section (borders rendered on different backgrounds) */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Borders on backgrounds</Text>
          <Text style={s.cardHint}>
            Shows hairline vs 1px lines and outline examples using Border / Border Strong / Accent Border on each background.
          </Text>

          {/* explicitly show what hairline resolves to */}
          <View style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 12, color: colors.subtext, fontWeight: "800" }}>
              Hairline width:{" "}
              <Text style={{ fontWeight: "900", color: colors.text }}>
                {StyleSheet.hairlineWidth}
              </Text>
            </Text>
          </View>

          <View style={{ marginTop: 12, gap: 12 }}>
            {backgroundRoles.filter((b) => !b.isAccent).map((bg) => (
              <BorderSpecTile
                key={`b-${bg.key}`}
                bg={bg}
                showHex={showHex}
                borderColours={borderColours}
                colors={colors}
                isDark={isDark}
              />
            ))}
          </View>
        </View>

        {/* Swatches */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Swatches</Text>
          <Text style={s.cardHint}>Tap a swatch to copy the hex.</Text>

          <View style={s.grid}>
            {swatches.map((c) => (
              <Swatch
                key={c.key}
                label={c.label}
                hex={c.value}
                showHex={showHex}
                colors={colors}
                isDark={isDark}
                accentFill={accentFill}
              />
            ))}
          </View>
        </View>

        {/* Typography samples */}
        <View style={[s.card, { marginBottom: 28 }]}>
          <Text style={s.cardLabel}>Typography samples</Text>
          <Text style={s.cardHint}>Checks your text colours on neutral surfaces (no neon text).</Text>

          <View style={{ marginTop: 10 }}>
            {textSamples.map((t) => (
              <View key={t.label} style={s.sampleRow}>
                <Text style={[s.sampleLabel, { color: colors.subtext }]}>{t.label}</Text>
                <Text style={t.style}>The quick brown fox jumps over the lazy dog.</Text>
              </View>
            ))}
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
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={[s.pill, active && s.pillActive]}>
      <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function BackgroundSpecTile({ bg, showHex, colors, isDark, accentInk, accentFill }) {
  const onAccent = colors.sapOnPrimary || "#111111";
  const border = colors.borderStrong || colors.sapSilverMedium || colors.border;

  // Decide the recommended “on background” colours
  const textOnBg = bg.isAccent ? onAccent : colors.text;
  const subtextOnBg = bg.isAccent ? onAccent : colors.subtext;
  const accentInkOnBg = bg.isAccent ? onAccent : accentInk;

  return (
    <View style={{ borderRadius: 18, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: border }}>
      <View style={{ backgroundColor: bg.value, padding: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: "900", color: textOnBg }} numberOfLines={1}>
            {bg.label}
          </Text>
          {showHex ? (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: isDark ? "#00000030" : "#FFFFFF66",
                borderWidth: 1,
                borderColor: isDark ? "#00000020" : "#00000012",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "900", color: textOnBg }}>
                {String(bg.value).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Typography-like spec rows */}
        <View style={{ marginTop: 12, gap: 10 }}>
          <SpecRow title="Use Text" subtitle={String(colors.text)} textStyle={{ color: textOnBg, fontWeight: "900" }} />
          <SpecRow title="Use Subtext" subtitle={String(colors.subtext)} textStyle={{ color: subtextOnBg, fontWeight: "800" }} />
          <SpecRow title="Use Accent Ink (no neon text)" subtitle={String(accentInk)} textStyle={{ color: accentInkOnBg, fontWeight: "900" }} />
        </View>

        {/* Accent fill sample button sitting on this background */}
        {!bg.isAccent ? (
          <View style={{ marginTop: 14 }}>
            <View
              style={{
                borderRadius: 999,
                backgroundColor: accentFill,
                paddingVertical: 10,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.accentBorder || accentFill,
              }}
            >
              <Text style={{ fontWeight: "900", color: onAccent }}>Accent fill button</Text>
            </View>
          </View>
        ) : (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: onAccent, fontWeight: "800", fontSize: 12 }}>
              Accent background: always use “On Accent” for text.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function BorderSpecTile({ bg, showHex, borderColours, colors, isDark }) {
  const tileBorder = colors.borderStrong || colors.sapSilverMedium || colors.border;
  const fg = colors.text || pickOnColor(bg.value, "#FFFFFF", "#111111");
  const sub = colors.subtext || pickOnColor(bg.value, "#FFFFFF", "#111111");

  return (
    <View style={{ borderRadius: 18, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: tileBorder }}>
      <View style={{ backgroundColor: bg.value, padding: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: "900", color: fg }} numberOfLines={1}>
            {bg.label}
          </Text>

          {showHex ? (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: isDark ? "#00000030" : "#FFFFFF66",
                borderWidth: 1,
                borderColor: isDark ? "#00000020" : "#00000012",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "900", color: fg }}>
                {String(bg.value).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 12, gap: 14 }}>
          {borderColours.map((b) => (
            <View key={b.key} style={{ gap: 8 }}>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "900",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: sub,
                }}
              >
                {b.label} · {String(b.value).toUpperCase()}
              </Text>

              {/* ✅ Hairline vs 1px vs 2px comparison */}
              <View style={{ borderRadius: 14, overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: fg }}>Hairline</Text>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: sub }}>
                    {StyleSheet.hairlineWidth}
                  </Text>
                </View>
                <View style={{ height: 8 }} />
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: b.value, opacity: 1 }} />

                <View style={{ height: 12 }} />

                <Text style={{ fontSize: 11, fontWeight: "800", color: fg }}>1px</Text>
                <View style={{ height: 8 }} />
                <View style={{ height: 1, backgroundColor: b.value, opacity: 1 }} />

                <View style={{ height: 12 }} />

                <Text style={{ fontSize: 11, fontWeight: "800", color: fg }}>2px</Text>
                <View style={{ height: 8 }} />
                <View style={{ height: 2, backgroundColor: b.value, opacity: 1 }} />
              </View>

              {/* Outline boxes */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                <View
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    padding: 10,
                    backgroundColor: isDark ? "#00000030" : "#FFFFFF80",
                    borderWidth: StyleSheet.hairlineWidth, // ✅ hairline outline
                    borderColor: b.value,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "900", color: fg }}>
                    Hairline outline
                  </Text>
                  <Text style={{ marginTop: 2, fontSize: 12, color: sub }}>
                    Container edge
                  </Text>
                </View>

                <View
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    padding: 10,
                    backgroundColor: isDark ? "#00000020" : "#FFFFFF66",
                    borderWidth: 1,
                    borderColor: b.value,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "900", color: fg }}>
                    1px outline
                  </Text>
                  <Text style={{ marginTop: 2, fontSize: 12, color: sub }}>
                    Stronger edge
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function SpecRow({ title, subtitle, textStyle }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 10, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase", opacity: 0.9 }}>
        {title}
      </Text>
      <Text style={[{ fontSize: 13 }, textStyle]}>
        The quick brown fox jumps over the lazy dog.
      </Text>
      <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.7 }}>{subtitle}</Text>
    </View>
  );
}

function Swatch({ label, hex, showHex, colors, isDark, accentFill }) {
  const onPress = () => Alert.alert("Colour", `Copy this hex:\n${hex}`);
  const textOnSwatch = pickOnColor(hex, "#FFFFFF", "#111111");

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        width: "48%",
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong || colors.sapSilverMedium || colors.border,
        overflow: "hidden",
      }}
    >
      <View style={{ height: 64, backgroundColor: hex }} />
      <View style={{ paddingHorizontal: 10, paddingVertical: 10, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 12, fontWeight: "900", color: colors.text, marginBottom: 4 }} numberOfLines={1}>
          {label}
        </Text>

        {showHex ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: hex,
                borderWidth: 1,
                borderColor: isDark ? "#00000040" : "#00000010",
              }}
            />
            <Text style={{ fontSize: 12, color: colors.subtext, fontWeight: "700" }}>
              {String(hex).toUpperCase()}
            </Text>
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.subtext, fontWeight: "700" }}>Tap to copy</Text>
        )}

        {label.toLowerCase().includes("accent") ? (
          <View style={{ marginTop: 8 }}>
            <View
              style={{
                borderRadius: 999,
                backgroundColor: accentFill,
                paddingVertical: 8,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontWeight: "900", color: colors.sapOnPrimary || "#111111" }}>
                Accent fill sample
              </Text>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: 10 }}>
          <View
            style={{
              borderRadius: 12,
              backgroundColor: hex,
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderWidth: 1,
              borderColor: isDark ? "#00000030" : "#00000010",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "900", color: textOnSwatch }}>
              Text on this colour
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

function pickOnColor(hex, lightText = "#FFFFFF", darkText = "#111111") {
  const rgb = hexToRgb(hex);
  if (!rgb) return darkText;
  const { r, g, b } = rgb;
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.6 ? darkText : lightText;
}

function hexToRgb(hex) {
  if (!hex) return null;
  const h = String(hex).replace("#", "").trim();
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  return { r, g, b };
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

    title: { fontSize: 26, fontWeight: "900", color: colors.text },
    body: { fontSize: 14, color: colors.text, lineHeight: 20 },
    subtext: { fontSize: 13, color: colors.subtext, lineHeight: 18 },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },

    card: {
      backgroundColor: "#0000000",
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
    cardHint: { marginTop: 6, fontSize: 12, color: colors.subtext, lineHeight: 16 },

    row: { flexDirection: "row", gap: 10, marginTop: 10 },

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

    grid: {
      marginTop: 12,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      justifyContent: "space-between",
    },

    sampleRow: { marginTop: 10 },
    sampleLabel: { fontSize: 12, fontWeight: "800", marginBottom: 6 },
  });
}
