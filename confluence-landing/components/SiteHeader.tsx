import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { APP_URL, DOCS_URL } from "@/lib/site";

/**
 * Landing header (confluence:landing). Logo and name return to the top of the landing page,
 * like the app's logo will once the root domain points here. Launch app opens the app in the
 * same tab: it is where the visitor is going next.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Confluence home" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-action-text">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/confluence-mark.svg" alt="" width={22} height={27} />
          <span className="text-lg font-medium">Confluence</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <a
            href={DOCS_URL}
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-action-text sm:block"
          >
            Docs
          </a>
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <a
            href={APP_URL}
            className="inline-flex h-10 items-center rounded-md bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            Launch app
          </a>
        </nav>
      </div>
    </header>
  );
}
