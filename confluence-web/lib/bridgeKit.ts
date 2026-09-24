import { createPublicClient, fallback, http, type Chain, type EIP1193Provider, type PublicClient } from "viem";
import type { BridgeChain } from "./chains";

/**
 * Circle App Kit in the browser. Loaded on demand (dynamic import) when the user
 * confirms a bridge, so the SDK is not part of the first page load.
 *
 * Sources (installed SDK types, verified in Stage 2d):
 * - @circle-fin/adapter-viem-v2 createViemAdapterFromProvider({ provider, getPublicClient, capabilities })
 * - @circle-fin/app-kit AppKit.bridge / retryBridge / on / off
 */
export async function loadBridgeKit(provider: EIP1193Provider, registry: readonly BridgeChain[]) {
  const [{ AppKit, isUserCancellationError }, { createViemAdapterFromProvider }] = await Promise.all([
    import("@circle-fin/app-kit"),
    import("@circle-fin/adapter-viem-v2"),
  ]);

  // Reads go through the same RPCs as the rest of the app (the API's registry,
  // which comes from App Kit). Unknown chains fall back to the chain's own RPCs.
  const byId = new Map(registry.map((c) => [c.evmChainId, c]));
  const cache = new Map<number, PublicClient>();
  const getPublicClient = ({ chain }: { chain: Chain }): PublicClient => {
    const hit = cache.get(chain.id);
    if (hit) return hit;
    const urls = byId.get(chain.id)?.rpcUrls ?? chain.rpcUrls.default.http;
    const client = createPublicClient({ chain, transport: fallback(urls.map((u) => http(u))) }) as PublicClient;
    cache.set(chain.id, client);
    return client;
  };

  // A new adapter per bridge: the adapter caches the wallet account on first use,
  // so reusing one across account switches would sign with a stale account.
  const adapter = await createViemAdapterFromProvider({
    provider,
    getPublicClient,
    capabilities: { addressContext: "user-controlled" },
  });
  const kit = new AppKit();
  // The sequential approve/burn path does not always set errorCategory on a wallet
  // rejection; App Kit's own helper recognizes the wallet messages (MetaMask, Coinbase, ...).
  return { kit, adapter, isUserCancellationError };
}

export type LoadedBridgeKit = Awaited<ReturnType<typeof loadBridgeKit>>;

/** App Kit's bridge chain definitions (CCTP contracts, domains). No wallet needed. */
export async function loadChainDefinitions() {
  const { AppKit } = await import("@circle-fin/app-kit");
  return new AppKit().getSupportedChains("bridge");
}
