"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useBalance, useConnection, useSwitchChain } from "wagmi";
import { useBridgeChains } from "@/components/Providers";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { ChainDot } from "@/components/bridge/ChainDot";
import { ChainPicker } from "@/components/bridge/ChainPicker";
import { ReviewPanel } from "@/components/bridge/ReviewPanel";
import { GasWarning } from "@/components/bridge/GasWarning";
import { useBridgeExecution } from "@/hooks/useBridgeExecution";
import { useDebounced } from "@/hooks/useDebounced";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { useIdRecipient } from "@/hooks/useIdRecipient";
import { useArcPayment } from "@/hooks/useArcPayment";
import { addSavedId, fetchMaxAmount, fetchSavedIds, postQuote, quoteErrorText, SessionExpiredError, type Quote } from "@/lib/api";
import { shortAddress, type BridgeChain } from "@/lib/chains";
import { avatarFor, loadPaidIds, lookalikeId, previewFeeBase, recordPaidId } from "@/lib/pay";
import { clearSession, useSession } from "@/lib/session";

/**
 * Pay page, Send (confluence:arc-pay): pay anyone by Confluence ID. Money always lands on
 * Arc. From Arc: two USDC transfers, fee then payment. From any other chain: the Bridge's
 * own CCTP flow to the ID's wallet on Arc, with Forwarding always on so Circle mints for the
 * recipient (confluence:pay-cross-chain). The ID is checked live, the review shows the
 * server's own numbers. Warn-only safety checks: first payment to an ID, look-alike IDs.
 */

const AMOUNT_INPUT = /^(\d{0,12})(\.\d{0,6})?$/;
const NOTE_MAX = 140;
/** Left in the wallet by Max, for Arc gas (paid in USDC from the same balance). */
const GAS_RESERVE = 50_000n; // 0.05 USDC
const isArc = (c: BridgeChain) => c.id === "Arc" || c.id === "Arc_Testnet";

function fmt(usdc: string): string {
  const [w = "0", f] = usdc.split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${grouped}.${f}` : grouped;
}
const usdc = (base: bigint) => fmt(formatUnits(base, 6));

export function IdAvatar({ handle, size = 40 }: { handle: string; size?: number }) {
  const a = avatarFor(handle);
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, backgroundImage: `linear-gradient(${a.angle}deg, ${a.from}, ${a.to})` }}
    >
      {a.letter}
    </span>
  );
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-12 w-full rounded-md bg-action text-[15px] font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
    >
      {children}
    </button>
  );
}

function Secondary({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-11 w-full rounded-md border border-border-control text-sm font-medium hover:border-action-text disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
    >
      {children}
    </button>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={`text-sm ${strong ? "font-medium text-ink" : "text-ink-muted"}`}>{label}</span>
      <span className={`tnum font-mono text-sm ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}

function RecipientCard({ handle, address }: { handle: string; address: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-bg p-3">
      <IdAvatar handle={handle} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-medium">@{handle}</span>
        <span className="truncate font-mono text-xs text-ink-muted">{shortAddress(address)}</span>
      </div>
      <span className="ml-auto shrink-0 rounded-[4px] border border-destination px-1.5 py-0.5 font-mono text-[11px] text-destination-text">Claimed ID</span>
    </div>
  );
}

export function PayView() {
  const { chains, byEvmId } = useBridgeChains();
  const arc = useMemo(() => chains.find((c) => isArc(c) && c.bridgeEnabled), [chains]);
  const { address, chainId, status, connector } = useConnection();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const session = useSession(address);
  const qc = useQueryClient();

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const pay = useArcPayment();
  const phase = pay.state.phase;

  // From: the wallet's chain by default (until picked), Arc when the wallet is elsewhere.
  const pickable = useMemo(() => chains.filter((c) => c.bridgeEnabled), [chains]);
  const [fromId, setFromId] = useState<string | undefined>(undefined);
  const [fromTouched, setFromTouched] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const walletChain = chainId ? byEvmId.get(chainId) : undefined;
  useEffect(() => {
    if (fromTouched) return;
    setFromId(walletChain && walletChain.bridgeEnabled ? walletChain.id : arc?.id);
  }, [walletChain, arc, fromTouched]);
  const from = (fromId ? pickable.find((c) => c.id === fromId) : undefined) ?? arc;
  const crossChain = !!from && !!arc && from.id !== arc.id;

  // Cross-chain payments run the Bridge's own execution (confluence:pay-cross-chain).
  const exec = useBridgeExecution();
  const execPhase = exec.state.phase;
  const [reviewing, setReviewing] = useState(false);
  const [frozenQuote, setFrozenQuote] = useState<Quote | null>(null);
  const usedQuoteIds = useRef(new Set<string>());
  const [speed, setSpeed] = useState<"FAST" | "SLOW">("FAST");
  const fastAvailable = !!from?.speed?.fast;

  const text = to.trim() ? `@${to.trim().replace(/^@+/, "")}` : "";
  const id = useIdRecipient(text);
  const resolved = id.resolved;
  const isSelf = !!resolved && !!address && resolved.address.toLowerCase() === address.toLowerCase();

  // IDs this wallet knows: paid before (this browser) and saved (when signed in).
  const savedQ = useQuery({
    queryKey: ["saved-ids", address],
    queryFn: async () => {
      try {
        return await fetchSavedIds(session!.token);
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        throw e;
      }
    },
    enabled: !!session,
    retry: false,
  });
  const [paidIds, setPaidIds] = useState<string[]>([]);
  useEffect(() => setPaidIds(loadPaidIds(address)), [address, phase]);
  const known = useMemo(() => [...new Set([...paidIds, ...(savedQ.data ?? []).map((s) => s.handle)])], [paidIds, savedQ.data]);
  const lookalike = resolved && !isSelf ? lookalikeId(id.handle, known) : undefined;
  const firstTime = !!resolved && !isSelf && !known.includes(id.handle);

  const balance = useUsdcBalance(from, address);
  const balanceBase = balance.data;
  const amountBase = (() => {
    try {
      return amount && Number(amount) > 0 ? parseUnits(amount, 6) : 0n;
    } catch {
      return 0n;
    }
  })();

  // Cross-chain: a CCTP quote to the ID on Arc (the API resolves the ID again and keeps the note).
  const req = useDebounced(
    useMemo(
      () =>
        crossChain && from && arc && address && amountBase > 0n && resolved && !isSelf
          ? {
              sourceChain: from.id,
              destinationChain: arc.id,
              amount,
              sender: address,
              recipientId: id.handle,
              ...(note.trim() ? { note: note.trim() } : {}),
              speed: fastAvailable ? speed : ("SLOW" as const),
              useForwarder: true,
            }
          : null,
      [crossChain, from, arc, address, amountBase, resolved, isSelf, amount, id.handle, note, fastAvailable, speed],
    ),
  );
  const quoteQ = useQuery({
    queryKey: ["pay-quote", req],
    queryFn: ({ signal }) => postQuote(req!, signal),
    enabled: !!req && execPhase === "idle",
    retry: false,
    refetchInterval: 45_000, // quotes live 60s
    placeholderData: (prev) => prev,
  });
  const quote: Quote | undefined = req ? quoteQ.data : undefined;
  const quoting = !!req && (quoteQ.isFetching || quoteQ.isPlaceholderData);

  const feeBase = crossChain ? (quote ? BigInt(quote.platformFee.base) : previewFeeBase(amountBase)) : previewFeeBase(amountBase);
  const totalBase = crossChain && quote ? BigInt(quote.totalDebit.base) : amountBase + feeBase;
  const insufficient = amountBase > 0n && balanceBase !== undefined && totalBase > balanceBase;

  async function onMax() {
    if (balanceBase === undefined) return;
    if (crossChain) {
      try {
        setAmount(await fetchMaxAmount(balanceBase));
      } catch {
        // keep the current amount
      }
      return;
    }
    const room = balanceBase - GAS_RESERVE;
    if (room <= 300_000n) return setAmount("0");
    // Largest amount whose total (amount plus fee) fits: the total only grows with the amount.
    let lo = 0n;
    let hi = room;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (mid + previewFeeBase(mid) <= room) lo = mid;
      else hi = mid - 1n;
    }
    setAmount(formatUnits(lo, 6));
  }

  const refetchBalance = balance.refetch;
  useEffect(() => {
    if (phase === "success" || execPhase === "success") void refetchBalance();
  }, [phase, execPhase, refetchBalance]);
  // A cross-chain payment counts as "paid before" once its burn went through.
  const execTransfer = exec.state.transfer;
  useEffect(() => {
    if (execTransfer) usedQuoteIds.current.add(execTransfer.quoteId);
  }, [execTransfer]);
  useEffect(() => {
    if (execPhase === "success" && address && execTransfer?.recipientId) recordPaidId(address, execTransfer.recipientId);
  }, [execPhase, address, execTransfer]);

  const sourceGas = useBalance({ address, chainId: from?.evmChainId, query: { enabled: !!address && !!from && crossChain } });

  /** A quote not yet used for a transfer, with at least 15s left; refetched otherwise. */
  const getQuote = useCallback(
    async ({ fresh }: { fresh: boolean }): Promise<Quote> => {
      const current = quoteQ.data;
      const usable = current && !usedQuoteIds.current.has(current.id) && new Date(current.expiresAt).getTime() - Date.now() > 15_000;
      let q = current;
      if (fresh || !usable) {
        const r = await quoteQ.refetch();
        if (r.error) throw r.error;
        q = r.data;
      }
      if (!q) throw new Error("no quote available");
      setFrozenQuote(q);
      return q;
    },
    [quoteQ],
  );

  function leaveCrossReview() {
    if (exec.busy) return;
    const succeeded = execPhase === "success";
    exec.reset();
    setFrozenQuote(null);
    setReviewing(false);
    if (succeeded) {
      setAmount("");
      setNote("");
    }
  }

  // ---------- screens ----------

  if (!arc) {
    return (
      <section className="flex w-full max-w-[460px] flex-col gap-3 rounded-lg border border-border bg-surface p-5 sm:p-6">
        <h1 className="text-[22px] font-medium">Pay</h1>
        <p className="text-sm text-ink-muted">Payments on Arc are not available right now. Please try again later.</p>
      </section>
    );
  }

  const p = pay.state.payment;
  const explorer = (hash: string) => arc.explorerTxUrl.replace("{hash}", hash);

  const reviewQuote = execPhase === "idle" ? quote : (frozenQuote ?? quote);
  if (crossChain && reviewing && reviewQuote && from && address) {
    return (
      <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="bridge-title">
        <ReviewPanel
          quote={reviewQuote}
          from={from}
          to={arc}
          sender={address}
          exec={exec.state}
          onSourceChain={chainId === from.evmChainId}
          switching={switching}
          onSwitch={() => switchChain({ chainId: from.evmChainId })}
          destinationGas={undefined}
          recipientLabel={`@${reviewQuote.recipientId ?? id.handle}`}
          sourceGasWarning={execPhase === "idle" ? <GasWarning chain={from} balanceWei={sourceGas.data?.value} /> : null}
          onBack={leaveCrossReview}
          onConfirm={() => {
            if (!connector) return;
            void exec.start({ getQuote, sender: address, from, to: arc, registry: chains, getProvider: () => connector.getProvider() });
          }}
          onRetry={() => void exec.retry()}
          onDone={leaveCrossReview}
        />
      </section>
    );
  }

  if (phase !== "idle" && phase !== "creating" && p) {
    return (
      <ReviewAndProgress
        arc={arc}
        state={pay.state}
        explorer={explorer}
        onConfirm={() => void pay.start()}
        onRetryPayment={() => void pay.retryPayment()}
        onBack={() => {
          const done = phase === "success";
          pay.reset();
          if (done) {
            setAmount("");
            setNote("");
          }
        }}
        onSave={
          session && savedQ.data && !savedQ.data.some((s) => s.handle === p.recipientId)
            ? async () => {
                const ids = await addSavedId(session.token, p.recipientId);
                qc.setQueryData(["saved-ids", address], ids);
              }
            : undefined
        }
        saved={!!savedQ.data?.some((s) => s.handle === p.recipientId)}
      />
    );
  }

  const src = from ?? arc;
  let action: { label: string; onClick?: () => void; disabled?: boolean };
  if (status !== "connected" || !address) action = { label: "Connect wallet", onClick: () => setConnectOpen(true) };
  else if (chainId !== src.evmChainId)
    action = { label: switching ? "Switching..." : `Switch to ${src.name}`, onClick: () => switchChain({ chainId: src.evmChainId }), disabled: switching };
  else if (!text) action = { label: "Enter a Confluence ID", disabled: true };
  else if (!id.wellFormed) action = { label: "Check the ID", disabled: true };
  else if (id.loading) action = { label: `Finding @${id.handle}...`, disabled: true };
  else if (!resolved) action = { label: "Unknown Confluence ID", disabled: true };
  else if (isSelf) action = { label: "That's your own ID", disabled: true };
  else if (!amountBase) action = { label: "Enter an amount", disabled: true };
  else if (insufficient) action = { label: "Insufficient USDC", disabled: true };
  else if (crossChain && quoteQ.error) action = { label: "Can't quote this payment", disabled: true };
  else if (crossChain && !quote) action = { label: "Getting quote...", disabled: true };
  else if (crossChain)
    action = {
      label: "Review payment",
      onClick: () => {
        setFromTouched(true); // a wallet network change during review must not swap the source chain
        setReviewing(true);
      },
      disabled: !connector,
    };
  else if (phase === "creating") action = { label: "Preparing...", disabled: true };
  else
    action = {
      label: "Review payment",
      onClick: () =>
        void pay.prepare({ arc, sender: address, recipientId: id.handle, amount, note: note.trim() || undefined, getProvider: () => connector!.getProvider() }),
      disabled: !connector,
    };


  return (
    <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="pay-title">
      <div className="flex items-center justify-between">
        <h1 id="pay-title" className="text-[22px] font-medium">
          Pay
        </h1>
        <span className="font-mono text-xs text-ink-muted">By Confluence ID</span>
      </div>

      {/* To */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pay-to" className="text-[13px] font-medium text-ink-muted">
          To
        </label>
        <div className="flex h-12 items-center gap-1 rounded-md border border-border-control bg-bg px-3 focus-within:border-action-text">
          <span className="text-[17px] text-ink-muted" aria-hidden="true">
            @
          </span>
          <input
            id="pay-to"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name"
            maxLength={21}
            value={to}
            onChange={(e) => setTo(e.target.value.replace(/^@+/, "").replace(/\s/g, ""))}
            aria-describedby="pay-to-status"
            className="min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none"
          />
        </div>
        <div id="pay-to-status" aria-live="polite" className="min-h-5 text-[13px]">
          {!text ? (
            <span className="text-ink-muted">Enter the Confluence ID of the person you&rsquo;re paying.</span>
          ) : !id.wellFormed ? (
            <span className="text-ink-muted">IDs are 3 to 20 letters, digits or underscores.</span>
          ) : id.loading ? (
            <span className="text-ink-muted">Checking @{id.handle}...</span>
          ) : resolved === null ? (
            <span className="text-danger">No one has claimed @{id.handle}. Check the spelling with them.</span>
          ) : isSelf ? (
            <span className="text-warning">This is your own Confluence ID.</span>
          ) : null}
        </div>
        {resolved && !isSelf && <RecipientCard handle={id.handle} address={resolved.address} />}
        {savedQ.data && savedQ.data.length > 0 && !resolved && (
          <div className="flex flex-wrap gap-1.5" aria-label="Saved IDs">
            {savedQ.data.slice(0, 8).map((s) => (
              <button
                key={s.handle}
                type="button"
                onClick={() => setTo(s.handle)}
                className="flex h-8 items-center gap-1.5 rounded-full border border-border-control pr-3 pl-1 text-[13px] hover:border-action-text"
              >
                <IdAvatar handle={s.handle} size={24} />@{s.handle}
              </button>
            ))}
          </div>
        )}
      </div>

      {lookalike && (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger bg-bg p-3 text-[13px]">
          <span className="font-medium">@{id.handle} looks like @{lookalike}, but it is a different ID</span>
          <span className="text-ink-muted">You&rsquo;ve paid or saved @{lookalike} before. Scammers claim look-alike IDs. Make sure this is the right person.</span>
        </div>
      )}
      {!lookalike && firstTime && (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-warning bg-bg p-3 text-[13px]">
          <span className="font-medium">First payment to @{id.handle}</span>
          <span className="text-ink-muted">Confirm the ID with them before you send. Payments can&rsquo;t be reversed.</span>
        </div>
      )}

      {/* From */}
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center justify-between gap-3 rounded-md border border-border-control bg-bg px-3 py-2.5 text-left hover:border-action-text"
          aria-label={`Pay from ${src.name}. Change chain`}
        >
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="text-ink-muted">From</span>
            <ChainDot name={src.name} side="source" />
            <span className="truncate font-medium">{src.name}</span>
            <span className="text-ink-muted" aria-hidden="true">
              ▾
            </span>
          </span>
          <span className="tnum shrink-0 font-mono text-xs text-ink-muted">
            {balanceBase !== undefined ? `${usdc(balanceBase)} USDC` : address ? "..." : "Connect to see balance"}
          </span>
        </button>
        <span className="text-xs text-ink-muted">
          {crossChain
            ? `Arrives on ${arc.name} through Circle's CCTP. Circle mints it straight to the recipient.`
            : `Sent on ${arc.name}: two quick transfers, the fee and then the payment.`}
        </span>
      </div>

      {/* Amount */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pay-amount" className="text-[13px] font-medium text-ink-muted">
          Amount
        </label>
        <div className={`flex h-13 items-center gap-2 rounded-md border bg-bg px-3 ${insufficient ? "border-danger" : "border-border-control focus-within:border-action-text"}`}>
          <input
            id="pay-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, "");
              if (AMOUNT_INPUT.test(v)) setAmount(v);
            }}
            aria-invalid={insufficient}
            className="tnum min-w-0 flex-1 bg-transparent text-[22px] font-medium outline-none"
          />
          <span className="text-sm text-ink-muted">USDC</span>
          <button
            type="button"
            onClick={onMax}
            disabled={balanceBase === undefined}
            className="h-7 rounded-sm border border-border-control px-2.5 text-xs font-medium text-action-text disabled:opacity-40"
          >
            Max
          </button>
        </div>
        {insufficient && balanceBase !== undefined && (
          <span className="text-[13px] text-danger">
            You need {usdc(totalBase)} USDC including the fee. Your balance on {src.name} is {usdc(balanceBase)}.
          </span>
        )}
      </div>

      {/* Note */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="pay-note" className="text-[13px] font-medium text-ink-muted">
            Note <span className="font-normal">(optional, only you and the recipient see it)</span>
          </label>
          <span className="tnum shrink-0 font-mono text-[11px] text-ink-muted">
            {[...note].length}/{NOTE_MAX}
          </span>
        </div>
        <input
          id="pay-note"
          autoComplete="off"
          placeholder="What's it for?"
          value={note}
          onChange={(e) => setNote([...e.target.value.replace(/[\r\n\t]+/g, " ")].slice(0, NOTE_MAX).join(""))}
          className="h-11 rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text"
        />
      </div>

      {crossChain && amountBase > 0n && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex gap-2">
            {(["FAST", "SLOW"] as const).map((sp) => {
              const on = (fastAvailable ? speed : "SLOW") === sp;
              const unavailable = sp === "FAST" && !fastAvailable;
              return (
                <button
                  key={sp}
                  type="button"
                  aria-pressed={on}
                  disabled={unavailable}
                  onClick={() => setSpeed(sp)}
                  className={`flex h-12 flex-1 basis-0 flex-col items-center justify-center gap-0.5 rounded-md border disabled:opacity-50 ${on ? "border-action bg-surface-raised" : "border-border-control"}`}
                >
                  <span className="text-sm font-medium">{sp === "FAST" ? "Fast" : "Standard"}</span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {sp === "FAST" ? (unavailable ? "Not from this chain" : `${src.speed?.fast?.label ?? ""} · small fee`) : `${src.speed?.standard?.label ?? ""} · free`}
                  </span>
                </button>
              );
            })}
          </div>
          {quote ? (
            <div className={`flex flex-col gap-2 ${quoting ? "opacity-60" : ""}`}>
              <Row label="You send" value={`${fmt(quote.amount.usdc)} USDC`} />
              <Row label="Confluence fee" value={`${fmt(quote.platformFee.usdc)} USDC`} />
              <Row label={`Circle CCTP fee (${quote.speed === "FAST" ? "Fast" : "Standard"})`} value={quote.cctpFee.base === "0" ? "Free" : `-${quote.cctpFee.usdc} USDC`} />
              <Row label="Circle forwarding fee (est.)" value={quote.forwardingFee.base === "0" ? "Free" : `-${quote.forwardingFee.usdc} USDC`} />
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <Row label="Total from your wallet" value={`${fmt(quote.totalDebit.usdc)} USDC`} strong />
                <Row label={`@${id.handle} gets on ${arc.name} (est.)`} value={`${fmt(quote.expectedReceive.usdc)} USDC`} strong />
              </div>
              <span className="text-xs text-ink-muted">Circle&rsquo;s fees come out of the amount sent. Plus network gas on {src.name}.</span>
            </div>
          ) : quoteQ.error ? (
            <span role="alert" className="text-[13px] text-danger">
              {quoteErrorText(quoteQ.error)}
            </span>
          ) : (
            <span className="text-[13px] text-ink-muted">Getting quote...</span>
          )}
        </div>
      )}

      {crossChain && status === "connected" && chainId === src.evmChainId && <GasWarning chain={src} balanceWei={sourceGas.data?.value} />}

      {!crossChain && amountBase > 0n && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <Row label="Recipient gets" value={`${usdc(amountBase)} USDC`} />
          <Row label="Confluence fee" value={`${usdc(feeBase)} USDC`} />
          <div className="border-t border-border pt-2">
            <Row label="Total from your wallet" value={`${usdc(totalBase)} USDC`} strong />
          </div>
          <span className="text-xs text-ink-muted">Plus a small {arc.name} network fee, paid in USDC.</span>
        </div>
      )}

      {phase === "error" && pay.state.error && (
        <p role="alert" className="text-[13px] text-danger">
          {pay.state.error.message}
        </p>
      )}

      <Primary onClick={action.onClick} disabled={action.disabled}>
        {action.label}
      </Primary>
      <ChainPicker
        open={pickerOpen}
        title="Pay from"
        side="source"
        chains={pickable}
        selectedId={src.id}
        disabledId={undefined}
        onSelect={(c) => {
          setFromTouched(true);
          setFromId(c.id);
          setPickerOpen(false);
        }}
        onClose={closePicker}
      />
      <ConnectModal open={connectOpen} onClose={closeConnect} />
    </section>
  );
}

// ---------- review, signing and result ----------

type StepStatus = "waiting" | "active" | "confirming" | "done" | "error";

function StepLine({ n, title, sub, status, href }: { n: number; title: string; sub: string; status: StepStatus; href?: string }) {
  const badge =
    status === "done" ? (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destination text-xs font-medium text-white">✓</span>
    ) : (
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium ${status === "error" ? "border-danger text-danger" : status === "waiting" ? "border-border-control text-ink-muted" : "border-action-text text-action-text"}`}
      >
        {n}
      </span>
    );
  const label = status === "active" ? "Confirm in your wallet" : status === "confirming" ? `Confirming on Arc...` : status === "done" ? "Done" : status === "error" ? "Not completed" : "";
  return (
    <div className="flex items-start gap-3">
      {badge}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-ink-muted">{sub}</span>
        {label && <span className={`text-xs ${status === "error" ? "text-danger" : status === "done" ? "text-destination-text" : "text-action-text"}`}>{label}</span>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="w-fit font-mono text-xs text-action-text underline-offset-2 hover:underline">
            View transaction
          </a>
        )}
      </div>
    </div>
  );
}

function ReviewAndProgress({
  arc,
  state,
  explorer,
  onConfirm,
  onRetryPayment,
  onBack,
  onSave,
  saved,
}: {
  arc: BridgeChain;
  state: ReturnType<typeof useArcPayment>["state"];
  explorer: (hash: string) => string;
  onConfirm: () => void;
  onRetryPayment: () => void;
  onBack: () => void;
  onSave?: () => Promise<void>;
  saved: boolean;
}) {
  const p = state.payment!;
  const { phase, error, feeTx, payTx, confirming } = state;
  const [saving, setSaving] = useState<"idle" | "busy" | "done" | "error">("idle");

  const feeStatus: StepStatus =
    phase === "review" ? "waiting" : phase === "fee" ? (confirming ? "confirming" : "active") : phase === "error" && !error?.feePaid ? "error" : "done";
  const payStatus: StepStatus =
    phase === "success" ? "done" : phase === "payment" ? (confirming ? "confirming" : "active") : phase === "error" && error?.feePaid ? "error" : "waiting";

  return (
    <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="pay-review-title">
      {phase === "success" ? (
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destination text-2xl text-white" aria-hidden="true">
            ✓
          </span>
          <h1 id="pay-review-title" className="text-[22px] font-medium">
            Paid @{p.recipientId}
          </h1>
          <span className="tnum text-[34px] leading-[40px] font-medium">
            {fmt(p.amount.usdc)} <span className="text-lg text-ink-muted">USDC</span>
          </span>
          <span className="text-[13px] text-ink-muted">
            on {arc.name}. It shows in your Activity once Confluence has confirmed both transfers on chain.
          </span>
        </div>
      ) : (
        <h1 id="pay-review-title" className="text-[22px] font-medium">
          {phase === "review" ? "Review payment" : phase === "error" ? "Payment not completed" : "Paying..."}
        </h1>
      )}

      <RecipientCard handle={p.recipientId} address={p.recipient} />

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <Row label="Recipient gets" value={`${fmt(p.amount.usdc)} USDC`} />
        <Row label="Confluence fee" value={`${fmt(p.fee.usdc)} USDC`} />
        <div className="border-t border-border pt-2">
          <Row label="Total from your wallet" value={`${fmt(p.total.usdc)} USDC`} strong />
        </div>
        {p.note && (
          <div className="flex flex-col gap-0.5 border-t border-border pt-2">
            <span className="text-xs text-ink-muted">Note</span>
            {/* Plain text only: never rendered as a link (confluence:arc-pay). */}
            <span className="text-sm break-words whitespace-pre-wrap">{p.note}</span>
          </div>
        )}
      </div>

      {phase !== "success" && (
        <div className="flex flex-col gap-3">
          <span className="text-[13px] text-ink-muted">Your wallet asks you to confirm twice:</span>
          <StepLine n={1} title={`Fee: ${fmt(p.fee.usdc)} USDC to Confluence`} sub="Sent first." status={feeStatus} href={feeTx ? explorer(feeTx) : undefined} />
          <StepLine n={2} title={`Payment: ${fmt(p.amount.usdc)} USDC to @${p.recipientId}`} sub={`Straight to ${shortAddress(p.recipient)}.`} status={payStatus} href={payTx ? explorer(payTx) : undefined} />
        </div>
      )}
      {phase === "success" && payTx && (
        <a href={explorer(payTx)} target="_blank" rel="noopener noreferrer" className="self-center font-mono text-xs text-action-text underline-offset-2 hover:underline">
          View payment on {arc.name}
        </a>
      )}

      {error && (
        <p role="alert" className={`text-[13px] ${error.feePaid ? "text-warning" : "text-danger"}`}>
          {error.message}
        </p>
      )}

      {phase === "review" && (
        <div className="flex flex-col gap-2">
          <Primary onClick={onConfirm}>Pay @{p.recipientId}</Primary>
          <Secondary onClick={onBack}>Back</Secondary>
        </div>
      )}
      {phase === "error" && (
        <div className="flex flex-col gap-2">
          {error?.canSendPayment && <Primary onClick={onRetryPayment}>Send payment now (no new fee)</Primary>}
          <Secondary onClick={onBack}>{error?.feePaid ? "Done" : "Back"}</Secondary>
        </div>
      )}
      {phase === "success" && (
        <div className="flex flex-col gap-2">
          {onSave && saving !== "done" && (
            <Secondary
              disabled={saving === "busy"}
              onClick={() => {
                setSaving("busy");
                onSave().then(
                  () => setSaving("done"),
                  () => setSaving("error"),
                );
              }}
            >
              {saving === "busy" ? "Saving..." : `Save @${p.recipientId}`}
            </Secondary>
          )}
          {(saving === "done" || (saved && saving === "idle")) && <span className="text-center text-[13px] text-destination-text">@{p.recipientId} is in your saved IDs.</span>}
          {saving === "error" && <span className="text-center text-[13px] text-danger">Could not save right now.</span>}
          <Primary onClick={onBack}>Make another payment</Primary>
        </div>
      )}
    </section>
  );
}
