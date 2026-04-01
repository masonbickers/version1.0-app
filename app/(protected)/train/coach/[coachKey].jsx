// app/(protected)/train/coach/[coachKey].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";
import { MASON_COACH_TEMPLATE_DOCS } from "../data/coachTemplates";

const AVATAR_SWATCHES = ["#2563EB", "#0EA5E9", "#0891B2", "#16A34A", "#D97706", "#9333EA"];
const LOCAL_COACH_PROFILE_BY_KEY = {
  "mason-bickers-hybrid-athlete": {
    headline: "Hybrid Endurance & Strength Coach",
    bio: "Mason builds structured, race-relevant programs that combine progressive running quality with smart volume and recoverability.",
    specialties: ["10K Development", "Hybrid Conditioning", "Performance Progressions"],
  },
};

const normaliseStr = (s) => String(s || "").trim();
const toSlug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function toList(v) {
  if (Array.isArray(v)) {
    return v.map((x) => normaliseStr(x)).filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => normaliseStr(x))
      .filter(Boolean);
  }
  return [];
}

function inferPlanKindFromDoc(planDoc) {
  const kind = String(planDoc?.kind || "").toLowerCase();
  const source = String(planDoc?.source || "").toLowerCase();
  const primary = String(
    planDoc?.primaryActivity || planDoc?.meta?.primaryActivity || ""
  ).toLowerCase();
  const merged = [kind, source, primary].join(" ");

  if (merged.includes("hyrox")) return "hyrox";
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
  if (merged.includes("hybrid")) return "hybrid";
  return kind || "training";
}

function sportLabelFromKey(key) {
  const k = String(key || "").toLowerCase();
  if (k === "run") return "Run";
  if (k === "strength") return "Strength";
  if (k === "hyrox") return "Hyrox";
  if (k === "hybrid") return "Hybrid";
  return "Training";
}

function sportIconFromKey(key) {
  const k = String(key || "").toLowerCase();
  if (k === "run") return "activity";
  if (k === "strength") return "bar-chart-2";
  if (k === "hyrox") return "zap";
  if (k === "hybrid") return "shuffle";
  return "layers";
}

function deriveSportMeta(kind, primaryActivity, name, description) {
  const k = String(kind || "").toLowerCase();
  const haystack = [k, primaryActivity, name, description].join(" ").toLowerCase();

  if (k === "hyrox" || haystack.includes("hyrox")) {
    return { key: "hyrox", label: "Hyrox", icon: "zap" };
  }
  if (k === "run" || haystack.includes("run")) {
    return { key: "run", label: "Run", icon: "activity" };
  }
  if (
    k === "strength" ||
    haystack.includes("strength") ||
    haystack.includes("gym") ||
    haystack.includes("hypertrophy")
  ) {
    return { key: "strength", label: "Strength", icon: "bar-chart-2" };
  }
  if (k === "hybrid" || haystack.includes("hybrid")) {
    return { key: "hybrid", label: "Hybrid", icon: "shuffle" };
  }

  return { key: "training", label: "Training", icon: "layers" };
}

function deriveFocusMeta(docData, sportKey, name, description) {
  const explicit =
    normaliseStr(docData?.primaryFocus) ||
    normaliseStr(docData?.goalType) ||
    normaliseStr(docData?.meta?.primaryFocus) ||
    normaliseStr(docData?.meta?.goalType);

  const haystack = [explicit, name, description].join(" ").toLowerCase();
  const focusMap = [
    { key: "10k", label: "10K Performance", match: ["10k"] },
    { key: "5k", label: "5K Performance", match: ["5k"] },
    { key: "half-marathon", label: "Half Marathon", match: ["half marathon", "half-marathon"] },
    { key: "marathon", label: "Marathon", match: ["marathon"] },
    { key: "hyrox", label: "Hyrox Specific", match: ["hyrox"] },
    { key: "strength", label: "Strength Build", match: ["strength", "hypertrophy", "power"] },
    { key: "endurance", label: "Endurance Base", match: ["endurance", "aerobic", "base"] },
    { key: "speed", label: "Speed Development", match: ["speed", "interval"] },
    { key: "tempo", label: "Tempo / Threshold", match: ["tempo", "threshold"] },
  ];

  for (const item of focusMap) {
    if (item.match.some((needle) => haystack.includes(needle))) {
      return { key: item.key, label: item.label };
    }
  }

  if (sportKey === "run") return { key: "run-development", label: "Run Development" };
  if (sportKey === "strength") return { key: "strength-progression", label: "Strength Progression" };
  if (sportKey === "hyrox") return { key: "hyrox-prep", label: "Race Preparation" };
  return { key: "general", label: "General Performance" };
}

function deriveLengthMeta(weekCount) {
  const weeks = Number(weekCount || 0);
  if (weeks <= 4) return { key: "short", label: "1-4 weeks" };
  if (weeks <= 8) return { key: "medium", label: "5-8 weeks" };
  return { key: "long", label: "9+ weeks" };
}

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

function extractWeeksFromPlanDoc(data) {
  if (!data || typeof data !== "object") return [];

  const candidates = [
    data?.weeks,
    data?.plan?.weeks,
    data?.planData?.weeks,
    data?.generatedPlan?.weeks,
    data?.activePlan?.weeks,
    data?.template?.weeks,
    data?.payload?.weeks,
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
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

function coachInitials(name) {
  const parts = String(name || "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "C";
  const first = parts[0]?.[0] || "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  return `${first}${second}`.toUpperCase().slice(0, 2);
}

function avatarColorIndex(key) {
  const str = String(key || "");
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash) % AVATAR_SWATCHES.length;
}

function formatSessionsPerWeek(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "Custom";
  if (Math.abs(Math.round(n) - n) < 0.1) return `${Math.round(n)} / week`;
  return `${n.toFixed(1)} / week`;
}

function normaliseCoachPlanCandidate({ sourceCollection, docData, currentUid }) {
  if (!docData || typeof docData !== "object") return null;

  const ownerUid = String(
    docData?.uid || docData?.userId || docData?.ownerId || docData?.createdByUid || ""
  );
  if (currentUid && ownerUid && ownerUid === currentUid) return null;

  if (!isCoachSetPlanDoc(docData)) return null;

  const weeks = extractWeeksFromPlanDoc(docData);
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
    sportLabelFromKey(kind);

  const weekCount = weeks.length;
  const sessionCount = countSessionsInWeeks(weeks);
  const sessionsPerWeekRaw = Number(
    docData?.sessionsPerWeek || docData?.meta?.sessionsPerWeek || 0
  );
  const sessionsPerWeek =
    sessionsPerWeekRaw > 0 ? sessionsPerWeekRaw : weekCount > 0 ? sessionCount / weekCount : 0;

  const sport = deriveSportMeta(kind, primaryActivity, name, description);
  const focus = deriveFocusMeta(docData, sport.key, name, description);
  const length = deriveLengthMeta(weekCount);

  const coachName = getCoachNameFromDoc(docData) || "Coach set";
  const coachKey = toSlug(coachName) || `coach-${docData.id || name}`;

  return {
    id: String(docData.id),
    sourceCollection,
    name,
    description,
    coachName,
    coachKey,
    coachInitials: coachInitials(coachName),
    coachColorIndex: avatarColorIndex(coachKey),
    sportKey: sport.key,
    sportLabel: sport.label,
    sportIcon: sport.icon,
    primaryActivity,
    focusKey: focus.key,
    focusLabel: focus.label,
    lengthKey: length.key,
    lengthLabel: length.label,
    weekCount,
    sessionCount,
    sessionsPerWeek,
    sortMs: Math.max(timestampMs(docData?.updatedAt), timestampMs(docData?.createdAt)),
    raw: { ...docData },
  };
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
    primaryBg: colors?.accentBg ?? "#E6FF3B",
    primaryText: "#111111",
    isDark,
  };
}

export default function CoachProfilePage() {
  const router = useRouter();
  const theme = useScreenTheme();
  const { coachKey: rawCoachKey, coachName: rawCoachName } = useLocalSearchParams();

  const coachKeyParam = useMemo(
    () => toSlug(Array.isArray(rawCoachKey) ? rawCoachKey[0] : rawCoachKey),
    [rawCoachKey]
  );
  const coachNameParam = useMemo(
    () => normaliseStr(Array.isArray(rawCoachName) ? rawCoachName[0] : rawCoachName),
    [rawCoachName]
  );
  const targetCoachKey = useMemo(
    () => coachKeyParam || toSlug(coachNameParam),
    [coachKeyParam, coachNameParam]
  );

  const [loading, setLoading] = useState(true);
  const [coachPlans, setCoachPlans] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [sportFilter, setSportFilter] = useState("all");
  const [usingCoachPlanId, setUsingCoachPlanId] = useState("");

  const loadCoachPlans = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !targetCoachKey) {
      setCoachPlans([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const fetchTopLevelPlanDocs = async (colName) => {
        const colRef = collection(db, colName);
        const attempts = [
          () => getDocs(query(colRef, orderBy("updatedAt", "desc"), limit(120))),
          () => getDocs(query(colRef, orderBy("createdAt", "desc"), limit(120))),
          () => getDocs(query(colRef, limit(120))),
        ];

        for (const runAttempt of attempts) {
          try {
            const snap = await runAttempt();
            if (!snap?.docs?.length) continue;
            return snap.docs.map((d) => ({
              sourceCollection: colName,
              docData: { id: d.id, ...d.data() },
            }));
          } catch {
            // try next query shape
          }
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
        .filter((x) => x.coachKey === targetCoachKey)
        .sort((a, b) => {
          const byUpdated = b.sortMs - a.sortMs;
          if (byUpdated !== 0) return byUpdated;
          return a.name.localeCompare(b.name);
        });

      setCoachPlans(normalised);
    } catch (e) {
      console.log("[coach-profile] load error:", e);
      setCoachPlans([]);
    } finally {
      setLoading(false);
    }
  }, [targetCoachKey]);

  useEffect(() => {
    loadCoachPlans();
  }, [loadCoachPlans]);

  const sportOptions = useMemo(() => {
    const labels = Array.from(
      new Set(coachPlans.map((p) => p.sportLabel).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    return ["All sports", ...labels];
  }, [coachPlans]);

  useEffect(() => {
    if (!sportOptions.includes(sportFilter)) setSportFilter("All sports");
  }, [sportFilter, sportOptions]);

  const filteredPlans = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    return coachPlans.filter((item) => {
      if (sportFilter !== "All sports" && item.sportLabel !== sportFilter) return false;
      if (!q) return true;
      const haystack = [
        item.name,
        item.description,
        item.focusLabel,
        item.sportLabel,
        item.primaryActivity,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [coachPlans, searchText, sportFilter]);

  const coachSummary = useMemo(() => {
    const fallbackName = coachPlans[0]?.coachName || coachNameParam || "Coach";
    const sports = Array.from(new Set(coachPlans.map((p) => p.sportLabel).filter(Boolean)));
    const focusCount = new Map();
    coachPlans.forEach((p) => {
      const key = normaliseStr(p.focusLabel);
      if (!key) return;
      focusCount.set(key, (focusCount.get(key) || 0) + 1);
    });
    const topFocus = Array.from(focusCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label);

    const avgWeeks =
      coachPlans.length > 0
        ? coachPlans.reduce((sum, p) => sum + Number(p.weekCount || 0), 0) / coachPlans.length
        : 0;
    const totalSessions = coachPlans.reduce((sum, p) => sum + Number(p.sessionCount || 0), 0);

    const sourceDoc = coachPlans[0]?.raw || {};
    const explicitHeadline =
      normaliseStr(sourceDoc?.coach?.headline) ||
      normaliseStr(sourceDoc?.coachHeadline) ||
      normaliseStr(sourceDoc?.meta?.coachHeadline);
    const explicitBio =
      normaliseStr(sourceDoc?.coach?.bio) ||
      normaliseStr(sourceDoc?.coachBio) ||
      normaliseStr(sourceDoc?.meta?.coachBio);
    const explicitSpecialties = [
      ...toList(sourceDoc?.coach?.specialties),
      ...toList(sourceDoc?.specialties),
      ...toList(sourceDoc?.meta?.specialties),
    ];

    const local = LOCAL_COACH_PROFILE_BY_KEY[targetCoachKey] || null;
    const headline =
      explicitHeadline ||
      local?.headline ||
      `${sports.length ? sports.join(" + ") : "Multi-sport"} Performance Coach`;
    const bio =
      explicitBio ||
      local?.bio ||
      `${fallbackName} delivers progressive coaching plans designed for consistency, measurable improvement, and confident execution.`;
    const specialties = explicitSpecialties.length
      ? explicitSpecialties.slice(0, 6)
      : local?.specialties?.length
      ? local.specialties.slice(0, 6)
      : topFocus.length
      ? topFocus
      : ["Structured Programming", "Performance Development"];

    return {
      key: targetCoachKey,
      name: fallbackName,
      initials: coachInitials(fallbackName),
      colorIndex: avatarColorIndex(targetCoachKey || fallbackName),
      headline,
      bio,
      specialties,
      sportCount: sports.length,
      planCount: coachPlans.length,
      avgWeeks,
      totalSessions,
    };
  }, [coachNameParam, coachPlans, targetCoachKey]);

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

  const useCoachPlan = useCallback(
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
        const weeks = extractWeeksFromPlanDoc(source);
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

        Alert.alert("Coach plan added", "Added to your plans.", [
          {
            text: "View",
            onPress: () =>
              router.push({ pathname: "/train/view-plan", params: { planId: ref.id } }),
          },
          { text: "Done", style: "cancel" },
        ]);
      } catch (e) {
        Alert.alert("Couldn’t add coach plan", e?.message || "Try again.");
      } finally {
        setUsingCoachPlanId("");
      }
    },
    [router]
  );

  if (!targetCoachKey) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
        <View style={styles.emptyWrap}>
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 16 }}>
            Coach not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
          activeOpacity={0.85}
        >
          <Feather name="chevron-left" size={16} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 13 }}>Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: theme.text }]}>Coach Profile</Text>
        <View style={styles.headerRightPad} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
          <Text style={{ color: theme.subtext, fontWeight: "700" }}>Loading coach profile...</Text>
        </View>
      ) : !coachPlans.length ? (
        <View style={[styles.emptyWrap, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 16 }}>No coach plans found</Text>
          <Text style={[styles.emptyText, { color: theme.subtext }]}>
            This coach currently has no published plans in your library.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heroCard, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <View style={styles.heroTopRow}>
              <View
                style={[
                  styles.heroAvatar,
                  { backgroundColor: AVATAR_SWATCHES[coachSummary.colorIndex] || AVATAR_SWATCHES[0] },
                ]}
              >
                <Text style={styles.heroAvatarText}>{coachSummary.initials}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.coachName, { color: theme.text }]}>{coachSummary.name}</Text>
                <Text style={[styles.coachHeadline, { color: theme.subtext }]}>
                  {coachSummary.headline}
                </Text>
              </View>
            </View>

            <Text style={[styles.coachBio, { color: theme.subtext }]}>{coachSummary.bio}</Text>

            <View style={styles.specialtyRow}>
              {coachSummary.specialties.map((item) => (
                <View key={`sp-${item}`} style={[styles.specialtyChip, { backgroundColor: theme.card2 }]}>
                  <Text style={[styles.specialtyChipText, { color: theme.text }]}>{item}</Text>
                </View>
              ))}
            </View>

            <View style={styles.metricRow}>
              <View style={[styles.metricCard, { backgroundColor: theme.card2 }]}>
                <Text style={[styles.metricValue, { color: theme.text }]}>{coachSummary.planCount}</Text>
                <Text style={[styles.metricLabel, { color: theme.subtext }]}>Plans</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: theme.card2 }]}>
                <Text style={[styles.metricValue, { color: theme.text }]}>{coachSummary.sportCount}</Text>
                <Text style={[styles.metricLabel, { color: theme.subtext }]}>Sports</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: theme.card2 }]}>
                <Text style={[styles.metricValue, { color: theme.text }]}>
                  {coachSummary.avgWeeks ? coachSummary.avgWeeks.toFixed(1) : "0.0"}
                </Text>
                <Text style={[styles.metricLabel, { color: theme.subtext }]}>Avg weeks</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: theme.card2 }]}>
                <Text style={[styles.metricValue, { color: theme.text }]}>{coachSummary.totalSessions}</Text>
                <Text style={[styles.metricLabel, { color: theme.subtext }]}>Sessions</Text>
              </View>
            </View>
          </View>

          <View style={[styles.searchWrap, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
            <Feather name="search" size={16} color={theme.subtext} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search this coach's plans"
              placeholderTextColor={theme.subtext}
              style={[styles.searchInput, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchText ? (
              <TouchableOpacity onPress={() => setSearchText("")} activeOpacity={0.8}>
                <Feather name="x" size={16} color={theme.subtext} />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {sportOptions.map((label) => {
              const active = sportFilter === label;
              return (
                <TouchableOpacity
                  key={`sport-${label}`}
                  onPress={() => setSportFilter(label)}
                  style={[
                    styles.sportChip,
                    active
                      ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
                      : { backgroundColor: theme.card2, borderColor: theme.border },
                  ]}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.sportChipText,
                      { color: active ? theme.primaryText : theme.text },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={[styles.resultMeta, { color: theme.subtext }]}>
            {filteredPlans.length} plan{filteredPlans.length === 1 ? "" : "s"}
          </Text>

          <View style={styles.planList}>
            {filteredPlans.map((plan) => {
              const isLocalTemplate = plan.sourceCollection === "localTemplates";
              const isUsing = String(usingCoachPlanId) === String(plan.id);

              return (
                <View
                  key={`${plan.sourceCollection}_${plan.id}`}
                  style={[styles.planCard, { borderColor: theme.border, backgroundColor: theme.card }]}
                >
                  <View style={styles.planTopRow}>
                    <View style={[styles.planSportDot, { backgroundColor: theme.card2 }]}>
                      <Feather name={plan.sportIcon} size={14} color={theme.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planName, { color: theme.text }]} numberOfLines={2}>
                        {plan.name}
                      </Text>
                      {!!plan.description ? (
                        <Text style={[styles.planDescription, { color: theme.subtext }]} numberOfLines={2}>
                          {plan.description}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <View style={[styles.metaPill, { backgroundColor: theme.card2 }]}>
                      <Text style={[styles.metaPillText, { color: theme.text }]}>{plan.focusLabel}</Text>
                    </View>
                    <View style={[styles.metaPill, { backgroundColor: theme.card2 }]}>
                      <Text style={[styles.metaPillText, { color: theme.text }]}>{plan.weekCount} weeks</Text>
                    </View>
                    <View style={[styles.metaPill, { backgroundColor: theme.card2 }]}>
                      <Text style={[styles.metaPillText, { color: theme.text }]}>{plan.sessionCount} sessions</Text>
                    </View>
                    <View style={[styles.metaPill, { backgroundColor: theme.card2 }]}>
                      <Text style={[styles.metaPillText, { color: theme.text }]}>
                        {formatSessionsPerWeek(plan.sessionsPerWeek)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => viewCoachPlan(plan)}
                      style={[styles.actionBtn, { backgroundColor: theme.card2 }]}
                      activeOpacity={0.85}
                    >
                      <Feather name="eye" size={14} color={theme.text} />
                      <Text style={{ color: theme.text, fontWeight: "900", fontSize: 13 }}>View</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() =>
                        isLocalTemplate
                          ? router.push({
                              pathname: "/train/coach-plan-preview",
                              params: { templateId: plan.id },
                            })
                          : useCoachPlan(plan)
                      }
                      disabled={isUsing}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: theme.primaryBg,
                          opacity: isUsing ? 0.75 : 1,
                        },
                      ]}
                      activeOpacity={0.85}
                    >
                      {isUsing ? (
                        <ActivityIndicator size="small" color={theme.primaryText} />
                      ) : (
                        <Feather
                          name={isLocalTemplate ? "sliders" : "plus"}
                          size={14}
                          color={theme.primaryText}
                        />
                      )}
                      <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 13 }}>
                        {isUsing ? "Adding..." : isLocalTemplate ? "Personalise" : "Use plan"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: "900",
  },
  headerRightPad: {
    width: 68,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroAvatar: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  coachName: {
    fontSize: 19,
    fontWeight: "900",
  },
  coachHeadline: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "800",
  },
  coachBio: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  specialtyRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  specialtyChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  specialtyChipText: {
    fontSize: 11,
    fontWeight: "800",
  },
  metricRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metricCard: {
    flexBasis: "48%",
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    fontSize: 16,
    fontWeight: "900",
  },
  metricLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  searchWrap: {
    marginTop: 12,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    paddingVertical: 0,
  },
  filterScroll: {
    marginTop: 10,
    gap: 8,
    paddingRight: 10,
  },
  sportChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sportChipText: {
    fontSize: 12,
    fontWeight: "900",
  },
  resultMeta: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "700",
  },
  planList: {
    marginTop: 10,
    gap: 10,
  },
  planCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  planTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  planSportDot: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planName: {
    fontSize: 15,
    fontWeight: "900",
  },
  planDescription: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  metaPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyWrap: {
    margin: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
  },
  emptyText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
});
