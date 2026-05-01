import { Text, TouchableOpacity, View } from "react-native";

export default function SecondaryLinks({ items, colors, styles, onPressItem }) {
  if (!items?.length) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Manage</Text>
        <Text style={[styles.sectionSummary, { color: colors.subtext }]}>
          Secondary destinations for security, imports, and future analytics.
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
            activeOpacity={item.path ? 0.82 : 1}
            onPress={item.path ? () => onPressItem?.(item) : undefined}
            disabled={!item.path}
          >
            <View style={styles.groupedCopy}>
              <Text style={[styles.groupedLabel, { color: colors.text }]}>{item.label}</Text>
              <Text style={[styles.groupedMeta, { color: colors.subtext }]}>{item.meta}</Text>
            </View>
            <View style={styles.groupedRight}>
              {!!item.value && (
                <View style={styles.inlineBadge}>
                  <Text style={[styles.inlineBadgeText, { color: colors.subtext }]}>
                    {item.value}
                  </Text>
                </View>
              )}
              {item.path ? <Text style={[styles.chevron, { color: colors.subtext }]}>›</Text> : null}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
