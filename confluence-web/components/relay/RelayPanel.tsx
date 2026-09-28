"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useConnection } from "wagmi";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { useDebounced } from "@/hooks/useDebounced";
import { useRelayBalance } from "@/hooks/useRelayBalance";
import { cleanAmount } from "@/lib/swapKit";
import {
  DEAD_ADDRESS,
  fetchRelayChains,
  isNative,
  postRelayQuote,
  RELAY_EXECUTION_READY,
  relayQuoteErrorText,
  sameToken,
  usdAbs,
  type RelayChain,
  type RelayToken,
} from "@/lib/relay";
import { RelayTokenPicker } from "./RelayTokenPicker";
import { TokenIcon } from "./TokenIcon";

const AMOUNT_INPUT = /^\d{0,18}(\.\d{0,18})?$/;

function fmt(v: string | undefined, max = 6): string {
  if (!v) return "0";
  const [w = "0", f = ""] = v.split(".");
  const t = f.slice(0, max).replace(/0+$/, "");
  return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${t ? `.${t}` : ""}`;
}

function eta(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s`;
  return `~${Math.round(seconds / 60)} min`;
}

/** Initial tokens from Relay's own chain data: no hard-coded token list. */
export function defaults(chains: RelayChain[], preset: "bridge" | "swap", walletChainId: number | undefined): { from: RelayToken; to: RelayToken | null } | null {
  const first = chains.find((c) => c.id === walletChainId) ?? chains[0];
  if (!first) return null;
  if (preset === "swap") {
    const to = first.featured.find((t) => !sameToken(t, first.native)) ?? null;
    return { from: first.native, to };
  }
  const from = first.featured[0] ?? first.native;
  const other = chains.find((c) => c.id !== first.id);
  if (!other) return { from, to: null };
  const to = other.featured.find((t) => t.symbol === from.symbol) ?? other.featured[0] ?? other.native;
  return { from, to };
}

/**
 * The Relay panel (R2): one relay.link-style interface for bridging and swapping. Pick a
 * token on the same chain to swap, or on another chain to bridge. Quotes come from Relay
 * through our proxy, which attaches Confluence's app fee. (confluence:relay-panel)
 */
export function RelayPanel({ preset, appFeeBps }: { preset: "bridge" | "swap"; appFeeBps: number }) {
  const { address, chainId: walletChainId, status } = useConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);

  const chainsQ = useQuery({ queryKey: ["relay-chains"], queryFn: ({ signal }) => fetchRelayChains(signal), staleTime: 60 * 60_000, retry: 2 });
  const chains = useMemo(() => chainsQ.data ?? [], [chainsQ.data]);
  const [from, setFrom] = useState<RelayToken | null>(null);
  const [to, setTo] = useState<RelayToken | null>(null);
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (from || !chainsQ.data) return;
    const d = defaults(chainsQ.data, preset, walletChainId);
    if (d) {
      setFrom(d.from);
      setTo(d.to);
    }
  }, [chainsQ.data, preset, walletChainId, from]);

  const fromChain = chains.find((c) => c.id === from?.chainId);
  const toChain = chains.find((c) => c.id === to?.chainId);
  const mode: "bridge" | "swap" = from && to && from.chainId !== to.chainId ? "bridge" : "swap";

  const balanceQ = useRelayBalance(fromChain, from, address);
  const balanceBase = balanceQ.data;
  const balance = from && balanceBase !== undefined ? formatUnits(balanceBase, from.decimals) : undefined;

  const cleaned = from ? cleanAmount(amount, from.decimals) : null;
  const debounced = useDebounced(cleaned, 500);
  const amountBase = from && debounced ? parseUnits(debounced, from.decimals) : null;
  const insufficient = !!cleaned && !!from && balanceBase !== undefined && parseUnits(cleaned, from.decimals) > balanceBase;
  const samePair = sameToken(from, to);

  const quoteQ = useQuery({
    queryKey: ["relay-quote", from?.chainId, from?.address, to?.chainId, to?.address, amountBase?.toString(), address ?? null],
    queryFn: ({ signal }) =>
      postRelayQuote(
        {
          user: address ?? DEAD_ADDRESS,
          recipient: address ?? DEAD_ADDRESS,
          originChainId: from!.chainId,
          destinationChainId: to!.chainId,
          originCurrency: from!.address,
          destinationCurrency: to!.address,
          amount: amountBase!.toString(),
          tradeType: "EXACT_INPUT",
        },
        signal,
      ),
    enabled: !!from && !!to && !samePair && !!amountBase && amountBase > 0n && !insufficient,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });
  const quote = quoteQ.data?.details;
  const stale = !!quoteQ.data && debounced !== cleaned;
  const outFormatted = quote?.currencyOut?.amountFormatted ?? undefined;
  const minOut = quote?.currencyOut?.minimumAmount && to ? formatUnits(BigInt(quote.currencyOut.minimumAmount), to.decimals) : undefined;
  const fees = quote?.expandedPriceImpact;

  function flip() {
    setFrom(to);
    setTo(from);
    setAmount("");
  }
  function onMax() {
    if (balance && from && !isNative(from)) setAmount(balance); // never max out native gas
  }
  function choose(t: RelayToken) {
    if (picker === "from") {
      if (sameToken(t, to)) setTo(from);
      setFrom(t);
      setAmount("");
    } else if (picker === "to") {
      if (sameToken(t, from)) setFrom(to);
      setTo(t);
    }
    setPicker(null);
  }

  let action: { label: string; onClick?: () => void; disabled?: boolean };
  if (!from || !to) action = { label: chainsQ.isError ? "Relay unavailable" : "Loading...", disabled: true };
  else if (samePair) action = { label: "Choose two different tokens", disabled: true };
  else if (!cleaned) action = { label: "Enter an amount", disabled: true };
  else if (status === "connected" && insufficient) action = { label: `Insufficient ${from.symbol}`, disabled: true };
  else if (quoteQ.isFetching && !quoteQ.data) action = { label: "Getting quote...", disabled: true };
  else if (quoteQ.isError) action = { label: "No quote", disabled: true };
  else if (status !== "connected") action = { label: "Connect wallet", onClick: () => setConnectOpen(true) };
  else if (!quote || stale) action = { label: "Getting quote...", disabled: true };
  else if (!RELAY_EXECUTION_READY) action = { label: `Review ${mode} (coming in the next update)`, disabled: true };
  else action = { label: `Review ${mode}`, disabled: true };

  return (
    <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="relay-title">
      <div className="flex items-center justify-between">
        <h1 id="relay-title" className="text-[22px] font-medium">
          {mode === "bridge" ? "Bridge" : "Swap"}
        </h1>
        <span className="font-mono text-xs text-ink-muted">Powered by Relay</span>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-4">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>You pay</span>
          <span className="tnum font-mono">{balance !== undefined ? `Balance ${fmt(balance)}` : address && balanceQ.isFetching ? "Balance ..." : ""}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            aria-label={`Amount of ${from?.symbol ?? "token"} to send`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, "");
              if (AMOUNT_INPUT.test(v)) setAmount(v);
            }}
            className="tnum min-w-0 flex-1 bg-transparent text-[22px] font-medium outline-none"
          />
          {from && !isNative(from) && balance !== undefined && (
            <button type="button" onClick={onMax} className="rounded-[4px] border border-border-control px-2 py-0.5 text-xs font-medium text-action-text">
              Max
            </button>
          )}
          <TokenButton token={from} chain={fromChain} onClick={() => setPicker("from")} label="Choose token to pay" />
        </div>
      </div>

      <button type="button" onClick={flip} aria-label="Switch direction" className="-my-3 self-center rounded-md border border-border-control bg-surface px-3 py-1 text-sm">
        ⇅
      </button>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-4">
        <span className="text-xs text-ink-muted">You receive (estimated)</span>
        <div className="flex items-center gap-3">
          <span className={`tnum min-w-0 flex-1 truncate text-[22px] font-medium ${quote && !stale ? "text-destination-text" : "text-ink-muted"}`}>
            {quote && !stale ? fmt(outFormatted) : quoteQ.isFetching ? "..." : "0.00"}
          </span>
          <TokenButton token={to} chain={toChain} onClick={() => setPicker("to")} label="Choose token to receive" />
        </div>
      </div>

      {quote && !stale && from && to && (
        <dl className="flex flex-col gap-2 text-sm">
          {quote.rate && <Row label="Rate" value={`1 ${from.symbol} ≈ ${fmt(quote.rate)} ${to.symbol}`} />}
          {minOut && <Row label="Minimum received" value={`${fmt(minOut)} ${to.symbol}`} />}
          {eta(quote.timeEstimate) && <Row label="Estimated time" value={eta(quote.timeEstimate)!} />}
          <Row label="Execution cost" value={usdAbs(fees?.execution?.usd ?? undefined) ?? "-"} />
          <Row label="Swap cost" value={usdAbs(fees?.swap?.usd ?? undefined) ?? "-"} />
          <Row label="Relay platform fee" value={usdAbs(fees?.relay?.usd ?? undefined) ?? "-"} />
          <Row label={`Confluence fee (${appFeeBps / 100}%)`} value={appFeeBps > 0 ? (usdAbs(fees?.app?.usd ?? undefined) ?? "-") : "None"} />
        </dl>
      )}

      {mode === "bridge" && fromChain && toChain && (
        <p className="text-xs text-ink-muted">
          Bridge: you sign on {fromChain.name}; {to?.symbol} arrives in your wallet on {toChain.name}.
        </p>
      )}
      {!address && cleaned && quote && (
        <p className="text-xs text-ink-muted">Showing a sample quote. Connect your wallet for your exact quote and balance.</p>
      )}
      {quoteQ.isError && cleaned && !insufficient && (
        <div role="alert" className="rounded-md border border-danger bg-bg p-3 text-[13px]">
          {relayQuoteErrorText(quoteQ.error).slice(0, 200)}
        </div>
      )}
      {chainsQ.isError && (
        <div role="alert" className="rounded-md border border-danger bg-bg p-3 text-[13px]">
          Could not load Relay chains. Try again in a moment.
        </div>
      )}

      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        className="h-13 w-full rounded-md bg-action text-[15px] font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
      >
        {action.label}
      </button>

      <RelayTokenPicker
        open={picker !== null}
        title={picker === "from" ? "Pay with" : "Receive"}
        chains={chains}
        initialChainId={(picker === "from" ? from : to)?.chainId ?? from?.chainId}
        selected={picker === "from" ? from : to}
        onSelect={choose}
        onClose={closePicker}
      />
      <ConnectModal open={connectOpen} onClose={closeConnect} />
    </section>
  );
}

function TokenButton({ token, chain, onClick, label }: { token: RelayToken | null; chain: RelayChain | undefined; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 shrink-0 items-center gap-2 rounded-md border border-border-control bg-surface px-2.5 text-left hover:border-action-text"
    >
      {token ? (
        <>
          <TokenIcon src={token.logoURI} label={token.symbol} size={24} />
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-medium">{token.symbol}</span>
            <span className="max-w-[96px] truncate text-[11px] text-ink-muted">{chain?.name ?? ""}</span>
          </span>
        </>
      ) : (
        <span className="px-1 text-sm font-medium">Select</span>
      )}
      <span aria-hidden="true" className="text-xs text-ink-muted">
        ▾
      </span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tnum text-right font-mono text-[13px]">{value}</dd>
    </div>
  );
}
