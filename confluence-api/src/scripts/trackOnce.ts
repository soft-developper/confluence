/**
 * Runs one tracker pass against THIS environment's database and prints what changed.
 * Usage (from confluence-api):  npm run tracker:once
 * Same logic the API runs on its timer; safe to run while the API is up.
 */
import { buildChainRegistry } from "../chains/registry.js";
import { IRIS_BASE_URL, IrisMessagesClient } from "../circle/iris.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { TokenBucket } from "../lib/tokenBucket.js";
import { trackOnce } from "../tracker/tracker.js";

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // env from the shell
  }
  const config = loadConfig();
  const registry = buildChainRegistry(config);
  const db = createDb(config);
  const limiter = new TokenBucket(config.CIRCLE_MAX_RPS * 2, config.CIRCLE_MAX_RPS);
  const messages = new IrisMessagesClient(IRIS_BASE_URL[config.CONFLUENCE_ENV], limiter);
  const r = await trackOnce({ db, registry, messages, log: (m) => console.log(m) });
  console.log(`[${config.CONFLUENCE_ENV}] checked ${r.checked}, moved ${r.moved}, errors ${r.errors}`);
  db.$client.close();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
