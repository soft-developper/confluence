import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EnvBadge } from "@/components/EnvBadge";
import { ApiStatus } from "@/components/ApiStatus";
import { Providers } from "@/components/Providers";
import { WalletButton } from "@/components/wallet/WalletButton";
import { UsdcBalance } from "@/components/wallet/UsdcBalance";

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
        <main className="flex flex-1 items-start justify-center px-4 pt-14">
          <section className="w-full max-w-[460px] rounded-lg border border-border bg-surface p-6">
            <h1 className="text-[22px] font-medium">Wallet layer</h1>
            <p className="mt-2 text-sm text-ink-muted">Connect a wallet to check the Stage 2b wallet layer. The bridge form arrives in 2c.</p>
            <div className="mt-6">
              <UsdcBalance />
            </div>
            <ApiStatus />
          </section>
        </main>
      </div>
    </Providers>
  );
}
