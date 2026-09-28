import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { siteSettings } from "../db/schema.js";
import { activeFeeRecipient } from "../fees/quote.js";

/**
 * Relay integration settings (R1), stored in site_settings under "relay".
 * appFeeBps is Confluence's app fee in basis points of the input value
 * (https://docs.relay.link/features/app-fees). 0 means no app fee.
 * (confluence:relay-settings)
 */
export const MAX_APP_FEE_BPS = 300;

export const RelaySettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    appFeeBps: z.number().int().min(0).max(MAX_APP_FEE_BPS).default(10),
  })
  .strict();
export type RelaySettings = z.infer<typeof RelaySettingsSchema>;

export const SaveRelaySettingsBody = RelaySettingsSchema.partial().strict();

const KEY = "relay";
const CACHE_MS = 5_000;
let cache: { at: number; value: RelaySettings } | null = null;

export async function getRelaySettings(db: Db): Promise<{ settings: RelaySettings; updatedAt: string | null; updatedBy: string | null }> {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  const parsed = row ? RelaySettingsSchema.safeParse(row.value) : null;
  return {
    settings: parsed?.success ? parsed.data : RelaySettingsSchema.parse({}),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/** Cached read for the hot path (every proxied quote). */
export async function currentRelaySettings(db: Db): Promise<RelaySettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const { settings } = await getRelaySettings(db);
  cache = { at: Date.now(), value: settings };
  return settings;
}

export async function saveRelaySettings(db: Db, input: z.infer<typeof SaveRelaySettingsBody>, by: string) {
  const { settings } = await getRelaySettings(db);
  const next = RelaySettingsSchema.parse({ ...settings, ...input });
  const now = new Date();
  await db
    .insert(siteSettings)
    .values({ key: KEY, value: next, updatedBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: next, updatedBy: by, updatedAt: now } });
  cache = null;
  return { settings: next, updatedAt: now.toISOString() };
}

export function resetRelaySettingsCache() {
  cache = null;
}

/**
 * Relay pays app fees out on Base for free, so the claim address is Confluence's own
 * fee recipient on Base (the Safe on mainnet). Found through the chain registry by
 * EVM chain id rather than a hard-coded address. Null (no app fee) if Base has none.
 */
export const RELAY_FREE_CLAIM_CHAIN_IDS = [8453, 84532]; // Base, Base Sepolia

export async function appFeeRecipient(db: Db, registry: ChainRegistry): Promise<string | null> {
  const base = registry.chains.find((c) => RELAY_FREE_CLAIM_CHAIN_IDS.includes(c.evmChainId));
  return base ? activeFeeRecipient(db, base.id) : null;
}
