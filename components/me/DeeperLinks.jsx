import { Text, TouchableOpacity, View } from "react-native";

export default function DeeperLinks({ items, colors, styles, onPressItem }) {
  if (!items?.length) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Go deeper</Text>
      </View>
      <View style={styles.listGroup}>
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.key || item.label}
            style={[
              styles.listRow,
              index < items.length - 1 && styles.listRowDivider,
            ]}
            activeOpacity={item.path ? 0.82 : 1}
            onPress={item.path ? () => onPressItem?.(item) : undefined}
            disabled={!item.path}
          >
            <View style={styles.listCopy}>
              <Text style={[styles.listLabel, { color: colors.text }]}>{item.label}</Text>
              {!!item.meta && (
                <Text style={[styles.listMeta, { color: colors.subtext }]}>{item.meta}</Text>
              )}
            </View>

            <View style={styles.listRight}>
              {!!item.value && (
                <View style={styles.listBadge}>
                  <Text style={[styles.listBadgeText, { color: colors.subtext }]}>{item.value}</Text>
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
