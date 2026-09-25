/** Token amounts as bigint base units for any decimals (swap tokens are not only USDC). */
export function parseUnits(human: string, decimals: number): bigint {
  const s = human.trim();
  const re = new RegExp(`^(0|[1-9]\\d{0,17})(\\.\\d{1,${decimals}})?$`);
  if (decimals === 0 ? !/^(0|[1-9]\d{0,17})$/.test(s) : !re.test(s)) throw new Error(`invalid amount: ${human}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole ?? "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatUnits(base: bigint, decimals: number): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  const frac = decimals === 0 ? "" : (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
