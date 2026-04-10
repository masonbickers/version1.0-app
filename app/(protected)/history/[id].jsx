// app/(protected)/history/[id].jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, {
  Line as SvgLine,
  Path as SvgPath,
} from "react-native-svg";
// ❌ REMOVE this line:
// import MapView, { Polyline } from "react-native-maps";

import { API_URL } from "../../../config/api";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
import {
  attachExternalActivityToTrainSession,
  isStrengthLikeSession,
  linkExternalActivityToPlannedSession,
  listPlanSessions,
} from "../../../src/train/utils/sessionRecordHelpers";

/* ---- native-only maps (guarded for web) ---------------------------------- */

let MapViewComponent = null;
let PolylineComponent = null;

if (Platform.OS !== "web") {
  const RNMaps = require("react-native-maps");
  MapViewComponent = RNMaps.default;
  PolylineComponent = RNMaps.Polyline;
}

/* ---- helpers: API base for AI analysis ----------------------------------- */

function getApiBase() {
  return String(API_URL || "").replace(/\/$/, "");
}

/* ---- polyline decoder (Strava / Google encoded polyline) ----------------- */

function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];

  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;

    // latitude
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dlat;

    // longitude
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return coordinates;
}

const STRENGTH_ACTIVITY_TYPES = new Set([
  "WeightTraining",
  "StrengthTraining",
  "GymWorkout",
  "Crossfit",
]);

const RUN_ACTIVITY_TYPES = new Set([
  "Run",
  "TrailRun",
  "VirtualRun",
  "Treadmill",
]);

function normaliseActivityMode(type, distanceMeters = 0) {
  const rawType = String(type || "").trim();
  if (STRENGTH_ACTIVITY_TYPES.has(rawType)) return "strength";
  if (RUN_ACTIVITY_TYPES.has(rawType)) return "run";
  if (rawType === "Workout" && (!Number(distanceMeters) || Number(distanceMeters) <= 0)) {
    return "strength";
  }
  return "other";
}

function formatActivityTypeLabel(type, distanceMeters = 0) {
  const mode = normaliseActivityMode(type, distanceMeters);
  if (mode === "strength") return "Strength";
  if (mode === "run") return "Run";
  return String(type || "Workout");
}

function resolveSessionLogStatus(log) {
  const raw = String(log?.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "skipped") return raw;
  if (log?.skippedAt) return "skipped";
  if (log?.completedAt || log?.lastTrainSessionId) return "completed";
  return "";
}

function toDateOnly(iso) {
  const raw = String(iso || "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

export default function ActivityDetailPage() {
  const params = useLocalSearchParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accentFill =
    colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";
  const accentText = colors.sapOnPrimary || "#0B0B0B";

  const [activity, setActivity] = useState(null);
  const [laps, setLaps] = useState([]);
  const [streams, setStreams] = useState({
    distance: [],
    heartrate: [],
    altitude: [],
    velocity: [],
    watts: [],
    cadence: [],
    grade: [],
    time: [],
  });
  const [lapsLoading, setLapsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [analysis, setAnalysis] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [lapsReview, setLapsReview] = useState("");
  const [lapsReviewLoading, setLapsReviewLoading] = useState(false);
  const [lapsReviewError, setLapsReviewError] = useState("");
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [planOptions, setPlanOptions] = useState([]);
  const [planOptionsLoading, setPlanOptionsLoading] = useState(false);
  const [planLinkError, setPlanLinkError] = useState("");
  const [linkingPlan, setLinkingPlan] = useState(false);
  const [linkedPlanSession, setLinkedPlanSession] = useState(null);
  const [targetPlanSessionOption, setTargetPlanSessionOption] = useState(null);
  const [targetTrainSession, setTargetTrainSession] = useState(null);
  const [targetTrainSessionError, setTargetTrainSessionError] = useState("");
  const [linkingTrainSession, setLinkingTrainSession] = useState(false);
  const targetTrainSessionId = useMemo(() => {
    const raw = Array.isArray(params?.linkTrainSessionId)
      ? params.linkTrainSessionId[0]
      : params?.linkTrainSessionId;
    const value = String(raw || "").trim();
    return value || null;
  }, [params?.linkTrainSessionId]);
  const targetPlanSessionKey = useMemo(() => {
    const raw = Array.isArray(params?.linkSessionKey)
      ? params.linkSessionKey[0]
      : params?.linkSessionKey;
    const value = String(raw || "").trim();
    return value || null;
  }, [params?.linkSessionKey]);
  const targetPlanSessionTitleParam = useMemo(() => {
    const raw = Array.isArray(params?.linkSessionTitle)
      ? params.linkSessionTitle[0]
      : params?.linkSessionTitle;
    const value = String(raw || "").trim();
    return value || null;
  }, [params?.linkSessionTitle]);

  useEffect(() => {
    const loadActivity = async () => {
      if (!id) return;
      try {
        setErr("");
        setLoading(true);
        setLaps([]);
        setStreams({
          distance: [],
          heartrate: [],
          altitude: [],
          velocity: [],
          watts: [],
          cadence: [],
          grade: [],
          time: [],
        });

        const token = await AsyncStorage.getItem("strava_access_token");
        if (!token) {
          setErr("Strava not connected. Please reconnect in Settings.");
          return;
        }

        const resp = await fetch(
          `https://www.strava.com/api/v3/activities/${id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          throw new Error(
            `HTTP ${resp.status} ${resp.statusText || ""} ${text}`
          );
        }

        const json = await resp.json();
        setActivity(json);

        // Laps are not guaranteed in the main activity payload, so fetch explicitly.
        setLapsLoading(true);
        try {
          const lapsResp = await fetch(
            `https://www.strava.com/api/v3/activities/${id}/laps`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (lapsResp.ok) {
            const lapsJson = await lapsResp.json();
            setLaps(Array.isArray(lapsJson) ? lapsJson : []);
          } else {
            setLaps(Array.isArray(json?.laps) ? json.laps : []);
          }
        } catch {
          setLaps(Array.isArray(json?.laps) ? json.laps : []);
        } finally {
          setLapsLoading(false);
        }

        // Streams for richer charts (pace / HR / elevation profile)
        try {
          const streamsResp = await fetch(
            `https://www.strava.com/api/v3/activities/${id}/streams?keys=distance,heartrate,altitude,velocity_smooth,time,grade_smooth,watts,cadence&key_by_type=true`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (streamsResp.ok) {
            const streamsJson = await streamsResp.json();
            const pick = (key) =>
              Array.isArray(streamsJson?.[key]?.data) ? streamsJson[key].data : [];

            setStreams({
              distance: pick("distance"),
              heartrate: pick("heartrate"),
              altitude: pick("altitude"),
              velocity: pick("velocity_smooth"),
              watts: pick("watts"),
              cadence: pick("cadence"),
              grade: pick("grade_smooth"),
              time: pick("time"),
            });
          }
        } catch {
          // keep empty streams fallback
        }
      } catch (e) {
        console.error("Activity detail error", e);
        setErr("Couldn't load activity. Try again or reconnect Strava.");
      } finally {
        setLoading(false);
      }
    };

    loadActivity();
  }, [id]);

  const s = useMemo(
    () => makeStyles(colors, isDark, accentFill, accentText),
    [colors, isDark, accentFill, accentText]
  );

  useEffect(() => {
    let cancelled = false;

    const loadTargetTrainSession = async () => {
      if (!targetTrainSessionId) {
        setTargetTrainSession(null);
        setTargetTrainSessionError("");
        return;
      }

      const uid = auth.currentUser?.uid;
      if (!uid) {
        setTargetTrainSession(null);
        setTargetTrainSessionError("Please sign in again.");
        return;
      }

      try {
        const snap = await getDoc(
          doc(db, "users", uid, "trainSessions", String(targetTrainSessionId))
        );

        if (cancelled) return;

        if (!snap.exists()) {
          setTargetTrainSession(null);
          setTargetTrainSessionError("Training session not found.");
          return;
        }

        setTargetTrainSession({ id: snap.id, ...snap.data() });
        setTargetTrainSessionError("");
      } catch (e) {
        console.error("Target train session load error", e);
        if (!cancelled) {
          setTargetTrainSession(null);
          setTargetTrainSessionError("Couldn't load the training session.");
        }
      }
    };

    loadTargetTrainSession();

    return () => {
      cancelled = true;
    };
  }, [targetTrainSessionId]);

  const formatDistance = (m) =>
    m ? (m / 1000).toFixed(2) + " km" : "-";

  const formatDuration = (sec) => {
    if (!sec && sec !== 0) return "-";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m}m ${s}s`;
  };

  const formatPace = (secPerKm) => {
    if (!secPerKm || !Number.isFinite(secPerKm)) return "-";
    const mins = Math.floor(secPerKm / 60);
    const secs = Math.round(secPerKm % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}/km`;
  };

  const formatDateTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString();
  };

  const formatHeaderDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatSignedMeters = (m) => {
    if (!Number.isFinite(m)) return "-";
    const rounded = Math.round(m);
    if (rounded > 0) return `+${rounded} m`;
    if (rounded < 0) return `${rounded} m`;
    return "0 m";
  };

  const distance = activity?.distance ?? null;
  const movingTime = activity?.moving_time ?? null;
  const elapsedTime = activity?.elapsed_time ?? null;
  const type = activity?.type ?? "";
  const activityMode = normaliseActivityMode(type, distance);
  const isStrengthActivity = activityMode === "strength";
  const activityTypeLabel = formatActivityTypeLabel(type, distance);
  const name = activity?.name || activityTypeLabel || "Workout";
  const paceSecPerKm =
    distance && movingTime ? movingTime / (distance / 1000) : null;

  // Map coords from Strava summary polyline
  const coords = useMemo(() => {
    const poly =
      activity?.map?.summary_polyline || activity?.map?.polyline || "";
    return decodePolyline(poly);
  }, [activity]);

  const region = useMemo(() => {
    if (!coords || coords.length === 0) return null;
    let minLat = coords[0].latitude;
    let maxLat = coords[0].latitude;
    let minLng = coords[0].longitude;
    let maxLng = coords[0].longitude;

    coords.forEach((c) => {
      minLat = Math.min(minLat, c.latitude);
      maxLat = Math.max(maxLat, c.latitude);
      minLng = Math.min(minLng, c.longitude);
      maxLng = Math.max(maxLng, c.longitude);
    });

    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;
    const latDelta = (maxLat - minLat || 0.01) * 1.4;
    const lngDelta = (maxLng - minLng || 0.01) * 1.4;

    return {
      latitude: midLat,
      longitude: midLng,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
  }, [coords]);

  const splitRows = useMemo(() => {
    const splitSource =
      Array.isArray(activity?.splits_metric) && activity.splits_metric.length > 0
        ? activity.splits_metric
        : laps;

    return (splitSource || [])
      .map((item, idx) => {
        const distanceM = Number(item?.distance || 0);
        const movingSec = Number(item?.moving_time || item?.elapsed_time || 0);
        const paceSec =
          distanceM > 0 && movingSec > 0 ? movingSec / (distanceM / 1000) : null;
        const elevDiff = Number(item?.elevation_difference);
        const elevGain = Number(item?.total_elevation_gain || 0);
        const hr = Number(item?.average_heartrate || 0);
        return {
          index: idx + 1,
          name: item?.name || `Lap ${idx + 1}`,
          distanceKm: distanceM > 0 ? distanceM / 1000 : 0,
          movingSec,
          paceSec,
          elevDiff: Number.isFinite(elevDiff) ? elevDiff : null,
          elevGain: Number.isFinite(elevGain) ? elevGain : 0,
          hr: Number.isFinite(hr) && hr > 0 ? hr : null,
        };
      })
      .filter((row) => row.distanceKm > 0);
  }, [activity?.splits_metric, laps]);

  const lapRows = useMemo(() => {
    return (laps || [])
      .map((lap, idx) => {
        const distanceM = Number(lap?.distance || 0);
        const movingSec = Number(lap?.moving_time || lap?.elapsed_time || 0);
        const elapsedSec = Number(lap?.elapsed_time || lap?.moving_time || 0);
        const paceSec =
          distanceM > 0 && movingSec > 0 ? movingSec / (distanceM / 1000) : null;
        const elevDiff = Number(lap?.elevation_difference);
        const elevGain = Number(lap?.total_elevation_gain || 0);
        const hr = Number(lap?.average_heartrate || 0);

        return {
          index: idx + 1,
          name: String(lap?.name || `Lap ${idx + 1}`),
          distanceKm: distanceM > 0 ? distanceM / 1000 : 0,
          movingSec,
          elapsedSec,
          paceSec,
          elevDiff: Number.isFinite(elevDiff) ? elevDiff : null,
          elevGain: Number.isFinite(elevGain) ? elevGain : 0,
          hr: Number.isFinite(hr) && hr > 0 ? hr : null,
        };
      })
      .filter((row) => row.distanceKm > 0);
  }, [laps]);

  const classifiedLapRows = useMemo(() => {
    if (!lapRows.length) return [];

    const warmupRe = /\b(warm[\s-]?up|wu)\b/i;
    const cooldownRe = /\b(cool[\s-]?down|cd)\b/i;

    const validPaces = lapRows
      .map((lap) => Number(lap.paceSec || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const sorted = [...validPaces].sort((a, b) => a - b);
    const medianPace =
      sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null;

    const next = lapRows.map((lap) => {
      const name = String(lap.name || "");
      if (warmupRe.test(name)) return { ...lap, role: "warmup" };
      if (cooldownRe.test(name)) return { ...lap, role: "cooldown" };
      return { ...lap, role: "work" };
    });

    const firstIdx = 0;
    const lastIdx = next.length - 1;

    const first = next[firstIdx];
    if (
      first &&
      first.role === "work" &&
      medianPace &&
      Number.isFinite(first.paceSec) &&
      (first.paceSec > medianPace * 1.12 || first.distanceKm >= 1.2) &&
      first.movingSec >= 240
    ) {
      next[firstIdx] = { ...first, role: "warmup" };
    }

    const last = next[lastIdx];
    if (
      last &&
      last.role === "work" &&
      medianPace &&
      Number.isFinite(last.paceSec) &&
      (last.paceSec > medianPace * 1.12 || last.distanceKm >= 1.0) &&
      last.movingSec >= 180
    ) {
      next[lastIdx] = { ...last, role: "cooldown" };
    }

    return next;
  }, [lapRows]);

  const warmupRows = useMemo(
    () => classifiedLapRows.filter((lap) => lap.role === "warmup"),
    [classifiedLapRows]
  );
  const cooldownRows = useMemo(
    () => classifiedLapRows.filter((lap) => lap.role === "cooldown"),
    [classifiedLapRows]
  );
  const coreLapRows = useMemo(
    () => classifiedLapRows.filter((lap) => lap.role !== "warmup" && lap.role !== "cooldown"),
    [classifiedLapRows]
  );

  const lapsForAi = useMemo(
    () =>
      (coreLapRows.length ? coreLapRows : lapRows).map((row) => ({
        index: row.index,
        distance_m: Math.round(row.distanceKm * 1000),
        moving_time_s: row.movingSec,
        pace_s_per_km: row.paceSec,
        elev_diff: row.elevDiff,
        elev_gain: row.elevGain,
        avg_hr: row.hr,
      })),
    [coreLapRows, lapRows]
  );

  const lapAutoMetrics = useMemo(() => {
    const analysisLaps = coreLapRows.length ? coreLapRows : lapRows;
    if (!analysisLaps.length) {
      return {
        avgLapSpeedKmh: null,
        avgLapPaceSec: null,
        avgIntervalPaceSec: null,
        avgRestSec: null,
        workLapCount: 0,
        recoveryLapCount: 0,
      };
    }

    const totalDistKm = analysisLaps.reduce((sum, lap) => sum + (lap.distanceKm || 0), 0);
    const totalMovingSec = analysisLaps.reduce((sum, lap) => sum + (lap.movingSec || 0), 0);

    const avgLapSpeedKmh =
      totalDistKm > 0 && totalMovingSec > 0
        ? (totalDistKm / (totalMovingSec / 3600))
        : null;
    const avgLapPaceSec =
      totalDistKm > 0 && totalMovingSec > 0
        ? totalMovingSec / totalDistKm
        : null;

    const lapsWithPace = analysisLaps.filter((lap) => Number.isFinite(lap.paceSec) && lap.paceSec > 0);
    const sortedPaces = lapsWithPace
      .map((lap) => Number(lap.paceSec))
      .sort((a, b) => a - b);
    const medianPace =
      sortedPaces.length > 0
        ? sortedPaces[Math.floor(sortedPaces.length / 2)]
        : null;

    let workLaps = lapsWithPace.filter(
      (lap) =>
        lap.distanceKm >= 0.15 &&
        lap.distanceKm <= 2.5 &&
        (!medianPace || lap.paceSec <= medianPace * 1.03)
    );
    if (!workLaps.length) {
      workLaps = lapsWithPace.filter((lap) => lap.distanceKm >= 0.15);
    }

    const workLapIds = new Set(workLaps.map((lap) => lap.index));
    const recoveryLaps = analysisLaps.filter((lap) => {
      if (workLapIds.has(lap.index)) return false;
      if (lap.distanceKm <= 0 || lap.distanceKm > 1.2) return false;
      if (medianPace && Number.isFinite(lap.paceSec)) {
        return lap.paceSec >= medianPace * 1.08;
      }
      return true;
    });

    const intervalDistKm = workLaps.reduce((sum, lap) => sum + (lap.distanceKm || 0), 0);
    const intervalMovingSec = workLaps.reduce((sum, lap) => sum + (lap.movingSec || 0), 0);
    const avgIntervalPaceSec =
      intervalDistKm > 0 && intervalMovingSec > 0
        ? intervalMovingSec / intervalDistKm
        : null;

    const restDurationsSec = recoveryLaps
      .map((lap) => {
        const explicitRest = (lap.elapsedSec || 0) - (lap.movingSec || 0);
        if (explicitRest > 0) return explicitRest;
        return lap.movingSec || 0;
      })
      .filter((sec) => Number.isFinite(sec) && sec > 0);

    const avgRestSec =
      restDurationsSec.length > 0
        ? restDurationsSec.reduce((sum, sec) => sum + sec, 0) / restDurationsSec.length
        : null;

    return {
      avgLapSpeedKmh,
      avgLapPaceSec,
      avgIntervalPaceSec,
      avgRestSec,
      workLapCount: workLaps.length,
      recoveryLapCount: recoveryLaps.length,
    };
  }, [coreLapRows, lapRows]);

  const paceLinePoints = useMemo(() => {
    const distanceArr = streams.distance || [];
    const velocityArr = streams.velocity || [];
    const len = Math.min(distanceArr.length, velocityArr.length);

    if (len > 1) {
      return Array.from({ length: len }, (_, i) => {
        const v = Number(velocityArr[i] || 0);
        const minPerKm = v > 0 ? 1000 / v / 60 : null;
        return {
          x: Number(distanceArr[i] || 0) / 1000,
          y: Number.isFinite(minPerKm) ? minPerKm : null,
        };
      }).filter((p) => Number.isFinite(p.y));
    }

    let totalKm = 0;
    return splitRows
      .map((row) => {
        totalKm += row.distanceKm;
        return {
          x: totalKm,
          y: Number.isFinite(row.paceSec) ? row.paceSec / 60 : null,
        };
      })
      .filter((p) => Number.isFinite(p.y));
  }, [streams.distance, streams.velocity, splitRows]);

  const hrLinePoints = useMemo(() => {
    const distanceArr = streams.distance || [];
    const hrArr = streams.heartrate || [];
    const len = Math.min(distanceArr.length, hrArr.length);

    if (len > 1) {
      return Array.from({ length: len }, (_, i) => ({
        x: Number(distanceArr[i] || 0) / 1000,
        y: Number(hrArr[i] || 0),
      })).filter((p) => Number.isFinite(p.y) && p.y > 0);
    }

    let totalKm = 0;
    return splitRows
      .map((row) => {
        totalKm += row.distanceKm;
        return {
          x: totalKm,
          y: row.hr,
        };
      })
      .filter((p) => Number.isFinite(p.y) && p.y > 0);
  }, [streams.distance, streams.heartrate, splitRows]);

  const elevationLinePoints = useMemo(() => {
    const distanceArr = streams.distance || [];
    const altArr = streams.altitude || [];
    const len = Math.min(distanceArr.length, altArr.length);

    if (len > 1) {
      return Array.from({ length: len }, (_, i) => ({
        x: Number(distanceArr[i] || 0) / 1000,
        y: Number(altArr[i] || 0),
      })).filter((p) => Number.isFinite(p.y));
    }

    let totalKm = 0;
    let level = 0;
    return splitRows
      .map((row) => {
        totalKm += row.distanceKm;
        const delta = Number.isFinite(row.elevDiff) ? row.elevDiff : row.elevGain;
        level += Number(delta || 0);
        return {
          x: totalKm,
          y: level,
        };
      })
      .filter((p) => Number.isFinite(p.y));
  }, [streams.distance, streams.altitude, splitRows]);

  const avgHrValue = useMemo(() => {
    if (hrLinePoints.length > 0) {
      return (
        hrLinePoints.reduce((sum, p) => sum + Number(p.y || 0), 0) /
        hrLinePoints.length
      );
    }
    const fallback = Number(activity?.average_heartrate || 0);
    return fallback > 0 ? fallback : null;
  }, [hrLinePoints, activity?.average_heartrate]);

  const maxHrValue = useMemo(() => {
    if (hrLinePoints.length > 0) {
      return Math.max(...hrLinePoints.map((p) => Number(p.y || 0)));
    }
    const fallback = Number(activity?.max_heartrate || 0);
    return fallback > 0 ? fallback : null;
  }, [hrLinePoints, activity?.max_heartrate]);

  const minAltValue = useMemo(() => {
    if (elevationLinePoints.length === 0) return null;
    return Math.min(...elevationLinePoints.map((p) => Number(p.y || 0)));
  }, [elevationLinePoints]);

  const maxAltValue = useMemo(() => {
    if (elevationLinePoints.length === 0) return null;
    return Math.max(...elevationLinePoints.map((p) => Number(p.y || 0)));
  }, [elevationLinePoints]);

  const elevationNetChange = useMemo(() => {
    if (elevationLinePoints.length < 2) return null;
    const first = Number(elevationLinePoints[0]?.y || 0);
    const last = Number(elevationLinePoints[elevationLinePoints.length - 1]?.y || 0);
    return last - first;
  }, [elevationLinePoints]);

  const fastestSplitPaceSec = useMemo(() => {
    const paces = splitRows
      .map((row) => Number(row.paceSec || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (paces.length === 0) return null;
    return Math.min(...paces);
  }, [splitRows]);

  const workoutBars = useMemo(() => {
    const source = splitRows.length ? splitRows : lapRows;
    return source
      .slice(0, 32)
      .map((row, idx) => ({
        x: idx + 1,
        y: Number(row?.paceSec || 0) / 60,
      }))
      .filter((p) => Number.isFinite(p.y) && p.y > 0);
  }, [splitRows, lapRows]);

  const gradeSamples = useMemo(() => {
    const distanceArr = streams.distance || [];
    const explicitGradeArr = streams.grade || [];
    const altitudeArr = streams.altitude || [];

    const explicitLen = Math.min(distanceArr.length, explicitGradeArr.length);
    if (explicitLen > 1) {
      return Array.from({ length: explicitLen }, (_, i) => ({
        x: Number(distanceArr[i] || 0) / 1000,
        grade: Number(explicitGradeArr[i] || 0) / 100,
      })).filter((p) => Number.isFinite(p.grade));
    }

    const derivedLen = Math.min(distanceArr.length, altitudeArr.length);
    if (derivedLen > 1) {
      const rows = [];
      for (let i = 1; i < derivedLen; i += 1) {
        const d1 = Number(distanceArr[i - 1] || 0);
        const d2 = Number(distanceArr[i] || 0);
        const a1 = Number(altitudeArr[i - 1] || 0);
        const a2 = Number(altitudeArr[i] || 0);
        const dd = d2 - d1;
        if (!Number.isFinite(dd) || dd < 3) continue;
        const grade = (a2 - a1) / dd;
        rows.push({
          x: d2 / 1000,
          grade: Math.max(-0.3, Math.min(0.3, grade)),
        });
      }
      return rows;
    }

    return [];
  }, [streams.distance, streams.grade, streams.altitude]);

  const gapLinePoints = useMemo(() => {
    const distanceArr = streams.distance || [];
    const velocityArr = streams.velocity || [];
    const len = Math.min(distanceArr.length, velocityArr.length, gradeSamples.length);

    const effortCost = (grade) => {
      const g = Math.max(-0.3, Math.min(0.3, Number(grade || 0)));
      return (
        155.4 * g ** 5 -
        30.4 * g ** 4 -
        43.3 * g ** 3 +
        46.3 * g ** 2 +
        19.5 * g +
        3.6
      );
    };

    if (len > 1) {
      const points = [];
      for (let i = 0; i < len; i += 1) {
        const speed = Number(velocityArr[i] || 0);
        if (!Number.isFinite(speed) || speed <= 0) continue;

        const paceSec = 1000 / speed;
        const gradeRatio = Number(gradeSamples[i]?.grade || 0);
        const cGrade = effortCost(gradeRatio);
        const cFlat = 3.6;
        const gapSec =
          Number.isFinite(cGrade) && cGrade > 0 ? paceSec * (cGrade / cFlat) : paceSec;

        points.push({
          x: Number(distanceArr[i] || 0) / 1000,
          y: gapSec / 60,
        });
      }
      return points;
    }

    let totalKm = 0;
    return splitRows
      .map((row) => {
        totalKm += row.distanceKm;
        const grade =
          row.distanceKm > 0 && Number.isFinite(row.elevDiff)
            ? (Number(row.elevDiff) || 0) / (row.distanceKm * 1000)
            : 0;
        const g = Math.max(-0.25, Math.min(0.25, Number(grade || 0)));
        const cGrade =
          155.4 * g ** 5 -
          30.4 * g ** 4 -
          43.3 * g ** 3 +
          46.3 * g ** 2 +
          19.5 * g +
          3.6;
        const base = Number(row.paceSec || 0);
        const gap = base > 0 && cGrade > 0 ? base * (cGrade / 3.6) : base;
        return {
          x: totalKm,
          y: gap > 0 ? gap / 60 : null,
        };
      })
      .filter((p) => Number.isFinite(p.y));
  }, [streams.distance, streams.velocity, splitRows, gradeSamples]);

  const avgGapPaceSec = useMemo(() => {
    const vals = gapLinePoints
      .map((p) => Number(p?.y || 0) * 60)
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return null;
    return vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }, [gapLinePoints]);

  const racePaceSec = useMemo(() => {
    const efforts = Array.isArray(activity?.best_efforts) ? activity.best_efforts : [];
    const from5k = efforts.find((e) => {
      const d = Number(e?.distance || 0);
      const t = Number(e?.elapsed_time || 0);
      return d >= 4900 && d <= 5100 && t > 0;
    });
    if (from5k) {
      return Number(from5k.elapsed_time) / (Number(from5k.distance) / 1000);
    }

    const from10k = efforts.find((e) => {
      const d = Number(e?.distance || 0);
      const t = Number(e?.elapsed_time || 0);
      return d >= 9800 && d <= 10200 && t > 0;
    });
    if (from10k) {
      return Number(from10k.elapsed_time) / (Number(from10k.distance) / 1000);
    }

    if (Number.isFinite(fastestSplitPaceSec) && fastestSplitPaceSec > 0) {
      return fastestSplitPaceSec * 1.08;
    }
    if (Number.isFinite(paceSecPerKm) && paceSecPerKm > 0) {
      return paceSecPerKm * 0.96;
    }
    return null;
  }, [activity?.best_efforts, fastestSplitPaceSec, paceSecPerKm]);

  const paceZones = useMemo(() => {
    if (!Number.isFinite(racePaceSec) || racePaceSec <= 0) return [];
    const samples = paceLinePoints
      .map((p) => Number(p?.y || 0) * 60)
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!samples.length) return [];
    const formatPaceShort = (secPerKm) => formatPace(secPerKm).replace("/km", "");

    const z6 = racePaceSec * 0.75;
    const z5 = racePaceSec * 0.84;
    const z4 = racePaceSec * 0.93;
    const z3 = racePaceSec * 1.03;
    const z2 = racePaceSec * 1.15;

    const defs = [
      { key: "Z6", min: null, max: z6, range: `< ${formatPaceShort(z6)}` },
      {
        key: "Z5",
        min: z6,
        max: z5,
        range: `${formatPaceShort(z6)}-${formatPaceShort(z5)}`,
      },
      {
        key: "Z4",
        min: z5,
        max: z4,
        range: `${formatPaceShort(z5)}-${formatPaceShort(z4)}`,
      },
      {
        key: "Z3",
        min: z4,
        max: z3,
        range: `${formatPaceShort(z4)}-${formatPaceShort(z3)}`,
      },
      {
        key: "Z2",
        min: z3,
        max: z2,
        range: `${formatPaceShort(z3)}-${formatPaceShort(z2)}`,
      },
      { key: "Z1", min: z2, max: null, range: `> ${formatPaceShort(z2)}` },
    ];

    return defs.map((z) => {
      const count = samples.filter((sec) => {
        if (z.min == null) return sec < z.max;
        if (z.max == null) return sec >= z.min;
        return sec >= z.min && sec < z.max;
      }).length;
      const pct = samples.length ? (count / samples.length) * 100 : 0;
      return {
        label: z.key,
        percentage: Math.max(0, Math.round(pct)),
        range: z.range,
      };
    });
  }, [racePaceSec, paceLinePoints]);

  const hrZones = useMemo(() => {
    const hrSamples = hrLinePoints
      .map((p) => Number(p?.y || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const maxHr = Number(maxHrValue || 0);
    if (!hrSamples.length || !maxHr) return [];

    const b1 = maxHr * 0.6;
    const b2 = maxHr * 0.7;
    const b3 = maxHr * 0.8;
    const b4 = maxHr * 0.9;

    const defs = [
      { label: "Z5", min: b4, max: null, range: `>${Math.round(b4)} bpm` },
      {
        label: "Z4",
        min: b3,
        max: b4,
        range: `${Math.round(b3)}-${Math.round(b4)} bpm`,
      },
      {
        label: "Z3",
        min: b2,
        max: b3,
        range: `${Math.round(b2)}-${Math.round(b3)} bpm`,
      },
      {
        label: "Z2",
        min: b1,
        max: b2,
        range: `${Math.round(b1)}-${Math.round(b2)} bpm`,
      },
      { label: "Z1", min: null, max: b1, range: `0-${Math.round(b1)} bpm` },
    ];

    return defs.map((z) => {
      const count = hrSamples.filter((value) => {
        if (z.min == null) return value < z.max;
        if (z.max == null) return value >= z.min;
        return value >= z.min && value < z.max;
      }).length;
      const pct = hrSamples.length ? (count / hrSamples.length) * 100 : 0;
      return {
        label: z.label,
        percentage: Math.max(0, Math.round(pct)),
        range: z.range,
      };
    });
  }, [hrLinePoints, maxHrValue]);

  const paceZonesSummary = useMemo(() => {
    if (!paceZones.length) return "";
    const top = [...paceZones].sort((a, b) => b.percentage - a.percentage)[0];
    if (!top || top.percentage <= 0) return "";
    if (top.label === "Z2" || top.label === "Z3") {
      return `Most of this run sat in ${top.label} (${top.percentage}%), which is good control for aerobic development and steady pacing.`;
    }
    if (top.label === "Z4" || top.label === "Z5" || top.label === "Z6") {
      return `This run skewed fast in ${top.label} (${top.percentage}%). Keep an eye on control early if the goal was a steadier aerobic day.`;
    }
    return `Most time was in ${top.label} (${top.percentage}%), suggesting a lower-intensity endurance focus.`;
  }, [paceZones]);

  const hrZonesSummary = useMemo(() => {
    if (!hrZones.length) return "";
    const top = [...hrZones].sort((a, b) => b.percentage - a.percentage)[0];
    if (!top || top.percentage <= 0) return "";
    if (top.label === "Z2" || top.label === "Z3") {
      return `Heart rate sat mostly in ${top.label} (${top.percentage}%), a productive range for aerobic conditioning.`;
    }
    if (top.label === "Z4" || top.label === "Z5") {
      return `Heart rate spent most time in ${top.label} (${top.percentage}%), which indicates a hard effort day.`;
    }
    return `Heart rate stayed mainly in ${top.label} (${top.percentage}%), indicating an easier overall load.`;
  }, [hrZones]);

  const powerLinePoints = useMemo(() => {
    const distanceArr = streams.distance || [];
    const wattsArr = streams.watts || [];
    const len = Math.min(distanceArr.length, wattsArr.length);
    if (len <= 1) return [];
    return Array.from({ length: len }, (_, i) => ({
      x: Number(distanceArr[i] || 0) / 1000,
      y: Number(wattsArr[i] || 0),
    })).filter((p) => Number.isFinite(p.y) && p.y > 0);
  }, [streams.distance, streams.watts]);

  const avgPowerValue = useMemo(() => {
    if (powerLinePoints.length) {
      return (
        powerLinePoints.reduce((sum, p) => sum + Number(p.y || 0), 0) /
        powerLinePoints.length
      );
    }
    const fallback = Number(activity?.average_watts || 0);
    return fallback > 0 ? fallback : null;
  }, [powerLinePoints, activity?.average_watts]);

  const maxPowerValue = useMemo(() => {
    if (powerLinePoints.length) {
      return Math.max(...powerLinePoints.map((p) => Number(p.y || 0)));
    }
    const fallback = Number(activity?.max_watts || 0);
    return fallback > 0 ? fallback : null;
  }, [powerLinePoints, activity?.max_watts]);

  const cadenceFactor = useMemo(() => {
    const raw = (streams.cadence || [])
      .map((v) => Number(v || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!raw.length) {
      const fallback = Number(activity?.average_cadence || 0);
      if (fallback > 0 && fallback < 120) return 2;
      return 1;
    }
    const avg = raw.reduce((sum, v) => sum + v, 0) / raw.length;
    return avg < 120 ? 2 : 1;
  }, [streams.cadence, activity?.average_cadence]);

  const cadenceLinePoints = useMemo(() => {
    const distanceArr = streams.distance || [];
    const cadenceArr = streams.cadence || [];
    const len = Math.min(distanceArr.length, cadenceArr.length);
    if (len <= 1) return [];
    return Array.from({ length: len }, (_, i) => ({
      x: Number(distanceArr[i] || 0) / 1000,
      y: Number(cadenceArr[i] || 0) * cadenceFactor,
    })).filter((p) => Number.isFinite(p.y) && p.y > 0);
  }, [streams.distance, streams.cadence, cadenceFactor]);

  const avgCadenceValue = useMemo(() => {
    if (cadenceLinePoints.length) {
      return (
        cadenceLinePoints.reduce((sum, p) => sum + Number(p.y || 0), 0) /
        cadenceLinePoints.length
      );
    }
    const fallback = Number(activity?.average_cadence || 0);
    if (fallback > 0) return fallback * cadenceFactor;
    return null;
  }, [cadenceLinePoints, activity?.average_cadence, cadenceFactor]);

  const maxCadenceValue = useMemo(() => {
    if (cadenceLinePoints.length) {
      return Math.max(...cadenceLinePoints.map((p) => Number(p.y || 0)));
    }
    const fallback = Number(activity?.max_cadence || 0);
    if (fallback > 0) return fallback * cadenceFactor;
    if (Number.isFinite(avgCadenceValue) && avgCadenceValue > 0) return avgCadenceValue;
    return null;
  }, [cadenceLinePoints, activity?.max_cadence, cadenceFactor, avgCadenceValue]);

  const headerDateLabel = useMemo(
    () => formatHeaderDate(activity?.start_date_local || activity?.start_date),
    [activity?.start_date, activity?.start_date_local]
  );

  const locationLabel = useMemo(() => {
    const parts = [
      activity?.location_city,
      activity?.location_state,
      activity?.location_country,
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean);

    return parts.join(", ");
  }, [activity?.location_city, activity?.location_country, activity?.location_state]);

  const deviceLabel = useMemo(() => {
    const raw = String(
      activity?.device_name || activity?.gear?.name || ""
    ).trim();
    return raw || "";
  }, [activity?.device_name, activity?.gear?.name]);

  useEffect(() => {
    let cancelled = false;

    const loadPlanOptions = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid || !activity?.id) {
        setPlanOptions([]);
        setLinkedPlanSession(null);
        setTargetPlanSessionOption(null);
        return;
      }

      try {
        setPlanLinkError("");
        setPlanOptionsLoading(true);

        const sessionLogSnap = await getDocs(collection(db, "users", uid, "sessionLogs"));
        const sessionLogMap = new Map();
        let matchedLink = null;

        sessionLogSnap.forEach((docSnap) => {
          const log = docSnap.data() || {};
          const item = { id: docSnap.id, ...log };
          sessionLogMap.set(docSnap.id, item);

          if (
            !matchedLink &&
            String(log?.linkedActivity?.reference || "").trim() === String(activity.id) &&
            String(log?.linkedActivity?.provider || "").trim().toLowerCase() === "strava"
          ) {
            matchedLink = item;
          }
        });

        const planCollections = ["plans", "runPlans", "trainingPlans"];
        const planSnaps = await Promise.all(
          planCollections.map((name) => getDocs(collection(db, "users", uid, name)))
        );

        const options = [];
        planSnaps.forEach((snap) => {
          snap.forEach((planDocSnap) => {
            const planDoc = { id: planDocSnap.id, ...planDocSnap.data() };
            listPlanSessions(planDoc).forEach((entry) => {
              const statusLog = sessionLogMap.get(entry.sessionKey);
              const status = resolveSessionLogStatus(statusLog);
              const sessionMode = isStrengthLikeSession(entry.session) ? "strength" : "run";

              if (activityMode === "strength" && sessionMode !== "strength") return;
              if (activityMode === "run" && sessionMode !== "run") return;

              options.push({
                ...entry,
                status,
                savedTrainSessionId:
                  String(statusLog?.lastTrainSessionId || "").trim() || null,
              });
            });
          });
        });

        options.sort((a, b) => {
          const rank = (status) => {
            if (status === "completed") return 1;
            if (status === "skipped") return 2;
            return 0;
          };
          const statusDiff = rank(a.status) - rank(b.status);
          if (statusDiff !== 0) return statusDiff;
          const planDiff = String(a.planName || "").localeCompare(String(b.planName || ""));
          if (planDiff !== 0) return planDiff;
          if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
          if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
          return a.sessionIndex - b.sessionIndex;
        });

        if (cancelled) return;

        setPlanOptions(options);

        if (matchedLink) {
          const linkedOption = options.find((entry) => entry.sessionKey === matchedLink.id);
          setLinkedPlanSession(
            linkedOption || {
              sessionKey: matchedLink.id,
              title: matchedLink.title || "Planned session",
              planName: matchedLink.planName || "Training plan",
              dayLabel: matchedLink.dayLabel || "",
              weekLabel: matchedLink.weekLabel || "",
              status: resolveSessionLogStatus(matchedLink),
              savedTrainSessionId:
                String(matchedLink.lastTrainSessionId || "").trim() || null,
            }
          );
        } else {
          setLinkedPlanSession(null);
        }

        if (targetPlanSessionKey) {
          const matchedOption = options.find(
            (entry) => String(entry?.sessionKey || "").trim() === targetPlanSessionKey
          );

          setTargetPlanSessionOption(
            matchedOption || {
              sessionKey: targetPlanSessionKey,
              title: targetPlanSessionTitleParam || "Planned session",
              planName: "",
              weekLabel: "",
              dayLabel: "",
              status: "",
              savedTrainSessionId: null,
              session: { title: targetPlanSessionTitleParam || "Planned session" },
            }
          );
        } else {
          setTargetPlanSessionOption(null);
        }
      } catch (e) {
        console.error("Plan options load error", e);
        if (!cancelled) {
          setPlanLinkError("Couldn't load planned sessions.");
          setPlanOptions([]);
          setLinkedPlanSession(null);
          setTargetPlanSessionOption(null);
        }
      } finally {
        if (!cancelled) {
          setPlanOptionsLoading(false);
        }
      }
    };

    loadPlanOptions();

    return () => {
      cancelled = true;
    };
  }, [activity?.id, activityMode, targetPlanSessionKey, targetPlanSessionTitleParam]);

  const paceConsistency = useMemo(() => {
    const values = splitRows
      .map((row) => Number(row?.paceSec || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length < 2) return null;

    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (!avg) return null;

    const variance =
      values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;

    return Math.sqrt(variance) / avg;
  }, [splitRows]);

  const topStats = useMemo(() => {
    const orderedStats = isStrengthActivity
      ? [
          {
            key: "time",
            label: "Time",
            value: formatDuration(movingTime),
            icon: "clock",
          },
          {
            key: "avg-hr",
            label: "Avg HR",
            value: avgHrValue != null ? `${Math.round(avgHrValue)} bpm` : null,
            icon: "heart",
          },
          {
            key: "max-hr",
            label: "Max HR",
            value: maxHrValue != null ? `${Math.round(maxHrValue)} bpm` : null,
            icon: "activity",
          },
          {
            key: "calories",
            label: "Load",
            value:
              activity?.kilojoules != null
                ? `${Math.round(activity.kilojoules)} kJ`
                : activity?.suffer_score != null
                ? `${Math.round(activity.suffer_score)}`
                : null,
            icon: "zap",
          },
          {
            key: "device",
            label: "Device",
            value: deviceLabel || null,
            icon: "watch",
          },
          {
            key: "elapsed",
            label: "Elapsed",
            value: elapsedTime && elapsedTime !== movingTime ? formatDuration(elapsedTime) : null,
            icon: "watch",
          },
          {
            key: "cadence",
            label: "Cadence",
            value: avgCadenceValue != null ? `${Math.round(avgCadenceValue)} spm` : null,
            icon: "repeat",
          },
          {
            key: "power",
            label: "Avg Power",
            value: avgPowerValue != null ? `${Math.round(avgPowerValue)} W` : null,
            icon: "battery-charging",
          },
        ]
      : [
          {
            key: "distance",
            label: "Distance",
            value: formatDistance(distance),
            icon: "map",
          },
          {
            key: "pace",
            label: "Pace",
            value: formatPace(paceSecPerKm),
            icon: "activity",
          },
          {
            key: "time",
            label: "Time",
            value: formatDuration(movingTime),
            icon: "clock",
          },
          {
            key: "avg-hr",
            label: "Avg HR",
            value: avgHrValue != null ? `${Math.round(avgHrValue)} bpm` : null,
            icon: "heart",
          },
          {
            key: "elevation",
            label: "Elevation",
            value:
              activity?.total_elevation_gain != null
                ? `${Math.round(activity.total_elevation_gain)} m`
                : "-",
            icon: "trending-up",
          },
          {
            key: "calories",
            label: "Calories",
            value:
              activity?.kilojoules != null
                ? `${Math.round(activity.kilojoules)} kJ`
                : null,
            icon: "battery-charging",
          },
          {
            key: "cadence",
            label: "Cadence",
            value: avgCadenceValue != null ? `${Math.round(avgCadenceValue)} spm` : null,
            icon: "repeat",
          },
          {
            key: "power",
            label: "Avg Power",
            value: avgPowerValue != null ? `${Math.round(avgPowerValue)} W` : null,
            icon: "zap",
          },
          {
            key: "elapsed",
            label: "Elapsed",
            value: elapsedTime && elapsedTime !== movingTime ? formatDuration(elapsedTime) : null,
            icon: "watch",
          },
        ];

    return orderedStats.filter((item) => item.value).slice(0, 8);
  }, [
    activity?.kilojoules,
    activity?.suffer_score,
    activity?.total_elevation_gain,
    avgCadenceValue,
    avgHrValue,
    avgPowerValue,
    deviceLabel,
    distance,
    elapsedTime,
    isStrengthActivity,
    maxHrValue,
    movingTime,
    paceSecPerKm,
  ]);

  const quickInsight = useMemo(() => {
    const segments = [];
    const distanceKm = Number(distance || 0) > 0 ? Number(distance) / 1000 : null;

    if (isStrengthActivity) {
      if (movingTime) {
        segments.push(`${formatDuration(movingTime)} strength session`);
      }
      if (avgHrValue != null) {
        segments.push(`avg HR ${Math.round(avgHrValue)} bpm`);
      }
      if (activity?.kilojoules != null) {
        segments.push(`${Math.round(activity.kilojoules)} kJ recorded`);
      } else if (activity?.suffer_score != null) {
        segments.push(`load score ${Math.round(activity.suffer_score)}`);
      }
      if (deviceLabel) {
        segments.push(`tracked on ${deviceLabel}`);
      }

      if (!segments.length) return "";
      return `${segments[0]}${segments.length > 1 ? `, ${segments.slice(1).join(", ")}` : ""}.`;
    }

    if (distanceKm && paceSecPerKm) {
      let sessionType = "run";
      const dominantHrZone = [...hrZones].sort((a, b) => b.percentage - a.percentage)[0];

      if (dominantHrZone?.label === "Z1") sessionType = "easy aerobic run";
      else if (dominantHrZone?.label === "Z2") sessionType = "steady endurance run";
      else if (dominantHrZone?.label === "Z3") sessionType = "strong aerobic run";
      else if (dominantHrZone?.label === "Z4" || dominantHrZone?.label === "Z5") {
        sessionType = "hard effort";
      }

      const roundedDistance =
        distanceKm >= 10 ? distanceKm.toFixed(1) : distanceKm.toFixed(2);

      segments.push(`${roundedDistance}km ${sessionType} at ${formatPace(paceSecPerKm)}`);
    }

    if (paceConsistency != null) {
      if (paceConsistency <= 0.04) segments.push("very even pacing");
      else if (paceConsistency <= 0.08) segments.push("controlled pacing");
      else segments.push("pace moved around across the run");
    }

    if (activity?.total_elevation_gain != null && Number(activity.total_elevation_gain) >= 60) {
      segments.push(`with ${Math.round(activity.total_elevation_gain)}m of climbing`);
    }

    if (avgHrValue != null) {
      segments.push(`avg HR ${Math.round(avgHrValue)} bpm`);
    }

    if (!segments.length) return "";
    return `${segments[0]}${segments.length > 1 ? `, ${segments.slice(1).join(", ")}` : ""}.`;
  }, [
    activity?.kilojoules,
    activity?.suffer_score,
    activity?.total_elevation_gain,
    avgHrValue,
    deviceLabel,
    distance,
    hrZones,
    isStrengthActivity,
    movingTime,
    paceConsistency,
    paceSecPerKm,
  ]);

  const targetTrainSessionTitle = useMemo(() => {
    const title = String(
      targetTrainSession?.title ||
        targetTrainSession?.name ||
        targetTrainSession?.sessionType ||
        "training session"
    ).trim();
    return title || "training session";
  }, [targetTrainSession]);

  const targetPlanSessionTitle = useMemo(() => {
    const title = String(
      targetPlanSessionOption?.session?.title ||
        targetPlanSessionOption?.session?.name ||
        targetPlanSessionOption?.title ||
        targetPlanSessionTitleParam ||
        "planned session"
    ).trim();
    return title || "planned session";
  }, [targetPlanSessionOption, targetPlanSessionTitleParam]);

  const isLinkedToTargetPlanSession = useMemo(() => {
    if (!targetPlanSessionKey) return false;
    return (
      String(linkedPlanSession?.sessionKey || "").trim() ===
      String(targetPlanSessionKey || "").trim()
    );
  }, [linkedPlanSession?.sessionKey, targetPlanSessionKey]);

  const targetPlanSavedTrainSessionId = useMemo(() => {
    const fromTarget = String(targetPlanSessionOption?.savedTrainSessionId || "").trim();
    if (fromTarget) return fromTarget;

    if (!isLinkedToTargetPlanSession) return null;
    const fromLinked = String(linkedPlanSession?.savedTrainSessionId || "").trim();
    return fromLinked || null;
  }, [
    isLinkedToTargetPlanSession,
    linkedPlanSession?.savedTrainSessionId,
    targetPlanSessionOption?.savedTrainSessionId,
  ]);

  const isLinkedToTargetSession = useMemo(() => {
    const ref = String(targetTrainSession?.linkedActivity?.reference || "").trim();
    return !!ref && ref === String(activity?.id || "");
  }, [activity?.id, targetTrainSession?.linkedActivity?.reference]);

  const handleLinkPlanSession = async (option) => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }
      if (!activity?.id) {
        Alert.alert("Missing activity", "This activity is missing its reference.");
        return;
      }
      if (linkedPlanSession?.sessionKey && linkedPlanSession.sessionKey !== option?.sessionKey) {
        Alert.alert(
          "Already linked",
          "This activity is already linked to a planned session. Open that session instead of creating a second link."
        );
        return;
      }

      setLinkingPlan(true);

      const linkedActivity = {
        provider: "Strava",
        reference: String(activity.id),
        type: String(activity.type || ""),
        title: String(activity.name || activityTypeLabel || "Workout"),
        startDate: activity.start_date || null,
        startDateLocal: activity.start_date_local || null,
        deviceName: deviceLabel || null,
        distanceKm:
          Number(distance) > 0 ? Number((Number(distance) / 1000).toFixed(3)) : null,
        movingTimeMin:
          Number(movingTime) > 0 ? Number((Number(movingTime) / 60).toFixed(1)) : null,
        elapsedTimeMin:
          Number(elapsedTime) > 0 ? Number((Number(elapsedTime) / 60).toFixed(1)) : null,
        averageHeartrate:
          avgHrValue != null ? Math.round(avgHrValue) : null,
        maxHeartrate: maxHrValue != null ? Math.round(maxHrValue) : null,
      };

      const payloadOverrides = {
        date: toDateOnly(activity.start_date_local || activity.start_date),
        actualDurationMin:
          Number(movingTime) > 0 ? Number((Number(movingTime) / 60).toFixed(1)) : null,
        actualDistanceKm:
          Number(distance) > 0 ? Number((Number(distance) / 1000).toFixed(3)) : null,
      };

      const { trainSessionId } = await linkExternalActivityToPlannedSession({
        uid,
        encodedKey: option.sessionKey,
        notes: String(activity.description || "").trim(),
        linkedActivity,
        payloadOverrides,
      });

      const nextLinked = {
        ...option,
        status: "completed",
        savedTrainSessionId: trainSessionId,
      };

      setLinkedPlanSession(nextLinked);
      setPlanOptions((prev) =>
        prev.map((entry) =>
          entry.sessionKey === option.sessionKey
            ? { ...entry, status: "completed", savedTrainSessionId: trainSessionId }
            : entry
        )
      );
      setPlanPickerOpen(false);

      Alert.alert("Linked to plan", "This activity now completes that programmed session.", [
        {
          text: "View session",
          onPress: () => router.push(`/train/history/${trainSessionId}`),
        },
        {
          text: "Stay here",
          style: "cancel",
        },
      ]);
    } catch (e) {
      console.error("Plan link save error", e);
      Alert.alert("Link failed", e?.message || "Please try again.");
    } finally {
      setLinkingPlan(false);
    }
  };

  const handleLinkTargetPlanSession = async () => {
    if (!targetPlanSessionKey) return;

    if (isLinkedToTargetPlanSession && targetPlanSavedTrainSessionId) {
      router.replace(`/train/history/${targetPlanSavedTrainSessionId}`);
      return;
    }

    await handleLinkPlanSession(
      targetPlanSessionOption || {
        sessionKey: targetPlanSessionKey,
        title: targetPlanSessionTitle,
        session: { title: targetPlanSessionTitle },
      }
    );
  };

  const handleLinkTrainSession = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }
      if (!targetTrainSessionId) {
        Alert.alert("Missing session", "This training session link is missing its id.");
        return;
      }
      if (!activity?.id) {
        Alert.alert("Missing activity", "This activity is missing its reference.");
        return;
      }
      if (isLinkedToTargetSession) {
        router.replace(`/train/history/${targetTrainSessionId}`);
        return;
      }

      setLinkingTrainSession(true);

      const linkedActivity = {
        provider: "Strava",
        reference: String(activity.id),
        type: String(activity.type || ""),
        title: String(activity.name || activityTypeLabel || "Workout"),
        startDate: activity.start_date || null,
        startDateLocal: activity.start_date_local || null,
        deviceName: deviceLabel || null,
        distanceKm:
          Number(distance) > 0 ? Number((Number(distance) / 1000).toFixed(3)) : null,
        movingTimeMin:
          Number(movingTime) > 0 ? Number((Number(movingTime) / 60).toFixed(1)) : null,
        elapsedTimeMin:
          Number(elapsedTime) > 0 ? Number((Number(elapsedTime) / 60).toFixed(1)) : null,
        averageHeartrate: avgHrValue != null ? Math.round(avgHrValue) : null,
        maxHeartrate: maxHrValue != null ? Math.round(maxHrValue) : null,
      };

      const payloadOverrides = {
        actualDurationMin:
          Number(movingTime) > 0 ? Number((Number(movingTime) / 60).toFixed(1)) : null,
        actualDistanceKm:
          Number(distance) > 0 ? Number((Number(distance) / 1000).toFixed(3)) : null,
        linkedActivity,
      };

      await attachExternalActivityToTrainSession({
        uid,
        trainSessionId: targetTrainSessionId,
        linkedActivity,
        payloadOverrides,
      });

      setTargetTrainSession((prev) =>
        prev
          ? {
              ...prev,
              linkedActivity,
              actualDurationMin: payloadOverrides.actualDurationMin ?? prev.actualDurationMin,
              actualDistanceKm: payloadOverrides.actualDistanceKm ?? prev.actualDistanceKm,
              status: "completed",
            }
          : prev
      );

      Alert.alert(
        "Linked to session",
        `This Strava activity is now attached to ${targetTrainSessionTitle}.`,
        [
          {
            text: "View session",
            onPress: () => router.replace(`/train/history/${targetTrainSessionId}`),
          },
          {
            text: "Stay here",
            style: "cancel",
          },
        ]
      );
    } catch (e) {
      console.error("Train session link error", e);
      Alert.alert("Link failed", e?.message || "Please try again.");
    } finally {
      setLinkingTrainSession(false);
    }
  };

  const onRunAnalysis = async () => {
    if (!activity) return;
    try {
      setAnalysisError("");
      setAnalysisLoading(true);
      setAnalysis("");

      const base = getApiBase();
      if (!base) {
        throw new Error("EXPO_PUBLIC_API_URL is not configured.");
      }
      const resp = await fetch(`${base}/api/analyse-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: activity.id,
          name: activity.name,
          type: activity.type,
          distance: activity.distance,
          moving_time: activity.moving_time,
          elapsed_time: activity.elapsed_time,
          average_heartrate: activity.average_heartrate,
          max_heartrate: activity.max_heartrate,
          total_elevation_gain: activity.total_elevation_gain,
          paceSecPerKm,
          start_date: activity.start_date,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${text}`);
      }

      const json = await resp.json();
      const text =
        json.analysis || json.message || JSON.stringify(json, null, 2);
      setAnalysis(text);
    } catch (e) {
      console.error("AI analysis error", e);
      setAnalysisError("Couldn't generate analysis. Check the AI server.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const onRunLapsReview = async () => {
    if (!activity) return;
    if (!lapsForAi.length) {
      setLapsReviewError("No lap data available to review.");
      return;
    }

    try {
      setLapsReviewError("");
      setLapsReviewLoading(true);
      setLapsReview("");

      const base = getApiBase();
      if (!base) {
        throw new Error("EXPO_PUBLIC_API_URL is not configured.");
      }
      const resp = await fetch(`${base}/api/analyse-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "laps_review",
          id: activity.id,
          name: activity.name,
          type: activity.type,
          distance: activity.distance,
          moving_time: activity.moving_time,
          elapsed_time: activity.elapsed_time,
          average_heartrate: activity.average_heartrate,
          max_heartrate: activity.max_heartrate,
          total_elevation_gain: activity.total_elevation_gain,
          paceSecPerKm,
          start_date: activity.start_date,
          notes: activity.description || "",
          laps: lapsForAi,
          warmup_excluded: warmupRows.length,
          cooldown_excluded: cooldownRows.length,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${text}`);
      }

      const json = await resp.json();
      setLapsReview(
        String(
          json?.analysis ||
            "No review returned. Try again."
        )
      );
    } catch (e) {
      console.error("AI laps review error", e);
      setLapsReviewError("Couldn't generate laps review. Check the AI server.");
    } finally {
      setLapsReviewLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          activeOpacity={0.8}
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          Activity
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading activity…</Text>
        </View>
      ) : err ? (
        <View style={s.center}>
          <Text style={s.errorText}>{err}</Text>
        </View>
      ) : !activity ? (
        <View style={s.center}>
          <Text style={s.centerText}>Activity not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {/* Title + meta */}
          <View style={s.heroBlock}>
            <View style={s.metaChipRow}>
              {!!headerDateLabel ? (
                <View style={s.metaChip}>
                  <Feather name="calendar" size={13} color={colors.subtext} />
                  <Text style={s.metaChipText}>{headerDateLabel}</Text>
                </View>
              ) : null}
              {!!locationLabel ? (
                <View style={s.metaChip}>
                  <Feather name="map-pin" size={13} color={colors.subtext} />
                  <Text style={s.metaChipText}>{locationLabel}</Text>
                </View>
              ) : null}
              {!!deviceLabel ? (
                <View style={s.metaChip}>
                  <Feather name="watch" size={13} color={colors.subtext} />
                  <Text style={s.metaChipText}>{deviceLabel}</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.activityTitle}>{name}</Text>
            <Text style={s.activityType}>
              {activityTypeLabel} • {formatDateTime(activity.start_date)}
            </Text>
          </View>

          {/* Route map – native only */}
          {Platform.OS !== "web" &&
            MapViewComponent &&
            PolylineComponent &&
            coords &&
            coords.length > 1 &&
            region && (
              <View style={s.mapCard}>
                <MapViewComponent
                  style={s.map}
                  initialRegion={region}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  <PolylineComponent
                    coordinates={coords}
                    strokeWidth={3}
                    // strokeColor can be set if you want
                  />
                </MapViewComponent>
              </View>
            )}

          {/* Key stats */}
          <View style={s.statsGrid}>
            {topStats.map((stat) => (
              <View key={stat.key} style={s.statCell}>
                <StatBlock
                  label={stat.label}
                  value={stat.value}
                  icon={stat.icon}
                  colors={colors}
                  isDark={isDark}
                />
              </View>
            ))}
          </View>

          {quickInsight ? (
            <View style={s.insightCard}>
              <View style={s.insightHeader}>
                <Text style={s.insightEyebrow}>Quick Read</Text>
                <TouchableOpacity
                  style={s.chipBtn}
                  onPress={onRunAnalysis}
                  disabled={analysisLoading}
                  activeOpacity={0.85}
                >
                  {analysisLoading ? (
                    <ActivityIndicator size="small" color={accentText} />
                  ) : (
                    <>
                      <Feather
                        name="zap"
                        size={14}
                        color={accentText}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={s.chipBtnText}>Analyse</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              <Text style={s.insightText}>{quickInsight}</Text>
              {analysis ? (
                <Text style={s.insightFollowupText} numberOfLines={2}>
                  {analysis}
                </Text>
              ) : null}
            </View>
          ) : null}

          {targetTrainSessionId ? (
            <View style={s.linkPlanCard}>
              <View style={s.linkPlanHeader}>
                <Text style={s.linkPlanEyebrow}>Training Session</Text>
                {isLinkedToTargetSession ? (
                  <View
                    style={[
                      s.linkPlanStatusChip,
                      s.linkPlanStatusChipDone,
                    ]}
                  >
                    <Text style={[s.linkPlanStatusText, s.linkPlanStatusTextDone]}>
                      Linked
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={s.linkPlanTitle}>
                {targetTrainSessionTitle}
              </Text>
              <Text style={s.linkPlanMeta}>
                {targetTrainSessionError
                  ? targetTrainSessionError
                  : isLinkedToTargetSession
                  ? "This Strava activity is already attached to that saved training session."
                  : "Use this activity as the completed Strava record for that saved training session."}
              </Text>

              <TouchableOpacity
                style={[
                  s.linkPlanButton,
                  (linkingTrainSession || !!targetTrainSessionError) && s.linkPlanButtonDisabled,
                ]}
                activeOpacity={0.85}
                disabled={linkingTrainSession || !!targetTrainSessionError}
                onPress={handleLinkTrainSession}
              >
                {linkingTrainSession ? (
                  <ActivityIndicator size="small" color={accentText} />
                ) : (
                  <>
                    <Feather
                      name={isLinkedToTargetSession ? "arrow-up-right" : "link"}
                      size={15}
                      color={accentText}
                    />
                    <Text style={s.linkPlanButtonText}>
                      {isLinkedToTargetSession ? "View linked session" : "Link to this session"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {targetPlanSessionKey ? (
            <View style={s.linkPlanCard}>
              <View style={s.linkPlanHeader}>
                <Text style={s.linkPlanEyebrow}>Planned Session</Text>
                {isLinkedToTargetPlanSession ? (
                  <View style={[s.linkPlanStatusChip, s.linkPlanStatusChipDone]}>
                    <Text style={[s.linkPlanStatusText, s.linkPlanStatusTextDone]}>Linked</Text>
                  </View>
                ) : null}
              </View>

              <Text style={s.linkPlanTitle}>{targetPlanSessionTitle}</Text>
              <Text style={s.linkPlanMeta}>
                {isLinkedToTargetPlanSession
                  ? "This Strava activity is already attached to that planned session."
                  : "Use this activity as the completed Strava record for the planned session you opened."}
              </Text>

              <TouchableOpacity
                style={[s.linkPlanButton, linkingPlan && s.linkPlanButtonDisabled]}
                activeOpacity={0.85}
                disabled={linkingPlan}
                onPress={handleLinkTargetPlanSession}
              >
                {linkingPlan ? (
                  <ActivityIndicator size="small" color={accentText} />
                ) : (
                  <>
                    <Feather
                      name={
                        isLinkedToTargetPlanSession && targetPlanSavedTrainSessionId
                          ? "arrow-up-right"
                          : "link"
                      }
                      size={15}
                      color={accentText}
                    />
                    <Text style={s.linkPlanButtonText}>
                      {isLinkedToTargetPlanSession && targetPlanSavedTrainSessionId
                        ? "View linked session"
                        : "Link to this session"}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {!targetPlanSessionKey ? (
            <View style={s.linkPlanCard}>
              <View style={s.linkPlanHeader}>
                <Text style={s.linkPlanEyebrow}>Plan Link</Text>
                {linkedPlanSession?.status ? (
                  <View
                    style={[
                      s.linkPlanStatusChip,
                      linkedPlanSession.status === "completed"
                        ? s.linkPlanStatusChipDone
                        : s.linkPlanStatusChipSkipped,
                    ]}
                  >
                    <Text
                      style={[
                        s.linkPlanStatusText,
                        linkedPlanSession.status === "completed"
                          ? s.linkPlanStatusTextDone
                          : s.linkPlanStatusTextSkipped,
                      ]}
                    >
                      {linkedPlanSession.status === "completed" ? "Completed" : "Skipped"}
                    </Text>
                  </View>
                ) : null}
              </View>

              {linkedPlanSession ? (
                <>
                  <Text style={s.linkPlanTitle}>
                    {linkedPlanSession.session?.title ||
                      linkedPlanSession.session?.name ||
                      linkedPlanSession.title ||
                      "Planned session"}
                  </Text>
                  <Text style={s.linkPlanMeta}>
                    {[
                      linkedPlanSession.planName,
                      linkedPlanSession.weekLabel,
                      linkedPlanSession.dayLabel,
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </Text>
                  <TouchableOpacity
                    style={s.linkPlanButton}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (linkedPlanSession.savedTrainSessionId) {
                        router.push(`/train/history/${linkedPlanSession.savedTrainSessionId}`);
                      }
                    }}
                  >
                    <Feather name="arrow-up-right" size={15} color={accentText} />
                    <Text style={s.linkPlanButtonText}>View linked session</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={s.linkPlanTitle}>Link this activity to a planned session</Text>
                  <Text style={s.linkPlanMeta}>
                    {activityMode === "strength"
                      ? "Only strength sessions from your plan are shown."
                      : activityMode === "run"
                      ? "Only run sessions from your plan are shown."
                      : "Choose a programmed session to mark it complete from this activity."}
                  </Text>
                  {planLinkError ? <Text style={s.errorText}>{planLinkError}</Text> : null}
                  <TouchableOpacity
                    style={[
                      s.linkPlanButton,
                      (planOptionsLoading || !planOptions.length) && s.linkPlanButtonDisabled,
                    ]}
                    activeOpacity={0.85}
                    disabled={planOptionsLoading || !planOptions.length}
                    onPress={() => setPlanPickerOpen(true)}
                  >
                    {planOptionsLoading ? (
                      <ActivityIndicator size="small" color={accentText} />
                    ) : (
                      <>
                        <Feather name="link" size={15} color={accentText} />
                        <Text style={s.linkPlanButtonText}>
                          {planOptions.length ? "Link to planned session" : "No matching sessions"}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null}

          {isStrengthActivity ? (
            <>
              <AnalyticsGroup title="Strength" colors={colors} isDark={isDark}>
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Session Summary</Text>
                  <View style={s.metricInlineRow}>
                    <MetricInline
                      label="Type"
                      value={activityTypeLabel}
                      colors={colors}
                    />
                    <MetricInline
                      label="Time"
                      value={formatDuration(movingTime)}
                      colors={colors}
                    />
                    <MetricInline
                      label="Load"
                      value={
                        activity?.kilojoules != null
                          ? `${Math.round(activity.kilojoules)} kJ`
                          : activity?.suffer_score != null
                          ? `${Math.round(activity.suffer_score)}`
                          : "-"
                      }
                      colors={colors}
                    />
                  </View>
                  <View style={s.metricInlineRow}>
                    <MetricInline
                      label="Avg Heart Rate"
                      value={avgHrValue ? `${Math.round(avgHrValue)} bpm` : "-"}
                      colors={colors}
                    />
                    <MetricInline
                      label="Max Heart Rate"
                      value={maxHrValue ? `${Math.round(maxHrValue)} bpm` : "-"}
                      colors={colors}
                    />
                    <MetricInline
                      label="Device"
                      value={deviceLabel || "-"}
                      colors={colors}
                    />
                  </View>
                  <Text style={s.metricSummaryText}>
                    Strength activities rarely include pace, split, or route data from Strava, so this view
                    focuses on time, effort, heart rate, and linking back to your programmed plan.
                  </Text>
                </View>

                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Recorded Details</Text>
                  <DetailRow
                    label="Started"
                    value={formatHeaderDate(activity.start_date_local || activity.start_date) || "-"}
                    colors={colors}
                  />
                  <DetailRow
                    label="Elapsed"
                    value={formatDuration(elapsedTime)}
                    colors={colors}
                  />
                  <DetailRow
                    label="Gear / device"
                    value={deviceLabel || activity.gear?.name || "-"}
                    colors={colors}
                  />
                  <DetailRow
                    label="Location"
                    value={locationLabel || "-"}
                    colors={colors}
                  />
                </View>
              </AnalyticsGroup>

              <AnalyticsGroup title="Heart Rate" colors={colors} isDark={isDark}>
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Heart Rate</Text>
                  {hrLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={hrLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#EF4444" : "#DC2626"}
                    />
                  ) : (
                    <Text style={s.centerText}>No heart-rate stream available for this activity.</Text>
                  )}
                  <View style={s.metricInlineRow}>
                    <MetricInline
                      label="Avg Heart Rate"
                      value={avgHrValue ? `${Math.round(avgHrValue)} bpm` : "-"}
                      colors={colors}
                    />
                    <MetricInline
                      label="Max Heart Rate"
                      value={maxHrValue ? `${Math.round(maxHrValue)} bpm` : "-"}
                      colors={colors}
                    />
                    <MetricInline
                      label="Min Heart Rate"
                      value={
                        hrLinePoints.length > 0
                          ? `${Math.round(
                              Math.min(...hrLinePoints.map((p) => Number(p.y || 0)))
                            )} bpm`
                          : "-"
                      }
                      colors={colors}
                    />
                  </View>
                </View>

                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Heart Rate Zones</Text>
                  {hrZones.length > 0 ? (
                    <>
                      <ZoneDistribution
                        rows={hrZones}
                        colors={colors}
                        isDark={isDark}
                        accent={isDark ? "#EF4444" : "#DC2626"}
                      />
                      {hrZonesSummary ? (
                        <Text style={s.metricSummaryText}>{hrZonesSummary}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={s.centerText}>Not enough heart-rate data to calculate zones.</Text>
                  )}
                </View>
              </AnalyticsGroup>

              {(powerLinePoints.length > 1 ||
                avgPowerValue != null ||
                maxPowerValue != null ||
                cadenceLinePoints.length > 1 ||
                avgCadenceValue != null) ? (
                <AnalyticsGroup title="Effort" colors={colors} isDark={isDark}>
                  {(powerLinePoints.length > 1 || avgPowerValue != null || maxPowerValue != null) ? (
                    <View
                      style={
                        cadenceLinePoints.length > 1 || avgCadenceValue != null
                          ? s.analyticsItem
                          : s.analyticsItemLast
                      }
                    >
                      <Text style={s.sectionTitle}>Power</Text>
                      {powerLinePoints.length > 1 ? (
                        <LineProfileChart
                          data={powerLinePoints}
                          colors={colors}
                          isDark={isDark}
                          accent={isDark ? "#A855F7" : "#9333EA"}
                        />
                      ) : (
                        <Text style={s.centerText}>No power stream available for this activity.</Text>
                      )}
                      <View style={s.metricInlineRow}>
                        <MetricInline
                          label="Avg Power"
                          value={avgPowerValue != null ? `${Math.round(avgPowerValue)} W` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Max Power"
                          value={maxPowerValue != null ? `${Math.round(maxPowerValue)} W` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Weighted Avg"
                          value={
                            activity?.weighted_average_watts != null
                              ? `${Math.round(activity.weighted_average_watts)} W`
                              : "-"
                          }
                          colors={colors}
                        />
                      </View>
                    </View>
                  ) : null}

                  {(cadenceLinePoints.length > 1 || avgCadenceValue != null) ? (
                    <View style={s.analyticsItemLast}>
                      <Text style={s.sectionTitle}>Cadence</Text>
                      {cadenceLinePoints.length > 1 ? (
                        <LineProfileChart
                          data={cadenceLinePoints}
                          colors={colors}
                          isDark={isDark}
                          accent={isDark ? "#EC4899" : "#DB2777"}
                        />
                      ) : (
                        <Text style={s.centerText}>No cadence stream available for this activity.</Text>
                      )}
                      <View style={s.metricInlineRow}>
                        <MetricInline
                          label="Avg Cadence"
                          value={avgCadenceValue != null ? `${Math.round(avgCadenceValue)} spm` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Max Cadence"
                          value={maxCadenceValue != null ? `${Math.round(maxCadenceValue)} spm` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Cadence Type"
                          value={cadenceFactor === 2 ? "Doubled to spm" : "Native spm"}
                          colors={colors}
                        />
                      </View>
                    </View>
                  ) : null}
                </AnalyticsGroup>
              ) : null}
            </>
          ) : (
            <>
              <AnalyticsGroup title="Pace" colors={colors} isDark={isDark}>
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Workout Analysis</Text>
                  {workoutBars.length > 1 ? (
                    <WorkoutAnalysisChart
                      data={workoutBars}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#60A5FA" : "#2563EB"}
                    />
                  ) : (
                    <Text style={s.centerText}>No split data available for workout analysis.</Text>
                  )}
                </View>

                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Pace</Text>
                  {paceLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={paceLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#3B82F6" : "#2563EB"}
                    />
                  ) : (
                    <Text style={s.centerText}>No pace stream available for this activity.</Text>
                  )}
                  <View style={s.metricInlineRow}>
                    <MetricInline label="Avg Pace" value={formatPace(paceSecPerKm)} colors={colors} />
                    <MetricInline
                      label="Avg Elapsed Pace"
                      value={
                        distance && elapsedTime
                          ? formatPace(elapsedTime / (distance / 1000))
                          : "-"
                      }
                      colors={colors}
                    />
                    <MetricInline
                      label="Fastest Split"
                      value={formatPace(fastestSplitPaceSec)}
                      colors={colors}
                    />
                  </View>
                </View>

                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Grade Adjusted Pace</Text>
                  {gapLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={gapLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#60A5FA" : "#3B82F6"}
                    />
                  ) : (
                    <Text style={s.centerText}>No GAP stream available for this activity.</Text>
                  )}
                  <View style={s.metricInlineRowSingle}>
                    <MetricInline
                      label="Avg GAP"
                      value={formatPace(avgGapPaceSec)}
                      colors={colors}
                    />
                  </View>
                </View>

                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Pace Zones</Text>
                  {paceZones.length > 0 ? (
                    <>
                      <ZoneDistribution
                        rows={paceZones}
                        colors={colors}
                        isDark={isDark}
                        accent={isDark ? "#3B82F6" : "#2563EB"}
                      />
                      {paceZonesSummary ? (
                        <Text style={s.metricSummaryText}>{paceZonesSummary}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={s.centerText}>Not enough pace data to calculate zones.</Text>
                  )}
                </View>
              </AnalyticsGroup>

              <AnalyticsGroup title="Heart Rate" colors={colors} isDark={isDark}>
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Heart Rate</Text>
                  {hrLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={hrLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#EF4444" : "#DC2626"}
                    />
                  ) : (
                    <Text style={s.centerText}>No heart-rate stream available for this activity.</Text>
                  )}
                  <View style={s.metricInlineRow}>
                    <MetricInline
                      label="Avg Heart Rate"
                      value={avgHrValue ? `${Math.round(avgHrValue)} bpm` : "-"}
                      colors={colors}
                    />
                    <MetricInline
                      label="Max Heart Rate"
                      value={maxHrValue ? `${Math.round(maxHrValue)} bpm` : "-"}
                      colors={colors}
                    />
                    <MetricInline
                      label="Min Heart Rate"
                      value={
                        hrLinePoints.length > 0
                          ? `${Math.round(
                              Math.min(...hrLinePoints.map((p) => Number(p.y || 0)))
                            )} bpm`
                          : "-"
                      }
                      colors={colors}
                    />
                  </View>
                </View>

                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Heart Rate Zones</Text>
                  {hrZones.length > 0 ? (
                    <>
                      <ZoneDistribution
                        rows={hrZones}
                        colors={colors}
                        isDark={isDark}
                        accent={isDark ? "#EF4444" : "#DC2626"}
                      />
                      {hrZonesSummary ? (
                        <Text style={s.metricSummaryText}>{hrZonesSummary}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={s.centerText}>Not enough heart-rate data to calculate zones.</Text>
                  )}
                </View>
              </AnalyticsGroup>

              {(powerLinePoints.length > 1 ||
                avgPowerValue != null ||
                maxPowerValue != null ||
                cadenceLinePoints.length > 1 ||
                avgCadenceValue != null) ? (
                <AnalyticsGroup title="Efficiency" colors={colors} isDark={isDark}>
                  {(powerLinePoints.length > 1 || avgPowerValue != null || maxPowerValue != null) ? (
                    <View
                      style={
                        cadenceLinePoints.length > 1 || avgCadenceValue != null
                          ? s.analyticsItem
                          : s.analyticsItemLast
                      }
                    >
                      <Text style={s.sectionTitle}>Power</Text>
                      {powerLinePoints.length > 1 ? (
                        <LineProfileChart
                          data={powerLinePoints}
                          colors={colors}
                          isDark={isDark}
                          accent={isDark ? "#A855F7" : "#9333EA"}
                        />
                      ) : (
                        <Text style={s.centerText}>No power stream available for this activity.</Text>
                      )}
                      <View style={s.metricInlineRow}>
                        <MetricInline
                          label="Avg Power"
                          value={avgPowerValue != null ? `${Math.round(avgPowerValue)} W` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Max Power"
                          value={maxPowerValue != null ? `${Math.round(maxPowerValue)} W` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Total Work"
                          value={
                            activity?.kilojoules != null
                              ? `${Math.round(activity.kilojoules).toLocaleString()} kJ`
                              : "-"
                          }
                          colors={colors}
                        />
                      </View>
                      <View style={s.metricInlineRow}>
                        <MetricInline
                          label="Weighted Avg"
                          value={
                            activity?.weighted_average_watts != null
                              ? `${Math.round(activity.weighted_average_watts)} W`
                              : "-"
                          }
                          colors={colors}
                        />
                        <MetricInline
                          label="Training Load"
                          value={
                            activity?.suffer_score != null
                              ? `${Math.round(activity.suffer_score)}`
                              : "-"
                          }
                          colors={colors}
                        />
                        <MetricInline
                          label="Intensity"
                          value={
                            avgHrValue && maxHrValue
                              ? `${Math.round((avgHrValue / maxHrValue) * 100)}`
                              : "-"
                          }
                          colors={colors}
                        />
                      </View>
                    </View>
                  ) : null}

                  {(cadenceLinePoints.length > 1 || avgCadenceValue != null) ? (
                    <View style={s.analyticsItemLast}>
                      <Text style={s.sectionTitle}>Cadence</Text>
                      {cadenceLinePoints.length > 1 ? (
                        <LineProfileChart
                          data={cadenceLinePoints}
                          colors={colors}
                          isDark={isDark}
                          accent={isDark ? "#EC4899" : "#DB2777"}
                        />
                      ) : (
                        <Text style={s.centerText}>No cadence stream available for this activity.</Text>
                      )}
                      <View style={s.metricInlineRow}>
                        <MetricInline
                          label="Avg Cadence"
                          value={avgCadenceValue != null ? `${Math.round(avgCadenceValue)} spm` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Max Cadence"
                          value={maxCadenceValue != null ? `${Math.round(maxCadenceValue)} spm` : "-"}
                          colors={colors}
                        />
                        <MetricInline
                          label="Cadence Type"
                          value={cadenceFactor === 2 ? "Doubled to spm" : "Native spm"}
                          colors={colors}
                        />
                      </View>
                    </View>
                  ) : null}
                </AnalyticsGroup>
              ) : null}

              <AnalyticsGroup title="Terrain" colors={colors} isDark={isDark}>
                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Elevation</Text>
                  {elevationLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={elevationLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#22D3EE" : "#0284C7"}
                    />
                  ) : (
                    <Text style={s.centerText}>No elevation stream available for this activity.</Text>
                  )}
                  <View style={s.metricInlineRow}>
                    <MetricInline
                      label="Elevation Gain"
                      value={
                        activity?.total_elevation_gain != null
                          ? `${Math.round(activity.total_elevation_gain)} m`
                          : "-"
                      }
                      colors={colors}
                    />
                    <MetricInline
                      label="Net Change"
                      value={formatSignedMeters(elevationNetChange)}
                      colors={colors}
                    />
                    <MetricInline
                      label="Max Height"
                      value={maxAltValue != null ? `${Math.round(maxAltValue)} m` : "-"}
                      colors={colors}
                    />
                  </View>
                  <View style={s.metricInlineRowSingle}>
                    <MetricInline
                      label="Min Height"
                      value={minAltValue != null ? `${Math.round(minAltValue)} m` : "-"}
                      colors={colors}
                    />
                  </View>
                  {elevationLinePoints.length > 1 ? (
                    <Text style={s.metricSummaryText}>
                      Elevation changed by {formatSignedMeters(elevationNetChange)} overall, with a high point
                      of {maxAltValue != null ? ` ${Math.round(maxAltValue)}m` : " -"} and low point of{" "}
                      {minAltValue != null ? `${Math.round(minAltValue)}m` : "-"}.
                    </Text>
                  ) : null}
                </View>
              </AnalyticsGroup>

              <View style={s.sectionBlock}>
                <Text style={s.sectionTitle}>Splits</Text>
                {lapsLoading ? (
                  <View style={{ paddingVertical: 8 }}>
                    <ActivityIndicator />
                    <Text style={s.centerText}>Loading splits…</Text>
                  </View>
                ) : splitRows.length > 0 ? (
                  <SplitTable
                    rows={splitRows}
                    colors={colors}
                    formatPace={formatPace}
                  />
                ) : (
                  <Text style={s.centerText}>No split/lap data available for this activity.</Text>
                )}
              </View>

              <View style={s.sectionBlock}>
                <Text style={s.sectionTitle}>Laps</Text>
                {lapsLoading ? (
                  <View style={{ paddingVertical: 8 }}>
                    <ActivityIndicator />
                    <Text style={s.centerText}>Loading laps…</Text>
                  </View>
                ) : classifiedLapRows.length > 0 ? (
                  <LapTable
                    rows={classifiedLapRows}
                    colors={colors}
                    formatPace={formatPace}
                  />
                ) : (
                  <Text style={s.centerText}>No lap data available for this activity.</Text>
                )}

                <View style={s.lapsAiPanel}>
                  <View style={s.lapsAiHeader}>
                    <Text style={s.lapsAiTitle}>AI Laps Review</Text>
                    <TouchableOpacity
                      style={s.chipBtn}
                      onPress={onRunLapsReview}
                      disabled={lapsReviewLoading || classifiedLapRows.length === 0}
                      activeOpacity={0.85}
                    >
                      {lapsReviewLoading ? (
                        <ActivityIndicator size="small" color={accentText} />
                      ) : (
                        <>
                          <Feather
                            name="zap"
                            size={14}
                            color={accentText}
                            style={{ marginRight: 4 }}
                          />
                          <Text style={s.chipBtnText}>Review Laps</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  {lapsReviewError ? (
                    <Text style={s.errorText}>{lapsReviewError}</Text>
                  ) : null}

                  {lapsReview ? (
                    <Text style={s.description}>{lapsReview}</Text>
                  ) : !lapsReviewLoading ? (
                    <Text style={s.centerText}>
                      Runs AI feedback from your notes + lap data to assess average set pace and execution quality.
                    </Text>
                  ) : null}

                  <View style={s.lapsAutoMetrics}>
                    <Text style={s.lapsAutoTitle}>Auto Breakdown</Text>
                    <DetailRow
                      label="Avg lap speed"
                      value={
                        lapAutoMetrics.avgLapSpeedKmh != null
                          ? `${lapAutoMetrics.avgLapSpeedKmh.toFixed(1)} km/h`
                          : "-"
                      }
                      colors={colors}
                    />
                    <DetailRow
                      label="Avg lap pace"
                      value={formatPace(lapAutoMetrics.avgLapPaceSec)}
                      colors={colors}
                    />
                    <DetailRow
                      label="Avg interval pace"
                      value={formatPace(lapAutoMetrics.avgIntervalPaceSec)}
                      colors={colors}
                    />
                    <DetailRow
                      label="Avg rest"
                      value={
                        lapAutoMetrics.avgRestSec != null
                          ? formatDuration(Math.round(lapAutoMetrics.avgRestSec))
                          : "-"
                      }
                      colors={colors}
                    />
                    <DetailRow
                      label="Excluded warm-up / cool-down"
                      value={`${warmupRows.length} / ${cooldownRows.length}`}
                      colors={colors}
                    />
                    <DetailRow
                      label="Work / recovery laps"
                      value={`${lapAutoMetrics.workLapCount} / ${lapAutoMetrics.recoveryLapCount}`}
                      colors={colors}
                    />
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Extra details */}
          <View style={s.sectionBlock}>
            <Text style={s.sectionTitle}>Details</Text>
            <View style={s.detailGrid}>
              {isStrengthActivity ? (
                <>
                  <DetailStat
                    label="Elapsed"
                    value={formatDuration(elapsedTime)}
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Load"
                    value={
                      activity.kilojoules != null
                        ? `${Math.round(activity.kilojoules)} kJ`
                        : activity?.suffer_score != null
                        ? `${Math.round(activity.suffer_score)}`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Average HR"
                    value={
                      activity.average_heartrate != null
                        ? `${Math.round(activity.average_heartrate)} bpm`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Max HR"
                    value={
                      activity.max_heartrate != null
                        ? `${Math.round(activity.max_heartrate)} bpm`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Device"
                    value={deviceLabel || "-"}
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Type"
                    value={activityTypeLabel}
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Gear"
                    value={activity.gear?.name || "-"}
                    colors={colors}
                    isDark={isDark}
                    fullWidth
                  />
                </>
              ) : (
                <>
                  <DetailStat
                    label="Elapsed"
                    value={formatDuration(elapsedTime)}
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Calories"
                    value={
                      activity.kilojoules != null
                        ? `${Math.round(activity.kilojoules)} kJ`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Average HR"
                    value={
                      activity.average_heartrate != null
                        ? `${Math.round(activity.average_heartrate)} bpm`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Max HR"
                    value={
                      activity.max_heartrate != null
                        ? `${Math.round(activity.max_heartrate)} bpm`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Average speed"
                    value={
                      activity.average_speed != null
                        ? `${activity.average_speed.toFixed(2)} m/s`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Max speed"
                    value={
                      activity.max_speed != null
                        ? `${activity.max_speed.toFixed(2)} m/s`
                        : "-"
                    }
                    colors={colors}
                    isDark={isDark}
                  />
                  <DetailStat
                    label="Gear"
                    value={activity.gear?.name || "-"}
                    colors={colors}
                    isDark={isDark}
                    fullWidth
                  />
                </>
              )}
            </View>
          </View>

          {/* Description if exists */}
          {activity.description ? (
            <View style={s.sectionBlock}>
              <Text style={s.sectionTitle}>Notes</Text>
              <Text style={s.description}>{activity.description}</Text>
            </View>
          ) : null}

          {/* AI analysis */}
          <View style={s.sectionBlock}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <Text style={s.sectionTitle}>AI analysis</Text>
              <TouchableOpacity
                style={s.chipBtn}
                onPress={onRunAnalysis}
                disabled={analysisLoading}
                activeOpacity={0.85}
              >
                {analysisLoading ? (
                  <ActivityIndicator size="small" color={accentText} />
                ) : (
                  <>
                    <Feather
                      name="zap"
                      size={14}
                      color={accentText}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={s.chipBtnText}>Analyse</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {analysisError ? (
              <Text style={s.errorText}>{analysisError}</Text>
            ) : null}

            {analysis ? (
              <Text style={s.description}>{analysis}</Text>
            ) : !analysisLoading && !analysisError ? (
              <Text style={s.centerText}>
                {isStrengthActivity
                  ? "Tap Analyse to get a breakdown of this strength session and overall load."
                  : "Tap Analyse to get a breakdown of this session, pacing and training suggestions."}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}

      <Modal
        visible={planPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!linkingPlan) setPlanPickerOpen(false);
        }}
      >
        <View style={s.modalBackdrop}>
          <View style={s.planPickerSheet}>
            <View style={s.planPickerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.planPickerTitle}>Link to planned session</Text>
                <Text style={s.planPickerSubtitle}>
                  Choose the programmed session this activity should complete.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (!linkingPlan) setPlanPickerOpen(false);
                }}
                activeOpacity={0.85}
                style={s.planPickerClose}
              >
                <Feather name="x" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ marginTop: 12 }} showsVerticalScrollIndicator={false}>
              {planOptions.length ? (
                planOptions.map((option) => {
                  const optionTitle =
                    option.session?.title ||
                    option.session?.name ||
                    option.title ||
                    "Planned session";

                  return (
                    <TouchableOpacity
                      key={option.sessionKey}
                      activeOpacity={0.85}
                      disabled={linkingPlan}
                      onPress={() => handleLinkPlanSession(option)}
                      style={s.planOptionCard}
                    >
                      <View style={s.planOptionTopRow}>
                        <Text style={s.planOptionTitle}>{optionTitle}</Text>
                        {option.status ? (
                          <View
                            style={[
                              s.planOptionStatusChip,
                              option.status === "completed"
                                ? s.linkPlanStatusChipDone
                                : s.linkPlanStatusChipSkipped,
                            ]}
                          >
                            <Text
                              style={[
                                s.linkPlanStatusText,
                                option.status === "completed"
                                  ? s.linkPlanStatusTextDone
                                  : s.linkPlanStatusTextSkipped,
                              ]}
                            >
                              {option.status === "completed" ? "Completed" : "Skipped"}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={s.planOptionMeta}>
                        {[option.planName, option.weekLabel, option.dayLabel]
                          .filter(Boolean)
                          .join(" • ")}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={s.centerText}>No matching planned sessions available.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---- local components ---- */

function LineProfileChart({ data, colors, isDark, accent }) {
  const width = 340;
  const height = 140;
  const padLeft = 10;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 16;
  const bg = isDark ? "#18191E" : colors.sapSilverLight || colors.muted;
  const border = isDark ? "rgba(255,255,255,0.10)" : colors.border;

  const safe = Array.isArray(data)
    ? data.filter(
        (p) => Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))
      )
    : [];

  if (safe.length < 2) return null;

  const minX = Math.min(...safe.map((p) => Number(p.x)));
  const maxXRaw = Math.max(...safe.map((p) => Number(p.x)));
  const maxX = maxXRaw > minX ? maxXRaw : minX + 1;

  const rawMinY = Math.min(...safe.map((p) => Number(p.y)));
  const rawMaxY = Math.max(...safe.map((p) => Number(p.y)));
  const yPad = Math.max((rawMaxY - rawMinY) * 0.08, 0.5);
  const minY = rawMinY - yPad;
  const maxY = rawMaxY + yPad;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xFor = (x) =>
    padLeft + ((Number(x) - minX) / (maxX - minX || 1)) * plotW;
  const yFor = (y) =>
    padTop + ((maxY - Number(y)) / (maxY - minY || 1)) * plotH;

  const path = safe
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.x).toFixed(2)} ${yFor(p.y).toFixed(2)}`)
    .join(" ");
  const areaPath =
    `${path} ` +
    `L ${xFor(safe[safe.length - 1].x).toFixed(2)} ${(height - padBottom).toFixed(2)} ` +
    `L ${xFor(safe[0].x).toFixed(2)} ${(height - padBottom).toFixed(2)} Z`;

  const avgY = safe.reduce((sum, p) => sum + Number(p.y), 0) / safe.length;
  const avgLineY = yFor(avgY);

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ borderRadius: 12, overflow: "hidden", backgroundColor: bg, borderWidth: StyleSheet.hairlineWidth, borderColor: border }}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <SvgLine x1={padLeft} y1={padTop + plotH * 0.25} x2={width - padRight} y2={padTop + plotH * 0.25} stroke={border} strokeWidth={1} opacity={0.45} />
          <SvgLine x1={padLeft} y1={padTop + plotH * 0.5} x2={width - padRight} y2={padTop + plotH * 0.5} stroke={border} strokeWidth={1} opacity={0.45} />
          <SvgLine x1={padLeft} y1={padTop + plotH * 0.75} x2={width - padRight} y2={padTop + plotH * 0.75} stroke={border} strokeWidth={1} opacity={0.45} />
          <SvgPath d={areaPath} fill={accent} opacity={0.28} />
          <SvgPath d={path} fill="none" stroke={accent} strokeWidth={2.5} />
          <SvgLine
            x1={padLeft}
            y1={avgLineY}
            x2={width - padRight}
            y2={avgLineY}
            stroke={isDark ? "rgba(255,255,255,0.55)" : "rgba(15,23,42,0.35)"}
            strokeDasharray="5 4"
            strokeWidth={1}
          />
        </Svg>
      </View>
      <View style={{ marginTop: 4, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 10, color: colors.subtext }}>0 km</Text>
        <Text style={{ fontSize: 10, color: colors.subtext }}>{`${Math.max(0, Math.round(maxX))} km`}</Text>
      </View>
    </View>
  );
}

function MetricInline({ label, value, colors }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 10, color: colors.subtext, fontWeight: "800" }}>
        {label}
      </Text>
      <Text
        style={{
          marginTop: 3,
          fontSize: 14,
          fontWeight: "900",
          color: colors.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function WorkoutAnalysisChart({ data, colors, isDark, accent }) {
  const bars = Array.isArray(data)
    ? data.filter((p) => Number.isFinite(Number(p?.y)) && Number(p.y) > 0)
    : [];
  if (bars.length < 2) return null;

  const max = Math.max(...bars.map((b) => Number(b.y)));
  const min = Math.min(...bars.map((b) => Number(b.y)));
  const avg = bars.reduce((sum, b) => sum + Number(b.y || 0), 0) / bars.length;

  const chartH = 122;
  const barW = 12;
  const gap = 3;
  const rowW = bars.length * (barW + gap);
  const scale = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || max === min) return chartH * 0.62;
    const normalized = (n - min) / (max - min);
    return 30 + normalized * (chartH - 40);
  };
  const avgHeight = scale(avg);

  return (
    <View style={{ marginTop: 6 }}>
      <View
        style={{
          height: chartH,
          borderRadius: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: isDark ? "rgba(255,255,255,0.12)" : colors.border,
          backgroundColor: isDark ? "#18191E" : colors.sapSilverLight || colors.muted,
          paddingHorizontal: 9,
          paddingVertical: 9,
          justifyContent: "flex-end",
          overflow: "hidden",
        }}
      >
        <View
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10 + avgHeight - 1,
            borderTopWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.35)",
            borderStyle: "dashed",
          }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              width: rowW,
              gap,
            }}
          >
            {bars.map((bar, idx) => (
              <View
                key={`wa-bar-${idx}`}
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

function ZoneDistribution({ rows, colors, isDark, accent }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return (
      <View style={{ marginTop: 4, gap: 8 }}>
      {rows.map((row) => {
        const pct = Math.max(0, Math.min(100, Number(row.percentage || 0)));
        return (
          <View key={`zone-${row.label}`} style={{ flexDirection: "row", alignItems: "center" }}>
            <Text
              style={{
                width: 30,
                fontSize: 12,
                fontWeight: "900",
                color: colors.text,
              }}
            >
              {row.label}
            </Text>
            <View
              style={{
                flex: 1,
                height: 12,
                borderRadius: 6,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  borderRadius: 6,
                  backgroundColor: accent,
                }}
              />
            </View>
            <Text
              style={{
                width: 42,
                marginLeft: 8,
                fontSize: 12,
                fontWeight: "900",
                color: colors.text,
                textAlign: "right",
              }}
            >
              {pct}%
            </Text>
            <Text
              style={{
                width: 74,
                marginLeft: 8,
                fontSize: 11,
                color: colors.subtext,
                textAlign: "right",
              }}
            >
              {row.range}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SplitTable({ rows, colors, formatPace }) {
  const paces = rows
    .map((r) => Number(r.paceSec || 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const fastest = paces.length ? Math.min(...paces) : null;
  const slowest = paces.length ? Math.max(...paces) : null;

  const widthPctForPace = (paceSec) => {
    if (!Number.isFinite(paceSec) || !Number.isFinite(fastest) || !Number.isFinite(slowest)) {
      return 45;
    }
    if (slowest === fastest) return 70;
    const normalized = (slowest - paceSec) / (slowest - fastest); // fast -> high
    return 35 + normalized * 60;
  };

  const headerText = {
    fontSize: 11,
    color: colors.subtext,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };
  const cell = {
    fontSize: 12,
    color: colors.text,
    fontWeight: "700",
  };

  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Text style={[headerText, { width: 28 }]}>Km</Text>
        <Text style={[headerText, { width: 56 }]}>Pace</Text>
        <Text style={[headerText, { flex: 1 }]}> </Text>
        <Text style={[headerText, { width: 42, textAlign: "right" }]}>Elev</Text>
        <Text style={[headerText, { width: 36, textAlign: "right" }]}>HR</Text>
      </View>

      {rows.map((row) => {
        const barWidth = `${widthPctForPace(row.paceSec)}%`;
        const elevVal = Number.isFinite(row.elevDiff) ? row.elevDiff : row.elevGain;
        const elevText = Number.isFinite(elevVal)
          ? `${elevVal > 0 ? "+" : ""}${Math.round(elevVal)}`
          : "-";
        return (
          <View
            key={`split-${row.index}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 6,
            }}
          >
            <Text style={[cell, { width: 28 }]}>{row.index}</Text>
            <Text style={[cell, { width: 56 }]}>{formatPace(row.paceSec).replace("/km", "")}</Text>
            <View
              style={{
                flex: 1,
                height: 12,
                borderRadius: 7,
                backgroundColor: "rgba(59,130,246,0.18)",
                overflow: "hidden",
                marginRight: 8,
              }}
            >
              <View
                style={{
                  width: barWidth,
                  height: "100%",
                  backgroundColor: "#3B82F6",
                  borderRadius: 7,
                }}
              />
            </View>
            <Text style={[cell, { width: 42, textAlign: "right" }]}>{elevText}</Text>
            <Text style={[cell, { width: 36, textAlign: "right" }]}>
              {row.hr ? Math.round(row.hr) : "-"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function LapTable({ rows, colors, formatPace }) {
  const paces = rows
    .map((r) => Number(r.paceSec || 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const fastest = paces.length ? Math.min(...paces) : null;
  const slowest = paces.length ? Math.max(...paces) : null;

  const widthPctForPace = (paceSec) => {
    if (!Number.isFinite(paceSec) || !Number.isFinite(fastest) || !Number.isFinite(slowest)) {
      return 45;
    }
    if (slowest === fastest) return 70;
    const normalized = (slowest - paceSec) / (slowest - fastest);
    return 35 + normalized * 60;
  };

  const headerText = {
    fontSize: 11,
    color: colors.subtext,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };
  const cell = {
    fontSize: 12,
    color: colors.text,
    fontWeight: "700",
  };

  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Text style={[headerText, { width: 32 }]}>Lap</Text>
        <Text style={[headerText, { width: 50 }]}>Dist</Text>
        <Text style={[headerText, { width: 52 }]}>Pace</Text>
        <Text style={[headerText, { flex: 1 }]}> </Text>
        <Text style={[headerText, { width: 42, textAlign: "right" }]}>Elev</Text>
        <Text style={[headerText, { width: 36, textAlign: "right" }]}>HR</Text>
      </View>

      {rows.map((row) => {
        const barWidth = `${widthPctForPace(row.paceSec)}%`;
        const elevVal = Number.isFinite(row.elevDiff) ? row.elevDiff : row.elevGain;
        const elevText = Number.isFinite(elevVal)
          ? `${elevVal > 0 ? "+" : ""}${Math.round(elevVal)}`
          : "-";
        const isExcluded = row.role === "warmup" || row.role === "cooldown";
        return (
          <View
            key={`lap-${row.index}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 6,
              opacity: isExcluded ? 0.55 : 1,
            }}
          >
            <Text style={[cell, { width: 32 }]}>{row.index}</Text>
            <Text style={[cell, { width: 50 }]}>{`${row.distanceKm.toFixed(2)}`}</Text>
            <Text style={[cell, { width: 52 }]}>{formatPace(row.paceSec).replace("/km", "")}</Text>
            <View
              style={{
                flex: 1,
                height: 12,
                borderRadius: 7,
                backgroundColor: "rgba(59,130,246,0.18)",
                overflow: "hidden",
                marginRight: 8,
              }}
            >
              <View
                style={{
                  width: barWidth,
                  height: "100%",
                  backgroundColor: "#3B82F6",
                  borderRadius: 7,
                }}
              />
            </View>
            <Text style={[cell, { width: 42, textAlign: "right" }]}>{elevText}</Text>
            <Text style={[cell, { width: 36, textAlign: "right" }]}>
              {row.hr ? Math.round(row.hr) : "-"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function StatBlock({ label, value, icon, colors, isDark }) {
  const cardBg = isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: cardBg,
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 10,
        borderWidth: 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name={icon} size={14} color={colors.text} />
        <Text
          style={{
            fontSize: 11,
            color: colors.subtext,
            fontWeight: "700",
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          marginTop: 6,
          fontSize: 16,
          fontWeight: "900",
          color: colors.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function AnalyticsGroup({ title, children, colors, isDark }) {
  return (
    <View
      style={{
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: isDark ? "rgba(255,255,255,0.04)" : colors.sapSilverLight || colors.card,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "900",
          color: colors.subtext,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function DetailRow({ label, value, colors }) {
  return (
    <View
      style={{
        flexDirection: "row",
        paddingVertical: 6,
        justifyContent: "space-between",
      }}
    >
      <Text
        style={{
          fontSize: 13,
          color: colors.subtext,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: colors.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function DetailStat({ label, value, colors, isDark, fullWidth = false }) {
  return (
    <View
      style={{
        width: fullWidth ? "100%" : "48.5%",
        backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card,
        borderRadius: 14,
        paddingHorizontal: 11,
        paddingVertical: 10,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: "800",
          color: colors.subtext,
          textTransform: "uppercase",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          marginTop: 5,
          fontSize: 14,
          fontWeight: "900",
          color: colors.text,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/* ---- styles ---- */

function makeStyles(colors, isDark, accentFill, accentText) {
  const cardBg = isDark ? "#12141A" : colors.sapSilverLight || colors.card;
  const panelBg = isDark ? "#0E1015" : "#FFFFFF";
  const borderSoft =
    isDark ? "rgba(255,255,255,0.12)" : colors.sapSilverMedium || colors.border;

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg || (isDark ? "#050506" : "#F5F5F7"),
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 18,
      paddingTop: Platform.OS === "android" ? 12 : 6,
      paddingBottom: 8,
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    headerTitle: {
      flex: 1,
      textAlign: "center",
      fontSize: 17,
      fontWeight: "900",
      color: colors.text,
      marginHorizontal: 8,
    },
    content: {
      paddingHorizontal: 18,
      paddingBottom: 64,
      gap: 8,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    centerText: {
      marginTop: 8,
      fontSize: 13,
      color: colors.subtext,
    },
    errorText: {
      textAlign: "center",
      fontSize: 13,
      color: "#EF4444",
    },
    card: {
      backgroundColor: cardBg,
      borderRadius: 18,
      padding: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: isDark ? 0.2 : 0.05,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        },
        android: { elevation: isDark ? 0 : 2 },
      }),
    },
    heroBlock: {
      paddingTop: 2,
      paddingBottom: 0,
    },
    sectionBlock: {
      paddingTop: 0,
      paddingBottom: 0,
    },
    mapCard: {
      backgroundColor: cardBg,
      borderRadius: 18,
      overflow: "hidden",
      height: 204,
      borderWidth: 0,
    },
    map: {
      flex: 1,
    },
    activityTitle: {
      fontSize: 18,
      fontWeight: "900",
      color: colors.text,
      marginTop: 5,
    },
    activityType: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: "700",
      color: colors.subtext,
    },
    statsGrid: {
      marginTop: 1,
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: 8,
    },
    statCell: {
      width: "48.5%",
    },
    analyticsItem: {
      paddingBottom: 10,
      marginBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderSoft,
    },
    analyticsItemLast: {
      paddingBottom: 0,
      marginBottom: 0,
    },
    metricInlineRow: {
      marginTop: 8,
      flexDirection: "row",
      gap: 8,
    },
    metricInlineRowSingle: {
      marginTop: 4,
      flexDirection: "row",
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
      marginBottom: 3,
      letterSpacing: 0.2,
    },
    description: {
      fontSize: 12,
      color: colors.text,
      marginTop: 3,
      lineHeight: 17,
    },
    metricSummaryText: {
      marginTop: 8,
      fontSize: 11,
      lineHeight: 17,
      color: colors.subtext,
    },
    chipBtn: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: accentFill,
      borderWidth: 0,
    },
    chipBtnText: {
      fontSize: 12,
      fontWeight: "900",
      color: accentText,
    },
    lapsAiPanel: {
      marginTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: borderSoft,
      paddingTop: 8,
    },
    lapsAiHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 2,
    },
    lapsAiTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
      letterSpacing: 0.2,
    },
    lapsAutoMetrics: {
      marginTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: borderSoft,
      paddingTop: 7,
    },
    detailGrid: {
      marginTop: 2,
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: 8,
    },
    metaChipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card,
    },
    metaChipText: {
      fontSize: 10,
      fontWeight: "700",
      color: colors.subtext,
    },
    insightCard: {
      marginTop: 2,
      borderRadius: 18,
      padding: 12,
      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card,
    },
    insightHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    insightEyebrow: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.text,
      letterSpacing: 0.2,
    },
    insightText: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      color: colors.text,
    },
    insightFollowupText: {
      marginTop: 8,
      fontSize: 11,
      lineHeight: 17,
      color: colors.subtext,
    },
    linkPlanCard: {
      marginTop: 2,
      borderRadius: 18,
      padding: 14,
      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card,
    },
    linkPlanHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    linkPlanEyebrow: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtext,
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    linkPlanTitle: {
      marginTop: 10,
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "900",
      color: colors.text,
    },
    linkPlanMeta: {
      marginTop: 6,
      fontSize: 12,
      lineHeight: 17,
      color: colors.subtext,
    },
    linkPlanButton: {
      marginTop: 12,
      borderRadius: 14,
      backgroundColor: accentFill,
      minHeight: 44,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    linkPlanButtonDisabled: {
      opacity: 0.6,
    },
    linkPlanButtonText: {
      fontSize: 13,
      fontWeight: "900",
      color: accentText,
    },
    linkPlanStatusChip: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: StyleSheet.hairlineWidth,
    },
    linkPlanStatusChipDone: {
      backgroundColor: isDark ? "rgba(230,255,59,0.16)" : "rgba(184,215,0,0.14)",
      borderColor: isDark ? "rgba(230,255,59,0.35)" : "rgba(132,153,0,0.24)",
    },
    linkPlanStatusChipSkipped: {
      backgroundColor: "rgba(248,113,113,0.14)",
      borderColor: "rgba(248,113,113,0.28)",
    },
    linkPlanStatusText: {
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    linkPlanStatusTextDone: {
      color: isDark ? "#F4FF9A" : "#5B6500",
    },
    linkPlanStatusTextSkipped: {
      color: "#F87171",
    },
    lapsAutoTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
      marginBottom: 2,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.58)",
      justifyContent: "flex-end",
      padding: 16,
    },
    planPickerSheet: {
      maxHeight: "74%",
      borderRadius: 22,
      padding: 16,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    planPickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    planPickerTitle: {
      fontSize: 17,
      fontWeight: "900",
      color: colors.text,
    },
    planPickerSubtitle: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 17,
      color: colors.subtext,
    },
    planPickerClose: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    planOptionCard: {
      borderRadius: 16,
      paddingHorizontal: 13,
      paddingVertical: 12,
      marginBottom: 10,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    planOptionTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    planOptionTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
    },
    planOptionMeta: {
      marginTop: 5,
      fontSize: 12,
      lineHeight: 17,
      color: colors.subtext,
    },
    planOptionStatusChip: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: StyleSheet.hairlineWidth,
    },
    lapRow: {
      marginTop: 10,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      backgroundColor: panelBg,
      padding: 12,
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
    },
    lapIndexBadge: {
      width: 28,
      height: 28,
      borderRadius: 10,
      backgroundColor: accentFill,
      alignItems: "center",
      justifyContent: "center",
    },
    lapIndexText: {
      fontSize: 12,
      fontWeight: "900",
      color: accentText,
    },
    lapTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.text,
    },
    lapMeta: {
      marginTop: 3,
      fontSize: 12,
      color: colors.subtext,
      fontWeight: "700",
    },
    lapMetaSecondary: {
      marginTop: 2,
      fontSize: 12,
      color: colors.subtext,
    },
  });
}
