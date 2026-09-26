import { Router } from "express";
import type { Db } from "../db/client.js";
import { getFooter } from "../site/footer.js";
import { effective, getMaintenance } from "../site/maintenance.js";

export function siteRouter(db: Db) {
  const router = Router();

  // Public: the web footer reads this on every page (cached briefly by browsers and CDNs).
  router.get("/site/footer", async (_req, res, next) => {
    try {
      res.set("Cache-Control", "public, max-age=60").json(await getFooter(db));
    } catch (e) {
      next(e);
    }
  });

  // Public: which parts are online, and the maintenance message users should see.
  router.get("/site/status", async (_req, res, next) => {
    try {
      const m = await getMaintenance(db);
      res.set("Cache-Control", "public, max-age=15").json({ ...effective(m.state), updatedAt: m.updatedAt });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
