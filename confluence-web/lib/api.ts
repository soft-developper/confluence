import { z } from "zod";
import { publicEnv } from "./env";

const Money = z.object({ base: z.string(), usdc: z.string() });
export const QuoteSchema = z.object({
  id: z.string(),
  expiresAt: z.string(),
  sourceChain: z.string(),
  destinationChain: z.string(),
  sender: z.string(),
  recipient: z.string(),
  speed: z.enum(["FAST", "SLOW"]),
  useForwarder: z.boolean(),
  eta: z.string().nullable(),
  amount: Money,
  platformFee: Money,
  totalDebit: Money,
  cctpFee: Money.extend({ bps: z.number(), estimated: z.boolean() }),
  forwardingFee: Money.extend({ estimated: z.boolean() }),
  expectedReceive: Money.extend({ estimated: z.boolean() }),
  customFee: z.object({ value: z.string(), recipientAddress: z.string() }),
  platformFeeNet: Money,
});
export type Quote = z.infer<typeof QuoteSchema>;

export interface QuoteRequest {
  sourceChain: string;
  destinationChain: string;
  amount: string;
  sender: string;
  recipient?: string;
  speed: "FAST" | "SLOW";
  useForwarder: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readError(res: Response): Promise<ApiError> {
  let body: { error?: string; message?: string; retryAfterSeconds?: number } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // non-JSON error
  }
  return new ApiError(res.status, body.error ?? `http_${res.status}`, body.message ?? `Request failed (HTTP ${res.status})`);
}

export async function postQuote(req: QuoteRequest, signal?: AbortSignal): Promise<Quote> {
  const res = await fetch(`${publicEnv.apiUrl}/quotes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw await readError(res);
  return QuoteSchema.parse(await res.json());
}

export async function fetchMaxAmount(balanceBase: bigint, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${publicEnv.apiUrl}/fees/max-amount?balance=${balanceBase.toString()}`, { signal });
  if (!res.ok) throw await readError(res);
  const data = z.object({ maxAmount: Money }).parse(await res.json());
  return data.maxAmount.usdc;
}

/** User-facing text for API error codes (see confluence-api src/fees/quote.ts). */
export function quoteErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "amount_too_small":
        return "This amount does not cover the Circle fees for this route. Enter a larger amount.";
      case "fast_not_supported":
        return "Fast Transfer is not available from this chain. Standard is selected instead.";
      case "forwarding_not_supported":
        return "Forwarding is not available to this destination.";
      case "circle_fees_unavailable":
        return "Circle's fee service is not responding. Try again in a moment.";
      case "fee_recipient_not_configured":
        return "This route is not configured yet.";
      case "rate_limited":
        return "Too many quote requests. Wait a minute and try again.";
      default:
        return e.message;
    }
  }
  return "Could not get a quote. Check your connection and try again.";
}

// ---------- transfers (Stage 2d) ----------

export const CreatedTransferSchema = z.object({
  id: z.string(),
  reportToken: z.string(),
  state: z.string(),
  quoteId: z.string(),
  sourceChain: z.string(),
  destinationChain: z.string(),
  sender: z.string(),
  recipient: z.string(),
  speed: z.enum(["FAST", "SLOW"]),
  useForwarder: z.boolean(),
  amount: Money,
  platformFee: Money,
  totalDebit: Money,
  customFee: z.object({ value: z.string(), recipientAddress: z.string() }),
});
export type CreatedTransfer = z.infer<typeof CreatedTransferSchema>;

/** Creates a transfer from a quote. The key makes a retried request safe (same key, same result). */
export async function postTransfer(input: { quoteId: string; sender: string }, idempotencyKey: string): Promise<CreatedTransfer> {
  const res = await fetch(`${publicEnv.apiUrl}/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return CreatedTransferSchema.parse(await res.json());
}

export interface StepReportBody {
  step: string;
  state: "pending" | "success" | "error" | "noop";
  txHash?: string;
  errorCategory?: string;
  errorMessage?: string;
  forwarded?: boolean;
  batched?: boolean;
  warnings?: { code: string; message?: string }[];
}

/** Reports one App Kit step to the API. Authenticated by the transfer's report token. */
export async function postTransferEvent(id: string, token: string, body: StepReportBody): Promise<void> {
  const res = await fetch(`${publicEnv.apiUrl}/transfers/${encodeURIComponent(id)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Transfer-Token": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
}

/** User-facing text for POST /transfers errors (see confluence-api src/transfers/service.ts). */
export function transferErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "quote_expired":
      case "quote_already_used":
        return "This quote is no longer valid. A fresh quote has been loaded; confirm again.";
      case "quote_sender_mismatch":
        return "The connected wallet changed. Go back and review again.";
      case "rate_limited":
        return "Too many attempts. Wait a minute and try again.";
      default:
        return e.message;
    }
  }
  return "Could not reach the Confluence API. Check your connection and try again.";
}

// ---------- transaction page (Stage 2e) ----------

const EstimatedMoney = Money.extend({ estimated: z.boolean() });

export const TransferDetailSchema = z.object({
  id: z.string(),
  quoteId: z.string(),
  state: z.string(),
  sourceChain: z.string(),
  destinationChain: z.string(),
  sender: z.string(),
  recipient: z.string(),
  speed: z.enum(["FAST", "SLOW"]),
  useForwarder: z.boolean(),
  amount: Money,
  platformFee: Money,
  cctpFee: EstimatedMoney.optional(),
  forwardingFee: EstimatedMoney.optional(),
  expectedReceive: EstimatedMoney.optional(),
  burnTxHash: z.string().nullable(),
  mintTxHash: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(
    z.object({
      fromState: z.string().nullable(),
      toState: z.string(),
      source: z.string(),
      detail: z.unknown(),
      createdAt: z.string(),
    }),
  ),
});
export type TransferDetail = z.infer<typeof TransferDetailSchema>;

/** Public read of a transfer. Returns null when it does not exist. */
export async function fetchTransfer(id: string): Promise<TransferDetail | null> {
  const res = await fetch(`${publicEnv.apiUrl}/transfers/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res);
  return TransferDetailSchema.parse(await res.json());
}

// ---------- swaps (Stage 6a) ----------

export type SwapTokenSymbol = "USDC" | "EURC" | "USDT" | "NATIVE";

export const SwapChainsSchema = z.object({
  chains: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      evmChainId: z.number(),
      tokens: z.array(
        z.object({
          symbol: z.enum(["USDC", "EURC", "USDT", "NATIVE"]),
          address: z.string().nullable(),
          decimals: z.number(),
          label: z.string(),
        }),
      ),
    }),
  ),
});
export type SwapChainInfo = z.infer<typeof SwapChainsSchema>["chains"][number];

export async function fetchSwapChains(): Promise<SwapChainInfo[]> {
  const res = await fetch(`${publicEnv.apiUrl}/swaps/chains`);
  if (!res.ok) throw await readError(res);
  return SwapChainsSchema.parse(await res.json()).chains;
}

const FeeResponse = z.object({ token: z.string(), fee: z.string(), rule: z.enum(["flat", "percent"]) });

/** Backend swap fee for an amount of a fee token (stateless, for estimates). */
export async function postSwapFee(input: { chain: string; token: SwapTokenSymbol; amount: string }) {
  const res = await fetch(`${publicEnv.apiUrl}/swaps/fee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return FeeResponse.parse(await res.json());
}

export const CreatedSwapSchema = z.object({
  id: z.string(),
  reportToken: z.string(),
  state: z.string(),
  chain: z.string(),
  sender: z.string(),
  recipient: z.string(),
  tokenIn: z.enum(["USDC", "EURC", "USDT", "NATIVE"]),
  tokenOut: z.enum(["USDC", "EURC", "USDT", "NATIVE"]),
  amountIn: z.string(),
  feeRecipient: z.string(),
});
export type CreatedSwap = z.infer<typeof CreatedSwapSchema>;

export async function postSwap(
  input: { chain: string; sender: string; tokenIn: SwapTokenSymbol; tokenOut: SwapTokenSymbol; amountIn: string },
  idempotencyKey: string,
): Promise<CreatedSwap> {
  const res = await fetch(`${publicEnv.apiUrl}/swaps`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await readError(res);
  return CreatedSwapSchema.parse(await res.json());
}

export type SwapReportBody =
  | { step: "fee"; side: "input" | "output"; token: SwapTokenSymbol; amount: string }
  | { step: "estimate"; estimatedOut: string; minOut: string }
  | { step: "approval"; txHash: string }
  | { step: "swap"; txHash: string }
  | { step: "result"; status: "DONE" | "FAILED" | "PENDING" | "NOT_FOUND"; amountOut?: string; developerFee?: string }
  | { step: "error"; errorCategory?: string; errorMessage?: string };

/** Reports one swap step. For the fee step the API answers with our backend fee. */
export async function postSwapEvent(id: string, token: string, body: SwapReportBody): Promise<{ state: string; fee?: string }> {
  const res = await fetch(`${publicEnv.apiUrl}/swaps/${encodeURIComponent(id)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Transfer-Token": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { state: string; fee?: string };
}
