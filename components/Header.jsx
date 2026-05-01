// components/Header.jsx
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { memo, useMemo } from "react";
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth } from "../firebaseConfig";
import { useTheme } from "../providers/ThemeProvider";
;
/**
 * Usage:
 * <Header title="version1.0" unread={{ activity: 3, messages: 1 }} />
 *
 * Routes pushed:
 *  - Left avatar: /me
 *  - Heart (activity): /history
 *  - Messages (DM): /chat
 */
function HeaderInner({ title = "version1.0", unread = { activity: 0, messages: 0 } }) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const user = auth.currentUser;

  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const initial =
    (user?.displayName?.trim()?.[0] ??
      user?.email?.trim()?.[0] ??
      "U"
    ).toUpperCase();

  const tap = (fn) => () => {
    try { Haptics.selectionAsync(); } catch {}
    fn();
  };

  return (
    <View style={styles.safePad}>
      <View style={styles.wrap}>
        {/* Left: Profile */}
        <TouchableOpacity
          style={styles.left}
          onPress={tap(() => router.push("/me"))}
          accessibilityRole="button"
        >
          {user?.photoURL ? (
            <Image source={{ uri: user.photoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Center: Title / Logo */}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        {/* Right: Actions */}
        <View style={styles.right}>
          <IconButton
            name="heart"
            onPress={tap(() => router.push("/history"))}
            badge={unread?.activity || 0}
            colors={colors}
          />
          <IconButton
            name="message-circle"
            onPress={tap(() => router.push("/chat"))}
            badge={unread?.messages || 0}
            colors={colors}
          />
        </View>
      </View>
    </View>
  );
}

function IconButton({ name, onPress, badge = 0, colors }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Feather name={name} size={22} color={colors.text} />
      {badge > 0 && (
        <View style={[s.badge, { backgroundColor: colors.accent }]}>
          <Text style={s.badgeText}>{badge > 9 ? "9+" : String(badge)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  iconBtn: { marginLeft: 14, position: "relative" },
  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "white", fontSize: 10, fontWeight: "800" },
});

const makeStyles = (colors, isDark) =>
  StyleSheet.create({
    safePad: {
      paddingTop: Platform.select({ ios: 8, android: 0, default: 0 }),
      backgroundColor: colors.header,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      ...Platform.select({
        ios: { shadowColor: "#000", shadowOpacity: isDark ? 0.25 : 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
        android: { elevation: 2 },
      }),
    },
    wrap: {
      height: 52,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.header,
    },
    left: { width: 36, height: 36, borderRadius: 18, overflow: "hidden" },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: colors.text, fontWeight: "800" },
    title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: colors.text },
    right: { flexDirection: "row", alignItems: "center" },
  });

const Header = memo(HeaderInner);
export default Header;
