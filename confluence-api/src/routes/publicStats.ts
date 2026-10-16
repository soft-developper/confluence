import { Router } from "express";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { userRateLimit } from "../middleware/rateLimits.js";
import type { SwapRegistry } from "../swaps/tokens.js";
import { getDashboard } from "../stats/dashboard.js";
import { dailyStats, parseRange, StatsRangeError, statsSummary, type ChainIds } from "../stats/publicStats.js";

/** How long computed stats are reused before the database is read again. */
export const STATS_CACHE_MS = 10 * 60_000;
const MAX_CACHED = 50;

/**
 * Public, read-only stats (confluence:public-stats). Aggregates only: no wallet addresses,
 * transaction hashes or notes. Used by the landing dashboard and by DefiLlama's adapters.
 * Results are cached in memory for STATS_CACHE_MS and by browsers and CDNs for as long.
 */
export function publicStatsRouter(db: Db, registry: ChainRegistry, swapRegistry: SwapRegistry, now: () => number = Date.now) {
  const router = Router();
  const limit = userRateLimit({ name: "public-stats", limit: 120, identify: () => undefined });
  const ids: ChainIds = new Map([
    ...swapRegistry.chains.map((c) => [c.id, c.evmChainId] as const),
    ...registry.chains.map((c) => [c.id, c.evmChainId] as const),
  ]);
  const cache = new Map<string, { at: number; body: unknown }>();
  const cached = async (key: string, compute: () => Promise<unknown>) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < STATS_CACHE_MS) return hit.body;
    const body = await compute();
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now(), body });
    return body;
  };
  const cacheHeader = `public, max-age=${STATS_CACHE_MS / 1000}`;

  router.get("/public/stats/daily", limit, async (req, res, next) => {
    try {
      const { from, to } = parseRange(req.query.from, req.query.to, now());
      const body = await cached(`daily|${from}|${to}`, async () => ({
        generatedAt: new Date(now()).toISOString(),
        from,
        to,
        days: await dailyStats(db, ids, from, to),
      }));
      res.set("Cache-Control", cacheHeader).json(body);
    } catch (e) {
      if (e instanceof StatsRangeError) {
        res.status(400).json({ error: "invalid_range", message: e.message });
        return;
      }
      next(e);
    }
  });

  router.get("/public/stats/summary", limit, async (_req, res, next) => {
    try {
      res.set("Cache-Control", cacheHeader).json(await cached("summary", () => statsSummary(db, ids, now())));
    } catch (e) {
      next(e);
    }
  });

  // Landing dashboard settings (on/off, figures, range, source). Edited in admin.
  router.get("/site/stats-dashboard", async (_req, res, next) => {
    try {
      res.set("Cache-Control", "public, max-age=60").json(await getDashboard(db));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
