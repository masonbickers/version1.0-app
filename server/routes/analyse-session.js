// routes/analyse-session.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * POST /api/analyse-session
 * Body:
 * {
 *   id, name, type,
 *   distance,          // metres
 *   moving_time,       // seconds
 *   elapsed_time,      // seconds
 *   average_heartrate,
 *   max_heartrate,
 *   total_elevation_gain,
 *   paceSecPerKm,      // seconds per km (optional, we can recompute)
 *   start_date
 * }
 */
router.post("/", async (req, res) => {
  const payload = req.body || {};
  console.log("[analyse-session] payload received:", {
    id: payload.id,
    name: payload.name,
    type: payload.type,
    distance: payload.distance,
    moving_time: payload.moving_time,
    hasAthleteProfile: !!payload.athleteProfile,
  });

  // ---- normalise numbers ---------------------------------------------------
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const compactObject = (value) => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      const arr = value.map(compactObject).filter((item) => item != null);
      return arr.length ? arr : null;
    }

    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      if (item == null || item === "") return;
      if (typeof item === "object") {
        const cleaned = compactObject(item);
        if (cleaned != null) next[key] = cleaned;
        return;
      }
      next[key] = item;
    });
    return Object.keys(next).length ? next : null;
  };
  const ageFromDob = (dobISO) => {
    const raw = String(dobISO || "").trim();
    if (!raw) return null;
    const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return age >= 10 && age <= 100 ? age : null;
  };
  const estimateMaxHrFromAge = (age) => {
    const value = Number(age);
    if (!Number.isFinite(value) || value < 10 || value > 100) return null;
    return Math.round(208 - 0.7 * value);
  };

  const id = payload.id;
  const name = payload.name;
  const type = payload.type;
  const athleteProfileRaw = compactObject(payload.athleteProfile);
  const athleteAge =
    toNum(athleteProfileRaw?.age) || ageFromDob(athleteProfileRaw?.dobISO || athleteProfileRaw?.dob);
  const profileMaxHrWasEstimated =
    athleteProfileRaw?.maxHRSource === "age_estimate" ||
    athleteProfileRaw?.hr?.maxSource === "age_estimate";
  const manualProfileMaxHr = profileMaxHrWasEstimated
    ? null
    : toNum(athleteProfileRaw?.hr?.max ?? athleteProfileRaw?.maxHR);
  const estimatedProfileMaxHr =
    toNum(athleteProfileRaw?.hr?.estimatedMax ?? athleteProfileRaw?.estimatedMaxHR) ||
    estimateMaxHrFromAge(athleteAge);
  const profileMaxHr = manualProfileMaxHr || estimatedProfileMaxHr;
  const athleteProfile = compactObject(
    athleteProfileRaw
      ? {
          ...athleteProfileRaw,
          age: athleteAge,
          estimatedMaxHR: estimatedProfileMaxHr,
          maxHRSource: manualProfileMaxHr
            ? "manual"
            : estimatedProfileMaxHr
            ? "age_estimate"
            : athleteProfileRaw?.maxHRSource,
          hr: {
            ...(athleteProfileRaw?.hr || {}),
            max: profileMaxHr,
            estimatedMax: estimatedProfileMaxHr,
            maxSource: manualProfileMaxHr
              ? "manual"
              : estimatedProfileMaxHr
              ? "age_estimate"
              : athleteProfileRaw?.hr?.maxSource,
          },
        }
      : null
  );

  const distance = toNum(payload.distance);
  const moving_time = toNum(payload.moving_time);
  const elapsed_time = toNum(payload.elapsed_time);
  const average_heartrate = toNum(payload.average_heartrate);
  const max_heartrate = toNum(payload.max_heartrate);
  const total_elevation_gain = toNum(payload.total_elevation_gain);
  const paceSecPerKmRaw = toNum(payload.paceSecPerKm);
  const start_date = payload.start_date;
  const mode = String(payload.mode || "session").trim().toLowerCase();
  const notes = String(payload.notes || payload.description || "").trim();
  const device_name = String(payload.device_name || "").trim();
  const rawLaps = Array.isArray(payload.laps) ? payload.laps : [];
  const laps = rawLaps
    .map((lap, idx) => {
      const distance = toNum(lap?.distance_m ?? lap?.distance);
      const moving_time = toNum(lap?.moving_time_s ?? lap?.moving_time);
      const elapsed_time = toNum(lap?.elapsed_time_s ?? lap?.elapsed_time);
      const avg_hr = toNum(lap?.avg_hr ?? lap?.average_heartrate);
      const elev_diff = toNum(lap?.elev_diff ?? lap?.elevation_difference);
      const elev_gain = toNum(lap?.elev_gain ?? lap?.total_elevation_gain);
      const pace = distance && moving_time ? moving_time / (distance / 1000) : null;
      return {
        idx: toNum(lap?.index) || idx + 1,
        name: String(lap?.name || `Lap ${idx + 1}`),
        distance,
        moving_time,
        elapsed_time,
        avg_hr,
        elev_diff,
        elev_gain,
        pace,
      };
    })
    .filter((lap) => lap.distance && lap.moving_time);

  // Basic validation (must be > 0)
  if (!distance || !moving_time) {
    console.warn(
      "[analyse-session] invalid distance or moving_time",
      distance,
      moving_time
    );
    return res.status(400).json({
      error: "distance and moving_time are required and must be > 0",
    });
  }

  const distanceKm = distance / 1000;
  const paceSeconds =
    paceSecPerKmRaw && Number.isFinite(paceSecPerKmRaw)
      ? paceSecPerKmRaw
      : moving_time / distanceKm;
  const formatPace = (secPerKm) => {
    if (!secPerKm || !Number.isFinite(secPerKm)) return "-";
    const mins = Math.floor(secPerKm / 60);
    const secs = Math.round(secPerKm % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}/km`;
  };

  const formattedPace = formatPace(paceSeconds);

  // ---- Fallback text if OpenAI missing / fails -----------------------------
  const fallback = () => {
    const hrBit =
      average_heartrate != null
        ? ` Average HR was about ${Math.round(
            average_heartrate
          )}bpm${
            profileMaxHr
              ? ` (${Math.round((average_heartrate / profileMaxHr) * 100)}% of your ${
                  manualProfileMaxHr ? "saved" : "age-estimated"
                } max HR)`
              : ""
          }, which suggests a solid aerobic effort.`
        : "";
    const elevBit =
      total_elevation_gain != null
        ? ` With around ${Math.round(
            total_elevation_gain
          )}m of elevation, terrain likely added some extra load.`
        : "";

    return `Session summary: ${distanceKm.toFixed(
      2
    )}km in ${Math.round(moving_time / 60)} minutes (~${formattedPace}).${hrBit}${elevBit} Overall this looks like a steady effort. Keep an eye on early pacing and try to finish with a slight negative split next time.`;
  };

  const fallbackLapsReview = () => {
    if (!laps.length) {
      return `I couldn't find valid lap data for this activity. Once lap data is available, I can assess average lap pace, pacing control and execution quality for your set.`;
    }

    const workLaps = laps.filter((l) => l.distance >= 150 && l.distance <= 3000);
    const target = workLaps.length ? workLaps : laps;
    const totalDist = target.reduce((s, l) => s + (l.distance || 0), 0);
    const totalTime = target.reduce((s, l) => s + (l.moving_time || 0), 0);
    const avgPaceSec = totalDist > 0 ? totalTime / (totalDist / 1000) : null;
    const lapPaces = target.map((l) => l.pace).filter((p) => Number.isFinite(p));

    let variability = null;
    if (lapPaces.length > 1) {
      const mean = lapPaces.reduce((a, b) => a + b, 0) / lapPaces.length;
      const variance =
        lapPaces.reduce((sum, p) => sum + (p - mean) ** 2, 0) / lapPaces.length;
      variability = Math.sqrt(variance);
    }

    const quality =
      variability == null
        ? "hard to grade"
        : variability <= 4
          ? "very well executed"
          : variability <= 8
            ? "solidly executed"
            : variability <= 14
              ? "moderately variable"
              : "quite inconsistent";

    const avgHr =
      target
        .map((l) => l.avg_hr)
        .filter((v) => Number.isFinite(v) && v > 0)
        .reduce((a, b, _, arr) => a + b / arr.length, 0) || null;

    const vText =
      variability == null
        ? "I don't have enough laps to assess pace consistency."
        : `Pace variation across laps was about ${Math.round(
            variability
          )} sec/km, which is ${quality}.`;

    return `Laps review: average lap pace for the set was ${formatPace(
      avgPaceSec
    )}.${avgHr ? ` Average lap HR was about ${Math.round(avgHr)} bpm.` : ""} ${vText} ${
      notes
        ? `From your notes ("${notes.slice(0, 120)}${notes.length > 120 ? "…" : ""}"), this looks reasonably aligned with the intended session demand.`
        : "Add notes next time and I can judge execution against the intended session objective more precisely."
    }`;
  };

  if (!openai) {
    console.warn("[analyse-session] OPENAI_API_KEY not set – using fallback");
    return res.json({ analysis: fallback() });
  }

  try {
    const systemPromptSession = `
You are an experienced endurance coach.
You analyse a single training session and give clear, concise feedback.

Goals:
- Summarise the run (distance, time, pace, elevation, HR).
- Comment on pacing (too hot, steady, conservative, good negative split potential, etc.).
- Comment on effort using the athlete profile when provided, especially measured max HR or age-estimated max HR, resting HR, threshold HR, age/DOB, weight, height and training background.
- If athlete profile data is missing, avoid pretending to know exact zones.
- Pinpoint any specific metric that may be limiting performance, such as cadence too high/low, HR too high for the session goal, spiky power, poor pace control, long stopped time, or terrain cost.
- Give 2–3 specific recommendations for future sessions (pacing, fuelling, warm-up, etc.).

Keep it short, punchy and conversational. UK spelling. Do NOT use bullet points or markdown, just 1–3 short paragraphs of text. Mention one personalised reason only when the profile supports it.
`.trim();

    const systemPromptLaps = `
You are an experienced run coach analysing a workout from lap-level data and athlete notes.

Your output must:
- State the average lap pace for the key work set.
- Judge whether that pace is appropriate/good for the apparent session intent.
- Evaluate execution quality (consistency, control, fade/finish, pacing discipline).
- Reference heart-rate and elevation changes when relevant.
- Use the athlete profile when provided, especially measured max HR or age-estimated max HR, resting HR, threshold HR, age/DOB and training background.
- Pinpoint any metric that may be hindering performance, such as cadence, HR drift, power spikes, poor recovery lap control, or inconsistent lap pacing.
- Give 2 practical next-step recommendations.

Keep it concise, conversational UK English, no markdown and no bullet points. 2–3 short paragraphs.
`.trim();

    const userData = {
      id,
      name,
      type,
      distance_m: distance,
      distance_km: distanceKm,
      moving_time_s: moving_time,
      elapsed_time_s: elapsed_time,
      avg_hr: average_heartrate,
      max_hr: max_heartrate,
      total_elevation_gain_m: total_elevation_gain,
      pace_s_per_km: paceSeconds,
      pace_str: formattedPace,
      start_date,
      device_name,
      notes,
      laps,
      athlete_profile: athleteProfile,
    };

    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: mode === "laps_review" ? systemPromptLaps : systemPromptSession,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Here is the session data (JSON): ${JSON.stringify(
                userData
              )}`,
            },
          ],
        },
      ],
    });

    const analysisText =
      resp.output_text || (mode === "laps_review" ? fallbackLapsReview() : fallback());

    return res.json({
      analysis:
        analysisText || (mode === "laps_review" ? fallbackLapsReview() : fallback()),
    });
  } catch (e) {
    console.error("[analyse-session] error", e);
    return res.json({
      analysis: mode === "laps_review" ? fallbackLapsReview() : fallback(),
    });
  }
});

export default router;
