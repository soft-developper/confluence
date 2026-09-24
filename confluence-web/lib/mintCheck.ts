import { createPublicClient, fallback, http } from "viem";
import type { BridgeChain } from "./chains";
import { loadChainDefinitions } from "./bridgeKit";
import { toViemChain } from "./chains";

// MessageTransmitterV2.usedNonces(bytes32) -> uint256; non-zero once the message was received.
// ABI as shipped in @circle-fin/adapter-viem-v2; contract docs:
// https://developers.circle.com/cctp/technical-guide (MessageTransmitterV2, Nonces)
const USED_NONCES_ABI = [
  {
    type: "function",
    name: "usedNonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Whether the destination already received this CCTP message (someone submitted the mint).
 * Returns undefined when it cannot tell (unknown contract, bad nonce, RPC failure).
 */
export async function isMessageReceived(destination: BridgeChain, nonce: string | undefined): Promise<boolean | undefined> {
  if (!nonce || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) return undefined;
  const defs = await loadChainDefinitions();
  const def = defs.find((d) => d.chain === destination.id);
  const v2 = (def as { cctp?: { contracts?: { v2?: { messageTransmitter?: string } } } } | undefined)?.cctp?.contracts?.v2;
  const address = v2?.messageTransmitter;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  try {
    const client = createPublicClient({
      chain: toViemChain(destination),
      transport: fallback(destination.rpcUrls.map((u) => http(u))),
    });
    const used = await client.readContract({
      address: address as `0x${string}`,
      abi: USED_NONCES_ABI,
      functionName: "usedNonces",
      args: [nonce as `0x${string}`],
    });
    return used !== 0n;
  } catch {
    return undefined;
  }
}
