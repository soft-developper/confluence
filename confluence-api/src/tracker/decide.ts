import type { BridgeChain } from "../chains/registry.js";
import type { IrisMessage } from "../circle/iris.js";
import type { TransferState, TransferSpeed } from "../db/schema.js";

/**
 * What the Stage 4 tracker does with one transfer, given Circle's view (Iris) and,
 * when needed, whether the destination already received the message. Pure: no I/O.
 *
 * Rules (never backwards, COMPLETED and FAILED are final):
 * - No burn and idle for 24h in CREATED/APPROVED -> FAILED "abandoned" (nothing was burned).
 * - Burn not found at Circle 24h after creation -> RECOVERY_REQUIRED "burn_not_found".
 * - Burn found but it does not match the transfer -> RECOVERY_REQUIRED "burn_mismatch".
 * - Forwarding on: Circle reports the forwarded mint -> COMPLETED (with its tx hash);
 *   Circle reports the forward FAILED -> RECOVERY_REQUIRED "forward_failed", unless the
 *   destination already received the message (someone minted) -> COMPLETED.
 * - Forwarding off: destination received the message -> COMPLETED.
 * - Attestation complete -> ATTESTED (if not already past it).
 */
export interface TrackedRow {
  state: TransferState;
  useForwarder: boolean;
  speed: TransferSpeed;
  amountBase: string;
  recipient: string;
  burnTxHash: string | null;
  mintTxHash: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Decision =
  | { kind: "none"; reason: string }
  | { kind: "move"; to: TransferState; mintTxHash?: string; errorCode?: string | null; reason: string; mismatches?: string[] };

export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;
export const NOT_FOUND_AFTER_MS = 24 * 60 * 60 * 1000;
/** Rows with these error codes are no longer tracked (nothing more the tracker can learn). */
export const STOP_CODES = ["burn_mismatch", "burn_not_found", "abandoned"] as const;

const RANK: Partial<Record<TransferState, number>> = {
  CREATED: 0,
  APPROVED: 1,
  BURN_SUBMITTED: 2,
  BURN_CONFIRMED: 3,
  ATTESTATION_PENDING: 4,
  ATTESTED: 5,
  MINT_SUBMITTED: 6,
  COMPLETED: 7,
};

const FORWARD_DONE = new Set(["CONFIRMED", "COMPLETE"]);
const last40 = (a: string) => a.toLowerCase().replace(/^0x/, "").slice(-40);

/** Field-by-field check that Circle's message is this transfer (same fields App Kit validates). */
export function verifyMessage(m: IrisMessage, row: TrackedRow, src: BridgeChain, dst: BridgeChain): string[] | null {
  const d = m.decodedMessage;
  const body = d?.decodedMessageBody;
  if (!d || !body) return null; // not decoded yet: nothing to compare
  const out: string[] = [];
  if (d.sourceDomain !== String(src.cctpDomain)) out.push(`sourceDomain ${d.sourceDomain} != ${src.cctpDomain}`);
  if (d.destinationDomain !== String(dst.cctpDomain)) out.push(`destinationDomain ${d.destinationDomain} != ${dst.cctpDomain}`);
  if (body.burnToken.toLowerCase() !== src.usdcAddress.toLowerCase()) out.push("burnToken is not the source USDC");
  if (last40(body.mintRecipient) !== last40(row.recipient)) out.push("mintRecipient differs from the transfer recipient");
  try {
    if (BigInt(body.amount) !== BigInt(row.amountBase)) out.push(`amount ${body.amount} != ${row.amountBase}`);
  } catch {
    out.push("amount is not a number");
  }
  const wantThreshold = row.speed === "FAST" ? "1000" : "2000";
  if (d.minFinalityThreshold !== undefined && d.minFinalityThreshold !== wantThreshold) {
    out.push(`minFinalityThreshold ${d.minFinalityThreshold} != ${wantThreshold}`);
  }
  return out;
}

export interface DecideInput {
  row: TrackedRow;
  src: BridgeChain;
  dst: BridgeChain;
  /** undefined = not fetched (no burn); null = Circle has not indexed the burn (404). */
  message: IrisMessage | null | undefined;
  /** undefined = unknown (not checked, or the RPC failed). */
  nonceUsed: boolean | undefined;
  now: number;
}

export function decide({ row, src, dst, message, nonceUsed, now }: DecideInput): Decision {
  if (row.state === "COMPLETED" || row.state === "FAILED") return { kind: "none", reason: "final" };
  const rank = RANK[row.state] ?? -1;

  if (!row.burnTxHash) {
    if ((row.state === "CREATED" || row.state === "APPROVED") && now - row.updatedAt.getTime() > ABANDON_AFTER_MS) {
      return { kind: "move", to: "FAILED", errorCode: "abandoned", reason: "no burn within 24h" };
    }
    return { kind: "none", reason: "no burn yet" };
  }

  if (message === undefined) return { kind: "none", reason: "not checked" };
  if (message === null) {
    if (now - row.createdAt.getTime() > NOT_FOUND_AFTER_MS) {
      return { kind: "move", to: "RECOVERY_REQUIRED", errorCode: "burn_not_found", reason: "Circle has no message for this burn after 24h" };
    }
    return { kind: "none", reason: "Circle has not indexed the burn yet" };
  }

  const mismatches = verifyMessage(message, row, src, dst);
  if (mismatches === null) return { kind: "none", reason: "message not decoded yet" };
  if (mismatches.length > 0) {
    return { kind: "move", to: "RECOVERY_REQUIRED", errorCode: "burn_mismatch", reason: "burn does not match the transfer", mismatches };
  }

  const attested = message.status === "complete";

  if (row.useForwarder) {
    const fs = message.forwardState ?? "";
    if (FORWARD_DONE.has(fs) && message.forwardTxHash) {
      return { kind: "move", to: "COMPLETED", mintTxHash: message.forwardTxHash.toLowerCase(), errorCode: null, reason: `Circle forwarded the mint (${fs})` };
    }
    if (fs === "FAILED") {
      if (nonceUsed === true) return { kind: "move", to: "COMPLETED", errorCode: null, reason: "forward failed but the destination received the message" };
      if (row.state === "RECOVERY_REQUIRED" && row.errorCode === "forward_failed") return { kind: "none", reason: "forward failed, waiting for a mint" };
      return { kind: "move", to: "RECOVERY_REQUIRED", errorCode: "forward_failed", reason: "Circle reports the forwarded mint failed" };
    }
  } else if (nonceUsed === true) {
    return { kind: "move", to: "COMPLETED", errorCode: null, reason: "the destination received the message" };
  }

  if (attested && (rank < RANK.ATTESTED! || row.state === "RECOVERY_REQUIRED")) {
    // A client-reported problem (for example an attestation timeout) is cleared by
    // Circle's own evidence. A failed forward is not: that stays until a mint shows up.
    if (row.state === "RECOVERY_REQUIRED" && row.errorCode === "forward_failed") return { kind: "none", reason: "forward failed, waiting for a mint" };
    return { kind: "move", to: "ATTESTED", errorCode: null, reason: "Circle attestation complete" };
  }
  return { kind: "none", reason: attested ? "attested, waiting for the mint" : `attestation ${message.status}` };
}

/** How often a row is re-checked, by age. Young transfers move fast; old ones rarely change. */
export function recheckAfterMs(ageMs: number): number {
  if (ageMs < 2 * 60 * 60 * 1000) return 60_000;
  if (ageMs < 24 * 60 * 60 * 1000) return 5 * 60_000;
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return 30 * 60_000;
  return 6 * 60 * 60_000;
}
