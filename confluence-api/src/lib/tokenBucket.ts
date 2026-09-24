/**
 * Outbound limiter for calls WE make to Circle's APIs, so our own traffic can never
 * exhaust Circle's limits. Token bucket: `capacity` burst, refilled at `refillPerSecond`.
 * `take()` waits for a token; it rejects if the wait would exceed `maxWaitMs`.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    readonly capacity: number,
    readonly refillPerSecond: number,
    readonly maxWaitMs = 10_000,
  ) {
    if (capacity <= 0 || refillPerSecond <= 0) throw new Error("TokenBucket needs positive capacity and rate");
    this.tokens = capacity;
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond);
    this.last = now;
  }

  async take(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
    if (waitMs > this.maxWaitMs) throw new Error(`outbound rate limit: would wait ${waitMs}ms`);
    this.tokens -= 1; // reserve now so concurrent callers queue behind us
    await new Promise((r) => setTimeout(r, waitMs));
  }

  /** Run `fn` once a token is available. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.take();
    return fn();
  }
}
