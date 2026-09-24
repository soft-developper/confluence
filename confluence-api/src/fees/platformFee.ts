import { mulDivCeil, parseUsdc } from "../lib/usdc.js";

/** Up to and including this amount, the flat fee applies. */
export const FLAT_FEE_THRESHOLD = parseUsdc("1000");
export const FLAT_FEE = parseUsdc("0.30");
/** Above the threshold: 0.10% = 10 basis points. */
export const PERCENT_FEE_BPS = 10n;

/**
 * Confluence platform fee, in USDC base units. Charged on top of the bridge amount
 * via App Kit customFee; Circle keeps 10% of it, the fee recipient receives 90%.
 *   amount <= 1,000 USDC -> 0.30 USDC
 *   amount  > 1,000 USDC -> 0.10% of amount, rounded up to the next base unit
 */
export function calculatePlatformFee(amountBase: bigint): bigint {
  if (amountBase <= 0n) throw new Error("amount must be positive");
  return amountBase <= FLAT_FEE_THRESHOLD ? FLAT_FEE : mulDivCeil(amountBase, PERCENT_FEE_BPS, 10_000n);
}

/** Share of the custom fee that reaches our recipient (90%), for revenue reporting. */
export function netPlatformFee(feeBase: bigint): bigint {
  return (feeBase * 90n) / 100n;
}
