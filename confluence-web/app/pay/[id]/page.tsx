import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { PayCard } from "@/components/pay/PayCard";

export const metadata: Metadata = { title: "Payment request - Confluence" };

// Next.js 16: route params arrive as a Promise.
export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">
          <PayCard id={id} />
        </main>
      </div>
    </Providers>
  );
}
