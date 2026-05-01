import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
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
import Svg, { Circle, Line, Path } from "react-native-svg";

import Feather from "../../components/LucideFeather";
import { useTheme } from "../../providers/ThemeProvider";
import { useMePageData } from "../../src/hooks/useMePageData";

const DARK_PAGE_COLORS = {
  bg: "#000000",
  surface: "#12141A",
  surfaceAlt: "#111217",
  panel: "#0B0E14",
  line: "rgba(230,255,59,0.12)",
  faintLine: "rgba(255,255,255,0.07)",
  text: "#F2F4EE",
  muted: "#A7ABA0",
  soft: "#5F6646",
  orange: "#E6FF3B",
  orangeSoft: "rgba(230,255,59,0.18)",
  panelGlow: "rgba(230,255,59,0.08)",
  primaryText: "#111111",
};

function makePageColors(appColors, isDark) {
  if (isDark) return DARK_PAGE_COLORS;
  return {
    bg: appColors.bg || "#EFEFEF",
    surface: "#F6F7FA",
    surfaceAlt: appColors.sapSilverLight || appColors.surfaceAlt || "#F3F4F6",
    panel: "#FFFFFF",
    line: appColors.divider || "#D1D1D1",
    faintLine: "rgba(17,17,17,0.08)",
    text: appColors.text || "#0B0B0B",
    muted: appColors.subtext || "#555555",
    soft: appColors.borderStrong || "#9E9E9E",
    orange: appColors.sapPrimary || "#E6FF3B",
    orangeSoft: "rgba(230,255,59,0.34)",
    panelGlow: "rgba(63,79,0,0.06)",
    primaryText: appColors.sapOnPrimary || "#111111",
  };
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
  const [activeTab, setActiveTab] = useState("overview");
  const {
    loading,
    error,
    profile,
    progress,
    recentActivities,
    garminWorkoutSyncs,
    integrationRows,
    deeperLinks,
    refresh,
  } = useMePageData();

  const metrics = useMemo(
    () => buildMetrics(progress, recentActivities),
    [progress, recentActivities]
  );
  const activityFeed = useMemo(
    () => buildActivityFeed(recentActivities, garminWorkoutSyncs),
    [garminWorkoutSyncs, recentActivities]
  );
  const chartWidth = Math.max(260, Math.min(width - 68, 420));
  const c = useMemo(() => makePageColors(appColors, isDark), [appColors, isDark]);
  const s = useMemo(() => makeStyles(c), [c]);
  const topFadeStart = useMemo(() => {
    const accent = appColors?.accentBg || appColors?.sapPrimary || "#E6FF3B";
    const alpha = isDark ? "33" : "55";
    const resolved = withHexAlpha(accent, alpha);
    if (resolved !== accent) return resolved;
    return isDark ? "rgba(230,255,59,0.2)" : "rgba(230,255,59,0.3)";
  }, [appColors, isDark]);

  return (
    <YouThemeContext.Provider value={{ c, s }}>
      <SafeAreaView style={s.safe} edges={["top"]}>
        <LinearGradient
          colors={[topFadeStart, c.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={s.topBackgroundFade}
          pointerEvents="none"
        />
        <View style={s.topBar}>
          <Text style={s.topBarTitle}>You</Text>
          <View style={s.topBarActions}>
            <TouchableOpacity style={s.topBarButton} onPress={() => router.push("/record")}>
              <Feather name="plus-circle" size={22} color={c.text} strokeWidth={2.1} />
            </TouchableOpacity>
            <TouchableOpacity style={s.topBarButton} onPress={() => router.push("/settings")}>
              <Feather name="sliders" size={20} color={c.text} strokeWidth={2.1} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.tabsWrap}>
          {[
            ["overview", "Overview"],
            ["activity", "Activity Log"],
          ].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[s.tabChip, activeTab === key && s.tabChipActive]}
              onPress={() => setActiveTab(key)}
              activeOpacity={0.84}
            >
              <Text style={[s.tabChipText, activeTab === key && s.tabChipTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={c.orange} />
              <Text style={s.loadingText}>Loading your dashboard</Text>
            </View>
          ) : (
            <>
              {!!error && (
                <TouchableOpacity style={s.errorBand} onPress={refresh}>
                  <Text style={s.errorText}>{error}</Text>
                  <Text style={s.inlineActionText}>Retry</Text>
                </TouchableOpacity>
              )}

              {activeTab === "activity" ? (
                <ActivityLogTab profile={profile} activities={activityFeed} router={router} />
              ) : (
                <OverviewTab
                  chartWidth={chartWidth}
                  deeperLinks={deeperLinks}
                  integrationRows={integrationRows}
                  metrics={metrics}
                  profile={profile}
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

function OverviewTab({ chartWidth, deeperLinks, integrationRows, metrics, profile, router }) {
  return (
    <>
      <HeroCard metrics={metrics} profile={profile} router={router} />
      <PlanPulseCard metrics={metrics} router={router} />
      <StatsGrid metrics={metrics} />
      <TrendCard chartWidth={chartWidth} metrics={metrics} router={router} />
      <ConsistencyCard metrics={metrics} />
      <HighlightsCard metrics={metrics} />
      <LinkCluster items={deeperLinks} router={router} />
      <IntegrationsCard rows={integrationRows} />
    </>
  );
}

function HeroCard({ metrics, profile, router }) {
  const { c, s } = useYouTheme();
  const name = profile?.name || "You";
  const supportLine =
    profile?.supportLine || profile?.statusDetail || "Personal progress";

  return (
    <View style={s.heroCard}>
      <View style={s.heroTop}>
        <TouchableOpacity
          style={s.heroIdentity}
          onPress={() => router.push("/profile")}
          activeOpacity={0.86}
        >
          <View style={s.heroAvatarRing}>
            {profile?.photoURL ? (
              <Image source={{ uri: profile.photoURL }} style={s.heroAvatar} />
            ) : (
              <Text style={s.heroAvatarInitial}>{initialFor(name)}</Text>
            )}
          </View>

          <View style={s.heroCopy}>
            <Text style={s.heroEyebrow}>Training profile</Text>
            <Text style={s.heroName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={s.heroMeta} numberOfLines={2}>
              {supportLine}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={s.heroBadge}>
          <Text style={s.heroBadgeLabel}>This week</Text>
          <Text style={s.heroBadgeValue}>{formatKm(metrics.weekDistance)}</Text>
        </View>
      </View>

      <View style={s.heroSummaryRow}>
        <View style={s.heroSummaryMetric}>
          <Text style={s.heroSummaryValue}>{metrics.weekWorkouts}</Text>
          <Text style={s.heroSummaryLabel}>Sessions</Text>
        </View>
        <View style={s.heroSummaryMetric}>
          <Text style={s.heroSummaryValue}>{metrics.streakLabel}</Text>
          <Text style={s.heroSummaryLabel}>Consistency</Text>
        </View>
        <View style={s.heroSummaryMetric}>
          <Text style={s.heroSummaryValue}>{metrics.relativeEffort}</Text>
          <Text style={s.heroSummaryLabel}>Load</Text>
        </View>
      </View>

      <View style={s.heroActionRow}>
        <TouchableOpacity
          style={s.heroPrimaryButton}
          onPress={() => router.push("/record")}
          activeOpacity={0.88}
        >
          <Feather name="plus-circle" size={16} color={c.primaryText} />
          <Text style={s.heroPrimaryButtonText}>Log activity</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.heroSecondaryButton}
          onPress={() => router.push("/profile")}
          activeOpacity={0.84}
        >
          <Text style={s.heroSecondaryButtonText}>Edit profile</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.heroSecondaryButton}
          onPress={() => router.push("/settings")}
          activeOpacity={0.84}
        >
          <Text style={s.heroSecondaryButtonText}>Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PlanPulseCard({ metrics, router }) {
  const { s } = useYouTheme();
  const hasGoal = metrics.weekGoal > 0;

  return (
    <DashboardCard
      eyebrow="Current focus"
      title="Weekly build"
      actionLabel="Open progress"
      onPress={() => router.push("/me/this-week")}
    >
      <Text style={s.cardBody}>
        {hasGoal
          ? `${formatKm(metrics.weekDistance)} banked with ${formatKm(metrics.goalRemaining)} left to hit your weekly target.`
          : "Set a weekly target to track your build here."}
      </Text>

      {hasGoal && (
        <View style={s.pulseStrip}>
          <View
            style={[
              s.pulseStripFill,
              {
                width: `${Math.max(8, Math.min(100, toNum(metrics.goalProgress, 0) * 100))}%`,
              },
            ]}
          />
        </View>
      )}

      <View style={s.pulseMetaRow}>
        <Text style={s.pulseMetaLabel}>{metrics.weekWorkouts} sessions recorded</Text>
        <Text style={s.pulseMetaValue}>
          {hasGoal ? `${formatKm(metrics.weekDistance)} / ${formatKm(metrics.weekGoal)}` : "No target set"}
        </Text>
      </View>
    </DashboardCard>
  );
}

function StatsGrid({ metrics }) {
  const { s } = useYouTheme();
  const items = [
    ["Distance", formatKm(metrics.weekDistance)],
    ["Time", formatDuration(metrics.weekMinutes)],
    ["This month", `${metrics.monthActivities}`],
    ["Elev gain", metrics.elevationGain > 0 ? `${metrics.elevationGain} m` : "—"],
  ];

  return (
    <View style={s.statGrid}>
      {items.map(([label, value]) => (
        <View key={label} style={s.statTile}>
          <Text style={s.statTileValue}>{value}</Text>
          <Text style={s.statTileLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function TrendCard({ chartWidth, metrics, router }) {
  const { s } = useYouTheme();
  const hasTrend = metrics.distanceTrend.length > 1;

  return (
    <DashboardCard
      eyebrow="Trend"
      title="12-week distance rhythm"
      actionLabel="View all trends"
      onPress={() => router.push("/me/trends")}
    >
      <Text style={s.cardBody}>
        {hasTrend
          ? "Your weekly distance trend is based on logged training."
          : "Not enough weekly history to draw a trend yet."}
      </Text>
      {hasTrend ? (
        <ProgressAreaChart width={chartWidth} values={metrics.distanceTrend} />
      ) : (
        <View style={s.metricUnavailableBox}>
          <Text style={s.metricUnavailableText}>Trend unavailable</Text>
        </View>
      )}
    </DashboardCard>
  );
}

function ConsistencyCard({ metrics }) {
  const { s } = useYouTheme();
  return (
    <DashboardCard eyebrow="Consistency" title={metrics.monthLabel}>
      <View style={s.dualMetricRow}>
        <View style={s.dualMetricItem}>
          <Text style={s.dualMetricValue}>{metrics.streakLabel}</Text>
          <Text style={s.dualMetricLabel}>Active over last 14 days</Text>
        </View>
        <View style={s.dualMetricItem}>
          <Text style={s.dualMetricValue}>{metrics.monthActivities}</Text>
          <Text style={s.dualMetricLabel}>Activities this month</Text>
        </View>
      </View>
      <StreakCalendar activeDays={metrics.activeDays} today={metrics.todayDate} />
    </DashboardCard>
  );
}

function HighlightsCard({ metrics }) {
  const { s } = useYouTheme();
  const hasPrediction = Boolean(metrics.fiveKPrediction);

  return (
    <View style={s.highlightSplit}>
      <View style={s.highlightCard}>
        <Text style={s.cardEyebrow}>Performance</Text>
        <Text style={s.highlightValue}>{hasPrediction ? metrics.fiveKPrediction : "—"}</Text>
        <Text style={s.highlightLabel}>Predicted 5K</Text>
        <Text style={s.cardBody}>
          {hasPrediction
            ? "Based on your recent logged running."
            : "Not enough run data for a prediction yet."}
        </Text>
      </View>

      <View style={s.highlightCard}>
        <Text style={s.cardEyebrow}>Best efforts</Text>
        <BestEfforts efforts={metrics.bestEfforts} compact />
      </View>
    </View>
  );
}

function LinkCluster({ items, router }) {
  const { s } = useYouTheme();
  const list = Array.isArray(items) ? items : [];

  if (!list.length) return null;

  return (
    <DashboardCard eyebrow="Go deeper" title="Explore your data">
      <View style={s.linkCluster}>
        {list.map((item) => (
          <TouchableOpacity
            key={item.key || item.label}
            style={s.linkClusterRow}
            activeOpacity={item.path ? 0.82 : 1}
            onPress={item.path ? () => router.push(item.path) : undefined}
            disabled={!item.path}
          >
            <View style={s.linkClusterCopy}>
              <Text style={s.linkClusterTitle}>{item.label}</Text>
              <Text style={s.linkClusterMeta}>{item.meta}</Text>
            </View>
            {!!item.value && (
              <View style={s.linkClusterBadge}>
                <Text style={s.linkClusterBadgeText}>{item.value}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </DashboardCard>
  );
}

function IntegrationsCard({ rows }) {
  const { c, s } = useYouTheme();
  const normalized = rows?.length ? rows : [];

  return (
    <DashboardCard eyebrow="Connections" title="Data sources">
      <View style={s.integrationList}>
        {normalized.map((row) => (
          <View key={row.key} style={s.integrationRow}>
            <View style={s.integrationIconWrap}>
              <Feather name={row.key === "garmin" ? "watch" : "link"} size={18} color={c.orange} />
            </View>
            <View style={s.integrationCopy}>
              <Text style={s.integrationTitle}>{row.label}</Text>
              <Text style={s.integrationMeta}>{row.meta}</Text>
              {!!row.detail && <Text style={s.integrationDetail}>{row.detail}</Text>}
            </View>
            <Text style={s.integrationValue}>{row.value}</Text>
          </View>
        ))}
      </View>
    </DashboardCard>
  );
}

function ActivityLogTab({ activities, profile, router }) {
  const { s } = useYouTheme();
  const hasActivities = activities.length > 0;

  return (
    <View style={s.activityPage}>
      <DashboardCard eyebrow="Activity log" title="Recent sessions">
        <Text style={s.cardBody}>
          {hasActivities
            ? "Clean session summaries, without the social feed framing."
            : "Your logged and synced sessions will appear here."}
        </Text>
      </DashboardCard>

      {hasActivities ? (
        <View style={s.activityList}>
          {activities.map((activity) => (
            <ActivityFeedItem key={activity.id} activity={activity} profile={profile} />
          ))}
        </View>
      ) : (
        <EmptyActivityState router={router} />
      )}
    </View>
  );
}

function EmptyActivityState({ router }) {
  const { c, s } = useYouTheme();

  return (
    <View style={s.emptyActivityCard}>
      <View style={s.emptyActivityIcon}>
        <Feather name="activity" size={24} color={c.orange} strokeWidth={2.1} />
      </View>
      <Text style={s.emptyActivityTitle}>No activity yet</Text>
      <Text style={s.emptyActivityBody}>
        Log a session or connect a training account to start building your activity log.
      </Text>
      <View style={s.emptyActivityActions}>
        <TouchableOpacity
          style={s.emptyActivityPrimary}
          onPress={() => router.push("/record")}
          activeOpacity={0.86}
        >
          <Text style={s.emptyActivityPrimaryText}>Log activity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.emptyActivitySecondary}
          onPress={() => router.push("/settings")}
          activeOpacity={0.86}
        >
          <Text style={s.emptyActivitySecondaryText}>Connect account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ActivityFeedItem({ activity, profile }) {
  const { c, s } = useYouTheme();
  return (
    <View style={s.activityCard}>
      <View style={s.activityTop}>
        <View style={s.activityIdentity}>
          <View style={s.activityAvatarWrap}>
            {profile?.photoURL ? (
              <Image source={{ uri: profile.photoURL }} style={s.activityAvatar} />
            ) : (
              <Text style={s.activityAvatarInitial}>{initialFor(profile?.name)}</Text>
            )}
          </View>
          <View style={s.activityHeaderCopy}>
            <Text style={s.activityHeaderName}>{profile?.name || "You"}</Text>
            <Text style={s.activityHeaderMeta} numberOfLines={1}>
              {activity.whenLabel}
            </Text>
          </View>
        </View>

        <View style={s.activityTypePill}>
          <Feather name={activity.icon} size={15} color={c.orange} />
          <Text style={s.activityTypePillText}>{activity.typeLabel}</Text>
        </View>
      </View>

      <Text style={s.activityTitle}>{activity.title}</Text>
      {!!activity.note && <Text style={s.activityNote}>{activity.note}</Text>}

      <View style={s.activityStatsRow}>
        {activity.stats.map(([label, value]) => (
          <View key={label} style={s.activityStatTile}>
            <Text style={s.activityStatValue}>{value}</Text>
            <Text style={s.activityStatLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function DashboardCard({ actionLabel, children, eyebrow, onPress, title }) {
  const { s } = useYouTheme();
  return (
    <View style={s.dashboardCard}>
      <View style={s.dashboardCardHeader}>
        <View style={s.dashboardCardCopy}>
          {!!eyebrow && <Text style={s.cardEyebrow}>{eyebrow}</Text>}
          {!!title && <Text style={s.cardTitle}>{title}</Text>}
        </View>
        {!!actionLabel && !!onPress && (
          <TouchableOpacity onPress={onPress} activeOpacity={0.82}>
            <Text style={s.inlineActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

function BestEfforts({ efforts, compact = false }) {
  const { s } = useYouTheme();
  const rows = Array.isArray(efforts) ? efforts : [];

  if (!rows.length) {
    return (
      <View style={[s.bestEfforts, compact && s.bestEffortsCompact]}>
        <Text style={s.cardBody}>No verified best efforts yet.</Text>
      </View>
    );
  }

  return (
    <View style={[s.bestEfforts, compact && s.bestEffortsCompact]}>
      {rows.map(([label, value]) => (
        <View key={label} style={s.bestRow}>
          <Text style={s.bestTitle}>{label}</Text>
          <Text style={s.bestValue}>{value}</Text>
        </View>
      ))}
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
        <Text style={s.axisLabel}>12 weeks ago</Text>
        <Text style={s.axisLabel}>Now</Text>
      </View>
    </View>
  );
}

function StreakCalendar({ activeDays, today }) {
  const { s } = useYouTheme();
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const cells = Array.from({ length: 35 }, (_, index) => index + 1);

  return (
    <View style={s.calendar}>
      <View style={s.calendarWeek}>
        {days.map((day, index) => (
          <Text key={`${day}-${index}`} style={s.calendarDay}>
            {day}
          </Text>
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
                <RectifiedDot active />
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

function RectifiedDot() {
  const { c, s } = useYouTheme();
  return <View style={[s.calendarPulse, { backgroundColor: c.primaryText }]} />;
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
  const weekGoal = toNum(progress?.weeklyGoalKm, 0);
  const goalRemaining = Math.max(0, weekGoal - weekDistance);
  const now = new Date();

  return {
    weekDistance,
    weekMinutes,
    monthDistance,
    monthMinutes,
    monthActivities,
    weekWorkouts: toNum(weekly.workouts),
    elevationGain: 0,
    monthName: now.toLocaleDateString("en-GB", { month: "long" }),
    yearLabel: String(now.getFullYear()),
    monthLabel: now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    todayDate: now.getDate(),
    streakLabel: activeDays14 ? `${activeDays14} days` : "0 days",
    activeDays: buildActiveDays(activeDays14, now.getDate()),
    distanceTrend: Array.isArray(progress?.distanceTrend) ? progress.distanceTrend : [],
    fiveKPrediction: predictFiveK(weekDistance, weekMinutes),
    relativeEffort: weekMinutes > 0 ? Math.max(1, Math.round(weekMinutes / 3)) : "—",
    fitnessScore: null,
    bestEfforts: Array.isArray(progress?.bestEfforts) ? progress.bestEfforts : [],
    weekGoal,
    goalRemaining,
    goalProgress: weekGoal ? weekDistance / weekGoal : 0,
  };
}

function buildActivityFeed(recentActivities, garminWorkoutSyncs) {
  const source = recentActivities?.length ? recentActivities : [];
  const mappedActivities = source.map((activity, index) => {
    const provider = String(activity.provider || "").toLowerCase();
    const type = String(activity.type || activity.sport_type || "Workout");
    const distanceKm = readDistanceKm(activity);
    const minutes = readMovingMinutes(activity);
    const pace = distanceKm > 0 && minutes > 0 ? formatPace(minutes / distanceKm) : "";
    const isStrength = /weight|strength|gym/i.test(type) || (!distanceKm && minutes >= 45);
    const title =
      activity.name ||
      activity.title ||
      (isStrength
        ? "Strength session"
        : type === "Walk"
        ? "Walk"
        : `${type} session`);
    const averageHr = toNum(activity.average_heartrate || activity.averageHeartRate, 0);
    const calories = toNum(activity.calories || activity.kilojoules, 0);
    const stats = isStrength
      ? [
          minutes > 0 ? ["Time", formatLongDuration(minutes)] : null,
          averageHr > 0 ? ["Avg HR", `${Math.round(averageHr)} bpm`] : null,
          calories > 0 ? ["Cal", `${Math.round(calories)} Cal`] : null,
        ].filter(Boolean)
      : [
          distanceKm > 0 ? ["Distance", formatKm(distanceKm)] : null,
          pace ? ["Pace", pace] : null,
          minutes > 0 ? ["Time", formatLongDuration(minutes)] : null,
        ].filter(Boolean);

    return {
      id: activity.id || `activity-${index}`,
      icon: provider === "garmin" ? "watch" : isStrength ? "zap" : type === "Walk" ? "map-pin" : "activity",
      typeLabel: provider === "garmin" ? "Garmin" : isStrength ? "Strength" : type,
      note: activity.description || activity.note || "",
      stats: stats.length ? stats : [["Type", isStrength ? "Strength" : type]],
      title,
      whenLabel:
        activity.whenLabel ||
        formatActivityDate(activity.startDateMs || activity.startDate || activity.when),
      sortMs: toMillis(activity.startDateMs || activity.startDate || activity.when),
    };
  });

  const mappedGarmin = (Array.isArray(garminWorkoutSyncs) ? garminWorkoutSyncs : []).map(
    (sync, index) => {
      const uploadedMs = toMillis(sync.uploadedAtMs || sync.uploadedAt || sync.syncedAt);
      const workoutId = sync.garminWorkoutId || sync.createdWorkoutId || "";
      const responseStatus = sync.responseStatus ? String(sync.responseStatus) : "";
      const stats = [
        ["Provider", "Garmin"],
        workoutId ? ["Workout ID", String(workoutId)] : null,
        responseStatus ? ["Status", responseStatus] : null,
      ].filter(Boolean);

      return {
        id: `garmin-sync-${sync.id || workoutId || index}`,
        icon: "watch",
        typeLabel: "Garmin",
        note: "Sent to Garmin via Training API",
        stats,
        title: sync.title || "Workout sent to Garmin",
        whenLabel: formatActivityDate(uploadedMs),
        sortMs: uploadedMs,
      };
    }
  );

  return [...mappedActivities, ...mappedGarmin]
    .sort((a, b) => toNum(b.sortMs) - toNum(a.sortMs))
    .slice(0, 20);
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

function predictFiveK(distance, minutes) {
  if (distance > 0 && minutes > 0) {
    const pace = minutes / distance;
    const total = Math.max(15, Math.round(pace * 5));
    return `${total}:00`;
  }
  return "";
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

function formatActivityDate(value) {
  const ms = toMillis(value);
  if (!ms) return "Date unavailable";
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
    topBackgroundFade: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 280,
    },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    topBarTitle: {
      color: c.text,
      fontSize: 24,
      fontWeight: "900",
      letterSpacing: -0.6,
    },
    topBarActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    topBarButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    tabsWrap: {
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 12,
      flexDirection: "row",
      gap: 10,
    },
    tabChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: c.surface,
    },
    tabChipActive: {
      backgroundColor: c.orange,
    },
    tabChipText: {
      color: c.muted,
      fontSize: 13,
      fontWeight: "800",
    },
    tabChipTextActive: {
      color: c.primaryText,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 20,
      paddingBottom: 140,
      gap: 16,
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
      padding: 16,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      gap: 8,
    },
    errorText: {
      color: c.text,
      fontSize: 15,
      lineHeight: 21,
    },
    heroCard: {
      padding: 22,
      borderRadius: 28,
      backgroundColor: c.surface,
      gap: 18,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    heroTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 14,
    },
    heroIdentity: {
      flex: 1,
      flexDirection: "row",
      gap: 14,
    },
    heroAvatarRing: {
      width: 68,
      height: 68,
      borderRadius: 22,
      borderWidth: 1.5,
      borderColor: c.orange,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      backgroundColor: c.surfaceAlt,
    },
    heroAvatar: {
      width: "100%",
      height: "100%",
    },
    heroAvatarInitial: {
      color: c.text,
      fontSize: 28,
      fontWeight: "900",
    },
    heroCopy: {
      flex: 1,
      justifyContent: "center",
      gap: 4,
    },
    heroEyebrow: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    heroName: {
      color: c.text,
      fontSize: 28,
      lineHeight: 31,
      fontWeight: "900",
      letterSpacing: -0.8,
    },
    heroMeta: {
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
    },
    heroBadge: {
      minWidth: 96,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: c.panel,
      justifyContent: "space-between",
      gap: 6,
    },
    heroBadgeLabel: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    heroBadgeValue: {
      color: c.text,
      fontSize: 16,
      fontWeight: "900",
    },
    heroSummaryRow: {
      flexDirection: "row",
      gap: 10,
    },
    heroSummaryMetric: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      gap: 4,
    },
    heroSummaryValue: {
      color: c.text,
      fontSize: 18,
      fontWeight: "900",
      letterSpacing: -0.4,
    },
    heroSummaryLabel: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    heroActionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    heroPrimaryButton: {
      minHeight: 46,
      borderRadius: 999,
      paddingHorizontal: 16,
      backgroundColor: c.orange,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    heroPrimaryButtonText: {
      color: c.primaryText,
      fontSize: 13,
      fontWeight: "900",
    },
    heroSecondaryButton: {
      minHeight: 46,
      borderRadius: 999,
      paddingHorizontal: 16,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    heroSecondaryButtonText: {
      color: c.text,
      fontSize: 13,
      fontWeight: "800",
    },
    dashboardCard: {
      padding: 20,
      borderRadius: 24,
      backgroundColor: c.surface,
      gap: 16,
    },
    dashboardCardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
    },
    dashboardCardCopy: {
      flex: 1,
      gap: 4,
    },
    cardEyebrow: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    cardTitle: {
      color: c.text,
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "900",
      letterSpacing: -0.5,
    },
    inlineActionText: {
      color: c.orange,
      fontSize: 12,
      fontWeight: "800",
    },
    cardBody: {
      color: c.muted,
      fontSize: 14,
      lineHeight: 20,
    },
    pulseStrip: {
      height: 14,
      borderRadius: 999,
      overflow: "hidden",
      backgroundColor: c.surfaceAlt,
    },
    pulseStripFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: c.orange,
    },
    pulseMetaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 10,
    },
    pulseMetaLabel: {
      color: c.muted,
      fontSize: 12,
    },
    pulseMetaValue: {
      color: c.text,
      fontSize: 12,
      fontWeight: "800",
    },
    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
    },
    statTile: {
      width: "48%",
      padding: 18,
      borderRadius: 22,
      backgroundColor: c.surface,
      gap: 6,
    },
    statTileValue: {
      color: c.text,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "900",
      letterSpacing: -0.7,
    },
    statTileLabel: {
      color: c.muted,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    chartWrap: {
      alignItems: "center",
      gap: 8,
    },
    chartAxis: {
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 6,
    },
    axisLabel: {
      color: c.muted,
      fontSize: 12,
      fontWeight: "600",
    },
    metricUnavailableBox: {
      minHeight: 118,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.faintLine,
      alignItems: "center",
      justifyContent: "center",
    },
    metricUnavailableText: {
      color: c.muted,
      fontSize: 13,
      fontWeight: "800",
    },
    dualMetricRow: {
      flexDirection: "row",
      gap: 12,
    },
    dualMetricItem: {
      flex: 1,
      gap: 5,
    },
    dualMetricValue: {
      color: c.text,
      fontSize: 21,
      fontWeight: "900",
    },
    dualMetricLabel: {
      color: c.muted,
      fontSize: 12,
      lineHeight: 17,
    },
    calendar: {
      gap: 12,
    },
    calendarWeek: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    calendarDay: {
      width: 38,
      textAlign: "center",
      color: c.muted,
      fontSize: 12,
      fontWeight: "700",
    },
    calendarGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 10,
    },
    calendarCell: {
      width: 38,
      height: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.surfaceAlt,
    },
    calendarCellActive: {
      backgroundColor: c.orange,
      borderColor: c.orange,
    },
    calendarCellToday: {
      borderColor: c.text,
    },
    calendarNumber: {
      color: c.muted,
      fontSize: 13,
      fontWeight: "700",
    },
    calendarNumberToday: {
      color: c.text,
    },
    calendarPulse: {
      width: 10,
      height: 10,
      borderRadius: 3,
    },
    highlightSplit: {
      flexDirection: "row",
      gap: 12,
    },
    highlightCard: {
      flex: 1,
      padding: 18,
      borderRadius: 24,
      backgroundColor: c.surface,
      gap: 10,
      minHeight: 180,
    },
    highlightValue: {
      color: c.text,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: "900",
      letterSpacing: -1,
    },
    highlightLabel: {
      color: c.text,
      fontSize: 14,
      fontWeight: "800",
    },
    bestEfforts: {
      gap: 12,
    },
    bestEffortsCompact: {
      marginTop: 4,
    },
    bestRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    bestTitle: {
      color: c.muted,
      fontSize: 13,
      fontWeight: "700",
    },
    bestValue: {
      color: c.text,
      fontSize: 14,
      fontWeight: "900",
    },
    linkCluster: {
      gap: 12,
    },
    linkClusterRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.faintLine,
    },
    linkClusterCopy: {
      flex: 1,
      gap: 4,
    },
    linkClusterTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: "800",
    },
    linkClusterMeta: {
      color: c.muted,
      fontSize: 12,
      lineHeight: 17,
    },
    linkClusterBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    linkClusterBadgeText: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "800",
    },
    integrationList: {
      gap: 14,
    },
    integrationRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    integrationIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    integrationCopy: {
      flex: 1,
      gap: 4,
    },
    integrationTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: "800",
    },
    integrationMeta: {
      color: c.muted,
      fontSize: 12,
    },
    integrationDetail: {
      color: c.soft,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
    },
    integrationValue: {
      color: c.text,
      fontSize: 12,
      fontWeight: "800",
    },
    activityPage: {
      gap: 16,
    },
    activityList: {
      gap: 14,
    },
    emptyActivityCard: {
      padding: 22,
      borderRadius: 24,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.faintLine,
      gap: 14,
    },
    emptyActivityIcon: {
      width: 50,
      height: 50,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyActivityTitle: {
      color: c.text,
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "900",
      letterSpacing: -0.6,
    },
    emptyActivityBody: {
      color: c.muted,
      fontSize: 14,
      lineHeight: 20,
      maxWidth: 320,
    },
    emptyActivityActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      paddingTop: 4,
    },
    emptyActivityPrimary: {
      minHeight: 44,
      borderRadius: 999,
      paddingHorizontal: 16,
      backgroundColor: c.orange,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyActivityPrimaryText: {
      color: c.primaryText,
      fontSize: 13,
      fontWeight: "900",
    },
    emptyActivitySecondary: {
      minHeight: 44,
      borderRadius: 999,
      paddingHorizontal: 16,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyActivitySecondaryText: {
      color: c.text,
      fontSize: 13,
      fontWeight: "800",
    },
    activityCard: {
      padding: 18,
      borderRadius: 24,
      backgroundColor: c.surface,
      gap: 16,
    },
    activityTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    activityIdentity: {
      flex: 1,
      flexDirection: "row",
      gap: 12,
    },
    activityAvatarWrap: {
      width: 48,
      height: 48,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: c.orange,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    activityAvatar: {
      width: "100%",
      height: "100%",
    },
    activityAvatarInitial: {
      color: c.text,
      fontSize: 18,
      fontWeight: "900",
    },
    activityHeaderCopy: {
      flex: 1,
      gap: 4,
      justifyContent: "center",
    },
    activityHeaderName: {
      color: c.text,
      fontSize: 15,
      fontWeight: "800",
    },
    activityHeaderMeta: {
      color: c.muted,
      fontSize: 12,
    },
    activityTypePill: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    activityTypePillText: {
      color: c.text,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    activityTitle: {
      color: c.text,
      fontSize: 26,
      lineHeight: 30,
      fontWeight: "900",
      letterSpacing: -0.8,
    },
    activityNote: {
      color: c.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: -6,
    },
    activityStatsRow: {
      flexDirection: "row",
      gap: 10,
    },
    activityStatTile: {
      flex: 1,
      padding: 12,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      gap: 6,
    },
    activityStatValue: {
      color: c.text,
      fontSize: 18,
      fontWeight: "900",
    },
    activityStatLabel: {
      color: c.muted,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
  });
}
