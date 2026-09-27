import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { quotes, siteSettings, swapEvents, swaps, transferEvents, transfers } from "../db/schema.js";

/**
 * Housekeeping: delete failed bridges and swaps that never reached the chain, 24 hours
 * after they failed, and quotes nobody used (see below). A record is pruned only when ALL
 * of these hold:
 *   - state is FAILED (never in-flight, never needs-recovery, never completed)
 *   - it has no transaction hash of any kind
 *       bridges: no burn and no mint transaction
 *       swaps:   no swap and no approval transaction
 *   - it became FAILED more than 24 hours ago (updated_at is set when the state changes)
 * Its events (and, for a bridge, its single-use quote) are deleted with it, in one
 * database batch per group, and every delete re-checks the same conditions, so a record
 * that changed meanwhile is left alone.
 */
export const PRUNE_AFTER_MS = 24 * 60 * 60_000;
export const PRUNE_BATCH = 200;
/** Cap per run so one pass never becomes a long database job. */
export const PRUNE_MAX_PER_RUN = 5_000;

export interface PruneResult {
  transfers: number;
  swaps: number;
  quotes: number;
  events: number;
  /** Quotes nobody used (no transfer), removed an hour after they expired. */
  unusedQuotes: number;
  dryRun: boolean;
}

/**
 * Unused quotes: a quote lives 60 seconds (QUOTE_TTL_MS) and the API refuses to create a
 * transfer from an expired one, so an expired quote with no transfer can never be used.
 * They are removed once they expired more than an hour ago (a wide safety margin).
 */
export const UNUSED_QUOTE_GRACE_MS = 60 * 60_000;
export const QUOTE_BATCH = 1_000;
export const QUOTE_MAX_PER_RUN = 100_000;

function prunableQuotes(cutoff: Date) {
  return and(lt(quotes.expiresAt, cutoff), sql`not exists (select 1 from ${transfers} where ${transfers.quoteId} = ${quotes.id})`);
}

function prunableTransfers(cutoff: Date) {
  return and(eq(transfers.state, "FAILED"), isNull(transfers.burnTxHash), isNull(transfers.mintTxHash), lt(transfers.updatedAt, cutoff));
}
function prunableSwaps(cutoff: Date) {
  return and(eq(swaps.state, "FAILED"), isNull(swaps.swapTxHash), isNull(swaps.approvalTxHash), lt(swaps.updatedAt, cutoff));
}

export async function pruneFailed(db: Db, opts: { now?: number; dryRun?: boolean; log?: (m: string) => void } = {}): Promise<PruneResult> {
  const now = opts.now ?? Date.now();
  const cutoff = new Date(now - PRUNE_AFTER_MS);
  const log = opts.log ?? (() => {});
  const out: PruneResult = { transfers: 0, swaps: 0, quotes: 0, events: 0, unusedQuotes: 0, dryRun: !!opts.dryRun };
  const quoteCutoff = new Date(now - UNUSED_QUOTE_GRACE_MS);

  if (opts.dryRun) {
    const [t] = await db.select({ n: sql<number>`count(*)` }).from(transfers).where(prunableTransfers(cutoff));
    const [s] = await db.select({ n: sql<number>`count(*)` }).from(swaps).where(prunableSwaps(cutoff));
    const [q] = await db.select({ n: sql<number>`count(*)` }).from(quotes).where(prunableQuotes(quoteCutoff));
    out.transfers = Number(t?.n ?? 0);
    out.swaps = Number(s?.n ?? 0);
    out.unusedQuotes = Number(q?.n ?? 0);
    return out;
  }

  // ---- bridges ----
  while (out.transfers < PRUNE_MAX_PER_RUN) {
    const rows = await db
      .select({ id: transfers.id, quoteId: transfers.quoteId })
      .from(transfers)
      .where(prunableTransfers(cutoff))
      .limit(PRUNE_BATCH);
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    const quoteIds = rows.map((r) => r.quoteId);
    const [ev, del, q] = await db.batch([
      db.delete(transferEvents).where(inArray(transferEvents.transferId, ids)).returning({ id: transferEvents.id }),
      db
        .delete(transfers)
        .where(and(inArray(transfers.id, ids), prunableTransfers(cutoff)))
        .returning({ id: transfers.id }),
      // A quote belongs to exactly one transfer (unique quote_id); only delete it once no
      // transfer points at it any more.
      db
        .delete(quotes)
        .where(and(inArray(quotes.id, quoteIds), sql`not exists (select 1 from ${transfers} where ${transfers.quoteId} = ${quotes.id})`))
        .returning({ id: quotes.id }),
    ]);
    out.events += ev.length;
    out.transfers += del.length;
    out.quotes += q.length;
    if (del.length === 0) break; // everything in this group changed meanwhile
  }

  // ---- swaps ----
  while (out.swaps < PRUNE_MAX_PER_RUN) {
    const rows = await db.select({ id: swaps.id }).from(swaps).where(prunableSwaps(cutoff)).limit(PRUNE_BATCH);
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    const [ev, del] = await db.batch([
      db.delete(swapEvents).where(inArray(swapEvents.swapId, ids)).returning({ id: swapEvents.id }),
      db
        .delete(swaps)
        .where(and(inArray(swaps.id, ids), prunableSwaps(cutoff)))
        .returning({ id: swaps.id }),
    ]);
    out.events += ev.length;
    out.swaps += del.length;
    if (del.length === 0) break;
  }

  // ---- unused quotes (after failed transfers, so their quotes are already gone) ----
  while (out.unusedQuotes < QUOTE_MAX_PER_RUN) {
    const ids = (await db.select({ id: quotes.id }).from(quotes).where(prunableQuotes(quoteCutoff)).limit(QUOTE_BATCH)).map((r) => r.id);
    if (ids.length === 0) break;
    // Re-check inside the delete: a quote that gained a transfer meanwhile is kept.
    const del = await db
      .delete(quotes)
      .where(and(inArray(quotes.id, ids), prunableQuotes(quoteCutoff)))
      .returning({ id: quotes.id });
    out.unusedQuotes += del.length;
    if (del.length === 0) break;
  }

  if (out.transfers || out.swaps) log(`housekeeping: pruned ${out.transfers} failed transfers, ${out.swaps} failed swaps (${out.events} events, ${out.quotes} quotes)`);
  if (out.unusedQuotes) log(`housekeeping: removed ${out.unusedQuotes} unused expired quotes`);
  await recordRun(db, out, now);
  return out;
}

// ---------- last run, for the admin dashboard ----------

const KEY = "housekeeping";

async function recordRun(db: Db, r: PruneResult, now: number) {
  const prev = await getHousekeeping(db);
  const value = {
    lastRunAt: new Date(now).toISOString(),
    lastRun: { transfers: r.transfers, swaps: r.swaps, unusedQuotes: r.unusedQuotes },
    totalPruned: {
      transfers: prev.totalPruned.transfers + r.transfers,
      swaps: prev.totalPruned.swaps + r.swaps,
      unusedQuotes: prev.totalPruned.unusedQuotes + r.unusedQuotes,
    },
  };
  await db
    .insert(siteSettings)
    .values({ key: KEY, value, updatedBy: "housekeeping", updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedBy: "housekeeping", updatedAt: new Date(now) } });
}

type Counts = { transfers: number; swaps: number; unusedQuotes: number };

export async function getHousekeeping(db: Db): Promise<{ lastRunAt: string | null; lastRun: Counts; totalPruned: Counts }> {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  const v = (row?.value ?? {}) as Partial<{ lastRunAt: string; lastRun: Partial<Counts>; totalPruned: Partial<Counts> }>;
  const fill = (c?: Partial<Counts>): Counts => ({ transfers: c?.transfers ?? 0, swaps: c?.swaps ?? 0, unusedQuotes: c?.unusedQuotes ?? 0 });
  return { lastRunAt: v.lastRunAt ?? null, lastRun: fill(v.lastRun), totalPruned: fill(v.totalPruned) };
}

/** Runs once shortly after start-up, then every `intervalMs`. Never throws. */
export function startHousekeeping(db: Db, intervalMs: number, log: (m: string) => void = console.log) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pruneFailed(db, { log });
    } catch (e) {
      log(`housekeeping: prune failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
