import { Section } from "@/components/Section";
import { APP_URL } from "@/lib/site";

/**
 * What we offer (confluence:landing-l2). One row per product, in the order of the app's
 * header. Facts match the published docs (docs.confluencebuild.xyz/products).
 */
const PRODUCTS: {
  name: React.ReactNode;
  plain: string;
  what: string;
  facts: string[];
  cta: string;
  href: string;
}[] = [
  {
    name: "Bridge",
    plain: "Bridge",
    what: "Move USDC into and out of Arc, and between other supported chains, through Circle's Cross-Chain Transfer Protocol.",
    facts: [
      "Burned on one chain, minted fresh on the other: always native USDC",
      "Fast or Standard, your choice on every transfer",
      "Circle's Forwarding Service delivers the mint for you",
    ],
    cta: "Open Bridge",
    href: APP_URL,
  },
  {
    name: "Swap",
    plain: "Swap",
    what: "Swap tokens on the same chain through Circle's App Kit: USDC, EURC, USDT and each chain's native token where available, plus cirBTC on Arc and Ethereum.",
    facts: ["Minimum received shown before you sign", "Slippage of 0.5%, 1% or 3%, with 1% by default"],
    cta: "Open Swap",
    href: `${APP_URL}/swap`,
  },
  {
    name: (
      <>
        Pay by <span className="font-mono tracking-[-0.03em]">@name</span>
      </>
    ),
    plain: "Pay",
    what: "Claim a Confluence ID and get paid without sharing a long address. Send to any ID from Arc or from another chain, and it always lands on Arc.",
    facts: [
      "Free from Arc to an ID: one transfer, one confirmation",
      "Pay links and QR codes to get paid",
      "Warnings for look-alike IDs and first payments",
    ],
    cta: "Open Pay",
    href: `${APP_URL}/pay`,
  },
  {
    name: "Relay routes",
    plain: "Relay",
    what: "Reach the wider set of chains and tokens that Relay supports, from the same Bridge and Swap pages, with one switch.",
    facts: ["Every quote checked against Relay's published contracts", "Refunds always go back to your own wallet"],
    cta: "Open Bridge",
    href: APP_URL,
  },
];

export function Offer() {
  return (
    <Section
      id="offer"
      title="Everything USDC needs around Arc, in one app"
      intro="Bridge it, swap it, or send it to a name. Each one runs on infrastructure built by Circle or Relay, and you sign every step."
    >
      <ul className="flex flex-col">
        {PRODUCTS.map((p) => (
          <li
            key={p.plain}
            className="grid gap-4 border-t border-border py-8 last:border-b sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:gap-8 lg:grid-cols-[16rem_minmax(0,1fr)_auto]"
          >
            <h3 className="text-2xl font-medium tracking-[-0.01em]">{p.name}</h3>
            <div className="flex max-w-[36rem] flex-col gap-3">
              <p className="leading-relaxed">{p.what}</p>
              <ul className="flex flex-col gap-1.5 text-sm text-ink-muted">
                {p.facts.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-destination" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={p.href}
              aria-label={`${p.cta} in the Confluence app`}
              className="inline-flex h-10 items-center self-start rounded-md border border-border-control px-4 text-sm font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
            >
              {p.cta}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
