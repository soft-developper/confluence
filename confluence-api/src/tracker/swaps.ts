import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { swapEvents, swaps, type SwapState } from "../db/schema.js";
import type { SwapRegistry } from "../swaps/tokens.js";
import { txMadeBy } from "./chainReads.js";
import { recheckAfterMs } from "./decide.js";

/**
 * Stage 6a: the tracker also settles swaps. Submitted swaps are checked with App Kit's
 * getSwapStatus (permissionless); swaps that never got a transaction expire after 24h.
 *
 * Verified swaps (confluence:verified-swaps): browser reports never finish a swap. A swap
 * becomes COMPLETED (and gets verified_at) only when Circle reports it DONE and the swap
 * transaction on chain was made by the swap's sender (sent by it, or, for smart wallets,
 * moving tokens out of it). Circle's amount received, when it
 * reports one, replaces the browser's. A transaction from another wallet ends the swap as
 * FAILED "tx_sender_mismatch". COMPLETED swaps from before this rule are checked once the
 * same way; if Circle has no record they stay COMPLETED with error code "unverified" (kept,
 * hidden).
 */
export type SwapStatusFn = (
  txHash: string,
  chainIn: string,
  chainOut?: string,
) => Promise<{
  status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND";
  destinationTxHash?: string | undefined;
  /** Amount received, human-readable (App Kit destination.amount), when Circle reports it. */
  amountOut?: string | undefined;
  /** Destination token symbol, when Circle reports it. */
  tokenOutSymbol?: string | undefined;
}>;

const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_PASS = 20;
const STABLES = new Set(["USDC", "EURC", "USDT"]);

export interface SwapDecisionRow {
  state: SwapState;
  swapTxHash: string | null;
  tokenOut: string;
  errorCode: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SwapDecision =
  | { kind: "none"; reason: string; verify?: boolean }
  | { kind: "move"; to: SwapState; errorCode: string | null; reason: string; verify?: boolean };

export interface SwapEvidence {
  status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" | undefined;
  /** true: the swap tx was sent by the swap's sender; false: by someone else; undefined: unknown. */
  senderOk?: boolean | undefined;
  tokenOutSymbol?: string | undefined;
}

/** Pure decision for one swap. `verify` means: set verified_at with this update. */
export function decideSwap(row: SwapDecisionRow, ev: SwapEvidence, now: number): SwapDecision {
  if (row.state === "FAILED") return { kind: "none", reason: "final" };
  const legacy = row.state === "COMPLETED";
  if (legacy && (row.verifiedAt || !row.swapTxHash)) return { kind: "none", reason: "final" };

  if (!row.swapTxHash) {
    if (row.state === "CREATED" && now - row.updatedAt.getTime() > DAY) return { kind: "move", to: "FAILED", errorCode: "abandoned", reason: "no swap transaction within 24h" };
    return { kind: "none", reason: "no swap transaction yet" };
  }
  const { status } = ev;
  if (status === "DONE") {
    if (ev.senderOk === undefined) return { kind: "none", reason: "Circle reports DONE, sender not checked yet" };
    if (ev.senderOk === false) return { kind: "move", to: "FAILED", errorCode: "tx_sender_mismatch", reason: "the swap transaction was sent by another wallet" };
    const sym = ev.tokenOutSymbol?.toUpperCase();
    if (sym && STABLES.has(sym) && STABLES.has(row.tokenOut) && sym !== row.tokenOut) {
      return { kind: "move", to: "FAILED", errorCode: "swap_mismatch", reason: `Circle delivered ${sym}, the swap was for ${row.tokenOut}` };
    }
    if (legacy) return { kind: "none", reason: "verified against Circle and the chain", verify: true };
    return { kind: "move", to: "COMPLETED", errorCode: null, reason: "Circle reports the swap DONE, sender checked", verify: true };
  }
  if (status === "FAILED") return { kind: "move", to: "FAILED", errorCode: "swap_failed", reason: "Circle reports the swap FAILED" };
  if (status === "NOT_FOUND") {
    if (legacy) {
      return row.errorCode === "unverified"
        ? { kind: "none", reason: "Circle has no record (already flagged)" }
        : { kind: "move", to: "COMPLETED", errorCode: "unverified", reason: "Circle has no record of the reported swap" };
    }
    if (now - row.createdAt.getTime() > DAY) return { kind: "move", to: "FAILED", errorCode: "not_found", reason: "Circle has no record of the swap after 24h" };
  }
  return { kind: "none", reason: status ? `swap ${status}` : "status unknown" };
}

export async function trackSwapsOnce(
  deps: { db: Db; getSwapStatus: SwapStatusFn; swapRegistry?: SwapRegistry | undefined; fetchImpl?: typeof fetch; log?: (m: string) => void },
  now = Date.now(),
): Promise<{ checked: number; moved: number; errors: number }> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const rows = await db
    .select()
    .from(swaps)
    .where(
      or(
        inArray(swaps.state, ["CREATED", "SUBMITTED"]),
        // Completed before verification existed: checked once.
        and(eq(swaps.state, "COMPLETED"), isNull(swaps.verifiedAt), isNotNull(swaps.swapTxHash), isNull(swaps.errorCode)),
      ),
    )
    .orderBy(sql`${swaps.trackedAt} IS NOT NULL`, asc(swaps.trackedAt))
    .limit(60);
  const due = rows.filter((r) => !r.trackedAt || now - r.trackedAt.getTime() >= recheckAfterMs(now - r.createdAt.getTime())).slice(0, MAX_PER_PASS);
  const out = { checked: 0, moved: 0, errors: 0 };
  for (const r of due) {
    out.checked++;
    try {
      const st = r.swapTxHash ? await deps.getSwapStatus(r.swapTxHash, r.chain, r.destinationChain ?? undefined) : undefined;
      let senderOk: boolean | undefined;
      if (st?.status === "DONE" && r.swapTxHash) {
        const rpc = deps.swapRegistry?.byId.get(r.chain)?.rpcUrls ?? [];
        if (rpc.length) {
          try {
            const made = await txMadeBy(rpc, r.swapTxHash, r.sender, deps.fetchImpl);
            senderOk = made === null ? undefined : made;
          } catch (e) {
            log(`tracker: swap ${r.id.slice(0, 8)} sender check failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      const d = decideSwap(r, { status: st?.status, senderOk, tokenOutSymbol: st?.tokenOutSymbol }, now);
      const circleAmount = d.verify && st?.amountOut ? { amountOut: st.amountOut } : {};
      if (d.kind === "none") {
        await db
          .update(swaps)
          .set({ trackedAt: new Date(now), ...(d.verify ? { verifiedAt: new Date(now), ...circleAmount } : {}) })
          .where(eq(swaps.id, r.id));
        if (d.verify) log(`tracker: swap ${r.id.slice(0, 8)} verified (${d.reason})`);
        continue;
      }
      const detail = { actor: "tracker", reason: d.reason, ...(st?.status ? { status: st.status } : {}), ...(st?.amountOut ? { amountOut: st.amountOut } : {}) };
      const [updated] = await db.batch([
        db
          .update(swaps)
          .set({
            state: d.to,
            errorCode: d.errorCode,
            trackedAt: new Date(now),
            updatedAt: new Date(now),
            ...(d.verify ? { verifiedAt: new Date(now), ...circleAmount } : {}),
            ...(st?.destinationTxHash && !r.destinationTxHash ? { destinationTxHash: st.destinationTxHash.toLowerCase() } : {}),
          })
          .where(and(eq(swaps.id, r.id), eq(swaps.state, r.state)))
          .returning({ id: swaps.id }),
        db.run(
          sql`insert into ${swapEvents} (swap_id, from_state, to_state, source, detail)
              select ${r.id}, ${r.state}, ${d.to}, 'worker', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (updated.length > 0) {
        out.moved++;
        log(`tracker: swap ${r.id.slice(0, 8)} ${r.state} -> ${d.to} (${d.reason})`);
      }
    } catch (e) {
      out.errors++;
      log(`tracker: swap ${r.id.slice(0, 8)} check failed: ${e instanceof Error ? e.message : String(e)}`);
      await db.update(swaps).set({ trackedAt: new Date(now) }).where(eq(swaps.id, r.id)).catch(() => {});
    }
  }
  return out;
}
