// server/routes/race-search-ai.js
import express from "express";
import OpenAI from "openai";

const router = express.Router();

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// GET /races/ai-search
// q=10k&goalDistance=10K&targetDate=2026-05-01&windowStart=...&windowEnd=...&userLat=...&userLng=...&radiusKm=...
router.get("/ai-search", async (req, res) => {
  try {
    if (!openai) {
      return res.status(500).json({ error: "OpenAI not configured" });
    }

    const {
      q = "",
      goalDistance,
      targetDate,
      windowStart,
      windowEnd,
      userLat,
      userLng,
      radiusKm,
    } = req.query;

    if (!q.trim()) {
      return res.json({ races: [] });
    }

    // ---- numeric / optional params ----
    const latNum =
      typeof userLat === "string" && userLat.trim() !== ""
        ? Number(userLat)
        : null;
    const lngNum =
      typeof userLng === "string" && userLng.trim() !== ""
        ? Number(userLng)
        : null;
    const radiusNum =
      typeof radiusKm === "string" && radiusKm.trim() !== ""
        ? Number(radiusKm)
        : null;

    const userLocation =
      latNum != null &&
      lngNum != null &&
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum)
        ? { lat: latNum, lng: lngNum }
        : null;

    const dateWindow =
      typeof windowStart === "string" || typeof windowEnd === "string"
        ? {
            start: windowStart || null,
            end: windowEnd || null,
          }
        : null;

    const userContext = {
      query: q,
      goalDistance: goalDistance || null,
      targetDate: targetDate || null,
      dateWindow,
      userLocation,
      radiusKm: Number.isFinite(radiusNum) ? radiusNum : null,
    };

    console.log("[race-search-ai] userContext:", userContext);

    const systemPrompt = `
You suggest running races for a UK-based training app.

- Use the context to suggest realistic events that would make sense.
- Prefer UK and popular European races unless the query clearly points elsewhere.
- If you don't know exact real races, invent plausible but realistic ones
  in the correct city/country and time of year.
- Take into account:
  • query text (often includes city, distance, or famous race names)
  • goalDistance if provided (keep race distance in a sensible range for that)
  • targetDate / dateWindow if provided (prefer events inside that window)
  • userLocation and radiusKm if provided (favour events nearer the user)
- Assume recreational / club-level runners (not elites).

You MUST output STRICT JSON only in this shape:

{
  "races": [
    {
      "name": "string",
      "location": "string",
      "date": "YYYY-MM-DD" or "Unknown",
      "distance": "5K" | "10K" | "Half marathon" | "Marathon" | "Ultra" | "Other"
    }
  ]
}
`.trim();

    // ✅ Use the same Responses API pattern as your nutrition routes
    const resp = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Context:\n${JSON.stringify(userContext, null, 2)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "RaceSearchResult",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              races: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    location: { type: "string" },
                    date: { type: "string" }, // "YYYY-MM-DD" or "Unknown"
                    distance: { type: "string" },
                  },
                  required: ["name", "location", "distance"],
                },
              },
            },
            required: ["races"],
          },
        },
      },
    });

    const jsonText = resp.output_text || "{}";
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error("[race-search-ai] JSON parse error:", err, jsonText);
      return res.status(500).json({ error: "Bad AI JSON" });
    }

    const races = Array.isArray(parsed.races) ? parsed.races : [];

    // ---- basic sanitisation / normalisation ----
    const cleaned = races.map((r) => {
      const rawDate = typeof r.date === "string" ? r.date.trim() : "";
      const isIso =
        /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(rawDate));

      return {
        name: String(r.name || "Unnamed race"),
        location: String(r.location || "Unknown"),
        date: isIso ? rawDate : null, // null ⇒ "Date varies" in UI
        distance: String(r.distance || "Other"),
      };
    });

    return res.json({ races: cleaned });
  } catch (err) {
    console.error("[race-search-ai] error:", err);
    return res.status(500).json({ error: "AI race search failed" });
  }
});

export default router;

