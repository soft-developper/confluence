import { Router } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { IrisClient } from "../circle/iris.js";
import type { Db } from "../db/client.js";
import { createQuote, QuoteError } from "../fees/quote.js";
import { quoteRateLimit } from "../middleware/rateLimits.js";
import { RequestError, requestForQuote } from "../requests/service.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an EVM address");

const QuoteBody = z
  .object({
    sourceChain: z.string().min(1).max(64),
    // Optional when paying a request: the API takes them from the request.
    destinationChain: z.string().min(1).max(64).optional(),
    amount: z.string().min(1).max(24).optional(),
    sender: address,
    recipient: address.optional(),
    recipientId: z.string().min(1).max(40).optional(),
    // Stage 8b: pay a payment request (destination, recipient and amount come from it).
    requestId: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/).optional(),
    speed: z.enum(["FAST", "SLOW"]),
    useForwarder: z.boolean(),
  })
  .superRefine((b, ctx) => {
    if (b.requestId) {
      if (b.recipient || b.recipientId || b.amount || b.destinationChain) {
        ctx.addIssue({ code: "custom", message: "with requestId, send only sourceChain, sender, speed and useForwarder" });
      }
    } else {
      if (!b.destinationChain) ctx.addIssue({ code: "custom", path: ["destinationChain"], message: "required" });
      if (!b.amount) ctx.addIssue({ code: "custom", path: ["amount"], message: "required" });
    }
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
      const b = parsed.data;
      if (b.requestId) {
        const r = await requestForQuote(db, b.requestId);
        res.status(201).json(
          await createQuote(db, registry, iris, {
            sourceChain: b.sourceChain,
            destinationChain: r.destinationChain,
            amount: "0",
            sender: b.sender,
            speed: b.speed,
            useForwarder: b.useForwarder,
            request: r,
          }),
        );
        return;
      }
      res.status(201).json(await createQuote(db, registry, iris, { ...b, destinationChain: b.destinationChain!, amount: b.amount! }));
    } catch (e) {
      if (e instanceof RequestError) {
        res.status(e.status).json({ error: e.code, message: e.message });
        return;
      }
      if (e instanceof QuoteError) {
        res.status(e.status).json({ error: e.code, message: e.message });
        return;
      }
      next(e);
    }
  });
  return router;
}
