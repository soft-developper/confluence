import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { AdminDeps } from "../admin/service.js";
import { activity, overview, problems, RANGES, routes, timeseries, treasury } from "../admin/analytics.js";
import { securityEmail } from "../email/resend.js";
import { requireAdminSession } from "../middleware/adminSession.js";
import { saveFooter } from "../site/footer.js";
import { effective, getMaintenance, SetSwitchBody, setMaintenance } from "../site/maintenance.js";
import { getHousekeeping, PRUNE_AFTER_MS } from "../housekeeping/pruneFailed.js";
import { getDisabledChains, setChainEnabled } from "../chains/availability.js";
import { sql } from "drizzle-orm";
import { relayOverview } from "../relay/adminOverview.js";
import type { RelayUpstream } from "../relay/upstream.js";
import { appFeeRecipient, getRelaySettings, MAX_APP_FEE_BPS, SaveRelaySettingsBody, saveRelaySettings } from "../relay/settings.js";

/** Admin dashboard data and controls (A2). Every route needs a fully signed-in admin. */
export function adminDataRouter(d: AdminDeps, registry: ChainRegistry, relayUpstream?: RelayUpstream) {
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
      res.json({ ...m, status: effective(m.state), housekeeping: { ...(await getHousekeeping(d.db)), pruneAfterHours: PRUNE_AFTER_MS / 3_600_000 } });
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

  // ---- bridge chains: take a chain out of the bridge, or put it back ----
  router.get(
    "/admin/chains",
    active,
    handle(async (_req, res) => {
      const disabled = new Map((await getDisabledChains(d.db)).map((x) => [x.id, x]));
      const t0 = Date.now() - 30 * 86_400_000;
      const usage = (await d.db.all(
        sql`select chain, sum(src) as asSource, sum(dst) as asDestination from (
              select source_chain as chain, 1 as src, 0 as dst from transfers where created_at >= ${t0}
              union all select destination_chain, 0, 1 from transfers where created_at >= ${t0}) group by chain`,
      )) as { chain: string; asSource: number; asDestination: number }[];
      const inflight = (await d.db.all(
        sql`select chain, count(*) as n from (
              select source_chain as chain from transfers where state not in ('COMPLETED','FAILED')
              union all select destination_chain from transfers where state not in ('COMPLETED','FAILED')) group by chain`,
      )) as { chain: string; n: number }[];
      const u = new Map(usage.map((r) => [r.chain, r]));
      const f = new Map(inflight.map((r) => [r.chain, Number(r.n)]));
      res.json({
        chains: registry.chains.map((c) => ({
          id: c.id,
          name: c.name,
          evmChainId: c.evmChainId,
          cctpDomain: c.cctpDomain,
          fast: !!c.speed?.fast,
          forwarding: !!c.forwarderAsDestination,
          enabled: !disabled.has(c.id),
          disabledAt: disabled.get(c.id)?.at ?? null,
          disabledBy: disabled.get(c.id)?.by ?? null,
          last30d: { asSource: Number(u.get(c.id)?.asSource ?? 0), asDestination: Number(u.get(c.id)?.asDestination ?? 0) },
          inFlight: f.get(c.id) ?? 0,
        })),
      });
    }),
  );
  router.put(
    "/admin/chains/:id",
    active,
    handle(async (req, res) => {
      const id = String(req.params.id);
      const chain = registry.byId.get(id);
      if (!chain) {
        res.status(404).json({ error: "chain_not_found", message: "no such bridge chain" });
        return;
      }
      const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
      await setChainEnabled(d.db, id, enabled, req.admin!.email);
      const e = securityEmail(`${chain.name} ${enabled ? "added back to" : "removed from"} the bridge`, [
        `Changed by ${req.admin!.email} at ${new Date().toUTCString()}.`,
        "Transfers already in flight are not affected.",
      ]);
      void d.sendEmail({ to: req.admin!.email, subject: `Confluence: ${chain.name} ${enabled ? "enabled" : "disabled"} for bridging`, ...e });
      res.json({ id, enabled });
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
          page: z.coerce.number().int().min(1).max(100_000).default(1),
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

  // ---- Relay (relay.link) routes: on or off, and Confluence's app fee in bps (R1) ----
  router.get(
    "/admin/relay",
    active,
    handle(async (_req, res) => {
      const r = await getRelaySettings(d.db);
      res.json({ ...r, maxAppFeeBps: MAX_APP_FEE_BPS, appFeeRecipient: await appFeeRecipient(d.db, registry) });
    }),
  );
  router.put(
    "/admin/relay",
    active,
    handle(async (req, res) => {
      const body = SaveRelaySettingsBody.parse(req.body);
      const before = (await getRelaySettings(d.db)).settings;
      const out = await saveRelaySettings(d.db, body, req.admin!.email);
      const changes = [
        ...(before.enabled !== out.settings.enabled ? [`Relay routes: ${out.settings.enabled ? "ON" : "OFF"}`] : []),
        ...(before.appFeeBps !== out.settings.appFeeBps ? [`App fee: ${before.appFeeBps} bps -> ${out.settings.appFeeBps} bps`] : []),
      ];
      if (changes.length) {
        const e = securityEmail("Relay settings changed", [`Changed by ${req.admin!.email} at ${new Date().toUTCString()}.`, ...changes]);
        void d.sendEmail({ to: req.admin!.email, subject: "Confluence: Relay settings changed", ...e });
      }
      res.json({ ...out, appFeeRecipient: await appFeeRecipient(d.db, registry) });
    }),
  );

  router.get(
    "/admin/relay/overview",
    active,
    handle(async (_req, res) => {
      const recipient = await appFeeRecipient(d.db, registry);
      res.json({ ...(await relayOverview(d.db, relayUpstream ?? ({ configured: false } as RelayUpstream), recipient)), recipient, configured: !!relayUpstream?.configured });
    }),
  );

  return router;
}
