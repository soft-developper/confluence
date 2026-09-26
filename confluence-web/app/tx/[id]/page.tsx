import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { TransactionView } from "@/components/tx/TransactionView";

export const metadata: Metadata = { title: "Transfer - Confluence" };

// Next.js 16: route params arrive as a Promise.
export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageShell>
      <TransactionView id={id} />
    </PageShell>
  );
}
