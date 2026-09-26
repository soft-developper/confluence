import { Router, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { AccountError, claimId, getAccount, getBook, history, idAvailability, lookupId, mergeBook, BOOK_MAX } from "../accounts/service.js";
import { AuthError, issueNonce, revokeAllSessions, revokeSession, verifySignIn } from "../auth/service.js";
import { requireAuth } from "../middleware/auth.js";
import { userRateLimit } from "../middleware/rateLimits.js";

const VerifyBody = z.object({
  message: z.string().min(50).max(2000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20000),
});
const ClaimBody = z.object({ handle: z.string().min(1).max(40) });
const iso = z.string().max(40);
const BookBody = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        label: z.string().max(80),
        createdAt: iso,
        updatedAt: iso,
        deletedAt: iso.nullable().optional(),
      }),
    )
    .max(BOOK_MAX),
});

function fail(res: Response, e: unknown): boolean {
  if (e instanceof AuthError || e instanceof AccountError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  return false;
}
function badRequest(res: Response, error: z.ZodError) {
  res.status(400).json({ error: "invalid_request", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

export function accountRouter(db: Db, config: Config, registry: ChainRegistry) {
  const router = Router();
  const auth = requireAuth(db);
  const ipLimit = (name: string, limit: number) => userRateLimit({ name, limit, identify: () => undefined });

  // ---- Sign-In with Ethereum ----
  router.get("/auth/nonce", ipLimit("auth-nonce", 30), async (_req, res, next) => {
    try {
      res.set("Cache-Control", "no-store").json(await issueNonce(db));
    } catch (e) {
      next(e);
    }
  });
  router.post("/auth/verify", ipLimit("auth-verify", 20), async (req, res, next) => {
    const p = VerifyBody.safeParse(req.body);
    if (!p.success) return badRequest(res, p.error);
    try {
      res.json(await verifySignIn(db, config, registry, { message: p.data.message, signature: p.data.signature as `0x${string}` }));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });
  router.post("/auth/signout", auth, async (req, res, next) => {
    try {
      await revokeSession(db, req.session!.sessionId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  router.post("/auth/signout-all", auth, async (req, res, next) => {
    try {
      await revokeAllSessions(db, req.session!.address);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---- the signed-in account ----
  router.get("/me", auth, async (req, res, next) => {
    try {
      res.json(await getAccount(db, req.session!.address));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });
  router.post("/me/id", auth, async (req, res, next) => {
    const p = ClaimBody.safeParse(req.body);
    if (!p.success) return badRequest(res, p.error);
    try {
      res.json(await claimId(db, req.session!.address, p.data.handle));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });
  router.get("/me/history", auth, async (req, res, next) => {
    // Numbered pages of 20 (Stage: pagination). ?page=1 is the newest.
    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 100_000) {
      res.status(400).json({ error: "invalid_request", message: "page must be a positive whole number" });
      return;
    }
    try {
      res.json(await history(db, req.session!.address, { page }));
    } catch (e) {
      next(e);
    }
  });
  router.get("/me/address-book", auth, async (req, res, next) => {
    try {
      res.json({ entries: await getBook(db, req.session!.address) });
    } catch (e) {
      next(e);
    }
  });
  router.put("/me/address-book", auth, async (req, res, next) => {
    const p = BookBody.safeParse(req.body);
    if (!p.success) return badRequest(res, p.error);
    try {
      res.json({ entries: await mergeBook(db, req.session!.address, p.data.entries) });
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  // ---- public Confluence ID lookups ----
  router.get("/ids/:handle/availability", ipLimit("id-check", 120), async (req, res, next) => {
    try {
      res.json(await idAvailability(db, String(req.params.handle)));
    } catch (e) {
      next(e);
    }
  });
  router.get("/ids/:handle", ipLimit("id-lookup", 120), async (req, res, next) => {
    try {
      res.json(await lookupId(db, String(req.params.handle)));
    } catch (e) {
      if (!fail(res, e)) next(e);
    }
  });

  return router;
}
