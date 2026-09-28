import { and, eq, gt, lt, notInArray, asc } from "drizzle-orm";
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
export function startRelayReconciler(db: Db, upstream: RelayUpstream, intervalMs = 120_000, log: (m: string) => void = console.log) {
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
            notInArray(relayRequests.status, [...TERMINAL]),
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
      if (changed) log(`relay: backup check updated ${changed} request(s)`);
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
