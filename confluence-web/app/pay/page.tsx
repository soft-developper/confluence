import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { MaintenanceGate } from "@/components/Maintenance";
import { PayView } from "@/components/pay/PayView";

export const metadata: Metadata = { title: "Pay - Confluence" };

// Pay by ID moves USDC like a bridge, so the Bridge maintenance switch covers it (confluence:arc-pay).
export default function PayPage() {
  return (
    <PageShell>
      <MaintenanceGate protocol="bridge">
        <PayView />
      </MaintenanceGate>
    </PageShell>
  );
}
