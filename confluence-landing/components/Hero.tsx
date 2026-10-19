import { ConfluenceFlow } from "@/components/ConfluenceFlow";
import { APP_URL, DOCS_URL, type LandingChains } from "@/lib/site";

/**
 * Hero (confluence:landing). The tagline is the one locked in for positioning (Arc builders
 * and teams first); no fee wording here, the quote in the app shows fees. The picture on the
 * right is the live chain list flowing into Arc.
 */
export function Hero({ chains, defillamaUrl }: { chains: LandingChains; defillamaUrl: string | null }) {
  const arcName = chains.arc?.name ?? "Arc";
  const total = chains.others.length + (chains.arc ? 1 : 0);
  return (
    <section className="mx-auto grid w-full max-w-[1180px] items-center gap-10 px-4 pt-12 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pt-20 lg:pb-24">
      <div className="flex max-w-[34rem] flex-col gap-6">
        <h1 className="text-[2.5rem] leading-[1.04] font-medium tracking-[-0.025em] text-balance sm:text-[3.4rem] lg:text-[3.75rem]">
          Move USDC in and out of Arc, and pay anyone by <span className="font-mono tracking-[-0.04em]">@name</span>.
        </h1>
        <p className="max-w-[31rem] text-lg leading-relaxed text-ink-muted">
          Confluence is one app to bridge, swap and pay with USDC, built around Arc. Native USDC moves through Circle&rsquo;s CCTP, other chains
          and tokens through Relay, and you sign every step in your own wallet.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={APP_URL}
            className="inline-flex h-12 items-center rounded-md bg-action px-6 text-base font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            Launch app
          </a>
          <a
            href={DOCS_URL}
            className="inline-flex h-12 items-center rounded-md border border-border-control px-6 text-base font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            Read the docs
          </a>
        </div>
        <p className="border-l-2 border-destination pl-3 text-sm text-ink-muted">
          Confluence never holds your funds or your keys. Every transfer goes from your wallet straight to Circle or Relay.
        </p>
        {/* Public numbers on DefiLlama, shown when switched on in admin (confluence:defillama-link). */}
        {defillamaUrl && (
          <a
            href={defillamaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 self-start rounded-md text-sm font-medium text-action-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
              <path d="M2 13h12M4 11V7M8 11V3M12 11V6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            See Confluence&rsquo;s volume and users on DefiLlama
          </a>
        )}
      </div>

      <figure className="flex flex-col gap-3">
        <ConfluenceFlow chains={chains.others} arcName={arcName} max={10} labelSize={13} className="hidden sm:block" />
        <ConfluenceFlow chains={chains.others} arcName={arcName} max={6} labelSize={16} inset={70} className="sm:hidden" />
        {total > 0 && (
          <figcaption className="text-center text-sm text-balance text-ink-muted">
            {total} chains bridge native USDC through Confluence today, read live from the app.
          </figcaption>
        )}
      </figure>
    </section>
  );
}
