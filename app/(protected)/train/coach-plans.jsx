// app/(protected)/train/coach-plans.jsx
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
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
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { MASON_COACH_TEMPLATE_DOCS } from "./data/coachTemplates";

const SPORT_ORDER = ["run", "strength", "hyrox", "hybrid", "training"];
const LENGTH_OPTIONS = [
  { key: "short", label: "1-4 weeks" },
  { key: "medium", label: "5-8 weeks" },
  { key: "long", label: "9+ weeks" },
];
const DIFFICULTY_OPTIONS = [
  { key: "all", label: "All levels" },
  { key: "beginner", label: "Beginner" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
];
const SORT_OPTIONS = [
  { key: "recommended", label: "Recommended" },
  { key: "popular", label: "Most Popular" },
  { key: "newest", label: "Newest" },
  { key: "shortest", label: "Shortest Plan" },
  { key: "longest", label: "Longest Plan" },
  { key: "beginner", label: "Beginner Friendly" },
  { key: "commitment", label: "Highest Commitment" },
];
const TRENDING_QUERIES = ["Half marathon", "HYROX", "Strength", "Fat loss", "Beginner"];
const COACH_LIBRARY_HERO_IMAGE = require("../../../assets/images/home/img_home_hero_today.jpg");
const AVATAR_SWATCHES = ["#2563EB", "#0EA5E9", "#0891B2", "#16A34A", "#D97706", "#9333EA"];

const normaliseStr = (s) => String(s || "").trim();
const toSlug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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

function deriveDifficultyMeta(docData, weeks, sessionsPerWeek) {
  const explicit = String(
    docData?.difficulty || docData?.meta?.difficulty || docData?.level || docData?.experienceLevel || ""
  )
    .trim()
    .toLowerCase();
  if (explicit.includes("beginner")) return { key: "beginner", label: "Beginner" };
  if (explicit.includes("advanced")) return { key: "advanced", label: "Advanced" };
  if (explicit.includes("intermediate")) return { key: "intermediate", label: "Intermediate" };

  const weekCount = Number(weeks || 0);
  const weekly = Number(sessionsPerWeek || 0);
  if (weekCount >= 10 || weekly >= 5) return { key: "advanced", label: "Advanced" };
  if (weekCount >= 6 || weekly >= 3.5) return { key: "intermediate", label: "Intermediate" };
  return { key: "beginner", label: "Beginner" };
}

function seededNumber(input, min, max) {
  const base = String(input || "");
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 33 + base.charCodeAt(i)) % 2147483647;
  }
  const span = Math.max(1, max - min + 1);
  return min + (Math.abs(hash) % span);
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

function formatAthleteCount(value) {
  const n = Number(value || 0);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function planMatchesFilters(item, filters, queryText) {
  const q = String(queryText || "").trim().toLowerCase();
  if (filters?.coachFilter !== "all" && item.coachKey !== filters.coachFilter) return false;
  if (filters?.sportFilter !== "all" && item.sportKey !== filters.sportFilter) return false;
  if (filters?.lengthFilter !== "all" && item.lengthKey !== filters.lengthFilter) return false;
  if (filters?.focusFilter !== "all" && item.focusKey !== filters.focusFilter) return false;
  if (filters?.difficultyFilter !== "all" && item.difficultyKey !== filters.difficultyFilter) return false;
  if (!q) return true;

  const haystack = [
    item.name,
    item.description,
    item.coachName,
    item.kind,
    item.primaryActivity,
    item.focusLabel,
    item.sportLabel,
    item.difficultyLabel,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
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
  const sessionsPerWeekRaw = Number(docData?.sessionsPerWeek || docData?.meta?.sessionsPerWeek || 0);
  const sessionsPerWeek =
    sessionsPerWeekRaw > 0 ? sessionsPerWeekRaw : weekCount > 0 ? sessionCount / weekCount : 0;

  const sport = deriveSportMeta(kind, primaryActivity, name, description);
  const focus = deriveFocusMeta(docData, sport.key, name, description);
  const length = deriveLengthMeta(weekCount);
  const difficulty = deriveDifficultyMeta(docData, weekCount, sessionsPerWeek);

  const coachName = getCoachNameFromDoc(docData) || "Coach set";
  const coachKey = toSlug(coachName) || `coach-${docData.id || name}`;
  const popularityBase = sessionCount * 14 + Math.round(sessionsPerWeek * 27) + (weekCount > 0 ? 40 : 0);
  const popularityNoise = seededNumber(`${sourceCollection}_${docData.id || name}_pop`, 30, 220);
  const popularityScore = popularityBase + popularityNoise;
  const athletesUsing = seededNumber(`${sourceCollection}_${docData.id || name}_ath`, 90, 1900);
  const ratingTenths = seededNumber(`${sourceCollection}_${docData.id || name}_rating`, 44, 50);
  const rating = Number((ratingTenths / 10).toFixed(1));
  const sortTimestamp = Math.max(timestampMs(docData?.updatedAt), timestampMs(docData?.createdAt));
  const ageMs = Date.now() - sortTimestamp;
  const isNewThisWeek = sortTimestamp > 0 && ageMs <= 7 * 24 * 60 * 60 * 1000;
  const bestFor =
    difficulty.key === "beginner"
      ? "Best for athletes building consistency"
      : difficulty.key === "advanced"
      ? "Best for athletes ready for higher load"
      : "Best for athletes improving structure and pace";

  return {
    id: String(docData.id),
    sourceCollection,
    name,
    description,
    coachName,
    coachKey,
    coachInitials: coachInitials(coachName),
    coachColorIndex: avatarColorIndex(coachKey),
    kind,
    sportKey: sport.key,
    sportLabel: sport.label,
    sportIcon: sport.icon,
    primaryActivity,
    focusKey: focus.key,
    focusLabel: focus.label,
    lengthKey: length.key,
    lengthLabel: length.label,
    difficultyKey: difficulty.key,
    difficultyLabel: difficulty.label,
    weekCount,
    sessionCount,
    sessionsPerWeek,
    athletesUsing,
    rating,
    bestFor,
    popularityScore,
    isNewThisWeek,
    sortMs: sortTimestamp,
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
    muted: isDark ? "#0A0B0E" : "#EEF2F7",
    text: colors.text,
    subtext: colors.subtext,
    border: isDark ? "#1F2128" : silverMed,
    primaryBg: colors?.accentBg ?? "#E6FF3B",
    primaryText: "#111111",
    isDark,
  };
}

export default function CoachPlansPage() {
  const theme = useScreenTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [loading, setLoading] = useState(true);
  const [coachPlans, setCoachPlans] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [coachFilter, setCoachFilter] = useState("all");
  const [sportFilter, setSportFilter] = useState("all");
  const [lengthFilter, setLengthFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recommended");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedPlanIds, setSavedPlanIds] = useState([]);
  const [compareIds, setCompareIds] = useState([]);
  const [usingCoachPlanId, setUsingCoachPlanId] = useState("");

  const loadCoachPlans = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
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
        .sort((a, b) => {
          const byUpdated = b.sortMs - a.sortMs;
          if (byUpdated !== 0) return byUpdated;
          return a.name.localeCompare(b.name);
        });

      setCoachPlans(normalised);
    } catch (e) {
      console.log("[coach-plans] load error:", e);
      setCoachPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoachPlans();
  }, [loadCoachPlans]);

  useFocusEffect(
    useCallback(() => {
      loadCoachPlans();
    }, [loadCoachPlans])
  );

  const sportOptions = useMemo(() => {
    const set = new Set(coachPlans.map((p) => p.sportKey).filter(Boolean));
    const ordered = [
      ...SPORT_ORDER.filter((key) => set.has(key)),
      ...Array.from(set)
        .filter((key) => !SPORT_ORDER.includes(key))
        .sort((a, b) => a.localeCompare(b)),
    ];

    return [
      { key: "all", label: "All sports", icon: "grid" },
      ...ordered.map((key) => ({
        key,
        label: sportLabelFromKey(key),
        icon: sportIconFromKey(key),
      })),
    ];
  }, [coachPlans]);

  const lengthOptions = useMemo(() => {
    const set = new Set(coachPlans.map((p) => p.lengthKey).filter(Boolean));
    return [{ key: "all", label: "All lengths" }, ...LENGTH_OPTIONS.filter((x) => set.has(x.key))];
  }, [coachPlans]);

  const focusOptions = useMemo(() => {
    const map = new Map();
    coachPlans.forEach((plan) => {
      if (!plan.focusKey) return;
      const existing = map.get(plan.focusKey);
      map.set(plan.focusKey, {
        key: plan.focusKey,
        label: plan.focusLabel || "Focus",
        count: (existing?.count || 0) + 1,
      });
    });

    const items = Array.from(map.values())
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 8);

    return [{ key: "all", label: "All focus" }, ...items.map(({ key, label }) => ({ key, label }))];
  }, [coachPlans]);

  const coachOptions = useMemo(() => {
    const map = new Map();
    coachPlans.forEach((plan) => {
      const existing = map.get(plan.coachKey);
      map.set(plan.coachKey, {
        key: plan.coachKey,
        label: plan.coachName,
        initials: plan.coachInitials,
        colorIndex: plan.coachColorIndex,
        count: (existing?.count || 0) + 1,
      });
    });

    const items = Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });

    return [
      {
        key: "all",
        label: "All coaches",
        initials: "ALL",
        colorIndex: 0,
        count: coachPlans.length,
      },
      ...items,
    ];
  }, [coachPlans]);

  const coachDirectory = useMemo(
    () => coachOptions.filter((x) => x.key !== "all"),
    [coachOptions]
  );
  const difficultyOptions = useMemo(() => {
    const set = new Set(coachPlans.map((p) => p.difficultyKey).filter(Boolean));
    return DIFFICULTY_OPTIONS.filter((opt) => opt.key === "all" || set.has(opt.key));
  }, [coachPlans]);
  const coachFilterOptions = useMemo(
    () => coachOptions.map((x) => ({ key: x.key, label: x.label })),
    [coachOptions]
  );

  useEffect(() => {
    if (!sportOptions.some((x) => x.key === sportFilter)) setSportFilter("all");
  }, [sportFilter, sportOptions]);

  useEffect(() => {
    if (!lengthOptions.some((x) => x.key === lengthFilter)) setLengthFilter("all");
  }, [lengthFilter, lengthOptions]);

  useEffect(() => {
    if (!focusOptions.some((x) => x.key === focusFilter)) setFocusFilter("all");
  }, [focusFilter, focusOptions]);
  useEffect(() => {
    if (!coachOptions.some((x) => x.key === coachFilter)) setCoachFilter("all");
  }, [coachFilter, coachOptions]);
  useEffect(() => {
    if (!difficultyOptions.some((x) => x.key === difficultyFilter)) setDifficultyFilter("all");
  }, [difficultyFilter, difficultyOptions]);

  const filteredPlans = useMemo(() => {
    const filters = { coachFilter, sportFilter, lengthFilter, focusFilter, difficultyFilter };
    return coachPlans.filter((item) => planMatchesFilters(item, filters, searchText));
  }, [coachFilter, coachPlans, difficultyFilter, focusFilter, lengthFilter, searchText, sportFilter]);

  const sortedPlans = useMemo(() => {
    const list = [...filteredPlans];
    list.sort((a, b) => {
      if (sortBy === "newest") return b.sortMs - a.sortMs;
      if (sortBy === "popular") return (b.popularityScore || 0) - (a.popularityScore || 0);
      if (sortBy === "shortest") return a.weekCount - b.weekCount;
      if (sortBy === "longest") return b.weekCount - a.weekCount;
      if (sortBy === "beginner") {
        const aBoost = a.difficultyKey === "beginner" ? 1 : 0;
        const bBoost = b.difficultyKey === "beginner" ? 1 : 0;
        if (bBoost !== aBoost) return bBoost - aBoost;
        return (b.popularityScore || 0) - (a.popularityScore || 0);
      }
      if (sortBy === "commitment") {
        const aLoad = Number(a.sessionsPerWeek || 0) + Number(a.weekCount || 0) / 4;
        const bLoad = Number(b.sessionsPerWeek || 0) + Number(b.weekCount || 0) / 4;
        if (bLoad !== aLoad) return bLoad - aLoad;
        return (b.popularityScore || 0) - (a.popularityScore || 0);
      }
      const aRec = (a.popularityScore || 0) + (a.isNewThisWeek ? 80 : 0);
      const bRec = (b.popularityScore || 0) + (b.isNewThisWeek ? 80 : 0);
      if (bRec !== aRec) return bRec - aRec;
      return b.sortMs - a.sortMs;
    });
    return list;
  }, [filteredPlans, sortBy]);

  const featuredPlans = useMemo(() => {
    return [...coachPlans]
      .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0))
      .slice(0, 8);
  }, [coachPlans]);

  const recommendedPlans = useMemo(() => {
    return [...coachPlans]
      .sort((a, b) => {
        const aScore = (a.difficultyKey === "beginner" ? 30 : 0) + (a.popularityScore || 0);
        const bScore = (b.difficultyKey === "beginner" ? 30 : 0) + (b.popularityScore || 0);
        return bScore - aScore;
      })
      .slice(0, 8);
  }, [coachPlans]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (coachFilter !== "all") count += 1;
    if (sportFilter !== "all") count += 1;
    if (lengthFilter !== "all") count += 1;
    if (focusFilter !== "all") count += 1;
    if (difficultyFilter !== "all") count += 1;
    if (searchText.trim()) count += 1;
    return count;
  }, [coachFilter, difficultyFilter, focusFilter, lengthFilter, searchText, sportFilter]);

  const heroSummary = useMemo(() => {
    const coachCount = Math.max(0, coachOptions.length - 1);
    const sportCount = Math.max(0, sportOptions.length - 1);
    const focusCount = Math.max(0, focusOptions.length - 1);
    const topSport = sportOptions.find((s) => s.key !== "all")?.label || "Run";
    const newThisWeek = coachPlans.filter((x) => x.isNewThisWeek).length;
    return {
      plans: coachPlans.length,
      coaches: coachCount,
      sports: sportCount,
      focusCount,
      topSport,
      newThisWeek,
    };
  }, [coachOptions.length, coachPlans, focusOptions.length, sportOptions]);

  const clearAllFilters = useCallback(() => {
    setSearchText("");
    setCoachFilter("all");
    setSportFilter("all");
    setLengthFilter("all");
    setFocusFilter("all");
    setDifficultyFilter("all");
    setSortBy("recommended");
  }, []);

  const applySuggestedSearch = useCallback((value) => {
    setSearchText(String(value || ""));
  }, []);

  const toggleSave = useCallback((planId) => {
    if (!planId) return;
    setSavedPlanIds((prev) =>
      prev.includes(planId) ? prev.filter((x) => x !== planId) : [...prev, planId]
    );
  }, []);

  const toggleCompare = useCallback((planId) => {
    if (!planId) return;
    setCompareIds((prev) => {
      if (prev.includes(planId)) return prev.filter((x) => x !== planId);
      if (prev.length >= 3) return prev;
      return [...prev, planId];
    });
  }, []);

  const comparePlans = useCallback(() => {
    const picked = coachPlans.filter((p) => compareIds.includes(p.id));
    if (picked.length < 2) {
      Alert.alert("Compare plans", "Pick at least 2 plans to compare.");
      return;
    }
    const body = picked
      .map(
        (p) =>
          `${p.name}\n${p.weekCount} weeks • ${p.sessionCount} sessions • ${formatSessionsPerWeek(
            p.sessionsPerWeek
          )} • ${p.difficultyLabel}`
      )
      .join("\n\n");
    Alert.alert("Plan comparison", body);
  }, [coachPlans, compareIds]);

  const filtersSnapshot = useMemo(
    () => ({
      coachFilter,
      sportFilter,
      lengthFilter,
      focusFilter,
      difficultyFilter,
      sortBy,
    }),
    [coachFilter, difficultyFilter, focusFilter, lengthFilter, sortBy, sportFilter]
  );
  const [draftFilters, setDraftFilters] = useState(filtersSnapshot);
  useEffect(() => {
    if (!filtersOpen) setDraftFilters(filtersSnapshot);
  }, [filtersOpen, filtersSnapshot]);
  const draftResultCount = useMemo(
    () => coachPlans.filter((item) => planMatchesFilters(item, draftFilters, searchText)).length,
    [coachPlans, draftFilters, searchText]
  );

  const openCoachProfile = useCallback(
    (coach) => {
      if (!coach?.coachKey) return;
      router.push({
        pathname: "/train/coach/[coachKey]",
        params: {
          coachKey: coach.coachKey,
          coachName: coach.coachName || "",
        },
      });
    },
    [router]
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
  const selectedCoachLabel =
    coachOptions.find((x) => x.key === coachFilter)?.label || "All coaches";
  const selectedSportLabel =
    sportOptions.find((x) => x.key === sportFilter)?.label || "All sports";
  const selectedLengthLabel =
    lengthOptions.find((x) => x.key === lengthFilter)?.label || "All lengths";
  const selectedFocusLabel =
    focusOptions.find((x) => x.key === focusFilter)?.label || "All focus";
  const selectedDifficultyLabel =
    difficultyOptions.find((x) => x.key === difficultyFilter)?.label || "All levels";
  const selectedSortLabel =
    SORT_OPTIONS.find((x) => x.key === sortBy)?.label || "Recommended";

  const statsCards = [
    { key: "plans", icon: "layers", value: heroSummary.plans, label: "Plans" },
    { key: "coaches", icon: "users", value: heroSummary.coaches, label: "Coaches" },
    { key: "sports", icon: "activity", value: heroSummary.sports, label: "Sports" },
    { key: "top", icon: "trending-up", value: heroSummary.topSport, label: "Most popular" },
    { key: "new", icon: "clock", value: heroSummary.newThisWeek, label: "New this week" },
  ];

  const applyDraftFilters = () => {
    setCoachFilter(draftFilters.coachFilter);
    setSportFilter(draftFilters.sportFilter);
    setLengthFilter(draftFilters.lengthFilter);
    setFocusFilter(draftFilters.focusFilter);
    setDifficultyFilter(draftFilters.difficultyFilter);
    setSortBy(draftFilters.sortBy);
    setFiltersOpen(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderColor: theme.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
          activeOpacity={0.85}
        >
          <Feather name="chevron-left" size={16} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 13 }}>Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: theme.text }]}>Browse Coach Plans</Text>

        <TouchableOpacity
          onPress={() => setFiltersOpen(true)}
          style={[styles.headerFilterBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
          activeOpacity={0.85}
        >
          <Feather name="sliders" size={14} color={theme.text} />
          {activeFilterCount > 0 ? (
            <View style={[styles.headerFilterBadge, { backgroundColor: theme.primaryBg }]}> 
              <Text style={{ color: theme.primaryText, fontSize: 10, fontWeight: "900" }}>
                {activeFilterCount}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroShell, { borderColor: theme.border }]}> 
          <LinearGradient
            colors={theme.isDark ? ["#0F172A", "#111827", "#0A0B0E"] : ["#F8FAFC", "#EEF2FF", "#E2E8F0"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            <View style={[styles.heroGlowOne, { backgroundColor: "rgba(34,197,94,0.14)" }]} />
            <View style={[styles.heroGlowTwo, { backgroundColor: "rgba(59,130,246,0.12)" }]} />

            <View style={[styles.heroBadge, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
              <Feather name="shield" size={12} color={theme.text} />
              <Text style={[styles.heroBadgeText, { color: theme.text }]}>Coach-curated library</Text>
            </View>

            <View style={styles.heroMainRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heroHeadline, { color: theme.text }]}>Browse Coach Plans</Text>
                <Text style={[styles.heroSubtitle, { color: theme.subtext }]}> 
                  Explore coach-built plans for running, HYROX, strength, hybrid training and more.
                </Text>
              </View>

              <View style={[styles.heroSideCard, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                <View style={styles.heroSideImageWrap}>
                  <Image
                    source={COACH_LIBRARY_HERO_IMAGE}
                    style={styles.heroSideImage}
                    resizeMode="cover"
                  />
                </View>
                <Text style={[styles.heroSideLabel, { color: theme.subtext }]}>Top category</Text>
                <Text style={[styles.heroSideValue, { color: theme.text }]}>{heroSummary.topSport}</Text>
                <Text style={[styles.heroSideMeta, { color: theme.subtext }]}> 
                  {heroSummary.focusCount} focus areas
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsScroll}
          style={styles.sectionBlock}
        >
          {statsCards.map((stat) => (
            <View
              key={`stat-${stat.key}`}
              style={[styles.quickStatCard, { borderColor: theme.border, backgroundColor: "transparent" }]}
            >
              <View style={[styles.quickStatIcon, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                <Feather name={stat.icon} size={13} color={theme.subtext} />
              </View>
              <Text style={[styles.quickStatValue, { color: theme.text }]}>{stat.value}</Text>
              <Text style={[styles.quickStatLabel, { color: theme.subtext }]}>{stat.label}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.searchWrap, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
          <Feather name="search" size={16} color={theme.subtext} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search plans, coaches, goals or focus areas"
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

        {!searchText.trim() ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trendingRow}
            style={{ marginTop: 10 }}
          >
            {TRENDING_QUERIES.map((chip) => (
              <TouchableOpacity
                key={`trend-${chip}`}
                onPress={() => applySuggestedSearch(chip)}
                style={[styles.trendingChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
                activeOpacity={0.85}
              >
                <Feather name="search" size={12} color={theme.subtext} />
                <Text style={[styles.trendingChipText, { color: theme.text }]}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickFilterRow}
          style={{ marginTop: 12 }}
        >
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={[styles.quickFilterChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
            activeOpacity={0.85}
          >
            <Feather name="user" size={12} color={theme.subtext} />
            <Text style={[styles.quickFilterChipText, { color: theme.text }]}>{selectedCoachLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={[styles.quickFilterChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
            activeOpacity={0.85}
          >
            <Feather name="activity" size={12} color={theme.subtext} />
            <Text style={[styles.quickFilterChipText, { color: theme.text }]}>{selectedSportLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={[styles.quickFilterChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
            activeOpacity={0.85}
          >
            <Feather name="clock" size={12} color={theme.subtext} />
            <Text style={[styles.quickFilterChipText, { color: theme.text }]}>{selectedLengthLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={[styles.quickFilterChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
            activeOpacity={0.85}
          >
            <Feather name="target" size={12} color={theme.subtext} />
            <Text style={[styles.quickFilterChipText, { color: theme.text }]}>{selectedFocusLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={[styles.quickFilterChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
            activeOpacity={0.85}
          >
            <Feather name="bar-chart-2" size={12} color={theme.subtext} />
            <Text style={[styles.quickFilterChipText, { color: theme.text }]}>{selectedDifficultyLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={[styles.quickFilterChipPrimary, { backgroundColor: theme.primaryBg }]}
            activeOpacity={0.88}
          >
            <Feather name="sliders" size={12} color={theme.primaryText} />
            <Text style={[styles.quickFilterChipText, { color: theme.primaryText, fontWeight: "900" }]}>Filters</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionLabel, { color: theme.text }]}>By coach</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.coachScroll}
          >
            {coachDirectory.map((coach) => {
              const swatch = AVATAR_SWATCHES[coach.colorIndex] || AVATAR_SWATCHES[0];
              return (
                <TouchableOpacity
                  key={`coach-${coach.key}`}
                  onPress={() => openCoachProfile(coach)}
                  style={[styles.coachChip, { borderColor: theme.border, backgroundColor: "transparent" }]}
                  activeOpacity={0.85}
                >
                  <View style={[styles.coachAvatar, { backgroundColor: swatch }]}> 
                    <Text style={[styles.coachAvatarText, { color: "#FFFFFF" }]}>{coach.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.coachChipName, { color: theme.text }]} numberOfLines={1}>
                      {coach.label}
                    </Text>
                    <Text style={[styles.coachChipMeta, { color: theme.subtext }]}>
                      {coach.count} plan{coach.count === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={theme.subtext} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { color: theme.text, marginBottom: 0 }]}>Recommended for you</Text>
            <Text style={[styles.resultMeta, { color: theme.subtext }]}>Based on popularity + level</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.curatedRow}>
            {recommendedPlans.slice(0, 6).map((cp) => (
              <TouchableOpacity
                key={`rec-${cp.id}`}
                onPress={() => viewCoachPlan(cp)}
                style={[styles.curatedCard, { borderColor: theme.border, backgroundColor: "transparent" }]}
                activeOpacity={0.9}
              >
                <View style={styles.curatedTop}>
                  <View style={[styles.curatedSportDot, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                    <Feather name={cp.sportIcon} size={13} color={theme.text} />
                  </View>
                  <Text style={[styles.curatedDifficulty, { color: theme.subtext }]}>{cp.difficultyLabel}</Text>
                </View>
                <Text style={[styles.curatedTitle, { color: theme.text }]} numberOfLines={2}>
                  {cp.name}
                </Text>
                <Text style={[styles.curatedMeta, { color: theme.subtext }]} numberOfLines={2}>
                  {cp.weekCount} weeks • {formatSessionsPerWeek(cp.sessionsPerWeek)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { color: theme.text, marginBottom: 0 }]}>Featured plans</Text>
            <Text style={[styles.resultMeta, { color: theme.subtext }]}>Popular this week</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.curatedRow}>
            {featuredPlans.slice(0, 6).map((cp) => (
              <TouchableOpacity
                key={`feat-${cp.id}`}
                onPress={() => viewCoachPlan(cp)}
                style={[styles.curatedCard, { borderColor: theme.border, backgroundColor: "transparent" }]}
                activeOpacity={0.9}
              >
                <View style={styles.curatedTop}>
                  <View style={[styles.curatedSportDot, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                    <Feather name={cp.sportIcon} size={13} color={theme.text} />
                  </View>
                  <Text style={[styles.curatedDifficulty, { color: theme.subtext }]}> 
                    {cp.isNewThisWeek ? "New" : "Popular"}
                  </Text>
                </View>
                <Text style={[styles.curatedTitle, { color: theme.text }]} numberOfLines={2}>
                  {cp.name}
                </Text>
                <Text style={[styles.curatedMeta, { color: theme.subtext }]} numberOfLines={2}>
                  {cp.focusLabel}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.resultsHeader}>
          <Text style={[styles.resultMeta, { color: theme.subtext }]}> 
            {loading
              ? "Loading coach plans..."
              : `${sortedPlans.length} plan${sortedPlans.length === 1 ? "" : "s"} found`}
          </Text>
          <View style={styles.resultsHeaderRight}>
            <Text style={[styles.sortMeta, { color: theme.subtext }]}>Sort: {selectedSortLabel}</Text>
            {activeFilterCount > 0 ? (
              <TouchableOpacity onPress={clearAllFilters} activeOpacity={0.85}>
                <Text style={[styles.clearFiltersText, { color: theme.text }]}>Clear</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rowChipScroll}
          style={{ marginTop: 8 }}
        >
          {SORT_OPTIONS.map((option) => {
            const active = sortBy === option.key;
            return (
              <TouchableOpacity
                key={`sort-${option.key}`}
                onPress={() => setSortBy(option.key)}
                style={[
                  styles.rowChip,
                  active
                    ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                    : { borderColor: theme.border, backgroundColor: "transparent" },
                ]}
                activeOpacity={0.85}
              >
                <Text style={[styles.rowChipText, { color: active ? theme.primaryText : theme.text }]}> 
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {compareIds.length > 0 ? (
          <View style={[styles.compareBar, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
            <Text style={[styles.compareText, { color: theme.text }]}>{compareIds.length}/3 selected for compare</Text>
            <View style={styles.compareActions}>
              <TouchableOpacity onPress={() => setCompareIds([])} activeOpacity={0.85}>
                <Text style={[styles.compareClearText, { color: theme.subtext }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={comparePlans}
                style={[styles.compareBtn, { backgroundColor: theme.primaryBg }]}
                activeOpacity={0.88}
              >
                <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 12 }}>Compare</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <View style={[styles.skeletonCard, { backgroundColor: theme.card }]} />
            <View style={[styles.skeletonCard, { backgroundColor: theme.card }]} />
            <View style={[styles.skeletonCard, { backgroundColor: theme.card }]} />
          </View>
        ) : sortedPlans.length ? (
          <View style={[styles.listContent, isWide && styles.listContentGrid]}>
            {sortedPlans.map((cp) => {
              const isLocalTemplate = cp.sourceCollection === "localTemplates";
              const isUsing = String(usingCoachPlanId) === String(cp.id);
              const isSaved = savedPlanIds.includes(cp.id);
              const isCompared = compareIds.includes(cp.id);
              const canAddToCompare = isCompared || compareIds.length < 3;
              const swatch = AVATAR_SWATCHES[cp.coachColorIndex] || AVATAR_SWATCHES[0];

              return (
                <View key={`${cp.sourceCollection}_${cp.id}`} style={isWide ? styles.gridItemWrap : null}>
                  <View style={[styles.planCard, { borderColor: theme.border, backgroundColor: theme.card }]}> 
                    <View style={styles.planTopRow}>
                      <View style={styles.badgeRow}>
                        <View style={[styles.planBadge, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                          <Feather name={cp.sportIcon} size={11} color={theme.text} />
                          <Text style={[styles.planBadgeText, { color: theme.text }]}>{cp.sportLabel}</Text>
                        </View>
                        <View style={[styles.planBadge, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                          <Feather name="bar-chart-2" size={11} color={theme.subtext} />
                          <Text style={[styles.planBadgeText, { color: theme.subtext }]}>{cp.difficultyLabel}</Text>
                        </View>
                        <View
                          style={[
                            styles.planBadge,
                            { backgroundColor: cp.isNewThisWeek ? "rgba(16,185,129,0.16)" : "rgba(59,130,246,0.16)" },
                          ]}
                        >
                          <Text
                            style={[
                              styles.planBadgeText,
                              { color: cp.isNewThisWeek ? "#10B981" : "#60A5FA" },
                            ]}
                          >
                            {cp.isNewThisWeek ? "New" : "Popular"}
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => toggleSave(cp.id)}
                        style={[styles.saveBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
                        activeOpacity={0.85}
                      >
                        <Feather name="bookmark" size={13} color={isSaved ? theme.text : theme.subtext} />
                      </TouchableOpacity>
                    </View>

                    <Text style={[styles.planName, { color: theme.text }]} numberOfLines={2}>
                      {cp.name}
                    </Text>

                    {!!cp.description ? (
                      <Text style={[styles.planDescription, { color: theme.subtext }]} numberOfLines={2}>
                        {cp.description}
                      </Text>
                    ) : null}

                    <View style={styles.coachMetaRow}>
                      <View style={[styles.inlineCoachAvatar, { backgroundColor: swatch }]}> 
                        <Text style={styles.inlineCoachAvatarText}>{cp.coachInitials}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => openCoachProfile(cp)}
                        activeOpacity={0.75}
                        style={styles.coachTap}
                      >
                        <Text style={[styles.planCoach, { color: theme.subtext }]} numberOfLines={1}>
                          {cp.coachName}
                        </Text>
                        <Feather name="external-link" size={11} color={theme.subtext} />
                      </TouchableOpacity>
                      <View style={styles.ratingWrap}>
                        <Feather name="star" size={11} color="#F59E0B" />
                        <Text style={[styles.ratingText, { color: theme.subtext }]}>{cp.rating.toFixed(1)}</Text>
                      </View>
                    </View>

                    <View style={styles.metaRow}>
                      <View style={[styles.metaPill, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                        <Feather name="target" size={12} color={theme.subtext} />
                        <Text style={[styles.metaPillText, { color: theme.text }]}>{cp.focusLabel}</Text>
                      </View>
                      <View style={[styles.metaPill, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                        <Feather name="calendar" size={12} color={theme.subtext} />
                        <Text style={[styles.metaPillText, { color: theme.text }]}>{cp.weekCount} weeks</Text>
                      </View>
                      <View style={[styles.metaPill, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                        <Feather name="list" size={12} color={theme.subtext} />
                        <Text style={[styles.metaPillText, { color: theme.text }]}>{cp.sessionCount} sessions</Text>
                      </View>
                      <View style={[styles.metaPill, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
                        <Feather name="repeat" size={12} color={theme.subtext} />
                        <Text style={[styles.metaPillText, { color: theme.text }]}>
                          {formatSessionsPerWeek(cp.sessionsPerWeek)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.bestForRow}>
                      <Text style={[styles.bestForText, { color: theme.subtext }]}>{cp.bestFor}</Text>
                      <Text style={[styles.bestForAthletes, { color: theme.subtext }]}>
                        {formatAthleteCount(cp.athletesUsing)} athletes using this
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.progressTrack,
                        {
                          backgroundColor: theme.isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(100, Math.max(24, Math.round((cp.sessionsPerWeek / 6) * 100)))}%`,
                            backgroundColor: theme.primaryBg,
                          },
                        ]}
                      />
                    </View>

                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => viewCoachPlan(cp)}
                        style={[
                          styles.actionBtn,
                          { backgroundColor: "transparent", borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Feather name="eye" size={14} color={theme.text} />
                        <Text style={{ color: theme.text, fontWeight: "900", fontSize: 13 }}>View</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() =>
                          isLocalTemplate
                            ? router.push({ pathname: "/train/coach-plan-preview", params: { templateId: cp.id } })
                            : useCoachPlan(cp)
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
                          <Feather name="plus" size={14} color={theme.primaryText} />
                        )}
                        <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 13 }}>
                          {isUsing ? "Adding..." : "Use plan"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.tertiaryRow}>
                      <TouchableOpacity
                        onPress={() => {
                          if (!canAddToCompare) return;
                          toggleCompare(cp.id);
                        }}
                        disabled={!canAddToCompare}
                        style={[
                          styles.tertiaryBtn,
                          {
                            borderColor: theme.border,
                            backgroundColor: isCompared ? theme.primaryBg : "transparent",
                            opacity: canAddToCompare ? 1 : 0.45,
                          },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={{
                            color: isCompared ? theme.primaryText : theme.subtext,
                            fontWeight: "800",
                            fontSize: 12,
                          }}
                        >
                          {isCompared ? "Compared" : "Compare"}
                        </Text>
                      </TouchableOpacity>

                      {isLocalTemplate ? (
                        <TouchableOpacity
                          onPress={() =>
                            router.push({ pathname: "/train/coach-plan-preview", params: { templateId: cp.id } })
                          }
                          style={[styles.tertiaryBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
                          activeOpacity={0.85}
                        >
                          <Text style={{ color: theme.subtext, fontWeight: "800", fontSize: 12 }}>
                            Personalise
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => toggleSave(cp.id)}
                          style={[styles.tertiaryBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
                          activeOpacity={0.85}
                        >
                          <Text style={{ color: theme.subtext, fontWeight: "800", fontSize: 12 }}>
                            {isSaved ? "Saved" : "Save"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[styles.emptyWrap, { borderColor: theme.border, backgroundColor: "transparent" }]}> 
            <Feather name="search" size={20} color={theme.subtext} />
            <Text style={{ color: theme.text, fontWeight: "900", fontSize: 16, marginTop: 8 }}>
              No plans match these filters
            </Text>
            <Text style={[styles.emptyText, { color: theme.subtext }]}> 
              Try clearing some filters or explore popular plans above.
            </Text>
            <TouchableOpacity
              onPress={clearAllFilters}
              style={[styles.emptyResetBtn, { backgroundColor: theme.primaryBg }]}
              activeOpacity={0.88}
            >
              <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 13 }}>Reset filters</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        onPress={() => setFiltersOpen(true)}
        style={[styles.floatingFilterBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
        activeOpacity={0.9}
      >
        <Feather name="sliders" size={15} color={theme.text} />
        <Text style={[styles.floatingFilterText, { color: theme.text }]}>Filters</Text>
      </TouchableOpacity>

      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setFiltersOpen(false)} />
          <View style={[styles.modalSheet, { backgroundColor: theme.bg, borderColor: theme.border }]}> 
            <View style={[styles.modalHeader, { borderColor: theme.border }]}> 
              <Text style={[styles.modalTitle, { color: theme.text }]}>Advanced Filters</Text>
              <TouchableOpacity onPress={() => setFiltersOpen(false)} activeOpacity={0.85}>
                <Feather name="x" size={18} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalContent}>
              <View style={styles.modalGroup}>
                <Text style={[styles.modalGroupTitle, { color: theme.text }]}>Coach</Text>
                <View style={styles.chipWrap}>
                  {coachFilterOptions.map((opt) => {
                    const active = draftFilters.coachFilter === opt.key;
                    return (
                      <TouchableOpacity
                        key={`m-coach-${opt.key}`}
                        onPress={() => setDraftFilters((prev) => ({ ...prev, coachFilter: opt.key }))}
                        style={[
                          styles.rowChip,
                          active
                            ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                            : { borderColor: theme.border, backgroundColor: "transparent" },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.rowChipText, { color: active ? theme.primaryText : theme.text }]}> 
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalGroup}>
                <Text style={[styles.modalGroupTitle, { color: theme.text }]}>Sport</Text>
                <View style={styles.chipWrap}>
                  {sportOptions.map((opt) => {
                    const active = draftFilters.sportFilter === opt.key;
                    return (
                      <TouchableOpacity
                        key={`m-sport-${opt.key}`}
                        onPress={() => setDraftFilters((prev) => ({ ...prev, sportFilter: opt.key }))}
                        style={[
                          styles.tagChip,
                          active
                            ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                            : { borderColor: theme.border, backgroundColor: "transparent" },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Feather name={opt.icon} size={13} color={active ? theme.primaryText : theme.text} />
                        <Text style={[styles.tagChipText, { color: active ? theme.primaryText : theme.text }]}> 
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalGroup}>
                <Text style={[styles.modalGroupTitle, { color: theme.text }]}>Plan length</Text>
                <View style={styles.chipWrap}>
                  {lengthOptions.map((opt) => {
                    const active = draftFilters.lengthFilter === opt.key;
                    return (
                      <TouchableOpacity
                        key={`m-length-${opt.key}`}
                        onPress={() => setDraftFilters((prev) => ({ ...prev, lengthFilter: opt.key }))}
                        style={[
                          styles.rowChip,
                          active
                            ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                            : { borderColor: theme.border, backgroundColor: "transparent" },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.rowChipText, { color: active ? theme.primaryText : theme.text }]}> 
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalGroup}>
                <Text style={[styles.modalGroupTitle, { color: theme.text }]}>Focus</Text>
                <View style={styles.chipWrap}>
                  {focusOptions.map((opt) => {
                    const active = draftFilters.focusFilter === opt.key;
                    return (
                      <TouchableOpacity
                        key={`m-focus-${opt.key}`}
                        onPress={() => setDraftFilters((prev) => ({ ...prev, focusFilter: opt.key }))}
                        style={[
                          styles.rowChip,
                          active
                            ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                            : { borderColor: theme.border, backgroundColor: "transparent" },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.rowChipText, { color: active ? theme.primaryText : theme.text }]}> 
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalGroup}>
                <Text style={[styles.modalGroupTitle, { color: theme.text }]}>Difficulty</Text>
                <View style={styles.chipWrap}>
                  {difficultyOptions.map((opt) => {
                    const active = draftFilters.difficultyFilter === opt.key;
                    return (
                      <TouchableOpacity
                        key={`m-difficulty-${opt.key}`}
                        onPress={() => setDraftFilters((prev) => ({ ...prev, difficultyFilter: opt.key }))}
                        style={[
                          styles.rowChip,
                          active
                            ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                            : { borderColor: theme.border, backgroundColor: "transparent" },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.rowChipText, { color: active ? theme.primaryText : theme.text }]}> 
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalGroup}>
                <Text style={[styles.modalGroupTitle, { color: theme.text }]}>Sort</Text>
                <View style={styles.chipWrap}>
                  {SORT_OPTIONS.map((opt) => {
                    const active = draftFilters.sortBy === opt.key;
                    return (
                      <TouchableOpacity
                        key={`m-sort-${opt.key}`}
                        onPress={() => setDraftFilters((prev) => ({ ...prev, sortBy: opt.key }))}
                        style={[
                          styles.rowChip,
                          active
                            ? { borderColor: "rgba(0,0,0,0)", backgroundColor: theme.primaryBg }
                            : { borderColor: theme.border, backgroundColor: "transparent" },
                        ]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.rowChipText, { color: active ? theme.primaryText : theme.text }]}> 
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>

            <View style={[styles.modalFooter, { borderColor: theme.border }]}> 
              <TouchableOpacity
                onPress={() => {
                  setDraftFilters({
                    coachFilter: "all",
                    sportFilter: "all",
                    lengthFilter: "all",
                    focusFilter: "all",
                    difficultyFilter: "all",
                    sortBy: "recommended",
                  });
                }}
                style={[styles.modalSecondaryBtn, { borderColor: theme.border, backgroundColor: "transparent" }]}
                activeOpacity={0.85}
              >
                <Text style={{ color: theme.text, fontWeight: "800", fontSize: 13 }}>Clear</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={applyDraftFilters}
                style={[styles.modalPrimaryBtn, { backgroundColor: theme.primaryBg }]}
                activeOpacity={0.88}
              >
                <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 13 }}>
                  Apply ({draftResultCount})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerFilterBtn: {
    minHeight: 34,
    minWidth: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  headerFilterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
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
  heroShell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    overflow: "hidden",
  },
  heroGradient: {
    padding: 16,
    gap: 14,
    position: "relative",
  },
  heroGlowOne: {
    position: "absolute",
    right: -40,
    top: -30,
    width: 160,
    height: 160,
    borderRadius: 999,
  },
  heroGlowTwo: {
    position: "absolute",
    left: -50,
    bottom: -70,
    width: 180,
    height: 180,
    borderRadius: 999,
  },
  heroBadge: {
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  heroMainRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  heroHeadline: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.1,
  },
  heroRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  heroSubtitle: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  heroSideCard: {
    width: 130,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
    alignItems: "flex-start",
    gap: 4,
  },
  heroSideImageWrap: {
    width: "100%",
    height: 68,
    borderRadius: 11,
    overflow: "hidden",
    marginBottom: 2,
  },
  heroSideImage: {
    width: "100%",
    height: "100%",
  },
  heroSideLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  heroSideValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  heroSideMeta: {
    fontSize: 11,
    fontWeight: "700",
  },
  heroStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  heroStatPill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  heroStatValue: {
    fontSize: 16,
    fontWeight: "900",
  },
  heroStatLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  searchWrap: {
    marginTop: 12,
    minHeight: 50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 0,
  },
  statsScroll: {
    gap: 8,
    paddingRight: 12,
  },
  quickStatCard: {
    minWidth: 122,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 5,
  },
  quickStatIcon: {
    width: 22,
    height: 22,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  quickStatValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  quickStatLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  trendingRow: {
    gap: 8,
    paddingRight: 10,
  },
  trendingChip: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  trendingChipText: {
    fontSize: 12,
    fontWeight: "800",
  },
  quickFilterRow: {
    gap: 8,
    paddingRight: 14,
  },
  quickFilterChip: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickFilterChipPrimary: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickFilterChipText: {
    fontSize: 12,
    fontWeight: "800",
  },
  sectionBlock: {
    marginTop: 14,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  curatedRow: {
    gap: 10,
    paddingRight: 12,
    paddingTop: 8,
  },
  curatedCard: {
    width: 210,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 7,
  },
  curatedTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  curatedSportDot: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  curatedDifficulty: {
    fontSize: 11,
    fontWeight: "800",
  },
  curatedTitle: {
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },
  curatedMeta: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  coachScroll: {
    gap: 8,
    paddingRight: 10,
  },
  coachChip: {
    width: 166,
    minHeight: 64,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  coachAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  coachAvatarText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  coachChipName: {
    fontSize: 13,
    fontWeight: "900",
  },
  coachChipMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tagChipText: {
    fontSize: 12,
    fontWeight: "900",
  },
  rowChipScroll: {
    gap: 8,
    paddingRight: 10,
  },
  rowChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rowChipText: {
    fontSize: 12,
    fontWeight: "900",
  },
  resultsHeader: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  resultMeta: {
    fontSize: 12,
    fontWeight: "700",
  },
  resultsHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sortMeta: {
    fontSize: 12,
    fontWeight: "700",
  },
  clearFiltersText: {
    fontSize: 12,
    fontWeight: "900",
  },
  loadingWrap: {
    minHeight: 220,
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: 10,
    marginTop: 10,
  },
  skeletonCard: {
    borderRadius: 16,
    minHeight: 160,
    opacity: 0.55,
  },
  listContent: {
    marginTop: 10,
    gap: 10,
  },
  listContentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gridItemWrap: {
    width: "48.8%",
  },
  planCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  planTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    flex: 1,
  },
  planBadge: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  planBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  saveBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  sportDot: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  planName: {
    fontSize: 15,
    fontWeight: "900",
  },
  coachMetaRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  ratingWrap: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: "700",
  },
  coachTap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: "92%",
  },
  inlineCoachAvatar: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineCoachAvatarText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
  },
  planCoach: {
    fontSize: 12,
    fontWeight: "800",
  },
  sourcePill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sourcePillText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  planDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  metaPill: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  bestForRow: {
    gap: 4,
  },
  bestForText: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  bestForAthletes: {
    fontSize: 11,
    fontWeight: "700",
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
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
  tertiaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  tertiaryBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  compareBar: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  compareText: {
    fontSize: 12,
    fontWeight: "800",
  },
  compareActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  compareClearText: {
    fontSize: 12,
    fontWeight: "800",
  },
  compareBtn: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 16,
    alignItems: "flex-start",
  },
  emptyText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  emptyResetBtn: {
    marginTop: 12,
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  floatingFilterBtn: {
    position: "absolute",
    right: 16,
    bottom: 24,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 38,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  floatingFilterText: {
    fontSize: 12,
    fontWeight: "900",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  modalSheet: {
    maxHeight: "86%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  modalHeader: {
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "900",
  },
  modalContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 14,
  },
  modalGroup: {
    gap: 8,
  },
  modalGroupTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  modalFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    gap: 8,
  },
  modalSecondaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPrimaryBtn: {
    flex: 1.3,
    minHeight: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
