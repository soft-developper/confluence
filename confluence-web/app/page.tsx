import { PageShell } from "@/components/PageShell";
import { BridgeCard } from "@/components/bridge/BridgeCard";
import { MaintenanceGate } from "@/components/Maintenance";
import { ProtocolSwitch } from "@/components/relay/ProtocolSwitch";

export default function Home() {
  return (
    <PageShell>
      <ProtocolSwitch preset="bridge">
        <MaintenanceGate protocol="bridge">
          <BridgeCard />
        </MaintenanceGate>
      </ProtocolSwitch>
    </PageShell>
  );
}
