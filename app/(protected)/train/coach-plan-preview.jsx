// app/(protected)/train/coach-plan-preview.jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import {
  COACH_PLAN_MILEAGE_FACTORS,
  COACH_PLAN_PACE_PROFILES,
  DEFAULT_COACH_PLAN_PERSONALISATION,
  formatSecPerKm,
  getCoachTemplateById,
  parsePaceToSecPerKm,
  personaliseCoachTemplateDoc,
} from "../../../src/train/data/coachTemplates";

const TEN_K_PACE_OPTIONS = Array.from({ length: ((8 * 60 - 3 * 60 - 30) / 5) + 1 }, (_, idx) =>
  formatSecPerKm(3 * 60 + 30 + idx * 5)
);

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
  };
}

function fmtSessionMeta(session) {
  const bits = [];
  const km = Number(session?.targetDistanceKm || 0);
  const min = Number(session?.targetDurationMin || 0);

  if (km > 0) bits.push(`${km.toFixed(1)} km`);
  if (min > 0) bits.push(`${Math.round(min)} min`);

  const paceSec = Number(session?.steps?.[1]?.target?.paceSecPerKm || 0);
  if (paceSec > 0) bits.push(`${formatSecPerKm(paceSec)}/km`);

  return bits.join(" · ");
}

function weekPlannedKm(week) {
  const days = Array.isArray(week?.days) ? week.days : [];
  let total = 0;

  for (const day of days) {
    const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
    for (const sess of sessions) {
      const km = Number(sess?.targetDistanceKm || 0);
      if (Number.isFinite(km) && km > 0) total += km;
    }
  }

  return Number(total.toFixed(1));
}

function secToClock(totalSec) {
  const s = Math.max(0, Math.round(Number(totalSec || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function getPaceProfileExplanation(profile) {
  const key = String(profile || "balanced").toLowerCase();
  if (key === "conservative") {
    return "Lower-intensity profile with more aerobic control and smoother recovery.";
  }
  if (key === "aggressive") {
    return "Higher-intensity profile with tighter recovery and faster quality pace targets.";
  }
  return "Balanced intensity profile combining quality progression with sustainable recovery.";
}

function buildModelPaces(tenKPaceSec, paceProfile) {
  if (!Number.isFinite(tenKPaceSec) || tenKPaceSec <= 0) return null;
  const key = String(paceProfile || "balanced").toLowerCase();

  const offsets =
    key === "conservative"
      ? { easyA: 95, easyB: 70, tempo: 20, speedA: -12, speedB: -24 }
      : key === "aggressive"
      ? { easyA: 75, easyB: 55, tempo: 8, speedA: -20, speedB: -34 }
      : { easyA: 85, easyB: 60, tempo: 12, speedA: -16, speedB: -28 };

  return {
    race: formatSecPerKm(tenKPaceSec),
    easy: `${formatSecPerKm(tenKPaceSec + offsets.easyA)}-${formatSecPerKm(
      tenKPaceSec + offsets.easyB
    )}`,
    tempo: formatSecPerKm(tenKPaceSec + offsets.tempo),
    speed: `${formatSecPerKm(tenKPaceSec + offsets.speedA)}-${formatSecPerKm(
      tenKPaceSec + offsets.speedB
    )}`,
    projected10k: secToClock(tenKPaceSec * 10),
  };
}

function buildSessionKey(planId, weekIndex, dayIndex, sessionIndex) {
  return `${planId}_${weekIndex}_${dayIndex}_${sessionIndex}`;
}

function findFirstSessionKeyFromWeeks(planId, weeks) {
  if (!planId) return null;
  const list = Array.isArray(weeks) ? weeks : [];

  for (let wi = 0; wi < list.length; wi += 1) {
    const week = list[wi];
    const days = Array.isArray(week?.days) ? week.days : [];

    for (let di = 0; di < days.length; di += 1) {
      const sessions = Array.isArray(days[di]?.sessions) ? days[di].sessions : [];
      if (sessions.length) return buildSessionKey(planId, wi, di, 0);
    }
  }

  return null;
}

export default function CoachPlanPreviewPage() {
  const router = useRouter();
  const { templateId } = useLocalSearchParams();
  const theme = useScreenTheme();
  const templateIdValue = Array.isArray(templateId) ? templateId[0] : templateId;

  const template = useMemo(() => getCoachTemplateById(templateIdValue), [templateIdValue]);

  const [tenKPace, setTenKPace] = useState(DEFAULT_COACH_PLAN_PERSONALISATION.tenKPace);
  const [paceProfile, setPaceProfile] = useState(DEFAULT_COACH_PLAN_PERSONALISATION.paceProfile);
  const [mileageScale, setMileageScale] = useState(DEFAULT_COACH_PLAN_PERSONALISATION.mileageScale);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({
    planFlow: false,
    effectiveness: false,
    weekDetail: false,
  });

  const toggleSection = (key) =>
    setOpenSections((prev) => ({
      ...prev,
      [key]: !prev?.[key],
    }));

  const personalisedTemplate = useMemo(
    () =>
      template
        ? personaliseCoachTemplateDoc(template, {
            tenKPace,
            paceProfile,
            mileageScale,
          })
        : null,
    [template, tenKPace, paceProfile, mileageScale]
  );

  const weeks = Array.isArray(personalisedTemplate?.weeks) ? personalisedTemplate.weeks : [];
  const totalWeeks = weeks.length;
  const totalSessions = useMemo(() => {
    let total = 0;
    for (const week of weeks) {
      const days = Array.isArray(week?.days) ? week.days : [];
      for (const day of days) {
        total += Array.isArray(day?.sessions) ? day.sessions.length : 0;
      }
    }
    return total;
  }, [weeks]);
  const weeklyVolumes = useMemo(
    () => weeks.map((w) => weekPlannedKm(w)).filter((x) => Number.isFinite(x) && x > 0),
    [weeks]
  );
  const openingVolume = weeklyVolumes.length ? weeklyVolumes[0] : 0;
  const peakVolume = weeklyVolumes.length ? Math.max(...weeklyVolumes) : 0;
  const totalProgramVolume = weeklyVolumes.length
    ? Number(weeklyVolumes.reduce((a, b) => a + b, 0).toFixed(1))
    : 0;
  const avgWeeklyVolume = weeklyVolumes.length
    ? Number((totalProgramVolume / weeklyVolumes.length).toFixed(1))
    : 0;
  const tenKPaceSec = parsePaceToSecPerKm(tenKPace);
  const modelPaces = useMemo(
    () => buildModelPaces(tenKPaceSec, paceProfile),
    [tenKPaceSec, paceProfile]
  );

  const addPersonalisedPlan = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in before adding this plan.");
      return;
    }

    if (!template || !personalisedTemplate) {
      Alert.alert("Template not found", "Could not load this coach template.");
      return;
    }

    const parsedPace = parsePaceToSecPerKm(tenKPace);
    if (!parsedPace) {
      Alert.alert("Invalid pace", "Use format mm:ss for 10K pace, e.g. 5:10.");
      return;
    }

    setSaving(true);
    try {
      const name = personalisedTemplate.name || template.name || "Coach plan";
      const kind = personalisedTemplate.kind || "run";
      const primaryActivity = personalisedTemplate.primaryActivity || "Run";
      const weeksOut = Array.isArray(personalisedTemplate.weeks)
        ? personalisedTemplate.weeks
        : [];

      const payload = {
        name,
        kind,
        primaryActivity,
        source: "coach-library",
        plan: {
          name,
          primaryActivity,
          weeks: weeksOut,
        },
        weeks: weeksOut,
        coachPlanRef: {
          id: template.id,
          sourceCollection: "localTemplates",
          coachName: template.coachName || null,
          name: template.name || name,
        },
        meta: {
          ...(personalisedTemplate.meta || {}),
          importedFromCoachPlan: true,
          coachName: template.coachName || personalisedTemplate.meta?.coachName || null,
          name,
          primaryActivity,
          personalisation: {
            tenKPace,
            paceProfile,
            mileageScale,
          },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const ref = await addDoc(collection(db, "users", uid, "plans"), payload);
      const firstSessionKey = findFirstSessionKeyFromWeeks(ref.id, weeksOut);
      const actions = [
        {
          text: "View",
          onPress: () =>
            router.replace({ pathname: "/train/view-plan", params: { planId: ref.id } }),
        },
        firstSessionKey
          ? {
              text: "Start",
              onPress: () =>
                router.replace(`/train/session/${encodeURIComponent(firstSessionKey)}`),
            }
          : null,
        {
          text: "Close",
          style: "cancel",
          onPress: () => router.back(),
        },
      ].filter(Boolean);

      Alert.alert("Coach plan added", "Your personalised plan is ready.", actions);
    } catch (e) {
      Alert.alert("Couldn’t add plan", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!template || !personalisedTemplate) {
    return (
      <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}> 
        <View style={[sx.header, { borderColor: theme.border }]}> 
          <TouchableOpacity
            onPress={() => router.back()}
            style={[sx.backBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontWeight: "900", fontSize: 13 }}>Back</Text>
          </TouchableOpacity>
          <Text style={[sx.title, { color: theme.text }]}>Coach preview</Text>
          <View style={sx.headerPad} />
        </View>

        <View style={sx.emptyWrap}>
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 17 }}>Template unavailable</Text>
          <Text style={{ color: theme.subtext, marginTop: 6, fontWeight: "700" }}>
            This coach template could not be loaded.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const firstWeekKm = totalWeeks ? weekPlannedKm(weeks[0]) : 0;
  const firstFocus = String(weeks?.[0]?.focus || "Base development");
  const peakWeekIdx = weeklyVolumes.length
    ? Math.max(
        0,
        weeklyVolumes.findIndex((x) => x === peakVolume)
      )
    : 0;
  const peakFocus = String(weeks?.[peakWeekIdx]?.focus || "10K race-specific work");

  return (
    <SafeAreaView style={[sx.safe, { backgroundColor: theme.bg }]}> 
      <View style={[sx.header, { borderColor: theme.border }]}> 
        <TouchableOpacity
          onPress={() => router.back()}
          style={[sx.backBtn, { borderColor: theme.border, backgroundColor: theme.card2 }]}
          activeOpacity={0.85}
        >
          <Feather name="chevron-left" size={16} color={theme.text} />
          <Text style={{ color: theme.text, fontWeight: "900", fontSize: 13 }}>Back</Text>
        </TouchableOpacity>

        <Text style={[sx.title, { color: theme.text }]}>Coach preview</Text>

        <View style={sx.headerPad} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[sx.card, { borderColor: theme.border, backgroundColor: theme.card }]}> 
          <Text style={[sx.planName, { color: theme.text }]}>{template.name}</Text>
          <Text style={{ color: theme.subtext, marginTop: 3, fontWeight: "800" }}>
            Coach: {template.coachName}
          </Text>
          <Text style={{ color: theme.subtext, marginTop: 4, fontSize: 12, fontWeight: "700" }}>
            {totalWeeks} weeks · {totalSessions} sessions · Week 1 volume {firstWeekKm.toFixed(1)} km
          </Text>
        </View>

        <View style={[sx.card, { borderColor: theme.border, backgroundColor: theme.card, marginTop: 10 }]}>
          <Text style={[sx.sectionTitle, { color: theme.text }]}>Program brief</Text>
          <Text style={[sx.briefBody, { color: theme.subtext }]}>
            This is a structured 10K build designed to improve speed endurance, threshold control, and race-day
            durability across an 8-week progression.
          </Text>

          <View style={sx.briefGrid}>
            <View style={[sx.briefMetricCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
              <Text style={[sx.briefMetricValue, { color: theme.text }]}>
                {modelPaces?.projected10k || "--:--"}
              </Text>
              <Text style={[sx.briefMetricLabel, { color: theme.subtext }]}>Projected 10K outcome</Text>
            </View>

            <View style={[sx.briefMetricCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
              <Text style={[sx.briefMetricValue, { color: theme.text }]}>{avgWeeklyVolume.toFixed(1)} km</Text>
              <Text style={[sx.briefMetricLabel, { color: theme.subtext }]}>Average weekly volume</Text>
            </View>

            <View style={[sx.briefMetricCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
              <Text style={[sx.briefMetricValue, { color: theme.text }]}>
                {openingVolume.toFixed(1)}→{peakVolume.toFixed(1)} km
              </Text>
              <Text style={[sx.briefMetricLabel, { color: theme.subtext }]}>Volume progression</Text>
            </View>

            <View style={[sx.briefMetricCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
              <Text style={[sx.briefMetricValue, { color: theme.text }]}>{totalProgramVolume.toFixed(1)} km</Text>
              <Text style={[sx.briefMetricLabel, { color: theme.subtext }]}>Total plan volume</Text>
            </View>
          </View>
        </View>

        <View style={[sx.card, { borderColor: theme.border, backgroundColor: theme.card, marginTop: 10 }]}>
          <TouchableOpacity
            onPress={() => toggleSection("planFlow")}
            style={[sx.sectionToggle, { borderColor: theme.border, backgroundColor: theme.card2 }]}
            activeOpacity={0.85}
          >
            <Text style={[sx.sectionTitle, { color: theme.text }]}>How this plan runs</Text>
            <Feather
              name={openSections.planFlow ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.text}
            />
          </TouchableOpacity>

          {openSections.planFlow ? (
            <>
              <Text style={[sx.briefBody, { color: theme.subtext }]}>
                Each week repeats a clear four-session framework so adaptation is progressive and measurable.
              </Text>

              <View style={sx.protocolRow}>
                <View style={sx.protocolDotWrap}>
                  <View style={[sx.protocolDot, { backgroundColor: theme.primaryBg }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sx.protocolTitle, { color: theme.text }]}>Speed session</Text>
                  <Text style={[sx.protocolText, { color: theme.subtext }]}>
                    High-quality intervals to raise aerobic ceiling and improve turnover at faster-than-race intensity.
                  </Text>
                </View>
              </View>

              <View style={sx.protocolRow}>
                <View style={sx.protocolDotWrap}>
                  <View style={[sx.protocolDot, { backgroundColor: theme.primaryBg }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sx.protocolTitle, { color: theme.text }]}>Easy aerobic session</Text>
                  <Text style={[sx.protocolText, { color: theme.subtext }]}>
                    Low-stress mileage to build aerobic durability while preserving quality-day freshness.
                  </Text>
                </View>
              </View>

              <View style={sx.protocolRow}>
                <View style={sx.protocolDotWrap}>
                  <View style={[sx.protocolDot, { backgroundColor: theme.primaryBg }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sx.protocolTitle, { color: theme.text }]}>Tempo session</Text>
                  <Text style={[sx.protocolText, { color: theme.subtext }]}>
                    Threshold-focused work to improve sustainable race pace and delay fatigue under load.
                  </Text>
                </View>
              </View>

              <View style={sx.protocolRow}>
                <View style={sx.protocolDotWrap}>
                  <View style={[sx.protocolDot, { backgroundColor: theme.primaryBg }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sx.protocolTitle, { color: theme.text }]}>Long run</Text>
                  <Text style={[sx.protocolText, { color: theme.subtext }]}>
                    Progressive aerobic extension to improve economy and late-race resilience.
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={[sx.collapsedHint, { color: theme.subtext }]}>
              Expand for the weekly session framework and execution details.
            </Text>
          )}
        </View>

        <View style={[sx.card, { borderColor: theme.border, backgroundColor: theme.card, marginTop: 10 }]}>
          <TouchableOpacity
            onPress={() => toggleSection("effectiveness")}
            style={[sx.sectionToggle, { borderColor: theme.border, backgroundColor: theme.card2 }]}
            activeOpacity={0.85}
          >
            <Text style={[sx.sectionTitle, { color: theme.text }]}>Why this is effective</Text>
            <Feather
              name={openSections.effectiveness ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.text}
            />
          </TouchableOpacity>

          {openSections.effectiveness ? (
            <>
              <Text style={[sx.protocolText, { color: theme.subtext }]}>
                The program combines progressive overload, specific race-pace practice, and controlled recovery
                blocks. This balance drives adaptation while reducing burnout risk.
              </Text>

              <View style={[sx.reasonCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
                <Text style={[sx.reasonLabel, { color: theme.text }]}>Phase intent</Text>
                <Text style={[sx.reasonValue, { color: theme.subtext }]}>
                  Early phase: {firstFocus}. Peak phase: {peakFocus}.
                </Text>
              </View>
            </>
          ) : (
            <Text style={[sx.collapsedHint, { color: theme.subtext }]}>
              Expand for coaching rationale and training-effect explanation.
            </Text>
          )}
        </View>

        <View style={[sx.card, { borderColor: theme.border, backgroundColor: theme.card, marginTop: 10 }]}> 
          <Text style={[sx.sectionTitle, { color: theme.text }]}>Personalise</Text>

          <View style={sx.controlGroup}>
            <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Target 10K pace</Text>
            <View style={[sx.paceSummaryCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="clock" size={14} color={theme.subtext} />
                <Text style={[sx.paceSummaryValue, { color: theme.text }]}>{tenKPace}/km</Text>
              </View>
              <Text style={[sx.paceSummarySub, { color: theme.subtext }]}>Scroll and tap to set</Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={sx.paceScrollRow}
            >
              {TEN_K_PACE_OPTIONS.map((pace) => {
                const active = tenKPace === pace;
                return (
                  <TouchableOpacity
                    key={pace}
                    onPress={() => setTenKPace(pace)}
                    style={[
                      sx.paceChip,
                      active
                        ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
                        : { backgroundColor: theme.card2, borderColor: theme.border },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        sx.paceChipText,
                        { color: active ? theme.primaryText : theme.text },
                      ]}
                    >
                      {pace}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={sx.controlGroup}>
            <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Pace profile</Text>
            <View style={sx.chipRow}>
              {COACH_PLAN_PACE_PROFILES.map((x) => {
                const active = paceProfile === x.key;
                return (
                  <TouchableOpacity
                    key={x.key}
                    onPress={() => setPaceProfile(x.key)}
                    style={[
                      sx.chip,
                      active
                        ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
                        : { backgroundColor: theme.card2, borderColor: theme.border },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={{
                        color: active ? theme.primaryText : theme.text,
                        fontWeight: "900",
                        fontSize: 12,
                      }}
                    >
                      {x.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={sx.controlGroup}>
            <Text style={[sx.fieldLabel, { color: theme.subtext }]}>Mileage</Text>
            <View style={sx.chipRow}>
              {COACH_PLAN_MILEAGE_FACTORS.map((x) => {
                const active = Number(mileageScale) === Number(x.value);
                return (
                  <TouchableOpacity
                    key={x.key}
                    onPress={() => setMileageScale(x.value)}
                    style={[
                      sx.chip,
                      active
                        ? { backgroundColor: theme.primaryBg, borderColor: "rgba(0,0,0,0)" }
                        : { backgroundColor: theme.card2, borderColor: theme.border },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={{
                        color: active ? theme.primaryText : theme.text,
                        fontWeight: "900",
                        fontSize: 12,
                      }}
                    >
                      {x.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Text style={{ color: theme.subtext, marginTop: 10, fontSize: 12, lineHeight: 18, fontWeight: "700" }}>
            Pace and mileage updates are applied to all 8 weeks before import.
          </Text>

          {modelPaces ? (
            <View style={[sx.reasonCard, { borderColor: theme.border, backgroundColor: theme.card2, marginTop: 10 }]}>
              <Text style={[sx.reasonLabel, { color: theme.text }]}>Current training pace model</Text>
              <Text style={[sx.reasonValue, { color: theme.subtext }]}>
                10K pace {modelPaces.race}/km · Tempo {modelPaces.tempo}/km · Easy {modelPaces.easy}/km · Speed{" "}
                {modelPaces.speed}/km
              </Text>
              <Text style={[sx.reasonValue, { color: theme.subtext, marginTop: 5 }]}>
                {getPaceProfileExplanation(paceProfile)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[sx.card, { borderColor: theme.border, backgroundColor: theme.card, marginTop: 10 }]}> 
          <TouchableOpacity
            onPress={() => toggleSection("weekDetail")}
            style={[sx.sectionToggle, { borderColor: theme.border, backgroundColor: theme.card2 }]}
            activeOpacity={0.85}
          >
            <Text style={[sx.sectionTitle, { color: theme.text }]}>Week-by-week detail</Text>
            <Feather
              name={openSections.weekDetail ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.text}
            />
          </TouchableOpacity>

          {openSections.weekDetail ? (
            weeks.map((week, wi) => (
              <View
                key={`wk-${wi}`}
                style={[sx.weekCard, { borderColor: theme.border, backgroundColor: theme.card2 }]}
              >
                <Text style={{ color: theme.text, fontWeight: "900" }}>
                  Week {Number(week?.weekNumber || wi + 1)} · {weekPlannedKm(week).toFixed(1)} km
                </Text>

                {(Array.isArray(week?.days) ? week.days : []).map((day, di) => {
                  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
                  if (!sessions.length) return null;

                  return (
                    <View key={`wk-${wi}-day-${di}`} style={{ marginTop: 8 }}>
                      <Text style={{ color: theme.subtext, fontWeight: "900", fontSize: 12 }}>{day.day}</Text>

                      {sessions.map((session, si) => (
                        <View key={`wk-${wi}-day-${di}-s-${si}`} style={sx.sessionRow}>
                          <Text style={{ color: theme.text, fontWeight: "800", flex: 1 }} numberOfLines={1}>
                            {session?.title || session?.name || "Run"}
                          </Text>
                          <Text style={{ color: theme.subtext, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                            {fmtSessionMeta(session)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            ))
          ) : (
            <Text style={[sx.collapsedHint, { color: theme.subtext }]}>
              Expand to inspect every week, day, and session prescription.
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={[sx.footer, { borderColor: theme.border, backgroundColor: theme.bg }]}> 
        <TouchableOpacity
          onPress={addPersonalisedPlan}
          disabled={saving}
          style={[sx.saveBtn, { backgroundColor: theme.primaryBg, opacity: saving ? 0.75 : 1 }]}
          activeOpacity={0.9}
        >
          {saving ? <ActivityIndicator size="small" color={theme.primaryText} /> : <Feather name="plus" size={16} color={theme.primaryText} />}
          <Text style={{ color: theme.primaryText, fontWeight: "900", fontSize: 15 }}>
            {saving ? "Adding..." : "Add personalised plan"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const sx = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
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
  headerPad: {
    width: 68,
  },
  title: {
    fontSize: 18,
    fontWeight: "900",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
  },
  sectionToggle: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  collapsedHint: {
    marginTop: 9,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  briefBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  briefGrid: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  briefMetricCard: {
    width: "48%",
    minHeight: 78,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: "center",
  },
  briefMetricValue: {
    fontSize: 15,
    fontWeight: "900",
  },
  briefMetricLabel: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
  },
  planName: {
    fontSize: 17,
    fontWeight: "900",
  },
  fieldLabel: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  controlGroup: {
    marginTop: 12,
  },
  paceSummaryCard: {
    marginTop: 6,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  paceSummaryValue: {
    fontSize: 16,
    fontWeight: "900",
  },
  paceSummarySub: {
    fontSize: 11,
    fontWeight: "700",
  },
  paceScrollRow: {
    marginTop: 8,
    gap: 8,
    paddingRight: 6,
  },
  paceChip: {
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  paceChipText: {
    fontSize: 12,
    fontWeight: "800",
  },
  chipRow: {
    marginTop: 6,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  chip: {
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  protocolRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  protocolDotWrap: {
    width: 16,
    alignItems: "center",
    marginTop: 4,
  },
  protocolDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  protocolTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  protocolText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  reasonCard: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
  },
  reasonLabel: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  reasonValue: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  weekCard: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
  },
  sessionRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
  },
  saveBtn: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
});
