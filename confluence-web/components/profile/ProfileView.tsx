"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "wagmi";
import {
  ApiError,
  checkIdAvailability,
  claimConfluenceId,
  fetchHistory,
  fetchMe,
  SessionExpiredError,
  signOut,
  type HistoryItem,
} from "@/lib/api";
import { shortAddress } from "@/lib/chains";
import { clearSession, useSession } from "@/lib/session";
import { useAddressBook } from "@/lib/addressBook";
import { useBridgeChains } from "@/components/Providers";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { SYNC_EVENT } from "@/components/SessionSync";
import { useDebounced } from "@/hooks/useDebounced";
import { useSignIn } from "@/hooks/useSignIn";
import { RequestsCard } from "./RequestsCard";

const ID_RULE = /^[a-z0-9_]{3,20}$/;

function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <section className="flex w-full max-w-[560px] flex-col gap-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
      {title && <h2 className="text-lg font-medium">{title}</h2>}
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

export function ProfileView() {
  const { address, status } = useConnection();
  const session = useSession(address);
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  const { signIn, busy, error } = useSignIn();

  if (status !== "connected" || !address) {
    return (
      <Card title="Profile">
        <p className="text-sm text-ink-muted">Connect a wallet to see your Confluence ID, history and synced address book.</p>
        <Primary onClick={() => setConnectOpen(true)}>Connect wallet</Primary>
        <ConnectModal open={connectOpen} onClose={closeConnect} />
      </Card>
    );
  }
  if (!session) {
    return (
      <Card title="Sign in">
        <p className="text-sm text-ink-muted">
          Sign a message with {shortAddress(address)} to prove it is yours. It is free: a signature, not a transaction. You stay signed in on this
          browser for 7 days. Bridging and swapping never need this.
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
  return <SignedIn address={address} token={session.token} />;
}

function SignedIn({ address, token }: { address: `0x${string}`; token: string }) {
  const qc = useQueryClient();
  const meQ = useQuery({
    queryKey: ["me", address],
    queryFn: async () => {
      try {
        return await fetchMe(token);
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        throw e;
      }
    },
    retry: false,
  });
  const [leaving, setLeaving] = useState(false);

  async function doSignOut(everywhere: boolean) {
    setLeaving(true);
    try {
      await signOut(token, everywhere);
    } finally {
      clearSession();
      qc.removeQueries({ queryKey: ["me"] });
      qc.removeQueries({ queryKey: ["history"] });
      setLeaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-ink-muted">Confluence ID</span>
            <span className="truncate text-[26px] leading-8 font-medium">
              {meQ.data?.confluenceId ? `@${meQ.data.confluenceId}` : meQ.isPending ? "..." : "Not claimed"}
            </span>
            <span className="font-mono text-xs text-ink-muted">{address}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button type="button" onClick={() => void doSignOut(false)} disabled={leaving} className="text-[13px] text-action-text hover:underline">
              Sign out
            </button>
            <button type="button" onClick={() => void doSignOut(true)} disabled={leaving} className="text-xs text-ink-muted hover:text-danger">
              Sign out everywhere
            </button>
          </div>
        </div>
        {meQ.data && !meQ.data.confluenceId && <ClaimId token={token} onClaimed={() => void meQ.refetch()} />}
        {meQ.data?.idClaimedAt && (
          <p className="text-xs text-ink-muted">
            Claimed {new Date(meQ.data.idClaimedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}. Confluence IDs are
            permanent.
          </p>
        )}
      </Card>
      <RequestsCard token={token} />
      <SyncCard address={address} />
      <HistoryCard token={token} address={address} />
    </div>
  );
}

function ClaimId({ token, onClaimed }: { token: string; onClaimed: () => void }) {
  const [raw, setRaw] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  const debounced = useDebounced(handle, 400);
  const localOk = ID_RULE.test(handle) && !/^_|_$/.test(handle) && !handle.includes("__");
  const availQ = useQuery({
    queryKey: ["id-avail", debounced],
    queryFn: () => checkIdAvailability(debounced),
    enabled: !!debounced && ID_RULE.test(debounced),
    staleTime: 10_000,
  });
  const avail = debounced === handle ? availQ.data : undefined;
  useEffect(() => setConfirm(false), [handle]);

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      await claimConfluenceId(token, handle);
      onClaimed();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof SessionExpiredError ? "Your session ended. Sign in again." : "Could not claim. Try again.");
      if (e instanceof SessionExpiredError) clearSession();
    } finally {
      setBusy(false);
    }
  }

  const status = !handle
    ? "3 to 20 characters: letters, digits, underscore."
    : !localOk
      ? "Use 3 to 20 letters, digits or underscores (no leading, trailing or double underscore)."
      : !avail
        ? "Checking..."
        : avail.available
          ? `@${avail.handle} is available.`
          : `@${avail.handle}: ${avail.reason ?? "not available"}.`;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <label htmlFor="cid" className="text-sm font-medium">
        Claim your Confluence ID
      </label>
      <div className="flex items-center rounded-md border border-border-control bg-bg px-3 focus-within:border-action-text">
        <span className="text-ink-muted">@</span>
        <input
          id="cid"
          value={raw}
          onChange={(e) => setRaw(e.target.value.slice(0, 21))}
          autoComplete="off"
          spellCheck={false}
          placeholder="yourname"
          className="h-11 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
        />
      </div>
      <span className={`text-xs ${avail?.available ? "text-destination-text" : handle && (!localOk || avail) ? "text-danger" : "text-ink-muted"}`} aria-live="polite">
        {status}
      </span>
      {avail?.available && (
        <label className="flex items-start gap-2 rounded-md border border-warning bg-bg p-3 text-[13px]">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
          <span>
            I understand <span className="font-medium">@{avail.handle}</span> is permanent: it can never be changed or released, and people will be
            able to pay this wallet with it.
          </span>
        </label>
      )}
      {err && (
        <p role="alert" className="text-[13px] text-danger">
          {err}
        </p>
      )}
      <Primary onClick={() => void claim()} disabled={!avail?.available || !confirm || busy}>
        {busy ? "Claiming..." : avail?.available ? `Claim @${avail.handle}` : "Claim"}
      </Primary>
    </div>
  );
}

function SyncCard({ address }: { address: `0x${string}` }) {
  const book = useAddressBook(address);
  const [last, setLast] = useState<{ at: number; count: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setLast((e as CustomEvent<{ at: number; count: number }>).detail);
    window.addEventListener(SYNC_EVENT, on);
    return () => window.removeEventListener(SYNC_EVENT, on);
  }, []);
  return (
    <Card title="Address book">
      <p className="text-sm text-ink-muted">
        {book.saved.length} saved {book.saved.length === 1 ? "address" : "addresses"}, synced with your account while you are signed in, so they
        follow you to other browsers.
      </p>
      <p className="font-mono text-xs text-ink-muted" aria-live="polite">
        {last ? `Last synced ${new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Syncing..."}
      </p>
      <p className="text-xs text-ink-muted">
        Manage addresses from the recipient field on the{" "}
        <Link href="/" className="text-action-text">
          Bridge
        </Link>{" "}
        (Send to another address, Address book).
      </p>
    </Card>
  );
}

const STATE_LABEL: Record<string, string> = {
  COMPLETED: "Complete",
  FAILED: "Failed",
  RECOVERY_REQUIRED: "Needs attention",
  CREATED: "Not sent",
  SUBMITTED: "In progress",
};

function HistoryCard({ token, address }: { token: string; address: string }) {
  const { chains } = useBridgeChains();
  const nameOf = (id: string | null) => (id ? (chains.find((c) => c.id === id)?.name ?? id) : "");
  const q = useInfiniteQuery({
    queryKey: ["history", address],
    queryFn: async ({ pageParam }) => {
      try {
        return await fetchHistory(token, pageParam ?? undefined);
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        throw e;
      }
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card title="History">
      {q.isPending && <p className="text-sm text-ink-muted">Loading...</p>}
      {q.isError && <p className="text-sm text-danger">Could not load your history.</p>}
      {!q.isPending && items.length === 0 && !q.isError && (
        <p className="text-sm text-ink-muted">No bridges or swaps from this wallet yet.</p>
      )}
      <ul className="flex flex-col">
        {items.map((it) => (
          <HistoryRow key={`${it.kind}-${it.id}`} it={it} nameOf={nameOf} chains={chains} />
        ))}
      </ul>
      {q.hasNextPage && (
        <button
          type="button"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          className="h-10 rounded-md border border-border-control text-sm font-medium hover:border-action-text"
        >
          {q.isFetchingNextPage ? "Loading..." : "Load more"}
        </button>
      )}
    </Card>
  );
}

function HistoryRow({
  it,
  nameOf,
  chains,
}: {
  it: HistoryItem;
  nameOf: (id: string | null) => string;
  chains: ReturnType<typeof useBridgeChains>["chains"];
}) {
  const label = STATE_LABEL[it.state] ?? it.state.replace(/_/g, " ").toLowerCase();
  const tone = it.state === "COMPLETED" ? "text-destination-text" : it.state === "FAILED" || it.state === "CREATED" ? "text-ink-muted" : it.state === "RECOVERY_REQUIRED" ? "text-warning" : "text-action-text";
  const when = new Date(it.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const route = it.destinationChain && it.destinationChain !== it.sourceChain ? `${nameOf(it.sourceChain)} → ${nameOf(it.destinationChain)}` : nameOf(it.sourceChain);
  // Stage 8a: incoming payments and payments to a Confluence ID.
  const who = it.counterpartyId ? `@${it.counterpartyId}` : it.counterparty ? shortAddress(it.counterparty) : null;
  const title =
    it.kind === "bridge"
      ? it.direction === "in"
        ? `Received ${it.amountIn} USDC${who ? ` from ${who}` : ""}`
        : `Bridge ${it.amountIn} USDC${who ? ` to ${who}` : ""}`
      : `Swap ${it.amountIn} ${it.tokenIn} → ${it.amountOut ? `${it.amountOut} ` : ""}${it.tokenOut}`;
  const src = chains.find((c) => c.id === it.sourceChain);
  const href = it.kind === "bridge" ? `/tx/${it.id}` : it.txHash && src ? src.explorerTxUrl.replace("{hash}", it.txHash) : undefined;
  const inner = (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-ink-muted">
          {route} · {when}
        </span>
      </div>
      <span className={`shrink-0 font-mono text-xs ${tone}`}>{label}</span>
    </div>
  );
  return (
    <li className="border-b border-border last:border-b-0">
      {href ? (
        it.kind === "bridge" ? (
          <Link href={href} className="block hover:bg-bg">
            {inner}
          </Link>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer" className="block hover:bg-bg">
            {inner}
          </a>
        )
      ) : (
        inner
      )}
    </li>
  );
}
