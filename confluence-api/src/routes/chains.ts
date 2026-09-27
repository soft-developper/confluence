import { Router } from "express";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { FINALITY_SOURCE_URL, type ChainRegistry } from "../chains/registry.js";
import { disabledChainIds } from "../chains/availability.js";

export function chainsRouter(config: Config, registry: ChainRegistry, db: Db) {
  const router = Router();
  router.get("/chains", async (_req, res, next) => {
    try {
      // Every chain is listed (in-flight transfers and their pages still need them);
      // bridgeEnabled=false means the admin took it out of the bridge pickers.
      const off = await disabledChainIds(db);
      res.set("Cache-Control", "public, max-age=30");
      res.json({
        env: config.CONFLUENCE_ENV,
        speedSource: FINALITY_SOURCE_URL,
        chains: registry.chains.map((c) => ({ ...c, bridgeEnabled: !off.has(c.id) })),
      });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
