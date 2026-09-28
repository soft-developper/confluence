import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { ipRateLimit } from "../middleware/rateLimits.js";
import { buildQuoteBody, findRoute, QuoteInput, relayChain, usableEvmChainIds } from "../relay/proxy.js";
import { verifyQuote } from "../relay/verify.js";
import { applyStatus, enrichFromRelay, TERMINAL } from "../relay/status.js";
import { verifyRelayWebhook } from "../relay/webhook.js";
import { relayRequests } from "../db/schema.js";
import { appFeeRecipient, currentRelaySettings } from "../relay/settings.js";
import { RelayBusyError, RelayNotConfiguredError, type RelayUpstream } from "../relay/upstream.js";

/**
 * Relay integration (R1). /relay/* is the allowlisted proxy the browser SDK talks to;
 * /relay-settings tells the web app whether Relay is on and what our app fee is.
 * (confluence:relay-routes)
 */
export function relayRouter(db: Db, registry: ChainRegistry, upstream: RelayUpstream, referrer: string, webhookSecret?: string) {
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
    let verifyAgainst: (QuoteInput & { recipient: string }) | null = null;
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
      verifyAgainst = { ...parsed.data, recipient: parsed.data.recipient ?? parsed.data.user };
      body = buildQuoteBody(parsed.data, {
        appFeeBps: settings.appFeeBps,
        appFeeRecipient: await appFeeRecipient(db, registry),
        referrer,
      });
    }

    try {
      const out = await upstream.request(route.method, `${route.path}${query}`, body, route.cacheMs, headers);
      if (verifyAgainst && out.status === 200) {
        const reason = verifyQuote(out.body, verifyAgainst, await relayChain(upstream, verifyAgainst.originChainId));
        if (reason) {
          console.warn(`[relay] quote failed verification: ${reason} (${verifyAgainst.originChainId} -> ${verifyAgainst.destinationChainId})`);
          res.status(502).json({ error: "quote_failed_verification", message: "This quote could not be verified, so it was not offered. Please try again." });
          return;
        }
      }
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

  // R3a: the browser registers each Relay request once its first transaction is sent.
  // This record only feeds history and analytics; statuses come from Relay (R3b).
  const registerLimit = ipRateLimit(20);
  router.post("/relay-requests", registerLimit, async (req, res, next) => {
    try {
      const parsed = RegisterRequest.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        return;
      }
      const r = parsed.data;
      const settings = await currentRelaySettings(db);
      const now = new Date();
      // Chain names from Relay's own (cached) list, not from the browser.
      const nameOf = async (id: number) => {
        const c = (await relayChain(upstream, id).catch(() => null)) as { displayName?: string; name?: string } | null;
        return c?.displayName ?? c?.name ?? null;
      };
      await db
        .insert(relayRequests)
        .values({
          requestId: r.requestId.toLowerCase(),
          userAddress: r.user.toLowerCase(),
          recipient: r.recipient.toLowerCase(),
          originChainId: r.originChainId,
          destinationChainId: r.destinationChainId,
          originCurrency: r.originCurrency.toLowerCase(),
          destinationCurrency: r.destinationCurrency.toLowerCase(),
          symbolIn: r.symbolIn,
          symbolOut: r.symbolOut,
          amountIn: r.amountIn,
          amountOutQuoted: r.amountOutQuoted ?? null,
          appFeeBps: settings.appFeeBps,
          inTxHash: r.inTxHash?.toLowerCase() ?? null,
          originChainName: await nameOf(r.originChainId),
          destinationChainName: await nameOf(r.destinationChainId),
          decimalsIn: r.decimalsIn ?? null,
          decimalsOut: r.decimalsOut ?? null,
          appFeeQuotedUsd: r.appFeeQuotedUsd ?? null,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: relayRequests.requestId });
      res.status(201).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // R3b: Relay's signed status webhook (configure it in the Relay Dashboard for our key).
  router.post("/relay-webhook", async (req, res, next) => {
    try {
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!verifyRelayWebhook(raw, req.get("x-signature-timestamp"), req.get("x-signature-sha256"), webhookSecret)) {
        res.status(401).json({ error: "invalid_signature" });
        return;
      }
      const event = (req.body ?? {}) as { event?: string; data?: Record<string, unknown> };
      const d = event.data ?? {};
      if (event.event === "request.status.updated" && typeof d.requestId === "string" && typeof d.status === "string") {
        const changed = await applyStatus(db, { requestId: d.requestId, status: d.status, inTxHashes: d.inTxHashes, txHashes: d.txHashes, failReason: d.failReason });
        // R4: a finished request gets its USD figures from Relay's record (in the background).
        if (changed && (TERMINAL as readonly string[]).includes(d.status.toLowerCase())) void enrichFromRelay(db, upstream, d.requestId).catch(() => false);
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  router.use("/relay", (req, res, next) => {
    const run = () => proxy(req, res).catch(next);
    if (req.method === "POST" && req.path === "/quote/v2") quoteLimit(req, res, run);
    else run();
  });

  return router;
}

export const RelaySettingsPublic = z.object({ enabled: z.boolean(), appFeeBps: z.number() });

const EVM = /^0x[0-9a-fA-F]{40}$/;
const RegisterRequest = z
  .object({
    requestId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    user: z.string().regex(EVM),
    recipient: z.string().regex(EVM),
    originChainId: z.number().int().positive(),
    destinationChainId: z.number().int().positive(),
    originCurrency: z.string().regex(EVM),
    destinationCurrency: z.string().regex(EVM),
    symbolIn: z.string().min(1).max(32),
    symbolOut: z.string().min(1).max(32),
    amountIn: z.string().regex(/^[1-9][0-9]{0,77}$/),
    amountOutQuoted: z.string().regex(/^[0-9]{1,78}$/).optional(),
    inTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    decimalsIn: z.number().int().min(0).max(36).optional(),
    decimalsOut: z.number().int().min(0).max(36).optional(),
    appFeeQuotedUsd: z.string().regex(/^[0-9]{1,15}(\.[0-9]{1,12})?$/).optional(),
  })
  .strict();
