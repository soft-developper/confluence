import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { formatUsdc } from "../lib/usdc.js";

/**
 * Public stats (confluence:public-stats, DefiLlama D2). Daily activity per chain for the
 * landing dashboard and for DefiLlama's active-users adapter. Counting rules are the same as
 * the admin dashboard, so the numbers match:
 * - Bridge: transfers COMPLETED and verified against Circle's data (verified_at). Payments to
 *   a Confluence ID from another chain are bridges, so they count here.
 * - Swap: swaps COMPLETED and verified. Swap USD volume uses the USDC or USDT side of the
 *   swap (1 token = 1 USD); swaps with neither side in USDC or USDT count, but add no volume.
 * - Arc Pay: Arc to Arc payments COMPLETED with the payment proven on Arc (pay_verified_at).
 * - Relay: Relay requests with status success that we verified (verified_at); volume is the
 *   USD value Relay reported for the amount sent. relayBridge is the cross-chain part (origin
 *   chain differs from destination chain); the rest are same-chain Relay swaps.
 * Days are UTC calendar days of when the action was created. Wallets are lowercased
 * addresses; a wallet active on several chains is one wallet in the daily total.
 * No wallet address, transaction hash or note ever leaves this module.
 */

export const STATS_PRODUCTS = ["bridge", "swap", "arcPay", "relay"] as const;
export type StatsProduct = (typeof STATS_PRODUCTS)[number];

/** Longest range one /public/stats/daily call may ask for. */
export const MAX_DAILY_SPAN_DAYS = 92;
export const SERIES_DAYS = 90;
const DAY_MS = 86_400_000;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : v == null ? 0 : Number(v));
const big = (v: unknown) => {
  try {
    return v == null ? 0n : BigInt(typeof v === "number" ? Math.trunc(v) : String(v).split(".")[0]!);
  } catch {
    return 0n;
  }
};
const usd = (v: unknown) => Math.round(num(v) * 100) / 100;
async function all(db: Db, q: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.all(q)) as Row[];
}

/** Our chain id (bridge and swap registries) to the EVM chain id DefiLlama keys chains by. */
export type ChainIds = ReadonlyMap<string, number>;

/**
 * Every counted action as (day, product, chain, wallet, base amount, usd, xc). xc = 1 for a
 * cross-chain Relay route (confluence:relay-bridge-split), 0 otherwise. Relay rows store
 * the EVM chain id, so their chain is "evm:<id>" and is resolved through ChainIds afterwards.
 */
const ACTIONS = sql`
  select date(created_at / 1000, 'unixepoch') as day, 'bridge' as product, source_chain as chain, lower(sender) as wallet,
         cast(amount_base as integer) as base, null as usd, 0 as xc
    from transfers where state = 'COMPLETED' and verified_at is not null
  union all
  select date(created_at / 1000, 'unixepoch'), 'swap', chain, lower(sender), null,
         case when upper(token_in) in ('USDC', 'USDT') then cast(amount_in as real)
              when upper(token_out) in ('USDC', 'USDT') and amount_out is not null then cast(amount_out as real)
              else null end, 0
    from swaps where state = 'COMPLETED' and verified_at is not null
  union all
  select date(created_at / 1000, 'unixepoch'), 'arcPay', chain, lower(sender), cast(amount_base as integer), null, 0
    from arc_payments where state = 'COMPLETED' and pay_verified_at is not null
  union all
  select date(created_at / 1000, 'unixepoch'), 'relay', 'evm:' || origin_chain_id, lower(user_address), null, cast(amount_in_usd as real),
         case when origin_chain_id <> destination_chain_id then 1 else 0 end
    from relay_requests where status = 'success' and verified_at is not null`;

export interface ProductStats {
  count: number;
  /** USDC, human-readable (bridge and Arc Pay). */
  volumeUsdc?: string;
  /** USD, rounded to cents (swap and Relay). */
  volumeUsd?: number;
}

export interface ChainDay {
  chain: string;
  evmChainId: number | null;
  transactions: number;
  activeWallets: number;
  newWallets: number;
  bridge: ProductStats;
  swap: ProductStats;
  arcPay: ProductStats;
  relay: ProductStats;
  /** Cross-chain Relay routes only (a subset of relay). */
  relayBridge: ProductStats;
}

export interface StatsDay {
  date: string;
  transactions: number;
  activeWallets: number;
  newWallets: number;
  chains: ChainDay[];
}

function resolveChain(chain: string, ids: ChainIds): { chain: string; evmChainId: number | null } {
  if (chain.startsWith("evm:")) {
    const id = Number(chain.slice(4));
    for (const [name, evm] of ids) if (evm === id) return { chain: name, evmChainId: id };
    return { chain, evmChainId: Number.isFinite(id) ? id : null };
  }
  return { chain, evmChainId: ids.get(chain) ?? null };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class StatsRangeError extends Error {}

/** Validates a from/to pair of UTC days: both dates, from <= to, at most MAX_DAILY_SPAN_DAYS. */
export function parseRange(from: unknown, to: unknown, now = Date.now()): { from: string; to: string } {
  const today = utcDay(now);
  const t = typeof to === "string" && to ? to : today;
  const f = typeof from === "string" && from ? from : utcDay(Date.parse(`${t}T00:00:00Z`) - 29 * DAY_MS);
  if (!isDate(f) || !isDate(t)) throw new StatsRangeError("from and to must be dates like 2026-10-16");
  const span = (Date.parse(`${t}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / DAY_MS + 1;
  if (span < 1) throw new StatsRangeError("from must be on or before to");
  if (span > MAX_DAILY_SPAN_DAYS) throw new StatsRangeError(`at most ${MAX_DAILY_SPAN_DAYS} days per request`);
  return { from: f, to: t };
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(utcDay(t));
  return out;
}

const emptyChain = (chain: string, evmChainId: number | null): ChainDay => ({
  chain,
  evmChainId,
  transactions: 0,
  activeWallets: 0,
  newWallets: 0,
  bridge: { count: 0, volumeUsdc: "0" },
  swap: { count: 0, volumeUsd: 0 },
  arcPay: { count: 0, volumeUsdc: "0" },
  relay: { count: 0, volumeUsd: 0 },
  relayBridge: { count: 0, volumeUsd: 0 },
});

/** Per-day, per-chain stats for [from, to] (UTC days, inclusive). Every day is present. */
export async function dailyStats(db: Db, ids: ChainIds, from: string, to: string): Promise<StatsDay[]> {
  const per = await all(
    db,
    sql`with a as (${ACTIONS})
        select day, product, chain, count(*) as n, coalesce(sum(base), 0) as base, coalesce(sum(usd), 0) as usd,
               coalesce(sum(xc), 0) as xcn, coalesce(sum(case when xc = 1 then usd else 0 end), 0) as xcusd
          from a where day between ${from} and ${to} group by day, product, chain`,
  );
  // Wallets per chain per day, and which of them were new that day (first action ever).
  const walletsPerChain = await all(
    db,
    sql`with a as (${ACTIONS}), first as (select wallet, min(day) as first_day from a group by wallet)
        select a.day as day, a.chain as chain, count(distinct a.wallet) as active,
               count(distinct case when first.first_day = a.day then a.wallet end) as fresh
          from a join first on first.wallet = a.wallet
         where a.day between ${from} and ${to} group by a.day, a.chain`,
  );
  const walletsPerDay = await all(
    db,
    sql`with a as (${ACTIONS}), first as (select wallet, min(day) as first_day from a group by wallet)
        select a.day as day, count(*) as tx, count(distinct a.wallet) as active,
               count(distinct case when first.first_day = a.day then a.wallet end) as fresh
          from a join first on first.wallet = a.wallet
         where a.day between ${from} and ${to} group by a.day`,
  );

  const byDay = new Map<string, Map<string, ChainDay>>();
  const chainOf = (day: string, raw: string) => {
    const { chain, evmChainId } = resolveChain(raw, ids);
    let m = byDay.get(day);
    if (!m) byDay.set(day, (m = new Map()));
    let c = m.get(chain);
    if (!c) m.set(chain, (c = emptyChain(chain, evmChainId)));
    return c;
  };
  for (const r of per) {
    const c = chainOf(String(r.day), String(r.chain));
    const n = num(r.n);
    const p = String(r.product) as StatsProduct;
    c.transactions += n;
    if (p === "bridge" || p === "arcPay") {
      // Exact: USDC base units summed as bigint, formatted once.
      c[p] = { count: c[p].count + n, volumeUsdc: formatUsdc(parseUsdcString(c[p].volumeUsdc) + big(r.base)) };
    } else {
      c[p] = { count: c[p].count + n, volumeUsd: usd(num(c[p].volumeUsd) + num(r.usd)) };
      if (p === "relay") c.relayBridge = { count: c.relayBridge.count + num(r.xcn), volumeUsd: usd(num(c.relayBridge.volumeUsd) + num(r.xcusd)) };
    }
  }
  for (const r of walletsPerChain) {
    const c = chainOf(String(r.day), String(r.chain));
    // Two raw chains can resolve to one name (Relay's evm id and our id): wallets may overlap,
    // so keep the larger count rather than adding (exact totals are in the per-day rows).
    c.activeWallets = Math.max(c.activeWallets, num(r.active));
    c.newWallets = Math.max(c.newWallets, num(r.fresh));
  }
  const totals = new Map(walletsPerDay.map((r) => [String(r.day), r]));
  return daysBetween(from, to).map((date) => {
    const t = totals.get(date);
    return {
      date,
      transactions: num(t?.tx),
      activeWallets: num(t?.active),
      newWallets: num(t?.fresh),
      chains: [...(byDay.get(date)?.values() ?? [])].sort((a, b) => b.transactions - a.transactions || a.chain.localeCompare(b.chain)),
    };
  });
}

export interface StatsTotals {
  transactions: number;
  wallets: number;
  bridge: { count: number; volumeUsdc: string };
  swap: { count: number; volumeUsd: number };
  arcPay: { count: number; volumeUsdc: string };
  relay: { count: number; volumeUsd: number };
  relayBridge: { count: number; volumeUsd: number };
  chains: number;
}

async function totalsSince(db: Db, ids: ChainIds, fromDay: string | null): Promise<StatsTotals> {
  const where = fromDay ? sql`where day >= ${fromDay}` : sql``;
  const rows = await all(
    db,
    sql`with a as (${ACTIONS})
        select product, count(*) as n, coalesce(sum(base), 0) as base, coalesce(sum(usd), 0) as usd,
               coalesce(sum(xc), 0) as xcn, coalesce(sum(case when xc = 1 then usd else 0 end), 0) as xcusd
          from a ${where} group by product`,
  );
  const [w] = await all(db, sql`with a as (${ACTIONS}) select count(distinct wallet) as wallets from a ${where}`);
  // Relay rows name chains by EVM id: resolve before counting, so Ethereum is one chain.
  const rawChains = await all(db, sql`with a as (${ACTIONS}) select distinct chain from a ${where}`);
  const chains = new Set(rawChains.map((r) => resolveChain(String(r.chain), ids).chain));
  const by = new Map(rows.map((r) => [String(r.product), r]));
  const p = (k: StatsProduct) => by.get(k);
  return {
    transactions: rows.reduce((s, r) => s + num(r.n), 0),
    wallets: num(w?.wallets),
    bridge: { count: num(p("bridge")?.n), volumeUsdc: formatUsdc(big(p("bridge")?.base)) },
    swap: { count: num(p("swap")?.n), volumeUsd: usd(p("swap")?.usd) },
    arcPay: { count: num(p("arcPay")?.n), volumeUsdc: formatUsdc(big(p("arcPay")?.base)) },
    relay: { count: num(p("relay")?.n), volumeUsd: usd(p("relay")?.usd) },
    relayBridge: { count: num(p("relay")?.xcn), volumeUsd: usd(p("relay")?.xcusd) },
    chains: chains.size,
  };
}

export interface SeriesPoint {
  date: string;
  transactions: number;
  activeWallets: number;
  newWallets: number;
  bridgeVolumeUsdc: string;
  swapVolumeUsd: number;
  arcPayVolumeUsdc: string;
  relayVolumeUsd: number;
}

/** All-time and last-30-day totals, plus a daily series of the last SERIES_DAYS days. */
export async function statsSummary(db: Db, ids: ChainIds, now = Date.now()) {
  const today = utcDay(now);
  const from30 = utcDay(now - 29 * DAY_MS);
  const days = await dailyStats(db, ids, utcDay(now - (SERIES_DAYS - 1) * DAY_MS), today);
  const series: SeriesPoint[] = days.map((d) => {
    const bridge = d.chains.reduce((s, c) => s + parseUsdcString(c.bridge.volumeUsdc), 0n);
    const arcPay = d.chains.reduce((s, c) => s + parseUsdcString(c.arcPay.volumeUsdc), 0n);
    const swapUsd = d.chains.reduce((s, c) => s + num(c.swap.volumeUsd), 0);
    const relayUsd = d.chains.reduce((s, c) => s + num(c.relay.volumeUsd), 0);
    return {
      date: d.date,
      transactions: d.transactions,
      activeWallets: d.activeWallets,
      newWallets: d.newWallets,
      bridgeVolumeUsdc: formatUsdc(bridge),
      swapVolumeUsd: usd(swapUsd),
      arcPayVolumeUsdc: formatUsdc(arcPay),
      relayVolumeUsd: usd(relayUsd),
    };
  });
  return {
    generatedAt: new Date(now).toISOString(),
    allTime: await totalsSince(db, ids, null),
    last30d: await totalsSince(db, ids, from30),
    series,
  };
}

/** "12.5" -> 12500000n (USDC base units). Tolerates undefined and integers. */
export function parseUsdcString(s: string | undefined): bigint {
  if (!s) return 0n;
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
}
