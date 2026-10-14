import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { formatUsdc } from "../lib/usdc.js";

/**
 * Admin: Pay by Confluence ID (confluence:admin-pay). Arc to Arc payments (free since
 * confluence:arc-pay-free) and payments to an ID from another chain (bridge transfers with a
 * recipient ID). Everything comes from our own database. Notes are private to the two sides
 * of a payment and are never returned here.
 */

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : v == null ? 0 : Number(v));
const big = (v: unknown) => {
  try {
    return v == null ? 0n : BigInt(typeof v === "number" ? Math.trunc(v) : String(v).split(".")[0]!);
  } catch {
    return 0n;
  }
};
const usdc = (v: unknown) => formatUsdc(big(v));
const iso = (v: unknown) => new Date(num(v)).toISOString();
async function all(db: Db, q: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.all(q)) as Row[];
}

export const PAY_WINDOWS = { d1: 86_400_000, d7: 7 * 86_400_000, d30: 30 * 86_400_000, all: 0 } as const;
/** A paid fee with no payment for this long: the sender should finish it from Activity. */
export const FEE_PAID_WAIT_MS = 60 * 60_000;
/** A reported transaction the tracker hasn't proven after this long is worth a look. */
export const SUBMITTED_WAIT_MS = 30 * 60_000;
export const PAY_PAGE_SIZE = 25;

async function windowStats(db: Db, t0: number) {
  const [a] = await all(
    db,
    sql`select count(*) as completed,
          coalesce(sum(cast(amount_base as integer)), 0) as volume,
          coalesce(sum(case when fee_base = '0' then 1 else 0 end), 0) as free,
          coalesce(sum(case when fee_verified_at is not null then cast(fee_base as integer) else 0 end), 0) as fees,
          count(distinct lower(sender)) as senders,
          count(distinct recipient_id) as recipients
        from arc_payments where state = 'COMPLETED' and created_at >= ${t0}`,
  );
  const [c] = await all(
    db,
    sql`select count(*) as completed,
          coalesce(sum(cast(amount_base as integer)), 0) as volume,
          coalesce(sum(cast(platform_fee_base as integer)), 0) as fees,
          count(distinct lower(sender)) as senders
        from transfers where recipient_id is not null and state = 'COMPLETED' and verified_at is not null and created_at >= ${t0}`,
  );
  const [ids] = await all(db, sql`select count(*) as n from accounts where confluence_id is not null and id_claimed_at >= ${t0}`);
  return {
    arc: {
      completed: num(a?.completed),
      volume: usdc(a?.volume),
      free: num(a?.free),
      feesCollected: usdc(a?.fees),
      senders: num(a?.senders),
      recipients: num(a?.recipients),
    },
    crossChain: { completed: num(c?.completed), volume: usdc(c?.volume), fees: usdc(c?.fees), senders: num(c?.senders) },
    idsClaimed: num(ids?.n),
  };
}

export interface PayAttention {
  id: string;
  chain: string;
  state: string;
  errorCode: string | null;
  reason: string;
  sender: string;
  recipientId: string;
  amount: string;
  fee: string;
  feeTxHash: string | null;
  payTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}

function attentionReason(r: Row): string {
  const state = String(r.state);
  if (state === "COMPLETED") return "Payment reached the recipient, but the fee was never proven (fee_unpaid). Payment created before Arc payments became free.";
  if (state === "FEE_PAID") return "Fee paid over an hour ago and the payment not sent. The sender can finish it from Activity with no new fee.";
  if (state === "FEE_SUBMITTED") return "Fee reported over 30 minutes ago and not proven on Arc yet.";
  return "Payment reported over 30 minutes ago and not proven on Arc yet. Check the Arc RPC and the tracker.";
}

export async function payOverview(db: Db, now = Date.now()) {
  const windows = {
    d1: await windowStats(db, now - PAY_WINDOWS.d1),
    d7: await windowStats(db, now - PAY_WINDOWS.d7),
    d30: await windowStats(db, now - PAY_WINDOWS.d30),
    all: await windowStats(db, 0),
  };
  const byState = Object.fromEntries((await all(db, sql`select state, count(*) as n from arc_payments group by state`)).map((r) => [String(r.state), num(r.n)]));
  const [totals] = await all(
    db,
    sql`select (select count(*) from accounts where confluence_id is not null) as ids,
               (select count(*) from saved_ids) as saved`,
  );
  const rows = await all(
    db,
    sql`select id, chain, state, error_code as errorCode, sender, recipient_id as recipientId, amount_base as amount, fee_base as fee,
               fee_tx_hash as feeTx, pay_tx_hash as payTx, created_at as at, updated_at as up
        from arc_payments
        where (state = 'COMPLETED' and error_code = 'fee_unpaid')
           or (state = 'FEE_PAID' and updated_at < ${now - FEE_PAID_WAIT_MS})
           or (state in ('FEE_SUBMITTED', 'PAYMENT_SUBMITTED') and updated_at < ${now - SUBMITTED_WAIT_MS})
        order by updated_at desc limit 100`,
  );
  const attention: PayAttention[] = rows.map((r) => ({
    id: String(r.id),
    chain: String(r.chain),
    state: String(r.state),
    errorCode: r.errorCode == null ? null : String(r.errorCode),
    reason: attentionReason(r),
    sender: String(r.sender),
    recipientId: String(r.recipientId),
    amount: usdc(r.amount),
    fee: usdc(r.fee),
    feeTxHash: r.feeTx == null ? null : String(r.feeTx),
    payTxHash: r.payTx == null ? null : String(r.payTx),
    createdAt: iso(r.at),
    updatedAt: iso(r.up),
  }));
  return {
    windows,
    byState,
    idsTotal: num(totals?.ids),
    savedIdsTotal: num(totals?.saved),
    attention,
    attentionCounts: {
      feeUnpaid: attention.filter((a) => a.state === "COMPLETED").length,
      waitingToFinish: attention.filter((a) => a.state === "FEE_PAID").length,
      notProven: attention.filter((a) => a.state === "FEE_SUBMITTED" || a.state === "PAYMENT_SUBMITTED").length,
    },
  };
}

/** Arc payments, newest first. `q` matches an id prefix, a Confluence ID, a wallet or a transaction hash. */
export async function payList(db: Db, opts: { q?: string | undefined; state?: string | undefined; page: number }) {
  const page = Math.max(1, Math.floor(opts.page));
  const q = opts.q?.trim().toLowerCase().replace(/^@/, "") ?? "";
  const conds = [sql`1 = 1`];
  if (opts.state) conds.push(sql`state = ${opts.state}`);
  if (q) {
    conds.push(
      sql`(id like ${q + "%"} or recipient_id = ${q} or lower(sender) = ${q} or lower(recipient) = ${q} or lower(fee_tx_hash) = ${q} or lower(pay_tx_hash) = ${q})`,
    );
  }
  const where = sql.join(conds, sql` and `);
  const [{ n } = { n: 0 }] = await all(db, sql`select count(*) as n from arc_payments where ${where}`);
  const rows = await all(
    db,
    sql`select id, state, error_code as errorCode, chain, sender, recipient, recipient_id as recipientId, amount_base as amount, fee_base as fee,
               fee_tx_hash as feeTx, pay_tx_hash as payTx, fee_verified_at as feeOk, pay_verified_at as payOk, created_at as at, updated_at as up
        from arc_payments where ${where}
        order by created_at desc, id desc limit ${PAY_PAGE_SIZE} offset ${(page - 1) * PAY_PAGE_SIZE}`,
  );
  const total = num(n);
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      state: String(r.state),
      errorCode: r.errorCode == null ? null : String(r.errorCode),
      chain: String(r.chain),
      sender: String(r.sender),
      recipient: String(r.recipient),
      recipientId: String(r.recipientId),
      amount: usdc(r.amount),
      fee: usdc(r.fee),
      free: String(r.fee) === "0",
      feeTxHash: r.feeTx == null ? null : String(r.feeTx),
      payTxHash: r.payTx == null ? null : String(r.payTx),
      feeVerified: r.feeOk != null,
      paymentVerified: r.payOk != null,
      createdAt: iso(r.at),
      updatedAt: iso(r.up),
    })),
    page,
    pageSize: PAY_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAY_PAGE_SIZE)),
  };
}
