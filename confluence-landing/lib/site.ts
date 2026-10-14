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
