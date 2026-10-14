import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { PayTabs } from "@/components/pay/PayTabs";

/**
 * Pay links (confluence:pay-receive): /pay/@name (or /pay/name) opens Send filled in with
 * that Confluence ID. The ID is still checked live before anything can be sent.
 */
const ID = /^[a-z0-9_]{3,20}$/;

function handleOf(raw: string): string | undefined {
  let h = raw;
  try {
    h = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  h = h.trim().replace(/^@+/, "").toLowerCase();
  return ID.test(h) ? h : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const h = handleOf((await params).handle);
  if (!h) return { title: "Pay - Confluence" };
  return {
    title: `Pay @${h} - Confluence`,
    description: `Send USDC to @${h} on Confluence, from Arc or any supported chain. It arrives on Arc.`,
  };
}

export default async function PayLinkPage({ params }: { params: Promise<{ handle: string }> }) {
  const h = handleOf((await params).handle);
  return (
    <PageShell>
      <PayTabs {...(h ? { initialHandle: h } : {})} />
    </PageShell>
  );
}
