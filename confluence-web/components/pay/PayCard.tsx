"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBalance, useConnection, useSwitchChain } from "wagmi";
import { fetchPaymentRequest, postQuote, quoteErrorText, type Quote } from "@/lib/api";
import { shortAddress, type BridgeChain } from "@/lib/chains";
import { useBridgeChains } from "@/components/Providers";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { ChainPicker } from "@/components/bridge/ChainPicker";
import { ChainDot } from "@/components/bridge/ChainDot";
import { GasWarning } from "@/components/bridge/GasWarning";
import { ReviewPanel, fmtUsdc } from "@/components/bridge/ReviewPanel";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { useBridgeExecution } from "@/hooks/useBridgeExecution";

const QUOTE_REFRESH_MS = 45_000;

function Card({ children }: { children: React.ReactNode }) {
  return <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6">{children}</section>;
}

/**
 * Stage 8b: pay a payment request. The API fills in the destination, the payee and the
 * amount (sized so the payee receives the full request); the payer only picks where the
 * USDC comes from. Signing reuses the Bridge's Review screen and execution.
 */
export function PayCard({ id }: { id: string }) {
  const { chains } = useBridgeChains();
  const { address, chainId, status, connector } = useConnection();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [frozenQuote, setFrozenQuote] = useState<Quote | null>(null);
  const exec = useBridgeExecution();
  const usedQuoteIds = useRef(new Set<string>());

  const reqQ = useQuery({
    queryKey: ["payment-request", id],
    queryFn: () => fetchPaymentRequest(id),
    refetchInterval: (q) => (q.state.data?.status === "open" ? 15_000 : false),
  });
  const r = reqQ.data ?? undefined;
  const to = chains.find((c) => c.id === r?.destinationChain);
  const walletChain = chains.find((c) => c.evmChainId === chainId);
  // Default source: the wallet's chain, unless it is the destination.
  const from: BridgeChain | undefined =
    chains.find((c) => c.id === fromId) ?? (walletChain && walletChain.id !== to?.id ? walletChain : chains.find((c) => c.id !== to?.id));
  const isPayee = !!address && !!r && address.toLowerCase() === r.payee.toLowerCase();
  const payable = r?.status === "open" && !isPayee;

  const speed: "FAST" | "SLOW" = from?.speed?.fast ? "FAST" : "SLOW";
  const useForwarder = !!to?.forwarderAsDestination;
  const execPhase = exec.state.phase;

  const quoteQ = useQuery({
    queryKey: ["pay-quote", id, from?.id, address, speed, useForwarder],
    queryFn: () => postQuote({ requestId: id, sourceChain: from!.id, sender: address!, speed, useForwarder }),
    enabled: payable && !!from && !!to && !!address && from.id !== to.id && execPhase === "idle",
    refetchInterval: QUOTE_REFRESH_MS,
    retry: false,
  });
  const quote = quoteQ.data;

  const balance = useUsdcBalance(from, address);
  const balanceBase = balance.data as bigint | undefined;
  const insufficient = !!quote && balanceBase !== undefined && BigInt(quote.totalDebit.base) > balanceBase;
  const sourceGas = useBalance({ address, chainId: from?.evmChainId, query: { enabled: !!address && !!from } });

  const execTransfer = exec.state.transfer;
  useEffect(() => {
    if (execTransfer) usedQuoteIds.current.add(execTransfer.quoteId);
  }, [execTransfer]);
  // The "paid" status appears once the mint report reaches the API (the browser reports
  // it a moment after the success screen), so check again shortly after success.
  const refetchRequest = reqQ.refetch;
  useEffect(() => {
    if (execPhase !== "success") return;
    void refetchRequest();
    const t1 = setTimeout(() => void refetchRequest(), 2_500);
    const t2 = setTimeout(() => void refetchRequest(), 7_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [execPhase, refetchRequest]);

  const getQuote = useCallback(
    async ({ fresh }: { fresh: boolean }): Promise<Quote> => {
      const current = quoteQ.data;
      const usable = current && !usedQuoteIds.current.has(current.id) && new Date(current.expiresAt).getTime() - Date.now() > 15_000;
      let q = current;
      if (fresh || !usable) {
        const res = await quoteQ.refetch();
        if (res.error) throw res.error;
        q = res.data;
      }
      if (!q) throw new Error("no quote available");
      setFrozenQuote(q);
      return q;
    },
    [quoteQ],
  );

  if (reqQ.isPending) return <Card><p className="text-sm text-ink-muted">Loading payment request...</p></Card>;
  if (!r) {
    return (
      <Card>
        <h1 className="text-[22px] font-medium">Payment request not found</h1>
        <p className="text-sm text-ink-muted">Check the link, or ask the sender for a new one.</p>
      </Card>
    );
  }
  const payeeLabel = r.payeeId ? `@${r.payeeId}` : shortAddress(r.payee);

  // ---------- review and signing (same screen as the Bridge) ----------
  const reviewQuote = execPhase === "idle" ? quote : (frozenQuote ?? quote);
  if (reviewing && reviewQuote && from && to && address) {
    return (
      <Card>
        <ReviewPanel
          quote={reviewQuote}
          from={from}
          to={to}
          sender={address}
          exec={exec.state}
          onSourceChain={chainId === from.evmChainId}
          switching={switching}
          onSwitch={() => switchChain({ chainId: from.evmChainId })}
          destinationGas={undefined}
          recipientLabel={payeeLabel}
          sourceGasWarning={execPhase === "idle" ? <GasWarning chain={from} balanceWei={sourceGas.data?.value} /> : null}
          onBack={() => !exec.busy && setReviewing(false)}
          onConfirm={() =>
            connector &&
            void exec.start({ getQuote, sender: address, from, to, registry: chains, getProvider: () => connector.getProvider() })
          }
          onRetry={() => void exec.retry()}
          onDone={() => {
            if (exec.busy) return;
            exec.reset();
            setFrozenQuote(null);
            setReviewing(false);
          }}
        />
      </Card>
    );
  }

  // ---------- the request ----------
  let action: { label: string; onClick?: () => void; disabled?: boolean } | null = null;
  if (payable) {
    if (status !== "connected") action = { label: "Connect wallet to pay", onClick: () => setConnectOpen(true) };
    else if (!from || !to) action = { label: "Loading...", disabled: true };
    else if (chainId !== from.evmChainId)
      action = { label: switching ? "Switching..." : `Switch to ${from.name}`, onClick: () => switchChain({ chainId: from.evmChainId }), disabled: switching };
    else if (quoteQ.isError) action = { label: "No quote", disabled: true };
    else if (!quote) action = { label: "Getting quote...", disabled: true };
    else if (insufficient) action = { label: "Insufficient USDC", disabled: true };
    else action = { label: `Pay ${fmtUsdc(r.amount.usdc)} USDC`, onClick: () => setReviewing(true) };
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">Payment request</span>
        <StatusChip status={r.status} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink-muted">{payeeLabel} requests</span>
        <span className="tnum text-[40px] leading-[46px] font-medium">
          {fmtUsdc(r.amount.usdc)} <span className="text-lg text-ink-muted">USDC</span>
        </span>
        <span className="flex items-center gap-2 text-sm">
          on {to && <ChainDot name={to.name} side="destination" />}
          <span className="text-destination-text">{to?.name ?? r.destinationChain}</span>
        </span>
        {r.memo && <p className="mt-2 rounded-md border border-border bg-bg p-3 text-sm">“{r.memo}”</p>}
      </div>

      {r.status === "paid" && (
        <div role="status" className="rounded-md border border-destination bg-bg p-3 text-[13px]">
          Paid {r.paidAt ? new Date(r.paidAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}.{" "}
          {r.paidTransferId && (
            <Link href={`/tx/${r.paidTransferId}`} className="text-action-text">
              View payment
            </Link>
          )}
        </div>
      )}
      {r.status === "expired" && (
        <div role="status" className="rounded-md border border-border-control bg-bg p-3 text-[13px]">
          This request expired on {new Date(r.expiresAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}. Ask {payeeLabel} for a new link.
        </div>
      )}
      {r.status === "cancelled" && (
        <div role="status" className="rounded-md border border-border-control bg-bg p-3 text-[13px]">
          {payeeLabel} cancelled this request.
        </div>
      )}
      {isPayee && r.status === "open" && (
        <div role="status" className="rounded-md border border-border-control bg-bg p-3 text-[13px]">
          This is your own request. Share this page&apos;s link with the person who should pay.
        </div>
      )}
      {payable && r.paymentInProgress && (
        <div role="status" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
          A payment for this request is already on its way. Paying again would send {payeeLabel} a second payment.
        </div>
      )}

      {payable && status === "connected" && from && to && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-muted">Pay from</span>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center justify-between rounded-md border border-border-control bg-bg px-3 py-2.5 text-left hover:border-action-text"
            >
              <span className="flex items-center gap-2">
                <ChainDot name={from.name} side="source" />
                <span className="font-medium text-source-text">{from.name}</span>
              </span>
              <span className="tnum font-mono text-xs text-ink-muted">
                {balanceBase !== undefined ? `Balance ${fmtUsdc((Number(balanceBase) / 1e6).toString())}` : "Balance ..."}
              </span>
            </button>
          </div>
          {quote && (
            <dl className="flex flex-col gap-2 text-sm">
              <Row label={`${payeeLabel} receives (est.)`} value={`${fmtUsdc(quote.expectedReceive.usdc)} USDC`} />
              <Row label="Circle fees you cover (est.)" value={`${fmtUsdc((Number(quote.amount.base) - Number(quote.expectedReceive.base)) / 1e6 + "")} USDC`} />
              <Row label="Confluence fee" value={`${quote.platformFee.usdc} USDC`} />
              <Row label="You pay" value={`${fmtUsdc(quote.totalDebit.usdc)} USDC`} strong />
            </dl>
          )}
          {quoteQ.isError && (
            <p role="alert" className="text-[13px] text-danger">
              {quoteErrorText(quoteQ.error)}
            </p>
          )}
          <GasWarning chain={from} balanceWei={chainId === from.evmChainId ? sourceGas.data?.value : undefined} />
        </>
      )}

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="h-13 w-full rounded-md bg-action text-[15px] font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
        >
          {action.label}
        </button>
      )}
      <p className="text-xs text-ink-muted">
        Expires {new Date(r.expiresAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}. Paid through Circle CCTP; the amount is
        sized so {payeeLabel} receives the full request.
      </p>

      <ChainPicker
        open={pickerOpen}
        title="Pay from"
        side="source"
        chains={chains}
        selectedId={from?.id}
        disabledId={to?.id}
        onSelect={(c) => {
          setFromId(c.id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
      <ConnectModal open={connectOpen} onClose={closeConnect} />
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? "font-medium" : "text-ink-muted"}>{label}</dt>
      <dd className={`tnum text-right font-mono text-[13px] ${strong ? "font-medium" : ""}`}>{value}</dd>
    </div>
  );
}

export function StatusChip({ status }: { status: "open" | "paid" | "expired" | "cancelled" }) {
  const cls =
    status === "paid"
      ? "border-destination text-destination-text"
      : status === "open"
        ? "border-action text-action-text"
        : "border-border-control text-ink-muted";
  const label = status === "open" ? "Open" : status === "paid" ? "Paid" : status === "expired" ? "Expired" : "Cancelled";
  return <span className={`rounded-[4px] border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
