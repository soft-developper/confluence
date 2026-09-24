import type { BridgeChain } from "@/lib/chains";

/** Source-side attestation time from Circle's finality table (via the API). */
export function SpeedBadge({ chain }: { chain: BridgeChain }) {
  const fast = chain.speed?.fast;
  const standard = chain.speed?.standard;
  if (fast) {
    return <span className="rounded-sm bg-destination px-1.5 py-0.5 font-mono text-[11px] text-on-signal">Fast {fast.label}</span>;
  }
  const long = (standard?.maxSeconds ?? 0) > 3600;
  return (
    <span
      className={`rounded-sm border px-1.5 py-px font-mono text-[11px] ${long ? "border-warning text-warning" : "border-border-control text-ink-muted"}`}
    >
      {standard ? `Standard ${standard.label}` : "Standard"}
    </span>
  );
}
