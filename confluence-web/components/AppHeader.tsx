import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EnvBadge } from "@/components/EnvBadge";
import { WalletButton } from "@/components/wallet/WalletButton";

export function AppHeader() {
  return (
    <header className="flex h-18 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
      <div className="flex items-center gap-2.5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Confluence home">
          <Image src="/confluence-mark.svg" alt="" width={24} height={30} priority />
          <span className="text-lg font-medium">Confluence</span>
        </Link>
        <EnvBadge />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <WalletButton />
      </div>
    </header>
  );
}
