"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { fetchChains, type BridgeChain, type ChainsResponse } from "@/lib/chains";
import { getWagmiConfig } from "@/lib/wagmi";

const ChainsContext = createContext<ChainsResponse | null>(null);

/** Registry chains from the API. Only usable inside <Providers>. */
export function useBridgeChains(): { chains: readonly BridgeChain[]; byEvmId: ReadonlyMap<number, BridgeChain> } {
  const data = useContext(ChainsContext);
  if (!data) throw new Error("useBridgeChains must be used inside <Providers>");
  return useMemo(() => ({ chains: data.chains, byEvmId: new Map(data.chains.map((c) => [c.evmChainId, c])) }), [data]);
}

function ChainsGate({ children }: { children: React.ReactNode }) {
  // Loads quietly, with extra retries so a slow API start (for example after idling) never shows an error too early.
  const q = useQuery({
    queryKey: ["chains"],
    queryFn: ({ signal }) => fetchChains(signal),
    staleTime: 5 * 60_000,
    retry: 5,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
  });
  const config = useMemo(() => (q.data ? getWagmiConfig(q.data.chains) : null), [q.data]);

  if (q.error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="max-w-md rounded-lg border border-danger bg-surface p-6 text-sm">
          <p className="font-medium text-danger">Could not load supported chains.</p>
          <p className="mt-2 text-ink-muted">{(q.error as Error).message}</p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-4 h-10 rounded-md border border-border-control px-4 text-ink hover:border-action-text"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!q.data || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-ink-muted">
        <p aria-live="polite">Loading...</p>
      </div>
    );
  }
  return (
    <ChainsContext.Provider value={q.data}>
      <WagmiProvider config={config}>{children}</WagmiProvider>
    </ChainsContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ChainsGate>{children}</ChainsGate>
    </QueryClientProvider>
  );
}
