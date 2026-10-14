import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import { AccountError, lookupId } from "../accounts/service.js";
import { disabledChainIds } from "../chains/availability.js";
import type { BridgeChain, ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { arcPaymentEvents, arcPayments, type ArcPaymentState } from "../db/schema.js";
import { formatUsdc, parseUsdc } from "../lib/usdc.js";
import { getBlockTimeMs, getReceipt } from "../tracker/chainReads.js";
import { cleanNote, NOTE_MAX, NoteError } from "./note.js";
import { applyReport, checkUsdcTransfer, decideArcPayment, EXPIRE_AFTER_MS, isFree, tooOld, type ArcPayStep, type ArcPayStepState, type TransferCheck } from "./rules.js";

/**
 * Pay by Confluence ID, Arc to Arc (confluence:arc-pay). See rules.ts for the flow.
 * Every money value comes from the server: the amount is parsed here, the fee is the
 * platform rule, the recipient is resolved from the ID and the fee recipient from the
 * fee table. The browser only signs and reports.
 *
 * Arc to Arc payments are free (confluence:arc-pay-free): no Confluence fee, one transfer.
 * Payments to an ID from another chain go through the bridge and keep the bridge fee.
 */

/** Confluence fee on an Arc to Arc payment. Free while Pay grows. */
export const ARC_PAY_FEE_BASE = 0n;
/** Stored in fee_recipient (not null) for free payments: no fee is ever sent there. */
const NO_FEE_RECIPIENT = "0x0000000000000000000000000000000000000000";

export class ArcPayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_EVENTS_PER_PAYMENT = 50;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const money = (base: string | bigint) => ({ base: base.toString(), usdc: formatUsdc(BigInt(base)) });

function tokenMatches(token: string | undefined, hash: string | null): boolean {
  if (!token || !hash) return false;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function uniqueViolationColumn(e: unknown): string | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const m = /UNIQUE constraint failed: ([\w.]+)/i.exec(String((cur as { message?: unknown }).message ?? ""));
    if (m?.[1]) return m[1];
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** The Arc chain of this environment, from the registry (never hard-coded). */
export function arcChain(registry: ChainRegistry): BridgeChain | undefined {
  return registry.chains.find((c) => c.id === "Arc" || c.id === "Arc_Testnet");
}

export { NOTE_MAX };

function noteOrThrow(raw: string | undefined): string | null {
  try {
    return cleanNote(raw);
  } catch (e) {
    if (e instanceof NoteError) throw new ArcPayError(400, e.code, e.message);
    throw e;
  }
}

export interface CreateArcPaymentInput {
  sender: string;
  recipientId: string;
  amount: string;
  note?: string | undefined;
  idempotencyKey: string;
}

export async function createArcPayment(db: Db, registry: ChainRegistry, input: CreateArcPaymentInput) {
  const arc = arcChain(registry);
  if (!arc) throw new ArcPayError(503, "arc_unavailable", "Arc is not available in this environment");
  if ((await disabledChainIds(db)).has(arc.id)) throw new ArcPayError(409, "chain_disabled", "payments on Arc are temporarily unavailable");
  if (!isAddress(input.sender)) throw new ArcPayError(400, "invalid_sender", "sender must be an EVM address");

  let amount: bigint;
  try {
    amount = parseUsdc(input.amount);
  } catch {
    throw new ArcPayError(400, "invalid_amount", "amount must be a positive USDC value with at most 6 decimals");
  }
  if (amount <= 0n) throw new ArcPayError(400, "invalid_amount", "amount must be greater than 0");

  let resolved: { handle: string; address: string };
  try {
    resolved = await lookupId(db, input.recipientId);
  } catch (e) {
    if (e instanceof AccountError) throw new ArcPayError(404, "id_not_found", "no one has claimed this Confluence ID");
    throw e;
  }
  if (resolved.address.toLowerCase() === input.sender.toLowerCase()) throw new ArcPayError(400, "self_payment", "you can't pay your own Confluence ID");

  const fee = ARC_PAY_FEE_BASE;
  const note = noteOrThrow(input.note);

  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const sender = getAddress(input.sender);
  try {
    await db.batch([
      db.insert(arcPayments).values({
        id,
        idempotencyKey: input.idempotencyKey,
        state: "CREATED",
        chain: arc.id,
        sender,
        recipient: resolved.address,
        recipientId: resolved.handle,
        amountBase: amount.toString(),
        feeBase: fee.toString(),
        feeRecipient: NO_FEE_RECIPIENT,
        note,
        reportTokenHash: sha256(token),
      }),
      db.insert(arcPaymentEvents).values({ paymentId: id, fromState: null, toState: "CREATED", source: "client", detail: { action: "create" } }),
    ]);
  } catch (e) {
    if (uniqueViolationColumn(e)?.endsWith("idempotency_key")) throw new ArcPayError(409, "idempotency_key_used", "this Idempotency-Key already created a payment");
    throw e;
  }

  return {
    id,
    // Shown once. The browser keeps it to send step reports.
    reportToken: token,
    state: "CREATED" as ArcPaymentState,
    chain: arc.id,
    sender,
    recipient: resolved.address,
    recipientId: resolved.handle,
    amount: money(amount),
    fee: money(fee),
    total: money(amount + fee),
    // No fee: nothing is ever sent to a fee recipient.
    feeRecipient: null,
    // What the wallet signs: one ERC-20 transfer on this contract, to the recipient.
    usdc: { address: getAddress(arc.usdcAddress), decimals: 6 },
    note,
  };
}

export interface ArcPayReport {
  step: ArcPayStep;
  state: ArcPayStepState;
  txHash?: string | undefined;
  errorMessage?: string | undefined;
}

export async function recordArcPaymentReport(db: Db, paymentId: string, token: string | undefined, report: ArcPayReport) {
  const p = await db.query.arcPayments.findFirst({ where: eq(arcPayments.id, paymentId) });
  // Same answer for "no such payment" and "wrong token", so ids can't be probed.
  if (!p || !tokenMatches(token, p.reportTokenHash)) throw new ArcPayError(404, "payment_not_found", "payment not found or token invalid");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(arcPaymentEvents).where(eq(arcPaymentEvents.paymentId, p.id));
  if (n >= MAX_EVENTS_PER_PAYMENT) throw new ArcPayError(429, "too_many_reports", "report limit reached for this payment");

  const r = applyReport({ state: p.state, feeTxHash: p.feeTxHash, payTxHash: p.payTxHash, step: report.step, stepState: report.state, txHash: report.txHash, free: isFree(p.feeBase) });
  if (r.kind === "reject") throw new ArcPayError(r.status, r.code, r.message);

  const tx = report.txHash?.toLowerCase();
  const detail = {
    step: report.step,
    state: report.state,
    ...(tx ? { txHash: tx } : {}),
    ...(report.errorMessage ? { errorMessage: report.errorMessage.slice(0, 300) } : {}),
    ...(r.kind === "stay" ? { reason: r.reason } : {}),
  };
  const now = new Date();
  const patch: Partial<typeof arcPayments.$inferInsert> = {};
  let to: ArcPaymentState = p.state;
  if (r.kind === "move") {
    to = r.to;
    patch.state = r.to;
    patch.errorCode = r.errorCode;
    patch.updatedAt = now;
    if (r.setFeeTx) patch.feeTxHash = tx!;
    if (r.setPayTx) patch.payTxHash = tx!;
  } else if (r.kind === "note") {
    patch.errorCode = r.errorCode;
    patch.updatedAt = now;
  }

  try {
    if (Object.keys(patch).length === 0) {
      await db.insert(arcPaymentEvents).values({ paymentId: p.id, fromState: p.state, toState: p.state, source: "client", detail });
    } else {
      const [updated] = await db.batch([
        db
          .update(arcPayments)
          .set(patch)
          .where(and(eq(arcPayments.id, p.id), eq(arcPayments.state, p.state)))
          .returning({ id: arcPayments.id }),
        db.run(
          sql`insert into ${arcPaymentEvents} (payment_id, from_state, to_state, source, detail)
              select ${p.id}, ${p.state}, ${to}, 'client', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (updated.length === 0) throw new ArcPayError(409, "state_changed", "payment changed concurrently; resend the report");
    }
  } catch (e) {
    if (e instanceof ArcPayError) throw e;
    const col = uniqueViolationColumn(e);
    if (col?.endsWith("fee_tx_hash") || col?.endsWith("pay_tx_hash")) throw new ArcPayError(409, "tx_hash_taken", "this transaction is already linked to another payment");
    throw e;
  }
  return { id: p.id, state: to, applied: r.kind === "move" };
}

/** Public view by id (the id is a random UUID). The note stays private to the two sides. */
export async function getArcPayment(db: Db, paymentId: string) {
  const p = await db.query.arcPayments.findFirst({ where: eq(arcPayments.id, paymentId) });
  if (!p) throw new ArcPayError(404, "payment_not_found", "payment not found");
  const events = await db
    .select({ fromState: arcPaymentEvents.fromState, toState: arcPaymentEvents.toState, source: arcPaymentEvents.source, createdAt: arcPaymentEvents.createdAt })
    .from(arcPaymentEvents)
    .where(eq(arcPaymentEvents.paymentId, p.id))
    .orderBy(asc(arcPaymentEvents.id))
    .limit(MAX_EVENTS_PER_PAYMENT);
  return {
    id: p.id,
    state: p.state,
    chain: p.chain,
    sender: p.sender,
    recipient: p.recipient,
    recipientId: p.recipientId,
    amount: money(p.amountBase),
    fee: money(p.feeBase),
    total: money(BigInt(p.amountBase) + BigInt(p.feeBase)),
    feeRecipient: isFree(p.feeBase) ? null : p.feeRecipient,
    feeTxHash: p.feeTxHash,
    payTxHash: p.payTxHash,
    feeVerified: !!p.feeVerifiedAt,
    paymentVerified: !!p.payVerifiedAt,
    errorCode: p.errorCode,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}

// ---------- tracker pass ----------

const ACTIVE: ArcPaymentState[] = ["CREATED", "FEE_SUBMITTED", "PAYMENT_SUBMITTED"];
const PER_PASS = 15;

export interface ArcPayPassResult {
  checked: number;
  moved: number;
  errors: number;
}

/**
 * One pass over unfinished Arc payments: proves reported fee and payment transfers from
 * their receipts (and that they were mined after the payment was created), and expires
 * payments that never got a fee. Conditional updates, safe next to browser reports.
 */
export async function trackArcPaymentsOnce(
  deps: { db: Db; registry: ChainRegistry; fetchImpl?: typeof fetch; log?: (m: string) => void },
  now = Date.now(),
): Promise<ArcPayPassResult> {
  const { db, registry } = deps;
  const log = deps.log ?? (() => {});
  const out: ArcPayPassResult = { checked: 0, moved: 0, errors: 0 };
  const arc = arcChain(registry);
  if (!arc) return out;

  const rows = await db
    .select()
    .from(arcPayments)
    .where(
      and(
        inArray(arcPayments.state, ACTIVE),
        or(isNull(arcPayments.trackedAt), sql`${arcPayments.trackedAt} < ${now - 30_000}`),
        // CREATED rows only matter once they can expire; the rest have a transaction to prove
        // (a free payment has only the payment transaction).
        or(and(eq(arcPayments.state, "CREATED"), sql`${arcPayments.createdAt} < ${now - EXPIRE_AFTER_MS}`), isNotNull(arcPayments.feeTxHash), isNotNull(arcPayments.payTxHash)),
      ),
    )
    .orderBy(asc(arcPayments.trackedAt))
    .limit(PER_PASS);

  const check = async (txHash: string, from: string, to: string, amountBase: string, createdAt: Date): Promise<TransferCheck | null> => {
    const receipt = await getReceipt(arc.rpcUrls, txHash, deps.fetchImpl);
    const result = checkUsdcTransfer(receipt, { usdc: arc.usdcAddress, from, to, amountBase });
    if (result === "ok" && receipt?.blockNumber) {
      const t = await getBlockTimeMs(arc.rpcUrls, receipt.blockNumber, deps.fetchImpl);
      if (tooOld(t, createdAt.getTime())) return "too_old";
    }
    return result;
  };

  for (const p of rows) {
    out.checked++;
    try {
      const fee = p.feeTxHash && !p.feeVerifiedAt ? await check(p.feeTxHash, p.sender, p.feeRecipient, p.feeBase, p.createdAt) : undefined;
      const pay = p.payTxHash && !p.payVerifiedAt ? await check(p.payTxHash, p.sender, p.recipient, p.amountBase, p.createdAt) : undefined;
      const d = decideArcPayment(p, fee, pay, now);
      if (d.kind === "none") {
        await db.update(arcPayments).set({ trackedAt: new Date(now) }).where(eq(arcPayments.id, p.id));
        continue;
      }
      const patch: Partial<typeof arcPayments.$inferInsert> = { state: d.to, trackedAt: new Date(now), updatedAt: new Date(now) };
      if (d.errorCode !== undefined) patch.errorCode = d.errorCode;
      if (d.feeVerified) patch.feeVerifiedAt = new Date(now);
      if (d.payVerified) patch.payVerifiedAt = new Date(now);
      if (d.clearFeeTx) patch.feeTxHash = null;
      if (d.clearPayTx) patch.payTxHash = null;
      const detail = {
        actor: "tracker",
        reason: d.reason,
        ...(fee !== undefined ? { fee: fee ?? "not_mined" } : {}),
        ...(pay !== undefined ? { payment: pay ?? "not_mined" } : {}),
        ...(d.clearFeeTx ? { droppedFeeTx: p.feeTxHash } : {}),
        ...(d.clearPayTx ? { droppedPayTx: p.payTxHash } : {}),
      };
      const [updated] = await db.batch([
        db
          .update(arcPayments)
          .set(patch)
          .where(and(eq(arcPayments.id, p.id), eq(arcPayments.state, p.state)))
          .returning({ id: arcPayments.id }),
        db.run(
          sql`insert into ${arcPaymentEvents} (payment_id, from_state, to_state, source, detail)
              select ${p.id}, ${p.state}, ${d.to}, 'worker', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (updated.length === 0) continue; // changed meanwhile; next pass
      if (d.to !== p.state) out.moved++;
      log(`tracker: arc payment ${p.id.slice(0, 8)} ${p.state} -> ${d.to} (${d.reason})`);
    } catch (e) {
      out.errors++;
      log(`tracker: arc payment ${p.id.slice(0, 8)} check failed: ${e instanceof Error ? e.message : String(e)}`);
      await db.update(arcPayments).set({ trackedAt: new Date(now) }).where(eq(arcPayments.id, p.id)).catch(() => {});
    }
  }
  return out;
}
