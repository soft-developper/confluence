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

/**
 * Largest bridge amount a balance can cover, given the fee is charged ON TOP of
 * the amount (App Kit customFee): max a such that a + calculatePlatformFee(a) <= balance.
 * Returns 0n when the balance cannot cover even the flat fee plus 1 base unit.
 */
export function maxAmountForBalance(balance: bigint): bigint {
  if (balance <= FLAT_FEE) return 0n;
  // Flat tier: a <= threshold and a + FLAT_FEE <= balance
  const flatCandidate = balance - FLAT_FEE < FLAT_FEE_THRESHOLD ? balance - FLAT_FEE : FLAT_FEE_THRESHOLD;
  // Percent tier: a > threshold and a + ceil(a * bps / 10000) <= balance
  let pct = (balance * 10_000n) / (10_000n + PERCENT_FEE_BPS);
  while (pct > FLAT_FEE_THRESHOLD && pct + calculatePlatformFee(pct) > balance) pct -= 1n;
  while (pct + 1n > FLAT_FEE_THRESHOLD && pct + 1n + calculatePlatformFee(pct + 1n) <= balance) pct += 1n;
  const pctCandidate = pct > FLAT_FEE_THRESHOLD ? pct : 0n;
  return pctCandidate > flatCandidate ? pctCandidate : flatCandidate;
}
