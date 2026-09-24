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
  // Reown (WalletConnect) project ID. Optional: without it the WalletConnect option is hidden.
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(8).optional(),
  ),
});

const parsed = PublicEnvSchema.safeParse({
  NEXT_PUBLIC_CONFLUENCE_ENV: process.env.NEXT_PUBLIC_CONFLUENCE_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid public environment configuration:\n${lines.join("\n")}`);
}

export const publicEnv = Object.freeze({
  confluenceEnv: parsed.data.NEXT_PUBLIC_CONFLUENCE_ENV,
  apiUrl: parsed.data.NEXT_PUBLIC_API_URL,
  walletConnectProjectId: parsed.data.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
});

export const isMainnet = publicEnv.confluenceEnv === "mainnet";
