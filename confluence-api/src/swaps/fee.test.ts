/**
 * Swap fee maths (confluence:fee-no-cliff). Run with: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnits } from "../lib/units.js";
import { calculateSwapFee } from "./fee.js";
import type { SwapToken } from "./tokens.js";

const swapFee = (token: string, amount: string, decimals: number) => {
  const r = calculateSwapFee(token as SwapToken, amount, decimals);
  return { base: parseUnits(r.fee, decimals), rule: r.rule };
};

describe("calculateSwapFee, stablecoin fee token", () => {
  for (const token of ["USDC", "EURC", "USDT"]) {
    it(`${token}: same rule as the bridge`, () => {
      assert.deepEqual(swapFee(token, "100", 6), { base: parseUnits("0.30", 6), rule: "flat" });
      assert.deepEqual(swapFee(token, "1000", 6), { base: parseUnits("0.30", 6), rule: "flat" });
      assert.deepEqual(swapFee(token, "1000.01", 6), { base: parseUnits("0.300001", 6), rule: "percent" });
      assert.deepEqual(swapFee(token, "100000", 6), { base: parseUnits("10.20", 6), rule: "percent" });
    });
  }
});

describe("calculateSwapFee, other fee token", () => {
  it("cirBTC (8 decimals): 0.01% of the amount", () => {
    assert.deepEqual(swapFee("CIRBTC", "1", 8), { base: parseUnits("0.0001", 8), rule: "percent" });
    assert.deepEqual(swapFee("CIRBTC", "0.5", 8), { base: parseUnits("0.00005", 8), rule: "percent" });
  });
  it("rounds a tiny fee up to 1 base unit", () => {
    assert.equal(swapFee("CIRBTC", "0.00000001", 8).base, 1n);
  });
  it("rejects zero", () => {
    assert.throws(() => calculateSwapFee("CIRBTC" as SwapToken, "0", 8));
  });
});
