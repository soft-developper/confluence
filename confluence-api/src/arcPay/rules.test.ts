/**
 * Arc payment rules (confluence:arc-pay). Run with: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pad } from "viem";
import type { ArcPaymentState } from "../db/schema.js";
import type { TxReceipt } from "../tracker/chainReads.js";
import { applyReport, checkUsdcTransfer, CLOCK_SKEW_MS, decideArcPayment, EXPIRE_AFTER_MS, isFree, tooOld, TRANSFER_TOPIC, TX_NOT_FOUND_AFTER_MS, type ArcPayRow, type ReportInput } from "./rules.js";

const USDC = "0x3600000000000000000000000000000000000000";
const SYSTEM = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";
const ME = "0x1111111111111111111111111111111111111111";
const THEM = "0x2222222222222222222222222222222222222222";
const SAFE = "0xc05559b9F04f299D373cc997adf5d83d2aE831FE";
const H1 = "0x" + "aa".repeat(32);
const H2 = "0x" + "bb".repeat(32);
type Hex = `0x${string}`;

const log = (emitter: string, from: string, to: string, value: bigint) => ({ address: emitter, topics: [TRANSFER_TOPIC, pad(from as Hex), pad(to as Hex)], data: pad(`0x${value.toString(16)}` as Hex) });
const receipt = (logs: TxReceipt["logs"], status = "0x1"): TxReceipt => ({ status, from: ME, logs });

describe("applyReport", () => {
  const base: ReportInput = { state: "CREATED", feeTxHash: null, payTxHash: null, step: "fee", stepState: "success", txHash: H1 };
  it("fee sent moves to FEE_SUBMITTED and stores the hash", () => assert.deepEqual(applyReport(base), { kind: "move", to: "FEE_SUBMITTED", errorCode: null, setFeeTx: true }));
  it("fee rejected before anything was paid is FAILED", () => assert.deepEqual(applyReport({ ...base, stepState: "error", txHash: undefined }), { kind: "move", to: "FAILED", errorCode: "fee_not_sent" }));
  it("a failed attempt can be retried with a new fee", () => assert.equal(applyReport({ ...base, state: "FAILED" }).kind, "move"));
  it("a success without a hash is refused", () => assert.equal(applyReport({ ...base, txHash: undefined }).kind, "reject"));
  it("a different fee hash is refused", () => assert.deepEqual((applyReport({ ...base, state: "FEE_SUBMITTED", feeTxHash: H2 }) as { code: string }).code, "fee_tx_conflict"));
  it("the same fee hash again changes nothing", () => assert.equal(applyReport({ ...base, state: "FEE_SUBMITTED", feeTxHash: H1.toUpperCase().replace("0X", "0x") }).kind, "stay"));
  it("payment before the fee is refused (fee first)", () => assert.equal((applyReport({ ...base, step: "payment" }) as { code: string }).code, "fee_first"));
  it("payment after the fee moves to PAYMENT_SUBMITTED", () => {
    for (const state of ["FEE_SUBMITTED", "FEE_PAID"] as const) {
      assert.deepEqual(applyReport({ ...base, state, feeTxHash: H1, step: "payment", txHash: H2 }), { kind: "move", to: "PAYMENT_SUBMITTED", errorCode: null, setPayTx: true });
    }
  });
  it("a rejected payment keeps the paid fee (resumable)", () =>
    assert.deepEqual(applyReport({ ...base, state: "FEE_PAID", feeTxHash: H1, step: "payment", stepState: "error", txHash: undefined }), { kind: "note", errorCode: "payment_not_sent" }));
  it("never reaches FEE_PAID or COMPLETED from a report", () => {
    for (const state of ["CREATED", "FEE_SUBMITTED", "FEE_PAID", "PAYMENT_SUBMITTED", "FAILED"] as ArcPaymentState[]) {
      for (const step of ["fee", "payment"] as const) {
        const r = applyReport({ ...base, state, feeTxHash: state === "CREATED" || state === "FAILED" ? null : H1, step, txHash: H2 });
        if (r.kind === "move") assert.ok(r.to !== "FEE_PAID" && r.to !== "COMPLETED", `${state} ${step} -> ${r.to}`);
      }
    }
  });
  it("final states never change", () => {
    for (const state of ["COMPLETED", "EXPIRED"] as const) assert.equal(applyReport({ ...base, state }).kind, "stay");
  });
});

describe("checkUsdcTransfer", () => {
  const want = { usdc: USDC, from: ME, to: THEM, amountBase: "5000000" };
  it("accepts the token contract's own Transfer log", () => assert.equal(checkUsdcTransfer(receipt([log(USDC, ME, THEM, 5_000_000n)]), want), "ok"));
  it("ignores Arc's 18-decimal system log for the same movement", () => {
    assert.equal(checkUsdcTransfer(receipt([log(SYSTEM, ME, THEM, 5_000_000n * 10n ** 12n), log(USDC, ME, THEM, 5_000_000n)]), want), "ok");
    assert.equal(checkUsdcTransfer(receipt([log(SYSTEM, ME, THEM, 5_000_000n)]), want), "no_matching_transfer");
  });
  it("needs the exact amount, sender and recipient", () => {
    assert.equal(checkUsdcTransfer(receipt([log(USDC, ME, THEM, 4_999_999n)]), want), "no_matching_transfer");
    assert.equal(checkUsdcTransfer(receipt([log(USDC, THEM, THEM, 5_000_000n)]), want), "no_matching_transfer");
    assert.equal(checkUsdcTransfer(receipt([log(USDC, ME, SAFE, 5_000_000n)]), want), "no_matching_transfer");
  });
  it("matches addresses in any case", () => assert.equal(checkUsdcTransfer(receipt([log(USDC, ME, THEM, 5_000_000n)]), { ...want, from: ME.toUpperCase().replace("0X", "0x") }), "ok"));
  it("finds the fee and the payment in one batched transaction", () => {
    const r = receipt([log(USDC, ME, SAFE, 300_000n), log(USDC, ME, THEM, 5_000_000n)]);
    assert.equal(checkUsdcTransfer(r, { ...want, to: SAFE, amountBase: "300000" }), "ok");
    assert.equal(checkUsdcTransfer(r, want), "ok");
  });
  it("reports a reverted transaction and an unknown one", () => {
    assert.equal(checkUsdcTransfer(receipt([], "0x0"), want), "reverted");
    assert.equal(checkUsdcTransfer(null, want), null);
  });
  it("flags transactions mined well before the payment was created", () => {
    assert.equal(tooOld(1_000_000, 1_000_000 + CLOCK_SKEW_MS + 1), true);
    assert.equal(tooOld(1_000_000, 1_000_000 + CLOCK_SKEW_MS - 1), false);
  });
});

describe("decideArcPayment", () => {
  const NOW = Date.UTC(2026, 9, 14, 12);
  const row = (o: Partial<ArcPayRow>): ArcPayRow => ({
    state: "CREATED",
    feeTxHash: null,
    payTxHash: null,
    feeVerifiedAt: null,
    payVerifiedAt: null,
    errorCode: null,
    createdAt: new Date(NOW - 60_000),
    updatedAt: new Date(NOW - 60_000),
    ...o,
  });
  const to = (d: ReturnType<typeof decideArcPayment>) => (d.kind === "update" ? d.to : "none");

  it("expires a payment with no fee after 24h (nothing was paid)", () => {
    assert.equal(to(decideArcPayment(row({ createdAt: new Date(NOW - EXPIRE_AFTER_MS - 1) }), undefined, undefined, NOW)), "EXPIRED");
    assert.equal(to(decideArcPayment(row({}), undefined, undefined, NOW)), "none");
  });
  it("a paid fee never expires", () => assert.equal(to(decideArcPayment(row({ state: "FEE_PAID", feeTxHash: H1, feeVerifiedAt: new Date(0), createdAt: new Date(0) }), undefined, undefined, NOW)), "none"));
  it("proves the fee", () => {
    const d = decideArcPayment(row({ state: "FEE_SUBMITTED", feeTxHash: H1 }), "ok", undefined, NOW);
    assert.equal(to(d), "FEE_PAID");
    assert.equal((d as { feeVerified?: boolean }).feeVerified, true);
  });
  it("drops an invalid fee so it can be sent again", () => {
    for (const bad of ["reverted", "no_matching_transfer", "too_old"] as const) {
      const d = decideArcPayment(row({ state: "FEE_SUBMITTED", feeTxHash: H1 }), bad, undefined, NOW);
      assert.equal(to(d), "CREATED");
      assert.equal((d as { clearFeeTx?: boolean }).clearFeeTx, true);
      assert.equal((d as { errorCode?: string }).errorCode, `fee_${bad}`);
    }
  });
  it("waits for an unmined fee, then drops it after 2h", () => {
    assert.equal(to(decideArcPayment(row({ state: "FEE_SUBMITTED", feeTxHash: H1 }), null, undefined, NOW)), "none");
    assert.equal(to(decideArcPayment(row({ state: "FEE_SUBMITTED", feeTxHash: H1, updatedAt: new Date(NOW - TX_NOT_FOUND_AFTER_MS - 1) }), null, undefined, NOW)), "CREATED");
  });
  const submitted = (o: Partial<ArcPayRow> = {}) => row({ state: "PAYMENT_SUBMITTED", feeTxHash: H1, payTxHash: H2, ...o });
  it("completes once the fee and the payment are both proven", () => {
    assert.equal(to(decideArcPayment(submitted({ feeVerifiedAt: new Date(NOW) }), undefined, "ok", NOW)), "COMPLETED");
    assert.equal(to(decideArcPayment(submitted(), "ok", "ok", NOW)), "COMPLETED");
  });
  it("remembers a proven payment while the fee is still pending", () => {
    const first = decideArcPayment(submitted(), null, "ok", NOW);
    assert.equal(to(first), "PAYMENT_SUBMITTED");
    assert.equal((first as { payVerified?: boolean }).payVerified, true);
    assert.equal(to(decideArcPayment(submitted({ payVerifiedAt: new Date(NOW) }), "ok", undefined, NOW)), "COMPLETED");
  });
  it("still shows a real payment as complete when the fee was not valid (fee_unpaid for admin)", () => {
    const d = decideArcPayment(submitted(), "no_matching_transfer", "ok", NOW);
    assert.equal(to(d), "COMPLETED");
    assert.equal((d as { errorCode?: string }).errorCode, "fee_unpaid");
  });
  it("sends an invalid payment back so it can be finished without paying the fee again", () => {
    const d = decideArcPayment(submitted({ feeVerifiedAt: new Date(NOW) }), undefined, "no_matching_transfer", NOW);
    assert.equal(to(d), "FEE_PAID");
    assert.equal((d as { clearPayTx?: boolean }).clearPayTx, true);
  });
  it("drops an unmined payment after 2h, keeping the paid fee", () =>
    assert.equal(to(decideArcPayment(submitted({ feeVerifiedAt: new Date(NOW), updatedAt: new Date(NOW - TX_NOT_FOUND_AFTER_MS - 1) }), undefined, null, NOW)), "FEE_PAID"));
  it("final states never change", () => {
    for (const state of ["COMPLETED", "EXPIRED", "FAILED"] as const) assert.equal(to(decideArcPayment(row({ state }), "ok", "ok", NOW)), "none");
  });
});

describe("free payments (no fee step)", () => {
  const NOW = Date.UTC(2026, 9, 14, 12);
  const base: ReportInput = { state: "CREATED", feeTxHash: null, payTxHash: null, step: "payment", stepState: "success", txHash: H2, free: true };
  it("isFree only for a zero fee", () => {
    assert.equal(isFree("0"), true);
    assert.equal(isFree("300000"), false);
    assert.equal(isFree(null), false);
  });
  it("the payment goes straight from CREATED (or FAILED) to PAYMENT_SUBMITTED", () => {
    for (const state of ["CREATED", "FAILED"] as const) assert.deepEqual(applyReport({ ...base, state }), { kind: "move", to: "PAYMENT_SUBMITTED", errorCode: null, setPayTx: true });
  });
  it("a fee report is refused", () => assert.equal((applyReport({ ...base, step: "fee", txHash: H1 }) as { code: string }).code, "no_fee"));
  it("a declined payment is FAILED (nothing moved)", () =>
    assert.deepEqual(applyReport({ ...base, stepState: "error", txHash: undefined }), { kind: "move", to: "FAILED", errorCode: "payment_not_sent" }));
  it("a different payment hash is refused, the same one changes nothing", () => {
    assert.equal((applyReport({ ...base, state: "PAYMENT_SUBMITTED", payTxHash: H1 }) as { code: string }).code, "payment_tx_conflict");
    assert.equal(applyReport({ ...base, state: "PAYMENT_SUBMITTED", payTxHash: H2 }).kind, "stay");
  });
  const row = (o: Partial<ArcPayRow>): ArcPayRow => ({
    state: "PAYMENT_SUBMITTED",
    feeBase: "0",
    feeTxHash: null,
    payTxHash: H2,
    feeVerifiedAt: null,
    payVerifiedAt: null,
    errorCode: null,
    createdAt: new Date(NOW - 60_000),
    updatedAt: new Date(NOW - 60_000),
    ...o,
  });
  const to = (d: ReturnType<typeof decideArcPayment>) => (d.kind === "update" ? d.to : "none");
  it("completes on the payment proof alone, with no fee_unpaid", () => {
    const d = decideArcPayment(row({}), undefined, "ok", NOW);
    assert.equal(to(d), "COMPLETED");
    assert.equal((d as { errorCode?: string | null }).errorCode, null);
  });
  it("sends a bad payment back to CREATED and drops the hash", () => {
    const d = decideArcPayment(row({}), undefined, "reverted", NOW);
    assert.equal(to(d), "CREATED");
    assert.equal((d as { clearPayTx?: boolean }).clearPayTx, true);
  });
  it("waits for an unmined payment, then drops it after 2h", () => {
    assert.equal(to(decideArcPayment(row({}), undefined, null, NOW)), "none");
    assert.equal(to(decideArcPayment(row({ updatedAt: new Date(NOW - TX_NOT_FOUND_AFTER_MS - 1) }), undefined, null, NOW)), "CREATED");
  });
  it("expires an unsent free payment after 24h", () =>
    assert.equal(to(decideArcPayment(row({ state: "CREATED", payTxHash: null, createdAt: new Date(NOW - EXPIRE_AFTER_MS - 1) }), undefined, undefined, NOW)), "EXPIRED"));
});
