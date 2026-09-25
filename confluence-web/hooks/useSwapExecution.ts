"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EIP1193Provider } from "viem";
import type { SwapResult } from "@circle-fin/app-kit";
import { ApiError, postSwap, postSwapEvent, type CreatedSwap, type SwapReportBody, type SwapTokenSymbol } from "@/lib/api";
import type { BridgeChain } from "@/lib/chains";
import { developerFee, loadSwapKit, withTxCapture } from "@/lib/swapKit";
import { saveTransferToken } from "@/lib/transferToken";

export interface SwapRun {
  phase: "idle" | "preparing" | "running" | "success" | "error";
  swap?: CreatedSwap;
  approvalTx?: string;
  swapTx?: string;
  /** Stage 6b: cross-chain delivery in progress / delivered on the destination. */
  delivering?: boolean;
  destinationTx?: string;
  explorerUrl?: string;
  amountOut?: string;
  fee?: { token: string; amount: string };
  error?: string;
}

export interface StartSwapArgs {
  chain: string;
  /** Stage 6b: set for a cross-chain swap. */
  destinationChain?: string;
  sender: `0x${string}`;
  tokenIn: SwapTokenSymbol;
  tokenOut: SwapTokenSymbol;
  amountIn: string;
  slippageBps: number;
  registry: readonly BridgeChain[];
  getProvider: () => Promise<unknown>;
}

export function useSwapExecution() {
  const [run, setRun] = useState<SwapRun>({ phase: "idle" });
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const busy = run.phase === "preparing" || run.phase === "running";

  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  const start = useCallback(
    async (a: StartSwapArgs) => {
      if (busy) return;
      setRun({ phase: "preparing" });
      let swap: CreatedSwap;
      try {
        swap = await postSwap(
          {
            chain: a.chain,
            ...(a.destinationChain ? { destinationChain: a.destinationChain } : {}),
            sender: a.sender,
            tokenIn: a.tokenIn,
            tokenOut: a.tokenOut,
            amountIn: a.amountIn,
          },
          crypto.randomUUID(),
        );
      } catch (e) {
        setRun({ phase: "error", error: e instanceof ApiError ? e.message : "Could not reach the Confluence API. Try again." });
        return;
      }
      // Same browser-only token store as transfers (Stage 2e), keyed by the swap id.
      saveTransferToken(swap.id, swap.reportToken);
      setRun({ phase: "preparing", swap });

      // Reports go out in order; failures never break the swap itself.
      const report = (body: SwapReportBody) => {
        chain.current = chain.current
          .then(() => postSwapEvent(swap.id, swap.reportToken, body))
          .catch((e: unknown) => console.warn("confluence: swap report failed:", e instanceof Error ? e.message : e));
        return chain.current;
      };

      try {
        const raw = (await a.getProvider()) as EIP1193Provider | undefined;
        if (!raw || typeof raw.request !== "function") throw new Error("The connected wallet did not provide a signer.");
        const provider = withTxCapture(raw, (tx) => {
          if (tx.kind === "approval") setRun((r) => ({ ...r, approvalTx: tx.hash }));
          else setRun((r) => ({ ...r, swapTx: tx.hash }));
          void report(tx.kind === "approval" ? { step: "approval", txHash: tx.hash } : { step: "swap", txHash: tx.hash });
        });
        const { kit, adapter, isUserCancellationError } = await loadSwapKit({
          provider,
          registry: a.registry,
          tokenIn: a.tokenIn,
          tokenOut: a.tokenOut,
          feeRecipient: swap.feeRecipient,
          // The backend records the fee side and returns the fee App Kit must charge.
          askFee: async ({ side, token, amount }) => {
            const r = await postSwapEvent(swap.id, swap.reportToken, { step: "fee", side, token, amount });
            if (!r.fee) throw new Error("the Confluence API did not return a fee");
            return r.fee;
          },
        });
        setRun((r) => ({ ...r, phase: "running" }));
        let result: SwapResult;
        try {
          result = await kit.swap({
            from: { adapter, chain: a.chain as never },
            ...(a.destinationChain ? { to: { chain: a.destinationChain as never, recipientAddress: a.sender } } : {}),
            tokenIn: a.tokenIn,
            tokenOut: a.tokenOut,
            amountIn: a.amountIn,
            config: { slippageBps: a.slippageBps },
          });
        } catch (e) {
          const cancelled = isUserCancellationError(e);
          await report({
            step: "error",
            errorCategory: cancelled ? "user_rejected" : "swap_error",
            errorMessage: (e instanceof Error ? e.message : String(e)).slice(0, 500),
          });
          setRun((r) => ({
            ...r,
            phase: "error",
            error: cancelled
              ? r.swapTx
                ? "The swap was sent, but a later step was declined. Check the transaction."
                : "You declined in your wallet. Nothing was swapped."
              : `The swap did not complete: ${firstSentence(e instanceof Error ? e.message : String(e))}`,
          }));
          return;
        }

        // Anything the provider watch did not see (for example a permit instead of an approval).
        const swapTx = result.txHash;
        if (swapTx) await report({ step: "swap", txHash: swapTx });
        const fee = developerFee(result.fees);
        const status = result.progress?.status ?? "DONE";
        await report({
          step: "result",
          status,
          ...(result.amountOut && /^\d+(\.\d+)?$/.test(result.amountOut) ? { amountOut: result.amountOut } : {}),
          ...(fee && /^\d+(\.\d+)?$/.test(fee.amount) ? { developerFee: fee.amount } : {}),
        });
        if (status !== "PENDING") {
          setRun((r) => ({
            ...r,
            phase: status === "FAILED" ? "error" : "success",
            swapTx,
            ...(result.explorerUrl ? { explorerUrl: result.explorerUrl } : {}),
            ...(result.amountOut ? { amountOut: result.amountOut } : {}),
            ...(fee ? { fee } : {}),
            ...(status === "FAILED" ? { error: "Circle reports the swap failed. No output was received." } : {}),
          }));
          return;
        }

        // Cross-chain: kit.swap returns while delivery is in progress. App Kit's docs say to
        // poll getSwapStatus for the destination leg until the status is terminal. If the tab
        // closes, the tracker (Stage 6a-1) finishes the row from the same status.
        setRun((r) => ({
          ...r,
          swapTx,
          delivering: true,
          ...(result.explorerUrl ? { explorerUrl: result.explorerUrl } : {}),
          ...(fee ? { fee } : {}),
        }));
        const deadline = Date.now() + 45 * 60_000;
        for (;;) {
          await new Promise((res) => setTimeout(res, 6_000));
          let st;
          try {
            st = await kit.getSwapStatus({
              txHash: swapTx,
              chainIn: a.chain as never,
              ...(a.destinationChain ? { chainOut: a.destinationChain as never } : {}),
            });
          } catch {
            if (Date.now() > deadline) break;
            continue;
          }
          const s2 = st.progress.status;
          if (s2 === "DONE" || s2 === "FAILED") {
            const destTx = st.destination?.txHash;
            await report({ step: "result", status: s2, ...(destTx && /^0x[0-9a-fA-F]{64}$/.test(destTx) ? { destinationTxHash: destTx } : {}) });
            setRun((r) => ({
              ...r,
              delivering: false,
              phase: s2 === "DONE" ? "success" : "error",
              ...(destTx ? { destinationTx: destTx } : {}),
              ...(s2 === "FAILED" ? { error: "Circle reports the cross-chain swap failed. Check the source transaction." } : {}),
            }));
            return;
          }
          if (Date.now() > deadline) break;
        }
        setRun((r) => ({
          ...r,
          delivering: false,
          phase: "error",
          error: "Delivery is taking longer than usual. The swap is on its way; Confluence keeps tracking it.",
        }));
      } catch (e) {
        await report({ step: "error", errorCategory: "swap_error", errorMessage: String(e instanceof Error ? e.message : e).slice(0, 500) });
        setRun((r) => ({ ...r, phase: "error", error: `The swap could not start: ${firstSentence(e instanceof Error ? e.message : String(e))}` }));
      }
    },
    [busy],
  );

  const reset = useCallback(() => {
    if (!busy) setRun({ phase: "idle" });
  }, [busy]);

  return { run, start, reset, busy };
}

function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  const end = t.search(/[.!?](\s|$)/);
  const one = end >= 0 ? t.slice(0, end + 1) : t;
  return one.length <= 160 ? one : `${one.slice(0, one.lastIndexOf(" ", 157))}...`;
}
