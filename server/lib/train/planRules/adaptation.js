import {
  ADAPTATION_EVENT_COLLECTION,
  ADAPTATION_MODEL_VERSION,
  applyRecentTrainingSummaryToAdaptationState,
  buildAdaptationEvent,
  compactRecentTrainingSummary,
  createEmptyAdaptationState,
  createEmptyRecentTrainingSummary,
  normaliseAdaptationEvent,
  normaliseAdaptationState,
  normaliseRecentTrainingRecord,
  registerAdaptationEvent,
  summariseRecentTraining,
  withPlanAdaptationDefaults,
} from "../../../../src/lib/train/adaptationModel.js";
import {
  TRAINING_READINESS_COLLECTION,
  normaliseTrainingReadinessEntry,
} from "../../../../src/lib/train/readinessModel.js";
import {
  goalKeyToByDistanceKey,
  normaliseGoalDistanceKey,
  normalisePublicDifficulty,
} from "./normalization.js";
import { RULES } from "./rulesConfig.js";

const DEFAULT_LOOKBACK_DAYS = 42;
const DEFAULT_SESSION_LIMIT = 72;
const DEFAULT_READINESS_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PACE_ANCHOR_CANDIDATES = 3;
const MIN_PACE_ANCHOR_COMPLETION_RATE = 0.85;
const MIN_PACE_ANCHOR_ANALYSED_LAPS = 2;
const MIN_PACE_ANCHOR_WORK_DISTANCE_KM = 1.6;
const MAX_PACE_ANCHOR_CONSISTENCY_SEC = 14;
const MIN_PACE_ANCHOR_DELTA_SEC = 3;
const MAX_PACE_ANCHOR_CHANGE_RATIO = 0.025;

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toPosNum(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function round1(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 10) / 10 : null;
}

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function safeMax(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return nums.length ? Math.max(...nums) : null;
}

function weightedAverage(items, valueKey) {
  let totalWeight = 0;
  let totalValue = 0;

  for (const item of Array.isArray(items) ? items : []) {
    const value = Number(item?.[valueKey]);
    const weight = Math.max(0, Number(item?.weight) || 0);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    totalValue += value * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalValue / totalWeight : null;
}

function stepDownDifficulty(value) {
  const difficulty = normalisePublicDifficulty(value);
  if (difficulty === "hard") return "balanced";
  if (difficulty === "balanced") return "easy";
  return "easy";
}

function summarizeWindowMeta(summary = {}) {
  return {
    last7d: summary?.last7d || null,
    last14d: summary?.last14d || null,
    last28d: summary?.last28d || null,
    streaks: summary?.streaks || null,
  };
}

function dedupeRecentTrainingRecords(rows, { now = Date.now(), maxAgeDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const cutoffMs = Number(now) - Math.max(1, Number(maxAgeDays) || DEFAULT_LOOKBACK_DAYS) * DAY_MS;
  const ordered = (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      ...(row && typeof row === "object" ? row : {}),
      ...normaliseRecentTrainingRecord(row, `row_${index}`),
    }))
    .sort((a, b) => (b?.dateMs || 0) - (a?.dateMs || 0));

  const seen = new Set();
  const deduped = [];

  for (const row of ordered) {
    if (!row?.dateMs || row.dateMs < cutoffMs) continue;
    const key =
      row.sessionKey ||
      row.id ||
      `${String(row.title || "session")}__${String(row.date || row.dateMs)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function computeSustainableWeeklyKm(summary = {}) {
  const signals = [];

  if (Number(summary?.last7d?.completedSessions || 0) >= 2 && Number(summary?.last7d?.distanceKm || 0) > 0) {
    signals.push(Number(summary.last7d.distanceKm));
  }
  if (Number(summary?.last14d?.completedSessions || 0) >= 3 && Number(summary?.last14d?.distanceKm || 0) > 0) {
    signals.push(Number(summary.last14d.distanceKm) / 2);
  }
  if (Number(summary?.last28d?.completedSessions || 0) >= 5 && Number(summary?.last28d?.distanceKm || 0) > 0) {
    signals.push(Number(summary.last28d.distanceKm) / 4);
  }

  return round1(safeMax(signals));
}

function computeRecentLongestCompletedRunKm(runRecords) {
  const rows = Array.isArray(runRecords) ? runRecords : [];
  const longTagged = rows
    .filter((row) => row?.isCompleted && row?.effortClass === "long")
    .map((row) => toPosNum(row?.actualDistanceKm))
    .filter((value) => value != null);

  const completedAny = rows
    .filter((row) => row?.isCompleted)
    .map((row) => toPosNum(row?.actualDistanceKm))
    .filter((value) => value != null);

  const preferred = longTagged.length ? longTagged : completedAny;
  return round1(safeMax(preferred));
}

function dedupeRecentReadinessEntries(rows, { now = Date.now(), maxAgeDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const cutoffMs = Number(now) - Math.max(1, Number(maxAgeDays) || DEFAULT_LOOKBACK_DAYS) * DAY_MS;
  const ordered = (Array.isArray(rows) ? rows : [])
    .map((row, index) => ({
      ...(row && typeof row === "object" ? row : {}),
      ...normaliseTrainingReadinessEntry(row, {
        dateKey: row?.dateKey || row?.id || `readiness_${index}`,
      }),
    }))
    .map((row) => ({
      ...row,
      dateMs: Number(new Date(row?.date || `${row?.dateKey}T12:00:00`).getTime()) || 0,
    }))
    .sort((a, b) => (b?.dateMs || 0) - (a?.dateMs || 0));

  const seen = new Set();
  const deduped = [];

  for (const row of ordered) {
    if (!row?.dateMs || row.dateMs < cutoffMs) continue;
    const key = row.dateKey || row.id || String(row.date || row.dateMs);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function average(values, digits = 1) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  const total = nums.reduce((sum, value) => sum + value, 0);
  return Number((total / nums.length).toFixed(digits));
}

function summarizeRecentReadiness(rows, { now = Date.now() } = {}) {
  const ordered = Array.isArray(rows) ? rows : [];
  if (!ordered.length) {
    return {
      recordCount: 0,
      latest: null,
      last3d: {
        entries: 0,
        low: 0,
        actionable: 0,
        avgScore: null,
      },
      last7d: {
        entries: 0,
        low: 0,
        actionable: 0,
        avgScore: null,
      },
      streaks: {
        consecutiveActionable: 0,
        consecutiveLow: 0,
      },
    };
  }

  const cutoff3d = Number(now) - DAY_MS * 3;
  const cutoff7d = Number(now) - DAY_MS * 7;
  const recent3d = ordered.filter((row) => row?.dateMs >= cutoff3d);
  const recent7d = ordered.filter((row) => row?.dateMs >= cutoff7d);

  let consecutiveActionable = 0;
  let consecutiveLow = 0;
  for (const row of ordered) {
    const actionable = row?.status === "low" || row?.status === "caution";
    if (actionable) consecutiveActionable += 1;
    else break;
  }
  for (const row of ordered) {
    if (row?.status === "low") consecutiveLow += 1;
    else break;
  }

  return {
    recordCount: ordered.length,
    latest: ordered[0]
      ? {
          dateKey: ordered[0].dateKey,
          status: ordered[0].status,
          score: ordered[0].score,
          headline: ordered[0].headline || null,
          flags: ordered[0].flags || {},
          reasonCodes: ordered[0].reasonCodes || [],
        }
      : null,
    last3d: {
      entries: recent3d.length,
      low: recent3d.filter((row) => row?.status === "low").length,
      actionable: recent3d.filter((row) => row?.status === "low" || row?.status === "caution").length,
      avgScore: average(recent3d.map((row) => row?.score), 1),
    },
    last7d: {
      entries: recent7d.length,
      low: recent7d.filter((row) => row?.status === "low").length,
      actionable: recent7d.filter((row) => row?.status === "low" || row?.status === "caution").length,
      avgScore: average(recent7d.map((row) => row?.score), 1),
    },
    streaks: {
      consecutiveActionable,
      consecutiveLow,
    },
  };
}

function normalisePhaseToken(value) {
  const phase = String(value || "").trim().toUpperCase();
  if (phase === "SPECIFIC") return "BUILD";
  if (phase === "BASE" || phase === "BUILD" || phase === "DELOAD" || phase === "TAPER") {
    return phase;
  }
  return null;
}

function deriveDeterministicPhaseSequence({
  weeks,
  taperWeeks,
  deloadEvery = RULES?.deload?.everyNWeeks ?? 4,
} = {}) {
  const totalWeeks = clampInt(weeks, 1, 52);
  const taper = clampInt(taperWeeks, 0, 6);
  const deloadN = clampInt(deloadEvery, 2, 8);
  const out = [];

  for (let weekIndex = 1; weekIndex <= totalWeeks; weekIndex += 1) {
    if (taper > 0 && weekIndex > totalWeeks - taper) {
      out.push("TAPER");
      continue;
    }
    if (deloadN > 0 && weekIndex % deloadN === 0) {
      out.push("DELOAD");
      continue;
    }
    const nonTaperWeeks = Math.max(1, totalWeeks - taper);
    const baseEnd = Math.max(1, Math.round(nonTaperWeeks * 0.25));
    out.push(weekIndex <= baseEnd ? "BASE" : "BUILD");
  }

  return out;
}

function buildRecoveryWeekPhaseOverrides(profile = {}) {
  const planLengthWeeks = clampInt(
    profile?.goal?.planLengthWeeks ?? profile?.weeks ?? 0,
    1,
    52
  );
  if (planLengthWeeks <= 1) {
    return {
      applied: false,
      reasonCode: "plan_too_short",
      phases: null,
      strategy: null,
    };
  }

  const goalKey = normaliseGoalDistanceKey(
    profile?.goal?.distance ?? profile?.goalDistance ?? "10K",
    { fallback: "10K" }
  );
  const byDistanceKey = goalKeyToByDistanceKey(goalKey, "10k");
  const taperWeeks = clampInt(
    profile?.taperLastNWeeks ??
      RULES?.byDistance?.[byDistanceKey]?.taperLastNWeeks ??
      RULES?.taper?.lastNWeeksDefault ??
      1,
    0,
    6
  );

  const currentPhases =
    Array.isArray(profile?.phaseOverrides) &&
    profile.phaseOverrides.length >= planLengthWeeks
      ? profile.phaseOverrides.map((phase) => normalisePhaseToken(phase))
      : deriveDeterministicPhaseSequence({
          weeks: planLengthWeeks,
          taperWeeks,
        });
  const phases = currentPhases.filter(Boolean);

  if (!phases.length || phases[0] === "DELOAD" || phases[0] === "TAPER") {
    return {
      applied: false,
      reasonCode: phases[0] === "DELOAD" ? "already_deload" : phases[0] === "TAPER" ? "already_taper" : "missing_phases",
      phases: phases.length ? phases : null,
      strategy: null,
    };
  }

  const taperStartIndex = phases.findIndex((phase) => phase === "TAPER");
  const nonTaper = taperStartIndex >= 0 ? phases.slice(0, taperStartIndex) : [...phases];
  const taperTail = taperStartIndex >= 0 ? phases.slice(taperStartIndex) : [];

  if (nonTaper.length <= 1) {
    return {
      applied: false,
      reasonCode: "no_room_before_taper",
      phases,
      strategy: null,
    };
  }

  const futureDeloadIndex = nonTaper.findIndex((phase, index) => index > 0 && phase === "DELOAD");
  let shifted;
  let strategy;
  let droppedPhase = null;

  if (futureDeloadIndex > 0) {
    const withoutFutureDeload = nonTaper.filter((_, index) => index !== futureDeloadIndex);
    droppedPhase = withoutFutureDeload[withoutFutureDeload.length - 1] || null;
    shifted = ["DELOAD", ...withoutFutureDeload.slice(0, nonTaper.length - 1)];
    strategy = "pull_existing_deload_forward";
  } else {
    droppedPhase = nonTaper[nonTaper.length - 1] || null;
    shifted = ["DELOAD", ...nonTaper.slice(0, nonTaper.length - 1)];
    strategy = "insert_front_deload";
  }

  return {
    applied: true,
    reasonCode: "recovery_week_pulled_forward",
    phases: [...shifted, ...taperTail],
    strategy,
    droppedPhase,
    originalFirstPhase: phases[0] || null,
  };
}

function deriveRecoveryWeekDecision({
  athleteProfile,
  readinessSummary,
  trainingSummary,
  downshift,
} = {}) {
  const cfg = RULES?.adaptation?.recoveryWeek || {};
  const latest = readinessSummary?.latest || null;
  const lowCount3d = Number(readinessSummary?.last3d?.low || 0);
  const actionableCount7d = Number(readinessSummary?.last7d?.actionable || 0);
  const consecutiveActionable = Number(readinessSummary?.streaks?.consecutiveActionable || 0);
  const averageScore3d = toNum(readinessSummary?.last3d?.avgScore);
  const compliance14d = toNum(trainingSummary?.last14d?.complianceRate);
  const avgRpe7d = toNum(trainingSummary?.last7d?.avgRPE);

  const triggerCodes = [];
  let severity = 0;

  if (latest?.flags?.illness || latest?.flags?.injuryConcern) {
    severity = Math.max(severity, 2);
    triggerCodes.push(latest?.flags?.illness ? "latest_illness_flag" : "latest_injury_flag");
  }

  if (lowCount3d >= (Number(cfg?.lowReadinessDaysLast3d) || 2)) {
    severity = Math.max(severity, 2);
    triggerCodes.push("multiple_low_readiness_last3d");
  }

  if (
    consecutiveActionable >= (Number(cfg?.consecutiveActionableDays) || 3) &&
    averageScore3d != null &&
    averageScore3d <= (Number(cfg?.lowAverageScoreLast3d) || 48)
  ) {
    severity = Math.max(severity, 2);
    triggerCodes.push("consecutive_actionable_readiness");
  }

  if (
    actionableCount7d >= (Number(cfg?.actionableDaysLast7d) || 3) &&
    (downshift?.shouldDownshift ||
      (compliance14d != null && compliance14d < (Number(cfg?.complianceFloor14d) || 0.75)) ||
      (avgRpe7d != null && avgRpe7d >= (Number(cfg?.avgRpeFloor7d) || 7.5)))
  ) {
    severity = Math.max(severity, 1);
    triggerCodes.push("actionable_readiness_plus_training_strain");
  }

  if (
    latest?.status === "low" &&
    (latest?.flags?.highSoreness || latest?.flags?.highStress || latest?.flags?.heavyCarryover)
  ) {
    severity = Math.max(severity, 1);
    triggerCodes.push("latest_low_with_fatigue_flags");
  }

  if (severity <= 0) {
    return {
      shouldPullForwardRecoveryWeek: false,
      severity: 0,
      triggerCodes,
      phaseOverride: null,
      reasonCode: "recovery_week_not_triggered",
    };
  }

  const phaseOverride = buildRecoveryWeekPhaseOverrides(athleteProfile);
  if (!phaseOverride?.applied) {
    return {
      shouldPullForwardRecoveryWeek: false,
      severity,
      triggerCodes,
      phaseOverride,
      reasonCode: phaseOverride?.reasonCode || "phase_override_unavailable",
    };
  }

  return {
    shouldPullForwardRecoveryWeek: true,
    severity,
    triggerCodes,
    phaseOverride,
    reasonCode: "recovery_week_triggered",
  };
}

function buildSessionDescriptor(row) {
  return [
    row?.title,
    row?.type,
    row?.sessionType,
    row?.focus,
    row?.emphasis,
    row?.notes,
    row?.runReview?.analysis?.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function pickCurrentThresholdAnchorSec(profile = {}) {
  const pacingValue = toPosNum(
    profile?.pacing?.thresholdPaceSecPerKm ?? profile?.pacing?.thresholdSecPerKm
  );
  if (pacingValue != null) return pacingValue;

  return toPosNum(profile?.personalization?.paces?.anchor?.thresholdPaceSecPerKm);
}

function classifyPaceAnchorSession(row) {
  if (row?.activity !== "run" || row?.effortClass !== "quality" || !row?.isCompleted) return null;
  const blob = buildSessionDescriptor(row);

  if (/\b(tempo|threshold|cruise|steady state|lactate)\b/.test(blob)) {
    return {
      key: "threshold_like",
      multiplier: 1.01,
    };
  }

  if (/\b(progression|fast finish)\b/.test(blob)) {
    return {
      key: "progression_like",
      multiplier: 1.03,
    };
  }

  if (/\b(interval|track|vo2|max|speed|hill|fartlek|rep|repetition)\b/.test(blob)) {
    return {
      key: "interval_like",
      multiplier: 1.07,
    };
  }

  return {
    key: "quality_generic",
    multiplier: 1.04,
  };
}

function buildPaceAnchorCandidate(row) {
  const runReview = row?.runReview;
  const avgWorkPaceSec = toPosNum(runReview?.actual?.avgWorkPaceSec);
  if (avgWorkPaceSec == null) return null;

  const completionRate = toNum(runReview?.actual?.completionRate);
  if (completionRate != null && completionRate < MIN_PACE_ANCHOR_COMPLETION_RATE) return null;

  const consistencySec = toNum(runReview?.actual?.consistencySec);
  if (consistencySec != null && consistencySec > MAX_PACE_ANCHOR_CONSISTENCY_SEC) return null;

  const analysedLapCount = Math.max(0, Number(runReview?.actual?.analysedLapCount || 0));
  const actualWorkDistanceKm = toPosNum(runReview?.actual?.actualWorkDistanceKm);
  if (
    analysedLapCount < MIN_PACE_ANCHOR_ANALYSED_LAPS &&
    !(actualWorkDistanceKm != null && actualWorkDistanceKm >= MIN_PACE_ANCHOR_WORK_DISTANCE_KM)
  ) {
    return null;
  }

  const sessionProfile = classifyPaceAnchorSession(row);
  if (!sessionProfile) return null;

  const estimatedThresholdSec = Math.round(avgWorkPaceSec * sessionProfile.multiplier);
  const weight = round1(
    1 +
      Math.min(1, completionRate != null ? completionRate : 0.9) +
      Math.min(1, analysedLapCount / 4) +
      Math.min(1, (actualWorkDistanceKm || 0) / 5) +
      (consistencySec != null
        ? Math.max(0, (MAX_PACE_ANCHOR_CONSISTENCY_SEC - consistencySec) / MAX_PACE_ANCHOR_CONSISTENCY_SEC)
        : 0.35)
  );

  return {
    sessionKey: row?.sessionKey || row?.id || null,
    date: row?.date || null,
    dateMs: Number(row?.dateMs || 0) || 0,
    sessionType: sessionProfile.key,
    actualAvgWorkPaceSec: Math.round(avgWorkPaceSec),
    estimatedThresholdSec,
    plannedTargetPaceSec: toPosNum(runReview?.planned?.targetPaceSec),
    completionRate: completionRate != null ? Number(completionRate.toFixed(3)) : null,
    consistencySec: consistencySec != null ? Math.round(consistencySec) : null,
    analysedLapCount,
    actualWorkDistanceKm: round1(actualWorkDistanceKm),
    weight: Math.max(0.5, weight || 1),
  };
}

function derivePaceAnchorDecision({ athleteProfile, runRecords } = {}) {
  const currentThresholdSec = pickCurrentThresholdAnchorSec(athleteProfile);
  const candidates = (Array.isArray(runRecords) ? runRecords : [])
    .map((row) => buildPaceAnchorCandidate(row))
    .filter(Boolean)
    .sort((a, b) => (b?.dateMs || 0) - (a?.dateMs || 0))
    .slice(0, MAX_PACE_ANCHOR_CANDIDATES);

  if (!candidates.length) {
    return {
      applied: false,
      currentThresholdSec,
      candidateCount: 0,
      reasonCode: "no_recent_quality_candidates",
      candidates: [],
    };
  }

  const candidateThresholdSec = weightedAverage(candidates, "estimatedThresholdSec");
  if (!Number.isFinite(candidateThresholdSec) || candidateThresholdSec <= 0) {
    return {
      applied: false,
      currentThresholdSec,
      candidateCount: candidates.length,
      reasonCode: "invalid_candidate_threshold",
      candidates,
    };
  }

  const roundedCandidateThresholdSec = Math.round(candidateThresholdSec);

  if (currentThresholdSec == null) {
    if (candidates.length < 2) {
      return {
        applied: false,
        currentThresholdSec: null,
        candidateCount: candidates.length,
        candidateThresholdSec: roundedCandidateThresholdSec,
        reasonCode: "insufficient_candidates_without_anchor",
        candidates,
      };
    }

    return {
      applied: true,
      currentThresholdSec: null,
      nextThresholdSec: roundedCandidateThresholdSec,
      candidateCount: candidates.length,
      candidateThresholdSec: roundedCandidateThresholdSec,
      deltaSec: null,
      reasonCode: "seeded_from_recent_quality_sessions",
      candidates,
    };
  }

  const rawDeltaSec = roundedCandidateThresholdSec - currentThresholdSec;
  if (Math.abs(rawDeltaSec) < MIN_PACE_ANCHOR_DELTA_SEC) {
    return {
      applied: false,
      currentThresholdSec,
      candidateCount: candidates.length,
      candidateThresholdSec: roundedCandidateThresholdSec,
      rawDeltaSec,
      reasonCode: "delta_below_minimum",
      candidates,
    };
  }

  const maxShiftSec = Math.max(5, Math.round(currentThresholdSec * MAX_PACE_ANCHOR_CHANGE_RATIO));
  const nextThresholdSec = Math.round(
    currentThresholdSec + Math.sign(rawDeltaSec) * Math.min(Math.abs(rawDeltaSec), maxShiftSec)
  );

  if (Math.abs(nextThresholdSec - currentThresholdSec) < MIN_PACE_ANCHOR_DELTA_SEC) {
    return {
      applied: false,
      currentThresholdSec,
      candidateCount: candidates.length,
      candidateThresholdSec: roundedCandidateThresholdSec,
      rawDeltaSec,
      maxShiftSec,
      reasonCode: "clamped_delta_below_minimum",
      candidates,
    };
  }

  return {
    applied: true,
    currentThresholdSec,
    nextThresholdSec,
    candidateCount: candidates.length,
    candidateThresholdSec: roundedCandidateThresholdSec,
    rawDeltaSec,
    deltaSec: nextThresholdSec - currentThresholdSec,
    maxShiftSec,
    reasonCode: "updated_from_recent_quality_sessions",
    candidates,
  };
}

function deriveDownshiftDecision(summary = {}) {
  const triggerCodes = [];
  let severity = 0;
  const compliance14 = toNum(summary?.last14d?.complianceRate);
  const compliance28 = toNum(summary?.last28d?.complianceRate);

  if (Number(summary?.streaks?.consecutiveMissed || 0) >= 2) {
    severity = Math.max(severity, 2);
    triggerCodes.push("consecutive_missed_2plus");
  }

  if (
    Number(summary?.last14d?.plannedSessions || 0) >= 3 &&
    compliance14 != null &&
    compliance14 < 0.67
  ) {
    severity = Math.max(severity, 1);
    triggerCodes.push("low_14d_compliance");
  }

  if (
    Number(summary?.last28d?.plannedSessions || 0) >= 5 &&
    compliance28 != null &&
    compliance28 < 0.6
  ) {
    severity = Math.max(severity, 1);
    triggerCodes.push("low_28d_compliance");
  }

  if (Number(summary?.last14d?.skippedSessions || 0) >= 2) {
    severity = Math.max(severity, 1);
    triggerCodes.push("skipped_2plus_last14d");
  }

  return {
    shouldDownshift: severity > 0,
    severity,
    triggerCodes,
    volumeMultiplier: severity >= 2 ? 0.85 : 0.92,
  };
}

function buildAdjustment({ code, field, from, to, reason, source = "recent_training_guardrails" }) {
  return {
    code,
    field,
    from,
    to,
    source,
    reason,
  };
}

export async function loadRecentTrainingRowsForUser(
  uid,
  { sessionLimit = DEFAULT_SESSION_LIMIT } = {}
) {
  const userId = String(uid || "").trim();
  if (!userId) return [];
  const { default: firebaseAdmin } = await import("../../../admin.js");

  const snap = await firebaseAdmin
    .firestore()
    .collection("users")
    .doc(userId)
    .collection("trainSessions")
    .orderBy("updatedAt", "desc")
    .limit(Math.max(1, Number(sessionLimit) || DEFAULT_SESSION_LIMIT))
    .get();

  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function loadRecentReadinessRowsForUser(
  uid,
  { readinessLimit = DEFAULT_READINESS_LIMIT } = {}
) {
  const userId = String(uid || "").trim();
  if (!userId) return [];
  const { default: firebaseAdmin } = await import("../../../admin.js");

  const snap = await firebaseAdmin
    .firestore()
    .collection("users")
    .doc(userId)
    .collection(TRAINING_READINESS_COLLECTION)
    .orderBy("date", "desc")
    .limit(Math.max(1, Number(readinessLimit) || DEFAULT_READINESS_LIMIT))
    .get();

  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export function applyRecentTrainingSafeguardsToProfile({
  athleteProfile,
  recentTrainingRows,
  recentReadinessRows,
  now = Date.now(),
  maxAgeDays = DEFAULT_LOOKBACK_DAYS,
} = {}) {
  const baseProfile = athleteProfile && typeof athleteProfile === "object" ? athleteProfile : {};
  const current = baseProfile?.current && typeof baseProfile.current === "object" ? baseProfile.current : {};
  const availability =
    baseProfile?.availability && typeof baseProfile.availability === "object"
      ? baseProfile.availability
      : {};
  const preferences =
    baseProfile?.preferences && typeof baseProfile.preferences === "object"
      ? baseProfile.preferences
      : {};
  const pacing =
    baseProfile?.pacing && typeof baseProfile.pacing === "object" ? baseProfile.pacing : {};

  const deduped = dedupeRecentTrainingRecords(recentTrainingRows, { now, maxAgeDays });
  const readinessRows = dedupeRecentReadinessEntries(recentReadinessRows, { now, maxAgeDays });
  const runRecords = deduped.filter((row) => row?.activity === "run" && !row?.isLive);
  const summary = summariseRecentTraining(runRecords, {
    now,
    windows: [7, 14, 28],
    recentLimit: 8,
  });
  const compactSummary = compactRecentTrainingSummary(summary);
  const readinessSummary = summarizeRecentReadiness(readinessRows, { now });

  const reportedWeeklyKm = toPosNum(current?.weeklyKm);
  const reportedLongestRunKm = toPosNum(current?.longestRunKm);
  const reportedDifficulty = normalisePublicDifficulty(
    availability?.difficulty ?? baseProfile?.difficulty ?? preferences?.difficulty
  );

  let effectiveWeeklyKm = reportedWeeklyKm;
  let effectiveLongestRunKm = reportedLongestRunKm;
  let effectiveDifficulty = reportedDifficulty;
  let effectiveThresholdPaceSec = pickCurrentThresholdAnchorSec(baseProfile);

  const adjustments = [];
  const sustainableWeeklyKm = computeSustainableWeeklyKm(summary);
  const recentLongestCompletedRunKm = computeRecentLongestCompletedRunKm(runRecords);
  const downshift = deriveDownshiftDecision(summary);
  const paceAnchorDecision = derivePaceAnchorDecision({
    athleteProfile: baseProfile,
    runRecords,
  });
  const recoveryWeekDecision = deriveRecoveryWeekDecision({
    athleteProfile: baseProfile,
    readinessSummary,
    trainingSummary: summary,
    downshift,
  });

  const weeklyMinKm = toPosNum(RULES?.weeklyGrowth?.minKm) ?? 8;
  const longRunMinKm = toPosNum(RULES?.longRun?.minKm) ?? 6;

  if (reportedWeeklyKm != null && sustainableWeeklyKm != null) {
    const weeklySafeCap = round1(Math.max(weeklyMinKm, sustainableWeeklyKm * 1.08));
    if (weeklySafeCap != null && reportedWeeklyKm > weeklySafeCap + 0.5) {
      effectiveWeeklyKm = weeklySafeCap;
      adjustments.push(
        buildAdjustment({
          code: "mileage_safeguard_weekly_km",
          field: "current.weeklyKm",
          from: reportedWeeklyKm,
          to: weeklySafeCap,
          reason: "Recent completed running volume is below the requested weekly starting load.",
        })
      );
    }
  }

  if (reportedLongestRunKm != null && recentLongestCompletedRunKm != null) {
    const longRunSafeCap = round1(Math.max(longRunMinKm, recentLongestCompletedRunKm * 1.12));
    if (longRunSafeCap != null && reportedLongestRunKm > longRunSafeCap + 0.3) {
      effectiveLongestRunKm = longRunSafeCap;
      adjustments.push(
        buildAdjustment({
          code: "mileage_safeguard_long_run_km",
          field: "current.longestRunKm",
          from: reportedLongestRunKm,
          to: longRunSafeCap,
          reason: "Recent completed long-run distance does not support the requested long-run starting point.",
        })
      );
    }
  }

  if (downshift.shouldDownshift) {
    const nextDifficulty = stepDownDifficulty(effectiveDifficulty);
    if (nextDifficulty !== effectiveDifficulty) {
      adjustments.push(
        buildAdjustment({
          code: "missed_session_downshift_difficulty",
          field: "preferences.difficulty",
          from: effectiveDifficulty,
          to: nextDifficulty,
          reason: "Recent missed sessions triggered an automatic downshift to protect consistency.",
        })
      );
      effectiveDifficulty = nextDifficulty;
    }

    if (effectiveWeeklyKm != null) {
      const downshiftedWeeklyKm = round1(Math.max(weeklyMinKm, effectiveWeeklyKm * downshift.volumeMultiplier));
      if (downshiftedWeeklyKm != null && downshiftedWeeklyKm < effectiveWeeklyKm - 0.5) {
        adjustments.push(
          buildAdjustment({
            code: "missed_session_downshift_weekly_km",
            field: "current.weeklyKm",
            from: effectiveWeeklyKm,
            to: downshiftedWeeklyKm,
            reason: "Recent missed sessions reduced the starting weekly load for the next plan build.",
          })
        );
        effectiveWeeklyKm = downshiftedWeeklyKm;
      }
    }

    if (effectiveLongestRunKm != null) {
      const longRunMultiplier = downshift.severity >= 2 ? 0.9 : 0.95;
      const downshiftedLongRunKm = round1(Math.max(longRunMinKm, effectiveLongestRunKm * longRunMultiplier));
      if (downshiftedLongRunKm != null && downshiftedLongRunKm < effectiveLongestRunKm - 0.3) {
        adjustments.push(
          buildAdjustment({
            code: "missed_session_downshift_long_run_km",
            field: "current.longestRunKm",
            from: effectiveLongestRunKm,
            to: downshiftedLongRunKm,
            reason: "Recent missed sessions reduced the long-run starting point for the next plan build.",
          })
        );
        effectiveLongestRunKm = downshiftedLongRunKm;
      }
    }
  }

  if (paceAnchorDecision?.applied && paceAnchorDecision?.nextThresholdSec != null) {
    adjustments.push(
      buildAdjustment({
        code: "pace_anchor_update_threshold",
        field: "pacing.thresholdPaceSecPerKm",
        from: effectiveThresholdPaceSec,
        to: paceAnchorDecision.nextThresholdSec,
        source: "recent_session_pace_anchor",
        reason:
          effectiveThresholdPaceSec != null
            ? "Recent quality run sessions nudged the threshold pace anchor to match current fitness."
            : "Recent quality run sessions established a starting threshold pace anchor.",
      })
    );
    effectiveThresholdPaceSec = paceAnchorDecision.nextThresholdSec;
  }

  if (
    recoveryWeekDecision?.shouldPullForwardRecoveryWeek &&
    Array.isArray(recoveryWeekDecision?.phaseOverride?.phases) &&
    recoveryWeekDecision.phaseOverride.phases.length
  ) {
    adjustments.push(
      buildAdjustment({
        code: "pull_forward_recovery_week",
        field: "phaseOverrides",
        from: Array.isArray(baseProfile?.phaseOverrides) ? baseProfile.phaseOverrides : null,
        to: recoveryWeekDecision.phaseOverride.phases,
        source: "recent_readiness_recovery_week",
        reason: "Recent readiness and training strain triggered an early recovery week.",
      })
    );
  }

  const adaptationTrace = {
    model: "recent_training_adaptation_v3",
    modelVersion: ADAPTATION_MODEL_VERSION,
    applied: adjustments.length > 0,
    lookbackDays: Math.max(1, Number(maxAgeDays) || DEFAULT_LOOKBACK_DAYS),
    runRecordCount: runRecords.length,
    readinessRecordCount: readinessRows.length,
    summary: compactSummary,
    signals: {
      sustainableWeeklyKm,
      recentLongestCompletedRunKm,
      downshift,
      paceAnchor: {
        applied: !!paceAnchorDecision?.applied,
        reasonCode: paceAnchorDecision?.reasonCode || null,
        currentThresholdSec: paceAnchorDecision?.currentThresholdSec ?? null,
        candidateThresholdSec: paceAnchorDecision?.candidateThresholdSec ?? null,
        nextThresholdSec: paceAnchorDecision?.nextThresholdSec ?? null,
        deltaSec: paceAnchorDecision?.deltaSec ?? null,
        candidateCount: paceAnchorDecision?.candidateCount || 0,
        maxShiftSec: paceAnchorDecision?.maxShiftSec ?? null,
        candidates: Array.isArray(paceAnchorDecision?.candidates)
          ? paceAnchorDecision.candidates.map((candidate) => ({
              sessionKey: candidate?.sessionKey || null,
              date: candidate?.date || null,
              sessionType: candidate?.sessionType || null,
              actualAvgWorkPaceSec: candidate?.actualAvgWorkPaceSec ?? null,
              estimatedThresholdSec: candidate?.estimatedThresholdSec ?? null,
              completionRate: candidate?.completionRate ?? null,
              consistencySec: candidate?.consistencySec ?? null,
              analysedLapCount: candidate?.analysedLapCount ?? null,
              actualWorkDistanceKm: candidate?.actualWorkDistanceKm ?? null,
              weight: candidate?.weight ?? null,
            }))
          : [],
      },
      readiness: readinessSummary,
      recoveryWeek: {
        applied: !!recoveryWeekDecision?.shouldPullForwardRecoveryWeek,
        reasonCode: recoveryWeekDecision?.reasonCode || null,
        severity: recoveryWeekDecision?.severity || 0,
        triggerCodes: recoveryWeekDecision?.triggerCodes || [],
        strategy: recoveryWeekDecision?.phaseOverride?.strategy || null,
        droppedPhase: recoveryWeekDecision?.phaseOverride?.droppedPhase || null,
        phasesPreview: Array.isArray(recoveryWeekDecision?.phaseOverride?.phases)
          ? recoveryWeekDecision.phaseOverride.phases.slice(0, 6)
          : [],
      },
      windows: summarizeWindowMeta(summary),
    },
    adjustments,
  };

  const nextProfile = {
    ...baseProfile,
    difficulty: effectiveDifficulty,
    current: {
      ...current,
      ...(effectiveWeeklyKm != null ? { weeklyKm: effectiveWeeklyKm } : {}),
      ...(effectiveLongestRunKm != null ? { longestRunKm: effectiveLongestRunKm } : {}),
    },
    availability: {
      ...availability,
      difficulty: effectiveDifficulty,
    },
    preferences: {
      ...preferences,
      difficulty: effectiveDifficulty,
    },
    pacing: {
      ...pacing,
      ...(effectiveThresholdPaceSec != null
        ? { thresholdPaceSecPerKm: effectiveThresholdPaceSec }
        : {}),
    },
    ...(Array.isArray(recoveryWeekDecision?.phaseOverride?.phases) &&
    recoveryWeekDecision?.shouldPullForwardRecoveryWeek
      ? { phaseOverrides: recoveryWeekDecision.phaseOverride.phases }
      : {}),
    recentTrainingSummary: compactSummary,
    recentReadinessSummary: readinessSummary,
    adaptationTrace,
  };

  return {
    athleteProfile: nextProfile,
    recentTrainingSummary: compactSummary,
    adaptationTrace,
    runRecords,
  };
}

export {
  ADAPTATION_EVENT_COLLECTION,
  ADAPTATION_MODEL_VERSION,
  applyRecentTrainingSummaryToAdaptationState,
  buildAdaptationEvent,
  compactRecentTrainingSummary,
  createEmptyAdaptationState,
  createEmptyRecentTrainingSummary,
  normaliseAdaptationEvent,
  normaliseAdaptationState,
  normaliseRecentTrainingRecord,
  registerAdaptationEvent,
  summariseRecentTraining,
  withPlanAdaptationDefaults,
};
