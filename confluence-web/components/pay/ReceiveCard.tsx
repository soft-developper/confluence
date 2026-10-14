"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMe, SessionExpiredError } from "@/lib/api";
import { shortAddress } from "@/lib/chains";
import { clearSession } from "@/lib/session";
import { IdAvatar } from "./PayView";

/**
 * Receive (confluence:pay-receive): your Confluence ID, a pay link and its QR code, and ways
 * to share them. Everything happens on this device: Share uses the phone's or computer's own
 * share sheet, Email opens your own mail app. Confluence never sends these messages, so its
 * domain can't be used to send "pay me" emails to strangers.
 */

export function payLinkFor(handle: string, origin: string): string {
  return `${origin}/pay/@${handle}`;
}

function Action({ children, onClick, href, download }: { children: React.ReactNode; onClick?: () => void; href?: string; download?: string }) {
  const cls =
    "flex h-11 flex-1 basis-0 items-center justify-center gap-1.5 rounded-md border border-border-control text-sm font-medium hover:border-action-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text";
  return href ? (
    <a href={href} download={download} className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

export function ReceiveCard({ token, address }: { token: string; address: string }) {
  const me = useQuery({
    queryKey: ["me", address],
    queryFn: async () => {
      try {
        return await fetchMe(token);
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        throw e;
      }
    },
    retry: false,
  });
  const id = me.data?.confluenceId ?? null;

  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = id && origin ? payLinkFor(id, origin) : "";

  // The QR is drawn on this device (no image service sees the link).
  const [svg, setSvg] = useState<string>("");
  const [png, setPng] = useState<string>("");
  useEffect(() => {
    if (!link) return;
    let alive = true;
    void import("qrcode").then(async (QR) => {
      // Always dark on white, in both themes: scanners need the contrast.
      const s = await QR.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0A121F", light: "#FFFFFF" } });
      const p = await QR.toDataURL(link, { width: 1024, margin: 3, errorCorrectionLevel: "M", color: { dark: "#0A121F", light: "#FFFFFF" } });
      if (alive) {
        setSvg(s);
        setPng(p);
      }
    });
    return () => {
      alive = false;
    };
  }, [link]);

  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the link stays visible to copy by hand
    }
  }
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function share() {
    if (!canShare) return void copy();
    try {
      await navigator.share({ title: "Pay me on Confluence", text: `Pay me @${id} on Confluence. It arrives as USDC on Arc.`, url: link });
    } catch {
      // closed the share sheet: nothing to do
    }
  }
  const mail = id
    ? `mailto:?subject=${encodeURIComponent(`Pay me on Confluence: @${id}`)}&body=${encodeURIComponent(
        `Hi,\n\nYou can pay me in USDC with my Confluence ID @${id}, from Arc or any supported chain:\n\n${link}\n\nThanks!`,
      )}`
    : "";

  return (
    <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="receive-title">
      <h1 id="receive-title" className="text-[22px] font-medium">
        Receive
      </h1>

      {me.isPending && <p className="text-sm text-ink-muted">Loading...</p>}
      {me.isError && <p className="text-sm text-danger">Could not load your Confluence ID.</p>}

      {me.data && !id && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Claim a Confluence ID first. Then anyone can pay you with @yourname instead of your 42-character address, from Arc or any supported chain.
          </p>
          <Link
            href="/profile"
            className="flex h-11 items-center justify-center rounded-md bg-action text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            Claim your ID in Profile
          </Link>
        </div>
      )}

      {id && (
        <>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg p-5 text-center">
            <IdAvatar handle={id} size={56} />
            <div className="flex flex-col">
              <span className="text-[22px] font-medium">@{id}</span>
              <span className="font-mono text-xs text-ink-muted">{shortAddress(address)}</span>
            </div>
            <div className="mt-1 rounded-lg bg-white p-3 shadow-sm">
              {svg ? (
                <div
                  role="img"
                  aria-label={`QR code for ${link}`}
                  className="h-48 w-48 [&>svg]:h-full [&>svg]:w-full"
                  // Generated on this device by the qrcode library from our own link.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ) : (
                <div className="h-48 w-48" aria-hidden="true" />
              )}
            </div>
            <span className="text-[13px] text-ink-muted">Scan to pay @{id}. It always arrives as USDC on Arc.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-muted">Your pay link</span>
            <div className="flex h-11 items-center gap-2 rounded-md border border-border-control bg-bg pr-1.5 pl-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{link}</span>
              <button
                type="button"
                onClick={() => void copy()}
                className="h-8 shrink-0 rounded-md border border-border-control px-3 text-xs font-medium hover:border-action-text"
                aria-live="polite"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            {/* Share only where the device has a share sheet; Copy sits next to the link everywhere. */}
            {canShare && <Action onClick={() => void share()}>Share</Action>}
            <Action href={mail}>Email</Action>
            {png && (
              <Action href={png} download={`confluence-pay-${id}.png`}>
                QR image
              </Action>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            Share opens your device&rsquo;s share sheet, and Email opens your own mail app, so messages come from you. Like any Confluence ID,
            your link shows your ID and wallet address to whoever opens it.
          </p>
        </>
      )}
    </section>
  );
}
