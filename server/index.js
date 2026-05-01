// server/index.js
import cors from "cors";
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

import admin from "./admin.js";

// Routes
import analyseSessionRoute from "./routes/analyse-session.js";
import coachChatRoute from "./routes/coach-chat.js";
import garminActivitiesRoutes from "./routes/garmin-activities.js";
import garminHealthRoutes from "./routes/garmin-health.js";
import garminTrainingRoutes from "./routes/garmin-training.js";
import garminWebhookRoutes from "./routes/garmin-webhook.js";
import garminAuthRoutes from "./routes/garmin.js"; // OAuth logic
import generateRunV2Router from "./routes/generate-run-v2.js";
import generateRunRouter from "./routes/generate-run.js";
import generateStrengthRouter from "./routes/generate-strength.js";
import nutritionRoutes from "./routes/nutrition.js";
import nutritionSearch from "./routes/nutritionSearch.js";
import raceSearchAiRouter from "./routes/race-search-ai.js";
import racesRouter from "./routes/races.js";
import stravaRoutes from "./routes/strava.js";
import trainChatRoute from "./routes/train-chat.js";
import workoutRoutes from "./routes/workout.js";
import { requireUser } from "./utils/requireUser.js";

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

const localOnly = (req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  const allowDebugRoutes = process.env.ALLOW_DEBUG_ROUTES === "1";

  if (!isProduction || allowDebugRoutes) return next();

  return res.status(404).json({ error: "Not found" });
};

// ---------- Health Check ----------
app.get("/health", (_req, res) =>
  res.json({ ok: true, timestamp: Date.now() })
);

// ============================================================================
// Garmin Infrastructure
// ============================================================================

// 1. Webhooks
app.use("/webhooks/garmin", garminWebhookRoutes);
app.use("/garmin-webhook", garminWebhookRoutes);

// 2. Auth Flow
app.use("/auth/garmin", garminAuthRoutes);

// 3. Health Data Retrieval
app.use("/garmin/health", garminHealthRoutes);

// 4. Activity Data Retrieval / Status
app.use("/garmin/activities", garminActivitiesRoutes);

// 5. Workout send/export routes
app.use("/garmin", garminTrainingRoutes);

// ============================================================================
// AI & Training Routes
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

// Single run-plan engine policy
app.use("/ai", deprecatedPlanEngine);
app.use("/api/ai-plan", deprecatedPlanEngine);
app.use("/run-plan", deprecatedPlanEngine);
app.use("/run-plan-ai", deprecatedPlanEngine);
app.use("/plans", deprecatedPlanEngine);
app.use("/stockplan-run", deprecatedPlanEngine);

// ---------- Rules-based plan generation ----------
app.use("/generate-run", requireUser, generateRunRouter);
app.use("/generate-run-v2", requireUser, generateRunV2Router);
app.use("/generate-run/v2", requireUser, generateRunV2Router);
app.use("/generate-strength", requireUser, generateStrengthRouter);

// ============================================================================
// Debugging
// ============================================================================
app.get(
  "/debug/garmin/write-test-health",
  localOnly,
  requireUser,
  async (req, res) => {
    try {
      const uid = String(req.user?.uid || "").trim();

      if (!uid) {
        return res
          .status(401)
          .json({ ok: false, error: "Unauthenticated user" });
      }

      const docRef = await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("garmin_health")
        .add({
          fetchedAtMs: Date.now(),
          fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
          kind: "debug_health",
          payload: {
            test: true,
            source: "debug",
            msg: "Health payload simulation",
          },
        });

      return res.json({ ok: true, docId: docRef.id });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e?.message || "Failed to write test health data",
      });
    }
  }
);

// ============================================================================
// Listen
// ============================================================================
const port = process.env.PORT || 3001;

app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${port}`);

  if (!openai) {
    console.warn("⚠️ OpenAI client not initialized. Check OPENAI_API_KEY.");
  }
});