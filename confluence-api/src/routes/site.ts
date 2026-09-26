import { Router } from "express";
import { ZodError } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { requireAdmin } from "../middleware/admin.js";
import { requireAuth } from "../middleware/auth.js";
import { getFooter, saveFooter } from "../site/footer.js";

export function siteRouter(db: Db, config: Config) {
  const router = Router();

  // Public: the web footer reads this on every page (cached briefly by browsers and CDNs).
  router.get("/site/footer", async (_req, res, next) => {
    try {
      res.set("Cache-Control", "public, max-age=60").json(await getFooter(db));
    } catch (e) {
      next(e);
    }
  });

  // Admin dashboard: replace the footer content (validated, https links only).
  router.put("/admin/site/footer", requireAuth(db), requireAdmin(config.ADMIN_ADDRESSES), async (req, res, next) => {
    try {
      res.json(await saveFooter(db, req.body, req.session!.address));
    } catch (e) {
      if (e instanceof ZodError) {
        res.status(400).json({ error: "invalid_request", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        return;
      }
      next(e);
    }
  });

  return router;
}
