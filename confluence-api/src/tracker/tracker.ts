import { and, asc, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import type { ChainRegistry } from "../chains/registry.js";
import type { IrisMessagesClient } from "../circle/iris.js";
import type { Db } from "../db/client.js";
import { transferEvents, transfers } from "../db/schema.js";
import { isNonceUsed } from "./chainReads.js";
import { decide, recheckAfterMs, STOP_CODES, type Decision } from "./decide.js";
import { trackSwapsOnce, type SwapStatusFn } from "./swaps.js";

export interface TrackerDeps {
  db: Db;
  registry: ChainRegistry;
  messages: IrisMessagesClient;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** Stage 6a: App Kit getSwapStatus; when set, each pass also settles swaps. */
  getSwapStatus?: SwapStatusFn;
}

export interface PassResult {
  checked: number;
  moved: number;
  errors: number;
  moves: { id: string; from: string; to: string; reason: string }[];
}

const CANDIDATES = 60; // rows read per pass
const MAX_PER_PASS = 20; // rows checked per pass (each may cost one Circle call and one RPC call)

/** One tracking pass. Safe to run concurrently with client reports (conditional updates). */
export async function trackOnce(deps: TrackerDeps, now = Date.now()): Promise<PassResult> {
  const { db, registry, messages } = deps;
  const log = deps.log ?? (() => {});
  const rows = await db
    .select()
    .from(transfers)
    .where(
      and(
        notInArray(transfers.state, ["COMPLETED", "FAILED"]),
        or(isNull(transfers.errorCode), notInArray(transfers.errorCode, [...STOP_CODES])),
      ),
    )
    .orderBy(sql`${transfers.trackedAt} IS NOT NULL`, asc(transfers.trackedAt))
    .limit(CANDIDATES);

  const due = rows
    .filter((r) => !r.trackedAt || now - r.trackedAt.getTime() >= recheckAfterMs(now - r.createdAt.getTime()))
    .slice(0, MAX_PER_PASS);

  const result: PassResult = { checked: 0, moved: 0, errors: 0, moves: [] };
  for (const r of due) {
    result.checked++;
    const src = registry.byId.get(r.sourceChain);
    const dst = registry.byId.get(r.destinationChain);
    try {
      let decision: Decision;
      let irisSummary: Record<string, unknown> = {};
      if (!src || !dst) {
        decision = { kind: "none", reason: "chain no longer in the registry" };
      } else {
        const message = r.burnTxHash ? await messages.getMessage(src.cctpDomain, r.burnTxHash) : undefined;
        irisSummary = message
          ? { irisStatus: message.status, forwardState: message.forwardState ?? null }
          : message === null
            ? { irisStatus: "not_found" }
            : {};
        // Ask the destination only when it can change the answer.
        let nonceUsed: boolean | undefined;
        const nonce = message?.decodedMessage?.nonce;
        const needNonce =
          !!message && !!nonce && !!dst.messageTransmitter && (r.useForwarder ? message.forwardState === "FAILED" : message.status === "complete");
        if (needNonce) {
          try {
            nonceUsed = await isNonceUsed(dst.rpcUrls, dst.messageTransmitter!, nonce!, deps.fetchImpl);
          } catch (e) {
            log(`tracker: ${r.id.slice(0, 8)} destination check failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        decision = decide({ row: r, src, dst, message, nonceUsed, now });
      }

      if (decision.kind === "none") {
        await db.update(transfers).set({ trackedAt: new Date(now) }).where(eq(transfers.id, r.id));
        continue;
      }

      const patch: Partial<typeof transfers.$inferInsert> = { state: decision.to, trackedAt: new Date(now), updatedAt: new Date(now) };
      if (decision.errorCode !== undefined) patch.errorCode = decision.errorCode;
      if (decision.mintTxHash && !r.mintTxHash) patch.mintTxHash = decision.mintTxHash;
      const detail = {
        actor: "tracker",
        reason: decision.reason,
        ...irisSummary,
        ...(decision.mismatches ? { mismatches: decision.mismatches } : {}),
        ...(decision.mintTxHash ? { mintTxHash: decision.mintTxHash } : {}),
      };
      // Same pattern as client reports: conditional update plus an event only if it applied.
      const [updated] = await db.batch([
        db
          .update(transfers)
          .set(patch)
          .where(and(eq(transfers.id, r.id), eq(transfers.state, r.state)))
          .returning({ id: transfers.id }),
        db.run(
          sql`insert into ${transferEvents} (transfer_id, from_state, to_state, source, detail)
              select ${r.id}, ${r.state}, ${decision.to}, 'worker', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (updated.length === 0) {
        log(`tracker: ${r.id.slice(0, 8)} changed during the check; will retry next pass`);
        continue;
      }
      result.moved++;
      result.moves.push({ id: r.id, from: r.state, to: decision.to, reason: decision.reason });
      log(
        decision.to === r.state
          ? `tracker: ${r.id.slice(0, 8)} stays ${r.state}, error code set to ${decision.errorCode ?? "none"} (${decision.reason})`
          : `tracker: ${r.id.slice(0, 8)} ${r.state} -> ${decision.to} (${decision.reason})`,
      );
    } catch (e) {
      result.errors++;
      log(`tracker: ${r.id.slice(0, 8)} check failed: ${e instanceof Error ? e.message : String(e)}`);
      // Push it back in the queue so one bad row cannot starve the others.
      await db
        .update(transfers)
        .set({ trackedAt: new Date(now) })
        .where(eq(transfers.id, r.id))
        .catch(() => {});
    }
  }
  return result;
}

/**
 * Runs trackOnce on boot (after a short delay) and then on an interval, while the API is
 * awake. On Render Free the service sleeps when idle; the first pass after waking catches up.
 */
export function startTracker(deps: TrackerDeps, intervalMs: number): () => void {
  const log = deps.log ?? ((m: string) => console.log(m));
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap passes
    running = true;
    try {
      const r = await trackOnce({ ...deps, log });
      if (r.checked > 0) log(`tracker: pass checked ${r.checked}, moved ${r.moved}, errors ${r.errors}`);
      if (deps.getSwapStatus) {
        const s = await trackSwapsOnce({ db: deps.db, getSwapStatus: deps.getSwapStatus, log });
        if (s.checked > 0) log(`tracker: swaps checked ${s.checked}, moved ${s.moved}, errors ${s.errors}`);
      }
    } catch (e) {
      log(`tracker: pass failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
