import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { SiteFooter } from "@/components/SiteFooter";

/** Every page: providers, header, page content, footer. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">{children}</main>
        <SiteFooter />
      </div>
    </Providers>
  );
}
