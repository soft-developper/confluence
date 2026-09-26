import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { MaintenanceBanner } from "@/components/Maintenance";
import { BackgroundMarks } from "@/components/BrandMarks";

/** Every page: providers, a sticky header, page content, footer. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="relative isolate flex min-h-screen flex-col">
        <BackgroundMarks />
        {/* Header (and the maintenance banner, when shown) stay locked at the top while scrolling. */}
        <div className="sticky top-0 z-40 bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
          <AppHeader />
          <MaintenanceBanner />
        </div>
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">{children}</main>
        <SiteFooter />
      </div>
    </Providers>
  );
}
