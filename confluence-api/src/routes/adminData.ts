import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { AdminDeps } from "../admin/service.js";
import { activity, overview, problems, RANGES, routes, timeseries, treasury } from "../admin/analytics.js";
import { securityEmail } from "../email/resend.js";
import { requireAdminSession } from "../middleware/adminSession.js";
import { saveFooter } from "../site/footer.js";
import { effective, getMaintenance, SetSwitchBody, setMaintenance } from "../site/maintenance.js";

/** Admin dashboard data and controls (A2). Every route needs a fully signed-in admin. */
export function adminDataRouter(d: AdminDeps, registry: ChainRegistry) {
  const router = Router();
  const active = requireAdminSession(d);
  const Range = z.enum(Object.keys(RANGES) as [keyof typeof RANGES, ...(keyof typeof RANGES)[]]);

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response, next: (e?: unknown) => void) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof z.ZodError) {
          res.status(400).json({ error: "invalid_request", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
          return;
        }
        next(e);
      }
    };

  // ---- maintenance switches ----
  router.get(
    "/admin/maintenance",
    active,
    handle(async (_req, res) => {
      const m = await getMaintenance(d.db);
      res.json({ ...m, status: effective(m.state) });
    }),
  );
  router.put(
    "/admin/maintenance",
    active,
    handle(async (req, res) => {
      const body = SetSwitchBody.parse(req.body);
      const out = await setMaintenance(d.db, body, req.admin!.email);
      const label = body.scope === "all" ? "Everything (Bridge and Swap)" : body.scope === "bridge" ? "Bridge" : "Swap";
      const e = securityEmail(`${label} is now ${body.offline ? "OFFLINE" : "back ONLINE"}`, [
        `Changed by ${req.admin!.email} at ${new Date().toUTCString()}.`,
        ...(body.offline && body.message ? [`Message shown to users: "${body.message}"`] : []),
        ...(body.offline && body.expectedBack ? [`Expected back: ${new Date(body.expectedBack).toUTCString()}`] : []),
        "In-flight bridges and swaps are not affected.",
      ]);
      void d.sendEmail({ to: req.admin!.email, subject: `Confluence: ${label} ${body.offline ? "offline" : "online"}`, ...e });
      res.json(out);
    }),
  );

  // ---- footer editor (moved from the wallet allowlist to admin sessions) ----
  router.put(
    "/admin/site/footer",
    active,
    handle(async (req, res) => {
      res.json(await saveFooter(d.db, req.body, req.admin!.email));
    }),
  );

  // ---- analytics ----
  router.get(
    "/admin/analytics/overview",
    active,
    handle(async (req, res) => {
      res.json(await overview(d.db, Range.parse(req.query.range ?? "7d")));
    }),
  );
  router.get(
    "/admin/analytics/timeseries",
    active,
    handle(async (req, res) => {
      const r = z.enum(["7d", "30d", "90d"]).parse(req.query.range ?? "30d");
      res.json(await timeseries(d.db, r));
    }),
  );
  router.get(
    "/admin/analytics/routes",
    active,
    handle(async (req, res) => {
      res.json(await routes(d.db, Range.parse(req.query.range ?? "30d")));
    }),
  );
  router.get(
    "/admin/activity",
    active,
    handle(async (req, res) => {
      const q = z
        .object({
          q: z.string().max(100).optional(),
          kind: z.enum(["bridge", "swap"]).optional(),
          state: z.string().regex(/^[A-Z_]{3,30}$/).optional(),
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(req.query);
      res.json(await activity(d.db, q));
    }),
  );
  router.get(
    "/admin/problems",
    active,
    handle(async (_req, res) => {
      res.json(await problems(d.db));
    }),
  );
  router.get(
    "/admin/treasury",
    active,
    handle(async (_req, res) => {
      res.json(await treasury(d.db, registry));
    }),
  );

  return router;
}
