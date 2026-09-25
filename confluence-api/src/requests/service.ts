import { randomBytes } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { getAddress } from "viem";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { accounts, paymentRequests, transfers } from "../db/schema.js";
import { formatUsdc, parseUsdc } from "../lib/usdc.js";

/** Stage 8b: payment requests, fixed amount, paid once; the payee receives the full amount. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MEMO_MAX = 140;
export const MIN_AMOUNT = 1_000_000n; // 1 USDC
export const MAX_AMOUNT = 1_000_000_000_000n; // 1,000,000 USDC
const IN_FLIGHT: ReadonlySet<string> = new Set(["BURN_SUBMITTED", "BURN_CONFIRMED", "ATTESTATION_PENDING", "ATTESTED", "MINT_SUBMITTED"]);

/** Short, unguessable link id (16 random bytes, base64url). */
const newId = () => randomBytes(16).toString("base64url");

export type RequestStatus = "open" | "paid" | "expired" | "cancelled";

async function view(db: Db, r: typeof paymentRequests.$inferSelect, now = new Date()) {
  const ts = await db
    .select({ id: transfers.id, state: transfers.state, sender: transfers.sender, updatedAt: transfers.updatedAt })
    .from(transfers)
    .where(eq(transfers.requestId, r.id))
    .orderBy(asc(transfers.updatedAt));
  const paid = ts.find((t) => t.state === "COMPLETED");
  const status: RequestStatus = paid ? "paid" : r.cancelledAt ? "cancelled" : r.expiresAt.getTime() <= now.getTime() ? "expired" : "open";
  return {
    id: r.id,
    status,
    payee: getAddress(r.creator),
    payeeId: r.payeeId,
    destinationChain: r.destinationChain,
    amount: { base: r.amountBase, usdc: formatUsdc(BigInt(r.amountBase)) },
    memo: r.memo,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    paidTransferId: paid?.id ?? null,
    paidAt: paid?.updatedAt.toISOString() ?? null,
    // A payment is on its way (burned, not yet minted): warn a second payer.
    paymentInProgress: !paid && ts.some((t) => IN_FLIGHT.has(t.state)),
  };
}

export async function createRequest(
  db: Db,
  registry: ChainRegistry,
  creator: string,
  input: { destinationChain: string; amount: string; memo?: string | undefined; expiresInDays?: number | undefined },
) {
  if (!registry.byId.get(input.destinationChain)) throw new RequestError(400, "unsupported_chain", "choose a supported destination chain");
  let amount: bigint;
  try {
    amount = parseUsdc(input.amount);
  } catch {
    throw new RequestError(400, "invalid_amount", "amount must be USDC with at most 6 decimals");
  }
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) throw new RequestError(400, "invalid_amount", "amount must be between 1 and 1,000,000 USDC");
  const memo = input.memo?.replace(/\s+/g, " ").trim().slice(0, MEMO_MAX) || null;
  const days = input.expiresInDays ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RequestError(400, "invalid_expiry", "expiry must be 1 to 90 days");
  const me = await db.query.accounts.findFirst({ where: eq(accounts.address, creator) });
  if (!me) throw new RequestError(404, "account_not_found", "account not found");
  const row = {
    id: newId(),
    creator,
    payeeId: me.confluenceId,
    destinationChain: input.destinationChain,
    amountBase: amount.toString(),
    memo,
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60_000),
  };
  await db.insert(paymentRequests).values(row);
  const saved = await db.query.paymentRequests.findFirst({ where: eq(paymentRequests.id, row.id) });
  return view(db, saved!);
}

export async function getRequest(db: Db, id: string) {
  const r = await db.query.paymentRequests.findFirst({ where: eq(paymentRequests.id, id) });
  if (!r) throw new RequestError(404, "request_not_found", "payment request not found");
  return view(db, r);
}

export async function cancelRequest(db: Db, creator: string, id: string) {
  const r = await db.query.paymentRequests.findFirst({ where: eq(paymentRequests.id, id) });
  if (!r || r.creator !== creator) throw new RequestError(404, "request_not_found", "payment request not found");
  const v = await view(db, r);
  if (v.status === "paid") throw new RequestError(409, "request_paid", "a paid request cannot be cancelled");
  if (v.status === "cancelled") return v;
  await db.update(paymentRequests).set({ cancelledAt: new Date() }).where(eq(paymentRequests.id, id));
  return getRequest(db, id);
}

export async function listMyRequests(db: Db, creator: string) {
  const rows = await db.select().from(paymentRequests).where(eq(paymentRequests.creator, creator)).orderBy(desc(paymentRequests.createdAt)).limit(100);
  return Promise.all(rows.map((r) => view(db, r)));
}

/** What POST /quotes needs to pay a request; refuses anything but an open request. */
export async function requestForQuote(db: Db, id: string) {
  const v = await getRequest(db, id);
  if (v.status !== "open") throw new RequestError(409, `request_${v.status}`, `this payment request is ${v.status}`);
  return {
    id: v.id,
    destinationChain: v.destinationChain,
    recipient: v.payee,
    recipientId: v.payeeId,
    receiveAtLeast: BigInt(v.amount.base),
  };
}

