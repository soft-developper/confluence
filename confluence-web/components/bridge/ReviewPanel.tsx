"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Quote } from "@/lib/api";
import { shortAddress, type BridgeChain } from "@/lib/chains";
import { STAGES, type ExecutionState, type Stage } from "@/hooks/useBridgeExecution";
import { ChainDot } from "./ChainDot";

export function fmtUsdc(usdc: string): string {
  const [w = "0", f] = usdc.split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${grouped}.${f}` : grouped;
}

function Row({ label, value, strong, tone, top }: { label: string; value: string; strong?: boolean; tone?: "destination"; top?: boolean }) {
  const labelColor = tone === "destination" ? "text-destination-text" : strong ? "text-ink" : "text-ink-muted";
  return (
    <div className={`flex justify-between gap-3 ${top ? "border-t border-border pt-2.5" : ""}`}>
      <span className={`text-sm ${labelColor} ${strong ? "font-medium" : ""}`}>{label}</span>
      <span className={`tnum text-right font-mono text-sm ${tone === "destination" ? "text-destination-text" : "text-ink"} ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
}

const Icon = {
  done: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  ),
  waiting: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  active: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" className="animate-spin">
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  ),
  error: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  ),
  back: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  ),
  external: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  ),
};

export interface ReviewPanelProps {
  quote: Quote;
  from: BridgeChain;
  to: BridgeChain;
  sender: string;
  exec: ExecutionState;
  /** Wallet is on the source chain (only checked before signing starts). */
  onSourceChain: boolean;
  switching: boolean;
  onSwitch: () => void;
  /** Native gas balance on the destination (base units), when the user mints themselves. */
  destinationGas: bigint | undefined;
  /** Saved address book name for the recipient, if any. */
  recipientLabel?: string | undefined;
  /** Recipient safety notices (warn only), rendered before signing. */
  recipientWarning?: React.ReactNode;
  /** Source-chain gas notice (warn only), rendered before signing. */
  sourceGasWarning?: React.ReactNode;
  onBack: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onDone: () => void;
}

export function ReviewPanel(p: ReviewPanelProps) {
  const { quote, from, to, exec } = p;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Move focus for keyboard and screen reader users without scrolling the page.
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // Once a transfer exists, its values are what was signed; before that, the live quote.
  const t = exec.transfer;
  const recipient = t?.recipient ?? quote.recipient;
  const forwarding = t?.useForwarder ?? quote.useForwarder;
  const speed = t?.speed ?? quote.speed;
  const selfRecipient = recipient.toLowerCase() === p.sender.toLowerCase();
  const started = exec.phase !== "idle";
  const busy = exec.phase === "preparing" || exec.phase === "running";

  const title =
    exec.phase === "success" ? "Bridge complete" : exec.phase === "error" ? "Bridge stopped" : started ? "Bridging" : "Review bridge";

  // The first stage that is not finished is the one in progress.
  const activeStage: Stage | undefined =
    exec.phase === "running" ? STAGES.find((s) => exec.stages[s].status === "waiting") : undefined;

  const stageText = (s: Stage): string => {
    const st = exec.stages[s].status;
    switch (s) {
      case "approve":
        return st === "done" ? "USDC approved" : st === "skipped" ? "USDC already approved" : `Approve USDC on ${from.name}`;
      case "burn":
        return st === "done" ? `USDC burned on ${from.name}` : `Burn USDC on ${from.name}`;
      case "fetchAttestation":
        return st === "done" ? "Circle attestation received" : "Circle attestation";
      case "mint":
        return st === "done" ? `USDC minted on ${to.name}` : forwarding ? `Circle mints on ${to.name}` : `Mint on ${to.name}`;
    }
  };
  const activeHint = (s: Stage): string => {
    if (s === "approve" || s === "burn" || (s === "mint" && !forwarding)) return "Confirm in wallet";
    if (s === "fetchAttestation") return quote.eta ? `About ${quote.eta.replace(/^~/, "")}` : "Waiting";
    return "In progress";
  };

  // Progress bar: source (approve, burn), attestation, destination.
  const seg = (stages: Stage[]) => stages.every((s) => ["done", "skipped"].includes(exec.stages[s].status));
  const bars = [
    { label: "Source", done: seg(["approve", "burn"]), color: "bg-source" },
    { label: "Attestation", done: seg(["fetchAttestation"]), color: "bg-action" },
    { label: "Destination", done: seg(["mint"]), color: "bg-destination" },
  ];

  const signNote = forwarding
    ? `Your wallet will ask you to sign 2 transactions on ${from.name}: approve USDC, then burn. Circle mints on ${to.name} after attestation.`
    : `Your wallet will ask you to sign 2 transactions on ${from.name}: approve USDC, then burn. After attestation it switches to ${to.name} and asks you to sign the mint.`;
  const noGas = !forwarding && p.destinationGas !== undefined && p.destinationGas === 0n;

  const downgraded = exec.warnings.some((w) => w.code === "SPEED_DOWNGRADED");
  const burnHash = exec.stages.burn.txHash;

  return (
    <div className="flex flex-col gap-5">
      {!started && (
        <button type="button" onClick={p.onBack} className="flex items-center gap-1.5 self-start text-sm text-ink-muted hover:text-ink">
          {Icon.back}Back
        </button>
      )}

      <div className="flex items-start justify-between gap-3">
        <h1 ref={headingRef} tabIndex={-1} id="bridge-title" className="text-[22px] font-medium outline-none">
          {title}
        </h1>
        {t && (
          <Link
            href={`/tx/${t.id}`}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1 font-mono text-xs text-action-text"
            aria-label={`View transaction Bridge #${t.id.slice(0, 6).toUpperCase()} in a new tab`}
          >
            Bridge #{t.id.slice(0, 6).toUpperCase()} {Icon.external}
          </Link>
        )}
      </div>

      {/* Route */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-ink-muted">From</span>
          <span className="flex min-w-0 items-center gap-2">
            <ChainDot name={from.name} side="source" />
            <span className="truncate font-medium text-source-text">{from.name}</span>
          </span>
          <span className="font-mono text-xs text-ink-muted">{shortAddress(p.sender)}</span>
        </div>
        <div className="flex flex-1 items-center px-2" aria-hidden="true">
          <span className="h-0.5 flex-1 bg-source" />
          <span className="h-0.5 flex-1 bg-action" />
          <span className="h-0.5 flex-1 bg-destination" />
        </div>
        <div className="flex min-w-0 flex-col items-end gap-1">
          <span className="text-xs text-ink-muted">To</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-destination-text">{to.name}</span>
            <ChainDot name={to.name} side="destination" />
          </span>
          <span className="font-mono text-xs text-ink-muted">{shortAddress(recipient)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-ink-muted">You receive on {to.name}</span>
        <span className="tnum text-[40px] leading-[46px] font-medium">
          {fmtUsdc(quote.expectedReceive.usdc)} <span className="text-lg text-ink-muted">USDC</span>
        </span>
      </div>

      {!started ? (
        <>
          <div className="flex flex-col gap-2">
            <Row label="Bridge amount" value={fmtUsdc(quote.amount.usdc)} />
            <Row label="Platform fee" value={`+${quote.platformFee.usdc}`} />
            <Row label="Total debit" value={`${fmtUsdc(quote.totalDebit.usdc)} USDC`} strong top />
            <Row label={`CCTP fee (${quote.speed === "FAST" ? "Fast" : "Standard"})`} value={quote.cctpFee.base === "0" ? "Free" : `-${quote.cctpFee.usdc}`} />
            {quote.useForwarder && <Row label="Forwarding fee (est.)" value={quote.forwardingFee.base === "0" ? "Free" : `-${quote.forwardingFee.usdc}`} />}
            <Row label="Expected receive" value={`${fmtUsdc(quote.expectedReceive.usdc)} USDC`} strong tone="destination" top />
          </div>
          <div className="h-px bg-border" />
          <div className="flex flex-col gap-2">
            <Row label="Speed" value={`${speed === "FAST" ? "Fast" : "Standard"}${quote.eta ? `, ${quote.eta}` : ""}`} />
            <Row label="Forwarding" value={forwarding ? "On" : "Off"} />
            <Row
              label="Recipient"
              value={
                selfRecipient
                  ? `Your wallet, ${shortAddress(recipient)}`
                  : p.recipientLabel
                    ? `${p.recipientLabel}, ${shortAddress(recipient)}`
                    : shortAddress(recipient)
              }
            />
          </div>
          <div className="flex items-start gap-2.5 rounded-md border border-border bg-bg p-3 text-[13px] text-ink-muted">
            <span className="mt-px shrink-0 text-action-text">{Icon.info}</span>
            <span>{signNote}</span>
          </div>
          {p.recipientWarning}
          {p.sourceGasWarning}
          {noGas && (
            <div role="status" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
              You have no {to.nativeCurrency.symbol} on {to.name} to pay gas for the mint. Add some before the attestation arrives, or go back and
              turn forwarding on if it is available.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex gap-1" aria-hidden="true">
              {bars.map((b) => (
                <span key={b.label} className={`h-1.5 flex-1 rounded-[2px] ${b.done ? b.color : "bg-border"}`} />
              ))}
            </div>
            <div className="flex justify-between text-xs text-ink-muted">
              {bars.map((b) => (
                <span key={b.label}>{b.label}</span>
              ))}
            </div>
          </div>

          <ol className="flex flex-col" aria-live="polite">
            {STAGES.map((s) => {
              const v = exec.stages[s];
              const isActive = activeStage === s || (exec.phase === "preparing" && s === "approve");
              const status = isActive ? "active" : v.status === "skipped" ? "done" : v.status;
              const iconColor =
                status === "error"
                  ? "text-danger"
                  : status === "done"
                    ? s === "mint"
                      ? "text-destination-text"
                      : s === "fetchAttestation"
                        ? "text-action-text"
                        : "text-source-text"
                    : status === "active"
                      ? "text-action-text"
                      : "text-border-control";
              return (
                <li key={s} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
                  <span className={`flex items-center gap-2.5 text-[15px] ${status === "waiting" ? "text-ink-muted" : "text-ink"}`}>
                    <span className={`flex ${iconColor}`}>{Icon[status]}</span>
                    {stageText(s)}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-ink-muted">
                    {isActive ? (exec.phase === "preparing" ? "Preparing" : activeHint(s)) : null}
                    {v.explorerUrl ? (
                      <a href={v.explorerUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-action-text" aria-label={`View ${stageText(s)} on explorer`}>
                        View {Icon.external}
                      </a>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>

          {burnHash && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">Burn transaction</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[13px]" title={burnHash}>
                  {shortAddress(burnHash)}
                </span>
                {exec.stages.burn.explorerUrl && (
                  <a
                    href={exec.stages.burn.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View burn transaction on explorer"
                    className="flex text-action-text"
                  >
                    {Icon.external}
                  </a>
                )}
              </span>
            </div>
          )}

          {downgraded && (
            <div role="status" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
              Fast was temporarily unavailable on this route, so this transfer used Standard.
            </div>
          )}

          {exec.phase === "success" && (
            <div role="status" className="rounded-md border border-destination bg-bg p-3 text-[13px]">
              About {fmtUsdc(quote.expectedReceive.usdc)} USDC minted to {selfRecipient ? "your wallet" : shortAddress(recipient)} on {to.name}.
            </div>
          )}

          {exec.phase === "error" && exec.error && (
            <div role="alert" className="rounded-md border border-danger bg-bg p-3 text-[13px]">
              {exec.error.message}
            </div>
          )}

          {t && (
            <Link href={`/tx/${t.id}`} target="_blank" rel="noopener" className="self-center text-sm text-action-text">
              View transaction
            </Link>
          )}
          {busy && <p className="text-center text-xs text-ink-muted">Keep this page open until the bridge finishes.</p>}
        </>
      )}

      {/* Primary action */}
      {!started &&
        (p.onSourceChain ? (
          <PrimaryButton onClick={p.onConfirm}>Confirm and sign</PrimaryButton>
        ) : (
          <PrimaryButton onClick={p.onSwitch} disabled={p.switching}>
            {p.switching ? "Switching..." : `Switch to ${from.name}`}
          </PrimaryButton>
        ))}
      {busy && <PrimaryButton disabled>{exec.phase === "preparing" ? "Preparing..." : "Bridging..."}</PrimaryButton>}
      {exec.phase === "success" && <PrimaryButton onClick={p.onDone}>Bridge again</PrimaryButton>}
      {exec.phase === "error" && exec.error && (
        <div className="flex flex-col gap-2">
          {exec.error.forwardFailed && t ? (
            <Link
              href={`/tx/${t.id}`}
              target="_blank"
              rel="noopener"
              className="flex h-13 w-full items-center justify-center rounded-md bg-action text-[15px] font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
            >
              Finish on the transaction page
            </Link>
          ) : exec.error.canRetry ? (
            <PrimaryButton onClick={p.onRetry}>Retry</PrimaryButton>
          ) : (
            <PrimaryButton onClick={p.onConfirm}>Try again</PrimaryButton>
          )}
          <button
            type="button"
            onClick={p.onDone}
            className="h-11 w-full rounded-md border border-border-control text-sm font-medium hover:border-action-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            {exec.error.afterBurn ? "Back to bridge" : "Edit bridge"}
          </button>
        </div>
      )}
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-13 w-full rounded-md bg-action text-[15px] font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
    >
      {children}
    </button>
  );
}
