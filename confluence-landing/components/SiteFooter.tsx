import { Mark } from "@/components/BrandMarks";
import { APP_URL, DOCS_URL, PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, type LandingFooter } from "@/lib/site";

/**
 * Landing footer (confluence:landing). Built by, copyright and socials come from the same
 * admin-edited footer settings as the app, and each stays hidden until it is set.
 */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = !href.startsWith(APP_URL) && !href.startsWith("mailto:");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="rounded-sm hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-action-text"
    >
      {children}
    </a>
  );
}

export function SiteFooter({ footer, defillamaUrl }: { footer: LandingFooter; defillamaUrl: string | null }) {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-border bg-surface">
      <Mark className="absolute -right-10 -bottom-24 h-[360px] w-auto opacity-[0.07] sm:h-[440px] dark:opacity-[0.09]" />
      <div className="relative mx-auto grid w-full max-w-[1180px] grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 sm:grid-cols-[1.6fr_1fr_1fr_1fr] sm:px-6 sm:py-14">
        <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
          <span className="text-lg font-medium">Confluence</span>
          <p className="max-w-[300px] text-sm text-ink-muted">Move USDC in and out of Arc, and pay anyone by @name.</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            {footer.builtBy && (
              <span>
                Built by {footer.builtBy.url ? <FooterLink href={footer.builtBy.url}>{footer.builtBy.name}</FooterLink> : footer.builtBy.name}
              </span>
            )}
            <FooterLink href={PRIVACY_URL}>Privacy</FooterLink>
            <FooterLink href={TERMS_URL}>Terms</FooterLink>
            {footer.copyright && <span>{footer.copyright}</span>}
          </div>
        </div>

        <nav aria-label="Product" className="flex flex-col gap-2 text-sm text-ink-muted">
          <span className="font-medium text-ink">Product</span>
          <FooterLink href={APP_URL}>Bridge</FooterLink>
          <FooterLink href={`${APP_URL}/swap`}>Swap</FooterLink>
          <FooterLink href={`${APP_URL}/pay`}>Pay</FooterLink>
          <FooterLink href={DOCS_URL}>Docs</FooterLink>
          {defillamaUrl && <FooterLink href={defillamaUrl}>Stats on DefiLlama</FooterLink>}
        </nav>

        <div className="flex flex-col gap-2 text-sm text-ink-muted">
          <span className="font-medium text-ink">Built on</span>
          <FooterLink href="https://www.arc.io">Arc</FooterLink>
          <FooterLink href="https://developers.circle.com/cctp">Circle CCTP</FooterLink>
          <FooterLink href="https://relay.link">Relay</FooterLink>
        </div>

        <div className="flex flex-col gap-2 text-sm text-ink-muted">
          <span className="font-medium text-ink">Contact</span>
          <FooterLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</FooterLink>
          {footer.socials.map((s) => (
            <FooterLink key={s.url} href={s.url}>
              {s.label}
            </FooterLink>
          ))}
        </div>
      </div>
    </footer>
  );
}
