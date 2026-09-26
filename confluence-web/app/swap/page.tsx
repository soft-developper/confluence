import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { SwapCard } from "@/components/swap/SwapCard";
import { MaintenanceGate } from "@/components/Maintenance";

export const metadata: Metadata = { title: "Swap - Confluence" };

export default function SwapPage() {
  return (
    <PageShell>
      <MaintenanceGate protocol="swap">
        <SwapCard />
      </MaintenanceGate>
    </PageShell>
  );
}
