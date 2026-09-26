import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { siteSettings } from "../db/schema.js";

/**
 * Footer content edited from the admin dashboard. Everything is optional and starts
 * empty; the web footer hides whatever is not set. The network badge and page links are
 * not stored here: the web derives them from the environment and the chain list.
 */
const https = z
  .string()
  .trim()
  .max(300)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an https:// link");
const text = (max: number) => z.string().trim().max(max);

export const FooterSettingsSchema = z
  .object({
    builtBy: z.object({ name: text(60).min(1), url: https.optional() }).strict().nullable().default(null),
    privacyUrl: https.nullable().default(null),
    termsUrl: https.nullable().default(null),
    copyright: text(80).min(1).nullable().default(null), // for example "© 2026 Confluence"
    socials: z
      .array(z.object({ label: text(24).min(1), url: https }).strict())
      .max(6)
      .default([]),
    /** Optional override of the automatic network badge (for example a mainnet announcement). */
    network: z.object({ label: text(40).min(1), url: https.optional() }).strict().nullable().default(null),
  })
  .strict();
export type FooterSettings = z.infer<typeof FooterSettingsSchema>;

const KEY = "footer";
export const EMPTY_FOOTER: FooterSettings = FooterSettingsSchema.parse({});

export async function getFooter(db: Db) {
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.key, KEY) });
  // Anything stored that no longer validates falls back to empty rather than breaking the page.
  const parsed = row ? FooterSettingsSchema.safeParse(row.value) : null;
  return {
    settings: parsed?.success ? parsed.data : EMPTY_FOOTER,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function saveFooter(db: Db, value: unknown, adminAddress: string) {
  const settings = FooterSettingsSchema.parse(value);
  const now = new Date();
  await db
    .insert(siteSettings)
    .values({ key: KEY, value: settings, updatedBy: adminAddress, updatedAt: now })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: settings, updatedBy: adminAddress, updatedAt: now } });
  return { settings, updatedAt: now.toISOString() };
}
