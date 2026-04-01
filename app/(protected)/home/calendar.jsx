import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../../providers/ThemeProvider';

const CALENDAR_WEEKS = [
  {
    key: 'week-11',
    label: '23 Feb - 1 Mar',
    weekLabel: 'WEEK 11',
    totalDoneKm: 31.6,
    totalPlannedKm: 54.0,
    showReset: true,
    days: [
      {
        dayKey: 'mon',
        dayLabel: 'MON',
        date: 23,
        muted: true,
        sessions: [],
      },
      {
        dayKey: 'tue',
        dayLabel: 'TUE',
        date: 24,
        accentDay: true,
        sessions: [
          {
            id: 'tue-strength',
            title: 'Full Body Endurance Set',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'tue-run',
            title: 'Extended Kms',
            meta: '11 km',
            kind: 'steady',
            planned: true,
            badge: 'crown',
          },
        ],
      },
      {
        dayKey: 'wed',
        dayLabel: 'WED',
        date: 25,
        sessions: [
          {
            id: 'wed-strength',
            title: 'Legs & Core Supersets',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'wed-done',
            title: 'Liverpool Running',
            meta: '11.5 km · 1h 0m 1s',
            kind: 'completed',
            planned: false,
            badge: 'check',
          },
        ],
      },
      {
        dayKey: 'thu',
        dayLabel: 'THU',
        date: 26,
        accentDay: true,
        sessions: [
          {
            id: 'thu-strength',
            title: 'Upper Body Endurance',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'thu-quality',
            title: 'Over and Unders 1km',
            meta: '12 km',
            kind: 'quality',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'thu-user',
            title: 'Treadmill session',
            meta: '10.1 km · user logged',
            kind: 'external',
            planned: false,
            badge: 'plus',
          },
        ],
      },
      {
        dayKey: 'fri',
        dayLabel: 'FRI',
        date: 27,
        accentDay: true,
        sessions: [
          {
            id: 'fri-plan',
            title: '12km Easy Run',
            meta: '12 km',
            kind: 'easy',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'fri-done',
            title: 'Liverpool Running',
            meta: '10.1 km · 58m 1s',
            kind: 'completed',
            planned: false,
            badge: 'check',
          },
        ],
      },
      {
        dayKey: 'sat',
        dayLabel: 'SAT',
        date: 28,
        accentDay: true,
        sessions: [
          {
            id: 'sat-strength',
            title: 'Lower Body Endurance',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
        ],
      },
      {
        dayKey: 'sun',
        dayLabel: 'SUN',
        date: 1,
        bubbleDate: true,
        sessions: [
          {
            id: 'sun-long',
            title: '19km Long Run',
            meta: '19 km',
            kind: 'long',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'sun-add',
            title: 'Add',
            meta: 'Strength / mobility / cross-train',
            kind: 'add',
            planned: false,
            badge: 'plus',
          },
        ],
      },
    ],
  },
  {
    key: 'week-12',
    label: '2 Mar - 8 Mar',
    weekLabel: 'WEEK 12',
    totalDoneKm: 39.1,
    totalPlannedKm: null,
    showReset: true,
    days: [
      {
        dayKey: 'mon',
        dayLabel: 'MON',
        date: 2,
        sessions: [
          {
            id: 'mon-add',
            title: 'Add',
            meta: 'Strength / walk / note',
            kind: 'add',
            planned: false,
            badge: 'plus',
          },
        ],
      },
      {
        dayKey: 'tue',
        dayLabel: 'TUE',
        date: 3,
        sessions: [
          {
            id: 'w12-tue-strength',
            title: 'Legs & Core Endurance',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'w12-tue-run',
            title: '10km Easy Run',
            meta: '10 km',
            kind: 'easy',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'w12-tue-add',
            title: 'Add',
            meta: 'Optional double / walk',
            kind: 'add',
            planned: false,
            badge: 'plus',
          },
        ],
      },
      {
        dayKey: 'wed',
        dayLabel: 'WED',
        date: 4,
        sessions: [
          {
            id: 'w12-wed-strength',
            title: 'Endurance Supersets',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'w12-wed-add',
            title: 'Add',
            meta: 'Mobility / short shakeout',
            kind: 'add',
            planned: false,
            badge: 'plus',
          },
        ],
      },
      {
        dayKey: 'thu',
        dayLabel: 'THU',
        date: 5,
        sessions: [
          {
            id: 'w12-thu-strength',
            title: 'Upper Endurance Work',
            meta: '40m - 50m',
            kind: 'strength',
            planned: true,
            badge: 'crown',
          },
          {
            id: 'w12-thu-quality',
            title: '5 Mile Time Trial',
            meta: 'Key quality day',
            kind: 'quality-hard',
            planned: true,
            badge: 'crown',
          },
        ],
      },
    ],
  },
];

function sessionTone(kind, colors, isDark) {
  switch (kind) {
    case 'strength':
      return {
        stripe: '#3B82F6',
        bg: isDark ? '#273142' : '#EAF2FF',
        border: isDark ? '#33465F' : '#C8DAFF',
      };
    case 'easy':
      return {
        stripe: '#65D33D',
        bg: isDark ? '#1F2B21' : '#ECFBEA',
        border: isDark ? '#2F4333' : '#CDEFC4',
      };
    case 'steady':
      return {
        stripe: '#F97316',
        bg: isDark ? '#33261D' : '#FFF1E7',
        border: isDark ? '#4A3527' : '#FFD5BA',
      };
    case 'quality':
      return {
        stripe: '#FACC15',
        bg: isDark ? '#332F1A' : '#FFF8D8',
        border: isDark ? '#4B4321' : '#F5E7A0',
      };
    case 'quality-hard':
      return {
        stripe: '#FB7185',
        bg: isDark ? '#362129' : '#FFE8ED',
        border: isDark ? '#55303B' : '#FFC7D2',
      };
    case 'long':
      return {
        stripe: '#A855F7',
        bg: isDark ? '#302144' : '#F5EAFF',
        border: isDark ? '#493163' : '#DEC4FF',
      };
    case 'completed':
      return {
        stripe: '#A3A3A3',
        bg: isDark ? '#1A1E24' : '#F4F5F7',
        border: isDark ? '#5D6B7C' : '#B7C2D0',
      };
    case 'external':
      return {
        stripe: '#94A3B8',
        bg: isDark ? '#1A1E24' : '#F8FAFC',
        border: isDark ? '#334155' : '#CBD5E1',
      };
    case 'add':
      return {
        stripe: 'transparent',
        bg: 'transparent',
        border: 'transparent',
      };
    default:
      return {
        stripe: '#64748B',
        bg: isDark ? '#1E2430' : '#F3F6FA',
        border: isDark ? '#2B3442' : '#D8E0E8',
      };
  }
}

function WeekHeader({ week, styles, colors }) {
  return (
    <View style={styles.weekHeaderRow}>
      <View style={{ flex: 1 }}>
        <View style={styles.weekTitleRow}>
          <Text style={styles.weekTitle}>{week.label}</Text>
          <View style={styles.weekBadge}>
            <Text style={styles.weekBadgeText}>{week.weekLabel}</Text>
          </View>
        </View>
        <Text style={styles.weekTotalText}>
          Total:{' '}
          <Text style={styles.weekTotalStrong}>
            {week.totalPlannedKm
              ? `${week.totalDoneKm.toFixed(1)} km / ${week.totalPlannedKm.toFixed(1)} km`
              : `${week.totalDoneKm.toFixed(1)} km`}
          </Text>
        </Text>
      </View>

      {week.showReset ? (
        <TouchableOpacity style={styles.resetButton} activeOpacity={0.84}>
          <Feather name="rotate-ccw" size={15} color={colors.subtext} />
          <Text style={styles.resetButtonText}>Reset</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SessionCard({ session, styles, colors, isDark }) {
  if (session.kind === 'add') {
    return (
      <TouchableOpacity style={styles.addCard} activeOpacity={0.8}>
        <Feather name="plus" size={18} color={colors.subtext} />
        <View style={{ flex: 1 }}>
          <Text style={styles.addCardTitle}>{session.title}</Text>
          <Text style={styles.addCardMeta}>{session.meta}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const tone = sessionTone(session.kind, colors, isDark);
  const done = session.kind === 'completed';

  return (
    <TouchableOpacity
      style={[
        styles.sessionCard,
        {
          backgroundColor: tone.bg,
          borderColor: tone.border,
        },
        done && styles.sessionCardDone,
      ]}
      activeOpacity={0.84}
    >
      <View style={[styles.sessionStripe, { backgroundColor: tone.stripe }]} />

      <View style={styles.sessionBody}>
        <View style={styles.sessionTopRow}>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {session.title}
          </Text>

          <View style={[styles.badgeIconWrap, done && styles.badgeIconWrapDone]}>
            <Feather
              name={session.badge === 'check' ? 'check' : session.badge === 'plus' ? 'plus' : 'award'}
              size={13}
              color={done ? '#E5E7EB' : '#34D399'}
            />
          </View>
        </View>

        <Text style={styles.sessionMeta} numberOfLines={1}>
          {session.meta}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function CalendarDayRow({ day, styles, colors, isDark }) {
  return (
    <View style={styles.dayRow}>
      <View style={styles.dayRail}>
        <Text style={[styles.dayLabel, day.accentDay && styles.dayLabelAccent, day.muted && styles.dayLabelMuted]}>
          {day.dayLabel}
        </Text>

        {day.bubbleDate ? (
          <View style={styles.dateBubble}>
            <Text style={styles.dateBubbleText}>{day.date}</Text>
          </View>
        ) : (
          <Text style={[styles.dayDate, day.accentDay && styles.dayDateAccent, day.muted && styles.dayDateMuted]}>
            {day.date}
          </Text>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sessionRow}
      >
        {day.sessions.length ? (
          day.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              styles={styles}
              colors={colors}
              isDark={isDark}
            />
          ))
        ) : (
          <View style={styles.emptyDayCell} />
        )}
      </ScrollView>
    </View>
  );
}

export default function TrainingCalendarPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

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
          <TouchableOpacity onPress={() => router.back()} style={styles.iconButtonGhost} activeOpacity={0.82}>
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Training calendar</Text>
          </View>

          <TouchableOpacity style={styles.headerSaveButton} activeOpacity={0.82}>
            <Text style={styles.headerSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {CALENDAR_WEEKS.map((week) => (
            <View key={week.key} style={styles.weekCard}>
              <WeekHeader week={week} styles={styles} colors={colors} />

              <View style={styles.weekDaysWrap}>
                {week.days.map((day) => (
                  <CalendarDayRow
                    key={`${week.key}-${day.dayKey}`}
                    day={day}
                    styles={styles}
                    colors={colors}
                    isDark={isDark}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? '#111217' : '#151A20';
  const pageBg = isDark ? '#0B0D11' : '#0B0D11';
  const panelBg = isDark ? '#1A2028' : '#1A2028';
  const textPrimary = '#F2F4F7';
  const textMuted = '#A6B0BF';
  const divider = '#334155';

  const shadow = {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: pageBg },
    page: { flex: 1, backgroundColor: pageBg },
    scrollContent: { paddingBottom: 120 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 14,
      fontWeight: '900',
      color: textPrimary,
      letterSpacing: 0.3,
    },
    iconButtonGhost: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    headerSaveButton: {
      minWidth: 42,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    headerSaveText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#3E4753',
    },

    weekCard: {
      marginTop: 14,
      marginHorizontal: 12,
      borderRadius: 0,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#DCE2EA',
      backgroundColor: cardBg,
      ...shadow,
    },
    weekHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },
    weekTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
      flexWrap: 'wrap',
    },
    weekTitle: {
      fontSize: 15,
      fontWeight: '900',
      color: textPrimary,
    },
    weekBadge: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: '#E5E7EB',
    },
    weekBadgeText: {
      fontSize: 11,
      fontWeight: '900',
      color: '#20252B',
      letterSpacing: 0.4,
    },
    weekTotalText: {
      fontSize: 13,
      fontWeight: '600',
      color: textMuted,
    },
    weekTotalStrong: {
      color: textPrimary,
      fontWeight: '900',
    },
    resetButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: '#3B5B88',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: '#1A2430',
    },
    resetButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color: textMuted,
    },

    weekDaysWrap: {
      backgroundColor: cardBg,
    },
    dayRow: {
      minHeight: 92,
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: divider,
    },
    dayRail: {
      width: 82,
      paddingTop: 18,
      paddingHorizontal: 12,
      alignItems: 'center',
      gap: 8,
    },
    dayLabel: {
      fontSize: 11,
      fontWeight: '900',
      color: '#8E99AB',
      letterSpacing: 0.6,
    },
    dayLabelAccent: {
      color: '#FF4D4F',
    },
    dayLabelMuted: {
      color: '#6F7A8B',
    },
    dayDate: {
      fontSize: 19,
      fontWeight: '800',
      color: '#AEB7C5',
    },
    dayDateAccent: {
      color: '#FF4D4F',
    },
    dayDateMuted: {
      color: '#7E8898',
    },
    dateBubble: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: '#E5E7EB',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateBubbleText: {
      fontSize: 18,
      fontWeight: '900',
      color: '#1F2937',
    },

    sessionRow: {
      paddingVertical: 14,
      paddingRight: 14,
      gap: 12,
      alignItems: 'center',
    },
    emptyDayCell: {
      width: 220,
      height: 1,
    },
    sessionCard: {
      width: 304,
      minHeight: 72,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      overflow: 'hidden',
      backgroundColor: panelBg,
    },
    sessionCardDone: {
      borderWidth: 1.2,
    },
    sessionStripe: {
      width: 6,
      height: '100%',
    },
    sessionBody: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 12,
      justifyContent: 'center',
    },
    sessionTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 6,
    },
    sessionTitle: {
      flex: 1,
      fontSize: 13,
      fontWeight: '900',
      color: textPrimary,
      lineHeight: 17,
    },
    sessionMeta: {
      fontSize: 11,
      fontWeight: '600',
      color: textMuted,
      lineHeight: 15,
    },
    badgeIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: '#1C232E',
      borderWidth: 1,
      borderColor: '#12161C',
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeIconWrapDone: {
      backgroundColor: '#E5E7EB',
      borderColor: '#D1D5DB',
    },

    addCard: {
      width: 264,
      minHeight: 72,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: 'transparent',
    },
    addCardTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: '#B4BCC8',
      marginBottom: 2,
    },
    addCardMeta: {
      fontSize: 11,
      fontWeight: '600',
      color: '#7E8898',
    },
  });
}
