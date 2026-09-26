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
  /** Stage 8a: set when the payer chose a Confluence ID (the API resolved it). */
  recipientId: z.string().nullable().optional(),
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
  /** Stage 8a: pay a Confluence ID; the API resolves it (never the browser). */
  recipientId?: string;
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
      case "id_not_found":
        return "That Confluence ID does not exist. Check the spelling.";
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
  /** Stage 8a: set when the payer chose a Confluence ID (the API resolved it). */
  recipientId: z.string().nullable().optional(),
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
  /** Stage 8a: set when the payer chose a Confluence ID (the API resolved it). */
  recipientId: z.string().nullable().optional(),
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
  destinationChain: z.string().nullable().optional(),
  sender: z.string(),
  recipient: z.string(),
  tokenIn: z.enum(["USDC", "EURC", "USDT", "NATIVE"]),
  tokenOut: z.enum(["USDC", "EURC", "USDT", "NATIVE"]),
  amountIn: z.string(),
  feeRecipient: z.string(),
});
export type CreatedSwap = z.infer<typeof CreatedSwapSchema>;

export async function postSwap(
  input: {
    chain: string;
    destinationChain?: string;
    sender: string;
    tokenIn: SwapTokenSymbol;
    tokenOut: SwapTokenSymbol;
    amountIn: string;
  },
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
  | {
      step: "result";
      status: "DONE" | "FAILED" | "PENDING" | "NOT_FOUND";
      amountOut?: string;
      developerFee?: string;
      destinationTxHash?: string;
    }
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

// ---------- accounts and sign-in (Stage 7) ----------

/** Thrown when the session is missing, expired or revoked (HTTP 401). */
export class SessionExpiredError extends Error {}

async function authed(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${publicEnv.apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) throw new SessionExpiredError("session expired");
  if (!res.ok) throw await readError(res);
  return res;
}

export async function fetchNonce(): Promise<string> {
  const res = await fetch(`${publicEnv.apiUrl}/auth/nonce`, { cache: "no-store" });
  if (!res.ok) throw await readError(res);
  return z.object({ nonce: z.string() }).parse(await res.json()).nonce;
}

export async function verifySignIn(message: string, signature: string) {
  const res = await fetch(`${publicEnv.apiUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) throw await readError(res);
  return z.object({ token: z.string(), address: z.string(), expiresAt: z.string() }).parse(await res.json());
}

export const AccountSchema = z.object({
  address: z.string(),
  confluenceId: z.string().nullable(),
  idClaimedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Account = z.infer<typeof AccountSchema>;

export async function fetchMe(token: string): Promise<Account> {
  return AccountSchema.parse(await (await authed(token, "/me")).json());
}

export async function claimConfluenceId(token: string, handle: string): Promise<Account> {
  return AccountSchema.parse(await (await authed(token, "/me/id", { method: "POST", body: JSON.stringify({ handle }) })).json());
}

export async function checkIdAvailability(handle: string) {
  const res = await fetch(`${publicEnv.apiUrl}/ids/${encodeURIComponent(handle)}/availability`);
  if (!res.ok) throw await readError(res);
  return z.object({ handle: z.string(), available: z.boolean(), reason: z.string().nullable() }).parse(await res.json());
}

export const HistoryItemSchema = z.object({
  kind: z.enum(["bridge", "swap"]),
  direction: z.enum(["out", "in"]).default("out"),
  counterparty: z.string().nullable().optional(),
  counterpartyId: z.string().nullable().optional(),
  id: z.string(),
  state: z.string(),
  createdAt: z.string(),
  sourceChain: z.string(),
  destinationChain: z.string().nullable(),
  amountIn: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountOut: z.string().nullable(),
  recipient: z.string(),
  txHash: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export async function fetchHistory(token: string, before?: string) {
  const q = new URLSearchParams({ limit: "20", ...(before ? { before } : {}) });
  const j = await (await authed(token, `/me/history?${q}`)).json();
  return z.object({ items: z.array(HistoryItemSchema), nextBefore: z.string().nullable() }).parse(j);
}

const BookEntry = z.object({
  id: z.string(),
  address: z.string(),
  label: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().optional(),
});

export async function syncAddressBook(token: string, entries: z.infer<typeof BookEntry>[]) {
  const j = await (await authed(token, "/me/address-book", { method: "PUT", body: JSON.stringify({ entries }) })).json();
  return z.object({ entries: z.array(BookEntry) }).parse(j).entries;
}

export async function signOut(token: string, everywhere = false): Promise<void> {
  try {
    await authed(token, everywhere ? "/auth/signout-all" : "/auth/signout", { method: "POST", body: "{}" });
  } catch (e) {
    if (!(e instanceof SessionExpiredError)) throw e;
  }
}

// ---------- pay to a Confluence ID (Stage 8a) ----------

/** Resolves @handle for display only; payments are resolved again by the API. */
export async function lookupConfluenceId(handle: string): Promise<{ handle: string; address: string } | null> {
  const res = await fetch(`${publicEnv.apiUrl}/ids/${encodeURIComponent(handle)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await readError(res);
  return z.object({ handle: z.string(), address: z.string() }).parse(await res.json());
}

// ---------- site footer (content edited from the admin dashboard) ----------

const HttpsLink = z.string().url();
export const FooterSchema = z.object({
  settings: z.object({
    builtBy: z.object({ name: z.string(), url: HttpsLink.optional() }).nullable(),
    privacyUrl: HttpsLink.nullable(),
    termsUrl: HttpsLink.nullable(),
    copyright: z.string().nullable(),
    socials: z.array(z.object({ label: z.string(), url: HttpsLink })),
    network: z.object({ label: z.string(), url: HttpsLink.optional() }).nullable(),
  }),
  updatedAt: z.string().nullable(),
});
export type FooterContent = z.infer<typeof FooterSchema>["settings"];

export async function fetchFooter(): Promise<FooterContent> {
  const res = await fetch(`${publicEnv.apiUrl}/site/footer`);
  if (!res.ok) throw await readError(res);
  return FooterSchema.parse(await res.json()).settings;
}
