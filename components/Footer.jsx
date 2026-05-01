// components/Footer.jsx
import Feather from "./LucideFeather";
import { BlurView } from "expo-blur";
// Haptics removed
import { usePathname, useRouter } from "expo-router";
import { memo, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLiveActivity } from "../providers/LiveActivityProvider";
import { useTheme } from "../providers/ThemeProvider";
import {
  ACTIVE_LIVE_ACTIVITY_STATUSES,
  isLiveActivityStale,
  normaliseLiveActivityStatus,
  shouldPauseStaleLiveActivity,
} from "../src/train/utils/liveActivityHelpers";

const HORIZONTAL_PADDING = 4; // must match blur paddingHorizontal below

const TABS = [
  { key: "Summary", icon: "grid", label: "Summary", path: "/(protected)/home" },
  { key: "train", icon: "activity", label: "Train", path: "/(protected)/train" },
  { key: "record", icon: "message-circle", label: "Chat", path: "/(protected)/chat" },
  { key: "nutrition", icon: "droplet", label: "Fuel", path: "/(protected)/nutrition" },
  { key: "me", icon: "user", label: "You", path: "/(protected)/me" },
];

function normalisePathForMatch(path) {
  let out = String(path || "").trim();
  if (!out) return "/";
  out = out.replace(/\/\([^/]+\)/g, "");
  out = out.replace(/\/{2,}/g, "/");
  out = out.replace(/\/$/, "");
  return out || "/";
}

function Tab({ icon, label, active, onPress, colors, accentFill }) {
  // ✅ no neon text — neon only as fill/highlight
  const iconColor = active ? colors.text : colors.subtext;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.tabContainer}>
      <View style={styles.iconLabelWrap}>
        <Feather name={icon} size={20} color={iconColor} style={{ zIndex: 3 }} />
        <Text style={[styles.label, { color: iconColor }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

function FooterInner() {
  const rawPath = usePathname() || "/";
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { hydrated: liveHydrated, liveActivity, setLiveActivity, clearLiveActivity } =
    useLiveActivity();

  // ✅ use theme accent fill (neon) but DO NOT use it for text
  const accentFill = colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";

  const pathname =
    rawPath === "/(protected)" || rawPath === "/"
      ? "/(protected)/home"
      : rawPath;
  const currentPathForMatch = normalisePathForMatch(pathname);
  const liveRoute = String(liveActivity?.route || "");
  const liveRouteForMatch = normalisePathForMatch(liveRoute);
  const liveStatus = normaliseLiveActivityStatus(liveActivity?.status);
  const liveSessionKey = String(liveActivity?.sessionKey || "").trim();
  const isFreshLiveState = !isLiveActivityStale(liveActivity);
  const hasLiveRouteShape = /^\/train\/session\/.+\/live$/.test(liveRouteForMatch);
  const hasValidLiveState =
    !!liveActivity?.isActive &&
    !!liveSessionKey &&
    hasLiveRouteShape &&
    ACTIVE_LIVE_ACTIVITY_STATUSES.has(liveStatus) &&
    isFreshLiveState;
  const isLiveActive = !!(liveHydrated && hasValidLiveState);
  const isOnLiveRoute = isLiveActive && currentPathForMatch === liveRouteForMatch;
  const showLivePill = isLiveActive && !isOnLiveRoute;
  const liveLabel = liveStatus === "paused" ? "Live paused" : "Live";

  useEffect(() => {
    if (!liveHydrated) return;
    if (!liveActivity?.isActive) return;
    if (shouldPauseStaleLiveActivity(liveActivity)) {
      setLiveActivity((prev) => {
        if (!shouldPauseStaleLiveActivity(prev)) return prev;
        return {
          ...prev,
          status: "paused",
          updatedAt: Date.now(),
        };
      });
      return;
    }
    if (hasValidLiveState) return;
    clearLiveActivity();
  }, [
    clearLiveActivity,
    hasValidLiveState,
    liveActivity,
    liveHydrated,
    setLiveActivity,
  ]);

  // ✅ colours only (keep sizing EXACTLY the same)
  const theme = {
    barBg: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.72)",
    border: colors.borderStrong || colors.sapSilverMedium || colors.border,
    subtext: colors.subtext,
  };

  const go = (tab) => {
    const path = tab?.path;
    if (!path) return;
    if (pathname !== path) router.replace(path);
  };

  const goToLive = () => {
    if (!liveRoute) return;
    if (!isOnLiveRoute) router.push(liveRoute);
  };

  /* ----------------------- Highlighter slider ------------------------ */
  const slideX = useRef(new Animated.Value(0)).current;
  const [tabWidth, setTabWidth] = useState(0);
  const hasInitialisedSlider = useRef(false);
  const prevSafeIndex = useRef(null);
  const prevTabWidth = useRef(0);

  // Match using the tab root path, so nested routes still map to the right tab.
  const activeIndex = TABS.findIndex((t) => {
    const tabPath = normalisePathForMatch(t.path);
    return (
      currentPathForMatch === tabPath ||
      currentPathForMatch.startsWith(`${tabPath}/`)
    );
  });
  const safeIndex = activeIndex === -1 ? 0 : activeIndex;

  // one pill per tab, almost full width of that tab
  const sliderWidth = tabWidth > 0 ? tabWidth - 0 : 0;

  useEffect(() => {
    if (!tabWidth || !sliderWidth) return;

    const targetX =
      HORIZONTAL_PADDING + safeIndex * tabWidth + (tabWidth - sliderWidth) / 2;

    // On first mount/remount (e.g. returning from fullscreen pages),
    // place the pill directly at the correct tab with no slide animation.
    if (!hasInitialisedSlider.current) {
      slideX.setValue(targetX);
      hasInitialisedSlider.current = true;
      prevSafeIndex.current = safeIndex;
      prevTabWidth.current = tabWidth;
      return;
    }

    const tabChanged = prevSafeIndex.current !== safeIndex;
    const widthChanged = prevTabWidth.current !== tabWidth;
    prevSafeIndex.current = safeIndex;
    prevTabWidth.current = tabWidth;

    // Keep position synced if layout width changed (rotation/resize), no animation.
    if (widthChanged && !tabChanged) {
      slideX.setValue(targetX);
      return;
    }

    if (!tabChanged) return;

    Animated.spring(slideX, {
      toValue: targetX,
      useNativeDriver: true,
      tension: 140,
      friction: 12,
    }).start();
  }, [safeIndex, tabWidth, sliderWidth, slideX]);

  const onLayoutTabs = (e) => {
    const totalWidth = e.nativeEvent.layout.width;
    if (totalWidth) setTabWidth(totalWidth / TABS.length);
  };

  /* -------------------------- Footer bounce -------------------------- */
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(bounce, { toValue: 1, duration: 70, useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  }, [safeIndex, bounce]);

  const scale = bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.01] });
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });

  return (
    <View style={styles.outerContainer}>
      {showLivePill ? (
        <TouchableOpacity
          onPress={goToLive}
          activeOpacity={0.88}
          style={[
            styles.livePill,
            {
              backgroundColor: accentFill,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>{liveLabel}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.floatingContainer}>
        <Animated.View style={{ transform: [{ scale }, { translateY }] }}>
          <BlurView
            intensity={30}
            tint={isDark ? "dark" : "light"}
            style={[
              styles.blur,
              {
                backgroundColor: theme.barBg,
                borderColor: theme.border,
              },
            ]}
          >
            {/* Monzo-style pill (neon fill only) */}
            {tabWidth > 0 && (
              <Animated.View
                style={[
                  styles.highlighterSlider,
                  {
                    width: sliderWidth,
                    transform: [{ translateX: slideX }],
                    backgroundColor: accentFill,
                    // Keep the same vibe but slightly safer in light mode
                    opacity: isDark ? 0.18 : 0.14,
                  },
                ]}
              />
            )}

            {/* Tabs */}
            <View style={styles.tabsRow} onLayout={onLayoutTabs}>
              {TABS.map((t, index) => (
                <Tab
                  key={t.key}
                  icon={t.icon}
                  label={t.label}
                  active={index === safeIndex}
                  onPress={() => {
                    go(t);
                  }}
                  colors={colors}
                  accentFill={accentFill}
                />
              ))}
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </View>
  );
}

export default memo(FooterInner);

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
  outerContainer: {
    width: "100%",
    paddingBottom: 18,
  },
  livePill: {
    position: "absolute",
    alignSelf: "center",
    bottom: 80,
    zIndex: 20,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#DC2626",
  },
  livePillText: {
    color: "#101010",
    fontSize: 12,
    fontWeight: "900",
  },
  floatingContainer: {
    paddingHorizontal: 20,
  },

  // ✅ SIZING UNCHANGED (only colours are theme-driven now)
  blur: {
    borderRadius: 40,
    overflow: "hidden",
    paddingVertical: 10,
    paddingHorizontal: HORIZONTAL_PADDING,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E1E3E8", // overwritten at runtime by theme.border
  },

  // Monzo-style pill: fills height, rounded like the footer
  highlighterSlider: {
    position: "absolute",
    top: 4,
    bottom: 4,
    borderRadius: 40,
    backgroundColor: "#E6FF3B", // overwritten at runtime by accentFill
    opacity: 0.22, // overwritten at runtime (slight tweak per mode)
    zIndex: 1,
  },

  tabsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },

  tabContainer: {
    flex: 1,
    alignItems: "center",
  },

  iconLabelWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 70,
    height: 50,
  },

  label: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    zIndex: 3,
  },
});
