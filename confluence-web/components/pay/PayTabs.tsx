"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useConnection } from "wagmi";
import { useBridgeChains } from "@/components/Providers";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { MaintenanceGate } from "@/components/Maintenance";
import { Pager } from "@/components/Pager";
import { useSignIn } from "@/hooks/useSignIn";
import {
  addSavedId,
  ApiError,
  fetchPayActivity,
  fetchPayTotals,
  fetchSavedIds,
  removeSavedId,
  resumeArcPayment,
  SessionExpiredError,
  type PayActivityItem,
  type SavedId,
} from "@/lib/api";
import { shortAddress } from "@/lib/chains";
import { clearSession, useSession } from "@/lib/session";
import { IdAvatar, PayView, type FinishRequest } from "./PayView";
import { ReceiveCard } from "./ReceiveCard";

/**
 * Pay page (confluence:arc-pay): Send, Activity and Saved IDs. Sending never needs a
 * sign-in; Activity and Saved IDs are private, so they ask for one.
 */

type Tab = "send" | "receive" | "activity" | "saved";
const TABS: { id: Tab; label: string }[] = [
  { id: "send", label: "Send" },
  { id: "receive", label: "Receive" },
  { id: "activity", label: "Activity" },
  { id: "saved", label: "Saved" },
];

function fmt(usdc: string): string {
  const [w = "0", f] = usdc.split(".");
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return f ? `${grouped}.${f}` : grouped;
}

function Card({ children, title, actions }: { children: React.ReactNode; title?: string; actions?: React.ReactNode }) {
  return (
    <section className="flex w-full max-w-[460px] flex-col gap-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h1 className="text-[22px] font-medium">{title}</h1>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
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

function Small({ children, onClick, disabled, tone }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: "danger" | "action" }) {
  const color = tone === "danger" ? "text-danger hover:border-danger" : tone === "action" ? "border-action text-action-text hover:border-action-text" : "hover:border-action-text";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 shrink-0 rounded-md border border-border-control px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text ${color}`}
    >
      {children}
    </button>
  );
}

/** Connect, then sign in: Activity and Saved IDs are private to the wallet. */
function SignedInOnly({ what, children }: { what: string; children: (token: string, address: `0x${string}`) => React.ReactNode }) {
  const { address, status } = useConnection();
  const session = useSession(address);
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const { signIn, busy, error } = useSignIn();
  if (status !== "connected" || !address) {
    return (
      <Card title={what}>
        <p className="text-sm text-ink-muted">{what === "Receive" ? "Connect your wallet to get your pay link and QR code." : `Connect your wallet to see your ${what.toLowerCase()}.`}</p>
        <Primary onClick={() => setConnectOpen(true)}>Connect wallet</Primary>
        <ConnectModal open={connectOpen} onClose={closeConnect} />
      </Card>
    );
  }
  if (!session) {
    return (
      <Card title={what}>
        <p className="text-sm text-ink-muted">
          {what === "Receive" ? "To show your Confluence ID and pay link, sign" : `Your ${what.toLowerCase()} are private. Sign`} a message with {shortAddress(address)} to prove it is yours: a free signature, not a transaction.
          Sending a payment never needs this.
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <Primary onClick={() => void signIn()} disabled={busy}>
          {busy ? "Check your wallet..." : "Sign in with wallet"}
        </Primary>
      </Card>
    );
  }
  return <>{children(session.token, address)}</>;
}

/** `initialHandle`: opened from a pay link (/pay/@name), so Send starts filled in. */
export function PayTabs({ initialHandle }: { initialHandle?: string } = {}) {
  const [tab, setTab] = useState<Tab>("send");
  const [prefill, setPrefill] = useState<{ handle: string; nonce: number } | undefined>(initialHandle ? { handle: initialHandle, nonce: 1 } : undefined);
  const [finishRequest, setFinishRequest] = useState<FinishRequest | undefined>(undefined);

  const payId = (handle: string) => {
    setPrefill({ handle, nonce: Date.now() });
    setTab("send");
  };

  return (
    <div className="flex w-full max-w-[460px] flex-col gap-3">
      <div role="tablist" aria-label="Pay" className="grid grid-cols-4 gap-1 self-stretch rounded-md border border-border bg-surface p-1 min-[400px]:self-center">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`h-9 rounded-[4px] px-2 text-sm font-medium transition-colors min-[400px]:px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text ${
              tab === t.id ? "bg-action text-on-action" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Send stays mounted so a payment in progress is never interrupted by a tab switch. */}
      <div hidden={tab !== "send"} className="flex flex-col items-center">
        {/* Pay by ID moves USDC like a bridge, so the Bridge maintenance switch covers sending (confluence:arc-pay). */}
        <MaintenanceGate protocol="bridge">
          <PayView prefill={prefill} finishRequest={finishRequest} />
        </MaintenanceGate>
      </div>
      {tab === "receive" && <SignedInOnly what="Receive">{(token, address) => <ReceiveCard token={token} address={address} />}</SignedInOnly>}
      {tab === "activity" && (
        <SignedInOnly what="Activity">
          {(token) => (
            <ActivityCard
              token={token}
              onPay={payId}
              onFinish={(f) => {
                setFinishRequest(f);
                setTab("send");
              }}
            />
          )}
        </SignedInOnly>
      )}
      {tab === "saved" && <SignedInOnly what="Saved IDs">{(token, address) => <SavedCard token={token} address={address} onPay={payId} />}</SignedInOnly>}
    </div>
  );
}

// ---------- Activity ----------

function statusOf(it: PayActivityItem): { label: string; tone: "done" | "busy" | "warn" | "muted" } {
  if (it.kind === "arc") {
    switch (it.state) {
      case "COMPLETED":
        return { label: "Complete", tone: "done" };
      case "PAYMENT_SUBMITTED":
        return { label: "Confirming", tone: "busy" };
      case "FEE_PAID":
        return { label: "Payment not sent", tone: "warn" };
      case "FEE_SUBMITTED":
        return { label: "Fee confirming", tone: "busy" };
      default:
        return { label: it.state.replace(/_/g, " ").toLowerCase(), tone: "muted" };
    }
  }
  switch (it.state) {
    case "COMPLETED":
      return { label: "Complete", tone: "done" };
    case "RECOVERY_REQUIRED":
      return { label: "Needs attention", tone: "warn" };
    case "FAILED":
      return { label: "Failed", tone: "muted" };
    case "ATTESTED":
      return { label: "Delivering", tone: "busy" };
    case "MINT_SUBMITTED":
      return { label: "Minting", tone: "busy" };
    default:
      return { label: "In progress", tone: "busy" };
  }
}

const TONE = { done: "text-destination-text", busy: "text-action-text", warn: "text-warning", muted: "text-ink-muted" } as const;

function ActivityCard({ token, onPay, onFinish }: { token: string; onPay: (handle: string) => void; onFinish: (f: FinishRequest) => void }) {
  const [direction, setDirection] = useState<"sent" | "received">("sent");
  const [page, setPage] = useState(1);
  const guard = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof SessionExpiredError) clearSession();
      throw e;
    }
  };
  const q = useQuery({
    queryKey: ["pay-activity", token, direction, page],
    queryFn: () => guard(() => fetchPayActivity(token, direction, page)),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const totals = useQuery({ queryKey: ["pay-totals", token], queryFn: () => guard(() => fetchPayTotals(token)), retry: false });
  const [finishing, setFinishing] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);

  async function finish(it: PayActivityItem) {
    setFinishing(it.id);
    setFinishError(null);
    try {
      const resumed = await resumeArcPayment(token, it.id);
      onFinish({ resumed, feeUsdc: it.fee ?? "0", nonce: Date.now() });
    } catch (e) {
      if (e instanceof SessionExpiredError) clearSession();
      setFinishError(e instanceof ApiError ? e.message : "Could not open this payment. Try again.");
    } finally {
      setFinishing(null);
    }
  }

  const items = q.data?.items ?? [];
  const month = new Date().toLocaleString([], { month: "long" });

  return (
    <Card
      title="Activity"
      actions={
        <Small onClick={() => void Promise.all([q.refetch(), totals.refetch()])} disabled={q.isFetching}>
          {q.isFetching ? "Refreshing..." : "Refresh"}
        </Small>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {(["sent", "received"] as const).map((d) => (
          <div key={d} className="flex flex-col gap-0.5 rounded-md border border-border bg-bg p-3">
            <span className="text-xs text-ink-muted">
              {d === "sent" ? "Sent" : "Received"} in {month}
            </span>
            <span className="tnum font-mono text-[17px] font-medium">{totals.data ? `${fmt(totals.data[d])}` : "..."}</span>
            <span className="text-[11px] text-ink-muted">USDC, completed</span>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
        {(["sent", "received"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={direction === d}
            onClick={() => {
              setDirection(d);
              setPage(1);
            }}
            className={`h-8 rounded-[4px] text-sm font-medium ${direction === d ? "bg-surface-raised text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {d === "sent" ? "Sent" : "Received"}
          </button>
        ))}
      </div>

      {finishError && (
        <p role="alert" className="text-[13px] text-danger">
          {finishError}
        </p>
      )}
      {q.isPending && <p className="text-sm text-ink-muted">Loading...</p>}
      {q.isError && <p className="text-sm text-danger">Could not load your activity.</p>}
      {!q.isPending && !q.isError && items.length === 0 && (
        <p className="text-sm text-ink-muted">
          {direction === "sent" ? "Payments you send to Confluence IDs show here." : "Payments people send to your Confluence ID show here."}
        </p>
      )}

      <ul className={`flex flex-col ${q.isFetching && q.isPlaceholderData ? "opacity-60" : ""}`}>
        {items.map((it) => (
          <ActivityRow key={`${it.kind}-${it.id}`} it={it} onPay={onPay} onFinish={() => void finish(it)} finishing={finishing === it.id} />
        ))}
      </ul>
      {q.data && q.data.totalPages > 1 && (
        <Pager page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={setPage} busy={q.isFetching} />
      )}
    </Card>
  );
}

function ActivityRow({ it, onPay, onFinish, finishing }: { it: PayActivityItem; onPay: (h: string) => void; onFinish: () => void; finishing: boolean }) {
  const { chains } = useBridgeChains();
  const nameOf = (id: string) => chains.find((c) => c.id === id)?.name ?? id;
  const st = statusOf(it);
  const who = it.counterpartyId ? `@${it.counterpartyId}` : shortAddress(it.counterparty);
  const when = new Date(it.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const route = it.sourceChain === it.destinationChain ? nameOf(it.sourceChain) : `${nameOf(it.sourceChain)} to ${nameOf(it.destinationChain)}`;
  const arc = chains.find((c) => c.id === it.sourceChain);
  const link =
    it.kind === "bridge" ? { href: `/tx/${it.id}`, internal: true } : it.txHash && arc ? { href: arc.explorerTxUrl.replace("{hash}", it.txHash), internal: false } : undefined;
  const sent = it.direction === "sent";

  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        {it.counterpartyId ? <IdAvatar handle={it.counterpartyId} size={36} /> : <span className="h-9 w-9 shrink-0 rounded-full border border-border-control bg-surface-raised" aria-hidden="true" />}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{sent ? `To ${who}` : `From ${who}`}</span>
          <span className="truncate text-xs text-ink-muted">
            {route} · {when}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={`tnum font-mono text-sm font-medium ${sent ? "" : "text-destination-text"}`}>
            {sent ? "-" : "+"}
            {fmt(it.amount)}
          </span>
          <span className={`font-mono text-[11px] ${TONE[st.tone]}`}>{st.label}</span>
        </div>
      </div>
      {it.note && (
        // Plain text only, never a link (confluence:arc-pay).
        <p className="ml-12 rounded-md bg-bg px-2.5 py-1.5 text-[13px] break-words text-ink-muted">&ldquo;{it.note}&rdquo;</p>
      )}
      <div className="ml-12 flex flex-wrap items-center gap-2">
        {it.canFinish && (
          <Small tone="action" onClick={onFinish} disabled={finishing}>
            {finishing ? "Opening..." : "Finish payment"}
          </Small>
        )}
        {sent && it.counterpartyId && it.state === "COMPLETED" && <Small onClick={() => onPay(it.counterpartyId!)}>Pay again</Small>}
        {!sent && it.counterpartyId && <Small onClick={() => onPay(it.counterpartyId!)}>Pay @{it.counterpartyId}</Small>}
        {link &&
          (link.internal ? (
            <Link href={link.href} className="font-mono text-xs text-action-text underline-offset-2 hover:underline">
              Details
            </Link>
          ) : (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-action-text underline-offset-2 hover:underline">
              View on {arc?.name ?? "explorer"}
            </a>
          ))}
        {sent && it.fee && <span className="font-mono text-[11px] text-ink-muted">{it.fee === "0" ? "no fee" : `fee ${it.fee}`}</span>}
      </div>
      {it.canFinish && (
        <p className="ml-12 text-xs text-warning">Your fee is paid. Finish the payment to send the money, with no new fee.</p>
      )}
    </li>
  );
}

// ---------- Saved IDs ----------

function SavedCard({ token, address, onPay }: { token: string; address: string; onPay: (handle: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["saved-ids", address],
    queryFn: async () => {
      try {
        return await fetchSavedIds(token);
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        throw e;
      }
    },
    retry: false,
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const set = (ids: SavedId[]) => qc.setQueryData(["saved-ids", address], ids);

  async function add() {
    const handle = input.trim().replace(/^@+/, "");
    if (!handle) return;
    setBusy(true);
    setError(null);
    try {
      set(await addSavedId(token, handle));
      setInput("");
    } catch (e) {
      if (e instanceof SessionExpiredError) clearSession();
      setError(
        e instanceof ApiError
          ? e.code === "id_not_found"
            ? `No one has claimed @${handle.toLowerCase()}.`
            : e.code === "own_id"
              ? "That's your own Confluence ID."
              : e.message
          : "Could not save right now.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(handle: string) {
    setBusy(true);
    try {
      set(await removeSavedId(token, handle));
    } catch (e) {
      if (e instanceof SessionExpiredError) clearSession();
      setError("Could not remove right now.");
    } finally {
      setBusy(false);
      setConfirmRemove(null);
    }
  }

  const ids = q.data ?? [];
  return (
    <Card title="Saved IDs">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="save-id" className="text-[13px] font-medium text-ink-muted">
          Save a Confluence ID
        </label>
        <div className="flex gap-2">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-md border border-border-control bg-bg px-3 focus-within:border-action-text">
            <span className="text-ink-muted" aria-hidden="true">
              @
            </span>
            <input
              id="save-id"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name"
              maxLength={21}
              value={input}
              onChange={(e) => setInput(e.target.value.replace(/^@+/, "").replace(/\s/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !input.trim()}
            className="h-11 shrink-0 rounded-md bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover disabled:opacity-60"
          >
            Save
          </button>
        </div>
        {error && (
          <span role="alert" className="text-[13px] text-danger">
            {error}
          </span>
        )}
        <span className="text-xs text-ink-muted">Only claimed IDs can be saved. Saved IDs show as quick picks when you pay.</span>
      </div>

      {q.isPending && <p className="text-sm text-ink-muted">Loading...</p>}
      {!q.isPending && ids.length === 0 && <p className="text-sm text-ink-muted">No saved IDs yet. After you pay someone, you can save their ID.</p>}
      <ul className="flex flex-col">
        {ids.map((s) => (
          <li key={s.handle} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
            <IdAvatar handle={s.handle} size={36} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">@{s.handle}</span>
              <span className="truncate font-mono text-xs text-ink-muted">{shortAddress(s.address)}</span>
            </div>
            {confirmRemove === s.handle ? (
              <>
                <Small tone="danger" onClick={() => void remove(s.handle)} disabled={busy}>
                  Remove
                </Small>
                <Small onClick={() => setConfirmRemove(null)}>Keep</Small>
              </>
            ) : (
              <>
                <Small tone="action" onClick={() => onPay(s.handle)}>
                  Pay
                </Small>
                <Small onClick={() => setConfirmRemove(s.handle)} disabled={busy}>
                  Remove
                </Small>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
