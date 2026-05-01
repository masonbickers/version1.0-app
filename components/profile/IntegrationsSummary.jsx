import { Text, TouchableOpacity, View } from "react-native";

export default function IntegrationsSummary({
  items,
  colors,
  styles,
  onPressItem,
}) {
  if (!items?.length) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Integrations</Text>
        <Text style={[styles.sectionSummary, { color: colors.subtext }]}>
          A light summary of the services tied to your profile.
        </Text>
      </View>

      <View style={styles.groupedList}>
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.groupedRow,
              index < items.length - 1 && styles.groupedRowDivider,
            ]}
            activeOpacity={0.82}
            onPress={() => onPressItem?.(item)}
          >
            <View style={styles.groupedCopy}>
              <Text style={[styles.groupedLabel, { color: colors.text }]}>{item.label}</Text>
              <Text style={[styles.groupedMeta, { color: colors.subtext }]}>{item.meta}</Text>
            </View>
            <View style={styles.groupedRight}>
              <Text style={[styles.groupedValue, { color: colors.text }]}>{item.value}</Text>
              <Text style={[styles.chevron, { color: colors.subtext }]}>›</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
