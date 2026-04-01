import express from "express";
import { generatePlanFromRequest } from "../planner/index.js";

const router = express.Router();

router.post("/", (req, res) => {
  try {
    const result = generatePlanFromRequest(req.body);
    if (!result.ok) {
      return res.status(400).json({
        error: "Invalid request body for plan generation.",
        details: result.errors,
        warnings: result.warnings
      });
    }

    return res.json({
      ok: true,
      warnings: result.warnings,
      plan: result.plan
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Failed to generate run plan."
    });
  }
});

export default router;
