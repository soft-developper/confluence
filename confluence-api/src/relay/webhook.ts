import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Relay webhook verification (R3b), per https://docs.relay.link/references/api/api_guides/webhooks :
 * HMAC-SHA256 of `${timestamp}.${body}` with the API key as secret, compared with the
 * X-Signature-SHA256 header. We sign the raw request bytes as received.
 * (confluence:relay-webhook)
 */
export function verifyRelayWebhook(rawBody: Buffer | undefined, timestamp: string | undefined, signature: string | undefined, apiKey: string | undefined): boolean {
  if (!rawBody || !timestamp || !signature || !apiKey) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(signature) || !/^\d{1,20}$/.test(timestamp)) return false;
  const expected = createHmac("sha256", apiKey).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
