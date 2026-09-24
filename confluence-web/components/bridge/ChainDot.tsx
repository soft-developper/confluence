export function ChainDot({ name, side }: { name: string; side: "source" | "destination" | "neutral" }) {
  const ring = side === "source" ? "border-source" : side === "destination" ? "border-destination" : "border-border-control";
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-surface-raised text-[11px] font-medium ${ring}`}>
      {name.slice(0, 1)}
    </span>
  );
}
