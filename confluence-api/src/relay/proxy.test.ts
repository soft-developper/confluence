/**
 * Relay quote body (confluence:relay-refund-to). Run with: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQuoteBody, QuoteInput } from "./proxy.js";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const extras = { appFeeBps: 1, appFeeRecipient: "0x3333333333333333333333333333333333333333", referrer: "confluencebuild.xyz" };
const base = { user: USER, originChainId: 8453, destinationChainId: 5042, originCurrency: TOKEN, destinationCurrency: TOKEN, amount: "1000000", tradeType: "EXACT_INPUT" };

describe("buildQuoteBody refundTo", () => {
  it("refunds to the paying wallet when sending to yourself", () => {
    assert.equal(buildQuoteBody(QuoteInput.parse(base), extras).refundTo, USER);
  });
  it("refunds to the paying wallet, not the recipient, when sending to someone else", () => {
    const body = buildQuoteBody(QuoteInput.parse({ ...base, recipient: OTHER }), extras);
    assert.equal(body.recipient, OTHER);
    assert.equal(body.refundTo, USER);
  });
  it("ignores a refundTo sent by the browser", () => {
    const body = buildQuoteBody(QuoteInput.parse({ ...base, refundTo: OTHER }), extras);
    assert.equal(body.refundTo, USER);
  });
  it("still sets the app fee", () => {
    assert.deepEqual(buildQuoteBody(QuoteInput.parse(base), extras).appFees, [{ recipient: extras.appFeeRecipient, fee: "1" }]);
  });
});
