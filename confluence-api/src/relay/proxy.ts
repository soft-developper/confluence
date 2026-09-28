import { z } from "zod";
import type { RelayUpstream, UpstreamResponse } from "./upstream.js";

/**
 * What the browser may reach through our /relay proxy (R1). The Relay SDK is pointed at
 * <api>/relay as its baseApiUrl (https://docs.relay.link/references/api/api-keys#proxy-api),
 * so paths mirror Relay's own. Anything not listed here is refused: the proxy can't be
 * used as an open relay for our API key. (confluence:relay-proxy)
 */
interface Route {
  method: "GET" | "POST";
  path: string;
  cacheMs: number;
}
export const ROUTES: readonly Route[] = [
  { method: "GET", path: "/chains", cacheMs: 60 * 60_000 }, // changes rarely: fetch once, cache
  { method: "POST", path: "/currencies/v2", cacheMs: 10 * 60_000 },
  { method: "GET", path: "/currencies/token/price", cacheMs: 30_000 },
  { method: "POST", path: "/quote/v2", cacheMs: 0 },
  { method: "GET", path: "/intents/status", cacheMs: 2_000 },
  { method: "GET", path: "/intents/status/v2", cacheMs: 2_000 },
  { method: "GET", path: "/intents/status/v3", cacheMs: 2_000 },
  { method: "POST", path: "/execute/permits", cacheMs: 0 },
  { method: "POST", path: "/transactions/index", cacheMs: 0 },
  { method: "POST", path: "/transactions/single", cacheMs: 0 },
];

export function findRoute(method: string, path: string): Route | undefined {
  return ROUTES.find((r) => r.method === method && r.path === path);
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const ChainId = z.number().int().positive();

/**
 * Only the quote fields a bridge or swap needs. Calls (txs), deposit addresses and fee
 * sponsorship are dropped; appFees, referrer and includeProtocolData are set by us.
 */
export const QuoteInput = z
  .object({
    user: z.string().regex(EVM, "must be an EVM address"),
    recipient: z.string().regex(EVM, "must be an EVM address").optional(),
    originChainId: ChainId,
    destinationChainId: ChainId,
    originCurrency: z.string().regex(EVM, "must be an EVM token address"),
    destinationCurrency: z.string().regex(EVM, "must be an EVM token address"),
    amount: z.string().regex(/^[1-9][0-9]{0,77}$/, "must be a positive integer in base units"),
    tradeType: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]),
    refundTo: z.string().regex(EVM).optional(),
    slippageTolerance: z.string().regex(/^[0-9]{1,5}$/).optional(),
    usePermit: z.boolean().optional(),
    explicitDeposit: z.boolean().optional(),
  })
  .strip();
export type QuoteInput = z.infer<typeof QuoteInput>;

interface RelayChain {
  id?: number;
  vmType?: string;
  disabled?: boolean;
  depositEnabled?: boolean;
}

/** Relay's raw /chains entry for one chain (cached with the list). */
export async function relayChain(upstream: RelayUpstream, id: number): Promise<unknown> {
  const res = await upstream.request("GET", "/chains", undefined, ROUTES[0]!.cacheMs);
  const chains = ((res.body as { chains?: RelayChain[] } | null)?.chains ?? []) as RelayChain[];
  return chains.find((c) => c.id === id) ?? null;
}

/** v1 is EVM only: both chains must be enabled EVM chains in Relay's own /chains list. */
export async function usableEvmChainIds(upstream: RelayUpstream): Promise<Set<number>> {
  const res = await upstream.request("GET", "/chains", undefined, ROUTES[0]!.cacheMs);
  const chains = ((res.body as { chains?: RelayChain[] } | null)?.chains ?? []) as RelayChain[];
  return new Set(chains.filter((c) => c.vmType === "evm" && !c.disabled && c.depositEnabled !== false && typeof c.id === "number").map((c) => c.id!));
}

export interface QuoteExtras {
  appFeeBps: number;
  appFeeRecipient: string | null;
  referrer: string;
}

export function buildQuoteBody(input: QuoteInput, extras: QuoteExtras) {
  const appFees =
    extras.appFeeBps > 0 && extras.appFeeRecipient ? [{ recipient: extras.appFeeRecipient, fee: String(extras.appFeeBps) }] : undefined;
  return {
    ...input,
    recipient: input.recipient ?? input.user,
    referrer: extras.referrer,
    includeProtocolData: true,
    ...(appFees ? { appFees } : {}),
  };
}

export type ProxyResult = UpstreamResponse;
