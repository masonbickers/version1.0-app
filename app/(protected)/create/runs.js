// app/(protected)/create/runs.js
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  addDoc, collection,
  serverTimestamp
} from "firebase/firestore";
import { useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import { getJsonAuthHeaders } from "../../../src/lib/api/authHeaders";
import { buildGenerateRunRequest } from "../../../src/lib/api/generateRunAdapter";
;
/* ----------------- theme bridge ----------------- */
function useScreenTheme() {
  const { colors, isDark } = useTheme();
  return {
    bg: colors.bg,
    card: colors.card,
    text: colors.text,
    subtext: colors.subtext,
    border: colors.border,
    muted: colors.muted,
    primaryBg: colors.primary,
    primaryText: isDark ? "#111827" : "#FFFFFF",
    placeholder: colors.subtextSoft || "#9CA3AF",
  };
}

/* ----------------- preview helpers ----------------- */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const emptyWeek = (title) => ({ title, days: DAYS.map((d) => ({ day: d, sessions: [] })) });

const row = (day, session) => {
  const title = session.title || `${session.type || "Run"} session`;
  const warm = session.warmup || (Array.isArray(session.segments)
      ? (session.segments.find(s => /^warm/i.test(s.type || ""))?.notes || `${(session.segments.find(s => /^warm/i.test(s.type || ""))?.durationMin ?? 10)} min easy + drills`)
      : "10–15 min easy + drills");
  const cool = session.cooldown || (Array.isArray(session.segments)
      ? (session.segments.find(s => /^cool/i.test(s.type || ""))?.notes || `${(session.segments.find(s => /^cool/i.test(s.type || ""))?.durationMin ?? 10)} min easy + strides`)
      : "10 min easy + strides");

  const mainFromSegments = () => {
    if (!Array.isArray(session.segments)) return null;
    const mains = session.segments.filter(s => /^(main|interval|set)$/i.test(s.type || ""));
    if (!mains.length) return null;
    // Build a concise string: reps × dist/time @ pace (rest) / next block ...
    const parts = mains.map(seg => {
      const bits = [];
      // intervals array preferred
      if (Array.isArray(seg.intervals) && seg.intervals.length) {
        const iv = seg.intervals[0] || {};
        const reps = iv.reps || seg.reps;
        if (reps) bits.push(`${reps}×`);
        if (iv.distanceKm) bits.push(`${Number(iv.distanceKm)} km`);
        else if (iv.durationMin) bits.push(`${Math.round(iv.durationMin)} min`);
        if (iv.paceTarget) bits.push(`@ ${iv.paceTarget}`);
        if (iv.hrTarget && !iv.paceTarget) bits.push(`(${iv.hrTarget})`);
        if (iv.rest) bits.push(`· ${iv.rest}`);
      } else {
        if (seg.sets && seg.reps && seg.movement) {
          bits.push(`${seg.sets}×${seg.reps} ${seg.movement}`);
          if (seg.load) bits.push(`@ ${seg.load}`);
        } else {
          if (seg.distanceKm) bits.push(`${Number(seg.distanceKm)} km`);
          if (seg.durationMin) bits.push(`${Math.round(seg.durationMin)} min`);
          if (seg.paceTarget) bits.push(`@ ${seg.paceTarget}`);
          if (seg.hrTarget && !seg.paceTarget) bits.push(`(${seg.hrTarget})`);
        }
      }
      if (seg.notes && bits.join(" ").length < 26) bits.push(`· ${seg.notes}`);
      return bits.join(" ");
    });
    return parts.filter(Boolean).join("  /  ");
  };

  const main = session.details || mainFromSegments()
    || (session.distanceKm || session.durationMin
      ? `${session.durationMin ? `${Math.round(session.durationMin)} min` : ""}${session.distanceKm ? ` → ${Number(session.distanceKm)} km` : ""}`
      : "Coach’s choice");

  const target = session.target
    || session.paceTarget
    || session.hrTarget
    || session.intensity
    || "Per notes";

  return {
    day,
    session: title,
    details: `Warm-up: ${warm}\nMain: ${main}\nCool-down: ${cool}`,
    target,
  };
};

function planToPreview(weeks) {
  return (weeks || []).map((w) => {
    const rows = [];
    (w.days || []).forEach((d) => (d.sessions || []).forEach((s) => rows.push(row(d.day, s))));
    return { title: w.title || "Week", rows };
  });
}

/* ----------------- page ----------------- */
export default function CreateRunPlan() {
  const theme = useScreenTheme();
  const router = useRouter();

  // Inputs
  const [goal, setGoal] = useState("Run 10k in 40:00");
  const [weeksCount, setWeeksCount] = useState("4");
  const [daysPerWeek, setDaysPerWeek] = useState("4");
  const [preferredDays, setPreferredDays] = useState("Mon Tue Thu Fri"); // optional string

  // PBs / athlete profile (all optional but helps pacing)
  const [pb5k, setPb5k] = useState("19:30");
  const [pb10k, setPb10k] = useState("");
  const [pbHM, setPbHM] = useState("");
  const [pbMarathon, setPbMarathon] = useState("");
  const [maxHR, setMaxHR] = useState(""); // optional

  // Result
  const [planName, setPlanName] = useState("Run Plan");
  const [weeks, setWeeks] = useState([emptyWeek("Week 1")]);
  const [paceGuide, setPaceGuide] = useState([]);
  const [saving, setSaving] = useState(false);
  const [thinking, setThinking] = useState(false);

  const totals = useMemo(() => {
    let sessions = 0, mins = 0, km = 0;
    weeks.forEach((w) => w.days.forEach((d) => d.sessions.forEach((s) => {
      sessions += 1;
      mins += Number(s.durationMin || 0);
      km += Number(s.distanceKm || 0);
    })));
    return { sessions, mins, km: Number(km.toFixed(1)) };
  }, [weeks]);

  const uidOrThrow = () => {
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in.");
    return u.uid;
  };

  const handleGenerate = async () => {
    const W = Math.max(1, Math.min(24, Number(weeksCount) || 4));
    const D = Math.max(2, Math.min(7, Number(daysPerWeek) || 4));
    const preferred = preferredDays.trim(); // server accepts string or array

    const legacyPayload = {
      goal,
      weeks: W,
      daysPerWeek: D,
      preferredDays: preferred,         // e.g. "Mon Tue Thu Fri"
      recent5k: pb5k?.trim(),
      recent10k: pb10k?.trim(),
      recentHalf: pbHM?.trim(),
      recentMarathon: pbMarathon?.trim(),
      maxHR: maxHR?.trim(),
    };

    setThinking(true);
    try {
      const request = buildGenerateRunRequest(legacyPayload);
      if (request.unsupported) {
        throw new Error(request.reason || "Unsupported plan type");
      }
      const query = request.allowDefaults ? "?allowDefaults=1" : "";
      const res = await fetch(`${API_URL}/generate-run${query}`, {
        method: "POST",
        headers: await getJsonAuthHeaders(),
        body: JSON.stringify({ athleteProfile: request.athleteProfile }),
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { throw new Error(text || `HTTP ${res.status}`); }
      const plan = data?.plan || data;

      // Normalise minimal shape (server already beautifies)
      const serverWeeks = Array.isArray(plan?.weeks) ? plan.weeks : [];
      const namedWeeks = serverWeeks.map((w, i) => ({
        title: w.title || `Week ${i + 1}`,
        days: (w.days || []).map(d => ({
          day: d.day,
          sessions: (d.sessions || []).map(s => ({
            ...s,
            // allow these shortcuts if model provided them:
            warmup: s.warmup,
            cooldown: s.cooldown,
          })),
        })),
      }));

      setPlanName(plan?.name || goal || "Run Plan");
      setWeeks(namedWeeks.length ? namedWeeks : [emptyWeek("Week 1")]);

      // Pace guide (object → array of strings)
      if (plan?.paces?.formatted && typeof plan.paces.formatted === "object") {
        const arr = Object.entries(plan.paces.formatted).map(([k, v]) => `${k}: ${v}`);
        setPaceGuide(arr);
      } else {
        setPaceGuide([]);
      }
    } catch (e) {
      Alert.alert("Generate failed", e?.message || "Could not generate. Check API_URL / network.");
    } finally {
      setThinking(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const uid = uidOrThrow();
      const payload = {
        name: planName.trim() || (goal ? `Run Plan — ${goal}` : "Run Plan"),
        primaryActivity: "Run",
        goal: goal.trim(),
        weeks,
        paceGuide,
        totals,
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(db, "users", uid, "plans"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
      Alert.alert("Saved", "Your running plan has been saved.");
      router.replace("/train");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save plan.");
    } finally {
      setSaving(false);
    }
  };

  const preview = planToPreview(weeks);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 14 }}>
          {/* Header */}
          <View style={st.rowBetween}>
            <TouchableOpacity onPress={() => router.back()} style={[st.pillBtn, { borderColor: theme.border }]}>
              <Feather name="chevron-left" size={18} color={theme.text} />
              <Text style={{ color: theme.text, fontWeight: "700" }}>Back</Text>
            </TouchableOpacity>

            <Text style={[st.h4, { color: theme.text }]}>Create Running Plan</Text>

            <TouchableOpacity
              onPress={async () => {
                try {
                  const r = await fetch(`${API_URL}/health`);
                  const t = await r.text();
                  Alert.alert("API health", t);
                } catch (e) {
                  Alert.alert("Ping failed", String(e));
                }
              }}
              style={[st.pillBtn, { borderColor: theme.border }]}
            >
              <Feather name="activity" size={16} color={theme.text} />
              <Text style={{ color: theme.text, fontWeight: "700" }}>Ping API</Text>
            </TouchableOpacity>
          </View>

          {/* Meta + inputs */}
          <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[st.label, { color: theme.subtext }]}>Plan name</Text>
            <TextInput
              style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
              placeholder="Run Plan"
              placeholderTextColor={theme.placeholder}
              value={planName}
              onChangeText={setPlanName}
            />

            <Text style={[st.label, { color: theme.subtext, marginTop: 10 }]}>Goal</Text>
            <TextInput
              style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
              placeholder="e.g. Run 10k in 40:00, or Sub-90 Half Marathon"
              placeholderTextColor={theme.placeholder}
              value={goal}
              onChangeText={setGoal}
            />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[st.label, { color: theme.subtext }]}>Weeks</Text>
                <TextInput
                  style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  placeholder="4"
                  placeholderTextColor={theme.placeholder}
                  keyboardType="numeric"
                  value={weeksCount}
                  onChangeText={setWeeksCount}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.label, { color: theme.subtext }]}>Sessions / week</Text>
                <TextInput
                  style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  placeholder="4"
                  placeholderTextColor={theme.placeholder}
                  keyboardType="numeric"
                  value={daysPerWeek}
                  onChangeText={setDaysPerWeek}
                />
              </View>
            </View>

            <Text style={[st.label, { color: theme.subtext, marginTop: 10 }]}>Preferred days (optional)</Text>
            <TextInput
              style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
              placeholder="Mon Tue Thu Fri"
              placeholderTextColor={theme.placeholder}
              value={preferredDays}
              onChangeText={setPreferredDays}
            />

            <Text style={[st.section, { color: theme.subtext, marginTop: 12 }]}>Personal Bests (optional)</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[st.label, { color: theme.subtext }]}>5K (mm:ss)</Text>
                <TextInput
                  style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  placeholder="19:30"
                  placeholderTextColor={theme.placeholder}
                  value={pb5k}
                  onChangeText={setPb5k}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.label, { color: theme.subtext }]}>10K (mm:ss)</Text>
                <TextInput
                  style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  placeholder="40:00"
                  placeholderTextColor={theme.placeholder}
                  value={pb10k}
                  onChangeText={setPb10k}
                />
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[st.label, { color: theme.subtext }]}>Half (hh:mm:ss)</Text>
                <TextInput
                  style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  placeholder="1:30:00"
                  placeholderTextColor={theme.placeholder}
                  value={pbHM}
                  onChangeText={setPbHM}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.label, { color: theme.subtext }]}>Marathon (hh:mm:ss)</Text>
                <TextInput
                  style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                  placeholder="3:15:00"
                  placeholderTextColor={theme.placeholder}
                  value={pbMarathon}
                  onChangeText={setPbMarathon}
                />
              </View>
            </View>

            <View>
              <Text style={[st.label, { color: theme.subtext }]}>Max HR (optional)</Text>
              <TextInput
                style={[st.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
                placeholder="e.g. 195"
                placeholderTextColor={theme.placeholder}
                keyboardType="numeric"
                value={maxHR}
                onChangeText={setMaxHR}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={handleGenerate} disabled={thinking} style={[st.primaryBtn, { backgroundColor: theme.primaryBg, opacity: thinking ? 0.6 : 1 }]}>
                <Feather name="cpu" size={16} color={theme.primaryText} />
                <Text style={{ color: theme.primaryText, fontWeight: "800" }}>
                  {thinking ? "Generating…" : "Generate plan"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Pace guide */}
          {!!paceGuide.length && (
            <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.border, gap: 4 }]}>
              <Text style={[st.weekTitle, { color: theme.text }]}>Pace guide</Text>
              {paceGuide.map((p, i) => (
                <Text key={i} style={{ color: theme.subtext }}>{`\u2022 ${p}`}</Text>
              ))}
            </View>
          )}

          {/* Preview table */}
          <View style={{ gap: 18 }}>
            {planToPreview(weeks).map((wk) => (
              <View key={wk.title} style={[st.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={[st.weekTitle, { color: theme.text }]}>{wk.title}</Text>

                <View style={[st.previewRow, { borderColor: theme.border }]}>
                  <Text style={[st.previewHeadCell, { color: theme.subtext }]}>Day</Text>
                  <Text style={[st.previewHeadCell, { color: theme.subtext, flex: 1.2 }]}>Session</Text>
                  <Text style={[st.previewHeadCell, { color: theme.subtext, flex: 2 }]}>Details</Text>
                  <Text style={[st.previewHeadCell, { color: theme.subtext }]}>Target</Text>
                </View>

                {wk.rows.map((r, i) => (
                  <View key={i} style={[st.previewRow, { borderColor: theme.border }]}>
                    <Text style={[st.previewCell, { color: theme.text }]}>{r.day}</Text>
                    <Text style={[st.previewCell, { color: theme.text, flex: 1.2 }]}>{r.session}</Text>
                    <Text style={[st.previewCell, { color: theme.text, flex: 2 }]}>{r.details}</Text>
                    <Text style={[st.previewCell, { color: theme.text }]}>{r.target}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>

          {/* Save */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity onPress={() => router.back()} style={[st.outlineBtn, { borderColor: theme.border }]}>
              <Text style={{ fontWeight: "700", color: theme.text }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} disabled={saving} style={[st.primaryBtn, { backgroundColor: theme.primaryBg }]}>
              <Feather name="save" size={16} color={theme.primaryText} />
              <Text style={{ color: theme.primaryText, fontWeight: "800" }}>{saving ? "Saving…" : "Save plan"}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ----------------- styles ----------------- */
const st = StyleSheet.create({
  h4: { fontSize: 18, fontWeight: "800" },
  section: { fontSize: 12, fontWeight: "800" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 12, gap: 8 },
  label: { fontSize: 12, fontWeight: "700" },

  input: { borderWidth: 1, borderRadius: 12, padding: 12 },

  weekTitle: { fontSize: 16, fontWeight: "800" },

  outlineBtn: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingVertical: 12 },
  primaryBtn: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 12 },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pillBtn: { flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },

  // Preview table
  previewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    gap: 8,
  },
  previewHeadCell: { width: 90, fontSize: 12, fontWeight: "800" },
  previewCell: { width: 90, fontSize: 13, lineHeight: 18 },
});
