import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./globals.css";
import { themeInitScript } from "@/components/theme";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BackgroundMarks } from "@/components/BrandMarks";

// Never indexed, never linked from the public site.
export const metadata: Metadata = {
  title: "Admin - Confluence",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <div className="relative isolate flex min-h-screen flex-col">
          <BackgroundMarks />
          {/* Locked at the top while scrolling; the dashboard's section tabs lock right under it. */}
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/80 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-medium">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/confluence-mark.svg" alt="" width={24} height={24} />
              Confluence <span className="rounded-[4px] border border-border-control px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">Admin</span>
            </Link>
            <ThemeToggle />
          </header>
          <main className="flex flex-1 flex-col items-center px-4 pt-8 pb-16">{children}</main>
        </div>
      </body>
    </html>
  );
}
