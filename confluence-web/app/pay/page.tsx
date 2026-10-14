import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { PayTabs } from "@/components/pay/PayTabs";

export const metadata: Metadata = { title: "Pay - Confluence" };

export default function PayPage() {
  return (
    <PageShell>
      <PayTabs />
    </PageShell>
  );
}
