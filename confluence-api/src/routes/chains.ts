import { Router } from "express";
import type { Config } from "../config.js";
import { FINALITY_SOURCE_URL, type ChainRegistry } from "../chains/registry.js";

export function chainsRouter(config: Config, registry: ChainRegistry) {
  const router = Router();
  router.get("/chains", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      env: config.CONFLUENCE_ENV,
      speedSource: FINALITY_SOURCE_URL,
      chains: registry.chains,
    });
  });
  return router;
}
