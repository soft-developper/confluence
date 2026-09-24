import { loadConfig, type Config } from "./config.js";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";

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

createApp(config, db).listen(config.PORT, () => {
  console.log(`confluence-api [${config.CONFLUENCE_ENV}] listening on :${config.PORT}`);
});
