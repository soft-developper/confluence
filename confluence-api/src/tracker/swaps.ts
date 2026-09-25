import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { swapEvents, swaps, type SwapState } from "../db/schema.js";
import { recheckAfterMs } from "./decide.js";

/**
 * Stage 6a: the tracker also settles swaps. Submitted swaps are checked with App Kit's
 * getSwapStatus (permissionless); swaps that never got a transaction expire after 24h.
 */
export type SwapStatusFn = (txHash: string, chain: string) => Promise<{ status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" }>;

const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_PASS = 20;

export interface SwapDecisionRow {
  state: SwapState;
  swapTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SwapDecision = { kind: "none"; reason: string } | { kind: "move"; to: SwapState; errorCode: string | null; reason: string };

export function decideSwap(row: SwapDecisionRow, status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" | undefined, now: number): SwapDecision {
  if (row.state === "COMPLETED" || row.state === "FAILED") return { kind: "none", reason: "final" };
  if (!row.swapTxHash) {
    if (row.state === "CREATED" && now - row.updatedAt.getTime() > DAY) return { kind: "move", to: "FAILED", errorCode: "abandoned", reason: "no swap transaction within 24h" };
    return { kind: "none", reason: "no swap transaction yet" };
  }
  if (status === "DONE") return { kind: "move", to: "COMPLETED", errorCode: null, reason: "Circle reports the swap DONE" };
  if (status === "FAILED") return { kind: "move", to: "FAILED", errorCode: "swap_failed", reason: "Circle reports the swap FAILED" };
  if (status === "NOT_FOUND" && now - row.createdAt.getTime() > DAY) {
    return { kind: "move", to: "FAILED", errorCode: "not_found", reason: "Circle has no record of the swap after 24h" };
  }
  return { kind: "none", reason: status ? `swap ${status}` : "status unknown" };
}

export async function trackSwapsOnce(
  deps: { db: Db; getSwapStatus: SwapStatusFn; log?: (m: string) => void },
  now = Date.now(),
): Promise<{ checked: number; moved: number; errors: number }> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const rows = await db
    .select()
    .from(swaps)
    .where(inArray(swaps.state, ["CREATED", "SUBMITTED"]))
    .orderBy(sql`${swaps.trackedAt} IS NOT NULL`, asc(swaps.trackedAt))
    .limit(60);
  const due = rows.filter((r) => !r.trackedAt || now - r.trackedAt.getTime() >= recheckAfterMs(now - r.createdAt.getTime())).slice(0, MAX_PER_PASS);
  const out = { checked: 0, moved: 0, errors: 0 };
  for (const r of due) {
    out.checked++;
    try {
      const status = r.swapTxHash ? (await deps.getSwapStatus(r.swapTxHash, r.chain)).status : undefined;
      const d = decideSwap(r, status, now);
      if (d.kind === "none") {
        await db.update(swaps).set({ trackedAt: new Date(now) }).where(eq(swaps.id, r.id));
        continue;
      }
      const detail = { actor: "tracker", reason: d.reason, ...(status ? { status } : {}) };
      const [updated] = await db.batch([
        db
          .update(swaps)
          .set({ state: d.to, errorCode: d.errorCode, trackedAt: new Date(now), updatedAt: new Date(now) })
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
