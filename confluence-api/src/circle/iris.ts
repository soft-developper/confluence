import { z } from "zod";
import type { TokenBucket } from "../lib/tokenBucket.js";

/**
 * Circle CCTP API (Iris). Public, no API key.
 * GET /v2/burn/USDC/fees/{sourceDomainId}/{destDomainId}?forward=true
 * https://developers.circle.com/api-reference/cctp/all/get-burn-usdc-fees
 */
export const IRIS_BASE_URL = {
  testnet: "https://iris-api-sandbox.circle.com",
  mainnet: "https://iris-api.circle.com",
} as const;

/** Circle's docs show both "med" and "medium" for the middle tier; accept either. */
const ForwardFee = z
  .object({ low: z.number(), med: z.number().optional(), medium: z.number().optional(), high: z.number() })
  .transform((f) => ({ low: f.low, med: f.med ?? f.medium ?? f.high, high: f.high }));

const FeeRow = z.object({
  finalityThreshold: z.number(),
  minimumFee: z.number(),
  forwardFee: ForwardFee.optional(),
});
const FeeResponse = z.array(FeeRow);

export interface RouteFees {
  /** Fast Transfer fee in basis points (finalityThreshold <= 1000). */
  fastBps: number | null;
  /** Standard Transfer fee in basis points (finalityThreshold >= 2000), normally 0. */
  standardBps: number | null;
  /** Forwarding Service fee in USDC base units, per speed (medium tier). */
  forwardFeeFast: bigint | null;
  forwardFeeStandard: bigint | null;
}

export class IrisClient {
  private cache = new Map<string, { at: number; value: RouteFees }>();

  constructor(
    private readonly baseUrl: string,
    private readonly limiter: TokenBucket,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly cacheMs = 30_000,
    private readonly timeoutMs = 8_000,
  ) {}

  async getRouteFees(sourceDomain: number, destDomain: number): Promise<RouteFees> {
    const key = `${sourceDomain}-${destDomain}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.cacheMs) return hit.value;

    const url = `${this.baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}?forward=true`;
    const res = await this.limiter.run(() =>
      this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) }),
    );
    if (!res.ok) throw new Error(`Circle fees API returned HTTP ${res.status}`);
    const rows = FeeResponse.parse(await res.json());
    const fast = rows.find((r) => r.finalityThreshold <= 1000);
    const standard = rows.find((r) => r.finalityThreshold >= 2000);
    const value: RouteFees = {
      fastBps: fast ? fast.minimumFee : null,
      standardBps: standard ? standard.minimumFee : null,
      forwardFeeFast: fast?.forwardFee ? BigInt(Math.ceil(fast.forwardFee.med)) : null,
      forwardFeeStandard: standard?.forwardFee ? BigInt(Math.ceil(standard.forwardFee.med)) : null,
    };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
