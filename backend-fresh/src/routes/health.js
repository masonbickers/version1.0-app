import express from "express";

const router = express.Router();

router.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "backend-fresh",
    timestamp: Date.now(),
  });
});

export default router;
