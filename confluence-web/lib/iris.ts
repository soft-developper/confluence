import { z } from "zod";
import { isMainnet } from "./env";

/**
 * Circle's CCTP API (Iris), read directly from the browser (read-only).
 * Endpoint: GET /v2/messages/{sourceDomainId}?transactionHash=
 * Source: https://developers.circle.com/api-reference/cctp/all/get-messages-v2
 * Servers: https://iris-api-sandbox.circle.com (testnet), https://iris-api.circle.com (mainnet).
 */
const IRIS = isMainnet ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";

const MessageSchema = z
  .object({
    status: z.string(),
    attestation: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    forwardState: z.string().nullable().optional(),
    forwardTxHash: z.string().nullable().optional(),
    decodedMessage: z
      .object({ nonce: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type IrisMessage = z.infer<typeof MessageSchema>;

const ResponseSchema = z.object({ messages: z.array(MessageSchema) });

/**
 * The CCTP message for a burn transaction, or null while Circle has not indexed it yet
 * (the API answers 404 until then). One burn emits one USDC message.
 */
export async function fetchIrisMessage(sourceDomain: number, burnTxHash: string): Promise<IrisMessage | null> {
  const url = `${IRIS}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(burnTxHash)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Circle API returned ${res.status}`);
  const parsed = ResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("Unexpected response from Circle API");
  return parsed.data.messages[0] ?? null;
}

/** Iris forward states that mean Circle's Forwarding Service minted on the destination. */
export const FORWARD_DONE = new Set(["CONFIRMED", "COMPLETE"]);
