import type { EIP1193Provider } from "viem";
import type { BridgeChain as KitChain } from "@circle-fin/app-kit";
import { loadBridgeKit } from "./bridgeKit";
import type { BridgeChain } from "./chains";

/**
 * Native gas the source chain needs for approve and burn, from App Kit's own
 * estimateBridge (the same step builders bridge() uses). CCTP never pays source gas:
 * Circle's docs list native gas on the source as a prerequisite even with the
 * Forwarding Service or upfront fees, so this is what the wallet must hold.
 *
 * Returns null when App Kit cannot estimate (for example an RPC error); callers then
 * fall back to a zero-balance check.
 */
export interface SourceGasEstimate {
  /** Total native gas for the source-chain steps, in wei. */
  wei: bigint;
  /** Steps that were priced (approve, burn). */
  steps: string[];
}

export interface SourceGasArgs {
  provider: unknown;
  registry: readonly BridgeChain[];
  from: BridgeChain;
  to: BridgeChain;
  sender: string;
  recipient: string;
  amountUsdc: string;
  speed: "FAST" | "SLOW";
  useForwarder: boolean;
  customFee: { value: string; recipientAddress: string };
}

/** App Kit reports fees as strings; accept wei integers and decimal native amounts. */
function toWei(fee: string, decimals: number): bigint | null {
  const s = fee.trim();
  if (/^\d+$/.test(s)) return BigInt(s);
  const m = /^(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

export async function estimateSourceGas(a: SourceGasArgs): Promise<SourceGasEstimate | null> {
  const provider = a.provider as EIP1193Provider | undefined;
  if (!provider || typeof provider.request !== "function") return null;
  try {
    const { kit, adapter } = await loadBridgeKit(provider, a.registry);
    const differentRecipient = a.recipient.toLowerCase() !== a.sender.toLowerCase();
    const est = await kit.estimateBridge({
      from: { adapter, chain: a.from.id as `${KitChain}` },
      to: {
        adapter,
        chain: a.to.id as `${KitChain}`,
        ...(differentRecipient ? { recipientAddress: a.recipient } : {}),
        useForwarder: a.useForwarder,
      },
      amount: a.amountUsdc,
      config: { transferSpeed: a.speed, batchTransactions: false, customFee: a.customFee },
    });
    let wei = 0n;
    const steps: string[] = [];
    for (const g of est.gasFees) {
      const name = g.name.toLowerCase();
      // Only the source-chain steps; the mint is on the destination (and paid by
      // Circle when forwarding is on).
      if (name !== "approve" && name !== "burn") continue;
      if (!g.fees) continue;
      const w = toWei(String(g.fees.fee), a.from.nativeCurrency.decimals);
      if (w === null) continue;
      wei += w;
      steps.push(name);
    }
    return steps.length > 0 ? { wei, steps } : null;
  } catch {
    return null;
  }
}
