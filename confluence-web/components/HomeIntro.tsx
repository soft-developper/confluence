"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRelaySettings, RELAY_EXECUTION_READY } from "@/lib/relay";

/**
 * Home pitch above the Bridge card (confluence:positioning): who Confluence is for (Arc
 * builders and teams) and what only it offers. No fee here: the quote shows it. Relay is only mentioned while it is switched
 * on, read from the same cached query as the Confluence | Relay toggle. A paragraph, not a
 * heading: the Bridge card already carries the page's h1.
 */
export function HomeIntro() {
  const relay = useQuery({ queryKey: ["relay-settings"], queryFn: ({ signal }) => fetchRelaySettings(signal), staleTime: 60_000, retry: 1 });
  const relayOn = !!relay.data?.enabled && RELAY_EXECUTION_READY;
  return (
    <div className="flex w-full max-w-[460px] flex-col gap-1 text-center sm:gap-1.5">
      <p className="text-lg font-medium tracking-tight text-balance text-ink sm:text-2xl">
        Move USDC in and out of Arc, and pay anyone by <span className="font-mono text-action-text">@name</span>.
      </p>
      <p className="text-[13px] text-balance text-ink-muted sm:text-sm">
        Native USDC through Circle&rsquo;s CCTP{relayOn ? ", and other chains through Relay" : ""}.
      </p>
    </div>
  );
}
