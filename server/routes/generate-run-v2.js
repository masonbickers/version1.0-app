import express from "express";
import { generateRunPlanV2, normalizeAndValidateRequest } from "../lib/train/newGenerator/index.js";
import {
  applyRecentTrainingSafeguardsToProfile,
  loadRecentReadinessRowsForUser,
  loadRecentTrainingRowsForUser,
} from "../lib/train/planRules/adaptation.js";

const router = express.Router();

// POST /generate-run-v2
// Also mounted as /generate-run/v2 from server/index.js.
router.post("/", async (req, res) => {
  try {
    const { athleteProfile, generatorConfig, errors, warnings } = normalizeAndValidateRequest(req.body);
    if (errors.length) {
      return res.status(400).json({
        error: "Invalid request for new generator.",
        details: errors,
      });
    }

    let enrichedProfile = athleteProfile;
    const useRecentTraining =
      req.query?.useRecentTraining !== "0" &&
      req.query?.useRecentTraining !== "false" &&
      athleteProfile?.adaptation?.enabled !== false;

    if (useRecentTraining && req.user?.uid) {
      try {
        const [recentTrainingRows, recentReadinessRows] = await Promise.all([
          loadRecentTrainingRowsForUser(req.user.uid),
          loadRecentReadinessRowsForUser(req.user.uid),
        ]);
        const adaptationResult = applyRecentTrainingSafeguardsToProfile({
          athleteProfile,
          recentTrainingRows,
          recentReadinessRows,
        });
        enrichedProfile = adaptationResult?.athleteProfile || athleteProfile;
      } catch (adaptErr) {
        console.log("[generate-run-v2] recent training adaptation skipped:", adaptErr?.message || adaptErr);
      }
    }

    const plan = generateRunPlanV2({ athleteProfile: enrichedProfile, generatorConfig });
    return res.json({
      ok: true,
      generator: "new_generator_v2",
      warnings,
      plan: {
        ...plan,
        adaptationTrace: enrichedProfile?.adaptationTrace || null,
        recentTrainingSummary: enrichedProfile?.recentTrainingSummary || null,
        recentReadinessSummary: enrichedProfile?.recentReadinessSummary || null,
      },
    });
  } catch (error) {
    console.error("[generate-run-v2] error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate run plan (v2).",
    });
  }
});

export default router;
