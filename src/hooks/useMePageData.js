import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";

import { auth, db } from "../../firebaseConfig";

const STRAVA_CACHE_KEY = "strava_cached_activities_v1";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatKm(value) {
  return `${toNum(value, 0).toFixed(1)} km`;
}

function formatMinutes(value) {
  const mins = Math.round(toNum(value, 0));
  if (!mins) return "0 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatShortDate(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "—";
  }
}

function formatRelativeSync(ms) {
  if (!ms) return "Not synced yet";
  const dayMs = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((Date.now() - ms) / dayMs);
  if (deltaDays <= 0) return "Synced today";
  if (deltaDays === 1) return "Synced yesterday";
  return `Synced ${deltaDays} days ago`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfMonth(ms) {
  const date = new Date(ms);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isRunType(type) {
  return String(type || "").toLowerCase() === "run";
}

function deriveProgress(activities) {
  const todayStart = startOfToday();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const monthStartMs = startOfMonth(todayStart);

  const weekly = {
    workouts: 0,
    runs: 0,
    distanceKm: 0,
    timeMin: 0,
  };
  const monthly = {
    workouts: 0,
    distanceKm: 0,
    timeMin: 0,
  };
  const activeDays = new Set();

  activities.forEach((row) => {
    const startMs = toMillis(row.startDateMs || row.startDate || row.when);
    if (!startMs) return;

    const type = row.type || "Workout";
    const distanceKm = toNum(
      row.distanceKm ?? (toNum(row.distance, 0) > 1000 ? row.distance / 1000 : row.distance),
      0
    );
    const movingTimeMin = Math.round(
      toNum(row.movingTimeMin ?? row.moving_time / 60 ?? row.movingTime / 60, 0)
    );

    if (startMs >= weekStart) {
      weekly.workouts += 1;
      weekly.distanceKm += distanceKm;
      weekly.timeMin += movingTimeMin;
      if (isRunType(type)) weekly.runs += 1;
    }

    if (startMs >= monthStartMs) {
      monthly.workouts += 1;
      monthly.distanceKm += distanceKm;
      monthly.timeMin += movingTimeMin;
    }

    if (startMs >= todayStart - 13 * 24 * 60 * 60 * 1000) {
      activeDays.add(new Date(startMs).toISOString().slice(0, 10));
    }
  });

  return {
    weekly,
    monthly,
    activeDays14: activeDays.size,
    summaryMetrics: [
      { key: "week", label: "This week", value: `${weekly.workouts}` },
      { key: "distance", label: "Distance", value: formatKm(weekly.distanceKm) },
      { key: "month", label: "This month", value: `${monthly.workouts}` },
      { key: "consistency", label: "Consistency", value: `${activeDays.size}/14` },
    ],
  };
}

function deriveRecentActivities(activities) {
  return activities.slice(0, 2).map((activity) => {
    const whenMs = toMillis(activity.startDateMs || activity.startDate || activity.when);
    const distanceKm = toNum(
      activity.distanceKm ??
        (toNum(activity.distance, 0) > 1000 ? activity.distance / 1000 : activity.distance),
      0
    );
    const movingTimeMin = Math.round(
      toNum(activity.movingTimeMin ?? activity.moving_time / 60 ?? activity.movingTime / 60, 0)
    );

    return {
      ...activity,
      whenLabel: formatShortDate(whenMs),
      meta: [
        activity.type || "Workout",
        distanceKm > 0 ? formatKm(distanceKm) : null,
        movingTimeMin > 0 ? formatMinutes(movingTimeMin) : null,
      ]
        .filter(Boolean)
        .join(" • "),
    };
  });
}

function readActivitySortMs(activity) {
  return toMillis(
    activity.startTimeMs ||
      activity.startDateMs ||
      activity.startTime ||
      activity.startDate ||
      activity.startedAt ||
      activity.summaryStartTimeInSeconds * 1000 ||
      activity.startTimeInSeconds * 1000 ||
      activity.when
  );
}

function normalizeGarminActivity(activity, source, index) {
  const sortMs = readActivitySortMs(activity);
  const distanceMeters =
    toNum(activity.distanceInMeters, 0) ||
    toNum(activity.distanceM, 0) ||
    toNum(activity.distanceMeters, 0) ||
    (toNum(activity.distanceKm, 0) > 0 ? toNum(activity.distanceKm, 0) * 1000 : 0);
  const durationSec =
    toNum(activity.durationInSeconds, 0) ||
    toNum(activity.durationSec, 0) ||
    toNum(activity.elapsedDurationInSeconds, 0) ||
    toNum(activity.movingDurationInSeconds, 0);

  return {
    id: activity.id || activity.activityId || `garmin-activity-${source}-${index}`,
    provider: "garmin",
    source,
    type: activity.activityType || activity.type || activity.sport || "Garmin activity",
    name: activity.activityName || activity.name || activity.title || "Garmin activity",
    startDateMs: sortMs,
    distanceKm: distanceMeters > 0 ? distanceMeters / 1000 : 0,
    movingTimeMin: durationSec > 0 ? durationSec / 60 : 0,
    averageHeartRate: activity.averageHeartRateInBeatsPerMinute || activity.avgHr || activity.averageHeartRate,
    calories: activity.activeKilocalories || activity.calories,
    rawGarminActivity: activity,
  };
}

function normalizeGarminActivities(snaps) {
  return snaps.flatMap(({ snap, source }) =>
    snap.docs.map((d, index) => normalizeGarminActivity({ id: d.id, ...(d.data() || {}) }, source, index))
  );
}

function buildSupportingLine(profile) {
  if (profile?.bio) return profile.bio.trim();
  const fallback = [profile?.sport, profile?.location].filter(Boolean);
  if (fallback.length) return fallback.join(" • ");
  return "Personal progress";
}

function buildStatusDetail(integrations) {
  const connected = [
    integrations?.stravaConnected ? "Strava" : null,
    integrations?.garminConnected ? "Garmin" : null,
  ].filter(Boolean);

  if (connected.length === 2) return "Strava and Garmin connected";
  if (connected.length === 1) return `${connected[0]} connected`;
  return "Connect your training accounts";
}

export function useMePageData() {
  const user = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [integrations, setIntegrations] = useState({
    stravaConnected: false,
    garminConnected: false,
    lastStravaSyncMs: 0,
    garminWorkoutSyncCount: 0,
    lastGarminWorkoutSyncMs: 0,
    lastGarminWorkoutTitle: "",
  });
  const [activities, setActivities] = useState([]);
  const [garminActivities, setGarminActivities] = useState([]);
  const [garminWorkoutSyncs, setGarminWorkoutSyncs] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setProfile(null);
        setActivities([]);
        setGarminActivities([]);
        setGarminWorkoutSyncs([]);
        setLoading(false);
        return;
      }

      const [
        stravaConnectedRaw,
        cachedRaw,
        userSnap,
        publicProfileSnap,
        activitiesSnap,
        garminActivitiesSnap,
        garminActivitiesLegacySnap,
        garminSyncsSnap,
      ] =
        await Promise.all([
          AsyncStorage.getItem("strava_connected"),
          AsyncStorage.getItem(STRAVA_CACHE_KEY),
          getDoc(doc(db, "users", uid)),
          getDoc(doc(db, "public_profiles", uid)),
          getDocs(
            query(
              collection(db, "users", uid, "stravaActivities"),
              orderBy("startDate", "desc"),
              limit(40)
            )
          ),
          getDocs(query(collection(db, "users", uid, "garmin_activities"), limit(100))),
          getDocs(query(collection(db, "users", uid, "garminActivities"), limit(100))),
          getDocs(
            query(
              collection(db, "users", uid, "garmin_workout_syncs"),
              orderBy("uploadedAtMs", "desc"),
              limit(10)
            )
          ),
        ]);

      let cachedSyncMs = 0;
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          cachedSyncMs = toMillis(cached?.cachedAtISO);
        } catch {}
      }

      const userData = userSnap.exists() ? userSnap.data() || {} : {};
      const publicProfile = publicProfileSnap.exists()
        ? publicProfileSnap.data() || {}
        : {};

      const nextProfile = {
        name: user?.displayName || publicProfile?.name || "Your account",
        email: user?.email || "No email",
        username: publicProfile?.username || publicProfile?.handle || "",
        sport: publicProfile?.sport || "",
        location: publicProfile?.location || "",
        bio: publicProfile?.bio || "",
        photoURL: user?.photoURL || publicProfile?.photoURL || "",
      };

      const nextIntegrations = {
        stravaConnected: stravaConnectedRaw === "1",
        garminConnected: userData?.integrations?.garmin?.connected === true,
        lastStravaSyncMs:
          toMillis(userData?.lastStravaSyncAt) || cachedSyncMs || 0,
      };
      const nextGarminSyncs = garminSyncsSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() || {}),
      }));
      const latestGarminSync = nextGarminSyncs[0] || null;
      nextIntegrations.garminWorkoutSyncCount = nextGarminSyncs.length;
      nextIntegrations.lastGarminWorkoutSyncMs = toMillis(
        latestGarminSync?.uploadedAtMs || latestGarminSync?.uploadedAt
      );
      nextIntegrations.lastGarminWorkoutTitle = latestGarminSync?.title || "";

      setProfile({
        ...nextProfile,
        supportLine: buildSupportingLine(nextProfile),
        statusDetail: buildStatusDetail(nextIntegrations),
      });
      setIntegrations(nextIntegrations);
      setActivities(activitiesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
      setGarminActivities(
        normalizeGarminActivities([
          { snap: garminActivitiesSnap, source: "garmin_activities" },
          { snap: garminActivitiesLegacySnap, source: "garminActivities" },
        ])
      );
      setGarminWorkoutSyncs(nextGarminSyncs);
    } catch (e) {
      setError(String(e?.message || e || "Failed to load your profile"));
    } finally {
      setLoading(false);
    }
  }, [user?.displayName, user?.email, user?.photoURL]);

  useEffect(() => {
    load();
  }, [load]);

  const combinedActivities = useMemo(
    () =>
      [...activities, ...garminActivities].sort(
        (a, b) => readActivitySortMs(b) - readActivitySortMs(a)
      ),
    [activities, garminActivities]
  );

  const progress = useMemo(() => deriveProgress(combinedActivities), [combinedActivities]);
  const recentActivities = useMemo(
    () => deriveRecentActivities(combinedActivities),
    [combinedActivities]
  );

  const integrationRows = useMemo(
    () => [
      {
        key: "strava",
        label: "Strava",
        value: integrations.stravaConnected ? "Connected" : "Not connected",
        meta: integrations.stravaConnected
          ? formatRelativeSync(integrations.lastStravaSyncMs)
          : "Connect in Settings",
      },
      {
        key: "garmin",
        label: "Garmin",
        value: integrations.garminConnected ? "Connected" : "Not connected",
        meta: integrations.garminConnected
          ? integrations.garminWorkoutSyncCount > 0
            ? `Last sent: ${integrations.lastGarminWorkoutTitle || "Workout"}`
            : "Training API ready"
          : "Manage in Profile",
        detail:
          integrations.garminConnected && integrations.garminWorkoutSyncCount > 0
            ? `${integrations.garminWorkoutSyncCount} recent sends • ${formatRelativeSync(
                integrations.lastGarminWorkoutSyncMs
              )}`
            : "",
      },
    ],
    [
      integrations.garminConnected,
      integrations.garminWorkoutSyncCount,
      integrations.lastGarminWorkoutSyncMs,
      integrations.lastGarminWorkoutTitle,
      integrations.lastStravaSyncMs,
      integrations.stravaConnected,
    ]
  );

  const deeperLinks = useMemo(
    () => [
      {
        key: "analytics",
        label: "Analytics",
        meta: "Deeper trends and comparisons",
        value: "Soon",
      },
      {
        key: "goals",
        label: "Goals",
        meta: "Targets and progress",
        path: "/me/goals",
      },
      {
        key: "prs",
        label: "PRs",
        meta: "Personal bests",
        path: "/me/prs",
      },
      {
        key: "calendar",
        label: "Calendar",
        meta: "Training history and schedule",
        path: "/me/calendar",
      },
    ],
    []
  );

  return {
    loading,
    error,
    profile,
    progress,
    recentActivities,
    garminActivities,
    garminWorkoutSyncs,
    integrationRows,
    deeperLinks,
    refresh: load,
  };
}

export default useMePageData;
