import express from "express";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(healthRouter);
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  return app;
}
