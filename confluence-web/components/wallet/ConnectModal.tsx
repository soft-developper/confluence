"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useConnect, useConnectors, type Connector } from "wagmi";
import { useScrollLock } from "@/lib/mobileUi";

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

/** The generic connector is whichever wallet owns window.ethereum, so it gets a neutral name. */
function walletName(c: Connector): string {
  return c.id === "injected" ? "Browser wallet" : c.name;
}

function WalletIcon({ connector }: { connector: Connector }) {
  if (connector.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connector.icon} alt="" className="h-8 w-8 rounded-md" />;
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border-control bg-bg text-[13px] font-medium">
      {walletName(connector).slice(0, 1)}
    </span>
  );
}

/**
 * Phones and tablets (confluence:mobile-wallets). A mobile browser has no wallet extensions,
 * so nothing announces itself through EIP-6963 there, and wallet apps such as MetaMask are
 * reached by leaving the browser.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1; // iPadOS reports as a Mac
}

/**
 * MetaMask's official deeplink that opens a dapp inside the MetaMask app's own browser, where
 * MetaMask is available like an extension: https://link.metamask.io/dapp/{dappUrl}
 * (https://docs.metamask.io/sdk/guides/use-deeplinks/). Without the app installed, MetaMask
 * sends the user to its download page.
 */
function metaMaskAppLink(): string {
  const { host, pathname, search } = window.location;
  return `https://link.metamask.io/dapp/${host}${pathname}${search}`;
}

/**
 * Wallet picker. (confluence:connect-portal) (confluence:connect-dedupe)
 *
 * Rendered through a portal on document.body: the sticky header uses backdrop-filter,
 * and any ancestor with backdrop-filter, filter or transform becomes the containing
 * block for position: fixed children. Without the portal, the modal opened from the
 * header button was laid out inside the header strip instead of the viewport.
 *
 * Wallet list comes from EIP-6963 (https://eips.ethereum.org/EIPS/eip-6963), which
 * wagmi turns into one connector per announced wallet. On open we dispatch
 * "eip6963:requestProvider" so every installed wallet announces itself again, and
 * wait briefly before falling back to the single generic window.ethereum row.
 */
const DISCOVERY_WAIT_MS = 800;

export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { mutateAsync: connect } = useConnect();
  const [view, setView] = useState<View>({ kind: "list" });
  const [searching, setSearching] = useState(false);
  const [mobile, setMobile] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useScrollLock(open);

  const { detected, others } = useMemo(() => {
    // One row per wallet: EIP-6963 connectors use the wallet's rdns as their id, so keep the first per id.
    const seen = new Set<string>();
    const discovered = connectors.filter((c) => {
      if (c.type !== "injected" || c.id === "injected" || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    const generic = connectors.find((c) => c.id === "injected");
    const hasLegacy = typeof window !== "undefined" && "ethereum" in window;
    // The generic row only appears when no wallet announced itself through EIP-6963.
    const detectedList = discovered.length > 0 ? discovered : !searching && hasLegacy && generic ? [generic] : [];
    const otherList = connectors.filter((c) => c.type === "walletConnect" || c.type === "coinbaseWallet");
    return { detected: detectedList, others: otherList };
  }, [connectors, searching]);

  useEffect(() => {
    if (!open) return;
    setView({ kind: "list" });
    setMobile(isMobileBrowser());
    // Ask installed wallets to announce again; wagmi's EIP-6963 store picks up any it missed.
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setSearching(true);
    const timer = window.setTimeout(() => setSearching(false), DISCOVERY_WAIT_MS);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  // On a phone, offer MetaMask's own app when it is not already the browser's wallet
  // (inside MetaMask's in-app browser it announces itself and is listed as detected).
  const showMetaMaskApp = mobile && !searching && !detected.some((c) => c.id === "io.metamask" || /metamask/i.test(c.name));

  async function choose(connector: Connector) {
    setView({ kind: "connecting", connector });
    let off: (() => void) | undefined;
    if (connector.type === "walletConnect") {
      // The QR image is drawn from WalletConnect's pairing link. If drawing fails, say so
      // instead of waiting silently (confluence:qr-errors).
      const onMessage = ({ type, data }: { type: string; data?: unknown }) => {
        if (type !== "display_uri" || typeof data !== "string") return;
        QRCode.toDataURL(data, { margin: 1, width: 240, color: { dark: "#0A121F", light: "#FFFFFF" } })
          .then((dataUrl) => setView({ kind: "qr", connector, uri: data, dataUrl }))
          .catch(() => setView({ kind: "error", message: "Could not show the WalletConnect QR code. Try again, or choose another wallet." }));
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
          <span className="text-[15px] font-medium">{walletName(c)}</span>
        </span>
        {tag ? <span className="rounded-sm border border-destination-text px-1.5 py-0.5 font-mono text-[11px] text-destination-text">{tag}</span> : null}
      </button>
    </li>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,9,16,0.74)] sm:items-center" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-t-lg border border-border bg-surface-raised p-6 sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="connect-title" className="text-xl font-medium">
              {view.kind === "qr" ? (mobile ? "Connect with WalletConnect" : "Scan with your phone") : "Connect a wallet"}
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              {view.kind === "qr"
                ? mobile
                  ? "Open your wallet app on this phone to approve, or scan the code from another device."
                  : "Open a WalletConnect wallet and scan this code."
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
            {showMetaMaskApp && (
              <>
                <p className="text-xs text-ink-muted">Wallet apps on this phone</p>
                <ul className="flex flex-col gap-2">
                  <li>
                    <a
                      href={metaMaskAppLink()}
                      className="flex h-14 w-full items-center justify-between rounded-md border border-border bg-surface px-3.5 text-left hover:border-action-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
                    >
                      <span className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border-control bg-bg text-[13px] font-medium">M</span>
                        <span className="flex flex-col">
                          <span className="text-[15px] font-medium">MetaMask</span>
                          <span className="text-[12px] text-ink-muted">Opens Confluence in the MetaMask app</span>
                        </span>
                      </span>
                      <span aria-hidden="true" className="text-ink-muted">
                        ↗
                      </span>
                    </a>
                  </li>
                </ul>
              </>
            )}
            {others.length > 0 && (
              <>
                <p className="text-xs text-ink-muted">{detected.length > 0 || showMetaMaskApp ? "Other options" : "Connect with"}</p>
                <ul className="flex flex-col gap-2">{others.map((c) => row(c))}</ul>
              </>
            )}
            {mobile && detected.length === 0 && !searching && (
              <p className="text-xs text-ink-muted">
                Tip: on a phone, opening Confluence inside your wallet app&apos;s browser gives the smoothest experience.
              </p>
            )}
            {detected.length === 0 && searching && (
              <p className="text-xs text-ink-muted" aria-live="polite">
                Looking for wallets in this browser...
              </p>
            )}
            {detected.length === 0 && !searching && others.length === 0 && (
              <p className="text-sm text-ink-muted">No wallets available. Install a browser wallet such as MetaMask or Rabby.</p>
            )}
          </div>
        )}

        {view.kind === "connecting" && (
          <div className="mt-6 flex flex-col items-center gap-3 py-6 text-center">
            <WalletIcon connector={view.connector} />
            <p className="text-sm">Confirm the connection in {walletName(view.connector)}...</p>
            <button type="button" onClick={() => setView({ kind: "list" })} className="text-[13px] text-action-text">
              Back to all wallets
            </button>
          </div>
        )}

        {view.kind === "qr" && (
          <div className="mt-4 flex flex-col gap-3">
            {mobile && (
              // WalletConnect pairing link: wallet apps that support WalletConnect register it,
              // so the phone offers to open one (WalletConnect mobile linking).
              <a
                href={view.uri}
                className="flex h-11 items-center justify-center rounded-md bg-action text-sm font-medium text-on-action hover:bg-action-hover"
              >
                Open wallet app
              </a>
            )}
            {mobile && <p className="text-center text-xs text-ink-muted">or scan from another device</p>}
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
    </div>,
    document.body,
  );
}
