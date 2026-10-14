import { Section } from "@/components/Section";
import type { LandingChains } from "@/lib/site";

/**
 * Built with, and where USDC can go (confluence:landing-l3). The stack as text, not logos
 * (third-party brand guidelines not checked). No hosting providers are named. The chain list
 * is the same live list as the hero.
 */
const STACK = [
  { name: "Arc", role: "Circle's blockchain and Confluence's home chain. Gas is paid in USDC." },
  { name: "Circle CCTP", role: "Burns USDC on one chain and mints native USDC on another." },
  { name: "Circle App Kit", role: "Runs bridge transfers and same-chain swaps." },
  { name: "Circle Forwarding Service", role: "Delivers the mint on the destination chain for you." },
  { name: "Relay", role: "Routes to the wider set of chains and tokens it supports." },
  { name: "Sign-In with Ethereum", role: "Wallet sign-in for your Profile and Confluence ID, with no password." },
];

export function BuiltWith({ chains }: { chains: LandingChains }) {
  const all = [...(chains.arc ? [chains.arc] : []), ...chains.others];
  return (
    <Section
      id="built-with"
      title="Built on Arc, powered by Circle"
      intro="Confluence puts a clear, careful interface on infrastructure built by Circle and Relay, and follows their official documentation for every step."
    >
      <dl className="grid gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {STACK.map((s) => (
          <div key={s.name} className="flex flex-col gap-1 border-t border-border pt-4">
            <dt className="font-medium">{s.name}</dt>
            <dd className="text-ink-muted">{s.role}</dd>
          </div>
        ))}
      </dl>

      {all.length > 0 && (
        <div className="flex flex-col gap-4 pt-4">
          <h3 className="text-xl font-medium">Where your USDC can go</h3>
          <ul aria-label="Chains the Bridge supports" className="flex flex-wrap gap-2">
            {all.map((c) => (
              <li
                key={c.id}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  c === chains.arc ? "border-action bg-action text-on-action" : "border-border-control text-ink"
                }`}
              >
                {c.name}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-muted">
            The chains the Bridge offers today, read live from the app. Relay routes reach more chains and tokens on top of these.
          </p>
        </div>
      )}
    </Section>
  );
}
