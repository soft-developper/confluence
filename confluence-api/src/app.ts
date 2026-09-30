import express from "express";
import cors from "cors";
import { ipRateLimit, setTrustedProxyHops } from "./middleware/rateLimits.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { healthRouter } from "./routes/health.js";
import { chainsRouter } from "./routes/chains.js";
import { quotesRouter } from "./routes/quotes.js";
import { feesRouter } from "./routes/fees.js";
import { REPORT_TOKEN_HEADER, transfersRouter } from "./routes/transfers.js";
import { swapsRouter } from "./routes/swaps.js";
import { accountRouter } from "./routes/account.js";
import { siteRouter } from "./routes/site.js";
import { adminRouter } from "./routes/admin.js";
import { adminDataRouter } from "./routes/adminData.js";
import { relayRouter } from "./routes/relay.js";
import { relayUpstreamFor, type RelayUpstream, relayReferrer } from "./relay/upstream.js";
import { maintenanceGuard } from "./site/maintenance.js";
import { createEmailSender } from "./email/resend.js";
import { buildSwapRegistry, type SwapRegistry } from "./swaps/tokens.js";
import type { IrisClient } from "./circle/iris.js";
import type { ChainRegistry } from "./chains/registry.js";

export function createApp(
  config: Config,
  db: Db,
  registry: ChainRegistry,
  iris: IrisClient,
  swapRegistry: SwapRegistry = buildSwapRegistry(config),
  relayUpstream: RelayUpstream = relayUpstreamFor(config),
) {
  const app = express();
  app.disable("x-powered-by");
  // JSON only: browsers must never guess another content type (confluence:api-errors).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  setTrustedProxyHops(config.TRUST_PROXY_HOPS);

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
      methods: ["GET", "POST", "PUT", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Idempotency-Key", REPORT_TOKEN_HEADER, "Authorization", "relay-sdk-version"],
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(ipRateLimit());
  app.use(
    express.json({
      limit: "100kb",
      // Relay signs the exact webhook bytes (R3b), so keep them for that one route.
      verify: (req, _res, buf) => {
        if ((req as { url?: string }).url === "/relay-webhook") (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(maintenanceGuard(db));
  app.use(healthRouter(config, db));
  app.use(chainsRouter(config, registry, db));
  app.use(quotesRouter(db, registry, iris));
  app.use(feesRouter());
  app.use(transfersRouter(db));
  app.use(swapsRouter(db, swapRegistry));
  app.use(accountRouter(db, config, registry));
  app.use(siteRouter(db));
  // Relay attribution uses the public app's domain (https://docs.relay.link/references/relay-kit/sdk/createClient),
  // never the admin site's: ADMIN_WEB_ORIGIN now points at the separate admin dashboard.
  app.use(relayRouter(db, registry, relayUpstream, relayReferrer(config), config.RELAY_API_KEY));
  const adminDeps = {
    db,
    secretKey: config.ADMIN_SECRET_KEY,
    webOrigin: config.ADMIN_WEB_ORIGIN ?? config.CORS_ORIGINS[0]!,
    sendEmail: createEmailSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM }),
  };
  app.use(adminRouter(adminDeps));
  app.use(adminDataRouter(adminDeps, registry, relayUpstream));
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use(apiErrorHandler);
  return app;
}

/**
 * Last-resort error handler (confluence:api-errors). Without it Express answers with its
 * built-in HTML page, which includes the stack trace unless NODE_ENV=production. Every
 * error now gets a short JSON body with no internals; 5xx details go to the server log only.
 * Body-parser error types: https://github.com/expressjs/body-parser#errors
 */
const PARSER_ERRORS: Record<string, string> = {
  "entity.parse.failed": "invalid_json",
  "entity.too.large": "payload_too_large",
  "encoding.unsupported": "unsupported_encoding",
  "charset.unsupported": "unsupported_charset",
  "request.aborted": "request_aborted",
  "request.size.invalid": "invalid_request_size",
  "entity.verify.failed": "invalid_request",
};

export const apiErrorHandler: express.ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const e = (err ?? {}) as { type?: unknown; status?: unknown; statusCode?: unknown };
  const raw = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : 500;
  const status = raw >= 400 && raw < 600 ? raw : 500;
  if (status >= 500) {
    console.error(`api: unhandled error on ${req.method} ${req.path}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    res.status(status).json({ error: "internal_error" });
    return;
  }
  const code = typeof e.type === "string" ? PARSER_ERRORS[e.type] : undefined;
  res.status(status).json({ error: code ?? "bad_request" });
};
