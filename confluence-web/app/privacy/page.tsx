import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";

// confluence:privacy-page
export const metadata: Metadata = {
  title: "Privacy Policy - Confluence",
  description: "What Confluence collects, why, and how it is handled.",
};

const EFFECTIVE_DATE = "28 September 2026";
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

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-[15px] leading-7 text-ink">
      <strong className="font-medium">{label}.</strong> {children}
    </p>
  );
}

export default function PrivacyPage() {
  return (
    <PageShell>
      <article className="w-full max-w-2xl space-y-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl">Privacy Policy</h1>
          <p className="text-sm text-ink-muted">Effective {EFFECTIVE_DATE}</p>
        </header>

        <P>
          This policy explains what information Confluence collects when you use app.confluencebuild.xyz, why, and how
          it is handled. Confluence is operated by {OPERATOR} (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
        </P>

        <div className="border-l-2 border-destination pl-5">
          <h2 className="text-lg font-medium text-ink">The short version</h2>
          <p className="mt-2 text-[15px] leading-7 text-ink">
            Confluence is non-custodial. We never hold your funds, never see your private keys, and don&rsquo;t ask for
            your name, email, phone number or ID to bridge or swap. We store only what the service needs to work: public
            wallet addresses, the details of transfers and swaps you start, and a few optional things you choose to save.
          </p>
        </div>

        <Section title="What we collect">
          <Item label="Wallet addresses">
            When you connect a wallet, we see its public address. When you get a quote or start a bridge or swap, we
            store the sending address and the recipient address.
          </Item>
          <Item label="Transfer and swap records">
            For each bridge or swap: source and destination chain, amount, the platform fee, whether Forwarding was used,
            its progress, any error code, and the on-chain transaction hashes. This lets us show your transaction page,
            track progress with Circle, and help with recovery if something stalls.
          </Item>
          <Item label="Account information (only if you sign in)">
            Signing in with your wallet (Sign-In with Ethereum) creates an account tied to your wallet address. If you
            claim a Confluence ID, it is stored with your address and is public, since other people use it to pay you.
            Confluence IDs are permanent once claimed.
          </Item>
          <Item label="Address book (only if you choose to sync)">
            Saved recipient addresses and the labels you give them are kept in your browser. If you sign in and sync, a
            copy is stored on our servers so it follows you to other devices. When you delete an entry, we keep a
            deletion marker so the removal syncs everywhere.
          </Item>
          <Item label="Relay routes">
            If you use the Relay option on the Bridge or Swap page, we record each request you start: its Relay request ID, your wallet address, the
            chains and tokens, the amounts, the quoted and paid Confluence app fee, the input&rsquo;s USD value as reported by Relay, its status and
            transaction hashes. This powers your history, status tracking and our fee accounting.
          </Item>
          <Item label="Sign-in sessions">
            When you sign in we issue a session that lasts up to 7 days. We store only a one-way hash of the session
            token, never the token itself.
          </Item>
          <Item label="Technical data">
            To protect the service from abuse, we briefly use your IP address to apply rate limits. This is held in
            memory only and not saved to our database.
          </Item>
        </Section>

        <Section title="What is stored in your browser">
          <P>
            Confluence uses your browser&rsquo;s local storage (not advertising cookies) for: your sign-in session, your
            address book, a private token for each transfer you start (so the transaction page can report progress, even
            from a new tab), and your light or dark theme choice. You can clear these at any time through your browser
            settings. Clearing them signs you out and removes any unsynced address book entries.
          </P>
        </Section>

        <Section title="What we don't do">
          <P>
            We don&rsquo;t sell your information. We don&rsquo;t use advertising or third-party tracking. We don&rsquo;t
            collect names, emails or identity documents from users of the app.
          </P>
        </Section>

        <Section title="Blockchain data is public">
          <P>
            Bridges and swaps happen on public blockchains. Your wallet address, amounts and transaction hashes are
            permanently visible to anyone on those networks, independently of Confluence. We can&rsquo;t change or
            delete information recorded on a blockchain.
          </P>
        </Section>

        <Section title="Services we rely on">
          <P>
            To move your assets, Confluence works with: <strong className="font-medium">Circle</strong> (CCTP bridging,
            attestations and the Forwarding Service, which receive the transfer details needed to move and mint your
            USDC); <strong className="font-medium">Relay</strong> (relay.link, for Relay routes: it receives your wallet
            address, the route and amounts to quote, execute and track them); <strong className="font-medium">public
            blockchain RPC providers</strong> (to read chain data and balances and send transactions you sign); and{" "}
            <strong className="font-medium">WalletConnect / Reown</strong> (if you connect through WalletConnect). Token and
            chain logos in the Relay picker load from the image addresses Relay publishes, so those hosts see a normal web
            request from your browser. Each service processes data under its own privacy policy.
          </P>
        </Section>

        <Section title="How long we keep information">
          <P>
            Transfer, swap and Relay request records are kept to support your transaction history and recovery. Transfers that fail
            before reaching any blockchain are deleted automatically after 24 hours, and unused quotes about an hour
            after they expire. Sessions stop working after 7 days. Accounts, Confluence IDs and synced address books are
            kept while the service operates.
          </P>
        </Section>

        <Section title="Children">
          <P>Confluence is not intended for anyone under 18.</P>
        </Section>

        <Section title="Changes to this policy">
          <P>
            If we change this policy, we&rsquo;ll update the effective date above. Significant changes will be noted on
            the site.
          </P>
        </Section>

        <Section title="Contact">
          <P>
            {OPERATOR},{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-action-text underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </P>
        </Section>
      </article>
    </PageShell>
  );
}
