import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/search", async (req, res) => {
  try {
    const { q, from, to, page = 1 } = req.query;

    const url = new URL("https://api.runsignup.com/rest/races");
    if (q) url.searchParams.set("search", q);
    if (from) url.searchParams.set("start_date", from);
    if (to) url.searchParams.set("end_date", to);

    url.searchParams.set("events", "T");
    url.searchParams.set("results_per_page", "20");
    url.searchParams.set("page", page);

    const response = await fetch(url.toString());
    const data = await response.json();

    const races = (data.races || []).map((r) => ({
      id: r.race_id,
      name: r.name,
      date: r.start_date,
      city: r.city,
      country: r.country,
      events: r.events?.map((e) => e.name) || [],
      url: r.url,
    }));

    res.json({ races });
  } catch (err) {
    console.error("[RunSignup search error]", err);
    res.status(500).json({ error: "Failed to fetch races" });
  }
});

export default router;
