import { z } from "zod";

/**
 * Landing page config and data (confluence:landing). The landing page carries no wallet code:
 * it reads two public API routes on the server (chains and footer) and re-reads them every few
 * minutes, so browsers never call the API and the API's CORS allowlist needs no change.
 * Every URL has a production default, so the Vercel project needs no environment variables.
 */
export const SITE_URL = process.env.LANDING_SITE_URL ?? "https://confluencebuild.xyz";
export const APP_URL = process.env.LANDING_APP_URL ?? "https://app.confluencebuild.xyz";
export const DOCS_URL = process.env.LANDING_DOCS_URL ?? "https://docs.confluencebuild.xyz";
const API_URL = process.env.LANDING_API_URL ?? "https://api.confluencebuild.xyz";

export const SUPPORT_EMAIL = "support@confluencebuild.xyz";
export const PRIVACY_URL = `${APP_URL}/privacy`;
export const TERMS_URL = `${APP_URL}/terms`;

/** How often (seconds) the server re-reads chains and footer from the API. */
const REVALIDATE = 300;

const ChainsSchema = z.object({
  chains: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isTestnet: z.boolean(),
      bridgeEnabled: z.boolean().optional(),
    }),
  ),
});

export interface LandingChain {
  id: string;
  name: string;
}

export interface LandingChains {
  /** Arc itself, when the API lists it. */
  arc: LandingChain | null;
  /** Every other chain switched on for the bridge, in the API's order. */
  others: LandingChain[];
}

/**
 * Chains switched on for the bridge, live from the API (never hard-coded). A chain switched
 * off in the admin dashboard drops off the landing page within REVALIDATE seconds. If the API
 * cannot be reached the page still renders, just without chain names.
 */
export async function getChains(): Promise<LandingChains> {
  try {
    const res = await fetch(`${API_URL}/chains`, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return { arc: null, others: [] };
    const { chains } = ChainsSchema.parse(await res.json());
    const on = chains.filter((c) => c.bridgeEnabled !== false).map(({ id, name }) => ({ id, name }));
    const arc = on.find((c) => /^arc/i.test(c.id)) ?? null;
    return { arc, others: on.filter((c) => c !== arc) };
  } catch {
    return { arc: null, others: [] };
  }
}

const HttpsLink = z.string().url();
const FooterSchema = z.object({
  settings: z.object({
    builtBy: z.object({ name: z.string(), url: HttpsLink.optional() }).nullable(),
    copyright: z.string().nullable(),
    socials: z.array(z.object({ label: z.string(), url: HttpsLink })),
  }),
});

export interface LandingFooter {
  builtBy: { name: string; url?: string } | null;
  copyright: string | null;
  socials: { label: string; url: string }[];
}

/** Footer content edited from the admin dashboard (same source as the app's footer). */
export async function getFooter(): Promise<LandingFooter> {
  try {
    const res = await fetch(`${API_URL}/site/footer`, { next: { revalidate: REVALIDATE } });
    if (!res.ok) return { builtBy: null, copyright: null, socials: [] };
    return FooterSchema.parse(await res.json()).settings;
  } catch {
    return { builtBy: null, copyright: null, socials: [] };
  }
}

// ---------- stats dashboard (confluence:landing-stats, D5) ----------

export const STAT_METRICS = ["bridgeVolume", "transactions", "activeWallets", "newWallets", "swapVolume", "arcPayVolume", "relayVolume", "chains"] as const;
export type StatMetric = (typeof STAT_METRICS)[number];
export type StatRange = "30d" | "90d" | "all";

const DashboardSchema = z.object({
  settings: z.object({
    enabled: z.boolean(),
    metrics: z.array(z.enum(STAT_METRICS)),
    range: z.enum(["30d", "90d", "all"]),
    source: z.enum(["confluence", "defillama"]),
    showDefillamaLink: z.boolean().optional(),
    defillamaSlug: z.string().nullable(),
  }),
});
export type StatsDashboard = z.infer<typeof DashboardSchema>["settings"];

const TotalsSchema = z.object({
  transactions: z.number(),
  wallets: z.number(),
  newWallets: z.number().optional(),
  bridge: z.object({ count: z.number(), volumeUsdc: z.string() }),
  swap: z.object({ count: z.number(), volumeUsd: z.number() }),
  arcPay: z.object({ count: z.number(), volumeUsdc: z.string() }),
  relay: z.object({ count: z.number(), volumeUsd: z.number() }),
  relayBridge: z.object({ count: z.number(), volumeUsd: z.number() }).optional(),
  chains: z.number(),
});
export type StatTotals = z.infer<typeof TotalsSchema>;

const SummarySchema = z.object({
  generatedAt: z.string(),
  allTime: TotalsSchema,
  last30d: TotalsSchema,
  last90d: TotalsSchema.optional(),
  series: z.array(z.object({ date: z.string(), transactions: z.number(), activeWallets: z.number() })),
});
export type StatSummary = z.infer<typeof SummarySchema>;

/**
 * Link to Confluence's DefiLlama page (confluence:defillama-link), or null when the admin has
 * not switched it on. Independent of the stats section. Same cached request as getStats.
 */
export async function getDefillamaUrl(): Promise<string | null> {
  try {
    const d = await fetch(`${API_URL}/site/stats-dashboard`, { next: { revalidate: REVALIDATE } });
    if (!d.ok) return null;
    const { showDefillamaLink, defillamaSlug } = DashboardSchema.parse(await d.json()).settings;
    if (!showDefillamaLink || !defillamaSlug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(defillamaSlug)) return null;
    return `https://defillama.com/protocol/${defillamaSlug}`;
  } catch {
    return null;
  }
}

/**
 * The stats section, or null when it should not show: switched off in admin, no figures
 * picked, or the API unreachable (the page then renders without the section, never broken).
 */
export async function getStats(): Promise<{ dashboard: StatsDashboard; summary: StatSummary } | null> {
  try {
    const d = await fetch(`${API_URL}/site/stats-dashboard`, { next: { revalidate: REVALIDATE } });
    if (!d.ok) return null;
    const dashboard = DashboardSchema.parse(await d.json()).settings;
    if (!dashboard.enabled || dashboard.metrics.length === 0) return null;
    const s = await fetch(`${API_URL}/public/stats/summary`, { next: { revalidate: REVALIDATE } });
    if (!s.ok) return null;
    return { dashboard, summary: SummarySchema.parse(await s.json()) };
  } catch {
    return null;
  }
}
