import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { SwapCard } from "@/components/swap/SwapCard";
import { MaintenanceGate } from "@/components/Maintenance";
import { ProtocolSwitch } from "@/components/relay/ProtocolSwitch";

export const metadata: Metadata = { title: "Swap - Confluence" };

export default function SwapPage() {
  return (
    <PageShell>
      <ProtocolSwitch preset="swap">
        <MaintenanceGate protocol="swap">
          <SwapCard />
        </MaintenanceGate>
      </ProtocolSwitch>
    </PageShell>
  );
}
