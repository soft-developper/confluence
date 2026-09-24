import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import type { BridgeChain } from "@/lib/chains";

/** USDC balance (base units, 6 decimals) of `address` on `chain`, via App Kit's USDC address. */
export function useUsdcBalance(chain: BridgeChain | undefined, address: `0x${string}` | undefined) {
  return useReadContract({
    address: chain?.usdcAddress as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain?.evmChainId,
    query: { enabled: !!chain && !!address, refetchInterval: 15_000 },
  });
}
