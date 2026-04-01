import express from "express";
import { generateRunPlanV2, normalizeAndValidateRequest } from "../lib/train/newGenerator/index.js";

const router = express.Router();

// POST /generate-run-v2
// Also mounted as /generate-run/v2 from server/index.js.
router.post("/", (req, res) => {
  try {
    const { athleteProfile, generatorConfig, errors, warnings } = normalizeAndValidateRequest(req.body);
    if (errors.length) {
      return res.status(400).json({
        error: "Invalid request for new generator.",
        details: errors,
      });
    }

    const plan = generateRunPlanV2({ athleteProfile, generatorConfig });
    return res.json({
      ok: true,
      generator: "new_generator_v2",
      warnings,
      plan,
    });
  } catch (error) {
    console.error("[generate-run-v2] error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate run plan (v2).",
    });
  }
});

export default router;
