"use client";

/**
 * app/(protected)/training/session/[sessionKey]/live.jsx
 * Live Session — runSteps auto-advance (time-based), Lap to split/advance, minimise steps panel
 *
 * ✅ Supports:
 * - Runs with Garmin-style `session.runSteps` (warmup/work/rest/cooldown)
 * - Auto-advance for time steps
 * - Manual Next for distance/open steps (until GPS is added)
 * - Lap button to split current step + optionally advance
 * - Minimise/expand steps panel
 * - Saves a session log to Firestore
 *
 * Firestore (suggested):
 * - users/{uid}/sessionLogs/{logId}
 *
 * Session template resolution:
 * - If params.planId provided: loads users/{uid}/trainingPlans/{planId} and searches for session.id === sessionKey
 * - Else: tries users/{uid}/plannedSessions/{sessionKey} (optional collection if you use it)
 *
 * NOTE:
 * If you don’t have users/{uid}/plannedSessions, just pass planId when navigating:
 * router.push({ pathname: `/training/session/${sessionId}/live`, params: { planId } })
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    addDoc,
    collection,
    doc,
    getDoc,
    serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../../../../../../firebaseConfig";
import { useTheme } from "../../../../../../providers/ThemeProvider";

/* ---------------- helpers ---------------- */
function safeStr(v) {
  return String(v ?? "").trim();
}
function asArr(x) {
  return Array.isArray(x) ? x : [];
}
function isObj(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function toNum(v, fallback = undefined) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function uidOrThrow() {
  const u = auth.currentUser;
  if (!u) throw new Error("Please sign in again.");
  return u.uid;
}
function msToClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function secToClock(sec) {
  return msToClock((toNum(sec, 0) ?? 0) * 1000);
}
function stepLabel(step) {
  const t = safeStr(step?.type) || "work";
  if (t === "warmup") return "Warm-up";
  if (t === "cooldown") return "Cool-down";
  if (t === "rest") return "Rest";
  return "Work";
}
function durationText(step) {
  const d = isObj(step?.duration) ? step.duration : {};
  const type = safeStr(d?.type) || "open";
  const value = toNum(d?.value, undefined);
  if (type === "time" && Number.isFinite(value)) return `${Math.round(value)}s`;
  if (type === "distance" && Number.isFinite(value)) return `${Math.round(value)}m`;
  return "Open";
}
function targetText(step) {
  const t = isObj(step?.target) ? step.target : {};
  const type = safeStr(t?.type) || "open";
  const value = safeStr(t?.value);
  const low = safeStr(t?.low);
  const high = safeStr(t?.high);

  if (type === "pace") {
    if (value) return `Pace ${value}`;
    if (low || high) return `Pace ${low || "…"}–${high || "…"}`;
    return "Pace";
  }
  if (type === "hr") {
    if (value) return `HR ${value}`;
    if (low || high) return `HR ${low || "…"}–${high || "…"}`;
    return "HR";
  }
  if (type === "effort") {
    if (value) return `Effort ${value}`;
    if (low || high) return `Effort ${low || "…"}–${high || "…"}`;
    return "Effort";
  }
  return value ? value : "Open";
}

/* ---------------- session resolution ---------------- */
async function fetchSessionTemplate({ uid, sessionKey, planId }) {
  // 1) Optional: plannedSessions doc (if you use it)
  try {
    const plannedRef = doc(db, "users", uid, "plannedSessions", sessionKey);
    const plannedSnap = await getDoc(plannedRef);
    if (plannedSnap.exists()) {
      const data = plannedSnap.data();
      // expected: { session: { ... }, meta: { planId, week, day, date } }
      if (data?.session) {
        return {
          session: data.session,
          meta: { ...(data?.meta || {}), source: "plannedSessions" },
        };
      }
    }
  } catch {
    // ignore
  }

  // 2) Plan doc search (recommended path: pass planId)
  if (planId) {
    const planRef = doc(db, "users", uid, "trainingPlans", String(planId));
    const planSnap = await getDoc(planRef);
    if (!planSnap.exists()) throw new Error("Plan not found.");
    const plan = planSnap.data();

    const weeks = asArr(plan?.plan);
    for (const w of weeks) {
      const days = asArr(w?.days);
      for (const d of days) {
        const sessions = asArr(d?.sessions);
        for (const s of sessions) {
          if (safeStr(s?.id) === safeStr(sessionKey)) {
            return {
              session: s,
              meta: {
                planId: String(planId),
                week: toNum(w?.week, undefined),
                day: safeStr(d?.day),
                source: "trainingPlans",
                planName: safeStr(plan?.name),
              },
            };
          }
        }
      }
    }

    // If not found by id, try loose match (helps if your sessionKey is composite)
    for (const w of weeks) {
      const days = asArr(w?.days);
      for (const d of days) {
        const sessions = asArr(d?.sessions);
        for (const s of sessions) {
          const sid = safeStr(s?.id);
          if (!sid) continue;
          if (sid.includes(String(sessionKey)) || String(sessionKey).includes(sid)) {
            return {
              session: s,
              meta: {
                planId: String(planId),
                week: toNum(w?.week, undefined),
                day: safeStr(d?.day),
                source: "trainingPlans_fuzzy",
                planName: safeStr(plan?.name),
              },
            };
          }
        }
      }
    }

    throw new Error("Session not found in this plan.");
  }

  throw new Error("Missing planId. Pass planId when navigating to Live Session.");
}

/* ---------------- component ---------------- */
export default function LiveSessionPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();

  const params = useLocalSearchParams();
  const sessionKey = safeStr(params?.sessionKey);
  const planId = safeStr(params?.planId); // optional but recommended
  const scheduledDate = safeStr(params?.date); // optional

  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // template load
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState(null); // { session, meta }
  const [loadErr, setLoadErr] = useState("");

  // live state
  const [status, setStatus] = useState("idle"); // idle|running|paused|finished
  const [minimised, setMinimised] = useState(false);

  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [stepElapsedMs, setStepElapsedMs] = useState(0);
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);

  const startedAtRef = useRef(null);
  const lastTickRef = useRef(null);

  // splits
  const [laps, setLaps] = useState([]); // [{ idx, stepId, stepType, lapMs, totalMs, at }]
  const [rpe, setRpe] = useState("");
  const [notes, setNotes] = useState("");

  const runSteps = useMemo(() => asArr(template?.session?.runSteps), [template]);
  const activeStep = useMemo(() => runSteps[activeStepIdx] || null, [runSteps, activeStepIdx]);

  const stepIsTimeBased = useMemo(() => {
    const d = isObj(activeStep?.duration) ? activeStep.duration : {};
    return safeStr(d?.type) === "time" && Number.isFinite(toNum(d?.value));
  }, [activeStep]);

  const stepTargetMs = useMemo(() => {
    const d = isObj(activeStep?.duration) ? activeStep.duration : {};
    const sec = toNum(d?.value, undefined);
    if (safeStr(d?.type) !== "time") return null;
    if (!Number.isFinite(sec)) return null;
    return Math.max(0, Math.round(sec * 1000));
  }, [activeStep]);

  const stepRemainingMs = useMemo(() => {
    if (!Number.isFinite(toNum(stepTargetMs))) return null;
    return Math.max(0, stepTargetMs - stepElapsedMs);
  }, [stepTargetMs, stepElapsedMs]);

  const canAutoAdvance = useMemo(() => {
    // Only auto-advance for time steps. Distance/open will require GPS or manual next.
    return status === "running" && stepIsTimeBased && Number.isFinite(toNum(stepTargetMs));
  }, [status, stepIsTimeBased, stepTargetMs]);

  // redirect if logged out
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) router.replace("/(auth)/login");
  }, [router]);

  // load template
  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!sessionKey) {
        setLoadErr("Missing sessionKey.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadErr("");

      try {
        const uid = uidOrThrow();
        const tpl = await fetchSessionTemplate({ uid, sessionKey, planId });
        if (!mounted) return;

        // basic guard: prefer run sessions; still allow others
        const sess = tpl?.session || {};
        if (!isObj(sess)) throw new Error("Invalid session template.");

        setTemplate(tpl);
        setActiveStepIdx(0);
        setStepElapsedMs(0);
        setTotalElapsedMs(0);
        setStatus("idle");
        setLaps([]);
        setRpe("");
        setNotes("");
      } catch (e) {
        if (!mounted) return;
        setLoadErr(safeStr(e?.message) || "Failed to load session.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [sessionKey, planId]);

  // ticking timer
  useEffect(() => {
    if (status !== "running") return;

    const tick = () => {
      const now = Date.now();
      const last = lastTickRef.current ?? now;
      const delta = Math.max(0, now - last);

      lastTickRef.current = now;

      setStepElapsedMs((ms) => ms + delta);
      setTotalElapsedMs((ms) => ms + delta);
    };

    lastTickRef.current = Date.now();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [status]);

  // auto-advance time-based step
  useEffect(() => {
    if (!canAutoAdvance) return;
    if (!Number.isFinite(toNum(stepTargetMs))) return;
    if (stepElapsedMs < stepTargetMs) return;

    // reached target -> lap + advance
    onLap({ auto: true, advance: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoAdvance, stepElapsedMs, stepTargetMs]);

  const start = useCallback(() => {
    if (!template?.session) return;
    if (status === "running") return;

    startedAtRef.current = startedAtRef.current || Date.now();
    lastTickRef.current = Date.now();
    setStatus("running");
  }, [template, status]);

  const pause = useCallback(() => {
    if (status !== "running") return;
    setStatus("paused");
  }, [status]);

  const resume = useCallback(() => {
    if (status !== "paused") return;
    lastTickRef.current = Date.now();
    setStatus("running");
  }, [status]);

  const nextStep = useCallback(() => {
    const steps = runSteps;
    if (!steps.length) return;

    const isLast = activeStepIdx >= steps.length - 1;
    if (isLast) {
      finish();
      return;
    }

    setActiveStepIdx((i) => Math.min(i + 1, steps.length - 1));
    setStepElapsedMs(0);
  }, [runSteps, activeStepIdx]);

  const prevStep = useCallback(() => {
    const steps = runSteps;
    if (!steps.length) return;
    setActiveStepIdx((i) => Math.max(0, i - 1));
    setStepElapsedMs(0);
  }, [runSteps]);

  const onLap = useCallback(
    ({ auto = false, advance = false } = {}) => {
      const step = activeStep;
      if (!step) return;

      const lap = {
        idx: activeStepIdx,
        stepId: safeStr(step?.id) || `step_${activeStepIdx}`,
        stepType: safeStr(step?.type) || "work",
        lapMs: stepElapsedMs,
        totalMs: totalElapsedMs,
        at: Date.now(),
        auto: !!auto,
      };

      setLaps((prev) => [lap, ...prev]);

      if (advance) {
        nextStep();
      }
    },
    [activeStep, activeStepIdx, stepElapsedMs, totalElapsedMs, nextStep]
  );

  const reset = useCallback(() => {
    Alert.alert("Reset session?", "This will clear the timer and laps.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => {
          setStatus("idle");
          setActiveStepIdx(0);
          setStepElapsedMs(0);
          setTotalElapsedMs(0);
          setLaps([]);
          startedAtRef.current = null;
          lastTickRef.current = null;
        },
      },
    ]);
  }, []);

  const finish = useCallback(() => {
    if (status === "finished") return;
    setStatus("finished");
  }, [status]);

  const saveLog = useCallback(async () => {
    try {
      const uid = uidOrThrow();

      const sess = template?.session || {};
      const meta = template?.meta || {};

      const payload = {
        sessionKey: sessionKey || null,
        planId: meta?.planId || planId || null,
        planName: meta?.planName || null,
        week: meta?.week || null,
        day: meta?.day || null,
        scheduledDate: scheduledDate || null,

        sessionId: safeStr(sess?.id) || sessionKey || null,
        sessionName: safeStr(sess?.name) || "Session",
        sessionType: safeStr(sess?.type) || "run",

        startedAtMs: startedAtRef.current || null,
        endedAtMs: Date.now(),
        totalSec: Math.round((totalElapsedMs || 0) / 1000),
        status: "completed",

        activeStepIdxFinal: activeStepIdx,
        stepsCount: runSteps.length,
        laps: laps.map((x) => ({
          idx: x.idx,
          stepId: x.stepId,
          stepType: x.stepType,
          lapSec: Math.round((x.lapMs || 0) / 1000),
          totalSec: Math.round((x.totalMs || 0) / 1000),
          auto: !!x.auto,
          at: x.at,
        })),

        rpe: safeStr(rpe) ? clamp(toNum(rpe, 0) ?? 0, 1, 10) : null,
        notes: safeStr(notes) || null,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "users", uid, "sessionLogs"), payload);

      Alert.alert("Saved", "Session log saved.");
      router.back();
    } catch (e) {
      Alert.alert("Save failed", safeStr(e?.message) || "Try again.");
    }
  }, [
    template,
    sessionKey,
    planId,
    scheduledDate,
    totalElapsedMs,
    activeStepIdx,
    runSteps.length,
    laps,
    rpe,
    notes,
    router,
  ]);

  const headerTitle = useMemo(() => {
    const name = safeStr(template?.session?.name);
    if (name) return name;
    return "Live Session";
  }, [template]);

  const topMeta = useMemo(() => {
    const t = safeStr(template?.session?.type) || "run";
    const w = template?.meta?.week ? `Week ${template.meta.week}` : "";
    const d = safeStr(template?.meta?.day);
    const date = scheduledDate ? scheduledDate : "";
    const bits = [w, d, date].filter(Boolean).join(" • ");
    return `${t}${bits ? ` • ${bits}` : ""}`;
  }, [template, scheduledDate]);

  if (loading) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadErr) {
    return (
      <SafeAreaView edges={["top"]} style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.85}>
            <Feather name="chevron-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={s.headerTitle}>Live Session</Text>
            <Text style={s.headerSub}>Couldn’t load</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Session load failed</Text>
          <Text style={s.errorText}>{loadErr}</Text>

          <Text style={s.errorHint}>
            Tip: navigate with planId:
            {"\n"}
            router.push({`{ pathname: "/training/session/${sessionKey}/live", params: { planId } }`})
          </Text>

          <TouchableOpacity onPress={() => router.back()} style={s.secondaryBtn} activeOpacity={0.9}>
            <Feather name="arrow-left" size={18} color={colors.text} />
            <Text style={s.secondaryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isRun = safeStr(template?.session?.type) === "run";
  const hasSteps = runSteps.length > 0;

  return (
    <SafeAreaView edges={["top"]} style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.headerTitle} numberOfLines={1}>{headerTitle}</Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {topMeta}
          </Text>
        </View>

        <TouchableOpacity onPress={() => setMinimised((v) => !v)} style={s.iconBtn} activeOpacity={0.85}>
          <Feather name={minimised ? "maximize-2" : "minimize-2"} size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Main */}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Current step */}
        <View style={s.heroCard}>
          <View style={s.heroTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.heroKicker}>{hasSteps ? `Step ${activeStepIdx + 1} / ${runSteps.length}` : "Session"}</Text>
              <Text style={s.heroTitle} numberOfLines={2}>
                {hasSteps ? stepLabel(activeStep) : safeStr(template?.session?.name) || "Live Session"}
              </Text>
              <Text style={s.heroSub} numberOfLines={2}>
                {hasSteps ? `${durationText(activeStep)} • ${targetText(activeStep)}` : "No structured steps found."}
              </Text>
            </View>

            <View style={s.heroBadge}>
              <Text style={s.heroBadgeText}>{status.toUpperCase()}</Text>
            </View>
          </View>

          {/* Timers */}
          <View style={s.timerRow}>
            <View style={s.timerBox}>
              <Text style={s.timerLabel}>STEP</Text>
              <Text style={s.timerValue}>
                {Number.isFinite(toNum(stepRemainingMs)) ? msToClock(stepRemainingMs) : msToClock(stepElapsedMs)}
              </Text>
              <Text style={s.timerHint}>
                {Number.isFinite(toNum(stepRemainingMs)) ? "remaining" : "elapsed"}
              </Text>
            </View>

            <View style={s.timerBox}>
              <Text style={s.timerLabel}>TOTAL</Text>
              <Text style={s.timerValue}>{msToClock(totalElapsedMs)}</Text>
              <Text style={s.timerHint}>elapsed</Text>
            </View>
          </View>

          {/* Primary controls */}
          <View style={s.controlsRow}>
            {status === "idle" ? (
              <TouchableOpacity style={s.primaryBtn} activeOpacity={0.9} onPress={start}>
                <Feather name="play" size={18} color="#111111" />
                <Text style={s.primaryBtnText}>Start</Text>
              </TouchableOpacity>
            ) : status === "running" ? (
              <>
                <TouchableOpacity style={s.primaryBtn} activeOpacity={0.9} onPress={pause}>
                  <Feather name="pause" size={18} color="#111111" />
                  <Text style={s.primaryBtnText}>Pause</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.secondaryBtnSmall} activeOpacity={0.9} onPress={() => onLap({ auto: false, advance: false })}>
                  <Feather name="flag" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnSmallText}>Lap</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.secondaryBtnSmall}
                  activeOpacity={0.9}
                  onPress={() => onLap({ auto: false, advance: true })}
                >
                  <Feather name="skip-forward" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnSmallText}>Lap + Next</Text>
                </TouchableOpacity>
              </>
            ) : status === "paused" ? (
              <>
                <TouchableOpacity style={s.primaryBtn} activeOpacity={0.9} onPress={resume}>
                  <Feather name="play" size={18} color="#111111" />
                  <Text style={s.primaryBtnText}>Resume</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.secondaryBtnSmall} activeOpacity={0.9} onPress={reset}>
                  <Feather name="rotate-ccw" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnSmallText}>Reset</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.secondaryBtnSmall} activeOpacity={0.9} onPress={finish}>
                  <Feather name="check" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnSmallText}>Finish</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={s.primaryBtn} activeOpacity={0.9} onPress={saveLog}>
                  <Feather name="save" size={18} color="#111111" />
                  <Text style={s.primaryBtnText}>Save</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.secondaryBtnSmall} activeOpacity={0.9} onPress={reset}>
                  <Feather name="rotate-ccw" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnSmallText}>Reset</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Manual next/prev for non-time steps */}
          {hasSteps ? (
            <View style={s.navRow}>
              <TouchableOpacity style={s.navBtn} activeOpacity={0.85} onPress={prevStep} disabled={activeStepIdx === 0}>
                <Feather name="skip-back" size={16} color={activeStepIdx === 0 ? colors.subtext : colors.text} />
                <Text style={[s.navText, activeStepIdx === 0 && { color: colors.subtext }]}>Prev</Text>
              </TouchableOpacity>

              <View style={s.navHintWrap}>
                <Text style={s.navHint}>
                  {stepIsTimeBased
                    ? "Auto-advances when timer hits 0"
                    : "Distance/Open steps: use Lap + Next (GPS later)"}
                </Text>
              </View>

              <TouchableOpacity style={s.navBtn} activeOpacity={0.85} onPress={nextStep}>
                <Text style={s.navText}>Next</Text>
                <Feather name="skip-forward" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>
          ) : null}

          {!isRun ? (
            <Text style={s.warnText}>
              This session isn’t type="run". Live step mode still works, but runSteps are mainly for runs.
            </Text>
          ) : !hasSteps ? (
            <Text style={s.warnText}>
              No runSteps were found. Your builder should generate runSteps, or the plan validator should derive them.
            </Text>
          ) : null}
        </View>

        {/* Steps panel */}
        {hasSteps ? (
          <View style={[s.panelCard, minimised && { paddingBottom: 10 }]}>
            <View style={s.panelTopRow}>
              <Text style={s.panelTitle}>Steps</Text>

              <TouchableOpacity onPress={() => setMinimised((v) => !v)} style={s.panelToggle} activeOpacity={0.85}>
                <Feather name={minimised ? "chevrons-down" : "chevrons-up"} size={16} color={colors.text} />
                <Text style={s.panelToggleText}>{minimised ? "Show" : "Hide"}</Text>
              </TouchableOpacity>
            </View>

            {!minimised ? (
              <View style={{ marginTop: 10 }}>
                {runSteps.map((st, idx) => {
                  const active = idx === activeStepIdx;
                  return (
                    <Pressable
                      key={safeStr(st?.id) || `st_${idx}`}
                      onPress={() => {
                        // Only allow jumping when not running (prevents accidental step skips mid-interval)
                        if (status === "running") return;
                        setActiveStepIdx(idx);
                        setStepElapsedMs(0);
                      }}
                      style={({ pressed }) => [
                        s.stepRow,
                        active && s.stepRowActive,
                        pressed && { opacity: 0.9 },
                        status === "running" && { opacity: active ? 1 : 0.75 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.stepTitle, active && s.stepTitleActive]}>
                          {idx + 1}. {stepLabel(st)}{" "}
                          <Text style={[s.stepMeta, active && s.stepMetaActive]}>
                            • {durationText(st)} • {targetText(st)}
                          </Text>
                        </Text>
                        {!!safeStr(st?.notes) && (
                          <Text style={[s.stepNotes, active && s.stepNotesActive]} numberOfLines={2}>
                            {safeStr(st?.notes)}
                          </Text>
                        )}
                      </View>

                      {active ? (
                        <View style={s.stepPill}>
                          <Text style={s.stepPillText}>NOW</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Laps */}
        <View style={s.panelCard}>
          <View style={s.panelTopRow}>
            <Text style={s.panelTitle}>Laps</Text>
            <Text style={s.panelSub}>{laps.length ? `${laps.length} recorded` : "None yet"}</Text>
          </View>

          {laps.length ? (
            <View style={{ marginTop: 10 }}>
              {laps.slice(0, 10).map((lp, i) => (
                <View key={`${lp.stepId}_${lp.at}_${i}`} style={s.lapRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.lapTitle} numberOfLines={1}>
                      Step {lp.idx + 1} • {stepLabel({ type: lp.stepType })}
                      {lp.auto ? " (auto)" : ""}
                    </Text>
                    <Text style={s.lapSub}>
                      Lap {msToClock(lp.lapMs)} • Total {msToClock(lp.totalMs)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.subtext} />
                </View>
              ))}
              {laps.length > 10 ? <Text style={s.smallMuted}>Showing latest 10</Text> : null}
            </View>
          ) : (
            <Text style={s.smallMuted}>Tap “Lap” to record splits (and optionally advance).</Text>
          )}
        </View>

        {/* Finish / save inputs */}
        {status === "finished" ? (
          <View style={s.panelCard}>
            <Text style={s.panelTitle}>Finish</Text>

            <View style={{ marginTop: 10 }}>
              <Text style={s.label}>RPE (1–10)</Text>
              <TextInput
                value={rpe}
                onChangeText={setRpe}
                placeholder="e.g. 7"
                placeholderTextColor={colors.subtext}
                style={s.input}
                keyboardType="numeric"
                keyboardAppearance={isDark ? "dark" : "light"}
              />

              <Text style={[s.label, { marginTop: 12 }]}>Notes</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="How did it feel? Any issues?"
                placeholderTextColor={colors.subtext}
                style={[s.input, { height: 90, textAlignVertical: "top", paddingTop: 10 }]}
                multiline
                keyboardAppearance={isDark ? "dark" : "light"}
              />

              <TouchableOpacity style={[s.primaryBtn, { marginTop: 12 }]} activeOpacity={0.9} onPress={saveLog}>
                <Feather name="save" size={18} color="#111111" />
                <Text style={s.primaryBtnText}>Save session log</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={{ height: 22 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
function makeStyles(colors, isDark) {
  const cardBg = isDark ? "#111217" : "#FFFFFF";
  const panelBg = isDark ? "#0E0F12" : "#FFFFFF";
  const border = isDark ? "#1F2128" : "#E1E3E8";
  const accentBg = colors?.accentBg ?? colors?.sapPrimary ?? "#E6FF3B";

  const softShadow = isDark
    ? { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4 }
    : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 2 };

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    iconBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      alignItems: "center",
      justifyContent: "center",
      ...softShadow,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      maxWidth: 220,
    },
    headerSub: {
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      marginTop: 2,
      textAlign: "center",
      maxWidth: 260,
    },

    scroll: { paddingHorizontal: 18, paddingBottom: 28 },

    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    centerText: { color: colors.subtext, fontWeight: "800" },

    errorCard: {
      margin: 18,
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      ...softShadow,
    },
    errorTitle: { color: colors.text, fontWeight: "900", fontSize: 16 },
    errorText: { marginTop: 8, color: colors.subtext, fontWeight: "700", lineHeight: 18 },
    errorHint: { marginTop: 10, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16, opacity: 0.9 },

    heroCard: {
      backgroundColor: cardBg,
      borderRadius: 24,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      ...softShadow,
      marginBottom: 14,
    },
    heroTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
    heroKicker: { color: colors.subtext, fontWeight: "900", fontSize: 11, letterSpacing: 0.9, textTransform: "uppercase" },
    heroTitle: { marginTop: 6, color: colors.text, fontWeight: "900", fontSize: 22 },
    heroSub: { marginTop: 6, color: colors.subtext, fontWeight: "750", fontSize: 13, lineHeight: 17 },

    heroBadge: {
      backgroundColor: isDark ? "#0E0F12" : "#F3F4F6",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 8,
      alignSelf: "flex-start",
    },
    heroBadgeText: { color: colors.text, fontWeight: "900", fontSize: 11, letterSpacing: 0.4 },

    timerRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    timerBox: {
      flex: 1,
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    timerLabel: { color: colors.subtext, fontWeight: "900", fontSize: 10, letterSpacing: 1.0 },
    timerValue: { marginTop: 6, color: colors.text, fontWeight: "900", fontSize: 26, letterSpacing: 0.4 },
    timerHint: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    controlsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12, alignItems: "center" },
    primaryBtn: {
      flexGrow: 1,
      backgroundColor: accentBg,
      borderRadius: 22,
      paddingVertical: 14,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      ...softShadow,
      minWidth: 160,
    },
    primaryBtnText: { color: "#111111", fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },

    secondaryBtn: {
      marginTop: 12,
      backgroundColor: panelBg,
      borderRadius: 22,
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      ...softShadow,
    },
    secondaryBtnText: { color: colors.text, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },

    secondaryBtnSmall: {
      backgroundColor: panelBg,
      borderRadius: 18,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      ...softShadow,
      flexGrow: 1,
    },
    secondaryBtnSmallText: { color: colors.text, fontWeight: "900", letterSpacing: 0.4, textTransform: "uppercase", fontSize: 12 },

    navRow: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: panelBg,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      padding: 10,
    },
    navBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 14,
      backgroundColor: isDark ? "#101116" : "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    navText: { color: colors.text, fontWeight: "900", textTransform: "uppercase", fontSize: 12, letterSpacing: 0.4 },
    navHintWrap: { flex: 1 },
    navHint: { color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    warnText: { marginTop: 10, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    panelCard: {
      backgroundColor: cardBg,
      borderRadius: 22,
      padding: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 14,
      ...softShadow,
    },
    panelTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    panelTitle: { color: colors.text, fontWeight: "900", fontSize: 13, letterSpacing: 0.9, textTransform: "uppercase" },
    panelSub: { color: colors.subtext, fontWeight: "800", fontSize: 12 },

    panelToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
    },
    panelToggleText: { color: colors.text, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },

    stepRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 12,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      backgroundColor: panelBg,
      marginBottom: 10,
    },
    stepRowActive: {
      backgroundColor: isDark ? "rgba(230,255,59,0.10)" : "rgba(230,255,59,0.25)",
      borderColor: isDark ? "rgba(230,255,59,0.45)" : "rgba(164,182,0,0.50)",
    },
    stepTitle: { color: colors.text, fontWeight: "900", fontSize: 13, lineHeight: 18 },
    stepTitleActive: { color: colors.text },
    stepMeta: { color: colors.subtext, fontWeight: "800", fontSize: 12 },
    stepMetaActive: { color: colors.subtext },
    stepNotes: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },
    stepNotesActive: { color: colors.subtext },
    stepPill: { backgroundColor: "#111111", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
    stepPillText: { color: accentBg, fontWeight: "900", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },

    lapRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: panelBg,
      borderRadius: 18,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      marginBottom: 10,
    },
    lapTitle: { color: colors.text, fontWeight: "900", fontSize: 13 },
    lapSub: { marginTop: 4, color: colors.subtext, fontWeight: "700", fontSize: 12 },

    smallMuted: { marginTop: 6, color: colors.subtext, fontWeight: "700", fontSize: 12, lineHeight: 16 },

    label: { color: colors.subtext, fontSize: 11, fontWeight: "900", letterSpacing: 0.9, textTransform: "uppercase", marginBottom: 6 },
    input: {
      backgroundColor: panelBg,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 12 : 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },
  });
}
