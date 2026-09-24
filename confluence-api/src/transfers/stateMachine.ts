import type { TransferState } from "../db/schema.js";

/**
 * Maps App Kit bridge step reports (sent by the browser) to transfer states.
 * Step names come from @circle-fin/provider-cctp-v2 (CCTPv2StepName):
 * approve, burn, fetchAttestation, mint, reAttest.
 *
 * Client reports are unverified claims. The Stage 4 tracker confirms them on-chain,
 * so a reported burn moves to BURN_SUBMITTED (not BURN_CONFIRMED) and a reported
 * mint is still re-checked later.
 */
export const STEP_NAMES = ["approve", "burn", "fetchAttestation", "mint", "reAttest"] as const;
export type StepName = (typeof STEP_NAMES)[number];

export const STEP_STATES = ["pending", "success", "error", "noop"] as const;
export type StepState = (typeof STEP_STATES)[number];

/** Forward order of the happy path. FAILED and RECOVERY_REQUIRED sit outside it. */
const RANK: Partial<Record<TransferState, number>> = {
  CREATED: 0,
  APPROVED: 1,
  BURN_SUBMITTED: 2,
  BURN_CONFIRMED: 3,
  ATTESTATION_PENDING: 4,
  ATTESTED: 5,
  MINT_SUBMITTED: 6,
  COMPLETED: 7,
};

const SUCCESS_TARGET: Record<StepName, TransferState> = {
  approve: "APPROVED",
  burn: "BURN_SUBMITTED",
  fetchAttestation: "ATTESTED",
  reAttest: "ATTESTED",
  mint: "COMPLETED",
};

/** Steps that only happen after USDC has been burned on the source chain. */
const AFTER_BURN: ReadonlySet<StepName> = new Set(["fetchAttestation", "reAttest", "mint"]);

export interface TransitionInput {
  current: TransferState;
  hasBurnTx: boolean;
  step: StepName;
  state: StepState;
}

export type TransitionResult =
  | { kind: "move"; to: TransferState }
  | { kind: "stay"; reason: "not_forward" | "no_state_change" | "completed" };

/** Decides whether a step report moves the transfer. Never moves backwards. */
export function nextState({ current, hasBurnTx, step, state }: TransitionInput): TransitionResult {
  if (current === "COMPLETED") return { kind: "stay", reason: "completed" };

  if (state === "pending") return { kind: "stay", reason: "no_state_change" };

  // "noop" means the SDK skipped the step. For approve that means the allowance
  // already covered the amount, which is the same outcome as a successful approve.
  if (state === "noop" && step !== "approve") return { kind: "stay", reason: "no_state_change" };

  if (state === "error") {
    const burned = hasBurnTx || AFTER_BURN.has(step) || (RANK[current] ?? 0) >= (RANK.BURN_SUBMITTED ?? 2);
    const to: TransferState = burned ? "RECOVERY_REQUIRED" : "FAILED";
    // Once funds are burned, a later error must not downgrade to FAILED.
    if (current === "RECOVERY_REQUIRED" && to === "FAILED") return { kind: "stay", reason: "not_forward" };
    return current === to ? { kind: "stay", reason: "no_state_change" } : { kind: "move", to };
  }

  // success, or approve noop
  const to = SUCCESS_TARGET[step];
  if (current === "FAILED" || current === "RECOVERY_REQUIRED") {
    // A retry (kit.retry) succeeded. A FAILED transfer never burned, so it can only
    // recover through approve or burn. A RECOVERY_REQUIRED one already burned, so
    // approve and burn reports cannot move it (nothing to redo there).
    if (current === "FAILED" && AFTER_BURN.has(step)) return { kind: "stay", reason: "not_forward" };
    if (current === "RECOVERY_REQUIRED" && !AFTER_BURN.has(step)) return { kind: "stay", reason: "not_forward" };
    return { kind: "move", to };
  }
  if ((RANK[to] ?? 0) > (RANK[current] ?? 0)) return { kind: "move", to };
  return { kind: "stay", reason: "not_forward" };
}
