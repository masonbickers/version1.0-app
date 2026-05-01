import { Text, TouchableOpacity, View } from "react-native";

export default function ProgressSummary({
  progress,
  colors,
  styles,
  onOpenWeek,
  onOpenMonth,
}) {
  if (!progress) return null;

  const weekly = progress.weekly || {};
  const monthly = progress.monthly || {};
  const metrics = progress.summaryMetrics || [];

  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressHeading}>
        <View>
          <Text style={[styles.progressEyebrow, { color: colors.subtext }]}>Progress</Text>
          <Text style={[styles.progressTitle, { color: colors.text }]}>Your training</Text>
        </View>
        <Text style={[styles.progressContext, { color: colors.subtext }]}>
          {monthly.workouts || 0} activities this month
        </Text>
      </View>

      <View style={styles.progressHero}>
        <View style={styles.progressPrimary}>
          <Text style={[styles.progressPrimaryValue, { color: colors.text }]}>
            {weekly.distanceKm ? `${weekly.distanceKm.toFixed(1)} km` : `${weekly.workouts || 0}`}
          </Text>
          <Text style={[styles.progressPrimaryLabel, { color: colors.subtext }]}>
            {weekly.distanceKm ? "Run distance this week" : "Sessions this week"}
          </Text>
        </View>

        <View style={styles.progressActions}>
          <TouchableOpacity style={styles.progressLink} activeOpacity={0.82} onPress={onOpenWeek}>
            <Text style={[styles.progressLinkText, { color: colors.text }]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.progressLink} activeOpacity={0.82} onPress={onOpenMonth}>
            <Text style={[styles.progressLinkText, { color: colors.text }]}>Month</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.progressMetrics}>
        {metrics.map((item, index) => (
          <View
            key={item.key || item.label}
            style={[
              styles.progressMetric,
              index % 2 === 0 && styles.progressMetricLeft,
              index > 1 && styles.progressMetricTop,
            ]}
          >
            <Text style={[styles.progressMetricValue, { color: colors.text }]}>{item.value}</Text>
            <Text style={[styles.progressMetricLabel, { color: colors.subtext }]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
