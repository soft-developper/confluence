import { Router, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { userRateLimit } from "../middleware/rateLimits.js";
import { activity, listSavedIds, monthStart, PayError, payTotals, removeSavedId, resumeArcPayment, saveId } from "../arcPay/activity.js";

/** Signed-in Pay page data (confluence:arc-pay): Activity, totals, finish payment, Saved IDs. */
const HandleBody = z.object({ handle: z.string().min(1).max(40) }).strict();

function fail(res: Response, e: unknown): boolean {
  if (e instanceof PayError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  return false;
}

export function payRouter(db: Db) {
  const router = Router();
  const auth = requireAuth(db);
  const writes = userRateLimit({ name: "pay-writes", limit: 30, identify: () => undefined });
  const uuid = z.uuid();

  router.get("/me/pay/activity", auth, async (req, res, next) => {
    const direction = req.query.direction === "received" ? "received" : req.query.direction === "sent" ? "sent" : null;
    const page = Number(req.query.page ?? 1);
    if (!direction || !Number.isInteger(page) || page < 1 || page > 100_000) {
      res.status(400).json({ error: "invalid_request", message: "direction must be sent or received, and page a positive whole number" });
      return;
    }
    try {
      res.set("Cache-Control", "no-store").json(await activity(db, req.session!.address, { direction, page }));
    } catch (e) {
      next(e);
    }
  });

  router.get("/me/pay/totals", auth, async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await payTotals(db, req.session!.address, monthStart()));
    } catch (e) {
      next(e);
    }
  });

  router.post("/me/arc-payments/:id/resume", auth, writes, async (req, res, next) => {
    const id = uuid.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "payment_not_found", message: "payment not found" });
      return;
    }
    try {
      res.json(await resumeArcPayment(db, req.session!.address, id.data));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  router.get("/me/saved-ids", auth, async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json({ ids: await listSavedIds(db, req.session!.address) });
    } catch (e) {
      next(e);
    }
  });
  router.post("/me/saved-ids", auth, writes, async (req, res, next) => {
    const p = HandleBody.safeParse(req.body);
    if (!p.success) {
      res.status(400).json({ error: "invalid_request", message: "handle is required" });
      return;
    }
    try {
      res.json({ ids: await saveId(db, req.session!.address, p.data.handle) });
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });
  // POST, not DELETE: the CORS allowlist only permits GET, POST and PUT.
  router.post("/me/saved-ids/remove", auth, writes, async (req, res, next) => {
    const p = HandleBody.safeParse(req.body);
    if (!p.success) {
      res.status(400).json({ error: "invalid_request", message: "handle is required" });
      return;
    }
    try {
      res.json({ ids: await removeSavedId(db, req.session!.address, p.data.handle) });
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  return router;
}
