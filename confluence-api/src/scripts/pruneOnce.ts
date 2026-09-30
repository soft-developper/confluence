/**
 * One housekeeping pass by hand:
 *   npm run prune:once -- --dry-run   show how many records WOULD be deleted
 *   npm run prune:once                delete them now
 */
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { pruneFailed } from "../housekeeping/pruneFailed.js";
import { relayUpstreamFor } from "../relay/upstream.js";

try {
  process.loadEnvFile(".env");
} catch {
  // env from the shell
}
const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
const db = createDb(config);
const r = await pruneFailed(db, { dryRun, log: (m) => console.log(m), relay: relayUpstreamFor(config) });
console.log(
  dryRun
    ? `[${config.CONFLUENCE_ENV}] dry run: would prune ${r.transfers} failed transfers and ${r.swaps} failed swaps (never reached the chain, failed over 24h ago), and ${r.unusedQuotes} unused quotes (expired over 1h ago)`
    : `[${config.CONFLUENCE_ENV}] pruned ${r.transfers} failed transfers and ${r.swaps} failed swaps (${r.events} events, ${r.quotes} quotes), and ${r.unusedQuotes} unused quotes`,
);
const rl = r.relay;
console.log(
  rl.skipped
    ? `[${config.CONFLUENCE_ENV}] relay: ${rl.candidates} waiting requests over 24h old, not checked (RELAY_API_KEY not set)`
    : `[${config.CONFLUENCE_ENV}] relay: ${rl.candidates} waiting requests over 24h old; Relay confirmed ${rl.pruned} still waiting (${dryRun ? "would delete" : "deleted"}), ${rl.movedOn} moved on (${dryRun ? "would update" : "updated"}, kept), ${rl.unknown} no answer (kept)`,
);
console.log(
  `[${config.CONFLUENCE_ENV}] relay: ${rl.unproven} requests never proven to be Confluence's after 7 days of checks (${dryRun ? "would delete" : "deleted"})`,
);
db.$client.close();
