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
) {
  const app = express();
  app.disable("x-powered-by");
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
      allowedHeaders: ["Content-Type", "Idempotency-Key", REPORT_TOKEN_HEADER, "Authorization"],
      credentials: false,
      maxAge: 600,
    }),
  );

  app.use(ipRateLimit());
  app.use(express.json({ limit: "100kb" }));
  app.use(healthRouter(config, db));
  app.use(chainsRouter(config, registry));
  app.use(quotesRouter(db, registry, iris));
  app.use(feesRouter());
  app.use(transfersRouter(db));
  app.use(swapsRouter(db, swapRegistry));
  app.use(accountRouter(db, config, registry));
  app.use(siteRouter(db, config));
  app.use(
    adminRouter({
      db,
      secretKey: config.ADMIN_SECRET_KEY,
      webOrigin: config.ADMIN_WEB_ORIGIN ?? config.CORS_ORIGINS[0]!,
      sendEmail: createEmailSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM }),
    }),
  );
  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  return app;
}
