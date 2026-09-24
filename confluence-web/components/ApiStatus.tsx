"use client";

import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";

type Status =
  | { kind: "checking" }
  | { kind: "ok"; env: string }
  | { kind: "mismatch"; env: string }
  | { kind: "unreachable"; reason: string };

export function ApiStatus() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch(`${publicEnv.apiUrl}/health`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { env?: string };
        const env = body.env ?? "unknown";
        setStatus(env === publicEnv.confluenceEnv ? { kind: "ok", env } : { kind: "mismatch", env });
      })
      .catch((err: unknown) => {
        setStatus({ kind: "unreachable", reason: err instanceof Error ? err.message : "request failed" });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  const base = "mt-6 rounded-md border px-3 py-2 font-mono text-[13px]";
  switch (status.kind) {
    case "checking":
      return <p className={`${base} border-border text-ink-muted`}>API: checking {publicEnv.apiUrl}</p>;
    case "ok":
      return <p className={`${base} border-border text-destination-text`}>API: connected ({status.env})</p>;
    case "mismatch":
      return (
        <p role="alert" className={`${base} border-danger text-danger`}>
          API environment is {status.env}, but this app is {publicEnv.confluenceEnv}. Fix the deployment config.
        </p>
      );
    case "unreachable":
      return (
        <p role="alert" className={`${base} border-danger text-danger`}>
          API unreachable at {publicEnv.apiUrl} ({status.reason})
        </p>
      );
  }
}
