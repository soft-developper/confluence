/**
 * Source-chain burn proof (confluence:source-burn-proof). Run with: npm test
 * Receipts are built with viem from Circle's DepositForBurn event, the same layout the
 * check decodes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, pad } from "viem";
import type { TxReceipt } from "./chainReads.js";
import { checkBurnReceipt, DEPOSIT_FOR_BURN, type BurnExpectation, type SourceBurnResult } from "./sourceBurn.js";

const TM = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
const WRAP = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408"; // TokenMessengerWithFees
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ME = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const BUNDLER = "0x3333333333333333333333333333333333333333";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const want: BurnExpectation = { tokenMessenger: TM, usdcAddress: USDC, amountBase: "5000000", sender: ME, recipient: TO, destinationDomain: 26, speed: "SLOW" };

type Hex = `0x${string}`;
function burnLog(o: Partial<{ emitter: string; token: string; amount: bigint; depositor: string; recipient: string; domain: number; fin: number }> = {}) {
  const topics = encodeEventTopics({
    abi: [DEPOSIT_FOR_BURN],
    eventName: "DepositForBurn",
    args: { burnToken: (o.token ?? USDC) as Hex, depositor: (o.depositor ?? ME) as Hex, minFinalityThreshold: o.fin ?? 2000 },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes" }],
    [o.amount ?? 5000000n, pad((o.recipient ?? TO) as Hex), o.domain ?? 26, pad(TM), pad("0x00"), 0n, "0x"],
  );
  return { address: o.emitter ?? TM, topics: topics as string[], data };
}
const usdcOut = (from: string) => ({ address: USDC, topics: [TRANSFER_TOPIC, pad(from as Hex), pad(WRAP)], data: pad("0x01") });
const receipt = (logs: TxReceipt["logs"], from = ME, status = "0x1"): TxReceipt => ({ status, from, logs });

const cases: [string, TxReceipt | null, BurnExpectation, SourceBurnResult | null][] = [
  ["a wallet burning directly", receipt([burnLog()]), want, "ok"],
  ["a burn through the fee wrapper (depositor is the wrapper)", receipt([usdcOut(ME), burnLog({ depositor: WRAP })]), want, "ok"],
  ["a smart wallet sent by a bundler", receipt([usdcOut(ME), burnLog({ depositor: WRAP })], BUNDLER), want, "ok"],
  ["a Fast transfer", receipt([burnLog({ fin: 1000 })]), { ...want, speed: "FAST" }, "ok"],
  ["mixed-case addresses", receipt([burnLog()]), { ...want, sender: "0x" + ME.slice(2).toUpperCase(), recipient: "0x" + TO.slice(2).toUpperCase() }, "ok"],
  ["a transaction the chain does not know yet", null, want, null],
  ["a reverted transaction", receipt([], ME, "0x0"), want, "reverted"],
  ["the wrong amount", receipt([burnLog({ amount: 4999999n })]), want, "no_matching_burn"],
  ["the wrong recipient", receipt([burnLog({ recipient: BUNDLER })]), want, "no_matching_burn"],
  ["the wrong destination chain", receipt([burnLog({ domain: 6 })]), want, "no_matching_burn"],
  ["the wrong speed", receipt([burnLog({ fin: 1000 })]), want, "no_matching_burn"],
  ["the wrong token", receipt([burnLog({ token: BUNDLER })]), want, "no_matching_burn"],
  ["an event from a look-alike contract", receipt([burnLog({ emitter: BUNDLER })]), want, "no_matching_burn"],
  ["a plain transfer hash with no burn", receipt([usdcOut(ME)]), want, "no_matching_burn"],
  ["someone else's burn", receipt([usdcOut(BUNDLER), burnLog({ depositor: WRAP })], BUNDLER), want, "sender_mismatch"],
];

describe("checkBurnReceipt", () => {
  for (const [name, r, w, expected] of cases) {
    it(`${name}: ${expected ?? "not yet"}`, () => assert.equal(checkBurnReceipt(r, w), expected));
  }
});
