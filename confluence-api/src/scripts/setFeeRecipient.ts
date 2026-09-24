/**
 * Sets the platform fee recipient for EVERY chain in this environment's registry.
 * Usage (from confluence-api):  npm run fees:set-recipient -- 0xYourAddress
 * Inserts new rows effective now; history is kept (quotes use the latest effective row).
 */
import { getAddress } from "@ethersproject/address";
import { buildChainRegistry } from "../chains/registry.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { feeRecipients } from "../db/schema.js";

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // env from the shell
  }
  const raw = process.argv[2];
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error("usage: npm run fees:set-recipient -- 0x<40 hex chars>");
  const address = getAddress(raw); // throws on a bad EIP-55 checksum
  const config = loadConfig();
  const registry = buildChainRegistry(config);
  const db = createDb(config);
  const now = new Date();
  await db.insert(feeRecipients).values(registry.chains.map((c) => ({ chain: c.id, address, effectiveFrom: now })));
  console.log(`[${config.CONFLUENCE_ENV}] fee recipient ${address} set for ${registry.chains.length} chains, effective ${now.toISOString()}`);
  db.$client.close();
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
