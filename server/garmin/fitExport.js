import express from "express";
import { generateFitWorkout } from "../garmin/fitGenerator.js";

const router = express.Router();

/**
 * POST /export-fit
 * Body: { "plan": { ... }, "name": "..." }
 */
router.post("/export-fit", async (req, res) => {
  try {
    const { plan, name } = req.body;

    // 1. Validation
    if (!plan) {
      return res.status(400).json({
        ok: false,
        error: "No valid plan provided.",
      });
    }

    const workoutName = name || "AI Run Session";

    // 2. Generate binary data
    // Ensure the generator exists and is imported correctly
    const rawData = generateFitWorkout(plan, workoutName);
    
    // Convert to Node.js Buffer to ensure proper binary transmission
    const fitBuffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);

    // 3. Filename Sanitization
    const fileNameSafe = workoutName
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase()
      .slice(0, 40);

    const finalName = `${fileNameSafe}.fit`;

    // 4. Set Binary Headers
    // 'application/octet-stream' is okay, but 'application/x-garmin-fit' is the specific mime-type
    res.setHeader("Content-Type", "application/x-garmin-fit");
    res.setHeader("Content-Disposition", `attachment; filename="${finalName}"`);
    res.setHeader("Content-Length", fitBuffer.length);

    // Explicitly send the buffer
    return res.end(fitBuffer, 'binary');

  } catch (err) {
    console.error("[export-fit] ERROR:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to generate FIT file.",
      details: err.message
    });
  }
});

export default router;