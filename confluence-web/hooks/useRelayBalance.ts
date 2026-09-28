"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, http, type PublicClient } from "viem";
import { isNative, type RelayChain, type RelayToken } from "@/lib/relay";

/**
 * Balance of any token on any Relay chain, read straight from the chain through the RPC
 * URL in Relay's own chain list (our wallet config only knows the CCTP chains).
 */
const clients = new Map<number, PublicClient>();
function clientFor(chain: RelayChain): PublicClient | null {
  if (!chain.rpcUrl) return null;
  let c = clients.get(chain.id);
  if (!c) {
    c = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 10_000 }) }) as PublicClient;
    clients.set(chain.id, c);
  }
  return c;
}

export function useRelayBalance(chain: RelayChain | undefined, token: RelayToken | null, owner: string | undefined) {
  return useQuery({
    queryKey: ["relay-balance", chain?.id, token?.address.toLowerCase(), owner?.toLowerCase()],
    queryFn: async (): Promise<bigint> => {
      const client = clientFor(chain!);
      if (!client) throw new Error("no RPC for this chain");
      if (isNative(token!)) return client.getBalance({ address: owner as `0x${string}` });
      return client.readContract({ address: token!.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
    },
    enabled: !!chain && !!token && !!owner && !!chain.rpcUrl,
    staleTime: 20_000,
    retry: 1,
  });
}
