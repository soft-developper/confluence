import { z } from "zod";

const origin = z
  .url({ protocol: /^https?$/ })
  .refine((v) => new URL(v).origin === v, "must be a bare origin like https://app.example.com (no path or trailing slash)");

// An empty value in .env (e.g. "TURSO_AUTH_TOKEN=") means "not set", not "".
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);

const EnvSchema = z
  .object({
    CONFLUENCE_ENV: z.enum(["testnet", "mainnet"]),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean))
      .pipe(z.array(origin).min(1)),
    // ---- Admin dashboard (A1) ----
    // 32 random bytes, base64: encrypts the admin TOTP secret at rest. Admin login is
    // disabled until it is set. Generate: openssl rand -base64 32
    ADMIN_SECRET_KEY: optionalString,
    // Public web origin used in admin emails (password reset links), e.g.
    // https://confluence-web.vercel.app. Defaults to the first CORS origin.
    ADMIN_WEB_ORIGIN: optionalString,
    // Resend (https://resend.com/docs/api-reference/emails/send-email). Emails are skipped
    // (and logged) until both are set. EMAIL_FROM must use a domain verified in Resend,
    // e.g. "Confluence Security <security@yourdomain.com>".
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: optionalString,
    // Turso database for THIS environment (one database per environment).
    TURSO_DATABASE_URL: z
      .string()
      .trim()
      .min(1, "is required (libsql://<db>-<org>.turso.io)")
      .refine((v) => /^(libsql|https|wss|file):/.test(v), "must start with libsql://, https://, wss:// or file:"),
    TURSO_AUTH_TOKEN: optionalString,
    // Proxy hops in front of the API whose X-Forwarded-For entries we trust.
    // 0 locally (no proxy). Render: 3 (Cloudflare, Render load balancer, local proxy),
    // verified on the live service in Stage 0f.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Outbound limiter for our calls to Circle's CCTP API (Iris), requests per second, burst = 2x.
    // Circle documents 35 requests per second for the CCTP API; going over blocks ALL
    // requests for 5 minutes (HTTP 429). Source: https://developers.circle.com/cctp/technical-guide
    // (one Circle quickstart says 40; we use the lower number). The cap of 15 keeps the
    // 2x burst (30) under 35.
    CIRCLE_MAX_RPS: z.coerce.number().positive().max(15).default(10),
    // Stage 4 tracker: checks unfinished transfers against Circle and the chain while
    // the API is awake. "false" turns it off (for example when running two instances).
    TRACKER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    TRACKER_INTERVAL_MS: z.coerce.number().int().min(15_000).max(3_600_000).default(60_000),
    // Circle API keys are environment specific (testnet and mainnet each need their own).
    CIRCLE_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
    if (!env.TURSO_DATABASE_URL.startsWith("file:") && !env.TURSO_AUTH_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["TURSO_AUTH_TOKEN"], message: "is required for a remote Turso database" });
    }
    if (env.CONFLUENCE_ENV === "mainnet") {
      for (const o of env.CORS_ORIGINS) {
        const u = new URL(o);
        if (u.protocol !== "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1") {
          ctx.addIssue({ code: "custom", path: ["CORS_ORIGINS"], message: `mainnet allows only public https origins, got ${o}` });
        }
      }
    }
  });

export type Config = Readonly<z.infer<typeof EnvSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and reasons only, never values (they may be secrets).
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return Object.freeze(parsed.data);
}
