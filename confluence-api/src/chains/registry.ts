import { AppKit } from "@circle-fin/app-kit";
import type { Config } from "../config.js";
import { finalityFor, type FinalityInfo } from "./finality.js";

export const FINALITY_SOURCE_URL = "https://developers.circle.com/cctp/concepts/finality-and-block-confirmations";

export interface BridgeChain {
  /** App Kit chain identifier, e.g. "Arc_Testnet". Case-sensitive. */
  id: string;
  name: string;
  evmChainId: number;
  cctpDomain: number;
  isTestnet: boolean;
  /** Explorer URL template containing "{hash}" */
  explorerTxUrl: string;
  usdcAddress: string;
  /** Whether Circle's Forwarding Service can mint on this chain as the destination. */
  forwarderAsDestination: boolean;
  /** Source-side attestation times from Circle's docs; null when not listed. */
  speed: FinalityInfo | null;
}

export interface ChainRegistry {
  readonly chains: readonly BridgeChain[];
  readonly byId: ReadonlyMap<string, BridgeChain>;
  /** Supported chains that have no entry in the finality table (shown without ETA). */
  readonly missingSpeed: readonly string[];
}

/**
 * Builds the bridge chain list from the installed App Kit SDK, never a hard-coded list.
 * v1 is EVM only; testnet builds only see testnets and mainnet only mainnets.
 */
export function buildChainRegistry(config: Config, kit: Pick<AppKit, "getSupportedChains"> = new AppKit()): ChainRegistry {
  const wantTestnet = config.CONFLUENCE_ENV === "testnet";
  const chains: BridgeChain[] = [];
  for (const c of kit.getSupportedChains("bridge")) {
    if (c.type !== "evm" || c.isTestnet !== wantTestnet || !c.usdcAddress || !c.cctp) continue;
    chains.push({
      id: c.chain,
      name: c.name,
      evmChainId: c.chainId,
      cctpDomain: c.cctp.domain,
      isTestnet: c.isTestnet,
      explorerTxUrl: c.explorerUrl,
      usdcAddress: c.usdcAddress,
      forwarderAsDestination: c.cctp.forwarderSupported.destination,
      speed: finalityFor(c.chain),
    });
  }
  // Arc first (the product centers on it), then alphabetical by name.
  chains.sort((a, b) => {
    const arcA = a.id.startsWith("Arc") ? 0 : 1;
    const arcB = b.id.startsWith("Arc") ? 0 : 1;
    return arcA - arcB || a.name.localeCompare(b.name);
  });
  return Object.freeze({
    chains: Object.freeze(chains),
    byId: new Map(chains.map((c) => [c.id, c])),
    missingSpeed: Object.freeze(chains.filter((c) => !c.speed).map((c) => c.id)),
  });
}
