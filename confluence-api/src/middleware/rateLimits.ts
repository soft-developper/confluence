import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";

/**
 * Swap point for the counter store. Today every limiter uses express-rate-limit's
 * built-in in-memory store (correct while we run ONE API instance). Before scaling
 * to several instances, return a shared store here (e.g. rate-limit-redis backed by
 * Render Key Value); no route code changes.
 */
function createStore(_limiterName: string): Store | undefined {
  return undefined; // undefined = built-in MemoryStore
}

const WINDOW_MS = 60_000;

function onLimit(req: Request, res: import("express").Response, _next: unknown, options: { windowMs: number }) {
  res.status(429).json({ error: "rate_limited", retryAfterSeconds: Math.ceil(options.windowMs / 1000) });
}

function ipKey(req: Request): string {
  // req.ip honours the app's "trust proxy" setting; ipKeyGenerator groups IPv6 by subnet.
  return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

/** 100 requests per minute per IP on every route except /health (platform health checks). */
export function ipRateLimit(limit = 100): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "per-ip",
    keyGenerator: ipKey,
    skip: (req) => req.path === "/health",
    handler: onLimit,
    store: createStore("per-ip"),
  });
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Per-user limit. Until accounts exist (Pay Intent stage), "user" is the wallet
 * address the request acts for. Requests without a valid address are counted
 * against their IP instead, so they are never unlimited.
 */
export function userRateLimit(opts: {
  name: string;
  limit: number;
  identify: (req: Request) => unknown;
}): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: opts.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: opts.name,
    keyGenerator: (req) => {
      const who = opts.identify(req);
      return typeof who === "string" && EVM_ADDRESS.test(who) ? `wallet:${who.toLowerCase()}` : ipKey(req);
    },
    handler: onLimit,
    store: createStore(opts.name),
  });
}

/** 60 quote requests per minute per user. */
export const quoteRateLimit = (identify: (req: Request) => unknown) =>
  userRateLimit({ name: "quotes", limit: 60, identify });

/** 10 bridge creation attempts per minute per user. */
export const createTransferRateLimit = (identify: (req: Request) => unknown) =>
  userRateLimit({ name: "transfer-create", limit: 10, identify });
