/**
 * Arc payment flow end to end (confluence:arc-pay): a throwaway local database built from
 * the real migrations, the real service code, and a fake Arc RPC. Run with: npm test
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { pad } from "viem";
import type { BridgeChain, ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { TRANSFER_TOPIC } from "./rules.js";
import { ArcPayError, createArcPayment, getArcPayment, recordArcPaymentReport, trackArcPaymentsOnce } from "./service.js";

const USDC = "0x3600000000000000000000000000000000000000";
const SYSTEM = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";
const ME = "0x1111111111111111111111111111111111111111";
const THEM = "0x2222222222222222222222222222222222222222";
const SAFE = "0xc05559b9F04f299D373cc997adf5d83d2aE831FE";
type Hex = `0x${string}`;

const ARC: BridgeChain = {
  id: "Arc",
  name: "Arc",
  evmChainId: 5042,
  cctpDomain: 26,
  isTestnet: false,
  explorerTxUrl: "https://explorer.arc.io/tx/{hash}",
  usdcAddress: USDC,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.test"],
  forwarderAsDestination: true,
  messageTransmitter: null,
  tokenMessenger: null,
  speed: null,
};
const registry: ChainRegistry = { chains: [ARC], byId: new Map([["Arc", ARC]]), missingSpeed: [] };

// Fake Arc RPC: receipts by hash, every block at a fixed time.
const receipts = new Map<string, unknown>();
let blockTimeSec = Math.floor(Date.now() / 1000);
const fakeFetch = (async (_url: string, init: { body: string }) => {
  const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] };
  const result = method === "eth_getTransactionReceipt" ? (receipts.get(String(params[0])) ?? null) : method === "eth_getBlockByNumber" ? { timestamp: "0x" + blockTimeSec.toString(16) } : null;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
}) as unknown as typeof fetch;

const transferLog = (emitter: string, from: string, to: string, value: bigint) => ({ address: emitter, topics: [TRANSFER_TOPIC, pad(from as Hex), pad(to as Hex)], data: pad(`0x${value.toString(16)}` as Hex) });
const mined = (hash: string, logs: unknown[], status = "0x1") => receipts.set(hash, { status, from: ME, logs, blockNumber: "0x10" });
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");

let dir: string;
let db: Db;
let key = 0;
const create = (o: Partial<{ sender: string; recipientId: string; amount: string; note: string }> = {}) =>
  createArcPayment(db, registry, { sender: ME, recipientId: "@Them", amount: "50", idempotencyKey: `k-${++key}-xxxxxxxxxxxx`, ...o });
// Each pass one minute after the last, like the real tracker (it skips rows checked < 30s ago).
let tick = 0;
const track = () => trackArcPaymentsOnce({ db, registry, fetchImpl: fakeFetch }, Date.now() + ++tick * 60_000);
const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof ArcPayError ? e.code : String(e);
  }
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "arcpay-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  db = drizzle(client, { schema }) as Db;
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.accounts).values([
    { address: THEM, confluenceId: "them", idClaimedAt: new Date() },
    { address: ME, confluenceId: "me_too", idClaimedAt: new Date() },
  ]);
  await db.insert(schema.feeRecipients).values({ chain: "Arc", address: SAFE, effectiveFrom: new Date(0) });
});
after(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("creating an Arc payment", () => {
  it("resolves the ID in any case, and computes the fee and total on the server", async () => {
    const p = await create({ note: "  thanks\nfor lunch  " });
    assert.equal(p.recipient, THEM);
    assert.equal(p.recipientId, "them");
    assert.equal(p.fee.usdc, "0.3");
    assert.equal(p.total.usdc, "50.3");
    assert.equal(p.feeRecipient, SAFE);
    assert.equal(p.usdc.address, USDC);
    assert.equal(p.note, "thanks for lunch");
  });
  it("uses the new fee rule above 1,000", async () => assert.equal((await create({ amount: "100000" })).fee.usdc, "10.2"));
  it("refuses an unclaimed ID, paying yourself, a bad amount and a long note", async () => {
    assert.equal(await errCode(create({ recipientId: "nobody_here" })), "id_not_found");
    assert.equal(await errCode(create({ recipientId: "me_too" })), "self_payment");
    assert.equal(await errCode(create({ amount: "0" })), "invalid_amount");
    assert.equal(await errCode(create({ note: "x".repeat(141) })), "note_too_long");
  });
});

describe("the happy path, fee first", () => {
  it("goes CREATED, FEE_SUBMITTED, FEE_PAID, PAYMENT_SUBMITTED, COMPLETED", async () => {
    const p = await create();
    const report = (step: "fee" | "payment", txHash: string) => recordArcPaymentReport(db, p.id, p.reportToken, { step, state: "success", txHash });

    assert.equal(await errCode(report("payment", hash(2))), "fee_first");
    assert.equal((await report("fee", hash(1))).state, "FEE_SUBMITTED");

    await track(); // not mined yet
    assert.equal((await getArcPayment(db, p.id)).state, "FEE_SUBMITTED");
    // Arc emits an 18-decimal system log too; only the contract's own log may count.
    mined(hash(1), [transferLog(SYSTEM, ME, SAFE, 300_000n * 10n ** 12n), transferLog(USDC, ME, SAFE, 300_000n)]);
    await track();
    assert.equal((await getArcPayment(db, p.id)).state, "FEE_PAID");

    assert.equal((await report("payment", hash(2))).state, "PAYMENT_SUBMITTED");
    mined(hash(2), [transferLog(USDC, ME, THEM, 50_000_000n)]);
    await track();
    const done = await getArcPayment(db, p.id);
    assert.equal(done.state, "COMPLETED");
    assert.equal(done.feeVerified && done.paymentVerified, true);
    assert.equal("note" in done, false, "the public view never shows the note");
  });
});

describe("safety", () => {
  it("refuses reports with a wrong token", async () => {
    const p = await create();
    assert.equal(await errCode(recordArcPaymentReport(db, p.id, "wrong", { step: "fee", state: "success", txHash: hash(10) })), "payment_not_found");
  });
  it("drops a fee for the wrong amount, then accepts a correct one", async () => {
    const p = await create();
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "fee", state: "success", txHash: hash(20) });
    mined(hash(20), [transferLog(USDC, ME, SAFE, 1n)]);
    await track();
    let v = await getArcPayment(db, p.id);
    assert.equal(v.state, "CREATED");
    assert.equal(v.errorCode, "fee_no_matching_transfer");
    assert.equal(v.feeTxHash, null);
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "fee", state: "success", txHash: hash(21) });
    mined(hash(21), [transferLog(USDC, ME, SAFE, 300_000n)]);
    await track();
    v = await getArcPayment(db, p.id);
    assert.equal(v.state, "FEE_PAID");
  });
  it("rejects an old transaction mined before the payment existed", async () => {
    const p = await create();
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "fee", state: "success", txHash: hash(30) });
    mined(hash(30), [transferLog(USDC, ME, SAFE, 300_000n)]);
    blockTimeSec -= 3600;
    await track();
    blockTimeSec += 3600;
    assert.equal((await getArcPayment(db, p.id)).errorCode, "fee_too_old");
  });
  it("never links one transaction to two payments", async () => {
    const a = await create();
    const b = await create();
    await recordArcPaymentReport(db, a.id, a.reportToken, { step: "fee", state: "success", txHash: hash(40) });
    assert.equal(await errCode(recordArcPaymentReport(db, b.id, b.reportToken, { step: "fee", state: "success", txHash: hash(40) })), "tx_hash_taken");
  });
  it("keeps a paid fee when the payment is rejected, so it can be finished later", async () => {
    const p = await create();
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "fee", state: "success", txHash: hash(50) });
    mined(hash(50), [transferLog(USDC, ME, SAFE, 300_000n)]);
    await track();
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "payment", state: "error" });
    let v = await getArcPayment(db, p.id);
    assert.equal(v.state, "FEE_PAID");
    assert.equal(v.errorCode, "payment_not_sent");
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "payment", state: "success", txHash: hash(51) });
    mined(hash(51), [transferLog(USDC, ME, THEM, 50_000_000n)]);
    await track();
    v = await getArcPayment(db, p.id);
    assert.equal(v.state, "COMPLETED");
  });
  it("marks a rejected fee as FAILED with nothing paid", async () => {
    const p = await create();
    await recordArcPaymentReport(db, p.id, p.reportToken, { step: "fee", state: "error" });
    assert.equal((await getArcPayment(db, p.id)).state, "FAILED");
  });
  it("expires payments that never got a fee after 24h", async () => {
    const p = await create();
    await db.update(schema.arcPayments).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.arcPayments.id, p.id));
    await track();
    assert.equal((await getArcPayment(db, p.id)).state, "EXPIRED");
  });
});
