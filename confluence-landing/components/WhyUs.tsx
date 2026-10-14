import { Section } from "@/components/Section";

/**
 * Why our approach (confluence:landing-l2). The case for how Confluence is built, without
 * naming or comparing with anyone else. Every claim matches the published docs.
 */
const POINTS = [
  {
    title: "Real USDC, never a wrapped copy",
    body: "CCTP burns USDC on the chain you send from, and Circle mints the same amount fresh on the chain you send to. There is no pool to drain and no IOU token to redeem later.",
  },
  {
    title: "Built around Arc",
    body: "Arc is Circle's own blockchain, where even gas is paid in USDC. Confluence is designed for moving USDC in and out of it, and every payment by @name lands there.",
  },
  {
    title: "One app for three jobs",
    body: "Bridge, swap and pay from the same place, with one history in your Profile, and an address book that follows you across devices once you sign in.",
  },
  {
    title: "The price before the signature",
    body: "Our fee, Circle's or Relay's costs and the network's gas are all on the quote, with the total that leaves your wallet. Nothing is charged until you confirm.",
  },
  {
    title: "Built to finish what it starts",
    body: "Confluence tracks every transfer in the background. If a delivery stalls you can complete the mint yourself, and a burned transfer can always be finished with Circle's proof, even if Confluence is offline.",
  },
  {
    title: "Live, not hard-coded",
    body: "Chains and tokens come straight from Circle and Relay, so the app never offers a route that has stopped working.",
  },
];

export function WhyUs() {
  return (
    <Section
      id="why-confluence"
      title="Why Confluence is built this way"
      intro="Moving money across chains should be boring: the same amount out, the same amount in, and nothing to wonder about in between. These are the choices that keep it that way."
    >
      <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="flex flex-col gap-2 border-l-2 border-border-control pl-5">
            <h3 className="text-xl font-medium tracking-[-0.01em]">{p.title}</h3>
            <p className="max-w-[34rem] leading-relaxed text-ink-muted">{p.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
