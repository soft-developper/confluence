import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EnvBadge } from "@/components/EnvBadge";
import { WalletButton } from "@/components/wallet/WalletButton";
import { NavTabs } from "@/components/NavTabs";
import { SessionSync } from "@/components/SessionSync";

export function AppHeader() {
  return (
    <header className="flex flex-col border-b border-border">
      {/* Address book sync while signed in; renders nothing. */}
      <SessionSync />
      <div className="flex h-18 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="flex items-center gap-2.5"
            aria-label="Confluence home"
          >
            <Image
              src="/confluence-mark.svg"
              alt=""
              width={24}
              height={30}
              priority
            />
            {/* Wordmark hidden on phones so the header fits 390px (logo, env badge, theme, wallet). */}
            <span className="hidden text-lg font-medium sm:inline">Confluence</span>
          </Link>
          <EnvBadge />
          <div className="ml-2 hidden sm:block">
            <NavTabs />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
      <div className="flex justify-center pb-2 sm:hidden">
        <NavTabs />
      </div>
    </header>
  );
}
