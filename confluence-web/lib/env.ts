import { z } from "zod";

/**
 * Public, browser-safe configuration only. NEXT_PUBLIC_* values are inlined
 * at build time, so each must be referenced literally (no dynamic lookup).
 * Never put secrets here.
 */
const PublicEnvSchema = z.object({
  NEXT_PUBLIC_CONFLUENCE_ENV: z.enum(["testnet", "mainnet"]),
  NEXT_PUBLIC_API_URL: z
    .url({ protocol: /^https?$/ })
    .refine((v) => new URL(v).origin === v, "must be a bare origin like https://api.example.com (no path or trailing slash)"),
});

const parsed = PublicEnvSchema.safeParse({
  NEXT_PUBLIC_CONFLUENCE_ENV: process.env.NEXT_PUBLIC_CONFLUENCE_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid public environment configuration:\n${lines.join("\n")}`);
}

export const publicEnv = Object.freeze({
  confluenceEnv: parsed.data.NEXT_PUBLIC_CONFLUENCE_ENV,
  apiUrl: parsed.data.NEXT_PUBLIC_API_URL,
});

export const isMainnet = publicEnv.confluenceEnv === "mainnet";
