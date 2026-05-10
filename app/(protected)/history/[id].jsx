// app/(protected)/history/[id].jsx
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Image,
  Modal,
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
// ❌ REMOVE this line:
// import MapView, { Polyline } from "react-native-maps";

import { API_URL } from "../../../config/api";
import { auth, db, storage } from "../../../firebaseConfig";
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

function normaliseCoordinate(point) {
  if (!point) return null;

  if (Array.isArray(point) && point.length >= 2) {
    const latitude = Number(point[0]);
    const longitude = Number(point[1]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  if (typeof point === "object") {
    const latitude = Number(
      point.latitude ??
        point.lat ??
        point.latitudeInDegree ??
        point.latitudeInDegrees ??
        point.positionLat
    );
    const longitude = Number(
      point.longitude ??
        point.lng ??
        point.lon ??
        point.longitudeInDegree ??
        point.longitudeInDegrees ??
        point.positionLong ??
        point.positionLng
    );

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

function normaliseCoordinateArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normaliseCoordinate).filter(Boolean);
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

const STORED_ACTIVITY_SOURCES = new Set([
  "garmin_activities",
  "garminActivities",
  "stravaActivities",
  "garmin_workout_syncs",
]);

const EDIT_ACTIVITY_TYPES = [
  { value: "Run", label: "Run" },
  { value: "Treadmill", label: "Treadmill run" },
  { value: "WeightTraining", label: "Weight training" },
  { value: "Strength", label: "Strength" },
  { value: "Ride", label: "Ride" },
  { value: "Trainer", label: "Trainer" },
  { value: "Walk", label: "Walk" },
  { value: "Workout", label: "Workout" },
];

const EDIT_ACTIVITY_LABELS = [
  "Race",
  "Long run",
  "Tempo",
  "Recovery",
  "Speed",
  "Easy",
  "Intervals",
  "Strength",
  "Commute",
  "Test",
];

function finiteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasStatDisplayValue(value) {
  if (value == null) return false;
  const text = String(value).trim();
  return text.length > 0 && text !== "-" && text !== "—";
}

function formatCount(value, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n)}${suffix}`;
}

function formatWeightKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
}

function formatRestLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 60) return `${Math.round(n)} sec rest`;
  const mins = Math.floor(n / 60);
  const secs = Math.round(n % 60);
  if (!secs) return `${mins} min rest`;
  return `${mins}m ${secs}s rest`;
}

function formatRpeLabel(value, prefix = "RPE") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${prefix} ${Number.isInteger(n) ? n : n.toFixed(1)}`;
}

function readStepLabel(step) {
  return String(
    step?.label ||
      step?.title ||
      step?.name ||
      step?.type ||
      step?.kind ||
      step?.intensity ||
      "Step"
  ).trim();
}

function formatRunStep(step) {
  const repeat = Number(step?.repeat || step?.reps || 0);
  const label = readStepLabel(step);
  const distanceMeters = firstNumber(step?.distanceMeters, step?.distanceM, step?.meters);
  const distanceKm = firstNumber(step?.distanceKm, step?.km);
  const durationSec = firstNumber(step?.durationSec, step?.seconds, step?.timeSec);
  const durationMin = firstNumber(step?.durationMin, step?.minutes);
  const pace = String(step?.pace || step?.targetPace || step?.paceLabel || "").trim();
  const effort = String(step?.effort || step?.target || step?.zone || step?.rpe || "").trim();

  const bits = [
    repeat > 1 ? `${Math.round(repeat)}x` : null,
    label,
    distanceMeters ? `${Math.round(distanceMeters)} m` : distanceKm ? `${distanceKm} km` : null,
    durationSec ? `${Math.round(durationSec / 60)} min` : durationMin ? `${durationMin} min` : null,
    pace,
    effort,
  ].filter(Boolean);

  return bits.join(" · ");
}

function flattenRunSteps(steps, depth = 0) {
  if (!Array.isArray(steps) || depth > 3) return [];
  const out = [];
  steps.forEach((step) => {
    const nested = Array.isArray(step?.steps)
      ? step.steps
      : Array.isArray(step?.children)
      ? step.children
      : [];
    const current = formatRunStep(step);
    if (current) out.push(current);
    if (nested.length) {
      out.push(...flattenRunSteps(nested, depth + 1));
    }
  });
  return out;
}

function strengthBlocksToEntries(blocks) {
  const out = [];
  (Array.isArray(blocks) ? blocks : []).forEach((block, blockIdx) => {
    const blockTitle = String(block?.title || block?.name || `Block ${blockIdx + 1}`).trim();
    const items = firstArray(block?.items, block?.exercises, block?.movements);
    items.forEach((item, itemIdx) => {
      out.push({
        id: item?.id || `planned-${blockIdx}-${itemIdx}`,
        title: item?.title || item?.name || item?.exerciseName || `Exercise ${itemIdx + 1}`,
        blockTitle: blockTitle || "Main block",
        prescribed: {
          sets: firstNumber(item?.sets, item?.targetSets),
          reps: firstNumber(item?.reps, item?.targetReps),
          loadKg: firstNumber(item?.loadKg, item?.weightKg),
          restSec: firstNumber(item?.restSec, item?.restSeconds),
          rpe: firstNumber(item?.rpe, item?.targetRpe),
        },
        performed: {},
      });
    });
  });
  return out;
}

function normaliseExerciseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizePhotoUrls(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const raw = String(value || "").trim();
  return raw ? [raw] : [];
}

function storedActivityType(value) {
  const raw =
    typeof value === "object"
      ? value?.typeKey || value?.typeName || value?.name || value?.displayName
      : value;
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  if (lower.includes("run")) return "Run";
  if (lower.includes("ride") || lower.includes("bike") || lower.includes("cycling")) return "Ride";
  if (lower.includes("swim")) return "Swim";
  if (lower.includes("walk")) return "Walk";
  if (lower.includes("strength") || lower.includes("weight") || lower.includes("gym")) return "WeightTraining";
  return text || "Workout";
}

function isoFromStoredTime(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    if (typeof value?.toMillis === "function") {
      return new Date(value.toMillis()).toISOString();
    }
    if (value?.seconds != null) {
      return new Date(Number(value.seconds) * 1000).toISOString();
    }
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function pickStoredPolyline(data, raw) {
  return String(
    data?.summaryPolyline ||
      data?.polyline ||
      data?.map?.summary_polyline ||
      data?.map?.polyline ||
      raw?.summaryPolyline ||
      raw?.polyline ||
      raw?.map?.summary_polyline ||
      raw?.map?.polyline ||
      ""
  ).trim();
}

function pickStoredCoordinates(data, raw) {
  const candidates = [
    data?.routeCoordinates,
    data?.coordinates,
    data?.trackPoints,
    data?.samples,
    raw?.routeCoordinates,
    raw?.coordinates,
    raw?.trackPoints,
    raw?.samples,
    raw?.activitySamples,
  ];

  for (const candidate of candidates) {
    const points = normaliseCoordinateArray(candidate);
    if (points.length > 1) return points;
  }

  return [];
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function buildStoredStreamsAndLaps(activity) {
  const data = activity?.storedData || {};
  const raw = data?.rawGarminActivity || {};
  const samples = firstArray(
    data?.samples,
    data?.activitySamples,
    data?.samplePoints,
    data?.trackPoints,
    raw?.samples,
    raw?.activitySamples,
    raw?.samplePoints,
    raw?.trackPoints,
    raw?.activityDetail?.samples,
    raw?.activityDetails?.samples
  );
  const streamData = {
    distance: [],
    heartrate: [],
    altitude: [],
    velocity: [],
    watts: [],
    cadence: [],
    grade: [],
    time: [],
  };

  samples.forEach((sample, index) => {
    const distanceValue = firstNumber(
      sample?.distance,
      sample?.distanceInMeters,
      sample?.distanceMeters,
      sample?.totalDistanceInMeters,
      sample?.cumulativeDistanceInMeters,
      sample?.totalDistance
    );
    const timeValue = firstNumber(
      sample?.time,
      sample?.timerDurationInSeconds,
      sample?.elapsedDurationInSeconds,
      sample?.clockDurationInSeconds,
      sample?.durationInSeconds,
      sample?.offsetInSeconds,
      sample?.sampleTimeOffsetInSeconds,
      index
    );
    const hrValue = firstNumber(
      sample?.heartrate,
      sample?.heartRate,
      sample?.heartRateInBeatsPerMinute,
      sample?.heartRateBpm
    );
    const altitudeValue = firstNumber(
      sample?.altitude,
      sample?.altitudeInMeters,
      sample?.elevation,
      sample?.elevationInMeters,
      sample?.heightInMeters
    );
    const speedValue = firstNumber(
      sample?.velocity,
      sample?.velocity_smooth,
      sample?.speed,
      sample?.speedMetersPerSecond,
      sample?.speedInMetersPerSecond
    );
    const powerValue = firstNumber(sample?.watts, sample?.power, sample?.powerInWatts);
    const cadenceValue = firstNumber(
      sample?.cadence,
      sample?.runCadence,
      sample?.runCadenceInStepsPerMinute,
      sample?.runCadenceInSPM,
      sample?.bikeCadence,
      sample?.bikeCadenceInRPM
    );
    const gradeValue = firstNumber(sample?.grade, sample?.gradeSmooth, sample?.grade_smooth);

    if (distanceValue != null) streamData.distance.push(distanceValue);
    if (timeValue != null) streamData.time.push(timeValue);
    if (hrValue != null) streamData.heartrate.push(hrValue);
    if (altitudeValue != null) streamData.altitude.push(altitudeValue);
    if (speedValue != null) streamData.velocity.push(speedValue);
    if (powerValue != null) streamData.watts.push(powerValue);
    if (cadenceValue != null) streamData.cadence.push(cadenceValue);
    if (gradeValue != null) streamData.grade.push(gradeValue);
  });

  const garminLaps = firstArray(
    data?.laps,
    data?.splits,
    data?.splits_metric,
    raw?.laps,
    raw?.splits,
    raw?.activityLaps,
    raw?.activityDetail?.laps,
    raw?.activityDetails?.laps
  ).map((lap, index) => {
    const distance = firstNumber(
      lap?.distance,
      lap?.distanceInMeters,
      lap?.distanceMeters,
      lap?.totalDistanceInMeters
    );
    const moving = firstNumber(
      lap?.moving_time,
      lap?.movingTime,
      lap?.movingDurationInSeconds,
      lap?.durationInSeconds,
      lap?.elapsedDurationInSeconds
    );
    const elapsed = firstNumber(
      lap?.elapsed_time,
      lap?.elapsedTime,
      lap?.elapsedDurationInSeconds,
      lap?.durationInSeconds,
      moving
    );

    return {
      name: lap?.name || `Lap ${index + 1}`,
      distance: distance || 0,
      moving_time: moving || 0,
      elapsed_time: elapsed || moving || 0,
      elevation_difference:
        firstNumber(lap?.elevation_difference, lap?.elevationDifference, lap?.netElevationGainInMeters) || 0,
      total_elevation_gain:
        firstNumber(lap?.total_elevation_gain, lap?.elevationGain, lap?.elevationGainInMeters) || 0,
      average_heartrate:
        firstNumber(lap?.average_heartrate, lap?.averageHeartRate, lap?.averageHeartRateInBeatsPerMinute) || 0,
    };
  });

  const hasStreams = Object.values(streamData).some((arr) => arr.length > 1);
  return { streams: hasStreams ? streamData : null, laps: garminLaps };
}

function filterPaceChartPoints(points) {
  const safe = (Array.isArray(points) ? points : [])
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 2.25 &&
        point.y <= 12
    );

  if (safe.length < 8) return safe;

  const sorted = safe.map((point) => point.y).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = Math.max(2.25, median * 0.58);
  const max = Math.min(12, median * 1.7);
  return safe.filter((point) => point.y >= min && point.y <= max);
}

function filterHeartRateChartPoints(points) {
  const safe = (Array.isArray(points) ? points : [])
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 45 &&
        point.y <= 230
    );

  if (safe.length < 8) return safe;

  const sorted = safe.map((point) => point.y).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = Math.max(55, median * 0.78);
  const max = Math.min(230, median * 1.28);

  return safe.filter((point, index) => {
    if (point.y < min || point.y > max) return false;

    const prev = safe[index - 1]?.y;
    const next = safe[index + 1]?.y;
    if (
      Number.isFinite(prev) &&
      Number.isFinite(next) &&
      prev - point.y > 18 &&
      next - point.y > 18
    ) {
      return false;
    }

    return true;
  });
}

function buildStreamChartAxisPoints({ distanceValues, timeValues, valueValues, fallbackDurationSec }) {
  const values = Array.isArray(valueValues) ? valueValues : [];
  if (values.length < 2) return { points: [], unit: "km" };

  const distance = Array.isArray(distanceValues) ? distanceValues : [];
  const distancePoints = values
    .map((value, index) => ({
      x: Number(distance[index]) / 1000,
      y: Number(value),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const distanceXs = distancePoints.map((point) => point.x);
  const distanceRange = distanceXs.length > 1 ? Math.max(...distanceXs) - Math.min(...distanceXs) : 0;
  if (distancePoints.length > 1 && distanceRange >= 0.02) {
    return { points: distancePoints, unit: "km" };
  }

  const time = Array.isArray(timeValues) ? timeValues : [];
  const timePoints = values
    .map((value, index) => ({
      x: Number(time[index]) / 60,
      y: Number(value),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const timeXs = timePoints.map((point) => point.x);
  const timeRange = timeXs.length > 1 ? Math.max(...timeXs) - Math.min(...timeXs) : 0;
  if (timePoints.length > 1 && timeRange > 0) {
    return { points: timePoints, unit: "min" };
  }

  const durationSec = Number(fallbackDurationSec || 0);
  const durationMin = durationSec > 0 ? durationSec / 60 : Math.max(values.length - 1, 1);
  return {
    points: values.map((value, index) => ({
      x: values.length > 1 ? (index / (values.length - 1)) * durationMin : 0,
      y: Number(value),
    })),
    unit: durationSec > 0 ? "min" : "samples",
  };
}

function smoothChartPoints(points) {
  const safe = Array.isArray(points) ? points : [];
  if (safe.length < 7) return safe;

  return safe.map((point, index) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(safe.length, index + 3);
    const window = safe
      .slice(start, end)
      .map((item) => Number(item.y))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    if (!window.length) return point;
    return {
      ...point,
      y: window[Math.floor(window.length / 2)],
    };
  });
}

function compactObject(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    const arr = value.map(compactObject).filter((item) => item != null);
    return arr.length ? arr : null;
  }

  const next = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item == null || item === "") return;
    if (typeof item === "object") {
      if (typeof item?.toMillis === "function" || item?.seconds != null) return;
      const cleaned = compactObject(item);
      if (cleaned != null) next[key] = cleaned;
      return;
    }
    next[key] = item;
  });

  return Object.keys(next).length ? next : null;
}

function ageFromDob(dobISO) {
  const raw = String(dobISO || "").trim();
  if (!raw) return null;
  const d = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 10 && age <= 100 ? age : null;
}

function estimateMaxHrFromAge(age) {
  const value = Number(age);
  if (!Number.isFinite(value) || value < 10 || value > 100) return null;
  return Math.round(208 - 0.7 * value);
}

function mapStoredActivityToHistoryShape(docId, data, source) {
  const raw = data?.rawGarminActivity || data || {};
  const type = storedActivityType(data?.activityType || data?.type || data?.sport || raw?.activityType || raw?.sport);
  const start = isoFromStoredTime(
    data?.startTime,
    data?.startDate,
    data?.startedAt,
    data?.when,
    raw?.startTime,
    raw?.startTimeInSeconds ? Number(raw.startTimeInSeconds) * 1000 : null,
    data?.uploadedAtMs,
    data?.uploadedAt,
    data?.syncedAt,
    data?.createdAtMs
  );
  const distance = finiteNumber(
    data?.distanceMeters,
    data?.distanceInMeters,
    raw?.distanceInMeters,
    raw?.distanceMeters,
    data?.distance,
    data?.distanceKm ? Number(data.distanceKm) * 1000 : null
  );
  const movingTime = finiteNumber(
    data?.durationSeconds,
    data?.durationInSeconds,
    raw?.durationInSeconds,
    raw?.movingDurationInSeconds,
    raw?.elapsedDurationInSeconds,
    data?.moving_time,
    data?.movingTime,
    data?.movingTimeMin ? Number(data.movingTimeMin) * 60 : null
  );
  const elapsedTime = finiteNumber(
    data?.elapsedTime,
    data?.elapsed_time,
    data?.elapsedDurationInSeconds,
    raw?.elapsedDurationInSeconds,
    raw?.elapsedTimeInSeconds,
    movingTime
  );
  const avgHr = finiteNumber(
    data?.averageHeartRate,
    data?.averageHeartRateInBeatsPerMinute,
    data?.average_heartrate,
    raw?.averageHeartRateInBeatsPerMinute,
    raw?.averageHeartRate
  );
  const maxHr = finiteNumber(data?.maxHeartRate, data?.max_heartrate, raw?.maxHeartRateInBeatsPerMinute);
  const avgPower = finiteNumber(data?.average_watts, data?.averageWatts, raw?.averagePowerInWatts, raw?.averagePower);
  const maxPower = finiteNumber(data?.max_watts, data?.maxWatts, raw?.maxPowerInWatts, raw?.maxPower);
  const avgCadence = finiteNumber(
    data?.average_cadence,
    data?.averageCadence,
    raw?.averageRunCadenceInStepsPerMinute,
    raw?.averageBikeCadenceInRoundsPerMinute,
    raw?.averageCadence
  );
  const elevation = finiteNumber(data?.elevationGain, data?.total_elevation_gain, raw?.totalElevationGainInMeters);
  const speed = finiteNumber(data?.average_speed, data?.averageSpeed, raw?.averageSpeedInMetersPerSecond);
  const maxSpeed = finiteNumber(data?.max_speed, data?.maxSpeed, raw?.maxSpeedInMetersPerSecond);
  const summaryPolyline = pickStoredPolyline(data, raw);
  const routeCoordinates = pickStoredCoordinates(data, raw);

  return {
    id: data?.activityId || docId,
    name: data?.activityName || data?.name || raw?.activityName || raw?.name || type,
    type,
    sport_type: type,
    start_date: start,
    start_date_local: start,
    distance: distance || 0,
    moving_time: movingTime || 0,
    elapsed_time: elapsedTime || movingTime || 0,
    average_heartrate: avgHr || undefined,
    max_heartrate: maxHr || undefined,
    total_elevation_gain: elevation || undefined,
    average_watts: avgPower || undefined,
    max_watts: maxPower || undefined,
    average_cadence: avgCadence || undefined,
    average_speed: speed || undefined,
    max_speed: maxSpeed || undefined,
    kilojoules: finiteNumber(data?.kilojoules, raw?.kilojoules) || undefined,
    calories: finiteNumber(data?.calories, raw?.calories, raw?.activeKilocalories) || undefined,
    device_name: source?.startsWith("garmin") ? "Garmin" : data?.device_name,
    description: data?.description || data?.note || "",
    perceivedEffort: data?.perceivedEffort || data?.effortRating || data?.effort || "",
	    effortRatingNumeric: finiteNumber(data?.effortRatingNumeric, data?.effortScore, data?.rpe) || undefined,
	    activityLabel: data?.activityLabel || data?.label || data?.sessionLabel || "",
	    linkedTrainSessionId: data?.linkedTrainSessionId || raw?.linkedTrainSessionId || null,
	    linkedSessionKey: data?.linkedSessionKey || raw?.linkedSessionKey || null,
	    photoUrls: normalizePhotoUrls(data?.photoUrls || data?.photos || data?.imageUrl),
    map: summaryPolyline ? { summary_polyline: summaryPolyline } : undefined,
    routeCoordinates: routeCoordinates.length > 1 ? routeCoordinates : undefined,
    source,
    sourceDocId: docId,
    storedData: data,
  };
}

async function loadStoredActivity(uid, id, source) {
  const requestedSource = STORED_ACTIVITY_SOURCES.has(source) ? source : "garmin_activities";
  const sources =
    requestedSource === "garmin_activities"
      ? ["garmin_activities", "garminActivities"]
      : requestedSource === "garminActivities"
      ? ["garminActivities", "garmin_activities"]
      : [requestedSource];

  for (const collectionName of sources) {
    const snap = await getDoc(doc(db, "users", uid, collectionName, String(id)));
    if (snap.exists()) {
      return mapStoredActivityToHistoryShape(snap.id, snap.data() || {}, collectionName);
    }
  }

  return null;
}

export default function ActivityDetailPage() {
  const params = useLocalSearchParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const source = Array.isArray(params?.source) ? params.source[0] : params?.source;
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
  const [athleteProfile, setAthleteProfile] = useState(null);
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
  const [targetPlannedSession, setTargetPlannedSession] = useState(null);
  const [targetTrainSessionError, setTargetTrainSessionError] = useState("");
  const [linkingTrainSession, setLinkingTrainSession] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editType, setEditType] = useState("");
  const [editTypeOpen, setEditTypeOpen] = useState(false);
  const [editActivityLabel, setEditActivityLabel] = useState("");
  const [editEffort, setEditEffort] = useState("");
  const [editEffortScore, setEditEffortScore] = useState(5);
  const [editEffortBarWidth, setEditEffortBarWidth] = useState(0);
  const [editMediaUris, setEditMediaUris] = useState([]);
  const [editDeleting, setEditDeleting] = useState(false);
  const linkedActivityReferences = useMemo(() => {
    const refs = [
      activity?.id,
      activity?.sourceDocId,
      activity?.storedData?.activityId,
      activity?.storedData?.id,
      id,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return [...new Set(refs)];
  }, [
    activity?.id,
    activity?.sourceDocId,
    activity?.storedData?.activityId,
    activity?.storedData?.id,
    id,
  ]);
  const targetTrainSessionId = useMemo(() => {
    const raw = Array.isArray(params?.linkTrainSessionId)
      ? params.linkTrainSessionId[0]
      : params?.linkTrainSessionId;
    const value = String(
      raw ||
        activity?.linkedTrainSessionId ||
        activity?.storedData?.linkedTrainSessionId ||
        ""
    ).trim();
    return value || null;
  }, [activity?.linkedTrainSessionId, activity?.storedData?.linkedTrainSessionId, params?.linkTrainSessionId]);
  const targetPlanSessionKey = useMemo(() => {
    const raw = Array.isArray(params?.linkSessionKey)
      ? params.linkSessionKey[0]
      : params?.linkSessionKey;
    const value = String(raw || activity?.linkedSessionKey || activity?.storedData?.linkedSessionKey || "").trim();
    return value || null;
  }, [activity?.linkedSessionKey, activity?.storedData?.linkedSessionKey, params?.linkSessionKey]);
  const targetPlanSessionTitleParam = useMemo(() => {
    const raw = Array.isArray(params?.linkSessionTitle)
      ? params.linkSessionTitle[0]
      : params?.linkSessionTitle;
    const value = String(raw || "").trim();
    return value || null;
  }, [params?.linkSessionTitle]);
  const returnToMeActivity = useMemo(() => {
    const raw = Array.isArray(params?.from) ? params.from[0] : params?.from;
    return raw === "meActivity";
  }, [params?.from]);
  const returnToTrain = useMemo(() => {
    const raw = Array.isArray(params?.from) ? params.from[0] : params?.from;
    return raw === "train";
  }, [params?.from]);
  const returnScrollY = useMemo(() => {
    const raw = Array.isArray(params?.scrollY) ? params.scrollY[0] : params?.scrollY;
    const value = Number(raw || 0);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }, [params?.scrollY]);
  const returnTrainWeekIndex = useMemo(() => {
    const raw = Array.isArray(params?.returnWeekIndex)
      ? params.returnWeekIndex[0]
      : params?.returnWeekIndex;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }, [params?.returnWeekIndex]);
  const returnTrainDayIndex = useMemo(() => {
    const raw = Array.isArray(params?.returnDayIndex)
      ? params.returnDayIndex[0]
      : params?.returnDayIndex;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value < 7 ? Math.round(value) : null;
  }, [params?.returnDayIndex]);

  const handleBackPress = () => {
    if (returnToMeActivity) {
      router.replace({
        pathname: "/me",
        params: {
          tab: "activity",
          scrollY: String(returnScrollY),
        },
      });
      return;
    }
    if (returnToTrain) {
      router.replace({
        pathname: "/train",
        params: {
          ...(returnTrainWeekIndex != null
            ? { returnWeekIndex: String(returnTrainWeekIndex) }
            : {}),
          ...(returnTrainDayIndex != null
            ? { returnDayIndex: String(returnTrainDayIndex) }
            : {}),
          returnToken: String(Date.now()),
        },
      });
      return;
    }

    router.back();
  };

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

        if (source) {
          const uid = auth.currentUser?.uid;
          if (!uid) {
            setErr("Please sign in again.");
            return;
          }

          const stored = await loadStoredActivity(uid, String(id), String(source));
          if (!stored) {
            setErr("Activity not found.");
            return;
          }

          const storedDetail = buildStoredStreamsAndLaps(stored);
          if (storedDetail.streams) setStreams(storedDetail.streams);
          if (storedDetail.laps.length) setLaps(storedDetail.laps);
          setActivity(stored);
          return;
        }

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
  }, [id, source]);

  useEffect(() => {
    let cancelled = false;

    const loadAthleteProfile = async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setAthleteProfile(null);
        return;
      }

      try {
        const [userSnap, planPrefsSnap] = await Promise.all([
          getDoc(doc(db, "users", uid)),
          getDoc(doc(db, "users", uid, "planPrefs", "current")),
        ]);
        if (cancelled) return;

        const userData = userSnap.exists() ? userSnap.data() || {} : {};
        const planPrefs = planPrefsSnap.exists() ? planPrefsSnap.data() || {} : {};
        const profile = {
          ...(planPrefs || {}),
          ...(userData?.athleteProfile || {}),
          hr: {
            ...(planPrefs?.hr || {}),
            ...(userData?.athleteProfile?.hr || {}),
          },
        };
        setAthleteProfile(compactObject(profile));
      } catch (e) {
        console.log("Athlete profile load error", e);
        if (!cancelled) setAthleteProfile(null);
      }
    };

    loadAthleteProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  const s = useMemo(
    () => makeStyles(colors, isDark, accentFill, accentText),
    [colors, isDark, accentFill, accentText]
  );

  useEffect(() => {
    let cancelled = false;

    const loadTargetTrainSession = async () => {
      if (!targetTrainSessionId && !linkedActivityReferences.length) {
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
        let snap = null;

        if (targetTrainSessionId) {
          snap = await getDoc(
            doc(db, "users", uid, "trainSessions", String(targetTrainSessionId))
          );
        }

        if ((!snap || !snap.exists()) && linkedActivityReferences.length) {
          const sessionKey = String(activity?.linkedSessionKey || activity?.storedData?.linkedSessionKey || "").trim();
          if (sessionKey) {
            const logSnap = await getDoc(doc(db, "users", uid, "sessionLogs", sessionKey));
            const logData = logSnap.exists() ? logSnap.data() || {} : null;
            const lastTrainSessionId = String(logData?.lastTrainSessionId || "").trim();
            if (lastTrainSessionId) {
              snap = await getDoc(doc(db, "users", uid, "trainSessions", lastTrainSessionId));
            }
          }
        }

        if ((!snap || !snap.exists()) && linkedActivityReferences.length) {
          for (const refValue of linkedActivityReferences) {
            const sessionsSnap = await getDocs(
              query(
                collection(db, "users", uid, "trainSessions"),
                where("linkedActivity.reference", "==", refValue),
                limit(1)
              )
            );
            snap = sessionsSnap.docs[0] || null;
            if (snap?.exists()) break;
          }
        }

        if ((!snap || !snap.exists()) && linkedActivityReferences.length) {
          for (const refValue of linkedActivityReferences) {
            const logsSnap = await getDocs(
              query(
                collection(db, "users", uid, "sessionLogs"),
                where("linkedActivity.reference", "==", refValue),
                limit(1)
              )
            );
            const logData = logsSnap.docs[0]?.data() || null;
            const lastTrainSessionId = String(logData?.lastTrainSessionId || "").trim();
            if (lastTrainSessionId) {
              snap = await getDoc(doc(db, "users", uid, "trainSessions", lastTrainSessionId));
              if (snap.exists()) break;
            }
          }
        }

        if (cancelled) return;

        if (!snap || !snap.exists()) {
          setTargetTrainSession(null);
          setTargetTrainSessionError("");
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
  }, [activity?.linkedSessionKey, activity?.storedData?.linkedSessionKey, linkedActivityReferences, targetTrainSessionId]);

  useEffect(() => {
    let cancelled = false;

    const loadTargetPlannedSession = async () => {
      setTargetPlannedSession(null);
      const uid = auth.currentUser?.uid;
      const planId = String(targetTrainSession?.planId || "").trim();
      if (!uid || !planId) return;

      const weekIndex = Number(targetTrainSession?.weekIndex);
      const dayIndex = Number(targetTrainSession?.dayIndex);
      const sessionIndex = Number(targetTrainSession?.sessionIndex);
      if (
        !Number.isFinite(weekIndex) ||
        !Number.isFinite(dayIndex) ||
        !Number.isFinite(sessionIndex)
      ) {
        return;
      }

      try {
        const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
        if (cancelled || !planSnap.exists()) return;
        const planData = planSnap.data() || {};
        const weeks = Array.isArray(planData?.weeks)
          ? planData.weeks
          : Array.isArray(planData?.plan?.weeks)
          ? planData.plan.weeks
          : [];
        const session =
          weeks?.[weekIndex]?.days?.[dayIndex]?.sessions?.[sessionIndex] || null;
        setTargetPlannedSession(session || null);
      } catch (e) {
        console.log("Target planned session load error", e?.message || e);
      }
    };

    loadTargetPlannedSession();

    return () => {
      cancelled = true;
    };
  }, [
    targetTrainSession?.dayIndex,
    targetTrainSession?.planId,
    targetTrainSession?.sessionIndex,
    targetTrainSession?.weekIndex,
  ]);

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
  const activityTypeLabel = formatActivityTypeLabel(type, distance);
  const name = activity?.name || activityTypeLabel || "Workout";
  const nameLooksStrength = /\b(strength|weight|weights|gym|lower|lowers|upper|legs|push|pull)\b/i.test(
    String(name || type || "")
  );
  const isStrengthActivity = activityMode === "strength" || nameLooksStrength;
  const paceSecPerKm =
    distance && movingTime ? movingTime / (distance / 1000) : null;
  const analysisAthleteProfile = useMemo(() => {
    const profile = compactObject(athleteProfile);
    if (!profile) return null;
    const age = ageFromDob(profile?.dobISO || profile?.dob);
    const hasAgeEstimatedMax =
      profile?.maxHRSource === "age_estimate" || profile?.hr?.maxSource === "age_estimate";
    const manualMaxHR = hasAgeEstimatedMax ? null : firstNumber(profile?.hr?.max, profile?.maxHR);
    const estimatedMaxHR = firstNumber(
      profile?.hr?.estimatedMax,
      profile?.estimatedMaxHR,
      estimateMaxHrFromAge(age)
    );
    const maxHR = manualMaxHR || estimatedMaxHR;
    return compactObject({
      ...profile,
      age,
      estimatedMaxHR,
      maxHRSource: manualMaxHR ? "manual" : estimatedMaxHR ? "age_estimate" : profile?.maxHRSource,
      hr: {
        max: maxHR,
        estimatedMax: estimatedMaxHR,
        maxSource: manualMaxHR ? "manual" : estimatedMaxHR ? "age_estimate" : profile?.hr?.maxSource,
        resting: firstNumber(profile?.hr?.resting, profile?.restingHR),
        threshold: firstNumber(profile?.hr?.threshold, profile?.thresholdHR),
      },
    });
  }, [athleteProfile]);

  // Map coords from Strava summary polyline
  const coords = useMemo(() => {
    const poly =
      activity?.map?.summary_polyline ||
      activity?.map?.polyline ||
      activity?.summaryPolyline ||
      "";
    const decoded = decodePolyline(poly);
    if (decoded.length > 1) return decoded;

    const storedCoordinates = normaliseCoordinateArray(
      activity?.routeCoordinates ||
        activity?.coordinates ||
        activity?.storedData?.routeCoordinates ||
        activity?.storedData?.coordinates ||
        activity?.storedData?.trackPoints ||
        activity?.storedData?.samples ||
        activity?.storedData?.rawGarminActivity?.routeCoordinates ||
        activity?.storedData?.rawGarminActivity?.coordinates ||
        activity?.storedData?.rawGarminActivity?.trackPoints ||
        activity?.storedData?.rawGarminActivity?.samples ||
        []
    );

    return storedCoordinates.length > 1 ? storedCoordinates : [];
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
      const rawPoints = Array.from({ length: len }, (_, i) => {
        const v = Number(velocityArr[i] || 0);
        const minPerKm = v > 0 ? 1000 / v / 60 : null;
        return {
          x: Number(distanceArr[i] || 0) / 1000,
          y: Number.isFinite(minPerKm) ? minPerKm : null,
        };
      });
      return smoothChartPoints(filterPaceChartPoints(rawPoints));
    }

    let totalKm = 0;
    const splitPoints = splitRows
      .map((row) => {
        totalKm += row.distanceKm;
        return {
          x: totalKm,
          y: Number.isFinite(row.paceSec) ? row.paceSec / 60 : null,
        };
      });
    return filterPaceChartPoints(splitPoints);
  }, [streams.distance, streams.velocity, splitRows]);

  const hrChartData = useMemo(() => {
    const hrArr = streams.heartrate || [];

    if (hrArr.length > 1) {
      const axisData = buildStreamChartAxisPoints({
        distanceValues: streams.distance || [],
        timeValues: streams.time || [],
        valueValues: hrArr,
        fallbackDurationSec: movingTime || elapsedTime,
      });
      return {
        points: smoothChartPoints(filterHeartRateChartPoints(axisData.points)),
        unit: axisData.unit,
      };
    }

    let totalKm = 0;
    const splitPoints = splitRows
      .map((row) => {
        totalKm += row.distanceKm;
        return {
          x: totalKm,
          y: row.hr,
        };
      });
    return {
      points: filterHeartRateChartPoints(splitPoints),
      unit: "km",
    };
  }, [elapsedTime, movingTime, streams.distance, streams.heartrate, streams.time, splitRows]);
  const hrLinePoints = hrChartData.points;
  const hrChartUnit = hrChartData.unit;

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

  const profileMaxHrValue = useMemo(() => {
    const value = firstNumber(
      analysisAthleteProfile?.hr?.max,
      analysisAthleteProfile?.maxHR
    );
    return value && value >= 120 && value <= 230 ? value : null;
  }, [analysisAthleteProfile]);
  const profileMaxHrSource = useMemo(
    () =>
      analysisAthleteProfile?.hr?.maxSource ||
      analysisAthleteProfile?.maxHRSource ||
      "",
    [analysisAthleteProfile]
  );

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
      return smoothChartPoints(filterPaceChartPoints(points));
    }

    let totalKm = 0;
    const splitPoints = splitRows
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
      });
    return filterPaceChartPoints(splitPoints);
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
    const maxHr = profileMaxHrValue || Math.max(Number(maxHrValue || 0), 185);
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
  }, [hrLinePoints, maxHrValue, profileMaxHrValue]);

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

  const paceInsight = useMemo(() => {
    if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) return null;

    const elapsedPace =
      distance && elapsedTime ? Number(elapsedTime) / (Number(distance) / 1000) : null;
    if (elapsedPace && elapsedPace > paceSecPerKm * 1.12) {
      return {
        tone: "watch",
        title: "Watch pacing flow",
        text: "Elapsed pace is noticeably slower than moving pace, so stoppages or uneven flow may be costing overall session quality.",
      };
    }

    const samples = paceLinePoints
      .map((p) => Number(p?.y || 0) * 60)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (samples.length > 8) {
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const variance =
        samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
      const cv = Math.sqrt(variance) / mean;
      if (cv > 0.16) {
        return {
          tone: "watch",
          title: "Pace looks variable",
          text: "There are enough pace changes to suggest surging. Smoother effort would usually be more efficient unless this was intervals or hilly terrain.",
        };
      }
    }

    const topZone = paceZones.length
      ? [...paceZones].sort((a, b) => b.percentage - a.percentage)[0]
      : null;
    if (topZone?.label === "Z2" || topZone?.label === "Z3") {
      return {
        tone: "good",
        title: "Pace is on track",
        text: "Pace sat in a useful aerobic range, which is where most steady running should live.",
      };
    }

    return {
      tone: "good",
      title: "Pace is usable",
      text: "The pace data gives enough context to judge this session; compare it with HR and cadence to spot hidden inefficiency.",
    };
  }, [distance, elapsedTime, paceLinePoints, paceSecPerKm, paceZones]);

  const heartRateInsight = useMemo(() => {
    if (!avgHrValue) return null;
    const maxForZones = profileMaxHrValue || maxHrValue;
    const percentMax = maxForZones ? avgHrValue / maxForZones : null;
    const usingEstimatedMax = profileMaxHrSource === "age_estimate";
    const maxHrText = usingEstimatedMax ? "age-estimated max HR" : "max HR";

    if (percentMax && percentMax >= 0.88) {
      return {
        tone: "watch",
        title: "High cardiovascular load",
        text: `Average HR is close to your ${maxHrText}, so this should count as a hard day rather than easy volume.`,
      };
    }

    if (percentMax && percentMax >= 0.72 && percentMax <= 0.84) {
      return {
        tone: "good",
        title: "HR is in a productive range",
        text: `Heart rate sat in a productive range against your ${maxHrText}, giving fitness benefit without excessive strain.`,
      };
    }

    if (percentMax && percentMax >= 0.65 && percentMax < 0.72) {
      return {
        tone: "good",
        title: "Controlled aerobic effort",
        text: `Average HR was about ${Math.round(percentMax * 100)}% of your ${maxHrText}, which is useful easy-to-steady aerobic work.`,
      };
    }

    if (percentMax && percentMax < 0.65) {
      return {
        tone: "good",
        title: "Low stress session",
        text: `Heart rate stayed well controlled against your ${maxHrText}, which is useful for recovery, easy mileage, or maintaining consistency.`,
      };
    }

    return {
      tone: "neutral",
      title: maxForZones ? "HR context available" : "Add HR context",
      text: maxForZones
        ? "Heart-rate data is available, but adding resting HR and threshold HR will make the analysis more precise."
        : "Add DOB or max HR in your profile to make this section more precise.",
    };
  }, [avgHrValue, maxHrValue, profileMaxHrSource, profileMaxHrValue]);

  const powerInsight = useMemo(() => {
    if (!avgPowerValue) return null;
    if (maxPowerValue && maxPowerValue > avgPowerValue * 1.9) {
      return {
        tone: "watch",
        title: "Power is spiky",
        text: "Max power is much higher than average power, which can point to surges that waste energy unless this was a workout with efforts.",
      };
    }

    return {
      tone: "good",
      title: "Power looks controlled",
      text: "Average power is steady enough to support efficient output; use this with HR to judge whether the same pace is getting easier over time.",
    };
  }, [avgPowerValue, maxPowerValue]);

  const cadenceInsight = useMemo(() => {
    if (!avgCadenceValue) return null;
    if (normaliseActivityMode(type, distance) !== "run") {
      return {
        tone: "neutral",
        title: "Cadence recorded",
        text: "Cadence is available for this session; compare it with pace and HR to spot efficiency changes over time.",
      };
    }

    if (avgCadenceValue > 190) {
      return {
        tone: "watch",
        title: "Cadence may be too high",
        text: "Very high cadence can mean short, choppy steps. If pace is not improving, this may be wasting energy.",
      };
    }

    if (avgCadenceValue < 155) {
      return {
        tone: "watch",
        title: "Cadence may be low",
        text: "Low cadence can indicate overstriding or heavy ground contact, which may reduce efficiency and increase fatigue.",
      };
    }

    return {
      tone: "good",
      title: "Cadence is in range",
      text: "Cadence sits in a normal running range, so there is no obvious efficiency issue from step rate alone.",
    };
  }, [avgCadenceValue, distance, type]);

  const terrainInsight = useMemo(() => {
    const gain = Number(activity?.total_elevation_gain || 0);
    const distanceKm = Number(distance || 0) > 0 ? Number(distance) / 1000 : 0;
    if (!distanceKm || !gain) return null;
    const gainPerKm = gain / distanceKm;

    if (gainPerKm >= 18) {
      return {
        tone: "watch",
        title: "Terrain added load",
        text: "Elevation gain is high for the distance, so slower pace may be terrain cost rather than poor fitness.",
      };
    }

    return {
      tone: "good",
      title: "Terrain is not a major limiter",
      text: "Elevation load looks manageable, so pace and HR are likely a fair read of your effort.",
    };
  }, [activity?.total_elevation_gain, distance]);

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

    return orderedStats.filter((item) => hasStatDisplayValue(item.value)).slice(0, 6);
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

  const sessionBenefit = useMemo(() => {
    if (!activity) return "";
    const titleText = String(name || activityTypeLabel || "").toLowerCase();
    const durationText = movingTime
      ? (() => {
          const totalSeconds = Math.max(0, Math.round(Number(movingTime)));
          const h = Math.floor(totalSeconds / 3600);
          const m = Math.floor((totalSeconds % 3600) / 60);
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        })()
      : "";
    const hasHr = avgHrValue != null;
    const controlledHr = hasHr && Number(avgHrValue) < 145;
    const steadyHr = hasHr && Number(avgHrValue) >= 145 && Number(avgHrValue) < 160;
    const hardHr = hasHr && Number(avgHrValue) >= 160;
    const dominantHrZone = hrZones.length
      ? [...hrZones].sort((a, b) => b.percentage - a.percentage)[0]
      : null;

    if (isStrengthActivity) {
      const strengthFocus = titleText.includes("lower") || titleText.includes("leg")
        ? "lower-body strength"
        : titleText.includes("upper") || titleText.includes("push") || titleText.includes("pull")
        ? "upper-body strength"
        : "strength";
      const durationPrefix = durationText ? `This ${durationText} ${strengthFocus} session` : `This ${strengthFocus} session`;

      if (hasHr && Number(avgHrValue) >= 120) {
        return `Strength endurance benefit: ${durationPrefix} builds muscular endurance and adds a useful aerobic load without needing to be a maximal effort.`;
      }
      if (movingTime && movingTime >= 45 * 60) {
        return `Strength capacity benefit: ${durationPrefix} builds strength capacity and supports better fatigue resistance for future training.`;
      }
      return `Strength maintenance benefit: ${durationPrefix} supports strength maintenance, movement quality, and weekly training consistency.`;
    }

    const distanceKm = Number(distance || 0) > 0 ? Number(distance) / 1000 : 0;
    const pace = Number(paceSecPerKm || 0);
    const roundedDistance =
      distanceKm > 0 ? (distanceKm >= 10 ? distanceKm.toFixed(1) : distanceKm.toFixed(2)) : "";
    const sessionPrefix = roundedDistance
      ? `This ${roundedDistance} km ${activityTypeLabel.toLowerCase()}`
      : durationText
      ? `This ${durationText} ${activityTypeLabel.toLowerCase()}`
      : "This session";

    if (dominantHrZone?.label === "Z5" || (hardHr && distanceKm > 0)) {
      return `Anaerobic capacity benefit: ${sessionPrefix} targets high-intensity tolerance and improves your ability to handle harder surges.`;
    }
    if (dominantHrZone?.label === "Z4") {
      return `Threshold benefit: ${sessionPrefix} develops your ability to sustain hard controlled work without tipping too far into fatigue.`;
    }
    if (distanceKm >= 12) {
      return `Aerobic endurance benefit: ${sessionPrefix} builds endurance and improves your ability to hold form late in longer efforts.`;
    }
    if (hardHr || (pace > 0 && distanceKm >= 3 && distanceKm < 8 && !controlledHr)) {
      return `Aerobic power benefit: ${sessionPrefix} develops aerobic power and improves your ability to sustain faster running.`;
    }
    if (distanceKm > 0 && controlledHr) {
      return `Easy aerobic benefit: ${sessionPrefix} builds aerobic fitness with controlled effort and supports recovery between harder days.`;
    }
    if (distanceKm > 0 && steadyHr) {
      return `Steady aerobic benefit: ${sessionPrefix} gives steady aerobic work, adding useful fitness without turning the day into an all-out effort.`;
    }
    if (distanceKm > 0) {
      return `Aerobic volume benefit: ${sessionPrefix} adds useful aerobic volume and helps build consistency.`;
    }
    if (movingTime) {
      return `General conditioning benefit: ${sessionPrefix} adds training load and helps maintain momentum.`;
    }
    return "";
  }, [
    activity,
    activityTypeLabel,
    avgHrValue,
    distance,
    hrZones,
    isStrengthActivity,
    movingTime,
    name,
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
    return !!ref && linkedActivityReferences.includes(ref);
  }, [linkedActivityReferences, targetTrainSession?.linkedActivity?.reference]);

  const performedSessionSummary = useMemo(() => {
    if (!activity) return null;

    const plannedSession =
      targetPlannedSession ||
      targetTrainSession ||
      linkedPlanSession?.session ||
      targetPlanSessionOption?.session ||
      null;
    const title = String(
      targetTrainSession?.title ||
        linkedPlanSession?.session?.title ||
        linkedPlanSession?.session?.name ||
        targetPlanSessionOption?.session?.title ||
        targetPlanSessionOption?.session?.name ||
        name ||
        activityTypeLabel ||
        "Session"
    ).trim();

    if (isStrengthActivity) {
      const loggedEntries = firstArray(
        targetTrainSession?.strengthLog?.entries,
        activity?.storedData?.strengthLog?.entries,
        activity?.storedData?.exercises,
        activity?.storedData?.exerciseSets,
        activity?.storedData?.rawGarminActivity?.exercises,
        activity?.storedData?.rawGarminActivity?.strengthExercises,
        activity?.storedData?.rawGarminActivity?.activityDetail?.exercises
      );
      const plannedEntries = [
        ...strengthBlocksToEntries(targetPlannedSession?.blocks),
        ...strengthBlocksToEntries(targetTrainSession?.blocks),
        ...strengthBlocksToEntries(plannedSession?.blocks),
      ];
      const loggedByKey = new Map();
      loggedEntries.forEach((entry) => {
        const key = normaliseExerciseKey(entry?.exerciseKey || entry?.title || entry?.name || entry?.exerciseName || entry?.id);
        if (key) loggedByKey.set(key, entry);
      });
      const plannedByKey = new Map();
      plannedEntries.forEach((entry) => {
        const key = normaliseExerciseKey(entry?.exerciseKey || entry?.title || entry?.name || entry?.exerciseName || entry?.id);
        if (key && !plannedByKey.has(key)) plannedByKey.set(key, entry);
      });
      const mergedEntries = [];
      loggedEntries.forEach((entry) => {
        const key = normaliseExerciseKey(entry?.exerciseKey || entry?.title || entry?.name || entry?.exerciseName || entry?.id);
        const planned = key ? plannedByKey.get(key) : null;
        mergedEntries.push({
          ...(planned || {}),
          ...entry,
          prescribed: {
            ...((planned || {})?.prescribed || {}),
            ...(entry?.prescribed || {}),
          },
          performed: {
            ...(entry?.performed || {}),
          },
        });
      });
      plannedEntries.forEach((entry) => {
        const key = normaliseExerciseKey(entry?.exerciseKey || entry?.title || entry?.name || entry?.exerciseName || entry?.id);
        if (!key || !loggedByKey.has(key)) mergedEntries.push(entry);
      });
      const entries = mergedEntries;
      const sections = [];
      const byTitle = new Map();
      let hasLoggedWeights = false;

      entries.forEach((entry, entryIdx) => {
        const blockTitle = String(entry?.blockTitle || entry?.group || "Main block").trim() || "Main block";
        const key = blockTitle.toLowerCase();
        let section = byTitle.get(key);
        if (!section) {
          section = { title: blockTitle, items: [] };
          byTitle.set(key, section);
          sections.push(section);
        }

        const performed = entry?.performed || entry || {};
        const prescribed = entry?.prescribed || entry || {};
        const rawSetLogs = firstArray(
          performed?.setLogs,
          performed?.sets,
          performed?.setsLog,
          entry?.setLogs,
          entry?.setsLog,
          entry?.sets,
          entry?.loggedSets,
          entry?.completedSets
        );
        const setLogs = rawSetLogs
          .map((setRow, setIdx) => ({
            set: setRow?.set || setIdx + 1,
            loadKg: firstNumber(
              setRow?.loadKg,
              setRow?.weightKg,
              setRow?.weight,
              setRow?.weight_kg,
              setRow?.load
            ),
            reps: firstNumber(setRow?.reps, setRow?.repCount, setRow?.repetitions),
            completed: !!setRow?.completed || !!setRow?.done,
          }))
          .filter((setRow) => setRow.loadKg != null || setRow.reps != null || setRow.completed);

        const prescribedBits = [
          prescribed?.sets && prescribed?.reps
            ? `${prescribed.sets} x ${prescribed.reps}`
            : prescribed?.sets
            ? `${prescribed.sets} sets`
            : prescribed?.reps
            ? `${prescribed.reps} reps`
            : null,
          formatWeightKg(prescribed?.loadKg),
          formatRestLabel(prescribed?.restSec),
          formatRpeLabel(prescribed?.rpe, "Target RPE"),
        ].filter(Boolean);

        const entryHasLoggedWeights =
          setLogs.some((setRow) => setRow.loadKg != null || setRow.reps != null) ||
          firstNumber(performed?.loadKg, performed?.weightKg, performed?.weight, performed?.reps, performed?.repCount) != null;
        if (entryHasLoggedWeights) hasLoggedWeights = true;

        section.items.push({
          id: entry?.id || `strength-entry-${entryIdx}`,
          title: String(entry?.title || entry?.name || entry?.exerciseName || `Exercise ${entryIdx + 1}`).trim(),
          prescribed: prescribedBits.join(" · "),
          setLogs,
          hasLoggedWeights: entryHasLoggedWeights,
          performedBits: [
            performed?.completedSets ? `${performed.completedSets} completed sets` : null,
            performed?.sets ? `${performed.sets} tracked sets` : null,
            formatCount(firstNumber(performed?.reps, performed?.repCount), " reps"),
            formatWeightKg(firstNumber(performed?.loadKg, performed?.weightKg, performed?.weight)),
            formatRpeLabel(performed?.actualRpe, "Actual RPE"),
          ].filter(Boolean),
        });
      });

      return {
        mode: "strength",
        title,
        fillSessionKey: String(targetTrainSession?.sessionKey || targetPlanSessionKey || activity?.linkedSessionKey || activity?.storedData?.linkedSessionKey || "").trim(),
        hasLoggedWeights,
        subtitle: targetTrainSession?.strengthLog?.entries?.length
          ? "Logged exercises, sets, reps, and weights from the linked training session."
          : targetPlannedSession?.blocks?.length
          ? "Planned exercises from the training plan. Logged weights appear here when they were recorded in the session."
          : "Exercise detail appears when Garmin or your in-app workout log records sets, reps, and load.",
        sections,
      };
    }

    const stepSource = firstArray(
      plannedSession?.segments,
      plannedSession?.steps,
      plannedSession?.workout?.steps
    );
    const stepLines = flattenRunSteps(stepSource).slice(0, 8);
    const distanceLabel = Number(distance) > 0 ? `${(Number(distance) / 1000).toFixed(2)} km` : null;
    const durationLabel =
      Number(movingTime) > 0
        ? (() => {
            const totalSeconds = Math.max(0, Math.round(Number(movingTime)));
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
          })()
        : null;
    const paceLabel =
      paceSecPerKm && Number.isFinite(Number(paceSecPerKm))
        ? `${Math.floor(Number(paceSecPerKm) / 60)}:${Math.round(Number(paceSecPerKm) % 60)
            .toString()
            .padStart(2, "0")}/km`
        : null;
    const actualLine = [
      distanceLabel,
      durationLabel,
      paceLabel,
      avgHrValue != null ? `${Math.round(avgHrValue)} bpm avg HR` : null,
    ].filter(Boolean).join(" · ");

    return {
      mode: "run",
      title,
      subtitle: targetTrainSession || linkedPlanSession
        ? "Planned structure with the recorded activity result."
        : "Recorded run details from the activity.",
      lines: [actualLine, ...stepLines].filter(Boolean),
    };
  }, [
    activity,
    activityTypeLabel,
    avgHrValue,
    distance,
    isStrengthActivity,
    linkedPlanSession,
    movingTime,
    name,
    paceSecPerKm,
    targetPlanSessionOption,
    targetPlanSessionKey,
    targetPlannedSession,
    targetTrainSession,
  ]);

  const isStoredActivity = Boolean(activity?.source);
  const canEditStoredActivity = Boolean(isStoredActivity && activity?.sourceDocId && activity?.source);
  const hasPaceAnalytics =
    workoutBars.length > 1 ||
    paceLinePoints.length > 1 ||
    gapLinePoints.length > 1 ||
    paceZones.length > 0 ||
    (Number.isFinite(Number(paceSecPerKm)) && Number(paceSecPerKm) > 0);
  const hasHeartAnalytics =
    hrLinePoints.length > 1 ||
    hrZones.length > 0 ||
    avgHrValue != null ||
    maxHrValue != null;
  const hasTerrainAnalytics =
    elevationLinePoints.length > 1 ||
    activity?.total_elevation_gain != null ||
    maxAltValue != null ||
    minAltValue != null;

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

  const openEditActivity = () => {
    if (!canEditStoredActivity) {
      Alert.alert("Edit activity", "Only activities saved in Train-r can be edited here.");
      return;
    }

    setEditName(activity?.name || "");
    setEditNotes(activity?.description || "");
    setEditType(activity?.type || "Workout");
    setEditTypeOpen(false);
    setEditActivityLabel(activity?.activityLabel || "");
    setEditEffort(String(activity?.perceivedEffort || ""));
    setEditEffortScore(
      Math.min(
        10,
        Math.max(1, Math.round(Number(activity?.effortRatingNumeric || activity?.storedData?.effortRatingNumeric || 5)))
      )
    );
    setEditMediaUris(normalizePhotoUrls(activity?.photoUrls || activity?.storedData?.photoUrls));
    setEditOpen(true);
  };

  const pickEditMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Media", "Allow photo access to add media to this activity.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.84,
    });

    if (!result.canceled && Array.isArray(result.assets)) {
      const nextUris = result.assets.map((asset) => asset?.uri).filter(Boolean);
      setEditMediaUris((current) =>
        [...nextUris, ...current].filter((uri, index, arr) => arr.indexOf(uri) === index).slice(0, 6)
      );
    }
  };

  const removeEditMedia = (uri) => {
    setEditMediaUris((current) => current.filter((item) => item !== uri));
  };

  const applyEditEffortScore = (score) => {
    const nextScore = Math.min(10, Math.max(1, Math.round(Number(score || 1))));
    setEditEffortScore(nextScore);
    setEditEffort(
      nextScore <= 3
        ? "Easy"
        : nextScore <= 5
        ? "Steady"
        : nextScore <= 7
        ? "Moderate"
        : nextScore <= 9
        ? "Hard"
        : "Max effort"
    );
  };

  const updateEditEffortFromTouch = (event) => {
    const width = Number(editEffortBarWidth || 0);
    if (!width) return;
    const x = Math.min(width, Math.max(0, Number(event?.nativeEvent?.locationX || 0)));
    applyEditEffortScore(Math.ceil((x / width) * 10));
  };

  const uploadEditMediaIfNeeded = async (uid, source, sourceDocId) => {
    const uploaded = [];

    for (const uri of editMediaUris) {
      if (!uri) continue;
      if (/^https?:\/\//i.test(String(uri))) {
        uploaded.push(uri);
        continue;
      }

      const response = await fetch(uri);
      const blob = await response.blob();
      const mediaRef = ref(
        storage,
        `activity_photos/${uid}/${source}_${sourceDocId}_${Date.now()}_${uploaded.length}.jpg`
      );
      await uploadBytes(mediaRef, blob, { contentType: "image/jpeg" });
      uploaded.push(await getDownloadURL(mediaRef));
    }

    return uploaded;
  };

  const saveActivityEdits = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Edit activity", "Please sign in again.");
        return;
      }
      if (!activity?.source || !activity?.sourceDocId) {
        Alert.alert("Edit activity", "This activity cannot be edited here.");
        return;
      }

      setEditSaving(true);

      const nextName = editName.trim() || activity.name || "Activity";
      const nextNotes = editNotes.trim();
      const nextType = editType.trim() || activity.type || "Workout";
      const nextLabel = editActivityLabel.trim();
      const nextEffortScore = Math.min(10, Math.max(1, Math.round(Number(editEffortScore || 5))));
      const nextEffort = editEffort.trim() || `${nextEffortScore}/10`;
      const nextPhotoUrls = await uploadEditMediaIfNeeded(
        uid,
        activity.source,
        String(activity.sourceDocId)
      );
      const activityRef = doc(db, "users", uid, activity.source, String(activity.sourceDocId));

      await updateDoc(activityRef, {
        name: nextName,
        title: nextName,
        activityName: nextName,
        description: nextNotes,
        note: nextNotes,
        type: nextType,
        activityType: nextType,
        sport: nextType,
        activityLabel: nextLabel,
        label: nextLabel,
        perceivedEffort: nextEffort,
        effortRating: nextEffort,
        effortRatingNumeric: nextEffortScore,
        rpe: nextEffortScore,
        photoUrls: nextPhotoUrls,
        customizedAt: serverTimestamp(),
        customizedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      });

      setActivity((prev) =>
        prev
          ? {
              ...prev,
              name: nextName,
              type: nextType,
              sport_type: nextType,
              description: nextNotes,
              activityLabel: nextLabel,
              perceivedEffort: nextEffort,
              effortRatingNumeric: nextEffortScore,
              photoUrls: nextPhotoUrls,
              storedData: {
                ...(prev.storedData || {}),
                name: nextName,
                activityName: nextName,
                type: nextType,
                activityType: nextType,
                description: nextNotes,
                note: nextNotes,
                activityLabel: nextLabel,
                label: nextLabel,
                perceivedEffort: nextEffort,
                effortRating: nextEffort,
                effortRatingNumeric: nextEffortScore,
                rpe: nextEffortScore,
                photoUrls: nextPhotoUrls,
              },
            }
          : prev
      );
      setEditOpen(false);
    } catch (e) {
      console.error("Activity edit save error", e);
      Alert.alert("Edit activity", e?.message || "Could not save this activity.");
    } finally {
      setEditSaving(false);
    }
  };

  const deleteActivity = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert("Delete activity", "Please sign in again.");
        return;
      }
      if (!activity?.source || !activity?.sourceDocId) {
        Alert.alert("Delete activity", "This activity cannot be deleted here.");
        return;
      }

      setEditDeleting(true);
      await deleteDoc(doc(db, "users", uid, activity.source, String(activity.sourceDocId)));
      setEditOpen(false);
      router.replace({
        pathname: "/me",
        params: {
          tab: "activity",
          scrollY: String(returnScrollY),
        },
      });
    } catch (e) {
      console.error("Activity delete error", e);
      Alert.alert("Delete activity", e?.message || "Could not delete this activity.");
    } finally {
      setEditDeleting(false);
    }
  };

  const confirmDeleteActivity = () => {
    Alert.alert(
      "Delete activity?",
      "This removes it from your Activity Log. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: deleteActivity,
        },
      ]
    );
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
          notes: activity.description || activity.perceivedEffort || "",
          device_name: deviceLabel || activity.device_name || null,
          athleteProfile: analysisAthleteProfile,
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
          device_name: deviceLabel || activity.device_name || null,
          athleteProfile: analysisAthleteProfile,
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
        <View style={s.headerSide}>
          <TouchableOpacity
            onPress={handleBackPress}
            style={s.backBtn}
            activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Text style={s.headerTitle} numberOfLines={1}>
          Activity
        </Text>
        <View style={[s.headerSide, s.headerActions]}>
          <TouchableOpacity
            onPress={() => setInfoOpen(true)}
            style={s.backBtn}
            activeOpacity={0.8}
          >
            <Feather name="info" size={17} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openEditActivity}
            style={[s.backBtn, !canEditStoredActivity && s.headerBtnDisabled]}
            activeOpacity={0.8}
            disabled={!canEditStoredActivity}
          >
            <Feather name="edit-3" size={17} color={colors.text} />
          </TouchableOpacity>
        </View>
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
              {!!activity.activityLabel ? (
                <View style={s.metaChip}>
                  <Feather name="tag" size={13} color={colors.subtext} />
                  <Text style={s.metaChipText}>{activity.activityLabel}</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.activityTitle}>{name}</Text>
            <Text style={s.activityType}>
              {activityTypeLabel} • {formatDateTime(activity.start_date)}
            </Text>
          </View>

          {activity.photoUrls?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.activityMediaStrip}>
              {activity.photoUrls.map((uri) => (
                <Image key={uri} source={{ uri }} style={s.activityMediaImage} />
              ))}
            </ScrollView>
          ) : null}

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

          {sessionBenefit ? (
            <View style={s.benefitCard}>
              <View style={s.benefitIcon}>
                <Feather name="zap" size={15} color={accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.benefitEyebrow}>Session benefit</Text>
                <Text style={s.benefitText}>{sessionBenefit}</Text>
              </View>
            </View>
          ) : null}

          {performedSessionSummary ? (
            <View style={s.performedCard}>
              <View style={s.performedHeader}>
                <View style={s.performedIcon}>
                  <Feather
                    name={performedSessionSummary.mode === "strength" ? "list" : "route"}
                    size={15}
                    color={accentText}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.performedEyebrow}>Completed session</Text>
                  <Text style={s.performedTitle}>{performedSessionSummary.title}</Text>
                  <Text style={s.performedSubtitle}>{performedSessionSummary.subtitle}</Text>
                </View>
              </View>

              {performedSessionSummary.mode === "strength" ? (
                <>
                {performedSessionSummary.sections.length ? (
                  <View style={s.performedStack}>
                    {performedSessionSummary.sections.map((section, sectionIdx) => (
                      <View key={`${section.title}-${sectionIdx}`} style={s.performedSection}>
                        <Text style={s.performedSectionTitle}>{section.title}</Text>
                        {section.items.map((entry, entryIdx) => (
                          <View key={`${entry.id}-${entryIdx}`} style={s.performedExercise}>
                            <Text style={s.performedExerciseTitle}>{entry.title}</Text>
                            {entry.prescribed ? (
                              <Text style={s.performedExerciseMeta}>{entry.prescribed}</Text>
                            ) : null}
                            {entry.performedBits.length ? (
                              <Text style={s.performedExerciseMeta}>{entry.performedBits.join(" · ")}</Text>
                            ) : null}
                            {entry.setLogs.length ? (
                              <View style={s.performedSetStack}>
                                {entry.setLogs.slice(0, 6).map((setRow, setIdx) => {
                                  const setParts = [
                                    formatWeightKg(setRow.loadKg),
                                    formatCount(setRow.reps, " reps"),
                                  ].filter(Boolean);
                                  return (
                                    <View key={`${entry.id}-set-${setIdx}`} style={s.performedSetRow}>
                                      <Text style={s.performedSetIndex}>Set {setRow.set || setIdx + 1}</Text>
                                      <Text style={s.performedSetValue}>
                                        {setParts.join(" · ") || (setRow.completed ? "Completed" : "Logged")}
                                      </Text>
                                    </View>
                                  );
                                })}
                                {entry.setLogs.length > 6 ? (
                                  <Text style={s.performedExerciseMeta}>
                                    +{entry.setLogs.length - 6} more sets
                                  </Text>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={s.performedEmptyText}>
                    No exercise-level sets, reps, or weights have been filled out yet.
                  </Text>
                )}
                {!performedSessionSummary.hasLoggedWeights && performedSessionSummary.fillSessionKey ? (
                  <TouchableOpacity
                    style={s.performedActionButton}
                    activeOpacity={0.88}
                    onPress={() => {
                      router.push(
                        `/train/session/${encodeURIComponent(performedSessionSummary.fillSessionKey)}/log-strength`
                      );
                    }}
                  >
                    <Feather name="edit-3" size={15} color={accentText} />
                    <Text style={s.performedActionText}>Fill weights</Text>
                  </TouchableOpacity>
                ) : null}
                </>
              ) : performedSessionSummary.lines.length ? (
                <View style={s.performedStack}>
                  {performedSessionSummary.lines.map((line, idx) => (
                    <View key={`run-session-line-${idx}`} style={s.performedRunLine}>
                      <Text style={s.performedRunIndex}>{idx === 0 ? "Result" : `Step ${idx}`}</Text>
                      <Text style={s.performedRunText}>{line}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={s.performedEmptyText}>
                  No structured run steps were recorded for this activity.
                </Text>
              )}
            </View>
          ) : null}

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

          {targetTrainSessionId && !targetTrainSession && targetTrainSessionError ? (
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

          {targetPlanSessionKey && !targetTrainSession && !isLinkedToTargetPlanSession ? (
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

          {!targetPlanSessionKey && !isStoredActivity ? (
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
                        xUnit={hrChartUnit}
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
                  <SectionInsight insight={heartRateInsight} colors={colors} styles={s} />
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
                      <SectionInsight insight={powerInsight} colors={colors} styles={s} />
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
                      <SectionInsight insight={cadenceInsight} colors={colors} styles={s} />
                    </View>
                  ) : null}
                </AnalyticsGroup>
              ) : null}
            </>
          ) : (
            <>
              {hasPaceAnalytics ? (
              <AnalyticsGroup title="Pace" colors={colors} isDark={isDark}>
                {workoutBars.length > 1 ? (
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Workout Analysis</Text>
                  <WorkoutAnalysisChart
                    data={workoutBars}
                    colors={colors}
                    isDark={isDark}
                    accent={isDark ? "#60A5FA" : "#2563EB"}
                  />
                </View>
                ) : null}

                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Pace</Text>
                  {paceLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={paceLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#3B82F6" : "#2563EB"}
                    />
                  ) : null}
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
                  <SectionInsight insight={paceInsight} colors={colors} styles={s} />
                </View>

                {gapLinePoints.length > 1 || avgGapPaceSec ? (
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Grade Adjusted Pace</Text>
                  {gapLinePoints.length > 1 ? (
                    <LineProfileChart
                      data={gapLinePoints}
                      colors={colors}
                      isDark={isDark}
                      accent={isDark ? "#60A5FA" : "#3B82F6"}
                    />
                  ) : null}
                  <View style={s.metricInlineRowSingle}>
                    <MetricInline
                      label="Avg GAP"
                      value={formatPace(avgGapPaceSec)}
                      colors={colors}
                    />
                  </View>
                </View>
                ) : null}

                {paceZones.length > 0 ? (
                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Pace Zones</Text>
                  <ZoneDistribution
                    rows={paceZones}
                    colors={colors}
                    isDark={isDark}
                    accent={isDark ? "#3B82F6" : "#2563EB"}
                  />
                  {paceZonesSummary ? (
                    <Text style={s.metricSummaryText}>{paceZonesSummary}</Text>
                  ) : null}
                </View>
                ) : null}
              </AnalyticsGroup>
              ) : null}

              {hasHeartAnalytics ? (
              <AnalyticsGroup title="Heart Rate" colors={colors} isDark={isDark}>
                <View style={s.analyticsItem}>
                  <Text style={s.sectionTitle}>Heart Rate</Text>
                  {hrLinePoints.length > 1 ? (
                      <LineProfileChart
                        data={hrLinePoints}
                        colors={colors}
                        isDark={isDark}
                        accent={isDark ? "#EF4444" : "#DC2626"}
                        xUnit={hrChartUnit}
                      />
                  ) : null}
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
                  <SectionInsight insight={heartRateInsight} colors={colors} styles={s} />
                </View>

                {hrZones.length > 0 ? (
                <View style={s.analyticsItemLast}>
                  <Text style={s.sectionTitle}>Heart Rate Zones</Text>
                  <ZoneDistribution
                    rows={hrZones}
                    colors={colors}
                    isDark={isDark}
                    accent={isDark ? "#EF4444" : "#DC2626"}
                  />
                  {hrZonesSummary ? (
                    <Text style={s.metricSummaryText}>{hrZonesSummary}</Text>
                  ) : null}
                </View>
                ) : null}
              </AnalyticsGroup>
              ) : null}

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
                            avgHrValue && (profileMaxHrValue || maxHrValue)
                              ? `${Math.round((avgHrValue / (profileMaxHrValue || maxHrValue)) * 100)}`
                              : "-"
                          }
                          colors={colors}
                        />
                      </View>
                      <SectionInsight insight={powerInsight} colors={colors} styles={s} />
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
                      <SectionInsight insight={cadenceInsight} colors={colors} styles={s} />
                    </View>
                  ) : null}
                </AnalyticsGroup>
              ) : null}

              {hasTerrainAnalytics ? (
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
                  ) : null}
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
                  <SectionInsight insight={terrainInsight} colors={colors} styles={s} />
                  {elevationLinePoints.length > 1 ? (
                    <Text style={s.metricSummaryText}>
                      Elevation changed by {formatSignedMeters(elevationNetChange)} overall, with a high point
                      of {maxAltValue != null ? ` ${Math.round(maxAltValue)}m` : " -"} and low point of{" "}
                      {minAltValue != null ? `${Math.round(minAltValue)}m` : "-"}.
                    </Text>
                  ) : null}
                </View>
              </AnalyticsGroup>
              ) : null}

              {lapsLoading || splitRows.length > 0 ? (
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
                ) : null}
              </View>
              ) : null}

              {lapsLoading || classifiedLapRows.length > 0 ? (
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
                ) : null}

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
              ) : null}
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
                  {activity.perceivedEffort ? (
                    <DetailStat
                      label="Effort"
                      value={activity.perceivedEffort}
                      colors={colors}
                      isDark={isDark}
                    />
                  ) : null}
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
                  {activity.perceivedEffort ? (
                    <DetailStat
                      label="Effort"
                      value={activity.perceivedEffort}
                      colors={colors}
                      isDark={isDark}
                      fullWidth
                    />
                  ) : null}
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
	        visible={infoOpen}
	        transparent
	        animationType="fade"
	        onRequestClose={() => setInfoOpen(false)}
	      >
	        <View style={s.modalBackdrop}>
	          <View style={s.infoSheet}>
	            <View style={s.planPickerHeader}>
	              <View style={{ flex: 1 }}>
	                <Text style={s.planPickerTitle}>Activity info</Text>
	                <Text style={s.planPickerSubtitle}>
	                  {name}{activityTypeLabel ? ` · ${activityTypeLabel}` : ""}
	                </Text>
	              </View>
	              <TouchableOpacity
	                onPress={() => setInfoOpen(false)}
	                activeOpacity={0.85}
	                style={s.planPickerClose}
	              >
	                <Feather name="x" size={18} color={colors.text} />
	              </TouchableOpacity>
	            </View>

	            <ScrollView
	              style={{ marginTop: 12 }}
	              showsVerticalScrollIndicator={false}
	              contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
	            >
	              <View style={s.infoPanel}>
	                <View style={s.infoPanelIcon}>
	                  <Feather name="zap" size={15} color={accentText} />
	                </View>
	                <View style={{ flex: 1 }}>
	                  <Text style={s.infoPanelLabel}>Session benefit</Text>
	                  <Text style={s.infoPanelText}>
	                    {sessionBenefit || "This activity adds useful training context for your coach."}
	                  </Text>
	                </View>
	              </View>

	              <View style={s.infoMetricGrid}>
	                <DetailStat label="Source" value={deviceLabel || activity?.source || "Activity"} colors={colors} isDark={isDark} />
	                <DetailStat label="Type" value={activityTypeLabel || "Workout"} colors={colors} isDark={isDark} />
	                <DetailStat label="Duration" value={formatDuration(movingTime)} colors={colors} isDark={isDark} />
	                <DetailStat label="Avg HR" value={avgHrValue != null ? `${Math.round(avgHrValue)} bpm` : "-"} colors={colors} isDark={isDark} />
	              </View>

	              {quickInsight ? (
	                <View style={s.infoPanelMuted}>
	                  <Text style={s.infoPanelLabel}>Quick read</Text>
	                  <Text style={s.infoPanelText}>{quickInsight}</Text>
	                </View>
	              ) : null}

	              {targetTrainSession || linkedPlanSession ? (
	                <View style={s.infoPanelMuted}>
	                  <Text style={s.infoPanelLabel}>Linked training</Text>
	                  <Text style={s.infoPanelText}>
	                    {targetTrainSession?.title ||
	                      linkedPlanSession?.title ||
	                      linkedPlanSession?.session?.title ||
	                      "Linked planned session"}
	                  </Text>
	                </View>
	              ) : null}
	            </ScrollView>
	          </View>
	        </View>
	      </Modal>

	      <Modal
	        visible={editOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!editSaving && !editDeleting) setEditOpen(false);
        }}
      >
        <SafeAreaView style={s.editPage}>
          <View style={s.editPageHeader}>
            <TouchableOpacity
              onPress={() => {
                if (!editSaving && !editDeleting) setEditOpen(false);
              }}
              activeOpacity={0.85}
              style={s.planPickerClose}
            >
              <Feather name="x" size={18} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={s.editPageTitle}>Edit activity</Text>
              <Text style={s.editPageSubtitle} numberOfLines={1}>
                Name, media, type, label and effort
              </Text>
            </View>
            <TouchableOpacity
              style={[s.editHeaderSave, editSaving && s.linkPlanButtonDisabled]}
              onPress={saveActivityEdits}
              activeOpacity={0.88}
              disabled={editSaving || editDeleting}
            >
              {editSaving ? (
                <ActivityIndicator size="small" color={accentText} />
              ) : (
                <Text style={s.editHeaderSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.editPageScroll}
            contentContainerStyle={s.editPageContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.editField}>
              <Text style={s.editLabel}>Activity name</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Activity name"
                placeholderTextColor={colors.subtext}
                style={s.editInput}
                maxLength={80}
              />
            </View>

            <View style={s.editField}>
              <Text style={s.editLabel}>Media</Text>
              <TouchableOpacity
                style={s.editMediaButton}
                onPress={pickEditMedia}
                activeOpacity={0.86}
                disabled={editSaving}
              >
                <Feather name="image" size={17} color={colors.text} />
                <Text style={s.editMediaButtonText}>Add photos</Text>
              </TouchableOpacity>
              {editMediaUris.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.editMediaStrip}>
                  {editMediaUris.map((uri) => (
                    <View key={uri} style={s.editMediaThumbWrap}>
                      <Image source={{ uri }} style={s.editMediaThumb} />
                      <TouchableOpacity
                        style={s.editMediaRemove}
                        onPress={() => removeEditMedia(uri)}
                        activeOpacity={0.85}
                        disabled={editSaving}
                      >
                        <Feather name="x" size={13} color={colors.text} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
            </View>

            <View style={s.editField}>
              <Text style={s.editLabel}>Activity type</Text>
              <TouchableOpacity
                style={s.editDropdown}
                onPress={() => setEditTypeOpen((open) => !open)}
                activeOpacity={0.86}
                disabled={editSaving}
              >
                <Text style={s.editDropdownText}>
                  {EDIT_ACTIVITY_TYPES.find((item) => item.value === editType)?.label || editType || "Workout"}
                </Text>
                <Feather name={editTypeOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.subtext} />
              </TouchableOpacity>
              {editTypeOpen ? (
                <View style={s.editDropdownMenu}>
                  {EDIT_ACTIVITY_TYPES.map(({ value, label }) => {
                    const selected = editType === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        style={[s.editDropdownOption, selected && s.editDropdownOptionSelected]}
                        onPress={() => {
                          setEditType(value);
                          setEditTypeOpen(false);
                        }}
                        activeOpacity={0.84}
                        disabled={editSaving}
                      >
                        <Text style={[s.editDropdownOptionText, selected && s.editChipTextSelected]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>

            <View style={s.editField}>
              <Text style={s.editLabel}>Activity label</Text>
              <View style={s.editChipGrid}>
                {EDIT_ACTIVITY_LABELS.map((value) => {
                  const selected = editActivityLabel === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[s.editChip, selected && s.editChipSelected]}
                      onPress={() => setEditActivityLabel(selected ? "" : value)}
                      activeOpacity={0.84}
                      disabled={editSaving}
                    >
                      <Text style={[s.editChipText, selected && s.editChipTextSelected]}>{value}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.editField}>
              <View style={s.editEffortHeader}>
                <Text style={s.editLabel}>How hard was it?</Text>
                <Text style={s.editEffortValue}>{editEffortScore}/10</Text>
              </View>
              <View
                style={s.editEffortBar}
                onLayout={(event) => setEditEffortBarWidth(event.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => !editSaving}
                onMoveShouldSetResponder={() => !editSaving}
                onResponderGrant={updateEditEffortFromTouch}
                onResponderMove={updateEditEffortFromTouch}
              >
                {Array.from({ length: 10 }, (_, index) => {
                  const score = index + 1;
                  const selected = score <= editEffortScore;
                  return (
                    <View
                      key={score}
                      style={[s.editEffortSegment, selected && s.editEffortSegmentSelected]}
                    />
                  );
                })}
              </View>
              <View style={s.editChipGrid}>
                {["Easy", "Steady", "Moderate", "Hard", "Max effort"].map((value) => {
                  const selected = editEffort === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[s.editChip, selected && s.editChipSelected]}
                      onPress={() => {
                        setEditEffort(value);
                        setEditEffortScore(
                          value === "Easy"
                            ? 3
                            : value === "Steady"
                            ? 5
                            : value === "Moderate"
                            ? 7
                            : value === "Hard"
                            ? 9
                            : 10
                        );
                      }}
                      activeOpacity={0.84}
                      disabled={editSaving}
                    >
                      <Text style={[s.editChipText, selected && s.editChipTextSelected]}>{value}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.editField}>
              <Text style={s.editLabel}>Notes</Text>
              <TextInput
                value={editNotes}
                onChangeText={setEditNotes}
                placeholder="How did it go? What should the coach know?"
                placeholderTextColor={colors.subtext}
                style={[s.editInput, s.editTextArea]}
                multiline
                maxLength={500}
              />
            </View>
          </ScrollView>

          <View style={s.editPageFooter}>
            <TouchableOpacity
              style={[s.editDeleteButton, editDeleting && s.linkPlanButtonDisabled]}
              onPress={confirmDeleteActivity}
              activeOpacity={0.85}
              disabled={editSaving || editDeleting}
            >
              {editDeleting ? (
                <ActivityIndicator size="small" color="#F87171" />
              ) : (
                <>
                  <Feather name="trash-2" size={15} color="#F87171" />
                  <Text style={s.editDeleteText}>Delete activity</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

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

function LineProfileChart({ data, colors, isDark, accent, xUnit = "km" }) {
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

  const rawMinX = Math.min(...safe.map((p) => Number(p.x)));
  const maxXRaw = Math.max(...safe.map((p) => Number(p.x)));
  const minX = rawMinX < 0 ? rawMinX : 0;
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
        <Text style={{ fontSize: 10, color: colors.subtext }}>
          {xUnit === "km" ? "0 km" : xUnit === "min" ? "0 min" : "0"}
        </Text>
        <Text style={{ fontSize: 10, color: colors.subtext }}>
          {xUnit === "km"
            ? `${Math.max(0, Math.round(maxX))} km`
            : xUnit === "min"
            ? `${Math.max(0, Math.round(maxX))} min`
            : `${Math.max(0, Math.round(maxX))}`}
        </Text>
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

function SectionInsight({ insight, colors, styles }) {
  if (!insight?.text) return null;
  const isWatch = insight.tone === "watch";
  const isGood = insight.tone === "good";
  const color = isWatch ? "#F59E0B" : isGood ? "#22C55E" : colors.subtext;
  const icon = isWatch ? "alert-triangle" : isGood ? "check-circle" : "info";

  return (
    <View style={styles.sectionInsight}>
      <View style={[styles.sectionInsightIcon, { backgroundColor: `${color}22` }]}>
        <Feather name={icon} size={13} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sectionInsightTitle, { color }]}>{insight.title}</Text>
        <Text style={[styles.sectionInsightText, { color: colors.subtext }]}>
          {insight.text}
        </Text>
      </View>
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
    headerSide: {
      width: 76,
      flexDirection: "row",
      alignItems: "center",
    },
    headerActions: {
      justifyContent: "flex-end",
      gap: 8,
    },
    headerBtnDisabled: {
      opacity: 0.35,
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
    benefitCard: {
      marginTop: 2,
      borderRadius: 18,
      padding: 13,
      backgroundColor: isDark ? "rgba(230,255,59,0.10)" : "rgba(184,215,0,0.14)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.24)" : "rgba(132,153,0,0.24)",
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    benefitIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: accentFill,
    },
    benefitEyebrow: {
      fontSize: 10,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    benefitText: {
      marginTop: 4,
      fontSize: 14,
      lineHeight: 19,
      fontWeight: "800",
      color: colors.text,
    },
    performedCard: {
      borderRadius: 18,
      padding: 14,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    performedHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    performedIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: accentFill,
    },
    performedEyebrow: {
      fontSize: 10,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    performedTitle: {
      marginTop: 3,
      fontSize: 15,
      lineHeight: 19,
      fontWeight: "900",
      color: colors.text,
    },
    performedSubtitle: {
      marginTop: 3,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
      color: colors.subtext,
    },
    performedStack: {
      marginTop: 12,
      gap: 10,
    },
    performedSection: {
      gap: 8,
    },
    performedSectionTitle: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    performedExercise: {
      paddingTop: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: borderSoft,
    },
    performedExerciseTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
    },
    performedExerciseMeta: {
      marginTop: 3,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "700",
      color: colors.subtext,
    },
    performedSetStack: {
      marginTop: 8,
      gap: 5,
    },
    performedSetRow: {
      minHeight: 30,
      borderRadius: 10,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card,
    },
    performedSetIndex: {
      fontSize: 11,
      fontWeight: "800",
      color: colors.subtext,
    },
    performedSetValue: {
      fontSize: 12,
      fontWeight: "900",
      color: colors.text,
    },
    performedRunLine: {
      paddingTop: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: borderSoft,
    },
    performedRunIndex: {
      fontSize: 10,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    performedRunText: {
      marginTop: 3,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "800",
      color: colors.text,
    },
    performedEmptyText: {
      marginTop: 12,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "700",
      color: colors.subtext,
    },
    performedActionButton: {
      marginTop: 12,
      minHeight: 44,
      borderRadius: 14,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: accentFill,
    },
    performedActionText: {
      fontSize: 14,
      fontWeight: "900",
      color: accentText,
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
    activityMediaStrip: {
      gap: 10,
      paddingRight: 18,
    },
    activityMediaImage: {
      width: 172,
      height: 122,
      borderRadius: 18,
      backgroundColor: cardBg,
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
    sectionInsight: {
      marginTop: 9,
      borderRadius: 12,
      padding: 10,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 9,
    },
    sectionInsightIcon: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    sectionInsightTitle: {
      fontSize: 11,
      fontWeight: "900",
      marginBottom: 2,
    },
    sectionInsightText: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "650",
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
    infoSheet: {
      maxHeight: "70%",
      borderRadius: 22,
      padding: 16,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    infoPanel: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      padding: 13,
      borderRadius: 16,
      backgroundColor: isDark ? "rgba(230,255,59,0.10)" : "rgba(184,215,0,0.14)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? "rgba(230,255,59,0.24)" : "rgba(132,153,0,0.24)",
    },
    infoPanelMuted: {
      padding: 13,
      borderRadius: 16,
      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : colors.sapSilverLight || colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    infoPanelIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: accentFill,
    },
    infoPanelLabel: {
      fontSize: 10,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.7,
    },
    infoPanelText: {
      marginTop: 5,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "800",
      color: colors.text,
    },
    infoMetricGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      justifyContent: "space-between",
    },
    editSheet: {
      maxHeight: "86%",
      borderRadius: 22,
      padding: 16,
      backgroundColor: cardBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editPage: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    editPageHeader: {
      minHeight: 64,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderSoft,
      backgroundColor: colors.bg,
    },
    editPageTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "900",
    },
    editPageSubtitle: {
      marginTop: 3,
      color: colors.subtext,
      fontSize: 11,
      fontWeight: "700",
    },
    editHeaderSave: {
      minWidth: 58,
      minHeight: 34,
      borderRadius: 17,
      paddingHorizontal: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: accentFill,
    },
    editHeaderSaveText: {
      color: accentText,
      fontSize: 13,
      fontWeight: "900",
    },
    editPageScroll: {
      flex: 1,
    },
    editPageContent: {
      padding: 18,
      paddingBottom: 120,
      gap: 18,
    },
    editPageFooter: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 18,
      backgroundColor: colors.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: borderSoft,
    },
    editField: {
      gap: 7,
    },
    editLabel: {
      fontSize: 11,
      fontWeight: "900",
      color: colors.subtext,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    editInput: {
      minHeight: 48,
      borderRadius: 14,
      paddingHorizontal: 13,
      paddingVertical: 11,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    editTextArea: {
      minHeight: 112,
      textAlignVertical: "top",
      lineHeight: 20,
      fontWeight: "600",
    },
    editMediaButton: {
      minHeight: 48,
      borderRadius: 15,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editMediaButtonText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "800",
    },
    editMediaStrip: {
      gap: 10,
      paddingTop: 2,
      paddingRight: 18,
    },
    editMediaThumbWrap: {
      width: 92,
      height: 92,
      borderRadius: 18,
      overflow: "hidden",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editMediaThumb: {
      width: "100%",
      height: "100%",
    },
    editMediaRemove: {
      position: "absolute",
      top: 7,
      right: 7,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.56)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.22)",
    },
    editDropdown: {
      minHeight: 50,
      borderRadius: 15,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editDropdownText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "800",
    },
    editDropdownMenu: {
      overflow: "hidden",
      borderRadius: 16,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editDropdownOption: {
      minHeight: 44,
      paddingHorizontal: 14,
      justifyContent: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: borderSoft,
    },
    editDropdownOptionSelected: {
      backgroundColor: accentFill,
      borderBottomColor: accentFill,
    },
    editDropdownOptionText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "800",
    },
    editChipGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    editChip: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editChipSelected: {
      backgroundColor: accentFill,
      borderColor: accentFill,
    },
    editChipText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
    },
    editChipTextSelected: {
      color: accentText,
    },
    editEffortHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    editEffortValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "900",
    },
    editEffortBar: {
      height: 34,
      borderRadius: 17,
      padding: 5,
      flexDirection: "row",
      gap: 4,
      backgroundColor: panelBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: borderSoft,
    },
    editEffortSegment: {
      flex: 1,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)",
    },
    editEffortSegmentSelected: {
      backgroundColor: accentFill,
    },
    editSaveButton: {
      marginTop: 14,
      minHeight: 48,
      borderRadius: 999,
      backgroundColor: accentFill,
      alignItems: "center",
      justifyContent: "center",
    },
    editSaveText: {
      color: accentText,
      fontSize: 14,
      fontWeight: "900",
    },
    editDeleteButton: {
      marginTop: 10,
      minHeight: 44,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(248,113,113,0.42)",
      backgroundColor: "rgba(248,113,113,0.10)",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    editDeleteText: {
      color: "#F87171",
      fontSize: 13,
      fontWeight: "900",
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
