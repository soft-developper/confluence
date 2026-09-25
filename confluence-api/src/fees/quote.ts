import { randomUUID } from "node:crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import type { BridgeChain, ChainRegistry } from "../chains/registry.js";
import { getAddress } from "viem";
import { idProblem, normalizeId } from "../accounts/service.js";
import type { IrisClient } from "../circle/iris.js";
import type { Db } from "../db/client.js";
import { accounts, feeRecipients, quotes } from "../db/schema.js";
import { formatUsdc, mulDivCeil, parseUsdc } from "../lib/usdc.js";
import { calculatePlatformFee, netPlatformFee } from "./platformFee.js";

export const QUOTE_TTL_MS = 60_000;

export interface QuoteInput {
  sourceChain: string;
  destinationChain: string;
  amount: string; // human USDC, e.g. "1000.50"
  sender: string;
  recipient?: string | undefined;
  /** Stage 8a: pay a Confluence ID; resolved here, never trusted from the browser. */
  recipientId?: string | undefined;
  speed: "FAST" | "SLOW";
  useForwarder: boolean;
}

export class QuoteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const money = (base: bigint) => ({ base: base.toString(), usdc: formatUsdc(base) });

export async function activeFeeRecipient(db: Db, chainId: string): Promise<string | null> {
  const row = await db.query.feeRecipients.findFirst({
    where: and(eq(feeRecipients.chain, chainId), lte(feeRecipients.effectiveFrom, new Date())),
    orderBy: desc(feeRecipients.effectiveFrom),
  });
  return row?.address ?? null;
}

function chainOr400(registry: ChainRegistry, id: string, field: string): BridgeChain {
  const c = registry.byId.get(id);
  if (!c) throw new QuoteError(400, "unsupported_chain", `${field} "${id}" is not a supported chain in this environment`);
  return c;
}

/** Builds, stores and returns a quote. All amounts are USDC base units internally. */
export async function createQuote(db: Db, registry: ChainRegistry, iris: IrisClient, input: QuoteInput) {
  const source = chainOr400(registry, input.sourceChain, "sourceChain");
  const destination = chainOr400(registry, input.destinationChain, "destinationChain");
  if (source.id === destination.id) throw new QuoteError(400, "same_chain", "source and destination must differ");

  if (input.speed === "FAST" && !source.speed?.fast) {
    throw new QuoteError(400, "fast_not_supported", `${source.name} does not support Fast Transfer as a source; use SLOW`);
  }
  if (input.useForwarder && !destination.forwarderAsDestination) {
    throw new QuoteError(400, "forwarding_not_supported", `Circle Forwarding is not available with ${destination.name} as destination`);
  }

  let amount: bigint;
  try {
    amount = parseUsdc(input.amount);
  } catch {
    throw new QuoteError(400, "invalid_amount", "amount must be a positive USDC value with at most 6 decimals");
  }
  if (amount <= 0n) throw new QuoteError(400, "invalid_amount", "amount must be greater than 0");

  const feeRecipient = await activeFeeRecipient(db, source.id);
  if (!feeRecipient) throw new QuoteError(503, "fee_recipient_not_configured", `no fee recipient configured for ${source.id}`);

  let routeFees;
  try {
    routeFees = await iris.getRouteFees(source.cctpDomain, destination.cctpDomain);
  } catch (e) {
    throw new QuoteError(502, "circle_fees_unavailable", `could not fetch CCTP fees from Circle: ${(e as Error).message}`);
  }

  const bps = input.speed === "FAST" ? routeFees.fastBps : routeFees.standardBps;
  if (bps == null) throw new QuoteError(502, "circle_fees_unavailable", `Circle returned no ${input.speed} fee for this route`);
  const cctpFee = mulDivCeil(amount, BigInt(Math.round(bps * 100)), 1_000_000n); // bps may be fractional
  const forwardingFee = input.useForwarder
    ? ((input.speed === "FAST" ? routeFees.forwardFeeFast : routeFees.forwardFeeStandard) ?? null)
    : 0n;
  if (forwardingFee == null) throw new QuoteError(502, "circle_fees_unavailable", "Circle returned no forwarding fee for this route");

  const platformFee = calculatePlatformFee(amount);
  const totalDebit = amount + platformFee;
  const expectedReceive = amount - cctpFee - forwardingFee;
  if (expectedReceive <= 0n) throw new QuoteError(400, "amount_too_small", "amount does not cover the CCTP and forwarding fees");

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
  let recipient = input.recipient ?? input.sender;
  let recipientId: string | null = null;
  if (input.recipientId !== undefined) {
    if (input.recipient) throw new QuoteError(400, "recipient_conflict", "send either recipient or recipientId, not both");
    const handle = normalizeId(input.recipientId);
    const acct = idProblem(handle) ? undefined : await db.query.accounts.findFirst({ where: eq(accounts.confluenceId, handle) });
    if (!acct) throw new QuoteError(404, "id_not_found", `@${handle} is not a Confluence ID`);
    recipient = getAddress(acct.address);
    recipientId = handle;
  }

  await db.insert(quotes).values({
    id,
    sourceChain: source.id,
    destinationChain: destination.id,
    sender: input.sender,
    recipient,
    recipientId,
    amountBase: amount.toString(),
    platformFeeBase: platformFee.toString(),
    cctpFeeBase: cctpFee.toString(),
    forwardingFeeBase: forwardingFee.toString(),
    speed: input.speed,
    useForwarder: input.useForwarder,
    feeRecipient,
    expiresAt,
  });

  return {
    id,
    expiresAt: expiresAt.toISOString(),
    sourceChain: source.id,
    destinationChain: destination.id,
    sender: input.sender,
    recipient,
    recipientId,
    speed: input.speed,
    useForwarder: input.useForwarder,
    eta: (input.speed === "FAST" ? source.speed?.fast : source.speed?.standard)?.label ?? null,
    amount: money(amount),
    platformFee: money(platformFee),
    totalDebit: money(totalDebit),
    cctpFee: { ...money(cctpFee), bps, estimated: true },
    forwardingFee: { ...money(forwardingFee), estimated: true },
    expectedReceive: { ...money(expectedReceive), estimated: true },
    // What App Kit needs: customFee.value is human-readable USDC.
    customFee: { value: formatUsdc(platformFee), recipientAddress: feeRecipient },
    platformFeeNet: money(netPlatformFee(platformFee)),
  };
}
