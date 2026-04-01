import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../../providers/ThemeProvider';

const WORKOUT = {
  dateLabel: 'Saturday 17 May',
  title: 'Long run',
  subtitle: 'Aerobic endurance · build phase',
  distanceKm: 14,
  duration: '75–90 min',
  effort: 'Easy / Z2',
  phase: 'BUILD',
  locationHint: 'Park loop',
  startWindow: 'Best window · 08:00–11:00',
  coachNote:
    'Keep the first 20 minutes deliberately relaxed. This is an aerobic day, so the win is finishing smooth and controlled rather than chasing pace.',
  whyItMatters:
    'This session builds endurance, improves fatigue resistance, and sets up next week without adding too much intensity.',
  confidence: 'High readiness',
  readinessReason: 'Good sleep, light fatigue, and no back-to-back intensity load.',
  weather: {
    temp: '14°',
    feelsLike: '12°',
    summary: 'Light rain · cool',
    rainChance: '40%',
    wind: '11 km/h',
    humidity: '74%',
    note: 'Light shell advised. Roads may be slick for the first 20 minutes.',
  },
  targets: {
    paceLabel: '5:14–6:20 /km',
    hrLabel: '135–149 bpm',
    cadenceLabel: 'Relaxed stride',
    source: {
      pace: 'Recent race anchor',
      hr: 'Profile HR zones',
    },
  },
  fuel: {
    pre: '30–50g carbs 45–60 min before',
    during: 'Water only unless going beyond 80–90 min',
    post: '25–35g protein + carbs within 60 min',
  },
  checklist: [
    'Light waterproof or cap if drizzle continues',
    'Start easier than you think for first 10 min',
    'Keep effort conversational all the way',
    'Log how legs felt after the run',
  ],
  structure: [
    {
      key: 'warmup',
      label: 'Warm up',
      icon: 'sunrise',
      duration: '10 min',
      detail: 'Settle in gently. Keep breathing easy and stride short.',
      type: 'support',
    },
    {
      key: 'main',
      label: 'Main run',
      icon: 'activity',
      duration: '14 km easy',
      detail: 'Stay within easy effort. If terrain changes, hold effort rather than forcing pace.',
      type: 'primary',
    },
    {
      key: 'cooldown',
      label: 'Cooldown',
      icon: 'moon',
      duration: '5–10 min walk + mobility',
      detail: 'Bring HR down, then do a short calf / hip mobility reset.',
      type: 'support',
    },
  ],
};

const ACTIONS = [
  { key: 'start', icon: 'play', label: 'Start workout', primary: true },
  { key: 'garmin', icon: 'send', label: 'Send to device' },
  { key: 'adjust', icon: 'sliders', label: 'Adjust session' },
  { key: 'coach', icon: 'message-circle', label: 'Ask coach' },
];

function Pill({ label, styles }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function SmallMetric({ label, value, styles }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MetaChip({ icon, text, styles, colors }) {
  return (
    <View style={styles.metaChip}>
      <Feather name={icon} size={13} color={colors.subtext} />
      <Text style={styles.metaChipText}>{text}</Text>
    </View>
  );
}

function SectionHeader({ title, action, styles, onPress }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.82}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function StepCard({ item, styles, colors, accentBg, isDark }) {
  const primary = item.type === 'primary';
  return (
    <View
      style={[
        styles.stepCard,
        primary && {
          borderColor: accentBg,
          backgroundColor: isDark ? '#15180E' : '#FAFFD9',
        },
      ]}
    >
      <View style={styles.stepTopRow}>
        <View style={[styles.stepIconWrap, primary && { backgroundColor: accentBg }]}> 
          <Feather name={item.icon} size={16} color={primary ? '#111111' : colors.text} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepTitle}>{item.label}</Text>
          <Text style={styles.stepDuration}>{item.duration}</Text>
        </View>
      </View>
      <Text style={styles.stepDetail}>{item.detail}</Text>
    </View>
  );
}

function ActionButton({ item, styles, colors, accentBg }) {
  if (item.primary) {
    return (
      <TouchableOpacity style={styles.primaryButton} activeOpacity={0.88}>
        <Feather name={item.icon} size={16} color="#111111" />
        <Text style={styles.primaryButtonText}>{item.label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.86}>
      <Feather name={item.icon} size={16} color={colors.text} />
      <Text style={styles.secondaryButtonText}>{item.label}</Text>
    </TouchableOpacity>
  );
}

export default function HomeTodayPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const [saved, setSaved] = useState(true);

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? '#E6FF3B';
  const accentText = colors?.accentText ?? (isDark ? colors.text : '#3F4F00');
  const silverLight = colors?.sapSilverLight ?? (isDark ? '#111217' : '#F3F4F6');
  const silverMed = colors?.sapSilverMedium ?? '#E1E3E8';

  const styles = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButtonGhost} activeOpacity={0.82}>
              <Feather name="chevron-left" size={18} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.headerCenter}>
              <Text style={styles.headerEyebrow}>TODAY</Text>
              <Text style={styles.headerTitle}>{WORKOUT.dateLabel}</Text>
            </View>

            <TouchableOpacity onPress={() => setSaved((v) => !v)} style={styles.iconButtonGhost} activeOpacity={0.82}>
              <Feather name={saved ? 'bookmark' : 'bookmark'} size={16} color={saved ? accentText : colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroBadge}>SESSION READY</Text>
                <Text style={styles.heroTitle}>{WORKOUT.title}</Text>
                <Text style={styles.heroSubtitle}>{WORKOUT.subtitle}</Text>
              </View>
              <Pill label={WORKOUT.phase} styles={styles} />
            </View>

            <View style={styles.metricGrid}>
              <SmallMetric label="Distance" value={`${WORKOUT.distanceKm} km`} styles={styles} />
              <SmallMetric label="Duration" value={WORKOUT.duration} styles={styles} />
              <SmallMetric label="Effort" value={WORKOUT.effort} styles={styles} />
            </View>

            <View style={styles.metaChipRow}>
              <MetaChip icon="clock" text={WORKOUT.startWindow} styles={styles} colors={colors} />
              <MetaChip icon="map-pin" text={WORKOUT.locationHint} styles={styles} colors={colors} />
              <MetaChip icon="shield" text={WORKOUT.confidence} styles={styles} colors={colors} />
            </View>

            <Text style={styles.heroWhy}>{WORKOUT.whyItMatters}</Text>

            <View style={styles.actionStack}>
              <ActionButton item={ACTIONS[0]} styles={styles} colors={colors} accentBg={accentBg} />
              <View style={styles.actionRowTwo}>
                {ACTIONS.slice(1).map((item) => (
                  <ActionButton key={item.key} item={item} styles={styles} colors={colors} accentBg={accentBg} />
                ))}
              </View>
            </View>
          </View>

          <View style={styles.twoUpRow}>
            <View style={styles.infoCard}>
              <SectionHeader title="Run weather" styles={styles} />
              <View style={styles.weatherTopRow}>
                <Text style={styles.weatherTemp}>{WORKOUT.weather.temp}</Text>
                <View style={styles.weatherIconBubble}>
                  <Feather name="cloud-drizzle" size={18} color={colors.text} />
                </View>
              </View>
              <Text style={styles.weatherSummary}>{WORKOUT.weather.summary}</Text>
              <Text style={styles.weatherFeels}>Feels like {WORKOUT.weather.feelsLike}</Text>

              <View style={styles.weatherMetaStack}>
                <MetaChip icon="wind" text={WORKOUT.weather.wind} styles={styles} colors={colors} />
                <MetaChip icon="droplet" text={`Rain ${WORKOUT.weather.rainChance}`} styles={styles} colors={colors} />
                <MetaChip icon="thermometer" text={`Humidity ${WORKOUT.weather.humidity}`} styles={styles} colors={colors} />
              </View>

              <Text style={styles.microCopy}>{WORKOUT.weather.note}</Text>
            </View>

            <View style={styles.infoCard}>
              <SectionHeader title="Readiness" styles={styles} />
              <Text style={styles.readinessHeadline}>{WORKOUT.confidence}</Text>
              <Text style={styles.readinessBody}>{WORKOUT.readinessReason}</Text>

              <View style={styles.readinessDivider} />

              <Text style={styles.subLabel}>Coach note</Text>
              <Text style={styles.readinessBody}>{WORKOUT.coachNote}</Text>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <SectionHeader title="Targets" action="Source" styles={styles} onPress={() => {}} />
            <View style={styles.metricGrid}>
              <SmallMetric label="Pace" value={WORKOUT.targets.paceLabel} styles={styles} />
              <SmallMetric label="Heart rate" value={WORKOUT.targets.hrLabel} styles={styles} />
              <SmallMetric label="Form cue" value={WORKOUT.targets.cadenceLabel} styles={styles} />
            </View>
            <View style={styles.sourceRow}>
              <View style={styles.sourcePill}>
                <Text style={styles.sourceText}>Pace · {WORKOUT.targets.source.pace}</Text>
              </View>
              <View style={styles.sourcePill}>
                <Text style={styles.sourceText}>HR · {WORKOUT.targets.source.hr}</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <SectionHeader title="Workout structure" styles={styles} />
            <View style={styles.stepStack}>
              {WORKOUT.structure.map((item) => (
                <StepCard key={item.key} item={item} styles={styles} colors={colors} accentBg={accentBg} isDark={isDark} />
              ))}
            </View>
          </View>

          <View style={styles.sectionCard}>
            <SectionHeader title="Fuel + prep" styles={styles} />
            <View style={styles.fuelGrid}>
              <View style={styles.fuelCard}>
                <Text style={styles.fuelLabel}>Before</Text>
                <Text style={styles.fuelValue}>{WORKOUT.fuel.pre}</Text>
              </View>
              <View style={styles.fuelCard}>
                <Text style={styles.fuelLabel}>During</Text>
                <Text style={styles.fuelValue}>{WORKOUT.fuel.during}</Text>
              </View>
              <View style={styles.fuelCardWide}>
                <Text style={styles.fuelLabel}>After</Text>
                <Text style={styles.fuelValue}>{WORKOUT.fuel.post}</Text>
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <SectionHeader title="Small details" styles={styles} />
            <View style={styles.checkStack}>
              {WORKOUT.checklist.map((item) => (
                <View key={item} style={styles.checkRow}>
                  <View style={styles.checkDot} />
                  <Text style={styles.checkText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.bottomSpacing} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? '#111217' : silverLight;
  const panelBg = isDark ? '#0E0F12' : '#FFFFFF';

  const shadow = isDark
    ? {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 6,
      }
    : {
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 3,
      };

  const softShadow = isDark
    ? {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }
    : {
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: { flex: 1, paddingHorizontal: 18 },
    scrollContent: { paddingBottom: 110, flexGrow: 1 },
    bottomSpacing: { height: 18 },

    header: { marginTop: 6, marginBottom: 14 },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerEyebrow: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    headerTitle: {
      fontSize: 14,
      fontWeight: '900',
      color: colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#00000040' : '#FFFFFFCC',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
    },

    heroCard: {
      backgroundColor: cardBg,
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      marginBottom: 16,
      ...shadow,
    },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 12,
    },
    heroBadge: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.subtext,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 4,
    },
    heroTitle: {
      fontSize: 22,
      lineHeight: 27,
      fontWeight: '900',
      color: colors.text,
      marginBottom: 4,
    },
    heroSubtitle: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: colors.subtext,
    },
    heroWhy: {
      marginTop: 12,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      color: colors.subtext,
    },

    pill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: accentBg,
      ...softShadow,
    },
    pillText: {
      fontSize: 10,
      fontWeight: '900',
      color: '#111111',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },

    metricGrid: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 2,
    },
    metricCard: {
      flex: 1,
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...softShadow,
    },
    metricValue: {
      fontSize: 17,
      fontWeight: '900',
      color: colors.text,
      marginBottom: 4,
    },
    metricLabel: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },

    metaChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    metaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
    },
    metaChipText: {
      fontSize: 12,
      color: colors.text,
      fontWeight: '700',
    },

    actionStack: { marginTop: 14 },
    actionRowTwo: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 10,
    },
    primaryButton: {
      backgroundColor: accentBg,
      borderRadius: 18,
      paddingVertical: 13,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      ...softShadow,
    },
    primaryButtonText: {
      color: '#111111',
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    secondaryButton: {
      minWidth: '31%',
      flexGrow: 1,
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      ...softShadow,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '800',
    },

    twoUpRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 16,
    },
    infoCard: {
      flex: 1,
      backgroundColor: cardBg,
      borderRadius: 22,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...shadow,
    },

    sectionCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      marginBottom: 16,
      ...shadow,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '900',
      color: colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },
    sectionAction: {
      fontSize: 12,
      fontWeight: '800',
      color: accentText,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },

    weatherTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    weatherTemp: {
      fontSize: 24,
      fontWeight: '900',
      color: colors.text,
    },
    weatherIconBubble: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: panelBg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
    },
    weatherSummary: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 2,
    },
    weatherFeels: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.subtext,
      marginBottom: 10,
    },
    weatherMetaStack: {
      gap: 8,
      marginBottom: 10,
    },
    microCopy: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      color: colors.subtext,
    },

    readinessHeadline: {
      fontSize: 18,
      fontWeight: '900',
      color: colors.text,
      marginBottom: 4,
    },
    readinessBody: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      color: colors.subtext,
    },
    readinessDivider: {
      height: 1,
      backgroundColor: isDark ? '#1F2128' : silverMed,
      marginVertical: 12,
    },
    subLabel: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.subtext,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
    },

    sourceRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    sourcePill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
    },
    sourceText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.text,
    },

    stepStack: { gap: 10 },
    stepCard: {
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...softShadow,
    },
    stepTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
    },
    stepIconWrap: {
      width: 34,
      height: 34,
      borderRadius: 14,
      backgroundColor: isDark ? '#18191E' : '#E6E7EC',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepTitle: {
      fontSize: 13,
      fontWeight: '900',
      color: colors.text,
      marginBottom: 2,
    },
    stepDuration: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.subtext,
    },
    stepDetail: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      color: colors.subtext,
    },

    fuelGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    fuelCard: {
      flex: 1,
      minWidth: '46%',
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...softShadow,
    },
    fuelCardWide: {
      width: '100%',
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...softShadow,
    },
    fuelLabel: {
      fontSize: 11,
      color: colors.subtext,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 6,
    },
    fuelValue: {
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
      color: colors.text,
    },

    checkStack: { gap: 10 },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    checkDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: accentBg,
      marginTop: 6,
    },
    checkText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
      color: colors.text,
    },
  });
}
