import { Image, Text, TouchableOpacity, View } from "react-native";

export default function MeHeader({
  profile,
  colors,
  styles,
  onProfile,
  onSettings,
}) {
  const name = profile?.name || "You";
  const secondaryLine =
    profile?.supportLine || profile?.email || "Personal progress";
  const initial = String(name || "Y").trim().charAt(0).toUpperCase() || "Y";

  return (
    <View style={styles.header}>
      <View style={styles.headerIdentity}>
        <View style={styles.headerAvatarRing}>
          {profile?.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarFallback}>
              <Text style={[styles.headerAvatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={styles.headerCopy}>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.headerMeta, { color: colors.subtext }]} numberOfLines={1}>
            {secondaryLine}
          </Text>
        </View>
      </View>

      <View style={styles.headerActions}>
        <TouchableOpacity
          style={styles.headerAction}
          activeOpacity={0.82}
          onPress={onProfile}
        >
          <Text style={[styles.headerActionText, { color: colors.text }]}>Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerAction}
          activeOpacity={0.82}
          onPress={onSettings}
        >
          <Text style={[styles.headerActionText, { color: colors.text }]}>Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
