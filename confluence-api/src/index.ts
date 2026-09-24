import { loadConfig, type Config } from "./config.js";
import { createApp } from "./app.js";

function configOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const config = configOrExit();

createApp(config).listen(config.PORT, () => {
  console.log(`confluence-api [${config.CONFLUENCE_ENV}] listening on :${config.PORT}`);
});
