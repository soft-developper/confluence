import type { NextFunction, Request, Response } from "express";

/**
 * Admin-only routes: after requireAuth (a signed-in wallet), the wallet must be listed in
 * ADMIN_ADDRESSES. Same 403 for every non-admin, so the list cannot be probed.
 */
export function requireAdmin(admins: readonly string[]) {
  const set = new Set(admins.map((a) => a.toLowerCase()));
  return (req: Request, res: Response, next: NextFunction) => {
    const who = req.session?.address?.toLowerCase();
    if (!who || !set.has(who)) {
      res.status(403).json({ error: "forbidden", message: "admin only" });
      return;
    }
    next();
  };
}
