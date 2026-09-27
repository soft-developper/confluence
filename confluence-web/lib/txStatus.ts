import type { TransferDetail } from "./api";
import { FORWARD_DONE, type IrisMessage } from "./iris";

/**
 * Merges what the database knows (client step reports) with Circle's live view (Iris)
 * and, for self-submitted mints, whether the destination already used the nonce.
 * Until the Stage 4 tracker exists the database can be behind (a closed tab stops the
 * reports), so the live sources may be ahead of it. They only ever add progress.
 */
export type TxPhase =
  | "not_sent"
  | "failed"
  | "sending"
  | "awaiting_attestation"
  | "minting"
  | "ready_to_mint"
  | "complete"
  | "needs_attention";

export interface TxView {
  phase: TxPhase;
  approved: boolean;
  burned: boolean;
  attested: boolean;
  minted: boolean;
  /** Where the attested/minted facts came from, for honest labels. */
  attestedFrom: "database" | "circle" | null;
  mintedFrom: "database" | "circle" | "chain" | null;
  mintTxHash: string | null;
  forwardFailed: boolean;
  /** Forwarding on, attested, but Circle's forwarder has not delivered after FORWARD_STALL_MS. */
  forwardStalled: boolean;
  canCompleteMint: boolean;
  /** The attestation's expiration block has passed on the destination (Fast transfers only). */
  attestationExpired: boolean;
  /** First time each database state was reached (ISO), for the timeline. */
  reachedAt: Partial<Record<string, string>>;
}

const RANK: Record<string, number> = {
  CREATED: 0,
  APPROVED: 1,
  BURN_SUBMITTED: 2,
  BURN_CONFIRMED: 3,
  ATTESTATION_PENDING: 4,
  ATTESTED: 5,
  MINT_SUBMITTED: 6,
  COMPLETED: 7,
};

/** A transfer that never burned and has been idle this long is treated as abandoned. */
const ABANDONED_MS = 60 * 60 * 1000;

const ZERO_BYTES32 = /^0x0{64}$/;

/** Only a message with no destinationCaller can be minted by any wallet (CCTP v2 message format). */
export function anyoneCanMint(iris: IrisMessage | null | undefined): boolean {
  const caller = (iris?.decodedMessage as { destinationCaller?: string } | null | undefined)?.destinationCaller;
  return caller === undefined || ZERO_BYTES32.test(caller.toLowerCase());
}

/** Iris expirationBlock: "0" (or absent) means the attestation never expires. */
export function expirationBlockOf(iris: IrisMessage | null | undefined): bigint | null {
  const body = (iris?.decodedMessage as { decodedMessageBody?: { expirationBlock?: string | null } } | null | undefined)?.decodedMessageBody;
  const raw = body?.expirationBlock;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = BigInt(raw);
  return n === 0n ? null : n;
}

/**
 * After attestation a forwarded mint normally lands within minutes, whatever the speed
 * (speed only changes how long attestation takes). Past this, users may mint themselves.
 */
export const FORWARD_STALL_MS = 30 * 60_000;

/** When the transfer became attested, as far as Confluence recorded it (ms), or null. */
export function attestedAtMs(t: TransferDetail): number | null {
  const ev = t.events.find((e) => e.toState === "ATTESTED");
  if (ev) return new Date(ev.createdAt).getTime();
  if (t.state === "ATTESTED" || t.state === "MINT_SUBMITTED") return new Date(t.updatedAt).getTime();
  return null;
}

/** Forwarded, attested for over 30 minutes, and Circle has neither delivered nor failed it. */
export function isForwardStalled(t: TransferDetail, iris: IrisMessage | null | undefined, now = Date.now()): boolean {
  if (!t.useForwarder || !t.burnTxHash || t.state === "COMPLETED") return false;
  if (iris?.forwardState === "FAILED" || t.errorCode === "forward_failed") return false;
  if (FORWARD_DONE.has(iris?.forwardState ?? "")) return false;
  const at = attestedAtMs(t);
  const attested = at !== null || iris?.status === "complete";
  return attested && at !== null && now - at > FORWARD_STALL_MS;
}

export function deriveTxView(
  t: TransferDetail,
  iris: IrisMessage | null | undefined,
  nonceUsed: boolean | undefined,
  now = Date.now(),
  destinationBlock?: bigint,
): TxView {
  const reachedAt: Partial<Record<string, string>> = {};
  for (const e of t.events) if (reachedAt[e.toState] === undefined) reachedAt[e.toState] = e.createdAt;

  const rank = RANK[t.state] ?? -1;
  // Every state we store after a burn keeps the hash; RECOVERY_REQUIRED means it burned.
  const burned = Boolean(t.burnTxHash);
  const approved = burned || rank >= RANK.APPROVED! || reachedAt.APPROVED !== undefined;

  const dbAttested = rank >= RANK.ATTESTED! || reachedAt.ATTESTED !== undefined;
  const irisAttested = iris?.status === "complete";
  const attested = burned && (dbAttested || irisAttested);

  const dbMinted = t.state === "COMPLETED";
  const irisMinted = t.useForwarder && FORWARD_DONE.has(iris?.forwardState ?? "");
  const chainMinted = !t.useForwarder && nonceUsed === true;
  const minted = dbMinted || irisMinted || chainMinted;

  // Circle's own report, or the tracker's record of it (Stage 4a).
  const forwardFailed = t.useForwarder && (iris?.forwardState === "FAILED" || t.errorCode === "forward_failed") && !minted;

  // Circle's forwarder still has not delivered 30 minutes after attestation (for example a
  // destination network that is down). Minting yourself is safe: CCTP accepts each message
  // once, so whichever mint lands first wins and any other is rejected.
  const forwardStalled = !minted && isForwardStalled(t, iris, now);

  // Self-submitted mint: forwarding off, Circle's forward failed (Stage 4b), or it stalled.
  // Circle's docs: forwarded burns never set destinationCaller, so any wallet may submit the
  // mint; checked anyway.
  const canCompleteMint =
    (!t.useForwarder || forwardFailed || forwardStalled) &&
    burned &&
    attested &&
    !minted &&
    Boolean(iris?.attestation) &&
    anyoneCanMint(iris) &&
    nonceUsed !== true;

  const expiry = expirationBlockOf(iris);
  const attestationExpired = expiry !== null && destinationBlock !== undefined && destinationBlock >= expiry;

  let phase: TxPhase;
  if (minted) phase = "complete";
  else if (t.state === "FAILED" && !burned) phase = "failed";
  else if (forwardFailed || forwardStalled) phase = "needs_attention";
  else if (attested) phase = t.useForwarder ? "minting" : "ready_to_mint";
  else if (burned) phase = "awaiting_attestation";
  else if (now - new Date(t.updatedAt).getTime() > ABANDONED_MS) phase = "not_sent";
  else phase = "sending";

  return {
    phase,
    approved,
    burned,
    attested,
    minted,
    attestedFrom: attested ? (dbAttested ? "database" : "circle") : null,
    mintedFrom: minted ? (dbMinted ? "database" : irisMinted ? "circle" : "chain") : null,
    mintTxHash: t.mintTxHash ?? (irisMinted ? (iris?.forwardTxHash ?? null) : null),
    forwardFailed,
    forwardStalled,
    canCompleteMint,
    attestationExpired,
    reachedAt,
  };
}

export const PHASE_LABEL: Record<TxPhase, string> = {
  not_sent: "Not sent",
  failed: "Not sent",
  sending: "In progress",
  awaiting_attestation: "Awaiting attestation",
  minting: "Minting",
  ready_to_mint: "Ready to mint",
  complete: "Complete",
  needs_attention: "Needs attention",
};
