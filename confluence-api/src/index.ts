import { loadConfig, type Config } from "./config.js";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { buildChainRegistry } from "./chains/registry.js";
import { startIdempotencySweeper } from "./middleware/idempotency.js";

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

createApp(config, db, registry).listen(config.PORT, () => {
  console.log(`confluence-api [${config.CONFLUENCE_ENV}] listening on :${config.PORT}`);
});
