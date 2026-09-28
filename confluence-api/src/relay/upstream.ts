import { createHash } from "node:crypto";
import { TokenBucket } from "../lib/tokenBucket.js";

/**
 * Outbound client for the Relay API (R1). Holds the API key server-side, and follows
 * https://docs.relay.link/references/api/api_core_concepts/handling-rate-limits :
 * cache slow-changing data, collapse identical in-flight requests, and back off on 429.
 * Our own token buckets stay under the per-key defaults in
 * https://docs.relay.link/references/api/api-keys (quote 50/min, others 200/min).
 * (confluence:relay-upstream)
 */
export const MAINNET_RELAY_API = "https://api.relay.link"; // matches @relayprotocol/relay-sdk MAINNET_RELAY_API
export const TESTNET_RELAY_API = "https://api.testnets.relay.link"; // matches TESTNET_RELAY_API

export interface UpstreamResponse {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
}

export interface UpstreamOptions {
  baseUrl: string;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class RelayNotConfiguredError extends Error {}
export class RelayBusyError extends Error {}

type Bucket = "quote" | "other";

export class RelayUpstream {
  private readonly buckets: Record<Bucket, TokenBucket> = {
    // 45 per minute, burst 5: under Relay's 50/min /quote default.
    quote: new TokenBucket(5, 45 / 60, 4_000),
    // 180 per minute, burst 10: under the 200/min default for the other endpoints we use.
    other: new TokenBucket(10, 3, 4_000),
  };
  private readonly cache = new Map<string, { until: number; value: UpstreamResponse }>();
  private readonly inflight = new Map<string, Promise<UpstreamResponse>>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: UpstreamOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get configured() {
    return Boolean(this.opts.apiKey);
  }

  /**
   * One Relay call. `cacheMs` > 0 caches successful responses; identical calls already
   * in flight share one upstream request either way.
   */
  async request(method: "GET" | "POST", path: string, body: unknown, cacheMs = 0, headers: Record<string, string> = {}): Promise<UpstreamResponse> {
    if (!this.opts.apiKey) throw new RelayNotConfiguredError("RELAY_API_KEY is not set");
    const key = `${method} ${path} ${body === undefined ? "" : createHash("sha256").update(JSON.stringify(body)).digest("hex")}`;
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.send(method, path, body, headers)
      .then((res) => {
        if (cacheMs > 0 && res.status === 200) this.cache.set(key, { until: Date.now() + cacheMs, value: res });
        return res;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async send(method: "GET" | "POST", path: string, body: unknown, headers: Record<string, string>): Promise<UpstreamResponse> {
    const bucket: Bucket = path.startsWith("/quote") ? "quote" : "other";
    const maxRetries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.buckets[bucket].take();
      } catch {
        throw new RelayBusyError("our Relay request budget is momentarily used up");
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
          method,
          signal: ctrl.signal,
          headers: {
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...headers,
            "x-api-key": this.opts.apiKey!,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } finally {
        clearTimeout(timer);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      if (res.status === 429 && attempt < maxRetries) {
        // Exponential backoff (0.5s, 1s, ...), or Relay's Retry-After when it is longer.
        const waitMs = Math.max(500 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
        await this.sleep(Math.min(waitMs, 8_000));
        continue;
      }
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { message: "Relay returned a non-JSON response" };
      }
      return { status: res.status, body: parsed, retryAfterSeconds: res.status === 429 && Number.isFinite(retryAfter) ? retryAfter : undefined };
    }
  }
}
