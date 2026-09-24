import { createConfig, fallback, http, type Config, type CreateConnectorFn } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import type { Chain } from "viem";
import { toViemChain, type BridgeChain } from "./chains";
import { publicEnv } from "./env";

/**
 * wagmi v3 config built at runtime from the API's chain registry, so the wallet
 * layer and the bridge always agree on which chains exist. Connector SDKs are
 * explicit dependencies in wagmi v3 (@walletconnect/ethereum-provider,
 * @coinbase/wallet-sdk). Browser only.
 */
// One config per page lifetime. React StrictMode (dev) renders twice and dev HMR
// re-evaluates modules; creating a second config would initialize WalletConnect
// Core twice ("Init() was called 2 times", heartbeat listener warnings). The cache
// lives on globalThis so it also survives HMR.
const CACHE_KEY = "__confluenceWagmiConfig";
type Cached = { key: string; config: Config };

export function getWagmiConfig(registry: readonly BridgeChain[]): Config {
  const key = `${publicEnv.walletConnectProjectId ?? ""}|${registry.map((c) => c.evmChainId).join(",")}`;
  const g = globalThis as unknown as Record<string, Cached | undefined>;
  const hit = g[CACHE_KEY];
  if (hit && hit.key === key) return hit.config;
  const config = buildWagmiConfig(registry);
  g[CACHE_KEY] = { key, config };
  return config;
}

function buildWagmiConfig(registry: readonly BridgeChain[]): Config {
  const chains = registry.map(toViemChain);
  if (chains.length === 0) throw new Error("no chains");
  const origin = window.location.origin;

  const connectors: CreateConnectorFn[] = [
    // EIP-6963 discovery (multiInjectedProviderDiscovery, on by default) adds one
    // connector per installed wallet; this generic one covers legacy window.ethereum.
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Confluence", appLogoUrl: `${origin}/confluence-mark.svg` }),
  ];
  if (publicEnv.walletConnectProjectId) {
    connectors.push(
      walletConnect({
        projectId: publicEnv.walletConnectProjectId,
        showQrModal: false, // we render our own QR screen
        metadata: {
          name: "Confluence",
          description: "USDC across chains, centered on Arc",
          url: origin,
          icons: [`${origin}/confluence-mark.svg`],
        },
      }),
    );
  }

  const transports = Object.fromEntries(
    registry.map((c) => [c.evmChainId, fallback(c.rpcUrls.map((u) => http(u)))]),
  );

  return createConfig({
    chains: chains as [Chain, ...Chain[]],
    connectors,
    transports,
    // ssr: true makes wagmi's <Hydrate> reconnect in an effect instead of during
    // render. With ssr: false it runs during render and React warns
    // "Cannot update a component (WalletButton) while rendering Hydrate".
    ssr: true,
  });
}
