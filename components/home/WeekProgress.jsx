import { Text, View } from "react-native";

export default function WeekProgress({ metrics, weekLabel, styles, colors }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionEyebrow, { color: colors.subtext }]}>
          Weekly progress
        </Text>
        <Text style={[styles.sectionMeta, { color: colors.subtext }]}>
          {weekLabel}
        </Text>
      </View>

      <View style={styles.metricRow}>
        {metrics.map((item, index) => (
          <View key={item.label} style={styles.metricItem}>
            <Text style={[styles.metricValue, { color: colors.text }]}>
              {item.value}
            </Text>
            <Text style={[styles.metricLabel, { color: colors.subtext }]}>
              {item.label}
            </Text>
            {index < metrics.length - 1 ? (
              <View style={styles.metricDivider} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
