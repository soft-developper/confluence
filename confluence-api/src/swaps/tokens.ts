import { AppKit } from "@circle-fin/app-kit";
import type { Config } from "../config.js";

/**
 * Same-chain swap chains and tokens, from App Kit's public chain definitions
 * (getSupportedChains("swap")): swap runs on mainnets and on Arc Testnet only.
 * Tokens are limited to what the chain definition lists (usdcAddress, eurcAddress,
 * usdtAddress) plus the native token, so nothing here is hand-maintained.
 */
export type SwapToken = "USDC" | "EURC" | "USDT" | "NATIVE";
/** Tokens whose value is one unit of fiat; the flat bridge fee rule applies to them. */
export const STABLE_TOKENS: ReadonlySet<SwapToken> = new Set(["USDC", "EURC", "USDT"]);

export interface SwapChain {
  id: string;
  name: string;
  evmChainId: number;
  tokens: { symbol: SwapToken; address: string | null; decimals: number; label: string }[];
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
    };
    const tokens: SwapChain["tokens"] = [];
    if (d.usdcAddress) tokens.push({ symbol: "USDC", address: d.usdcAddress, decimals: 6, label: "USDC" });
    if (d.eurcAddress) tokens.push({ symbol: "EURC", address: d.eurcAddress, decimals: 6, label: "EURC" });
    if (d.usdtAddress) tokens.push({ symbol: "USDT", address: d.usdtAddress, decimals: 6, label: "USDT" });
    // On Arc the native gas token IS USDC, so "NATIVE" would be a USDC to USDC swap.
    if (d.nativeCurrency.symbol !== "USDC") {
      tokens.push({ symbol: "NATIVE", address: null, decimals: d.nativeCurrency.decimals, label: d.nativeCurrency.symbol });
    }
    chains.push({ id: d.chain, name: d.name, evmChainId: d.chainId, tokens });
  }
  return { chains, byId: new Map(chains.map((c) => [c.id, c])) };
}
