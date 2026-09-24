import { defineConfig } from "drizzle-kit";

// Load .env locally with Node's built-in loader (no dotenv). On Render the
// variables come from the dashboard and there is no .env file.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: fine
}

// Empty values in .env count as unset (drizzle-kit rejects an empty authToken).
const url = process.env.TURSO_DATABASE_URL?.trim() ?? "";
const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;
if (process.argv.some((a) => a === "migrate" || a === "studio")) {
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  console.log(`[drizzle] CONFLUENCE_ENV=${process.env.CONFLUENCE_ENV ?? "unset"} target=${url.replace(/\?.*$/, "")}`);
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken,
  },
});
