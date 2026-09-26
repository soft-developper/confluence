"use client";

import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";

type Status =
  | { kind: "checking" }
  | { kind: "ok"; env: string }
  | { kind: "db_down"; env: string }
  | { kind: "mismatch"; env: string }
  | { kind: "unreachable"; reason: string };

/** `compact` renders a one-line status with a dot (used in the footer). */
export function ApiStatus({ compact = false }: { compact?: boolean } = {}) {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch(`${publicEnv.apiUrl}/health`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        // 503 still carries a JSON body: the API is up but its database is not.
        if (!res.ok && res.status !== 503) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { env?: string; db?: string };
        const env = body.env ?? "unknown";
        if (env !== publicEnv.confluenceEnv) setStatus({ kind: "mismatch", env });
        else if (body.db !== "ok") setStatus({ kind: "db_down", env });
        else setStatus({ kind: "ok", env });
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

  if (compact) {
    const [dot, label] =
      status.kind === "ok"
        ? ["bg-destination", `API connected · database ok`]
        : status.kind === "checking"
          ? ["bg-border-control", "API checking..."]
          : status.kind === "db_down"
            ? ["bg-warning", "API up · database unreachable"]
            : status.kind === "mismatch"
              ? ["bg-danger", `API environment mismatch (${status.env})`]
              : ["bg-danger", "API unreachable"];
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-muted" role="status" aria-live="polite">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </span>
    );
  }

  const base = "mt-6 rounded-md border px-3 py-2 font-mono text-[13px]";
  switch (status.kind) {
    case "checking":
      return <p className={`${base} border-border text-ink-muted`}>API: checking {publicEnv.apiUrl}</p>;
    case "ok":
      return <p className={`${base} border-border text-destination-text`}>API: connected ({status.env}) · database ok</p>;
    case "db_down":
      return (
        <p role="alert" className={`${base} border-warning text-warning`}>
          API: connected ({status.env}) · database unreachable. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
        </p>
      );
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
