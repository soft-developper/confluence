import { AppKit } from "@circle-fin/app-kit";
import type { Config } from "../config.js";

/**
 * Same-chain swap chains and tokens, from App Kit's public chain definitions
 * (getSupportedChains("swap")): swap runs on mainnets and on Arc Testnet only.
 * Tokens are limited to what the chain definition lists (usdcAddress, eurcAddress,
 * usdtAddress) plus the native token, so nothing here is hand-maintained.
 */
export type SwapToken = "USDC" | "EURC" | "USDT" | "NATIVE" | "CIRBTC";
/** Tokens whose value is one unit of fiat; the flat bridge fee rule applies to them. */
export const STABLE_TOKENS: ReadonlySet<SwapToken> = new Set(["USDC", "EURC", "USDT"]);

/**
 * cirBTC (Circle Wrapped Bitcoin, 8 decimals) on the chains where Circle has deployed it, from
 * Circle's developer docs: https://developers.circle.com/assets/cirbtc-contract-addresses
 * (App Kit's built-in cirBTC definition uses the same addresses). Circle's swap service quotes
 * cirBTC routes on Arc and Ethereum (checked with kit.estimateSwap on mainnet). It is not a
 * public App Kit token alias yet, so a swap passes this address to kit.swap instead of a
 * symbol. Keyed by App Kit chain id. (confluence:cirbtc-swap)
 */
export const CIRBTC_ADDRESSES: Readonly<Record<string, string>> = Object.freeze({
  Arc: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
  Ethereum: "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E",
  Arc_Testnet: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
});

/**
 * Tokens added after the first Swap UI shipped. GET /swaps/chains lists them only to clients
 * that ask with ?tokens=all, so an older web build never offers a token it can't swap yet.
 */
export const OPT_IN_TOKENS: ReadonlySet<SwapToken> = new Set(["CIRBTC"]);

export interface SwapChain {
  id: string;
  name: string;
  evmChainId: number;
  tokens: { symbol: SwapToken; address: string | null; decimals: number; label: string }[];
  /** Public RPC endpoints from App Kit, used to check who sent a swap (confluence:verified-swaps). */
  rpcUrls: string[];
}

export interface SwapRegistry {
  chains: SwapChain[];
  byId: Map<string, SwapChain>;
}

export function buildSwapRegistry(config: Config, kit: Pick<AppKit, "getSupportedChains"> = new AppKit()): SwapRegistry {
  const wantTestnet = config.CONFLUENCE_ENV === "testnet";
  const chains: SwapChain[] = [];
  for (const c of kit.getSupportedChains("swap")) {
    if (c.type !== "evm" || c.isTestnet !== wantTestnet) continue;
    const d = c as unknown as {
      chain: string;
      name: string;
      chainId: number;
      usdcAddress?: string | null;
      eurcAddress?: string | null;
      usdtAddress?: string | null;
      nativeCurrency: { symbol: string; decimals: number };
      rpcEndpoints?: readonly string[];
    };
    const tokens: SwapChain["tokens"] = [];
    if (d.usdcAddress) tokens.push({ symbol: "USDC", address: d.usdcAddress, decimals: 6, label: "USDC" });
    if (d.eurcAddress) tokens.push({ symbol: "EURC", address: d.eurcAddress, decimals: 6, label: "EURC" });
    if (d.usdtAddress) tokens.push({ symbol: "USDT", address: d.usdtAddress, decimals: 6, label: "USDT" });
    // On Arc the native gas token IS USDC, so "NATIVE" would be a USDC to USDC swap.
    if (d.nativeCurrency.symbol !== "USDC") {
      tokens.push({ symbol: "NATIVE", address: null, decimals: d.nativeCurrency.decimals, label: d.nativeCurrency.symbol });
    }
    const cirbtc = CIRBTC_ADDRESSES[d.chain];
    if (cirbtc) tokens.push({ symbol: "CIRBTC", address: cirbtc, decimals: 8, label: "cirBTC" });
    chains.push({ id: d.chain, name: d.name, evmChainId: d.chainId, tokens, rpcUrls: [...(d.rpcEndpoints ?? [])] });
  }
  return { chains, byId: new Map(chains.map((c) => [c.id, c])) };
}
