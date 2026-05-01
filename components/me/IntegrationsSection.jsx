import { Text, TouchableOpacity, View } from "react-native";

export default function IntegrationsSection({
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
      </View>
      <View style={styles.listGroup}>
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.key || item.label}
            style={[
              styles.listRow,
              index < items.length - 1 && styles.listRowDivider,
            ]}
            activeOpacity={0.82}
            onPress={onPressItem ? () => onPressItem(item) : undefined}
            disabled={!onPressItem}
          >
            <View style={styles.listCopy}>
              <Text style={[styles.listLabel, { color: colors.text }]}>{item.label}</Text>
              {!!item.meta && (
                <Text style={[styles.listMeta, { color: colors.subtext }]}>{item.meta}</Text>
              )}
            </View>

            <View style={styles.listRight}>
              {!!item.value && (
                <Text style={[styles.listValue, { color: colors.text }]}>{item.value}</Text>
              )}
              {onPressItem ? <Text style={[styles.chevron, { color: colors.subtext }]}>›</Text> : null}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
