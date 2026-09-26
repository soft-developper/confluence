import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { siteSettings } from "../db/schema.js";

/**
 * Maintenance switches (A2). Bridge, Swap, or everything can be taken offline with a
 * message and an optional expected-back time. Only NEW bridges and swaps are refused;
 * in-flight work (step reports, the tracker, transaction pages, recovery) keeps working.
 * The switch never turns itself back on.
 */
export const PROTOCOLS = ["bridge", "swap"] as const;
export type Protocol = (typeof PROTOCOLS)[number];
export type Scope = Protocol | "all";

const Switch = z
  .object({
    offline: z.boolean(),
    message: z.string().trim().max(280).nullable().default(null),
    expectedBack: z.string().datetime().nullable().default(null),
  })
  .strict();
type SwitchState = z.infer<typeof Switch>;
const OFF: SwitchState = { offline: false, message: null, expectedBack: null };

const StoredSchema = z
  .object({ bridge: Switch.default(OFF), swap: Switch.default(OFF), all: Switch.default(OFF) })
  .strict();
export type MaintenanceState = z.infer<typeof StoredSchema>;
const KEY = "maintenance";

export async function getMaintenance(db: Db): Promise<{ state: MaintenanceState; updatedAt: string | null; updatedBy: string | null }> {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  const parsed = row ? StoredSchema.safeParse(row.value) : null;
  return {
    state: parsed?.success ? parsed.data : StoredSchema.parse({}),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/** What users see: each protocol is offline if its own switch or "all" is on. */
export function effective(state: MaintenanceState) {
  const one = (p: Protocol) => {
    const own = state[p];
    const all = state.all;
    const offline = own.offline || all.offline;
    const src = own.offline ? own : all; // a protocol's own message wins when both are on
    return { online: !offline, message: offline ? src.message : null, expectedBack: offline ? src.expectedBack : null };
  };
  return { bridge: one("bridge"), swap: one("swap") };
}

export const SetSwitchBody = z
  .object({
    scope: z.enum(["bridge", "swap", "all"]),
    offline: z.boolean(),
    message: z.string().trim().max(280).optional(),
    expectedBack: z.string().datetime().optional(),
  })
  .strict();

export async function setMaintenance(db: Db, input: z.infer<typeof SetSwitchBody>, by: string) {
  const { state } = await getMaintenance(db);
  state[input.scope] = input.offline
    ? { offline: true, message: input.message || null, expectedBack: input.expectedBack ?? null }
    : { ...OFF };
  const now = new Date();
  await db
    .insert(siteSettings)
    .values({ key: KEY, value: state, updatedBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: state, updatedBy: by, updatedAt: now } });
  cache = null;
  return { state, status: effective(state), updatedAt: now.toISOString() };
}

// ---------- enforcement ----------

/** Requests that START new work. Everything else (reports, reads, recovery) is never blocked. */
const GUARDED: { method: string; path: string; protocol: Protocol }[] = [
  { method: "POST", path: "/quotes", protocol: "bridge" },
  { method: "POST", path: "/transfers", protocol: "bridge" },
  { method: "POST", path: "/swaps", protocol: "swap" },
  { method: "POST", path: "/swaps/fee", protocol: "swap" },
];

// A few seconds of caching keeps this off the database on every request; switching
// takes effect within CACHE_MS on each API instance (immediately on the one that saved it).
const CACHE_MS = 5_000;
let cache: { at: number; status: ReturnType<typeof effective> } | null = null;

async function currentStatus(db: Db) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.status;
  const status = effective((await getMaintenance(db)).state);
  cache = { at: Date.now(), status };
  return status;
}

export function maintenanceGuard(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const g = GUARDED.find((x) => x.method === req.method && x.path === req.path);
    if (!g) return next();
    try {
      const s = (await currentStatus(db))[g.protocol];
      if (s.online) return next();
      res.status(503).json({
        error: "maintenance",
        protocol: g.protocol,
        message: s.message ?? `${g.protocol === "bridge" ? "Bridging" : "Swapping"} is temporarily offline for maintenance.`,
        expectedBack: s.expectedBack,
      });
    } catch (e) {
      next(e); // cannot read the switch (database down): let the normal error path answer
    }
  };
}

export function resetMaintenanceCache() {
  cache = null;
}
