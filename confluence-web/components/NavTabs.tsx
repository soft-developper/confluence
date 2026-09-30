"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const DOCS_URL = "https://docs.confluencebuild.xyz";

const TABS = [
  { href: "/", label: "Bridge" },
  { href: "/swap", label: "Swap" },
  { href: "/profile", label: "Profile" },
] as const;

export function NavTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium sm:py-1.5 ${active ? "bg-surface text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
      {/* Docs live on their own site (docs.confluencebuild.xyz); opens in a new tab so the app stays open. */}
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink sm:py-1.5"
      >
        Docs
      </a>
    </nav>
  );
}
