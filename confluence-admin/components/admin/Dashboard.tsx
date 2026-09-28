"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { fetchChains } from "@/lib/chains";
import {
  AdminApiError,
  adminFetch,
  type ActivityItem,
  type FooterSettings,
  type Maintenance,
  type Overview,
  type Problem,
  type Routes,
  type Series,
  type SwitchState,
  type Treasury,
} from "@/lib/adminApi";
import { Bars, Btn, ErrorText, Field, inputCls, Panel, Stat } from "./ui";
import { Pager, paginate } from "@/components/Pager";
import { RelayTab } from "./RelayTab";

const TABS = ["Overview", "Activity", "Problems", "Treasury", "Chains", "Relay", "Maintenance", "Footer", "Account"] as const;
type Tab = (typeof TABS)[number];

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const n = (v: number) => v.toLocaleString();
const usd = (s: string) => Number(s).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);
const errText = (e: unknown) => (e instanceof AdminApiError ? e.message : "Could not reach the API.");

function useChainNames() {
  const q = useQuery({ queryKey: ["admin-chains"], queryFn: () => fetchChains(), staleTime: 10 * 60_000 });
  const chains = q.data?.chains ?? [];
  return {
    name: (id: string | null) => (id ? (chains.find((c) => c.id === id)?.name ?? id) : ""),
    tx: (id: string, hash: string | null) => {
      const c = chains.find((x) => x.id === id);
      return c && hash ? c.explorerTxUrl.replace("{hash}", hash) : undefined;
    },
  };
}

export function Dashboard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const problemsQ = useQuery({ queryKey: ["admin-problems"], queryFn: () => adminFetch<{ items: Problem[] }>("/admin/problems"), refetchInterval: 60_000 });
  const count = problemsQ.data?.items.length ?? 0;
  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-4">
      {/* Section tabs lock under the admin header (h-16) as one bar while scrolling. */}
      <div className="sticky top-16 z-30 -mx-4 -mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:-mx-6 sm:px-6">
        <nav aria-label="Admin sections" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-surface text-ink" : "text-ink-muted hover:text-ink"}`}
            >
              {t}
              {t === "Problems" && count > 0 && <span className="ml-1.5 rounded-full bg-warning px-1.5 font-mono text-[11px] text-bg">{count}</span>}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          <span>{email}</span>
          <button type="button" onClick={onSignOut} className="text-action-text hover:underline">
            Sign out
          </button>
        </div>
      </div>
      {tab === "Overview" && <OverviewTab />}
      {tab === "Activity" && <ActivityTab />}
      {tab === "Problems" && <ProblemsTab items={problemsQ.data?.items} loading={problemsQ.isPending} />}
      {tab === "Treasury" && <TreasuryTab />}
      {tab === "Chains" && <ChainsTab />}
      {tab === "Relay" && <RelayTab />}
      {tab === "Maintenance" && <MaintenanceTab />}
      {tab === "Footer" && <FooterTab />}
      {tab === "Account" && <AccountTab />}
    </div>
  );
}

// ---------- overview, charts, routes ----------

function OverviewTab() {
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "all">("7d");
  const [chartRange, setChartRange] = useState<"7d" | "30d" | "90d">("30d");
  const { name } = useChainNames();
  const o = useQuery({ queryKey: ["admin-overview", range], queryFn: () => adminFetch<Overview>(`/admin/analytics/overview?range=${range}`) });
  const s = useQuery({ queryKey: ["admin-series", chartRange], queryFn: () => adminFetch<Series>(`/admin/analytics/timeseries?range=${chartRange}`) });
  const r = useQuery({ queryKey: ["admin-routes", range], queryFn: () => adminFetch<Routes>(`/admin/analytics/routes?range=${range}`) });
  const d = o.data;
  const Seg = <T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: readonly T[] }) => (
    <div className="flex gap-1" role="radiogroup">
      {options.map((x) => (
        <button
          key={x}
          type="button"
          role="radio"
          aria-checked={value === x}
          onClick={() => set(x)}
          className={`rounded-[4px] border px-2 py-0.5 font-mono text-xs ${value === x ? "border-action text-action-text" : "border-border-control text-ink-muted"}`}
        >
          {x}
        </button>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Bridge" actions={<Seg value={range} set={setRange} options={["24h", "7d", "30d", "all"] as const} />}>
        {o.isError && <ErrorText>{errText(o.error)}</ErrorText>}
        {d && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Transfers" value={n(d.bridge.total)} sub={`${n(d.bridge.inProgress)} in progress`} />
            <Stat label="Volume (completed)" value={`${usd(d.bridge.volume.usdc)} USDC`} />
            <Stat label="Platform fees" value={`${usd(d.bridge.platformFees.usdc)} USDC`} />
            <Stat label="Success rate" value={pct(d.bridge.successRate)} sub={`${n(d.bridge.failed)} failed, ${n(d.bridge.needsRecovery)} need recovery`} />
          </div>
        )}
      </Panel>
      <Panel title="Swap">
        {d && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Swaps" value={n(d.swap.total)} sub={`${n(d.swap.inProgress)} in progress`} />
              <Stat label="Completed" value={n(d.swap.completed)} />
              <Stat label="Failed" value={n(d.swap.failed)} />
              <Stat label="Success rate" value={pct(d.swap.successRate)} />
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-xs text-ink-muted">Volume by token (completed)</span>
                {d.swap.volumeByToken.length === 0 && <p className="text-ink-muted">No swaps yet.</p>}
                {d.swap.volumeByToken.map((v) => (
                  <p key={v.token} className="tnum font-mono text-[13px]">
                    {usd(String(v.volume))} {v.token} <span className="text-ink-muted">({v.swaps} swaps)</span>
                  </p>
                ))}
              </div>
              <div>
                <span className="text-xs text-ink-muted">Fees by token (as charged by Circle)</span>
                {d.swap.feesByToken.map((v) => (
                  <p key={v.token} className="tnum font-mono text-[13px]">
                    {usd(String(v.fees))} {v.token}
                  </p>
                ))}
              </div>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Daily activity (UTC)" actions={<Seg value={chartRange} set={setChartRange} options={["7d", "30d", "90d"] as const} />}>
        {s.data && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <span className="text-xs text-ink-muted">Bridge volume (USDC)</span>
              <Bars data={s.data.days.map((x) => ({ label: x.day, value: Number(x.bridgeVolume.usdc) }))} format={(v) => `${usd(String(v))} USDC`} />
            </div>
            <div>
              <span className="text-xs text-ink-muted">Bridge fees (USDC)</span>
              <Bars data={s.data.days.map((x) => ({ label: x.day, value: Number(x.bridgeFees.usdc) }))} format={(v) => `${usd(String(v))} USDC`} color="bg-destination" />
            </div>
            <div>
              <span className="text-xs text-ink-muted">Transfers and swaps</span>
              <Bars data={s.data.days.map((x) => ({ label: x.day, value: x.bridges + x.swaps }))} format={(v) => n(v)} color="bg-source" />
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Top routes">
        {r.data && (
          <div className="grid gap-4 lg:grid-cols-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 font-medium">Bridge route</th>
                  <th className="py-1 text-right font-medium">Transfers</th>
                  <th className="py-1 text-right font-medium">Volume</th>
                </tr>
              </thead>
              <tbody>
                {r.data.bridgeRoutes.map((x) => (
                  <tr key={`${x.source}-${x.destination}`} className="border-t border-border">
                    <td className="py-1.5">
                      {name(x.source)} → {name(x.destination)}
                    </td>
                    <td className="tnum py-1.5 text-right font-mono">{n(x.count)}</td>
                    <td className="tnum py-1.5 text-right font-mono">{usd(x.volume.usdc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-ink-muted">Speed:</span> Fast {n(r.data.speed.FAST ?? 0)}, Standard {n(r.data.speed.SLOW ?? 0)}
              </p>
              <p>
                <span className="text-ink-muted">Forwarding:</span> on {n(r.data.forwarding.on)}, off {n(r.data.forwarding.off)}
              </p>
              <span className="mt-2 text-xs text-ink-muted">Top swap pairs</span>
              {r.data.swapPairs.map((x) => (
                <p key={`${x.chain}-${x.destination}-${x.tokenIn}-${x.tokenOut}`} className="font-mono text-[13px]">
                  {x.tokenIn} → {x.tokenOut} on {name(x.chain)}
                  {x.destination !== x.chain ? ` → ${name(x.destination)}` : ""} <span className="text-ink-muted">({n(x.count)})</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- activity ----------

function ActivityTab() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [kind, setKind] = useState<"" | "bridge" | "swap">("");
  const [page, setPage] = useState(1);
  const { name, tx } = useChainNames();
  const params = () => {
    const p = new URLSearchParams({ page: String(page) });
    if (applied) p.set("q", applied);
    if (kind) p.set("kind", kind);
    return p.toString();
  };
  const first = useQuery({
    queryKey: ["admin-activity", applied, kind, page],
    queryFn: () => adminFetch<{ items: ActivityItem[]; page: number; pageSize: number; total: number; totalPages: number }>(`/admin/activity?${params()}`),
    placeholderData: keepPreviousData,
  });
  const items = first.data?.items ?? [];
  return (
    <Panel title="Activity">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q.trim());
          setPage(1);
        }}
      >
        <input className={`${inputCls} max-w-[420px] flex-1`} placeholder="Search id, wallet, tx hash or @id" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={kind} onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setPage(1);
          }} aria-label="Kind">
          <option value="">Bridges and swaps</option>
          <option value="bridge">Bridges</option>
          <option value="swap">Swaps</option>
        </select>
        <Btn type="submit" kind="secondary">
          Search
        </Btn>
      </form>
      {first.isError && <ErrorText>{errText(first.error)}</ErrorText>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium">What</th>
              <th className="py-1 font-medium">Route</th>
              <th className="py-1 font-medium">Wallet</th>
              <th className="py-1 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => {
              const link = x.kind === "bridge" ? `/tx/${x.id}` : tx(x.source, x.txHash);
              return (
                <tr key={`${x.kind}-${x.id}`} className="border-t border-border align-top">
                  <td className="py-1.5 font-mono text-xs whitespace-nowrap text-ink-muted">{new Date(x.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                  <td className="py-1.5">
                    {link ? (
                      <a href={link} target={x.kind === "swap" ? "_blank" : undefined} rel="noopener noreferrer" className="text-action-text hover:underline">
                        {x.kind === "bridge" ? "Bridge" : "Swap"} {x.amount} {x.token}
                      </a>
                    ) : (
                      <span>
                        {x.kind === "bridge" ? "Bridge" : "Swap"} {x.amount} {x.token}
                      </span>
                    )}
                    {x.recipientId && <span className="text-ink-muted"> to @{x.recipientId}</span>}
                  </td>
                  <td className="py-1.5 text-xs">
                    {name(x.source)}
                    {x.destination && x.destination !== x.source ? ` → ${name(x.destination)}` : ""}
                  </td>
                  <td className="py-1.5 font-mono text-xs">{short(x.sender)}</td>
                  <td className="py-1.5 font-mono text-xs">
                    {x.state}
                    {x.errorCode && <span className="block text-warning">{x.errorCode}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!first.isPending && items.length === 0 && <p className="text-sm text-ink-muted">Nothing found.</p>}
      {first.data && (
        <Pager page={first.data.page} totalPages={first.data.totalPages} total={first.data.total} pageSize={first.data.pageSize} onPage={setPage} busy={first.isFetching} />
      )}
    </Panel>
  );
}

// ---------- problems ----------

function ProblemsTab({ items, loading }: { items: Problem[] | undefined; loading: boolean }) {
  const [page, setPage] = useState(1);
  const pg = paginate(items ?? [], page);
  return (
    <Panel title="Problem queue">
      <p className="text-xs text-ink-muted">Transfers and swaps that need attention. Refreshes every minute.</p>
      {loading && <p className="text-sm text-ink-muted">Loading...</p>}
      {items && items.length === 0 && <p className="text-sm text-destination-text">Nothing needs attention.</p>}
      <ul className="flex flex-col">
        {pg.slice.map((p) => (
          <li key={`${p.kind}-${p.id}`} className="flex flex-col gap-0.5 border-t border-border py-2 text-sm first:border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{p.reason}</span>
              <span className="font-mono text-xs text-ink-muted">{new Date(p.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
            </div>
            <span className="text-xs text-ink-muted">
              {p.kind === "bridge" ? "Bridge" : "Swap"} {p.amount}, {p.route}, from {short(p.sender)}, state {p.state}
              {p.kind === "bridge" && (
                <>
                  {" "}
                  <Link href={`/tx/${p.id}`} className="text-action-text hover:underline">
                    Open transaction page
                  </Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} onPage={setPage} />
    </Panel>
  );
}

// ---------- treasury ----------

function TreasuryTab() {
  const q = useQuery({ queryKey: ["admin-treasury"], queryFn: () => adminFetch<Treasury>("/admin/treasury"), staleTime: 60_000 });
  const t = q.data;
  const [page, setPage] = useState(1);
  const pg = paginate(t?.chains ?? [], page);
  return (
    <Panel title="Fee treasury" actions={<Btn kind="secondary" onClick={() => void q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Reading chains..." : "Refresh"}</Btn>}>
      <p className="text-xs text-ink-muted">Live USDC balance of the fee recipient on every chain, read from each chain, next to the fees our records say were earned there.</p>
      {q.isError && <ErrorText>{errText(q.error)}</ErrorText>}
      {t?.multisigWarning && (
        <p role="alert" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
          Fees above {usd(t.multisigWarningThreshold.usdc)} USDC are sitting in a plain wallet. Move the fee recipient to a multisig before volume grows.
        </p>
      )}
      {t && (
        <>
          <Stat label="Total across chains" value={`${usd(t.total.usdc)} USDC`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="py-1 font-medium">Chain</th>
                  <th className="py-1 font-medium">Fee recipient</th>
                  <th className="py-1 text-right font-medium">Balance</th>
                  <th className="py-1 text-right font-medium">Earned (records)</th>
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((c) => (
                  <tr key={c.chain} className="border-t border-border">
                    <td className="py-1.5">{c.name}</td>
                    <td className="py-1.5 font-mono text-xs">
                      {c.recipient ? short(c.recipient) : "none"}
                      {c.isContract === true && <span className="ml-1 text-destination-text">contract</span>}
                    </td>
                    <td className="tnum py-1.5 text-right font-mono">{c.balance ? usd(c.balance.usdc) : <span className="text-xs text-warning">{c.error}</span>}</td>
                    <td className="tnum py-1.5 text-right font-mono">{usd(c.earned.usdc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} onPage={setPage} />
          <p className="text-xs text-ink-muted">Sweeping fees to one place is a later step.</p>
        </>
      )}
    </Panel>
  );
}

// ---------- bridge chains ----------

interface AdminChain {
  id: string;
  name: string;
  evmChainId: number;
  cctpDomain: number;
  fast: boolean;
  forwarding: boolean;
  enabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  last30d: { asSource: number; asDestination: number };
  inFlight: number;
}

function ChainsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-chains-list"], queryFn: () => adminFetch<{ chains: AdminChain[] }>("/admin/chains") });
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const chains = q.data?.chains ?? [];
  const enabledCount = chains.filter((c) => c.enabled).length;
  const pg = paginate(chains, page);
  async function toggle(c: AdminChain) {
    setErr(null);
    try {
      await adminFetch(`/admin/chains/${encodeURIComponent(c.id)}`, { method: "PUT", body: { enabled: !c.enabled } });
      setConfirm(null);
      await qc.invalidateQueries({ queryKey: ["admin-chains-list"] });
    } catch (e) {
      setErr(errText(e));
    }
  }
  return (
    <Panel title="Bridge chains">
      <p className="text-sm text-ink-muted">
        Chains come from Circle App Kit automatically. Turning one off removes it from the Bridge (as source and destination) and the API refuses new
        transfers that use it. Transfers already in flight keep working, including their transaction pages and Complete mint. Changes reach users
        within about 30 seconds.
      </p>
      {enabledCount < 2 && chains.length > 0 && (
        <p role="alert" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
          Fewer than two chains are on, so nobody can bridge right now.
        </p>
      )}
      <ErrorText>{err}</ErrorText>
      {q.isError && <ErrorText>{errText(q.error)}</ErrorText>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1 font-medium">Chain</th>
              <th className="py-1 font-medium">Supports</th>
              <th className="py-1 text-right font-medium">Last 30 days (from / to)</th>
              <th className="py-1 text-right font-medium">In flight</th>
              <th className="py-1 text-right font-medium">Bridge</th>
            </tr>
          </thead>
          <tbody>
            {pg.slice.map((c) => (
              <tr key={c.id} className="border-t border-border align-middle">
                <td className="py-2">
                  <span className={c.enabled ? "" : "text-ink-muted line-through"}>{c.name}</span>
                  <span className="block font-mono text-[11px] text-ink-muted">
                    chain {c.evmChainId} · CCTP domain {c.cctpDomain}
                  </span>
                  {!c.enabled && c.disabledAt && (
                    <span className="block text-[11px] text-warning">
                      Off since {new Date(c.disabledAt).toLocaleString()} ({c.disabledBy})
                    </span>
                  )}
                </td>
                <td className="py-2 text-xs text-ink-muted">
                  {c.fast ? "Fast" : "Standard only"}
                  {c.forwarding ? ", forwarding" : ""}
                </td>
                <td className="tnum py-2 text-right font-mono text-xs">
                  {n(c.last30d.asSource)} / {n(c.last30d.asDestination)}
                </td>
                <td className="tnum py-2 text-right font-mono text-xs">{c.inFlight ? <span className="text-action-text">{n(c.inFlight)}</span> : "0"}</td>
                <td className="py-2 text-right">
                  {confirm === c.id ? (
                    <span className="inline-flex items-center gap-2">
                      <Btn kind={c.enabled ? "danger" : "primary"} onClick={() => void toggle(c)}>
                        {c.enabled ? "Yes, turn off" : "Yes, turn on"}
                      </Btn>
                      <Btn kind="secondary" onClick={() => setConfirm(null)}>
                        Cancel
                      </Btn>
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={c.enabled}
                      aria-label={`${c.name} ${c.enabled ? "on" : "off"}`}
                      onClick={() => setConfirm(c.id)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${c.enabled ? "bg-destination" : "bg-border-control"}`}
                    >
                      <span className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${c.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={pg.page} totalPages={pg.totalPages} total={pg.total} onPage={setPage} />
    </Panel>
  );
}

// ---------- maintenance ----------

function MaintenanceTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-maintenance"], queryFn: () => adminFetch<Maintenance>("/admin/maintenance") });
  const m = q.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Switching something off stops new bridges or swaps and shows your message to users. Transfers and swaps already in progress keep completing.
      </p>
      {q.isError && <ErrorText>{errText(q.error)}</ErrorText>}
      {m &&
        (["bridge", "swap", "all"] as const).map((scope) => (
          <SwitchCard key={scope} scope={scope} state={m.state[scope]} onSaved={() => void qc.invalidateQueries({ queryKey: ["admin-maintenance"] })} />
        ))}
      {m?.updatedAt && (
        <p className="text-xs text-ink-muted">
          Last changed {new Date(m.updatedAt).toLocaleString()} by {m.updatedBy}.
        </p>
      )}
      {m?.housekeeping && (
        <Panel title="Housekeeping">
          <p className="text-sm text-ink-muted">
            Failed bridges and swaps that never reached the chain are deleted {m.housekeeping.pruneAfterHours} hours after they fail, and quotes nobody
            used are deleted an hour after they expire, to keep the database small. Anything with a transaction, in progress, or needing recovery is
            always kept.
          </p>
          <p className="font-mono text-xs text-ink-muted">
            {m.housekeeping.lastRunAt
              ? `Last run ${new Date(m.housekeeping.lastRunAt).toLocaleString()}: removed ${m.housekeeping.lastRun.transfers} transfers, ${m.housekeeping.lastRun.swaps} swaps, ${m.housekeeping.lastRun.unusedQuotes.toLocaleString()} unused quotes. Total removed: ${m.housekeeping.totalPruned.transfers} transfers, ${m.housekeeping.totalPruned.swaps} swaps, ${m.housekeeping.totalPruned.unusedQuotes.toLocaleString()} unused quotes.`
              : "Not run yet (it runs about a minute after the API starts, then every hour)."}
          </p>
        </Panel>
      )}
    </div>
  );
}

function SwitchCard({ scope, state, onSaved }: { scope: "bridge" | "swap" | "all"; state: SwitchState; onSaved: () => void }) {
  const [message, setMessage] = useState(state.message ?? "");
  const [back, setBack] = useState(state.expectedBack ? state.expectedBack.slice(0, 16) : "");
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = scope === "all" ? "Everything (Bridge and Swap)" : scope === "bridge" ? "Bridge" : "Swap";
  async function save(offline: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await adminFetch("/admin/maintenance", {
        method: "PUT",
        body: { scope, offline, ...(offline && message.trim() ? { message: message.trim() } : {}), ...(offline && back ? { expectedBack: new Date(back).toISOString() } : {}) },
      });
      setConfirm(false);
      onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={label}
      actions={
        <span className={`rounded-[4px] border px-2 py-0.5 font-mono text-xs ${state.offline ? "border-warning text-warning" : "border-destination text-destination-text"}`}>
          {state.offline ? "OFFLINE" : "Online"}
        </span>
      }
    >
      {state.offline ? (
        <div className="flex flex-col gap-2 text-sm">
          {state.message && <p>Users see: &quot;{state.message}&quot;</p>}
          {state.expectedBack && <p className="text-ink-muted">Expected back: {new Date(state.expectedBack).toLocaleString()}</p>}
          <ErrorText>{err}</ErrorText>
          <div>
            <Btn onClick={() => void save(false)} disabled={busy}>
              {busy ? "Saving..." : `Bring ${scope === "all" ? "everything" : label} back online`}
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Message users will see (optional)">
            <input className={inputCls} maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We are upgrading the bridge. Back soon." />
          </Field>
          <Field label="Expected back (optional, your local time)">
            <input className={`${inputCls} w-auto`} type="datetime-local" value={back} onChange={(e) => setBack(e.target.value)} />
          </Field>
          <ErrorText>{err}</ErrorText>
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-warning">Take {scope === "all" ? "everything" : label} offline now?</span>
              <Btn kind="danger" onClick={() => void save(true)} disabled={busy}>
                {busy ? "Saving..." : "Yes, take it offline"}
              </Btn>
              <Btn kind="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Btn>
            </div>
          ) : (
            <div>
              <Btn kind="danger" onClick={() => setConfirm(true)}>
                Take {scope === "all" ? "everything" : label} offline
              </Btn>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------- footer editor ----------

function FooterTab() {
  const q = useQuery({
    queryKey: ["admin-footer"],
    queryFn: async () => (await adminFetch<{ settings: FooterSettings }>("/site/footer", { token: null })).settings,
  });
  return q.data ? <FooterForm initial={q.data} /> : <Panel title="Footer">{q.isError ? <ErrorText>{errText(q.error)}</ErrorText> : <p className="text-sm text-ink-muted">Loading...</p>}</Panel>;
}

function FooterForm({ initial }: { initial: FooterSettings }) {
  const [builtBy, setBuiltBy] = useState(initial.builtBy?.name ?? "");
  const [builtByUrl, setBuiltByUrl] = useState(initial.builtBy?.url ?? "");
  const [privacy, setPrivacy] = useState(initial.privacyUrl ?? "");
  const [terms, setTerms] = useState(initial.termsUrl ?? "");
  const [copyright, setCopyright] = useState(initial.copyright ?? "");
  const [socials, setSocials] = useState(initial.socials);
  const [netLabel, setNetLabel] = useState(initial.network?.label ?? "");
  const [netUrl, setNetUrl] = useState(initial.network?.url ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setErr(null);
    setSaved(null);
    const body: FooterSettings = {
      builtBy: builtBy.trim() ? { name: builtBy.trim(), ...(builtByUrl.trim() ? { url: builtByUrl.trim() } : {}) } : null,
      privacyUrl: privacy.trim() || null,
      termsUrl: terms.trim() || null,
      copyright: copyright.trim() || null,
      socials: socials.filter((s) => s.label.trim() && s.url.trim()).map((s) => ({ label: s.label.trim(), url: s.url.trim() })),
      network: netLabel.trim() ? { label: netLabel.trim(), ...(netUrl.trim() ? { url: netUrl.trim() } : {}) } : null,
    };
    try {
      await adminFetch("/admin/site/footer", { method: "PUT", body });
      setSaved("Saved. The site footer updates within a minute.");
    } catch (e) {
      const x = e as AdminApiError;
      setErr(x.code === "invalid_request" ? "Check the links: they must start with https://." : errText(e));
    }
  }
  return (
    <Panel title="Footer">
      <p className="text-xs text-ink-muted">Empty fields stay hidden on the site. Links must start with https://.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Built by">
          <input className={inputCls} value={builtBy} onChange={(e) => setBuiltBy(e.target.value)} placeholder="SoftDeveloper" maxLength={60} />
        </Field>
        <Field label="Built by link (optional)">
          <input className={inputCls} value={builtByUrl} onChange={(e) => setBuiltByUrl(e.target.value)} placeholder="https://github.com/soft-developper" />
        </Field>
        <Field label="Privacy link">
          <input className={inputCls} value={privacy} onChange={(e) => setPrivacy(e.target.value)} placeholder="https://.../privacy" />
        </Field>
        <Field label="Terms link">
          <input className={inputCls} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="https://.../terms" />
        </Field>
        <Field label="Copyright line">
          <input className={inputCls} value={copyright} onChange={(e) => setCopyright(e.target.value)} placeholder="© 2026 Confluence" maxLength={80} />
        </Field>
        <div />
        <Field label="Network badge override (optional)" hint="Leave empty to show the network automatically.">
          <input className={inputCls} value={netLabel} onChange={(e) => setNetLabel(e.target.value)} placeholder="Arc mainnet · 5042" maxLength={40} />
        </Field>
        <Field label="Network badge link (optional)">
          <input className={inputCls} value={netUrl} onChange={(e) => setNetUrl(e.target.value)} placeholder="https://explorer.arc.io" />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-muted">Social links (up to 6)</span>
        {socials.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input className={`${inputCls} max-w-[140px]`} value={s.label} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="X" aria-label="Social label" />
            <input className={inputCls} value={s.url} onChange={(e) => setSocials(socials.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://x.com/..." aria-label="Social link" />
            <button type="button" onClick={() => setSocials(socials.filter((_, j) => j !== i))} className="px-2 text-sm text-ink-muted hover:text-danger" aria-label="Remove">
              ×
            </button>
          </div>
        ))}
        {socials.length < 6 && (
          <button type="button" onClick={() => setSocials([...socials, { label: "", url: "" }])} className="self-start text-[13px] text-action-text hover:underline">
            Add a social link
          </button>
        )}
      </div>
      <ErrorText>{err}</ErrorText>
      {saved && (
        <p role="status" className="text-[13px] text-destination-text">
          {saved}
        </p>
      )}
      <div>
        <Btn onClick={() => void save()}>Save footer</Btn>
      </div>
    </Panel>
  );
}

// ---------- account ----------

function AccountTab() {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [code2, setCode2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Change password">
        <Field label="Current password">
          <input className={inputCls} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 12 characters. All sessions are signed out afterwards.">
          <input className={inputCls} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Authenticator code">
          <input className={`${inputCls} font-mono`} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </Field>
        <ErrorText>{err}</ErrorText>
        {msg && <p className="text-[13px] text-destination-text">{msg}</p>}
        <div>
          <Btn
            disabled={!cur || pw.length < 12 || code.length !== 6}
            onClick={async () => {
              setErr(null);
              try {
                await adminFetch("/admin/auth/password", { method: "POST", body: { currentPassword: cur, newPassword: pw, code } });
                setMsg("Password changed. Signing you out...");
                setTimeout(() => window.location.reload(), 1500);
              } catch (e) {
                setErr(errText(e));
              }
            }}
          >
            Change password
          </Btn>
        </div>
      </Panel>
      <Panel title="Backup codes">
        <p className="text-sm text-ink-muted">Create a new set of 10 backup codes. The old ones stop working.</p>
        {codes ? (
          <ol className="grid grid-cols-2 gap-2 font-mono text-sm">
            {codes.map((c) => (
              <li key={c} className="rounded-md border border-border bg-bg px-3 py-2 text-center">
                {c}
              </li>
            ))}
          </ol>
        ) : (
          <>
            <Field label="Authenticator code">
              <input className={`${inputCls} font-mono`} inputMode="numeric" value={code2} onChange={(e) => setCode2(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </Field>
            <div>
              <Btn
                kind="secondary"
                disabled={code2.length !== 6}
                onClick={async () => {
                  setErr(null);
                  try {
                    setCodes((await adminFetch<{ backupCodes: string[] }>("/admin/auth/backup-codes", { method: "POST", body: { code: code2 } })).backupCodes);
                  } catch (e) {
                    setErr(errText(e));
                  }
                }}
              >
                New backup codes
              </Btn>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
