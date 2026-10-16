import { Section } from "@/components/Section";
import { Stats } from "@/components/Stats";
import type { StatSummary, StatsDashboard } from "@/lib/site";

/** Server wrapper for the stats section (confluence:landing-stats). Renders nothing when off. */
export function StatsSection({ stats }: { stats: { dashboard: StatsDashboard; summary: StatSummary } | null }) {
  if (!stats) return null;
  const slug = stats.dashboard.source === "defillama" ? stats.dashboard.defillamaSlug : null;
  return (
    <Section id="stats" band title="Confluence by the numbers" intro="Real activity, from transfers proven on-chain. No wallet addresses, just totals.">
      <Stats dashboard={stats.dashboard} summary={stats.summary} defillamaUrl={slug ? `https://defillama.com/protocol/${slug}` : null} />
    </Section>
  );
}
