import { isMainnet, publicEnv } from "@/lib/env";

export function EnvBadge() {
  if (isMainnet) return null;
  return (
    <span className="rounded-sm border border-warning px-2 py-0.5 font-mono text-xs text-warning">
      {publicEnv.confluenceEnv === "testnet" ? "Testnet" : publicEnv.confluenceEnv}
    </span>
  );
}
