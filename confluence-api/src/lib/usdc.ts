/** USDC uses 6 decimals. All money math is bigint in base units; never floats. */
export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);
const HUMAN = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;

/** "1000.5" -> 1000500000n. Rejects signs, exponents, >6 decimals, >12 integer digits. */
export function parseUsdc(human: string): bigint {
  const s = human.trim();
  if (!HUMAN.test(s)) throw new Error(`invalid USDC amount: ${human}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole ?? "0") * SCALE + BigInt((frac + "000000").slice(0, 6));
}

/** 1000500000n -> "1000.5" (no trailing zeros, no grouping). */
export function formatUsdc(base: bigint): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = v / SCALE;
  const frac = (v % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** ceil(a * num / den) for non-negative bigints. */
export function mulDivCeil(a: bigint, num: bigint, den: bigint): bigint {
  return (a * num + den - 1n) / den;
}
