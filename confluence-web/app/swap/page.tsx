import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { SwapCard } from "@/components/swap/SwapCard";

export const metadata: Metadata = { title: "Swap - Confluence" };

export default function SwapPage() {
  return (
    <PageShell>
      <SwapCard />
    </PageShell>
  );
}
