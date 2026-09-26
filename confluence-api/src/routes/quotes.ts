import { Router } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { IrisClient } from "../circle/iris.js";
import type { Db } from "../db/client.js";
import { createQuote, QuoteError } from "../fees/quote.js";
import { quoteRateLimit } from "../middleware/rateLimits.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an EVM address");

const QuoteBody = z.object({
  sourceChain: z.string().min(1).max(64),
  destinationChain: z.string().min(1).max(64),
  amount: z.string().min(1).max(24),
  sender: address,
  recipient: address.optional(),
  recipientId: z.string().min(1).max(40).optional(),
  speed: z.enum(["FAST", "SLOW"]),
  useForwarder: z.boolean(),
});

export function quotesRouter(db: Db, registry: ChainRegistry, iris: IrisClient) {
  const router = Router();
  router.post("/quotes", quoteRateLimit((req) => (req.body as { sender?: unknown } | undefined)?.sender), async (req, res, next) => {
    const parsed = QuoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      return;
    }
    try {
      res.status(201).json(await createQuote(db, registry, iris, parsed.data));
    } catch (e) {
      if (e instanceof QuoteError) {
        res.status(e.status).json({ error: e.code, message: e.message });
        return;
      }
      next(e);
    }
  });
  return router;
}
