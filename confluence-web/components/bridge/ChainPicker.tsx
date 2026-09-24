"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BridgeChain } from "@/lib/chains";
import { ChainDot } from "./ChainDot";
import { SpeedBadge } from "./SpeedBadge";

export function ChainPicker({
  open,
  title,
  side,
  chains,
  selectedId,
  disabledId,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  side: "source" | "destination";
  chains: readonly BridgeChain[];
  selectedId: string | undefined;
  disabledId: string | undefined;
  onSelect: (c: BridgeChain) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQ("");
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? chains.filter((c) => c.name.toLowerCase().includes(s) || c.id.toLowerCase().includes(s)) : chains;
  }, [q, chains]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,9,16,0.74)] sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[460px] flex-col rounded-t-lg border border-border bg-surface-raised p-6 sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="picker-title" className="text-xl font-medium">
              {title}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">Only chains supported by Circle App Kit are shown.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-control text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <label htmlFor="chain-search" className="mt-4 text-[13px] font-medium text-ink-muted">
          Search chains
        </label>
        <input
          id="chain-search"
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Base"
          className="mt-1.5 h-11 rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text"
        />
        <ul className="mt-3 flex flex-col gap-1.5 overflow-y-auto">
          {list.map((c) => {
            const disabled = c.id === disabledId;
            const selected = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(c)}
                  className={`flex h-13 w-full items-center justify-between gap-3 rounded-md border px-3 text-left disabled:opacity-40 ${
                    selected ? "border-action bg-bg" : "border-border bg-surface hover:border-action-text"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ChainDot name={c.name} side={side} />
                    <span className="truncate text-[15px] font-medium">{c.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {side === "source" ? <SpeedBadge chain={c} /> : null}
                    {side === "destination" && !c.forwarderAsDestination ? (
                      <span className="font-mono text-[11px] text-ink-muted">no forwarding</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">No chains match &quot;{q}&quot;.</li>}
        </ul>
        {side === "source" && (
          <p className="mt-3 text-xs text-ink-muted">
            Times are Circle attestation estimates for each chain as the source. Linea Standard takes 6 to 32 hours, so Fast is recommended there.
          </p>
        )}
      </div>
    </div>
  );
}
