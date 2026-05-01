import { Text, TouchableOpacity, View } from "react-native";

export default function QuickActions({ items, styles, colors, onPress }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionEyebrow, { color: colors.subtext }]}>
        Quick actions
      </Text>
      <View style={styles.actionRow}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.actionPill}
            onPress={() => onPress(item.path)}
            activeOpacity={0.82}
          >
            <Text style={[styles.actionPillText, { color: colors.text }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
