import type { EIP1193Provider } from "viem";
import type { SwapEstimate, SwapResult } from "@circle-fin/app-kit";
import type { SwapTokenSymbol } from "./api";
import { loadBridgeKit } from "./bridgeKit";
import type { BridgeChain } from "./chains";

/**
 * Swaps run in the browser with App Kit, keyless (no Circle key on the client).
 * App Kit emits no progress events for swaps, so we watch the wallet provider:
 * every hash returned by eth_sendTransaction is reported straight away, which keeps
 * the database right even if the tab closes before kit.swap() returns.
 */
const APPROVE_SELECTORS = ["0x095ea7b3", "0x39509351"]; // approve, increaseAllowance

export type SentTx = { kind: "approval" | "swap"; hash: string };

export function withTxCapture(provider: EIP1193Provider, onTx: (tx: SentTx) => void): EIP1193Provider {
  const request = (async (args: { method: string; params?: unknown }) => {
    const out = await provider.request(args as never);
    if (args.method === "eth_sendTransaction" && typeof out === "string" && /^0x[0-9a-fA-F]{64}$/.test(out)) {
      const tx = (Array.isArray(args.params) ? args.params[0] : undefined) as { data?: string; input?: string } | undefined;
      const data = (tx?.data ?? tx?.input ?? "").toLowerCase();
      onTx({ kind: APPROVE_SELECTORS.some((s) => data.startsWith(s)) ? "approval" : "swap", hash: out });
    }
    return out;
  }) as EIP1193Provider["request"];
  // Keep every other member (on, removeListener, ...) of the original provider.
  return new Proxy(provider, { get: (target, prop, recv) => (prop === "request" ? request : Reflect.get(target, prop, recv)) });
}

export type FeeAsk = (args: { side: "input" | "output"; token: SwapTokenSymbol; amount: string }) => Promise<string>;

/**
 * App Kit with our swap fee policy. computeFee asks the backend (the fee rule lives
 * there); App Kit passes the input amount for input-side fees and the estimated
 * output for output-side fees (human-readable).
 */
export async function loadSwapKit(opts: {
  provider: EIP1193Provider;
  registry: readonly BridgeChain[];
  tokenIn: SwapTokenSymbol;
  tokenOut: SwapTokenSymbol;
  feeRecipient: string;
  askFee: FeeAsk;
}) {
  const loaded = await loadBridgeKit(opts.provider, opts.registry);
  loaded.kit.setCustomFeePolicy({
    swap: {
      computeFee: async (ctx) =>
        ctx.type === "input"
          ? opts.askFee({ side: "input", token: opts.tokenIn, amount: ctx.amountIn })
          : opts.askFee({ side: "output", token: opts.tokenOut, amount: ctx.estimatedAmount }),
      resolveFeeRecipientAddress: () => opts.feeRecipient,
    },
  });
  return loaded;
}

export type { SwapEstimate, SwapResult };

/**
 * The token value App Kit's swap expects (confluence:cirbtc-swap-ui). USDC, EURC, USDT and
 * NATIVE are App Kit aliases. cirBTC is not a public alias yet, so its contract address (from
 * the API's chain list, sourced from Circle's docs) is passed instead.
 */
export function kitSwapToken(chain: { tokens: readonly { symbol: string; address: string | null }[] } | undefined, symbol: SwapTokenSymbol): string {
  if (symbol !== "CIRBTC") return symbol;
  const address = chain?.tokens.find((t) => t.symbol === "CIRBTC")?.address;
  if (!address) throw new Error("cirBTC is not available on this network");
  return address;
}

/** App Kit spells some tokens differently (CIRBTC vs cirBTC): compare without case. */
export function sameSwapToken(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
}

/**
 * Text for a failed swap estimate (confluence:swap-no-route). Circle answers a quote with
 * "No route available" when it will not route this pair at this amount (seen with small
 * cirBTC amounts), so that one case gets plain wording. Every other error keeps Circle's text.
 */
export function estimateErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/no route available/i.test(message)) return "Circle has no route for this swap at this amount right now. Try a larger amount.";
  return `No estimate for this swap right now: ${message.slice(0, 160)}`;
}

/** The developer (our) fee from App Kit's fee list, if present. */
export function developerFee(fees: readonly { type: string; token: string; amount: string | null }[] | undefined) {
  const f = fees?.find((x) => x.type === "developer");
  return f && f.amount ? { token: f.token, amount: f.amount } : undefined;
}

/** A positive decimal with at most `decimals` places, else null. */
export function cleanAmount(v: string, decimals: number): string | null {
  const s = v.trim();
  if (!new RegExp(`^\\d{1,18}(\\.\\d{1,${decimals}})?$`).test(s)) return null;
  return Number(s) > 0 ? s.replace(/^0+(?=\d)/, "") : null;
}
