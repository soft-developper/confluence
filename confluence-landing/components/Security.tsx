import { Section } from "@/components/Section";
import { APP_URL, DOCS_URL, PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from "@/lib/site";

/**
 * Security and trust (confluence:landing-l3). The short public version of the docs' safety
 * page (docs.confluencebuild.xyz/safety). Operator-only details (fee multisig, admin
 * protections) stay out, as in the public docs.
 */
const PROTECTIONS = [
  {
    title: "You sign everything",
    body: "Every approval, burn, swap and Relay transfer is a transaction you review in your own wallet. Confluence cannot move, pause or reverse your funds.",
  },
  {
    title: "No contracts of our own",
    body: "Your funds only ever go to Circle's and Relay's contracts. Confluence has no custom smart contract sitting between you and them.",
  },
  {
    title: "Relay quotes verified first",
    body: "Each transaction and approval in a Relay quote is checked against Relay's published contracts and your request. A quote that fails is never shown.",
  },
  {
    title: "Warnings before you send",
    body: "Look-alike addresses and IDs, contract recipients and low gas are flagged before your wallet is asked for anything.",
  },
  {
    title: "Refunds come back to you",
    body: "If a Relay route cannot complete, its refund is always addressed to your own wallet on the chain you paid from.",
  },
  {
    title: "Signing in moves nothing",
    body: "Sign-In with Ethereum is a free message, not a transaction. Only a one-way fingerprint of your session is stored.",
  },
];

export function Security() {
  return (
    <Section
      id="security"
      band
      title="Security and trust, from the first click"
      intro="Confluence never holds your funds or your keys. Everything else on this list builds on that one choice."
    >
      <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {PROTECTIONS.map((p) => (
          <div key={p.title} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2.5 text-lg font-medium">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-destination-text">
                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {p.title}
            </h3>
            <p className="leading-relaxed text-ink-muted">{p.body}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-warning/50 p-5 sm:flex-row sm:items-start sm:gap-8 sm:p-6">
        <p className="font-medium sm:w-[16rem] sm:shrink-0">Protect yourself</p>
        <p className="leading-relaxed text-ink-muted">
          Confluence will never ask for your seed phrase or private key, and never messages you first. Before you connect, check that the address
          is <span className="font-mono text-ink">{new URL(APP_URL).host}</span>.
        </p>
      </div>

      <p className="text-sm text-ink-muted">
        <a href={`${DOCS_URL}/safety`} className="text-action-text underline-offset-4 hover:underline">
          Read how we keep you safe
        </a>
        , our{" "}
        <a href={PRIVACY_URL} className="text-action-text underline-offset-4 hover:underline">
          Privacy policy
        </a>{" "}
        and{" "}
        <a href={TERMS_URL} className="text-action-text underline-offset-4 hover:underline">
          Terms of Use
        </a>
        . Found a security issue? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-action-text underline-offset-4 hover:underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </Section>
  );
}
