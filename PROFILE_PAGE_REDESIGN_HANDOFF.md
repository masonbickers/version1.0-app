
## 1. Current You/Profile Page

### app/(protected)/me.jsx

```jsx
import { useRouter } from "expo-router";
import { createContext, useContext, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import Feather from "../components/LucideFeather";
import { useTheme } from "../../providers/ThemeProvider";
import { useMePageData } from "../../src/hooks/useMePageData";

const DARK_PAGE_COLORS = {
  bg: "#000000",
  surface: "#070806",
  band: "#101406",
  line: "rgba(230,255,59,0.12)",
  faintLine: "rgba(255,255,255,0.07)",
  text: "#F2F4EE",
  muted: "#A7ABA0",
  soft: "#5F6646",
  orange: "#E6FF3B",
  orangeSoft: "rgba(230,255,59,0.18)",
  purple: "#8FAF2E",
  purpleSoft: "rgba(143,175,46,0.18)",
  primaryText: "#111111",
};

function makePageColors(appColors, isDark) {
  if (isDark) return DARK_PAGE_COLORS;
  return {
    bg: appColors.bg || "#EFEFEF",
    surface: appColors.card || "#FAFAFA",
    band: appColors.surfaceAlt || "#F3F3F3",
    line: appColors.divider || "#D1D1D1",
    faintLine: "rgba(17,17,17,0.08)",
    text: appColors.text || "#0B0B0B",
    muted: appColors.subtext || "#555555",
    soft: appColors.borderStrong || "#9E9E9E",
    orange: appColors.sapPrimary || "#E6FF3B",
    orangeSoft: "rgba(230,255,59,0.34)",
    purple: "#6F8E28",
    purpleSoft: "rgba(111,142,40,0.16)",
    primaryText: appColors.sapOnPrimary || "#111111",
  };
}

const YouThemeContext = createContext({
  c: DARK_PAGE_COLORS,
  s: null,
});

function useYouTheme() {
  return useContext(YouThemeContext);
}

export default function MePage() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors: appColors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState("progress");
  const {
    loading,
    error,
    profile,
    progress,
    recentActivities,
    integrationRows,
    refresh,
  } = useMePageData();

  const metrics = useMemo(() => buildMetrics(progress, recentActivities), [progress, recentActivities]);
  const activityFeed = useMemo(() => buildActivityFeed(recentActivities), [recentActivities]);
  const chartWidth = Math.max(260, Math.min(width - 44, 380));
  const c = useMemo(() => makePageColors(appColors, isDark), [appColors, isDark]);
  const s = useMemo(() => makeStyles(c), [c]);

  return (
    <YouThemeContext.Provider value={{ c, s }}>
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity style={s.avatarWrap} onPress={() => router.push("/profile")}>
          {profile?.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={s.avatar} />
          ) : (
            <Text style={s.avatarInitial}>{initialFor(profile?.name)}</Text>
          )}
        </TouchableOpacity>

        <Text style={s.headerTitle}>You</Text>

        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconButton} onPress={() => router.push("/record")}>
            <Feather name="plus-circle" size={24} color={c.text} strokeWidth={2.1} />
          </TouchableOpacity>
          <TouchableOpacity style={s.iconButton} onPress={() => router.push("/settings")}>
            <Feather name="sliders" size={22} color={c.text} strokeWidth={2.1} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.tabs}>
        <TouchableOpacity style={s.tab} onPress={() => setActiveTab("progress")}>
          <Text style={activeTab === "progress" ? s.tabActiveText : s.tabText}>Progress</Text>
          {activeTab === "progress" && <View style={s.tabActiveLine} />}
        </TouchableOpacity>
        <TouchableOpacity style={s.tab} onPress={() => setActiveTab("activities")}>
          <Text style={activeTab === "activities" ? s.tabActiveText : s.tabText}>Activities</Text>
          {activeTab === "activities" && <View style={s.tabActiveLine} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={c.orange} />
            <Text style={s.loadingText}>Loading progress</Text>
          </View>
        ) : (
          <>
            {!!error && (
              <TouchableOpacity style={s.errorBand} onPress={refresh}>
                <Text style={s.errorText}>{error}</Text>
                <Text style={s.orangeLink}>Retry</Text>
              </TouchableOpacity>
            )}

            {activeTab === "activities" ? (
              <ActivitiesTab profile={profile} activities={activityFeed} />
            ) : (
              <ProgressTab
                chartWidth={chartWidth}
                integrationRows={integrationRows}
                metrics={metrics}
                router={router}
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </YouThemeContext.Provider>
  );
}

function Section({ children, flush = false, icon, title }) {
  const { c, s } = useYouTheme();
  return (
    <View style={[s.section, flush && s.flushSection]}>
      {!!title && (
        <View style={s.titleRow}>
          {!!icon && (
            <View style={s.brandMark}>
          <Feather name={icon} size={15} color={c.orange} strokeWidth={2.4} />
            </View>
          )}
          <Text style={s.sectionTitle}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

function ProgressTab({ chartWidth, integrationRows, metrics, router }) {
  const { c, s } = useYouTheme();
  return (
    <>
      <InstantWorkoutSection />
      <SportPills />

      <Section flush>
        <Text style={s.sectionTitle}>This week</Text>
        <MetricRow
          items={[
            ["Distance", formatKm(metrics.weekDistance)],
            ["Time", formatDuration(metrics.weekMinutes)],
            ["Elev Gain", `${metrics.elevationGain} m`],
          ]}
        />
        <Text style={s.chartLabel}>Past 12 weeks</Text>
        <ProgressAreaChart width={chartWidth} values={metrics.distanceTrend} />
        <TouchableOpacity style={s.primaryButton} onPress={() => router.push("/me/this-week")}>
          <Text style={s.primaryButtonText}>See more of your progress</Text>
        </TouchableOpacity>
      </Section>

      <Section>
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitle}>{metrics.monthLabel}</Text>
          <TouchableOpacity style={s.shareButton}>
            <Feather name="cloud" size={18} color={c.text} />
            <Text style={s.shareText}>Share</Text>
          </TouchableOpacity>
        </View>
        <View style={s.streakStats}>
          <View>
            <Text style={s.muted}>Your Streak</Text>
            <Text style={s.statValue}>{metrics.streakLabel}</Text>
          </View>
          <View>
            <Text style={s.muted}>Streak Activities</Text>
            <Text style={s.statValue}>{metrics.monthActivities}</Text>
          </View>
        </View>
        <StreakCalendar activeDays={metrics.activeDays} today={metrics.todayDate} />
      </Section>

      <Section icon="activity" title="Performance Predictions">
        <Text style={s.bodyText}>
          Tap below to see 5K, 10K, half, and full marathon predictions and how they have changed over time.
        </Text>
        <PredictionRow prediction={metrics.fiveKPrediction} />
        <Text style={s.sectionCta}>See more distances and trends</Text>
      </Section>

      <Section icon="activity" title="Relative Effort">
        <Text style={s.bodyText}>
          Your cumulative training load this week based on heart rate or perceived exertion.
        </Text>
        <RelativeEffortChart width={chartWidth} value={metrics.relativeEffort} />
        <Text style={s.sectionCta}>Compare effort for up to 3 months</Text>
      </Section>

      <Section icon="activity" title="Fitness">
        <Text style={s.bodyText}>Your training and recovery added up over time.</Text>
        <FitnessChart width={chartWidth} value={metrics.fitnessScore} />
      </Section>

      <Section icon="target" title="Goals">
        <View style={s.goalRow}>
          <ProgressRing progress={metrics.goalProgress} />
          <View style={s.goalCopy}>
            <Text style={s.goalTitle}>This week • {formatKm(metrics.goalRemaining)} to go</Text>
            <Text style={s.bodyText}>
              {formatKm(metrics.weekDistance)} / {formatKm(metrics.weekGoal)} run
            </Text>
          </View>
        </View>
        <View style={s.linkRow}>
          <Text style={s.sectionCta}>Add Goal</Text>
          <Text style={s.sectionCta}>See All Your Goals</Text>
        </View>
      </Section>

      <Section icon="activity" title="Training Zones">
        <Text style={s.bodyText}>
          See how hard you worked vs. recovered with your heart rate, power and pace zones.
        </Text>
        <TrainingZones />
        <Text style={s.sectionCta}>See more zone data</Text>
      </Section>

      <Section icon="award" title="Best Efforts">
        <Text style={s.bodyText}>See your personal records and trends over time.</Text>
        <BestEfforts prediction={metrics.fiveKPrediction} />
        <Text style={s.sectionCta}>View all your Best Efforts</Text>
      </Section>

      <Section icon="activity" title="Training Log">
        <Text style={s.bodyText}>See patterns in your training history.</Text>
        <TrainingLogDots />
        <Text style={s.sectionCta}>See more of your training</Text>
      </Section>

      <Section flush>
        <MonthRecap month={metrics.monthName} year={metrics.yearLabel} />
      </Section>

      <Section icon="activity" title="Monthly Activities">
        <Text style={s.bodyText}>
          You have done {metrics.monthActivities} activities so far this month.
        </Text>
        <MetricRow
          items={[
            ["Active Time", formatDuration(metrics.monthMinutes)],
            ["Distance", formatKm(metrics.monthDistance)],
          ]}
        />
        <Text style={s.sectionCta}>See more of your {metrics.monthName} stats...</Text>
      </Section>

      <Section flush>
        <Text style={s.sectionTitle}>Data Sources</Text>
        <Text style={s.bodyText}>Here is where your activities came from in the last 30 days</Text>
        <DataSources rows={integrationRows} />
        <Text style={s.sectionCta}>Manage Apps & Devices</Text>
      </Section>
    </>
  );
}

function ActivitiesTab({ activities, profile }) {
  const { c, s } = useYouTheme();
  return (
    <View style={s.activitiesPage}>
      <View style={s.searchBar}>
        <Feather name="eye" size={18} color={c.muted} />
        <Text style={s.searchPlaceholder}>Search and filter your activities</Text>
      </View>
      <View style={s.activityFeed}>
        {activities.map((activity) => (
          <ActivityFeedItem key={activity.id} activity={activity} profile={profile} />
        ))}
      </View>
    </View>
  );
}

function ActivityFeedItem({ activity, profile }) {
  const { c, s } = useYouTheme();
  return (
    <View style={s.activityCard}>
      <View style={s.activityAuthorRow}>
        <View style={s.activityAvatarWrap}>
          {profile?.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={s.avatar} />
          ) : (
            <Text style={s.avatarInitial}>{initialFor(profile?.name)}</Text>
          )}
        </View>
        <View style={s.activityAuthorCopy}>
          <Text style={s.activityAuthorName}>{profile?.name || "Mason bickers"}</Text>
          <View style={s.activityMetaRow}>
            <Feather name={activity.icon} size={16} color={c.text} />
            <Text style={s.activityMetaText} numberOfLines={1}>{activity.whenLabel} • Garmin Forerunner 255S Music</Text>
          </View>
        </View>
      </View>

      <Text style={s.activityTitle}>{activity.title}</Text>
      {!!activity.note && <Text style={s.activityNote}>{activity.note}</Text>}

      <View style={s.activityStats}>
        {activity.stats.map(([label, value]) => (
          <View key={label} style={s.activityStat}>
            <Text style={s.activityStatLabel}>{label}</Text>
            <Text style={s.activityStatValue}>{value}</Text>
          </View>
        ))}
      </View>

      {!!activity.kudos && (
        <View style={s.kudosRow}>
          <View style={s.kudosAvatar} />
          <Text style={s.activityMetaText}>{activity.kudos} gave kudos</Text>
        </View>
      )}

      <View style={s.activityActions}>
        <Feather name="check" size={28} color={c.text} />
        <Feather name="message-circle" size={28} color={c.text} />
        <Feather name="cloud" size={28} color={c.text} />
      </View>
    </View>
  );
}

function InstantWorkoutSection() {
  const { c, s } = useYouTheme();
  return (
    <Section flush>
      <View style={s.sectionHeaderRow}>
        <View style={s.titleRow}>
          <View style={s.brandMark}>
            <Feather name="zap" size={15} color={c.orange} />
          </View>
          <Text style={s.smallSectionTitle}>Instant Workouts</Text>
        </View>
        <Text style={s.sectionCta}>See all</Text>
      </View>
      <View style={s.workoutRow}>
        <View style={s.workoutThumb}>
          <Feather name="activity" size={24} color={c.text} />
          <Text style={s.workoutDuration}>30m</Text>
        </View>
        <View style={s.workoutCopy}>
          <Text style={s.workoutTitle}>Full Body Circuit Training</Text>
          <Text style={s.workoutDesc} numberOfLines={2}>
            Stay strong and balanced with full-body circuit training.
          </Text>
        </View>
        <Feather name="chevron-right" size={24} color={c.text} />
      </View>
    </Section>
  );
}

function SportPills() {
  const { c, s } = useYouTheme();
  const pills = [
    ["Run", "activity", true],
    ["Weight Training", "zap"],
    ["Walk", "map-pin"],
    ["Ride", "wind"],
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.pillRail}
    >
      {pills.map(([label, icon, active]) => (
        <View key={label} style={[s.pill, active && s.pillActive]}>
          <Feather name={icon} size={17} color={active ? c.orange : c.text} />
          <Text style={[s.pillText, active && s.pillTextActive]}>{label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function MetricRow({ items }) {
  const { s } = useYouTheme();
  return (
    <View style={s.metricRow}>
      {items.map(([label, value]) => (
        <View key={label} style={s.metricItem}>
          <Text style={s.metricLabel}>{label}</Text>
          <Text style={s.metricValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function PredictionRow({ prediction }) {
  const { s } = useYouTheme();
  return (
    <View style={s.predictionRow}>
      <View style={s.predictionBadge}>
        <Text style={s.predictionBadgeText}>5K</Text>
      </View>
      <View style={s.predictionMain}>
        <Text style={s.predictionTime}>{prediction}</Text>
        <Text style={s.bodyText}>Maintaining over last 30 days</Text>
      </View>
      <View style={s.maintainingBadge}>
        <Text style={s.maintainingText}>Maintaining</Text>
      </View>
    </View>
  );
}

function BestEfforts({ prediction }) {
  const { s } = useYouTheme();
  const rows = [
    ["Biggest Climb", "27 m", "Apr 11, 2026", "wind", "#7f8c8d"],
    ["2 mile", "12:16", "Feb 14, 2026", "activity", "#c9692c"],
    ["5K", prediction, "Jan 24, 2026", "activity", "#f2a900"],
  ];

  return (
    <View style={s.bestEfforts}>
      {rows.map(([label, value, date, icon, color]) => (
        <View key={label} style={s.bestRow}>
          <View style={[s.medal, { backgroundColor: color }]}>
            <Feather name={icon} size={21} color="#000" />
          </View>
          <View style={s.bestCopy}>
            <Text style={s.bestTitle}>{label}</Text>
            <Text style={s.bestDate}>{date}</Text>
          </View>
          <Text style={s.bestValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function DataSources({ rows }) {
  const { c, s } = useYouTheme();
  const normalized = rows?.length ? rows : [];
  return (
    <View style={s.sources}>
      {normalized.map((row) => (
        <View key={row.key} style={s.sourceRow}>
          <Feather name={row.key === "garmin" ? "watch" : "link"} size={28} color={c.text} />
          <View style={s.sourceCopy}>
            <Text style={s.sourceTitle}>{row.label}</Text>
            <Text style={s.sourceMeta}>{row.value} • {row.meta}</Text>
          </View>
        </View>
      ))}
      <View style={s.sourceRow}>
        <Feather name="link" size={28} color={c.text} />
        <View style={s.sourceCopy}>
          <Text style={s.sourceTitle}>Connect a new device</Text>
          <Text style={s.sourceMeta}>Use your GPS device to upload activities</Text>
        </View>
        <Feather name="chevron-right" size={22} color={c.muted} />
      </View>
    </View>
  );
}

function ProgressAreaChart({ width, values }) {
  const { c, s } = useYouTheme();
  const height = 118;
  const points = pointsFor(values, width, height, 8);
  const area = `${linePath(points)} L ${width - 8} ${height - 18} L 8 ${height - 18} Z`;

  return (
    <View style={s.chartWrap}>
      <Svg width={width} height={height}>
        <Line x1="8" y1="38" x2={width - 8} y2="38" stroke={c.line} strokeWidth="1" />
        <Line x1="8" y1="88" x2={width - 8} y2="88" stroke={c.line} strokeWidth="1" />
        <Path d={area} fill={c.orangeSoft} />
        <Path d={linePath(points)} fill="none" stroke={c.orange} strokeWidth="4" />
        {points.map((point, index) => (
          <Circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={index === points.length - 1 ? 7 : 5}
            fill={c.bg}
            stroke={c.orange}
            strokeWidth="4"
          />
        ))}
      </Svg>
      <View style={s.chartAxis}>
        <Text style={s.axisLabel}>MAR</Text>
        <Text style={s.axisLabel}>APR</Text>
      </View>
    </View>
  );
}

function RelativeEffortChart({ width, value }) {
  const { c, s } = useYouTheme();
  const height = 148;
  const thisWeek = [14, 21, 29, value];
  const lastWeek = [28, 40, 62, 82, 98, 124, 130];
  const purplePoints = pointsFor(thisWeek, width, height - 38, 14, 130);
  const grayPoints = pointsFor(lastWeek, width, height - 38, 14, 130);
  const current = purplePoints[purplePoints.length - 1];

  return (
    <View style={s.chartWrap}>
      <Svg width={width} height={height}>
        <Rect x="24" y="38" width={width - 48} height="56" fill={c.purpleSoft} />
        <Line x1="24" y1="38" x2={width - 24} y2="38" stroke={c.purple} strokeWidth="3" strokeDasharray="7 5" />
        <Line x1="24" y1="94" x2={width - 24} y2="94" stroke={c.purple} strokeWidth="3" strokeDasharray="7 5" />
        <Path d={linePath(grayPoints)} fill="none" stroke="#747474" strokeWidth="3" />
        <Path d={linePath(purplePoints)} fill="none" stroke={c.purple} strokeWidth="5" />
        <Circle cx={current.x} cy={current.y} r="13" fill={c.purple} />
        <Circle cx={current.x} cy={current.y} r="25" fill="rgba(230,255,59,0.14)" />
      </Svg>
      <View style={s.weekDays}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <Text key={day} style={s.axisLabel}>{day}</Text>
        ))}
      </View>
    </View>
  );
}

function FitnessChart({ width, value }) {
  const { c, s } = useYouTheme();
  const height = 150;
  const values = [57, 56, 58, 57, 59, 56, 58, 57, 55, 58, 59, 56, 58, 59, 61, 60, 59, 60, 59, 59, 57, 56, value];
  const points = pointsFor(values, width, height - 24, 12, 72);
  const last = points[points.length - 1];

  return (
    <View style={s.chartWrap}>
      <Svg width={width} height={height}>
        {points.map((point, index) => (
          <Line
            key={index}
            x1={point.x}
            y1={height - 22}
            x2={point.x}
            y2={point.y}
            stroke="rgba(230,255,59,0.18)"
            strokeWidth="5"
          />
        ))}
        <Path d={linePath(points)} fill="none" stroke={c.orange} strokeWidth="4" />
        <Circle cx={last.x} cy={last.y} r="7" fill={c.orange} />
      </Svg>
      <View style={s.chartAxis}>
        <Text style={s.axisLabel}>23 mar</Text>
        <Text style={s.axisLabel}>Today</Text>
      </View>
    </View>
  );
}

function StreakCalendar({ activeDays, today }) {
  const { c, s } = useYouTheme();
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const cells = Array.from({ length: 35 }, (_, index) => index + 1);

  return (
    <View style={s.calendar}>
      <View style={s.calendarWeek}>
        {days.map((day, index) => (
          <Text key={`${day}-${index}`} style={s.calendarDay}>{day}</Text>
        ))}
      </View>
      <View style={s.calendarGrid}>
        {cells.map((day) => {
          const active = activeDays.includes(day);
          const isToday = day === today;
          return (
            <View
              key={day}
              style={[
                s.calendarCell,
                active && s.calendarCellActive,
                isToday && s.calendarCellToday,
              ]}
            >
              {active ? (
                <Feather name={day % 5 === 0 ? "zap" : "activity"} size={18} color={c.bg} />
              ) : (
                <Text style={[s.calendarNumber, isToday && s.calendarNumberToday]}>{day}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ProgressRing({ progress }) {
  const { c, s } = useYouTheme();
  const clamped = clamp(progress, 0, 1);
  return (
    <View style={s.ring}>
      <Svg width={54} height={54}>
        <Circle cx="27" cy="27" r="22" stroke={c.line} strokeWidth="5" fill="none" />
        <Circle
          cx="27"
          cy="27"
          r="22"
          stroke={c.orange}
          strokeWidth="5"
          fill="none"
          strokeDasharray={`${clamped * 138} 138`}
          strokeLinecap="round"
          rotation="-90"
          origin="27, 27"
        />
      </Svg>
      <Feather name="activity" size={15} color={c.text} style={s.ringIcon} />
    </View>
  );
}

function TrainingZones() {
  const { s } = useYouTheme();
  const bars = [24, 42, 58, 84, 32];
  return (
    <View style={s.zoneWrap}>
      <View>
        <Text style={s.muted}>Most Time</Text>
        <Text style={s.zoneValue}>53% in Z 2</Text>
      </View>
      <View style={s.zoneBars}>
        {bars.map((width, index) => (
          <View
            key={index}
            style={[
              s.zoneBar,
              { width: `${width}%`, backgroundColor: `rgba(230,255,59,${0.14 + index * 0.09})` },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function TrainingLogDots() {
  const { s } = useYouTheme();
  return (
    <View style={s.logDots}>
      {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
        <View key={`${day}-${index}`} style={s.logColumn}>
          <View style={[s.logDot, index % 3 === 0 && s.logDotOrange, index === 1 && s.logDotLarge]} />
          <Text style={s.axisLabel}>{day}</Text>
        </View>
      ))}
    </View>
  );
}

function MonthRecap({ month, year }) {
  const { s } = useYouTheme();
  return (
    <View style={s.recap}>
      <View>
        <Text style={s.recapMonth}>{month}</Text>
        <Text style={s.recapYear}>{year}</Text>
      </View>
      <View style={s.recapBars}>
        {[58, 76, 66, 55, 53, 61, 72, 69, 75, 77, 73, 82].map((height, index) => (
          <View
            key={index}
            style={[s.recapBar, index === 11 && s.recapBarActive, { height }]}
          />
        ))}
      </View>
    </View>
  );
}

function buildMetrics(progress, recentActivities) {
  const weekly = progress?.weekly || {};
  const monthly = progress?.monthly || {};
  const weekDistance = toNum(weekly.distanceKm);
  const weekMinutes = toNum(weekly.timeMin);
  const monthDistance = toNum(monthly.distanceKm);
  const monthMinutes = toNum(monthly.timeMin);
  const monthActivities = Math.max(toNum(monthly.workouts), recentActivities?.length || 0);
  const activeDays14 = Math.max(toNum(progress?.activeDays14), toNum(weekly.workouts));
  const weekGoal = Math.max(40, Math.ceil(weekDistance / 5) * 5 || 40);
  const goalRemaining = Math.max(0, weekGoal - weekDistance);
  const now = new Date();

  return {
    weekDistance,
    weekMinutes,
    monthDistance,
    monthMinutes,
    monthActivities,
    elevationGain: 0,
    monthName: now.toLocaleDateString("en-GB", { month: "long" }),
    yearLabel: String(now.getFullYear()),
    monthLabel: now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    todayDate: now.getDate(),
    streakLabel: activeDays14 ? `${activeDays14} Days` : "0 Days",
    activeDays: buildActiveDays(activeDays14, now.getDate()),
    distanceTrend: buildDistanceTrend(weekDistance),
    fiveKPrediction: predictFiveK(weekDistance, weekMinutes),
    relativeEffort: Math.max(28, Math.min(118, Math.round(weekMinutes / 3 || 50))),
    fitnessScore: Math.max(42, Math.min(72, Math.round(52 + weekDistance / 4))),
    weekGoal,
    goalRemaining,
    goalProgress: weekGoal ? weekDistance / weekGoal : 0,
  };
}

function buildActivityFeed(recentActivities) {
  const source = recentActivities?.length ? recentActivities : [];
  const mapped = source.map((activity, index) => {
    const type = String(activity.type || activity.sport_type || "Workout");
    const distanceKm = readDistanceKm(activity);
    const minutes = readMovingMinutes(activity);
    const pace = distanceKm > 0 && minutes > 0 ? formatPace(minutes / distanceKm) : "";
    const isStrength = /weight|strength|gym/i.test(type) || (!distanceKm && minutes >= 45);
    const title = activity.name || activity.title || (isStrength ? "Afternoon Weight Training" : type === "Walk" ? "Incline Walk" : `${type} Activity`);
    const stats = isStrength
      ? [
          ["Time", formatLongDuration(minutes || 75)],
          ["Avg HR", `${Math.round(toNum(activity.average_heartrate || activity.averageHeartRate, 122))} bpm`],
          ["Cal", `${Math.round(toNum(activity.calories || activity.kilojoules, 616))} Cal`],
        ]
      : [
          ["Distance", formatKm(distanceKm || 1.93)],
          ["Pace", pace || "15:31 /km"],
          ["Time", formatLongDuration(minutes || 30)],
        ];

    return {
      id: activity.id || `activity-${index}`,
      icon: isStrength ? "zap" : type === "Walk" ? "map-pin" : "activity",
      kudos: index === 0 ? 1 : 0,
      note: activity.description || activity.note || (type === "Walk" ? "Legs cooked" : ""),
      stats,
      title,
      whenLabel: activity.whenLabel || formatActivityDate(activity.startDateMs || activity.startDate || activity.when, index),
    };
  });

  if (mapped.length >= 3) return mapped;
  return [
    ...mapped,
    {
      id: "sample-strength",
      icon: "zap",
      kudos: 1,
      note: "",
      stats: [["Time", "1h 15m"], ["Avg HR", "122 bpm"], ["Cal", "616 Cal"]],
      title: "Afternoon Weight Training",
      whenLabel: "Yesterday at 5:46 PM",
    },
    {
      id: "sample-walk",
      icon: "map-pin",
      kudos: 0,
      note: "Legs cooked",
      stats: [["Distance", "1.93 km"], ["Pace", "15:31 /km"], ["Time", "30m 4s"]],
      title: "Incline Walk",
      whenLabel: "April 21, 2026 at 7:33 PM",
    },
    {
      id: "sample-strength-2",
      icon: "zap",
      kudos: 0,
      note: "",
      stats: [["Time", "52m"], ["Avg HR", "118 bpm"], ["Cal", "420 Cal"]],
      title: "Evening Weight Training",
      whenLabel: "April 21, 2026 at 6:36 PM",
    },
  ].slice(0, 4);
}

function readDistanceKm(activity) {
  return toNum(
    activity.distanceKm ??
      (toNum(activity.distance, 0) > 1000 ? activity.distance / 1000 : activity.distance),
    0
  );
}

function readMovingMinutes(activity) {
  return Math.round(
    toNum(activity.movingTimeMin ?? activity.moving_time / 60 ?? activity.movingTime / 60, 0)
  );
}

function buildActiveDays(count, today) {
  if (!count) return [];
  const days = [];
  for (let i = 0; i < Math.min(count, 20); i += 1) {
    days.push(Math.max(1, today - i * 2));
  }
  return days;
}

function buildDistanceTrend(current) {
  const base = Math.max(toNum(current), 8);
  return [0.52, 0.72, 0.71, 0.83, 0.66, 0.98, 0.96, 0.96, 0.92, 0.93, 0.95, current > 0 ? current / base : 0.2].map(
    (value) => Math.max(0.5, value * base)
  );
}

function predictFiveK(distance, minutes) {
  if (distance > 0 && minutes > 0) {
    const pace = minutes / distance;
    const total = Math.max(15, Math.round(pace * 5));
    return `${total}:00`;
  }
  return "18:05";
}

function pointsFor(values, width, height, pad = 10, forcedMax) {
  const max = Math.max(forcedMax || 0, ...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = (width - pad * 2) / Math.max(1, values.length - 1);

  return values.map((value, index) => ({
    x: pad + index * step,
    y: pad + (1 - (value - min) / span) * (height - pad * 2),
  }));
}

function linePath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function formatKm(value) {
  return `${toNum(value).toFixed(1)} km`;
}

function formatDuration(minutes) {
  const mins = Math.round(toNum(minutes));
  if (mins <= 0) return "0m";
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (!hours) return `${rem}m`;
  return `${hours}h ${rem}m`;
}

function formatLongDuration(minutes) {
  const mins = Math.round(toNum(minutes));
  if (mins <= 0) return "0m";
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (!hours) return `${rem}m`;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatPace(minutesPerKm) {
  const totalSeconds = Math.round(toNum(minutesPerKm) * 60);
  if (!totalSeconds) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds} /km`;
}

function formatActivityDate(value, index) {
  const ms = toMillis(value);
  if (!ms) return index === 0 ? "Yesterday at 5:46 PM" : "April 21, 2026 at 7:33 PM";
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  const time = date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString("en-GB", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })} at ${time}`;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function initialFor(name) {
  const text = String(name || "You").trim();
  return text.charAt(0).toUpperCase() || "Y";
}

function makeStyles(c) {
  return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: c.bg,
  },
  header: {
    height: 64,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatarWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: c.orange,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.band,
    overflow: "hidden",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  avatarInitial: {
    color: c.text,
    fontSize: 14,
    fontWeight: "900",
  },
  headerTitle: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: c.text,
    fontSize: 22,
    fontWeight: "900",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  tabs: {
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    flexDirection: "row",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActiveText: {
    color: c.text,
    fontSize: 15,
    fontWeight: "900",
  },
  tabText: {
    color: c.muted,
    fontSize: 15,
    fontWeight: "800",
  },
  tabActiveLine: {
    position: "absolute",
    bottom: -1,
    height: 3,
    left: 0,
    right: 0,
    backgroundColor: c.orange,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 140,
  },
  loadingWrap: {
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: c.muted,
    fontSize: 15,
  },
  errorBand: {
    margin: 22,
    padding: 16,
    borderRadius: 8,
    backgroundColor: c.band,
    borderWidth: 1,
    borderColor: c.line,
    gap: 10,
  },
  errorText: {
    color: c.text,
    fontSize: 15,
    lineHeight: 21,
  },
  section: {
    paddingHorizontal: 18,
    paddingVertical: 22,
    borderTopWidth: 1,
    borderTopColor: c.faintLine,
    backgroundColor: c.bg,
    gap: 16,
  },
  flushSection: {
    borderTopWidth: 0,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: c.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    color: c.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
  },
  smallSectionTitle: {
    color: c.text,
    fontSize: 17,
    fontWeight: "800",
  },
  sectionCta: {
    color: c.orange,
    fontSize: 13,
    fontWeight: "800",
  },
  workoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
  },
  workoutThumb: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: "#526719",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  workoutDuration: {
    color: c.text,
    fontSize: 13,
    fontWeight: "900",
  },
  workoutCopy: {
    flex: 1,
    gap: 8,
  },
  workoutTitle: {
    color: c.text,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 22,
  },
  workoutDesc: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  pillRail: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 7,
    borderTopColor: c.faintLine,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  pill: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: c.soft,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pillActive: {
    borderColor: c.orange,
  },
  pillText: {
    color: c.text,
    fontSize: 12,
    fontWeight: "700",
  },
  pillTextActive: {
    color: c.orange,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  metricItem: {
    flex: 1,
    gap: 5,
  },
  metricLabel: {
    color: c.muted,
    fontSize: 12,
  },
  metricValue: {
    color: c.text,
    fontSize: 22,
    fontWeight: "900",
  },
  chartLabel: {
    color: c.text,
    fontSize: 13,
    fontWeight: "700",
  },
  chartWrap: {
    alignItems: "center",
    gap: 8,
  },
  chartAxis: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-around",
  },
  axisLabel: {
    color: c.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  primaryButton: {
    height: 46,
    borderRadius: 16,
    backgroundColor: c.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "900",
  },
  shareButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1.4,
    borderColor: c.soft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shareText: {
    color: c.text,
    fontSize: 13,
    fontWeight: "800",
  },
  streakStats: {
    flexDirection: "row",
    gap: 34,
  },
  muted: {
    color: c.muted,
    fontSize: 12,
  },
  statValue: {
    color: c.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  calendar: {
    gap: 12,
  },
  calendarWeek: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  calendarDay: {
    width: 37,
    textAlign: "center",
    color: c.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  calendarCell: {
    width: 37,
    height: 37,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.band,
  },
  calendarCellActive: {
    backgroundColor: c.text,
    borderColor: c.text,
  },
  calendarCellToday: {
    borderColor: c.text,
    borderWidth: 1.6,
  },
  calendarNumber: {
    color: c.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  calendarNumberToday: {
    color: c.text,
  },
  bodyText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  predictionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  predictionBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: c.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  predictionBadgeText: {
    color: c.orange,
    fontSize: 17,
    fontWeight: "900",
  },
  predictionMain: {
    flex: 1,
  },
  predictionTime: {
    color: c.text,
    fontSize: 24,
    fontWeight: "900",
  },
  maintainingBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: c.orangeSoft,
  },
  maintainingText: {
    color: c.orange,
    fontSize: 11,
    fontWeight: "800",
  },
  weekDays: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ring: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ringIcon: {
    position: "absolute",
  },
  goalCopy: {
    flex: 1,
    gap: 4,
  },
  goalTitle: {
    color: c.text,
    fontSize: 16,
    fontWeight: "900",
  },
  linkRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 20,
  },
  zoneWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  zoneValue: {
    color: c.text,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 8,
  },
  zoneBars: {
    flex: 1,
    gap: 8,
  },
  zoneBar: {
    height: 12,
    borderRadius: 4,
  },
  bestEfforts: {
    gap: 20,
  },
  bestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  medal: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  bestCopy: {
    flex: 1,
    gap: 5,
  },
  bestTitle: {
    color: c.text,
    fontSize: 16,
    fontWeight: "800",
  },
  bestDate: {
    color: c.muted,
    fontSize: 13,
  },
  bestValue: {
    color: c.text,
    fontSize: 16,
    fontWeight: "800",
  },
  logDots: {
    height: 108,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  logColumn: {
    alignItems: "center",
    gap: 24,
  },
  logDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.muted,
  },
  logDotOrange: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: c.orange,
  },
  logDotLarge: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  recap: {
    minHeight: 170,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recapMonth: {
    color: c.orange,
    fontSize: 38,
    fontWeight: "300",
  },
  recapYear: {
    color: c.muted,
    fontSize: 38,
    fontWeight: "300",
  },
  recapBars: {
    height: 104,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  recapBar: {
    width: 3,
    backgroundColor: c.soft,
  },
  recapBarActive: {
    backgroundColor: c.orange,
  },
  sources: {
    gap: 26,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sourceCopy: {
    flex: 1,
    gap: 5,
  },
  sourceTitle: {
    color: c.text,
    fontSize: 15,
    fontWeight: "700",
  },
  sourceMeta: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  activitiesPage: {
    backgroundColor: c.bg,
  },
  searchBar: {
    marginHorizontal: 18,
    marginTop: 18,
    marginBottom: 8,
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 16,
    backgroundColor: c.band,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchPlaceholder: {
    color: c.muted,
    fontSize: 16,
    fontWeight: "500",
  },
  activityFeed: {
    paddingTop: 8,
  },
  activityCard: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 22,
    borderBottomWidth: 7,
    borderBottomColor: c.faintLine,
    backgroundColor: c.bg,
    gap: 18,
  },
  activityAuthorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  activityAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: c.orange,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.band,
    overflow: "hidden",
  },
  activityAuthorCopy: {
    flex: 1,
    gap: 4,
  },
  activityAuthorName: {
    color: c.text,
    fontSize: 16,
    fontWeight: "900",
  },
  activityMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  activityMetaText: {
    color: c.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  activityTitle: {
    color: c.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
  },
  activityNote: {
    color: c.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: -8,
  },
  activityStats: {
    flexDirection: "row",
    gap: 28,
  },
  activityStat: {
    minWidth: 74,
    gap: 4,
  },
  activityStatLabel: {
    color: c.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  activityStatValue: {
    color: c.text,
    fontSize: 21,
    fontWeight: "900",
  },
  kudosRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  kudosAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.soft,
  },
  activityActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
  },
  orangeLink: {
    color: c.orange,
    fontSize: 13,
    fontWeight: "800",
  },
  });
}

```


## 2. Tab / Navigation Setup

### app/_layout.jsx

```jsx
// app/_layout.jsx
import { Stack } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";

import { AuthProvider } from "../providers/AuthProvider";
import { LiveActivityProvider } from "../providers/LiveActivityProvider";
import { ThemeProvider } from "../providers/ThemeProvider";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[root-startup-error]", error, info?.componentStack || "");
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#050506" }}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "800" }}>
            Startup error
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.78)", textAlign: "center" }}>
            The app hit an error while loading. Please relaunch after updating.
          </Text>
          <Text style={{ color: "#E6FF3B", textAlign: "center" }}>
            {String(this.state.error?.message || this.state.error || "Unknown error")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
}

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RootErrorBoundary>
        <ThemeProvider>
          <AuthProvider>
            <LiveActivityProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </LiveActivityProvider>
          </AuthProvider>
        </ThemeProvider>
      </RootErrorBoundary>
    </SafeAreaProvider>
  );
}

```

### app/(protected)/_layout.jsx

```jsx
// app/(protected)/_layout.jsx
import { LinearGradient } from "expo-linear-gradient";
import { doc, getDoc } from "firebase/firestore";
import {
  Redirect,
  Slot,
  useRootNavigationState,
  useSegments,
} from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import Footer from "../components/Footer";

export default function ProtectedLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const nav = useRootNavigationState();
  const segments = useSegments();
  const [deadman, setDeadman] = useState(false);
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [welcomeLoading, setWelcomeLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDeadman(true), 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let active = true;

    if (!user?.uid) {
      setNeedsWelcome(false);
      setWelcomeLoading(false);
      return () => {
        active = false;
      };
    }

    setWelcomeLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const welcomeSeen = snap.exists() ? snap.data()?.welcomeSeen : undefined;
        if (active) {
          // only explicit false should trigger onboarding
          setNeedsWelcome(welcomeSeen === false);
        }
      } catch (e) {
        console.warn("welcome check failed:", e?.message || e);
        if (active) setNeedsWelcome(false);
      } finally {
        if (active) setWelcomeLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  const isWelcomeRoute =
    segments?.[0] === "(protected)" && segments?.[1] === "welcome";

  const isTrainCreateFlow =
    segments?.[0] === "(protected)" &&
    ((segments?.[1] === "train" &&
      (segments?.[2] === "create-home" ||
        segments?.[2] === "create" ||
        segments?.[2] === "create-workout")) ||
      (segments?.[1] === "training" && segments?.[2] === "create"));

  // ✅ decide which routes should NOT show the footer
  const hideFooter = useMemo(() => {
    // segments example:
    // ["(protected)", "nutrition", "today"]
    const s0 = segments?.[0];
    const s1 = segments?.[1];
    const s2 = segments?.[2];

    // Hide footer on: /(protected)/train/onboarding
    const isTrainOnboarding =
      s0 === "(protected)" && s1 === "train" && s2 === "onboarding";

    // Optional: hide on any other onboarding flows you add later
    const isAnyOnboarding =
      s0 === "(protected)" && (s2 === "onboarding" || s1 === "onboarding");

    // ✅ Hide footer on Settings
    const isSettings = s0 === "(protected)" && s1 === "settings";

    const iscolours = s0 === "(protected)" && s1 === "colours";
    const isfonts = s0 === "(protected)" && s1 === "fonts";
    const isWelcome = s0 === "(protected)" && s1 === "welcome";

    // ✅ Hide footer on specific Nutrition screens
    const isNutrition = s0 === "(protected)" && s1 === "nutrition";

    // Screens you want FULLSCREEN (no footer)
    const fullscreenNutritionScreens = new Set([
      "today",
      "weight",
      "goal",
      "streaks",
      "week",
      "add",
      "food-quality",
      "barcode",
      "nutrition-list",
      "fuelmatch",
      // dynamic meal detail route folder: /nutrition/[mealId]
      "[mealId]",
    ]);

    const isFullscreenNutrition =
      isNutrition && fullscreenNutritionScreens.has(String(s2 || ""));

    // ✅ Hide footer on ALL train session pages:
    // /(protected)/train/session/[sessionKey]/*
    const isTrainSession =
      s0 === "(protected)" && s1 === "train" && s2 === "session";
    const isTrainCoachPlans =
      s0 === "(protected)" && s1 === "train" && s2 === "coach-plans";
    const isTrainViewPlan =
      s0 === "(protected)" && s1 === "train" && s2 === "view-plan";
    const isTrainHistoryDetail =
      s0 === "(protected)" &&
      s1 === "train" &&
      s2 === "history" &&
      !!segments?.[3];
    const isMeActivityDetail =
      s0 === "(protected)" && s1 === "me" && s2 === "activity";
    const isHistoryActivityDetail =
      s0 === "(protected)" && s1 === "history" && !!s2;
    const isCameraScreen = s0 === "(protected)" && s1 === "camera";
    const isHomeCalendar =
      s0 === "(protected)" && s1 === "home" && s2 === "calendar";
    const isProfileRoute = s0 === "(protected)" && s1 === "profile";

    return (
      isTrainOnboarding ||
      isAnyOnboarding ||
      isFullscreenNutrition ||
      isSettings ||
      iscolours ||
      isfonts ||
      isWelcome ||
      isTrainSession ||
      isTrainCoachPlans ||
      isTrainViewPlan ||
      isTrainHistoryDetail ||
      isMeActivityDetail ||
      isHistoryActivityDetail ||
      isCameraScreen ||
      isProfileRoute ||
      isHomeCalendar ||
      isTrainCreateFlow
    );
  }, [segments, isTrainCreateFlow]);

  if (!nav?.key) return null;

  if (loading || welcomeLoading) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "black",
        }}
      >
        <ActivityIndicator />
        <Text style={{ color: "white", marginTop: 8, opacity: 0.7 }}>
          {deadman ? "Still waking things up…" : "initialising…"}
        </Text>
      </SafeAreaView>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (needsWelcome && !isWelcomeRoute) {
    return <Redirect href="/(protected)/welcome" />;
  }

  if (!needsWelcome && isWelcomeRoute) {
    return <Redirect href="/(protected)/home" />;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isTrainCreateFlow ? colors.bg : "black",
      }}
    >
      <View style={{ flex: 1, backgroundColor: isTrainCreateFlow ? colors.bg : "transparent" }}>
        <Slot />
      </View>

      <LinearGradient
        colors={["rgba(0,0,0,1)", "rgba(0,0,0,0)"]}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 0,
          zIndex: 30,
        }}
        pointerEvents="none"
      />

      {!hideFooter && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "transparent",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <Footer />
        </View>
      )}
    </View>
  );
}

```

### app/components/Footer.jsx

```jsx
// app/components/Footer.jsx
import Feather from "./LucideFeather";
import { BlurView } from "expo-blur";
// Haptics removed
import { usePathname, useRouter } from "expo-router";
import { memo, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLiveActivity } from "../../providers/LiveActivityProvider";
import { useTheme } from "../../providers/ThemeProvider";
import {
  ACTIVE_LIVE_ACTIVITY_STATUSES,
  isLiveActivityStale,
  normaliseLiveActivityStatus,
  shouldPauseStaleLiveActivity,
} from "../../src/train/utils/liveActivityHelpers";

const HORIZONTAL_PADDING = 4; // must match blur paddingHorizontal below

const TABS = [
  { key: "Summary", icon: "grid", label: "Summary", path: "/(protected)/home" },
  { key: "train", icon: "activity", label: "Train", path: "/(protected)/train" },
  { key: "record", icon: "message-circle", label: "Chat", path: "/(protected)/chat" },
  { key: "nutrition", icon: "droplet", label: "Fuel", path: "/(protected)/nutrition" },
  { key: "me", icon: "user", label: "You", path: "/(protected)/me" },
];

function normalisePathForMatch(path) {
  let out = String(path || "").trim();
  if (!out) return "/";
  out = out.replace(/\/\([^/]+\)/g, "");
  out = out.replace(/\/{2,}/g, "/");
  out = out.replace(/\/$/, "");
  return out || "/";
}

function Tab({ icon, label, active, onPress, colors, accentFill }) {
  // ✅ no neon text — neon only as fill/highlight
  const iconColor = active ? colors.text : colors.subtext;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.tabContainer}>
      <View style={styles.iconLabelWrap}>
        <Feather name={icon} size={20} color={iconColor} style={{ zIndex: 3 }} />
        <Text style={[styles.label, { color: iconColor }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

function FooterInner() {
  const rawPath = usePathname() || "/";
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { hydrated: liveHydrated, liveActivity, setLiveActivity, clearLiveActivity } =
    useLiveActivity();

  // ✅ use theme accent fill (neon) but DO NOT use it for text
  const accentFill = colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";

  const pathname =
    rawPath === "/(protected)" || rawPath === "/"
      ? "/(protected)/home"
      : rawPath;
  const currentPathForMatch = normalisePathForMatch(pathname);
  const liveRoute = String(liveActivity?.route || "");
  const liveRouteForMatch = normalisePathForMatch(liveRoute);
  const liveStatus = normaliseLiveActivityStatus(liveActivity?.status);
  const liveSessionKey = String(liveActivity?.sessionKey || "").trim();
  const isFreshLiveState = !isLiveActivityStale(liveActivity);
  const hasLiveRouteShape = /^\/train\/session\/.+\/live$/.test(liveRouteForMatch);
  const hasValidLiveState =
    !!liveActivity?.isActive &&
    !!liveSessionKey &&
    hasLiveRouteShape &&
    ACTIVE_LIVE_ACTIVITY_STATUSES.has(liveStatus) &&
    isFreshLiveState;
  const isLiveActive = !!(liveHydrated && hasValidLiveState);
  const isOnLiveRoute = isLiveActive && currentPathForMatch === liveRouteForMatch;
  const showLivePill = isLiveActive && !isOnLiveRoute;
  const liveLabel = liveStatus === "paused" ? "Live paused" : "Live";

  useEffect(() => {
    if (!liveHydrated) return;
    if (!liveActivity?.isActive) return;
    if (shouldPauseStaleLiveActivity(liveActivity)) {
      setLiveActivity((prev) => {
        if (!shouldPauseStaleLiveActivity(prev)) return prev;
        return {
          ...prev,
          status: "paused",
          updatedAt: Date.now(),
        };
      });
      return;
    }
    if (hasValidLiveState) return;
    clearLiveActivity();
  }, [
    clearLiveActivity,
    hasValidLiveState,
    liveActivity,
    liveHydrated,
    setLiveActivity,
  ]);

  // ✅ colours only (keep sizing EXACTLY the same)
  const theme = {
    barBg: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.72)",
    border: colors.borderStrong || colors.sapSilverMedium || colors.border,
    subtext: colors.subtext,
  };

  const go = (tab) => {
    const path = tab?.path;
    if (!path) return;
    if (pathname !== path) router.replace(path);
  };

  const goToLive = () => {
    if (!liveRoute) return;
    if (!isOnLiveRoute) router.push(liveRoute);
  };

  /* ----------------------- Highlighter slider ------------------------ */
  const slideX = useRef(new Animated.Value(0)).current;
  const [tabWidth, setTabWidth] = useState(0);
  const hasInitialisedSlider = useRef(false);
  const prevSafeIndex = useRef(null);
  const prevTabWidth = useRef(0);

  // Match using the tab root path, so nested routes still map to the right tab.
  const activeIndex = TABS.findIndex((t) => {
    const tabPath = normalisePathForMatch(t.path);
    return (
      currentPathForMatch === tabPath ||
      currentPathForMatch.startsWith(`${tabPath}/`)
    );
  });
  const safeIndex = activeIndex === -1 ? 0 : activeIndex;

  // one pill per tab, almost full width of that tab
  const sliderWidth = tabWidth > 0 ? tabWidth - 0 : 0;

  useEffect(() => {
    if (!tabWidth || !sliderWidth) return;

    const targetX =
      HORIZONTAL_PADDING + safeIndex * tabWidth + (tabWidth - sliderWidth) / 2;

    // On first mount/remount (e.g. returning from fullscreen pages),
    // place the pill directly at the correct tab with no slide animation.
    if (!hasInitialisedSlider.current) {
      slideX.setValue(targetX);
      hasInitialisedSlider.current = true;
      prevSafeIndex.current = safeIndex;
      prevTabWidth.current = tabWidth;
      return;
    }

    const tabChanged = prevSafeIndex.current !== safeIndex;
    const widthChanged = prevTabWidth.current !== tabWidth;
    prevSafeIndex.current = safeIndex;
    prevTabWidth.current = tabWidth;

    // Keep position synced if layout width changed (rotation/resize), no animation.
    if (widthChanged && !tabChanged) {
      slideX.setValue(targetX);
      return;
    }

    if (!tabChanged) return;

    Animated.spring(slideX, {
      toValue: targetX,
      useNativeDriver: true,
      tension: 140,
      friction: 12,
    }).start();
  }, [safeIndex, tabWidth, sliderWidth, slideX]);

  const onLayoutTabs = (e) => {
    const totalWidth = e.nativeEvent.layout.width;
    if (totalWidth) setTabWidth(totalWidth / TABS.length);
  };

  /* -------------------------- Footer bounce -------------------------- */
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(bounce, { toValue: 1, duration: 70, useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  }, [safeIndex, bounce]);

  const scale = bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.01] });
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });

  return (
    <View style={styles.outerContainer}>
      {showLivePill ? (
        <TouchableOpacity
          onPress={goToLive}
          activeOpacity={0.88}
          style={[
            styles.livePill,
            {
              backgroundColor: accentFill,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>{liveLabel}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.floatingContainer}>
        <Animated.View style={{ transform: [{ scale }, { translateY }] }}>
          <BlurView
            intensity={30}
            tint={isDark ? "dark" : "light"}
            style={[
              styles.blur,
              {
                backgroundColor: theme.barBg,
                borderColor: theme.border,
              },
            ]}
          >
            {/* Monzo-style pill (neon fill only) */}
            {tabWidth > 0 && (
              <Animated.View
                style={[
                  styles.highlighterSlider,
                  {
                    width: sliderWidth,
                    transform: [{ translateX: slideX }],
                    backgroundColor: accentFill,
                    // Keep the same vibe but slightly safer in light mode
                    opacity: isDark ? 0.18 : 0.14,
                  },
                ]}
              />
            )}

            {/* Tabs */}
            <View style={styles.tabsRow} onLayout={onLayoutTabs}>
              {TABS.map((t, index) => (
                <Tab
                  key={t.key}
                  icon={t.icon}
                  label={t.label}
                  active={index === safeIndex}
                  onPress={() => {
                    go(t);
                  }}
                  colors={colors}
                  accentFill={accentFill}
                />
              ))}
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </View>
  );
}

export default memo(FooterInner);

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
  outerContainer: {
    width: "100%",
    paddingBottom: 18,
  },
  livePill: {
    position: "absolute",
    alignSelf: "center",
    bottom: 80,
    zIndex: 20,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#DC2626",
  },
  livePillText: {
    color: "#101010",
    fontSize: 12,
    fontWeight: "900",
  },
  floatingContainer: {
    paddingHorizontal: 20,
  },

  // ✅ SIZING UNCHANGED (only colours are theme-driven now)
  blur: {
    borderRadius: 40,
    overflow: "hidden",
    paddingVertical: 10,
    paddingHorizontal: HORIZONTAL_PADDING,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E1E3E8", // overwritten at runtime by theme.border
  },

  // Monzo-style pill: fills height, rounded like the footer
  highlighterSlider: {
    position: "absolute",
    top: 4,
    bottom: 4,
    borderRadius: 40,
    backgroundColor: "#E6FF3B", // overwritten at runtime by accentFill
    opacity: 0.22, // overwritten at runtime (slight tweak per mode)
    zIndex: 1,
  },

  tabsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 3,
  },

  tabContainer: {
    flex: 1,
    alignItems: "center",
  },

  iconLabelWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 70,
    height: 50,
  },

  label: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    zIndex: 3,
  },
});

```


## 3. Theme / Design System

### providers/ThemeProvider.jsx

```jsx
// app/providers/ThemeProvider.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance } from "react-native";
import { PALETTES, RADIUS, SPACING, TYPOGRAPHY } from "./theme-tokens";

const THEME_KEY = "@theme"; // "light" | "dark" | "system"

const ThemeCtx = createContext({
  theme: "system",        // "light" | "dark" | "system"
  setTheme: (_v) => {},
  colors: PALETTES.light, // will be overridden at runtime
  isDark: false,
  radius: RADIUS,
  spacing: SPACING,
  typography: TYPOGRAPHY,
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("system"); // "light" | "dark" | "system"
  const sys = Appearance.getColorScheme();      // "light" | "dark" | null

  // load persisted theme once
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_KEY);
        if (saved) setTheme(saved);
      } catch {
        // ignore
      }
    })();
  }, []);

  // persist on change
  useEffect(() => {
    AsyncStorage.setItem(THEME_KEY, theme).catch(() => {});
  }, [theme]);

  // react to system changes only if theme === "system"
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === "system") {
        // bump state to recompute activeScheme
        setTheme((t) => t);
      }
    });
    return () => sub.remove();
  }, [theme]);

  const activeScheme = theme === "system" ? (sys || "light") : theme;
  const colors =
    activeScheme === "dark" ? PALETTES.dark : PALETTES.light;
  const isDark = activeScheme === "dark";

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      colors,
      isDark,
      radius: RADIUS,
      spacing: SPACING,
      typography: TYPOGRAPHY,
    }),
    [theme, colors, isDark]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

```

### providers/theme-tokens.js

```jsx
// ---- SAP GEL shared colours ----
const SAP_PRIMARY = "#E6FF3B";        // neon yellow (best as background/fill)

// UPDATED: neutral “silver” system (less blue) + clearer layer separation
const SAP_BG_LIGHT        = "#EFEFEF"; // app background
const SAP_SECTION_LIGHT   = "#b6b6b6ff"; // section / panel blocks
const SAP_CARD_LIGHT      = "#FAFAFA"; // surface / card
const SAP_SURFACE_ALT     = "#F3F3F3"; // rows / sub-cards

const SAP_TEXT_PRIMARY    = "#0B0B0B";
const SAP_TEXT_SECONDARY  = "#262626";
const SAP_TEXT_MUTED      = "#555555";

const SAP_DIVIDER_LIGHT   = "#D1D1D1";
const SAP_BORDER_LIGHT    = "#BDBDBD";
const SAP_BORDER_STRONG   = "#9E9E9E";

// UPDATED: higher-contrast neon-ink for light mode (don’t use neon as text on white)
const SAP_NEON_INK_LIGHT = "#3F4F00"; // readable on light backgrounds
const SAP_NEON_INK_DARK  = "#E6FF3B"; // in dark mode neon text is fine

// Optional: “ink” surfaces for black-led chips/headers in light mode
const SAP_INK_SURFACE     = "#111111";
const SAP_INK_SURFACE_ALT = "#1A1A1A";
const SAP_ON_INK          = "#FAFAFA";

export const PALETTES = {
  light: {
    // main roles
    bg: SAP_BG_LIGHT,
    card: SAP_CARD_LIGHT,
    text: SAP_TEXT_PRIMARY,
    subtext: SAP_TEXT_MUTED,
    border: SAP_BORDER_LIGHT,

    // extra layer roles (recommended)
    section: SAP_SECTION_LIGHT,
    surfaceAlt: SAP_SURFACE_ALT,
    divider: SAP_DIVIDER_LIGHT,
    borderStrong: SAP_BORDER_STRONG,

    // SAP GEL
    sapPrimary: SAP_PRIMARY,
    sapSilverLight: SAP_SURFACE_ALT,
    sapSilverMedium: SAP_SECTION_LIGHT,
    sapOnPrimary: SAP_TEXT_PRIMARY,

    // accent roles
    accentBg: SAP_PRIMARY,            // buttons/chips fills
    accentText: SAP_NEON_INK_LIGHT,   // links/icons on light bg
    accentBorder: "#BFD82A",          // outline / ring

    // optional ink surfaces (black-led accents in light mode)
    inkSurface: SAP_INK_SURFACE,
    inkSurfaceAlt: SAP_INK_SURFACE_ALT,
    onInk: SAP_ON_INK,
  },

  dark: {
    bg: "#000000",
    card: "#2C2C2C",
    text: "#E5E7EB",
    subtext: "#B7B7B7",
    border: "#404040",

    // SAP GEL
    sapPrimary: SAP_PRIMARY,
    sapSilverLight: "#111217",
    sapSilverMedium: "#E1E3E8",
    sapOnPrimary: "#111111",

    // accent roles
    accentBg: SAP_PRIMARY,
    accentText: SAP_NEON_INK_DARK, // neon is visible on dark
    accentBorder: SAP_PRIMARY,
  },
};

```

### styles/sapNutritionTheme.js

```jsx

```

### constants/theme.ts

```tsx
/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

```


## 4. Shared UI Components

### app/components/Header.jsx

```jsx
// app/components/Header.jsx
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { memo, useMemo } from "react";
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";
;
/**
 * Usage:
 * <Header title="version1.0" unread={{ activity: 3, messages: 1 }} />
 *
 * Routes pushed:
 *  - Left avatar: /me
 *  - Heart (activity): /activity-feed
 *  - Messages (DM): /inbox
 */
function HeaderInner({ title = "version1.0", unread = { activity: 0, messages: 0 } }) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const user = auth.currentUser;

  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const initial =
    (user?.displayName?.trim()?.[0] ??
      user?.email?.trim()?.[0] ??
      "U"
    ).toUpperCase();

  const tap = (fn) => () => {
    try { Haptics.selectionAsync(); } catch {}
    fn();
  };

  return (
    <View style={styles.safePad}>
      <View style={styles.wrap}>
        {/* Left: Profile */}
        <TouchableOpacity
          style={styles.left}
          onPress={tap(() => router.push("/me"))}
          accessibilityRole="button"
        >
          {user?.photoURL ? (
            <Image source={{ uri: user.photoURL }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Center: Title / Logo */}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        {/* Right: Actions */}
        <View style={styles.right}>
          <IconButton
            name="heart"
            onPress={tap(() => router.push("/activity-feed"))}
            badge={unread?.activity || 0}
            colors={colors}
          />
          <IconButton
            name="message-circle"
            onPress={tap(() => router.push("/inbox"))}
            badge={unread?.messages || 0}
            colors={colors}
          />
        </View>
      </View>
    </View>
  );
}

function IconButton({ name, onPress, badge = 0, colors }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Feather name={name} size={22} color={colors.text} />
      {badge > 0 && (
        <View style={[s.badge, { backgroundColor: colors.accent }]}>
          <Text style={s.badgeText}>{badge > 9 ? "9+" : String(badge)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  iconBtn: { marginLeft: 14, position: "relative" },
  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "white", fontSize: 10, fontWeight: "800" },
});

const makeStyles = (colors, isDark) =>
  StyleSheet.create({
    safePad: {
      paddingTop: Platform.select({ ios: 8, android: 0, default: 0 }),
      backgroundColor: colors.header,
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      ...Platform.select({
        ios: { shadowColor: "#000", shadowOpacity: isDark ? 0.25 : 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
        android: { elevation: 2 },
      }),
    },
    wrap: {
      height: 52,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.header,
    },
    left: { width: 36, height: 36, borderRadius: 18, overflow: "hidden" },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border },
    avatarFallback: { alignItems: "center", justifyContent: "center" },
    avatarInitial: { color: colors.text, fontWeight: "800" },
    title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: colors.text },
    right: { flexDirection: "row", alignItems: "center" },
  });

const Header = memo(HeaderInner);
export default Header;

```

### app/components/AccountSheet.jsx

```jsx
// app/(protected)/components/AccountSheet.jsx
import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
    Animated,
    Dimensions,
    Easing,
    Modal,
    PanResponder,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

import { useTheme } from "../../providers/ThemeProvider";

const PRIMARY = "#E6FF3B";
const SCREEN_WIDTH = Dimensions.get("window").width;

export default function AccountSheet({ visible, onClose, user }) {
  const { colors, isDark } = useTheme();

  const theme = {
    bg: "rgba(0,0,0,0.55)",
    sheetBg: isDark ? "#111217" : "#171717",
    cardBg: isDark ? "#1A1B21" : "#202124",
    border: "#2A2B31",
    text: colors.text,
    subtext: colors.subtext,
    primary: PRIMARY,
  };

  const name = user?.displayName || "Your Name";
  const email = user?.email || "you@example.com";

  // ---- sheet animation & scrolling ----
  const translateY = useRef(new Animated.Value(800)).current;
  const slideX = useRef(new Animated.Value(0)).current; // root ↔ detail
  const scrollRef = useRef(null);

  // "root" or "detail"
  const [mode, setMode] = useState("root");

  // which detail page is active when mode === "detail"
  const [detailPage, setDetailPage] = useState(null); // e.g. "notifications"

  // Notification toggles
  const [notifyDailySummary, setNotifyDailySummary] = useState(true);
  const [notifySessionReminders, setNotifySessionReminders] = useState(true);
  const [notifyCoachTips, setNotifyCoachTips] = useState(false);

  // ---- helpers ----
  const detailTitleMap = {
    notifications: "Notifications",
    health: "Health Details",
    moveGoal: "Change Move Goal",
    units: "Units of Measure",
    privacy: "Privacy",
    workout: "Workout",
    fitness: "Fitness+",
    redeem: "Redeem Gift Card or Code",
    sendGift: "Send Gift Card by Email",
  };

  const openDetail = (pageKey) => {
    setDetailPage(pageKey);
    Animated.timing(slideX, {
      toValue: -SCREEN_WIDTH,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMode("detail");
    });
  };

  const backToRoot = () => {
    Animated.timing(slideX, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setMode("root");
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  // Close AFTER slide-down animation – avoids flicker
  const animateClose = () => {
    Animated.timing(translateY, {
      toValue: 800,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      onClose?.();
      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        translateY.setValue(800);
        slideX.setValue(0);
        setMode("root");
        setDetailPage(null);
      }, 120);
    });
  };

  // When becoming visible: reset & slide up (no bounce)
  useEffect(() => {
    if (visible) {
      translateY.setValue(800);
      slideX.setValue(0);
      setMode("root");
      setDetailPage(null);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }, 50);

      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const shouldClose = g.dy > 140 || g.vy > 0.9;
        if (shouldClose) {
          animateClose();
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  // -------- detail page content renderer --------
  const renderDetailContent = () => {
    switch (detailPage) {
      case "notifications":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowWithSwitch
                label="Daily summary"
                subtitle="Steps, training load & recovery snapshot"
                value={notifyDailySummary}
                onValueChange={setNotifyDailySummary}
                theme={theme}
              />
              <Divider theme={theme} />
              <RowWithSwitch
                label="Session reminders"
                subtitle="Remind me before planned workouts"
                value={notifySessionReminders}
                onValueChange={setNotifySessionReminders}
                theme={theme}
              />
              <Divider theme={theme} />
              <RowWithSwitch
                label="Coach tips"
                subtitle="Contextual tips based on my plan"
                value={notifyCoachTips}
                onValueChange={setNotifyCoachTips}
                theme={theme}
              />
            </View>

            <View style={{ marginTop: 14, paddingHorizontal: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  lineHeight: 18,
                }}
              >
                Notification preferences are used to guide how often we nudge
                you about training, recovery and nutrition. You can also control
                system-level alerts from your phone’s settings.
              </Text>
            </View>
          </>
        );

      case "health":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <RowStatic
              label="Date of Birth"
              value="Set in Health"
              theme={theme}
            />
            <Divider theme={theme} />
            <RowStatic label="Height" value="—" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Weight" value="—" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Sex" value="—" theme={theme} />
          </View>
        );

      case "moveGoal":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowStatic
                label="Daily move goal"
                value="Custom"
                theme={theme}
              />
              <Divider theme={theme} />
              <View style={styles.moveGoalContainer}>
                <Text style={{ color: theme.subtext, fontSize: 13 }}>
                  Adjust how aggressive your daily activity target is. This will
                  be used for streaks and rings.
                </Text>
              </View>
            </View>
          </>
        );

      case "units":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <RowStatic label="Distance" value="Kilometres" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Energy" value="Kilocalories" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Weight" value="Kilograms" theme={theme} />
            <Divider theme={theme} />
            <RowStatic label="Height" value="Centimetres" theme={theme} />
          </View>
        );

      case "privacy":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowStatic
                label="Data & analytics"
                value="On"
                theme={theme}
              />
              <Divider theme={theme} />
              <RowStatic
                label="Share training insights"
                value="Off"
                theme={theme}
              />
            </View>

            <View style={{ marginTop: 14, paddingHorizontal: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  lineHeight: 18,
                }}
              >
                We use your data to personalise your plan and improve Train-R.
                You can request a copy or delete your account from the Privacy
                centre on the web.
              </Text>
            </View>
          </>
        );

      case "workout":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <RowStatic
              label="Default sport"
              value="Running"
              theme={theme}
            />
            <Divider theme={theme} />
            <RowStatic
              label="Auto-import from Strava"
              value="Enabled"
              theme={theme}
            />
            <Divider theme={theme} />
            <RowStatic
              label="Send workouts to watch"
              value="On"
              theme={theme}
            />
          </View>
        );

      case "fitness":
        return (
          <>
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
            >
              <RowStatic
                label="Linked services"
                value="None"
                theme={theme}
              />
              <Divider theme={theme} />
              <RowStatic
                label="Share progress with friends"
                value="Off"
                theme={theme}
              />
            </View>

            <View style={{ marginTop: 14, paddingHorizontal: 4 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: theme.subtext,
                  lineHeight: 18,
                }}
              >
                Connect other fitness apps and services here once they’re
                available in Train-R.
              </Text>
            </View>
          </>
        );

      case "redeem":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={{ color: theme.text, fontSize: 14 }}>
                Redeem code
              </Text>
              <Text
                style={{
                  color: theme.subtext,
                  fontSize: 12,
                  marginTop: 6,
                  lineHeight: 18,
                }}
              >
                If you’ve been given a Train-R access code or gift, you’ll be
                able to redeem it here in a later update.
              </Text>
            </View>
          </View>
        );

      case "sendGift":
        return (
          <View
            style={[
              styles.sectionCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={{ color: theme.text, fontSize: 14 }}>
                Send a gift card
              </Text>
              <Text
                style={{
                  color: theme.subtext,
                  fontSize: 12,
                  marginTop: 6,
                  lineHeight: 18,
                }}
              >
                Soon you’ll be able to send Train-R access as a gift to friends
                and family directly from this screen.
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade" // background fade, sheet slide is custom
      onRequestClose={animateClose}
    >
      <View style={[styles.overlay, { backgroundColor: theme.bg }]}>
        <SafeAreaView style={styles.safe}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme.sheetBg, transform: [{ translateY }] },
            ]}
            {...panResponder.panHandlers}
          >
            {/* Inner horizontal pager – root + detail */}
            <Animated.View
              style={[
                styles.innerPager,
                { width: SCREEN_WIDTH * 2, transform: [{ translateX: slideX }] },
              ]}
            >
              {/* ROOT PAGE — ACCOUNT */}
              <View style={[styles.page, { width: SCREEN_WIDTH }]}>
                {/* HEADER */}
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: theme.text }]}>
                    Account
                  </Text>
                  <TouchableOpacity
                    onPress={animateClose}
                    style={styles.closeBtn}
                    activeOpacity={0.8}
                  >
                    <Feather name="x" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  ref={scrollRef}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingBottom: 24, // fills nicely, no big gap
                  }}
                >
                  {/* PROFILE CARD */}
                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.profileRow}
                      activeOpacity={0.85}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {name.charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.profileName, { color: theme.text }]}
                        >
                          {name}
                        </Text>
                        <Text
                          style={[
                            styles.profileEmail,
                            { color: theme.subtext },
                          ]}
                          numberOfLines={1}
                        >
                          {email}
                        </Text>
                      </View>

                      <Feather
                        name="chevron-right"
                        size={18}
                        color={theme.subtext}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* SETTINGS GROUPS */}
                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Notifications"
                      theme={theme}
                      onPress={() => openDetail("notifications")}
                    />
                  </View>

                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Health Details"
                      theme={theme}
                      onPress={() => openDetail("health")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Change Move Goal"
                      theme={theme}
                      onPress={() => openDetail("moveGoal")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Units of Measure"
                      theme={theme}
                      onPress={() => openDetail("units")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Privacy"
                      theme={theme}
                      onPress={() => openDetail("privacy")}
                    />
                  </View>

                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Workout"
                      theme={theme}
                      accent
                      onPress={() => openDetail("workout")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Fitness+"
                      theme={theme}
                      accent
                      onPress={() => openDetail("fitness")}
                    />
                  </View>

                  <View
                    style={[
                      styles.sectionCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.border,
                      },
                    ]}
                  >
                    <Row
                      label="Redeem Gift Card or Code"
                      theme={theme}
                      accent
                      onPress={() => openDetail("redeem")}
                    />
                    <Divider theme={theme} />
                    <Row
                      label="Send Gift Card by Email"
                      theme={theme}
                      accent
                      onPress={() => openDetail("sendGift")}
                    />
                  </View>
                </ScrollView>
              </View>

              {/* DETAIL PAGE (re-used for all detail screens) */}
              <View style={[styles.page, { width: SCREEN_WIDTH }]}>
                {/* HEADER – back chevron, dynamic title */}
                <View style={styles.subHeader}>
                  <TouchableOpacity
                    onPress={backToRoot}
                    style={styles.backBtn}
                    activeOpacity={0.8}
                  >
                    <Feather name="chevron-left" size={20} color={theme.text} />
                  </TouchableOpacity>
                  <Text style={[styles.subHeaderTitle, { color: theme.text }]}>
                    {detailTitleMap[detailPage] || "Account"}
                  </Text>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingBottom: 24,
                  }}
                >
                  {renderDetailContent()}
                </ScrollView>
              </View>
            </Animated.View>
          </Animated.View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/* ---------- sub components ---------- */

function Row({ label, theme, accent, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.row}
      onPress={onPress}
    >
      <Text
        style={[
          styles.rowLabel,
          { color: accent ? theme.primary : theme.text },
        ]}
      >
        {label}
      </Text>
      <Feather name="chevron-right" size={18} color={theme.subtext} />
    </TouchableOpacity>
  );
}

function RowStatic({ label, value, theme }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      {value ? (
        <Text
          style={{
            fontSize: 13,
            color: theme.subtext,
          }}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

function RowWithSwitch({ label, subtitle, value, onValueChange, theme }) {
  return (
    <View style={styles.rowSwitchContainer}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        {subtitle ? (
          <Text
            style={{
              fontSize: 12,
              color: theme.subtext,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#3A3A3A", true: theme.primary }}
        thumbColor={value ? "#111111" : "#f4f3f4"}
      />
    </View>
  );
}

function Divider({ theme }) {
  return (
    <View
      style={[styles.divider, { borderBottomColor: theme.border }]}
    />
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  innerPager: {
    flexDirection: "row",
    flex: 1,
  },
  page: {
    flex: 1,
  },

  // Root header
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  closeBtn: {
    position: "absolute",
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 20,
    backgroundColor: "rgba(38,38,38,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Sub-page header (detail pages)
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    marginTop: 4,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  subHeaderTitle: {
    fontSize: 17,
    fontWeight: "700",
  },

  sectionCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    overflow: "hidden",
  },

  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 20,
  },
  profileName: {
    fontSize: 15,
    fontWeight: "600",
  },
  profileEmail: {
    fontSize: 12,
    marginTop: 2,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },

  rowSwitchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 10,
  },

  moveGoalContainer: {
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
});

```

### app/components/LucideFeather.jsx

```jsx
import {
  Activity,
  BarChart2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CirclePlay,
  CirclePlus,
  Clock3,
  Cloud,
  Droplet,
  Ellipsis,
  Eye,
  Grid2x2,
  Heart,
  Layers,
  Link,
  List,
  Map,
  MapPin,
  Maximize2,
  MessageCircle,
  Moon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Target,
  User,
  Watch,
  Wind,
  X,
  Zap,
} from "lucide-react-native";
import React from "react";

const ICONS = {
  activity: Activity,
  "bar-chart-2": BarChart2,
  calendar: Calendar,
  check: Check,
  "check-circle": CircleCheck,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  clock: Clock3,
  cloud: Cloud,
  droplet: Droplet,
  "edit-3": Pencil,
  eye: Eye,
  grid: Grid2x2,
  heart: Heart,
  layers: Layers,
  link: Link,
  list: List,
  map: Map,
  "map-pin": MapPin,
  "maximize-2": Maximize2,
  "message-circle": MessageCircle,
  moon: Moon,
  "more-horizontal": Ellipsis,
  play: Play,
  "play-circle": CirclePlay,
  plus: Plus,
  "plus-circle": CirclePlus,
  "refresh-cw": RefreshCw,
  repeat: Repeat,
  "skip-forward": SkipForward,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  target: Target,
  user: User,
  watch: Watch,
  wind: Wind,
  x: X,
  zap: Zap,
};

export default function LucideFeather({
  name,
  size = 16,
  color = "currentColor",
  strokeWidth = 2.25,
  style,
}) {
  const Icon = ICONS[String(name || "").toLowerCase()] || Activity;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}

```

### app/(protected)/home/components/HomeHeader.jsx

```jsx
import { Text, TouchableOpacity, View } from "react-native";

import Feather from "../../../components/LucideFeather";

export default function HomeHeader({
  greeting,
  dateLabel,
  statusLabel,
  refreshing,
  colors,
  styles,
  onRefresh,
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={[styles.headerGreeting, { color: colors.text }]}>
          {greeting}
        </Text>
        <Text style={[styles.headerDate, { color: colors.subtext }]}>
          {dateLabel}
        </Text>
      </View>

      <View style={styles.headerActions}>
        <View style={styles.statusChip}>
          <View
            style={[styles.statusDot, { backgroundColor: colors.accentBg || "#E6FF3B" }]}
          />
          <Text style={[styles.statusText, { color: colors.text }]}>{statusLabel}</Text>
        </View>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={onRefresh}
          activeOpacity={0.82}
          disabled={refreshing}
        >
          <Feather
            name="refresh-cw"
            size={15}
            color={refreshing ? colors.subtext : colors.text}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

```

### app/(protected)/home/components/WeekProgress.jsx

```jsx
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

```

### app/(protected)/home/components/WeekTimeline.jsx

```jsx
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

```

### app/(protected)/home/components/TodayHero.jsx

```jsx
import { Text, TouchableOpacity, View } from "react-native";

import Feather from "../../../components/LucideFeather";

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

```

### app/(protected)/home/components/InsightBlock.jsx

```jsx
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

```

### app/(protected)/home/components/QuickActions.jsx

```jsx
import { Text, TouchableOpacity, View } from "react-native";

export default function QuickActions({ items, styles, colors, onPress }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionEyebrow, { color: colors.subtext }]}>
        Quick actions
      </Text>
      <View style={styles.actionRow}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.actionPill}
            onPress={() => onPress(item.path)}
            activeOpacity={0.82}
          >
            <Text style={[styles.actionPillText, { color: colors.text }]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

```

### app/(protected)/me/components/MeHeader.jsx

```jsx
import { Image, Text, TouchableOpacity, View } from "react-native";

export default function MeHeader({
  profile,
  colors,
  styles,
  onProfile,
  onSettings,
}) {
  const name = profile?.name || "You";
  const secondaryLine =
    profile?.supportLine || profile?.email || "Personal progress";
  const initial = String(name || "Y").trim().charAt(0).toUpperCase() || "Y";

  return (
    <View style={styles.header}>
      <View style={styles.headerIdentity}>
        <View style={styles.headerAvatarRing}>
          {profile?.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarFallback}>
              <Text style={[styles.headerAvatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={styles.headerCopy}>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.headerMeta, { color: colors.subtext }]} numberOfLines={1}>
            {secondaryLine}
          </Text>
        </View>
      </View>

      <View style={styles.headerActions}>
        <TouchableOpacity
          style={styles.headerAction}
          activeOpacity={0.82}
          onPress={onProfile}
        >
          <Text style={[styles.headerActionText, { color: colors.text }]}>Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerAction}
          activeOpacity={0.82}
          onPress={onSettings}
        >
          <Text style={[styles.headerActionText, { color: colors.text }]}>Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

```

### app/(protected)/me/components/ProgressSummary.jsx

```jsx
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

```

### app/(protected)/me/components/RecentActivity.jsx

```jsx
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

```

### app/(protected)/me/components/IntegrationsSection.jsx

```jsx
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

```

### app/(protected)/me/components/DeeperLinks.jsx

```jsx
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

```

### app/(protected)/profile/components/ProfileHeader.jsx

```jsx
import { Image, Text, TouchableOpacity, View } from "react-native";

export default function ProfileHeader({
  profile,
  colors,
  styles,
  onBack,
  onEditPhoto,
}) {
  const name = profile?.name || "Your profile";
  const email = profile?.email || "No email";
  const username = profile?.username ? `@${profile.username}` : "";
  const initial = String(name || email || "Y").trim().charAt(0).toUpperCase() || "Y";

  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerTopRow}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.82}>
          <Text style={[styles.backButtonText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTopLabel, { color: colors.subtext }]}>Private</Text>
      </View>

      <View style={styles.headerMain}>
        <TouchableOpacity
          style={styles.avatarRing}
          onPress={onEditPhoto}
          activeOpacity={0.85}
        >
          {profile?.photoURL ? (
            <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
          ) : (
            <View
              style={[
                styles.avatarFallback,
                { backgroundColor: colors.card || "rgba(255,255,255,0.08)" },
              ]}
            >
              <Text style={[styles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerCopy}>
          <Text style={[styles.headerEyebrow, { color: colors.subtext }]}>Edit profile</Text>
          <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.headerMeta, { color: colors.subtext }]} numberOfLines={1}>
            {username || email}
          </Text>
          <Text style={[styles.headerSupport, { color: colors.subtext }]} numberOfLines={2}>
            {profile?.supportLine || "Edit how you appear in the app"}
          </Text>
          <TouchableOpacity
            onPress={onEditPhoto}
            style={styles.inlineAction}
            activeOpacity={0.82}
          >
            <Text style={[styles.inlineActionText, { color: colors.text }]}>Edit photo</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

```

### app/(protected)/profile/components/ProfileForm.jsx

```jsx
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import ProfileField from "./ProfileField";

export default function ProfileForm({
  values,
  errors,
  colors,
  styles,
  dirty,
  hasErrors,
  saveState,
  saveMessage,
  onChangeField,
  onBlurField,
  onSave,
}) {
  const saving = saveState === "saving";
  const disabled = !dirty || hasErrors || saving;
  const toneColor =
    saveState === "error"
      ? colors.danger || "#EF4444"
      : saveState === "saved"
      ? colors.text
      : colors.subtext;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Identity</Text>
        <Text style={[styles.sectionSummary, { color: colors.subtext }]}>
          Update how you appear across the app.
        </Text>
      </View>

      <View style={styles.formStack}>
        <ProfileField
          label="Name"
          value={values.name}
          onChangeText={(value) => onChangeField("name", value)}
          onBlur={() => onBlurField("name")}
          placeholder="Your name"
          colors={colors}
          styles={styles}
          error={errors.name}
        />

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Username"
          value={values.username}
          onChangeText={(value) => onChangeField("username", value)}
          onBlur={() => onBlurField("username")}
          placeholder="username"
          colors={colors}
          styles={styles}
          error={errors.username}
          helper="Lowercase letters, numbers, dots, and underscores."
          autoCapitalize="none"
        />

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Bio"
          value={values.bio}
          onChangeText={(value) => onChangeField("bio", value)}
          onBlur={() => onBlurField("bio")}
          placeholder="Tell people a bit about you"
          colors={colors}
          styles={styles}
          error={errors.bio}
          helper="Keep it short and personal."
          multiline
        />

        <View style={styles.sectionDivider} />

        <View style={styles.twoColumnRow}>
          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Primary sport"
              value={values.sport}
              onChangeText={(value) => onChangeField("sport", value)}
              onBlur={() => onBlurField("sport")}
              placeholder="Running"
              colors={colors}
              styles={styles}
              error={errors.sport}
            />
          </View>

          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Location"
              value={values.location}
              onChangeText={(value) => onChangeField("location", value)}
              onBlur={() => onBlurField("location")}
              placeholder="London, UK"
              colors={colors}
              styles={styles}
              error={errors.location}
            />
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Website"
          value={values.website}
          onChangeText={(value) => onChangeField("website", value)}
          onBlur={() => onBlurField("website")}
          placeholder="https://"
          colors={colors}
          styles={styles}
          error={errors.website}
          helper="We’ll normalize this to a valid public URL."
          autoCapitalize="none"
          keyboardType="url"
        />
      </View>

      <View style={styles.saveRow}>
        <View style={styles.saveCopy}>
          <Text style={[styles.saveStateLabel, { color: toneColor }]}>
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
              ? "Saving"
              : dirty
              ? "Unsaved changes"
              : "Up to date"}
          </Text>
          {!!saveMessage && (
            <Text style={[styles.saveStateMessage, { color: colors.subtext }]}>
              {saveMessage}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.saveButton,
            disabled && styles.saveButtonDisabled,
          ]}
          activeOpacity={disabled ? 1 : 0.84}
          onPress={onSave}
          disabled={disabled}
        >
          {saving ? (
            <ActivityIndicator color="#111111" />
          ) : (
            <Text style={styles.saveButtonText}>Save profile</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

```

### app/(protected)/profile/components/ProfileField.jsx

```jsx
import { Text, TextInput, View } from "react-native";

export default function ProfileField({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  colors,
  styles,
  error,
  helper,
  multiline,
  autoCapitalize,
  keyboardType,
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={colors.subtextSoft || colors.subtext}
        style={[
          styles.fieldInput,
          multiline && styles.fieldInputMultiline,
          error && styles.fieldInputError,
          { color: colors.text },
        ]}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        selectionColor={colors.accentBg || "#E6FF3B"}
      />
      {!!error ? (
        <Text style={[styles.fieldFeedback, { color: colors.danger || "#EF4444" }]}>
          {error}
        </Text>
      ) : !!helper ? (
        <Text style={[styles.fieldFeedback, { color: colors.subtext }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

```

### app/(protected)/profile/components/IntegrationsSummary.jsx

```jsx
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

```

### app/(protected)/profile/components/SecondaryLinks.jsx

```jsx
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

```


## 5. Current App Pages For Style Reference

### app/(protected)/home/index.jsx

```jsx
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../../providers/ThemeProvider";
import { useHomeDashboardData } from "../../../src/hooks/useHomeDashboardData";
import HomeHeader from "./components/HomeHeader";
import InsightBlock from "./components/InsightBlock";
import NoPlanState from "./components/NoPlanState";
import QuickActions from "./components/QuickActions";
import TodayHero from "./components/TodayHero";
import WeekProgress from "./components/WeekProgress";
import WeekTimeline from "./components/WeekTimeline";

export default function HomeIndexPage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const {
    loading,
    refreshing,
    loadError,
    hasPlan,
    greeting,
    dateLabel,
    statusLabel,
    weekLabel,
    metrics,
    timeline,
    todayHero,
    insight,
    quickActions,
    refresh,
  } = useHomeDashboardData();

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const styles = useMemo(
    () => makeStyles(colors, isDark, accentBg),
    [colors, isDark, accentBg]
  );

  const go = (path) => router.push(path);
  const openTodayPrimary = () => {
    if (todayHero?.completed && todayHero?.savedTrainSessionId) {
      router.push(`/train/history/${encodeURIComponent(todayHero.savedTrainSessionId)}`);
      return;
    }
    if (todayHero?.key) {
      router.push({
        pathname: "/train/session/[sessionKey]",
        params: { sessionKey: todayHero.key },
      });
      return;
    }
    go("/home/calendar");
  };

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[
          isDark ? "rgba(230,255,59,0.12)" : "rgba(230,255,59,0.2)",
          colors.bg,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.topFade}
        pointerEvents="none"
      />

      <View style={styles.page}>
        <HomeHeader
          greeting={greeting}
          dateLabel={dateLabel}
          statusLabel={statusLabel}
          refreshing={refreshing}
          colors={colors}
          styles={styles}
          onRefresh={refresh}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {!!loadError && !loading ? (
            <Text style={[styles.errorText, { color: colors.subtext }]}>
              {loadError}
            </Text>
          ) : null}

          {!hasPlan && !loading ? (
            <NoPlanState
              styles={styles}
              colors={colors}
              accentBg={accentBg}
              onPress={() => go("/train/create-home")}
            />
          ) : (
            <>
              <TodayHero
                data={todayHero}
                styles={styles}
                colors={colors}
                accentBg={accentBg}
                onPrimaryPress={openTodayPrimary}
                onSecondaryPress={() => go("/home/calendar")}
              />

              <WeekProgress
                metrics={metrics}
                weekLabel={weekLabel}
                styles={styles}
                colors={colors}
              />

              <WeekTimeline
                items={timeline}
                styles={styles}
                colors={{ ...colors, isDark }}
                accentBg={accentBg}
                onSelectToday={() => go("/home/today")}
                onSelectCalendar={() => go("/home/calendar")}
              />

              <InsightBlock
                insight={insight}
                styles={styles}
                colors={colors}
                accentBg={accentBg}
              />

              <QuickActions
                items={quickActions}
                styles={styles}
                colors={colors}
                onPress={go}
              />
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(colors, isDark, accentBg) {
  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(17,17,17,0.08)";
  const heroBg = isDark ? "#101216" : "#F7F8FA";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    topFade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 240,
    },
    page: {
      flex: 1,
      paddingHorizontal: 20,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingBottom: 156,
      gap: 28,
    },
    header: {
      paddingTop: 6,
      paddingBottom: 22,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    headerGreeting: {
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: -0.6,
    },
    headerDate: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: "500",
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    statusChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 999,
    },
    statusText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    refreshButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
    },
    errorText: {
      fontSize: 13,
      lineHeight: 19,
      marginTop: -8,
    },
    hero: {
      backgroundColor: heroBg,
      borderRadius: 28,
      padding: 22,
      gap: 14,
    },
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    heroEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    heroStateChip: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(17,17,17,0.06)",
    },
    heroStateText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    heroTitle: {
      fontSize: 30,
      lineHeight: 34,
      fontWeight: "800",
      letterSpacing: -1,
    },
    heroSubtitle: {
      fontSize: 15,
      lineHeight: 22,
      maxWidth: "90%",
    },
    heroMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    heroMetaText: {
      fontSize: 13,
      fontWeight: "600",
      paddingRight: 10,
    },
    heroActionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 4,
    },
    heroPrimaryButton: {
      minHeight: 48,
      borderRadius: 999,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    heroPrimaryText: {
      color: "#111111",
      fontSize: 14,
      fontWeight: "800",
      letterSpacing: 0.2,
    },
    heroSecondaryButton: {
      minHeight: 48,
      paddingHorizontal: 4,
      justifyContent: "center",
    },
    heroSecondaryText: {
      fontSize: 14,
      fontWeight: "700",
    },
    section: {
      gap: 12,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    sectionEyebrow: {
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    sectionMeta: {
      fontSize: 12,
      fontWeight: "600",
    },
    sectionLink: {
      fontSize: 13,
      fontWeight: "700",
    },
    metricRow: {
      flexDirection: "row",
      gap: 16,
    },
    metricItem: {
      flex: 1,
      position: "relative",
      paddingRight: 8,
    },
    metricValue: {
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    metricLabel: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: "600",
    },
    metricDivider: {
      position: "absolute",
      top: 2,
      right: -8,
      width: StyleSheet.hairlineWidth,
      bottom: 2,
      backgroundColor: divider,
    },
    timelineRow: {
      flexDirection: "row",
      gap: 6,
    },
    timelineItem: {
      flex: 1,
      minHeight: 104,
      borderRadius: 18,
      paddingHorizontal: 6,
      paddingVertical: 12,
      justifyContent: "space-between",
    },
    timelineDay: {
      fontSize: 9,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      textAlign: "center",
    },
    timelineDate: {
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: -0.5,
      textAlign: "center",
    },
    timelineLabel: {
      fontSize: 9,
      lineHeight: 12,
      fontWeight: "600",
      textAlign: "center",
    },
    insightDivider: {
      width: 36,
      height: 2,
      borderRadius: 999,
      backgroundColor: accentBg,
      marginBottom: 4,
    },
    insightTitle: {
      fontSize: 21,
      lineHeight: 27,
      fontWeight: "800",
      letterSpacing: -0.4,
      maxWidth: "85%",
    },
    insightBody: {
      fontSize: 14,
      lineHeight: 21,
      maxWidth: "92%",
    },
    insightAccent: {
      width: 100,
      height: 1,
      opacity: 0.45,
      marginTop: 4,
    },
    actionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    actionPill: {
      minHeight: 42,
      borderRadius: 999,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(17,17,17,0.04)",
    },
    actionPillText: {
      fontSize: 13,
      fontWeight: "700",
    },
  });
}

```

### app/(protected)/train/index.jsx

```jsx
// app/(protected)/train/index.jsx
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "../../components/LucideFeather";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { MASON_COACH_TEMPLATE_DOCS } from "./data/coachTemplates";

/* ──────────────────────────────────────────────────────────────
   Helpers + constants
────────────────────────────────────────────────────────────── */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const emptyWeek = () => ({ days: DAYS.map((d) => ({ day: d, sessions: [] })) });
const WEEK_CAROUSEL_FALLBACK_WIDTH = 320;

const PRIMARY = "#E6FF3B";
const JS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRAIN_INDEX_SCREEN_CACHE = {
  uid: "",
  hydrated: false,
  plan: null,
  companionPlan: null,
  calendarNow: null,
  currentWeekIndex: 0,
  selectedDayIndex: 0,
  sessionLogMap: {},
  sessionLogsReady: false,
  sessionLogsReadyKey: "",
  scrollOffsetY: 0,
  weekStripWidth: 0,
  coachPlans: [],
  coachPlansLoaded: false,
};

const SAMPLE_WORKOUTS = [
  {
    key: "run_easy_35",
    category: "running",
    type: "Run",
    title: "Easy aerobic run",
    summary: "Steady low-effort run to keep aerobic volume moving without extra fatigue.",
    bestFor: "Best for easy days or post-hard-session recovery volume.",
    durationMin: 35,
    distanceKm: 6.0,
    rpe: 4,
    notes: "Easy conversational pace. Keep effort controlled from start to finish.",
  },
  {
    key: "run_intervals_intro",
    category: "running",
    type: "Run",
    title: "Intervals intro",
    summary: "Short controlled efforts to touch speed without overloading the day.",
    bestFor: "Great when you want quality in a short time window.",
    durationMin: 32,
    distanceKm: 5.0,
    rpe: 7,
    notes: "10 min easy, 6 x 1 min hard / 1 min easy, then cool down.",
  },
  {
    key: "bodyweight_20",
    category: "strength",
    type: "Bodyweight",
    title: "Bodyweight circuit",
    summary: "Simple full-body circuit for strength stimulus without gym equipment.",
    bestFor: "Ideal for busy days when you still want purposeful strength work.",
    durationMin: 20,
    distanceKm: null,
    rpe: 6,
    notes: "3 rounds: squats, reverse lunges, push-ups, plank. Move with control.",
  },
  {
    key: "strength_40",
    category: "strength",
    type: "Strength",
    title: "Strength session",
    summary: "Compound-led gym session focused on controlled load and clean reps.",
    bestFor: "Good for maintaining strength while building weekly consistency.",
    durationMin: 40,
    distanceKm: null,
    rpe: 7,
    notes: "Focus on compound lifts and core. Keep 1-2 reps in reserve.",
  },
  {
    key: "hybrid_engine_30",
    category: "hybrid",
    type: "Hybrid",
    title: "Hybrid engine builder",
    summary: "Mixed run and functional work to build pacing and transition control.",
    bestFor: "Great for HYROX-style sessions or mixed fitness days.",
    durationMin: 30,
    distanceKm: 3.5,
    rpe: 6,
    notes: "Mixed run and functional work. Stay controlled and keep transitions smooth.",
  },
  {
    key: "recovery_flow_25",
    category: "recovery",
    type: "Recovery",
    title: "Recovery mobility flow",
    summary: "Light mobility and reset work to improve recovery readiness.",
    bestFor: "Best after heavy days when you need low-stress movement.",
    durationMin: 25,
    distanceKm: null,
    rpe: 2,
    notes: "Mobility, breathing, and light core. Reset for the next hard day.",
  },
];

const QUICK_CREATE_TILES = [
  {
    sampleKey: "run_easy_35",
    label: "Easy Run",
    kicker: "Aerobic",
    icon: "activity",
    colors: ["#A4D53A", "#6E9722"],
  },
  {
    sampleKey: "run_intervals_intro",
    label: "Intervals",
    kicker: "Quality",
    icon: "zap",
    colors: ["#F3BE37", "#D66A1E"],
  },
  {
    sampleKey: "strength_40",
    label: "Strength",
    kicker: "Gym",
    icon: "bar-chart-2",
    colors: ["#6F8E54", "#435A33"],
  },
  {
    sampleKey: "bodyweight_20",
    label: "Bodyweight",
    kicker: "No kit",
    icon: "user",
    colors: ["#4C86D7", "#365BA6"],
  },
  {
    sampleKey: "hybrid_engine_30",
    label: "Hybrid",
    kicker: "Run + work",
    icon: "shuffle",
    colors: ["#31A68D", "#1E6D66"],
  },
  {
    sampleKey: "recovery_flow_25",
    label: "Recovery",
    kicker: "Reset",
    icon: "moon",
    colors: ["#8B909B", "#555B67"],
  },
];

const NO_PLAN_NOTE =
  "Start with one sample workout or quick log today. Build your full plan once your weekly rhythm is clearer.";
const TIP_CARD_IMAGE_A = require("../../../assets/images/run.jpeg");
const TIP_CARD_IMAGE_B = require("../../../assets/images/home/img_home_hero_today.jpg");

const TRAINING_TIP_TOPICS = [
  {
    key: "gut-training",
    title: "Gut training for long events",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Train your gut like your legs. Progress carbs weekly so race-day fueling feels normal.",
    author: "Coach Team",
    updatedText: "Updated 2 months ago",
    intro:
      "Long events demand both strong legs and a prepared gut. Start small in training and build consistency before you increase race intensity.",
    bullets: [
      "Practice race fuel in long sessions, not just on race day.",
      "Match gel timing to your race plan and stick to it.",
      "If GI issues appear, reduce dose and build back gradually.",
    ],
    sectionTitle: "Common mistakes to avoid",
    sectionBody:
      "Do not test new products on race week. Keep your fueling source, timing, and dose stable in the final build so your race plan is repeatable under stress.",
  },
  {
    key: "heat-acclimation",
    title: "Heat acclimation protocol",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Use controlled heat exposure 7-14 days before a hot race block to improve tolerance.",
    author: "Coach Team",
    updatedText: "Updated 6 weeks ago",
    intro:
      "Heat sessions should be progressive, controlled, and recovery-aware. Start with easier efforts and let your body adapt before pushing session quality.",
    bullets: [
      "Keep intensity modest at first and watch hydration closely.",
      "Use post-session weight checks to estimate fluid loss.",
      "Prioritise sleep and electrolytes during acclimation phases.",
    ],
    sectionTitle: "How to apply this this week",
    sectionBody:
      "Add 2-3 short controlled heat exposures after easy training. Track perceived effort and resting fatigue so you adapt without carrying excess load.",
  },
  {
    key: "hyrox-transitions",
    title: "HYROX transition efficiency",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Free speed comes from efficient transitions and fast breathing recovery between stations.",
    author: "Coach Team",
    updatedText: "Updated 1 month ago",
    intro:
      "Most HYROX time leaks happen between stations, not only in work blocks. Rehearse transitions under fatigue so you keep momentum and protect pacing.",
    bullets: [
      "Rehearse entry and exit for each station under fatigue.",
      "Use a single cue per station to stay consistent.",
      "Treat transitions as race segments, not downtime.",
    ],
    sectionTitle: "Execution cue",
    sectionBody:
      "Use one anchor cue for each station, then move immediately. Remove decision friction and keep each transition mechanically identical.",
  },
  {
    key: "race-morning",
    title: "Race morning pacing strategy",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Race execution is won by disciplined starts and effort control, not early speed.",
    author: "Coach Team",
    updatedText: "Updated 3 weeks ago",
    intro:
      "Your first segment sets the whole race. Start below emotional effort, settle breathing, then progress when your mechanics and heart rate are stable.",
    bullets: [
      "Open below target intensity for the first 10-15 minutes.",
      "Use checkpoints to avoid drifting above planned effort.",
      "Save final push for when form and breathing stay stable.",
    ],
    sectionTitle: "Pre-race checklist",
    sectionBody:
      "Lock pacing bands, warm-up timing, and first-fuel timing before the start line. A simple checklist reduces panic pacing in the opening phase.",
  },
  {
    key: "female-cycle",
    title: "Female cycle and training load",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Cycle-aware planning helps place quality where readiness is strongest and recovery where needed.",
    author: "Coach Team",
    updatedText: "Updated 5 weeks ago",
    intro:
      "Use simple symptom and performance tracking to spot your personal readiness pattern. Over time, this improves consistency across harder training blocks.",
    bullets: [
      "Track symptoms and performance trends across phases.",
      "Shift high-quality sessions to stronger readiness days when possible.",
      "Adjust fueling and recovery support around high-fatigue windows.",
    ],
    sectionTitle: "Practical setup",
    sectionBody:
      "Log sleep quality, soreness, mood, and session RPE in one place. Patterns appear quickly and help coach-level adjustments without guesswork.",
  },
  {
    key: "altitude-travel",
    title: "Altitude and travel prep",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Travel and altitude alter effort response, so simplify early sessions and stabilise routines.",
    author: "Coach Team",
    updatedText: "Updated 7 weeks ago",
    intro:
      "The first days after travel are for adaptation, not hero sessions. Keep intensity controlled and prioritise hydration, sleep, and routine timing.",
    bullets: [
      "Arrive with buffer days when possible.",
      "Lower early-session intensity and monitor HR drift.",
      "Hydration and sleep are your first performance priorities.",
    ],
    sectionTitle: "First 48-hour rule",
    sectionBody:
      "Treat the first two days as adaptation days. Keep runs easy, shorten strength sessions, and avoid max efforts while your system recalibrates.",
  },
  {
    key: "caffeine-timing",
    title: "Caffeine timing strategy",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Caffeine is most effective when dose and timing are tested in training before race day.",
    author: "Coach Team",
    updatedText: "Updated 4 weeks ago",
    intro:
      "Caffeine can boost performance, but only when the protocol is familiar. Trial in key sessions so race day feels predictable instead of risky.",
    bullets: [
      "Trial dose and timing in key sessions before racing.",
      "Avoid stacking too much too early in longer events.",
      "Protect sleep by using lower doses late in the day.",
    ],
    sectionTitle: "Dose discipline",
    sectionBody:
      "More is not always better. Use the smallest dose that gives a clear effect and repeat that protocol in training to confirm tolerance.",
  },
  {
    key: "downhill-cadence",
    title: "Downhill cadence control",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "Downhill speed comes from cadence and stability, not bigger stride length.",
    author: "Coach Team",
    updatedText: "Updated 2 weeks ago",
    intro:
      "Controlled downhill running saves your legs and protects race rhythm. Focus on quick feet, stable torso, and light ground contact when pace rises.",
    bullets: [
      "Increase cadence slightly and keep contact light.",
      "Stay tall with hips stable and eyes forward.",
      "Use downhill drills to build confidence before race terrain.",
    ],
    sectionTitle: "Drill option",
    sectionBody:
      "Use short downhill repeats with full recovery and form cues only. Build confidence first, then increase speed once mechanics stay clean.",
  },
  {
    key: "strength-taper",
    title: "Strength taper before race week",
    image: TIP_CARD_IMAGE_A,
    subtitle:
      "Maintain strength stimulus while reducing fatigue in the final pre-race phase.",
    author: "Coach Team",
    updatedText: "Updated 8 weeks ago",
    intro:
      "A good taper keeps movement quality and neural sharpness without residual soreness. Keep key patterns, reduce volume, and avoid novelty close to race day.",
    bullets: [
      "Lower volume first, then lower intensity if needed.",
      "Avoid introducing new lifts close to race day.",
      "Prioritise movement quality and freshness over load.",
    ],
    sectionTitle: "Session focus",
    sectionBody:
      "Choose low-risk compounds and keep reps crisp. End sets with reserve so your running quality remains high through the taper window.",
  },
  {
    key: "taper-anxiety",
    title: "Taper anxiety management",
    image: TIP_CARD_IMAGE_B,
    subtitle:
      "A calm taper improves race execution. Keep routines stable and reduce decision noise.",
    author: "Coach Team",
    updatedText: "Updated 10 days ago",
    intro:
      "Most taper anxiety comes from reduced volume and extra mental space. Replace uncertainty with simple routines and a fixed race-week checklist.",
    bullets: [
      "Use short confidence sessions instead of extra volume.",
      "Lock kit, pacing, and fueling plans early.",
      "Replace overthinking with checklist-based preparation.",
    ],
    sectionTitle: "Mental reset prompt",
    sectionBody:
      "When anxiety rises, return to your checklist: sleep, hydration, fueling, and pacing cues. Structure calms decision fatigue before race day.",
  },
];

function inferPlanKindFromDoc(planDoc) {
  const kind = String(planDoc?.kind || "").toLowerCase();
  const source = String(planDoc?.source || "").toLowerCase();
  const primary = String(
    planDoc?.primaryActivity || planDoc?.meta?.primaryActivity || ""
  ).toLowerCase();

  if (
    kind === "run" ||
    primary.includes("run") ||
    source.includes("generate-run") ||
    source.includes("run")
  ) {
    return "run";
  }

  if (
    kind === "strength" ||
    primary.includes("strength") ||
    primary.includes("gym") ||
    source.includes("generate-strength") ||
    source.includes("strength")
  ) {
    return "strength";
  }

  return kind || "training";
}

function getTodayPlanDayIndex(dateLike = new Date()) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const label = JS_DAY_LABELS[date.getDay()];
  const idx = DAYS.indexOf(label);
  return idx >= 0 ? idx : 0;
}

function sessionSportKind(sess) {
  const raw = String(
    sess?.workout?.sport || sess?.sessionType || sess?.type || ""
  ).toLowerCase();

  if (raw.includes("strength") || raw.includes("gym")) return "strength";
  if (raw.includes("run")) return "run";

  const runTypes = new Set([
    "easy",
    "recovery",
    "interval",
    "intervals",
    "threshold",
    "tempo",
    "long",
    "race",
    "strides",
    "fartlek",
  ]);
  if (runTypes.has(raw)) return "run";

  return "other";
}

function sortMergedSessions(sessions) {
  const arr = Array.isArray(sessions) ? [...sessions] : [];
  const rank = (sess) => {
    const sport = sessionSportKind(sess);
    if (sport === "run") return 0;
    if (sport === "strength") return 1;
    return 2;
  };
  arr.sort((a, b) => rank(a) - rank(b));
  return arr;
}

function sampleIconName(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("run")) return "activity";
  if (t.includes("strength")) return "bar-chart-2";
  if (t.includes("hybrid")) return "shuffle";
  if (t.includes("recovery")) return "moon";
  if (t.includes("bodyweight")) return "user";
  return "layers";
}

function sampleEffortLabel(rpe) {
  const x = Number(rpe || 0);
  if (!x) return "Unspecified";
  if (x <= 3) return "Very easy";
  if (x <= 5) return "Easy";
  if (x <= 7) return "Moderate";
  if (x <= 8) return "Hard";
  return "Very hard";
}

function sampleSecondaryMeta(sample) {
  const type = String(sample?.type || "").toLowerCase();
  if (Number.isFinite(Number(sample?.distanceKm)) && Number(sample.distanceKm) > 0) {
    return `${Number(sample.distanceKm).toFixed(1)} km`;
  }
  if (type.includes("strength") || type.includes("bodyweight")) return "Strength focus";
  if (type.includes("recovery")) return "Mobility focus";
  if (type.includes("hybrid")) return "Mixed format";
  return "Training focus";
}

function useScreenTheme() {
  const { colors, isDark } = useTheme();
  const silverLight = colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  return {
    bg: colors.bg,
    card: isDark ? "#111217" : silverLight,
    card2: isDark ? "#0E0F12" : "#FFFFFF",
    text: colors.text,
    subtext: colors.subtext,
    border: isDark ? "#1F2128" : silverMed,
    primaryBg: colors?.accentBg ?? PRIMARY,
    primaryText: "#111111",
    headerTitle: colors.text,
    headerSubtitle: colors.subtext,
    isDark,
  };
}

function startOfISOWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function toISODate(d) {
  const dd = new Date(d);
  const yyyy = dd.getFullYear();
  const mm = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${day}`;
}
function fmtDayDate(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const normaliseStr = (s) => String(s || "").trim();

function parseDateLike(value) {
  if (!value) return null;

  try {
    if (typeof value?.toDate === "function") {
      const fromTimestamp = value.toDate();
      if (fromTimestamp instanceof Date && !Number.isNaN(fromTimestamp.getTime())) {
        fromTimestamp.setHours(0, 0, 0, 0);
        return fromTimestamp;
      }
    }
  } catch {}

  const raw =
    typeof value === "string" || typeof value === "number" ? value : value instanceof Date ? value : null;

  if (!raw) return null;

  if (raw instanceof Date) {
    const out = new Date(raw);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }

  const ymdMatch = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const yyyy = Number(ymdMatch[1]);
    const mm = Number(ymdMatch[2]);
    const dd = Number(ymdMatch[3]);
    const out = new Date(yyyy, mm - 1, dd);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }

  const out = new Date(raw);
  if (Number.isNaN(out.getTime())) return null;
  out.setHours(0, 0, 0, 0);
  return out;
}

function resolvePlanWeekZeroStart(planDoc, sessionLogMap = null) {
  if (!planDoc) return null;

  const planId = String(planDoc?.id || "").trim();
  if (planId && sessionLogMap && typeof sessionLogMap === "object") {
    const anchorVotes = new Map();
    Object.values(sessionLogMap).forEach((log) => {
      if (String(log?.planId || "").trim() !== planId) return;
      const weekIndex = Number(log?.weekIndex);
      const dayIndex = Number(log?.dayIndex);
      if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return;

      const logDate =
        parseDateLike(log?.date) ||
        parseDateLike(log?.statusAt) ||
        parseDateLike(log?.completedAt) ||
        parseDateLike(log?.updatedAt) ||
        parseDateLike(log?.createdAt);
      if (!logDate) return;

      const anchor = addDays(logDate, -(Math.round(weekIndex) * 7 + Math.round(dayIndex)));
      anchor.setHours(0, 0, 0, 0);
      const key = toISODate(anchor);
      const prev = anchorVotes.get(key) || 0;
      anchorVotes.set(key, prev + 1);
    });

    if (anchorVotes.size) {
      const sorted = [...anchorVotes.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]));
      });
      const top = sorted[0]?.[0];
      const parsed = parseDateLike(top);
      if (parsed) return startOfISOWeek(parsed);
    }
  }

  const weeks = Array.isArray(planDoc?.weeks) ? planDoc.weeks : [];
  for (let idx = 0; idx < weeks.length; idx += 1) {
    const week = weeks[idx];
    const weekIndex0 = Number.isFinite(Number(week?.weekIndex0)) ? Number(week.weekIndex0) : idx;
    const explicitWeekStart = parseDateLike(week?.weekStartDate || week?.startDate);
    if (explicitWeekStart) {
      return startOfISOWeek(addDays(explicitWeekStart, -(weekIndex0 * 7)));
    }

    const days = Array.isArray(week?.days) ? week.days : [];
    for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
      const explicitDayDate = parseDateLike(days[dayIdx]?.date || days[dayIdx]?.isoDate);
      if (explicitDayDate) {
        return startOfISOWeek(addDays(explicitDayDate, -(weekIndex0 * 7 + dayIdx)));
      }
    }
  }

  const fallbackStart = parseDateLike(
    planDoc?.startDate ||
      planDoc?.plan?.startDate ||
      planDoc?.meta?.startDate ||
      planDoc?.weekStartDate ||
      planDoc?.plan?.weekStartDate ||
      planDoc?.createdAt ||
      planDoc?.updatedAt
  );
  return fallbackStart ? startOfISOWeek(fallbackStart) : null;
}

function deriveCurrentPlanWeekIndex(plans, today = new Date(), totalWeeks = 0, sessionLogMap = null) {
  const anchors = (Array.isArray(plans) ? plans : [])
    .map((planDoc) => resolvePlanWeekZeroStart(planDoc, sessionLogMap))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!anchors.length) return 0;

  const baseWeekStart = anchors[0];
  const todayWeekStart = startOfISOWeek(today);
  const diffDays = Math.floor((todayWeekStart.getTime() - baseWeekStart.getTime()) / 86400000);
  const rawWeekIndex = Math.floor(diffDays / 7);
  const clamped = Math.max(0, rawWeekIndex);

  if (totalWeeks > 0) return Math.min(clamped, totalWeeks - 1);
  return clamped;
}

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function formatPaceFromSecPerKm(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}/km`;
}

function formatBpmRange(range) {
  if (!range) return null;
  const min = Number(range?.minBpm ?? range?.min);
  const max = Number(range?.maxBpm ?? range?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return `${Math.round(min)}-${Math.round(max)} bpm`;
}

function formatPaceRange(range) {
  if (!range) return null;
  const min = Number(range?.minSecPerKm);
  const max = Number(range?.maxSecPerKm);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const fast = formatPaceFromSecPerKm(min);
  const slow = formatPaceFromSecPerKm(max);
  if (!fast || !slow) return null;
  return `${fast}-${slow}`;
}

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function getSessionGuidance(sess) {
  const warmupMin = Number(sess?.warmupMin);
  const cooldownMin = Number(sess?.cooldownMin);
  const pace = formatPaceRange(sess?.targetPace || sess?.workout?.paceTarget);
  const hr = formatBpmRange(sess?.targetHr || sess?.workout?.hrTarget);

  const parts = [];
  if (Number.isFinite(warmupMin) && warmupMin > 0) parts.push(`WU ${Math.round(warmupMin)}m`);
  if (Number.isFinite(cooldownMin) && cooldownMin > 0) parts.push(`CD ${Math.round(cooldownMin)}m`);
  if (pace) parts.push(`Pace ${pace}`);
  if (hr) parts.push(`HR ${hr}`);
  return parts.join(" · ");
}

function sumSessionMeta(sess) {
  const durationMin =
    sess?.workout?.totalDurationSec != null
      ? Math.round(sess.workout.totalDurationSec / 60)
      : sess?.targetDurationMin ?? sess?.durationMin ?? null;

  const distanceKm =
    sess?.workout?.totalDistanceKm != null
      ? sess.workout.totalDistanceKm
      : sess?.targetDistanceKm ?? sess?.distanceKm ?? sess?.plannedDistanceKm ?? null;

  const pace = sess?.workout?.steps?.find?.((st) => st?.pace?.secPerKm)?.pace?.secPerKm;
  const paceFmt = pace ? formatPaceFromSecPerKm(pace) : null;

  const parts = [];
  if (durationMin) parts.push(`${durationMin}m`);
  if (distanceKm) parts.push(`${Number(distanceKm).toFixed(1)}k`);
  if (paceFmt) parts.push(paceFmt);
  return parts.join(" · ");
}

function sessionTypeLabel(sess) {
  const t = String(sess?.sessionType || sess?.type || "training").toLowerCase();
  if (t === "run") return "Run";
  if (t === "gym" || t.includes("strength")) return "Strength";
  if (t.includes("hyrox")) return "Hyrox";
  if (t.includes("mob")) return "Mobility";
  if (t.includes("rest")) return "Rest";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function typeIconName(sess) {
  const sport = sessionSportKind(sess);
  if (sport === "run") return "activity";
  if (sport === "strength") return "zap";
  const t = String(sess?.sessionType || sess?.type || "training").toLowerCase();
  if (t.includes("mob")) return "heart";
  if (t.includes("yoga")) return "heart";
  if (t.includes("hyrox")) return "target";
  return "layers";
}

function typePipColor(theme, sess) {
  if (sessionSportKind(sess) === "run") return theme.primaryBg;
  return theme.isDark ? "rgba(148,163,184,0.45)" : "rgba(15,23,42,0.15)";
}

/* ──────────────────────────────────────────────────────────────
   Plan normalisation
────────────────────────────────────────────────────────────── */
const mkStep = (over = {}) => ({
  type: over.type || "Run",
  notes: over.notes || "",
  durationType: over.durationType || "Time (min)",
  durationValue: Number(over.durationValue ?? (over.durationType === "Distance (km)" ? 1 : 10)),
  intensityType: over.intensityType || "None",
  intensityTarget: over.intensityTarget || "",
  isRepeat: over.isRepeat || false,
  repeatReps: Number(over.repeatReps || 2),
  steps: Array.isArray(over.steps) ? over.steps : [],
});

const withWarmCool = (session) => {
  const steps = Array.isArray(session.segments) ? session.segments : [];
  const hasWU = steps.some((s) => /^warm/i.test(s.type));
  const hasCD = steps.some((s) => /^cool/i.test(s.type));
  const patched = [...steps];

  if (!hasWU) {
    patched.unshift(
      mkStep({
        type: "Warmup",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1–Z2",
        notes: "Build gradually; drills",
      })
    );
  }
  if (!hasCD) {
    patched.push(
      mkStep({
        type: "CoolDown",
        durationType: "Time (min)",
        durationValue: 10,
        intensityType: "HR Zone",
        intensityTarget: "Z1",
        notes: "Ease down; light mobility",
      })
    );
  }

  return { ...session, segments: patched };
};

function segmentToWorkoutStep(seg) {
  if (!seg) return null;

  if (seg.isRepeat) {
    return {
      type: "repeat",
      reps: Number(seg.repeatReps || 1),
      steps: (seg.steps || []).map((inner) => segmentToWorkoutStep(inner)).filter(Boolean),
    };
  }

  let durationType = "time";
  if (seg.durationType === "Distance (km)") durationType = "distance";
  else if (seg.durationType === "Reps") durationType = "reps";

  const base = {
    type: String(seg.type || "Run").toLowerCase(),
    durationType,
    durationValue: Number(seg.durationValue || 0),
  };

  if (seg.intensityType && seg.intensityType !== "None") {
    let intensityType = "custom";
    if (seg.intensityType === "Pace (/km)") intensityType = "pace";
    if (seg.intensityType === "HR Zone") intensityType = "hr";
    if (seg.intensityType === "RPE") intensityType = "rpe";

    base.intensity = { type: intensityType, target: seg.intensityTarget || "" };
  }

  if (seg.notes) base.notes = seg.notes;
  return base;
}
function segmentsToWorkoutSteps(segments) {
  return (segments || []).map((s) => segmentToWorkoutStep(s)).filter(Boolean);
}

function estimateTotalsFromWorkoutSteps(steps) {
  let totalDistanceKm = 0;
  let totalDurationSec = 0;

  const walk = (step, repsMultiplier = 1) => {
    if (!step) return;

    if (step.type === "repeat" && Array.isArray(step.steps)) {
      const reps = Number(step.reps || 1);
      step.steps.forEach((inner) => walk(inner, repsMultiplier * reps));
      return;
    }

    const durType = step.durationType;
    const val = Number(step.durationValue || 0);
    if (!Number.isFinite(val) || val <= 0) return;

    if (durType === "distance") {
      totalDistanceKm += val * repsMultiplier;
    } else if (durType === "time") {
      totalDurationSec += val * 60 * repsMultiplier;
    }
  };

  (steps || []).forEach((s) => walk(s, 1));

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationSec: Math.round(totalDurationSec),
  };
}

function stockStepToWorkoutStep(step) {
  if (!step || typeof step !== "object") return null;
  const t = String(step.type || "").toUpperCase();

  if (t === "REPEAT") {
    return {
      type: "repeat",
      reps: Number(step.repeat || 1),
      steps: (step.steps || []).map(stockStepToWorkoutStep).filter(Boolean),
      name: step.name || "Repeat",
      notes: step.notes || "",
    };
  }

  if (t === "RUN") {
    const durType = String(step?.duration?.type || "").toUpperCase();
    const durationType = durType === "DISTANCE" ? "distance" : "time";

    const durationValue =
      durationType === "distance"
        ? Number(step?.duration?.meters != null ? step.duration.meters / 1000 : step?.duration?.km || 0)
        : Number(step?.duration?.seconds != null ? step.duration.seconds / 60 : step?.duration?.minutes || 0);

    const out = {
      type: "run",
      durationType,
      durationValue: Number.isFinite(durationValue) ? durationValue : 0,
      name: step.name || "Run",
      notes: step.notes || "",
    };

    const paceSecPerKm = step?.target?.paceSecPerKm;
    const paceKey = step?.target?.paceKey;

    if (Number.isFinite(Number(paceSecPerKm))) {
      out.intensity = { type: "pace", target: String(Math.round(Number(paceSecPerKm))) };
      out.pace = { key: paceKey || "", secPerKm: Math.round(Number(paceSecPerKm)) };
    } else if (paceKey) {
      out.pace = { key: paceKey, secPerKm: null };
    }

    return out;
  }

  return {
    type: String(step.type || "step").toLowerCase(),
    durationType: "time",
    durationValue: 0,
    notes: step.notes || "",
  };
}
function stockStepsToWorkoutSteps(steps) {
  return (steps || []).map(stockStepToWorkoutStep).filter(Boolean);
}
function totalsFromStockSteps(steps) {
  let totalDistanceKm = 0;
  let totalDurationSec = 0;

  const walk = (st, mult = 1) => {
    if (!st) return;
    if (st.type === "repeat" && Array.isArray(st.steps)) {
      const reps = Number(st.reps || 1);
      st.steps.forEach((inner) => walk(inner, mult * reps));
      return;
    }
    const val = Number(st.durationValue || 0);
    if (!Number.isFinite(val) || val <= 0) return;

    if (st.durationType === "distance") totalDistanceKm += val * mult;
    if (st.durationType === "time") totalDurationSec += Math.round(val * 60 * mult);
  };

  (steps || []).forEach((st) => walk(st, 1));

  return {
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    totalDurationSec,
  };
}
function looksLikeStockSession(sess) {
  return Array.isArray(sess?.steps) && sess.steps.length > 0 && sess.steps.some((x) => x?.duration);
}

const normaliseSessionForPlan = (sess) => {
  if (!sess) return null;

  if (looksLikeStockSession(sess)) {
    const workoutSteps = stockStepsToWorkoutSteps(sess.steps);
    const totals = totalsFromStockSteps(workoutSteps);

    const explicitKm = Number(sess?.distanceKm ?? sess?.distance ?? sess?.plannedDistanceKm ?? 0) || 0;

    const totalDistanceKm = explicitKm || totals.totalDistanceKm || 0;
    const totalDurationSec = totals.totalDurationSec || 0;

    const sessionTypeRaw = sess?.sessionType || sess?.type || "RUN";
    const sessionType = String(sessionTypeRaw || "").toLowerCase();

    const title =
      sess?.name ||
      sess?.title ||
      (typeof sessionTypeRaw === "string" ? sessionTypeRaw : "Run");

    return {
      ...sess,
      title,
      name: title,
      type: sess?.type || "Run",
      sessionType: sessionType || "run",
      targetDistanceKm: sess?.targetDistanceKm ?? (totalDistanceKm ? totalDistanceKm : undefined),
      targetDurationMin: sess?.targetDurationMin ?? (totalDurationSec ? Math.round(totalDurationSec / 60) : undefined),
      totalDistanceKm,
      totalDurationSec,
      workout: {
        sport: "run",
        totalDistanceKm,
        totalDurationSec,
        steps: workoutSteps,
      },
    };
  }

  const sportKind = sessionSportKind(sess);
  const sessionType = String(sess.sessionType || sess.type || "").toLowerCase();

  if (sportKind === "strength" || sportKind === "other") {
    const existingWorkout = sess.workout || {};

    const durationMinRaw =
      existingWorkout.totalDurationSec != null
        ? existingWorkout.totalDurationSec / 60
        : sess.targetDurationMin ?? sess.durationMin ?? 0;

    const distanceKmRaw =
      existingWorkout.totalDistanceKm != null
        ? existingWorkout.totalDistanceKm
        : sess.targetDistanceKm ?? sess.distanceKm ?? 0;

    const durationMin = Number(durationMinRaw || 0) || undefined;
    const distanceKm = Number(distanceKmRaw || 0) || undefined;

    const totalDurationSec =
      existingWorkout.totalDurationSec != null
        ? existingWorkout.totalDurationSec
        : durationMin
        ? Math.round(durationMin * 60)
        : 0;

    const totalDistanceKm =
      existingWorkout.totalDistanceKm != null ? existingWorkout.totalDistanceKm : distanceKm || 0;

    return {
      ...sess,
      title: sess.title || sess.name || sess.type || "Session",
      sessionType: sportKind === "strength" ? "gym" : sessionType || "training",
      targetDurationMin: sess.targetDurationMin != null ? sess.targetDurationMin : durationMin,
      targetDistanceKm: sess.targetDistanceKm != null ? sess.targetDistanceKm : distanceKm,
      totalDurationSec,
      totalDistanceKm,
      workout: {
        sport:
          existingWorkout.sport ||
          (sportKind === "strength" ? "strength" : sessionType || "training"),
        totalDurationSec,
        totalDistanceKm,
        steps: Array.isArray(existingWorkout.steps) ? existingWorkout.steps : [],
      },
    };
  }

  const baseWithSegments = withWarmCool(sess.segments ? sess : { ...sess, segments: sess.segments || [] });
  let segments = Array.isArray(baseWithSegments.segments) ? baseWithSegments.segments : [];

  const durationMinRaw =
    baseWithSegments.targetDurationMin != null ? baseWithSegments.targetDurationMin : baseWithSegments.durationMin;
  const distanceKmRaw =
    baseWithSegments.targetDistanceKm != null ? baseWithSegments.targetDistanceKm : baseWithSegments.distanceKm;

  const durationMin = Number(durationMinRaw || 0) || undefined;
  const distanceKm = Number(distanceKmRaw || 0) || undefined;

  const hasMain = segments.some((s) => s && !/^(warm|cool)/i.test(String(s.type || "")) && !s.isRepeat);

  if (!hasMain) {
    let durationType = "Time (min)";
    let durationValue = 0;

    if (distanceKm && !durationMin) {
      durationType = "Distance (km)";
      durationValue = distanceKm;
    } else if (durationMin) {
      durationType = "Time (min)";
      durationValue = durationMin;
    } else {
      durationType = "Time (min)";
      durationValue = 10;
    }

    const warm = segments.find((s) => /^warm/i.test(String(s.type || "")));
    const cool = segments.find((s) => /^cool/i.test(String(s.type || "")));

    const newSegs = [];
    if (warm) newSegs.push(warm);
    newSegs.push(
      mkStep({
        type: "Run",
        durationType,
        durationValue,
        intensityType: "None",
        notes: baseWithSegments.notes || "",
      })
    );
    if (cool) newSegs.push(cool);

    if (newSegs.length) segments = newSegs;
  }

  const workoutSteps =
    baseWithSegments.workout?.steps && baseWithSegments.workout.steps.length
      ? baseWithSegments.workout.steps
      : segmentsToWorkoutSteps(segments);

  const totalsFromSteps = estimateTotalsFromWorkoutSteps(workoutSteps);

  const finalDistanceKm =
    totalsFromSteps.totalDistanceKm || baseWithSegments.workout?.totalDistanceKm || distanceKm || 0;
  const finalDurationSec =
    totalsFromSteps.totalDurationSec ||
    baseWithSegments.workout?.totalDurationSec ||
    (durationMin ? durationMin * 60 : 0);

  const finalDurationMin = finalDurationSec ? finalDurationSec / 60 : durationMin || 0;

  return {
    ...baseWithSegments,
    title: baseWithSegments.title || baseWithSegments.name || baseWithSegments.type || "Run",
    sessionType: "run",
    type: baseWithSegments.type || "Run",
    segments,
    targetDurationMin:
      baseWithSegments.targetDurationMin != null ? baseWithSegments.targetDurationMin : finalDurationMin || undefined,
    targetDistanceKm:
      baseWithSegments.targetDistanceKm != null ? baseWithSegments.targetDistanceKm : finalDistanceKm || undefined,
    totalDistanceKm: finalDistanceKm || undefined,
    totalDurationSec: finalDurationSec || undefined,
    workout: {
      sport: baseWithSegments.workout?.sport || "run",
      totalDistanceKm: finalDistanceKm || 0,
      totalDurationSec: finalDurationSec || 0,
      steps: workoutSteps,
    },
  };
};

const normaliseWeeksForClient = (weeks) =>
  (weeks || []).map((w, wi) => {
    const rawDays = Array.isArray(w?.days) ? w.days : [];
    const dayMap = new Map(rawDays.map((d) => [d?.day, d]));

    const days = DAYS.map((dayLabel) => {
      const d = dayMap.get(dayLabel) || { day: dayLabel, sessions: [] };
      const sessions = (Array.isArray(d?.sessions) ? d.sessions : [])
        .map(normaliseSessionForPlan)
        .filter(Boolean);

      return { day: dayLabel, sessions };
    });

    return {
      title: w?.title || `Week ${wi + 1}`,
      weekIndex0: typeof w?.weekIndex0 === "number" ? w.weekIndex0 : wi,
      weekNumber: typeof w?.weekNumber === "number" ? w.weekNumber : wi + 1,
      weekStartDate: w?.weekStartDate || w?.startDate || null,
      weekEndDate: w?.weekEndDate || w?.endDate || null,
      days: days.map((day, dayIdx) => ({
        ...day,
        date: rawDays?.[dayIdx]?.date || dayMap.get(day.day)?.date || null,
      })),
    };
  });

function timestampMs(v) {
  if (!v) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v?.toMillis === "function") {
    try {
      const ms = v.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }
  const d = new Date(v);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function resolveSessionLogStatus(log) {
  const raw = String(log?.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "skipped") return raw;
  if (log?.skippedAt) return "skipped";
  if (log?.completedAt || log?.lastTrainSessionId) return "completed";
  return "";
}

function trainSessionIsoDate(session) {
  const explicit = String(session?.date || session?.isoDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  const parsed =
    parseDateLike(session?.completedAt) ||
    parseDateLike(session?.updatedAt) ||
    parseDateLike(session?.createdAt);

  return parsed ? toISODate(parsed) : "";
}

function isUnlinkedCompletedTrainSession(session, linkedTrainSessionIds = new Set()) {
  if (!session?.id) return false;
  if (linkedTrainSessionIds.has(String(session.id))) return false;
  if (String(session?.sessionKey || "").trim()) return false;
  if (Number.isFinite(Number(session?.weekIndex)) && Number.isFinite(Number(session?.dayIndex))) {
    return false;
  }

  const status = String(session?.status || "").trim().toLowerCase();
  return (
    status === "completed" ||
    !!session?.completedAt ||
    !!session?.actualDurationMin ||
    !!session?.actualDistanceKm ||
    Number(session?.workout?.totalDurationSec || 0) > 0 ||
    Number(session?.workout?.totalDistanceKm || 0) > 0
  );
}

function completedTrainSessionMeta(session) {
  const durationMin =
    session?.workout?.totalDurationSec != null
      ? Math.round(Number(session.workout.totalDurationSec || 0) / 60)
      : session?.actualDurationMin ?? session?.durationMin ?? session?.targetDurationMin ?? null;

  const distanceKm =
    session?.workout?.totalDistanceKm != null
      ? session.workout.totalDistanceKm
      : session?.actualDistanceKm ?? session?.distanceKm ?? session?.targetDistanceKm ?? null;

  const parts = [];
  if (durationMin) parts.push(`${Math.round(Number(durationMin))}m`);
  if (distanceKm) parts.push(`${Number(distanceKm).toFixed(1)}k`);
  return parts.join(" · ");
}

function isResolvedSessionStatus(status) {
  return status === "completed" || status === "skipped";
}

function pickPriorityCard(cards) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return { card: null, index: -1 };

  const pendingIndex = list.findIndex((card) => !isResolvedSessionStatus(card?.status));
  const resolvedIndex = pendingIndex >= 0 ? pendingIndex : 0;

  return {
    card: list[resolvedIndex] || null,
    index: resolvedIndex,
  };
}

function summariseCardStatuses(cards) {
  const list = Array.isArray(cards) ? cards : [];
  let completed = 0;
  let skipped = 0;
  let pending = 0;

  list.forEach((card) => {
    const status = String(card?.status || "").toLowerCase();
    if (status === "completed") {
      completed += 1;
      return;
    }
    if (status === "skipped") {
      skipped += 1;
      return;
    }
    pending += 1;
  });

  return {
    total: list.length,
    completed,
    skipped,
    pending,
    resolved: completed + skipped,
  };
}

function extractWeeksFromPlanDoc(data) {
  if (!data || typeof data !== "object") return [];
  const cands = [
    data?.weeks,
    data?.plan?.weeks,
    data?.planData?.weeks,
    data?.generatedPlan?.weeks,
    data?.activePlan?.weeks,
    data?.template?.weeks,
    data?.payload?.weeks,
  ];
  for (const item of cands) {
    if (Array.isArray(item) && item.length) return item;
  }
  return [];
}

function countSessionsInWeeks(weeks) {
  let total = 0;
  for (const week of Array.isArray(weeks) ? weeks : []) {
    const days = Array.isArray(week?.days) ? week.days : [];
    for (const day of days) {
      total += Array.isArray(day?.sessions) ? day.sessions.length : 0;
    }
    if (!days.length && Array.isArray(week?.sessions)) {
      total += week.sessions.length;
    }
  }
  return total;
}

function getCoachNameFromDoc(data) {
  return (
    normaliseStr(data?.coachName) ||
    normaliseStr(data?.coach?.name) ||
    normaliseStr(data?.meta?.coachName) ||
    normaliseStr(data?.authorName) ||
    normaliseStr(data?.createdByName)
  );
}

function isCoachSetPlanDoc(data) {
  if (!data || typeof data !== "object") return false;

  if (
    data?.isCoachPlan ||
    data?.isPublished ||
    data?.published ||
    data?.public === true ||
    data?.visibility === "public" ||
    data?.meta?.isCoachPlan ||
    data?.meta?.published
  ) {
    return true;
  }

  const source = String(data?.source || data?.plan?.source || "").toLowerCase();
  if (source.includes("coach") || source.includes("stock-template")) return true;

  const role = String(
    data?.createdByRole || data?.authorRole || data?.meta?.createdByRole || ""
  ).toLowerCase();
  if (role.includes("coach")) return true;

  return !!getCoachNameFromDoc(data);
}

function normaliseCoachPlanCandidate({ sourceCollection, docData, currentUid }) {
  if (!docData || typeof docData !== "object") return null;

  const ownerUid = String(
    docData?.uid || docData?.userId || docData?.ownerId || docData?.createdByUid || ""
  );
  if (currentUid && ownerUid && ownerUid === currentUid) return null;

  if (!isCoachSetPlanDoc(docData)) return null;

  const weeksRaw = extractWeeksFromPlanDoc(docData);
  if (!weeksRaw.length) return null;

  const weeks = normaliseWeeksForClient(weeksRaw);
  if (!weeks.length) return null;

  const kind = inferPlanKindFromDoc(docData);
  const name =
    normaliseStr(docData?.meta?.name) ||
    normaliseStr(docData?.plan?.name) ||
    normaliseStr(docData?.planName) ||
    normaliseStr(docData?.name) ||
    "Coach plan";

  const description =
    normaliseStr(docData?.description) ||
    normaliseStr(docData?.summary) ||
    normaliseStr(docData?.meta?.summary) ||
    normaliseStr(docData?.primaryFocus) ||
    "";

  const primaryActivity =
    normaliseStr(docData?.primaryActivity) ||
    normaliseStr(docData?.meta?.primaryActivity) ||
    (kind === "strength" ? "Strength" : kind === "run" ? "Run" : "Training");

  const sortMs = Math.max(timestampMs(docData?.updatedAt), timestampMs(docData?.createdAt));

  return {
    id: String(docData.id),
    sourceCollection,
    name,
    description,
    coachName: getCoachNameFromDoc(docData) || "Coach set",
    kind,
    primaryActivity,
    weekCount: weeks.length,
    sessionCount: countSessionsInWeeks(weeks),
    sortMs,
    weeks,
    raw: { ...docData },
  };
}

function findFirstSessionKeyFromWeeks(planId, weeks) {
  if (!planId) return null;
  const list = Array.isArray(weeks) ? weeks : [];
  for (let wi = 0; wi < list.length; wi += 1) {
    const week = list[wi];
    const days = Array.isArray(week?.days) ? week.days : [];
    for (let di = 0; di < days.length; di += 1) {
      const sessions = Array.isArray(days[di]?.sessions) ? days[di].sessions : [];
      if (sessions.length) {
        return buildSessionKey(planId, wi, di, 0);
      }
    }
  }
  return null;
}

function DayPill({ theme, item, onPress }) {
  const active = item.isToday;
  const sessionCount = Array.isArray(item.cards) ? item.cards.length : 0;
  const has = sessionCount > 0;
  const statusLabel = active ? "Today" : has ? "Planned" : "Rest";
  const detailLabel = has ? `${sessionCount} session${sessionCount > 1 ? "s" : ""}` : "Recovery / open";
  const statusBg = active ? theme.primaryBg : has ? theme.card2 : "transparent";
  const statusText = active ? theme.primaryText : has ? theme.text : theme.subtext;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        s.dayPill,
        {
          backgroundColor: active ? theme.card2 : theme.card,
          borderColor: active ? theme.primaryBg : theme.border,
        },
      ]}
    >
      <View style={s.dayPillTop}>
        <Text style={[s.dayPillDow, { color: active ? theme.text : theme.text }]}>{item.dayLabel}</Text>
        <Text style={[s.dayPillDate, { color: theme.subtext }]} numberOfLines={1}>
          {item.dateShort}
        </Text>
      </View>

      <View
        style={[
          s.dayPillStatus,
          {
            backgroundColor: statusBg,
            borderColor: has || active ? "rgba(0,0,0,0)" : theme.border,
          },
        ]}
      >
        <Text style={[s.dayPillStatusText, { color: statusText }]}>{statusLabel}</Text>
      </View>
      <Text style={[s.dayPillMeta, { color: theme.subtext }]} numberOfLines={1}>
        {detailLabel}
      </Text>
    </TouchableOpacity>
  );
}

function ActionRowButton({ icon, label, theme, onPress, primary = false }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        s.actionRowBtn,
        primary
          ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
          : { backgroundColor: theme.card2, borderColor: theme.border },
      ]}
    >
      <Feather name={icon} size={14} color={primary ? theme.primaryText : theme.text} />
      <Text style={{ color: primary ? theme.primaryText : theme.text, fontWeight: "700", fontSize: 13 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ──────────────────────────────────────────────────────────────
   Main screen
────────────────────────────────────────────────────────────── */
export default function TrainIndex() {
  const theme = useScreenTheme();
  const quietSectionSurface = theme.isDark ? withHexAlpha(theme.card, "A6") : withHexAlpha(theme.card, "D9");
  const quietInsetSurface = theme.isDark ? withHexAlpha(theme.card2, "8F") : withHexAlpha(theme.card2, "E8");
  const quietBorder = theme.isDark ? withHexAlpha(theme.border, "A3") : withHexAlpha(theme.border, "C2");
  const sectionRuleColor = theme.isDark ? "rgba(255,255,255,0.08)" : "rgba(17,17,17,0.08)";
  const router = useRouter();
  const {
    returnWeekIndex: returnWeekIndexParam,
    returnDayIndex: returnDayIndexParam,
    returnToken: returnTokenParam,
  } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const currentUid = String(auth.currentUser?.uid || "");
  const hasWarmCache =
    !!currentUid &&
    TRAIN_INDEX_SCREEN_CACHE.hydrated &&
    TRAIN_INDEX_SCREEN_CACHE.uid === currentUid;
  const estimatedInitialWeekStripWidth = Math.max(
    Math.round(
      (Number(windowWidth || 0) || Dimensions.get("window").width || 0) - 36
    ),
    WEEK_CAROUSEL_FALLBACK_WIDTH
  );
  const initialScrollOffsetY =
    hasWarmCache && Number.isFinite(Number(TRAIN_INDEX_SCREEN_CACHE.scrollOffsetY))
      ? Math.max(0, Number(TRAIN_INDEX_SCREEN_CACHE.scrollOffsetY))
      : 0;

  const [loading, setLoading] = useState(() => !hasWarmCache);
  const [plan, setPlan] = useState(() =>
    hasWarmCache ? TRAIN_INDEX_SCREEN_CACHE.plan : null
  );
  const [companionPlan, setCompanionPlan] = useState(() =>
    hasWarmCache ? TRAIN_INDEX_SCREEN_CACHE.companionPlan : null
  );
  const [calendarNow, setCalendarNow] = useState(() =>
    hasWarmCache && TRAIN_INDEX_SCREEN_CACHE.calendarNow
      ? new Date(TRAIN_INDEX_SCREEN_CACHE.calendarNow)
      : new Date()
  );
  const [currentWeekIndex, setCurrentWeekIndex] = useState(() =>
    hasWarmCache ? Number(TRAIN_INDEX_SCREEN_CACHE.currentWeekIndex || 0) : 0
  );
  const [selectedDayIndex, setSelectedDayIndex] = useState(() => {
    if (hasWarmCache) {
      return Number.isFinite(Number(TRAIN_INDEX_SCREEN_CACHE.selectedDayIndex))
        ? Number(TRAIN_INDEX_SCREEN_CACHE.selectedDayIndex)
        : getTodayPlanDayIndex(new Date());
    }
    return getTodayPlanDayIndex(new Date());
  });

  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [daySheetIndex, setDaySheetIndex] = useState(0);

  const [moreOpen, setMoreOpen] = useState(false);

  const [recordOpen, setRecordOpen] = useState(false);
  const [recordDayIndex, setRecordDayIndex] = useState(0);
  const [recordType, setRecordType] = useState("run");
  const [recordTitle, setRecordTitle] = useState("");
  const [recordDurationMin, setRecordDurationMin] = useState("");
  const [recordDistanceKm, setRecordDistanceKm] = useState("");
  const [recordRpe, setRecordRpe] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [recordSeedSampleKey, setRecordSeedSampleKey] = useState("");
  const [savingQuick, setSavingQuick] = useState(false);
  const [sendingToWatch, setSendingToWatch] = useState(false);
  const [coachPlansLoading, setCoachPlansLoading] = useState(false);
  const [coachPlans, setCoachPlans] = useState(() =>
    hasWarmCache && Array.isArray(TRAIN_INDEX_SCREEN_CACHE.coachPlans)
      ? TRAIN_INDEX_SCREEN_CACHE.coachPlans
      : []
  );
  const [usingCoachPlanId, setUsingCoachPlanId] = useState("");
  const [sessionLogMap, setSessionLogMap] = useState(() =>
    hasWarmCache && TRAIN_INDEX_SCREEN_CACHE.sessionLogMap
      ? TRAIN_INDEX_SCREEN_CACHE.sessionLogMap
      : {}
  );
  const [completedTrainSessions, setCompletedTrainSessions] = useState([]);
  const [sessionLogsReady, setSessionLogsReady] = useState(() =>
    hasWarmCache ? !!TRAIN_INDEX_SCREEN_CACHE.sessionLogsReady : false
  );
  const [sessionLogsReadyKey, setSessionLogsReadyKey] = useState(() =>
    hasWarmCache ? String(TRAIN_INDEX_SCREEN_CACHE.sessionLogsReadyKey || "") : ""
  );
  const [sampleCategory, setSampleCategory] = useState("all");
  const [tipsOpen, setTipsOpen] = useState(false);
  const [tipTopicKey, setTipTopicKey] = useState("gut-training");
  const [weekStripWidth, setWeekStripWidth] = useState(() => {
    const cachedWidth = Number(TRAIN_INDEX_SCREEN_CACHE.weekStripWidth || 0);
    if (cachedWidth > 0) return cachedWidth;
    return estimatedInitialWeekStripWidth;
  });
  const weekCarouselTranslateX = useRef(
    new Animated.Value(
      -Math.max(
        Number(TRAIN_INDEX_SCREEN_CACHE.weekStripWidth || 0),
        estimatedInitialWeekStripWidth
      )
    )
  ).current;
  const mainScrollRef = useRef(null);
  const initialScrollOffsetYRef = useRef(initialScrollOffsetY);
  const latestScrollOffsetYRef = useRef(initialScrollOffsetYRef.current);
  const pendingScrollRestoreRef = useRef(initialScrollOffsetY > 0);
  const weekCarouselAnimatingRef = useRef(false);
  const weekCarouselGestureRef = useRef(false);
  const latestPlanLoadRef = useRef(0);
  const appliedReturnTokenRef = useRef("");
  const hasExplicitTrainReturn = useMemo(() => {
    const token = String(
      Array.isArray(returnTokenParam) ? returnTokenParam[0] : returnTokenParam || ""
    ).trim();
    const weekValue = Number(
      Array.isArray(returnWeekIndexParam) ? returnWeekIndexParam[0] : returnWeekIndexParam
    );
    const dayValue = Number(
      Array.isArray(returnDayIndexParam) ? returnDayIndexParam[0] : returnDayIndexParam
    );

    return (
      !!token &&
      Number.isFinite(weekValue) &&
      Number.isFinite(dayValue) &&
      dayValue >= 0 &&
      dayValue < DAYS.length
    );
  }, [returnDayIndexParam, returnTokenParam, returnWeekIndexParam]);

  const goToSession = useCallback(
    (key) => {
      if (!key) return;
      router.push({
        pathname: "/train/session/[sessionKey]",
        params: {
          sessionKey: key,
          returnWeekIndex: String(currentWeekIndex),
          returnDayIndex: String(selectedDayIndex),
          returnToken: String(Date.now()),
        },
      });
    },
    [currentWeekIndex, router, selectedDayIndex]
  );

  const handleMainScroll = useCallback((event) => {
    const nextOffsetY = Math.max(
      0,
      Number(event?.nativeEvent?.contentOffset?.y || 0)
    );
    latestScrollOffsetYRef.current = nextOffsetY;
    TRAIN_INDEX_SCREEN_CACHE.scrollOffsetY = nextOffsetY;
  }, []);

  const restoreScrollPosition = useCallback(() => {
    if (!pendingScrollRestoreRef.current || loading) return;

    const targetY = Math.max(0, Number(latestScrollOffsetYRef.current || 0));
    if (!(targetY > 0)) {
      pendingScrollRestoreRef.current = false;
      return;
    }

    const scrollNode = mainScrollRef.current;
    if (!scrollNode || typeof scrollNode.scrollTo !== "function") return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const liveNode = mainScrollRef.current;
        if (!liveNode || typeof liveNode.scrollTo !== "function") return;
        pendingScrollRestoreRef.current = false;
        liveNode.scrollTo({ x: 0, y: targetY, animated: false });
      });
    });
  }, [loading]);

  useFocusEffect(
    useCallback(() => {
      pendingScrollRestoreRef.current = true;
      restoreScrollPosition();
    }, [restoreScrollPosition])
  );

  const openHistorySessionFromTrain = useCallback(
    (sessionId) => {
      if (!sessionId) return;
      router.push({
        pathname: "/train/history/[sessionId]",
        params: {
          sessionId: String(sessionId),
          returnWeekIndex: String(currentWeekIndex),
          returnDayIndex: String(selectedDayIndex),
          returnToken: String(Date.now()),
        },
      });
    },
    [currentWeekIndex, router, selectedDayIndex]
  );

  const hasPlan = !!(plan || companionPlan);
  const hasRunPlan = useMemo(() => {
    return [plan, companionPlan].some((p) => p && inferPlanKindFromDoc(p) === "run");
  }, [plan, companionPlan]);

  const hasStrengthPlan = useMemo(() => {
    return [plan, companionPlan].some(
      (p) => p && inferPlanKindFromDoc(p) === "strength"
    );
  }, [plan, companionPlan]);

  const normalisePlanDoc = useCallback((snapDoc) => {
    const data = snapDoc?.data?.() || {};
    const rawPlan = data.plan || {};
    const weeksRaw = rawPlan.weeks || data.weeks || [];
    const weeksNormalised = normaliseWeeksForClient(weeksRaw);

    const kind = data?.kind || rawPlan?.kind || "training";
    const nameFromMeta = data?.meta?.name;
    const nameFromPlan = rawPlan?.name;
    const nameFromData = data?.name;

    const primaryActivity =
      data?.meta?.primaryActivity ||
      data?.primaryActivity ||
      rawPlan?.primaryActivity ||
      (kind === "run" ? "Run" : kind === "strength" ? "Strength" : "Training");

    return {
      id: snapDoc.id,
      ...data,
      kind,
      name: nameFromMeta || nameFromPlan || nameFromData || "Training Plan",
      primaryActivity,
      weeks: weeksNormalised,
    };
  }, []);

  const loadLatestPlan = useCallback(async () => {
    const loadId = ++latestPlanLoadRef.current;
    const isStale = () => loadId !== latestPlanLoadRef.current;

    try {
      const now = new Date();
      if (isStale()) return;
      setCalendarNow(now);
      const todayDayIndex = getTodayPlanDayIndex(now);
      const uid = auth.currentUser?.uid;
      if (!uid) {
        if (isStale()) return;
        setPlan(null);
        setCompanionPlan(null);
        if (!hasExplicitTrainReturn) {
          setSelectedDayIndex(todayDayIndex);
        }
        setLoading(false);
        return;
      }

      const ref = collection(db, "users", uid, "plans");
      const snap = await getDocs(query(ref, orderBy("updatedAt", "desc"), limit(30)));
      if (isStale()) return;

      if (snap.empty) {
        if (isStale()) return;
        setPlan(null);
        setCompanionPlan(null);
        if (!hasExplicitTrainReturn) {
          setSelectedDayIndex(todayDayIndex);
        }
      } else {
        const docs = snap.docs.map(normalisePlanDoc).filter((d) => d?.id);

        const run = docs.find((d) => inferPlanKindFromDoc(d) === "run") || null;
        const strength = docs.find((d) => inferPlanKindFromDoc(d) === "strength") || null;

        let primary = null;
        let companion = null;

        if (run) {
          primary = run;
          companion = strength && strength.id !== run.id ? strength : null;
        } else if (strength) {
          primary = strength;
          companion =
            docs.find(
              (d) =>
                d.id !== strength.id &&
                inferPlanKindFromDoc(d) !== inferPlanKindFromDoc(strength)
            ) || null;
        } else {
          primary = docs[0] || null;
          companion = docs[1] || null;
        }

        const resolvedCompanion =
          companion && primary && companion.id !== primary.id ? companion : null;
        const weeksCount = Math.max(
          primary?.weeks?.length || 0,
          resolvedCompanion?.weeks?.length || 0,
          1
        );
        const resolvedActiveWeekIndex = deriveCurrentPlanWeekIndex(
          [primary, resolvedCompanion],
          now,
          weeksCount
        );

        if (isStale()) return;
        setPlan(primary);
        setCompanionPlan(resolvedCompanion);

        let appliedMoveState = false;
        try {
          const uiRef = doc(db, "users", uid, "uiState", "train");
          const uiSnap = await getDoc(uiRef);
          if (isStale()) return;
          const moveState = uiSnap.exists() ? uiSnap.data()?.lastSessionMove : null;

          if (moveState && typeof moveState === "object") {
            const movePlanId = String(moveState?.planId || "");
            const activePlanIds = [primary?.id, resolvedCompanion?.id]
              .map((id) => String(id || ""))
              .filter(Boolean);
            const matchesActivePlan = movePlanId && activePlanIds.includes(movePlanId);

            if (matchesActivePlan) {
              appliedMoveState = true;
              const requestedWeekIndex = Number(
                moveState?.toWeekIndex ?? moveState?.weekIndex ?? 0
              );
              const requestedDayIndex = Number(
                moveState?.toDayIndex ?? moveState?.dayIndex ?? 0
              );

              if (Number.isFinite(requestedWeekIndex)) {
                const safeWeekIndex = Math.min(
                  Math.max(Math.round(requestedWeekIndex), 0),
                  Math.max(weeksCount - 1, 0)
                );
                setCurrentWeekIndex(safeWeekIndex);
              }

              if (
                Number.isFinite(requestedDayIndex) &&
                requestedDayIndex >= 0 &&
                requestedDayIndex < DAYS.length
              ) {
                setSelectedDayIndex(Math.round(requestedDayIndex));
              }

              await setDoc(
                uiRef,
                {
                  lastSessionMove: null,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
              if (isStale()) return;
            }
          }
        } catch (moveStateErr) {
          console.log("[train] apply move state error:", moveStateErr);
        }

        if (!appliedMoveState) {
          // Do not force a provisional week index here.
          // The week auto-sync effect applies the final resolved index once
          // logs/anchors are ready, which avoids Week 1 -> current week flicker.
          void resolvedActiveWeekIndex;
        }

        if (isStale()) return;
        if (!hasExplicitTrainReturn && !appliedMoveState) {
          setSelectedDayIndex(todayDayIndex);
        }
      }
    } catch (e) {
      if (isStale()) return;
      console.log("[train] load plan error:", e);
    } finally {
      if (isStale()) return;
      setLoading(false);
    }
  }, [hasExplicitTrainReturn, normalisePlanDoc]);

  const loadCoachPlans = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setCoachPlans([]);
      return;
    }

    setCoachPlansLoading(true);
    try {
      const fetchTopLevelPlanDocs = async (colName) => {
        const colRef = collection(db, colName);
        const attempts = [
          () => getDocs(query(colRef, orderBy("updatedAt", "desc"), limit(40))),
          () => getDocs(query(colRef, orderBy("createdAt", "desc"), limit(40))),
          () => getDocs(query(colRef, limit(40))),
        ];

        for (const runAttempt of attempts) {
          try {
            const snap = await runAttempt();
            if (snap?.empty) continue;
            return snap.docs.map((d) => ({
              sourceCollection: colName,
              docData: { id: d.id, ...d.data() },
            }));
          } catch {}
        }

        return [];
      };

      const [runCandidates, planCandidates] = await Promise.all([
        fetchTopLevelPlanDocs("runPlans"),
        fetchTopLevelPlanDocs("plans"),
      ]);

      const localCandidates = MASON_COACH_TEMPLATE_DOCS.map((docData) => ({
        sourceCollection: "localTemplates",
        docData,
      }));

      const merged = [...localCandidates, ...runCandidates, ...planCandidates];
      const deduped = [];
      const seen = new Set();

      for (const item of merged) {
        const key = `${item.sourceCollection}:${item.docData?.id || ""}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      const normalised = deduped
        .map((x) =>
          normaliseCoachPlanCandidate({
            sourceCollection: x.sourceCollection,
            docData: x.docData,
            currentUid: uid,
          })
        )
        .filter(Boolean)
        .sort((a, b) => b.sortMs - a.sortMs)
        .slice(0, 8);

      setCoachPlans(normalised);
    } catch (e) {
      console.log("[train] load coach plans error:", e);
      setCoachPlans([]);
    } finally {
      setCoachPlansLoading(false);
    }
  }, []);

  const activateCoachPlan = useCallback(
    async (coachPlan) => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Sign in required", "Please sign in before adding a coach plan.");
        return;
      }
      if (!coachPlan?.id) return;

      setUsingCoachPlanId(String(coachPlan.id));
      try {
        const source = coachPlan.raw || {};
        const weeks = normaliseWeeksForClient(extractWeeksFromPlanDoc(source));
        if (!weeks.length) throw new Error("This coach plan has no sessions.");

        const kind = source?.kind || inferPlanKindFromDoc(source) || "training";
        const name = coachPlan.name || "Coach plan";
        const primaryActivity =
          source?.primaryActivity ||
          source?.meta?.primaryActivity ||
          coachPlan.primaryActivity ||
          (kind === "strength" ? "Strength" : "Run");

        const basePlanObj =
          source?.plan && typeof source.plan === "object"
            ? { ...source.plan, weeks }
            : { name, primaryActivity, weeks };

        const payload = {
          name,
          kind,
          primaryActivity,
          source: "coach-library",
          plan: basePlanObj,
          weeks,
          coachPlanRef: {
            id: coachPlan.id,
            sourceCollection: coachPlan.sourceCollection,
            coachName: coachPlan.coachName || null,
            name,
          },
          meta: {
            ...(source?.meta || {}),
            importedFromCoachPlan: true,
            coachName: coachPlan.coachName || source?.meta?.coachName || null,
            name,
            primaryActivity,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const ref = await addDoc(collection(db, "users", uid, "plans"), payload);
        await loadLatestPlan();

        const firstKey = findFirstSessionKeyFromWeeks(ref.id, weeks);
        Alert.alert(
          "Coach plan added",
          "You can view it or start the first session now.",
          [
            {
              text: "View",
              onPress: () =>
                router.push({ pathname: "/train/view-plan", params: { planId: ref.id } }),
            },
            firstKey
              ? {
                  text: "Start",
                  onPress: () => goToSession(firstKey),
                }
              : { text: "Done", style: "cancel" },
          ]
        );
      } catch (e) {
        Alert.alert("Couldn’t add coach plan", e?.message || "Try again.");
      } finally {
        setUsingCoachPlanId("");
      }
    },
    [goToSession, loadLatestPlan, router]
  );

  const viewCoachPlan = useCallback(
    (coachPlan) => {
      if (!coachPlan?.id) return;
      if (coachPlan.sourceCollection === "localTemplates") {
        router.push({
          pathname: "/train/coach-plan-preview",
          params: { templateId: coachPlan.id },
        });
        return;
      }
      router.push({
        pathname: "/train/view-plan",
        params: { planId: coachPlan.id },
      });
    },
    [router]
  );

  const activePlanIds = useMemo(
    () => [...new Set([plan?.id, companionPlan?.id].filter(Boolean).map(String))],
    [companionPlan?.id, plan?.id]
  );
  const activePlanKey = useMemo(() => activePlanIds.join("|"), [activePlanIds]);
  const showResolvedPlanState =
    hasPlan &&
    !loading &&
    !!activePlanKey &&
    sessionLogsReady &&
    sessionLogsReadyKey === activePlanKey;
  const isResolvingActivePlan = loading || (hasPlan && !showResolvedPlanState);
  const showEmptyPlanState = !loading && !hasPlan;

  useEffect(() => {
    (async () => {
      await Promise.all([loadLatestPlan(), loadCoachPlans()]);
    })();
  }, [loadLatestPlan, loadCoachPlans]);

  useEffect(() => {
    if (!currentUid) {
      Object.assign(TRAIN_INDEX_SCREEN_CACHE, {
        uid: "",
        hydrated: false,
        plan: null,
        companionPlan: null,
        calendarNow: null,
        currentWeekIndex: 0,
        selectedDayIndex: 0,
        sessionLogMap: {},
        sessionLogsReady: false,
        sessionLogsReadyKey: "",
        scrollOffsetY: 0,
        weekStripWidth: 0,
        coachPlans: [],
        coachPlansLoaded: false,
      });
      return;
    }

    if (loading) return;

    Object.assign(TRAIN_INDEX_SCREEN_CACHE, {
      uid: currentUid,
      hydrated: true,
      plan,
      companionPlan,
      calendarNow: calendarNow instanceof Date ? calendarNow.toISOString() : null,
      currentWeekIndex,
      selectedDayIndex,
      sessionLogMap,
      sessionLogsReady,
      sessionLogsReadyKey,
      scrollOffsetY: latestScrollOffsetYRef.current,
      weekStripWidth,
      coachPlans,
      coachPlansLoaded: true,
    });
  }, [
    calendarNow,
    coachPlans,
    companionPlan,
    currentUid,
    currentWeekIndex,
    loading,
    plan,
    selectedDayIndex,
    sessionLogMap,
    sessionLogsReady,
    sessionLogsReadyKey,
    weekStripWidth,
  ]);

  useEffect(() => {
    restoreScrollPosition();
  }, [restoreScrollPosition, showEmptyPlanState, showResolvedPlanState]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    const currentPlanKey = activePlanKey;

    if (!uid || !activePlanIds.length) {
      setSessionLogMap({});
      setSessionLogsReady(true);
      setSessionLogsReadyKey("");
      return;
    }

    if (sessionLogsReadyKey !== currentPlanKey) {
      setSessionLogsReady(false);
      setSessionLogsReadyKey("");
    }
    const ref = collection(db, "users", uid, "sessionLogs");
    const chunks = [];
    for (let idx = 0; idx < activePlanIds.length; idx += 10) {
      chunks.push(activePlanIds.slice(idx, idx + 10));
    }

    const partialMaps = {};
    let closed = false;

    const syncMergedMap = () => {
      if (closed) return;
      const merged = {};
      Object.values(partialMaps).forEach((chunkMap) => {
        Object.assign(merged, chunkMap || {});
      });
      setSessionLogMap(merged);
      if (Object.keys(partialMaps).length >= chunks.length) {
        setSessionLogsReady(true);
        setSessionLogsReadyKey(currentPlanKey);
      }
    };

    const unsubs = chunks.map((ids, chunkIdx) =>
      onSnapshot(
        query(ref, where("planId", "in", ids)),
        (snap) => {
          const nextMap = {};
          snap.forEach((docSnap) => {
            nextMap[docSnap.id] = docSnap.data() || {};
          });
          partialMaps[chunkIdx] = nextMap;
          syncMergedMap();
        },
        (e) => {
          console.log("[train] session logs snapshot error:", e);
          partialMaps[chunkIdx] = {};
          syncMergedMap();
        }
      )
    );

    return () => {
      closed = true;
      unsubs.forEach((unsub) => {
        try {
          unsub?.();
        } catch {}
      });
    };
  }, [activePlanIds, activePlanKey, sessionLogsReadyKey]);

  useEffect(() => {
    const uid = currentUid;
    if (!uid) {
      setCompletedTrainSessions([]);
      return;
    }

    const ref = collection(db, "users", uid, "trainSessions");
    const unsub = onSnapshot(
      query(ref, orderBy("completedAt", "desc"), limit(80)),
      (snap) => {
        setCompletedTrainSessions(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (e) => {
        console.log("[train] completed train sessions snapshot error:", e);
        setCompletedTrainSessions([]);
      }
    );

    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [currentUid]);

  const visibleWeeksCount = useMemo(() => {
    if (!hasPlan) return 0;
    return Math.max(plan?.weeks?.length || 0, companionPlan?.weeks?.length || 0, 1);
  }, [hasPlan, plan?.weeks?.length, companionPlan?.weeks?.length]);
  const maxWeekIndex = useMemo(
    () => Math.max((visibleWeeksCount || 1) - 1, 0),
    [visibleWeeksCount]
  );

  useEffect(() => {
    if (!hasPlan) return;
    setCurrentWeekIndex((prev) =>
      Math.min(Math.max(prev, 0), Math.max((visibleWeeksCount || 1) - 1, 0))
    );
  }, [hasPlan, visibleWeeksCount]);

  const weekPanelWidth = useMemo(
    () =>
      Math.max(
        Number(weekStripWidth || 0),
        Number(estimatedInitialWeekStripWidth || 0),
        WEEK_CAROUSEL_FALLBACK_WIDTH
      ),
    [estimatedInitialWeekStripWidth, weekStripWidth]
  );

  const clampWeekIndex = useCallback(
    (idx) => Math.min(Math.max(Number(idx || 0), 0), maxWeekIndex),
    [maxWeekIndex]
  );

  useEffect(() => {
    const token = String(Array.isArray(returnTokenParam) ? returnTokenParam[0] : returnTokenParam || "");
    if (!token || appliedReturnTokenRef.current === token) return;
    if (loading) return;

    const parsedWeekIndex = Number(
      Array.isArray(returnWeekIndexParam) ? returnWeekIndexParam[0] : returnWeekIndexParam
    );
    const parsedDayIndex = Number(
      Array.isArray(returnDayIndexParam) ? returnDayIndexParam[0] : returnDayIndexParam
    );

    if (Number.isFinite(parsedWeekIndex)) {
      setCurrentWeekIndex(clampWeekIndex(parsedWeekIndex));
    }

    if (Number.isFinite(parsedDayIndex) && parsedDayIndex >= 0 && parsedDayIndex < DAYS.length) {
      setSelectedDayIndex(Math.round(parsedDayIndex));
    }

    appliedReturnTokenRef.current = token;
  }, [
    clampWeekIndex,
    loading,
    returnDayIndexParam,
    returnTokenParam,
    returnWeekIndexParam,
  ]);

  useEffect(() => {
    if (!hasPlan) {
      weekCarouselAnimatingRef.current = false;
      weekCarouselGestureRef.current = false;
      weekCarouselTranslateX.setValue(-weekPanelWidth);
      return;
    }
    if (!weekCarouselAnimatingRef.current && !weekCarouselGestureRef.current) {
      weekCarouselTranslateX.setValue(-weekPanelWidth);
    }
  }, [hasPlan, weekPanelWidth, weekCarouselTranslateX]);

  const animateWeekSnapToCenter = useCallback(
    (velocity = 0) => {
      Animated.spring(weekCarouselTranslateX, {
        toValue: -weekPanelWidth,
        velocity,
        tension: 190,
        friction: 22,
        useNativeDriver: true,
      }).start();
    },
    [weekCarouselTranslateX, weekPanelWidth]
  );

  const animateWeekByDelta = useCallback(
    (delta) => {
      if (!hasPlan || weekCarouselAnimatingRef.current) return;
      const signedDelta = Number(delta || 0) > 0 ? 1 : -1;
      const targetIndex = clampWeekIndex(currentWeekIndex + signedDelta);
      if (targetIndex === currentWeekIndex) {
        animateWeekSnapToCenter();
        return;
      }

      weekCarouselAnimatingRef.current = true;
      Animated.timing(weekCarouselTranslateX, {
        toValue: -weekPanelWidth - signedDelta * weekPanelWidth,
        duration: 210,
        useNativeDriver: true,
      }).start(({ finished }) => {
        setCurrentWeekIndex(targetIndex);
        weekCarouselTranslateX.setValue(-weekPanelWidth);
        weekCarouselAnimatingRef.current = false;
        if (!finished) {
          animateWeekSnapToCenter();
        }
      });
    },
    [
      animateWeekSnapToCenter,
      clampWeekIndex,
      currentWeekIndex,
      hasPlan,
      weekCarouselTranslateX,
      weekPanelWidth,
    ]
  );

  const shiftWeek = useCallback(
    (delta) => {
      const step = Math.trunc(Number(delta || 0));
      if (!step) return;
      if (Math.abs(step) === 1) {
        animateWeekByDelta(step);
        return;
      }
      setCurrentWeekIndex((prev) => clampWeekIndex(prev + step));
    },
    [animateWeekByDelta, clampWeekIndex]
  );

  const jumpForwardWeeks = useCallback(() => {
    shiftWeek(4);
  }, [shiftWeek]);

  const weekSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          hasPlan &&
          !weekCarouselAnimatingRef.current &&
          maxWeekIndex > 0 &&
          Math.abs(gesture.dx) > 6 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05,
        onPanResponderGrant: () => {
          weekCarouselGestureRef.current = true;
        },
        onPanResponderMove: (_, gesture) => {
          if (weekCarouselAnimatingRef.current) return;
          const dx = Number(gesture?.dx || 0);
          const blockedAtStart = currentWeekIndex <= 0 && dx > 0;
          const blockedAtEnd = currentWeekIndex >= maxWeekIndex && dx < 0;
          const adjustedDx = blockedAtStart || blockedAtEnd ? dx * 0.32 : dx;
          weekCarouselTranslateX.setValue(-weekPanelWidth + adjustedDx);
        },
        onPanResponderRelease: (_, gesture) => {
          weekCarouselGestureRef.current = false;
          if (weekCarouselAnimatingRef.current) return;

          const dx = Number(gesture?.dx || 0);
          const vx = Number(gesture?.vx || 0);
          const absDx = Math.abs(dx);
          const shouldAdvance =
            absDx > weekPanelWidth * 0.08 || Math.abs(vx) > 0.25;

          if (!shouldAdvance) {
            animateWeekSnapToCenter(vx);
            return;
          }

          const delta = dx < 0 ? 1 : -1;
          animateWeekByDelta(delta);
        },
        onPanResponderTerminate: () => {
          weekCarouselGestureRef.current = false;
          animateWeekSnapToCenter();
        },
      }),
    [
      animateWeekByDelta,
      animateWeekSnapToCenter,
      currentWeekIndex,
      hasPlan,
      maxWeekIndex,
      weekCarouselTranslateX,
      weekPanelWidth,
    ]
  );

  const mergeWeekAtIndex = useCallback((sourceWeekIndex) => {
    if (!hasPlan) return emptyWeek();
    const safeWeekIndex = clampWeekIndex(sourceWeekIndex);

    const out = emptyWeek();
    const appendFromPlan = (srcPlan) => {
      if (!srcPlan?.id) return;
      const srcWeek = srcPlan?.weeks?.[safeWeekIndex];
      if (!srcWeek?.days?.length) return;

      srcWeek.days.forEach((day, dayIdx) => {
        const resolvedDayIndex = DAYS.indexOf(String(day?.day || ""));
        const safeDayIndex = resolvedDayIndex >= 0 ? resolvedDayIndex : dayIdx;
        if (safeDayIndex < 0 || safeDayIndex > DAYS.length - 1) return;

        const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
        sessions.forEach((sess, sessIdx) => {
          out.days[safeDayIndex].sessions.push({
            ...sess,
            __sourcePlanId: srcPlan.id,
            __sourceWeekIndex: safeWeekIndex,
            __sourceDayIndex: safeDayIndex,
            __sourceSessionIndex: sessIdx,
          });
        });
      });
    };

    appendFromPlan(plan);
    appendFromPlan(companionPlan);

    return {
      ...out,
      title:
        plan?.weeks?.[safeWeekIndex]?.title ||
        companionPlan?.weeks?.[safeWeekIndex]?.title ||
        `Week ${safeWeekIndex + 1}`,
      days: out.days.map((d) => ({
        ...d,
        sessions: sortMergedSessions(d.sessions),
      })),
    };
  }, [clampWeekIndex, companionPlan, hasPlan, plan]);

  const week = useMemo(
    () => mergeWeekAtIndex(currentWeekIndex),
    [mergeWeekAtIndex, currentWeekIndex]
  );

  const activePlanWeekIndex = useMemo(
    () =>
      deriveCurrentPlanWeekIndex(
        [plan, companionPlan],
        calendarNow,
        visibleWeeksCount,
        sessionLogMap
      ),
    [calendarNow, companionPlan, plan, sessionLogMap, visibleWeeksCount]
  );

  const planWeekZeroStart = useMemo(
    () => {
      const anchors = [plan, companionPlan]
        .map((planDoc) => resolvePlanWeekZeroStart(planDoc, sessionLogMap))
        .filter(Boolean)
        .sort((a, b) => a.getTime() - b.getTime());

      return anchors[0] || startOfISOWeek(calendarNow);
    },
    [calendarNow, companionPlan, plan, sessionLogMap]
  );

  const todayIso = useMemo(() => toISODate(calendarNow), [calendarNow]);

  const linkedTrainSessionIds = useMemo(() => {
    const ids = new Set();
    Object.values(sessionLogMap || {}).forEach((log) => {
      const id = String(log?.lastTrainSessionId || "").trim();
      if (id) ids.add(id);
    });
    return ids;
  }, [sessionLogMap]);

  const extraCompletedSessionsByIso = useMemo(() => {
    const byIso = {};
    (Array.isArray(completedTrainSessions) ? completedTrainSessions : []).forEach((session) => {
      if (!isUnlinkedCompletedTrainSession(session, linkedTrainSessionIds)) return;
      const isoDate = trainSessionIsoDate(session);
      if (!isoDate) return;
      if (!byIso[isoDate]) byIso[isoDate] = [];
      byIso[isoDate].push(session);
    });

    Object.values(byIso).forEach((sessions) => {
      sessions.sort((a, b) => timestampMs(a?.completedAt || a?.createdAt) - timestampMs(b?.completedAt || b?.createdAt));
    });

    return byIso;
  }, [completedTrainSessions, linkedTrainSessionIds]);

  const buildWeekGrid = useCallback((weekData, sourceWeekIndex) => {
    const safeWeekIndex = Number.isFinite(Number(sourceWeekIndex))
      ? Math.round(Number(sourceWeekIndex))
      : 0;
    const derivedWeekStart = addDays(planWeekZeroStart, safeWeekIndex * 7);

    return (Array.isArray(weekData?.days) ? weekData.days : []).map((d, dayIdx) => {
      const explicitDate = parseDateLike(d?.date || d?.isoDate);
      const date = explicitDate || addDays(derivedWeekStart, dayIdx);
      const isoDate = toISODate(date);
      const isToday = isoDate === todayIso;
      const sessions = Array.isArray(d.sessions) ? d.sessions : [];

      const cards = sessions.map((sess, sessIdx) => {
        const title = sess?.title || sess?.name || sess?.sessionType || sess?.type || "Session";
        const meta = sumSessionMeta(sess);
        const guidance = getSessionGuidance(sess);
        const keyPlanId = sess?.__sourcePlanId || plan?.id || null;
        const keyWeekIndex =
          Number.isFinite(Number(sess?.__sourceWeekIndex))
            ? Number(sess.__sourceWeekIndex)
            : sourceWeekIndex;
        const keyDayIndex =
          Number.isFinite(Number(sess?.__sourceDayIndex))
            ? Number(sess.__sourceDayIndex)
            : dayIdx;
        const keySessionIndex =
          Number.isFinite(Number(sess?.__sourceSessionIndex))
            ? Number(sess.__sourceSessionIndex)
            : sessIdx;

        const key = keyPlanId
          ? buildSessionKey(keyPlanId, keyWeekIndex, keyDayIndex, keySessionIndex)
          : null;
        const log = key ? sessionLogMap[key] || null : null;
        const status = resolveSessionLogStatus(log);
        const savedTrainSessionId = String(log?.lastTrainSessionId || "").trim() || null;

        return {
          sess,
          title,
          meta,
          guidance,
          key,
          log,
          status,
          savedTrainSessionId,
          linkedActivity: log?.linkedActivity || null,
        };
      });

      const extraCards = (extraCompletedSessionsByIso[isoDate] || []).map((session, extraIdx) => {
        const title =
          session?.title ||
          session?.name ||
          session?.sessionType ||
          session?.primaryActivity ||
          "Completed session";
        return {
          sess: session,
          title,
          meta: completedTrainSessionMeta(session),
          guidance: session?.notes || "",
          key: null,
          log: null,
          status: "completed",
          savedTrainSessionId: String(session?.id || "").trim() || null,
          linkedActivity: session?.linkedActivity || null,
          isExtraCompletedSession: true,
          extraSessionIndex: extraIdx,
        };
      });

      const allCards = [...cards, ...extraCards];
      const sessionSummary = summariseCardStatuses(allCards);

      const dateLabel = fmtDayDate(date);
      const short = new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

      return {
        dayLabel: d.day,
        dayIdx,
        date,
        dateLabel,
        dateShort: short,
        isoDate,
        isToday,
        cards: allCards,
        sessionSummary,
      };
    });
  }, [extraCompletedSessionsByIso, plan?.id, planWeekZeroStart, sessionLogMap, todayIso]);

  const weekGrid = useMemo(
    () => buildWeekGrid(week, currentWeekIndex),
    [buildWeekGrid, week, currentWeekIndex]
  );

  const activeWeekAutoSyncRef = useRef("");
  useEffect(() => {
    if (!hasPlan || loading) return;
    if (!visibleWeeksCount) return;
    if (!sessionLogsReady) return;

    if (!activePlanKey) return;
    if (sessionLogsReadyKey !== activePlanKey) return;

    const targetIndex = Math.max(
      0,
      Math.min(Number(activePlanWeekIndex || 0), Math.max(visibleWeeksCount - 1, 0))
    );
    const weekAnchor = toISODate(startOfISOWeek(calendarNow));
    const baseSyncKey = `${activePlanKey}:${weekAnchor}`;
    const syncKey = `${activePlanKey}:${weekAnchor}:${targetIndex}`;

    const alreadySyncedThisWeekForPlan = activeWeekAutoSyncRef.current.startsWith(
      `${baseSyncKey}:`
    );
    if (
      alreadySyncedThisWeekForPlan &&
      Number.isFinite(Number(currentWeekIndex)) &&
      targetIndex < Number(currentWeekIndex)
    ) {
      return;
    }

    if (activeWeekAutoSyncRef.current === syncKey) return;

    setCurrentWeekIndex(targetIndex);
    activeWeekAutoSyncRef.current = syncKey;
  }, [
    activePlanWeekIndex,
    calendarNow,
    activePlanKey,
    currentWeekIndex,
    hasPlan,
    loading,
    sessionLogsReady,
    sessionLogsReadyKey,
    visibleWeeksCount,
  ]);

  const weekCarouselPanels = useMemo(() => {
    const prevWeekIndex = clampWeekIndex(currentWeekIndex - 1);
    const nextWeekIndex = clampWeekIndex(currentWeekIndex + 1);
    const panelSpecs = [
      { id: "prev", weekIndex: prevWeekIndex },
      { id: "current", weekIndex: currentWeekIndex },
      { id: "next", weekIndex: nextWeekIndex },
    ];

    return panelSpecs.map((panel) => ({
      ...panel,
      grid: buildWeekGrid(mergeWeekAtIndex(panel.weekIndex), panel.weekIndex),
    }));
  }, [buildWeekGrid, clampWeekIndex, currentWeekIndex, mergeWeekAtIndex]);

  const today = useMemo(() => weekGrid.find((x) => x.isToday) || null, [weekGrid]);
  const focusedDay = useMemo(
    () => weekGrid?.[selectedDayIndex] || today || weekGrid?.[0] || null,
    [weekGrid, selectedDayIndex, today]
  );
  const focusedDayCards = useMemo(
    () => (Array.isArray(focusedDay?.cards) ? focusedDay.cards : []),
    [focusedDay]
  );
  const focusedDayPriority = useMemo(() => pickPriorityCard(focusedDayCards), [focusedDayCards]);
  const todayFirst = focusedDayPriority.card;
  const todayFirstIndex = focusedDayPriority.index;

  useEffect(() => {
    setSelectedDayIndex((prev) => {
      const maxIdx = Math.max(weekGrid.length - 1, 0);
      return Math.min(Math.max(Number(prev) || 0, 0), maxIdx);
    });
  }, [weekGrid.length]);

  const todayHero = useMemo(() => {
    if (!focusedDay) return null;

    const session = todayFirst?.sess || null;
    const title = todayFirst?.title || "Rest / optional movement";
    const subtitle = todayFirst?.meta || (todayFirst ? "" : "No structured session planned");
    const status = String(todayFirst?.status || "").toLowerCase();

    const type = session ? sessionTypeLabel(session) : "Rest";
    const notes = normaliseStr(session?.notes || session?.workout?.notes || "");
    const guidance = session ? getSessionGuidance(session) : "";
    const focus = notes || guidance || type;

    const rpe =
      session?.intensity?.type === "rpe" ? session?.intensity?.target : session?.rpeTarget ?? null;

    return {
      dateLabel: focusedDay.dateLabel,
      dayLabel: focusedDay.dayLabel,
      isoDate: focusedDay.isoDate,
      dayIdx: focusedDay.dayIdx,
      hasPlan: !!todayFirst?.key,
      key: todayFirst?.key || null,
      status,
      savedTrainSessionId: todayFirst?.savedTrainSessionId || null,
      linkedProvider: normaliseStr(todayFirst?.linkedActivity?.provider || ""),
      isRestDay: !session,
      title,
      subtitle,
      focus: rpe ? `${type} · RPE ${rpe}` : focus,
      session,
      badge: !session
        ? "REST"
        : status === "completed"
        ? "COMPLETED"
        : status === "skipped"
        ? "SKIPPED"
        : focusedDay.isToday
        ? "TODAY"
        : "PLANNED",
    };
  }, [focusedDay, todayFirst]);

  const weekTotals = useMemo(() => {
    let sessions = 0;
    let mins = 0;
    let km = 0;
    let completed = 0;
    let skipped = 0;

    week.days?.forEach((d, dayIdx) =>
      d.sessions?.forEach((sess, sessIdx) => {
        sessions += 1;
        const duration =
          sess.workout?.totalDurationSec != null
            ? sess.workout.totalDurationSec / 60
            : sess.targetDurationMin ?? sess.durationMin ?? 0;

        const dist =
          sess.workout?.totalDistanceKm != null
            ? sess.workout.totalDistanceKm
            : sess.targetDistanceKm ?? sess.distanceKm ?? sess.plannedDistanceKm ?? 0;

        mins += Number(duration || 0);
        km += Number(dist || 0);

        const keyPlanId = sess?.__sourcePlanId || plan?.id || null;
        const keyWeekIndex =
          Number.isFinite(Number(sess?.__sourceWeekIndex))
            ? Number(sess.__sourceWeekIndex)
            : currentWeekIndex;
        const keyDayIndex =
          Number.isFinite(Number(sess?.__sourceDayIndex))
            ? Number(sess.__sourceDayIndex)
            : dayIdx;
        const keySessionIndex =
          Number.isFinite(Number(sess?.__sourceSessionIndex))
            ? Number(sess.__sourceSessionIndex)
            : sessIdx;
        const key = keyPlanId
          ? buildSessionKey(keyPlanId, keyWeekIndex, keyDayIndex, keySessionIndex)
          : null;
        const status = resolveSessionLogStatus(key ? sessionLogMap[key] : null);
        if (status === "completed") completed += 1;
        if (status === "skipped") skipped += 1;
      })
    );

    return {
      sessions,
      mins: Math.round(mins),
      km: Number(km.toFixed(1)),
      completed,
      skipped,
      resolved: completed + skipped,
      pending: Math.max(sessions - completed - skipped, 0),
    };
  }, [currentWeekIndex, plan?.id, sessionLogMap, week]);

  const nextSession = useMemo(() => {
    if (!hasPlan || !focusedDay) return null;
    const todayIdx = typeof focusedDay.dayIdx === "number" ? focusedDay.dayIdx : 0;

    for (let offset = 1; offset < 7; offset += 1) {
      const idx = (todayIdx + offset) % 7;
      const day = weekGrid[idx];
      const { card } = pickPriorityCard(day?.cards);
      if (card && !isResolvedSessionStatus(card?.status)) {
        return {
          ...card,
          dayLabel: day.dayLabel,
          dateShort: day.dateShort,
          dayIdx: day.dayIdx,
          isoDate: day.isoDate,
        };
      }
    }
    return null;
  }, [hasPlan, focusedDay, weekGrid]);

  const planProgress = useMemo(() => {
    if (!visibleWeeksCount) return 0;
    return Math.min(100, Math.round(((currentWeekIndex + 1) / visibleWeeksCount) * 100));
  }, [currentWeekIndex, visibleWeeksCount]);

  const heroPlanTitle = useMemo(() => {
    if (!hasPlan) return "Training Plan";
    if (hasRunPlan && hasStrengthPlan) return "Run + Strength";
    return plan?.name || companionPlan?.name || "Training Plan";
  }, [hasPlan, hasRunPlan, hasStrengthPlan, plan?.name, companionPlan?.name]);

  const heroActivityLabel = useMemo(() => {
    const parts = [];
    if (hasRunPlan) parts.push("Run");
    if (hasStrengthPlan) parts.push("Strength");
    if (!parts.length) parts.push(plan?.primaryActivity || companionPlan?.primaryActivity || "Training");
    return parts.join(" + ");
  }, [
    hasRunPlan,
    hasStrengthPlan,
    plan?.primaryActivity,
    companionPlan?.primaryActivity,
  ]);

  const dynamicSubtitle = useMemo(() => {
    if (isResolvingActivePlan) return "Loading your training";
    if (showEmptyPlanState) return "No active plan yet";
    if (todayHero?.status === "completed") {
      return `${todayHero.dayLabel || "Selected day"} is complete · ${weekTotals.resolved}/${weekTotals.sessions} sessions marked this week`;
    }
    if (todayHero?.status === "skipped") {
      return `${todayHero.dayLabel || "Selected day"} was skipped · ${weekTotals.resolved}/${weekTotals.sessions} sessions marked this week`;
    }
    if (!todayFirst && nextSession) {
      return `${todayHero?.dayLabel || "Selected day"} is light. Next up: ${nextSession.dayLabel} · ${nextSession.title}`;
    }
    return `${todayFirst ? `${todayHero?.dayLabel || "Day"} is set` : `No session on ${todayHero?.dayLabel || "selected day"}`} · ${weekTotals.sessions} sessions this week`;
  }, [
    hasPlan,
    loading,
    nextSession,
    isResolvingActivePlan,
    showEmptyPlanState,
    todayFirst,
    todayHero?.dayLabel,
    todayHero?.status,
    weekTotals.resolved,
    weekTotals.sessions,
  ]);

  const headerContextChip = useMemo(() => {
    if (isResolvingActivePlan) return "Loading";
    if (showEmptyPlanState) return "No active plan";
    if (hasRunPlan && hasStrengthPlan) return "2 plans running";
    return "Active plan";
  }, [isResolvingActivePlan, showEmptyPlanState, hasRunPlan, hasStrengthPlan]);

  const headerContextMeta = useMemo(() => {
    const nowLabel = new Date(calendarNow).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const selectedDate = showResolvedPlanState ? focusedDay?.dateLabel || nowLabel : nowLabel;
    if (!showResolvedPlanState) return selectedDate;
    return `${selectedDate} · Week ${currentWeekIndex + 1} of ${visibleWeeksCount || 1}`;
  }, [calendarNow, currentWeekIndex, visibleWeeksCount, focusedDay?.dateLabel, showResolvedPlanState]);

  const todayHeroSupport = useMemo(() => {
    if (todayHero?.status === "completed") {
      const provider = todayHero?.linkedProvider ? ` via ${todayHero.linkedProvider}` : "";
      const nextLine = nextSession ? ` Next planned: ${nextSession.dayLabel} · ${nextSession.title}.` : "";
      return `This planned session has been completed${provider} and saved to history.${nextLine}`;
    }
    if (todayHero?.status === "skipped") {
      const nextLine = nextSession ? ` Next planned: ${nextSession.dayLabel} · ${nextSession.title}.` : "";
      return `This planned session has been marked as skipped and saved to history.${nextLine}`;
    }
    if (!todayHero?.session) {
      if (nextSession) {
        return `${todayHero?.dayLabel || "Selected day"} is recovery-focused. Next planned: ${nextSession.dayLabel} · ${nextSession.title}.`;
      }
      return `No structured session on ${todayHero?.dayLabel || "this day"}. Use quick log if you train.`;
    }
    return (
      todayHero?.subtitle ||
      todayHero?.focus ||
      "Hit the main objective for this session and keep execution controlled."
    );
  }, [todayHero, nextSession]);

  const extraDaySessions = useMemo(() => {
    if (!focusedDayCards.length || focusedDayCards.length < 2) return [];
    return focusedDayCards.filter((_, idx) => idx !== todayFirstIndex);
  }, [focusedDayCards, todayFirstIndex]);

  const topFadeStart = useMemo(() => {
    const alpha = theme.isDark ? "33" : "55";
    const resolved = withHexAlpha(theme.primaryBg, alpha);
    if (resolved !== theme.primaryBg) return resolved;
    return theme.isDark ? "rgba(230,255,59,0.2)" : "rgba(230,255,59,0.3)";
  }, [theme.isDark, theme.primaryBg]);

  const progressStateLabel = useMemo(() => {
    if (!hasPlan) return "Not started";
    if (weekTotals.sessions && weekTotals.pending === 0) return "Week complete";
    if (weekTotals.resolved > 0) return `${weekTotals.resolved}/${weekTotals.sessions} done`;
    const pct = Number(planProgress || 0);
    if (pct >= 75) return "Ahead";
    if (pct >= 35) return "On track";
    return "Building";
  }, [hasPlan, planProgress, weekTotals.pending, weekTotals.resolved, weekTotals.sessions]);

  const sampleCategories = useMemo(
    () => [
      { key: "all", label: "All" },
      { key: "running", label: "Running" },
      { key: "strength", label: "Strength" },
      { key: "hybrid", label: "Hybrid" },
      { key: "recovery", label: "Recovery" },
    ],
    []
  );
  const visibleSamples = useMemo(() => {
    if (sampleCategory === "all") return SAMPLE_WORKOUTS;
    return SAMPLE_WORKOUTS.filter((w) => w.category === sampleCategory);
  }, [sampleCategory]);
  const recommendedSample = useMemo(() => {
    if (!visibleSamples.length) return null;
    if (sampleCategory !== "all") return visibleSamples[0];

    const day = new Date().getDay();
    const preferredCategory =
      day === 0 || day === 1
        ? "recovery"
        : day === 2 || day === 4
        ? "strength"
        : day === 3
        ? "hybrid"
        : "running";

    return (
      visibleSamples.find((w) => w.category === preferredCategory) ||
      visibleSamples.find((w) => w.category === "running") ||
      visibleSamples[0]
    );
  }, [sampleCategory, visibleSamples]);
  const orderedSamples = useMemo(() => {
    if (!recommendedSample) return visibleSamples;
    return [recommendedSample, ...visibleSamples.filter((w) => w.key !== recommendedSample.key)];
  }, [recommendedSample, visibleSamples]);
  const sampleRecommendationReason = useMemo(() => {
    if (!recommendedSample) return "";
    if (recommendedSample.category === "recovery") return "Low-stress option to stay consistent today.";
    if (recommendedSample.category === "strength") return "Good day to keep strength momentum without overthinking.";
    if (recommendedSample.category === "hybrid") return "Balanced engine and strength mix for a quick quality hit.";
    return "Simple aerobic choice to keep your week moving.";
  }, [recommendedSample]);
  const selectedRecordSample = useMemo(
    () => SAMPLE_WORKOUTS.find((w) => w.key === recordSeedSampleKey) || null,
    [recordSeedSampleKey]
  );
  const selectedRecordHero = useMemo(() => {
    if (!selectedRecordSample) return null;

    if (selectedRecordSample.category === "strength") {
      return {
        colors: theme.isDark ? ["#11150C", "#0B0F08", "#000000"] : ["#C7D83A", "#728116", "#101010"],
        accent: "#D8F04E",
      };
    }

    if (selectedRecordSample.category === "hybrid") {
      return {
        colors: theme.isDark ? ["#091015", "#0B161A", "#000000"] : ["#8DE0F0", "#3C8B8A", "#111111"],
        accent: "#84E6F5",
      };
    }

    if (selectedRecordSample.category === "recovery") {
      return {
        colors: theme.isDark ? ["#0A1211", "#0C1716", "#000000"] : ["#9AD8C2", "#50866D", "#111111"],
        accent: "#8EE4C2",
      };
    }

    return {
      colors: theme.isDark ? ["#06080B", "#0B1115", "#000000"] : ["#D7E83D", "#7A8618", "#111111"],
      accent: theme.primaryBg,
    };
  }, [selectedRecordSample, theme.isDark, theme.primaryBg]);
  const quickCreateCards = useMemo(
    () =>
      QUICK_CREATE_TILES.map((tile) => {
        const sample = SAMPLE_WORKOUTS.find((item) => item.key === tile.sampleKey);
        if (!sample) return null;
        return { ...tile, sample };
      }).filter(Boolean),
    []
  );
  const activeTipTopic = useMemo(
    () => TRAINING_TIP_TOPICS.find((t) => t.key === tipTopicKey) || TRAINING_TIP_TOPICS[0],
    [tipTopicKey]
  );

  const insight = useMemo(() => {
    if (!hasPlan) {
      return {
        title: "Start simple",
        body: "Log one session or use a sample workout today. Build structure once your routine settles.",
      };
    }

    if (!todayFirst && nextSession) {
      return {
        title: `Light ${String(todayHero?.dayLabel || "day").toLowerCase()}`,
        body: `Your next planned session is ${nextSession.dayLabel} · ${nextSession.title}.`,
      };
    }

    if (weekTotals.sessions >= 5) {
      return {
        title: "Big week ahead",
        body: `You’ve got ${weekTotals.sessions} sessions planned. Focus on consistency, not perfection.`,
      };
    }

    return {
      title: "Keep momentum",
      body: `${weekTotals.sessions} sessions planned this week. Nail ${String(todayHero?.dayLabel || "this day").toLowerCase()}, then build from there.`,
    };
  }, [hasPlan, todayFirst, nextSession, weekTotals.sessions, todayHero?.dayLabel]);
  const insightBasisLabel = useMemo(() => {
    if (!hasPlan) return "Based on your current setup";
    if (!todayFirst && nextSession) return `Next planned: ${nextSession.dayLabel}`;
    if (todayHero?.title) return "Based on today's session";
    return "Based on this week's plan";
  }, [hasPlan, nextSession, todayHero?.title]);

  const openDaySheet = useCallback((idx) => {
    setDaySheetIndex(idx);
    setDaySheetOpen(true);
  }, []);

  const closeDaySheet = useCallback(() => setDaySheetOpen(false), []);
  const closeQuickRecord = useCallback(() => {
    setRecordOpen(false);
    setRecordSeedSampleKey("");
  }, []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeTips = useCallback(() => setTipsOpen(false), []);

  const openQuickRecord = useCallback(
    (dayIdx) => {
      setRecordDayIndex(dayIdx);
      setRecordType("run");

      const day = weekGrid?.[dayIdx];
      const defaultTitle =
        day?.cards?.[0]?.title ||
        (day?.dayLabel === "Sat" || day?.dayLabel === "Sun" ? "Training" : "Session");

      setRecordSeedSampleKey("");
      setRecordTitle(defaultTitle);
      setRecordDurationMin("");
      setRecordDistanceKm("");
      setRecordRpe("");
      setRecordNotes("");
      setRecordOpen(true);
    },
    [weekGrid]
  );

  const handleHeaderDayPress = useCallback(
    (item) => {
      const idx = Number.isInteger(item?.dayIdx) ? item.dayIdx : 0;
      setSelectedDayIndex(idx);
    },
    []
  );

  const saveQuickRecord = useCallback(async () => {
    try {
      setSavingQuick(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Not signed in");

      const day = weekGrid?.[recordDayIndex];
      const isoDate = day?.isoDate || toISODate(new Date());

      const t = String(recordType || "run").toLowerCase();
      const sport = t === "run" ? "run" : t === "gym" ? "gym" : "training";

      const durationMin = Number(recordDurationMin || 0) || null;
      const distanceKm = Number(recordDistanceKm || 0) || null;
      const avgRPE = Number(recordRpe || 0) || null;

      const title =
        normaliseStr(recordTitle) ||
        (t === "run" ? "Run" : t === "gym" ? "Gym" : "Training");

      const payload = {
        date: isoDate,
        title,
        planId: plan?.id || null,
        planName: plan?.name || null,
        primaryActivity: plan?.primaryActivity || null,
        status: "completed",
        source: "quick_log",
        actualDurationMin: durationMin,
        actualDistanceKm: distanceKm,
        avgRPE: avgRPE,
        notes: recordNotes || "",
        sessionType: sport,
        workout: {
          sport,
          totalDurationSec: durationMin ? Math.round(durationMin * 60) : 0,
          totalDistanceKm: distanceKm ? Number(distanceKm.toFixed(3)) : 0,
          steps: [],
        },
        createdAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "users", uid, "trainSessions"), payload);

      closeQuickRecord();
      Alert.alert("Saved", "Session logged to history.");
    } catch (e) {
      Alert.alert("Couldn’t save", e?.message || "Try again.");
    } finally {
      setSavingQuick(false);
    }
  }, [
    closeQuickRecord,
    plan?.id,
    plan?.name,
    plan?.primaryActivity,
    recordDayIndex,
    recordDistanceKm,
    recordDurationMin,
    recordNotes,
    recordRpe,
    recordTitle,
    recordType,
    weekGrid,
  ]);

  const handleSendTodayToWatch = useCallback(async () => {
    if (!plan || !todayHero || todayHero.isRestDay || !todayHero.key) return;

    try {
      setSendingToWatch(true);
      const user = auth.currentUser;
      const uid = user?.uid;
      if (!uid) throw new Error("No user");
      const idToken = await user.getIdToken();

      const sess = todayHero.session;
      if (!sess?.workout) throw new Error("No workout data");

      const payload = {
        userId: uid,
        sessionKey: todayHero.key,
        title: todayHero.title,
        workout: sess.workout,
      };

      const res = await fetch(`${API_URL}/garmin/send-workout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          result?.error || result?.message || "Failed to send workout"
        );
      }

      if (result?.synced) {
        Alert.alert("Sent", "Workout sent to your watch.");
      } else {
        Alert.alert(
          "Garmin connected",
          result?.message ||
            "Workout was prepared, but direct Garmin upload is not configured yet."
        );
      }
    } catch (e) {
      Alert.alert("Couldn’t send to watch", e?.message || "Try again.");
    } finally {
      setSendingToWatch(false);
    }
  }, [plan, todayHero]);

  const openPrimaryPlan = useCallback(() => {
    if (plan?.id) {
      router.push({ pathname: "/train/view-plan", params: { planId: plan.id } });
      return;
    }
    router.push("/train/view-plan");
  }, [plan?.id, router]);

  const activeDay = useMemo(() => weekGrid?.[daySheetIndex] || null, [weekGrid, daySheetIndex]);
  const openPlannedCard = useCallback(
    (card, fallbackDayIdx = null) => {
      if (card?.savedTrainSessionId && card?.status === "completed") {
        openHistorySessionFromTrain(card.savedTrainSessionId);
        return;
      }
      if (card?.key) {
        goToSession(card.key);
        return;
      }
      if (Number.isInteger(fallbackDayIdx)) {
        openDaySheet(fallbackDayIdx);
      }
    },
    [goToSession, openDaySheet, openHistorySessionFromTrain]
  );

  const todayHeroPrimaryLabel = useMemo(() => {
    if (todayHero?.status === "completed" && todayHero?.savedTrainSessionId) return "View session";
    if (todayHero?.status === "skipped") return "Open session";
    if (todayHero?.key) return "Start session";
    return "Log session";
  }, [todayHero?.key, todayHero?.savedTrainSessionId, todayHero?.status]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <LinearGradient
        colors={[topFadeStart, theme.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topBackgroundFade}
        pointerEvents="none"
      />
      <ScrollView
        ref={mainScrollRef}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentOffset={
          initialScrollOffsetYRef.current > 0
            ? { x: 0, y: initialScrollOffsetYRef.current }
            : undefined
        }
        contentContainerStyle={s.pageContent}
        onContentSizeChange={restoreScrollPosition}
        onScroll={handleMainScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerTopRow}>
            <Text style={[s.headerTitle, { color: theme.headerTitle }]}>Train</Text>
            <View style={[s.headerContextChip, { backgroundColor: theme.card2, borderColor: theme.border }]}>
              <Text style={[s.headerContextChipText, { color: theme.text }]}>{headerContextChip}</Text>
            </View>
          </View>
          <Text style={[s.headerSubtitle, { color: theme.headerSubtitle }]}>{dynamicSubtitle}</Text>
          <View style={s.headerMetaRow}>
            <Feather name="calendar" size={13} color={theme.subtext} />
            <Text style={[s.headerMetaText, { color: theme.subtext }]}>{headerContextMeta}</Text>
          </View>

          {showResolvedPlanState ? (
            <View style={s.headerWeekRow}>
              <Text style={[s.headerWeekLabel, { color: theme.subtext }]}>
                Week {currentWeekIndex + 1} of {visibleWeeksCount || 1}
                {week?.title ? ` · ${week.title}` : ""}
              </Text>
              <View style={s.weekControls}>
                <TouchableOpacity
                  onPress={() => shiftWeek(-1)}
                  disabled={currentWeekIndex === 0}
                  style={[
                    s.weekNav,
                    { borderColor: theme.border, backgroundColor: theme.card2, opacity: currentWeekIndex === 0 ? 0.45 : 1 },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-left" size={16} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => shiftWeek(1)}
                  disabled={currentWeekIndex >= (visibleWeeksCount || 1) - 1}
                  style={[
                    s.weekNav,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.card2,
                      opacity: currentWeekIndex >= (visibleWeeksCount || 1) - 1 ? 0.45 : 1,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-right" size={16} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={jumpForwardWeeks}
                  disabled={currentWeekIndex >= (visibleWeeksCount || 1) - 1}
                  style={[
                    s.weekJump,
                    {
                      borderColor: theme.border,
                      backgroundColor: theme.card2,
                      opacity: currentWeekIndex >= (visibleWeeksCount || 1) - 1 ? 0.45 : 1,
                    },
                  ]}
                  activeOpacity={0.85}
                >
                  <Text style={[s.weekJumpText, { color: theme.text }]}>+4 wk</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {showResolvedPlanState ? (
            <View
              style={[s.noPlanWeekStrip, s.activePlanWeekStrip]}
              onLayout={(e) => {
                const w = Number(e?.nativeEvent?.layout?.width || 0);
                if (w > 0 && Math.abs(w - weekStripWidth) > 1) {
                  setWeekStripWidth(w);
                }
              }}
              {...weekSwipeResponder.panHandlers}
            >
              <Animated.View
                style={[
                  s.weekCarouselTrack,
                  {
                    width: weekPanelWidth * 3,
                    transform: [{ translateX: weekCarouselTranslateX }],
                  },
                ]}
              >
                {weekCarouselPanels.map((panel) => (
                  <View
                    key={`${panel.id}-${panel.weekIndex}`}
                    style={[s.weekCarouselPanel, { width: weekPanelWidth }]}
                  >
                    {panel.grid.map((item) => {
                      const dayNum = new Date(item.date).getDate();
                      const sessionCount = Array.isArray(item.cards) ? item.cards.length : 0;
                      const hasSessions = sessionCount > 0;
                      const isToday = !!item.isToday;
                      const isSelected = item.dayIdx === selectedDayIndex;
                      const visibleDots = hasSessions ? Math.min(sessionCount, 3) : 0;
                      const sessionSummary = item.sessionSummary || summariseCardStatuses(item.cards);
                      const allResolved = hasSessions && sessionSummary.pending === 0;
                      return (
                        <TouchableOpacity
                          key={`${panel.id}-${item.isoDate}`}
                          style={s.noPlanWeekDay}
                          onPress={() => handleHeaderDayPress(item)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              s.noPlanWeekDow,
                              {
                                color: isSelected || isToday ? theme.text : theme.subtext,
                                opacity: !isSelected && !isToday && !hasSessions ? 0.7 : 1,
                              },
                            ]}
                          >
                            {String(item.dayLabel || "").toUpperCase()}
                          </Text>
                          <View
                            style={[
                              s.noPlanWeekDateWrap,
                              isSelected
                                ? {
                                    backgroundColor: theme.primaryBg,
                                    borderColor: theme.primaryBg,
                                  }
                                : {
                                    backgroundColor: allResolved
                                      ? withHexAlpha(theme.primaryBg, theme.isDark ? "1A" : "26")
                                      : hasSessions
                                      ? theme.card2
                                      : "transparent",
                                    borderColor: allResolved
                                      ? theme.primaryBg
                                      : hasSessions || isToday
                                      ? theme.border
                                      : "transparent",
                                  },
                            ]}
                          >
                            <Text
                              style={[
                                s.noPlanWeekDate,
                                {
                                  color: isSelected
                                    ? theme.primaryText
                                    : !hasSessions
                                    ? theme.subtext
                                    : theme.text,
                                },
                              ]}
                            >
                              {dayNum}
                            </Text>
                          </View>
                          <View style={s.noPlanWeekSessionMarkerRow}>
                            {hasSessions
                              ? item.cards.slice(0, visibleDots).map((card, dotIdx) => {
                                  const status = String(card?.status || "").toLowerCase();
                                  const dotColor =
                                    status === "completed"
                                      ? theme.primaryBg
                                      : status === "skipped"
                                      ? "#F87171"
                                      : isSelected || isToday
                                      ? theme.primaryBg
                                      : theme.text;

                                  return (
                                    <View
                                      key={`${panel.id}-${item.isoDate}-dot-${dotIdx}`}
                                      style={[
                                        s.noPlanWeekSessionDot,
                                        {
                                          backgroundColor: dotColor,
                                          opacity: isSelected ? 1 : isToday ? 0.95 : 0.82,
                                        },
                                      ]}
                                    />
                                  );
                                })
                              : null}
                            {sessionCount > 3 ? (
                              <Text style={[s.noPlanWeekSessionMoreText, { color: theme.subtext }]}>
                                +{sessionCount - 3}
                              </Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </Animated.View>
            </View>
          ) : isResolvingActivePlan ? (
            <View
              style={[
                s.noPlanWeekStrip,
                s.activePlanWeekStrip,
                { alignItems: "center", justifyContent: "center", minHeight: 88 },
              ]}
            >
              <ActivityIndicator size="small" color={theme.primaryBg} />
              <Text style={[s.headerMetaText, { color: theme.subtext, marginTop: 10 }]}>
                Syncing current week
              </Text>
            </View>
          ) : null}
        </View>

        {/* Today hero */}
        <View style={s.heroWrap}>
          <LinearGradient
            colors={["transparent", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              s.hero,
              showEmptyPlanState ? s.heroNoBlock : s.heroNoBg,
              { borderColor: "transparent" },
            ]}
          >
            {showResolvedPlanState ? (
              <>
                <View style={s.heroStatusRow}>
                  <Text style={[s.heroDate, { color: theme.subtext }]}>
                    {todayHero?.dateLabel || headerContextMeta}
                  </Text>
                  {todayHero?.badge ? (
                    <View
                      style={[
                        s.badge,
                        {
                          backgroundColor:
                            todayHero.badge === "COMPLETED"
                              ? withHexAlpha(theme.primaryBg, theme.isDark ? "20" : "2B")
                              : todayHero.badge === "SKIPPED"
                              ? "rgba(248,113,113,0.16)"
                              : theme.card2,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor:
                            todayHero.badge === "COMPLETED"
                              ? withHexAlpha(theme.primaryBg, theme.isDark ? "7A" : "A3")
                              : todayHero.badge === "SKIPPED"
                              ? "rgba(248,113,113,0.45)"
                              : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          s.badgeText,
                          {
                            color:
                              todayHero.badge === "COMPLETED"
                                ? theme.primaryBg
                                : todayHero.badge === "SKIPPED"
                                ? "#F87171"
                                : theme.text,
                          },
                        ]}
                      >
                        {todayHero.badge}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[s.heroTitle, s.heroTitleTight, { color: theme.text }]} numberOfLines={2}>
                  {todayHero?.title || "Rest / optional movement"}
                </Text>
                <Text style={[s.heroSupport, s.heroSupportTight, { color: theme.subtext }]} numberOfLines={2}>
                  {todayHeroSupport}
                </Text>

                <View style={[s.heroActions, s.heroActionsTight]}>
                  <TouchableOpacity
                    onPress={() => {
                      if (todayHero?.status === "completed" && todayHero?.savedTrainSessionId) {
                        openHistorySessionFromTrain(todayHero.savedTrainSessionId);
                        return;
                      }
                      if (todayHero?.key) return goToSession(todayHero.key);
                      openQuickRecord(focusedDay ? focusedDay.dayIdx : 0);
                    }}
                    style={[s.primaryBtn, { backgroundColor: theme.primaryBg, flex: 1 }]}
                    activeOpacity={0.9}
                  >
                    <Feather
                      name={
                        todayHero?.status === "completed" && todayHero?.savedTrainSessionId
                          ? "arrow-up-right"
                          : todayHero?.key
                          ? "play"
                          : "plus-circle"
                      }
                      size={16}
                      color={theme.primaryText}
                    />
                    <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>
                      {todayHeroPrimaryLabel}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={openPrimaryPlan}
                    style={[s.secondaryBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="calendar" size={14} color={theme.text} />
                    <Text style={[s.secondaryBtnText, { color: theme.text }]}>Open plan</Text>
                  </TouchableOpacity>
                </View>

                {extraDaySessions.length ? (
                  <View style={s.heroExtraSessionsWrap}>
                    {extraDaySessions.slice(0, 2).map((card, idx) => {
                      const extraSupport = normaliseStr(
                        card?.meta || getSessionGuidance(card?.sess) || sessionTypeLabel(card?.sess)
                      );
                      return (
                        <View
                          key={`hero-extra-session-${card.key || card.title}-${idx}`}
                          style={[s.heroExtraSessionBlock, { borderTopColor: theme.border }]}
                        >
                          <View style={s.heroExtraSessionTopRow}>
                            <Text style={[s.heroDate, { color: theme.subtext }]}>
                              {todayHero?.dateLabel || headerContextMeta}
                            </Text>

                            {card?.status ? (
                              <View
                                style={[
                                  s.sheetSessionStatusChip,
                                  {
                                    backgroundColor:
                                      card.status === "completed"
                                        ? withHexAlpha(theme.primaryBg, theme.isDark ? "20" : "2B")
                                        : "rgba(248,113,113,0.16)",
                                    borderColor:
                                      card.status === "completed"
                                        ? withHexAlpha(theme.primaryBg, theme.isDark ? "7A" : "A3")
                                        : "rgba(248,113,113,0.45)",
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    s.sheetSessionStatusChipText,
                                    {
                                      color:
                                        card.status === "completed" ? theme.primaryBg : "#F87171",
                                    },
                                  ]}
                                >
                                  {card.status === "completed" ? "Completed" : "Skipped"}
                                </Text>
                              </View>
                            ) : null}
                          </View>

                          <Text style={[s.heroExtraSessionTitle, { color: theme.text }]} numberOfLines={2}>
                            {card?.title || "Session"}
                          </Text>
                          {!!extraSupport ? (
                            <Text style={[s.heroExtraSessionSupport, { color: theme.subtext }]} numberOfLines={2}>
                              {extraSupport}
                            </Text>
                          ) : null}

                          <View style={s.heroExtraSessionActions}>
                            <TouchableOpacity
                              onPress={() => openPlannedCard(card, focusedDay ? focusedDay.dayIdx : 0)}
                              style={[s.primaryBtn, { backgroundColor: theme.primaryBg, flex: 1 }]}
                              activeOpacity={0.9}
                            >
                              <Feather
                                name={
                                  card?.savedTrainSessionId && card?.status === "completed"
                                    ? "arrow-up-right"
                                    : "play"
                                }
                                size={16}
                                color={theme.primaryText}
                              />
                              <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>
                                {card?.savedTrainSessionId && card?.status === "completed"
                                  ? "View session"
                                  : card?.status === "skipped"
                                  ? "Open session"
                                  : "Start session"}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={openPrimaryPlan}
                              style={[s.secondaryBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                              activeOpacity={0.85}
                            >
                              <Feather name="calendar" size={14} color={theme.text} />
                              <Text style={[s.secondaryBtnText, { color: theme.text }]}>Open plan</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                    {extraDaySessions.length > 2 ? (
                      <Text style={[s.heroExtraSessionsMoreText, { color: theme.subtext }]}>
                        +{extraDaySessions.length - 2} more on this day
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : isResolvingActivePlan ? (
              <>
                <Text style={[s.heroDate, { color: theme.subtext }]}>{headerContextMeta}</Text>
                <Text style={[s.heroTitle, { color: theme.text }]}>Loading your active plan</Text>
                <Text style={[s.heroSupport, { color: theme.subtext }]}>
                  Checking your current block and today&apos;s sessions.
                </Text>
              </>
            ) : (
              <>
                <Text style={[s.heroDate, { color: theme.subtext }]}>{headerContextMeta}</Text>
                <Text style={[s.heroTitle, { color: theme.text }]}>Start your training block</Text>
                <Text style={[s.heroSupport, { color: theme.subtext }]}>
                  Build a full plan or quickly log a sample session today.
                </Text>

                <View style={s.heroActions}>
                  <TouchableOpacity
                    onPress={() => router.push("/train/create-home")}
                    style={[s.primaryBtn, { backgroundColor: theme.primaryBg, flex: 1 }]}
                    activeOpacity={0.9}
                  >
                    <Feather name="sparkles" size={16} color={theme.primaryText} />
                    <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>Create plan</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                    style={[s.secondaryBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="plus-circle" size={14} color={theme.text} />
                    <Text style={[s.secondaryBtnText, { color: theme.text }]}>Quick log</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </LinearGradient>
        </View>

        {showResolvedPlanState ? (
          <>
            {/* Up next */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Up next</Text>
              {nextSession ? (
                <TouchableOpacity
                  onPress={() => (nextSession.key ? goToSession(nextSession.key) : openDaySheet(nextSession.dayIdx))}
                  activeOpacity={0.85}
                  style={[s.sessionRow, { marginTop: 8, backgroundColor: quietInsetSurface, borderColor: quietBorder }]}
                >
                  <View style={[s.sessionIcon, { borderColor: theme.border }]}>
                    <Feather name={typeIconName(nextSession.sess)} size={16} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: "600" }}>
                      {nextSession.dayLabel} · {nextSession.dateShort}
                    </Text>
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700", marginTop: 4 }} numberOfLines={1}>
                      {nextSession.title}
                    </Text>
                    {!!nextSession.meta ? (
                      <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 4 }}>{nextSession.meta}</Text>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.subtext} />
                </TouchableOpacity>
              ) : (
                <View style={[s.restCard, { marginTop: 8, borderColor: quietBorder, backgroundColor: quietInsetSurface }]}>
                  <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>No next session scheduled</Text>
                  <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12 }}>
                    If you train today, use Quick log to keep your record complete.
                  </Text>
                </View>
              )}
            </View>

            {/* Plan progress */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Plan progress</Text>
              <View style={[s.progressSectionWrap, { borderTopColor: sectionRuleColor }]}>
                <View style={s.progressTopRow}>
                  <View style={s.progressPlanCol}>
                    <Text style={[s.progressKicker, { color: theme.subtext }]}>Active block</Text>
                    <Text style={[s.progressPlanName, { color: theme.text }]} numberOfLines={1}>
                      {plan.name || "Training Plan"}
                    </Text>
                    <Text style={[s.progressPlanMeta, { color: theme.subtext }]}>
                      Week {currentWeekIndex + 1} · {heroActivityLabel}
                    </Text>
                  </View>

                  <View style={[s.progressPercentChip, { backgroundColor: quietInsetSurface, borderColor: quietBorder }]}>
                    <Text style={[s.progressPercentValue, { color: theme.text }]}>{planProgress}%</Text>
                    <Text style={[s.progressPercentLabel, { color: theme.subtext }]}>complete</Text>
                  </View>
                </View>

                <View style={s.progressMetaRow}>
                  <View style={[s.progressStateChip, { backgroundColor: quietInsetSurface, borderColor: quietBorder }]}>
                    <Text style={[s.progressStateText, { color: theme.text }]}>{progressStateLabel}</Text>
                  </View>
                  <Text style={[s.progressLabel, { color: theme.subtext }]}>Estimated block completion</Text>
                </View>

                <View style={[s.progressTrack, { backgroundColor: quietInsetSurface, borderColor: quietBorder }]}>
                  <View style={[s.progressFill, { backgroundColor: theme.primaryBg, width: `${planProgress}%` }]} />
                </View>

                <View style={s.progressStatsRow}>
                  <View style={[s.progressStatCard, { backgroundColor: quietInsetSurface, borderColor: quietBorder }]}>
                    <Text style={[s.progressStatValue, { color: theme.text }]}>{weekTotals.sessions}</Text>
                    <Text style={[s.progressStatLabel, { color: theme.subtext }]}>Sessions</Text>
                  </View>
                  <View style={[s.progressStatCard, { backgroundColor: quietInsetSurface, borderColor: quietBorder }]}>
                    <Text style={[s.progressStatValue, { color: theme.text }]}>{weekTotals.mins}</Text>
                    <Text style={[s.progressStatLabel, { color: theme.subtext }]}>Minutes</Text>
                  </View>
                  <View style={[s.progressStatCard, { backgroundColor: quietInsetSurface, borderColor: quietBorder }]}>
                    <Text style={[s.progressStatValue, { color: theme.text }]}>{`${weekTotals.km} km`}</Text>
                    <Text style={[s.progressStatLabel, { color: theme.subtext }]}>Distance</Text>
                  </View>
                </View>

                <Text style={[s.progressHint, { color: theme.subtext }]}>
                  Progress is based on week position in this block. {weekTotals.resolved}/{weekTotals.sessions} sessions are marked this week.
                </Text>
              </View>
            </View>

            {/* Coach insight */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Coach insight</Text>
              <View style={[s.insightBlock, { borderTopColor: sectionRuleColor }]}>
                <Text style={[s.insightKicker, { color: theme.subtext }]}>Today</Text>
                <Text style={[s.insightHeadline, { color: theme.text }]}>{insight.title}</Text>
                <Text style={[s.insightBody, { color: theme.subtext }]}>
                  {insight.body}
                </Text>
                <View style={s.insightMetaRow}>
                  <View style={[s.insightMetaDot, { backgroundColor: theme.primaryBg }]} />
                  <Text style={[s.insightMetaText, { color: theme.subtext }]}>{insightBasisLabel}</Text>
                </View>

                <View style={s.insightActionsRow}>
                  <ActionRowButton
                    icon="message-circle"
                    label="Ask coach"
                    theme={theme}
                    primary
                    onPress={() => router.push("/chat")}
                  />
                  <TouchableOpacity
                    onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                    activeOpacity={0.8}
                    style={s.insightTextLink}
                  >
                    <Text style={[s.insightTextLinkLabel, { color: theme.text }]}>Quick log</Text>
                    <Feather name="arrow-up-right" size={13} color={theme.subtext} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </>
        ) : showEmptyPlanState ? (
          <>
            {/* Sample workouts */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Sample workouts</Text>
              <Text style={[s.sampleIntro, { color: theme.subtext }]}>
                Pick one structured sample and log it in seconds.
              </Text>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sampleTabRow}>
                {sampleCategories.map((cat) => {
                  const active = sampleCategory === cat.key;
                  return (
                    <TouchableOpacity
                      key={`sample-tab-${cat.key}`}
                      onPress={() => setSampleCategory(cat.key)}
                      style={[
                        s.sampleTab,
                        active
                          ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
                          : { backgroundColor: theme.card2, borderColor: theme.border },
                      ]}
                      activeOpacity={0.85}
                    >
                      <Text style={{ color: active ? theme.primaryText : theme.subtext, fontWeight: active ? "700" : "600", fontSize: 12 }}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.noPlanCarouselRow}>
                {orderedSamples.map((sample, idx) => {
                  const isRecommended = idx === 0 && sample.key === recommendedSample?.key;
                  return (
                    <View
                      key={sample.key}
                      style={[s.sampleFeaturedCard, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
                    >
                      <View style={s.sampleFeaturedTop}>
                        <View style={[s.sampleTypePill, { borderColor: quietBorder, backgroundColor: quietSectionSurface }]}>
                          <Feather name={sampleIconName(sample.type)} size={13} color={theme.text} />
                          <Text style={[s.sampleTypeText, { color: theme.text }]}>{sample.type}</Text>
                        </View>
                        {isRecommended ? (
                          <Text style={[s.sampleRecoLabel, { color: theme.subtext }]}>Recommended today</Text>
                        ) : null}
                      </View>

                      <Text style={[s.sampleFeaturedTitle, { color: theme.text }]} numberOfLines={2}>
                        {sample.title}
                      </Text>
                      <Text style={[s.sampleFeaturedSummary, { color: theme.subtext }]} numberOfLines={2}>
                        {sample.summary || sample.notes}
                      </Text>
                      <Text style={[s.sampleBestFor, { color: theme.subtext }]} numberOfLines={1}>
                        {sample.durationMin} min · {sampleSecondaryMeta(sample)} · RPE {sample.rpe}
                      </Text>

                      <TouchableOpacity
                        onPress={() =>
                          router.push({
                            pathname: "/train/create-workout",
                            params: { sampleKey: sample.key, mode: "manual" },
                          })
                        }
                        style={[s.samplePrimaryCta, { backgroundColor: theme.primaryBg }]}
                        activeOpacity={0.9}
                      >
                        <Feather name="plus-circle" size={15} color={theme.primaryText} />
                        <Text style={[s.samplePrimaryCtaText, { color: theme.primaryText }]}>Use sample</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* Guided get started */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Get started</Text>
              <View style={[s.card, { backgroundColor: quietSectionSurface, borderColor: quietBorder }]}>
                <Text style={[s.cardTitle, { color: theme.text }]}>One simple next step</Text>
                <Text style={{ color: theme.subtext, marginTop: 6, fontSize: 13, lineHeight: 20 }}>
                  {NO_PLAN_NOTE}
                </Text>

                <TouchableOpacity
                  onPress={() => router.push("/train/create-home")}
                  style={[s.primaryBtn, { backgroundColor: theme.primaryBg, marginTop: 14 }]}
                  activeOpacity={0.9}
                >
                  <Feather name="sparkles" size={16} color={theme.primaryText} />
                  <Text style={[s.primaryBtnText, { color: theme.primaryText }]}>Create my first plan</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                  style={[s.secondaryGhost, { borderColor: quietBorder, backgroundColor: quietInsetSurface, marginTop: 10 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={14} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "700" }}>Quick log instead</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : (
          <View style={s.section}>
            <View style={[s.restCard, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}>
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>Loading active plan</Text>
              <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12 }}>
                Pulling your latest schedule so the correct sessions show straight away.
              </Text>
            </View>
          </View>
        )}

        {/* Explore */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={[s.sectionTitle, { color: theme.text }]}>Explore</Text>
            <TouchableOpacity
              onPress={() => setMoreOpen(true)}
              style={[s.coachBrowseBtn, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
              activeOpacity={0.85}
            >
              <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>More</Text>
              <Feather name="chevron-right" size={13} color={theme.text} />
            </TouchableOpacity>
          </View>
          <Text style={[s.sectionSubtle, { color: theme.subtext }]}>
            Secondary discovery: coach templates and training knowledge.
          </Text>

          <View style={[s.card, { backgroundColor: quietSectionSurface, borderColor: quietBorder }]}>
            <View style={s.sectionHead}>
              <Text style={[s.cardTitle, { color: theme.text }]}>Coach set plans</Text>
              <TouchableOpacity
                onPress={() => router.push("/train/coach-plans")}
                style={[s.coachBrowseBtn, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>Browse all</Text>
                <Feather name="chevron-right" size={13} color={theme.text} />
              </TouchableOpacity>
            </View>

            {hasRunPlan && !hasStrengthPlan ? (
              <TouchableOpacity
                onPress={() => router.push("/train/create/create-strength")}
                style={[s.exploreAssistRow, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
                activeOpacity={0.85}
              >
                <Feather name="bar-chart-2" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700", flex: 1 }}>
                  Add a strength companion plan to balance your run block.
                </Text>
                <Feather name="chevron-right" size={14} color={theme.subtext} />
              </TouchableOpacity>
            ) : null}
            {hasStrengthPlan && !hasRunPlan ? (
              <TouchableOpacity
                onPress={() => router.push("/train/create/create-run")}
                style={[s.exploreAssistRow, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
                activeOpacity={0.85}
              >
                <Feather name="activity" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700", flex: 1 }}>
                  Add a run companion plan to round out weekly conditioning.
                </Text>
                <Feather name="chevron-right" size={14} color={theme.subtext} />
              </TouchableOpacity>
            ) : null}

            {coachPlansLoading ? (
              <View style={s.coachLoadingWrap}>
                <ActivityIndicator />
                <Text style={{ color: theme.subtext, fontWeight: "600", fontSize: 12 }}>Loading coach plans…</Text>
              </View>
            ) : coachPlans.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.coachPlanRow}>
                {coachPlans.map((cp) => {
                  const isRun = cp.kind === "run";
                  const isStrength = cp.kind === "strength";
                  const kindIcon = isRun ? "activity" : isStrength ? "bar-chart-2" : "layers";
                  const kindLabel = isRun ? "Run" : isStrength ? "Strength" : "Training";
                  const isLocalTemplate = cp.sourceCollection === "localTemplates";
                  const isUsing = String(usingCoachPlanId) === String(cp.id);

                  return (
                    <View
                      key={`${cp.sourceCollection}_${cp.id}`}
                      style={[s.coachPlanCard, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
                    >
                      <View style={s.coachPlanTop}>
                        <View style={[s.coachTypePill, { backgroundColor: quietSectionSurface, borderColor: quietBorder }]}>
                          <Feather name={kindIcon} size={12} color={theme.text} />
                          <Text style={[s.coachTypePillText, { color: theme.text }]}>{kindLabel}</Text>
                        </View>
                        <Text style={{ color: theme.subtext, fontSize: 11, fontWeight: "600" }} numberOfLines={1}>
                          {cp.coachName}
                        </Text>
                      </View>

                      <Text style={[s.coachPlanName, { color: theme.text }]} numberOfLines={2}>
                        {cp.name}
                      </Text>
                      <Text style={[s.coachPlanMeta, { color: theme.subtext }]}>
                        {cp.weekCount} weeks · {cp.sessionCount} sessions
                      </Text>

                      <View style={s.coachPlanActions}>
                        <TouchableOpacity
                          onPress={() => viewCoachPlan(cp)}
                          style={[s.coachActionBtn, { borderColor: quietBorder, backgroundColor: quietSectionSurface }]}
                          activeOpacity={0.85}
                        >
                          <Feather name="eye" size={13} color={theme.text} />
                          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>View</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() =>
                            isLocalTemplate
                              ? router.push({
                                  pathname: "/train/coach-plan-preview",
                                  params: { templateId: cp.id },
                                })
                              : activateCoachPlan(cp)
                          }
                          disabled={isUsing}
                          style={[
                            s.coachActionBtn,
                            {
                              borderColor: "rgba(0,0,0,0)",
                              backgroundColor: theme.primaryBg,
                              opacity: isUsing ? 0.7 : 1,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          {isUsing ? (
                            <ActivityIndicator size="small" color={theme.primaryText} />
                          ) : (
                            <Feather
                              name={isLocalTemplate ? "sliders" : "plus"}
                              size={13}
                              color={theme.primaryText}
                            />
                          )}
                          <Text style={{ color: theme.primaryText, fontWeight: "700", fontSize: 12 }}>
                            {isUsing ? "Adding…" : isLocalTemplate ? "Personalise" : "Use"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={[s.restCard, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}>
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>No coach plans published</Text>
                <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12 }}>
                  Coach-set templates will appear here as they’re published.
                </Text>
              </View>
            )}
          </View>

          <View style={s.exploreTipsBlock}>
            <View style={s.sectionHead}>
              <View style={{ flex: 1 }}>
                <Text style={[s.cardTitle, { color: theme.text }]}>Create workout</Text>
                <Text style={[s.sectionSubtle, { color: theme.subtext, marginTop: 4 }]}>
                  Prefill a run, strength or hybrid session in one tap.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: "/train/create-workout",
                    params: { mode: "ai" },
                  })
                }
                style={[s.coachBrowseBtn, { borderColor: quietBorder, backgroundColor: quietInsetSurface }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>Generate</Text>
                <Feather name="sparkles" size={13} color={theme.text} />
              </TouchableOpacity>
            </View>

            <View style={s.quickCreateGrid}>
              {quickCreateCards.map((card) => (
                <TouchableOpacity
                  key={`quick-create-${card.sampleKey}`}
                  onPress={() =>
                    router.push({
                      pathname: "/train/create-workout",
                      params: { sampleKey: card.sampleKey, mode: "manual" },
                    })
                  }
                  style={s.quickCreateCardShell}
                  activeOpacity={0.9}
                >
                  <LinearGradient
                    colors={[
                      withHexAlpha(card.colors[0], theme.isDark ? "26" : "18"),
                      withHexAlpha(card.colors[1], theme.isDark ? "12" : "0D"),
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[
                      s.quickCreateCard,
                      {
                        backgroundColor: theme.card2,
                        borderColor: withHexAlpha(card.colors[0], theme.isDark ? "52" : "30"),
                      },
                    ]}
                  >
                    <View style={s.quickCreateCardTop}>
                      <View
                        style={[
                          s.quickCreateIconPill,
                          {
                            backgroundColor: withHexAlpha(card.colors[0], theme.isDark ? "28" : "22"),
                            borderColor: withHexAlpha(card.colors[0], theme.isDark ? "5E" : "3D"),
                          },
                        ]}
                      >
                        <Feather name={card.icon} size={14} color="#FFFFFF" />
                      </View>
                      <Text style={s.quickCreateCardKicker}>{card.kicker}</Text>
                    </View>

                    <Text style={s.quickCreateCardTitle} numberOfLines={2}>
                      {card.label}
                    </Text>
                    <Text style={s.quickCreateCardMeta} numberOfLines={1}>
                      {card.sample.durationMin} min · {sampleSecondaryMeta(card.sample)} · {sampleEffortLabel(card.sample.rpe)}
                    </Text>

                    <Feather
                      name={card.icon}
                      size={42}
                      color="rgba(255,255,255,0.12)"
                      style={s.quickCreateWatermark}
                    />
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>

            <View
              style={[
                s.quickCreateCompactFooter,
                { borderColor: theme.border, backgroundColor: theme.card2 },
              ]}
            >
              <Text style={[s.quickCreateCompactText, { color: theme.subtext }]}>
                Use a tile for a structured custom workout, or quick log if you trained something else.
              </Text>
              <TouchableOpacity
                onPress={() => openQuickRecord(focusedDay ? focusedDay.dayIdx : 0)}
                style={[s.quickCreateCompactBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.85}
              >
                <Feather name="plus-circle" size={14} color={theme.text} />
                <Text style={[s.quickCreateCompactBtnText, { color: theme.text }]}>Quick log</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.exploreTipsBlock}>
            <View style={s.sectionHead}>
              <Text style={[s.cardTitle, { color: theme.text }]}>Training tips</Text>
              <TouchableOpacity
                onPress={() => setTipsOpen(true)}
                style={[s.coachBrowseBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>Open guide</Text>
                <Feather name="chevron-right" size={13} color={theme.text} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tipCardRow}>
              {TRAINING_TIP_TOPICS.slice(0, 6).map((topic) => (
                <TouchableOpacity
                  key={`tip-card-preview-${topic.key}`}
                  onPress={() => {
                    setTipTopicKey(topic.key);
                    setTipsOpen(true);
                  }}
                  style={s.tipCard}
                  activeOpacity={0.85}
                >
                  <Image source={topic.image} style={s.tipCardImage} resizeMode="cover" />
                  <View style={s.tipCardOverlay} />
                  <Text style={s.tipCardTitle} numberOfLines={2}>
                    {topic.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </ScrollView>

      {/* More actions sheet */}
      <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={closeMore}>
        <View style={s.modalBackdrop}>
          <View style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>More actions</Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    Quick actions without cluttering the page
                  </Text>
                </View>

                <TouchableOpacity onPress={closeMore} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <View style={{ gap: 10, marginTop: 12 }}>
                <Text style={[s.sheetGroupTitle, { color: theme.subtext }]}>Training</Text>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    openQuickRecord(focusedDay ? focusedDay.dayIdx : 0);
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Quick log</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    openPrimaryPlan();
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="calendar" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Open full plan</Text>
                </TouchableOpacity>

                {hasRunPlan && !hasStrengthPlan ? (
                  <TouchableOpacity
                    onPress={() => {
                      closeMore();
                      router.push("/train/create/create-strength");
                    }}
                    style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="bar-chart-2" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>Add strength plan</Text>
                  </TouchableOpacity>
                ) : null}
                {hasStrengthPlan && !hasRunPlan ? (
                  <TouchableOpacity
                    onPress={() => {
                      closeMore();
                      router.push("/train/create/create-run");
                    }}
                    style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="activity" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>Add run plan</Text>
                  </TouchableOpacity>
                ) : null}

                <Text style={[s.sheetGroupTitle, { color: theme.subtext, marginTop: 4 }]}>Review</Text>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    router.push("/train/history");
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="clock" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>View history</Text>
                </TouchableOpacity>

                <Text style={[s.sheetGroupTitle, { color: theme.subtext, marginTop: 4 }]}>Coach + tools</Text>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    router.push("/chat");
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="message-circle" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Ask coach</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    closeMore();
                    setTipsOpen(true);
                  }}
                  style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="book-open" size={16} color={theme.text} />
                  <Text style={[s.sheetActionText, { color: theme.text }]}>Open training guide</Text>
                </TouchableOpacity>

                {hasPlan ? (
                  <TouchableOpacity
                    onPress={async () => {
                      closeMore();
                      await handleSendTodayToWatch();
                    }}
                    disabled={sendingToWatch || !todayHero?.key}
                    style={[
                      s.sheetAction,
                      {
                        borderColor: theme.border,
                        backgroundColor: theme.card2,
                        opacity: sendingToWatch || !todayHero?.key ? 0.55 : 1,
                      },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Feather name="watch" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>
                      {sendingToWatch ? "Sending…" : "Send selected day to watch"}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {hasPlan ? (
                  <TouchableOpacity
                    onPress={() => {
                      closeMore();
                      router.push({ pathname: "/train/edit-plan", params: { edit: "1", id: plan.id } });
                    }}
                    style={[s.sheetAction, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Feather name="edit-3" size={16} color={theme.text} />
                    <Text style={[s.sheetActionText, { color: theme.text }]}>Edit plan</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Training tips sheet */}
      <Modal visible={tipsOpen} transparent animationType="slide" onRequestClose={closeTips}>
        <View style={s.modalBackdrop}>
          <View style={s.tipsSheetDock}>
            <View style={[s.sheet, s.tipsSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>Training guide</Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    Niche topics and practical ideas for performance.
                  </Text>
                </View>

                <TouchableOpacity onPress={closeTips} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ marginTop: 10 }} showsVerticalScrollIndicator={false}>
                <Text style={[s.tipArticleTitle, { color: theme.text }]}>{activeTipTopic?.title}</Text>
                <Text style={[s.tipArticleSubtitle, { color: theme.subtext }]}>
                  {activeTipTopic?.subtitle}
                </Text>

                <View style={s.tipAuthorRow}>
                  <View
                    style={[
                      s.tipAuthorAvatar,
                      { borderColor: theme.border, backgroundColor: theme.card2 },
                    ]}
                  >
                    <Feather name="user" size={12} color={theme.text} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.tipAuthorText, { color: theme.text }]}>
                      Written by {activeTipTopic?.author || "Coach Team"}
                    </Text>
                    <Text style={[s.tipAuthorMeta, { color: theme.subtext }]}>
                      {activeTipTopic?.updatedText || "Recently updated"}
                    </Text>
                  </View>
                </View>

                <View style={[s.tipDetailCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <Image source={activeTipTopic?.image} style={s.tipDetailImage} resizeMode="cover" />
                </View>

                <Text style={[s.tipBodyText, { color: theme.text }]}>{activeTipTopic?.intro}</Text>
                {(activeTipTopic?.bullets || []).map((point, idx) => (
                  <View key={`tip-detail-point-${idx}`} style={s.tipBulletRow}>
                    <View style={[s.tipPointDot, { backgroundColor: theme.primaryBg }]} />
                    <Text style={[s.tipBulletText, { color: theme.text }]}>{point}</Text>
                  </View>
                ))}

                {activeTipTopic?.sectionTitle ? (
                  <View style={[s.tipCallout, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                    <Text style={[s.tipCalloutTitle, { color: theme.text }]}>
                      {activeTipTopic.sectionTitle}
                    </Text>
                    <Text style={[s.tipCalloutBody, { color: theme.subtext }]}>
                      {activeTipTopic?.sectionBody}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      {/* Day sheet */}
      <Modal visible={daySheetOpen} transparent animationType="slide" onRequestClose={closeDaySheet}>
        <View style={s.modalBackdrop}>
          <View style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>
                    {activeDay?.dayLabel || "Day"}
                  </Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    {activeDay?.dateLabel || ""}
                  </Text>
                </View>

                <TouchableOpacity onPress={closeDaySheet} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => {
                    closeDaySheet();
                    openQuickRecord(activeDay?.dayIdx ?? 0);
                  }}
                  style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, flex: 1 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="plus" size={14} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "900" }}>Quick log</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    closeDaySheet();
                    openPrimaryPlan();
                  }}
                  style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, flex: 1 }]}
                  activeOpacity={0.85}
                >
                  <Feather name="calendar" size={14} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "900" }}>Open plan</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                onPress={() => {
                  closeDaySheet();
                  router.push("/chat");
                }}
                style={[s.secondaryGhost, { borderColor: theme.border, backgroundColor: theme.card2, marginTop: 10 }]}
                activeOpacity={0.85}
              >
                <Feather name="message-circle" size={14} color={theme.text} />
                <Text style={{ color: theme.text, fontWeight: "900" }}>Ask coach about this day</Text>
              </TouchableOpacity>

              <View style={{ marginTop: 12, gap: 10 }}>
                {activeDay?.cards?.length ? (
                  activeDay.cards.map((c, idx) => (
                    <TouchableOpacity
                      key={`${activeDay.isoDate}_${idx}`}
                      onPress={() => {
                        closeDaySheet();
                        openPlannedCard(c, activeDay?.dayIdx ?? 0);
                      }}
                      activeOpacity={0.85}
                      style={[s.sheetSession, { backgroundColor: theme.card2, borderColor: theme.border }]}
                    >
                      <View style={[s.sessionIcon, { borderColor: theme.border }]}>
                        <Feather name={typeIconName(c.sess)} size={16} color={theme.text} />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={s.sheetSessionTitleRow}>
                          <Text style={{ color: theme.text, fontWeight: "900", flex: 1 }} numberOfLines={1}>
                            {c.title}
                          </Text>
                          {c.status ? (
                            <View
                              style={[
                                s.sheetSessionStatusChip,
                                {
                                  backgroundColor:
                                    c.status === "completed"
                                      ? withHexAlpha(theme.primaryBg, theme.isDark ? "20" : "2B")
                                      : "rgba(248,113,113,0.16)",
                                  borderColor:
                                    c.status === "completed"
                                      ? withHexAlpha(theme.primaryBg, theme.isDark ? "7A" : "A3")
                                      : "rgba(248,113,113,0.45)",
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  s.sheetSessionStatusChipText,
                                  {
                                    color: c.status === "completed" ? theme.primaryBg : "#F87171",
                                  },
                                ]}
                              >
                                {c.status === "completed" ? "Completed" : "Skipped"}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {!!c.meta ? (
                          <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 4, fontWeight: "800" }}>
                            {c.meta}
                          </Text>
                        ) : null}
                        {!!c.guidance ? (
                          <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 3, fontWeight: "700" }}>
                            {c.guidance}
                          </Text>
                        ) : null}
                      </View>

                      <Feather name="chevron-right" size={18} color={theme.subtext} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={[s.restCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                    <Text style={{ color: theme.text, fontWeight: "900" }}>Rest / open day</Text>
                    <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12, fontWeight: "800" }}>
                      Tap Quick log to record anything you do.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Quick log modal */}
      <Modal visible={recordOpen} transparent animationType="slide" onRequestClose={closeQuickRecord}>
        <View style={s.modalBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={s.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>Quick log</Text>
                  <Text style={{ color: theme.subtext, marginTop: 3, fontSize: 12, fontWeight: "500" }}>
                    {weekGrid?.[recordDayIndex]?.dateLabel || "Session"}
                  </Text>
                </View>

                <TouchableOpacity onPress={closeQuickRecord} style={s.sheetClose} activeOpacity={0.85}>
                  <Feather name="x" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={s.quickLogScroll}
                contentContainerStyle={s.quickLogContent}
                showsVerticalScrollIndicator={false}
              >
                {selectedRecordSample ? (
                  <LinearGradient
                    colors={selectedRecordHero?.colors || [theme.card2, theme.card, "#000000"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[s.quickLogHero, { borderColor: withHexAlpha(selectedRecordHero?.accent || theme.primaryBg, theme.isDark ? "3D" : "33") }]}
                  >
                    <View style={s.quickLogHeroTop}>
                      <Text style={s.quickLogHeroEyebrow}>
                        {(weekGrid?.[recordDayIndex]?.dateLabel || "Session") + " · Prefilled sample"}
                      </Text>

                      <View
                        style={[
                          s.quickLogHeroTypePill,
                          {
                            backgroundColor: withHexAlpha(selectedRecordHero?.accent || theme.primaryBg, theme.isDark ? "20" : "1A"),
                            borderColor: withHexAlpha(selectedRecordHero?.accent || theme.primaryBg, theme.isDark ? "66" : "52"),
                          },
                        ]}
                      >
                        <Feather
                          name={sampleIconName(selectedRecordSample.type)}
                          size={13}
                          color={selectedRecordHero?.accent || theme.primaryBg}
                        />
                        <Text style={[s.quickLogHeroTypeText, { color: selectedRecordHero?.accent || theme.primaryBg }]}>
                          {selectedRecordSample.type}
                        </Text>
                      </View>
                    </View>

                    <Text style={s.quickLogHeroTitle}>{recordTitle || selectedRecordSample.title}</Text>
                    <Text style={s.quickLogHeroSummary} numberOfLines={2}>
                      {selectedRecordSample.summary || selectedRecordSample.notes}
                    </Text>

                    <View style={s.quickLogHeroMetaRow}>
                      <View style={s.quickLogHeroMetaChip}>
                        <Feather name="clock" size={12} color="#FFFFFF" />
                        <Text style={s.quickLogHeroMetaText}>
                          {recordDurationMin || selectedRecordSample.durationMin || "0"} min
                        </Text>
                      </View>
                      <View style={s.quickLogHeroMetaChip}>
                        <Feather name="map-pin" size={12} color="#FFFFFF" />
                        <Text style={s.quickLogHeroMetaText}>
                          {recordDistanceKm || (selectedRecordSample.distanceKm ? selectedRecordSample.distanceKm.toFixed(1) : "0")} km
                        </Text>
                      </View>
                      <View style={s.quickLogHeroMetaChip}>
                        <Text style={s.quickLogHeroMetaText}>
                          RPE {recordRpe || selectedRecordSample.rpe || "–"}
                        </Text>
                      </View>
                    </View>

                    <View style={s.quickLogHeroBestForRow}>
                      <Feather name="sparkles" size={13} color={selectedRecordHero?.accent || theme.primaryBg} />
                      <Text style={s.quickLogHeroBestFor}>
                        {selectedRecordSample.bestFor || sampleRecommendationReason}
                      </Text>
                    </View>

                    <LinearGradient
                      colors={["transparent", selectedRecordHero?.accent || theme.primaryBg, "transparent"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={s.quickLogHeroEdge}
                    />
                  </LinearGradient>
                ) : null}

                <Text style={[s.quickLogSectionTitle, { color: theme.subtext }]}>Session type</Text>
                <View style={[s.quickLogEditCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[
                      { key: "run", label: "Run", icon: "activity" },
                      { key: "gym", label: "Gym", icon: "zap" },
                      { key: "other", label: "Other", icon: "more-horizontal" },
                    ].map((t) => {
                      const active = recordType === t.key;
                      return (
                        <TouchableOpacity
                          key={t.key}
                          onPress={() => setRecordType(t.key)}
                          style={[
                            s.typePill,
                            {
                              borderColor: active ? "rgba(0,0,0,0)" : theme.border,
                              backgroundColor: active ? theme.primaryBg : theme.card,
                            },
                          ]}
                          activeOpacity={0.85}
                        >
                          <Feather name={t.icon} size={14} color={active ? theme.primaryText : theme.text} />
                          <Text style={{ color: active ? theme.primaryText : theme.text, fontWeight: "700" }}>
                            {t.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <Text style={[s.quickLogSectionTitle, { color: theme.subtext }]}>Session details</Text>
                <View style={[s.quickLogEditCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <Text style={[s.quickLogLabel, { color: theme.subtext }]}>Title</Text>
                  <TextInput
                    value={recordTitle}
                    onChangeText={setRecordTitle}
                    placeholder="e.g. Easy run / Upper body"
                    placeholderTextColor={theme.subtext}
                    style={[
                      s.quickLogInput,
                      { borderColor: theme.border, color: theme.text, backgroundColor: theme.card },
                    ]}
                  />

                  <View style={s.quickLogStatsRow}>
                    <View style={[s.quickLogStatBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <Text style={[s.quickLogStatLabel, { color: theme.subtext }]}>Duration (min)</Text>
                      <TextInput
                        value={recordDurationMin}
                        onChangeText={setRecordDurationMin}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.subtext}
                        style={[s.quickLogStatInput, { color: theme.text }]}
                      />
                    </View>

                    <View style={[s.quickLogStatBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <Text style={[s.quickLogStatLabel, { color: theme.subtext }]}>Distance (km)</Text>
                      <TextInput
                        value={recordDistanceKm}
                        onChangeText={setRecordDistanceKm}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.subtext}
                        style={[s.quickLogStatInput, { color: theme.text }]}
                      />
                    </View>

                    <View style={[s.quickLogStatBox, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <Text style={[s.quickLogStatLabel, { color: theme.subtext }]}>RPE</Text>
                      <TextInput
                        value={recordRpe}
                        onChangeText={setRecordRpe}
                        keyboardType="numeric"
                        placeholder="–"
                        placeholderTextColor={theme.subtext}
                        style={[s.quickLogStatInput, { color: theme.text }]}
                      />
                    </View>
                  </View>
                </View>

                <Text style={[s.quickLogSectionTitle, { color: theme.subtext }]}>Description / notes</Text>
                <View style={[s.quickLogEditCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                  <TextInput
                    value={recordNotes}
                    onChangeText={setRecordNotes}
                    placeholder="Anything worth noting…"
                    placeholderTextColor={theme.subtext}
                    multiline
                    style={[
                      s.quickLogNotesInput,
                      { borderColor: theme.border, color: theme.text, backgroundColor: theme.card },
                    ]}
                  />
                </View>

                <View style={s.quickLogActionRow}>
                  <TouchableOpacity
                    onPress={closeQuickRecord}
                    style={[s.modalBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: theme.text, fontWeight: "900" }}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={saveQuickRecord}
                    disabled={savingQuick}
                    style={[
                      s.modalBtn,
                      {
                        borderColor: "rgba(0,0,0,0)",
                        backgroundColor: theme.primaryBg,
                        flex: 1,
                        opacity: savingQuick ? 0.7 : 1,
                      },
                    ]}
                    activeOpacity={0.9}
                  >
                    {savingQuick ? (
                      <ActivityIndicator color={theme.primaryText} />
                    ) : (
                      <>
                        <Feather name="check" size={16} color={theme.primaryText} />
                        <Text style={{ color: theme.primaryText, fontWeight: "900" }}>
                          {selectedRecordSample ? "Save sample log" : "Save log"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={[s.quickLogHelper, { color: theme.subtext }]}>
                  {selectedRecordSample
                    ? "Sample values are prefilled. Edit anything before saving."
                    : "Saves to History as a quick log (no structured steps)."}
                </Text>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────────
   Styles
────────────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  topBackgroundFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 280,
  },
  pageContent: { paddingHorizontal: 18, paddingBottom: 140, gap: 16 },
  header: { marginTop: 8, marginBottom: 6 },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerTitle: { fontSize: 31, fontWeight: "800", letterSpacing: 0.2 },
  headerSubtitle: { fontSize: 13, marginTop: 3, fontWeight: "500", lineHeight: 18 },
  headerContextChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 30,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  headerContextChipText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  headerMetaRow: { marginTop: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  headerMetaText: { fontSize: 12, fontWeight: "500" },
  headerWeekRow: {
    marginTop: 10,
    marginBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerWeekLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  noPlanWeekStrip: {
    marginTop: 12,
    marginBottom: 2,
    overflow: "hidden",
    width: "100%",
  },
  weekCarouselTrack: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  weekCarouselPanel: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 2,
  },
  activePlanWeekStrip: {
    marginTop: 10,
    marginBottom: 4,
  },
  noPlanWeekDay: {
    flex: 1,
    alignItems: "center",
    gap: 7,
    minWidth: 44,
  },
  noPlanWeekDow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  noPlanWeekDateWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  noPlanWeekDate: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  noPlanWeekSessionMarkerRow: {
    minHeight: 8,
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  noPlanWeekSessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  noPlanWeekSessionMoreText: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginLeft: 2,
  },

  heroWrap: { marginBottom: 4 },
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  heroNoBg: {
    borderWidth: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    backgroundColor: "transparent",
  },
  heroNoBlock: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
    overflow: "visible",
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  heroTopMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroKicker: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontWeight: "800",
  },
  heroPlan: { fontSize: 20, fontWeight: "900", marginTop: 4 },
  heroMeta: { fontSize: 13, marginTop: 2 },

  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  heroMain: { marginTop: 14 },
  heroStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  heroDate: { fontSize: 12, fontWeight: "500" },
  heroSupport: { marginTop: 8, fontSize: 13, lineHeight: 19, fontWeight: "500" },
  heroExtraSessionsWrap: {
    marginTop: 8,
    gap: 0,
  },
  heroExtraSessionBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  heroExtraSessionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  heroExtraSessionTitle: {
    marginTop: 4,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
  },
  heroExtraSessionSupport: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  heroExtraSessionActions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    marginTop: 10,
  },
  heroExtraSessionsMoreText: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 8,
  },
  heroInfoRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  heroInfoChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 26,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroInfoChipText: {
    fontSize: 11,
    fontWeight: "900",
  },
  heroTitle: { fontSize: 26, lineHeight: 32, fontWeight: "700", marginTop: 8 },
  heroTitleTight: { marginTop: 5, lineHeight: 30 },
  heroSupportTight: { marginTop: 5, lineHeight: 18 },
  heroSubStrong: { fontSize: 13, marginTop: 8, fontWeight: "800" },
  heroFocusRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 10 },
  heroPip: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  heroFocus: { fontSize: 13, fontWeight: "800", flex: 1 },
  heroNextUpRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroNextUpText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },

  heroActions: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 16 },
  heroActionsTight: { marginTop: 10 },
  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  primaryBtnText: { fontWeight: "700", fontSize: 13 },
  secondaryBtn: {
    minWidth: 120,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  secondaryBtnText: { fontWeight: "700", fontSize: 12 },
  heroTextLink: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  quickNav: { flexDirection: "row", gap: 10, marginTop: 2 },
  quickBtn: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  quickBtnText: { fontWeight: "900", fontSize: 13 },

  section: { marginTop: 4, marginBottom: 8 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: "700", letterSpacing: 0.1 },
  sectionSubtle: { fontSize: 12, fontWeight: "500", marginTop: -2, marginBottom: 10, lineHeight: 17 },

  weekControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  weekStripRow: { gap: 10, paddingRight: 8 },
  weekNav: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  weekJump: {
    minWidth: 58,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  weekJumpText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 14,
    marginTop: 8,
  },
  cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: "700", lineHeight: 22 },

  dayPill: {
    width: 96,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
    minHeight: 108,
  },
  dayPillTop: { width: "100%" },
  dayPillDow: { fontSize: 13, fontWeight: "700" },
  dayPillDate: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  dayPillStatus: {
    marginTop: 8,
    borderRadius: 999,
    minHeight: 20,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayPillStatusText: { fontSize: 10, fontWeight: "700" },
  dayPillMeta: { marginTop: 8, fontSize: 11, fontWeight: "500" },

  sessionRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sessionIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  restCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
  },

  progressTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  progressSectionWrap: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressPlanCol: {
    flex: 1,
  },
  progressKicker: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  progressPlanName: {
    marginTop: 3,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
  },
  progressPlanMeta: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "500",
  },
  progressPercentChip: {
    minWidth: 82,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  progressPercentValue: {
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  progressPercentLabel: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  progressMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  progressLabel: { fontSize: 12, fontWeight: "500" },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginTop: 9,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  progressStateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 28,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  progressStateText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  progressStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  progressStatCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  progressStatValue: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  progressStatLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "500",
  },
  progressHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
  },
  insightBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  insightKicker: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  insightHeadline: {
    marginTop: 5,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  insightBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
    maxWidth: "92%",
  },
  insightMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  insightMetaDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  insightMetaText: {
    fontSize: 11,
    fontWeight: "600",
  },
  insightActionsRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  insightTextLink: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 2,
  },
  insightTextLinkLabel: {
    fontSize: 13,
    fontWeight: "700",
  },

  actionRowBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  secondaryGhost: {
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  expandBtn: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  tipCardRow: {
    gap: 10,
    paddingRight: 10,
  },
  tipCard: {
    width: 180,
    height: 118,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  tipCardImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  tipCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  tipCardTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tipsSheet: {
    height: "70%",
  },
  tipsSheetDock: {
    width: "100%",
    height: "100%",
    justifyContent: "flex-end",
  },
  tipDetailCard: {
    height: 180,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginTop: 12,
  },
  tipDetailImage: {
    width: "100%",
    height: "100%",
  },
  tipArticleTitle: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  tipArticleSubtitle: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
  },
  tipAuthorRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tipAuthorAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  tipAuthorText: {
    fontSize: 13,
    fontWeight: "900",
  },
  tipAuthorMeta: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: "700",
  },
  tipBodyText: {
    marginTop: 14,
    fontSize: 17,
    lineHeight: 28,
    fontWeight: "700",
  },
  tipBulletRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  tipBulletText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "800",
  },
  tipCallout: {
    marginTop: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
  },
  tipCalloutTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  tipCalloutBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  sampleIntro: {
    marginTop: -2,
    marginBottom: 10,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
  },
  sampleTabRow: {
    gap: 8,
    paddingRight: 10,
  },
  sampleTab: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sampleFeaturedCard: {
    width: 300,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  sampleFeaturedTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sampleTypePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sampleTypeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  sampleRecoLabel: { fontSize: 11, fontWeight: "500" },
  sampleRecoTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sampleRecoTagText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sampleFeaturedTitle: {
    marginTop: 2,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  sampleFeaturedSummary: {
    marginTop: -2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
  },
  sampleMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sampleMetaChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  sampleMetaText: { fontSize: 11, fontWeight: "800" },
  sampleBestFor: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  samplePrimaryCta: {
    marginTop: 1,
    minHeight: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  samplePrimaryCtaText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  exploreAssistRow: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  exploreTipsBlock: {
    marginTop: 10,
  },
  quickCreateGrid: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  quickCreateCardShell: {
    width: "48.5%",
  },
  quickCreateCard: {
    minHeight: 112,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
    overflow: "hidden",
  },
  quickCreateCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  quickCreateIconPill: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  quickCreateCardKicker: {
    color: "rgba(255,255,255,0.84)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  quickCreateCardTitle: {
    marginTop: 16,
    color: "#FFFFFF",
    fontSize: 19,
    lineHeight: 22,
    fontWeight: "900",
    maxWidth: "88%",
  },
  quickCreateCardMeta: {
    marginTop: 6,
    color: "rgba(255,255,255,0.82)",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
    maxWidth: "88%",
  },
  quickCreateWatermark: {
    position: "absolute",
    right: 8,
    bottom: 8,
  },
  quickCreateCompactFooter: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  quickCreateCompactText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
  },
  quickCreateCompactBtn: {
    minHeight: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  quickCreateCompactBtnText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  sampleCtaHint: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  sampleAltWrap: {
    marginTop: 14,
  },
  sampleAltHead: {
    marginBottom: 8,
  },
  sampleAltTitle: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sampleAltSubtitle: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "700",
  },
  noPlanCarouselRow: {
    gap: 10,
    paddingRight: 8,
  },
  sampleAltCard: {
    width: 206,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    gap: 7,
  },
  sampleAltTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sampleAltTypeDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  sampleAltType: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sampleAltCardTitle: {
    fontSize: 14,
    fontWeight: "900",
  },
  sampleAltMeta: {
    fontSize: 12,
    fontWeight: "700",
  },
  sampleAltAction: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sampleAltActionText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  sampleBridgeText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  quickLogScroll: {
    marginTop: 10,
    maxHeight: 560,
  },
  quickLogContent: {
    paddingBottom: 4,
    gap: 10,
  },
  quickLogHero: {
    position: "relative",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 9,
    overflow: "hidden",
  },
  quickLogHeroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  quickLogHeroEyebrow: {
    flex: 1,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.74)",
  },
  quickLogHeroTypePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  quickLogHeroTypeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  quickLogHeroTitle: {
    marginTop: 4,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  quickLogHeroSummary: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: "rgba(255,255,255,0.84)",
  },
  quickLogHeroMetaRow: {
    marginTop: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickLogHeroMetaChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  quickLogHeroMetaText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  quickLogHeroBestForRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  quickLogHeroBestFor: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    color: "rgba(255,255,255,0.88)",
  },
  quickLogHeroEdge: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 0,
    height: 3,
    borderRadius: 999,
  },
  quickLogSectionTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  quickLogEditCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    gap: 9,
  },
  quickLogLabel: { fontSize: 12, fontWeight: "600" },
  quickLogInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 11,
    fontSize: 14,
    fontWeight: "600",
  },
  quickLogStatsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  quickLogStatBox: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  quickLogStatLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  quickLogStatInput: {
    marginTop: 6,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "700",
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  quickLogNotesInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 11,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    minHeight: 90,
    textAlignVertical: "top",
  },
  quickLogActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  quickLogPlainStack: {
    gap: 0,
    paddingHorizontal: 2,
  },
  quickLogPlainBrief: {
    marginTop: 2,
  },
  quickLogReadonlyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(127,127,127,0.35)",
  },
  quickLogReadonlyRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  quickLogReadonlyLabel: {
    fontSize: 12,
    fontWeight: "800",
  },
  quickLogReadonlyValue: {
    fontSize: 13,
    fontWeight: "900",
  },
  quickLogReadonlyCopy: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  quickLogHelper: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
    marginTop: -2,
  },

  coachLoadingWrap: {
    minHeight: 86,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  coachPlanRow: { gap: 10, paddingRight: 8 },
  coachPlanCard: {
    width: 300,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
  },
  coachPlanTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  coachTypePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  coachTypePillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  coachBrowseBtn: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  coachPlanName: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: "700",
  },
  coachPlanMeta: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "500",
  },
  coachPlanActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  coachActionBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    paddingBottom: 18,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSession: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetSessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sheetSessionStatusChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSessionStatusChipText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  sheetAction: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetActionText: {
    fontWeight: "700",
    fontSize: 13,
  },
  sheetGroupTitle: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: -2,
  },

  typePill: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  fieldLabel: { marginTop: 12, fontSize: 12, fontWeight: "900" },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "700",
  },
  textarea: { minHeight: 92, textAlignVertical: "top" },

  modalBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    flex: 1,
  },
});

```

### app/(protected)/nutrition/index.jsx

```jsx
"use client";

/**
 * NUTRITION PAGE — SAP GEL STYLE
 * Accent: Neon Yellow
 * Card: Clean silver, soft borders
 */

import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------------- config ---------------- */

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH - 36; // screen minus horizontal padding
const CARD_GAP = 12;
const CARD_SNAP_INTERVAL = CARD_WIDTH + CARD_GAP;

// same idea as chat page so content clears your footer
const FOOTER_OFFSET = 90;

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}
function addDays(d = new Date(), n = 0) {
  const x = new Date(d);
  x.setDate(x.getDate() + Number(n || 0));
  return x;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatClock(d) {
  try {
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function mealDateToJS(meal) {
  const raw = meal?.date;
  if (!raw) return null;
  if (typeof raw?.toDate === "function") return raw.toDate();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayProgressPct(selectedDate) {
  const now = new Date();
  const dayStart = startOfDay(selectedDate);
  const dayEnd = endOfDay(selectedDate);

  const t = isSameDay(dayStart, now) ? now : dayEnd;
  const total = dayEnd.getTime() - dayStart.getTime();
  const done = Math.max(
    0,
    Math.min(total, t.getTime() - dayStart.getTime())
  );
  return total ? done / total : 1;
}

function dayPartLabel(d) {
  const h = d.getHours();
  if (h < 10) return "Morning";
  if (h < 14) return "Late morning";
  if (h < 18) return "Afternoon";
  if (h < 22) return "Evening";
  return "Late";
}

function mealTypeIcon(mealType) {
  const t = String(mealType || "").toLowerCase();
  if (t.includes("breakfast")) return "sunrise";
  if (t.includes("lunch")) return "sun";
  if (t.includes("dinner")) return "moon";
  if (t.includes("snack")) return "coffee";
  return "circle";
}

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function coverageSummary(meals, cutoffDate) {
  const parts = {
    Morning: 0,
    "Late morning": 0,
    Afternoon: 0,
    Evening: 0,
    Late: 0,
  };
  let counted = 0;

  meals.forEach((m) => {
    const d = mealDateToJS(m);
    if (!d) return;
    if (d.getTime() > cutoffDate.getTime()) return;
    const p = dayPartLabel(d);
    parts[p] += 1;
    counted += 1;
  });

  const filled = Object.keys(parts).filter((k) => parts[k] > 0);
  return { parts, filled, counted };
}

/**
 * Fallback coach: "Training fuel match" WITH time-of-day awareness.
 * If selected day is today, we evaluate "so far today" instead of end-of-day.
 */
function fallbackTrainingMatch({ totals, goal, foodQuality, selectedDate }) {
  const goalCals = Number(goal?.dailyCalories || 0);
  const cals = Number(totals?.calories || 0);
  const protein = Number(totals?.protein || 0);
  const carbs = Number(totals?.carbs || 0);

  const now = new Date();
  const cutoff = isSameDay(startOfDay(selectedDate), now)
    ? now
    : endOfDay(selectedDate);
  const pctDay = dayProgressPct(selectedDate);

  // slightly front-loaded expectation curve
  const expectedPct = Math.min(1, Math.max(0.1, Math.pow(pctDay, 0.85)));
  const expectedCalsSoFar = goalCals ? Math.round(goalCals * expectedPct) : 0;

  if (!cals) {
    return {
      grade: "—",
      dayType: isSameDay(startOfDay(selectedDate), now)
        ? `So far (${formatClock(cutoff)})`
        : "That day",
      summary:
        "Log at least one meal to check how your fuel matches your training.",
      tips: [
        "Start with a balanced meal + fluids.",
        "Aim for protein in every meal.",
      ],
      timeMeta: goalCals
        ? `Expected by now: ~${expectedCalsSoFar} kcal`
        : "",
    };
  }

  const diffSoFar = goalCals
    ? (cals - expectedCalsSoFar) / Math.max(1, expectedCalsSoFar)
    : 0;
  const diffEnd = goalCals ? (cals - goalCals) / Math.max(1, goalCals) : 0;

  const useSoFar = isSameDay(startOfDay(selectedDate), now);
  const diffRatio = Math.abs(useSoFar ? diffSoFar : diffEnd);

  let grade = "B";
  if (diffRatio <= 0.12) grade = "A";
  else if (diffRatio <= 0.22) grade = "B";
  else if (diffRatio <= 0.38) grade = "C";
  else grade = "D";

  const isLowCarb = carbs < 2.5 * Math.max(1, protein); // loose heuristic
  const fq = String(foodQuality?.grade || "").toUpperCase();
  const fqPenalty = fq === "D" || fq === "F";

  let dayType = useSoFar ? `So far (${formatClock(cutoff)})` : "That day";
  if (useSoFar) {
    if (diffSoFar < -0.25)
      dayType = `Under-fuelling so far (${formatClock(cutoff)})`;
    if (diffSoFar > 0.25)
      dayType = `Over-fuelling so far (${formatClock(cutoff)})`;
  } else {
    if (diffEnd < -0.2) dayType = "Under-fuelled";
    if (diffEnd > 0.2) dayType = "Over-fuelled";
  }

  let summary =
    "Your nutrition is broadly aligned with your training needs.";
  if (grade === "A")
    summary = "Dialled in — your intake matches the day’s training demands nicely.";
  if (grade === "C")
    summary = "Some mismatch — tighten energy + carb timing around sessions.";
  if (grade === "D")
    summary = "Big mismatch — your intake is likely limiting training quality or recovery.";

  const kcalPct = goalCals ? Math.round((cals / goalCals) * 100) : 0;
  const expectedPctInt = goalCals ? Math.round(expectedPct * 100) : 0;

  const tips = [];
  if (useSoFar) {
    if (cals < expectedCalsSoFar * 0.85) {
      tips.push(
        `You’re behind for this time of day (${kcalPct}% vs ~${expectedPctInt}%). Add a carb + protein top-up.`
      );
    } else if (cals > expectedCalsSoFar * 1.15) {
      tips.push(
        `You’re ahead for this time of day (${kcalPct}% vs ~${expectedPctInt}%). Keep the rest of the day lighter but protein steady.`
      );
    } else {
      tips.push(
        `On pace for this time of day (${kcalPct}% vs ~${expectedPctInt}%).`
      );
    }
  } else {
    if (goalCals && cals < goalCals * 0.85)
      tips.push(
        "You finished the day under target — add 300–600 kcal on heavy training days."
      );
    if (goalCals && cals > goalCals * 1.15)
      tips.push(
        "You finished the day over target — trim low-satiety extras and keep protein stable."
      );
  }

  if (isLowCarb)
    tips.push(
      "If you trained today: increase carbs earlier + post-session for performance/recovery."
    );
  tips.push("Hit protein evenly across the day (25–40 g per meal).");
  if (fqPenalty)
    tips.push(
      "Improve food quality: swap one ultra-processed item for whole-food carbs + veg."
    );

  return {
    grade,
    dayType,
    summary,
    tips: tips.slice(0, 4),
    timeMeta: goalCals
      ? `So far: ${cals} kcal (${kcalPct}%) • Expected by now: ~${expectedCalsSoFar} kcal (~${expectedPctInt}%)`
      : "",
  };
}

export default function NutritionPage() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const user = auth.currentUser;

  /**
   * ✅ THEME-DRIVEN COLOURS (no hard-coded neon usage for text on white)
   * - accentBg: neon for fills (buttons/chips)
   * - accentText: readable “neon ink” in light mode for text/icons on white
   * - silverLight/silverMed: consistent SAP silvers from tokens where available
   */
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";
  const accentText =
    colors?.accentText ?? (isDark ? accentBg : "#7A8F00"); // readable on white
  const silverLight =
    colors?.sapSilverLight ?? (isDark ? "#111217" : "#F3F4F6");
  const silverMed = colors?.sapSilverMedium ?? "#E1E3E8";

  const [selectedDate, setSelectedDate] = useState(() => startOfDay());

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [todayMeals, setTodayMeals] = useState([]);
  const [weekStats, setWeekStats] = useState(null);
  const [quickMealType, setQuickMealType] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // chat-style quick log
  const [quickText, setQuickText] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);

  // nutrition goal
  const [nutritionGoal, setNutritionGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  // analysis
  const [analysis, setAnalysis] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // food quality (AI, per selected day)
  const [foodQuality, setFoodQuality] = useState(null);
  const [foodQualityLoading, setFoodQualityLoading] = useState(false);

  // ✅ training match (AI, per selected day)
  const [trainingMatch, setTrainingMatch] = useState(null);
  const [trainingMatchLoading, setTrainingMatchLoading] = useState(false);

  // carousels
  const [goalSlideIndex, setGoalSlideIndex] = useState(0);
  const [insightSlideIndex, setInsightSlideIndex] = useState(0);

  // 🔑 track keyboard like chat page
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ✅ scroll restore (remember where user was on the page)
  const scrollRef = useRef(null);
  const scrollYRef = useRef(0);
  const restoredScrollOnceRef = useRef(false);

  const s = useMemo(
    () =>
      makeStyles(
        colors,
        isDark,
        accentBg,
        accentText,
        silverLight,
        silverMed
      ),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );
  const topFadeStart = useMemo(() => {
    const alpha = isDark ? "33" : "55";
    const resolved = withHexAlpha(accentBg, alpha);
    if (resolved !== accentBg) return resolved;
    return isDark ? "rgba(230,255,59,0.2)" : "rgba(230,255,59,0.3)";
  }, [accentBg, isDark]);

  /* redirect when logged out */
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  /* keyboard listeners – same pattern as chat page */
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ✅ Restore selected day when coming back from Meal Detail (or deep links)
  useEffect(() => {
    const raw = params?.date;
    if (!raw) return;

    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return;

    setSelectedDate(startOfDay(d));
  }, [params?.date]);

  // ✅ Restore scroll position when coming back (only once per "return")
  useEffect(() => {
    const raw = params?.scrollY;
    const y = Number(raw ?? 0);

    // no scroll restore requested
    if (!y) {
      restoredScrollOnceRef.current = false;
      return;
    }

    // avoid repeatedly forcing scroll while user interacts
    if (restoredScrollOnceRef.current) return;

    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
      restoredScrollOnceRef.current = true;
    }, 60);

    return () => clearTimeout(t);
  }, [params?.scrollY]);

  /* fetch nutrition goal */
  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "users", user.uid, "nutrition", "profile");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setNutritionGoal(snap.exists() ? snap.data() : null);
        setGoalLoading(false);
      },
      () => setGoalLoading(false)
    );

    return () => unsub();
  }, [user]);

  /* fetch meals for selected day */
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const mealsRef = collection(db, "users", user.uid, "meals");
    const from = Timestamp.fromDate(startOfDay(selectedDate));
    const to = Timestamp.fromDate(endOfDay(selectedDate));

    const qMeals = query(
      mealsRef,
      where("date", ">=", from),
      where("date", "<=", to),
      orderBy("date", "desc")
    );

    const unsub = onSnapshot(qMeals, (snap) => {
      setTodayMeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsub();
  }, [user, selectedDate]);

  /* compute totals for selected day */
  const todayTotals = useMemo(() => {
    const base = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    return todayMeals.reduce(
      (acc, m) => ({
        calories: acc.calories + Number(m.calories || 0),
        protein: acc.protein + Number(m.protein || 0),
        carbs: acc.carbs + Number(m.carbs || 0),
        fat: acc.fat + Number(m.fat || 0),
      }),
      base
    );
  }, [todayMeals]);

  const goalCals = nutritionGoal?.dailyCalories || 0;

  const macroTargets = useMemo(
    () => ({
      protein: nutritionGoal ? Number(nutritionGoal.proteinTarget || 0) : 0,
      carbs: nutritionGoal ? Number(nutritionGoal.carbTarget || 0) : 0,
      fat: nutritionGoal ? Number(nutritionGoal.fatTarget || 0) : 0,
    }),
    [nutritionGoal]
  );

  const remaining = useMemo(() => {
    if (!nutritionGoal) return null;
    return {
      calories: Math.max(0, Math.round(goalCals - todayTotals.calories || 0)),
      protein: Math.max(
        0,
        Math.round(macroTargets.protein - todayTotals.protein || 0)
      ),
      carbs: Math.max(
        0,
        Math.round(macroTargets.carbs - todayTotals.carbs || 0)
      ),
      fat: Math.max(0, Math.round(macroTargets.fat - todayTotals.fat || 0)),
    };
  }, [nutritionGoal, goalCals, todayTotals, macroTargets]);

  const isTodaySelected = useMemo(() => {
    const todayStart = startOfDay();
    return startOfDay(selectedDate).getTime() === todayStart.getTime();
  }, [selectedDate]);

  const setSelectedDay = useCallback((value) => {
    restoredScrollOnceRef.current = false; // allow restore on next return
    const next = startOfDay(value instanceof Date ? value : new Date(value));
    const todayStart = startOfDay();
    setSelectedDate(next > todayStart ? todayStart : next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const daySliderItems = useMemo(() => {
    const todayStart = startOfDay();
    const selectedStart = startOfDay(selectedDate);
    const selectedDiff = Math.round(
      (todayStart.getTime() - selectedStart.getTime()) / (24 * 60 * 60 * 1000)
    );

    let end = todayStart;
    if (selectedDiff > 6) {
      end = addDays(selectedStart, 3);
      if (end > todayStart) end = todayStart;
    }
    const start = addDays(end, -6);

    return Array.from({ length: 7 }, (_, idx) => {
      const date = startOfDay(addDays(start, idx));
      return {
        key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
        date,
        isSelected: isSameDay(date, selectedStart),
        isToday: isSameDay(date, todayStart),
        dow: date.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
        day: String(date.getDate()),
      };
    });
  }, [selectedDate]);

  /* filtered meals (search by title / notes / type) */
  const filteredMeals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return todayMeals;

    return todayMeals.filter((m) => {
      const title = String(m.title || "").toLowerCase();
      const notes = String(m.notes || "").toLowerCase();
      const type = String(m.mealType || "").toLowerCase();
      return (
        title.includes(q) || notes.includes(q) || (type && type.includes(q))
      );
    });
  }, [todayMeals, searchQuery]);

  /* AI daily analysis – for selected day's totals */
  useEffect(() => {
    if (!nutritionGoal) return setAnalysis("");
    const hasAny =
      todayTotals.calories ||
      todayTotals.protein ||
      todayTotals.carbs ||
      todayTotals.fat;

    if (!hasAny) return setAnalysis("");
    if (!API_URL) return;

    let cancelled = false;
    const run = async () => {
      try {
        setAnalysisLoading(true);

        const res = await fetch(`${API_URL}/nutrition/analyse-day`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totals: todayTotals, goal: nutritionGoal }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (!cancelled) setAnalysis(data.analysis || "");
      } catch {
        if (!cancelled) setAnalysis("");
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    };

    run();
    return () => (cancelled = true);
  }, [nutritionGoal, todayTotals]);

  /* AI food quality for selected day */
  useEffect(() => {
    if (!nutritionGoal) {
      setFoodQuality(null);
      return;
    }

    if (!todayMeals.length) {
      setFoodQuality(null);
      return;
    }

    if (!API_URL) return;

    let cancelled = false;

    const run = async () => {
      try {
        setFoodQualityLoading(true);

        const res = await fetch(`${API_URL}/nutrition/food-quality`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: nutritionGoal,
            totals: todayTotals,
            meals: todayMeals,
          }),
        });

        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (!cancelled) {
          setFoodQuality(data);
        }
      } catch {
        if (!cancelled) setFoodQuality(null);
      } finally {
        if (!cancelled) setFoodQualityLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [nutritionGoal, todayTotals, todayMeals]);

  /* ✅ AI training match for selected day — time-of-day aware */
  useEffect(() => {
    if (!nutritionGoal) {
      setTrainingMatch(null);
      return;
    }
    if (!todayMeals.length) {
      setTrainingMatch(null);
      return;
    }

    const now = new Date();
    const cutoff = isSameDay(startOfDay(selectedDate), now) ? now : endOfDay(selectedDate);
    const pctDay = dayProgressPct(selectedDate);
    const coverage = coverageSummary(todayMeals, cutoff);

    let cancelled = false;

    const run = async () => {
      try {
        if (!API_URL) {
          const fb = fallbackTrainingMatch({
            totals: todayTotals,
            goal: nutritionGoal,
            foodQuality,
            selectedDate,
          });
          if (!cancelled) {
            setTrainingMatch({
              ...fb,
              cutoffLabel: isSameDay(startOfDay(selectedDate), now)
                ? `So far (${formatClock(cutoff)})`
                : "Full day",
              dayPct: pctDay,
              coverage,
            });
          }
          return;
        }

        setTrainingMatchLoading(true);

        const res = await fetch(`${API_URL}/nutrition/training-match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: selectedDate.toISOString(),
            nowISO: cutoff.toISOString(),
            dayProgressPct: pctDay,
            goal: nutritionGoal,
            totals: todayTotals,
            meals: todayMeals,
            mealTiming: {
              cutoffISO: cutoff.toISOString(),
              coverageParts: coverage.parts,
              filledParts: coverage.filled,
              mealsLoggedSoFar: coverage.counted,
            },
            foodQuality,
          }),
        });

        if (!res.ok) throw new Error("fallback");

        const data = await res.json();

        if (!cancelled) {
          setTrainingMatch({
            grade: data.grade ?? data.fuelGrade ?? "—",
            dayType:
              data.dayType ??
              (isSameDay(startOfDay(selectedDate), now)
                ? `So far (${formatClock(cutoff)})`
                : "That day"),
            summary: data.summary ?? "",
            tips: Array.isArray(data.tips) ? data.tips : [],
            timeMeta: data.timeMeta ?? "",
            cutoffLabel: isSameDay(startOfDay(selectedDate), now)
              ? `So far (${formatClock(cutoff)})`
              : "Full day",
            dayPct: pctDay,
            coverage,
          });
        }
      } catch {
        if (!cancelled) {
          const fb = fallbackTrainingMatch({
            totals: todayTotals,
            goal: nutritionGoal,
            foodQuality,
            selectedDate,
          });
          setTrainingMatch({
            ...fb,
            cutoffLabel: isSameDay(startOfDay(selectedDate), new Date())
              ? `So far (${formatClock(new Date())})`
              : "Full day",
            dayPct: pctDay,
            coverage,
          });
        }
      } finally {
        if (!cancelled) setTrainingMatchLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [nutritionGoal, todayTotals, todayMeals, selectedDate, foodQuality]);

  /* load 7-day stats for summary chip & nutrition score */
  const loadWeek = useCallback(async () => {
    if (!user) return;

    const since = startOfDay(daysAgo(6));
    const mealsRef = collection(db, "users", user.uid, "meals");
    const qMeals = query(
      mealsRef,
      where("date", ">=", Timestamp.fromDate(since)),
      orderBy("date", "desc")
    );

    const snap = await getDocs(qMeals);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const byDay = {};
    rows.forEach((m) => {
      const d = m.date?.toDate?.() || new Date(m.date);
      const key = d.toISOString().slice(0, 10);
      if (!byDay[key]) {
        byDay[key] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
      }
      byDay[key].calories += Number(m.calories || 0);
      byDay[key].protein += Number(m.protein || 0);
      byDay[key].carbs += Number(m.carbs || 0);
      byDay[key].fat += Number(m.fat || 0);
      byDay[key].meals += 1;
    });

    const days = Object.keys(byDay).sort();
    const total = days.reduce(
      (acc, k) => ({
        calories: acc.calories + byDay[k].calories,
        protein: acc.protein + byDay[k].protein,
        carbs: acc.carbs + byDay[k].carbs,
        fat: acc.fat + byDay[k].fat,
        days: acc.days + 1,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
    );

    const avg =
      total.days > 0
        ? {
            calories: Math.round(total.calories / total.days),
            protein: Math.round(total.protein / total.days),
            carbs: Math.round(total.carbs / total.days),
            fat: Math.round(total.fat / total.days),
          }
        : { calories: 0, protein: 0, carbs: 0, fat: 0 };

    setWeekStats({ byDay, days, avg, totalDays: total.days });
  }, [user]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const nutritionScore = useMemo(() => {
    if (!weekStats || !goalCals) return null;
    const diffRatio = Math.abs(weekStats.avg.calories - goalCals) / goalCals;
    let grade = "C";
    let desc = "Big swings vs your calorie target.";
    if (diffRatio <= 0.08) {
      grade = "A";
      desc = "Dialled in — very close to your target on average.";
    } else if (diffRatio <= 0.15) {
      grade = "B";
      desc = "Pretty close to your target, with some day-to-day variation.";
    }
    return { grade, desc, diffPercent: Math.round(diffRatio * 100) };
  }, [weekStats, goalCals]);

  // ---- nutrition score for selected day ----
  const todayScore = useMemo(() => {
    if (!nutritionGoal || !goalCals) return null;
    if (!todayTotals.calories) return null;

    const diffRatio = Math.abs(todayTotals.calories - goalCals) / goalCals;

    let grade = "C";
    if (diffRatio <= 0.08) grade = "A";
    else if (diffRatio <= 0.15) grade = "B";
    else if (diffRatio > 0.3) grade = "D";

    let summary = "";
    if (diffRatio <= 0.08) summary = "You’re right on track with calories for this day.";
    else if (diffRatio <= 0.15) summary = "You’re close to the calorie target for this day.";
    else if (todayTotals.calories < goalCals) summary = "You’re well under the calorie target for this day.";
    else summary = "You’ve gone over the calorie target for this day.";

    return { grade, summary };
  }, [nutritionGoal, goalCals, todayTotals.calories]);

  /* barcode scan — placeholder route for now */
  const handleScanBarcode = useCallback(() => {
    router.push("/nutrition/barcode");
  }, [router]);

  /* meal scan */
  const handleScanMeal = useCallback(async () => {
    if (scanning) return;
    if (!API_URL)
      return Alert.alert("Config error", "EXPO_PUBLIC_API_URL missing in .env");

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted")
      return Alert.alert("Camera required", "Please enable camera access.");

    try {
      setScanning(true);

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const res = await fetch(`${API_URL}/nutrition/estimate-macros`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: result.assets[0].base64 }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const {
        title = "Meal",
        calories = 0,
        protein = 0,
        carbs = 0,
        fat = 0,
        notes = "",
      } = data;

      Alert.alert(title, `${Math.round(calories)} kcal`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: () => {
            router.push({
              pathname: "/nutrition/add",
              params: {
                title,
                calories: String(Math.round(calories)),
                protein: String(Math.round(protein)),
                carbs: String(Math.round(carbs)),
                fat: String(Math.round(fat)),
                notes,
                fromScan: "1",
                date: selectedDate.toISOString(),
              },
            });
          },
        },
      ]);
    } catch (err) {
      Alert.alert("Scan failed", err?.message || "Could not scan meal.");
    } finally {
      setScanning(false);
    }
  }, [scanning, router, selectedDate]);

  /* quick log -> save meal on selected day */
  const handleQuickLog = useCallback(async () => {
    if (quickLoading || !quickText.trim()) return;
    if (!API_URL) return Alert.alert("Error", "API URL missing from env.");
    if (!user) return Alert.alert("Error", "Please sign in again.");

    try {
      setQuickLoading(true);

      const res = await fetch(`${API_URL}/nutrition/describe-meal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: quickText.trim() }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const {
        title = quickText,
        calories = 0,
        protein = 0,
        carbs = 0,
        fat = 0,
        fibre,
        fiber,
        sugar,
        sodium,
        notes = "",
      } = data;

      const finalTitle = quickMealType ? `${quickMealType}: ${title}` : title;

      const base = startOfDay(selectedDate);
      const now = new Date();
      base.setHours(
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
      );
      const dateTs = Timestamp.fromDate(base);

      await addDoc(collection(db, "users", user.uid, "meals"), {
        title: finalTitle,
        mealType: quickMealType || "Unspecified",
        calories: Number(calories) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
        fibre: Number(fibre ?? fiber ?? 0) || 0,
        sugar: Number(sugar || 0) || 0,
        sodium: Number(sodium || 0) || 0,
        notes:
          notes ||
          `Quick log: ${quickText}${quickMealType ? ` (${quickMealType})` : ""}`,
        source: "chat",
        date: dateTs,
        createdAt: serverTimestamp(),
      });

      setQuickText("");
    } catch (err) {
      Alert.alert("Could not log meal", err?.message || "Please try again.");
    } finally {
      setQuickLoading(false);
    }
  }, [quickText, quickLoading, user, quickMealType, selectedDate]);

  /* row renderer */
  const renderMealRow = (item) => {
    const icon = mealTypeIcon(item?.mealType);

    return (
      <TouchableOpacity
        key={item.id}
        style={s.mealRow}
        onPress={() =>
          router.push({
            pathname: `/nutrition/${item.id}`,
            params: {
              fromDate: selectedDate.toISOString(),
              scrollY: String(scrollYRef.current || 0),
            },
          })
        }
        activeOpacity={0.7}
      >
        <View style={s.mealTypeIconWrap}>
          <Feather name={icon} size={14} color={accentText} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={s.mealTitle}>
            {item.mealType ? `${item.mealType} · ${item.title}` : item.title}
          </Text>

          <Text style={s.mealMacros} numberOfLines={1}>
            P {Math.round(item.protein || 0)} g · C {Math.round(item.carbs || 0)} g
            · F {Math.round(item.fat || 0)} g
          </Text>

          {item.notes ? (
            <Text style={s.mealNotes} numberOfLines={1}>
              {item.notes}
            </Text>
          ) : null}
        </View>

        <View style={s.mealRightCol}>
          <Text style={s.mealKcal}>{Math.round(item.calories)} kcal</Text>
          <Feather name="chevron-right" size={16} color={colors.subtext} />
        </View>
      </TouchableOpacity>
    );
  };

  /* ---------------------------------------- */

  return (
    <View style={[s.safe, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[topFadeStart, colors.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.topBackgroundFade}
        pointerEvents="none"
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={s.page}>
          {/* HEADER + DAY NAV */}
          <View style={s.header}>
            {/* ✅ Title row with top-right share */}
            <View style={s.headerTopRow}>
              <Text style={s.headerTitle}>Nutrition</Text>

              <TouchableOpacity
                onPress={() => router.push("/nutrition/nutrition-list")}
                style={s.iconButtonGhost}
                activeOpacity={0.8}
              >
                <Feather name="share-2" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.headerTagline}>
              Daily fuel, macros, and coaching in one place.
            </Text>

            {/* Day selector (copied from Train layout pattern) */}
            <View style={s.dayNavCard}>
              {daySliderItems.map((item) => {
                const dayKey = item.date.toISOString().slice(0, 10);
                const hasMeals = Number(weekStats?.byDay?.[dayKey]?.meals || 0) > 0;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setSelectedDay(item.date)}
                    activeOpacity={0.85}
                    style={s.daySliderChip}
                  >
                    <Text
                      style={[
                        s.daySliderDow,
                        {
                          color: item.isSelected || item.isToday ? colors.text : colors.subtext,
                          opacity: !item.isSelected && !item.isToday && !hasMeals ? 0.7 : 1,
                        },
                      ]}
                    >
                      {item.dow}
                    </Text>

                    <View
                      style={[
                        s.daySliderDateWrap,
                        item.isSelected
                          ? { backgroundColor: accentBg, borderColor: accentBg }
                          : {
                              backgroundColor: hasMeals ? (colors.card || "#FFFFFF") : "transparent",
                              borderColor: hasMeals || item.isToday ? silverMed : "transparent",
                            },
                      ]}
                    >
                      <Text
                        style={[
                          s.daySliderDate,
                          {
                            color: item.isSelected
                              ? "#111111"
                              : !hasMeals
                                ? colors.subtext
                                : colors.text,
                          },
                        ]}
                      >
                        {item.day}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.headerMetaRow}>
              <View
                style={[
                  s.headerMetaPill,
                  nutritionGoal ? s.headerMetaPillGood : s.headerMetaPillWarn,
                ]}
              >
                <Feather
                  name={nutritionGoal ? "check-circle" : "alert-circle"}
                  size={13}
                  color={nutritionGoal ? "#0f5132" : "#7f1d1d"}
                />
                <Text style={s.headerMetaPillText}>
                  {nutritionGoal ? "Goal configured" : "Goal required"}
                </Text>
              </View>

              <View style={s.headerMetaPill}>
                <Feather name="list" size={13} color={colors.subtext} />
                <Text style={s.headerMetaPillText}>
                  {todayMeals.length} meal{todayMeals.length === 1 ? "" : "s"}{" "}
                  {isTodaySelected ? "today" : "logged"}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              s.scrollContent,
              keyboardVisible && { paddingBottom: FOOTER_OFFSET },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            onScroll={(e) => {
              scrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
          >
            {/* NUTRITION GOAL + SLIDER */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>Daily goal</Text>
                <TouchableOpacity
                  onPress={() => router.push("/nutrition/goal")}
                  style={s.sectionEdit}
                >
                  <Feather
                    name={nutritionGoal ? "edit-2" : "plus-circle"}
                    size={14}
                    color={accentText}
                  />
                  <Text style={s.sectionEditText}>
                    {nutritionGoal ? "Edit" : "Set"}
                  </Text>
                </TouchableOpacity>
              </View>

              {goalLoading ? (
                <ActivityIndicator />
              ) : !nutritionGoal ? (
                <Text style={s.emptySmall}>
                  No goal set yet — tap set to create one.
                </Text>
              ) : (
                <View style={s.goalCarouselContainer}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={CARD_SNAP_INTERVAL}
                    snapToAlignment="start"
                    disableIntervalMomentum
                    decelerationRate="fast"
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      const x = e.nativeEvent.contentOffset.x;
                      const idx = Math.max(
                        0,
                        Math.min(2, Math.round(x / CARD_SNAP_INTERVAL))
                      );
                      setGoalSlideIndex(idx);
                    }}
                  >
                    {/* Slide 0 — calories vs goal */}
                    <View style={[s.goalSlideCard, { width: CARD_WIDTH }]}>
                      <Text style={s.goalSlideTitle}>Calories</Text>
                      <Text style={s.goalSlideNumber}>
                        {Math.round(todayTotals.calories)} /{" "}
                        {Math.round(goalCals)}{" "}
                        <Text style={s.goalSlideNumberUnit}>kcal</Text>
                      </Text>
                      <Text style={s.goalSlideSub}>
                        Left: {remaining ? `${remaining.calories} kcal` : "-"}
                      </Text>

                      {todayScore && (
                        <View style={s.todayScoreRow}>
                          <View style={s.todayScoreBadge}>
                            <Text style={s.todayScoreBadgeText}>
                              {todayScore.grade}
                            </Text>
                          </View>
                          <Text style={s.todayScoreText}>
                            {todayScore.summary}
                          </Text>
                        </View>
                      )}

                      <TouchableOpacity
                        onPress={() => router.push("/nutrition/today")}
                        activeOpacity={0.8}
                        style={s.goalSlideLink}
                      >
                        <Text style={s.goalSlideLinkText}>
                          View detailed breakdown
                        </Text>
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={accentText}
                        />
                      </TouchableOpacity>
                    </View>

                    {/* Slide 1 — macros */}
                    <View style={[s.goalSlideCard, { width: CARD_WIDTH }]}>
                      <Text style={s.goalSlideTitle}>Macros</Text>

                      <View style={s.goalMacroRow}>
                        <MacroLine
                          label="Protein"
                          eaten={todayTotals.protein}
                          target={macroTargets.protein}
                          unit="g"
                          colors={colors}
                          isDark={isDark}
                          accentBg={accentBg}
                        />
                        <MacroLine
                          label="Carbs"
                          eaten={todayTotals.carbs}
                          target={macroTargets.carbs}
                          unit="g"
                          colors={colors}
                          isDark={isDark}
                          accentBg={accentBg}
                        />
                        <MacroLine
                          label="Fat"
                          eaten={todayTotals.fat}
                          target={macroTargets.fat}
                          unit="g"
                          colors={colors}
                          isDark={isDark}
                          accentBg={accentBg}
                        />
                      </View>

                      {remaining && (
                        <Text style={s.goalSlideSub}>
                          Left — P {remaining.protein} g · C {remaining.carbs} g
                          · F {remaining.fat} g
                        </Text>
                      )}
                    </View>

                    {/* Slide 2 — food quality (AI) */}
                    <View style={[s.goalSlideCard, { width: CARD_WIDTH }]}>
                      <Text style={s.goalSlideTitle}>Food quality</Text>

                      {foodQualityLoading ? (
                        <ActivityIndicator />
                      ) : !todayMeals.length ? (
                        <Text style={s.goalSlideSub}>
                          Log at least one meal to see food quality for this day.
                        </Text>
                      ) : foodQuality ? (
                        <>
                          <View style={s.todayScoreRow}>
                            <View style={s.todayScoreBadge}>
                              <Text style={s.todayScoreBadgeText}>
                                {foodQuality.grade}
                              </Text>
                            </View>
                            <Text style={s.foodQualitySummary}>
                              {foodQuality.summary}
                            </Text>
                          </View>

                          {foodQuality.detail ? (
                            <Text style={s.foodQualityDetail}>
                              {foodQuality.detail}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={s.goalSlideSub}>
                          Couldn’t load food quality. It’ll refresh next time you
                          open this screen.
                        </Text>
                      )}

                      <TouchableOpacity
                        onPress={() =>
                          router.push({
                            pathname: "/nutrition/food-quality",
                            params: { date: selectedDate.toISOString() },
                          })
                        }
                        activeOpacity={0.8}
                        style={s.goalSlideLink}
                      >
                        <Text style={s.goalSlideLinkText}>
                          View detailed breakdown
                        </Text>
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={accentText}
                        />
                      </TouchableOpacity>
                    </View>
                  </ScrollView>

                  {/* dots */}
                  <View style={s.dotRow}>
                    {[0, 1, 2].map((idx) => (
                      <View
                        key={idx}
                        style={[s.dot, goalSlideIndex === idx && s.dotActive]}
                      />
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* EMPTY-STATE CTA WHEN NO GOAL */}
            {!goalLoading && !nutritionGoal && (
              <View style={s.goalEmptyWrapper}>
                <Text style={s.goalEmptyTitle}>
                  Set your goal to unlock nutrition tracking
                </Text>
                <Text style={s.goalEmptyText}>
                  Create a daily calorie and macro target, then log meals and
                  get AI feedback tailored to your plan.
                </Text>

                <TouchableOpacity
                  style={s.goalEmptyButton}
                  onPress={() => router.push("/nutrition/goal")}
                  activeOpacity={0.9}
                >
                  <Text style={s.goalEmptyButtonText}>
                    Set goal & nutrition plan
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* MAIN CONTENT — ONLY WHEN GOAL IS SET */}
            {nutritionGoal && (
              <>
                {/* ACTION BUTTONS */}
                <View style={s.actionRow}>
                  {/* + Add meal */}
                  <TouchableOpacity
                    style={s.actionPrimary}
                    onPress={() =>
                      router.push({
                        pathname: "/nutrition/add",
                        params: { date: selectedDate.toISOString() },
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Feather name="plus" size={18} color="#111111" />
                    <Text style={s.actionPrimaryText}>Add meal</Text>
                  </TouchableOpacity>

                  {/* Scan barcode */}
                  <TouchableOpacity
                    onPress={handleScanBarcode}
                    style={s.actionScan}
                    activeOpacity={0.8}
                  >
                    <Feather name="maximize" size={18} color={accentText} />
                  </TouchableOpacity>

                  {/* Photo scan */}
                  <TouchableOpacity
                    onPress={handleScanMeal}
                    style={s.actionScan}
                    activeOpacity={0.8}
                    disabled={scanning}
                  >
                    {scanning ? (
                      <ActivityIndicator color={accentText} />
                    ) : (
                      <Feather name="camera" size={18} color={accentText} />
                    )}
                  </TouchableOpacity>
                </View>

                {/* INSIGHTS SLIDER */}
                <View style={s.section}>
                  <View style={s.sectionHeader}>
                    <Text style={s.sectionTitle}>Insights</Text>
                  </View>

                  <View style={s.insightsCarouselContainer}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      snapToInterval={CARD_SNAP_INTERVAL}
                      snapToAlignment="start"
                      disableIntervalMomentum
                      decelerationRate="fast"
                      scrollEventThrottle={16}
                      onScroll={(e) => {
                        const x = e.nativeEvent.contentOffset.x;
                        const idx = Math.max(
                          0,
                          Math.min(2, Math.round(x / CARD_SNAP_INTERVAL))
                        );
                        setInsightSlideIndex(idx);
                      }}
                    >
                      {/* Slide 0 — Weight card */}
                      <View style={[s.insightCard, { width: CARD_WIDTH }]}>
                        <Text style={s.insightTitle}>Weight trend</Text>
                        <Text style={s.insightSubtitle}>
                          Log your weight to see a graph of your long-term
                          progress. Open the weight screen to add entries.
                        </Text>

                        <TouchableOpacity
                          style={s.insightButton}
                          activeOpacity={0.85}
                          onPress={() => router.push("/nutrition/weight")}
                        >
                          <Text style={s.insightButtonText}>
                            Open weight tracking
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Slide 1 — Nutrition score */}
                      <View style={[s.insightCard, { width: CARD_WIDTH }]}>
                        <Text style={s.insightTitle}>Nutrition score</Text>

                        {nutritionScore ? (
                          <View style={s.scoreRow}>
                            <View style={s.scoreBadgeWrap}>
                              <Text style={s.scoreBadgeText}>
                                {nutritionScore.grade}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.insightSubtitle}>
                                {nutritionScore.desc}
                              </Text>
                              <Text style={s.insightMeta}>
                                Avg kcal is about {nutritionScore.diffPercent}%
                                away from your target.
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={s.insightSubtitle}>
                            Log a few more days of meals to see a simple nutrition
                            score here.
                          </Text>
                        )}

                        <View style={s.insightLinksRow}>
                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() => router.push("/nutrition/streaks")}
                          >
                            <Text style={s.insightPillText}>View streaks</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() => router.push("/nutrition/week")}
                          >
                            <Text style={s.insightPillText}>View trends</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* ✅ Slide 2 — Training fuel match (time-of-day aware) */}
                      <View style={[s.insightCard, { width: CARD_WIDTH }]}>
                        <Text style={s.insightTitle}>Training fuel match</Text>

                        {trainingMatchLoading ? (
                          <ActivityIndicator />
                        ) : !todayMeals.length ? (
                          <Text style={s.insightSubtitle}>
                            Log at least one meal to check whether your fuel
                            matches your training day.
                          </Text>
                        ) : trainingMatch ? (
                          <>
                            <View style={s.scoreRow}>
                              <View style={s.scoreBadgeWrap}>
                                <Text style={s.scoreBadgeText}>
                                  {String(trainingMatch.grade || "—")}
                                </Text>
                              </View>

                              <View style={{ flex: 1 }}>
                                <View style={s.trainingTagRow}>
                                  <View style={s.trainingTag}>
                                    <Text style={s.trainingTagText}>
                                      {String(trainingMatch.dayType || "So far")}
                                    </Text>
                                  </View>

                                  {foodQuality?.grade ? (
                                    <View style={s.trainingTagSoft}>
                                      <Text style={s.trainingTagSoftText}>
                                        Quality: {String(foodQuality.grade)}
                                      </Text>
                                    </View>
                                  ) : null}

                                  {trainingMatch?.coverage?.filled?.length ? (
                                    <View style={s.trainingTagSoft}>
                                      <Text style={s.trainingTagSoftText}>
                                        Logged:{" "}
                                        {trainingMatch.coverage.filled.join(
                                          " · "
                                        )}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>

                                <Text style={s.insightSubtitle}>
                                  {trainingMatch.summary || "—"}
                                </Text>

                                {!!trainingMatch.timeMeta && (
                                  <Text style={s.insightMeta}>
                                    {trainingMatch.timeMeta}
                                  </Text>
                                )}
                              </View>
                            </View>

                            {Array.isArray(trainingMatch.tips) &&
                            trainingMatch.tips.length ? (
                              <View style={{ marginTop: 8 }}>
                                {trainingMatch.tips.slice(0, 4).map((t, i) => (
                                  <View
                                    key={`${i}-${t}`}
                                    style={s.bulletRow}
                                  >
                                    <View style={s.bulletDot} />
                                    <Text style={s.bulletText}>{t}</Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </>
                        ) : (
                          <Text style={s.insightSubtitle}>
                            Couldn’t load this insight. It’ll refresh next time
                            you open this screen.
                          </Text>
                        )}

                        <View style={s.insightLinksRow}>
                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() =>
                              router.push({
                                pathname: "/nutrition/food-quality",
                                params: { date: selectedDate.toISOString() },
                              })
                            }
                          >
                            <Text style={s.insightPillText}>Improve quality</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={s.insightPill}
                            onPress={() => router.push("/nutrition/today")}
                          >
                            <Text style={s.insightPillText}>See breakdown</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </ScrollView>

                    <View style={s.dotRow}>
                      {[0, 1, 2].map((idx) => (
                        <View
                          key={idx}
                          style={[
                            s.dot,
                            insightSlideIndex === idx && s.dotActive,
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                </View>

                {/* QUICK LOG */}
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Quick Log</Text>

                  <View style={s.quickLogCard}>
                    <View style={s.segmentRow}>
                      {["Breakfast", "Lunch", "Dinner", "Snack"].map((mt) => {
                        const active = quickMealType === mt;
                        return (
                          <TouchableOpacity
                            key={mt}
                            onPress={() => setQuickMealType(active ? "" : mt)}
                            style={[s.segment, active && s.segmentActive]}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                s.segmentText,
                                active && s.segmentTextActive,
                              ]}
                            >
                              {mt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <View style={s.quickBox}>
                      <TextInput
                        placeholder="Type what you had…"
                        placeholderTextColor={colors.subtext}
                        value={quickText}
                        onChangeText={setQuickText}
                        style={s.quickInput}
                        multiline
                        keyboardAppearance={isDark ? "dark" : "light"}
                        blurOnSubmit={false}
                      />

                      <TouchableOpacity
                        style={s.quickSend}
                        onPress={handleQuickLog}
                        disabled={!quickText.trim() || quickLoading}
                      >
                        {quickLoading ? (
                          <ActivityIndicator color="#111111" />
                        ) : (
                          <Feather name="arrow-up" size={16} color="#111111" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* TODAY / SELECTED DAY */}
                <View style={s.section}>
                  <View style={s.sectionHeader}>
                    <Text style={s.sectionTitle}>Intake for the day</Text>
                  </View>

                  <View style={s.intakeCard}>
                    <View style={s.macroRow}>
                      <Chip
                        label="Calories"
                        value={`${todayTotals.calories} kcal`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                      <Chip
                        label="Protein"
                        value={`${todayTotals.protein} g`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                      <Chip
                        label="Carbs"
                        value={`${todayTotals.carbs} g`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                      <Chip
                        label="Fat"
                        value={`${todayTotals.fat} g`}
                        colors={colors}
                        silverLight={silverLight}
                        silverMed={silverMed}
                      />
                    </View>

                    {analysisLoading ? (
                      <ActivityIndicator style={{ marginTop: 10 }} />
                    ) : !!analysis ? (
                      <View style={s.coachNote}>
                        <Text style={s.coachTitle}>Coach note</Text>
                        <Text style={s.coachText}>{analysis}</Text>
                      </View>
                    ) : null}

                    <View style={s.searchBox}>
                      <Feather name="search" size={16} color={colors.subtext} />
                      <TextInput
                        style={s.searchInput}
                        placeholder="Search this day’s meals…"
                        placeholderTextColor={colors.subtext}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        returnKeyType="search"
                        keyboardAppearance={isDark ? "dark" : "light"}
                      />
                      {searchQuery ? (
                        <TouchableOpacity
                          onPress={() => setSearchQuery("")}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Feather
                            name="x-circle"
                            size={16}
                            color={colors.subtext}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {loading ? (
                      <ActivityIndicator />
                    ) : filteredMeals.length === 0 ? (
                      <Text style={s.empty}>
                        {searchQuery
                          ? "No meals match your search."
                          : "No meals logged for this day."}
                      </Text>
                    ) : (
                      filteredMeals.map((m) => (
                        <View key={m.id} style={s.sectionRowWrapper}>
                          {renderMealRow(m)}
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ---------------- small UI bits ---------------- */

function Mini({ label, value, colors }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontWeight: "700", color: colors.text }}>
        {String(value)}
      </Text>
      <Text style={{ fontSize: 12, color: colors.subtext }}>{label}</Text>
    </View>
  );
}

function Chip({ label, value, colors, silverLight, silverMed }) {
  const labelColor = colors?.subtextSoft || colors?.subtext || colors?.text || "#9CA3AF";
  const valueColor = colors?.text || "#E5E7EB";

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        backgroundColor: silverLight,
        paddingHorizontal: 6,
        paddingVertical: 7,
        borderRadius: 12,
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: silverMed,
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={{
          color: labelColor,
          fontSize: 10,
          fontWeight: "800",
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={{ color: valueColor, fontWeight: "700", fontSize: 11 }}
      >
        {value}
      </Text>
    </View>
  );
}

function MacroLine({ label, eaten, target, unit, colors, isDark, accentBg }) {
  const safeTarget = target || 0;
  const pct = safeTarget ? Math.min(1, eaten / safeTarget) : 0;

  return (
    <View style={{ marginBottom: 8 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: 2,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: colors.subtext }}>
          {Math.round(eaten)} / {Math.round(safeTarget)} {unit}
        </Text>
      </View>

      <View
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: isDark
            ? colors.border
            : colors.borderStrong ?? "#D1D5DB",
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        <View
          style={{
            width: `${Math.round(pct * 100)}%`,
            backgroundColor: accentBg,
          }}
        />
      </View>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? "#12141A" : "#F6F7FA";
  const panelBg = isDark ? "#0B0E14" : "#FFFFFF";
  const borderSoft = isDark ? "rgba(255,255,255,0.11)" : silverMed;
  const borderHard = isDark ? "rgba(255,255,255,0.16)" : "#D5D9E1";

  const shadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.26,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
      };

  const softShadow = isDark
    ? {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 5 },
        elevation: 2,
      }
    : {
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    topBackgroundFade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 280,
    },
    page: { flex: 1, paddingHorizontal: 18 },
    scrollContent: { paddingBottom: FOOTER_OFFSET + 70, flexGrow: 1 },

    /* HEADER */
    header: { marginTop: 6, marginBottom: 10 },

    /* ✅ title row w/ share on the right */
    headerTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 4,
    },

    headerTitle: {
      fontSize: 31,
      fontWeight: "800",
      letterSpacing: 0.2,
      color: colors.text,
      flex: 1,
    },

    headerTagline: {
      marginTop: 2,
      marginBottom: 12,
      color: colors.subtext,
      fontSize: 13,
      fontWeight: "600",
      lineHeight: 18,
    },

    /* ✅ ghost icon button for header */
    iconButtonGhost: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },

    dayNavCard: {
      marginTop: 12,
      marginBottom: 2,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 2,
    },
    daySliderChip: {
      flex: 1,
      alignItems: "center",
      gap: 7,
      minWidth: 44,
    },
    daySliderDow: {
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.6,
    },
    daySliderDateWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: "center",
      justifyContent: "center",
    },
    daySliderDate: {
      fontSize: 18,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    headerMetaRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    headerMetaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    headerMetaPillGood: {
      backgroundColor: isDark ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.12)",
      borderColor: isDark ? "rgba(34,197,94,0.38)" : "rgba(34,197,94,0.35)",
    },
    headerMetaPillWarn: {
      backgroundColor: isDark ? "rgba(248,113,113,0.18)" : "rgba(248,113,113,0.12)",
      borderColor: isDark ? "rgba(248,113,113,0.40)" : "rgba(248,113,113,0.36)",
    },
    headerMetaPillText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.2,
    },

    /* ACTION BUTTONS */
    actionRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
    actionPrimary: {
      backgroundColor: accentBg,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
      ...shadow,
    },
    actionPrimaryText: {
      color: "#111111",
      fontWeight: "800",
      fontSize: 13,
      letterSpacing: 0.2,
    },
    actionScan: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: panelBg,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...softShadow,
    },

    /* SECTIONS */
    section: { marginBottom: 22 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10, alignItems: "center" },
    sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text, letterSpacing: 0.2 },
    sectionEdit: { flexDirection: "row", alignItems: "center", gap: 6 },
    sectionEditText: { fontSize: 12, color: accentText, fontWeight: "800", letterSpacing: 0.2 },

    /* DAILY GOAL CAROUSEL */
    goalCarouselContainer: { marginTop: 6 },
    goalSlideCard: {
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginRight: CARD_GAP,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    goalSlideTitle: { fontSize: 11, fontWeight: "800", color: colors.subtext, textTransform: "uppercase", letterSpacing: 1.0, marginBottom: 6 },
    goalSlideNumber: { fontSize: 26, fontWeight: "900", color: colors.text, marginBottom: 6 },
    goalSlideNumberUnit: { fontSize: 14, fontWeight: "700", color: colors.subtext },
    goalSlideSub: { fontSize: 13, color: colors.subtext, marginTop: 2, marginBottom: 8, lineHeight: 18 },
    goalSlideLink: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 6 },
    goalSlideLinkText: { fontSize: 13, color: accentText, fontWeight: "800" },
    goalMacroRow: { marginTop: 4 },

    /* EMPTY-STATE CTA FOR GOAL */
    goalEmptyWrapper: {
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 18,
      marginTop: 4,
      marginBottom: 22,
      borderRadius: 18,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...shadow,
    },
    goalEmptyTitle: { fontSize: 17, fontWeight: "800", color: colors.text, textAlign: "center", marginBottom: 10, letterSpacing: 0.1 },
    goalEmptyText: { fontSize: 13, color: colors.subtext, textAlign: "center", marginBottom: 16, lineHeight: 19, fontWeight: "600" },
    goalEmptyButton: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: accentBg, alignItems: "center", justifyContent: "center", minWidth: 210, ...softShadow },
    goalEmptyButtonText: { color: "#111111", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },

    /* INSIGHTS CAROUSEL */
    insightsCarouselContainer: { marginTop: 6 },
    insightCard: {
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      marginRight: CARD_GAP,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...shadow,
    },
    insightTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 8, letterSpacing: 0.2 },
    insightSubtitle: { fontSize: 13, color: colors.subtext, lineHeight: 18, marginBottom: 10 },
    insightButton: { marginTop: 4, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: accentBg, alignSelf: "flex-start", ...softShadow },
    insightButtonText: { color: "#111111", fontWeight: "800", fontSize: 13, letterSpacing: 0.2 },
    insightLinksRow: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
    insightPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: borderSoft, ...softShadow },
    insightPillText: { fontSize: 12, fontWeight: "800", color: colors.text },
    insightMeta: { fontSize: 11, color: colors.subtext, marginTop: 6 },

    scoreRow: { flexDirection: "row", gap: 10, alignItems: "center" },
    scoreBadgeWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: accentBg, alignItems: "center", justifyContent: "center", ...softShadow },
    scoreBadgeText: { color: "#111111", fontWeight: "900", fontSize: 18 },

    trainingTagRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" },
    trainingTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: accentBg, ...softShadow },
    trainingTagText: { color: "#111111", fontWeight: "900", fontSize: 12, letterSpacing: 0.2 },
    trainingTagSoft: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: panelBg, borderWidth: StyleSheet.hairlineWidth, borderColor: borderSoft },
    trainingTagSoftText: { color: colors.text, fontWeight: "800", fontSize: 12 },

    bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 6 },
    bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: accentBg, marginTop: 7 },
    bulletText: { flex: 1, fontSize: 12, color: colors.subtext, lineHeight: 18, fontWeight: "600" },

    /* carousel dots */
    dotRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 12 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: isDark ? "#2A2D36" : "#D6D9E0" },
    dotActive: { width: 18, height: 6, borderRadius: 3, backgroundColor: accentBg },

    /* MACROS */
    macroRow: {
      flexDirection: "row",
      flexWrap: "nowrap",
      gap: 6,
      marginTop: 0,
      marginBottom: 2,
    },

    /* QUICK LOG */
    quickLogCard: {
      backgroundColor: cardBg,
      borderRadius: 16,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...shadow,
    },
    quickBox: {
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderHard,
      ...softShadow,
    },
    quickInput: { flex: 1, color: colors.text, fontSize: 15, padding: 0, lineHeight: 20, minHeight: 32, maxHeight: 120 },
    quickSend: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: accentBg,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
      ...softShadow,
    },

    segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    segment: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: borderSoft, backgroundColor: panelBg, ...softShadow },
    segmentActive: { backgroundColor: accentBg, borderColor: accentBg },
    segmentText: { fontSize: 13, color: colors.text, fontWeight: "700" },
    segmentTextActive: { color: "#111111", fontWeight: "900" },

    /* SEARCH */
    searchBox: { marginTop: 14, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: borderHard, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: panelBg, ...softShadow },
    searchInput: { flex: 1, color: colors.text, paddingVertical: 0, fontSize: 14, fontWeight: "600" },

    intakeCard: {
      backgroundColor: "transparent",
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: 0,
      borderColor: "transparent",
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },

    /* DAY MEALS */
    sectionRowWrapper: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: borderSoft },
    mealRow: { paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    mealTypeIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: isDark ? "rgba(230,255,59,0.13)" : "rgba(230,255,59,0.20)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.35)" : "rgba(122,143,0,0.30)",
      alignItems: "center",
      justifyContent: "center",
    },
    mealTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 3 },
    mealMacros: { fontSize: 12, color: colors.subtext, marginBottom: 2 },
    mealNotes: { fontSize: 12, color: colors.subtext },
    mealRightCol: { alignItems: "flex-end", justifyContent: "center", gap: 4 },
    mealKcal: { fontWeight: "900", color: colors.text },

    /* COACH NOTE */
    coachNote: { backgroundColor: panelBg, padding: 12, borderRadius: 14, marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: borderHard, ...softShadow },
    coachTitle: { color: colors.subtext, fontSize: 11, fontWeight: "900", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 },
    coachText: { color: colors.text, fontSize: 13, lineHeight: 19, fontWeight: "700" },

    /* EMPTY */
    empty: { color: colors.subtext, marginTop: 12, fontWeight: "600" },
    emptySmall: { color: colors.subtext, fontSize: 13, fontWeight: "600" },

    todayScoreRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
    todayScoreBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: accentBg, alignItems: "center", justifyContent: "center", ...softShadow },
    todayScoreBadgeText: { color: "#111111", fontWeight: "900", fontSize: 14 },
    todayScoreText: { flex: 1, fontSize: 13, color: colors.subtext, fontWeight: "600", lineHeight: 18 },

    foodQualitySummary: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18, fontWeight: "700" },
    foodQualityDetail: { marginTop: 6, fontSize: 12, color: colors.subtext, lineHeight: 18, fontWeight: "600" },
  });
}

```

### app/(protected)/chat/index.jsx

```jsx
// app/(protected)/chat/page.jsx
"use client";

import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import {
  createEmptyRecentTrainingSummary,
  summariseRecentTraining,
} from "../../../src/lib/train/adaptationModel";
import { useTheme } from "../../../providers/ThemeProvider";

import { onAuthStateChanged } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../../../firebaseConfig";

/* ---------------- palette ---------------- */
const BG = "#000000";
const TEXT = "#FFFFFF";
const SUBTEXT = "#8A8A8D";
const USER_BUBBLE_BG = "#1A1A1D";
const COACH_BUBBLE_BG = "#000000";
const PRIMARY = "#E6FF3B";

const FOOTER_OFFSET = 90;

// storage keys
const VISIBLE_CHAT_STORAGE_KEY = "trainr_coach_chat_visible_v1";
const MEMORY_CHAT_STORAGE_KEY = "trainr_coach_chat_memory_v1";

const INITIAL_SYSTEM_MESSAGE = [
  "I'm your AI coach.",
  "",
  "I can help with:",
  "- training",
  "- nutrition",
  "- recovery",
  "- plan changes",
  "",
  "I use your plan, recent training, and nutrition data when it's available.",
  "",
  "Ask me things like:",
  "- What should I focus on this week?",
  "- How should I fuel today's session?",
  "- Adjust my plan if my legs feel heavy.",
].join("\n");

const QUICK_PROMPTS = [
  "What should I focus on this week?",
  "How should I fuel today's training?",
  "Review my recent training and tell me what stands out.",
  "Adjust my plan if my legs feel heavy this week.",
];

const PLAN_DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PLAN_COLLECTIONS = ["plans", "runPlans", "trainingPlans"];

function startOfISOWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function toISODate(d) {
  const value = new Date(d);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayDate(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatFullDate(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimeOfDay(d) {
  return new Date(d).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildClockContext(d = new Date()) {
  const value = new Date(d);
  const timeZone =
    Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || null;

  return {
    timezone: timeZone,
    todayIso: toISODate(value),
    todayLabel: formatFullDate(value),
    weekday: value.toLocaleDateString("en-GB", { weekday: "long" }),
    localTime: formatTimeOfDay(value),
    generatedAtIso: value.toISOString(),
  };
}

function createWelcomeMessage() {
  return {
    id: "welcome",
    role: "assistant",
    content: INITIAL_SYSTEM_MESSAGE,
    createdAt: Date.now(),
  };
}

function getMessageTimestamp(message) {
  const explicit = Number(message?.createdAt || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const idMatch = String(message?.id || "").match(/-(\d{10,})$/);
  if (!idMatch) return null;

  const inferred = Number(idMatch[1]);
  return Number.isFinite(inferred) && inferred > 0 ? inferred : null;
}

function formatMessageTime(message) {
  const timestamp = getMessageTimestamp(message);
  if (!timestamp) return "";

  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitReplyForTypewriter(text) {
  // Return words only (no whitespace tokens) for true "word-by-word" typing.
  // Preserve existing spacing by joining with a single space during rendering.
  return String(text || "").trim().match(/\S+/g) || [];
}

// ------------------------------------------------------
function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => removeUndefinedDeep(v))
      .filter((v) => v !== undefined);
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = removeUndefinedDeep(val);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  if (value === undefined) return undefined;
  return value;
}

// date helpers
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}
function safeToDate(tsLike) {
  const d =
    tsLike?.toDate?.() ||
    (tsLike instanceof Date ? tsLike : new Date(tsLike));
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

function parseDateLike(value) {
  if (!value) return null;

  try {
    if (typeof value?.toDate === "function") {
      const fromTimestamp = value.toDate();
      if (fromTimestamp instanceof Date && !Number.isNaN(fromTimestamp.getTime())) {
        fromTimestamp.setHours(0, 0, 0, 0);
        return fromTimestamp;
      }
    }
  } catch {}

  const raw =
    typeof value === "string" || typeof value === "number" || value instanceof Date
      ? value
      : null;

  if (!raw) return null;

  if (raw instanceof Date) {
    const out = new Date(raw);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }

  const ymdMatch = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const yyyy = Number(ymdMatch[1]);
    const mm = Number(ymdMatch[2]);
    const dd = Number(ymdMatch[3]);
    const out = new Date(yyyy, mm - 1, dd);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }

  const out = new Date(raw);
  if (Number.isNaN(out.getTime())) return null;
  out.setHours(0, 0, 0, 0);
  return out;
}

// keep system message small (LLMs hate massive blobs)
function buildNutritionContextText(nutritionSummary) {
  if (!nutritionSummary) return "Nutrition context: none available.";

  const goal = nutritionSummary.goal;
  const today = nutritionSummary.today;
  const week = nutritionSummary.week;

  const goalLine = goal
    ? `Goal: ${Math.round(goal.dailyCalories || 0)} kcal • P ${Math.round(
        goal.proteinTarget || 0
      )}g • C ${Math.round(goal.carbTarget || 0)}g • F ${Math.round(
        goal.fatTarget || 0
      )}g`
    : "Goal: not set.";

  const todayLine = today?.totals
    ? `Today (${today.date}): ${Math.round(today.totals.calories || 0)} kcal • P ${Math.round(
        today.totals.protein || 0
      )}g • C ${Math.round(today.totals.carbs || 0)}g • F ${Math.round(
        today.totals.fat || 0
      )}g`
    : "Today: no totals.";

  const remainLine =
    today?.remaining && goal
      ? `Remaining today: ${Math.round(today.remaining.calories || 0)} kcal • P ${Math.round(
          today.remaining.protein || 0
        )}g • C ${Math.round(today.remaining.carbs || 0)}g • F ${Math.round(
          today.remaining.fat || 0
        )}g`
      : "";

  const weekLine = week?.avg
    ? `7-day avg: ${Math.round(week.avg.calories || 0)} kcal • P ${Math.round(
        week.avg.protein || 0
      )}g • C ${Math.round(week.avg.carbs || 0)}g • F ${Math.round(
        week.avg.fat || 0
      )}g (days logged: ${week.totalDays || 0})`
    : "7-day avg: none.";

  const scoreLine = week?.nutritionScore
    ? `Nutrition score: ${week.nutritionScore.grade} (${week.nutritionScore.desc})`
    : "";

  // last 8 meals only (compact)
  const meals = Array.isArray(nutritionSummary.recentMeals)
    ? nutritionSummary.recentMeals.slice(0, 8)
    : [];

  const mealsLines =
    meals.length > 0
      ? meals
          .map((m) => {
            const when = m.date ? m.date.slice(0, 16).replace("T", " ") : "";
            const type = m.mealType ? `${m.mealType} · ` : "";
            return `- ${when} | ${type}${m.title} (${Math.round(m.calories || 0)} kcal, P ${Math.round(
              m.protein || 0
            )}g C ${Math.round(m.carbs || 0)}g F ${Math.round(m.fat || 0)}g)`;
          })
          .join("\n")
      : "- No meals logged in last 7 days.";

  return [
    "Nutrition context (use this as truth):",
    goalLine,
    todayLine,
    remainLine,
    weekLine,
    scoreLine,
    "Recent meals:",
    mealsLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlanContextText(plan) {
  if (!plan) return "Plan context: none available.";
  const meta = plan?.meta || {};
  return [
    "Training plan context:",
    `Name: ${meta.name || plan.name || ""}`,
    `Primary: ${meta.primaryActivity || plan.primaryActivity || ""}`,
    `Event: ${meta.targetEventName || plan.targetEventName || ""} ${meta.targetEventDate || plan.targetEventDate || ""}`,
    `Focus: ${meta.goalPrimaryFocus || plan.goalPrimaryFocus || ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function extractPlanWeeks(plan) {
  const candidates = [
    plan?.weeks,
    plan?.plan?.weeks,
    plan?.planData?.weeks,
    plan?.generatedPlan?.weeks,
    plan?.activePlan?.weeks,
    plan?.output?.weeks,
    plan?.result?.weeks,
    plan?.template?.weeks,
    plan?.program?.weeks,
    plan?.schedule?.weeks,
    plan?.payload?.weeks,
  ];

  for (const candidate of candidates) {
    const weeks = normaliseList(candidate);
    if (weeks.length) return weeks;
  }

  return [];
}

function extractPlanSessionPreviews(plan, maxCount = 10) {
  const weeks = extractPlanWeeks(plan);
  const previews = [];

  weeks.forEach((week, weekIndex) => {
    const weekLabel =
      week?.title ||
      (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);
    const days = normaliseList(week?.days);

    if (days.length) {
      days.forEach((day, dayIndex) => {
        const dayLabel = day?.day || day?.label || day?.name || `Day ${dayIndex + 1}`;
        const sessions = normaliseList(day?.sessions);

        sessions.forEach((session, sessionIndex) => {
          if (previews.length >= maxCount) return;
          previews.push({
            key: `${weekIndex}-${dayIndex}-${sessionIndex}`,
            weekLabel,
            dayLabel,
            title:
              session?.title || session?.name || session?.type || session?.sessionType || "Session",
            durationMin:
              Number(session?.targetDurationMin ?? session?.durationMin ?? 0) || null,
            distanceKm:
              Number(session?.targetDistanceKm ?? session?.distanceKm ?? 0) || null,
            type: session?.workout?.sport || session?.sessionType || session?.type || "",
          });
        });
      });
      return;
    }

    const sessions = [
      ...normaliseList(week?.sessions),
      ...normaliseList(week?.workouts),
    ];

    sessions.forEach((session, sessionIndex) => {
      if (previews.length >= maxCount) return;
      previews.push({
        key: `${weekIndex}-0-${sessionIndex}`,
        weekLabel,
        dayLabel: weekLabel,
        title:
          session?.title || session?.name || session?.type || session?.sessionType || "Session",
        durationMin:
          Number(session?.targetDurationMin ?? session?.durationMin ?? 0) || null,
        distanceKm:
          Number(session?.targetDistanceKm ?? session?.distanceKm ?? 0) || null,
        type: session?.workout?.sport || session?.sessionType || session?.type || "",
      });
    });
  });

  return previews.slice(0, maxCount);
}

function inferPlanKindFromDoc(planDoc) {
  const kind = String(planDoc?.kind || "").toLowerCase();
  const source = String(planDoc?.source || "").toLowerCase();
  const primary = String(
    planDoc?.primaryActivity || planDoc?.meta?.primaryActivity || ""
  ).toLowerCase();

  if (
    kind === "run" ||
    primary.includes("run") ||
    source.includes("generate-run") ||
    source.includes("run")
  ) {
    return "run";
  }

  if (
    kind === "strength" ||
    primary.includes("strength") ||
    primary.includes("gym") ||
    source.includes("generate-strength") ||
    source.includes("strength")
  ) {
    return "strength";
  }

  return kind || "training";
}

function summariseSessionForContext(session) {
  if (!session) return null;

  const durationMinRaw =
    session?.targetDurationMin ??
    session?.durationMin ??
    (Number(session?.workout?.totalDurationSec || 0)
      ? Number(session.workout.totalDurationSec) / 60
      : null);

  const distanceKmRaw =
    session?.targetDistanceKm ??
    session?.distanceKm ??
    session?.plannedDistanceKm ??
    session?.workout?.totalDistanceKm ??
    null;

  return removeUndefinedDeep({
    title:
      session?.title ||
      session?.name ||
      session?.type ||
      session?.sessionType ||
      "Session",
    sessionType: session?.sessionType || session?.type || session?.workout?.sport || null,
    durationMin: roundOrNull(durationMinRaw, 1),
    distanceKm: roundOrNull(distanceKmRaw, 2),
    notes: String(session?.notes || session?.description || "").trim() || null,
  });
}

function normalisePlanWeeksForContext(weeks) {
  return normaliseList(weeks)
    .slice(0, 24)
    .map((week, weekIndex) => {
      const weekLabel =
        week?.title ||
        (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);

      const rawDays = normaliseList(week?.days);
      if (rawDays.length) {
        const dayMap = new Map(
          rawDays.map((day) => [String(day?.day || "").trim(), day])
        );
        const orderedLabels = [
          ...PLAN_DAY_ORDER,
          ...rawDays
            .map((day) => String(day?.day || "").trim())
            .filter((label) => label && !PLAN_DAY_ORDER.includes(label)),
        ];

        const days = orderedLabels.map((label, dayIndex) => {
          const rawDay = dayMap.get(label) || { day: label || `Day ${dayIndex + 1}` };
          const fallbackDay = rawDays?.[dayIndex] || null;
          const sessions = normaliseList(rawDay?.sessions)
            .map(summariseSessionForContext)
            .filter(Boolean);

          return {
            day: label || rawDay?.day || `Day ${dayIndex + 1}`,
            date: rawDay?.date || rawDay?.isoDate || fallbackDay?.date || fallbackDay?.isoDate || null,
            sessions,
          };
        });

        return {
          title: weekLabel,
          weekIndex0:
            typeof week?.weekIndex0 === "number" ? week.weekIndex0 : weekIndex,
          weekNumber:
            typeof week?.weekNumber === "number" ? week.weekNumber : weekIndex + 1,
          weekStartDate: week?.weekStartDate || week?.startDate || null,
          weekEndDate: week?.weekEndDate || week?.endDate || null,
          days,
        };
      }

      const sessions = [
        ...normaliseList(week?.sessions),
        ...normaliseList(week?.workouts),
      ]
        .map(summariseSessionForContext)
        .filter(Boolean);

      return {
        title: weekLabel,
        weekIndex0:
          typeof week?.weekIndex0 === "number" ? week.weekIndex0 : weekIndex,
        weekNumber:
          typeof week?.weekNumber === "number" ? week.weekNumber : weekIndex + 1,
        weekStartDate: week?.weekStartDate || week?.startDate || null,
        weekEndDate: week?.weekEndDate || week?.endDate || null,
        days: [{ day: weekLabel, sessions }],
      };
    });
}

function normalisePlanDocShape(source, idOverride = "") {
  const data = source?.data ? source.data() : source || {};
  const rawPlan = data?.plan || {};
  const weeksRaw = rawPlan?.weeks || data?.weeks || [];
  const kind = data?.kind || rawPlan?.kind || inferPlanKindFromDoc(data);
  const nameFromMeta = data?.meta?.name;
  const nameFromPlan = rawPlan?.name;
  const nameFromData = data?.name;

  const primaryActivity =
    data?.meta?.primaryActivity ||
    data?.primaryActivity ||
    rawPlan?.primaryActivity ||
    (kind === "run" ? "Run" : kind === "strength" ? "Strength" : "Training");

  return {
    id: idOverride || source?.id || data?.id || "",
    sourceCollection:
      source?.sourceCollection || data?.sourceCollection || "plans",
    ...data,
    rawDoc: data,
    kind,
    name: nameFromMeta || nameFromPlan || nameFromData || "Training Plan",
    primaryActivity,
    weeks: normalisePlanWeeksForContext(weeksRaw),
  };
}

function sortPlansForContext(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const aDate =
      safeToDate(a?.updatedAt) ||
      safeToDate(a?.createdAt) ||
      safeToDate(a?.rawDoc?.updatedAt) ||
      safeToDate(a?.rawDoc?.createdAt) ||
      new Date(0);
    const bDate =
      safeToDate(b?.updatedAt) ||
      safeToDate(b?.createdAt) ||
      safeToDate(b?.rawDoc?.updatedAt) ||
      safeToDate(b?.rawDoc?.createdAt) ||
      new Date(0);
    return bDate - aDate;
  });
}

function selectActivePlans(docs) {
  const list = Array.isArray(docs) ? docs.filter((item) => item?.id) : [];
  const run = list.find((item) => inferPlanKindFromDoc(item) === "run") || null;
  const strength =
    list.find((item) => inferPlanKindFromDoc(item) === "strength") || null;

  let primary = null;
  let companion = null;

  if (run) {
    primary = run;
    companion = strength && strength.id !== run.id ? strength : null;
  } else if (strength) {
    primary = strength;
    companion =
      list.find(
        (item) =>
          item.id !== strength.id &&
          inferPlanKindFromDoc(item) !== inferPlanKindFromDoc(strength)
      ) || null;
  } else {
    primary = list[0] || null;
    companion = list[1] || null;
  }

  const activePlans = [primary, companion].filter(
    (item, index, arr) => item?.id && arr.findIndex((p) => p?.id === item.id) === index
  );

  return {
    primary,
    companion: companion && companion?.id !== primary?.id ? companion : null,
    activePlans,
  };
}

function resolvePlanWeekZeroStart(planDoc, sessionLogMap = null) {
  if (!planDoc) return null;

  const planId = String(planDoc?.id || "").trim();
  if (planId && sessionLogMap && typeof sessionLogMap === "object") {
    const anchorVotes = new Map();
    Object.values(sessionLogMap).forEach((log) => {
      if (String(log?.planId || "").trim() !== planId) return;
      const weekIndex = Number(log?.weekIndex);
      const dayIndex = Number(log?.dayIndex);
      if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return;

      const logDate =
        parseDateLike(log?.date) ||
        parseDateLike(log?.statusAt) ||
        parseDateLike(log?.completedAt) ||
        parseDateLike(log?.updatedAt) ||
        parseDateLike(log?.createdAt);
      if (!logDate) return;

      const anchor = addDays(logDate, -(Math.round(weekIndex) * 7 + Math.round(dayIndex)));
      anchor.setHours(0, 0, 0, 0);
      const key = toISODate(anchor);
      const prev = anchorVotes.get(key) || 0;
      anchorVotes.set(key, prev + 1);
    });

    if (anchorVotes.size) {
      const sorted = [...anchorVotes.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]));
      });
      const parsed = parseDateLike(sorted[0]?.[0]);
      if (parsed) return startOfISOWeek(parsed);
    }
  }

  const weeks = Array.isArray(planDoc?.weeks) ? planDoc.weeks : [];
  for (let idx = 0; idx < weeks.length; idx += 1) {
    const week = weeks[idx];
    const weekIndex0 = Number.isFinite(Number(week?.weekIndex0))
      ? Number(week.weekIndex0)
      : idx;
    const explicitWeekStart = parseDateLike(week?.weekStartDate || week?.startDate);
    if (explicitWeekStart) {
      return startOfISOWeek(addDays(explicitWeekStart, -(weekIndex0 * 7)));
    }

    const days = Array.isArray(week?.days) ? week.days : [];
    for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
      const explicitDayDate = parseDateLike(days[dayIdx]?.date || days[dayIdx]?.isoDate);
      if (explicitDayDate) {
        return startOfISOWeek(addDays(explicitDayDate, -(weekIndex0 * 7 + dayIdx)));
      }
    }
  }

  const fallbackStart = parseDateLike(
    planDoc?.startDate ||
      planDoc?.plan?.startDate ||
      planDoc?.meta?.startDate ||
      planDoc?.weekStartDate ||
      planDoc?.plan?.weekStartDate ||
      planDoc?.rawDoc?.startDate ||
      planDoc?.rawDoc?.plan?.startDate ||
      planDoc?.rawDoc?.meta?.startDate ||
      planDoc?.createdAt ||
      planDoc?.updatedAt ||
      planDoc?.rawDoc?.createdAt ||
      planDoc?.rawDoc?.updatedAt
  );

  return fallbackStart ? startOfISOWeek(fallbackStart) : null;
}

function buildMergedExactSchedule(plans, maxItems = 24, sessionLogMap = null) {
  const items = [];
  const now = new Date();
  const todayIso = toISODate(now);
  const currentWeekStart = startOfISOWeek(now);
  const currentWeekStartIso = toISODate(currentWeekStart);

  (Array.isArray(plans) ? plans : []).forEach((plan) => {
    const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
    const planWeekZeroStart = resolvePlanWeekZeroStart(plan, sessionLogMap) || currentWeekStart;

    weeks.forEach((week, weekIndex) => {
      const weekLabel =
        week?.title ||
        (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);
      const days = Array.isArray(week?.days) ? week.days : [];

      days.forEach((day, dayIndex) => {
        const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
        sessions.forEach((session, sessionIndex) => {
          const summary = summariseSessionForContext(session);
          if (!summary) return;
          const date = addDays(planWeekZeroStart, weekIndex * 7 + dayIndex);
          const isoDate = toISODate(date);

          items.push({
            planId: plan?.id || null,
            planName: plan?.name || null,
            planKind: inferPlanKindFromDoc(plan),
            weekIndex,
            weekLabel,
            dayIndex,
            dayLabel: day?.day || `Day ${dayIndex + 1}`,
            isoDate,
            dateLabel: formatDayDate(date),
            isToday: isoDate === todayIso,
            sessionIndex,
            ...summary,
          });
        });
      });
    });
  });

  return items
    .sort((a, b) => {
      if (a.isoDate !== b.isoDate) return String(a.isoDate).localeCompare(String(b.isoDate));
      if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      if (a.planKind !== b.planKind) return String(a.planKind).localeCompare(String(b.planKind));
      return a.sessionIndex - b.sessionIndex;
    })
    .filter((item) => String(item?.isoDate || "") >= currentWeekStartIso)
    .slice(0, maxItems);
}

function roundOrNull(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function summariseWeights(rows) {
  const ordered = [...(Array.isArray(rows) ? rows : [])]
    .map((row) => ({
      ...row,
      _date: safeToDate(row?.date || row?.createdAt),
      _weight: Number(row?.weight || row?.value || 0),
    }))
    .filter((row) => row._date && Number.isFinite(row._weight) && row._weight > 0)
    .sort((a, b) => a._date - b._date);

  if (!ordered.length) return null;

  const latest = ordered[ordered.length - 1];
  const latestDate = latest._date;

  const nearestFromDaysAgo = (days) => {
    const target = new Date(latestDate);
    target.setDate(target.getDate() - days);
    let candidate = ordered[0];

    ordered.forEach((row) => {
      if (row._date <= latestDate && row._date >= target) {
        candidate = row;
      }
    });

    return candidate;
  };

  const from7d = nearestFromDaysAgo(7);
  const from30d = nearestFromDaysAgo(30);

  return {
    latestKg: roundOrNull(latest._weight, 1),
    latestDate: latestDate.toISOString(),
    change7dKg:
      from7d && from7d !== latest ? roundOrNull(latest._weight - from7d._weight, 1) : null,
    change30dKg:
      from30d && from30d !== latest ? roundOrNull(latest._weight - from30d._weight, 1) : null,
    entriesCount: ordered.length,
  };
}

export default function CoachChatPage() {
  const { isDark } = useTheme();

  const [input, setInput] = useState("");

  const [messages, setMessages] = useState([createWelcomeMessage()]);

  const [memoryMessages, setMemoryMessages] = useState([]);
  const memoryMessagesRef = useRef([]);
  const [isSending, setIsSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());

  const [allPlans, setAllPlans] = useState([]);

  const [nutritionSummary, setNutritionSummary] = useState(null);
  const [planPrefs, setPlanPrefs] = useState(null);
  const [recentTrainSummary, setRecentTrainSummary] = useState(() =>
    createEmptyRecentTrainingSummary()
  );
  const [weightSummary, setWeightSummary] = useState(null);
  const [sessionLogMap, setSessionLogMap] = useState({});

  const [user, setUser] = useState(null);

  const scrollViewRef = useRef(null);
  const s = makeStyles();
  const isDev = typeof __DEV__ !== "undefined" && __DEV__;
  const devLog = useCallback(
    (...args) => {
      if (isDev) console.log(...args);
    },
    [isDev]
  );

  const scrollToEnd = () =>
    scrollViewRef.current?.scrollToEnd?.({ animated: true });

  useEffect(() => {
    memoryMessagesRef.current = Array.isArray(memoryMessages) ? memoryMessages : [];
  }, [memoryMessages]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, isSending]);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // keyboard listeners
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // auth subscription
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // load chat from storage
  useEffect(() => {
    const loadChat = async () => {
      try {
        const [visibleRaw, memoryRaw] = await Promise.all([
          AsyncStorage.getItem(VISIBLE_CHAT_STORAGE_KEY),
          AsyncStorage.getItem(MEMORY_CHAT_STORAGE_KEY),
        ]);

        if (visibleRaw) {
          const parsedVisible = JSON.parse(visibleRaw);
          if (Array.isArray(parsedVisible) && parsedVisible.length > 0) {
            setMessages(parsedVisible);
          }
        }

        if (memoryRaw) {
          const parsedMemory = JSON.parse(memoryRaw);
          if (Array.isArray(parsedMemory)) setMemoryMessages(parsedMemory);
        }
      } catch (err) {
        console.log("[coach-chat] failed to load chat:", err);
      } finally {
        setHydrated(true);
      }
    };

    loadChat();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      VISIBLE_CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-80))
    ).catch((err) => console.log("[coach-chat] save visible err:", err));
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      MEMORY_CHAT_STORAGE_KEY,
      JSON.stringify(memoryMessages.slice(-200))
    ).catch((err) => console.log("[coach-chat] save memory err:", err));
  }, [memoryMessages, hydrated]);

  useEffect(() => {
    if (!user) {
      setAllPlans([]);
      return;
    }

    const latestByCollection = Object.create(null);

    const syncPlans = () => {
      const primaryPlans = latestByCollection.plans || [];
      const merged = primaryPlans.length
        ? primaryPlans
        : PLAN_COLLECTIONS.flatMap((colName) => latestByCollection[colName] || []);

      const deduped = [];
      const seen = new Set();

      sortPlansForContext(merged).forEach((doc) => {
        const key = `${doc?.sourceCollection || "plans"}:${doc?.id || ""}`;
        if (!doc?.id || seen.has(key)) return;
        seen.add(key);
        deduped.push(doc);
      });

      setAllPlans(deduped);
    };

    const unsubs = PLAN_COLLECTIONS.map((colName) =>
      onSnapshot(
        query(collection(db, "users", user.uid, colName), limit(40)),
        (snap) => {
          latestByCollection[colName] = snap.docs
            .map((docSnap) =>
              normalisePlanDocShape(
                {
                  id: docSnap.id,
                  data: () => docSnap.data(),
                  sourceCollection: colName,
                },
                docSnap.id
              )
            )
            .filter((doc) => doc?.id);
          syncPlans();
        },
        (err) => {
          console.log(`[coach-chat] failed to load ${colName}:`, err);
          latestByCollection[colName] = [];
          syncPlans();
        }
      )
    );

    return () => unsubs.forEach((unsub) => unsub?.());
  }, [user]);

  useEffect(() => {
    if (!user) {
      setPlanPrefs(null);
      return;
    }

    const ref = doc(db, "users", user.uid, "planPrefs", "current");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setPlanPrefs(snap.exists() ? snap.data() : null);
      },
      (err) => {
        console.log("[coach-chat] failed to load plan prefs:", err);
        setPlanPrefs(null);
      }
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setRecentTrainSummary(createEmptyRecentTrainingSummary());
      return;
    }

    const ref = collection(db, "users", user.uid, "trainSessions");
    const q = query(ref, orderBy("updatedAt", "desc"), limit(12));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRecentTrainSummary(summariseRecentTraining(rows));
      },
      (err) => {
        console.log("[coach-chat] recent train snapshot error:", err);
        setRecentTrainSummary(createEmptyRecentTrainingSummary());
      }
    );

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setWeightSummary(null);
      return;
    }

    const ref = collection(db, "users", user.uid, "weights");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setWeightSummary(summariseWeights(rows));
      },
      (err) => {
        console.log("[coach-chat] weights snapshot error:", err);
        setWeightSummary(null);
      }
    );

    return () => unsub();
  }, [user]);

  // LIVE nutrition (same schema as Nutrition page: meals.date Timestamp)
  useEffect(() => {
    if (!user) {
      setNutritionSummary(null);
      return;
    }

    let unsubGoal = null;
    let unsubMeals = null;

    const goalRef = doc(db, "users", user.uid, "nutrition", "profile");
    const mealsRef = collection(db, "users", user.uid, "meals");

    const since = startOfDay(daysAgo(6));
    const qMeals7d = query(
      mealsRef,
      where("date", ">=", Timestamp.fromDate(since)),
      orderBy("date", "desc")
    );

    let latestGoal = null;
    let latestMeals = [];

    const recompute = () => {
      const goal = latestGoal
        ? {
            dailyCalories: Number(latestGoal.dailyCalories || 0),
            proteinTarget: Number(latestGoal.proteinTarget || 0),
            carbTarget: Number(latestGoal.carbTarget || 0),
            fatTarget: Number(latestGoal.fatTarget || 0),
            raw: latestGoal,
          }
        : null;

      const goalCals = goal?.dailyCalories || 0;

      const today = startOfDay();
      const todayKey = today.toISOString().slice(0, 10);

      const todayTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
      const byDay = {};

      latestMeals.forEach((m) => {
        const d = safeToDate(m.date);
        if (!d) return;
        const key = d.toISOString().slice(0, 10);

        if (!byDay[key]) {
          byDay[key] = { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
        }

        byDay[key].calories += Number(m.calories || 0);
        byDay[key].protein += Number(m.protein || 0);
        byDay[key].carbs += Number(m.carbs || 0);
        byDay[key].fat += Number(m.fat || 0);
        byDay[key].meals += 1;

        if (key === todayKey) {
          todayTotals.calories += Number(m.calories || 0);
          todayTotals.protein += Number(m.protein || 0);
          todayTotals.carbs += Number(m.carbs || 0);
          todayTotals.fat += Number(m.fat || 0);
        }
      });

      const dayKeys = Object.keys(byDay);
      const total = dayKeys.reduce(
        (acc, k) => ({
          calories: acc.calories + byDay[k].calories,
          protein: acc.protein + byDay[k].protein,
          carbs: acc.carbs + byDay[k].carbs,
          fat: acc.fat + byDay[k].fat,
          days: acc.days + 1,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0, days: 0 }
      );

      const weekAvg =
        total.days > 0
          ? {
              calories: Math.round(total.calories / total.days),
              protein: Math.round(total.protein / total.days),
              carbs: Math.round(total.carbs / total.days),
              fat: Math.round(total.fat / total.days),
            }
          : { calories: 0, protein: 0, carbs: 0, fat: 0 };

      let nutritionScore = null;
      if (goalCals && weekAvg.calories) {
        const diffRatio = Math.abs(weekAvg.calories - goalCals) / goalCals;
        let grade = "C";
        let desc = "Big swings vs your calorie target.";
        if (diffRatio <= 0.08) {
          grade = "A";
          desc = "Dialled in — very close to your target on average.";
        } else if (diffRatio <= 0.15) {
          grade = "B";
          desc = "Pretty close to your target, with some day-to-day variation.";
        }
        nutritionScore = { grade, desc, diffPercent: Math.round(diffRatio * 100) };
      }

      const remaining =
        goal && goalCals
          ? {
              calories: Math.max(0, Math.round(goalCals - todayTotals.calories)),
              protein: Math.max(
                0,
                Math.round((goal.proteinTarget || 0) - todayTotals.protein)
              ),
              carbs: Math.max(
                0,
                Math.round((goal.carbTarget || 0) - todayTotals.carbs)
              ),
              fat: Math.max(
                0,
                Math.round((goal.fatTarget || 0) - todayTotals.fat)
              ),
            }
          : null;

      const recentMeals = latestMeals.slice(0, 25).map((m) => {
        const d = safeToDate(m.date);
        return {
          id: m.id,
          title: m.title || "",
          mealType: m.mealType || "",
          calories: Number(m.calories || 0),
          protein: Number(m.protein || 0),
          carbs: Number(m.carbs || 0),
          fat: Number(m.fat || 0),
          notes: m.notes || "",
          source: m.source || "",
          date: d ? d.toISOString() : null,
        };
      });

      const summary = {
        goal,
        today: { date: todayKey, totals: todayTotals, remaining },
        week: { avg: weekAvg, totalDays: total.days, nutritionScore },
        recentMeals,
      };

      const hasAnything =
        !!goal ||
        recentMeals.length > 0 ||
        todayTotals.calories ||
        todayTotals.protein ||
        todayTotals.carbs ||
        todayTotals.fat;

      setNutritionSummary(hasAnything ? summary : null);

      devLog(
        "[coach-chat] nutrition linked:",
        hasAnything,
        "meals7d:",
        latestMeals.length,
        "goal:",
        !!goal
      );
    };

    unsubGoal = onSnapshot(
      goalRef,
      (snap) => {
        latestGoal = snap.exists() ? snap.data() : null;
        recompute();
      },
      (err) => {
        console.log("[coach-chat] goal snapshot error:", err);
        latestGoal = null;
        recompute();
      }
    );

    unsubMeals = onSnapshot(
      qMeals7d,
      (snap) => {
        latestMeals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        recompute();
      },
      (err) => {
        console.log("[coach-chat] meals snapshot error:", err);
        latestMeals = [];
        recompute();
      }
    );

    return () => {
      if (unsubGoal) unsubGoal();
      if (unsubMeals) unsubMeals();
    };
  }, [user]);

  const nutritionLinkedText = useMemo(() => {
    if (!nutritionSummary) return "not linked";
    const n = nutritionSummary.recentMeals?.length || 0;
    const goal = nutritionSummary.goal ? "goal" : "no goal";
    return `linked • ${n} meals (7d) • ${goal}`;
  }, [nutritionSummary]);

  const { primary: plan, companion: companionPlan, activePlans } = useMemo(
    () => selectActivePlans(allPlans),
    [allPlans]
  );

  const planDocId = plan?.id || null;
  const activePlanIds = useMemo(
    () =>
      activePlans
        .map((item) => String(item?.id || "").trim())
        .filter(Boolean),
    [activePlans]
  );

  useEffect(() => {
    if (!user || !activePlanIds.length) {
      setSessionLogMap({});
      return;
    }

    const ref = collection(db, "users", user.uid, "sessionLogs");
    const chunks = [];
    for (let idx = 0; idx < activePlanIds.length; idx += 10) {
      chunks.push(activePlanIds.slice(idx, idx + 10));
    }

    const partialMaps = {};
    let closed = false;

    const syncMergedMap = () => {
      if (closed) return;
      const merged = {};
      Object.values(partialMaps).forEach((chunkMap) => {
        Object.assign(merged, chunkMap || {});
      });
      setSessionLogMap(merged);
    };

    const unsubs = chunks.map((ids, chunkIdx) =>
      onSnapshot(
        query(ref, where("planId", "in", ids)),
        (snap) => {
          const nextMap = {};
          snap.forEach((docSnap) => {
            nextMap[docSnap.id] = docSnap.data() || {};
          });
          partialMaps[chunkIdx] = nextMap;
          syncMergedMap();
        },
        (err) => {
          console.log("[coach-chat] session logs snapshot error:", err);
          partialMaps[chunkIdx] = {};
          syncMergedMap();
        }
      )
    );

    return () => {
      closed = true;
      unsubs.forEach((unsub) => unsub?.());
    };
  }, [activePlanIds, user]);

  const exactSchedule = useMemo(
    () => buildMergedExactSchedule(activePlans, 28, sessionLogMap),
    [activePlans, sessionLogMap]
  );

  const currentWeekSchedule = useMemo(
    () => {
      const weekStartIso = toISODate(startOfISOWeek(new Date()));
      const nextWeekStartIso = toISODate(addDays(startOfISOWeek(new Date()), 7));
      return exactSchedule.filter(
        (item) =>
          String(item?.isoDate || "") >= weekStartIso &&
          String(item?.isoDate || "") < nextWeekStartIso
      );
    },
    [exactSchedule]
  );

  const todaySchedule = useMemo(
    () => exactSchedule.filter((item) => !!item?.isToday),
    [exactSchedule]
  );

  const activePlansDetailed = useMemo(
    () =>
      activePlans.map((activePlan) => ({
        id: activePlan?.id || null,
        name: activePlan?.name || null,
        kind: inferPlanKindFromDoc(activePlan),
        primaryActivity: activePlan?.primaryActivity || null,
        goalPrimaryFocus: activePlan?.goalPrimaryFocus || null,
        targetEventName: activePlan?.targetEventName || null,
        targetEventDate: activePlan?.targetEventDate || null,
        weeksCount: Array.isArray(activePlan?.weeks) ? activePlan.weeks.length : 0,
        weeks: Array.isArray(activePlan?.weeks) ? activePlan.weeks : [],
      })),
    [activePlans]
  );

  const clockContext = useMemo(
    () => buildClockContext(new Date(clockTick)),
    [clockTick]
  );

  const chatContext = useMemo(() => {
    const profileFromNutrition = nutritionSummary?.goal
      ? {
          sex: nutritionSummary.goal.raw?.sex || null,
          age: nutritionSummary.goal.raw?.age || null,
          heightCm: nutritionSummary.goal.raw?.heightCm || null,
          weightKg: nutritionSummary.goal.raw?.weightKg || null,
        }
      : null;

    return {
      athleteProfile: removeUndefinedDeep({
        age: planPrefs?.age ?? profileFromNutrition?.age ?? null,
        sex: planPrefs?.sex ?? profileFromNutrition?.sex ?? null,
        heightCm: planPrefs?.heightCm ?? profileFromNutrition?.heightCm ?? null,
        weightKg: planPrefs?.weightKg ?? profileFromNutrition?.weightKg ?? null,
        goalDistance: planPrefs?.goalDistance ?? null,
        goalPrimaryFocus: planPrefs?.goalPrimaryFocus ?? plan?.goalPrimaryFocus ?? null,
        targetEventName: planPrefs?.targetEventName ?? plan?.targetEventName ?? null,
        targetEventDate: planPrefs?.targetEventDate ?? plan?.targetEventDate ?? null,
        injuries: planPrefs?.injuries ?? null,
        constraints: planPrefs?.constraints ?? null,
        notesForCoach: planPrefs?.notesForCoach ?? null,
        bodyweightTrend: weightSummary,
      }),
      training: removeUndefinedDeep({
        activePlan: plan
          ? {
              id: plan.id || null,
              name: plan.name || null,
              primaryActivity: plan.primaryActivity || null,
              goalPrimaryFocus: plan.goalPrimaryFocus || null,
              targetEventName: plan.targetEventName || null,
              targetEventDate: plan.targetEventDate || null,
              weeksCount: Array.isArray(plan?.weeks) ? plan.weeks.length : 0,
              nextSessions: exactSchedule
                .filter((item) => item?.planId === plan.id)
                .slice(0, 12),
            }
          : null,
        companionPlan: companionPlan
          ? {
              id: companionPlan.id || null,
              name: companionPlan.name || null,
              primaryActivity: companionPlan.primaryActivity || null,
              goalPrimaryFocus: companionPlan.goalPrimaryFocus || null,
              targetEventName: companionPlan.targetEventName || null,
              targetEventDate: companionPlan.targetEventDate || null,
              weeksCount: Array.isArray(companionPlan?.weeks)
                ? companionPlan.weeks.length
                : 0,
              nextSessions: exactSchedule
                .filter((item) => item?.planId === companionPlan.id)
                .slice(0, 12),
            }
          : null,
        activePlans: activePlansDetailed,
        exactSchedule,
        currentWeekSchedule,
        todaySchedule,
        weekDateAnchor: {
          model: "week_0_is_current_iso_week",
          currentWeekStartIso: toISODate(startOfISOWeek(new Date())),
          todayIso: toISODate(new Date()),
          todayLabel: formatDayDate(new Date()),
        },
        recentTraining: recentTrainSummary,
      }),
      nutrition: nutritionSummary
        ? {
            ...nutritionSummary,
            recentMeals: Array.isArray(nutritionSummary.recentMeals)
              ? nutritionSummary.recentMeals.slice(0, 10)
              : [],
          }
        : null,
      clock: clockContext,
    };
  }, [
    activePlansDetailed,
    clockContext,
    companionPlan,
    currentWeekSchedule,
    exactSchedule,
    nutritionSummary,
    plan,
    planPrefs,
    recentTrainSummary,
    todaySchedule,
    weightSummary,
  ]);

  const contextBadges = useMemo(() => {
    const badges = [];

    if (activePlans.length > 1) {
      badges.push(
        `Plans: ${activePlans
          .map((item) => item?.name)
          .filter(Boolean)
          .join(" + ")}`
      );
    } else if (plan?.name) {
      badges.push(`Plan: ${plan.name}`);
    }
    if (exactSchedule.length) {
      badges.push(`${exactSchedule.length} scheduled sessions loaded`);
    }
    if (recentTrainSummary?.last7d?.sessions) {
      badges.push(`${recentTrainSummary.last7d.sessions} sessions in 7d`);
    }
    if (nutritionSummary?.goal) badges.push("Nutrition target linked");
    if (nutritionSummary?.recentMeals?.length) {
      badges.push(`${nutritionSummary.recentMeals.length} recent meals`);
    }
    if (weightSummary?.latestKg != null) {
      badges.push(`${weightSummary.latestKg.toFixed(1)} kg`);
    }
    if (planPrefs?.injuries) badges.push("Injury notes loaded");

    return badges.slice(0, 6);
  }, [activePlans, exactSchedule.length, nutritionSummary, plan, planPrefs?.injuries, recentTrainSummary, weightSummary]);

  const contextHighlights = useMemo(() => {
    const highlights = [];

    if (activePlans.length > 1) {
      highlights.push({
        icon: "calendar",
        label: `${activePlans.length} active plans`,
      });
    } else if (plan?.name) {
      highlights.push({ icon: "calendar", label: plan.name });
    }
    if (exactSchedule.length) {
      highlights.push({
        icon: "list",
        label: `${exactSchedule.length} sessions loaded`,
      });
    }
    if (recentTrainSummary?.last7d?.sessions) {
      highlights.push({
        icon: "activity",
        label: `${recentTrainSummary.last7d.sessions} sessions in 7d`,
      });
    }
    if (nutritionSummary?.goal) {
      highlights.push({ icon: "coffee", label: "Nutrition linked" });
    }
    if (weightSummary?.latestKg != null) {
      highlights.push({
        icon: "bar-chart-2",
        label: `${weightSummary.latestKg.toFixed(1)} kg`,
      });
    }

    return highlights.slice(0, 4);
  }, [activePlans.length, exactSchedule.length, nutritionSummary?.goal, plan?.name, recentTrainSummary?.last7d?.sessions, weightSummary?.latestKg]);

  const handleClearChat = async () => {
    const reset = [createWelcomeMessage()];
    setMessages(reset);
    setMemoryMessages([]);
    try {
      await Promise.all([
        AsyncStorage.setItem(VISIBLE_CHAT_STORAGE_KEY, JSON.stringify(reset)),
        AsyncStorage.setItem(MEMORY_CHAT_STORAGE_KEY, JSON.stringify([])),
      ]);
    } catch (err) {
      console.log("[coach-chat] failed to clear visible chat:", err);
    }
  };

  const submitMessage = useCallback(async (rawText) => {
    const trimmed = String(rawText || "").trim();
    if (!trimmed || isSending) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setMemoryMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      if (!API_URL) throw new Error("API_URL missing (check EXPO_PUBLIC_API_URL).");

      // Use a ref to avoid stale state when messages are sent quickly.
      const mem = [...(memoryMessagesRef.current || []), userMessage]
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-40);

      const requestContext = {
        ...chatContext,
        clock: buildClockContext(new Date()),
      };

      const payload = {
        // Send both user + assistant roles for coherent conversation state.
        messages: mem.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        nutrition: nutritionSummary || null,
        plan: plan?.rawDoc ? { id: plan.id, ...plan.rawDoc } : plan || null,
        context: requestContext,
      };

      devLog(
        "[coach-chat] sending payload context:",
        !!requestContext,
        "nutrition:",
        !!nutritionSummary,
        "plan:",
        !!plan,
        "activePlans:",
        activePlans.length,
        "exactSchedule:",
        exactSchedule.length,
        "todayIso:",
        requestContext?.clock?.todayIso
      );

      const res = await fetch(`${API_URL}/coach-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      devLog("[coach-chat] status:", res.status);
      // Avoid logging raw responses in production (may contain user data).
      devLog("[coach-chat] raw response:", rawText);

      if (!res.ok) {
        throw new Error(`coach-chat failed (${res.status}): ${rawText.slice(0, 200)}`);
      }

      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error("Server did not return valid JSON.");
      }

      const replyText =
        data.reply ||
        data.message ||
        data.answer ||
        data.text ||
        data.content ||
        data.output ||
        data.response ||
        data.result ||
        "Got it — let’s keep going.";

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const parts = splitReplyForTypewriter(replyText);
      let visibleReply = "";
      for (const part of parts) {
        visibleReply = visibleReply ? `${visibleReply} ${part}` : part;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessage.id
              ? { ...msg, content: visibleReply }
              : msg
          )
        );
        await wait(55);
      }

      const completedAssistantMessage = {
        ...assistantMessage,
        content: replyText,
      };

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessage.id ? completedAssistantMessage : msg
        )
      );
      setMemoryMessages((prev) => [...prev, completedAssistantMessage]);

      // plan update
      if (data.updatedPlan && planDocId && user) {
        try {
          const planCollection =
            String(plan?.sourceCollection || "").trim() || "plans";
          const planRef = doc(db, "users", user.uid, planCollection, planDocId);
          const cleanedUpdates = removeUndefinedDeep({
            ...data.updatedPlan,
            updatedAt: serverTimestamp(),
          });
          await updateDoc(planRef, cleanedUpdates);
          setAllPlans((prev) =>
            prev.map((item) => {
              if (item?.id !== planDocId) return item;
              return normalisePlanDocShape(
                {
                  ...(item?.rawDoc || item || {}),
                  ...data.updatedPlan,
                },
                item.id
              );
            })
          );
        } catch (err) {
          devLog("[coach-chat] Failed to update plan:", err);
        }
      }
    } catch (err) {
      devLog("[coach-chat] error:", err);

      const errorMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: err?.message || "I couldn't reach the server. Try again in a moment.",
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, errorMessage]);
      setMemoryMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, [
    chatContext,
    isSending,
    nutritionSummary,
    activePlans.length,
    exactSchedule.length,
    plan,
    planDocId,
    user,
    devLog,
  ]);

  const handleSend = useCallback(() => {
    submitMessage(input);
  }, [input, submitMessage]);

  const renderBubble = (msg) => {
    const isUserBubble = msg.role === "user";
    const messageTime = formatMessageTime(msg);

    return (
      <View
        key={msg.id}
        style={[
          s.messageRow,
          { justifyContent: isUserBubble ? "flex-end" : "flex-start" },
        ]}
      >
        {!isUserBubble ? (
          <View style={s.coachAvatar}>
            <Feather name="message-circle" size={13} color="#111111" />
          </View>
        ) : null}

        <View style={[s.bubble, isUserBubble ? s.bubbleUser : s.bubbleCoach]}>
          <Text style={[s.bubbleText, isUserBubble && s.bubbleTextUser]}>{msg.content}</Text>
          {!!messageTime && (
            <View style={s.bubbleMetaRow}>
              <Text style={[s.bubbleTime, isUserBubble && s.bubbleTimeUser]}>{messageTime}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const showQuickPrompts = messages.length <= 1;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <LinearGradient
        colors={[
          "rgba(230,255,59,0.18)",
          "rgba(230,255,59,0.10)",
          "rgba(230,255,59,0.05)",
          "rgba(0,0,0,1)",
        ]}
        style={s.fullBackground}
      />
      <View style={s.fullOverlay} />

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={s.page}>
          <View style={s.header}>
            <View style={s.headerMainRow}>
              <View style={s.headerIdentity}>
                <View style={s.headerAvatar}>
                  <Feather name="message-circle" size={16} color="#111111" />
                </View>
                <View style={s.headerTextBlock}>
                  <Text style={s.headerTitle}>Coach</Text>
                  <Text style={s.headerSubtitle}>
                    Knows your training, nutrition and current plan
                  </Text>
                </View>
              </View>

              <View style={s.headerActions}>
                <TouchableOpacity
                  onPress={handleClearChat}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={s.clearBtn}
                >
                  <Feather name="trash-2" size={16} color={SUBTEXT} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.contextBadgeRow}>
              {contextHighlights.map((item) => (
                <View key={item.label} style={s.contextBadge}>
                  <Feather name={item.icon} size={12} color="#CFCFD4" />
                  <Text style={s.contextBadgeText}>{item.label}</Text>
                </View>
              ))}
              {!contextHighlights.length ? (
                <View style={s.contextBadge}>
                  <Feather name="loader" size={12} color="#CFCFD4" />
                  <Text style={s.contextBadgeText}>Loading context</Text>
                </View>
              ) : null}
            </View>
            {!!contextBadges.length ? (
              <Text style={s.contextSubline}>
                {contextBadges.slice(0, 2).join(" • ")}
              </Text>
            ) : null}
          </View>

          <View style={s.chatDayRow}>
            <View style={s.chatDayPill}>
              <Text style={s.chatDayText}>Today</Text>
            </View>
          </View>

          <ScrollView
            ref={scrollViewRef}
            style={s.messagesScroll}
            contentContainerStyle={[
              s.messagesContent,
              keyboardVisible && { paddingBottom: 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            onContentSizeChange={scrollToEnd}
          >
            {showQuickPrompts ? (
              <View style={s.quickPromptWrap}>
                <Text style={s.quickPromptLabel}>Suggested questions</Text>
                <View style={s.quickPromptRow}>
                  {QUICK_PROMPTS.map((prompt) => (
                    <TouchableOpacity
                      key={prompt}
                      onPress={() => submitMessage(prompt)}
                      style={s.quickPromptChip}
                      activeOpacity={0.85}
                    >
                      <Text style={s.quickPromptText}>{prompt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {messages.map(renderBubble)}

            {isSending && (
              <View style={s.messageRow}>
                <View style={s.coachAvatar}>
                  <Feather name="message-circle" size={13} color="#111111" />
                </View>
                <View style={[s.bubble, s.bubbleCoach, s.typingBubble]}>
                  <View style={s.typingRow}>
                    <ActivityIndicator size="small" color={PRIMARY} />
                    <Text style={s.typingText}>Thinking…</Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          <View style={[s.inputWrapper, keyboardVisible && { bottom: 8 }]}>
            <View style={s.inputShell}>
              <View style={s.inputContainer}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="Message Coach"
                  placeholderTextColor={SUBTEXT}
                  multiline
                  style={s.input}
                  keyboardAppearance={isDark ? "dark" : "light"}
                />

                <TouchableOpacity
                  disabled={!input.trim() || isSending}
                  onPress={handleSend}
                  style={[
                    s.sendButton,
                    (!input.trim() || isSending) && s.sendDisabled,
                  ]}
                  activeOpacity={0.85}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color="#111" />
                  ) : (
                    <Feather name="arrow-up" size={17} color="#111" />
                  )}
                </TouchableOpacity>
              </View>
              <Text style={s.inputHint}>Uses your live plan and nutrition context</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
function makeStyles() {
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: BG },

    fullBackground: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 0,
    },
    fullOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.62)",
      zIndex: 0,
    },

    page: {
      flex: 1,
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: FOOTER_OFFSET + 18,
      zIndex: 1,
      backgroundColor: "transparent",
    },

    header: {
      paddingTop: 4,
      paddingBottom: 6,
      gap: 8,
    },
    headerMainRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    headerIdentity: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flex: 1,
      minWidth: 0,
    },
    headerAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PRIMARY,
    },
    headerTextBlock: { flex: 1, minWidth: 0 },
    headerTitle: {
      fontSize: 22,
      fontWeight: "800",
      color: TEXT,
      marginBottom: 1,
    },
    headerSubtitle: { color: SUBTEXT, fontSize: 12, lineHeight: 16 },
    contextBadgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    contextBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.05)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#232327",
    },
    contextBadgeText: {
      color: "#C7C7CC",
      fontSize: 11,
      fontWeight: "600",
    },
    contextSubline: {
      color: "#838389",
      fontSize: 11,
      lineHeight: 15,
    },

    headerActions: { flexDirection: "row", alignItems: "center" },
    clearBtn: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#29292D",
      backgroundColor: "#0F1012",
    },

    chatDayRow: {
      alignItems: "center",
      marginTop: 4,
      marginBottom: 6,
    },
    chatDayPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.06)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#25252A",
    },
    chatDayText: {
      color: "#B1B1B7",
      fontSize: 11,
      fontWeight: "700",
    },

    messagesScroll: { flex: 1, zIndex: 1, backgroundColor: "transparent" },
    messagesContent: { paddingBottom: FOOTER_OFFSET + 62, paddingTop: 2 },

    messageRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      marginVertical: 4,
      gap: 8,
    },
    coachAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PRIMARY,
      marginBottom: 2,
    },

    bubble: {
      maxWidth: "82%",
      borderRadius: 18,
      paddingHorizontal: 13,
      paddingVertical: 10,
    },
    bubbleCoach: {
      backgroundColor: "rgba(16,17,20,0.96)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#26272D",
      borderBottomLeftRadius: 6,
    },
    bubbleUser: {
      backgroundColor: "#1A210F",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(230,255,59,0.20)",
      borderBottomRightRadius: 6,
    },

    bubbleText: { color: TEXT, fontSize: 15, lineHeight: 21 },
    bubbleTextUser: { color: "#F5F7EA" },
    bubbleMetaRow: {
      marginTop: 6,
      alignItems: "flex-end",
    },
    bubbleTime: {
      fontSize: 10,
      color: "#76767D",
      fontWeight: "600",
    },
    bubbleTimeUser: {
      color: "#A7B08A",
    },

    typingBubble: {
      minWidth: 112,
    },
    typingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    typingText: { fontSize: 13, color: SUBTEXT },

    quickPromptWrap: {
      marginBottom: 10,
      paddingTop: 2,
    },
    quickPromptLabel: {
      fontSize: 11,
      color: SUBTEXT,
      fontWeight: "700",
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    quickPromptRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    quickPromptChip: {
      maxWidth: "100%",
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 16,
      backgroundColor: "rgba(255,255,255,0.04)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#23242A",
    },
    quickPromptText: {
      color: TEXT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },

    inputWrapper: {
      position: "absolute",
      left: 14,
      right: 14,
      bottom: FOOTER_OFFSET - 12,
      zIndex: 2,
    },
    inputShell: {
      gap: 6,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "flex-end",
      backgroundColor: "#101114",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#28292E",
      paddingLeft: 14,
      paddingRight: 8,
      paddingTop: 10,
      paddingBottom: 9,
      borderRadius: 24,
    },
    input: {
      flex: 1,
      color: TEXT,
      fontSize: 15,
      lineHeight: 20,
      padding: 0,
      minHeight: 26,
      maxHeight: 120,
    },
    inputHint: {
      fontSize: 11,
      color: "#7D7E84",
      textAlign: "center",
    },
    sendButton: {
      width: 38,
      height: 38,
      backgroundColor: PRIMARY,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 8,
      marginBottom: 1,
    },
    sendDisabled: { backgroundColor: "#5E624C" },
  });
}

```


## 6. Firebase Data Structure

The document shapes below are inferred from the Firestore reads/writes currently in the app and server routes. Values are redacted examples, not live user data.

### Collection map

```txt
users/{uid}
users/{uid}/stravaActivities/{activityId}
users/{uid}/plans/{planId}
users/{uid}/trainingPlans/{planId}
users/{uid}/planBuildJobs/{jobId}
users/{uid}/planPrefs/current
users/{uid}/sessionLogs/{sessionKey}
users/{uid}/trainSessions/{trainSessionId}
users/{uid}/weights/{weightId}
users/{uid}/meals/{mealId}
users/{uid}/nutrition/profile
users/{uid}/me/goals
users/{uid}/garmin_health/{kind_date}
users/{uid}/garmin_activities/{activityId}
users/{uid}/garmin_workout_syncs/{syncId}
users/{uid}/journalEntries/{dateKey}
public_profiles/{uid}
usernames/{username}
activities/{activityId}
```

### Example: `users/{uid}`

```json
{
  "displayName": "Redacted User",
  "email": "redacted@example.com",
  "welcomeSeen": true,
  "lastStravaSyncAt": "<Timestamp>",
  "integrations": {
    "garmin": {
      "connected": true,
      "garminUserId": "redacted"
    }
  }
}
```

Important fields: `welcomeSeen`, `lastStravaSyncAt`, `integrations.garmin.connected`, auth/profile fallbacks.
Stored or calculated: stored.

### Example: `public_profiles/{uid}`

```json
{
  "name": "Redacted User",
  "username": "redacted_user",
  "bio": "Hybrid athlete.",
  "sport": "Running",
  "location": "London, UK",
  "website": "https://example.com",
  "photoURL": "https://..."
}
```

Important fields: `name`, `username`, `bio`, `sport`, `location`, `website`, `photoURL`.
Stored or calculated: stored.

### Example: `users/{uid}/plans/{planId}` or `users/{uid}/trainingPlans/{planId}`

```json
{
  "title": "10K Build",
  "goal": "Improve 10K",
  "createdAt": "<Timestamp>",
  "updatedAt": "<Timestamp>",
  "weekStartDate": "2026-04-20",
  "weeks": [
    {
      "weekNumber": 1,
      "weekStartDate": "2026-04-20",
      "sessions": [
        {
          "sessionKey": "2026-04-22-run-easy",
          "type": "Run",
          "distanceKm": 8,
          "durationMin": 45
        }
      ]
    }
  ]
}
```

Important fields: `createdAt`, `updatedAt`, `weekStartDate`, `weeks[]`, session descriptors.
Stored or calculated: stored; progress against plan is calculated from `sessionLogs` and `trainSessions`.

### Example: `users/{uid}/sessionLogs/{sessionKey}`

```json
{
  "planId": "plan_abc123",
  "sessionKey": "2026-04-22-run-easy",
  "completedAt": "<Timestamp>",
  "status": "completed",
  "actualDistanceKm": 8.2,
  "actualDurationMin": 47,
  "source": "manual",
  "linkedActivityId": "1234567890"
}
```

Important fields: `planId`, `sessionKey`, `status`, completion timestamps, actual metrics, linked activity refs.
Stored or calculated: stored.

### Example: `users/{uid}/trainSessions/{trainSessionId}`

```json
{
  "planId": "plan_abc123",
  "completedAt": "<Timestamp>",
  "type": "Run",
  "targetDistanceKm": 8,
  "distanceKm": 8.2,
  "durationMin": 47,
  "live": {
    "distanceKm": 8.2,
    "durationSec": 2820
  }
}
```

Important fields: `planId`, completion fields, target vs actual metrics, nested live metrics.
Stored or calculated: stored.

### Example: `users/{uid}/stravaActivities/{activityId}`

```json
{
  "id": "1234567890",
  "name": "Morning Run",
  "type": "Run",
  "sport_type": "Run",
  "startDate": "2026-04-22T06:30:00Z",
  "startDateMs": 1776839400000,
  "distance": 10230,
  "distanceKm": 10.23,
  "moving_time": 2760,
  "movingTimeMin": 46,
  "average_heartrate": 152,
  "calories": 640
}
```

Important fields: timestamps, `type`, `distance/distanceKm`, moving time, heart-rate/calorie stats.
Stored or calculated: mostly stored from provider sync; some display fields are calculated in-app.

### Example: `activities/{activityId}`

```json
{
  "uid": "user_123",
  "userId": "user_123",
  "type": "Run",
  "title": "Tempo Session",
  "createdAt": "<Timestamp>",
  "distanceKm": 10,
  "durationMin": 44
}
```

Important fields: top-level social/activity feed data for history/progress views.
Stored or calculated: stored.

### Example: `users/{uid}/meals/{mealId}`

```json
{
  "date": "<Timestamp>",
  "mealType": "lunch",
  "name": "Chicken rice bowl",
  "calories": 640,
  "protein": 42,
  "carbs": 71,
  "fat": 18,
  "fiber": 9,
  "sugar": 7,
  "waterMl": 0,
  "source": "manual"
}
```

Important fields: `date`, macros, optional micros, water/source metadata.
Stored or calculated: stored; daily/weekly totals are calculated in-app.

### Example: `users/{uid}/nutrition/profile`

```json
{
  "caloriesTarget": 2600,
  "proteinTarget": 180,
  "carbTarget": 300,
  "fatTarget": 70,
  "goal": "maintain",
  "weightKg": 72.4
}
```

Important fields: calorie and macro targets, goal settings, sometimes current weight.
Stored or calculated: stored.

### Example: `users/{uid}/weights/{weightId}`

```json
{
  "date": "2026-04-24",
  "weightKg": 72.4,
  "createdAt": "<Timestamp>",
  "note": "AM fasted"
}
```

Important fields: `date`, `weightKg`, timestamps.
Stored or calculated: stored; trends are calculated in-app.

### Example: `users/{uid}/me/goals`

```json
{
  "weeklyRunDistanceKm": 40,
  "weeklySessions": 5,
  "updatedAt": "<Timestamp>"
}
```

Important fields: weekly targets used by me/goals screens.
Stored or calculated: stored.

### Example: best efforts / PBs

```json
{
  "storage": "No dedicated PB collection found in the current app surface",
  "source": "Calculated from synced activities, especially Strava activities"
}
```

Important fields: derived from activity distance/time data.
Stored or calculated: calculated in-app.

## 7. Current Metric Logic

These files contain the main logic currently used to derive profile/home/training metrics.

### src/hooks/useMePageData.js

```jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";

import { auth, db } from "../../firebaseConfig";

const STRAVA_CACHE_KEY = "strava_cached_activities_v1";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatKm(value) {
  return `${toNum(value, 0).toFixed(1)} km`;
}

function formatMinutes(value) {
  const mins = Math.round(toNum(value, 0));
  if (!mins) return "0 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatShortDate(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "—";
  }
}

function formatRelativeSync(ms) {
  if (!ms) return "Not synced yet";
  const dayMs = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((Date.now() - ms) / dayMs);
  if (deltaDays <= 0) return "Synced today";
  if (deltaDays === 1) return "Synced yesterday";
  return `Synced ${deltaDays} days ago`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfMonth(ms) {
  const date = new Date(ms);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isRunType(type) {
  return String(type || "").toLowerCase() === "run";
}

function deriveProgress(activities) {
  const todayStart = startOfToday();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const monthStartMs = startOfMonth(todayStart);

  const weekly = {
    workouts: 0,
    runs: 0,
    distanceKm: 0,
    timeMin: 0,
  };
  const monthly = {
    workouts: 0,
    distanceKm: 0,
    timeMin: 0,
  };
  const activeDays = new Set();

  activities.forEach((row) => {
    const startMs = toMillis(row.startDateMs || row.startDate || row.when);
    if (!startMs) return;

    const type = row.type || "Workout";
    const distanceKm = toNum(
      row.distanceKm ?? (toNum(row.distance, 0) > 1000 ? row.distance / 1000 : row.distance),
      0
    );
    const movingTimeMin = Math.round(
      toNum(row.movingTimeMin ?? row.moving_time / 60 ?? row.movingTime / 60, 0)
    );

    if (startMs >= weekStart) {
      weekly.workouts += 1;
      weekly.distanceKm += distanceKm;
      weekly.timeMin += movingTimeMin;
      if (isRunType(type)) weekly.runs += 1;
    }

    if (startMs >= monthStartMs) {
      monthly.workouts += 1;
      monthly.distanceKm += distanceKm;
      monthly.timeMin += movingTimeMin;
    }

    if (startMs >= todayStart - 13 * 24 * 60 * 60 * 1000) {
      activeDays.add(new Date(startMs).toISOString().slice(0, 10));
    }
  });

  return {
    weekly,
    monthly,
    activeDays14: activeDays.size,
    summaryMetrics: [
      { key: "week", label: "This week", value: `${weekly.workouts}` },
      { key: "distance", label: "Distance", value: formatKm(weekly.distanceKm) },
      { key: "month", label: "This month", value: `${monthly.workouts}` },
      { key: "consistency", label: "Consistency", value: `${activeDays.size}/14` },
    ],
  };
}

function deriveRecentActivities(activities) {
  return activities.slice(0, 2).map((activity) => {
    const whenMs = toMillis(activity.startDateMs || activity.startDate || activity.when);
    const distanceKm = toNum(
      activity.distanceKm ??
        (toNum(activity.distance, 0) > 1000 ? activity.distance / 1000 : activity.distance),
      0
    );
    const movingTimeMin = Math.round(
      toNum(activity.movingTimeMin ?? activity.moving_time / 60 ?? activity.movingTime / 60, 0)
    );

    return {
      ...activity,
      whenLabel: formatShortDate(whenMs),
      meta: [
        activity.type || "Workout",
        distanceKm > 0 ? formatKm(distanceKm) : null,
        movingTimeMin > 0 ? formatMinutes(movingTimeMin) : null,
      ]
        .filter(Boolean)
        .join(" • "),
    };
  });
}

function buildSupportingLine(profile) {
  if (profile?.bio) return profile.bio.trim();
  const fallback = [profile?.sport, profile?.location].filter(Boolean);
  if (fallback.length) return fallback.join(" • ");
  return "Personal progress";
}

function buildStatusDetail(integrations) {
  const connected = [
    integrations?.stravaConnected ? "Strava" : null,
    integrations?.garminConnected ? "Garmin" : null,
  ].filter(Boolean);

  if (connected.length === 2) return "Strava and Garmin connected";
  if (connected.length === 1) return `${connected[0]} connected`;
  return "Connect your training accounts";
}

export function useMePageData() {
  const user = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [integrations, setIntegrations] = useState({
    stravaConnected: false,
    garminConnected: false,
    lastStravaSyncMs: 0,
  });
  const [activities, setActivities] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setProfile(null);
        setActivities([]);
        setLoading(false);
        return;
      }

      const [stravaConnectedRaw, cachedRaw, userSnap, publicProfileSnap, activitiesSnap] =
        await Promise.all([
          AsyncStorage.getItem("strava_connected"),
          AsyncStorage.getItem(STRAVA_CACHE_KEY),
          getDoc(doc(db, "users", uid)),
          getDoc(doc(db, "public_profiles", uid)),
          getDocs(
            query(
              collection(db, "users", uid, "stravaActivities"),
              orderBy("startDate", "desc"),
              limit(40)
            )
          ),
        ]);

      let cachedSyncMs = 0;
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          cachedSyncMs = toMillis(cached?.cachedAtISO);
        } catch {}
      }

      const userData = userSnap.exists() ? userSnap.data() || {} : {};
      const publicProfile = publicProfileSnap.exists()
        ? publicProfileSnap.data() || {}
        : {};

      const nextProfile = {
        name: user?.displayName || publicProfile?.name || "Your account",
        email: user?.email || "No email",
        username: publicProfile?.username || publicProfile?.handle || "",
        sport: publicProfile?.sport || "",
        location: publicProfile?.location || "",
        bio: publicProfile?.bio || "",
        photoURL: user?.photoURL || publicProfile?.photoURL || "",
      };

      const nextIntegrations = {
        stravaConnected: stravaConnectedRaw === "1",
        garminConnected: userData?.integrations?.garmin?.connected === true,
        lastStravaSyncMs:
          toMillis(userData?.lastStravaSyncAt) || cachedSyncMs || 0,
      };

      setProfile({
        ...nextProfile,
        supportLine: buildSupportingLine(nextProfile),
        statusDetail: buildStatusDetail(nextIntegrations),
      });
      setIntegrations(nextIntegrations);
      setActivities(activitiesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    } catch (e) {
      setError(String(e?.message || e || "Failed to load your profile"));
    } finally {
      setLoading(false);
    }
  }, [user?.displayName, user?.email, user?.photoURL]);

  useEffect(() => {
    load();
  }, [load]);

  const progress = useMemo(() => deriveProgress(activities), [activities]);
  const recentActivities = useMemo(
    () => deriveRecentActivities(activities),
    [activities]
  );

  const integrationRows = useMemo(
    () => [
      {
        key: "strava",
        label: "Strava",
        value: integrations.stravaConnected ? "Connected" : "Not connected",
        meta: integrations.stravaConnected
          ? formatRelativeSync(integrations.lastStravaSyncMs)
          : "Connect in Settings",
      },
      {
        key: "garmin",
        label: "Garmin",
        value: integrations.garminConnected ? "Connected" : "Not connected",
        meta: integrations.garminConnected
          ? "Included in your account"
          : "Manage in Profile",
      },
    ],
    [
      integrations.garminConnected,
      integrations.lastStravaSyncMs,
      integrations.stravaConnected,
    ]
  );

  const deeperLinks = useMemo(
    () => [
      {
        key: "analytics",
        label: "Analytics",
        meta: "Deeper trends and comparisons",
        value: "Soon",
      },
      {
        key: "goals",
        label: "Goals",
        meta: "Targets and progress",
        path: "/me/goals",
      },
      {
        key: "prs",
        label: "PRs",
        meta: "Personal bests",
        path: "/me/prs",
      },
      {
        key: "calendar",
        label: "Calendar",
        meta: "Training history and schedule",
        path: "/me/calendar",
      },
    ],
    []
  );

  return {
    loading,
    error,
    profile,
    progress,
    recentActivities,
    integrationRows,
    deeperLinks,
    refresh: load,
  };
}

export default useMePageData;

```

### src/hooks/useHomeDashboardData.js

```jsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebaseConfig";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOME_DASHBOARD_CACHE = new Map();

function startOfISOWeek(input) {
  const d = new Date(input);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(input, n) {
  const d = new Date(input);
  d.setDate(d.getDate() + n);
  return d;
}

function toISODateLocal(input) {
  const d = new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayOfMonth(iso) {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "--";
  return String(parsed.getDate()).padStart(2, "0");
}

function toNumOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDateLike(raw) {
  if (!raw) return null;
  if (typeof raw?.toDate === "function") {
    const out = raw.toDate();
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  if (raw instanceof Date) {
    const out = new Date(raw);
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  const ymdMatch = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const out = new Date(
      Number(ymdMatch[1]),
      Number(ymdMatch[2]) - 1,
      Number(ymdMatch[3])
    );
    out.setHours(0, 0, 0, 0);
    return Number.isNaN(out.getTime()) ? null : out;
  }
  const out = new Date(raw);
  if (Number.isNaN(out.getTime())) return null;
  out.setHours(0, 0, 0, 0);
  return out;
}

function inferPlanKindFromDoc(planDoc) {
  const kind = String(planDoc?.kind || "").toLowerCase();
  const source = String(planDoc?.source || "").toLowerCase();
  const primary = String(
    planDoc?.primaryActivity || planDoc?.meta?.primaryActivity || ""
  ).toLowerCase();

  if (
    kind === "run" ||
    primary.includes("run") ||
    source.includes("generate-run") ||
    source.includes("run")
  ) {
    return "run";
  }

  if (
    kind === "strength" ||
    primary.includes("strength") ||
    primary.includes("gym") ||
    source.includes("generate-strength") ||
    source.includes("strength")
  ) {
    return "strength";
  }

  return kind || "training";
}

function normaliseSessionForPlan(session) {
  const value = session && typeof session === "object" ? session : {};
  return {
    ...value,
    title:
      value.title ||
      value.name ||
      value.sessionName ||
      value.sessionType ||
      value.type ||
      "Session",
  };
}

function normaliseWeeksForClient(weeks) {
  return (weeks || []).map((w, wi) => {
    const rawDays = Array.isArray(w?.days) ? w.days : [];
    const dayMap = new Map(rawDays.map((d) => [d?.day, d]));

    const days = DAY_ORDER.map((dayLabel, dayIdx) => {
      const d = dayMap.get(dayLabel) || { day: dayLabel, sessions: [] };
      const sessions = (Array.isArray(d?.sessions) ? d.sessions : [])
        .map(normaliseSessionForPlan)
        .filter(Boolean);

      return {
        day: dayLabel,
        sessions,
        date: rawDays?.[dayIdx]?.date || dayMap.get(dayLabel)?.date || null,
      };
    });

    return {
      title: w?.title || `Week ${wi + 1}`,
      weekIndex0: typeof w?.weekIndex0 === "number" ? w.weekIndex0 : wi,
      weekNumber: typeof w?.weekNumber === "number" ? w.weekNumber : wi + 1,
      weekStartDate: w?.weekStartDate || w?.startDate || null,
      weekEndDate: w?.weekEndDate || w?.endDate || null,
      days,
    };
  });
}

function normalisePlanDoc(snapDoc) {
  const data = snapDoc?.data?.() || {};
  const rawPlan = data.plan || {};
  const weeksRaw = rawPlan.weeks || data.weeks || [];
  const kind = data?.kind || rawPlan?.kind || "training";
  const nameFromMeta = data?.meta?.name;
  const nameFromPlan = rawPlan?.name;
  const nameFromData = data?.name;
  const primaryActivity =
    data?.meta?.primaryActivity ||
    data?.primaryActivity ||
    rawPlan?.primaryActivity ||
    (kind === "run" ? "Run" : kind === "strength" ? "Strength" : "Training");

  return {
    id: snapDoc.id,
    ...data,
    kind,
    name: nameFromMeta || nameFromPlan || nameFromData || "Training Plan",
    primaryActivity,
    weeks: normaliseWeeksForClient(weeksRaw),
  };
}

function resolvePlanWeekZeroStart(planDoc, sessionLogMap = null) {
  if (!planDoc) return null;

  const planId = String(planDoc?.id || "").trim();
  if (planId && sessionLogMap && typeof sessionLogMap === "object") {
    const anchorVotes = new Map();
    Object.values(sessionLogMap).forEach((log) => {
      if (String(log?.planId || "").trim() !== planId) return;
      const weekIndex = Number(log?.weekIndex);
      const dayIndex = Number(log?.dayIndex);
      if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return;

      const logDate =
        parseDateLike(log?.date) ||
        parseDateLike(log?.statusAt) ||
        parseDateLike(log?.completedAt) ||
        parseDateLike(log?.updatedAt) ||
        parseDateLike(log?.createdAt);
      if (!logDate) return;

      const anchor = addDays(
        logDate,
        -(Math.round(weekIndex) * 7 + Math.round(dayIndex))
      );
      anchor.setHours(0, 0, 0, 0);
      const key = toISODateLocal(anchor);
      anchorVotes.set(key, (anchorVotes.get(key) || 0) + 1);
    });

    if (anchorVotes.size) {
      const sorted = [...anchorVotes.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]));
      });
      const parsed = parseDateLike(sorted[0]?.[0]);
      if (parsed) return startOfISOWeek(parsed);
    }
  }

  const weeks = Array.isArray(planDoc?.weeks) ? planDoc.weeks : [];
  for (let idx = 0; idx < weeks.length; idx += 1) {
    const week = weeks[idx];
    const weekIndex0 = Number.isFinite(Number(week?.weekIndex0))
      ? Number(week.weekIndex0)
      : idx;
    const explicitWeekStart = parseDateLike(week?.weekStartDate || week?.startDate);
    if (explicitWeekStart) {
      return startOfISOWeek(addDays(explicitWeekStart, -(weekIndex0 * 7)));
    }

    const days = Array.isArray(week?.days) ? week.days : [];
    for (let dayIdx = 0; dayIdx < days.length; dayIdx += 1) {
      const explicitDayDate = parseDateLike(days[dayIdx]?.date || days[dayIdx]?.isoDate);
      if (explicitDayDate) {
        return startOfISOWeek(addDays(explicitDayDate, -(weekIndex0 * 7 + dayIdx)));
      }
    }
  }

  const fallbackStart = parseDateLike(
    planDoc?.startDate ||
      planDoc?.plan?.startDate ||
      planDoc?.meta?.startDate ||
      planDoc?.weekStartDate ||
      planDoc?.plan?.weekStartDate ||
      planDoc?.createdAt ||
      planDoc?.updatedAt
  );
  return fallbackStart ? startOfISOWeek(fallbackStart) : null;
}

function deriveCurrentPlanWeekIndex(
  plans,
  today = new Date(),
  totalWeeks = 0,
  sessionLogMap = null
) {
  const anchors = (Array.isArray(plans) ? plans : [])
    .map((planDoc) => resolvePlanWeekZeroStart(planDoc, sessionLogMap))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!anchors.length) return 0;

  const baseWeekStart = anchors[0];
  const todayWeekStart = startOfISOWeek(today);
  const diffDays = Math.floor(
    (todayWeekStart.getTime() - baseWeekStart.getTime()) / 86400000
  );
  const rawWeekIndex = Math.floor(diffDays / 7);
  const clamped = Math.max(0, rawWeekIndex);

  if (totalWeeks > 0) return Math.min(clamped, totalWeeks - 1);
  return clamped;
}

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function resolveSessionLogStatus(log) {
  const raw = String(log?.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "skipped") return raw;
  if (log?.skippedAt) return "skipped";
  if (log?.completedAt || log?.lastTrainSessionId) return "completed";
  return "";
}

function sumSessionMeta(sess) {
  const durationMin =
    sess?.workout?.totalDurationSec != null
      ? Math.round(sess.workout.totalDurationSec / 60)
      : sess?.targetDurationMin ?? sess?.durationMin ?? null;

  const distanceKm =
    sess?.workout?.totalDistanceKm != null
      ? sess.workout.totalDistanceKm
      : sess?.targetDistanceKm ?? sess?.distanceKm ?? sess?.plannedDistanceKm ?? null;

  const parts = [];
  if (durationMin) parts.push(`${durationMin}m`);
  if (distanceKm) parts.push(`${Number(distanceKm).toFixed(1)}k`);
  return parts.join(" · ");
}

function sessionTypeLabel(sess) {
  const t = String(sess?.sessionType || sess?.type || "training").toLowerCase();
  if (t === "run") return "Run";
  if (t === "gym" || t.includes("strength")) return "Strength";
  if (t.includes("hyrox")) return "Hyrox";
  if (t.includes("mob")) return "Mobility";
  if (t.includes("rest")) return "Rest";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function isResolvedSessionStatus(status) {
  return status === "completed" || status === "skipped";
}

function pickPriorityCard(cards) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return { card: null, index: -1 };
  const pendingIndex = list.findIndex((card) => !isResolvedSessionStatus(card?.status));
  const resolvedIndex = pendingIndex >= 0 ? pendingIndex : 0;
  return {
    card: list[resolvedIndex] || null,
    index: resolvedIndex,
  };
}

function sessionDistanceKm(session) {
  return (
    toNumOrNull(session?.workout?.totalDistanceKm) ??
    toNumOrNull(session?.targetDistanceKm) ??
    toNumOrNull(session?.distanceKm) ??
    toNumOrNull(session?.plannedDistanceKm)
  );
}

function sessionDurationMin(session) {
  const fromWorkoutSec = toNumOrNull(session?.workout?.totalDurationSec);
  if (fromWorkoutSec != null) return Math.round(fromWorkoutSec / 60);
  return toNumOrNull(session?.targetDurationMin) ?? toNumOrNull(session?.durationMin);
}

function isQualitySession(session) {
  const text = `${session?.title || ""} ${session?.sessionType || ""} ${session?.type || ""}`.toLowerCase();
  return /(tempo|interval|threshold|speed|hill|fartlek|quality)/.test(text);
}

function isStrengthSession(session) {
  const text = `${session?.title || ""} ${session?.sessionType || ""} ${session?.type || ""}`.toLowerCase();
  return /(strength|gym|hyrox|bodyweight)/.test(text);
}

function sessionEffortLabel(session) {
  if (isQualitySession(session)) return "Controlled hard";
  if (isStrengthSession(session)) return "Strength focus";
  return "Easy / aerobic";
}

function sessionSecondaryText(session) {
  if (!session) return "No session planned";
  if (isStrengthSession(session)) return "Strength";
  if (isQualitySession(session)) return "Quality";
  return "Aerobic";
}

function buildTodayHero(todayData, weekLabel) {
  const session = todayData?.session || null;
  const status = String(todayData?.status || "").toLowerCase();
  const completed = status === "completed";

  if (!session) {
    return {
      eyebrow: weekLabel || "This week",
      title: "Recovery / reset day",
      subtitle: "No structured workout is planned for today.",
      meta: ["Recovery", "Optional mobility"],
      ctaLabel: "Open calendar",
      secondaryLabel: null,
      completed: false,
      key: null,
      savedTrainSessionId: null,
      status: "",
    };
  }

  const duration = sessionDurationMin(session);
  const distance = sessionDistanceKm(session);
  const meta = [];
  if (duration != null && duration > 0) meta.push(`${Math.round(duration)} min`);
  if (distance != null && distance > 0) meta.push(`${distance.toFixed(1)} km`);
  meta.push(sessionEffortLabel(session));

  return {
    eyebrow: todayData?.dayLabel || weekLabel || "Today",
    title: todayData?.title || session?.title || "Today's session",
    subtitle:
      completed
        ? "Today's workout is already logged."
        : todayData?.subtitle || sessionSecondaryText(session),
    meta,
    ctaLabel: completed ? "View session" : "Start session",
    secondaryLabel: "Calendar",
    completed,
    key: todayData?.key || null,
    savedTrainSessionId: todayData?.savedTrainSessionId || null,
    status,
  };
}

function buildInsight(todayData) {
  const session = todayData?.session || null;
  const status = String(todayData?.status || "").toLowerCase();
  const completed = status === "completed";
  const duration = sessionDurationMin(session);
  const distance = sessionDistanceKm(session);

  if (completed) {
    return {
      type: "coach",
      eyebrow: "Coach note",
      title: "Recovery now sets up the next session",
      body: "Today's work is done. Log how it felt, refuel, and protect tonight's recovery so tomorrow starts fresh.",
    };
  }

  if ((duration != null && duration >= 75) || (distance != null && distance >= 12)) {
    return {
      type: "fuel",
      eyebrow: "Fuel",
      title: "Support the longer session",
      body: "Take in carbs before you head out, start controlled, and bring fluids if the run stretches beyond the first hour.",
    };
  }

  if (isQualitySession(session)) {
    return {
      type: "readiness",
      eyebrow: "Execution",
      title: "Hit targets, not hero pace",
      body: "Treat the quality as controlled work. Good reps and repeatable form matter more than forcing the session.",
    };
  }

  return {
    type: "coach",
    eyebrow: "Coach note",
    title: "Keep today disciplined",
    body: session
      ? "Stay honest on the prescribed effort. The value comes from consistency and leaving the session feeling composed."
      : "Use the lighter day to stay mobile and protect consistency across the week.",
  };
}

function buildGreeting(now) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatLongDate(now) {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function buildInitialState() {
  const now = new Date();
  return {
    loading: true,
    refreshing: false,
    loadError: "",
    hasPlan: false,
    greeting: buildGreeting(now),
    dateLabel: formatLongDate(now),
    statusLabel: "Loading",
    weekLabel: "This week",
    metrics: [
      { label: "Week total", value: "—" },
      { label: "Sessions", value: "—" },
      { label: "Weight", value: "—" },
    ],
    timeline: [],
    todayHero: {
      eyebrow: "Today",
      title: "Loading your next session",
      subtitle: "Checking your active plan and session status.",
      meta: [],
      ctaLabel: "Open today",
      secondaryLabel: "Calendar",
      completed: false,
      key: null,
      savedTrainSessionId: null,
      status: "",
    },
    insight: null,
    calendarDays: [],
  };
}

export function useHomeDashboardData(options = {}) {
  const currentUid = String(auth.currentUser?.uid || "");
  const requestedWeekOffset = Number.isFinite(Number(options?.weekOffset))
    ? Math.round(Number(options.weekOffset))
    : 0;
  const cacheKey = `${currentUid}::${requestedWeekOffset}`;
  const hasWarmCache =
    !!currentUid && HOME_DASHBOARD_CACHE.has(cacheKey);
  const [state, setState] = useState(() =>
    hasWarmCache ? HOME_DASHBOARD_CACHE.get(cacheKey) : buildInitialState()
  );

  const load = useCallback(async ({ silent = false } = {}) => {
    setState((prev) => ({
      ...prev,
      loading: silent ? prev.loading : true,
      refreshing: silent,
    }));

    const uid = auth.currentUser?.uid;
    const now = new Date();

    if (!uid) {
      const nextState = {
        ...buildInitialState(),
        loading: false,
        refreshing: false,
        loadError: "Sign in to load your training dashboard.",
        hasPlan: false,
        greeting: buildGreeting(now),
        dateLabel: formatLongDate(now),
        statusLabel: "Signed out",
      };
      HOME_DASHBOARD_CACHE.set(cacheKey, nextState);
      setState(nextState);
      return;
    }

    try {
      const partialErrors = [];

      const plansRef = collection(db, "users", uid, "plans");
      const plansSnap = await getDocs(query(plansRef, orderBy("updatedAt", "desc"), limit(30)));
      const docs = plansSnap.docs.map(normalisePlanDoc).filter((d) => d?.id);

      if (!docs.length) {
        const nextState = {
          ...buildInitialState(),
          loading: false,
          refreshing: false,
          hasPlan: false,
          greeting: buildGreeting(now),
          dateLabel: formatLongDate(now),
          statusLabel: "No plan",
          loadError: "",
          timeline: [],
          calendarDays: [],
        };
        HOME_DASHBOARD_CACHE.set(cacheKey, nextState);
        setState(nextState);
        return;
      }

      const run = docs.find((d) => inferPlanKindFromDoc(d) === "run") || null;
      const strength = docs.find((d) => inferPlanKindFromDoc(d) === "strength") || null;

      let primary = null;
      let companion = null;
      if (run) {
        primary = run;
        companion = strength && strength.id !== run.id ? strength : null;
      } else if (strength) {
        primary = strength;
        companion =
          docs.find(
            (d) =>
              d.id !== strength.id &&
              inferPlanKindFromDoc(d) !== inferPlanKindFromDoc(strength)
          ) || null;
      } else {
        primary = docs[0] || null;
        companion = docs[1] || null;
      }

      const resolvedCompanion =
        companion && primary && companion.id !== primary.id ? companion : null;
      const activePlanIds = [primary?.id, resolvedCompanion?.id].filter(Boolean);

      const sessionLogMap = {};
      if (activePlanIds.length) {
        try {
          const ref = collection(db, "users", uid, "sessionLogs");
          for (let idx = 0; idx < activePlanIds.length; idx += 10) {
            const ids = activePlanIds.slice(idx, idx + 10);
            const snap = await getDocs(query(ref, where("planId", "in", ids)));
            snap.forEach((docSnap) => {
              sessionLogMap[docSnap.id] = docSnap.data() || {};
            });
          }
        } catch {
          partialErrors.push("session_logs");
        }
      }

      let weightKg = null;
      try {
        const weightsRef = collection(db, "users", uid, "weights");
        let latestWeightSnap = await getDocs(
          query(weightsRef, orderBy("date", "desc"), limit(1))
        );
        if (latestWeightSnap.empty) {
          latestWeightSnap = await getDocs(
            query(weightsRef, orderBy("createdAt", "desc"), limit(1))
          );
        }
        if (!latestWeightSnap.empty) {
          const d = latestWeightSnap.docs[0].data() || {};
          weightKg =
            toNumOrNull(d.weight) ??
            toNumOrNull(d.value) ??
            toNumOrNull(d.weightKg);
        }
      } catch {
        partialErrors.push("weight");
      }

      if (weightKg == null) {
        try {
          const profileSnap = await getDoc(doc(db, "users", uid, "nutrition", "profile"));
          if (profileSnap.exists()) {
            weightKg = toNumOrNull(profileSnap.data()?.weightKg);
          }
        } catch {}
      }

      const visibleWeeksCount = Math.max(
        primary?.weeks?.length || 0,
        resolvedCompanion?.weeks?.length || 0,
        1
      );
      const currentWeekIndex = deriveCurrentPlanWeekIndex(
        [primary, resolvedCompanion],
        now,
        visibleWeeksCount,
        sessionLogMap
      );
      const displayWeekIndex = Math.max(
        0,
        Math.min(currentWeekIndex + requestedWeekOffset, visibleWeeksCount - 1)
      );

      const mergedWeek = {
        title:
          primary?.weeks?.[displayWeekIndex]?.title ||
          resolvedCompanion?.weeks?.[displayWeekIndex]?.title ||
          `Week ${displayWeekIndex + 1}`,
        days: DAY_ORDER.map((day) => ({ day, sessions: [] })),
      };

      const appendFromPlan = (srcPlan) => {
        if (!srcPlan?.id) return;
        const srcWeek = srcPlan?.weeks?.[displayWeekIndex];
        if (!srcWeek?.days?.length) return;
        srcWeek.days.forEach((day, dayIdx) => {
          const resolvedDayIndex = DAY_ORDER.indexOf(String(day?.day || ""));
          const safeDayIndex = resolvedDayIndex >= 0 ? resolvedDayIndex : dayIdx;
          const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
          sessions.forEach((sess, sessIdx) => {
            mergedWeek.days[safeDayIndex].sessions.push({
              ...sess,
              __sourcePlanId: srcPlan.id,
              __sourceWeekIndex: displayWeekIndex,
              __sourceDayIndex: safeDayIndex,
              __sourceSessionIndex: sessIdx,
            });
          });
        });
      };

      appendFromPlan(primary);
      appendFromPlan(resolvedCompanion);

      const planWeekZeroStart =
        [primary, resolvedCompanion]
          .map((planDoc) => resolvePlanWeekZeroStart(planDoc, sessionLogMap))
          .filter(Boolean)
          .sort((a, b) => a.getTime() - b.getTime())[0] || startOfISOWeek(now);

      const todayIso = toISODateLocal(now);
      const todayDayLabel = JS_DAY_LABELS[now.getDay()];
      const todayDayIndex = Math.max(0, DAY_ORDER.indexOf(todayDayLabel));

      const calendarDays = mergedWeek.days.map((d, dayIdx) => {
        const date = addDays(planWeekZeroStart, displayWeekIndex * 7 + dayIdx);
        const isoDate = toISODateLocal(date);
        const cards = (Array.isArray(d.sessions) ? d.sessions : []).map((sess, sessIdx) => {
          const keyPlanId = sess?.__sourcePlanId || primary?.id || null;
          const keyWeekIndex = Number.isFinite(Number(sess?.__sourceWeekIndex))
            ? Number(sess.__sourceWeekIndex)
            : displayWeekIndex;
          const keyDayIndex = Number.isFinite(Number(sess?.__sourceDayIndex))
            ? Number(sess.__sourceDayIndex)
            : dayIdx;
          const keySessionIndex = Number.isFinite(Number(sess?.__sourceSessionIndex))
            ? Number(sess.__sourceSessionIndex)
            : sessIdx;
          const key = keyPlanId
            ? buildSessionKey(keyPlanId, keyWeekIndex, keyDayIndex, keySessionIndex)
            : null;
          const log = key ? sessionLogMap[key] || null : null;
          const status = resolveSessionLogStatus(log);
          const savedTrainSessionId =
            String(log?.lastTrainSessionId || "").trim() || null;

          return {
            sess,
            title:
              sess?.title ||
              sess?.name ||
              sess?.sessionType ||
              sess?.type ||
              "Session",
            meta: sumSessionMeta(sess),
            key,
            log,
            status,
            savedTrainSessionId,
          };
        });

        const firstCard = pickPriorityCard(cards).card;
        return {
          day: d.day,
          date: formatDayOfMonth(isoDate),
          isoDate,
          isToday: isoDate === todayIso,
          sessions: d.sessions,
          cards,
          state:
            isoDate === todayIso
              ? "today"
              : cards.some((card) => card.status === "completed")
                ? "completed"
                : cards.length
                  ? "upcoming"
                  : "rest",
          label:
            firstCard?.meta ||
            firstCard?.title ||
            (cards.some((card) => card.status === "completed")
              ? "Completed"
              : cards.length
                ? sessionTypeLabel(cards[0]?.sess)
                : "Rest"),
        };
      });

      const todayDay = calendarDays[todayDayIndex] || null;
      const todayCard = pickPriorityCard(todayDay?.cards || []).card;
      const todayData = {
        dayLabel: todayDay?.day || "Today",
        key: todayCard?.key || null,
        title: todayCard?.title || "Rest / optional movement",
        subtitle:
          todayCard?.meta ||
          (todayCard ? "" : "No structured session planned"),
        status: String(todayCard?.status || "").toLowerCase(),
        savedTrainSessionId: todayCard?.savedTrainSessionId || null,
        session: todayCard?.sess || null,
      };

      const sessionsPlanned = calendarDays.reduce(
        (sum, day) => sum + (Array.isArray(day.cards) ? day.cards.length : 0),
        0
      );
      const sessionsCompleted = calendarDays.reduce(
        (sum, day) => sum + day.cards.filter((card) => card.status === "completed").length,
        0
      );
      const plannedKm = calendarDays.reduce(
        (sum, day) =>
          sum +
          day.cards.reduce(
            (inner, card) => inner + (sessionDistanceKm(card?.sess) || 0),
            0
          ),
        0
      );

      const todayHero = buildTodayHero(todayData, mergedWeek.title);
      const insight = buildInsight(todayData);
      const statusLabel = !todayData.session
        ? "Recovery day"
        : todayHero.completed
          ? "Completed today"
          : "Today's session";

      const nextState = {
        loading: false,
        refreshing: false,
        loadError: partialErrors.length
          ? "Some live data could not be loaded. Showing what is available."
          : "",
        hasPlan: true,
        greeting: buildGreeting(now),
        dateLabel: formatLongDate(now),
        statusLabel,
        weekLabel: mergedWeek.title,
        metrics: [
          {
            label: "Week total",
            value: plannedKm > 0 ? `${plannedKm.toFixed(1)} km` : "—",
          },
          {
            label: "Sessions",
            value: sessionsPlanned > 0
              ? `${sessionsCompleted} / ${sessionsPlanned}`
              : "0 / 0",
          },
          {
            label: "Weight",
            value: weightKg != null ? `${weightKg.toFixed(1)} kg` : "—",
          },
        ],
        timeline: calendarDays.map((day) => ({
          day: day.day,
          date: day.date,
          isoDate: day.isoDate,
          state: day.state,
          label: day.label,
        })),
        todayHero,
        insight,
        calendarDays,
        currentWeekIndex,
        displayWeekIndex,
        visibleWeeksCount,
      };
      HOME_DASHBOARD_CACHE.set(cacheKey, nextState);
      setState(nextState);
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        greeting: buildGreeting(now),
        dateLabel: formatLongDate(now),
        loadError: "Could not load your home dashboard right now.",
      }));
    }
  }, [cacheKey, requestedWeekOffset]);

  useEffect(() => {
    if (!currentUid) {
      setState(buildInitialState());
      return;
    }

    if (HOME_DASHBOARD_CACHE.has(cacheKey)) {
      setState(HOME_DASHBOARD_CACHE.get(cacheKey));
      return;
    }

    load({ silent: false });
  }, [cacheKey, currentUid, load]);

  const actions = useMemo(
    () => [
      { key: "calendar", label: "Calendar", path: "/home/calendar" },
      { key: "coach", label: "Coach", path: "/chat" },
      { key: "fuel", label: "Fuel", path: "/nutrition/fuelmatch" },
    ],
    []
  );

  return {
    ...state,
    quickActions: actions,
    canGoPrevWeek:
      Number.isFinite(Number(state.displayWeekIndex)) && Number(state.displayWeekIndex) > 0,
    canGoNextWeek:
      Number.isFinite(Number(state.displayWeekIndex)) &&
      Number.isFinite(Number(state.visibleWeeksCount)) &&
      Number(state.displayWeekIndex) < Number(state.visibleWeeksCount) - 1,
    refresh: () => load({ silent: true }),
    reload: () => load({ silent: false }),
  };
}

export default useHomeDashboardData;

```

### src/hooks/useProfilePageData.js

```jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { auth, db } from "../../firebaseConfig";

const STRAVA_CACHE_KEY = "strava_cached_activities_v1";
const AVATAR_FOLDER = "avatars";
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatRelativeSync(ms) {
  if (!ms) return "Not synced yet";
  const dayMs = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((Date.now() - ms) / dayMs);
  if (deltaDays <= 0) return "Synced today";
  if (deltaDays === 1) return "Synced yesterday";
  return `Synced ${deltaDays} days ago`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeUsername(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "");
}

function normalizeWebsite(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function buildSupportLine(values) {
  const bio = cleanText(values?.bio);
  if (bio) return bio;
  const parts = [cleanText(values?.sport), cleanText(values?.location)].filter(Boolean);
  if (parts.length) return parts.join(" • ");
  return "Edit how you appear in the app";
}

function validateValues(values) {
  const next = {};
  const name = cleanText(values.name);
  const username = normalizeUsername(values.username);
  const bio = cleanText(values.bio);
  const websiteRaw = cleanText(values.website);

  if (!name) {
    next.name = "Name is required.";
  } else if (name.length < 2) {
    next.name = "Name should be at least 2 characters.";
  }

  if (username && !USERNAME_RE.test(username)) {
    next.username = "Use 3-20 lowercase letters, numbers, dots, or underscores.";
  }

  if (bio.length > 160) {
    next.bio = "Bio should stay under 160 characters.";
  }

  if (websiteRaw) {
    try {
      const url = new URL(normalizeWebsite(websiteRaw));
      if (!/^https?:$/i.test(url.protocol)) {
        next.website = "Website must use http or https.";
      }
    } catch {
      next.website = "Enter a valid website URL.";
    }
  }

  return next;
}

function normalizeForSave(values) {
  return {
    name: cleanText(values.name),
    username: normalizeUsername(values.username),
    bio: cleanText(values.bio),
    sport: cleanText(values.sport),
    location: cleanText(values.location),
    website: normalizeWebsite(values.website),
  };
}

function sameValues(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function isUsernameAvailable(uid, username) {
  if (!username) return true;
  const snap = await getDocs(
    query(collection(db, "public_profiles"), where("username", "==", username), limit(2))
  );
  return snap.docs.every((entry) => entry.id === uid);
}

export function useProfilePageData() {
  const user = auth.currentUser;
  const storage = getStorage();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState({
    name: "",
    username: "",
    bio: "",
    sport: "",
    location: "",
    website: "",
    email: "",
    photoURL: "",
  });
  const [initialValues, setInitialValues] = useState(null);
  const [localAvatarUri, setLocalAvatarUri] = useState("");
  const [touched, setTouched] = useState({});
  const [saveState, setSaveState] = useState("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [integrations, setIntegrations] = useState({
    stravaConnected: false,
    garminConnected: false,
    lastStravaSyncMs: 0,
  });

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setInitialValues(null);
        setLoading(false);
        return;
      }

      const [userSnap, publicProfileSnap, stravaConnectedRaw, cachedRaw] =
        await Promise.all([
          getDoc(doc(db, "users", uid)),
          getDoc(doc(db, "public_profiles", uid)),
          AsyncStorage.getItem("strava_connected"),
          AsyncStorage.getItem(STRAVA_CACHE_KEY),
        ]);

      let cachedSyncMs = 0;
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          cachedSyncMs = toMillis(cached?.cachedAtISO);
        } catch {}
      }

      const userData = userSnap.exists() ? userSnap.data() || {} : {};
      const profileData = publicProfileSnap.exists() ? publicProfileSnap.data() || {} : {};

      const nextValues = {
        name: user?.displayName || profileData?.name || "",
        username: profileData?.username || profileData?.handle || "",
        bio: profileData?.bio || "",
        sport: profileData?.sport || "",
        location: profileData?.location || "",
        website: profileData?.website || "",
        email: user?.email || "",
        photoURL: user?.photoURL || profileData?.photoURL || "",
      };

      setValues(nextValues);
      setInitialValues(normalizeForSave(nextValues));
      setLocalAvatarUri("");
      setTouched({});
      setSaveState("idle");
      setSaveMessage("");

      setIntegrations({
        stravaConnected: stravaConnectedRaw === "1",
        garminConnected: userData?.integrations?.garmin?.connected === true,
        lastStravaSyncMs: toMillis(userData?.lastStravaSyncAt) || cachedSyncMs || 0,
      });
    } catch (error) {
      setLoadError(String(error?.message || error || "Could not load your profile."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.displayName, user?.email, user?.photoURL]);

  useEffect(() => {
    load();
  }, [load]);

  const normalizedValues = useMemo(() => normalizeForSave(values), [values]);
  const errors = useMemo(() => validateValues(values), [values]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty =
    !!initialValues &&
    (!sameValues(initialValues, normalizedValues) || !!localAvatarUri);

  const fieldErrors = useMemo(() => {
    const next = {};
    Object.keys(errors).forEach((key) => {
      if (touched[key] || saveState === "error") {
        next[key] = errors[key];
      }
    });
    return next;
  }, [errors, saveState, touched]);

  const profilePreview = useMemo(
    () => ({
      name: values.name || "Your profile",
      email: values.email || "No email",
      username: normalizedValues.username,
      supportLine: buildSupportLine(values),
      photoURL: localAvatarUri || values.photoURL || "",
    }),
    [localAvatarUri, normalizedValues.username, values]
  );

  const integrationsSummary = useMemo(
    () => [
      {
        key: "strava",
        label: "Strava",
        value: integrations.stravaConnected ? "Connected" : "Not connected",
        meta: integrations.stravaConnected
          ? formatRelativeSync(integrations.lastStravaSyncMs)
          : "Connect in Settings",
      },
      {
        key: "garmin",
        label: "Garmin",
        value: integrations.garminConnected ? "Connected" : "Not connected",
        meta: integrations.garminConnected
          ? "Health and import details available"
          : "Manage connection in Settings",
      },
    ],
    [integrations]
  );

  const secondaryLinks = useMemo(
    () => [
      {
        key: "security",
        label: "Account & Security",
        meta: "Email, password, sign out, and app controls",
        path: "/settings",
      },
      {
        key: "imports",
        label: "Garmin & Imports",
        meta: "Connection details and imported activity data",
        path: "/profile/garmin-data",
      },
      {
        key: "health",
        label: "Health Data",
        meta: "Daily Garmin health payload tools",
        path: "/profile/garmin-health",
      },
      {
        key: "analytics",
        label: "Analytics",
        meta: "Deeper stats and activity trends",
        value: "Soon",
      },
    ],
    []
  );

  const setField = useCallback((field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setSaveState("idle");
    setSaveMessage("");
  }, []);

  const blurField = useCallback((field) => {
    setTouched((current) => ({ ...current, [field]: true }));
  }, []);

  const pickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setSaveState("error");
      setSaveMessage("Allow photo access to update your profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setLocalAvatarUri(result.assets[0].uri);
      setSaveState("idle");
      setSaveMessage("");
    }
  }, []);

  const uploadAvatarIfNeeded = useCallback(async () => {
    if (!localAvatarUri || !user?.uid) return values.photoURL || "";
    const blob = await (await fetch(localAvatarUri)).blob();
    const avatarRef = ref(storage, `${AVATAR_FOLDER}/${user.uid}.jpg`);
    await uploadBytes(avatarRef, blob, { contentType: "image/jpeg" });
    return getDownloadURL(avatarRef);
  }, [localAvatarUri, storage, user?.uid, values.photoURL]);

  const saveProfile = useCallback(async () => {
    if (!user?.uid) {
      setSaveState("error");
      setSaveMessage("You need to be signed in to edit your profile.");
      return false;
    }

    setTouched({
      name: true,
      username: true,
      bio: true,
      sport: true,
      location: true,
      website: true,
    });

    const currentErrors = validateValues(values);
    if (Object.keys(currentErrors).length) {
      setSaveState("error");
      setSaveMessage("Fix the highlighted fields before saving.");
      return false;
    }

    try {
      setSaveState("saving");
      setSaveMessage("Saving profile…");

      if (
        initialValues &&
        normalizedValues.username &&
        normalizedValues.username !== initialValues.username
      ) {
        const available = await isUsernameAvailable(user.uid, normalizedValues.username);
        if (!available) {
          setTouched((current) => ({ ...current, username: true }));
          setSaveState("error");
          setSaveMessage("That username is already taken.");
          return false;
        }
      }

      const finalPhotoURL = await uploadAvatarIfNeeded();

      await updateProfile(user, {
        displayName: normalizedValues.name || user.displayName || "",
        photoURL: finalPhotoURL || user.photoURL || "",
      });

      await setDoc(
        doc(db, "public_profiles", user.uid),
        {
          uid: user.uid,
          name: normalizedValues.name || user.displayName || "",
          username: normalizedValues.username,
          bio: normalizedValues.bio,
          sport: normalizedValues.sport,
          location: normalizedValues.location,
          website: normalizedValues.website,
          photoURL: finalPhotoURL || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const nextValues = {
        ...values,
        ...normalizedValues,
        photoURL: finalPhotoURL || "",
      };
      setValues(nextValues);
      setInitialValues(normalizeForSave(nextValues));
      setLocalAvatarUri("");
      setSaveState("saved");
      setSaveMessage("Profile updated.");
      return true;
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error?.message || "Could not save your profile.");
      return false;
    }
  }, [initialValues, normalizedValues, uploadAvatarIfNeeded, user, values]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  return {
    loading,
    refreshing,
    loadError,
    values,
    fieldErrors,
    dirty,
    hasErrors,
    saveState,
    saveMessage,
    profilePreview,
    integrationsSummary,
    secondaryLinks,
    setField,
    blurField,
    pickAvatar,
    saveProfile,
    refresh,
  };
}

export default useProfilePageData;

```

### src/lib/strava/syncStrava.js

```jsx
// src/lib/strava/syncStrava.js
import {
    Timestamp,
    collection,
    doc,
    serverTimestamp,
    setDoc,
    writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebaseConfig";
  
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  
  export async function syncStravaActivities(uid, accessToken) {
    if (!uid || !accessToken) return;
  
    const after = Math.floor((Date.now() - 1000 * 60 * 60 * 24 * 120) / 1000); // 120 days
  
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Strava sync failed ${resp.status}: ${t}`);
    }
  
    const acts = await resp.json();
    const safeActs = Array.isArray(acts) ? acts : [];
  
    const batch = writeBatch(db);
    const baseRef = collection(db, "users", uid, "stravaActivities");
  
    safeActs.forEach((a) => {
      const start = new Date(a.start_date_local || a.start_date);
      if (Number.isNaN(start.getTime())) return;

      const ref = doc(baseRef, String(a.id));
      const distanceMeters = Number(a.distance || 0) || 0;
      const distanceKm = distanceMeters > 0 ? distanceMeters / 1000 : 0;
      const movingTimeSec = Number(a.moving_time || 0) || 0;
      const movingTimeMin = movingTimeSec > 0 ? Math.round(movingTimeSec / 60) : 0;
      const avgPaceMinPerKm =
        distanceKm > 0 && movingTimeSec > 0
          ? Number((movingTimeSec / 60 / distanceKm).toFixed(2))
          : null;
      const averageHeartrateRaw = Number(a.average_heartrate || 0) || 0;
      const averageHeartrate =
        averageHeartrateRaw > 0 ? Math.round(averageHeartrateRaw) : null;
      const summaryPolyline = String(a?.map?.summary_polyline || "").trim();

      batch.set(
        ref,
        {
          id: String(a.id),
          type: a.type || "Other",
          name: a.name || "",
          startDate: Timestamp.fromDate(start),
          day: Timestamp.fromDate(startOfDay(start)),
          startDateMs: start.getTime(),
          distanceKm,
          distanceM: Math.round(distanceMeters),
          movingTimeSec,
          movingTimeMin,
          elevGainM: Math.round(a.total_elevation_gain || 0),
          averageSpeedMps: Number(a.average_speed || 0) || 0,
          maxSpeedMps: Number(a.max_speed || 0) || 0,
          averageHeartrate,
          avgPaceMinPerKm,
          calories: Number(a.kilojoules || 0) || 0,
          summaryPolyline: summaryPolyline || null,
          device: a.device_name || "",
          source: "strava",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
  
    await batch.commit();
  
    // track last sync (on user root doc)
    await setDoc(
      doc(db, "users", uid),
      { lastStravaSyncAt: serverTimestamp() },
      { merge: true }
    );
  }
  

```

### src/train/utils/sessionRecordHelpers.js

```jsx
import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { db } from "../../../firebaseConfig";
import { decodeSessionKey } from "./sessionHelpers";

function normaliseList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function extractWeeks(data) {
  const candidates = [
    data?.weeks,
    data?.plan?.weeks,
    data?.planData?.weeks,
    data?.generatedPlan?.weeks,
    data?.activePlan?.weeks,
    data?.output?.weeks,
    data?.result?.weeks,
    data?.template?.weeks,
    data?.program?.weeks,
    data?.schedule?.weeks,
    data?.payload?.weeks,
  ];

  for (const candidate of candidates) {
    const weeks = normaliseList(candidate);
    if (weeks.length) return weeks;
  }

  return [];
}

export function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

export function getSessionFromPlan(data, weekIndex, dayIndex, sessionIndex) {
  const weeks = extractWeeks(data);
  const week = weeks?.[weekIndex];

  if (!week) return { session: null, dayLabel: "" };

  const days = normaliseList(week?.days);
  const day = days?.[dayIndex];

  const daySessions = normaliseList(day?.sessions);
  let session = daySessions?.[sessionIndex] || null;

  if (!session) {
    const weekSessions = normaliseList(week?.sessions);
    session = weekSessions?.[sessionIndex] || null;
  }

  if (!session) {
    const workouts = normaliseList(week?.workouts);
    session = workouts?.[sessionIndex] || null;
  }

  const dayLabel =
    day?.day ||
    day?.label ||
    day?.name ||
    (week?.weekNumber != null ? `Week ${week.weekNumber}` : "");

  return { session, dayLabel };
}

export function isStrengthLikeSession(session) {
  const sport = String(
    session?.workout?.sport || session?.sessionType || session?.type || ""
  ).toLowerCase();
  if (sport.includes("strength") || sport.includes("gym") || Array.isArray(session?.blocks)) {
    return true;
  }
  if (
    sport.includes("run") ||
    sport.includes("interval") ||
    sport.includes("tempo") ||
    sport.includes("easy") ||
    sport.includes("long")
  ) {
    return false;
  }

  const titleBlob = [
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|row|lunge|press)\b/.test(
    titleBlob
  );
}

export function listPlanSessions(planDoc) {
  const weeks = extractWeeks(planDoc);
  const planId = String(planDoc?.id || "").trim();
  const planName = resolvePlanName(planDoc);
  const items = [];

  weeks.forEach((week, weekIndex) => {
    const weekLabel =
      week?.title ||
      (week?.weekNumber != null ? `Week ${week.weekNumber}` : `Week ${weekIndex + 1}`);

    const days = normaliseList(week?.days);
    if (days.length) {
      days.forEach((day, dayIndex) => {
        const dayLabel =
          day?.day || day?.label || day?.name || `Day ${dayIndex + 1}`;
        const sessions = normaliseList(day?.sessions);

        sessions.forEach((session, sessionIndex) => {
          items.push({
            planId,
            planName,
            weekIndex,
            dayIndex,
            sessionIndex,
            weekLabel,
            dayLabel,
            sessionKey: buildSessionKey(planId, weekIndex, dayIndex, sessionIndex),
            session,
          });
        });
      });
      return;
    }

    const sessions = [
      ...normaliseList(week?.sessions),
      ...normaliseList(week?.workouts),
    ];

    sessions.forEach((session, sessionIndex) => {
      items.push({
        planId,
        planName,
        weekIndex,
        dayIndex: 0,
        sessionIndex,
        weekLabel,
        dayLabel: weekLabel,
        sessionKey: buildSessionKey(planId, weekIndex, 0, sessionIndex),
        session,
      });
    });
  });

  return items;
}

async function tryGetDoc(pathSegments) {
  const ref = doc(db, ...pathSegments);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, __path: pathSegments, ...snap.data() };
}

export async function fetchTrainPlanById(uid, planId) {
  if (!uid || !planId) return null;

  const candidates = [
    ["users", uid, "plans", planId],
    ["users", uid, "runPlans", planId],
    ["users", uid, "trainingPlans", planId],
    ["plans", planId],
    ["runPlans", planId],
    ["trainingPlans", planId],
  ];

  for (const candidate of candidates) {
    try {
      const found = await tryGetDoc(candidate);
      if (found) return found;
    } catch {}
  }

  return null;
}

export async function loadPlannedSessionRecord(uid, encodedKey) {
  const decoded = decodeSessionKey(encodedKey);
  if (!decoded?.planId) {
    return {
      ...decoded,
      planDoc: null,
      session: null,
      dayLabel: "",
    };
  }

  const planDoc = await fetchTrainPlanById(uid, decoded.planId);
  const { session, dayLabel } = getSessionFromPlan(
    planDoc,
    decoded.weekIndex,
    decoded.dayIndex,
    decoded.sessionIndex
  );

  return {
    ...decoded,
    planDoc,
    session,
    dayLabel,
  };
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metersToKm(value) {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? Number((n / 1000).toFixed(3)) : null;
}

function resolveTitle(session) {
  return (
    session?.title ||
    session?.name ||
    session?.type ||
    session?.sessionType ||
    "Session"
  );
}

function resolvePlanName(planDoc) {
  return (
    planDoc?.name ||
    planDoc?.title ||
    planDoc?.meta?.name ||
    planDoc?.plan?.name ||
    "Training Plan"
  );
}

function resolvePrimaryActivity(planDoc, session) {
  return (
    planDoc?.primaryActivity ||
    planDoc?.meta?.primaryActivity ||
    session?.primaryActivity ||
    session?.workout?.sport ||
    session?.sessionType ||
    session?.type ||
    ""
  );
}

function resolveTargetDurationMin(session) {
  const direct =
    toFiniteNumber(session?.targetDurationMin) ??
    toFiniteNumber(session?.durationMin) ??
    toFiniteNumber(session?.totalDurationMin);

  if (direct != null && direct > 0) return Number(direct.toFixed(1));

  const workoutSec = toFiniteNumber(session?.workout?.totalDurationSec);
  if (workoutSec != null && workoutSec > 0) {
    return Number((workoutSec / 60).toFixed(1));
  }

  return null;
}

function resolveTargetDistanceKm(session) {
  const candidates = [
    session?.targetDistanceKm,
    session?.plannedDistanceKm,
    session?.computedTotalKm,
    session?.distanceKm,
    session?.totalDistanceKm,
    session?.renderedDistanceKm,
    session?.executableDistanceKm,
    session?.workout?.totalDistanceKm,
    metersToKm(session?.workout?.estimatedDistanceMeters),
    metersToKm(session?.workout?.budgetedEstimatedDistanceMeters),
  ];

  for (const candidate of candidates) {
    const km = toFiniteNumber(candidate);
    if (km != null && km > 0) return Number(km.toFixed(3));
  }

  return null;
}

export function stripNilValues(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function buildPlannedTrainSessionPayload({
  encodedKey,
  planDoc,
  session,
  dayLabel,
  status = "completed",
  notes = "",
  source = "manual_log",
  linkedActivity,
  overrides = {},
}) {
  const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
  const trimmedNotes = String(notes || "").trim();

  const payload = {
    sessionKey: encodedKey,
    planId: planId || null,
    planName: resolvePlanName(planDoc),
    primaryActivity: resolvePrimaryActivity(planDoc, session),
    sessionType: session?.sessionType || session?.type || null,
    weekIndex,
    dayIndex,
    sessionIndex,
    dayLabel: dayLabel || null,
    title: resolveTitle(session),
    date: new Date().toISOString().split("T")[0],
    targetDurationMin: resolveTargetDurationMin(session),
    targetDistanceKm: resolveTargetDistanceKm(session),
    actualDurationMin: null,
    actualDistanceKm: null,
    avgRPE: null,
    notes: trimmedNotes || null,
    segments: Array.isArray(session?.segments)
      ? session.segments
      : Array.isArray(session?.steps)
      ? session.steps
      : [],
    workout: session?.workout || null,
    status,
    source,
  };

  if (linkedActivity) {
    payload.linkedActivity = linkedActivity;
  }

  return {
    ...payload,
    ...overrides,
  };
}

export async function linkExternalActivityToPlannedSession({
  uid,
  encodedKey,
  notes = "",
  linkedActivity,
  payloadOverrides = {},
  sessionLogOverrides = {},
}) {
  if (!uid) throw new Error("Please sign in again.");
  if (!encodedKey) throw new Error("This session link is missing its key.");
  if (!linkedActivity?.reference) throw new Error("Missing linked activity reference.");

  const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
  const trimmedNotes = String(notes || "").trim();
  const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
  const existingLogSnap = await getDoc(sessionLogRef);
  const existingLog = existingLogSnap.exists() ? existingLogSnap.data() || {} : null;
  const resolvedTrainSessionId =
    String(existingLog?.lastTrainSessionId || "").trim() || null;

  let trainSessionRef = resolvedTrainSessionId
    ? doc(db, "users", uid, "trainSessions", resolvedTrainSessionId)
    : doc(collection(db, "users", uid, "trainSessions"));

  let hasExistingTrainSession = false;
  if (resolvedTrainSessionId) {
    const trainSessionSnap = await getDoc(trainSessionRef);
    hasExistingTrainSession = trainSessionSnap.exists();
    if (!hasExistingTrainSession) {
      trainSessionRef = doc(collection(db, "users", uid, "trainSessions"));
    }
  }

  const plannedRecord = await loadPlannedSessionRecord(uid, encodedKey);
  if (!plannedRecord?.planDoc || !plannedRecord?.session) {
    throw new Error("Could not find the planned session to link.");
  }

  const plannedPayload = buildPlannedTrainSessionPayload({
    encodedKey,
    planDoc: plannedRecord.planDoc,
    session: plannedRecord.session,
    dayLabel: plannedRecord.dayLabel,
    status: "completed",
    notes: trimmedNotes,
    source: "linked_activity",
    linkedActivity,
    overrides: payloadOverrides,
  });

  const trainSessionPayload = {
    ...stripNilValues(plannedPayload),
    notes: trimmedNotes || null,
    linkedActivity,
  };

  if (hasExistingTrainSession) {
    delete trainSessionPayload.source;
  }

  const statusFieldsForTrainSession = hasExistingTrainSession
    ? {
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        skippedAt: deleteField(),
      }
    : {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        completedAt: serverTimestamp(),
      };

  const batch = writeBatch(db);
  batch.set(
    trainSessionRef,
    {
      ...trainSessionPayload,
      ...statusFieldsForTrainSession,
    },
    { merge: hasExistingTrainSession }
  );

  batch.set(
    sessionLogRef,
    {
      sessionKey: encodedKey,
      planId: planId || null,
      weekIndex,
      dayIndex,
      sessionIndex,
      date: plannedPayload.date,
      status: "completed",
      source: "linked_activity",
      notes: trimmedNotes || null,
      linkedActivity,
      lastTrainSessionId: trainSessionRef.id,
      updatedAt: serverTimestamp(),
      statusAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      skippedAt: deleteField(),
      ...(existingLogSnap.exists() ? {} : { createdAt: serverTimestamp() }),
      ...sessionLogOverrides,
    },
    { merge: true }
  );

  await batch.commit();

  return {
    trainSessionId: trainSessionRef.id,
    sessionLogRef,
  };
}

export async function attachExternalActivityToTrainSession({
  uid,
  trainSessionId,
  linkedActivity,
  notes = "",
  payloadOverrides = {},
  sessionLogOverrides = {},
}) {
  if (!uid) throw new Error("Please sign in again.");
  if (!trainSessionId) throw new Error("Missing training session.");
  if (!linkedActivity?.reference) throw new Error("Missing linked activity reference.");

  const trainSessionRef = doc(db, "users", uid, "trainSessions", String(trainSessionId));
  const trainSessionSnap = await getDoc(trainSessionRef);
  if (!trainSessionSnap.exists()) {
    throw new Error("Training session not found.");
  }

  const existingSession = trainSessionSnap.data() || {};
  const trimmedNotes = String(notes || "").trim();

  const batch = writeBatch(db);
  batch.set(
    trainSessionRef,
    {
      linkedActivity,
      status: "completed",
      completedAt: serverTimestamp(),
      skippedAt: deleteField(),
      updatedAt: serverTimestamp(),
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      ...payloadOverrides,
    },
    { merge: true }
  );

  const encodedKey = String(existingSession?.sessionKey || "").trim();
  if (encodedKey) {
    const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
    const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
    batch.set(
      sessionLogRef,
      {
        sessionKey: encodedKey,
        planId: existingSession?.planId || planId || null,
        weekIndex:
          existingSession?.weekIndex != null ? existingSession.weekIndex : weekIndex,
        dayIndex:
          existingSession?.dayIndex != null ? existingSession.dayIndex : dayIndex,
        sessionIndex:
          existingSession?.sessionIndex != null
            ? existingSession.sessionIndex
            : sessionIndex,
        date: existingSession?.date || null,
        linkedActivity,
        status: "completed",
        lastTrainSessionId: trainSessionRef.id,
        updatedAt: serverTimestamp(),
        statusAt: serverTimestamp(),
        completedAt: serverTimestamp(),
        skippedAt: deleteField(),
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        ...sessionLogOverrides,
      },
      { merge: true }
    );
  }

  await batch.commit();

  return {
    trainSessionId: trainSessionRef.id,
    sessionKey: encodedKey || null,
  };
}

```

### src/lib/train/adaptationModel.js

```jsx
export const ADAPTATION_MODEL_VERSION = 1;

export const ADAPTATION_EVENT_COLLECTION = "adaptationEvents";

const DEFAULT_WINDOW_DAYS = [7, 14, 28];
const ADAPTATION_SCOPE_LEVELS = new Set(["athlete", "plan", "week", "session"]);
const ADAPTATION_EVENT_STATUSES = new Set(["proposed", "applied", "dismissed", "reverted"]);
const ADAPTATION_EVENT_SOURCES = new Set(["system", "coach", "athlete", "migration"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value, maxLen = 280) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trim()}…` : text;
}

function toFiniteNumber(value, digits = null) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!Number.isFinite(digits)) return num;
  return Number(num.toFixed(digits));
}

function toNonNegativeNumber(value, digits = null) {
  const num = toFiniteNumber(value, digits);
  return num != null && num >= 0 ? num : null;
}

function toIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function safeToDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value?.toDate === "function") {
    try {
      const next = value.toDate();
      if (next instanceof Date && !Number.isNaN(next.getTime())) return next;
    } catch {}
  }
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function toIsoDateTime(value) {
  const date = safeToDate(value);
  return date ? date.toISOString() : null;
}

function toIsoDateOnly(value) {
  const date = safeToDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    const next = value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined);
    return next;
  }

  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, inner]) => {
      const cleaned = stripUndefinedDeep(inner);
      if (cleaned !== undefined) next[key] = cleaned;
    });
    return next;
  }

  return value === undefined ? undefined : value;
}

function mean(values, digits = 1) {
  const nums = (Array.isArray(values) ? values : []).filter(
    (value) => Number.isFinite(Number(value))
  );
  if (!nums.length) return null;
  const total = nums.reduce((sum, value) => sum + Number(value), 0);
  return toFiniteNumber(total / nums.length, digits);
}

function normaliseStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "logged") return "completed";
  if (raw === "missed") return "skipped";
  if (raw === "canceled") return "discarded";
  return raw;
}

function classifyActivity(session) {
  const blob = [
    session?.primaryActivity,
    session?.sessionType,
    session?.type,
    session?.workout?.sport,
    session?.title,
    session?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bhyrox\b/.test(blob)) return "hyrox";
  if (
    /\b(strength|gym|hypertrophy|upper|lower|squat|deadlift|bench|press|row|pull|lift)\b/.test(
      blob
    )
  ) {
    return "strength";
  }
  if (
    /\b(run|tempo|interval|easy|long|race|track|fartlek|threshold|jog|hill|marathon|5k|10k)\b/.test(
      blob
    )
  ) {
    return "run";
  }

  return "other";
}

function classifyEffort(session, activity) {
  const blob = [
    session?.sessionType,
    session?.type,
    session?.title,
    session?.name,
    session?.focus,
    session?.emphasis,
    session?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (activity === "strength") return "strength";
  if (/\b(long run|long)\b/.test(blob)) return "long";
  if (
    /\b(interval|tempo|threshold|track|vo2|max|speed|hill|fartlek|race pace|sharpener|sharpening|progression)\b/.test(
      blob
    )
  ) {
    return "quality";
  }
  if (/\b(recovery|easy|rest|mobility)\b/.test(blob)) return "easy";
  if (activity === "run") return "aerobic";
  return activity || "other";
}

function emptyWindowSummary(days) {
  return {
    days,
    sessions: 0,
    plannedSessions: 0,
    completedSessions: 0,
    skippedSessions: 0,
    complianceRate: null,
    durationMin: 0,
    distanceKm: 0,
    avgRPE: null,
    loadScore: 0,
    qualitySessions: 0,
    longRuns: 0,
    avgTargetDurationRatio: null,
    avgTargetDistanceRatio: null,
  };
}

function summariseWindow(records, days) {
  const rows = Array.isArray(records) ? records : [];
  if (!rows.length) return emptyWindowSummary(days);

  const completed = rows.filter((row) => row.isCompleted);
  const planned = rows.filter((row) => row.countsTowardsCompliance);
  const skipped = rows.filter((row) => row.isSkipped);

  const durationRatios = completed
    .map((row) => row.targetHitDurationRatio)
    .filter((value) => value != null);
  const distanceRatios = completed
    .map((row) => row.targetHitDistanceRatio)
    .filter((value) => value != null);

  return {
    days,
    sessions: completed.length,
    plannedSessions: planned.length,
    completedSessions: completed.length,
    skippedSessions: skipped.length,
    complianceRate:
      planned.length > 0 ? toFiniteNumber(completed.length / planned.length, 3) : null,
    durationMin: Math.round(
      completed.reduce((sum, row) => sum + (Number(row.actualDurationMin) || 0), 0)
    ),
    distanceKm: toFiniteNumber(
      completed.reduce((sum, row) => sum + (Number(row.actualDistanceKm) || 0), 0),
      1
    ) || 0,
    avgRPE: mean(completed.map((row) => row.avgRPE), 1),
    loadScore: toFiniteNumber(
      completed.reduce((sum, row) => sum + (Number(row.loadScore) || 0), 0),
      1
    ) || 0,
    qualitySessions: completed.filter((row) => row.effortClass === "quality").length,
    longRuns: completed.filter((row) => row.effortClass === "long").length,
    avgTargetDurationRatio: mean(durationRatios, 2),
    avgTargetDistanceRatio: mean(distanceRatios, 2),
  };
}

function summariseByActivity(records) {
  return (Array.isArray(records) ? records : []).reduce((acc, row) => {
    const key = row.activity || "other";
    const current = acc[key] || {
      sessions: 0,
      completedSessions: 0,
      skippedSessions: 0,
      durationMin: 0,
      distanceKm: 0,
    };

    current.sessions += 1;
    if (row.isCompleted) {
      current.completedSessions += 1;
      current.durationMin += Number(row.actualDurationMin || 0) || 0;
      current.distanceKm += Number(row.actualDistanceKm || 0) || 0;
    }
    if (row.isSkipped) current.skippedSessions += 1;

    acc[key] = {
      ...current,
      durationMin: Math.round(current.durationMin),
      distanceKm: toFiniteNumber(current.distanceKm, 1) || 0,
    };
    return acc;
  }, {});
}

function buildStreaks(records) {
  let consecutiveCompleted = 0;
  let consecutiveMissed = 0;

  for (const row of Array.isArray(records) ? records : []) {
    if (row.countsTowardsCompliance) {
      if (row.isCompleted) consecutiveCompleted += 1;
      else break;
    }
  }

  for (const row of Array.isArray(records) ? records : []) {
    if (row.countsTowardsCompliance) {
      if (row.isSkipped) consecutiveMissed += 1;
      else break;
    }
  }

  return {
    consecutiveCompleted,
    consecutiveMissed,
  };
}

export function normaliseRecentTrainingRecord(session, fallbackId = "") {
  const date =
    safeToDate(session?.completedAt) ||
    safeToDate(session?.updatedAt) ||
    safeToDate(session?.createdAt) ||
    safeToDate(session?.date);

  const status = normaliseStatus(session?.status);
  const isCompleted = status === "completed" || status === "saved";
  const isSkipped = status === "skipped";
  const isLive = status === "live" || status === "running" || status === "paused";
  const countsTowardsCompliance = isCompleted || isSkipped;

  const actualDurationMin = toNonNegativeNumber(
    session?.actualDurationMin ??
      (Number(session?.live?.durationSec || 0)
        ? Number(session.live.durationSec) / 60
        : null),
    1
  );
  const actualDistanceKm = toNonNegativeNumber(
    session?.actualDistanceKm ?? session?.live?.distanceKm ?? null,
    2
  );
  const targetDurationMin = toNonNegativeNumber(session?.targetDurationMin, 1);
  const targetDistanceKm = toNonNegativeNumber(session?.targetDistanceKm, 2);
  const avgRPE = toNonNegativeNumber(session?.avgRPE ?? session?.live?.avgRPE ?? null, 1);

  const activity = classifyActivity(session);
  const effortClass = classifyEffort(session, activity);

  return {
    id: String(session?.id || fallbackId || ""),
    sessionKey: cleanText(session?.sessionKey || null, 120),
    planId: cleanText(session?.planId || null, 120),
    title: cleanText(session?.title || session?.name || "Session", 140) || "Session",
    type:
      cleanText(
        session?.primaryActivity || session?.sessionType || session?.workout?.sport || null,
        80
      ) || "",
    activity,
    effortClass,
    status,
    source: cleanText(session?.source || null, 80),
    date: toIsoDateTime(date),
    dateMs: date ? date.getTime() : 0,
    actualDurationMin,
    actualDistanceKm,
    targetDurationMin,
    targetDistanceKm,
    avgRPE,
    loadScore:
      actualDurationMin != null && avgRPE != null
        ? toFiniteNumber(actualDurationMin * avgRPE, 1)
        : null,
    targetHitDurationRatio:
      actualDurationMin != null && targetDurationMin != null && targetDurationMin > 0
        ? toFiniteNumber(actualDurationMin / targetDurationMin, 2)
        : null,
    targetHitDistanceRatio:
      actualDistanceKm != null && targetDistanceKm != null && targetDistanceKm > 0
        ? toFiniteNumber(actualDistanceKm / targetDistanceKm, 2)
        : null,
    notes: cleanText(session?.notes || null, 240),
    isCompleted,
    isSkipped,
    isLive,
    countsTowardsCompliance,
  };
}

export function createEmptyRecentTrainingSummary(windows = DEFAULT_WINDOW_DAYS) {
  const keys = {};
  (Array.isArray(windows) ? windows : DEFAULT_WINDOW_DAYS).forEach((days) => {
    const numericDays = Math.max(1, toIntegerOrNull(days) || 0);
    keys[`last${numericDays}d`] = emptyWindowSummary(numericDays);
  });

  return {
    version: ADAPTATION_MODEL_VERSION,
    generatedAt: null,
    recordCount: 0,
    recent: [],
    windows: keys,
    last7d: keys.last7d || emptyWindowSummary(7),
    last14d: keys.last14d || emptyWindowSummary(14),
    last28d: keys.last28d || emptyWindowSummary(28),
    streaks: {
      consecutiveCompleted: 0,
      consecutiveMissed: 0,
    },
    byActivity: {},
    latestCompletedAt: null,
  };
}

export function summariseRecentTraining(rows, options = {}) {
  const windowDays = Array.isArray(options?.windows) && options.windows.length
    ? options.windows
    : DEFAULT_WINDOW_DAYS;
  const recentLimit = Math.max(1, Math.min(20, toIntegerOrNull(options?.recentLimit) || 8));
  const now = safeToDate(options?.now) || new Date();

  const ordered = (Array.isArray(rows) ? rows : [])
    .map((row, index) => normaliseRecentTrainingRecord(row, `row_${index}`))
    .sort((a, b) => b.dateMs - a.dateMs);

  if (!ordered.length) return createEmptyRecentTrainingSummary(windowDays);

  const windows = {};
  windowDays.forEach((days) => {
    const numericDays = Math.max(1, toIntegerOrNull(days) || 0);
    const cutoffMs = now.getTime() - numericDays * DAY_MS;
    const withinWindow = ordered.filter((row) => row.dateMs >= cutoffMs);
    windows[`last${numericDays}d`] = summariseWindow(withinWindow, numericDays);
  });

  const latestCompleted = ordered.find((row) => row.isCompleted);

  return {
    version: ADAPTATION_MODEL_VERSION,
    generatedAt: now.toISOString(),
    recordCount: ordered.length,
    recent: ordered.slice(0, recentLimit).map(({ dateMs, ...row }) => row),
    windows,
    last7d: windows.last7d || emptyWindowSummary(7),
    last14d: windows.last14d || emptyWindowSummary(14),
    last28d: windows.last28d || emptyWindowSummary(28),
    streaks: buildStreaks(ordered),
    byActivity: summariseByActivity(ordered),
    latestCompletedAt: latestCompleted?.date || null,
  };
}

export function compactRecentTrainingSummary(summary) {
  if (!summary || typeof summary !== "object") return null;

  return stripUndefinedDeep({
    version: toIntegerOrNull(summary?.version) || ADAPTATION_MODEL_VERSION,
    generatedAt: toIsoDateTime(summary?.generatedAt),
    recordCount: toIntegerOrNull(summary?.recordCount) || 0,
    last7d: summary?.last7d || emptyWindowSummary(7),
    last14d: summary?.last14d || emptyWindowSummary(14),
    last28d: summary?.last28d || emptyWindowSummary(28),
    streaks: {
      consecutiveCompleted: toIntegerOrNull(summary?.streaks?.consecutiveCompleted) || 0,
      consecutiveMissed: toIntegerOrNull(summary?.streaks?.consecutiveMissed) || 0,
    },
    byActivity: summary?.byActivity || {},
    latestCompletedAt: toIsoDateTime(summary?.latestCompletedAt),
  });
}

function normaliseScope(scope = {}) {
  const levelRaw = String(scope?.level || "plan").trim().toLowerCase();
  const level = ADAPTATION_SCOPE_LEVELS.has(levelRaw) ? levelRaw : "plan";

  return stripUndefinedDeep({
    level,
    planId: cleanText(scope?.planId || null, 120),
    weekIndex: toIntegerOrNull(scope?.weekIndex),
    dayIndex: toIntegerOrNull(scope?.dayIndex),
    sessionKey: cleanText(scope?.sessionKey || null, 140),
    effectiveFrom: toIsoDateOnly(scope?.effectiveFrom || scope?.effectiveFromIso),
    effectiveTo: toIsoDateOnly(scope?.effectiveTo || scope?.effectiveToIso),
  });
}

export function normaliseAdaptationEvent(event = {}) {
  const statusRaw = String(event?.status || "proposed").trim().toLowerCase();
  const sourceRaw = String(event?.source || "system").trim().toLowerCase();

  return stripUndefinedDeep({
    version: ADAPTATION_MODEL_VERSION,
    id: cleanText(event?.id || null, 120),
    type: cleanText(event?.type || event?.kind || "manual_adjustment", 80),
    status: ADAPTATION_EVENT_STATUSES.has(statusRaw) ? statusRaw : "proposed",
    source: ADAPTATION_EVENT_SOURCES.has(sourceRaw) ? sourceRaw : "system",
    actor: cleanText(event?.actor || null, 80),
    planId: cleanText(event?.planId || event?.scope?.planId || null, 120),
    scope: normaliseScope(event?.scope || {}),
    trigger: stripUndefinedDeep({
      code: cleanText(event?.trigger?.code || null, 80),
      label: cleanText(event?.trigger?.label || null, 140),
      windowDays: toIntegerOrNull(event?.trigger?.windowDays),
      metrics:
        event?.trigger?.metrics && typeof event.trigger.metrics === "object"
          ? stripUndefinedDeep(event.trigger.metrics)
          : undefined,
    }),
    summarySnapshot: compactRecentTrainingSummary(
      event?.summarySnapshot || event?.summary || null
    ),
    changes: stripUndefinedDeep({
      before:
        event?.changes?.before && typeof event.changes.before === "object"
          ? stripUndefinedDeep(event.changes.before)
          : undefined,
      after:
        event?.changes?.after && typeof event.changes.after === "object"
          ? stripUndefinedDeep(event.changes.after)
          : undefined,
      patch:
        event?.changes?.patch && typeof event.changes.patch === "object"
          ? stripUndefinedDeep(event.changes.patch)
          : undefined,
    }),
    reason: stripUndefinedDeep({
      headline: cleanText(event?.reason?.headline || event?.headline || null, 140),
      detail: cleanText(event?.reason?.detail || event?.detail || null, 320),
    }),
    notes: cleanText(event?.notes || null, 320),
    tags: Array.isArray(event?.tags)
      ? event.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 12)
      : [],
    createdAtMs: toIntegerOrNull(event?.createdAtMs) || Date.now(),
    updatedAtMs: toIntegerOrNull(event?.updatedAtMs) || Date.now(),
    appliedAtMs: toIntegerOrNull(event?.appliedAtMs),
  });
}

export function buildAdaptationEvent(input = {}) {
  return normaliseAdaptationEvent(input);
}

export function normaliseAdaptationState(state = {}) {
  const eventCounts = state?.eventCounts || {};

  return stripUndefinedDeep({
    version: ADAPTATION_MODEL_VERSION,
    enabled: state?.enabled !== false,
    lastEvaluatedAtMs: toIntegerOrNull(state?.lastEvaluatedAtMs),
    latestSummary: compactRecentTrainingSummary(state?.latestSummary || null),
    latestEventId: cleanText(state?.latestEventId || null, 120),
    eventCounts: {
      total: toIntegerOrNull(eventCounts?.total) || 0,
      proposed: toIntegerOrNull(eventCounts?.proposed) || 0,
      applied: toIntegerOrNull(eventCounts?.applied) || 0,
      dismissed: toIntegerOrNull(eventCounts?.dismissed) || 0,
      reverted: toIntegerOrNull(eventCounts?.reverted) || 0,
    },
  });
}

export function createEmptyAdaptationState() {
  return normaliseAdaptationState({});
}

export function applyRecentTrainingSummaryToAdaptationState(
  state,
  summary,
  overrides = {}
) {
  const next = normaliseAdaptationState(state);

  return normaliseAdaptationState({
    ...next,
    latestSummary: compactRecentTrainingSummary(summary),
    lastEvaluatedAtMs:
      toIntegerOrNull(overrides?.lastEvaluatedAtMs) ||
      toIntegerOrNull(overrides?.evaluatedAtMs) ||
      Date.now(),
    latestEventId: cleanText(overrides?.latestEventId || next.latestEventId || null, 120),
  });
}

export function registerAdaptationEvent(state, event) {
  const current = normaliseAdaptationState(state);
  const nextEvent = normaliseAdaptationEvent(event);
  const statusKey = nextEvent.status;

  return normaliseAdaptationState({
    ...current,
    latestEventId: nextEvent.id || current.latestEventId,
    eventCounts: {
      ...current.eventCounts,
      total: (current.eventCounts?.total || 0) + 1,
      [statusKey]: (current.eventCounts?.[statusKey] || 0) + 1,
    },
  });
}

export function withPlanAdaptationDefaults(planDoc = {}, overrides = {}) {
  return {
    ...planDoc,
    adaptation: normaliseAdaptationState({
      ...(planDoc?.adaptation || {}),
      ...(overrides || {}),
    }),
  };
}

```

### app/(protected)/me/goals.jsx

```jsx
// app/(protected)/me/goals.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

// Firestore
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeekMonday(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ✅ LOCAL date key (avoids UTC shifting caused by toISOString())
function isoKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}

function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("cycling") || x.includes("bike")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}

function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
}

function formatPace(pace) {
  if (!pace || !Number.isFinite(pace)) return "—";
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}

function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  const now = new Date();
  const diffDays = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000
  );
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}

function toWeekLabel(weekStartDate) {
  return `Wk of ${weekStartDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })}`;
}

// ✅ renamed to avoid clashing with ProgressRow prop name
function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return clamp(n, 0, 100);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

/* ─────────────────────────────────────────────
   Firestore path
   users/{uid}/me/goals (single doc)
───────────────────────────────────────────── */
function goalsDocRef(uid) {
  return doc(db, "users", uid, "me", "goals");
}

/* ============================================================================
   Goals — weekly targets + progress from Strava
============================================================================ */
export default function GoalsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");

  // strava activities for window (4 weeks)
  const [acts, setActs] = useState([]);

  // goals state (stored)
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState({
    weeklySessions: 5,
    weeklyRunKm: 30,
    weeklyMinutes: 300,
    weeklyStrengthMinutes: 120,
  });

  const [editOpen, setEditOpen] = useState(false);

  // drilldown week modal
  const [weekOpen, setWeekOpen] = useState(false);
  const [selectedWeekKey, setSelectedWeekKey] = useState(null);

  // details cache for long press
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState({});

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const loadGoals = useCallback(async () => {
    try {
      if (!user?.uid) return;
      const ref = goalsDocRef(user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        setTargets((prev) => ({
          weeklySessions: Number.isFinite(Number(data.weeklySessions))
            ? Number(data.weeklySessions)
            : prev.weeklySessions,
          weeklyRunKm: Number.isFinite(Number(data.weeklyRunKm))
            ? Number(data.weeklyRunKm)
            : prev.weeklyRunKm,
          weeklyMinutes: Number.isFinite(Number(data.weeklyMinutes))
            ? Number(data.weeklyMinutes)
            : prev.weeklyMinutes,
          weeklyStrengthMinutes: Number.isFinite(Number(data.weeklyStrengthMinutes))
            ? Number(data.weeklyStrengthMinutes)
            : prev.weeklyStrengthMinutes,
        }));
      }
    } catch (e) {
      console.warn("goals load error", e);
    }
  }, [user?.uid]);

  const saveGoals = useCallback(
    async (nextTargets) => {
      if (!user?.uid) return;
      try {
        setSaving(true);
        const ref = goalsDocRef(user.uid);
        await setDoc(
          ref,
          {
            ...nextTargets,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("goals save error", e);
        setError("Couldn’t save goals. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [user?.uid]
  );

  const loadStrava = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasToken(false);
        setActs([]);
        return;
      }
      setHasToken(true);

      // last 28 days window
      const after = Math.floor(addDays(new Date(), -28).getTime() / 1000);

      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava goals load error", resp.status, text);
        setError("Couldn’t load Strava. Try reconnecting in Settings.");
        setActs([]);
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const mapped = safe.map((a) => {
        const distanceKm = (a.distance || 0) / 1000;
        const when = a.start_date_local || a.start_date;
        const type = normaliseType(a.type || "Workout");
        const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

        return {
          id: String(a.id),
          title: a.name || a.type || "Workout",
          type,
          when,
          distanceKm,
          movingTimeMin: Math.round((a.moving_time || 0) / 60),
          movingTimeSec: Number(a.moving_time || 0),
          paceMinPerKm: pace,
          elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
          description: a.description || "",
          deviceName: a.device_name || "",
        };
      });

      mapped.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      setActs(mapped);
    } catch (e) {
      console.error("Goals Strava load error", e);
      setError("Couldn’t load progress. Try again.");
      setActs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadGoals(), loadStrava()]);
  }, [loadGoals, loadStrava]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const fetchDetailIfNeeded = useCallback(
    async (id) => {
      try {
        if (!id) return;
        if (detailCache[id]) return;

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) return;

        setDetailLoadingId(id);

        const resp = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) return;

        const detail = await resp.json();
        setDetailCache((prev) => ({ ...prev, [id]: detail }));
      } catch {
        // ignore
      } finally {
        setDetailLoadingId("");
      }
    },
    [detailCache]
  );

  /* ─────────────────────────────────────────────
     Weekly aggregations for last 4 weeks + current week
  ────────────────────────────────────────────── */
  const weekly = useMemo(() => {
    const thisWeekStart = startOfWeekMonday(new Date());
    const start = addDays(thisWeekStart, -21); // 4 weeks incl this

    const by = {};
    for (let i = 0; i < 4; i++) {
      const ws = addDays(start, i * 7);
      const key = isoKey(ws);
      by[key] = {
        key,
        weekStart: ws,
        timeMin: 0,
        runKm: 0,
        runTimeMin: 0,
        strengthMin: 0,
        count: 0,
      };
    }

    acts.forEach((a) => {
      if (!a.when) return;
      const ws = startOfWeekMonday(new Date(a.when));
      const k = isoKey(ws);
      if (!by[k]) return;

      by[k].count += 1;
      by[k].timeMin += safeNum(a.movingTimeMin);
      if (a.type === "Run") {
        by[k].runKm += safeNum(a.distanceKm);
        by[k].runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") {
        by[k].strengthMin += safeNum(a.movingTimeMin);
      }
    });

    const series = Object.values(by).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
    const current = series[series.length - 1] || null;

    return { series, current };
  }, [acts]);

  const progress = useMemo(() => {
    const cur = weekly.current;
    if (!cur) {
      return {
        sessions: 0,
        runKm: 0,
        minutes: 0,
        strengthMin: 0,
        pctSessions: 0,
        pctRunKm: 0,
        pctMinutes: 0,
        pctStrength: 0,
      };
    }

    const sessions = cur.count;
    const runKm = cur.runKm;
    const minutes = cur.timeMin;
    const strengthMin = cur.strengthMin;

    const pctSessions = (sessions / Math.max(1, safeNum(targets.weeklySessions))) * 100;
    const pctRunKm = (runKm / Math.max(1, safeNum(targets.weeklyRunKm))) * 100;
    const pctMinutes = (minutes / Math.max(1, safeNum(targets.weeklyMinutes))) * 100;
    const pctStrength = (strengthMin / Math.max(1, safeNum(targets.weeklyStrengthMinutes))) * 100;

    return { sessions, runKm, minutes, strengthMin, pctSessions, pctRunKm, pctMinutes, pctStrength };
  }, [weekly.current, targets]);

  const currentWeekActivities = useMemo(() => {
    const cur = weekly.current;
    if (!cur) return [];
    const start = cur.weekStart.getTime();
    const end = addDays(cur.weekStart, 7).getTime();
    return acts
      .filter((a) => {
        const t = a.when ? new Date(a.when).getTime() : 0;
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, weekly.current]);

  const onWeekPress = useCallback((w) => {
    setSelectedWeekKey(w.key);
    setWeekOpen(true);
  }, []);

  const selectedWeekObj = useMemo(() => {
    if (!selectedWeekKey) return null;
    return weekly.series.find((w) => w.key === selectedWeekKey) || null;
  }, [weekly.series, selectedWeekKey]);

  const selectedWeekActivities = useMemo(() => {
    if (!selectedWeekObj) return [];
    const start = selectedWeekObj.weekStart.getTime();
    const end = addDays(selectedWeekObj.weekStart, 7).getTime();
    return acts
      .filter((a) => {
        const t = a.when ? new Date(a.when).getTime() : 0;
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, selectedWeekObj]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={() => setEditOpen(true)} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="edit-3" size={18} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="settings" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroAvatarWrap}>
                  {user?.photoURL ? (
                    <Image source={{ uri: user.photoURL }} style={s.heroAvatar} />
                  ) : (
                    <View style={s.heroAvatarFallback}>
                      <Text style={s.heroAvatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={s.heroAvatarBorder} />
                </View>

                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>GOALS</Text>
                  <Text style={s.heroName}>Weekly targets</Text>
                  <Text style={s.heroSub}>
                    {hasToken ? "Progress from Strava" : "Connect Strava for progress"}
                    {weekly.current?.weekStart ? ` · ${toWeekLabel(weekly.current.weekStart)}` : ""}
                  </Text>
                </View>
              </View>

              {/* PROGRESS BARS */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>This week</Text>
                  <TouchableOpacity onPress={onRefresh} style={s.refreshBtnMini} activeOpacity={0.85}>
                    <Feather name="refresh-cw" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasToken ? (
                  <Text style={s.hint}>Connect Strava to track progress automatically.</Text>
                ) : (
                  <>
                    <ProgressRow
                      title="Sessions"
                      left={`${progress.sessions}/${targets.weeklySessions}`}
                      pct={progress.pctSessions}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />
                    <ProgressRow
                      title="Run km"
                      left={`${progress.runKm.toFixed(1)}/${Number(targets.weeklyRunKm).toFixed(0)}`}
                      pct={progress.pctRunKm}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />
                    <ProgressRow
                      title="Total minutes"
                      left={`${Math.round(progress.minutes)}/${Number(targets.weeklyMinutes).toFixed(0)}`}
                      pct={progress.pctMinutes}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />
                    <ProgressRow
                      title="Strength minutes"
                      left={`${Math.round(progress.strengthMin)}/${Number(targets.weeklyStrengthMinutes).toFixed(0)}`}
                      pct={progress.pctStrength}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                    />

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => {
                          const cur = weekly.current;
                          if (cur) onWeekPress(cur);
                        }}
                        style={[s.cta, { backgroundColor: isDark ? "#18191E" : "#E6E7EC", flex: 1 }]}
                      >
                        <Feather name="list" size={16} color={colors.text} />
                        <Text style={[s.ctaText, { color: colors.text }]}>View week</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setEditOpen(true)}
                        style={[s.cta, { backgroundColor: accent, flex: 1 }]}
                      >
                        <Feather name="sliders" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                        <Text style={[s.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Edit goals</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}

                {!hasToken ? (
                  <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                    <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                    <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </LinearGradient>

          {/* LAST 4 WEEKS STRIP */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="calendar" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Last 4 weeks</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            {hasToken ? (
              <>
                <WeekStrip
                  weeks={weekly.series}
                  accent={accent}
                  colors={colors}
                  isDark={isDark}
                  targets={targets}
                  onWeekPress={onWeekPress}
                />
                <Text style={s.hint}>Tap a week to see sessions.</Text>
              </>
            ) : (
              <Text style={s.hint}>Connect Strava to see week-by-week progress.</Text>
            )}

            {/* THIS WEEK ACTIVITIES (quick list) */}
            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>This week’s sessions</Text>

            {loading ? (
              <View style={{ paddingVertical: 14 }}>
                <ActivityIndicator />
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : !hasToken ? (
              <Text style={s.hint}>Connect Strava to see your sessions here.</Text>
            ) : currentWeekActivities.length === 0 ? (
              <Text style={s.hint}>No sessions logged yet this week.</Text>
            ) : (
              <>
                {currentWeekActivities.slice(0, 8).map((a) => {
                  const whenObj = a.when ? new Date(a.when) : null;

                  const hasDistance = Number(a.distanceKm || 0) > 0;
                  const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
                  const showDistance = a.type === "Run" && hasDistance;
                  const showPace = a.type === "Run" && hasDistance && hasPace;

                  return (
                    <View key={a.id} style={{ marginTop: 12 }}>
                      <CompactActivityCard
                        userName={displayName}
                        avatarUri={user?.photoURL || ""}
                        initial={initial}
                        accent={accent}
                        colors={colors}
                        isDark={isDark}
                        title={a.title}
                        subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${a.type}`}
                        notes={""}
                        distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                        paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                        timeText={formatHoursMin(a.movingTimeMin)}
                        showDistance={showDistance}
                        showPace={showPace}
                        onPress={() => router.push(`/me/activity/${a.id}`)}
                        onLongPress={() => fetchDetailIfNeeded(a.id)}
                        loadingDetail={detailLoadingId === a.id}
                      />
                    </View>
                  );
                })}
              </>
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* EDIT GOALS MODAL */}
        <EditGoalsSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          colors={colors}
          isDark={isDark}
          accent={accent}
          saving={saving}
          targets={targets}
          setTargets={setTargets}
          onSave={async (next) => {
            await saveGoals(next);
            setEditOpen(false);
          }}
        />

        {/* WEEK MODAL */}
        <WeekSheet
          open={weekOpen}
          onClose={() => setWeekOpen(false)}
          week={selectedWeekObj}
          activities={selectedWeekActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          onOpenActivity={(id) => router.push(`/me/activity/${id}`)}
          onPeekDetail={fetchDetailIfNeeded}
          detailCache={detailCache}
          detailLoadingId={detailLoadingId}
          userName={displayName}
          avatarUri={user?.photoURL || ""}
          initial={initial}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Progress bar row (clean, no borders)
───────────────────────────────────────────── */
function ProgressRow({ title, left, pct, accent, colors, isDark }) {
  const pRaw = Number(pct || 0);
  const p = Number.isFinite(pRaw) ? clamp(pRaw, 0, 999) : 0;
  const widthPct = clampPct(p); // width must be 0..100
  const label = p >= 100 ? "Done" : fmtPct(p);

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontWeight: "900", fontSize: 13 }}>{title}</Text>
        <Text style={{ color: colors.subtext, fontWeight: "900", fontSize: 12 }}>
          {left} · {label}
        </Text>
      </View>

      <View
        style={{
          marginTop: 8,
          height: 10,
          borderRadius: 999,
          backgroundColor: isDark ? "#1B1C22" : "#E6E7EC",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${widthPct}%`,
            backgroundColor: accent,
            borderRadius: 999,
          }}
        />
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week strip (4 small bars) — clickable
───────────────────────────────────────────── */
function WeekStrip({ weeks, accent, colors, isDark, targets, onWeekPress }) {
  const maxMinutes = Math.max(...weeks.map((w) => w.timeMin), safeNum(targets.weeklyMinutes), 1);

  return (
    <View style={{ marginTop: 12, flexDirection: "row", gap: 10 }}>
      {weeks.map((w, idx) => {
        const h = 56;
        const fill = clamp((w.timeMin / maxMinutes) * 100, 0, 100);
        const isCurrent = idx === weeks.length - 1;

        return (
          <TouchableOpacity
            key={w.key}
            activeOpacity={0.9}
            onPress={() => onWeekPress?.(w)}
            style={{
              flex: 1,
              backgroundColor: isDark ? "#111217" : "#F3F4F6",
              borderRadius: 18,
              padding: 12,
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 10 },
              ...Platform.select({ android: { elevation: 1 } }),
            }}
          >
            <Text style={{ color: colors.subtext, fontSize: 11, fontWeight: "900" }} numberOfLines={1}>
              {toWeekLabel(w.weekStart)}
            </Text>

            <View
              style={{
                marginTop: 10,
                height: h,
                borderRadius: 14,
                backgroundColor: isDark ? "#1B1C22" : "#E6E7EC",
                overflow: "hidden",
                justifyContent: "flex-end",
              }}
            >
              <View
                style={{
                  height: `${fill}%`,
                  backgroundColor: accent,
                  opacity: isCurrent ? 1 : 0.7,
                }}
              />
            </View>

            <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 8 }}>
              {formatHoursMin(w.timeMin)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────────────────────
   Edit goals sheet
───────────────────────────────────────────── */
function EditGoalsSheet({ open, onClose, colors, isDark, accent, saving, targets, setTargets, onSave }) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.78);

  const [local, setLocal] = useState(targets);

  useEffect(() => {
    if (open) setLocal(targets);
  }, [open, targets]);

  const setField = (k, v) => {
    const n = String(v ?? "").replace(/[^0-9.]/g, "");
    setLocal((p) => ({ ...p, [k]: n }));
  };

  const commit = async () => {
    const next = {
      weeklySessions: clamp(Math.round(safeNum(local.weeklySessions)), 0, 99),
      weeklyRunKm: clamp(safeNum(local.weeklyRunKm), 0, 400),
      weeklyMinutes: clamp(Math.round(safeNum(local.weeklyMinutes)), 0, 5000),
      weeklyStrengthMinutes: clamp(Math.round(safeNum(local.weeklyStrengthMinutes)), 0, 2000),
    };
    setTargets(next);
    await onSave?.(next);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>Edit weekly goals</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>Used for progress bars + trends.</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          <FieldRow
            label="Sessions"
            value={String(local.weeklySessions ?? "")}
            onChangeText={(v) => setField("weeklySessions", v)}
            suffix=" / week"
            colors={colors}
            isDark={isDark}
          />
          <FieldRow
            label="Run distance"
            value={String(local.weeklyRunKm ?? "")}
            onChangeText={(v) => setField("weeklyRunKm", v)}
            suffix=" km / week"
            colors={colors}
            isDark={isDark}
          />
          <FieldRow
            label="Total training time"
            value={String(local.weeklyMinutes ?? "")}
            onChangeText={(v) => setField("weeklyMinutes", v)}
            suffix=" min / week"
            colors={colors}
            isDark={isDark}
          />
          <FieldRow
            label="Strength time"
            value={String(local.weeklyStrengthMinutes ?? "")}
            onChangeText={(v) => setField("weeklyStrengthMinutes", v)}
            suffix=" min / week"
            colors={colors}
            isDark={isDark}
          />

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={commit}
            disabled={saving}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16, opacity: saving ? 0.7 : 1 }]}
          >
            {saving ? <ActivityIndicator /> : <Feather name="check" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />}
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>
              {saving ? "Saving…" : "Save goals"}
            </Text>
          </TouchableOpacity>

          <Text style={{ marginTop: 10, color: colors.subtext, fontSize: 12, lineHeight: 17 }}>
            Tip: keep targets realistic — the app will surface consistency, not perfection.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function FieldRow({ label, value, onChangeText, suffix, colors, isDark }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{label}</Text>
      <View
        style={{
          marginTop: 8,
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 18,
          backgroundColor: isDark ? "#111217" : "#F3F4F6",
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.subtext}
          style={{ flex: 1, color: colors.text, fontSize: 16, fontWeight: "900" }}
        />
        <Text style={{ color: colors.subtext, fontWeight: "900", marginLeft: 8 }}>{suffix}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week sheet — shows activities + hides distance/pace if missing
───────────────────────────────────────────── */
function WeekSheet({
  open,
  onClose,
  week,
  activities,
  colors,
  isDark,
  accent,
  router,
  onOpenActivity,
  onPeekDetail,
  detailCache,
  detailLoadingId,
  userName,
  avatarUri,
  initial,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const title = useMemo(() => {
    if (!week?.weekStart) return "Week";
    const start = week.weekStart;
    const end = addDays(start, 6);
    return `${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${end.toLocaleDateString(
      "en-GB",
      { day: "2-digit", month: "short" }
    )}`;
  }, [week]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {week ? `${week.count} sessions · ${formatHoursMin(week.timeMin)}` : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {week ? (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pill label="Time" value={formatHoursMin(week.timeMin)} colors={colors} isDark={isDark} />
              <Pill label="Run km" value={week.runKm.toFixed(1)} colors={colors} isDark={isDark} />
              <Pill label="Strength" value={formatHoursMin(week.strengthMin)} colors={colors} isDark={isDark} />
            </View>
          ) : null}
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {activities?.length ? (
            activities.map((a) => {
              const detail = detailCache?.[a.id];
              const whenObj = a.when ? new Date(a.when) : null;
              const deviceLine = detail?.device_name || a.deviceName || "Strava";
              const desc = detail?.description || a.description || "";

              const hasDistance = Number(a.distanceKm || 0) > 0;
              const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
              const showDistance = a.type === "Run" && hasDistance;
              const showPace = a.type === "Run" && hasDistance && hasPace;

              return (
                <View key={a.id} style={{ marginTop: 14 }}>
                  <CompactActivityCard
                    userName={userName}
                    avatarUri={avatarUri}
                    initial={initial}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    title={a.title}
                    subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                    notes={desc}
                    distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                    paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                    timeText={`${Math.round(a.movingTimeMin)} min`}
                    showDistance={showDistance}
                    showPace={showPace}
                    onPress={() => onOpenActivity?.(a.id)}
                    onLongPress={() => onPeekDetail?.(a.id)}
                    loadingDetail={detailLoadingId === a.id}
                  />
                </View>
              );
            })
          ) : (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No sessions in this week.</Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/record")}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16 }]}
          >
            <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add a session</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Compact Activity Card (stat value size 16)
───────────────────────────────────────────── */
function CompactActivityCard({
  userName,
  avatarUri,
  initial,
  accent,
  colors,
  isDark,
  title,
  subLine,
  notes,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
  onLongPress,
  loadingDetail,
}) {
  const showNotes = (notes || "").trim().length > 0;

  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[cardStyles.wrap, { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card }]}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatarWrap, { borderColor: accent }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={cardStyles.avatarImg} />
          ) : (
            <View style={[cardStyles.avatarFallback, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}>
              <Text style={[cardStyles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.userName, { color: colors.text }]} numberOfLines={1}>
            {userName}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Feather name="activity" size={15} color={colors.text} />
            <Text style={[cardStyles.subLine, { color: colors.subtext }]} numberOfLines={1}>
              {subLine}
            </Text>
          </View>
        </View>

        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>

      {showNotes ? (
        <Text style={[cardStyles.notes, { color: colors.subtext }]} numberOfLines={3}>
          {notes}
        </Text>
      ) : null}

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <MetricBlockSmall key={m.key} label={m.label} value={m.value} colors={colors} />
        ))}
      </View>

      {loadingDetail ? (
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>Loading details…</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function MetricBlockSmall({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>{value}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { width: 54, height: 54, borderRadius: 18, borderWidth: 3, overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "900" },
  userName: { fontSize: 16, fontWeight: "900" },
  subLine: { fontSize: 13, fontWeight: "700", flex: 1 },
  title: { marginTop: 10, fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
  notes: { marginTop: 10, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  metricsRow: { marginTop: 16, flexDirection: "row", gap: 18 },
});

/* ─────────────────────────────────────────────
   Small pill (used in WeekSheet header)
───────────────────────────────────────────── */
function Pill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: {
      width: 60,
      height: 60,
      borderRadius: 16,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: { position: "absolute", inset: 0, borderRadius: 16, borderWidth: 2, borderColor: accent },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    chartWrap: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    chartTitle: { fontSize: 13, fontWeight: "900", color: colors.text },

    refreshBtnMini: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },

    connectBtn: {
      marginTop: 12,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
    },
    connectBtnText: {
      color: colors.sapOnPrimary || "#0B0B0B",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 13,
    },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      backgroundColor: colors.sapSilverLight || colors.card,
    },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },

    sectionMiniTitle: { marginTop: 10, color: colors.text, fontSize: 13, fontWeight: "900" },

    cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
    ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});

```

### app/(protected)/me/stats.jsx

```jsx
// app/(protected)/me/stats.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { API_URL } from "../../../config/api";
import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function safeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("cycling") || x.includes("bike")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}
function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
}
function formatPace(pace) {
  if (!pace || !Number.isFinite(pace)) return "—";
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}
function startOfWeekMonday(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function weekRangeLabel(weekStart) {
  const s = new Date(weekStart);
  const e = addDays(s, 6);
  const a = s.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const b = e.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${a} – ${b}`;
}
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  const now = new Date();
  const diffDays = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000
  );
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}

/* ─────────────────────────────────────────────
   ✅ “SYNC” style caching (show data even if disconnected)
───────────────────────────────────────────── */
const CACHE_KEY = "strava_cached_activities_stats_window";
const CACHE_META = "strava_cached_activities_stats_window_synced_at";

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}
async function loadCachedWindow() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const at = await AsyncStorage.getItem(CACHE_META);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      activities: Array.isArray(parsed) ? parsed : [],
      syncedAt: at ? Number(at) : 0,
    };
  } catch {
    return { activities: [], syncedAt: 0 };
  }
}
async function writeCachedWindow(activities) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(Array.isArray(activities) ? activities : []));
    await AsyncStorage.setItem(CACHE_META, String(Date.now()));
  } catch {
    // ignore
  }
}
async function tryServerSyncWindow({ days, rangeKey }) {
  if (!API_URL) return { ok: false, reason: "no_api_url" };
  const user = auth.currentUser;
  if (!user) return { ok: false, reason: "no_user" };

  const idToken = await user.getIdToken().catch(() => "");
  if (!idToken) return { ok: false, reason: "no_id_token" };

  const resp = await fetch(`${API_URL}/strava/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      scope: "activities_window",
      rangeKey, // "12w" | "26w" | "52w"
      days,
      perPage: 200,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: `http_${resp.status}`, detail: t };
  }

  const payload = await safeJson(resp);
  const arr =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.activities) && payload.activities) ||
    (Array.isArray(payload?.data?.activities) && payload.data.activities) ||
    [];

  return { ok: true, activities: arr, payload };
}
async function fetchStravaWindow(token, afterUnixSec) {
  const resp = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${afterUnixSec}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Strava error ${resp.status}: ${text}`);
  }

  const raw = await resp.json();
  return Array.isArray(raw) ? raw : [];
}

/* ============================================================================
   Stats — week trend + rolling windows (Strava-based)
   ✅ Shows cached data if Strava disconnected
============================================================================ */
export default function StatsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");

  const [acts, setActs] = useState([]); // mapped
  const [metric, setMetric] = useState("time_min"); // time_min | run_km | count | strength_min
  const [range, setRange] = useState("12w"); // 12w | 26w | 52w

  // modal
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // weekStart iso

  // sync meta
  const [syncedAt, setSyncedAt] = useState(0);

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const mapActivities = useCallback((safe) => {
    const mapped = (Array.isArray(safe) ? safe : []).map((a) => {
      const distanceKm = (a.distance || 0) / 1000;
      const when = a.start_date_local || a.start_date;
      const type = normaliseType(a.type || "Workout");
      const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

      return {
        id: String(a.id),
        title: a.name || a.type || "Workout",
        type,
        when,
        distanceKm,
        movingTimeMin: Math.round((a.moving_time || 0) / 60),
        movingTimeSec: Number(a.moving_time || 0),
        paceMinPerKm: pace,
        elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
      };
    });

    mapped.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    return mapped;
  }, []);

  const daysForRange = useMemo(() => {
    return range === "12w" ? 84 : range === "26w" ? 182 : 365;
  }, [range]);

  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // ✅ always hydrate from cache first
      const cached = await loadCachedWindow();
      if (cached.activities?.length) {
        setActs(mapActivities(cached.activities));
        setSyncedAt(cached.syncedAt || 0);
      }

      const token = await AsyncStorage.getItem("strava_access_token");
      const connected = !!token;
      setHasToken(connected);

      // If disconnected, keep cached visible
      if (!connected) return;

      const days = daysForRange;
      const after = Math.floor(addDays(new Date(), -days).getTime() / 1000);

      // Try server sync first (matches "sync" behaviour)
      const synced = await tryServerSyncWindow({ days, rangeKey: range });
      if (synced.ok) {
        const arr = Array.isArray(synced.activities) ? synced.activities : [];
        await writeCachedWindow(arr);
        const fresh = await loadCachedWindow();
        setActs(mapActivities(arr));
        setSyncedAt(fresh.syncedAt || Date.now());
        return;
      }

      // Fallback: direct Strava fetch
      const raw = await fetchStravaWindow(token, after);
      await writeCachedWindow(raw);
      const fresh = await loadCachedWindow();
      setActs(mapActivities(raw));
      setSyncedAt(fresh.syncedAt || Date.now());
    } catch (e) {
      console.error("Stats load error", e);
      setError("Couldn’t load stats. Try reconnecting in Settings.");
      // keep cached if present
    } finally {
      setLoading(false);
    }
  }, [daysForRange, mapActivities, range]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /* ─────────────────────────────────────────────
     Quick windows
  ────────────────────────────────────────────── */
  const windows = useMemo(() => {
    const now = new Date();
    const t7 = addDays(now, -7).getTime();
    const t28 = addDays(now, -28).getTime();
    const t90 = addDays(now, -90).getTime();

    const weekStart = startOfWeekMonday(now);
    const lastWeekStart = addDays(weekStart, -7);
    const weekEnd = addDays(weekStart, 7).getTime();
    const lastWeekEnd = addDays(lastWeekStart, 7).getTime();

    const empty = () => ({
      count: 0,
      timeMin: 0,
      runKm: 0,
      runTimeMin: 0,
      strengthMin: 0,
      elevM: 0,
    });

    const addAct = (acc, a) => {
      acc.count += 1;
      acc.timeMin += safeNum(a.movingTimeMin);
      acc.elevM += safeNum(a.elevGainM);
      if (a.type === "Run") {
        acc.runKm += safeNum(a.distanceKm);
        acc.runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") {
        acc.strengthMin += safeNum(a.movingTimeMin);
      }
    };

    const out = {
      d7: empty(),
      d28: empty(),
      d90: empty(),
      thisWeek: empty(),
      lastWeek: empty(),
    };

    acts.forEach((a) => {
      const t = a.when ? new Date(a.when).getTime() : 0;
      if (!t) return;

      if (t >= t7) addAct(out.d7, a);
      if (t >= t28) addAct(out.d28, a);
      if (t >= t90) addAct(out.d90, a);

      if (t >= weekStart.getTime() && t < weekEnd) addAct(out.thisWeek, a);
      if (t >= lastWeekStart.getTime() && t < lastWeekEnd) addAct(out.lastWeek, a);
    });

    const avgPace = (runKm, runTimeMin) => {
      if (runKm <= 0 || runTimeMin <= 0) return null;
      return runTimeMin / runKm;
    };

    return {
      weekStart,
      lastWeekStart,
      out,
      avgPace7: avgPace(out.d7.runKm, out.d7.runTimeMin),
      avgPace28: avgPace(out.d28.runKm, out.d28.runTimeMin),
      avgPace90: avgPace(out.d90.runKm, out.d90.runTimeMin),
      avgPaceThisWeek: avgPace(out.thisWeek.runKm, out.thisWeek.runTimeMin),
      avgPaceLastWeek: avgPace(out.lastWeek.runKm, out.lastWeek.runTimeMin),
    };
  }, [acts]);

  /* ─────────────────────────────────────────────
     Weekly series for chart
  ────────────────────────────────────────────── */
  const weeklySeries = useMemo(() => {
    const now = new Date();
    const thisWeek = startOfWeekMonday(now);

    const weeks = range === "12w" ? 12 : range === "26w" ? 26 : 52;

    const by = {};
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = addDays(thisWeek, -7 * i);
      const key = isoKey(ws);
      by[key] = {
        key,
        weekStart: ws,
        count: 0,
        timeMin: 0,
        runKm: 0,
        runTimeMin: 0,
        strengthMin: 0,
        elevM: 0,
      };
    }

    acts.forEach((a) => {
      if (!a.when) return;
      const ws = startOfWeekMonday(new Date(a.when));
      const k = isoKey(ws);
      const bucket = by[k];
      if (!bucket) return;

      bucket.count += 1;
      bucket.timeMin += safeNum(a.movingTimeMin);
      bucket.elevM += safeNum(a.elevGainM);
      if (a.type === "Run") {
        bucket.runKm += safeNum(a.distanceKm);
        bucket.runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") {
        bucket.strengthMin += safeNum(a.movingTimeMin);
      }
    });

    const series = Object.values(by).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

    const mapped = series.map((w) => ({
      ...w,
      value:
        metric === "time_min"
          ? w.timeMin
          : metric === "run_km"
          ? w.runKm
          : metric === "strength_min"
          ? w.strengthMin
          : w.count,
      label: w.weekStart.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    }));

    const max = Math.max(...mapped.map((m) => Number(m.value || 0)), 0);
    return { series: mapped, max: Math.max(1, max) };
  }, [acts, metric, range]);

  const selectedWeek = useMemo(() => {
    if (!selectedKey) return null;
    return weeklySeries.series.find((w) => w.key === selectedKey) || null;
  }, [weeklySeries.series, selectedKey]);

  const selectedWeekActivities = useMemo(() => {
    if (!selectedWeek) return [];
    const start = selectedWeek.weekStart.getTime();
    const end = addDays(selectedWeek.weekStart, 7).getTime();
    return acts
      .filter((a) => {
        const t = a.when ? new Date(a.when).getTime() : 0;
        return t >= start && t < end;
      })
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, selectedWeek]);

  const onPointPress = useCallback((w) => {
    setSelectedKey(w.key);
    setSheetOpen(true);
  }, []);

  const fmtMetric = useCallback(
    (w) => {
      if (!w) return "—";
      if (metric === "time_min") return formatHoursMin(w.value);
      if (metric === "run_km") return `${Number(w.value || 0).toFixed(1)} km`;
      if (metric === "strength_min") return `${Math.round(w.value || 0)} min`;
      return `${Math.round(w.value || 0)} sess`;
    },
    [metric]
  );

  const syncedLine = useMemo(() => {
    if (!syncedAt) return "";
    const d = new Date(syncedAt);
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return ` · Synced ${date} ${time}`;
  }, [syncedAt]);

  const hasData = acts.length > 0;

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="settings" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroAvatarWrap}>
                  {user?.photoURL ? (
                    <Image source={{ uri: user.photoURL }} style={s.heroAvatar} />
                  ) : (
                    <View style={s.heroAvatarFallback}>
                      <Text style={s.heroAvatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={s.heroAvatarBorder} />
                </View>

                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>STATS</Text>
                  <Text style={s.heroName}>Training overview</Text>
                  <Text style={s.heroSub}>
                    Strava: {hasToken ? "Connected" : "Disconnected"}
                    {syncedLine}
                    {!hasToken && hasData ? " · Showing cached data" : ""}
                    {" · "}
                    {range === "12w" ? "12 weeks" : range === "26w" ? "26 weeks" : "52 weeks"}
                  </Text>
                </View>
              </View>

              {/* CHART */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>Weekly trend</Text>
                  <TouchableOpacity onPress={onRefresh} style={s.refreshBtnMini} activeOpacity={0.85}>
                    <Feather name="refresh-cw" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 10 }}>
                  <MetricToggle
                    value={metric}
                    onChange={setMetric}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    options={[
                      { key: "time_min", label: "Time" },
                      { key: "run_km", label: "Run km" },
                      { key: "strength_min", label: "Strength" },
                      { key: "count", label: "Count" },
                    ]}
                  />
                </View>

                <View style={{ marginTop: 10 }}>
                  <MetricToggle
                    value={range}
                    onChange={setRange}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    options={[
                      { key: "12w", label: "12w" },
                      { key: "26w", label: "26w" },
                      { key: "52w", label: "52w" },
                    ]}
                  />
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasData ? (
                  <Text style={s.hint}>
                    {hasToken
                      ? "No sessions found in this range yet."
                      : "No cached stats yet. Reconnect Strava once to sync and cache your activity."}
                  </Text>
                ) : (
                  <>
                    {!hasToken ? (
                      <View style={s.cacheBanner}>
                        <Feather name="database" size={14} color={colors.text} />
                        <Text style={s.cacheBannerText}>Showing last synced data.</Text>
                      </View>
                    ) : null}

                    <WeeklyChart
                      data={weeklySeries.series}
                      max={weeklySeries.max}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      activeKey={selectedKey}
                      onPointPress={onPointPress}
                      tooltipText={(w) => (w ? `${weekRangeLabel(w.weekStart)} • ${fmtMetric(w)}` : "")}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>Tap a point to open that week.</Text>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}

                {!hasToken ? (
                  <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                    <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                    <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </LinearGradient>

          {/* QUICK STATS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="bar-chart-2" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Key numbers</Text>
              </View>
            </View>

            {!hasData ? (
              <Text style={s.hint}>
                {hasToken
                  ? "No activity data available for these cards."
                  : "Reconnect Strava to sync and cache your activity. If you already synced before, you should see cached cards here."}
              </Text>
            ) : (
              <>
                {!hasToken ? (
                  <View style={[s.cacheBanner, { marginTop: 12 }]}>
                    <Feather name="database" size={14} color={colors.text} />
                    <Text style={s.cacheBannerText}>Cards based on cached data.</Text>
                  </View>
                ) : null}

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="This week"
                  subtitle={weekRangeLabel(windows.weekStart)}
                  items={[
                    { k: "Sessions", v: String(windows.out.thisWeek.count) },
                    { k: "Time", v: formatHoursMin(windows.out.thisWeek.timeMin) },
                    { k: "Run km", v: windows.out.thisWeek.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPaceThisWeek) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last week"
                  subtitle={weekRangeLabel(windows.lastWeekStart)}
                  items={[
                    { k: "Sessions", v: String(windows.out.lastWeek.count) },
                    { k: "Time", v: formatHoursMin(windows.out.lastWeek.timeMin) },
                    { k: "Run km", v: windows.out.lastWeek.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPaceLastWeek) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last 7 days"
                  subtitle="Rolling"
                  items={[
                    { k: "Sessions", v: String(windows.out.d7.count) },
                    { k: "Time", v: formatHoursMin(windows.out.d7.timeMin) },
                    { k: "Run km", v: windows.out.d7.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPace7) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last 28 days"
                  subtitle="Rolling"
                  items={[
                    { k: "Sessions", v: String(windows.out.d28.count) },
                    { k: "Time", v: formatHoursMin(windows.out.d28.timeMin) },
                    { k: "Run km", v: windows.out.d28.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPace28) },
                  ]}
                />

                <StatGrid
                  colors={colors}
                  isDark={isDark}
                  accent={accent}
                  title="Last 90 days"
                  subtitle="Rolling"
                  items={[
                    { k: "Sessions", v: String(windows.out.d90.count) },
                    { k: "Time", v: formatHoursMin(windows.out.d90.timeMin) },
                    { k: "Run km", v: windows.out.d90.runKm.toFixed(1) },
                    { k: "Avg pace", v: formatPace(windows.avgPace90) },
                  ]}
                />
              </>
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* WEEK SHEET */}
        <WeekBreakdownSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          week={selectedWeek}
          activities={selectedWeekActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Weekly chart (clickable points)
───────────────────────────────────────────── */
function WeeklyChart({ data, max, accent, colors, isDark, activeKey, onPointPress, tooltipText }) {
  const screenW = Dimensions.get("window").width;
  const W = Math.min(392, Math.max(320, screenW - 36));
  const H = 180;

  const padTop = 18;
  const padBottom = 26;
  const padLeft = 10;
  const padRight = 10;

  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const safeMax = Math.max(1, Number(max || 0));
  const xFor = (i) => {
    if (data.length <= 1) return padLeft + innerW;
    return padLeft + (i * innerW) / (data.length - 1);
  };
  const yFor = (v) => {
    const t = clamp(Number(v || 0) / safeMax, 0, 1);
    return padTop + (1 - t) * innerH;
  };
  const baseY = padTop + innerH;

  const lineD = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`)
    .join(" ");
  const fillD = `${lineD} L ${xFor(data.length - 1).toFixed(2)} ${baseY.toFixed(2)} L ${xFor(0).toFixed(
    2
  )} ${baseY.toFixed(2)} Z`;

  const activeIndex = activeKey ? data.findIndex((p) => p.key === activeKey) : -1;
  const activePoint = activeIndex >= 0 ? data[activeIndex] : null;
  const ax = activeIndex >= 0 ? xFor(activeIndex) : 0;
  const ay = activeIndex >= 0 ? yFor(activePoint?.value) : 0;

  const tip = tooltipText?.(activePoint);

  const ticks = data
    .map((p, i) => ({ i, label: p.label }))
    .filter((t, idx) => idx === 0 || idx === data.length - 1 || idx % 4 === 0);

  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line
          x1={padLeft}
          y1={baseY}
          x2={padLeft + innerW}
          y2={baseY}
          stroke={isDark ? "#232430" : "#E1E3EA"}
          strokeWidth={1}
        />

        <Path d={fillD} fill={accent} opacity={0.16} />
        <Path d={lineD} stroke={accent} strokeWidth={3} fill="none" />

        {data.map((p, i) => (
          <Circle
            key={p.key}
            cx={xFor(i)}
            cy={yFor(p.value)}
            r={16}
            fill="transparent"
            onPress={() => onPointPress?.(p)}
          />
        ))}

        {activePoint ? (
          <>
            <Circle cx={ax} cy={ay} r={12} fill={accent} opacity={0.2} />
            <Circle cx={ax} cy={ay} r={6} fill={accent} />
            {tip ? (
              <SvgText
                x={clamp(ax, padLeft + 110, padLeft + innerW - 10)}
                y={clamp(ay - 12, padTop + 10, baseY - 10)}
                fontSize={12}
                fontWeight="900"
                fill={colors.text}
                textAnchor="middle"
              >
                {tip}
              </SvgText>
            ) : null}
          </>
        ) : null}

        {ticks.map((t) => (
          <SvgText
            key={`tick-${t.i}`}
            x={xFor(t.i)}
            y={H - 6}
            fontSize={12}
            fontWeight="800"
            fill={colors.subtext}
            textAnchor="middle"
          >
            {t.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Stat cards
───────────────────────────────────────────── */
function StatGrid({ title, subtitle, items, colors, isDark, accent }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{subtitle}</Text>
      </View>

      <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
        {items.slice(0, 2).map((it) => (
          <StatCard key={it.k} label={it.k} value={it.v} colors={colors} isDark={isDark} accent={accent} />
        ))}
      </View>
      <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
        {items.slice(2, 4).map((it) => (
          <StatCard key={it.k} label={it.k} value={it.v} colors={colors} isDark={isDark} accent={accent} />
        ))}
      </View>
    </View>
  );
}

function StatCard({ label, value, colors, isDark, accent }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 18,
        padding: 14,
        backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 10 },
        ...Platform.select({ android: { elevation: 1 } }),
      }}
    >
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 10 }} numberOfLines={1}>
        {value}
      </Text>
      <View style={{ height: 4, width: 34, borderRadius: 999, backgroundColor: accent, marginTop: 10, opacity: 0.7 }} />
    </View>
  );
}

/* ─────────────────────────────────────────────
   Toggles
───────────────────────────────────────────── */
function MetricToggle({ value, onChange, options, accent, colors, isDark }) {
  const track = isDark ? "#0E0F14" : "#FFFFFF";
  const border = isDark ? "#1B1C22" : "#E6E7EC";
  const activeBg = isDark ? "#00000066" : "#FFFFFFAA";

  return (
    <View
      style={{
        backgroundColor: track,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: border,
        padding: 4,
        flexDirection: "row",
        gap: 6,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            activeOpacity={0.9}
            onPress={() => onChange(opt.key)}
            style={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? activeBg : "transparent",
              borderWidth: active ? 1 : 0,
              borderColor: active ? accent : "transparent",
            }}
          >
            <Text style={{ fontWeight: "900", letterSpacing: 0.3, color: active ? colors.text : colors.subtext }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ─────────────────────────────────────────────
   Week breakdown sheet
───────────────────────────────────────────── */
function WeekBreakdownSheet({ open, onClose, week, activities, colors, isDark, accent, router }) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const totals = useMemo(() => {
    const out = { count: 0, timeMin: 0, runKm: 0, runTimeMin: 0, strengthMin: 0, elevM: 0 };
    (activities || []).forEach((a) => {
      out.count += 1;
      out.timeMin += safeNum(a.movingTimeMin);
      out.elevM += safeNum(a.elevGainM);
      if (a.type === "Run") {
        out.runKm += safeNum(a.distanceKm);
        out.runTimeMin += safeNum(a.movingTimeMin);
      }
      if (a.type === "Strength") out.strengthMin += safeNum(a.movingTimeMin);
    });
    return out;
  }, [activities]);

  const avgPace = useMemo(() => {
    if (totals.runKm <= 0 || totals.runTimeMin <= 0) return null;
    return totals.runTimeMin / totals.runKm;
  }, [totals.runKm, totals.runTimeMin]);

  const title = week?.weekStart ? weekRangeLabel(week.weekStart) : "Week";

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {totals.count} sessions · {formatHoursMin(totals.timeMin)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pill label="Run km" value={totals.runKm.toFixed(1)} colors={colors} isDark={isDark} />
            <Pill label="Avg pace" value={formatPace(avgPace)} colors={colors} isDark={isDark} />
            <Pill label="Strength" value={formatHoursMin(totals.strengthMin)} colors={colors} isDark={isDark} />
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {activities?.length ? (
            activities.map((a) => {
              const whenObj = a.when ? new Date(a.when) : null;
              const hasDistance = Number(a.distanceKm || 0) > 0;
              const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
              const showDistance = a.type === "Run" && hasDistance;
              const showPace = a.type === "Run" && hasDistance && hasPace;

              return (
                <View key={a.id} style={{ marginTop: 14 }}>
                  <CompactActivityCard
                    colors={colors}
                    isDark={isDark}
                    accent={accent}
                    title={a.title}
                    subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${a.type}`}
                    distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                    paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                    timeText={formatMinSec(a.movingTimeSec)}
                    showDistance={showDistance}
                    showPace={showPace}
                    onPress={() => router.push(`/me/activity/${a.id}`)}
                  />
                </View>
              );
            })
          ) : (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No sessions in this week.</Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/record")}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16 }]}
          >
            <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add a session</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Pill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Compact activity card
───────────────────────────────────────────── */
function CompactActivityCard({
  colors,
  isDark,
  accent,
  title,
  subLine,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
}) {
  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      style={[
        cardStyles.wrap,
        { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900" }} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800", marginTop: 6 }} numberOfLines={1}>
            {subLine}
          </Text>
        </View>
        <View style={{ width: 8 }} />
        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <View key={m.key} style={{ flex: 1 }}>
            <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{m.label}</Text>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>{m.value}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 4, width: 34, borderRadius: 999, backgroundColor: accent, marginTop: 12, opacity: 0.7 }} />
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  metricsRow: { marginTop: 14, flexDirection: "row", gap: 18 },
});

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: {
      width: 60,
      height: 60,
      borderRadius: 16,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: { position: "absolute", inset: 0, borderRadius: 16, borderWidth: 2, borderColor: accent },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    chartWrap: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    chartTitle: { fontSize: 13, fontWeight: "900", color: colors.text },

    refreshBtnMini: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },

    connectBtn: {
      marginTop: 12,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
    },
    connectBtnText: {
      color: colors.sapOnPrimary || "#0B0B0B",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 13,
    },

    cacheBanner: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: isDark ? "#18191E" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#2A2B33" : "#E6E7EC",
    },
    cacheBannerText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "800" },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  cta: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});

```

### app/(protected)/me/consistency.jsx

```jsx
// app/(protected)/me/consistency.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

// Firestore (nutrition days)
import { Timestamp, collection, getDocs, orderBy, query, where } from "firebase/firestore";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ✅ LOCAL date key (avoids UTC shifting from toISOString())
function isoKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// ✅ Parse YYYY-MM-DD as LOCAL date (not UTC)
function parseLocalKey(key) {
  const s = String(key || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(key); // fallback
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function formatWeekLabel(weekStart) {
  const s = new Date(weekStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `Wk of ${s}`;
}

function formatDayLabel(key) {
  const d = parseLocalKey(key);
  if (Number.isNaN(d.getTime())) return key || "";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" });
}

function sameDayKey(a, b) {
  return isoKey(a) === isoKey(b);
}

/* ─────────────────────────────────────────────
   Consistency Page
   - Training: from Strava (token in AsyncStorage: strava_access_token)
   - Nutrition: from Firestore users/{uid}/meals (date Timestamp)
   - Heatmap: last 12 weeks (84 days)
───────────────────────────────────────────── */
export default function ConsistencyPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();

  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [hasStrava, setHasStrava] = useState(false);
  const [stravaActs, setStravaActs] = useState([]); // mapped minimal

  const [meals, setMeals] = useState([]); // minimal: { id, dayKey }
  const [error, setError] = useState("");

  // mode filter
  const [mode, setMode] = useState("Both"); // Both | Training | Nutrition

  // drilldown modal
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // ✅ stabilise the range (updates on refresh)
  const [rangeKey, setRangeKey] = useState(() => isoKey(new Date()));

  const s = makeStyles(colors, isDark, accent);

  const horizonDays = 84; // 12 weeks

  const range = useMemo(() => {
    const end = startOfDay(parseLocalKey(rangeKey)); // stable “today” for this render cycle
    const start = startOfDay(addDays(end, -(horizonDays - 1)));
    return { start, end };
  }, [rangeKey, horizonDays]);

  const dayKeys = useMemo(() => {
    return Array.from({ length: horizonDays }).map((_, i) => isoKey(addDays(range.start, i)));
  }, [range.start, horizonDays]);

  /* ─────────────────────────────────────────────
     Load Strava activities (last 84 days)
  ────────────────────────────────────────────── */
  const loadStrava = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasStrava(false);
        setStravaActs([]);
        return;
      }

      setHasStrava(true);

      const after = Math.floor(range.start.getTime() / 1000);
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava consistency load error", resp.status, text);
        setError("Couldn’t load Strava. Try reconnecting in Settings.");
        setStravaActs([]);
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const mapped = safe
        .map((a) => {
          const when = a.start_date_local || a.start_date;
          const d = when ? new Date(when) : null;
          const k = d && !Number.isNaN(d.getTime()) ? isoKey(d) : "";
          return {
            id: String(a.id),
            title: a.name || a.type || "Session",
            type: a.type || "Workout",
            when,
            dayKey: k,
            minutes: Math.round((Number(a.moving_time || 0) || 0) / 60),
            distanceKm: (Number(a.distance || 0) || 0) / 1000,
          };
        })
        .filter((a) => a.dayKey);

      mapped.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
      setStravaActs(mapped);
    } catch (e) {
      console.warn("Strava consistency error", e);
      setError("Couldn’t load Strava. Try again.");
      setStravaActs([]);
    }
  }, [range.start]);

  /* ─────────────────────────────────────────────
     Load meals for horizon (Firestore)
  ────────────────────────────────────────────── */
  const loadMeals = useCallback(async () => {
    try {
      if (!user?.uid) {
        setMeals([]);
        return;
      }

      const mealsRef = collection(db, "users", user.uid, "meals");

      const qMeals = query(
        mealsRef,
        where("date", ">=", Timestamp.fromDate(range.start)),
        where("date", "<=", Timestamp.fromDate(addDays(range.end, 1))), // inclusive-ish
        orderBy("date", "desc")
      );

      const snap = await getDocs(qMeals);
      const rows = snap.docs
        .map((d) => {
          const data = d.data() || {};
          const dt = data.date?.toDate?.() || (data.date ? new Date(data.date) : null);
          const k = dt && !Number.isNaN(dt.getTime()) ? isoKey(dt) : "";
          return { id: d.id, dayKey: k };
        })
        .filter((r) => r.dayKey);

      setMeals(rows);
    } catch (e) {
      console.warn("Meals consistency error", e);
      setMeals([]);
    }
  }, [user?.uid, range.start, range.end]);

  const loadAll = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      await Promise.all([loadStrava(), loadMeals()]);
    } finally {
      setLoading(false);
    }
  }, [loadStrava, loadMeals]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRangeKey(isoKey(new Date())); // ✅ refresh range anchoring
    // loadAll will re-run via dependency change
    setRefreshing(false);
  }, []);

  /* ─────────────────────────────────────────────
     Aggregate by day
  ────────────────────────────────────────────── */
  const trainingByDay = useMemo(() => {
    const by = {};
    stravaActs.forEach((a) => {
      if (!a.dayKey) return;
      if (!by[a.dayKey]) by[a.dayKey] = { count: 0, minutes: 0, items: [] };
      by[a.dayKey].count += 1;
      by[a.dayKey].minutes += Number(a.minutes || 0) || 0;
      by[a.dayKey].items.push(a);
    });
    return by;
  }, [stravaActs]);

  const mealsByDay = useMemo(() => {
    const by = {};
    meals.forEach((m) => {
      if (!m.dayKey) return;
      if (!by[m.dayKey]) by[m.dayKey] = { count: 0 };
      by[m.dayKey].count += 1;
    });
    return by;
  }, [meals]);

  const daySeries = useMemo(() => {
    return dayKeys.map((k) => {
      const t = trainingByDay[k]?.count || 0;
      const m = mealsByDay[k]?.count || 0;

      const hasTraining = t > 0;
      const hasMeals = m > 0;

      let score = 0; // 0..3
      if (mode === "Training") {
        score = hasTraining ? clamp(t, 1, 3) : 0;
      } else if (mode === "Nutrition") {
        score = hasMeals ? clamp(m >= 3 ? 3 : m, 1, 3) : 0;
      } else {
        if (hasTraining || hasMeals) score = 1;
        if (hasTraining && hasMeals) score = 2;
        if (hasTraining && hasMeals && (m >= 3 || t >= 2)) score = 3;
      }

      return {
        dayKey: k,
        trainingCount: t,
        trainingMinutes: trainingByDay[k]?.minutes || 0,
        mealCount: m,
        score,
      };
    });
  }, [dayKeys, trainingByDay, mealsByDay, mode]);

  /* ─────────────────────────────────────────────
     Streaks + headline stats
  ────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const nowKey = isoKey(new Date());

    const hit = (d) => {
      if (mode === "Training") return d.trainingCount > 0;
      if (mode === "Nutrition") return d.mealCount > 0;
      return d.trainingCount > 0 || d.mealCount > 0;
    };

    const hits = daySeries.map((d) => (hit(d) ? 1 : 0));
    const totalHits = hits.reduce((a, b) => a + b, 0);
    const pct = (totalHits / Math.max(1, hits.length)) * 100;

    // current streak (ending today OR yesterday if today not logged yet)
    const todayIdx = daySeries.findIndex((d) => d.dayKey === nowKey);
    const startIdx = todayIdx >= 0 ? todayIdx : daySeries.length - 1;

    let cur = 0;
    for (let i = startIdx; i >= 0; i--) {
      if (hits[i] === 1) cur += 1;
      else break;
    }
    if (cur === 0 && startIdx - 1 >= 0) {
      let cur2 = 0;
      for (let i = startIdx - 1; i >= 0; i--) {
        if (hits[i] === 1) cur2 += 1;
        else break;
      }
      cur = cur2;
    }

    // best streak
    let best = 0;
    let run = 0;
    for (let i = 0; i < hits.length; i++) {
      if (hits[i] === 1) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }

    const last7 = hits.slice(-7).reduce((a, b) => a + b, 0);
    const last30 = hits.slice(-30).reduce((a, b) => a + b, 0);

    const totalSessions = daySeries.reduce((a, d) => a + d.trainingCount, 0);
    const totalMealDays = daySeries.reduce((a, d) => a + (d.mealCount > 0 ? 1 : 0), 0);

    return {
      pct,
      totalHits,
      currentStreak: cur,
      bestStreak: best,
      last7,
      last30,
      totalSessions,
      totalMealDays,
    };
  }, [daySeries, mode]);

  const weeks = useMemo(() => {
    // rolling heatmap grouped into 12 columns of 7
    const out = [];
    for (let i = 0; i < daySeries.length; i += 7) {
      const slice = daySeries.slice(i, i + 7);
      const wkStart = slice[0]?.dayKey ? parseLocalKey(slice[0].dayKey) : new Date();
      out.push({
        key: `${slice[0]?.dayKey || i}`,
        label: formatWeekLabel(wkStart),
        days: slice,
      });
    }
    return out;
  }, [daySeries]);

  const selectedDay = useMemo(() => {
    if (!selectedDayKey) return null;
    return daySeries.find((d) => d.dayKey === selectedDayKey) || null;
  }, [daySeries, selectedDayKey]);

  const selectedTrainingItems = useMemo(() => {
    if (!selectedDayKey) return [];
    return trainingByDay[selectedDayKey]?.items || [];
  }, [trainingByDay, selectedDayKey]);

  /* ───────────────────────────────────────────── */

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={onRefresh} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="refresh-cw" size={18} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="settings" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>CONSISTENCY</Text>
                  <Text style={s.heroName}>Keep the chain alive</Text>
                  <Text style={s.heroSub}>Last 12 weeks · {mode === "Both" ? "Training + Nutrition" : mode}</Text>
                </View>
              </View>

              {/* MODE TOGGLE */}
              <View style={s.modeRow}>
                {["Both", "Training", "Nutrition"].map((m) => {
                  const active = mode === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      activeOpacity={0.9}
                      onPress={() => setMode(m)}
                      style={[s.modePill, active && { backgroundColor: accent, borderColor: accent }]}
                    >
                      <Text
                        style={[
                          s.modeText,
                          active && { color: colors.sapOnPrimary || "#0B0B0B", fontWeight: "900" },
                        ]}
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* HEADLINE STATS */}
              <View style={s.kpiRow}>
                <Kpi label="Current streak" value={`${stats.currentStreak}d`} colors={colors} isDark={isDark} />
                <Kpi label="Best streak" value={`${stats.bestStreak}d`} colors={colors} isDark={isDark} />
                <Kpi label="Hit rate" value={fmtPct(stats.pct)} colors={colors} isDark={isDark} />
              </View>

              {error ? <Text style={s.error}>{error}</Text> : null}
              {!hasStrava && mode !== "Nutrition" ? (
                <Text style={s.hint}>
                  Training consistency uses Strava. Connect Strava in Settings to fill the training heatmap.
                </Text>
              ) : null}
            </View>
          </LinearGradient>

          {/* HEATMAP */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="activity" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Heatmap</Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <LegendDot level={0} colors={colors} isDark={isDark} accent={accent} />
                <LegendDot level={1} colors={colors} isDark={isDark} accent={accent} />
                <LegendDot level={2} colors={colors} isDark={isDark} accent={accent} />
                <LegendDot level={3} colors={colors} isDark={isDark} accent={accent} />
              </View>
            </View>

            {loading ? (
              <View style={{ paddingVertical: 18 }}>
                <ActivityIndicator />
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : (
              <View style={s.heatWrap}>
                {weeks.map((w, wi) => (
                  <View key={w.key} style={s.weekCol}>
                    <Text style={s.weekLabel} numberOfLines={1}>
                      {wi % 2 === 0 ? w.label : " "}
                    </Text>

                    {w.days.map((d) => {
                      const isToday = d.dayKey === isoKey(new Date());
                      return (
                        <TouchableOpacity
                          key={d.dayKey}
                          activeOpacity={0.9}
                          onPress={() => {
                            setSelectedDayKey(d.dayKey);
                            setDayOpen(true);
                          }}
                          style={[
                            s.dayDot,
                            {
                              backgroundColor: dotColor(d.score, isDark, colors, accent),
                              borderColor: isToday ? accent : "transparent",
                              borderWidth: isToday ? 2 : 0,
                            },
                          ]}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            )}

            <Text style={s.hint}>Tap a square to see what you did that day. Stronger colour = stronger day.</Text>
          </View>

          {/* SUMMARY CARDS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="trending-up" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Summary</Text>
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Last 7 days</Text>
              <Text style={s.cardBig}>
                {stats.last7} / 7 <Text style={s.cardUnit}>days hit</Text>
              </Text>
              <Text style={s.cardSub}>
                {mode === "Training"
                  ? "A hit = at least 1 Strava session"
                  : mode === "Nutrition"
                  ? "A hit = at least 1 meal logged"
                  : "A hit = training OR meals logged"}
              </Text>
            </View>

            <View style={s.card}>
              <Text style={s.cardTitle}>Last 30 days</Text>
              <Text style={s.cardBig}>
                {stats.last30} / 30 <Text style={s.cardUnit}>days hit</Text>
              </Text>

              {mode !== "Nutrition" ? <Text style={s.cardSub}>Total sessions: {stats.totalSessions}</Text> : null}
              {mode !== "Training" ? <Text style={s.cardSub}>Days with meals: {stats.totalMealDays}</Text> : null}
            </View>
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* DAY DETAIL SHEET */}
        <DayDetailSheet
          open={dayOpen}
          onClose={() => setDayOpen(false)}
          colors={colors}
          isDark={isDark}
          accent={accent}
          mode={mode}
          dayKey={selectedDayKey}
          day={selectedDay}
          trainingItems={selectedTrainingItems}
          onGoToNutrition={() => {
            if (!selectedDayKey) return;
            const d = parseLocalKey(selectedDayKey);
            router.push({ pathname: "/nutrition", params: { date: d.toISOString() } });
            setDayOpen(false);
          }}
          onGoToActivity={(id) => {
            if (!id) return;
            router.push(`/me/activity/${id}`);
            setDayOpen(false);
          }}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   UI bits
───────────────────────────────────────────── */
function Kpi({ label, value, colors, isDark }) {
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? "#111217" : "#F3F4F6", borderRadius: 18, padding: 12 }}>
      <Text style={{ color: colors.subtext, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 }}>{value}</Text>
    </View>
  );
}

function LegendDot({ level, colors, isDark, accent }) {
  return (
    <View
      style={{
        width: 12,
        height: 12,
        borderRadius: 4,
        backgroundColor: dotColor(level, isDark, colors, accent),
      }}
    />
  );
}

function dotColor(score, isDark, colors, accent) {
  if (!score) return isDark ? "#1B1C22" : "#E6E7EC";
  if (score === 1) return isDark ? accent + "66" : accent + "55";
  if (score === 2) return isDark ? accent + "AA" : accent + "88";
  return accent; // 3
}

/* ─────────────────────────────────────────────
   Day Detail Sheet
───────────────────────────────────────────── */
function DayDetailSheet({
  open,
  onClose,
  colors,
  isDark,
  accent,
  mode,
  dayKey,
  day,
  trainingItems,
  onGoToNutrition,
  onGoToActivity,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const title = useMemo(() => formatDayLabel(dayKey || ""), [dayKey]);

  const trainingCount = day?.trainingCount || 0;
  const trainingMin = day?.trainingMinutes || 0;
  const mealCount = day?.mealCount || 0;

  const showTraining = mode !== "Nutrition";
  const showNutrition = mode !== "Training";

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>{mode === "Both" ? "Training + Nutrition" : mode}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            {showTraining ? <Pill label="Sessions" value={`${trainingCount}`} colors={colors} isDark={isDark} /> : null}
            {showTraining ? <Pill label="Minutes" value={`${trainingMin}`} colors={colors} isDark={isDark} /> : null}
            {showNutrition ? <Pill label="Meals" value={`${mealCount}`} colors={colors} isDark={isDark} /> : null}
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {/* TRAINING LIST */}
          {showTraining ? (
            <View style={{ marginTop: 8 }}>
              <Text style={sheetStyles.sectionLabel(colors)}>Training</Text>

              {trainingItems?.length ? (
                trainingItems.slice(0, 12).map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    activeOpacity={0.9}
                    onPress={() => onGoToActivity?.(a.id)}
                    style={[sheetStyles.row(isDark), { borderColor: isDark ? "#1F2128" : "#E1E3E8" }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={sheetStyles.rowTitle(colors)} numberOfLines={1}>
                        {a.title}
                      </Text>
                      <Text style={sheetStyles.rowSub(colors)} numberOfLines={1}>
                        {a.type} · {Math.max(0, Number(a.minutes || 0))} min
                        {Number(a.distanceKm || 0) > 0 ? ` · ${a.distanceKm.toFixed(2)} km` : ""}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.subtext} />
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No Strava sessions on this day.</Text>
              )}
            </View>
          ) : null}

          {/* NUTRITION CTA */}
          {showNutrition ? (
            <View style={{ marginTop: 18 }}>
              <Text style={sheetStyles.sectionLabel(colors)}>Nutrition</Text>

              <View style={[sheetStyles.box(isDark), { borderColor: isDark ? "#1F2128" : "#E1E3E8" }]}>
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 14 }}>Meals logged: {mealCount}</Text>
                <Text style={{ marginTop: 6, color: colors.subtext, fontWeight: "700", lineHeight: 18 }}>
                  Tap below to jump to Nutrition for this date.
                </Text>

                <TouchableOpacity
                  activeOpacity={0.92}
                  onPress={onGoToNutrition}
                  style={[stylesGlobal.ctaSmall, { backgroundColor: accent, marginTop: 12 }]}
                >
                  <Feather name="external-link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={[stylesGlobal.ctaSmallText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Open Nutrition</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Pill({ label, value, colors, isDark }) {
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? "#111217" : "#F3F4F6", borderRadius: 999, paddingVertical: 10, paddingHorizontal: 12 }}>
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const sheetStyles = {
  sectionLabel: (colors) => ({
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 10,
  }),
  row: (isDark) => ({
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: isDark ? "#111217" : "#F3F4F6",
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  }),
  rowTitle: (colors) => ({ color: colors.text, fontWeight: "900", fontSize: 14 }),
  rowSub: (colors) => ({ marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 }),
  box: (isDark) => ({
    borderRadius: 18,
    padding: 14,
    backgroundColor: isDark ? "#111217" : "#F3F4F6",
    borderWidth: StyleSheet.hairlineWidth,
  }),
};

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    modeRow: { flexDirection: "row", gap: 8, marginTop: 14 },
    modePill: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : "#E1E3E8",
    },
    modeText: {
      color: colors.text,
      fontWeight: "800",
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },

    kpiRow: { flexDirection: "row", gap: 10, marginTop: 14 },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },

    heatWrap: {
      marginTop: 12,
      flexDirection: "row",
      gap: 8,
      padding: 12,
      borderRadius: 18,
      backgroundColor: isDark ? "#111217" : (colors.sapSilverLight || "#F3F4F6"),
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    weekCol: { alignItems: "center", gap: 6 },
    weekLabel: { color: colors.subtext, fontSize: 10, fontWeight: "900", width: 54, textAlign: "center" },
    dayDot: { width: 14, height: 14, borderRadius: 4 },

    card: {
      marginTop: 12,
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "#111217" : (colors.sapSilverLight || "#F3F4F6"),
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : "#E1E3E8",
    },
    cardTitle: { color: colors.subtext, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 },
    cardBig: { marginTop: 8, color: colors.text, fontSize: 22, fontWeight: "900" },
    cardUnit: { fontSize: 12, color: colors.subtext, fontWeight: "900" },
    cardSub: { marginTop: 6, color: colors.subtext, fontSize: 13, fontWeight: "700", lineHeight: 18 },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13, fontWeight: "800" },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  ctaSmall: {
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaSmallText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});

```

### app/(protected)/me/insights.jsx

```jsx
// app/(protected)/me/insights.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";

import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}
function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
}
function formatPace(pace) {
  if (!pace || !Number.isFinite(pace)) return "—";
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffDays = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000
  );
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("cycling") || x.includes("bike")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}
function fmtPct(n) {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}
function safeNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ============================================================================
   Insights — training insight + patterns (Strava-backed)
============================================================================ */
export default function InsightsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");

  const [acts, setActs] = useState([]); // mapped
  const [rangeDays, setRangeDays] = useState(28); // 7/28/90

  // day tap on chart
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // details cache (device + notes optional)
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState({});

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasToken(false);
        setActs([]);
        return;
      }
      setHasToken(true);

      const after = Math.floor(daysAgo(Math.max(7, rangeDays + 7)).getTime() / 1000); // extra buffer
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava insights load error", resp.status, text);
        setError("Couldn’t load Strava. Try reconnecting in Settings.");
        setActs([]);
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const mapped = safe.map((a) => {
        const distanceKm = (a.distance || 0) / 1000;
        const when = a.start_date_local || a.start_date;
        const type = normaliseType(a.type || "Workout");
        const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

        return {
          id: String(a.id),
          title: a.name || a.type || "Workout",
          type,
          rawType: a.type || "Workout",
          when,
          distanceKm,
          movingTimeMin: Math.round((a.moving_time || 0) / 60),
          movingTimeSec: Number(a.moving_time || 0),
          paceMinPerKm: pace,
          elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
          description: a.description || "",
          deviceName: a.device_name || "",
        };
      });

      mapped.sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : 0;
        const tb = b.when ? new Date(b.when).getTime() : 0;
        return tb - ta;
      });

      // keep only range window for analysis (end = today)
      const cut = startOfDay(daysAgo(rangeDays - 1)).getTime();
      setActs(mapped.filter((a) => (a.when ? new Date(a.when).getTime() : 0) >= cut));
    } catch (e) {
      console.error("Insights load error", e);
      setError("Couldn’t load insight data. Try again.");
      setActs([]);
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const fetchDetailIfNeeded = useCallback(
    async (id) => {
      try {
        if (!id) return;
        if (detailCache[id]) return;

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) return;

        setDetailLoadingId(id);

        const resp = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) return;

        const detail = await resp.json();
        setDetailCache((prev) => ({ ...prev, [id]: detail }));
      } catch {
        // ignore
      } finally {
        setDetailLoadingId("");
      }
    },
    [detailCache]
  );

  /* ─────────────────────────────────────────────
     Daily series for chart
     - Bars: total minutes
     - Line: run km
  ────────────────────────────────────────────── */
  const dailySeries = useMemo(() => {
    const by = {};
    acts.forEach((a) => {
      if (!a.when) return;
      const k = isoKey(a.when);
      if (!k) return;
      if (!by[k]) by[k] = { timeMin: 0, runKm: 0, count: 0, strengthMin: 0 };
      by[k].count += 1;
      by[k].timeMin += safeNum(a.movingTimeMin);
      if (a.type === "Run") by[k].runKm += safeNum(a.distanceKm);
      if (a.type === "Strength") by[k].strengthMin += safeNum(a.movingTimeMin);
    });

    const start = startOfDay(daysAgo(rangeDays - 1));
    const out = [];
    for (let i = 0; i < rangeDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = isoKey(d);
      out.push({
        key: k,
        dateObj: d,
        label: i === 0 || i === rangeDays - 1 ? d.getDate().toString() : "",
        timeMin: by[k]?.timeMin || 0,
        runKm: by[k]?.runKm || 0,
        count: by[k]?.count || 0,
        strengthMin: by[k]?.strengthMin || 0,
      });
    }
    return out;
  }, [acts, rangeDays]);

  const chart = useMemo(() => {
    const maxTime = Math.max(...dailySeries.map((d) => d.timeMin), 0);
    const maxRun = Math.max(...dailySeries.map((d) => d.runKm), 0);
    return {
      maxTime: Math.max(1, maxTime),
      maxRun: Math.max(1, maxRun),
    };
  }, [dailySeries]);

  /* ─────────────────────────────────────────────
     Insights calculations
  ────────────────────────────────────────────── */
  const insights = useMemo(() => {
    const totalActs = acts.length;
    const totalTimeMin = acts.reduce((s, a) => s + safeNum(a.movingTimeMin), 0);

    const runActs = acts.filter((a) => a.type === "Run");
    const runKm = runActs.reduce((s, a) => s + safeNum(a.distanceKm), 0);
    const runTimeMin = runActs.reduce((s, a) => s + safeNum(a.movingTimeMin), 0);

    const strengthActs = acts.filter((a) => a.type === "Strength");
    const strengthMin = strengthActs.reduce((s, a) => s + safeNum(a.movingTimeMin), 0);

    const otherMin = totalTimeMin - runTimeMin - strengthMin;

    // frequency
    const daysWithTraining = new Set(acts.map((a) => isoKey(a.when)).filter(Boolean)).size;
    const sessionsPerWeek = rangeDays > 0 ? (totalActs / rangeDays) * 7 : 0;

    // consistency streak (up to today)
    const trainedDays = new Set(dailySeries.filter((d) => d.count > 0).map((d) => d.key));
    let streak = 0;
    for (let i = 0; i < rangeDays; i++) {
      const k = isoKey(daysAgo(i));
      if (trainedDays.has(k)) streak += 1;
      else break;
    }

    // best week in range (time minutes)
    let bestWeekMin = 0;
    let bestWeekStart = null;
    for (let i = 0; i <= rangeDays - 7; i++) {
      const sum = dailySeries.slice(i, i + 7).reduce((s, x) => s + safeNum(x.timeMin), 0);
      if (sum > bestWeekMin) {
        bestWeekMin = sum;
        bestWeekStart = dailySeries[i]?.dateObj || null;
      }
    }

    // weekday pattern
    const byDow = Array.from({ length: 7 }, (_, idx) => ({ idx, count: 0, timeMin: 0, runKm: 0 }));
    dailySeries.forEach((d) => {
      const dow = d.dateObj.getDay(); // 0 Sun
      byDow[dow].count += d.count;
      byDow[dow].timeMin += d.timeMin;
      byDow[dow].runKm += d.runKm;
    });
    const peakDay = [...byDow].sort((a, b) => b.timeMin - a.timeMin)[0];

    // intensity proxy (run pace buckets)
    const pacedRuns = runActs
      .map((r) => ({ pace: r.paceMinPerKm, minutes: r.movingTimeMin }))
      .filter((x) => Number.isFinite(x.pace) && x.pace > 0 && x.minutes > 0);

    // buckets: easy (>5:15), steady (4:30–5:15), hard (<4:30)
    let easyMin = 0,
      steadyMin = 0,
      hardMin = 0;
    pacedRuns.forEach((x) => {
      if (x.pace > 5.25) easyMin += x.minutes;
      else if (x.pace >= 4.5) steadyMin += x.minutes;
      else hardMin += x.minutes;
    });
    const pacedTotal = easyMin + steadyMin + hardMin || 1;

    const recs = [];
    if (sessionsPerWeek < 3) recs.push("Build consistency: aim for 3–4 sessions/week.");
    if (runKm > 0 && hardMin / pacedTotal > 0.35)
      recs.push("A lot of hard running — keep most runs easy to recover.");
    if (runKm > 0 && easyMin / pacedTotal < 0.45)
      recs.push("Add more easy minutes to support speed gains.");
    if (strengthMin < 60 && rangeDays >= 28) recs.push("Strength is light — 2 short sessions/week would help.");
    if (!recs.length) recs.push("You’re well balanced — keep the routine and progress gradually.");

    return {
      totalActs,
      totalTimeMin,
      runKm,
      runActs: runActs.length,
      runTimeMin,
      strengthActs: strengthActs.length,
      strengthMin,
      otherMin,
      daysWithTraining,
      sessionsPerWeek,
      streak,
      bestWeekMin,
      bestWeekStart,
      peakDay,
      easyMin,
      steadyMin,
      hardMin,
      recs,
    };
  }, [acts, dailySeries, rangeDays]);

  /* ─────────────────────────────────────────────
     Day modal data
  ────────────────────────────────────────────── */
  const selectedDayActivities = useMemo(() => {
    if (!selectedDayKey) return [];
    return acts
      .filter((a) => isoKey(a.when) === selectedDayKey)
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [acts, selectedDayKey]);

  const selectedDayTotals = useMemo(() => {
    const list = selectedDayActivities;
    const timeMin = list.reduce((s, x) => s + safeNum(x.movingTimeMin), 0);
    const runKm = list.filter((x) => x.type === "Run").reduce((s, x) => s + safeNum(x.distanceKm), 0);
    return { timeMin, runKm, count: list.length };
  }, [selectedDayActivities]);

  const onBarPress = useCallback((p) => {
    setSelectedDayKey(p.key);
    setDayOpen(true);
  }, []);

  const rangeLabel = useMemo(() => {
    if (rangeDays === 7) return "This week";
    if (rangeDays === 28) return "Last 28 days";
    return "Last 90 days";
  }, [rangeDays]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="settings" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroAvatarWrap}>
                  {user?.photoURL ? (
                    <Image source={{ uri: user.photoURL }} style={s.heroAvatar} />
                  ) : (
                    <View style={s.heroAvatarFallback}>
                      <Text style={s.heroAvatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={s.heroAvatarBorder} />
                </View>

                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>INSIGHTS</Text>
                  <Text style={s.heroName}>Training insights</Text>
                  <Text style={s.heroSub}>
                    {rangeLabel} · Strava: {hasToken ? "Connected" : "Not connected"}
                  </Text>
                </View>
              </View>

              {/* RANGE TOGGLE */}
              <View style={{ marginTop: 12 }}>
                <RangeToggle
                  value={rangeDays}
                  onChange={setRangeDays}
                  accent={accent}
                  colors={colors}
                  isDark={isDark}
                  options={[
                    { key: 7, label: "7d" },
                    { key: 28, label: "28d" },
                    { key: 90, label: "90d" },
                  ]}
                />
              </View>

              {/* CHART */}
              <View style={s.chartWrap}>
                <View style={s.chartHeaderRow}>
                  <Text style={s.chartTitle}>Training load</Text>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const todayKey = isoKey(new Date());
                      setSelectedDayKey(todayKey);
                      setDayOpen(true);
                    }}
                    style={s.chartAction}
                  >
                    <Text style={s.chartActionText}>Open today</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : !hasToken ? (
                  <Text style={s.hint}>Connect Strava to see insights.</Text>
                ) : (
                  <>
                    <CleanBarsWithLine
                      data={dailySeries}
                      maxBars={chart.maxTime}
                      maxLine={chart.maxRun}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onBarPress={onBarPress}
                      activeKey={selectedDayKey}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>
                      Bars = total minutes · Line = run km · Tap a day for details
                    </Text>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}
              </View>

              {!hasToken ? (
                <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                  <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </LinearGradient>

          {/* INSIGHT CARDS */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="bar-chart-2" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Overview</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={s.grid}>
              <InsightCard
                title="Sessions"
                value={String(insights.totalActs)}
                sub={`${insights.daysWithTraining} days trained`}
                s={s}
              />
              <InsightCard
                title="Time"
                value={formatHoursMin(insights.totalTimeMin)}
                sub={`${insights.sessionsPerWeek.toFixed(1)}/week`}
                s={s}
              />
              <InsightCard title="Run km" value={insights.runKm.toFixed(1)} sub={`${insights.runActs} runs`} s={s} />
              <InsightCard title="Streak" value={`${insights.streak} days`} sub="Up to today" s={s} />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Distribution</Text>
            <View style={s.splitWrap}>
              <SplitRow
                label="Running"
                pct={fmtPct((insights.runTimeMin / Math.max(1, insights.totalTimeMin)) * 100)}
                value={formatHoursMin(insights.runTimeMin)}
                colors={colors}
              />
              <SplitRow
                label="Strength"
                pct={fmtPct((insights.strengthMin / Math.max(1, insights.totalTimeMin)) * 100)}
                value={formatHoursMin(insights.strengthMin)}
                colors={colors}
              />
              <SplitRow
                label="Other"
                pct={fmtPct((insights.otherMin / Math.max(1, insights.totalTimeMin)) * 100)}
                value={formatHoursMin(insights.otherMin)}
                colors={colors}
              />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Running intensity (pace proxy)</Text>
            <View style={s.splitWrap}>
              <SplitRow
                label="Easy"
                pct={fmtPct(
                  (insights.easyMin / Math.max(1, insights.easyMin + insights.steadyMin + insights.hardMin)) * 100
                )}
                value={formatHoursMin(insights.easyMin)}
                colors={colors}
              />
              <SplitRow
                label="Steady"
                pct={fmtPct(
                  (insights.steadyMin / Math.max(1, insights.easyMin + insights.steadyMin + insights.hardMin)) * 100
                )}
                value={formatHoursMin(insights.steadyMin)}
                colors={colors}
              />
              <SplitRow
                label="Hard"
                pct={fmtPct(
                  (insights.hardMin / Math.max(1, insights.easyMin + insights.steadyMin + insights.hardMin)) * 100
                )}
                value={formatHoursMin(insights.hardMin)}
                colors={colors}
              />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Patterns</Text>
            <View style={s.patternWrap}>
              <PatternTile
                title="Peak day"
                value={insights.peakDay ? DOW[insights.peakDay.idx] : "—"}
                sub={insights.peakDay ? `${Math.round(insights.peakDay.timeMin)} min` : ""}
                colors={colors}
                isDark={isDark}
              />
              <PatternTile
                title="Best week"
                value={insights.bestWeekMin ? formatHoursMin(insights.bestWeekMin) : "—"}
                sub={
                  insights.bestWeekStart
                    ? `From ${insights.bestWeekStart.toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })}`
                    : ""
                }
                colors={colors}
                isDark={isDark}
              />
              <PatternTile
                title="Avg run pace"
                value={(() => {
                  const runOnly = acts.filter((a) => a.type === "Run" && a.distanceKm > 0 && a.movingTimeSec > 0);
                  const totalKm = runOnly.reduce((s, a) => s + a.distanceKm, 0);
                  const totalSec = runOnly.reduce((s, a) => s + a.movingTimeSec, 0);
                  return formatPace(paceMinPerKm(totalKm, totalSec));
                })()}
                sub="Weighted by distance"
                colors={colors}
                isDark={isDark}
              />
            </View>

            <Text style={[s.sectionMiniTitle, { marginTop: 16 }]}>Coaching notes</Text>
            <View style={s.recsWrap}>
              {insights.recs.map((r, idx) => (
                <View key={idx} style={s.recRow}>
                  <View style={s.bullet} />
                  <Text style={s.recText}>{r}</Text>
                </View>
              ))}
            </View>

            {/* Quick actions */}
            <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push("/record")}
                style={[s.cta, { backgroundColor: accent, flex: 1 }]}
              >
                <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                <Text style={[s.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add session</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => router.push("/me/month")}
                style={[
                  s.cta,
                  {
                    flex: 1,
                    backgroundColor: "transparent",
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: isDark ? "rgba(255,255,255,0.18)" : "#D8DCE5",
                  },
                ]}
              >
                <Feather name="calendar" size={16} color={colors.text} />
                <Text style={[s.ctaText, { color: colors.text }]}>Month</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* DAY MODAL */}
        <DaySheet
          open={dayOpen}
          onClose={() => setDayOpen(false)}
          dayDate={selectedDayKey ? new Date(selectedDayKey) : null}
          totals={selectedDayTotals}
          activities={selectedDayActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          onOpenActivity={(id) => router.push(`/me/activity/${id}`)}
          onPeekDetail={fetchDetailIfNeeded}
          detailCache={detailCache}
          detailLoadingId={detailLoadingId}
          userName={displayName}
          avatarUri={user?.photoURL || ""}
          initial={initial}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Clean clickable bars + line chart
   - Bars: minutes
   - Line: run km
   FIX: no <View> inside <Svg> (use <G>)
───────────────────────────────────────────── */
function CleanBarsWithLine({ data, maxBars, maxLine, accent, colors, isDark, onBarPress, activeKey }) {
  const screenW = Dimensions.get("window").width;
  const W = Math.min(390, Math.max(320, screenW - 36));
  const H = 190;

  const padTop = 16;
  const padBottom = 26;
  const padLeft = 6;
  const padRight = 44;

  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;

  const barW = innerW / Math.max(1, data.length);
  const barGap = Math.max(1, Math.round(barW * 0.2));
  const barInnerW = Math.max(2, barW - barGap);

  const xForBar = (i) => padLeft + i * barW + barGap / 2;
  const yForBar = (v) => {
    const t = clamp(Number(v || 0) / Math.max(1, maxBars), 0, 1);
    return padTop + (1 - t) * innerH;
  };
  const baseY = padTop + innerH;

  const xForLine = (i) => {
    if (data.length <= 1) return padLeft + innerW;
    return padLeft + (i * innerW) / (data.length - 1);
  };
  const yForLine = (v) => {
    const t = clamp(Number(v || 0) / Math.max(1, maxLine), 0, 1);
    return padTop + (1 - t) * innerH;
  };

  const lineD = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForLine(i).toFixed(2)} ${yForLine(p.runKm).toFixed(2)}`)
    .join(" ");

  const midY = padTop + innerH * 0.5;

  const labelIdxs = useMemo(() => {
    const out = new Set([0, Math.max(0, data.length - 1)]);
    const step = Math.max(1, Math.round(data.length / 4));
    for (let i = 0; i < data.length; i += step) out.add(i);
    return Array.from(out).sort((a, b) => a - b);
  }, [data.length]);

  const activeIndex = activeKey ? data.findIndex((d) => d.key === activeKey) : -1;

  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line
          x1={padLeft}
          y1={midY}
          x2={padLeft + innerW}
          y2={midY}
          stroke={isDark ? "#262730" : "#E1E3EA"}
          strokeWidth={1}
        />

        {/* Bars */}
        {data.map((p, i) => {
          const x = xForBar(i);
          const y = yForBar(p.timeMin);
          const h = baseY - y;
          const active = i === activeIndex;

          // Make the hit target cover the bar area
          const hitCx = x + barInnerW / 2;
          const hitCy = y + h / 2;
          const hitR = Math.max(12, barInnerW * 0.9);

          return (
            <G key={p.key}>
              <Path
                d={`M ${x} ${baseY} L ${x} ${y} L ${x + barInnerW} ${y} L ${x + barInnerW} ${baseY} Z`}
                fill={isDark ? "#20222B" : "#E6E7EC"}
                opacity={active ? 1 : 0.92}
              />
              <Circle cx={hitCx} cy={hitCy} r={hitR} fill="transparent" onPress={() => onBarPress?.(p)} />
            </G>
          );
        })}

        {/* Line */}
        <Path d={lineD} stroke={accent} strokeWidth={3} fill="none" />

        {/* Active marker */}
        {activeIndex >= 0 ? (
          (() => {
            const p = data[activeIndex];
            const ax = xForLine(activeIndex);
            const ay = yForLine(p.runKm);
            const tip = `${p.dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} • ${Math.round(
              p.timeMin
            )} min • ${p.runKm.toFixed(1)} km`;

            return (
              <G>
                <Circle cx={ax} cy={ay} r={12} fill={accent} opacity={0.18} />
                <Circle cx={ax} cy={ay} r={6} fill={accent} />
                <SvgText
                  x={clamp(ax, padLeft + 80, padLeft + innerW - 10)}
                  y={clamp(ay - 12, padTop + 12, baseY - 12)}
                  fontSize={12}
                  fontWeight="900"
                  fill={colors.text}
                  textAnchor="middle"
                >
                  {tip}
                </SvgText>
              </G>
            );
          })()
        ) : null}

        {/* Right axis labels */}
        <SvgText x={padLeft + innerW + 8} y={padTop + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {Math.round(maxBars)}m
        </SvgText>
        <SvgText x={padLeft + innerW + 8} y={midY + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          {Math.round(maxBars * 0.5)}m
        </SvgText>
        <SvgText x={padLeft + innerW + 8} y={baseY + 4} fontSize={12} fontWeight="800" fill={colors.subtext}>
          0
        </SvgText>

        {/* X labels */}
        {labelIdxs.map((i) => (
          <SvgText
            key={`tick-${i}`}
            x={xForLine(i)}
            y={H - 6}
            fontSize={12}
            fontWeight="800"
            fill={colors.subtext}
            textAnchor="middle"
          >
            {data[i]?.dateObj?.getDate?.() || ""}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Day Sheet (normal sized cards + hide distance/pace if missing)
───────────────────────────────────────────── */
function DaySheet({
  open,
  onClose,
  dayDate,
  totals,
  activities,
  colors,
  isDark,
  accent,
  router,
  onOpenActivity,
  onPeekDetail,
  detailCache,
  detailLoadingId,
  userName,
  avatarUri,
  initial,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>
                {dayDate
                  ? dayDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" })
                  : "Day"}
              </Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {dayDate ? dayDate.toLocaleDateString("en-GB") : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pill label="Sessions" value={String(totals?.count || 0)} colors={colors} isDark={isDark} />
            <Pill label="Time" value={formatHoursMin(totals?.timeMin || 0)} colors={colors} isDark={isDark} />
            <Pill label="Run km" value={(totals?.runKm || 0).toFixed(1)} colors={colors} isDark={isDark} />
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {activities?.length ? (
            activities.map((a) => {
              const detail = detailCache?.[a.id];
              const whenObj = a.when ? new Date(a.when) : null;
              const deviceLine = detail?.device_name || a.deviceName || "Strava";
              const desc = detail?.description || a.description || "";

              const hasDistance = Number(a.distanceKm || 0) > 0;
              const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
              const showDistance = a.type === "Run" && hasDistance;
              const showPace = a.type === "Run" && hasDistance && hasPace;

              return (
                <View key={a.id} style={{ marginTop: 14 }}>
                  <CompactActivityCard
                    userName={userName}
                    avatarUri={avatarUri}
                    initial={initial}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    title={a.title}
                    subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                    notes={desc}
                    distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                    paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                    timeText={formatMinSec(a.movingTimeSec)}
                    showDistance={showDistance}
                    showPace={showPace}
                    onPress={() => onOpenActivity?.(a.id)}
                    onLongPress={() => onPeekDetail?.(a.id)}
                    loadingDetail={detailLoadingId === a.id}
                  />
                </View>
              );
            })
          ) : (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No sessions on this day.</Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/record")}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16 }]}
          >
            <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add a session</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Components
───────────────────────────────────────────── */
function RangeToggle({ value, onChange, options, accent, colors, isDark }) {
  const track = isDark ? "#0E0F14" : "#FFFFFF";
  const border = isDark ? "#1B1C22" : "#E6E7EC";
  const activeBg = isDark ? "#00000066" : "#FFFFFFAA";

  return (
    <View
      style={{
        backgroundColor: track,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: border,
        padding: 4,
        flexDirection: "row",
        gap: 6,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <TouchableOpacity
            key={opt.key}
            activeOpacity={0.9}
            onPress={() => onChange(opt.key)}
            style={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? activeBg : "transparent",
              borderWidth: active ? 1 : 0,
              borderColor: active ? accent : "transparent",
            }}
          >
            <Text style={{ fontWeight: "900", letterSpacing: 0.3, color: active ? colors.text : colors.subtext }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function InsightCard({ title, value, sub, s }) {
  return (
    <View style={s.insightCard}>
      <Text style={s.insightTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={s.insightValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.insightSub} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

function SplitRow({ label, pct, value, colors }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 }}>
      <Text style={{ color: colors.text, fontWeight: "900" }}>{label}</Text>
      <Text style={{ color: colors.subtext, fontWeight: "900" }}>
        {pct} · {value}
      </Text>
    </View>
  );
}

function PatternTile({ title, value, sub, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 18,
        padding: 14,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
      }}
    >
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6 }} numberOfLines={1}>
        {sub}
      </Text>
    </View>
  );
}

function Pill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Compact Activity Card
   - hides distance/pace if missing
───────────────────────────────────────────── */
function CompactActivityCard({
  userName,
  avatarUri,
  initial,
  accent,
  colors,
  isDark,
  title,
  subLine,
  notes,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
  onLongPress,
  loadingDetail,
}) {
  const showNotes = (notes || "").trim().length > 0;

  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[cardStyles.wrap, { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card }]}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatarWrap, { borderColor: accent }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={cardStyles.avatarImg} />
          ) : (
            <View style={[cardStyles.avatarFallback, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}>
              <Text style={[cardStyles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.userName, { color: colors.text }]} numberOfLines={1}>
            {userName}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Feather name="activity" size={15} color={colors.text} />
            <Text style={[cardStyles.subLine, { color: colors.subtext }]} numberOfLines={1}>
              {subLine}
            </Text>
          </View>
        </View>

        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>

      {showNotes ? (
        <Text style={[cardStyles.notes, { color: colors.subtext }]} numberOfLines={3}>
          {notes}
        </Text>
      ) : null}

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <MetricBlockSmall key={m.key} label={m.label} value={m.value} colors={colors} />
        ))}
      </View>

      {loadingDetail ? (
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>Loading details…</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function MetricBlockSmall({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>{value}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { width: 54, height: 54, borderRadius: 18, borderWidth: 3, overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "900" },
  userName: { fontSize: 16, fontWeight: "900" },
  subLine: { fontSize: 13, fontWeight: "700", flex: 1 },
  title: { marginTop: 10, fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
  notes: { marginTop: 10, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  metricsRow: { marginTop: 16, flexDirection: "row", gap: 18 },
});

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: {
      width: 60,
      height: 60,
      borderRadius: 16,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: { position: "absolute", inset: 0, borderRadius: 16, borderWidth: 2, borderColor: accent },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    chartWrap: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    chartHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    chartTitle: { fontSize: 13, fontWeight: "900", color: colors.text },
    chartAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
    },
    chartActionText: { fontSize: 12, fontWeight: "900", color: colors.text },

    connectBtn: {
      marginTop: 12,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
    },
    connectBtnText: {
      color: colors.sapOnPrimary || "#0B0B0B",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 13,
    },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      backgroundColor: colors.sapSilverLight || colors.card,
    },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },

    grid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 10 },
    insightCard: {
      width: "48%",
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    insightTitle: { color: colors.subtext, fontSize: 12, fontWeight: "900" },
    insightValue: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 },
    insightSub: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6 },

    sectionMiniTitle: { marginTop: 10, color: colors.text, fontSize: 13, fontWeight: "900" },
    splitWrap: {
      marginTop: 10,
      backgroundColor: isDark ? "#111217" : "#F3F4F6",
      borderRadius: 18,
      paddingHorizontal: 14,
    },

    patternWrap: { marginTop: 10, flexDirection: "row", gap: 10 },

    recsWrap: {
      marginTop: 10,
      backgroundColor: isDark ? "#111217" : "#F3F4F6",
      borderRadius: 18,
      padding: 14,
    },
    recRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 10 },
    bullet: { width: 8, height: 8, borderRadius: 999, backgroundColor: accent, marginTop: 6 },
    recText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },

    cta: {
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  cta: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});

```

### app/(protected)/me/prs.jsx

```jsx
// app/(protected)/me/prs.jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { API_URL } from "../../../config/api";
import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function formatPace(paceMinPerKm) {
  if (!paceMinPerKm || !Number.isFinite(paceMinPerKm)) return "—";
  const mins = Math.floor(paceMinPerKm);
  const secs = Math.round((paceMinPerKm - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}
function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
}
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  const now = new Date();
  const diffDays = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000
  );
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("cycling") || x.includes("bike")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}
function prettyDistanceKm(km) {
  if (!km || !Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

/* Best-effort parser from activity detail */
function bestEffortSeconds(detail, targetMeters) {
  const eff = Array.isArray(detail?.best_efforts) ? detail.best_efforts : [];
  const match = eff.find((e) => Number(e?.distance) === Number(targetMeters));
  if (match?.elapsed_time) return Number(match.elapsed_time);
  return null;
}

/* ─────────────────────────────────────────────
   ALL-TIME Strava pagination loader (fallback)
───────────────────────────────────────────── */
async function fetchStravaActivitiesAllTime(token, { maxPages = 30 } = {}) {
  const perPage = 200;
  let page = 1;
  const all = [];

  while (page <= maxPages) {
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Strava error ${resp.status}: ${text}`);
    }

    const batch = await resp.json();
    const safe = Array.isArray(batch) ? batch : [];
    all.push(...safe);

    if (safe.length < perPage) break;
    page += 1;
  }

  return all;
}

/* ─────────────────────────────────────────────
   ✅ “SYNC” loader (matches app’s sync behaviour)
   - Shows cached data even if Strava is disconnected
   - Tries server sync if token exists
   - Falls back to direct Strava fetch if server sync fails
───────────────────────────────────────────── */
const CACHE_KEY = "strava_cached_activities_alltime";
const CACHE_SYNC_AT = "strava_cached_activities_alltime_synced_at";

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function tryServerSyncAllTime({ maxPages = 30 } = {}) {
  if (!API_URL) return { ok: false, reason: "no_api_url" };

  const user = auth.currentUser;
  if (!user) return { ok: false, reason: "no_user" };

  const idToken = await user.getIdToken().catch(() => "");
  if (!idToken) return { ok: false, reason: "no_id_token" };

  const resp = await fetch(`${API_URL}/strava/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      scope: "activities_all_time",
      maxPages,
      perPage: 200,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: `http_${resp.status}`, detail: t };
  }

  const payload = await safeJson(resp);
  const arr =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.activities) && payload.activities) ||
    (Array.isArray(payload?.data?.activities) && payload.data.activities) ||
    [];

  return { ok: true, activities: arr, payload };
}

async function loadCachedAllTime() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const at = await AsyncStorage.getItem(CACHE_SYNC_AT);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      activities: Array.isArray(parsed) ? parsed : [],
      syncedAt: at ? Number(at) : 0,
    };
  } catch {
    return { activities: [], syncedAt: 0 };
  }
}

async function writeCacheAllTime(activities) {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify(Array.isArray(activities) ? activities : [])
    );
    await AsyncStorage.setItem(CACHE_SYNC_AT, String(Date.now()));
  } catch {
    // ignore
  }
}

/* ─────────────────────────────────────────────
   Prediction helpers ("AI-ish" on-device)
───────────────────────────────────────────── */
function riegelPredictSeconds(t1Sec, d1m, d2m, k = 1.06) {
  if (!t1Sec || !d1m || !d2m) return null;
  const ratio = d2m / d1m;
  return t1Sec * Math.pow(ratio, k);
}
function enduranceExponentFromVolume(kmPerWeek) {
  const k = 1.08 - clamp((kmPerWeek - 10) / 60, 0, 1) * 0.04; // 1.08 → 1.04
  return clamp(k, 1.04, 1.10);
}
function weeklyRunKm(acts, lookbackDays = 56) {
  const cutoff = Date.now() - lookbackDays * 86400000;
  const runs = acts
    .filter((a) => a.type === "Run" && a.when)
    .filter((a) => new Date(a.when).getTime() >= cutoff);
  const totalKm = runs.reduce((sum, a) => sum + (a.distanceKm || 0), 0);
  const weeks = Math.max(1, lookbackDays / 7);
  return totalKm / weeks;
}
function trendFactorFromRuns(acts) {
  const now = Date.now();
  const w = 14 * 86400000;

  const bucket = (start, end) => {
    const runs = acts
      .filter((a) => a.type === "Run" && a.when)
      .filter((a) => {
        const t = new Date(a.when).getTime();
        return (
          t >= start &&
          t < end &&
          (a.distanceKm || 0) > 0 &&
          (a.movingTimeSec || 0) > 0
        );
      });

    const dist = runs.reduce((s, r) => s + (r.distanceKm || 0), 0);
    const sec = runs.reduce((s, r) => s + (r.movingTimeSec || 0), 0);
    const pace = dist > 0 ? (sec / 60) / dist : null; // min/km
    return { dist, pace };
  };

  const recent = bucket(now - w, now);
  const prior = bucket(now - 2 * w, now - w);

  const confidence = recent.dist >= 25 ? "High" : recent.dist >= 12 ? "Medium" : "Low";

  if (!recent.pace || !prior.pace) return { factor: 1.0, confidence };

  const change = (prior.pace - recent.pace) / prior.pace;
  const clamped = clamp(change, -0.05, 0.05);
  const factor = 1 - clamped;

  return { factor, confidence };
}
function pickAnchorFromBestEfforts(bestEfforts) {
  const prefer = [5000, 10000, 1000];
  for (const m of prefer) {
    const x = bestEfforts.find((b) => b.meters === m && b.best?.sec);
    if (x) return { meters: m, ...x.best };
  }
  const any = bestEfforts.find((b) => b.best?.sec);
  return any ? { meters: any.meters, ...any.best } : null;
}

/* ============================================================================
   PRs — Personal Records (Strava-based)
   ✅ Shows cached data even if Strava disconnected
============================================================================ */
export default function PRsPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");

  const [acts, setActs] = useState([]); // mapped
  const [filter, setFilter] = useState("All");

  // details cache for accurate best efforts
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailCache, setDetailCache] = useState({}); // id -> activity detail

  // modal for PR card click
  const [openPR, setOpenPR] = useState(null);

  // sync meta
  const [syncedAt, setSyncedAt] = useState(0);

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  const mapActivities = useCallback((safe) => {
    const mapped = (Array.isArray(safe) ? safe : []).map((a) => {
      const distanceKm = (a.distance || 0) / 1000;
      const when = a.start_date_local || a.start_date;
      const pace = paceMinPerKm(distanceKm, a.moving_time || 0);
      const type = normaliseType(a.type || "Workout");

      return {
        id: String(a.id),
        title: a.name || a.type || "Workout",
        type,
        rawType: a.type || "Workout",
        when,
        distanceKm,
        movingTimeMin: Math.round((a.moving_time || 0) / 60),
        movingTimeSec: Number(a.moving_time || 0),
        paceMinPerKm: pace,
        elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
        description: a.description || "",
        deviceName: a.device_name || "",
        average_speed: Number(a.average_speed || 0),
        max_speed: Number(a.max_speed || 0),
      };
    });

    mapped.sort((a, b) => {
      const ta = a.when ? new Date(a.when).getTime() : 0;
      const tb = b.when ? new Date(b.when).getTime() : 0;
      return tb - ta;
    });

    return mapped;
  }, []);

  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // ✅ Always show cached immediately (even if disconnected)
      const cached = await loadCachedAllTime();
      if (cached.activities?.length) {
        setActs(mapActivities(cached.activities));
        setSyncedAt(cached.syncedAt || 0);
      }

      // Connection state (independent from cached)
      const token = await AsyncStorage.getItem("strava_access_token");
      const connected = !!token;
      setHasToken(connected);

      // If not connected, stop here (but cached stays visible)
      if (!connected) return;

      // Try server sync first
      const synced = await tryServerSyncAllTime({ maxPages: 30 });
      if (synced.ok) {
        const arr = Array.isArray(synced.activities) ? synced.activities : [];
        await writeCacheAllTime(arr);
        const fresh = await loadCachedAllTime();
        setActs(mapActivities(arr));
        setSyncedAt(fresh.syncedAt || Date.now());
        return;
      }

      // Fallback: direct Strava fetch
      const raw = await fetchStravaActivitiesAllTime(token, { maxPages: 30 });
      const safe = Array.isArray(raw) ? raw : [];
      await writeCacheAllTime(safe);
      const fresh = await loadCachedAllTime();
      setActs(mapActivities(safe));
      setSyncedAt(fresh.syncedAt || Date.now());
    } catch (e) {
      console.error("PR load error", e);
      setError("Couldn’t load Strava. Try reconnecting in Settings.");
      // keep cached if present; only clear if none
      // (don’t nuke acts here)
    } finally {
      setLoading(false);
    }
  }, [mapActivities]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const fetchDetailIfNeeded = useCallback(
    async (id) => {
      try {
        if (!id) return;
        if (detailCache[id]) return;

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) return;

        setDetailLoadingId(id);

        const resp = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) return;

        const detail = await resp.json();
        setDetailCache((prev) => ({ ...prev, [id]: detail }));
      } catch {
        // ignore
      } finally {
        setDetailLoadingId("");
      }
    },
    [detailCache]
  );

  const filteredActs = useMemo(() => {
    return acts.filter((a) => (filter === "All" ? true : a.type === filter));
  }, [acts, filter]);

  /* ─────────────────────────────────────────────
     PR calculation (ALL TIME)
  ────────────────────────────────────────────── */
  const prs = useMemo(() => {
    const runs = acts.filter((a) => a.type === "Run" && Number(a.distanceKm || 0) > 0);

    const longestRun =
      [...runs].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0] || null;

    const highestElev =
      [...acts].sort((a, b) => (b.elevGainM || 0) - (a.elevGainM || 0))[0] || null;

    const longestTime =
      [...acts].sort((a, b) => (b.movingTimeSec || 0) - (a.movingTimeSec || 0))[0] || null;

    const targets = [
      { key: "best_1k", label: "Fastest 1 km", meters: 1000 },
      { key: "best_5k", label: "Fastest 5 km", meters: 5000 },
      { key: "best_10k", label: "Fastest 10 km", meters: 10000 },
    ];

    const bestEfforts = targets.map((t) => {
      const candidates = runs.filter((a) => (a.distanceKm || 0) * 1000 >= t.meters);

      let best = null;

      candidates.forEach((a) => {
        const detail = detailCache[a.id];
        const beSec = detail ? bestEffortSeconds(detail, t.meters) : null;

        let sec = beSec;
        if (!sec) {
          const pace = a.paceMinPerKm;
          if (pace && Number.isFinite(pace)) {
            const km = t.meters / 1000;
            sec = pace * 60 * km;
          }
        }

        if (!sec || !Number.isFinite(sec)) return;

        if (!best || sec < best.sec) {
          best = { sec, activity: a, exact: !!beSec };
        }
      });

      return { ...t, best };
    });

    const kmPerWeek = weeklyRunKm(acts, 56);
    const k = enduranceExponentFromVolume(kmPerWeek);
    const trend = trendFactorFromRuns(acts);
    const anchor = pickAnchorFromBestEfforts(bestEfforts);

    const predictedByMeters = {};
    [1000, 5000, 10000].forEach((m) => {
      if (!anchor?.sec) {
        predictedByMeters[m] = null;
        return;
      }
      const base = riegelPredictSeconds(anchor.sec, anchor.meters, m, k);
      predictedByMeters[m] = base ? base * trend.factor : null;
    });

    return {
      longestRun,
      highestElev,
      longestTime,
      bestEfforts,
      prediction: {
        predictedByMeters,
        confidence: trend.confidence,
      },
    };
  }, [acts, detailCache]);

  // Opportunistic detail fetch for likely PR candidates (only if connected)
  useEffect(() => {
    if (!hasToken) return;

    const runs = acts.filter((a) => a.type === "Run" && Number(a.distanceKm || 0) > 0);
    if (!runs.length) return;

    const fastestPace = [...runs]
      .filter((a) => Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0)
      .sort((a, b) => (a.paceMinPerKm || 999) - (b.paceMinPerKm || 999))[0];

    const longest = [...runs].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0];
    const longOnes = [...runs]
      .sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))
      .slice(0, 6);

    const ids = [fastestPace?.id, longest?.id, ...longOnes.map((x) => x.id)].filter(Boolean);

    ids.forEach((id) => {
      if (!detailCache[id]) fetchDetailIfNeeded(id);
    });
  }, [acts, hasToken, detailCache, fetchDetailIfNeeded]);

  const headerPRCards = useMemo(() => {
    const cards = [];
    const conf = prs?.prediction?.confidence || "Low";

    prs.bestEfforts.forEach((b) => {
      const predSec = prs?.prediction?.predictedByMeters?.[b.meters] || null;

      if (!b.best) {
        cards.push({
          key: b.key,
          title: b.label,
          value: "—",
          sub: "No qualifying run found",
          pred: predSec ? formatMinSec(predSec) : "—",
          predSub: predSec ? `Predicted now · ${conf} confidence` : "",
          activityId: "",
        });
      } else {
        cards.push({
          key: b.key,
          title: b.label,
          value: formatMinSec(b.best.sec),
          sub: `${prettyDistanceKm(b.best.activity.distanceKm)} · ${b.best.exact ? "Exact" : "Estimated"}`,
          pred: predSec ? formatMinSec(predSec) : "—",
          predSub: predSec ? `Predicted now · ${conf} confidence` : "",
          activityId: b.best.activity.id,
        });
      }
    });

    cards.push({
      key: "longest_run",
      title: "Longest run",
      value: prs.longestRun ? prettyDistanceKm(prs.longestRun.distanceKm) : "—",
      sub: prs.longestRun ? formatWhenLine(prs.longestRun.when) : "No run found",
      pred: "",
      predSub: "",
      activityId: prs.longestRun?.id || "",
    });

    cards.push({
      key: "highest_elev",
      title: "Most elevation",
      value: prs.highestElev ? `${Math.round(prs.highestElev.elevGainM || 0)} m` : "—",
      sub: prs.highestElev
        ? `${prs.highestElev.type} · ${formatWhenLine(prs.highestElev.when)}`
        : "No sessions found",
      pred: "",
      predSub: "",
      activityId: prs.highestElev?.id || "",
    });

    cards.push({
      key: "longest_time",
      title: "Longest session",
      value: prs.longestTime ? formatMinSec(prs.longestTime.movingTimeSec) : "—",
      sub: prs.longestTime
        ? `${prs.longestTime.type} · ${formatWhenLine(prs.longestTime.when)}`
        : "No sessions found",
      pred: "",
      predSub: "",
      activityId: prs.longestTime?.id || "",
    });

    return cards;
  }, [prs]);

  const openPRModal = useCallback(
    async (card) => {
      setOpenPR(card);
      if (card?.activityId && hasToken) fetchDetailIfNeeded(card.activityId);
    },
    [fetchDetailIfNeeded, hasToken]
  );

  const activePRActivity = useMemo(() => {
    if (!openPR?.activityId) return null;
    return acts.find((a) => a.id === openPR.activityId) || null;
  }, [openPR, acts]);

  const activePRDetail = useMemo(() => {
    if (!openPR?.activityId) return null;
    return detailCache[openPR.activityId] || null;
  }, [openPR, detailCache]);

  const syncedLine = useMemo(() => {
    if (!syncedAt) return "";
    const d = new Date(syncedAt);
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return ` · Synced ${date} ${time}`;
  }, [syncedAt]);

  const hasData = acts.length > 0;

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="settings" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroAvatarWrap}>
                  {user?.photoURL ? (
                    <Image source={{ uri: user.photoURL }} style={s.heroAvatar} />
                  ) : (
                    <View style={s.heroAvatarFallback}>
                      <Text style={s.heroAvatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={s.heroAvatarBorder} />
                </View>

                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>PRS</Text>
                  <Text style={s.heroName}>Personal records</Text>
                  <Text style={s.heroSub}>
                    Based on all time · Strava: {hasToken ? "Connected" : "Disconnected"}
                    {syncedLine}
                    {!hasToken && hasData ? " · Showing cached data" : ""}
                  </Text>
                </View>
              </View>

              {/* PR grid */}
              <View style={s.prGrid}>
                {headerPRCards.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    activeOpacity={0.9}
                    onPress={() => openPRModal(c)}
                    style={s.prCard}
                  >
                    <Text style={s.prTitle} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <Text style={s.prValue} numberOfLines={1}>
                      {c.value}
                    </Text>
                    <Text style={s.prSub} numberOfLines={1}>
                      {c.sub}
                    </Text>

                    {c.predSub ? (
                      <Text style={s.prPred} numberOfLines={1}>
                        Predicted: <Text style={{ fontWeight: "900" }}>{c.pred}</Text>{" "}
                        <Text style={{ color: colors.subtext }}>
                          ({prs?.prediction?.confidence || "Low"})
                        </Text>
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>

              {loading ? (
                <View style={{ paddingVertical: 14 }}>
                  <ActivityIndicator />
                  <Text style={s.loadingText}>Loading…</Text>
                </View>
              ) : null}

              {/* Always allow reconnect CTA, but never hide cached data */}
              {!hasToken ? (
                <TouchableOpacity style={s.connectBtn} activeOpacity={0.9} onPress={() => router.push("/settings")}>
                  <Feather name="link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={s.connectBtnText}>Connect Strava in Settings</Text>
                </TouchableOpacity>
              ) : null}

              {error ? <Text style={s.error}>{error}</Text> : null}
            </View>
          </LinearGradient>

          {/* FILTER + LIST */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="award" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Activities</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.hint}>
              Tap activity to open · Hold to fetch full detail (device + notes + best efforts).
            </Text>

            <TypeFilter
              value={filter}
              onChange={setFilter}
              accent={accent}
              colors={colors}
              isDark={isDark}
              options={["All", "Run", "Strength", "Ride", "Walk", "Swim", "Other"]}
            />

            {!hasData ? (
              <Text style={[s.hint, { marginTop: 12 }]}>
                {hasToken
                  ? "No activities found."
                  : "No cached activities yet. Reconnect Strava once to sync and cache your history."}
              </Text>
            ) : (
              <View style={{ marginTop: 12, gap: 12 }}>
                {!hasToken ? (
                  <View style={s.cacheBanner}>
                    <Feather name="database" size={14} color={colors.text} />
                    <Text style={s.cacheBannerText}>
                      Showing last synced data.
                    </Text>
                  </View>
                ) : null}

                {filteredActs.slice(0, 60).map((a) => {
                  const detail = detailCache[a.id];
                  const whenObj = a.when ? new Date(a.when) : null;

                  const deviceLine = detail?.device_name || detail?.gear?.name || a.deviceName || "Strava";
                  const desc = detail?.description || a.description || "";

                  const hasDistance = Number(a.distanceKm || 0) > 0;
                  const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
                  const showDistance = a.type === "Run" && hasDistance;
                  const showPace = a.type === "Run" && hasDistance && hasPace;

                  return (
                    <CompactActivityCard
                      key={a.id}
                      userName={displayName}
                      avatarUri={user?.photoURL || ""}
                      initial={initial}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      title={a.title}
                      subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                      notes={desc}
                      type={a.type}
                      distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                      paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                      timeText={formatMinSec(a.movingTimeSec)}
                      showDistance={showDistance}
                      showPace={showPace}
                      onPress={() => router.push(`/me/activity/${a.id}`)}
                      onLongPress={() => (hasToken ? fetchDetailIfNeeded(a.id) : null)}
                      loadingDetail={detailLoadingId === a.id}
                    />
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* PR MODAL */}
        <PRModal
          open={!!openPR}
          onClose={() => setOpenPR(null)}
          pr={openPR}
          activity={activePRActivity}
          detail={activePRDetail}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          loadingDetail={detailLoadingId === openPR?.activityId}
          onFetchDetail={() => (hasToken && openPR?.activityId ? fetchDetailIfNeeded(openPR.activityId) : null)}
          userName={displayName}
          avatarUri={user?.photoURL || ""}
          initial={initial}
          hasToken={hasToken}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   PR Modal
───────────────────────────────────────────── */
function PRModal({
  open,
  onClose,
  pr,
  activity,
  detail,
  colors,
  isDark,
  accent,
  router,
  loadingDetail,
  onFetchDetail,
  userName,
  avatarUri,
  initial,
  hasToken,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const whenObj = activity?.when ? new Date(activity.when) : null;
  const deviceLine = detail?.device_name || detail?.gear?.name || activity?.deviceName || "Strava";
  const desc = detail?.description || activity?.description || "";

  const hasDistance = Number(activity?.distanceKm || 0) > 0;
  const hasPace = Number.isFinite(activity?.paceMinPerKm) && activity?.paceMinPerKm > 0;
  const showDistance = activity?.type === "Run" && hasDistance;
  const showPace = activity?.type === "Run" && hasDistance && hasPace;

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />

          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                {pr?.title || "PR"}
              </Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]} numberOfLines={2}>
                {pr?.value || "—"} · {pr?.sub || ""}
                {pr?.predSub ? `\nPredicted: ${pr?.pred || "—"}` : ""}
              </Text>
            </View>

            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => pr?.activityId && router.push(`/me/activity/${pr.activityId}`)}
              style={[stylesGlobal.cta, { backgroundColor: accent, flex: 1 }]}
            >
              <Feather name="external-link" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
              <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>
                Open activity
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onFetchDetail}
              disabled={!hasToken}
              style={[
                stylesGlobal.cta,
                { backgroundColor: isDark ? "#18191E" : "#E6E7EC", flex: 1, opacity: hasToken ? 1 : 0.55 },
              ]}
            >
              <Feather name="download" size={16} color={colors.text} />
              <Text style={[stylesGlobal.ctaText, { color: colors.text }]}>
                {hasToken ? "Fetch detail" : "Reconnect to fetch"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {!activity ? (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>
              No linked activity found for this PR.
            </Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              <CompactActivityCard
                userName={userName}
                avatarUri={avatarUri}
                initial={initial}
                accent={accent}
                colors={colors}
                isDark={isDark}
                title={activity.title}
                subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                notes={desc}
                type={activity.type}
                distanceText={showDistance ? `${activity.distanceKm.toFixed(2)} km` : ""}
                paceText={showPace ? formatPace(activity.paceMinPerKm) : ""}
                timeText={formatMinSec(activity.movingTimeSec)}
                showDistance={showDistance}
                showPace={showPace}
                onPress={() => router.push(`/me/activity/${activity.id}`)}
                onLongPress={() => (hasToken ? onFetchDetail() : null)}
                loadingDetail={loadingDetail}
              />

              {detail?.best_efforts?.length ? (
                <View style={{ marginTop: 14 }}>
                  <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text }}>
                    Best efforts
                  </Text>

                  <View style={{ marginTop: 10, gap: 8 }}>
                    {detail.best_efforts
                      .filter((b) => [1000, 5000, 10000].includes(Number(b.distance)))
                      .slice(0, 6)
                      .map((b, idx) => (
                        <View
                          key={`${b.distance}-${idx}`}
                          style={{
                            backgroundColor: isDark ? "#111217" : "#F3F4F6",
                            borderRadius: 16,
                            padding: 12,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Text style={{ color: colors.text, fontWeight: "900" }}>
                            {Number(b.distance) === 1000 ? "1 km" : Number(b.distance) === 5000 ? "5 km" : "10 km"}
                          </Text>
                          <Text style={{ color: colors.subtext, fontWeight: "900" }}>
                            {formatMinSec(Number(b.elapsed_time || 0))}
                          </Text>
                        </View>
                      ))}
                  </View>
                </View>
              ) : null}

              {loadingDetail ? (
                <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator size="small" />
                  <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>
                    Loading details…
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   Type filter (clean)
───────────────────────────────────────────── */
function TypeFilter({ value, onChange, options, accent, colors, isDark }) {
  const track = isDark ? "#0E0F14" : "#FFFFFF";
  const border = isDark ? "#1B1C22" : "#E6E7EC";
  const activeBg = isDark ? "#00000066" : "#FFFFFFAA";

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 12 }}
      style={{ marginTop: 6 }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            activeOpacity={0.9}
            onPress={() => onChange(opt)}
            style={{
              borderRadius: 999,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: active ? accent : border,
              paddingVertical: 10,
              paddingHorizontal: 14,
              backgroundColor: active ? activeBg : track,
            }}
          >
            <Text style={{ fontWeight: "900", color: active ? colors.text : colors.subtext }}>
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ─────────────────────────────────────────────
   Compact Activity Card
───────────────────────────────────────────── */
function CompactActivityCard({
  userName,
  avatarUri,
  initial,
  accent,
  colors,
  isDark,
  title,
  subLine,
  notes,
  type,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
  onLongPress,
  loadingDetail,
}) {
  const showNotes = (notes || "").trim().length > 0;

  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[cardStyles.wrap, { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card }]}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatarWrap, { borderColor: accent }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={cardStyles.avatarImg} />
          ) : (
            <View style={[cardStyles.avatarFallback, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}>
              <Text style={[cardStyles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.userName, { color: colors.text }]} numberOfLines={1}>
            {userName}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Feather name={typeIconForType(type)} size={15} color={colors.text} />
            <Text style={[cardStyles.subLine, { color: colors.subtext }]} numberOfLines={1}>
              {subLine}
            </Text>
          </View>
        </View>

        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>

      {showNotes ? (
        <Text style={[cardStyles.notes, { color: colors.subtext }]} numberOfLines={3}>
          {notes}
        </Text>
      ) : null}

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <MetricBlockSmall key={m.key} label={m.label} value={m.value} colors={colors} />
        ))}
      </View>

      {loadingDetail ? (
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>
            Loading details…
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function typeIconForType(type) {
  if (type === "Run") return "activity";
  if (type === "Ride") return "wind";
  if (type === "Strength") return "zap";
  if (type === "Walk") return "map";
  if (type === "Swim") return "droplet";
  return "circle";
}

function MetricBlockSmall({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>
        {value}
      </Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 3,
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "900" },
  userName: { fontSize: 16, fontWeight: "900" },
  subLine: { fontSize: 13, fontWeight: "700", flex: 1 },
  title: { marginTop: 10, fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
  notes: { marginTop: 10, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  metricsRow: { marginTop: 16, flexDirection: "row", gap: 18 },
});

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },
    heroTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: {
      width: 60,
      height: 60,
      borderRadius: 16,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: {
      position: "absolute",
      inset: 0,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: accent,
    },
    heroTextCol: { flex: 1 },
    heroBadge: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtextSoft || colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    prGrid: {
      marginTop: 14,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    prCard: {
      width: "48%",
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    prTitle: { color: colors.subtext, fontSize: 12, fontWeight: "900" },
    prValue: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 6 },
    prSub: { color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 6 },
    prPred: { marginTop: 8, color: colors.text, fontSize: 12, fontWeight: "800" },

    connectBtn: {
      marginTop: 14,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      ...Platform.select({ android: { elevation: 2 } }),
    },
    connectBtnText: {
      color: colors.sapOnPrimary || "#0B0B0B",
      fontWeight: "900",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      fontSize: 13,
    },

    cacheBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: isDark ? "#18191E" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#2A2B33" : "#E6E7EC",
    },
    cacheBannerText: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      fontWeight: "800",
    },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionIcon: {
      width: 28,
      height: 28,
      borderRadius: 12,
      backgroundColor: isDark ? "#18191E" : "#E6E7EC",
      alignItems: "center",
      justifyContent: "center",
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.sapSilverMedium || colors.border,
      backgroundColor: colors.sapSilverLight || colors.card,
    },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({
    alignSelf: "center",
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: isDark ? "#2A2B33" : "#E6E7EC",
    marginBottom: 10,
  }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isDark ? "#18191E" : "#F3F4F6",
  }),
  cta: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});

```

### app/(protected)/me/this-week.jsx

```jsx
// app/(protected)/me/this-week.jsx
// ✅ Offline-first: shows cached data when disconnected / Strava request fails
// ✅ Caches: week activities + detail cache (persisted) + last sync meta
// ✅ Never wipes UI on fetch failure
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G, Path, Text as SvgText } from "react-native-svg";

import { auth } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ─────────────────────────────────────────────
   Date helpers (LOCAL-safe)
───────────────────────────────────────────── */
function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeekMonday(d = new Date()) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function localKeyFromDate(d) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseLocalKeyToDate(key) {
  if (!key || typeof key !== "string") return null;
  const [y, m, d] = key.split("-").map((n) => Number(n));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmtShort(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function fmtWeekTitle(weekStart) {
  return `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`;
}
function dayNameShort(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short" });
}
function formatHoursMin(totalMin) {
  const m = Math.max(0, Number(totalMin || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h ${r}m`;
}
function formatWhenLine(dateObj) {
  const d = new Date(dateObj);
  const now = new Date();
  const diffDays = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000
  );
  const rel = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : null;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (rel) return `${rel} at ${time}`;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${date} at ${time}`;
}
function paceMinPerKm(distanceKm, movingTimeSec) {
  if (!distanceKm || distanceKm <= 0) return null;
  const mins = (movingTimeSec || 0) / 60;
  return mins / distanceKm;
}
function formatPace(pace) {
  if (!pace || !Number.isFinite(pace)) return "—";
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}
function formatMinSec(totalSec) {
  const s = Math.max(0, Number(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────
   Type helpers
───────────────────────────────────────────── */
function normaliseType(t) {
  const x = String(t || "").toLowerCase();
  if (x.includes("run")) return "Run";
  if (x.includes("ride") || x.includes("bike") || x.includes("cycling")) return "Ride";
  if (x.includes("walk") || x.includes("hike")) return "Walk";
  if (x.includes("swim")) return "Swim";
  if (x.includes("weight") || x.includes("strength") || x.includes("gym")) return "Strength";
  return "Other";
}

/* ─────────────────────────────────────────────
   ✅ Offline cache keys (per-week)
───────────────────────────────────────────── */
function weekKeyFromMonday(weekStart) {
  // stable key (local week start)
  return localKeyFromDate(weekStart); // YYYY-MM-DD (Monday)
}
function weekActsCacheKey(weekKey) {
  return `trainr_strava_week_cache_v1_${weekKey}`;
}
function weekMetaCacheKey(weekKey) {
  return `trainr_strava_week_cache_meta_v1_${weekKey}`; // { updatedAtISO }
}
const STRAVA_DETAIL_CACHE_KEY = "trainr_strava_activity_detail_cache_v1"; // { [id]: detail }

/* ============================================================================
   THIS WEEK — offline-first + cached
============================================================================ */
export default function ThisWeekPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [hasToken, setHasToken] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncISO, setLastSyncISO] = useState("");

  const [weekActs, setWeekActs] = useState([]); // mapped

  // day modal
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // donut filter
  const [typeFilter, setTypeFilter] = useState("All");

  // details cache
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [activityDetailCache, setActivityDetailCache] = useState({});

  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEndExclusive = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekTitle = useMemo(() => fmtWeekTitle(weekStart), [weekStart]);
  const weekKey = useMemo(() => weekKeyFromMonday(weekStart), [weekStart]);

  const displayName = user?.displayName || "You";
  const initial = useMemo(() => {
    const src = (displayName || user?.email || "Y").trim();
    return src ? src[0].toUpperCase() : "Y";
  }, [displayName, user?.email]);

  const s = makeStyles(colors, isDark, accent);

  /* ─────────────────────────────────────────────
     Cache: load week + meta + detail cache (offline-first)
  ────────────────────────────────────────────── */
  const loadCaches = useCallback(async () => {
    try {
      const [weekRaw, metaRaw, detailRaw] = await Promise.all([
        AsyncStorage.getItem(weekActsCacheKey(weekKey)),
        AsyncStorage.getItem(weekMetaCacheKey(weekKey)),
        AsyncStorage.getItem(STRAVA_DETAIL_CACHE_KEY),
      ]);

      const cachedWeek = safeJsonParse(weekRaw || "");
      if (Array.isArray(cachedWeek) && cachedWeek.length) {
        setWeekActs(cachedWeek);
      }

      const meta = safeJsonParse(metaRaw || "") || null;
      if (meta?.updatedAtISO) setLastSyncISO(meta.updatedAtISO);

      const details = safeJsonParse(detailRaw || "");
      if (details && typeof details === "object") setActivityDetailCache(details);
    } catch (e) {
      console.warn("week cache load error", e);
    }
  }, [weekKey]);

  const saveWeekCache = useCallback(
    async (arr, updatedAtISO) => {
      try {
        await AsyncStorage.setItem(weekActsCacheKey(weekKey), JSON.stringify(arr || []));
        await AsyncStorage.setItem(
          weekMetaCacheKey(weekKey),
          JSON.stringify({ updatedAtISO: updatedAtISO || new Date().toISOString() })
        );
      } catch (e) {
        console.warn("week cache save error", e);
      }
    },
    [weekKey]
  );

  const saveDetailCache = useCallback(async (nextObj) => {
    try {
      await AsyncStorage.setItem(STRAVA_DETAIL_CACHE_KEY, JSON.stringify(nextObj || {}));
    } catch (e) {
      console.warn("detail cache save error", e);
    }
  }, []);

  /* ─────────────────────────────────────────────
     Load (offline-first):
     1) always load caches
     2) then attempt Strava refresh
     3) on failure: keep cached, show message
  ────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      // 1) show cached immediately if present
      await loadCaches();

      // 2) attempt refresh
      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasToken(false);
        // ✅ do NOT wipe weekActs; keep cached
        if (!weekActs.length) {
          setError("Strava not connected. Showing any cached data available.");
        }
        return;
      }
      setHasToken(true);

      const after = Math.floor(weekStart.getTime() / 1000);
      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava week load error", resp.status, text);
        // ✅ keep cached; don’t setWeekActs([])
        setError("Couldn’t refresh Strava. Showing cached data.");
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const weekOnly = safe.filter((a) => {
        const when = a?.start_date_local || a?.start_date;
        const t = when ? new Date(when).getTime() : 0;
        return t >= weekStart.getTime() && t < weekEndExclusive.getTime();
      });

      const mapped = weekOnly
        .map((a) => {
          const distanceKm = (a.distance || 0) / 1000;
          const when = a.start_date_local || a.start_date;
          const pace = paceMinPerKm(distanceKm, a.moving_time || 0);

          const rawType = a.type || "Workout";
          const type = normaliseType(rawType);

          return {
            id: String(a.id),
            title: a.name || rawType || "Workout",
            type,
            rawType,
            when,
            distanceKm,
            movingTimeMin: Math.round((a.moving_time || 0) / 60),
            movingTimeSec: Number(a.moving_time || 0),
            paceMinPerKm: pace,
            elevGainM: Math.round(Number(a.total_elevation_gain || 0)),
            description: a.description || "",
            deviceName: a.device_name || "",
          };
        })
        .filter((x) => x && x.id && x.when);

      mapped.sort((a, b) => {
        const ta = a.when ? new Date(a.when).getTime() : 0;
        const tb = b.when ? new Date(b.when).getTime() : 0;
        return tb - ta;
      });

      const nowISO = new Date().toISOString();
      setLastSyncISO(nowISO);

      setWeekActs(mapped);
      await saveWeekCache(mapped, nowISO);
    } catch (e) {
      console.error("Week load error", e);
      setError("Couldn’t refresh weekly data. Showing cached data if available.");
      // ✅ keep cached; don’t wipe
    } finally {
      setLoading(false);
    }
  }, [loadCaches, saveWeekCache, weekActs.length, weekEndExclusive, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const fetchActivityDetailIfNeeded = useCallback(
    async (id) => {
      try {
        if (!id) return;
        if (activityDetailCache[id]) return;

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) return;

        setDetailLoadingId(id);

        const resp = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) return;

        const detail = await resp.json();
        setActivityDetailCache((prev) => {
          const next = { ...prev, [id]: detail };
          saveDetailCache(next);
          return next;
        });
      } catch {
        // ignore
      } finally {
        setDetailLoadingId("");
      }
    },
    [activityDetailCache, saveDetailCache]
  );

  // 7 day keys
  const weekDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      out.push({
        key: localKeyFromDate(d),
        dateObj: d,
        dow: dayNameShort(d),
        dom: String(d.getDate()),
      });
    }
    return out;
  }, [weekStart]);

  const weekProgress = useMemo(() => {
    const today = startOfDay(new Date());
    const idx = Math.floor((today.getTime() - weekStart.getTime()) / 86400000);
    const daysElapsed = clamp(idx + 1, 1, 7);
    return { daysElapsed, pct: Math.round((daysElapsed / 7) * 100) };
  }, [weekStart]);

  const dayTotals = useMemo(() => {
    const by = {};
    weekActs.forEach((a) => {
      const k = localKeyFromDate(a.when);
      if (!by[k]) by[k] = { timeMin: 0, runKm: 0, count: 0 };
      by[k].count += 1;
      by[k].timeMin += a.movingTimeMin || 0;
      if (a.type === "Run") by[k].runKm += a.distanceKm || 0;
    });

    return weekDays.map((d) => ({
      ...d,
      timeMin: by[d.key]?.timeMin || 0,
      runKm: by[d.key]?.runKm || 0,
      count: by[d.key]?.count || 0,
    }));
  }, [weekActs, weekDays]);

  const weekTotals = useMemo(() => {
    const activities = weekActs.length;
    const timeMin = weekActs.reduce((s, a) => s + (a.movingTimeMin || 0), 0);
    const runKm = weekActs
      .filter((a) => a.type === "Run")
      .reduce((s, a) => s + (a.distanceKm || 0), 0);
    const elevGainM = weekActs.reduce((s, a) => s + (a.elevGainM || 0), 0);
    return { activities, timeMin, runKm, elevGainM };
  }, [weekActs]);

  const keySessions = useMemo(() => {
    const runs = weekActs.filter((a) => a.type === "Run" && Number(a.distanceKm || 0) > 0);
    const longestRun = [...runs].sort((a, b) => (b.distanceKm || 0) - (a.distanceKm || 0))[0] || null;
    const fastestRun = [...runs]
      .filter((a) => Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0)
      .sort((a, b) => (a.paceMinPerKm || 999) - (b.paceMinPerKm || 999))[0] || null;
    const longestSession =
      [...weekActs].sort((a, b) => (b.movingTimeSec || 0) - (a.movingTimeSec || 0))[0] || null;

    return { longestRun, fastestRun, longestSession };
  }, [weekActs]);

  const typeDist = useMemo(() => {
    const by = {};
    weekActs.forEach((a) => {
      const t = a.type || "Other";
      by[t] = (by[t] || 0) + (a.movingTimeMin || 0);
    });

    const entries = Object.entries(by)
      .map(([k, v]) => ({ type: k, minutes: Number(v || 0) }))
      .filter((x) => x.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);

    const total = entries.reduce((s, x) => s + x.minutes, 0) || 1;

    const main = [];
    let other = 0;
    entries.forEach((e) => {
      const pct = e.minutes / total;
      if (pct < 0.08 && e.type !== "Other") other += e.minutes;
      else main.push(e);
    });
    if (other > 0) {
      const idx = main.findIndex((x) => x.type === "Other");
      if (idx >= 0) main[idx].minutes += other;
      else main.push({ type: "Other", minutes: other });
    }

    const finalTotal = main.reduce((s, x) => s + x.minutes, 0) || 1;

    let acc = 0;
    const arcs = main.map((e) => {
      const start = acc;
      const frac = e.minutes / finalTotal;
      acc += frac;
      return { ...e, start, end: acc, pct: Math.round(frac * 100) };
    });

    return { totalMin: finalTotal, arcs };
  }, [weekActs]);

  const selectedDayActivities = useMemo(() => {
    if (!selectedDayKey) return [];
    const list = weekActs.filter((a) => localKeyFromDate(a.when) === selectedDayKey);
    return list.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [weekActs, selectedDayKey]);

  const selectedDayTotals = useMemo(() => {
    const list = selectedDayActivities;
    const timeMin = list.reduce((s, a) => s + (a.movingTimeMin || 0), 0);
    const runKm = list.filter((a) => a.type === "Run").reduce((s, a) => s + (a.distanceKm || 0), 0);
    const elevGainM = list.reduce((s, a) => s + (a.elevGainM || 0), 0);
    return { count: list.length, timeMin, runKm, elevGainM };
  }, [selectedDayActivities]);

  const openDay = useCallback((dayKey) => {
    setSelectedDayKey(dayKey);
    setDaySheetOpen(true);
  }, []);

  const groupedLog = useMemo(() => {
    const groups = {};
    weekActs.forEach((a) => {
      const k = localKeyFromDate(a.when);
      if (!groups[k]) groups[k] = [];
      groups[k].push(a);
    });
    Object.keys(groups).forEach((k) => {
      groups[k].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    });

    return weekDays.map((d) => ({
      ...d,
      list: (groups[d.key] || []).filter((a) => (typeFilter === "All" ? true : a.type === typeFilter)),
    }));
  }, [weekActs, weekDays, typeFilter]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={s.safe}>
      <View style={s.page}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* HERO */}
          <LinearGradient
            colors={isDark ? [accent + "33", colors.bg] : [accent + "55", colors.bg]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <View style={{ paddingTop: insets.top || 8 }}>
              <View style={s.heroTopRow}>
                <TouchableOpacity onPress={() => router.back()} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="chevron-left" size={20} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push("/settings")} style={s.iconButtonGhost} activeOpacity={0.8}>
                  <Feather name="settings" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroAvatarWrap}>
                  {user?.photoURL ? (
                    <Image source={{ uri: user.photoURL }} style={s.heroAvatar} />
                  ) : (
                    <View style={s.heroAvatarFallback}>
                      <Text style={s.heroAvatarInitial}>{initial}</Text>
                    </View>
                  )}
                  <View style={s.heroAvatarBorder} />
                </View>

                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>THIS WEEK</Text>
                  <Text style={s.heroName}>{weekTitle}</Text>
                  <Text style={s.heroSub}>
                    Progress: {weekProgress.daysElapsed}/7 days · Strava: {hasToken ? "Connected" : "Not connected"}
                    {lastSyncISO ? ` · cached/synced ${formatWhenLine(lastSyncISO)}` : ""}
                  </Text>
                </View>
              </View>

              {/* Totals row */}
              <View style={s.summaryRow}>
                <SummaryPill label="Sessions" value={String(weekTotals.activities)} colors={colors} isDark={isDark} />
                <SummaryPill label="Time" value={formatHoursMin(weekTotals.timeMin)} colors={colors} isDark={isDark} />
                <SummaryPill label="Run km" value={weekTotals.runKm.toFixed(1)} colors={colors} isDark={isDark} />
                <SummaryPill label="Elev" value={`${Math.round(weekTotals.elevGainM)}m`} colors={colors} isDark={isDark} />
              </View>

              {/* Weekly bars (tap day) */}
              <View style={s.panel}>
                <View style={s.panelHeader}>
                  <Text style={s.panelTitle}>Daily volume</Text>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => openDay(localKeyFromDate(new Date()))}
                    style={s.panelAction}
                  >
                    <Text style={s.panelActionText}>Open today</Text>
                    <Feather name="chevron-right" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={{ paddingVertical: 14 }}>
                    <ActivityIndicator />
                    <Text style={s.loadingText}>Loading…</Text>
                  </View>
                ) : weekActs.length === 0 ? (
                  <Text style={s.hint}>
                    {hasToken
                      ? "No sessions logged this week yet."
                      : "Strava not connected. Showing any cached data available."}
                  </Text>
                ) : (
                  <>
                    <WeekBars
                      data={dayTotals}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onDayPress={(k) => openDay(k)}
                      selectedKey={selectedDayKey}
                    />
                    <Text style={[s.hint, { marginTop: 10 }]}>Tap a day to view sessions and breakdown.</Text>
                  </>
                )}

                {error ? <Text style={s.error}>{error}</Text> : null}
              </View>

              {/* Type distribution donut + filter */}
              <View style={s.panel}>
                <View style={s.panelHeader}>
                  <Text style={s.panelTitle}>Time split</Text>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => setTypeFilter("All")} style={s.panelAction}>
                    <Text style={s.panelActionText}>{typeFilter === "All" ? "All types" : typeFilter}</Text>
                    <Feather name="sliders" size={16} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {typeDist.arcs.length === 0 ? (
                  <Text style={s.hint}>
                    {weekActs.length ? "No activity time logged this week." : "No cached activity time available."}
                  </Text>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 10 }}>
                    <Donut
                      arcs={typeDist.arcs}
                      accent={accent}
                      colors={colors}
                      isDark={isDark}
                      onSlicePress={(t) => setTypeFilter((prev) => (prev === t ? "All" : t))}
                      activeType={typeFilter === "All" ? "" : typeFilter}
                    />
                    <View style={{ flex: 1 }}>
                      {typeDist.arcs.map((a) => (
                        <TouchableOpacity
                          key={a.type}
                          activeOpacity={0.85}
                          onPress={() => setTypeFilter((prev) => (prev === a.type ? "All" : a.type))}
                          style={[
                            s.legendRow,
                            typeFilter === a.type
                              ? { backgroundColor: isDark ? "#00000044" : "#FFFFFFAA" }
                              : null,
                          ]}
                        >
                          <View style={s.legendDot(accent, a.type)} />
                          <Text style={[s.legendText, { color: colors.text }]}>{a.type}</Text>
                          <Text style={[s.legendSub, { color: colors.subtext }]}>{a.pct}%</Text>
                        </TouchableOpacity>
                      ))}
                      <Text style={[s.hint, { marginTop: 8 }]}>Tap a type to filter the log.</Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Key sessions */}
              <View style={s.panel}>
                <Text style={s.panelTitle}>Key sessions</Text>
                <View style={{ marginTop: 10, gap: 10 }}>
                  <KeySessionRow
                    icon="flag"
                    title="Longest run"
                    value={keySessions.longestRun ? `${keySessions.longestRun.distanceKm.toFixed(2)} km` : "—"}
                    sub={
                      keySessions.longestRun
                        ? `${fmtShort(new Date(keySessions.longestRun.when))} · ${formatMinSec(
                            keySessions.longestRun.movingTimeSec
                          )}`
                        : "No run logged"
                    }
                    colors={colors}
                    isDark={isDark}
                    onPress={() => keySessions.longestRun && router.push(`/me/activity/${keySessions.longestRun.id}`)}
                  />

                  <KeySessionRow
                    icon="zap"
                    title="Fastest pace run"
                    value={keySessions.fastestRun ? formatPace(keySessions.fastestRun.paceMinPerKm) : "—"}
                    sub={
                      keySessions.fastestRun
                        ? `${keySessions.fastestRun.distanceKm.toFixed(2)} km · ${fmtShort(
                            new Date(keySessions.fastestRun.when)
                          )}`
                        : "No paced run logged"
                    }
                    colors={colors}
                    isDark={isDark}
                    onPress={() => keySessions.fastestRun && router.push(`/me/activity/${keySessions.fastestRun.id}`)}
                  />

                  <KeySessionRow
                    icon="clock"
                    title="Longest session"
                    value={keySessions.longestSession ? formatMinSec(keySessions.longestSession.movingTimeSec) : "—"}
                    sub={
                      keySessions.longestSession
                        ? `${keySessions.longestSession.type} · ${fmtShort(
                            new Date(keySessions.longestSession.when)
                          )}`
                        : "No sessions logged"
                    }
                    colors={colors}
                    isDark={isDark}
                    onPress={() => keySessions.longestSession && router.push(`/me/activity/${keySessions.longestSession.id}`)}
                  />
                </View>
              </View>
            </View>
          </LinearGradient>

          {/* WEEK LOG */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="calendar" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Week log</Text>
              </View>

              <TouchableOpacity onPress={onRefresh} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="refresh-cw" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={s.hint}>Grouped by day · Tap session to open · Hold for more detail.</Text>

            {groupedLog.every((g) => g.list.length === 0) ? (
              <Text style={[s.hint, { marginTop: 12 }]}>
                {weekActs.length ? "No sessions match this filter." : "No sessions logged (or no cached data yet)."}
              </Text>
            ) : (
              groupedLog.map((g) => (
                <View key={g.key} style={{ marginTop: 16 }}>
                  <TouchableOpacity activeOpacity={0.9} onPress={() => openDay(g.key)} style={s.dayHeader}>
                    <View>
                      <Text style={[s.dayHeaderTitle, { color: colors.text }]}>
                        {g.dow} {g.dom}
                      </Text>
                      <Text style={[s.dayHeaderSub, { color: colors.subtext }]}>
                        {g.list.length ? `${g.list.length} session${g.list.length === 1 ? "" : "s"}` : "Rest day"}
                      </Text>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      {g.list.length ? (
                        <>
                          <MiniStat
                            label="Time"
                            value={`${g.list.reduce((s2, a) => s2 + (a.movingTimeMin || 0), 0)}m`}
                            colors={colors}
                          />
                          <MiniStat
                            label="Run"
                            value={`${g.list
                              .filter((a) => a.type === "Run")
                              .reduce((s2, a) => s2 + (a.distanceKm || 0), 0)
                              .toFixed(1)}k`}
                            colors={colors}
                          />
                        </>
                      ) : null}
                      <Feather name="chevron-right" size={16} color={colors.subtext} />
                    </View>
                  </TouchableOpacity>

                  {g.list.length ? (
                    <View style={{ marginTop: 10, gap: 10 }}>
                      {g.list.map((a) => {
                        const detail = activityDetailCache?.[a.id];
                        const whenObj = a.when ? new Date(a.when) : null;

                        const deviceLine =
                          detail?.device_name || detail?.gear?.name || a.deviceName || "Strava";
                        const desc = detail?.description || a.description || "";

                        const hasDistance = Number(a.distanceKm || 0) > 0;
                        const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
                        const showDistance = a.type === "Run" && hasDistance;
                        const showPace = a.type === "Run" && hasDistance && hasPace;

                        return (
                          <CompactActivityCard
                            key={a.id}
                            userName={displayName}
                            avatarUri={user?.photoURL || ""}
                            initial={initial}
                            accent={accent}
                            colors={colors}
                            isDark={isDark}
                            title={a.title}
                            subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                            notes={desc}
                            distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                            paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                            timeText={formatMinSec(a.movingTimeSec)}
                            showDistance={showDistance}
                            showPace={showPace}
                            onPress={() => router.push(`/me/activity/${a.id}`)}
                            onLongPress={() => fetchActivityDetailIfNeeded(a.id)}
                            loadingDetail={detailLoadingId === a.id}
                          />
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        <DaySheet
          open={daySheetOpen}
          onClose={() => setDaySheetOpen(false)}
          dayDate={selectedDayKey ? parseLocalKeyToDate(selectedDayKey) : null}
          totals={selectedDayTotals}
          activities={selectedDayActivities}
          colors={colors}
          isDark={isDark}
          accent={accent}
          router={router}
          onOpenActivity={(id) => router.push(`/me/activity/${id}`)}
          onPeekDetail={fetchActivityDetailIfNeeded}
          detailCache={activityDetailCache}
          detailLoadingId={detailLoadingId}
          userName={displayName}
          avatarUri={user?.photoURL || ""}
          initial={initial}
        />
      </View>
    </SafeAreaView>
  );
}

/* ─────────────────────────────────────────────
   Week bars
───────────────────────────────────────────── */
function WeekBars({ data, accent, colors, isDark, onDayPress, selectedKey }) {
  const anyRun = data.some((d) => Number(d.runKm || 0) > 0);
  const metricKey = anyRun ? "runKm" : "timeMin";
  const metricLabel = anyRun ? "km" : "min";

  const max = Math.max(...data.map((d) => Number(d[metricKey] || 0)), 0) || 1;

  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
        {data.map((d) => {
          const v = Number(d[metricKey] || 0);
          const h = clamp((v / max) * 86, 4, 86);
          const active = selectedKey && selectedKey === d.key;

          return (
            <TouchableOpacity
              key={d.key}
              activeOpacity={0.9}
              onPress={() => onDayPress?.(d.key)}
              style={{ flex: 1, alignItems: "center" }}
            >
              <Text style={{ fontSize: 11, fontWeight: "900", color: colors.subtext }}>
                {v ? (metricKey === "runKm" ? v.toFixed(1) : String(Math.round(v))) : "—"}
                <Text style={{ fontSize: 10, fontWeight: "800" }}> {metricLabel}</Text>
              </Text>

              <View
                style={{
                  marginTop: 8,
                  width: "100%",
                  borderRadius: 999,
                  height: 90,
                  justifyContent: "flex-end",
                  backgroundColor: isDark ? "#0B0C10" : "#ECEEF3",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: h,
                    width: "100%",
                    borderRadius: 999,
                    backgroundColor: accent,
                    opacity: v ? (active ? 0.95 : 0.75) : 0.25,
                  }}
                />
              </View>

              <Text style={{ marginTop: 8, fontSize: 12, fontWeight: "900", color: colors.text }}>
                {d.dow}
              </Text>
              <Text style={{ marginTop: 2, fontSize: 11, fontWeight: "800", color: colors.subtext }}>
                {d.dom}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Donut
───────────────────────────────────────────── */
function Donut({ arcs, accent, colors, isDark, onSlicePress, activeType }) {
  const size = 132;
  const rOuter = 56;
  const rInner = 36;
  const cx = size / 2;
  const cy = size / 2;

  // NOTE: no hooks inside components conditionally in RN; this is safe (always called).
  const palette = [
    accent,
    isDark ? "#7BFFEE" : "#2DD4BF",
    isDark ? "#B7A3FF" : "#8B5CF6",
    isDark ? "#FFB86B" : "#F59E0B",
    isDark ? "#7EA8FF" : "#3B82F6",
    isDark ? "#FF7AA2" : "#EF4444",
    isDark ? "#A9FF7A" : "#22C55E",
  ];

  const polar = (angle, radius) => {
    const a = (angle - 90) * (Math.PI / 180);
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  };

  const arcPath = (startFrac, endFrac) => {
    const startAngle = startFrac * 360;
    const endAngle = endFrac * 360;
    const large = endAngle - startAngle > 180 ? 1 : 0;

    const p1 = polar(startAngle, rOuter);
    const p2 = polar(endAngle, rOuter);
    const p3 = polar(endAngle, rInner);
    const p4 = polar(startAngle, rInner);

    return [
      `M ${p1.x} ${p1.y}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y}`,
      `L ${p3.x} ${p3.y}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y}`,
      "Z",
    ].join(" ");
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {arcs.map((a, idx) => {
          const fill = palette[idx % palette.length];
          const active = activeType && activeType === a.type;
          const opacity = activeType ? (active ? 1 : 0.25) : 0.92;

          return (
            <G key={a.type}>
              <Path d={arcPath(a.start, a.end)} fill={fill} opacity={opacity} onPress={() => onSlicePress?.(a.type)} />
            </G>
          );
        })}

        <SvgText x={cx} y={cy - 2} textAnchor="middle" fontSize={12} fontWeight="900" fill={colors.text}>
          {activeType ? activeType : "All"}
        </SvgText>
        <SvgText x={cx} y={cy + 16} textAnchor="middle" fontSize={12} fontWeight="900" fill={colors.subtext}>
          Tap to filter
        </SvgText>
      </Svg>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Key session row
───────────────────────────────────────────── */
function KeySessionRow({ icon, title, value, sub, colors, isDark, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        backgroundColor: isDark ? "#0B0C10" : "#ECEEF3",
        borderRadius: 18,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 14,
          backgroundColor: isDark ? "#111217" : "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={16} color={colors.text} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{title}</Text>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 4 }}>{value}</Text>
        <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700", marginTop: 4 }} numberOfLines={1}>
          {sub}
        </Text>
      </View>

      <Feather name="chevron-right" size={18} color={colors.subtext} />
    </TouchableOpacity>
  );
}

function MiniStat({ label, value, colors }) {
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={{ color: colors.subtext, fontSize: 10, fontWeight: "900" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Activity card
───────────────────────────────────────────── */
function CompactActivityCard({
  userName,
  avatarUri,
  initial,
  accent,
  colors,
  isDark,
  title,
  subLine,
  notes,
  distanceText,
  paceText,
  timeText,
  showDistance,
  showPace,
  onPress,
  onLongPress,
  loadingDetail,
}) {
  const showNotes = (notes || "").trim().length > 0;

  const metrics = [];
  if (showDistance) metrics.push({ key: "distance", label: "Distance", value: distanceText });
  if (showPace) metrics.push({ key: "pace", label: "Pace", value: paceText });
  metrics.push({ key: "time", label: "Time", value: timeText });

  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        cardStyles.wrap,
        { backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card },
      ]}
    >
      <View style={cardStyles.topRow}>
        <View style={[cardStyles.avatarWrap, { borderColor: accent }]}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={cardStyles.avatarImg} />
          ) : (
            <View style={[cardStyles.avatarFallback, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}>
              <Text style={[cardStyles.avatarInitial, { color: colors.text }]}>{initial}</Text>
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[cardStyles.userName, { color: colors.text }]} numberOfLines={1}>
            {userName}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Feather name="activity" size={15} color={colors.text} />
            <Text style={[cardStyles.subLine, { color: colors.subtext }]} numberOfLines={1}>
              {subLine}
            </Text>
          </View>
        </View>

        <Feather name="chevron-right" size={18} color={colors.subtext} />
      </View>

      <Text style={[cardStyles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>

      {showNotes ? (
        <Text style={[cardStyles.notes, { color: colors.subtext }]} numberOfLines={3}>
          {notes}
        </Text>
      ) : null}

      <View style={cardStyles.metricsRow}>
        {metrics.map((m) => (
          <MetricBlockSmall key={m.key} label={m.label} value={m.value} colors={colors} />
        ))}
      </View>

      {loadingDetail ? (
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" />
          <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "700" }}>Loading details…</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function MetricBlockSmall({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 6 }}>{value}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrap: {
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({ android: { elevation: 2 } }),
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarWrap: { width: 54, height: 54, borderRadius: 18, borderWidth: 3, overflow: "hidden" },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "900" },
  userName: { fontSize: 16, fontWeight: "900" },
  subLine: { fontSize: 13, fontWeight: "700", flex: 1 },
  title: { marginTop: 10, fontSize: 20, fontWeight: "900", letterSpacing: -0.2 },
  notes: { marginTop: 10, fontSize: 15, fontWeight: "700", lineHeight: 20 },
  metricsRow: { marginTop: 16, flexDirection: "row", gap: 18 },
});

/* ─────────────────────────────────────────────
   Day sheet modal
───────────────────────────────────────────── */
function DaySheet({
  open,
  onClose,
  dayDate,
  totals,
  activities,
  colors,
  isDark,
  accent,
  router,
  onOpenActivity,
  onPeekDetail,
  detailCache,
  detailLoadingId,
  userName,
  avatarUri,
  initial,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>
                {dayDate
                  ? dayDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" })
                  : "Day"}
              </Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {dayDate ? dayDate.toLocaleDateString("en-GB") : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pill label="Sessions" value={String(totals?.count || 0)} colors={colors} isDark={isDark} />
            <Pill label="Time" value={formatHoursMin(totals?.timeMin || 0)} colors={colors} isDark={isDark} />
            <Pill label="Run km" value={(totals?.runKm || 0).toFixed(1)} colors={colors} isDark={isDark} />
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {activities?.length ? (
            activities.map((a) => {
              const detail = detailCache?.[a.id];
              const whenObj = a.when ? new Date(a.when) : null;
              const deviceLine = detail?.device_name || a.deviceName || "Strava";
              const desc = detail?.description || a.description || "";

              const hasDistance = Number(a.distanceKm || 0) > 0;
              const hasPace = Number.isFinite(a.paceMinPerKm) && a.paceMinPerKm > 0;
              const showDistance = a.type === "Run" && hasDistance;
              const showPace = a.type === "Run" && hasDistance && hasPace;

              return (
                <View key={a.id} style={{ marginTop: 14 }}>
                  <CompactActivityCard
                    userName={userName}
                    avatarUri={avatarUri}
                    initial={initial}
                    accent={accent}
                    colors={colors}
                    isDark={isDark}
                    title={a.title}
                    subLine={`${whenObj ? formatWhenLine(whenObj) : ""} · ${deviceLine}`}
                    notes={desc}
                    distanceText={showDistance ? `${a.distanceKm.toFixed(2)} km` : ""}
                    paceText={showPace ? formatPace(a.paceMinPerKm) : ""}
                    timeText={formatMinSec(a.movingTimeSec)}
                    showDistance={showDistance}
                    showPace={showPace}
                    onPress={() => onOpenActivity?.(a.id)}
                    onLongPress={() => onPeekDetail?.(a.id)}
                    loadingDetail={detailLoadingId === a.id}
                  />
                </View>
              );
            })
          ) : (
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>No sessions on this day.</Text>
          )}

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/record")}
            style={[stylesGlobal.cta, { backgroundColor: accent, marginTop: 16 }]}
          >
            <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add a session</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ─────────────────────────────────────────────
   UI helpers
───────────────────────────────────────────── */
function SummaryPill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDark ? "#1B1C22" : "#E6E7EC",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 16, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function Pill({ label, value, colors, isDark }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isDark ? "#111217" : "#F3F4F6",
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.subtext, fontWeight: "800" }}>{label}</Text>
      <Text style={{ fontSize: 15, color: colors.text, fontWeight: "900", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────
   Styles
───────────────────────────────────────────── */
function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg || "#050505" },
    page: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingBottom: 90 },

    hero: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 16 },

    heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#00000040" : "#FFFFFF80",
    },

    heroMainRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
    heroAvatarWrap: { marginRight: 14 },
    heroAvatar: { width: 60, height: 60, borderRadius: 16 },
    heroAvatarFallback: { width: 60, height: 60, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    heroAvatarInitial: { fontSize: 24, fontWeight: "900", color: colors.text },
    heroAvatarBorder: { position: "absolute", inset: 0, borderRadius: 16, borderWidth: 2, borderColor: accent },

    heroTextCol: { flex: 1 },
    heroBadge: { fontSize: 11, fontWeight: "900", color: colors.subtextSoft || colors.subtext, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2 },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },

    panel: {
      marginTop: 12,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
    },
    panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    panelTitle: { fontSize: 13, fontWeight: "900", color: colors.text },
    panelAction: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: isDark ? "#18191E" : "#E6E7EC" },
    panelActionText: { fontSize: 12, fontWeight: "900", color: colors.text },

    legendRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, marginTop: 8 },
    legendDot: (accentColor) => ({ width: 10, height: 10, borderRadius: 5, backgroundColor: accentColor, opacity: 0.8 }),
    legendText: { fontSize: 13, fontWeight: "900", flex: 1 },
    legendSub: { fontSize: 12, fontWeight: "900" },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: { width: 28, height: 28, borderRadius: 12, backgroundColor: isDark ? "#18191E" : "#E6E7EC", alignItems: "center", justifyContent: "center" },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },
    refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.sapSilverMedium || colors.border, backgroundColor: colors.sapSilverLight || colors.card },

    dayHeader: {
      backgroundColor: isDark ? "#111217" : colors.sapSilverLight || colors.card,
      borderRadius: 18,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      shadowColor: "#000",
      shadowOpacity: 0.07,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    dayHeaderTitle: { fontSize: 16, fontWeight: "900" },
    dayHeaderSub: { marginTop: 3, fontSize: 12, fontWeight: "800" },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    error: { marginTop: 10, color: colors.danger || "#EF4444", fontSize: 13 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },
  });
}

const stylesGlobal = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "#00000077" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  sheetTop: { paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 },
  sheetHandle: (isDark) => ({ alignSelf: "center", width: 46, height: 5, borderRadius: 999, backgroundColor: isDark ? "#2A2B33" : "#E6E7EC", marginBottom: 10 }),
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  sheetSub: { marginTop: 2, fontSize: 12, fontWeight: "700" },
  closeBtn: (isDark) => ({ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#18191E" : "#F3F4F6" }),
  cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },
});

```

### app/(protected)/nutrition/streaks.jsx

```jsx
// app/(protected)/nutrition/streaks.jsx

/**
 * STREAKS PAGE — SAP GEL STYLE
 * - Uses meal logging days to compute streaks
 * - Current streak (incl. today)
 * - Best streak
 * - Simple 30-day activity grid
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
/* -------------- helpers -------------- */

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const ONE_DAY = 24 * 60 * 60 * 1000;

function normaliseDate(tsOrDate) {
  if (!tsOrDate) return null;
  if (tsOrDate?.toDate) return tsOrDate.toDate();
  if (tsOrDate instanceof Date) return tsOrDate;
  const d = new Date(tsOrDate);
  return isNaN(d.getTime()) ? null : d;
}

export default function StreaksPage() {
  const { colors, isDark } = useTheme();

  // SAP neon + silver palette (aligned with Nutrition main page)
  const PRIMARY = colors.sapPrimary || "#E6FF3B"; // neon yellow
  const SILVER_LIGHT = colors.sapSilverLight || "#F3F4F6";
  const SILVER_MEDIUM = colors.sapSilverMedium || "#E1E3E8";

  const accent = PRIMARY;

  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [mealLogs, setMealLogs] = useState([]);

  const s = makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // subscribe to meal logs
  useEffect(() => {
    if (!user) return;

    const ref = collection(db, "users", user.uid, "meals");
    const q = query(ref, orderBy("date", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMealLogs(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  // unique days where at least one meal log exists
  const uniqueDays = useMemo(() => {
    const daySet = new Set();
    const result = [];

    for (const m of mealLogs) {
      const d = normaliseDate(m.date);
      if (!d) continue;
      const sod = startOfDay(d).getTime();
      if (!daySet.has(sod)) {
        daySet.add(sod);
        result.push(sod);
      }
    }

    result.sort((a, b) => a - b); // ascending
    return result;
  }, [mealLogs]);

  const streakStats = useMemo(() => {
    if (uniqueDays.length === 0) {
      return {
        current: 0,
        best: 0,
        totalDays: 0,
        lastEntry: null,
      };
    }

    const daySet = new Set(uniqueDays);

    // current streak (counting back from today)
    let current = 0;
    let cursor = startOfDay(new Date()).getTime();

    while (daySet.has(cursor)) {
      current += 1;
      cursor -= ONE_DAY;
    }

    // best streak in history
    let best = 1;
    let streak = 1;

    for (let i = 1; i < uniqueDays.length; i++) {
      const prev = uniqueDays[i - 1];
      const curr = uniqueDays[i];
      if (curr - prev === ONE_DAY) {
        streak += 1;
      } else {
        streak = 1;
      }
      if (streak > best) best = streak;
    }

    const lastEntry = new Date(uniqueDays[uniqueDays.length - 1]);

    return {
      current,
      best,
      totalDays: uniqueDays.length,
      lastEntry,
    };
  }, [uniqueDays]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, []);

  const formatDateShort = (date) => {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  };

  // activity grid: last 30 days (including today)
  const last30Days = useMemo(() => {
    const today = startOfDay(new Date());
    const days = [];
    const daySet = new Set(uniqueDays);

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * ONE_DAY);
      const ts = d.getTime();
      const hasEntry = daySet.has(ts);
      days.push({ date: d, hasEntry });
    }

    return days;
  }, [uniqueDays]);

  const streakSubtitle = useMemo(() => {
    const { current, best, totalDays } = streakStats;

    if (totalDays === 0) return "No logged days yet.";
    if (current === 0)
      return `You’ve got ${totalDays} tracked day${
        totalDays === 1 ? "" : "s"
      }. Start today to begin a streak.`;
    if (current === best)
      return `Nice — you’re on your best streak so far (${current} day${
        current === 1 ? "" : "s"
      }).`;
    return `Current streak: ${current} day${
      current === 1 ? "" : "s"
    }. Best streak: ${best} day${best === 1 ? "" : "s"}.`;
  }, [streakStats]);

  /* ------------------ UI ------------------ */

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <View style={s.page}>
        {/* HEADER — SAP / silver style */}
        <View style={s.header}>
          <View style={s.headerRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.backButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="chevron-left" size={24} color={PRIMARY} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Streaks</Text>
              <Text style={s.headerSubtitle}>
                Today • {todayLabel}
              </Text>
            </View>
          </View>
        </View>

        {loading && (
          <View style={s.loadingOverlay}>
            <ActivityIndicator color={PRIMARY} />
          </View>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
        >
          {/* SUMMARY CARD */}
          <View style={s.section}>
            <View style={s.summaryCard}>
              <View style={s.summaryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.summaryLabel}>Current streak</Text>
                  <Text style={s.summaryValue}>
                    {streakStats.current}
                    <Text style={s.summarySuffix}> days</Text>
                  </Text>
                </View>

                <View style={s.summaryPill}>
                  <Feather name="flame" size={14} color="#111111" />
                  <Text style={s.summaryPillText}>On fire</Text>
                </View>
              </View>

              <View style={s.summaryMetaRow}>
                <View style={s.summaryMetaBlock}>
                  <Text style={s.summaryMetaLabel}>Best streak</Text>
                  <Text style={s.summaryMetaValue}>
                    {streakStats.best} d
                  </Text>
                </View>
                <View style={s.summaryMetaBlock}>
                  <Text style={s.summaryMetaLabel}>Tracked days</Text>
                  <Text style={s.summaryMetaValue}>
                    {streakStats.totalDays}
                  </Text>
                </View>
                <View style={s.summaryMetaBlock}>
                  <Text style={s.summaryMetaLabel}>Last log</Text>
                  <Text style={s.summaryMetaValue}>
                    {streakStats.lastEntry
                      ? formatDateShort(streakStats.lastEntry)
                      : "--"}
                  </Text>
                </View>
              </View>

              <Text style={s.summarySubtitleText}>{streakSubtitle}</Text>
            </View>
          </View>

          {/* ACTIVITY GRID */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Last 30 days</Text>
            </View>

            <View style={s.gridCard}>
              <View style={s.gridRowLabels}>
                {["M", "T", "W", "T", "F", "S", "S"].map((d, idx) => (
                  <Text key={idx} style={s.gridDayLabel}>
                    {d}
                  </Text>
                ))}
              </View>

              <View style={s.grid}>
                {last30Days.map((d, idx) => (
                  <View key={idx} style={s.gridItemWrapper}>
                    <View
                      style={[
                        s.gridDot,
                        d.hasEntry && s.gridDotActive,
                      ]}
                    />
                  </View>
                ))}
              </View>

              <View style={s.gridLegendRow}>
                <View style={s.gridLegendItem}>
                  <View style={s.gridDot} />
                  <Text style={s.gridLegendText}>No log</Text>
                </View>
                <View style={s.gridLegendItem}>
                  <View style={[s.gridDot, s.gridDotActive]} />
                  <Text style={s.gridLegendText}>Logged</Text>
                </View>
              </View>
            </View>
          </View>

          {/* HINT */}
          <View style={s.section}>
            <Text style={s.hintText}>
              Streaks are based on days where you log at least one meal entry.
              Log daily to keep the streak alive.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* ---------------- STYLES (SAP GEL STYLE) ---------------- */

function makeStyles(colors, isDark, PRIMARY, SILVER_LIGHT, SILVER_MEDIUM) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
    page: {
      flex: 1,
      paddingHorizontal: 18,
    },
    scrollContent: {
      paddingBottom: 40,
    },
    loadingOverlay: {
      position: "absolute",
      top: 12,
      right: 18,
      zIndex: 10,
    },

    /* HEADER */
    header: {
      marginTop: 6,
      marginBottom: 18,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    backButton: {
      marginRight: 4,
      paddingVertical: 4,
      paddingRight: 6,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: SILVER_MEDIUM,
      marginBottom: 2,
    },
    headerSubtitle: {
      color: colors.subtext,
      fontSize: 13,
    },

    section: {
      marginBottom: 28,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },

    /* SUMMARY CARD */
    summaryCard: {
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 12,
    },
    summaryLabel: {
      fontSize: 11,
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      fontWeight: "600",
      marginBottom: 4,
    },
    summaryValue: {
      fontSize: 28,
      fontWeight: "800",
      color: colors.text,
    },
    summarySuffix: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.subtext,
    },
    summaryPill: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: PRIMARY,
      gap: 6,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    summaryPillText: {
      fontSize: 12,
      fontWeight: "700",
      color: "#111111",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    summaryMetaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 6,
      marginTop: 2,
    },
    summaryMetaBlock: {
      flex: 1,
    },
    summaryMetaLabel: {
      fontSize: 11,
      color: colors.subtext,
      marginBottom: 2,
    },
    summaryMetaValue: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    summarySubtitleText: {
      fontSize: 13,
      color: colors.subtext,
      marginTop: 6,
      lineHeight: 18,
    },

    /* GRID */
    gridCard: {
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: isDark ? "#111217" : SILVER_LIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
    },
    gridRowLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    gridDayLabel: {
      fontSize: 11,
      color: colors.subtext,
      flex: 1,
      textAlign: "center",
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginBottom: 8,
    },
    gridItemWrapper: {
      width: `${100 / 7}%`,
      paddingVertical: 4,
      alignItems: "center",
      justifyContent: "center",
    },
    gridDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: SILVER_MEDIUM,
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
    gridDotActive: {
      backgroundColor: PRIMARY,
      borderColor: PRIMARY,
    },
    gridLegendRow: {
      flexDirection: "row",
      justifyContent: "flex-start",
      gap: 16,
      marginTop: 4,
    },
    gridLegendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    gridLegendText: {
      fontSize: 11,
      color: colors.subtext,
    },

    hintText: {
      fontSize: 13,
      color: colors.subtext,
      lineHeight: 18,
    },
  });
}

```

### app/(protected)/nutrition/weight.jsx

```jsx
// app/(protected)/nutrition/weight.jsx

/**
 * WEIGHT TRACKING PAGE — APPLE-STYLE + SAP GEL ACCENT
 * - Shows latest weight + change over time
 * - Period selector (1W / 1M / 3M / All)
 * - Clear trend graph with area + min/mid/max labels
 * - Points tap-able for exact value + time
 * - Simple "is the plan working?" message using nutrition goal (if present)
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Line,
  Path,
  Polyline,
  Text as SvgText,
} from "react-native-svg";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRAPH_HEIGHT = 220;
// extra room on left so Y labels don't get clipped
const GRAPH_PADDING_LEFT = 52;
const GRAPH_PADDING_RIGHT = 16;
const GRAPH_PADDING_TOP = 18;
const GRAPH_PADDING_BOTTOM = 26;
const GRAPH_Y_MIN_SPAN_KG = 2.4;
const GRAPH_Y_SPREAD_MULTIPLIER = 1.75;
const PERIOD_OPTIONS = [
  { key: "1W", chipLabel: "1W", rangeLabel: "Last 7 days", daysBack: 7 },
  { key: "1M", chipLabel: "1M", rangeLabel: "Last 30 days", daysBack: 30 },
  { key: "3M", chipLabel: "3M", rangeLabel: "Last 90 days", daysBack: 90 },
  { key: "6M", chipLabel: "6M", rangeLabel: "Last 180 days", daysBack: 180 },
  { key: "ALL", chipLabel: "1Y", rangeLabel: "Last 12 months", daysBack: 365 },
];

function withHexAlpha(color, alpha) {
  const raw = String(color || "").trim();
  const a = String(alpha || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(a)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${a}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${a}`;
  }
  return raw;
}

function coerceDate(value) {
  if (!value) return null;

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const sec =
    typeof value?.seconds === "number"
      ? value.seconds
      : typeof value?._seconds === "number"
      ? value._seconds
      : null;

  if (Number.isFinite(sec)) {
    const nanos =
      typeof value?.nanoseconds === "number"
        ? value.nanoseconds
        : typeof value?._nanoseconds === "number"
        ? value._nanoseconds
        : 0;
    const d = new Date(sec * 1000 + Math.floor(nanos / 1e6));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export default function WeightPage() {
  const { colors, isDark } = useTheme();

  // SAP GEL accent + on-accent text
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const onAccent = colors.sapOnPrimary || "#111111";

  const router = useRouter();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState([]);
  const [newWeight, setNewWeight] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [period, setPeriod] = useState("1M"); // "1W" | "1M" | "3M" | "ALL"

  const [nutritionGoal, setNutritionGoal] = useState(null);
  const [goalLoading, setGoalLoading] = useState(true);

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [showAddEntrySheet, setShowAddEntrySheet] = useState(false);

  const s = makeStyles(colors, isDark, accent, onAccent);

  // redirect if logged out
  useEffect(() => {
    if (!user) router.replace("/(auth)/login");
  }, [user, router]);

  // subscribe to weight entries
  useEffect(() => {
    if (!user) return;

    const ref = collection(db, "users", user.uid, "weights");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setWeights(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [user]);

  // fetch nutrition goal (for "plan working" hint)
  useEffect(() => {
    if (!user) return;

    const run = async () => {
      try {
        const ref = doc(db, "users", user.uid, "nutrition", "profile");
        const snap = await getDoc(ref);
        setNutritionGoal(snap.exists() ? snap.data() : null);
      } catch {
        setNutritionGoal(null);
      } finally {
        setGoalLoading(false);
      }
    };

    run();
  }, [user]);

  const normaliseDate = useCallback((tsOrDate) => coerceDate(tsOrDate), []);

  const weightsAsc = useMemo(() => {
    return [...weights].sort((a, b) => {
      const da = normaliseDate(a.date || a.createdAt) || new Date(0);
      const db = normaliseDate(b.date || b.createdAt) || new Date(0);
      return da - db;
    });
  }, [weights, normaliseDate]);

  const weightsDesc = useMemo(() => {
    return [...weightsAsc].reverse();
  }, [weightsAsc]);

  const latest = weightsDesc[0] || null;

  const getWeightsForPeriod = useCallback((rows, periodKey) => {
    if (!rows.length) return [];

    const selected =
      PERIOD_OPTIONS.find((option) => option.key === periodKey) || null;
    const daysBack = selected?.daysBack;

    if (!Number.isFinite(daysBack)) return rows;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    return rows.filter((w) => {
      const d = normaliseDate(w.date || w.createdAt);
      return d && d >= cutoff;
    });
  }, [normaliseDate]);

  const graphablePeriods = useMemo(
    () =>
      PERIOD_OPTIONS.filter(
        (option) => getWeightsForPeriod(weightsAsc, option.key).length >= 1
      ),
    [weightsAsc, getWeightsForPeriod]
  );

  const activePeriod = useMemo(() => {
    if (graphablePeriods.some((option) => option.key === period)) return period;
    return graphablePeriods[0]?.key || period;
  }, [graphablePeriods, period]);

  // filter by selected period
  const filteredWeights = useMemo(() => {
    return getWeightsForPeriod(weightsAsc, activePeriod);
  }, [weightsAsc, activePeriod, getWeightsForPeriod]);

  // clear selected point when period changes / data changes
  useEffect(() => {
    setSelectedPoint(null);
  }, [activePeriod, weightsAsc.length]);

  const trend = useMemo(() => {
    if (filteredWeights.length < 2) return null;

    const first = filteredWeights[0];
    const last = filteredWeights[filteredWeights.length - 1];
    const start = Number(first.weight || first.value || 0);
    const end = Number(last.weight || last.value || 0);
    const diff = end - start;

    const startDate = normaliseDate(first.date || first.createdAt);
    const endDate = normaliseDate(last.date || last.createdAt);
    if (!startDate || !endDate) return { start, end, diff };

    const ms = endDate.getTime() - startDate.getTime();
    const days = Math.max(1, ms / (1000 * 60 * 60 * 24));
    const perWeek = (diff / days) * 7;

    return {
      start,
      end,
      diff,
      days,
      perWeek,
    };
  }, [filteredWeights, normaliseDate]);

  const todayLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }, []);

  const formatDate = (tsOrDate) => {
    const d = normaliseDate(tsOrDate);
    if (!d) return "";
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  };

  const formatTime = (tsOrDate) => {
    const d = normaliseDate(tsOrDate);
    if (!d) return "";
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleAddWeight = async () => {
    const trimmed = newWeight.trim().replace(",", ".");
    if (!trimmed) return false;

    const value = Number(trimmed);
    if (!isFinite(value) || value <= 0) {
      Alert.alert("Check value", "Enter a valid weight in kg.");
      return false;
    }

    if (!user) {
      Alert.alert("Not signed in", "Please log in again.");
      return false;
    }

    try {
      setSaving(true);
      const ref = collection(db, "users", user.uid, "weights");

      await addDoc(ref, {
        weight: value,
        unit: "kg",
        note: newNote.trim() || "",
        date: Timestamp.now(),
        createdAt: serverTimestamp(),
      });

      setNewWeight("");
      setNewNote("");
      Keyboard.dismiss();
      return true;
    } catch (err) {
      Alert.alert(
        "Could not save",
        err?.message || "Please try again in a moment."
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWeight = (item) => {
    if (!user) return;

    Alert.alert(
      "Delete entry?",
      `Remove ${item.weight} kg from ${formatDate(item.date || item.createdAt)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const ref = doc(db, "users", user.uid, "weights", item.id);
              await deleteDoc(ref);
            } catch (err) {
              Alert.alert(
                "Could not delete",
                err?.message || "Please try again."
              );
            }
          },
        },
      ]
    );
  };

  const trendLabel = useMemo(() => {
    if (!trend) return "Not enough data yet.";
    const { diff } = trend;
    const rounded = Math.round(diff * 10) / 10;

    if (rounded === 0) return "No change over this period.";
    if (rounded < 0)
      return `Down ${Math.abs(rounded)} kg over this period.`;
    return `Up ${rounded} kg over this period.`;
  }, [trend]);

  const headerSubtitle = (() => {
    if (!latest) return `Today • ${todayLabel}`;
    const d = normaliseDate(latest.date || latest.createdAt);
    const isToday = d && d.toDateString() === new Date().toDateString();
    if (isToday) return `Latest • Today ${todayLabel}`;
    return `Latest • ${formatDate(latest.date || latest.createdAt)} at ${formatTime(
      latest.date || latest.createdAt
    )}`;
  })();

  // label like "Last 7 days" / "Last 30 days"
  const periodLabel = useMemo(() => {
    return (
      PERIOD_OPTIONS.find((option) => option.key === activePeriod)
        ?.rangeLabel || "All time"
    );
  }, [activePeriod]);

  const currentWeightValue = latest ? Number(latest.weight || latest.value || 0) : null;
  const startWeightValue =
    filteredWeights.length > 0
      ? Number(filteredWeights[0].weight || filteredWeights[0].value || 0)
      : null;
  const changeValue = trend?.diff ?? null;
  const weeklyChangeValue = trend?.perWeek ?? null;

  const trendIconName = useMemo(() => {
    if (!trend) return "minus";
    if (trend.diff < 0) return "trending-down";
    if (trend.diff > 0) return "trending-up";
    return "minus";
  }, [trend]);

  const formatKg = useCallback((value, digits = 1) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return `${n.toFixed(digits).replace(/\.0$/, "")} kg`;
  }, []);

  const formatSignedKg = useCallback((value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    const abs = Math.abs(n).toFixed(1).replace(/\.0$/, "");
    if (n === 0) return "0 kg";
    return `${n > 0 ? "+" : "-"}${abs} kg`;
  }, []);

  const adjustDraftWeight = useCallback(
    (delta) => {
      const parsed = Number(newWeight.trim().replace(",", "."));
      const fallback = Number(latest?.weight || latest?.value || 0);
      const base = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      if (!Number.isFinite(base) || base <= 0) return;

      const next = Math.max(0, Math.round((base + delta) * 10) / 10);
      setNewWeight(next.toFixed(1).replace(/\.0$/, ""));
    },
    [newWeight, latest]
  );

  const applyLatestWeight = useCallback(() => {
    const fallback = Number(latest?.weight || latest?.value || 0);
    if (!Number.isFinite(fallback) || fallback <= 0) return;
    setNewWeight(fallback.toFixed(1).replace(/\.0$/, ""));
  }, [latest]);

  // ---- simple "is the plan working?" text based on goalType + trend ----
  const planFeedback = useMemo(() => {
    if (!nutritionGoal || !trend) return null;

    const goalType = nutritionGoal.goalType || nutritionGoal.type; // be forgiving
    if (!goalType) return null;

    const perWeek = trend.perWeek ?? 0;
    const rounded = Math.round(perWeek * 10) / 10;

    if (goalType === "fat_loss") {
      if (rounded < -1) {
        return `Weight is dropping quickly (~${Math.abs(
          rounded
        )} kg/week). Consider a slightly higher calorie target if energy or performance is suffering.`;
      }
      if (rounded < -0.25) {
        return `Trend supports fat loss (~${Math.abs(
          rounded
        )} kg/week). Keep an eye on recovery and adjust if you feel flat.`;
      }
      if (rounded > 0.1) {
        return `Weight is creeping up (~${rounded} kg/week). If fat loss is the goal, consider tightening calories or increasing activity.`;
      }
      return `Weight is fairly stable. If you expected more loss, you may be closer to maintenance than a deficit.`;
    }

    if (goalType === "muscle_gain") {
      if (rounded > 0.75) {
        return `Weight is climbing fast (~${rounded} kg/week). This might be more than needed for lean gain — consider a slightly smaller surplus.`;
      }
      if (rounded > 0.25) {
        return `Trend supports muscle gain (~${rounded} kg/week). Check strength and performance — if they’re rising too, you’re on track.`;
      }
      if (rounded < -0.1) {
        return `Weight is drifting down (~${Math.abs(
          rounded
        )} kg/week). For muscle gain, you may need more calories.`;
      }
      return `Weight is mostly flat. For muscle gain, a small surplus might help move things along.`;
    }

    // default / maintenance
    if (Math.abs(rounded) < 0.1) {
      return `Weight is very stable (~${rounded} kg/week), which is consistent with maintenance.`;
    }
    if (rounded > 0.1) {
      return `Weight is trending up (~${rounded} kg/week). If maintenance is the goal, you may be slightly above your ideal calorie level.`;
    }
    return `Weight is trending down (~${Math.abs(
      rounded
    )} kg/week). If you aimed for maintenance, you might be in a small deficit.`;
  }, [nutritionGoal, trend]);

  /* --------------- row component --------------- */

  const renderRow = (item) => (
    <TouchableOpacity
      key={item.id}
      activeOpacity={0.7}
      onLongPress={() => handleDeleteWeight(item)}
      style={s.entryRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.entryWeight}>{item.weight} kg</Text>
        <Text style={s.entryDate}>
          {formatDate(item.date || item.createdAt)} · {formatTime(
            item.date || item.createdAt
          )}
        </Text>
        {item.note ? (
          <Text style={s.entryNote} numberOfLines={1}>
            {item.note}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={() => handleDeleteWeight(item)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={s.deleteMini}
        activeOpacity={0.8}
      >
        <Feather name="trash-2" size={16} color={colors.subtext} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  /* ----------------- UI ----------------- */

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          style={s.page}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* HEADER + OVERVIEW */}
          <View style={s.headerCard}>
            <View style={s.headerRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={s.backButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="chevron-left" size={22} color={colors.text} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={s.headerEyebrow}>Body Metrics</Text>
                <Text style={s.headerTitle}>Weight</Text>
                <Text style={s.headerSubtitle}>{headerSubtitle}</Text>

                <View style={s.headerMetaRow}>
                  <View style={s.headerMetaPill}>
                    <Feather name="bar-chart-2" size={13} color={colors.subtext} />
                    <Text style={s.headerMetaText}>{periodLabel}</Text>
                  </View>
                  <View style={s.headerMetaPill}>
                    <Feather name="list" size={13} color={colors.subtext} />
                    <Text style={s.headerMetaText}>
                      {weights.length} entr{weights.length === 1 ? "y" : "ies"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={s.kpiGrid}>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Current</Text>
                <Text style={s.kpiValue}>{formatKg(currentWeightValue)}</Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Change</Text>
                <Text style={s.kpiValue}>{formatSignedKg(changeValue)}</Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Weekly</Text>
                <Text style={s.kpiValue}>
                  {Number.isFinite(weeklyChangeValue)
                    ? formatSignedKg(weeklyChangeValue)
                    : "--"}
                </Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiLabel}>Start</Text>
                <Text style={s.kpiValue}>{formatKg(startWeightValue)}</Text>
              </View>
            </View>

            <View style={s.trendRow}>
              <Feather name={trendIconName} size={16} color={colors.subtext} />
              <Text style={s.trendText}>{trendLabel}</Text>
            </View>

            <View style={s.headerNeonEdge} />
          </View>

          {loading && (
            <View style={s.loadingOverlay}>
              <ActivityIndicator />
            </View>
          )}

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* PERIOD SELECTOR + GRAPH */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>Trend</Text>
                <View style={s.periodRow}>
                  {graphablePeriods.map((option) => {
                    const active = activePeriod === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        onPress={() => setPeriod(option.key)}
                        activeOpacity={0.8}
                        style={[
                          s.periodChip,
                          active && s.periodChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            s.periodChipText,
                            active && s.periodChipTextActive,
                          ]}
                        >
                          {option.chipLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={s.graphCard}>
                {filteredWeights.length < 1 ? (
                  <Text style={s.emptyText}>
                    Not enough entries yet to show a trend. Log a few more
                    weights to see the graph.
                  </Text>
                ) : (
                  <WeightGraph
                    data={filteredWeights}
                    colors={colors}
                    accent={accent}
                    periodLabel={periodLabel}
                    periodKey={activePeriod}
                    onPointPress={setSelectedPoint}
                  />
                )}

                {/* Selected point details */}
                {selectedPoint && (
                  <View style={s.pointDetail}>
                    <Text style={s.pointDetailTitle}>
                      {selectedPoint.weight.toFixed(1)} kg
                    </Text>
                    <Text style={s.pointDetailText}>
                      {formatDate(selectedPoint.date)} at{" "}
                      {formatTime(selectedPoint.date)}
                    </Text>
                    {selectedPoint.note ? (
                      <Text style={s.pointDetailNote}>
                        {selectedPoint.note}
                      </Text>
                    ) : null}
                  </View>
                )}

                {!goalLoading && planFeedback && (
                  <View style={s.planRow}>
                    <Text style={s.planLabel}>Plan insight</Text>
                    <Text style={s.planText}>{planFeedback}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* HISTORY */}
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionTitle}>History</Text>
                <Text style={s.sectionMeta}>
                  {weights.length} entries
                </Text>
              </View>

              {weights.length === 0 ? (
                <Text style={s.emptyText}>
                  No weight entries yet. Add your first entry to start
                  tracking.
                </Text>
              ) : (
                <View style={s.listCard}>
                  {weightsDesc.map((w, idx) => (
                    <View
                      key={w.id}
                      style={[
                        idx !== weightsDesc.length - 1 && s.listDivider,
                      ]}
                    >
                      {renderRow(w)}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          <TouchableOpacity
            style={s.fabAdd}
            onPress={() => setShowAddEntrySheet(true)}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={17} color={onAccent} />
            <Text style={s.fabAddText}>Add entry</Text>
          </TouchableOpacity>

          <Modal
            visible={showAddEntrySheet}
            transparent
            animationType="slide"
            onRequestClose={() => setShowAddEntrySheet(false)}
          >
            <View style={s.sheetOverlay}>
              <TouchableOpacity
                style={s.sheetBackdrop}
                activeOpacity={1}
                onPress={() => {
                  if (!saving) setShowAddEntrySheet(false);
                }}
              />

              <KeyboardAvoidingView
                style={s.sheetKeyboard}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
              >
                <View style={s.sheetCard}>
                  <View style={s.sheetHandle} />
                  <View style={s.sheetHeader}>
                    <Text style={s.sheetTitle}>Add Entry</Text>
                    <TouchableOpacity
                      onPress={() => setShowAddEntrySheet(false)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={s.sheetClose}
                    >
                      <Feather name="x" size={16} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                  <Text style={s.sheetSubtitle}>
                    Log today’s weight quickly.
                  </Text>

                  <View style={s.addCard}>
                    <View style={s.addRow}>
                      <TouchableOpacity
                        style={s.adjustButton}
                        onPress={() => adjustDraftWeight(-0.1)}
                        activeOpacity={0.8}
                      >
                        <Feather name="minus" size={14} color={colors.text} />
                        <Text style={s.adjustButtonText}>0.1</Text>
                      </TouchableOpacity>

                      <View style={s.addLeft}>
                        <TextInput
                          style={s.weightInput}
                          placeholder="Weight"
                          placeholderTextColor={colors.subtext}
                          keyboardType="decimal-pad"
                          value={newWeight}
                          onChangeText={setNewWeight}
                        />
                        <Text style={s.weightUnit}>kg</Text>
                      </View>

                      <TouchableOpacity
                        style={s.adjustButton}
                        onPress={() => adjustDraftWeight(0.1)}
                        activeOpacity={0.8}
                      >
                        <Feather name="plus" size={14} color={colors.text} />
                        <Text style={s.adjustButtonText}>0.1</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          s.addButton,
                          {
                            backgroundColor: saving ? colors.subtext : accent,
                          },
                        ]}
                        onPress={async () => {
                          const saved = await handleAddWeight();
                          if (saved) setShowAddEntrySheet(false);
                        }}
                        disabled={saving || !newWeight.trim()}
                        activeOpacity={0.8}
                      >
                        {saving ? (
                          <ActivityIndicator color={onAccent} />
                        ) : (
                          <>
                            <Feather name="check" size={16} color={onAccent} />
                            <Text style={s.addButtonText}>Save</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={s.quickActionRow}>
                      <TouchableOpacity
                        style={s.ghostAction}
                        onPress={applyLatestWeight}
                        disabled={!latest}
                        activeOpacity={0.8}
                      >
                        <Feather
                          name="clock"
                          size={14}
                          color={colors.subtext}
                        />
                        <Text style={s.ghostActionText}>
                          {latest
                            ? `Use latest (${formatKg(latest.weight)})`
                            : "No latest yet"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <TextInput
                      style={s.noteInput}
                      placeholder="Note (optional, e.g. morning fasted, post-training…)"
                      placeholderTextColor={colors.subtext}
                      value={newNote}
                      onChangeText={setNewNote}
                      multiline
                    />
                  </View>

                  <Text style={s.addHint}>
                    Tap the bin icon to delete. Long-press an entry also works.
                  </Text>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

/* ---------------- GRAPH COMPONENT ---------------- */

function formatXAxisTick(date, periodKey) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";

  if (periodKey === "1W") {
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
    });
  }

  if (periodKey === "ALL") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
    });
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function compressAxisTicks(ticks, minGapPx, maxCount) {
  if (!Array.isArray(ticks) || ticks.length <= 2) return ticks || [];

  const sorted = [...ticks]
    .filter((tick) => Number.isFinite(tick?.x) && typeof tick?.label === "string")
    .sort((a, b) => a.x - b.x);
  if (sorted.length <= 2) return sorted;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const middle = sorted.slice(1, -1);

  const out = [first];
  middle.forEach((tick) => {
    const prev = out[out.length - 1];
    if (tick.x - prev.x >= minGapPx && last.x - tick.x >= minGapPx * 0.7) {
      out.push(tick);
    }
  });

  if (last.x - out[out.length - 1].x < minGapPx * 0.7) {
    out[out.length - 1] = last;
  } else {
    out.push(last);
  }

  if (out.length <= maxCount) return out;

  const sampled = [out[0]];
  const inner = out.slice(1, -1);
  const innerWanted = Math.max(0, maxCount - 2);

  if (innerWanted === 1) {
    sampled.push(inner[Math.floor(inner.length / 2)]);
  } else if (innerWanted > 1) {
    for (let i = 0; i < innerWanted; i += 1) {
      const idx = Math.round((i * (inner.length - 1)) / (innerWanted - 1));
      sampled.push(inner[idx]);
    }
  }

  sampled.push(out[out.length - 1]);
  return sampled;
}

function WeightGraph({
  data,
  colors,
  accent,
  periodLabel,
  periodKey,
  onPointPress,
}) {
  const width = SCREEN_WIDTH - 36; // page padding matches main layout
  const height = GRAPH_HEIGHT;

  const pointsData = useMemo(() => {
    if (!data || data.length < 1) return null;

    const sorted = [...data].sort((a, b) => {
      const da = coerceDate(a.date || a.createdAt) || new Date(0);
      const db = coerceDate(b.date || b.createdAt) || new Date(0);
      return da - db;
    });

    const dates = sorted.map((row) => {
      return coerceDate(row?.date || row?.createdAt);
    });
    if (dates.some((d) => !(d instanceof Date) || isNaN(d.getTime()))) {
      return null;
    }

    const timestamps = dates.map((d) => d.getTime());
    const minDataMs = Math.min(...timestamps);
    const maxDataMs = Math.max(...timestamps);

    const selectedPeriod = PERIOD_OPTIONS.find(
      (option) => option.key === periodKey
    );
    const periodDaysBack = selectedPeriod?.daysBack;

    const nowMs = Date.now();
    const maxMs = Number.isFinite(periodDaysBack)
      ? Math.max(nowMs, maxDataMs)
      : maxDataMs;
    const minMs = Number.isFinite(periodDaysBack)
      ? maxMs - periodDaysBack * 24 * 60 * 60 * 1000
      : minDataMs;
    const hasTimeSpan = maxMs > minMs;

    const values = sorted.map((d) => Number(d.weight || d.value || 0));
    let minV = Math.min(...values);
    let maxV = Math.max(...values);

    if (!isFinite(minV) || !isFinite(maxV)) return null;

    // Keep a wider Y-domain so the axis has more spread.
    const rawSpan = Math.max(0, maxV - minV);
    const center = (maxV + minV) / 2;
    const targetSpan =
      rawSpan === 0
        ? GRAPH_Y_MIN_SPAN_KG
        : Math.max(GRAPH_Y_MIN_SPAN_KG, rawSpan * GRAPH_Y_SPREAD_MULTIPLIER);
    minV = center - targetSpan / 2;
    maxV = center + targetSpan / 2;

    const span = maxV - minV || 1;
    const usableWidth = width - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT;
    const usableHeight = height - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM;

    const points = sorted.map((row, index) => {
      const v = values[index];
      const xRatio = hasTimeSpan
        ? (timestamps[index] - minMs) / (maxMs - minMs)
        : index / (sorted.length - 1 || 1);
      const x =
        GRAPH_PADDING_LEFT + xRatio * usableWidth;
      const y =
        GRAPH_PADDING_TOP +
        (1 - (v - minV) / span) * usableHeight;

      return {
        x,
        y,
        weight: v,
        date: row.date || row.createdAt,
        note: row.note,
        raw: {
          ...row,
          date: row.date || row.createdAt,
        },
      };
    });

    return {
      points,
      min: minV,
      max: maxV,
      span,
      minMs,
      maxMs,
      timestamps,
      usableWidth,
      usableHeight,
    };
  }, [data, width, height, periodKey]);

  const yTicks = useMemo(() => {
    if (!pointsData) return [];
    const { max, span, usableHeight } = pointsData;
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      value: max - span * ratio,
      y: GRAPH_PADDING_TOP + ratio * usableHeight,
    }));
  }, [pointsData]);

  const xTicks = useMemo(() => {
    if (!pointsData) return [];

    const { minMs, maxMs, usableWidth } = pointsData;
    if (!isFinite(minMs) || !isFinite(maxMs)) return [];

    if (periodKey === "ALL") {
      const startDate = new Date(minMs);
      const endDate = new Date(maxMs);
      const candidates = [
        { ts: minMs, label: formatXAxisTick(startDate, "ALL") },
      ];

      const cursor = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        1
      );

      while (cursor.getTime() < maxMs) {
        candidates.push({
          ts: cursor.getTime(),
          label: cursor.toLocaleDateString("en-GB", {
            month: "short",
            year: "2-digit",
          }),
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }

      candidates.push({
        ts: maxMs,
        label: formatXAxisTick(endDate, "ALL"),
      });

      const rawTicks = candidates.map((tick) => {
        const ratio = maxMs === minMs ? 0 : (tick.ts - minMs) / (maxMs - minMs);
        return {
          x: GRAPH_PADDING_LEFT + ratio * usableWidth,
          label: tick.label,
        };
      });

      return compressAxisTicks(rawTicks, 56, 5);
    }

    const countByPeriod = {
      "1W": 7,
      "1M": 5,
      "3M": 6,
      "6M": 6,
      ALL: 6,
    };
    const tickCount = Math.max(2, countByPeriod[periodKey] || 5);

    if (maxMs === minMs) {
      const onlyDate = new Date(minMs);
      return [
        {
          x: GRAPH_PADDING_LEFT,
          label: formatXAxisTick(onlyDate, periodKey),
        },
      ];
    }

    const ticks = Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      const tickMs = minMs + ratio * (maxMs - minMs);
      const tickDate = new Date(tickMs);
      return {
        x: GRAPH_PADDING_LEFT + ratio * usableWidth,
        label: formatXAxisTick(tickDate, periodKey),
      };
    });

    const deduped = ticks.filter(
      (tick, index, arr) =>
        index === 0 ||
        index === arr.length - 1 ||
        tick.label !== arr[index - 1].label
    );
    const gapByPeriod = {
      "1W": 34,
      "1M": 46,
      "3M": 50,
      "6M": 52,
      ALL: 56,
    };
    return compressAxisTicks(deduped, gapByPeriod[periodKey] || 46, 6);
  }, [pointsData, periodKey]);

  if (!pointsData) return null;

  const { points } = pointsData;
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // area path under line
  const areaPath = (() => {
    if (!points.length) return "";
    const first = points[0];
    const last = points[points.length - 1];
    const baseY = height - GRAPH_PADDING_BOTTOM;

    let d = `M ${first.x} ${baseY}`;
    points.forEach((p) => {
      d += ` L ${p.x} ${p.y}`;
    });
    d += ` L ${last.x} ${baseY} Z`;
    return d;
  })();

  return (
    <Svg width={width} height={height}>
      {/* Horizontal grid lines with richer Y scale */}
      {yTicks.map((row, idx) => (
        <GridRow
          key={idx}
          width={width}
          y={row.y}
          label={`${row.value.toFixed(1)} kg`}
          colors={colors}
        />
      ))}

      {/* Vertical guide lines for time ticks */}
      {xTicks.map((tick, idx) => (
        <Line
          key={`x-grid-${idx}`}
          x1={tick.x}
          x2={tick.x}
          y1={GRAPH_PADDING_TOP}
          y2={height - GRAPH_PADDING_BOTTOM}
          stroke={colors?.subtext || "#4B5563"}
          strokeWidth={1}
          opacity={0.12}
        />
      ))}

      {/* Filled area under line */}
      <Path d={areaPath} fill={accent} opacity={0.15} />

      {/* Line */}
      <Polyline
        points={polylinePoints}
        fill="none"
        stroke={accent}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots (tap-able) */}
      {points.map((p, i) => (
        <Circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === points.length - 1 ? 4 : 3}
          fill={i === points.length - 1 ? accent : "#FFFFFF"}
          stroke={accent}
          strokeWidth={1}
          onPress={() => onPointPress && onPointPress(p.raw)}
        />
      ))}

      {/* Top labels */}
      <TextSvg
        x={GRAPH_PADDING_LEFT}
        y={GRAPH_PADDING_TOP - 6}
        text="Weight (kg)"
        anchor="start"
        color={colors.subtext}
      />
      <TextSvg
        x={width - GRAPH_PADDING_RIGHT}
        y={GRAPH_PADDING_TOP - 6}
        text={periodLabel}
        anchor="end"
        color={colors.subtext}
      />

      {/* Date labels on X-axis */}
      {xTicks.map((tick, index) => (
        <TextSvg
          key={`x-label-${index}`}
          x={tick.x}
          y={height - 6}
          text={tick.label}
          anchor={
            index === 0
              ? "start"
              : index === xTicks.length - 1
              ? "end"
              : "middle"
          }
          color={colors.subtext}
        />
      ))}
    </Svg>
  );
}

function GridRow({ width, y, label, colors }) {
  return (
    <>
      <Line
        x1={GRAPH_PADDING_LEFT}
        x2={width - GRAPH_PADDING_RIGHT}
        y1={y}
        y2={y}
        stroke={colors?.subtext || "#4B5563"}
        strokeWidth={1}
        strokeDasharray="4 4"
        opacity={0.35}
      />
      <TextSvg
        x={GRAPH_PADDING_LEFT - 10}
        y={y + 3}
        text={label}
        anchor="end"
        color={colors?.subtext}
      />
    </>
  );
}

function TextSvg({ x, y, text, anchor = "start", color = "#9CA3AF" }) {
  return (
    <SvgText
      x={x}
      y={y}
      fill={color}
      fontSize={10}
      textAnchor={anchor}
    >
      {text}
    </SvgText>
  );
}

/* ---------------- STYLES ---------------- */

function makeStyles(colors, isDark, accent, onAccent) {
  const cardBase = colors.card || (isDark ? "#101219" : "#F3F4F6");
  const cardBg = withHexAlpha(cardBase, isDark ? "D4" : "F4");
  const panelBg = withHexAlpha(cardBase, isDark ? "CC" : "F2");
  const panelBgSoft = withHexAlpha(cardBase, isDark ? "B8" : "EA");
  const borderSoft =
    colors.border || (isDark ? "rgba(255,255,255,0.10)" : "#E1E3E8");
  const borderHard = borderSoft;

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg || (isDark ? "#050506" : "#F5F5F7"),
    },
    page: {
      flex: 1,
      paddingHorizontal: 16,
    },
    scrollContent: {
      paddingBottom: 120,
    },

    loadingOverlay: {
      position: "absolute",
      top: 12,
      right: 18,
      zIndex: 10,
    },

    /* HEADER */
    headerCard: {
      marginTop: 6,
      marginBottom: 18,
      borderRadius: 22,
      borderWidth: 0,
      borderColor: "transparent",
      backgroundColor: "transparent",
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 12,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    backButton: {
      marginRight: 10,
      marginTop: 2,
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderHard,
    },
    headerEyebrow: {
      fontSize: 11,
      fontWeight: "800",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 4,
    },
    headerTitle: {
      fontSize: 26,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 1,
      letterSpacing: 0.1,
    },
    headerSubtitle: {
      color: colors.subtext,
      fontSize: 14,
      fontWeight: "600",
    },
    headerMetaRow: {
      marginTop: 9,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    headerMetaPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
    },
    headerMetaText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.1,
    },
    kpiGrid: {
      marginTop: 10,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    kpiCard: {
      width: "48%",
      borderRadius: 14,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderColor: "transparent",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    kpiLabel: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 3,
    },
    kpiValue: {
      fontSize: 15,
      color: colors.text,
      fontWeight: "800",
    },
    headerNeonEdge: {
      marginTop: 10,
      height: 2,
      borderRadius: 999,
      backgroundColor: withHexAlpha(accent, isDark ? "B0" : "90"),
    },

    /* SECTIONS */
    section: {
      marginBottom: 26,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
      marginBottom: 8,
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },
    sectionMeta: {
      fontSize: 12,
      color: colors.subtext,
    },

    trendRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 8,
    },
    trendText: {
      fontSize: 13,
      color: colors.subtext,
      flex: 1,
    },

    /* PERIOD + GRAPH */
    periodRow: {
      flexDirection: "row",
      gap: 8,
    },
    periodChip: {
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
    },
    periodChipActive: {
      backgroundColor: accent,
      borderColor: accent,
    },
    periodChipText: {
      fontSize: 12,
      color: colors.subtext,
      fontWeight: "700",
    },
    periodChipTextActive: {
      color: onAccent,
      fontWeight: "800",
    },

    graphCard: {
      paddingVertical: 8,
      paddingHorizontal: 0,
      backgroundColor: "transparent",
      borderWidth: 0,
      marginTop: 6,
    },

    planRow: {
      marginTop: 10,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: panelBgSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    planLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    planText: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 18,
    },

    pointDetail: {
      marginTop: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: panelBgSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    pointDetailTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 2,
    },
    pointDetailText: {
      fontSize: 13,
      color: colors.subtext,
    },
    pointDetailNote: {
      marginTop: 2,
      fontSize: 12,
      color: colors.subtext,
    },

    /* ADD ENTRY */
    addCard: {
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: cardBg,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    adjustButton: {
      height: 38,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      paddingHorizontal: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    adjustButtonText: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "700",
    },
    addLeft: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: panelBg,
    },
    weightInput: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
      paddingVertical: 0,
    },
    weightUnit: {
      fontSize: 14,
      color: colors.subtext,
      marginLeft: 4,
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      gap: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withHexAlpha(accent, isDark ? "66" : "8A"),
    },
    addButtonText: {
      color: onAccent,
      fontWeight: "700",
      fontSize: 14,
    },
    quickActionRow: {
      marginBottom: 8,
    },
    ghostAction: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
    },
    ghostActionText: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
    },
    noteInput: {
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 40,
      color: colors.text,
      fontSize: 14,
      backgroundColor: panelBg,
      marginBottom: 4,
    },
    addHint: {
      fontSize: 11,
      color: colors.subtext,
    },

    fabAdd: {
      position: "absolute",
      right: 18,
      bottom: 18,
      height: 46,
      borderRadius: 999,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: accent,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withHexAlpha(accent, isDark ? "8A" : "AA"),
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    fabAddText: {
      color: onAccent,
      fontSize: 13,
      fontWeight: "800",
      letterSpacing: 0.2,
    },

    sheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheetBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    sheetKeyboard: {
      width: "100%",
    },
    sheetCard: {
      width: "100%",
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      backgroundColor: colors.bg || (isDark ? "#050506" : "#F5F5F7"),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 16,
    },
    sheetHandle: {
      alignSelf: "center",
      width: 42,
      height: 4,
      borderRadius: 999,
      backgroundColor: withHexAlpha(colors.subtext || "#9CA3AF", "55"),
      marginBottom: 10,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 2,
    },
    sheetTitle: {
      fontSize: 18,
      fontWeight: "800",
      color: colors.text,
    },
    sheetSubtitle: {
      fontSize: 13,
      color: colors.subtext,
      marginBottom: 10,
    },
    sheetClose: {
      width: 30,
      height: 30,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
    },

    /* LIST */
    listCard: {
      borderRadius: 20,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    listDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderSoft,
    },
    entryRow: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    deleteMini: {
      width: 30,
      height: 30,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      alignItems: "center",
      justifyContent: "center",
    },
    entryWeight: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    entryDate: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },
    entryNote: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
    },

    emptyText: {
      fontSize: 13,
      color: colors.subtext,
      marginTop: 6,
    },
  });
}

```


## 8. Package Dependencies

### package.json

```json
{
  "name": "version1.0-app",
  "version": "1.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "lint": "expo lint",
    "reset-project": "node ./scripts/reset-project.js",
    "plan:invariants": "node server/scripts/plan-rules-invariants.js",
    "plan:quality": "node server/scripts/plan-quality-harness.js",
    "plan:personalization-regression": "node server/scripts/plan-personalization-regression.js",
    "plan:distance-propagation-regression": "node server/scripts/plan-distance-propagation-regression.js",
    "plan:common-snapshots": "node server/scripts/plan-common-profiles-snapshots.js",
    "plan:common-snapshots:update": "node server/scripts/plan-common-profiles-snapshots.js --update"
  },
  "expo": {
    "plugins": [
      "expo-router"
    ]
  },
  "dependencies": {
    "@expo/metro-runtime": "~55.0.9",
    "@expo/spawn-async": "^1.7.2",
    "@expo/vector-icons": "^15.0.3",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@react-native-community/datetimepicker": "8.6.0",
    "@react-native-voice/voice": "^3.2.4",
    "@react-navigation/bottom-tabs": "^7.4.0",
    "@react-navigation/elements": "^2.6.3",
    "@react-navigation/native": "^7.1.8",
    "expo": "^55.0.15",
    "expo-apple-authentication": "~55.0.13",
    "expo-asset": "~55.0.15",
    "expo-blur": "~55.0.14",
    "expo-camera": "~55.0.15",
    "expo-constants": "~55.0.14",
    "expo-crypto": "~55.0.14",
    "expo-file-system": "~55.0.16",
    "expo-font": "~55.0.6",
    "expo-haptics": "~55.0.14",
    "expo-image": "~55.0.8",
    "expo-image-picker": "~55.0.18",
    "expo-linear-gradient": "~55.0.13",
    "expo-linking": "~55.0.13",
    "expo-location": "~55.1.8",
    "expo-router": "~55.0.12",
    "expo-splash-screen": "~55.0.18",
    "expo-status-bar": "~55.0.5",
    "expo-symbols": "~55.0.7",
    "expo-system-ui": "~55.0.15",
    "expo-web-browser": "~55.0.14",
    "firebase": "^12.6.0",
    "fit-encoder": "^0.1.5",
    "lucide-react-native": "^1.6.0",
    "openai": "^6.8.1",
    "promise": "^8.3.0",
    "protobufjs": "6.11.4",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "react-freeze": "^1.0.4",
    "react-native": "0.83.6",
    "react-native-gesture-handler": "~2.30.0",
    "react-native-maps": "1.27.2",
    "react-native-reanimated": "4.2.1",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.23.0",
    "react-native-svg": "15.15.3",
    "react-native-web": "^0.21.0",
    "react-native-worklets": "0.7.4",
    "scheduler": "^0.27.0"
  },
  "devDependencies": {
    "@types/react": "~19.2.10",
    "eslint": "^9.25.0",
    "eslint-config-expo": "~55.0.0",
    "typescript": "^5.9.2"
  }
}

```

Generated on: 2026-04-24 10:28:02 UTC
