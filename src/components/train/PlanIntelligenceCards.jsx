import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../../providers/ThemeProvider";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value || "").trim();
}

function titleCase(value) {
  return text(value)
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pickPaceLabel(pace) {
  if (!pace || typeof pace !== "object") return "";
  if (pace.value) return text(pace.value);
  if (pace.min && pace.max) return `${pace.min} - ${pace.max}`;
  if (Number.isFinite(Number(pace.minSecPerKm)) && Number.isFinite(Number(pace.maxSecPerKm))) {
    return `${secToPace(Number(pace.minSecPerKm))} - ${secToPace(Number(pace.maxSecPerKm))}`;
  }
  return "";
}

function pickKphLabel(pace) {
  if (!pace || typeof pace !== "object") return "";
  if (Number.isFinite(Number(pace.minKph)) && Number.isFinite(Number(pace.maxKph))) {
    return `${Number(pace.minKph).toFixed(1)}-${Number(pace.maxKph).toFixed(1)} km/h`;
  }
  if (Number.isFinite(Number(pace.kph))) return `${Number(pace.kph).toFixed(1)} km/h`;
  if (pace.kph) return text(pace.kph);
  if (pace.speed) return text(pace.speed);
  return "";
}

function shortDateTime(value) {
  const raw = text(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function secToPace(sec) {
  const total = Math.max(0, Math.round(Number(sec || 0)));
  if (!total) return "";
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}/km`;
}

function goalTone(level) {
  const key = text(level).toLowerCase();
  if (key === "realistic") return { color: "#16a34a", bg: "rgba(22,163,74,0.14)" };
  if (key === "challenging") return { color: "#0ea5e9", bg: "rgba(14,165,233,0.14)" };
  if (key === "aggressive") return { color: "#f59e0b", bg: "rgba(245,158,11,0.16)" };
  if (key === "unsafe") return { color: "#ef4444", bg: "rgba(239,68,68,0.14)" };
  return { color: "#94a3b8", bg: "rgba(148,163,184,0.14)" };
}

function approvalLabel(value) {
  const key = text(value).toLowerCase();
  if (key === "approved") return "Approved";
  if (key === "approved_with_warnings") return "Approved with warnings";
  if (key === "needs_review") return "Needs review";
  if (key === "blocked") return "Blocked";
  return titleCase(value || "Pending");
}

function issueText(issue) {
  if (!issue) return "";
  if (typeof issue === "string") return issue;
  return text(issue.message) || titleCase(issue.code);
}

function repairText(repair) {
  if (!repair) return "";
  if (typeof repair === "string") return repair;
  const type = text(repair.type || repair.reason).toLowerCase();
  if (type.includes("replace_hard_with_easy")) return "A hard session was changed to an easier run.";
  if (type.includes("reduce_session_volume")) return "An excessive session was reduced.";
  if (type.includes("add_warmup_cooldown")) return "Warm-up and cool-down guidance was added.";
  if (type.includes("add_generic_target")) return "Missing session targets were filled in.";
  if (type.includes("weekly_ramp")) return "A weekly volume jump was capped.";
  if (type.includes("long_run_share")) return "A long run was reduced to keep the week balanced.";
  if (type.includes("quality_share")) return "Quality volume was reduced for safer intensity balance.";
  return titleCase(repair.type || repair.reason || "Repair applied");
}

function completionTrendSummary(trend) {
  if (!trend || typeof trend !== "object") return [];
  const out = [];
  const average = Number(trend.averageCompletionScore);
  if (Number.isFinite(average)) out.push(`Recent completion score averaged ${Math.round(average)}/100.`);
  if (Number(trend.easyOverdoneCount) >= 2) out.push("Recent easy runs were completed faster or harder than planned.");
  if (Number(trend.partialLongRunCount) >= 2) out.push("Recent long runs were only partially completed.");
  if (Number(trend.qualityMismatchedOrPartialCount) > 0) out.push("Recent quality work was partial or did not match the planned session.");
  if (Number(trend.fatigueWarningCount) > 0) out.push("Recent sessions showed fatigue or higher-than-expected heart rate.");
  return [...new Set(out.map(text).filter(Boolean))].slice(0, 3);
}

function completionDrivenChangeText(change) {
  if (!change || typeof change !== "object") return "";
  const type = text(change.type).toLowerCase();
  const reason = text(change.reason).toLowerCase();
  const key = `${type} ${reason}`;

  if (key.includes("fatigue")) {
    return "Your next quality session was reduced because recent sessions showed fatigue.";
  }
  if (key.includes("partial_long") || key.includes("long_run")) {
    return "Your long run progression was held because recent long runs were only partially completed.";
  }
  if (key.includes("overdone_easy") || key.includes("slow_easy")) {
    return "Easy pace guidance was softened because recent easy runs were completed too fast.";
  }
  if (key.includes("quality_mismatched") || key.includes("mismatch") || key.includes("missing_quality")) {
    return "Your next quality session was reduced because recent quality work was partial or did not match the plan.";
  }
  if (key.includes("completion_score") || key.includes("recovery_rebuild")) {
    return "Next week was shifted toward recovery because recent completion scores were low.";
  }
  if (change.message) return text(change.message);
  return titleCase(change.type || "Completion-based adjustment");
}

function completionAnalysisAdjustment(weeklyRecalculation) {
  if (!weeklyRecalculation?.completionAnalysisUsed) return null;
  const changes = asArray(weeklyRecalculation.completionDrivenChanges);
  if (!changes.length) return null;
  const messages = [...new Set(changes.map(completionDrivenChangeText).map(text).filter(Boolean))];
  if (!messages.length) return null;
  return {
    summary: completionTrendSummary(weeklyRecalculation.completionTrend),
    messages,
  };
}

function generatorFeatureLabels(features) {
  if (!features || typeof features !== "object") return [];
  const labels = [];
  if (features.templateFirst) labels.push("Template-first");
  if (features.goalRealism) labels.push("Goal realism");
  if (features.dynamicPaceModel) labels.push("Dynamic paces");
  if (features.expandedFinalValidation) labels.push("Final safety pass");
  if (features.adaptiveWeeklyRecalculation) labels.push("Adaptive recalculation");
  if (features.readinessAdjustment) labels.push("Readiness adjustment");
  if (features.strengthAwareness) labels.push("Strength awareness");
  if (features.missedSessionRepair) labels.push("Missed-session repair");
  return labels;
}

function adjustmentMessages({
  readinessAdjustment,
  strengthAdjustment,
  weeklyRecalculation,
  missedSessionRepair,
}) {
  const out = [];

  if (missedSessionRepair?.message) out.push(missedSessionRepair.message);
  if (readinessAdjustment?.message) out.push(readinessAdjustment.message);
  if (weeklyRecalculation?.message) out.push(weeklyRecalculation.message);

  if (strengthAdjustment?.applied) {
    const changes = asArray(strengthAdjustment.changes);
    if (changes.length) {
      for (const change of changes.slice(0, 3)) {
        const type = titleCase(change?.type || "Adjustment");
        if (/move/i.test(type)) out.push("A hard run was moved to avoid clashing with strength training.");
        else if (/reduce/i.test(type)) out.push("A run was reduced to manage strength-training load.");
        else out.push(`${type} was applied to keep run and strength work compatible.`);
      }
    } else {
      out.push("Run placement was checked against strength training conflicts.");
    }
  }

  return [...new Set(out.map(text).filter(Boolean))];
}

function hasAnyIntelligence(props) {
  return Boolean(
    props?.planVersion ||
      props?.planSource ||
      props?.generatorFeatures ||
      props?.goalRealism ||
      props?.paceModel ||
      props?.validationSummary ||
      props?.planExplanation ||
      props?.readinessAdjustment ||
      props?.strengthAdjustment ||
      props?.weeklyRecalculation ||
      props?.missedSessionRepair
  );
}

export default function PlanIntelligenceCards({
  planSource,
  templateId,
  templateVersion,
  planVersion,
  rulesEngineVersion,
  generatedAt,
  inputProfileSnapshot,
  generatorFeatures,
  goalRealism,
  paceModel,
  validationSummary,
  planExplanation,
  readinessAdjustment,
  strengthAdjustment,
  weeklyRecalculation,
  missedSessionRepair,
  showDebug = false,
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  if (!hasAnyIntelligence({
    goalRealism,
    planSource,
    planVersion,
    generatorFeatures,
    paceModel,
    validationSummary,
    planExplanation,
    readinessAdjustment,
    strengthAdjustment,
    weeklyRecalculation,
    missedSessionRepair,
  })) {
    return null;
  }

  const tone = goalTone(goalRealism?.level);
  const paces = paceModel?.trainingPaces || {};
  const confidence = Number(paceModel?.confidence);
  const showKph = paceModel?.adjustments?.treadmill === true;
  const effortMode = paceModel?.adjustments?.preferEffortTargets === true ||
    String(paceModel?.adjustments?.targetMode || "").includes("effort");
  const warnings = asArray(validationSummary?.warnings);
  const blockers = asArray(validationSummary?.blockers);
  const repairs = asArray(validationSummary?.repairsApplied);
  const featureLabels = generatorFeatureLabels(generatorFeatures);
  const adjustments = adjustmentMessages({
    readinessAdjustment,
    strengthAdjustment,
    weeklyRecalculation,
    missedSessionRepair,
  });
  const completionAdjustment = completionAnalysisAdjustment(weeklyRecalculation);

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>Plan intelligence</Text>

      {planVersion || planSource || generatorFeatures ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Plan audit</Text>
            {generatedAt ? <Text style={styles.headerMeta}>{shortDateTime(generatedAt)}</Text> : null}
          </View>
          <View style={styles.metricRow}>
            <Metric label="Source" value={planSource === "template" ? "Template" : "Rules engine"} styles={styles} />
            {templateId ? <Metric label="Template" value={templateId} styles={styles} /> : null}
            {planVersion ? <Metric label="Plan version" value={planVersion} styles={styles} /> : null}
            {rulesEngineVersion ? <Metric label="Rules version" value={rulesEngineVersion} styles={styles} /> : null}
            {templateVersion ? <Metric label="Template version" value={templateVersion} styles={styles} /> : null}
          </View>
          {inputProfileSnapshot?.goal?.distance ? (
            <Text style={styles.body}>
              Built from a saved input snapshot for {inputProfileSnapshot.goal.distance}.
            </Text>
          ) : null}
          {featureLabels.length ? (
            <ListBlock title="Generation features" items={featureLabels} styles={styles} />
          ) : null}
        </View>
      ) : null}

      {goalRealism ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Goal confidence</Text>
            <View style={[styles.badge, { backgroundColor: tone.bg }]}>
              <Text style={[styles.badgeText, { color: tone.color }]}>
                {titleCase(goalRealism.level || "Unknown")}
              </Text>
            </View>
          </View>
          <View style={styles.metricRow}>
            <Metric label="Score" value={goalRealism.score != null ? `${goalRealism.score}/100` : "—"} styles={styles} />
            {goalRealism.suggestedTargetTime ? (
              <Metric label="Suggested target" value={goalRealism.suggestedTargetTime} styles={styles} />
            ) : null}
            {goalRealism.suggestedPlanLengthWeeks ? (
              <Metric label="Suggested length" value={`${goalRealism.suggestedPlanLengthWeeks} weeks`} styles={styles} />
            ) : null}
          </View>
          {goalRealism.message ? <Text style={styles.body}>{goalRealism.message}</Text> : null}
        </View>
      ) : null}

      {paceModel ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Training paces</Text>
            {Number.isFinite(confidence) ? (
              <Text style={styles.headerMeta}>{Math.round(confidence)}% confidence</Text>
            ) : null}
          </View>
          {effortMode ? (
            <Text style={styles.infoLine}>Use effort/HR rather than strict pace for this plan context.</Text>
          ) : null}
          <View style={styles.paceGrid}>
            {[
              ["Easy", paces.easy],
              ["Steady", paces.steady],
              ["Threshold", paces.threshold],
              ["Interval", paces.interval],
              ["Race pace", paces.racePace],
            ].map(([label, value]) => {
              const paceLabel = pickPaceLabel(value);
              const kphLabel = showKph ? pickKphLabel(value) : "";
              if (!paceLabel && !kphLabel) return null;
              return (
                <View key={`pace-${label}`} style={styles.paceItem}>
                  <Text style={styles.paceLabel}>{label}</Text>
                  {paceLabel ? <Text style={styles.paceValue}>{paceLabel}</Text> : null}
                  {kphLabel ? <Text style={styles.paceSub}>{kphLabel}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {planExplanation ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Coach summary</Text>
          {planExplanation.planSummary ? <Text style={styles.bodyStrong}>{planExplanation.planSummary}</Text> : null}
          {planExplanation.coachingSummary ? <Text style={styles.body}>{planExplanation.coachingSummary}</Text> : null}

          {!!asArray(planExplanation.keyDecisions).length && (
            <ListBlock title="Why this plan" items={planExplanation.keyDecisions} styles={styles} />
          )}
          {!!asArray(planExplanation.riskNotes).length && (
            <ListBlock title="Risk notes" items={planExplanation.riskNotes} styles={styles} tone="risk" />
          )}
        </View>
      ) : null}

      {validationSummary ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Plan safety</Text>
            <Text style={styles.headerMeta}>{approvalLabel(validationSummary.approval)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Metric label="Safety score" value={validationSummary.safetyScore != null ? `${validationSummary.safetyScore}/100` : "—"} styles={styles} />
            <Metric label="Warnings" value={String(warnings.length)} styles={styles} />
            <Metric label="Repairs" value={String(repairs.length)} styles={styles} />
          </View>
          {blockers.length ? (
            <ListBlock
              title="Needs attention"
              items={blockers.slice(0, 4).map(issueText)}
              styles={styles}
              tone="risk"
            />
          ) : null}
          {warnings.length ? (
            <ListBlock
              title="Warnings"
              items={warnings.slice(0, 4).map(issueText)}
              styles={styles}
              tone="risk"
            />
          ) : null}
          {repairs.length ? (
            <ListBlock
              title="Automatic repairs"
              items={repairs.slice(0, 4).map(repairText)}
              styles={styles}
            />
          ) : null}
        </View>
      ) : null}

      {adjustments.length || completionAdjustment ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Adjustments made</Text>
            {completionAdjustment ? <Text style={styles.headerMeta}>Completed-session analysis</Text> : null}
          </View>
          <ListBlock items={adjustments} styles={styles} />
          {completionAdjustment ? (
            <View style={styles.completionBox}>
              <Text style={styles.completionTitle}>Based on recent completed runs</Text>
              {completionAdjustment.summary.length ? (
                <ListBlock items={completionAdjustment.summary} styles={styles} />
              ) : null}
              <ListBlock items={completionAdjustment.messages} styles={styles} />
            </View>
          ) : null}
        </View>
      ) : null}

      {showDebug ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Developer details</Text>
          <Text style={styles.body}>Debug traces are intentionally hidden for normal users.</Text>
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value, styles }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ListBlock({ title, items, styles, tone = "normal" }) {
  const clean = asArray(items).map(text).filter(Boolean).slice(0, 6);
  if (!clean.length) return null;
  return (
    <View style={styles.listBlock}>
      {title ? <Text style={styles.listTitle}>{title}</Text> : null}
      {clean.map((item, index) => (
        <View key={`${title || "item"}-${index}`} style={styles.listRow}>
          <View style={[styles.dot, tone === "risk" && styles.dotRisk]} />
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors = {}, isDark = false) {
  const textColor = colors?.text ?? (isDark ? "#F8FAFC" : "#0F172A");
  const subtext = colors?.subtext ?? (isDark ? "#A1A1AA" : "#64748B");
  const card = colors?.card ?? (isDark ? "#10131A" : "#FFFFFF");
  const border = isDark ? "rgba(255,255,255,0.12)" : "#E1E3E8";
  const surface = isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC";

  return StyleSheet.create({
    wrap: {
      gap: 10,
      marginBottom: 12,
    },
    sectionTitle: {
      color: textColor,
      fontSize: 20,
      fontWeight: "900",
      marginTop: 4,
      marginBottom: 0,
      letterSpacing: 0,
    },
    card: {
      backgroundColor: card,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      padding: 13,
      gap: 10,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    cardTitle: {
      color: textColor,
      fontSize: 15,
      fontWeight: "900",
      letterSpacing: 0,
      flex: 1,
    },
    headerMeta: {
      color: subtext,
      fontSize: 12,
      fontWeight: "800",
      textAlign: "right",
    },
    badge: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "900",
    },
    body: {
      color: subtext,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "600",
    },
    bodyStrong: {
      color: textColor,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "800",
    },
    infoLine: {
      color: textColor,
      backgroundColor: surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "800",
    },
    metricRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    metric: {
      flexGrow: 1,
      minWidth: "30%",
      backgroundColor: surface,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    metricLabel: {
      color: subtext,
      fontSize: 10,
      fontWeight: "800",
      marginBottom: 4,
    },
    metricValue: {
      color: textColor,
      fontSize: 14,
      fontWeight: "900",
    },
    paceGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    paceItem: {
      width: "48%",
      minWidth: 130,
      flexGrow: 1,
      backgroundColor: surface,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    paceLabel: {
      color: subtext,
      fontSize: 10,
      fontWeight: "800",
      marginBottom: 4,
    },
    paceValue: {
      color: textColor,
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "900",
    },
    paceSub: {
      color: subtext,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "700",
      marginTop: 2,
    },
    listBlock: {
      gap: 7,
    },
    completionBox: {
      backgroundColor: surface,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: border,
      paddingHorizontal: 10,
      paddingVertical: 9,
      gap: 8,
    },
    completionTitle: {
      color: textColor,
      fontSize: 12,
      fontWeight: "900",
    },
    listTitle: {
      color: textColor,
      fontSize: 12,
      fontWeight: "900",
      marginTop: 2,
    },
    listRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: "#16a34a",
      marginTop: 6,
    },
    dotRisk: {
      backgroundColor: "#f59e0b",
    },
    listText: {
      flex: 1,
      color: subtext,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "650",
    },
  });
}
