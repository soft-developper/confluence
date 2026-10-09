/**
 * Tracker decisions from Circle's data and the destination chain (confluence:verified-transfers).
 * Run with: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BridgeChain } from "../chains/registry.js";
import type { IrisMessage } from "../circle/iris.js";
import type { TransferState } from "../db/schema.js";
import { ABANDON_AFTER_MS, decide, recheckAfterMs, REPORTED_MINT_GRACE_MS, verifyMessage, type TrackedRow } from "./decide.js";

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

const chain = (id: string, domain: number, usdc: string): BridgeChain => ({
  id,
  name: id,
  evmChainId: domain + 1,
  cctpDomain: domain,
  isTestnet: false,
  explorerTxUrl: "https://example.org/tx/{hash}",
  usdcAddress: usdc,
  nativeCurrency: { name: "X", symbol: "X", decimals: 18 },
  rpcUrls: ["https://example.org"],
  forwarderAsDestination: true,
  messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
  speed: null,
});
const SRC = chain("Base", 6, USDC_BASE);
const DST = chain("Arc", 26, "0x3600000000000000000000000000000000000000");

function row(over: Partial<TrackedRow> = {}): TrackedRow {
  return {
    state: "BURN_SUBMITTED",
    useForwarder: true,
    speed: "SLOW",
    amountBase: "5000000",
    recipient: RECIPIENT,
    burnTxHash: "0x" + "ab".repeat(32),
    mintTxHash: null,
    errorCode: null,
    verifiedAt: null,
    createdAt: new Date(NOW - 10 * MIN),
    updatedAt: new Date(NOW - 5 * MIN),
    ...over,
  };
}

function msg(over: Partial<IrisMessage> = {}, body: Record<string, string> = {}, decoded: Record<string, string> = {}): IrisMessage {
  return {
    status: "complete",
    forwardState: null,
    forwardTxHash: null,
    decodedMessage: {
      sourceDomain: "6",
      destinationDomain: "26",
      nonce: "0x" + "cd".repeat(32),
      minFinalityThreshold: "2000",
      ...decoded,
      decodedMessageBody: {
        burnToken: USDC_BASE.toLowerCase(),
        mintRecipient: "0x000000000000000000000000" + RECIPIENT.slice(2),
        amount: "5000000",
        ...body,
      },
    },
    ...over,
  } as IrisMessage;
}

const run = (r: TrackedRow, message: IrisMessage | null | undefined, nonceUsed?: boolean, now = NOW) => decide({ row: r, src: SRC, dst: DST, message, nonceUsed, now });
const movedTo = (d: ReturnType<typeof decide>, to: TransferState, errorCode?: string | null) => {
  assert.equal(d.kind, "move", `expected a move, got: ${d.reason}`);
  assert.equal((d as { to: TransferState }).to, to);
  if (errorCode !== undefined) assert.equal((d as { errorCode?: string | null }).errorCode, errorCode);
};
const none = (d: ReturnType<typeof decide>) => assert.equal(d.kind, "none", `expected no change, got a move: ${d.reason}`);

describe("verifyMessage", () => {
  it("accepts Circle's message for this transfer", () => assert.deepEqual(verifyMessage(msg(), row(), SRC, DST), []));
  it("is not ready while the message is not decoded", () => assert.equal(verifyMessage(msg({ decodedMessage: null }), row(), SRC, DST), null));
  const cases: [string, IrisMessage, TrackedRow?][] = [
    ["wrong source chain", msg({}, {}, { sourceDomain: "0" })],
    ["wrong destination chain", msg({}, {}, { destinationDomain: "3" })],
    ["wrong token", msg({}, { burnToken: "0x0000000000000000000000000000000000000001" })],
    ["wrong recipient", msg({}, { mintRecipient: "0x000000000000000000000000" + "22".repeat(20) })],
    ["wrong amount", msg({}, { amount: "4999999" })],
    ["amount not a number", msg({}, { amount: "abc" })],
    ["Fast message for a Standard transfer", msg({}, {}, { minFinalityThreshold: "1000" })],
    ["Standard message for a Fast transfer", msg(), row({ speed: "FAST" })],
  ];
  for (const [name, m, r] of cases) {
    it(`flags ${name}`, () => assert.ok((verifyMessage(m, r ?? row(), SRC, DST) ?? []).length > 0));
  }
});

describe("decide: final states", () => {
  it("a verified COMPLETED transfer is final", () => none(run(row({ state: "COMPLETED", verifiedAt: new Date(NOW) }), msg())));
  it("a FAILED transfer is final", () => none(run(row({ state: "FAILED" }), msg())));
});

describe("decide: before any burn", () => {
  it("abandons a transfer with no burn after 24h (nothing was burned)", () =>
    movedTo(run(row({ state: "APPROVED", burnTxHash: null, updatedAt: new Date(NOW - ABANDON_AFTER_MS - MIN) }), undefined), "FAILED", "abandoned"));
  it("waits while it is younger than 24h", () => none(run(row({ state: "CREATED", burnTxHash: null, updatedAt: new Date(NOW - HOUR) }), undefined)));
});

describe("decide: Circle has not seen the burn", () => {
  it("waits while the burn is young", () => none(run(row(), null)));
  it("flags burn_not_found after 24h", () =>
    movedTo(run(row({ createdAt: new Date(NOW - 25 * HOUR) }), null), "RECOVERY_REQUIRED", "burn_not_found"));
  it("does nothing when Circle was not asked", () => none(run(row(), undefined)));
  it("waits while the message is not decoded", () => none(run(row(), msg({ status: "pending_confirmations", decodedMessage: null }))));
});

describe("decide: burn does not match", () => {
  it("flags burn_mismatch with the reasons", () => {
    const d = run(row(), msg({}, { amount: "1" }));
    movedTo(d, "RECOVERY_REQUIRED", "burn_mismatch");
    assert.ok((d as { mismatches?: string[] }).mismatches?.length);
  });
});

describe("decide: forwarding on", () => {
  it("completes when Circle reports the forwarded mint, keeping its tx hash", () => {
    const d = run(row({ state: "ATTESTED" }), msg({ forwardState: "CONFIRMED", forwardTxHash: "0x" + "EF".repeat(32) }));
    movedTo(d, "COMPLETED", null);
    assert.equal((d as { mintTxHash?: string }).mintTxHash, "0x" + "ef".repeat(32));
  });
  it("completes when the forward failed but the destination already received it", () =>
    movedTo(run(row({ state: "ATTESTED" }), msg({ forwardState: "FAILED" }), true), "COMPLETED", null));
  it("flags forward_failed when the forward failed and nothing arrived", () =>
    movedTo(run(row({ state: "ATTESTED" }), msg({ forwardState: "FAILED" }), false), "RECOVERY_REQUIRED", "forward_failed"));
  it("gives a reported self-mint time before flagging", () => {
    none(run(row({ state: "MINT_SUBMITTED", updatedAt: new Date(NOW - 5 * MIN) }), msg({ forwardState: "FAILED" }), false));
    movedTo(
      run(row({ state: "MINT_SUBMITTED", updatedAt: new Date(NOW - REPORTED_MINT_GRACE_MS - MIN) }), msg({ forwardState: "FAILED" }), false),
      "RECOVERY_REQUIRED",
      "forward_failed",
    );
  });
  it("does not flag forward_failed twice", () =>
    none(run(row({ state: "RECOVERY_REQUIRED", errorCode: "forward_failed" }), msg({ forwardState: "FAILED" }), false)));
  it("moves to ATTESTED while Circle is still forwarding", () => movedTo(run(row(), msg({ forwardState: "PENDING" })), "ATTESTED", null));
});

describe("decide: forwarding off", () => {
  it("completes when the destination received the message (the user minted)", () =>
    movedTo(run(row({ useForwarder: false, state: "ATTESTED" }), msg(), true), "COMPLETED", null));
  it("moves to ATTESTED once Circle attests", () => movedTo(run(row({ useForwarder: false, state: "ATTESTATION_PENDING" }), msg()), "ATTESTED", null));
  it("then waits for the user's mint", () => none(run(row({ useForwarder: false, state: "ATTESTED" }), msg(), false)));
  it("waits while the attestation is pending", () => none(run(row({ useForwarder: false }), msg({ status: "pending_confirmations" }))));
});

describe("decide: never backwards, and recovery", () => {
  it("does not move a reported mint back to ATTESTED", () => none(run(row({ useForwarder: false, state: "MINT_SUBMITTED" }), msg(), false)));
  it("clears a browser-reported problem once Circle attests", () =>
    movedTo(run(row({ useForwarder: false, state: "RECOVERY_REQUIRED", errorCode: "attestation_timeout" }), msg()), "ATTESTED", null));
});

describe("decide: COMPLETED before verification existed", () => {
  const done = (over: Partial<TrackedRow> = {}) => row({ state: "COMPLETED", ...over });
  it("verifies a match without moving it", () => none(run(done(), msg())));
  it("keeps it hidden as unverified when Circle has no message", () => movedTo(run(done(), null), "COMPLETED", "unverified"));
  it("flags a mismatch", () => movedTo(run(done(), msg({}, { amount: "1" })), "RECOVERY_REQUIRED", "burn_mismatch"));
});

describe("recheckAfterMs", () => {
  it("checks young transfers often and old ones rarely", () => {
    assert.equal(recheckAfterMs(30 * MIN), MIN);
    assert.equal(recheckAfterMs(3 * HOUR), 5 * MIN);
    assert.equal(recheckAfterMs(3 * 24 * HOUR), 30 * MIN);
    assert.equal(recheckAfterMs(10 * 24 * HOUR), 6 * HOUR);
  });
});
