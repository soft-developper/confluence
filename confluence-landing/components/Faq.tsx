import { Section } from "@/components/Section";
import { DOCS_URL } from "@/lib/site";

/**
 * FAQ (confluence:landing-l3). Short answers taken from the docs FAQ
 * (docs.confluencebuild.xyz/help/faq). Native <details>, so it works without script and
 * opens only when the visitor asks.
 */
const FAQ = [
  {
    q: "Does Confluence hold my funds?",
    a: "No. You sign every transaction in your own wallet, and funds move directly between your wallet and Circle's or Relay's contracts. We never have your keys.",
  },
  {
    q: "Is the USDC I receive wrapped?",
    a: "Not with the CCTP bridge. Circle burns USDC on one chain and mints native USDC on the other, so you always receive the same USDC Circle issues on that chain.",
  },
  {
    q: "Do I need an account?",
    a: "No. You can bridge, swap, pay an ID and use Relay routes with just a wallet. Signing in with your wallet unlocks your Profile, your Confluence ID and the rest of the Pay page.",
  },
  {
    q: "How much does it cost?",
    a: "Paying a Confluence ID from Arc is free. A CCTP bridge costs 0.30 USDC up to 1,000 USDC, and 0.30 USDC plus 0.01% of the part above 1,000 for larger bridges. Every fee, including Circle's and the network's, is on the quote before you sign.",
  },
  {
    q: "Can I cancel a transfer?",
    a: "Before you confirm in your wallet, yes: just don't sign. Once USDC is burned on the source chain, a CCTP transfer can't be cancelled; it always completes to the recipient you chose.",
  },
  {
    q: "What happens if Confluence goes offline?",
    a: "Your funds are on the blockchain, not with us. A burned CCTP transfer can still be completed with Circle's attestation, and Relay routes are delivered by Relay's own network.",
  },
  {
    q: "Can I change my Confluence ID?",
    a: "No. IDs are permanent once claimed and can't be changed or transferred, so choose carefully.",
  },
];

export function Faq() {
  return (
    <Section
      id="faq"
      band
      title="Questions, answered"
      intro={
        <>
          More in the{" "}
          <a href={`${DOCS_URL}/help/faq`} className="text-action-text underline-offset-4 hover:underline">
            full FAQ
          </a>{" "}
          and the docs.
        </>
      }
    >
      <div className="flex max-w-[52rem] flex-col">
        {FAQ.map((f) => (
          <details key={f.q} className="group border-t border-border last:border-b">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text [&::-webkit-details-marker]:hidden">
              {f.q}
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-45">
                <path d="M8 2v12M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </summary>
            <p className="max-w-[44rem] pb-6 leading-relaxed text-ink-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
