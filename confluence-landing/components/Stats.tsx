"use client";

import { useState } from "react";
import type { StatMetric, StatRange, StatSummary, StatTotals, StatsDashboard } from "@/lib/site";

/**
 * Stats section (confluence:landing-stats, D5): the figures picked in the admin Stats tab,
 * for a range the visitor can switch, plus daily transactions as bars. Every number is an
 * aggregate of actions proven on-chain; no addresses. Shown only when switched on in admin.
 */

const RANGES: { id: StatRange; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All time" },
];

const INFO: Record<StatMetric, { label: string; hint: string }> = {
  bridgeVolume: { label: "Bridged", hint: "USDC through Circle CCTP plus Relay cross-chain routes" },
  transactions: { label: "Transactions", hint: "Completed bridges, swaps, payments and Relay routes" },
  activeWallets: { label: "Active wallets", hint: "Wallets with at least one completed action" },
  newWallets: { label: "New wallets", hint: "Wallets that made their first move" },
  swapVolume: { label: "Swapped", hint: "USD value of same-chain swaps" },
  arcPayVolume: { label: "Paid by @name", hint: "USDC sent Arc to Arc by Confluence ID" },
  relayVolume: { label: "Through Relay", hint: "USD value of all Relay routes" },
  chains: { label: "Chains used", hint: "Chains with at least one completed action" },
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n > 0 && n < 100 ? 2 : 0, maximumFractionDigits: n >= 100 ? 0 : 2 })}`;

function value(m: StatMetric, t: StatTotals): string | null {
  switch (m) {
    case "bridgeVolume":
      return money(Number(t.bridge.volumeUsdc) + (t.relayBridge?.volumeUsd ?? 0));
    case "transactions":
      return t.transactions.toLocaleString("en-US");
    case "activeWallets":
      return t.wallets.toLocaleString("en-US");
    case "newWallets":
      return t.newWallets === undefined ? null : t.newWallets.toLocaleString("en-US");
    case "swapVolume":
      return money(t.swap.volumeUsd);
    case "arcPayVolume":
      return money(Number(t.arcPay.volumeUsdc));
    case "relayVolume":
      return money(t.relay.volumeUsd);
    case "chains":
      return t.chains.toLocaleString("en-US");
  }
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function DailyBars({ points }: { points: { date: string; transactions: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.transactions));
  const total = points.reduce((s, p) => s + p.transactions, 0);
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-medium">Daily transactions</figcaption>
      <div
        role="img"
        aria-label={`Daily transactions from ${shortDate(points[0]!.date)} to ${shortDate(points.at(-1)!.date)}: ${total} in total, at most ${max} in a day.`}
        className="flex h-28 items-end gap-[2px] border-b border-border sm:h-36"
      >
        {points.map((p) => (
          <div key={p.date} className="group relative flex h-full flex-1 items-end">
            <div
              className={`w-full rounded-t-[4px] ${p.transactions ? "bg-action" : "bg-transparent"}`}
              style={{ height: p.transactions ? `${Math.max(4, (p.transactions / max) * 100)}%` : "0" }}
            />
            {/* Hover target is the whole column, wider than the bar. */}
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs whitespace-nowrap text-ink shadow-sm group-hover:block">
              {shortDate(p.date)}: <span className="tnum font-medium">{p.transactions}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-3 text-xs text-ink-muted">
        <span>{shortDate(points[0]!.date)}</span>
        <span>Busiest day: {max.toLocaleString("en-US")}</span>
        <span>{shortDate(points.at(-1)!.date)}</span>
      </div>
    </figure>
  );
}

export function Stats({ dashboard, summary, defillamaUrl }: { dashboard: StatsDashboard; summary: StatSummary; defillamaUrl: string | null }) {
  const [range, setRange] = useState<StatRange>(dashboard.range);
  const totals = range === "all" ? summary.allTime : range === "90d" ? (summary.last90d ?? summary.allTime) : summary.last30d;
  const days = range === "30d" ? 30 : 90;
  // Start the chart at the first day with activity, so the weeks before launch don't show as empty.
  const window = summary.series.slice(-days);
  const first = window.findIndex((p) => p.transactions > 0);
  const points = first > 0 ? window.slice(first) : window;
  const figures = dashboard.metrics.map((m) => ({ m, v: value(m, totals) })).filter((f): f is { m: StatMetric; v: string } => f.v !== null);

  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label="Time range" className="flex gap-1 self-start rounded-md border border-border p-1">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={range === r.id}
            onClick={() => setRange(r.id)}
            className={`rounded-[4px] px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text ${
              range === r.id ? "bg-action text-on-action" : "text-ink-muted hover:text-ink"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
        {figures.map(({ m, v }) => (
          <div key={m} className="flex flex-col gap-1.5 border-t border-border-control pt-4">
            <dt className="text-sm text-ink-muted">{INFO[m].label}</dt>
            <dd className="tnum text-[2rem] leading-none font-medium tracking-[-0.02em] sm:text-[2.5rem]">{v}</dd>
            <dd className="text-xs text-ink-muted">{INFO[m].hint}</dd>
          </div>
        ))}
      </dl>

      {points.length > 1 && <DailyBars points={points} />}

      <p className="text-sm text-ink-muted">
        Counted only from transfers proven on-chain, updated every few minutes.{" "}
        {range === "all" ? "The chart covers up to the last 90 days. " : ""}
        {defillamaUrl ? (
          <>
            Also tracked on{" "}
            <a href={defillamaUrl} className="text-action-text underline-offset-4 hover:underline">
              DefiLlama
            </a>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}
