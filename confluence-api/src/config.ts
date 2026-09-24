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
    // Used from Stage 0c (Turso). Optional until then.
    TURSO_DATABASE_URL: optionalString,
    TURSO_AUTH_TOKEN: optionalString,
    // Circle API keys are environment specific (testnet and mainnet each need their own).
    CIRCLE_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
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
