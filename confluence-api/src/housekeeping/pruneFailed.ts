import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { adminResetTokens, adminSessions, authNonces, quotes, relayRequests, sessions, siteSettings, swapEvents, swaps, transferEvents, transfers } from "../db/schema.js";
import type { RelayUpstream } from "../relay/upstream.js";
import { applyStatus, OWNERSHIP_GIVE_UP_MS } from "../relay/status.js";

/**
 * Housekeeping: delete failed bridges and swaps that never reached the chain, 24 hours
 * after they failed, and quotes nobody used (see below). A record is pruned only when ALL
 * of these hold:
 *   - state is FAILED (never in-flight, never needs-recovery, never completed)
 *   - it has no transaction hash of any kind
 *       bridges: no burn and no mint transaction
 *       swaps:   no swap and no approval transaction
 *   - it became FAILED more than 24 hours ago (updated_at is set when the state changes)
 * Bridges whose reported burn Circle never saw are treated the same way
 * (confluence:verified-transfers): state RECOVERY_REQUIRED with error code
 * "burn_not_found" (the tracker sets it after 24 hours without a Circle message), never
 * verified against Circle, and unchanged for 24 hours. A reported hash alone is not
 * proof that anything reached the chain.
 * Its events (and, for a bridge, its single-use quote) are deleted with it, in one
 * database batch per group, and every delete re-checks the same conditions, so a record
 * that changed meanwhile is left alone.
 *
 * Relay requests (confluence:relay-prune): a row is created only once a transaction was
 * sent, but that first transaction can be a token approval, and a deposit can be dropped.
 * Relay reports "waiting" while it has not seen a deposit
 * (https://docs.relay.link/references/api/get-intents-status-v3). A Relay row is deleted
 * only when ALL of these hold:
 *   - our status is "waiting" and it has no destination transaction
 *   - it was created more than 24 hours ago
 *   - Relay's status endpoint, asked right before the delete, still answers "waiting"
 * An approval alone does not count as reaching the chain (same rule as bridges). If Relay
 * reports any other status, the row is moved forward instead and kept. If Relay can't be
 * reached, or doesn't answer with a status, the row is kept and checked on a later run.
 * Confluence never uses Relay deposit addresses, so a waiting requestId is never filled
 * under a different id.
 *
 * Expired sign-in data (confluence:auth-cleanup): login nonces, user and admin sessions, and
 * admin reset tokens are only ever looked up by their token, and an expired, revoked or used
 * one is refused anyway. They are deleted once expired (sessions and reset tokens also once
 * revoked or used), after a one-hour grace so nothing in use is ever touched.
 *
 * Unproven Relay rows (confluence:relay-ownership): a row Relay's record never showed to be
 * ours (no verified_at) is deleted once it is over 7 days old AND the ownership check has
 * still been asking Relay after that 7-day mark. Rows Relay shows as someone else's are
 * deleted by the ownership check itself.
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
  /** Relay requests Relay never saw a deposit for (see the rule above). */
  relay: RelayPruneResult;
  /** Expired or finished sign-in data removed (or, in a dry run, that would be). */
  auth: AuthPruneResult;
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

/** Relay status checks per run (shares the API's Relay rate budget, 200/min per key). */
export const RELAY_CHECKS_PER_RUN = 50;

export interface RelayPruneResult {
  /** Rows matching the local rule (waiting, no destination tx, over 24h old). */
  candidates: number;
  /** Rows Relay confirmed as still waiting: deleted (or, in a dry run, would be). */
  pruned: number;
  /** Rows Relay reported with another status: moved forward and kept. */
  movedOn: number;
  /** Rows Relay did not answer for: kept, checked again next run. */
  unknown: number;
  /** True when Relay isn't configured, so nothing was checked or deleted. */
  skipped: boolean;
  /** Rows never proven to be ours after 7 days of asking Relay: deleted (or would be). */
  unproven: number;
}

function stuckRelay(cutoff: Date) {
  return and(eq(relayRequests.status, "waiting"), isNull(relayRequests.outTxHash), lt(relayRequests.createdAt, cutoff));
}

async function relayStatusOf(upstream: RelayUpstream, requestId: string): Promise<{ status: string; body: Record<string, unknown> } | null> {
  try {
    const res = await upstream.request("GET", `/intents/status/v3?requestId=${requestId}`, undefined, 0);
    const body = (res.body ?? {}) as Record<string, unknown>;
    if (res.status === 200 && typeof body.status === "string") return { status: body.status.toLowerCase(), body };
    return null;
  } catch {
    return null;
  }
}

export interface AuthPruneResult {
  nonces: number;
  sessions: number;
  adminSessions: number;
  resetTokens: number;
}

/** Grace after expiry, revocation or use before a sign-in row is deleted. */
export const AUTH_GRACE_MS = 60 * 60_000;

async function pruneAuth(db: Db, now: number, dryRun: boolean): Promise<AuthPruneResult> {
  const before = new Date(now - AUTH_GRACE_MS);
  const rules = {
    nonces: [authNonces, lt(authNonces.expiresAt, before)],
    sessions: [sessions, or(lt(sessions.expiresAt, before), lt(sessions.revokedAt, before))],
    adminSessions: [adminSessions, or(lt(adminSessions.expiresAt, before), lt(adminSessions.revokedAt, before))],
    resetTokens: [adminResetTokens, or(lt(adminResetTokens.expiresAt, before), lt(adminResetTokens.usedAt, before))],
  } as const;
  const out: AuthPruneResult = { nonces: 0, sessions: 0, adminSessions: 0, resetTokens: 0 };
  for (const [key, [table, where]] of Object.entries(rules) as [keyof AuthPruneResult, (typeof rules)[keyof typeof rules]][]) {
    if (dryRun) {
      const [c] = await db.select({ n: sql<number>`count(*)` }).from(table).where(where);
      out[key] = Number(c?.n ?? 0);
    } else {
      const r = await db.delete(table).where(where);
      out[key] = Number((r as { rowsAffected?: number }).rowsAffected ?? 0);
    }
  }
  return out;
}

function unprovenRelay(now: number) {
  return and(
    isNull(relayRequests.verifiedAt),
    lt(relayRequests.createdAt, new Date(now - OWNERSHIP_GIVE_UP_MS)),
    isNotNull(relayRequests.ownershipCheckedAt),
    sql`${relayRequests.ownershipCheckedAt} - ${relayRequests.createdAt} > ${OWNERSHIP_GIVE_UP_MS}`,
  );
}

async function pruneUnprovenRelay(db: Db, now: number, dryRun: boolean): Promise<number> {
  if (dryRun) {
    const [c] = await db.select({ n: sql<number>`count(*)` }).from(relayRequests).where(unprovenRelay(now));
    return Number(c?.n ?? 0);
  }
  const del = await db.delete(relayRequests).where(unprovenRelay(now)).returning({ requestId: relayRequests.requestId });
  return del.length;
}

async function pruneRelay(db: Db, upstream: RelayUpstream | undefined, cutoff: Date, dryRun: boolean): Promise<RelayPruneResult> {
  const out: RelayPruneResult = { candidates: 0, pruned: 0, movedOn: 0, unknown: 0, skipped: false, unproven: 0 };
  out.unproven = await pruneUnprovenRelay(db, cutoff.getTime() + PRUNE_AFTER_MS, dryRun);
  const [c] = await db.select({ n: sql<number>`count(*)` }).from(relayRequests).where(stuckRelay(cutoff));
  out.candidates = Number(c?.n ?? 0);
  if (out.candidates === 0) return out;
  if (!upstream?.configured) {
    out.skipped = true;
    return out;
  }
  // Least recently touched first, so rows Relay doesn't answer for can't starve the rest.
  const rows = await db
    .select({ requestId: relayRequests.requestId })
    .from(relayRequests)
    .where(stuckRelay(cutoff))
    .orderBy(relayRequests.updatedAt)
    .limit(RELAY_CHECKS_PER_RUN);
  for (const r of rows) {
    const s = await relayStatusOf(upstream, r.requestId);
    if (!s) {
      out.unknown++;
      if (!dryRun) await db.update(relayRequests).set({ updatedAt: new Date() }).where(eq(relayRequests.requestId, r.requestId));
      continue;
    }
    if (s.status !== "waiting") {
      out.movedOn++;
      if (!dryRun) await applyStatus(db, { requestId: r.requestId, ...s.body, status: s.status });
      continue;
    }
    if (dryRun) {
      out.pruned++;
      continue;
    }
    // Re-check the local rule inside the delete: a row that changed meanwhile is kept.
    const del = await db
      .delete(relayRequests)
      .where(and(eq(relayRequests.requestId, r.requestId), stuckRelay(cutoff)))
      .returning({ requestId: relayRequests.requestId });
    out.pruned += del.length;
  }
  return out;
}

function prunableQuotes(cutoff: Date) {
  return and(lt(quotes.expiresAt, cutoff), sql`not exists (select 1 from ${transfers} where ${transfers.quoteId} = ${quotes.id})`);
}

function prunableTransfers(cutoff: Date) {
  return and(
    or(
      and(eq(transfers.state, "FAILED"), isNull(transfers.burnTxHash), isNull(transfers.mintTxHash)),
      and(eq(transfers.state, "RECOVERY_REQUIRED"), eq(transfers.errorCode, "burn_not_found"), isNull(transfers.verifiedAt)),
    ),
    lt(transfers.updatedAt, cutoff),
  );
}
function prunableSwaps(cutoff: Date) {
  return and(
    or(
      and(eq(swaps.state, "FAILED"), isNull(swaps.swapTxHash), isNull(swaps.approvalTxHash)),
      // A reported swap hash Circle never saw, or a transaction sent by another wallet, is not
      // proof this swap reached the chain (confluence:verified-swaps).
      and(eq(swaps.state, "FAILED"), inArray(swaps.errorCode, ["not_found", "tx_sender_mismatch"]), isNull(swaps.verifiedAt)),
    ),
    lt(swaps.updatedAt, cutoff),
  );
}

export async function pruneFailed(
  db: Db,
  opts: { now?: number; dryRun?: boolean; log?: (m: string) => void; relay?: RelayUpstream } = {},
): Promise<PruneResult> {
  const now = opts.now ?? Date.now();
  const cutoff = new Date(now - PRUNE_AFTER_MS);
  const log = opts.log ?? (() => {});
  const out: PruneResult = {
    transfers: 0,
    swaps: 0,
    quotes: 0,
    events: 0,
    unusedQuotes: 0,
    relay: { candidates: 0, pruned: 0, movedOn: 0, unknown: 0, skipped: false, unproven: 0 },
    auth: { nonces: 0, sessions: 0, adminSessions: 0, resetTokens: 0 },
    dryRun: !!opts.dryRun,
  };
  const quoteCutoff = new Date(now - UNUSED_QUOTE_GRACE_MS);

  if (opts.dryRun) {
    const [t] = await db.select({ n: sql<number>`count(*)` }).from(transfers).where(prunableTransfers(cutoff));
    const [s] = await db.select({ n: sql<number>`count(*)` }).from(swaps).where(prunableSwaps(cutoff));
    const [q] = await db.select({ n: sql<number>`count(*)` }).from(quotes).where(prunableQuotes(quoteCutoff));
    out.transfers = Number(t?.n ?? 0);
    out.swaps = Number(s?.n ?? 0);
    out.unusedQuotes = Number(q?.n ?? 0);
    // Read-only: asks Relay about each candidate, deletes and updates nothing.
    out.relay = await pruneRelay(db, opts.relay, cutoff, true);
    out.auth = await pruneAuth(db, now, true);
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

  // ---- Relay requests Relay never saw a deposit for ----
  out.relay = await pruneRelay(db, opts.relay, cutoff, false);

  // ---- expired sign-in data ----
  out.auth = await pruneAuth(db, now, false);
  const authTotal = out.auth.nonces + out.auth.sessions + out.auth.adminSessions + out.auth.resetTokens;
  if (authTotal) {
    log(
      `housekeeping: removed expired sign-in data (${out.auth.nonces} nonces, ${out.auth.sessions} sessions, ${out.auth.adminSessions} admin sessions, ${out.auth.resetTokens} reset tokens)`,
    );
  }

  if (out.transfers || out.swaps) log(`housekeeping: pruned ${out.transfers} failed transfers, ${out.swaps} failed swaps (${out.events} events, ${out.quotes} quotes)`);
  if (out.unusedQuotes) log(`housekeeping: removed ${out.unusedQuotes} unused expired quotes`);
  if (out.relay.unproven) log(`housekeeping: removed ${out.relay.unproven} Relay requests never proven to be Confluence's (7 days)`);
  if (out.relay.pruned || out.relay.movedOn) log(`housekeeping: removed ${out.relay.pruned} Relay requests that never deposited, moved ${out.relay.movedOn} forward`);
  if (out.relay.skipped) log(`housekeeping: ${out.relay.candidates} waiting Relay requests not checked (Relay not configured)`);
  await recordRun(db, out, now);
  return out;
}

// ---------- last run, for the admin dashboard ----------

const KEY = "housekeeping";

async function recordRun(db: Db, r: PruneResult, now: number) {
  const prev = await getHousekeeping(db);
  const value = {
    lastRunAt: new Date(now).toISOString(),
    lastRun: { transfers: r.transfers, swaps: r.swaps, unusedQuotes: r.unusedQuotes, relay: r.relay.pruned + r.relay.unproven },
    totalPruned: {
      transfers: prev.totalPruned.transfers + r.transfers,
      swaps: prev.totalPruned.swaps + r.swaps,
      unusedQuotes: prev.totalPruned.unusedQuotes + r.unusedQuotes,
      relay: prev.totalPruned.relay + r.relay.pruned + r.relay.unproven,
    },
  };
  await db
    .insert(siteSettings)
    .values({ key: KEY, value, updatedBy: "housekeeping", updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedBy: "housekeeping", updatedAt: new Date(now) } });
}

type Counts = { transfers: number; swaps: number; unusedQuotes: number; relay: number };

export async function getHousekeeping(db: Db): Promise<{ lastRunAt: string | null; lastRun: Counts; totalPruned: Counts }> {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  const v = (row?.value ?? {}) as Partial<{ lastRunAt: string; lastRun: Partial<Counts>; totalPruned: Partial<Counts> }>;
  const fill = (c?: Partial<Counts>): Counts => ({ transfers: c?.transfers ?? 0, swaps: c?.swaps ?? 0, unusedQuotes: c?.unusedQuotes ?? 0, relay: c?.relay ?? 0 });
  return { lastRunAt: v.lastRunAt ?? null, lastRun: fill(v.lastRun), totalPruned: fill(v.totalPruned) };
}

/** Runs once shortly after start-up, then every `intervalMs`. Never throws. */
export function startHousekeeping(db: Db, intervalMs: number, log: (m: string) => void = console.log, relay?: RelayUpstream) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pruneFailed(db, { log, relay });
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
