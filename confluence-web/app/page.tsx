import { ApiStatus } from "@/components/ApiStatus";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { BridgeCard } from "@/components/bridge/BridgeCard";

export default function Home() {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">
          <BridgeCard />
          <div className="w-full max-w-[460px]">
            <ApiStatus />
          </div>
        </main>
      </div>
    </Providers>
  );
}
