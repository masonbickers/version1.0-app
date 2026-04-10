// server/index.js
import cors from "cors";
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

import admin from "./admin.js";

// Routes
import analyseSessionRoute from "./routes/analyse-session.js";
import coachChatRoute from "./routes/coach-chat.js";
import garminHealthRoutes from "./routes/garmin-health.js";
import garminWebhookRoutes from "./routes/garmin-webhook.js";
import garminAuthRoutes from "./routes/garmin.js"; // OAuth logic
import garminTrainingRoutes from "./routes/garmin-training.js";
import generateRunRouter from "./routes/generate-run.js";
import generateRunV2Router from "./routes/generate-run-v2.js";
import generateStrengthRouter from "./routes/generate-strength.js";
import nutritionRoutes from "./routes/nutrition.js";
import nutritionSearch from "./routes/nutritionSearch.js";
import raceSearchAiRouter from "./routes/race-search-ai.js";
import racesRouter from "./routes/races.js";
import stravaRoutes from "./routes/strava.js";
import trainChatRoute from "./routes/train-chat.js";
import { requireUser } from "./utils/requireUser.js";
import workoutRoutes from "./routes/workout.js";

const app = express();

// ---------- Express setup ----------
app.set("trust proxy", true);
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: true }));

// ---------- OpenAI client ----------
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const deprecatedPlanEngine = (_req, res) => {
  return res.status(410).json({
    error: "Deprecated plan endpoint. Use POST /generate-run.",
    canonicalRoute: "/generate-run",
  });
};

// ---------- Health Check ----------
app.get("/health", (_req, res) => res.json({ ok: true, timestamp: Date.now() }));

// ============================================================================
// Garmin Infrastructure
// ============================================================================

// 1. Webhooks (Keep both for backward compatibility)
app.use("/webhooks/garmin", garminWebhookRoutes);
app.use("/garmin-webhook", garminWebhookRoutes);

// 2. Auth Flow (OAuth 1.0a handshake)
app.use("/auth/garmin", garminAuthRoutes);

// 3. Health Data Retrieval (API calls to Garmin for history)
app.use("/garmin/health", garminHealthRoutes);

// 4. Workout send/export routes
app.use("/garmin", garminTrainingRoutes);

// ============================================================================
// AI & Training Routes (Passing OpenAI client where needed)
// ============================================================================
app.use("/coach-chat", coachChatRoute(openai));
app.use("/workouts", workoutRoutes(openai));
app.use("/nutrition", nutritionRoutes(openai));

// Standard Routes
app.use("/nutrition-search", nutritionSearch);
app.use("/train-chat", trainChatRoute);
app.use("/api/analyse-session", analyseSessionRoute);
app.use("/strava", stravaRoutes);
app.use("/races", raceSearchAiRouter);
app.use("/api/races", racesRouter);

// Single run-plan engine policy:
// /generate-run is the only active endpoint for run-plan generation.
app.use("/ai", deprecatedPlanEngine);
app.use("/api/ai-plan", deprecatedPlanEngine);
app.use("/run-plan", deprecatedPlanEngine);
app.use("/run-plan-ai", deprecatedPlanEngine);
app.use("/plans", deprecatedPlanEngine);
app.use("/stockplan-run", deprecatedPlanEngine);

// ---------- Rules-based plan generation (NO templates) ----------
app.use("/generate-run", requireUser, generateRunRouter); // POST /generate-run
app.use("/generate-run-v2", requireUser, generateRunV2Router); // POST /generate-run-v2
app.use("/generate-run/v2", requireUser, generateRunV2Router); // POST /generate-run/v2
app.use("/generate-strength", requireUser, generateStrengthRouter); // POST /generate-strength
// ============================================================================
// Debugging
// ============================================================================
app.get("/debug/garmin/write-test-health", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ ok: false, error: "Missing uid" });

    const docRef = await admin
      .firestore()
      .collection("users")
      .doc(String(uid))
      .collection("garmin_health")
      .add({
        fetchedAtMs: Date.now(),
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        kind: "debug_health",
        payload: { test: true, source: "debug", msg: "Health payload simulation" },
      });

    return res.json({ ok: true, docId: docRef.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================================
// Listen
// ============================================================================
const port = process.env.PORT || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${port}`);
  if (!openai) console.warn("⚠️ OpenAI client not initialized. Check OPENAI_API_KEY.");
});
