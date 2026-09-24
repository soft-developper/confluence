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

/** Cheap liveness probe used by /health. Resolves false instead of throwing. */
export async function pingDb(db: Db, timeoutMs = 3000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("db ping timeout")), timeoutMs);
    });
    await Promise.race([db.$client.execute("select 1"), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
