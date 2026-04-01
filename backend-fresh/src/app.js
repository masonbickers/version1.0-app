import cors from "cors";
import express from "express";
import healthRouter from "./routes/health.js";
import generateRunRouter from "./routes/generateRun.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));

  app.use("/health", healthRouter);
  app.use("/generate-run", generateRunRouter);

  app.use((_req, res) => {
    res.status(404).json({
      error: "Not found",
      routes: ["GET /health", "POST /generate-run"],
    });
  });

  return app;
}
