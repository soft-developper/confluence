/**
 * Sets the platform fee recipient per chain in this environment's registry.
 * Usage (from confluence-api):
 *   npm run fees:set-recipient -- 0xYourAddress                       every chain
 *   npm run fees:set-recipient -- 0xYourAddress --except Edge,Plume   every chain but these
 *   npm run fees:set-recipient -- 0xYourAddress --only Arc,Base       only these chains
 *   add --dry-run to print what would change without writing anything
 * Inserts new rows effective now; history is kept (quotes use the latest effective row).
 * Chains left out keep their current recipient. (confluence:fee-recipient-per-chain)
 */
import { getAddress } from "@ethersproject/address";
import { buildChainRegistry } from "../chains/registry.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { feeRecipients } from "../db/schema.js";
import { activeFeeRecipient } from "../fees/quote.js";

const USAGE =
  "usage: npm run fees:set-recipient -- 0x<40 hex chars> [--only A,B | --except A,B] [--dry-run]";

export interface RecipientArgs {
  address: string;
  only: string[] | null;
  except: string[];
  dryRun: boolean;
}

export function parseArgs(argv: string[]): RecipientArgs {
  const [raw, ...rest] = argv;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(USAGE);
  const address = getAddress(raw); // throws on a bad EIP-55 checksum
  let only: string[] | null = null;
  let except: string[] = [];
  let dryRun = false;
  const list = (v: string | undefined, flag: string) => {
    const ids = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error(`${flag} needs a comma-separated list of chain ids\n${USAGE}`);
    return ids;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--only") only = list(rest[++i], "--only");
    else if (a === "--except") except = list(rest[++i], "--except");
    else if (a === "--dry-run") dryRun = true;
    else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  if (only && except.length) throw new Error(`use --only or --except, not both\n${USAGE}`);
  return { address, only, except, dryRun };
}

/** Picks the target chain ids; unknown ids are an error so a typo can't silently skip a chain. */
export function selectChains(all: readonly string[], args: Pick<RecipientArgs, "only" | "except">): string[] {
  const named = args.only ?? args.except;
  const unknown = named.filter((id) => !all.includes(id));
  if (unknown.length) throw new Error(`unknown chain id(s): ${unknown.join(", ")}. Known: ${all.join(", ")}`);
  return args.only ? all.filter((id) => args.only!.includes(id)) : all.filter((id) => !args.except.includes(id));
}

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {
    // env from the shell
  }
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const registry = buildChainRegistry(config);
  const targets = selectChains(
    registry.chains.map((c) => c.id),
    args,
  );
  if (!targets.length) throw new Error("no chains selected");
  const db = createDb(config);
  try {
    const now = new Date();
    console.log(`[${config.CONFLUENCE_ENV}] ${args.dryRun ? "DRY RUN, nothing written. " : ""}Recipient ${args.address}`);
    for (const c of registry.chains) {
      const current = await activeFeeRecipient(db, c.id);
      const change = targets.includes(c.id);
      console.log(`  ${change ? "SET " : "keep"} ${c.id.padEnd(12)} ${current ?? "(none)"}${change ? ` -> ${args.address}` : ""}`);
    }
    if (!args.dryRun) {
      await db.insert(feeRecipients).values(targets.map((chain) => ({ chain, address: args.address, effectiveFrom: now })));
      console.log(`[${config.CONFLUENCE_ENV}] fee recipient ${args.address} set for ${targets.length} chains, effective ${now.toISOString()}`);
    }
  } finally {
    db.$client.close();
  }
}

if (process.argv[1]?.includes("setFeeRecipient")) {
  main().catch((e: unknown) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
