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

async function rpc(rpcUrls: readonly string[], method: string, params: unknown[], fetchImpl: typeof fetch): Promise<unknown> {
  let lastError: unknown;
  for (const url of rpcUrls) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(`RPC error: ${body.error.message ?? "unknown"}`);
      return body.result ?? null;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("all RPC endpoints failed");
}

// keccak256("Transfer(address,address,uint256)"), the standard ERC-20 Transfer event.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Whether a transaction was made by this wallet (confluence:verified-swaps): true when the
 * wallet sent it, or when its receipt shows an ERC-20 Transfer out of the wallet (covers smart
 * wallets, whose transactions are sent by a bundler). false when neither holds; null when the
 * node does not know the transaction or its receipt yet. Throws when no endpoint answers.
 */
export async function txMadeBy(rpcUrls: readonly string[], txHash: string, wallet: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("tx hash is not 32 bytes");
  const me = wallet.toLowerCase();
  const tx = (await rpc(rpcUrls, "eth_getTransactionByHash", [txHash], fetchImpl)) as { from?: unknown } | null;
  if (!tx) return null;
  if (typeof tx.from === "string" && tx.from.toLowerCase() === me) return true;
  const receipt = (await rpc(rpcUrls, "eth_getTransactionReceipt", [txHash], fetchImpl)) as { logs?: { topics?: unknown }[] } | null;
  if (!receipt) return null;
  const padded = "0x" + me.slice(2).padStart(64, "0");
  return (receipt.logs ?? []).some((l) => Array.isArray(l.topics) && String(l.topics[0]).toLowerCase() === TRANSFER_TOPIC && String(l.topics[1]).toLowerCase() === padded);
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
