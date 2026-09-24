import { Router } from "express";
import { z } from "zod";
import { formatUsdc } from "../lib/usdc.js";
import { maxAmountForBalance } from "../fees/platformFee.js";

const Query = z.object({ balance: z.string().regex(/^\d{1,20}$/, "balance must be USDC base units (integer)") });

/** Fee helpers that must stay server-side (the fee rule lives only in the API). */
export function feesRouter() {
  const router = Router();
  // GET /fees/max-amount?balance=<base units> -> largest amount whose amount + platform fee fits the balance
  router.get("/fees/max-amount", (req, res) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: parsed.error.issues[0]?.message });
      return;
    }
    const max = maxAmountForBalance(BigInt(parsed.data.balance));
    res.json({ maxAmount: { base: max.toString(), usdc: formatUsdc(max) } });
  });
  return router;
}
