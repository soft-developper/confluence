"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-surface text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
