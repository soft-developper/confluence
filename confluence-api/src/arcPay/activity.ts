import { randomBytes, createHash } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { idProblem, normalizeId } from "../accounts/service.js";
import type { Db } from "../db/client.js";
import { accounts, arcPaymentEvents, arcPayments, savedIds, transfers } from "../db/schema.js";
import { formatUsdc } from "../lib/usdc.js";

/**
 * Pay page data for the signed-in wallet (confluence:arc-pay): Activity (payments to and
 * from Confluence IDs), monthly totals, finishing a payment whose fee is paid, and Saved
 * IDs. Addresses are compared in lowercase; the session address is already lowercase.
 */

export class PayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const ACTIVITY_PAGE_SIZE = 20;
export const SAVED_IDS_MAX = 100;

/** Arc payments worth showing to the sender: something was signed. Created/failed/expired are noise. */
const SENT_ARC_STATES = ["FEE_SUBMITTED", "FEE_PAID", "PAYMENT_SUBMITTED", "COMPLETED"] as const;
/** A transfer counts once Circle verified it or its burn was proven on the source chain. */
const PROVEN_TRANSFER = sql`(${transfers.verifiedAt} is not null or ${transfers.sourceBurnAt} is not null)`;

export interface ActivityItem {
  kind: "arc" | "bridge";
  id: string;
  direction: "sent" | "received";
  /** The other side's Confluence ID (null when they have none). */
  counterpartyId: string | null;
  counterparty: string;
  amount: string;
  /** Platform fee the sender paid (sent items only). */
  fee: string | null;
  sourceChain: string;
  destinationChain: string;
  state: string;
  errorCode: string | null;
  note: string | null;
  /** The transaction that moved the money: payment on Arc, or the burn for a bridge. */
  txHash: string | null;
  /** Sent Arc payment with its fee paid and the payment not done: can be finished. */
  canFinish: boolean;
  createdAt: string;
}

export async function activity(db: Db, me: string, opts: { direction: "sent" | "received"; page: number }) {
  const lim = ACTIVITY_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page));
  const offset = (page - 1) * lim;
  const sent = opts.direction === "sent";

  const arcWhere = sent
    ? and(sql`lower(${arcPayments.sender}) = ${me}`, inArray(arcPayments.state, [...SENT_ARC_STATES]))!
    : and(sql`lower(${arcPayments.recipient}) = ${me}`, eq(arcPayments.state, "COMPLETED"))!;
  const bridgeWhere = sent
    ? and(sql`lower(${transfers.sender}) = ${me}`, sql`${transfers.recipientId} is not null`, PROVEN_TRANSFER)!
    : and(sql`lower(${transfers.recipient}) = ${me}`, sql`lower(${transfers.sender}) <> ${me}`, sql`${transfers.recipientId} is not null`, PROVEN_TRANSFER)!;

  const [{ n: nA } = { n: 0 }] = await db.select({ n: count() }).from(arcPayments).where(arcWhere);
  const [{ n: nB } = { n: 0 }] = await db.select({ n: count() }).from(transfers).where(bridgeWhere);
  const total = Number(nA) + Number(nB);

  const refs = (await db.all(
    sql`select 'arc' as kind, id, created_at as at from ${arcPayments} where ${arcWhere}
        union all
        select 'bridge' as kind, id, created_at as at from ${transfers} where ${bridgeWhere}
        order by at desc, id desc limit ${lim} offset ${offset}`,
  )) as { kind: "arc" | "bridge"; id: string }[];

  const arcIds = refs.filter((r) => r.kind === "arc").map((r) => r.id);
  const bridgeIds = refs.filter((r) => r.kind === "bridge").map((r) => r.id);
  const arcRows = arcIds.length ? await db.select().from(arcPayments).where(inArray(arcPayments.id, arcIds)) : [];
  const bridgeRows = bridgeIds.length ? await db.select().from(transfers).where(inArray(transfers.id, bridgeIds)) : [];

  // Received items name the payer by their Confluence ID, when they have one.
  const payerAddrs = sent ? [] : [...new Set([...arcRows.map((r) => r.sender.toLowerCase()), ...bridgeRows.map((r) => r.sender.toLowerCase())])];
  const payerIds = new Map(
    payerAddrs.length ? (await db.select({ a: accounts.address, id: accounts.confluenceId }).from(accounts).where(inArray(accounts.address, payerAddrs))).map((r) => [r.a, r.id]) : [],
  );

  const items: (ActivityItem & { at: number })[] = [
    ...arcRows.map((r) => ({
      kind: "arc" as const,
      id: r.id,
      direction: opts.direction,
      counterpartyId: sent ? r.recipientId : (payerIds.get(r.sender.toLowerCase()) ?? null),
      counterparty: getAddress(sent ? r.recipient : r.sender),
      amount: formatUsdc(BigInt(r.amountBase)),
      fee: sent ? formatUsdc(BigInt(r.feeBase)) : null,
      sourceChain: r.chain,
      destinationChain: r.chain,
      state: r.state,
      errorCode: r.errorCode,
      note: r.note,
      txHash: r.payTxHash,
      canFinish: sent && r.state === "FEE_PAID",
      createdAt: r.createdAt.toISOString(),
      at: r.createdAt.getTime(),
    })),
    ...bridgeRows.map((r) => ({
      kind: "bridge" as const,
      id: r.id,
      direction: opts.direction,
      counterpartyId: sent ? r.recipientId : (payerIds.get(r.sender.toLowerCase()) ?? null),
      counterparty: getAddress(sent ? r.recipient : r.sender),
      amount: formatUsdc(BigInt(r.amountBase)),
      fee: sent ? formatUsdc(BigInt(r.platformFeeBase)) : null,
      sourceChain: r.sourceChain,
      destinationChain: r.destinationChain,
      state: r.state,
      errorCode: r.errorCode,
      note: r.note,
      txHash: r.burnTxHash,
      canFinish: false,
      createdAt: r.createdAt.toISOString(),
      at: r.createdAt.getTime(),
    })),
  ];
  items.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  return {
    items: items.map(({ at: _at, ...rest }) => rest),
    page,
    pageSize: lim,
    total,
    totalPages: Math.max(1, Math.ceil(total / lim)),
  };
}

/** Completed payments sent and received since `since` (the Pay page shows the current month). */
export async function payTotals(db: Db, me: string, since: Date) {
  const t = since.getTime();
  const sum = async (q: ReturnType<typeof sql>) => BigInt(String(((await db.all(q)) as { s: unknown }[])[0]?.s ?? 0));
  const sentArc = await sum(sql`select coalesce(sum(cast(amount_base as integer)), 0) as s from ${arcPayments} where lower(sender) = ${me} and state = 'COMPLETED' and created_at >= ${t}`);
  const recvArc = await sum(sql`select coalesce(sum(cast(amount_base as integer)), 0) as s from ${arcPayments} where lower(recipient) = ${me} and state = 'COMPLETED' and created_at >= ${t}`);
  const sentBridge = await sum(
    sql`select coalesce(sum(cast(amount_base as integer)), 0) as s from ${transfers} where lower(sender) = ${me} and recipient_id is not null and state = 'COMPLETED' and verified_at is not null and created_at >= ${t}`,
  );
  const recvBridge = await sum(
    sql`select coalesce(sum(cast(amount_base as integer)), 0) as s from ${transfers} where lower(recipient) = ${me} and lower(sender) <> ${me} and recipient_id is not null and state = 'COMPLETED' and verified_at is not null and created_at >= ${t}`,
  );
  return { since: since.toISOString(), sent: formatUsdc(sentArc + sentBridge), received: formatUsdc(recvArc + recvBridge) };
}

/** First day of the current month, UTC. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Lets the signed-in sender finish an Arc payment whose fee is already sent: issues a fresh
 * report token (the old one, kept by a closed tab, stops working). Never charges the fee again.
 */
export async function resumeArcPayment(db: Db, me: string, paymentId: string) {
  const p = await db.query.arcPayments.findFirst({ where: eq(arcPayments.id, paymentId) });
  if (!p || p.sender.toLowerCase() !== me) throw new PayError(404, "payment_not_found", "payment not found");
  if (p.state !== "FEE_SUBMITTED" && p.state !== "FEE_PAID") throw new PayError(409, "not_resumable", "only a payment whose fee was sent can be finished");
  const token = randomBytes(32).toString("base64url");
  await db.batch([
    db.update(arcPayments).set({ reportTokenHash: sha256(token) }).where(eq(arcPayments.id, p.id)),
    db.insert(arcPaymentEvents).values({ paymentId: p.id, fromState: p.state, toState: p.state, source: "client", detail: { action: "resume" } }),
  ]);
  return {
    id: p.id,
    reportToken: token,
    state: p.state,
    recipient: getAddress(p.recipient),
    recipientId: p.recipientId,
    amount: { base: p.amountBase, usdc: formatUsdc(BigInt(p.amountBase)) },
  };
}

// ---------- Saved IDs ----------

export async function listSavedIds(db: Db, me: string) {
  const rows = await db
    .select({ handle: savedIds.handle, createdAt: savedIds.createdAt, address: accounts.address })
    .from(savedIds)
    .leftJoin(accounts, eq(accounts.confluenceId, savedIds.handle))
    .where(eq(savedIds.owner, me))
    .orderBy(savedIds.handle);
  // An ID is permanent, so the join always finds it; skip defensively if not.
  return rows.filter((r) => r.address).map((r) => ({ handle: r.handle, address: getAddress(r.address!), createdAt: r.createdAt.toISOString() }));
}

export async function saveId(db: Db, me: string, raw: string) {
  const handle = normalizeId(raw);
  const acct = idProblem(handle) ? undefined : await db.query.accounts.findFirst({ where: eq(accounts.confluenceId, handle) });
  if (!acct) throw new PayError(404, "id_not_found", "no one has claimed this Confluence ID");
  if (acct.address.toLowerCase() === me) throw new PayError(400, "own_id", "you can't save your own Confluence ID");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(savedIds).where(eq(savedIds.owner, me));
  const exists = await db.query.savedIds.findFirst({ where: and(eq(savedIds.owner, me), eq(savedIds.handle, handle)) });
  if (!exists && Number(n) >= SAVED_IDS_MAX) throw new PayError(409, "saved_ids_full", `you can save up to ${SAVED_IDS_MAX} IDs`);
  await db.insert(savedIds).values({ owner: me, handle }).onConflictDoNothing();
  return listSavedIds(db, me);
}

export async function removeSavedId(db: Db, me: string, raw: string) {
  await db.delete(savedIds).where(and(eq(savedIds.owner, me), eq(savedIds.handle, normalizeId(raw))));
  return listSavedIds(db, me);
}
