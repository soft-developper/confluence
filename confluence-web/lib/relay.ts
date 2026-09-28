import { z } from "zod";
import { publicEnv } from "./env";

/**
 * Relay (relay.link) data layer for the browser (R2). Every call goes through our API's
 * allowlisted /relay proxy, which holds the Relay API key and adds Confluence's app fee
 * server-side. Chains and tokens come from Relay's own lists, never a hard-coded table.
 * (confluence:relay-web)
 */
export const RELAY_BASE = `${publicEnv.apiUrl}/relay`;

/**
 * Execution (signing and sending) arrives in R3. Until then the Relay toggle only appears
 * with ?relay=preview in the URL, so users never meet a panel they can't finish.
 */
export const RELAY_EXECUTION_READY = false;

/** Relay's placeholder "user" for quotes before a wallet connects (as its SDK does). */
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";

export class RelayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readRelayError(res: Response): Promise<RelayApiError> {
  let body: { error?: string; errorCode?: string; message?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // non-JSON
  }
  return new RelayApiError(res.status, body.errorCode ?? body.error ?? `http_${res.status}`, body.message ?? `Request failed (HTTP ${res.status})`);
}

// ---------- settings ----------

const SettingsSchema = z.object({ enabled: z.boolean(), appFeeBps: z.number() });
export type RelaySettings = z.infer<typeof SettingsSchema>;

export async function fetchRelaySettings(signal?: AbortSignal): Promise<RelaySettings> {
  const res = await fetch(`${publicEnv.apiUrl}/relay-settings`, { signal });
  if (!res.ok) throw await readRelayError(res);
  return SettingsSchema.parse(await res.json());
}

// ---------- chains ----------

const TokenSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  symbol: z.string(),
  name: z.string().default(""),
  decimals: z.number().int().min(0).max(36),
  logoURI: z.string().optional(),
});
export type RelayToken = z.infer<typeof TokenSchema>;

const RawChain = z
  .object({
    id: z.number(),
    name: z.string().nullish(),
    displayName: z.string().nullish(),
    vmType: z.string().nullish(),
    disabled: z.boolean().nullish(),
    depositEnabled: z.boolean().nullish(),
    httpRpcUrl: z.string().nullish(),
    explorerUrl: z.string().nullish(),
    iconUrl: z.string().nullish(),
    currency: z
      .object({ address: z.string().nullish(), symbol: z.string().nullish(), name: z.string().nullish(), decimals: z.number().nullish() })
      .nullish(),
    featuredTokens: z
      .array(
        z.object({
          address: z.string().nullish(),
          symbol: z.string().nullish(),
          name: z.string().nullish(),
          decimals: z.number().nullish(),
          metadata: z.object({ logoURI: z.string().nullish() }).nullish(),
        }),
      )
      .nullish(),
  })
  .passthrough();

export interface RelayChain {
  id: number;
  name: string;
  rpcUrl: string | undefined;
  explorerUrl: string | undefined;
  iconUrl: string | undefined;
  native: RelayToken;
  featured: RelayToken[];
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** v1 shows EVM chains Relay currently accepts deposits on (the API enforces the same rule). */
export function toRelayChains(raw: unknown): RelayChain[] {
  const list = z.object({ chains: z.array(z.unknown()) }).parse(raw).chains;
  const out: RelayChain[] = [];
  for (const item of list) {
    const p = RawChain.safeParse(item);
    if (!p.success) continue;
    const c = p.data;
    if (c.vmType !== "evm" || c.disabled || c.depositEnabled === false) continue;
    const native: RelayToken = {
      chainId: c.id,
      address: c.currency?.address && EVM_ADDRESS.test(c.currency.address) ? c.currency.address : NATIVE_ADDRESS,
      symbol: c.currency?.symbol ?? "ETH",
      name: c.currency?.name ?? c.currency?.symbol ?? "Native",
      decimals: c.currency?.decimals ?? 18,
    };
    const featured = (c.featuredTokens ?? [])
      .filter((t) => t.address && EVM_ADDRESS.test(t.address) && t.symbol && typeof t.decimals === "number")
      .map((t) => ({ chainId: c.id, address: t.address!, symbol: t.symbol!, name: t.name ?? t.symbol!, decimals: t.decimals!, logoURI: t.metadata?.logoURI ?? undefined }));
    out.push({
      id: c.id,
      name: c.displayName ?? c.name ?? `Chain ${c.id}`,
      rpcUrl: c.httpRpcUrl ?? undefined,
      explorerUrl: c.explorerUrl ?? undefined,
      iconUrl: c.iconUrl ?? undefined,
      native,
      featured,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRelayChains(signal?: AbortSignal): Promise<RelayChain[]> {
  const res = await fetch(`${RELAY_BASE}/chains`, { signal });
  if (!res.ok) throw await readRelayError(res);
  return toRelayChains(await res.json());
}

// ---------- tokens ----------

const CurrencySchema = z.object({
  chainId: z.number(),
  address: z.string(),
  symbol: z.string(),
  name: z.string().optional(),
  decimals: z.number(),
  vmType: z.string().optional(),
  metadata: z.object({ logoURI: z.string().nullish(), verified: z.boolean().nullish() }).nullish(),
});

export async function searchRelayTokens(chainId: number, term: string, signal?: AbortSignal): Promise<RelayToken[]> {
  const t = term.trim();
  const body = EVM_ADDRESS.test(t)
    ? { chainIds: [chainId], address: t, limit: 20 }
    : { chainIds: [chainId], ...(t ? { term: t } : { defaultList: true }), verified: true, limit: 40 };
  const res = await fetch(`${RELAY_BASE}/currencies/v2`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await readRelayError(res);
  const raw = z.array(z.unknown()).parse(await res.json());
  const seen = new Set<string>();
  const out: RelayToken[] = [];
  for (const item of raw) {
    const p = CurrencySchema.safeParse(item);
    if (!p.success || p.data.chainId !== chainId || !EVM_ADDRESS.test(p.data.address)) continue;
    const key = p.data.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chainId, address: p.data.address, symbol: p.data.symbol, name: p.data.name ?? p.data.symbol, decimals: p.data.decimals, logoURI: p.data.metadata?.logoURI ?? undefined });
  }
  return out;
}

export function sameToken(a: RelayToken | null | undefined, b: RelayToken | null | undefined): boolean {
  return !!a && !!b && a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();
}

export function isNative(t: RelayToken): boolean {
  return t.address.toLowerCase() === NATIVE_ADDRESS;
}

// ---------- quotes ----------

const Amount = z
  .object({
    currency: z.object({ symbol: z.string().nullish(), decimals: z.number().nullish() }).partial().nullish(),
    amount: z.string().nullish(),
    amountFormatted: z.string().nullish(),
    amountUsd: z.string().nullish(),
    minimumAmount: z.string().nullish(),
  })
  .passthrough();
const Usd = z.object({ usd: z.string().nullish() }).passthrough();

export const RelayQuoteSchema = z
  .object({
    steps: z.array(z.unknown()).nullish(),
    details: z
      .object({
        operation: z.string().nullish(),
        currencyIn: Amount.nullish(),
        currencyOut: Amount.nullish(),
        rate: z.string().nullish(),
        timeEstimate: z.number().nullish(),
        totalImpact: z.object({ usd: z.string().nullish(), percent: z.string().nullish() }).passthrough().nullish(),
        expandedPriceImpact: z
          .object({ swap: Usd.nullish(), execution: Usd.nullish(), relay: Usd.nullish(), app: Usd.nullish() })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
export type RelayQuote = z.infer<typeof RelayQuoteSchema>;

export interface RelayQuoteRequest {
  user: string;
  recipient?: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType: "EXACT_INPUT";
}

export async function postRelayQuote(req: RelayQuoteRequest, signal?: AbortSignal): Promise<RelayQuote> {
  const res = await fetch(`${RELAY_BASE}/quote/v2`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), signal });
  if (!res.ok) throw await readRelayError(res);
  return RelayQuoteSchema.parse(await res.json());
}

/** User-facing text for quote failures (Relay error codes are listed in its "Handling Quote Errors" guide). */
export function relayQuoteErrorText(e: unknown): string {
  if (e instanceof RelayApiError) {
    if (e.status === 429) return "Too many quote requests right now. Wait a moment and try again.";
    if (e.code === "relay_disabled" || e.code === "relay_not_configured") return "Relay routes are unavailable right now.";
    if (e.code === "unsupported_chain") return "This chain isn't available through Relay right now.";
    if (e.code === "AMOUNT_TOO_LOW") return "This amount is below Relay's minimum for the route. Enter a larger amount.";
    if (e.code === "NO_SWAP_ROUTES_FOUND" || e.code === "NO_QUOTES") return "Relay found no route for this pair. Try another token or chain.";
    if (e.code === "INSUFFICIENT_LIQUIDITY") return "Not enough liquidity for this amount right now. Try a smaller amount.";
    return e.message;
  }
  return "Could not get a quote. Check your connection and try again.";
}

/** Relay reports each fee component as a (usually negative) USD impact; show its size. */
export function usdAbs(v: string | undefined): string | null {
  if (v === undefined) return null;
  const n = Math.abs(Number(v));
  if (!Number.isFinite(n)) return null;
  return n > 0 && n < 0.01 ? "< $0.01" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------- request registration (R3a) ----------

export interface RegisterRelayRequest {
  requestId: string;
  user: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  symbolIn: string;
  symbolOut: string;
  amountIn: string;
  amountOutQuoted?: string;
  inTxHash?: string;
  decimalsIn?: number;
  decimalsOut?: number;
  appFeeQuotedUsd?: string;
}

/** Records a started Relay request for history and analytics. Best effort: never blocks the user. */
export async function registerRelayRequest(r: RegisterRelayRequest): Promise<void> {
  try {
    await fetch(`${publicEnv.apiUrl}/relay-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) });
  } catch {
    // history is best effort; the transfer itself is unaffected
  }
}

/** Friendly text for errors thrown while executing (wallet rejections, timeouts, Relay errors). */
export function relayExecErrorText(e: unknown): string {
  const x = e as { code?: number; message?: string; shortMessage?: string } | undefined;
  const msg = String(x?.shortMessage ?? x?.message ?? e ?? "");
  if (x?.code === 4001 || /user (rejected|denied)|rejected the request|request rejected|cancell?ed/i.test(msg)) return "You declined the request in your wallet. Nothing was sent.";
  if (e instanceof RelayApiError) return relayQuoteErrorText(e);
  if (/insufficient funds/i.test(msg)) return "Your wallet doesn't have enough gas on the source chain for this transaction.";
  if (/does not support chain|chain missing/i.test(msg)) return "Your wallet doesn't support the source chain. Try a different wallet or chain.";
  return msg ? msg.slice(0, 220) : "Something went wrong. Check your wallet and try again.";
}
