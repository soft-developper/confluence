import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";
import { MaintenanceBanner } from "@/components/Maintenance";
import { BackgroundMarks } from "@/components/BrandMarks";

/** Every page: providers, header, page content, footer. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="relative isolate flex min-h-screen flex-col">
        <BackgroundMarks />
        <AppHeader />
        <MaintenanceBanner />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">{children}</main>
        <SiteFooter />
      </div>
    </Providers>
  );
}
