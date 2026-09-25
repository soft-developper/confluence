/**
 * Minimal JSON-RPC reads for the tracker, over the chain's App Kit RPC endpoints.
 * No wallet and no extra dependency: one eth_call, tried against each endpoint in order.
 */

// MessageTransmitterV2.usedNonces(bytes32) returns uint256, non-zero once the message
// was received on the destination. Selector = keccak256("usedNonces(bytes32)")[0:4].
// ABI as shipped in @circle-fin/adapter-viem-v2; contract docs:
// https://developers.circle.com/cctp/technical-guide (MessageTransmitterV2, Nonces)
export const USED_NONCES_SELECTOR = "0xfeb61724";

export async function ethCall(rpcUrls: readonly string[], to: string, data: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let lastError: unknown;
  for (const url of rpcUrls) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(`RPC error: ${body.error.message ?? "unknown"}`);
      if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(body.result)) throw new Error("RPC returned no result");
      return body.result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("all RPC endpoints failed");
}

/** Whether the destination already received this CCTP message. Throws when it cannot tell. */
export async function isNonceUsed(
  rpcUrls: readonly string[],
  messageTransmitter: string,
  nonce: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error("nonce is not bytes32");
  const out = await ethCall(rpcUrls, messageTransmitter, USED_NONCES_SELECTOR + nonce.slice(2).toLowerCase(), fetchImpl);
  return out !== "0x" && BigInt(out) !== 0n;
}
