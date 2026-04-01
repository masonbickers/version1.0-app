// src/lib/strava/syncStrava.js
import {
    Timestamp,
    collection,
    doc,
    serverTimestamp,
    setDoc,
    writeBatch,
} from "firebase/firestore";
import { db } from "../../../firebaseConfig";
  
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
  
    safeActs.forEach((a) => {
      const start = new Date(a.start_date_local || a.start_date);
      if (Number.isNaN(start.getTime())) return;
  
      const ref = doc(baseRef, String(a.id));
  
      batch.set(
        ref,
        {
          id: String(a.id),
          type: a.type || "Other",
          name: a.name || "",
          startDate: Timestamp.fromDate(start),
          day: Timestamp.fromDate(startOfDay(start)),
          startDateMs: start.getTime(), // optional but useful
          distanceKm: (a.distance || 0) / 1000,
          movingTimeMin: Math.round((a.moving_time || 0) / 60),
          elevGainM: Math.round(a.total_elevation_gain || 0),
          device: a.device_name || "",
          source: "strava",
          updatedAt: serverTimestamp(),
        },
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
  }
  