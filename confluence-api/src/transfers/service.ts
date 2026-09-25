import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { quotes, transferEvents, transfers, type TransferState } from "../db/schema.js";
import { formatUsdc } from "../lib/usdc.js";
import { nextState, type StepName, type StepState } from "./stateMachine.js";

export class TransferError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Upper bound on stored client reports per transfer, so one token cannot flood the table. */
export const MAX_EVENTS_PER_TRANSFER = 100;

const money = (base: string) => ({ base, usdc: formatUsdc(BigInt(base)) });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function uniqueViolationColumn(e: unknown): string | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const m = /UNIQUE constraint failed: ([\w.]+)/i.exec(String((cur as { message?: unknown }).message ?? ""));
    if (m?.[1]) return m[1];
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export interface CreateTransferInput {
  quoteId: string;
  sender: string;
  idempotencyKey: string;
}

/**
 * Creates a transfer from a stored quote. Every money value comes from the quote,
 * never from the browser. Returns the secret report token once; only its hash is stored.
 */
export async function createTransfer(db: Db, input: CreateTransferInput) {
  const quote = await db.query.quotes.findFirst({ where: eq(quotes.id, input.quoteId) });
  if (!quote) throw new TransferError(404, "quote_not_found", "quote does not exist");
  if (quote.sender.toLowerCase() !== input.sender.toLowerCase()) {
    throw new TransferError(403, "quote_sender_mismatch", "quote belongs to a different sender");
  }
  if (quote.expiresAt.getTime() <= Date.now()) throw new TransferError(410, "quote_expired", "quote has expired; request a new one");

  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");

  // One atomic batch (a single request to Turso), not an interactive transaction:
  // interactive transactions hold a write lock across round trips, and in local file
  // mode they run on a second connection that collides with other writes (SQLITE_BUSY).
  try {
    await db.batch([
      db.insert(transfers).values({
        id,
        quoteId: quote.id,
        idempotencyKey: input.idempotencyKey,
        state: "CREATED",
        sourceChain: quote.sourceChain,
        destinationChain: quote.destinationChain,
        sender: quote.sender,
        recipient: quote.recipient,
        recipientId: quote.recipientId,
        requestId: quote.requestId,
        amountBase: quote.amountBase,
        platformFeeBase: quote.platformFeeBase,
        speed: quote.speed,
        useForwarder: quote.useForwarder,
        reportTokenHash: sha256(token),
      }),
      db.insert(transferEvents).values({
        transferId: id,
        fromState: null,
        toState: "CREATED",
        source: "client",
        detail: { action: "create", quoteId: quote.id },
      }),
    ]);
  } catch (e) {
    const col = uniqueViolationColumn(e);
    if (col?.endsWith("quote_id")) throw new TransferError(409, "quote_already_used", "a transfer already exists for this quote");
    if (col?.endsWith("idempotency_key")) throw new TransferError(409, "idempotency_key_used", "this Idempotency-Key already created a transfer");
    throw e;
  }

  return {
    id,
    // Shown once. The browser keeps it (memory or sessionStorage) to send step reports.
    reportToken: token,
    state: "CREATED" as TransferState,
    quoteId: quote.id,
    sourceChain: quote.sourceChain,
    destinationChain: quote.destinationChain,
    sender: quote.sender,
    recipient: quote.recipient,
    recipientId: quote.recipientId,
    requestId: quote.requestId,
    speed: quote.speed,
    useForwarder: quote.useForwarder,
    amount: money(quote.amountBase),
    platformFee: money(quote.platformFeeBase),
    totalDebit: money((BigInt(quote.amountBase) + BigInt(quote.platformFeeBase)).toString()),
    // Exactly what kit.bridge() needs: customFee.value is human-readable USDC.
    customFee: { value: formatUsdc(BigInt(quote.platformFeeBase)), recipientAddress: quote.feeRecipient },
  };
}

/** Constant-time check of a presented report token against the stored hash. */
export function tokenMatches(presented: string | undefined, storedHash: string | null): boolean {
  if (!presented || !storedHash) return false;
  const a = Buffer.from(sha256(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface StepReport {
  step: StepName;
  state: StepState;
  txHash?: string | undefined;
  errorCategory?: string | undefined;
  errorMessage?: string | undefined;
  forwarded?: boolean | undefined;
  batched?: boolean | undefined;
  warnings?: { code: string; message?: string | undefined }[] | undefined;
}

/**
 * Records one client step report and applies the state machine.
 * The report is always stored as an event (up to the cap), even when it does not
 * move the state, so the Stage 4 tracker can audit what the browser claimed.
 */
export async function recordStepReport(db: Db, transferId: string, token: string | undefined, report: StepReport) {
  const t = await db.query.transfers.findFirst({ where: eq(transfers.id, transferId) });
  // Same response for "no such transfer" and "wrong token", so ids cannot be probed.
  if (!t || !tokenMatches(token, t.reportTokenHash)) {
    throw new TransferError(404, "transfer_not_found", "transfer not found or token invalid");
  }

  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(transferEvents).where(eq(transferEvents.transferId, t.id));
  if (n >= MAX_EVENTS_PER_TRANSFER) throw new TransferError(429, "too_many_reports", "report limit reached for this transfer");

  if (report.step === "burn" && report.state === "success" && !report.txHash) {
    throw new TransferError(400, "burn_tx_hash_required", "a successful burn report must include txHash");
  }
  if (report.step === "burn" && report.txHash && t.burnTxHash && t.burnTxHash.toLowerCase() !== report.txHash.toLowerCase()) {
    throw new TransferError(409, "burn_tx_hash_conflict", "this transfer already has a different burn transaction");
  }

  const decision = nextState({ current: t.state, hasBurnTx: Boolean(t.burnTxHash), step: report.step, state: report.state });
  const to: TransferState = decision.kind === "move" ? decision.to : t.state;

  const patch: Partial<typeof transfers.$inferInsert> = {};
  if (decision.kind === "move") {
    patch.state = to;
    patch.updatedAt = new Date();
    if (to === "FAILED" || to === "RECOVERY_REQUIRED") patch.errorCode = report.errorCategory ?? "unknown";
    else patch.errorCode = null;
  }
  if (report.step === "burn" && report.state === "success" && report.txHash && !t.burnTxHash) {
    patch.burnTxHash = report.txHash.toLowerCase();
    patch.updatedAt = new Date();
  }
  if (report.step === "mint" && report.state === "success" && report.txHash && !t.mintTxHash) {
    patch.mintTxHash = report.txHash.toLowerCase();
    patch.updatedAt = new Date();
  }

  const detail = {
    step: report.step,
    state: report.state,
    applied: decision.kind === "move",
    ...(decision.kind === "stay" ? { reason: decision.reason } : {}),
    ...(report.txHash ? { txHash: report.txHash.toLowerCase() } : {}),
    ...(report.errorCategory ? { errorCategory: report.errorCategory } : {}),
    ...(report.errorMessage ? { errorMessage: report.errorMessage } : {}),
    ...(report.forwarded !== undefined ? { forwarded: report.forwarded } : {}),
    ...(report.batched !== undefined ? { batched: report.batched } : {}),
    ...(report.warnings?.length ? { warnings: report.warnings } : {}),
  };

  try {
    if (Object.keys(patch).length === 0) {
      await db.insert(transferEvents).values({ transferId: t.id, fromState: t.state, toState: to, source: "client", detail });
    } else {
      // Atomic batch: the update only applies if the state is still the one we read
      // (so two concurrent reports cannot both apply), and the event row is inserted
      // only if that update changed a row (SQLite changes() of the previous statement).
      const [updated] = await db.batch([
        db
          .update(transfers)
          .set(patch)
          .where(and(eq(transfers.id, t.id), eq(transfers.state, t.state)))
          .returning({ id: transfers.id }),
        db.run(
          sql`insert into ${transferEvents} (transfer_id, from_state, to_state, source, detail)
              select ${t.id}, ${t.state}, ${to}, 'client', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (updated.length === 0) throw new TransferError(409, "state_changed", "transfer changed concurrently; resend the report");
    }
  } catch (e) {
    if (e instanceof TransferError) throw e;
    if (uniqueViolationColumn(e)?.endsWith("burn_tx_hash")) {
      throw new TransferError(409, "burn_tx_hash_taken", "this burn transaction is already linked to another transfer");
    }
    throw e;
  }

  return { id: t.id, state: to, applied: decision.kind === "move" };
}

/** Public view of a transfer. Never includes the token hash. */
export async function getTransfer(db: Db, transferId: string) {
  const t = await db.query.transfers.findFirst({ where: eq(transfers.id, transferId) });
  if (!t) throw new TransferError(404, "transfer_not_found", "transfer not found");
  // Fee estimates live on the quote the transfer was created from.
  const q = await db.query.quotes.findFirst({ where: eq(quotes.id, t.quoteId) });
  const events = await db
    .select({
      fromState: transferEvents.fromState,
      toState: transferEvents.toState,
      source: transferEvents.source,
      detail: transferEvents.detail,
      createdAt: transferEvents.createdAt,
    })
    .from(transferEvents)
    .where(eq(transferEvents.transferId, t.id))
    .orderBy(asc(transferEvents.id))
    .limit(MAX_EVENTS_PER_TRANSFER);

  return {
    id: t.id,
    quoteId: t.quoteId,
    state: t.state,
    sourceChain: t.sourceChain,
    destinationChain: t.destinationChain,
    sender: t.sender,
    recipient: t.recipient,
    recipientId: t.recipientId,
    requestId: t.requestId,
    speed: t.speed,
    useForwarder: t.useForwarder,
    amount: money(t.amountBase),
    platformFee: money(t.platformFeeBase),
    ...(q
      ? {
          cctpFee: { ...money(q.cctpFeeBase), estimated: true },
          forwardingFee: { ...money(q.forwardingFeeBase), estimated: true },
          expectedReceive: {
            ...money((BigInt(t.amountBase) - BigInt(q.cctpFeeBase) - BigInt(q.forwardingFeeBase)).toString()),
            estimated: true,
          },
        }
      : {}),
    burnTxHash: t.burnTxHash,
    mintTxHash: t.mintTxHash,
    errorCode: t.errorCode,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}
