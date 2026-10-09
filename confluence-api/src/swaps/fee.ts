import { calculatePlatformFee, FLAT_FEE_THRESHOLD, PERCENT_FEE_BPS } from "../fees/platformFee.js";
import { formatUnits, parseUnits } from "../lib/units.js";
import { mulDivCeil } from "../lib/usdc.js";
import { STABLE_TOKENS, type SwapToken } from "./tokens.js";

/**
 * Confluence swap fee (Stage 6), the bridge rule applied to the swap's fee token
 * (confluence:fee-no-cliff):
 *   stablecoin fee token (USDC, EURC, USDT; 6 decimals):
 *     amount <= 1,000 -> 0.30, amount > 1,000 -> 0.30 + 0.01% of the part above 1,000
 *   any other fee token (for example cirBTC or the native token): 0.01% rounded up.
 *     No flat part: Confluence has no price for these tokens, so 0.30 USDC can't be
 *     expressed in them.
 * `amount` is what App Kit's computeFee callback receives: the input amount for
 * input-side fees, the estimated output for output-side fees (human-readable).
 * Circle keeps 10% of the custom fee; the recipient gets 90%.
 */
export function calculateSwapFee(token: SwapToken, amountHuman: string, decimals: number): { fee: string; rule: "flat" | "percent" } {
  const amount = parseUnits(amountHuman, decimals);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (STABLE_TOKENS.has(token) && decimals === 6) {
    return { fee: formatUnits(calculatePlatformFee(amount), 6), rule: amount <= FLAT_FEE_THRESHOLD ? "flat" : "percent" };
  }
  return { fee: formatUnits(mulDivCeil(amount, PERCENT_FEE_BPS, 10_000n), decimals), rule: "percent" };
}
