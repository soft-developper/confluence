import type { EIP1193Provider } from "viem";
import type { BridgeChain } from "./chains";

/**
 * App Kit's wallet adapter asks the wallet to SWITCH networks but never to ADD one, so a
 * wallet that has never used a chain (for example Plume Testnet) refuses and the action
 * fails. This wraps the wallet provider App Kit uses: when a switch fails because the
 * network is unknown (EIP-3326 error 4902), it asks the wallet to add the network
 * (EIP-3085 wallet_addEthereumChain) with the details from our chain list, then retries
 * the switch once. The user still approves both steps in their wallet.
 */
function unknownChain(e: unknown): boolean {
  const x = e as { code?: number; data?: { originalError?: { code?: number } }; message?: string } | undefined;
  if (!x) return false;
  if (x.code === 4902 || x.data?.originalError?.code === 4902) return true;
  // Some wallets wrap it as an internal error with a readable message.
  return /unrecognized chain|unknown chain|not been added|chain.*not.*(added|found|supported)|4902/i.test(String(x.message ?? ""));
}

export function addChainParams(c: BridgeChain) {
  let explorer: string | undefined;
  try {
    explorer = new URL(c.explorerTxUrl.replace("{hash}", "0x")).origin;
  } catch {
    explorer = undefined;
  }
  return {
    chainId: `0x${c.evmChainId.toString(16)}`,
    chainName: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: c.rpcUrls,
    ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
  };
}

export function withChainAdd(provider: EIP1193Provider, registry: readonly BridgeChain[]): EIP1193Provider {
  const request = (async (args: { method: string; params?: unknown }) => {
    try {
      return await provider.request(args as never);
    } catch (e) {
      if (args.method !== "wallet_switchEthereumChain" || !unknownChain(e)) throw e;
      const wanted = (Array.isArray(args.params) ? args.params[0] : undefined) as { chainId?: string } | undefined;
      const id = wanted?.chainId ? Number.parseInt(wanted.chainId, 16) : NaN;
      const chain = registry.find((c) => c.evmChainId === id);
      if (!chain) throw e;
      await provider.request({ method: "wallet_addEthereumChain", params: [addChainParams(chain)] } as never);
      return await provider.request(args as never);
    }
  }) as EIP1193Provider["request"];
  return new Proxy(provider, { get: (t, prop, recv) => (prop === "request" ? request : Reflect.get(t, prop, recv)) });
}
