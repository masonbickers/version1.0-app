// app/(protected)/me/calendar.jsx
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

import { useTheme } from "../../../providers/ThemeProvider";

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
function isoKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function formatWeekRange(weekStart) {
  const start = new Date(weekStart);
  const end = addDays(start, 6);
  const s = start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const e = end.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${s} – ${e}`;
}
function formatDow(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
}
function formatDayNum(d) {
  return d.toLocaleDateString("en-GB", { day: "2-digit" });
}
function todayKey() {
  return isoKey(new Date());
}
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
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

/* ─────────────────────────────────────────────
   Storage keys
───────────────────────────────────────────── */
const CAL_STORAGE_KEY = "trainr_me_calendar_v1"; // manual items
const STRAVA_CACHE_KEY = "trainr_strava_acts_cache_v1"; // ✅ cached Strava list
const STRAVA_CACHE_META_KEY = "trainr_strava_acts_cache_meta_v1"; // { updatedAt }

/* ─────────────────────────────────────────────
   Types
   Local calendar item:
   { id, dayKey, type: "Workout"|"Note", title, detail, createdAt }
   Cached Strava item:
   { id, dayKey, type, title, minutes, distanceKm, when }
───────────────────────────────────────────── */
function makeId() {
  return `cal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MeCalendarPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#E6FF3B";
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // week navigation
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()));

  // local items cache (all)
  const [items, setItems] = useState([]);

  // ✅ Strava cached + live items
  const [hasStravaToken, setHasStravaToken] = useState(false);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaError, setStravaError] = useState("");
  const [stravaActs, setStravaActs] = useState([]); // cached or live

  // add modal
  const [addOpen, setAddOpen] = useState(false);
  const [addDayKey, setAddDayKey] = useState(() => isoKey(new Date()));
  const [addType, setAddType] = useState("Workout"); // Workout | Note
  const [addTitle, setAddTitle] = useState("");
  const [addDetail, setAddDetail] = useState("");

  // view modal (day drilldown)
  const [dayOpen, setDayOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  const s = makeStyles(colors, isDark, accent);
  const { width } = Dimensions.get("window");

  /* ─────────────────────────────────────────────
     Local calendar items
  ────────────────────────────────────────────── */
  const loadItems = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(CAL_STORAGE_KEY);
      const parsed = safeJsonParse(raw || "");
      const arr = Array.isArray(parsed) ? parsed : [];
      setItems(arr);
    } catch (e) {
      console.warn("calendar load error", e);
      setItems([]);
    }
  }, []);

  const saveItems = useCallback(async (next) => {
    try {
      setItems(next);
      await AsyncStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("calendar save error", e);
    }
  }, []);

  /* ─────────────────────────────────────────────
     ✅ Strava offline cache
     - load cache immediately
     - then attempt refresh if token exists
  ────────────────────────────────────────────── */
  const loadStravaCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STRAVA_CACHE_KEY);
      const parsed = safeJsonParse(raw || "");
      const arr = Array.isArray(parsed) ? parsed : [];
      setStravaActs(arr);
    } catch (e) {
      console.warn("strava cache load error", e);
      setStravaActs([]);
    }
  }, []);

  const saveStravaCache = useCallback(async (nextArr) => {
    try {
      setStravaActs(nextArr);
      await AsyncStorage.setItem(STRAVA_CACHE_KEY, JSON.stringify(nextArr));
      await AsyncStorage.setItem(
        STRAVA_CACHE_META_KEY,
        JSON.stringify({ updatedAt: Date.now() })
      );
    } catch (e) {
      console.warn("strava cache save error", e);
    }
  }, []);

  const refreshStrava = useCallback(async () => {
    try {
      setStravaError("");
      setStravaLoading(true);

      const token = await AsyncStorage.getItem("strava_access_token");
      if (!token) {
        setHasStravaToken(false);
        // keep whatever cache we had; don’t wipe unless you want to
        return;
      }
      setHasStravaToken(true);

      // pull enough history to cover navigation (e.g. past 12 weeks)
      const after = Math.floor(addDays(new Date(), -90).getTime() / 1000);

      const resp = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn("Strava calendar refresh error", resp.status, text);
        // ✅ Offline / network fail: just keep cache visible
        setStravaError("Couldn’t refresh Strava. Showing cached data.");
        return;
      }

      const raw = await resp.json();
      const safe = Array.isArray(raw) ? raw : [];

      const mapped = safe
        .map((a) => {
          const when = a.start_date_local || a.start_date;
          const d = when ? new Date(when) : null;
          const k = d && !Number.isNaN(d.getTime()) ? isoKey(d) : "";
          if (!k) return null;

          return {
            id: String(a.id),
            dayKey: k,
            when,
            type: normaliseType(a.type || "Workout"),
            title: a.name || a.type || "Session",
            minutes: Math.round((Number(a.moving_time || 0) || 0) / 60),
            distanceKm: (Number(a.distance || 0) || 0) / 1000,
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

      await saveStravaCache(mapped);
    } catch (e) {
      console.warn("Strava calendar refresh exception", e);
      setStravaError("Couldn’t refresh Strava. Showing cached data.");
    } finally {
      setStravaLoading(false);
    }
  }, [saveStravaCache]);

  /* ─────────────────────────────────────────────
     Initial load
  ────────────────────────────────────────────── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // load local + cached first (instant UI), then attempt network refresh
      await Promise.all([loadItems(), loadStravaCache()]);
      await refreshStrava();
    } finally {
      setLoading(false);
    }
  }, [loadItems, loadStravaCache, refreshStrava]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadItems(), refreshStrava()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadItems, refreshStrava]);

  /* ─────────────────────────────────────────────
     Week + grouping
  ────────────────────────────────────────────── */
  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);
  const weekLabel = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const itemsByDay = useMemo(() => {
    const by = {};
    items.forEach((it) => {
      const k = String(it.dayKey || "");
      if (!k) return;
      if (!by[k]) by[k] = [];
      by[k].push(it);
    });
    Object.keys(by).forEach((k) => {
      by[k].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    });
    return by;
  }, [items]);

  const stravaByDay = useMemo(() => {
    const by = {};
    stravaActs.forEach((a) => {
      const k = String(a.dayKey || "");
      if (!k) return;
      if (!by[k]) by[k] = [];
      by[k].push(a);
    });
    Object.keys(by).forEach((k) => {
      by[k].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    });
    return by;
  }, [stravaActs]);

  // For each day card: show Strava first if present, otherwise manual item
  const topLineForDay = useCallback(
    (k) => {
      const sActs = stravaByDay[k] || [];
      const mItems = itemsByDay[k] || [];

      if (sActs.length) {
        const top = sActs[0];
        const secondary = sActs.length - 1;
        return {
          source: "strava",
          tag: top.type,
          title: top.title,
          secondaryCount: secondary,
        };
      }
      if (mItems.length) {
        const top = mItems[0];
        const secondary = mItems.length - 1;
        return {
          source: "manual",
          tag: top.type,
          title: top.title,
          secondaryCount: secondary,
        };
      }
      return null;
    },
    [itemsByDay, stravaByDay]
  );

  const openAddForDay = useCallback((k) => {
    setAddDayKey(k);
    setAddType("Workout");
    setAddTitle("");
    setAddDetail("");
    setAddOpen(true);
  }, []);

  const openDay = useCallback((k) => {
    setSelectedDayKey(k);
    setDayOpen(true);
  }, []);

  const addItem = useCallback(async () => {
    const title = addTitle.trim();
    const detail = addDetail.trim();
    if (!title) return;

    const next = [
      { id: makeId(), dayKey: addDayKey, type: addType, title, detail, createdAt: Date.now() },
      ...items,
    ];

    await saveItems(next);
    setAddOpen(false);
  }, [addDayKey, addType, addTitle, addDetail, items, saveItems]);

  const deleteItem = useCallback(async (id) => {
    const next = items.filter((x) => x.id !== id);
    await saveItems(next);
  }, [items, saveItems]);

  const clearDay = useCallback(async (k) => {
    const next = items.filter((x) => x.dayKey !== k);
    await saveItems(next);
  }, [items, saveItems]);

  const selectedDayManualItems = useMemo(() => {
    if (!selectedDayKey) return [];
    return itemsByDay[selectedDayKey] || [];
  }, [itemsByDay, selectedDayKey]);

  const selectedDayStravaItems = useMemo(() => {
    if (!selectedDayKey) return [];
    return stravaByDay[selectedDayKey] || [];
  }, [stravaByDay, selectedDayKey]);

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

                  <TouchableOpacity onPress={() => openAddForDay(todayKey())} style={s.iconButtonGhost} activeOpacity={0.8}>
                    <Feather name="plus" size={18} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.heroMainRow}>
                <View style={s.heroTextCol}>
                  <Text style={s.heroBadge}>CALENDAR</Text>
                  <Text style={s.heroName}>Your week</Text>
                  <Text style={s.heroSub}>{weekLabel}</Text>

                  {/* ✅ Strava status */}
                  <View style={{ marginTop: 8 }}>
                    {hasStravaToken ? (
                      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>
                        Strava: {stravaLoading ? "refreshing…" : "cached + synced"}
                        {stravaError ? ` · ${stravaError}` : ""}
                      </Text>
                    ) : (
                      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "800" }}>
                        Strava: not connected (showing manual items only)
                      </Text>
                    )}
                  </View>
                </View>
              </View>

              {/* WEEK NAV */}
              <View style={s.weekNavRow}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setWeekStart((w) => addDays(w, -7))}
                  style={[s.weekNavBtn, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}
                >
                  <Feather name="chevron-left" size={18} color={colors.text} />
                  <Text style={[s.weekNavText, { color: colors.text }]}>Prev</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setWeekStart(startOfWeekMonday(new Date()))}
                  style={[s.weekNavBtn, { backgroundColor: accent }]}
                >
                  <Feather name="calendar" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
                  <Text style={[s.weekNavText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>This week</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setWeekStart((w) => addDays(w, 7))}
                  style={[s.weekNavBtn, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}
                >
                  <Text style={[s.weekNavText, { color: colors.text }]}>Next</Text>
                  <Feather name="chevron-right" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>

          {/* WEEK GRID */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={s.sectionIcon}>
                  <Feather name="grid" size={16} color={colors.text} />
                </View>
                <Text style={s.sectionTitle}>Week overview</Text>
              </View>

              <TouchableOpacity onPress={() => openAddForDay(todayKey())} style={s.refreshBtn} activeOpacity={0.85}>
                <Feather name="plus" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={{ paddingVertical: 18 }}>
                <ActivityIndicator />
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : (
              <View style={s.grid}>
                {days.map((d) => {
                  const k = isoKey(d);
                  const isToday = k === todayKey();

                  const top = topLineForDay(k);
                  const manualCount = (itemsByDay[k] || []).length;
                  const stravaCount = (stravaByDay[k] || []).length;
                  const totalCount = manualCount + stravaCount;

                  return (
                    <TouchableOpacity
                      key={k}
                      activeOpacity={0.92}
                      onPress={() => openDay(k)}
                      onLongPress={() => openAddForDay(k)}
                      style={[
                        s.dayCard,
                        {
                          width: (width - 36 - 12) / 2,
                          backgroundColor: isDark ? "#111217" : (colors.sapSilverLight || colors.card),
                        },
                        isToday && { borderColor: accent, borderWidth: 2 },
                      ]}
                    >
                      <View style={s.dayTopRow}>
                        <Text style={[s.dayDow, { color: colors.subtext }]}>{formatDow(d)}</Text>
                        <Text style={[s.dayNum, { color: colors.text }]}>{formatDayNum(d)}</Text>
                      </View>

                      {totalCount === 0 ? (
                        <View style={{ marginTop: 10 }}>
                          <Text style={s.dayEmpty}>No items</Text>
                          <Text style={s.dayHint}>Long-press to add</Text>
                        </View>
                      ) : (
                        <View style={{ marginTop: 10 }}>
                          {!!top && (
                            <>
                              <View style={s.tagRow}>
                                <View style={[s.tag, { backgroundColor: accent }]}>
                                  <Text style={[s.tagText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>
                                    {top.tag}
                                  </Text>
                                </View>
                                {top.source === "strava" ? (
                                  <View style={[s.tag, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}>
                                    <Text style={[s.tagText, { color: colors.text }]}>STRAVA</Text>
                                  </View>
                                ) : null}
                              </View>

                              <Text style={[s.dayTitle, { color: colors.text }]} numberOfLines={2}>
                                {top.title}
                              </Text>
                            </>
                          )}

                          {totalCount > 1 ? <Text style={s.moreText}>+{totalCount - 1} more</Text> : null}
                        </View>
                      )}

                      <View style={s.dayActions}>
                        <TouchableOpacity
                          onPress={() => openAddForDay(k)}
                          activeOpacity={0.9}
                          style={[s.miniBtn, { backgroundColor: accent }]}
                        >
                          <Feather name="plus" size={14} color={colors.sapOnPrimary || "#0B0B0B"} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => openDay(k)}
                          activeOpacity={0.9}
                          style={[s.miniBtn, { backgroundColor: isDark ? "#18191E" : "#E6E7EC" }]}
                        >
                          <Feather name="chevron-right" size={14} color={colors.text} />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={s.hint}>
              Tap a day to view details (Strava + manual). Long-press a day to add a manual item.
            </Text>
          </View>

          <View style={{ height: 26 }} />
        </ScrollView>

        {/* ADD ITEM SHEET */}
        <AddItemSheet
          open={addOpen}
          onClose={() => setAddOpen(false)}
          colors={colors}
          isDark={isDark}
          accent={accent}
          dayKey={addDayKey}
          type={addType}
          setType={setAddType}
          title={addTitle}
          setTitle={setAddTitle}
          detail={addDetail}
          setDetail={setAddDetail}
          onAdd={addItem}
        />

        {/* DAY SHEET */}
        <DaySheet
          open={dayOpen}
          onClose={() => setDayOpen(false)}
          colors={colors}
          isDark={isDark}
          accent={accent}
          dayKey={selectedDayKey}
          stravaItems={selectedDayStravaItems}
          manualItems={selectedDayManualItems}
          onAdd={() => openAddForDay(selectedDayKey || todayKey())}
          onDeleteManual={deleteItem}
          onClearManualDay={() => selectedDayKey && clearDay(selectedDayKey)}
          onOpenStravaActivity={(id) => {
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
   Add item sheet (unchanged, self-contained)
───────────────────────────────────────────── */
function AddItemSheet({
  open,
  onClose,
  colors,
  isDark,
  accent,
  dayKey,
  type,
  setType,
  title,
  setTitle,
  detail,
  setDetail,
  onAdd,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.72);

  const dayLabel = useMemo(() => {
    const d = new Date(dayKey);
    if (Number.isNaN(d.getTime())) return dayKey || "";
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  }, [dayKey]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>Add to {dayLabel}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                Manual calendar items are stored offline.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            {["Workout", "Note"].map((t) => {
              const active = type === t;
              return (
                <TouchableOpacity
                  key={t}
                  activeOpacity={0.9}
                  onPress={() => setType(t)}
                  style={[
                    stylesGlobal.pill,
                    { backgroundColor: active ? accent : (isDark ? "#18191E" : "#E6E7EC") },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? (colors.sapOnPrimary || "#0B0B0B") : colors.text,
                      fontWeight: "900",
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          <FieldBlock
            label={type === "Workout" ? "Session title" : "Note title"}
            value={title}
            onChangeText={setTitle}
            colors={colors}
            isDark={isDark}
          />
          <FieldBlock
            label="Details (optional)"
            value={detail}
            onChangeText={setDetail}
            colors={colors}
            isDark={isDark}
            multiline
          />

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={onAdd}
            disabled={!title.trim()}
            style={[
              stylesGlobal.cta,
              { backgroundColor: accent, marginTop: 16, opacity: title.trim() ? 1 : 0.6 },
            ]}
          >
            <Feather name="check" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
            <Text style={[stylesGlobal.ctaText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function FieldBlock({ label, value, onChangeText, colors, isDark, multiline }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: colors.subtext, fontSize: 12, fontWeight: "900" }}>{label}</Text>
      <View
        style={{
          marginTop: 8,
          borderRadius: 18,
          backgroundColor: isDark ? "#111217" : "#F3F4F6",
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <TextInputShim
          value={value}
          onChangeText={onChangeText}
          placeholder="Type…"
          placeholderTextColor={colors.subtext}
          multiline={!!multiline}
          style={{
            color: colors.text,
            fontSize: 16,
            fontWeight: "900",
            minHeight: multiline ? 88 : undefined,
            textAlignVertical: multiline ? "top" : "center",
          }}
        />
      </View>
    </View>
  );
}

/* Tiny shim so we can keep file self-contained without importing TextInput above */
function TextInputShim(props) {
  const { TextInput } = require("react-native");
  return <TextInput {...props} />;
}

/* ─────────────────────────────────────────────
   Day sheet — shows Strava + Manual
   - Manual items can be deleted/cleared
   - Strava items tap to open /me/activity/[id]
───────────────────────────────────────────── */
function DaySheet({
  open,
  onClose,
  colors,
  isDark,
  accent,
  dayKey,
  stravaItems,
  manualItems,
  onAdd,
  onDeleteManual,
  onClearManualDay,
  onOpenStravaActivity,
}) {
  const { height } = Dimensions.get("window");
  const sheetMaxH = Math.round(height * 0.82);

  const dayLabel = useMemo(() => {
    const d = new Date(dayKey || "");
    if (!dayKey || Number.isNaN(d.getTime())) return dayKey || "Day";
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" });
  }, [dayKey]);

  const total = (stravaItems?.length || 0) + (manualItems?.length || 0);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={stylesGlobal.backdrop} onPress={onClose} />
      <View style={[stylesGlobal.sheet, { backgroundColor: isDark ? "#0E0F14" : "#FFFFFF", maxHeight: sheetMaxH }]}>
        <View style={stylesGlobal.sheetTop}>
          <View style={stylesGlobal.sheetHandle(isDark)} />
          <View style={stylesGlobal.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[stylesGlobal.sheetTitle, { color: colors.text }]}>{dayLabel}</Text>
              <Text style={[stylesGlobal.sheetSub, { color: colors.subtext }]}>
                {total ? `${total} item(s)` : "No items yet"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={stylesGlobal.closeBtn(isDark)} activeOpacity={0.85}>
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onAdd}
              style={[stylesGlobal.ctaSmall, { backgroundColor: accent, flex: 1 }]}
            >
              <Feather name="plus" size={16} color={colors.sapOnPrimary || "#0B0B0B"} />
              <Text style={[stylesGlobal.ctaSmallText, { color: colors.sapOnPrimary || "#0B0B0B" }]}>Add</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={onClearManualDay}
              style={[stylesGlobal.ctaSmall, { backgroundColor: isDark ? "#18191E" : "#E6E7EC", flex: 1 }]}
            >
              <Feather name="trash-2" size={16} color={colors.text} />
              <Text style={[stylesGlobal.ctaSmallText, { color: colors.text }]}>Clear manual</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 20 }}>
          {/* STRAVA */}
          <Text style={sheetStyles.sectionLabel(colors)}>Strava</Text>
          {stravaItems?.length ? (
            stravaItems.slice(0, 20).map((a) => (
              <TouchableOpacity
                key={a.id}
                activeOpacity={0.9}
                onPress={() => onOpenStravaActivity?.(a.id)}
                style={[
                  sheetStyles.row(isDark),
                  { borderColor: isDark ? "#1F2128" : "#E1E3E8" },
                ]}
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
            <Text style={{ color: colors.subtext, fontSize: 13, lineHeight: 18 }}>
              No Strava sessions on this day.
            </Text>
          )}

          {/* MANUAL */}
          <Text style={[sheetStyles.sectionLabel(colors), { marginTop: 18 }]}>Manual</Text>
          {manualItems?.length ? (
            manualItems.map((it) => (
              <View
                key={it.id}
                style={{
                  marginTop: 12,
                  borderRadius: 18,
                  padding: 14,
                  backgroundColor: isDark ? "#111217" : "#F3F4F6",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: accent }}>
                        <Text style={{ fontWeight: "900", fontSize: 11, color: colors.sapOnPrimary || "#0B0B0B" }}>
                          {it.type}
                        </Text>
                      </View>
                      <Text style={{ color: colors.text, fontWeight: "900", fontSize: 14 }} numberOfLines={1}>
                        {it.title}
                      </Text>
                    </View>

                    {it.detail ? (
                      <Text style={{ marginTop: 8, color: colors.subtext, fontWeight: "700", lineHeight: 18 }}>
                        {it.detail}
                      </Text>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    onPress={() => onDeleteManual?.(it.id)}
                    activeOpacity={0.85}
                    style={stylesGlobal.iconBtnDanger}
                  >
                    <Feather name="trash-2" size={16} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <Text style={{ marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 }}>
              No manual items for this day.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const sheetStyles = {
  sectionLabel: (colors) => ({
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
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
    heroBadge: { fontSize: 11, fontWeight: "900", color: colors.subtextSoft || colors.subtext, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2 },
    heroName: { fontSize: 22, fontWeight: "900", color: colors.text },
    heroSub: { fontSize: 13, color: colors.subtext, marginTop: 3 },

    weekNavRow: { flexDirection: "row", gap: 10, marginTop: 14 },
    weekNavBtn: {
      borderRadius: 999,
      paddingVertical: 11,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      flex: 1,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
    weekNavText: { fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },

    section: { paddingHorizontal: 18, marginTop: 18 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionIcon: { width: 28, height: 28, borderRadius: 12, backgroundColor: isDark ? "#18191E" : "#E6E7EC", alignItems: "center", justifyContent: "center" },
    sectionTitle: { fontSize: 14, fontWeight: "900", color: colors.text, textTransform: "uppercase", letterSpacing: 0.7 },
    refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.sapSilverMedium || colors.border, backgroundColor: colors.sapSilverLight || colors.card },

    hint: { marginTop: 10, color: colors.subtext, fontSize: 13, lineHeight: 18 },
    loadingText: { marginTop: 8, textAlign: "center", color: colors.subtext, fontSize: 12 },

    grid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 12 },
    dayCard: {
      borderRadius: 22,
      padding: 14,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      ...Platform.select({ android: { elevation: 1 } }),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "#1F2128" : (colors.sapSilverMedium || "#E1E3E8"),
      minHeight: 140,
    },
    dayTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    dayDow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
    dayNum: { fontSize: 18, fontWeight: "900" },

    dayEmpty: { color: colors.subtext, fontWeight: "900", fontSize: 13 },
    dayHint: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    tagRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
    tag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: "flex-start" },
    tagText: { fontWeight: "900", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 },

    dayTitle: { fontWeight: "900", fontSize: 15, lineHeight: 19 },
    moreText: { marginTop: 6, color: colors.subtext, fontWeight: "800", fontSize: 12 },

    dayActions: { position: "absolute", right: 12, bottom: 12, flexDirection: "row", gap: 8 },
    miniBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      ...Platform.select({ android: { elevation: 1 } }),
    },
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

  pill: { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: "center", justifyContent: "center" },

  cta: { borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },

  ctaSmall: { borderRadius: 999, paddingVertical: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaSmallText: { fontSize: 13, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase" },

  iconBtnDanger: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#EF44441A" },
});
