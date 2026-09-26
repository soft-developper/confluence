import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  AdminAuthError,
  beginTotpSetup,
  changePassword,
  confirmTotpSetup,
  IDLE_TIMEOUT_MS,
  login,
  logout,
  regenerateBackupCodes,
  requestPasswordReset,
  resetPassword,
  verifySecondFactor,
  type AdminDeps,
} from "../admin/service.js";
import { bearer, requireAdminSession } from "../middleware/adminSession.js";
import { userRateLimit } from "../middleware/rateLimits.js";

const Email = z.string().trim().email().max(254);
const Password = z.string().min(1).max(128);
const Code = z.string().trim().min(6).max(12);

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.get("User-Agent") };
}
function fail(res: Response, e: unknown): boolean {
  if (e instanceof AdminAuthError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return true;
  }
  if (e instanceof z.ZodError) {
    res.status(400).json({ error: "invalid_request", message: "check the form fields" });
    return true;
  }
  return false;
}

/** Admin auth endpoints under /admin/auth (A1). Everything is no-store and rate limited. */
export function adminRouter(d: AdminDeps) {
  const router = Router();
  const ipLimit = (name: string, limit: number) => userRateLimit({ name, limit, identify: () => undefined });
  const active = requireAdminSession(d);
  router.use("/admin", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response, next: (e?: unknown) => void) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (!fail(res, e)) next(e);
      }
    };

  router.post(
    "/admin/auth/login",
    ipLimit("admin-login", 10),
    handle(async (req, res) => {
      const b = z.object({ email: Email, password: Password }).parse(req.body);
      res.json(await login(d, b.email, b.password, meta(req)));
    }),
  );
  router.post(
    "/admin/auth/totp",
    ipLimit("admin-totp", 10),
    handle(async (req, res) => {
      const b = z.object({ code: Code }).parse(req.body);
      res.json({ ...(await verifySecondFactor(d, bearer(req), b.code, meta(req))), idleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000 });
    }),
  );
  router.post(
    "/admin/auth/totp/setup",
    ipLimit("admin-totp-setup", 10),
    handle(async (req, res) => {
      res.json(await beginTotpSetup(d, bearer(req)));
    }),
  );
  router.post(
    "/admin/auth/totp/confirm",
    ipLimit("admin-totp-confirm", 10),
    handle(async (req, res) => {
      const b = z.object({ code: Code }).parse(req.body);
      res.json({ ...(await confirmTotpSetup(d, bearer(req), b.code, meta(req))), idleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000 });
    }),
  );
  router.post(
    "/admin/auth/forgot",
    ipLimit("admin-forgot", 5),
    handle(async (req, res) => {
      const b = z.object({ email: Email }).parse(req.body);
      await requestPasswordReset(d, b.email, meta(req));
      res.json({ ok: true, message: "If that email belongs to the admin, a reset link is on its way." });
    }),
  );
  router.post(
    "/admin/auth/reset",
    ipLimit("admin-reset", 10),
    handle(async (req, res) => {
      const b = z.object({ token: z.string().min(20).max(100), password: Password }).parse(req.body);
      await resetPassword(d, b.token, b.password, meta(req));
      res.json({ ok: true });
    }),
  );

  // ---- signed in ----
  router.get(
    "/admin/me",
    active,
    handle(async (req, res) => {
      res.json({ email: req.admin!.email, idleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000 });
    }),
  );
  router.post(
    "/admin/auth/logout",
    active,
    handle(async (req, res) => {
      await logout(d, req.admin!.sessionId);
      res.json({ ok: true });
    }),
  );
  router.post(
    "/admin/auth/password",
    active,
    ipLimit("admin-password", 5),
    handle(async (req, res) => {
      const b = z.object({ currentPassword: Password, newPassword: Password, code: Code }).parse(req.body);
      await changePassword(d, req.admin!, b.currentPassword, b.newPassword, b.code, meta(req));
      res.json({ ok: true });
    }),
  );
  router.post(
    "/admin/auth/backup-codes",
    active,
    ipLimit("admin-backup", 5),
    handle(async (req, res) => {
      const b = z.object({ code: Code }).parse(req.body);
      res.json({ backupCodes: await regenerateBackupCodes(d, req.admin!, b.code) });
    }),
  );

  return router;
}
