"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchRelaySettings, RELAY_EXECUTION_READY } from "@/lib/relay";
import { RelayPanel } from "./RelayPanel";

/**
 * Confluence | Relay toggle above the Bridge and Swap cards (R2). Confluence (CCTP and
 * App Kit) is always selected on load. The toggle only appears while Relay is switched on
 * in admin and the API has a Relay key. (confluence:relay-protocol-switch)
 */
export function ProtocolSwitch({ preset, children }: { preset: "bridge" | "swap"; children: React.ReactNode }) {
  const [mode, setMode] = useState<"confluence" | "relay">("confluence");
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    setPreview(new URLSearchParams(window.location.search).get("relay") === "preview");
  }, []);
  const settings = useQuery({ queryKey: ["relay-settings"], queryFn: ({ signal }) => fetchRelaySettings(signal), staleTime: 60_000, retry: 1 });
  const available = !!settings.data?.enabled && (RELAY_EXECUTION_READY || preview);

  useEffect(() => {
    if (!available && mode === "relay") setMode("confluence");
  }, [available, mode]);

  if (!available) return <>{children}</>;

  return (
    <div className="flex w-full max-w-[460px] flex-col gap-3">
      <div role="radiogroup" aria-label="Route provider" className="grid grid-cols-2 gap-1 self-center rounded-md border border-border bg-surface p-1">
        {(["confluence", "relay"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`h-9 rounded-[4px] px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text ${
              mode === m ? "bg-action text-on-action" : "text-ink-muted hover:text-ink"
            }`}
          >
            {m === "confluence" ? "Confluence" : "Relay"}
          </button>
        ))}
      </div>
      {mode === "confluence" ? children : <RelayPanel preset={preset} appFeeBps={settings.data!.appFeeBps} />}
    </div>
  );
}
