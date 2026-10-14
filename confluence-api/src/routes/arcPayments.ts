import { Router, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { idempotency } from "../middleware/idempotency.js";
import { userRateLimit } from "../middleware/rateLimits.js";
import { ArcPayError, createArcPayment, getArcPayment, NOTE_MAX, recordArcPaymentReport } from "../arcPay/service.js";
import { REPORT_TOKEN_HEADER } from "./transfers.js";

/** Pay by Confluence ID on Arc (confluence:arc-pay). */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an EVM address");
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex transaction hash");

const CreateBody = z
  .object({
    sender: address,
    recipientId: z.string().min(1).max(40),
    amount: z.string().regex(/^[0-9]{1,15}(\.[0-9]{1,6})?$/, "must be a USDC amount with at most 6 decimals"),
    note: z.string().max(NOTE_MAX * 4).optional(),
  })
  .strict();

const ReportBody = z
  .object({
    step: z.enum(["fee", "payment"]),
    state: z.enum(["success", "error"]),
    txHash: txHash.optional(),
    errorMessage: z.string().max(500).optional(),
  })
  .strict();

function send(res: Response, e: unknown): boolean {
  if (e instanceof ArcPayError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  return false;
}

export function arcPaymentsRouter(db: Db, registry: ChainRegistry) {
  const router = Router();
  const uuid = z.uuid();

  router.post(
    "/arc-payments",
    userRateLimit({ name: "arc-pay-create", limit: 10, identify: (req) => (req.body as { sender?: unknown } | undefined)?.sender }),
    idempotency(db, "arcPayments.create"),
    async (req, res, next) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        return;
      }
      try {
        res.status(201).json(await createArcPayment(db, registry, { ...parsed.data, idempotencyKey: req.get("Idempotency-Key") as string }));
      } catch (e) {
        if (!send(res, e)) next(e);
      }
    },
  );

  router.post("/arc-payments/:id/events", async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "payment_not_found", message: "payment not found or token invalid" });
      return;
    }
    const parsed = ReportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      return;
    }
    try {
      res.json(await recordArcPaymentReport(db, id.data, req.get(REPORT_TOKEN_HEADER), parsed.data));
    } catch (e) {
      if (!send(res, e)) next(e);
    }
  });

  router.get("/arc-payments/:id", async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "payment_not_found", message: "payment not found" });
      return;
    }
    try {
      res.json(await getArcPayment(db, id.data));
    } catch (e) {
      if (!send(res, e)) next(e);
    }
  });

  return router;
}
