import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { ipRateLimit } from "../middleware/rateLimits.js";
import { buildQuoteBody, findRoute, QuoteInput, usableEvmChainIds } from "../relay/proxy.js";
import { appFeeRecipient, currentRelaySettings } from "../relay/settings.js";
import { RelayBusyError, RelayNotConfiguredError, type RelayUpstream } from "../relay/upstream.js";

/**
 * Relay integration (R1). /relay/* is the allowlisted proxy the browser SDK talks to;
 * /relay-settings tells the web app whether Relay is on and what our app fee is.
 * (confluence:relay-routes)
 */
export function relayRouter(db: Db, registry: ChainRegistry, upstream: RelayUpstream, referrer: string) {
  const router = Router();

  router.get("/relay-settings", async (_req, res, next) => {
    try {
      const s = await currentRelaySettings(db);
      res.set("Cache-Control", "public, max-age=15").json({ enabled: s.enabled && upstream.configured, appFeeBps: s.appFeeBps });
    } catch (e) {
      next(e);
    }
  });

  // Tighter per-IP limit on quotes: Relay allows our whole key only 50 quotes a minute,
  // so one visitor must not be able to spend it. The web app debounces well below this.
  const quoteLimit = ipRateLimit(20);

  const proxy = async (req: Request, res: Response) => {
    const route = findRoute(req.method, req.path);
    if (!route) {
      res.status(404).json({ error: "relay_route_not_allowed" });
      return;
    }
    if (!upstream.configured) {
      res.status(503).json({ error: "relay_not_configured", message: "Relay is not available right now." });
      return;
    }
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const headers: Record<string, string> = {};
    const sdkVersion = req.get("relay-sdk-version");
    if (sdkVersion) headers["relay-sdk-version"] = sdkVersion.slice(0, 40);

    let body: unknown = route.method === "POST" ? (req.body ?? {}) : undefined;
    if (route.path === "/quote/v2") {
      const settings = await currentRelaySettings(db);
      if (!settings.enabled) {
        res.status(503).json({ error: "relay_disabled", message: "Relay routes are turned off right now." });
        return;
      }
      const parsed = QuoteInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        return;
      }
      const evm = await usableEvmChainIds(upstream);
      if (!evm.has(parsed.data.originChainId) || !evm.has(parsed.data.destinationChainId)) {
        res.status(400).json({ error: "unsupported_chain", message: "Only EVM chains that Relay currently supports can be used." });
        return;
      }
      body = buildQuoteBody(parsed.data, {
        appFeeBps: settings.appFeeBps,
        appFeeRecipient: await appFeeRecipient(db, registry),
        referrer,
      });
    }

    try {
      const out = await upstream.request(route.method, `${route.path}${query}`, body, route.cacheMs, headers);
      if (out.retryAfterSeconds) res.set("Retry-After", String(out.retryAfterSeconds));
      res.status(out.status).json(out.body);
    } catch (e) {
      if (e instanceof RelayNotConfiguredError) {
        res.status(503).json({ error: "relay_not_configured", message: "Relay is not available right now." });
      } else if (e instanceof RelayBusyError) {
        res.set("Retry-After", "2").status(429).json({ error: "relay_busy", retryAfterSeconds: 2, message: "Too many requests right now, please try again in a moment." });
      } else {
        res.status(502).json({ error: "relay_unavailable", message: "Could not reach Relay. Please try again." });
      }
    }
  };

  router.use("/relay", (req, res, next) => {
    const run = () => proxy(req, res).catch(next);
    if (req.method === "POST" && req.path === "/quote/v2") quoteLimit(req, res, run);
    else run();
  });

  return router;
}

export const RelaySettingsPublic = z.object({ enabled: z.boolean(), appFeeBps: z.number() });
