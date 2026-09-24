import { Router } from "express";
import type { Config } from "../config.js";
import { pingDb, type Db } from "../db/client.js";

export function healthRouter(config: Config, db: Db) {
  const router = Router();
  router.get("/health", async (_req, res) => {
    const dbOk = await pingDb(db);
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? "ok" : "degraded",
      service: "confluence-api",
      env: config.CONFLUENCE_ENV,
      db: dbOk ? "ok" : "unreachable",
      version: process.env.npm_package_version ?? "0.1.0",
      time: new Date().toISOString(),
    });
  });
  return router;
}
