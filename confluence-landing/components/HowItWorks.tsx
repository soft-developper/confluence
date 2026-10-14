import { Section } from "@/components/Section";
import { DOCS_URL } from "@/lib/site";

/**
 * How it works (confluence:landing-l2). A real sequence, so the steps are numbered and joined
 * by one line: across on wide screens, down on phones.
 */
const STEPS = [
  {
    title: "Connect your wallet",
    body: "A browser wallet, or a mobile wallet through WalletConnect. No account is needed to bridge or swap.",
  },
  {
    title: "Pick a route",
    body: "Choose the chains, tokens and amount. The quote shows every fee and the total that leaves your wallet.",
  },
  {
    title: "Sign each step",
    body: "You approve and confirm every transaction in your own wallet. Confluence cannot move funds without you.",
  },
  {
    title: "Watch it land",
    body: "Your transaction page and Profile history follow each transfer until it arrives, even after you close the page.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      band
      title="Four steps, and you sign every one"
      intro={
        <>
          Confluence prepares each step, checks it and shows you exactly what will happen. The money only moves when your wallet says so.{" "}
          <a href={`${DOCS_URL}/how-it-works`} className="text-action-text underline-offset-4 hover:underline">
            See what happens behind the scenes
          </a>
          .
        </>
      }
    >
      <ol className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {/* The line joining the steps (wide screens: across the numbers). */}
        <span aria-hidden="true" className="absolute top-5 right-[12%] left-5 hidden h-px bg-border-control lg:block" />
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 lg:flex-col">
            <span className="tnum relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-control bg-surface font-mono text-sm">
              {i + 1}
            </span>
            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-medium">{s.title}</h3>
              <p className="leading-relaxed text-ink-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
