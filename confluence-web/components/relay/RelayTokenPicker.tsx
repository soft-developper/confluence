"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebounced } from "@/hooks/useDebounced";
import { searchRelayTokens, sameToken, type RelayChain, type RelayToken } from "@/lib/relay";
import { TokenIcon } from "./TokenIcon";

/**
 * Chain and token selector for the Relay panel, in the relay.link style: chains on the
 * left (a dropdown on phones), tokens for the selected chain on the right, with search.
 * Tokens come from Relay's curated list through our proxy; typing a contract address
 * looks that token up directly.
 */
export function RelayTokenPicker({
  open,
  title,
  chains,
  initialChainId,
  selected,
  lockChainId,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  chains: readonly RelayChain[];
  initialChainId: number | undefined;
  selected: RelayToken | null;
  /** Swap mode keeps both sides on the same chain. */
  lockChainId?: number;
  onSelect: (t: RelayToken) => void;
  onClose: () => void;
}) {
  const [chainId, setChainId] = useState<number | undefined>(initialChainId);
  const [chainQ, setChainQ] = useState("");
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const term = useDebounced(q, 400);

  useEffect(() => {
    if (!open) return;
    setChainId(lockChainId ?? initialChainId ?? chains[0]?.id);
    setQ("");
    setChainQ("");
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialChainId, lockChainId, chains, onClose]);

  const chain = chains.find((c) => c.id === chainId);
  const tokensQ = useQuery({
    queryKey: ["relay-tokens", chainId, term.trim().toLowerCase()],
    queryFn: ({ signal }) => searchRelayTokens(chainId!, term, signal),
    enabled: open && !!chainId,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  // The chain's native and featured tokens lead the default list, then Relay's list.
  const tokens = useMemo(() => {
    const fromApi = tokensQ.data ?? [];
    if (!chain || term.trim()) return fromApi;
    const lead = [chain.native, ...chain.featured];
    const merged: RelayToken[] = [];
    for (const t of [...lead, ...fromApi]) if (!merged.some((m) => sameToken(m, t))) merged.push(t);
    return merged;
  }, [tokensQ.data, chain, term]);

  const chainList = useMemo(() => {
    const s = chainQ.trim().toLowerCase();
    const list = lockChainId ? chains.filter((c) => c.id === lockChainId) : chains;
    return s ? list.filter((c) => c.name.toLowerCase().includes(s)) : list;
  }, [chains, chainQ, lockChainId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,9,16,0.74)] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="relay-picker-title"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[85vh] max-h-[640px] w-full max-w-[640px] flex-col rounded-t-lg border border-border bg-surface-raised p-5 sm:rounded-lg sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="relay-picker-title" className="text-xl font-medium">
              {title}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">Chains and tokens supported by Relay.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-control text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Phones: chain dropdown */}
        {!lockChainId && (
          <label className="mt-4 flex flex-col gap-1.5 text-[13px] font-medium text-ink-muted sm:hidden">
            Chain
            <select
              value={chainId ?? ""}
              onChange={(e) => setChainId(Number(e.target.value))}
              className="h-11 rounded-md border border-border-control bg-bg px-3 text-sm text-ink"
            >
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-4 flex min-h-0 flex-1 gap-4">
          {/* Wider screens: chain column */}
          {!lockChainId && (
            <div className="hidden w-48 shrink-0 flex-col sm:flex">
              <input
                aria-label="Search chains"
                value={chainQ}
                onChange={(e) => setChainQ(e.target.value)}
                placeholder="Search chains"
                className="h-10 rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text"
              />
              <ul className="mt-2 flex flex-col gap-1 overflow-y-auto pr-1">
                {chainList.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setChainId(c.id)}
                      aria-pressed={c.id === chainId}
                      className={`flex h-10 w-full items-center gap-2 rounded-md border px-2.5 text-left text-sm ${
                        c.id === chainId ? "border-action bg-bg font-medium" : "border-transparent hover:border-border-control"
                      }`}
                    >
                      <TokenIcon src={c.iconUrl} label={c.name} size={20} />
                      <span className="truncate">{c.name}</span>
                    </button>
                  </li>
                ))}
                {chainList.length === 0 && <li className="py-4 text-center text-xs text-ink-muted">No chains match.</li>}
              </ul>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <input
              ref={inputRef}
              aria-label={`Search tokens on ${chain?.name ?? "this chain"}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, symbol or paste an address"
              className="h-10 rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text"
            />
            <ul className="mt-2 flex flex-col gap-1 overflow-y-auto" aria-busy={tokensQ.isFetching}>
              {tokens.map((t) => {
                const isSel = sameToken(t, selected);
                return (
                  <li key={`${t.chainId}-${t.address}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(t)}
                      className={`flex h-13 w-full items-center gap-3 rounded-md border px-3 text-left ${
                        isSel ? "border-action bg-bg" : "border-border bg-surface hover:border-action-text"
                      }`}
                    >
                      <TokenIcon src={t.logoURI} label={t.symbol} size={28} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-medium">{t.symbol}</span>
                        <span className="truncate text-xs text-ink-muted">{t.name}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {tokensQ.isFetching && tokens.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">Loading tokens...</li>}
              {tokensQ.isError && <li className="py-6 text-center text-sm text-danger">Could not load tokens. Try again.</li>}
              {!tokensQ.isFetching && !tokensQ.isError && tokens.length === 0 && (
                <li className="py-6 text-center text-sm text-ink-muted">No tokens match &quot;{q}&quot;.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
