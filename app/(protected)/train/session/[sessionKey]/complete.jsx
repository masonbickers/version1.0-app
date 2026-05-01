import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, {
  Line as SvgLine,
  Path as SvgPath,
} from "react-native-svg";

import { auth, db } from "../../../../../firebaseConfig";
import { useLiveActivity } from "../../../../../providers/LiveActivityProvider";
import { useTheme } from "../../../../../providers/ThemeProvider";
import { decodeSessionKey } from "../../../../../src/train/utils/sessionHelpers";
import {
  buildPlannedTrainSessionPayload,
  loadPlannedSessionRecord,
  stripNilValues,
} from "../../../../../src/train/utils/sessionRecordHelpers";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function withAlpha(color, alphaHex) {
  const raw = String(color || "").trim();
  const alpha = String(alphaHex || "").trim();
  if (!/^([0-9A-Fa-f]{2})$/.test(alpha)) return raw;
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return `${raw}${alpha}`;
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}${alpha}`;
  }
  return raw;
}

function getLocalDateOnly(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function secondsToClock(sec) {
  const total = Math.max(0, Math.floor(Number(sec || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatPaceFromSec(value, fallback = "—") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const mins = Math.floor(n / 60);
  const secs = Math.round(n % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}/km`;
}

function formatDurationShort(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 60) return `${Math.round(n)}s`;
  const mins = Math.floor(n / 60);
  const secs = Math.round(n % 60);
  if (!secs) return `${mins} min`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function formatDistanceKm(value, digits = 1, fallback = "—") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return `${n.toFixed(digits)} km`;
}

function formatSignedPaceDelta(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  const mins = Math.floor(Math.abs(n) / 60);
  const secs = Math.round(Math.abs(n) % 60)
    .toString()
    .padStart(2, "0");
  return `${n > 0 ? "+" : "-"}${mins}:${secs}/km`;
}

function mean(values) {
  const safe = Array.isArray(values)
    ? values.filter((v) => Number.isFinite(Number(v)))
    : [];
  if (!safe.length) return null;
  return safe.reduce((sum, value) => sum + Number(value), 0) / safe.length;
}

function stdDev(values) {
  const safe = Array.isArray(values)
    ? values.filter((v) => Number.isFinite(Number(v)))
    : [];
  if (safe.length < 2) return null;
  const avg = mean(safe);
  if (!Number.isFinite(avg)) return null;
  const variance =
    safe.reduce((sum, value) => sum + (Number(value) - avg) ** 2, 0) / safe.length;
  return Math.sqrt(variance);
}

function compactText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePaceStringToSec(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const rangeMatch = text.match(/(\d{1,2}:\d{2})\s*(?:-|to)\s*(\d{1,2}:\d{2})\s*(?:\/\s*km|per\s*km|km)/i);
  if (rangeMatch) {
    const a = parsePaceStringToSec(rangeMatch[1]);
    const b = parsePaceStringToSec(rangeMatch[2]);
    if (a != null && b != null) return (a + b) / 2;
  }

  const match = text.match(/(\d{1,2}):(\d{2})(?:\s*\/\s*km|\s*per\s*km|\s*km)?/i);
  if (!match) return null;
  const mins = Number(match[1]);
  const secs = Number(match[2]);
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
  return mins * 60 + secs;
}

function stringifyTarget(target) {
  if (!target) return "";
  if (typeof target === "string") return target;
  if (typeof target !== "object") return "";
  return [
    target.label,
    target.value,
    target.min,
    target.max,
    target.minPace,
    target.maxPace,
    target.type,
    target.unit,
  ]
    .filter(Boolean)
    .join(" ");
}

function classifyPlannedStepRole(step) {
  const haystack = compactText(
    [
      step?.title,
      step?.type,
      step?.notes,
      stringifyTarget(step?.target),
      step?.durationLabel,
    ].join(" ")
  ).toLowerCase();

  if (/\b(warm[\s-]?up|wu)\b/.test(haystack)) return "warmup";
  if (/\b(cool[\s-]?down|cd)\b/.test(haystack)) return "cooldown";
  if (/\b(recovery|recover|rest|float|walk|jog)\b/.test(haystack)) return "recovery";
  return "work";
}

function normalisePlannedSteps(payload) {
  const sequence = Array.isArray(payload?.live?.steps?.sequence)
    ? payload.live.steps.sequence
    : [];

  return sequence.map((step, idx) => {
    const targetText = stringifyTarget(step?.target);
    const paceBits = [
      targetText,
      step?.notes,
      step?.durationLabel,
      step?.title,
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      index: idx + 1,
      title: String(step?.title || `Step ${idx + 1}`),
      role: classifyPlannedStepRole(step),
      distanceKm:
        Number.isFinite(Number(step?.distanceM)) && Number(step.distanceM) > 0
          ? Number(step.distanceM) / 1000
          : null,
      timeSec:
        Number.isFinite(Number(step?.timeSec)) && Number(step.timeSec) > 0
          ? Number(step.timeSec)
          : null,
      durationLabel: String(step?.durationLabel || "").trim(),
      targetLabel: compactText(targetText),
      targetPaceSec: parsePaceStringToSec(paceBits),
      notes: compactText(step?.notes || ""),
    };
  });
}

function normaliseSplitRows(splits) {
  let previousKm = 0;

  return (Array.isArray(splits) ? splits : [])
    .map((item, idx) => {
      const currentKm = toNum(item?.km);
      let distanceKm = toNum(item?.distanceKm);

      if (!(distanceKm > 0)) {
        if (currentKm != null && currentKm > previousKm) {
          distanceKm = currentKm - previousKm;
        } else if (!item?.manual) {
          distanceKm = 1;
        }
      }

      const movingSec = Math.max(1, Number(item?.splitSec || item?.movingSec || 0));
      const cumulativeKm =
        currentKm != null && currentKm > 0
          ? currentKm
          : previousKm + (distanceKm || 0);
      const paceSec =
        distanceKm && movingSec > 0
          ? movingSec / distanceKm
          : parsePaceStringToSec(item?.pace);

      const row = {
        index: idx + 1,
        label: item?.manual ? `Lap ${idx + 1}` : `Split ${idx + 1}`,
        distanceKm: distanceKm || 0,
        movingSec,
        elapsedSec: movingSec,
        paceSec,
        cumulativeKm,
        manual: !!item?.manual,
      };

      previousKm = cumulativeKm;
      return row;
    })
    .filter((row) => row.distanceKm > 0 && row.movingSec > 0);
}

function classifyActualSplitRows(rows) {
  if (!rows.length) {
    return { rows: [], warmupRows: [], cooldownRows: [], coreRows: [] };
  }

  const paces = rows
    .map((row) => Number(row?.paceSec || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const medianPace = paces.length ? paces[Math.floor(paces.length / 2)] : null;

  const next = rows.map((row) => ({ ...row, role: "work" }));
  const first = next[0];
  const last = next[next.length - 1];

  if (
    first &&
    medianPace &&
    first.paceSec > medianPace * 1.12 &&
    (first.distanceKm >= 0.9 || first.movingSec >= 240)
  ) {
    first.role = "warmup";
  }

  if (
    last &&
    last !== first &&
    medianPace &&
    last.paceSec > medianPace * 1.12 &&
    (last.distanceKm >= 0.8 || last.movingSec >= 180)
  ) {
    last.role = "cooldown";
  }

  return {
    rows: next,
    warmupRows: next.filter((row) => row.role === "warmup"),
    cooldownRows: next.filter((row) => row.role === "cooldown"),
    coreRows: next.filter((row) => row.role === "work"),
  };
}

function pickExecutionRows({ splitRows, manualRows, coreRows, plannedWorkCount }) {
  const candidates = [
    { key: "manual", rows: manualRows },
    { key: "core", rows: coreRows },
    { key: "all", rows: splitRows },
  ].filter((candidate) => Array.isArray(candidate.rows) && candidate.rows.length > 0);

  if (!candidates.length) return { source: "none", rows: [] };
  if (!(plannedWorkCount > 0)) return candidates[0];

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: Math.abs(candidate.rows.length - plannedWorkCount),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return b.rows.length - a.rows.length;
    })[0];
}

function buildRunCompletionReview(payload, notesValue) {
  const plannedSteps = normalisePlannedSteps(payload);
  const plannedWorkSteps = plannedSteps.filter((step) => step.role === "work");
  const plannedRecoverySteps = plannedSteps.filter((step) => step.role === "recovery");
  const plannedWarmupSteps = plannedSteps.filter((step) => step.role === "warmup");
  const plannedCooldownSteps = plannedSteps.filter((step) => step.role === "cooldown");
  const plannedTargetPaceSec = mean(
    plannedWorkSteps.map((step) => step.targetPaceSec).filter((value) => value != null)
  );
  const plannedWorkDistanceKm = plannedWorkSteps.reduce(
    (sum, step) => sum + (Number(step.distanceKm || 0) || 0),
    0
  );

  const splitRows = normaliseSplitRows(payload?.live?.splits);
  const classified = classifyActualSplitRows(splitRows);
  const manualRows = classifyActualSplitRows(splitRows.filter((row) => row.manual));
  const chosen = pickExecutionRows({
    splitRows,
    manualRows: manualRows.coreRows.length ? manualRows.coreRows : manualRows.rows,
    coreRows: classified.coreRows,
    plannedWorkCount: plannedWorkSteps.length,
  });
  const workRows = chosen.rows;

  const workPaces = workRows
    .map((row) => Number(row?.paceSec || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgWorkPaceSec = mean(workPaces);
  const fastestWorkPaceSec = workPaces.length ? Math.min(...workPaces) : null;
  const consistencySec = stdDev(workPaces);
  const completionRate =
    plannedWorkSteps.length > 0 ? workRows.length / plannedWorkSteps.length : null;
  const actualWorkDistanceKm = workRows.reduce(
    (sum, row) => sum + (Number(row.distanceKm || 0) || 0),
    0
  );
  const targetDeltaSec =
    avgWorkPaceSec != null && plannedTargetPaceSec != null
      ? avgWorkPaceSec - plannedTargetPaceSec
      : null;

  const lastWorkPace = workRows.length
    ? Number(workRows[workRows.length - 1]?.paceSec || 0) || null
    : null;

  const executionLabel =
    consistencySec == null
      ? "Review ready"
      : consistencySec <= 4
        ? "Very well executed"
        : consistencySec <= 8
          ? "Solid execution"
          : consistencySec <= 14
            ? "Mixed execution"
            : "Pacing was inconsistent";

  const strengths = [];
  const weakPoints = [];
  const suggestions = [];

  if (completionRate != null && completionRate >= 0.98) {
    strengths.push("You completed the full planned work set.");
  } else if (completionRate != null && completionRate < 0.9) {
    weakPoints.push("You did not fully match the planned number of work reps.");
    suggestions.push("Use the lap button on each rep and recovery so the set is captured cleanly.");
  }

  if (targetDeltaSec != null) {
    if (Math.abs(targetDeltaSec) <= 5) {
      strengths.push(
        `Average work pace stayed close to target at ${formatPaceFromSec(avgWorkPaceSec)} versus planned ${formatPaceFromSec(plannedTargetPaceSec)}.`
      );
    } else if (targetDeltaSec > 5) {
      weakPoints.push(
        `Work pace averaged ${formatSignedPaceDelta(targetDeltaSec)} slower than the planned set pace.`
      );
      suggestions.push("Start a touch more assertively after the first rep and protect the recoveries.");
    } else {
      strengths.push(
        `You ran faster than target on average at ${formatPaceFromSec(avgWorkPaceSec)}.`
      );
      suggestions.push("Keep that speed under control if the goal is threshold or controlled session work.");
    }
  }

  if (consistencySec != null) {
    if (consistencySec <= 6) {
      strengths.push(`Pacing control was tight with only ${Math.round(consistencySec)} sec/km variation across the work reps.`);
    } else if (consistencySec > 10) {
      weakPoints.push(`Work reps varied by about ${Math.round(consistencySec)} sec/km, so the set drifted more than ideal.`);
      suggestions.push("Keep the first two reps calmer so the middle of the set stays controlled.");
    }
  }

  if (lastWorkPace != null && avgWorkPaceSec != null) {
    if (lastWorkPace <= avgWorkPaceSec - 4) {
      strengths.push("You finished the work set strongly without obvious fade.");
    } else if (lastWorkPace >= avgWorkPaceSec + 8) {
      weakPoints.push("The final reps faded off the average set pace.");
      suggestions.push("Shorten the recovery less, not more, and hold form later in the set.");
    }
  }

  if (!strengths.length) {
    strengths.push("You logged enough data to review the session against the plan.");
  }
  if (!suggestions.length) {
    suggestions.push("Keep logging every work rep so the next review can judge execution even more accurately.");
  }

  const summaryBits = [];
  if (plannedWorkSteps.length) summaryBits.push(`${plannedWorkSteps.length} planned reps`);
  if (workRows.length) summaryBits.push(`${workRows.length} analysed laps`);
  if (avgWorkPaceSec != null) summaryBits.push(`avg ${formatPaceFromSec(avgWorkPaceSec)}`);
  if (plannedTargetPaceSec != null) summaryBits.push(`target ${formatPaceFromSec(plannedTargetPaceSec)}`);

  const summary =
    summaryBits.length > 0
      ? `${executionLabel}. ${summaryBits.join(" · ")}.${chosen.key === "manual" ? " Review is based on your manual laps." : chosen.key === "core" ? " Review is based on your core split pattern." : " Review is based on the available split data."}`
      : "Session review is ready.";

  const workoutBars = (workRows.length ? workRows : splitRows)
    .slice(0, 32)
    .map((row, idx) => ({
      x: idx + 1,
      y: Number(row?.paceSec || 0) / 60,
    }))
    .filter((item) => Number.isFinite(item.y) && item.y > 0);

  let distanceAxisKm = 0;
  const paceLinePoints = (workRows.length ? workRows : splitRows)
    .map((row) => {
      distanceAxisKm += Number(row.distanceKm || 0);
      return {
        x: distanceAxisKm,
        y: Number(row?.paceSec || 0) / 60,
      };
    })
    .filter((item) => Number.isFinite(item.y) && item.y > 0);

  return {
    planned: {
      workCount: plannedWorkSteps.length,
      recoveryCount: plannedRecoverySteps.length,
      warmupCount: plannedWarmupSteps.length,
      cooldownCount: plannedCooldownSteps.length,
      workDistanceKm: plannedWorkDistanceKm > 0 ? plannedWorkDistanceKm : null,
      targetPaceSec: plannedTargetPaceSec,
      overviewLines: [
        plannedWarmupSteps.length ? `Warm-up: ${plannedWarmupSteps.length} step${plannedWarmupSteps.length === 1 ? "" : "s"}` : null,
        plannedWorkSteps.length
          ? `Main set: ${plannedWorkSteps.length} rep${plannedWorkSteps.length === 1 ? "" : "s"}${plannedWorkDistanceKm > 0 ? ` · ${formatDistanceKm(plannedWorkDistanceKm)}` : ""}${plannedTargetPaceSec ? ` · ${formatPaceFromSec(plannedTargetPaceSec)}` : ""}`
          : null,
        plannedRecoverySteps.length ? `Recoveries: ${plannedRecoverySteps.length}` : null,
        plannedCooldownSteps.length ? `Cool-down: ${plannedCooldownSteps.length} step${plannedCooldownSteps.length === 1 ? "" : "s"}` : null,
      ].filter(Boolean),
    },
    actual: {
      sourceKey: chosen.key,
      sourceLabel:
        chosen.key === "manual"
          ? "Manual laps"
          : chosen.key === "core"
            ? "Core split pattern"
            : "Available splits",
      totalLaps: splitRows.length,
      analysedLapCount: workRows.length,
      avgWorkPaceSec,
      fastestWorkPaceSec,
      consistencySec,
      completionRate,
      actualWorkDistanceKm: actualWorkDistanceKm > 0 ? actualWorkDistanceKm : null,
      targetDeltaSec,
      warmupLapCount: classified.warmupRows.length,
      cooldownLapCount: classified.cooldownRows.length,
    },
    splitRows,
    classifiedRows: classified.rows,
    analysedRows: workRows,
    workoutBars,
    paceLinePoints,
    analysis: {
      summary,
      strengths: strengths.slice(0, 3),
      weakPoints: weakPoints.slice(0, 3),
      suggestions: suggestions.slice(0, 3),
      generatedFrom: "completion_review",
      generatedAtMs: Date.now(),
      reviewSource: chosen.key,
      notesSnapshot: compactText(notesValue),
    },
  };
}

function compactRunReviewForStorage(runReview) {
  if (!runReview || typeof runReview !== "object") return null;

  return {
    planned: {
      workCount: Number(runReview?.planned?.workCount || 0) || 0,
      recoveryCount: Number(runReview?.planned?.recoveryCount || 0) || 0,
      workDistanceKm: Number.isFinite(Number(runReview?.planned?.workDistanceKm))
        ? Number(Number(runReview.planned.workDistanceKm).toFixed(2))
        : null,
      targetPaceSec: Number.isFinite(Number(runReview?.planned?.targetPaceSec))
        ? Math.round(Number(runReview.planned.targetPaceSec))
        : null,
    },
    actual: {
      sourceKey: String(runReview?.actual?.sourceKey || "").trim() || null,
      analysedLapCount: Number(runReview?.actual?.analysedLapCount || 0) || 0,
      avgWorkPaceSec: Number.isFinite(Number(runReview?.actual?.avgWorkPaceSec))
        ? Math.round(Number(runReview.actual.avgWorkPaceSec))
        : null,
      fastestWorkPaceSec: Number.isFinite(Number(runReview?.actual?.fastestWorkPaceSec))
        ? Math.round(Number(runReview.actual.fastestWorkPaceSec))
        : null,
      consistencySec: Number.isFinite(Number(runReview?.actual?.consistencySec))
        ? Math.round(Number(runReview.actual.consistencySec))
        : null,
      completionRate: Number.isFinite(Number(runReview?.actual?.completionRate))
        ? Number(Number(runReview.actual.completionRate).toFixed(3))
        : null,
      actualWorkDistanceKm: Number.isFinite(Number(runReview?.actual?.actualWorkDistanceKm))
        ? Number(Number(runReview.actual.actualWorkDistanceKm).toFixed(2))
        : null,
      targetDeltaSec: Number.isFinite(Number(runReview?.actual?.targetDeltaSec))
        ? Math.round(Number(runReview.actual.targetDeltaSec))
        : null,
    },
    analysis: {
      reviewSource: String(runReview?.analysis?.reviewSource || "").trim() || null,
      generatedAtMs: Number.isFinite(Number(runReview?.analysis?.generatedAtMs))
        ? Number(runReview.analysis.generatedAtMs)
        : Date.now(),
      summary: String(runReview?.analysis?.summary || "").trim() || null,
    },
  };
}

function SummaryStat({ label, value, sub, colors, accent = null }) {
  return (
    <View
      style={[
        styles.summaryStatCard,
        { backgroundColor: colors.card, borderColor: "transparent" },
      ]}
    >
      <Text style={[styles.summaryStatLabel, { color: colors.subtext }]}>{label}</Text>
      <Text style={[styles.summaryStatValue, { color: accent || colors.text }]}>{value}</Text>
      {!!sub && <Text style={[styles.summaryStatSub, { color: colors.subtext }]}>{sub}</Text>}
    </View>
  );
}

function DetailPill({ text, colors, backgroundColor, textColor }) {
  if (!text) return null;
  return (
    <View
      style={[
        styles.detailPill,
        { backgroundColor: backgroundColor || colors.card, borderColor: "transparent" },
      ]}
    >
      <Text style={[styles.detailPillText, { color: textColor || colors.text }]}>{text}</Text>
    </View>
  );
}

function SectionCard({ title, right, children, colors }) {
  return (
    <View
      style={[
        styles.sectionCard,
        { backgroundColor: colors.card, borderColor: "transparent" },
      ]}
    >
      <View style={styles.sectionCardHeader}>
        <Text style={[styles.sectionCardTitle, { color: colors.text }]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function LineProfileChart({ data, colors, accent }) {
  const width = 332;
  const height = 150;
  const padLeft = 10;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 18;
  const border = withAlpha(colors.text, "18");
  const safe = Array.isArray(data)
    ? data.filter(
        (point) =>
          Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
      )
    : [];

  if (safe.length < 2) return null;

  const minX = Math.min(...safe.map((point) => Number(point.x)));
  const maxXRaw = Math.max(...safe.map((point) => Number(point.x)));
  const maxX = maxXRaw > minX ? maxXRaw : minX + 1;
  const rawMinY = Math.min(...safe.map((point) => Number(point.y)));
  const rawMaxY = Math.max(...safe.map((point) => Number(point.y)));
  const yPad = Math.max((rawMaxY - rawMinY) * 0.08, 0.15);
  const minY = rawMinY - yPad;
  const maxY = rawMaxY + yPad;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const xFor = (x) =>
    padLeft + ((Number(x) - minX) / (maxX - minX || 1)) * plotW;
  const yFor = (y) =>
    padTop + ((maxY - Number(y)) / (maxY - minY || 1)) * plotH;

  const path = safe
    .map(
      (point, idx) =>
        `${idx === 0 ? "M" : "L"} ${xFor(point.x).toFixed(2)} ${yFor(point.y).toFixed(2)}`
    )
    .join(" ");
  const areaPath =
    `${path} ` +
    `L ${xFor(safe[safe.length - 1].x).toFixed(2)} ${(height - padBottom).toFixed(2)} ` +
    `L ${xFor(safe[0].x).toFixed(2)} ${(height - padBottom).toFixed(2)} Z`;
  const avgY = safe.reduce((sum, point) => sum + Number(point.y), 0) / safe.length;
  const avgLineY = yFor(avgY);

  return (
    <View style={{ marginTop: 10 }}>
      <View style={[styles.chartShell, { backgroundColor: colors.bg, borderColor: "transparent" }]}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <SvgLine x1={padLeft} y1={padTop + plotH * 0.25} x2={width - padRight} y2={padTop + plotH * 0.25} stroke={border} strokeWidth={1} opacity={0.45} />
          <SvgLine x1={padLeft} y1={padTop + plotH * 0.5} x2={width - padRight} y2={padTop + plotH * 0.5} stroke={border} strokeWidth={1} opacity={0.45} />
          <SvgLine x1={padLeft} y1={padTop + plotH * 0.75} x2={width - padRight} y2={padTop + plotH * 0.75} stroke={border} strokeWidth={1} opacity={0.45} />
          <SvgPath d={areaPath} fill={accent} opacity={0.18} />
          <SvgPath d={path} fill="none" stroke={accent} strokeWidth={2.5} />
          <SvgLine
            x1={padLeft}
            y1={avgLineY}
            x2={width - padRight}
            y2={avgLineY}
            stroke={withAlpha(colors.text, "60")}
            strokeDasharray="5 4"
            strokeWidth={1}
          />
        </Svg>
      </View>
      <View style={styles.chartAxisRow}>
        <Text style={[styles.chartAxisText, { color: colors.subtext }]}>0 km</Text>
        <Text style={[styles.chartAxisText, { color: colors.subtext }]}>
          {`${Math.max(0, Math.round(maxX * 10) / 10)} km`}
        </Text>
      </View>
    </View>
  );
}

function WorkoutAnalysisChart({ data, colors, accent }) {
  const bars = Array.isArray(data)
    ? data.filter((item) => Number.isFinite(Number(item?.y)) && Number(item.y) > 0)
    : [];
  if (bars.length < 2) return null;

  const max = Math.max(...bars.map((bar) => Number(bar.y)));
  const min = Math.min(...bars.map((bar) => Number(bar.y)));
  const avg = bars.reduce((sum, bar) => sum + Number(bar.y || 0), 0) / bars.length;
  const chartH = 124;
  const barW = 14;
  const gap = 4;
  const rowW = bars.length * (barW + gap);
  const scale = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || max === min) return chartH * 0.62;
    const normalized = (n - min) / (max - min);
    return 30 + normalized * (chartH - 40);
  };
  const avgHeight = scale(avg);

  return (
    <View style={{ marginTop: 10 }}>
      <View
        style={[
          styles.chartShell,
          {
            height: chartH,
            justifyContent: "flex-end",
            overflow: "hidden",
            backgroundColor: colors.bg,
            borderColor: "transparent",
          },
        ]}
      >
        <View
          style={[
            styles.chartAverageLine,
            { bottom: 10 + avgHeight - 1, borderColor: withAlpha(colors.text, "60") },
          ]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", width: rowW, gap }}>
            {bars.map((bar, idx) => (
              <View
                key={`complete-wa-${idx}`}
                style={{
                  width: barW,
                  height: scale(bar.y),
                  borderRadius: 4,
                  backgroundColor: accent,
                  opacity: 0.96,
                }}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function SplitRoleChip({ role, colors }) {
  const isWarm = role === "warmup";
  const isCool = role === "cooldown";
  return (
    <View
      style={[
        styles.splitRoleChip,
        {
          backgroundColor: isWarm || isCool ? colors.card : withAlpha(colors.primary, "24"),
        },
      ]}
    >
      <Text
        style={[
          styles.splitRoleChipText,
          {
            color: isWarm || isCool ? colors.subtext : colors.primary,
          },
        ]}
      >
        {isWarm ? "Warm-up" : isCool ? "Cool-down" : "Work"}
      </Text>
    </View>
  );
}

export default function SessionCompleteScreen() {
  const router = useRouter();
  const {
    sessionKey,
    status: statusParam,
    returnWeekIndex: returnWeekIndexParam,
    returnDayIndex: returnDayIndexParam,
    returnToken: returnTokenParam,
  } = useLocalSearchParams();
  const { colors } = useTheme();
  const { liveActivity, clearLiveActivity } = useLiveActivity();

  const accent = colors?.primary ?? "#E6FF3B";
  const card2 = colors?.card ?? "#101219";
  const cardSoft = colors?.surfaceAlt ?? "#0E1014";
  const accentSoft = withAlpha(accent, "24");

  const encodedKey = useMemo(
    () => (Array.isArray(sessionKey) ? sessionKey[0] : String(sessionKey || "")),
    [sessionKey]
  );
  const returnWeekIndex = useMemo(() => {
    const raw = Array.isArray(returnWeekIndexParam) ? returnWeekIndexParam[0] : returnWeekIndexParam;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
  }, [returnWeekIndexParam]);
  const returnDayIndex = useMemo(() => {
    const raw = Array.isArray(returnDayIndexParam) ? returnDayIndexParam[0] : returnDayIndexParam;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed < 7 ? Math.round(parsed) : null;
  }, [returnDayIndexParam]);
  const hasExplicitTrainReturn = useMemo(
    () =>
      String(Array.isArray(returnTokenParam) ? returnTokenParam[0] : returnTokenParam || "").trim().length > 0 &&
      returnWeekIndex != null &&
      returnDayIndex != null,
    [returnDayIndex, returnTokenParam, returnWeekIndex]
  );

  const goBackToPreviousScreen = useCallback(() => {
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }
    if (hasExplicitTrainReturn) {
      router.replace({
        pathname: "/train",
        params: {
          returnWeekIndex: String(returnWeekIndex),
          returnDayIndex: String(returnDayIndex),
          returnToken: String(Date.now()),
        },
      });
      return;
    }
    router.replace("/train");
  }, [hasExplicitTrainReturn, returnDayIndex, returnWeekIndex, router]);

  const initialStatus = String(Array.isArray(statusParam) ? statusParam[0] : statusParam || "").toLowerCase();
  const [status, setStatus] = useState(initialStatus === "skipped" ? "skipped" : "completed");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [existingTrainSessionId, setExistingTrainSessionId] = useState(null);

  const pendingSaveDraft = useMemo(() => {
    const draft = liveActivity?.pendingSaveDraft;
    if (!draft || typeof draft !== "object") return null;
    if (!encodedKey) return null;
    if (draft?.sessionKey && String(draft.sessionKey) !== String(encodedKey)) return null;
    return draft;
  }, [encodedKey, liveActivity?.pendingSaveDraft]);
  const hasLiveDraft = !!pendingSaveDraft?.payload;
  const isRunLiveDraft = hasLiveDraft && pendingSaveDraft?.mode !== "strength";
  const runReview = useMemo(
    () => (isRunLiveDraft ? buildRunCompletionReview(pendingSaveDraft?.payload || {}, notes) : null),
    [isRunLiveDraft, notes, pendingSaveDraft?.payload]
  );

  useEffect(() => {
    if (hasLiveDraft) {
      setNotes(String(pendingSaveDraft?.payload?.notes || ""));
    }
  }, [hasLiveDraft, pendingSaveDraft?.payload?.notes]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid || !encodedKey) return;

        const snap = await getDoc(doc(db, "users", uid, "sessionLogs", encodedKey));
        if (!snap.exists()) return;

        const log = snap.data() || {};
        const nextTrainSessionId = String(log?.lastTrainSessionId || "").trim();

        if (cancelled) return;

        setExistingTrainSessionId(nextTrainSessionId || null);

        if (!hasLiveDraft) {
          setStatus(String(log?.status || initialStatus || "").toLowerCase() === "skipped" ? "skipped" : "completed");
          setNotes(String(log?.notes || ""));
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [encodedKey, hasLiveDraft, initialStatus]);

  const save = useCallback(async () => {
    try {
      if (!encodedKey) {
        Alert.alert("Invalid session", "This session link is missing its key.");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      setSaving(true);
      const { planId, weekIndex, dayIndex, sessionIndex } = decodeSessionKey(encodedKey);
      const trimmedNotes = notes.trim();
      const source = hasLiveDraft ? "live_save" : "manual_log";
      const sessionLogRef = doc(db, "users", uid, "sessionLogs", encodedKey);
      const existingLogSnap = await getDoc(sessionLogRef);
      const existingLog = existingLogSnap.exists() ? existingLogSnap.data() || {} : null;
      const resolvedTrainSessionId =
        String(existingTrainSessionId || existingLog?.lastTrainSessionId || "").trim() || null;

      let trainSessionRef = resolvedTrainSessionId
        ? doc(db, "users", uid, "trainSessions", resolvedTrainSessionId)
        : doc(collection(db, "users", uid, "trainSessions"));

      let hasExistingTrainSession = false;
      if (resolvedTrainSessionId) {
        const trainSessionSnap = await getDoc(trainSessionRef);
        hasExistingTrainSession = trainSessionSnap.exists();
        if (!hasExistingTrainSession) {
          trainSessionRef = doc(collection(db, "users", uid, "trainSessions"));
        }
      }

      let trainSessionPayload;
      let sessionDate = getLocalDateOnly();
      const storedRunReview =
        status === "completed" && hasLiveDraft ? compactRunReviewForStorage(runReview) : null;

      if (hasLiveDraft) {
        const payload = pendingSaveDraft?.payload || {};
        sessionDate = payload?.date || sessionDate;
        trainSessionPayload = {
          ...payload,
          sessionKey: encodedKey,
          notes: trimmedNotes || payload?.notes || "",
          status,
          source: "live_save",
        };

        if (status === "completed" && runReview?.analysis) {
          trainSessionPayload.analysis = runReview.analysis;
        }
        if (status === "completed" && storedRunReview) {
          trainSessionPayload.runReview = storedRunReview;
        } else if (status !== "completed" && hasExistingTrainSession) {
          trainSessionPayload.analysis = deleteField();
          trainSessionPayload.runReview = deleteField();
        }
      } else {
        const plannedRecord = await loadPlannedSessionRecord(uid, encodedKey);
        if (!plannedRecord?.planDoc || !plannedRecord?.session) {
          Alert.alert("Save failed", "Could not find the planned session to save.");
          return;
        }

        const plannedPayload = buildPlannedTrainSessionPayload({
          encodedKey,
          planDoc: plannedRecord.planDoc,
          session: plannedRecord.session,
          dayLabel: plannedRecord.dayLabel,
          status,
          notes: trimmedNotes,
          source: "manual_log",
        });

        sessionDate = plannedPayload.date || sessionDate;
        trainSessionPayload = {
          ...stripNilValues(plannedPayload),
          notes: trimmedNotes || null,
        };
        if (hasExistingTrainSession) {
          delete trainSessionPayload.source;
        }
      }

      const statusFieldsForTrainSession =
        status === "completed"
          ? hasExistingTrainSession
            ? {
                updatedAt: serverTimestamp(),
                completedAt: serverTimestamp(),
                skippedAt: deleteField(),
              }
            : {
                createdAt: serverTimestamp(),
                completedAt: serverTimestamp(),
              }
          : hasExistingTrainSession
            ? {
                updatedAt: serverTimestamp(),
                skippedAt: serverTimestamp(),
                completedAt: deleteField(),
              }
            : {
                createdAt: serverTimestamp(),
                skippedAt: serverTimestamp(),
              };

      const sessionLogPayload = {
        sessionKey: encodedKey,
        planId: planId || null,
        weekIndex,
        dayIndex,
        sessionIndex,
        date: sessionDate,
        status,
        source,
        notes: trimmedNotes || null,
        lastTrainSessionId: trainSessionRef.id,
        updatedAt: serverTimestamp(),
        statusAt: serverTimestamp(),
        ...(status === "completed"
          ? { completedAt: serverTimestamp(), skippedAt: deleteField() }
          : { skippedAt: serverTimestamp(), completedAt: deleteField() }),
      };

      if (hasLiveDraft) {
        if (trainSessionPayload?.live) sessionLogPayload.live = trainSessionPayload.live;
        if (trainSessionPayload?.avgRPE != null) sessionLogPayload.avgRPE = trainSessionPayload.avgRPE;
        if (status === "completed" && trainSessionPayload?.analysis) {
          sessionLogPayload.analysis = trainSessionPayload.analysis;
        }
        if (status === "completed" && trainSessionPayload?.runReview) {
          sessionLogPayload.runReview = trainSessionPayload.runReview;
        } else if (status !== "completed" && existingLogSnap.exists()) {
          sessionLogPayload.analysis = deleteField();
          sessionLogPayload.runReview = deleteField();
        }
      }

      if (!existingLogSnap.exists()) {
        sessionLogPayload.createdAt = serverTimestamp();
      }

      const batch = writeBatch(db);
      batch.set(
        trainSessionRef,
        {
          ...trainSessionPayload,
          ...statusFieldsForTrainSession,
        },
        { merge: hasExistingTrainSession }
      );
      batch.set(sessionLogRef, sessionLogPayload, { merge: true });
      await batch.commit();

      setExistingTrainSessionId(trainSessionRef.id);

      if (hasLiveDraft) {
        const beaconSessionId = pendingSaveDraft?.beaconSessionId || null;
        if (beaconSessionId) {
          try {
            await updateDoc(doc(db, "users", uid, "liveSessions", beaconSessionId), {
              status,
              completedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              finalSessionId: trainSessionRef.id,
            });
          } catch {}
        }

        clearLiveActivity();
      }

      Alert.alert("Saved", "Session has been saved to history.", [
        {
          text: "OK",
          onPress: () => router.replace(`/train/history/${trainSessionRef.id}`),
        },
      ]);
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    clearLiveActivity,
    encodedKey,
    existingTrainSessionId,
    hasLiveDraft,
    notes,
    pendingSaveDraft,
    router,
    runReview,
    status,
  ]);

  const renderRunReview = () => {
    const payload = pendingSaveDraft?.payload || {};
    const title = String(payload?.title || "Run").trim();
    const distanceKm = Number(payload?.live?.distanceKm || payload?.actualDistanceKm || 0);
    const durationSec = Number(payload?.live?.durationSec || 0);
    const movingPace = payload?.live?.movingPaceMinPerKm || payload?.live?.avgPaceMinPerKm || null;

    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 20, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroCard, { backgroundColor: card2 }]}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={[styles.overline, { color: colors.subtext }]}>Run complete</Text>
              <Text style={[styles.heroTitle, { color: colors.text }]}>{title}</Text>
              <Text style={[styles.heroSub, { color: colors.subtext }]}>
                {runReview?.analysis?.summary || "Session review ready."}
              </Text>
            </View>

            <View style={[styles.heroAccentBadge, { backgroundColor: accentSoft }]}>
              <Text style={[styles.heroAccentText, { color: accent }]}>
                {runReview?.actual?.sourceLabel || "Review"}
              </Text>
            </View>
          </View>

          <View style={styles.summaryStatsRow}>
            <SummaryStat
              label="Distance"
              value={distanceKm > 0 ? `${distanceKm.toFixed(2)} km` : "—"}
              colors={colors}
            />
            <SummaryStat
              label="Time"
              value={secondsToClock(durationSec)}
              colors={colors}
            />
            <SummaryStat
              label="Avg pace"
              value={movingPace ? `${movingPace}/km` : formatPaceFromSec(runReview?.actual?.avgWorkPaceSec)}
              colors={colors}
              accent={accent}
            />
          </View>

          <View style={styles.detailPillRow}>
            <DetailPill
              text={
                runReview?.planned?.workCount
                  ? `${runReview.planned.workCount} planned reps`
                  : "Session review"
              }
              colors={colors}
              backgroundColor={cardSoft}
            />
            <DetailPill
              text={
                runReview?.actual?.analysedLapCount
                  ? `${runReview.actual.analysedLapCount} analysed laps`
                  : "No lap review"
              }
              colors={colors}
              backgroundColor={cardSoft}
            />
            {runReview?.planned?.targetPaceSec ? (
              <DetailPill
                text={`Target ${formatPaceFromSec(runReview.planned.targetPaceSec)}`}
                colors={colors}
                backgroundColor={accentSoft}
                textColor={accent}
              />
            ) : null}
          </View>
        </View>

        <SectionCard
          title="Execution insight"
          right={
            <View style={[styles.executionBadge, { backgroundColor: accentSoft }]}>
              <Text style={[styles.executionBadgeText, { color: accent }]}>
                {runReview?.analysis?.summary
                  ? runReview.analysis.summary.split(".")[0]
                  : "Insight"}
              </Text>
            </View>
          }
          colors={colors}
        >
          <View style={styles.insightMetricRow}>
            <SummaryStat
              label="Completion"
              value={
                runReview?.actual?.completionRate != null
                  ? `${Math.round(runReview.actual.completionRate * 100)}%`
                  : "—"
              }
              sub={
                runReview?.planned?.workCount
                  ? `${runReview.actual.analysedLapCount}/${runReview.planned.workCount} reps`
                  : runReview?.actual?.sourceLabel || ""
              }
              colors={colors}
            />
            <SummaryStat
              label="Consistency"
              value={
                runReview?.actual?.consistencySec != null
                  ? `${Math.round(runReview.actual.consistencySec)} s/km`
                  : "—"
              }
              sub="pace spread"
              colors={colors}
            />
            <SummaryStat
              label="Target delta"
              value={formatSignedPaceDelta(runReview?.actual?.targetDeltaSec) || "On pace"}
              sub={runReview?.actual?.targetDeltaSec > 0 ? "slower" : runReview?.actual?.targetDeltaSec < 0 ? "faster" : "vs plan"}
              colors={colors}
            />
          </View>

          <Text style={[styles.insightSummaryText, { color: colors.text }]}>
            {runReview?.analysis?.summary}
          </Text>

          {runReview?.planned?.overviewLines?.length ? (
            <View style={styles.planOverviewWrap}>
              <Text style={[styles.planOverviewLabel, { color: colors.subtext }]}>Planned structure</Text>
              {runReview.planned.overviewLines.map((line, idx) => (
                <Text key={`planned-line-${idx}`} style={[styles.planOverviewText, { color: colors.text }]}>
                  • {line}
                </Text>
              ))}
            </View>
          ) : null}

          {Array.isArray(runReview?.analysis?.strengths) && runReview.analysis.strengths.length ? (
            <View style={styles.feedbackGroup}>
              <Text style={[styles.feedbackGroupLabel, { color: colors.subtext }]}>What went well</Text>
              {runReview.analysis.strengths.map((line, idx) => (
                <Text key={`strength-${idx}`} style={[styles.feedbackLine, { color: colors.text }]}>
                  • {line}
                </Text>
              ))}
            </View>
          ) : null}

          {Array.isArray(runReview?.analysis?.weakPoints) && runReview.analysis.weakPoints.length ? (
            <View style={styles.feedbackGroup}>
              <Text style={[styles.feedbackGroupLabel, { color: colors.subtext }]}>To tighten up</Text>
              {runReview.analysis.weakPoints.map((line, idx) => (
                <Text key={`weak-${idx}`} style={[styles.feedbackLine, { color: colors.text }]}>
                  • {line}
                </Text>
              ))}
            </View>
          ) : null}

          {Array.isArray(runReview?.analysis?.suggestions) && runReview.analysis.suggestions.length ? (
            <View style={styles.feedbackGroup}>
              <Text style={[styles.feedbackGroupLabel, { color: colors.subtext }]}>Next time</Text>
              {runReview.analysis.suggestions.map((line, idx) => (
                <Text key={`suggest-${idx}`} style={[styles.feedbackLine, { color: colors.text }]}>
                  • {line}
                </Text>
              ))}
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Workout analysis" colors={colors}>
          {runReview?.workoutBars?.length > 1 ? (
            <>
              <WorkoutAnalysisChart
                data={runReview.workoutBars}
                colors={colors}
                accent={withAlpha(accent, "E6")}
              />
              <View style={styles.metricInlineRow}>
                <SummaryStat
                  label="Avg work pace"
                  value={formatPaceFromSec(runReview?.actual?.avgWorkPaceSec)}
                  colors={colors}
                />
                <SummaryStat
                  label="Fastest rep"
                  value={formatPaceFromSec(runReview?.actual?.fastestWorkPaceSec)}
                  colors={colors}
                />
                <SummaryStat
                  label="Work distance"
                  value={formatDistanceKm(runReview?.actual?.actualWorkDistanceKm, 2)}
                  colors={colors}
                />
              </View>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: colors.subtext }]}>
              Not enough split data to draw the workout chart yet.
            </Text>
          )}
        </SectionCard>

        <SectionCard title="Pace profile" colors={colors}>
          {runReview?.paceLinePoints?.length > 1 ? (
            <>
              <LineProfileChart
                data={runReview.paceLinePoints}
                colors={colors}
                accent={accent}
              />
              <Text style={[styles.chartCaption, { color: colors.subtext }]}>
                Pace trace built from {runReview?.actual?.sourceLabel?.toLowerCase() || "split data"}.
              </Text>
            </>
          ) : (
            <Text style={[styles.emptyText, { color: colors.subtext }]}>
              Pace profile will appear once you have enough lap or split data.
            </Text>
          )}
        </SectionCard>

        <SectionCard title="Laps" colors={colors}>
          {runReview?.classifiedRows?.length ? (
            <View style={styles.splitStack}>
              {runReview.classifiedRows.map((row, idx) => (
                <View
                  key={`review-split-${idx}`}
                  style={[
                    styles.splitRow,
                    {
                      borderBottomColor:
                        idx < runReview.classifiedRows.length - 1
                          ? withAlpha(colors.text, "12")
                          : "transparent",
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.splitRowTop}>
                      <Text style={[styles.splitName, { color: colors.text }]}>
                        {row.label}
                      </Text>
                      <SplitRoleChip role={row.role} colors={{ ...colors, primary: accent }} />
                    </View>
                    <Text style={[styles.splitMeta, { color: colors.subtext }]}>
                      {formatDistanceKm(row.distanceKm, row.distanceKm < 1 ? 2 : 1)} · {formatDurationShort(row.movingSec)}
                      {row.manual ? " · manual" : ""}
                    </Text>
                  </View>
                  <Text style={[styles.splitPace, { color: colors.text }]}>
                    {formatPaceFromSec(row.paceSec)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: colors.subtext }]}>
              No laps or splits logged for this run.
            </Text>
          )}
        </SectionCard>

        <SectionCard title="Session notes" colors={colors}>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Add any context from the session"
            placeholderTextColor={colors.subtext}
            multiline
            style={[
              styles.notesInput,
              { backgroundColor: cardSoft, color: colors.text, borderColor: "transparent" },
            ]}
          />
        </SectionCard>
      </ScrollView>
    );
  };

  const renderBasicForm = () => (
    <View
      style={[
        styles.sectionCard,
        { borderColor: "transparent", backgroundColor: card2, marginTop: 8 },
      ]}
    >
      <Text style={[styles.formLabel, { color: colors.subtext }]}>Status</Text>
      <View style={styles.statusRow}>
        <TouchableOpacity
          onPress={() => setStatus("completed")}
          style={[
            styles.statusPill,
            {
              borderColor: "transparent",
              backgroundColor: status === "completed" ? accent : cardSoft,
            },
          ]}
          activeOpacity={0.85}
        >
          <Text
            style={{
              color: status === "completed" ? "#111111" : colors.text,
              fontWeight: "800",
            }}
          >
            Completed
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setStatus("skipped")}
          style={[
            styles.statusPill,
            {
              borderColor: "transparent",
              backgroundColor: status === "skipped" ? "rgba(239,68,68,0.18)" : cardSoft,
            },
          ]}
          activeOpacity={0.85}
        >
          <Text
            style={{
              color: status === "skipped" ? "#FCA5A5" : colors.text,
              fontWeight: "800",
            }}
          >
            Skipped
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.formLabel, { color: colors.subtext, marginTop: 16 }]}>Notes</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional notes"
        placeholderTextColor={colors.subtext}
        multiline
        style={[
          styles.notesInput,
          {
            borderColor: "transparent",
            color: colors.text,
            backgroundColor: cardSoft,
            minHeight: 110,
          },
        ]}
      />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={goBackToPreviousScreen}
            style={[styles.iconBtn, { borderColor: "transparent", backgroundColor: cardSoft }]}
            activeOpacity={0.85}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={[styles.title, { color: colors.text }]}>
              {isRunLiveDraft ? "Session Review" : "Log Session"}
            </Text>
            <Text style={[styles.subtitle, { color: colors.subtext }]}>
              {isRunLiveDraft
                ? "Review execution before saving to history"
                : "Save the planned session outcome"}
            </Text>
          </View>

          <View style={styles.iconSpacer} />
        </View>

        {isRunLiveDraft ? renderRunReview() : renderBasicForm()}

        <View style={[styles.footer, { backgroundColor: colors.bg }]}>
          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: saving ? withAlpha(accent, "B8") : accent,
              },
            ]}
            activeOpacity={0.9}
          >
            <Text style={{ color: "#111111", fontWeight: "900" }}>
              {saving ? "Saving..." : hasLiveDraft ? "Save to history" : "Save session log"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 10,
  },
  headerCenter: { flex: 1, minWidth: 0 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  iconSpacer: { width: 40, height: 40 },
  title: { fontSize: 18, fontWeight: "900" },
  subtitle: { marginTop: 2, fontSize: 11, fontWeight: "600" },

  heroCard: {
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  overline: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  heroTitle: {
    marginTop: 4,
    fontSize: 26,
    fontWeight: "900",
  },
  heroSub: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
  },
  heroAccentBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroAccentText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  sectionCard: {
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  sectionCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionCardTitle: {
    fontSize: 16,
    fontWeight: "900",
  },
  executionBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 160,
  },
  executionBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryStatsRow: {
    flexDirection: "row",
    gap: 8,
  },
  summaryStatCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 3,
  },
  summaryStatLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryStatValue: {
    fontSize: 18,
    fontWeight: "900",
  },
  summaryStatSub: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },

  detailPillRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  detailPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  detailPillText: {
    fontSize: 11,
    fontWeight: "800",
  },

  insightMetricRow: {
    flexDirection: "row",
    gap: 8,
  },
  insightSummaryText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  planOverviewWrap: {
    gap: 4,
  },
  planOverviewLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  planOverviewText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  feedbackGroup: {
    gap: 4,
  },
  feedbackGroupLabel: {
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  feedbackLine: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },

  chartShell: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 10,
    overflow: "hidden",
  },
  chartAxisRow: {
    marginTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  chartAxisText: {
    fontSize: 10,
    fontWeight: "700",
  },
  chartAverageLine: {
    position: "absolute",
    left: 10,
    right: 10,
    borderTopWidth: 1,
    borderStyle: "dashed",
  },
  chartCaption: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "600",
  },
  metricInlineRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },

  splitStack: {
    marginTop: 2,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  splitRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  splitName: {
    fontSize: 14,
    fontWeight: "900",
  },
  splitMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
  },
  splitPace: {
    fontSize: 15,
    fontWeight: "900",
  },
  splitRoleChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  splitRoleChipText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },

  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  notesInput: {
    minHeight: 100,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    textAlignVertical: "top",
    fontSize: 14,
    fontWeight: "600",
  },

  formLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  footer: {
    paddingVertical: 10,
  },
  primaryBtn: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
