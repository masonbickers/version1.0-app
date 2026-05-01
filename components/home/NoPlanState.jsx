import { Text, TouchableOpacity, View } from "react-native";

export default function NoPlanState({ styles, colors, accentBg, onPress }) {
  return (
    <View style={styles.hero}>
      <Text style={[styles.heroEyebrow, { color: colors.subtext }]}>No active plan</Text>
      <Text style={[styles.heroTitle, { color: colors.text }]}>
        Build a plan so today is obvious.
      </Text>
      <Text style={[styles.heroSubtitle, { color: colors.subtext }]}>
        Your home page becomes a focused daily dashboard once a training plan is active.
      </Text>

      <TouchableOpacity
        style={[styles.heroPrimaryButton, { backgroundColor: accentBg, marginTop: 8 }]}
        onPress={onPress}
        activeOpacity={0.88}
      >
        <Text style={styles.heroPrimaryText}>Create a plan</Text>
      </TouchableOpacity>
    </View>
  );
}
