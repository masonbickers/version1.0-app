import { Image, Text, TouchableOpacity, View } from "react-native";

export default function ProfileHeader({
  profile,
  colors,
  styles,
  onBack,
  onEditPhoto,
}) {
  const name = profile?.name || "Your profile";
  const email = profile?.email || "No email";
  const username = profile?.username ? `@${profile.username}` : "";
  const initial = String(name || email || "Y").trim().charAt(0).toUpperCase() || "Y";

  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerTopRow}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.82}>
          <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTopLabel, { color: colors.subtext }]}>Private</Text>
      </View>

      <View style={styles.headerMain}>
        <TouchableOpacity
          style={styles.avatarRing}
          onPress={onEditPhoto}
          activeOpacity={0.85}
        >
          {profile?.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
          ) : (
            <View
              style={[
                styles.avatarFallback,
                { backgroundColor: colors.card || "rgba(255,255,255,0.08)" },
              ]}
            >
              <Text style={[styles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerCopy}>
          <Text style={[styles.headerEyebrow, { color: colors.subtext }]}>Edit profile</Text>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.headerMeta, { color: colors.subtext }]} numberOfLines={1}>
            {username || email}
          </Text>
          <Text style={[styles.headerSupport, { color: colors.subtext }]} numberOfLines={2}>
            {profile?.supportLine || "Edit how you appear in the app"}
          </Text>
          <TouchableOpacity
            onPress={onEditPhoto}
            style={styles.inlineAction}
            activeOpacity={0.82}
          >
            <Text style={[styles.inlineActionText, { color: colors.text }]}>Edit photo</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
