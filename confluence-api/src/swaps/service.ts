import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { swapEvents, swaps, type SwapState } from "../db/schema.js";
import { activeFeeRecipient } from "../fees/quote.js";
import { formatUnits, parseUnits } from "../lib/units.js";
import { calculateSwapFee } from "./fee.js";
import type { SwapChain, SwapRegistry, SwapToken } from "./tokens.js";

export class SwapError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_SWAP_EVENTS = 50;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function tokenOf(chain: SwapChain, symbol: string) {
  return chain.tokens.find((t) => t.symbol === symbol);
}

function chainOr400(reg: SwapRegistry, id: string): SwapChain {
  const c = reg.byId.get(id);
  if (!c) throw new SwapError(400, "unsupported_swap_chain", `"${id}" does not support swaps in this environment`);
  return c;
}

/** Backend fee for a swap (App Kit computeFee asks this). */
export function swapFee(reg: SwapRegistry, input: { chain: string; token: string; amount: string }) {
  const chain = chainOr400(reg, input.chain);
  const t = tokenOf(chain, input.token);
  if (!t) throw new SwapError(400, "unsupported_token", `${input.token} is not swappable on ${chain.name}`);
  try {
    const r = calculateSwapFee(t.symbol, input.amount, t.decimals);
    return { token: t.symbol, fee: r.fee, rule: r.rule, decimals: t.decimals };
  } catch {
    throw new SwapError(400, "invalid_amount", `amount must be a positive number with at most ${t.decimals} decimals`);
  }
}

export interface CreateSwapInput {
  chain: string;
  /** Stage 6b: a different swap chain for a cross-chain swap; omitted or equal = same-chain. */
  destinationChain?: string | undefined;
  sender: string;
  recipient?: string | undefined;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  idempotencyKey: string;
}

export async function createSwap(db: Db, reg: SwapRegistry, input: CreateSwapInput) {
  const chain = chainOr400(reg, input.chain);
  const dest = input.destinationChain && input.destinationChain !== chain.id ? chainOr400(reg, input.destinationChain) : chain;
  const crossChain = dest.id !== chain.id;
  const tin = tokenOf(chain, input.tokenIn);
  const tout = tokenOf(dest, input.tokenOut);
  if (!tin) throw new SwapError(400, "unsupported_token", `${input.tokenIn} is not swappable on ${chain.name}`);
  if (!tout) throw new SwapError(400, "unsupported_token", `${input.tokenOut} is not swappable on ${dest.name}`);
  if (!crossChain && tin.symbol === tout.symbol) throw new SwapError(400, "same_token", "tokenIn and tokenOut must differ");
  // USDC to USDC across chains is a bridge: CCTP moves it 1:1 without a swap.
  if (crossChain && tin.symbol === "USDC" && tout.symbol === "USDC") {
    throw new SwapError(400, "use_bridge", "moving USDC between chains is a bridge; use the Bridge tab");
  }
  let amountBase: bigint;
  try {
    amountBase = parseUnits(input.amountIn, tin.decimals);
  } catch {
    throw new SwapError(400, "invalid_amount", `amountIn must have at most ${tin.decimals} decimals`);
  }
  if (amountBase <= 0n) throw new SwapError(400, "invalid_amount", "amountIn must be positive");
  const feeRecipient = await activeFeeRecipient(db, chain.id);
  if (!feeRecipient) throw new SwapError(503, "fee_recipient_not_configured", `no fee recipient configured for ${chain.id}`);

  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const recipient = input.recipient ?? input.sender;
  try {
    await db.batch([
      db.insert(swaps).values({
        id,
        idempotencyKey: input.idempotencyKey,
        state: "CREATED",
        chain: chain.id,
        destinationChain: crossChain ? dest.id : null,
        sender: input.sender,
        recipient,
        tokenIn: tin.symbol,
        tokenOut: tout.symbol,
        amountIn: formatUnits(amountBase, tin.decimals),
        feeRecipient,
        reportTokenHash: sha256(token),
      }),
      db.insert(swapEvents).values({ swapId: id, fromState: null, toState: "CREATED", source: "client", detail: { action: "create" } }),
    ]);
  } catch (e) {
    if (String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error).message).includes("idempotency_key")) {
      throw new SwapError(409, "idempotency_key_used", "this Idempotency-Key already created a swap");
    }
    throw e;
  }
  return {
    id,
    reportToken: token,
    state: "CREATED" as SwapState,
    chain: chain.id,
    destinationChain: crossChain ? dest.id : null,
    sender: input.sender,
    recipient,
    tokenIn: tin.symbol,
    tokenOut: tout.symbol,
    amountIn: formatUnits(amountBase, tin.decimals),
    // App Kit sends the developer's 90% share here (resolveFeeRecipientAddress).
    feeRecipient,
  };
}

function tokenMatches(presented: string | undefined, stored: string | null): boolean {
  if (!presented || !stored) return false;
  const a = Buffer.from(sha256(presented), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SwapReport =
  | { step: "fee"; side: "input" | "output"; token: string; amount: string }
  | { step: "estimate"; estimatedOut: string; minOut: string }
  | { step: "approval"; txHash: string }
  | { step: "swap"; txHash: string }
  | {
      step: "result";
      status: "DONE" | "FAILED" | "PENDING" | "NOT_FOUND";
      amountOut?: string | undefined;
      developerFee?: string | undefined;
      /** Stage 6b: delivery transaction on the destination chain. */
      destinationTxHash?: string | undefined;
    }
  | { step: "error"; errorCategory?: string | undefined; errorMessage?: string | undefined };

/** Whether the fee Circle reports matches ours: the full fee or the 90% share, within 1 base unit. */
export function feeMatches(expected: string, charged: string, decimals: number): boolean {
  try {
    const e = parseUnits(expected, decimals);
    const c = parseUnits(charged, decimals);
    const near = (x: bigint, y: bigint) => (x > y ? x - y : y - x) <= 1n;
    return near(c, e) || near(c, (e * 90n) / 100n);
  } catch {
    return false;
  }
}

export async function recordSwapReport(db: Db, reg: SwapRegistry, swapId: string, token: string | undefined, r: SwapReport) {
  const s = await db.query.swaps.findFirst({ where: eq(swaps.id, swapId) });
  if (!s || !tokenMatches(token, s.reportTokenHash)) throw new SwapError(404, "swap_not_found", "swap not found or token invalid");
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(swapEvents).where(eq(swapEvents.swapId, s.id));
  if (n >= MAX_SWAP_EVENTS) throw new SwapError(429, "too_many_reports", "report limit reached for this swap");
  const chain = reg.byId.get(s.chain);

  const patch: Partial<typeof swaps.$inferInsert> = {};
  let to: SwapState = s.state;
  let response: Record<string, unknown> = {};
  const final = s.state === "COMPLETED" || s.state === "FAILED";

  switch (r.step) {
    case "fee": {
      if (s.state !== "CREATED") break;
      // Circle takes cross-chain swap fees from the input token on the source chain.
      if (s.destinationChain && r.side !== "input") throw new SwapError(400, "fee_side_invalid", "cross-chain swap fees are input-side");
      const feeToken = r.side === "input" ? s.tokenIn : s.tokenOut;
      if (r.token !== feeToken) throw new SwapError(400, "fee_token_mismatch", `the ${r.side}-side fee token for this swap is ${feeToken}`);
      if (!chain) throw new SwapError(409, "chain_unavailable", "this swap's chain is no longer supported");
      const f = swapFee(reg, { chain: s.chain, token: r.token, amount: r.amount });
      Object.assign(patch, { feeSide: r.side, feeToken: f.token, feeExpected: f.fee });
      response = { fee: f.fee, rule: f.rule, token: f.token };
      break;
    }
    case "estimate":
      if (s.state === "CREATED") Object.assign(patch, { estimatedOut: r.estimatedOut, minOut: r.minOut });
      break;
    case "approval":
      if (!final && !s.approvalTxHash) patch.approvalTxHash = r.txHash.toLowerCase();
      break;
    case "swap":
      if (s.swapTxHash && s.swapTxHash !== r.txHash.toLowerCase()) throw new SwapError(409, "swap_tx_conflict", "this swap already has a different transaction");
      if (s.state === "CREATED") {
        to = "SUBMITTED";
        patch.swapTxHash = r.txHash.toLowerCase();
      }
      break;
    case "result": {
      if (r.amountOut) patch.amountOut = r.amountOut;
      if (r.destinationTxHash && !s.destinationTxHash) patch.destinationTxHash = r.destinationTxHash.toLowerCase();
      if (r.developerFee !== undefined) {
        patch.feeCharged = r.developerFee;
        const dec = chain?.tokens.find((t) => t.symbol === (s.feeToken as SwapToken | null))?.decimals;
        if (s.feeExpected && dec !== undefined && !feeMatches(s.feeExpected, r.developerFee, dec)) patch.errorCode = "fee_mismatch";
      }
      if (!final && (s.state === "SUBMITTED" || s.swapTxHash)) {
        if (r.status === "DONE") to = "COMPLETED";
        else if (r.status === "FAILED") {
          to = "FAILED";
          patch.errorCode = patch.errorCode ?? "swap_failed";
        }
      }
      break;
    }
    case "error":
      // Before the swap transaction exists nothing moved on chain for this swap.
      if (s.state === "CREATED") {
        to = "FAILED";
        patch.errorCode = r.errorCategory ?? "unknown";
      }
      break;
  }

  if (to !== s.state) patch.state = to;
  const detail = { ...r, applied: to !== s.state || Object.keys(patch).length > 0 };
  try {
    if (Object.keys(patch).length === 0) {
      await db.insert(swapEvents).values({ swapId: s.id, fromState: s.state, toState: s.state, source: "client", detail });
    } else {
      patch.updatedAt = new Date();
      const [updated] = await db.batch([
        db
          .update(swaps)
          .set(patch)
          .where(and(eq(swaps.id, s.id), eq(swaps.state, s.state)))
          .returning({ id: swaps.id }),
        db.run(
          sql`insert into ${swapEvents} (swap_id, from_state, to_state, source, detail)
              select ${s.id}, ${s.state}, ${to}, 'client', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (updated.length === 0) throw new SwapError(409, "state_changed", "swap changed concurrently; resend the report");
    }
  } catch (e) {
    if (e instanceof SwapError) throw e;
    if (String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error).message).includes("swap_tx_hash")) {
      throw new SwapError(409, "swap_tx_taken", "this transaction is already linked to another swap");
    }
    throw e;
  }
  return { id: s.id, state: to, ...response };
}

export async function getSwap(db: Db, swapId: string) {
  const s = await db.query.swaps.findFirst({ where: eq(swaps.id, swapId) });
  if (!s) throw new SwapError(404, "swap_not_found", "swap not found");
  const events = await db
    .select({ fromState: swapEvents.fromState, toState: swapEvents.toState, source: swapEvents.source, detail: swapEvents.detail, createdAt: swapEvents.createdAt })
    .from(swapEvents)
    .where(eq(swapEvents.swapId, s.id))
    .orderBy(asc(swapEvents.id))
    .limit(MAX_SWAP_EVENTS);
  const { reportTokenHash: _hidden, idempotencyKey: _key, ...pub } = s;
  return {
    ...pub,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    trackedAt: s.trackedAt?.toISOString() ?? null,
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}
