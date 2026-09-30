/**
 * Read-only preview of the swap verification (confluence:verified-swaps):
 *   npx tsx src/scripts/swapVerifyPreview.ts
 * For every swap not yet verified that has a transaction, asks Circle (getSwapStatus) and
 * the chain (who made the transaction) and prints what the tracker would decide. Changes
 * nothing in the database.
 */
import { AppKit } from "@circle-fin/app-kit";
import { and, isNotNull, isNull } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { swaps } from "../db/schema.js";
import { buildSwapRegistry } from "../swaps/tokens.js";
import { txMadeBy } from "../tracker/chainReads.js";
import { decideSwap } from "../tracker/swaps.js";

try {
  process.loadEnvFile(".env");
} catch {
  // env from the shell
}
const config = loadConfig();
const db = createDb(config);
const kit = new AppKit();
const reg = buildSwapRegistry(config, kit);
const rows = await db
  .select()
  .from(swaps)
  .where(and(isNull(swaps.verifiedAt), isNotNull(swaps.swapTxHash)))
  .limit(200);
console.log(`[${config.CONFLUENCE_ENV}] ${rows.length} swap(s) with a transaction, not yet verified (read-only, nothing changes)`);
const tally: Record<string, number> = {};
for (const r of rows) {
  let status: "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" | undefined;
  let tokenOutSymbol: string | undefined;
  let senderOk: boolean | undefined;
  let note = "";
  try {
    const st = await kit.getSwapStatus({ txHash: r.swapTxHash!, chainIn: r.chain as never, ...(r.destinationChain ? { chainOut: r.destinationChain as never } : {}) });
    status = st.progress.status;
    tokenOutSymbol = st.destination?.token?.symbol;
    if (status === "DONE") {
      const made = await txMadeBy(reg.byId.get(r.chain)?.rpcUrls ?? [], r.swapTxHash!, r.sender);
      senderOk = made === null ? undefined : made;
    }
  } catch (e) {
    note = ` (check failed: ${e instanceof Error ? e.message : String(e)})`;
  }
  const d = decideSwap(r, { status, senderOk, tokenOutSymbol }, Date.now());
  const outcome = d.kind === "move" ? `${r.state} -> ${d.to}${d.errorCode ? ` (${d.errorCode})` : ""}` : d.verify ? `${r.state}, verified` : `no change`;
  tally[outcome] = (tally[outcome] ?? 0) + 1;
  console.log(`  ${r.id.slice(0, 8)}  ${r.state.padEnd(9)} Circle ${String(status ?? "?").padEnd(9)} sender ${String(senderOk ?? "?").padEnd(5)} => ${outcome}: ${d.reason}${note}`);
}
console.log("summary:", Object.entries(tally).map(([k, v]) => `${v} x ${k}`).join("; ") || "nothing to check");
db.$client.close();
