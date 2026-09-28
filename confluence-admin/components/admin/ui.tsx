"use client";

/** Small building blocks for the admin screens (A3), in the app's brand tokens. */
export function Panel({ title, children, actions }: { title?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-medium">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  kind = "primary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const cls =
    kind === "primary"
      ? "bg-action text-on-action hover:bg-action-hover"
      : kind === "danger"
        ? "border border-danger text-danger hover:bg-bg"
        : "border border-border-control hover:border-action-text";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`h-10 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text ${cls}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-10 w-full rounded-md border border-border-control bg-bg px-3 text-sm outline-none focus:border-action-text";

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[13px] text-danger">
      {children}
    </p>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg p-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="tnum text-xl font-medium">{value}</span>
      {sub && <span className="text-xs text-ink-muted">{sub}</span>}
    </div>
  );
}

/** A plain SVG bar chart (no chart library). */
export function Bars({ data, format, color = "bg-action" }: { data: { label: string; value: number }[]; format: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join(", ")}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end">
            <div className={`w-full rounded-t-[2px] ${d.value ? color : "bg-border"}`} style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-bg group-hover:block">
              {d.label}: {format(d.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-ink-muted">
        <span>{data[0]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}
