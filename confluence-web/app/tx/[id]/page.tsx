import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { TransactionView } from "@/components/tx/TransactionView";

export const metadata: Metadata = { title: "Transfer - Confluence" };

// Next.js 16: route params arrive as a Promise.
export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">
          <TransactionView id={id} />
        </main>
      </div>
    </Providers>
  );
}
