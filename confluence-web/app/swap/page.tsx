import type { Metadata } from "next";
import { ApiStatus } from "@/components/ApiStatus";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { SwapCard } from "@/components/swap/SwapCard";

export const metadata: Metadata = { title: "Swap - Confluence" };

export default function SwapPage() {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">
          <SwapCard />
          <div className="w-full max-w-[460px]">
            <ApiStatus />
          </div>
        </main>
      </div>
    </Providers>
  );
}
