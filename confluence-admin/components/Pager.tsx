"use client";

/**
 * Numbered pagination (20 per page across the app). Page 1 is always the newest, so new
 * records push older ones onto later pages.
 */
export const PAGE_SIZE = 20;

function pagesToShow(page: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function Pager({
  page,
  totalPages,
  total,
  pageSize = PAGE_SIZE,
  onPage,
  busy = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
  onPage: (p: number) => void;
  busy?: boolean;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = "h-8 min-w-8 rounded-[4px] border px-2 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <span className="text-xs text-ink-muted" aria-live="polite">
        Showing {from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()}
      </span>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={`${btn} border-border-control`} disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          {pagesToShow(page, totalPages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-ink-muted" aria-hidden="true">
                ...
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p}`}
                disabled={busy && p !== page}
                onClick={() => p !== page && onPage(p)}
                className={`${btn} ${p === page ? "border-action text-action-text" : "border-border-control text-ink-muted hover:text-ink"}`}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" className={`${btn} border-border-control`} disabled={page >= totalPages || busy} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </nav>
  );
}

/** Client-side paging for short lists the API returns whole (problems, treasury chains). */
export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { slice: items.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages, total: items.length };
}
