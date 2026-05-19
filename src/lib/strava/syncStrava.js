// src/lib/strava/syncStrava.js
import {
    Timestamp,
    collection,
    doc,
    getDocs,
    limit,
    query,
    serverTimestamp,
    setDoc,
    writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebaseConfig";
import { activityDedupeKey, likelySameActivity } from "../activities/activityDedupe";
import { refreshTrainingWidgetSnapshotForUser } from "../../widgets/trainingWidgetSnapshot";
  
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  
  export async function syncStravaActivities(uid, accessToken) {
    if (!uid || !accessToken) return;
  
    const after = Math.floor((Date.now() - 1000 * 60 * 60 * 24 * 120) / 1000); // 120 days
  
    const resp = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Strava sync failed ${resp.status}: ${t}`);
    }
  
    const acts = await resp.json();
    const safeActs = Array.isArray(acts) ? acts : [];
  
    const batch = writeBatch(db);
    const baseRef = collection(db, "users", uid, "stravaActivities");
    const garminCollections = ["garmin_activities", "garminActivities"];
    const existingGarminActivities = (
      await Promise.all(
        garminCollections.map(async (collectionName) => {
          try {
            const snap = await getDocs(
              query(collection(db, "users", uid, collectionName), limit(250))
            );
            return snap.docs.map((d) => ({
              id: d.id,
              source: collectionName,
              ...(d.data() || {}),
            }));
          } catch {
            return [];
          }
        })
      )
    ).flat();
  
    safeActs.forEach((a) => {
      const start = new Date(a.start_date_local || a.start_date);
      if (Number.isNaN(start.getTime())) return;

      const ref = doc(baseRef, String(a.id));
      const distanceMeters = Number(a.distance || 0) || 0;
      const distanceKm = distanceMeters > 0 ? distanceMeters / 1000 : 0;
      const movingTimeSec = Number(a.moving_time || 0) || 0;
      const movingTimeMin = movingTimeSec > 0 ? Math.round(movingTimeSec / 60) : 0;
      const avgPaceMinPerKm =
        distanceKm > 0 && movingTimeSec > 0
          ? Number((movingTimeSec / 60 / distanceKm).toFixed(2))
          : null;
      const averageHeartrateRaw = Number(a.average_heartrate || 0) || 0;
      const averageHeartrate =
        averageHeartrateRaw > 0 ? Math.round(averageHeartrateRaw) : null;
      const summaryPolyline = String(a?.map?.summary_polyline || "").trim();
      const nextActivity = {
        id: String(a.id),
        activityId: String(a.id),
        type: a.type || "Other",
        name: a.name || "",
        startDate: Timestamp.fromDate(start),
        day: Timestamp.fromDate(startOfDay(start)),
        startDateMs: start.getTime(),
        distanceKm,
        distanceM: Math.round(distanceMeters),
        movingTimeSec,
        movingTimeMin,
        elevGainM: Math.round(a.total_elevation_gain || 0),
        averageSpeedMps: Number(a.average_speed || 0) || 0,
        maxSpeedMps: Number(a.max_speed || 0) || 0,
        averageHeartrate,
        avgPaceMinPerKm,
        calories: Number(a.kilojoules || 0) || 0,
        summaryPolyline: summaryPolyline || null,
        device: a.device_name || "",
        source: "strava",
        activityDedupeKey: activityDedupeKey({
          source: "strava",
          id: String(a.id),
          startDateMs: start.getTime(),
          distanceM: Math.round(distanceMeters),
          movingTimeSec,
          type: a.type || "Other",
        }),
        updatedAt: serverTimestamp(),
      };
      const duplicate = existingGarminActivities.find((candidate) =>
        likelySameActivity(nextActivity, candidate)
      );
      if (duplicate) {
        nextActivity.hiddenDuplicate = true;
        nextActivity.duplicateOf = {
          provider: "garmin",
          source: duplicate.source || "garmin_activities",
          id: duplicate.id || duplicate.activityId || null,
          activityId: duplicate.activityId || duplicate.id || null,
        };
        nextActivity.duplicateCheckedAt = serverTimestamp();
      } else {
        nextActivity.hiddenDuplicate = false;
        nextActivity.duplicateOf = null;
        nextActivity.duplicateCheckedAt = serverTimestamp();
      }

      batch.set(
        ref,
        nextActivity,
        { merge: true }
      );
    });
  
    await batch.commit();
  
    // track last sync (on user root doc)
    await setDoc(
      doc(db, "users", uid),
      { lastStravaSyncAt: serverTimestamp() },
      { merge: true }
    );

    await refreshTrainingWidgetSnapshotForUser({
      userId: uid,
      reason: "strava_import",
    }).catch((error) => {
      console.warn("[widgets] Strava import snapshot failed:", error?.message || error);
    });
  }
  
