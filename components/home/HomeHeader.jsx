import { Text, TouchableOpacity, View } from "react-native";

import Feather from "../LucideFeather";

export default function HomeHeader({
  greeting,
  dateLabel,
  statusLabel,
  refreshing,
  colors,
  styles,
  onRefresh,
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={[styles.headerGreeting, { color: colors.text }]}>
          {greeting}
        </Text>
        <Text style={[styles.headerDate, { color: colors.subtext }]}>
          {dateLabel}
        </Text>
      </View>

      <View style={styles.headerActions}>
        <View style={styles.statusChip}>
          <View
            style={[styles.statusDot, { backgroundColor: colors.accentBg || "#E6FF3B" }]}
          />
          <Text style={[styles.statusText, { color: colors.text }]}>{statusLabel}</Text>
        </View>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={onRefresh}
          activeOpacity={0.82}
          disabled={refreshing}
        >
          <Feather
            name="refresh-cw"
            size={15}
            color={refreshing ? colors.subtext : colors.text}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}
