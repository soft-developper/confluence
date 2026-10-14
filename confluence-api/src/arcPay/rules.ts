import type { ArcPaymentState } from "../db/schema.js";
import type { TxReceipt } from "../tracker/chainReads.js";

/**
 * Pure rules for Arc to Arc payments by Confluence ID (confluence:arc-pay). No I/O.
 *
 * Flow, fee first: CREATED -> fee signed -> FEE_SUBMITTED -> tracker proves the fee ->
 * FEE_PAID -> payment signed -> PAYMENT_SUBMITTED -> tracker proves it -> COMPLETED.
 * Browser reports are unverified claims: they only reach the *_SUBMITTED states. FEE_PAID
 * never expires, so a paid fee is never lost; the payment can be finished later.
 */

// ---------- browser reports ----------

export type ArcPayStep = "fee" | "payment";
export type ArcPayStepState = "success" | "error";

export type ReportResult =
  | { kind: "move"; to: ArcPaymentState; errorCode: string | null; setFeeTx?: boolean; setPayTx?: boolean }
  | { kind: "note"; errorCode: string }
  | { kind: "stay"; reason: string }
  | { kind: "reject"; status: number; code: string; message: string };

export interface ReportInput {
  state: ArcPaymentState;
  feeTxHash: string | null;
  payTxHash: string | null;
  step: ArcPayStep;
  stepState: ArcPayStepState;
  txHash?: string | undefined;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function applyReport(r: ReportInput): ReportResult {
  if (r.state === "COMPLETED" || r.state === "EXPIRED") return { kind: "stay", reason: "final" };
  if (r.stepState === "success" && !r.txHash) return { kind: "reject", status: 400, code: "tx_hash_required", message: "a successful report must include txHash" };

  if (r.step === "fee") {
    if (r.stepState === "error") {
      // The user rejected or the wallet failed before any fee was sent: nothing was paid.
      if (r.state === "CREATED" && !r.feeTxHash) return { kind: "move", to: "FAILED", errorCode: "fee_not_sent" };
      return { kind: "stay", reason: "fee already reported" };
    }
    if (r.feeTxHash) {
      return same(r.feeTxHash, r.txHash)
        ? { kind: "stay", reason: "fee already reported" }
        : { kind: "reject", status: 409, code: "fee_tx_conflict", message: "this payment already has a different fee transaction" };
    }
    if (r.state === "CREATED" || r.state === "FAILED") return { kind: "move", to: "FEE_SUBMITTED", errorCode: null, setFeeTx: true };
    return { kind: "stay", reason: "not_forward" };
  }

  // payment
  if (!r.feeTxHash) return { kind: "reject", status: 409, code: "fee_first", message: "the fee must be sent before the payment" };
  if (r.stepState === "error") {
    // The fee is paid or in flight: keep the state so the payment can be finished later.
    return r.payTxHash ? { kind: "stay", reason: "payment already reported" } : { kind: "note", errorCode: "payment_not_sent" };
  }
  if (r.payTxHash) {
    return same(r.payTxHash, r.txHash)
      ? { kind: "stay", reason: "payment already reported" }
      : { kind: "reject", status: 409, code: "payment_tx_conflict", message: "this payment already has a different payment transaction" };
  }
  if (r.state === "FEE_SUBMITTED" || r.state === "FEE_PAID") return { kind: "move", to: "PAYMENT_SUBMITTED", errorCode: null, setPayTx: true };
  return { kind: "stay", reason: "not_forward" };
}

// ---------- receipt check ----------

// keccak256("Transfer(address,address,uint256)"), the standard ERC-20 Transfer event.
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type TransferCheck = "ok" | "reverted" | "no_matching_transfer" | "too_old";

export interface TransferExpectation {
  /** Arc USDC ERC-20 interface (6 decimals). */
  usdc: string;
  from: string;
  to: string;
  amountBase: string;
}

const last40 = (a: string) => a.toLowerCase().replace(/^0x/, "").slice(-40);

/**
 * Whether a receipt holds this exact USDC transfer. Only the ERC-20 contract's own 6-decimal
 * Transfer log counts: Arc also emits an 18-decimal Transfer from a system address for the
 * same movement, and counting both would double it (docs.arc.io, stablecoin native model).
 * null = the chain does not know the transaction yet.
 */
export function checkUsdcTransfer(receipt: TxReceipt | null, want: TransferExpectation): TransferCheck | null {
  if (!receipt) return null;
  if (receipt.status !== "0x1") return "reverted";
  let amount: bigint;
  try {
    amount = BigInt(want.amountBase);
  } catch {
    return "no_matching_transfer";
  }
  const hit = receipt.logs.some((l) => {
    if (l.address.toLowerCase() !== want.usdc.toLowerCase()) return false;
    if ((l.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return false;
    if (last40(l.topics[1] ?? "") !== last40(want.from) || last40(l.topics[2] ?? "") !== last40(want.to)) return false;
    try {
      return BigInt(l.data) === amount;
    } catch {
      return false;
    }
  });
  return hit ? "ok" : "no_matching_transfer";
}

/** A transaction mined well before the payment was created can't be this payment. */
export const CLOCK_SKEW_MS = 10 * 60 * 1000;
export function tooOld(blockTimeMs: number, createdAtMs: number): boolean {
  return blockTimeMs < createdAtMs - CLOCK_SKEW_MS;
}

// ---------- tracker decisions ----------

export const EXPIRE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A reported transaction the chain still doesn't know after this long is dropped. */
export const TX_NOT_FOUND_AFTER_MS = 2 * 60 * 60 * 1000;

export interface ArcPayRow {
  state: ArcPaymentState;
  feeTxHash: string | null;
  payTxHash: string | null;
  feeVerifiedAt: Date | null;
  payVerifiedAt: Date | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ArcPayDecision =
  | { kind: "none"; reason: string }
  | {
      kind: "update";
      to: ArcPaymentState;
      errorCode?: string | null;
      feeVerified?: boolean;
      payVerified?: boolean;
      clearFeeTx?: boolean;
      clearPayTx?: boolean;
      reason: string;
    };

/**
 * One tracker step. `fee` / `pay`: result of checking the reported transaction
 * (undefined = not checked, null = not mined yet).
 */
export function decideArcPayment(row: ArcPayRow, fee: TransferCheck | null | undefined, pay: TransferCheck | null | undefined, now: number): ArcPayDecision {
  const age = now - row.updatedAt.getTime();
  switch (row.state) {
    case "COMPLETED":
    case "EXPIRED":
    case "FAILED":
      return { kind: "none", reason: "final" };

    case "CREATED":
      return now - row.createdAt.getTime() > EXPIRE_AFTER_MS ? { kind: "update", to: "EXPIRED", reason: "no fee within 24h (nothing was paid)" } : { kind: "none", reason: "waiting for the fee" };

    case "FEE_PAID":
      return { kind: "none", reason: "fee paid, waiting for the payment (never expires)" };

    case "FEE_SUBMITTED": {
      if (fee === undefined) return { kind: "none", reason: "not checked" };
      if (fee === "ok") return { kind: "update", to: "FEE_PAID", errorCode: null, feeVerified: true, reason: "fee proven on Arc" };
      if (fee === null) {
        return age > TX_NOT_FOUND_AFTER_MS
          ? { kind: "update", to: "CREATED", errorCode: "fee_not_found", clearFeeTx: true, reason: "reported fee never appeared on Arc" }
          : { kind: "none", reason: "fee not mined yet" };
      }
      return { kind: "update", to: "CREATED", errorCode: `fee_${fee}`, clearFeeTx: true, reason: `reported fee is not valid (${fee})` };
    }

    case "PAYMENT_SUBMITTED": {
      const bad = (c: TransferCheck | null | undefined) => c === "reverted" || c === "no_matching_transfer" || c === "too_old";
      const feeOk = !!row.feeVerifiedAt || fee === "ok";
      const feeBad = !row.feeVerifiedAt && bad(fee);
      const feeMissing = !row.feeVerifiedAt && fee === null && age > TX_NOT_FOUND_AFTER_MS;
      const payOk = !!row.payVerifiedAt || pay === "ok";
      const marks = { feeVerified: !row.feeVerifiedAt && fee === "ok", payVerified: !row.payVerifiedAt && pay === "ok" };

      if (payOk) {
        if (feeOk) return { kind: "update", to: "COMPLETED", errorCode: null, ...marks, reason: "payment and fee proven on Arc" };
        // The money reached the recipient: show it as complete, and keep the unpaid fee visible to admin.
        if (feeBad || feeMissing) return { kind: "update", to: "COMPLETED", errorCode: "fee_unpaid", ...marks, reason: "payment proven, fee not valid" };
        return marks.payVerified ? { kind: "update", to: "PAYMENT_SUBMITTED", ...marks, reason: "payment proven, fee not mined yet" } : { kind: "none", reason: "payment proven, fee not mined yet" };
      }
      if (pay === undefined) {
        return marks.feeVerified ? { kind: "update", to: "PAYMENT_SUBMITTED", ...marks, reason: "fee proven on Arc" } : { kind: "none", reason: "not checked" };
      }
      const back: ArcPaymentState = feeOk ? "FEE_PAID" : "FEE_SUBMITTED";
      if (pay === null) {
        return age > TX_NOT_FOUND_AFTER_MS
          ? { kind: "update", to: back, errorCode: "payment_not_found", clearPayTx: true, ...marks, reason: "reported payment never appeared on Arc" }
          : marks.feeVerified
            ? { kind: "update", to: "PAYMENT_SUBMITTED", ...marks, reason: "fee proven, payment not mined yet" }
            : { kind: "none", reason: "payment not mined yet" };
      }
      return { kind: "update", to: back, errorCode: `payment_${pay}`, clearPayTx: true, ...marks, reason: `reported payment is not valid (${pay})` };
    }
  }
}
