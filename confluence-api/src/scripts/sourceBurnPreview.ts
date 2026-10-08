/**
 * Read-only preview of the source-chain burn proof (confluence:source-burn-proof):
 *   npx tsx src/scripts/sourceBurnPreview.ts [limit]
 * Takes the most recent transfers that have a burn hash (default 30), reads each burn
 * receipt from the source chain and prints what the check decides, next to whether Circle
 * already verified the transfer. Every Circle-verified bridge should come out "ok".
 * Changes nothing in the database, and works before the 0019 migration is applied.
 */
import { desc, isNotNull } from "drizzle-orm";
import { buildChainRegistry } from "../chains/registry.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { transfers } from "../db/schema.js";
import { getReceipt } from "../tracker/chainReads.js";
import { checkBurnReceipt } from "../tracker/sourceBurn.js";

try {
  process.loadEnvFile(".env");
} catch {
  // env from the shell
}
const limit = Math.min(Math.max(Number(process.argv[2] ?? 30) || 30, 1), 200);
const config = loadConfig();
const registry = buildChainRegistry(config);
const db = createDb(config);
// Explicit columns only, so this runs on a database without the new columns.
const rows = await db
  .select({
    id: transfers.id,
    state: transfers.state,
    sourceChain: transfers.sourceChain,
    destinationChain: transfers.destinationChain,
    sender: transfers.sender,
    recipient: transfers.recipient,
    amountBase: transfers.amountBase,
    speed: transfers.speed,
    burnTxHash: transfers.burnTxHash,
    verifiedAt: transfers.verifiedAt,
  })
  .from(transfers)
  .where(isNotNull(transfers.burnTxHash))
  .orderBy(desc(transfers.createdAt))
  .limit(limit);
console.log(`[${config.CONFLUENCE_ENV}] ${rows.length} most recent transfer(s) with a burn (read-only, nothing changes)`);
const tally: Record<string, number> = {};
for (const r of rows) {
  const src = registry.byId.get(r.sourceChain);
  const dst = registry.byId.get(r.destinationChain);
  let result: string;
  if (!src || !dst || !src.tokenMessenger) result = "skipped (chain not in registry)";
  else {
    try {
      const receipt = await getReceipt(src.rpcUrls, r.burnTxHash!);
      result =
        checkBurnReceipt(receipt, {
          tokenMessenger: src.tokenMessenger,
          usdcAddress: src.usdcAddress,
          amountBase: r.amountBase,
          sender: r.sender,
          recipient: r.recipient,
          destinationDomain: dst.cctpDomain,
          speed: r.speed,
        }) ?? "not on chain yet";
    } catch (e) {
      result = `check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const circle = r.verifiedAt ? "verified" : "not verified";
  const key = `${circle} / ${result}`;
  tally[key] = (tally[key] ?? 0) + 1;
  console.log(`  ${r.id.slice(0, 8)}  ${r.sourceChain} -> ${r.destinationChain}  ${r.state.padEnd(19)} Circle ${circle.padEnd(12)} source check: ${result}`);
}
console.log("summary:", Object.entries(tally).map(([k, v]) => `${v} x ${k}`).join("; ") || "nothing to check");
db.$client.close();
