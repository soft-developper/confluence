/**
 * Pay page data (confluence:arc-pay): Activity, totals, finishing a payment, Saved IDs,
 * and notes on payments from other chains. Real migrations on a throwaway local database.
 * Run with: npm test
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
import type { BridgeChain, ChainRegistry } from "../chains/registry.js";
import type { IrisClient } from "../circle/iris.js";
import type { Db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { createQuote, QuoteError } from "../fees/quote.js";
import { createTransfer } from "../transfers/service.js";
import { activity, monthStart, PayError, payTotals, removeSavedId, resumeArcPayment, saveId, SAVED_IDS_MAX } from "./activity.js";
import { ArcPayError, createArcPayment, recordArcPaymentReport } from "./service.js";

const ME = "0x1111111111111111111111111111111111111111";
const THEM = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const SAFE = "0xc05559b9F04f299D373cc997adf5d83d2aE831FE";

const chain = (id: string, domain: number, usdc: string): BridgeChain => ({
  id,
  name: id,
  evmChainId: 1000 + domain,
  cctpDomain: domain,
  isTestnet: false,
  explorerTxUrl: "https://example.org/tx/{hash}",
  usdcAddress: usdc,
  nativeCurrency: { name: "X", symbol: "X", decimals: 18 },
  rpcUrls: ["https://rpc.test"],
  forwarderAsDestination: true,
  messageTransmitter: null,
  tokenMessenger: null,
  speed: { fast: null, standard: { label: "about 15 minutes", minSeconds: 600, maxSeconds: 1200 } } as BridgeChain["speed"],
});
const ARC = chain("Arc", 26, "0x3600000000000000000000000000000000000000");
const BASE = chain("Base", 6, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const registry: ChainRegistry = { chains: [ARC, BASE], byId: new Map([["Arc", ARC], ["Base", BASE]]), missingSpeed: [] };
const iris = { getRouteFees: async () => ({ fastBps: 1, standardBps: 0, forwardFeeFast: 200_000n, forwardFeeStandard: 200_000n }) } as unknown as IrisClient;

let dir: string;
let db: Db;
let k = 0;
const key = () => `key-${++k}-xxxxxxxxxxxxxxxx`;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof PayError || e instanceof ArcPayError || e instanceof QuoteError ? e.code : String(e);
  }
};
const arcPay = async (state: schema.ArcPaymentState, o: Partial<{ sender: string; recipientId: string; amount: string; note: string }> = {}) => {
  const p = await createArcPayment(db, registry, { sender: ME, recipientId: "them", amount: "10", idempotencyKey: key(), ...o });
  await db.update(schema.arcPayments).set({ state, feeBase: "300000", feeRecipient: SAFE, feeTxHash: state === "CREATED" ? null : `0x${k.toString(16).padStart(64, "0")}` }).where(eq(schema.arcPayments.id, p.id));
  return p;
};
const lower = (a: string) => a.toLowerCase();

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "pay-"));
  db = drizzle(createClient({ url: `file:${join(dir, "t.db")}` }), { schema }) as Db;
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.accounts).values([
    { address: lower(ME), confluenceId: "me_id", idClaimedAt: new Date() },
    { address: lower(THEM), confluenceId: "them", idClaimedAt: new Date() },
    { address: lower(OTHER), confluenceId: null },
  ]);
  await db.insert(schema.feeRecipients).values([
    { chain: "Arc", address: SAFE, effectiveFrom: new Date(0) },
    { chain: "Base", address: SAFE, effectiveFrom: new Date(0) },
  ]);
});
after(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("notes on payments from other chains", () => {
  it("carries a cleaned note from the quote to the transfer", async () => {
    const q = await createQuote(db, registry, iris, { sourceChain: "Base", destinationChain: "Arc", amount: "25", sender: ME, recipientId: "@THEM", note: " rent\tsplit ", speed: "SLOW", useForwarder: true });
    assert.equal(q.note, "rent split");
    const t = await createTransfer(db, { quoteId: q.id, sender: ME, idempotencyKey: key() });
    const row = await db.query.transfers.findFirst({ where: eq(schema.transfers.id, t.id) });
    assert.equal(row?.note, "rent split");
  });
  it("refuses a note without a Confluence ID, and a long note", async () => {
    assert.equal(await code(createQuote(db, registry, iris, { sourceChain: "Base", destinationChain: "Arc", amount: "25", sender: ME, note: "hi", speed: "SLOW", useForwarder: true })), "note_needs_id");
    assert.equal(await code(createQuote(db, registry, iris, { sourceChain: "Base", destinationChain: "Arc", amount: "25", sender: ME, recipientId: "them", note: "x".repeat(141), speed: "SLOW", useForwarder: true })), "note_too_long");
  });
});

describe("activity", () => {
  it("shows the sender what they signed, with finish-payment for a paid fee", async () => {
    await arcPay("CREATED");
    await arcPay("FAILED");
    await arcPay("EXPIRED");
    const paid = await arcPay("FEE_PAID", { note: "lunch" });
    const done = await arcPay("COMPLETED", { amount: "40" });
    const sent = await activity(db, lower(ME), { direction: "sent", page: 1 });
    const ids = sent.items.map((i) => i.id);
    assert.ok(ids.includes(paid.id) && ids.includes(done.id));
    assert.equal(sent.items.filter((i) => i.kind === "arc").length, 2, "created, failed and expired are hidden");
    const p = sent.items.find((i) => i.id === paid.id)!;
    assert.equal(p.canFinish, true);
    assert.equal(p.counterpartyId, "them");
    assert.equal(p.note, "lunch");
    assert.equal(p.fee, "0.3");
  });
  it("shows a bridge to an ID only once its burn is proven", async () => {
    const before = (await activity(db, lower(ME), { direction: "sent", page: 1 })).items.filter((i) => i.kind === "bridge").length;
    assert.equal(before, 0);
    await db.update(schema.transfers).set({ sourceBurnAt: new Date(), burnTxHash: "0x" + "ab".repeat(32), state: "BURN_SUBMITTED" });
    const after = (await activity(db, lower(ME), { direction: "sent", page: 1 })).items.filter((i) => i.kind === "bridge");
    assert.equal(after.length, 1);
    assert.equal(after[0]!.note, "rent split");
    assert.equal(after[0]!.destinationChain, "Arc");
  });
  it("shows the recipient only completed Arc payments, naming the payer", async () => {
    const recv = await activity(db, lower(THEM), { direction: "received", page: 1 });
    const arc = recv.items.filter((i) => i.kind === "arc");
    assert.equal(arc.length, 1);
    assert.equal(arc[0]!.state, "COMPLETED");
    assert.equal(arc[0]!.counterpartyId, "me_id");
    assert.equal(arc[0]!.fee, null, "the recipient never sees the sender's fee");
    assert.equal(recv.items.filter((i) => i.kind === "bridge").length, 1);
  });
  it("pages 20 at a time, newest first", async () => {
    for (let i = 0; i < 21; i++) await arcPay("COMPLETED", { amount: String(i + 1) });
    const p1 = await activity(db, lower(ME), { direction: "sent", page: 1 });
    const p2 = await activity(db, lower(ME), { direction: "sent", page: 2 });
    assert.equal(p1.items.length, 20);
    assert.equal(p1.total, p1.items.length + p2.items.length);
    assert.ok(new Date(p1.items[0]!.createdAt) >= new Date(p1.items[19]!.createdAt));
  });
  it("totals completed payments this month", async () => {
    const t = await payTotals(db, lower(ME), monthStart());
    // 40 + 1..21 = 271 sent on Arc; the Base bridge is not COMPLETED yet.
    assert.equal(t.sent, "271");
    const r = await payTotals(db, lower(THEM), monthStart());
    assert.equal(r.received, "271");
  });
});

describe("finishing a payment whose fee is paid", () => {
  it("issues a fresh token to the sender only, and the old one stops working", async () => {
    const p = await arcPay("FEE_PAID");
    assert.equal(await code(resumeArcPayment(db, lower(THEM), p.id)), "payment_not_found");
    const r = await resumeArcPayment(db, lower(ME), p.id);
    assert.equal(r.recipientId, "them");
    assert.equal(await code(recordArcPaymentReport(db, p.id, p.reportToken, { step: "payment", state: "success", txHash: "0x" + "cd".repeat(32) })), "payment_not_found");
    const ok = await recordArcPaymentReport(db, p.id, r.reportToken, { step: "payment", state: "success", txHash: "0x" + "cd".repeat(32) });
    assert.equal(ok.state, "PAYMENT_SUBMITTED");
  });
  it("refuses payments that are done or never had a fee", async () => {
    assert.equal(await code(resumeArcPayment(db, lower(ME), (await arcPay("COMPLETED")).id)), "not_resumable");
    assert.equal(await code(resumeArcPayment(db, lower(ME), (await arcPay("CREATED")).id)), "not_resumable");
  });
});

describe("saved IDs", () => {
  it("saves a claimed ID in any case, once", async () => {
    await saveId(db, lower(ME), "@THEM");
    const list = await saveId(db, lower(ME), "them");
    assert.deepEqual(list.map((x) => x.handle), ["them"]);
    assert.equal(list[0]!.address, THEM);
  });
  it("refuses unclaimed IDs and your own", async () => {
    assert.equal(await code(saveId(db, lower(ME), "nobody_here")), "id_not_found");
    assert.equal(await code(saveId(db, lower(ME), "me_id")), "own_id");
  });
  it("removes, and keeps each wallet's list private", async () => {
    assert.equal((await saveId(db, lower(OTHER), "them")).length, 1);
    assert.equal((await removeSavedId(db, lower(ME), "them")).length, 0);
    assert.equal((await saveId(db, lower(OTHER), "me_id")).length, 2);
  });
  it("caps the list", async () => {
    const owner = "0x4444444444444444444444444444444444444444";
    await db.insert(schema.savedIds).values(Array.from({ length: SAVED_IDS_MAX }, (_, i) => ({ owner, handle: `filler_${i}` })));
    assert.equal(await code(saveId(db, owner, "them")), "saved_ids_full");
  });
});
