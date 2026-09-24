import { z } from "zod";
import { defineChain, type Chain } from "viem";
import { publicEnv } from "./env";

/**
 * Mirror of confluence-api's BridgeChain (src/chains/registry.ts). The API is the
 * source of truth; this schema validates what the browser receives.
 */
const Speed = z.object({ label: z.string(), minSeconds: z.number(), maxSeconds: z.number() });
export const BridgeChainSchema = z.object({
  id: z.string(),
  name: z.string(),
  evmChainId: z.number().int(),
  cctpDomain: z.number().int(),
  isTestnet: z.boolean(),
  explorerTxUrl: z.string(),
  usdcAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nativeCurrency: z.object({ name: z.string(), symbol: z.string(), decimals: z.number().int() }),
  rpcUrls: z.array(z.string().url()).min(1),
  forwarderAsDestination: z.boolean(),
  speed: z.object({ fast: Speed.nullable(), standard: Speed.nullable() }).nullable(),
});
export type BridgeChain = z.infer<typeof BridgeChainSchema>;

const ChainsResponse = z.object({
  env: z.enum(["testnet", "mainnet"]),
  speedSource: z.string(),
  chains: z.array(BridgeChainSchema).min(1),
});
export type ChainsResponse = z.infer<typeof ChainsResponse>;

export async function fetchChains(signal?: AbortSignal): Promise<ChainsResponse> {
  const res = await fetch(`${publicEnv.apiUrl}/chains`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`chains request failed (HTTP ${res.status})`);
  const data = ChainsResponse.parse(await res.json());
  if (data.env !== publicEnv.confluenceEnv) {
    throw new Error(`API environment is ${data.env}, but this app is ${publicEnv.confluenceEnv}`);
  }
  return data;
}

/** viem chain built from registry data (RPCs and explorer come from App Kit via the API). */
export function toViemChain(c: BridgeChain): Chain {
  const explorer = c.explorerTxUrl.replace(/\/tx\/\{hash\}.*$/, "");
  return defineChain({
    id: c.evmChainId,
    name: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: c.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: explorer } },
    testnet: c.isTestnet,
  });
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
