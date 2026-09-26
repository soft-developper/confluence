import { sql } from "drizzle-orm";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { activeFeeRecipient } from "../fees/quote.js";
import { formatUsdc } from "../lib/usdc.js";
import { ethCall } from "../tracker/chainReads.js";

/**
 * Admin analytics (A2). Everything comes from our own database (transfers, swaps), so the
 * numbers match what users did through Confluence. Bridge amounts are USDC base units;
 * swap amounts are human-readable per token (tokens differ), so swap volume is reported
 * per token, never summed across tokens.
 */
export const RANGES = { "24h": 24 * 3600_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000, all: 0 } as const;
export type Range = keyof typeof RANGES;
const since = (r: Range, now = Date.now()) => (RANGES[r] ? now - RANGES[r] : 0);

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : v == null ? 0 : Number(v));
const big = (v: unknown) => {
  try {
    return v == null ? 0n : BigInt(typeof v === "number" ? Math.trunc(v) : String(v).split(".")[0]!);
  } catch {
    return 0n;
  }
};
const usdc = (v: unknown) => ({ base: big(v).toString(), usdc: formatUsdc(big(v)) });

async function all(db: Db, q: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.all(q)) as Row[];
}

// ---------- overview ----------

export async function overview(db: Db, range: Range) {
  const t0 = since(range);
  const [b] = await all(
    db,
    sql`select count(*) as total,
          sum(case when state = 'COMPLETED' then 1 else 0 end) as completed,
          sum(case when state = 'FAILED' then 1 else 0 end) as failed,
          sum(case when state = 'RECOVERY_REQUIRED' then 1 else 0 end) as recovery,
          sum(case when state = 'COMPLETED' then cast(amount_base as integer) else 0 end) as volume,
          sum(case when state = 'COMPLETED' then cast(platform_fee_base as integer) else 0 end) as fees
        from transfers where created_at >= ${t0}`,
  );
  const [s] = await all(
    db,
    sql`select count(*) as total,
          sum(case when state = 'COMPLETED' then 1 else 0 end) as completed,
          sum(case when state = 'FAILED' then 1 else 0 end) as failed
        from swaps where created_at >= ${t0}`,
  );
  const swapVolume = await all(
    db,
    sql`select token_in as token, count(*) as swaps, sum(cast(amount_in as real)) as volume
        from swaps where state = 'COMPLETED' and created_at >= ${t0} group by token_in order by swaps desc`,
  );
  const swapFees = await all(
    db,
    sql`select fee_token as token, sum(cast(fee_charged as real)) as fees
        from swaps where state = 'COMPLETED' and fee_charged is not null and created_at >= ${t0} group by fee_token`,
  );
  const bDone = num(b?.completed);
  const bEnded = bDone + num(b?.failed) + num(b?.recovery);
  const sDone = num(s?.completed);
  const sEnded = sDone + num(s?.failed);
  return {
    range,
    bridge: {
      total: num(b?.total),
      completed: bDone,
      failed: num(b?.failed),
      needsRecovery: num(b?.recovery),
      inProgress: num(b?.total) - bEnded,
      successRate: bEnded ? bDone / bEnded : null,
      volume: usdc(b?.volume),
      platformFees: usdc(b?.fees),
    },
    swap: {
      total: num(s?.total),
      completed: sDone,
      failed: num(s?.failed),
      inProgress: num(s?.total) - sEnded,
      successRate: sEnded ? sDone / sEnded : null,
      volumeByToken: swapVolume.map((r) => ({ token: String(r.token), swaps: num(r.swaps), volume: num(r.volume) })),
      feesByToken: swapFees.map((r) => ({ token: String(r.token), fees: num(r.fees) })),
    },
  };
}

// ---------- daily series ----------

export async function timeseries(db: Db, range: Exclude<Range, "all" | "24h">, now = Date.now()) {
  const days = RANGES[range] / 86_400_000;
  const t0 = now - RANGES[range];
  const b = await all(
    db,
    sql`select date(created_at / 1000, 'unixepoch') as day, count(*) as bridges,
          sum(case when state = 'COMPLETED' then cast(amount_base as integer) else 0 end) as volume,
          sum(case when state = 'COMPLETED' then cast(platform_fee_base as integer) else 0 end) as fees
        from transfers where created_at >= ${t0} group by day`,
  );
  const s = await all(
    db,
    sql`select date(created_at / 1000, 'unixepoch') as day, count(*) as swaps,
          sum(case when state = 'COMPLETED' then 1 else 0 end) as swapsCompleted
        from swaps where created_at >= ${t0} group by day`,
  );
  const bm = new Map(b.map((r) => [String(r.day), r]));
  const sm = new Map(s.map((r) => [String(r.day), r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10); // UTC days, filled with zeros
    const br = bm.get(day);
    const sr = sm.get(day);
    out.push({
      day,
      bridges: num(br?.bridges),
      bridgeVolume: usdc(br?.volume),
      bridgeFees: usdc(br?.fees),
      swaps: num(sr?.swaps),
      swapsCompleted: num(sr?.swapsCompleted),
    });
  }
  return { range, days: out };
}

// ---------- routes ----------

export async function routes(db: Db, range: Range) {
  const t0 = since(range);
  const bridgeRoutes = await all(
    db,
    sql`select source_chain as source, destination_chain as destination, count(*) as count,
          sum(case when state = 'COMPLETED' then cast(amount_base as integer) else 0 end) as volume
        from transfers where created_at >= ${t0}
        group by source_chain, destination_chain order by count desc limit 10`,
  );
  const speed = await all(db, sql`select speed, count(*) as count from transfers where created_at >= ${t0} group by speed`);
  const forwarding = await all(db, sql`select use_forwarder as on_, count(*) as count from transfers where created_at >= ${t0} group by use_forwarder`);
  const pairs = await all(
    db,
    sql`select chain, coalesce(destination_chain, chain) as destination, token_in as tokenIn, token_out as tokenOut, count(*) as count
        from swaps where created_at >= ${t0}
        group by chain, coalesce(destination_chain, chain), token_in, token_out order by count desc limit 10`,
  );
  return {
    range,
    bridgeRoutes: bridgeRoutes.map((r) => ({ source: String(r.source), destination: String(r.destination), count: num(r.count), volume: usdc(r.volume) })),
    speed: Object.fromEntries(speed.map((r) => [String(r.speed), num(r.count)])),
    forwarding: { on: num(forwarding.find((r) => num(r.on_) === 1)?.count), off: num(forwarding.find((r) => num(r.on_) === 0)?.count) },
    swapPairs: pairs.map((r) => ({ chain: String(r.chain), destination: String(r.destination), tokenIn: String(r.tokenIn), tokenOut: String(r.tokenOut), count: num(r.count) })),
  };
}

// ---------- activity feed ----------

export interface ActivityQuery {
  q?: string | undefined;
  kind?: "bridge" | "swap" | undefined;
  state?: string | undefined;
  before?: number | undefined;
  limit: number;
}

/** Latest bridges and swaps; `q` matches an id prefix, a wallet, or a transaction hash. */
export async function activity(db: Db, a: ActivityQuery) {
  const lim = Math.min(Math.max(a.limit, 1), 100);
  const q = a.q?.trim().toLowerCase();
  const before = a.before ?? Number.MAX_SAFE_INTEGER;
  const tq = q
    ? sql`and (id like ${q + "%"} or lower(sender) = ${q} or lower(recipient) = ${q} or lower(coalesce(burn_tx_hash,'')) = ${q} or lower(coalesce(mint_tx_hash,'')) = ${q} or coalesce(recipient_id,'') = ${q.replace(/^@/, "")})`
    : sql``;
  const sq = q
    ? sql`and (id like ${q + "%"} or lower(sender) = ${q} or lower(recipient) = ${q} or lower(coalesce(swap_tx_hash,'')) = ${q})`
    : sql``;
  const st = a.state ? sql`and state = ${a.state}` : sql``;
  const bridges =
    a.kind === "swap"
      ? []
      : await all(
          db,
          sql`select 'bridge' as kind, id, state, created_at as at, source_chain as source, destination_chain as destination,
                sender, recipient, recipient_id as recipientId, amount_base as amount, platform_fee_base as fee, error_code as errorCode, burn_tx_hash as txHash
              from transfers where created_at < ${before} ${tq} ${st} order by created_at desc limit ${lim}`,
        );
  const swaps =
    a.kind === "bridge"
      ? []
      : await all(
          db,
          sql`select 'swap' as kind, id, state, created_at as at, chain as source, destination_chain as destination,
                sender, recipient, token_in as tokenIn, token_out as tokenOut, amount_in as amount, fee_charged as fee, error_code as errorCode, swap_tx_hash as txHash
              from swaps where created_at < ${before} ${sq} ${st} order by created_at desc limit ${lim}`,
        );
  const items = [...bridges, ...swaps]
    .sort((x, y) => num(y.at) - num(x.at))
    .slice(0, lim)
    .map((r) => ({
      kind: String(r.kind) as "bridge" | "swap",
      id: String(r.id),
      state: String(r.state),
      createdAt: new Date(num(r.at)).toISOString(),
      source: String(r.source),
      destination: r.destination == null ? null : String(r.destination),
      sender: String(r.sender),
      recipient: String(r.recipient),
      recipientId: r.recipientId == null ? null : String(r.recipientId),
      amount: r.kind === "bridge" ? formatUsdc(big(r.amount)) : String(r.amount),
      token: r.kind === "bridge" ? "USDC" : `${String(r.tokenIn)} → ${String(r.tokenOut)}`,
      fee: r.fee == null ? null : r.kind === "bridge" ? formatUsdc(big(r.fee)) : String(r.fee),
      errorCode: r.errorCode == null ? null : String(r.errorCode),
      txHash: r.txHash == null ? null : String(r.txHash),
    }));
  const last = items.at(-1);
  return { items, nextBefore: items.length === lim && last ? new Date(last.createdAt).getTime() : null };
}

// ---------- problem queue ----------

/** Transfers and swaps that need a human: recovery cases, mismatches, and long-stuck ones. */
export async function problems(db: Db, now = Date.now()) {
  const fastStuck = now - 60 * 60_000; // Fast should finish within minutes
  const slowStuck = now - 48 * 60 * 60_000; // Standard can take hours on some chains
  const t = await all(
    db,
    sql`select id, state, error_code as errorCode, created_at as at, speed, source_chain as source, destination_chain as destination, sender, amount_base as amount
        from transfers
        where state = 'RECOVERY_REQUIRED'
           or error_code in ('forward_failed', 'burn_mismatch', 'burn_not_found')
           or (state in ('BURN_SUBMITTED', 'BURN_CONFIRMED', 'ATTESTATION_PENDING', 'ATTESTED', 'MINT_SUBMITTED')
               and ((speed = 'FAST' and created_at < ${fastStuck}) or (speed = 'SLOW' and created_at < ${slowStuck})))
        order by created_at desc limit 200`,
  );
  const s = await all(
    db,
    sql`select id, state, error_code as errorCode, created_at as at, chain as source, sender, amount_in as amount, token_in as token
        from swaps
        where error_code = 'fee_mismatch' or (state = 'SUBMITTED' and created_at < ${now - 60 * 60_000})
        order by created_at desc limit 200`,
  );
  const reason = (r: Row, kind: "bridge" | "swap") => {
    const code = r.errorCode == null ? null : String(r.errorCode);
    if (kind === "swap") return code === "fee_mismatch" ? "Circle charged a different fee than ours" : "Swap submitted over an hour ago and not settled";
    if (code === "forward_failed") return "Circle's forwarded mint failed; the user can Complete mint";
    if (code === "burn_mismatch") return "Reported burn does not match the transfer";
    if (code === "burn_not_found") return "Circle has no record of the reported burn";
    if (String(r.state) === "RECOVERY_REQUIRED") return `Needs recovery${code ? ` (${code})` : ""}`;
    return `${String(r.speed) === "FAST" ? "Fast" : "Standard"} transfer still in progress after an unusually long time`;
  };
  return {
    items: [
      ...t.map((r) => ({
        kind: "bridge" as const,
        id: String(r.id),
        state: String(r.state),
        reason: reason(r, "bridge"),
        createdAt: new Date(num(r.at)).toISOString(),
        route: `${String(r.source)} → ${String(r.destination)}`,
        sender: String(r.sender),
        amount: `${formatUsdc(big(r.amount))} USDC`,
      })),
      ...s.map((r) => ({
        kind: "swap" as const,
        id: String(r.id),
        state: String(r.state),
        reason: reason(r, "swap"),
        createdAt: new Date(num(r.at)).toISOString(),
        route: String(r.source),
        sender: String(r.sender),
        amount: `${String(r.amount)} ${String(r.token)}`,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

// ---------- fee treasury ----------

/** Warn when fees sit in a plain wallet (not a multisig contract) above this total. */
export const MULTISIG_WARNING_USDC = 1_000_000_000n; // 1,000 USDC
const BALANCE_OF = "0x70a08231"; // balanceOf(address)

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

/**
 * The fee recipient's live USDC balance on every chain (read from each chain), next to
 * the fees our records say were earned there. Sweeping funds is a later step.
 */
export async function treasury(db: Db, registry: ChainRegistry, fetchImpl: typeof fetch = fetch) {
  const earned = new Map(
    (
      await all(
        db,
        sql`select source_chain as chain, sum(cast(platform_fee_base as integer)) as fees
            from transfers where state = 'COMPLETED' group by source_chain`,
      )
    ).map((r) => [String(r.chain), big(r.fees)]),
  );
  const rows = await mapLimit(registry.chains, 5, async (c) => {
    const recipient = await activeFeeRecipient(db, c.id);
    if (!recipient) return { chain: c.id, name: c.name, recipient: null, balance: null, isContract: null, earned: usdc(earned.get(c.id) ?? 0n), error: "no fee recipient" };
    try {
      const data = BALANCE_OF + recipient.slice(2).toLowerCase().padStart(64, "0");
      const [bal, code] = await Promise.all([
        ethCall(c.rpcUrls, c.usdcAddress, data, fetchImpl),
        rpc(c.rpcUrls, "eth_getCode", [recipient, "latest"], fetchImpl),
      ]);
      return {
        chain: c.id,
        name: c.name,
        recipient,
        balance: usdc(bal === "0x" ? 0n : BigInt(bal)),
        isContract: typeof code === "string" && code !== "0x",
        earned: usdc(earned.get(c.id) ?? 0n),
        error: null,
      };
    } catch (e) {
      return { chain: c.id, name: c.name, recipient, balance: null, isContract: null, earned: usdc(earned.get(c.id) ?? 0n), error: e instanceof Error ? e.message.slice(0, 120) : "read failed" };
    }
  });
  const total = rows.reduce((s, r) => s + (r.balance ? BigInt(r.balance.base) : 0n), 0n);
  const plainWallet = rows.some((r) => r.isContract === false);
  return {
    chains: rows,
    total: usdc(total),
    multisigWarning: plainWallet && total >= MULTISIG_WARNING_USDC,
    multisigWarningThreshold: usdc(MULTISIG_WARNING_USDC),
  };
}

async function rpc(urls: readonly string[], method: string, params: unknown[], fetchImpl: typeof fetch): Promise<unknown> {
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8_000),
      });
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? "rpc error");
      return j.result;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("rpc failed");
}
