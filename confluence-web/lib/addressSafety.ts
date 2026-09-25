import { createPublicClient, fallback, http } from "viem";
import { toViemChain, type BridgeChain } from "./chains";

/**
 * Lookalike check (address poisoning): scammers send dust from an address that shares
 * the first and last characters with one you use, hoping you copy it from history.
 * Flags an address that matches a known one on the first 4 and last 4 hex characters
 * but is not the same address.
 */
export interface LookalikeMatch {
  address: string;
  label?: string;
}

const EDGE = 4;

export function findLookalike(address: string, known: readonly LookalikeMatch[]): LookalikeMatch | undefined {
  const a = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return undefined;
  const head = a.slice(2, 2 + EDGE);
  const tail = a.slice(-EDGE);
  return known.find((k) => {
    const b = k.address.toLowerCase();
    return b !== a && b.slice(2, 2 + EDGE) === head && b.slice(-EDGE) === tail;
  });
}

/**
 * What the recipient is on the destination chain, from eth_getCode.
 * - "eoa": no code (a regular wallet).
 * - "delegated": an EIP-7702 delegation designator (0xef0100 followed by a 20-byte
 *   address, https://eips.ethereum.org/EIPS/eip-7702). Still a regular wallet's key.
 * - "contract": other code. Smart wallets (for example Safe) can receive and move USDC;
 *   many other contracts cannot.
 * - undefined: could not tell (RPC error).
 */
export type RecipientKind = "eoa" | "delegated" | "contract";

export async function recipientKind(chain: BridgeChain, address: string): Promise<RecipientKind | undefined> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  try {
    const client = createPublicClient({ chain: toViemChain(chain), transport: fallback(chain.rpcUrls.map((u) => http(u))) });
    const code = await client.getCode({ address: address as `0x${string}` });
    if (!code || code === "0x") return "eoa";
    if (/^0xef0100[0-9a-fA-F]{40}$/.test(code)) return "delegated";
    return "contract";
  } catch {
    return undefined;
  }
}
