import { Router, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { userRateLimit } from "../middleware/rateLimits.js";
import { cancelRequest, createRequest, getRequest, listMyRequests, MEMO_MAX, RequestError } from "../requests/service.js";

const CreateBody = z.object({
  destinationChain: z.string().min(1).max(64),
  amount: z.string().min(1).max(24),
  memo: z.string().max(MEMO_MAX * 2).optional(),
  expiresInDays: z.number().int().optional(),
});
const idParam = z.string().regex(/^[A-Za-z0-9_-]{16,32}$/);

function fail(res: Response, e: unknown) {
  if (e instanceof RequestError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  return false;
}

export function requestsRouter(db: Db, registry: ChainRegistry) {
  const router = Router();
  const auth = requireAuth(db);

  router.post("/requests", auth, userRateLimit({ name: "request-create", limit: 20, identify: (req) => req.session?.address }), async (req, res, next) => {
    const p = CreateBody.safeParse(req.body);
    if (!p.success) {
      res.status(400).json({ error: "invalid_request", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      return;
    }
    try {
      res.status(201).json(await createRequest(db, registry, req.session!.address, p.data));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  router.get("/me/requests", auth, async (req, res, next) => {
    try {
      res.json({ requests: await listMyRequests(db, req.session!.address) });
    } catch (e) {
      next(e);
    }
  });

  // Public: the pay page reads it. The id is unguessable (128 random bits).
  router.get("/requests/:id", userRateLimit({ name: "request-read", limit: 120, identify: () => undefined }), async (req, res, next) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "request_not_found", message: "payment request not found" });
      return;
    }
    try {
      res.json(await getRequest(db, id.data));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  router.post("/requests/:id/cancel", auth, async (req, res, next) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "request_not_found", message: "payment request not found" });
      return;
    }
    try {
      res.json(await cancelRequest(db, req.session!.address, id.data));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  return router;
}
