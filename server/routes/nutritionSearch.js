import express from "express";
import { searchFoodsCached } from "../lib/nutrition/foodCatalogCache.js";

const router = express.Router();

// Unified global search (USDA + OpenFoodFacts + Nutritionix when keys exist)
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) return res.json({ results: [] });
    const { results, cacheMeta } = await searchFoodsCached({
      query: q,
      limit: 30,
    });
    res.json({ results, cacheMeta });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Search failed" });
  }
});

export default router;
