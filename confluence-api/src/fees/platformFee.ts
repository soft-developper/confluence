import { mulDivCeil, parseUsdc } from "../lib/usdc.js";

/** Up to and including this amount, only the flat fee applies. */
export const FLAT_FEE_THRESHOLD = parseUsdc("1000");
export const FLAT_FEE = parseUsdc("0.30");
/**
 * On the part above the threshold: 0.01% = 1 basis point (confluence:fee-no-cliff).
 * The same rate is used for swaps in non-stablecoin fee tokens and as the Relay app fee.
 */
export const PERCENT_FEE_BPS = 1n;

/**
 * Confluence platform fee, in USDC base units. Charged on top of the bridge amount
 * via App Kit customFee; Circle keeps 10% of it, the fee recipient receives 90%.
 *   amount <= 1,000 USDC -> 0.30 USDC
 *   amount  > 1,000 USDC -> 0.30 USDC + 0.01% of the part above 1,000, rounded up to
 *                           the next base unit
 * No jump at 1,000: the fee grows smoothly from 0.30 (confluence:fee-no-cliff).
 */
export function calculatePlatformFee(amountBase: bigint): bigint {
  if (amountBase <= 0n) throw new Error("amount must be positive");
  if (amountBase <= FLAT_FEE_THRESHOLD) return FLAT_FEE;
  return FLAT_FEE + mulDivCeil(amountBase - FLAT_FEE_THRESHOLD, PERCENT_FEE_BPS, 10_000n);
}

/** Share of the custom fee that reaches our recipient (90%), for revenue reporting. */
export function netPlatformFee(feeBase: bigint): bigint {
  return (feeBase * 90n) / 100n;
}

/**
 * Largest bridge amount a balance can cover, given the fee is charged ON TOP of
 * the amount (App Kit customFee): max a such that a + calculatePlatformFee(a) <= balance.
 * a + fee(a) only grows with a, so a binary search finds it for any fee rule.
 * Returns 0n when the balance cannot cover even the flat fee plus 1 base unit.
 */
export function maxAmountForBalance(balance: bigint): bigint {
  if (balance <= FLAT_FEE) return 0n;
  let lo = 1n; // always affordable: balance >= FLAT_FEE + 1
  let hi = balance - FLAT_FEE; // a + fee(a) >= a + FLAT_FEE, so a can't exceed this
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid + calculatePlatformFee(mid) <= balance) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
