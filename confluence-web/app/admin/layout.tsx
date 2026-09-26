import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

// Never indexed, never linked from the public site.
export const metadata: Metadata = {
  title: "Admin - Confluence",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
        <Link href="/admin" className="flex items-center gap-2 font-medium">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/confluence-mark.svg" alt="" width={24} height={24} />
          Confluence <span className="rounded-[4px] border border-border-control px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">Admin</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-8 pb-16">{children}</main>
    </div>
  );
}
