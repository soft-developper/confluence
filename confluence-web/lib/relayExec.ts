import { adaptViemWallet, createClient, getClient, type Execute, type ProgressData } from "@relayprotocol/relay-sdk";
import { fetchChainConfigs } from "@relayprotocol/relay-sdk/chain-utils";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { postRelayQuoteRaw, RELAY_BASE, type RelayQuoteRequest } from "./relay";
import { publicEnv } from "./env";

/**
 * Relay execution (R3a) with the official Relay SDK, pointed at our API's /relay proxy
 * (https://docs.relay.link/references/api/api-keys#proxy-api), so the API key stays on
 * the server and every quote is verified there before it reaches the wallet.
 * (confluence:relay-exec)
 */
let ready: Promise<void> | null = null;

/** One SDK client per page, with Relay's chain list loaded through our proxy. */
export function ensureRelayClient(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const source = typeof window !== "undefined" ? window.location.hostname : undefined;
      const chains = await fetchChainConfigs(RELAY_BASE, source);
      createClient({
        baseApiUrl: RELAY_BASE,
        source,
        chains,
        // Relay checks status every 5s by default, 30 times (2.5 min). Slow routes can take
        // longer, so allow about 10 minutes before the SDK gives up waiting.
        pollingInterval: 5_000,
        maxPollingAttemptsBeforeTimeout: 120,
        uiVersion: `confluence-${publicEnv.confluenceEnv}`,
      });
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export interface RelayRun {
  quote: Execute;
  progress: ProgressData | null;
  requestId: string | undefined;
}

/**
 * Gets a fresh quote (verified by our API) for the connected wallet, then lets the SDK
 * run its steps: approve and deposit in the wallet, then wait for Relay to deliver.
 */
export async function executeRelay(opts: {
  request: RelayQuoteRequest;
  getProvider: () => Promise<unknown>;
  account: `0x${string}`;
  onProgress: (p: ProgressData) => void;
  signal?: AbortSignal;
}): Promise<Execute> {
  await ensureRelayClient();
  // The raw quote, untouched: the SDK needs every field Relay sent (see postRelayQuoteRaw).
  const quote = (await postRelayQuoteRaw(opts.request, opts.signal)) as Execute;
  const provider = (await opts.getProvider()) as EIP1193Provider;
  const walletClient = createWalletClient({ account: opts.account, transport: custom(provider) });
  const wallet = adaptViemWallet(walletClient);
  // The SDK checks that the wallet is already on the source chain before each transaction
  // ("Current chain id ... does not match expected chain id"); it doesn't switch for us.
  // Switch first, using the adapter's switchChain, which adds the network to the wallet
  // from Relay's chain list if the wallet doesn't know it yet.
  const sourceChainId = quote.details?.currencyIn?.currency?.chainId;
  if (typeof sourceChainId === "number" && (await wallet.getChainId()) !== sourceChainId) {
    await wallet.switchChain(sourceChainId);
  }
  const run = getClient().actions.execute({ quote, wallet, onProgress: opts.onProgress });
  opts.signal?.addEventListener("abort", () => run.abortController.abort(), { once: true });
  const out = await run;
  return out.data;
}

export function requestIdOf(q: { steps?: { requestId?: string }[] } | null | undefined): string | undefined {
  return q?.steps?.find((s) => s.requestId)?.requestId;
}
