"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pager } from "@/components/Pager";
import { AdminApiError, adminFetch } from "@/lib/adminApi";
import { fetchChains } from "@/lib/chains";
import { Btn, ErrorText, inputCls, Panel, Stat } from "./ui";

/**
 * Admin: Pay by Confluence ID (confluence:admin-pay). Arc to Arc payments (free) and
 * payments to an ID from another chain (bridge transfers). Stats by window, what needs a
 * look (fee_unpaid, a paid fee waiting to be finished, reports the tracker hasn't proven),
 * and a searchable list. Notes are private to the two sides and never shown here.
 */

interface WindowStats {
  arc: { completed: number; volume: string; free: number; feesCollected: string; senders: number; recipients: number };
  crossChain: { completed: number; volume: string; fees: string; senders: number };
  idsClaimed: number;
}
interface Attention {
  id: string;
  chain: string;
  state: string;
  errorCode: string | null;
  reason: string;
  sender: string;
  recipientId: string;
  amount: string;
  fee: string;
  feeTxHash: string | null;
  payTxHash: string | null;
  createdAt: string;
  updatedAt: string;
}
interface PayOverview {
  windows: { d1: WindowStats; d7: WindowStats; d30: WindowStats; all: WindowStats };
  byState: Record<string, number>;
  idsTotal: number;
  savedIdsTotal: number;
  attention: Attention[];
  attentionCounts: { feeUnpaid: number; waitingToFinish: number; notProven: number };
}
interface PayItem {
  id: string;
  state: string;
  errorCode: string | null;
  chain: string;
  sender: string;
  recipient: string;
  recipientId: string;
  amount: string;
  fee: string;
  free: boolean;
  feeTxHash: string | null;
  payTxHash: string | null;
  feeVerified: boolean;
  paymentVerified: boolean;
  createdAt: string;
  updatedAt: string;
}
interface PayPage {
  items: PayItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const STATES = ["CREATED", "FEE_SUBMITTED", "FEE_PAID", "PAYMENT_SUBMITTED", "COMPLETED", "FAILED", "EXPIRED"] as const;
const WINDOWS = [
  ["d1", "24h"],
  ["d7", "7 days"],
  ["d30", "30 days"],
  ["all", "All time"],
] as const;
type Win = (typeof WINDOWS)[number][0];

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);
const errText = (e: unknown) => (e instanceof AdminApiError ? e.message : "Could not reach the API.");
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const amt = (v: string) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;

/** Arc explorer link for a transaction, from the public chain list (same cache as the other tabs). */
function useArcTx() {
  const q = useQuery({ queryKey: ["admin-chains"], queryFn: () => fetchChains(), staleTime: 10 * 60_000 });
  return (chain: string, hash: string | null) => {
    const c = q.data?.chains.find((x) => x.id === chain);
    return c && hash ? c.explorerTxUrl.replace("{hash}", hash) : undefined;
  };
}

function TxLink({ href, hash, text }: { href: string | undefined; hash: string | null; text: string }) {
  if (!hash) return null;
  if (!href) {
    return (
      <span className="font-mono text-ink-muted" title={hash}>
        {text} {hash.slice(0, 10)}...
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-action-text hover:underline">
      {text} ↗
    </a>
  );
}

export function PayTab() {
  const o = useQuery({ queryKey: ["admin-pay-overview"], queryFn: () => adminFetch<PayOverview>("/admin/pay/overview"), staleTime: 30_000 });
  const [win, setWin] = useState<Win>("d7");
  const w = o.data?.windows[win];
  const c = o.data?.attentionCounts;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Pay by Confluence ID"
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {WINDOWS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setWin(k)}
                aria-pressed={win === k}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${win === k ? "bg-bg text-ink" : "text-ink-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
            <Btn kind="secondary" onClick={() => void o.refetch()} disabled={o.isFetching}>
              {o.isFetching ? "Refreshing..." : "Refresh"}
            </Btn>
          </div>
        }
      >
        {o.isError && <ErrorText>{errText(o.error)}</ErrorText>}
        {w && (
          <>
            <span className="text-xs font-medium text-ink-muted">On Arc (free)</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Payments completed" value={w.arc.completed.toLocaleString()} sub={`${w.arc.free.toLocaleString()} free`} />
              <Stat label="Volume" value={amt(w.arc.volume)} />
              <Stat label="Senders / recipients" value={`${w.arc.senders} / ${w.arc.recipients}`} sub="distinct wallets / IDs" />
              <Stat label="Fees collected" value={amt(w.arc.feesCollected)} sub="older payments, before free" />
            </div>
            <span className="text-xs font-medium text-ink-muted">From other chains (bridge fee applies)</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Payments completed" value={w.crossChain.completed.toLocaleString()} />
              <Stat label="Volume" value={amt(w.crossChain.volume)} />
              <Stat label="Senders" value={w.crossChain.senders.toLocaleString()} sub="distinct wallets" />
              <Stat label="Bridge fees" value={amt(w.crossChain.fees)} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="IDs claimed" value={w.idsClaimed.toLocaleString()} sub={`${o.data!.idsTotal.toLocaleString()} in total`} />
              <Stat label="Saved IDs" value={o.data!.savedIdsTotal.toLocaleString()} sub="bookmarks, all users" />
            </div>
          </>
        )}
        {o.data && Object.keys(o.data.byState).length > 0 && (
          <p className="font-mono text-xs text-ink-muted">
            Arc payments, all time: {STATES.filter((s) => o.data!.byState[s]).map((s) => `${s} ${o.data!.byState[s]}`).join(" · ")}
          </p>
        )}
      </Panel>

      <Panel title={`Needs a look${o.data ? ` (${o.data.attention.length})` : ""}`}>
        {c && (
          <p className="font-mono text-xs text-ink-muted">
            fee_unpaid {c.feeUnpaid} · fee paid, waiting to finish {c.waitingToFinish} · not proven {c.notProven}
          </p>
        )}
        {o.data && o.data.attention.length === 0 && <p className="text-sm text-ink-muted">Nothing needs a look.</p>}
        {o.data && o.data.attention.length > 0 && <AttentionList items={o.data.attention} />}
      </Panel>

      <PaymentsList />
    </div>
  );
}

function AttentionList({ items }: { items: Attention[] }) {
  const tx = useArcTx();
  return (
    <ul className="flex flex-col">
      {items.map((a) => (
        <li key={a.id} className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-sm">
              {amt(a.amount)} to @{a.recipientId} <span className="font-mono text-xs text-ink-muted">from {short(a.sender)}</span>
            </span>
            <span className={`font-mono text-xs ${a.state === "COMPLETED" ? "text-ink-muted" : "text-warning"}`}>
              {a.state}
              {a.errorCode ? ` · ${a.errorCode}` : ""}
            </span>
          </div>
          <span className="text-[13px] text-ink-muted">{a.reason}</span>
          <span className="flex flex-wrap gap-x-3 text-xs">
            <span className="font-mono text-ink-muted" title={a.id}>
              {a.id.slice(0, 8)} · created {when(a.createdAt)} · updated {when(a.updatedAt)}
            </span>
            <TxLink href={tx(a.chain, a.feeTxHash)} hash={a.feeTxHash} text="Fee tx" />
            <TxLink href={tx(a.chain, a.payTxHash)} hash={a.payTxHash} text="Payment tx" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function PaymentsList() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const tx = useArcTx();
  const params = new URLSearchParams({ page: String(page) });
  if (applied) params.set("q", applied);
  if (state) params.set("state", state);
  const list = useQuery({
    queryKey: ["admin-pay-payments", applied, state, page],
    queryFn: () => adminFetch<PayPage>(`/admin/pay/payments?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  return (
    <Panel
      title="Arc payments"
      actions={
        <Btn kind="secondary" onClick={() => void list.refetch()} disabled={list.isFetching}>
          {list.isFetching ? "Refreshing..." : "Refresh"}
        </Btn>
      }
    >
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q.trim());
          setPage(1);
        }}
      >
        <input className={`${inputCls} max-w-[420px] flex-1`} placeholder="Search @id, wallet, tx hash or payment id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select
          className={`${inputCls.replace("w-full", "")} w-auto`}
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          aria-label="State"
        >
          <option value="">All states</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Btn type="submit" kind="secondary">
          Search
        </Btn>
      </form>
      {list.isError && <ErrorText>{errText(list.error)}</ErrorText>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium">Payment</th>
              <th className="py-1 font-medium">From</th>
              <th className="py-1 pr-6 text-right font-medium">Fee</th>
              <th className="py-1 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className="border-t border-border align-top">
                <td className="py-1.5 font-mono text-xs whitespace-nowrap text-ink-muted">{when(x.createdAt)}</td>
                <td className="py-1.5">
                  <span>
                    {amt(x.amount)} to @{x.recipientId}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    <span className="font-mono text-ink-muted" title={x.id}>
                      {x.id.slice(0, 8)}
                    </span>
                    <TxLink href={tx(x.chain, x.feeTxHash)} hash={x.feeTxHash} text={`Fee tx${x.feeVerified ? " ✓" : ""}`} />
                    <TxLink href={tx(x.chain, x.payTxHash)} hash={x.payTxHash} text={`Payment tx${x.paymentVerified ? " ✓" : ""}`} />
                  </span>
                </td>
                <td className="py-1.5 font-mono text-xs">{short(x.sender)}</td>
                <td className="tnum py-1.5 pr-6 text-right font-mono text-xs">{x.free ? "free" : x.fee}</td>
                <td className="py-1.5 font-mono text-xs">
                  {x.state}
                  {x.errorCode && <span className="block text-warning">{x.errorCode}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.isPending && items.length === 0 && <p className="text-sm text-ink-muted">Nothing found.</p>}
      {list.data && (
        <Pager page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} busy={list.isFetching} />
      )}
    </Panel>
  );
}
