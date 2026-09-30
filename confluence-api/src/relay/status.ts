import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { relayRequests } from "../db/schema.js";
import type { RelayUpstream } from "./upstream.js";

/**
 * Relay request statuses (R3b), as listed in https://docs.relay.link/references/api/api_guides/webhooks :
 * waiting -> depositing -> pending -> submitted -> success | failure | refund.
 * Updates only ever move a request forward, so a late or replayed event can't undo a
 * newer status. (confluence:relay-status)
 */
export const TERMINAL = ["success", "failure", "refund"] as const;
/** Unfinished statuses, listed so queries can use the status index. */
export const ACTIVE = ["waiting", "depositing", "pending", "submitted"] as const;
const RANK: Record<string, number> = { waiting: 0, depositing: 1, pending: 2, submitted: 3, success: 9, failure: 9, refund: 9 };

export interface StatusUpdate {
  requestId: string;
  status: string;
  inTxHashes?: unknown;
  txHashes?: unknown;
  failReason?: unknown;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const firstHash = (v: unknown) => (Array.isArray(v) ? v.find((h): h is string => typeof h === "string" && HASH.test(h))?.toLowerCase() : undefined);

const USD = /^-?[0-9]{1,15}(\.[0-9]{1,12})?$/;
const usdOrNull = (v: unknown) => (typeof v === "string" && USD.test(v) ? String(Math.abs(Number(v))) : null);

/**
 * R4: once a request has ended, read Relay's own record for the input's USD value and the
 * app fees actually paid, so admin can compare quoted against paid (Relay's docs warn that
 * unsupported routes don't error, they just don't collect). Uses GET /requests/v3, per
 * https://docs.relay.link/references/api/api_guides/migrating-to-requests-v3 (v2 is
 * deprecated, throttled from Sep 1 2026 and retired Nov 24 2026):
 *   deposited value: data.route.actual.origin.inputCurrency (falls back to route.quoted)
 *   paid app fees:   data.appFees.actual[].amountUsd
 * Returns true when the record was stored.
 */
export async function enrichFromRelay(db: Db, upstream: RelayUpstream, requestId: string): Promise<boolean> {
  const res = await upstream.request("GET", `/requests/v3?id=${requestId}`, undefined, 0);
  if (res.status !== 200) return false;
  const req = ((res.body as { requests?: unknown[] } | null)?.requests ?? [])[0] as { data?: Record<string, unknown> } | undefined;
  if (!req?.data) return false;
  const data = req.data;
  type Side = { origin?: { inputCurrency?: { amountUsd?: unknown } } };
  const route = (data.route ?? {}) as { actual?: Side; quoted?: Side };
  const amountUsd = usdOrNull(route.actual?.origin?.inputCurrency?.amountUsd) ?? usdOrNull(route.quoted?.origin?.inputCurrency?.amountUsd);
  const appFees = (data.appFees ?? {}) as { actual?: unknown };
  const actual = Array.isArray(appFees.actual) ? (appFees.actual as { amountUsd?: unknown }[]) : [];
  const paid = actual.reduce((sum, f) => sum + Number(usdOrNull(f.amountUsd) ?? 0), 0);
  await db
    .update(relayRequests)
    .set({ amountInUsd: amountUsd, appFeePaidUsd: String(paid), enrichedAt: new Date() })
    .where(eq(relayRequests.requestId, requestId.toLowerCase()));
  return true;
}

/**
 * Ownership (confluence:relay-ownership). Registration comes from the browser unsigned, so a
 * row is only trusted once Relay's own record proves it: GET /requests/v3 with
 * includeAuthenticatedData=true returns data.referrer only to the integrator that created the
 * request (https://docs.relay.link/references/api/api_guides/migrating-to-requests-v3), and
 * the root "user" field is the wallet that requested the quote.
 *   ours:    referrer is ours and user matches the registered address -> verified_at set
 *   foreign: Relay shows a different referrer or a different user -> the row is deleted
 *   unknown: no record yet, no answer, or a field is missing -> kept, asked again later
 * A missing referrer is never treated as foreign, so an unexpected response can't delete
 * real rows; unverified rows are removed only by housekeeping after 7 days of trying.
 */
export type Ownership = "ours" | "foreign" | "unknown";

export async function checkOwnership(
  db: Db,
  upstream: RelayUpstream,
  requestId: string,
  referrer: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ result: Ownership; why: string }> {
  const id = requestId.toLowerCase();
  const row = await db.query.relayRequests.findFirst({ where: eq(relayRequests.requestId, id) });
  if (!row) return { result: "unknown", why: "no such row" };
  const touch = async () => {
    if (!opts.dryRun) await db.update(relayRequests).set({ ownershipCheckedAt: new Date() }).where(eq(relayRequests.requestId, id));
  };
  let res;
  try {
    res = await upstream.request("GET", `/requests/v3?id=${id}&includeAuthenticatedData=true`, undefined, 0);
  } catch (e) {
    await touch();
    return { result: "unknown", why: `Relay unreachable (${e instanceof Error ? e.message : String(e)})` };
  }
  if (res.status !== 200) {
    await touch();
    return { result: "unknown", why: `Relay answered HTTP ${res.status}` };
  }
  const req = ((res.body as { requests?: unknown[] } | null)?.requests ?? [])[0] as { user?: unknown; data?: { referrer?: unknown } } | undefined;
  if (!req) {
    await touch();
    return { result: "unknown", why: "Relay has no record of this request yet" };
  }
  const user = typeof req.user === "string" ? req.user.toLowerCase() : null;
  const ref = typeof req.data?.referrer === "string" ? req.data.referrer : null;
  if ((ref !== null && ref !== referrer) || (user !== null && user !== row.userAddress)) {
    if (!opts.dryRun) {
      await db.delete(relayRequests).where(and(eq(relayRequests.requestId, id), isNull(relayRequests.verifiedAt)));
    }
    return { result: "foreign", why: ref !== null && ref !== referrer ? `referrer is "${ref}", not ours` : "Relay shows a different user" };
  }
  if (ref === null || user === null) {
    await touch();
    return { result: "unknown", why: ref === null ? "Relay did not return a referrer" : "Relay did not return a user" };
  }
  if (!opts.dryRun) {
    const now = new Date();
    await db.update(relayRequests).set({ verifiedAt: now, ownershipCheckedAt: now }).where(eq(relayRequests.requestId, id));
  }
  return { result: "ours", why: "referrer and user match" };
}

/** Rows still waiting for an ownership answer, least recently asked first. */
export async function ownershipCandidates(db: Db, limit: number, now = Date.now()) {
  return db
    .select({ requestId: relayRequests.requestId })
    .from(relayRequests)
    .where(
      and(
        isNull(relayRequests.verifiedAt),
        gt(relayRequests.createdAt, new Date(now - OWNERSHIP_GIVE_UP_MS - 24 * 3600_000)),
        or(isNull(relayRequests.ownershipCheckedAt), lt(relayRequests.ownershipCheckedAt, new Date(now - 5 * 60_000))),
      ),
    )
    .orderBy(sql`${relayRequests.ownershipCheckedAt} IS NOT NULL`, asc(relayRequests.ownershipCheckedAt))
    .limit(limit);
}

/** Unverified rows are kept this long (and asked about all along) before housekeeping removes them. */
export const OWNERSHIP_GIVE_UP_MS = 7 * 24 * 3600_000;

/** Applies one status update. Returns true when the stored request changed. */
export async function applyStatus(db: Db, u: StatusUpdate): Promise<boolean> {
  const status = String(u.status ?? "").toLowerCase();
  if (!(status in RANK) || !HASH.test(u.requestId)) return false;
  const id = u.requestId.toLowerCase();
  const row = await db.query.relayRequests.findFirst({ where: eq(relayRequests.requestId, id) });
  if (!row) return false;
  const oldRank = RANK[row.status] ?? 0;
  if ((TERMINAL as readonly string[]).includes(row.status)) return false;
  const forward = RANK[status]! > oldRank;
  const inTx = firstHash(u.inTxHashes);
  const outTx = firstHash(u.txHashes);
  const reason = typeof u.failReason === "string" && u.failReason !== "N/A" ? u.failReason.slice(0, 80) : null;
  if (!forward && !(outTx && !row.outTxHash) && !(inTx && !row.inTxHash)) return false;
  await db
    .update(relayRequests)
    .set({
      ...(forward ? { status } : {}),
      ...(inTx && !row.inTxHash ? { inTxHash: inTx } : {}),
      ...(outTx && !row.outTxHash ? { outTxHash: outTx } : {}),
      ...(forward && reason && status !== "success" ? { failReason: reason } : {}),
      updatedAt: new Date(),
    })
    .where(eq(relayRequests.requestId, id));
  return true;
}

/**
 * Backup for missed webhooks: every interval, asks Relay's status endpoint about a few
 * unfinished requests that haven't changed for a while. Uses the shared upstream client,
 * so it counts against the same rate budget. Never throws.
 */
export function startRelayReconciler(db: Db, upstream: RelayUpstream, referrer: string, intervalMs = 120_000, log: (m: string) => void = console.log) {
  let running = false;
  const run = async () => {
    if (running || !upstream.configured) return;
    running = true;
    try {
      const now = Date.now();
      const rows = await db
        .select({ requestId: relayRequests.requestId })
        .from(relayRequests)
        .where(
          and(
            inArray(relayRequests.status, [...ACTIVE]),
            lt(relayRequests.updatedAt, new Date(now - 90_000)),
            gt(relayRequests.createdAt, new Date(now - 3 * 24 * 3600_000)),
          ),
        )
        .orderBy(asc(relayRequests.updatedAt))
        .limit(10);
      let changed = 0;
      for (const r of rows) {
        const res = await upstream.request("GET", `/intents/status/v3?requestId=${r.requestId}`, undefined, 0);
        const b = (res.body ?? {}) as Record<string, unknown>;
        if (res.status === 200 && typeof b.status === "string" && (await applyStatus(db, { requestId: r.requestId, ...b, status: b.status }))) changed++;
        else await db.update(relayRequests).set({ updatedAt: new Date() }).where(eq(relayRequests.requestId, r.requestId));
      }
      // R4: fill in USD figures for finished requests that don't have them yet.
      const toEnrich = await db
        .select({ requestId: relayRequests.requestId })
        .from(relayRequests)
        .where(and(inArray(relayRequests.status, [...TERMINAL]), isNull(relayRequests.enrichedAt), gt(relayRequests.createdAt, new Date(now - 30 * 24 * 3600_000))))
        .limit(10);
      for (const r of toEnrich) await enrichFromRelay(db, upstream, r.requestId).catch(() => false);
      if (changed) log(`relay: backup check updated ${changed} request(s)`);
      // Ownership: prove new registrations against Relay's own record.
      const counts = { ours: 0, foreign: 0, unknown: 0 };
      for (const r of await ownershipCandidates(db, 10, now)) {
        const o = await checkOwnership(db, upstream, r.requestId, referrer).catch(() => ({ result: "unknown" as const, why: "check failed" }));
        counts[o.result]++;
      }
      if (counts.ours || counts.foreign) log(`relay: ownership verified ${counts.ours}, removed ${counts.foreign} not created through Confluence`);
    } catch (e) {
      log(`relay: backup check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
