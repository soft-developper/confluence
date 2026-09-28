/**
 * Pre-sign check of a Relay quote (R3a), using only Relay's own published data. Every
 * transaction may only go to Relay's contracts for the origin chain as listed by
 * GET /chains (contracts, protocol depository, solver addresses), or to the token being
 * approved / transferred, and then only towards one of those contracts. The quote's
 * details must match what the user asked for. A quote that fails never reaches the wallet.
 * (confluence:relay-verify)
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const APPROVE = "0x095ea7b3";
const TRANSFER = "0xa9059cbb";

function collectAddresses(v: unknown, out: Set<string>, depth = 0) {
  if (depth > 4 || v === null || v === undefined) return;
  if (typeof v === "string") {
    if (ADDRESS.test(v)) out.add(v.toLowerCase());
    return;
  }
  if (Array.isArray(v)) v.forEach((x) => collectAddresses(x, out, depth + 1));
  else if (typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => collectAddresses(x, out, depth + 1));
}

/** Relay's own addresses on a chain, from its /chains entry. */
export function allowedTargets(chain: unknown): Set<string> {
  const out = new Set<string>();
  const c = (chain ?? {}) as { contracts?: unknown; protocol?: unknown; solverAddresses?: unknown };
  collectAddresses(c.contracts, out);
  collectAddresses(c.protocol, out);
  collectAddresses(c.solverAddresses, out);
  out.delete("0x0000000000000000000000000000000000000000");
  return out;
}

/** The address argument of approve(spender, amount) / transfer(to, amount) calldata. */
function firstAddressArg(data: string): string | null {
  if (data.length < 10 + 64) return null;
  const word = data.slice(10, 10 + 64);
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(word)) return null;
  return `0x${word.slice(24)}`.toLowerCase();
}

export interface VerifyInput {
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  recipient: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

/** Returns null when the quote is safe to sign, or the reason it is not. */
export function verifyQuote(quote: unknown, input: VerifyInput, originChain: unknown): string | null {
  const allowed = allowedTargets(originChain);
  if (allowed.size === 0) return "no Relay contracts are published for the origin chain";
  const token = input.originCurrency.toLowerCase();
  const q = obj(quote);

  const steps = Array.isArray(q.steps) ? q.steps : [];
  if (steps.length === 0) return "quote has no steps";
  for (const s of steps) {
    const step = obj(s);
    if (step.depositAddress) return "quote uses a deposit address, which Confluence never requests";
    const items = Array.isArray(step.items) ? step.items : [];
    for (const it of items) {
      const data = obj(obj(it).data);
      if (step.kind === "transaction") {
        const to = lower(data.to);
        if (!ADDRESS.test(to)) return `step ${String(step.id)} has no valid target`;
        if (data.chainId !== undefined && Number(data.chainId) !== input.originChainId) return `step ${String(step.id)} targets another chain`;
        if (allowed.has(to)) continue;
        if (to === token) {
          const calldata = lower(data.data);
          const sel = calldata.slice(0, 10);
          if (sel !== APPROVE && sel !== TRANSFER) return `step ${String(step.id)} calls the token with an unexpected function`;
          const arg = firstAddressArg(calldata);
          if (!arg || !allowed.has(arg)) return `step ${String(step.id)} ${sel === APPROVE ? "approves" : "transfers to"} an address that is not a Relay contract`;
          continue;
        }
        return `step ${String(step.id)} sends to ${to}, which is not a Relay contract on this chain`;
      } else if (step.kind === "signature") {
        const vc = lower(obj(obj(data.sign).domain).verifyingContract);
        if (vc && !allowed.has(vc) && vc !== token) return `step ${String(step.id)} asks to sign for an unknown contract`;
      } else {
        return `unknown step kind ${String(step.kind)}`;
      }
    }
  }

  const p = obj(q.protocol);
  for (const pd of [obj(p.paymentDetails), obj(obj(p.v2).paymentDetails)]) {
    const r = lower(pd.recipient);
    if (r && !allowed.has(r)) return "protocol deposit does not pay a Relay depository";
  }

  const d = obj(q.details);
  const cin = obj(d.currencyIn);
  const cout = obj(d.currencyOut);
  const cinC = obj(cin.currency);
  const coutC = obj(cout.currency);
  if (lower(d.recipient) !== input.recipient.toLowerCase()) return "quote recipient does not match";
  if (lower(cinC.address) !== token || Number(cinC.chainId) !== input.originChainId) return "quote input token does not match";
  if (lower(coutC.address) !== input.destinationCurrency.toLowerCase() || Number(coutC.chainId) !== input.destinationChainId)
    return "quote output token does not match";
  // Relay may report the input net of fees, but must never take more than requested.
  if (typeof cin.amount !== "string" || !/^[0-9]{1,78}$/.test(cin.amount) || BigInt(cin.amount) > BigInt(input.amount))
    return "quote input amount does not match";
  return null;
}
