import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EnvBadge } from "@/components/EnvBadge";
import { ApiStatus } from "@/components/ApiStatus";
import { Providers } from "@/components/Providers";
import { WalletButton } from "@/components/wallet/WalletButton";
import { BridgeCard } from "@/components/bridge/BridgeCard";

export default function Home() {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <header className="flex h-18 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/confluence-mark.svg" alt="" width={24} height={30} priority />
            <span className="text-lg font-medium">Confluence</span>
            <EnvBadge />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <WalletButton />
          </div>
        </header>
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
