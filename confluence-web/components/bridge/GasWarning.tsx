"use client";

import { formatUnits } from "viem";
import type { BridgeChain } from "@/lib/chains";
import type { SourceGasEstimate } from "@/lib/sourceGas";

/** A short native amount: up to 6 decimals, no trailing zeros. */
function fmtNative(wei: bigint, decimals: number): string {
  const s = formatUnits(wei, decimals);
  const [w, f = ""] = s.split(".");
  const t = f.slice(0, 6).replace(/0+$/, "");
  if (t) return `${w}.${t}`;
  return wei > 0n && w === "0" ? `less than 0.000001` : (w ?? "0");
}

/**
 * Warns (never blocks) when the wallet likely cannot pay source-chain gas for approve
 * and burn. CCTP and the Forwarding Service never pay source gas.
 */
export function GasWarning({
  chain,
  balanceWei,
  estimate,
}: {
  chain: BridgeChain;
  balanceWei: bigint | undefined;
  estimate?: SourceGasEstimate | null | undefined;
}) {
  if (balanceWei === undefined) return null;
  const sym = chain.nativeCurrency.symbol;
  const dec = chain.nativeCurrency.decimals;
  const short = estimate ? balanceWei < estimate.wei : false;
  if (balanceWei !== 0n && !short) return null;

  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-warning bg-bg p-3 text-[13px]">
      <span className="font-medium">
        {balanceWei === 0n ? `No ${sym} on ${chain.name} for gas` : `Low ${sym} on ${chain.name} for gas`}
      </span>
      <span className="text-ink-muted">
        Approve and burn are paid in {sym} on {chain.name}
        {estimate ? `, about ${fmtNative(estimate.wei, dec)} ${sym}` : ""}. This wallet has {fmtNative(balanceWei, dec)} {sym}, so your wallet
        may not let you confirm. Forwarding only covers the mint on the destination.
      </span>
    </div>
  );
}
