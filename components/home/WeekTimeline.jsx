import { Text, TouchableOpacity, View } from "react-native";

function toneForState(state, colors, accentBg) {
  if (state === "today") {
    return {
      fill: accentBg,
      text: "#111111",
      meta: "#111111",
    };
  }
  if (state === "completed") {
    return {
      fill: colors.isDark ? "#1A231C" : "#EDF7EF",
      text: colors.text,
      meta: colors.subtext,
    };
  }
  return {
    fill: colors.isDark ? "#15171B" : "#F3F4F6",
    text: colors.text,
    meta: colors.subtext,
  };
}

export default function WeekTimeline({
  items,
  styles,
  colors,
  accentBg,
  onSelectToday,
  onSelectCalendar,
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionEyebrow, { color: colors.subtext }]}>
          Week timeline
        </Text>
        <TouchableOpacity onPress={onSelectCalendar} activeOpacity={0.82}>
          <Text style={[styles.sectionLink, { color: colors.text }]}>
            Open calendar
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.timelineRow}>
        {items.map((item) => {
          const tone = toneForState(item.state, colors, accentBg);
          return (
            <TouchableOpacity
              key={`${item.day}-${item.isoDate}`}
              style={[styles.timelineItem, { backgroundColor: tone.fill }]}
              onPress={item.state === "today" ? onSelectToday : onSelectCalendar}
              activeOpacity={0.84}
            >
              <Text style={[styles.timelineDay, { color: tone.meta }]}>
                {item.day}
              </Text>
              <Text style={[styles.timelineDate, { color: tone.text }]}>
                {item.date}
              </Text>
              <Text style={[styles.timelineLabel, { color: tone.meta }]} numberOfLines={2}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
