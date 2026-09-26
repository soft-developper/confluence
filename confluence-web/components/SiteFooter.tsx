"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchFooter, type FooterContent } from "@/lib/api";
import { publicEnv } from "@/lib/env";
import { useBridgeChains } from "@/components/Providers";
import { ApiStatus } from "@/components/ApiStatus";
import pkg from "../package.json";

/**
 * Site footer. Editable content (built by, privacy, terms, copyright, socials, network
 * override) comes from the API's footer settings, edited from the admin dashboard, and
 * each item stays hidden until it is set. The rest is automatic.
 */
function Watermark() {
  // The Confluence mark (public/confluence-mark.svg) drawn large and faint behind the footer.
  return (
    <svg
      aria-hidden="true"
      viewBox="75 48 540 666"
      className="pointer-events-none absolute -right-10 -bottom-24 h-[360px] w-auto opacity-[0.07] dark:opacity-[0.09] sm:h-[440px]"
    >
      <g fill="none" strokeLinecap="round" strokeWidth="64">
        <path d="M115 88C115 190 175 238 245 297C305 348 342 390 342 492" stroke="#2F80EC" />
        <path d="M568 88C568 190 508 240 440 298C380 350 342 392 342 492" stroke="#18B6A7" />
        <path d="M342 498V670" stroke="#5D5AEF" />
      </g>
    </svg>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
      {children}
    </a>
  );
}

export function SiteFooter() {
  const { chains } = useBridgeChains();
  const q = useQuery({ queryKey: ["site-footer"], queryFn: fetchFooter, staleTime: 60_000, retry: 1 });
  const f: FooterContent | undefined = q.data;

  // Network badge: automatic from the chain list (Arc Testnet now, Arc after launch),
  // unless the admin set an override.
  const arc = chains.find((c) => /^arc/i.test(c.id));
  let explorer: string | undefined;
  try {
    explorer = arc ? new URL(arc.explorerTxUrl.replace("{hash}", "0x")).origin : undefined;
  } catch {
    explorer = undefined;
  }
  const networkLabel = f?.network?.label ?? (arc ? `${arc.name} · ${arc.evmChainId}` : undefined);
  const networkUrl = f?.network ? f.network.url : explorer;
  const testnet = publicEnv.confluenceEnv === "testnet";

  const legal = [
    f?.builtBy ? (
      <span key="built">
        Built by {f.builtBy.url ? <ExternalLink href={f.builtBy.url}>{f.builtBy.name}</ExternalLink> : f.builtBy.name}
      </span>
    ) : null,
    f?.privacyUrl ? (
      <ExternalLink key="privacy" href={f.privacyUrl}>
        Privacy
      </ExternalLink>
    ) : null,
    f?.termsUrl ? (
      <ExternalLink key="terms" href={f.termsUrl}>
        Terms
      </ExternalLink>
    ) : null,
    f?.copyright ? <span key="copy">{f.copyright}</span> : null,
  ].filter(Boolean);

  return (
    <footer className="relative mt-auto overflow-hidden border-t border-border bg-surface">
      <Watermark />
      <div className="relative mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <span className="text-lg font-medium">Confluence</span>
            <p className="max-w-[320px] text-sm text-ink-muted">USDC across chains, centered on Arc.</p>
            {networkLabel && (
              <span className="inline-flex flex-wrap items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-destination" aria-hidden="true" />
                {networkUrl ? <ExternalLink href={networkUrl}>{networkLabel}</ExternalLink> : networkLabel}
                {testnet && (
                  <span className="rounded-[4px] border border-warning px-1.5 py-0.5 font-mono text-[11px] text-warning">Testnet: no real funds</span>
                )}
              </span>
            )}
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-2 text-sm text-ink-muted">
            <span className="text-xs font-medium tracking-wide uppercase">Product</span>
            <Link href="/" className="hover:text-ink hover:underline">
              Bridge
            </Link>
            <Link href="/swap" className="hover:text-ink hover:underline">
              Swap
            </Link>
            <Link href="/profile" className="hover:text-ink hover:underline">
              Profile
            </Link>
          </nav>

          <div className="flex flex-col gap-2 text-sm text-ink-muted">
            <span className="text-xs font-medium tracking-wide uppercase">Built on</span>
            <ExternalLink href="https://developers.circle.com/cctp">Circle CCTP</ExternalLink>
            <ExternalLink href="https://www.arc.io">Arc</ExternalLink>
            {f?.socials.map((s) => (
              <ExternalLink key={s.url} href={s.url}>
                {s.label}
              </ExternalLink>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-5 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {legal.map((item, i) => (
              <span key={i} className="flex items-center gap-3">
                {i > 0 && <span aria-hidden="true">•</span>}
                {item}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <ApiStatus compact />
            <span className="font-mono">v{pkg.version}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
