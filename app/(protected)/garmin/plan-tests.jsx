import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_URL } from "../../../config/api";
import { getJsonAuthHeaders } from "../../../src/lib/api/authHeaders";

function guessApiBase() {
  return String(API_URL || "").replace(/\/$/, "");
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const DEFAULT_PAYLOAD = {
  athleteProfile: {
    goal: { distance: "10K", planLengthWeeks: 6, targetDate: "2026-06-30" },
    current: {
      weeklyKm: 30,
      longestRunKm: 20,
      experience: "Advanced/competitive",
      recentTimes: { tenK: "38:43" },
    },
    availability: {
      sessionsPerWeek: 4,
      runDays: ["Tue", "Thu", "Sat", "Sun"],
      longRunDay: "Sun",
    },
    difficulty: "Balanced",
    pacing: { thresholdPaceSecPerKm: 245 },
    hr: { max: 190, resting: 52 },
  },
};

const DISTANCES = ["5K", "10K", "Half marathon", "Marathon", "Ultra"];
const EXPERIENCES = [
  "New to running",
  "Some experience",
  "Regular runner",
  "Advanced/competitive",
];
const FREQUENCIES = [3, 4];
const DAY_SETS = {
  3: ["Tue", "Thu", "Sun"],
  4: ["Tue", "Thu", "Sat", "Sun"],
};

function buildScenarioProfile({ distance, experience, sessionsPerWeek }) {
  const expKey = String(experience || "").toLowerCase();
  const distKey = String(distance || "").toLowerCase();

  const weeklyBaseByExp = {
    "new to running": 18,
    "some experience": 28,
    "regular runner": 42,
    "advanced/competitive": 58,
  };
  const longestBaseByExp = {
    "new to running": 7,
    "some experience": 10,
    "regular runner": 16,
    "advanced/competitive": 22,
  };
  const thresholdByExp = {
    "new to running": 340,
    "some experience": 305,
    "regular runner": 275,
    "advanced/competitive": 255,
  };

  const distanceWeeklyAdjust =
    distKey.includes("ultra")
      ? 15
      : distKey.includes("marathon")
      ? 8
      : distKey.includes("half")
      ? 4
      : distKey.includes("5k")
      ? -2
      : 0;
  const distanceLongestAdjust =
    distKey.includes("ultra")
      ? 8
      : distKey.includes("marathon")
      ? 4
      : distKey.includes("half")
      ? 2
      : distKey.includes("5k")
      ? -1
      : 0;

  const weeklyRaw = (weeklyBaseByExp[expKey] ?? 28) + distanceWeeklyAdjust;
  const weeklyKm = Math.max(14, weeklyRaw);
  const longestRaw = (longestBaseByExp[expKey] ?? 10) + distanceLongestAdjust;
  const longestRunKm = Math.min(Math.max(5, longestRaw), round1(weeklyKm * 0.45));
  const planLengthWeeks = distKey.includes("ultra")
    ? 14
    : distKey.includes("marathon")
    ? 12
    : 8;
  const difficulty = expKey === "advanced/competitive" ? "Aggressive" : "Balanced";

  return {
    goal: { distance, planLengthWeeks, targetDate: "2026-10-01" },
    current: { weeklyKm, longestRunKm, experience },
    availability: {
      sessionsPerWeek,
      runDays: DAY_SETS[sessionsPerWeek],
      longRunDay: "Sun",
    },
    difficulty,
    pacing: { thresholdPaceSecPerKm: thresholdByExp[expKey] ?? 300 },
    hr: { max: 190, resting: 52 },
  };
}

function summarizePlan(plan) {
  const weeks = Array.isArray(plan?.weeks) ? plan.weeks : [];

  const notesTimingMismatch = [];
  const intervalOverTarget = [];
  const sessionCountMismatch = [];
  const sessionContractOutOfSync = [];
  const renderedIdentityDrift = [];
  const renderedGapHigh = [];
  const renderedQualityShareConflict = [];
  const longQualitySemanticsMissing = [];

  for (const w of weeks) {
    const week = Number(w?.weekIndex || w?.weekNumber || 0) || 0;
    const phase = String(w?.phase || "").toLowerCase();
    const sessions = Array.isArray(w?.sessions) ? w.sessions : [];
    const metrics = w?.metrics || {};

    const expected = toNum(metrics?.sessionCountExpected);
    const canonical = toNum(metrics?.canonicalSessionCount);
    const derived = toNum(metrics?.derivedSessionCount);
    if (expected != null && canonical != null && expected !== canonical) {
      sessionCountMismatch.push({ week, expected, canonical });
    }
    if (
      (canonical != null && derived != null && canonical !== derived) ||
      metrics?.sessionContractInSync === false
    ) {
      sessionContractOutOfSync.push({
        week,
        canonical,
        derived,
        inSync: metrics?.sessionContractInSync,
      });
    }

    const rendered = toNum(metrics?.renderedWeeklyKm);
    const uncapped = toNum(metrics?.renderedUncappedWeeklyKm);
    const trimmed = toNum(metrics?.renderedCapTrimmedKm);
    const longDelta = toNum(metrics?.renderedLongQualityDeltaKm);
    const longExtra = toNum(metrics?.renderedLongQualityExtraKm);
    const longForIdentity = longDelta != null ? longDelta : longExtra;
    const recomposed =
      rendered != null && uncapped != null && trimmed != null && longForIdentity != null
        ? round1(uncapped - trimmed + longForIdentity)
        : toNum(metrics?.renderedIdentityWeeklyKm);
    const drift = rendered != null && recomposed != null ? round1(rendered - recomposed) : null;
    if (drift != null && Math.abs(drift) > 0.05) {
      renderedIdentityDrift.push({ week, rendered, uncapped, trimmed, longExtra, recomposed, drift });
    }

    const budgeted = toNum(metrics?.budgetedWeeklyKm) ?? toNum(metrics?.plannedWeeklyKm);
    if (rendered != null && budgeted != null && budgeted > 0) {
      const gap = round1(rendered - budgeted);
      const ratioPct = round1((gap / budgeted) * 100);
      if (ratioPct >= 20) {
        renderedGapHigh.push({
          week,
          budgeted,
          rendered,
          gap,
          ratioPct,
          longExtra,
          policy: metrics?.renderedPolicyNotes || [],
        });
      }
    }

    const budgetQuality = toNum(metrics?.qualitySharePct);
    const renderedQuality = toNum(metrics?.renderedQualitySharePct);
    const phaseCap = toNum(
      {
        base: 30,
        build: 30,
        specific: 31,
        deload: 26,
        taper: 28,
      }[phase]
    );
    if (budgetQuality != null && renderedQuality != null) {
      const delta = round1(renderedQuality - budgetQuality);
      if (delta >= 8 || (phaseCap != null && renderedQuality > phaseCap + 8)) {
        renderedQualityShareConflict.push({
          week,
          phase,
          budgetQuality,
          renderedQuality,
          delta,
          phaseCap,
        });
      }
    }

    for (const s of sessions) {
      const type = String(s?.type || s?.workoutKind || s?.sessionType || "").toUpperCase();

      if (["INTERVALS", "THRESHOLD", "TEMPO", "HILLS"].includes(type)) {
        const notes = String(s?.notes || "");
        const wu = (notes.match(/Warm up (\d+) min/i) || [])[1];
        const cd = (notes.match(/Cool down (\d+) min/i) || [])[1];
        if (
          (wu && Number(wu) !== Number(s?.warmupMin)) ||
          (cd && Number(cd) !== Number(s?.cooldownMin))
        ) {
          notesTimingMismatch.push({
            week,
            day: s?.day,
            type,
            notes,
            warmupMin: s?.warmupMin,
            cooldownMin: s?.cooldownMin,
          });
        }
      }

      if (type === "INTERVALS") {
        const targetWorkM = toNum(s?.workout?.meta?.targetWorkM);
        const achievedWorkM = toNum(s?.workout?.meta?.achievedWorkM);
        if (targetWorkM != null && achievedWorkM != null && achievedWorkM > targetWorkM) {
          intervalOverTarget.push({
            week,
            day: s?.day,
            targetWorkM,
            achievedWorkM,
            planningTargetWorkM: toNum(s?.workout?.meta?.planningTargetWorkM),
          });
        }
      }

      if (type === "LONG") {
        const stepsJson = JSON.stringify(s?.steps || []);
        const hasTempo = stepsJson.includes('"stepType":"tempo"');
        if (hasTempo) {
          const missing =
            !s?.targetSemantics ||
            s?.targetPaceOverall == null ||
            s?.targetPacePrimary == null ||
            s?.targetHrOverall == null ||
            s?.targetHrPrimary == null;
          if (missing) {
            longQualitySemanticsMissing.push({
              week,
              day: s?.day,
              targetSemantics: s?.targetSemantics,
            });
          }
        }
      }
    }
  }

  const issueCounts = {
    notesTimingMismatch: notesTimingMismatch.length,
    intervalOverTarget: intervalOverTarget.length,
    sessionCountMismatch: sessionCountMismatch.length,
    sessionContractOutOfSync: sessionContractOutOfSync.length,
    renderedIdentityDrift: renderedIdentityDrift.length,
    renderedGapHigh: renderedGapHigh.length,
    renderedQualityShareConflict: renderedQualityShareConflict.length,
    longQualitySemanticsMissing: longQualitySemanticsMissing.length,
  };

  return {
    weeks: weeks.length,
    topDifficulty: plan?.difficulty ?? null,
    weekDifficulty: weeks.map((w) => ({
      week: Number(w?.weekIndex || w?.weekNumber || 0) || 0,
      diff: w?.targets?.difficulty ?? null,
    })),
    issueCounts,
    issues: {
      notesTimingMismatch,
      intervalOverTarget,
      sessionCountMismatch,
      sessionContractOutOfSync,
      renderedIdentityDrift,
      renderedGapHigh,
      renderedQualityShareConflict,
      longQualitySemanticsMissing,
    },
    weekly: weeks.map((w) => ({
      week: Number(w?.weekIndex || w?.weekNumber || 0) || 0,
      budgeted: toNum(w?.metrics?.budgetedWeeklyKm),
      rendered: toNum(w?.metrics?.renderedWeeklyKm),
      gap: toNum(w?.metrics?.renderedMinusBudgetedKm),
      uncapped: toNum(w?.metrics?.renderedUncappedWeeklyKm),
      trimmed: toNum(w?.metrics?.renderedCapTrimmedKm),
      longExtra: toNum(w?.metrics?.renderedLongQualityExtraKm),
      longDelta: toNum(w?.metrics?.renderedLongQualityDeltaKm),
      recomposed: toNum(w?.metrics?.renderedIdentityWeeklyKm),
      drift: toNum(w?.metrics?.renderedIdentityDriftKm),
      qualitySharePct: toNum(w?.metrics?.qualitySharePct),
      renderedQualitySharePct: toNum(w?.metrics?.renderedQualitySharePct),
      policy: w?.metrics?.renderedPolicyNotes || [],
    })),
  };
}

function IssueCountRow({ label, count, warnAt = 1 }) {
  const bad = Number(count || 0) >= warnAt;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
      <Text style={{ color: "#d1d5db" }}>{label}</Text>
      <Text style={{ color: bad ? "#f59e0b" : "#34d399", fontWeight: "700" }}>{count}</Text>
    </View>
  );
}

function JsonBlock({ value }) {
  return (
    <View
      style={{
        marginTop: 10,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        borderRadius: 12,
        backgroundColor: "#0b1220",
        padding: 10,
      }}
    >
      <Text style={{ color: "#93c5fd", fontFamily: "Courier", fontSize: 12 }}>
        {JSON.stringify(value, null, 2)}
      </Text>
    </View>
  );
}

export default function PlanTestsScreen() {
  const API_BASE = useMemo(() => guessApiBase(), []);
  const [payloadText, setPayloadText] = useState(JSON.stringify(DEFAULT_PAYLOAD, null, 2));
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState("");
  const [singleSummary, setSingleSummary] = useState(null);
  const [singleRawPlan, setSingleRawPlan] = useState(null);

  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixProgress, setMatrixProgress] = useState("");
  const [matrixError, setMatrixError] = useState("");
  const [matrixSummary, setMatrixSummary] = useState(null);

  const runSingle = async () => {
    setSingleError("");
    setSingleSummary(null);
    setSingleRawPlan(null);
    if (!API_BASE) {
      setSingleError("Missing API URL. Set EXPO_PUBLIC_API_URL for this build.");
      return;
    }
    setSingleLoading(true);
    try {
      const payload = JSON.parse(payloadText);
      const authHeaders = await getJsonAuthHeaders();
      const res = await fetch(`${API_BASE}/generate-run`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.plan) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      const summary = summarizePlan(json.plan);
      setSingleSummary(summary);
      setSingleRawPlan(json.plan);
    } catch (err) {
      setSingleError(String(err?.message || err));
    } finally {
      setSingleLoading(false);
    }
  };

  const runMatrix = async () => {
    if (!API_BASE) {
      setMatrixError("Missing API URL. Set EXPO_PUBLIC_API_URL for this build.");
      return;
    }
    setMatrixLoading(true);
    setMatrixError("");
    setMatrixSummary(null);
    const startedAt = Date.now();
    const scenarios = [];
    for (const distance of DISTANCES) {
      for (const experience of EXPERIENCES) {
        for (const sessionsPerWeek of FREQUENCIES) {
          scenarios.push({
            name: `${distance}_${experience}_${sessionsPerWeek}x`
              .toLowerCase()
              .replace(/\s+/g, "_")
              .replace(/[^\w]+/g, "_"),
            athleteProfile: buildScenarioProfile({ distance, experience, sessionsPerWeek }),
          });
        }
      }
    }

    const totals = {
      notesTimingMismatch: 0,
      intervalOverTarget: 0,
      sessionCountMismatch: 0,
      sessionContractOutOfSync: 0,
      renderedIdentityDrift: 0,
      renderedGapHigh: 0,
      renderedQualityShareConflict: 0,
      longQualitySemanticsMissing: 0,
      fetchErrors: 0,
    };
    const samples = [];
    let scenariosWithIssues = 0;

    try {
      const authHeaders = await getJsonAuthHeaders();
      for (let i = 0; i < scenarios.length; i++) {
        const sc = scenarios[i];
        setMatrixProgress(`Running ${i + 1}/${scenarios.length}: ${sc.name}`);
        const res = await fetch(`${API_BASE}/generate-run`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ athleteProfile: sc.athleteProfile }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.plan) {
          totals.fetchErrors += 1;
          if (samples.length < 8) {
            samples.push({
              scenario: sc.name,
              error: json?.error || `Request failed (${res.status})`,
            });
          }
          continue;
        }

        const summary = summarizePlan(json.plan);
        const issueCountForScenario = Object.values(summary.issueCounts).reduce(
          (sum, n) => sum + Number(n || 0),
          0
        );
        if (issueCountForScenario > 0) scenariosWithIssues += 1;

        for (const k of Object.keys(summary.issueCounts)) {
          totals[k] += Number(summary.issueCounts[k] || 0);
        }

        const majorKeys = [
          "renderedIdentityDrift",
          "intervalOverTarget",
          "sessionCountMismatch",
          "renderedGapHigh",
          "renderedQualityShareConflict",
        ];
        for (const key of majorKeys) {
          const rows = summary.issues[key] || [];
          for (const row of rows) {
            if (samples.length >= 8) break;
            samples.push({ scenario: sc.name, issue: key, ...row });
          }
          if (samples.length >= 8) break;
        }
      }

      setMatrixSummary({
        scenarios: scenarios.length,
        scenariosWithIssues,
        elapsedMs: Date.now() - startedAt,
        totals,
        samples,
      });
    } catch (err) {
      setMatrixError(String(err?.message || err));
    } finally {
      setMatrixLoading(false);
      setMatrixProgress("");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>Plan Tests</Text>
        <Text style={{ color: "#9ca3af", marginTop: 4 }}>
          API base: {API_BASE}
        </Text>

        <View
          style={{
            marginTop: 14,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            borderRadius: 14,
            backgroundColor: "#0f172a",
            padding: 12,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Single Payload</Text>
          <Text style={{ color: "#9ca3af", marginTop: 4 }}>
            Edit JSON and run one `/generate-run` plan check.
          </Text>
          <TextInput
            value={payloadText}
            onChangeText={setPayloadText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              marginTop: 10,
              minHeight: 220,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              backgroundColor: "#020617",
              color: "#e5e7eb",
              padding: 10,
              fontFamily: "Courier",
              fontSize: 12,
              textAlignVertical: "top",
            }}
          />
          <Pressable
            onPress={runSingle}
            disabled={singleLoading}
            style={{
              marginTop: 12,
              borderRadius: 10,
              backgroundColor: singleLoading ? "#1f2937" : "#2563eb",
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            {singleLoading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator />
                <Text style={{ color: "#fff", fontWeight: "700" }}>Running...</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700" }}>Run Single Test</Text>
            )}
          </Pressable>
          {!!singleError && <Text style={{ color: "#fca5a5", marginTop: 10 }}>{singleError}</Text>}

          {singleSummary && (
            <View style={{ marginTop: 10 }}>
              <IssueCountRow label="Notes mismatch" count={singleSummary.issueCounts.notesTimingMismatch} />
              <IssueCountRow label="Interval over target" count={singleSummary.issueCounts.intervalOverTarget} />
              <IssueCountRow label="Session count mismatch" count={singleSummary.issueCounts.sessionCountMismatch} />
              <IssueCountRow
                label="Session contract out of sync"
                count={singleSummary.issueCounts.sessionContractOutOfSync}
              />
              <IssueCountRow label="Rendered identity drift" count={singleSummary.issueCounts.renderedIdentityDrift} />
              <IssueCountRow label="Rendered gap high" count={singleSummary.issueCounts.renderedGapHigh} />
              <IssueCountRow
                label="Rendered quality-share conflict"
                count={singleSummary.issueCounts.renderedQualityShareConflict}
              />
              <IssueCountRow
                label="Quality-long semantics missing"
                count={singleSummary.issueCounts.longQualitySemanticsMissing}
              />
              <JsonBlock value={singleSummary.weekly} />
              <JsonBlock value={singleSummary.issueCounts} />
            </View>
          )}
        </View>

        <View
          style={{
            marginTop: 14,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            borderRadius: 14,
            backgroundColor: "#111827",
            padding: 12,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Matrix Audit</Text>
          <Text style={{ color: "#9ca3af", marginTop: 4 }}>
            Runs 40 scenarios (distance × experience × frequency) against `/generate-run`.
          </Text>
          <Pressable
            onPress={runMatrix}
            disabled={matrixLoading}
            style={{
              marginTop: 12,
              borderRadius: 10,
              backgroundColor: matrixLoading ? "#1f2937" : "#059669",
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            {matrixLoading ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator />
                <Text style={{ color: "#fff", fontWeight: "700" }}>Running Matrix...</Text>
              </View>
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700" }}>Run Matrix Tests</Text>
            )}
          </Pressable>
          {!!matrixProgress && <Text style={{ color: "#93c5fd", marginTop: 10 }}>{matrixProgress}</Text>}
          {!!matrixError && <Text style={{ color: "#fca5a5", marginTop: 10 }}>{matrixError}</Text>}

          {matrixSummary && (
            <View style={{ marginTop: 10 }}>
              <IssueCountRow label="Scenarios" count={matrixSummary.scenarios} warnAt={9999} />
              <IssueCountRow
                label="Scenarios with issues"
                count={matrixSummary.scenariosWithIssues}
              />
              <IssueCountRow label="Fetch errors" count={matrixSummary.totals.fetchErrors} />
              <IssueCountRow label="Notes mismatch" count={matrixSummary.totals.notesTimingMismatch} />
              <IssueCountRow label="Interval over target" count={matrixSummary.totals.intervalOverTarget} />
              <IssueCountRow
                label="Session count mismatch"
                count={matrixSummary.totals.sessionCountMismatch}
              />
              <IssueCountRow
                label="Session contract out of sync"
                count={matrixSummary.totals.sessionContractOutOfSync}
              />
              <IssueCountRow
                label="Rendered identity drift"
                count={matrixSummary.totals.renderedIdentityDrift}
              />
              <IssueCountRow label="Rendered gap high" count={matrixSummary.totals.renderedGapHigh} />
              <IssueCountRow
                label="Rendered quality-share conflict"
                count={matrixSummary.totals.renderedQualityShareConflict}
              />
              <IssueCountRow
                label="Quality-long semantics missing"
                count={matrixSummary.totals.longQualitySemanticsMissing}
              />
              <Text style={{ color: "#9ca3af", marginTop: 8 }}>
                Elapsed: {Math.round((matrixSummary.elapsedMs || 0) / 1000)}s
              </Text>
              <JsonBlock value={matrixSummary.samples} />
            </View>
          )}
        </View>

        {!!singleRawPlan && (
          <View
            style={{
              marginTop: 14,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
              borderRadius: 14,
              backgroundColor: "#0b1220",
              padding: 12,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Raw Plan Snapshot</Text>
            <Text style={{ color: "#9ca3af", marginTop: 4 }}>
              First two weeks from latest single run.
            </Text>
            <JsonBlock value={(singleRawPlan?.weeks || []).slice(0, 2)} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
