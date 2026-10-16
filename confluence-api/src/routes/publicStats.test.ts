/**
 * Public stats routes (confluence:public-stats): responses, cache and errors, on a throwaway
 * database built from the real migrations. Run with: npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import type { SwapRegistry } from "../swaps/tokens.js";
import { publicStatsRouter, STATS_CACHE_MS } from "./publicStats.js";

const NOW0 = Date.parse("2026-10-16T12:00:00Z");
let clock = NOW0;
let dir: string;
let db: Db;
let server: ReturnType<express.Express["listen"]>;
let base: string;

const registry = { chains: [{ id: "Arc", evmChainId: 5042 }], byId: new Map(), missingSpeed: [] } as unknown as ChainRegistry;
const swapRegistry = { chains: [{ id: "Arc", evmChainId: 5042 }], byId: new Map() } as unknown as SwapRegistry;

async function addPayment(amountBase: string) {
  const id = `${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000`;
  await db.insert(schema.arcPayments).values({
    id,
    idempotencyKey: id,
    state: "COMPLETED",
    chain: "Arc",
    sender: "0x" + "a".repeat(40),
    recipient: "0x" + "b".repeat(40),
    recipientId: "bob",
    amountBase,
    feeBase: "0",
    feeRecipient: "0x" + "0".repeat(40),
    payTxHash: "0x" + id.replace(/-/g, "").padEnd(64, "0"),
    payVerifiedAt: new Date(NOW0),
    createdAt: new Date(NOW0),
    updatedAt: new Date(NOW0),
  } as typeof schema.arcPayments.$inferInsert);
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "pubstats-routes-"));
  db = drizzle(createClient({ url: `file:${join(dir, "t.db")}` }), { schema }) as Db;
  await migrate(db, { migrationsFolder: "drizzle" });
  await addPayment("10000000");
  const app = express();
  app.use(publicStatsRouter(db, registry, swapRegistry, () => clock));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /public/stats/daily", () => {
  it("returns every day in the range with a public cache header", async () => {
    const res = await fetch(`${base}/public/stats/daily?from=2026-10-14&to=2026-10-16`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), `public, max-age=${STATS_CACHE_MS / 1000}`);
    const body = (await res.json()) as { from: string; to: string; days: { date: string; transactions: number }[] };
    assert.deepEqual(body.days.map((d) => d.date), ["2026-10-14", "2026-10-15", "2026-10-16"]);
    assert.equal(body.days[2]!.transactions, 1);
  });
  it("answers 400 for a bad or too long range", async () => {
    for (const q of ["from=yesterday", "from=2026-10-16&to=2026-10-01", "from=2026-01-01&to=2026-10-16"]) {
      const res = await fetch(`${base}/public/stats/daily?${q}`);
      assert.equal(res.status, 400, q);
      assert.equal(((await res.json()) as { error: string }).error, "invalid_range");
    }
  });
});

describe("GET /public/stats/summary", () => {
  it("is cached for STATS_CACHE_MS, then recomputed", async () => {
    const first = (await (await fetch(`${base}/public/stats/summary`)).json()) as { allTime: { arcPay: { count: number } } };
    assert.equal(first.allTime.arcPay.count, 1);
    await addPayment("5000000");
    const cached = (await (await fetch(`${base}/public/stats/summary`)).json()) as { allTime: { arcPay: { count: number } } };
    assert.equal(cached.allTime.arcPay.count, 1, "served from cache");
    clock += STATS_CACHE_MS + 1;
    const fresh = (await (await fetch(`${base}/public/stats/summary`)).json()) as { allTime: { arcPay: { count: number; volumeUsdc: string } } };
    assert.deepEqual(fresh.allTime.arcPay, { count: 2, volumeUsdc: "15" });
  });
});

describe("GET /site/stats-dashboard", () => {
  it("returns the settings, off by default", async () => {
    const body = (await (await fetch(`${base}/site/stats-dashboard`)).json()) as { settings: { enabled: boolean; source: string } };
    assert.equal(body.settings.enabled, false);
    assert.equal(body.settings.source, "confluence");
  });
});
