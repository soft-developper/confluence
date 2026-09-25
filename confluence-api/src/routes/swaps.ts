import { Router, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { idempotency } from "../middleware/idempotency.js";
import { userRateLimit } from "../middleware/rateLimits.js";
import { createSwap, getSwap, recordSwapReport, swapFee, SwapError } from "../swaps/service.js";
import type { SwapRegistry } from "../swaps/tokens.js";
import { REPORT_TOKEN_HEADER } from "./transfers.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an EVM address");
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex transaction hash");
const amount = z.string().regex(/^\d{1,18}(\.\d{1,18})?$/, "must be a positive decimal");
const token = z.enum(["USDC", "EURC", "USDT", "NATIVE"]);
const uuid = z.uuid();

const FeeBody = z.object({ chain: z.string().max(64), token, amount });
const CreateBody = z.object({
  chain: z.string().max(64),
  sender: address,
  recipient: address.optional(),
  tokenIn: token,
  tokenOut: token,
  amountIn: amount,
});
const EventBody = z.discriminatedUnion("step", [
  z.object({ step: z.literal("fee"), side: z.enum(["input", "output"]), token, amount }),
  z.object({ step: z.literal("estimate"), estimatedOut: amount, minOut: amount }),
  z.object({ step: z.literal("approval"), txHash }),
  z.object({ step: z.literal("swap"), txHash }),
  z.object({
    step: z.literal("result"),
    status: z.enum(["DONE", "FAILED", "PENDING", "NOT_FOUND"]),
    amountOut: amount.optional(),
    developerFee: amount.optional(),
  }),
  z.object({
    step: z.literal("error"),
    errorCategory: z.string().regex(/^[a-z_]{1,64}$/).optional(),
    errorMessage: z.string().max(500).optional(),
  }),
]);

function badRequest(res: Response, error: z.ZodError) {
  res.status(400).json({ error: "invalid_request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}
function sendSwapError(res: Response, e: unknown): boolean {
  if (e instanceof SwapError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  return false;
}

export function swapsRouter(db: Db, reg: SwapRegistry) {
  const router = Router();

  /** Chains and tokens swaps support in this environment (from App Kit). */
  router.get("/swaps/chains", (_req, res) => {
    res.json({ chains: reg.chains });
  });

  /** Stateless fee for estimates (App Kit computeFee before a swap row exists). */
  router.post("/swaps/fee", userRateLimit({ name: "swap-fee", limit: 120, identify: () => undefined }), (req, res) => {
    const parsed = FeeBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    try {
      const f = swapFee(reg, parsed.data);
      res.json({ token: f.token, fee: f.fee, rule: f.rule });
    } catch (e) {
      if (!sendSwapError(res, e)) throw e;
    }
  });

  router.post(
    "/swaps",
    userRateLimit({ name: "swap-create", limit: 10, identify: (req) => (req.body as { sender?: unknown } | undefined)?.sender }),
    idempotency(db, "swaps.create"),
    async (req, res, next) => {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      try {
        res.status(201).json(await createSwap(db, reg, { ...parsed.data, idempotencyKey: req.get("Idempotency-Key") as string }));
      } catch (e) {
        if (!sendSwapError(res, e)) next(e);
      }
    },
  );

  router.post("/swaps/:id/events", async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "swap_not_found", message: "swap not found or token invalid" });
      return;
    }
    const parsed = EventBody.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    try {
      res.json(await recordSwapReport(db, reg, id.data, req.get(REPORT_TOKEN_HEADER), parsed.data));
    } catch (e) {
      if (!sendSwapError(res, e)) next(e);
    }
  });

  router.get("/swaps/:id", async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "swap_not_found", message: "swap not found" });
      return;
    }
    try {
      res.json(await getSwap(db, id.data));
    } catch (e) {
      if (!sendSwapError(res, e)) next(e);
    }
  });

  return router;
}
