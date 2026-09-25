"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EIP1193Provider } from "viem";
import type { BridgeChain as KitChain, BridgeResult, BridgeStep, BridgeWarning } from "@circle-fin/app-kit";
import { ApiError, postTransfer, postTransferEvent, transferErrorText, type CreatedTransfer, type Quote, type StepReportBody } from "@/lib/api";
import { loadBridgeKit, type LoadedBridgeKit } from "@/lib/bridgeKit";
import { saveTransferToken } from "@/lib/transferToken";
import { recordRecipient } from "@/lib/addressBook";
import type { BridgeChain } from "@/lib/chains";

/** The four stages shown to the user. reAttest is shown as the attestation stage. */
export const STAGES = ["approve", "burn", "fetchAttestation", "mint"] as const;
export type Stage = (typeof STAGES)[number];
export type StageStatus = "waiting" | "done" | "skipped" | "error";

export interface StageView {
  status: StageStatus;
  txHash?: string;
  explorerUrl?: string;
  forwarded?: boolean;
}

export interface ExecutionError {
  message: string;
  /** USDC already burned on the source chain: funds are in flight, never lost. */
  afterBurn: boolean;
  /** A retry of the same transfer is possible (App Kit retryBridge). */
  canRetry: boolean;
  /** Circle's Forwarding Service failed the mint: finish with Complete mint on the transaction page. */
  forwardFailed?: boolean;
}

export interface ExecutionState {
  phase: "idle" | "preparing" | "running" | "success" | "error";
  transfer?: CreatedTransfer;
  stages: Record<Stage, StageView>;
  warnings: BridgeWarning[];
  error?: ExecutionError;
}

const initialStages = (): Record<Stage, StageView> => ({
  approve: { status: "waiting" },
  burn: { status: "waiting" },
  fetchAttestation: { status: "waiting" },
  mint: { status: "waiting" },
});

const INITIAL: ExecutionState = { phase: "idle", stages: initialStages(), warnings: [] };

// App Kit step names (CCTPv2StepName). Its docs also show capitalized names, so match case-insensitively.
const KNOWN_STEPS: Record<string, { report: string; stage: Stage }> = {
  approve: { report: "approve", stage: "approve" },
  burn: { report: "burn", stage: "burn" },
  fetchattestation: { report: "fetchAttestation", stage: "fetchAttestation" },
  reattest: { report: "reAttest", stage: "fetchAttestation" },
  mint: { report: "mint", stage: "mint" },
};
const STEP_EVENTS = ["bridge.approve", "bridge.burn", "bridge.fetchAttestation", "bridge.reAttest", "bridge.mint"] as const;

const ERROR_CATEGORY = /^[a-z_]{1,64}$/;

function stageLabel(stage: Stage): string {
  return stage === "approve" ? "approval" : stage === "burn" ? "burn" : stage === "mint" ? "mint" : "attestation";
}

/** First sentence of an SDK message, capped, so we never cut a word in half. */
function firstSentence(raw: string | undefined): string {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const end = s.search(/[.!?](\s|$)/);
  const one = end >= 0 ? s.slice(0, end + 1) : s;
  return one.length <= 160 ? one : `${one.slice(0, one.lastIndexOf(" ", 157))}...`;
}

function errorText(stage: Stage | undefined, category: string | undefined, raw: string | undefined, afterBurn: boolean, to: BridgeChain, forwarded: boolean): string {
  // Circle keeps minting after an attestation problem, but not when its own mint failed.
  const circleStillMints = forwarded && stage !== "mint";
  const safe = afterBurn
    ? ` Your USDC is burned and safe.${circleStillMints ? ` Circle still mints on ${to.name} once it attests.` : ` Check your balance on ${to.name} before you retry.`}`
    : " Nothing was sent.";
  if (category === "user_rejected") return `You declined the ${stageLabel(stage ?? "approve")} in your wallet.${safe}`;
  if (category === "polling_timeout") return `Circle's attestation is taking longer than usual.${safe}`;
  if (category === "reverted_onchain" || category === "chain_revert") return `The ${stageLabel(stage ?? "burn")} transaction failed on chain.${safe}`;
  const detail = firstSentence(raw);
  return `The ${stageLabel(stage ?? "approve")} did not complete.${detail ? ` ${detail}` : ""}${safe}`;
}

export interface StartArgs {
  /** Returns a quote that is unused and not about to expire (refetches when needed). */
  getQuote: (opts: { fresh: boolean }) => Promise<Quote>;
  sender: `0x${string}`;
  from: BridgeChain;
  to: BridgeChain;
  registry: readonly BridgeChain[];
  getProvider: () => Promise<unknown>;
}

export function useBridgeExecution() {
  const [state, setState] = useState<ExecutionState>(INITIAL);

  const loaded = useRef<LoadedBridgeKit | null>(null);
  const lastResult = useRef<BridgeResult | null>(null);
  const transferRef = useRef<CreatedTransfer | null>(null);
  const reported = useRef(new Set<string>());
  const reportChain = useRef<Promise<void>>(Promise.resolve());
  const routeRef = useRef<{ to: BridgeChain; forwarded: boolean } | null>(null);

  const busy = state.phase === "preparing" || state.phase === "running";

  // Leaving mid-transfer loses the live progress (funds are still safe), so ask first.
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  /** Sends one step report, in order, once per (step, state). Failures never break the UI. */
  const report = useCallback((body: StepReportBody) => {
    const t = transferRef.current;
    if (!t) return;
    const key = `${body.step}:${body.state}`;
    if (body.state !== "pending") {
      if (reported.current.has(key)) return;
      reported.current.add(key);
    }
    reportChain.current = reportChain.current
      .then(() => postTransferEvent(t.id, t.reportToken, body))
      .catch((e: unknown) => {
        console.warn(`confluence: step report ${key} failed:`, e instanceof Error ? e.message : e);
      });
  }, []);

  /** App Kit's category, or user_rejected when the wallet message says so. */
  const categorize = useCallback((step: BridgeStep): string | undefined => {
    if (step.state !== "error") return step.errorCategory;
    if (step.errorCategory && step.errorCategory !== "unknown") return step.errorCategory;
    // Seen in testing: a wallet rejection on the sequential path arrives as "unknown".
    const isCancel = loaded.current?.isUserCancellationError;
    return isCancel && (isCancel(step.error) || isCancel(step.errorMessage)) ? "user_rejected" : step.errorCategory;
  }, []);

  /** Applies one App Kit step to the view and reports it. Safe to call twice for the same step. */
  const onStep = useCallback(
    (step: BridgeStep) => {
      const known = KNOWN_STEPS[step.name.toLowerCase()];
      if (!known) return;
      const category = categorize(step);
      if (step.state !== "pending") {
        setState((s) => {
          const status: StageStatus =
            step.state === "error" ? "error" : step.state === "noop" && known.stage === "approve" ? "skipped" : "done";
          const view: StageView = {
            status,
            ...(step.txHash ? { txHash: step.txHash } : {}),
            ...(step.explorerUrl ? { explorerUrl: step.explorerUrl } : {}),
            ...(step.forwarded !== undefined ? { forwarded: step.forwarded } : {}),
          };
          return { ...s, stages: { ...s.stages, [known.stage]: view } };
        });
      }
      report({
        step: known.report,
        state: step.state,
        ...(step.txHash ? { txHash: step.txHash } : {}),
        ...(category && ERROR_CATEGORY.test(category) ? { errorCategory: category } : {}),
        ...(step.errorMessage ? { errorMessage: step.errorMessage.slice(0, 500) } : {}),
        ...(step.forwarded !== undefined ? { forwarded: step.forwarded } : {}),
        ...(step.batched !== undefined ? { batched: step.batched } : {}),
      });
    },
    [report, categorize],
  );

  /** Reads the final App Kit result: reports anything the events missed, sets the outcome. */
  const finish = useCallback(
    (result: BridgeResult) => {
      lastResult.current = result;
      // After a retry the result holds the old failed step and the new attempt; only the
      // latest attempt of each step counts.
      const latest = new Map<string, BridgeStep>();
      for (const step of result.steps) {
        latest.delete(step.name.toLowerCase());
        latest.set(step.name.toLowerCase(), step);
      }
      for (const step of latest.values()) onStep(step);
      const warnings = result.warnings ?? [];
      const last = result.steps.at(-1);
      const lastKnown = last ? KNOWN_STEPS[last.name.toLowerCase()] : undefined;
      if (warnings.length > 0 && lastKnown) {
        report({
          step: lastKnown.report,
          state: "pending",
          warnings: warnings.slice(0, 10).map((w) => ({
            code: /^[A-Z0-9_]{1,64}$/.test(w.code) ? w.code : "UNKNOWN",
            ...(w.message ? { message: w.message.slice(0, 300) } : {}),
          })),
        });
      }
      if (result.state === "success") {
        setState((s) => ({ ...s, phase: "success", warnings, error: undefined }));
        return;
      }
      const failed = [...result.steps].reverse().find((st) => st.state === "error");
      const stage = failed ? KNOWN_STEPS[failed.name.toLowerCase()]?.stage : undefined;
      const afterBurn = result.steps.some((st) => st.name.toLowerCase() === "burn" && st.state === "success");
      const route = routeRef.current;
      // App Kit's RELAYER_FORWARD_FAILED ("Circle relayer failed to forward the mint transaction").
      // FAILED is final at Circle, so retrying the forwarded flow cannot help; the transaction
      // page submits the mint with the user's wallet instead (Stage 4b).
      const forwardFailed =
        stage === "mint" && !!route?.forwarded && /relayer failed to forward/i.test(failed?.errorMessage ?? "");
      setState((s) => ({
        ...s,
        phase: "error",
        warnings,
        error: {
          message: forwardFailed
            ? `Circle's Forwarding Service could not submit the mint on ${route!.to.name}. Your USDC is burned and safe. Open the transaction page to submit the mint yourself.`
            : route
            ? errorText(stage, failed ? categorize(failed) : undefined, failed?.errorMessage, afterBurn, route.to, route.forwarded)
            : failed?.errorMessage ?? "The bridge did not complete.",
          afterBurn,
          // Before the burn nothing is on chain, so a retry is a fresh start (new quote and
          // transfer). After the burn, retryBridge continues the same transfer.
          canRetry: afterBurn && !forwardFailed,
          forwardFailed,
        },
      }));
    },
    [onStep, report, categorize],
  );

  const fail = useCallback((message: string, afterBurn = false) => {
    setState((s) => ({ ...s, phase: "error", error: { message, afterBurn, canRetry: afterBurn } }));
  }, []);

  const withListeners = useCallback(
    async (run: (l: LoadedBridgeKit) => Promise<BridgeResult>) => {
      const l = loaded.current;
      if (!l) throw new Error("bridge kit not loaded");
      const handler = (payload: { values?: unknown }) => {
        const v = payload.values as BridgeStep | undefined;
        if (v && typeof v.name === "string") onStep(v);
      };
      for (const e of STEP_EVENTS) l.kit.on(e, handler);
      try {
        return await run(l);
      } finally {
        for (const e of STEP_EVENTS) l.kit.off(e, handler);
      }
    },
    [onStep],
  );

  const start = useCallback(
    async (args: StartArgs) => {
      if (busy) return;
      reported.current = new Set();
      reportChain.current = Promise.resolve();
      lastResult.current = null;
      transferRef.current = null;
      setState({ phase: "preparing", stages: initialStages(), warnings: [] });

      // 1) Transfer row from a valid quote. One automatic retry with a fresh quote.
      let transfer: CreatedTransfer;
      try {
        let quote = await args.getQuote({ fresh: false });
        try {
          transfer = await postTransfer({ quoteId: quote.id, sender: args.sender }, crypto.randomUUID());
        } catch (e) {
          if (e instanceof ApiError && (e.code === "quote_expired" || e.code === "quote_already_used")) {
            quote = await args.getQuote({ fresh: true });
            transfer = await postTransfer({ quoteId: quote.id, sender: args.sender }, crypto.randomUUID());
          } else throw e;
        }
      } catch (e) {
        fail(transferErrorText(e));
        return;
      }
      transferRef.current = transfer;
      saveTransferToken(transfer.id, transfer.reportToken);
      // Recent recipients: only addresses other than the sender (recordRecipient skips self).
      recordRecipient(args.sender, transfer.recipient, args.to.id);
      routeRef.current = { to: args.to, forwarded: transfer.useForwarder };
      setState((s) => ({ ...s, transfer }));

      // 2) Wallet adapter and App Kit (loaded on demand).
      try {
        const provider = (await args.getProvider()) as EIP1193Provider | undefined;
        if (!provider || typeof provider.request !== "function") throw new Error("The connected wallet did not provide a signer.");
        loaded.current = await loadBridgeKit(provider, args.registry);
      } catch (e) {
        fail(`Could not start the bridge: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }

      // 3) Execute. Every amount and fee comes from the transfer the API created.
      setState((s) => ({ ...s, phase: "running" }));
      try {
        const differentRecipient = transfer.recipient.toLowerCase() !== transfer.sender.toLowerCase();
        const result = await withListeners(({ kit, adapter }) =>
          kit.bridge({
            from: { adapter, chain: args.from.id as `${KitChain}` },
            to: {
              adapter,
              chain: args.to.id as `${KitChain}`,
              ...(differentRecipient ? { recipientAddress: transfer.recipient } : {}),
              useForwarder: transfer.useForwarder,
            },
            amount: transfer.amount.usdc,
            config: {
              transferSpeed: transfer.speed,
              // Locked decision: always the sequential approve then burn flow.
              batchTransactions: false,
              customFee: transfer.customFee,
            },
          }),
        );
        finish(result);
      } catch (e) {
        fail(`The bridge could not start: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
      }
    },
    [busy, fail, finish, withListeners],
  );

  /** Continues a transfer that failed after the burn (attestation or mint). */
  const retry = useCallback(async () => {
    const result = lastResult.current;
    if (!result || !loaded.current || busy) return;
    setState((s) => ({
      ...s,
      phase: "running",
      error: undefined,
      stages: Object.fromEntries(
        Object.entries(s.stages).map(([k, v]) => [k, v.status === "error" ? { status: "waiting" } : v]),
      ) as Record<Stage, StageView>,
    }));
    // Let a repeated failure of the retried stage be reported again.
    for (const k of [...reported.current]) if (k.endsWith(":error")) reported.current.delete(k);
    try {
      const next = await withListeners(({ kit, adapter }) => kit.retryBridge(result, { from: adapter, to: adapter }));
      finish(next);
    } catch (e) {
      fail(`Retry failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}. Your USDC is burned and safe.`, true);
    }
  }, [busy, fail, finish, withListeners]);

  const reset = useCallback(() => {
    if (busy) return;
    loaded.current = null;
    lastResult.current = null;
    transferRef.current = null;
    setState(INITIAL);
  }, [busy]);

  return { state, start, retry, reset, busy };
}
