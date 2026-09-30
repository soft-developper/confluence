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
  // A fee was set and the route succeeded, but Relay's record shows nothing paid.
  const uncollected = (await db.all(sql`
    select request_id as requestId, symbol_in as symbolIn, symbol_out as symbolOut, origin_chain_name as origin, destination_chain_name as destination,
           app_fee_bps as bps, app_fee_quoted_usd as quotedUsd, created_at as createdAt
    from relay_requests
    where status = 'success' and verified_at is not null and enriched_at is not null and app_fee_bps > 0 and coalesce(cast(app_fee_paid_usd as real), 0) = 0
    order by created_at desc limit 20`)) as Record<string, unknown>[];
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
    uncollected: uncollected.map((u) => ({ ...u, createdAt: new Date(num(u.createdAt)).toISOString() })),
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
