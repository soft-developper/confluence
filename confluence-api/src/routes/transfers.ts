import { Router, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { idempotency } from "../middleware/idempotency.js";
import { createTransferRateLimit } from "../middleware/rateLimits.js";
import { STEP_NAMES, STEP_STATES, type StepName } from "../transfers/stateMachine.js";
import { createTransfer, getTransfer, recordStepReport, TransferError } from "../transfers/service.js";

/** Header carrying the secret report token returned by POST /transfers. */
export const REPORT_TOKEN_HEADER = "X-Transfer-Token";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an EVM address");
const uuid = z.uuid();
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex transaction hash");

const CreateBody = z.object({
  quoteId: uuid,
  sender: address,
});

// The SDK uses camelCase step names (burn, fetchAttestation); its docs also show
// capitalized examples (Burn, FetchAttestation). Accept either, store camelCase.
const stepByLower = new Map<string, StepName>(STEP_NAMES.map((s) => [s.toLowerCase(), s]));
const stepName = z
  .string()
  .max(32)
  .transform((s, ctx) => {
    const v = stepByLower.get(s.toLowerCase());
    if (!v) {
      ctx.addIssue({ code: "custom", message: `unknown step; expected one of ${STEP_NAMES.join(", ")}` });
      return z.NEVER;
    }
    return v;
  });

const EventBody = z.object({
  step: stepName,
  state: z.enum(STEP_STATES),
  txHash: txHash.optional(),
  errorCategory: z.string().regex(/^[a-z_]{1,64}$/).optional(),
  errorMessage: z.string().max(500).optional(),
  forwarded: z.boolean().optional(),
  batched: z.boolean().optional(),
  warnings: z
    .array(z.object({ code: z.string().regex(/^[A-Z0-9_]{1,64}$/), message: z.string().max(300).optional() }))
    .max(10)
    .optional(),
});

function badRequest(res: Response, error: z.ZodError) {
  res.status(400).json({ error: "invalid_request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

function sendTransferError(res: Response, e: unknown): boolean {
  if (e instanceof TransferError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  return false;
}

export function transfersRouter(db: Db) {
  const router = Router();

  router.post(
    "/transfers",
    createTransferRateLimit((req) => (req.body as { sender?: unknown } | undefined)?.sender),
    idempotency(db, "transfers.create"),
    async (req, res, next) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      try {
        // idempotency() already rejected a missing or malformed key
        const idempotencyKey = req.get("Idempotency-Key") as string;
        res.status(201).json(await createTransfer(db, { ...parsed.data, idempotencyKey }));
      } catch (e) {
        if (!sendTransferError(res, e)) next(e);
      }
    },
  );

  router.post("/transfers/:id/events", async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "transfer_not_found", message: "transfer not found or token invalid" });
      return;
    }
    const parsed = EventBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    try {
      res.status(200).json(await recordStepReport(db, id.data, req.get(REPORT_TOKEN_HEADER), parsed.data));
    } catch (e) {
      if (!sendTransferError(res, e)) next(e);
    }
  });

  router.get("/transfers/:id", async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "transfer_not_found", message: "transfer not found" });
      return;
    }
    try {
      res.status(200).json(await getTransfer(db, id.data));
    } catch (e) {
      if (!sendTransferError(res, e)) next(e);
    }
  });

  return router;
}
