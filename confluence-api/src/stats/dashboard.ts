import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { siteSettings } from "../db/schema.js";

/**
 * Landing stats dashboard settings (confluence:stats-dashboard), edited from the admin
 * dashboard and read by the landing page. Stored like the footer, in site_settings.
 * Off by default: nothing shows on the landing page until the admin switches it on.
 */
export const DASHBOARD_METRICS = [
  "bridgeVolume",
  "transactions",
  "activeWallets",
  "newWallets",
  "swapVolume",
  "arcPayVolume",
  "relayVolume",
  "chains",
] as const;
export type DashboardMetric = (typeof DASHBOARD_METRICS)[number];

export const DashboardSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Figures shown, in this order. */
    metrics: z
      .array(z.enum(DASHBOARD_METRICS))
      .max(DASHBOARD_METRICS.length)
      .refine((m) => new Set(m).size === m.length, "each figure at most once")
      .default(["bridgeVolume", "transactions", "activeWallets", "arcPayVolume"]),
    /** Range the landing page shows first. */
    range: z.enum(["30d", "90d", "all"]).default("30d"),
    /** Where the numbers come from: our own stats now, DefiLlama once Confluence is listed. */
    source: z.enum(["confluence", "defillama"]).default("confluence"),
    /** DefiLlama slug once listed (lowercase letters, digits and hyphens). */
    defillamaSlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "lowercase letters, digits and hyphens")
      .nullable()
      .default(null),
  })
  .strict()
  .refine((s) => s.source !== "defillama" || s.defillamaSlug !== null, { message: "set the DefiLlama slug before using DefiLlama as the source", path: ["defillamaSlug"] });
export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>;

const KEY = "stats_dashboard";
export const DEFAULT_DASHBOARD: DashboardSettings = DashboardSettingsSchema.parse({});

export async function getDashboard(db: Db) {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  // Anything stored that no longer validates falls back to the defaults (off).
  const parsed = row ? DashboardSettingsSchema.safeParse(row.value) : null;
  return {
    settings: parsed?.success ? parsed.data : DEFAULT_DASHBOARD,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function saveDashboard(db: Db, value: unknown, adminEmail: string) {
  const settings = DashboardSettingsSchema.parse(value);
  const now = new Date();
  await db
    .insert(siteSettings)
    .values({ key: KEY, value: settings, updatedBy: adminEmail, updatedAt: now })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: settings, updatedBy: adminEmail, updatedAt: now } });
  return { settings, updatedAt: now.toISOString() };
}
