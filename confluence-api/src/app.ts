import express from "express";
import cors from "cors";
import type { Config } from "./config.js";
import { healthRouter } from "./routes/health.js";

export function createApp(config: Config) {
  const app = express();
  app.disable("x-powered-by");

  const allowed = new Set(config.CORS_ORIGINS);

  // Strict allowlist: a browser request from an origin not on the list is
  // rejected outright instead of reaching the route without CORS headers.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    next();
  });

  app.use(
    cors({
      // Requests without an Origin header (curl, server to server) pass; browsers
      // from origins not on the allowlist get no CORS headers and are blocked.
      origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Idempotency-Key"],
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: "100kb" }));
  app.use(healthRouter(config));
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  return app;
}
