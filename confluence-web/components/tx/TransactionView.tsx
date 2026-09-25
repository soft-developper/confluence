"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import { fetchTransfer, type TransferDetail } from "@/lib/api";
import { shortAddress, type BridgeChain } from "@/lib/chains";
import { fetchIrisMessage, FORWARD_DONE } from "@/lib/iris";
import { isMessageReceived } from "@/lib/mintCheck";
import { deriveTxView, expirationBlockOf, PHASE_LABEL, type TxView } from "@/lib/txStatus";
import { createPublicClient, fallback, http } from "viem";
import { toViemChain } from "@/lib/chains";
import { useBridgeChains } from "@/components/Providers";
import { useCompleteMint } from "@/hooks/useCompleteMint";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { ChainDot } from "@/components/bridge/ChainDot";
import { fmtUsdc } from "@/components/bridge/ReviewPanel";

const POLL_MS = 10_000;

function explorerTx(chain: BridgeChain | undefined, hash: string | null | undefined): string | undefined {
  if (!chain || !hash) return undefined;
  return chain.explorerTxUrl.includes("{hash}") ? chain.explorerTxUrl.replace("{hash}", hash) : undefined;
}

function time(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

const CHIP: Record<TxView["phase"], string> = {
  complete: "border-destination text-destination-text",
  minting: "border-action text-action-text",
  ready_to_mint: "border-action text-action-text",
  awaiting_attestation: "border-action text-action-text",
  sending: "border-source text-source-text",
  needs_attention: "border-warning text-ink",
  failed: "border-border-control text-ink-muted",
  not_sent: "border-border-control text-ink-muted",
};

export function TransactionView({ id }: { id: string }) {
  const { chains } = useBridgeChains();

  const tq = useQuery({
    queryKey: ["transfer", id],
    queryFn: () => fetchTransfer(id),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return q.state.status === "error" ? POLL_MS : false;
      return d.state === "COMPLETED" || (d.state === "FAILED" && !d.burnTxHash) ? false : POLL_MS;
    },
    retry: 1,
  });
  const t = tq.data ?? undefined;
  const from = chains.find((c) => c.id === t?.sourceChain);
  const to = chains.find((c) => c.id === t?.destinationChain);

  const liveNeeded = Boolean(t?.burnTxHash) && t?.state !== "COMPLETED";
  const iq = useQuery({
    queryKey: ["iris", from?.cctpDomain, t?.burnTxHash],
    queryFn: () => fetchIrisMessage(from!.cctpDomain, t!.burnTxHash!),
    enabled: liveNeeded && !!from,
    refetchInterval: (q) => {
      const m = q.state.data;
      if (!m) return POLL_MS;
      if (t?.useForwarder) return FORWARD_DONE.has(m.forwardState ?? "") || m.forwardState === "FAILED" ? false : POLL_MS;
      return m.status === "complete" ? false : POLL_MS;
    },
  });

  const nonce = (iq.data?.decodedMessage as { nonce?: string } | null | undefined)?.nonce;
  const nq = useQuery({
    queryKey: ["nonce-used", to?.id, nonce],
    queryFn: () => isMessageReceived(to!, nonce),
    // Forwarding off, or Circle's forward failed: someone may have submitted the mint.
    enabled:
      liveNeeded &&
      !!to &&
      iq.data?.status === "complete" &&
      (!t?.useForwarder || iq.data?.forwardState === "FAILED" || t?.errorCode === "forward_failed"),
    refetchInterval: (q) => (q.state.data === true ? false : 15_000),
  });

  // Destination block number, only when the attestation has an expiry (Fast transfers).
  const expiry = expirationBlockOf(iq.data);
  const bq = useQuery({
    queryKey: ["dest-block", to?.id],
    queryFn: () =>
      createPublicClient({ chain: toViemChain(to!), transport: fallback(to!.rpcUrls.map((u) => http(u))) }).getBlockNumber(),
    enabled: liveNeeded && !!to && expiry !== null && nq.data !== true,
    refetchInterval: 30_000,
    retry: 1,
  });

  if (tq.isPending) return <Card><p className="text-sm text-ink-muted">Loading transfer...</p></Card>;
  if (tq.isError) {
    return (
      <Card>
        <h1 className="text-[22px] font-medium">Could not load this transfer</h1>
        <p className="text-sm text-ink-muted">The Confluence API did not respond. It retries every 10 seconds.</p>
      </Card>
    );
  }
  if (!t) {
    return (
      <Card>
        <h1 className="text-[22px] font-medium">Transfer not found</h1>
        <p className="text-sm text-ink-muted">Check the link. Transfer ids are shown on the bridge card after you confirm.</p>
        <Link href="/" className="text-sm text-action-text">
          Start a bridge
        </Link>
      </Card>
    );
  }
  if (!from || !to) {
    return (
      <Card>
        <h1 className="text-[22px] font-medium">Bridge #{t.id.slice(0, 6).toUpperCase()}</h1>
        <p className="text-sm text-ink-muted">
          This transfer uses a chain that is not in the current chain list ({t.sourceChain} to {t.destinationChain}).
        </p>
      </Card>
    );
  }

  return <Loaded t={t} from={from} to={to} view={deriveTxView(t, iq.data, nq.data, Date.now(), bq.data)} irisError={iq.isError} onMinted={() => void tq.refetch()} />;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex w-full max-w-[560px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="tx-title">
      {children}
    </section>
  );
}

function Loaded({ t, from, to, view, irisError, onMinted }: { t: TransferDetail; from: BridgeChain; to: BridgeChain; view: TxView; irisError: boolean; onMinted: () => void }) {
  const { chains } = useBridgeChains();
  const { status, connector } = useConnection();
  const [connectOpen, setConnectOpen] = useState(false);
  const mint = useCompleteMint();

  const mintHash = mint.state.status === "done" ? (mint.state.mintTxHash ?? view.mintTxHash) : view.mintTxHash;
  const minted = view.minted || mint.state.status === "done";
  const phase = minted ? "complete" : view.phase;

  const bars = [
    { label: "Source", done: view.burned, color: "bg-source" },
    { label: "Attestation", done: view.attested, color: "bg-action" },
    { label: "Destination", done: minted, color: "bg-destination" },
  ];

  type Row = { text: string; done: boolean; right?: string; active?: boolean };
  const rows: Row[] = [
    { text: "Transfer created", done: true, right: time(view.reachedAt.CREATED ?? t.createdAt) },
    { text: "USDC approved", done: view.approved, right: time(view.reachedAt.APPROVED) },
    {
      text: `USDC burned on ${from.name}`,
      done: view.burned,
      right: time(view.reachedAt.BURN_SUBMITTED),
      active: phase === "sending" && view.approved,
    },
    {
      text: view.attested ? "Circle attestation received" : "Circle attestation",
      done: view.attested,
      right: view.attestedFrom === "database" ? time(view.reachedAt.ATTESTED) : view.attestedFrom === "circle" ? "Confirmed by Circle" : undefined,
      active: phase === "awaiting_attestation",
    },
    {
      text: minted ? `USDC minted on ${to.name}` : t.useForwarder ? `Circle mints on ${to.name}` : `Mint on ${to.name}`,
      done: minted,
      right: minted
        ? view.mintedFrom === "database"
          ? time(view.reachedAt.COMPLETED)
          : view.mintedFrom === "circle"
            ? "Confirmed by Circle"
            : "Confirmed on chain"
        : phase === "minting"
          ? "In progress"
          : phase === "ready_to_mint"
            ? "Waiting for you"
            : undefined,
      active: phase === "minting",
    },
  ];

  const burnUrl = explorerTx(from, t.burnTxHash);
  const mintUrl = explorerTx(to, mintHash);
  const working = mint.state.status === "working";

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h1 id="tx-title" className="font-mono text-sm text-ink-muted">
          Bridge #{t.id.slice(0, 6).toUpperCase()}
        </h1>
        <span className={`rounded-[4px] border px-2 py-0.5 text-xs font-medium ${CHIP[phase]}`}>{PHASE_LABEL[phase]}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
        <ChainDot name={from.name} side="source" />
        <span className="text-source-text">{from.name}</span>
        <span className="text-ink-muted" aria-hidden="true">
          →
        </span>
        <span className="sr-only">to</span>
        <ChainDot name={to.name} side="destination" />
        <span className="text-destination-text">{to.name}</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="tnum text-[40px] leading-[46px] font-medium">
          {fmtUsdc(t.amount.usdc)} <span className="text-lg text-ink-muted">USDC</span>
        </span>
        <span className="text-[13px] text-ink-muted">
          {t.expectedReceive ? `Expected receive ${fmtUsdc(t.expectedReceive.usdc)} USDC, ` : ""}
          {t.speed === "FAST" ? "Fast" : "Standard"}, forwarding {t.useForwarder ? "on" : "off"}. Created {when(t.createdAt)}.
        </span>
      </div>

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
        {rows.map((r) => (
          <li key={r.text} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
            <span className={`flex items-center gap-2.5 text-[15px] ${r.done || r.active ? "text-ink" : "text-ink-muted"}`}>
              <StatusIcon done={r.done} active={Boolean(r.active)} />
              {r.text}
            </span>
            {r.right && <span className="shrink-0 font-mono text-xs text-ink-muted">{r.right}</span>}
          </li>
        ))}
      </ol>

      {phase === "failed" && (
        <div role="status" className="rounded-md border border-border-control bg-bg p-3 text-[13px]">
          This transfer stopped before the burn{t.errorCode === "user_rejected" ? " (declined in the wallet)" : ""}. No USDC left your wallet.
        </div>
      )}
      {phase === "not_sent" && (
        <div role="status" className="rounded-md border border-border-control bg-bg p-3 text-[13px]">
          No burn was recorded for this transfer, so no USDC left your wallet through it.
        </div>
      )}
      {view.forwardFailed && !minted && (
        <div role="alert" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
          Circle reports that its Forwarding Service could not submit the mint on {to.name}. Your USDC is burned and safe.
          {view.canCompleteMint ? " You can submit the mint yourself below." : " Waiting for Circle's attestation before you can submit it yourself."}
        </div>
      )}
      {irisError && view.burned && !minted && (
        <p className="text-xs text-ink-muted">Could not reach Circle for live status; showing what Confluence recorded. Retrying.</p>
      )}

      {view.canCompleteMint && mint.state.status !== "done" && (
        <div className="flex flex-col gap-3 rounded-md border border-action bg-bg p-4">
          {view.attestationExpired && (
            <p className="text-[13px] text-ink-muted">
              Circle&apos;s attestation for this transfer has expired. Complete mint first asks Circle for a fresh one (no signature), then asks you to
              sign the mint.
            </p>
          )}
          <p className="text-[13px]">
            {view.forwardFailed ? "Anyone can submit this mint, so you can do it yourself. " : "Circle has attested this transfer. "}
            Submit the mint on {to.name} to receive the USDC
            {t.recipient.toLowerCase() !== t.sender.toLowerCase() ? ` at ${shortAddress(t.recipient)}` : ""}. Your wallet switches to {to.name} and
            asks you to sign once; gas is paid in {to.nativeCurrency.symbol}.
          </p>
          {mint.state.status === "error" && (
            <p role="alert" className="text-[13px] text-ink">
              {mint.state.message}
            </p>
          )}
          {status !== "connected" ? (
            <ActionButton onClick={() => setConnectOpen(true)}>Connect wallet</ActionButton>
          ) : (
            <ActionButton
              disabled={working || !connector}
              onClick={() =>
                connector &&
                void mint
                  .run({ transfer: t, from, to, registry: chains, getProvider: () => connector.getProvider() })
                  .then(onMinted)
              }
            >
              {working
                ? mint.state.status === "working" && mint.state.step === "wallet"
                  ? "Confirm in wallet"
                  : mint.state.status === "working" && mint.state.step === "reattest"
                    ? "Getting a fresh attestation..."
                    : "Completing mint, confirm in your wallet when asked"
                : mint.state.status === "error"
                  ? "Try again"
                  : `Complete mint on ${to.name}`}
            </ActionButton>
          )}
        </div>
      )}
      {mint.state.status === "done" && (
        <div role="status" className="rounded-md border border-destination bg-bg p-3 text-[13px]">
          Mint submitted on {to.name}.{mint.state.reported ? "" : " Confluence will record it once tracking runs (Stage 4); the chain already has it."}
        </div>
      )}

      <div className="h-px bg-border" />
      <dl className="flex flex-col gap-2 text-sm">
        <Detail label="Source" value={shortAddress(t.sender)} />
        <Detail label="Destination" value={shortAddress(t.recipient)} />
        <Detail label="Burn transaction" value={t.burnTxHash ? shortAddress(t.burnTxHash) : "Not yet"} />
        <Detail label="Attestation" value={view.attested ? "Available" : view.burned ? "Pending" : "Not yet"} />
        <Detail label="Mint transaction" value={mintHash ? shortAddress(mintHash) : minted ? "Confirmed" : "Not yet"} />
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ExternalButton href={burnUrl}>View source transaction</ExternalButton>
        <ExternalButton href={mintUrl}>View destination transaction</ExternalButton>
      </div>

      <Link href="/" className="self-start text-sm text-action-text">
        New bridge
      </Link>
      <ConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </Card>
  );
}

function StatusIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done)
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-destination-text">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.5l2.5 2.5L16 9.5" />
      </svg>
    );
  if (active)
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" className="animate-spin text-action-text">
        <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" className="text-border-control">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono text-[13px]">{value}</dd>
    </div>
  );
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-11 w-full rounded-md bg-action text-sm font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
    >
      {children}
    </button>
  );
}

function ExternalButton({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  const cls = "flex h-10 flex-1 items-center justify-center rounded-md border text-sm font-medium";
  if (!href) return <span className={`${cls} cursor-not-allowed border-border text-ink-muted opacity-60`} aria-disabled="true">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} border-border-control hover:border-action-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text`}>
      {children}
    </a>
  );
}
