import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Relay webhook verification (R3b), per https://docs.relay.link/references/api/api_guides/webhooks :
 * HMAC-SHA256 of `${timestamp}.${body}` with the API key as secret, compared with the
 * X-Signature-SHA256 header. We sign the raw request bytes as received.
 * (confluence:relay-webhook)
 *
 * Freshness (confluence:webhook-freshness): the signed timestamp must be no more than 5
 * minutes in the future and no older than 24 hours. Relay's docs give no window and say
 * failed deliveries are retried up to 10 times with exponential backoff, so the window is
 * wide enough for every retry; status updates only ever move forward, so a replay inside
 * it can't undo anything. Seconds and milliseconds are both accepted.
 */
const MAX_AGE_MS = 24 * 3600_000;
const MAX_FUTURE_MS = 5 * 60_000;

export function webhookTimestampFresh(timestamp: string, now = Date.now()): boolean {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return false;
  const ms = n > 1e12 ? n : n * 1000;
  return ms <= now + MAX_FUTURE_MS && now - ms <= MAX_AGE_MS;
}

export function verifyRelayWebhook(rawBody: Buffer | undefined, timestamp: string | undefined, signature: string | undefined, apiKey: string | undefined): boolean {
  if (!rawBody || !timestamp || !signature || !apiKey) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(signature) || !/^\d{1,20}$/.test(timestamp)) return false;
  if (!webhookTimestampFresh(timestamp)) return false;
  const expected = createHmac("sha256", apiKey).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
