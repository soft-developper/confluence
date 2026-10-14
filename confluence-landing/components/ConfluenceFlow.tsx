import type { LandingChain } from "@/lib/site";

/**
 * Hero picture (confluence:landing-flow): the Confluence mark drawn large. Each chain the
 * bridge offers is a stream that flows into one indigo line, Arc, the way two rivers meet
 * in the logo. Chain names are live from the API. Streams on the left use the source blue
 * and on the right the destination teal, like the mark. Drawn once on page load (CSS only,
 * no script), and shown fully drawn when the visitor prefers reduced motion.
 */
const W = 600;
const TOP = 96; // where the streams start
const JOIN = 352; // where they meet
const BOTTOM = 516; // end of the Arc line
const MID = W / 2;

function streamPath(x: number) {
  // Same shape family as the mark: falls straight, then bends into the centre line.
  return `M${x} ${TOP}C${x} ${TOP + 120} ${MID + (x - MID) * 0.18} ${JOIN - 110} ${MID} ${JOIN}`;
}

export function ConfluenceFlow({
  chains,
  arcName,
  max,
  labelSize,
  inset = 44,
  className = "",
}: {
  chains: LandingChain[];
  arcName: string;
  /** How many streams to draw (labels need room, so phones draw fewer). */
  max: number;
  labelSize: number;
  /** Distance of the outer streams from the edges, so the outer names are not clipped. */
  inset?: number;
  className?: string;
}) {
  const shown = chains.slice(0, max);
  // No chain list (API unreachable): still draw the picture, without names.
  const n = shown.length > 0 ? shown.length : 6;
  const left = inset;
  const right = W - inset;
  const step = n > 1 ? (right - left) / (n - 1) : 0;
  const streams = Array.from({ length: n }, (_, i) => ({
    x: n > 1 ? left + i * step : MID,
    name: shown[i]?.name,
    color: i < n / 2 ? "var(--flow-source)" : "var(--flow-destination)",
    // Two label rows so neighbouring names never collide.
    labelY: i % 2 === 0 ? TOP - 44 : TOP - 18,
  }));
  const more = chains.length - shown.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${BOTTOM + 40}`}
      className={`flow h-auto w-full ${className}`}
      role="img"
      aria-label={
        shown.length > 0
          ? `${chains.map((c) => c.name).join(", ")} flowing into ${arcName}`
          : `Chains flowing into ${arcName}`
      }
    >
      {streams.map((s, i) => (
        <g key={i} style={{ "--i": i } as React.CSSProperties}>
          {s.name && (
            <>
              <line x1={s.x} y1={s.labelY + 8} x2={s.x} y2={TOP - 10} className="flow-tick" />
              <text x={s.x} y={s.labelY} textAnchor="middle" fontSize={labelSize} className="flow-label">
                {s.name}
              </text>
            </>
          )}
          <path d={streamPath(s.x)} pathLength={1} stroke={s.color} className="flow-stream" />
        </g>
      ))}
      <path d={`M${MID} ${JOIN}V${BOTTOM}`} pathLength={1} className="flow-stem" />
      <text x={MID + 34} y={BOTTOM - 6} fontSize={labelSize + 8} className="flow-arc">
        {arcName}
      </text>
      {more > 0 && (
        <text x={MID - 34} y={BOTTOM - 6} textAnchor="end" fontSize={labelSize} className="flow-more">
          and {more} more {more === 1 ? "chain" : "chains"}
        </text>
      )}
    </svg>
  );
}
