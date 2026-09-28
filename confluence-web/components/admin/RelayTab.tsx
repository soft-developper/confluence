"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AdminApiError, adminFetch } from "@/lib/adminApi";
import { Btn, ErrorText, Field, inputCls, Panel, Stat } from "./ui";

/**
 * Admin: Relay routes (R4). Turn Relay on or off, set Confluence's app fee in basis points,
 * and see volume, quoted vs paid app fees, the accrued balance at Relay, and recent requests.
 * (confluence:relay-admin-tab)
 */
interface RelaySettingsRes {
  settings: { enabled: boolean; appFeeBps: number };
  updatedAt: string | null;
  updatedBy: string | null;
  maxAppFeeBps: number;
  appFeeRecipient: string | null;
}
interface Win {
  requests: number;
  success: number;
  volumeUsd: number;
  appFeeQuotedUsd: number;
  appFeePaidUsd: number;
}
interface RelayOverview {
  windows: { d1: Win; d7: Win; d30: Win };
  byStatus: Record<string, number>;
  uncollected: { requestId: string; symbolIn: string; symbolOut: string; origin: string | null; destination: string | null; bps: number; quotedUsd: string | null; createdAt: string }[];
  recent: { requestId: string; user: string; route: string; pair: string; status: string; amountInUsd: string | null; appFeeBps: number; appFeeQuotedUsd: string | null; appFeePaidUsd: string | null; createdAt: string }[];
  balance: { totalBalanceUsd: number | null; availableBalanceUsd: number | null; items: { symbol: string; chainId: number | null; amount: string; amountUsd: string | null }[] } | { error: string } | null;
  claimUrl: string;
  recipient: string | null;
  configured: boolean;
}

const money = (v: number | string | null | undefined) => {
  const x = Number(v ?? 0);
  return `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: x > 0 && x < 1 ? 4 : 2 })}`;
};
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);
const errText = (e: unknown) => (e instanceof AdminApiError ? e.message : "Could not reach the API.");

export function RelayTab() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["admin-relay"], queryFn: () => adminFetch<RelaySettingsRes>("/admin/relay") });
  const o = useQuery({ queryKey: ["admin-relay-overview"], queryFn: () => adminFetch<RelayOverview>("/admin/relay/overview"), staleTime: 30_000 });
  const [win, setWin] = useState<"d1" | "d7" | "d30">("d7");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-relay"] });
    void qc.invalidateQueries({ queryKey: ["admin-relay-overview"] });
  };
  const w = o.data?.windows[win];
  const bal = o.data?.balance;

  return (
    <div className="flex flex-col gap-4">
      {s.isError && <ErrorText>{errText(s.error)}</ErrorText>}
      {s.data && <SettingsCard data={s.data} configured={o.data?.configured ?? true} onSaved={refresh} />}

      <Panel
        title="Relay activity"
        actions={
          <div className="flex gap-1">
            {(["d1", "d7", "d30"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setWin(k)}
                aria-pressed={win === k}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${win === k ? "bg-bg text-ink" : "text-ink-muted hover:text-ink"}`}
              >
                {k === "d1" ? "24h" : k === "d7" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
        }
      >
        {o.isError && <ErrorText>{errText(o.error)}</ErrorText>}
        {w && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Requests" value={w.requests.toLocaleString()} sub={`${w.success.toLocaleString()} completed`} />
            <Stat label="Volume (completed)" value={money(w.volumeUsd)} />
            <Stat label="App fee quoted" value={money(w.appFeeQuotedUsd)} />
            <Stat label="App fee paid (Relay)" value={money(w.appFeePaidUsd)} sub="from Relay's records" />
          </div>
        )}
        {o.data && Object.keys(o.data.byStatus).length > 0 && (
          <p className="font-mono text-xs text-ink-muted">
            All time: {Object.entries(o.data.byStatus).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </p>
        )}
        {o.data && o.data.uncollected.length > 0 && (
          <div role="alert" className="flex flex-col gap-1 rounded-md border border-warning bg-bg p-3 text-[13px]">
            <span className="font-medium">
              {o.data.uncollected.length} completed request{o.data.uncollected.length === 1 ? "" : "s"} had an app fee set but Relay recorded none paid.
            </span>
            <span className="text-ink-muted">
              Relay&rsquo;s docs note that unsupported routes don&rsquo;t error, they just don&rsquo;t collect (for example small same-chain swaps where the
              fee is under $0.025). Routes: {o.data.uncollected.slice(0, 5).map((u) => `${u.symbolIn}→${u.symbolOut} (${u.origin ?? "?"} → ${u.destination ?? "?"})`).join(", ")}
            </span>
          </div>
        )}
      </Panel>

      <Panel title="App fee balance at Relay" actions={<Btn kind="secondary" onClick={() => void o.refetch()} disabled={o.isFetching}>{o.isFetching ? "Reading..." : "Refresh"}</Btn>}>
        <p className="text-xs text-ink-muted">
          App fees accrue in USDC at Relay, not in a wallet. Claim them with the fee recipient{o.data?.recipient ? ` (${short(o.data.recipient)})` : ""}: free on
          Base, and the Relay app supports claiming with a multisig.
        </p>
        {bal && "error" in bal && <ErrorText>{bal.error}</ErrorText>}
        {bal && !("error" in bal) && (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total balance" value={money(bal.totalBalanceUsd)} />
            <Stat label="Available to claim" value={money(bal.availableBalanceUsd)} />
          </div>
        )}
        {!bal && o.data && <p className="text-sm text-ink-muted">{o.data.recipient ? "Relay is not configured." : "No fee recipient is set for Base."}</p>}
        <a href={o.data?.claimUrl ?? "https://relay.link/claim-app-fees"} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-action-text">
          Claim in the Relay app
        </a>
      </Panel>

      <Panel title="Recent Relay requests">
        {o.data && o.data.recent.length === 0 && <p className="text-sm text-ink-muted">No Relay requests yet.</p>}
        {o.data && o.data.recent.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 font-medium">When</th>
                  <th className="py-1 font-medium">Wallet</th>
                  <th className="py-1 font-medium">Route</th>
                  <th className="py-1 font-medium">Pair</th>
                  <th className="py-1 text-right font-medium">Value</th>
                  <th className="py-1 text-right font-medium">Fee quoted / paid</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {o.data.recent.map((r) => (
                  <tr key={r.requestId} className="border-t border-border">
                    <td className="py-1.5 text-xs">{new Date(r.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                    <td className="py-1.5 font-mono text-xs">{short(r.user)}</td>
                    <td className="py-1.5 text-xs">{r.route}</td>
                    <td className="py-1.5 text-xs">{r.pair}</td>
                    <td className="tnum py-1.5 text-right font-mono text-xs">{r.amountInUsd ? money(r.amountInUsd) : "-"}</td>
                    <td className="tnum py-1.5 text-right font-mono text-xs">
                      {r.appFeeQuotedUsd ? money(r.appFeeQuotedUsd) : "-"} / {r.appFeePaidUsd !== null ? money(r.appFeePaidUsd) : "-"}
                    </td>
                    <td className="py-1.5 font-mono text-xs">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function SettingsCard({ data, configured, onSaved }: { data: RelaySettingsRes; configured: boolean; onSaved: () => void }) {
  const [bps, setBps] = useState(String(data.settings.appFeeBps));
  const [confirm, setConfirm] = useState<null | "toggle" | "fee">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setBps(String(data.settings.appFeeBps)), [data.settings.appFeeBps]);
  const parsed = /^\d{1,3}$/.test(bps) ? Number(bps) : NaN;
  const bpsValid = Number.isInteger(parsed) && parsed >= 0 && parsed <= data.maxAppFeeBps;
  const on = data.settings.enabled;

  async function save(body: { enabled?: boolean; appFeeBps?: number }) {
    setBusy(true);
    setErr(null);
    try {
      await adminFetch("/admin/relay", { method: "PUT", body });
      setConfirm(null);
      onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Relay routes"
      actions={
        <span className={`rounded-[4px] border px-2 py-0.5 font-mono text-xs ${on ? "border-destination text-destination-text" : "border-warning text-warning"}`}>{on ? "ON" : "OFF"}</span>
      }
    >
      <p className="text-sm text-ink-muted">
        When Relay is off, the Confluence | Relay toggle disappears and new Relay quotes are refused. Relay requests already in progress keep being tracked.
      </p>
      {!configured && <ErrorText>The API has no RELAY_API_KEY, so Relay stays unavailable whatever this switch says.</ErrorText>}
      <div className="flex flex-wrap items-center gap-2">
        {confirm === "toggle" ? (
          <>
            <span className="text-[13px] text-warning">Turn Relay {on ? "off" : "on"} for everyone?</span>
            <Btn kind={on ? "danger" : "primary"} onClick={() => void save({ enabled: !on })} disabled={busy}>
              {busy ? "Saving..." : `Yes, turn it ${on ? "off" : "on"}`}
            </Btn>
            <Btn kind="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Btn>
          </>
        ) : (
          <Btn kind={on ? "danger" : "primary"} onClick={() => setConfirm("toggle")}>
            Turn Relay {on ? "off" : "on"}
          </Btn>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Field
          label="Confluence app fee (basis points of the input value)"
          hint={`0 to ${data.maxAppFeeBps}. 10 bps = 0.10%. 0 charges no app fee (Relay's own fees still apply). Paid to ${data.appFeeRecipient ? short(data.appFeeRecipient) : "the Base fee recipient"}.`}
        >
          <div className="flex items-center gap-3">
            <input className={`${inputCls} w-28`} inputMode="numeric" value={bps} onChange={(e) => setBps(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label="App fee in basis points" />
            <span className="tnum font-mono text-sm text-ink-muted">{bpsValid ? `= ${(parsed / 100).toFixed(2)}%` : "enter a whole number"}</span>
          </div>
        </Field>
        {confirm === "fee" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-warning">
              Change the app fee from {data.settings.appFeeBps} to {parsed} bps? It applies to new quotes right away.
            </span>
            <Btn onClick={() => void save({ appFeeBps: parsed })} disabled={busy}>
              {busy ? "Saving..." : "Yes, change it"}
            </Btn>
            <Btn kind="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Btn>
          </div>
        ) : (
          <div>
            <Btn onClick={() => setConfirm("fee")} disabled={!bpsValid || parsed === data.settings.appFeeBps}>
              Save app fee
            </Btn>
          </div>
        )}
      </div>
      <ErrorText>{err}</ErrorText>
      {data.updatedAt && (
        <p className="text-xs text-ink-muted">
          Last changed {new Date(data.updatedAt).toLocaleString()} by {data.updatedBy}. You get a security email for every change.
        </p>
      )}
    </Panel>
  );
}
