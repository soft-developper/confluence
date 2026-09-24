import Image from "next/image";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-18 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2.5">
          <Image src="/confluence-mark.svg" alt="" width={24} height={30} priority />
          <span className="text-lg font-medium">Confluence</span>
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-14">
        <section className="w-full max-w-[460px] rounded-lg border border-border bg-surface p-6">
          <h1 className="text-[22px] font-medium">Stage 0 scaffold</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Brand tokens, fonts and theme switching are wired. The bridge arrives in Stage 2.
          </p>
          <p className="mt-6 text-sm text-ink-muted">You receive</p>
          <p className="tnum text-[34px] leading-10 font-medium">
            999.70 <span className="text-base text-ink-muted">USDC</span>
          </p>
          <p className="mt-2 font-mono text-[13px] text-ink-muted">0x17a4...94F2</p>
          <div className="mt-6 flex gap-2">
            <span className="rounded-sm bg-source px-2 py-0.5 font-mono text-xs text-on-signal">Source</span>
            <span className="rounded-sm bg-action px-2 py-0.5 font-mono text-xs text-on-action">Confluence</span>
            <span className="rounded-sm bg-destination px-2 py-0.5 font-mono text-xs text-on-signal">Destination</span>
          </div>
        </section>
      </main>
    </div>
  );
}
