"use client";

import { erc20Abi, formatUnits } from "viem";
import { useConnection, useReadContract, useSwitchChain } from "wagmi";
import { useBridgeChains } from "@/components/Providers";

/** USDC balance on the connected chain (ERC-20, 6 decimals), using App Kit's USDC address. */
export function UsdcBalance() {
  const { address, chainId, status } = useConnection();
  const { chains, byEvmId } = useBridgeChains();
  const { mutate: switchChain, isPending } = useSwitchChain();
  const chain = chainId ? byEvmId.get(chainId) : undefined;
  const bal = useReadContract({
    address: chain?.usdcAddress as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain?.evmChainId,
    query: { enabled: !!chain && !!address, refetchInterval: 15_000 },
  });

  if (status !== "connected") return <p className="text-sm text-ink-muted">Connect a wallet to see your USDC balance.</p>;
  if (!chain) {
    const arc = chains.find((c) => c.id.startsWith("Arc")) ?? chains[0];
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-warning">Your wallet is on a network Confluence does not support.</span>
        {arc && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => switchChain({ chainId: arc.evmChainId })}
            className="h-9 rounded-md border border-border-control px-3 hover:border-action-text"
          >
            {isPending ? "Switching..." : `Switch to ${arc.name}`}
          </button>
        )}
      </div>
    );
  }
  return (
    <p className="text-sm text-ink-muted">
      USDC on {chain.name}:{" "}
      <span className="tnum font-medium text-ink">
        {bal.isLoading ? "..." : bal.data !== undefined ? formatUnits(bal.data, 6) : "unavailable"}
      </span>
    </p>
  );
}
