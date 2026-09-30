/**
 * Read-only preview of the Relay ownership check (confluence:relay-ownership):
 *   npx tsx src/scripts/relayOwnership.ts
 * Asks Relay about every registered request not yet proven to be ours and prints what the
 * live check would decide (ours / foreign / unknown). Changes nothing in the database.
 */
import { isNull } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { relayRequests } from "../db/schema.js";
import { checkOwnership } from "../relay/status.js";
import { relayReferrer, relayUpstreamFor } from "../relay/upstream.js";

try {
  process.loadEnvFile(".env");
} catch {
  // env from the shell
}
const config = loadConfig();
const db = createDb(config);
const upstream = relayUpstreamFor(config);
const referrer = relayReferrer(config);
if (!upstream.configured) {
  console.log("RELAY_API_KEY is not set: nothing to check.");
  process.exit(0);
}
const rows = await db
  .select({ requestId: relayRequests.requestId, status: relayRequests.status, createdAt: relayRequests.createdAt })
  .from(relayRequests)
  .where(isNull(relayRequests.verifiedAt))
  .limit(200);
console.log(`[${config.CONFLUENCE_ENV}] referrer "${referrer}", ${rows.length} request(s) not yet proven (read-only, nothing changes)`);
const counts = { ours: 0, foreign: 0, unknown: 0 };
for (const r of rows) {
  const o = await checkOwnership(db, upstream, r.requestId, referrer, { dryRun: true });
  counts[o.result]++;
  console.log(`  ${r.requestId.slice(0, 12)}...  ${r.status.padEnd(10)} ${o.result.padEnd(8)} ${o.why}`);
}
console.log(`summary: ${counts.ours} ours, ${counts.foreign} foreign (would be removed), ${counts.unknown} unknown (kept, asked again)`);
db.$client.close();
