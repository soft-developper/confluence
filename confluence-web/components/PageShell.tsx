import { AppHeader } from "@/components/AppHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MaintenanceBanner } from "@/components/Maintenance";
import { BackgroundMarks } from "@/components/BrandMarks";

/** Every page: a sticky header, page content, footer. Providers live in app/layout.tsx (confluence:single-providers). */
export function PageShell({ children }: { children: React.ReactNode }) {
  // Compact spacing on phones (confluence:mobile-spacing). min-h-dvh is the visible screen
  // height; min-h-screen (100vh) counts the area behind mobile browser toolbars, which pushed
  // the footer below the fold and left an empty band above it.
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <BackgroundMarks />
      {/* Header (and the maintenance banner, when shown) stay locked at the top while scrolling. */}
      <div className="sticky top-0 z-40 bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
        <AppHeader />
        <MaintenanceBanner />
      </div>
      <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-6 pb-8 sm:pt-10 sm:pb-16">{children}</main>
      <SiteFooter />
    </div>
  );
}
