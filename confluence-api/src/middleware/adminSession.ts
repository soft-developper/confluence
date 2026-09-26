import type { NextFunction, Request, Response } from "express";
import { AdminAuthError, touchSession, type ActiveAdmin, type AdminDeps } from "../admin/service.js";

declare module "express-serve-static-core" {
  interface Request {
    admin?: ActiveAdmin;
  }
}

export const ADMIN_TOKEN_HEADER = "Authorization";

export function bearer(req: Request): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get("Authorization") ?? "");
  return m?.[1];
}

/** Requires a fully signed-in admin session (password + authenticator), 1 hour idle limit. */
export function requireAdminSession(d: AdminDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.admin = await touchSession(d, bearer(req));
      res.set("Cache-Control", "no-store");
      next();
    } catch (e) {
      if (e instanceof AdminAuthError) {
        res.status(e.status).json({ error: e.code, message: e.message });
        return;
      }
      next(e);
    }
  };
}
