"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useConnection, useSwitchChain } from "wagmi";
import { useBridgeChains } from "@/components/Providers";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { useDebounced } from "@/hooks/useDebounced";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { fetchMaxAmount, postQuote, quoteErrorText, type Quote } from "@/lib/api";
import type { BridgeChain } from "@/lib/chains";
import { ChainDot } from "./ChainDot";
import { ChainPicker } from "./ChainPicker";

const AMOUNT_INPUT = /^(\d{0,12})(\.\d{0,6})?$/;
const isArc = (c: BridgeChain) => c.id === "Arc" || c.id === "Arc_Testnet";
const isEthereum = (c: BridgeChain) => c.id === "Ethereum" || c.id === "Ethereum_Sepolia";

function fmt(usdc: string): string {
  const [w = "0", f] = usdc.split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${grouped}.${f}` : grouped;
}

function Row({ label, value, strong, tone, top }: { label: string; value: string; strong?: boolean; tone?: "destination"; top?: boolean }) {
  const color = tone === "destination" ? "text-destination-text" : strong ? "text-ink" : "text-ink-muted";
  return (
    <div className={`flex justify-between gap-3 ${top ? "border-t border-border pt-2.5" : ""}`}>
      <span className={`text-sm ${color} ${strong ? "font-medium" : ""}`}>{label}</span>
      <span className={`tnum font-mono text-sm ${tone === "destination" ? "text-destination-text" : "text-ink"} ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}

function Toggle({ label, sub, on, locked, onChange }: { label: string; sub: string; on: boolean; locked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={locked}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 py-1 text-left disabled:cursor-not-allowed"
    >
      <span className="flex flex-col gap-0.5">
        <span className={`text-sm font-medium ${locked ? "text-ink-muted" : ""}`}>{label}</span>
        <span className="text-xs text-ink-muted">{sub}</span>
      </span>
      <span
        className={`flex h-[22px] w-10 shrink-0 items-center rounded-sm border p-0.5 ${on ? "justify-end border-action bg-action" : "justify-start border-border-control bg-surface-raised"}`}
      >
        <span className={`h-4 w-4 rounded-[3px] ${on ? "bg-on-action" : "bg-ink-muted"}`} />
      </span>
    </button>
  );
}

export function BridgeCard() {
  const { chains, byEvmId } = useBridgeChains();
  const { address, chainId, status } = useConnection();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();

  const arc = useMemo(() => chains.find(isArc), [chains]);
  const eth = useMemo(() => chains.find(isEthereum) ?? chains.find((c) => !isArc(c)), [chains]);

  const [fromId, setFromId] = useState<string | undefined>(eth?.id);
  const [toId, setToId] = useState<string | undefined>(arc?.id);
  const [routeTouched, setRouteTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [speed, setSpeed] = useState<"FAST" | "SLOW">("FAST");
  const [useForwarder, setUseForwarder] = useState(true);
  const [recipientOn, setRecipientOn] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<null | "from" | "to">(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const closePicker = useCallback(() => setPicker(null), []);

  const from = fromId ? chains.find((c) => c.id === fromId) : undefined;
  const to = toId ? chains.find((c) => c.id === toId) : undefined;
  const walletChain = chainId ? byEvmId.get(chainId) : undefined;

  // Default route: From = wallet's chain, To = Arc (inbound). If the wallet is on Arc,
  // go Arc -> Ethereum instead. Applied until the user picks a route themselves.
  useEffect(() => {
    if (routeTouched || !walletChain || !arc) return;
    if (isArc(walletChain)) {
      setFromId(walletChain.id);
      setToId(eth?.id);
    } else {
      setFromId(walletChain.id);
      setToId(arc.id);
    }
  }, [walletChain, arc, eth, routeTouched]);

  // Keep speed and forwarding valid for the chosen chains.
  const fastAvailable = !!from?.speed?.fast;
  const forwardingAvailable = !!to?.forwarderAsDestination;
  useEffect(() => {
    if (!fastAvailable && speed === "FAST") setSpeed("SLOW");
  }, [fastAvailable, speed]);
  useEffect(() => {
    if (!forwardingAvailable && useForwarder) setUseForwarder(false);
  }, [forwardingAvailable, useForwarder]);

  const balance = useUsdcBalance(from, address);
  const balanceBase = balance.data;

  const recipientValid = !recipientOn || isAddress(recipient);
  const amountBase = (() => {
    try {
      return amount && Number(amount) > 0 ? parseUnits(amount, 6) : 0n;
    } catch {
      return 0n;
    }
  })();

  const req = useDebounced(
    useMemo(
      () =>
        from && to && address && amountBase > 0n && recipientValid
          ? {
              sourceChain: from.id,
              destinationChain: to.id,
              amount,
              sender: address,
              ...(recipientOn ? { recipient } : {}),
              speed: fastAvailable ? speed : ("SLOW" as const),
              useForwarder: forwardingAvailable && useForwarder,
            }
          : null,
      [from, to, address, amountBase, amount, recipientValid, recipientOn, recipient, speed, fastAvailable, forwardingAvailable, useForwarder],
    ),
  );

  const quoteQ = useQuery({
    queryKey: ["quote", req],
    queryFn: ({ signal }) => postQuote(req!, signal),
    enabled: !!req,
    retry: false,
    refetchInterval: 45_000, // quotes live 60s; refresh before expiry
    placeholderData: (prev) => prev,
  });
  const quote: Quote | undefined = req ? quoteQ.data : undefined;
  const updating = !!req && (quoteQ.isFetching || quoteQ.isPlaceholderData);

  const insufficient = quote && balanceBase !== undefined && BigInt(quote.totalDebit.base) > balanceBase;
  const longWait = !fastAvailable || speed === "SLOW" ? (from?.speed?.standard?.maxSeconds ?? 0) > 3600 : false;

  async function onMax() {
    if (balanceBase === undefined) return;
    try {
      setAmount(await fetchMaxAmount(balanceBase));
    } catch {
      // keep the current amount; the balance line still shows the full balance
    }
  }

  function pick(c: BridgeChain) {
    setRouteTouched(true);
    if (picker === "from") {
      if (c.id === toId) setToId(fromId);
      setFromId(c.id);
    } else {
      if (c.id === fromId) setFromId(toId);
      setToId(c.id);
    }
    setPicker(null);
  }

  function flip() {
    setRouteTouched(true);
    setFromId(toId);
    setToId(fromId);
  }

  // Primary action
  let action: { label: string; onClick?: () => void; disabled?: boolean };
  if (status !== "connected") action = { label: "Connect wallet", onClick: () => setConnectOpen(true) };
  else if (from && chainId !== from.evmChainId)
    action = { label: switching ? "Switching..." : `Switch to ${from.name}`, onClick: () => switchChain({ chainId: from.evmChainId }), disabled: switching };
  else if (!amountBase) action = { label: "Enter an amount", disabled: true };
  else if (!recipientValid) action = { label: "Enter a valid recipient", disabled: true };
  else if (insufficient) action = { label: "Insufficient USDC", disabled: true };
  else action = { label: "Review bridge", disabled: true }; // Review and signing: Stage 2d

  const chainCard = (label: string, c: BridgeChain | undefined, side: "source" | "destination", onClick: () => void, sub?: string) => (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5 rounded-md border border-border-control bg-bg p-3 text-left hover:border-action-text"
    >
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {c ? <ChainDot name={c.name} side={side} /> : null}
        <span className={`truncate text-base font-medium ${side === "source" ? "text-source-text" : "text-destination-text"}`}>{c?.name ?? "Select"}</span>
      </span>
      {sub ? <span className="tnum truncate font-mono text-xs text-ink-muted">{sub}</span> : null}
    </button>
  );

  const balanceText =
    status !== "connected" ? "Connect to see balance" : balance.isLoading ? "Balance ..." : balanceBase !== undefined ? `Balance ${fmt(formatUnits(balanceBase, 6))}` : "Balance unavailable";

  return (
    <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="bridge-title">
      <div className="flex items-center justify-between">
        <h1 id="bridge-title" className="text-[22px] font-medium">
          Bridge USDC
        </h1>
        <span className="font-mono text-xs text-ink-muted">Powered by Circle CCTP</span>
      </div>

      <div className="flex items-stretch gap-2">
        {chainCard("From", from, "source", () => setPicker("from"), balanceText)}
        <button
          type="button"
          onClick={flip}
          aria-label="Swap direction"
          className="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-md border border-border-control bg-surface-raised hover:border-action-text"
        >
          ⇅
        </button>
        {chainCard("To", to, "destination", () => setPicker("to"), to ? (to.forwarderAsDestination ? "Forwarding available" : "No forwarding") : undefined)}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="amount" className="text-[13px] font-medium text-ink-muted">
          Amount
        </label>
        <div
          className={`flex h-13 items-center gap-2 rounded-md border bg-bg px-3 ${insufficient ? "border-danger" : "border-border-control focus-within:border-action-text"}`}
        >
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, "");
              if (AMOUNT_INPUT.test(v)) setAmount(v);
            }}
            aria-invalid={!!insufficient}
            aria-describedby={insufficient ? "amount-error" : undefined}
            className="tnum min-w-0 flex-1 bg-transparent text-[22px] font-medium outline-none"
          />
          <span className="text-sm text-ink-muted">USDC</span>
          <button
            type="button"
            onClick={() => void onMax()}
            disabled={balanceBase === undefined}
            className="h-7 rounded-sm border border-border-control px-2.5 text-xs font-medium text-action-text disabled:opacity-40"
          >
            Max
          </button>
        </div>
        {insufficient && quote && balanceBase !== undefined && (
          <span id="amount-error" className="text-[13px] text-danger">
            You need {fmt(quote.totalDebit.usdc)} USDC including the {quote.platformFee.usdc} platform fee. Balance on {from?.name} is{" "}
            {fmt(formatUnits(balanceBase, 6))}.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5" aria-live="polite">
        <span className="text-[13px] text-ink-muted">You receive on {to?.name ?? "destination"}</span>
        <span className={`tnum text-[40px] leading-[46px] font-medium ${updating ? "opacity-60" : ""}`}>
          {quote ? fmt(quote.expectedReceive.usdc) : "0.00"} <span className="text-lg text-ink-muted">USDC</span>
        </span>
        {quoteQ.error && req ? (
          <span role="alert" className="text-[13px] text-danger">
            {quoteErrorText(quoteQ.error)}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        className="flex h-11 w-full items-center justify-between rounded-md border border-border px-3 text-ink-muted hover:border-border-control"
      >
        <span className="tnum font-mono text-[13px]">
          {quote ? `Fee ${quote.platformFee.usdc} USDC · ${quote.eta ?? ""}` : "Fees and settings"}
          {updating && quote ? " · updating" : ""}
        </span>
        <span className="flex items-center gap-2">
          {fastAvailable && speed === "FAST" ? (
            <span className="rounded-sm bg-destination px-2 py-0.5 font-mono text-xs text-on-signal">Fast</span>
          ) : (
            <span className="rounded-sm border border-border-control px-2 py-px font-mono text-xs">Standard</span>
          )}
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </span>
      </button>

      {longWait && (
        <div role="status" className="flex flex-col gap-1.5 rounded-md border border-warning bg-bg p-3 text-[13px]">
          <span>
            Standard transfers from {from?.name} take {from?.speed?.standard?.label} to attest.
            {fastAvailable ? ` Fast arrives in ${from?.speed?.fast?.label} for a small CCTP fee.` : ""}
          </span>
          {fastAvailable && (
            <button type="button" onClick={() => setSpeed("FAST")} className="self-start text-[13px] font-medium text-action-text">
              Switch to Fast
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-4">
          {quote ? (
            <div className="flex flex-col gap-2">
              <Row label="Bridge amount" value={fmt(quote.amount.usdc)} />
              <Row label="Platform fee" value={`+${quote.platformFee.usdc}`} />
              <Row label="Total debit" value={`${fmt(quote.totalDebit.usdc)} USDC`} strong top />
              <Row
                label={`CCTP fee (${quote.speed === "FAST" ? "Fast" : "Standard"})`}
                value={quote.cctpFee.base === "0" ? "Free" : `-${quote.cctpFee.usdc}`}
              />
              {quote.useForwarder && <Row label="Forwarding fee (est.)" value={quote.forwardingFee.base === "0" ? "Free" : `-${quote.forwardingFee.usdc}`} />}
              <Row label="Expected receive" value={`${fmt(quote.expectedReceive.usdc)} USDC`} strong tone="destination" top />
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Enter an amount to see the full fee breakdown.</p>
          )}
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-muted">Speed</span>
            <div className="flex gap-2">
              {(["FAST", "SLOW"] as const).map((s) => {
                const on = (fastAvailable ? speed : "SLOW") === s;
                const unavailable = s === "FAST" && !fastAvailable;
                const label = s === "FAST" ? "Fast" : "Standard";
                const sub =
                  s === "FAST"
                    ? unavailable
                      ? "Not available from this chain"
                      : `${from?.speed?.fast?.label ?? ""} · small fee`
                    : `${from?.speed?.standard?.label ?? ""} · free`;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    disabled={unavailable}
                    onClick={() => setSpeed(s)}
                    className={`flex h-13 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-md border disabled:opacity-50 ${
                      on ? "border-action bg-surface-raised" : "border-border-control"
                    }`}
                  >
                    <span className="text-sm font-medium">{label}</span>
                    <span className="font-mono text-xs text-ink-muted">{sub}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Toggle
            label="Forwarding"
            sub={
              forwardingAvailable
                ? `Circle submits the mint on ${to?.name}. No destination gas needed.`
                : `Not available to ${to?.name}. You will mint on the destination yourself.`
            }
            on={forwardingAvailable && useForwarder}
            locked={!forwardingAvailable}
            onChange={setUseForwarder}
          />
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-2">
            <Toggle
              label="Send to another address"
              sub={`Funds are minted to this address on ${to?.name ?? "the destination"}`}
              on={recipientOn}
              onChange={setRecipientOn}
            />
            {recipientOn && (
              <>
                <label htmlFor="recipient" className="text-[13px] font-medium text-ink-muted">
                  Recipient on {to?.name}
                </label>
                <input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={recipient.length > 0 && !isAddress(recipient)}
                  className={`h-11 rounded-md border bg-bg px-3 font-mono text-xs outline-none ${
                    recipient.length > 0 && !isAddress(recipient) ? "border-danger" : "border-border-control focus:border-action-text"
                  }`}
                />
                {recipient.length > 0 && (
                  <span className={`text-xs ${isAddress(recipient) ? "text-destination-text" : "text-danger"}`}>
                    {isAddress(recipient) ? "Valid address format" : "Not a valid EVM address"}
                  </span>
                )}
              </>
            )}
          </div>
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
      {action.label === "Review bridge" && <p className="-mt-3 text-center text-xs text-ink-muted">Review and signing arrive in the next part (2d).</p>}

      <ChainPicker
        open={picker !== null}
        title={picker === "from" ? "Select source chain" : "Select destination chain"}
        side={picker === "from" ? "source" : "destination"}
        chains={chains}
        selectedId={picker === "from" ? fromId : toId}
        disabledId={undefined}
        onSelect={pick}
        onClose={closePicker}
      />
      <ConnectModal open={connectOpen} onClose={closeConnect} />
    </section>
  );
}
