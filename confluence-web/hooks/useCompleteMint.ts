"use client";

import { useCallback, useState } from "react";
import type { EIP1193Provider } from "viem";
import type { BridgeResult, BridgeStep } from "@circle-fin/app-kit";
import { postTransferEvent, type TransferDetail } from "@/lib/api";
import { loadBridgeKit } from "@/lib/bridgeKit";
import type { BridgeChain } from "@/lib/chains";
import { loadTransferToken } from "@/lib/transferToken";

export type CompleteMintState =
  | { status: "idle" }
  | { status: "working"; step: "loading" | "attestation" | "wallet" }
  | { status: "done"; mintTxHash?: string; explorerUrl?: string; reported: boolean }
  | { status: "error"; message: string };

// Provider name App Kit uses to route a retry (CCTPV2BridgingProvider.name in @circle-fin/provider-cctp-v2).
const CCTP_PROVIDER = "CCTPV2BridgingProvider";

/**
 * Submits the destination mint for a transfer that burned with forwarding off, from the
 * database row alone (the original tab may be gone). App Kit's retry continues from the
 * steps it is given: approve and burn succeeded, so it fetches the attestation for the
 * burn hash and then mints with the connected wallet on the destination chain.
 */
export function useCompleteMint() {
  const [state, setState] = useState<CompleteMintState>({ status: "idle" });

  const run = useCallback(
    async (args: {
      transfer: TransferDetail;
      from: BridgeChain;
      to: BridgeChain;
      registry: readonly BridgeChain[];
      getProvider: () => Promise<unknown>;
    }) => {
      const { transfer: t } = args;
      if (!t.burnTxHash || t.useForwarder) return;
      setState({ status: "working", step: "loading" });
      try {
        const provider = (await args.getProvider()) as EIP1193Provider | undefined;
        if (!provider || typeof provider.request !== "function") throw new Error("The connected wallet did not provide a signer.");
        const { kit, adapter, isUserCancellationError } = await loadBridgeKit(provider, args.registry);
        const defs = kit.getSupportedChains("bridge");
        const source = defs.find((d) => d.chain === args.from.id);
        const destination = defs.find((d) => d.chain === args.to.id);
        if (!source || !destination) throw new Error("This route is not supported by App Kit any more.");

        const differentRecipient = t.recipient.toLowerCase() !== t.sender.toLowerCase();
        const result = {
          state: "error",
          amount: t.amount.usdc,
          token: "USDC",
          source: { address: t.sender, chain: source },
          destination: {
            address: t.sender,
            chain: destination,
            ...(differentRecipient ? { recipientAddress: t.recipient } : {}),
          },
          steps: [
            { name: "approve", state: "success" },
            { name: "burn", state: "success", txHash: t.burnTxHash },
          ],
          config: { transferSpeed: t.speed, batchTransactions: false },
          provider: CCTP_PROVIDER,
        } as unknown as BridgeResult;

        const onEvent = (payload: { values?: unknown }) => {
          const v = payload.values as BridgeStep | undefined;
          if (v?.name?.toLowerCase() === "fetchattestation" && v.state === "success") setState({ status: "working", step: "wallet" });
        };
        kit.on("bridge.fetchAttestation", onEvent);
        setState({ status: "working", step: "attestation" });
        let next: BridgeResult;
        try {
          next = await kit.retryBridge(result, { from: adapter, to: adapter });
        } finally {
          kit.off("bridge.fetchAttestation", onEvent);
        }

        const mint = [...next.steps].reverse().find((s) => s.name.toLowerCase() === "mint");
        const token = loadTransferToken(t.id);
        let reported = false;
        if (token) {
          // Report only what this retry did, so the database catches up with the chain.
          for (const s of next.steps.slice(2)) {
            const name = s.name.toLowerCase() === "fetchattestation" ? "fetchAttestation" : s.name.toLowerCase() === "reattest" ? "reAttest" : s.name.toLowerCase();
            if (!["fetchAttestation", "reAttest", "mint"].includes(name) || s.state === "pending") continue;
            try {
              await postTransferEvent(t.id, token, {
                step: name,
                state: s.state,
                ...(s.txHash ? { txHash: s.txHash } : {}),
                ...(s.errorMessage ? { errorMessage: s.errorMessage.slice(0, 500) } : {}),
              });
              reported = true;
            } catch {
              // The page still shows the mint from the chain; Stage 4 will reconcile.
            }
          }
        }

        if (next.state === "success" && mint?.state === "success") {
          setState({
            status: "done",
            ...(mint.txHash ? { mintTxHash: mint.txHash } : {}),
            ...(mint.explorerUrl ? { explorerUrl: mint.explorerUrl } : {}),
            reported,
          });
          return;
        }
        const failed = [...next.steps].reverse().find((s) => s.state === "error");
        const cancelled = failed && (isUserCancellationError(failed.error) || isUserCancellationError(failed.errorMessage));
        setState({
          status: "error",
          message: cancelled
            ? "You declined the mint in your wallet. Your USDC is still safe; you can try again."
            : `The mint did not complete. ${(failed?.errorMessage ?? "").split(/(?<=[.!?])\s/)[0]?.slice(0, 160) ?? ""} Your USDC is still safe.`.replace(/\s+/g, " "),
        });
      } catch (e) {
        setState({ status: "error", message: `Could not complete the mint: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` });
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset };
}
