import { desc, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { relayRequests } from "../db/schema.js";
import type { RelayUpstream } from "./upstream.js";

/**
 * Admin view of Relay routes (R4): counts, volume, quoted vs paid app fees, requests where
 * a fee was expected but none was paid, recent requests, and the accrued app fee balance
 * read from Relay (GET /app-fees/{wallet}/balances). (confluence:relay-admin-overview)
 */
export const RELAY_CLAIM_URL = "https://relay.link/claim-app-fees"; // from https://docs.relay.link/features/app-fees

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0);

/**
 * Uncollected app fees (confluence:uncollected-summary): a fee was set, the route succeeded,
 * but Relay's record shows nothing paid. Relay's docs list why that happens, without an error:
 * unsupported transaction types, an input that isn't a solver-held currency, or a fee smaller
 * than the gas it would cost to collect (https://docs.relay.link/features/app-fees). Relay gives
 * no per-request reason and publishes no threshold, so quoted fees under SMALL_FEE_USD
 * (Confluence's own cutoff) are reported as "small" (expected) and larger ones as worth checking.
 * These are real, successful transfers and are never pruned; the summary has a fixed size
 * however many accumulate.
 */
export const SMALL_FEE_USD = 0.05;

const UNCOLLECTED = sql`status = 'success' and verified_at is not null and enriched_at is not null and app_fee_bps > 0 and coalesce(cast(app_fee_paid_usd as real), 0) = 0`;

async function uncollectedSummary(db: Db, now: number) {
  const d7 = now - 7 * 24 * 3600_000;
  const d30 = now - 30 * 24 * 3600_000;
  const q = sql`cast(app_fee_quoted_usd as real)`;
  const win = (k: string, since: number | null) => {
    const inWin = since === null ? sql`1` : sql`created_at >= ${since}`;
    const as = (name: string) => sql.raw(`${k}_${name}`);
    return sql`sum(case when ${inWin} then 1 else 0 end) as ${as("count")},
      sum(case when ${inWin} then coalesce(${q}, 0) else 0 end) as ${as("quoted")},
      sum(case when ${inWin} and ${q} < ${SMALL_FEE_USD} then 1 else 0 end) as ${as("small")},
      sum(case when ${inWin} and ${q} >= ${SMALL_FEE_USD} then 1 else 0 end) as ${as("larger")},
      sum(case when ${inWin} and app_fee_quoted_usd is null then 1 else 0 end) as ${as("unknown")}`;
  };
  const [row = {}] = (await db.all(
    sql`select ${win("d7", d7)}, ${win("d30", d30)}, ${win("all", null)} from relay_requests where ${UNCOLLECTED}`,
  )) as Record<string, unknown>[];
  const pick = (k: string) => ({
    count: num(row[`${k}_count`]),
    quotedUsd: num(row[`${k}_quoted`]),
    small: num(row[`${k}_small`]),
    larger: num(row[`${k}_larger`]),
    unknown: num(row[`${k}_unknown`]),
  });
  const byRoute = (await db.all(sql`
    select origin_chain_name as origin, destination_chain_name as destination, symbol_in as symbolIn, symbol_out as symbolOut,
           count(*) as n, sum(coalesce(${q}, 0)) as quoted, max(${q}) as maxQuoted, max(created_at) as lastAt
    from relay_requests where ${UNCOLLECTED}
    group by origin_chain_id, destination_chain_id, symbol_in, symbol_out
    order by n desc, lastAt desc limit 10`)) as Record<string, unknown>[];
  const larger = (await db.all(sql`
    select request_id as requestId, origin_chain_name as origin, destination_chain_name as destination, symbol_in as symbolIn, symbol_out as symbolOut,
           app_fee_quoted_usd as quotedUsd, amount_in_usd as amountInUsd, created_at as createdAt
    from relay_requests where ${UNCOLLECTED} and ${q} >= ${SMALL_FEE_USD}
    order by created_at desc limit 10`)) as Record<string, unknown>[];
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
  return {
    smallFeeCutoffUsd: SMALL_FEE_USD,
    windows: { d7: pick("d7"), d30: pick("d30"), all: pick("all") },
    byRoute: byRoute.map((r) => ({
      origin: str(r.origin),
      destination: str(r.destination),
      symbolIn: str(r.symbolIn) ?? "?",
      symbolOut: str(r.symbolOut) ?? "?",
      count: num(r.n),
      quotedUsd: num(r.quoted),
      maxQuotedUsd: num(r.maxQuoted),
      lastAt: new Date(num(r.lastAt)).toISOString(),
    })),
    larger: larger.map((r) => ({
      requestId: str(r.requestId) ?? "",
      origin: str(r.origin),
      destination: str(r.destination),
      symbolIn: str(r.symbolIn) ?? "?",
      symbolOut: str(r.symbolOut) ?? "?",
      quotedUsd: num(r.quotedUsd),
      amountInUsd: r.amountInUsd === null || r.amountInUsd === undefined ? null : num(r.amountInUsd),
      createdAt: new Date(num(r.createdAt)).toISOString(),
    })),
  };
}

export async function relayOverview(db: Db, upstream: RelayUpstream, recipient: string | null) {
  const now = Date.now();
  const windows: Record<string, number> = { d1: 1, d7: 7, d30: 30 };
  const out: Record<string, { requests: number; success: number; volumeUsd: number; appFeeQuotedUsd: number; appFeePaidUsd: number }> = {};
  for (const [k, days] of Object.entries(windows)) {
    const since = now - days * 24 * 3600_000;
    const [r] = (await db.all(sql`
      select count(*) as requests,
             sum(case when status = 'success' then 1 else 0 end) as success,
             sum(case when status = 'success' then cast(amount_in_usd as real) else 0 end) as volume,
             sum(case when status = 'success' then cast(app_fee_quoted_usd as real) else 0 end) as quoted,
             sum(case when status = 'success' then cast(app_fee_paid_usd as real) else 0 end) as paid
      from relay_requests where created_at >= ${since} and verified_at is not null`)) as Record<string, unknown>[];
    out[k] = { requests: num(r?.requests), success: num(r?.success), volumeUsd: num(r?.volume), appFeeQuotedUsd: num(r?.quoted), appFeePaidUsd: num(r?.paid) };
  }
  const byStatus = Object.fromEntries(
    ((await db.all(sql`select status, count(*) as n from relay_requests where verified_at is not null group by status`)) as { status: string; n: unknown }[]).map((r) => [r.status, num(r.n)]),
  );
  const uncollected = await uncollectedSummary(db, now);
  const recent = await db.select().from(relayRequests).orderBy(desc(relayRequests.createdAt)).limit(20);

  let balance: { totalBalanceUsd: number | null; availableBalanceUsd: number | null; items: { symbol: string; chainId: number | null; amount: string; amountUsd: string | null }[] } | { error: string } | null = null;
  if (recipient && upstream.configured) {
    try {
      const res = await upstream.request("GET", `/app-fees/${recipient}/balances`, undefined, 60_000);
      if (res.status === 200) {
        const b = (res.body ?? {}) as { balances?: { currency?: { symbol?: string; chainId?: number }; amountFormatted?: string; amountUsd?: string }[]; totalBalanceUsd?: number; availableBalanceUsd?: number };
        balance = {
          totalBalanceUsd: typeof b.totalBalanceUsd === "number" ? b.totalBalanceUsd : null,
          availableBalanceUsd: typeof b.availableBalanceUsd === "number" ? b.availableBalanceUsd : null,
          items: (b.balances ?? []).map((x) => ({ symbol: x.currency?.symbol ?? "?", chainId: x.currency?.chainId ?? null, amount: x.amountFormatted ?? "0", amountUsd: x.amountUsd ?? null })),
        };
      } else balance = { error: `Relay answered HTTP ${res.status}` };
    } catch {
      balance = { error: "Could not reach Relay" };
    }
  }

  return {
    windows: out,
    byStatus,
    uncollected,
    recent: recent.map((r) => ({
      requestId: r.requestId,
      user: r.userAddress,
      route: `${r.originChainName ?? r.originChainId} → ${r.destinationChainName ?? r.destinationChainId}`,
      pair: `${r.symbolIn} → ${r.symbolOut}`,
      status: r.status,
      amountInUsd: r.amountInUsd,
      appFeeBps: r.appFeeBps,
      appFeeQuotedUsd: r.appFeeQuotedUsd,
      appFeePaidUsd: r.appFeePaidUsd,
      createdAt: r.createdAt.toISOString(),
    })),
    balance,
    claimUrl: RELAY_CLAIM_URL,
  };
}
