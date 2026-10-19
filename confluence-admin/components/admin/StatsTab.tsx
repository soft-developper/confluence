"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminApiError, adminFetch } from "@/lib/adminApi";
import { Btn, ErrorText, Field, inputCls, Panel, Stat } from "./ui";

/**
 * Admin: landing stats dashboard (confluence:stats-dashboard). Controls what the landing page
 * shows: on or off, which figures and in what order, the range it opens on, and where the
 * numbers come from. The preview reads the same public stats the landing page will read.
 * Saved with PUT /admin/site/stats-dashboard; the landing page picks changes up within minutes.
 */

const METRICS = ["bridgeVolume", "transactions", "activeWallets", "newWallets", "swapVolume", "arcPayVolume", "relayVolume", "chains"] as const;
type Metric = (typeof METRICS)[number];
type Range = "30d" | "90d" | "all";
type Source = "confluence" | "defillama";

interface DashboardSettings {
  enabled: boolean;
  metrics: Metric[];
  range: Range;
  source: Source;
  /** Older APIs omit it (treated as off). */
  showDefillamaLink?: boolean;
  defillamaSlug: string | null;
}

interface Totals {
  transactions: number;
  wallets: number;
  newWallets?: number;
  bridge: { count: number; volumeUsdc: string };
  swap: { count: number; volumeUsd: number };
  arcPay: { count: number; volumeUsdc: string };
  relay: { count: number; volumeUsd: number };
  relayBridge?: { count: number; volumeUsd: number };
  chains: number;
}
interface Summary {
  generatedAt: string;
  allTime: Totals;
  last30d: Totals;
  last90d?: Totals;
}

/** What each figure means. The same wording should appear on the landing page. */
export const METRIC_INFO: Record<Metric, { label: string; hint: string }> = {
  bridgeVolume: { label: "Bridge volume", hint: "USDC bridged with Circle CCTP plus Relay cross-chain routes" },
  transactions: { label: "Transactions", hint: "Completed bridges, swaps, Arc payments and Relay routes" },
  activeWallets: { label: "Active wallets", hint: "Wallets with at least one completed action" },
  newWallets: { label: "New wallets", hint: "Wallets whose first action was in the range" },
  swapVolume: { label: "Swap volume", hint: "USD value of same-chain swaps (USDC or USDT side)" },
  arcPayVolume: { label: "Arc Pay volume", hint: "USDC paid Arc to Arc by @name" },
  relayVolume: { label: "Relay volume", hint: "USD value of all Relay routes, cross-chain and same-chain" },
  chains: { label: "Chains used", hint: "Chains with at least one completed action" },
};

const RANGE_LABEL: Record<Range, string> = { "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };
const errText = (e: unknown) => (e instanceof AdminApiError ? e.message : "Could not reach the API.");
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

/** The value of one figure for one window, formatted as the landing page will show it. */
export function metricValue(m: Metric, t: Totals): string {
  switch (m) {
    case "bridgeVolume":
      return money(Number(t.bridge.volumeUsdc) + (t.relayBridge?.volumeUsd ?? 0));
    case "transactions":
      return t.transactions.toLocaleString();
    case "activeWallets":
      return t.wallets.toLocaleString();
    case "newWallets":
      return t.newWallets === undefined ? "n/a" : t.newWallets.toLocaleString();
    case "swapVolume":
      return money(t.swap.volumeUsd);
    case "arcPayVolume":
      return money(Number(t.arcPay.volumeUsdc));
    case "relayVolume":
      return money(t.relay.volumeUsd);
    case "chains":
      return t.chains.toLocaleString();
  }
}

export function StatsTab() {
  const q = useQuery({
    queryKey: ["admin-stats-dashboard"],
    queryFn: async () => adminFetch<{ settings: DashboardSettings; updatedAt: string | null }>("/site/stats-dashboard", { token: null }),
  });
  if (!q.data)
    return <Panel title="Landing stats">{q.isError ? <ErrorText>{errText(q.error)}</ErrorText> : <p className="text-sm text-ink-muted">Loading...</p>}</Panel>;
  return <StatsForm initial={q.data.settings} updatedAt={q.data.updatedAt} />;
}

function StatsForm({ initial, updatedAt }: { initial: DashboardSettings; updatedAt: string | null }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [metrics, setMetrics] = useState<Metric[]>(initial.metrics);
  const [range, setRange] = useState<Range>(initial.range);
  const [source, setSource] = useState<Source>(initial.source);
  const [slug, setSlug] = useState(initial.defillamaSlug ?? "");
  const [showLink, setShowLink] = useState(initial.showDefillamaLink ?? false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ["admin-stats-summary"],
    queryFn: () => adminFetch<Summary>("/public/stats/summary", { token: null }),
    staleTime: 60_000,
  });
  const totals = summaryQ.data ? (range === "all" ? summaryQ.data.allTime : range === "90d" ? summaryQ.data.last90d : summaryQ.data.last30d) : undefined;

  const slugClean = slug.trim().toLowerCase();
  const slugOk = slugClean === "" || /^[a-z0-9][a-z0-9-]{0,62}$/.test(slugClean);
  const dirty =
    enabled !== initial.enabled ||
    range !== initial.range ||
    source !== initial.source ||
    (slugClean || null) !== initial.defillamaSlug ||
    showLink !== (initial.showDefillamaLink ?? false) ||
    metrics.join() !== initial.metrics.join();

  function toggle(m: Metric) {
    setMetrics((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }
  function move(i: number, d: -1 | 1) {
    setMetrics((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  async function save() {
    setErr(null);
    setSaved(null);
    if (!slugOk) {
      setErr("The DefiLlama slug can only use lowercase letters, digits and hyphens.");
      return;
    }
    if (source === "defillama" && !slugClean) {
      setErr("Add the DefiLlama slug before using DefiLlama as the source.");
      return;
    }
    if (showLink && !slugClean) {
      setErr("Add the DefiLlama slug before showing the DefiLlama link.");
      return;
    }
    if (enabled && metrics.length === 0) {
      setErr("Pick at least one figure before showing the dashboard.");
      return;
    }
    setSaving(true);
    try {
      await adminFetch("/admin/site/stats-dashboard", {
        method: "PUT",
        body: { enabled, metrics, range, source, showDefillamaLink: showLink, defillamaSlug: slugClean || null },
      });
      await qc.invalidateQueries({ queryKey: ["admin-stats-dashboard"] });
      setSaved(
        [
          enabled ? "The stats section shows" : "The stats section stays hidden",
          showLink ? "the DefiLlama link shows" : "the DefiLlama link stays hidden",
        ].join(", ") + " on the landing page. Changes appear within a few minutes.",
      );
    } catch (e) {
      const x = e as AdminApiError;
      setErr(x.code === "invalid_request" ? "The API refused these settings. Check the slug and the source." : errText(e));
    } finally {
      setSaving(false);
    }
  }

  const llamaUrl = slugClean && slugOk ? `https://defillama.com/protocol/${slugClean}` : null;
  return (
    <div className="flex flex-col gap-6">
      <Panel title="DefiLlama">
        <p className="text-xs text-ink-muted">
          Confluence&apos;s public page on DefiLlama. The link appears in the landing page hero and footer and opens DefiLlama&apos;s dashboard.
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="DefiLlama slug" hint="The last part of the DefiLlama page link, e.g. confluence.">
            <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="confluence" maxLength={63} />
          </Field>
          {llamaUrl && (
            <a href={llamaUrl} target="_blank" rel="noopener noreferrer" className="h-10 content-center text-sm text-action-text hover:underline">
              Open {llamaUrl.replace("https://", "")}
            </a>
          )}
        </div>
        <label className={`flex items-center gap-3 text-sm ${!llamaUrl ? "opacity-60" : ""}`}>
          <input
            type="checkbox"
            checked={showLink}
            disabled={!llamaUrl && !showLink}
            onChange={(e) => setShowLink(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-action)]"
          />
          <span className="font-medium">Show the DefiLlama link on the landing page</span>
        </label>
        {!llamaUrl && <p className="text-xs text-ink-muted">Add the slug to turn the link on.</p>}
      </Panel>

      <Panel title="Landing stats">
        <p className="text-xs text-ink-muted">
          Controls the stats section on confluencebuild.xyz. Numbers are aggregates only (no addresses), counted the same way as this dashboard.
          {updatedAt ? ` Last saved ${new Date(updatedAt).toLocaleString()}.` : " Never saved: the dashboard is hidden."}
        </p>

        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--color-action)]" />
          <span className="font-medium">Show the stats dashboard on the landing page</span>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">Figures, in the order shown</span>
          <ul className="flex flex-col gap-1.5">
            {metrics.map((m, i) => (
              <li key={m} className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-sm">
                <span className="tnum w-5 text-xs text-ink-muted">{i + 1}</span>
                <span className="flex-1">
                  <span className="font-medium">{METRIC_INFO[m].label}</span>
                  <span className="block text-xs text-ink-muted">{METRIC_INFO[m].hint}</span>
                </span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-2 text-ink-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${METRIC_INFO[m].label} up`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === metrics.length - 1} className="px-2 text-ink-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${METRIC_INFO[m].label} down`}>
                  ↓
                </button>
                <button type="button" onClick={() => toggle(m)} className="px-2 text-ink-muted hover:text-danger" aria-label={`Remove ${METRIC_INFO[m].label}`}>
                  ×
                </button>
              </li>
            ))}
            {metrics.length === 0 && <li className="text-sm text-ink-muted">No figures picked.</li>}
          </ul>
          {metrics.length < METRICS.length && (
            <div className="flex flex-wrap gap-2 pt-1">
              {METRICS.filter((m) => !metrics.includes(m)).map((m) => (
                <button key={m} type="button" onClick={() => toggle(m)} className="rounded-md border border-border-control px-2.5 py-1 text-[13px] hover:border-action-text">
                  Add {METRIC_INFO[m].label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Range shown first">
            <select className={inputCls} value={range} onChange={(e) => setRange(e.target.value as Range)}>
              {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data source" hint={source === "defillama" ? "Numbers as DefiLlama reports them." : "Confluence's own public stats."}>
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="confluence">Confluence</option>
              <option value="defillama" disabled={!slugClean || !slugOk}>
                DefiLlama{!slugClean ? " (add the slug above first)" : ""}
              </option>
            </select>
          </Field>
        </div>

        <ErrorText>{err}</ErrorText>
        {saved && (
          <p role="status" className="text-[13px] text-destination-text">
            {saved}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Btn onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save"}
          </Btn>
          {!dirty && !saved && <span className="text-xs text-ink-muted">No changes</span>}
        </div>
      </Panel>

      <Panel title={`Preview: ${RANGE_LABEL[range]}`}>
        <p className="text-xs text-ink-muted">
          {source === "defillama"
            ? "The landing page will read these figures from DefiLlama. This preview shows Confluence's own numbers, which DefiLlama reads too."
            : "What visitors will see, from the live public stats (refreshed every 10 minutes)."}
          {!enabled && " The dashboard is hidden until you switch it on and save."}
        </p>
        {summaryQ.isError && <ErrorText>{errText(summaryQ.error)}</ErrorText>}
        {!summaryQ.data && !summaryQ.isError && <p className="text-sm text-ink-muted">Loading...</p>}
        {summaryQ.data && !totals && <p className="text-sm text-ink-muted">This range needs the latest API. Deploy the API update, then reload.</p>}
        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map((m) => (
              <Stat key={m} label={METRIC_INFO[m].label} value={metricValue(m, totals)} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
