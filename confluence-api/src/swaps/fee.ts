import { calculatePlatformFee } from "../fees/platformFee.js";
import { formatUnits, parseUnits } from "../lib/units.js";
import { mulDivCeil } from "../lib/usdc.js";
import { STABLE_TOKENS, type SwapToken } from "./tokens.js";

/**
 * Confluence swap fee (Stage 6), the bridge rule applied to the swap's fee token:
 *   stablecoin fee token (USDC, EURC, USDT; 6 decimals):
 *     amount <= 1,000 -> 0.30, amount > 1,000 -> 0.10% rounded up
 *   any other fee token (for example the native token): 0.10% rounded up
 * `amount` is what App Kit's computeFee callback receives: the input amount for
 * input-side fees, the estimated output for output-side fees (human-readable).
 * Circle keeps 10% of the custom fee; the recipient gets 90%.
 */
export function calculateSwapFee(token: SwapToken, amountHuman: string, decimals: number): { fee: string; rule: "flat" | "percent" } {
  const amount = parseUnits(amountHuman, decimals);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (STABLE_TOKENS.has(token) && decimals === 6) {
    const fee = calculatePlatformFee(amount);
    return { fee: formatUnits(fee, 6), rule: fee === 300_000n ? "flat" : "percent" };
  }
  return { fee: formatUnits(mulDivCeil(amount, 10n, 10_000n), decimals), rule: "percent" };
}
