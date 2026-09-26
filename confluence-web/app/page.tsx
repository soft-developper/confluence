import { PageShell } from "@/components/PageShell";
import { BridgeCard } from "@/components/bridge/BridgeCard";
import { MaintenanceGate } from "@/components/Maintenance";

export default function Home() {
  return (
    <PageShell>
      <MaintenanceGate protocol="bridge">
        <BridgeCard />
      </MaintenanceGate>
    </PageShell>
  );
}
