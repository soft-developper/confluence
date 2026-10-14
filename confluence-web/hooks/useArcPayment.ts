"use client";

import { useCallback, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, erc20Abi, fallback, getAddress, http, type EIP1193Provider } from "viem";
import { arcPayErrorText, postArcPayment, type CreatedArcPayment, type ResumedArcPayment } from "@/lib/api";
import { toViemChain, type BridgeChain } from "@/lib/chains";
import { enqueueArcPayReport } from "@/lib/reportOutbox";
import { saveTransferToken } from "@/lib/transferToken";
import { useLeaveGuard } from "@/lib/leaveGuard";
import { recordPaidId } from "@/lib/pay";

/**
 * Pay a Confluence ID on Arc (confluence:arc-pay): two USDC transfers, fee first.
 * 1. create the payment (the API resolves the ID and sets the fee),
 * 2. the wallet sends the fee, we wait for Arc to include it,
 * 3. the wallet sends the payment, we wait again.
 * Each transaction hash goes to the durable report outbox before anything else, so it is
 * never lost. A declined or failed payment after the fee keeps the fee: it can be finished.
 */

export type PayStep = "fee" | "payment";
export type PayPhase = "idle" | "creating" | "review" | "fee" | "payment" | "success" | "error";

export interface PayError {
  message: string;
  /** The fee went through: the payment can be finished without paying it again. */
  feePaid: boolean;
  /**
   * The payment can be sent again right now: only when the wallet declined it, so no
   * payment transaction exists. After a sent transaction (slow or failed), resending here
   * could pay twice; the payment is finished from Activity once the tracker settles it.
   */
  canSendPayment: boolean;
}

/** viem's waitForTransactionReceipt gave up: the transaction may still land. Never resend. */
function isTimeout(e: unknown): boolean {
  return (e as { name?: unknown })?.name === "WaitForTransactionReceiptTimeoutError";
}

export interface PayState {
  phase: PayPhase;
  payment?: CreatedArcPayment;
  /** Finishing an earlier payment: the fee is already paid, only the payment is signed. */
  finishing?: boolean;
  feeTx?: string;
  payTx?: string;
  /** Waiting for Arc to include a sent transaction. */
  confirming?: boolean;
  error?: PayError;
}

function isRejection(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 6; cur = (cur as { cause?: unknown }).cause, i++) {
    const c = cur as { code?: unknown; name?: unknown; message?: unknown };
    if (c.code === 4001 || c.name === "UserRejectedRequestError") return true;
    if (typeof c.message === "string" && /user (rejected|denied)|rejected the request|request rejected|cancel+ed/i.test(c.message)) return true;
  }
  return false;
}

function shortReason(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "";
  const one = m.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return one.length > 160 ? `${one.slice(0, 157)}...` : one;
}

export interface StartPayArgs {
  arc: BridgeChain;
  sender: `0x${string}`;
  recipientId: string;
  amount: string;
  note?: string;
  getProvider: () => Promise<unknown>;
}

export function useArcPayment() {
  const [state, setState] = useState<PayState>({ phase: "idle" });
  const running = useRef(false);
  const ctx = useRef<{ args: StartPayArgs; payment: CreatedArcPayment; finishing?: boolean } | null>(null);
  const busy = state.phase === "creating" || state.phase === "fee" || state.phase === "payment";
  // Leaving mid-payment loses the live progress (funds stay safe), so ask first.
  useLeaveGuard(busy);

  const clients = useCallback(async (args: StartPayArgs) => {
    const chain = toViemChain(args.arc);
    const provider = (await args.getProvider()) as EIP1193Provider;
    const wallet = createWalletClient({ account: args.sender, chain, transport: custom(provider) });
    const reader = createPublicClient({ chain, transport: fallback(args.arc.rpcUrls.map((u) => http(u))) });
    return { wallet, reader };
  }, []);

  /** Sends one USDC transfer and waits until Arc includes it. Returns the hash. */
  const sendTransfer = useCallback(
    async (args: StartPayArgs, p: CreatedArcPayment, step: PayStep): Promise<string> => {
      const { wallet, reader } = await clients(args);
      const to = getAddress(step === "fee" ? p.feeRecipient : p.recipient);
      const value = BigInt(step === "fee" ? p.fee.base : p.amount.base);
      // viem checks the wallet is on Arc before it asks (chain mismatch is refused).
      const hash = await wallet.writeContract({ address: getAddress(p.usdc.address), abi: erc20Abi, functionName: "transfer", args: [to, value] });
      // Record the hash first: if anything below fails, the API still learns it.
      void enqueueArcPayReport(p.id, { step, state: "success", txHash: hash });
      setState((s) => ({ ...s, ...(step === "fee" ? { feeTx: hash } : { payTx: hash }), confirming: true }));
      const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success") throw Object.assign(new Error(`The ${step} transaction failed on Arc.`), { reverted: true });
      setState((s) => ({ ...s, confirming: false }));
      return hash;
    },
    [clients],
  );

  const runPayment = useCallback(
    async (args: StartPayArgs, p: CreatedArcPayment) => {
      setState((s) => ({ ...s, phase: "payment", error: undefined }));
      try {
        await sendTransfer(args, p, "payment");
        recordPaidId(args.sender, p.recipientId);
        setState((s) => ({ ...s, phase: "success", confirming: false }));
      } catch (e) {
        const rejected = isRejection(e);
        if (rejected) void enqueueArcPayReport(p.id, { step: "payment", state: "error", errorMessage: "declined in wallet" });
        setState((s) => ({
          ...s,
          phase: "error",
          confirming: false,
          error: {
            feePaid: true,
            canSendPayment: rejected,
            message: rejected
              ? `You declined the payment. Your ${p.fee.usdc} USDC fee is paid, so you can send the payment now, or later from Activity, without paying the fee again.`
              : isTimeout(e)
                ? "Arc hasn't confirmed your payment yet. Don't send it again: it may still go through. Check Activity in a few minutes."
                : (e as { reverted?: boolean }).reverted
                  ? "The payment failed on Arc and nothing reached the recipient. Your fee is paid: in a minute or two you can finish the payment from Activity without a new fee."
                  : `The payment did not complete. ${shortReason(e)} Your fee is paid. Check Activity before trying again, so you don't pay twice.`,
          },
        }));
      }
    },
    [sendTransfer],
  );

  /**
   * Creates the payment so the review shows the server's own numbers (resolved address,
   * fee, total). Nothing is signed yet; an unconfirmed payment simply expires.
   */
  const prepare = useCallback(async (args: StartPayArgs) => {
    if (running.current) return;
    running.current = true;
    try {
      setState({ phase: "creating" });
      try {
        const p = await postArcPayment(
          { sender: args.sender, recipientId: args.recipientId, amount: args.amount, ...(args.note ? { note: args.note } : {}) },
          crypto.randomUUID(),
        );
        saveTransferToken(p.id, p.reportToken);
        ctx.current = { args, payment: p };
        setState({ phase: "review", payment: p });
      } catch (e) {
        setState({ phase: "error", error: { feePaid: false, canSendPayment: false, message: arcPayErrorText(e) } });
      }
    } finally {
      running.current = false;
    }
  }, []);

  /**
   * Finish an earlier payment whose fee is paid (from Activity): shows it for review with
   * the fee marked done; confirming signs only the payment. Never charges the fee again.
   */
  const finish = useCallback((args: Omit<StartPayArgs, "recipientId" | "amount" | "note">, r: ResumedArcPayment, feeUsdc: string) => {
    if (running.current) return;
    saveTransferToken(r.id, r.reportToken);
    const p: CreatedArcPayment = {
      id: r.id,
      reportToken: r.reportToken,
      state: r.state,
      chain: args.arc.id,
      sender: args.sender,
      recipient: r.recipient,
      recipientId: r.recipientId,
      amount: r.amount,
      fee: { base: "0", usdc: feeUsdc },
      total: r.amount,
      feeRecipient: r.recipient, // unused: the fee is not sent again
      usdc: { address: args.arc.usdcAddress, decimals: 6 },
      note: null,
    };
    ctx.current = { args: { ...args, recipientId: r.recipientId, amount: r.amount.usdc }, payment: p, finishing: true };
    setState({ phase: "review", payment: p, finishing: true });
  }, []);

  /** Signs the fee, then the payment (or only the payment when finishing). */
  const start = useCallback(
    async () => {
      const c = ctx.current;
      if (running.current || !c) return;
      running.current = true;
      const { args, payment: p } = c;
      if (c.finishing) {
        try {
          setState((s) => ({ ...s, phase: "payment", finishing: true }));
          await runPayment(args, p);
        } finally {
          running.current = false;
        }
        return;
      }
      try {
        setState({ phase: "fee", payment: p });

        try {
          await sendTransfer(args, p, "fee");
        } catch (e) {
          const rejected = isRejection(e);
          const reverted = !!(e as { reverted?: boolean }).reverted;
          if (rejected) void enqueueArcPayReport(p.id, { step: "fee", state: "error", errorMessage: "declined in wallet" });
          setState((s) => ({
            ...s,
            phase: "error",
            confirming: false,
            error: {
              feePaid: false,
              canSendPayment: false,
              message: rejected
                ? "You declined the fee in your wallet. Nothing was sent."
                : isTimeout(e)
                  ? "Arc hasn't confirmed your fee yet. Don't send it again: check Activity in a few minutes, and finish the payment there once the fee shows as paid."
                  : reverted
                    ? "The fee transaction failed on Arc, so nothing was paid. You can try again."
                    : `The fee did not complete. ${shortReason(e)} Check your wallet before trying again.`,
            },
          }));
          return;
        }
        await runPayment(args, p);
      } finally {
        running.current = false;
      }
    },
    [runPayment, sendTransfer],
  );


  /** After the fee is paid and the wallet declined the payment: send only the payment. */
  const retryPayment = useCallback(async () => {
    const c = ctx.current;
    if (!c || running.current || !state.error?.canSendPayment) return;
    running.current = true;
    try {
      await runPayment(c.args, c.payment);
    } finally {
      running.current = false;
    }
  }, [runPayment, state.error?.canSendPayment]);

  const reset = useCallback(() => {
    if (running.current) return;
    ctx.current = null;
    setState({ phase: "idle" });
  }, []);

  return { state, busy, prepare, finish, start, retryPayment, reset };
}
