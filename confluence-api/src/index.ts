import { AppKit } from "@circle-fin/app-kit";
import { loadConfig, type Config } from "./config.js";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { buildChainRegistry } from "./chains/registry.js";
import { startIdempotencySweeper } from "./middleware/idempotency.js";
import { IRIS_BASE_URL, IrisClient, IrisMessagesClient } from "./circle/iris.js";
import { startTracker } from "./tracker/tracker.js";
import { TokenBucket } from "./lib/tokenBucket.js";

function configOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const config = configOrExit();
const db = createDb(config);
const registry = buildChainRegistry(config);
console.log(`chain registry: ${registry.chains.length} ${config.CONFLUENCE_ENV} EVM chains from App Kit`);
if (registry.missingSpeed.length > 0) {
  console.warn(`chain registry: no Circle finality data for ${registry.missingSpeed.join(", ")} (shown without ETA)`);
}

startIdempotencySweeper(db);
const circleLimiter = new TokenBucket(config.CIRCLE_MAX_RPS * 2, config.CIRCLE_MAX_RPS);
const iris = new IrisClient(IRIS_BASE_URL[config.CONFLUENCE_ENV], circleLimiter);

if (config.TRACKER_ENABLED) {
  const messages = new IrisMessagesClient(IRIS_BASE_URL[config.CONFLUENCE_ENV], circleLimiter);
  const swapKit = new AppKit();
  startTracker(
    {
      db,
      registry,
      messages,
      // Permissionless status lookup (no key): https://www.npmjs.com/package/@circle-fin/app-kit
      getSwapStatus: async (txHash, chainIn, chainOut) => {
        const r = await swapKit.getSwapStatus({ txHash, chainIn: chainIn as never, ...(chainOut ? { chainOut: chainOut as never } : {}) });
        return { status: r.progress.status, destinationTxHash: r.destination?.txHash };
      },
    },
    config.TRACKER_INTERVAL_MS,
  );
  console.log(`tracker: on, every ${Math.round(config.TRACKER_INTERVAL_MS / 1000)}s while awake`);
} else {
  console.log("tracker: off (TRACKER_ENABLED=false)");
}

createApp(config, db, registry, iris).listen(config.PORT, () => {
  console.log(`confluence-api [${config.CONFLUENCE_ENV}] listening on :${config.PORT}`);
});
