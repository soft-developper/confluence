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

const PRIVATE_IP = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT 100.64.0.0/10
  /^169\.254\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i, // fc00::/7
  /^fe80:/i,
  /^::ffff:(10|127)\./i,
];

let proxyHopsInUse = 0;
let warnedPrivateIp = false;

/** Called once at startup so the guard knows whether we are behind proxies. */
export function setTrustedProxyHops(hops: number) {
  proxyHopsInUse = hops;
}

function ipKey(req: Request): string {
  // req.ip honours the app's "trust proxy" setting; ipKeyGenerator groups IPv6 by subnet.
  const ip = req.ip ?? "unknown";
  // Behind proxies, a private address here means TRUST_PROXY_HOPS no longer matches
  // the platform's proxy chain and all users may be sharing one counter.
  if (proxyHopsInUse > 0 && !warnedPrivateIp && PRIVATE_IP.some((r) => r.test(ip))) {
    warnedPrivateIp = true;
    console.warn(
      `rate-limit: client IP resolved to private address ${ip} with TRUST_PROXY_HOPS=${proxyHopsInUse}. ` +
        `The proxy chain may have changed; re-verify the hop count. X-Forwarded-For="${req.get("X-Forwarded-For") ?? ""}"`,
    );
  }
  return `ip:${ipKeyGenerator(ip)}`;
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
