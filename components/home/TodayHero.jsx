import { Text, TouchableOpacity, View } from "react-native";

import Feather from "../LucideFeather";

export default function TodayHero({
  data,
  styles,
  colors,
  accentBg,
  onPrimaryPress,
  onSecondaryPress,
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <Text style={[styles.heroEyebrow, { color: colors.subtext }]}>
          {data.eyebrow}
        </Text>
        {data.completed ? (
          <View style={styles.heroStateChip}>
            <Text style={[styles.heroStateText, { color: colors.text }]}>
              Logged
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.heroTitle, { color: colors.text }]}>{data.title}</Text>
      <Text style={[styles.heroSubtitle, { color: colors.subtext }]}>
        {data.subtitle}
      </Text>

      {!!data.meta?.length && (
        <View style={styles.heroMetaRow}>
          {data.meta.map((item) => (
            <Text key={item} style={[styles.heroMetaText, { color: colors.text }]}>
              {item}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.heroActionRow}>
        <TouchableOpacity
          style={[styles.heroPrimaryButton, { backgroundColor: accentBg }]}
          onPress={onPrimaryPress}
          activeOpacity={0.88}
        >
          <Feather name="play" size={15} color="#111111" />
          <Text style={styles.heroPrimaryText}>{data.ctaLabel}</Text>
        </TouchableOpacity>

        {data.secondaryLabel ? (
          <TouchableOpacity
            style={styles.heroSecondaryButton}
            onPress={onSecondaryPress}
            activeOpacity={0.82}
          >
            <Text style={[styles.heroSecondaryText, { color: colors.text }]}>
              {data.secondaryLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
