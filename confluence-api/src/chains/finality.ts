/**
 * CCTP attestation times per SOURCE chain, copied from Circle's documentation:
 * https://developers.circle.com/cctp/concepts/finality-and-block-confirmations
 *
 * Circle publishes these only as a docs table (no API), so they live here as data.
 * Review this file whenever that page changes. A chain missing from this table is
 * shown as "Standard" with no time estimate rather than a guessed one.
 *
 * Keys are chain families; testnets map onto their family in `FAMILY_OF` below.
 */
export interface SpeedEstimate {
  /** Human label shown in the UI, e.g. "~8s", "~15-19 min", "6 to 32 h" */
  label: string;
  minSeconds: number;
  maxSeconds: number;
}

export interface FinalityInfo {
  /** Present only when Circle lists Fast Transfer for this chain as a source. */
  fast: SpeedEstimate | null;
  standard: SpeedEstimate | null;
}

const s = (label: string, minSeconds: number, maxSeconds = minSeconds): SpeedEstimate => ({ label, minSeconds, maxSeconds });
const MIN = 60;
const H = 3600;

export const FINALITY_BY_FAMILY: Readonly<Record<string, FinalityInfo>> = {
  Ethereum: { fast: s("~20s", 20), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Arbitrum: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Base: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Codex: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Edge: { fast: s("~8s", 8), standard: s("~16-21 min", 16 * MIN, 21 * MIN) },
  Ink: { fast: s("~8s", 8), standard: s("~30 min", 30 * MIN) },
  Linea: { fast: s("~8s", 8), standard: s("6 to 32 h", 6 * H, 32 * H) },
  Morph: { fast: s("~8s", 8), standard: s("~20-30 min", 20 * MIN, 30 * MIN) },
  Optimism: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Plume: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Unichain: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  World_Chain: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  X_Layer: { fast: s("~8s", 8), standard: s("~15-19 min", 15 * MIN, 19 * MIN) },
  Arc: { fast: null, standard: s("~0.5s", 1) },
  Avalanche: { fast: null, standard: s("~8s", 8) },
  Cronos: { fast: null, standard: s("~0.5s", 1) },
  HyperEVM: { fast: null, standard: s("~5s", 5) },
  Injective: { fast: null, standard: s("~0.65s", 1) },
  Monad: { fast: null, standard: s("~5s", 5) },
  Pharos: { fast: null, standard: s("~7s", 7) },
  Plasma: { fast: null, standard: s("~1s", 1) },
  Polygon: { fast: null, standard: s("~8s", 8) },
  Sei: { fast: null, standard: s("~5s", 5) },
  Sonic: { fast: null, standard: s("~8s", 8) },
  XDC: { fast: null, standard: s("~10s", 10) },
};

/** App Kit chain identifier -> family key above (mainnet and testnet). */
export const FAMILY_OF: Readonly<Record<string, string>> = {
  Ethereum: "Ethereum", Ethereum_Sepolia: "Ethereum",
  Arbitrum: "Arbitrum", Arbitrum_Sepolia: "Arbitrum",
  Base: "Base", Base_Sepolia: "Base",
  Codex: "Codex", Codex_Testnet: "Codex",
  Edge: "Edge", Edge_Testnet: "Edge",
  Ink: "Ink", Ink_Testnet: "Ink",
  Linea: "Linea", Linea_Sepolia: "Linea",
  Morph: "Morph", Morph_Testnet: "Morph",
  Optimism: "Optimism", Optimism_Sepolia: "Optimism",
  Plume: "Plume", Plume_Testnet: "Plume",
  Unichain: "Unichain", Unichain_Sepolia: "Unichain",
  World_Chain: "World_Chain", World_Chain_Sepolia: "World_Chain",
  X_Layer: "X_Layer", X_Layer_Testnet: "X_Layer",
  Arc: "Arc", Arc_Testnet: "Arc",
  Avalanche: "Avalanche", Avalanche_Fuji: "Avalanche",
  Cronos: "Cronos", Cronos_Testnet: "Cronos",
  HyperEVM: "HyperEVM", HyperEVM_Testnet: "HyperEVM",
  Injective: "Injective", Injective_Testnet: "Injective",
  Monad: "Monad", Monad_Testnet: "Monad",
  Pharos: "Pharos", Pharos_Testnet: "Pharos",
  Plasma: "Plasma", Plasma_Testnet: "Plasma",
  Polygon: "Polygon", Polygon_Amoy_Testnet: "Polygon",
  Sei: "Sei", Sei_Testnet: "Sei",
  Sonic: "Sonic", Sonic_Testnet: "Sonic",
  XDC: "XDC", XDC_Apothem: "XDC",
};

export function finalityFor(chainId: string): FinalityInfo | null {
  const family = FAMILY_OF[chainId];
  return family ? (FINALITY_BY_FAMILY[family] ?? null) : null;
}
