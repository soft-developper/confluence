import { Router } from "express";
import type { Config } from "../config.js";

export function healthRouter(config: Config) {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "confluence-api",
      env: config.CONFLUENCE_ENV,
      version: process.env.npm_package_version ?? "0.1.0",
      time: new Date().toISOString(),
    });
  });
  return router;
}
