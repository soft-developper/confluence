/**
 * Browser step reports (confluence:verified-transfers). Run with: npm test
 * Reports are unverified claims: they can only move a transfer forward to "submitted"
 * or "pending" states, never to ATTESTED or COMPLETED, and never backwards.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TransferState } from "../db/schema.js";
import { nextState, type StepName, type StepState } from "./stateMachine.js";

const run = (current: TransferState, step: StepName, state: StepState, hasBurnTx = false) => nextState({ current, hasBurnTx, step, state });
const moves = (r: ReturnType<typeof nextState>, to: TransferState) => assert.deepEqual(r, { kind: "move", to });
const stays = (r: ReturnType<typeof nextState>, reason?: string) => {
  assert.equal(r.kind, "stay");
  if (reason) assert.equal((r as { reason: string }).reason, reason);
};

describe("nextState: happy path", () => {
  it("approve success moves CREATED to APPROVED", () => moves(run("CREATED", "approve", "success"), "APPROVED"));
  it("approve noop (allowance already enough) counts as approved", () => moves(run("CREATED", "approve", "noop"), "APPROVED"));
  it("burn success moves to BURN_SUBMITTED", () => moves(run("APPROVED", "burn", "success"), "BURN_SUBMITTED"));
  it("attestation success moves to ATTESTATION_PENDING, not ATTESTED", () =>
    moves(run("BURN_SUBMITTED", "fetchAttestation", "success", true), "ATTESTATION_PENDING"));
  it("mint success moves to MINT_SUBMITTED, not COMPLETED", () => moves(run("ATTESTATION_PENDING", "mint", "success", true), "MINT_SUBMITTED"));
});

describe("nextState: what a browser can never do", () => {
  for (const step of ["approve", "burn", "fetchAttestation", "mint", "reAttest"] as const) {
    for (const state of ["success", "error", "noop", "pending"] as const) {
      it(`${step} ${state} never reaches ATTESTED or COMPLETED`, () => {
        for (const current of ["CREATED", "APPROVED", "BURN_SUBMITTED", "ATTESTATION_PENDING", "MINT_SUBMITTED"] as const) {
          const r = run(current, step, state, true);
          if (r.kind === "move") assert.ok(r.to !== "ATTESTED" && r.to !== "COMPLETED", `${current} -> ${r.to}`);
        }
      });
    }
  }
  it("a completed transfer never changes", () => {
    for (const step of ["approve", "burn", "mint"] as const) stays(run("COMPLETED", step, "error", true), "completed");
  });
  it("steps after a burn need a known burn hash", () => {
    stays(run("APPROVED", "fetchAttestation", "success", false), "not_forward");
    stays(run("APPROVED", "mint", "success", false), "not_forward");
    stays(run("APPROVED", "reAttest", "success", false), "not_forward");
  });
  it("never moves backwards", () => {
    stays(run("MINT_SUBMITTED", "burn", "success", true), "not_forward");
    stays(run("ATTESTATION_PENDING", "approve", "success", true), "not_forward");
    stays(run("BURN_SUBMITTED", "burn", "success", true), "not_forward");
  });
  it("pending reports and skipped non-approve steps change nothing", () => {
    stays(run("APPROVED", "burn", "pending"), "no_state_change");
    stays(run("BURN_SUBMITTED", "mint", "noop", true), "no_state_change");
  });
});

describe("nextState: errors", () => {
  it("an error before any burn is FAILED (no money moved)", () => {
    moves(run("CREATED", "approve", "error"), "FAILED");
    moves(run("APPROVED", "burn", "error"), "FAILED");
  });
  it("an error after a burn is RECOVERY_REQUIRED (money is in flight)", () => {
    moves(run("BURN_SUBMITTED", "fetchAttestation", "error", true), "RECOVERY_REQUIRED");
    moves(run("ATTESTATION_PENDING", "mint", "error", true), "RECOVERY_REQUIRED");
  });
  it("a state that ranks past the burn counts as burned even without a hash", () => {
    moves(run("BURN_SUBMITTED", "burn", "error", false), "RECOVERY_REQUIRED");
  });
  it("a burned transfer is never downgraded to FAILED", () => {
    stays(run("RECOVERY_REQUIRED", "approve", "error", false), "not_forward");
  });
  it("repeating the same error changes nothing", () => {
    stays(run("FAILED", "approve", "error"), "no_state_change");
    stays(run("RECOVERY_REQUIRED", "mint", "error", true), "no_state_change");
  });
});

describe("nextState: retries", () => {
  it("a FAILED transfer recovers only through approve or burn", () => {
    moves(run("FAILED", "approve", "success"), "APPROVED");
    moves(run("FAILED", "burn", "success"), "BURN_SUBMITTED");
    stays(run("FAILED", "mint", "success", true), "not_forward");
  });
  it("a RECOVERY_REQUIRED transfer recovers only through steps after the burn", () => {
    moves(run("RECOVERY_REQUIRED", "reAttest", "success", true), "ATTESTATION_PENDING");
    moves(run("RECOVERY_REQUIRED", "mint", "success", true), "MINT_SUBMITTED");
    stays(run("RECOVERY_REQUIRED", "burn", "success", true), "not_forward");
    stays(run("RECOVERY_REQUIRED", "approve", "success", true), "not_forward");
  });
});
