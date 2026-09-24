import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import type { Config } from "../config.js";
import * as schema from "./schema.js";

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };

export function createDb(config: Config): Db {
  const client = createClient({
    url: config.TURSO_DATABASE_URL,
    authToken: config.TURSO_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}

let warmed = false;
let lastLoggedError = "";

/**
 * Cheap liveness probe used by /health. Resolves false instead of throwing.
 * The first ping allows a longer timeout (cold DNS, TLS and handshake to Turso);
 * later pings use the short one. Failures are logged with their real reason,
 * once per distinct message, so a down database does not flood the logs.
 */
export async function pingDb(db: Db, timeoutMs = 3000, firstTimeoutMs = 10000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const limit = warmed ? timeoutMs : firstTimeoutMs;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`db ping timed out after ${limit}ms`)), limit);
    });
    await Promise.race([db.$client.execute("select 1"), timeout]);
    warmed = true;
    if (lastLoggedError) {
      console.log("db: reachable again");
      lastLoggedError = "";
    }
    return true;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const msg = `${e.code ?? "ERROR"}: ${e.message ?? String(err)}`;
    if (msg !== lastLoggedError) {
      console.warn(`db: health ping failed - ${msg}`);
      lastLoggedError = msg;
    }
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
