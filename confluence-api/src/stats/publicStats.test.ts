/**
 * Public stats and dashboard settings (confluence:public-stats) on a throwaway database built
 * from the real migrations. Run with: npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { dailyStats, parseRange, parseUsdcString, StatsRangeError, statsSummary, utcDay } from "./publicStats.js";
import { DashboardSettingsSchema, DEFAULT_DASHBOARD, getDashboard, saveDashboard } from "./dashboard.js";

const A = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-16T12:00:00Z");
const TODAY = "2026-10-16";
const YDAY = "2026-10-15";
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY);
const IDS = new Map<string, number>([
  ["Arc", 5042],
  ["Base", 8453],
  ["Ethereum", 1],
]);

let dir: string;
let db: Db;
let n = 0;
const id = () => `${(++n).toString().padStart(8, "0")}-0000-4000-8000-000000000000`;

async function bridge(o: { sender: string; chain: string; amount: string; daysAgo: number; state?: (typeof schema.transfers.$inferInsert)["state"]; verified?: boolean }) {
  const q = id();
  await db.insert(schema.quotes).values({
    id: q,
    sourceChain: o.chain,
    destinationChain: "Arc",
    sender: o.sender,
    recipient: o.sender,
    amountBase: o.amount,
    platformFeeBase: "300000",
    cctpFeeBase: "0",
    forwardingFeeBase: "0",
    speed: "SLOW",
    useForwarder: true,
    feeRecipient: C,
    expiresAt: at(o.daysAgo),
    createdAt: at(o.daysAgo),
  } as typeof schema.quotes.$inferInsert);
  await db.insert(schema.transfers).values({
    id: id(),
    quoteId: q,
    idempotencyKey: `t-${n}`,
    state: o.state ?? "COMPLETED",
    sourceChain: o.chain,
    destinationChain: "Arc",
    sender: o.sender,
    recipient: o.sender,
    amountBase: o.amount,
    platformFeeBase: "300000",
    speed: "SLOW",
    useForwarder: true,
    burnTxHash: "0x" + n.toString(16).padStart(64, "0"),
    verifiedAt: o.verified === false ? null : at(o.daysAgo),
    createdAt: at(o.daysAgo),
  } as typeof schema.transfers.$inferInsert);
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "pubstats-"));
  db = drizzle(createClient({ url: `file:${join(dir, "t.db")}` }), { schema }) as Db;
  await migrate(db, { migrationsFolder: "drizzle" });

  // A: first seen yesterday (bridge on Base), active again today (bridge on Arc, swap on Arc).
  await bridge({ sender: A, chain: "Base", amount: "1000000000", daysAgo: 1 }); // 1,000 USDC
  await bridge({ sender: A, chain: "Arc", amount: "4600000", daysAgo: 0 }); // 4.6 USDC
  // B: new today. One verified bridge, one not verified (must not count), one failed.
  await bridge({ sender: B, chain: "Base", amount: "2500000", daysAgo: 0 }); // 2.5 USDC
  await bridge({ sender: B, chain: "Base", amount: "9000000", daysAgo: 0, verified: false });
  await bridge({ sender: B, chain: "Base", amount: "9000000", daysAgo: 0, state: "FAILED" });

  const swap = (o: Partial<typeof schema.swaps.$inferInsert>) =>
    db.insert(schema.swaps).values({
      id: id(),
      idempotencyKey: `s-${n}`,
      state: "COMPLETED",
      chain: "Arc",
      sender: A,
      recipient: A,
      tokenIn: "USDC",
      tokenOut: "CIRBTC",
      amountIn: "5",
      feeRecipient: C,
      verifiedAt: at(0),
      createdAt: at(0),
      ...o,
    } as typeof schema.swaps.$inferInsert);
  await swap({}); // 5 USD from the USDC side
  await swap({ tokenIn: "CIRBTC", tokenOut: "USDT", amountIn: "0.0001", amountOut: "7.25" }); // 7.25 USD from the USDT side
  await swap({ tokenIn: "EURC", tokenOut: "CIRBTC", amountIn: "3" }); // counts, no USD volume
  await swap({ state: "FAILED" }); // ignored

  await db.insert(schema.arcPayments).values([
    {
      id: id(),
      idempotencyKey: `p-${n}`,
      state: "COMPLETED",
      chain: "Arc",
      sender: C,
      recipient: A,
      recipientId: "alice",
      amountBase: "10000000",
      feeBase: "0",
      feeRecipient: "0x0000000000000000000000000000000000000000",
      note: "secret note",
      payTxHash: "0x" + "9".repeat(64),
      payVerifiedAt: at(0),
      createdAt: at(0),
      updatedAt: at(0),
    },
    {
      id: id(),
      idempotencyKey: `p-${n}`,
      state: "PAYMENT_SUBMITTED",
      chain: "Arc",
      sender: C,
      recipient: A,
      recipientId: "alice",
      amountBase: "99000000",
      feeBase: "0",
      feeRecipient: "0x0000000000000000000000000000000000000000",
      createdAt: at(0),
      updatedAt: at(0),
    },
  ] as (typeof schema.arcPayments.$inferInsert)[]);

  const relay = (o: Partial<typeof schema.relayRequests.$inferInsert>) =>
    db.insert(schema.relayRequests).values({
      requestId: `r-${++n}`,
      userAddress: C,
      recipient: C,
      originChainId: 1,
      destinationChainId: 8453,
      originCurrency: "0x0",
      destinationCurrency: "0x0",
      symbolIn: "ETH",
      symbolOut: "USDC",
      amountIn: "1",
      appFeeBps: 1,
      status: "success",
      amountInUsd: "2500.5",
      verifiedAt: at(0),
      createdAt: at(0),
      updatedAt: at(0),
      ...o,
    } as typeof schema.relayRequests.$inferInsert);
  await relay({}); // Ethereum (EVM id 1) to Base: cross-chain, 2,500.50 USD
  await relay({ destinationChainId: 1, amountInUsd: "40" }); // Ethereum to Ethereum: same-chain Relay swap, 40 USD
  await relay({ status: "waiting", amountInUsd: "100" }); // ignored
});
after(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("public stats: daily", () => {
  it("counts only completed and verified actions, per chain, with exact USDC sums", async () => {
    const days = await dailyStats(db, IDS, YDAY, TODAY);
    assert.equal(days.length, 2);
    const [y, t] = days as [(typeof days)[0], (typeof days)[0]];
    assert.equal(y.date, YDAY);
    assert.equal(y.transactions, 1);
    assert.equal(y.chains[0]!.chain, "Base");
    assert.equal(y.chains[0]!.bridge.volumeUsdc, "1000");

    assert.equal(t.date, TODAY);
    // Today: A bridge Arc, B bridge Base, 3 swaps on Arc, 1 Arc Pay, 2 Relay.
    assert.equal(t.transactions, 8);
    const arc = t.chains.find((c) => c.chain === "Arc")!;
    assert.deepEqual(arc.bridge, { count: 1, volumeUsdc: "4.6" });
    assert.deepEqual(arc.swap, { count: 3, volumeUsd: 12.25 });
    assert.deepEqual(arc.arcPay, { count: 1, volumeUsdc: "10" });
    assert.equal(arc.evmChainId, 5042);
    const base = t.chains.find((c) => c.chain === "Base")!;
    assert.deepEqual(base.bridge, { count: 1, volumeUsdc: "2.5" }, "the unverified and failed bridges do not count");
  });

  it("names Relay chains by our chain id when the EVM id is known", async () => {
    const [, t] = await dailyStats(db, IDS, YDAY, TODAY);
    const eth = t!.chains.find((c) => c.chain === "Ethereum")!;
    assert.equal(eth.evmChainId, 1);
    assert.deepEqual(eth.relay, { count: 2, volumeUsd: 2540.5 });
    assert.deepEqual(eth.relayBridge, { count: 1, volumeUsd: 2500.5 }, "only the cross-chain route");
  });

  it("deduplicates wallets across chains and counts new wallets by their first day", async () => {
    const [y, t] = await dailyStats(db, IDS, YDAY, TODAY);
    assert.equal(y!.activeWallets, 1);
    assert.equal(y!.newWallets, 1, "A was new yesterday");
    assert.equal(t!.activeWallets, 3, "A (case-insensitive), B and C");
    assert.equal(t!.newWallets, 2, "B and C are new today; A is not");
    const arc = t!.chains.find((c) => c.chain === "Arc")!;
    assert.equal(arc.activeWallets, 2, "A and C on Arc");
  });

  it("fills empty days with zeros and never returns addresses, hashes or notes", async () => {
    const days = await dailyStats(db, IDS, "2026-10-10", TODAY);
    assert.equal(days.length, 7);
    assert.equal(days[0]!.transactions, 0);
    assert.deepEqual(days[0]!.chains, []);
    const json = JSON.stringify(days).toLowerCase();
    assert.ok(!json.includes(A.toLowerCase().slice(2)) && !json.includes(B.slice(2)) && !json.includes(C.slice(2)));
    assert.ok(!json.includes("secret") && !json.includes("9".repeat(64)));
  });
});

describe("public stats: summary", () => {
  it("adds up all-time and last-30-day totals and a 90-day series", async () => {
    const s = await statsSummary(db, IDS, NOW);
    assert.equal(s.allTime.transactions, 9);
    assert.equal(s.allTime.wallets, 3);
    assert.equal(s.allTime.newWallets, 3, "all time: every wallet is new once");
    assert.equal(s.last30d.newWallets, 3, "A was first seen yesterday, B and C today");
    assert.equal(s.last90d.transactions, s.allTime.transactions);
    assert.deepEqual(s.allTime.bridge, { count: 3, volumeUsdc: "1007.1" });
    assert.deepEqual(s.allTime.swap, { count: 3, volumeUsd: 12.25 });
    assert.deepEqual(s.allTime.arcPay, { count: 1, volumeUsdc: "10" });
    assert.deepEqual(s.allTime.relay, { count: 2, volumeUsd: 2540.5 });
    assert.deepEqual(s.allTime.relayBridge, { count: 1, volumeUsd: 2500.5 });
    assert.equal(s.allTime.chains, 3, "Arc, Base and Ethereum (Relay's EVM id 1 resolved)");
    assert.equal(s.series.length, 90);
    assert.equal(s.series.at(-1)!.date, TODAY);
    assert.equal(s.series.at(-1)!.bridgeVolumeUsdc, "7.1");
    assert.equal(s.series.at(-2)!.bridgeVolumeUsdc, "1000");
  });
});

describe("public stats: ranges", () => {
  it("defaults to the last 30 days and rejects bad or long ranges", () => {
    assert.deepEqual(parseRange(undefined, undefined, NOW), { from: utcDay(NOW - 29 * DAY), to: TODAY });
    assert.throws(() => parseRange("2026-13-01", TODAY, NOW), StatsRangeError);
    assert.throws(() => parseRange(TODAY, YDAY, NOW), StatsRangeError);
    assert.throws(() => parseRange("2026-01-01", TODAY, NOW), StatsRangeError);
    assert.equal(parseUsdcString("1007.1"), 1_007_100_000n);
  });
});

describe("stats dashboard settings", () => {
  it("is off by default, saves valid settings and rejects invalid ones", async () => {
    assert.deepEqual((await getDashboard(db)).settings, DEFAULT_DASHBOARD);
    assert.equal(DEFAULT_DASHBOARD.enabled, false);
    const saved = await saveDashboard(db, { enabled: true, metrics: ["bridgeVolume", "activeWallets"], range: "90d" }, "owner@example.com");
    assert.equal(saved.settings.enabled, true);
    assert.equal((await getDashboard(db)).settings.range, "90d");
    assert.throws(() => DashboardSettingsSchema.parse({ metrics: ["bridgeVolume", "bridgeVolume"] }), "each figure at most once");
    await assert.rejects(saveDashboard(db, { source: "defillama" }, "owner@example.com"), "DefiLlama needs a slug");
    await assert.rejects(saveDashboard(db, { defillamaSlug: "Confluence!" }, "owner@example.com"));
    await assert.rejects(saveDashboard(db, { extra: 1 }, "owner@example.com"));
  });
});

