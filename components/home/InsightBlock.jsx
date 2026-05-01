import { Text, View } from "react-native";

export default function InsightBlock({ insight, styles, colors, accentBg }) {
  if (!insight) return null;

  return (
    <View style={styles.section}>
      <View style={styles.insightDivider} />
      <Text style={[styles.sectionEyebrow, { color: colors.subtext }]}>
        {insight.eyebrow}
      </Text>
      <Text style={[styles.insightTitle, { color: colors.text }]}>
        {insight.title}
      </Text>
      <Text style={[styles.insightBody, { color: colors.subtext }]}>
        {insight.body}
      </Text>
      <View style={[styles.insightAccent, { backgroundColor: accentBg }]} />
    </View>
  );
}
