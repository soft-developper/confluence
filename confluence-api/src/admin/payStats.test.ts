/**
 * Admin Pay stats (confluence:admin-pay) on a throwaway database built from the real
 * migrations. Run with: npm test
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
import { payList, payOverview } from "./payStats.js";

const ME = "0x1111111111111111111111111111111111111111";
const YOU = "0x3333333333333333333333333333333333333333";
const THEM = "0x2222222222222222222222222222222222222222";
const NOW = Date.now();
const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

let dir: string;
let db: Db;
let n = 0;
const pay = (o: Partial<typeof schema.arcPayments.$inferInsert>) =>
  db.insert(schema.arcPayments).values({
    id: `${(++n).toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
    idempotencyKey: `k-${n}`,
    chain: "Arc",
    sender: ME,
    recipient: THEM,
    recipientId: "them",
    amountBase: "10000000",
    feeBase: "0",
    feeRecipient: "0x0000000000000000000000000000000000000000",
    note: "private",
    createdAt: new Date(NOW - 60_000),
    updatedAt: new Date(NOW - 60_000),
    ...o,
  });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "adminpay-"));
  db = drizzle(createClient({ url: `file:${join(dir, "t.db")}` }), { schema }) as Db;
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.accounts).values([
    { address: THEM, confluenceId: "them", idClaimedAt: new Date(NOW - 3600_000) },
    { address: ME, confluenceId: "me_too", idClaimedAt: new Date(NOW - 40 * 86_400_000) },
  ]);
  await db.insert(schema.savedIds).values({ owner: ME, handle: "them" });
  await pay({ state: "COMPLETED", payTxHash: H(1), payVerifiedAt: new Date(NOW) }); // free, today
  await pay({ state: "COMPLETED", sender: YOU, amountBase: "5000000", payTxHash: H(2), payVerifiedAt: new Date(NOW) }); // free, today
  await pay({ state: "COMPLETED", feeBase: "300000", feeTxHash: H(3), payTxHash: H(4), feeVerifiedAt: new Date(NOW), payVerifiedAt: new Date(NOW), createdAt: new Date(NOW - 10 * 86_400_000) }); // legacy, fee paid
  await pay({ state: "COMPLETED", feeBase: "300000", errorCode: "fee_unpaid", feeTxHash: H(5), payTxHash: H(6), payVerifiedAt: new Date(NOW) }); // legacy, fee unpaid
  await pay({ state: "FEE_PAID", feeBase: "300000", feeTxHash: H(7), feeVerifiedAt: new Date(NOW), updatedAt: new Date(NOW - 2 * 3600_000) }); // waiting to finish
  await pay({ state: "FEE_PAID", feeBase: "300000", feeTxHash: H(8), feeVerifiedAt: new Date(NOW) }); // just paid: not yet a problem
  await pay({ state: "PAYMENT_SUBMITTED", payTxHash: H(9), updatedAt: new Date(NOW - 45 * 60_000) }); // not proven
  await pay({ state: "EXPIRED" });
});
after(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("admin pay overview", () => {
  it("counts completed Arc payments, volume, free ones and proven fees by window", async () => {
    const o = await payOverview(db, NOW);
    assert.deepEqual(o.windows.d1.arc, { completed: 3, volume: "25", free: 2, feesCollected: "0", senders: 2, recipients: 1 });
    assert.equal(o.windows.d30.arc.completed, 4);
    assert.equal(o.windows.d30.arc.feesCollected, "0.3", "only proven fees count");
    assert.equal(o.windows.d1.idsClaimed, 1);
    assert.equal(o.idsTotal, 2);
    assert.equal(o.savedIdsTotal, 1);
    assert.equal(o.byState.COMPLETED, 4);
    assert.equal(o.byState.EXPIRED, 1);
  });
  it("lists what needs attention: fee_unpaid, a paid fee waiting over an hour, unproven reports", async () => {
    const o = await payOverview(db, NOW);
    assert.deepEqual(o.attentionCounts, { feeUnpaid: 1, waitingToFinish: 1, notProven: 1 });
    assert.equal(o.attention.length, 3);
    assert.equal("note" in o.attention[0]!, false, "notes stay private");
  });
});

describe("admin pay list", () => {
  it("pages newest first, filters by state, and searches by ID, wallet, tx and id prefix", async () => {
    const all = await payList(db, { page: 1 });
    assert.equal(all.total, 8);
    assert.equal(all.items.some((i) => "note" in i), false, "notes stay private");
    assert.equal((await payList(db, { state: "FEE_PAID", page: 1 })).total, 2);
    assert.equal((await payList(db, { q: "@THEM", page: 1 })).total, 8);
    assert.equal((await payList(db, { q: YOU.toUpperCase().replace("0X", "0x"), page: 1 })).total, 1);
    assert.equal((await payList(db, { q: H(9), page: 1 })).items[0]!.state, "PAYMENT_SUBMITTED");
    assert.equal((await payList(db, { q: "00000001", page: 1 })).total, 1);
    assert.equal((await payList(db, { q: "nobody", page: 1 })).total, 0);
  });
});
