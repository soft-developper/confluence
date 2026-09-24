"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { useConnect, useConnectors, type Connector } from "wagmi";

type View =
  | { kind: "list" }
  | { kind: "connecting"; connector: Connector }
  | { kind: "qr"; connector: Connector; uri: string; dataUrl: string }
  | { kind: "error"; message: string };

function friendlyError(e: unknown): string {
  const msg = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "Connection failed";
  if (/reject|denied|cancel/i.test(msg)) return "The request was rejected in your wallet.";
  return msg;
}

function WalletIcon({ connector }: { connector: Connector }) {
  if (connector.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connector.icon} alt="" className="h-8 w-8 rounded-md" />;
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border-control bg-bg text-[13px] font-medium">
      {connector.name.slice(0, 1)}
    </span>
  );
}

export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { mutateAsync: connect } = useConnect();
  const [view, setView] = useState<View>({ kind: "list" });
  const dialogRef = useRef<HTMLDivElement>(null);

  const { detected, others } = useMemo(() => {
    const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const generic = connectors.find((c) => c.id === "injected");
    const hasLegacy = typeof window !== "undefined" && "ethereum" in window;
    const detectedList = discovered.length > 0 ? discovered : hasLegacy && generic ? [generic] : [];
    const otherList = connectors.filter((c) => c.type === "walletConnect" || c.type === "coinbaseWallet");
    return { detected: detectedList, others: otherList };
  }, [connectors]);

  useEffect(() => {
    if (!open) return;
    setView({ kind: "list" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function choose(connector: Connector) {
    setView({ kind: "connecting", connector });
    let off: (() => void) | undefined;
    if (connector.type === "walletConnect") {
      const onMessage = async ({ type, data }: { type: string; data?: unknown }) => {
        if (type === "display_uri" && typeof data === "string") {
          const dataUrl = await QRCode.toDataURL(data, { margin: 1, width: 240, color: { dark: "#0A121F", light: "#FFFFFF" } });
          setView({ kind: "qr", connector, uri: data, dataUrl });
        }
      };
      connector.emitter.on("message", onMessage);
      off = () => connector.emitter.off("message", onMessage);
    }
    try {
      await connect({ connector });
      onClose();
    } catch (e) {
      setView({ kind: "error", message: friendlyError(e) });
    } finally {
      off?.();
    }
  }

  const row = (c: Connector, tag?: string) => (
    <li key={c.uid}>
      <button
        type="button"
        onClick={() => void choose(c)}
        className="flex h-14 w-full items-center justify-between rounded-md border border-border bg-surface px-3.5 text-left hover:border-action-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
      >
        <span className="flex items-center gap-3">
          <WalletIcon connector={c} />
          <span className="text-[15px] font-medium">{c.name}</span>
        </span>
        {tag ? <span className="rounded-sm border border-destination-text px-1.5 py-0.5 font-mono text-[11px] text-destination-text">{tag}</span> : null}
      </button>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,9,16,0.74)] sm:items-center" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-t-lg border border-border bg-surface-raised p-6 sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="connect-title" className="text-xl font-medium">
              {view.kind === "qr" ? "Scan with your phone" : "Connect a wallet"}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              {view.kind === "qr"
                ? "Open a WalletConnect wallet and scan this code."
                : "Confluence never holds your funds. You sign every transaction."}
            </p>
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

        {view.kind === "list" && (
          <div className="mt-4 flex flex-col gap-3">
            {detected.length > 0 && (
              <>
                <p className="text-xs text-ink-muted">Detected in this browser</p>
                <ul className="flex flex-col gap-2">{detected.map((c) => row(c, "Detected"))}</ul>
              </>
            )}
            {others.length > 0 && (
              <>
                <p className="text-xs text-ink-muted">{detected.length > 0 ? "Other options" : "Connect with"}</p>
                <ul className="flex flex-col gap-2">{others.map((c) => row(c))}</ul>
              </>
            )}
            {detected.length === 0 && others.length === 0 && (
              <p className="text-sm text-ink-muted">No wallets available. Install a browser wallet such as MetaMask or Rabby.</p>
            )}
          </div>
        )}

        {view.kind === "connecting" && (
          <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center">
            <WalletIcon connector={view.connector} />
            <p className="text-sm">Confirm the connection in {view.connector.name}...</p>
            <button type="button" onClick={() => setView({ kind: "list" })} className="text-[13px] text-action-text">
              Back to all wallets
            </button>
          </div>
        )}

        {view.kind === "qr" && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex justify-center rounded-md bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={view.dataUrl} alt="WalletConnect QR code" width={240} height={240} />
            </div>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(view.uri)}
              className="h-11 rounded-md border border-border-control text-sm font-medium hover:border-action-text"
            >
              Copy link
            </button>
            <button type="button" onClick={() => setView({ kind: "list" })} className="text-[13px] text-action-text">
              Back to all wallets
            </button>
          </div>
        )}

        {view.kind === "error" && (
          <div className="mt-4 flex flex-col gap-3">
            <p role="alert" className="rounded-md border border-danger bg-bg p-3 text-sm text-danger">
              {view.message}
            </p>
            <button type="button" onClick={() => setView({ kind: "list" })} className="h-11 rounded-md border border-border-control text-sm font-medium">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
