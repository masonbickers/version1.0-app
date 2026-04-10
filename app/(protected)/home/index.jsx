import Feather from '../../components/LucideFeather';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import HomeHeroImage from '../../../assets/images/home/img_home_hero_today.jpg';
import { auth, db } from '../../../firebaseConfig';
import { useTheme } from '../../../providers/ThemeProvider';

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const JS_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WEEK_STRIP_FALLBACK = [
  { day: 'Mon', date: '12', state: 'done', icon: 'check', meta: '6.2 km' },
  { day: 'Tue', date: '13', state: 'quality', icon: 'zap', meta: 'Intervals' },
  { day: 'Wed', date: '14', state: 'rest', icon: 'moon', meta: 'Rest' },
  { day: 'Thu', date: '15', state: 'easy', icon: 'activity', meta: 'Easy 8k' },
  { day: 'Fri', date: '16', state: 'strength', icon: 'heart', meta: 'Gym' },
  { day: 'Sat', date: '17', state: 'today', icon: 'play', meta: 'Long run' },
  { day: 'Sun', date: '18', state: 'upcoming', icon: 'clock', meta: 'Recovery' },
];

const TOP_METRICS_FALLBACK = [
  { label: 'Week total', value: '24.2 km' },
  { label: 'Sessions', value: '3 / 4' },
  { label: 'Weight', value: '72.4 kg' },
];

const QUICK_LINKS = [
  {
    key: 'today',
    label: "Today's run",
    subtitle: 'Workout, pace, prep',
    path: '/home/today',
    icon: 'play-circle',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    subtitle: 'Plan + completed sessions',
    path: '/home/calendar',
    icon: 'calendar',
  },
  {
    key: 'coach',
    label: 'Coach',
    subtitle: 'Ask about training',
    path: '/chat',
    icon: 'message-circle',
  },
  {
    key: 'fuel',
    label: 'Fuel',
    subtitle: 'Run-day nutrition',
    path: '/nutrition/fuelmatch',
    icon: 'droplet',
  },
];

const TODAY_DETAILS_FALLBACK = {
  phase: 'BUILD',
  title: 'Long run · 14 km',
  description:
    'Easy effort throughout. Keep the first half relaxed, fuel before you go, and keep the second half controlled rather than pushing pace.',
  meta: [
    { icon: 'clock', label: '75–90 min' },
    { icon: 'activity', label: 'Easy / Z2' },
    { icon: 'map-pin', label: 'Park loop' },
  ],
};

const WEATHER = {
  temp: '14°',
  summary: 'Light rain · Feels like 12°',
  wind: '11 km/h',
  humidity: '74%',
  note: 'Light shell advised. Roads may be slick for the first 20 minutes.',
};

const PREP_POINTS = [
  'Eat a light carb snack 45–60 min before the run.',
  'Take fluids if you’re running beyond 75 min.',
  'Keep the first 10 min very easy before settling in.',
];

const COACH_NOTE_FALLBACK =
  'Yesterday’s strength session plus today’s long run means the goal is consistency, not pace. If legs feel flat after 20 minutes, keep effort easy and finish strong only if it comes naturally.';

const TODAY_CHECKLIST = [
  'Check today’s weather before you leave',
  'Review route, pace and effort target',
  'Fuel before the run if needed',
  'Open workout or calendar in one tap',
];

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
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayOfMonth(iso) {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '--';
  return String(parsed.getDate()).padStart(2, '0');
}

function toNumOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseDayLabel(day, fallback = 'Mon') {
  const value = String(day || '').trim();
  if (DAY_ORDER.includes(value)) return value;
  const map = {
    monday: 'Mon',
    mon: 'Mon',
    tuesday: 'Tue',
    tue: 'Tue',
    wednesday: 'Wed',
    wed: 'Wed',
    thursday: 'Thu',
    thu: 'Thu',
    friday: 'Fri',
    fri: 'Fri',
    saturday: 'Sat',
    sat: 'Sat',
    sunday: 'Sun',
    sun: 'Sun',
  };
  return map[value.toLowerCase()] || fallback;
}

function parseSessionDateIso(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : toISODateLocal(parsed);
  }
  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate();
    return Number.isNaN(parsed?.getTime?.()) ? null : toISODateLocal(parsed);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toISODateLocal(value);
  }
  return null;
}

function withHexAlpha(color, alpha) {
  const raw = String(color || '').trim();
  const a = String(alpha || '').trim();
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

function extractWeeksFromPlanDoc(data) {
  const rawPlan = data?.plan || {};
  if (Array.isArray(rawPlan?.weeks)) return rawPlan.weeks;
  if (Array.isArray(data?.weeks)) return data.weeks;
  return [];
}

function normaliseSession(raw, fallbackDay) {
  const session = raw && typeof raw === 'object' ? raw : {};
  const day = normaliseDayLabel(session.day || session.dow, fallbackDay);
  return {
    ...session,
    day,
    title:
      session.title ||
      session.name ||
      session.sessionName ||
      session.sessionType ||
      session.type ||
      'Session',
  };
}

function normaliseWeekDays(week) {
  const daysRaw = Array.isArray(week?.days) ? week.days : [];
  const byDay = new Map();

  daysRaw.forEach((dayObj) => {
    const dayLabel = normaliseDayLabel(dayObj?.day);
    const sessions = (Array.isArray(dayObj?.sessions) ? dayObj.sessions : [])
      .map((s) => normaliseSession(s, dayLabel))
      .filter(Boolean);
    byDay.set(dayLabel, sessions);
  });

  const standaloneSessions = Array.isArray(week?.sessions) ? week.sessions : [];
  standaloneSessions.forEach((raw) => {
    const session = normaliseSession(raw, 'Mon');
    const dayLabel = session.day || 'Mon';
    if (!byDay.has(dayLabel)) byDay.set(dayLabel, []);
    byDay.get(dayLabel).push(session);
  });

  return DAY_ORDER.map((day) => ({ day, sessions: byDay.get(day) || [] }));
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
  const text = `${session?.title || ''} ${session?.sessionType || ''} ${session?.type || ''}`.toLowerCase();
  return /(tempo|interval|threshold|speed|hill|fartlek|quality)/.test(text);
}

function isStrengthSession(session) {
  const text = `${session?.title || ''} ${session?.sessionType || ''} ${session?.type || ''}`.toLowerCase();
  return /(strength|gym|hyrox|bodyweight)/.test(text);
}

function sessionPrimaryText(session) {
  const distance = sessionDistanceKm(session);
  if (distance != null && distance > 0) return `${distance.toFixed(1)} km`;
  const duration = sessionDurationMin(session);
  if (duration != null && duration > 0) return `${Math.round(duration)} min`;
  return session?.title || 'Session';
}

function sessionIntensityLabel(session) {
  if (isQualitySession(session)) return 'Quality / controlled hard';
  if (isStrengthSession(session)) return 'Strength focus';
  return 'Easy / aerobic';
}

function deriveDayState({ sessions, isToday, hasCompleted }) {
  if (isToday) return 'today';
  if (hasCompleted) return 'done';
  if (!sessions.length) return 'rest';
  const first = sessions[0];
  if (isStrengthSession(first)) return 'strength';
  if (isQualitySession(first)) return 'quality';
  return 'easy';
}

function iconForState(state) {
  switch (state) {
    case 'today':
      return 'play';
    case 'done':
      return 'check';
    case 'quality':
      return 'zap';
    case 'strength':
      return 'heart';
    case 'rest':
      return 'moon';
    default:
      return 'activity';
  }
}

function buildWeekStrip({ weekDays, weekDates, completedByDate, loggedByDate, todayIso }) {
  return DAY_ORDER.map((day, idx) => {
    const isoDate = weekDates[idx];
    const firstPlanSession = weekDays[idx]?.sessions?.[0] || null;
    const firstLoggedSession = loggedByDate.get(isoDate) || null;
    const mergedSession =
      firstPlanSession ||
      (firstLoggedSession
        ? {
            title: firstLoggedSession?.title || firstLoggedSession?.sessionName || 'Logged session',
            sessionType: firstLoggedSession?.sessionType || 'run',
            targetDistanceKm:
              toNumOrNull(firstLoggedSession?.actualDistanceKm) ??
              toNumOrNull(firstLoggedSession?.targetDistanceKm),
            targetDurationMin:
              toNumOrNull(firstLoggedSession?.actualDurationMin) ??
              toNumOrNull(firstLoggedSession?.targetDurationMin),
          }
        : null);

    const sessions = mergedSession ? [mergedSession] : [];
    const state = deriveDayState({
      sessions,
      isToday: isoDate === todayIso,
      hasCompleted: completedByDate.has(isoDate),
    });

    return {
      day,
      date: formatDayOfMonth(isoDate),
      state,
      icon: iconForState(state),
      meta: mergedSession ? sessionPrimaryText(mergedSession) : completedByDate.has(isoDate) ? 'Completed' : 'Rest',
    };
  });
}

function buildTodayDetails(todaySession, weekLabel) {
  if (!todaySession) {
    return {
      phase: (weekLabel || 'Today').toUpperCase(),
      title: 'Rest / recovery day',
      description:
        'No structured session is planned for today. Use this day for mobility, a short walk, or full recovery.',
      meta: [
        { icon: 'moon', label: 'Recovery focus' },
        { icon: 'activity', label: 'Optional mobility' },
        { icon: 'calendar', label: 'Check tomorrow' },
      ],
    };
  }

  const distance = sessionDistanceKm(todaySession);
  const duration = sessionDurationMin(todaySession);
  const intensity = sessionIntensityLabel(todaySession);
  const title = todaySession?.title || 'Session';
  const withDistance = distance != null && distance > 0 ? `${title} · ${distance.toFixed(1)} km` : title;
  const notes = String(todaySession?.notes || '').trim();

  const meta = [];
  if (duration != null && duration > 0) meta.push({ icon: 'clock', label: `${Math.round(duration)} min` });
  if (distance != null && distance > 0) meta.push({ icon: 'activity', label: `${distance.toFixed(1)} km` });
  meta.push({ icon: 'target', label: intensity });

  return {
    phase: (weekLabel || 'Today').toUpperCase(),
    title: withDistance,
    description:
      notes ||
      'Execute this session at the prescribed effort. Keep the first part controlled and finish with good form.',
    meta: meta.slice(0, 3),
  };
}

function buildCoachNote(todaySession, completedToday) {
  if (completedToday) {
    return 'Today is already logged. Prioritise recovery quality tonight so tomorrow starts fresh.';
  }
  if (!todaySession) {
    return 'Use this lower-load day to protect consistency across the rest of the week.';
  }
  if (isQualitySession(todaySession)) {
    return 'Treat quality as controlled work, not maximal effort. Hit targets with repeatable form.';
  }
  if (isStrengthSession(todaySession)) {
    return 'Keep movement quality high and leave 1-2 reps in reserve on compound work.';
  }
  return 'Stay disciplined on easy effort. The goal is aerobic quality and consistent progression.';
}

function stateStyle(state, accentBg, colors, isDark) {
  switch (state) {
    case 'today':
      return {
        bg: accentBg,
        text: '#111111',
        border: accentBg,
        icon: '#111111',
      };
    case 'done':
      return {
        bg: isDark ? '#16211C' : '#EEF9F2',
        text: isDark ? '#7BE3A3' : '#237A46',
        border: isDark ? '#244A33' : '#BEE2C9',
        icon: isDark ? '#7BE3A3' : '#237A46',
      };
    case 'quality':
      return {
        bg: isDark ? '#1B1822' : '#FFF6D6',
        text: isDark ? '#F7D96E' : '#8B6B00',
        border: isDark ? '#42361A' : '#E7D487',
        icon: isDark ? '#F7D96E' : '#8B6B00',
      };
    case 'rest':
      return {
        bg: isDark ? '#141820' : '#F5F7FA',
        text: colors.subtext,
        border: isDark ? '#232733' : '#D7DBE3',
        icon: colors.subtext,
      };
    default:
      return {
        bg: isDark ? '#171A22' : '#FFFFFF',
        text: colors.text,
        border: isDark ? '#232733' : '#D7DBE3',
        icon: colors.subtext,
      };
  }
}

function WeekDayCard({ item, styles, colors, accentBg, isDark, onPress }) {
  const tone = stateStyle(item.state, accentBg, colors, isDark);

  return (
    <TouchableOpacity
      style={[
        styles.weekDayCard,
        { backgroundColor: tone.bg, borderColor: tone.border },
      ]}
      activeOpacity={0.82}
      onPress={onPress}
    >
      <Text style={[styles.weekDayLabel, { color: tone.text }]}>{item.day}</Text>
      <Text style={[styles.weekDayDate, { color: tone.text }]}>{item.date}</Text>

      <View style={styles.weekIconWrap}>
        <Feather name={item.icon} size={15} color={tone.icon} />
      </View>

      <Text style={[styles.weekDayMeta, { color: tone.text }]} numberOfLines={1}>
        {item.meta}
      </Text>
    </TouchableOpacity>
  );
}

function QuickLinkCard({ item, onPress, styles, accentBg }) {
  return (
    <TouchableOpacity style={styles.quickCard} activeOpacity={0.86} onPress={onPress}>
      <View style={[styles.quickIconWrap, { backgroundColor: accentBg }]}>
        <Feather name={item.icon} size={18} color="#111111" />
      </View>

      <Text style={styles.quickTitle}>{item.label}</Text>
      <Text style={styles.quickSubtitle}>{item.subtitle}</Text>

      <View style={styles.quickFooter}>
        <Text style={styles.quickFooterText}>Open</Text>
        <Feather name="chevron-right" size={16} color="#8C97A8" />
      </View>
    </TouchableOpacity>
  );
}

export default function HomeIndexPage() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? '#E6FF3B';
  const accentText = colors?.accentText ?? (isDark ? colors.text : '#3F4F00');
  const silverLight =
    colors?.sapSilverLight ?? (isDark ? '#111217' : '#F3F4F6');
  const silverMed = colors?.sapSilverMedium ?? '#E1E3E8';

  const styles = useMemo(
    () => makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed),
    [colors, isDark, accentBg, accentText, silverLight, silverMed]
  );
  const topFadeStart = useMemo(() => {
    const alpha = isDark ? '33' : '55';
    const resolved = withHexAlpha(accentBg, alpha);
    if (resolved !== accentBg) return resolved;
    return isDark ? 'rgba(230,255,59,0.2)' : 'rgba(230,255,59,0.3)';
  }, [accentBg, isDark]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hasPlan, setHasPlan] = useState(false);
  const [topMetrics, setTopMetrics] = useState(TOP_METRICS_FALLBACK);
  const [weekStrip, setWeekStrip] = useState(WEEK_STRIP_FALLBACK);
  const [todayDetails, setTodayDetails] = useState(TODAY_DETAILS_FALLBACK);
  const [coachNote, setCoachNote] = useState(COACH_NOTE_FALLBACK);
  const [weekLabel, setWeekLabel] = useState('This week');
  const hasLoadedRef = useRef(false);

  const handleNavigate = useCallback((path) => router.push(path), [router]);

  const loadHomeData = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLoadError('Sign in to load your live home dashboard.');
      setHasPlan(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const partialErrors = [];
      const weekStart = startOfISOWeek(new Date());
      const weekDates = Array.from({ length: 7 }, (_, idx) => toISODateLocal(addDays(weekStart, idx)));
      const weekDateSet = new Set(weekDates);
      const todayIso = toISODateLocal(new Date());
      const todayLabel = JS_DAY_LABELS[new Date().getDay()];
      const todayIdx = Math.max(0, DAY_ORDER.indexOf(todayLabel));

      let planData = null;
      let resolvedWeekLabel = 'This week';
      let resolvedWeekDays = DAY_ORDER.map((day) => ({ day, sessions: [] }));
      let resolvedHasPlan = false;
      let weightKg = null;
      let weekSessionsCompleted = 0;
      let weekCompletedDistanceKm = 0;

      const completedByDate = new Set();
      const loggedByDate = new Map();

      try {
        const plansRef = collection(db, 'users', uid, 'plans');
        const latestPlanSnap = await getDocs(query(plansRef, orderBy('updatedAt', 'desc'), limit(1)));
        if (!latestPlanSnap.empty) {
          planData = latestPlanSnap.docs[0].data() || {};
        }
      } catch {
        partialErrors.push('plan');
      }

      if (planData) {
        const weeks = extractWeeksFromPlanDoc(planData);
        const activeWeek = weeks[0] || null;
        if (activeWeek) {
          resolvedWeekDays = normaliseWeekDays(activeWeek);
          const fallbackWeekNumber =
            Number.isFinite(Number(activeWeek?.weekNumber)) ? Number(activeWeek.weekNumber) : 1;
          resolvedWeekLabel = activeWeek?.title || `Week ${fallbackWeekNumber}`;
        }
        resolvedHasPlan = weeks.length > 0;
      }

      try {
        const weightsRef = collection(db, 'users', uid, 'weights');
        let latestWeightSnap = await getDocs(query(weightsRef, orderBy('date', 'desc'), limit(1)));
        if (latestWeightSnap.empty) {
          latestWeightSnap = await getDocs(query(weightsRef, orderBy('createdAt', 'desc'), limit(1)));
        }
        if (!latestWeightSnap.empty) {
          const d = latestWeightSnap.docs[0].data() || {};
          weightKg = toNumOrNull(d.weight) ?? toNumOrNull(d.value) ?? toNumOrNull(d.weightKg);
        }
      } catch {
        partialErrors.push('weight');
      }

      if (weightKg == null) {
        try {
          const nutritionProfileSnap = await getDoc(doc(db, 'users', uid, 'nutrition', 'profile'));
          if (nutritionProfileSnap.exists()) {
            const profile = nutritionProfileSnap.data() || {};
            weightKg = toNumOrNull(profile.weightKg);
          }
        } catch {}
      }

      try {
        const sessionsRef = collection(db, 'users', uid, 'trainSessions');
        let sessionsSnap = await getDocs(query(sessionsRef, orderBy('createdAt', 'desc'), limit(200)));
        if (sessionsSnap.empty) {
          sessionsSnap = await getDocs(query(sessionsRef, orderBy('completedAt', 'desc'), limit(200)));
        }

        const sessions = sessionsSnap.docs.map((d) => d.data() || {});

        sessions.forEach((session) => {
          const isoDate =
            parseSessionDateIso(session?.date) ||
            parseSessionDateIso(session?.completedAt) ||
            parseSessionDateIso(session?.createdAt);
          if (!isoDate) return;

          if (!loggedByDate.has(isoDate)) {
            loggedByDate.set(isoDate, session);
          }

          if (!weekDateSet.has(isoDate)) return;

          const status = String(session?.status || '').toLowerCase();
          if (status === 'skipped') return;

          weekSessionsCompleted += 1;
          completedByDate.add(isoDate);
          weekCompletedDistanceKm +=
            toNumOrNull(session?.actualDistanceKm) ??
            toNumOrNull(session?.targetDistanceKm) ??
            toNumOrNull(session?.distanceKm) ??
            0;
        });
      } catch {
        partialErrors.push('sessions');
      }

      const plannedSessions = resolvedWeekDays.reduce(
        (sum, day) => sum + (Array.isArray(day?.sessions) ? day.sessions.length : 0),
        0
      );
      const plannedKm = resolvedWeekDays.reduce(
        (sum, day) =>
          sum +
          (Array.isArray(day?.sessions)
            ? day.sessions.reduce((inner, session) => inner + (sessionDistanceKm(session) || 0), 0)
            : 0),
        0
      );

      const newWeekStrip = buildWeekStrip({
        weekDays: resolvedWeekDays,
        weekDates,
        completedByDate,
        loggedByDate,
        todayIso,
      });

      const todayIsoDate = weekDates[todayIdx];
      const todayFromPlan = resolvedWeekDays[todayIdx]?.sessions?.[0] || null;
      const todayFromLoggedRaw = loggedByDate.get(todayIsoDate) || null;
      const todayFromLogged = todayFromLoggedRaw
        ? {
            title: todayFromLoggedRaw?.title || todayFromLoggedRaw?.sessionName || 'Logged session',
            notes: todayFromLoggedRaw?.notes || '',
            sessionType: todayFromLoggedRaw?.sessionType || 'run',
            targetDistanceKm:
              toNumOrNull(todayFromLoggedRaw?.actualDistanceKm) ??
              toNumOrNull(todayFromLoggedRaw?.targetDistanceKm),
            targetDurationMin:
              toNumOrNull(todayFromLoggedRaw?.actualDurationMin) ??
              toNumOrNull(todayFromLoggedRaw?.targetDurationMin),
          }
        : null;
      const todaySession = todayFromPlan || todayFromLogged;
      const todayCompleted = completedByDate.has(todayIsoDate);
      const todayDetailsNext = buildTodayDetails(todaySession, resolvedWeekLabel);
      const coachNoteNext = buildCoachNote(todaySession, todayCompleted);

      const sessionsValue =
        plannedSessions > 0
          ? `${Math.min(weekSessionsCompleted, plannedSessions)} / ${plannedSessions}`
          : `${weekSessionsCompleted} logged`;
      const effectiveWeekKm = plannedKm > 0 ? plannedKm : weekCompletedDistanceKm;
      const weekTotalValue = effectiveWeekKm > 0 ? `${effectiveWeekKm.toFixed(1)} km` : '—';
      const weightValue = weightKg != null ? `${weightKg.toFixed(1)} kg` : '—';

      setHasPlan(resolvedHasPlan);
      setWeekLabel(resolvedWeekLabel);
      setWeekStrip(newWeekStrip);
      setTodayDetails(todayDetailsNext);
      setCoachNote(coachNoteNext);
      setTopMetrics([
        { label: 'Week total', value: weekTotalValue },
        { label: 'Sessions', value: sessionsValue },
        { label: 'Weight', value: weightValue },
      ]);
      setLoadError(
        partialErrors.length
          ? 'Some live data could not be loaded. Showing the data that is available.'
          : ''
      );
    } catch {
      setLoadError('Could not load live home data right now. Showing last known values.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedRef.current) {
        hasLoadedRef.current = true;
        loadHomeData({ silent: false });
      } else {
        loadHomeData({ silent: true });
      }
    }, [loadHomeData])
  );

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <LinearGradient
        colors={[topFadeStart, colors.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.topBackgroundFade}
        pointerEvents="none"
      />
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerTitle}>Home</Text>
            <TouchableOpacity
              style={styles.refreshBtn}
              activeOpacity={0.84}
              onPress={() => loadHomeData({ silent: true })}
              disabled={loading || refreshing}
            >
              {loading || refreshing ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Feather name="refresh-cw" size={16} color={colors.text} />
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.headerSubtitle}>
            {hasPlan ? 'Your training at a glance' : 'No active plan yet. Build one from Train to personalise this dashboard.'}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {!!loadError && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{loadError}</Text>
              <TouchableOpacity
                style={styles.errorRetryBtn}
                onPress={() => loadHomeData({ silent: false })}
                activeOpacity={0.84}
              >
                <Text style={styles.errorRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.heroCard}>
            <ImageBackground
              source={HomeHeroImage}
              style={styles.heroCardImage}
              imageStyle={styles.heroCardImageInner}
              resizeMode="cover"
            >
              <View style={styles.heroCardImageOverlay} />
            </ImageBackground>

            <View style={styles.heroBadgeRow}>
              <View style={styles.heroBadge}>
                <Feather name="calendar" size={14} color="#111111" />
                <Text style={styles.heroBadgeText}>{String(weekLabel || 'This week').toUpperCase()}</Text>
              </View>
            </View>

            <Text style={styles.heroTitle}>Make the week scannable in one glance.</Text>
            <Text style={styles.heroText}>
              {hasPlan
                ? 'See where you are in the week, jump straight into today’s workout, or open the full calendar to review your plan and completed sessions.'
                : 'You can still log sessions here, but your week becomes much clearer once a plan is active.'}
            </Text>

            <View style={styles.statsRow}>
              {topMetrics.map((metric) => (
                <View key={metric.label} style={styles.statCard}>
                  <Text style={styles.statNumber}>{metric.value}</Text>
                  <Text style={styles.statLabel}>{metric.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Week strip</Text>
              <TouchableOpacity
                style={styles.inlineLinkButton}
                activeOpacity={0.82}
                onPress={() => handleNavigate('/home/calendar')}
              >
                <Feather name="calendar" size={14} color={accentText} />
                <Text style={[styles.inlineLinkText, { color: accentText }]}>
                  Open calendar
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.weekStripRow}
            >
              {weekStrip.map((item) => (
                <WeekDayCard
                  key={`${item.day}-${item.date}`}
                  item={item}
                  styles={styles}
                  colors={colors}
                  accentBg={accentBg}
                  isDark={isDark}
                  onPress={() =>
                    handleNavigate(
                      item.state === 'today'
                        ? '/home/today'
                        : '/home/calendar'
                    )
                  }
                />
              ))}
            </ScrollView>
          </View>

          <View style={styles.todayHeroCard}>
            <View style={styles.todayHeroTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.todayHeroEyebrow}>TODAY</Text>
                <Text style={styles.todayHeroTitle}>{todayDetails.title}</Text>
              </View>

              <View style={styles.todayPill}>
                <Text style={styles.todayPillText}>{todayDetails.phase}</Text>
              </View>
            </View>

            <Text style={styles.todayHeroText}>{todayDetails.description}</Text>

            <View style={styles.todayMetaRow}>
              {todayDetails.meta.map((item) => (
                <View key={item.label} style={styles.todayMetaChip}>
                  <Feather name={item.icon} size={14} color={colors.subtext} />
                  <Text style={styles.todayMetaText}>{item.label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.todayActionRow}>
              <TouchableOpacity
                style={styles.primaryActionButton}
                activeOpacity={0.86}
                onPress={() => handleNavigate('/home/today')}
              >
                <Feather name="play" size={16} color="#111111" />
                <Text style={styles.primaryActionText}>Open today</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryActionButton}
                activeOpacity={0.86}
                onPress={() => handleNavigate('/home/calendar')}
              >
                <Feather name="calendar" size={15} color={colors.text} />
                <Text style={styles.secondaryActionText}>Calendar</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.duoRow}>
            <View style={styles.infoCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.smallSectionTitle}>Run weather</Text>
                <Feather name="cloud" size={16} color={colors.subtext} />
              </View>

              <Text style={styles.weatherTemp}>{WEATHER.temp}</Text>
              <Text style={styles.weatherSub}>{WEATHER.summary}</Text>

              <View style={styles.weatherMetaRow}>
                <View style={styles.weatherMetaChip}>
                  <Feather name="wind" size={13} color={colors.subtext} />
                  <Text style={styles.weatherMetaText}>{WEATHER.wind}</Text>
                </View>
                <View style={styles.weatherMetaChip}>
                  <Feather name="droplet" size={13} color={colors.subtext} />
                  <Text style={styles.weatherMetaText}>{WEATHER.humidity}</Text>
                </View>
              </View>

              <Text style={styles.microNote}>{WEATHER.note}</Text>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.smallSectionTitle}>Prep</Text>
                <Feather name="zap" size={16} color={colors.subtext} />
              </View>

              {PREP_POINTS.map((point) => (
                <View key={point} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: accentBg }]} />
                  <Text style={styles.bulletText}>{point}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.coachNoteCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.smallSectionTitle}>Coach note</Text>
              <Feather name="message-circle" size={16} color={colors.subtext} />
            </View>
            <Text style={styles.coachNoteText}>{coachNote}</Text>
          </View>

          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Quick links</Text>
            <View style={styles.quickGrid}>
              {QUICK_LINKS.map((item) => (
                <QuickLinkCard
                  key={item.key}
                  item={item}
                  onPress={() => handleNavigate(item.path)}
                  styles={styles}
                  accentBg={accentBg}
                />
              ))}
            </View>
          </View>

          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Before you head out</Text>
            <View style={styles.checkListCard}>
              {TODAY_CHECKLIST.map((label) => (
                <View key={label} style={styles.checkRow}>
                  <View style={[styles.checkDot, { backgroundColor: accentBg }]} />
                  <Text style={styles.checkText}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.bottomActionCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bottomActionTitle}>Need the full week?</Text>
              <Text style={styles.bottomActionText}>
                Open the calendar to see your planned sessions, completed runs, and anything else you logged.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.bottomActionButton}
              activeOpacity={0.86}
              onPress={() => handleNavigate('/home/calendar')}
            >
              <Feather name="calendar" size={16} color="#111111" />
              <Text style={styles.bottomActionButtonText}>Open calendar</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(colors, isDark, accentBg, accentText, silverLight, silverMed) {
  const cardBg = isDark ? '#111217' : silverLight;
  const panelBg = isDark ? '#0E0F12' : '#FFFFFF';

  const shadow = isDark
    ? {
        shadowColor: '#000',
        shadowOpacity: 0.35,
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
        shadowOpacity: 0.22,
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
    topBackgroundFade: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 280,
    },
    page: { flex: 1, paddingHorizontal: 18 },
    scrollContent: { paddingBottom: 160, flexGrow: 1 },

    header: { marginTop: 6, marginBottom: 8 },
    headerTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      fontSize: 32,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: colors.text,
      textTransform: 'uppercase',
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      backgroundColor: panelBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerSubtitle: {
      marginTop: 2,
      color: colors.subtext,
      fontSize: 13,
    },
    errorCard: {
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#5A1D1D' : '#F8B4B4',
      backgroundColor: isDark ? '#2A0F0F' : '#FFF1F1',
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    errorText: {
      flex: 1,
      color: isDark ? '#FECACA' : '#8B1D1D',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
    },
    errorRetryBtn: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: isDark ? '#3B1111' : '#FFD4D4',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#7F1D1D' : '#FCA5A5',
    },
    errorRetryText: {
      color: isDark ? '#FEE2E2' : '#7F1D1D',
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },

    heroCard: {
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingVertical: 16,
      marginBottom: 22,
      backgroundColor: 'transparent',
      borderWidth: 0,
      borderColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    heroCardImage: {
      height: 148,
      borderRadius: 18,
      overflow: 'hidden',
      marginBottom: 12,
      backgroundColor: isDark ? '#111217' : '#E5E7EB',
    },
    heroCardImageInner: {
      borderRadius: 18,
    },
    heroCardImageOverlay: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(0,0,0,0.26)' : 'rgba(0,0,0,0.12)',
    },
    heroBadgeRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      marginBottom: 10,
    },
    heroBadge: {
      backgroundColor: accentBg,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      ...softShadow,
    },
    heroBadgeText: {
      color: '#111111',
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.8,
    },
    heroTitle: {
      color: colors.text,
      fontSize: 20,
      lineHeight: 25,
      fontWeight: '900',
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.2,
    },
    heroText: {
      color: colors.subtext,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      marginBottom: 14,
    },

    statsRow: { flexDirection: 'row', gap: 10 },
    statCard: {
      flex: 1,
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...softShadow,
    },
    statNumber: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      marginBottom: 4,
    },
    statLabel: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },

    sectionWrap: { marginBottom: 22 },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '900',
      color: colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 8,
    },
    inlineLinkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
    },
    inlineLinkText: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },

    weekStripRow: { paddingRight: 8, gap: 10 },
    weekDayCard: {
      width: 84,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
      ...softShadow,
    },
    weekDayLabel: {
      fontSize: 10,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 4,
    },
    weekDayDate: {
      fontSize: 16,
      fontWeight: '900',
      marginBottom: 8,
    },
    weekIconWrap: { marginBottom: 8 },
    weekDayMeta: {
      fontSize: 10,
      fontWeight: '700',
      textAlign: 'center',
      lineHeight: 13,
    },

    todayHeroCard: {
      backgroundColor: cardBg,
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingVertical: 16,
      marginBottom: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...shadow,
    },
    todayHeroTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 10,
    },
    todayHeroEyebrow: {
      color: colors.subtext,
      fontSize: 11,
      fontWeight: '900',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 4,
    },
    todayHeroTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      lineHeight: 23,
    },
    todayPill: {
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: accentBg,
      ...softShadow,
    },
    todayPillText: {
      color: '#111111',
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
    },
    todayHeroText: {
      color: colors.subtext,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    todayMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 14,
    },
    todayMetaChip: {
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
    todayMetaText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
    todayActionRow: { flexDirection: 'row', gap: 10 },
    primaryActionButton: {
      flex: 1,
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
    primaryActionText: {
      color: '#111111',
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    secondaryActionButton: {
      minWidth: 122,
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7,
      ...softShadow,
    },
    secondaryActionText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
    },

    duoRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
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
    cardHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    smallSectionTitle: {
      fontSize: 12,
      fontWeight: '900',
      color: colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },
    weatherTemp: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '900',
      marginBottom: 4,
    },
    weatherSub: {
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      marginBottom: 10,
    },
    weatherMetaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10,
    },
    weatherMetaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
    },
    weatherMetaText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '700',
    },
    microNote: {
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },

    bulletRow: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
      marginTop: 6,
    },
    bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
    bulletText: {
      flex: 1,
      fontSize: 12,
      color: colors.subtext,
      lineHeight: 17,
      fontWeight: '600',
    },

    coachNoteCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...shadow,
      marginBottom: 22,
    },
    coachNoteText: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },

    quickGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
    },
    quickCard: {
      width: '48%',
      backgroundColor: cardBg,
      borderRadius: 22,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...shadow,
    },
    quickIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    quickTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '900',
      marginBottom: 4,
    },
    quickSubtitle: {
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      minHeight: 32,
    },
    quickFooter: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    quickFooterText: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },

    checkListCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...shadow,
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 7,
    },
    checkDot: { width: 8, height: 8, borderRadius: 4 },
    checkText: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },

    bottomActionCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1F2128' : silverMed,
      ...shadow,
      marginBottom: 12,
    },
    bottomActionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '900',
      marginBottom: 6,
    },
    bottomActionText: {
      color: colors.subtext,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
      marginBottom: 14,
    },
    bottomActionButton: {
      alignSelf: 'flex-start',
      backgroundColor: accentBg,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      ...softShadow,
    },
    bottomActionButtonText: {
      color: '#111111',
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
  });
}
