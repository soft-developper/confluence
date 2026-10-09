/**
 * Fee maths (confluence:fee-no-cliff). Run with: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUsdc } from "../lib/usdc.js";
import { calculatePlatformFee, FLAT_FEE, FLAT_FEE_THRESHOLD, maxAmountForBalance, netPlatformFee } from "./platformFee.js";

const fee = (usdc: string) => calculatePlatformFee(parseUsdc(usdc));

describe("calculatePlatformFee", () => {
  const table: [string, string][] = [
    ["0.000001", "0.30"],
    ["50", "0.30"],
    ["1000", "0.30"],
    ["1000.000001", "0.300001"], // 1 base unit above: 0.01% rounds up to 1 base unit
    ["1000.01", "0.300001"],
    ["2000", "0.40"],
    ["5000", "0.70"],
    ["10000", "1.20"],
    ["100000", "10.20"],
    ["1000000", "100.20"],
  ];
  for (const [amount, want] of table) {
    it(`${amount} USDC costs ${want}`, () => assert.equal(fee(amount), parseUsdc(want)));
  }

  it("has no jump at 1,000 USDC", () => {
    const step = fee("1000.000001") - fee("1000");
    assert.ok(step <= 1n, `fee jumped by ${step} base units`);
  });

  it("never goes down as the amount grows", () => {
    let prev = 0n;
    for (let a = 1n; a <= parseUsdc("5000"); a += 7_777_777n) {
      const f = calculatePlatformFee(a);
      assert.ok(f >= prev, `fee fell at ${a}`);
      prev = f;
    }
  });

  it("rejects zero and negative amounts", () => {
    assert.throws(() => calculatePlatformFee(0n));
    assert.throws(() => calculatePlatformFee(-1n));
  });
});

describe("maxAmountForBalance", () => {
  const ok = (balance: bigint) => {
    const a = maxAmountForBalance(balance);
    if (a === 0n) {
      assert.ok(balance <= FLAT_FEE, `0 returned for ${balance}`);
      return;
    }
    assert.ok(a + calculatePlatformFee(a) <= balance, `${a} does not fit in ${balance}`);
    assert.ok(a + 1n + calculatePlatformFee(a + 1n) > balance, `${a + 1n} also fits in ${balance}`);
  };

  it("returns 0 when the balance can't cover the flat fee plus 1 base unit", () => {
    assert.equal(maxAmountForBalance(0n), 0n);
    assert.equal(maxAmountForBalance(FLAT_FEE), 0n);
    assert.equal(maxAmountForBalance(FLAT_FEE + 1n), 1n);
  });

  it("is exact around the 1,000 USDC line", () => {
    for (let d = -5_000n; d <= 5_000n; d += 37n) ok(FLAT_FEE_THRESHOLD + FLAT_FEE + d);
    assert.equal(maxAmountForBalance(parseUsdc("1000.30")), parseUsdc("1000"));
  });

  it("is exact for small and large balances", () => {
    for (const b of ["0.5", "1", "12.345678", "999.99", "1500", "10001.2", "100010.2", "123456789.123456"]) ok(parseUsdc(b));
    assert.equal(maxAmountForBalance(parseUsdc("100010.20")), parseUsdc("100000"));
  });
});

describe("netPlatformFee", () => {
  it("is the 90% that reaches the fee recipient", () => {
    assert.equal(netPlatformFee(parseUsdc("0.30")), parseUsdc("0.27"));
    assert.equal(netPlatformFee(parseUsdc("10.20")), parseUsdc("9.18"));
  });
});
