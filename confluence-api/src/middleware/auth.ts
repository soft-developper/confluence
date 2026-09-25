import type { NextFunction, Request, Response } from "express";
import type { Db } from "../db/client.js";
import { sessionFromToken, type SessionInfo } from "../auth/service.js";

declare module "express-serve-static-core" {
  interface Request {
    session?: SessionInfo;
  }
}

/** Requires `Authorization: Bearer <session token>` (Stage 7a). */
export function requireAuth(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("Authorization") ?? "";
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    try {
      const s = await sessionFromToken(db, m?.[1]);
      if (!s) {
        res.status(401).json({ error: "unauthorized", message: "sign in first" });
        return;
      }
      req.session = s;
      next();
    } catch (e) {
      next(e);
    }
  };
}
