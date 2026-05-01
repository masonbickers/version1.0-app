import { Text, TouchableOpacity, View } from "react-native";

export default function RecentActivity({
  activities,
  colors,
  styles,
  onOpen,
}) {
  if (!activities?.length) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Recent activity</Text>
      </View>

      <View style={styles.listGroup}>
        {activities.map((activity, index) => (
          <TouchableOpacity
            key={activity.id || `${activity.name}-${index}`}
            style={[
              styles.listRow,
              index < activities.length - 1 && styles.listRowDivider,
            ]}
            activeOpacity={0.82}
            onPress={() => onOpen?.(activity)}
          >
            <View style={styles.listCopy}>
              <Text style={[styles.listLabel, { color: colors.text }]} numberOfLines={1}>
                {activity.name || activity.title || "Activity"}
              </Text>
              <Text style={[styles.listMeta, { color: colors.subtext }]} numberOfLines={1}>
                {activity.meta || "Workout"}
              </Text>
            </View>
            <View style={styles.listRight}>
              <Text style={[styles.listValue, { color: colors.subtext }]}>{activity.whenLabel}</Text>
              <Text style={[styles.chevron, { color: colors.subtext }]}>›</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
