import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";

// confluence:terms-page
export const metadata: Metadata = {
  title: "Terms of Use - Confluence",
  description: "The terms that apply when you use Confluence.",
};

const EFFECTIVE_DATE = "27 September 2026";
const OPERATOR = "Softdeveloper";
const CONTACT_EMAIL = "support@confluencebuild.xyz";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-7 text-ink">{children}</p>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium">{children}</strong>;
}

const linkCls = "text-action-text underline-offset-4 hover:underline";

export default function TermsPage() {
  return (
    <PageShell>
      <article className="w-full max-w-2xl space-y-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl">Terms of Use</h1>
          <p className="text-sm text-ink-muted">Effective {EFFECTIVE_DATE}</p>
        </header>

        <div className="space-y-3">
          <P>
            These terms apply when you use Confluence at app.confluencebuild.xyz. Confluence is operated by {OPERATOR}{" "}
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By using Confluence you agree to these terms. If you don&rsquo;t agree,
            please don&rsquo;t use the service.
          </P>
          <P>
            See our{" "}
            <Link href="/privacy" className={linkCls}>
              Privacy Policy
            </Link>{" "}
            for how we handle data.
          </P>
        </div>

        <Section title="What Confluence is">
          <P>
            Confluence is an interface for moving USDC between blockchains and swapping tokens. Bridging runs on
            Circle&rsquo;s Cross-Chain Transfer Protocol (CCTP), which burns USDC on the source chain and mints it on the
            destination chain. Swaps run through Circle&rsquo;s App Kit.
          </P>
          <div className="border-l-2 border-destination pl-5">
            <p className="text-[15px] leading-7 text-ink">
              Confluence is non-custodial. We never hold your funds or your private keys. Every transaction is signed by
              you, in your own wallet, and you stay in control of your assets at all times.
            </p>
          </div>
        </Section>

        <Section title="Who can use it">
          <P>
            You must be at least 18 and able to enter into a binding agreement. You&rsquo;re responsible for making sure
            your use of Confluence is legal where you live.
          </P>
        </Section>

        <Section title="Your wallet and your responsibilities">
          <P>
            You&rsquo;re responsible for your wallet, its keys and its security. We can&rsquo;t recover lost keys,
            reverse transactions or access your wallet for you.
          </P>
          <P>
            Before you confirm a transfer, check the recipient address and the destination chain carefully. Confluence
            warns you about some risks, such as sending to a contract address or to an address that looks like one
            you&rsquo;ve used before, but these warnings can&rsquo;t catch every mistake.{" "}
            <B>Transactions on a blockchain are final.</B> Once USDC is burned on the source chain, the transfer
            can&rsquo;t be cancelled or reversed.
          </P>
        </Section>

        <Section title="Fees">
          <P>
            For each bridge, Confluence charges a platform fee of <B>0.30 USDC for amounts up to 1,000 USDC</B>, and{" "}
            <B>0.10% of the amount above 1,000 USDC</B>. The platform fee is added to the amount you send, so the
            recipient receives the amount you entered, less Circle&rsquo;s fees.
          </P>
          <P>
            Separately, Circle charges its own CCTP fee, and a Forwarding fee if you use Forwarding. You also pay network
            gas on the source chain, and on the destination chain if you complete a transfer yourself. Swaps have their
            own fee and a slippage limit, both shown before you confirm.
          </P>
          <P>
            Every fee is shown on the quote before you sign. Circle&rsquo;s fees on a quote are estimates and can change
            slightly by the time the transfer settles. A quote is valid for 60 seconds; after that you&rsquo;ll need a new
            one.
          </P>
        </Section>

        <Section title="Forwarding and completing transfers">
          <P>
            With Forwarding on, Circle&rsquo;s Forwarding Service mints your USDC on the destination chain for you. If you
            turn Forwarding off, or if forwarding stalls, you complete the transfer yourself from the transaction page
            (&ldquo;Complete mint&rdquo;), which needs gas on the destination chain. Transfer times depend on each
            blockchain&rsquo;s finality and on Circle&rsquo;s attestation service; the times shown in the app are
            estimates, not guarantees.
          </P>
        </Section>

        <Section title="Confluence IDs">
          <P>
            If you sign in, you can claim a Confluence ID so others can pay you by name. A Confluence ID is permanent once
            claimed and is tied to the wallet that claimed it. It can&rsquo;t be changed or transferred. Don&rsquo;t
            claim IDs that impersonate other people, brands or organizations.
          </P>
        </Section>

        <Section title="Availability">
          <P>
            We may add or remove supported chains, pause bridging or swapping for maintenance, or change features at any
            time. Transfers already in progress when this happens can still be tracked and completed. We try to keep
            Confluence running smoothly, but we don&rsquo;t guarantee it will be available without interruption or free
            of errors.
          </P>
        </Section>

        <Section title="Services we don't control">
          <P>
            Confluence depends on services we don&rsquo;t operate, including Circle (CCTP, attestations, Forwarding and
            App Kit), public blockchains and their RPC providers, and the wallet you connect. Delays, outages, fee changes
            or failures in these services are outside our control, and we&rsquo;re not responsible for them.
          </P>
        </Section>

        <Section title="Acceptable use">
          <P>
            Don&rsquo;t use Confluence to break any law, to move funds connected to crime, fraud or sanctioned persons,
            to interfere with the service or its security, or to access it by automated means in ways that harm other
            users. We may restrict access when we believe the service is being misused.
          </P>
        </Section>

        <Section title="No advice">
          <P>
            Nothing on Confluence is financial, investment, legal or tax advice. You make your own decisions about your
            transactions.
          </P>
        </Section>

        <Section title="No warranty">
          <P>
            Confluence is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We don&rsquo;t make promises
            about the service beyond what&rsquo;s written in these terms, including about its accuracy, reliability or
            fitness for a particular purpose.
          </P>
        </Section>

        <Section title="Limitation of liability">
          <P>
            To the fullest extent allowed by law, we aren&rsquo;t liable for any loss arising from your use of
            Confluence, including losses from mistakes in addresses or chains, blockchain or smart contract failures,
            actions or failures of Circle or other third parties, delays, or unauthorized access to your wallet. Where
            liability can&rsquo;t be excluded, it is limited to the platform fees you paid us for the transaction in
            question.
          </P>
        </Section>

        <Section title="Changes to these terms">
          <P>
            We may update these terms. When we do, we&rsquo;ll change the effective date above. Continuing to use
            Confluence after a change means you accept the updated terms.
          </P>
        </Section>

        <Section title="Contact">
          <P>
            {OPERATOR},{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={linkCls}>
              {CONTACT_EMAIL}
            </a>
          </P>
        </Section>
      </article>
    </PageShell>
  );
}
