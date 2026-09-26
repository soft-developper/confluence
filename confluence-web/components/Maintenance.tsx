"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSiteStatus, type SiteStatus } from "@/lib/api";

/** Maintenance switches set from the admin dashboard (A2): polled every 30 seconds. */
export function useSiteStatus() {
  return useQuery({ queryKey: ["site-status"], queryFn: fetchSiteStatus, refetchInterval: 30_000, staleTime: 15_000, retry: 1 });
}

function when(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Replaces the Bridge or Swap card while that protocol is offline. In-flight work is unaffected. */
export function MaintenanceGate({ protocol, children }: { protocol: "bridge" | "swap"; children: React.ReactNode }) {
  const q = useSiteStatus();
  const s: SiteStatus[typeof protocol] | undefined = q.data?.[protocol];
  if (!s || s.online) return <>{children}</>;
  const back = when(s.expectedBack);
  return (
    <section role="status" className="flex w-full max-w-[460px] flex-col gap-4 rounded-lg border border-warning bg-surface p-5 sm:p-6">
      <span className="self-start rounded-[4px] border border-warning px-2 py-0.5 font-mono text-xs text-warning">Maintenance</span>
      <h1 className="text-[22px] font-medium">{protocol === "bridge" ? "Bridging" : "Swapping"} is paused for maintenance</h1>
      {s.message && <p className="text-sm">{s.message}</p>}
      {back && <p className="text-sm text-ink-muted">Expected back around {back}.</p>}
      <p className="text-xs text-ink-muted">
        Transfers and swaps already in progress are not affected: they keep completing, and their transaction pages keep working.
      </p>
    </section>
  );
}

/** A slim banner on every page while anything is offline. */
export function MaintenanceBanner() {
  const q = useSiteStatus();
  const d = q.data;
  if (!d || (d.bridge.online && d.swap.online)) return null;
  const which = !d.bridge.online && !d.swap.online ? "Bridge and Swap are" : !d.bridge.online ? "Bridge is" : "Swap is";
  return (
    <div role="status" className="border-b border-warning bg-bg px-4 py-2 text-center text-[13px]">
      <span className="font-medium text-warning">Maintenance:</span> {which} temporarily offline. In-progress transfers are not affected.
    </div>
  );
}
