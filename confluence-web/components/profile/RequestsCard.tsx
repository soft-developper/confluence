"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ApiError, cancelPaymentRequest, createPaymentRequest, fetchMyRequests, SessionExpiredError, type PaymentRequest } from "@/lib/api";
import { clearSession } from "@/lib/session";
import { useBridgeChains } from "@/components/Providers";
import { StatusChip } from "@/components/pay/PayCard";
import { fmtUsdc } from "@/components/bridge/ReviewPanel";

const AMOUNT = /^\d{0,7}(\.\d{0,6})?$/;
const EXPIRY_DAYS = [7, 30, 90] as const;

/** Stage 8b: create payment requests and manage them (copy link, cancel). */
export function RequestsCard({ token }: { token: string }) {
  const { chains } = useBridgeChains();
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState<string>(chains.find((c) => /arc/i.test(c.id))?.id ?? chains[0]?.id ?? "");
  const [memo, setMemo] = useState("");
  const [days, setDays] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["my-requests", token],
    queryFn: async () => {
      try {
        return await fetchMyRequests(token);
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        throw e;
      }
    },
    refetchInterval: 30_000,
  });

  const valid = Number(amount) >= 1 && Number(amount) <= 1_000_000 && !!dest;

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await createPaymentRequest(token, { destinationChain: dest, amount, ...(memo.trim() ? { memo } : {}), expiresInDays: days });
      setAmount("");
      setMemo("");
      await listQ.refetch();
      await copy(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof SessionExpiredError ? "Your session ended. Sign in again." : "Could not create the request.");
      if (e instanceof SessionExpiredError) clearSession();
    } finally {
      setBusy(false);
    }
  }

  async function copy(r: PaymentRequest) {
    const url = `${window.location.origin}/pay/${r.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(r.id);
      setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  async function cancel(id: string) {
    try {
      await cancelPaymentRequest(token, id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not cancel.");
    }
    setConfirmCancel(null);
    await listQ.refetch();
  }

  const nameOf = (id: string) => chains.find((c) => c.id === id)?.name ?? id;
  const inputCls = "h-10 rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text";

  return (
    <section className="flex w-full max-w-[560px] flex-col gap-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-medium">Payment requests</h2>
      <p className="text-sm text-ink-muted">
        Create a link for someone to pay you. They choose where their USDC comes from; you receive the full amount on the chain you pick. Each link is
        paid once.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Amount (USDC)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => AMOUNT.test(e.target.value) && setAmount(e.target.value)}
            placeholder="25"
            className={`${inputCls} tnum`}
            aria-label="Request amount in USDC"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Receive on
          <select value={dest} onChange={(e) => setDest(e.target.value)} className={inputCls} aria-label="Receive on chain">
            {chains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-ink-muted">
          What it is for (optional)
          <input value={memo} onChange={(e) => setMemo(e.target.value.slice(0, 140))} placeholder="Logo design" className={inputCls} aria-label="Memo" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Expires after
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls} aria-label="Expiry">
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void create()}
            disabled={!valid || busy}
            className="h-10 w-full rounded-md bg-action text-sm font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Creating..." : "Create and copy link"}
          </button>
        </div>
      </div>
      {amount && Number(amount) < 1 && <p className="text-xs text-ink-muted">Requests start at 1 USDC.</p>}
      {err && (
        <p role="alert" className="text-[13px] text-danger">
          {err}
        </p>
      )}

      {listQ.data && listQ.data.length > 0 && (
        <ul className="flex flex-col border-t border-border">
          {listQ.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <span className="tnum text-sm font-medium">
                  {fmtUsdc(r.amount.usdc)} USDC <span className="font-normal text-ink-muted">on {nameOf(r.destinationChain)}</span>
                </span>
                <StatusChip status={r.status} />
              </div>
              {r.memo && <span className="truncate text-xs text-ink-muted">{r.memo}</span>}
              <div className="flex items-center gap-4 text-[13px]">
                <Link href={`/pay/${r.id}`} className="text-action-text">
                  Open
                </Link>
                {r.status === "open" && (
                  <button type="button" onClick={() => void copy(r)} className="text-action-text">
                    {copied === r.id ? "Copied" : "Copy link"}
                  </button>
                )}
                {r.status === "paid" && r.paidTransferId && (
                  <Link href={`/tx/${r.paidTransferId}`} className="text-action-text">
                    View payment
                  </Link>
                )}
                {r.status === "open" &&
                  (confirmCancel === r.id ? (
                    <button type="button" onClick={() => void cancel(r.id)} className="font-medium text-danger">
                      Confirm cancel
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmCancel(r.id)} className="text-ink-muted hover:text-danger">
                      Cancel
                    </button>
                  ))}
                <span className="ml-auto text-xs text-ink-muted">
                  {r.status === "open" ? `Expires ${new Date(r.expiresAt).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
