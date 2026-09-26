/**
 * One housekeeping pass by hand:
 *   npm run prune:once -- --dry-run   show how many records WOULD be deleted
 *   npm run prune:once                delete them now
 */
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { pruneFailed } from "../housekeeping/pruneFailed.js";

try {
  process.loadEnvFile(".env");
} catch {
  // env from the shell
}
const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
const db = createDb(config);
const r = await pruneFailed(db, { dryRun, log: (m) => console.log(m) });
console.log(
  dryRun
    ? `[${config.CONFLUENCE_ENV}] dry run: would prune ${r.transfers} failed transfers and ${r.swaps} failed swaps (never reached the chain, failed over 24h ago)`
    : `[${config.CONFLUENCE_ENV}] pruned ${r.transfers} failed transfers and ${r.swaps} failed swaps (${r.events} events, ${r.quotes} quotes)`,
);
db.$client.close();
