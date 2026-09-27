import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { siteSettings } from "../db/schema.js";

/**
 * Admin chain switches: chains come from App Kit automatically, and the admin can take
 * one out of the bridge (and put it back). A disabled chain is refused for NEW quotes and
 * transfers, as source or destination. Transfers already in flight keep working: the
 * tracker, transaction pages and "Complete mint" still use the full chain list.
 */
const KEY = "bridge_chains";

export interface DisabledChain {
  id: string;
  at: string;
  by: string;
}

export async function getDisabledChains(db: Db): Promise<DisabledChain[]> {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  const v = (row?.value ?? {}) as { disabled?: DisabledChain[] };
  return Array.isArray(v.disabled) ? v.disabled.filter((d) => typeof d?.id === "string") : [];
}

export async function setChainEnabled(db: Db, id: string, enabled: boolean, by: string) {
  const current = await getDisabledChains(db);
  const rest = current.filter((d) => d.id !== id);
  const disabled = enabled ? rest : [...rest, { id, at: new Date().toISOString(), by }];
  const now = new Date();
  await db
    .insert(siteSettings)
    .values({ key: KEY, value: { disabled }, updatedBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { disabled }, updatedBy: by, updatedAt: now } });
  cache = null;
  return disabled;
}

// A few seconds of caching keeps quotes off an extra database read each time.
const CACHE_MS = 5_000;
let cache: { at: number; ids: Set<string> } | null = null;

export async function disabledChainIds(db: Db): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const ids = new Set((await getDisabledChains(db)).map((d) => d.id));
  cache = { at: Date.now(), ids };
  return ids;
}

export function resetChainCache() {
  cache = null;
}
